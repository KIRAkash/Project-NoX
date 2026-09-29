import time

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth import crypt
from google.auth import jwt as google_jwt

from nox_api.core import auth
from nox_api.main import app


def _client(email: str | None = "dev@nox.test", role: str | None = None) -> httpx.AsyncClient:
    headers = {}
    if email:
        headers["Authorization"] = f"Dev {email}"
    if role:
        headers["X-Nox-Role"] = role
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers)


async def test_requests_without_credentials_get_401(db_clean):
    async with _client(email=None) as c:
        assert (await c.get("/api/v1/me")).status_code == 401
        assert (await c.get("/api/v1/orgs")).status_code == 401


async def test_first_call_creates_user_and_role_round_trips(db_clean):
    async with _client() as c:
        me = (await c.get("/api/v1/me")).json()
        assert me["email"] == "dev@nox.test" and me["role"] is None
        # No role picked yet: role-gated routes ask for one.
        assert (await c.get("/api/v1/orgs")).status_code == 409
        me = (await c.put("/api/v1/me/role", json={"role": "developer"})).json()
        assert me["role"] == "developer" and "see_atlas" in me["capabilities"]
        assert (await c.get("/api/v1/me")).json()["role"] == "developer"


async def test_business_user_is_kept_out_of_the_atlas(db_clean):
    async with _client(role="business") as c:
        res = await c.get("/api/v1/orgs")
        assert res.status_code == 403 and "business" in res.json()["detail"]
        assert (await c.get("/api/v1/kb")).status_code == 403
    async with _client(role="developer") as c:
        assert (await c.get("/api/v1/orgs")).status_code == 200


async def test_only_engineering_lead_creates_orgs_and_creator_sees_it(db_clean):
    body = {"name": "Apex Holdings", "slug": "apex"}
    async with _client(role="developer") as c:
        assert (await c.post("/api/v1/orgs", json=body)).status_code == 403
    async with _client(role="engineering") as c:
        created = await c.post("/api/v1/orgs", json=body)
        assert created.status_code == 200
        assert [o["slug"] for o in (await c.get("/api/v1/orgs")).json()] == ["apex"]


async def test_orgs_are_invisible_to_non_members(db_clean):
    async with _client("lead@nox.test", role="engineering") as c:
        org = (await c.post("/api/v1/orgs", json={"name": "Private", "slug": "private"})).json()
    async with _client("outsider@nox.test", role="engineering") as c:
        assert (await c.get("/api/v1/orgs")).json() == []
        assert (await c.get(f"/api/v1/orgs/{org['id']}")).status_code == 404


async def test_sub_orgs_inherit_parent_visibility(db_clean):
    async with _client(role="engineering") as c:
        parent = (await c.post("/api/v1/orgs", json={"name": "Apex", "slug": "apex"})).json()
        child = await c.post("/api/v1/orgs", json={"name": "Trading", "slug": "trading", "parentOrgId": parent["id"]})
        assert child.status_code == 200
        assert {o["slug"] for o in (await c.get("/api/v1/orgs")).json()} == {"apex", "trading"}


async def test_new_users_join_demo_orgs(db_clean, monkeypatch):
    async with _client("lead@nox.test", role="engineering") as c:
        await c.post("/api/v1/orgs", json={"name": "Apex", "slug": "apex"})
    monkeypatch.setattr(auth.settings, "NOX_DEMO_ORG_SLUGS", "apex")
    async with _client("judge@nox.test", role="developer") as c:
        assert [o["slug"] for o in (await c.get("/api/v1/orgs")).json()] == ["apex"]


async def test_dev_auth_is_refused_when_disabled(db_clean, monkeypatch):
    monkeypatch.setattr(auth.settings, "NOX_DEV_AUTH", False)
    async with _client() as c:
        assert (await c.get("/api/v1/me")).status_code == 401


async def test_unknown_role_header_is_rejected(db_clean):
    async with _client(role="admin") as c:
        assert (await c.get("/api/v1/orgs")).status_code == 400


# ── Firebase token verification (signed locally, no network) ────────────────


def _signed_token(key, kid: str, project: str, **overrides) -> str:
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    now = int(time.time())
    claims = {
        "iss": f"https://securetoken.google.com/{project}", "aud": project, "sub": "uid-123",
        "iat": now, "exp": now + 600, "email": "judge@example.com", "name": "Judge",
    }
    claims.update(overrides)
    return google_jwt.encode(crypt.RSASigner.from_string(pem, kid), claims).decode()


@pytest.fixture
def firebase_keys(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)

    async def fake_certs():
        return {"k1": public_pem.decode()}

    monkeypatch.setattr(auth._certs, "get", fake_certs)
    monkeypatch.setattr(auth.settings, "FIREBASE_PROJECT_ID", "nox-demo")
    return key


async def test_valid_firebase_token_signs_in(db_clean, firebase_keys):
    token = _signed_token(firebase_keys, "k1", "nox-demo")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        me = (await c.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})).json()
    assert me["email"] == "judge@example.com" and me["name"] == "Judge"


@pytest.mark.parametrize("overrides", [{"aud": "other-project"}, {"iss": "https://evil.example"}, {"exp": 1}])
async def test_bad_firebase_tokens_are_rejected(db_clean, firebase_keys, overrides):
    token = _signed_token(firebase_keys, "k1", "nox-demo", **overrides)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})).status_code == 401
