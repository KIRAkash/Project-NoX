"""Hand off to Jules: the developer gives a mission's build to Jules, Google's asynchronous coding agent.

    readiness → start (prompt from the mission context, Shield, create session) → poll → PR linked and guarded

People still decide. Jules plans first by default and waits; the developer approves the plan in NoX (or replies).
Jules's pull request is linked to the mission and guarded like any other, and the developer still reviews it and
marks the mission completed before the seats verify in reverse.

A session is an `external_links` row with `system="jules"` and the session id; its `state` holds what NoX shows
(state, plan, Jules's open question, PR, who started it). Polling is a job: a watcher spawned at start, the
`jules_tick` on Celery beat as the safety net, and a lazy refresh when the mission page asks and the state is
stale. Polling is idempotent, so overlapping pollers do no harm.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db.models import ExternalLink, KnowledgeBase, Mission, MissionApp, MissionStage, Role, SourceMonitor
from ..integrations import jules as api
from ..jobs import spawn
from .events import broadcast_transient, record

logger = logging.getLogger(__name__)

SOURCES_TTL = 300          # seconds the list of repositories Jules can see is cached
POLL_EVERY = 20            # seconds between polls while a watcher runs
STALE_AFTER = 30           # a page load refreshes a session not polled for this long
GIVE_UP_AFTER = timedelta(hours=12)
KB_BUDGET = 12000          # characters of knowledge-base context in the prompt

LABEL = {
    "QUEUED": "Jules is planning", "PLANNING": "Jules is planning", "AWAITING_PLAN_APPROVAL": "Plan ready for you",
    "AWAITING_USER_FEEDBACK": "Jules has a question", "IN_PROGRESS": "Jules is building", "PAUSED": "Paused",
    "COMPLETED": "PR opened", "FAILED": "Failed",
}

_sources_cache: tuple[float, dict[str, dict]] | None = None


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


async def _sources(client: api.JulesClient) -> dict[str, dict]:
    global _sources_cache
    if _sources_cache and time.monotonic() - _sources_cache[0] < SOURCES_TTL:
        return _sources_cache[1]
    found = {s.get("name"): s for s in await client.list_sources() if s.get("name")}
    _sources_cache = (time.monotonic(), found)
    return found


def forget_sources() -> None:
    global _sources_cache
    _sources_cache = None


def _default_branch(source: dict | None) -> str:
    repo = (source or {}).get("githubRepo") or {}
    branch = repo.get("defaultBranch")
    return (branch.get("displayName") if isinstance(branch, dict) else branch) or "main"


async def mission_repos(db: AsyncSession, mission: Mission) -> list[dict]:
    """The GitHub repositories of the mission's applications (the code Flow B watches), one entry per repo."""
    rows = (await db.execute(
        select(KnowledgeBase.app_name, SourceMonitor.repo_url)
        .join(MissionApp, MissionApp.kb_id == KnowledgeBase.id)
        .join(SourceMonitor, SourceMonitor.kb_id == KnowledgeBase.id)
        .where(MissionApp.mission_id == mission.id, SourceMonitor.source_type == "github")
    )).all()
    out, seen = [], set()
    for app, url in rows:
        source = api.source_name(url)
        if source and source not in seen:
            seen.add(source)
            out.append({"app": app, "repo": api.repo_of(source), "source": source, "connected": False, "branch": "main"})
    return out


async def readiness(db: AsyncSession, mission: Mission) -> dict:
    """Whether the developer can hand this mission to Jules, and if not, why and where to fix it."""
    repos = await mission_repos(db, mission)
    if not api.configured():
        return {"state": "not_configured", "repos": repos,
                "detail": "Jules isn't connected. An engineering lead adds it in Atlas → Connectors."}
    if not repos:
        return {"state": "no_repo", "repos": repos,
                "detail": "This mission's applications have no GitHub repository in NoX, so Jules has nothing to work on."}
    try:
        async with api.JulesClient() as client:
            sources = await _sources(client)
    except api.JulesAuthError:
        return {"state": "failing", "repos": repos,
                "detail": "Jules is connected but rejected NoX's key. Check it in Atlas → Connectors."}
    except (api.JulesError, httpx.HTTPError) as e:
        return {"state": "failing", "repos": repos,
                "detail": f"Jules is connected but not answering ({str(e)[:120]}). Check it in Atlas → Connectors."}
    for r in repos:
        r["connected"] = r["source"] in sources
        r["branch"] = _default_branch(sources.get(r["source"]))
    if not any(r["connected"] for r in repos):
        names = ", ".join(r["repo"] for r in repos[:3])
        return {"state": "repo_not_connected", "repos": repos,
                "detail": f"Jules can't see {names}. Install the Jules GitHub app on it from jules.google."}
    return {"state": "ready", "repos": repos, "detail": ""}


