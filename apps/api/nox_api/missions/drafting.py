"""NoX's writing: first drafts of spec files, grounded in upstream files and the knowledge base."""

import logging
import re
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..db.database import AsyncSessionLocal
from ..db.models import Mission, MissionApp, Role, SpecFileVersion, SpecStatus
from .context import jira_context, kb_context, mission_apps
from .events import record
from .personas import checklist_brief, persona_brief
from .templates import ROLE_NAME, ROLE_ORDER, SECTIONS, TITLE, VERIFY_HEADING

logger = logging.getLogger(__name__)

SYSTEM = (
    "You are NoX, an AI co-author inside a spec-driven development platform. Each software change (a mission) has "
    "four Markdown spec files, one per role, each read and signed off by that role: business requirement (Business "
    "user), product spec (Product owner), engineering design (Engineering lead), build spec (Developer). You write "
    "the file for one role, building on the files above it.\n"
    "Rules:\n"
    "- Write as that role's trusted colleague would: through their lens, in their vocabulary, at the depth the change "
    "deserves for them. The reader brief in the request is binding. A file that is correct but written for the wrong "
    "reader is a failed file.\n"
    "- Output only the Markdown file. No preamble, no code fences around the whole file.\n"
    "- Be specific and concrete within the reader's vocabulary.\n"
    "- Use only facts from the knowledge base context, the upstream files and the request. Never invent file paths, "
    "endpoints, names or metrics. If something is unknown, write it as an open question.\n"
    "- Where the reader brief allows citations, cite knowledge-base statements inline as a wikilink, e.g. "
    "[[kb:app-name/entities/page]].\n"
    "- Never pad. A short file for a small change is correct.\n"
    f"- End the file with a '{VERIFY_HEADING}' section of '- [ ]' items that the role will tick after the change ships."
)


def change_signals(mission: Mission, role: Role) -> str:
    """What NoX weighs before choosing how deep this file goes for its reader."""
    creator = mission.created_as_role
    lines = [f"This mission was started from the {ROLE_NAME[creator]} seat."]
    if role == creator:
        lines.append("This is the author's own file: write it at full depth.")
    elif ROLE_ORDER.index(creator) > ROLE_ORDER.index(Role.product) and role in (Role.business, Role.product):
        lines.append(
            f"A mission started this far down is often a technical change. Read the request: if nothing a user or the "
            f"business would notice changes, write this {TITLE[role].lower()} as a light touch. If the request does "
            f"describe a visible outcome, write it at full depth."
        )
    return "\n".join(lines)


def build_prompt(mission: Mission, role: Role, upstream: dict[Role, str], context: str, current: str | None = None,
                 instruction: str | None = None, editing: bool = False, evidence: list | None = None) -> str:
    """The writer's request. `evidence` is the mission's analysed captures (missions/media.py `MediaEvidence`)."""
    parts = [
        f"Mission {mission.key}: {mission.title}",
        f'Original request (verbatim): "{mission.prompt}"',
        change_signals(mission, role),
        f"\nYou are writing the **{TITLE[role]}**: the {ROLE_NAME[role]}'s file.",
        f"\n===== Reader brief: {ROLE_NAME[role]} =====\n{persona_brief(role)}",
        f"\n===== File shape =====\nStart with a level-1 heading '# {TITLE[role]}: <short title>'. "
        "Then these sections as '##' headings, in order, with the heading text exactly as written:",
        *[f"- {h}: {brief}" for h, brief in SECTIONS[role]],
        f"- {VERIFY_HEADING.removeprefix('## ')}: {checklist_brief(role)}",
    ]
    for r, md in upstream.items():
        parts.append(f"\n===== Upstream file: {TITLE[r]} ({ROLE_NAME[r]}) =====\n{md}")
    if evidence:
        from .media import render_evidence

        parts.append("\n" + render_evidence(evidence, role))
    parts.append(f"\n===== Knowledge base context =====\n{context}")
    if current:
        parts.append(
            "\n===== The file as it stands now =====\n"
            "The author owns this file. Keep every section and statement they wrote, with their heading wording, "
            "including sections that are not in the list above (keep those where they are). Only remove something if "
            f"it is factually wrong for this codebase, and then say why {'in your reply' if editing else 'in an open question'}. "
            "Anything you add follows the reader brief.\n\n" + current
        )
    if instruction:
        parts.append(f"\n===== Do this =====\n{instruction}")
    return "\n".join(parts)


def clean_markdown(text: str) -> str:
    text = text.strip()
    fence = re.match(r"^```(?:markdown|md)?\s*\n(.*)\n```\s*$", text, re.S)
    return (fence.group(1) if fence else text).strip() + "\n"


def title_from(markdown: str, fallback: str) -> str:
    m = re.search(r"^#\s+[^:\n]+:\s*(.+)$", markdown, re.M)
    return (m.group(1).strip() if m else fallback)[:120]


async def generate_file(mission: Mission, role: Role, upstream: dict[Role, str], context: str,
                        current: str | None = None, instruction: str | None = None, apps: dict[str, str] | None = None,
                        evidence: list | None = None) -> str:
    """NoX's drafter agent writes the file; it may look facts up in the mission's applications first."""
    from ..ai.agents import cowriter

    return await cowriter.draft(mission, role, upstream=upstream, context=context, apps=apps or {},
                                current=current, instruction=instruction, evidence=evidence)


async def draft_mission_files(mission_id: str) -> None:
    """Write every file marked `drafting`, in role order, each one seeing the files above it."""
    async with AsyncSessionLocal() as db:
        mission = (
            await db.execute(select(Mission).options(selectinload(Mission.files), selectinload(Mission.links)).where(Mission.id == uuid.UUID(mission_id)))
        ).scalars().first()
        if not mission:
            return
        kb_ids = (await db.execute(select(MissionApp.kb_id).where(MissionApp.mission_id == mission.id))).scalars().all()
        context = jira_context(mission) + await kb_context(db, list(kb_ids), mission.prompt)
        apps = await mission_apps(db, list(kb_ids))
        from .media import mission_evidence

        evidence = await mission_evidence(db, mission.id)  # what the author showed NoX, loaded once for every file
        files = {f.role: f for f in mission.files}
        upstream: dict[Role, str] = {}
        for role in ROLE_ORDER:
            f = files.get(role)
            if not f:
                continue
            if f.status == SpecStatus.drafting:
                await record(db, mission, "file.drafting", {"role": role.value})
                try:
                    md = await generate_file(mission, role, upstream, context, apps=apps, evidence=evidence)
                except Exception as e:
                    logger.exception(f"drafting {mission.key}/{role.value} failed")
                    f.status = SpecStatus.empty if role != mission.created_as_role else SpecStatus.draft
                    await record(db, mission, "file.draft_failed", {"role": role.value, "error": str(e)[:200]})
                    continue
                f.markdown = md
                f.version += 1
                f.status = SpecStatus.draft if role == mission.created_as_role else SpecStatus.ai_drafted
                f.updated_at = datetime.utcnow()
                db.add(SpecFileVersion(spec_file_id=f.id, version=f.version, markdown=md, source="nox"))
                if role == Role.business and mission.title == mission.prompt[:120]:
                    mission.title = title_from(md, mission.title)
                await db.commit()
                await record(db, mission, "file.drafted", {"role": role.value, "version": f.version})
                from .gitsync import schedule_sync

                schedule_sync(mission.id, role, f"{mission.key}: NoX drafts the {TITLE[role].lower()}")
            if f.markdown:
                upstream[role] = f.markdown
        await record(db, mission, "drafts.ready", {"awaitingProceed": mission.awaiting_proceed})
