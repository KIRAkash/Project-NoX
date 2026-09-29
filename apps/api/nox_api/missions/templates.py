"""Spec-file shape per role: headings NoX drafts under, and the verification checklist it ends with."""

from ..db.models import MissionStage, Role

ROLE_ORDER: list[Role] = [Role.business, Role.product, Role.engineering, Role.developer]

FILE_NAME = {
    Role.business: "01-business.md",
    Role.product: "02-product.md",
    Role.engineering: "03-engineering.md",
    Role.developer: "04-developer.md",
}

TITLE = {
    Role.business: "Business requirement",
    Role.product: "Product spec",
    Role.engineering: "Engineering design",
    Role.developer: "Build spec",
}

ROLE_NAME = {Role.business: "Business user", Role.product: "Product owner", Role.engineering: "Engineering lead", Role.developer: "Developer"}

# (heading, what goes under it). Headings are written verbatim; the brief steers the content.
SECTIONS: dict[Role, list[tuple[str, str]]] = {
    Role.business: [
        ("The request", "the original sentence, quoted verbatim, never reworded"),
        ("Problem", "what goes wrong or is missed today and what it costs the business"),
        ("Who is affected", "the people who feel it, by the names the business uses, and roughly how many or how often"),
        ("What should change", "what those people will see, do or receive afterwards"),
        ("What \"done\" looks like", "how the business user will know it worked, in terms they can observe"),
        ("Examples", "one to three concrete before/after situations with realistic people, amounts and dates"),
    ],
    Role.product: [
        ("Goal", "the user outcome in one or two sentences, traced to the business requirement"),
        ("User stories", "As a <user type>, I want <capability>, so that <outcome>"),
        ("Acceptance criteria", "numbered AC-1, AC-2, … in Given / When / Then, each pass/fail and observable"),
        ("Edge cases", "states, permissions, limits and failures; mark ones found in the knowledge base with *(from the map)*"),
        ("Out of scope", "what this change deliberately does not do"),
        ("Success metric", "baseline → target, where the number comes from, when to read it; a target the request or knowledge base doesn't give is marked *(suggestion)*"),
        ("Priority", "P1–P4 and why, weighed against the cost of not doing it"),
    ],
    Role.engineering: [
        ("Applications changing", "each application and its owning team, and why it must change; name notable ones that must not"),
        ("Approach", "the design decision and why, following existing patterns"),
        ("Contracts affected", "table: contract · owner app · consumers · unchanged / additive / breaking"),
        ("Must not break", "existing behaviour, contracts and data that have to survive untouched"),
        ("Architecture, guardrails and standards", "the ADRs, layering rules, guardrails and coding standards from the knowledge base that apply, and how this design honours each"),
        ("Test strategy", "table: level (unit / integration / contract / end-to-end) · what it proves · AC or contract covered"),
        ("Rollout and rollback", "flags, ordering across applications, data migration, how to undo"),
        ("Risks", "each risk with its likelihood and mitigation"),
    ],
    Role.developer: [
        ("Files and services touched", "paths, grouped by application"),
        ("What to reuse", "existing components, utilities and patterns, with paths"),
        ("Tasks", "a numbered, checkable list in build order, each small and verifiable"),
        ("Test plan", "per task: test file, case, and the AC or contract it proves; the commands to run"),
        ("Rollout", "migrations, flags and deploy steps the developer owns"),
    ],
}

VERIFY_HEADING = "## Verification checklist"


def stage_for(role: Role) -> MissionStage:
    return MissionStage(role.value)


def next_stage(stage: MissionStage) -> MissionStage:
    order = [MissionStage.business, MissionStage.product, MissionStage.engineering, MissionStage.developer, MissionStage.build]
    return order[order.index(stage) + 1] if stage in order[:-1] else stage


def upstream_of(role: Role) -> list[Role]:
    return ROLE_ORDER[: ROLE_ORDER.index(role)]
