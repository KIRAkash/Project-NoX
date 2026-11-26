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

from ..core.auth import assert_org_visible, visible_org_ids
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
    OrgInvite,
    SourceMonitor,
    User,
    WorkspaceOnboarding,
)

ESTATES = ("demo", "fresh")

SETUP_MILESTONES = (
    "create_org",
    "link_connector",
    "invite_seat",
    "launch_mission",
)

MILESTONE_DEFS: dict[str, dict[str, str]] = {
    "create_org": {
        "title": "Chart your organization",
        "description": "Create your workspace organization and team structure in the Atlas.",
        "href": "/app/atlas",
        "actionLabel": "Chart organization",
    },
    "link_connector": {
        "title": "Connect repository",
        "description": "Link a GitHub repository or knowledge connector to build your first code wiki.",
        "href": "/app/atlas/new",
        "actionLabel": "Connect repository",
    },
    "invite_seat": {
        "title": "Invite a seat",
        "description": "Invite a teammate to collaborate across business, product, engineering, and developer seats.",
        "href": "/app/atlas#members",
        "actionLabel": "Invite a seat",
    },
    "launch_mission": {
        "title": "Launch a mission",
        "description": "Start your first mission and let NoX co-write the specification.",
        "href": "/app/missions/new",
        "actionLabel": "Launch a mission",
    },
}

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


# ── Workspace setup checklist ────────────────────────────────────────────────


async def workspace_root_id(db: AsyncSession, org_id: uuid.UUID) -> uuid.UUID:
    """Walk `parent_org_id` up to the top-level workspace Org."""
    parents: dict[uuid.UUID, uuid.UUID | None] = dict((await db.execute(select(Org.id, Org.parent_org_id))).all())
    cur = org_id
    seen: set[uuid.UUID] = set()
    while cur in parents and parents[cur] is not None and cur not in seen:
        seen.add(cur)
        parent = parents[cur]
        if parent is None:
            break
        cur = parent
    return cur


async def _subtree_org_ids(db: AsyncSession, root_id: uuid.UUID) -> list[uuid.UUID]:
    rows = (await db.execute(select(Org.id, Org.parent_org_id))).all()
    children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    for oid, pid in rows:
        children.setdefault(pid, []).append(oid)
    out: list[uuid.UUID] = []
    stack = [root_id]
    seen: set[uuid.UUID] = set()
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        out.append(cur)
        stack.extend(children.get(cur, []))
    return out


async def record_milestone(db: AsyncSession, org_id: uuid.UUID, step: str) -> WorkspaceOnboarding:
    """Persist a completed setup step on the workspace that owns `org_id`."""
    if step not in SETUP_MILESTONES:
        raise ValueError(f"Unknown setup milestone: {step}")
    root_id = await workspace_root_id(db, org_id)
    row = (await db.execute(select(WorkspaceOnboarding).where(WorkspaceOnboarding.org_id == root_id))).scalars().first()
    if row is None:
        ordered = [s for s in SETUP_MILESTONES if s in {"create_org", step}]
        row = WorkspaceOnboarding(org_id=root_id, completed_steps=ordered, dismissed_by=[])
        db.add(row)
        await db.flush()
        return row
    have = set(row.completed_steps or []) | {"create_org", step}
    ordered = [s for s in SETUP_MILESTONES if s in have]
    if ordered != list(row.completed_steps or []):
        row.completed_steps = ordered
        row.updated_at = now_utc_naive()
        await db.flush()
    return row


