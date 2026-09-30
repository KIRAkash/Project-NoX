"""NoX co-writing an open spec file: refine after a save, and edit on request from the corner chat.

NoX is an agent here (ai/agents/cowriter.py): it looks facts up, then edits the file section by section.
Each edit appears in the editor as it lands (`nox.edit.partial`); when the turn ends the result is saved
as one new version (source "nox") and broadcast as a line diff (`nox.edit`), so one undo reverts the turn.
NoX never overwrites silently, and never drops a section the author wrote.

A chat message or refine instruction NoX Shield flags is kept in the chat, but NoX replies that it can't act on
it and makes no model call (`shield.refused` on the timeline).
"""

import difflib
import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..ai import telemetry
from ..db.database import AsyncSessionLocal
from ..db.models import Mission, MissionApp, Role, SpecChatMessage, SpecFile, SpecFileVersion, SpecStatus, User
from ..services import shield
from .context import jira_context, kb_context, mission_apps
from .drafting import clean_markdown
from .events import record
from .gitsync import schedule_sync
from .templates import ROLE_ORDER, TITLE, upstream_of

logger = logging.getLogger(__name__)
_busy: set[tuple[str, str]] = set()  # (mission id, role) NoX is currently editing

REFINE = (
    "Refine this file for its reader. Keep everything the author wrote unless it is factually wrong for this codebase; "
    "improve wording, fill the gaps this reader would notice (what they look for, per the reader brief), and add "
    "concrete detail from the knowledge base in the reader's own vocabulary. Anything only the author can decide, ask "
    "them with ask_author instead of writing it into the file. Keep the required sections and the verification checklist."
)


CANT_ACT = "I can't act on that message: NoX Shield flagged it as a possible prompt injection. Rephrase it and I'll help."


async def _refused(db, mission: Mission, role: Role, verdict, where: str) -> None:
    db.add(SpecChatMessage(spec_file_id=(await _file(db, mission.id, role)).id, author="nox", body=CANT_ACT))
    await db.commit()
    await record(db, mission, "shield.refused", {"role": role.value, "where": where,
                                                 "categories": sorted({f.category for f in verdict.findings})})
    await record(db, mission, "chat.message", {"role": role.value, "author": "nox", "body": CANT_ACT})


async def _file(db, mission_id, role: Role) -> SpecFile:
    return (await db.execute(select(SpecFile).where(SpecFile.mission_id == mission_id, SpecFile.role == role))).scalars().one()


def format_questions(questions: list[dict]) -> str:
    """NoX's questions for the author, as they read in the chat under its reply."""
    if not questions:
        return ""
    lines = [f"{i}. {q['question']}" + (f" (Suggestion: {q['suggestion']})" if q.get("suggestion") else "")
             for i, q in enumerate(questions, 1)]
    return "Your call on these before I write them in:\n" + "\n".join(lines)


def _with_questions(reply: str, questions: list[dict]) -> str:
    return "\n\n".join(part for part in (reply.strip(), format_questions(questions)) if part)


def _headings(md: str) -> set[str]:
    return {re.sub(r"[^a-z0-9]+", " ", line.lstrip("#").lower()).strip() for line in md.splitlines() if re.match(r"^#{2,6}\s", line)}  # H1 is the title: NoX may retitle


def lost_headings(old: str, new: str) -> set[str]:
    """Headings the author had that NoX's version no longer has (an answered-out 'Open questions' may go)."""
    return _headings(old) - _headings(new) - {"open questions"}


def line_ops(old: str, new: str) -> list[dict]:
    """Line-level edit script from `old` to `new` (indices refer to `old`)."""
    a, b = old.splitlines(), new.splitlines()
    ops = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag != "equal":
            ops.append({"op": tag, "from": i1, "to": i2, "lines": b[j1:j2]})
    return ops


