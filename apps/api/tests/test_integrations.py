import base64

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from nox_api.agents.linter import SecretLeakError, assert_no_secrets
from nox_api.core.config import Settings, validate_required_settings
from nox_api.integrations import atlassian
from nox_api.integrations.jira import (
    JiraAuthError,
    JiraClient,
    JiraValidationError,
    adf_to_text,
    text_to_adf,
)
from nox_api.main import app

BASE = "https://example.atlassian.net"


# ── Atlassian auth ───────────────────────────────────────────────────────────


def test_auth_header_encodes_email_and_token():
    header = atlassian.auth_header("tok123", email="me@example.com")
    assert header == "Basic " + base64.b64encode(b"me@example.com:tok123").decode()


def test_auth_header_passes_through_prebuilt_values():
    assert atlassian.auth_header("Bearer abc") == "Bearer abc"
    assert atlassian.auth_header("Basic xyz") == "Basic xyz"
    assert atlassian.auth_header("a@b.c:tok") == "Basic " + base64.b64encode(b"a@b.c:tok").decode()


def test_auth_header_requires_email_for_raw_token(monkeypatch):
    monkeypatch.setattr(atlassian.settings, "ATLASSIAN_EMAIL", "")
    with pytest.raises(atlassian.AtlassianConfigError):
        atlassian.auth_header("tok123")


# ── ADF ──────────────────────────────────────────────────────────────────────


def test_text_to_adf_and_back():
    doc = text_to_adf("# Goal\nShip it\n- one\n- two\n```\ncode()\n```")
    kinds = [n["type"] for n in doc["content"]]
    assert kinds == ["heading", "paragraph", "bulletList", "codeBlock"]
    text = adf_to_text(doc)
    assert "# Goal" in text and "- one" in text and "code()" in text


# ── Jira client ──────────────────────────────────────────────────────────────


def _client() -> JiraClient:
    return JiraClient(httpx.AsyncClient(), token="tok", email="me@example.com", base_url=BASE, backoff_seconds=0)


@respx.mock
async def test_search_follows_next_page_token():
    route = respx.get(f"{BASE}/rest/api/3/search/jql")
    route.side_effect = [
        httpx.Response(200, json={"issues": [{"key": "APEX-1"}], "nextPageToken": "p2", "isLast": False}),
        httpx.Response(200, json={"issues": [{"key": "APEX-2"}], "isLast": True}),
    ]
    issues = await _client().search("project = APEX")
    assert [i["key"] for i in issues] == ["APEX-1", "APEX-2"]
    assert route.calls[1].request.url.params["nextPageToken"] == "p2"


@respx.mock
async def test_create_issue_sends_adf_and_returns_browse_url():
    route = respx.post(f"{BASE}/rest/api/3/issue").mock(
        return_value=httpx.Response(201, json={"id": "10001", "key": "APEX-40", "self": "…"})
    )
    created = await _client().create_issue("APEX", "Refund status", "Hello\n- a", labels=["nox"])
    body = route.calls[0].request.read().decode()
    assert '"type":"doc"' in body.replace(" ", "") and '"labels":["nox"]' in body.replace(" ", "")
    assert created["url"] == f"{BASE}/browse/APEX-40"


@respx.mock
async def test_transition_to_picks_matching_transition():
    respx.get(f"{BASE}/rest/api/3/issue/APEX-40").mock(
        return_value=httpx.Response(200, json={"fields": {"status": {"name": "To Do"}}})
    )
    respx.get(f"{BASE}/rest/api/3/issue/APEX-40/transitions").mock(
        return_value=httpx.Response(200, json={"transitions": [
            {"id": "11", "name": "Start", "to": {"name": "In Progress"}},
            {"id": "31", "name": "Finish", "to": {"name": "Done"}},
        ]})
    )
    post = respx.post(f"{BASE}/rest/api/3/issue/APEX-40/transitions").mock(return_value=httpx.Response(204))
    used = await _client().transition_to("APEX-40", "in progress")
    assert used["id"] == "11"
    assert b'"id":"11"' in post.calls[0].request.read().replace(b" ", b"")


@respx.mock
async def test_transition_to_unknown_status_raises():
    respx.get(f"{BASE}/rest/api/3/issue/APEX-40").mock(
        return_value=httpx.Response(200, json={"fields": {"status": {"name": "To Do"}}})
    )
    respx.get(f"{BASE}/rest/api/3/issue/APEX-40/transitions").mock(
        return_value=httpx.Response(200, json={"transitions": []})
    )
    with pytest.raises(JiraValidationError):
        await _client().transition_to("APEX-40", "Shipped")


@respx.mock
async def test_retries_rate_limit_then_succeeds():
    route = respx.get(f"{BASE}/rest/api/3/myself")
    route.side_effect = [httpx.Response(429, headers={"Retry-After": "0"}), httpx.Response(200, json={"accountId": "a1"})]
    assert (await _client().myself())["accountId"] == "a1"
    assert route.call_count == 2


@respx.mock
async def test_auth_failure_is_typed():
    respx.get(f"{BASE}/rest/api/3/myself").mock(
        return_value=httpx.Response(401, json={"errorMessages": ["Client must be authenticated"]})
    )
    with pytest.raises(JiraAuthError) as err:
        await _client().myself()
    assert err.value.status == 401 and "authenticated" in str(err.value)


# ── Confluence space id ──────────────────────────────────────────────────────


@respx.mock
async def test_confluence_resolves_space_key_to_id():
    from nox_api.connectors.confluence_source import _resolve_space_id

    respx.get(f"{BASE}/wiki/api/v2/spaces", params={"keys": "APEX"}).mock(
        return_value=httpx.Response(200, json={"results": [{"id": 98304, "key": "APEX"}]})
    )
    async with httpx.AsyncClient() as c:
        assert await _resolve_space_id(c, BASE, "APEX", {}) == "98304"
        assert await _resolve_space_id(c, BASE, "12345", {}) == "12345"


# ── App hardening ────────────────────────────────────────────────────────────


def test_weak_webhook_secret_fails_startup_validation():
    with pytest.raises(RuntimeError, match="WEBHOOK_SECRET"):
        validate_required_settings(Settings(WEBHOOK_SECRET="supersecret"))
    validate_required_settings(Settings(WEBHOOK_SECRET="x" * 24, NOX_WEB_ORIGIN="http://localhost:3000"))


def test_cors_only_allows_configured_origin():
    client = TestClient(app)
    allowed = client.get("/healthz", headers={"Origin": "http://localhost:3000"})
    blocked = client.get("/healthz", headers={"Origin": "https://evil.example"})
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in blocked.headers


def test_request_id_is_echoed_or_minted():
    client = TestClient(app)
    assert client.get("/healthz", headers={"X-Request-ID": "abc123"}).headers["x-request-id"] == "abc123"
    assert len(client.get("/healthz").headers["x-request-id"]) == 12


def test_secret_gate_blocks_commits():
    with pytest.raises(SecretLeakError):
        assert_no_secrets({"entities/cfg.md": "token ghp_" + "a" * 36})
    assert_no_secrets({"index.md": "# Fine"})
