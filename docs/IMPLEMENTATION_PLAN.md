# NoX — Implementation Plan

The build order for Project NoX, split into checkpoints. Each checkpoint ends in something that runs and can be demoed, so work can stop after any of them and pick up cleanly later.

**How to use this file**

- Tick tasks (`- [x]`) as they land, in the same commit as the code.
- When a checkpoint's "Done when" checks all pass, set its row in the status table to `done` and add a line to the Progress log.
- If work stops mid-checkpoint, write where you stopped under that checkpoint's **Resume notes**.
- Companion docs: [01-product-journeys-v2.md](01-product-journeys-v2.md) (what users see), [02-architecture-and-tech-stack.md](02-architecture-and-tech-stack.md) (how it's built), [03-integrations-config-and-build-plan.md](03-integrations-config-and-build-plan.md) (keys, Jira, demo data).

**Ground rules**

- NoX is one monorepo: web app, API with the knowledge-base engine, CLI and demo data.
- Built for the [AI Builder Cup](https://aibuildercup.com) hackathon, with Google Antigravity as the main coding environment.
- AI: Gemini, with Gemma via Ollama optional. No other provider.
- Every checkpoint keeps `make dev` working end to end.

---

## Status

| # | Checkpoint | Status | Depends on |
| --- | --- | --- | --- |
| CP0 | Repo foundations | done | — |
| CP1 | Knowledge-base engine (API + agents + workers) | done | CP0 |
| CP2 | Harden and improve the engine | code done — waiting on new Atlassian token + GitHub App | CP1 |
| CP3 | Auth + role picker | done | CP1 |
| CP4 | App shell + planetary design system | done | CP3 |
| CP5 | Atlas: orgs, onboarding, knowledge bases | done — merge the open KB PRs to reach In Orbit | CP2, CP4 |
| CP6 | Demo data: Apex platform onboarded | local part done — waiting on token + push approval | CP5 |
| CP7 | Missions + per-role spec files | done | CP4, CP6 |
| CP8 | Spec editor: NoX cursor, chat, Git save | done | CP7 |
| CP9 | Jira two-way sync | code done — live check waiting on new Atlassian token + public URL | CP7 |
| CP10 | `nox` CLI + `/nox` skill | code done — live PR guard needs the demo repos pushed | CP8 |
| CP11 | Manual reverse verification | done (PR hints wait on CP10) | CP8 |
| CP12 | Deploy, polish, demo rehearsal | scripts + polish done — deploy and rehearsals need approval and the token | all |
| CP13 | AI upgrade: ADK agents on Agent Platform, hybrid search, streaming Ask, section co-writer, multi-agent KB builder, NoX Local | code done — live Agent Platform check needs `roles/aiplatform.user`; pgvector on Cloud SQL at deploy | CP5, CP8, CP10 |
| CP14 | Connected, shielded, measured: MCP + A2A, Model Armor + DLP, BigQuery flight recorder ([plan](plans/CP14-tier1-connected-shielded-measured.md)) | code done; live checks need the deploy | CP12, CP13 |
| CP15 | Show NoX: screenshots, screen recordings, video and voice, grounded in the KB ([plan](plans/CP15-show-nox-multimodal-capture.md)) | planned | CP14 (Shield) |
| CP16 | KB builder as an ADK workflow + explicit context caching ([plan](plans/CP16-adk-workflow-kb-builder.md)) | code done — bench compare and live checks need Gemini and the deploy | CP13 |

Critical path: CP0 → CP1 → CP3 → CP4 → CP5 → CP6 → CP7 → CP8 → CP11 → CP12. CP2, CP9 and CP10 can run alongside the others once their dependencies are done.

---

## CP0 — Repo foundations

Turn the landing-page repo into the NoX monorepo without breaking the landing page.

- [x] `git init`; first commit of the landing page as it is today
- [x] Move the Next.js app into `apps/web/` (app, components, lib, public, configs); root `package.json` becomes an npm workspace
- [x] Create empty `apps/api/` (Python 3.12, `pyproject.toml`, package `nox_api`), `packages/nox-cli/`, `scripts/`, `demo/`
- [x] `docker-compose.yml`: postgres 16, redis 7, ollama (optional profile), api, worker, beat, web
- [x] `Makefile`: `make dev`, `make api`, `make web`, `make worker`, `make migrate`, `make seed-demo`, `make test`, `make lint`
- [x] `.env.example` with every key from doc 03 (NoX names only); `.gitignore` covers `.env`, `*.pem`, service-account JSON
- [x] CI (GitHub Actions): web lint + typecheck + build, api ruff + pytest
- [x] README: what NoX is, how to run it

**Done when:** `make dev` serves the landing page from `apps/web` at :3000 and a hello-world FastAPI at :8000, and CI is green.

**Resume notes:** Done 2026-09-24. Local Postgres/Redis come from Homebrew (`make infra` skips Docker when ports 5432/6379 are open); DB `nox` owned by the local user. CI workflow is written but unverified until the repo has a GitHub remote. Preview configs use auto ports because 8000/3000 are often taken.

---

## CP1 — Knowledge-base engine

Build the knowledge-base engine as `nox_api`: ingest sources, compile a code wiki, keep it in sync, roll it up per org.

- [x] `nox_api/core/config.py`: pydantic settings with NoX env names (`ATLASSIAN_EMAIL`, `ATLASSIAN_BASE_URL`, etc.)
- [x] `nox_api/db/`: async SQLAlchemy engine; models `orgs`, `knowledge_bases`, `kb_events`, `source_monitors`, `org_kbs`, `org_interface_contracts`
- [x] Alembic set up; migration `0001_engine_baseline` (replaces `create_all`)
- [x] LLM client (kept at `nox_api/agents/llm_client.py`, not a separate `llm/` package) (Gemini + Gemma, `AI_MODE` remote/local/hybrid, semaphore, retries, backup model)
- [x] `nox_api/agents/`: ingestor, compiler, gatekeeper, rollup, runner, contracts, anchors, linter, guard, digest, coverage_diff
- [x] `nox_api/connectors/`: base + github, confluence, jira (read), notion, slack, file upload
- [x] `nox_api/services/`: gitops (GitHub App + PAT fallback), storage (GCS + local fallback), SSE, discovery
- [x] `nox_api/workers/`: Celery app, tasks (generation, add-source, gatekeeper, rollup, poll), dispatcher with in-process mode
- [x] `nox_api/routers/`: `orgs`, `kb`, `webhooks` under `/api/v1`
- [x] Naming: KB repos `kb-<app>` / `kb-org-<slug>`, brief file `.nox/brief.md`, bot slug `nox-gitops`, log prefixes
- [x] Tests: anchors, digest, guard, cross-KB mesh, GitHub App auth

**Done when:** `POST /api/v1/orgs/{id}/apps` with one demo GitHub repo runs Flow A to a KB PR on GitHub, the SSE stream shows each stage, and pytest is green.

**Resume notes:** Done 2026-09-24. Verified live: org `apex` + app `mini-auth-service` ran Flow A through Celery to PR #1 on `kb-apex-mini-auth-service`, and the SSE stream delivered every stage (pipeline_started → 12× page_compiled → pr_opened).
- Bugs fixed along the way (regression tests in `tests/test_engine_regressions.py`): Flow C rollup crashed on missing imports; `/kb/resolve` was shadowed by `/kb/{kb_id}`; SSE only worked in-process (now Redis pub/sub) and yielded malformed events; `routers/kb.py` used an undefined `logger`; discovery reported `openkb-<app>` while repos are `kb-<org>-<app>`.
- KB repos are named `kb-<org>-<app>` (the docs say `kb-<app>`; code wins, docs to be aligned).
- Dropped unused deps (google-adk, python-jose, passlib, aiofiles). Unused JWT stub removed from `core/security.py`.

---

## CP2 — Harden and improve the engine

Fix the known gaps and make the improvements worth doing while the code is fresh.

- [x] Atlassian auth: build Basic auth from `ATLASSIAN_EMAIL:token` in the Jira and Confluence connectors, with base URL from env
- [x] CORS limited to `NOX_WEB_ORIGIN`; `WEBHOOK_SECRET` required at startup, no default
- [x] `JiraClient` (write): search, get, create issue/sub-task, transitions, comment, remote link, with retries and typed errors
- [ ] GitHub App `nox-gitops` created; install on the demo org; permissions per doc 03 — **needs you** (creating a GitHub App is a manual step in GitHub settings). The existing App works meanwhile; its slug is only an `.env` value.
- [x] Gatekeeper fast path: check line-range anchors before calling the LLM (improvement)
- [x] Linter runs before every KB PR; PR body lists lint results (improvement)
- [x] `GET /api/v1/integrations/status`: which keys are set and whether each connector's live check passes
- [x] Structured logging with request id; `/healthz` and `/readyz`
- [x] Tests: connector auth headers, JiraClient against recorded responses, CORS, required-secret failure

**Done when:** `integrations/status` shows green for GitHub, Jira, Confluence, Notion and Gemini with the real `.env`, and a Jira issue can be created and transitioned from a pytest integration test (marked `live`).

**Resume notes:** Code complete 2026-09-24; two items wait on you.
- `integrations/status` live result: GitHub ✅, Notion ✅, Slack ✅, Gemini ✅, **Jira ❌ 401, Confluence ❌ 404**. The Atlassian API token is rejected (tested with and without the email), so it has expired or been revoked. Create a new one at id.atlassian.com → Security → API tokens, put it in `JIRA_API_TOKEN` and `CONFLUENCE_API_TOKEN`, then run `make test-live` to finish this checkpoint's done-when.
- Bugs found and fixed: Jira connector used `/rest/api/2/search`, which Atlassian now answers with **410 Gone** (moved to `/rest/api/3/search/jql` + `nextPageToken`, descriptions parsed from ADF); Confluence v2 pages call passed the space *key* where the API needs the numeric *id*; the gatekeeper anchor fast path never ran because the runner didn't pass KB pages.
- New: `nox_api/integrations/{atlassian,jira}.py` (typed errors, retries with Retry-After), secret gate on every KB commit, lint summary in Flow A + rollup PR bodies, `X-Request-ID` logging, `/readyz`, startup check for `WEBHOOK_SECRET`. Upstream source auth failures now return 502 (401/403 are reserved for NoX's own auth in CP3).

---

## CP3 — Auth + role picker

Real sign-in, a free role picker, and server-side enforcement of the picked role.

- [x] Web: Firebase client (`apps/web/lib/firebase.ts`), Google sign-in on `/login` in the NoX visual style
- [x] API: `firebase-admin` token verification → `current_user`; upsert `users`
- [x] Migration `0002_identity`: `users` (with `last_role`), `memberships`, `api_tokens`
- [x] `GET /me`, `PUT /me/role`; `X-Nox-Role` header accepted only for the four roles
- [x] `require(capability)` dependency implementing the access matrix (doc 01), applied to every router
- [x] `/choose-role` page: heading, sub-line "You're picking a role only to try the platform…", four large planet icons, role name + one-to-two line description under each, returning-user "Continue as …"
- [x] Top-bar role chip reopens the picker; the choice persists across reloads
- [x] Route guards in web: signed-out → `/login?next=`; no role → `/choose-role`
- [x] Tests: 401 without a token, 403 for a Business user on Atlas routes, role switch round-trip

**Done when:** sign in with Google, pick Business user, and the Atlas API returns 403. Switch to Developer and the same call succeeds.

**Resume notes:** Done 2026-09-24. Verified in the browser: dev sign-in → role picker (4 planets, 2×2 on phones) → Developer → role home showing the Apex org via demo auto-join. 56 API tests (auth: 401/403/409, org visibility, sub-org inheritance, Firebase token signature/audience/issuer/expiry).
- Firebase ID tokens are verified locally against Google's certs (`core/auth.py`); no service-account file needed.
- `NOX_DEV_AUTH=true` + `NEXT_PUBLIC_NOX_DEV_AUTH=true` (set in the local `.env`) enable a dev sign-in box so the app can be exercised without Google; refused at startup on Cloud Run.
- `NOX_DEMO_ORG_SLUGS=apex`: new users auto-join the demo org.
- The web app proxies `/api/v1/*` to `NOX_API_URL` (same origin, no CORS). Locally the API runs on 8010 because 8000 is often taken.
- Fixed on the way: migration `0001` was empty (a `create_all` had already built the tables when it was autogenerated) — regenerated against an empty DB; CI now does upgrade → downgrade → upgrade → `alembic check`. `.env` no longer overrides real environment variables.

---

## CP4 — App shell + planetary design system

The frame every role's pages sit in, using the landing page's look.

- [x] Shared tokens from the landing (`tailwind.config.ts`, fonts, starfield) available to app routes; shadcn primitives restyled to NoX tokens
- [x] Layout: left orbit-rail sidebar (Mission control, Missions, Atlas, Artifacts, Activity), top bar (search, role chip, notifications, avatar menu)
- [x] Role colours applied consistently (Business gold, Product violet, Engineering teal, Developer blue)
- [x] Mission control per role: empty-state versions of "Waiting on you", "In flight", "Coming back to you", with the primary action button per role
- [x] Atlas hidden for the Business user (sidebar + routes)
- [x] Shared components: planet avatar, orbit progress arc, status chips for KB lifecycle (In the Void → In Orbit), toast, empty state
- [x] Reduced-motion support everywhere (reuse `lib/motion.ts`)

**Done when:** each of the four roles lands on its own Mission control with the right sidebar and actions, on desktop and at 375px.

**Resume notes:** Done 2026-09-24. Verified in the browser as Developer and Business user: shell, demo ribbon, bottom nav on narrow widths, ⌘K palette, URL role correction, Atlas hidden and refused for Business. Mission control already shows live data: onboarded apps with KB status chips and PR links, and connector health for the Engineering lead.
- Section pages (Missions, Atlas, Artifacts, Activity) are headers + empty states; CP5 fills Atlas, CP7 Missions.
- Don't run `npm run build:web` while the dev server is up: both use `apps/web/.next` and the build breaks the dev server (fix: stop, `rm -rf apps/web/.next`, restart).

---

## CP5 — Atlas: orgs, onboarding, knowledge bases

The configuration and knowledge-base half, in the NoX UI.

- [x] Org tree page: nested orgs as orbits, create org / sub-org, invite member (email)
- [x] Onboard application wizard: basics → sources (GitHub, Confluence, Jira, Notion, Slack, upload) with live validation per source → settings (AI mode, sync mode, KB repo name) → Launch
- [x] Pipeline view: live SSE trajectory In the Void → Scanning Nebula → Compiling Stars → Awaiting Launch → In Orbit, event feed, retry/restart
- [x] KB explorer: file tree, Markdown render with `[[wikilinks]]` and cross-KB links, KB chat panel
- [x] Contract map across apps (xyflow), guardrails list per app
- [x] App page: sources, sync status, add source, sync now, lint, digest, pending KB PRs
- [x] Settings → Connectors: status from `integrations/status`
- [x] Improvement: pin a human correction on a KB page (stored, survives recompilation)

**Done when:** a Developer onboards a real repo with two sources entirely from the UI, watches it reach Awaiting Launch, merges the PR on GitHub and sees In Orbit, then browses and chats with the KB.

**Resume notes:** Built and verified 2026-09-24, except the final merge, which is yours to do.
- Verified in the browser: created team *Trading* under Apex (Engineering lead); onboarded `market-data-gateway` from the wizard with GitHub + Notion, both validated live; watched the trajectory stream to Awaiting Launch → PR `kb-trading-market-data-gateway#1` (quality-gate summary in the body). Explorer (16–22 pages, wikilinks, cross-KB links), pinning, and Ask the KB (Gemini, grounded answer) all work on `mini-auth-service`.
- **To finish:** merge the two open KB PRs on GitHub, then press *Check PR status* on each app → In Orbit.
- Added: `POST /sources/validate`, `GET /orgs/{id}/members|map`, `POST/DELETE /orgs/{id}/members`, pins API (`kb_pins`, re-applied before every KB commit), org invites (`org_invites`, claimed on sign-in). Migration 0003.
- Fixed: SSE was gzipped and buffered by the web proxy (API now sends `Cache-Control: no-transform`); the KB tree/file endpoints read the empty `main` branch before the PR merged (now serve the compiled wiki until published); `path.lstrip("./")` mangled `.nox/brief.md`.
- Contract map is an SVG orbit (no xyflow dependency needed).

---

## CP6 — Demo data: Apex platform onboarded

Real demo content every later checkpoint builds on.

- [x] Copy the five demo codebases + `sources-mock-data` into `demo/`
- [ ] Push each codebase to its own GitHub repo in the demo org (`order-matching-engine`, `trade-settlement-system`, `market-data-gateway`, `compliance-surveillance-monitor`, `mini-auth-service`)
- [x] Seed script `nox_api.demo.seed_sources`: Jira `APEX` issues, Confluence space `APEX` pages, Notion pages, Slack threads (idempotent)
- [x] `nox_api.demo.seed_org`: creates Apex Holdings → Trading / Post-Trade / Platform, and onboards each app with its sources from `demo/app_sources.csv`
- [ ] Generate all five KBs; merge the PRs; confirm the org rollup and contract mesh
- [x] `make seed-demo` runs both scripts end to end

**Done when:** all five apps show In Orbit, the contract map shows cross-app links (for example `trades.matched` between matching engine and settlement), and `make seed-demo` rebuilds it from scratch.

**Resume notes:** Local half done 2026-09-24; the rest needs you.
- `demo/codebases/*` (5 apps) and `demo/sources/*` use `apex` for package scopes, the Java namespace, the Maven BOM and the demo JWT secret. `demo/app_sources.csv` uses `${ATLASSIAN_BASE_URL}` so no host is hard-coded.
- Seeders live in the API package: `python -m nox_api.demo.seed_sources` (Confluence/Jira/Notion/Slack, idempotent — Notion + Slack verified as already seeded; Jira moved to REST v3) and `python -m nox_api.demo.seed_org` (Apex Holdings → Trading / Post-Trade / Platform, 5 apps with sources). Already run with `--no-launch`: tree built, `mini-auth-service` moved under Platform, 3 apps created and queued.
- `python -m nox_api.demo.push_repos` proposes the demo code to each GitHub repo as a PR on `nox/rename-demo` (dry run: 22 files differ across 5 repos). **Not run yet — waiting for your go-ahead.**
- Remaining order: new Atlassian token in `.env` → `seed_sources --only jira --only confluence` → `push_repos` → merge the 5 PRs → restart KBs for `mini-auth-service` and `market-data-gateway` (built from older demo code) → `seed_org` launches the 3 queued apps → merge the KB PRs → In Orbit.
- Demo KBs will still show the GitHub org name in repo URLs unless the demo repos move to a new org.

---

## CP7 — Missions + per-role spec files

Missions that start from any role, with AI-drafted upstream files and locked tabs.

- [ ] Migration `0003_missions`: `missions`, `mission_apps`, `spec_files`, `spec_file_versions`, `spec_chat_messages`, `spec_assets`, `verification_checks`, `external_links`, `mission_events`
- [ ] `POST /missions`: prompt + apps (NoX pre-selects apps from the atlas); creates the creator's file and queues `draft_upstream_files`
- [ ] Draft prompts for each role's file template (business, product, engineering, developer), each ending with a **Verification checklist** section
- [ ] Proceed prompt: "No one has approved the business and product requirements yet… Proceed?" → `POST /missions/{key}/proceed`; upstream files marked `ai_drafted`
- [ ] Mission page: four tabs (own tab editable, others locked with author/status), right rail (apps, people, timeline, links)
- [ ] Missions list/board by stage; "Waiting on you" per role on Mission control
- [ ] Approve a file → next stage; "Send back" with a reason
- [ ] Tests: role/file lock enforcement, proceed flow, stage transitions

**Done when:** as a Developer, create a mission from one prompt, see NoX draft the Business and Product files, proceed, and see the Business user's queue show "Confirm this is what you meant".

**Resume notes:** —

---

## CP8 — Spec editor: NoX cursor, chat, Git save

The co-writing experience and dual storage.

- [ ] TipTap editor with Markdown import/export: headings, lists, checklists, tables, code, links, `[[kb:…]]` links, image upload/paste (→ `spec_assets` + storage)
- [ ] Save → new `spec_file_versions` row + commit to the app's `kb-<app>` repo under `missions/NOX-<n>-<slug>/0N-<role>.md` on branch `nox/NOX-<n>`, with front matter
- [ ] Approve → merge that file to `main`; record the commit SHA
- [ ] `refine_file` task: Gemini returns edit ops; streamed over SSE as `nox.cursor`; the editor animates a labelled NoX cursor typing; NoX spans tinted; accept/undo per block
- [ ] Corner chat: collapsible, per file; `chat_edit` applies requested edits via the same cursor stream; answers KB questions with citations
- [ ] Every NoX addition cites a source (KB page, upstream file, Jira field) as a footnote link
- [ ] Stale detection when an upstream file is re-approved; stale banner on downstream tabs
- [ ] Multi-app missions: files in the primary app's repo, pointer files in the others

**Done when:** writing and saving the product file makes NoX's cursor visibly add edge cases from the KB, a chat request edits a section live, and the same file appears on GitHub under `missions/` and loads instantly from the DB.

**Resume notes:** —

---

## CP9 — Jira two-way sync

- [x] Mission create/edit: Link existing (search by key/JQL), Create new (in `APEX`, label `nox`, ADF description from spec files, remote link to NoX), Later
- [x] Import from Jira: key → mission, pulling summary, description and comments into context
- [x] NoX → Jira: stage → status transition map (editable), comments on approve, send-back and verify, sub-tasks from the developer file's task list
- [x] Jira → NoX: webhook `/api/v1/webhooks/jira?secret=…` for status, assignee and comment updates into the mission timeline
- [x] Loop protection (ignore NoX's own writes)
- [ ] Public URL documented and working (tunnel locally, Cloud Run later)

**Done when:** creating a mission creates an `APEX` issue, approving the engineering file moves it to In Progress, and changing its status in Jira shows up on the mission timeline within seconds.

**Resume notes:** Backend (`missions/jira_sync.py`, `routers/jira.py`) and UI (links panel: search/link, create, unlink, sub-tasks; import on New mission; timeline texts) are built and covered by `tests/test_jira_sync.py` with mocked Jira. Live check needs: the new Atlassian token in `.env` (currently 401), then a public URL (e.g. `cloudflared tunnel --url http://localhost:8010`) registered as a Jira webhook at `/api/v1/webhooks/jira?secret=$JIRA_WEBHOOK_SECRET` for *issue updated* and *comment created*.

---

## CP10 — `nox` CLI + `/nox` skill

- [x] `packages/nox-cli`: the `nox` CLI (`init`, `discover`, `search`, `link`, `config`)
- [x] `nox login` (browser approve → personal API token in `~/.nox/config`)
- [x] `GET /api/v1/cli/missions/{key}/context`: all spec files + KB digest + relevant pages + contracts
- [x] `/nox NOX-123` skill for Google Antigravity, Cursor, Codex, Copilot and Claude Code (`nox init <agent>` installs it): loads context, then runs plan → implement → tests → PR referencing `NOX-123`
- [x] PR ↔ mission linking from branch name or PR body; guardrail check comment on the PR
- [x] Install script

**Done when:** in Google Antigravity inside a demo repo, `/nox NOX-1` loads the mission and KB context, produces a change, and opens a PR that appears on the mission page with a guard comment.

**Resume notes:** `packages/nox-cli/bin/nox.mjs` is a dependency-free Node CLI (login via device flow or `--token`, whoami, missions, context, search, read, discover, kbs, pr, complete, init, config); `install.sh` links it onto PATH. `nox init antigravity` installs the NoX skill into Antigravity (`~/.gemini/config/skills/nox/SKILL.md`); cursor, codex, copilot and claude get the same workflow. API: `routers/cli.py` (device flow in Redis with in-memory fallback, `/me/tokens`, mission context, KB search/read, PR link) and `missions/prs.py` (link from branch/title/body naming NOX-n via the GitHub PR webhook, guard comment marked `<!-- nox-guard -->`, edited in place on new pushes). Browser approval page: `/cli/authorize/<code>`. Still to do live: push the demo repos (needs approval), register the PR webhook on them, then run `/nox NOX-1` in Antigravity inside `mini-auth-service`.

---

## CP11 — Manual reverse verification

- [x] "Mark as completed" (Developer) → mission enters verification
- [x] Each file's Verification checklist lights up in order: Developer → Engineering lead → Product owner → Business user
- [x] Tick items, add notes, **Verified**; or flag **Not met** with a note → back to the owning stage
- [x] Ticks and notes written back into the file (Git + DB)
- [ ] Optional hints next to items (linked PR diff, guard result); humans still tick every item
- [x] Business user verified → mission Done, Jira → Done, KB sync picks up the merged code
- [x] Mission control "Coming back to you" populated for each role

**Done when:** a mission goes from Mark as completed to Done through all four checklists, one Not met round-trip works, and Jira ends in Done.

**Resume notes:** `missions/verification.py` parses and rewrites the checklist; endpoints `POST /missions/{key}/complete`, `PUT …/files/{role}/verification`, `POST …/files/{role}/verify` (verified | not_met with `backTo`). Not met to the developer returns the mission to Build; to an earlier seat reopens that file. Ticks survive a second round. Hints next to items (linked PR diff, guard result) come after CP10 links PRs.

---

## CP12 — Deploy, polish, demo rehearsal

- [ ] Cloud Run: `nox-api`, `nox-worker` (min 1), `nox-web`; Cloud SQL, Memorystore, GCS; secrets in Secret Manager
- [ ] Webhooks (GitHub, Jira) pointed at the Cloud Run URL
- [x] Landing CTA "Enter NoX" → `/login`
- [ ] Error, loading and empty states across all pages; reduced motion; mobile check
- [x] Demo script (5 minutes): Business user asks → PO spec with an edge case "from the map" → Eng lead design with contract warning → Developer `/nox` → Mark completed → four checklists → Done
- [ ] Two full rehearsals on the deployed URL; `make seed-demo` reset tested

**Done when:** the full demo runs twice in a row on the deployed URL in under 5 minutes, with no manual database fixes.

**Resume notes:** Written, not run: `scripts/deploy_gcp.sh` (`secrets | all | api | worker | web`, `DRY_RUN=1`; secrets via Secret Manager, worker = Celery worker + beat behind a health server with min 1 instance, web image built with `NOX_API_URL` + Firebase config as build args). Mission images go to GCS when `STORAGE_BACKEND=gcs`. Added a product error page, a 404, reduced-motion for pulses, and a mobile overflow fix on the mission page. `docs/DEMO_SCRIPT.md` has the 5-minute run; `make demo-reset` clears the demo orgs' missions (dry run first). Still to do, all needing the user: provision Cloud SQL + Memorystore + VPC connector, run the deploy, point the GitHub/Jira webhooks at the API URL, add the web domain to Firebase authorized domains, then two rehearsals.

---

## Progress log

Newest first. One line per finished checkpoint or notable stop.

| Date | Checkpoint | Note |
| --- | --- | --- |
| 2026-09-26 | CP13 | All AI through Google ADK (`nox_api/ai/`), Agent Platform backend, typed outputs. Hybrid KB search (gemini-embedding-2 + pgvector + full-text, incremental). Ask agent streams with tool steps and citations. Co-writer edits section by section, live, one version per turn. KB builder is a cartographer, parallel writers and a reviewer: 8.7× faster, ~3× fewer tokens per page on market-data-gateway. NoX Local: `nox kb build/sync/push/watch` on Gemma 4 |
| 2026-09-24 | CP6 (part) | Demo code PRs opened on the 5 Apex repos (branch `nox/rename-demo`); merge them, then rebuild the KBs |
| 2026-09-24 | CP12 (part) | Deploy script (dry-run checked), GCS mission images, error/404 pages, mobile fix, demo script, `make demo-reset` |
| 2026-09-24 | CP10 | `nox` CLI with browser login, mission context for agents, KB search/read, `/nox` for 5 agents, PR linking + guard comment |
| 2026-09-24 | CP11 | Mark as completed → four checklists in reverse, ticks and notes written into the files and Git, Not met round-trip, Done → Jira Done |
| 2026-09-24 | CP9 | Jira link/create/import/sub-tasks, stage → status sync, webhook with echo protection; live check pending token |
| 2026-09-24 | CP8 | Co-writing editor: NoX's animated edits with undo, corner chat, images, Git mirror on `nox/NOX-n` |
| 2026-09-24 | CP7 | Missions with one spec file per role, AI-drafted upstream files + proceed prompt, approve/send-back, stale tracking |
| 2026-09-24 | CP6 | Demo code and sources in demo/, seeders (idempotent), org tree seeded; GitHub push + Jira seed pending |
| 2026-09-24 | CP5 | Atlas UI: org tree, onboarding wizard with live source checks, live pipeline, explorer, pins, Ask, contract map, connectors |
| 2026-09-24 | CP4 | App shell: sidebar/bottom nav, top bar, ⌘K, role homes with live KB + connector data |
| 2026-09-24 | CP3 | Firebase auth, users/memberships, access matrix on all routes, role picker, landing → login |
| 2026-09-24 | CP2 | Jira v3 client (read+write), Atlassian auth, Confluence fix, status endpoint, hardening; blocked on Atlassian token for live check |
| 2026-09-24 | CP1 | Engine built as `nox_api`; Flow A verified live to a KB PR with streamed events; 5 bugs fixed |
| 2026-09-24 | CP0 | Monorepo (apps/web, apps/api), Makefile, compose, .env, CI |
| 2026-09-24 | — | Plan written; decisions recorded in docs 01–03 |
