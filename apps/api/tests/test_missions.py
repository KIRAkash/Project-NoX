import asyncio
import uuid

import httpx

from nox_api.main import app


def _client(role: str, email: str = "lead@example.com") -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test",
        headers={"Authorization": f"Dev {email}", "X-Nox-Role": role},
    )


async def _setup_app() -> str:
    """Org + one application, created directly (no pipeline)."""
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase

    async with _client("engineering") as lead:
        org = (await lead.post("/api/v1/orgs", json={"name": "Apex", "slug": "apex"})).json()
    async with AsyncSessionLocal() as db:
        kb = KnowledgeBase(org_id=uuid.UUID(org["id"]), app_name="refunds-service", source_urls=[])
        db.add(kb)
        await db.commit()
        return str(kb.id)


async def _wait_drafts(c: httpx.AsyncClient, key: str) -> dict:
    for _ in range(100):
        m = (await c.get(f"/api/v1/missions/{key}")).json()
        if not any(f["status"] == "drafting" for f in m["files"]):
            return m
        await asyncio.sleep(0.05)
    raise AssertionError("drafts never finished")


def _f(m: dict, role: str) -> dict:
    return next(f for f in m["files"] if f["role"] == role)


async def test_developer_start_drafts_upstream_and_asks_to_proceed(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("developer") as dev:
        created = (await dev.post("/api/v1/missions", json={"prompt": "Show customers their refund status", "appIds": [kb]})).json()
        assert created["key"] == "NOX-1" and created["stage"] == "developer" and created["awaitingProceed"] is True
        m = await _wait_drafts(dev, created["key"])
        assert [_f(m, r)["status"] for r in ("business", "product", "engineering", "developer")] == ["ai_drafted", "ai_drafted", "ai_drafted", "draft"]
        assert "upstream=['business', 'engineering', 'product']" in _f(m, "developer")["markdown"]
        # can't approve own file before deciding to proceed past the AI drafts
        assert (await dev.post("/api/v1/missions/NOX-1/files/developer/approve")).status_code == 409
        m = (await dev.post("/api/v1/missions/NOX-1/proceed")).json()
        assert m["awaitingProceed"] is False and m["proceededWithoutApproval"] is True
    # the business seat is asked to confirm the AI-drafted intent
    async with _client("business") as biz:
        assert [x["key"] for x in (await biz.get("/api/v1/missions?view=waiting")).json()] == ["NOX-1"]


async def test_business_start_hands_off_to_product(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz:
        created = (await biz.post("/api/v1/missions", json={"prompt": "Customers keep asking where their refund is", "appIds": [kb]})).json()
        assert created["awaitingProceed"] is False
        m = await _wait_drafts(biz, created["key"])
        assert _f(m, "business")["status"] == "draft" and _f(m, "product")["status"] == "empty"
        m = (await biz.post(f"/api/v1/missions/{created['key']}/files/business/approve")).json()
        assert m["stage"] == "product"
    async with _client("product") as po:
        m = await _wait_drafts(po, created["key"])
        assert _f(m, "product")["status"] == "ai_drafted"
        assert [x["key"] for x in (await po.get("/api/v1/missions?view=waiting")).json()] == [created["key"]]


async def test_other_seats_files_are_locked(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz:
        key = (await biz.post("/api/v1/missions", json={"prompt": "Customers keep asking where their refund is", "appIds": [kb]})).json()["key"]
        await _wait_drafts(biz, key)
        res = await biz.put(f"/api/v1/missions/{key}/files/product", json={"markdown": "# nope"})
        assert res.status_code == 403
        assert (await biz.post(f"/api/v1/missions/{key}/files/product/approve")).status_code == 403


async def test_send_back_and_stale_downstream(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz:
        key = (await biz.post("/api/v1/missions", json={"prompt": "Customers keep asking where their refund is", "appIds": [kb]})).json()["key"]
        await _wait_drafts(biz, key)
        await biz.post(f"/api/v1/missions/{key}/files/business/approve")
    async with _client("product") as po:
        await _wait_drafts(po, key)
        m = (await po.post(f"/api/v1/missions/{key}/files/product/approve")).json()
        assert m["stage"] == "engineering"
        m = (await po.post(f"/api/v1/missions/{key}/send-back", json={"toRole": "business", "reason": "Which customers — retail or partners?"})).json()
        assert m["stage"] == "business" and _f(m, "business")["status"] == "draft"
    async with _client("business") as biz:
        # editing the business file invalidates the product approval that rested on it
        await biz.put(f"/api/v1/missions/{key}/files/business", json={"markdown": "# Business file: retail customers only\n"})
        m = (await biz.get(f"/api/v1/missions/{key}")).json()
        assert _f(m, "product")["status"] == "stale"
        m = (await biz.post(f"/api/v1/missions/{key}/files/business/approve")).json()
        assert m["stage"] == "product"  # product must re-approve against the new wording
    async with _client("product") as po:
        m = (await po.post(f"/api/v1/missions/{key}/files/product/approve")).json()
        assert m["stage"] == "engineering"


async def test_approval_skips_seats_already_approved(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("developer") as dev:
        key = (await dev.post("/api/v1/missions", json={"prompt": "Show customers their refund status", "appIds": [kb]})).json()["key"]
        await _wait_drafts(dev, key)
        await dev.post(f"/api/v1/missions/{key}/proceed")
    # upstream seats confirm their AI drafts while the mission sits at the developer stage
    for role in ("business", "product", "engineering"):
        async with _client(role) as c:
            m = (await c.post(f"/api/v1/missions/{key}/files/{role}/approve")).json()
            assert m["stage"] == "developer"
    async with _client("developer") as dev:
        m = (await dev.post(f"/api/v1/missions/{key}/files/developer/approve")).json()
        assert m["stage"] == "build"


async def test_missions_are_invisible_outside_the_org(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz:
        key = (await biz.post("/api/v1/missions", json={"prompt": "Customers keep asking where their refund is", "appIds": [kb]})).json()["key"]
    async with _client("business", "outsider@example.com") as out:
        assert (await out.get(f"/api/v1/missions/{key}")).status_code == 404
        assert (await out.get("/api/v1/missions")).json() == []
        assert (await out.post("/api/v1/missions", json={"prompt": "Sneaky change request", "appIds": [kb]})).status_code == 404
