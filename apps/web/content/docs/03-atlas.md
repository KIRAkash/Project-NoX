# Atlas

The Atlas is NoX's map of the enterprise. It holds every organization and team, every application they own, and a code wiki for each application that stays current as the code changes. Every code wiki is written in Google's **Open Knowledge Format**, so the knowledge is portable to any OKF-aware agent. Everything in Missions is grounded in it: the drafts, the answers, the co-writer's edits and the guard on every pull request.

Product owners, engineering leads and developers can use the Atlas. Engineering leads own its structure.

## Organizations, teams and applications

The Atlas is laid out the way a large company is:

```text
Apex Holdings                      ← organization
├── Trading                        ← team
│   ├── Execution                  ← sub-team
│   │   └── order-matching-engine  ← application
│   └── market-data-gateway
├── Post-Trade
│   ├── trade-settlement-system
│   └── compliance-surveillance-monitor
└── Platform
    └── mini-auth-service
```

On the Atlas page, the organization is the outer frame, with its totals across the top: teams, applications, and how many are **In orbit**. Each team is a box inside it, and sub-teams sit inside their parent as darker, inset boxes. Applications are cards showing their status, number of sources and last update; hover a card for its repository. Each application keeps one planet colour everywhere, including the contract map and mission cards. When an organization has more than four teams, an **Org chart** in the side column lists the hierarchy with application counts; click a team to jump to its box. Type in **Find an application or team** to filter the whole map.

**To add structure** (engineering lead): use **Add a team to …** under the organization, or **Add a sub-team under …** inside any team. **New organization** in the side column starts a separate tree. Nesting can go as deep as the company needs.

**To invite people**: in **Members**, enter an email and choose **Invite**. Members see this organization and everything beneath it.

## Onboarding an application

Choose **Onboard application** at the top of the Atlas, or **+ Onboard** in a team's header (a dashed tile when the team has no applications yet) to start with that team already selected.

1. **Name and owner.** The application's name as your teams say it (for example `order-matching-engine`) and the team that owns it.
2. **Sources.** Add the code and every place its knowledge lives:

   | Source | What NoX reads |
   | --- | --- |
   | GitHub repository | The code, README and docs, at the default branch |
   | Confluence space or page | Architecture decisions, runbooks, design pages |
   | Jira project | Issues, descriptions and comments |
   | Notion page | Product requirements, data dictionaries |
   | Slack channel | Design discussions and decisions made in threads |
   | Uploaded file | OpenAPI and AsyncAPI specs, PDFs, diagrams and other documents |

   NoX checks every source live with the connected credentials and shows a green or red mark next to each before you launch, so a typo in a URL fails now rather than halfway through the build.
3. **Review and launch.** NoX creates the application and starts building its knowledge base.

## Watching the knowledge base get built

Each application's page shows its **Trajectory**, which updates live over server-sent events:

| Stage | What is happening |
| --- | --- |
| **In the Void** | Queued, waiting for a worker |
| **Scanning Nebula** | Reading every source into one snapshot |
| **Compiling Stars** | The agent team is writing the pages |
| **Awaiting Launch** | The knowledge base is open as a pull request on the application's `kb-<app>` repository, as an Open Knowledge Format bundle |
| **In Orbit** | The pull request is merged; the knowledge base is live and kept in sync |

The **Flight log** under the trajectory records each step as it happens: every source read, the architecture map, every page written, lint results, contracts registered and the pull request opened. It scrolls within a fixed height, newest first.

Behind **Compiling Stars** is a team of Gemini agents built with Google ADK, run as one ADK workflow graph:

1. A **cartographer** reads the whole snapshot once and returns a typed architecture map: the overview, the components, every interface the application exposes or consumes, and a page plan that names the exact source files each page must be grounded in.
2. **Page writers** run in parallel, one per planned page. Each gets only its own files, plus a shared prefix that Gemini caches implicitly across all the writers.
3. **Links**: NoX repairs every link between pages and weaves in links to the other applications this one talks to.
4. A **quality gate** runs NoX's deterministic linter over every page. A **reviewer** rewrites only the pages that fail, and the gate checks them again. This loops up to twice (`NOX_REVIEW_ROUNDS`); a page that still fails is listed in the pull request for a person to fix.
5. NoX then writes the result as an **Open Knowledge Format** bundle: frontmatter on every page, an index in every folder, and the dated change log.

