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

import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.time_utils import now_utc_naive
from ..db.models import (
    KBStatus,
    KnowledgeBase,
    Membership,
    Mission,
    MissionApp,
    MissionStage,
    Org,
    OrgInterfaceContract,
    User,
)

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


_SOURCE_ORDER = ("github", "confluence", "jira", "slack", "notion", "upload")


def _source_label(kind: str, url: str, apps: list[str]) -> str:
    """A short, readable name for a connected source: the repo, the space or project key, or whose channel it is."""
    if kind == "github":
        m = re.search(r"github\.com/([^/]+/[^/?#]+)", url)
        return m.group(1) if m else url
    if kind == "confluence":
        m = re.search(r"/spaces/([^/?#]+)", url)
        return f"{m.group(1)} space" if m else url
    if kind == "jira":
        m = re.search(r"/projects/([^/?#]+)", url) or re.search(r"/browse/([A-Z][A-Z0-9]+)", url)
        return f"{m.group(1)} project" if m else url
    owner = apps[0] if len(apps) == 1 else f"{len(apps)} applications"
    return f"{'Channel' if kind == 'slack' else 'Page' if kind == 'notion' else 'File'} for {owner}"


def _sources(kbs: list[KnowledgeBase]) -> list[dict]:
    """Every source the demo's applications are built from, grouped by kind, with links: the proof it's all real."""
    seen: dict[tuple[str, str], list[str]] = {}
    for kb in kbs:
        for src in kb.source_urls or []:
            kind, url = src.get("type"), src.get("url")
            if kind and url:
                seen.setdefault((kind, url), []).append(kb.app_name)
    groups: list[dict] = []
    for kind in _SOURCE_ORDER:
        items = [
            {"url": url if url.startswith("http") else None, "label": _source_label(kind, url, apps), "apps": apps}
            for (k, url), apps in sorted(seen.items(), key=lambda x: x[0][1])
            if k == kind
        ]
        if items:
            groups.append({"type": kind, "items": items})
    wikis = [{"url": kb.git_repo_url, "label": _source_label("github", kb.git_repo_url, []), "apps": [kb.app_name]} for kb in kbs if kb.git_repo_url]
    if wikis:
        groups.append({"type": "wiki", "items": wikis})
    return groups


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
    """What the welcome screen shows of the demo: its teams and applications (with their contracts and whether a
    mission is changing them), the sources each is built from, and a few counts. Read-only."""
    roots = await _demo_roots(db)
    if not roots:
        return {"available": False, "orgs": [], "teams": [], "sources": [], "counts": None, "yourMissions": 0}
    team_of = await _descendants(db, roots)
    names = dict((await db.execute(select(Org.id, Org.name).where(Org.id.in_(list(team_of))))).all())
    root_ids = {r.id for r in roots}

    teams: dict[uuid.UUID, dict] = {}
    for org_id, team_id in team_of.items():
        if team_id not in root_ids and team_id not in teams:
            teams[team_id] = {"name": names.get(team_id, ""), "apps": []}
    kbs = list(
        (
            await db.execute(
                select(KnowledgeBase).where(KnowledgeBase.org_id.in_(list(team_of))).order_by(KnowledgeBase.app_name)
            )
        ).scalars().all()
    )
    per_app = dict(
        (
            await db.execute(
                select(OrgInterfaceContract.kb_id, func.count(OrgInterfaceContract.id))
                .where(OrgInterfaceContract.kb_id.in_([k.id for k in kbs]))
                .group_by(OrgInterfaceContract.kb_id)
            )
        ).all()
    ) if kbs else {}
    in_flight = set(
        (
            await db.execute(
                select(MissionApp.kb_id)
                .join(Mission, Mission.id == MissionApp.mission_id)
                .where(Mission.stage != MissionStage.done, Mission.cancelled_at.is_(None))
            )
        ).scalars().all()
    )
    for kb in kbs:
        team = teams.get(team_of[kb.org_id])
        if team is not None:
            team["apps"].append({
                "name": kb.app_name,
                "status": kb.status.value if kb.status else KBStatus.queued.value,
                "contracts": per_app.get(kb.id, 0),
                "inFlight": kb.id in in_flight,
            })

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
        "sources": _sources(kbs),
        "counts": {
            "teams": len(teams),
            "apps": len(kbs),
            "appsInOrbit": sum(1 for k in kbs if k.status == KBStatus.published),
            "missionsInFlight": open_missions,
            "contracts": contracts,
        },
        "yourMissions": yours,
    }
