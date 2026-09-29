"""Jira from inside NoX: search, read, link, create, import, sub-tasks, and the webhook."""

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor, current_actor
from ..core.config import settings
from ..db.database import get_db
from ..db.models import Role
from ..integrations.atlassian import AtlassianConfigError
from ..integrations.jira import JiraAuthError, JiraClient, JiraError, JiraNotFoundError, adf_to_text
from ..missions import jira_sync
from .missions import file_for, load_mission, mission_apps, mission_json

router = APIRouter(tags=["Jira"])

KEY_RE = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")


def allowed_projects() -> list[str]:
    return [p.strip().upper() for p in settings.JIRA_ALLOWED_PROJECTS.split(",") if p.strip()]


def _jira_http(e: Exception) -> HTTPException:
    if isinstance(e, (JiraAuthError, AtlassianConfigError)):
        return HTTPException(502, "Jira rejected NoX's credentials — check the Atlassian token in the connectors page")
    if isinstance(e, JiraNotFoundError):
        return HTTPException(404, "No such Jira issue, or it isn't visible to NoX")
    return HTTPException(502, f"Jira: {e}")


@router.get("/api/v1/integrations/jira/config")
async def jira_config(actor: Actor = Depends(current_actor)):
    return {"projects": allowed_projects(), "defaultProject": settings.JIRA_DEFAULT_PROJECT, "statusMap": jira_sync.status_map(),
            "baseUrl": settings.ATLASSIAN_BASE_URL}


@router.get("/api/v1/integrations/jira/search")
async def search(q: str = Query(min_length=1, max_length=200), actor: Actor = Depends(current_actor)):
    q = q.strip()
    projects = ", ".join(allowed_projects()) or settings.JIRA_DEFAULT_PROJECT
    if KEY_RE.match(q.upper()):
        jql = f"key = {q.upper()}"
    else:
        text = q.replace("\\", "").replace('"', "")
        jql = f'project in ({projects}) AND text ~ "{text}" ORDER BY updated DESC'
    try:
        async with JiraClient() as jira:
            issues = await jira.search(jql, fields=["summary", "status", "issuetype"], limit=15)
            return [{"key": i["key"], "summary": i["fields"].get("summary"), "status": (i["fields"].get("status") or {}).get("name"),
                     "type": (i["fields"].get("issuetype") or {}).get("name"), "url": jira.browse_url(i["key"])} for i in issues]
    except (JiraError, AtlassianConfigError) as e:
        raise _jira_http(e) from e


@router.get("/api/v1/integrations/jira/issues/{key}")
async def get_issue(key: str, actor: Actor = Depends(current_actor)):
    try:
        async with JiraClient() as jira:
            issue = await jira.get_issue(key.upper())
            f = issue["fields"]
            return {"key": issue["key"], "summary": f.get("summary"), "description": adf_to_text(f.get("description")).strip(),
                    "status": (f.get("status") or {}).get("name"), "type": (f.get("issuetype") or {}).get("name"), "url": jira.browse_url(issue["key"])}
    except (JiraError, AtlassianConfigError) as e:
        raise _jira_http(e) from e


class LinkBody(BaseModel):
    issue_key: str = Field(alias="issueKey", pattern=r"^[A-Za-z][A-Za-z0-9]+-\d+$")


@router.post("/api/v1/missions/{key}/jira/link")
async def link(key: str, body: LinkBody, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    try:
        await jira_sync.link_issue(db, mission, body.issue_key.upper(), actor)
    except (JiraError, AtlassianConfigError) as e:
        raise _jira_http(e) from e
    mission = await load_mission(db, actor, key)
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


class CreateBody(BaseModel):
    project: str | None = None
    issue_type: str = Field(default="Task", alias="issueType")


@router.post("/api/v1/missions/{key}/jira/create")
async def create(key: str, body: CreateBody, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    mission = await load_mission(db, actor, key)
    project = (body.project or settings.JIRA_DEFAULT_PROJECT).upper()
    if allowed_projects() and project not in allowed_projects():
        raise HTTPException(400, f"NoX may create tickets in {', '.join(allowed_projects())} only")
    try:
        await jira_sync.create_issue(db, mission, project, body.issue_type, actor)
    except (JiraError, AtlassianConfigError) as e:
        raise _jira_http(e) from e
    mission = await load_mission(db, actor, key)
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


@router.delete("/api/v1/missions/{key}/jira/{issue_key}")
async def unlink(key: str, issue_key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    from ..missions.events import record

    mission = await load_mission(db, actor, key)
    link = next((x for x in mission.links if x.system == "jira" and x.external_id == issue_key.upper()), None)
    if not link:
        raise HTTPException(404, "Not linked")
    was_primary = link.primary
    await db.delete(link)
    await db.flush()
    if was_primary:
        rest = [x for x in mission.links if x.system == "jira" and x is not link]
        if rest:
            rest[0].primary = True
    await db.commit()
    await record(db, mission, "jira.unlinked", {"key": issue_key.upper()}, actor.user, actor.role.value)
    mission = await load_mission(db, actor, key)
    return mission_json(mission, await mission_apps(db, mission), with_bodies=True)


@router.post("/api/v1/missions/{key}/jira/subtasks")
async def subtasks(key: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(current_actor)):
    if actor.role != Role.developer:
        raise HTTPException(403, "Sub-tasks come from the build spec — the developer seat creates them")
    mission = await load_mission(db, actor, key)
    dev = file_for(mission, Role.developer)
    if not jira_sync.tasks_from(dev.markdown):
        raise HTTPException(409, "The build spec has no 'Tasks' list yet")
    try:
        created = await jira_sync.create_subtasks(db, mission, dev, actor)
    except (JiraError, AtlassianConfigError) as e:
        raise _jira_http(e) from e
    return {"created": created}


@router.post("/api/v1/webhooks/jira")
async def jira_webhook(request: Request, secret: str = Query(default=""), db: AsyncSession = Depends(get_db)):
    import hmac

    if not settings.JIRA_WEBHOOK_SECRET or not hmac.compare_digest(secret, settings.JIRA_WEBHOOK_SECRET):
        raise HTTPException(401, "Bad webhook secret")
    return await jira_sync.handle_webhook(db, await request.json())
