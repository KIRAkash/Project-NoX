"""Typed outputs of NoX's agents. Gemini is constrained to these shapes, so nothing parses free-form JSON."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class KBFile(BaseModel):
    path: str = Field(description="Path inside the knowledge base, e.g. 'summaries/api-spec.md'")
    markdown: str = Field(description="The complete Markdown content of the file")


class GatekeeperDecision(BaseModel):
    decision: Literal["significant", "trivial"]
    reason: str = Field(description="One sentence")
    affected_files: list[str] = Field(default_factory=list, description="Knowledge-base pages or source files the change touches")


class PagePatch(BaseModel):
    files: list[KBFile] = Field(description="Only the pages that must change, each as its complete updated Markdown")


class CoverageDiff(BaseModel):
    pages_to_create: list[str] = Field(default_factory=list)
    pages_to_update: list[str] = Field(default_factory=list)
    is_fully_covered: bool = False
    reason: str = ""


class RollupResult(BaseModel):
    files: list[KBFile] = Field(description="Org-level knowledge-base files; always include 'index.md'")


# ── Knowledge-base build ────────────────────────────────────────────────────

PageKind = Literal["summary", "concept", "entity", "decision"]


class PlannedPage(BaseModel):
    path: str = Field(description="'summaries/…', 'concepts/…', 'entities/…' or 'decisions/…', ending in .md")
    topic: str = Field(description="What the page covers, one line")
    source_files: list[str] = Field(default_factory=list, description="Source files (exact paths from the corpus) this page is grounded in; at most 12")


class Interface(BaseModel):
    kind: Literal["rest", "graphql", "grpc", "event", "queue", "db_table", "library", "other"]
    identifier: str = Field(description="e.g. 'POST /orders/{id}/refund', 'order.refunded', 'orders' table")
    direction: Literal["exposes", "consumes"]
    description: str = ""


class ArchitectureMap(BaseModel):
    summary: str = Field(description="Markdown architectural overview of the application: purpose, main components, data flows, key decisions. This becomes index.md")
    components: list[str] = Field(default_factory=list, description="Main components, one line each")
    interfaces: list[Interface] = Field(default_factory=list, description="Interfaces the application exposes or consumes")
    pages: list[PlannedPage] = Field(description="The knowledge-base pages to write")


# ── Show NoX: what a capture shows, and what the knowledge base says about it ─


class TranscriptLine(BaseModel):
    t: float = Field(description="Seconds from the start of the capture")
    speaker: str | None = None
    text: str


class Moment(BaseModel):
    t: float = Field(description="Seconds from the start of the capture")
    what: str = Field(description="What happens, in one short plain sentence")
    screen_text: list[str] = Field(default_factory=list, description="On-screen text that matters here, copied exactly")
    is_problem: bool = False


class Screen(BaseModel):
    t: float
    title: str | None = None
    url_or_route: str | None = None
    visible_text: list[str] = Field(default_factory=list, description="Text that matters on this screen, copied exactly")


class MediaObservation(BaseModel):
    """Stage 1 (Perceive): only what is seen or heard. No guesses about code."""

    summary: str = Field(description="Plain, 2–4 sentences")
    kind_of_request: Literal["bug", "change", "question", "idea"] = "question"
    transcript: list[TranscriptLine] = Field(default_factory=list, description="Speech, with timestamps")
    moments: list[Moment] = Field(default_factory=list)
    screens: list[Screen] = Field(default_factory=list)
    identifiers: list[str] = Field(default_factory=list, description="Exact strings that may exist in code or docs: error "
                                   "messages, codes, labels, field names, routes, event names, ticket keys")
    expected: str | None = Field(default=None, description="What the author expected (bugs)")
    actual: str | None = Field(default=None, description="What happened instead")
    steps: list[str] = Field(default_factory=list, description="Repro steps, as seen")
    marked_area: str | None = Field(default=None, description="What the author's annotation points at (images)")
    sensitive: list[str] = Field(default_factory=list, description="Kinds of personal data visible on screen, if any (no values)")


class AppMatch(BaseModel):
    app: str
    confidence: Literal["high", "medium", "low"]
    why: str


class Finding(BaseModel):
    ref: str = Field(description="Knowledge-base page ref '<app>/<path>' exactly as a tool returned it")
    says: str = Field(description="What the page says, one sentence")
    relevance: str = Field(description="Why it matters for what was shown, one plain sentence")
    moment_t: float | None = None


class CodeHit(BaseModel):
    app: str
    location: str = Field(description="'path:line' exactly as grep_source returned it")
    snippet: str = ""
    moment_t: float | None = None


class ContractHit(BaseModel):
    app: str
    identifier: str
    direction: str = Field(description="'exposes' or 'consumes', or how the capture touches it")


class MediaGrounding(BaseModel):
    """Stage 3 (Ground): the capture tied to applications, pages, code and contracts. Every ref was looked up."""

    apps: list[AppMatch] = Field(default_factory=list, description="Applications the capture concerns, best first")
    findings: list[Finding] = Field(default_factory=list, description="1–5 knowledge-base pages that explain what was shown")
    code: list[CodeHit] = Field(default_factory=list)
    contracts: list[ContractHit] = Field(default_factory=list)
    explanation: str | None = Field(default=None, description="What the knowledge base says about the behaviour seen, if anything")
    likely: Literal["bug", "intended_behaviour", "missing_feature", "unclear"] = "unclear"
    open_questions: list[str] = Field(default_factory=list)
    suggested_request: str = Field(default="", description="One sentence, in plain words, for the business seat")


class SeatMoment(BaseModel):
    t: float
    what: str


class SeatFinding(BaseModel):
    ref: str
    why: str


class SeatView(BaseModel):
    summary: str = Field(description="One paragraph in this seat's vocabulary")
    moments: list[SeatMoment] = Field(default_factory=list)
    findings: list[SeatFinding] = Field(default_factory=list)


class SeatViews(BaseModel):
    """The same analysis, pitched for each seat (the business view never mentions code)."""

    business: SeatView
    product: SeatView
    engineering: SeatView
    developer: SeatView


class ChecklistHint(BaseModel):
    index: int = Field(description="0-based index of the checklist item")
    hint: str = Field(description="What the recording shows for this item, e.g. 'Seen at 0:18: status turns Settled', "
                      "or 'Not shown in the recording'")
    t: float | None = Field(default=None, description="Seconds into the after-recording where it is seen")
    seen: bool = False


class EvidenceComparison(BaseModel):
    """Show it works: before and after recordings compared against a checklist. Hints only; people tick."""

    summary: str = ""
    hints: list[ChecklistHint] = Field(default_factory=list)
