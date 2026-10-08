"""How each seat sees an opportunity: the lens NoX's sighting scouts look through (CP18).

A persona (`personas.py`) says how to write for a reader. A lens adds what that reader calls an improvement:
the kinds of opportunity worth their time, how impact is measured for them, whether code evidence may reach
them, and which lookup tools a scout working for them gets. Tools are chosen here, by NoX, never by the model
(principle 3): the business and product scouts can't read source code, so their sightings can't lean on it.

`lint_view` is the deterministic half of "write for the reader": a business or product view that mentions
endpoints, file paths or code identifiers is rewritten once, then dropped if it still does.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..db.models import Role
from .personas import PERSONAS, persona_brief

CODE_SEATS = {Role.engineering, Role.developer}


@dataclass(frozen=True)
class Lens:
    role: Role
    looks_for: str                     # one line for the scout's instruction
    kinds: dict[str, str]              # opportunity kind → what it means, in order of value
    impact_axes: str                   # how impact is described to this seat
    request_hint: str                  # how the one-click mission request is phrased for this seat
    tools: tuple[str, ...]             # names in ai/tools/knowledge.py

    @property
    def code_evidence(self) -> bool:
        return self.role in CODE_SEATS


_KB_TOOLS = ("search_kb", "read_kb_page", "list_pages", "get_jira_issue")
_CODE_TOOLS = (*_KB_TOOLS, "find_interfaces", "grep_source", "read_source_file")

LENSES: dict[Role, Lens] = {
    Role.business: Lens(
        role=Role.business,
        looks_for="changes the business would feel: money, customers, staff time, risk",
        kinds={
            "revenue": "Sales, conversion or renewals being lost or left on the table",
            "customer_experience": "A customer journey that is slow, confusing or makes people ask for help",
            "operating_cost": "Staff doing by hand what the product could do, or paying for something twice",
            "risk": "Compliance, fraud, outage or reputation exposure the business would care about",
            "customer_ask": "Something customers or staff keep asking for",
        },
        impact_axes="money, time, customer trust or risk, named the way the business names its customers and products",
        request_hint="A plain sentence the business user would type: what should be different for which people, and why it matters.",
        tools=_KB_TOOLS,
    ),
    Role.product: Lens(
        role=Role.product,
        looks_for="changes to what users experience: flows, states, consistency, measurability",
        kinds={
            "flow_friction": "A user flow with extra steps, dead ends or waiting",
            "missing_state": "Empty, error, loading, limit or permission states the product doesn't handle",
            "inconsistency": "The same thing behaving differently in different screens or applications",
            "unexposed_capability": "Something the system can already do that users can't reach",
            "unmeasured_outcome": "An outcome nobody can measure today",
        },
        impact_axes="which users, how often, and which product metric would move",
        request_hint="A product request: the user type, the behaviour that should change, and the outcome.",
        tools=(*_KB_TOOLS, "find_interfaces"),
    ),
    Role.engineering: Lens(
        role=Role.engineering,
        looks_for="changes to the system's shape: architecture, cost, reliability, security",
        kinds={
            "architecture": "Coupling, cycles, layering breaks or drift from the recorded decisions (ADRs)",
            "duplication": "The same capability or data built or held in more than one application",
            "cost": "Structural cost drivers: polling, chatty synchronous calls, duplicate stores, over-fetching",
            "reliability": "Single points of failure, missing timeouts or retries, unversioned contracts with many consumers",
            "security": "Weak spots in authentication, secrets, permissions or data handling",
        },
        impact_axes="blast radius, running cost, risk and effort (S, M, L)",
        request_hint="An engineering change: what to restructure across which applications, and the risk or cost it removes.",
        tools=_CODE_TOOLS,
    ),
    Role.developer: Lens(
        role=Role.developer,
        looks_for="changes inside the code: speed, health, tests, developer experience",
        kinds={
            "performance": "Slow paths: queries in loops, blocking calls in async code, unbounded reads, missing indexes or caching",
            "code_health": "Duplication, dead code, clusters of TODO or FIXME, tangled modules",
            "test_gap": "Risky code with no tests around it",
            "dependency": "Outdated or risky dependencies and runtime versions",
            "developer_experience": "Slow builds, flaky tests, missing tooling",
        },
        impact_axes="latency or load (only where a source states it), risk of the change, effort (S, M, L)",
        request_hint="A developer task: which code to change, how, and how to prove it (tests).",
        tools=_CODE_TOOLS,
    ),
}


def lens_brief(role: Role, focus: list[str] | None = None) -> str:
    """The lens as instruction text, with the organization's focus kinds weighted up."""
    lens = LENSES[role]
    focus = [k for k in (focus or []) if k in lens.kinds]
    kinds = sorted(lens.kinds.items(), key=lambda kv: kv[0] not in focus)
    lines = [f"You look for {lens.looks_for}.", "", "Kinds of opportunity, most valuable first (use these exact kind names):"]
    lines += [f"- {k}: {v}" + (" (the organization's current focus)" if k in focus else "") for k, v in kinds]
    lines += ["", f"Impact is measured in {lens.impact_axes}."]
    return "\n".join(lines)


def writer_brief(role: Role) -> str:
    """How one seat's view of a sighting is written: the persona, plus how to phrase the mission request."""
    return "\n".join([persona_brief(role).split("\n\nDepth.")[0].split("\n\nDepth:")[0],
                      "", f"The request: {LENSES[role].request_hint}"])


# ── The reader lint ────────────────────────────────────────────────────────

_CODEISH = re.compile(
    r"`[^`]+`"                                    # inline code
    r"|\b[\w./-]+\.(?:py|ts|tsx|js|java|go|rb|sql|yaml|yml|json)\b"  # file names
    r"|\b(?:GET|POST|PUT|PATCH|DELETE)\s+/"      # endpoints
    r"|(?<![\w])/(?:api|v\d)/"                    # url paths
    r"|\b[a-z]+_[a-z_]+\(|\b[a-z]+[A-Z]\w*\("    # function calls
    r"|:\d+\b(?=\s|$|[,.)])"                      # path:line
)

# Words from the business persona's "never" list that are safe to match as words.
_BUSINESS_TERMS = ("api", "endpoint", "microservice", "backend", "frontend", "database", "schema", "migration",
                   "deploy", "repository", "config", "feature flag", "cache", "latency", "payload", "webhook",
                   "refactor", "interface contract", "adr")


# Infrastructure words neither the business user nor the product owner reads (personas: "infrastructure detail", "SQL").
_INFRA_TERMS = ("orm", "sql", "jwt", "kafka", "redis", "protobuf", "kubernetes", "docker", "async", "stack trace",
                "exception", "argon2id", "pydantic", "fastapi")


def lint_view(role: Role, text: str) -> list[str]:
    """What in a view breaks its reader's rules. Only the business and product seats are linted."""
    if role in CODE_SEATS:
        return []
    problems = [f"code-like text: {m.group(0)!r}" for m in _CODEISH.finditer(text)][:3]
    low = text.lower()
    terms = _INFRA_TERMS + (_BUSINESS_TERMS if role == Role.business else ())
    problems += [f"technical word: {w!r}" for w in terms if re.search(rf"\b{re.escape(w)}s?\b", low)]
    return problems


def banned_summary(role: Role) -> str:
    return ", ".join(PERSONAS[role].avoid)