While a build runs, the trajectory panel draws this graph and lights up each step as it runs: the writers count pages as they finish, and the reviewer shows its round. When the build is done, the panel shows what it cost, for example **Built by NoX's agents · 31 calls · 412k tokens · 38% cached · 2m 14s**.

On the demo's market-data-gateway, this team writes 11 pages in 29 seconds using 12 model calls and 20k input tokens. The classic single-model pipeline, still available for comparison, took 252 seconds, 19 calls and 85k tokens on the same snapshot. Screenshots and diagrams in the sources are passed to Gemini as images, so an architecture diagram in Confluence becomes part of what the pages describe.

**If something fails**, the trajectory shows **Lost Signal** on the failing step. **Retry** resumes from that step, using the checkpoints saved along the way. **Restart** runs the whole build again.

## What a knowledge base contains: an Open Knowledge Format bundle

Every knowledge base NoX writes follows the **Open Knowledge Format (OKF)**, Google Cloud's open specification for knowledge that AI agents and people share ([introduced on the Google Cloud blog](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing); [specification](https://github.com/GoogleCloudPlatform/open-knowledge-format)). OKF turns the "LLM wiki" pattern into a portable standard: a directory of Markdown pages with YAML frontmatter, which any producer can write and any agent can read without translation. NoX writes to **OKF 0.2**, so a NoX knowledge base isn't locked into NoX. Any OKF-aware agent or tool can pick it up.

```text
kb-market-data-gateway/                an OKF bundle, one Git repository per application
  index.md          okf_version: "0.2" · the architectural overview, then the contents
  summaries/        Interface Reference pages (summaries/api-spec.md for every exposed interface)
    index.md        this folder's pages, each with its one-line description
  entities/         Component pages: one per significant component and data model
    index.md
  concepts/         Concept pages: flows, lifecycles, cross-cutting mechanisms
    index.md
  decisions/        Architecture Decision pages: one ADR per decision
    index.md
  log.md            every generation and sync, grouped by date, newest first
  AGENTS.md         how a coding agent should use this knowledge base
  .nox/brief.md     a compact brief of under 4,000 characters, for agents
  missions/         spec files from every mission touching this app
```

**Every page starts with OKF frontmatter.** `type` is the one field OKF requires, and NoX fills in the rest of the recommended and provenance fields too:

```yaml
---
type: Component
title: Order Book Consumer
description: Reads depth snapshots from Kafka and caches the latest L2 book in Redis.
resource: https://github.com/apex/kb-market-data-gateway/blob/main/entities/order-book-consumer.md
tags: [market-data-gateway, entities]
sources:
  - resource: https://github.com/apex/market-data-gateway/blob/HEAD/src/consumers/order-book.ts
generated:
  by: nox/gemini-3.7-flash
  at: 2026-09-26T08:31:00Z
---
```

- **`sources`** lists the exact code files the page is anchored to, so any reader can check a statement against the code it came from.
- **`generated`** records which agent wrote the page and when its content last changed: `nox/<gemini model>` for cloud builds, `nox-local/<gemma model>` for NoX Local. A sync only rewrites the pages that changed, so an untouched page keeps its date.
- **Folder indexes** give OKF's *progressive disclosure*: an agent reads the root `index.md`, then one folder's index, and only then the pages it needs.
- **`log.md`** is OKF's change log: a `## YYYY-MM-DD` heading per day, newest first, one entry per build and sync.
- Keys NoX doesn't know are kept when a page is rewritten, as the specification asks.

**NoX's extensions for knowledge across applications.** OKF describes one bundle. NoX connects many. Pages link to each other with `[[wikilinks]]`, and to other applications' knowledge bases with `[[kb:other-app/page]]`, which is what joins an organization's bundles into one navigable map. Pages are also anchored to their source lines with `<!-- anchor: … -->` comments, which is how the gatekeeper knows which pages a code change affects. The root `index.md` keeps the application's architectural overview above the OKF contents. All of these sit inside the format, not beside it: the specification requires OKF consumers to tolerate links they can't resolve and frontmatter keys they don't recognise, and the page body is free Markdown.

Before any page is committed, NoX runs checks:

