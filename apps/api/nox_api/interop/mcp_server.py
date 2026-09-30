"""NoX as an MCP server: coding agents (Antigravity, Gemini CLI, Claude Code, Cursor, any MCP client) call NoX's
knowledge-base and mission tools directly: "who consumes nte.trades.matched?", "load NOX-7".

Mounted on the API at `/mcp` (Streamable HTTP, stateless, JSON responses). Read-only by design: no tool can
approve, verify, send back or edit a spec file (principle 1). `get_jira_issue` is not exposed, because it reads
Jira with NoX's own credentials and an MCP client shouldn't get that reach.

Scope (principle 3): every call carries `Authorization: Bearer nox_…` and optionally `X-Nox-Role`. The gate below
refuses a request without a valid token (401, with a hint to run `nox login`); each tool then builds the caller's
scope from the token owner's memberships (`services/scope.py`) and calls the same functions the Ask agent uses,
through a `ScopedContext`. The model never sees or sets scope. 60 tool calls per minute per token.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from starlette.responses import JSONResponse

from ..ai import telemetry
from ..ai.tools import knowledge
from ..core.config import settings
from ..db.database import AsyncSessionLocal
from ..services.scope import LOGIN_HINT, ScopedContext, ScopeError, actor_from_token, tool_state

logger = logging.getLogger("nox.mcp")

KB_STATUS = {"queued": "In the Void", "ingesting": "Scanning Nebula", "generating": "Compiling Stars",
             "in_review": "Awaiting Launch", "published": "In Orbit", "failed": "Lost Signal"}

INSTRUCTIONS = """NoX keeps a live map of the company's applications: a knowledge base per application, the contract
map between them, and missions (one change carried from a business request to verified code).
Use search_kb / read_kb_page before reading code, find_interfaces for "who exposes / who consumes" questions, and
get_mission to load a mission's four spec files before building it. Cite knowledge-base pages as [[kb:<ref>]]
using the refs the tools return. Everything here is read-only: people approve and verify in NoX."""

server = MCPServer("nox", title="NoX", instructions=INSTRUCTIONS, version="0.1.0")


# ── Scope, rate limit, telemetry ────────────────────────────────────────────

_memory_hits: dict[str, tuple[int, int]] = {}  # used only when Redis is unreachable


async def _rate_limited(key: str) -> bool:
    minute = int(time.time() // 60)
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        rkey = f"nox:mcp:rl:{key}:{minute}"
        n = await r.incr(rkey)
        if n == 1:
            await r.expire(rkey, 90)
        await r.aclose()
    except Exception:
        at, n = _memory_hits.get(key, (minute, 0))
        n = n + 1 if at == minute else 1
        _memory_hits[key] = (minute, n)
    return n > settings.NOX_MCP_RATE_LIMIT


class _Call:
    """One tool call: the caller's actor and knowledge-tool state, resolved from the request headers."""

    def __init__(self, tool: str, ctx: Context | None, app: str = ""):
        self.tool, self.ctx, self.app = tool, ctx, app

    async def __aenter__(self):
        from ..core.auth import hash_api_token

        headers = {k.lower(): v for k, v in ((self.ctx.headers if self.ctx else None) or {}).items()}
        self.db = AsyncSessionLocal()
        try:
            self.actor = await actor_from_token(self.db, headers.get("authorization"), headers.get("x-nox-role"))
        except ScopeError as e:
            await self.db.close()
            raise ToolError(str(e)) from e
        token = headers.get("authorization", "").partition(" ")[2].strip()
        if await _rate_limited(hash_api_token(token)[:24]):
            await self.db.close()
            raise ToolError(f"Rate limit: {settings.NOX_MCP_RATE_LIMIT} NoX tool calls per minute. Try again shortly.")
        self.state = await tool_state(self.db, self.actor, self.app)
        self.scoped = ScopedContext(state=self.state)
        logger.info(json.dumps({"event": "nox.mcp.call", "user": str(self.actor.user.id), "role": self.actor.role.value,
                                "tool": self.tool}))
        return self

    async def __aexit__(self, *exc):
        await self.db.close()


async def _knowledge(tool: str, ctx: Context | None, fn, home: str = "", **kwargs) -> dict:
    async with _Call(tool, ctx, home) as call:
        with telemetry.usage_scope(f"mcp:{tool}"):
            return await fn(tool_context=call.scoped, **kwargs)


