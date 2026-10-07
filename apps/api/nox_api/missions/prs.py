"""Pull requests on missions: link a PR by its branch, title or body naming NOX-n, and leave a guard comment.

The guard checks the PR's added lines against the rules in each mission app's knowledge base
(decisions and concepts) and posts the result on the PR, so reviewers see it where they work.
"""

import asyncio
import logging
import re
from datetime import datetime

from ..core.time_utils import now_utc

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents.guard import evaluate_diff_against_constraints, extract_constraints_from_kb
from ..db.models import ExternalLink, KnowledgeBase, Mission, MissionApp
from ..services.local_storage import load_checkpoint_json
from .events import record

logger = logging.getLogger(__name__)

KEY_RE = re.compile(r"(?i)\bnox-(\d+)\b")
GUARD_MARK = "<!-- nox-guard -->"


def mission_numbers(*texts: str | None) -> list[int]:
    """NOX-n keys named anywhere in the branch, title or body, in order of first mention."""
    seen: list[int] = []
    for t in texts:
        for n in KEY_RE.findall(t or ""):
            if int(n) not in seen:
                seen.append(int(n))
    return seen


def parse_pr_url(url: str) -> tuple[str, int]:
    m = re.match(r"^https?://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)", url.strip())
    if not m:
        raise ValueError("Expected a GitHub pull request URL like https://github.com/org/repo/pull/12")
    return m.group(1), int(m.group(2))


def pr_state(pr: dict) -> dict:
    return {
        "title": pr.get("title"),
        "state": "merged" if pr.get("merged") else pr.get("state"),
        "branch": (pr.get("head") or {}).get("ref"),
        "author": (pr.get("user") or {}).get("login"),
        "syncedAt": now_utc().isoformat(timespec="seconds"),
    }


async def upsert_pr_link(db: AsyncSession, mission: Mission, full_name: str, pr: dict, actor=None, acting_role: str | None = None) -> ExternalLink:
    ext_id = f"{full_name}#{pr['number']}"
    link = (await db.execute(select(ExternalLink).where(
        ExternalLink.mission_id == mission.id, ExternalLink.system == "github_pr", ExternalLink.external_id == ext_id))).scalars().first()
    state = pr_state(pr)
    new = link is None
    if new:
        link = ExternalLink(mission_id=mission.id, system="github_pr", external_id=ext_id, url=pr.get("html_url"), primary=False, state=state)
        db.add(link)
    else:
        changed = (link.state or {}).get("state") != state["state"]
        link.state = {**(link.state or {}), **state}
        if not changed:
            await db.commit()
            return link
    await db.commit()
    await record(db, mission, "pr.linked" if new else "pr.updated", {"pr": ext_id, "url": pr.get("html_url"), "state": state["state"], "title": state["title"]},
                 actor, acting_role)
    return link


async def mission_kb_files(db: AsyncSession, mission: Mission) -> list[tuple[str, dict[str, str]]]:
    kb_ids = (await db.execute(select(MissionApp.kb_id).where(MissionApp.mission_id == mission.id))).scalars().all()
    out = []
    for kb_id in kb_ids:
        kb = await db.get(KnowledgeBase, kb_id)
        if kb:
            out.append((kb.app_name, load_checkpoint_json(str(kb.id), "compiled_files.json") or {}))
    return out


def guard_report(diff: str, kbs: list[tuple[str, dict[str, str]]]) -> tuple[bool, int, list[dict]]:
    rules, violations = 0, []
    for app, files in kbs:
        constraints = extract_constraints_from_kb(files)
        rules += len(constraints)
        for v in evaluate_diff_against_constraints(diff, constraints):
            violations.append({"app": app, **v.model_dump()})
    return not violations, rules, violations


def guard_comment(mission: Mission, compliant: bool, rules: int, violations: list[dict], mission_url: str) -> str:
    head = f"{GUARD_MARK}\n### NoX guard · [{mission.key}]({mission_url}): {mission.title}\n\n"
    if compliant:
        return head + f"✅ No conflicts with the {rules} architecture rules in the knowledge base.\n\nThe mission's verification checklists open when the developer marks it completed in NoX."
    lines = [f"- **{v['app']}** · `{v['source_file']}` — {v['rule_text']}\n  <sub>{v['violation_context']}</sub>" for v in violations[:10]]
    return head + f"⚠️ {len(violations)} possible conflict(s) with {rules} architecture rules. A human decides:\n\n" + "\n".join(lines)


def _fetch_pr(full_name: str, number: int) -> tuple[dict, str]:
    from ..services.gitops import get_github_client

    pr = get_github_client().get_repo(full_name).get_pull(number)
    raw = pr.raw_data
    diff = "\n".join(f"+++ b/{f.filename}\n{f.patch or ''}" for f in pr.get_files())
    return raw, diff


def _post_or_update_comment(full_name: str, number: int, body: str) -> None:
    from ..services.gitops import get_github_client

    issue = get_github_client().get_repo(full_name).get_issue(number)
    for c in issue.get_comments():
        if GUARD_MARK in (c.body or ""):
            c.edit(body)
            return
    issue.create_comment(body)


async def guard_pr(mission_id, full_name: str, number: int) -> None:
    """Background: fetch the PR diff, run the guard, comment on the PR, record the result."""
    from sqlalchemy.orm import selectinload

    from ..db.database import AsyncSessionLocal
    from .jira_sync import mission_url

    async with AsyncSessionLocal() as db:
        mission = (await db.execute(select(Mission).options(selectinload(Mission.files), selectinload(Mission.links)).where(Mission.id == mission_id))).scalars().first()
        if not mission:
            return
        try:
            pr, diff = await asyncio.to_thread(_fetch_pr, full_name, number)
        except Exception as e:
            logger.warning(f"guard: couldn't read {full_name}#{number}: {e}")
            await record(db, mission, "pr.guard_failed", {"pr": f"{full_name}#{number}", "error": str(e)[:200]})
            return
        link = await upsert_pr_link(db, mission, full_name, pr)
        compliant, rules, violations = guard_report(diff, await mission_kb_files(db, mission))
        try:
            await asyncio.to_thread(_post_or_update_comment, full_name, number, guard_comment(mission, compliant, rules, violations, mission_url(mission)))
            commented = True
        except Exception as e:
            logger.warning(f"guard: couldn't comment on {full_name}#{number}: {e}")
            commented = False
        link.state = {**(link.state or {}), "guard": {"compliant": compliant, "rules": rules, "violations": len(violations), "commented": commented}}
        await db.commit()
        await record(db, mission, "pr.guarded", {"pr": link.external_id, "compliant": compliant, "violations": len(violations), "rules": rules})
