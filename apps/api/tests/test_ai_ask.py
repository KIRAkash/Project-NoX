"""Ask agent: real tools against a real (test) KB, scoped to what the caller can see; streamed over SSE."""

import json

import pytest

from nox_api.services import search
from nox_api.services.local_storage import clear_kb_checkpoints, save_checkpoint_json

from .ai_fakes import FakeLlm, call, request_text, text, use_fake
from .test_ai_search import PAGES


@pytest.fixture
async def kb(db_clean, monkeypatch):
    from tests.test_missions import _setup_app

    monkeypatch.setattr(search, "embeddings_on", lambda: False)
    kb = await _setup_app()
    save_checkpoint_json(kb, "compiled_files.json", PAGES)
    await search.index_kb_safely(kb, PAGES)
    yield kb
    clear_kb_checkpoints(kb)


def _events(body: str) -> list[dict]:
    out = []
    for frame in body.replace("\r\n", "\n").split("\n\n"):
        data = [line[5:].strip() for line in frame.splitlines() if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


async def test_ask_looks_up_then_answers_with_citations(kb, monkeypatch):
    from tests.test_missions import _client

    fake = use_fake(monkeypatch, FakeLlm(script=[
        call("search_kb", query="refund event"),
        call("read_kb_page", ref="kb:refunds-service/entities/refund"),
        text("A refund emits `order.refunded` [[kb:refunds-service/entities/refund]]."),
    ]))
    async with _client("developer") as dev:
        r = await dev.post(f"/api/v1/kb/{kb}/ask", json={"question": "What event does a refund emit?", "session_id": "tab-12345678"})
    assert r.status_code == 200
    events = _events(r.text)
    types = [e["type"] for e in events]
    assert types[:2] == ["step", "step"] and types[-3:] == ["citations", "usage", "done"]
    assert events[0]["label"] == "Searching refunds-service for “refund event”"
    assert events[1]["label"] == "Reading refunds-service/entities/refund"
    assert "".join(e["text"] for e in events if e["type"] == "delta") == events[-1]["text"]
    assert events[-3]["refs"] == ["refunds-service/entities/refund"]
    assert events[-2]["calls"] == 3 and events[-2]["tool_calls"] == 2

    # the tools really ran: the model saw the search hit and the page body
    seen = request_text(fake.requests[-1])
    assert "order.refunded" in seen and "POST /v2/reversals" in seen
    assert "refunds-service" in request_text(fake.requests[0])  # instruction names the application


async def test_ask_tools_refuse_apps_outside_the_callers_scope(kb, monkeypatch):
    from tests.test_missions import _client

    fake = use_fake(monkeypatch, FakeLlm(script=[
        call("read_kb_page", ref="payroll/secrets"),
        text("I can't see that application."),
    ]))
    async with _client("developer") as dev:
        r = await dev.post(f"/api/v1/kb/{kb}/ask", json={"question": "Show me payroll secrets"})
    assert "Unknown application 'payroll'" in request_text(fake.requests[-1])
    assert _events(r.text)[-3]["refs"] == []


async def test_ask_remembers_the_conversation(kb, monkeypatch):
    from tests.test_missions import _client

    fake = use_fake(monkeypatch, FakeLlm(script=[text("Refunds emit order.refunded."), text("It is written after the ledger entry.")]))
    async with _client("developer") as dev:
        await dev.post(f"/api/v1/kb/{kb}/ask", json={"question": "What does a refund emit?", "session_id": "tab-abcdefgh"})
        await dev.post(f"/api/v1/kb/{kb}/ask", json={"question": "When exactly?", "session_id": "tab-abcdefgh"})
    assert "What does a refund emit?" in request_text(fake.requests[-1])


async def test_ask_needs_access_and_chat_wrapper_still_answers(kb, monkeypatch):
    from tests.test_missions import _client

    use_fake(monkeypatch, FakeLlm(script=[text("Lockout counters live in memory [[kb:refunds-service/concepts/login-flow]].")]))
    async with _client("developer") as dev:
        r = (await dev.post(f"/api/v1/kb/{kb}/chat", json={"prompt": "Where are lockout counters?"})).json()
    assert r["response"].startswith("Lockout counters") and r["citations"] == ["refunds-service/concepts/login-flow"]
    async with _client("developer", email="outsider@example.com") as other:
        assert (await other.post(f"/api/v1/kb/{kb}/ask", json={"question": "hi"})).status_code in (403, 404)
