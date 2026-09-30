"""Building a knowledge base with a team of agents, orchestrated as an ADK 2 workflow graph.

    START → cartographer → warm_cache → write_pages → synthesize → lint_gate ──"done"──▶ finish → END
                                          (parallel)       ▲              │
                                                           └── review ◀──"fix" (parallel, at most NOX_REVIEW_ROUNDS)

The cartographer reads the whole snapshot once and returns a typed ArchitectureMap: the overview, the components,
the interfaces the application exposes and consumes, and the page plan with the exact source files behind each
page. That replaces three sequential calls (index → summary → plan) and the keyword guessing of which code a page
needs. Writers share one identical prefix (rules, overview, manifest, interfaces) via `static_instruction`, so
Gemini's implicit caching can reuse it across pages; `warm_cache` writes the first page alone to warm it, then
`write_pages` fans out as a parallel worker bounded by NOX_MAX_CONCURRENCY. Each writer gets only its own files.

`synthesize` repairs local wikilinks and weaves cross-application `[[ap:…]]` links; `lint_gate` runs the
deterministic linter and routes the failing pages to `review`, which rewrites only those, then back through
`synthesize` (idempotent) so a rewrite can't lose a woven link. The loop ends when the gate passes or the rounds
run out; pages that still fail are listed in the PR's quality-gate section for the human reviewer. `finish` adds
AGENTS.md, log.md and the agent brief. The output is plain Markdown: OKF headers are added at commit time.

Deterministic steps are FunctionNodes; the page writer is an LlmAgent each node runs as a child with
`ctx.run_node`, so every model call is in the graph's trace and counted by `telemetry.usage_scope`. The snapshot
and pages live in a per-build `BuildRun`, not in session state (which is copied into events); checkpoints stay in
storage, so a restarted build reuses the map and finished pages. Nodes emit node_started / node_finished for the
graph panel in the app. NOX_KB_WORKFLOW=linear keeps the pre-workflow orchestration for the bench.

Local mode (NoX Local, Gemma): the same graph, with a small-context cartographer fed by per-chunk summaries and
writers and reviewer running one at a time.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from google.adk.agents import LlmAgent
from google.genai import types

from ...agents.anchors import generate_anchor_tag
from ...agents.compiler import (
    SYSTEM_COMPILER,
    _build_cross_kb_manifest,
    _build_manifest,
    _filter_raw_code,
    _generate_agents_contract,
    _generate_log_timeline,
    run_synthesis_pass,
)
from ...agents.digest import generate_architecture_digest
from ...agents.linter import LintReport, run_linter
from ...core.config import settings
from ...services.local_storage import load_checkpoint_json, load_kb_content, save_checkpoint_json, upload_content
from .. import config, runtime, structured, telemetry
from ..schemas import ArchitectureMap
from ..tools.knowledge import forget_source_snapshot, grep_source, parse_corpus, read_source_file

logger = logging.getLogger(__name__)

LogFn = Callable[[str, dict], Awaitable[None]] | None
CallFn = Callable[[str], Awaitable[str]] | None   # how a node runs the page writer on one message

PAGE_CODE_BUDGET = 60000      # characters of assigned source per page (remote)
LOCAL_CODE_BUDGET = 16000     # Gemma's window is smaller
CARTOGRAPHER_BUDGET = 2_400_000

CARTOGRAPHER = """You are the cartographer of a software application's knowledge base. From the source snapshot,
produce its architecture map:
- summary: a Markdown architectural overview (purpose, main components, data flows, key design decisions, how to run
  it). It becomes the knowledge base's index page, so start with '# <application name>'.
- components: the main components, one line each.
- interfaces: every interface the application exposes or consumes (REST routes with method and path, event topics,
  queues, gRPC services, database tables it owns, shared libraries), with exact identifiers from the code.
- pages: the knowledge-base pages to write, at most {max_pages}. Cover the application thoroughly, one focused page
  per idea rather than a few broad ones: 'summaries/' for API, interface and module references (always include
  'summaries/api-spec.md' when the app exposes endpoints, topics or messages); 'entities/' one per significant
  component and one per core data model; 'concepts/' one per flow, lifecycle or cross-cutting mechanism (e.g. startup,
  caching, error handling, security, configuration); 'decisions/' one per architecture decision the code or docs make
  evident, each separately. Even a small service usually warrants 10 or more pages. For each page list the exact
  source file paths (as they appear after '--- FILE:' or '=== SOURCE:') it must be grounded in, most important first,
  at most 12.
