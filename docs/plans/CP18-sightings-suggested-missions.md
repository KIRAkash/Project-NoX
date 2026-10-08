# CP18: Sightings — NoX suggests what to change next, for each seat

Today NoX only acts when someone asks. It already knows a lot: every application's knowledge base, its source, the contract map, Jira, Slack, what past missions changed and where they got stuck. This checkpoint has NoX read all of that on a schedule and suggest changes worth making. It writes each suggestion for the seat that will read it, and any seat can start a mission from one in a single click.

A suggestion is called a **sighting**: something NoX spotted while looking across the Atlas. The name is easy to change. In the UI it reads in plain words ("NoX spotted 3 things this week").

| Part | What it adds | Estimate | Status |
| --- | --- | --- | --- |
| A. Lenses | What counts as an opportunity for each seat, and how it is written for them | ½ day | Built |
| B. Signals | What NoX looks at, and how it skips what hasn't changed | ½ day | Built (KB, source, contracts, missions, linked Jira, captures, Shield) |
| C. The run | Scout, check, merge, review, write per seat | 1½ days | Built |
| D. Storage | Sightings, runs, feedback, schedule; `missions.sighting_id` | ½ day | Built (`0009_sightings`) |
| E. Schedule and settings | Daily or weekly per organization, Look now | ½ day | Built (on Celery beat) |
| F. Feed and one-click mission | A panel on each seat's home, a Sightings page, Start mission | 1 day | Built |

**Estimate:** about 4½ working days. An MVP cut that fits before the 2026-10-18 deadline is at the end.

**Why.** Every seat already asks "what should we do next?" and answers it from memory, a backlog or a hunch. NoX has the map. Turning that map into grounded suggestions makes NoX useful before anyone has typed a request, and it shows the four-seat model working from both ends: the same fact is a conversion problem to the business, a broken flow to the product owner, a coupling problem to the engineering lead and a slow query to the developer.

---

## What shipped, and where it differs from the design

- **The run is a staged job, not an ADK `Workflow` graph.** `missions/sightings.py` `run_sightings` runs collect → scout → merge → review → write → save the way Show NoX's `analyze_media` does, and still emits `node_started` / `node_finished` and one-line steps on `sightings:<org>` for the progress shown under the schedule. The agents themselves are ADK agents in `ai/agents/sightings.py`.
- **Merging is deterministic.** Candidates merge when their claims are similar (cosine ≥ 0.86 on `gemini-embedding-2` vectors, or word overlap ≥ 0.5 without embeddings) or when they share two or more page or code sources. The critic then scores relevance per seat in one FAST call, so there is no separate merge model call.
- **Embeddings are stored as JSON** on the sighting and compared in Python. Dedupe never looks at more than a few hundred rows, so it doesn't need pgvector.
- **The schedule runs on Celery beat, not Cloud Scheduler.** The deployed `nox-worker` already runs `celery worker -B` with one instance, so a 15-minute `sightings_tick` on beat is enough. `POST /api/v1/internal/sightings/tick` exists for setups without beat (shared secret or Google OIDC), and `NOX_SIGHTINGS_TICK=local` runs the tick inside a single API instance.
- **Settings live on the Sightings page**, in a schedule panel beside the feed, not in the Atlas. The schedule belongs to the top-level organization. Every top-level organization with an application gets the default weekly schedule on the first tick.
- **Each seat gets its own open questions.** The scouts' questions are technical, so they go to the engineering and developer seats as found. The writer rewrites the ones the business user or product owner could answer, in their words, and those must still pass the reader lint. Each view also carries one to three **How NoX knows** lines in the reader's words, because the business seat sees no page or code refs.
- **The reader lint covers infrastructure words too** (ORM, SQL, JWT, Kafka, Redis…) for business and product, and wikilinks are stripped from card text, since evidence is listed beside it.
- **A kind from another seat's lens isn't shown.** A business card for an opportunity a developer scout found as "code health" shows no kind chip.
- **Scouts have a lookup budget** of 8 tool calls. On the Apex demo (two applications with knowledge bases), a full pass went from 115 calls, 1.3M tokens and $0.43 to 53–58 calls, about 360k tokens and $0.21–0.23, in about a minute, with the same five sightings per seat.
- **Fixed along the way:** `services/search.py` `embed()` sent a plain list of strings, which `gemini-embedding-2` folds into a single embedding. Indexing a knowledge base with more than one chunk failed its `zip(strict=True)` and fell back to full-text only. It now sends one `Content` per text and checks the count.

