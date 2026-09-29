"""What a caller may see, resolved once and shared by the CLI, MCP and A2A.

Principle 3: scope is set by NoX, never by the model. External agents authenticate with a personal API token
(`nox_…`); the applications they can reach come from the token owner's memberships, and the acting seat from
`X-Nox-Role` or the owner's last pick, exactly as `core/auth.current_actor` does for the app.

The knowledge tools (`ai/tools/knowledge.py`) read scope from an ADK `ToolContext.state`. Outside an ADK run,
`ScopedContext` stands in for it: a plain object with the same `state` dict, built per request.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import Actor, hash_api_token, visible_org_ids
from ..db.models import ApiToken, KnowledgeBase, Role, User

LOGIN_HINT = "Sign in with a NoX token: run `nox login`, then `nox mcp` for ready-to-paste settings."


class ScopeError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


async def visible_kbs(db: AsyncSession, user: User, app: str | None = None) -> list[KnowledgeBase]:
    """Knowledge bases in the orgs the user belongs to (and their sub-orgs), optionally one app by name."""
    orgs = await visible_org_ids(db, user)
    if not orgs:
        return []
    q = select(KnowledgeBase).where(KnowledgeBase.org_id.in_(orgs))
    if app:
        q = q.where(KnowledgeBase.app_name == app)
    return list((await db.execute(q)).scalars().all())


async def actor_from_token(db: AsyncSession, authorization: str | None, role_header: str | None) -> Actor:
    """Resolve `Authorization: Bearer nox_…` (+ optional `X-Nox-Role`) to an Actor, or raise ScopeError(401/400)."""
    scheme, _, credential = (authorization or "").partition(" ")
    credential = credential.strip()
    if scheme != "Bearer" or not credential.startswith("nox_"):
        raise ScopeError(401, LOGIN_HINT)
    row = (await db.execute(select(ApiToken).where(ApiToken.token_hash == hash_api_token(credential)))).scalars().first()
    user = await db.get(User, row.user_id) if row else None
    if user is None:
        raise ScopeError(401, "Invalid or revoked NoX token. " + LOGIN_HINT)
    row.last_used_at = datetime.utcnow()
    await db.commit()
    raw = role_header or (user.last_role.value if user.last_role else "developer")
    try:
        return Actor(user=user, role=Role(raw))
    except ValueError as e:
        raise ScopeError(400, f"Unknown role '{raw}'. Use business, product, engineering or developer.") from e


@dataclass
class ScopedContext:
    """Stands in for ADK's ToolContext when NoX calls a knowledge tool directly (MCP)."""

    state: dict = field(default_factory=dict)


async def tool_state(db: AsyncSession, actor: Actor, home_app: str = "") -> dict:
    """The session state the knowledge tools read: {apps: {name: kb id}, home_app, role}."""
    apps = {kb.app_name: str(kb.id) for kb in await visible_kbs(db, actor.user)}
    return {"apps": apps, "home_app": home_app if home_app in apps else "", "role": actor.role.value, "cited": []}
