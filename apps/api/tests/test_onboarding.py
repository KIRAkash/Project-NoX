"""First run: the welcome screen's demo-or-fresh choice, the demo estate preview, and guided tours."""

import httpx

from nox_api.core import auth
from nox_api.main import app


def _client(email: str | None = "new@nox.test", role: str | None = None) -> httpx.AsyncClient:
    headers = {"Authorization": f"Dev {email}"} if email else {}
    if role:
        headers["X-Nox-Role"] = role
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers)


async def _demo_estate(monkeypatch):
    """Tidewell-shaped: a root org, two teams (one with a sub-team), three apps."""
    async with _client("lead@nox.test", role="engineering") as c:
        root = (await c.post("/api/v1/orgs", json={"name": "Tidewell Mutual", "slug": "tidewell"})).json()
        claims = (await c.post("/api/v1/orgs", json={"name": "Claims", "slug": "tw-claims", "parentOrgId": root["id"]})).json()
        intake = (await c.post("/api/v1/orgs", json={"name": "Claims intake", "slug": "tw-claims-intake", "parentOrgId": claims["id"]})).json()
        policy = (await c.post("/api/v1/orgs", json={"name": "Policy", "slug": "tw-policy", "parentOrgId": root["id"]})).json()
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KBStatus, KnowledgeBase

    async with AsyncSessionLocal() as db:
        db.add_all([
            KnowledgeBase(org_id=intake["id"], app_name="claims-intake", status=KBStatus.published),
            KnowledgeBase(org_id=claims["id"], app_name="fraud-scoring", status=KBStatus.generating),
            KnowledgeBase(org_id=policy["id"], app_name="rating-service", status=KBStatus.published),
        ])
        await db.commit()
    monkeypatch.setattr(auth.settings, "NOX_DEMO_ORG_SLUGS", "tidewell")
    return root


async def test_new_user_starts_unonboarded_with_no_orgs(db_clean, monkeypatch):
    await _demo_estate(monkeypatch)
    async with _client() as c:
        me = (await c.get("/api/v1/me")).json()
        assert me["onboarded"] is False and me["estate"] is None and me["orgs"] == []
        assert me["demoAvailable"] is True and me["inDemo"] is False and me["toursSeen"] == []


async def test_demo_estate_preview_before_joining(db_clean, monkeypatch):
    await _demo_estate(monkeypatch)
    async with _client() as c:
        estate = (await c.get("/api/v1/me/demo-estate")).json()
    assert estate["available"] is True
    assert estate["orgs"] == [{"name": "Tidewell Mutual", "slug": "tidewell"}]
    teams = {t["name"]: [a["name"] for a in t["apps"]] for t in estate["teams"]}
    assert teams == {"Claims": ["claims-intake", "fraud-scoring"], "Policy": ["rating-service"]}  # sub-team apps roll up
    first = estate["teams"][0]["apps"][0]
    assert first["contracts"] == 0 and first["inFlight"] is False
    assert estate["sources"] == []  # no sources on these test applications
    assert estate["counts"] == {"teams": 2, "apps": 3, "appsInOrbit": 2, "missionsInFlight": 0, "contracts": 0}


async def test_demo_estate_preview_leaves_out_other_orgs(db_clean, monkeypatch):
    await _demo_estate(monkeypatch)
    async with _client("other-lead@nox.test", role="engineering") as c:
        await c.post("/api/v1/orgs", json={"name": "Secret Co", "slug": "secret"})
    async with _client() as c:
        estate = (await c.get("/api/v1/me/demo-estate")).json()
    assert "Secret Co" not in str(estate)


async def test_demo_estate_preview_without_a_demo(db_clean):
    async with _client() as c:
        empty = (await c.get("/api/v1/me/demo-estate")).json()
        assert empty["available"] is False and empty["sources"] == []
        assert (await c.get("/api/v1/me")).json()["demoAvailable"] is False
        refused = await c.post("/api/v1/me/onboarding", json={"estate": "demo"})
        assert refused.status_code == 409
        me = (await c.post("/api/v1/me/onboarding", json={"estate": "fresh"})).json()
        assert me["onboarded"] is True and me["estate"] == "fresh"


async def test_choosing_demo_joins_it_and_is_idempotent(db_clean, monkeypatch):
    await _demo_estate(monkeypatch)
    async with _client() as c:
        me = (await c.post("/api/v1/me/onboarding", json={"estate": "demo"})).json()
        assert me["onboarded"] is True and me["estate"] == "demo" and me["inDemo"] is True
        assert "tidewell" in {o["slug"] for o in me["orgs"]} and "tw-claims-intake" in {o["slug"] for o in me["orgs"]}
        again = (await c.post("/api/v1/me/onboarding", json={"estate": "demo"})).json()
        assert again["orgs"] == me["orgs"]


