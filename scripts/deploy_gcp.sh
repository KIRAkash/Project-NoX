#!/usr/bin/env bash
# Deploy NoX to Google Cloud Run: nox-api, nox-worker, nox-web.
#
#   scripts/deploy_gcp.sh secrets        copy secret values from .env into Secret Manager
#   scripts/deploy_gcp.sh ai-access      let the runtime service account call Gemini on the Agent Platform
#   scripts/deploy_gcp.sh [all|api|worker|web]
#   DRY_RUN=1 scripts/deploy_gcp.sh all  print the gcloud commands instead of running them
#
# Needs (in the environment or .env): GCP_PROJECT_ID, and for Cloud SQL / Memorystore:
#   NOX_SQL_INSTANCE (project:region:instance), CLOUD_DATABASE_URL (postgresql+asyncpg://…?host=/cloudsql/<instance>),
#   CLOUD_REDIS_URL (redis://10.x.x.x:6379/0).
# Memorystore is reached by Direct VPC egress (no connector to pay for) on NOX_VPC_NETWORK/NOX_VPC_SUBNET
# (default/default); set NOX_VPC_CONNECTOR to use a serverless VPC connector instead.
# Gemini runs on the Gemini Enterprise Agent Platform (Vertex AI) as the runtime service account: no API key is
# deployed. NOX_RUNTIME_SA picks that account (default: the project's compute service account).
# Optional: GCP_REGION (us-central1), GCS_BUCKET_NAME (nox-kbs-<project>), NOX_DEMO_DEV_AUTH=true to keep the
# "Dev" sign-in on a demo deployment (never on a real one).
set -euo pipefail
cd "$(dirname "$0")/.."

