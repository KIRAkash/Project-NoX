"""The agents behind Sightings (CP18): a scout per seat, a critic, and a writer per opportunity.

    scout (one per application × seat, DEFAULT, knowledge tools picked by the seat's lens)
      → the job merges candidates that say the same thing (missions/sightings.py)
      → review (FAST, one structured call over every merged opportunity: keep or drop, relevance per seat)
      → write (DEFAULT, one structured call per kept opportunity: a view per seat it matters to)
      → rewrite (FAST, only for a business or product view the reader lint rejected)

The scout's lookups land in session state (`cited`), which the job uses to drop any page the scout claims but
never read. Scope (`apps`, `home_app`) is set by NoX from the organization being scanned (principle 3).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from ...db.models import Role
from ...missions.lenses import LENSES, banned_summary, lens_brief, writer_brief
from ...missions.templates import ROLE_NAME
from .. import config, runtime, structured
from ..schemas import OpportunityReview, ScoutReport, SeatSighting, SightingViews

SCOUT = """You are NoX's scout for the {seat} seat. You read what NoX knows about one application and propose changes
worth the {seat}'s time. Nobody asked for these: they have to earn attention.

{lens}

Rules:
- Look things up before you claim anything. Cite only knowledge-base pages you read or searched (kind 'kb', ref
  '<app>/<page>' exactly as the tool returned it).{code_rule}
- Signals in the digest can be cited by their own refs: a mission ('mission', 'NOX-n'), a capture ('capture', its id),
  a Jira issue ('jira', its key), an interface ('contract', its identifier), a Shield finding ('shield', its category).
- Be specific: name the flow, screen, component or file. "Improve performance" or "add more tests" is not a candidate.
- No invented numbers. Impact is high, medium or low with the reason in impact_basis; a number only if a source states it.
- Leave out anything already in flight or turned down before (both are listed in the message).
- Spend your lookups well: at most 8 tool calls. Start from the pages and signals most likely to hide a problem.
- Return at most {max} candidates, best first. Return none when nothing is worth this seat's time."""

CODE_RULE = " Code locations come only from grep_source or read_source_file results, as 'path:line' (kind 'code')."
NO_CODE_RULE = " You can't read source code; don't cite it."

REVIEW = """You are NoX's critic for suggested changes. Each opportunity below was found by scouts looking through one
or more seats' lenses. For each one decide whether a busy person should see it.

Score 1–5:
- specific: names a concrete place, flow or component, not a generality
- actionable: someone could start a change from it today
- evidenced: the listed sources really support the claim (judge only by what is listed)
- worth: worth the time of the seats it matters to
keep = true only when every score is 3 or more. When two opportunities say the same thing, keep the better one.

relevance (0 to 1) per seat is how much this opportunity matters to that seat in its own terms:
- business: money, customers, staff time or risk the business would feel. Pure code health is near 0.
- product: what users experience, or how product outcomes are measured.
- engineering: the system's shape: architecture, cost, reliability, security.
- developer: code the developer would change: speed, health, tests.
claim: restate the opportunity in one seat-neutral sentence."""

WRITE = """You are NoX. Write one suggested change (a "sighting") for each seat listed, so that each reader sees it
in their own terms and can start a mission from it with one click. Same facts for every seat; different words, depth
and emphasis. Use only the facts below. No numbers that aren't in them.

{briefs}

For each seat: a title under 90 characters, why (two or three sentences: what NoX noticed and why it matters to this
reader), impact (one sentence in their terms), request (what this reader would type to start the change),
how_we_know (one to three short lines in their words on what the sources show), questions (none to two of the open
questions that this reader could answer, rewritten in their words; leave out questions only another seat could answer),
and mission_type (feature, bug or change). Leave out seats that aren't listed. No wikilinks or [[…]] citations in any text: the evidence is shown next to
the sighting."""

REWRITE = """Rewrite this suggested change for the {seat}. It broke the reader's rules: {problems}.
Never in this text: {banned}, code, file paths, endpoints, function names or backticks. Keep the facts and the meaning."""


@dataclass
class Scouted:
    app: str
    seat: Role
    report: ScoutReport
    cited: list[str] = field(default_factory=list)
    jira_read: list[str] = field(default_factory=list)


async def scout(seat: Role, app: str, apps: dict[str, str], digest: str, *, focus: list[str], max_candidates: int = 6) -> Scouted:
    from google.adk.agents import LlmAgent

    from ..tools import knowledge

    lens = LENSES[seat]
    agent = LlmAgent(
        name=f"nox_scout_{seat.value}", model=config.model(config.Tier.DEFAULT),
        tools=[getattr(knowledge, n) for n in lens.tools],
        instruction=SCOUT.format(seat=ROLE_NAME[seat].lower(), lens=lens_brief(seat, focus), max=max_candidates,
                                        code_rule=CODE_RULE if lens.code_evidence else NO_CODE_RULE),
        output_schema=ScoutReport, output_key="report",
    )
    result = await runtime.run(agent, digest, state={"apps": apps, "home_app": app})
    report = structured._parse(ScoutReport, result.output, result.text)
    report.candidates = report.candidates[:max_candidates]
    jira = [str(c["args"].get("key", "")).upper() for c in result.tool_calls if c["name"] == "get_jira_issue"]
    return Scouted(app=app, seat=seat, report=report, cited=list(result.state.get("cited") or []), jira_read=jira)


async def review(opportunities: list[dict]) -> OpportunityReview:
    """`opportunities`: [{claim, kind, apps, evidence: [says…], impact_basis, found_by: [seat…]}]."""
    payload = json.dumps([{"index": i, **o} for i, o in enumerate(opportunities)], indent=1)
    return await structured.ask(OpportunityReview, payload, name="nox_sightings_review", instruction=REVIEW,
                                tier=config.Tier.FAST)


async def write(opportunity: dict, seats: list[Role]) -> SightingViews:
    briefs = "\n\n".join(f"===== Seat: {s.value} ({ROLE_NAME[s]}) =====\n{writer_brief(s)}" for s in seats)
    message = json.dumps({"seats": [s.value for s in seats], **opportunity}, indent=1)
    return await structured.ask(SightingViews, message, name="nox_sightings_write", instruction=WRITE.format(briefs=briefs),
                                tier=config.Tier.DEFAULT)


async def rewrite(seat: Role, view: SeatSighting, problems: list[str]) -> SeatSighting:
    return await structured.ask(SeatSighting, view.model_dump_json(indent=1), name="nox_sightings_rewrite",
                                instruction=REWRITE.format(seat=ROLE_NAME[seat].lower(), problems="; ".join(problems),
                                                           banned=banned_summary(seat)),
                                tier=config.Tier.FAST)
