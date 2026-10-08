"""Team memory: grounded lessons from people's feedback, merged per app and seat, applied to drafts, forgettable."""

import uuid
from types import SimpleNamespace

import pytest

from nox_api.core.config import settings
from nox_api.db.models import Role
from nox_api.missions import memory
from nox_api.services import team_memory as store
from tests.ai_fakes import FakeLlm, lessons, use_fake
from tests.test_missions import _client, _setup_app
from tests.test_verification import _to_build

FEEDBACK = "The lockout message must not reveal whether the username exists. Same text for every failed login."
RULE = "Login error messages never reveal whether an account exists."


@pytest.fixture(autouse=True)
def no_embeddings(monkeypatch):
    from nox_api.services import search

    monkeypatch.setattr(search, "embeddings_on", lambda: False)  # word overlap only: no network in tests
    monkeypatch.setattr(settings, "NOX_MEMORY", "postgres")


def test_a_lesson_must_quote_the_persons_words():
    assert memory.grounded("must not reveal whether the username exists", FEEDBACK)
    assert memory.grounded("“Must not reveal  whether the username exists.”", FEEDBACK)  # quotes, case, spaces
    assert not memory.grounded("must never leak account existence", FEEDBACK)  # paraphrase
    assert not memory.grounded("username", FEEDBACK)  # one word proves nothing


def test_business_lessons_stay_in_business_words():
    assert memory._seats_for(["business", "product"], "Customers see the same message whether or not they have an account.") == [Role.business, Role.product]
    assert memory._seats_for(["business"], "Return HTTP 401 from the JWT endpoint.") == [Role.product, Role.engineering, Role.developer]
    assert memory._seats_for([], "Customers see the same message.") == [None]


async def _mission_on(kb: str) -> tuple[str, uuid.UUID]:
    from sqlalchemy import select

    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import Mission

    key = await _to_build(kb)
    async with AsyncSessionLocal() as db:
        m = (await db.execute(select(Mission).where(Mission.number == int(key.split("-")[1])))).scalars().one()
        return key, m.id


async def _rows(kb: str | None = None):
    from sqlalchemy import select

    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import TeamMemory

    async with AsyncSessionLocal() as db:
        q = select(TeamMemory)
        if kb:
            q = q.where(TeamMemory.kb_id == uuid.UUID(kb))
        return list((await db.execute(q)).scalars().all())


async def test_learning_keeps_grounded_lessons_and_merges_repeats(db_clean, fake_nox, monkeypatch):
    kb = await _setup_app()
    _, mission_id = await _mission_on(kb)
    fake = use_fake(monkeypatch, FakeLlm(script=[
        lessons((RULE, "must not reveal whether the username exists"), ("Use the blue button.", "use the blue button")),
        lessons(("Login error messages must never reveal whether an account exists.", "Same text for every failed login")),
    ]))
    learned = await memory.learn(mission_id, None, FEEDBACK, "product", "developer", None)
    assert [x["fact"] for x in learned] == [RULE]  # the second quote isn't in the feedback: dropped
    again = await memory.learn(mission_id, None, FEEDBACK, "engineering", "developer", None)
    assert again[0]["action"] == "merged"
    (row,) = await _rows(kb)
    assert row.seat is None and len(row.sources) == 2 and row.sources[0]["missionKey"] == "NOX-1"
    assert "sent it back to the Developer" in str(fake.requests[0].contents)


