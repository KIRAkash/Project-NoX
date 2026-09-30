"""Endpoints for the `nox` CLI and the /nox skill in coding agents.

Login is a device flow: the CLI asks for a code, the person approves it in the browser while signed in,
and the CLI collects a personal API token (`nox_…`). Only its hash is stored.
"""

import json
import logging
import re
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor, current_actor, current_user, hash_api_token
from ..core.config import settings
from ..db.database import get_db
from ..db.models import ApiToken, ExternalLink, Role, User
from ..jobs import spawn
from ..missions.context import kb_context
from ..missions.gitsync import slug
from ..missions.jira_sync import mission_url
from ..missions.prs import guard_pr, parse_pr_url, upsert_pr_link
from ..missions.templates import TITLE
from .missions import load_mission, mission_apps, mission_json

logger = logging.getLogger(__name__)
router = APIRouter(tags=["CLI"])

DEVICE_TTL = 600
_memory: dict[str, tuple[float, str]] = {}  # used only when Redis is unreachable


# ── Tiny TTL store: Redis, or process memory as a fallback ──────────────────


async def _redis():
    import redis.asyncio as aioredis

    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def _put(key: str, value: dict, ttl: int = DEVICE_TTL) -> None:
    try:
        r = await _redis()
        await r.set(key, json.dumps(value), ex=ttl)
        await r.aclose()
    except Exception:
        _memory[key] = (time.time() + ttl, json.dumps(value))


async def _get(key: str) -> dict | None:
    try:
        r = await _redis()
        raw = await r.get(key)
        await r.aclose()
    except Exception:
        exp, raw = _memory.get(key, (0, None))
        raw = raw if exp > time.time() else None
    return json.loads(raw) if raw else None


async def _delete(key: str) -> None:
    try:
        r = await _redis()
        await r.delete(key)
        await r.aclose()
    except Exception:
        _memory.pop(key, None)


# ── Personal API tokens ─────────────────────────────────────────────────────


def new_token() -> str:
    return "nox_" + secrets.token_urlsafe(32)


class TokenCreate(BaseModel):
    name: str = Field(default="cli", min_length=1, max_length=60)


@router.post("/api/v1/me/tokens")
async def create_token(body: TokenCreate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    raw = new_token()
    row = ApiToken(user_id=user.id, name=body.name, token_hash=hash_api_token(raw))
    db.add(row)
    await db.commit()
    return {"id": str(row.id), "name": row.name, "token": raw}


@router.get("/api/v1/me/tokens")
async def list_tokens(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ApiToken).where(ApiToken.user_id == user.id).order_by(ApiToken.created_at.desc()))).scalars().all()
    return [{"id": str(t.id), "name": t.name, "createdAt": t.created_at.isoformat(), "lastUsedAt": t.last_used_at.isoformat() if t.last_used_at else None} for t in rows]


@router.delete("/api/v1/me/tokens/{token_id}", status_code=204)
async def revoke_token(token_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(ApiToken, token_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "Not found")
    await db.delete(row)
    await db.commit()


# ── Device login ────────────────────────────────────────────────────────────


class DeviceStart(BaseModel):
    name: str = Field(default="nox CLI", max_length=60)


@router.post("/api/v1/cli/device")
async def device_start(body: DeviceStart):
    device_code = secrets.token_urlsafe(24)
    alphabet = "BCDFGHJKLMNPQRSTVWXZ"
    user_code = "".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4))
    await _put(f"nox:device:{device_code}", {"userCode": user_code, "name": body.name})
    await _put(f"nox:device-user:{user_code}", {"deviceCode": device_code, "name": body.name})
    origin = settings.NOX_WEB_ORIGIN.split(",")[0].strip().rstrip("/")
    return {"deviceCode": device_code, "userCode": user_code, "verifyUrl": f"{origin}/cli/authorize/{user_code}", "interval": 2, "expiresIn": DEVICE_TTL}


class DeviceApprove(BaseModel):
    user_code: str = Field(alias="userCode", min_length=9, max_length=9)


@router.get("/api/v1/cli/device/{user_code}")
async def device_info(user_code: str, user: User = Depends(current_user)):
    pending = await _get(f"nox:device-user:{user_code.upper()}")
    if not pending:
        raise HTTPException(404, "This code has expired. Run `nox login` again.")
    return {"userCode": user_code.upper(), "name": pending["name"]}


