"""Team memory: NoX learns from people sending work back, and applies the lessons to later missions.

    send back / Not met (with "Remember this")  →  learn (a job)  →  lessons per application and seat
    draft / refine / chat on a later mission     →  lessons_for()  →  the writer applies and cites them

Learning extracts at most three lessons from the person's own words with one FAST structured call. A lesson
is kept only if the words it quotes are really in the feedback (grounded or it doesn't ship), and a lesson for
the business seat must read in business words. People can forget any lesson, or teach one directly on the
application's page. Where lessons are stored is `services/team_memory.py` (Postgres, or Agent Platform
Memory Bank).
"""

from __future__ import annotations

import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import telemetry
from ..db.models import KnowledgeBase, Mission, MissionApp, Role, TeamMemory, User
from ..services import team_memory as store
from .events import record
from .templates import ROLE_NAME

logger = logging.getLogger(__name__)

SEATS = [Role.business, Role.product, Role.engineering, Role.developer]
CITING_SEATS = {Role.engineering, Role.developer, Role.product}  # the business file carries no wikilinks (personas)
_MEMORY_REF = re.compile(r"\[\[memory:([0-9a-fA-F-]{36})(?:\|[^\]]*)?\]\]")

INSTRUCTION = (
    "You read feedback a person gave when they sent a software change back, and decide what it teaches for FUTURE "
    "changes to the same application. Return at most three lessons, and none when the feedback is only about this "
    "one change (a missing button, a typo, a failing test, a wrong date).\n"
    "A good lesson is a rule that would have prevented the send-back on a different change: a security or privacy "
    "rule, a business rule, a convention, a quality bar the team checks.\n"
    "Rules:\n"
    "- fact: one sentence, in plain words, about this application. Never name people.\n"
    "- quote: copy the exact words from the feedback that the lesson rests on. Do not paraphrase the quote.\n"
    "- seats: which files should apply it: business (business requirement), product (product spec), engineering "
    "(engineering design), developer (build spec). Leave it empty when every file should.\n"
    "- Never invent anything the feedback doesn't say."
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[“”\"'‘’`]", "", text or "")).strip().lower()


def grounded(quote: str, feedback: str) -> bool:
    """The lesson's quote is really in the person's words (a few words at least, not a single term)."""
    q = _norm(quote).strip(" .,;:")
    return len(q) >= 12 and len(q.split()) >= 3 and q in _norm(feedback)


def _seats_for(lesson_seats: list[str], fact: str) -> list[Role | None]:
    seats = [Role(s) for s in dict.fromkeys(lesson_seats)]
    if not seats or set(seats) == set(SEATS):
        seats = [None]
    from .lenses import lint_view

    if Role.business in seats and lint_view(Role.business, fact):
        seats = [s for s in seats if s != Role.business] or [Role.product, Role.engineering, Role.developer]
    if None in seats and lint_view(Role.business, fact):  # every seat, but not in business words: technical seats only
        seats = [Role.product, Role.engineering, Role.developer]
    return seats


async def app_names(db: AsyncSession, mission: Mission) -> dict:
    """{kb_id: application name} for the mission's applications."""
    rows = (await db.execute(select(KnowledgeBase.id, KnowledgeBase.app_name)
                             .join(MissionApp, MissionApp.kb_id == KnowledgeBase.id)
                             .where(MissionApp.mission_id == mission.id))).all()
    return {kb_id: name for kb_id, name in rows}


async def learn(mission_id, event_id: str | None, feedback: str, from_role: str, to_role: str, user_id) -> list[dict]:
    """The job behind "Remember this": extract, ground-check and keep lessons. Returns what was learned."""
    from ..ai import structured
    from ..ai.config import Tier
    from ..ai.schemas import Lessons
    from ..db.database import AsyncSessionLocal

    if store.mode() == "off" or not feedback.strip():
        return []
    async with AsyncSessionLocal() as db:
        mission = await db.get(Mission, mission_id)
        if not mission:
            return []
        apps = await app_names(db, mission)
        if not apps:
            return []
        user = await db.get(User, user_id) if user_id else None
        prompt = (f"Application(s): {', '.join(apps.values())}\nMission {mission.key}: {mission.title}\n"
                  f"The {ROLE_NAME[Role(from_role)]} sent it back to the {ROLE_NAME[Role(to_role)]}. Their feedback:\n"
                  f'"""\n{feedback.strip()[:4000]}\n"""')
        try:
            with telemetry.usage_scope("memory:learn", org_id=mission.org_id, mission_id=mission.id):
                found = await structured.ask(Lessons, prompt, name="lesson_finder", instruction=INSTRUCTION, tier=Tier.FAST)
        except Exception:
            logger.exception(f"{mission.key}: couldn't extract lessons")
            return []
        learned: list[dict] = []
        source = store.Source(mission.key, event_id, "", (user.name or user.email) if user else "someone", from_role)
        for lesson in found.items:
            fact = re.sub(r"\s+", " ", lesson.fact).strip()
            if not fact or not grounded(lesson.quote, feedback):
                logger.info(f"{mission.key}: dropped an ungrounded lesson: {fact[:80]}")
                continue
            src = store.Source(source.mission_key, source.event_id, lesson.quote.strip(), source.by, source.role)
            for kb_id, app in apps.items():
                for seat in _seats_for(list(lesson.seats), fact):
                    for change in await store.add(db, org_id=mission.org_id, kb_id=kb_id, app=app, seat=seat, fact=fact,
                                                  kind=lesson.kind, source=src, user_id=user_id):
                        await db.flush()
                        learned.append({"id": str(change.memory.id), "fact": change.memory.fact, "app": app,
                                        "seat": seat.value if seat else None, "action": change.action})
        await db.commit()
        for item in learned:
            if item["action"] == "superseded":
                continue
            await record(db, mission, "memory.learned", {"memoryId": item["id"], "fact": item["fact"], "app": item["app"],
                                                        "seat": item["seat"], "merged": item["action"] == "merged"})
        return learned


