"""Build the demo estate in NoX: Tidewell Mutual → teams → squads → applications, with their sources.

Reads demo/tidewell/estate.yaml, plus demo/tidewell/.seeded.json for the Slack channel ids and
Notion page URLs that seed_sources created. Run seed_sources first.

Idempotent: existing orgs are reused by slug (and re-parented if the tree changed) and existing apps by
name. New apps are onboarded and their knowledge-base pipeline launched, unless --no-launch.

Run from apps/api:  uv run python -m nox_api.demo.seed_org [--no-launch] [--app billing-service] [--member you@example.com]
"""

import argparse
import asyncio
import logging

from sqlalchemy import select

from ..core.config import settings
from ..db.database import AsyncSessionLocal
from ..db.models import KBStatus, KnowledgeBase, Membership, Org, OrgInvite, User
from . import estate

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("demo-org")


def app_sources(name: str, app: dict, lock: dict) -> list[dict]:
    """The app's GitHub repo plus its sources from the manifest, as connector URLs."""
    base = settings.ATLASSIAN_BASE_URL.rstrip("/")
    src = app.get("sources", {})
    out = [{"type": "github", "url": f"https://github.com/{settings.GITHUB_DEFAULT_ORG}/{name}"}]
    out += [{"type": "confluence", "url": f"{base}/wiki/spaces/{k}"} for k in src.get("confluence", [])]
    if src.get("jira"):
        out.append({"type": "jira", "url": f"{base}/jira/projects/{src['jira']}"})
    for ch in src.get("slack", []):
        if url := lock.get("slack", {}).get(ch):
            out.append({"type": "slack", "url": url})
        else:
            logger.warning(f"{name}: Slack #{ch} not in .seeded.json yet; run seed_sources --only slack")
    for page in src.get("notion", []):
        if url := lock.get("notion", {}).get(page):
            out.append({"type": "notion", "url": url})
        else:
            logger.warning(f"{name}: Notion page {page} not in .seeded.json yet; run seed_sources --only notion")
    out += [{"type": "upload", "url": str(estate.ESTATE_DIR / p)} for p in src.get("uploads", [])]
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
    parser.add_argument("--app", action="append", help="only onboard these apps (repeatable)")
    parser.add_argument("--member", action="append", default=[], help="email to add to the company org (repeatable)")
    args = parser.parse_args()

    m, lock = estate.load(), estate.read_lock()
    to_launch: list[str] = []
    async with AsyncSessionLocal() as db:
        root = await ensure_org(db, m["company"]["slug"], m["company"]["name"], None)
        orgs = {root.slug: root}
        for slug, name, parent in estate.walk_orgs(m["orgs"]):
            orgs[slug] = await ensure_org(db, slug, name, orgs[parent] if parent else root)
        org_ids = [o.id for o in orgs.values()]

        for name, app in m["apps"].items():
            if args.app and name not in args.app:
                continue
            team = orgs[app["org"]]
            kb = (await db.execute(
                select(KnowledgeBase).where(KnowledgeBase.app_name == name, KnowledgeBase.org_id.in_(org_ids))
            )).scalars().first()
            if kb:
                if kb.org_id != team.id:
                    kb.org_id = team.id
                    logger.info(f"↪️  moved {name} under {team.name}")
                else:
                    logger.info(f"ℹ️  {name} already onboarded ({kb.status.value})")
                if kb.status == KBStatus.queued and not kb.git_repo_url:  # created earlier with --no-launch
                    to_launch.append(str(kb.id))
                continue
            sources = app_sources(name, app, lock)
            kb = KnowledgeBase(org_id=team.id, app_name=name, source_urls=sources)
            db.add(kb)
            await db.flush()
            to_launch.append(str(kb.id))
            logger.info(f"➕ {name} under {team.name} with {len(sources)} sources")

        for email in args.member:
            email = email.lower()
            user = (await db.execute(select(User).where(User.email == email))).scalars().first()
            if user:
                if not (await db.execute(select(Membership).where(Membership.user_id == user.id, Membership.org_id == root.id))).scalars().first():
                    db.add(Membership(user_id=user.id, org_id=root.id))
            elif not (await db.execute(select(OrgInvite).where(OrgInvite.email == email, OrgInvite.org_id == root.id))).scalars().first():
                db.add(OrgInvite(org_id=root.id, email=email))
            logger.info(f"👤 {email} → {root.name}")
        await db.commit()

    if to_launch and not args.no_launch:
        from ..workers.dispatcher import dispatch_generation_pipeline

        for kb_id in to_launch:
            dispatch_generation_pipeline(kb_id)
        logger.info(f"🚀 launched {len(to_launch)} pipeline(s); watch them in the Atlas")
    elif to_launch:
        logger.info(f"⏸  {len(to_launch)} app(s) created without launching (--no-launch)")


if __name__ == "__main__":
    asyncio.run(main())
