"""First run: the welcome screen's choice between the demo estate and an empty sky, and the guided tours.

A new user joins no org on sign-in. The welcome screen shows them a read-only summary of the demo estate (the orgs
named in `NOX_DEMO_ORG_SLUGS`, e.g. Tidewell), then records their answer:

- `demo`: they join the demo orgs, as every new user used to on sign-in.
- `fresh`: they join nothing. Invites to real orgs are still claimed on sign-in (`core/auth._claim_invites`).

Either way they can switch later from the account menu. Leaving the demo removes only the memberships the demo
gave them (no `invited_by`), never one an engineering lead invited them to.

Tours are keyed (`TOUR_KEYS`) and recorded per user once finished or skipped, so they follow the person across
devices. Users who signed up before onboarding existed were marked as having seen them all (migration 0012).
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.time_utils import now_utc_naive
from ..db.models import KBStatus, KnowledgeBase, Membership, Mission, MissionStage, Org, OrgInterfaceContract, User

ESTATES = ("demo", "fresh")

# A home tour per seat, the fresh-start tour, then one per page that has its own features to point at.
TOUR_KEYS = (
    "home:business",
    "home:product",
    "home:engineering",
    "home:developer",
    "fresh",
    "mission",
    "atlas",
    "kb",
)


def demo_slugs() -> list[str]:
    return [s.strip() for s in settings.NOX_DEMO_ORG_SLUGS.split(",") if s.strip()]


async def _demo_roots(db: AsyncSession) -> list[Org]:
    slugs = demo_slugs()
    if not slugs:
        return []
    return list((await db.execute(select(Org).where(Org.slug.in_(slugs)).order_by(Org.name))).scalars().all())


async def _descendants(db: AsyncSession, roots: list[Org]) -> dict[uuid.UUID, uuid.UUID]:
    """Every org beneath the demo roots (roots included), mapped to the top-level team it sits under (or the root)."""
    parents: dict[uuid.UUID, uuid.UUID | None] = dict((await db.execute(select(Org.id, Org.parent_org_id))).all())
    root_ids = {r.id for r in roots}
    team_of: dict[uuid.UUID, uuid.UUID] = {}
    for org_id in parents:
        path = [org_id]
        node = parents.get(org_id)
        while node is not None and path[-1] not in root_ids:
            path.append(node)
            node = parents.get(node)
        if path[-1] in root_ids:
            # path ends at the root; the element before it is the top-level team
            team_of[org_id] = path[-2] if len(path) > 1 else path[-1]
    return team_of


async def demo_available(db: AsyncSession) -> bool:
    return bool(await _demo_roots(db))


async def is_in_demo(db: AsyncSession, user: User) -> bool:
    roots = await _demo_roots(db)
    if not roots:
        return False
    found = await db.execute(
        select(Membership.id).where(Membership.user_id == user.id, Membership.org_id.in_([r.id for r in roots])).limit(1)
    )
    return found.first() is not None


async def join_demo(db: AsyncSession, user: User) -> None:
    have = set((await db.execute(select(Membership.org_id).where(Membership.user_id == user.id))).scalars().all())
    for org in await _demo_roots(db):
        if org.id not in have:
            db.add(Membership(user_id=user.id, org_id=org.id))


async def leave_demo(db: AsyncSession, user: User) -> None:
    roots = await _demo_roots(db)
    if not roots:
        return
    team_of = await _descendants(db, roots)
    rows = (
        await db.execute(
            select(Membership).where(
                Membership.user_id == user.id, Membership.org_id.in_(list(team_of)), Membership.invited_by.is_(None)
            )
        )
    ).scalars().all()
    for m in rows:
        await db.delete(m)


async def choose_estate(db: AsyncSession, user: User, estate: str) -> None:
    """Record the welcome screen's answer. Calling it again switches estates."""
    if estate == "demo":
        await join_demo(db, user)
    else:
        await leave_demo(db, user)
    user.estate = estate
    if user.onboarded_at is None:
        user.onboarded_at = now_utc_naive()


async def estate_summary(db: AsyncSession, user: User) -> dict:
    """What the welcome screen shows of the demo: its teams and applications, and a few counts. Read-only."""
    roots = await _demo_roots(db)
    if not roots:
        return {"available": False, "orgs": [], "teams": [], "counts": None, "yourMissions": 0}
    team_of = await _descendants(db, roots)
    names = dict((await db.execute(select(Org.id, Org.name).where(Org.id.in_(list(team_of))))).all())
    root_ids = {r.id for r in roots}

    teams: dict[uuid.UUID, dict] = {}
    for org_id, team_id in team_of.items():
        if team_id not in root_ids and team_id not in teams:
            teams[team_id] = {"name": names.get(team_id, ""), "apps": []}
    kbs = (
        await db.execute(
            select(KnowledgeBase.org_id, KnowledgeBase.app_name, KnowledgeBase.status)
            .where(KnowledgeBase.org_id.in_(list(team_of)))
            .order_by(KnowledgeBase.app_name)
        )
    ).all()
    for org_id, app_name, status in kbs:
        team = teams.get(team_of[org_id])
        if team is not None:
            team["apps"].append({"name": app_name, "status": status.value if status else KBStatus.queued.value})

    open_missions = (
        await db.execute(
            select(func.count(Mission.id)).where(
                Mission.org_id.in_(list(team_of)), Mission.stage != MissionStage.done, Mission.cancelled_at.is_(None)
            )
        )
    ).scalar_one()
    contracts = (
        await db.execute(select(func.count(OrgInterfaceContract.id)).where(OrgInterfaceContract.org_id.in_(list(team_of))))
    ).scalar_one()
    yours = (
        await db.execute(
            select(func.count(Mission.id)).where(
                Mission.org_id.in_(list(team_of)), Mission.created_by == user.id, Mission.cancelled_at.is_(None)
            )
        )
    ).scalar_one()

    ordered = sorted(teams.values(), key=lambda t: (-len(t["apps"]), t["name"]))
    return {
        "available": True,
        "orgs": [{"name": r.name, "slug": r.slug} for r in roots],
        "teams": ordered,
        "counts": {
            "teams": len(teams),
            "apps": len(kbs),
            "appsInOrbit": sum(1 for _, _, s in kbs if s == KBStatus.published),
            "missionsInFlight": open_missions,
            "contracts": contracts,
        },
        "yourMissions": yours,
    }