**Not built yet:** the eval with planted opportunities (`scripts/eval_sightings.py`), sightings counts on the Impact page, a Slack or email digest, Ask history and Slack or Confluence signals beyond what the knowledge base already holds, Jira signals beyond issues linked to missions, and team-level schedules.

## Ground rules

These follow the design principles in `AGENTS.md`.

- **NoX suggests, people decide.** A sighting never becomes a mission by itself. A person clicks Start mission, and the mission then runs through the normal seats and approvals.
- **Grounded or it isn't shown.** Every sighting cites what it rests on: `[[kb:app/page]]`, `path:line`, a Jira key, a Slack thread, a mission key. A sighting whose citations don't resolve is dropped before anyone sees it.
- **No invented numbers.** Money, time and user counts appear only when a source states them (a metric on a KB page, a Jira field, a Slack message, a config value). Otherwise impact is High, Medium or Low with the reason in one sentence, and what NoX can't know becomes an open question.
- **Scope is set by NoX.** A run reads only the applications in the organization it runs for. A viewer sees a sighting only if they can see every application it cites. Code evidence (`path:line`, snippets) is stripped server-side for the Business and Product seats, the same rule as `CODE_SEATS` in `missions/media.py`.
- **Write for the reader.** Each seat's text follows its persona in `missions/personas.py`. A business sighting never mentions endpoints or services, and a lint checks that.
- **Fewer and better.** At most 5 new sightings per seat per run. "Nothing worth your time this week" is a valid result.
- **Everything slow is a job.** Runs happen in the worker. The API lists, launches and records feedback.

---

## The core idea: one opportunity, seen through four lenses

Generating four separate lists from four separate prompts gives four overlapping lists and no link between them. Rewriting one list four ways gives business users developer findings dressed in plain words ("the order page could be faster" for an N+1 query nobody would notice). Neither is right.

NoX does three things instead:

1. **Scout per lens.** Each seat has a lens: what counts as an opportunity for that seat. A scout agent per lens looks for candidates in the evidence that lens values, using the tools that lens is allowed.
2. **Merge into opportunities.** Candidates that rest on the same evidence are one opportunity. A slow checkout found by the developer scout (a query in a loop) and by the business scout (support threads about checkout timeouts) become one sighting.
3. **Write per seat, only where it matters.** The merged opportunity gets a relevance score per seat. NoX writes a view only for seats where it scores high enough. Each view has its own title, why, impact, and the mission request written in that seat's words.

```
signals ──► scouts (one per lens) ──► merge ──► check ──► write per seat ──► feed
                                        │                      │
                                        └── dedupe against     └── business: plain words, no code
                                            open missions,          product: flows, users, AC-ready
                                            past sightings,         engineering: blast radius, cost, risk
                                            dismissals              developer: path:line, tests, effort
```

The result is one row per opportunity with up to four views. That is the shape Show NoX already uses (`SeatViews` in `ai/schemas.py`), so the pattern is known.

---

## Part A: Lenses

A lens extends the seat's persona. It adds what that seat calls an improvement, how impact is measured for them, which evidence they may see and which tools the scout may use. It lives in `missions/lenses.py` beside `personas.py` and reuses `PERSONAS[role]` for voice and banned words.

| Seat | Counts as an opportunity | Impact in their terms | Evidence they see | Scout tools |
| --- | --- | --- | --- | --- |
| Business | Lost revenue or conversion, slow or confusing customer journeys, staff time on manual work, risk and compliance gaps, something customers keep asking for | Money, time, customer trust, risk, in the business's own names | Plain sources: "14 support threads last month", "the refund policy page says…", a capture someone recorded | `search_kb`, `read_kb_page`, `get_jira_issue`; Slack and Jira signal digests |
| Product | Friction in a flow, missing states (empty, error, limits), behaviour that differs between applications, capability built but not exposed, outcomes with no way to measure them | Users affected, how often, which metric moves | Screens, flows, user types, KB pages, Jira | Same as Business, plus `find_interfaces` |
| Engineering | Coupling and cycles, the same capability built twice in different applications, contracts with many consumers and no versioning, single points of failure, drift from ADRs, structural cost drivers (polling, chatty calls, duplicate stores), security posture | Blast radius, cost, risk, effort (S, M, L) | Contract map, decision pages, KB pages, Shield findings | All knowledge tools, plus the org contract map |
| Developer | Slow paths (queries in loops, blocking calls in async code, unbounded reads, missing indexes or caching), duplication, dead code, TODO and FIXME clusters, missing tests on risky code, slow builds, outdated dependencies | Latency or load where a source states it, effort, risk of the change | `path:line`, snippets, test files | All knowledge tools, including `grep_source` and `read_source_file` |

