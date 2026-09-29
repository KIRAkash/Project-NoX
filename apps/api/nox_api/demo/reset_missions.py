"""Clear missions in the demo orgs so a rehearsal starts from an empty board.

    python -m nox_api.demo.reset_missions --yes

Knowledge bases, orgs and people stay. Jira tickets and Git mission folders are left as they are
(close or delete them by hand if a rehearsal made any). Refuses to run unless NOX_DEMO_ORG_SLUGS is set.
"""

import argparse
import asyncio

from sqlalchemy import delete, func, select

from ..core.config import settings
from ..db.database import AsyncSessionLocal
from ..db.models import Mission, Org


async def reset(yes: bool) -> None:
    slugs = [s.strip() for s in settings.NOX_DEMO_ORG_SLUGS.split(",") if s.strip()]
    if not slugs:
        raise SystemExit("NOX_DEMO_ORG_SLUGS is empty — refusing to delete missions outside a demo setup")
    async with AsyncSessionLocal() as db:
        roots = (await db.execute(select(Org).where(Org.slug.in_(slugs)))).scalars().all()
        ids = {o.id for o in roots}
        frontier = set(ids)
        while frontier:  # sub-orgs of the demo orgs
            kids = set((await db.execute(select(Org.id).where(Org.parent_org_id.in_(frontier)))).scalars().all()) - ids
            ids |= kids
            frontier = kids
        count = (await db.execute(select(func.count()).select_from(Mission).where(Mission.org_id.in_(ids)))).scalar()
        others = (await db.execute(select(func.count()).select_from(Mission).where(Mission.org_id.not_in(ids)))).scalar()
        print(f"{count} mission(s) in {', '.join(slugs)} and their sub-orgs; {others} elsewhere (kept)")
        if not yes:
            raise SystemExit("Dry run. Add --yes to delete them.")
        await db.execute(delete(Mission).where(Mission.org_id.in_(ids)))  # files, versions, chat, links, events cascade
        await db.commit()
        print(f"✓ deleted {count}; the next mission is NOX-{(await db.execute(select(func.coalesce(func.max(Mission.number), 0)))).scalar() + 1}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--yes", action="store_true")
    asyncio.run(reset(p.parse_args().yes))
