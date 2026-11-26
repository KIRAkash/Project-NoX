"""Batch mission triage: archive, unarchive, status/stage updates, priority updates, and deletes in one DB transaction."""

from sqlalchemy import select

from tests.test_mission_cancel import _teammate
from tests.test_missions import _client, _setup_app, _wait_drafts


async def test_batch_archive_and_unarchive(db_clean, fake_nox):
    from nox_api.services.tickets import store

    kb = await _setup_app()
    await _teammate("po@example.com")

    async with _client("business") as biz:
        m1 = (await biz.post("/api/v1/missions", json={"prompt": "Archive completed refund summary", "appIds": [kb]})).json()
        m2 = (await biz.post("/api/v1/missions", json={"prompt": "Archive legacy export cleanup", "appIds": [kb]})).json()
        m3 = (await biz.post("/api/v1/missions", json={"prompt": "Keep active dispute workflow", "appIds": [kb]})).json()
        for m in (m1, m2, m3):
            await _wait_drafts(biz, m["key"])

    # Move m1 and m2 to Done, then archive them in a single batch request (mixing UUID id and NOX-n key).
    async with _client("engineering") as eng:
        done_res = await eng.patch("/api/v1/missions/batch", json={"ids": [m1["id"], m2["key"]], "status": "done"})
        assert done_res.status_code == 200
        body = done_res.json()
        assert body["updated"] == 2
        assert all(x["stage"] == "done" and x["completedAt"] is not None for x in body["missions"])

        arc_res = await eng.patch("/api/v1/missions/batch", json={"missionIds": [m1["id"], m2["id"]], "status": "archived"})
        assert arc_res.status_code == 200
        assert all(x["archived"] is not None for x in arc_res.json()["missions"])

        # Active board only shows m3; Archived view shows m1 and m2.
        assert [x["key"] for x in (await eng.get("/api/v1/missions?view=all")).json()] == [m3["key"]]
        assert {x["key"] for x in (await eng.get("/api/v1/missions?view=archived")).json()} == {m1["key"], m2["key"]}
        assert (await store().get(m1["key"]))["archived"] is not None

        events = [e["type"] for e in (await eng.get(f"/api/v1/missions/{m1['key']}/events")).json()]
        assert "mission.archived" in events

        # Unarchive brings both back onto the active board.
        unarc_res = await eng.patch("/api/v1/missions/batch", json={"ids": [m1["id"], m2["id"]], "status": "unarchived"})
        assert unarc_res.status_code == 200
        assert all(x["archived"] is None for x in unarc_res.json()["missions"])
        assert {x["key"] for x in (await eng.get("/api/v1/missions?view=all")).json()} == {m1["key"], m2["key"], m3["key"]}
        assert (await eng.get("/api/v1/missions?view=archived")).json() == []


async def test_batch_permissions_and_visibility(db_clean, fake_nox):
    kb = await _setup_app()
    await _teammate("other-biz@example.com")

    async with _client("business") as biz:
        m1 = (await biz.post("/api/v1/missions", json={"prompt": "Add settlement retry alerts", "appIds": [kb]})).json()
        await _wait_drafts(biz, m1["key"])

        # Business role cannot batch-change board stages or set product priority.
        assert (await biz.patch("/api/v1/missions/batch", json={"ids": [m1["id"]], "stage": "engineering"})).status_code == 403
        assert (await biz.patch("/api/v1/missions/batch", json={"ids": [m1["id"]], "priority": "P1"})).status_code == 403

    # Another business user who didn't create m1 cannot archive or delete it.
    async with _client("business", "other-biz@example.com") as other_biz:
        assert (await other_biz.patch("/api/v1/missions/batch", json={"ids": [m1["id"]], "status": "archived"})).status_code == 403
        assert (await other_biz.post("/api/v1/missions/batch/delete", json={"ids": [m1["id"]]})).status_code == 403

    # Product owner can batch-set priority; developer cannot.
    async with _client("developer") as dev:
        assert (await dev.patch("/api/v1/missions/batch", json={"ids": [m1["id"]], "priority": "P1"})).status_code == 403
    async with _client("product") as po:
        res = await po.patch("/api/v1/missions/batch", json={"ids": [m1["id"]], "priority": "P1"})
        assert res.status_code == 200
        assert res.json()["missions"][0]["priority"] == "P1"

    # Unauthenticated and outsider checks.
    async with _client("engineering", "outsider@example.com") as outsider:
        assert (await outsider.patch("/api/v1/missions/batch", json={"ids": [m1["id"]], "status": "archived"})).status_code == 404
        assert (await outsider.delete("/api/v1/missions/batch", params=[("ids", m1["id"])])).status_code == 404


