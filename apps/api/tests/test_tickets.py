"""Ticket state: the assignee and the pipeline position kept in the ticket store (Firestore in production)."""

from tests.test_missions import _client, _setup_app, _wait_drafts


def _steps(state: dict) -> dict:
    return {s["id"]: s["status"] for s in state["pipeline"]}


async def test_pipeline_follows_approvals_and_send_backs(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz, _client("product") as po:
        key = (await biz.post("/api/v1/missions", json={"prompt": "Customers keep asking where their refund is", "appIds": [kb]})).json()["key"]
        await _wait_drafts(biz, key)
        state = (await biz.get(f"/api/v1/missions/{key}/state")).json()
        assert state["currentStep"] == "business" and state["assignee"] is None
        assert [s["id"] for s in state["pipeline"]][-4:] == ["verify:developer", "verify:engineering", "verify:product", "verify:business"]

        await biz.post(f"/api/v1/missions/{key}/files/business/approve")
        state = (await po.get(f"/api/v1/missions/{key}/state")).json()
        assert state["currentStep"] == "product"
        assert _steps(state)["business"] == "done" and _steps(state)["product"] == "current" and _steps(state)["build"] == "pending"

        await _wait_drafts(po, key)
        await po.post(f"/api/v1/missions/{key}/send-back", json={"toRole": "business", "reason": "Retail or partners?"})
        state = (await biz.get(f"/api/v1/missions/{key}/state")).json()
        assert state["currentStep"] == "business" and _steps(state)["product"] == "pending"
        assert [(t["from"], t["to"], t["event"]) for t in state["transitions"]] == [
            (None, "business", "mission.created"), ("business", "product", "file.approved"), ("product", "business", "mission.sent_back"),
        ]


async def test_anyone_who_sees_the_mission_can_assign_it(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz, _client("developer", "dev@example.com") as dev:
        key = (await biz.post("/api/v1/missions", json={"prompt": "Customers keep asking where their refund is", "appIds": [kb]})).json()["key"]
        await _wait_drafts(biz, key)
        people = (await biz.get(f"/api/v1/missions/{key}/people")).json()
        assert [p["email"] for p in people] == ["lead@example.com"]  # dev@ isn't a member of Apex
        assert (await dev.get(f"/api/v1/missions/{key}/state")).status_code == 404

        state = (await biz.put(f"/api/v1/missions/{key}/assignee", json={"userId": people[0]["id"]})).json()
        assert state["assignee"]["email"] == "lead@example.com" and state["assignee"]["assignedBy"]["role"] == "business"
        events = (await biz.get(f"/api/v1/missions/{key}/events")).json()
        assert "mission.assigned" in [e["type"] for e in events]

        me = (await dev.get("/api/v1/me")).json()
        assert (await biz.put(f"/api/v1/missions/{key}/assignee", json={"userId": me["id"]})).status_code == 400
        assert (await dev.put(f"/api/v1/missions/{key}/assignee", json={"userId": None})).status_code == 404

        state = (await biz.put(f"/api/v1/missions/{key}/assignee", json={"userId": None})).json()
        assert state["assignee"] is None and state["currentStep"] == "business"
