# CP16: The knowledge-base builder as an ADK workflow

**In one sentence:** rebuild the orchestration in `ai/agents/kb_builder.py` as an ADK 2 graph `Workflow`: cartographer → parallel page writers → cross-link synthesis → lint gate ⇄ reviewer loop → finish. Every output stays the same Open Knowledge Format (OKF 0.2) bundle with the same cross-application links, and nothing downstream changes.

**Why:** today the builder is a well-designed team of agents held together by `asyncio.gather` and a one-shot reviewer. Expressing it as an ADK workflow graph has three benefits:

- Judges who know ADK recognise the pattern at a glance, which counts toward technical merit (40%).
- The reviewer becomes a real loop. It keeps fixing until the quality gate passes, up to a bound, instead of one pass.
- The build becomes a graph the UI can draw live as nodes run (the agent graph panel, section 7).

The second part of this checkpoint is **explicit context caching** for Ask and co-writer sessions, with the cache hit rate shown in the product.

**Estimate:** about 3 days: a ½ day spike, 1½ days building the workflow, ½ day for caching, ½ day for the UI and bench.

---

## 1. What must not change (the contract)

This is the checklist for review. Every item has a test (section 6).

### 1.1 The function the rest of NoX calls

`kb_builder.build(context, raw, *, log=None, local=None) -> tuple[dict[str, str], ArchitectureMap]` keeps its signature and meaning. Callers that must keep working without edits:

- `agents/runner.py:184` (Flow A)
- `local.py:133` (NoX Local)
- `scripts/bench_kb.py:46`
- `tests/test_ai_kb_builder.py`

### 1.2 The files it returns

- `index.md` = `amap.summary` (the architecture overview, starting `# <app>`).
- One file per planned page under `summaries/`, `entities/`, `concepts/`, `decisions/`, with the paths as planned.
- `AGENTS.md` (`compiler._generate_agents_contract`), `log.md` (`compiler._generate_log_timeline`) and `.nox/brief.md` (`digest.generate_architecture_digest`).
- **No OKF frontmatter is added inside the builder.** OKF headers, folder `index.md` files, the root contents section and the date-grouped `log.md` are applied later, at commit time, by `runner._as_okf` → `okf.to_okf` (principle 7). The builder's output must stay plain Markdown so `to_okf` behaves exactly as today. Page bodies must keep `# Title` as their first heading, because `okf._title` and `okf._description` read the title and description from the body.

### 1.3 Links inside and across applications (the core of the platform)

- **Local links** are Obsidian `[[wikilinks]]` to manifest paths (`compiler._build_manifest`), repaired by `compiler.run_synthesis_pass`: leaf names are resolved, and unknown targets become code spans so there are no broken links.
- **Cross-application links:**
  - The writers' shared prefix includes `compiler._build_cross_kb_manifest(context.candidate_contracts)`.
  - `run_synthesis_pass(..., candidate_contracts=...)` deterministically weaves backticked identifiers of matched contracts into `[[ap:<kb-repo>/<path>#<anchor>|<App> (<identifier>)]]` links, and preserves every `[[ap:…]]` and `[[kb:…]]` link.
  - `agents/linter.py` `check_wikilinks` accepts both prefixes.
  - Nothing in this checkpoint changes either link form. The `ap:` (manifest) versus `kb:` (docs, Ask, `AGENTS.md`) naming is a known inconsistency; it's out of scope here and noted in section 9.
- **New guarantee:** synthesis also runs **after** every reviewer round. Today it runs only before review, so a page the reviewer rewrites can lose woven cross-app links or regain broken local ones. Running it after each round closes that gap. Synthesis has to be idempotent for this to work (tested).

### 1.4 Other outputs

