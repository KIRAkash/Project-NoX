"""Who is calling, which seat they're playing, and what that seat may do.

Identity: a Firebase ID token (`Authorization: Bearer <jwt>`), verified locally against
Google's published signing certs. With `NOX_DEV_AUTH=true` (local development only) the
header `Authorization: Dev <email>` is also accepted, so the app can be exercised without
a Google sign-in.

Role: the four roles are picked freely on the role picker (a product decision, not a
security boundary). The acting role comes from the `X-Nox-Role` header, falling back to
the user's last pick; the access matrix below is enforced server-side against it.
"""

import asyncio
import hashlib
import logging
import time
import uuid
from dataclasses import dataclass
from enum import StrEnum

import httpx
from fastapi import Depends, Header, HTTPException, Request, status
from google.auth import jwt as google_jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.database import get_db
from ..db.models import Membership, Org, Role, User
from .config import settings
from .time_utils import now_utc_naive

logger = logging.getLogger(__name__)

FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"


# ── Firebase token verification ──────────────────────────────────────────────


class _CertCache:
    def __init__(self):
        self.certs: dict[str, str] = {}
        self.expires_at = 0.0
        self.lock = asyncio.Lock()

    async def get(self) -> dict[str, str]:
        if self.certs and time.time() < self.expires_at:
            return self.certs
        async with self.lock:
            if self.certs and time.time() < self.expires_at:
                return self.certs
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.get(FIREBASE_CERTS_URL)
                res.raise_for_status()
            max_age = 3600
            for part in res.headers.get("cache-control", "").split(","):
                if part.strip().startswith("max-age="):
                    max_age = int(part.split("=")[1])
            self.certs, self.expires_at = res.json(), time.time() + max_age
            return self.certs


_certs = _CertCache()


def firebase_project_id() -> str:
    return settings.FIREBASE_PROJECT_ID or settings.NEXT_PUBLIC_FIREBASE_PROJECT_ID


