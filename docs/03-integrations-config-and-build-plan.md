# NoX — Integrations, Config & Build Plan

Sep 24, 2026 · @Someone

Every integration in NoX is real. Keys go in one `.env`. This doc lists what each tool is used for, every key, how to set each one up, and the order to build in.

## Integrations

| Tool | NoX reads | NoX writes | Trigger in | Status |
| --- | --- | --- | --- | --- |
| Firebase Auth | User identity (Google) | — | — | Web sign-in works; API verification is new |
| GitHub (App) | Repo code, diffs, PRs | KB repos `kb-*`, KB PRs, spec files, PR comments (guard results) | Push + PR webhooks | Works (App or PAT) |
| Jira Cloud | Projects, issues, comments | **New:** create issue, link, transition, comment, sub-tasks | **New:** Jira webhook | Read-only ingest works |
| Confluence | Spaces, pages | Optional later: publish approved spec as a page | Webhook exists | Read works |
| Notion | Pages | — | Polling | Read works |
| Slack | Channel history | **New (optional):** notify on handoffs / "waiting on you" | Events webhook exists | Read works |
| Gemini | — | — | — | Works |
| Ollama (Gemma) | — | — | — | Works, optional |
| Public URL (tunnel or Cloud Run) | — | — | — | **Required for two-way Jira; see the .env steps** |
| GCS | Archives, uploads | Same | — | Works; local fallback |

## Jira in depth

Jira is the most important new integration, because it's how missions meet the tools teams already use. NoX uses Jira Cloud REST API v3, authenticated with basic auth: `email:api_token`, base64-encoded.

| Action | Endpoint | Notes |
| --- | --- | --- |
| Search to link | `GET /rest/api/3/search/jql?jql=...` | Search by key or text, scoped to allowed projects |
| Read issue | `GET /rest/api/3/issue/{key}?expand=renderedFields` | Pulled into mission context |
| Create issue | `POST /rest/api/3/issue` | Summary = mission title; description (ADF) = spec summary + link; label `nox` |
| Create sub-task | `POST /rest/api/3/issue` with `parent` | From Build task list |
| Transition | `GET/POST /rest/api/3/issue/{key}/transitions` | Uses the stage → transition map |
| Comment | `POST /rest/api/3/issue/{key}/comment` | On approvals and send-backs |
| Remote link | `POST /rest/api/3/issue/{key}/remotelink` | "Open in NoX" link on the issue |
| Webhook | Registered in Jira admin → `POST {WEBHOOK_BASE_URL}/api/v1/webhooks/jira?secret=...` | `jira:issue_updated`, `comment_created` |

**Default stage → Jira status map** (editable per project)

| NoX stage | Jira status |
| --- | --- |
| Intent / Definition / Design | To Do |
| Build | In Progress |
| Verifying | In Review |
| Done | Done |

**Loop protection:** NoX tags its own writes (property `nox.lastWrite`) and ignores webhooks caused by itself.

## The .env file

Start from `.env.example`. The groups below show what each key is for.

```bash
# ── AI ─ Gemini + optional local Gemma ────────────
AI_MODE=remote                     # remote | local | hybrid
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.7-flash
GEMMA_OLLAMA_URL=http://localhost:11434   # only for local/hybrid
GEMMA_MODEL=gemma3

# ── GitHub App ─────────────────────────────────
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY_PATH=./github-app-key.pem
GITHUB_APP_SLUG=
GITHUB_DEFAULT_ORG=

# ── Infra  ──────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/nox
REDIS_URL=redis://localhost:6379/0
GCS_BUCKET_NAME=
GOOGLE_APPLICATION_CREDENTIALS=./gcp-key.json
WORKER_MODE=auto
SOURCE_MONITOR_MODE=webhook
WEBHOOK_SECRET=                    # required, no default

# ── Public URL (needed for two-way Jira + GitHub webhooks) ────
# 1. Run the API:            make start-all   (API on :8000)
# 2. Open a tunnel:          cloudflared tunnel --url http://localhost:8000
#                            (or: ngrok http 8000)
# 3. Paste the https URL it prints below, then restart the API.
# 4. On Cloud Run, use the nox-api service URL instead; no tunnel.
WEBHOOK_BASE_URL=https://<your-tunnel>.trycloudflare.com

# ── Atlassian: Jira + Confluence  ──
ATLASSIAN_BASE_URL=https://yourco.atlassian.net
NOTION_PARENT_PAGE_ID=                            # parent page of the demo Notion pages
ATLASSIAN_EMAIL=
JIRA_API_TOKEN=
CONFLUENCE_API_TOKEN=              # usually the same token
JIRA_WEBHOOK_SECRET=               # any random string; also used in the Jira webhook URL
JIRA_DEFAULT_PROJECT=APEX
JIRA_ALLOWED_PROJECTS=APEX      # comma-separated

# ── Other sources (optional) ─────────────────────
NOTION_API_TOKEN=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=

# ── Firebase ──────────────
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-admin.json

# ── NoX ─────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:8000
NOX_WEB_ORIGIN=http://localhost:3000   # CORS allow-list
NOX_COMMIT_SPECS=true                  # commit spec files to the app's KB repo
```

