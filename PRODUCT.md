# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Four seats, treated as equal first-class users, chosen freely from a role picker: Business user, Product owner, Engineering lead, Developer. Each seat writes its own Markdown spec file for a mission, with NoX as co-author, and reads the files of the seats before it. Write-for-the-reader applies: a business user's file never mentions endpoints or services.

## Product Purpose

NoX is an agentic platform that takes an enterprise change from a business user's first sentence to verified, shipped code. It has two halves:

- **Atlas:** a live map of the enterprise (organizations, teams, sub-teams, applications). For each application NoX builds a code wiki, a knowledge base in its own Git repository, from code, Confluence, Jira, Notion, Slack and uploads, and keeps it in sync on every push.
- **Missions:** one change moves through the four seats. A coding agent builds it with `/nox NOX-n`, and the seats verify it in reverse order before it is done.

Built for the Google Cloud AI Builder Cup (Future of Work & Enterprise Productivity). Deliverables due 2026-10-18: live Cloud Run link, video under 3 minutes, public repo, PDF.

## Positioning

- The knowledge base is generated from real code and connectors by a multi-agent builder, stored as an Open Knowledge Format (OKF 0.2) bundle with cross-application `[[kb:app/page]]` links and an organization-wide contract map.
- Requirement-to-verification in one system: each seat's spec ends in a checklist that is ticked in reverse, by people, after the Developer marks the mission complete.

## Operating Context

- Spec files live in Postgres (authoritative) and are mirrored to the KB Git repo.
- Missions carry keys like `NOX-12` and sync two-way with Jira (project `APEX`) and pull requests.
- Surfaces in the web app: landing experience, product docs at `/docs`, login and role choice, Mission control, Atlas (org canvas, onboarding, app pages, connectors), mission detail with a tab per spec file, Evidence, Jira and PR panel, timeline, contract map, Impact page (BigQuery flight recorder), Show NoX (in-platform screen, screenshot, video and voice capture cited back to the KB).
- Coding agents connect through the `nox` CLI, MCP (`/mcp`) and A2A (`/a2a/ask`). Google Antigravity is the primary environment; Claude Code is one supported `/nox` target, listed after it.
- NoX Local builds a KB on a developer's machine with Gemma via Ollama; only Markdown pages leave the laptop.
- Demo data: five "Apex Trading" codebases.

## Capabilities and Constraints

- Stack: Next.js 15 / React 19 / Tailwind web app in `apps/web`; FastAPI (Python 3.12) in `apps/api/nox_api`; `packages/nox-cli`; Postgres with pgvector; Cloud Run, Firebase Auth.
- AI is Google ADK agents on Gemini (Gemini Enterprise Agent Platform), with Gemma via Ollama for NoX Local. Nothing else.
- Every AI output cites a source; unknowns become open questions, never guesses. Only people approve, verify or send back.
- Identifiers stay as they are: `nox` CLI, `nox_api`, `NOX_*` env vars, `NOX-n` keys, `X-Nox-Role` header. Prose and UI copy write `NoX`.
- Public repo: no references to earlier project or product names, and no statement that NoX was built with Claude Code.
- Undecided: how the contest's pre-existing-work rule applies to the ported engine.

## Brand Commitments

Name NoX. Wordmark N●X, with the glowing star as the O (0.76em, cap height). Promote Google Antigravity as the build environment and the AI Builder Cup (aibuildercup.com).

## Evidence on Hand

Five Apex Trading demo codebases, Jira project `APEX`, product docs in `apps/web/content/docs/`, demo script in `docs/DEMO_SCRIPT.md`. No customer testimonials, benchmarks or usage metrics exist; do not fabricate them.

## Product Principles

1. People own decisions; agents draft, look up, check and cite.
2. Grounded or it doesn't ship: every claim traces to a KB page, spec, `path:line` or Jira field.
3. Every seat is first-class, and each spec is written for its own reader.
4. Real integrations over mocks.
5. Scope is set by NoX from memberships, never by the model or a prompt.

## Accessibility & Inclusion

No product-specific standard established. Default to WCAG 2.1 AA.
