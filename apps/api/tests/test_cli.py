import asyncio
import hashlib
import hmac
import json

import httpx
import pytest

from nox_api.core.config import settings
from nox_api.main import app
from nox_api.missions import prs
from nox_api.services.local_storage import clear_kb_checkpoints, save_checkpoint_json
from tests.test_missions import _client, _setup_app, _wait_drafts

KB_FILES = {
    "concepts/login-flow.md": "# Login flow\n\nPasswords are checked in src/auth.py. Lockout counters live in memory.\n",
    "decisions/no-plaintext.md": "# No plaintext\n\n- Services must never log plaintext passwords or tokens in any handler.\n",
}


@pytest.fixture
async def app_with_kb(db_clean):
    kb = await _setup_app()
    save_checkpoint_json(kb, "compiled_files.json", KB_FILES)
    yield kb
    clear_kb_checkpoints(kb)


def _anon():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_device_login_issues_a_working_token(db_clean):
    async with _anon() as anon:
        d = (await anon.post("/api/v1/cli/device", json={"name": "nox CLI on test"})).json()
        assert d["verifyUrl"].endswith(f"/cli/authorize/{d['userCode']}")
        assert (await anon.post("/api/v1/cli/device/token", json={"deviceCode": d["deviceCode"]})).status_code == 428
        assert (await anon.post("/api/v1/cli/device/approve", json={"userCode": d["userCode"]})).status_code == 401
    async with _client("developer", email="dev@example.com") as dev:
        assert (await dev.get(f"/api/v1/cli/device/{d['userCode'].lower()}")).json()["name"] == "nox CLI on test"
        assert (await dev.post("/api/v1/cli/device/approve", json={"userCode": d["userCode"]})).json() == {"approved": True}
    async with _anon() as anon:
        got = (await anon.post("/api/v1/cli/device/token", json={"deviceCode": d["deviceCode"]})).json()
        assert got["token"].startswith("nox_") and got["email"] == "dev@example.com"
        assert (await anon.post("/api/v1/cli/device/token", json={"deviceCode": d["deviceCode"]})).status_code == 410  # collected once
        me = (await anon.get("/api/v1/me", headers={"Authorization": f"Bearer {got['token']}"})).json()
        assert me["email"] == "dev@example.com"
        assert (await anon.get("/api/v1/me", headers={"Authorization": "Bearer nox_nope"})).status_code == 401


async def test_personal_tokens_can_be_listed_and_revoked(db_clean):
    async with _client("developer", email="dev@example.com") as dev:
        t = (await dev.post("/api/v1/me/tokens", json={"name": "laptop"})).json()
        assert [x["name"] for x in (await dev.get("/api/v1/me/tokens")).json()] == ["laptop"]
        assert (await dev.delete(f"/api/v1/me/tokens/{t['id']}")).status_code == 204
    async with _anon() as anon:
        assert (await anon.get("/api/v1/me", headers={"Authorization": f"Bearer {t['token']}"})).status_code == 401


async def test_context_search_and_read(app_with_kb, fake_nox):
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [app_with_kb]})).json()["key"]
        await _wait_drafts(dev, key)
        ctx = (await dev.get(f"/api/v1/cli/missions/{key.lower()}/context")).json()
        md = ctx["markdown"]
        assert md.startswith(f"# {key}: ") and ctx["branch"].startswith(key.lower() + "-")
        for heading in ("Business requirement", "Product spec", "Engineering design", "Build spec", "## Knowledge base"):
            assert heading in md
        assert "Application: refunds-service" in md and "KB page `kb:refunds-service/" in md

        hits = (await dev.get("/api/v1/cli/kb/search", params={"q": "lockout login"})).json()
        assert hits[0]["ref"] == "refunds-service/concepts/login-flow"
        page = (await dev.get("/api/v1/cli/kb/read", params={"ref": "kb:refunds-service/decisions/no-plaintext|No plaintext"})).json()
        assert page["path"] == "decisions/no-plaintext.md" and "never log" in page["markdown"]
        assert (await dev.get("/api/v1/cli/kb/read", params={"ref": "refunds-service/nope"})).status_code == 404
    async with _client("developer", email="outsider@example.com") as other:
        assert (await other.get(f"/api/v1/cli/missions/{key}/context")).status_code == 404
        assert (await other.get("/api/v1/cli/kb/search", params={"q": "login"})).json() == []


