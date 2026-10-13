import uuid
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from fastapi.testclient import TestClient
from fastapi import FastAPI

from nox_api.main import app
from nox_api.db.database import Base, get_db
from nox_api.db.models import KnowledgeBase, Mission, SpecFile, SpecStatus, Role, User, Org, Membership
from nox_api.core.auth import current_user, current_actor, Actor


@pytest.fixture
async def sqlite_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session

    await engine.dispose()


@pytest.mark.asyncio
async def test_specs_endpoint_unit(sqlite_session: AsyncSession):
    # Setup test data in sqlite
    user = User(id=uuid.uuid4(), firebase_uid="test_user_1", email="test@example.com", name="Test User")
    org = Org(id=uuid.uuid4(), name="Apex", slug="apex")
    membership = Membership(user_id=user.id, org_id=org.id)
    kb = KnowledgeBase(id=uuid.uuid4(), org_id=org.id, app_name="auth-service", source_urls=[])
    
    mission = Mission(
        id=uuid.uuid4(),
        number=101,
        org_id=org.id,
        primary_kb_id=kb.id,
        title="Implement OAuth2 Authentication",
        prompt="Add OAuth2 login support to auth-service",
        type="feature",
        stage="product",
        created_as_role=Role.product,
    )

    f_bus = SpecFile(
        id=uuid.uuid4(),
        mission_id=mission.id,
        role=Role.business,
        status=SpecStatus.approved,
        markdown="# Business Requirements\nUsers must sign in with Google OAuth.",
        version=1,
    )
    f_prod = SpecFile(
        id=uuid.uuid4(),
        mission_id=mission.id,
        role=Role.product,
        status=SpecStatus.draft,
        markdown="# Product Spec\nAuthentication flow details and token response specification.",
        version=2,
    )
    f_dev = SpecFile(
        id=uuid.uuid4(),
        mission_id=mission.id,
        role=Role.developer,
        status=SpecStatus.empty,
        markdown="",
        version=0,
    )

    sqlite_session.add_all([user, org, membership, kb, mission, f_bus, f_prod, f_dev])
    await sqlite_session.commit()

    # Override get_db and current_user/current_actor dependencies
    async def _get_db_override():
        yield sqlite_session

    async def _current_user_override():
        return user

    async def _current_actor_override():
        return Actor(user=user, role=Role.product)

    app.dependency_overrides[get_db] = _get_db_override
    app.dependency_overrides[current_user] = _current_user_override
    app.dependency_overrides[current_actor] = _current_actor_override

    try:
        client = TestClient(app)

        # 1. Default request: excludes empty spec file
        res = client.get("/api/v1/specs", headers={"X-Nox-Role": "product"})
        assert res.status_code == 200
        specs = res.json()
        assert len(specs) == 2
        roles = {s["role"] for s in specs}
        assert roles == {"business", "product"}

        prod_spec = next(s for s in specs if s["role"] == "product")
        assert prod_spec["missionKey"] == "NOX-101"
        assert prod_spec["missionTitle"] == "Implement OAuth2 Authentication"
        assert prod_spec["status"] == "draft"
        assert prod_spec["version"] == 2
        assert "Authentication flow details" in prod_spec["markdown"]

        # 2. Filter by role=business
        res_bus = client.get("/api/v1/specs?role=business", headers={"X-Nox-Role": "product"})
        assert res_bus.status_code == 200
        specs_bus = res_bus.json()
        assert len(specs_bus) == 1
        assert specs_bus[0]["role"] == "business"

        # 3. Filter by status=approved
        res_app = client.get("/api/v1/specs?status=approved", headers={"X-Nox-Role": "product"})
        assert res_app.status_code == 200
        specs_app = res_app.json()
        assert len(specs_app) == 1
        assert specs_app[0]["status"] == "approved"

        # 4. Search query q=OAuth2
        res_q = client.get("/api/v1/specs?q=OAuth2", headers={"X-Nox-Role": "product"})
        assert res_q.status_code == 200
        assert len(res_q.json()) == 2

        # 5. Filter by app_id
        res_app_id = client.get(f"/api/v1/specs?app_id={kb.id}", headers={"X-Nox-Role": "product"})
        assert res_app_id.status_code == 200
        assert len(res_app_id.json()) == 2

    finally:
        app.dependency_overrides.clear()
