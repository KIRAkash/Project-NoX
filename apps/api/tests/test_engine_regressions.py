"""Regressions for bugs found while porting the engine."""

import asyncio
import socket

import pytest


def _redis_up() -> bool:
    try:
        socket.create_connection(("localhost", 6379), timeout=0.5).close()
        return True
    except OSError:
        return False


def test_kb_resolve_is_matched_before_kb_id():
    """`/kb/resolve` must be registered before `/kb/{kb_id}` or it is swallowed as kb_id='resolve'."""
    from nox_api.routers import kb

    paths = [r.path for r in kb.router.routes]
    assert paths.index("/api/v1/kb/resolve") < paths.index("/api/v1/kb/{kb_id}")


def test_rollup_pipeline_names_resolve():
    """Flow C referenced select/selectinload/OrgKB/provision_org_kb_repo without importing them."""
    from nox_api.agents import runner

    for name in ("select", "selectinload", "OrgKB", "provision_org_kb_repo"):
        assert hasattr(runner, name), name


@pytest.mark.skipif(not _redis_up(), reason="needs Redis on localhost:6379")
async def test_sse_events_cross_managers_via_redis():
    """A pipeline in a worker process uses its own SSEManager; subscribers must still receive its events."""
    from nox_api.services.sse import SSEManager

    subscriber, publisher = SSEManager(), SSEManager()
    queue = await subscriber.subscribe("test-kb")
    await asyncio.sleep(0.2)  # let the Redis subscription settle
    await publisher.broadcast("test-kb", {"type": "pipeline_started", "payload": {"n": 1}})
    event = await asyncio.wait_for(queue.get(), timeout=3)
    await subscriber.unsubscribe("test-kb", queue)
    assert event == {"type": "pipeline_started", "payload": {"n": 1}}
