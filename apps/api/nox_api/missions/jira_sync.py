"""Keep a mission and its primary Jira ticket in step, both ways.

NoX → Jira: every stage change comments on the ticket and moves it to the mapped status.
Jira → NoX: the webhook records status, assignee and comment changes on the mission timeline.

Loop protection: NoX's own comments start with "[NoX]", and each status NoX sets is remembered
for a minute, so the webhook echoes of NoX's writes are recognised and ignored.
"""

import json
import logging
import re
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.time_utils import now_utc
from ..db.models import ExternalLink, Mission, MissionStage, Role, SpecFile
from ..integrations.jira import JiraClient, JiraError, adf_to_text
from .events import record
from .templates import TITLE

logger = logging.getLogger(__name__)

NOX_TAG = "[NoX]"
ECHO_WINDOW_SECONDS = 60

DEFAULT_STATUS_MAP = {
    "business": "To Do",
    "product": "To Do",
    "engineering": "To Do",
    "developer": "In Progress",
    "build": "In Progress",
    "verifying": "In Review",
    "done": "Done",
}


def status_map() -> dict[str, str]:
    try:
        return {**DEFAULT_STATUS_MAP, **json.loads(settings.JIRA_STATUS_MAP or "{}")}
    except json.JSONDecodeError:
        logger.warning("JIRA_STATUS_MAP is not valid JSON; using defaults")
        return DEFAULT_STATUS_MAP


def mission_url(mission: Mission) -> str:
    origin = settings.NOX_WEB_ORIGIN.split(",")[0].strip().rstrip("/")
    return f"{origin}/app/{mission.created_as_role.value}/missions/{mission.key}"


def primary_link(mission: Mission) -> ExternalLink | None:
    return next((link for link in mission.links if link.system == "jira" and link.primary), None)


def issue_state(issue: dict) -> dict:
    f = issue.get("fields", {})
    return {
        "status": (f.get("status") or {}).get("name"),
        "summary": f.get("summary"),
        "assignee": (f.get("assignee") or {}).get("displayName"),
        "type": (f.get("issuetype") or {}).get("name"),
        "description": adf_to_text(f.get("description"))[:4000],
        "syncedAt": now_utc().isoformat(timespec="seconds"),
    }


def spec_summary(mission: Mission) -> str:
    """Ticket description: the request, then the start of each written spec file."""
    parts = [f"Created from NoX mission {mission.key}.", "", f'Request: "{mission.prompt}"', ""]
    for f in sorted(mission.files, key=lambda x: list(Role).index(x.role)):
        if f.markdown.strip():
            body = re.sub(r"^#.*\n", "", f.markdown.strip(), count=1).strip()
            parts += [f"## {TITLE[f.role]} ({f.status.value.replace('_', ' ')})", body[:900] + ("…" if len(body) > 900 else ""), ""]
    parts.append(f"Full spec: {mission_url(mission)}")
    return "\n".join(parts)


async def link_issue(db: AsyncSession, mission: Mission, issue_key: str, actor) -> ExternalLink:
    async with JiraClient() as jira:
        issue = await jira.get_issue(issue_key)
        await _remote_link(jira, mission, issue["key"])
        url = jira.browse_url(issue["key"])
    existing = next((link for link in mission.links if link.system == "jira" and link.external_id == issue["key"]), None)
    is_primary = primary_link(mission) is None
    if existing:
        existing.state = issue_state(issue)
        link = existing
    else:
        link = ExternalLink(mission_id=mission.id, system="jira", external_id=issue["key"], url=url, primary=is_primary, state=issue_state(issue))
        db.add(link)
    await db.commit()
    await record(db, mission, "jira.linked", {"key": issue["key"], "url": url, "primary": link.primary}, actor.user, actor.role.value)
    return link


async def create_issue(db: AsyncSession, mission: Mission, project: str, issue_type: str, actor) -> ExternalLink:
    async with JiraClient() as jira:
        created = await jira.create_issue(project, f"{mission.key}: {mission.title}", spec_summary(mission), issue_type,
                                          labels=["nox", mission.key.lower()])
        await _remote_link(jira, mission, created["key"])
        issue = await jira.get_issue(created["key"])
    for link in mission.links:
        if link.system == "jira":
            link.primary = False
    link = ExternalLink(mission_id=mission.id, system="jira", external_id=created["key"], url=created["url"], primary=True, state=issue_state(issue))
    db.add(link)
    await db.commit()
    await record(db, mission, "jira.created", {"key": created["key"], "url": created["url"]}, actor.user, actor.role.value)
    return link


