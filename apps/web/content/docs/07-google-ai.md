# Agentic AI on Google

NoX is agentic in a specific sense. Its AI doesn't answer from memory: it looks things up with tools, acts on what it finds (writing pages, editing spec files, opening pull requests, moving tickets), and shows its work as it goes. People stay in charge of every decision that matters. NoX drafts, refines, checks and cites, and a person approves.

Those agents are built with **Google's Agent Development Kit (ADK)** and run on **Gemini**, served from the **Gemini Enterprise Agent Platform**. The same agents run on **Gemma** for NoX Local. What they write, the knowledge base every other agent relies on, follows Google Cloud's **Open Knowledge Format**. This chapter explains how.

## The agents

| Agent | What it does | Model tier | Tools and output |
| --- | --- | --- | --- |
| **Cartographer** | Reads an application's whole source snapshot once and maps it, planning the knowledge base's OKF pages | Deep | Typed `ArchitectureMap`: overview, components, interfaces, page plan with the source files for each page |
| **Page writers** | Write the knowledge-base pages, in parallel | Default | Each gets only its own files; can fetch another with a tool |
| **Reviewer** | Rewrites the pages that fail the deterministic linter | Default | Only failing pages are touched |
| **Gatekeeper** | Decides whether a push or document change matters to the knowledge base | Fast | Code anchors first, then a typed `GatekeeperDecision` |
| **Patch compiler** | Rewrites only the affected pages after a significant change | Default | Typed `PagePatch` |
| **Coverage diff** | When a source is added later, finds what is new versus already documented | Default | Typed `CoverageDiff` |
| **Rollup** | Writes the organization-level knowledge base across applications | Deep | Typed `RollupResult` |
| **Ask** | Answers questions about an application, citing what it read | Default | `search_kb`, `read_kb_page`, `list_pages`, `find_interfaces`, `grep_source`, `read_source_file`, `get_jira_issue` |
| **Co-writer** | Refines a spec file after a save and edits it on request | Default | The lookup tools, plus `read_spec_file`, `replace_section`, `insert_section`, `append_to_section`, `add_open_question` |
| **Drafter** | Writes the first draft of each spec file | Default | The lookup tools |
| **Perceive** | Watches a screen recording, screenshot or voice note | Default | Typed `MediaObservation`: transcript, moments, screens, exact strings |
| **Ground** | Ties a capture to applications, knowledge-base pages and code | Default | The lookup tools; typed `MediaGrounding` |

Two simpler jobs call Gemini through the `google-genai` SDK directly rather than as agents: the ingestor's per-file summaries of large sources, and the original single-model build path, kept behind `NOX_KB_BUILDER=classic` for comparison. Around all of them sit deterministic checks that need no model at all: the **linter** (page structure, wikilinks, orphans, stubs), the **secret gate**, the **guard** that checks pull requests against architecture rules, and **code anchors** that tie page sections to source lines.

## Knowledge in Google's Open Knowledge Format

An agent is only as good as the knowledge it can reach. NoX's knowledge bases are written in the **Open Knowledge Format (OKF)**, the open specification Google Cloud published for knowledge that agents and people share ([Google Cloud blog: *How the Open Knowledge Format can improve data sharing*](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing); [specification and reference agent](https://github.com/GoogleCloudPlatform/open-knowledge-format)).

OKF formalises the pattern NoX's agents already follow, in which agents maintain a Markdown library that teams curate like code, and makes it portable:

