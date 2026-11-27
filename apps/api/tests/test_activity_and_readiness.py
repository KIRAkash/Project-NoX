"""Tests for workspace readiness counts on /api/v1/me and the cross-org /api/v1/activity feed."""

from datetime import datetime, timedelta

import httpx

from nox_api.core import auth
from nox_api.db.database import AsyncSessionLocal
from nox_api.db.models import KBEvent, KBStatus, KnowledgeBase, Mission, MissionEvent, MissionStage, Role
from nox_api.main import app


def _client(email: str | None = "lead@nox.test", role: str | None = "engineering") -> httpx.AsyncClient:
    headers: dict[str, str] = {}
    if email:
        headers["Authorization"] = f"Dev {email}"
    if role:
        headers["X-Nox-Role"] = role
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers)


async def test_me_readiness_tracks_visible_orgs_apps_wikis_and_missions(db_clean):
    # Someone else's org, app, and mission must never leak into our readiness counts.
    async with _client("other@nox.test", role="engineering") as other:
        other_org = (await other.post("/api/v1/orgs", json={"name": "Other Corp", "slug": "other-corp"})).json()
    async with AsyncSessionLocal() as db:
        other_kb = KnowledgeBase(org_id=other_org["id"], app_name="secret-app", status=KBStatus.published)
        other_mission = Mission(
            number=900,
            org_id=other_org["id"],
            title="Secret mission",
            prompt="Keep this hidden from outsiders",
            type="feature",
            stage=MissionStage.business,
            created_as_role=Role.engineering,
        )
        db.add_all([other_kb, other_mission])
        await db.commit()

    async with _client("fresh@nox.test", role="engineering") as c:
        me0 = (await c.get("/api/v1/me")).json()
        assert me0["readiness"] == {"orgs": 0, "apps": 0, "publishedWikis": 0, "missions": 0}

        org = (await c.post("/api/v1/orgs", json={"name": "Northstar", "slug": "northstar"})).json()
        sub = (await c.post("/api/v1/orgs", json={"name": "Trading", "slug": "ns-trading", "parentOrgId": org["id"]})).json()
        me1 = (await c.get("/api/v1/me")).json()
        assert me1["readiness"] == {"orgs": 2, "apps": 0, "publishedWikis": 0, "missions": 0}

        async with AsyncSessionLocal() as db:
            kb_queued = KnowledgeBase(org_id=org["id"], app_name="gateway", status=KBStatus.queued)
            kb_pub = KnowledgeBase(org_id=sub["id"], app_name="settlement", status=KBStatus.published)
            m_live = Mission(
                number=1,
                org_id=org["id"],
                title="Show settlement date",
                prompt="Clients keep asking when their trade will settle.",
                type="change",
                stage=MissionStage.business,
                created_as_role=Role.business,
            )
            m_cancelled = Mission(
                number=2,
                org_id=org["id"],
                title="Cancelled experiment",
                prompt="Cancelled request that should not count",
                type="feature",
                stage=MissionStage.business,
                created_as_role=Role.business,
                cancelled_at=datetime(2026, 11, 27, 1, 0, 0),
            )
            db.add_all([kb_queued, kb_pub, m_live, m_cancelled])
            await db.commit()

        me2 = (await c.get("/api/v1/me")).json()
        assert me2["readiness"] == {"orgs": 2, "apps": 2, "publishedWikis": 1, "missions": 1}


async def test_activity_auth_and_forbidden_guards(db_clean, monkeypatch):
    async with _client(email=None, role=None) as anon:
        assert (await anon.get("/api/v1/activity")).status_code == 401

    async with _client("norole@nox.test", role=None) as norole:
        assert (await norole.get("/api/v1/activity")).status_code == 409

    # Enforce Cap.SEE_ATLAS on /api/v1/activity.
    monkeypatch.setitem(auth.ACCESS, Role.business, {auth.Cap.CREATE_MISSION})
    async with _client("biz@nox.test", role="business") as restricted:
        assert (await restricted.get("/api/v1/activity")).status_code == 403


