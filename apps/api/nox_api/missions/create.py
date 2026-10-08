"""Starting a mission: shared by `POST /missions` and Start mission on a sighting (CP18).

The caller has already checked access: the applications are visible, the prompt passed NoX Shield, the captures
are the caller's own drafts. This writes the mission, its applications and its four spec files, records
`mission.created`, and queues NoX's first drafts.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor
from ..db.models import KnowledgeBase, Mission, MissionApp, Role, SpecFile, SpecStatus
from ..jobs import spawn
from .drafting import draft_mission_files
from .events import record
from .templates import ROLE_ORDER, stage_for, upstream_of


async def start_mission(db: AsyncSession, actor: Actor, *, prompt: str, kbs: list[KnowledgeBase], type_: str = "feature",
                        jira_key: str | None = None, captures: list | None = None, sighting_id: uuid.UUID | None = None) -> Mission:
    """`kbs[0]` is the primary application. Returns the mission once it is committed and drafting has been queued."""
    primary, creator, prompt = kbs[0], actor.role, prompt.strip()
    for attempt in range(3):
        number = ((await db.execute(select(func.max(Mission.number)))).scalar() or 0) + 1
        mission = Mission(
            number=number, org_id=primary.org_id, primary_kb_id=primary.id, title=prompt[:120], prompt=prompt, type=type_,
            stage=stage_for(creator), created_by=actor.user.id, created_as_role=creator,
            awaiting_proceed=creator != Role.business, sighting_id=sighting_id,
        )
        db.add(mission)
        try:
            await db.flush()
            break
        except IntegrityError:
            await db.rollback()
            if attempt == 2:
                raise
    for kb in kbs:
        db.add(MissionApp(mission_id=mission.id, kb_id=kb.id))
    for role in ROLE_ORDER:
        drafting = role == creator or role in upstream_of(creator)
        db.add(SpecFile(mission_id=mission.id, role=role, status=SpecStatus.drafting if drafting else SpecStatus.empty,
                        author_id=actor.user.id if role == creator else None))
    captures = captures or []
    for c in captures:  # a draft capture moves into the mission's org, where everyone on the mission can see it
        c.mission_id, c.org_id = mission.id, mission.org_id
    await db.commit()
    created = {"key": mission.key, "prompt": mission.prompt}
    if sighting_id:
        created["sightingId"] = str(sighting_id)
    await record(db, mission, "mission.created", created, actor.user, creator.value)
    for c in captures:
        await record(db, mission, "media.attached", {"mediaId": str(c.id), "kind": c.kind.value}, actor.user, creator.value)
        if c.status.value == "ready":
            spawn(f"evidence {mission.key}", _sync_evidence_bg, str(mission.id), str(c.id))
    if jira_key:  # imported from Jira: link first so NoX's drafts can read the ticket
        from sqlalchemy.orm import selectinload

        from .jira_sync import link_issue

        mission = (await db.execute(select(Mission).options(selectinload(Mission.files), selectinload(Mission.links))
                                    .where(Mission.id == mission.id).execution_options(populate_existing=True))).scalars().one()
        try:
            await link_issue(db, mission, jira_key.upper(), actor)
        except Exception as e:
            await record(db, mission, "jira.sync_failed", {"key": jira_key.upper(), "error": str(e)[:200]})
    spawn(f"draft {mission.key}", draft_mission_files, str(mission.id))
    return mission


async def _sync_evidence_bg(mission_id: str, media_id: str) -> None:
    from ..db.database import AsyncSessionLocal
    from ..db.models import MediaAsset
    from .media import sync_evidence

    async with AsyncSessionLocal() as db:
        mission, m = await db.get(Mission, uuid.UUID(mission_id)), await db.get(MediaAsset, uuid.UUID(media_id))
        if mission and m:
            await sync_evidence(db, mission, m)
