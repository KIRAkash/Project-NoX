"""NoX's Ask agent over A2A: public agent card, token-scoped turns, scope that no request can override."""

import httpx
import pytest

from nox_api.interop import a2a
from nox_api.main import app
from nox_api.services import search
from nox_api.services.local_storage import clear_kb_checkpoints, save_checkpoint_json

from .ai_fakes import FakeLlm, call, request_text, text, use_fake
from .test_ai_search import PAGES
from .test_mcp import _other_org_kb, lifespan_running
from .test_missions import _client, _setup_app


@pytest.fixture
async def served(db_clean, monkeypatch):
    monkeypatch.setattr(search, "embeddings_on", lambda: False)
    a, b = await _setup_app(), await _other_org_kb()
    save_checkpoint_json(a, "compiled_files.json", PAGES)
    await search.index_kb_safely(a, PAGES)
    async with _client("developer") as dev:
        token = (await dev.post("/api/v1/me/tokens", json={"name": "peer agent"})).json()["token"]
    async with lifespan_running():
        yield token
    clear_kb_checkpoints(a)
    _ = b


def _send(textual: str, *, metadata: dict | None = None) -> dict:
    msg = {"role": "user", "messageId": "m-1", "parts": [{"kind": "text", "text": textual}]}
    return {"jsonrpc": "2.0", "id": "1", "method": "message/send", "params": {"message": msg, **({"metadata": metadata} if metadata else {})}}


async def post(body: dict, token: str | None = None) -> httpx.Response:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(a2a.PATH, json=body, headers=headers)


def _answer(res: dict) -> str:
    result = res["result"]
    parts = [p for art in result.get("artifacts", []) for p in art["parts"]]
    return "".join(p.get("text", "") for p in parts)


async def test_agent_card_is_public(served):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        card = (await c.get(a2a.CARD_PATH)).json()
    assert card["name"] == "nox_ask" and "[[kb:app/page]]" in card["description"]
    assert card["supportedInterfaces"][0]["url"].endswith("/a2a/ask")


async def test_a_request_without_a_token_gets_no_model_call(served, monkeypatch):
    fake = use_fake(monkeypatch, FakeLlm(script=[text("never")]))
    r = await post(_send("What does a refund emit?"))
    assert r.status_code == 401 and "nox login" in r.json()["hint"]
    assert fake.requests == []


async def test_the_callback_refuses_when_no_scope_reaches_it(monkeypatch):
    fake = use_fake(monkeypatch, FakeLlm(script=[text("never")]))

    class Ctx:
        state: dict = {}
        user_content = None

    reply = await a2a._inject_scope(Ctx())
    assert "Sign in with a NoX token" in reply.parts[0].text and fake.requests == []


async def test_scope_comes_from_the_token_not_the_request(served, monkeypatch):
    fake = use_fake(monkeypatch, FakeLlm(script=[
        call("read_kb_page", ref="payroll/entities/salary"),
        call("read_kb_page", ref="refunds-service/entities/refund"),
        text("A refund emits `order.refunded` [[kb:refunds-service/entities/refund]]."),
    ]))
    # the request tries to smuggle scope in through metadata; the token decides
    r = await post(_send("What does a refund emit?", metadata={"apps": {"payroll": "x"}, "home_app": "payroll"}), served)
    assert r.status_code == 200, r.text
    assert "order.refunded" in _answer(r.json())
    seen = request_text(fake.requests[-1])
    assert "Unknown application 'payroll'" in seen and "POST /v2/reversals" in seen
    assert "refunds-service" in request_text(fake.requests[0]) and "payroll" not in str(fake.requests[0].config.system_instruction)
    offered = {d.name for d in (fake.requests[0].config.tools or [])[0].function_declarations}
    assert "get_jira_issue" not in offered
