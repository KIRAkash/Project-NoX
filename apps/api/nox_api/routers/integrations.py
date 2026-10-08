"""Which integrations are configured, and whether each one actually works right now."""

import asyncio
import logging
from collections.abc import Awaitable, Callable

import httpx
from fastapi import APIRouter, Depends

from ..core.auth import Cap, require
from ..core.config import settings
from ..integrations import atlassian
from ..integrations.jira import JiraClient, JiraError
from ..integrations.jules import JulesError

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/integrations", tags=["Integrations"], dependencies=[Depends(require(Cap.SEE_ATLAS))]
)

CHECK_TIMEOUT_SECONDS = 8.0


def _set(*values: str | None) -> bool:
    return all(v and str(v).strip() for v in values)


async def _check_github(client: httpx.AsyncClient) -> str:
    from ..services.gitops import get_github_client

    def probe() -> str:
        g = get_github_client()
        org = g.get_organization(settings.GITHUB_DEFAULT_ORG)
        return f"org {org.login}, {org.public_repos + (org.total_private_repos or 0)} repos"

    return await asyncio.to_thread(probe)


async def _check_jira(client: httpx.AsyncClient) -> str:
    me = await JiraClient(client).myself()
    return f"signed in as {me.get('displayName') or me.get('emailAddress') or me.get('accountId')}"


async def _check_confluence(client: httpx.AsyncClient) -> str:
    res = await client.get(
        f"{atlassian.base_url()}/wiki/api/v2/spaces",
        headers=atlassian.json_headers(settings.CONFLUENCE_API_TOKEN or settings.JIRA_API_TOKEN),
        params={"limit": 1},
    )
    res.raise_for_status()
    return "spaces readable"


async def _check_notion(client: httpx.AsyncClient) -> str:
    res = await client.get(
        "https://api.notion.com/v1/users/me",
        headers={"Authorization": f"Bearer {settings.NOTION_API_TOKEN}", "Notion-Version": "2022-06-28"},
    )
    res.raise_for_status()
    return f"bot {res.json().get('name', 'ok')}"


async def _check_slack(client: httpx.AsyncClient) -> str:
    res = await client.post("https://slack.com/api/auth.test", headers={"Authorization": f"Bearer {settings.SLACK_BOT_TOKEN}"})
    body = res.json()
    if not body.get("ok"):
        raise RuntimeError(body.get("error", "auth.test failed"))
    return f"workspace {body.get('team')}"


async def _check_gemini(client: httpx.AsyncClient) -> str:
    res = await client.get(
        f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}",
        headers={"x-goog-api-key": settings.GEMINI_API_KEY},
    )
    res.raise_for_status()
    return f"model {settings.GEMINI_MODEL} available"


async def _check_jules(client: httpx.AsyncClient) -> str:
    from ..integrations.jules import JulesClient
    from ..missions.jules import forget_sources

    forget_sources()  # a check from Connectors should see repositories connected a moment ago
    sources = await JulesClient(client).list_sources()
    return f"{len(sources)} repositor{'y' if len(sources) == 1 else 'ies'} connected"


async def _check_ollama(client: httpx.AsyncClient) -> str:
    res = await client.get(f"{settings.GEMMA_OLLAMA_URL.rstrip('/')}/api/tags")
    res.raise_for_status()
    names = [m.get("name", "") for m in res.json().get("models", [])]
    if not any(n.startswith(settings.GEMMA_MODEL) for n in names):
        raise RuntimeError(f"model {settings.GEMMA_MODEL} not pulled")
    return f"model {settings.GEMMA_MODEL} available"


def _integrations() -> list[tuple[str, bool, bool, Callable[[httpx.AsyncClient], Awaitable[str]]]]:
    """(name, required for the demo, configured, live check)."""
    github_auth = _set(settings.GITHUB_APP_ID, settings.GITHUB_APP_INSTALLATION_ID) and (
        _set(settings.GITHUB_APP_PRIVATE_KEY) or _set(settings.GITHUB_APP_PRIVATE_KEY_PATH)
    ) or _set(settings.GITHUB_APP_TOKEN)
    atlassian_base = _set(settings.ATLASSIAN_BASE_URL, settings.ATLASSIAN_EMAIL)
    local_ai = settings.AI_MODE.lower() in ("local", "hybrid")
    return [
        ("github", True, bool(github_auth) and _set(settings.GITHUB_DEFAULT_ORG), _check_github),
        ("jira", True, atlassian_base and _set(settings.JIRA_API_TOKEN), _check_jira),
        ("confluence", True, atlassian_base and _set(settings.CONFLUENCE_API_TOKEN or settings.JIRA_API_TOKEN), _check_confluence),
        ("notion", True, _set(settings.NOTION_API_TOKEN), _check_notion),
        ("slack", False, _set(settings.SLACK_BOT_TOKEN), _check_slack),
        ("jules", False, _set(settings.JULES_API_KEY), _check_jules),
        ("gemini", True, _set(settings.GEMINI_API_KEY), _check_gemini),
        ("ollama", local_ai, local_ai, _check_ollama),
    ]


async def _run(name: str, required: bool, configured: bool, check, client: httpx.AsyncClient) -> dict:
    result = {"name": name, "required": required, "configured": configured}
    if not configured:
        return {**result, "ok": False, "detail": "not configured"}
    try:
        detail = await asyncio.wait_for(check(client), timeout=CHECK_TIMEOUT_SECONDS)
        return {**result, "ok": True, "detail": detail}
    except (httpx.HTTPStatusError, JiraError, JulesError) as e:
        code = e.response.status_code if isinstance(e, httpx.HTTPStatusError) else e.status
        rejected = code in (401, 403) or (name == "confluence" and code == 404)  # Confluence answers bad auth with 404
        hint = " (credentials rejected — token expired or wrong account?)" if rejected else ""
        return {**result, "ok": False, "detail": f"HTTP {code}{hint}"}
    except TimeoutError:
        return {**result, "ok": False, "detail": f"no response within {CHECK_TIMEOUT_SECONDS:.0f}s"}
    except Exception as e:
        logger.info(f"integration check {name} failed: {e}")
        return {**result, "ok": False, "detail": str(e)[:200] or type(e).__name__}


@router.get("/status")
async def integrations_status():
    async with httpx.AsyncClient(timeout=CHECK_TIMEOUT_SECONDS) as client:
        results = await asyncio.gather(*(_run(*i, client) for i in _integrations()))
    required_ok = all(r["ok"] for r in results if r["required"])
    return {"ok": required_ok, "integrations": results}