- **Interfaces:** the returned `ArchitectureMap` is the cartographer's map, unchanged. `runner` passes `amap.interfaces` to `contracts.register_kb_contracts`, which is what builds the organisation's contract map and the cross-app candidates for the *next* app's build.
- **Code anchors:** pages under `summaries/` and `entities/` get `<!-- anchor: path:Lx-Ly sha:… -->` lines over their real source files (`_anchors`). The gatekeeper (Flow B) uses them to decide which pages a push touches, and `okf.header` turns them into OKF `sources`.
- **Checkpoints and resume:**
  - The same storage keys: `architecture_map.json`, `plan.json`, `summary.md`, `pages/<path>`, `compiled_files.json`.
  - The same meaning: a restarted build reuses the map and finished pages and makes no model calls for them.
  - `runner` still skips the builder entirely when `compiled_files.json` is complete.
- **Flight log events** (the build progress UI and SSE rely on them): `cartographer_started`, `plan_ready`, `page_compiled` (one per page), `review_started` and `build_usage`, with the same payload keys and in the same order. New events may be added; none are renamed or removed.
- **Implicit caching:**
  - Every writer shares one identical `static_instruction`: writer rules, `SYSTEM_COMPILER`, app name, overview, interfaces, the page manifest and the cross-KB manifest.
  - The first page is written alone before the rest fan out, to warm the cache.
- **Grounding:** each writer sees only its assigned files (`_assigned_code`), with the keyword fallback when none resolve.
- **Failure isolation:** a writer that fails produces the placeholder page ("NoX couldn't write this page in this build; it will be retried on the next sync"), not a failed build.
- **Reviewer scope:** never rewrites `index.md`, `AGENTS.md`, `log.md` or dotfiles.
- **NoX Local:** concurrency 1, `config.local_model()` (Gemma via Ollama or LiteLLM), local budgets, cartographer fed by chunk summaries.
- **Telemetry:** one `telemetry.usage_scope(f"kb-build:{app}")` covers every model call in the build, including calls made inside workflow nodes.
- **Untouched:**
  - `NOX_KB_BUILDER=classic` (`compiler.run_compiler`)
  - Flow B (gatekeeper and patch compiler)
  - Flow C (org rollup)
  - `okf.py`, `linter.py` and `contracts.py`, apart from the idempotence test

---

## 2. Design

### 2.1 Why the ADK 2 graph `Workflow`

The installed `google-adk` is 2.10.0. It ships `google.adk.workflow`:

- `Workflow` with `edges`, and routes that allow loops
- the `@node` decorator with `parallel_worker=True`, `max_parallel_workers`, `retry_config` and `timeout`
- `FunctionNode` for deterministic Python steps
- `JoinNode`
- `ctx.route` to choose an edge
- `ctx.run_node` to run a node (such as an `LlmAgent`) dynamically from inside another
- resume from session events

This fits the builder better than ADK 1's `SequentialAgent`, `ParallelAgent` and `LoopAgent`. Half of the builder is deterministic Python (synthesis, lint, anchors, checkpoints), and those composites are built for LLM agents.

**Fallback:** if the spike (section 3) fails a go criterion, build the same shape with `SequentialAgent`, `ParallelAgent` and `LoopAgent`, with small custom `BaseAgent` subclasses for the deterministic steps. The contract in section 1 is the same either way.

### 2.2 The graph

```text
 START
   │
   ▼
 cartographer ──(checkpoint hit: no model call)
   │  ArchitectureMap, plan
   ▼
 warm_cache         writes plan[0] alone (shared prefix gets cached)
   │
   ▼
 write_pages        parallel_worker over plan[1:], max_parallel_workers = concurrency
   │                each item: checkpoint hit → reuse; else run page_writer LlmAgent → anchors → checkpoint
   ▼
 synthesize         run_synthesis_pass(files, plan, candidate_contracts)      ◀──────┐
   │                                                                               │
   ▼                                                                               │
 lint_gate          run_linter(files, plan) → failing pages (errors + schema warnings)
   │ route "fix" if failing and round < MAX_REVIEW_ROUNDS                         │
   │ route "done" otherwise                                                        │
   ├──── "fix" ──▶ review   parallel_worker over failing pages: page_writer "Revise…" ┘
   │
   └──── "done" ─▶ finish   AGENTS.md, log.md, .nox/brief.md, compiled_files.json checkpoint
                     │
                    END
```

