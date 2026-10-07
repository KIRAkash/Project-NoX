import asyncio
import logging
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

import httpx

from ..core.config import settings
from ..core.time_utils import now_utc
from ..integrations.atlassian import AtlassianConfigError, json_headers
from .base import BaseConnector, IncrementalDelta, IngestionAuthError, IngestionError, IngestionRateLimitError

logger = logging.getLogger(__name__)

def _parse_confluence_url(url: str, config: dict[str, Any] | None = None) -> tuple:
    """Extract domain and space key from URL or config."""
    if config and config.get("domain") and config.get("space_key"):
        domain = config["domain"].rstrip('/')
        if not domain.startswith("http"):
            domain = f"https://{domain}"
        return domain, config["space_key"].strip()

    parsed = urlparse(url)
    domain = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else settings.ATLASSIAN_BASE_URL
    path_parts = [p for p in parsed.path.split('/') if p and p not in ('wiki', 'spaces', 'display')]
    space_key = path_parts[-1] if path_parts else url.strip()
    return domain, space_key

def _headers(token: str | None) -> dict[str, str]:
    try:
        return json_headers(token or settings.CONFLUENCE_API_TOKEN)
    except AtlassianConfigError as e:
        raise IngestionAuthError(f"Confluence is not configured: {e}") from e


async def _resolve_space_id(client: httpx.AsyncClient, domain: str, space_key: str, headers: dict) -> str:
    """The v2 pages endpoint takes the numeric space id; URLs and config carry the space key."""
    if space_key.isdigit():
        return space_key
    r = await client.get(f"{domain}/wiki/api/v2/spaces", headers=headers, params={"keys": space_key})
    if r.status_code in (401, 403):
        raise IngestionAuthError(f"Confluence auth failed: {r.text[:200]}")
    if r.status_code != 200:
        raise IngestionError(f"Error looking up Confluence space {space_key}: {r.text[:200]}")
    results = r.json().get("results", [])
    if not results:
        raise IngestionError(f"Confluence space '{space_key}' not found or not visible to this token")
    return str(results[0]["id"])