```python
@dataclass(frozen=True)
class Lens:
    role: Role
    opportunity_kinds: list[str]   # what the scout looks for, in order of value
    impact_axes: list[str]         # how impact is described to this seat
    code_evidence: bool            # path:line and snippets allowed in what this seat sees
    tools: list                    # the scout's tools; set by NoX, never by the model
    request_hint: str              # how the one-click mission request is phrased for this seat
```

**Personal ordering.** Within a seat, sightings about applications the viewer has worked on recently (missions they created, approved or were assigned in the last 90 days) sort first. Everyone in a seat sees the same sightings. Only the order changes.

**Focus areas.** An organization can weight the lenses (for example, cost this quarter). The weights go into the scout's instruction and the ranking. They never widen scope.

---

## Part B: Signals

| Signal | Where it comes from today | Lenses that use it |
| --- | --- | --- |
| KB pages: summaries, concepts, entities, decisions | `compiled_files.json`, `services/search.py` | All |
| Source snapshot | `ai/tools/knowledge.py` `grep_source`, `read_source_file` | Engineering, Developer |
| Contract map: who exposes and consumes what | `org_interface_contracts` | Engineering, Product |
| Jira: open bugs by component, ageing tickets, reopened issues | `connectors/`, `integrations/` | All |
| Slack and Confluence or Notion sources already onboarded | `connectors/` (already guarded by Shield at ingest) | Business, Product |
| Mission history: rework rounds, Failed and Can't-verify items, open questions left unanswered, applications changed again and again | `mission_events`, `spec_files.verification`, CP17 `mission.update` events | All |
| Show NoX captures marked `bug` or `missing_feature` | `media_assets.grounding` | Business, Product |
| Shield findings | `shield_findings` | Engineering |
| KB lint and coverage gaps | `agents/linter.py`, `agents/coverage_diff.py` | Developer, Engineering |

**Skip what hasn't changed.** Each run stores a fingerprint per application: the KB's latest commit, the newest Jira and Slack signal, the newest mission event touching it. If nothing changed since the last run, that application is skipped and its open sightings stay as they are. A weekly run on a quiet estate costs almost nothing. Run now can force a full pass.

**Ask history is a later signal.** Questions people keep asking that the KB can't answer would be good product and documentation signals. They sit in ADK sessions and are personal, so they wait for an aggregate-only design.

---

## Part C: The run

An ADK `Workflow` in `ai/agents/sightings.py`, built like `kb_builder.py`. Each node emits `node_started` and `node_finished` so the run streams progress. The whole run is one `telemetry.usage_scope("sightings-run", org_id=…)`.

| Node | What it does | Tier |
| --- | --- | --- |
| Collect | Builds a signal digest per changed application. No model calls. | — |
| Scout | One agent per (application, lens). Reads the digest, looks things up with its lens's tools, returns up to 6 candidates as `SightingCandidate` with evidence refs. Runs in parallel with the shared lens instruction as `static_instruction`, so the prefix is cached. | DEFAULT |
| Architect | Engineering only, once per organization: reads the contract map and every app brief to find cross-application opportunities (duplicated capability, cycles, a contract every app depends on). | DEEP |
| Merge | Groups candidates that share evidence or say the same thing (embedding similarity on the claim, with `gemini-embedding-2`). Merges each group into one opportunity with a relevance score per seat. | FAST |
| Check | Drops anything whose citations weren't returned by a tool during the run (the `post_check` rule from `missions/media.py`). Drops anything matching an open mission (hybrid search over mission prompts and titles), an open sighting, or a dismissal from the last 90 days. A critic scores what's left on four questions: is it specific, is it actionable, is the evidence enough, is it worth this seat's time. Below the bar, it's dropped. | FAST |
| Write | For each opportunity, writes a `SeatSighting` for every seat with relevance ≥ 0.6. The business and product views are checked against the persona's banned words and rewritten once if they fail. | DEFAULT |
| Shield and save | Screens the written text with `services/shield.py`, saves rows, records events, pushes `sightings.ready` on the org stream. | — |