- **One page per concept, with typed frontmatter.** Every page carries a `type` (Component, Concept, Architecture Decision, Interface Reference) and the recommended `title`, `description`, `resource` and `tags`.
- **Provenance and trust fields.** `sources` names the code files each page is anchored to, and `generated` records which agent wrote it and when: `nox/gemini-3.7-flash` in the cloud, `nox-local/gemma4:12b` on a laptop. These are the fields OKF's trust model is built on; recording the human review of each knowledge-base pull request in OKF's `verified` field is on the [roadmap](/docs/roadmap).
- **Progressive disclosure.** A root `index.md` declaring `okf_version: "0.2"`, an `index.md` in every folder listing its pages with their descriptions, and a date-grouped `log.md`. An agent reads a few lines to know where to look, then opens only the pages it needs. That keeps Ask and the co-writer grounded and their context bounded.
- **Portable by design.** Because the knowledge is a standard OKF bundle in Git, it isn't locked into NoX: any OKF-aware agent, tool or visualiser can read an application's knowledge base as it is.

NoX extends OKF for knowledge that spans an enterprise: `[[kb:other-app/page]]` links join the bundles of many applications into one map, and source anchors tie each page to the lines of code it describes. These extensions stay within the specification, which asks consumers to tolerate links and keys they don't recognise.

The conversion is one deterministic step (`agents/okf.py`) that runs on every commit: the first build, every gatekeeper sync, every added source, every NoX Local push and every organization rollup. `python -m nox_api.agents.okf check <kb-id>` reports conformance, and every knowledge-base pull request states it in its quality gate.

## How NoX uses the Agent Development Kit

All AI code lives in `apps/api/nox_api/ai/`. Everything that touches ADK's runners goes through one small runtime, so the rest of NoX sees two calls: `run(agent, message)` for one-shot work, and `stream(agent, message)` for conversations that stream to the browser.

**Agents are `LlmAgent`s with real tools.** Tools are plain async Python functions that ADK exposes to the model, each with a docstring the model reads. They receive ADK's `ToolContext`, which is how they find out what the caller is allowed to see.

**Scope is set by NoX, never by the model.** Before an agent runs, NoX writes the caller's permissions into the ADK session state: which applications their memberships allow, which mission file is open, which seat they're in. Tools read that state. A prompt can't talk an agent into another team's knowledge base, because the tool that would read it doesn't have the access.

**Sessions persist where they should.** One-shot pipeline runs use ADK's `InMemorySessionService`. Conversations that need to remember (Ask, and the co-writer's chat) use ADK's `DatabaseSessionService` on the same Postgres, in its own `adk` schema, so a follow-up question keeps its context across requests and across Cloud Run instances.

**Streaming shows the work.** The runtime turns ADK's event stream into three kinds of message for the browser: a *step* for each tool call ("Reading concepts/state-hydration…"), a *delta* for each piece of answer text, and *done* with the citations and usage. The co-writer broadcasts each section edit the moment its tool call lands, so the author watches NoX type into the file.

**Structured output is typed.** One-shot jobs (the cartographer's map, the gatekeeper's decision, a page patch, the rollup) are ADK agents constrained to a Pydantic schema, and their answers come back as validated objects rather than text to parse.

**Parallel tool calls.** Ask and the co-writer are told to send independent lookups together (read three pages at once, run two searches at once). Gemini returns them as parallel function calls, so most questions are answered in two to four lookups.

## Gemini

**Model tiers, not model names.** Every agent asks for a tier, and configuration decides the model behind it:

| Tier | Used for | Setting |
| --- | --- | --- |
| **Fast** | Small structured calls: the gatekeeper, classification | `NOX_MODEL_FAST` |
| **Default** | Most writing: pages, spec files, answers | `GEMINI_MODEL` (`gemini-3.7-flash`) |
| **Deep** | Whole-codebase reasoning: the architecture map, the organization rollup | `NOX_MODEL_DEEP` |

**Resilience.** Each Gemini model is wrapped with retry options (exponential backoff on transient errors), and ADK's `FallbackModel` switches to `GEMINI_BACKUP_MODEL` (`gemini-3.5-flash`) if the primary model fails. A busy model slows a build down; it doesn't break it.

**Implicit context caching.** The page writers share one identical prefix (the writing rules, the architecture overview, the page manifest and the interface list), passed as ADK's `static_instruction`. The first page runs alone to warm the cache, then the rest run in parallel and reuse it. Telemetry records the cached share of every build.

