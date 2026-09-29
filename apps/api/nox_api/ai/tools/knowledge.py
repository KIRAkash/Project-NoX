"""Tools that let NoX's agents look things up: knowledge-base pages, interfaces, source code, Jira.

Scope is in session state, set by NoX from the caller's memberships before the agent runs:
  state["apps"]      {app name: kb id} the caller may see
  state["home_app"]  the application the conversation is about
The model can only choose among those apps; an unknown or foreign app name gets an error back.
"""

from __future__ import annotations

import re

from google.adk.tools import ToolContext
from sqlalchemy import or_, select

from ...db.database import AsyncSessionLocal
from ...services.local_storage import load_checkpoint_json, load_kb_content

MAX_PAGE_CHARS = 12000
MAX_FILE_CHARS = 10000


# ── Scope ───────────────────────────────────────────────────────────────────

def _apps(ctx: ToolContext) -> dict[str, str]:
    return dict(ctx.state.get("apps") or {})


def _resolve(ctx: ToolContext, app: str | None) -> tuple[str, str] | dict:
    """(app name, kb id) for `app`, defaulting to the conversation's application."""
    apps = _apps(ctx)
    name = (app or ctx.state.get("home_app") or "").strip()
    if not name and len(apps) == 1:
        name = next(iter(apps))
    if name not in apps:
        return {"error": f"Unknown application '{name}'. Applications you can use: {', '.join(sorted(apps)) or 'none'}"}
    return name, apps[name]


def _note(ctx: ToolContext, ref: str) -> None:
    """Remember every KB page the agent actually read or retrieved: those become the answer's citations."""
    seen = list(ctx.state.get("cited") or [])
    if ref not in seen:
        seen.append(ref)
        ctx.state["cited"] = seen


# ── Knowledge base ──────────────────────────────────────────────────────────

async def search_kb(query: str, tool_context: ToolContext, app: str = "", everywhere: bool = False) -> dict:
    """Search knowledge-base pages by meaning and by exact identifiers.

    Args:
      query: What to look for, in plain words or identifiers (endpoint paths, event names, class names).
      app: Application to search; defaults to the one this conversation is about.
      everywhere: Search every application you can see instead of one (e.g. "who else uses this?").
    Returns the best matching sections, each with the page `ref` to cite as [[kb:<ref>]].
    """
    from ...services.search import Hit, search

    apps = _apps(tool_context)
    if everywhere:
        kb_ids = list(apps.values())
    else:
        scoped = _resolve(tool_context, app)
        if isinstance(scoped, dict):
            return scoped
        kb_ids = [scoped[1]]
    async with AsyncSessionLocal() as db:
        hits = await search(db, query, kb_ids, k=6)
    if not hits:  # not indexed yet: keyword ranking over the compiled pages
        from ...missions.context import rank_pages

        names = {v: k for k, v in apps.items()}
        for kb_id in kb_ids:
            files = load_checkpoint_json(str(kb_id), "compiled_files.json") or {}
            for path, content in rank_pages(files, query, k=4):
                hits.append(Hit(kb_id=str(kb_id), app_name=names[kb_id], path=path, heading="", content=content, score=0.0))
    results = []
    for h in hits[:6]:
        _note(tool_context, h.ref)
        results.append({"ref": h.ref, "section": h.heading, "excerpt": re.sub(r"<!--.*?-->", "", h.content, flags=re.S)[:1500]})
    return {"results": results} if results else {"results": [], "note": "Nothing in the knowledge base matches."}


