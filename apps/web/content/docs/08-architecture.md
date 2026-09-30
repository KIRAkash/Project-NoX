# Architecture

NoX is one web app, one API, one worker pool and one database. The API is the only component that talks to Postgres and to outside systems, and the web app talks only to the API. That keeps authorization, auditing and integrations in one place.

## The system

```text
  Browser (NoX web, Next.js)          Coding agent / terminal (nox CLI)
        │  Firebase ID token                 │  personal API token
        ▼                                    ▼
  ┌───────────────────────────────────────────────────────────┐
  │  NoX API (FastAPI)   auth · roles · REST · webhooks · SSE  │◀── webhooks: GitHub, Jira,
  └───────┬───────────────────────┬───────────────────────────┘    Confluence, Slack
          │                       │ jobs
          ▼                       ▼
   Postgres + pgvector      Redis (queue + live events)
   (data, versions,               │
    ADK sessions, search)         ▼
          ▲               Workers (Celery)
          └────────────── ADK agents ──▶ Gemini on the Agent Platform  (or Gemma locally)
                                  └────▶ GitHub · Jira · Confluence · Notion · Slack · Cloud Storage
```

| Component | Responsibility |
| --- | --- |
| **NoX web** (`apps/web`) | The landing experience, sign-in, the role picker, the four seat homes, the Atlas, Missions and the spec editor |
| **NoX API** (`apps/api`) | Token verification, the access matrix, REST routes, webhooks and server-sent event streams |
| **Workers** | Knowledge-base builds, syncs and rollups; spec drafting and co-writing; Git mirroring; Jira sync; the PR guard |
| **Postgres** | Organizations, applications, sources, contracts, users, memberships, missions, spec files and versions, events, ADK sessions, the search index |
| **Redis** | The job queue, and pub/sub that fans live events out to every open browser |
| **Storage** | Source snapshots, build checkpoints, uploads and spec-file images (Cloud Storage in production, local disk in development) |
| **`nox` CLI** (`packages/nox-cli`) | Missions and knowledge bases from a terminal or a coding agent; NoX Local |

## Repository layout

```text
apps/web/                 Next.js 15, React 19, TypeScript, Tailwind
  app/(product)/          the product: login, role picker, /app/… (one URL for every seat)
  components/app/         shell, panels, spec editor, verification, contract map, planets
  components/landing/     the landing experience
  content/docs/           these docs (also rendered at /docs)
apps/api/                 FastAPI, Python 3.12, uv
  nox_api/ai/             ADK agents, runtime, model config, tools, telemetry
  nox_api/agents/         the pipeline: ingestor, compiler, gatekeeper, linter, guard, anchors, contracts, rollup,
                          okf (every knowledge base as an Open Knowledge Format bundle)
  nox_api/connectors/     GitHub, Confluence, Jira, Notion, Slack, upload
  nox_api/integrations/   Atlassian and Jira write clients
  nox_api/missions/       templates, personas, drafting, co-writing, verification, Git sync, Jira sync, PRs
  nox_api/routers/        orgs, kb, missions, jira, cli, webhooks, integrations, me, sources
  nox_api/services/       search, SSE, GitOps, storage, pins, discovery, shield (Model Armor + DLP),
                          analytics (BigQuery flight recorder), scope (token → visible applications)
  nox_api/interop/        the MCP server and the A2A Ask agent
  nox_api/workers/        Celery tasks and the dispatcher
  nox_api/local.py        NoX Local's entry point
  alembic/                database migrations
packages/nox-cli/         the `nox` CLI and the /nox integrations for each coding agent
scripts/                  deploy, naming check, KB benchmark, Ask eval
```

## Data model

```text
orgs ──(parent_org_id)──▶ orgs                    teams nest to any depth
orgs ──▶ knowledge_bases (= applications) ──▶ source_monitors, kb_events, kb_pins, org_interface_contracts
users ──▶ memberships ──▶ orgs                    who can see what
users ──▶ api_tokens                              CLI sign-in (hashed)
orgs ──▶ missions ──▶ mission_apps ──▶ knowledge_bases
                 ├──▶ spec_files (one per seat) ──▶ spec_file_versions, spec_chat_messages
                 ├──▶ external_links (Jira issues, pull requests)
                 └──▶ mission_events (the timeline and audit trail)
```

Each mission also has a ticket document in **Cloud Firestore**, `missions/NOX-n`. It holds the assignee, the pipeline the mission walks (seats, build, reverse verification), the step it is on, and every move between steps. Firestore is the only store for the assignee. The pipeline fields are written whenever the stage changes, best-effort, so a Firestore outage never blocks a save or an approval. The pipeline is stored per ticket, so future mission types can walk a different path.

Every mission-side table carries its organization, so authorization and queries stay scoped. Every save of every spec file is a new row in `spec_file_versions`, recording whether a person, NoX or a verification wrote it. Schema changes go through **Alembic** migrations.

## Missions as a state machine

The server enforces the mission's stage, not the UI:

```text
Business ─▶ Product ─▶ Engineering ─▶ Developer ─▶ Build ─▶ Verifying ─▶ Done
   ▲           ▲            ▲              ▲          ▲         │
   └───────────┴────────────┴── send back / not met ──┴─────────┘
```

- Approving a file advances the stage only if the mission is waiting on that file, and skips seats whose files are already approved.
- Saving an approved file sends the mission back to that seat and marks approved files below it stale.
- **Mark as completed** is accepted only from the developer seat, only in Build.
- Verification runs developer → engineering → product → business. Only the seat whose turn it is can tick or verify, and **Verified** requires every item ticked.
- **Not met** requires a note and returns the mission to Build or to the seat that owns the problem.

## Work in the background

Everything slow runs as a job: builds, syncs, rollups, drafts, co-writer turns, Git mirroring, Jira calls and the PR guard. The API validates the request, writes the state, queues the job and returns straight away. Jobs run on **Celery** workers over Redis in production. `WORKER_MODE=in_process` runs them inside the API instead, which is handy for small deployments and development.

Each job writes events as it goes, and each event is published to Redis, so every browser watching that application or mission gets it over **server-sent events** immediately: flight-log lines, trajectory changes, the co-writer's section edits, timeline entries.

A knowledge-base build is an ADK workflow graph (cartographer, parallel page writers, link synthesis, a quality gate that loops with a reviewer, then the finish; see [Agentic AI on Google](/docs/google-ai)). The graph's nodes share one in-memory build record for the snapshot and pages, and the ADK session holds only small values such as the review round. Builds save checkpoints after every stage and every page, which is what lets **Retry** resume a failed build from the step that failed.

## Security

- **Identity**: Firebase ID tokens on every web request, verified server-side; hashed personal tokens for the CLI, issued through a browser-approved device flow.
- **Authorization**: the access matrix is checked on every route; membership decides which organizations and applications are visible; spec files are writable only by their own seat.
- **Agent scope**: tools read the caller's permissions from session state set by NoX, so model output can't widen what an agent can see. MCP and A2A callers get their scope from their token the same way.
- **Untrusted text**: NoX Shield screens sources, questions and chat with Model Armor, and knowledge-base pages with Sensitive Data Protection.
- **Webhooks**: GitHub requests are verified by HMAC signature and Jira requests by a shared secret. `WEBHOOK_SECRET` must be a strong random value of at least 16 characters, or the API won't start. (Signature checks for the Slack and Confluence webhooks are on the [roadmap](/docs/roadmap).)
- **Network**: CORS allows only the web origin, and in production the web app proxies API calls on the same origin.
- **Secrets**: kept in Secret Manager in production, never in images, and blocked from ever being committed to a knowledge base.
- **Uploads**: images are type- and size-checked and served with safe headers, and uploaded SVGs can't run scripts.

## Running it

Locally you need Docker, Node 22 and `uv`:

```bash
cp .env.example .env      # fill in keys (see Integrations)
make install
make dev                  # Postgres + Redis, then the API on :8000, a worker, and the web app on :3000
```

Other targets: `make api`, `make web`, `make worker`, `make migrate`, `make test`, `make lint`, `make seed-demo` (the Apex demo organization), `make demo-reset` (clear missions before a rehearsal), `make embed-backfill` (index existing knowledge bases for search).

## Deploying to Google Cloud

`scripts/deploy_gcp.sh` deploys the whole platform:

```bash
scripts/deploy_gcp.sh secrets      # copy secrets from .env into Secret Manager
scripts/deploy_gcp.sh ai-access    # let the runtime service account call Gemini, Model Armor, DLP and BigQuery
scripts/deploy_gcp.sh all          # enable APIs, build with Cloud Build, deploy nox-api, nox-worker, nox-web
DRY_RUN=1 scripts/deploy_gcp.sh all   # print every gcloud command instead of running it
```

It enables the services it needs, creates the Artifact Registry repository and Cloud Storage bucket, builds images with Cloud Build, and deploys three Cloud Run services: `nox-api` (public), `nox-worker` (private) and `nox-web`. They connect to Cloud SQL for PostgreSQL, where the `vector` extension is enabled by a migration, and to Memorystore for Redis over Direct VPC egress, so no serverless VPC connector is needed. `ai-access` also creates the `nox-shield` Model Armor template and the `nox_analytics` BigQuery dataset with its views, and the API is deployed with Shield in `enforce` mode and the flight recorder on.

## Quality

- **API tests** (pytest) cover auth and the access matrix, missions and verification, co-writing, personas, Jira against recorded responses, connectors, search, anchors, the linter and the guard.
- **CI** (GitHub Actions) runs the web typecheck and build, API lint (ruff) and tests, and a naming check.
- **AI evals**: the Ask eval and the build benchmark described in [Agentic AI on Google](/docs/google-ai).
- **OKF conformance**: `python -m nox_api.agents.okf check <kb-id>|--all` checks stored knowledge bases against the Open Knowledge Format, and every knowledge-base pull request reports it. `backfill` converts knowledge bases built before the format was adopted.
- **Structured logs** carry a request ID on every line, and `/healthz` and `/readyz` report liveness and readiness.