# .env fills in what the shell doesn't already set (explicit environment wins).
if [[ -f .env ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
    [[ -n "${!k+x}" ]] && continue
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

run() { if [[ "${DRY_RUN:-}" == 1 ]]; then printf '+'; printf ' %q' "$@"; echo; else "$@"; fi; }
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# Secret Manager names ↔ settings. Values never go on a command line or into plain env vars.
SECRETS=(GITHUB_APP_PRIVATE_KEY GITHUB_APP_TOKEN WEBHOOK_SECRET JIRA_API_TOKEN JIRA_WEBHOOK_SECRET
         CONFLUENCE_API_TOKEN NOTION_API_TOKEN SLACK_BOT_TOKEN SLACK_SIGNING_SECRET CLOUD_DATABASE_URL)
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
    storage.googleapis.com secretmanager.googleapis.com sqladmin.googleapis.com redis.googleapis.com --project "$PROJECT"
  gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT" >/dev/null 2>&1 || \
    run gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT" --location "$REGION" --uniform-bucket-level-access
  gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 || \
    run gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT"
}

runtime_sa() {
  echo "${NOX_RUNTIME_SA:-$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')-compute@developer.gserviceaccount.com}"
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
}

api_env() {
  local web_url="$1"
  echo "NOX_AI_BACKEND=enterprise,GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION:-global},\
GEMINI_BACKUP_MODEL=${GEMINI_BACKUP_MODEL:-gemini-3.5-flash},NOX_MODEL_FAST=${NOX_MODEL_FAST:-},NOX_MODEL_DEEP=${NOX_MODEL_DEEP:-},\
NOX_EMBED_MODEL=${NOX_EMBED_MODEL:-gemini-embedding-2},GEMINI_RATE_LIMIT_SAFE_MODE=false,\
STORAGE_BACKEND=gcs,GCS_BUCKET_NAME=${BUCKET},REDIS_URL=${CLOUD_REDIS_URL:?Set CLOUD_REDIS_URL},WORKER_MODE=celery,\
GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.7-flash},NOX_DEV_AUTH=${DEV_AUTH},NOX_DEMO_ORG_SLUGS=${NOX_DEMO_ORG_SLUGS:-},\
FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID:-${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-}},NOX_TICKET_STORE=firestore,NOX_WEB_ORIGIN=${web_url},\
ATLASSIAN_BASE_URL=${ATLASSIAN_BASE_URL:-},ATLASSIAN_EMAIL=${ATLASSIAN_EMAIL:-},JIRA_DEFAULT_PROJECT=${JIRA_DEFAULT_PROJECT:-APEX},\
JIRA_ALLOWED_PROJECTS=${JIRA_ALLOWED_PROJECTS:-APEX},GITHUB_APP_ID=${GITHUB_APP_ID:-},GITHUB_APP_INSTALLATION_ID=${GITHUB_APP_INSTALLATION_ID:-},\
GITHUB_DEFAULT_ORG=${GITHUB_DEFAULT_ORG:-},NOX_COMMIT_SPECS=${NOX_COMMIT_SPECS:-true}"
}

service_url() { gcloud run services describe "$1" --project "$PROJECT" --region "$REGION" --format 'value(status.url)' 2>/dev/null || true; }

build_api() {
  say "Build API image"
  run gcloud builds submit apps/api --project "$PROJECT" --tag "${IMAGE_BASE}/nox-api:${TAG}"
}

common_flags=(--project "$PROJECT" --region "$REGION" --platform managed)
net_flags() {
  local vpc
  if [[ -n "${NOX_VPC_CONNECTOR:-}" ]]; then vpc="--vpc-connector=${NOX_VPC_CONNECTOR}"
  else vpc="--network=${NOX_VPC_NETWORK:-default} --subnet=${NOX_VPC_SUBNET:-default} --vpc-egress=private-ranges-only"; fi
  echo "--set-cloudsql-instances=${NOX_SQL_INSTANCE:?Set NOX_SQL_INSTANCE} ${vpc} --service-account=$(runtime_sa)"
}

deploy_api() {
  local web_url; web_url="$(service_url nox-web)"; web_url="${web_url:-${NOX_WEB_ORIGIN:-http://localhost:3000}}"
  say "Deploy nox-api"
  # shellcheck disable=SC2046
  run gcloud run deploy nox-api "${common_flags[@]}" --image "${IMAGE_BASE}/nox-api:${TAG}" --allow-unauthenticated \
    --min-instances 0 --max-instances 3 --memory 1Gi --cpu 1 --timeout 900 $(net_flags) \
    --set-env-vars "$(api_env "$web_url")" --set-secrets "$(secret_flags)"
  local api_url; api_url="$(service_url nox-api)"
  run gcloud run services update nox-api "${common_flags[@]}" --update-env-vars "WEBHOOK_BASE_URL=${api_url}"
}

deploy_worker() {
  local web_url; web_url="$(service_url nox-web)"
  say "Deploy nox-worker (Celery worker + beat; a tiny health server keeps Cloud Run happy)"
  # shellcheck disable=SC2046
  run gcloud run deploy nox-worker "${common_flags[@]}" --image "${IMAGE_BASE}/nox-api:${TAG}" --no-allow-unauthenticated \
    --min-instances 1 --max-instances 1 --no-cpu-throttling --memory 2Gi --cpu 2 $(net_flags) \
    --command sh --args="-c,python -m http.server \$PORT & exec celery -A nox_api.workers.tasks worker -B -l info --concurrency 2" \
    --set-env-vars "$(api_env "${web_url:-http://localhost:3000}")" --set-secrets "$(secret_flags)"
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
    --min-instances 0 --max-instances 2 --memory 512Mi --cpu 1
  local web_url; web_url="$(service_url nox-web)"
  run gcloud run services update nox-api "${common_flags[@]}" --update-env-vars "NOX_WEB_ORIGIN=${web_url}"
  echo "  Add ${web_url#https://} to Firebase Auth → Authorized domains."
}

case "$TARGET" in
  secrets) push_secrets ;;
  api) build_api; deploy_api ;;
  worker) build_api; deploy_worker ;;
  web) deploy_web ;;
  ai-access) grant_ai_access ;;
  all) enable_apis; grant_ai_access; build_api; deploy_api; deploy_worker; deploy_web
       api_url="$(service_url nox-api)"
       say "Done"
       echo "  Web:  $(service_url nox-web)"
       echo "  API:  ${api_url}"
       echo "  Webhooks: GitHub → ${api_url}/api/v1/webhooks/github/{push,pr}   Jira → ${api_url}/api/v1/webhooks/jira?secret=<JIRA_WEBHOOK_SECRET>"
       ;;
  *) echo "Usage: $0 [secrets|ai-access|all|api|worker|web]" >&2; exit 2 ;;
esac