async def test_activity_combines_mission_and_kb_events_for_visible_orgs(db_clean):
    t0 = datetime(2026, 11, 27, 8, 0, 0)

    async with _client("lead@nox.test", role="engineering") as c:
        org = (await c.post("/api/v1/orgs", json={"name": "Northstar", "slug": "northstar"})).json()

    async with _client("outsider@nox.test", role="engineering") as outsider:
        hidden_org = (await outsider.post("/api/v1/orgs", json={"name": "Hidden Co", "slug": "hidden-co"})).json()

    async with AsyncSessionLocal() as db:
        kb = KnowledgeBase(org_id=org["id"], app_name="settlement-api", status=KBStatus.published)
        hidden_kb = KnowledgeBase(org_id=hidden_org["id"], app_name="hidden-api", status=KBStatus.published)
        mission = Mission(
            number=14,
            org_id=org["id"],
            title="Show trade settlement date",
            prompt="Clients keep asking when their trade will settle.",
            type="change",
            stage=MissionStage.product,
            created_as_role=Role.business,
        )
        hidden_mission = Mission(
            number=99,
            org_id=hidden_org["id"],
            title="Hidden mission",
            prompt="Should never appear in Northstar's feed",
            type="feature",
            stage=MissionStage.business,
            created_as_role=Role.engineering,
        )
        db.add_all([kb, hidden_kb, mission, hidden_mission])
        await db.flush()

        db.add_all([
            KBEvent(
                kb_id=kb.id,
                event_type="status_change",
                payload={"status": "published", "message": "PR was merged"},
                created_at=t0 + timedelta(minutes=1),
            ),
            # Internal graph node events stay out of the human activity feed.
            KBEvent(
                kb_id=kb.id,
                event_type="node_started",
                payload={"node": "cartographer"},
                created_at=t0 + timedelta(minutes=2),
            ),
            MissionEvent(
                mission_id=mission.id,
                actor_name="Alice",
                acting_role="business",
                type="mission.created",
                payload={"stage": "business"},
                created_at=t0 + timedelta(minutes=3),
            ),
            MissionEvent(
                mission_id=mission.id,
                actor_name="Alice",
                acting_role="business",
                type="file.approved",
                payload={"role": "business", "stage": "product"},
                created_at=t0 + timedelta(minutes=5),
            ),
            # Duplicate verification summary events are omitted just like the mission timeline.
            MissionEvent(
                mission_id=mission.id,
                actor_name="Alice",
                acting_role="business",
                type="mission.update",
                payload={"kind": "completed"},
                created_at=t0 + timedelta(minutes=6),
            ),
            KBEvent(
                kb_id=hidden_kb.id,
                event_type="status_change",
                payload={"status": "published"},
                created_at=t0 + timedelta(minutes=7),
            ),
            MissionEvent(
                mission_id=hidden_mission.id,
                actor_name="Mallory",
                acting_role="engineering",
                type="mission.created",
                payload={"stage": "business"},
                created_at=t0 + timedelta(minutes=8),
            ),
        ])
        kb_id_str = str(kb.id)
        await db.commit()

    async with _client("lead@nox.test", role="engineering") as c:
        res = await c.get("/api/v1/activity")
        assert res.status_code == 200
        feed = res.json()
        assert [item["type"] for item in feed] == ["file.approved", "mission.created", "status_change"]
        assert feed[0]["kind"] == "mission"
        assert feed[0]["targetKey"] == "NOX-14"
        assert feed[0]["href"] == "/app/missions/NOX-14"
        assert feed[0]["orgName"] == "Northstar"
        assert feed[2]["kind"] == "kb"
        assert feed[2]["targetKey"] == "settlement-api"
        assert feed[2]["href"] == f"/app/atlas/apps/{kb_id_str}"

        only_kb = (await c.get("/api/v1/activity?kind=kb")).json()
        assert len(only_kb) == 1 and only_kb[0]["kind"] == "kb"

        only_missions = (await c.get("/api/v1/activity?kind=mission&limit=1")).json()
        assert len(only_missions) == 1 and only_missions[0]["type"] == "file.approved"

    async with _client("fresh-empty@nox.test", role="engineering") as fresh:
        assert (await fresh.get("/api/v1/activity")).json() == []