async def read_kb_page(ref: str, tool_context: ToolContext) -> dict:
    """Read one knowledge-base page in full.

    Args:
      ref: The page reference `<app>/<path>` as returned by search_kb (a leading 'kb:' and '.md' are optional).
    """
    ref = ref.removeprefix("[[").removesuffix("]]").removeprefix("kb:").split("|")[0].strip("/ ")
    app, _, path = ref.partition("/")
    scoped = _resolve(tool_context, app)
    if isinstance(scoped, dict):
        return scoped
    files = load_checkpoint_json(str(scoped[1]), "compiled_files.json") or {}
    key = path if path in files else f"{path}.md"
    if key not in files:
        near = [p.removesuffix(".md") for p in files if path.split("/")[-1] in p][:5]
        return {"error": f"No page '{path}' in {app}.", "did_you_mean": [f"{app}/{p}" for p in near]}
    _note(tool_context, f"{app}/{key.removesuffix('.md')}")
    body = re.sub(r"<!--.*?-->", "", files[key], flags=re.S)
    return {"ref": f"{app}/{key.removesuffix('.md')}", "markdown": body[:MAX_PAGE_CHARS],
            "truncated": len(body) > MAX_PAGE_CHARS}


async def list_pages(tool_context: ToolContext, app: str = "") -> dict:
    """List the pages of an application's knowledge base (the table of contents).

    Args:
      app: Application; defaults to the one this conversation is about.
    """
    scoped = _resolve(tool_context, app)
    if isinstance(scoped, dict):
        return scoped
    files = load_checkpoint_json(str(scoped[1]), "compiled_files.json") or {}
    pages = sorted(p.removesuffix(".md") for p in files if p.endswith(".md") and not p.startswith(".") and p not in ("AGENTS.md", "log.md"))
    return {"app": scoped[0], "pages": pages}


async def find_interfaces(tool_context: ToolContext, identifier: str = "", app: str = "") -> dict:
    """Look up interfaces (REST endpoints, events, gRPC services, shared models, SDKs) in the org's contract map.

    Use it to answer "who exposes X" and "what else talks about X" across applications.
    Args:
      identifier: Part of an interface name, e.g. '/refund', 'order.refunded'. Empty lists everything for `app`.
      app: Restrict to one application's interfaces.
    """
    from ...db.models import OrgInterfaceContract

    apps = _apps(tool_context)
    q = select(OrgInterfaceContract).where(OrgInterfaceContract.kb_id.in_(list(apps.values())))
    if app:
        if app not in apps:
            return {"error": f"Unknown application '{app}'"}
        q = q.where(OrgInterfaceContract.app_name == app)
    if identifier:
        like = f"%{identifier.strip()}%"
        q = q.where(or_(OrgInterfaceContract.identifier.ilike(like), OrgInterfaceContract.description.ilike(like)))
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(q.limit(40))).scalars().all()
    return {"interfaces": [{"app": r.app_name, "type": r.interface_type.value, "identifier": r.identifier,
                            "page": f"{r.app_name}/{r.page_path.removesuffix('.md')}", "description": (r.description or "")[:200]}
                           for r in rows]}


# ── Source code (the snapshot the knowledge base was built from) ────────────

def parse_corpus(raw: str) -> dict[str, str]:
    """Split an ingested snapshot into {path: text}: code files by their FILE markers, and each document source
    (Confluence, Notion, Jira, uploads) without file markers as one entry named by its source URL."""
    files: dict[str, str] = {}
    for block in re.split(r"^(?==== SOURCE: .* ===$)", raw, flags=re.M):
        head = re.match(r"^=== SOURCE: (.*) ===$", block, flags=re.M)
        parts = re.split(r"^--- FILE: (.*?) ---$", block, flags=re.M)
        if len(parts) > 1:
            for i in range(1, len(parts), 2):
                files[parts[i].strip()] = parts[i + 1].strip("\n")
        elif head and block[head.end():].strip():
            files[head.group(1).strip()] = block[head.end():].strip("\n")
    return files


_corpus_cache: dict[str, tuple[float, dict[str, str]]] = {}


def _source_files(kb_id: str) -> dict[str, str]:
    """The KB's source snapshot, parsed; cached briefly so a burst of tool calls reads storage once."""
    import time

    hit = _corpus_cache.get(kb_id)
    if hit and time.monotonic() - hit[0] < 300:
        return hit[1]
    files = parse_corpus(load_kb_content(kb_id, "raw_ingest.txt") or "")
    _corpus_cache[kb_id] = (time.monotonic(), files)
    return files


