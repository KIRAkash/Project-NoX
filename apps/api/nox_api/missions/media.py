"""Show NoX: what happens to a screenshot, screen recording, video or voice note after it's uploaded.

One job per capture (principle 6), wrapped in one usage scope, in three stages that each stream a step:

    Perceive ─▶ Shield ─▶ Ground ─▶ seat views ─▶ ready
    Gemini      NoX       an agent with   one FAST call:
    watches     Shield    the knowledge   the analysis pitched
    the file    screens   tools ties it   for each seat
    (typed)     the words to pages, code

Perceive describes only what is seen or heard, and copies on-screen text exactly. Shield screens the transcript
and the on-screen text; a blocked capture is `withheld` and never reaches a prompt, and personal data values are
redacted before anything else sees the words. Ground looks each identifier and problem moment up in the
applications NoX scoped from memberships (principle 3), and a deterministic post-check drops any page ref the agent
didn't read and any code location not in the source snapshot (principle 2).

Drafting and co-writing get captures as text (observation plus grounding), never the video again, through
`mission_evidence` and `render_evidence`. For the business and product files the code lines are left out of the
prompt entirely (principle 8). `compare_evidence` is the one call that sends video twice: Show it works puts the
before and after recordings side by side against a checklist, and writes hints. People still tick every item.
"""

from __future__ import annotations

import asyncio
import io
import logging
import re
import uuid
from dataclasses import dataclass, field

from google.genai import types
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..ai import config, runtime, structured, telemetry
from ..ai.schemas import EvidenceComparison, MediaGrounding, MediaObservation, SeatViews
from ..core.config import settings
from ..core.time_utils import now_utc_naive
from ..db.database import AsyncSessionLocal
from ..db.models import KnowledgeBase, MediaAsset, MediaKind, MediaStatus, Mission, MissionApp, Role, User
from ..services import media_storage, shield
from ..services.sse import get_sse_manager
from .events import broadcast_transient, record

logger = logging.getLogger(__name__)

VIDEO_KINDS = {MediaKind.screen_recording, MediaKind.video}
IMAGE_KINDS = {MediaKind.image, MediaKind.screenshot}
CODE_SEATS = {Role.engineering, Role.developer}
INLINE_MAX = 7 * 1024 * 1024  # smaller files go to Gemini as inline bytes

KIND_LABEL = {
    MediaKind.image: "image", MediaKind.screenshot: "screenshot", MediaKind.screen_recording: "screen recording",
    MediaKind.video: "video", MediaKind.audio: "voice note",
}


def channel(media_id) -> str:
    return f"media:{media_id}"


def fmt_t(t: float | None) -> str:
    s = max(0, int(round(t or 0)))
    return f"{s // 60}:{s % 60:02d}"


def describe(m: MediaAsset) -> str:
    """'1:12 screen recording', 'screenshot'."""
    label = KIND_LABEL[m.kind]
    return f"{fmt_t(m.duration_s)} {label}" if m.duration_s and m.kind not in IMAGE_KINDS else label


# ── Live progress ───────────────────────────────────────────────────────────

async def _emit(m: MediaAsset, type_: str, payload: dict | None = None) -> None:
    body = {"mediaId": str(m.id), **(payload or {})}
    await get_sse_manager().broadcast(channel(m.id), {"type": type_, "payload": body})
    if m.mission_id:
        await broadcast_transient(m.mission_id, type_, body)


async def _step(m: MediaAsset, label: str) -> None:
    await _emit(m, "media.step", {"label": label})


def _lookup_label(tool: str, args: dict, seat: Role, home_app: str) -> str:
    """Grounding steps in the seat's words: the business seat hears about applications, not code."""
    from ..ai.agents.ask import step_label

    app = args.get("app") or home_app or "every application"
    if tool == "read_kb_page":
        ref = str(args.get("ref", "")).removeprefix("kb:").strip("/")
        app, _, path = ref.partition("/")
        return f"Looking up {app}: {path.rsplit('/', 1)[-1].replace('-', ' ')}"
    if seat not in CODE_SEATS and tool in ("grep_source", "read_source_file"):
        q = str(args.get("pattern") or args.get("path") or "")[:60]
        return f"Checking {app} for “{q}”"
    return step_label(tool, args, home_app)


