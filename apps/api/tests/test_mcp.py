"""MCP server: token-scoped, read-only NoX tools for coding agents, over Streamable HTTP at /mcp."""

import asyncio
import json
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest

from nox_api.interop import mcp_server
from nox_api.main import app
from nox_api.services import search
from nox_api.services.local_storage import clear_kb_checkpoints, save_checkpoint_json

from .ai_fakes import FakeLlm, call, text, use_fake
from .test_ai_search import PAGES
from .test_missions import _client, _setup_app


@asynccontextmanager
async def lifespan_running():
    """Run the API's lifespan in its own task (anyio needs enter and exit in one task; fixtures span two)."""
    started, stop = asyncio.Event(), asyncio.Event()

    async def hold():
        async with app.router.lifespan_context(app):
            started.set()
            await stop.wait()

    task = asyncio.create_task(hold())
    await asyncio.wait([task, asyncio.create_task(started.wait())], return_when=asyncio.FIRST_COMPLETED)
    if task.done():
        task.result()  # startup failed: raise it here
    try:
        yield
    finally:
        stop.set()
        await task


HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


async def _other_org_kb() -> str:
    """Org B, owned by someone else, with an application called payroll."""
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase

    async with _client("engineering", email="b-lead@example.com") as b:
        org = (await b.post("/api/v1/orgs", json={"name": "Globex", "slug": "globex"})).json()
    async with AsyncSessionLocal() as db:
        kb = KnowledgeBase(org_id=uuid.UUID(org["id"]), app_name="payroll", source_urls=[])
        db.add(kb)
        await db.commit()
        return str(kb.id)


@pytest.fixture
async def two_orgs(db_clean, monkeypatch):
    monkeypatch.setattr(search, "embeddings_on", lambda: False)
    a, b = await _setup_app(), await _other_org_kb()
    save_checkpoint_json(a, "compiled_files.json", PAGES)
    save_checkpoint_json(b, "compiled_files.json", {"entities/salary.md": "# Salary\n\nRefund of overpaid salary is manual.\n"})
    await search.index_kb_safely(a, PAGES)
    await search.index_kb_safely(b, {"entities/salary.md": "# Salary\n\nRefund of overpaid salary is manual.\n"})
    async with _client("developer") as dev:
        token = (await dev.post("/api/v1/me/tokens", json={"name": "antigravity"})).json()["token"]
    async with lifespan_running():  # starts the MCP session manager and the A2A routes
        yield token
    clear_kb_checkpoints(a)
    clear_kb_checkpoints(b)


async def rpc(method: str, params: dict | None = None, token: str | None = None, role: str | None = None) -> httpx.Response:
    headers = {**HEADERS, **({"Authorization": f"Bearer {token}"} if token else {}), **({"X-Nox-Role": role} if role else {})}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        return await c.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": method, **({"params": params} if params else {})})


async def tool(name: str, token: str, **args) -> dict:
    res = (await rpc("tools/call", {"name": name, "arguments": args}, token)).json()["result"]
    body = res.get("structuredContent")
    if body is None:
        body = json.loads(res["content"][0]["text"]) if not res.get("isError") else {"error": res["content"][0]["text"]}
    return {**body, "_isError": res.get("isError", False)}


async def test_no_token_or_a_bad_one_is_401_with_a_hint(two_orgs):
    r = await rpc("tools/list")
    assert r.status_code == 401 and "nox login" in r.json()["hint"]
    r = await rpc("tools/list", token="nox_not-a-real-token")
    assert r.status_code == 401 and "Invalid or revoked" in r.json()["error"]
    assert (await rpc("tools/list", token=two_orgs)).status_code == 200


async def test_tool_list_is_the_read_only_set(two_orgs):
    tools = (await rpc("tools/list", token=two_orgs)).json()["result"]["tools"]
    names = sorted(t["name"] for t in tools)
    assert names == sorted(mcp_server.TOOL_NAMES)
    assert "get_jira_issue" not in names  # reads Jira with NoX's credentials: never exposed
    assert not any(w in n for n in names for w in ("approve", "verify", "send_back", "save", "edit", "write"))


async def test_a_token_only_reaches_its_own_orgs(two_orgs):
    got = await tool("search_kb", two_orgs, query="refund", everywhere=True)
    refs = [r["ref"] for r in got["results"]]
    assert refs and all(r.startswith("refunds-service/") for r in refs)

    page = await tool("read_kb_page", two_orgs, ref="kb:payroll/entities/salary")
    assert "Unknown application 'payroll'" in page["error"]
    assert "Unknown application" in (await tool("list_pages", two_orgs, app="payroll"))["error"]

    apps = await tool("list_apps", two_orgs)
    assert [a["name"] for a in apps["apps"]] == ["refunds-service"] and apps["apps"][0]["status"] == "In the Void"

    ok = await tool("read_kb_page", two_orgs, ref="refunds-service/entities/refund")
    assert "order.refunded" in ok["markdown"]


async def test_missions_are_scoped_too(two_orgs, fake_nox):
    from .test_missions import _wait_drafts

    async with _client("developer") as dev:
        apps = [a for a in (await dev.post("/api/v1/missions/suggest-apps", json={"prompt": "refund status"})).json()]
        key = (await dev.post("/api/v1/missions", json={"prompt": "Show customers their refund status", "appIds": [apps[0]["id"]]})).json()["key"]
        await _wait_drafts(dev, key)
    got = await tool("get_mission", two_orgs, key=key.lower())
    assert got["key"] == key and "## Knowledge base" in got["markdown"]
    mine = await tool("list_my_missions", two_orgs)
    assert mine["role"] == "developer" and [m["key"] for m in mine["missions"]] == [key]
    async with _client("developer", email="b-lead@example.com") as b:
        b_token = (await b.post("/api/v1/me/tokens", json={"name": "cli"})).json()["token"]
    other = await tool("get_mission", b_token, key=key)
    assert other["_isError"] and "No mission" in other["error"]


async def test_ask_nox_answers_with_citations(two_orgs, monkeypatch):
    fake = use_fake(monkeypatch, FakeLlm(script=[
        call("read_kb_page", ref="kb:refunds-service/entities/refund"),
        text("A refund emits `order.refunded` [[kb:refunds-service/entities/refund]]."),
    ]))
    got = await tool("ask_nox", two_orgs, question="What event does a refund emit?", app="refunds-service")
    assert "order.refunded" in got["answer"]
    assert got["citations"] == ["[[kb:refunds-service/entities/refund]]"] and got["shield_blocked"] is False
    tools_offered = {d.name for d in (fake.requests[0].config.tools or [])[0].function_declarations}
    assert "get_jira_issue" not in tools_offered and "search_kb" in tools_offered


async def test_rate_limit(two_orgs, monkeypatch):
    from nox_api.core.config import settings

    monkeypatch.setattr(settings, "NOX_MCP_RATE_LIMIT", 2)
    monkeypatch.setattr(settings, "REDIS_URL", "redis://127.0.0.1:1/0")  # unreachable: the in-memory fallback counts
    mcp_server._memory_hits.clear()
    assert not (await tool("list_apps", two_orgs))["_isError"]
    assert not (await tool("list_apps", two_orgs))["_isError"]
    limited = await tool("list_apps", two_orgs)
    assert limited["_isError"] and "Rate limit" in limited["error"]
