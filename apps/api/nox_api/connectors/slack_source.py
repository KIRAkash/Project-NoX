import logging
import re
from collections.abc import Callable
from typing import Any

import httpx

from nox_api.core.time_utils import now_utc, utc_from_timestamp

from .base import BaseConnector, IncrementalDelta, IngestionAuthError, IngestionError, IngestionRateLimitError

logger = logging.getLogger(__name__)

def _extract_channel_id(url: str, config: dict[str, Any] | None = None) -> str:
    """Extract Slack channel ID from URL or config."""
    if config and config.get("channel_id"):
        return str(config["channel_id"]).strip()
    
    # Check if raw string is already an ID (e.g. C0123456789)
    cleaned = url.strip()
    if re.match(r'^[C|G|D][A-Z0-9]{8,12}$', cleaned):
        return cleaned
        
    # Match archives URL: https://workspace.slack.com/archives/C0123456789
    match = re.search(r'/archives/([C|G|D][A-Z0-9]+)', cleaned)
    if match:
        return match.group(1)
        
    # Match app_redirect: https://slack.com/app_redirect?channel=C0123456789
    match = re.search(r'channel=([C|G|D][A-Z0-9]+)', cleaned)
    if match:
        return match.group(1)

    # Fallback to alphanumeric token or stripped name
    return cleaned.lstrip('#')