# ── Stage 1: Perceive ───────────────────────────────────────────────────────

PERCEIVE = """You are NoX's eyes. Someone in the {seat} seat is showing you a {what} so NoX can understand a
software problem or request. Describe only what is seen or heard.
Rules:
- Copy on-screen text exactly, character for character: error messages, status labels, codes, field names, routes,
  IDs. Put the strings someone could search code or documentation for in `identifiers`.
- Timestamps are seconds from the start of the capture.
- Transcribe speech with timestamps. Mark the moments where the problem shows (`is_problem`).
- No guesses about code, causes or systems you can't see. If the author says what they expected, put it in
  `expected`; what happened instead goes in `actual`.
- `sensitive` lists kinds of personal data visible on screen (e.g. "email addresses"), never the values.
{extra}"""


async def _file_part(m: MediaAsset, uri: str, mime: str, size: int) -> types.Part:
    """The capture as a model part: read from Cloud Storage directly where the backend can, else bytes or the Files API."""
    backend = config.backend()
    mime = media_storage.base_mime(mime)
    if backend == "enterprise" and uri.startswith("gs://"):
        return types.Part.from_uri(file_uri=uri, mime_type=mime)  # no bytes through the API
    data = await asyncio.to_thread(media_storage.read_bytes, uri)
    if size <= INLINE_MAX or backend != "api_key":
        return types.Part.from_bytes(data=data, mime_type=mime)
    client = config.genai_client()
    uploaded = await client.aio.files.upload(file=io.BytesIO(data), config={"mime_type": mime})
    for _ in range(60):  # videos are processed before they can be used
        if getattr(uploaded.state, "name", str(uploaded.state)) != "PROCESSING":
            break
        await asyncio.sleep(2)
        uploaded = await client.aio.files.get(name=uploaded.name)
    return types.Part.from_uri(file_uri=uploaded.uri, mime_type=mime)


def _with_clip(part: types.Part, m: MediaAsset) -> types.Part:
    if m.kind not in VIDEO_KINDS:
        return part
    meta = types.VideoMetadata(fps=1)
    if m.clip_start_s:
        meta.start_offset = f"{m.clip_start_s:.1f}s"
    if m.clip_end_s:
        meta.end_offset = f"{m.clip_end_s:.1f}s"
    part.video_metadata = meta
    return part


async def perceive(m: MediaAsset, *, original: MediaAsset | None, request: str | None) -> MediaObservation:
    parts = [_with_clip(await _file_part(m, m.storage_uri, m.mime, m.bytes), m)]
    extra = ""
    if original is not None:  # an annotated copy: NoX sees the markup and what was under it
        parts.append(await _file_part(original, original.storage_uri, original.mime, original.bytes))
        extra = ("- The first image is the author's marked-up copy: they marked the area of interest in colour. The "
                 "second is the original. Say what the marking points at in `marked_area`.")
    long = (m.duration_s or 0) > 60
    gen = types.GenerateContentConfig(
        media_resolution=types.MediaResolution.MEDIA_RESOLUTION_LOW if long else types.MediaResolution.MEDIA_RESOLUTION_MEDIUM)
    prompt = [f"The {KIND_LABEL[m.kind]} is attached."]
    if m.caption:
        prompt.append(f'The author asks NoX to look at: "{m.caption}"')
    if request:
        prompt.append(f'The mission this belongs to asks: "{request}"')
    return await structured.ask(
        MediaObservation, "\n".join(prompt), name="nox_media_perceive",
        instruction=PERCEIVE.format(seat=m.uploaded_as.value, what=describe(m), extra=extra),
        tier=config.Tier.DEFAULT, parts=parts, generate_config=gen,
    )


