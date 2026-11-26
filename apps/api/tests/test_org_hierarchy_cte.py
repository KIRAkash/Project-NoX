"""Tests for recursive CTE organization hierarchy resolution in auth.py and missions.py."""

import contextlib
import uuid

import httpx
import pytest
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from nox_api.core.auth import (
    ancestor_org_ids,
    ancestor_org_ids_cte,
    descendant_org_ids_cte,
    sub_org_ids,
    visible_org_ids,
)
from nox_api.db.database import AsyncSessionLocal, Base, engine
from nox_api.db.models import KnowledgeBase, Membership, Mission, Org, Role, User
from nox_api.main import app
from nox_api.routers.missions import _people_who_see


@pytest.fixture
async def sqlite_db():
    sqlite_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with sqlite_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(sqlite_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session, sqlite_engine
    await sqlite_engine.dispose()


@contextlib.contextmanager
def _capture_sql(async_engine):
    statements: list[str] = []

    def _before_cursor_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(async_engine.sync_engine, "before_cursor_execute", _before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(async_engine.sync_engine, "before_cursor_execute", _before_cursor_execute)


async def _seed_hierarchy(db: AsyncSession) -> dict[str, dict]:
    """Create a 4-level org hierarchy plus a disjoint org tree and users at each node.

    Hierarchy:
      enterprise (u_ceo)
        ├── div_a (u_vp_a)
        │     └── dept_a1 (u_dir_a1)
        │           ├── team_a1a (u_dev_a1a)
        │           └── team_a1b (u_dev_a1b)
        └── div_b (u_vp_b)
              └── dept_b1 (u_dev_b1)
      external_corp (u_ext)
        └── external_team (u_ext_team)
    """
    enterprise = Org(id=uuid.uuid4(), name="Enterprise", slug="enterprise")
    div_a = Org(id=uuid.uuid4(), name="Division A", slug="div-a", parent_org_id=enterprise.id)
    dept_a1 = Org(id=uuid.uuid4(), name="Dept A1", slug="dept-a1", parent_org_id=div_a.id)
    team_a1a = Org(id=uuid.uuid4(), name="Team A1a", slug="team-a1a", parent_org_id=dept_a1.id)
    team_a1b = Org(id=uuid.uuid4(), name="Team A1b", slug="team-a1b", parent_org_id=dept_a1.id)
    div_b = Org(id=uuid.uuid4(), name="Division B", slug="div-b", parent_org_id=enterprise.id)
    dept_b1 = Org(id=uuid.uuid4(), name="Dept B1", slug="dept-b1", parent_org_id=div_b.id)
    external_corp = Org(id=uuid.uuid4(), name="External Corp", slug="ext-corp")
    external_team = Org(id=uuid.uuid4(), name="External Team", slug="ext-team", parent_org_id=external_corp.id)

    orgs = {
        "enterprise": enterprise,
        "div_a": div_a,
        "dept_a1": dept_a1,
        "team_a1a": team_a1a,
        "team_a1b": team_a1b,
        "div_b": div_b,
        "dept_b1": dept_b1,
        "external_corp": external_corp,
        "external_team": external_team,
    }
    db.add_all(orgs.values())
    await db.flush()

    users: dict[str, User] = {}
    memberships: list[Membership] = []
    specs = [
        ("ceo", "Zoe CEO", "ceo@nox.test", ["enterprise"]),
        ("vp_a", "Alice VP", "vp-a@nox.test", ["div_a"]),
        ("dir_a1", "Bob Director", "dir-a1@nox.test", ["dept_a1"]),
        ("dev_a1a", "Charlie Dev", "dev-a1a@nox.test", ["team_a1a"]),
        ("dev_a1b", "Dana Sibling", "dev-a1b@nox.test", ["team_a1b"]),
        ("vp_b", "Evan VP B", "vp-b@nox.test", ["div_b"]),
        ("dev_b1", "Fran Dev B1", "dev-b1@nox.test", ["dept_b1"]),
        ("ext", "Greg External", "ext@other.test", ["external_corp"]),
        ("ext_team", "Hannah ExtTeam", "ext-team@other.test", ["external_team"]),
        ("multi", "Multi Member", "multi@nox.test", ["team_a1a", "div_b"]),
        ("overlap", "Overlap Member", "overlap@nox.test", ["enterprise", "team_a1a"]),
        ("none", "No Org User", "noorg@nox.test", []),
    ]
    for key, name, email, org_keys in specs:
        u = User(id=uuid.uuid4(), firebase_uid=f"uid-{key}", email=email, name=name)
        users[key] = u
        db.add(u)
        for ok in org_keys:
            memberships.append(Membership(user_id=u.id, org_id=orgs[ok].id))

    db.add_all(memberships)
    await db.commit()
    return {"orgs": orgs, "users": users}


async def _assert_multi_level_behavior(db: AsyncSession, async_engine) -> None:
    data = await _seed_hierarchy(db)
    orgs = data["orgs"]
    users = data["users"]

    # 1. Direct SQL helper verification (Requirement 1 & Requirement 2)
    assert await sub_org_ids(db, []) == set()
    assert await sub_org_ids(db, [orgs["div_a"].id]) == {
        orgs["div_a"].id,
        orgs["dept_a1"].id,
        orgs["team_a1a"].id,
        orgs["team_a1b"].id,
    }
    assert await ancestor_org_ids(db, None) == set()
    assert await ancestor_org_ids(db, orgs["team_a1a"].id) == {
        orgs["team_a1a"].id,
        orgs["dept_a1"].id,
        orgs["div_a"].id,
        orgs["enterprise"].id,
    }

    # 2. visible_org_ids across root, middle, leaf, disjoint, overlapping, and empty memberships
    with _capture_sql(async_engine) as stmts:
        ceo_visible = await visible_org_ids(db, users["ceo"])
    assert len(stmts) == 1
    assert "WITH RECURSIVE" in stmts[0].upper()
    assert "WHERE" in stmts[0].upper()
    assert all(isinstance(oid, uuid.UUID) for oid in ceo_visible)
    assert ceo_visible == {
        orgs["enterprise"].id,
        orgs["div_a"].id,
        orgs["dept_a1"].id,
        orgs["team_a1a"].id,
        orgs["team_a1b"].id,
        orgs["div_b"].id,
        orgs["dept_b1"].id,
    }

    assert await visible_org_ids(db, users["vp_a"]) == {
        orgs["div_a"].id,
        orgs["dept_a1"].id,
        orgs["team_a1a"].id,
        orgs["team_a1b"].id,
    }
    assert await visible_org_ids(db, users["dev_a1a"]) == {orgs["team_a1a"].id}
    assert await visible_org_ids(db, users["multi"]) == {
        orgs["team_a1a"].id,
        orgs["div_b"].id,
        orgs["dept_b1"].id,
    }
    assert await visible_org_ids(db, users["overlap"]) == ceo_visible

    with _capture_sql(async_engine) as empty_stmts:
        assert await visible_org_ids(db, users["none"]) == set()
    assert len(empty_stmts) == 1
    assert "WITH RECURSIVE" in empty_stmts[0].upper()

    # 3. _people_who_see across leaf, middle, and root missions in a single recursive CTE query
    kb_leaf = KnowledgeBase(id=uuid.uuid4(), org_id=orgs["team_a1a"].id, app_name="leaf-app", source_urls=[])
    kb_mid = KnowledgeBase(id=uuid.uuid4(), org_id=orgs["div_a"].id, app_name="mid-app", source_urls=[])
    kb_root = KnowledgeBase(id=uuid.uuid4(), org_id=orgs["enterprise"].id, app_name="root-app", source_urls=[])
    db.add_all([kb_leaf, kb_mid, kb_root])
    await db.flush()

    m_leaf = Mission(
        id=uuid.uuid4(),
        number=501,
        org_id=orgs["team_a1a"].id,
        primary_kb_id=kb_leaf.id,
        title="Leaf Mission",
        prompt="Update leaf app logic",
        type="feature",
        stage="business",
        created_as_role=Role.business,
    )
    m_mid = Mission(
        id=uuid.uuid4(),
        number=502,
        org_id=orgs["div_a"].id,
        primary_kb_id=kb_mid.id,
        title="Mid Mission",
        prompt="Update division app logic",
        type="feature",
        stage="business",
        created_as_role=Role.business,
    )
    m_root = Mission(
        id=uuid.uuid4(),
        number=503,
        org_id=orgs["enterprise"].id,
        primary_kb_id=kb_root.id,
        title="Root Mission",
        prompt="Update enterprise app logic",
        type="feature",
        stage="business",
        created_as_role=Role.business,
    )
    db.add_all([m_leaf, m_mid, m_root])
    await db.commit()

    with _capture_sql(async_engine) as people_stmts:
        leaf_people = await _people_who_see(db, m_leaf)
    assert len(people_stmts) == 1
    assert "WITH RECURSIVE" in people_stmts[0].upper()
    assert "WHERE" in people_stmts[0].upper()
    # Sorted case-insensitively by name, deduplicated even when a user belongs to multiple ancestor orgs ("overlap")
    assert [u.email for u in leaf_people] == [
        "vp-a@nox.test",     # Alice VP (div_a)
        "dir-a1@nox.test",   # Bob Director (dept_a1)
        "dev-a1a@nox.test",  # Charlie Dev (team_a1a)
        "multi@nox.test",    # Multi Member (team_a1a)
        "overlap@nox.test",  # Overlap Member (enterprise + team_a1a, deduplicated)
        "ceo@nox.test",      # Zoe CEO (enterprise)
    ]

    mid_people = await _people_who_see(db, m_mid)
    assert [u.email for u in mid_people] == [
        "vp-a@nox.test",     # Alice VP (div_a)
        "overlap@nox.test",  # Overlap Member (enterprise)
        "ceo@nox.test",      # Zoe CEO (enterprise)
    ]

    root_people = await _people_who_see(db, m_root)
    assert [u.email for u in root_people] == [
        "overlap@nox.test",
        "ceo@nox.test",
    ]


async def test_multi_level_hierarchy_sqlite(sqlite_db):
    db, sqlite_engine = sqlite_db
    await _assert_multi_level_behavior(db, sqlite_engine)


async def test_multi_level_hierarchy_postgres(db_clean):
    async with AsyncSessionLocal() as db:
        await _assert_multi_level_behavior(db, engine)


async def _assert_cycle_and_depth_guardrails(db: AsyncSession) -> None:
    # 1. 3-node corrupted cycle: org_a -> org_b -> org_c -> org_a, plus leaf child org_d under org_b
    org_a = Org(id=uuid.uuid4(), name="Cycle A", slug="cycle-a")
    org_b = Org(id=uuid.uuid4(), name="Cycle B", slug="cycle-b", parent_org_id=org_a.id)
    org_c = Org(id=uuid.uuid4(), name="Cycle C", slug="cycle-c", parent_org_id=org_b.id)
    org_d = Org(id=uuid.uuid4(), name="Branch D", slug="branch-d", parent_org_id=org_b.id)
    # Self-referential cycle: self_org -> self_org
    self_org = Org(id=uuid.uuid4(), name="Self Cycle", slug="self-cycle")
    unrelated = Org(id=uuid.uuid4(), name="Unrelated", slug="unrelated")

    db.add_all([org_a, org_b, org_c, org_d, self_org, unrelated])
    await db.flush()
    org_a.parent_org_id = org_c.id
    self_org.parent_org_id = self_org.id

    user_cycle = User(id=uuid.uuid4(), firebase_uid="u-cycle", email="cycle@nox.test", name="Cycle User")
    user_self = User(id=uuid.uuid4(), firebase_uid="u-self", email="self@nox.test", name="Self User")
    db.add_all([user_cycle, user_self])
    await db.flush()
    db.add_all([
        Membership(user_id=user_cycle.id, org_id=org_a.id),
        Membership(user_id=user_self.id, org_id=self_org.id),
    ])
    kb = KnowledgeBase(id=uuid.uuid4(), org_id=org_d.id, app_name="cycle-app", source_urls=[])
    db.add(kb)
    await db.flush()
    mission = Mission(
        id=uuid.uuid4(),
        number=601,
        org_id=org_d.id,
        primary_kb_id=kb.id,
        title="Cycle Mission",
        prompt="Verify cycle safety",
        type="bug",
        stage="business",
        created_as_role=Role.business,
    )
    db.add(mission)
    await db.commit()

    # Cycle queries terminate cleanly and do not leak unrelated orgs
    assert await visible_org_ids(db, user_cycle) == {org_a.id, org_b.id, org_c.id, org_d.id}
    assert await visible_org_ids(db, user_self) == {self_org.id}
    assert await ancestor_org_ids(db, org_d.id) == {org_a.id, org_b.id, org_c.id, org_d.id}
    assert [u.email for u in await _people_who_see(db, mission)] == ["cycle@nox.test"]

    # 2. Explicit max_depth enforcement on a linear chain L0 -> L1 -> L2 -> L3 -> L4
    chain: list[Org] = []
    for idx in range(5):
        node = Org(
            id=uuid.uuid4(),
            name=f"Level {idx}",
            slug=f"level-{idx}",
            parent_org_id=chain[-1].id if chain else None,
        )
        chain.append(node)
        db.add(node)
        await db.flush()
    await db.commit()

    assert await sub_org_ids(db, [chain[0].id], max_depth=0) == {chain[0].id}
    assert await sub_org_ids(db, [chain[0].id], max_depth=2) == {chain[0].id, chain[1].id, chain[2].id}
    assert await ancestor_org_ids(db, chain[4].id, max_depth=0) == {chain[4].id}
    assert await ancestor_org_ids(db, chain[4].id, max_depth=2) == {chain[4].id, chain[3].id, chain[2].id}

    with pytest.raises(ValueError, match="non-negative"):
        descendant_org_ids_cte([chain[0].id], max_depth=-1)
    with pytest.raises(ValueError, match="non-negative"):
        ancestor_org_ids_cte(chain[0].id, max_depth=-1)


async def test_cycle_and_max_depth_sqlite(sqlite_db):
    db, _ = sqlite_db
    await _assert_cycle_and_depth_guardrails(db)


async def test_cycle_and_max_depth_postgres(db_clean):
    async with AsyncSessionLocal() as db:
        await _assert_cycle_and_depth_guardrails(db)


def _collect_plan_nodes(plan_node: dict) -> list[dict]:
    nodes = [plan_node]
    for child in plan_node.get("Plans", []):
        nodes.extend(_collect_plan_nodes(child))
    return nodes


async def test_postgres_query_plan_eliminates_orgs_seq_scan_at_scale(db_clean):
    """With thousands of unrelated orgs, neither visible_org_ids nor _people_who_see performs a Seq Scan on orgs."""
    async with AsyncSessionLocal() as db:
        # Insert 2,000 unrelated organizations across 400 small trees
        unrelated_orgs: list[Org] = []
        for tree_idx in range(400):
            root_id = uuid.uuid4()
            unrelated_orgs.append(Org(id=root_id, name=f"Other {tree_idx}", slug=f"other-{tree_idx}"))
            prev_id = root_id
            for lvl in range(1, 5):
                cid = uuid.uuid4()
                unrelated_orgs.append(
                    Org(id=cid, name=f"Other {tree_idx}-{lvl}", slug=f"other-{tree_idx}-{lvl}", parent_org_id=prev_id)
                )
                prev_id = cid
        db.add_all(unrelated_orgs)

        # Target 4-level branch
        target_ids = [uuid.uuid4() for _ in range(4)]
        for idx, oid in enumerate(target_ids):
            db.add(
                Org(
                    id=oid,
                    name=f"Target {idx}",
                    slug=f"target-{idx}",
                    parent_org_id=target_ids[idx - 1] if idx > 0 else None,
                )
            )
        user = User(id=uuid.uuid4(), firebase_uid="scale-user", email="scale@nox.test", name="Scale User")
        db.add(user)
        await db.flush()
        db.add(Membership(user_id=user.id, org_id=target_ids[0]))
        await db.commit()

        # Refresh planner statistics so Postgres cost estimates reflect the 2,004-row orgs table
        await db.execute(text("ANALYZE orgs, memberships, users"))

        # 1. Explain visible_org_ids query
        roots = select(Membership.org_id).where(Membership.user_id == user.id)
        descendants = descendant_org_ids_cte(roots)
        vis_stmt = select(descendants.c.id).distinct()
        compiled_vis = vis_stmt.compile(dialect=engine.dialect, compile_kwargs={"literal_binds": True})
        vis_explain = (await db.execute(text(f"EXPLAIN (ANALYZE, FORMAT JSON) {compiled_vis}"))).scalar_one()
        vis_plan = vis_explain[0]
        vis_nodes = _collect_plan_nodes(vis_plan["Plan"])
        orgs_seq_scans = [
            n for n in vis_nodes if n.get("Node Type") == "Seq Scan" and n.get("Relation Name") == "orgs"
        ]
        assert orgs_seq_scans == [], f"Expected zero Seq Scans on orgs, got: {orgs_seq_scans}"
        assert vis_plan["Execution Time"] < 5.0

        # 2. Explain _people_who_see query
        ancestors = ancestor_org_ids_cte(target_ids[-1])
        people_stmt = (
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.org_id.in_(select(ancestors.c.id)))
            .distinct()
        )
        compiled_people = people_stmt.compile(dialect=engine.dialect, compile_kwargs={"literal_binds": True})
        people_explain = (await db.execute(text(f"EXPLAIN (ANALYZE, FORMAT JSON) {compiled_people}"))).scalar_one()
        people_plan = people_explain[0]
        people_nodes = _collect_plan_nodes(people_plan["Plan"])
        orgs_people_seq_scans = [
            n for n in people_nodes if n.get("Node Type") == "Seq Scan" and n.get("Relation Name") == "orgs"
        ]
        assert orgs_people_seq_scans == [], f"Expected zero Seq Scans on orgs, got: {orgs_people_seq_scans}"
        assert people_plan["Execution Time"] < 5.0


def _client(email: str, role: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Dev {email}", "X-Nox-Role": role},
    )


async def test_http_permissions_and_mission_assignees_across_deep_org_tree(db_clean, fake_nox):
    async with (
        _client("root@example.com", "engineering") as root_c,
        _client("mid@example.com", "engineering") as mid_c,
        _client("leaf@example.com", "developer") as leaf_c,
        _client("sibling@example.com", "developer") as sib_c,
        _client("outsider@example.com", "developer") as out_c,
    ):
        # Ensure all users exist before inviting
        for c in (root_c, mid_c, leaf_c, sib_c, out_c):
            assert (await c.get("/api/v1/me")).status_code == 200

        root = (await root_c.post("/api/v1/orgs", json={"name": "Global", "slug": "global"})).json()
        mid = (await root_c.post("/api/v1/orgs", json={"name": "Payments", "slug": "payments", "parentOrgId": root["id"]})).json()
        leaf = (await root_c.post("/api/v1/orgs", json={"name": "Settlements", "slug": "settlements", "parentOrgId": mid["id"]})).json()
        sibling = (await root_c.post("/api/v1/orgs", json={"name": "Cards", "slug": "cards", "parentOrgId": mid["id"]})).json()
        await out_c.get("/api/v1/orgs")

        assert (await root_c.post(f"/api/v1/orgs/{mid['id']}/members", json={"email": "mid@example.com"})).status_code == 200
        assert (await root_c.post(f"/api/v1/orgs/{leaf['id']}/members", json={"email": "leaf@example.com"})).status_code == 200
        assert (await root_c.post(f"/api/v1/orgs/{sibling['id']}/members", json={"email": "sibling@example.com"})).status_code == 200

        assert {o["slug"] for o in (await root_c.get("/api/v1/orgs")).json()} == {"global", "payments", "settlements", "cards"}
        assert {o["slug"] for o in (await mid_c.get("/api/v1/orgs")).json()} == {"payments", "settlements", "cards"}
        assert {o["slug"] for o in (await leaf_c.get("/api/v1/orgs")).json()} == {"settlements"}
        assert {o["slug"] for o in (await sib_c.get("/api/v1/orgs")).json()} == {"cards"}
        assert (await out_c.get("/api/v1/orgs")).json() == []

        async with AsyncSessionLocal() as db:
            kb = KnowledgeBase(org_id=uuid.UUID(leaf["id"]), app_name="settlement-ledger", source_urls=[])
            db.add(kb)
            await db.commit()
            kb_id = str(kb.id)

        mission = (
            await leaf_c.post(
                "/api/v1/missions",
                json={"prompt": "Reconcile delayed settlement batches", "appIds": [kb_id]},
            )
        ).json()
        key = mission["key"]

        # Root, mid, and leaf members can view the leaf mission; sibling and outsider receive 404
        assert (await root_c.get(f"/api/v1/missions/{key}")).status_code == 200
        assert (await mid_c.get(f"/api/v1/missions/{key}")).status_code == 200
        assert (await leaf_c.get(f"/api/v1/missions/{key}")).status_code == 200
        assert (await sib_c.get(f"/api/v1/missions/{key}")).status_code == 404
        assert (await out_c.get(f"/api/v1/missions/{key}")).status_code == 404

        # Assignable people on leaf mission includes leaf, mid, and root members, but excludes sibling and outsider
        people = (await leaf_c.get(f"/api/v1/missions/{key}/people")).json()
        assert {p["email"] for p in people} == {"root@example.com", "mid@example.com", "leaf@example.com"}

        mid_user_id = next(p["id"] for p in people if p["email"] == "mid@example.com")
        assigned = await leaf_c.put(f"/api/v1/missions/{key}/assignee", json={"userId": mid_user_id})
        assert assigned.status_code == 200
        assert assigned.json()["assignee"]["email"] == "mid@example.com"

        sib_me = (await sib_c.get("/api/v1/me")).json()
        assert (await leaf_c.put(f"/api/v1/missions/{key}/assignee", json={"userId": sib_me["id"]})).status_code == 400
