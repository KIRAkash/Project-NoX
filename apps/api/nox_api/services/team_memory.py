"""Where team lessons are kept: Postgres always, plus Agent Platform Memory Bank when NOX_MEMORY=memory_bank.

    NOX_MEMORY=memory_bank   Memory Bank consolidates each new lesson with what it already holds for that
                             application and seat (merging duplicates, retiring what a new lesson contradicts)
                             and finds the relevant ones by similarity. Postgres keeps the record: which lessons
                             are active, and where each came from.
    NOX_MEMORY=postgres      The same behaviour without Memory Bank (local development, NoX Local, tests):
                             near-duplicates merge by embedding similarity, retrieval ranks by cosine.
    NOX_MEMORY=off           NoX learns nothing and applies nothing.

A Memory Bank scope is `{"app": <application>, "seat": <role or "all">}`. Scopes match exactly, so a draft looks
in its seat's scope and in "all". If Memory Bank fails, the Postgres path takes over for that call: a lesson is
never lost because a service was down.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.models import Role, TeamMemory

logger = logging.getLogger(__name__)

SIMILAR_EMBED = 0.88   # cosine above which two lessons say the same thing
SIMILAR_TERMS = 0.6    # word overlap that means the same, when there are no embeddings
TOPICS = {
    "team_rule": "A rule this team applies to every change in this application: how it builds, what it never does.",
    "quality_bar": "What this team checks before it accepts a change to this application.",
    "domain_fact": "A fact about the business or its customers that the team corrected NoX on.",
}


def mode() -> str:
    m = (settings.NOX_MEMORY or "postgres").strip().lower()
    if m == "memory_bank" and not settings.NOX_MEMORY_BANK:
        return "postgres"
    return m if m in ("memory_bank", "postgres", "off") else "postgres"


@dataclass
class Change:
    memory: TeamMemory
    action: str  # created | merged | superseded


@dataclass
class Source:
    mission_key: str | None
    event_id: str | None
    quote: str
    by: str
    role: str | None

    def as_dict(self) -> dict:
        return {"missionKey": self.mission_key, "eventId": self.event_id, "quote": self.quote[:500], "by": self.by,
                "role": self.role, "at": datetime.utcnow().isoformat(timespec="seconds")}


def scope(app: str, seat: Role | None) -> dict[str, str]:
    return {"app": app, "seat": seat.value if seat else "all"}


async def _embed(text: str) -> list[float] | None:
    from ..missions.sightings import embed_texts

    vectors = await embed_texts([text])
    return vectors[0] if vectors else None


def _same(a_text: str, b_text: str, a_vec, b_vec) -> bool:
    from ..missions.sightings import cosine, jaccard, terms

    if a_vec and b_vec:
        return cosine(a_vec, b_vec) >= SIMILAR_EMBED
    return jaccard(terms(a_text), terms(b_text)) >= SIMILAR_TERMS


async def _active(db: AsyncSession, kb_id, seat: Role | None) -> list[TeamMemory]:
    q = select(TeamMemory).where(TeamMemory.kb_id == kb_id, TeamMemory.status == "active")
    q = q.where(TeamMemory.seat == seat) if seat else q.where(TeamMemory.seat.is_(None))
    return list((await db.execute(q)).scalars().all())


# ── Postgres ─────────────────────────────────────────────────────────────────


async def _pg_add(db: AsyncSession, *, org_id, kb_id, seat: Role | None, fact: str, kind: str, source: Source,
                  user_id, vec: list[float] | None) -> list[Change]:
    for row in await _active(db, kb_id, seat):
        if _same(fact, row.fact, vec, row.embedding):
            row.sources = [*(row.sources or []), source.as_dict()][-20:]
            row.updated_at = datetime.utcnow()
            return [Change(row, "merged")]
    row = TeamMemory(org_id=org_id, kb_id=kb_id, seat=seat, fact=fact, kind=kind, sources=[source.as_dict()],
                     embedding=vec, created_by=user_id)
    db.add(row)
    return [Change(row, "created")]


async def _pg_search(db: AsyncSession, kb_ids: list, seat: Role, query: str, k: int) -> list[TeamMemory]:
    from ..missions.sightings import cosine, jaccard, terms

    rows = list((await db.execute(select(TeamMemory).where(
        TeamMemory.kb_id.in_(kb_ids), TeamMemory.status == "active",
        or_(TeamMemory.seat == seat, TeamMemory.seat.is_(None))))).scalars().all())
    if len(rows) <= k:
        return rows
    qv = await _embed(query) if any(r.embedding for r in rows) else None
    qt = terms(query)

    def score(r: TeamMemory) -> float:
        return cosine(qv, r.embedding) if qv and r.embedding else jaccard(qt, terms(r.fact))

    return sorted(rows, key=score, reverse=True)[:k]


# ── Memory Bank ──────────────────────────────────────────────────────────────


_client = None


def bank_client():
    """The Agent Platform client for the Memory Bank named in NOX_MEMORY_BANK (location taken from its name)."""
    global _client
    if _client is None:
        import agentplatform

        m = re.match(r"^projects/([^/]+)/locations/([^/]+)/", settings.NOX_MEMORY_BANK)
        if not m:
            raise ValueError("NOX_MEMORY_BANK must be a full resource name: projects/<p>/locations/<l>/memoryBanks/<id>")
        _client = agentplatform.Client(project=m.group(1), location=m.group(2))
    return _client


def set_bank_client(c) -> None:
    """Tests swap in a fake."""
    global _client
    _client = c


def _meta(org_id, kb_id, source: Source) -> dict:
    meta = {"nox_org": str(org_id), "nox_kb": str(kb_id), "nox_mission": source.mission_key or ""}
    return {k: {"string_value": v} for k, v in meta.items()}


async def _bank_add(db: AsyncSession, *, org_id, kb_id, app: str, seat: Role | None, fact: str, kind: str, source: Source,
                    user_id, vec) -> list[Change]:
    memories = bank_client().aio.memory_banks.memories
    op = await memories.generate(
        name=settings.NOX_MEMORY_BANK,
        direct_memories_source={"direct_memories": [{"fact": fact, "topics": [{"custom_memory_topic_label": kind}]}]},
        scope=scope(app, seat),
        config={"wait_for_completion": True, "metadata": _meta(org_id, kb_id, source)},
    )
    if getattr(op, "error", None):
        raise RuntimeError(f"Memory Bank: {op.error}")
    generated = list(getattr(getattr(op, "response", None), "generated_memories", None) or [])
    changes: list[Change] = []
    for g in generated:
        name = getattr(g.memory, "name", None)
        action = str(getattr(g.action, "value", g.action) or "").upper()
        if not name:
            continue
        row = (await db.execute(select(TeamMemory).where(TeamMemory.bank_name == name))).scalars().first()
        if action == "DELETED":
            if row and row.status == "active":
                row.status = "superseded"
                changes.append(Change(row, "superseded"))
            continue
        current = fact
        if action == "UPDATED" or not getattr(g.memory, "fact", None):
            try:
                current = (await memories.get(name=name)).fact or fact
            except Exception:
                logger.debug("memory bank: couldn't read back %s", name, exc_info=True)
        else:
            current = g.memory.fact
        if row:
            row.fact = current
            row.sources = [*(row.sources or []), source.as_dict()][-20:]
            row.status = "active"
            changes.append(Change(row, "merged"))
        else:
            row = TeamMemory(org_id=org_id, kb_id=kb_id, seat=seat, fact=current, kind=kind, sources=[source.as_dict()],
                             bank_name=name, embedding=vec, created_by=user_id)
            db.add(row)
            changes.append(Change(row, "created"))
    if not any(c.action in ("created", "merged") for c in changes):
        # Memory Bank already held this lesson word for word (nothing to change): credit the closest one.
        changes += await _pg_add(db, org_id=org_id, kb_id=kb_id, seat=seat, fact=fact, kind=kind, source=source, user_id=user_id, vec=vec)
    return changes


async def _bank_search(db: AsyncSession, apps: dict, seat: Role, query: str, k: int) -> list[TeamMemory]:
    memories = bank_client().aio.memory_banks.memories
    found: list[tuple[float, str]] = []
    for app in apps.values():
        for s in (seat, None):
            pager = await memories.retrieve(name=settings.NOX_MEMORY_BANK, scope=scope(app, s),
                                            similarity_search_params={"search_query": query[:1000], "top_k": k})
            async for hit in pager:
                if getattr(hit.memory, "name", None):
                    found.append((hit.distance if hit.distance is not None else 1.0, hit.memory.name))
    order = [name for _, name in sorted(found)]
    if not order:
        return []
    rows = {r.bank_name: r for r in (await db.execute(select(TeamMemory).where(
        TeamMemory.bank_name.in_(order), TeamMemory.status == "active"))).scalars().all()}
    out, seen = [], set()
    for name in order:
        if name in rows and name not in seen:
            seen.add(name)
            out.append(rows[name])
    return out[:k]


# ── The store NoX uses ───────────────────────────────────────────────────────


async def add(db: AsyncSession, *, org_id, kb_id, app: str, seat: Role | None, fact: str, kind: str, source: Source,
              user_id: uuid.UUID | None) -> list[Change]:
    """Keep one lesson for an application and seat. Returns what changed; the caller commits."""
    if mode() == "off":
        return []
    vec = await _embed(fact)
    if mode() == "memory_bank":
        try:
            return await _bank_add(db, org_id=org_id, kb_id=kb_id, app=app, seat=seat, fact=fact, kind=kind,
                                   source=source, user_id=user_id, vec=vec)
        except Exception as e:
            logger.warning(f"Memory Bank couldn't take a lesson ({type(e).__name__}: {e}); kept in Postgres only")
    return await _pg_add(db, org_id=org_id, kb_id=kb_id, seat=seat, fact=fact, kind=kind, source=source, user_id=user_id, vec=vec)


async def search(db: AsyncSession, *, apps: dict, seat: Role, query: str, k: int | None = None) -> list[TeamMemory]:
    """The lessons for a draft: `apps` is {kb_id: app name} of the mission; `seat` the file being written."""
    if mode() == "off" or not apps:
        return []
    k = k or settings.NOX_MEMORY_MAX_LESSONS
    if mode() == "memory_bank":
        try:
            return await _bank_search(db, apps, seat, query, k)
        except Exception as e:
            logger.warning(f"Memory Bank search failed ({type(e).__name__}: {e}); using Postgres")
    return await _pg_search(db, list(apps.keys()), seat, query, k)


async def forget(db: AsyncSession, memory: TeamMemory, user_id) -> None:
    if memory.bank_name and mode() == "memory_bank":
        try:
            await bank_client().aio.memory_banks.memories.delete(name=memory.bank_name)
        except Exception as e:
            logger.warning(f"Memory Bank couldn't delete {memory.bank_name}: {e}")
    memory.status = "forgotten"
    memory.forgotten_by = user_id
    memory.forgotten_at = datetime.utcnow()
