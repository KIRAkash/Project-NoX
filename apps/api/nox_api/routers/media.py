"""Show NoX: captures (screenshots, screen recordings, videos, voice notes) and what NoX made of them.

    POST   /api/v1/media                     create a capture, get an upload URL (signed PUT to Cloud Storage)
    PUT    /api/v1/media/{id}/content        local development only: the browser uploads to the API
    POST   /api/v1/media/{id}/complete       check the upload and queue the analysis (202); also Retry
    GET    /api/v1/media/{id}                metadata, and the analysis pitched for the acting seat
    GET    /api/v1/media/{id}/url            a 5-minute URL for the player (and its captions)
    GET    /api/v1/media/{id}/content        the file, after an auth check or with a short-lived token
    GET    /api/v1/media/{id}/captions.vtt   captions from NoX's transcript
    GET    /api/v1/media/{id}/stream         live analysis steps (SSE)
    DELETE /api/v1/media/{id}                the uploader, or the seat that owns the file it's attached to
    GET    /api/v1/missions/{key}/media      the mission's Evidence tab
    POST   /api/v1/missions/{key}/files/{role}/verify-evidence   Show it works (202)

A draft capture (made before its mission exists) is visible only to its uploader. Once a mission is launched with
it, everyone who can open the mission can see it. A capture NoX Shield withheld stays visible to its uploader only.
"""

import asyncio
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import config as ai_config
from ..core.auth import Actor, current_actor, current_user, visible_org_ids
from ..core.config import settings
from ..db.database import get_db
from ..db.models import MediaAsset, MediaKind, MediaStatus, Membership, Mission, Role, User
from ..jobs import spawn
from ..missions.events import record
from ..missions.media import (
    CODE_SEATS,
    IMAGE_KINDS,
    analyze_media,
    channel,
    compare_evidence,
    describe,
    fmt_t,
    remove_evidence,
)
from ..services import media_storage

router = APIRouter(prefix="/api/v1/media", tags=["Show NoX"])
mission_router = APIRouter(prefix="/api/v1/missions", tags=["Show NoX"])

FAMILY = {
    MediaKind.image: "image/", MediaKind.screenshot: "image/", MediaKind.screen_recording: "video/",
    MediaKind.video: "video/", MediaKind.audio: "audio/",
}


def limits(kind: MediaKind) -> tuple[int, int | None]:
    """(max bytes, max seconds) for a kind."""
    mb = 1024 * 1024
    if kind in IMAGE_KINDS:
        return settings.NOX_MEDIA_MAX_IMAGE_MB * mb, None
    if kind == MediaKind.audio:
        return settings.NOX_MEDIA_MAX_AUDIO_MB * mb, settings.NOX_MEDIA_MAX_AUDIO_S
    return settings.NOX_MEDIA_MAX_VIDEO_MB * mb, settings.NOX_MEDIA_MAX_VIDEO_S


# ── Loading and permissions ─────────────────────────────────────────────────


async def _mission_by_key(db: AsyncSession, actor: Actor, key: str) -> Mission:
    from .missions import load_mission

    return await load_mission(db, actor, key)


async def load_media(db: AsyncSession, user: User, media_id: uuid.UUID) -> tuple[MediaAsset, Mission | None]:
    """The capture if this user may see it; 404 otherwise (never reveal that it exists)."""
    m = await db.get(MediaAsset, media_id)
    if not m or m.status == MediaStatus.deleted:
        raise HTTPException(404, "Not found")
    mine = m.uploaded_by == user.id
    if m.status == MediaStatus.withheld and not mine:
        raise HTTPException(404, "Not found")
    if m.mission_id is None:
        if not mine:
            raise HTTPException(404, "Not found")
        return m, None
    mission = await db.get(Mission, m.mission_id)
    if not mission or mission.org_id not in await visible_org_ids(db, user):
        raise HTTPException(404, "Not found")
    return m, mission


def _uploader(m: MediaAsset, actor: Actor) -> None:
    if m.uploaded_by != actor.user.id:
        raise HTTPException(403, "Only the person who captured this can do that")


