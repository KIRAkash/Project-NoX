"""Mission timeline events: stored for the activity feed, pushed live to open mission pages, and streamed to
the flight recorder (`services/analytics.py`).

Every payload carries `stage`, the stage the mission is in after the event, so stage durations and
send-backs can be read straight off the event log (the Impact page and the BigQuery views do exactly that).
"""

from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import Mission, MissionEvent, User
from ..services.sse import get_sse_manager


def channel(mission: Mission | str) -> str:
    return f"mission:{mission if isinstance(mission, str) else mission.id}"


async def record(db: AsyncSession, mission: Mission, type_: str, payload: dict | None = None,
                 actor: User | None = None, role: str | None = None, commit: bool = True) -> MissionEvent:
    payload = {**(payload or {})}
    if mission.stage is not None:
        payload.setdefault("stage", getattr(mission.stage, "value", mission.stage))
    ev = MissionEvent(mission_id=mission.id, type=type_, payload=payload, actor_id=actor.id if actor else None,
                      actor_name=(actor.name or actor.email) if actor else "NoX", acting_role=role)
    db.add(ev)
    if commit:
        await db.commit()
    from ..services.tickets import sync_pipeline_quietly

    await sync_pipeline_quietly(mission, type_, ev.actor_name)  # keep the Firestore ticket's pipeline in step
    from ..services import analytics

    analytics.emit("mission_events", analytics.mission_event_row(mission, ev))
    await get_sse_manager().broadcast(channel(mission), {"type": type_, "payload": {**(payload or {}), "actor": ev.actor_name, "actingRole": role}})
    return ev


async def broadcast_transient(mission_id, type_: str, payload: dict) -> None:
    """Push a live-only event (streamed text, NoX's in-progress edits and lookups): shown, never stored."""
    await get_sse_manager().broadcast(channel(str(mission_id)), {"type": type_, "payload": {**payload, "actor": "NoX"}})