Not needed: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GITHUB_CLIENT_ID/SECRET` (sign-in is Firebase only). Keep `GITHUB_APP_TOKEN` only as a PAT fallback.

## Setup checklist

**Gemini on the Agent Platform (Vertex AI)**

- [ ] `gcloud services enable aiplatform.googleapis.com` (`deploy_gcp.sh all` also does it).
- [ ] Grant the runtime service account `roles/aiplatform.user`: `scripts/deploy_gcp.sh ai-access`. For local runs
  as the `gcp-key.json` service account, grant it the same role, then drop `NOX_AI_BACKEND=api_key` from `.env`.
- [ ] Cloud SQL: `CREATE EXTENSION vector` runs in migration 0005 (Cloud SQL Postgres ships pgvector), then
  `make embed-backfill`.

**NoX Local (Gemma)**

- [ ] Install Ollama and `ollama pull gemma4:12b` (about 8 GB, fits 16 GB RAM; `gemma4:e4b` for smaller machines via `--model`).
- [ ] The CLI runs the engine with `uv run --extra local` (LiteLLM). Set `NOX_ENGINE_DIR` if the CLI isn't run from this repo.

**Firebase**

- [ ] Create a Firebase project (or use your GCP project); add the NoX web origin to Authorized domains.
- [ ] Enable the Google sign-in provider.
- [ ] Create a service account key with the Firebase Admin role → `FIREBASE_SERVICE_ACCOUNT_PATH`.

**GitHub App** (`nox-gitops`)

- [ ] Permissions: Contents RW, Pull requests RW, Webhooks RW, Metadata R, Administration RW (to create `kb-*` repos).
- [ ] Install on the demo org; note the installation id.
- [ ] Webhook URL → `{WEBHOOK_BASE_URL}/api/v1/webhooks/github/*`, secret = `WEBHOOK_SECRET`, events: push, pull\_request.

**Atlassian (Jira + Confluence)**

- [ ] Create an API token at id.atlassian.com for a bot/service user → `JIRA_API_TOKEN` (+ `CONFLUENCE_API_TOKEN`).
- [ ] Set `ATLASSIAN_EMAIL` and `ATLASSIAN_BASE_URL`.
- [ ] Create a Jira project `APEX` (Scrum, with To Do / In Progress / In Review / Done).
- [ ] Jira admin → System → Webhooks → add `{WEBHOOK_BASE_URL}/api/v1/webhooks/jira?secret=...`, events: issue updated, comment created, JQL `labels = nox`.

**Notion / Slack** (optional)

- [ ] Notion internal integration, shared with the pages to ingest.
- [ ] Slack app: `channels:history`, `channels:read`, `chat:write` (new, for notifications); events URL → `/api/v1/webhooks/slack/events`.

**Local tunnel**

- [ ] `cloudflared tunnel` or `ngrok http 8000` → set `WEBHOOK_BASE_URL`. Or `SOURCE_MONITOR_MODE=polling` and skip GitHub webhooks (Jira webhooks still need a public URL).

## Demo data: the Apex Trading platform

The demo onboards the fictional **Apex Trading & Settlement Platform**: five codebases, each with real linked sources already seeded on your Atlassian, Notion and Slack accounts. The NoX repo gets its own copy under `demo/` (codebases + mock sources + the app-to-source map), and each codebase is pushed to its own GitHub repo in the demo org.

| Application | Stack | Jira (`APEX`) | Confluence (space `APEX`) | Notion | Other |
| --- | --- | --- | --- | --- | --- |
| order-matching-engine | Go | APEX-28 … APEX-31 | ADR-001, Failover runbook | PRD v2.4 §3.1–3.2 | Slack thread 5, space overview file |
| trade-settlement-system | Java / Spring Boot | APEX-32 … APEX-34 | ADR-002, ADR-003 | Data dictionary (TradeExecution, LedgerEntry) | Slack threads 2 + 4, AsyncAPI upload |
| market-data-gateway | TypeScript / Node / gRPC | APEX-35, APEX-36 | ADR-004 | Data dictionary (MarketTick) | Slack thread 1, OpenAPI upload |
| compliance-surveillance-monitor | Python / FastAPI | APEX-37, APEX-38 | ADR-005 | Security & compliance matrix | Slack thread 3 |
| mini-auth-service | — | — | ADR-006 (HMAC auth) | — | Small, good for a live onboarding |

- **Jira:** project `APEX` on your existing Atlassian site. Missions create new issues there with label `nox`.
- **Org hierarchy for the demo:** Apex Holdings (org) → Trading (division: matching engine, market data) · Post-Trade (division: settlement, compliance) · Platform (team: auth).
- **Re-seeding:** `python -m nox_api.demo.seed_sources` recreates the Jira issues, Confluence pages, Notion pages and Slack threads if the sandbox is reset.

## Build plan

The step-by-step, checkpointed plan now lives in the repo at `docs/IMPLEMENTATION_PLAN.md`, so progress can be ticked off as code lands and picked up again after a pause.

## Decisions (integrations)

**Decided (24 Sep)**

- [x] **I2. Jira sync:** two-way (status, assignee, comments), which needs a public URL.
- [x] **I1. Jira project:** `APEX` on the team's Atlassian site, seeded by `nox_api.demo.seed_sources`.
- [x] **I6. Demo repos:** the five Apex codebases, pushed to GitHub, with their seeded Jira, Confluence, Notion, Slack and upload sources.
- [x] **I3. Sources on stage:** GitHub, Jira, Confluence, Notion, Slack and file uploads, since the demo data covers all six.

**Still open**

- [ ] **I4. Credentials:** global `.env` for the hackathon, per-org later *(default)*.
- [ ] **I5. Slack:** add "waiting on you" notifications, or read-only source only? *(default: read-only, notifications as a stretch goal)*