# ── Knowledge tools (the functions the Ask agent uses, unchanged) ──────────


@server.tool()
async def search_kb(query: str, ctx: Context, app: str = "", everywhere: bool = False) -> dict[str, Any]:
    """Search the knowledge bases you can see, by meaning and by exact identifiers (endpoints, events, classes).

    Args:
      query: What to look for, in plain words or identifiers.
      app: Application to search. Required unless you can see only one, or everywhere is true.
      everywhere: Search every application you can see ("who else uses this?").
    Returns the best matching sections; cite each as [[kb:<ref>]].
    """
    return await _knowledge("search_kb", ctx, knowledge.search_kb, app, query=query, app=app, everywhere=everywhere)


@server.tool()
async def read_kb_page(ref: str, ctx: Context) -> dict[str, Any]:
    """Read one knowledge-base page in full.

    Args:
      ref: `<app>/<path>` as returned by search_kb (a leading 'kb:' and a trailing '.md' are optional).
    """
    return await _knowledge("read_kb_page", ctx, knowledge.read_kb_page, ref=ref)


@server.tool()
async def list_pages(ctx: Context, app: str = "") -> dict[str, Any]:
    """List the pages of an application's knowledge base (its table of contents).

    Args:
      app: Application name (see list_apps).
    """
    return await _knowledge("list_pages", ctx, knowledge.list_pages, app, app=app)


@server.tool()
async def find_interfaces(ctx: Context, identifier: str = "", app: str = "") -> dict[str, Any]:
    """Look up interfaces (REST endpoints, events, gRPC services, shared models, SDKs) in the contract map across
    the applications you can see: "who exposes X" and "who consumes X".

    Args:
      identifier: Part of an interface name, e.g. 'nte.trades.matched' or '/refund'. Empty lists everything for app.
      app: Restrict to one application's interfaces.
    """
    return await _knowledge("find_interfaces", ctx, knowledge.find_interfaces, identifier=identifier, app=app)


@server.tool()
async def grep_source(pattern: str, ctx: Context, app: str = "") -> dict[str, Any]:
    """Search an application's source code (as of its last knowledge-base build) for a regex or plain text.

    Args:
      pattern: Regular expression or plain text, 3+ characters.
      app: Application name.
    Returns up to 30 matching lines as path:line: text.
    """
    return await _knowledge("grep_source", ctx, knowledge.grep_source, app, pattern=pattern, app=app)


@server.tool()
async def read_source_file(path: str, ctx: Context, app: str = "", start_line: int = 1, end_line: int = 0) -> dict[str, Any]:
    """Read a source file (or a line range of it) from an application's source snapshot.

    Args:
      path: File path as shown by grep_source.
      app: Application name.
      start_line: First line to return (1-based).
      end_line: Last line to return; 0 = as much as fits.
    """
    return await _knowledge("read_source_file", ctx, knowledge.read_source_file, app, path=path, app=app,
                            start_line=start_line, end_line=end_line)


# ── Applications and missions ───────────────────────────────────────────────


@server.tool()
async def list_apps(ctx: Context) -> dict[str, Any]:
    """The applications you can see: name, knowledge-base status (In the Void … In Orbit), team and a one-line description."""
    from sqlalchemy import select

    from ..db.models import KnowledgeBase, Org
    from ..services.local_storage import load_checkpoint_json

    async with _Call("list_apps", ctx) as call:
        ids = list(call.state["apps"].values())
        rows = (await call.db.execute(select(KnowledgeBase, Org.name).join(Org, Org.id == KnowledgeBase.org_id)
                                      .where(KnowledgeBase.id.in_([uuid.UUID(i) for i in ids])))).all() if ids else []
        out = []
        for kb, team in sorted(rows, key=lambda r: r[0].app_name):
            brief = (load_checkpoint_json(str(kb.id), "compiled_files.json") or {}).get(".nox/brief.md", "")
            line = next((ln.strip() for ln in knowledge_prose(brief).splitlines() if ln.strip() and not ln.startswith("#")), "")
            out.append({"name": kb.app_name, "status": KB_STATUS.get(kb.status.value, kb.status.value), "team": team,
                        "description": line[:200]})
        return {"apps": out}