def test_guard_report_flags_rule_conflicts():
    ok, rules, v = prs.guard_report("+++ b/src/auth.py\n+count = 1\n", [("refunds-service", KB_FILES)])
    assert ok and rules >= 1 and v == []
    bad, _, v = prs.guard_report("+++ b/src/auth.py\n+logger.info(f'plaintext password {password} tokens')\n", [("refunds-service", KB_FILES)])
    assert not bad and v[0]["app"] == "refunds-service" and v[0]["source_file"] == "decisions/no-plaintext.md"
    assert prs.mission_numbers("nox-12-lock", "NOX-12: Lock", "also NOX-3") == [12, 3]


async def test_pr_webhook_links_and_guards(app_with_kb, fake_nox, monkeypatch):
    comments = []
    diff = "+++ b/src/main.py\n+logger.info(f'plaintext password {password} tokens')\n"
    monkeypatch.setattr(prs, "_fetch_pr", lambda full, n: ({"number": n, "html_url": f"https://github.com/{full}/pull/{n}", "state": "open", "title": "NOX-1: lockout", "head": {"ref": "nox-1-lockout"}}, diff))
    monkeypatch.setattr(prs, "_post_or_update_comment", lambda full, n, body: comments.append((full, n, body)))
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [app_with_kb]})).json()["key"]
        await _wait_drafts(dev, key)

    payload = {"action": "opened", "repository": {"full_name": "apex/mini-auth-service", "html_url": "https://github.com/apex/mini-auth-service"},
               "pull_request": {"number": 7, "html_url": "https://github.com/apex/mini-auth-service/pull/7", "state": "open", "merged": False,
                                "title": "Lockout", "body": f"Implements {key}", "head": {"ref": "feature/lockout"}, "user": {"login": "dev"}}}
    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(settings.WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    async with _anon() as anon:
        assert (await anon.post("/api/v1/webhooks/github/pr", content=body, headers={"X-Hub-Signature-256": "sha256=bad"})).status_code == 401
        assert (await anon.post("/api/v1/webhooks/github/pr", content=body, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})).status_code == 200

    async with _client("developer") as dev:
        for _ in range(100):
            m = (await dev.get(f"/api/v1/missions/{key}")).json()
            pr_links = [link for link in m["links"] if link["system"] == "github_pr"]
            if pr_links and pr_links[0]["state"].get("guard"):
                break
            await asyncio.sleep(0.05)
        assert pr_links[0]["externalId"] == "apex/mini-auth-service#7"
        assert pr_links[0]["state"]["guard"]["compliant"] is False and pr_links[0]["state"]["guard"]["commented"] is True
        assert comments and comments[0][:2] == ("apex/mini-auth-service", 7) and prs.GUARD_MARK in comments[0][2] and key in comments[0][2]
        events = [e["type"] for e in (await dev.get(f"/api/v1/missions/{key}/events")).json()]
        assert "pr.linked" in events and "pr.guarded" in events

        # linking by URL from the CLI is idempotent
        assert (await dev.post(f"/api/v1/cli/missions/{key}/prs", json={"url": "https://github.com/apex/mini-auth-service/pull/7"})).status_code == 200
        assert (await dev.post(f"/api/v1/cli/missions/{key}/prs", json={"url": "https://example.com/x"})).status_code == 400
        m = (await dev.get(f"/api/v1/missions/{key}")).json()
        assert len([link for link in m["links"] if link["system"] == "github_pr"]) == 1