**Long context.** The cartographer reads a whole application snapshot in a single call, up to about 2.4 million characters, replacing three sequential calls and the keyword guessing about which files each page needs.

**Multimodal.** Diagrams and screenshots found in sources (for example an architecture diagram on a Confluence page) are sent to Gemini as images alongside the text, so they inform the pages. Screen recordings, screenshots and voice notes that people show NoX are watched by Gemini directly (see Show NoX below).

**The measured difference.** On the demo's market-data-gateway, NoX's agent team builds the knowledge base in **29 seconds** from **12 model calls** and **20k input tokens**. The classic single-model pipeline took 252 seconds, 19 calls and 85k tokens on the same snapshot (writing 16 broader pages, where the agent team plans 11 focused ones). `scripts/bench_kb.py` reproduces the comparison on any knowledge base.

## The Gemini Enterprise Agent Platform

In production, NoX reaches Gemini through the **Gemini Enterprise Agent Platform** (formerly Vertex AI), not a public API key:

- Cloud Run services call Gemini **as their own service account**. `scripts/deploy_gcp.sh ai-access` grants it `roles/aiplatform.user`, and that's all the access it needs. There is no Gemini API key in the deployment to leak or rotate.
- NoX uses the **global endpoint**, where the newest Gemini models are served first.
- Throughput comes from the project's Agent Platform quota, which suits a team building many knowledge bases at once better than per-key rate limits do.

One setting, `NOX_AI_BACKEND`, picks where every agent, embedding and cache call goes: `enterprise` (the Agent Platform, the default whenever a GCP project is configured), `api_key` (the Gemini Developer API, for local development), or `local` (Gemma, below). The agents themselves don't change.

## Hybrid search with Gemini embeddings

Ask, the co-writer, the drafter and `nox search` all find knowledge through one search service:

1. **Chunking.** Each page is split at its `##` headings into chunks of a few hundred tokens.
2. **Embedding.** Chunks are embedded with **`gemini-embedding-2`** at 768 dimensions, with separate task types for documents and queries, and stored in **pgvector**.
3. **Fusion.** A query runs two rankings (vector similarity for meaning, and Postgres full-text search for exact identifiers like `order.refunded` or `POST /refund`) and fuses them with reciprocal rank fusion.
4. **Incremental.** After a sync, only chunks whose text changed are re-embedded. Only compiled knowledge-base Markdown is ever embedded, never raw source code.

So "refunds" finds a page that says "reversal", and an exact topic name still ranks its page first. Without embeddings, search falls back to full-text alone and keeps working.

## Gemma: NoX Local

Some organizations can't send certain code to any cloud service. **NoX Local** runs the same ADK agents on **Gemma**, on the developer's own machine, through **Ollama**:

- The default model is **Gemma 4** (`gemma4:12b`, about 8 GB, which fits a 16 GB laptop); `gemma4:e4b` suits smaller machines. Gemma 4 calls tools natively through ADK's LiteLLM connector.
- **Gemma 3** works too, through ADK's `Gemma3Ollama` model, which adds function calling to it.
- NoX raises Ollama's context window to 16k tokens (its 4k default quietly truncates prompts) and turns Gemma 4's thinking off by default, making builds about four times faster locally. `NOX_LOCAL_THINK=true` turns it back on for hard repositories.
- The pipeline adapts to a smaller model: the cartographer works from per-chunk summaries instead of the whole snapshot, and page writers run one at a time.
- Only the finished Markdown is sent to NoX, which lints it, indexes it and opens the knowledge-base pull request. The knowledge base records that it was built with `local:gemma4:12b`, and the Atlas shows it.

## Show NoX: Gemini watches, the agents ground it

When someone records their screen or leaves a voice note, NoX sends it to Gemini as it is, not as frames or a transcript made elsewhere. Gemini watches the video and listens to the narration in one call.

