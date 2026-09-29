import asyncio
import json

import httpx
import pytest
import respx

from nox_api.core.config import settings
from nox_api.missions.jira_sync import tasks_from
from tests.test_missions import _client, _setup_app, _wait_drafts

BASE = "https://example.atlassian.net"


@pytest.fixture
def jira_env(monkeypatch):
    monkeypatch.setattr(settings, "ATLASSIAN_BASE_URL", BASE)
    monkeypatch.setattr(settings, "ATLASSIAN_EMAIL", "nox@example.com")
    monkeypatch.setattr(settings, "JIRA_API_TOKEN", "tok")
    monkeypatch.setattr(settings, "JIRA_WEBHOOK_SECRET", "hook-secret")
    monkeypatch.setattr(settings, "JIRA_ALLOWED_PROJECTS", "APEX")
    monkeypatch.setattr(settings, "JIRA_DEFAULT_PROJECT", "APEX")


def _issue(key="APEX-7", status="To Do"):
    return {"key": key, "fields": {"summary": "Lock accounts", "status": {"name": status}, "issuetype": {"name": "Task"},
                                   "description": {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "From support"}]}]}}}


def _mock_jira(router: respx.MockRouter, status="To Do"):
    router.get(url__regex=rf"{BASE}/rest/api/3/issue/APEX-7(\?.*)?$").mock(return_value=httpx.Response(200, json=_issue(status=status)))
    router.post(f"{BASE}/rest/api/3/issue/APEX-7/remotelink").mock(return_value=httpx.Response(201, json={"id": 1}))
    router.post(f"{BASE}/rest/api/3/issue").mock(return_value=httpx.Response(201, json={"id": "10", "key": "APEX-7", "self": "…"}))
    comments = router.post(f"{BASE}/rest/api/3/issue/APEX-7/comment").mock(return_value=httpx.Response(201, json={"id": "c1"}))
    router.get(f"{BASE}/rest/api/3/issue/APEX-7/transitions").mock(return_value=httpx.Response(200, json={"transitions": [
        {"id": "21", "name": "Start", "to": {"name": "In Progress"}}, {"id": "31", "name": "Review", "to": {"name": "In Review"}}]}))
    transitions = router.post(f"{BASE}/rest/api/3/issue/APEX-7/transitions").mock(return_value=httpx.Response(204))
    return comments, transitions


def test_tasks_are_read_from_the_build_spec():
    md = "# Build spec: x\n\n## Tasks\n1. Add `MAX_ATTEMPTS` to config\n2. [ ] **Track** failures\n   - sub-point ignored\n- Write tests\n\n## Test plan\n- nope\n"
    assert tasks_from(md) == ["Add MAX_ATTEMPTS to config", "Track failures", "Write tests"]


async def test_link_create_and_stage_sync(db_clean, fake_nox, jira_env):
    kb = await _setup_app()
    with respx.mock(assert_all_called=False) as router:
        router.route(host="test").pass_through()
        comments, transitions = _mock_jira(router)
        async with _client("developer") as dev:
            key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
            await _wait_drafts(dev, key)
            res = await dev.post(f"/api/v1/missions/{key}/jira/create", json={})
            assert res.status_code == 200, res.text
            m = res.json()
            link = m["links"][0]
            assert link["externalId"] == "APEX-7" and link["primary"] and link["state"]["status"] == "To Do"
            created = json.loads(router.calls[[c.request.url.path for c in router.calls].index("/rest/api/3/issue")].request.content)
            assert created["fields"]["labels"] == ["nox", key.lower()] and created["fields"]["summary"].startswith(key)
            await dev.post(f"/api/v1/missions/{key}/proceed")
            await dev.post(f"/api/v1/missions/{key}/files/developer/approve")  # developer → build: In Progress
        assert comments.called and json.loads(comments.calls[-1].request.content)["body"]["content"][0]["content"][0]["text"].startswith("[NoX]")
        assert json.loads(transitions.calls[-1].request.content) == {"transition": {"id": "21"}}


async def test_webhook_ignores_echo_and_applies_outside_changes(db_clean, fake_nox, jira_env):
    kb = await _setup_app()
    with respx.mock(assert_all_called=False) as router:
        router.route(host="test").pass_through()
        _mock_jira(router)
        async with _client("developer") as dev:
            key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
            await _wait_drafts(dev, key)
            await dev.post(f"/api/v1/missions/{key}/jira/link", json={"issueKey": "apex-7"})
            await dev.post(f"/api/v1/missions/{key}/proceed")
            await dev.post(f"/api/v1/missions/{key}/files/developer/approve")  # NoX moves APEX-7 to In Progress

            async def hook(body, secret="hook-secret"):
                return await dev.post(f"/api/v1/webhooks/jira?secret={secret}", json=body)

            assert (await hook({}, secret="wrong")).status_code == 401
            echo = {"webhookEvent": "jira:issue_updated", "issue": {"key": "APEX-7"}, "user": {"displayName": "NoX bot"},
                    "changelog": {"items": [{"field": "status", "toString": "In Progress"}]}}
            assert (await hook(echo)).json() == {"applied": 0}
            outside = {"webhookEvent": "jira:issue_updated", "issue": {"key": "APEX-7"}, "user": {"displayName": "Priya"},
                       "changelog": {"items": [{"field": "status", "toString": "Blocked"}, {"field": "assignee", "toString": "Priya"}]}}
            assert (await hook(outside)).json() == {"applied": 1}
            own_comment = {"webhookEvent": "comment_created", "issue": {"key": "APEX-7"},
                           "comment": {"author": {"displayName": "NoX"}, "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "[NoX] synced"}]}]}}}
            assert (await hook(own_comment)).json() == {"applied": 0}
            m = (await dev.get(f"/api/v1/missions/{key}")).json()
            assert m["links"][0]["state"]["status"] == "Blocked" and m["links"][0]["state"]["assignee"] == "Priya"
            events = [e["type"] for e in (await dev.get(f"/api/v1/missions/{key}/events")).json()]
            assert "jira.updated" in events


async def test_import_links_the_ticket_on_create(db_clean, fake_nox, jira_env):
    kb = await _setup_app()
    with respx.mock(assert_all_called=False) as router:
        router.route(host="test").pass_through()
        _mock_jira(router)
        async with _client("product") as po:
            m = (await po.post("/api/v1/missions", json={"prompt": "Lock accounts — imported from Jira", "appIds": [kb], "jiraKey": "APEX-7"})).json()
            await asyncio.sleep(0.1)
            m = (await po.get(f"/api/v1/missions/{m['key']}")).json()
            assert [link["externalId"] for link in m["links"]] == ["APEX-7"]


async def test_bad_credentials_surface_as_502(db_clean, fake_nox, jira_env):
    kb = await _setup_app()
    with respx.mock(assert_all_called=False) as router:
        router.route(host="test").pass_through()
        router.post(f"{BASE}/rest/api/3/issue").mock(return_value=httpx.Response(401, json={"errorMessages": ["Unauthorized"]}))
        async with _client("developer") as dev:
            key = (await dev.post("/api/v1/missions", json={"prompt": "Lock accounts after failed logins", "appIds": [kb]})).json()["key"]
            res = await dev.post(f"/api/v1/missions/{key}/jira/create", json={})
            assert res.status_code == 502 and "credentials" in res.json()["detail"]