# ── Stage 2: Shield ─────────────────────────────────────────────────────────

def screened_text(obs: MediaObservation, caption: str | None) -> str:
    """Everything a capture puts into later prompts in words: speech, on-screen text and the caption."""
    lines = [caption or ""] + [x.text for x in obs.transcript]
    for mo in obs.moments:
        lines += mo.screen_text
    for sc in obs.screens:
        lines += sc.visible_text
    return "\n".join(x for x in lines if x)


def redact_observation(obs: MediaObservation) -> MediaObservation:
    """Personal data values out of every string NoX keeps (prompts, Git and the UI see only this copy)."""
    def walk(v):
        if isinstance(v, str):
            return shield.redact(v)
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    return MediaObservation.model_validate(walk(obs.model_dump()))


# ── Stage 3: Ground ─────────────────────────────────────────────────────────

GROUND = """You are NoX. Someone showed NoX a capture (its observation is below). Tie it to the organisation's
knowledge: which applications it concerns, what their knowledge bases say about the behaviour seen, and where it
lives in code.
Applications you can look at: {apps}.
How to work:
- For each identifier and each problem moment, look it up: grep_source for exact strings (error messages, labels,
  codes), search_kb for behaviour, find_interfaces for events and APIs seen. {everywhere}
- Independent lookups go out together in one step. At most 10 lookups, then answer.
- Say whether the knowledge base explains the behaviour as intended. For example: "ADR-002 says settlement is
  event-driven, so the status updates only after nte.trades.matched is consumed". Telling a bug from a
  misunderstanding is the most useful thing you can say. Put it in `explanation` and set `likely`.
- Never cite anything a tool didn't return: every finding's ref is a page ref exactly as search_kb or read_kb_page
  returned it, and every code location is a `path:line` exactly as grep_source returned it.
- Rank `apps` best first. Put what the capture can't settle in `open_questions`.
- `suggested_request` is one sentence a business user would say, in plain words, with no code or system names.
"""

GROUND_TOOLS_NAMES = ("search_kb", "read_kb_page", "list_pages", "find_interfaces", "grep_source", "read_source_file")


def _grounding_message(m: MediaAsset, obs: MediaObservation, request: str | None) -> str:
    parts = [f"Capture: {describe(m)}, shown from the {m.uploaded_as.value} seat."]
    if m.caption:
        parts.append(f'Author\'s note: "{m.caption}"')
    if request:
        parts.append(f'Mission request: "{request}"')
    parts.append("Observation:\n" + obs.model_dump_json(exclude_none=True, indent=1))
    return "\n".join(parts)


def _norm_ref(ref: str) -> str:
    return ref.removeprefix("[[").removesuffix("]]").removeprefix("kb:").split("|")[0].strip("/ ").removesuffix(".md")


def post_check(g: MediaGrounding, cited: list[str], apps: dict[str, str]) -> MediaGrounding:
    """Grounded or it doesn't ship: drop refs the agent never read, code outside the snapshot, apps outside scope."""
    from ..ai.tools.knowledge import _source_files

    read = {_norm_ref(r) for r in cited}
    g.findings = [f for f in g.findings if _norm_ref(f.ref) in read][:5]
    for f in g.findings:
        f.ref = _norm_ref(f.ref)
    kept = []
    for c in g.code:
        path = c.location.rsplit(":", 1)[0] if re.search(r":\d+$", c.location) else c.location
        if c.app in apps and path in _source_files(apps[c.app]):
            kept.append(c)
    g.code = kept
    g.contracts = [c for c in g.contracts if c.app in apps]
    g.apps = [a for a in g.apps if a.app in apps]
    return g


