# CP20: Team memory, voice, Jules and Gemini CLI

NoX already carries one change from a business user's first sentence to verified code. This checkpoint makes that loop smarter each time it runs, easier to start and able to hand the build to Google's own coding agents:

- **Team memory.** When a person sends work back, NoX learns the lesson and applies it to later missions on the same application. The lessons are stored in the Agent Platform Memory Bank.
- **Voice.** Any seat can speak instead of typing, and can listen to NoX's replies on request.
- **Hand off to Jules.** The developer can give the build to Jules, Google's async coding agent. People still approve Jules's plan, review the pull request and verify.
- **`/nox` in Gemini CLI**, packaged as a Gemini CLI extension.
- **Agent tracing.** Every agent, tool and model call goes to Cloud Trace.

| Part | What it adds | Google service | Estimate | Build order |
| --- | --- | --- | --- | --- |
| A. Agent tracing | One trace per unit of AI work, with agents, tools and model calls nested | Cloud Trace (OpenTelemetry) | ¼ day | 1 |
| B. `/nox` in Gemini CLI | `nox init gemini` installs an extension: NoX's MCP tools, context and the `/nox` command | Gemini CLI extensions | ½ day | 2 |
| C. Hand off to Jules | A button on the developer's file in Build. Jules plans, the developer approves, Jules opens the PR, the guard checks it | Jules API | 1½ days | 3 |
| D. Team memory | Lessons from send-backs, applied and cited in later drafts, removable by people | Agent Platform Memory Bank | 2 days | 4 |
| E. Voice | Speak into any NoX text box; listen to NoX's replies | Gemini audio understanding, Gemini TTS | 1½ days | 5 |

**Estimate:** about 5¾ working days. The schedule at the end fits it before the 2026-10-18 deadline and leaves a day of buffer.

---

## What shipped (2026-10-08), and where it differs from the design

All five parts are built and tested (`tests/test_tracing.py`, `test_jules.py`, `test_team_memory.py`, `test_voice.py`, the CLI test). The UI was checked in the browser at desktop and phone width.

- **Spikes settled.**
  - The Agent Platform SDK is `google-cloud-agentplatform` (`agentplatform.Client(...).memory_banks`). It supports custom scope keys through `scope_keys`, so the `user_id` fallback isn't needed.
  - `gemini-3.5-transcribe` returns an `audio_transcription` part and ignores the vocabulary ("claims intake", "TWCLM12"). The FAST model with the vocabulary gets both right, so it is the default and `NOX_MODEL_TRANSCRIBE` stays empty.
  - `gemini-3.8-flash-lite-tts` returns WAV in about 4 s.
  - Gemini CLI 0.51 supports `!{…}` with shell-escaped `{{args}}`, and `httpUrl` + `headers` in an extension's `mcpServers`.
  - ADK 2.10 ships its own exporter for the Telemetry (OTLP) API (`google.adk.telemetry.google_cloud.get_gcp_exporters`), so tracing uses it. The only new dependency is `opentelemetry-exporter-otlp-proto-http`.
- **Tracing** is done; `NOX_TRACE=cloud` is on in `deploy_gcp.sh`. On Cloud Run, log lines become JSON with `logging.googleapis.com/trace`. The trace link on the Impact page was cut.
- **Gemini CLI.** `nox init gemini` generates the extension in `~/.nox/gemini/nox` with the API and token filled in, then runs `gemini extensions link --consent`. Running it again updates it in place. `--no-link` skips the linking.
- **Jules**
  - Built against the public v1alpha API (sessions, activities, sources).
  - The plan proposed a "Reply" button; it shipped as *Message Jules*, which becomes *Answer Jules* when Jules has a question.
  - With no key, every Jules action answers 409, and nothing calls Jules.
  - A 20-second watcher per hand-off, a lazy refresh from the mission page, and a 60-second `jules_tick` on beat.
  - **Not yet checked live:** needs `JULES_API_KEY` and the Jules GitHub app on the Nox-Demo-Org repos.
- **Team memory**
  - The lesson finder is a FAST `structured.ask`. Memory Bank receives facts through `direct_memories_source` (consolidation only), so NoX controls extraction and grounding.
  - The fourth source (learning from human edits) was cut, as planned in the cut list.
  - `scripts/setup_memory_bank.py --dry-run` validates its config against the SDK types.
  - **Not yet checked live:** Memory Bank needs the IAM grants. Postgres mode is the local default and is fully working.
