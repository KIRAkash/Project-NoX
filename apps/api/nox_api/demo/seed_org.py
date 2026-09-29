"""Build the demo estate: Apex Holdings → teams → the five Apex applications, with their sources.

Idempotent: existing orgs are reused by slug and existing apps by name (moved under the right team
if needed). New apps are onboarded and their knowledge-base pipeline launched, unless --no-launch.

Run from apps/api:  uv run python -m nox_api.demo.seed_org [--no-launch] [--member you@example.com]
"""

import argparse
import asyncio
import csv
import logging
from pathlib import Path

from sqlalchemy import select

from ..core.config import settings
from ..db.database import AsyncSessionLocal
from ..db.models import KBStatus, KnowledgeBase, Membership, Org, OrgInvite, User

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("demo-org")

DEMO_DIR = Path(__file__).resolve().parents[4] / "demo"

ROOT = ("apex", "Apex Holdings")
TEAMS = {"trading": "Trading", "post-trade": "Post-Trade", "platform": "Platform"}
APPS = {
    "order-matching-engine": "trading",
    "market-data-gateway": "trading",
    "trade-settlement-system": "post-trade",
    "compliance-surveillance-monitor": "post-trade",
    "mini-auth-service": "platform",
}
PLATFORM_TYPE = {"confluence": "confluence", "jira": "jira", "notion": "notion", "slack": "slack", "local file": "upload"}


def app_sources() -> dict[str, list[dict]]:
    """Sources per app from demo/app_sources.csv, plus the app's own GitHub repo, de-duplicated."""
    base = settings.ATLASSIAN_BASE_URL.rstrip("/")
    out: dict[str, list[dict]] = {app: [{"type": "github", "url": f"https://github.com/{settings.GITHUB_DEFAULT_ORG}/{app}"}] for app in APPS}
    with open(DEMO_DIR / "app_sources.csv", newline="") as f:
        for row in csv.DictReader(f):
            app = row["App Name"].strip()
            kind = PLATFORM_TYPE.get(row["Source Platform"].strip().lower())
            if app not in out or not kind:
                continue
            url = row["URL / File Path"].strip().replace("${ATLASSIAN_BASE_URL}", base)
            if kind == "confluence":
                url = f"{base}/wiki/spaces/APEX"  # the connector reads a whole space; page URLs would be misread
            elif kind == "jira":
                url = f"{base}/jira/projects/{settings.JIRA_DEFAULT_PROJECT}"
            elif kind == "upload":
                url = str(DEMO_DIR / url.replace("demo-codebase/sources-mock-data/", "sources/"))
            if all(s["url"] != url for s in out[app]):
                out[app].append({"type": kind, "url": url})
    return out


async def ensure_org(db, slug: str, name: str, parent: Org | None) -> Org:
    org = (await db.execute(select(Org).where(Org.slug == slug))).scalars().first()
    if org is None:
        org = Org(slug=slug, name=name, parent_org_id=parent.id if parent else None, github_org=settings.GITHUB_DEFAULT_ORG)
        db.add(org)
        await db.flush()
        logger.info(f"➕ org {name} ({slug})")
    elif parent and org.parent_org_id != parent.id:
        org.parent_org_id = parent.id
        logger.info(f"↪️  moved org {name} under {parent.name}")
    return org


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-launch", action="store_true", help="create orgs and apps but don't start pipelines")
    parser.add_argument("--member", action="append", default=[], help="email to add to Apex Holdings (repeatable)")
    args = parser.parse_args()

    sources = app_sources()
    to_launch: list[str] = []
    async with AsyncSessionLocal() as db:
        root = await ensure_org(db, *ROOT, None)
        teams = {slug: await ensure_org(db, slug, name, root) for slug, name in TEAMS.items()}
        org_ids = [root.id, *(t.id for t in teams.values())]

        for app, team_slug in APPS.items():
            team = teams[team_slug]
            kb = (
                await db.execute(select(KnowledgeBase).where(KnowledgeBase.app_name == app, KnowledgeBase.org_id.in_(org_ids)))
            ).scalars().first()
            if kb:
                if kb.org_id != team.id:
                    kb.org_id = team.id
                    logger.info(f"↪️  moved {app} under {team.name}")
                else:
                    logger.info(f"ℹ️  {app} already onboarded ({kb.status.value})")
                if kb.status == KBStatus.queued and not kb.git_repo_url:  # created earlier with --no-launch
                    to_launch.append(str(kb.id))
                continue
            kb = KnowledgeBase(org_id=team.id, app_name=app, source_urls=sources[app])
            db.add(kb)
            await db.flush()
            to_launch.append(str(kb.id))
            logger.info(f"➕ {app} under {team.name} with {len(sources[app])} sources")

        for email in args.member:
            email = email.lower()
            user = (await db.execute(select(User).where(User.email == email))).scalars().first()
            if user:
                if not (await db.execute(select(Membership).where(Membership.user_id == user.id, Membership.org_id == root.id))).scalars().first():
                    db.add(Membership(user_id=user.id, org_id=root.id))
            elif not (await db.execute(select(OrgInvite).where(OrgInvite.email == email, OrgInvite.org_id == root.id))).scalars().first():
                db.add(OrgInvite(org_id=root.id, email=email))
            logger.info(f"👤 {email} → Apex Holdings")
        await db.commit()

    if to_launch and not args.no_launch:
        from ..workers.dispatcher import dispatch_generation_pipeline

        for kb_id in to_launch:
            dispatch_generation_pipeline(kb_id)
        logger.info(f"🚀 launched {len(to_launch)} pipeline(s) — watch them in the Atlas")
    elif to_launch:
        logger.info(f"⏸  {len(to_launch)} app(s) created without launching (--no-launch)")


if __name__ == "__main__":
    asyncio.run(main())
