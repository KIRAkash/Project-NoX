"""Hand off to Jules: the client, readiness and its reasons, who may start, polling into events, the PR link."""

import json
import uuid

import httpx
import pytest
import respx

from nox_api.core.config import settings
from nox_api.integrations import jules as api
from nox_api.missions import jules
from tests.test_missions import _client, _setup_app
from tests.test_verification import _to_build

BASE = "https://jules.test/v1alpha"
SOURCE = "sources/github/Nox-Demo-Org/refunds-service"


@pytest.fixture
def jules_on(monkeypatch):
    monkeypatch.setattr(settings, "JULES_API_KEY", "jules-test-key")
    monkeypatch.setattr(settings, "JULES_API_URL", BASE)
    jules.forget_sources()
    spawned: list[str] = []
    monkeypatch.setattr(jules, "spawn", lambda name, fn, *a: spawned.append(name))
    yield spawned
    jules.forget_sources()


async def _with_repo(kb: str, url: str = "https://github.com/Nox-Demo-Org/refunds-service") -> None:
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import SourceMonitor

    async with AsyncSessionLocal() as db:
        db.add(SourceMonitor(kb_id=uuid.UUID(kb), source_type="github", repo_url=url, source_url=url))
        await db.commit()


def _sources(*names: str) -> respx.Route:
    return respx.get(f"{BASE}/sources").mock(return_value=httpx.Response(200, json={
        "sources": [{"name": n, "githubRepo": {"owner": "Nox-Demo-Org", "repo": n.rsplit("/", 1)[-1], "defaultBranch": {"displayName": "main"}}} for n in names]}))


def test_source_names_and_pr_urls():
    assert api.source_name("https://github.com/Nox-Demo-Org/claims-intake") == "sources/github/Nox-Demo-Org/claims-intake"
    assert api.source_name("git@github.com:Org/repo.git") == "sources/github/Org/repo"
    assert api.source_name("https://gitlab.com/org/repo") is None
    assert api.repo_of("sources/github/Org/repo") == "Org/repo"
    assert api.pr_url({"outputs": [{"pullRequest": {"url": "https://github.com/Org/repo/pull/7"}}]}) == "https://github.com/Org/repo/pull/7"
    assert api.pr_url({"outputs": []}) is None
    assert api.session_id({"name": "sessions/abc"}) == "abc"


@respx.mock
async def test_client_sends_the_key_and_the_documented_bodies():
    create = respx.post(f"{BASE}/sessions").mock(return_value=httpx.Response(200, json={"name": "sessions/s1", "id": "s1", "state": "QUEUED"}))
    approve = respx.post(f"{BASE}/sessions/s1:approvePlan").mock(return_value=httpx.Response(200, json={}))
    say = respx.post(f"{BASE}/sessions/s1:sendMessage").mock(return_value=httpx.Response(200, json={}))
    async with api.JulesClient(api_key="k", base_url=BASE) as c:
        await c.create_session(prompt="p", title="NOX-1: t", source=SOURCE, starting_branch="main")
        await c.approve_plan("s1")
        await c.send_message("s1", "use the existing limiter")
    req = create.calls[0].request
    assert req.headers["x-goog-api-key"] == "k"
    body = json.loads(req.content)
    assert body["sourceContext"] == {"source": SOURCE, "githubRepoContext": {"startingBranch": "main"}}
    assert body["automationMode"] == "AUTO_CREATE_PR" and body["requirePlanApproval"] is True
    assert approve.called and json.loads(say.calls[0].request.content) == {"prompt": "use the existing limiter"}


@respx.mock
async def test_client_maps_errors():
    respx.get(f"{BASE}/sources").mock(return_value=httpx.Response(401, json={"error": {"message": "API key not valid"}}))
    with pytest.raises(api.JulesAuthError, match="API key not valid"):
        async with api.JulesClient(api_key="bad", base_url=BASE) as c:
            await c.list_sources()