- **Voice**
  - The mic is on the business home, New mission, the co-writer chat, Ask, Send back and the Not met note.
  - Listen is on co-writer replies and Ask answers.
  - Rate limit: `NOX_VOICE_PER_HOUR` (30) per person.
- **Fixed along the way**
  - The product layout used `overflow-hidden`, which let link jumps shift the page sideways on phones (the liquid-metal button canvases are wider than the screen). It is now `overflow-clip`.
  - Long inline code in spec files now wraps instead of spilling into the side panel.
  - The Send back form is a bottom sheet on phones.
  - The file header's buttons and chips no longer break mid-word.

## Decisions (2026-10-08)

- **No Radar.** NoX does not pull facts from Google Search into specs. Web content could bring in claims that no enterprise source backs, and that breaks "grounded or it doesn't ship".
- **Tier 3 ideas are out.** That means the Computer Use verifier, Gemma on Cloud Run GPU, Gemini Enterprise listing, Workspace connectors, image mockups and plain-English questions over BigQuery.
- **Voice is push-to-talk transcription, not the Live API.** The person speaks and the words appear in the box to edit before sending. Hearing NoX is an optional Listen button and never plays on its own. Part E says why the Live API was not chosen.
- **Where the Jules button lives.** "Hand off to Jules" sits on the developer's file once the build spec is approved and the mission is in Build, next to *Mark as completed*. The developer always sees it. When Jules can't be used, the button is greyed out and a line under it says why and where to fix it.
- **Jules plans first, by default.** NoX asks Jules for a plan, and the developer approves it in NoX before Jules writes code. The developer can switch this off for a session.
- **Lessons are opt-out at the moment of feedback.** The Send back and Not met dialogs get a "Remember this for next time" box, ticked by default. Any lesson can be removed later.

## Ground rules

These follow the design principles in `AGENTS.md`.

- **People own decisions.** NoX learns only from what a person wrote when sending work back, and only while the box is ticked. Jules never approves its own plan in NoX's flow, and its PR goes through the same guard and reverse verification as any other. Voice never submits anything by itself.
- **Grounded or it doesn't ship.** Each lesson keeps the words it came from and the mission it came from. A lesson whose quote isn't in the feedback is dropped. Drafts cite lessons the same way they cite knowledge-base pages.
- **Scope is set by NoX.** Lessons are scoped to an application and a seat. A draft only reads lessons for the mission's own applications. Voice vocabulary comes from the caller's visible applications only.
- **The database is authoritative.** Postgres says which lessons are active and where each one came from. Memory Bank does the consolidation and the similarity search.
- **Everything slow is a job.** Learning a lesson runs as a job, and so does Jules polling. Transcription streams over SSE like Ask. The Ask exception in principle 6 becomes "streamed Ask and streamed transcription".
- **Secrets stay out.** The prompt sent to Jules passes the same DLP check as a knowledge-base commit. Traces never record prompt or response text.

---

## Before coding: spikes (about 2 hours in total)

These are things the docs leave open. Settle each one in a scratch script before building the part that needs it.

| # | Question | Fallback if the answer is no |
| --- | --- | --- |
| 1 | Memory Bank: which Python package and client does our project use (`agentplatform.Client(...).memory_banks` per the current docs, or the older `vertexai` client)? Does `scope` accept custom keys like `{"app": …, "seat": …}`? | Encode the scope as `{"user_id": "app:<slug>/seat:<role>"}` |
| 2 | Speech: on our Agent Platform project and location, does the FAST model take an inline audio part through ADK? Can a dedicated transcription model run through the same API? What is the current Gemini TTS model ID and voice list? (The 3.8 Flash and Flash-Lite TTS models were released on 2026-09-23.) | Transcribe with the FAST model. Hide Listen if no TTS model is available |
| 3 | Jules: create an API key, call `GET /v1alpha/sources` and confirm the Nox-Demo-Org repos are listed. Run one throwaway session on a demo repo with `requirePlanApproval` and `AUTO_CREATE_PR` | Show the button as "not connected" until the GitHub app is installed |
| 4 | Gemini CLI: do extension commands support `!{…}` shell injection with `{{args}}`? Does an extension's `mcpServers` accept `httpUrl` plus `headers`? | The command asks the agent to run `nox context` itself |
| 5 | Cloud Trace: `CloudTraceSpanExporter`, or the newer Telemetry (OTLP) endpoint that Google's ADK guide now uses? | Use `CloudTraceSpanExporter`; it is the simplest and well documented |