async def _load(db, mission_id: str, role: Role, attached: list[str] | None = None) -> tuple[Mission, SpecFile, dict[Role, str], str, dict[str, str], list]:
    mission = (
        await db.execute(select(Mission).options(selectinload(Mission.files), selectinload(Mission.links)).where(Mission.id == uuid.UUID(mission_id)))
    ).scalars().first()
    f = next(x for x in mission.files if x.role == role)
    upstream = {x.role: x.markdown for x in sorted(mission.files, key=lambda x: ROLE_ORDER.index(x.role)) if x.role in upstream_of(role) and x.markdown}
    kb_ids = (await db.execute(select(MissionApp.kb_id).where(MissionApp.mission_id == mission.id))).scalars().all()
    # A starting point only: the agent looks up anything else it needs, so the context can stay small.
    context = jira_context(mission) + await kb_context(db, list(kb_ids), f"{mission.prompt}\n{f.markdown[:2000]}", budget=10000)
    from .media import mission_evidence

    evidence = await mission_evidence(db, mission.id, attached)  # captures, as text: the video isn't re-sent each turn
    return mission, f, upstream, context, await mission_apps(db, list(kb_ids)), evidence


async def _apply(db, mission: Mission, f: SpecFile, new_md: str, reason: str, extra: dict | None = None) -> bool:
    new_md = clean_markdown(new_md)
    lost = lost_headings(f.markdown or "", new_md)
    if lost:  # NoX must never drop the author's sections
        logger.warning(f"{mission.key}/{f.role.value}: NoX's {reason} dropped sections {lost}; discarded")
        await record(db, mission, "nox.done", {"role": f.role.value, "changed": False, "reason": reason,
                                               "discarded": sorted(lost)})
        return False
    if new_md.strip() == (f.markdown or "").strip():
        await record(db, mission, "nox.done", {"role": f.role.value, "changed": False, "reason": reason})
        return False
    old_md, old_version = f.markdown or "", f.version
    f.markdown = new_md
    f.version += 1
    if f.status in (SpecStatus.approved, SpecStatus.stale, SpecStatus.empty):
        f.status = SpecStatus.draft
    db.add(SpecFileVersion(spec_file_id=f.id, version=f.version, markdown=new_md, source="nox"))
    await db.commit()
    await record(db, mission, "nox.edit", {
        "role": f.role.value, "fromVersion": old_version, "toVersion": f.version, "reason": reason,
        "ops": line_ops(old_md, new_md), "markdown": new_md, **(extra or {}),
    })
    schedule_sync(mission.id, f.role, f"{mission.key}: NoX refines the {TITLE[f.role].lower()}")
    return True


async def refine_file(mission_id: str, role: Role, instruction: str | None = None) -> None:
    from ..ai.agents import cowriter

    key = (mission_id, role.value)
    if key in _busy:
        return
    _busy.add(key)
    try:
        async with AsyncSessionLocal() as db:
            mission, f, upstream, context, apps, evidence = await _load(db, mission_id, role)
            if instruction:
                verdict = await shield.screen_prompt(instruction, where="cowrite", org_id=mission.org_id, mission_id=mission.id)
                if verdict.blocked:
                    await _refused(db, mission, role, verdict, "refine")
                    return
            await record(db, mission, "nox.thinking", {"role": role.value, "reason": "refine"})
            try:
                with telemetry.tags(org_id=mission.org_id, mission_id=mission.id):
                    turn = await cowriter.edit_turn(mission, role, current=f.markdown or "", base_version=f.version, upstream=upstream,
                                                    context=context, apps=apps, instruction=instruction or REFINE, evidence=evidence)
            except Exception as e:
                logger.exception("refine failed")
                await record(db, mission, "nox.error", {"role": role.value, "error": str(e)[:200]})
                return
            await _apply(db, mission, f, turn.draft, "refine", {"edits": turn.edits, "usage": turn.usage, "tokens": turn.tokens})
            if turn.questions:  # decisions NoX needs go to the chat, not the file
                body = _with_questions(turn.reply, turn.questions)
                db.add(SpecChatMessage(spec_file_id=f.id, author="nox", body=body))
                await db.commit()
                await record(db, mission, "chat.message", {"role": role.value, "author": "nox", "body": body, "questions": len(turn.questions)})
    finally:
        _busy.discard(key)


