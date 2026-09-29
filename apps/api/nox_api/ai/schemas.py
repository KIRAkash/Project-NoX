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
