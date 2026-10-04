import asyncio
import logging
import os

from ..core.config import settings

logger = logging.getLogger(__name__)


def is_in_process_mode() -> bool:
    """Determine whether tasks should run in-process (background tasks) or via Celery.
    
    - 'in_process' / 'background': Always runs directly in FastAPI's event loop.
    - 'celery': Always uses Celery worker with Redis broker.
    - 'auto': Automatically uses in_process when deployed on Cloud Run (K_SERVICE set)
              or when DEPLOYMENT_MODE='cloud'.
    """
    worker_mode = (getattr(settings, "WORKER_MODE", "auto") or "auto").lower()
    if worker_mode in ("in_process", "background", "asyncio"):
        return True
    if worker_mode == "celery":
        return False
    # Cloud Run automatically injects K_SERVICE
    if os.getenv("K_SERVICE") or os.getenv("DEPLOYMENT_MODE") == "cloud":
        return True
    return False


def dispatch_generation_pipeline(kb_id: str):
    """Dispatch KB generation pipeline in-process or via Celery."""
    if is_in_process_mode():
        logger.info(f"Dispatching generation pipeline in-process (background task) for KB: {kb_id}")
        _launch_in_process_generation(kb_id)
    else:
        try:
            from .tasks import generation_pipeline_task
            logger.info(f"Dispatching generation pipeline via Celery for KB: {kb_id}")
            generation_pipeline_task.delay(kb_id)
        except Exception as exc:
            logger.warning(
                f"Failed to dispatch to Celery broker ({exc}), falling back to in-process background execution for KB: {kb_id}"
            )
            _launch_in_process_generation(kb_id)


def _launch_in_process_generation(kb_id: str):
    async def _runner():
        from ..agents.runner import run_generation_pipeline
        from ..services.sse import get_sse_manager
        from .db_session import get_db_sync
        try:
            async with get_db_sync() as db:
                sse = get_sse_manager()
                await run_generation_pipeline(kb_id, db, sse)
        except Exception as exc:
            logger.exception(f"In-process generation pipeline failed for KB {kb_id}: {exc}")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        asyncio.run(_runner())


def dispatch_gatekeeper_pipeline(
    kb_id: str,
    diff: str,
    commit_sha: str | None = None,
    commit_message: str | None = None,
    source_type: str = "github",
    source_url: str | None = None,
    affected_items: list[str] | None = None,
    author: str | None = None,
    summary: str | None = None,
    **kwargs
):
    """Dispatch Gatekeeper pipeline in-process or via Celery."""
    if is_in_process_mode():
        logger.info(f"Dispatching gatekeeper pipeline in-process for KB: {kb_id}")
        _launch_in_process_gatekeeper(
            kb_id=kb_id,
            diff=diff,
            commit_sha=commit_sha,
            commit_message=commit_message,
            source_type=source_type,
            source_url=source_url,
            affected_items=affected_items,
            author=author,
            summary=summary,
            **kwargs
        )
    else:
        try:
            from .tasks import gatekeeper_pipeline_task
            logger.info(f"Dispatching gatekeeper pipeline via Celery for KB: {kb_id}")
            gatekeeper_pipeline_task.delay(
                kb_id=kb_id,
                diff=diff,
                commit_sha=commit_sha,
                commit_message=commit_message,
                source_type=source_type,
                source_url=source_url,
                affected_items=affected_items,
                author=author,
                summary=summary,
                **kwargs
            )
        except Exception as exc:
            logger.warning(
                f"Failed to dispatch to Celery broker ({exc}), falling back to in-process background execution for KB: {kb_id}"
            )
            _launch_in_process_gatekeeper(
                kb_id=kb_id,
                diff=diff,
                commit_sha=commit_sha,
                commit_message=commit_message,
                source_type=source_type,
                source_url=source_url,
                affected_items=affected_items,
                author=author,
                summary=summary,
                **kwargs
            )