async def chat(mission_id: str, role: Role, message: str, user_id: uuid.UUID | None, media_ids: list[str] | None = None) -> None:
    from ..ai.agents import cowriter

    key = (mission_id, role.value)
    if media_ids:  # the turn starts once NoX has watched what was attached
        from .events import broadcast_transient
        from .media import wait_ready

        await broadcast_transient(mission_id, "nox.thinking", {"role": role.value, "reason": "chat"})
        await broadcast_transient(mission_id, "nox.step", {"role": role.value, "label": "NoX is watching your recording"})
        await wait_ready(media_ids)
    async with AsyncSessionLocal() as db:
        mission, f, upstream, context, apps, evidence = await _load(db, mission_id, role, media_ids)
        verdict = await shield.screen_prompt(message, where="cowrite", org_id=mission.org_id, mission_id=mission.id)
        if verdict.blocked:
            await _refused(db, mission, role, verdict, "chat")
            return
        history = (
            await db.execute(select(SpecChatMessage).where(SpecChatMessage.spec_file_id == f.id).order_by(SpecChatMessage.created_at.desc()).limit(6))
        ).scalars().all()
        convo = "\n".join(f"{m.author}: {m.body}" for m in reversed(history))
        await record(db, mission, "nox.thinking", {"role": role.value, "reason": "chat"})
        busy = key in _busy  # a refine is already editing this file: NoX answers but doesn't edit
        _busy.add(key)
        try:
            with telemetry.tags(org_id=mission.org_id, mission_id=mission.id):
                turn = await cowriter.edit_turn(
                    mission, role, current=f.markdown or "", base_version=f.version, upstream=upstream, context=context, apps=apps,
                    instruction=f"Recent chat:\n{convo}\n\nThe author now says: {message}", can_edit=not busy, stream_reply=True,
                    evidence=evidence,
                )
            reply = turn.reply or ("Done." if turn.edits or turn.questions else "I couldn't find anything to change.")
            reply = _with_questions(reply, turn.questions)
            changed = False
            if turn.draft.strip() != (f.markdown or "").strip() and not busy:
                lost = lost_headings(f.markdown or "", clean_markdown(turn.draft))
                changed = await _apply(db, mission, f, turn.draft, "chat", {"edits": turn.edits, "usage": turn.usage, "tokens": turn.tokens})
                if lost:  # the reply describes edits that weren't kept: say so rather than claim them
                    reply += f"\n\n(I couldn't save that: it would have removed {', '.join(sorted(lost))}. The file is unchanged.)"
            db.add(SpecChatMessage(spec_file_id=f.id, author="nox", body=reply))
            await db.commit()
            await record(db, mission, "chat.message", {"role": role.value, "author": "nox", "body": reply, "edited": changed,
                                                       "questions": len(turn.questions)})
        except Exception as e:
            logger.exception("chat failed")
            db.add(SpecChatMessage(spec_file_id=f.id, author="nox", body="Sorry — I couldn't reach the model just now. Try again in a moment."))
            await db.commit()
            await record(db, mission, "chat.message", {"role": role.value, "author": "nox", "error": str(e)[:200]})
        finally:
            if not busy:
                _busy.discard(key)


async def revert(db, mission: Mission, f: SpecFile, to_version: int, actor: User) -> bool:
    """Undo NoX: restore an earlier version as a new human version."""
    v = (await db.execute(select(SpecFileVersion).where(SpecFileVersion.spec_file_id == f.id, SpecFileVersion.version == to_version))).scalars().first()
    if not v:
        return False
    f.markdown = v.markdown
    f.version += 1
    db.add(SpecFileVersion(spec_file_id=f.id, version=f.version, markdown=v.markdown, source="human", saved_by=actor.id))
    await db.commit()
    await record(db, mission, "file.reverted", {"role": f.role.value, "toVersion": to_version, "version": f.version}, actor, f.role.value)
    schedule_sync(mission.id, f.role, f"{mission.key}: undo NoX's edit to the {TITLE[f.role].lower()}")
    return True
