"""What happens around a mission when its creator cancels, restores or deletes it.

The router changes the mission row and records the event; this module keeps the things outside it in step,
best-effort, the same way saves treat Git and Jira:

    cancel   Jira comment (+ "Won't Do" if the workflow has it) · ticket marked cancelled · sighting reopened ·
             Jules polling stops (missions/jules.py checks `cancelled_at`); open PRs and the Git branch are left
             for people to close
    restore  Jira back to the status of the mission's stage · ticket unmarked · sighting taken back if still open
    delete   only before anything left NoX (`routers/missions.deletable`): stored captures removed, ticket
             document removed, sighting reopened; Postgres cascades the rest
"""

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import MediaAsset, Mission

logger = logging.getLogger(__name__)


async def after_cancel(db: AsyncSession, mission: Mission, actor, reason: str | None) -> None:
    from ..services.tickets import set_cancelled
    from .jira_sync import on_cancel
    from .sightings import release

    who = actor.user.name or actor.user.email
    await on_cancel(db, mission, actor, f"Cancelled by {who}" + (f": {reason}" if reason else ""))
    await set_cancelled(mission, {"at": mission.cancelled_at.isoformat(), "by": who, "reason": reason})
    await release(db, mission)


async def after_restore(db: AsyncSession, mission: Mission, actor) -> None:
    from ..services.tickets import set_cancelled
    from .jira_sync import on_stage_change
    from .sightings import reclaim

    await on_stage_change(db, mission, actor, f"Restored by {actor.user.name or actor.user.email}")
    await set_cancelled(mission, None)
    await reclaim(db, mission)


async def before_delete(db: AsyncSession, mission: Mission) -> None:
    from ..services import media_storage
    from ..services.tickets import forget_ticket
    from .sightings import release

    await release(db, mission)
    uris = (await db.execute(select(MediaAsset.storage_uri).where(MediaAsset.mission_id == mission.id))).scalars().all()
    for uri in uris:
        try:
            await asyncio.to_thread(media_storage.delete, uri)
        except Exception as e:
            logger.warning("capture %s of %s not removed: %s", uri, mission.key, e)
    await forget_ticket(mission)
