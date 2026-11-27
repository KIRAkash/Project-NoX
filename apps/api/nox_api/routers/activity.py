"""Activity feed across visible organizations: combines mission timeline events and knowledge-base events, newest first."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor, Cap, require, visible_org_ids
from ..db.database import get_db
from ..db.models import KBEvent, KnowledgeBase, Mission, MissionEvent, Org

router = APIRouter(prefix="/api/v1/activity", tags=["Activity"])

_INTERNAL_KB_EVENTS = ("node_started", "node_finished")


@router.get("")
async def list_activity(
    kind: Literal["all", "mission", "kb"] = Query(default="all", description="Filter by event source: all, mission, or kb"),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require(Cap.SEE_ATLAS)),
) -> list[dict[str, Any]]:
    visible = await visible_org_ids(db, actor.user)
    if not visible:
        return []

    org_names = dict((await db.execute(select(Org.id, Org.name).where(Org.id.in_(visible)))).all())
    items: list[tuple[Any, str, dict[str, Any]]] = []

    if kind in ("all", "mission"):
        m_rows = (
            await db.execute(
                select(MissionEvent, Mission)
                .join(Mission, MissionEvent.mission_id == Mission.id)
                .where(
                    Mission.org_id.in_(visible),
                    MissionEvent.type != "mission.update",
                )
                .order_by(MissionEvent.created_at.desc(), MissionEvent.id.desc())
                .limit(limit)
            )
        ).all()
        for ev, mission in m_rows:
            items.append(
                (
                    ev.created_at,
                    str(ev.id),
                    {
                        "id": str(ev.id),
                        "kind": "mission",
                        "type": ev.type,
                        "actor": ev.actor_name or "NoX",
                        "role": ev.acting_role,
                        "targetKey": mission.key,
                        "targetTitle": mission.title,
                        "href": f"/app/missions/{mission.key}",
                        "orgId": str(mission.org_id),
                        "orgName": org_names.get(mission.org_id),
                        "payload": ev.payload or {},
                        "createdAt": ev.created_at.isoformat(),
                    },
                )
            )

    if kind in ("all", "kb"):
        k_rows = (
            await db.execute(
                select(KBEvent, KnowledgeBase)
                .join(KnowledgeBase, KBEvent.kb_id == KnowledgeBase.id)
                .where(
                    KnowledgeBase.org_id.in_(visible),
                    KBEvent.event_type.notin_(_INTERNAL_KB_EVENTS),
                )
                .order_by(KBEvent.created_at.desc(), KBEvent.id.desc())
                .limit(limit)
            )
        ).all()
        for ev, kb in k_rows:
            items.append(
                (
                    ev.created_at,
                    str(ev.id),
                    {
                        "id": str(ev.id),
                        "kind": "kb",
                        "type": ev.event_type,
                        "actor": "NoX",
                        "role": None,
                        "targetKey": kb.app_name,
                        "targetTitle": kb.app_name,
                        "kbId": str(kb.id),
                        "href": f"/app/atlas/apps/{kb.id}",
                        "orgId": str(kb.org_id),
                        "orgName": org_names.get(kb.org_id),
                        "payload": ev.payload or {},
                        "createdAt": ev.created_at.isoformat(),
                    },
                )
            )

    items.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return [row[2] for row in items[:limit]]