def knowledge_prose(md: str) -> str:
    from ..agents import okf

    return okf.strip(md) if md else ""


@server.tool()
async def get_mission(key: str, ctx: Context) -> dict[str, Any]:
    """Load a mission (e.g. NOX-7): its four spec files, stage, branch name, links and knowledge-base context.
    The same content `nox context NOX-7` prints; the build spec (developer file) is the plan.

    Args:
      key: Mission key, e.g. NOX-7.
    """
    from fastapi import HTTPException

    from ..routers.cli import build_mission_context

    async with _Call("get_mission", ctx) as call:
        try:
            return await build_mission_context(call.db, call.actor, key)
        except HTTPException as e:
            raise ToolError(f"No mission {key.upper()} in your orgs.") from e


@server.tool()
async def list_my_missions(ctx: Context) -> dict[str, Any]:
    """Missions waiting on you in your current seat (set with the X-Nox-Role header, or your last pick in NoX)."""
    from ..routers.missions import list_missions

    async with _Call("list_my_missions", ctx) as call:
        rows = await list_missions(view="waiting", db=call.db, actor=call.actor)
        return {"role": call.actor.role.value, "missions": [
            {"key": m["key"], "title": m["title"], "stage": m["stage"], "apps": [a["name"] for a in m.get("apps", [])]}
            for m in rows]}


@server.tool()
async def ask_nox(question: str, ctx: Context, app: str = "") -> dict[str, Any]:
    """Ask NoX a question about your applications. NoX looks things up in the knowledge bases, the contract map and
    the source snapshot, then answers with [[kb:<ref>]] citations.

    Args:
      question: The question, in plain words.
      app: The application it's about (optional when the question names it or spans several).
    """
    from ..ai.agents import ask

    async with _Call("ask_nox", ctx, app) as call:
        apps = call.state["apps"]
        home = call.state["home_app"] or (next(iter(apps)) if len(apps) == 1 else "")
        answer, citations, blocked = "", [], False
        async for ev in ask.answer(question, home_app=home or "any of the applications listed", apps=apps,
                                   role=call.actor.role.value, user_id=f"mcp-{call.actor.user.id}",
                                   session_id=f"mcp-{uuid.uuid4().hex}", where="mcp", tools=ask.PEER_TOOLS):
            if ev["type"] == "done":
                answer = ev["text"]
            elif ev["type"] == "citations":
                citations = ev["refs"]
            elif ev["type"] == "shield":
                blocked = True
        return {"answer": answer, "citations": [f"[[kb:{r}]]" for r in citations], "shield_blocked": blocked}


TOOL_NAMES = ["search_kb", "read_kb_page", "list_pages", "find_interfaces", "grep_source", "read_source_file",
              "list_apps", "get_mission", "list_my_missions", "ask_nox"]


# ── HTTP app with the token gate ────────────────────────────────────────────


def http_app():
    """The Streamable HTTP app, served at exactly `/mcp`. DNS-rebinding checks are off: access is by bearer token."""
    return server.streamable_http_app(
        streamable_http_path="/mcp", stateless_http=True, json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )


class TokenGate:
    """ASGI wrapper: refuse any request without a valid NoX token before MCP sees it (401 with a hint).
    `app` is set when the API starts (a session manager runs once, so each start builds a fresh one)."""

    def __init__(self):
        self.app = None

    async def __call__(self, scope, receive, send):
        if self.app is None:
            return await JSONResponse({"error": "MCP is starting"}, status_code=503)(scope, receive, send)
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        async with AsyncSessionLocal() as db:
            try:
                await actor_from_token(db, headers.get("authorization"), headers.get("x-nox-role"))
            except ScopeError as e:
                res = JSONResponse({"error": str(e), "hint": LOGIN_HINT}, status_code=e.status,
                                   headers={"WWW-Authenticate": 'Bearer realm="nox"'} if e.status == 401 else None)
                return await res(scope, receive, send)
        return await self.app(scope, receive, send)


gate = TokenGate()


@asynccontextmanager
async def lifespan():
    app = http_app()
    async with app.router.lifespan_context(app):
        gate.app = app
        try:
            yield app
        finally:
            gate.app = None
