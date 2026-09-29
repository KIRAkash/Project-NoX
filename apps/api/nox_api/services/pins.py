"""Human corrections pinned to KB pages.

Pins live in the database, not only in the page, so a recompilation can't lose them: every
pipeline re-applies them to the files it is about to commit. The rendered block is fenced by
HTML comments and replaced wholesale, so applying twice is a no-op.
"""

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.models import KBPin

START, END = "<!-- nox:pins -->", "<!-- /nox:pins -->"
_BLOCK = re.compile(re.escape(START) + r".*?" + re.escape(END) + r"\n?", re.S)


def render_pins(content: str, pins: list[KBPin]) -> str:
    body = _BLOCK.sub("", content or "").rstrip()
    if not pins:
        return body + "\n"
    lines = [START, "", "## Human corrections", ""]
    for p in pins:
        who = p.author_name or "a teammate"
        when = p.created_at.strftime("%Y-%m-%d") if p.created_at else ""
        lines.append(f"> **Pinned by {who}{', ' + when if when else ''}:** {p.text}")
        lines.append("")
    lines.append(END)
    return body + "\n\n" + "\n".join(lines) + "\n"


async def pins_by_page(db: AsyncSession, kb_id: str | uuid.UUID) -> dict[str, list[KBPin]]:
    rows = (await db.execute(select(KBPin).where(KBPin.kb_id == uuid.UUID(str(kb_id))).order_by(KBPin.created_at))).scalars().all()
    out: dict[str, list[KBPin]] = {}
    for p in rows:
        out.setdefault(p.page_path, []).append(p)
    return out


async def apply_pins(db: AsyncSession, kb_id: str | uuid.UUID, files: dict[str, str]) -> dict[str, str]:
    """Re-apply every pin whose page is among `files` (in place) and return `files`."""
    for path, pins in (await pins_by_page(db, kb_id)).items():
        if path in files:
            files[path] = render_pins(files[path], pins)
    return files