async def teach(db: AsyncSession, *, kb: KnowledgeBase, fact: str, seat: Role | None, user: User, role: Role) -> list[store.Change]:
    """A person writes a lesson directly on the application's page."""
    source = store.Source(None, None, fact, user.name or user.email, role.value)
    changes = await store.add(db, org_id=kb.org_id, kb_id=kb.id, app=kb.app_name, seat=seat, fact=fact.strip(),
                              kind="team_rule", source=source, user_id=user.id)
    await db.commit()
    return changes


# ── Applying lessons ─────────────────────────────────────────────────────────


async def lessons_for(db: AsyncSession, mission: Mission, role: Role, kb_ids: list | None = None) -> list[TeamMemory]:
    try:
        apps = await app_names(db, mission)
        if kb_ids is not None:
            apps = {k: v for k, v in apps.items() if k in set(kb_ids)}
        return await store.search(db, apps=apps, seat=role, query=f"{mission.title}\n{mission.prompt}")
    except Exception:
        logger.exception(f"{mission.key}: couldn't load team lessons")
        return []


def origin(m: TeamMemory) -> str:
    """Where a lesson came from, in a few words: 'learned from NOX-3, Product owner'."""
    first = (m.sources or [{}])[0]
    where = first.get("missionKey")
    who = first.get("role")
    if where:
        return f"learned from {where}" + (f", {ROLE_NAME[Role(who)]}" if who in Role.__members__ else "")
    return "taught on the application page"


def render(lessons: list[TeamMemory], role: Role, app_names: dict | None = None) -> str:
    """The writer's block: each lesson with its id, application and origin."""
    if not lessons:
        return ""
    cite = ("Where you apply one, cite it inline right after the sentence as [[memory:<id>]]."
            if role in CITING_SEATS else "Don't cite them in this file: this reader never sees references.")
    lines = [f"- (id {m.id}; {(app_names or {}).get(m.kb_id, '')} · {origin(m)}) {m.fact}" for m in lessons]
    return ("===== What this team has taught NoX =====\n"
            "People taught these rules on earlier missions. Apply each one where it is relevant to this change, in "
            f"this reader's words. The upstream files win if they disagree with a lesson. {cite}\n" + "\n".join(lines))


def cited(markdown: str) -> list[str]:
    return list(dict.fromkeys(m.lower() for m in _MEMORY_REF.findall(markdown or "")))


async def record_applied(db: AsyncSession, mission: Mission, role: Role, lessons: list[TeamMemory], markdown: str) -> None:
    """After a draft or a co-writer turn: which lessons the file used (cited ones; for the business file, the ones
    NoX had in mind), so the file header can show them and the flight recorder can count them."""
    if not lessons:
        return
    given = {str(m.id): m for m in lessons}
    ids = [i for i in cited(markdown) if i in given] if role in CITING_SEATS else list(given)
    if not ids:
        return
    for i in ids:
        given[i].applied_count = (given[i].applied_count or 0) + 1
    await db.commit()
    await record(db, mission, "memory.applied", {"role": role.value, "ids": ids, "cited": role in CITING_SEATS})


def memory_json(m: TeamMemory, app: str | None = None) -> dict:
    return {
        "id": str(m.id), "kbId": str(m.kb_id), "app": app, "seat": m.seat.value if m.seat else None, "fact": m.fact,
        "kind": m.kind, "status": m.status, "sources": m.sources or [], "origin": origin(m), "appliedCount": m.applied_count or 0,
        "createdBy": str(m.created_by) if m.created_by else None, "createdAt": m.created_at.isoformat() if m.created_at else None,
        "inMemoryBank": bool(m.bank_name),
    }


def parse_id(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None
