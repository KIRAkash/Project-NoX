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
        assert (await c.get("/api/v1/me/demo-estate")).json()["available"] is False
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
