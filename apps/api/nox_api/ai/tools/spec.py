"""Tools NoX edits a spec file with: section by section, never a blind rewrite of the author's file.

The draft lives in session state (`state["draft"]`) for the length of one turn. Each tool call edits one
section, is checked against the rules below, and is broadcast at once as `nox.edit.partial`, so the editor
animates NoX's cursor section by section while the agent is still working. When the turn ends, the draft is
saved as a single new version (one undo reverts the whole turn).

Rules the tools enforce, so the model can't break them:
  - a section heading the author wrote is never removed or renamed (only its body can change), and neither is a
    '###' subheading inside it: a rewrite that drops one is refused with the headings to keep, so NoX can redo it
    in the same turn rather than the whole turn being discarded when it's saved
  - the file keeps its '## Verification checklist' last
  - whole-file writes are only allowed while the file is empty (first drafts)
  - the file holds decisions only: what NoX needs the author to decide goes to the chat (`ask_author`), never
    into the file, and an 'Open questions' section emptied because its questions were answered is removed
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from google.adk.tools import ToolContext

from ...missions.templates import VERIFY_HEADING

VERIFY = VERIFY_HEADING.removeprefix("## ")
OPEN_QUESTIONS = "Open questions"


# ── Markdown sections (pure) ────────────────────────────────────────────────

@dataclass
class Section:
    heading: str        # text after '## '
    body: str           # raw text after the heading line, up to the next '## ' (untouched sections round-trip exactly)
    line: str = ""      # the raw heading line


def norm(heading: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", heading.lower()).strip()


_H2 = re.compile(r"^##\s+(.*?)\s*#*\s*$")


def split(md: str) -> tuple[str | None, list[Section]]:
    """(preamble before the first '## ' or None, sections). '###' and deeper stay inside their section.

    Lossless: join(*split(md)) == md, so sections NoX doesn't edit keep their exact formatting.
    """
    preamble: list[str] | None = None
    sections: list[Section] = []
    buf: list[str] = []
    cur: tuple[str, str] | None = None
    for line in md.split("\n"):
        m = _H2.match(line)
        if m:
            if cur is None:
                preamble = buf
            else:
                sections.append(Section(cur[0], "\n".join(buf), cur[1]))
            cur, buf = (m.group(1).strip(), line), []
        else:
            buf.append(line)
    if cur is None:
        return "\n".join(buf), []
    sections.append(Section(cur[0], "\n".join(buf), cur[1]))
    return ("\n".join(preamble) if preamble else None), sections


def join(preamble: str | None, sections: list[Section]) -> str:
    chunks = [preamble] if preamble is not None else []
    chunks += [f"{s.line or '## ' + s.heading}\n{s.body}" for s in sections]
    return "\n".join(chunks)


def _fresh(content: str) -> str:
    """Body text for a section NoX wrote: a blank line after the heading and before the next one."""
    return f"\n{content.strip(chr(10))}\n"


def find(sections: list[Section], heading: str) -> int | None:
    want = norm(heading.removeprefix("## "))
    for i, s in enumerate(sections):
        if norm(s.heading) == want:
            return i
    return None


def _clean_body(markdown: str, heading: str) -> str:
    """Models sometimes repeat the heading at the top of a section body; drop it."""
    lines = markdown.strip("\n").splitlines()
    if lines and re.match(r"^#{1,3}\s+", lines[0]) and norm(lines[0].lstrip("#")) == norm(heading):
        lines = lines[1:]
    return "\n".join(lines).strip("\n")


class EditError(ValueError):
    pass


def _subheadings(body: str) -> list[str]:
    return [line.lstrip("#").strip() for line in body.splitlines() if re.match(r"^#{3,6}\s", line)]


def replace_body(md: str, heading: str, body: str) -> str:
    pre, secs = split(md)
    i = find(secs, heading)
    if i is None:
        raise EditError(f"No section '{heading}'. Sections: {', '.join(s.heading for s in secs)}")
    body = _clean_body(body, secs[i].heading)
    if re.search(r"^##\s", body, re.M):
        raise EditError("The new body contains a '## ' heading; edit one section at a time (use insert_section for new ones).")
    if not body.strip() and norm(secs[i].heading) == norm(OPEN_QUESTIONS):
        del secs[i]  # every question answered: the section goes rather than sitting empty
        return join(pre, secs)
    kept = {norm(h) for h in _subheadings(body)}
    if dropped := [h for h in _subheadings(secs[i].body) if norm(h) not in kept]:
        raise EditError(f"Keep these subheadings, worded as they are (you can change what's under them): {'; '.join(dropped)}")
    secs[i].body = _fresh(body)
    return join(pre, secs)


def insert(md: str, heading: str, body: str, after: str = "") -> str:
    pre, secs = split(md)
    heading = heading.removeprefix("## ").strip()
    if not heading:
        raise EditError("A section needs a heading.")
    if find(secs, heading) is not None:
        raise EditError(f"Section '{heading}' already exists; use replace_section or append_to_section.")
    body = _clean_body(body, heading)
    if re.search(r"^##\s", body, re.M):
        raise EditError("The body contains a '## ' heading; insert one section at a time.")
    new = Section(heading, _fresh(body))
    if after:
        i = find(secs, after)
        if i is None:
            raise EditError(f"No section '{after}' to insert after.")
        at = i + 1
    else:
        v = find(secs, VERIFY)
        at = v if v is not None else len(secs)
    if (v := find(secs, VERIFY)) is not None and at > v:
        at = v  # the verification checklist stays last
    secs.insert(at, new)
    return join(pre, secs)


def append(md: str, heading: str, text: str) -> str:
    pre, secs = split(md)
    i = find(secs, heading)
    if i is None:
        raise EditError(f"No section '{heading}'. Sections: {', '.join(s.heading for s in secs)}")
    secs[i].body = _fresh(secs[i].body.strip("\n") + "\n" + text.strip("\n"))
    return join(pre, secs)


# ── Tools ───────────────────────────────────────────────────────────────────

async def _commit(ctx: ToolContext, new_md: str, what: str) -> dict:
    """Accept an edit: keep it in the draft and show it in the editor right away."""
    from ...missions.cowrite import line_ops
    from ...missions.events import broadcast_transient

    old = ctx.state.get("draft") or ""
    if new_md == old:
        return {"ok": True, "note": "No change."}
    step = int(ctx.state.get("edit_step") or 0) + 1
    ctx.state["draft"] = new_md
    ctx.state["edit_step"] = step
    edits = list(ctx.state.get("edits") or [])
    edits.append(what)
    ctx.state["edits"] = edits
    if ctx.state.get("mission_id"):
        await broadcast_transient(ctx.state["mission_id"], "nox.edit.partial", {
            "role": ctx.state.get("role"), "step": step, "fromVersion": ctx.state.get("base_version"),
            "ops": line_ops(old, new_md), "markdown": new_md, "what": what,
        })
    return {"ok": True, "edited": what}


def _guard(ctx: ToolContext) -> dict | None:
    if not ctx.state.get("can_edit", True):
        return {"error": "NoX is already editing this file; answer without editing this time."}
    return None


async def read_spec_file(role: str, tool_context: ToolContext) -> dict:
    """Read another role's spec file in this mission (the files above this one), or this file's current draft.

    Args:
      role: 'business', 'product', 'engineering', 'developer', or 'this' for the file being edited.
    """
    if role in ("this", tool_context.state.get("role")):
        return {"role": tool_context.state.get("role"), "markdown": tool_context.state.get("draft") or "(empty)"}
    files = tool_context.state.get("files") or {}
    if role not in files:
        return {"error": f"No readable '{role}' file. Readable: {', '.join(files) or 'none'}"}
    return {"role": role, "markdown": files[role] or "(empty)"}


async def replace_section(heading: str, markdown: str, tool_context: ToolContext) -> dict:
    """Rewrite the body of one '## ' section. The heading itself stays exactly as it is.

    Args:
      heading: The section heading as it appears in the file, without '## '.
      markdown: The complete new body of that section (no '## ' headings inside; '###' is fine).
    """
    if err := _guard(tool_context):
        return err
    try:
        return await _commit(tool_context, replace_body(tool_context.state.get("draft") or "", heading, markdown), f"rewrote “{heading}”")
    except EditError as e:
        return {"error": str(e)}


async def insert_section(heading: str, markdown: str, tool_context: ToolContext, after: str = "") -> dict:
    """Add a new '## ' section. It goes after `after` if given, otherwise just before the verification checklist.

    Args:
      heading: The new section's heading, without '## '.
      markdown: The section body.
      after: Heading of the section to insert after (optional).
    """
    if err := _guard(tool_context):
        return err
    try:
        return await _commit(tool_context, insert(tool_context.state.get("draft") or "", heading, markdown, after), f"added “{heading}”")
    except EditError as e:
        return {"error": str(e)}


async def append_to_section(heading: str, markdown: str, tool_context: ToolContext) -> dict:
    """Add lines at the end of a section (e.g. one more bullet, task, risk or checklist item) without touching the rest.

    Args:
      heading: The section heading, without '## '.
      markdown: The lines to add.
    """
    if err := _guard(tool_context):
        return err
    try:
        return await _commit(tool_context, append(tool_context.state.get("draft") or "", heading, markdown), f"extended “{heading}”")
    except EditError as e:
        return {"error": str(e)}


async def ask_author(question: str, tool_context: ToolContext, suggestion: str = "") -> dict:
    """Ask the author to decide something only they can settle. The question goes to the chat, not into the file.

    Args:
      question: The decision needed, one sentence.
      suggestion: The answer you'd recommend, with a short reason (optional).
    """
    questions = list(tool_context.state.get("questions") or [])
    questions.append({"question": question.strip().removeprefix("- "), "suggestion": suggestion.strip()})
    tool_context.state["questions"] = questions
    return {"ok": True, "note": "The author sees this under your reply. Leave the point out of the file until they answer."}


async def write_file(markdown: str, tool_context: ToolContext) -> dict:
    """Write the whole file. Only allowed while the file is still empty (a first draft).

    Args:
      markdown: The complete Markdown file.
    """
    if err := _guard(tool_context):
        return err
    if (tool_context.state.get("draft") or "").strip():
        return {"error": "The file already has content: edit it section by section instead."}
    return await _commit(tool_context, markdown.strip() + "\n", "wrote the first draft")


EDIT_TOOLS = [read_spec_file, replace_section, insert_section, append_to_section, ask_author, write_file]
