"""Specs: Cross-mission spec library index API.

Indexes all SpecFile records across visible organization missions,
supporting filtering by role, status, app_id, and search query.
"""

import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor, Cap, require, visible_org_ids
from ..db.database import get_db
from ..db.models import (
    KnowledgeBase,
    Mission,
    MissionApp,
    Role,
    SpecFile,
    SpecStatus,
    User,
)
from .missions import FILE_NAME, TITLE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/specs", tags=["Specs"])


@router.get("")
async def list_specs(
    role: str | None = Query(default=None, description="Role filter: business, product, engineering, developer"),
    status: str | None = Query(default=None, description="Status filter: approved, draft, ai_drafted, stale, empty, drafting"),
    q: str | None = Query(default=None, description="Search query string"),
    app_id: str | None = Query(default=None, alias="app_id", description="App ID filter (UUID string)"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require(Cap.SEE_ATLAS)),
) -> list[dict[str, Any]]:
    visible = await visible_org_ids(db, actor.user)
    if not visible:
        return []

    stmt = (
        select(SpecFile, Mission)
        .join(Mission, SpecFile.mission_id == Mission.id)
        .where(
            and_(
                Mission.org_id.in_(visible),
                Mission.cancelled_at.is_(None),
            )
        )
    )

    if status:
        try:
            target_status = SpecStatus(status.lower())
            stmt = stmt.where(SpecFile.status == target_status)
        except ValueError:
            return []
    else:
        stmt = stmt.where(SpecFile.status != SpecStatus.empty)

    if role:
        try:
            target_role = Role(role.lower())
            stmt = stmt.where(SpecFile.role == target_role)
        except ValueError:
            return []

    if app_id:
        try:
            target_app_uuid = uuid.UUID(app_id)
            subq = select(MissionApp.mission_id).where(MissionApp.kb_id == target_app_uuid)
            stmt = stmt.where(
                or_(
                    Mission.id.in_(subq),
                    Mission.primary_kb_id == target_app_uuid,
                )
            )
        except ValueError:
            return []

    if q and q.strip():
        search_str = q.strip()
        term = f"%{search_str}%"
        conditions = [
            SpecFile.markdown.ilike(term),
            Mission.title.ilike(term),
            Mission.prompt.ilike(term),
        ]
        m_num = re.search(r"(\d+)", search_str)
        if m_num:
            conditions.append(Mission.number == int(m_num.group(1)))

        stmt = stmt.where(or_(*conditions))

    stmt = stmt.order_by(SpecFile.updated_at.desc(), SpecFile.id.desc()).offset(offset).limit(limit)

    results = (await db.execute(stmt)).all()
    if not results:
        return []

    spec_files = [r[0] for r in results]
    missions_map = {m.id: m for r in results for m in [r[1]]}

    user_ids = {s.author_id for s in spec_files if s.author_id} | {s.approved_by for s in spec_files if s.approved_by}
    users_map: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        users_map = {u.id: u.name or u.email or str(u.id) for u in users}

    mission_ids = list(missions_map.keys())
    app_rows = (
        await db.execute(
            select(MissionApp.mission_id, KnowledgeBase.id, KnowledgeBase.app_name)
            .join(KnowledgeBase, MissionApp.kb_id == KnowledgeBase.id)
            .where(MissionApp.mission_id.in_(mission_ids))
        )
    ).all()

    apps_map: dict[uuid.UUID, list[dict[str, str]]] = {}
    for m_id, kb_id, app_name in app_rows:
        apps_map.setdefault(m_id, []).append({"id": str(kb_id), "name": app_name})

    primary_kb_ids = {m.primary_kb_id for m in missions_map.values() if m.primary_kb_id and m.id not in apps_map}
    if primary_kb_ids:
        kbs = (await db.execute(select(KnowledgeBase.id, KnowledgeBase.app_name).where(KnowledgeBase.id.in_(primary_kb_ids)))).all()
        kb_dict = {k[0]: k[1] for k in kbs}
        for m in missions_map.values():
            if m.id not in apps_map and m.primary_kb_id and m.primary_kb_id in kb_dict:
                apps_map[m.id] = [{"id": str(m.primary_kb_id), "name": kb_dict[m.primary_kb_id]}]

    out = []
    for spec in spec_files:
        mission = missions_map[spec.mission_id]
        role_val = spec.role.value if hasattr(spec.role, "value") else str(spec.role)
        status_val = spec.status.value if hasattr(spec.status, "value") else str(spec.status)
        stage_val = mission.stage.value if hasattr(mission.stage, "value") else str(mission.stage)
        try:
            role_enum = Role(role_val)
        except ValueError:
            role_enum = Role.product

        out.append(
            {
                "id": str(spec.id),
                "missionId": str(mission.id),
                "missionKey": mission.key,
                "missionTitle": mission.title,
                "missionType": mission.type,
                "missionStage": stage_val,
                "orgId": str(mission.org_id),
                "role": role_val,
                "title": TITLE.get(role_enum, role_val.capitalize()),
                "fileName": FILE_NAME.get(role_enum, f"{role_val}.md"),
                "status": status_val,
                "version": spec.version,
                "markdown": spec.markdown,
                "gitPath": spec.git_path,
                "gitCommitSha": spec.git_commit_sha,
                "updatedAt": spec.updated_at.isoformat() if spec.updated_at else None,
                "approvedAt": spec.approved_at.isoformat() if spec.approved_at else None,
                "authorId": str(spec.author_id) if spec.author_id else None,
                "authorName": users_map.get(spec.author_id) if spec.author_id else None,
                "approvedById": str(spec.approved_by) if spec.approved_by else None,
                "approvedByName": users_map.get(spec.approved_by) if spec.approved_by else None,
                "apps": apps_map.get(mission.id, []),
                "verification": spec.verification or {},
            }
        )

    return out
