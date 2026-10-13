"""The signed-in user: profile, picked role, the orgs they can see, and their first run (welcome choice, tours)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import ACCESS, current_user, visible_org_ids
from ..db.database import get_db
from ..db.models import Org, Role, User
from ..services import onboarding

router = APIRouter(prefix="/api/v1/me", tags=["Me"])


class RoleUpdate(BaseModel):
    role: Role


class EstateChoice(BaseModel):
    estate: Literal["demo", "fresh"]


async def _me_payload(db: AsyncSession, user: User) -> dict:
    from ..ai.config import backend

    visible = await visible_org_ids(db, user)
    orgs = (await db.execute(select(Org).where(Org.id.in_(visible)).order_by(Org.name))).scalars().all() if visible else []
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "photoUrl": user.photo_url,
        "role": user.last_role.value if user.last_role else None,
        "capabilities": sorted(c.value for c in ACCESS[user.last_role]) if user.last_role else [],
        "aiBackend": backend(),  # "local" hides video and voice capture (NoX Local reads images only)
        "orgs": [{"id": str(o.id), "name": o.name, "slug": o.slug, "parentOrgId": str(o.parent_org_id) if o.parent_org_id else None} for o in orgs],
        # First run: the welcome screen shows until `onboarded`; tours run once each (keys in services/onboarding.py).
        "onboarded": user.onboarded_at is not None,
        "estate": user.estate,
        "inDemo": await onboarding.is_in_demo(db, user),
        "demoAvailable": await onboarding.demo_available(db),
        "toursSeen": list(user.tours_seen or []),
    }


@router.get("")
async def get_me(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await _me_payload(db, user)


@router.put("/role")
async def set_role(body: RoleUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Record the seat picked on the role picker. It's a free choice: any user may take any role."""
    user.last_role = body.role
    await db.commit()
    await db.refresh(user)
    return await _me_payload(db, user)


@router.get("/demo-estate")
async def demo_estate(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """A read-only look at the demo estate for the welcome screen, before the user has joined it."""
    return await onboarding.estate_summary(db, user)


@router.post("/onboarding")
async def set_estate(body: EstateChoice, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The welcome screen's answer, or a later switch from the account menu: join the demo, or start (or go back to) fresh."""
    if body.estate == "demo" and not await onboarding.demo_available(db):
        raise HTTPException(409, "There's no demo estate on this deployment")
    await onboarding.choose_estate(db, user, body.estate)
    await db.commit()
    await db.refresh(user)
    return await _me_payload(db, user)


def _tour_key(key: str) -> str:
    if key not in onboarding.TOUR_KEYS:
        raise HTTPException(404, "No such tour")
    return key


@router.put("/tours/{key}")
async def mark_tour_seen(key: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """A tour was finished or skipped: don't start it on its own again."""
    key = _tour_key(key)
    seen = list(user.tours_seen or [])
    if key not in seen:
        user.tours_seen = [*seen, key]  # a new list, so SQLAlchemy sees the JSON change
        await db.commit()
    return {"toursSeen": list(user.tours_seen or [])}


@router.delete("/tours/{key}")
async def replay_tour(key: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Replay from the account menu: forget that this tour was seen."""
    key = _tour_key(key)
    user.tours_seen = [k for k in (user.tours_seen or []) if k != key]
    await db.commit()
    return {"toursSeen": list(user.tours_seen or [])}


@router.get("/agents")
async def agent_endpoints(user: User = Depends(current_user)):
    """Where agents reach NoX (MCP, A2A), for the Connect an agent panel. Null when no public API URL is set:
    the web app then offers its own origin, which proxies /mcp and /a2a to the API."""
    from ..core.config import settings

    base = settings.NOX_PUBLIC_API_URL.rstrip("/")
    return {"mcpUrl": f"{base}/mcp" if base else None, "a2aCardUrl": f"{base}/a2a/ask/.well-known/agent-card.json" if base else None}