def media_json(m: MediaAsset, seat: Role, *, mine: bool, mission: Mission | None = None, uploader: str | None = None) -> dict:
    """A capture as the acting seat sees it: the business seat never gets code locations or contracts."""
    o, g = m.observation or {}, m.grounding or {}
    view = (m.views or {}).get(seat.value) or {}
    code_ok = seat in CODE_SEATS
    out = {
        "id": str(m.id), "kind": m.kind.value, "label": describe(m), "mime": m.mime, "bytes": m.bytes,
        "durationS": m.duration_s, "width": m.width, "height": m.height, "caption": m.caption,
        "status": m.status.value, "statusReason": m.status_reason, "missionKey": mission.key if mission else None,
        "specRole": m.spec_role.value if m.spec_role else None, "uploadedAs": m.uploaded_as.value, "uploadedBy": uploader,
        "mine": mine, "annotatedOf": str(m.annotated_of) if m.annotated_of else None,
        "createdAt": m.created_at.isoformat() if m.created_at else None,
        "analyzedAt": m.analyzed_at.isoformat() if m.analyzed_at else None,
    }
    if m.status != MediaStatus.ready:
        return out
    out.update({
        "summary": view.get("summary") or o.get("summary", ""),
        "moments": view.get("moments") or [{"t": x.get("t"), "what": x.get("what")} for x in o.get("moments", [])],
        "problemTimes": [x.get("t") for x in o.get("moments", []) if x.get("is_problem")],
        "findings": view.get("findings") or [{"ref": f["ref"], "why": f.get("relevance", "")} for f in g.get("findings", [])],
        "kindOfRequest": o.get("kind_of_request"), "expected": o.get("expected"), "actual": o.get("actual"),
        "steps": o.get("steps", []), "likely": g.get("likely"),
        "apps": g.get("apps", []), "openQuestions": g.get("open_questions", []),
        "suggestedRequest": g.get("suggested_request") or "",
        "explanation": g.get("explanation") if code_ok else None,
        "code": g.get("code", []) if code_ok else [],
        "contracts": g.get("contracts", []) if code_ok else [],
        "usage": (m.usage or {}).get("line"),
        "hasCaptions": bool(o.get("transcript")),
    })
    return out


async def _name(db: AsyncSession, user_id) -> str | None:
    u = await db.get(User, user_id)
    return (u.name or u.email) if u else None


# ── Create and upload ───────────────────────────────────────────────────────


class MediaCreate(BaseModel):
    kind: MediaKind
    mime: str = Field(min_length=3, max_length=120)
    bytes: int = Field(gt=0)
    mission_key: str | None = Field(default=None, alias="missionKey")
    role: Role | None = None
    caption: str | None = Field(default=None, max_length=500)
    duration_s: float | None = Field(default=None, alias="durationS", ge=0)
    width: int | None = Field(default=None, ge=0)
    height: int | None = Field(default=None, ge=0)
    clip_start_s: float | None = Field(default=None, alias="clipStartS", ge=0)
    clip_end_s: float | None = Field(default=None, alias="clipEndS", ge=0)
    annotated_of: uuid.UUID | None = Field(default=None, alias="annotatedOf")


async def _home_org(db: AsyncSession, user: User) -> uuid.UUID:
    """A draft capture's org: the user's first membership (re-homed to the mission's org when attached)."""
    org = (await db.execute(select(Membership.org_id).where(Membership.user_id == user.id).order_by(Membership.joined_at))).scalars().first()
    if org is None:
        raise HTTPException(403, "Join an organisation before showing NoX anything")
    return org


