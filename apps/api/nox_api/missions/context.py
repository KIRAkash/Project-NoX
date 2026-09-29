"""Knowledge-base context for drafting: each app's brief, its interfaces, and the pages most relevant to the prompt."""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agents.digest import generate_architecture_digest
from ..db.models import KnowledgeBase, Org, OrgInterfaceContract
from ..services.local_storage import load_checkpoint_json

STOP = set("the a an and or of to in on for with is are be as at by it this that from can we our so do does not".split())


def _terms(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z0-9_-]{2,}", text.lower()) if w not in STOP}


def rank_pages(files: dict[str, str], query: str, k: int = 3) -> list[tuple[str, str]]:
    q = _terms(query)
    scored = []
    for path, content in files.items():
        if path.startswith(".") or path in ("AGENTS.md", "log.md"):
            continue
        words = _terms(content)
        score = len(q & words) + 3 * len(q & _terms(path))
        if score:
            scored.append((score, path, content))
    scored.sort(key=lambda x: -x[0])
    return [(p, c) for _, p, c in scored[:k]]


async def relevant_pages(db: AsyncSession, kb_id, files: dict[str, str], query: str, k: int = 3) -> list[tuple[str, str]]:
    """The KB's most relevant pages as (path, text): hybrid search's best sections, else keyword ranking."""
    from ..services.search import search

    try:
        hits = await search(db, query, [kb_id], k=k)
    except Exception:
        await db.rollback()
        hits = []
    if hits:
        return [(h.path, h.content) for h in hits]
    return rank_pages(files, query, k=k)


async def kb_context(db: AsyncSession, kb_ids: list, query: str, budget: int = 24000) -> str:
    parts: list[str] = []
    for kb_id in kb_ids:
        kb = await db.get(KnowledgeBase, kb_id)
        if not kb:
            continue
        org = await db.get(Org, kb.org_id)
        files = load_checkpoint_json(str(kb.id), "compiled_files.json") or {}
        brief = files.get(".nox/brief.md") or (generate_architecture_digest(kb.app_name, org.slug if org else "", files) if files else "")
        contracts = (await db.execute(select(OrgInterfaceContract).where(OrgInterfaceContract.kb_id == kb.id))).scalars().all()
        section = [f"### Application: {kb.app_name}", brief[:4000]]
        if contracts:
            section.append("Interfaces it exposes: " + "; ".join(f"{c.interface_type.value} {c.identifier}" for c in contracts[:25]))
        for path, content in await relevant_pages(db, kb.id, files, query):
            section.append(f"#### KB page `kb:{kb.app_name}/{path.removesuffix('.md')}`\n{content[:2500]}")
        parts.append("\n\n".join(section))
    text = "\n\n---\n\n".join(parts)
    return text[:budget] if text else "(No knowledge base is available for the selected applications yet.)"


async def mission_apps(db: AsyncSession, kb_ids: list) -> dict[str, str]:
    """The mission's applications as {app name: kb id}: the scope NoX's lookup tools work in."""
    if not kb_ids:
        return {}
    rows = (await db.execute(select(KnowledgeBase.app_name, KnowledgeBase.id).where(KnowledgeBase.id.in_(list(kb_ids))))).all()
    return {name: str(kb_id) for name, kb_id in rows}


def jira_context(mission) -> str:
    """The linked Jira tickets' text, so NoX writes from what the ticket already says."""
    parts = []
    for link in getattr(mission, "links", None) or []:
        if link.system == "jira" and (link.state or {}).get("summary"):
            st = link.state
            parts.append(f"### Linked Jira issue {link.external_id} ({st.get('type') or 'issue'}, {st.get('status') or 'unknown status'})\n"
                         f"{st.get('summary')}\n{(st.get('description') or '')[:3000]}")
    return ("\n\n".join(parts) + "\n\n---\n\n") if parts else ""
