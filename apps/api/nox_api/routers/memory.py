"""Team memory: what NoX has learned for an application, teaching it directly, forgetting, and the lessons a
mission's files used (logic in `missions/memory.py`, storage in `services/team_memory.py`)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor, Cap, assert_org_visible, current_actor
from ..db.database import get_db
from ..db.models import KnowledgeBase, MissionEvent, Role, TeamMemory
from ..missions import memory
from ..services import team_memory as store
from .kb import kb_access
from .missions import load_mission

router = APIRouter(tags=["Team memory"])


@router.get("/api/v1/kb/{kb_id}/memories")
async def list_memories(kb_id: str, seat: Role | None = None, db: AsyncSession = Depends(get_db),
                        actor: Actor = Depends(kb_access(Cap.SEE_ATLAS))):
    """Active lessons for one application, newest first (optionally only those a seat's files use)."""
    kb = await _kb(db, kb_id)
    q = select(TeamMemory).where(TeamMemory.kb_id == kb.id, TeamMemory.status == "active").order_by(TeamMemory.updated_at.desc())
    rows = (await db.execute(q)).scalars().all()
    if seat:
        rows = [r for r in rows if r.seat in (None, seat)]
    return {"memories": [memory.memory_json(r, kb.app_name) for r in rows], "backend": store.mode(),
            "canCurate": actor.can(Cap.CURATE_MEMORY)}


class Teach(BaseModel):
    fact: str = Field(min_length=8, max_length=500)
    seat: Role | None = None


@router.post("/api/v1/kb/{kb_id}/memories", status_code=201)
async def teach(kb_id: str, body: Teach, db: AsyncSession = Depends(get_db), actor: Actor = Depends(kb_access(Cap.CURATE_MEMORY))):
    """A person teaches NoX a lesson directly. It goes through the same store, so it merges with what's there."""
    from ..services import shield

    kb = await _kb(db, kb_id)
    if store.mode() == "off":
        raise HTTPException(409, "Team memory is off on this deployment")
    verdict = await shield.screen_prompt(body.fact, where="teach", org_id=kb.org_id, kb_id=kb.id)
    if verdict.blocked:
        raise HTTPException(400, verdict.reason)
    changes = await memory.teach(db, kb=kb, fact=body.fact, seat=body.seat, user=actor.user, role=actor.role)
    return {"memories": [memory.memory_json(c.memory, kb.app_name) | {"action": c.action} for c in changes]}


@router.delete("/api/v1/memories/{memory_id}", status_code=204)
async def forget(memory_id: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Forget a lesson: seats that curate lessons, or the person whose feedback or teaching it came from."""
    mid = memory.parse_id(memory_id)
    row = await db.get(TeamMemory, mid) if mid else None
    if not row:
        raise HTTPException(404, "Not found")
    await assert_org_visible(db, actor.user, row.org_id)
    if not actor.can(Cap.CURATE_MEMORY) and row.created_by != actor.user.id:
        raise HTTPException(403, "Only the product owner, engineering lead or developer seats, or the person who taught it, can forget a lesson")
    if row.status != "active":
        return None
    await store.forget(db, row, actor.user.id)
    await db.commit()
    return None


@router.get("/api/v1/missions/{key}/lessons")
async def mission_lessons(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Per spec file, the lessons its latest NoX draft or turn used, with where each was learned."""
    mission = await load_mission(db, actor, key)
    events = (await db.execute(select(MissionEvent).where(MissionEvent.mission_id == mission.id, MissionEvent.type == "memory.applied")
                               .order_by(MissionEvent.created_at.desc()))).scalars().all()
    latest: dict[str, dict] = {}
    for e in events:
        latest.setdefault(e.payload.get("role"), e.payload)
    ids = {i for p in latest.values() for i in p.get("ids") or []}
    rows = {str(r.id): r for r in (await db.execute(select(TeamMemory).where(TeamMemory.id.in_([memory.parse_id(i) for i in ids if memory.parse_id(i)])))).scalars().all()} if ids else {}
    names = await memory.app_names(db, mission)
    out = {}
    for role, p in latest.items():
        out[role] = {"cited": bool(p.get("cited")),
                     "lessons": [memory.memory_json(rows[i], names.get(rows[i].kb_id)) for i in p.get("ids") or [] if i in rows and rows[i].status == "active"]}
    return out


async def _kb(db: AsyncSession, kb_id: str) -> KnowledgeBase:
    kid = memory.parse_id(kb_id)
    kb = await db.get(KnowledgeBase, kid) if kid else None
    if not kb:
        raise HTTPException(404, "Not found")
    return kb