Only describe what the snapshot shows. Never invent files, endpoints or names."""

WRITER_RULES = """You write one page of a software application's knowledge base (a code wiki read by engineers, product
people and coding agents).
- Ground every statement in the source files you are given. Use exact names, paths, routes, fields and types.
- If the given files don't show something, leave it out or note it as unknown. Never invent anything.
- Cross-reference other pages with Obsidian [[wikilinks]] using the paths in the manifest below.
- Output only the page's Markdown, starting with '# <title>'. No preamble, no code fence around the page.
"""

SCHEMA_RULE = {
    "entities/": "Include '## Responsibilities' and '## Dependencies' sections.",
    "decisions/": "Write it as an ADR with '## Status', '## Context', '## Decision' and '## Consequences' sections.",
}


# ── Helpers ─────────────────────────────────────────────────────────────────

def extract_images(raw: str) -> tuple[str, list[bytes]]:
    images: list[bytes] = []

    def grab(m):
        try:
            images.append(base64.b64decode(m.group(1)))
        except Exception:
            pass
        return "[IMAGE ATTACHED FOR VISION]"

    return re.sub(r'<nox_image_payload base64="([^"]+)"\s*/>', grab, raw), images


def _interfaces_text(amap: ArchitectureMap) -> str:
    rows = [f"- {i.direction} {i.kind} `{i.identifier}`" + (f": {i.description}" if i.description else "") for i in amap.interfaces[:80]]
    return "\n".join(rows) or "(none found)"


def _assigned_code(corpus: dict[str, str], files: list[str], raw: str, topic: str, budget: int) -> tuple[str, list[str]]:
    """The page's own files, in the cartographer's order, within budget; keyword fallback if none resolve."""
    out, used, size = [], [], 0
    by_suffix = {p.rsplit("/", 1)[-1]: p for p in corpus}
    for f in files:
        path = f if f in corpus else by_suffix.get(f.rsplit("/", 1)[-1])
        if not path or path in used:
            continue
        body = corpus[path]
        room = budget - size
        if room <= 500:
            break
        chunk = body if len(body) <= room else body[:room] + "\n…[truncated]"
        out.append(f"--- FILE: {path} ---\n{chunk}")
        used.append(path)
        size += len(chunk)
    if not out:
        return _filter_raw_code(raw, topic, max_chars=budget), []
    return "\n\n".join(out), used


def _anchors(corpus: dict[str, str], used: list[str], sha: str) -> str:
    """Code anchors over the page's real files, so the gatekeeper can tell which pages a diff touches."""
    tags = []
    for path in used[:3]:
        if path.startswith("http"):
            continue
        lines = corpus[path].count("\n") + 1
        tags.append(generate_anchor_tag(path, 1, lines, sha))
    return "\n".join(tags)


# ── Agents ──────────────────────────────────────────────────────────────────

async def map_architecture(context, raw: str, images: list[bytes], *, local: bool, max_pages: int) -> ArchitectureMap:
    """The cartographer. Whole snapshot when it fits; per-chunk summaries (plus the file list) when it doesn't."""
    from ...agents.ingestor import _chunk_by_files, _map_chunks_local, _map_chunks_remote

    corpus = parse_corpus(raw)
    limit = LOCAL_CODE_BUDGET * 2 if local else CARTOGRAPHER_BUDGET
    if len(raw) <= limit:
        material = raw
    else:
        chunks = _chunk_by_files(raw, settings.LOCAL_CHUNK_SIZE if local else 400000)
        summaries = await (_map_chunks_local(chunks) if local else _map_chunks_remote(chunks))
        material = "File summaries:\n" + "\n\n".join(summaries)
    files_list = "\n".join(f"- {p}" for p in list(corpus)[:600])
    prompt = (f"Application: {context.app_name}\n\nFiles in the snapshot:\n{files_list}\n\n"
              f"Source snapshot:\n{material}")
    parts = [types.Part.from_bytes(data=img, mime_type="image/png") for img in images[:8]] if images and not local else None
    return await structured.ask(
        ArchitectureMap, prompt, name="cartographer", instruction=CARTOGRAPHER.format(max_pages=max_pages),
        tier=config.Tier.DEEP, local=local, parts=parts,
    )


