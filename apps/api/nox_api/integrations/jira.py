"""Jira Cloud REST v3 client: search and read (for ingestion) plus write (for missions).

Every call goes through `_request`, which retries 429 and 5xx with backoff (honouring
Retry-After) and maps failures to typed errors so callers can react precisely.
"""

import asyncio
import logging
from typing import Any

import httpx

from ..core.config import settings
from . import atlassian

logger = logging.getLogger(__name__)

DEFAULT_FIELDS = ["summary", "description", "issuetype", "status", "assignee", "updated", "created", "labels", "parent"]


class JiraError(Exception):
    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


class JiraAuthError(JiraError):
    """401/403 — bad or expired credentials, or missing permission."""


class JiraNotFoundError(JiraError):
    """404 — issue, project or transition does not exist (or is not visible)."""


class JiraRateLimitError(JiraError):
    """429 after all retries."""


class JiraValidationError(JiraError):
    """400 — Jira rejected the payload (bad field, unknown issue type, …)."""


# ── Atlassian Document Format (ADF) ──────────────────────────────────────────


def adf_to_text(node: Any) -> str:
    """Flatten an ADF document (Jira v3 rich text) to readable plain text."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(adf_to_text(n) for n in node)
    kind = node.get("type")
    if kind == "text":
        return node.get("text", "")
    if kind == "hardBreak":
        return "\n"
    if kind in ("mention", "emoji"):
        return node.get("attrs", {}).get("text", "")
    inner = adf_to_text(node.get("content", []))
    if kind == "listItem":
        return f"- {inner.strip()}\n"
    if kind == "heading":
        level = node.get("attrs", {}).get("level", 1)
        return f"{'#' * level} {inner.strip()}\n\n"
    if kind == "codeBlock":
        return f"```\n{inner}\n```\n\n"
    if kind in ("paragraph", "blockquote", "panel"):
        return f"{inner.strip()}\n\n"
    if kind in ("bulletList", "orderedList"):
        return f"{inner}\n"
    return inner


def text_to_adf(text: str) -> dict:
    """Convert simple Markdown (headings, `-` bullets, fenced code, paragraphs) to ADF."""
    content: list[dict] = []
    bullets: list[dict] = []
    lines = (text or "").splitlines()
    i = 0

    def flush_bullets():
        if bullets:
            content.append({"type": "bulletList", "content": list(bullets)})
            bullets.clear()

    def para(s: str) -> dict:
        return {"type": "paragraph", "content": [{"type": "text", "text": s}]} if s else {"type": "paragraph"}

    while i < len(lines):
        line = lines[i].rstrip()
        if line.startswith("```"):
            flush_bullets()
            code: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            content.append({"type": "codeBlock", "content": [{"type": "text", "text": "\n".join(code) or " "}]})
        elif line.startswith("#"):
            flush_bullets()
            level = min(len(line) - len(line.lstrip("#")), 6)
            content.append({"type": "heading", "attrs": {"level": level},
                            "content": [{"type": "text", "text": line.lstrip("#").strip() or " "}]})
        elif line.lstrip().startswith(("- ", "* ")):
            bullets.append({"type": "listItem", "content": [para(line.lstrip()[2:].strip())]})
        elif line.strip():
            flush_bullets()
            content.append(para(line.strip()))
        else:
            flush_bullets()
        i += 1
    flush_bullets()
    return {"type": "doc", "version": 1, "content": content or [para("")]}


# ── Client ───────────────────────────────────────────────────────────────────


class JiraClient:
    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        *,
        token: str | None = None,
        email: str | None = None,
        base_url: str | None = None,
        max_retries: int = 3,
        backoff_seconds: float = 1.0,
    ):
        self._own_client = client is None
        self._client = client or httpx.AsyncClient(timeout=30.0)
        self._base = atlassian.base_url(base_url)
        self._headers = {
            **atlassian.json_headers(token or settings.JIRA_API_TOKEN, email),
            "Content-Type": "application/json",
        }
        self._max_retries = max_retries
        self._backoff = backoff_seconds

    async def __aenter__(self) -> "JiraClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._own_client:
            await self._client.aclose()

    @property
    def base_url(self) -> str:
        return self._base

    def browse_url(self, key: str) -> str:
        return f"{self._base}/browse/{key}"

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        url = f"{self._base}{path}"
        for attempt in range(self._max_retries + 1):
            res = await self._client.request(method, url, headers=self._headers, **kwargs)
            if res.status_code == 429 or res.status_code >= 500:
                if attempt < self._max_retries:
                    delay = float(res.headers.get("Retry-After") or self._backoff * (2 ** attempt))
                    logger.warning(f"Jira {method} {path} → {res.status_code}; retrying in {delay:.1f}s")
                    await asyncio.sleep(delay)
                    continue
                if res.status_code == 429:
                    raise JiraRateLimitError("Jira rate limit exceeded", 429, res.text)
            if res.status_code in (200, 201):
                return res.json() if res.content else {}
            if res.status_code == 204:
                return {}
            body: Any
            try:
                body = res.json()
            except ValueError:
                body = res.text
            message = f"Jira {method} {path} failed with {res.status_code}: {_error_text(body)}"
            if res.status_code in (401, 403):
                raise JiraAuthError(message, res.status_code, body)
            if res.status_code == 404:
                raise JiraNotFoundError(message, res.status_code, body)
            if res.status_code == 400:
                raise JiraValidationError(message, res.status_code, body)
            raise JiraError(message, res.status_code, body)
        raise JiraError(f"Jira {method} {path} failed after retries")

    # ── Read ────────────────────────────────────────────────────────────────

    async def myself(self) -> dict:
        return await self._request("GET", "/rest/api/3/myself")

    async def search(self, jql: str, fields: list[str] | None = None, limit: int = 500) -> list[dict]:
        """Run JQL via /rest/api/3/search/jql, following nextPageToken until `limit` issues."""
        issues: list[dict] = []
        token: str | None = None
        while len(issues) < limit:
            params: dict[str, Any] = {
                "jql": jql,
                "maxResults": min(100, limit - len(issues)),
                "fields": ",".join(fields or DEFAULT_FIELDS),
            }
            if token:
                params["nextPageToken"] = token
            data = await self._request("GET", "/rest/api/3/search/jql", params=params)
            issues.extend(data.get("issues", []))
            token = data.get("nextPageToken")
            if not token or data.get("isLast"):
                break
        return issues[:limit]

    async def get_issue(self, key: str, fields: list[str] | None = None) -> dict:
        return await self._request("GET", f"/rest/api/3/issue/{key}",
                                   params={"fields": ",".join(fields or DEFAULT_FIELDS + ["comment"])})

    # ── Write ───────────────────────────────────────────────────────────────

    async def create_issue(
        self,
        project_key: str,
        summary: str,
        description: str = "",
        issue_type: str = "Task",
        labels: list[str] | None = None,
        parent_key: str | None = None,
        extra_fields: dict | None = None,
    ) -> dict:
        """Create an issue (or a sub-task when `parent_key` is given). Returns {id, key, self, url}."""
        fields: dict[str, Any] = {
            "project": {"key": project_key},
            "summary": summary[:255],
            "issuetype": {"name": issue_type},
            "description": text_to_adf(description),
        }
        if labels:
            fields["labels"] = labels
        if parent_key:
            fields["parent"] = {"key": parent_key}
        fields.update(extra_fields or {})
        created = await self._request("POST", "/rest/api/3/issue", json={"fields": fields})
        created["url"] = self.browse_url(created["key"])
        return created

    async def create_subtask(self, parent_key: str, summary: str, description: str = "",
                             issue_type: str = "Subtask") -> dict:
        project_key = parent_key.rsplit("-", 1)[0]
        return await self.create_issue(project_key, summary, description, issue_type, parent_key=parent_key)

    async def get_transitions(self, key: str) -> list[dict]:
        data = await self._request("GET", f"/rest/api/3/issue/{key}/transitions")
        return data.get("transitions", [])

    async def transition_to(self, key: str, status_name: str) -> dict | None:
        """Move an issue to the status named `status_name` (case-insensitive). Returns the transition used,
        or None if the issue is already in that status."""
        issue = await self.get_issue(key, ["status"])
        if issue["fields"]["status"]["name"].lower() == status_name.lower():
            return None
        target = status_name.lower()
        for t in await self.get_transitions(key):
            if t.get("to", {}).get("name", "").lower() == target or t.get("name", "").lower() == target:
                await self._request("POST", f"/rest/api/3/issue/{key}/transitions", json={"transition": {"id": t["id"]}})
                return t
        raise JiraValidationError(f"No transition from {key}'s current status to '{status_name}'")

    async def add_comment(self, key: str, body: str) -> dict:
        return await self._request("POST", f"/rest/api/3/issue/{key}/comment", json={"body": text_to_adf(body)})

    async def add_remote_link(self, key: str, url: str, title: str, global_id: str | None = None) -> dict:
        payload: dict[str, Any] = {"object": {"url": url, "title": title}}
        if global_id:
            payload["globalId"] = global_id  # makes the call idempotent: same id updates in place
        return await self._request("POST", f"/rest/api/3/issue/{key}/remotelink", json=payload)

    async def set_property(self, key: str, prop: str, value: Any) -> dict:
        return await self._request("PUT", f"/rest/api/3/issue/{key}/properties/{prop}", json=value)


def _error_text(body: Any) -> str:
    if isinstance(body, dict):
        parts = list(body.get("errorMessages") or []) + [f"{k}: {v}" for k, v in (body.get("errors") or {}).items()]
        if parts:
            return "; ".join(parts)
    return str(body)[:300]
