"""Ask: questions about an application, answered by an agent that looks things up instead of guessing.

The agent searches the knowledge base, reads the pages it needs, checks the contract map for other
applications, and drops to the source snapshot only for exact code details. Answers stream token by token;
each lookup shows up in the UI as a step ("Searching orders for 'refund'…"), and every page the agent read
becomes a citation.

Every question goes through NoX Shield first (services/shield.py): a flagged question gets a polite refusal and
no model call. The same `answer()` serves the app, the CLI chat, MCP's `ask_nox` and (as `build_peer`) A2A;
agents calling from outside run without `get_jira_issue`, which reads Jira with NoX's own credentials.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

from google.adk.agents import LlmAgent

from .. import config, runtime, telemetry
from ..tools.knowledge import KNOWLEDGE_TOOLS, get_jira_issue

PEER_TOOLS = [t for t in KNOWLEDGE_TOOLS if t is not get_jira_issue]  # for MCP and A2A callers
REFUSAL = ("NoX Shield flagged this message as a possible prompt injection or unsafe request, so NoX didn't send it "
           "to the model. Rephrase the question and ask again.")

INSTRUCTION = """You are NoX, answering questions about the software application "{home_app}" for someone in the
{role} seat. Other applications in the organisation you can look at: {other_apps}.

How to answer:
- Look things up before answering. Start with search_kb; read_kb_page when you need a whole page; find_interfaces
  for "who exposes / who uses" questions across applications; grep_source and read_source_file only for exact code
  details the knowledge base doesn't have.
- Be quick. Independent lookups go out together in one step (e.g. read the three most relevant pages at once, or
  run two searches at once). Most questions need 2–4 lookups; never more than 8. Stop as soon as you can answer.
- Answer only from what the tools returned. If the knowledge base and code don't say, say so plainly and suggest
  where the answer might live. Never invent endpoints, names, files or numbers.
- Cite as you go: [[kb:<ref>]] after a statement taken from a knowledge-base page (use the ref exactly as returned),
  and `path:line` for source code. One citation per brackets: write [[kb:a]] [[kb:b]], never [[kb:a], [kb:b]].
- Write for the {role} seat: {role_voice}
- Be concise: lead with the answer, then the supporting detail. Markdown, short paragraphs or bullets.
"""

ROLE_VOICE = {
    "business": "plain language about what the system does for customers and the business; no code unless asked.",
    "product": "behaviour, user-visible rules, edge cases and constraints; code only when it settles a question.",
    "engineering": "components, interfaces, data flow, trade-offs and risks; code references welcome.",
    "developer": "exact files, functions, endpoints and data shapes; code references expected.",
}


def build(home_app: str, role: str, other_apps: list[str], tools: list | None = None) -> LlmAgent:
    return LlmAgent(
        name="nox_ask",
        model=config.model(config.Tier.DEFAULT),
        instruction=INSTRUCTION.format(
            home_app=home_app, role=role, other_apps=", ".join(other_apps) or "none",
            role_voice=ROLE_VOICE.get(role, ROLE_VOICE["engineering"]),
        ),
        tools=KNOWLEDGE_TOOLS if tools is None else tools,
    )


def peer_instruction(ctx) -> str:
    """The same instruction, filled from session state at run time (A2A has one agent for every caller)."""
    apps = sorted((ctx.state.get("apps") or {}).keys())
    home = ctx.state.get("home_app") or "any of the applications listed"
    role = ctx.state.get("role") or "engineering"
    return INSTRUCTION.format(home_app=home, role=role, other_apps=", ".join(a for a in apps if a != home) or "none",
                              role_voice=ROLE_VOICE.get(role, ROLE_VOICE["engineering"]))


def step_label(tool: str, args: dict, home_app: str) -> str:
    app = args.get("app") or home_app
    q = str(args.get("query") or args.get("pattern") or args.get("identifier") or "")[:60]
    match tool:
        case "search_kb":
            return f"Searching {'every application' if args.get('everywhere') else app} for “{q}”"
        case "read_kb_page":
            return f"Reading {str(args.get('ref', '')).removeprefix('kb:')}"
        case "list_pages":
            return f"Listing {app}'s pages"
        case "find_interfaces":
            return f"Checking the contract map for “{q}”" if q else f"Listing {app}'s interfaces"
        case "grep_source":
            return f"Searching {app}'s code for “{q}”"
        case "read_source_file":
            return f"Reading {args.get('path', 'a source file')}"
        case "get_jira_issue":
            return f"Opening {args.get('key', 'the Jira issue')}"
    return tool.replace("_", " ")


_CITE = re.compile(r"\[\[?kb:([^\]|,\[]+)")  # also catches grouped [[kb:a], [kb:b]]


async def answer(question: str, *, home_app: str, apps: dict[str, str], role: str, user_id: str,
                 session_id: str, where: str = "ask", org_id=None, kb_id=None, tools: list | None = None) -> AsyncIterator[dict]:
    """Stream UI events: step, delta, citations, usage, done."""
    from ...services import shield

    verdict = await shield.screen_prompt(question, where=where, org_id=org_id, kb_id=kb_id)
    if verdict.blocked:
        yield {"type": "delta", "text": REFUSAL}
        yield {"type": "citations", "refs": []}
        yield {"type": "shield", "blocked": True, "categories": sorted({f.category for f in verdict.findings})}
        yield {"type": "done", "text": REFUSAL}
        return
    agent = build(home_app, role, [a for a in apps if a != home_app], tools=tools)
    state = {"apps": apps, "home_app": home_app}
    read: list[str] = []
    text = ""
    with telemetry.usage_scope("ask", org_id=org_id, kb_id=kb_id) as usage:
        async for ev in runtime.stream(agent, question, state=state, user_id=user_id, session_id=session_id):
            if ev["type"] == "step":
                yield {"type": "step", "tool": ev["tool"], "label": step_label(ev["tool"], ev["args"], home_app)}
            elif ev["type"] == "tool_result":
                res = ev["result"] or {}
                if ev["tool"] == "read_kb_page" and res.get("ref"):
                    read.append(res["ref"])
            elif ev["type"] == "delta":
                text += ev["text"]
                yield ev
            elif ev["type"] == "done":
                text = ev["text"] or text
        cited = list(dict.fromkeys([m.group(1).strip() for m in _CITE.finditer(text)] + read))
        known = {f"{a}/" for a in apps}
        refs = [r for r in cited if any(r.startswith(k) for k in known)]
        usage.tags["citations"] = str(len(refs))  # the flight recorder's grounding numbers
    yield {"type": "citations", "refs": refs}
    yield {"type": "usage", "line": usage.line(), **usage.summary()}
    yield {"type": "done", "text": text}