def _writer(static: str, local: bool, tools: bool = False) -> LlmAgent:
    """Writers work from the files the cartographer assigned them: measured on real apps, lookup tools here cost
    ~2× the calls and ~3× the tokens for no better pages, so they're off by default."""
    return LlmAgent(
        name="page_writer",
        model=config.local_model() if local else config.model(config.Tier.DEFAULT),
        static_instruction=static,     # identical for every page: the shared, cacheable prefix
        tools=[read_source_file, grep_source] if tools else [],
        include_contents="none",
    )


async def write_page(writer: LlmAgent, page: dict, *, corpus: dict[str, str], raw: str, budget: int, sha: str,
                     state: dict, call: CallFn = None) -> str:
    path, topic = page["path"], page.get("topic", "")
    code, used = _assigned_code(corpus, page.get("source_files") or [], raw, topic, budget)
    rule = next((r for prefix, r in SCHEMA_RULE.items() if path.startswith(prefix)), "")
    message = (f"Write the page '{path}'.\nTopic: {topic}\n{rule}\n\n"
               f"Source files for this page:\n{code}")
    md = (await call(message) if call else (await runtime.run(writer, message, state=state)).text).strip()
    md = re.sub(r"^```(?:markdown|md)?\s*\n(.*)\n```\s*$", r"\1", md, flags=re.S).strip()
    if (path.startswith("summaries/") or path.startswith("entities/")) and "<!-- anchor:" not in md:
        anchors = _anchors(corpus, used, sha)
        if anchors:
            md = f"{anchors}\n\n{md}"
    return md + "\n"


REVISE = "Revise the page '{path}' to fix these quality-gate problems, changing nothing else:\n"
PROTECTED = ("index.md", "AGENTS.md", "log.md")  # the reviewer never rewrites these, nor dotfiles


def lint_gate(files: dict[str, str], plan: list[dict]) -> tuple[dict[str, list[str]], LintReport]:
    """The quality gate, pure: which pages fail (errors, or missing required sections) and why."""
    report = run_linter(files, plan)
    failing: dict[str, list[str]] = {}
    for issue in [*report.errors, *(w for w in report.warnings if w.category == "schema")]:
        if issue.file_path in files and issue.file_path not in PROTECTED and not issue.file_path.startswith("."):
            failing.setdefault(issue.file_path, []).append(issue.message)
    return failing, report


async def fix_page(writer: LlmAgent, path: str, problems: list[str], page: str, *, state: dict, call: CallFn = None) -> str:
    """The reviewer's fix for one failing page; on any failure the page stays as it was."""
    msg = REVISE.format(path=path) + "\n".join(f"- {p}" for p in problems) + f"\n\nThe page:\n{page}"
    try:
        text = (await call(msg) if call else (await runtime.run(writer, msg, state=state)).text).strip()
        return (text + "\n") if text else page
    except Exception as e:
        logger.warning(f"Reviewer could not fix {path}: {e}")
        return page


async def review(files: dict[str, str], plan: list[dict], writer: LlmAgent, state: dict, log: LogFn,
                 concurrency: int) -> dict[str, str]:
    """One reviewer pass (the linear builder): lint, then rewrite only the failing pages, once."""
    failing, _ = lint_gate(files, plan)
    if not failing:
        return files
    if log:
        await log("review_started", {"pages": sorted(failing), "message": f"Reviewer fixing {len(failing)} page(s) that failed the quality gate"})
    sem = asyncio.Semaphore(concurrency)

    async def fix(path: str, problems: list[str]) -> tuple[str, str]:
        async with sem:
            return path, await fix_page(writer, path, problems, files[path], state=state)

    for path, md in await asyncio.gather(*[fix(p, probs) for p, probs in failing.items()]):
        files[path] = md
    return files


# ── One build ───────────────────────────────────────────────────────────────

