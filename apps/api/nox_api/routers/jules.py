"""Hand off to Jules: readiness, start, approve Jules's plan, reply to Jules (logic in `missions/jules.py`)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor, current_actor
from ..db.database import get_db
from ..missions import jules
from .missions import load_mission

router = APIRouter(prefix="/api/v1/missions", tags=["Jules"])


@router.get("/{key}/jules")
async def jules_status(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Whether the developer can hand this mission to Jules (and why not), plus its Jules sessions. Any seat that sees
    the mission may read it; only the developer acts."""
    mission = await load_mission(db, actor, key)
    jules.refresh_if_stale(mission)
    return {"readiness": await jules.readiness(db, mission), "sessions": [jules.session_json(link) for link in jules.sessions(mission)],
            "canAct": actor.role.value == "developer"}


class HandOff(BaseModel):
    repo: str | None = None
    require_plan_approval: bool = Field(default=True, alias="requirePlanApproval")


@router.post("/{key}/jules", status_code=201)
async def hand_off(key: str, body: HandOff, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    return await jules.start(db, actor, mission, body.repo, body.require_plan_approval)


@router.post("/{key}/jules/{session_id}/approve-plan")
async def approve_plan(key: str, session_id: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    return await jules.approve_plan(db, actor, mission, session_id)


class Reply(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/{key}/jules/{session_id}/message")
async def message(key: str, session_id: str, body: Reply, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    return await jules.reply(db, actor, mission, session_id, body.text.strip())
