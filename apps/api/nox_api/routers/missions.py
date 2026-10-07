"""Missions: create from any seat, co-write one spec file per role, approve forward, send back."""

import asyncio
import re
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..core.auth import Actor, Cap, current_actor, require, visible_org_ids
from ..core.config import settings
from ..core.time_utils import now_utc, now_utc_naive
from ..db.database import get_db
from ..db.models import (
    ExternalLink,
    KnowledgeBase,
    MediaAsset,
    Membership,
    Mission,
    MissionApp,
    MissionEvent,
    MissionStage,
    Org,
    OrgInterfaceContract,
    Role,
    SpecFile,
    SpecFileVersion,
    SpecStatus,
    User,
)
from ..jobs import spawn
from ..missions.drafting import draft_mission_files
from ..missions.events import record
from ..missions.gitsync import schedule_sync
from ..missions.templates import FILE_NAME, ROLE_ORDER, TITLE, next_stage, stage_for, upstream_of
from ..missions.verification import (
    VERIFY_ORDER,
    clean_evidence,
    failing,
    next_verifier,
    norm_item,
    parse_checklist,
    update_kind,
    write_checklist,
)

router = APIRouter(prefix="/api/v1/missions", tags=["Missions"])


# ── Serialisation ────────────────────────────────────────────────────────────


def file_json(f: SpecFile, with_body: bool = True) -> dict:
    out = {
        "role": f.role.value,
        "title": TITLE[f.role],
        "fileName": FILE_NAME[f.role],
        "status": f.status.value,
        "version": f.version,
        "approvedAt": f.approved_at.isoformat() if f.approved_at else None,
        "updatedAt": f.updated_at.isoformat() if f.updated_at else None,
        "gitPath": f.git_path,
        "verification": f.verification or {},
    }
    if with_body:
        out["markdown"] = f.markdown
    return out


def mission_json(m: Mission, apps: list[KnowledgeBase] | None = None, with_bodies: bool = False) -> dict:
    files = sorted(m.files, key=lambda f: ROLE_ORDER.index(f.role))
    return {
        "id": str(m.id),
        "key": m.key,
        "title": m.title,
        "prompt": m.prompt,
        "type": m.type,
        "priority": m.priority,
        "stage": m.stage.value,
        "verifyRole": m.verify_role.value if m.verify_role else None,
        "createdAsRole": m.created_as_role.value,
        "awaitingProceed": m.awaiting_proceed,
        "proceededWithoutApproval": m.proceeded_without_approval,
        "orgId": str(m.org_id),
        "createdAt": m.created_at.isoformat(),
        "updatedAt": m.updated_at.isoformat() if m.updated_at else None,
        "completedAt": m.completed_at.isoformat() if m.completed_at else None,
        "sightingId": str(m.sighting_id) if m.sighting_id else None,
        "files": [file_json(f, with_bodies) for f in files],
        "apps": [{"id": str(k.id), "name": k.app_name, "status": k.status.value} for k in (apps or [])],
        "links": [
            {"system": link.system, "externalId": link.external_id, "url": link.url, "primary": link.primary, "state": link.state}
            for link in m.links
        ],
    }


# ── Loading + permission helpers ─────────────────────────────────────────────


def _parse_key(key: str) -> int:
    m = re.fullmatch(r"(?i)nox-(\d+)", key.strip())
    if not m:
        raise HTTPException(404, "Not found")
    return int(m.group(1))


async def load_mission(db: AsyncSession, actor: Actor, key: str) -> Mission:
    mission = (
        await db.execute(
            select(Mission).options(selectinload(Mission.files), selectinload(Mission.links)).where(Mission.number == _parse_key(key))
            .execution_options(populate_existing=True)  # re-read collections even if this session already holds the mission
        )
    ).scalars().first()
    if not mission or mission.org_id not in await visible_org_ids(db, actor.user):
        raise HTTPException(404, "Not found")
    return mission


async def mission_apps(db: AsyncSession, mission: Mission) -> list[KnowledgeBase]:
    return list(
        (await db.execute(select(KnowledgeBase).join(MissionApp, MissionApp.kb_id == KnowledgeBase.id).where(MissionApp.mission_id == mission.id)))
        .scalars()
        .all()
    )


def file_for(mission: Mission, role: Role) -> SpecFile:
    return next(f for f in mission.files if f.role == role)


def role_param(role: str) -> Role:
    try:
        return Role(role)
    except ValueError as e:
        raise HTTPException(404, "Unknown spec file") from e


def own_file(actor: Actor, role: Role) -> None:
    if actor.role != role:
        raise HTTPException(403, f"Only the {TITLE[role].split()[0].lower()} seat edits this file — it's locked for the {actor.role.value} role")


# ── App suggestions ──────────────────────────────────────────────────────────


class SuggestBody(BaseModel):
    prompt: str = Field(min_length=3)


def _terms(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z0-9]{2,}", text.lower())}