async def ground(m: MediaAsset, obs: MediaObservation, *, apps: dict[str, str], home_app: str, request: str | None) -> MediaGrounding:
    from google.adk.agents import LlmAgent

    from ..ai.tools import knowledge

    tools = [getattr(knowledge, n) for n in GROUND_TOOLS_NAMES]
    everywhere = "Search every application at once (search_kb with everywhere=true) until you know which one it is." if not home_app else ""
    agent = LlmAgent(
        name="nox_media_ground", model=config.model(config.Tier.DEFAULT), tools=tools,
        instruction=GROUND.format(apps=", ".join(sorted(apps)) or "none", everywhere=everywhere),
        output_schema=MediaGrounding, output_key="grounding",
    )
    state = {"apps": apps, "home_app": home_app}
    final: dict = {}
    text = ""
    found: list[str] = []
    async for ev in runtime.stream(agent, _grounding_message(m, obs, request), state=state, user_id=f"media-{m.id}",
                                   sessions=runtime.ephemeral_sessions()):
        if ev["type"] == "step":
            await _step(m, _lookup_label(ev["tool"], ev["args"], m.uploaded_as, home_app))
        elif ev["type"] == "tool_result" and ev["tool"] == "grep_source" and m.uploaded_as in CODE_SEATS:
            for hit in ((ev["result"] or {}).get("matches") or [])[:1]:
                loc = hit.split(": ", 1)[0]
                if loc not in found:
                    found.append(loc)
                    await _step(m, f"Found `{loc.rsplit('/', 1)[-1]}`")
        elif ev["type"] == "done":
            final, text = ev.get("state") or {}, ev.get("text") or ""
    raw = final.get("grounding")
    g = structured._parse(MediaGrounding, raw if isinstance(raw, dict | MediaGrounding) else None, text)
    return post_check(g, list(final.get("cited") or []), apps)


# ── Seat views ──────────────────────────────────────────────────────────────

SEATS_INSTRUCTION = """Rewrite one capture's analysis for each of the four seats on a mission. Same facts, each in its
reader's vocabulary:
- business: what the customer or the business sees; plain words; never code, file paths, endpoints, services,
  events or class names.
- product: behaviour, rules and edge cases; no code.
- engineering: components, interfaces and data flow; code references welcome.
- developer: exact code locations and identifiers first.
Each summary is one paragraph that also says what the knowledge base says about the behaviour seen: a bug, working
as designed, or something missing. Keep every moment's time. Findings keep their ref exactly as given; `why` is one
sentence for that seat. Use only what the analysis says."""


def fallback_views(obs: MediaObservation, g: MediaGrounding | None) -> dict:
    """Seat views without a model call: the same text for every seat (code is filtered at display time)."""
    view = {
        "summary": obs.summary + (f" {g.explanation}" if g and g.explanation else ""),
        "moments": [{"t": mo.t, "what": mo.what} for mo in obs.moments],
        "findings": [{"ref": f.ref, "why": f.relevance} for f in (g.findings if g else [])],
    }
    return {r.value: view for r in Role}


async def seat_views(obs: MediaObservation, g: MediaGrounding) -> dict:
    payload = {"observation": obs.model_dump(include={"summary", "moments", "expected", "actual"}),
               "grounding": g.model_dump(include={"findings", "explanation", "likely", "code"})}
    try:
        views = await structured.ask(SeatViews, str(payload), name="nox_media_seats", instruction=SEATS_INSTRUCTION,
                                     tier=config.Tier.FAST)
    except Exception as e:
        logger.warning(f"seat views failed ({e}); using the plain view")
        return fallback_views(obs, g)
    refs = {f.ref for f in g.findings}
    out = {}
    for r in Role:
        v = getattr(views, r.value)
        v.findings = [f for f in v.findings if _norm_ref(f.ref) in refs]
        out[r.value] = v.model_dump()
    return out


# ── The job ─────────────────────────────────────────────────────────────────

