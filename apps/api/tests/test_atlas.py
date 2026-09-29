from datetime import datetime

import httpx

from nox_api.db.models import KBPin
from nox_api.main import app
from nox_api.services.pins import END, START, render_pins


def _client(email: str, role: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Dev {email}", "X-Nox-Role": role},
    )


async def _org(c: httpx.AsyncClient, slug: str = "apex") -> dict:
    return (await c.post("/api/v1/orgs", json={"name": slug.title(), "slug": slug})).json()


# ── Invites ──────────────────────────────────────────────────────────────────


async def test_inviting_an_existing_user_adds_them_directly(db_clean):
    async with _client("dev@example.com", "developer") as dev:
        await dev.get("/api/v1/me")  # dev signs in once
    async with _client("lead@example.com", "engineering") as lead:
        org = await _org(lead)
        res = await lead.post(f"/api/v1/orgs/{org['id']}/members", json={"email": "Dev@Example.com"})
        assert res.json() == {"status": "member", "email": "dev@example.com"}
    async with _client("dev@example.com", "developer") as dev:
        assert [o["slug"] for o in (await dev.get("/api/v1/orgs")).json()] == ["apex"]


async def test_pending_invite_becomes_membership_on_first_sign_in(db_clean):
    async with _client("lead@example.com", "engineering") as lead:
        org = await _org(lead)
        assert (await lead.post(f"/api/v1/orgs/{org['id']}/members", json={"email": "new@example.com"})).json()["status"] == "invited"
        members = (await lead.get(f"/api/v1/orgs/{org['id']}/members")).json()
        assert [i["email"] for i in members["invites"]] == ["new@example.com"]
    async with _client("new@example.com", "product") as newbie:
        assert [o["slug"] for o in (await newbie.get("/api/v1/orgs")).json()] == ["apex"]
    async with _client("lead@example.com", "engineering") as lead:
        members = (await lead.get(f"/api/v1/orgs/{org['id']}/members")).json()
        assert members["invites"] == [] and "new@example.com" in [m["email"] for m in members["members"]]


async def test_only_engineering_lead_invites(db_clean):
    async with _client("lead@example.com", "engineering") as lead:
        org = await _org(lead)
    async with _client("lead@example.com", "developer") as same_user_as_dev:
        res = await same_user_as_dev.post(f"/api/v1/orgs/{org['id']}/members", json={"email": "x@example.com"})
        assert res.status_code == 403


# ── Pins ─────────────────────────────────────────────────────────────────────


def test_render_pins_is_idempotent_and_replaces_block():
    pin = KBPin(page_path="entities/retry.md", text="Retries back off 1s, 4s, 16s — not 3 days.", author_name="Priya",
                created_at=datetime(2026, 9, 24))
    once = render_pins("# Retry\n\nBody.\n", [pin])
    assert START in once and END in once and "Retries back off" in once
    assert render_pins(once, [pin]) == once
    assert START not in render_pins(once, [])


async def test_pins_require_the_right_role_and_visibility(db_clean):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase, Org

    async with _client("lead@example.com", "engineering") as lead:
        org = await _org(lead)
    async with AsyncSessionLocal() as db:
        o = await db.get(Org, __import__("uuid").UUID(org["id"]))
        kb = KnowledgeBase(org_id=o.id, app_name="refunds-service", source_urls=[])
        db.add(kb)
        await db.commit()
        kb_id = str(kb.id)

    body = {"pagePath": "entities/retry.md", "text": "Retries back off 1s, 4s, 16s."}
    async with _client("lead@example.com", "business") as biz:
        assert (await biz.post(f"/api/v1/kb/{kb_id}/pins", json=body)).status_code == 403
    async with _client("outsider@example.com", "developer") as outsider:
        assert (await outsider.post(f"/api/v1/kb/{kb_id}/pins", json=body)).status_code == 404
    async with _client("lead@example.com", "developer") as dev:
        created = (await dev.post(f"/api/v1/kb/{kb_id}/pins", json=body)).json()
        assert created["authorName"] == "lead" and created["pagePath"] == "entities/retry.md"
        assert len((await dev.get(f"/api/v1/kb/{kb_id}/pins")).json()) == 1
        assert (await dev.delete(f"/api/v1/kb/{kb_id}/pins/{created['id']}")).json() == {"status": "deleted"}


# ── Source validation gate ───────────────────────────────────────────────────


async def test_source_validation_is_not_open_to_business_users(db_clean):
    async with _client("biz@example.com", "business") as biz:
        res = await biz.post("/api/v1/sources/validate", json={"type": "upload", "url": "x"})
        assert res.status_code == 403
    async with _client("dev@example.com", "developer") as dev:
        assert (await dev.post("/api/v1/sources/validate", json={"type": "upload", "url": "x"})).json()["ok"] is True