async def test_choosing_fresh_joins_nothing(db_clean, monkeypatch):
    await _demo_estate(monkeypatch)
    async with _client() as c:
        me = (await c.post("/api/v1/me/onboarding", json={"estate": "fresh"})).json()
        assert me["onboarded"] is True and me["estate"] == "fresh" and me["orgs"] == [] and me["inDemo"] is False


async def test_leaving_the_demo_keeps_invited_memberships(db_clean, monkeypatch):
    await _demo_estate(monkeypatch)
    async with _client("lead@nox.test", role="engineering") as c:
        real = (await c.post("/api/v1/orgs", json={"name": "Real Co", "slug": "real"})).json()
        assert (await c.post(f"/api/v1/orgs/{real['id']}/members", json={"email": "invitee@example.com"})).status_code == 200
        # An invite into a demo team is a real invitation too: leaving the demo keeps it.
        policy = next(o for o in (await c.get("/api/v1/orgs")).json() if o["slug"] == "tw-policy")
        assert (await c.post(f"/api/v1/orgs/{policy['id']}/members", json={"email": "invitee@example.com"})).status_code == 200
    async with _client("invitee@example.com") as c:
        await c.post("/api/v1/me/onboarding", json={"estate": "demo"})
        me = (await c.post("/api/v1/me/onboarding", json={"estate": "fresh"})).json()
        assert {o["slug"] for o in me["orgs"]} == {"real", "tw-policy"}
        assert me["inDemo"] is False and me["estate"] == "fresh"


async def test_onboarding_rejects_unknown_estates(db_clean):
    async with _client() as c:
        assert (await c.post("/api/v1/me/onboarding", json={"estate": "moon"})).status_code == 422


async def test_tours_are_marked_seen_and_replayed(db_clean):
    async with _client() as c:
        assert (await c.put("/api/v1/me/tours/home:business")).json() == {"toursSeen": ["home:business"]}
        assert (await c.put("/api/v1/me/tours/home:business")).json() == {"toursSeen": ["home:business"]}
        await c.put("/api/v1/me/tours/mission")
        assert (await c.get("/api/v1/me")).json()["toursSeen"] == ["home:business", "mission"]
        assert (await c.delete("/api/v1/me/tours/home:business")).json() == {"toursSeen": ["mission"]}
        assert (await c.put("/api/v1/me/tours/not-a-tour")).status_code == 404


async def test_first_run_routes_need_sign_in(db_clean):
    async with _client(email=None) as c:
        assert (await c.get("/api/v1/me/demo-estate")).status_code == 401
        assert (await c.post("/api/v1/me/onboarding", json={"estate": "fresh"})).status_code == 401
        assert (await c.put("/api/v1/me/tours/mission")).status_code == 401
        assert (await c.delete("/api/v1/me/tours/mission")).status_code == 401


def test_sources_are_grouped_labelled_and_deduplicated():
    import uuid

    from nox_api.db.models import KnowledgeBase
    from nox_api.services import onboarding

    a = KnowledgeBase(id=uuid.uuid4(), app_name="claims-intake", git_repo_url="https://github.com/acme/kb-claims-intake", source_urls=[
        {"type": "github", "url": "https://github.com/acme/claims-intake"},
        {"type": "confluence", "url": "https://acme.atlassian.net/wiki/spaces/TWCLM"},
        {"type": "slack", "url": "https://slack.com/archives/C01"},
    ])
    b = KnowledgeBase(id=uuid.uuid4(), app_name="fraud-scoring", source_urls=[
        {"type": "confluence", "url": "https://acme.atlassian.net/wiki/spaces/TWCLM"},
        {"type": "jira", "url": "https://acme.atlassian.net/jira/projects/TWCLM"},
    ])
    groups = {g["type"]: g["items"] for g in onboarding._sources([a, b])}
    assert list(groups) == ["github", "confluence", "jira", "slack", "wiki"]
    assert groups["github"][0]["label"] == "acme/claims-intake"
    assert groups["confluence"] == [{"url": "https://acme.atlassian.net/wiki/spaces/TWCLM", "label": "TWCLM space", "apps": ["claims-intake", "fraud-scoring"]}]
    assert groups["jira"][0]["label"] == "TWCLM project"
    assert groups["slack"][0]["label"] == "Channel for claims-intake"
    assert groups["wiki"][0]["label"] == "acme/kb-claims-intake"