- `MAX_REVIEW_ROUNDS = 2` (setting `NOX_REVIEW_ROUNDS`).
  - Round 1 is today's behaviour.
  - Round 2 runs only for pages that still fail, and only with the problems still listed.
  - After the last round, pages that still fail stay as they are. The PR body's quality gate section (`lint_summary_markdown`) already reports them for the human reviewer.
- `max_concurrency` on the `Workflow` is left unset. Fan-out is bounded by `max_parallel_workers` on the two parallel nodes: `NOX_MAX_CONCURRENCY`, or 1 in local mode.
- Retries: model retries already happen inside the model (`config._RETRY`, `FallbackModel`). Nodes get `RetryConfig(max_attempts=1)` so a failure isn't retried twice. The writer node catches its own exception and returns the placeholder page (section 1.4).

### 2.3 Where the data lives

- **Don't put the snapshot in session state.** `raw` and the parsed `corpus` can be megabytes. ADK session state is copied into events, so large state would bloat memory and slow every node.
- Keep a per-build `BuildRun` object in a module-level registry keyed by a build id:
  - fields: `context`, `raw`, `corpus`, `images`, `amap`, `plan`, `files`, `static`, `writer`, `local`, `budget`, `sha`, `log`, `round`
  - Nodes read it through `ctx.state["build_id"]`.
  - It's removed in a `finally` when `build()` returns.
