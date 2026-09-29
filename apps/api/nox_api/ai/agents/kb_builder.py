"""Building a knowledge base with a team of agents.

    sources ─▶ Cartographer ─▶ Page writers (in parallel) ─▶ Reviewer ─▶ files
               one call:        one per planned page,          lint first, then fix
               map + plan       grounded in its own files      only failing pages

The cartographer reads the whole snapshot once and returns a typed ArchitectureMap: the overview, the components,
the interfaces the application exposes and consumes, and the page plan with the exact source files behind each
page. That replaces three sequential calls (index → summary → plan) and the keyword guessing of which code a page
needs. Writers share one identical prefix (rules, overview, manifest, interfaces) via `static_instruction`, so
Gemini's implicit caching can reuse it across pages; the first page runs alone to warm it. Each writer gets only its
own files and may fetch another with a tool. The reviewer runs the deterministic linter and rewrites only the pages
that fail it.

Local mode (NoX Local, Gemma): the same agents, with a small-context cartographer fed by per-chunk summaries and
writers running one at a time.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from collections.abc import Awaitable, Callable

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
from ...agents.linter import run_linter
from ...core.config import settings
from ...services.local_storage import load_checkpoint_json, load_kb_content, save_checkpoint_json, upload_content
from .. import config, runtime, structured, telemetry
from ..schemas import ArchitectureMap
from ..tools.knowledge import forget_source_snapshot, grep_source, parse_corpus, read_source_file

logger = logging.getLogger(__name__)

LogFn = Callable[[str, dict], Awaitable[None]] | None

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
                     state: dict) -> str:
    path, topic = page["path"], page.get("topic", "")
    code, used = _assigned_code(corpus, page.get("source_files") or [], raw, topic, budget)
    rule = next((r for prefix, r in SCHEMA_RULE.items() if path.startswith(prefix)), "")
    message = (f"Write the page '{path}'.\nTopic: {topic}\n{rule}\n\n"
               f"Source files for this page:\n{code}")
    result = await runtime.run(writer, message, state=state)
    md = result.text.strip()
    md = re.sub(r"^```(?:markdown|md)?\s*\n(.*)\n```\s*$", r"\1", md, flags=re.S).strip()
    if (path.startswith("summaries/") or path.startswith("entities/")) and "<!-- anchor:" not in md:
        anchors = _anchors(corpus, used, sha)
        if anchors:
            md = f"{anchors}\n\n{md}"
    return md + "\n"


async def review(files: dict[str, str], plan: list[dict], writer: LlmAgent, state: dict, log: LogFn,
                 concurrency: int) -> dict[str, str]:
    """Deterministic lint first; the model only rewrites pages with errors or missing required sections, once."""
    report = run_linter(files, plan)
    failing: dict[str, list[str]] = {}
    for issue in [*report.errors, *(w for w in report.warnings if w.category == "schema")]:
        if issue.file_path in files and issue.file_path not in ("index.md", "AGENTS.md", "log.md") and not issue.file_path.startswith("."):
            failing.setdefault(issue.file_path, []).append(issue.message)
    if not failing:
        return files
    if log:
        await log("review_started", {"pages": sorted(failing), "message": f"Reviewer fixing {len(failing)} page(s) that failed the quality gate"})
    sem = asyncio.Semaphore(concurrency)

    async def fix(path: str, problems: list[str]) -> tuple[str, str]:
        async with sem:
            msg = (f"Revise the page '{path}' to fix these quality-gate problems, changing nothing else:\n"
                   + "\n".join(f"- {p}" for p in problems) + f"\n\nThe page:\n{files[path]}")
            try:
                result = await runtime.run(writer, msg, state=state)
                return path, (result.text.strip() + "\n") if result.text.strip() else files[path]
            except Exception as e:
                logger.warning(f"Reviewer could not fix {path}: {e}")
                return path, files[path]

    for path, md in await asyncio.gather(*[fix(p, probs) for p, probs in failing.items()]):
        files[path] = md
    return files


# ── Orchestration ───────────────────────────────────────────────────────────

async def build(context, raw: str, *, log: LogFn = None, local: bool | None = None) -> tuple[dict[str, str], ArchitectureMap]:
    """Build every page of the knowledge base. Resumable: the map and each page are checkpointed as they finish."""
    local = config.backend() == "local" if local is None else local
    max_pages = settings.LOCAL_MAX_PAGES if local else settings.REMOTE_MAX_PAGES
    concurrency = 1 if local else max(1, settings.NOX_MAX_CONCURRENCY)
    kb_id, sha = context.kb_id, getattr(context, "commit_sha", "") or ""
    raw, images = extract_images(raw)
    corpus = parse_corpus(raw)
    forget_source_snapshot(kb_id)  # writers' lookup tools must read this build's snapshot

    with telemetry.usage_scope(f"kb-build:{context.app_name}") as usage:
        # 1. Cartographer
        cached = load_checkpoint_json(kb_id, "architecture_map.json")
        if cached:
            amap = ArchitectureMap.model_validate(cached)
        else:
            if log:
                await log("cartographer_started", {"files": len(corpus), "message": f"Cartographer mapping {len(corpus)} files: components, interfaces and the page plan"})
            amap = await map_architecture(context, raw, images, local=local, max_pages=max_pages)
            save_checkpoint_json(kb_id, "architecture_map.json", amap.model_dump())
        plan = [p.model_dump() for p in amap.pages[:max_pages] if p.path.endswith(".md") and "/" in p.path]
        save_checkpoint_json(kb_id, "plan.json", {"pages": plan})
        upload_content(kb_id, "summary.md", amap.summary)
        if log:
            await log("plan_ready", {"pages": [p["path"] for p in plan], "interfaces": len(amap.interfaces),
                                     "message": f"Architecture mapped: {len(plan)} pages planned, {len(amap.interfaces)} interfaces found"})

        # 2. Page writers
        static = "\n\n".join([
            WRITER_RULES, SYSTEM_COMPILER, f"Application: {context.app_name}",
            f"Architecture overview:\n{amap.summary}",
            f"Interfaces:\n{_interfaces_text(amap)}",
            f"KNOWLEDGE BASE PAGE MANIFEST (link with [[wikilinks]]):\n{_build_manifest(plan)}"
            + _build_cross_kb_manifest(getattr(context, "candidate_contracts", None) or []),
        ])
        writer = _writer(static, local)
        state = {"apps": {context.app_name: kb_id}, "home_app": context.app_name}
        budget = LOCAL_CODE_BUDGET if local else PAGE_CODE_BUDGET
        files: dict[str, str] = {"index.md": amap.summary.strip() + "\n"}
        sem = asyncio.Semaphore(concurrency)

        async def one(page: dict) -> tuple[str, str]:
            path = page["path"]
            done = load_kb_content(kb_id, f"pages/{path}")
            if done:
                return path, done
            async with sem:
                try:
                    md = await write_page(writer, page, corpus=corpus, raw=raw, budget=budget, sha=sha, state=state)
                except Exception as e:
                    logger.warning(f"Page writer failed on {path}: {e}")
                    md = f"# {page.get('topic') or path}\n\n> NoX couldn't write this page in this build; it will be retried on the next sync.\n"
            upload_content(kb_id, f"pages/{path}", md)
            if log:
                await log("page_compiled", {"path": path, "topic": page.get("topic", ""), "message": f"Compiled documentation section: {page.get('topic') or path}"})
            return path, md

        if plan:
            first = await one(plan[0])  # warms the shared prefix for the rest
            rest = await asyncio.gather(*[one(p) for p in plan[1:]])
            files.update(dict([first, *rest]))

        # 3. Reviewer + the deterministic finish the classic pipeline always had
        files = await run_synthesis_pass(files, plan, candidate_contracts=getattr(context, "candidate_contracts", None))
        files = await review(files, plan, writer, state, log, concurrency)
        files["AGENTS.md"] = _generate_agents_contract(context.app_name, context.org_slug)
        files["log.md"] = _generate_log_timeline(context.app_name, sha)
        files[".nox/brief.md"] = generate_architecture_digest(context.app_name, context.org_slug, files)
        save_checkpoint_json(kb_id, "compiled_files.json", files)

    if log:
        await log("build_usage", {**usage.summary(), "message": f"Knowledge base built by NoX's agents: {usage.line()}"})
    logger.info(json.dumps({"event": "nox.kb.build", "app": context.app_name, "pages": len(plan), **usage.summary()}))
    return files, amap