@router.post("/api/v1/cli/device/approve")
async def device_approve(body: DeviceApprove, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    code = body.user_code.upper()
    pending = await _get(f"nox:device-user:{code}")
    if not pending:
        raise HTTPException(404, "This code has expired. Run `nox login` again.")
    raw = new_token()
    db.add(ApiToken(user_id=user.id, name=pending["name"], token_hash=hash_api_token(raw)))
    await db.commit()
    await _put(f"nox:device:{pending['deviceCode']}", {"userCode": code, "token": raw, "email": user.email}, ttl=120)
    await _delete(f"nox:device-user:{code}")
    return {"approved": True}


class DevicePoll(BaseModel):
    device_code: str = Field(alias="deviceCode")


@router.post("/api/v1/cli/device/token")
async def device_token(body: DevicePoll):
    state = await _get(f"nox:device:{body.device_code}")
    if not state:
        raise HTTPException(410, "expired")
    if "token" not in state:
        raise HTTPException(428, "pending")
    await _delete(f"nox:device:{body.device_code}")
    return {"token": state["token"], "email": state.get("email")}


# ── Mission context for coding agents ───────────────────────────────────────


@router.get("/api/v1/cli/missions/{key}/context")
async def mission_context(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Everything an agent needs to build the mission: the four spec files, the KB brief and pages, contracts, links."""
    return await build_mission_context(db, actor, key)


async def build_mission_context(db: AsyncSession, actor: Actor, key: str) -> dict:
    """What `nox context` prints and MCP's `get_mission` returns."""
    mission = await load_mission(db, actor, key)
    apps = await mission_apps(db, mission)
    j = mission_json(mission, apps, with_bodies=True)
    branch = f"{mission.key.lower()}-{slug(mission.title)[:40].strip('-')}"
    parts = [
        f"# {mission.key}: {mission.title}",
        f"Stage: **{mission.stage.value}** · Type: {mission.type} · Apps: {', '.join(a.app_name for a in apps) or '—'}",
        f"Mission page: {mission_url(mission)}",
        f'Request: "{mission.prompt}"',
        "## How to work on this mission",
        "\n".join([
            "1. Read the four spec files below. The build spec (developer file) is the plan; the others are the why and the limits.",
            "2. Plan against the build spec's Tasks, reuse what 'What to reuse' names, and leave the listed contracts untouched unless the engineering design says otherwise.",
            f"3. Work on a branch named `{branch}` and put `{mission.key}` in the PR title — NoX links the PR to this mission and posts a guard comment.",
            "4. Run the Test plan. Then tick nothing yourself: the humans verify each file's checklist in NoX after the developer marks the mission completed.",
        ]),
    ]
    for f in j["files"]:
        status = f["status"].replace("_", " ")
        parts.append(f"## {TITLE[Role(f['role'])]} — {f['fileName']} ({status})")
        parts.append(f["markdown"].strip() or "_Not written yet._")
    jira = [link for link in mission.links if link.system == "jira"]
    prs = [link for link in mission.links if link.system == "github_pr"]
    if jira or prs:
        parts.append("## Links")
        parts += [f"- Jira {link.external_id}: {(link.state or {}).get('summary', '')} ({(link.state or {}).get('status', '?')}) {link.url or ''}" for link in jira]
        parts += [f"- PR {link.external_id}: {(link.state or {}).get('title', '')} ({(link.state or {}).get('state', '?')}) {link.url or ''}" for link in prs]
    parts.append("## Knowledge base")
    parts.append(await kb_context(db, [a.id for a in apps], f"{mission.title} {mission.prompt}", budget=30000))
    return {"key": mission.key, "title": mission.title, "stage": mission.stage.value, "branch": branch, "url": mission_url(mission), "markdown": "\n\n".join(parts)}


class PrLink(BaseModel):
    url: str


@router.post("/api/v1/cli/missions/{key}/prs")
async def link_pr(key: str, body: PrLink, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Link a PR to the mission (the webhook does this on its own when the PR names NOX-n) and run the guard."""
    mission = await load_mission(db, actor, key)
    try:
        full_name, number = parse_pr_url(body.url)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    await upsert_pr_link(db, mission, full_name, {"number": number, "html_url": body.url.split("#")[0], "state": "open"}, actor.user, actor.role.value)
    spawn(f"guard {full_name}#{number}", guard_pr, mission.id, full_name, number)
    mission = await load_mission(db, actor, key)
    return mission_json(mission, await mission_apps(db, mission), with_bodies=False)


_ = ExternalLink


# ── Knowledge-base search and read ──────────────────────────────────────────


async def _visible_kbs(db: AsyncSession, actor: Actor, app: str | None):
    """Kept for callers of the CLI router; the one implementation is `services/scope.visible_kbs`."""
    from ..services.scope import visible_kbs

    return await visible_kbs(db, actor.user, app)


@router.get("/api/v1/cli/kb/search")
async def kb_search(q: str, app: str | None = None, limit: int = 8, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Ranked pages across the knowledge bases the caller can see (or one app's): hybrid search, keyword fallback."""
    from ..missions.context import rank_pages
    from ..services.local_storage import load_checkpoint_json
    from ..services.search import search

    def snippet(content: str) -> str:
        body = re.sub(r"<!--.*?-->", "", content, flags=re.S)
        return "\n".join(line for line in body.splitlines() if line.strip() and not line.startswith(("---", "#")))[:300]

    kbs = await _visible_kbs(db, actor, app)
    try:
        found = await search(db, q, [kb.id for kb in kbs], k=limit)
    except Exception:
        await db.rollback()
        found = []
    if found:
        return [{"app": h.app_name, "path": h.path, "ref": h.ref, "rank": i, "snippet": snippet(h.content)} for i, h in enumerate(found)]

    hits = []
    for kb in kbs:
        files = load_checkpoint_json(str(kb.id), "compiled_files.json") or {}
        for rank, (path, content) in enumerate(rank_pages(files, q, k=limit)):
            hits.append({"app": kb.app_name, "path": path, "ref": f"{kb.app_name}/{path.removesuffix('.md')}", "rank": rank, "snippet": snippet(content)})
    hits.sort(key=lambda h: h["rank"])
    return hits[:limit]


@router.get("/api/v1/cli/kb/read")
async def kb_read(ref: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """One page by `app/path` (the `.md` is optional) — the same form as `[[kb:app/path]]` links."""
    from ..services.local_storage import load_checkpoint_json

    ref = ref.removeprefix("kb:").split("|")[0].strip("/")
    app, _, path = ref.partition("/")
    kbs = await _visible_kbs(db, actor, app)
    if not kbs or not path:
        raise HTTPException(404, f"No knowledge base page {ref}")
    files = load_checkpoint_json(str(kbs[0].id), "compiled_files.json") or {}
    content = files.get(path) or files.get(f"{path}.md")
    if content is None:
        raise HTTPException(404, f"No knowledge base page {ref}")
    return {"app": app, "path": path if path in files else f"{path}.md", "markdown": content}


class LocalKBPush(BaseModel):
    """Pages a developer built with NoX Local (Gemma, on their machine). Markdown only: never source code."""

    app: str = Field(min_length=1, max_length=200)
    files: dict[str, str]
    meta: dict = Field(default_factory=dict)


_PUSH_PATH = re.compile(r"^(?!/)(?!.*\.\.)[A-Za-z0-9_./-]{1,200}\.md$")


@router.post("/api/v1/cli/kb/push")
async def kb_push(body: LocalKBPush, request: Request, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    """Publish a locally built knowledge base: lint, contracts, search index and a KB pull request."""
    from ..agents.runner import run_local_publish
    from ..core.auth import Cap
    from ..services.sse import get_sse_manager

    if not actor.can(Cap.MANAGE_SOURCES):
        raise HTTPException(403, "Your role can't update knowledge bases")
    kbs = await _visible_kbs(db, actor, body.app)
    if not kbs:
        raise HTTPException(404, f"No application '{body.app}' in your orgs. Onboard it in Atlas first.")
    bad = [p for p in body.files if not _PUSH_PATH.match(p)]
    if bad or not body.files:
        raise HTTPException(422, f"Pages must be relative .md paths; got {bad[:3] or 'none'}")
    if len(body.files) > 400 or sum(len(v) for v in body.files.values()) > 4_000_000:
        raise HTTPException(413, "Too many pages or too much text in one push")
    meta = {k: body.meta.get(k) for k in ("model", "commit", "mode", "built_at", "interfaces")}
    sse = getattr(request.app.state, "sse_manager", None) or get_sse_manager()
    try:
        return await run_local_publish(str(kbs[0].id), body.files, meta, db, sse)
    except Exception as e:
        logger.exception("local KB push failed")
        raise HTTPException(502, f"NoX received the pages but couldn't open the KB pull request: {e}") from e