async def test_batch_delete_and_atomicity(db_clean, fake_nox):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import Mission, SpecFile

    kb = await _setup_app()
    async with _client("business") as biz:
        m1 = (await biz.post("/api/v1/missions", json={"prompt": "Draft duplicate request one", "appIds": [kb]})).json()
        m2 = (await biz.post("/api/v1/missions", json={"prompt": "Draft duplicate request two", "appIds": [kb]})).json()
        m3 = (await biz.post("/api/v1/missions", json={"prompt": "Approved request that moved on", "appIds": [kb]})).json()
        for m in (m1, m2, m3):
            await _wait_drafts(biz, m["key"])
        await biz.post(f"/api/v1/missions/{m3['key']}/files/business/approve")

        # Atomicity on batch delete: m3 is past Business, so the whole batch fails with 409 and m1/m2 survive.
        conflict = await biz.post("/api/v1/missions/batch/delete", json={"ids": [m1["id"], m2["id"], m3["id"]]})
        assert conflict.status_code == 409
        assert (await biz.get(f"/api/v1/missions/{m1['key']}")).status_code == 200
        assert (await biz.get(f"/api/v1/missions/{m2['key']}")).status_code == 200

        # Deleting only the two eligible missions succeeds in one transaction.
        deleted = await biz.delete("/api/v1/missions/batch", params=[("ids", m1["id"]), ("ids", m2["key"])])
        assert deleted.status_code == 200
        assert deleted.json()["count"] == 2
        assert (await biz.get(f"/api/v1/missions/{m1['key']}")).status_code == 404
        assert (await biz.get(f"/api/v1/missions/{m2['key']}")).status_code == 404
        async with AsyncSessionLocal() as db:
            remaining = (await db.execute(select(Mission.number))).scalars().all()
            assert remaining == [int(m3["key"].split("-")[1])]
            orphan_files = (await db.execute(select(SpecFile).join(Mission).where(Mission.id.in_([m1["id"], m2["id"]])))).all()
            assert orphan_files == []


async def test_batch_update_rolls_back_on_partial_conflict_or_missing_id(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz:
        m1 = (await biz.post("/api/v1/missions", json={"prompt": "Live mission stays untouched", "appIds": [kb]})).json()
        m2 = (await biz.post("/api/v1/missions", json={"prompt": "Cancelled mission blocks batch", "appIds": [kb]})).json()
        await _wait_drafts(biz, m1["key"])
        await _wait_drafts(biz, m2["key"])
        await biz.post(f"/api/v1/missions/{m2['key']}/cancel", json={"reason": "Stopped"})

    async with _client("engineering") as eng:
        # m2 is cancelled -> 409, and m1 must remain in 'business' and unarchived.
        res = await eng.patch("/api/v1/missions/batch", json={"ids": [m1["id"], m2["id"]], "stage": "done", "archived": True})
        assert res.status_code == 409
        fresh_m1 = (await eng.get(f"/api/v1/missions/{m1['key']}")).json()
        assert fresh_m1["stage"] == "business"
        assert fresh_m1["archived"] is None

        # Unknown mission ID in batch -> 404, and m1 remains untouched.
        res_404 = await eng.patch("/api/v1/missions/batch", json={"ids": [m1["id"], "NOX-9999"], "status": "archived"})
        assert res_404.status_code == 404
        fresh_m1 = (await eng.get(f"/api/v1/missions/{m1['key']}")).json()
        assert fresh_m1["archived"] is None