async def verify_firebase_token(token: str) -> dict:
    project = firebase_project_id()
    if not project:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Firebase project is not configured")
    try:
        claims = google_jwt.decode(token, certs=await _certs.get(), audience=project)
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}") from e
    if claims.get("iss") != f"https://securetoken.google.com/{project}" or not claims.get("sub"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token issuer")
    return claims


# ── Current user ─────────────────────────────────────────────────────────────


async def _upsert_user(db: AsyncSession, uid: str, email: str | None, name: str | None, photo: str | None) -> User:
    user = (await db.execute(select(User).where(User.firebase_uid == uid))).scalars().first()
    if user is None:
        user = User(firebase_uid=uid, email=email, name=name or (email or "").split("@")[0], photo_url=photo)
        db.add(user)
        await db.flush()
        await _join_demo_orgs(db, user)
    else:
        user.email = email or user.email
        user.name = name or user.name
        user.photo_url = photo or user.photo_url
    await _claim_invites(db, user)
    user.last_seen_at = now_utc_naive()
    await db.commit()
    await db.refresh(user)
    return user


async def _join_demo_orgs(db: AsyncSession, user: User) -> None:
    """New users join the demo orgs listed in NOX_DEMO_ORG_SLUGS, so a fresh sign-in sees the demo estate."""
    slugs = [s.strip() for s in settings.NOX_DEMO_ORG_SLUGS.split(",") if s.strip()]
    if not slugs:
        return
    orgs = (await db.execute(select(Org).where(Org.slug.in_(slugs)))).scalars().all()
    for org in orgs:
        db.add(Membership(user_id=user.id, org_id=org.id))


async def _claim_invites(db: AsyncSession, user: User) -> None:
    """Turn any pending org invites for this email into memberships."""
    if not user.email:
        return
    from ..db.models import OrgInvite

    invites = (await db.execute(select(OrgInvite).where(OrgInvite.email == user.email.lower()))).scalars().all()
    if not invites:
        return
    have = set((await db.execute(select(Membership.org_id).where(Membership.user_id == user.id))).scalars().all())
    for inv in invites:
        if inv.org_id not in have:
            db.add(Membership(user_id=user.id, org_id=inv.org_id, invited_by=inv.invited_by))
        await db.delete(inv)


def hash_api_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not authorization:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    scheme, _, credential = authorization.partition(" ")
    credential = credential.strip()

    if scheme == "Bearer" and credential.startswith("nox_"):
        from ..db.models import ApiToken

        row = (await db.execute(select(ApiToken).where(ApiToken.token_hash == hash_api_token(credential)))).scalars().first()
        if not row:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid API token")
        row.last_used_at = now_utc_naive()
        user = await db.get(User, row.user_id)
        await db.commit()
    elif scheme == "Bearer" and credential:
        claims = await verify_firebase_token(credential)
        user = await _upsert_user(db, claims["sub"], claims.get("email"), claims.get("name"), claims.get("picture"))
    elif scheme == "Dev" and settings.NOX_DEV_AUTH and credential:
        email = credential.lower()
        user = await _upsert_user(db, f"dev:{email}", email, None, None)
    else:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unsupported authorization scheme")

    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown user")
    request.state.user = user
    return user


# ── Acting role + access matrix ──────────────────────────────────────────────


class Cap(StrEnum):
    """Capabilities from the access matrix (docs/01-product-journeys-v2.md)."""

    SEE_ATLAS = "see_atlas"                  # browse orgs, apps, KB pages, contracts; chat with a KB
    MANAGE_ORGS = "manage_orgs"              # create / move orgs and teams
    INVITE_MEMBERS = "invite_members"
    ONBOARD_APP = "onboard_app"
    MANAGE_SOURCES = "manage_sources"        # add sources, sync, retry, restart pipelines
    MANAGE_CONNECTORS = "manage_connectors"  # connector credentials
    PIN_CORRECTION = "pin_correction"
    CREATE_MISSION = "create_mission"
    MANAGE_SIGHTINGS = "manage_sightings"    # schedule and run NoX's suggested changes (CP18)


ACCESS: dict[Role, set[Cap]] = {
    Role.business: {Cap.SEE_ATLAS, Cap.CREATE_MISSION},
    Role.product: {Cap.SEE_ATLAS, Cap.ONBOARD_APP, Cap.MANAGE_SOURCES, Cap.PIN_CORRECTION, Cap.CREATE_MISSION, Cap.MANAGE_SIGHTINGS},
    Role.engineering: set(Cap),
    Role.developer: {Cap.SEE_ATLAS, Cap.ONBOARD_APP, Cap.MANAGE_SOURCES, Cap.PIN_CORRECTION, Cap.CREATE_MISSION},
}


@dataclass
class Actor:
    user: User
    role: Role

    def can(self, cap: Cap) -> bool:
        return cap in ACCESS[self.role]


async def current_actor(
    user: User = Depends(current_user),
    x_nox_role: str | None = Header(default=None),
) -> Actor:
    raw = x_nox_role or (user.last_role.value if user.last_role else None)
    if not raw:
        raise HTTPException(status.HTTP_409_CONFLICT, "Choose a role first", headers={"X-Nox-Needs": "role"})
    try:
        role = Role(raw)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown role '{raw}'") from e
    return Actor(user=user, role=role)


def require(cap: Cap):
    """Route dependency: the acting role must hold `cap`."""

    async def _check(actor: Actor = Depends(current_actor)) -> Actor:
        if not actor.can(cap):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"The {actor.role.value} role can't do that ({cap.value})")
        return actor

    return _check


# ── Org scope ────────────────────────────────────────────────────────────────


async def visible_org_ids(db: AsyncSession, user: User) -> set[uuid.UUID]:
    """Orgs the user is a member of, plus every sub-org beneath them."""
    roots = set((await db.execute(select(Membership.org_id).where(Membership.user_id == user.id))).scalars().all())
    if not roots:
        return set()
    parents = dict((await db.execute(select(Org.id, Org.parent_org_id))).all())
    visible = set()
    for org_id in parents:
        node = org_id
        while node is not None:
            if node in roots:
                visible.add(org_id)
                break
            node = parents.get(node)
    return visible


async def assert_org_visible(db: AsyncSession, user: User, org_id: uuid.UUID | None) -> None:
    if org_id is None or org_id not in await visible_org_ids(db, user):
        # 404, not 403: don't reveal that an org the caller can't see exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
