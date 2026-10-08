"""Jules REST client (v1alpha): Google's asynchronous coding agent, for "Hand off to Jules".

A Jules *source* is a GitHub repository its GitHub app can see (`sources/github/<owner>/<repo>`). A *session* is
one task on one source: Jules plans, waits for plan approval when asked to, builds, and (with AUTO_CREATE_PR)
opens a pull request. *Activities* are what happened in a session, newest last.

Every call goes through `_request`, which retries 429 and 5xx with backoff (honouring Retry-After) and maps
failures to typed errors, like the Jira client. The API is alpha: field names are read defensively.
"""

import asyncio
import logging
import re
from typing import Any

import httpx

from ..core.config import settings

logger = logging.getLogger(__name__)

WEB_URL = "https://jules.google.com/session/{id}"
ACTIVE = {"QUEUED", "PLANNING", "AWAITING_PLAN_APPROVAL", "AWAITING_USER_FEEDBACK", "IN_PROGRESS", "PAUSED"}
DONE = {"COMPLETED", "FAILED"}


class JulesError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class JulesAuthError(JulesError):
    """401/403: the API key is wrong, revoked or disabled."""


class JulesNotFoundError(JulesError):
    """404: no such session or source."""


def configured() -> bool:
    return bool((settings.JULES_API_KEY or "").strip())


def source_name(repo_url: str) -> str | None:
    """`https://github.com/Org/repo(.git)` → `sources/github/Org/repo`; None for anything that isn't GitHub."""
    m = re.match(r"^(?:https?://|git@)github\.com[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", (repo_url or "").strip())
    return f"sources/github/{m.group(1)}/{m.group(2)}" if m else None


def repo_of(source: str) -> str:
    """`sources/github/Org/repo` → `Org/repo`."""
    return source.split("sources/github/", 1)[-1]


def session_id(session: dict) -> str:
    return str(session.get("id") or (session.get("name") or "").split("/")[-1])


def pr_url(session: dict) -> str | None:
    for out in session.get("outputs") or []:
        if url := ((out or {}).get("pullRequest") or {}).get("url"):
            return url
    return None


class JulesClient:
    def __init__(self, client: httpx.AsyncClient | None = None, api_key: str | None = None, base_url: str | None = None,
                 max_retries: int = 3, backoff: float = 1.0):
        self._own = client is None
        self._client = client or httpx.AsyncClient(timeout=30.0)
        self._base = (base_url or settings.JULES_API_URL).rstrip("/")
        self._headers = {"x-goog-api-key": api_key or settings.JULES_API_KEY, "Content-Type": "application/json"}
        self._max_retries = max_retries
        self._backoff = backoff

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        if self._own:
            await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        url = f"{self._base}/{path.lstrip('/')}"
        for attempt in range(self._max_retries + 1):
            res = await self._client.request(method, url, headers=self._headers, **kwargs)
            if (res.status_code == 429 or res.status_code >= 500) and attempt < self._max_retries:
                delay = float(res.headers.get("Retry-After") or self._backoff * (2 ** attempt))
                logger.warning(f"Jules {method} {path} → {res.status_code}; retrying in {delay:.1f}s")
                await asyncio.sleep(delay)
                continue
            if res.status_code in (200, 201):
                return res.json() if res.content else {}
            try:
                detail = (res.json().get("error") or {}).get("message") or res.text
            except ValueError:
                detail = res.text
            message = f"Jules answered {res.status_code}: {str(detail)[:200]}"
            if res.status_code in (401, 403):
                raise JulesAuthError(message, res.status_code)
            if res.status_code == 404:
                raise JulesNotFoundError(message, res.status_code)
            raise JulesError(message, res.status_code)
        raise JulesError(f"Jules {method} {path} failed after retries")

    async def list_sources(self, limit: int = 500) -> list[dict]:
        sources: list[dict] = []
        token = None
        while len(sources) < limit:
            params = {"pageSize": 100, **({"pageToken": token} if token else {})}
            page = await self._request("GET", "sources", params=params)
            sources += page.get("sources") or []
            token = page.get("nextPageToken")
            if not token:
                break
        return sources

    async def create_session(self, *, prompt: str, title: str, source: str, starting_branch: str = "main",
                             require_plan_approval: bool = True) -> dict:
        body = {
            "prompt": prompt,
            "title": title,
            "sourceContext": {"source": source, "githubRepoContext": {"startingBranch": starting_branch}},
            "requirePlanApproval": require_plan_approval,
            "automationMode": "AUTO_CREATE_PR",
        }
        return await self._request("POST", "sessions", json=body)

    async def get_session(self, sid: str) -> dict:
        return await self._request("GET", f"sessions/{sid}")

    async def list_activities(self, sid: str, page_token: str | None = None, page_size: int = 50) -> dict:
        params = {"pageSize": page_size, **({"pageToken": page_token} if page_token else {})}
        return await self._request("GET", f"sessions/{sid}/activities", params=params)

    async def approve_plan(self, sid: str) -> None:
        await self._request("POST", f"sessions/{sid}:approvePlan", json={})

    async def send_message(self, sid: str, text: str) -> None:
        await self._request("POST", f"sessions/{sid}:sendMessage", json={"prompt": text})
