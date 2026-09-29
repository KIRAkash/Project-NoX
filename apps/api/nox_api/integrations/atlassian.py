"""Shared Atlassian (Jira Cloud + Confluence Cloud) auth and URL handling."""

import base64

from ..core.config import settings


class AtlassianConfigError(ValueError):
    """Credentials or base URL are missing or unusable."""


def base_url(override: str | None = None) -> str:
    url = (override or settings.ATLASSIAN_BASE_URL or "").strip().rstrip("/")
    if not url:
        raise AtlassianConfigError("ATLASSIAN_BASE_URL is not set")
    if not url.startswith("http"):
        url = f"https://{url}"
    return url


def auth_header(token: str | None, email: str | None = None) -> str:
    """Build the Authorization header value for Atlassian Cloud REST APIs.

    Cloud API tokens use HTTP Basic with `email:token`. Values that are already a full
    header (`Basic …` / `Bearer …`) or already contain `email:token` are accepted as-is.
    """
    token = (token or "").strip()
    if not token:
        raise AtlassianConfigError("Atlassian API token is not set")
    if token.startswith(("Basic ", "Bearer ")):
        return token
    if ":" in token:
        return "Basic " + base64.b64encode(token.encode()).decode()
    email = (email or settings.ATLASSIAN_EMAIL or "").strip()
    if not email:
        raise AtlassianConfigError("ATLASSIAN_EMAIL is required with an Atlassian API token")
    return "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()


def json_headers(token: str | None, email: str | None = None) -> dict[str, str]:
    return {"Authorization": auth_header(token, email), "Accept": "application/json"}