- **Linter**: every page has the sections its folder requires, wikilinks resolve, no page is orphaned, and nothing is a stub.
- **OKF conformance**: every page has parseable frontmatter with a `type`. The result is reported in each knowledge-base pull request's quality gate.
- **Secret gate**: nothing that looks like a credential is ever committed to a knowledge base.
- **Quality gate**: the application page shows the page count, errors and warnings from the last lint.

## Working with a knowledge base

The application page has three tabs: **Overview**, **Explore** and **Ask the KB**.

**Overview** has the trajectory and flight log, plus:

- **Sources**: every connected source with its last sync time. Add a new one at the bottom; NoX ingests just that source and updates the pages it affects.
- **Check PR status**: see whether the knowledge-base pull request has been merged.
- **Check sources for updates**: look for new commits, pages or messages now, without waiting for a webhook or the next poll.
- **Quality gate**: the lint summary and the **Agent brief**, the compact description NoX hands to coding agents.
- A **Built with** badge showing whether the knowledge base was built by NoX's agents on Gemini, or on a developer's machine with NoX Local and Gemma.

**Explore** is the code wiki itself. Each page opens with a small **OKF** strip showing its type, tags and the agent that generated it, and the folder indexes are part of the tree. Browse the page tree and read pages with working links: an OKF link such as `/entities/x.md` opens that page in place, a `[[page]]` link opens that page, and a `[[kb:other-app/page]]` link jumps to another application's knowledge base.

**Pinning a correction.** Knowledge bases are written from sources, and sometimes the sources are wrong or incomplete. Anyone who can pin (product owner, engineering lead, developer) can open a page in Explore and add a correction in the **Human corrections** panel beside it. The pin is stored in the database as well as the page, and every future build and sync re-applies it before committing. A human correction therefore survives every rebuild. Each correction shows who added it, and anyone who can pin can remove it.

**Ask the KB** answers questions about the application. It is an ADK agent on Gemini with tools, not a single prompt:

- It searches the knowledge base, reads the pages it needs, checks the contract map for questions about other applications, and reads source files for exact details.
- Each lookup appears as a step while it works ("Searching market-data-gateway for 'consumer group'…"), and the answer streams in as it is written.
- Every page it read becomes a citation you can click, and code is cited as `path:line`.
- The answer is pitched to your seat: plain language for a business user, exact files and data shapes for a developer.
- Conversations are kept in ADK database sessions, so a follow-up question keeps its context, even across server instances.

## Staying in sync

A knowledge base that goes stale is worse than none. NoX keeps them current automatically:

1. **A push lands.** A GitHub webhook (or the poller, in polling mode) reports the new commits. Confluence, Slack, Notion and Jira changes arrive the same way.
2. **The gatekeeper decides.** It first checks which anchored page sections the diff touches. If that doesn't settle it, a fast Gemini model classifies the change as significant or not, with a structured, typed answer.
3. **A patch pull request.** If the change matters, the patch compiler rewrites only the affected pages and opens a small pull request on the knowledge-base repository, with your pinned corrections re-applied.
4. **Search is re-indexed.** Only the sections that changed are re-embedded.

## The contract map

Every knowledge base registers the contracts its application exposes: REST routes, gRPC services, event topics, shared models and SDK clients. The Atlas draws them as an interactive map at the bottom of the organization view: each application is a node sized by how many interfaces it exposes, and lines show which applications consume which contracts. Select an application to see its interfaces and consumers.

The same map powers the rest of NoX:

- The engineering lead's design lists which contracts a change touches, who consumes each one, and whether the change is unchanged, additive or breaking.
- Ask and the co-writer use `find_interfaces` to answer "who calls this?" across applications.
- Suggested applications for a new mission are ranked partly by which application owns the vocabulary of the request.

## The organization knowledge base

Once two or more applications in an organization are In Orbit, NoX writes an **organization-level knowledge base** (`kb-org-<slug>`) with Gemini's deep tier, also as an Open Knowledge Format bundle. It rolls up the applications into one view: the landscape, the shared contracts, the cross-cutting decisions, and how the applications depend on each other. It is written again each time another application's knowledge-base pull request is merged, so it keeps up with the applications under it.

## Connectors

**Atlas → Connectors** shows every system NoX reads from or writes to, each checked live against this deployment's credentials: GitHub, Jira, Confluence, Notion, Slack and Gemini. **Check again** re-runs the checks. See [Integrations](/docs/integrations) for setup.