@router.post("/suggest-apps")
async def suggest_apps(body: SuggestBody, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.CREATE_MISSION))):
    """Rank the caller's applications by how much of the request's vocabulary they own."""
    from ..services.local_storage import load_checkpoint_json

    visible = await visible_org_ids(db, actor.user)
    kbs = (await db.execute(select(KnowledgeBase).where(KnowledgeBase.org_id.in_(visible)))).scalars().all() if visible else []
    q = _terms(body.prompt)
    ranked = []
    for kb in kbs:
        contracts = (await db.execute(select(OrgInterfaceContract.identifier).where(OrgInterfaceContract.kb_id == kb.id))).scalars().all()
        brief = (load_checkpoint_json(str(kb.id), "compiled_files.json") or {}).get(".nox/brief.md", "")
        vocab = _terms(kb.app_name.replace("-", " ")) | _terms(" ".join(contracts)) | _terms(brief)
        score = len(q & vocab) + 4 * len(q & _terms(kb.app_name.replace("-", " ")))
        ranked.append({"id": str(kb.id), "name": kb.app_name, "status": kb.status.value, "score": score})
    ranked.sort(key=lambda r: (-r["score"], r["name"]))
    return ranked


# ── Create / list / read ─────────────────────────────────────────────────────


class MissionCreate(BaseModel):
    prompt: str = Field(min_length=8, max_length=2000)
    app_ids: list[uuid.UUID] = Field(alias="appIds", min_length=1)
    type: str = Field(default="feature", pattern="^(feature|bug|change)$")
    jira_key: str | None = Field(default=None, alias="jiraKey", pattern=r"^[A-Za-z][A-Za-z0-9]+-\d+$")
    media_ids: list[uuid.UUID] = Field(default_factory=list, alias="mediaIds", max_length=12)  # draft captures (Show NoX)
    sighting_id: uuid.UUID | None = Field(default=None, alias="sightingId")  # started from a NoX sighting (CP18)


async def _draft_captures(db: AsyncSession, actor: Actor, ids: list[uuid.UUID]) -> list:
    """The caller's own draft captures, ready to attach. Anyone else's (or an unknown id) is a 404."""
    from ..db.models import MediaAsset, MediaStatus

    rows = (await db.execute(select(MediaAsset).where(MediaAsset.id.in_(ids)))).scalars().all() if ids else []
    if len(rows) != len(set(ids)) or any(r.uploaded_by != actor.user.id or r.mission_id is not None or r.status == MediaStatus.deleted for r in rows):
        raise HTTPException(404, "One of those captures isn't yours to attach")
    withheld = [r for r in rows if r.status == MediaStatus.withheld]
    if withheld:
        raise HTTPException(422, f"NoX Shield withheld a capture, so it can't be attached: {withheld[0].status_reason or 'it may contain unsafe content'}")
    return rows


@router.post("")
async def create_mission(body: MissionCreate, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.CREATE_MISSION))):
    visible = await visible_org_ids(db, actor.user)
    kbs = (await db.execute(select(KnowledgeBase).where(KnowledgeBase.id.in_(body.app_ids)))).scalars().all()
    if len(kbs) != len(set(body.app_ids)) or any(k.org_id not in visible for k in kbs):
        raise HTTPException(404, "One of those applications isn't in your orbit")
    primary = next(k for k in kbs if k.id == body.app_ids[0])
    from ..services import shield

    if (await shield.screen_prompt(body.prompt, where="mission_prompt", org_id=primary.org_id)).blocked:
        raise HTTPException(422, "NoX Shield flagged this request as a possible prompt injection. Rephrase it in your own words and try again.")
    captures = await _draft_captures(db, actor, body.media_ids)
    sighting_id = None
    if body.sighting_id:  # Edit first on a sighting: the form was prefilled from it
        from ..missions.sightings import claim_for_launch

        sighting_id = (await claim_for_launch(db, actor, body.sighting_id)).id
    from ..missions.create import start_mission

    ordered = [primary, *[k for k in kbs if k.id != primary.id]]
    mission = await start_mission(db, actor, prompt=body.prompt, kbs=ordered, type_=body.type, jira_key=body.jira_key,
                                  captures=captures, sighting_id=sighting_id)
    if sighting_id:
        from ..missions.sightings import mark_launched

        await mark_launched(db, actor, sighting_id, mission)
    mission = await load_mission(db, actor, mission.key)
    return mission_json(mission, kbs)


# Events a requester would call "something happened" (not drafts in progress or saves).
ACTIVITY_EVENTS = (
    "mission.created", "mission.proceeded", "mission.sent_back", "mission.completed", "mission.assigned",
    "file.approved", "verify.verified", "verify.not_met", "verify.blocked",
)