class ConfluenceConnector(BaseConnector):
    async def ingest(
        self,
        url: str,
        token: str | None,
        config: dict[str, Any] | None = None,
        on_progress: Callable[[str, dict[str, Any]], Any] | None = None
    ) -> str:

        domain, space_key = _parse_confluence_url(url, config)

        headers = _headers(token)
        space_id = await _resolve_space_id(self.client, domain, space_key, headers)

        pages = []
        next_url = f"{domain}/wiki/api/v2/spaces/{space_id}/pages"

        while next_url:
            async with self.semaphore:
                r = await self.client.get(next_url, headers=headers)

            if r.status_code in (401, 403):
                raise IngestionAuthError(f"Confluence auth failed: {r.text}")
            elif r.status_code == 429:
                raise IngestionRateLimitError("Confluence rate limit exceeded")
            elif r.status_code != 200:
                raise IngestionError(f"Error fetching Confluence space pages: {r.text}")

            data = r.json()
            results = data.get('results', [])
            pages.extend(results)

            # Extract cursor pagination
            links = data.get('_links', {})
            next_relative = links.get('next')
            if next_relative:
                if next_relative.startswith('http'):
                    next_url = next_relative
                else:
                    next_url = f"{domain}{next_relative}"
            else:
                next_url = None

        if on_progress:
            try:
                on_progress("source_files_found", {
                    "source": url,
                    "space_key": space_key,
                    "file_count": len(pages)
                })
            except Exception:
                pass

        content = f"--- Confluence Space: {space_key} ---\n\n"

        async def fetch_page_content(page) -> str:
            page_id = page['id']
            page_title = page.get('title', f'Page {page_id}')
            body_url = f"{domain}/wiki/api/v2/pages/{page_id}?body-format=storage"
            async with self.semaphore:
                r = await self.client.get(body_url, headers=headers)

            if r.status_code in (401, 403):
                raise IngestionAuthError(f"Confluence auth failed fetching page: {r.text}")
            elif r.status_code == 429:
                raise IngestionRateLimitError("Confluence rate limit exceeded")
            elif r.status_code != 200:
                raise IngestionError(f"Error fetching Confluence page {page_id}: {r.text}")

            body_data = r.json()
            body_content = body_data.get('body', {}).get('storage', {}).get('value', '')
            return f"\n\n--- Page: {page_title} (ID: {page_id}) ---\n{body_content}"

        # Gather concurrently!
        if pages:
            tasks = [fetch_page_content(page) for page in pages]
            page_contents = await asyncio.gather(*tasks)
            for pc in page_contents:
                content += pc

        if on_progress:
            try:
                on_progress("source_files_fetched", {
                    "source": url,
                    "fetched": len(pages),
                    "total": len(pages)
                })
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

        domain, space_key = _parse_confluence_url(url, config)
        headers = _headers(token)
        space_id = await _resolve_space_id(self.client, domain, space_key, headers)

        # Query space pages
        pages_url = f"{domain}/wiki/api/v2/spaces/{space_id}/pages"
        async with self.semaphore:
            r = await self.client.get(pages_url, headers=headers)

        if r.status_code in (401, 403):
            raise IngestionAuthError(f"Confluence auth failed: {r.text}")
        elif r.status_code != 200:
            raise IngestionError(f"Error inspecting Confluence space: {r.text}")

        current_pages = r.json().get('results', [])
        known_pages = (last_state or {}).get("known_page_ids", {})

        new_or_updated = []
        updated_state = {}

        for p in current_pages:
            p_id = str(p['id'])
            p_title = p.get('title', '')
            p_version = str(p.get('version', {}).get('number', '1')) if isinstance(p.get('version'), dict) else str(p.get('version', '1'))
            updated_state[p_id] = p_version

            if p_id not in known_pages or known_pages.get(p_id) != p_version:
                new_or_updated.append((p_id, p_title, "new" if p_id not in known_pages else "modified"))

        if not new_or_updated:
            return IncrementalDelta(
                has_changes=False,
                summary=f"No new or updated Confluence pages in space {space_key}",
                new_state={"known_page_ids": updated_state, "space_key": space_key},
                source_type="confluence",
                source_url=url,
            )

        # Fetch contents of changed pages
        delta_lines = [
            f"### 📄 Confluence Space Updates: `{space_key}`",
            f"Detected **{len(new_or_updated)} page change(s)**:\n"
        ]

        for p_id, p_title, change_type in new_or_updated:
            body_url = f"{domain}/wiki/api/v2/pages/{p_id}?body-format=storage"
            async with self.semaphore:
                br = await self.client.get(body_url, headers=headers)
            body_content = ""
            if br.status_code == 200:
                body_content = br.json().get('body', {}).get('storage', {}).get('value', '')

            delta_lines.append(f"#### [{change_type.upper()}] {p_title} (ID: {p_id})\n{body_content}\n")

        affected_items = [f"confluence://{space_key}/{p_id}" for p_id, _, _ in new_or_updated]

        return IncrementalDelta(
            has_changes=True,
            delta_content="\n".join(delta_lines),
            summary=f"{len(new_or_updated)} updated/new pages in Confluence space {space_key}",
            new_state={"known_page_ids": updated_state, "space_key": space_key, "last_synced_at": now_utc().isoformat()},
            affected_items=affected_items,
            source_type="confluence",
            source_url=url,
            author="Confluence",
        )

async def fetch_confluence_space(
    space_url: str,
    api_token: str,
    config: dict[str, Any] | None = None,
    on_progress: Callable[[str, dict[str, Any]], Any] | None = None
) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        connector = ConfluenceConnector(client)
        return await connector.ingest(space_url, api_token, config=config, on_progress=on_progress)