@router.post("")
async def create_media(body: MediaCreate, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mime = media_storage.base_mime(body.mime)
    if mime not in media_storage.EXT or not mime.startswith(FAMILY[body.kind]) and not (body.kind == MediaKind.audio and mime == "video/webm"):
        raise HTTPException(415, "NoX takes images (PNG, JPEG, WebP, GIF), video (MP4, WebM, MOV) and audio (M4A, MP3, WebM, WAV)")
    if ai_config.backend() == "local" and body.kind not in IMAGE_KINDS:
        raise HTTPException(415, "Video and voice need NoX in the cloud. NoX Local reads images only.")
    max_bytes, max_s = limits(body.kind)
    if body.bytes > max_bytes:
        raise HTTPException(413, f"That's too big: up to {max_bytes // (1024 * 1024)} MB for this kind of capture")
    if max_s and body.duration_s and body.duration_s > max_s + 1:
        raise HTTPException(413, f"That's too long: up to {fmt_t(max_s)} for this kind of capture")

    mission = None
    if body.mission_key:
        mission = await _mission_by_key(db, actor, body.mission_key)
        count = (await db.execute(select(func.count()).select_from(MediaAsset).where(
            MediaAsset.mission_id == mission.id, MediaAsset.status != MediaStatus.deleted))).scalar()
        if count >= settings.NOX_MEDIA_PER_MISSION:
            raise HTTPException(409, f"A mission holds up to {settings.NOX_MEDIA_PER_MISSION} captures. Delete one first.")
    if body.annotated_of:
        original, _ = await load_media(db, actor.user, body.annotated_of)
        if original.kind not in IMAGE_KINDS:
            raise HTTPException(400, "Only images can be marked up")

    m = MediaAsset(
        id=uuid.uuid4(), org_id=mission.org_id if mission else await _home_org(db, actor.user),
        mission_id=mission.id if mission else None, spec_role=body.role if mission else None,
        uploaded_by=actor.user.id, uploaded_as=actor.role, kind=body.kind, mime=body.mime, bytes=body.bytes,
        duration_s=body.duration_s, width=body.width, height=body.height, clip_start_s=body.clip_start_s,
        clip_end_s=body.clip_end_s, caption=(body.caption or "").strip() or None, annotated_of=body.annotated_of,
        status=MediaStatus.uploading, views={}, usage={},
    )
    m.storage_uri = media_storage.storage_uri(m.org_id, m.id, mime)
    db.add(m)
    await db.commit()
    if m.storage_uri.startswith("gs://"):
        url = await asyncio.to_thread(media_storage.signed_put_url, m.storage_uri, m.mime)
    else:
        url = f"/api/v1/media/{m.id}/content"
    return {"id": str(m.id), "uploadUrl": url, "method": "PUT", "headers": {"Content-Type": m.mime}}


@router.put("/{media_id}/content", status_code=204)
async def upload_content(media_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Local development: the browser PUTs the file here (in production it goes straight to Cloud Storage)."""
    m, _ = await load_media(db, actor.user, media_id)
    _uploader(m, actor)
    if not m.storage_uri.startswith("local://"):
        raise HTTPException(409, "Upload this capture to its signed URL")
    if m.status not in (MediaStatus.uploading, MediaStatus.failed):
        raise HTTPException(409, "This capture is already uploaded")
    path = media_storage.local_path(m.storage_uri)
    path.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with open(path, "wb") as out:
        async for chunk in request.stream():
            size += len(chunk)
            if size > m.bytes:
                out.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "The upload is bigger than declared")
            out.write(chunk)
    return Response(status_code=204)


@router.post("/{media_id}/complete", status_code=202)
async def complete_upload(media_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """The upload is done (or the analysis failed and the uploader retries): check it and queue the analysis."""
    m, mission = await load_media(db, actor.user, media_id)
    _uploader(m, actor)
    if m.status not in (MediaStatus.uploading, MediaStatus.failed):
        raise HTTPException(409, f"This capture is already {m.status.value}")
    st = await asyncio.to_thread(media_storage.stat, m.storage_uri)
    if st is None or st[0] != m.bytes:
        raise HTTPException(409, "The upload isn't complete yet — try again")
    if st[1] and media_storage.base_mime(st[1]) != media_storage.base_mime(m.mime):
        raise HTTPException(415, "The uploaded file isn't the type that was declared")
    first = m.status == MediaStatus.uploading
    m.status, m.status_reason = MediaStatus.analyzing, None
    await db.commit()
    if mission and first:
        await record(db, mission, "media.attached", {"mediaId": str(m.id), "kind": m.kind.value, "label": describe(m),
                                                      "role": m.spec_role.value if m.spec_role else None}, actor.user, actor.role.value)
    spawn(f"media {m.id}", analyze_media, str(m.id))
    return media_json(m, actor.role, mine=True, mission=mission, uploader=await _name(db, m.uploaded_by))


# ── Read ────────────────────────────────────────────────────────────────────


@router.get("/{media_id}")
async def get_media(media_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    m, mission = await load_media(db, actor.user, media_id)
    return media_json(m, actor.role, mine=m.uploaded_by == actor.user.id, mission=mission, uploader=await _name(db, m.uploaded_by))


@router.get("/{media_id}/url")
async def media_url(media_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Short-lived URLs for `<video>`, `<img>` and `<track>`, which can't send an Authorization header."""
    m, _ = await load_media(db, actor.user, media_id)
    if m.status == MediaStatus.uploading:
        raise HTTPException(409, "Still uploading")
    if m.storage_uri.startswith("gs://"):
        url = await asyncio.to_thread(media_storage.signed_get_url, m.storage_uri)
    else:
        url = f"/api/v1/media/{m.id}/content?{media_storage.token_query(m.id, 'content')}"
    return {"url": url, "captionsUrl": f"/api/v1/media/{m.id}/captions.vtt?{media_storage.token_query(m.id, 'captions')}", "expiresInS": 300}


async def _authorised(request: Request, db: AsyncSession, media_id: uuid.UUID, what: str, exp: int | None, sig: str | None,
                      authorization: str | None) -> MediaAsset:
    if media_storage.token_ok(str(media_id), what, exp, sig):
        m = await db.get(MediaAsset, media_id)
        if not m or m.status == MediaStatus.deleted:
            raise HTTPException(404, "Not found")
        return m
    user = await current_user(request, authorization, db)
    return (await load_media(db, user, media_id))[0]


@router.get("/{media_id}/content")
async def media_content(media_id: uuid.UUID, request: Request, exp: int | None = Query(default=None), sig: str | None = Query(default=None),
                        authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    m = await _authorised(request, db, media_id, "content", exp, sig, authorization)
    if m.storage_uri.startswith("gs://"):
        return RedirectResponse(await asyncio.to_thread(media_storage.signed_get_url, m.storage_uri), status_code=307)
    path = media_storage.local_path(m.storage_uri)
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type=media_storage.base_mime(m.mime),
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


def vtt(transcript: list[dict]) -> str:
    def ts(t: float) -> str:
        ms = int(round(max(0.0, t) * 1000))
        return f"{ms // 3_600_000:02d}:{ms // 60_000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"

    lines = ["WEBVTT", ""]
    for i, line in enumerate(transcript):
        start = float(line.get("t") or 0)
        nxt = float(transcript[i + 1].get("t") or start) if i + 1 < len(transcript) else start + 4
        end = max(nxt, start + 1)
        speaker = f"<v {line['speaker']}>" if line.get("speaker") else ""
        lines += [f"{ts(start)} --> {ts(end)}", f"{speaker}{line.get('text', '')}", ""]
    return "\n".join(lines)


@router.get("/{media_id}/captions.vtt")
async def captions(media_id: uuid.UUID, request: Request, exp: int | None = Query(default=None), sig: str | None = Query(default=None),
                   authorization: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    m = await _authorised(request, db, media_id, "captions", exp, sig, authorization)
    transcript = (m.observation or {}).get("transcript", []) if m.status == MediaStatus.ready else []
    return Response(vtt(transcript), media_type="text/vtt", headers={"Cache-Control": "private, no-store"})


@router.get("/{media_id}/stream")
async def media_stream(media_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    import json

    from sse_starlette.sse import EventSourceResponse

    from ..services.sse import get_sse_manager

    await load_media(db, actor.user, media_id)
    manager = get_sse_manager()
    ch = channel(media_id)
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


@router.delete("/{media_id}", status_code=204)
async def delete_media(media_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    m, mission = await load_media(db, actor.user, media_id)
    owner = mission is not None and m.spec_role is not None and actor.role == m.spec_role
    if m.uploaded_by != actor.user.id and not owner:
        raise HTTPException(403, "Only the person who captured this, or the owner of the file it's attached to, can delete it")
    m.status, m.observation, m.grounding, m.views = MediaStatus.deleted, None, None, {}
    await db.commit()
    await asyncio.to_thread(media_storage.delete, m.storage_uri)
    if mission:
        await record(db, mission, "media.deleted", {"mediaId": str(m.id), "label": describe(m)}, actor.user, actor.role.value)
        spawn(f"media remove {m.id}", _remove_bg, str(mission.id), str(m.id))
    return Response(status_code=204)


async def _remove_bg(mission_id: str, media_id: str) -> None:
    from ..db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        mission, m = await db.get(Mission, uuid.UUID(mission_id)), await db.get(MediaAsset, uuid.UUID(media_id))
        if mission and m:
            await remove_evidence(db, mission, m)


# ── Mission views ───────────────────────────────────────────────────────────


@mission_router.get("/{key}/media")
async def mission_media(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await _mission_by_key(db, actor, key)
    rows = (await db.execute(select(MediaAsset).where(MediaAsset.mission_id == mission.id, MediaAsset.status != MediaStatus.deleted)
                             .order_by(MediaAsset.created_at))).scalars().all()
    out = []
    for m in rows:
        mine = m.uploaded_by == actor.user.id
        if m.status == MediaStatus.withheld and not mine:
            continue
        out.append(media_json(m, actor.role, mine=mine, mission=mission, uploader=await _name(db, m.uploaded_by)))
    return out


class EvidenceBody(BaseModel):
    media_ids: list[uuid.UUID] = Field(alias="mediaIds", min_length=1, max_length=2)


@mission_router.post("/{key}/files/{role}/verify-evidence", status_code=202)
async def verify_evidence(key: str, role: str, body: EvidenceBody, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Show it works: compare "after" captures with the mission's original ones and hint beside each checklist item."""
    from .missions import _verifying_own_file, role_param

    r = role_param(role)
    mission = await _mission_by_key(db, actor, key)
    _verifying_own_file(mission, actor, r)
    for mid in body.media_ids:
        m = await db.get(MediaAsset, mid)
        if not m or m.mission_id != mission.id or m.status in (MediaStatus.deleted, MediaStatus.withheld):
            raise HTTPException(404, "That capture isn't on this mission")
    spawn(f"compare {key}/{role}", compare_evidence, str(mission.id), r, [str(i) for i in body.media_ids], actor.user.id)
    return {"status": "comparing"}