async def test_workspace_checklist_tracks_milestones_and_persists_across_sessions(db_clean, fake_nox, monkeypatch):
    from nox_api.routers import orgs as orgs_router

    monkeypatch.setattr(orgs_router, "dispatch_generation_pipeline", lambda _kb_id: None)

    async with _client("founder@example.com", role="engineering") as c:
        # 0 of 4 before charting an organization
        initial = (await c.get("/api/v1/me/checklist")).json()
        assert initial["completedCount"] == 0 and initial["totalCount"] == 4
        assert initial["progressPercent"] == 0 and initial["completed"] is False and initial["dismissed"] is False
        assert [s["key"] for s in initial["steps"]] == ["create_org", "link_connector", "invite_seat", "launch_mission"]

        # 1 of 4 after charting an organization
        org = (await c.post("/api/v1/orgs", json={"name": "Horizon Labs", "slug": "horizon"})).json()
        team = (await c.post("/api/v1/orgs", json={"name": "Platform", "slug": "horizon-platform", "parentOrgId": org["id"]})).json()
        step1 = (await c.get("/api/v1/me/checklist")).json()
        assert step1["workspaceId"] == org["id"] and step1["workspaceName"] == "Horizon Labs"
        assert step1["completedSteps"] == ["create_org"]
        assert step1["completedCount"] == 1 and step1["progressPercent"] == 25 and step1["completed"] is False

        # 2 of 4 after connecting a repository / onboarding an application in a child team
        kb = (
            await c.post(
                f"/api/v1/orgs/{team['id']}/apps",
                json={"appName": "billing-api", "sourceUrls": [{"type": "github", "url": "https://github.com/horizon/billing-api"}]},
            )
        ).json()
        step2 = (await c.get("/api/v1/me/checklist")).json()
        assert step2["completedSteps"] == ["create_org", "link_connector"]
        assert step2["completedCount"] == 2 and step2["progressPercent"] == 50

        # 3 of 4 after inviting a seat
        assert (await c.post(f"/api/v1/orgs/{org['id']}/members", json={"email": "pm@example.com"})).status_code == 200
        step3 = (await c.get("/api/v1/me/checklist")).json()
        assert step3["completedSteps"] == ["create_org", "link_connector", "invite_seat"]
        assert step3["completedCount"] == 3 and step3["progressPercent"] == 75

        # 4 of 4 after launching a mission -> completed is True
        mission = (
            await c.post(
                "/api/v1/missions",
                json={"prompt": "Add invoice webhook retry backoff for failed deliveries", "appIds": [kb["id"]], "type": "feature"},
            )
        ).json()
        assert mission["key"] == "NOX-1"
        step4 = (await c.get("/api/v1/me/checklist")).json()
        assert step4["completedSteps"] == ["create_org", "link_connector", "invite_seat", "launch_mission"]
        assert step4["completedCount"] == 4 and step4["progressPercent"] == 100 and step4["completed"] is True

    # New session for the invited teammate sees the same persisted workspace milestone progress
    async with _client("pm@example.com", role="product") as pm:
        shared = (await pm.get("/api/v1/me/checklist")).json()
        assert shared["workspaceId"] == org["id"]
        assert shared["completedCount"] == 4 and shared["completed"] is True


async def test_workspace_checklist_dismiss_persists_and_enforces_visibility(db_clean):
    # Unauthenticated callers get 401
    async with _client(email=None) as anon:
        assert (await anon.get("/api/v1/me/checklist")).status_code == 401
        assert (await anon.post("/api/v1/me/checklist/dismiss")).status_code == 401
        assert (await anon.delete("/api/v1/me/checklist/dismiss")).status_code == 401

    # Fresh user without an org can dismiss and restore
    async with _client("solo@example.com", role="engineering") as solo:
        assert (await solo.post("/api/v1/me/checklist/dismiss")).json()["dismissed"] is True
        assert (await solo.get("/api/v1/me/checklist")).json()["dismissed"] is True
        assert (await solo.delete("/api/v1/me/checklist/dismiss")).json()["dismissed"] is False

    # Workspace dismissal is scoped per user and rejects unseen orgIds with 404
    async with _client("lead@example.com", role="engineering") as lead:
        org = (await lead.post("/api/v1/orgs", json={"name": "Atlas Corp", "slug": "atlas-corp"})).json()
        assert (await lead.post(f"/api/v1/orgs/{org['id']}/members", json={"email": "dev@example.com"})).status_code == 200
        dismissed = (await lead.post("/api/v1/me/checklist/dismiss", json={"orgId": org["id"]})).json()
        assert dismissed["dismissed"] is True and dismissed["completedCount"] == 2
        assert (await lead.get("/api/v1/me/checklist")).json()["dismissed"] is True

    async with _client("dev@example.com", role="developer") as dev:
        # Teammate has not dismissed their own card yet
        dev_view = (await dev.get("/api/v1/me/checklist")).json()
        assert dev_view["workspaceId"] == org["id"] and dev_view["dismissed"] is False

    async with _client("outsider@example.com", role="engineering") as outsider:
        assert (await outsider.get(f"/api/v1/me/checklist?orgId={org['id']}")).status_code == 404
        assert (await outsider.post("/api/v1/me/checklist/dismiss", json={"orgId": org["id"]})).status_code == 404
        assert (await outsider.delete(f"/api/v1/me/checklist/dismiss?orgId={org['id']}")).status_code == 404
