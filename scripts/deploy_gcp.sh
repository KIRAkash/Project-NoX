#!/usr/bin/env bash
# Deploy NoX to Google Cloud Run: nox-api and nox-web, sized for a mostly idle demo.
#
#   scripts/deploy_gcp.sh secrets        copy secret values from .env into Secret Manager
#   scripts/deploy_gcp.sh ai-access      let the runtime service account call Gemini, Model Armor, DLP, BigQuery,
#                                        Memory Bank and Cloud Trace
#   scripts/deploy_gcp.sh [all|api|web]
#   scripts/deploy_gcp.sh hosting        Firebase Hosting in front of nox-web, for a custom domain (NOX_WEB_URL)
#   DRY_RUN=1 scripts/deploy_gcp.sh all  print the gcloud commands instead of running them
#
# No worker and no Redis: the API runs jobs in-process (WORKER_MODE=in_process) and delivers live events in
# memory, so it is capped at one instance. It scales to zero when idle; CPU stays on while an instance is up so
# jobs finish after their request returns. Sightings are checked by the API itself (NOX_SIGHTINGS_TICK=local).
#
# Needs (in the environment or .env): GCP_PROJECT_ID, and for Cloud SQL:
#   NOX_SQL_INSTANCE (project:region:instance), CLOUD_DATABASE_URL (postgresql+asyncpg://…?host=/cloudsql/<instance>).
# Optional Redis: set CLOUD_REDIS_URL (redis://10.x.x.x:6379/0) and it is reached by Direct VPC egress on
# NOX_VPC_NETWORK/NOX_VPC_SUBNET (default/default), or through NOX_VPC_CONNECTOR.
# Gemini runs on the Gemini Enterprise Agent Platform (Vertex AI) as the runtime service account: no API key is
# deployed. NOX_RUNTIME_SA picks that account (default: the project's compute service account).
# Optional: GCP_REGION (us-central1), GCS_BUCKET_NAME (nox-kbs-<project>), NOX_DEMO_DEV_AUTH=true to keep the
# "Dev" sign-in on a demo deployment (never on a real one).
set -euo pipefail
cd "$(dirname "$0")/.."
export CLOUDSDK_CORE_DISABLE_PROMPTS=1  # a hidden prompt (e.g. "install the beta component?") would hang the deploy