- **Session state holds only small values:**
  - `build_id`, `apps`, `home_app` (the writers' tool scope, as today)
  - `round`, `failing` (path → problems)
  - `pages_done` (paths)
- **Checkpoints stay in storage** through `services/local_storage` exactly as today. That's the resume mechanism NoX already depends on, including across Cloud Run instances. ADK's own resume from session events isn't relied on, because pipeline sessions use `InMemorySessionService`.

### 2.4 Running the workflow

- `build()` keeps its opening: backend choice, `extract_images`, `parse_corpus`, `forget_source_snapshot`, and `telemetry.usage_scope`.
- It then runs the workflow through `runtime.run(workflow, "build", state={...})`. `runtime.run` accepts any ADK root node. If `Runner` needs an `App` wrapper for a `Workflow` root, add that in `runtime._runner`, the one place that touches runners.
- Events keep flowing to `log` from inside nodes, the same calls as today.

### 2.5 Writers as nodes

- The `page_writer` `LlmAgent` (`_writer`) is unchanged: `static_instruction` is the shared prefix and `include_contents="none"`.
- Inside the `write_pages` worker, each page runs it with `ctx.run_node(writer, message)` so the model call is part of the workflow's trace. If the spike shows `run_node` can't carry per-call messages cleanly, keep `runtime.run(writer, message, state=…)` inside the node. It already works, and the graph shape stays the same.
- `write_page`, `_assigned_code`, `_anchors` and `SCHEMA_RULE` are reused as they are.

---

## 3. Spike (half a day, before any refactor)

Build `kb_builder_graph.py` beside the current builder with a two-page fake plan, and check these five go criteria:

1. A parallel worker with `max_parallel_workers=2` runs 4 items with at most 2 at once. Measure it with a counter in the fake model.
2. `lint_gate` → `review` → `synthesize` → `lint_gate` loops and stops on the "done" route. Two rounds, then done.
3. `telemetry.usage_scope` counts every fake model call made inside nodes, meaning context variables reach the worker tasks. If they don't, capture the `Usage` object in `BuildRun` and add to it explicitly.
4. It works with `tests/ai_fakes.py` `use_fake` (the fake replaces the model the writer holds).
5. It runs on the local model path. Do a smoke test with `NOX_AI_BACKEND=local` against Ollama if it's available; otherwise use a LiteLLM fake.

**Result:** if all five pass, go with `Workflow`. If criterion 1, 2 or 4 fails, use the ADK 1 composite fallback. Write the outcome in Resume notes.

---

## 4. Build steps

1. Move the orchestration body of `build()` into node functions in `kb_builder.py`:
   - `cartographer_node`, `warm_cache_node`, `write_pages_node`, `synthesize_node`, `lint_gate_node`, `review_node` and `finish_node`.
   - Keep the helpers (`map_architecture`, `write_page`, `review`'s fix function, `_writer`) where they are.
2. Keep the current linear orchestration as `_build_linear()` behind `NOX_KB_WORKFLOW=linear`, so the bench can compare the two. The default is `graph` once the bench passes. Remove `linear` after the contest.
3. Split `review()` into a pure "which pages fail and why" step (lint gate) and a "fix these pages" worker. Keep the message text **exactly** as today ("Revise the page '…' to fix these quality-gate problems, changing nothing else: …"), because tests and the fakes key on it.
4. Emit the existing log events from the same points. Add:
   - `review_round`: `{round, pages}`, plus the message "Reviewer round 2: fixing 1 page".
   - `quality_gate`: `{passed, errors, warnings}`.
   - `node_started` / `node_finished`: `{node}`, used by the graph panel in section 7.
5. `runtime.py`: accept a `Workflow` root. No other runtime change.
6. Make `run_synthesis_pass` provably idempotent, as it's now called more than once:
   - Add a test.
   - If the weaving regex can double-wrap an identifier inside an existing `[[ap:…|… (ident)]]` label, tighten it to skip identifiers already inside a `[[…]]`.

---

## 5. Part two: explicit context caching and showing it

**What exists:** writers rely on Gemini's implicit caching through the shared prefix, and `telemetry.Usage` already records `cached_tokens` and `cached_share`.

**What to add:**

1. **Ask and co-writer sessions** (multi-turn, the same long instruction and tool results repeated) get ADK's `ContextCacheConfig` through an `App(..., context_cache_config=ContextCacheConfig(min_tokens=…, ttl_seconds=600, cache_intervals=…))` in `runtime._runner`, for the persistent-session runs only (`stream` with `persistent_sessions`).
   - ADK only caches from the second turn, and only once the prefix passes the model's minimum (4096 tokens for Gemini 3). Ask's instruction plus tool results passes that after the first lookups.
   - Setting: `NOX_CONTEXT_CACHE=on|off`, default `on` in the enterprise and api_key backends and ignored in local mode.
   - The `ContextCacheConfig` class is marked experimental in ADK 2.10. Keep it behind the setting.
2. **Show it:**
   - The app page's build card: after a build, show `usage.line()` as "Built by NoX's agents · 31 calls · 412k tokens · 38% cached · 2m 14s". The `build_usage` event already carries it.
   - The Ask footer: "4 lookups · 62% cached" from the Ask turn's usage.
   - BigQuery `ai_usage` (CP14 Part C) gets `cached_tokens`. The Impact page shows the org's cache share.
3. `scripts/bench_kb.py` prints cached share, and gets a `--compare linear graph` mode.

---

## 6. Tests

**All existing tests pass unchanged:**
- `test_ai_kb_builder.py`, in particular:
  - "each writer saw only its own files"
  - "shared, cacheable prefix"
  - "anchors point at the page's real files"
  - "reviewer fixed only the failing page, exactly one Revise call"
  - the event order `["cartographer_started", "plan_ready", …, "build_usage"]`
  - resume with no model calls
- Also: `test_okf.py`, `test_cross_kb_mesh.py`, `test_ai_local.py`, `test_engine_regressions.py`, `test_linter.py` and `test_digest.py`.

**New tests** in `test_ai_kb_builder.py` unless noted:

| Test | Proves |
| --- | --- |
| `test_graph_and_linear_produce_the_same_bundle` | For the fake responder, `graph` and `linear` return the same file set and the same page bodies |
| `test_bundle_is_okf_conformant_after_commit_transform` | `okf.problems(okf.to_okf(files, existing={}, app=…, repo_url=…, actor=…))` is empty; every folder has an `index.md`; the root index declares `okf_version: "0.2"` |
| `test_cross_app_links_survive_review` | With a `candidate_contracts` entry for `nte.trades.matched`, a page that failed lint and was rewritten by the reviewer still contains the woven `[[ap:kb-…/…\|order-matching-engine (nte.trades.matched)]]` link in the final output |
| `test_synthesis_is_idempotent` (`test_cross_kb_mesh.py`) | Running `run_synthesis_pass` twice gives the same files as running it once, with local and cross-app links |
| `test_review_loops_until_clean_then_stops` | The first fix still fails → a second round runs for that page only; a page that never passes stops after `NOX_REVIEW_ROUNDS` with its last version kept |
| `test_writer_failure_leaves_placeholder` | One page's fake raises → the placeholder text; the build completes; `page_compiled` is still emitted |
| `test_parallel_writers_respect_concurrency` | With `NOX_MAX_CONCURRENCY=2`, at most 2 writer calls are ever in flight |
| `test_resume_mid_writing` | Half the pages checkpointed → only the missing pages call the model |
| `test_local_mode_runs_one_at_a_time` (`test_ai_local.py`) | Local mode: concurrency 1, local model used |
| `test_contracts_from_graph_build` | `contracts_from_interfaces` on the graph build's map and files gives the same contracts as the linear build |
| `test_usage_counts_calls_inside_nodes` | `build_usage` reports every fake call |
| `test_context_cache_config_applied_to_ask_only` (`test_ai_ask.py`) | The Ask runner carries the cache config; pipeline one-shot runs don't |

**Live checks before switching the default to `graph`:**
1. `scripts/bench_kb.py <kb-id> --compare linear graph` on **order-matching-engine** and **trade-settlement-system**. Compare pages, lint errors after review, calls, tokens, cached share and wall time. Accept if lint errors are ≤ linear, and calls and time are within +15% (the extra review round is the only allowed growth).
2. `uv run python -m nox_api.agents.okf check --all` → every KB "OKF 0.2 conformant".
3. Onboard order-matching-engine, then trade-settlement-system:
   - The second KB links to the first with cross-app links for `nte.trades.matched`.
   - Ask on the second app follows a `[[kb:…]]` / `[[ap:…]]` link into the first.
   - The contract map shows the edge.
4. Push a small change to a demo repo. Flow B's gatekeeper still finds the touched page through its anchors, and the patch PR is OKF.

---

## 7. UI: the agent graph panel (optional, ½ day)

- On the app page's build progress (`atlas/apps/[kbId]`), show a small left-to-right diagram of the graph nodes:
  - Nodes: Cartographer → Writers (n/m) → Links → Quality gate ⇄ Reviewer → Done.
  - Each lights up from the `node_started` / `node_finished` events.
  - The writer node shows a count as `page_compiled` events arrive.
  - The reviewer shows its round.
- Plain SVG, and the seat hue for the active node.
- At phone width it stacks vertically.
- This is the 10-second shot in the video that shows the ADK workflow is real, not a slide.

---

## 8. Docs

- `apps/web/content/docs/07-google-ai.md`: the builder as an ADK workflow graph (with a diagram), the review loop, and explicit context caching for conversations.
- `apps/web/content/docs/08-architecture.md`: update the build pipeline section.
- `AGENTS.md` (repo root): the `ai/agents/kb_builder.py` row in the AI layer table.
- The module docstring of `kb_builder.py`: the new shape of the flow (per AGENTS.md, module docstrings explain the flow).

## 9. Out of scope, noted

- Unifying `[[ap:<repo>/…]]` (compiler manifest and synthesis) and `[[kb:<app>/…]]` (docs, Ask, `AGENTS.md`, drafting) into one cross-app link form. Both are accepted everywhere today. Changing it touches the linter, synthesis, Ask citations and every stored KB, so it deserves its own change after the contest.
- Moving the builder onto Vertex AI Agent Engine (roadmap).
- Rewriting Flow B's patch compiler as a workflow.

## 10. Done when

- [ ] The spike's result is recorded, and the builder runs as an ADK workflow (graph, or the composite fallback).
- [ ] Every test in section 6 passes, and `make test` and `make lint` pass.
- [ ] The bench comparison is recorded in Resume notes, and the default is switched to `graph`.
- [ ] Live: two demo apps built on Cloud Run, OKF check passes, and cross-app links, contracts, Ask and Flow B all work.
- [ ] Ask shows a cached share above 0% from the second turn, on the deployed app.
- [ ] The docs tell the truth.

## Resume notes

_Not started._