async def _scope(db, m: MediaAsset, mission: Mission | None) -> tuple[dict[str, str], str]:
    """The applications grounding may look at: the mission's, or everything the uploader can see for a draft."""
    from ..core.auth import visible_org_ids

    if mission is not None:
        rows = (await db.execute(select(KnowledgeBase).join(MissionApp, MissionApp.kb_id == KnowledgeBase.id)
                                 .where(MissionApp.mission_id == mission.id))).scalars().all()
        primary = next((k.app_name for k in rows if k.id == mission.primary_kb_id), "")
        return {k.app_name: str(k.id) for k in rows}, primary
    user = await db.get(User, m.uploaded_by)
    visible = await visible_org_ids(db, user) if user else set()
    rows = (await db.execute(select(KnowledgeBase).where(KnowledgeBase.org_id.in_(visible)))).scalars().all() if visible else []
    return {k.app_name: str(k.id) for k in rows}, ""


async def _timed(coro):
    return await asyncio.wait_for(coro, timeout=settings.NOX_MEDIA_STAGE_TIMEOUT_S)


async def analyze_media(media_id: str) -> None:
    """Perceive → Shield → Ground → seat views. Every outcome is a status the uploader can see."""
    async with AsyncSessionLocal() as db:
        m = await db.get(MediaAsset, uuid.UUID(media_id))
        if not m or m.status != MediaStatus.analyzing:
            return
        mission = await db.get(Mission, m.mission_id) if m.mission_id else None
        original = await db.get(MediaAsset, m.annotated_of) if m.annotated_of else None
        request = mission.prompt if mission else None
        await _emit(m, "media.analyzing", {"status": "analyzing"})
        with telemetry.usage_scope(f"media:{m.kind.value}") as usage:
            try:
                await _step(m, {MediaKind.audio: "Listening to the voice note"}.get(m.kind) or
                            ("Looking at the image" if m.kind in IMAGE_KINDS else "Watching the recording"))
                obs = await _timed(perceive(m, original=original, request=request))
                for mo in [x for x in obs.moments if x.is_problem][:2]:
                    if m.kind not in IMAGE_KINDS and m.kind != MediaKind.audio:
                        await _step(m, f"Reading the screen at {fmt_t(mo.t)}")

                await _step(m, "Checking what NoX Shield allows")
                verdict = await shield.screen_source(f"capture {m.id}", screened_text(obs, m.caption), org_id=m.org_id)
                if verdict.blocked and shield.mode() == "enforce":
                    m.status, m.status_reason = MediaStatus.withheld, verdict.reason
                    m.observation, m.analyzed_at = None, now_utc_naive()
                    await db.commit()
                    await _emit(m, "media.withheld", {"status": "withheld", "reason": m.status_reason})
                    if mission:
                        await record(db, mission, "media.withheld", {"mediaId": str(m.id), "reason": m.status_reason})
                    return
                obs = redact_observation(obs)
                m.caption = shield.redact(m.caption) if m.caption else m.caption
                m.observation = obs.model_dump()
                await db.commit()

                apps, home = await _scope(db, m, mission)
                g = await _timed(ground(m, obs, apps=apps, home_app=home, request=request)) if apps else MediaGrounding(
                    open_questions=["No application knowledge base is available to check this against yet."])
                m.grounding = g.model_dump()
                m.views = await _timed(seat_views(obs, g)) if apps else fallback_views(obs, g)
            except Exception as e:
                logger.exception(f"media {m.id} analysis failed")
                await db.rollback()
                m = await db.get(MediaAsset, uuid.UUID(media_id))
                m.status = MediaStatus.failed
                m.status_reason = ("NoX took too long watching this." if isinstance(e, TimeoutError)
                                   else "NoX couldn't watch this capture.") + " Try again."
                await db.commit()
                await _emit(m, "media.failed", {"status": "failed", "reason": m.status_reason})
                return
        m.usage = {**usage.summary(), "line": usage.line()}
        m.status, m.status_reason, m.analyzed_at = MediaStatus.ready, None, now_utc_naive()
        await db.commit()
        await db.refresh(m, ["mission_id"])  # a draft may have been launched into a mission while NoX watched
        if m.mission_id and mission is None:
            mission = await db.get(Mission, m.mission_id)
        await _step(m, "Done")
        await _emit(m, "media.ready", {"status": "ready"})
        if mission:
            await record(db, mission, "media.analyzed", {"mediaId": str(m.id), "kind": m.kind.value, "summary": obs.summary[:200]})
            await sync_evidence(db, mission, m)