def session_json(link: ExternalLink) -> dict:
    s = link.state or {}
    state = s.get("state") or "QUEUED"
    label = LABEL.get(state, state.replace("_", " ").title())
    if state == "COMPLETED" and not s.get("prUrl"):
        label = "Finished without a PR"
    return {
        "id": link.external_id, "url": link.url, "repo": s.get("repo"), "branch": s.get("branch"), "state": state,
        "label": label, "active": state in api.ACTIVE, "plan": s.get("plan") or [], "planApproved": bool(s.get("planApproved")),
        "requirePlanApproval": bool(s.get("requirePlanApproval")), "progress": s.get("progress"),
        "question": s.get("message") if state == "AWAITING_USER_FEEDBACK" else None, "message": s.get("message"),
        "prUrl": s.get("prUrl"), "reason": s.get("reason"), "startedBy": s.get("startedBy"), "startedAt": s.get("startedAt"),
        "polledAt": s.get("polledAt"),
    }


def sessions(mission: Mission) -> list[ExternalLink]:
    return sorted((link for link in mission.links if link.system == "jules"),
                  key=lambda link: (link.state or {}).get("startedAt") or "", reverse=True)


async def jules_prompt(db: AsyncSession, actor, mission: Mission, repo: str) -> str:
    from ..routers.cli import build_mission_context

    ctx = await build_mission_context(db, actor, mission.key, kb_budget=KB_BUDGET, how_to=False)
    rules = "\n".join([
        f"- Work only in this repository ({repo}). Put `{mission.key}` at the start of the pull request title, e.g. "
        f"`{mission.key}: {mission.title}`, and list the build spec's Tasks in the PR description.",
        "- The build spec (developer file) is the plan: follow its Tasks and Test plan. The other spec files are the why and the limits.",
        "- Contracts the engineering design marks unchanged stay unchanged.",
        "- Follow every item under \"Team lessons\" if the context has them: people taught them to NoX on earlier missions.",
        "- Don't edit the spec files and don't tick verification checklists: people verify in NoX after the developer reviews your PR.",
        "- If this repository's tests can't run in your environment (some are reference code), say so in the PR description instead of changing the build setup.",
        "- If something in the specs is unclear, ask instead of guessing.",
    ])
    return (f"# Hand-off from NoX: {mission.key}\n\n"
            "People wrote and approved the four spec files below in NoX, one per seat (business user, product owner, "
            "engineering lead, developer). Build the change they describe.\n\n"
            f"## Rules\n{rules}\n\n{ctx['markdown']}")


def _clean_prompt(text: str, mission: Mission) -> str:
    """Secrets out before anything leaves NoX: withheld like in KB pages, then the regex + DLP gate."""
    from ..agents.linter import SecretLeakError, assert_no_secrets, redact_secrets

    cleaned, _ = redact_secrets({"jules": text})
    try:
        assert_no_secrets(cleaned)
    except SecretLeakError as e:
        raise HTTPException(409, f"NoX Shield stopped the hand-off: {str(e).removeprefix('Blocked commit: ')}") from e
    return cleaned["jules"]


async def start(db: AsyncSession, actor, mission: Mission, repo: str | None, require_plan_approval: bool = True) -> dict:
    if actor.role != Role.developer:
        raise HTTPException(403, "The developer hands a mission to Jules")
    if mission.stage != MissionStage.build:
        raise HTTPException(409, "Only a mission in Build can go to Jules")
    ready = await readiness(db, mission)
    if ready["state"] != "ready":
        raise HTTPException(409, ready["detail"])
    connected = [r for r in ready["repos"] if r["connected"]]
    target = next((r for r in connected if r["repo"].lower() == (repo or "").lower()), None) if repo else connected[0]
    if not target:
        raise HTTPException(409, f"Jules can't see {repo}. Install the Jules GitHub app on it from jules.google.")
    if any((link.state or {}).get("repo") == target["repo"] and (link.state or {}).get("state") in api.ACTIVE for link in sessions(mission)):
        raise HTTPException(409, f"Jules is already working on {target['repo']} for this mission")

    prompt = _clean_prompt(await jules_prompt(db, actor, mission, target["repo"]), mission)
    try:
        async with api.JulesClient() as client:
            session = await client.create_session(prompt=prompt, title=f"{mission.key}: {mission.title}"[:120],
                                                  source=target["source"], starting_branch=target["branch"],
                                                  require_plan_approval=require_plan_approval)
    except api.JulesError as e:
        raise HTTPException(502, f"Jules didn't start the session: {e}") from e
    sid = api.session_id(session)
    who = actor.user.name or actor.user.email
    link = ExternalLink(mission_id=mission.id, system="jules", external_id=sid,
                        url=session.get("url") or api.WEB_URL.format(id=sid), primary=False,
                        state={"state": session.get("state") or "QUEUED", "repo": target["repo"], "branch": target["branch"],
                               "requirePlanApproval": require_plan_approval, "startedBy": who, "startedAt": _now(),
                               "seen": [], "polledAt": None})
    db.add(link)
    await db.commit()
    await record(db, mission, "jules.started", {"session": sid, "repo": target["repo"], "planFirst": require_plan_approval},
                 actor.user, actor.role.value)
    spawn(f"jules watch {sid}", watch, mission.id, sid)
    return session_json(link)


