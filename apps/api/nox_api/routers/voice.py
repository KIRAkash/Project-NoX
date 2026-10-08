"""Voice: speak into any NoX text box (push-to-talk transcription), and listen to NoX's replies on request.

Transcription streams over SSE like Ask, the one other model call in a request path: the person is waiting for
their own words. The recording stays in memory and is dropped afterwards; the text is screened by Shield when the
person sends it, like anything typed. Listen is one TTS call per reply, cached by content.
"""

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from ..ai import speech
from ..ai.config import backend
from ..core.auth import Actor, current_actor, visible_org_ids
from ..core.config import settings
from ..db.database import get_db
from ..db.models import KnowledgeBase, Mission, MissionStage, Org
from ..services import media_storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/voice", tags=["Voice"])

AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac"}
MAX_BYTES = 8 * 1024 * 1024

_hits: dict[str, tuple[int, int]] = {}  # used only when Redis is unreachable


def speak_available() -> bool:
    return backend() != "local"


@router.get("/status")
async def voice_status(actor: Actor = Depends(current_actor)):
    """Which voice buttons to show: none in NoX Local (Gemma), Listen only when a TTS model is set."""
    return {"speak": speak_available(), "listen": speech.available(), "maxSeconds": settings.NOX_VOICE_MAX_S}


async def _over_limit(user_id: str) -> bool:
    hour = int(time.time() // 3600)
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        key = f"nox:voice:{user_id}:{hour}"
        n = await r.incr(key)
        if n == 1:
            await r.expire(key, 3700)
        await r.aclose()
    except Exception:
        at, n = _hits.get(user_id, (hour, 0))
        n = n + 1 if at == hour else 1
        _hits[user_id] = (hour, n)
    return n > settings.NOX_VOICE_PER_HOUR


async def vocabulary(db: AsyncSession, actor: Actor) -> list[str]:
    """Names the transcriber should spell right, only from what the caller can see (scope set by NoX)."""
    orgs = await visible_org_ids(db, actor.user)
    if not orgs:
        return ["NoX"]
    apps = (await db.execute(select(KnowledgeBase.app_name).where(KnowledgeBase.org_id.in_(orgs)))).scalars().all()
    teams = (await db.execute(select(Org.name).where(Org.id.in_(orgs)))).scalars().all()
    missions = (await db.execute(select(Mission.number).where(Mission.org_id.in_(orgs), Mission.stage != MissionStage.done)
                                 .order_by(Mission.updated_at.desc()).limit(30))).scalars().all()
    projects = [p.strip() for p in settings.JIRA_ALLOWED_PROJECTS.split(",") if p.strip()]
    return ["NoX", *apps, *teams, *(f"NOX-{n}" for n in missions), *projects][:200]


@router.post("/transcribe")
async def transcribe(request: Request, audio: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                     actor: Actor = Depends(current_actor)):
    """One push-to-talk recording → SSE: `delta` (words as they come), `done` {text, language, english}, or `error`."""
    from ..ai.agents import voice

    if not speak_available():
        raise HTTPException(409, "Voice isn't available in NoX Local")
    mime = media_storage.base_mime(audio.content_type or "")
    if mime not in AUDIO_TYPES:
        raise HTTPException(415, "NoX can't hear that kind of file")
    data = await audio.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"Recordings stop at {settings.NOX_VOICE_MAX_S} seconds")
    if len(data) < 200:
        raise HTTPException(400, "That recording is empty")
    if await _over_limit(str(actor.user.id)):
        raise HTTPException(429, "That's a lot of talking for one hour. Type for a bit, or try again later")
    words = await vocabulary(db, actor)

    async def events():
        try:
            async for ev in voice.transcribe(data, mime, words):
                if await request.is_disconnected():
                    break
                yield {"event": ev["type"], "data": json.dumps(ev)}
        except Exception:
            logger.exception("transcription failed")
            yield {"event": "error", "data": json.dumps({"type": "error", "message": "NoX couldn't hear that just now. Try again, or type it."})}

    return EventSourceResponse(events(), headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


class SpeakBody(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


@router.post("/speak")
async def speak(body: SpeakBody, actor: Actor = Depends(current_actor)):
    """NoX reads a reply aloud. Returns audio; the same words play from the cache the next time."""
    if not speech.available():
        raise HTTPException(409, "Listening isn't switched on for this deployment")
    text = speech.for_the_ear(body.text)
    if not text:
        raise HTTPException(400, "Nothing to read aloud")
    uri = media_storage.speech_uri(speech.cache_key(text))
    try:
        if media_storage.stat(uri):
            return Response(await asyncio.to_thread(media_storage.read_bytes, uri), media_type="audio/wav",
                            headers={"Cache-Control": "private, max-age=86400", "X-Nox-Cache": "hit"})
    except Exception:
        logger.debug("speech cache read failed", exc_info=True)
    try:
        audio, mime = await speech.synthesize(text)
    except Exception as e:
        logger.warning(f"speech failed: {e}")
        raise HTTPException(502, "NoX couldn't speak just now") from e
    try:
        await asyncio.to_thread(media_storage.write_bytes, uri, audio, mime)
    except Exception:
        logger.debug("speech cache write failed", exc_info=True)
    return Response(audio, media_type=mime, headers={"Cache-Control": "private, max-age=86400", "X-Nox-Cache": "miss"})
