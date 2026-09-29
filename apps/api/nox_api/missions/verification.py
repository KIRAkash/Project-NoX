"""Manual reverse verification: each seat ticks its own file's checklist, developer first, business last.

The checklist lives in the file itself, under "## Verification checklist":

    - [x] Accounts lock after five failed attempts
      - Note: checked on staging with a test account
    - [ ] Support can unlock from the admin page

Ticks and notes are written back into the Markdown, so the file in Git is the record.
"""

import re

from ..db.models import Role
from .templates import VERIFY_HEADING

VERIFY_ORDER: list[Role] = [Role.developer, Role.engineering, Role.product, Role.business]

_ITEM = re.compile(r"^[-*]\s+\[([ xX])\]\s+(.+?)\s*$")
_NOTE = re.compile(r"^\s{2,}[-*]\s+Note:\s*(.*?)\s*$")
_HEADING = re.compile(rf"^{re.escape(VERIFY_HEADING)}\s*$", re.M | re.I)


def _section(markdown: str) -> tuple[int, int] | None:
    """(start, end) character offsets of the checklist body, or None when the file has no checklist."""
    m = _HEADING.search(markdown)
    if not m:
        return None
    nxt = re.search(r"^#{1,2}\s", markdown[m.end():], re.M)
    return m.end(), (m.end() + nxt.start()) if nxt else len(markdown)


def parse_checklist(markdown: str) -> list[dict]:
    span = _section(markdown)
    if not span:
        return []
    items: list[dict] = []
    for line in markdown[span[0]:span[1]].splitlines():
        if item := _ITEM.match(line):
            items.append({"text": item.group(2), "checked": item.group(1) != " ", "note": None})
        elif (note := _NOTE.match(line)) and items:
            items[-1]["note"] = note.group(1) or None
    return items


def write_checklist(markdown: str, items: list[dict]) -> str:
    """Rewrite the checklist section with the given ticks and notes; everything else stays as it was."""
    span = _section(markdown)
    lines = []
    for it in items:
        lines.append(f"- [{'x' if it.get('checked') else ' '}] {it['text']}")
        if note := (it.get("note") or "").strip():
            lines.append(f"  - Note: {' '.join(note.splitlines())}")
    body = "\n" + "\n".join(lines) + "\n"
    if not span:
        return markdown.rstrip() + f"\n\n{VERIFY_HEADING}{body}"
    start, end = span
    rest = markdown[end:]
    return markdown[:start] + body + ("\n" + rest if rest else "")


def next_verifier(role: Role) -> Role | None:
    i = VERIFY_ORDER.index(role)
    return VERIFY_ORDER[i + 1] if i + 1 < len(VERIFY_ORDER) else None