def _launch_in_process_gatekeeper(
    kb_id: str,
    diff: str,
    commit_sha: str | None = None,
    commit_message: str | None = None,
    source_type: str = "github",
    source_url: str | None = None,
    affected_items: list[str] | None = None,
    author: str | None = None,
    summary: str | None = None,
    **kwargs
):
    async def _runner():
        from ..agents.runner import run_gatekeeper_pipeline
        from ..services.sse import get_sse_manager
        from .db_session import get_db_sync
        try:
            async with get_db_sync() as db:
                sse = get_sse_manager()
                await run_gatekeeper_pipeline(
                    kb_id=kb_id,
                    diff=diff,
                    db=db,
                    sse=sse,
                    commit_sha=commit_sha,
                    commit_message=commit_message,
                    source_type=source_type,
                    source_url=source_url,
                    affected_items=affected_items,
                    author=author,
                    summary=summary,
                )
        except Exception as exc:
            logger.exception(f"In-process gatekeeper pipeline failed for KB {kb_id}: {exc}")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        asyncio.run(_runner())


def dispatch_rollup_pipeline(org_id: str):
    """Dispatch rollup pipeline in-process or via Celery."""
    if is_in_process_mode():
        logger.info(f"Dispatching rollup pipeline in-process for Org: {org_id}")
        _launch_in_process_rollup(org_id)
    else:
        try:
            from .tasks import rollup_pipeline_task
            logger.info(f"Dispatching rollup pipeline via Celery for Org: {org_id}")
            rollup_pipeline_task.delay(org_id)
        except Exception as exc:
            logger.warning(
                f"Failed to dispatch to Celery broker ({exc}), falling back to in-process background execution for Org: {org_id}"
            )
            _launch_in_process_rollup(org_id)


def _launch_in_process_rollup(org_id: str):
    async def _runner():
        from ..agents.runner import run_rollup_pipeline
        from ..services.sse import get_sse_manager
        from .db_session import get_db_sync
        try:
            async with get_db_sync() as db:
                sse = get_sse_manager()
                await run_rollup_pipeline(org_id, db, sse)
        except Exception as exc:
            logger.exception(f"In-process rollup pipeline failed for Org {org_id}: {exc}")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        asyncio.run(_runner())


def dispatch_add_source_pipeline(kb_id: str, source: dict):
    """Dispatch add-source pipeline in-process or via Celery."""
    if is_in_process_mode():
        logger.info(f"Dispatching add-source pipeline in-process for KB: {kb_id}")
        _launch_in_process_add_source(kb_id, source)
    else:
        try:
            from .tasks import add_source_pipeline_task
            logger.info(f"Dispatching add-source pipeline via Celery for KB: {kb_id}")
            add_source_pipeline_task.delay(kb_id, source)
        except Exception as exc:
            logger.warning(
                f"Failed to dispatch to Celery broker ({exc}), falling back to in-process background execution for KB: {kb_id}"
            )
            _launch_in_process_add_source(kb_id, source)


def _launch_in_process_add_source(kb_id: str, source: dict):
    async def _runner():
        from ..agents.runner import run_add_source_pipeline
        from ..services.sse import get_sse_manager
        from .db_session import get_db_sync
        try:
            async with get_db_sync() as db:
                sse = get_sse_manager()
                await run_add_source_pipeline(kb_id, source, db, sse)
        except Exception as exc:
            logger.exception(f"In-process add source pipeline failed for KB {kb_id}: {exc}")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        asyncio.run(_runner())


def dispatch_sightings_run(run_id: str, force: bool = False):
    """Dispatch one Sightings run (CP18) in-process or via Celery. The run row already exists."""
    if not is_in_process_mode():
        try:
            from .tasks import sightings_run_task
            logger.info(f"Dispatching sightings run via Celery: {run_id}")
            sightings_run_task.delay(run_id, force)
            return
        except Exception as exc:
            logger.warning(f"Failed to dispatch to Celery broker ({exc}), running sightings {run_id} in-process")
    from ..jobs import spawn
    from ..missions.sightings import run_sightings

    async def _runner():
        await run_sightings(run_id, force=force)

    try:
        asyncio.get_running_loop()
        spawn(f"sightings {run_id}", _runner)
    except RuntimeError:
        asyncio.run(_runner())