async def test_lessons_reach_drafts_of_the_same_app_only(db_clean, fake_nox, monkeypatch):
    from sqlalchemy import select

    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase, Mission, Org

    kb = await _setup_app()
    _, mission_id = await _mission_on(kb)
    use_fake(monkeypatch, FakeLlm(script=[lessons((RULE, "must not reveal whether the username exists", ["product", "developer"]))]))
    await memory.learn(mission_id, None, FEEDBACK, "product", "developer", None)

    seen: dict[str, str] = {}

    async def drafting_with_lessons(mission, role, upstream, context, current=None, instruction=None, **kw):
        seen[role.value] = kw.get("lessons") or ""
        cite = "".join(f" [[memory:{i}]]" for i in __import__("re").findall(r"id ([0-9a-f-]{36})", kw.get("lessons") or ""))
        return f"# {role.value} file\n\nErrors stay vague.{cite}\n\n## Verification checklist\n- [ ] it works\n"

    from nox_api.missions import drafting

    monkeypatch.setattr(drafting, "generate_file", drafting_with_lessons)
    key2, _ = await _mission_on(kb)
    assert RULE in seen["product"] and RULE in seen["developer"]
    assert RULE not in seen.get("engineering", "") and "cite it inline" in seen["developer"]
    async with _client("developer") as dev:
        applied = (await dev.get(f"/api/v1/missions/{key2}/lessons")).json()
        assert applied["developer"]["lessons"][0]["fact"] == RULE and applied["developer"]["cited"] is True
        assert "Team lessons" in (await dev.get(f"/api/v1/cli/missions/{key2}/context")).json()["markdown"]

    async with AsyncSessionLocal() as db:  # another application in the same org learns nothing from it
        org_id = (await db.execute(select(Org.id))).scalars().first()
        other = KnowledgeBase(org_id=org_id, app_name="payments-service", source_urls=[])
        db.add(other)
        await db.commit()
        other_id = str(other.id)
    seen.clear()
    await _mission_on(other_id)
    assert all(RULE not in v for v in seen.values())
    async with AsyncSessionLocal() as db:
        m = (await db.execute(select(Mission).order_by(Mission.number.desc()))).scalars().first()
        assert await memory.lessons_for(db, m, Role.developer) == []


async def test_send_back_spawns_learning_only_when_remembered(db_clean, fake_nox, monkeypatch):
    kb = await _setup_app()
    key, _ = await _mission_on(kb)
    spawned = []
    monkeypatch.setattr("nox_api.routers.missions.spawn", lambda name, fn, *a: spawned.append((name, a)))
    async with _client("developer") as dev:
        await dev.post(f"/api/v1/missions/{key}/send-back", json={"toRole": "engineering", "reason": "No retry budget given", "remember": False})
    assert not [s for s in spawned if s[0].startswith("learn")]
    async with _client("engineering") as eng:
        await eng.post(f"/api/v1/missions/{key}/send-back", json={"toRole": "product", "reason": FEEDBACK})
    learn = [a for n, a in spawned if n.startswith("learn")]
    assert learn and learn[0][2] == FEEDBACK and learn[0][3:5] == ("engineering", "product")


async def test_teach_and_forget(db_clean, fake_nox):
    kb = await _setup_app()
    async with _client("business") as biz:
        assert (await biz.post(f"/api/v1/kb/{kb}/memories", json={"fact": RULE})).status_code == 403
        assert (await biz.get(f"/api/v1/kb/{kb}/memories")).json()["canCurate"] is False
    async with _client("product") as po:
        res = await po.post(f"/api/v1/kb/{kb}/memories", json={"fact": RULE, "seat": "product"})
        assert res.status_code == 201
        mid = res.json()["memories"][0]["id"]
        listed = (await po.get(f"/api/v1/kb/{kb}/memories")).json()
        assert [m["fact"] for m in listed["memories"]] == [RULE] and listed["memories"][0]["origin"] == "taught on the application page"
    async with _client("business", email="biz@example.com") as biz:
        assert (await biz.delete(f"/api/v1/memories/{mid}")).status_code in (403, 404)
    async with _client("developer") as dev:
        assert (await dev.delete(f"/api/v1/memories/{mid}")).status_code == 204
        assert (await dev.get(f"/api/v1/kb/{kb}/memories")).json()["memories"] == []
    (row,) = await _rows(kb)
    assert row.status == "forgotten" and row.forgotten_at is not None


async def test_memory_off_learns_nothing(db_clean, fake_nox, monkeypatch):
    kb = await _setup_app()
    _, mission_id = await _mission_on(kb)
    monkeypatch.setattr(settings, "NOX_MEMORY", "off")
    assert await memory.learn(mission_id, None, FEEDBACK, "product", "developer", None) == []
    assert await _rows() == []


