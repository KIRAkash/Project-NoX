"""Verification: an advisory look at the evidence attached to each checklist item.

One structured call over text only: the item, and what each piece of evidence says (a link's label and address,
a capture's analysis, a metric, a note). NoX can't open a link, and says so instead of guessing. The answer is a
hint beside the item ("supports", "unclear", "contradicts"); it never sets a verdict and never blocks anyone.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..ai import config, structured, telemetry
from ..ai.schemas import EvidenceCheck
from ..db.database import AsyncSessionLocal
from ..db.models import MediaAsset, Mission, Role, User
from .events import broadcast_transient, record
from .media import describe
from .verification import norm_item, parse_checklist

logger = logging.getLogger(__name__)

INSTRUCTION = """You look at the evidence a person attached to items on a verification checklist, and say for each item whether
the evidence backs it up. `supports`: the evidence plainly shows the item is true. `contradicts`: it plainly shows
it isn't. `unclear`: it says nothing clear about this item, or it is only a link you cannot open (say so). Judge only
what is written in the evidence. Never assume a link's page says what its label claims. You never decide whether an
item is met: a person does."""


def _describe_evidence(e: dict, captures: dict[str, MediaAsset]) -> str:
    match e["type"]:
        case "link":
            return f"link '{e['label']}' ({e['url']}), contents not readable"
        case "metric":
            return f"metric {e['name']} = {e['value']}"
        case "note":
            return f"note: {e['text']}"
        case "capture":
            m = captures.get(e["mediaId"])
            if not m:
                return "a capture that is not available"
            summary = (m.observation or {}).get("summary") or "no analysis"
            return f"{describe(m)}: {summary}"
    return "unknown evidence"


async def check_evidence(mission_id: str, role: Role, actor_id: uuid.UUID | None) -> None:
    async with AsyncSessionLocal() as db:
        mission = (await db.execute(select(Mission).options(selectinload(Mission.files)).where(Mission.id == uuid.UUID(mission_id)))).scalars().first()
        if not mission:
            return
        f = next(x for x in mission.files if x.role == role)
        items = [norm_item(i) for i in ((f.verification or {}).get("items") or parse_checklist(f.markdown))]
        with_evidence = [(i, it) for i, it in enumerate(items) if it["evidence"]]
        actor = await db.get(User, actor_id) if actor_id else None
        if not with_evidence:
            return
        ids = [uuid.UUID(e["mediaId"]) for _, it in with_evidence for e in it["evidence"] if e["type"] == "capture"]
        captures = {str(m.id): m for m in (await db.execute(select(MediaAsset).where(MediaAsset.id.in_(ids), MediaAsset.mission_id == mission.id))).scalars().all()} if ids else {}
        blocks = [f"{i}. {it['text']}\n" + "\n".join(f"   - {_describe_evidence(e, captures)}" for e in it["evidence"]) for i, it in with_evidence]
        await broadcast_transient(mission.id, "evidence.checking", {"role": role.value})
        with telemetry.usage_scope("verify:evidence-check") as usage:
            try:
                result = await structured.ask(EvidenceCheck, f"Mission {mission.key}: {mission.prompt}\n\nItems and their evidence:\n" + "\n".join(blocks),
                                              name="nox_evidence_check", instruction=INSTRUCTION, tier=config.Tier.FAST)
            except Exception as e:
                logger.exception("evidence check failed")
                await record(db, mission, "evidence.check_failed", {"role": role.value, "error": str(e)[:200]}, actor, role.value)
                return
        valid = {i for i, _ in with_evidence}
        checks = [c.model_dump() for c in result.items if c.index in valid]
        await db.refresh(f)
        f.verification = {**(f.verification or {}), "checks": checks}
        await db.commit()
        await record(db, mission, "evidence.checked", {"role": role.value, "items": len(checks), "usage": usage.line()}, actor, role.value)
