# What NoX is

NoX is an orchestrated, spec-driven development platform for enterprise software in the age of AI. While coding agents can generate code in seconds, enterprise software fails when changes lack architectural context, contract awareness, and rigorous verification. NoX solves this by anchoring every change to a living enterprise atlas and orchestrating work through a disciplined four-seat spec chain—business user, product owner, engineering lead, and developer—ensuring AI agents write code with full architectural context and verified intent.

It has two halves, built so each makes the other better:

- **Atlas: the map.** NoX reads each application's code, documents, tickets and conversations and turns them into a code wiki, a knowledge base that is checked against the code on every push. Every knowledge base is written in Google Cloud's **Open Knowledge Format (OKF)**, the open standard for knowledge that agents and people share. Knowledge bases are arranged the way the enterprise is: organizations, then teams and sub-teams, then applications. Across them, NoX tracks the contracts that connect one application to another.
- **Missions: the use.** A mission is one change. A business user describes it in business language. A product owner, an engineering lead and a developer each write their own spec file with NoX beside them. A coding agent builds it with `/nox`, and the people who asked confirm it in reverse order before it counts as done.

> NoX's agents run on **Google's Agent Development Kit (ADK)** and **Gemini**, served from the Gemini Enterprise Agent Platform. With **NoX Local**, the same agents run on **Gemma** on a developer's own machine, so code that must stay inside the building can still get a knowledge base.

## The problem it solves

In a large company, a change goes through several people before it ships, and each of them has to rebuild the context from scratch:

1. A business user describes what they need in a meeting or an email.
2. A product owner turns it into a ticket, and some of the original intent gets lost along the way.
3. An engineering lead works out which systems it touches, usually by asking around.
4. A developer spends a day finding where the code lives and what else depends on it.
5. At the end, someone checks the ticket rather than the original business request.

Every step loses context, and nobody checks the result against the original request. NoX fixes both problems. The map means nobody has to rediscover the systems from scratch. The mission carries the original sentence all the way to the code and back.

## The journey in one picture

```text
  FORWARD: each seat writes its own file, grounded in the map
  ──────────────────────────────────────────────────────────────────────────▶
  Business user      Product owner       Engineering lead     Developer          Coding agent
  01-business.md  →  02-product.md    →  03-engineering.md →  04-developer.md →  /nox NOX-12 → PR
  "the sentence"     ACs, edge cases     contracts, risks     tasks, tests        guard comment

  ◀──────────────────────────────────────────────────────────────────────────
  REVERSE: each seat ticks its own checklist, developer first, business last
  Developer  →  Engineering lead  →  Product owner  →  Business user  →  Done
  "is the code what we built?"  ...  "is my sentence now true?"
```

Every file is saved to the database and committed to the application's knowledge-base repository in Git. Every stage change is mirrored to the linked Jira ticket. Every pull request is checked against the application's architecture rules.

## What makes it different

**The knowledge is in an open Google format.** NoX's knowledge bases follow Google Cloud's [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing): typed YAML frontmatter on every page, an index in every folder, and a dated change log. NoX extends it with cross-application links, so an enterprise's many knowledge bases form one map. Knowledge written once is readable by any OKF-aware agent, not only by NoX.

**The knowledge is live, not a snapshot.** Most internal wikis go stale within a quarter. NoX's knowledge bases are rebuilt by a team of agents and kept current by a gatekeeper that reads every push, decides whether the documentation needs to change, and opens a small patch pull request when it does. People can pin corrections to a page, and those corrections survive every later rebuild.

**Each role writes for itself, with an AI co-author.** There is no single shared document that everyone half-owns. Each role has its own file, which only that role can edit and every other role can read. NoX drafts it, refines it after each save, edits it on request from a chat panel, and cites where every fact came from. Every file is written in its reader's own vocabulary: the business user's file never mentions an endpoint.

**Verification runs backwards through the same people.** When the developer marks a mission complete, each role's checklist opens in reverse order. A product owner who finds an acceptance criterion unmet sends the mission straight back, with a note, to whoever has to fix it.

**It works with the tools people already use.** Jira tickets move on their own. Pull requests get a guard comment. The developer builds in whatever coding assistant they prefer (Google Antigravity, Cursor, Codex, Copilot or Claude Code), and `/nox` loads the whole mission and its knowledge-base context into it.

## Built for the enterprise

NoX assumes a large organization from the start:

- **Hierarchy.** Organizations contain teams, teams contain sub-teams, and applications belong to the team that owns them. Membership decides what each person can see.
- **Many applications, one map.** Contracts between applications (REST routes, event topics, gRPC services, shared models) are extracted from every knowledge base into one organization-wide contract map. An engineering lead can see who calls an endpoint before they change it.
- **Role-based access.** Four seats (business user, product owner, engineering lead, developer), each with its own capabilities, enforced by the server on every request.
- **Everything in Git, in an open format.** Knowledge bases are Open Knowledge Format bundles and spec files are Markdown, all in repositories the organization owns and reviewed through pull requests like any other change.
- **Cloud-native on Google Cloud.** Cloud Run, Cloud SQL with pgvector, Memorystore, Cloud Storage and Secret Manager, with Gemini reached through the runtime service account, so no API key is ever deployed.

## Where to go next

| If you want to… | Read |
| --- | --- |
| Understand the four seats and what each one sees | [Roles and seat homes](/docs/roles) |
| Onboard applications and explore their knowledge bases | [Atlas](/docs/atlas) |
| Run a change from request to approval | [Missions](/docs/missions) |
| Build with a coding agent and verify the result | [Build and verify](/docs/build-and-verify) |
| Connect GitHub, Jira, Confluence, Notion and Slack | [Integrations](/docs/integrations) |
| See how the agents work on Gemini, ADK and Gemma | [Agentic AI on Google](/docs/google-ai) |
| Understand the system design and deployment | [Architecture](/docs/architecture) |
| See where NoX goes next | [Roadmap](/docs/roadmap) |