# ── Polling ──────────────────────────────────────────────────────────────────


async def _activities(client: api.JulesClient, sid: str, pages: int = 4) -> list[dict]:
    out, token = [], None
    for _ in range(pages):
        page = await client.list_activities(sid, token)
        out += page.get("activities") or []
        token = page.get("nextPageToken")
        if not token:
            break
    return out


async def poll(db: AsyncSession, mission: Mission, link: ExternalLink, client: api.JulesClient) -> bool:
    """Read the session and its new activities; update the link and record what people need to know."""
    s = dict(link.state or {})
    before = s.get("state")
    session = await client.get_session(link.external_id)
    state = session.get("state") or before or "QUEUED"
    seen = list(s.get("seen") or [])
    events: list[tuple[str, dict]] = []
    for act in await _activities(client, link.external_id):
        aid = act.get("id") or act.get("name")
        if not aid or aid in seen:
            continue
        seen.append(aid)
        if plan := (act.get("planGenerated") or {}).get("plan"):
            s["plan"] = [{"title": st.get("title", ""), "description": st.get("description", "")}
                         for st in sorted(plan.get("steps") or [], key=lambda st: st.get("index", 0))]
        elif "planApproved" in act:
            s["planApproved"] = True
        elif msg := (act.get("agentMessaged") or {}).get("agentMessage"):
            s["message"] = msg[:2000]
            events.append(("jules.message", {"session": link.external_id, "text": msg[:400]}))
        elif prog := act.get("progressUpdated"):
            s["progress"] = (prog.get("title") or prog.get("description") or "")[:200]
            await broadcast_transient(mission.id, "jules.progress", {"session": link.external_id, "text": s["progress"]})
        elif failed := act.get("sessionFailed"):
            s["reason"] = (failed.get("reason") or "")[:500]
    s["seen"] = seen[-300:]
    s["state"] = state
    s["polledAt"] = _now()
    if state != before:
        if state == "AWAITING_PLAN_APPROVAL":
            events.append(("jules.plan_ready", {"session": link.external_id, "steps": len(s.get("plan") or [])}))
        elif state == "AWAITING_USER_FEEDBACK" and not any(t == "jules.message" for t, _ in events):
            events.append(("jules.question", {"session": link.external_id}))
        elif state == "FAILED":
            events.append(("jules.failed", {"session": link.external_id, "reason": s.get("reason") or "Jules stopped"}))
        elif state == "COMPLETED":
            s["prUrl"] = api.pr_url(session)
            events.append(("jules.pr_opened" if s["prUrl"] else "jules.finished", {"session": link.external_id, "pr": s.get("prUrl")}))
    link.state = s
    await db.commit()
    for type_, payload in events:
        await record(db, mission, type_, payload)
    if state == "COMPLETED" and s.get("prUrl") and before != "COMPLETED":
        await _link_pr(db, mission, s["prUrl"])
    return state != before or bool(events)


async def _link_pr(db: AsyncSession, mission: Mission, url: str) -> None:
    from .prs import guard_pr, parse_pr_url, upsert_pr_link

    try:
        full_name, number = parse_pr_url(url)
    except ValueError:
        return
    await upsert_pr_link(db, mission, full_name, {"number": number, "html_url": url, "state": "open", "title": f"{mission.key} (Jules)"})
    spawn(f"guard {full_name}#{number}", guard_pr, mission.id, full_name, number)


async def _load(db: AsyncSession, mission_id) -> Mission | None:
    return (await db.execute(select(Mission).options(selectinload(Mission.files), selectinload(Mission.links))
                             .where(Mission.id == mission_id).execution_options(populate_existing=True))).scalars().first()


