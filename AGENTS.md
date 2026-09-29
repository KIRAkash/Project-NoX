# AGENTS.md — working on NoX

NoX is built in Google Antigravity for the [AI Builder Cup](https://aibuildercup.com) hackathon. This file is for coding agents (Antigravity reads it first) and new contributors. It explains what NoX is, how it is designed, where each part lives, and the conventions to keep. The product documentation for users is in [`apps/web/content/docs/`](apps/web/content/docs/) and is served at `/docs` in the web app.

## What NoX is

NoX is an agentic platform that takes an enterprise change from a business user's first sentence to verified, shipped code. It has two halves:

- **Atlas** keeps a live map of the enterprise: organizations → teams → sub-teams → applications. For every application it builds a code wiki (a knowledge base in its own Git repository) from code, Confluence, Jira, Notion, Slack and uploads, and keeps it in sync on every push. Every knowledge base is an **Open Knowledge Format (OKF 0.2)** bundle, Google Cloud's open specification for agent-readable knowledge (https://github.com/GoogleCloudPlatform/open-knowledge-format), extended by NoX with cross-application `[[kb:app/page]]` links and source anchors. Contracts between applications form an organization-wide contract map.
- **Missions** carry one change through four seats (business user, product owner, engineering lead, developer). Each seat writes its own spec file with NoX as co-author. A coding agent builds it with `/nox NOX-n`, and the seats verify it in reverse order before it is done.

The AI is a team of **Google ADK** agents on **Gemini** (served from the Gemini Enterprise Agent Platform), with **Gemma** via Ollama for NoX Local. NoX runs on Google Cloud: Cloud Run, Cloud SQL with pgvector, Memorystore, Cloud Storage, Secret Manager, and Firebase Authentication.

## Design principles

These shape every decision in the codebase. Keep them.

1. **People own decisions.** Agents draft, refine, look up, check and cite. Only people approve, verify or send back. Never add a path where AI approves anything.
2. **Grounded or it doesn't ship.** Everything NoX writes cites a source: `[[kb:app/page]]`, an upstream spec file, `path:line`, or a Jira field. Unknowns become open questions, never guesses.
3. **Scope is set by NoX, never by the model.** Tools read the caller's visible applications and open file from ADK session state that NoX fills from memberships before the run. A prompt must never be able to widen access.
4. **One human per file.** Each spec file has exactly one editing seat, so there is no multi-user merge. Other seats read it locked.
5. **The database is authoritative; Git is the mirror.** Spec files and versions live in Postgres. Git commits are best-effort and never block a save.
6. **Everything slow is a job.** The API validates, writes state, queues work and streams progress over SSE. It never waits on a model in the request path (except streamed Ask).
7. **Knowledge bases are OKF bundles.** Every commit to a knowledge-base repository goes through `agents/okf.py` (via `runner._as_okf`): YAML frontmatter with a `type` on every page, an `index.md` per folder, a date-grouped `log.md`. Never commit KB files around it, and keep readers that want prose on `okf.strip()` / `okf.prose()`.
8. **Write for the reader.** Each seat has a persona (`missions/personas.py`). A business user's file never mentions endpoints or services.

## Repository map

```text
apps/web/                         Next.js 15, React 19, TypeScript, Tailwind 3
  app/page.tsx                    landing experience (three.js / GSAP)
  app/docs/                       product docs, rendered from content/docs/*.md
  app/(product)/login, choose-role, cli/authorize/[code]
  app/(product)/app/[role]/       the product, scoped to the acting seat
    page.tsx                      Mission control (waiting / in flight / coming back)
    atlas/                        org canvas, onboarding (new/), app page (apps/[kbId]/), connectors/
    missions/                     list, new/, [key]/ (tabs per spec file, Jira & PRs panel, timeline)
  components/app/                 shell, ui (Panel, PageHeader, KbStatusChip, FEED_LIST…), spec-editor,
                                  verify-panel, contract-map, markdown, planet(-character)
  lib/app/                        api client, auth (Firebase), roles, nav, types, SSE stream, useApi
  lib/docs.ts                     docs chapter manifest
  content/docs/                   the user docs (Markdown, one file per chapter)
apps/api/nox_api/                 FastAPI, Python 3.12, SQLAlchemy 2 async, Alembic, Celery
  main.py                         app, routers, CORS, request-id logging, /healthz /readyz
  core/                           config (settings + required-secret validation), auth (Firebase, roles, Cap matrix)
  db/                             models, schemas
  ai/                             ★ the agent layer (see below)
  agents/                         pipeline: ingestor, compiler, gatekeeper, anchors, linter, guard, digest,
                                  contracts, rollup, coverage_diff, runner (Flow A/B/C), llm_client,
                                  okf (Open Knowledge Format: frontmatter, folder indexes, log, conformance)
  connectors/                     github, confluence, jira, notion, slack, file upload (read side)
  integrations/                   atlassian + jira write client (typed errors, retries)
  missions/                       templates, personas, drafting, cowrite, verification, gitsync, jira_sync, prs, context, events
  routers/                        orgs, kb, missions, jira, cli, webhooks, integrations, sources, me
  services/                       search (hybrid), sse, gitops, storage (local/GCS), pins, discovery
  workers/                        Celery tasks + dispatcher (celery | in_process | auto)
  local.py                        NoX Local entry point (Gemma)
  demo/                           seed the Apex demo org, reset missions, push demo repos
apps/api/alembic/                 migrations (0005 adds pgvector chunks for search)
apps/api/tests/                   pytest; tests/ai_fakes.py fakes ADK/Gemini for agent tests
packages/nox-cli/                 `nox` CLI (bin/nox.mjs, no deps) + integrations/ for antigravity, cursor, codex, copilot, claude
video/                            Remotion intro film (standalone npm project, not a workspace): scenes/, a synthesised
                                  soundtrack (scripts/soundtrack.mjs); `npm run dev` / `npm run render`
scripts/                          deploy_gcp.sh, bench_kb.py, eval_ask.py
docs/                             design docs and IMPLEMENTATION_PLAN.md (history and decisions)
demo/                             the Apex demo codebases and mock sources
```

## The AI layer (`apps/api/nox_api/ai/`)

| File | Role |
| --- | --- |
| `config.py` | `NOX_AI_BACKEND` → `enterprise` (Agent Platform via service account), `api_key` (Gemini Developer API) or `local` (Gemma via Ollama/LiteLLM). Tiers `FAST` / `DEFAULT` / `DEEP` map to `NOX_MODEL_FAST` / `GEMINI_MODEL` / `NOX_MODEL_DEEP`. ADK `FallbackModel` to `GEMINI_BACKUP_MODEL`; retry options on every Gemini model. `Gemma3Ollama` for Gemma 3. |
| `runtime.py` | The only place that touches ADK runners. `run()` for one-shot, `stream()` → step / delta / done events for SSE. `InMemorySessionService` for pipelines, `DatabaseSessionService` in Postgres schema `adk` for Ask and chat. |
| `structured.py` | One-shot agents constrained to a Pydantic schema (`schemas.py`: `ArchitectureMap`, `GatekeeperDecision`, `PagePatch`, `CoverageDiff`, `RollupResult`). |
| `telemetry.py` | `usage_scope()` sums calls, tokens (input, cached, output, thinking), tool calls and time across all agents in one unit of work; logs one structured line. |
| `tools/knowledge.py` | `search_kb`, `read_kb_page`, `list_pages`, `find_interfaces`, `grep_source`, `read_source_file`, `get_jira_issue`. Scope comes from `ToolContext.state`. |
| `tools/spec.py` | Section-level spec edits: `read_spec_file`, `replace_section`, `insert_section`, `append_to_section`, `add_open_question`. Each edit broadcasts `nox.edit.partial`; author headings can't be removed. |
| `agents/kb_builder.py` | Cartographer (DEEP, one call, whole snapshot, images as parts) → page writers in parallel (shared `static_instruction` prefix for implicit caching; first page warms the cache) → reviewer (rewrites only lint failures). Local mode: chunk summaries, sequential writers. |
| `agents/ask.py` | Streaming Ask agent with the knowledge tools; answers pitched per seat; citations collected from pages read. |
| `agents/cowriter.py` | Co-writer (edit turns via spec tools) and drafter (whole-file first drafts). |

Other model calls: the gatekeeper (FAST), patch compiler, coverage diff and rollup (DEEP) go through `structured.ask`. The ingestor's per-file summaries and the `NOX_KB_BUILDER=classic` path use `agents/llm_client.py` (`google-genai` directly).

Search (`services/search.py`): pages chunked at `##`, embedded with `gemini-embedding-2` (768 dims, document/query task types) into pgvector, fused with Postgres full-text by reciprocal rank fusion; only changed chunks are re-embedded; full-text-only fallback.

## Key flows, and where they live

| Flow | Entry point | Core logic |
| --- | --- | --- |
| Onboard app → KB (Flow A) | `POST /api/v1/orgs/{id}/apps` | `agents/runner.py` → ingest → `ai/agents/kb_builder.py` → lint → pins → OKF (`agents/okf.py`) → secret gate → `services/gitops.py` PR; contracts in `agents/contracts.py`; index in `services/search.py` |
| Sync on push (Flow B) | `routers/webhooks.py` (`/github/push`) or polling | anchors → gatekeeper → patch compiler → patch PR; pins re-applied (`services/pins.py`) |
| Org rollup (Flow C) | KB PR merged with ≥2 apps published | `agents/rollup.py` → `kb-org-<slug>` |
| Ask | `POST /api/v1/kb/{id}/ask` (SSE) | `ai/agents/ask.py` |
| Create mission | `POST /api/v1/missions` | `routers/missions.py`; drafts via `missions/drafting.py` + `ai/agents/cowriter.py` |
| Save / approve / send back | `PUT …/files/{role}`, `POST …/approve`, `POST …/send-back` | `routers/missions.py` (stage machine, stale marking); `missions/gitsync.py`; `missions/jira_sync.py` |
| Refine / chat | `POST …/refine`, `POST …/chat` | `missions/cowrite.py` → co-writer agent; one version per turn; `POST …/revert` undoes |
| Complete / verify | `POST …/complete`, `PUT …/verification`, `POST …/verify` | `missions/verification.py` (checklist parse/write-back, `VERIFY_ORDER`) |
| Jira | `routers/jira.py` | `missions/jira_sync.py` (status map, `[NoX]` tag + echo window loop protection) |
| PR guard | `/github/pr` webhook or `nox pr` | `missions/prs.py` + `agents/guard.py` |
| CLI | `routers/cli.py` (device flow, context, search, read, kb push) | `packages/nox-cli/bin/nox.mjs` |
| NoX Local | `nox kb build|sync|push|watch` | `nox_api/local.py` with `NOX_AI_BACKEND=local` |

Mission stages: `business → product → engineering → developer → build → verifying → done`. Server-enforced in `routers/missions.py`; the UI only reflects it.

Access: `core/auth.py` `ACCESS` maps each seat to capabilities (`Cap`). Use `Depends(require(Cap.X))` on routes, `visible_org_ids()` for org scope, and `own_file()` for spec-file writes.

## Running and checking

```bash
cp .env.example .env && make install
make dev            # Postgres + Redis, API :8000, worker, web :3000
make test           # API pytest + nox CLI tests
make lint           # ruff + web typecheck
make typecheck      # web tsc only
npm run build:web
```

- Locally the API runs on port 8010 (8000 and 3000 are often taken) and the web app on 3000. The `nox` CLI defaults to `http://localhost:8010`.
- Two dev servers must not share `apps/web/.next`: starting a second `next dev` in the same folder corrupts the first one's build cache. Reuse the running server, or stop it and clear `.next`.
- `WORKER_MODE=in_process` runs jobs inside the API (no Celery needed). `NOX_DEV_AUTH=true` enables the one-field local sign-in.
- `uv run python -m nox_api.agents.okf check <kb-id>|--all` reports Open Knowledge Format conformance of stored knowledge bases; `backfill` converts ones built before OKF (stored copy only, no Git writes).
- AI evals cost a few cents: `make eval` (Ask golden questions), `scripts/bench_kb.py <kb-id>` (build benchmark).

## Conventions

**Naming.** Knowledge-base repositories are `kb-<app>` and `kb-org-<slug>`; mission branches are `nox/NOX-n`; mission folders are `missions/NOX-n-<slug>/0N-<role>.md`.

**Python.** Async everywhere in the API. Module docstrings explain the *why* and the shape of the flow; keep them current. Typed Pydantic models at every boundary. Ruff clean. New tables get an Alembic migration and carry `org_id` if they're mission- or org-scoped. Record mission changes with `missions/events.record()` so the timeline, SSE and Jira stay in step.

**Agents.** New AI work is an ADK agent or a `structured.ask` call, never a raw prompt string sent from a router. Ask for a tier, not a model name. Tools take `tool_context` and read scope from state. Wrap each unit of work in `telemetry.usage_scope()`. Add a fake to `tests/ai_fakes.py` and a test.

**Web.** Client components fetch through `useApi` / `api()` (they attach the Firebase token and `X-Nox-Role`). Use the shared `Panel`, `PageHeader`, `EmptyState` and `KbStatusChip`. Colours come from Tailwind tokens (`void`, `deck`, `ink-*`, `hairline`, `nox`) and the acting seat's hue via the CSS variable `--role`. Long feeds use `FEED_LIST`. Everything must work at phone width with no horizontal page scroll.

**Words.** UI copy, docs and commit messages use plain, short sentences. The space vocabulary is deliberate and consistent: *In the Void → Scanning Nebula → Compiling Stars → Awaiting Launch → In Orbit* for knowledge bases, *missions*, *trajectory*, *flight log*.

**Docs.** When you change user-visible behaviour, update the matching chapter in `apps/web/content/docs/` (the manifest is `apps/web/lib/docs.ts`). Design history and decisions stay in `docs/`.

## Before you finish a change

- `make test` and `make lint` pass.
- New routes have an auth dependency and a test for the forbidden case.
- Anything user-visible was checked in the browser, including at phone width.
- The docs chapter for the feature still tells the truth.