@dataclass
class BuildRun:
    """Everything one build works on. Kept out of ADK session state on purpose: the snapshot and corpus can be
    megabytes, and session state is copied into events. Workflow nodes find it by `build_id` in state."""

    context: Any
    raw: str
    corpus: dict[str, str]
    images: list[bytes]
    local: bool
    log: LogFn
    max_pages: int = 0
    concurrency: int = 1
    budget: int = PAGE_CODE_BUDGET
    sha: str = ""
    amap: ArchitectureMap | None = None
    plan: list[dict] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)
    writer: LlmAgent | None = None
    state: dict = field(default_factory=dict)       # the writers' tool scope, set by NoX
    round: int = 0
    failing: dict[str, list[str]] = field(default_factory=dict)
    node: str = ""                                   # the graph node running now (for node_started / node_finished)

    @property
    def kb_id(self) -> str:
        return self.context.kb_id

    @property
    def contracts(self) -> list:
        return getattr(self.context, "candidate_contracts", None) or []

    async def emit(self, kind: str, payload: dict) -> None:
        if self.log:
            await self.log(kind, payload)

    async def enter(self, node: str) -> None:
        """Mark a graph node as running; the graph panel lights nodes up from these events."""
        prev, self.node = self.node, node   # set first: parallel workers all enter at once
        if node == prev:
            return
        if prev:
            await self.emit("node_finished", {"node": prev, "round": self.round})
        if node:
            await self.emit("node_started", {"node": node, "round": self.round})


async def _map(run: BuildRun) -> None:
    """The cartographer (or its checkpoint), the plan, and the writer every page shares."""
    cached = load_checkpoint_json(run.kb_id, "architecture_map.json")
    if cached:
        amap = ArchitectureMap.model_validate(cached)
    else:
        await run.emit("cartographer_started", {"files": len(run.corpus), "message": f"Cartographer mapping {len(run.corpus)} files: components, interfaces and the page plan"})
        amap = await map_architecture(run.context, run.raw, run.images, local=run.local, max_pages=run.max_pages)
        save_checkpoint_json(run.kb_id, "architecture_map.json", amap.model_dump())
    plan = [p.model_dump() for p in amap.pages[:run.max_pages] if p.path.endswith(".md") and "/" in p.path]
    save_checkpoint_json(run.kb_id, "plan.json", {"pages": plan})
    upload_content(run.kb_id, "summary.md", amap.summary)
    await run.emit("plan_ready", {"pages": [p["path"] for p in plan], "interfaces": len(amap.interfaces),
                                  "message": f"Architecture mapped: {len(plan)} pages planned, {len(amap.interfaces)} interfaces found"})
    static = "\n\n".join([
        WRITER_RULES, SYSTEM_COMPILER, f"Application: {run.context.app_name}",
        f"Architecture overview:\n{amap.summary}",
        f"Interfaces:\n{_interfaces_text(amap)}",
        f"KNOWLEDGE BASE PAGE MANIFEST (link with [[wikilinks]]):\n{_build_manifest(plan)}"
        + _build_cross_kb_manifest(run.contracts),
    ])
    run.amap, run.plan, run.writer = amap, plan, _writer(static, run.local)
    run.files = {"index.md": amap.summary.strip() + "\n"}


async def _page(run: BuildRun, page: dict, call: CallFn = None) -> str:
    """One planned page: its checkpoint if a previous run finished it, else a writer; a failure leaves a placeholder."""
    path = page["path"]
    done = load_kb_content(run.kb_id, f"pages/{path}")
    if done:
        run.files[path] = done
        return done
    try:
        md = await write_page(run.writer, page, corpus=run.corpus, raw=run.raw, budget=run.budget, sha=run.sha,
                              state=run.state, call=call)
    except Exception as e:
        logger.warning(f"Page writer failed on {path}: {e}")
        md = f"# {page.get('topic') or path}\n\n> NoX couldn't write this page in this build; it will be retried on the next sync.\n"
    upload_content(run.kb_id, f"pages/{path}", md)
    await run.emit("page_compiled", {"path": path, "topic": page.get("topic", ""), "message": f"Compiled documentation section: {page.get('topic') or path}"})
    run.files[path] = md
    return md


async def _synthesize(run: BuildRun) -> None:
    # Pages finish in any order; keep the bundle in plan order so both builders return the same dict.
    order = ["index.md", *(p["path"] for p in run.plan)]
    run.files = {**{k: run.files[k] for k in order if k in run.files}, **run.files}
    run.files = await run_synthesis_pass(run.files, run.plan, candidate_contracts=run.contracts)


