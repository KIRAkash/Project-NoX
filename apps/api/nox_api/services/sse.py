"""Live pipeline events for SSE clients.

Pipelines run in the API process or in Celery workers, so events go through Redis pub/sub
(channel `nox:events:<key>`): any process can publish, and each SSE subscriber in the API
process listens on the channel. If Redis is unreachable, events fall back to in-memory
queues, which only reach subscribers in the same process.
"""

import asyncio
import json
import logging

import redis.asyncio as aioredis

from ..core.config import settings

logger = logging.getLogger(__name__)

CHANNEL_PREFIX = "nox:events:"


def _channel(key: str) -> str:
    return f"{CHANNEL_PREFIX}{key}"


class SSEManager:
    def __init__(self):
        self.connections: dict[str, list[asyncio.Queue]] = {}
        self._pumps: dict[int, tuple[asyncio.Task, object]] = {}
        self._redis: aioredis.Redis | None = None

    def _client(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        return self._redis

    async def subscribe(self, key: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self.connections.setdefault(key, []).append(queue)
        try:
            pubsub = self._client().pubsub()
            await pubsub.subscribe(_channel(key))
            self._pumps[id(queue)] = (asyncio.create_task(self._pump(pubsub, queue)), pubsub)
        except Exception as exc:  # Redis down: in-memory delivery only
            logger.warning(f"SSE subscribe falling back to in-memory for {key}: {exc}")
        return queue

    async def _pump(self, pubsub, queue: asyncio.Queue) -> None:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            try:
                await queue.put(json.loads(message["data"]))
            except (TypeError, ValueError):
                logger.warning("Dropping malformed SSE message")

    async def unsubscribe(self, key: str, queue: asyncio.Queue) -> None:
        if key in self.connections and queue in self.connections[key]:
            self.connections[key].remove(queue)
            if not self.connections[key]:
                del self.connections[key]
        pump = self._pumps.pop(id(queue), None)
        if pump:
            task, pubsub = pump
            task.cancel()
            try:
                await pubsub.unsubscribe()
                await pubsub.aclose()
            except Exception:
                pass

    async def broadcast(self, key: str, event: dict) -> None:
        try:
            await self._client().publish(_channel(key), json.dumps(event, default=str))
            return
        except Exception as exc:
            logger.warning(f"SSE publish to Redis failed, delivering in-process only: {exc}")
        for queue in self.connections.get(key, []):
            await queue.put(event)


_global_sse_manager: SSEManager | None = None


def get_sse_manager() -> SSEManager:
    """Get or create the process-wide SSEManager used by the API's stream endpoints."""
    global _global_sse_manager
    if _global_sse_manager is None:
        _global_sse_manager = SSEManager()
    return _global_sse_manager