# .env fills in what the shell doesn't already set (explicit environment wins).
if [[ -f .env ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
    [[ -n "${!k+x}" ]] && continue
    [[ "$v" =~ ^[\"\'] ]] || v="$(sed -E 's/[[:space:]]+#.*$//' <<<"$v")"  # drop an inline comment on an unquoted value
    v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
    export "$k=$v"
  done < .env
fi

TARGET="${1:-all}"
PROJECT="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID (no fallback to your gcloud default, on purpose)}"
REGION="${GCP_REGION:-us-central1}"
BUCKET="${GCS_BUCKET_NAME:-nox-kbs-${PROJECT}}"
REPO="${NOX_ARTIFACT_REPO:-nox}"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
DEV_AUTH="${NOX_DEMO_DEV_AUTH:-false}"

# A just-enabled API answers "SERVICE_DISABLED" for a minute or two: try again before giving up.
retry_new_api() { local i; for i in 1 2 3 4 5 6; do "$@" && return 0; [[ $i == 6 ]] && return 1; echo "  waiting for the API to come online ($i/5)…"; sleep 30; done; }
run() { if [[ "${DRY_RUN:-}" == 1 ]]; then cat >/dev/null 2>&1 || true; printf '+'; printf ' %q' "$@"; echo; else "$@"; fi; }
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# Secret Manager names ↔ settings. Values never go on a command line or into plain env vars.
SECRETS=(GITHUB_APP_PRIVATE_KEY GITHUB_APP_TOKEN WEBHOOK_SECRET JIRA_API_TOKEN JIRA_WEBHOOK_SECRET
         CONFLUENCE_API_TOKEN NOTION_API_TOKEN SLACK_BOT_TOKEN SLACK_SIGNING_SECRET JULES_API_KEY CLOUD_DATABASE_URL)
secret_name() { echo "nox-$(echo "$1" | tr '[:upper:]_' '[:lower:]-')"; }

push_secrets() {
  say "Secrets → Secret Manager (${PROJECT})"
  if [[ -z "${GITHUB_APP_PRIVATE_KEY:-}" && -n "${GITHUB_APP_PRIVATE_KEY_PATH:-}" && -f "${GITHUB_APP_PRIVATE_KEY_PATH}" ]]; then
    GITHUB_APP_PRIVATE_KEY="$(cat "$GITHUB_APP_PRIVATE_KEY_PATH")"
  fi
  for var in "${SECRETS[@]}"; do
    val="${!var:-}"
    name="$(secret_name "$var")"
    if [[ -z "$val" ]]; then echo "  skip $var (empty)"; continue; fi
    if ! gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
      run gcloud secrets create "$name" --project "$PROJECT" --replication-policy automatic
    fi
    if [[ "${DRY_RUN:-}" == 1 ]]; then echo "+ (value of $var) | gcloud secrets versions add $name --data-file=-"
    else printf '%s' "$val" | gcloud secrets versions add "$name" --project "$PROJECT" --data-file=- >/dev/null; fi
    echo "  ✓ $var → $name"
  done
}

# The runtime service account reads each NoX secret, and only those (per-secret role, not project-wide).
grant_secret_access() {
  say "Secret access for the runtime service account"
  local var name
  for var in "${SECRETS[@]}"; do
    name="$(secret_name "$var")"
    if [[ "${DRY_RUN:-}" != 1 ]] && ! gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then continue; fi
    run gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT" --member "serviceAccount:$(runtime_sa)" \
      --role roles/secretmanager.secretAccessor --condition None --quiet --format none
    echo "  ✓ $name"
  done
}

secret_flags() {
  local out=()
  for var in "${SECRETS[@]}"; do
    [[ "$var" == CLOUD_DATABASE_URL ]] && continue
    gcloud secrets describe "$(secret_name "$var")" --project "$PROJECT" >/dev/null 2>&1 && out+=("${var}=$(secret_name "$var"):latest")
  done
  out+=("DATABASE_URL=$(secret_name CLOUD_DATABASE_URL):latest")
  (IFS=,; echo "${out[*]}")
}

enable_apis() {
  say "APIs, bucket, image repository"
  run gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com aiplatform.googleapis.com \
    storage.googleapis.com secretmanager.googleapis.com sqladmin.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com \
    cloudtrace.googleapis.com telemetry.googleapis.com --project "$PROJECT"
  gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT" >/dev/null 2>&1 || \
    run gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT" --location "$REGION" --uniform-bucket-level-access
  gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 || \
    run gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT"
}

ensure_billing_budget() {
  say "Cloud Billing budget guardrail"
  local billing_account="${GCP_BILLING_ACCOUNT:-}"
  if [[ -z "$billing_account" && "${DRY_RUN:-}" != 1 ]]; then
    # GA command (no "beta" component, whose install prompt would hang here); < /dev/null so nothing can prompt.
    billing_account="$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)' < /dev/null 2>/dev/null | sed 's#billingAccounts/##' || true)"
    if [[ -z "$billing_account" ]]; then
      echo "  skip: can't read the project's billing account as $(gcloud config get-value account 2>/dev/null)." >&2
      echo "  Set GCP_BILLING_ACCOUNT, or create the budget in the console (Billing → Budgets & alerts)." >&2
      return 0
    fi
  fi
  billing_account="${billing_account:-000000-000000-000000}"
  local display_name="nox-budget-${PROJECT}"
  local amount="${NOX_BUDGET_AMOUNT:-30USD}"  # alerts only: a budget never stops spending

  if [[ "${DRY_RUN:-}" != 1 ]]; then
    local existing_budget
    existing_budget="$(gcloud billing budgets list --billing-account="$billing_account" --format='value(name)' --filter="displayName='${display_name}'" 2>/dev/null || true)"
    if [[ -n "$existing_budget" ]]; then
      echo "  Budget ${display_name} already exists (${existing_budget}), updating..."
      run gcloud billing budgets update "$existing_budget" --billing-account="$billing_account" \
        --budget-amount="$amount" --threshold-rule=percent=0.5 --threshold-rule=percent=0.8 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
      return
    fi
  fi

  run gcloud billing budgets create --billing-account="$billing_account" \
    --display-name="$display_name" --budget-amount="$amount" --filter-projects="projects/${PROJECT}" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.8 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 < /dev/null \
    || echo "  skip: couldn't create the budget (needs Billing Account Costs Manager); create it in the console." >&2
}

runtime_sa() {
  echo "${NOX_RUNTIME_SA:-$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)' 2>/dev/null || true)-compute@developer.gserviceaccount.com}"
}

grant_ai_access() {
  say "Agent Platform access for the runtime service account"
  run gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$(runtime_sa)" \
    --role roles/aiplatform.user --condition None --quiet --format none
  # Ticket state (assignee, pipeline) lives in Firestore, in the Firebase project.
  local fb="${FIREBASE_PROJECT_ID:-${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-$PROJECT}}"
  say "Firestore for ticket state in ${fb}"
  run gcloud services enable firestore.googleapis.com --project "$fb"
  gcloud firestore databases describe --database "(default)" --project "$fb" >/dev/null 2>&1 || \
    run gcloud firestore databases create --database "(default)" --location "$REGION" --project "$fb" --quiet
  run gcloud projects add-iam-policy-binding "$fb" --member "serviceAccount:$(runtime_sa)" \
    --role roles/datastore.user --condition None --quiet --format none
  grant_secret_access
  grant_shield
  grant_analytics
  # Team memory (Agent Platform Memory Bank) and agent traces (Cloud Trace through the Telemetry API).
  say "Memory Bank and Cloud Trace"
  run gcloud services enable cloudtrace.googleapis.com telemetry.googleapis.com --project "$PROJECT"
  for role in roles/aiplatform.memoryUser roles/cloudtrace.agent; do
    run gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$(runtime_sa)" \
      --role "$role" --condition None --quiet --format none
  done
}

SHIELD_TEMPLATE="${NOX_SHIELD_TEMPLATE:-nox-shield}"
SHIELD_LOCATION="${NOX_SHIELD_LOCATION:-us-central1}"
BQ_DATASET="${NOX_BQ_DATASET:-nox_analytics}"

grant_shield() {
  say "NoX Shield: Model Armor template ${SHIELD_TEMPLATE} and Sensitive Data Protection"
  run gcloud services enable modelarmor.googleapis.com dlp.googleapis.com --project "$PROJECT"
  # Model Armor is regional; point gcloud at the regional endpoint for this script only.
  export CLOUDSDK_API_ENDPOINT_OVERRIDES_MODELARMOR="https://modelarmor.${SHIELD_LOCATION}.rep.googleapis.com/"
  gcloud model-armor templates describe "$SHIELD_TEMPLATE" --location "$SHIELD_LOCATION" --project "$PROJECT" >/dev/null 2>&1 || \
    retry_new_api run gcloud model-armor templates create "$SHIELD_TEMPLATE" --location "$SHIELD_LOCATION" --project "$PROJECT" \
      --pi-and-jailbreak-filter-settings-enforcement=enabled --pi-and-jailbreak-filter-settings-confidence-level=medium-and-above \
      --malicious-uri-filter-settings-enforcement=enabled --basic-config-filter-enforcement=enabled \
      --rai-settings-filters='[{"filterType":"DANGEROUS","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"HARASSMENT","confidenceLevel":"MEDIUM_AND_ABOVE"}]'
  for role in roles/modelarmor.user roles/dlp.user; do
    run gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$(runtime_sa)" \
      --role "$role" --condition None --quiet --format none
  done
  say "API Quota Ceilings: Model Armor and Vertex AI"
  quota_cap aiplatform.googleapis.com aiplatform.googleapis.com/online_prediction_requests
  quota_cap modelarmor.googleapis.com modelarmor.googleapis.com/sanitize_user_prompt_requests
}

# A per-minute request ceiling, as a cost guard. Recent gcloud releases dropped `services quota`; when it isn't
# there (or permission is missing) the deploy carries on and says where to set the ceiling by hand.
quota_cap() {
  run gcloud beta services quota update --service="$1" --consumer="projects/${PROJECT}" --metric="$2" \
    --unit=1/min/{project} --value=60 --force < /dev/null \
    || echo "  skip: no quota ceiling on $1 (set one in the console: IAM & Admin → Quotas & System Limits)" >&2
}

grant_analytics() {
  say "Flight recorder: BigQuery dataset ${BQ_DATASET}"
  run gcloud services enable bigquery.googleapis.com --project "$PROJECT"
  bq --project_id "$PROJECT" show --dataset "${PROJECT}:${BQ_DATASET}" >/dev/null 2>&1 || \
    run bq --project_id "$PROJECT" mk --dataset --location "${NOX_BQ_LOCATION:-US}" "${PROJECT}:${BQ_DATASET}"
  # Tables and views are CREATE ... IF NOT EXISTS / OR REPLACE, so this is safe to re-run.
  sed "s/{ds}/${PROJECT}.${BQ_DATASET}/g" apps/api/nox_api/services/analytics_views.sql | \
    run bq --project_id "$PROJECT" query --use_legacy_sql=false --quiet
  run gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$(runtime_sa)" \
    --role roles/bigquery.jobUser --condition None --quiet --format none
  grant_dataset_writer "$(runtime_sa)"
}

# WRITER on the dataset's access list (dataset-level IAM through `bq add-iam-policy-binding` needs allowlisting).
grant_dataset_writer() {
  local sa="$1" acl
  if [[ "${DRY_RUN:-}" == 1 ]]; then echo "+ bq update --source <access list + WRITER for ${sa}> ${PROJECT}:${BQ_DATASET}"; return; fi
  acl="$(mktemp)"
  bq --project_id "$PROJECT" show --format=prettyjson "${PROJECT}:${BQ_DATASET}" < /dev/null > "$acl"
  if jq -e --arg sa "$sa" '.access | any(.userByEmail == $sa and .role == "WRITER")' "$acl" >/dev/null; then
    echo "  ${sa} can already write to ${BQ_DATASET}"
  else
    jq --arg sa "$sa" '{access: (.access + [{role: "WRITER", userByEmail: $sa}])}' "$acl" > "${acl}.new"
    bq --project_id "$PROJECT" update --source "${acl}.new" "${PROJECT}:${BQ_DATASET}" < /dev/null >/dev/null
    echo "  ✓ ${sa} can write to ${BQ_DATASET}"
  fi
  rm -f "$acl" "${acl}.new"
}

api_env() {
  local web_url="$1"
  # "^|^" makes "|" the separator, so values may contain commas (JIRA_ALLOWED_PROJECTS=TWPOL,TWCLM).
  echo "^|^NOX_AI_BACKEND=enterprise|GOOGLE_CLOUD_PROJECT=${PROJECT}|GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION:-global}|\
GEMINI_BACKUP_MODEL=${GEMINI_BACKUP_MODEL:-gemini-3.5-flash}|NOX_MODEL_FAST=${NOX_MODEL_FAST:-}|NOX_MODEL_DEEP=${NOX_MODEL_DEEP:-}|\
NOX_EMBED_MODEL=${NOX_EMBED_MODEL:-gemini-embedding-2}|GEMINI_RATE_LIMIT_SAFE_MODE=false|\
STORAGE_BACKEND=gcs|GCS_BUCKET_NAME=${BUCKET}|REDIS_URL=${CLOUD_REDIS_URL:-}|WORKER_MODE=in_process|NOX_SIGHTINGS_TICK=local|\
GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.7-flash}|NOX_DEV_AUTH=${DEV_AUTH}|NOX_DEMO_ORG_SLUGS=${NOX_DEMO_ORG_SLUGS:-}|\
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-}}|NOX_TICKET_STORE=firestore|NOX_WEB_ORIGIN=${web_url}|\
ATLASSIAN_BASE_URL=${ATLASSIAN_BASE_URL:-}|ATLASSIAN_EMAIL=${ATLASSIAN_EMAIL:-}|JIRA_DEFAULT_PROJECT=${JIRA_DEFAULT_PROJECT:-TWPOL}|\
JIRA_ALLOWED_PROJECTS=${JIRA_ALLOWED_PROJECTS:-TWPOL,TWCLM}|GITHUB_APP_ID=${GITHUB_APP_ID:-}|GITHUB_APP_INSTALLATION_ID=${GITHUB_APP_INSTALLATION_ID:-}|\
GITHUB_DEFAULT_ORG=${GITHUB_DEFAULT_ORG:-}|GITHUB_APP_SLUG=${GITHUB_APP_SLUG:-nox-gitops}|NOX_COMMIT_SPECS=${NOX_COMMIT_SPECS:-true}|\
NOX_SHIELD=${NOX_SHIELD:-enforce}|NOX_SHIELD_TEMPLATE=${SHIELD_TEMPLATE}|NOX_SHIELD_LOCATION=${SHIELD_LOCATION}|\
NOX_ANALYTICS=${NOX_ANALYTICS:-bigquery}|NOX_BQ_DATASET=${BQ_DATASET}|NOX_TRACE=${NOX_TRACE:-cloud}|\
NOX_MEMORY=${NOX_MEMORY:-$([[ -n "${NOX_MEMORY_BANK:-}" ]] && echo memory_bank || echo postgres)}|NOX_MEMORY_BANK=${NOX_MEMORY_BANK:-}|\
NOX_MODEL_TRANSCRIBE=${NOX_MODEL_TRANSCRIBE:-}|NOX_MODEL_TTS=${NOX_MODEL_TTS:-gemini-3.8-flash-lite-tts}|NOX_TTS_VOICE=${NOX_TTS_VOICE:-Kore}"
}

service_url() {
  if [[ "${DRY_RUN:-}" == 1 ]]; then
    echo "https://${1}-dryrun.${REGION}.a.run.app"
    return
  fi
  gcloud run services describe "$1" --project "$PROJECT" --region "$REGION" --format 'value(status.url)' 2>/dev/null || true
}

build_api() {
  say "Build API image"
  run gcloud builds submit apps/api --project "$PROJECT" --tag "${IMAGE_BASE}/nox-api:${TAG}"
}

common_flags=(--project "$PROJECT" --region "$REGION" --platform managed)
net_flags() {
  local vpc=""  # Cloud SQL goes through the built-in connector; the VPC is only needed to reach Redis
  if [[ -n "${NOX_VPC_CONNECTOR:-}" ]]; then vpc="--vpc-connector=${NOX_VPC_CONNECTOR}"
  elif [[ -n "${CLOUD_REDIS_URL:-}" ]]; then vpc="--network=${NOX_VPC_NETWORK:-default} --subnet=${NOX_VPC_SUBNET:-default} --vpc-egress=private-ranges-only"; fi
  echo "--set-cloudsql-instances=${NOX_SQL_INSTANCE:?Set NOX_SQL_INSTANCE} ${vpc} --service-account=$(runtime_sa)"
}

deploy_api() {
  local web_url; web_url="${NOX_WEB_URL:-$(service_url nox-web)}"; web_url="${web_url:-${NOX_WEB_ORIGIN:-http://localhost:3000}}"
  say "Deploy nox-api"
  # shellcheck disable=SC2046
  run gcloud run deploy nox-api "${common_flags[@]}" --image "${IMAGE_BASE}/nox-api:${TAG}" --allow-unauthenticated \
    --min-instances 0 --max-instances=1 --concurrency=80 --no-cpu-throttling --memory 2Gi --cpu 1 --timeout 900 $(net_flags) \
    --set-env-vars "$(api_env "$web_url")" --set-secrets "$(secret_flags)"
  local api_url; api_url="$(service_url nox-api)"
  run gcloud run services update nox-api "${common_flags[@]}" --update-env-vars "WEBHOOK_BASE_URL=${api_url},NOX_PUBLIC_API_URL=${NOX_PUBLIC_API_URL:-${api_url}}"
}

deploy_web() {
  local api_url; api_url="$(service_url nox-api)"
  [[ -n "$api_url" ]] || { echo "Deploy the API first (no nox-api service yet)" >&2; exit 1; }
  say "Build + deploy nox-web (API: ${api_url})"
  local cfg; cfg="$(mktemp)"
  cat > "$cfg" <<YAML
steps:
- name: gcr.io/cloud-builders/docker
  args: [build, -f, apps/web/Dockerfile, -t, "${IMAGE_BASE}/nox-web:${TAG}",
         --build-arg, "NOX_API_URL=${api_url}",
         --build-arg, "NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY:-}",
         --build-arg, "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:-}",
         --build-arg, "NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-}",
         --build-arg, "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:-}",
         --build-arg, "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:-}",
         --build-arg, "NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID:-}",
         --build-arg, "NEXT_PUBLIC_NOX_DEV_AUTH=${DEV_AUTH}", .]
images: ["${IMAGE_BASE}/nox-web:${TAG}"]
YAML
  run gcloud builds submit . --project "$PROJECT" --config "$cfg"
  rm -f "$cfg"
  run gcloud run deploy nox-web "${common_flags[@]}" --image "${IMAGE_BASE}/nox-web:${TAG}" --allow-unauthenticated \
    --min-instances 0 --max-instances 1 --memory 512Mi --cpu 1
  local web_url; web_url="${NOX_WEB_URL:-$(service_url nox-web)}"
  run gcloud run services update nox-api "${common_flags[@]}" --update-env-vars "NOX_WEB_ORIGIN=${web_url}"
  echo "  Add ${web_url#https://} to Firebase Auth → Authorized domains."
}

# Firebase Hosting in front of nox-web, for a custom domain (NOX_WEB_URL) with HTTPS. The project must be a
# Firebase project; the site has no files of its own and forwards every request (deploy/firebase/firebase.json).
deploy_hosting() {
  say "Firebase Hosting → nox-web"
  run firebase deploy --only hosting --project "$PROJECT" --config deploy/firebase/firebase.json --non-interactive
  if [[ -n "${NOX_WEB_URL:-}" ]]; then
    echo "  Connect ${NOX_WEB_URL#https://} in the Firebase console (Hosting → Add custom domain) and set the DNS records it shows."
  fi
}

case "$TARGET" in
  secrets) push_secrets; grant_secret_access ;;
  budget) ensure_billing_budget ;;
  api) build_api; deploy_api ;;
  web) deploy_web ;;
  hosting) deploy_hosting ;;
  ai-access) grant_ai_access ;;
  all) enable_apis; ensure_billing_budget; grant_ai_access; build_api; deploy_api; deploy_web
       api_url="$(service_url nox-api)"
       say "Done"
       echo "  Web:  $(service_url nox-web)"
       echo "  API:  ${api_url}"
       echo "  Webhooks: GitHub → ${api_url}/api/v1/webhooks/github/{push,pr}   Jira → ${api_url}/api/v1/webhooks/jira?secret=<JIRA_WEBHOOK_SECRET>"
       ;;
  *) echo "Usage: $0 [secrets|ai-access|budget|all|api|web|hosting]" >&2; exit 2 ;;
esac