async def _remote_link(jira: JiraClient, mission: Mission, key: str) -> None:
    try:
        await jira.add_remote_link(key, mission_url(mission), f"NoX · {mission.key}: {mission.title}", global_id=f"nox-mission-{mission.id}")
    except JiraError as e:
        logger.info(f"remote link on {key} skipped: {e}")


def tasks_from(markdown: str) -> list[str]:
    """Items of the build spec's 'Tasks' section (numbered or bulleted, checkboxes allowed)."""
    m = re.search(r"^##\s+Tasks[^\n]*\n(.*?)(?=^##\s|\Z)", markdown, re.M | re.S)
    if not m:
        return []
    items = []
    for line in m.group(1).splitlines():
        t = re.match(r"^\s*(?:\d+[.)]|[-*])\s+(?:\[[ xX]\]\s+)?(.+)$", line)
        if t and not re.match(r"^\s{2,}", line):  # indented lines are sub-points of a task
            items.append(re.sub(r"\*\*|`", "", t.group(1)).strip()[:250])
    return items


async def create_subtasks(db: AsyncSession, mission: Mission, dev_file: SpecFile, actor) -> list[str]:
    link = primary_link(mission)
    if not link:
        raise JiraError("Link or create a Jira ticket first")
    existing = set((link.state or {}).get("subtasks", []))
    created = []
    async with JiraClient() as jira:
        for task in tasks_from(dev_file.markdown):
            if task in existing:
                continue
            sub = await jira.create_subtask(link.external_id, task, f"From {mission.key}'s build spec.\n\n{mission_url(mission)}")
            created.append(sub["key"])
            existing.add(task)
    link.state = {**(link.state or {}), "subtasks": sorted(existing)}
    await db.commit()
    await record(db, mission, "jira.subtasks", {"created": created, "parent": link.external_id}, actor.user, actor.role.value)
    return created


async def on_stage_change(db: AsyncSession, mission: Mission, actor, note: str) -> None:
    """Comment on the primary ticket and move it to the status mapped to the mission's stage."""
    link = primary_link(mission)
    if not link or not settings.JIRA_API_TOKEN:
        return
    target = status_map().get(mission.stage.value)
    try:
        async with JiraClient() as jira:
            await jira.add_comment(link.external_id, f"{NOX_TAG} {note}. Stage: {mission.stage.value}. {mission_url(mission)}")
            if target:
                moved = await jira.transition_to(link.external_id, target)
                if moved:
                    link.state = {**(link.state or {}), "status": target, "expect": {"status": target, "at": time.time()}}
        await db.commit()
        await record(db, mission, "jira.synced", {"key": link.external_id, "status": target})
    except JiraError as e:
        logger.warning(f"jira sync for {mission.key} failed: {e}")
        await record(db, mission, "jira.sync_failed", {"key": link.external_id, "error": str(e)[:200]})


async def handle_webhook(db: AsyncSession, payload: dict) -> dict:
    """Apply a Jira webhook (issue updated / comment created) to the missions linked to that issue."""
    issue = payload.get("issue") or {}
    key = issue.get("key")
    if not key:
        return {"ignored": "no issue"}
    links = (await db.execute(select(ExternalLink).where(ExternalLink.system == "jira", ExternalLink.external_id == key))).scalars().all()
    if not links:
        return {"ignored": "not linked"}
    event = payload.get("webhookEvent", "")
    actor = (payload.get("user") or payload.get("comment", {}).get("author") or {}).get("displayName", "Jira")
    changes: dict = {}
    for item in (payload.get("changelog") or {}).get("items", []):
        if item.get("field") == "status":
            changes["status"] = item.get("toString")
        elif item.get("field") == "assignee":
            changes["assignee"] = item.get("toString")
    comment = None
    if event.startswith("comment_") and payload.get("comment"):
        body = adf_to_text(payload["comment"].get("body")).strip()
        if body[: len(NOX_TAG)].upper() != NOX_TAG.upper():  # also matches tags written before the casing change
            comment = body[:500]

    applied = 0
    for link in links:
        expect = (link.state or {}).get("expect") or {}
        if changes.get("status") and expect.get("status") == changes["status"] and time.time() - expect.get("at", 0) < ECHO_WINDOW_SECONDS:
            changes.pop("status")  # our own transition echoing back
        if not changes and not comment:
            continue
        link.state = {**(link.state or {}), **changes, "syncedAt": now_utc().isoformat(timespec="seconds")}
        mission = await db.get(Mission, link.mission_id)
        await db.commit()
        payload_out = {"key": key, **changes, "by": actor}
        if comment:
            payload_out["comment"] = comment
        await record(db, mission, "jira.updated", payload_out)
        applied += 1
    return {"applied": applied}


_ = MissionStage  # stages are the keys of the status map
