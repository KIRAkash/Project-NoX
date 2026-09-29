import logging
from collections.abc import Callable
from typing import Any, Dict, Optional, Type

import httpx

from .base import (
    BaseConnector,
    IncrementalDelta,
    IngestionAuthError,
    IngestionError,
    IngestionRateLimitError,
)
from .confluence_source import ConfluenceConnector, fetch_confluence_space
from .file_upload_source import FileUploadConnector, process_uploaded_file
from .github_source import GitHubConnector, fetch_github_repo
from .jira_source import JiraConnector, fetch_jira_project
from .notion_source import NotionConnector, fetch_notion_page
from .slack_source import SlackConnector, fetch_slack_channel

logger = logging.getLogger(__name__)

# Extensible Connector Registry
CONNECTOR_REGISTRY: dict[str, type[BaseConnector]] = {
    'github': GitHubConnector,
    'confluence': ConfluenceConnector,
    'notion': NotionConnector,
    'slack': SlackConnector,
    'jira': JiraConnector,
    'upload': FileUploadConnector,
}

TOKEN_KEY_MAP: dict[str, str | None] = {
    'github': 'GITHUB_APP_TOKEN',
    'confluence': 'CONFLUENCE_API_TOKEN',
    'notion': 'NOTION_API_TOKEN',
    'slack': 'SLACK_BOT_TOKEN',
    'jira': 'JIRA_API_TOKEN',
    'upload': None,
}

def register_connector(source_type: str, connector_cls: type[BaseConnector], token_key: str | None = None):
    """Register a new custom source connector into NoX."""
    CONNECTOR_REGISTRY[source_type.lower()] = connector_cls
    if token_key:
        TOKEN_KEY_MAP[source_type.lower()] = token_key
    logger.info(f"Registered connector '{source_type}' -> {connector_cls.__name__}")

def get_connector(source_type: str, client: httpx.AsyncClient, concurrency_limit: int = 10) -> BaseConnector:
    """Instantiate connector instance by source type."""
    st = source_type.lower()
    if st not in CONNECTOR_REGISTRY:
        raise ValueError(f"Unknown source type '{source_type}'. Available: {list(CONNECTOR_REGISTRY.keys())}")
    connector_cls = CONNECTOR_REGISTRY[st]
    return connector_cls(client, concurrency_limit=concurrency_limit)

async def ingest_source(
    source_type: str,
    url: str,
    tokens: dict | None = None,
    config: dict | None = None,
    on_progress: Callable[[str, dict[str, Any]], Any] | None = None
) -> str:
    """Universal ingestion entry point for any registered source."""
    tokens = tokens or {}
    token_key = TOKEN_KEY_MAP.get(source_type.lower())
    token = tokens.get(token_key) if token_key else None

    # Fallback check directly from env if not provided in dictionary
    if not token and token_key:
        from ..core.config import get_env_var, settings
        token = get_env_var(token_key, getattr(settings, token_key, ""))

    async with httpx.AsyncClient(timeout=45.0) as client:
        connector = get_connector(source_type, client)
        return await connector.ingest(url, token, config=config, on_progress=on_progress)

async def check_source_updates(
    source_type: str,
    url: str,
    token: str | None = None,
    last_state: dict | None = None,
    config: dict | None = None,
) -> IncrementalDelta:
    """Universal incremental change detection for any registered source."""
    if not token:
        token_key = TOKEN_KEY_MAP.get(source_type.lower())
        if token_key:
            from ..core.config import get_env_var, settings
            token = get_env_var(token_key, getattr(settings, token_key, ""))

    async with httpx.AsyncClient(timeout=45.0) as client:
        connector = get_connector(source_type, client)
        return await connector.check_incremental_updates(url, token, last_state=last_state, config=config)

