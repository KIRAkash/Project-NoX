"""Cancel, restore and delete: only the creator, cancelled missions are read-only, delete only before anything left NoX."""

import uuid

from sqlalchemy import select

from tests.test_missions import _client, _f, _setup_app, _wait_drafts

PROMPT = "Customers keep asking where their refund is"


async def _teammate(email: str = "po@example.com") -> None:
    """A second member of the same org (signs in once, then joins the creator's org)."""
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import Membership, Org, User

    async with _client("product", email) as c:
        await c.get("/api/v1/me")
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalars().one()
        org = (await db.execute(select(Org).where(Org.slug == "apex"))).scalars().one()
        db.add(Membership(user_id=user.id, org_id=org.id))
        await db.commit()


async def test_creator_cancels_and_restores(db_clean, fake_nox):
    kb = await _setup_app()
    await _teammate()
    async with _client("business") as biz:
        key = (await biz.post("/api/v1/missions", json={"prompt": PROMPT, "appIds": [kb]})).json()["key"]
        await _wait_drafts(biz, key)
    async with _client("product", "po@example.com") as po:
        assert (await po.post(f"/api/v1/missions/{key}/cancel", json={})).status_code == 403
    async with _client("business") as biz:
        m = (await biz.post(f"/api/v1/missions/{key}/cancel", json={"reason": "Duplicate of NOX-9"})).json()
        assert m["cancelled"]["reason"] == "Duplicate of NOX-9"
        # read-only while cancelled
        res = await biz.put(f"/api/v1/missions/{key}/files/business", json={"markdown": "# changed"})
        assert res.status_code == 409 and "cancelled" in res.json()["detail"]
        assert (await biz.post(f"/api/v1/missions/{key}/files/business/approve")).status_code == 409
        # out of every lane, in its own view, still readable
        assert (await biz.get("/api/v1/missions")).json() == []
        assert (await biz.get("/api/v1/missions?view=waiting")).json() == []
        assert [x["key"] for x in (await biz.get("/api/v1/missions?view=cancelled")).json()] == [key]
        assert (await biz.get(f"/api/v1/missions/{key}")).status_code == 200
        types = [e["type"] for e in (await biz.get(f"/api/v1/missions/{key}/events")).json()]
        assert "mission.cancelled" in types
    async with _client("product", "po@example.com") as po:
        assert (await po.post(f"/api/v1/missions/{key}/restore")).status_code == 403
    async with _client("business") as biz:
        m = (await biz.post(f"/api/v1/missions/{key}/restore")).json()
        assert m["cancelled"] is None and m["stage"] == "business"
        assert (await biz.post(f"/api/v1/missions/{key}/files/business/approve")).json()["stage"] == "product"
        assert [x["key"] for x in (await biz.get("/api/v1/missions")).json()] == [key]


async def test_cancel_marks_the_ticket(db_clean, fake_nox):
    from nox_api.services.tickets import store

    kb = await _setup_app()
    async with _client("business") as biz:
        key = (await biz.post("/api/v1/missions", json={"prompt": PROMPT, "appIds": [kb]})).json()["key"]
        await biz.post(f"/api/v1/missions/{key}/cancel", json={"reason": "Not needed"})
        assert (await store().get(key))["cancelled"]["reason"] == "Not needed"
        await biz.post(f"/api/v1/missions/{key}/restore")
        assert (await store().get(key))["cancelled"] is None


async def test_delete_only_before_anything_left_nox(db_clean, fake_nox):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import Mission, SpecFile
    from nox_api.services.tickets import store

    kb = await _setup_app()
    await _teammate()
    async with _client("business") as biz:
        first = (await biz.post("/api/v1/missions", json={"prompt": PROMPT, "appIds": [kb]})).json()["key"]
        second = (await biz.post("/api/v1/missions", json={"prompt": "Let partners download refund reports", "appIds": [kb]})).json()["key"]
        await _wait_drafts(biz, first)
        m = await _wait_drafts(biz, second)
        assert _f(m, "business")["status"] == "draft"
    async with _client("product", "po@example.com") as po:
        assert (await po.delete(f"/api/v1/missions/{first}")).status_code == 403

    async with _client("business") as biz:
        assert (await biz.delete(f"/api/v1/missions/{first}")).status_code == 204
        assert (await biz.get(f"/api/v1/missions/{first}")).status_code == 404
        assert await store().get(first) is None
        async with AsyncSessionLocal() as db:
            assert (await db.execute(select(SpecFile).join(Mission).where(Mission.number == int(first.split("-")[1])))).first() is None

        # once the business file is approved, the mission has moved on: cancel, don't delete
        await biz.post(f"/api/v1/missions/{second}/files/business/approve")
        res = await biz.delete(f"/api/v1/missions/{second}")
        assert res.status_code == 409 and "Cancel it instead" in res.json()["detail"]
        assert (await biz.get(f"/api/v1/missions/{second}")).status_code == 200


async def test_cancel_reopens_its_sighting(db_clean, fake_nox):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase, Mission, Sighting, SightingStatus

    kb = await _setup_app()
    async with _client("business") as biz:
        key = (await biz.post("/api/v1/missions", json={"prompt": PROMPT, "appIds": [kb]})).json()["key"]
    async with AsyncSessionLocal() as db:
        k = await db.get(KnowledgeBase, uuid.UUID(kb))
        mission = (await db.execute(select(Mission).where(Mission.number == int(key.split("-")[1])))).scalars().one()
        s = Sighting(org_id=k.org_id, kb_ids=[kb], fingerprint="fp", kind="gap", claim="Refund status is hidden", views={}, evidence=[],
                     status=SightingStatus.launched, mission_id=mission.id)
        db.add(s)
        await db.flush()
        mission.sighting_id = s.id
        await db.commit()
        sid = s.id
    async with _client("business") as biz:
        await biz.post(f"/api/v1/missions/{key}/cancel", json={})
    async with AsyncSessionLocal() as db:
        s = await db.get(Sighting, sid)
        assert s.status == SightingStatus.open and s.mission_id is None
    async with _client("business") as biz:
        await biz.post(f"/api/v1/missions/{key}/restore")
    async with AsyncSessionLocal() as db:
        s = await db.get(Sighting, sid)
        assert s.status == SightingStatus.launched and s.mission_id is not None