- **Files go by reference.** On the Agent Platform, the capture is uploaded straight from the browser to Cloud Storage with a signed URL, and Gemini reads it from there with `Part.from_uri`. The bytes never pass through NoX's API. With an API key, small files go inline and large ones through the Gemini Files API.
- **Media resolution.** Captures over a minute are sampled at low media resolution, shorter ones at medium, and video at one frame a second. That keeps a five-minute recording to a few thousand tokens while text on screen stays readable.
- **Perceive, then ground.** The first call (Perceive) is constrained to a `MediaObservation` schema: only what is seen and heard, with times, and the exact strings on screen. It isn't allowed to guess about code. The second step (Ground) is an ADK agent with the knowledge tools. It searches the knowledge bases the uploader can see for those strings, reads the pages that explain them, and greps the source, returning a typed `MediaGrounding`.
- **Checked after the model.** A deterministic post-check drops any page the agent didn't actually read, any code location that isn't in the application's snapshot, and any application outside the uploader's scope.
- **Written per seat.** One fast call rewrites the result for each seat, so the business user's version never mentions code. This runs inside the job, so opening a capture never waits on a model.

The drafter and co-writer receive the capture's moments and findings as evidence, and cite them as `[[media:id#t=42]]`, which the app shows as a ▶ chip.

## Grounding and trust

Enterprise AI has to be checkable. NoX's rules:

- **Everything is cited.** A knowledge-base page (`[[kb:app/page]]`), an upstream spec file, a source line (`path:line`) or a Jira field. The UI turns citations into links.
- **Unknowns become questions.** If the tools don't show something, NoX says so or adds an open question to the file. It doesn't invent endpoints, names, files or numbers.
- **Edits are narrow and reversible.** The co-writer edits one section per tool call, can't remove a heading the author wrote, and saves each turn as one version that one click undoes.
- **Nothing is approved by AI.** Approval, verification and send-back are always a person's action.
- **Pages are checked before they're committed.** The linter, the secret gate and the pull-request review stand between any model output and the knowledge base.

## Measuring it

- **Usage per unit of work.** Every build, Ask turn and co-writer turn runs inside a telemetry scope that adds up model calls, input, cached, output and thinking tokens, tool calls and wall time across all its agents, including parallel ones. Each scope ends in one structured log line that **Cloud Logging** indexes.
- **Ask eval.** `scripts/eval_ask.py` asks golden questions about the demo applications and scores each answer on whether it cited the right pages, contained the expected facts, and how fast it was.
- **Show NoX eval.** `scripts/eval_media.py` runs golden captures of the demo trade desk and checks that the right application ranks first, the right pages are cited and the right code is found.
- **Build benchmark.** `scripts/bench_kb.py` compares build strategies on the same snapshot: wall time, calls, tokens and cache share.

## Google Cloud underneath

| Service | Role in NoX |
| --- | --- |
| **Gemini Enterprise Agent Platform** | Every agent's model calls and embeddings, authenticated by service account |
| **Open Knowledge Format** (Google Cloud's open specification) | The format of every knowledge base NoX writes, so the knowledge is portable to any OKF-aware agent |
| **Cloud Run** | `nox-api`, `nox-worker` and `nox-web`, each scaled independently |
| **Cloud Build** and **Artifact Registry** | Building and storing the container images |
| **Cloud SQL for PostgreSQL** with **pgvector** | All application data, ADK sessions and the search index |
| **Memorystore for Redis** | The Celery job queue and live event fan-out, reached by Direct VPC egress |
| **Cloud Storage** | Source snapshots, build checkpoints, uploads and spec-file images |
| **Secret Manager** | Every credential, mounted into Cloud Run at deploy time |
| **Cloud Logging** | Request logs with request IDs, and per-job AI usage lines |
| **Firebase Authentication** | Google sign-in for people; ID tokens verified on every request |

On the developer's side, **Google Antigravity** is one of the coding agents `/nox` installs into, and **Gemma** powers NoX Local.