# ── The Memory Bank adapter, against a fake client ──


class _Pager:
    def __init__(self, hits):
        self.hits = hits

    def __aiter__(self):
        async def gen():
            for h in self.hits:
                yield h
        return gen()


class FakeMemories:
    def __init__(self):
        self.facts: dict[str, str] = {}
        self.next: list = []
        self.calls: list = []

    async def generate(self, **kw):
        self.calls.append(("generate", kw))
        action, name, fact = self.next.pop(0)
        if fact is not None:
            self.facts[name] = fact
        mem = SimpleNamespace(name=name, fact=None)
        return SimpleNamespace(error=None, response=SimpleNamespace(generated_memories=[SimpleNamespace(memory=mem, action=action)]))

    async def get(self, name):
        return SimpleNamespace(name=name, fact=self.facts[name])

    async def retrieve(self, **kw):
        self.calls.append(("retrieve", kw))
        hits = [SimpleNamespace(distance=0.1 * i, memory=SimpleNamespace(name=n)) for i, n in enumerate(self.facts)]
        return _Pager(hits if kw["scope"]["seat"] == "all" else [])

    async def delete(self, name):
        self.calls.append(("delete", name))


async def test_memory_bank_adapter(db_clean, fake_nox, monkeypatch):
    from nox_api.db.database import AsyncSessionLocal
    from nox_api.db.models import KnowledgeBase

    kb_id = await _setup_app()
    fake = FakeMemories()
    store.set_bank_client(SimpleNamespace(aio=SimpleNamespace(memory_banks=SimpleNamespace(memories=fake))))
    monkeypatch.setattr(settings, "NOX_MEMORY", "memory_bank")
    monkeypatch.setattr(settings, "NOX_MEMORY_BANK", "projects/p/locations/global/memoryBanks/nox")
    try:
        src = store.Source("NOX-1", None, "must not reveal", "Pat", "product")
        async with AsyncSessionLocal() as db:
            kb = await db.get(KnowledgeBase, uuid.UUID(kb_id))
            fake.next = [("CREATED", "mem/1", RULE)]
            (c,) = await store.add(db, org_id=kb.org_id, kb_id=kb.id, app=kb.app_name, seat=None, fact=RULE, kind="team_rule", source=src, user_id=None)
            await db.commit()
            assert c.action == "created" and c.memory.bank_name == "mem/1" and c.memory.fact == RULE
            _, kw = fake.calls[0]
            assert kw["scope"] == {"app": "refunds-service", "seat": "all"}
            assert kw["direct_memories_source"]["direct_memories"][0]["fact"] == RULE
            assert kw["config"]["metadata"]["nox_mission"] == {"string_value": "NOX-1"}

            fake.next = [("UPDATED", "mem/1", RULE + " Not even in timing.")]
            (c2,) = await store.add(db, org_id=kb.org_id, kb_id=kb.id, app=kb.app_name, seat=None, fact="Same time too.", kind="team_rule", source=src, user_id=None)
            await db.commit()
            assert c2.action == "merged" and c2.memory.id == c.memory.id and c2.memory.fact.endswith("timing.") and len(c2.memory.sources) == 2

            found = await store.search(db, apps={kb.id: kb.app_name}, seat=Role.developer, query="login errors")
            assert [m.id for m in found] == [c.memory.id]

            fake.next = [("DELETED", "mem/1", None)]
            changes = await store.add(db, org_id=kb.org_id, kb_id=kb.id, app=kb.app_name, seat=None, fact="Errors may say the account is locked.", kind="team_rule", source=src, user_id=None)
            await db.commit()
            assert [x.action for x in changes][0] == "superseded" and changes[0].memory.status == "superseded"

            await store.forget(db, c.memory, None)
            assert ("delete", "mem/1") in fake.calls
    finally:
        store.set_bank_client(None)