async def sync_workspace_milestones(db: AsyncSession, org_id: uuid.UUID) -> tuple[WorkspaceOnboarding, bool]:
    """Reconcile live workspace state with persisted setup milestones and save any newly reached steps."""
    root_id = await workspace_root_id(db, org_id)
    subtree = await _subtree_org_ids(db, root_id)
    row = (await db.execute(select(WorkspaceOnboarding).where(WorkspaceOnboarding.org_id == root_id))).scalars().first()
    have = set(row.completed_steps or []) if row else set()
    have.add("create_org")

    if "link_connector" not in have:
        root_org = await db.get(Org, root_id)
        has_kb = (await db.execute(select(KnowledgeBase.id).where(KnowledgeBase.org_id.in_(subtree)).limit(1))).first() is not None
        has_monitor = (
            await db.execute(
                select(SourceMonitor.id)
                .join(KnowledgeBase, KnowledgeBase.id == SourceMonitor.kb_id)
                .where(KnowledgeBase.org_id.in_(subtree))
                .limit(1)
            )
        ).first() is not None
        if has_kb or has_monitor or bool(root_org and root_org.github_org):
            have.add("link_connector")

    if "invite_seat" not in have:
        has_invite = (await db.execute(select(OrgInvite.id).where(OrgInvite.org_id.in_(subtree)).limit(1))).first() is not None
        has_invited_member = (
            await db.execute(
                select(Membership.id)
                .where(Membership.org_id.in_(subtree), Membership.invited_by.is_not(None))
                .limit(1)
            )
        ).first() is not None
        if has_invite or has_invited_member:
            have.add("invite_seat")

    if "launch_mission" not in have:
        has_mission = (await db.execute(select(Mission.id).where(Mission.org_id.in_(subtree)).limit(1))).first() is not None
        if has_mission:
            have.add("launch_mission")

    ordered = [s for s in SETUP_MILESTONES if s in have]
    changed = False
    if row is None:
        row = WorkspaceOnboarding(org_id=root_id, completed_steps=ordered, dismissed_by=[])
        db.add(row)
        await db.flush()
        changed = True
    elif ordered != list(row.completed_steps or []):
        row.completed_steps = ordered
        row.updated_at = now_utc_naive()
        await db.flush()
        changed = True
    return row, changed


async def _select_workspace_org(db: AsyncSession, user: User, org_id: uuid.UUID | None = None) -> Org | None:
    visible = await visible_org_ids(db, user)
    if org_id is not None:
        await assert_org_visible(db, user, org_id)
        orgs_by_id = {
            o.id: o for o in (await db.execute(select(Org).where(Org.id.in_(visible)))).scalars().all()
        }
        cur = orgs_by_id[org_id]
        seen: set[uuid.UUID] = set()
        while cur.parent_org_id and cur.parent_org_id in orgs_by_id and cur.id not in seen:
            seen.add(cur.id)
            cur = orgs_by_id[cur.parent_org_id]
        return cur
    if not visible:
        return None
    orgs = list((await db.execute(select(Org).where(Org.id.in_(visible)).order_by(Org.created_at))).scalars().all())
    top = [o for o in orgs if o.parent_org_id is None or o.parent_org_id not in visible]
    demo = set(demo_slugs())
    non_demo = [o for o in top if o.slug not in demo]
    return (non_demo or top)[0]


def _format_checklist(ws_org: Org | None, completed_steps: list[str], dismissed: bool) -> dict:
    completed_set = set(completed_steps)
    steps = [
        {
            "key": key,
            **MILESTONE_DEFS[key],
            "completed": key in completed_set,
        }
        for key in SETUP_MILESTONES
    ]
    completed_count = sum(1 for s in steps if s["completed"])
    total_count = len(SETUP_MILESTONES)
    return {
        "workspaceId": str(ws_org.id) if ws_org else None,
        "workspaceName": ws_org.name if ws_org else None,
        "completedSteps": [s["key"] for s in steps if s["completed"]],
        "completedCount": completed_count,
        "totalCount": total_count,
        "progressPercent": round((completed_count * 100) / total_count) if total_count else 100,
        "completed": completed_count >= total_count,
        "dismissed": dismissed,
        "steps": steps,
    }


async def checklist_status(db: AsyncSession, user: User, org_id: uuid.UUID | None = None) -> dict:
    """Return setup checklist progress and step details for the caller's workspace."""
    ws_org = await _select_workspace_org(db, user, org_id)
    if ws_org is None:
        return _format_checklist(None, [], bool(user.checklist_dismissed))
    row, changed = await sync_workspace_milestones(db, ws_org.id)
    if changed:
        await db.commit()
    dismissed = str(user.id) in (row.dismissed_by or [])
    return _format_checklist(ws_org, list(row.completed_steps or []), dismissed)


async def dismiss_checklist(db: AsyncSession, user: User, org_id: uuid.UUID | None = None, *, dismissed: bool = True) -> dict:
    """Persist or clear the caller's dismissal preference for their workspace setup checklist."""
    ws_org = await _select_workspace_org(db, user, org_id)
    if ws_org is None:
        user.checklist_dismissed = dismissed
        await db.commit()
        return _format_checklist(None, [], bool(user.checklist_dismissed))
    row, _ = await sync_workspace_milestones(db, ws_org.id)
    uid = str(user.id)
    cur = [x for x in (row.dismissed_by or []) if x != uid]
    if dismissed:
        cur.append(uid)
    row.dismissed_by = cur
    row.updated_at = now_utc_naive()
    await db.commit()
    return _format_checklist(ws_org, list(row.completed_steps or []), dismissed)