# ── Evidence for drafting and co-writing ────────────────────────────────────

@dataclass
class MediaEvidence:
    id: str
    label: str                       # "1:12 screen recording"
    caption: str | None
    observation: dict
    grounding: dict = field(default_factory=dict)
    attached: bool = False           # attached to the chat message being answered
    still: bool = False              # a screenshot or image: cited whole, it has no moments


async def mission_evidence(db, mission_id, attached: list[str] | None = None) -> list[MediaEvidence]:
    rows = (await db.execute(select(MediaAsset).where(MediaAsset.mission_id == mission_id, MediaAsset.status == MediaStatus.ready)
                             .order_by(MediaAsset.created_at))).scalars().all()
    wanted = set(attached or [])
    return [MediaEvidence(id=str(r.id), label=describe(r), caption=r.caption, observation=r.observation or {},
                          grounding=r.grounding or {}, attached=str(r.id) in wanted,
                          still=r.kind in IMAGE_KINDS) for r in rows]


def render_evidence(evidence: list[MediaEvidence], role: Role) -> str:
    """The prompt block for a file's writer. Code locations and contracts never reach the business or product files."""
    blocks = []
    code_ok = role in CODE_SEATS
    for ev in evidence:
        o, g = ev.observation, ev.grounding
        head = f"===== What the author showed (capture {ev.id}, {ev.label}{', attached to this message' if ev.attached else ''}) ====="
        lines = [head, f"Summary: {o.get('summary', '')}"]
        if ev.caption:
            lines.append(f'Author\'s note: "{ev.caption}"')
        moments = [f"{fmt_t(mo.get('t'))} {mo.get('what', '')}" + (" (problem)" if mo.get("is_problem") else "")
                   + (f" — on screen: {'; '.join(repr(s) for s in mo.get('screen_text', [])[:3])}" if mo.get("screen_text") else "")
                   for mo in o.get("moments", [])]
        if moments:
            lines.append("Moments: " + " | ".join(moments))
        if o.get("expected") or o.get("actual"):
            lines.append(f"Expected: {o.get('expected') or '—'} / Actual: {o.get('actual') or '—'}")
        if o.get("steps"):
            lines.append("Steps seen: " + "; ".join(o["steps"]))
        if o.get("marked_area"):
            lines.append(f"The author marked: {o['marked_area']}")
        kb = [f"- {f.get('says', '')} [[kb:{f.get('ref', '')}]] ({f.get('relevance', '')})" for f in g.get("findings", [])]
        if g.get("explanation") or kb:
            lines.append("What the knowledge base says: " + (g.get("explanation") or ""))
            lines += kb
        if code_ok and g.get("code"):
            lines.append("Code locations: " + "; ".join(f"{c['location']} ({c['app']})" for c in g["code"]))
        if code_ok and g.get("contracts"):
            lines.append("Contracts touched: " + "; ".join(f"{c['identifier']} ({c['app']}, {c['direction']})" for c in g["contracts"]))
        if g.get("open_questions"):
            lines.append("Open questions: " + " | ".join(g["open_questions"]))
        cite = f"Cite this capture as [[media:{ev.id}]] at the end of each statement it backs, so readers can open it"
        lines.append(cite + ("." if ev.still else f"; cite a moment in it as [[media:{ev.id}#t=<seconds>]]."))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


async def wait_for_analysis(db, mission_id, timeout: float = 90.0) -> None:
    """Hold a first draft until the captures NoX is still watching are analysed, so the draft can use and cite them."""
    busy = (await db.execute(select(MediaAsset.id).where(MediaAsset.mission_id == mission_id,
                                                          MediaAsset.status == MediaStatus.analyzing))).scalars().all()
    await wait_ready([str(i) for i in busy], timeout)


