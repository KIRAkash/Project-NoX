"""The signed-in user: profile, picked role, and the orgs they can see."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import ACCESS, current_user, visible_org_ids
from ..db.database import get_db
from ..db.models import Org, Role, User

router = APIRouter(prefix="/api/v1/me", tags=["Me"])


class RoleUpdate(BaseModel):
    role: Role


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