```python
class Evidence(BaseModel):
    kind: Literal["kb", "code", "jira", "slack", "mission", "capture", "contract", "shield"]
    ref: str                      # [[kb:app/page]], path:line, APEX-41, NOX-12, a media id…
    says: str                     # what it shows, one sentence

class SightingCandidate(BaseModel):
    claim: str                    # the opportunity, one sentence
    kind: str                     # one of the lens's opportunity_kinds
    apps: list[str]
    evidence: list[Evidence]
    impact: Literal["high", "medium", "low"]
    impact_basis: str             # why that level; a number only if a source states it
    effort: Literal["S", "M", "L"] | None
    open_questions: list[str]

class SeatSighting(BaseModel):
    title: str                    # in this seat's words
    why: str                      # two or three sentences
    impact: str                   # impact in this seat's terms
    request: str                  # the mission request, written as this seat would type it
    mission_type: Literal["feature", "bug", "change"]
```

**Cost control.** Skipping unchanged applications does most of the work. On top of that: at most 6 candidates per scout and 5 new sightings per seat per run, a per-run token budget (`NOX_SIGHTINGS_BUDGET`), and the run's cost shown in settings and on Impact. NoX Local can run it on Gemma with one scout at a time.

---

## Part D: Storage

Alembic `0009_sightings.py` (CP17 shipped without its planned `0009`, so the number is free).

**`sightings`**

| Column | Notes |
| --- | --- |
| `id`, `org_id`, `run_id` | |
| `kb_ids` | JSON list of the applications it cites; visibility needs all of them |
| `kind` | The opportunity kind |
| `claim` | The merged claim, seat-neutral |
| `evidence` | JSON list of `Evidence`; filtered per seat on the way out |
| `views` | JSON `{seat: SeatSighting + relevance}` |
| `open_questions` | JSON list |
| `impact`, `effort`, `confidence` | |
| `status` | `open`, `snoozed`, `dismissed`, `launched`, `shipped`, `outdated` |
| `mission_id` | Set when launched |
| `fingerprint` | Hash of the sorted evidence refs, for dedupe |
| `embedding` | pgvector(768) of the claim, for dedupe against new candidates |
| `snoozed_until`, `created_at`, `updated_at` | |

**`sighting_runs`**: `id`, `org_id`, `trigger` (`schedule`, `manual`), `status`, `apps_scanned`, `apps_skipped`, `counts` (per seat), `usage` (tokens and cost), `error`, `started_at`, `finished_at`.

**`sighting_feedback`**: `id`, `sighting_id`, `user_id`, `seat`, `action` (`useful`, `dismissed`, `snoozed`, `launched`), `reason` (`not_relevant`, `already_known`, `wrong`, `not_now`, or free text up to 200 characters), `created_at`.

**`sighting_schedules`**: `org_id` (unique), `cadence` (`off`, `daily`, `weekly`), `weekday`, `hour`, `timezone`, `seats` (enabled seats), `focus` (lens weights), `next_run_at`, `last_run_at`, `updated_by`.

**`missions.sighting_id`**: nullable foreign key. It tells the mission where it came from and lets the sighting follow it to Shipped.

Status changes also go through `missions/events.record()` when a mission is involved (`mission.created` carries `sightingId`), so the timeline, Jira and BigQuery see where the mission came from.

---

## Part E: Schedule and settings

**Who sets it.** A new capability `Cap.MANAGE_SIGHTINGS`, held by the Engineering and Product seats. Settings live on an organization and apply to everything under it, the same way memberships flow down. A team can set its own schedule later.

| Setting | Default |
| --- | --- |
| How often | Weekly |
| Day and time | Monday 08:00, organization timezone |
| Seats | All four |
| Focus | Even across kinds; any lens kind can be weighted up |