class SlackConnector(BaseConnector):
    async def _api_call(self, endpoint: str, token: str, params: dict = None) -> dict:
        url = f"https://slack.com/api/{endpoint}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8"
        }
        async with self.semaphore:
            r = await self.client.get(url, headers=headers, params=params or {})

        if r.status_code in (401, 403):
            raise IngestionAuthError(f"Slack authentication failed: {r.text}")
        elif r.status_code == 429:
            raise IngestionRateLimitError("Slack rate limit exceeded (HTTP 429)")
        elif r.status_code != 200:
            raise IngestionError(f"Slack API error ({endpoint}): HTTP {r.status_code} - {r.text}")

        data = r.json()
        if not data.get("ok"):
            err = data.get("error", "unknown_error")
            if err in ("invalid_auth", "not_authed", "account_inactive", "token_revoked"):
                raise IngestionAuthError(f"Slack auth error: {err}")
            elif err == "ratelimited":
                raise IngestionRateLimitError("Slack rate limit exceeded (API error)")
            elif err in ("channel_not_found", "not_in_channel"):
                raise IngestionError(f"Slack channel access error: {err}. Ensure bot is invited to the channel.")
            else:
                raise IngestionError(f"Slack API error ({endpoint}): {err}")

        return data

    async def ingest(
        self,
        url: str,
        token: str | None,
        config: dict[str, Any] | None = None,
        on_progress: Callable[[str, dict[str, Any]], Any] | None = None
    ) -> str:
        if not token:
            raise IngestionAuthError("Slack bot token not provided (SLACK_BOT_TOKEN required).")

        channel_id = _extract_channel_id(url, config)
        include_threads = config.get("include_threads", True) if config else True
        max_messages = config.get("max_messages", 200) if config else 200

        # 1. Fetch channel metadata
        channel_name = channel_id
        try:
            info_data = await self._api_call("conversations.info", token, {"channel": channel_id})
            channel_info = info_data.get("channel", {})
            channel_name = channel_info.get("name", channel_id)
            purpose = channel_info.get("purpose", {}).get("value", "")
            topic = channel_info.get("topic", {}).get("value", "")
        except Exception as e:
            logger.warning(f"Could not fetch channel info for {channel_id}: {e}")
            purpose, topic = "", ""

        # 2. Fetch conversation history
        messages: list[dict[str, Any]] = []
        cursor = None
        has_more = True

        while has_more and len(messages) < max_messages:
            params = {
                "channel": channel_id,
                "limit": min(100, max_messages - len(messages))
            }
            if cursor:
                params["cursor"] = cursor

            history_data = await self._api_call("conversations.history", token, params)
            batch = history_data.get("messages", [])
            if not batch:
                break

            messages.extend(batch)
            cursor = history_data.get("response_metadata", {}).get("next_cursor")
            has_more = bool(cursor)

        if on_progress:
            try:
                on_progress("source_files_found", {
                    "source": url,
                    "channel": f"#{channel_name}",
                    "file_count": len(messages)
                })
            except Exception:
                pass

        # 3. Format message history and threads
        content_lines = [
            f"# Slack Channel: #{channel_name} ({channel_id})",
            f"**Exported At:** {now_utc().strftime('%Y-%m-%d %H:%M:%SZ')}",
        ]
        if topic:
            content_lines.append(f"**Topic:** {topic}")
        if purpose:
            content_lines.append(f"**Purpose:** {purpose}")
        content_lines.append("\n--- Message Log ---\n")

        # Sort chronologically
        messages.sort(key=lambda m: float(m.get("ts", 0)))

        for msg in messages:
            ts = msg.get("ts", "")
            user = msg.get("user") or msg.get("username") or "User"
            text = msg.get("text", "")
            time_str = utc_from_timestamp(ts).strftime('%Y-%m-%d %H:%M:%S') if ts else ""

            # Check for thread replies
            thread_ts = msg.get("thread_ts")
            reply_count = msg.get("reply_count", 0)

            content_lines.append(f"[{time_str}] **{user}**: {text}")

            if include_threads and reply_count > 0 and thread_ts == ts:
                try:
                    thread_data = await self._api_call("conversations.replies", token, {
                        "channel": channel_id,
                        "ts": thread_ts,
                        "limit": 50
                    })
                    replies = thread_data.get("messages", [])
                    # Skip root message in replies
                    for reply in replies[1:]:
                        r_ts = reply.get("ts", "")
                        r_user = reply.get("user") or reply.get("username") or "User"
                        r_text = reply.get("text", "")
                        r_time = utc_from_timestamp(r_ts).strftime('%Y-%m-%d %H:%M:%S') if r_ts else ""
                        content_lines.append(f"    ↳ [{r_time}] **{r_user}**: {r_text}")
                except Exception as e:
                    logger.warning(f"Failed to fetch thread replies for ts {thread_ts}: {e}")

        if on_progress:
            try:
                on_progress("source_files_fetched", {
                    "source": url,
                    "fetched": len(messages),
                    "total": len(messages)
                })
            except Exception:
                pass

        return "\n".join(content_lines)

    async def check_incremental_updates(
        self,
        url: str,
        token: str | None,
        last_state: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None
    ) -> IncrementalDelta:
        if not token:
            raise IngestionAuthError("Slack bot token not provided (SLACK_BOT_TOKEN required).")

        channel_id = _extract_channel_id(url, config)
        last_ts = (last_state or {}).get("latest_ts")

        # Fetch latest messages since last_ts
        params = {"channel": channel_id, "limit": 50}
        if last_ts:
            params["oldest"] = str(last_ts)
            params["inclusive"] = "false"

        try:
            history_data = await self._api_call("conversations.history", token, params)
            messages = history_data.get("messages", [])
            if not messages:
                return IncrementalDelta(
                    has_changes=False,
                    summary=f"No new Slack messages in channel {channel_id}",
                    new_state=last_state or {},
                    source_type="slack",
                    source_url=url,
                )

            # Sort chronologically
            messages.sort(key=lambda m: float(m.get("ts", 0)))
            new_highest_ts = max(m.get("ts", "0") for m in messages)

            delta_lines = [
                f"### 💬 Slack Updates from #{channel_id}",
                f"Found **{len(messages)} new message(s)**:\n"
            ]
            for m in messages:
                ts = m.get("ts", "")
                user = m.get("user") or m.get("username") or "User"
                text = m.get("text", "")
                time_str = utc_from_timestamp(ts).strftime('%Y-%m-%d %H:%M:%S') if ts else ""
                delta_lines.append(f"- [{time_str}] **{user}**: {text}")

            return IncrementalDelta(
                has_changes=True,
                delta_content="\n".join(delta_lines),
                summary=f"{len(messages)} new messages in Slack channel #{channel_id}",
                new_state={"latest_ts": new_highest_ts, "channel_id": channel_id},
                affected_items=[f"slack://{channel_id}"],
                source_type="slack",
                source_url=url,
                author="SlackBot",
            )
        except Exception as e:
            logger.error(f"Error checking Slack incremental updates for {channel_id}: {e}")
            raise IngestionError(f"Failed to check Slack updates: {e}")

async def fetch_slack_channel(
    channel_url: str,
    api_token: str,
    config: dict[str, Any] | None = None,
    on_progress: Callable[[str, dict[str, Any]], Any] | None = None
) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        connector = SlackConnector(client)
        return await connector.ingest(channel_url, api_token, config=config, on_progress=on_progress)