def _finish(run: BuildRun) -> None:
    """The deterministic finish the classic pipeline always had, then the whole-build checkpoint."""
    app, org = run.context.app_name, run.context.org_slug
    run.files["AGENTS.md"] = _generate_agents_contract(app, org)
    run.files["log.md"] = _generate_log_timeline(app, run.sha)
    run.files[".nox/brief.md"] = generate_architecture_digest(app, org, run.files)
    save_checkpoint_json(run.kb_id, "compiled_files.json", run.files)


async def _build_linear(run: BuildRun) -> None:
    """The orchestration before CP16 (asyncio fan-out, one reviewer pass). Kept behind NOX_KB_WORKFLOW=linear so
    the bench can compare the two; remove after the contest."""
    await _map(run)
    sem = asyncio.Semaphore(run.concurrency)

    async def one(page: dict) -> None:
        if load_kb_content(run.kb_id, f"pages/{page['path']}"):
            await _page(run, page)
            return
        async with sem:
            await _page(run, page)

    if run.plan:
        await one(run.plan[0])  # warms the shared prefix for the rest
        await asyncio.gather(*[one(p) for p in run.plan[1:]])
    await _synthesize(run)
    run.files = await review(run.files, run.plan, run.writer, run.state, run.log, run.concurrency)
    _finish(run)


# ── The workflow graph ──────────────────────────────────────────────────────
#
#   START → cartographer → warm_cache → write_pages → synthesize → lint_gate ─"done"→ finish
#                                        (parallel)       ▲             │
#                                                         └── review ◀─"fix" (parallel, bounded rounds)

_RUNS: dict[str, BuildRun] = {}


def _run_of(ctx) -> BuildRun:
    return _RUNS[ctx.state["build_id"]]


def _caller(ctx, run: BuildRun) -> CallFn:
    """Run the shared page writer as a child node of this workflow node, so the model call is in the graph's trace."""

    async def call(message: str) -> str:
        return _output_text(await ctx.run_node(run.writer, node_input=message))

    return call


def _output_text(out) -> str:
    if isinstance(out, str):
        return out
    if isinstance(out, types.Content):
        return "".join(p.text or "" for p in out.parts or [] if not getattr(p, "thought", False))
    return "" if out is None else str(out)


async def cartographer_node(ctx, node_input=None) -> None:
    run = _run_of(ctx)
    run.node = "cartographer"  # no node_started: cartographer_started / plan_ready already open the flight log
    await _map(run)


async def warm_cache_node(ctx, node_input=None) -> list[str]:
    """The first page alone, so the writers' shared prefix is cached before the rest fan out."""
    run = _run_of(ctx)
    if not run.plan:
        return []
    await run.enter("warm_cache")
    await _page(run, run.plan[0], _caller(ctx, run))
    return [p["path"] for p in run.plan[1:]]


async def write_pages_node(ctx, node_input: str) -> str:
    """One item of the parallel fan-out: a page path in, the same path out (the page itself stays in the BuildRun)."""
    run = _run_of(ctx)
    await run.enter("write_pages")
    page = next(p for p in run.plan if p["path"] == node_input)
    await _page(run, page, _caller(ctx, run))
    return node_input


async def synthesize_node(ctx, node_input=None) -> None:
    """Link repair and cross-application weaving; runs again after every reviewer round (idempotent)."""
    run = _run_of(ctx)
    await run.enter("synthesize")
    await _synthesize(run)
    ctx.state["pages_done"] = sorted(p for p in run.files if p != "index.md")


async def lint_gate_node(ctx, node_input=None) -> list[str] | None:
    """Route "fix" with the failing pages while rounds remain, otherwise "done". Pages that still fail after the
    last round stay as they are; the PR's quality-gate section lists them for the human reviewer."""
    run = _run_of(ctx)
    await run.enter("lint_gate")
    failing, report = lint_gate(run.files, run.plan)
    passed = not failing
    await run.emit("quality_gate", {
        "passed": passed, "errors": len(report.errors), "warnings": len(report.warnings), "round": run.round,
        "pages": sorted(failing),
        "message": "Quality gate passed" if passed else f"Quality gate: {_pages(len(failing))} need{'s' if len(failing) == 1 else ''} fixes",
    })
    if failing and run.round < max(0, settings.NOX_REVIEW_ROUNDS):
        run.round += 1
        run.failing = failing
        ctx.state["round"], ctx.state["failing"] = run.round, failing
        if run.round == 1:
            await run.emit("review_started", {"pages": sorted(failing), "message": f"Reviewer fixing {len(failing)} page(s) that failed the quality gate"})
        else:
            await run.emit("review_round", {"round": run.round, "pages": sorted(failing),
                                            "message": f"Reviewer round {run.round}: fixing {_pages(len(failing))}"})
        ctx.route = "fix"
        return sorted(failing)
    ctx.route = "done"
    return None