@router.get("")
async def list_missions(
    view: str = Query(default="all", pattern="^(all|waiting|flight|back|mine)$"),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(current_actor),
):
    visible = await visible_org_ids(db, actor.user)
    if not visible:
        return []
    rows = (
        await db.execute(
            select(Mission).options(selectinload(Mission.files), selectinload(Mission.links))
            .where(Mission.org_id.in_(visible)).order_by(Mission.updated_at.desc())
        )
    ).scalars().all()
    my_stage = stage_for(actor.role)

    def mine(m: Mission) -> bool:
        return m.created_by == actor.user.id or any(f.author_id == actor.user.id or f.approved_by == actor.user.id for f in m.files)

    def waiting(m: Mission) -> bool:
        if m.stage == my_stage and not (m.awaiting_proceed and m.created_as_role != actor.role):
            return True
        return file_for(m, actor.role).status in (SpecStatus.ai_drafted, SpecStatus.stale)  # confirm / revisit

    def back(m: Mission) -> bool:
        return m.stage == MissionStage.verifying and m.verify_role == actor.role

    def flight(m: Mission) -> bool:
        f = file_for(m, actor.role)
        return f.status == SpecStatus.approved and m.stage not in (MissionStage.done,) and not waiting(m) and not back(m)

    pick = {"all": lambda m: True, "waiting": waiting, "flight": flight, "back": back, "mine": mine}[view]
    kb_names = dict((await db.execute(select(KnowledgeBase.id, KnowledgeBase.app_name))).all())
    picked = [m for m in rows if pick(m)]
    # Who asked, and the latest thing anyone did: one query each for the whole list.
    creators: dict = {}
    latest: dict = {}
    if picked:
        ids = {m.created_by for m in picked if m.created_by}
        if ids:
            creators = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars()}
        events = (
            await db.execute(
                select(MissionEvent).where(MissionEvent.mission_id.in_([m.id for m in picked]), MissionEvent.type.in_(ACTIVITY_EVENTS))
                .order_by(MissionEvent.created_at.desc())
            )
        ).scalars()
        for ev in events:
            latest.setdefault(ev.mission_id, ev)
    out = []
    for m in picked:
        apps = (await db.execute(select(MissionApp.kb_id).where(MissionApp.mission_id == m.id))).scalars().all()
        j = mission_json(m)
        j["apps"] = [{"id": str(a), "name": kb_names.get(a, "?")} for a in apps]
        u = creators.get(m.created_by)
        j["requestedBy"] = {"name": (u.name or u.email) if u else None, "role": m.created_as_role.value}
        ev = latest.get(m.id)
        j["lastActivity"] = {"type": ev.type, "by": ev.actor_name, "role": ev.acting_role, "at": ev.created_at.isoformat()} if ev else None
        out.append(j)
    return out


