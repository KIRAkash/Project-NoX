import asyncio
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx


class IngestionError(Exception):
    """Generic pipeline/network error."""
    pass

class IngestionAuthError(IngestionError):
    """Raised on 401/403 credentials failures."""
    pass

class IngestionRateLimitError(IngestionError):
    """Raised on 429 rate limits."""
    pass

@dataclass
class IncrementalDelta:
    has_changes: bool
    delta_content: str = ""
    summary: str = ""
    new_state: dict[str, Any] = field(default_factory=dict)
    affected_items: list[str] = field(default_factory=list)
    source_type: str = ""
    source_url: str = ""
    author: str = "System"

class BaseConnector(ABC):
    def __init__(self, client: httpx.AsyncClient, concurrency_limit: int = 10):
        self.client = client
        self.semaphore = asyncio.Semaphore(concurrency_limit)

    @abstractmethod
    async def ingest(
        self,
        url: str,
        token: str | None,
        config: dict[str, Any] | None = None,
        on_progress: Callable[[str, dict[str, Any]], Any] | None = None
    ) -> str:
        """Asynchronously ingest and format the content of the target source."""
        pass

    async def check_incremental_updates(
        self,
        url: str,
        token: str | None,
        last_state: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None
    ) -> IncrementalDelta:
        """Check for new or modified content since last_state.
        Default implementation returns no changes unless overridden by connector.
        """
        return IncrementalDelta(
            has_changes=False,
            delta_content="",
            summary="Incremental updates not supported for this connector",
            new_state=last_state or {},
            source_url=url,
        )

