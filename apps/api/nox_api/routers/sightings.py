"""Sightings (CP18): the acting seat's suggested changes, Start mission, feedback, and each organization's schedule.

The feed only ever contains the acting seat's view and the evidence that seat may see (`missions/sightings.py`
`SEAT_EVIDENCE`), so the business seat's browser never holds code paths. The schedule lives on the top-level
organization; Cloud Scheduler calls the internal tick, authenticated by its OIDC token.
"""

import asyncio
import hmac
import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor, Cap, assert_org_visible, current_actor, require, visible_org_ids
from ..core.config import settings
from ..db.database import get_db
from ..db.models import Org, Role, SightingRun
from ..missions import sightings as svc
from ..missions.lenses import LENSES

router = APIRouter(prefix="/api/v1/sightings", tags=["Sightings"])
org_router = APIRouter(prefix="/api/v1/orgs/{org_id}/sightings", tags=["Sightings"])
internal_router = APIRouter(prefix="/api/v1/internal/sightings", tags=["Sightings"], include_in_schema=False)


# ── The feed ─────────────────────────────────────────────────────────────────


@router.get("")
async def list_sightings(status: str = Query(default="open", pattern="^(open|launched|dismissed)$"),
                         db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    return await svc.feed(db, actor, status)


@router.get("/schedules")
async def schedules(db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    """The top-level organizations the caller can see, each with its schedule and latest run."""
    visible = await visible_org_ids(db, actor.user)
    parents = await svc._parents(db)
    roots = sorted({svc._root_of(parents, o) for o in visible} & visible, key=str)
    out = []
    for root in roots:
        org = await db.get(Org, root)
        last = (await db.execute(select(SightingRun).where(SightingRun.org_id == root)
                                 .order_by(SightingRun.started_at.desc()).limit(1))).scalars().first()
        out.append({"org": {"id": str(org.id), "name": org.name}, "schedule": svc.schedule_json(await svc.get_schedule(db, root), root),
                    "lastRun": svc.run_json(last) if last else None, "canManage": actor.can(Cap.MANAGE_SIGHTINGS)})
    return {"orgs": out, "kinds": {r.value: list(LENSES[r].kinds) for r in Role}}


@router.get("/{sighting_id}")
async def get_sighting(sighting_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    return await svc.one(db, actor, sighting_id)


@router.post("/{sighting_id}/launch")
async def launch(sighting_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.CREATE_MISSION))):
    """Start mission: one click, from the acting seat, in its words. The mission then runs through every seat as usual."""
    from .missions import load_mission, mission_apps, mission_json

    mission = await svc.launch(db, actor, sighting_id)
    mission = await load_mission(db, actor, mission.key)
    return mission_json(mission, await mission_apps(db, mission))


class Feedback(BaseModel):
    action: Literal["useful", "dismissed", "snoozed", "restore"]
    reason: str | None = Field(default=None, max_length=200)


@router.post("/{sighting_id}/feedback")
async def feedback(sighting_id: uuid.UUID, body: Feedback, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    return await svc.give_feedback(db, actor, sighting_id, body.action, (body.reason or "").strip() or None)


# ── Schedule and runs (per top-level organization) ───────────────────────────


async def _root(db: AsyncSession, actor: Actor, org_id: uuid.UUID) -> uuid.UUID:
    await assert_org_visible(db, actor.user, org_id)
    return await svc.root_org(db, org_id)


@org_router.get("/settings")
async def get_settings(org_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    root = await _root(db, actor, org_id)
    return svc.schedule_json(await svc.get_schedule(db, root), root)


class ScheduleBody(BaseModel):
    cadence: Literal["off", "daily", "weekly"]
    weekday: int = Field(default=0, ge=0, le=6)
    hour: int = Field(default=8, ge=0, le=23)
    timezone: str = Field(default="UTC", max_length=64)
    seats: list[Role] = Field(default_factory=lambda: list(Role), min_length=1)
    focus: list[str] = Field(default_factory=list, max_length=10)


@org_router.put("/settings")
async def put_settings(org_id: uuid.UUID, body: ScheduleBody, db: AsyncSession = Depends(get_db),
                       actor: Actor = Depends(require(Cap.MANAGE_SIGHTINGS))):
    root = await _root(db, actor, org_id)
    await assert_org_visible(db, actor.user, root)  # the schedule covers the whole organization, not just one team
    from zoneinfo import available_timezones

    if body.timezone not in available_timezones() and body.timezone != "UTC":
        raise HTTPException(422, f"Unknown timezone '{body.timezone}'")
    kinds = {k for lens in LENSES.values() for k in lens.kinds}
    s = await svc.get_schedule(db, root, create=True)
    s.cadence, s.weekday, s.hour, s.timezone = body.cadence, body.weekday, body.hour, body.timezone
    s.seats = [r.value for r in dict.fromkeys(body.seats)]
    s.focus = [k for k in dict.fromkeys(body.focus) if k in kinds]
    s.next_run_at = svc.next_run(s.cadence, s.weekday, s.hour, s.timezone, svc.utcnow())
    s.updated_by = actor.user.id
    await db.commit()
    return svc.schedule_json(s, root)


@org_router.post("/run", status_code=202)
async def run_now(org_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.MANAGE_SIGHTINGS))):
    """Look at every application now, changed or not. Progress streams on `…/stream`."""
    from ..workers.dispatcher import dispatch_sightings_run

    root = await _root(db, actor, org_id)
    await assert_org_visible(db, actor.user, root)
    await svc.get_schedule(db, root, create=True)
    run = await svc.start_run(db, root, trigger="manual", started_by=actor.user.id)
    if run is None:
        raise HTTPException(409, "NoX is already looking. It'll be done in a few minutes.")
    dispatch_sightings_run(str(run.id), force=True)
    return {"runId": str(run.id)}


@org_router.get("/runs")
async def runs(org_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    root = await _root(db, actor, org_id)
    rows = (await db.execute(select(SightingRun).where(SightingRun.org_id == root)
                             .order_by(SightingRun.started_at.desc()).limit(10))).scalars().all()
    return [svc.run_json(r) for r in rows]


@org_router.get("/stream")
async def stream(org_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(Cap.SEE_ATLAS))):
    from sse_starlette.sse import EventSourceResponse

    from ..services.sse import get_sse_manager

    root = await _root(db, actor, org_id)
    manager, ch = get_sse_manager(), svc.channel(root)
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


# ── Cloud Scheduler ──────────────────────────────────────────────────────────


async def scheduler_only(authorization: str | None = Header(default=None), x_nox_tick: str | None = Header(default=None)) -> None:
    """The tick is for the scheduler only: a shared secret (`X-Nox-Tick`), or an OIDC token minted by Google for the
    scheduler's service account, with this URL as its audience."""
    secret = settings.NOX_SIGHTINGS_TICK_SECRET
    if secret and x_nox_tick and hmac.compare_digest(secret.encode(), x_nox_tick.encode()):
        return
    sa = settings.NOX_SIGHTINGS_SCHEDULER_SA
    scheme, _, token = (authorization or "").partition(" ")
    if sa and scheme == "Bearer" and token:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        from ..interop.a2a import public_url

        try:
            claims = await asyncio.to_thread(id_token.verify_oauth2_token, token.strip(), google_requests.Request(),
                                             f"{public_url()}/api/v1/internal/sightings/tick")
        except ValueError as e:
            raise HTTPException(401, "Invalid scheduler token") from e
        if claims.get("email") == sa and claims.get("email_verified"):
            return
    raise HTTPException(403, "Only the scheduler can tick")


@internal_router.post("/tick", dependencies=[Depends(scheduler_only)])
async def tick():
    return {"started": await svc.tick()}
