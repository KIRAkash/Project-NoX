import asyncio
import base64
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from ..core.auth import Actor, Cap, assert_org_visible, require, visible_org_ids
from ..core.time_utils import now_utc_naive
from ..db.database import get_db
from ..db.models import KnowledgeBase
from ..db.schemas import KBDetailResponse, KBResponse
from ..services.local_storage import generate_presigned_upload_url

logger = logging.getLogger(__name__)


def kb_access(cap: Cap):
    """Route dependency: the acting role holds `cap` and, for /kb/{kb_id} routes, the KB's org is visible."""

    async def _check(request: Request, db: AsyncSession = Depends(get_db), actor: Actor = Depends(require(cap))) -> Actor:
        kb_id = request.path_params.get("kb_id")
        if kb_id:
            try:
                kb = await db.get(KnowledgeBase, UUID(kb_id))
            except ValueError:
                kb = None
            await assert_org_visible(db, actor.user, kb.org_id if kb else None)
        return actor

    return _check


async def _with_pins(db: AsyncSession, kb_id: str, path: str, content: str) -> str:
    from ..services.pins import pins_by_page, render_pins

    pins = (await pins_by_page(db, kb_id)).get(path)
    return render_pins(content, pins) if pins else content


async def _visible_kbs(db: AsyncSession, request: Request) -> list[KnowledgeBase]:
    visible = await visible_org_ids(db, request.state.user)
    if not visible:
        return []
    return list((await db.execute(select(KnowledgeBase).where(KnowledgeBase.org_id.in_(visible)))).scalars().all())

router = APIRouter(tags=["Knowledge Bases"])

def _kb_name(kb: KnowledgeBase) -> str:
    """The KB repo name: taken from the provisioned repo URL, which is the source of truth."""
    if kb.git_repo_url:
        return kb.git_repo_url.rstrip("/").split("/")[-1].removesuffix(".git")
    return f"kb-{kb.app_name.lower().replace(' ', '-')}"