def _pages(n: int) -> str:
    return f"{n} page" if n == 1 else f"{n} pages"


async def review_node(ctx, node_input: str) -> str:
    run = _run_of(ctx)
    await run.enter("review")
    run.files[node_input] = await fix_page(run.writer, node_input, run.failing[node_input], run.files[node_input],
                                           state=run.state, call=_caller(ctx, run))
    return node_input


async def finish_node(ctx, node_input=None) -> None:
    run = _run_of(ctx)
    await run.enter("finish")
    _finish(run)
    await run.enter("")


def workflow(concurrency: int):
    """The builder as an ADK 2 graph. Fan-out is bounded per node by `max_parallel_workers`, not on the Workflow.
    Model retries already happen inside the model (config._RETRY, FallbackModel), so nodes run once."""
    from google.adk.workflow import START, RetryConfig, Workflow, node

    once = RetryConfig(max_attempts=1)

    def step(fn, name: str, **kw):
        return node(fn, name=name, retry_config=once, **kw)

    # Nodes that run the writer as a child node must be re-runnable on resume (an ADK requirement for run_node).
    cartographer = step(cartographer_node, "cartographer")
    warm_cache = step(warm_cache_node, "warm_cache", rerun_on_resume=True)
    write_pages = node(write_pages_node, name="write_pages", rerun_on_resume=True, parallel_worker=True,
                       max_parallel_workers=concurrency)
    synthesize = step(synthesize_node, "synthesize")
    gate = step(lint_gate_node, "lint_gate")
    reviewer = node(review_node, name="review", rerun_on_resume=True, parallel_worker=True,
                    max_parallel_workers=concurrency)
    finish = step(finish_node, "finish")
    return Workflow(name="kb_build", edges=[
        (START, cartographer, warm_cache, write_pages, synthesize, gate),
        (gate, {"fix": reviewer, "done": finish}),
        (reviewer, synthesize),
    ])


async def _build_graph(run: BuildRun) -> None:
    build_id = uuid.uuid4().hex
    _RUNS[build_id] = run
    try:
        await runtime.run(workflow(run.concurrency), "build", state={"build_id": build_id, **run.state})
    finally:
        _RUNS.pop(build_id, None)


# ── Entry point ─────────────────────────────────────────────────────────────

async def build(context, raw: str, *, log: LogFn = None, local: bool | None = None) -> tuple[dict[str, str], ArchitectureMap]:
    """Build every page of the knowledge base. Resumable: the map and each page are checkpointed as they finish."""
    local = config.backend() == "local" if local is None else local
    raw, images = extract_images(raw)
    run = BuildRun(
        context=context, raw=raw, corpus=parse_corpus(raw), images=images, local=local, log=log,
        max_pages=settings.LOCAL_MAX_PAGES if local else settings.REMOTE_MAX_PAGES,
        concurrency=1 if local else max(1, settings.NOX_MAX_CONCURRENCY),
        budget=LOCAL_CODE_BUDGET if local else PAGE_CODE_BUDGET,
        sha=getattr(context, "commit_sha", "") or "",
        state={"apps": {context.app_name: context.kb_id}, "home_app": context.app_name},
    )
    forget_source_snapshot(run.kb_id)  # writers' lookup tools must read this build's snapshot

    with telemetry.usage_scope(f"kb-build:{context.app_name}") as usage:
        if settings.NOX_KB_WORKFLOW.strip().lower() == "linear":
            await _build_linear(run)
        else:
            await _build_graph(run)

    if log:
        await log("build_usage", {**usage.summary(), "message": f"Knowledge base built by NoX's agents: {usage.line()}"})
    logger.info(json.dumps({"event": "nox.kb.build", "app": context.app_name, "pages": len(run.plan), **usage.summary()}))
    return run.files, run.amap
