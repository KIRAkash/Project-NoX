import asyncio
import logging

from celery import Celery
from celery.signals import worker_init, worker_process_init

from ..core.config import settings

logger = logging.getLogger(__name__)

celery_app = Celery(
    'nox',
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
)


@worker_init.connect
@worker_process_init.connect
def _start_tracing(**_):
    """Spans from jobs go to Cloud Trace too: once per worker (threads pool) or per child process (prefork)."""
    from ..ai import tracing

    tracing.setup("nox-worker")


def _run_async(coro):
    """Run an async coroutine from a sync Celery task."""
    return asyncio.run(coro)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def generation_pipeline_task(self, kb_id: str):
    from ..agents.runner import run_generation_pipeline
    from ..services.sse import SSEManager
    from .db_session import get_db_sync
    try:
        async def _execute():
            async with get_db_sync() as db:
                sse = SSEManager()
                await run_generation_pipeline(kb_id, db, sse)
        _run_async(_execute())
    except Exception as exc:
        logger.exception(f"generation_pipeline_task failed for {kb_id}: {exc}")
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def gatekeeper_pipeline_task(
    self,
    kb_id: str,
    diff: str,
    commit_sha: str = None,
    commit_message: str = None,
    source_type: str = "github",
    source_url: str = None,
    affected_items: list = None,
    author: str = None,
    summary: str = None,
    **kwargs
):
    from ..agents.runner import run_gatekeeper_pipeline
    from ..services.sse import SSEManager
    from .db_session import get_db_sync
    try:
        async def _execute():
            async with get_db_sync() as db:
                sse = SSEManager()
                await run_gatekeeper_pipeline(
                    kb_id,
                    diff,
                    db,
                    sse,
                    commit_sha=commit_sha,
                    commit_message=commit_message,
                    source_type=source_type,
                    source_url=source_url,
                    affected_items=affected_items,
                    author=author,
                    summary=summary,
                )
        _run_async(_execute())
    except Exception as exc:
        logger.exception(f"gatekeeper_pipeline_task failed for {kb_id}: {exc}")
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def rollup_pipeline_task(self, org_id: str):
    from ..agents.runner import run_rollup_pipeline
    from ..services.sse import SSEManager
    from .db_session import get_db_sync
    try:
        async def _execute():
            async with get_db_sync() as db:
                sse = SSEManager()
                await run_rollup_pipeline(org_id, db, sse)
        _run_async(_execute())
    except Exception as exc:
        logger.exception(f"rollup_pipeline_task failed for {org_id}: {exc}")
        raise self.retry(exc=exc)


@celery_app.task
def poll_sources():
    """Universal polling worker for Flow B — checks all active sources (GitHub, Confluence, Notion, Slack, Jira)."""
    from datetime import datetime

    from sqlalchemy import select

    from ..agents.runner import run_gatekeeper_pipeline
    from ..connectors import check_source_updates
    from ..db.models import MonitorMode, SourceMonitor
    from ..services.sse import SSEManager
    from .db_session import get_db_sync

    async def _poll():
        async with get_db_sync() as db:
            sse = SSEManager()

            result = await db.execute(
                select(SourceMonitor).where(
                    (SourceMonitor.incremental_enabled == True) &
                    (SourceMonitor.monitor_mode == MonitorMode.polling)
                )
            )
            monitors = result.scalars().all()

            for monitor in monitors:
                try:
                    last_state = monitor.last_sync_state or {}
                    if monitor.last_commit_sha and "last_commit_sha" not in last_state:
                        last_state["last_commit_sha"] = monitor.last_commit_sha

                    delta = await check_source_updates(
                        source_type=monitor.source_type,
                        url=monitor.target_url,
                        last_state=last_state,
                        config=monitor.config or {},
                    )

                    if delta.has_changes and delta.delta_content:
                        logger.info(f"Incremental change detected on {monitor.source_type} ({monitor.target_url}): {delta.summary}")
                        monitor.last_sync_state = delta.new_state
                        if "last_commit_sha" in delta.new_state:
                            monitor.last_commit_sha = delta.new_state["last_commit_sha"]
                        monitor.last_synced_at = datetime.utcnow()
                        await db.commit()

                        # Trigger Gatekeeper Pipeline
                        await run_gatekeeper_pipeline(
                            kb_id=str(monitor.kb_id),
                            diff=delta.delta_content,
                            db=db,
                            sse=sse,
                            commit_sha=delta.new_state.get("last_commit_sha") or delta.new_state.get("latest_ts"),
                            commit_message=delta.summary,
                            source_type=delta.source_type,
                            source_url=delta.source_url,
                            affected_items=delta.affected_items,
                            author=delta.author,
                            summary=delta.summary,
                        )
                    else:
                        monitor.last_synced_at = datetime.utcnow()
                        await db.commit()

                except Exception as e:
                    logger.warning(f"Poll failed for {monitor.source_type} ({monitor.target_url}): {e}")

    _run_async(_poll())


# ── Celery Beat Schedule (polling fallback) ────────────────────────────────────
def configure_beat_schedule() -> None:
    """Schedule polling when SOURCE_MONITOR_MODE is 'polling'.

    Task names come from the task objects, so the schedule always matches
    what the worker registered.
    """
    if settings.SOURCE_MONITOR_MODE == 'polling':
        celery_app.conf.beat_schedule = {
            'poll-source-repos-every-5-min': {
                'task': poll_sources.name,
                'schedule': 300.0,  # Every 5 minutes
            },
        }


configure_beat_schedule()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def add_source_pipeline_task(self, kb_id: str, source: dict):
    from ..agents.runner import run_add_source_pipeline
    from ..services.sse import SSEManager
    from .db_session import get_db_sync
    try:
        async def _execute():
            async with get_db_sync() as db:
                sse = SSEManager()
                await run_add_source_pipeline(kb_id, source, db, sse)
        _run_async(_execute())
    except Exception as exc:
        logger.exception(f"add_source_pipeline_task failed for {kb_id}: {exc}")
        raise self.retry(exc=exc)


# ── Sightings (CP18) ───────────────────────────────────────────────────────────


@celery_app.task(bind=True, max_retries=1, default_retry_delay=60)
def sightings_run_task(self, run_id: str, force: bool = False):
    from ..missions.sightings import run_sightings

    _run_async(run_sightings(run_id, force=force))


@celery_app.task
def sightings_tick():
    """Start every Sightings run that is due. Runs on beat locally; Cloud Scheduler calls the API's tick in the cloud."""
    from ..missions.sightings import tick

    _run_async(tick())


@celery_app.task
def jules_tick():
    """Poll active Jules sessions: the safety net behind the watcher each hand-off starts in the API."""
    from ..missions.jules import tick

    return _run_async(tick())


celery_app.conf.beat_schedule = {
    **(celery_app.conf.beat_schedule or {}),
    "sightings-tick-every-15-min": {"task": sightings_tick.name, "schedule": 900.0},
    "jules-tick-every-minute": {"task": jules_tick.name, "schedule": 60.0},
}
