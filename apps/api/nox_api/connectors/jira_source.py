import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from ..core.time_utils import now_utc

import httpx

from ..core.config import settings
from ..integrations.atlassian import AtlassianConfigError
from ..integrations.jira import (
    JiraAuthError,
    JiraClient,
    JiraError,
    JiraRateLimitError,
    adf_to_text,
)
from .base import BaseConnector, IncrementalDelta, IngestionAuthError, IngestionError, IngestionRateLimitError

logger = logging.getLogger(__name__)

def _parse_jira_url(url: str, config: dict[str, Any] | None = None) -> tuple:
    """Extract domain and project key from Jira URL or config."""
    if config and config.get("domain") and config.get("project_key"):
        domain = config["domain"].rstrip('/')
        if not domain.startswith("http"):
            domain = f"https://{domain}"
        return domain, config["project_key"].strip()

    parsed = urlparse(url)
    domain = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else settings.ATLASSIAN_BASE_URL
    
    # Check for query params (e.g., projectKey=PROJ)
    if 'projectKey=' in url:
        project_key = url.split('projectKey=')[-1].split('&')[0]
        return domain, project_key

    path_parts = [p for p in parsed.path.split('/') if p and p not in ('browse', 'jira', 'projects', 'boards')]
    project_key = path_parts[-1] if path_parts else url.strip()
    return domain, project_key

def _jira_client(client: httpx.AsyncClient, token: str | None, domain: str) -> JiraClient:
    try:
        return JiraClient(client, token=token, base_url=domain)
    except AtlassianConfigError as e:
        raise IngestionAuthError(f"Jira is not configured: {e}") from e


def _raise_ingestion(e: JiraError, action: str):
    if isinstance(e, JiraAuthError):
        raise IngestionAuthError(f"Jira auth failed while {action}: {e}") from e
    if isinstance(e, JiraRateLimitError):
        raise IngestionRateLimitError(f"Jira rate limit exceeded while {action}") from e
    raise IngestionError(f"Error {action}: {e}") from e


def _issue_text(issue: dict) -> tuple[str, str, str]:
    f = issue.get("fields", {})
    return (
        f.get("issuetype", {}).get("name", "Issue"),
        f.get("summary", ""),
        adf_to_text(f.get("description")).strip(),
    )


class JiraConnector(BaseConnector):
    async def ingest(
        self,
        url: str,
        token: str | None,
        config: dict[str, Any] | None = None,
        on_progress: Callable[[str, dict[str, Any]], Any] | None = None
    ) -> str:
        domain, project_key = _parse_jira_url(url, config)
        issue_types = (config or {}).get("issue_types", "Epic, Story, Task, Bug")
        jira = _jira_client(self.client, token, domain)
        try:
            async with self.semaphore:
                issues = await jira.search(
                    f"project = {project_key} AND type in ({issue_types}) ORDER BY created DESC", limit=1000
                )
        except JiraError as e:
            _raise_ingestion(e, f"fetching Jira project {project_key}")

        if on_progress:
            try:
                on_progress("source_files_found", {"source": url, "project_key": project_key, "file_count": len(issues)})
            except Exception:
                pass

        content = f"--- Jira Project: {project_key} ---\n\n"
        for issue in issues:
            i_type, summary, description = _issue_text(issue)
            content += f"\n\n--- [{i_type}] {issue['key']}: {summary} ---\n{description}"

        if on_progress:
            try:
                on_progress("source_files_fetched", {"source": url, "fetched": len(issues), "total": len(issues)})
            except Exception:
                pass
        return content

    async def check_incremental_updates(
        self,
        url: str,
        token: str | None,
        last_state: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None
    ) -> IncrementalDelta:
        domain, project_key = _parse_jira_url(url, config)
        last_synced_at = (last_state or {}).get("last_synced_at")
        jql = f"project = {project_key} ORDER BY updated DESC"
        if last_synced_at:
            jql = f"project = {project_key} AND updated >= '{last_synced_at}' ORDER BY updated DESC"

        jira = _jira_client(self.client, token, domain)
        try:
            async with self.semaphore:
                issues = await jira.search(jql, limit=50)
        except JiraError as e:
            _raise_ingestion(e, f"inspecting Jira project {project_key}")

        known_keys = (last_state or {}).get("known_keys", [])
        new_or_updated = [i for i in issues if i["key"] not in known_keys or last_synced_at]

        if not new_or_updated:
            return IncrementalDelta(
                has_changes=False,
                summary=f"No updated Jira issues in project {project_key}",
                new_state=last_state or {},
                source_type="jira",
                source_url=url,
            )

        now_str = now_utc().strftime("%Y-%m-%d %H:%M")
        delta_lines = [
            f"### 📋 Jira Project Updates: `{project_key}`",
            f"Found **{len(new_or_updated)} updated issue(s)**:\n",
        ]
        for issue in new_or_updated:
            i_type, summary, description = _issue_text(issue)
            delta_lines.append(f"- **[{i_type}] {issue['key']}**: {summary}\n  {description[:300]}")

        return IncrementalDelta(
            has_changes=True,
            delta_content="\n".join(delta_lines),
            summary=f"{len(new_or_updated)} updated issues in Jira project {project_key}",
            new_state={
                "last_synced_at": now_str,
                "project_key": project_key,
                "known_keys": [i["key"] for i in issues[:50]],
            },
            affected_items=[f"jira://{project_key}/{i['key']}" for i in new_or_updated],
            source_type="jira",
            source_url=url,
            author="Jira",
        )

async def fetch_jira_project(
    jira_url: str,
    api_token: str,
    config: dict[str, Any] | None = None,
    on_progress: Callable[[str, dict[str, Any]], Any] | None = None
) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        connector = JiraConnector(client)
        return await connector.ingest(jira_url, api_token, config=config, on_progress=on_progress)