def forget_source_snapshot(kb_id: str) -> None:
    _corpus_cache.pop(str(kb_id), None)


async def grep_source(pattern: str, tool_context: ToolContext, app: str = "") -> dict:
    """Search the application's source code (as of its last knowledge-base build) for a regex or plain text.

    Args:
      pattern: Regular expression or plain text, e.g. 'def refund', 'order\\.refunded'.
      app: Application; defaults to the one this conversation is about.
    Returns up to 30 matching lines as path:line: text.
    """
    scoped = _resolve(tool_context, app)
    if isinstance(scoped, dict):
        return scoped
    try:
        rx = re.compile(pattern, re.I)
    except re.error:
        rx = re.compile(re.escape(pattern), re.I)
    if rx.search("") is not None or len(pattern.strip(".*^$ ")) < 3:
        return {"error": "Pattern too broad: search for a specific name, identifier or phrase (3+ characters)."}
    out = []
    for path, body in _source_files(str(scoped[1])).items():
        for n, line in enumerate(body.splitlines(), start=1):
            if rx.search(line):
                out.append(f"{path}:{n}: {line.strip()[:200]}")
                if len(out) >= 30:
                    return {"matches": out, "truncated": True}
    return {"matches": out} if out else {"matches": [], "note": "No matches in the source snapshot."}


async def read_source_file(path: str, tool_context: ToolContext, app: str = "", start_line: int = 1, end_line: int = 0) -> dict:
    """Read a source file (or a line range of it) from the application's source snapshot.

    Args:
      path: File path as shown by grep_source.
      app: Application; defaults to the one this conversation is about.
      start_line: First line to return (1-based).
      end_line: Last line to return; 0 = as much as fits.
    """
    scoped = _resolve(tool_context, app)
    if isinstance(scoped, dict):
        return scoped
    files = _source_files(str(scoped[1]))
    body = files.get(path) or next((b for p, b in files.items() if p.endswith("/" + path.lstrip("/"))), None)
    if body is None:
        return {"error": f"No file '{path}' in the {scoped[0]} source snapshot."}
    lines = body.splitlines()
    start = max(1, start_line)
    end = end_line if end_line >= start else len(lines)
    text = "\n".join(f"{n}: {line}" for n, line in enumerate(lines[start - 1:end], start=start))
    return {"path": path, "lines": f"{start}-{min(end, len(lines))} of {len(lines)}", "content": text[:MAX_FILE_CHARS]}


# ── Jira ────────────────────────────────────────────────────────────────────

async def get_jira_issue(key: str) -> dict:
    """Read a Jira issue: summary, type, status and description. Read-only.

    Args:
      key: Issue key, e.g. 'APEX-142'.
    """
    from ...core.config import settings
    from ...integrations.jira import JiraClient, JiraError, adf_to_text

    key = key.strip().upper()
    allowed = [p.strip().upper() for p in settings.JIRA_ALLOWED_PROJECTS.split(",") if p.strip()]
    if not re.fullmatch(r"[A-Z][A-Z0-9]+-\d+", key) or (allowed and key.split("-")[0] not in allowed):
        return {"error": f"NoX can read issues in {', '.join(allowed)} only."}
    try:
        async with JiraClient() as jira:
            issue = await jira.get_issue(key, fields=["summary", "issuetype", "status", "description"])
    except JiraError as e:
        return {"error": f"Jira: {e}"}
    f = issue.get("fields", {})
    return {"key": key, "summary": f.get("summary"), "type": (f.get("issuetype") or {}).get("name"),
            "status": (f.get("status") or {}).get("name"), "description": adf_to_text(f.get("description"))[:4000]}


KNOWLEDGE_TOOLS = [search_kb, read_kb_page, list_pages, find_interfaces, grep_source, read_source_file, get_jira_issue]