async def wait_ready(media_ids: list[str], timeout: float = 90.0) -> None:
    """Hold a chat turn until its attached captures are analysed (or the wait runs out)."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    ids = [uuid.UUID(i) for i in media_ids]
    while ids and loop.time() < deadline:
        async with AsyncSessionLocal() as db:
            busy = (await db.execute(select(MediaAsset.id).where(MediaAsset.id.in_(ids),
                                                                  MediaAsset.status.in_([MediaStatus.uploading, MediaStatus.analyzing])))).scalars().all()
        if not busy:
            return
        await asyncio.sleep(1)


# ── Git: a text sidecar per capture (video and audio are too big to commit) ─

def sidecar(mission: Mission, m: MediaAsset, uploader: str) -> str:
    o, g = m.observation or {}, m.grounding or {}
    lines = [
        f"# Capture {m.id}: {describe(m)}",
        "",
        f"Shown by {uploader} ({m.uploaded_as.value} seat) on {m.created_at:%Y-%m-%d}. "
        f"[Open in NoX]({settings.NOX_WEB_ORIGIN.split(',')[0].rstrip('/')}/app/missions/{mission.key}?media={m.id})",
        "", "## Summary", "", o.get("summary", ""),
    ]
    if m.caption:
        lines += ["", f"_Author's note:_ {m.caption}"]
    if o.get("moments"):
        lines += ["", "## Key moments", ""] + [f"- {fmt_t(x.get('t'))} {x.get('what', '')}" for x in o["moments"]]
    if o.get("transcript"):
        lines += ["", "## Transcript", ""] + [f"- {fmt_t(x.get('t'))} {x.get('speaker') + ': ' if x.get('speaker') else ''}{x.get('text', '')}" for x in o["transcript"]]
    if g.get("findings") or g.get("explanation"):
        lines += ["", "## What the knowledge base says", ""] + ([g["explanation"], ""] if g.get("explanation") else [])
        lines += [f"- [[kb:{f['ref']}]]: {f.get('says', '')}" for f in g.get("findings", [])]
    if g.get("code"):
        lines += ["", "## Code locations", ""] + [f"- `{c['location']}` ({c['app']})" for c in g["code"]]
    return "\n".join(lines) + "\n"


async def sync_evidence(db, mission: Mission, m: MediaAsset) -> None:
    """Mirror a capture to the mission's folder in Git: images as files, everything as a text sidecar. Best-effort."""
    from .gitsync import branch, commit_asset, mission_dir, repo_full_name

    if not settings.NOX_COMMIT_SPECS or not mission.primary_kb_id:
        return
    mission = (await db.execute(select(Mission).options(selectinload(Mission.files)).where(Mission.id == mission.id))).scalars().first()
    kb = await db.get(KnowledgeBase, mission.primary_kb_id)
    repo = repo_full_name(kb)
    if not repo:
        return
    from .gitsync import _commit

    user = await db.get(User, m.uploaded_by)
    try:
        if m.kind in IMAGE_KINDS:
            data = await asyncio.to_thread(media_storage.read_bytes, m.storage_uri)
            await commit_asset(db, mission, f"{m.id}.{media_storage.EXT.get(media_storage.base_mime(m.mime), 'bin')}", data)
        await asyncio.to_thread(_commit, repo, {f"{mission_dir(mission)}/evidence/{m.id}.md": sidecar(mission, m, (user.name or user.email) if user else "someone")},
                                f"{mission.key}: evidence {describe(m)}", branch(mission))
    except Exception as e:
        logger.warning(f"evidence sync for {mission.key}/{m.id} failed: {e}")


