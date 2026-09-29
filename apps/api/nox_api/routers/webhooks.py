import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.security import validate_github_webhook_signature
from ..db.database import get_db
from ..db.models import KBStatus, KnowledgeBase, SourceMonitor
from ..services.gitops import get_commit_diff
from ..workers.dispatcher import dispatch_gatekeeper_pipeline, dispatch_rollup_pipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/webhooks", tags=["Webhooks"])

@router.post("/github/push")
async def handle_github_push(
    request: Request,
    x_hub_signature_256: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    payload_bytes = await request.body()
    if not validate_github_webhook_signature(payload_bytes, x_hub_signature_256, settings.WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="Invalid signature")

    payload = await request.json()
    repo_url = payload['repository']['html_url']
    after_sha = payload['after']
    
    # Only process pushes to main or master branch
    ref = payload.get('ref', '')
    if ref not in ('refs/heads/main', 'refs/heads/master'):
        logger.info(f"Ignoring push to non-main branch: {ref}")
        return {"status": "ignored_branch"}
    
    result = await db.execute(select(SourceMonitor).where(
        (SourceMonitor.repo_url == repo_url) | (SourceMonitor.source_url == repo_url)
    ))
    monitors = result.scalars().all()
    
    for monitor in monitors:
        if not monitor.incremental_enabled:
            continue
        diff = get_commit_diff(payload['repository']['full_name'], after_sha)
        dispatch_gatekeeper_pipeline(
            kb_id=str(monitor.kb_id),
            diff=diff,
            source_type="github",
            source_url=repo_url,
            commit_sha=after_sha,
            commit_message=payload.get('head_commit', {}).get('message', ''),
            author=payload.get('head_commit', {}).get('author', {}).get('name', 'Unknown'),
        )
        monitor.last_commit_sha = after_sha
        
    await db.commit()
    return {"status": "accepted"}

async def _link_pr_to_missions(db: AsyncSession, payload: dict) -> None:
    """A PR whose branch, title or body names NOX-n is linked to that mission; new code gets a guard comment."""
    from ..db.models import Mission
    from ..jobs import spawn
    from ..missions.prs import guard_pr, mission_numbers, upsert_pr_link

    pr = payload.get("pull_request") or {}
    full_name = (payload.get("repository") or {}).get("full_name")
    if not pr or not full_name:
        return
    for number in mission_numbers((pr.get("head") or {}).get("ref"), pr.get("title"), pr.get("body")):
        mission = (await db.execute(select(Mission).where(Mission.number == number))).scalars().first()
        if not mission:
            continue
        await upsert_pr_link(db, mission, full_name, pr)
        if payload.get("action") in ("opened", "reopened", "synchronize", "ready_for_review"):
            spawn(f"guard {full_name}#{pr['number']}", guard_pr, mission.id, full_name, pr["number"])


@router.post("/github/pr")
async def handle_github_pr(
    request: Request,
    x_hub_signature_256: str = Header(None),
    db: AsyncSession = Depends(get_db)
):
    payload_bytes = await request.body()
    if not validate_github_webhook_signature(payload_bytes, x_hub_signature_256, settings.WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="Invalid signature")

    payload = await request.json()
    await _link_pr_to_missions(db, payload)
    if payload.get("action") == "closed" and payload.get("pull_request", {}).get("merged") == True:
        repo_url = payload['repository']['html_url']
        
        result = await db.execute(select(KnowledgeBase).where(KnowledgeBase.git_repo_url == repo_url))
        kb = result.scalars().first()
        
        if kb:
            kb.status = KBStatus.published
            await db.commit()
            
            # Check for rollup trigger
            org_result = await db.execute(select(KnowledgeBase).where(KnowledgeBase.org_id == kb.org_id, KnowledgeBase.status == KBStatus.published))
            published_kbs = org_result.scalars().all()
            
            if len(published_kbs) >= 2:
                dispatch_rollup_pipeline(str(kb.org_id))

    return {"status": "accepted"}

@router.post("/slack/events")
async def handle_slack_events(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle Slack Event Subscriptions (e.g. message.channels)."""
    payload = await request.json()

    # 1. Handle URL Verification Challenge from Slack
    if payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge")}

    event = payload.get("event", {})
    event_type = event.get("type")

    if event_type in ("message", "app_mention"):
        channel = event.get("channel")
        text = event.get("text", "")
        user = event.get("user", "SlackUser")
        ts = event.get("ts", "")

        # Skip bot messages to prevent infinite loops
        if event.get("bot_id") or event.get("subtype") == "bot_message":
            return {"status": "ignored_bot_message"}

        # Find any monitors configured for this Slack channel
        result = await db.execute(select(SourceMonitor).where(SourceMonitor.source_type == "slack"))
        monitors = result.scalars().all()

        for mon in monitors:
            if not mon.incremental_enabled:
                continue
            cfg_channel = (mon.config or {}).get("channel_id") or mon.target_url
            if channel in cfg_channel or mon.target_url.endswith(channel):
                diff_text = f"### 💬 Real-time Slack Message from #{channel}\n\n**{user}**: {text}\n"
                dispatch_gatekeeper_pipeline(
                    kb_id=str(mon.kb_id),
                    diff=diff_text,
                    source_type="slack",
                    source_url=mon.target_url,
                    commit_sha=ts,
                    commit_message=f"Slack #{channel} message from {user}",
                    author=user,
                    summary=text[:100],
                )
                mon.last_commit_sha = ts

        await db.commit()

    return {"status": "accepted"}

@router.post("/confluence")
async def handle_confluence_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle Atlassian / Confluence webhook events (page_created, page_updated)."""
    payload = await request.json()
    page = payload.get("page", {})
    space = payload.get("space", {})
    space_key = space.get("key") or payload.get("spaceKey", "")
    page_title = page.get("title", "Updated Page")
    page_id = str(page.get("id", ""))

    if space_key:
        result = await db.execute(select(SourceMonitor).where(SourceMonitor.source_type == "confluence"))
        monitors = result.scalars().all()

        for mon in monitors:
            if not mon.incremental_enabled:
                continue
            if space_key in mon.target_url or (mon.config or {}).get("space_key") == space_key:
                diff_text = f"### 📄 Confluence Webhook Event\nSpace: `{space_key}`\nPage: `{page_title}` (ID: {page_id})\nEvent: `{payload.get('eventType', 'page_updated')}`"
                dispatch_gatekeeper_pipeline(
                    kb_id=str(mon.kb_id),
                    diff=diff_text,
                    source_type="confluence",
                    source_url=mon.target_url,
                    commit_sha=page_id,
                    commit_message=f"Confluence page '{page_title}' in space {space_key}",
                    author=payload.get("user", {}).get("displayName", "ConfluenceUser"),
                    summary=f"Confluence page update: {page_title}",
                )

        await db.commit()

    return {"status": "accepted"}

