"""Fire-and-forget background jobs inside the API process.

Used for interactive, I/O-bound work (drafting and refining spec files) where queueing behind the
Celery worker would make the UI wait. Heavy knowledge-base pipelines keep using workers/dispatcher.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)
_running: set[asyncio.Task] = set()


def spawn(name: str, fn: Callable[..., Awaitable[None]], *args) -> None:
    async def _run():
        try:
            await fn(*args)
        except Exception:
            logger.exception(f"background job {name} failed")

    task = asyncio.get_running_loop().create_task(_run(), name=name)
    _running.add(task)  # keep a reference so the task isn't garbage-collected mid-flight
    task.add_done_callback(_running.discard)
