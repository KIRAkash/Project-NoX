"""NoX co-writing a spec file: an agent that looks things up and edits the file section by section.

Two jobs, one set of tools:
  - edit_turn  chat and refine. NoX edits through the section tools in ai/tools/spec.py; each edit shows up in
               the editor as it lands (`nox.edit.partial`), lookups show as steps (`nox.step`), and a chat reply
               streams into the chat panel (`chat.delta`). The caller saves the final draft as one version.
  - draft      first drafts. The agent may look things up, then returns the whole file as its answer.

The reader brief, file shape and grounding rules are the ones drafting has always used (missions/drafting.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from google.adk.agents import LlmAgent

from ...missions.drafting import SYSTEM, build_prompt, clean_markdown
from .. import config, runtime, telemetry
from ..tools.knowledge import find_interfaces, get_jira_issue, grep_source, read_kb_page, read_source_file, search_kb
from ..tools.spec import EDIT_TOOLS

LOOKUP_TOOLS = [search_kb, read_kb_page, find_interfaces, grep_source, read_source_file, get_jira_issue]

_OUTPUT_RULE = "- Output only the Markdown file. No preamble, no code fences around the whole file.\n"
_UNKNOWN_RULE = "If something is unknown, write it as an open question."

EDITOR_SYSTEM = SYSTEM.replace(_OUTPUT_RULE, "").replace(_UNKNOWN_RULE, "If something is unknown, leave it out and ask.") + """

You are working inside the author's open file, through tools:
- Change the file only with the edit tools, one section per call: replace_section to rework a section's body,
  append_to_section to add a bullet, task or risk, insert_section for a genuinely new section. Never touch sections
  you don't need to change. The author's headings can't be removed.
- The file holds what has been decided, nothing else. Never write open questions, TBDs, options, "(suggestion)"
  answers or "to be confirmed" into it. When something needs the author's decision, call ask_author with the
  question and the answer you'd suggest, and leave that point out of the file until they answer. Ask, rather than
  pick or write around it with vague wording, whenever the request leaves open a choice that changes what gets
  built or who is affected (which channel, what limit, who owns it, what happens on failure) and neither the
  knowledge base nor the upstream files settle it. Make the edits that don't depend on the answer now. This
  overrides any line in the reader brief that says to raise an open question.
- When the author's message settles something (a question you asked in the chat, or one listed in an existing
  'Open questions' section), write the decision into the section it belongs to, stated as decided, and take the
  answered question out of 'Open questions' with replace_section. An empty body removes that section.
- Check facts before you write them: search_kb and read_kb_page for the knowledge base, find_interfaces for contracts
  between applications, grep_source/read_source_file for exact code, read_spec_file for the files above this one.
  Independent lookups go out together in one step. Most turns need 1–4 lookups.
- If the author only asked a question, answer it and don't edit.
- Finish with a reply to the author: one or two short sentences, in their vocabulary, saying what you changed (or
  answering the question). No Markdown headings in the reply. Don't repeat your ask_author questions in it: they
  are shown under your reply.
"""

DRAFTER_SYSTEM = SYSTEM + """

Before writing, you may look facts up (search_kb, read_kb_page, find_interfaces, grep_source, read_source_file) when
the knowledge-base context below doesn't cover something the reader needs. Keep it to a few lookups, then answer with
the complete file.
"""

STEP_VERBS = {
    "read_spec_file": lambda a: f"Reading the {a.get('role', '')} file" if a.get("role") not in (None, "this") else "Re-reading this file",
    "replace_section": lambda a: f"Rewriting “{a.get('heading', '')}”",
    "insert_section": lambda a: f"Adding “{a.get('heading', '')}”",
    "append_to_section": lambda a: f"Extending “{a.get('heading', '')}”",
    "ask_author": lambda a: "Noting a question for you",
    "write_file": lambda a: "Writing the first draft",
}


def step_label(tool: str, args: dict, home_app: str) -> str:
    from .ask import step_label as lookup_label

    return STEP_VERBS[tool](args) if tool in STEP_VERBS else lookup_label(tool, args, home_app)


@dataclass
class TurnResult:
    draft: str
    reply: str = ""
    edits: list[str] = field(default_factory=list)
    questions: list[dict] = field(default_factory=list)  # decisions NoX needs from the author, for the chat
    usage: str = ""
    tokens: dict = field(default_factory=dict)


def _state(mission, role, current: str, upstream: dict, apps: dict[str, str], base_version: int, can_edit: bool) -> dict:
    return {
        "draft": current or "", "role": role.value, "base_version": base_version, "can_edit": can_edit,
        "mission_id": str(mission.id), "files": {r.value: md for r, md in upstream.items()},
        "apps": apps, "home_app": next(iter(apps), ""), "edit_step": 0, "edits": [], "questions": [],
    }


async def edit_turn(mission, role, *, current: str, base_version: int, upstream: dict, context: str, apps: dict[str, str],
                    instruction: str, can_edit: bool = True, stream_reply: bool = False) -> TurnResult:
    """One co-writing turn. Returns the draft after NoX's edits and NoX's reply; saving is the caller's job."""
    from ...missions.events import broadcast_transient

    agent = LlmAgent(name="nox_cowriter", model=config.model(config.Tier.DEFAULT), instruction=EDITOR_SYSTEM,
                     tools=[*LOOKUP_TOOLS, *EDIT_TOOLS])
    message = build_prompt(mission, role, upstream, context, current=current, instruction=instruction, editing=True)
    state = _state(mission, role, current, upstream, apps, base_version, can_edit)
    home = state["home_app"]
    result = TurnResult(draft=current or "")
    with telemetry.usage_scope(f"cowrite:{role.value}") as usage:
        async for ev in runtime.stream(agent, message, state=state, user_id=f"mission-{mission.id}", sessions=runtime.ephemeral_sessions()):
            if ev["type"] == "step":
                await broadcast_transient(mission.id, "nox.step", {"role": role.value, "label": step_label(ev["tool"], ev["args"], home)})
            elif ev["type"] == "delta" and stream_reply:
                await broadcast_transient(mission.id, "chat.delta", {"role": role.value, "text": ev["text"]})
            elif ev["type"] == "done":
                result.reply = ev["text"].strip()
                final = ev.get("state") or {}
                result.draft = final.get("draft", result.draft)
                result.edits = list(final.get("edits") or [])
                result.questions = list(final.get("questions") or [])
    result.usage = usage.line()
    result.tokens = usage.tokens()
    return result


async def draft(mission, role, *, upstream: dict, context: str, apps: dict[str, str],
                current: str | None = None, instruction: str | None = None) -> str:
    """A whole first draft (or a regenerated file), grounded by lookups when the context isn't enough."""
    agent = LlmAgent(name="nox_drafter", model=config.model(config.Tier.DEFAULT), instruction=DRAFTER_SYSTEM,
                     tools=LOOKUP_TOOLS if apps else [])
    message = build_prompt(mission, role, upstream, context, current=current, instruction=instruction)
    state = {"apps": apps, "home_app": next(iter(apps), "")}
    with telemetry.usage_scope(f"draft:{role.value}"):
        result = await runtime.run(agent, message, state=state, user_id=f"mission-{mission.id}")
    return clean_markdown(result.text)