**How it runs on Cloud Run.** There is no Celery beat on Cloud Run (`WORKER_MODE=auto` runs jobs in-process there). Cloud Scheduler calls `POST /api/v1/internal/sightings/tick` every 15 minutes with an OIDC token for the scheduler's service account. The tick claims due schedules with `SELECT … FOR UPDATE SKIP LOCKED`, sets their `next_run_at`, and dispatches one run per organization through `workers/dispatcher.py`. Two instances can't run the same organization twice.

**Locally.** Celery beat calls the same tick function. With `WORKER_MODE=in_process` and `NOX_SIGHTINGS_TICK=local`, a small loop started at API startup calls it instead. `deploy_gcp.sh` creates the Cloud Scheduler job.

**Run now.** `POST /orgs/{id}/sightings/run` starts a full run and streams its nodes, so a demo doesn't wait for Monday.

---

## Part F: Feed and one-click mission

### API

| Route | Purpose | Access |
| --- | --- | --- |
| `GET /api/v1/sightings` | Open sightings for the acting seat, in visible organizations, in personal order | Any seat |
| `GET /api/v1/sightings/{id}` | One sighting, as the acting seat sees it | Any seat that can see every cited app |
| `POST /api/v1/sightings/{id}/launch` | Creates a mission from the acting seat's view and returns it | `Cap.CREATE_MISSION` |
| `POST /api/v1/sightings/{id}/feedback` | Useful, dismiss with a reason, or snooze | Any seat that can see it |
| `GET`, `PUT /api/v1/orgs/{id}/sightings/settings` | Read and change the schedule | `GET`: `SEE_ATLAS`; `PUT`: `MANAGE_SIGHTINGS` |
| `POST /api/v1/orgs/{id}/sightings/run` | Run now (202, progress on SSE) | `MANAGE_SIGHTINGS` |
| `GET /api/v1/orgs/{id}/sightings/runs` | Recent runs with counts and cost | `SEE_ATLAS` |
| `POST /api/v1/internal/sightings/tick` | Cloud Scheduler entry point | OIDC from the scheduler's service account only |

The response for a seat contains only that seat's view and the evidence that seat may see. The other seats' text never leaves the server for that seat, so the business user's browser never holds code paths.

### What one click does

**Start mission** on a sighting calls `launch`, which reuses the body of `create_mission` (moved into `missions/create.py` so the route and launch share it):