@respx.mock
async def test_readiness_says_why_the_button_is_greyed_out(db_clean, fake_nox, jules_on, monkeypatch):
    kb = await _setup_app()
    key = await _to_build(kb)
    async with _client("developer") as dev:
        async def state() -> dict:
            jules.forget_sources()
            return (await dev.get(f"/api/v1/missions/{key}/jules")).json()["readiness"]

        assert (await state())["state"] == "no_repo"
        await _with_repo(kb)
        route = respx.get(f"{BASE}/sources")
        route.mock(return_value=httpx.Response(403, json={"error": {"message": "denied"}}))
        r = await state()
        assert r["state"] == "failing" and "Atlas → Connectors" in r["detail"]
        route.mock(return_value=httpx.Response(200, json={"sources": []}))
        r = await state()
        assert r["state"] == "repo_not_connected" and "Nox-Demo-Org/refunds-service" in r["detail"]
        _sources(SOURCE)
        r = await state()
        assert r["state"] == "ready" and r["repos"][0]["connected"] is True
        monkeypatch.setattr(settings, "JULES_API_KEY", "")
        r = await state()
        assert r["state"] == "not_configured" and "Atlas → Connectors" in r["detail"]


@respx.mock
async def test_only_the_developer_hands_off_and_only_in_build(db_clean, fake_nox, jules_on):
    kb = await _setup_app()
    await _with_repo(kb)
    _sources(SOURCE)
    create = respx.post(f"{BASE}/sessions").mock(return_value=httpx.Response(200, json={"name": "sessions/s1", "id": "s1", "state": "QUEUED"}))
    async with _client("developer") as dev:  # a mission not yet in Build
        early = (await dev.post("/api/v1/missions", json={"prompt": "Add a refund reason code", "appIds": [kb]})).json()["key"]
    key = await _to_build(kb)
    for seat in ("business", "product", "engineering"):
        async with _client(seat) as c:
            assert (await c.post(f"/api/v1/missions/{key}/jules", json={})).status_code == 403
            status = (await c.get(f"/api/v1/missions/{key}/jules")).json()
            assert status["canAct"] is False
    async with _client("developer") as dev:
        assert (await dev.post(f"/api/v1/missions/{early}/jules", json={})).status_code == 409
        res = await dev.post(f"/api/v1/missions/{key}/jules", json={"requirePlanApproval": True})
        assert res.status_code == 201, res.text
        assert res.json()["state"] == "QUEUED" and res.json()["repo"] == "Nox-Demo-Org/refunds-service"
        body = json.loads(create.calls[0].request.content)
        assert body["title"].startswith(f"{key}: ")
        assert "## Rules" in body["prompt"] and f"`{key}`" in body["prompt"] and "Build spec" in body["prompt"]
        assert "How to work on this mission" not in body["prompt"]  # the CLI's rules are not Jules's
        again = await dev.post(f"/api/v1/missions/{key}/jules", json={})
        assert again.status_code == 409 and "already working" in again.json()["detail"]
        m = (await dev.get(f"/api/v1/missions/{key}")).json()
        assert any(link["system"] == "jules" for link in m["links"])
    assert any(n.startswith("jules watch") for n in jules_on)