def _expired(link: ExternalLink) -> bool:
    started = (link.state or {}).get("startedAt")
    try:
        return bool(started) and datetime.now(UTC) - datetime.fromisoformat(started) > GIVE_UP_AFTER
    except ValueError:
        return False


async def poll_one(mission_id, sid: str) -> str | None:
    """One poll in its own DB session. Returns the session's state, or None when there's nothing left to poll."""
    from ..db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        mission = await _load(db, mission_id)
        link = next((link for link in (mission.links if mission else []) if link.system == "jules" and link.external_id == sid), None)
        if not link or not api.configured() or (link.state or {}).get("state") in api.DONE or _expired(link):
            return None
        try:
            async with api.JulesClient() as client:
                await poll(db, mission, link, client)
        except (api.JulesError, httpx.HTTPError) as e:
            logger.warning(f"jules: couldn't poll {sid}: {e}")
        return (link.state or {}).get("state")


async def watch(mission_id, sid: str) -> None:
    """Poll one session until it finishes (or gives up), so the mission page follows Jules closely."""
    while True:
        state = await poll_one(mission_id, sid)
        if state is None or state in api.DONE:
            return
        await asyncio.sleep(POLL_EVERY)


async def tick() -> int:
    """Poll every active session once (Celery beat): the safety net when a watcher died with its instance."""
    from ..db.database import AsyncSessionLocal

    if not api.configured():
        return 0
    async with AsyncSessionLocal() as db:
        links = (await db.execute(select(ExternalLink).where(ExternalLink.system == "jules"))).scalars().all()
        todo = [(link.mission_id, link.external_id) for link in links if (link.state or {}).get("state") in api.ACTIVE and not _expired(link)]
    for mission_id, sid in todo:
        await poll_one(mission_id, sid)
    return len(todo)


def refresh_if_stale(mission: Mission) -> None:
    if not api.configured():
        return
    for link in sessions(mission):
        s = link.state or {}
        if s.get("state") not in api.ACTIVE:
            continue
        try:
            fresh = s.get("polledAt") and datetime.now(UTC) - datetime.fromisoformat(s["polledAt"]) < timedelta(seconds=STALE_AFTER)
        except ValueError:
            fresh = False
        if not fresh:
            spawn(f"jules refresh {link.external_id}", poll_one, mission.id, link.external_id)


# ── The developer answering Jules ────────────────────────────────────────────


def _session_or_404(mission: Mission, sid: str) -> ExternalLink:
    link = next((link for link in sessions(mission) if link.external_id == sid), None)
    if not link:
        raise HTTPException(404, "No such Jules session on this mission")
    if not api.configured():
        raise HTTPException(409, "Jules isn't connected any more. An engineering lead adds it in Atlas → Connectors.")
    return link


async def approve_plan(db: AsyncSession, actor, mission: Mission, sid: str) -> dict:
    if actor.role != Role.developer:
        raise HTTPException(403, "The developer approves Jules's plan")
    link = _session_or_404(mission, sid)
    if (link.state or {}).get("state") != "AWAITING_PLAN_APPROVAL":
        raise HTTPException(409, "Jules isn't waiting for a plan approval")
    try:
        async with api.JulesClient() as client:
            await client.approve_plan(sid)
    except api.JulesError as e:
        raise HTTPException(502, f"Jules didn't take the approval: {e}") from e
    link.state = {**(link.state or {}), "state": "IN_PROGRESS", "planApproved": True}
    await db.commit()
    await record(db, mission, "jules.plan_approved", {"session": sid}, actor.user, actor.role.value)
    spawn(f"jules refresh {sid}", poll_one, mission.id, sid)
    return session_json(link)


async def reply(db: AsyncSession, actor, mission: Mission, sid: str, text: str) -> dict:
    if actor.role != Role.developer:
        raise HTTPException(403, "The developer talks to Jules on this mission")
    link = _session_or_404(mission, sid)
    if (link.state or {}).get("state") not in api.ACTIVE:
        raise HTTPException(409, "This Jules session has finished")
    from ..services import shield

    verdict = await shield.screen_prompt(text, where="jules_message", org_id=mission.org_id, mission_id=mission.id)
    if verdict.blocked:
        raise HTTPException(400, verdict.reason)
    try:
        async with api.JulesClient() as client:
            await client.send_message(sid, _clean_prompt(text, mission))
    except api.JulesError as e:
        raise HTTPException(502, f"Jules didn't take the message: {e}") from e
    link.state = {**(link.state or {}), "state": "IN_PROGRESS"}  # Jules picks the answer up; the next poll confirms
    await db.commit()
    await record(db, mission, "jules.replied", {"session": sid, "text": text[:400]}, actor.user, actor.role.value)
    return session_json(link)