@router.get("/api/v1/kb", response_model=list[KBResponse], dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def list_kbs(request: Request, db: AsyncSession = Depends(get_db)):
    return await _visible_kbs(db, request)

@router.get("/api/v1/kb/resolve", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def resolve_kb(target: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Resolve a target identifier (repo name, app slug, or UUID) to a Knowledge Base ID."""
    clean_target = target.strip().lower()
    
    all_kbs = await _visible_kbs(db, request)

    # 1. Try UUID match
    for kb in all_kbs:
        if str(kb.id) == clean_target:
            return {"kb_id": str(kb.id), "app_name": kb.app_name, "git_repo_url": kb.git_repo_url}

    # 2. Match by git_repo_url or app_name

    for kb in all_kbs:
        # Match git_repo_url ending with target
        if kb.git_repo_url:
            repo_slug = kb.git_repo_url.rstrip("/").split("/")[-1].lower()
            if repo_slug == clean_target or repo_slug.replace(".git", "") == clean_target:
                return {"kb_id": str(kb.id), "app_name": kb.app_name, "git_repo_url": kb.git_repo_url}

        # Match app_name exact or normalized
        clean_app = kb.app_name.lower().replace("_", "-").replace(" ", "-")
        if clean_app == clean_target or kb.app_name.lower() == clean_target:
            return {"kb_id": str(kb.id), "app_name": kb.app_name, "git_repo_url": kb.git_repo_url}

        # Match repo without org prefix (e.g., target: kb-apex-financial-services-order-matching-engine, app: order-matching-engine)
        if clean_target.endswith(clean_app) or clean_target.endswith(clean_app.replace("-", "")):
            return {"kb_id": str(kb.id), "app_name": kb.app_name, "git_repo_url": kb.git_repo_url}

    raise HTTPException(status_code=404, detail=f"Target KB '{target}' not found")


@router.get("/api/v1/kb/{kb_id}", response_model=KBDetailResponse, dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def get_kb(kb_id: str, db: AsyncSession = Depends(get_db)):
    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
    result = await db.execute(
        select(KnowledgeBase).options(
            selectinload(KnowledgeBase.events),
            selectinload(KnowledgeBase.source_monitors)
        ).where(KnowledgeBase.id == val)
    )
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")
    return kb

@router.post("/api/v1/kb/{kb_id}/sync", response_model=KBDetailResponse, dependencies=[Depends(kb_access(Cap.MANAGE_SOURCES))])
async def sync_kb_status(kb_id: str, db: AsyncSession = Depends(get_db)):
    from ..db.models import KBEvent, KBStatus
    from ..services.gitops import get_github_client
    from ..workers.dispatcher import dispatch_rollup_pipeline
    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
    
    result = await db.execute(
        select(KnowledgeBase).options(
            selectinload(KnowledgeBase.events),
            selectinload(KnowledgeBase.source_monitors)
        ).where(KnowledgeBase.id == val)
    )
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")

    if kb.status == KBStatus.in_review and kb.pr_url:
        # e.g. https://github.com/<org>/kb-<org>-<app>/pull/1
        parts = kb.pr_url.split("/")
        if len(parts) >= 4:
            owner = parts[-4]
            repo_name = parts[-3]
            pr_num = int(parts[-1])
            repo_full_name = f"{owner}/{repo_name}"
            
            g = get_github_client()
            repo = g.get_repo(repo_full_name)
            pr = repo.get_pull(pr_num)
            
            if pr.is_merged():
                kb.status = KBStatus.published
                event = KBEvent(kb_id=kb.id, event_type="status_change", payload={"status": "published", "message": "PR was merged"})
                db.add(event)
                await db.commit()
                await db.refresh(kb)
                
                # Trigger rollup if needed
                org_result = await db.execute(select(KnowledgeBase).where(KnowledgeBase.org_id == kb.org_id, KnowledgeBase.status == KBStatus.published))
                published_kbs = org_result.scalars().all()
                if len(published_kbs) >= 2:
                    dispatch_rollup_pipeline(str(kb.org_id))

    return kb

@router.post("/api/v1/kb/{kb_id}/check-updates", dependencies=[Depends(kb_access(Cap.MANAGE_SOURCES))])
async def check_kb_updates(kb_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Inspect all configured sources (GitHub, Confluence, Notion, Slack, Jira) for updates and trigger Gatekeeper pipeline."""

    from ..agents.runner import log_event
    from ..connectors import check_source_updates
    from ..db.models import MonitorMode, SourceMonitor
    from ..workers.dispatcher import dispatch_gatekeeper_pipeline

    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")

    result = await db.execute(
        select(KnowledgeBase).options(
            selectinload(KnowledgeBase.events),
            selectinload(KnowledgeBase.source_monitors)
        ).where(KnowledgeBase.id == val)
    )
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")

    sse_manager = getattr(request.app.state, "sse_manager", None)

    # Ensure source monitors exist for all configured sources
    existing_monitors = {m.target_url: m for m in (kb.source_monitors or [])}
    sources = kb.source_urls or []
    if not sources and not existing_monitors:
        raise HTTPException(status_code=400, detail="No sources configured for this Knowledge Base.")

    for src in sources:
        s_type = src.get('type') if isinstance(src, dict) else getattr(src, 'type', 'github')
        s_url = src.get('url') if isinstance(src, dict) else getattr(src, 'url', '')
        s_incr = src.get('incremental_enabled', True) if isinstance(src, dict) else getattr(src, 'incremental_enabled', True)
        s_cfg = src.get('config', {}) if isinstance(src, dict) else getattr(src, 'config', {})
        if s_url and s_url not in existing_monitors:
            new_mon = SourceMonitor(
                kb_id=kb.id,
                source_type=s_type,
                repo_url=s_url,
                source_url=s_url,
                incremental_enabled=s_incr,
                config=s_cfg or {},
                last_sync_state={},
                monitor_mode=MonitorMode.polling,
            )
            db.add(new_mon)
            existing_monitors[s_url] = new_mon

    await db.commit()

    # Re-fetch monitors
    mon_res = await db.execute(select(SourceMonitor).where(SourceMonitor.kb_id == kb.id))
    monitors = mon_res.scalars().all()

    scan_results = []
    triggered_count = 0

    for mon in monitors:
        if not mon.incremental_enabled:
            scan_results.append({
                "source_type": mon.source_type,
                "source_url": mon.target_url,
                "status": "disabled",
                "message": "Incremental updates disabled for this source"
            })
            continue

        try:
            last_state = mon.last_sync_state or {}
            if mon.last_commit_sha and "last_commit_sha" not in last_state:
                last_state["last_commit_sha"] = mon.last_commit_sha

            delta = await check_source_updates(
                source_type=mon.source_type,
                url=mon.target_url,
                last_state=last_state,
                config=mon.config or {},
            )

            if delta.has_changes and delta.delta_content:
                # Update monitor state
                mon.last_sync_state = delta.new_state
                if "last_commit_sha" in delta.new_state:
                    mon.last_commit_sha = delta.new_state["last_commit_sha"]
                mon.last_synced_at = now_utc_naive()
                await db.commit()

                if sse_manager:
                    await log_event(db, str(kb.id), sse_manager, "diff_checked", {
                        "source_type": delta.source_type,
                        "source_url": delta.source_url,
                        "summary": delta.summary,
                        "author": delta.author,
                        "affected_items": delta.affected_items,
                        "message": f"Detected changes from {delta.source_type.upper()}: {delta.summary}",
                    })

                # Trigger Gatekeeper Pipeline via unified dispatcher
                dispatch_gatekeeper_pipeline(
                    kb_id=str(kb.id),
                    diff=delta.delta_content,
                    source_type=delta.source_type,
                    source_url=delta.source_url,
                    commit_sha=delta.new_state.get("last_commit_sha") or delta.new_state.get("latest_ts"),
                    commit_message=delta.summary,
                    affected_items=delta.affected_items,
                    author=delta.author,
                    summary=delta.summary,
                )

                triggered_count += 1
                scan_results.append({
                    "source_type": delta.source_type,
                    "source_url": delta.source_url,
                    "status": "triggered",
                    "summary": delta.summary,
                    "affected_items": delta.affected_items,
                })
            else:
                mon.last_synced_at = now_utc_naive()
                await db.commit()
                scan_results.append({
                    "source_type": mon.source_type,
                    "source_url": mon.target_url,
                    "status": "no_changes",
                    "summary": delta.summary or "No new updates detected",
                })

        except Exception as e:
            logger.error(f"Error checking updates for {mon.source_type} ({mon.target_url}): {e}")
            scan_results.append({
                "source_type": mon.source_type,
                "source_url": mon.target_url,
                "status": "error",
                "message": str(e),
            })

    status_str = "triggered" if triggered_count > 0 else "no_changes"
    message_str = f"Scanned {len(scan_results)} sources: {triggered_count} update(s) triggered Gatekeeper."

    return {
        "status": status_str,
        "message": message_str,
        "sources_scanned": scan_results,
        "triggered_count": triggered_count,
    }

@router.get("/api/v1/kb/{kb_id}/stream", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def kb_stream(kb_id: str, request: Request):
    from ..services.sse import get_sse_manager
    sse_manager = getattr(request.app.state, "sse_manager", None) or get_sse_manager()
    queue = await sse_manager.subscribe(str(kb_id))
    
    async def event_publisher():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=1.0)
                    yield {"event": event.get("type", "message"), "data": json.dumps(event, default=str)}
                except TimeoutError:
                    pass
        finally:
            await sse_manager.unsubscribe(str(kb_id), queue)

    # no-transform stops proxies (incl. the web app's /api rewrite) from gzipping and buffering the stream.
    return EventSourceResponse(
        event_publisher(),
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )

@router.post("/api/v1/kb/{kb_id}/restart", response_model=KBDetailResponse, dependencies=[Depends(kb_access(Cap.MANAGE_SOURCES))])
async def restart_kb(kb_id: str, db: AsyncSession = Depends(get_db)):
    """Restart the entire pipeline from scratch, deleting all cached checkpoints."""
    from ..db.models import KBEvent, KBStatus
    from ..services.local_storage import clear_kb_checkpoints
    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
    result = await db.execute(
        select(KnowledgeBase).options(
            selectinload(KnowledgeBase.events),
            selectinload(KnowledgeBase.source_monitors)
        ).where(KnowledgeBase.id == val)
    )
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")
    
    # 1. Clean all saved checkpoints on disk
    clear_kb_checkpoints(str(kb.id))

    # 2. Reset status to queued
    kb.status = KBStatus.queued
    event = KBEvent(
        kb_id=kb.id,
        event_type="pipeline_restarted",
        payload={"status": "queued", "message": "Pipeline restarted from scratch (all cached checkpoints cleared)"}
    )
    db.add(event)
    await db.commit()
    await db.refresh(kb)
    
    from ..workers.dispatcher import dispatch_generation_pipeline
    dispatch_generation_pipeline(str(kb.id))
    
    result = await db.execute(
        select(KnowledgeBase).options(
            selectinload(KnowledgeBase.events),
            selectinload(KnowledgeBase.source_monitors)
        ).where(KnowledgeBase.id == val)
    )
    return result.scalars().first()

@router.post("/api/v1/kb/{kb_id}/retry", response_model=KBDetailResponse, dependencies=[Depends(kb_access(Cap.MANAGE_SOURCES))])
async def retry_kb(kb_id: str, db: AsyncSession = Depends(get_db)):
    """Retry the pipeline resuming from existing saved checkpoints."""
    from ..db.models import KBEvent, KBStatus
    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
    result = await db.execute(
        select(KnowledgeBase).options(
            selectinload(KnowledgeBase.events),
            selectinload(KnowledgeBase.source_monitors)
        ).where(KnowledgeBase.id == val)
    )
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")
    
    # Keep existing checkpoints on disk for resume
    kb.status = KBStatus.queued
    event = KBEvent(
        kb_id=kb.id,
        event_type="pipeline_retried",
        payload={"status": "queued", "message": "Pipeline retry requested (resuming from saved checkpoints)"}
    )
    db.add(event)
    await db.commit()
    await db.refresh(kb)
    
    from ..workers.dispatcher import dispatch_generation_pipeline
    dispatch_generation_pipeline(str(kb.id))
    
    result = await db.execute(
        select(KnowledgeBase).options(
            selectinload(KnowledgeBase.events),
            selectinload(KnowledgeBase.source_monitors)
        ).where(KnowledgeBase.id == val)
    )
    return result.scalars().first()

@router.get("/api/v1/upload/presigned", dependencies=[Depends(kb_access(Cap.MANAGE_SOURCES))])
async def get_presigned_url(filename: str):
    url = generate_presigned_upload_url(filename)
    return {"url": url}

@router.post("/api/v1/upload/file", dependencies=[Depends(kb_access(Cap.MANAGE_SOURCES))])
async def upload_file(
    file: UploadFile = File(...),
    kb_id: str | None = None
):
    """Directly upload a file to GCS or local storage."""
    import uuid

    from ..services.local_storage import upload_content

    target_kb = kb_id or "shared_uploads"
    content_bytes = await file.read()
    try:
        content_str = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content_str = base64.b64encode(content_bytes).decode("utf-8")

    filename = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    storage_path = upload_content(target_kb, filename, content_str)
    return {
        "filename": file.filename,
        "storage_path": storage_path,
        "size_bytes": len(content_bytes),
        "status": "uploaded"
    }


@router.get("/api/v1/kb/{kb_id}/tree", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def get_kb_tree(kb_id: str, db: AsyncSession = Depends(get_db)):
    from ..services.gitops import get_github_client
    from ..services.local_storage import load_checkpoint_json
    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
    result = await db.execute(
        select(KnowledgeBase).where(KnowledgeBase.id == val)
    )
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")

    # Until the KB PR is merged, `main` only holds the repo stub: serve the compiled wiki instead.
    from ..db.models import KBStatus

    if kb.status != KBStatus.published:
        compiled_files = load_checkpoint_json(kb_id, "compiled_files.json")
        if compiled_files:
            return {"tree": [{"path": p, "type": "blob", "sha": "local"} for p in sorted(compiled_files.keys())]}

    if kb.git_repo_url:
        parts = kb.git_repo_url.split("/")
        if len(parts) >= 2:
            repo_full_name = f"{parts[-2]}/{parts[-1]}"
            try:
                g = get_github_client()
                repo = g.get_repo(repo_full_name)
                branch_name = repo.default_branch
                try:
                    branch = repo.get_branch(branch_name)
                except Exception:
                    branch = repo.get_branch("kb/initial-generation")
                tree = repo.get_git_tree(branch.commit.sha, recursive=True)
                return {"tree": [{"path": el.path, "type": el.type, "sha": el.sha} for el in tree.tree]}
            except Exception as e:
                logger.warning(f"Failed to fetch tree from GitHub for {repo_full_name}: {e}. Falling back to compiled checkpoints.")

    # Local / GCS checkpoint fallback
    compiled_files = load_checkpoint_json(kb_id, "compiled_files.json")
    if compiled_files:
        tree = [{"path": p, "type": "blob", "sha": "local"} for p in sorted(compiled_files.keys())]
        return {"tree": tree}

    raise HTTPException(status_code=404, detail="KB files not found")

@router.get("/api/v1/kb/{kb_id}/file", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def get_kb_file(kb_id: str, path: str, db: AsyncSession = Depends(get_db)):
    from ..services.gitops import get_github_client
    from ..services.local_storage import load_checkpoint_json
    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
    result = await db.execute(
        select(KnowledgeBase).where(KnowledgeBase.id == val)
    )
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")
        
    # Clean and normalize path
    clean_path = path.split("#")[0].strip()
    while clean_path.startswith(("./", "/")):  # strip "./" and "/" prefixes, but keep dot-dirs like ".nox/"
        clean_path = clean_path[2:] if clean_path.startswith("./") else clean_path[1:]
    if not clean_path.endswith(".md") and "." not in clean_path.split("/")[-1]:
        clean_path = f"{clean_path}.md"

    from ..db.models import KBStatus

    if kb.status != KBStatus.published:
        compiled_files = load_checkpoint_json(kb_id, "compiled_files.json") or {}
        if clean_path in compiled_files:
            return {"content": await _with_pins(db, kb_id, clean_path, compiled_files[clean_path])}

    if kb.git_repo_url:
        parts = kb.git_repo_url.split("/")
        if len(parts) >= 2:
            repo_full_name = f"{parts[-2]}/{parts[-1]}"
            try:
                g = get_github_client()
                repo = g.get_repo(repo_full_name)
                try:
                    file_content = repo.get_contents(clean_path)
                except Exception:
                    file_content = repo.get_contents(clean_path, ref="kb/initial-generation")
                if isinstance(file_content, list):
                    raise HTTPException(status_code=400, detail="Path is a directory")
                content = base64.b64decode(file_content.content).decode('utf-8')
                return {"content": await _with_pins(db, kb_id, clean_path, content)}
            except Exception as e:
                logger.warning(f"Failed to fetch file '{clean_path}' from GitHub: {e}. Falling back to compiled checkpoints.")

    # Local / GCS checkpoint fallback
    compiled_files = load_checkpoint_json(kb_id, "compiled_files.json")
    if compiled_files and clean_path in compiled_files:
        return {"content": await _with_pins(db, kb_id, clean_path, compiled_files[clean_path])}

    raise HTTPException(status_code=404, detail=f"File '{clean_path}' not found in KB")


@router.get("/api/v1/kb/{kb_id}/digest", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def get_kb_digest(kb_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch the compact architecture digest (<4,000 chars) for prompt injection."""
    from ..agents.digest import generate_architecture_digest
    from ..services.local_storage import load_checkpoint_json

    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
    result = await db.execute(select(KnowledgeBase).where(KnowledgeBase.id == val))
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")

    cached_files = load_checkpoint_json(kb_id, "compiled_files.json") or {}
    if ".nox/brief.md" in cached_files:
        digest = cached_files[".nox/brief.md"]
    else:
        digest = generate_architecture_digest(kb.app_name, "org", cached_files)

    return {"digest": digest, "char_count": len(digest), "app_name": kb.app_name}


@router.get("/api/v1/kb/{kb_id}/lint", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def get_kb_lint_report(kb_id: str, db: AsyncSession = Depends(get_db)):
    """Run the deterministic quality gate on the current knowledge base."""
    from ..agents.linter import run_linter
    from ..services.local_storage import load_checkpoint_json

    cached_files = load_checkpoint_json(kb_id, "compiled_files.json") or {}
    if not cached_files:
        raise HTTPException(status_code=404, detail="Compiled KB files not found")

    report = run_linter(cached_files)
    return report



@router.post("/api/v1/kb/{kb_id}/add-source", response_model=dict, dependencies=[Depends(kb_access(Cap.MANAGE_SOURCES))])
async def add_source_to_kb(kb_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    from ..db.models import MonitorMode, SourceMonitor
    from ..db.schemas import AddSourceRequest
    from ..services.gitops import register_push_webhook
    
    body = await request.json()
    source_req = AddSourceRequest(**body)
    
    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
        
    result = await db.execute(
        select(KnowledgeBase).options(
            selectinload(KnowledgeBase.events),
            selectinload(KnowledgeBase.source_monitors)
        ).where(KnowledgeBase.id == val)
    )
    kb = result.scalars().first()
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")
        
    # Check duplicates
    existing_urls = [m.target_url for m in (kb.source_monitors or [])]
    if source_req.url in existing_urls:
        return {
            "status": "duplicate",
            "message": f"Source {source_req.url} is already registered.",
            "source_added": None,
            "kb": kb
        }
        
    # Append to kb.source_urls
    sources = kb.source_urls or []
    new_source_dict = {
        "type": source_req.type,
        "url": source_req.url,
        "incremental_enabled": source_req.incremental_enabled,
        "config": source_req.config or {}
    }
    
    # We must explicitly set to trigger SQLAlchemy JSON update
    new_sources = list(sources)
    new_sources.append(new_source_dict)
    kb.source_urls = new_sources
    
    # Register source monitor
    webhook_id = None
    monitor_mode = MonitorMode.polling
    
    from ..core.config import settings
    if source_req.type == 'github' and settings.SOURCE_MONITOR_MODE == 'webhook':
        repo_name = "/".join(source_req.url.rstrip("/").split("/")[-2:])
        try:
            webhook_id = register_push_webhook(
                repo_name,
                f"{settings.WEBHOOK_BASE_URL}/api/webhooks/github/push"
            )
            monitor_mode = MonitorMode.webhook
        except Exception:
            monitor_mode = MonitorMode.polling

    new_monitor = SourceMonitor(
        kb_id=kb.id,
        source_type=source_req.type,
        repo_url=source_req.url,
        source_url=source_req.url,
        incremental_enabled=source_req.incremental_enabled,
        config=source_req.config or {},
        last_sync_state={},
        webhook_id=webhook_id,
        monitor_mode=monitor_mode,
    )
    db.add(new_monitor)
    await db.commit()
    await db.refresh(kb)
    
    # Trigger Pipeline Task
    from ..workers.dispatcher import dispatch_add_source_pipeline
    dispatch_add_source_pipeline(str(kb.id), new_source_dict)
    
    return {
        "status": "pipeline_started",
        "message": "Source added and incremental pipeline started",
        "source_added": new_source_dict,
        "kb": kb
    }


# ─────────────────────────────────────────────────────────────────
# PUBLIC (no-auth) endpoints for the `ap` CLI / NoX Skill
# ─────────────────────────────────────────────────────────────────

def _normalize_repo_url(url: str) -> str:
    """
    Normalize a Git repo URL for reliable comparison.
    Handles: https://github.com/org/repo.git  git@github.com:org/repo.git
    Returns:  github.com/org/repo  (lowercase, no protocol, no .git suffix)
    """
    import re
    url = url.strip().lower()
    # Convert SSH → HTTPS style: git@github.com:org/repo → github.com/org/repo
    url = re.sub(r'^git@([^:]+):', r'\1/', url)
    # Strip protocol prefix
    url = re.sub(r'^https?://', '', url)
    # Strip trailing .git
    url = re.sub(r'\.git$', '', url)
    # Strip trailing slash
    url = url.rstrip('/')
    return url


@router.get("/api/v1/cli/kb/discover", tags=["CLI"], dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def cli_discover_kb(repo_url: str, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Check whether a source repo URL has a NoX KB the caller can see.
    Used by `nox discover`.

    Returns KB metadata + linked KBs if found, or a list of all published KBs
    so the caller can pick the closest match.
    """
    from sqlalchemy.orm import selectinload

    from ..db.models import KBStatus

    normalized_query = _normalize_repo_url(repo_url)

    # Fetch all published KBs with their source monitors
    result = await db.execute(
        select(KnowledgeBase)
        .options(
            selectinload(KnowledgeBase.source_monitors),
            selectinload(KnowledgeBase.org),
        )
        .where(
            KnowledgeBase.status == KBStatus.published,
            KnowledgeBase.org_id.in_(await visible_org_ids(db, request.state.user)),
        )
    )
    all_kbs = result.scalars().all()

    matched_kb = None
    for kb in all_kbs:
        # Check against kb-level git_repo_url (the KB output repo — not the source)
        # and all source_urls / source monitor URLs
        candidate_urls = []
        if kb.source_urls:
            for src in kb.source_urls:
                if isinstance(src, dict):
                    candidate_urls.append(src.get("url", ""))
                elif isinstance(src, str):
                    candidate_urls.append(src)
        for monitor in (kb.source_monitors or []):
            candidate_urls.append(monitor.repo_url or "")
            candidate_urls.append(monitor.source_url or "")

        for candidate in candidate_urls:
            if candidate and _normalize_repo_url(candidate) == normalized_query:
                matched_kb = kb
                break
        if matched_kb:
            break

    if matched_kb:
        # Find linked KBs: other published KBs in the same org
        siblings = [
            {
                "kb_name": _kb_name(kb),
                "app_name": kb.app_name,
                "kb_repo_url": kb.git_repo_url,
                "status": kb.status.value,
            }
            for kb in all_kbs
            if kb.id != matched_kb.id and kb.org_id == matched_kb.org_id
        ]
        return {
            "found": True,
            "kb_name": _kb_name(matched_kb),
            "app_name": matched_kb.app_name,
            "kb_repo_url": matched_kb.git_repo_url,
            "status": matched_kb.status.value,
            "org_name": matched_kb.org.name if matched_kb.org else None,
            "org_slug": matched_kb.org.slug if matched_kb.org else None,
            "linked_kbs": siblings,
        }

    # Not found — return full list so the caller can offer alternatives
    suggestions = [
        {
            "kb_name": _kb_name(kb),
            "app_name": kb.app_name,
            "kb_repo_url": kb.git_repo_url,
            "status": kb.status.value,
            "org_name": kb.org.name if kb.org else None,
        }
        for kb in all_kbs
    ]
    return {
        "found": False,
        "kb_name": None,
        "kb_repo_url": None,
        "status": None,
        "linked_kbs": [],
        "suggestions": suggestions,
    }


@router.get("/api/v1/cli/kb/list", tags=["CLI"], dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def cli_list_kbs(request: Request, db: AsyncSession = Depends(get_db)):
    """
    List the NoX KBs the caller can see, with their status (published ones first).
    Used by `nox list`.
    """
    from sqlalchemy.orm import selectinload

    from ..db.models import KBStatus

    result = await db.execute(
        select(KnowledgeBase)
        .options(selectinload(KnowledgeBase.org))
        .where(KnowledgeBase.org_id.in_(await visible_org_ids(db, request.state.user)))
        .order_by(KnowledgeBase.updated_at.desc())
    )
    kbs = sorted(result.scalars().all(), key=lambda k: k.status != KBStatus.published)
    return [
        {
            "kb_name": _kb_name(kb),
            "app_name": kb.app_name,
            "kb_repo_url": kb.git_repo_url,
            "status": kb.status.value,
            "org_name": kb.org.name if kb.org else None,
            "org_slug": kb.org.slug if kb.org else None,
            "updated_at": kb.updated_at.isoformat() if kb.updated_at else None,
        }
        for kb in kbs
    ]


@router.post("/api/v1/kb/{kb_id}/guard", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def check_diff_constraints(kb_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Evaluate an incoming git diff or prompt against active architectural constraints."""
    from ..agents.guard import evaluate_diff_against_constraints, extract_constraints_from_kb
    from ..services.local_storage import load_checkpoint_json

    body = await request.json()
    diff_text = body.get("diff", "")
    if not diff_text:
        raise HTTPException(status_code=400, detail="Missing 'diff' field in request body")

    cached_files = load_checkpoint_json(kb_id, "compiled_files.json") or {}
    constraints = extract_constraints_from_kb(cached_files)
    violations = evaluate_diff_against_constraints(diff_text, constraints)

    return {
        "is_compliant": len(violations) == 0,
        "total_constraints_evaluated": len(constraints),
        "violations": violations,
    }

class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    session_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{8,64}$")


async def _ask_scope(db: AsyncSession, kb_id: str, request: Request) -> tuple[KnowledgeBase, dict[str, str]]:
    kb = await db.get(KnowledgeBase, UUID(kb_id))
    if not kb:
        raise HTTPException(status_code=404, detail="KB not found")
    apps = {k.app_name: str(k.id) for k in await _visible_kbs(db, request)}
    apps[kb.app_name] = str(kb.id)
    return kb, apps


@router.post("/api/v1/kb/{kb_id}/ask")
async def ask_kb(kb_id: str, body: AskRequest, request: Request, db: AsyncSession = Depends(get_db),
                 actor: Actor = Depends(kb_access(Cap.SEE_ATLAS))):
    """Ask about an application. Streams SSE: `step` (a lookup the agent makes), `delta` (answer text),
    `citations`, `usage`, `done` — or `error`."""
    import uuid as _uuid

    from ..ai.agents import ask

    kb, apps = await _ask_scope(db, kb_id, request)
    session_id = f"ask-{kb.id.hex[:12]}-{body.session_id or _uuid.uuid4().hex}"

    async def events():
        try:
            async for ev in ask.answer(body.question, home_app=kb.app_name, apps=apps, role=actor.role.value,
                                       user_id=str(actor.user.id), session_id=session_id, org_id=kb.org_id, kb_id=kb.id):
                if await request.is_disconnected():
                    break
                yield {"event": ev["type"], "data": json.dumps(ev, default=str)}
        except Exception as e:
            logger.exception(f"Ask failed for KB {kb_id}")
            yield {"event": "error", "data": json.dumps({"type": "error", "message": _friendly_ai_error(e)})}

    return EventSourceResponse(events(), headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


def _friendly_ai_error(e: Exception) -> str:
    msg = str(e)
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower():
        return "The model is busy right now (quota). Try again in a moment."
    if "503" in msg or "UNAVAILABLE" in msg:
        return "The model is under heavy load. Try again in a moment."
    return "NoX couldn't answer that just now. Try again in a moment."


@router.get("/api/v1/kb/{kb_id}/shield")
async def kb_shield(kb_id: str, db: AsyncSession = Depends(get_db), actor: Actor = Depends(kb_access(Cap.SEE_ATLAS))):
    """What NoX Shield screened and withheld for this application. Withheld source names are shown to the
    Engineering lead and Developer seats; other seats see the counts."""
    from ..db.models import KBEvent, Role, ShieldFinding
    from ..services import shield

    kb = await db.get(KnowledgeBase, UUID(kb_id))
    events = (await db.execute(select(KBEvent).where(KBEvent.kb_id == kb.id, KBEvent.event_type == "shield_screened")
                               .order_by(KBEvent.created_at.desc()).limit(1))).scalars().first()
    rows = (await db.execute(select(ShieldFinding).where(ShieldFinding.kb_id == kb.id).order_by(ShieldFinding.created_at.desc())
                             .limit(200))).scalars().all()
    withheld: dict[str, dict] = {}
    for r in rows:
        if r.action == "withheld" and r.source not in withheld:
            withheld[r.source] = {"source": r.source, "category": r.category, "at": r.created_at.isoformat() if r.created_at else None}
    last = (events.payload or {}) if events else {}
    see_sources = actor.role in (Role.engineering, Role.developer)
    return {
        "mode": shield.mode(),
        "screened": last.get("documents", 0),
        "withheldCount": len(withheld),
        "unscreened": last.get("unscreened", 0),
        "lastScreenedAt": events.created_at.isoformat() if events and events.created_at else None,
        "withheld": list(withheld.values()) if see_sources else [],
        "findings": len(rows),
    }


@router.post("/api/v1/kb/{kb_id}/chat")
async def chat_with_kb(kb_id: str, request: Request, db: AsyncSession = Depends(get_db),
                       actor: Actor = Depends(kb_access(Cap.SEE_ATLAS))):
    """Non-streaming Ask, for scripts and the CLI: the same agent, one JSON answer."""
    from ..ai.agents import ask

    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Missing 'prompt' field")
    kb, apps = await _ask_scope(db, kb_id, request)
    import uuid as _uuid

    answer, citations = "", []
    try:
        async for ev in ask.answer(prompt, home_app=kb.app_name, apps=apps, role=actor.role.value,
                                   user_id=str(actor.user.id), session_id=f"chat-{_uuid.uuid4().hex}",
                                   org_id=kb.org_id, kb_id=kb.id):
            if ev["type"] == "done":
                answer = ev["text"]
            elif ev["type"] == "citations":
                citations = ev["refs"]
    except Exception as e:
        logger.error(f"LLM API Error during chat: {e}")
        return {"response": _friendly_ai_error(e), "citations": []}
    return {"response": answer, "citations": citations}

@router.get("/api/v1/kb/{kb_id}/export-skill", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def export_kb_skill(kb_id: str, db: AsyncSession = Depends(get_db)):
    """Export the KB as a single XML block for AI context."""
    from ..services.local_storage import load_checkpoint_json
    try:
        val = UUID(kb_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="KB not found")
        
    compiled_files = load_checkpoint_json(kb_id, "compiled_files.json") or {}
    if not compiled_files:
        raise HTTPException(status_code=404, detail="Compiled KB not found")
        
    xml_output = "<architecture_context>\n"
    for file_path, content in compiled_files.items():
        if file_path.endswith(".md"):
            xml_output += f"  <file path=\"{file_path}\">\n"
            xml_output += f"    <![CDATA[\n{content}\n    ]]>\n"
            xml_output += "  </file>\n"
    xml_output += "</architecture_context>"
    
    return {"skill_prompt": xml_output}


# ── Pinned human corrections ──────────────────────────────────────────────────


class PinCreate(BaseModel):
    page_path: str = Field(alias="pagePath", min_length=1)
    text: str = Field(min_length=3, max_length=2000)


def _pin_json(p) -> dict:
    return {"id": str(p.id), "pagePath": p.page_path, "text": p.text, "authorName": p.author_name,
            "createdAt": p.created_at.isoformat() if p.created_at else None}


@router.get("/api/v1/kb/{kb_id}/pins", dependencies=[Depends(kb_access(Cap.SEE_ATLAS))])
async def list_pins(kb_id: str, db: AsyncSession = Depends(get_db)):
    from ..services.pins import pins_by_page

    return [_pin_json(p) for pins in (await pins_by_page(db, kb_id)).values() for p in pins]


@router.post("/api/v1/kb/{kb_id}/pins")
async def create_pin(kb_id: str, body: PinCreate, db: AsyncSession = Depends(get_db), actor: Actor = Depends(kb_access(Cap.PIN_CORRECTION))):
    """Pin a correction to a page. It shows immediately and is re-applied to every future recompilation."""
    from ..db.models import KBPin
    from ..services.local_storage import load_checkpoint_json, save_checkpoint_json
    from ..services.pins import pins_by_page, render_pins

    pin = KBPin(kb_id=UUID(kb_id), page_path=body.page_path.lstrip("/"), text=body.text.strip(),
                author_id=actor.user.id, author_name=actor.user.name or actor.user.email)
    db.add(pin)
    await db.commit()
    await db.refresh(pin)
    compiled = load_checkpoint_json(kb_id, "compiled_files.json") or {}
    if pin.page_path in compiled:
        compiled[pin.page_path] = render_pins(compiled[pin.page_path], (await pins_by_page(db, kb_id))[pin.page_path])
        save_checkpoint_json(kb_id, "compiled_files.json", compiled)
    return _pin_json(pin)


@router.delete("/api/v1/kb/{kb_id}/pins/{pin_id}")
async def delete_pin(kb_id: str, pin_id: UUID, db: AsyncSession = Depends(get_db), actor: Actor = Depends(kb_access(Cap.PIN_CORRECTION))):
    from ..db.models import KBPin
    from ..services.local_storage import load_checkpoint_json, save_checkpoint_json
    from ..services.pins import pins_by_page, render_pins

    pin = await db.get(KBPin, pin_id)
    if not pin or str(pin.kb_id) != kb_id:
        raise HTTPException(status_code=404, detail="Pin not found")
    path = pin.page_path
    await db.delete(pin)
    await db.commit()
    compiled = load_checkpoint_json(kb_id, "compiled_files.json") or {}
    if path in compiled:
        compiled[path] = render_pins(compiled[path], (await pins_by_page(db, kb_id)).get(path, []))
        save_checkpoint_json(kb_id, "compiled_files.json", compiled)
    return {"status": "deleted"}