- The **request** is the clicker's `SeatSighting.request`, so the mission starts in the clicker's words, from the clicker's seat.
- The **applications** are the sighting's `kb_ids`, primary first. The **type** comes from the view.
- `missions.sighting_id` is set and the sighting becomes `launched`.
- Drafting gets a new **Where this came from** section in `drafting.build_prompt`: the claim, the evidence (filtered per file's seat) and the open questions.
- Upstream files use the other seats' views. When the engineering lead launches a cost sighting, NoX drafts the business and product files as usual, and the sighting's business view gives the business file its plain-words reason ("nothing changes for customers; this lowers what we pay to run the trading screens"). This is where the four-lens design pays off.

**Edit first** opens `/app/missions/new?sighting=<id>` with the request, applications and type filled in, for people who want to change the wording before launch. That page sends `sightingId` with the create call.

### Where it shows

- **Each seat's home** gets a "Spotted by NoX" panel with the top 3 for that seat and a count. It sits below the seat's main work, not above it: triage stays first for the product owner, designs to review stay first for the engineering lead.
- **A Sightings page** (`/app/sightings`, one nav item for every seat) lists all open sightings with filters by application and kind, and tabs for Launched and Dismissed. It uses `FEED_LIST`.
- **The card**: kind chip, title, two-line why, impact and effort chips, "How NoX knows" (evidence, collapsed), and three actions: **Start mission**, **Not now** (snooze 30 days), **Dismiss** (asks for a reason). Works at phone width.
- **Shared state across seats.** When one seat launches a sighting, every other seat's card shows "In flight as NOX-14, started by the engineering lead" with a link instead of Start mission. Nobody launches the same opportunity twice.
- **The mission page** shows a small "From a NoX sighting" chip in the header, with the evidence behind it.
- **Atlas → organization** gets a Sightings section: schedule, focus, Run now, the last run's summary and cost.
- **Impact** adds sightings shown, launched, shipped and dismissed, per seat and per kind.

### Closing the loop

- When a launched mission reaches `done`, its sighting becomes `shipped`.
- On the next run, an open sighting whose cited pages or code changed is checked again. If its evidence no longer holds, it becomes `outdated` with the reason, and leaves the feed.
- Dismissals with reasons go into the Check node for 90 days, and a summary of what each seat dismissed and why goes into that seat's scout instruction. NoX stops suggesting what a seat keeps turning down.

---

## Evaluation

`scripts/eval_sightings.py`, run by `make eval`. The Apex demo repos get a few planted opportunities, one or more per lens: a query inside a loop, a polling job where a webhook exists, customer data held in two applications, a refund flow with support complaints in the mock Slack source.

| Measure | Bar |
| --- | --- |
| Planted opportunities found by the right lens | 4 of 5 or better |
| Citations that resolve | 100% (anything else is a bug in Check) |
| Business and product views free of banned words | 100% |
| Duplicate of an open mission or an earlier sighting | 0 |
| Critic agreement on a hand-labelled set of 20 | 80% or better |

Tests: `tests/ai_fakes.py` gets fakes for the scout, merge, critic and writer. Unit tests cover the evidence filter per seat, the visibility rule (all cited apps visible), dedupe, launch (mission created from the clicker's seat with `sighting_id` set), the forbidden cases on every route, and the tick's no-double-run claim.

---

## MVP cut for the deadline

**In:** lenses; KB, source, contract map, Jira and mission-history signals; the workflow; storage; weekly or daily schedule with Run now; home panels, Sightings page, Start mission, Edit first, Not now and Dismiss; the eval with planted opportunities.

**Later:** Slack and Confluence signals beyond what's in the KB; Ask history; a Slack or email digest; team-level schedules; Impact counts; real cost numbers from a Cloud Billing export (until then, engineering cost sightings point at structural cost drivers and say plainly that the saving isn't measured).

---

## Files touched

| Area | Files |
| --- | --- |
| API | new `missions/lenses.py`, new `missions/sightings.py` (collect, visibility, evidence filter, launch), new `missions/create.py` (shared with `routers/missions.py`), new `routers/sightings.py`, `routers/orgs.py` (settings, run, runs), `missions/drafting.py` (Where this came from), `core/auth.py` (`Cap.MANAGE_SIGHTINGS`), `workers/dispatcher.py` and `workers/tasks.py` (run job, tick), `main.py` |
| AI | new `ai/agents/sightings.py` (workflow), `ai/schemas.py` (`Evidence`, `SightingCandidate`, `SeatSighting`, critic and merge outputs) |
| Data | Alembic `0009_sightings.py`, `db/models.py` |
| Web | new `app/(product)/app/sightings/page.tsx`, new `components/app/sighting-card.tsx`, the four `components/app/homes/*.tsx`, `missions/new/page.tsx` (`?sighting=`), `missions/[key]/page.tsx` (origin chip), Atlas org settings, `lib/app/nav.ts`, `lib/app/types.ts` |
| Deploy | `scripts/deploy_gcp.sh` (Cloud Scheduler job and its service account) |
| Docs | new chapter in `apps/web/content/docs/` and `lib/docs.ts`, `docs/DEMO_SCRIPT.md`, the CP18 row in `IMPLEMENTATION_PLAN.md` |

## Done when

- [x] A run on the Apex demo produces sightings for all four seats, each in that seat's words, each with resolving citations.
- [x] The business and product seats never receive code paths or snippets from the API.
- [x] Start mission creates a mission from the clicker's seat with the sighting's request and applications, and its drafts cite the sighting's evidence.
- [x] A launched sighting shows as in flight on every other seat's card, and becomes shipped when the mission is done.
- [x] Dismissed and snoozed sightings don't come back, and nothing duplicates an open mission.
- [ ] The schedule runs in the cloud without double runs (on beat in `nox-worker`; the claim is tested, the deploy isn't yet). Look now streams progress.
- [x] An application with no changes since the last run is skipped.
- [x] Everything works at phone width.
- [ ] `make test`, `make lint` and the sightings eval pass. (Tests and lint pass; the eval isn't written yet.)

## Decisions (confirmed)

1. **Start mission creates the mission straight away**, with Edit first as the second button. The request, applications and type are already known, and a person still approves every file after.
2. **Engineering and Product set the schedule.** Business and Developer only see and act on sightings.
3. **The name is Sightings.** On the business user's home the section reads "Ideas from NoX".