async def remove_evidence(db, mission: Mission, m: MediaAsset) -> None:
    """Take a deleted capture's sidecar (and image) off the mission branch. Best-effort."""
    from .gitsync import branch, mission_dir, repo_full_name

    if not settings.NOX_COMMIT_SPECS or not mission.primary_kb_id:
        return
    mission = (await db.execute(select(Mission).options(selectinload(Mission.files)).where(Mission.id == mission.id))).scalars().first()
    repo = repo_full_name(await db.get(KnowledgeBase, mission.primary_kb_id))
    if not repo:
        return
    paths = [f"{mission_dir(mission)}/evidence/{m.id}.md"]
    if m.kind in IMAGE_KINDS:
        paths.append(f"{mission_dir(mission)}/assets/{m.id}.{media_storage.EXT.get(media_storage.base_mime(m.mime), 'bin')}")

    def drop() -> None:
        from github import GithubException

        from ..services.gitops import get_github_client

        r = get_github_client().get_repo(repo)
        for path in paths:
            try:
                f = r.get_contents(path, ref=branch(mission))
                r.delete_file(path, f"{mission.key}: remove capture {m.id}", f.sha, branch=branch(mission))
            except GithubException:
                continue

    try:
        await asyncio.to_thread(drop)
    except Exception as e:
        logger.warning(f"evidence removal for {mission.key}/{m.id} failed: {e}")


# ── Show it works ───────────────────────────────────────────────────────────

COMPARE = """Someone is verifying that a change works. The first capture(s) show the problem as it was reported
(before); the last one shows the system after the change (after). For each checklist item, say what the after
capture shows about it: "Seen at 0:18: status turns Settled after the partial fill", or "Not shown in the
recording". Times are seconds into the after capture. Set `seen` only when the item is plainly shown working.
Describe only what is seen or heard. You never decide whether an item is met: a person ticks every item."""


async def compare_evidence(mission_id: str, role: Role, after_ids: list[str], actor_id: uuid.UUID | None) -> None:
    from .verification import parse_checklist

    await wait_ready(after_ids)
    async with AsyncSessionLocal() as db:
        mission = (await db.execute(select(Mission).options(selectinload(Mission.files)).where(Mission.id == uuid.UUID(mission_id)))).scalars().first()
        if not mission:
            return
        f = next(x for x in mission.files if x.role == role)
        items = (f.verification or {}).get("items") or parse_checklist(f.markdown)
        rows = (await db.execute(select(MediaAsset).where(MediaAsset.mission_id == mission.id, MediaAsset.status == MediaStatus.ready)
                                 .order_by(MediaAsset.created_at))).scalars().all()
        after = [r for r in rows if str(r.id) in after_ids]
        before = [r for r in rows if str(r.id) not in after_ids][:2]
        actor = await db.get(User, actor_id) if actor_id else None
        await broadcast_transient(mission.id, "evidence.comparing", {"role": role.value})
        if not after:
            await record(db, mission, "evidence.compare_failed", {"role": role.value, "error": "The after capture isn't ready"}, actor, role.value)
            return
        checklist = "\n".join(f"{i}. {it['text']}" for i, it in enumerate(items))
        prompt = (f"Mission {mission.key}: {mission.prompt}\nBefore: {', '.join(describe(b) for b in before) or 'none'}. "
                  f"After: {describe(after[-1])}.\nChecklist:\n{checklist or '(no items)'}")
        with telemetry.usage_scope("media:compare") as usage:
            try:
                parts = [_with_clip(await _file_part(x, x.storage_uri, x.mime, x.bytes), x) for x in [*before, after[-1]]]
                result = await _timed(structured.ask(EvidenceComparison, prompt, name="nox_media_compare", instruction=COMPARE,
                                                     tier=config.Tier.DEFAULT, parts=parts))
            except Exception as e:
                logger.exception("evidence comparison failed")
                await record(db, mission, "evidence.compare_failed", {"role": role.value, "error": str(e)[:200]}, actor, role.value)
                return
        hints = [h.model_dump() for h in result.hints if 0 <= h.index < len(items)]
        f.verification = {**(f.verification or {}), "hints": hints,
                          "evidence": {"after": [str(a.id) for a in after], "before": [str(b.id) for b in before],
                                       "summary": result.summary, "usage": usage.line()}}
        await db.commit()
        await record(db, mission, "evidence.compared", {"role": role.value, "hints": len(hints), "after": str(after[-1].id)}, actor, role.value)
