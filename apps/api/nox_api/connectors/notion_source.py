import logging
import re
from collections.abc import Callable
from typing import Any

import httpx

from .base import BaseConnector, IncrementalDelta, IngestionAuthError, IngestionError, IngestionRateLimitError

logger = logging.getLogger(__name__)

def _extract_notion_id(url: str, config: dict[str, Any] | None = None) -> str:
    """Extract 32-char hex Notion page or database ID from URL or config."""
    if config and config.get("page_id"):
        return re.sub(r'[^a-fA-F0-9]', '', str(config["page_id"]))
    if config and config.get("database_id"):
        return re.sub(r'[^a-fA-F0-9]', '', str(config["database_id"]))

    cleaned = url.split('?')[0].rstrip('/')
    match = re.search(r'([a-f0-9]{32})$', cleaned, re.IGNORECASE)
    if match:
        return match.group(1)
    
    # Try UUID format with dashes
    match = re.search(r'([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', cleaned, re.IGNORECASE)
    if match:
        return match.group(1).replace('-', '')

    # Fallback to alphanumeric stripping
    hex_only = re.sub(r'[^a-fA-F0-9]', '', cleaned)
    if len(hex_only) >= 32:
        return hex_only[-32:]

    raise IngestionError(f"Invalid Notion URL or ID format: {url}")

class NotionConnector(BaseConnector):
    async def _get_all_children(self, block_id: str, headers: dict) -> list:
        children = []
        next_cursor = None
        has_more = True

        while has_more:
            url = f"https://api.notion.com/v1/blocks/{block_id}/children"
            params = {}
            if next_cursor:
                params['start_cursor'] = next_cursor

            async with self.semaphore:
                r = await self.client.get(url, headers=headers, params=params)

            if r.status_code in (401, 403):
                raise IngestionAuthError(f"Notion auth failed: {r.text}")
            elif r.status_code == 429:
                raise IngestionRateLimitError("Notion rate limit exceeded")
            elif r.status_code != 200:
                raise IngestionError(f"Error fetching Notion block children: {r.text}")

            data = r.json()
            children.extend(data.get('results', []))
            has_more = data.get('has_more', False)
            next_cursor = data.get('next_cursor', None)

        return children

    def _extract_block_text(self, block: dict) -> str:
        b_type = block.get('type')
        if not b_type or b_type not in block:
            return ""
        block_data = block[b_type]
        if not isinstance(block_data, dict) or 'rich_text' not in block_data:
            return ""

        rich_texts = block_data['rich_text']
        text = ""
        for rt in rich_texts:
            text += rt.get('plain_text', '')
        if text:
            text += "\n"
        return text

    async def ingest(
        self,
        url: str,
        token: str | None,
        config: dict[str, Any] | None = None,
        on_progress: Callable[[str, dict[str, Any]], Any] | None = None
    ) -> str:
        if not token:
            raise IngestionAuthError("Notion token not provided (NOTION_API_TOKEN required).")

        page_id = _extract_notion_id(url, config)

        headers = {
            'Authorization': f'Bearer {token}' if not token.startswith('Bearer ') else token,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        }

        # Try to get page title and metadata
        page_title = f"Notion Page {page_id}"
        try:
            page_meta_url = f"https://api.notion.com/v1/pages/{page_id}"
            async with self.semaphore:
                pr = await self.client.get(page_meta_url, headers=headers)
            if pr.status_code == 200:
                pdata = pr.json()
                props = pdata.get('properties', {})
                for prop_name, prop_val in props.items():
                    if prop_val.get('type') == 'title':
                        title_arr = prop_val.get('title', [])
                        if title_arr:
                            page_title = "".join(t.get('plain_text', '') for t in title_arr)
                            break
        except Exception:
            pass

        if on_progress:
            try:
                on_progress("source_files_found", {
                    "source": url,
                    "page_id": page_id,
                    "title": page_title,
                    "file_count": 1
                })
            except Exception:
                pass

        stack = [{"type": "fetch_children", "block_id": page_id}]
        text_pieces = []

        while stack:
            item = stack.pop()
            if item["type"] == "fetch_children":
                children = await self._get_all_children(item["block_id"], headers)
                for child in reversed(children):
                    stack.append({"type": "block", "data": child})
            elif item["type"] == "block":
                block = item["data"]
                block_text = self._extract_block_text(block)
                if block_text:
                    text_pieces.append(block_text)

                if block.get('has_children'):
                    stack.append({"type": "fetch_children", "block_id": block['id']})

        content = "".join(text_pieces)

        if on_progress:
            try:
                on_progress("source_files_fetched", {
                    "source": url,
                    "fetched": 1,
                    "total": 1
                })
            except Exception:
                pass

        return f"--- Notion Page: {page_title} (ID: {page_id}) ---\n\n" + content

    async def check_incremental_updates(
        self,
        url: str,
        token: str | None,
        last_state: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None
    ) -> IncrementalDelta:
        if not token:
            raise IngestionAuthError("Notion token not provided.")

        page_id = _extract_notion_id(url, config)
        headers = {
            'Authorization': f'Bearer {token}' if not token.startswith('Bearer ') else token,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        }

        # Check page last_edited_time
        page_meta_url = f"https://api.notion.com/v1/pages/{page_id}"
        async with self.semaphore:
            r = await self.client.get(page_meta_url, headers=headers)

        if r.status_code in (401, 403):
            raise IngestionAuthError(f"Notion auth failed: {r.text}")
        elif r.status_code != 200:
            raise IngestionError(f"Error inspecting Notion page: {r.text}")

        page_data = r.json()
        current_edited_time = page_data.get('last_edited_time', '')
        last_recorded_time = (last_state or {}).get("last_edited_time", "")

        if last_recorded_time and current_edited_time <= last_recorded_time:
            return IncrementalDelta(
                has_changes=False,
                summary=f"No changes in Notion page {page_id} since {last_recorded_time}",
                new_state=last_state or {},
                source_type="notion",
                source_url=url,
            )

        # Ingest updated page content
        updated_content = await self.ingest(url, token, config=config)

        return IncrementalDelta(
            has_changes=True,
            delta_content=f"### 📑 Notion Page Updated (Last Edited: {current_edited_time})\n\n{updated_content}",
            summary=f"Notion page {page_id} updated at {current_edited_time}",
            new_state={"last_edited_time": current_edited_time, "page_id": page_id},
            affected_items=[f"notion://{page_id}"],
            source_type="notion",
            source_url=url,
            author="NotionUser",
        )

async def fetch_notion_page(
    notion_url: str,
    api_token: str,
    config: dict[str, Any] | None = None,
    on_progress: Callable[[str, dict[str, Any]], Any] | None = None
) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        connector = NotionConnector(client)
        return await connector.ingest(notion_url, api_token, config=config, on_progress=on_progress)
