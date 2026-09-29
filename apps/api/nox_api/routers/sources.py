"""Live validation of a source URL before it is attached to an application."""

import asyncio
import logging
import re
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..connectors.base import IngestionError
from ..connectors.confluence_source import _headers as confluence_headers
from ..connectors.confluence_source import _parse_confluence_url, _resolve_space_id
from ..connectors.jira_source import _parse_jira_url
from ..connectors.notion_source import _extract_notion_id
from ..connectors.slack_source import _extract_channel_id
from ..core.auth import Cap, require
from ..core.config import settings
from ..integrations.atlassian import AtlassianConfigError
from ..integrations.jira import JiraAuthError, JiraClient, JiraError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/sources", tags=["Sources"], dependencies=[Depends(require(Cap.MANAGE_SOURCES))])

TIMEOUT = 10.0


class SourceCheck(BaseModel):
    type: Literal["github", "confluence", "notion", "jira", "slack", "upload"]
    url: str
    config: dict[str, Any] | None = None


async def _github(url: str, _cfg, client: httpx.AsyncClient) -> str:
    m = re.search(r"github\.com[/:]([^/\s]+)/([^/\s#?]+)", url)
    if not m:
        raise ValueError("Expected a GitHub repository URL like https://github.com/org/repo")
    owner, repo = m.group(1), m.group(2).removesuffix(".git")
    from ..services.gitops import get_github_client

    def probe() -> str:
        r = get_github_client().get_repo(f"{owner}/{repo}")
        return f"{r.full_name} · default branch {r.default_branch}"

    return await asyncio.to_thread(probe)


async def _jira(url: str, cfg, client: httpx.AsyncClient) -> str:
    domain, key = _parse_jira_url(url, cfg)
    issues = await JiraClient(client, base_url=domain).search(f"project = {key}", fields=["summary"], limit=1)
    if not issues:
        # Jira answers an unknown or invisible project with an empty result, not an error.
        raise ValueError(f"No issues visible in project {key} — check the key and the token's access")
    return f"project {key} reachable"


async def _confluence(url: str, cfg, client: httpx.AsyncClient) -> str:
    domain, space = _parse_confluence_url(url, cfg)
    space_id = await _resolve_space_id(client, domain, space, confluence_headers(None))
    return f"space {space} (id {space_id})"


async def _notion(url: str, cfg, client: httpx.AsyncClient) -> str:
    page_id = _extract_notion_id(url, cfg)
    res = await client.get(
        f"https://api.notion.com/v1/pages/{page_id}",
        headers={"Authorization": f"Bearer {settings.NOTION_API_TOKEN}", "Notion-Version": "2022-06-28"},
    )
    if res.status_code == 404:
        raise ValueError("Page not found — share it with the NoX integration in Notion")
    res.raise_for_status()
    return "page shared with the integration"


async def _slack(url: str, cfg, client: httpx.AsyncClient) -> str:
    channel = _extract_channel_id(url, cfg)
    res = await client.get(
        "https://slack.com/api/conversations.info",
        headers={"Authorization": f"Bearer {settings.SLACK_BOT_TOKEN}"},
        params={"channel": channel},
    )
    body = res.json()
    if not body.get("ok"):
        raise ValueError(f"Slack: {body.get('error', 'channel not accessible')}")
    return f"#{body['channel'].get('name', channel)}"


async def _upload(url: str, _cfg, _client) -> str:
    return "uploaded file"


CHECKS = {"github": _github, "jira": _jira, "confluence": _confluence, "notion": _notion, "slack": _slack, "upload": _upload}


@router.post("/validate")
async def validate_source(body: SourceCheck) -> dict:
    """Check that NoX can actually read this source with the configured credentials."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            detail = await asyncio.wait_for(CHECKS[body.type](body.url.strip(), body.config, client), timeout=TIMEOUT + 2)
        return {"ok": True, "detail": detail}
    except (JiraAuthError, AtlassianConfigError) as e:
        return {"ok": False, "detail": f"Atlassian credentials rejected or missing ({type(e).__name__})"}
    except JiraError as e:
        return {"ok": False, "detail": str(e)[:200]}
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        return {"ok": False, "detail": f"HTTP {code}" + (" — credentials rejected" if code in (401, 403) else "")}
    except TimeoutError:
        return {"ok": False, "detail": "No response in time"}
    except (ValueError, IngestionError) as e:
        return {"ok": False, "detail": str(e)[:200]}
    except Exception as e:
        logger.info(f"source validation failed for {body.type}: {e}")
        msg = str(e)
        if "404" in msg or "Not Found" in msg:
            return {"ok": False, "detail": "Not found, or not visible to NoX's GitHub App"}
        return {"ok": False, "detail": msg[:200] or type(e).__name__}