## Needs you (manual steps)

- **Jules:** create a key at jules.google.com → Settings → API (at most 3 keys). Install the Jules GitHub app on the Nox-Demo-Org repositories from the Jules web app. Put the key in Secret Manager as `JULES_API_KEY`.
- **IAM:** give the `nox-api` and `nox-worker` service accounts `roles/aiplatform.memoryUser` (Memory Bank) and `roles/cloudtrace.agent` (Cloud Trace). `deploy_gcp.sh ai-access` grants both once Part A and Part D add them. These come on top of the pending `roles/aiplatform.user` grant.
- **Memory Bank instance:** run `scripts/setup_memory_bank.py` once. It prints the resource name to set as `NOX_MEMORY_BANK`.

---

## Part A: Agent tracing

**What.** Each unit of AI work becomes one trace in Cloud Trace: a knowledge-base build, a mission draft, an Ask turn, a co-writer turn, a sightings run, a lesson. ADK already emits spans for agents, tools and model calls, and they nest under NoX's own span for that unit of work.

**Why.** It shows how the agent team behaves in production, and helps with debugging slow or costly runs. Judges see it under "scalable and sustainable beyond the prototype".

**Build**
- New `nox_api/ai/tracing.py` with an idempotent `setup(service_name)`. With `NOX_TRACE=cloud` it installs a `TracerProvider` (resource `service.name` = `nox-api` or `nox-worker`) and a `BatchSpanProcessor` that wraps the exporter from spike 5. `NOX_TRACE=console` is for local debugging, and `off` is the local default.
- Call it in the `main.py` lifespan and in the Celery `worker_process_init` signal (`workers/tasks.py`), before any ADK `Runner` is created. ADK's docs say the provider must exist first.
- `telemetry.usage_scope(label)` also opens a span named `nox.<label>`. When the scope finishes it sets these attributes on the span: `nox.org_id`, `nox.mission`, `nox.kb_id`, tokens (input, cached, output, thinking), calls, tool calls and seconds. Because the scope lives in a context variable, ADK's spans inside it nest under it.
- The request-id log formatter adds `logging.googleapis.com/trace` when a span is active, so Cloud Logging shows the logs inside each trace.
- No prompt or response text in spans. Turn off GenAI message-content capture (ADK's flag and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`). Specs and KB pages stay out of traces.
- Optional (30 minutes): put the trace ID in the usage log line and the `ai_usage` payload, and show a *Trace* link to the Cloud console on the Impact page's flight log for the engineering-lead seat.
- Dependencies: `opentelemetry-sdk` and the chosen exporter.

**Tests.** With tracing off, nothing changes. With an in-memory exporter, a `usage_scope` produces one span with the attributes above, and a fake agent's spans nest under it.

**Done when.** On Cloud Run, a KB build and a mission draft each appear as one trace. The trace shows the workflow nodes, agents, tool calls and model calls nested, with token counts and no prompt text.

---

## Part B: `/nox` in Gemini CLI

**What.** `nox init gemini` installs NoX as a Gemini CLI extension. The extension gives Gemini CLI three things: NoX's MCP tools, a context file describing how to work on a mission, and the `/nox NOX-n` command. NoX then works the same way in both of Google's agent environments, Antigravity and Gemini CLI.

**Build**
- `packages/nox-cli/integrations/gemini/`:
  - `gemini-extension.json`: `name: "nox"`, `version`, `description`, `contextFileName: "GEMINI.md"`, and `mcpServers.nox` with `httpUrl` and `headers` (the same entry `nox mcp install gemini` writes today).
  - `GEMINI.md`: the workflow from `antigravity/SKILL.md`. Read the context, plan against the build spec's Tasks, branch, put `NOX-n` in the PR title, use the NoX tools for lookups, and never tick checklists.
  - `commands/nox.toml`: a `description`, plus a `prompt` that injects `!{nox context {{args}}}` and the workflow steps. Spike 4 decides between this and having the agent run `nox context` itself.
- `nox init gemini` writes the folder to `~/.gemini/extensions/nox/` and fills in the API URL and the user's token. If `~/.gemini/settings.json` already has a `nox` server from `nox mcp install gemini`, it offers to remove that entry, because settings.json wins on a name clash.
- Add `gemini` to `nox init all`, the help text and the CLI README.

**Tests.** In a temporary HOME, `nox init gemini` writes a manifest that parses, a command file with `{{args}}`, and no token printed to stdout.

**Done when.** In a Tidewell repo, `gemini` lists the `nox` tools, and `/nox NOX-n` loads the mission and works from the build spec.

---

## Part C: Hand off to Jules

**What.** The developer can give the build to Jules from the mission page:

1. The developer clicks **Hand off to Jules**, picks the repository (when the mission has several applications) and confirms.
2. NoX builds the prompt from the mission context, checks it with Shield, and starts a Jules session on that repository's default branch, with `requirePlanApproval: true` and `automationMode: "AUTO_CREATE_PR"`.
3. Jules's plan appears in NoX. The developer approves it, or replies to Jules.
4. Jules builds and opens a PR. NoX links it to the mission and runs the guard, the same as for a PR from Antigravity.
5. The developer reviews the PR and clicks *Mark as completed*. Reverse verification runs as usual.

**The button's states.** The developer always sees the button. Any state other than *Ready* greys it out and shows a line under the header. That line is plain text, because phones have no hover.

| State | What the developer sees |
| --- | --- |
| Not configured (no `JULES_API_KEY`) | "Jules isn't connected. An engineering lead adds it in **Atlas → Connectors**." (link) |
| Key rejected or Jules not answering | "Jules is connected but not answering: <detail>. Check it in **Atlas → Connectors**." |
| Repository not connected in Jules | "Jules can't see `<owner/repo>`. Install the Jules GitHub app on it from jules.google." |
| The app has no GitHub repository in NoX | "This application has no GitHub repository in NoX, so Jules has nothing to work on." |
| Ready | The button is enabled |
| A session is active on this repository | The button becomes the session's status ("Jules is planning", "Plan ready for you"…) |

**Backend**
- `nox_api/integrations/jules.py`: `JulesClient` on httpx, base `JULES_API_URL` (default `https://jules.googleapis.com/v1alpha`), header `x-goog-api-key`. It has a typed `JulesError`, and retries with Retry-After on 429 and 5xx, the same pattern as `integrations/jira.py`. Methods:
  - `list_sources()`
  - `create_session(prompt, title, source, starting_branch, require_plan_approval)`
  - `get_session(id)`
  - `list_activities(id, page_token)`
  - `approve_plan(id)`, which calls `:approvePlan`
  - `send_message(id, text)`, which calls `:sendMessage`
- `nox_api/missions/jules.py`:
  - `readiness(db, mission)`: the state above, per repository. The repository is the app's GitHub source monitor (`source_monitors.repo_url`). Its source name is `sources/github/<owner>/<repo>`. The source list is cached for 5 minutes.
  - `jules_prompt(db, actor, mission)`: `build_mission_context()` with a smaller KB budget (about 12k characters), plus lines for Jules:
    - Put `NOX-n` in the PR title.
    - Follow the build spec's Tasks and Test plan, and the team lessons from Part D.
    - Leave the listed contracts alone.
    - Don't tick checklists.
    - The demo repositories are reference code: if tests can't run, say so in the PR instead of fixing the environment.
  - `start(...)`: checks, Shield (`assert_pages_clean`, as for KB commits), `create_session`, and records the link and event.
  - `poll(link)`: reads the session and any new activities and updates the link's state. On `COMPLETED` it reads `outputs[].pullRequest.url`, then calls `prs.upsert_pr_link()` and spawns `guard_pr`.
- Storage: an `external_links` row with `system="jules"`, `external_id` = session ID, and `url` = the Jules web link. Its `state` holds the session state, repository, branch, plan steps, Jules's open question, last activity, PR URL and who started it. No migration.
- The words NoX shows for each session state:

  | Jules state | NoX shows |
  | --- | --- |
  | `QUEUED`, `PLANNING` | Jules is planning |
  | `AWAITING_PLAN_APPROVAL` | Plan ready for you |
  | `AWAITING_USER_FEEDBACK` | Jules has a question |
  | `IN_PROGRESS` | Jules is building |
  | `PAUSED` | Paused |
  | `COMPLETED` | PR opened (or "Finished without a PR") |
  | `FAILED` | Failed, with the reason |

- Polling: a `jules_tick` on Celery beat every 60 seconds polls sessions that are still active and less than 12 hours old. The first poll runs right after the session starts. Without beat, the tick runs in-process, the same way sightings does (`NOX_SIGHTINGS_TICK=local`).
- Events through `events.record()`: `jules.started`, `jules.plan_ready`, `jules.question`, `jules.pr_opened`, `jules.failed`. These feed the timeline, SSE, the Jira comment sync and the flight recorder.
- Routes. Each has an auth dependency and a test for the forbidden case.
  - `GET /api/v1/missions/{key}/jules`: readiness and sessions. Any seat that can see the mission.
  - `POST /api/v1/missions/{key}/jules` with `{repo, requirePlanApproval: true}`: developer seat only, Build stage only, and no other active session on that repository. Otherwise it answers 403 or 409 with the reason.
  - `POST /api/v1/missions/{key}/jules/{session}/approve-plan`: developer only.
  - `POST /api/v1/missions/{key}/jules/{session}/message` with `{text}`: developer only. The text passes `shield.screen_prompt`.
- Integrations status: a new row in `routers/integrations.py`, `("jules", False, _set(settings.JULES_API_KEY), _check_jules)`, whose detail reads "N repositories connected".

**Web**
- `components/app/jules-handoff.tsx`:
  - The button, in the developer's `FilePane` header in `app/(product)/app/missions/[key]/page.tsx`, beside *Mark as completed*.
  - The greyed-out reason line.
  - A confirm sheet with the repository picker, the starting branch, a "Let me approve Jules's plan first" box (ticked), and a short summary of what Jules receives.
- A Jules row in the *Jira & pull requests* panel: a state chip, the plan steps (collapsible), *Approve plan* and *Reply* for the developer, and *Open in Jules*. Other seats see it read-only.
- A Jules row on **Atlas → Connectors** with the three setup steps.
- Optional: "Plan ready for you" counts as waiting on the developer in Mission control.

**Tests** (`tests/test_jules.py`, with respx)
- The client's URLs, headers and request bodies.
- Readiness: no key, key rejected, repository missing, ready.
- Start is forbidden for the business, product and engineering seats (403) and outside Build (409).
- A second start on an active repository is refused.
- Polling turns each state into the right event.
- `COMPLETED` links the PR and schedules the guard.

**Done when**
- From a Tidewell mission in Build, the developer hands off to Jules, sees Jules's plan in NoX and approves it.
- Jules opens a PR titled `NOX-n: …`, which appears in the panel with the guard result.
- *Mark as completed* then starts verification as usual.
- With `JULES_API_KEY` unset, the button is greyed out with the reason and a link to Connectors.

---

## Part D: Team memory

**What.** When a person sends work back, NoX turns their reason into a short lesson for that application and seat. Later drafts for that application apply the lesson and cite it, for example "Learned from NOX-3 (Product owner)". Over time, every send-back makes the next mission's first draft closer to right.

**Where lessons come from**
1. **Not met during verification.** The `verify.not_met` note, plus the failing items and their notes.
2. **Send back while writing.** The `mission.sent_back` reason.
3. **Teach NoX.** A person writes a lesson directly on the application's page.
4. *(Stretch, cut first)* What a person added to NoX's draft before approving it. This is the difference between the last `source="nox"` version and the approved version.

Sources 1 and 2 only run when the dialog's **Remember this for next time** box is ticked.

**Learning (a job): `nox_api/missions/memory.py` `learn(event_id)`**
- Extract with `structured.ask` (FAST tier) into a new `Lessons` schema in `ai/schemas.py`. Each item has a `fact`, `seats`, `quote` and `kind` (`team_rule` | `quality_bar` | `domain_fact`). The rules:
  - Keep only what applies to future changes on this application. Drop one-off bugs like "the button is missing".
  - One sentence per lesson.
  - No people's names.
- Ground check: the `quote` must appear in the feedback text (after normalising), or the lesson is dropped. A lesson aimed at the business seat must also pass `lenses.lint_view(Role.business, …)`. If it fails, it applies only to the technical seats.
- Store it through the backend below. Then record `memory.learned` with the fact, its source mission and whether it is new or merged, and push it over SSE.
- Wrap it in `telemetry.usage_scope("memory:learn")`.

**Storage (migration `0010_team_memory`)**

`team_memories` holds the record of what's active and where each lesson came from:

| Column | Holds |
| --- | --- |
| `id`, `org_id`, `kb_id` | Which lesson, for which organization and application |
| `seat` | The seat it applies to (null = every seat) |
| `fact`, `kind` | The lesson and its kind |
| `status` | `active`, `forgotten` or `superseded` |
| `sources` | JSON list of `{missionKey, eventId, quote, by, at}` |
| `bank_name` | The Memory Bank memory resource name |
| `embedding` | JSON, used by the Postgres backend |
| `applied_count`, `created_at`, `updated_at`, `forgotten_by`, `forgotten_at` | Use and history |

**Backends (`nox_api/services/team_memory.py`, `NOX_MEMORY=memory_bank|postgres|off`)**
- **`memory_bank`** uses the Agent Platform Memory Bank instance named in `NOX_MEMORY_BANK`.
  - Writing: `memories.generate(...)` with `direct_memories_source={"direct_memories": [{"fact": …}]}` (up to 5 facts per call), `scope={"app": <slug>, "seat": <role or "all">}`, and `config={"wait_for_completion": True, "metadata": {"nox_org": …, "nox_mission": …}}`. Memory Bank consolidates the new facts with what it already has in that scope.
  - Each memory in the response has an action, which NoX handles like this:

    | Action | What NoX does |
    | --- | --- |
    | `CREATED` | Adds a new row |
    | `UPDATED` | Fetches the memory, updates its row's fact and appends the source |
    | `DELETED` | The new fact contradicted an older one: marks that row `superseded` and says so on the timeline |

  - Reading: `memories.retrieve(...)` with similarity search for each scope. Matching on scope is exact, so a draft queries `{app, seat}` and `{app, "all"}` for each application on the mission. NoX then keeps only rows that are active in Postgres.
  - Forgetting deletes the memory in Memory Bank and marks the row forgotten.
  - `scripts/setup_memory_bank.py` creates the instance with:
    - custom memory topics `team_rule`, `quality_bar` and `domain_fact`, each with a description and two few-shot examples
    - our DEFAULT-tier model for generation
    - `gemini-embedding-2` for similarity, which needs a `global`, `us` or `eu` location
- **`postgres`** is for local development, NoX Local and tests. It embeds with `services/search.embed`. A new fact within cosine 0.88 of an active lesson in the same scope adds a source to that lesson instead of a new row. Retrieval is cosine top-k in Python, because each application has few lessons. This is the same approach as sightings dedupe.

**Using lessons**
- `drafting.build_prompt(..., lessons=…)` and the co-writer's refine and chat turns get a block headed "What this team has taught NoX about <app>", listing lesson IDs. The rules for the writer:
  - Apply a lesson where it's relevant.
  - Upstream files win over a lesson.
  - Cite `[[memory:<id>]]` where the reader brief allows citations. The business file gets no inline citations, as today.
- At most 6 lessons per draft, retrieved with the mission's title and request as the query.
- Record `memory.applied` with `{role, ids}` when the draft or turn is saved, and increment `applied_count`.
- `build_mission_context()` adds a "Team lessons" section for the engineering and developer seats. Antigravity, Gemini CLI and Jules then follow the lessons too.

**Web**
- The Send back and Not met dialogs get the "Remember this for next time" box.
- The timeline shows "NoX learned: <fact>", with *Forget* for seats allowed to forget.
- The file header gets a chip like "2 lessons applied". It opens a list of each lesson, where it was learned ("NOX-3 · Product owner · 8 Oct") and a link to that mission.
- `components/app/markdown.tsx` renders `[[memory:<id>]]` as a small "lesson" chip that opens the same list.
- The Atlas app page gets a **What NoX has learned** panel (`FEED_LIST`). It filters by seat and has *Forget* and a *Teach NoX* input.

**API and access**
- `GET /api/v1/kb/{kb_id}/memories`: `SEE_ATLAS`, and the app must be visible to the caller.
- `POST /api/v1/kb/{kb_id}/memories` with `{fact, seat?}`: `CURATE_MEMORY`. It goes through the same store, so it is consolidated too.
- `DELETE /api/v1/memories/{id}`: `CURATE_MEMORY`, or the person who taught or caused the lesson.
- `SendBack` and `Verdict` get `remember: bool = True`.
- New `Cap.CURATE_MEMORY` for the product, engineering and developer seats, the same seats as `PIN_CORRECTION`.

**Tests** (`tests/test_team_memory.py`, with fakes in `tests/ai_fakes.py`)
- Extraction keeps general lessons and drops one-off bugs.
- A lesson whose quote isn't in the feedback is dropped.
- Unticking the box learns nothing.
- Near-duplicates merge into one lesson with two sources (Postgres backend).
- A lesson from app A never reaches a draft for app B.
- A forgotten lesson is not retrieved.
- The business seat can't forget a lesson (403).
- The draft prompt includes the lessons, and `memory.applied` is recorded.
- The Memory Bank adapter handles CREATED, UPDATED and DELETED, tested against a fake client.

**Done when**
- On a Tidewell mission, the product owner marks an item Not met with "the lockout message must not reveal whether the account exists" and the box ticked. The lesson appears on the app's page, with that mission as its source.
- A new mission on the same app gets a product spec and build spec that include the rule, with a lesson chip.
- After someone forgets the lesson, the next draft doesn't use it.
- This works with both backends.

---

## Part E: Voice

**Why not the Live API.** The Live API keeps a two-way audio session open over a WebSocket. On Cloud Run that means a proxy, session limits and paying for every second the session is open. NoX's real work happens in ADK agents and jobs, so a voice-native agent would duplicate the co-writer. What people need is to say the request instead of typing it. Push-to-talk plus one transcription call does that, is cheaper, and leaves the person in control of what gets sent.

### E1. Speak

- `components/app/voice-input.tsx` is a mic button for text boxes. It goes on:
  - the New mission request
  - the co-writer chat dock
  - Ask (the app page and the business home)
  - the Send back reason
  - the Not met note
- Interaction: click to start and click to stop, and Esc cancels. The waveform comes from `media/use-voice-recorder.ts` (max 120 seconds). Then the box shows "Transcribing…" and the text streams in. **NoX never sends the text by itself.** The person edits it and sends it as usual.
- `POST /api/v1/voice/transcribe`:
  - Takes a multipart upload of up to 120 seconds and 8 MB, as `audio/webm`, `ogg`, `mp4` or `wav`. Bad input gets 413 or 415.
  - Streams SSE `delta` events, then `done` with `{text, language, english}`.
  - Open to any signed-in seat, rate-limited to 30 per user per hour (a Redis counter).
- `ai/agents/voice.py` holds the transcriber agent, on the FAST tier or `NOX_MODEL_TRANSCRIBE` (spike 2), with the audio as an inline part.
  - Instruction: write down what was said, fixing only obvious recognition errors against a vocabulary list. Never summarise, never answer.
  - The vocabulary is up to 200 terms from the caller's **visible** applications: app and team names, KB entity titles and open mission keys. This is where NoX beats generic speech-to-text: it hears "claims-intake" and "TWCLM", not "claims in take".
- `runtime.stream` learns to take `parts`, as `runtime.run` already does.
- The audio stays in memory and is dropped after transcription. It is never stored or committed.
- Other languages: if the spoken language isn't English, the box shows the spoken words with a *Use English* chip that swaps in the English version from the same call.
- `GET /api/v1/voice/status` returns `{speak, listen}`, so the UI hides the buttons in NoX Local (Gemma) or when a model isn't available.

### E2. Listen (optional, on request)

- A speaker button on NoX's chat replies and Ask answers. It never plays on its own, and a second click stops it.
- `POST /api/v1/voice/speak` with `{text}` returns audio. `ai/speech.py` calls Gemini TTS directly through google-genai, the way embeddings already work, with `NOX_MODEL_TTS` and `NOX_TTS_VOICE`, inside `usage_scope("voice:speak")`.
- The text is prepared before speaking:
  - Markdown is stripped and wikilinks become their labels.
  - Code blocks are skipped.
  - The limit is 1,200 characters. A longer answer reads its first paragraphs and ends with "The rest is on screen."
- Audio is cached under a hash of (text, voice, model) in `services/storage` (local or GCS), so replays cost nothing.

**Cost.** At current prices, transcription is roughly half a cent per minute, and a spoken reply is well under a cent. Confirm both against the pricing page in spike 2.

**Tests**
- Auth on all three routes.
- Size and type limits.
- The vocabulary only includes visible applications.
- The transcriber, faked in `ai_fakes`, streams deltas.
- `speak` strips markdown and serves the second call from cache.
- `status` hides both buttons in local mode.

**Done when**
- At phone width, a business user speaks a request on New mission, edits the text and starts the mission.
- A Hindi request offers *Use English*.
- *Listen* on a chat reply plays NoX's voice, and a second play comes from the cache.

---

## Settings

| Variable | Part | Default | Notes |
| --- | --- | --- | --- |
| `NOX_TRACE` | A | `off` locally, `cloud` on Cloud Run | `console` for local debugging |
| `JULES_API_KEY` | C | — | Secret Manager. Never sent to the browser |
| `JULES_API_URL` | C | `https://jules.googleapis.com/v1alpha` | |
| `NOX_MEMORY` | D | `postgres` | `memory_bank` on Cloud Run, `off` to disable |
| `NOX_MEMORY_BANK` | D | — | Memory Bank resource name from `scripts/setup_memory_bank.py` |
| `NOX_MODEL_TRANSCRIBE` | E | the FAST model | |
| `NOX_MODEL_TTS` | E | — | Empty hides Listen |
| `NOX_TTS_VOICE` | E | one fixed NoX voice | |

Each one goes into `core/config.py`, `.env.example` and `deploy_gcp.sh`.

## Docs to update

| Where | What changes |
| --- | --- |
| `apps/web/content/docs/04-missions.md` | Remember this for next time, lessons on files, speaking instead of typing |
| `03-atlas.md` | What NoX has learned, Teach NoX |
| `05-build-and-verify.md` | Hand off to Jules, `/nox` in Gemini CLI |
| `06-integrations.md` | Jules setup, the Gemini CLI extension |
| `07-google-ai.md` | Memory Bank, Cloud Trace, Gemini transcription and TTS |
| `08-architecture.md` | `team_memories`, the new jobs and ticks, settings |
| `09-roadmap.md` | Move "Voice for the first sentence" and Agent Engine memory to Recently shipped, worded as built |
| `AGENTS.md` | Repo map, the AI layer table (`tracing.py`, `speech.py`, `agents/voice.py`), the flows table (learn, Jules, voice), the principle 6 wording |
| `docs/DEMO_SCRIPT.md` | The new beats below |
| `docs/IMPLEMENTATION_PLAN.md` | Status row and progress log |

---

## Schedule

| Date | Work |
| --- | --- |
| Thu 8 Oct | Deploy the current build. Run spikes 1–5. Manual steps: Jules key and GitHub app, IAM |
| Fri 9 Oct | A. Tracing (morning) · B. Gemini CLI (afternoon) |
| Sat 10 – Sun 11 Oct | C. Hand off to Jules. **Team formation closes on 11 Oct** |
| Mon 12 – Tue 13 Oct | D. Team memory |
| Wed 14 Oct | E. Voice: E1, then E2 if there's time |
| Thu 15 Oct | Buffer. **No new features after today** |
| Fri 16 Oct | Redeploy, live checks for every part, docs, rehearsal |
| Sat 17 Oct | Record the video, update the deck |
| Sun 18 Oct | Submit |

**If time runs short, cut in this order:**
1. E2 Listen
2. D's fourth source (learning from edits)
3. *Reply to Jules*, keeping *Approve plan*
4. The trace link on the Impact page
5. D's *Teach NoX* input

## Risks

| Risk | What we do |
| --- | --- |
| The Jules API is alpha and may change | All calls sit in one client with typed errors. Readiness turns any failure into a greyed-out button with a reason, never a broken page |
| Jules can't run the demo repos' tests (they are reference code) | The prompt tells it to say so in the PR. People verify as usual |
| Jules's own usage limits | The demo needs a handful of sessions. Do a dry run before recording |
| Memory Bank doesn't take custom scope keys | Encode the scope in `user_id` (spike 1) |
| The transcription or TTS model isn't available in our location | Transcribe on the FAST model. Hide Listen (spike 2) |
| Mic recording on iOS Safari | `use-voice-recorder.ts` already picks a supported type. Test at phone width on a real phone |
| Six days of feature work before a deadline | Build order puts the cheapest parts first. Freeze on 15 Oct, and use the cut list |

## How it shows in the 3-minute video

- **Opening:** the business user speaks the request at phone width, and it appears in the box (E).
- **Product owner:** the draft already has a rule "learned from NOX-3" (D).
- **Developer:** *Hand off to Jules*, approve the plan, and the PR appears with the guard result (C). Mention that `/nox` also works in Antigravity and Gemini CLI (B).
- **Verification:** a Not met with "Remember this" ticked becomes a new lesson on the timeline (D).
- **Under the hood slide:** a Cloud Trace view of one mission draft (A).