@respx.mock
async def test_polling_turns_jules_into_events_and_links_the_pr(db_clean, fake_nox, jules_on):
    from sqlalchemy import select

    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import ExternalLink, MissionEvent

    kb = await _setup_app()
    await _with_repo(kb)
    _sources(SOURCE)
    respx.post(f"{BASE}/sessions").mock(return_value=httpx.Response(200, json={"name": "sessions/s1", "id": "s1", "state": "QUEUED"}))
    key = await _to_build(kb)
    async with _client("developer") as dev:
        assert (await dev.post(f"/api/v1/missions/{key}/jules", json={})).status_code == 201
    async with AsyncSessionLocal() as db:
        link = (await db.execute(select(ExternalLink).where(ExternalLink.system == "jules"))).scalars().one()
        mission_id = link.mission_id

    session = respx.get(f"{BASE}/sessions/s1")
    activities = respx.get(f"{BASE}/sessions/s1/activities")
    plan = {"id": "a1", "planGenerated": {"plan": {"id": "p1", "steps": [
        {"id": "x2", "index": 1, "title": "Add tests"}, {"id": "x1", "index": 0, "title": "Add the lockout counter"}]}}}
    session.mock(return_value=httpx.Response(200, json={"id": "s1", "state": "AWAITING_PLAN_APPROVAL"}))
    activities.mock(return_value=httpx.Response(200, json={"activities": [plan]}))
    assert await jules.poll_one(mission_id, "s1") == "AWAITING_PLAN_APPROVAL"
    assert await jules.poll_one(mission_id, "s1") == "AWAITING_PLAN_APPROVAL"  # nothing new: no second event

    async with _client("product") as po:
        assert (await po.post(f"/api/v1/missions/{key}/jules/s1/approve-plan")).status_code == 403
    approve = respx.post(f"{BASE}/sessions/s1:approvePlan").mock(return_value=httpx.Response(200, json={}))
    async with _client("developer") as dev:
        s = (await dev.get(f"/api/v1/missions/{key}/jules")).json()["sessions"][0]
        assert s["label"] == "Plan ready for you" and [p["title"] for p in s["plan"]] == ["Add the lockout counter", "Add tests"]
        res = await dev.post(f"/api/v1/missions/{key}/jules/s1/approve-plan")
        assert res.status_code == 200 and res.json()["state"] == "IN_PROGRESS" and approve.called

    session.mock(return_value=httpx.Response(200, json={"id": "s1", "state": "COMPLETED", "outputs": [
        {"pullRequest": {"url": "https://github.com/Nox-Demo-Org/refunds-service/pull/9", "title": f"{key}: lockout"}}]}))
    activities.mock(return_value=httpx.Response(200, json={"activities": [plan, {"id": "a2", "planApproved": {"planId": "p1"}},
                                                                            {"id": "a3", "sessionCompleted": {}}]}))
    assert await jules.poll_one(mission_id, "s1") is not None
    assert await jules.poll_one(mission_id, "s1") is None  # finished sessions aren't polled again

    async with AsyncSessionLocal() as db:
        types = [e.type for e in (await db.execute(select(MissionEvent).where(MissionEvent.mission_id == mission_id)
                                                     .order_by(MissionEvent.created_at))).scalars()]
        links = (await db.execute(select(ExternalLink).where(ExternalLink.mission_id == mission_id))).scalars().all()
    assert types.count("jules.plan_ready") == 1
    assert "jules.plan_approved" in types and "jules.pr_opened" in types and "pr.linked" in types
    assert any(link.system == "github_pr" and link.external_id == "Nox-Demo-Org/refunds-service#9" for link in links)
    assert any(n.startswith("guard Nox-Demo-Org/refunds-service#9") for n in jules_on)


@respx.mock
async def test_replying_to_jules(db_clean, fake_nox, jules_on):
    kb = await _setup_app()
    await _with_repo(kb)
    _sources(SOURCE)
    respx.post(f"{BASE}/sessions").mock(return_value=httpx.Response(200, json={"id": "s1", "state": "AWAITING_USER_FEEDBACK"}))
    say = respx.post(f"{BASE}/sessions/s1:sendMessage").mock(return_value=httpx.Response(200, json={}))
    key = await _to_build(kb)
    async with _client("developer") as dev:
        await dev.post(f"/api/v1/missions/{key}/jules", json={})
        async with _client("business") as biz:
            assert (await biz.post(f"/api/v1/missions/{key}/jules/s1/message", json={"text": "hi"})).status_code == 403
        res = await dev.post(f"/api/v1/missions/{key}/jules/s1/message", json={"text": "Reuse the rate limiter in auth.py"})
        assert res.status_code == 200 and json.loads(say.calls[0].request.content)["prompt"] == "Reuse the rate limiter in auth.py"
        assert (await dev.post(f"/api/v1/missions/{key}/jules/nope/message", json={"text": "x"})).status_code == 404


async def test_connectors_lists_jules(monkeypatch):
    monkeypatch.setattr(settings, "JULES_API_KEY", "")
    from nox_api.routers.integrations import _integrations

    row = next(i for i in _integrations() if i[0] == "jules")
    assert row[1] is False and row[2] is False  # optional, and not configured