@router.get("/{key}")
async def get_mission(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


@router.get("/{key}/flight")
async def mission_flight(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Flight recorder strip: time this mission has spent in each stage, read off its event log."""
    from ..services.analytics import mission_flight as flight

    mission = await load_mission(db, actor, key)
    return {"key": mission.key, "stage": mission.stage.value, "stages": await flight(db, mission)}


@router.get("/{key}/events")
async def mission_events(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    rows = (
        await db.execute(select(MissionEvent).where(MissionEvent.mission_id == mission.id).order_by(MissionEvent.created_at.desc()).limit(100))
    ).scalars().all()
    return [{"id": str(e.id), "type": e.type, "payload": e.payload, "actor": e.actor_name, "role": e.acting_role, "createdAt": e.created_at.isoformat()} for e in rows]


@router.get("/{key}/stream")
async def mission_stream(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    import asyncio
    import json

    from sse_starlette.sse import EventSourceResponse

    from ..missions.events import channel
    from ..services.sse import get_sse_manager

    mission = await load_mission(db, actor, key)
    manager = get_sse_manager()
    ch = channel(mission)
    queue = await manager.subscribe(ch)

    async def publish():
        try:
            while True:
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=15)
                    yield {"event": ev.get("type", "message"), "data": json.dumps(ev, default=str)}
                except TimeoutError:
                    yield {"comment": "ping"}
        finally:
            await manager.unsubscribe(ch, queue)

    return EventSourceResponse(publish(), headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


# ── Proceed, edit, approve, send back ────────────────────────────────────────


@router.post("/{key}/proceed")
async def proceed(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """The creator goes ahead although upstream files are AI drafts nobody in those seats has approved."""
    mission = await load_mission(db, actor, key)
    if not mission.awaiting_proceed:
        return mission_json(mission, await mission_apps(db, mission), with_bodies=True)
    if actor.role != mission.created_as_role:
        raise HTTPException(403, "Only the seat that started the mission can decide to proceed")
    if any(f.status == SpecStatus.drafting for f in mission.files):
        raise HTTPException(409, "NoX is still drafting — try again in a moment")
    unapproved = [f.role.value for f in mission.files if f.role in upstream_of(mission.created_as_role) and f.status != SpecStatus.approved]
    mission.awaiting_proceed = False
    mission.proceeded_without_approval = bool(unapproved)
    await db.commit()
    await record(db, mission, "mission.proceeded", {"unapproved": unapproved}, actor.user, actor.role.value)
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


class FileSave(BaseModel):
    markdown: str = Field(max_length=200_000)
    base_version: int | None = Field(default=None, alias="baseVersion")


@router.put("/{key}/files/{role}")
async def save_file(key: str, role: str, body: FileSave, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    r = role_param(role)
    own_file(actor, r)
    mission = await load_mission(db, actor, key)
    f = file_for(mission, r)
    if f.status == SpecStatus.drafting:
        raise HTTPException(409, "NoX is still writing the first draft of this file")
    if body.base_version is not None and body.base_version != f.version:
        raise HTTPException(409, f"This file changed since you opened it (now v{f.version}). Reload to continue.")
    if body.markdown == f.markdown:
        return file_json(f)
    f.markdown = body.markdown
    f.version += 1
    f.status = SpecStatus.draft
    f.author_id = actor.user.id
    f.approved_at = None
    f.approved_by = None
    db.add(SpecFileVersion(spec_file_id=f.id, version=f.version, markdown=body.markdown, source="human", saved_by=actor.user.id))
    # Files below this one were approved against its old wording: they no longer stand.
    stale = []
    for d in ROLE_ORDER[ROLE_ORDER.index(r) + 1:]:
        df = file_for(mission, d)
        if df.status == SpecStatus.approved:
            df.status = SpecStatus.stale
            stale.append(d.value)
    forward = [MissionStage.business, MissionStage.product, MissionStage.engineering, MissionStage.developer, MissionStage.build]
    if mission.stage in forward and forward.index(mission.stage) > forward.index(stage_for(r)):
        mission.stage = stage_for(r)  # the mission waits on this file again
    await db.commit()
    await record(db, mission, "file.saved", {"role": r.value, "version": f.version, "staled": stale}, actor.user, actor.role.value)
    schedule_sync(mission.id, r, f"{mission.key}: {actor.user.name or 'someone'} edits the {TITLE[r].lower()}")
    return file_json(f)


@router.post("/{key}/files/{role}/approve")
async def approve_file(key: str, role: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    r = role_param(role)
    own_file(actor, r)
    mission = await load_mission(db, actor, key)
    f = file_for(mission, r)
    if f.status in (SpecStatus.empty, SpecStatus.drafting) or not f.markdown.strip():
        raise HTTPException(409, "There's nothing to approve yet")
    if mission.awaiting_proceed and r == mission.created_as_role:
        raise HTTPException(409, "Decide whether to proceed past the unapproved AI drafts first")
    missing = [u.value for u in upstream_of(r) if file_for(mission, u).status in (SpecStatus.empty, SpecStatus.drafting)]
    if missing:
        raise HTTPException(409, f"Upstream files aren't written yet: {', '.join(missing)}")
    f.status = SpecStatus.approved
    f.approved_at = now_utc_naive()
    f.approved_by = actor.user.id
    advanced = False
    if mission.stage == stage_for(r):
        mission.stage = next_stage(mission.stage)
        # skip seats whose file is already approved (e.g. confirmed early, or unchanged after a send-back)
        while mission.stage.value in Role.__members__ and file_for(mission, Role(mission.stage.value)).status == SpecStatus.approved:
            mission.stage = next_stage(mission.stage)
        advanced = True
        nxt = mission.stage.value
        if nxt in Role.__members__:
            nf = file_for(mission, Role(nxt))
            if nf.status == SpecStatus.empty:  # hand the next seat a NoX first draft to start from
                nf.status = SpecStatus.drafting
    await db.commit()
    await record(db, mission, "file.approved", {"role": r.value, "version": f.version, "stage": mission.stage.value}, actor.user, actor.role.value)
    schedule_sync(mission.id, r, f"{mission.key}: {TITLE[r]} approved", approve=True)
    if advanced and any(x.status == SpecStatus.drafting for x in mission.files):
        spawn(f"draft {mission.key}", draft_mission_files, str(mission.id))
    from ..missions.jira_sync import on_stage_change

    await on_stage_change(db, mission, actor, f"{TITLE[r]} approved by {actor.user.name or actor.user.email}")
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


class SendBack(BaseModel):
    to_role: Role = Field(alias="toRole")
    reason: str = Field(min_length=3, max_length=1000)


@router.post("/{key}/send-back")
async def send_back(key: str, body: SendBack, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    if ROLE_ORDER.index(body.to_role) >= ROLE_ORDER.index(actor.role) and mission.stage != MissionStage.verifying:
        raise HTTPException(400, "Missions can only be sent back to an earlier seat")
    mission.stage = stage_for(body.to_role)
    mission.verify_role = None
    f = file_for(mission, body.to_role)
    if f.status == SpecStatus.approved:
        f.status = SpecStatus.draft
    await db.commit()
    await record(db, mission, "mission.sent_back", {"toRole": body.to_role.value, "reason": body.reason}, actor.user, actor.role.value)
    from ..missions.jira_sync import on_stage_change

    await on_stage_change(db, mission, actor, f"Sent back to {TITLE[body.to_role].lower()}: {body.reason}")
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


class MissionPatch(BaseModel):
    priority: str | None = Field(default=None, pattern="^P[1-4]$")
    title: str | None = Field(default=None, min_length=3, max_length=120)


@router.patch("/{key}")
async def patch_mission(key: str, body: MissionPatch, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    if body.priority is not None:
        if actor.role != Role.product:
            raise HTTPException(403, "Priority is set by the product owner")
        mission.priority = body.priority
    if body.title is not None:
        if actor.role not in (Role.product, mission.created_as_role):
            raise HTTPException(403, "The title belongs to the product owner or the mission's creator")
        mission.title = body.title
    await db.commit()
    await record(db, mission, "mission.updated", body.model_dump(exclude_none=True), actor.user, actor.role.value)
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


_ = ExternalLink  # re-exported via mission_json


# ── Ticket state (Firestore): assignee and pipeline ──────────────────────────


@router.get("/{key}/state")
async def get_ticket_state(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """The mission's ticket document: its pipeline steps, where it is on them, its transitions and assignee."""
    from ..services.tickets import ticket_state

    mission = await load_mission(db, actor, key)
    try:
        return await ticket_state(mission)
    except Exception as e:
        raise HTTPException(503, f"Ticket state is unavailable right now: {str(e)[:120]}")


async def _people_who_see(db: AsyncSession, mission: Mission) -> list[User]:
    """Members of the mission's org or of any org above it: access flows down, so they all see it."""
    parents = dict((await db.execute(select(Org.id, Org.parent_org_id))).all())
    chain, node = [], mission.org_id
    while node is not None and node not in chain:
        chain.append(node)
        node = parents.get(node)
    rows = await db.execute(select(User).join(Membership, Membership.user_id == User.id).where(Membership.org_id.in_(chain)).distinct())
    return sorted(rows.scalars().all(), key=lambda u: (u.name or u.email or "").lower())


@router.get("/{key}/people")
async def assignable_people(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    return [{"id": str(u.id), "name": u.name, "email": u.email, "photoUrl": u.photo_url} for u in await _people_who_see(db, mission)]


class AssigneeBody(BaseModel):
    user_id: uuid.UUID | None = Field(default=None, alias="userId")


@router.put("/{key}/assignee")
async def assign(key: str, body: AssigneeBody, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Anyone who can see the mission assigns it to anyone else who can see it, or clears the assignee."""
    from ..services.tickets import set_assignee

    mission = await load_mission(db, actor, key)
    assignee = None
    if body.user_id:
        user = next((u for u in await _people_who_see(db, mission) if u.id == body.user_id), None)
        if not user:
            raise HTTPException(400, "That person can't see this mission")
        assignee = {
            "userId": str(user.id), "name": user.name or user.email, "email": user.email, "photoUrl": user.photo_url,
            "assignedBy": {"userId": str(actor.user.id), "name": actor.user.name or actor.user.email, "role": actor.role.value},
            "assignedAt": datetime.now(UTC),
        }
    try:
        state = await set_assignee(mission, assignee)
    except Exception as e:
        raise HTTPException(503, f"Couldn't save the assignment: {str(e)[:120]}")
    await record(db, mission, "mission.assigned", {"assignee": assignee["name"] if assignee else None}, actor.user, actor.role.value)
    return state


# ── Reverse verification ─────────────────────────────────────────────────────


@router.post("/{key}/complete")
async def mark_completed(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """The developer says the build is done: every seat now checks its own file, in reverse order."""
    if actor.role != Role.developer:
        raise HTTPException(403, "The developer marks a mission as completed")
    mission = await load_mission(db, actor, key)
    if mission.stage != MissionStage.build:
        raise HTTPException(409, "Only a mission in Build can be marked as completed")
    for f in mission.files:
        prev = f.verification or {}
        items = []
        for it in map(norm_item, parse_checklist(f.markdown)):
            # What failed last time comes back to be re-checked; what already passed stays passed.
            if it["verdict"] in ("failed", "cant") or (prev.get("result") == "not_met" and it["verdict"] != "verified"):
                it = {**it, "verdict": None, "checked": False, "recheck": True}
            items.append(it)
        f.verification = {"items": items, "result": None, "round": prev.get("round", 0) + 1}
        if f.role == Role.developer:  # NoX attaches what it already knows: the pull requests on this mission
            prs = [{"label": f"{link.external_id} · {(link.state or {}).get('state') or 'open'}", "url": link.url} for link in mission.links if link.system == "github_pr" and link.url]
            if prs:
                f.verification["auto"] = prs
    mission.stage = MissionStage.verifying
    mission.verify_role = VERIFY_ORDER[0]
    await db.commit()
    await record(db, mission, "mission.completed", {"verifyRole": mission.verify_role.value}, actor.user, actor.role.value)
    from ..missions.jira_sync import on_stage_change

    await on_stage_change(db, mission, actor, f"Marked as completed by {actor.user.name or actor.user.email}; verification started")
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


def _verifying_own_file(mission: Mission, actor: Actor, r: Role) -> SpecFile:
    own_file(actor, r)
    if mission.stage != MissionStage.verifying:
        raise HTTPException(409, "This mission isn't being verified")
    if mission.verify_role != r:
        raise HTTPException(409, f"It's the {mission.verify_role.value if mission.verify_role else '?'} seat's turn to verify")
    return file_for(mission, r)


class ChecklistItem(BaseModel):
    checked: bool | None = None  # older clients: a tick is "verified"
    verdict: Literal["verified", "failed", "cant"] | None = None
    note: str | None = Field(default=None, max_length=1000)
    evidence: list[dict[str, str]] | None = Field(default=None, max_length=6)  # None keeps what the item has


class ChecklistSave(BaseModel):
    items: list[ChecklistItem]


async def _write_back(db: AsyncSession, mission: Mission, f: SpecFile, items: list[dict], actor: Actor) -> None:
    md = write_checklist(f.markdown, items)
    f.verification = {**(f.verification or {}), "items": items}
    if md != f.markdown:
        f.markdown = md
        f.version += 1
        db.add(SpecFileVersion(spec_file_id=f.id, version=f.version, markdown=md, source="verify", saved_by=actor.user.id))


@router.put("/{key}/files/{role}/verification")
async def save_checklist(key: str, role: str, body: ChecklistSave, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    r = role_param(role)
    mission = await load_mission(db, actor, key)
    f = _verifying_own_file(mission, actor, r)
    current = [norm_item(i) for i in ((f.verification or {}).get("items") or parse_checklist(f.markdown))]
    if len(body.items) != len(current):
        raise HTTPException(409, "The checklist changed — reload and try again")
    items = []
    for c, b in zip(current, body.items, strict=True):
        if b.verdict is not None:
            verdict = b.verdict
        elif b.checked is not None:
            verdict = "verified" if b.checked else None
        else:
            verdict = c["verdict"]
        try:
            evidence = clean_evidence(b.evidence) if b.evidence is not None else c["evidence"]
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        items.append(norm_item({**c, "verdict": verdict, "note": (b.note or "").strip() or None, "evidence": evidence, "recheck": c.get("recheck") and verdict is None}))
    mine = {e["mediaId"] for it in items for e in it["evidence"] if e["type"] == "capture"}
    if mine:
        found = {str(i) for i in (await db.execute(select(MediaAsset.id).where(MediaAsset.mission_id == mission.id, MediaAsset.id.in_([uuid.UUID(m) for m in mine])))).scalars().all()}
        if mine - found:
            raise HTTPException(400, "That capture isn't on this mission")
    await _write_back(db, mission, f, items, actor)
    await db.commit()
    done = sum(i["checked"] for i in items)
    await record(db, mission, "verify.progress", {"role": r.value, "checked": done, "total": len(items)}, actor.user, actor.role.value)
    schedule_sync(mission.id, r, f"{mission.key}: {TITLE[r].lower()} checklist {done}/{len(items)}")
    return file_json(f)


class Verdict(BaseModel):
    verdict: str = Field(pattern="^(verified|not_met|blocked)$")
    note: str | None = Field(default=None, max_length=2000)
    back_to: Role | None = Field(default=None, alias="backTo")  # not met: which seat fixes it (default: the developer, in Build)


def _update_items(items: list[dict]) -> list[dict]:
    return [{"text": i["text"], "verdict": i["verdict"], "note": i["note"], "evidence": i["evidence"]} for i in items]


async def _send_update(db: AsyncSession, mission: Mission, actor: Actor, kind: str, note: str | None, items: list[dict],
                       to_role: Role | None, round_: int) -> None:
    """One update on the timeline: what it is, from whom, to whom, about which items, in which round."""
    await record(db, mission, "mission.update", {"kind": kind, "role": actor.role.value, "toRole": to_role.value if to_role else None,
                                                 "note": note, "items": _update_items(items), "round": round_}, actor.user, actor.role.value)


@router.post("/{key}/files/{role}/verify")
async def verify_file(key: str, role: str, body: Verdict, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    r = role_param(role)
    mission = await load_mission(db, actor, key)
    f = _verifying_own_file(mission, actor, r)
    items = [norm_item(i) for i in ((f.verification or {}).get("items") or parse_checklist(f.markdown))]
    who = actor.user.name or actor.user.email
    rnd = (f.verification or {}).get("round", 1)
    kept = {k: v for k, v in (f.verification or {}).items() if k != "blocked"}
    from ..missions.jira_sync import on_stage_change

    if body.verdict == "verified":
        if any(i["verdict"] == "cant" for i in items):
            raise HTTPException(409, "An item is marked can't verify — settle it, or report the change as blocked")
        if any(not i["checked"] for i in items):
            raise HTTPException(409, "Every item needs to be verified — or send it back")
        f.verification = {**kept, "items": items, "result": "verified", "verifiedAt": now_utc().isoformat(timespec="seconds"), "verifiedBy": who}
        nxt = next_verifier(r)
        mission.verify_role = nxt
        if nxt is None:
            mission.stage = MissionStage.done
            mission.completed_at = now_utc_naive()
        await db.commit()
        if nxt is None and mission.sighting_id:
            from ..missions.sightings import mark_shipped

            await mark_shipped(db, mission)
        await record(db, mission, "verify.verified", {"role": r.value, "next": nxt.value if nxt else None}, actor.user, actor.role.value)
        await _send_update(db, mission, actor, "completed", (body.note or "").strip() or None, [], nxt, rnd)
        schedule_sync(mission.id, r, f"{mission.key}: {TITLE[r].lower()} verified by {who}", approve=True)
        note = f"{TITLE[r]} verified by {who}" + ("" if nxt else " — mission done")
        await on_stage_change(db, mission, actor, note)
        return mission_json(mission, await mission_apps(db, mission), with_bodies=True)

    note = (body.note or "").strip()
    if body.verdict == "blocked":
        stuck = [i for i in items if i["verdict"] == "cant"]
        if not stuck:
            raise HTTPException(400, "Mark the items you can't verify first")
        if not note:
            raise HTTPException(400, "Say what you're waiting for so the right person can help")
        f.verification = {**kept, "items": items, "blocked": {"note": note, "by": who, "at": now_utc().isoformat(timespec="seconds")}}
        await db.commit()
        await record(db, mission, "verify.blocked", {"role": r.value, "note": note}, actor.user, actor.role.value)
        await _send_update(db, mission, actor, "blocked", note, stuck, None, rnd)
        await on_stage_change(db, mission, actor, f"{TITLE[r]} blocked ({who}): {note}")
        return mission_json(mission, await mission_apps(db, mission), with_bodies=True)

    if not note:
        raise HTTPException(400, "Say what isn't met so the next person knows what to fix")
    back = body.back_to or Role.developer
    if ROLE_ORDER.index(back) > ROLE_ORDER.index(Role.developer):
        raise HTTPException(400, "Unknown seat")
    bad = failing(items)
    for i in bad:
        if i["verdict"] == "failed" and not i["note"]:
            raise HTTPException(400, f"Say what's wrong with: {i['text'][:60]}")
    f.verification = {**kept, "items": items, "result": "not_met", "note": note, "verifiedBy": who}
    mission.verify_role = None
    if back == Role.developer:
        mission.stage = MissionStage.build  # the requirement stands; the build needs another pass
    else:
        mission.stage = stage_for(back)  # the requirement itself was wrong
        bf = file_for(mission, back)
        if bf.status == SpecStatus.approved:
            bf.status = SpecStatus.draft
    await db.commit()
    await record(db, mission, "verify.not_met", {"role": r.value, "note": note, "backTo": back.value}, actor.user, actor.role.value)
    await _send_update(db, mission, actor, update_kind(items), note, bad, back, rnd)
    await on_stage_change(db, mission, actor, f"{TITLE[r]} not met ({who}): {note}" + (f" — failing: {'; '.join(i['text'][:50] for i in bad[:3])}" if bad else ""))
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


@router.get("/{key}/updates")
async def mission_updates(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """The verification updates on this mission, newest first: completed, partial, rework or blocked."""
    mission = await load_mission(db, actor, key)
    rows = (await db.execute(select(MissionEvent).where(MissionEvent.mission_id == mission.id, MissionEvent.type == "mission.update")
                             .order_by(MissionEvent.created_at.desc()).limit(50))).scalars().all()
    return [{"id": str(e.id), **e.payload, "actor": e.actor_name, "createdAt": e.created_at.isoformat()} for e in rows]


@router.post("/{key}/files/{role}/verification/evidence-check", status_code=202)
async def evidence_check(key: str, role: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Ask NoX whether the evidence on each item backs it up. A hint only; nothing changes but the hints."""
    from ..missions.evidence_check import check_evidence

    r = role_param(role)
    mission = await load_mission(db, actor, key)
    f = _verifying_own_file(mission, actor, r)
    if not any(norm_item(i)["evidence"] for i in (f.verification or {}).get("items") or []):
        raise HTTPException(409, "Attach evidence to an item first")
    spawn(f"evidence-check {key}/{role}", check_evidence, str(mission.id), r, actor.user.id)
    return {"status": "checking"}


# ── Co-writing with NoX ──────────────────────────────────────────────────────


class RefineBody(BaseModel):
    instruction: str | None = Field(default=None, max_length=2000)


@router.post("/{key}/files/{role}/refine", status_code=202)
async def refine(key: str, role: str, body: RefineBody, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Ask NoX to refine the file (runs in the background; progress arrives on the mission stream)."""
    from ..missions.cowrite import refine_file

    r = role_param(role)
    own_file(actor, r)
    mission = await load_mission(db, actor, key)
    if file_for(mission, r).status in (SpecStatus.empty, SpecStatus.drafting):
        raise HTTPException(409, "Nothing to refine yet")
    spawn(f"refine {key}/{role}", refine_file, str(mission.id), r, body.instruction)
    return {"status": "refining"}


@router.get("/{key}/files/{role}/chat")
async def chat_history(key: str, role: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    from ..db.models import SpecChatMessage

    r = role_param(role)
    mission = await load_mission(db, actor, key)
    f = file_for(mission, r)
    rows = (await db.execute(select(SpecChatMessage).where(SpecChatMessage.spec_file_id == f.id).order_by(SpecChatMessage.created_at))).scalars().all()
    return [{"id": str(m.id), "author": m.author, "body": m.body, "mediaIds": m.media_ids or [], "createdAt": m.created_at.isoformat()} for m in rows]


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    media_ids: list[uuid.UUID] = Field(default_factory=list, alias="mediaIds", max_length=4)


@router.post("/{key}/files/{role}/chat", status_code=202)
async def chat_post(key: str, role: str, body: ChatBody, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    from ..db.models import SpecChatMessage
    from ..missions.cowrite import chat

    r = role_param(role)
    own_file(actor, r)
    mission = await load_mission(db, actor, key)
    f = file_for(mission, r)
    media_ids = [str(i) for i in dict.fromkeys(body.media_ids)]
    if media_ids:  # captures attached to the message must already be on this mission
        from ..db.models import MediaAsset, MediaStatus

        rows = (await db.execute(select(MediaAsset).where(MediaAsset.id.in_(body.media_ids)))).scalars().all()
        if len(rows) != len(media_ids) or any(x.mission_id != mission.id or x.status in (MediaStatus.deleted, MediaStatus.withheld) for x in rows):
            raise HTTPException(404, "That capture isn't on this mission")
    msg = SpecChatMessage(spec_file_id=f.id, author="user", user_id=actor.user.id, body=body.message.strip(), media_ids=media_ids)
    db.add(msg)
    await db.commit()
    if media_ids:
        for x in rows:
            x.chat_message_id, x.spec_role = msg.id, x.spec_role or r
        await db.commit()
    await record(db, mission, "chat.message", {"role": r.value, "author": "user", "body": msg.body, "mediaIds": media_ids}, actor.user, actor.role.value)
    spawn(f"chat {key}/{role}", chat, str(mission.id), r, msg.body, actor.user.id, media_ids)
    return {"id": str(msg.id), "author": "user", "body": msg.body, "mediaIds": media_ids, "createdAt": msg.created_at.isoformat()}


class RevertBody(BaseModel):
    to_version: int = Field(alias="toVersion", ge=1)


@router.post("/{key}/files/{role}/revert")
async def revert_file(key: str, role: str, body: RevertBody, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    from ..missions.cowrite import revert

    r = role_param(role)
    own_file(actor, r)
    mission = await load_mission(db, actor, key)
    f = file_for(mission, r)
    if not await revert(db, mission, f, body.to_version, actor.user):
        raise HTTPException(404, "No such version")
    return file_json(f)


# ── Images ───────────────────────────────────────────────────────────────────

ALLOWED_IMAGES = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def _asset_dir():
    from pathlib import Path

    from ..core.config import _ROOT_DIR

    d = Path(_ROOT_DIR) / "logdir" / "mission_assets"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _store_asset(name: str, data: bytes, content_type: str) -> None:
    """Local disk in development; the GCS bucket when STORAGE_BACKEND=gcs (Cloud Run disks don't last)."""
    from ..services.gcs_storage import get_gcs_client, is_gcs_enabled

    if settings.STORAGE_BACKEND == "gcs" and is_gcs_enabled():
        get_gcs_client().bucket(settings.GCS_BUCKET_NAME).blob(f"mission_assets/{name}").upload_from_string(data, content_type=content_type)
    else:
        (_asset_dir() / name).write_bytes(data)


def _load_asset(name: str) -> bytes | None:
    from ..services.gcs_storage import get_gcs_client, is_gcs_enabled

    if settings.STORAGE_BACKEND == "gcs" and is_gcs_enabled():
        blob = get_gcs_client().bucket(settings.GCS_BUCKET_NAME).blob(f"mission_assets/{name}")
        return blob.download_as_bytes() if blob.exists() else None
    path = _asset_dir() / name
    return path.read_bytes() if path.is_file() else None


@router.post("/{key}/assets")
async def upload_asset(key: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Store an image for a spec file. Returns a Markdown snippet to insert."""

    mission = await load_mission(db, actor, key)
    ext = ALLOWED_IMAGES.get(file.content_type or "")
    if not ext:
        raise HTTPException(415, "Images only (PNG, JPEG, GIF, WebP, SVG)")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Images up to 8 MB")
    name = f"{uuid.uuid4().hex}.{ext}"  # unguessable: the URL itself is the capability (img tags can't send auth)
    await asyncio.to_thread(_store_asset, name, data, file.content_type or "application/octet-stream")
    spawn(f"asset {key}", _commit_asset_bg, str(mission.id), name, data)
    alt = (file.filename or "image").rsplit(".", 1)[0][:60]
    url = f"/api/v1/missions/assets/{name}"
    await record(db, mission, "asset.added", {"name": name}, actor.user, actor.role.value)
    return {"name": name, "url": url, "markdown": f"![{alt}]({url})"}


async def _commit_asset_bg(mission_id: str, name: str, data: bytes) -> None:
    from ..db.database import AsyncSessionLocal
    from ..missions.gitsync import commit_asset

    async with AsyncSessionLocal() as db:
        mission = (await db.execute(select(Mission).options(selectinload(Mission.files)).where(Mission.id == uuid.UUID(mission_id)))).scalars().first()
        if mission:
            await commit_asset(db, mission, name, data)


asset_router = APIRouter(prefix="/api/v1/missions/assets", tags=["Missions"])


@asset_router.get("/{name}")
async def get_asset(name: str):
    from fastapi.responses import Response

    if not re.fullmatch(r"[0-9a-f]{32}\.(png|jpg|gif|webp|svg)", name):
        raise HTTPException(404, "Not found")
    data = await asyncio.to_thread(_load_asset, name)
    if data is None:
        raise HTTPException(404, "Not found")
    headers = {"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"}
    if name.endswith(".svg"):
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"  # no scripts from uploaded SVGs
    media = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml"}[name.rsplit(".", 1)[1]]
    return Response(data, media_type=media, headers=headers)
