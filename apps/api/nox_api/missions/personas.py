"""Who reads each spec file, and how NoX writes for them.

A persona is the reader NoX writes for: what they are accountable for, the lens they read through,
the words they use and the words they don't. Each role also has two depths:

- **full**: the change is about something this reader owns, so the file is written to their full standard.
- **light**: the change barely touches them (a refactor started from the Developer seat, as seen by the
  Business user). The file keeps its sections but stays short, and its checklist is a few basic
  "everything still works as before" checks in the reader's own terms.

NoX decides the depth per file from the request, who started the mission, and the upstream files.
"""

from dataclasses import dataclass

from ..db.models import Role


@dataclass(frozen=True)
class Persona:
    reader: str
    cares_about: list[str]
    voice: list[str]
    avoid: list[str]
    full_when: str
    light: str
    checklist_full: str
    checklist_light: str


PERSONAS: dict[Role, Persona] = {
    Role.business: Persona(
        reader=(
            "A person who runs part of the business: an operations manager, a sales or support lead, a finance "
            "owner. Not technical. They know their customers, their team's daily work and the numbers they are "
            "judged on. They read this file to confirm NoX understood what they asked for, and at the end they "
            "tick its checklist to say the change delivered what they meant."
        ),
        cares_about=[
            "The problem in business terms: what it costs today in money, time, customer trust, risk or missed opportunity.",
            "Who feels it: customers, staff, partners, by the names the business uses for them.",
            "What will be different for those people afterwards, described as what they see, do or receive.",
            "How they will know it worked: something they can observe themselves or read in a report they already use.",
        ],
        voice=[
            "Everyday words and short sentences, the way they would explain it to a colleague over coffee.",
            "Describe what people see and do, never how the software does it.",
            "Name parts of the product the way the business does (\"the checkout\", \"the refunds screen\"), not by application or service name.",
            "Concrete examples with real-looking customers, amounts and dates beat abstract statements.",
            "No knowledge-base citations or wikilinks in this file: this reader never opens the knowledge base.",
        ],
        avoid=[
            "API", "endpoint", "service (in the software sense)", "microservice", "backend", "frontend", "database", "schema",
            "migration", "deploy", "release pipeline", "repository", "config", "feature flag", "cache", "latency",
            "payload", "webhook", "refactor", "interface contract", "ADR", "file paths", "code identifiers", "acronyms the business doesn't use",
        ],
        full_when=(
            "The request describes something a customer, employee or partner will see, do, receive or be measured on, "
            "or it was started by the Business user."
        ),
        light=(
            "The change is internal (a refactor, an upgrade, a performance or reliability fix, tooling) and a "
            "business user will not notice anything. Keep every section to one or two plain sentences. Under "
            "\"What should change\" say plainly that nothing should look or behave differently for them, and in "
            "one sentence why the team is doing it in business terms (\"so the site stays fast during sales\"). "
            "Examples may say \"None: nothing changes for customers or staff.\""
        ),
        checklist_full=(
            "3 to 5 checks the business user can make themselves by using the product or reading a report they "
            "already have, in their own words. No tools, logs or technical steps. The last item asks whether the "
            "original sentence is now true, quoting it."
        ),
        checklist_light=(
            "2 or 3 basic \"still works as usual\" checks on the everyday things their people do in the affected "
            "part of the product (\"Customers can still place an order and get a confirmation email\"). Nothing else: "
            "don't quote the request here, since it is written in technical terms."
        ),
    ),
    Role.product: Persona(
        reader=(
            "The product owner: accountable for the outcome users get, the backlog and its priority. Fluent in the "
            "product's screens, flows, user types and data at a concept level. Does not read code. They read this "
            "file to be sure the change is fully specified as behaviour, testable, bounded and worth doing."
        ),
        cares_about=[
            "The user outcome and why it matters now, tied back to the business requirement.",
            "Behaviour that can be tested: acceptance criteria a tester could run without asking a question.",
            "Every user type and state: first-time and returning, permissions, empty, error, loading, limits, mobile.",
            "Consistency with how the product already behaves (the knowledge base is the map of current behaviour).",
            "Scope: what is deliberately not in this change, so it can't creep.",
            "How success is measured: baseline, target, where the number comes from, and when to read it.",
            "Priority against the cost of doing nothing, and who needs to hear about the change (support, sales, users).",
        ],
        voice=[
            "Write behaviour, not implementation: what the user does and what the product does in response.",
            "Name screens, flows, user types and applications. Endpoints only if the product itself is an API.",
            "Acceptance criteria in Given / When / Then, one observable outcome each, numbered AC-1, AC-2, ...",
            "Every criterion must be pass/fail. Never \"works correctly\", \"is fast\", \"is user-friendly\" without a measure.",
            "Product decisions the request and knowledge base don't settle (limits, conflicts, targets) are open questions "
            "for the product owner with a suggested answer marked *(suggestion)*, never stated as decided.",
        ],
        avoid=["code identifiers", "file paths", "class or function names", "SQL", "infrastructure detail", "how it will be built"],
        full_when="The change alters what any user sees, does, or can rely on, including internal users and API consumers.",
        light=(
            "The change is purely technical and no user-facing behaviour changes. Keep it short: the Goal is to keep "
            "existing behaviour exactly as it is while <the technical reason>. User stories: one line saying there "
            "are none. Acceptance criteria are regression criteria for the main flows the change runs under "
            "(Given / When / Then, same outcome as today). Out of scope: any change in behaviour. Success metric: "
            "no regression in an existing number (error rate, conversion, time on task) if the knowledge base names one."
        ),
        checklist_full="One check per acceptance criterion (by AC number) and per edge case, plus reading the success metric.",
        checklist_light="One check per regression criterion: the flow behaves exactly as before. Nothing else.",
    ),
    Role.engineering: Persona(
        reader=(
            "The engineering lead: accountable for the integrity of the system across applications and teams. They "
            "approve this design before anyone builds, and later verify the build matched it. They read for blast "
            "radius, architecture fit, and whether the change will be tested well enough to trust."
        ),
        cares_about=[
            "Which applications change, which teams own them, and why each one must change (and why others must not).",
            "Contracts between applications: every interface touched, classified unchanged / additive / breaking, with consumers named.",
            "Architecture fit: the change follows the existing patterns, layering and ADRs in the knowledge base. A new pattern needs a stated reason.",
            "Coding standards and guardrails from the knowledge base that apply, named specifically.",
            "Test strategy: which levels (unit, integration, contract, end-to-end), what each must prove, and which acceptance criteria each covers. Every touched contract gets a contract test.",
            "Data: schema changes, migrations, backfills, backward compatibility during rollout.",
            "Non-functional impact: security and permissions, performance, observability (logs, metrics, alerts), failure modes.",
            "Rollout and rollback: flags, ordering across applications, how to undo safely.",
        ],
        voice=[
            "Precise and technical. Real application, service, endpoint, event and table names from the knowledge base, cited as wikilinks.",
            "Decisions stated as decisions with the reason, not options left open. Genuine unknowns become open questions.",
            "Tables where they help (contracts, tests). No filler prose.",
        ],
        avoid=["restating the product spec", "task-level implementation steps (those belong in the build spec)", "vague risk (\"might break things\")"],
        full_when="Always write at full depth. When the change is small, the file is short because there is little to say, not because the lens changed.",
        light="",
        checklist_full=(
            "Scope matches the design (no application changed that wasn't listed), each contract marked unchanged is "
            "untouched and each additive one is backward compatible, the architecture and standards named were "
            "followed, the test strategy was delivered at every level it names, and rollback was proven or is ready."
        ),
        checklist_light="",
    ),
    Role.developer: Persona(
        reader=(
            "The developer building the change, and the coding agent they hand it to with /nox. They want no "
            "ambiguity: an ordered plan they can execute and check off, in this codebase's terms."
        ),
        cares_about=[
            "Exact files, modules and functions to change, and existing components, utilities and patterns to reuse instead of rewriting.",
            "Small ordered tasks, each finishable and verifiable on its own.",
            "Tests named per task: file, case, and the acceptance criterion or contract it proves. Commands to run them.",
            "Following the engineering design exactly. Where the code disagrees with it, raise an open question rather than diverge silently.",
            "Migrations, flags, config and the rollout steps they own.",
        ],
        voice=[
            "Terse and imperative (\"Add\", \"Extend\", \"Reuse\"). Code identifiers and paths in backticks.",
            "Paths and names only from the knowledge base or upstream files; if unsure, say so as an open question.",
        ],
        avoid=["product rationale already in upstream files", "restating the engineering design instead of turning it into tasks"],
        full_when="Always write at full depth.",
        light="",
        checklist_full="Each task done, each named test written and passing, reused components not duplicated, contracts marked unchanged untouched, rollout steps done.",
        checklist_light="",
    ),
}


def persona_brief(role: Role) -> str:
    """The persona as prompt text: who reads the file, what they look for, and how to write for them."""
    p = PERSONAS[role]
    lines = [
        "Your reader:", p.reader,
        "", "What they look for:", *[f"- {c}" for c in p.cares_about],
        "", "How to write for them:", *[f"- {v}" for v in p.voice],
        "", "Never in this file: " + ", ".join(p.avoid) + ".",
    ]
    if p.light:
        lines += [
            "", "Depth. Decide first how much this change concerns this reader:",
            f"- Full depth when: {p.full_when}",
            f"- Light touch otherwise: {p.light}",
            "When unsure, prefer full depth.",
        ]
    else:
        lines += ["", f"Depth: {p.full_when}"]
    return "\n".join(lines)


def checklist_brief(role: Role) -> str:
    p = PERSONAS[role]
    return f"At full depth, {p.checklist_full} As a light touch, {p.checklist_light}" if p.light else p.checklist_full
