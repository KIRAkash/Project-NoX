# Roadmap

NoX connects the entire delivery trajectory from a business user's first sentence to verified code, across live repositories, tickets and architectural contracts. This chapter outlines the next three horizons: completing core platform foundations, scaling enterprise spec-driven orchestration, and establishing an autonomous, self-governing software network.

## Recently shipped

- **Agents that call each other.** NoX's knowledge tools over the Model Context Protocol, and its Ask agent over Agent2Agent. See [Integrations](/docs/integrations#mcp-nox-s-tools-inside-any-agent).
- **NoX Shield.** Model Armor and Sensitive Data Protection on everything NoX reads and writes. See [Agentic AI on Google](/docs/google-ai#nox-shield-model-armor-and-sensitive-data-protection).
- **The flight recorder.** Mission events and AI usage in BigQuery, and the Impact page.

## Next: finishing the foundations

Pieces that are designed and partly built:

- **The Artifacts library.** Every spec file from every mission in one searchable place, filterable by application, seat and status, drawing on the versions NoX already stores.
- **The organization activity feed.** Each mission's timeline is live today; the Activity page will merge them with knowledge-base syncs into one feed per organization.
- **Per-organization credentials.** Credentials are one set per deployment today. Each organization will connect its own GitHub, Jira and Atlassian accounts from **Atlas → Connectors**, with the secrets kept in Secret Manager.
- **Signed webhooks everywhere.** Slack signature verification and a shared secret for Confluence, matching what GitHub and Jira already have.
- **Notifications where people are.** "Waiting on you" and "coming back to you" pushed to Slack and Google Chat, with a link straight to the file.
- **Approved specs published to Confluence**, for teams whose readers live there.
- **Human review recorded in the knowledge base.** When someone merges a knowledge-base pull request, NoX writes OKF's `verified: [{by: human:<reviewer>, at: …}]` onto the pages they reviewed, so every OKF consumer can tell human-reviewed knowledge from machine-written knowledge. Pages with pinned corrections get the same treatment.
- **Evidence beside the checklist.** When the developer marks a mission complete, NoX attaches hints next to each checklist item (the relevant part of the PR diff, the guard result, the test run) so verification is grounded in verifiable system evidence rather than manual searching. People still tick every item.

## Spec-driven orchestration: architectural integrity at scale

**Autonomous onboarding across the enterprise estate.** Point NoX at a GitHub organization and it discovers the team hierarchy from repository ownership and CODEOWNERS, then onboards hundreds of applications in parallel. Gemini's batch mode keeps the cost of a first full build of a large estate predictable, and explicit context caching over each organization's shared conventions makes every later page cheaper.

**Impact analysis before anyone writes a line.** The contract map already knows who calls what. The next step is a blast-radius view on every engineering design: each consumer of a changed contract, its owning team, and the tests that cover the path. That turns "which teams do I need to talk to?" from a week of messages into a list on the page.

**Evidence-backed verification.** Connect the checklist to the systems that already know the answer: CI results for the test plan, the deploy pipeline for rollout steps, analytics for the success metric. NoX pre-fills each item's evidence; people confirm it. The product owner's "metric moved from baseline to target" becomes a chart in the file, not a promise.

**NoX inside the tools people already use.** An agent that joins the Jira ticket, the Slack thread and the Google Chat space where a request first appears, and offers to turn it into a mission there. A Google Docs add-on so a business user can ask for a change from the document they're already writing.

**Voice for the first sentence.** A business user describes the change out loud, on a call or in the car, using Gemini's live audio, and NoX drafts the business requirement back for them to confirm.

**One knowledge format for code and data.** Google's OKF reference agent already writes OKF bundles for BigQuery datasets: tables, metrics and join paths. Because NoX's knowledge bases are OKF too, the two can be linked: an application's page for the `orders` service can point at the BigQuery table it writes, and a question like "which services feed this metric?" can be answered across both. Every bundle can also be published to a shared catalog, so the company's code and data knowledge is discoverable in one place.

**Managed agent hosting.** Moving the long-running agent teams onto **Vertex AI Agent Engine** gives them managed sessions, memory and scaling, so NoX's own services stay small and the knowledge-base builders scale with demand.

## The autonomous enterprise: a self-governing software network

**A living model of the whole company's software.** Every application, contract, decision, owner, incident and change, linked and always current. A model that stays true to the systems rather than static documentation, updated on every push, ticket and incident. New engineers, auditors, architects and agents all start from the same understanding on day one.

**From request to production, supervised rather than driven.** For well-understood kinds of change, NoX's agents carry a mission through drafting, design review against the contract map, implementation, testing and a staged rollout, and bring each person in only at the decisions that are theirs: the business user confirms the intent, the product owner accepts the criteria, the engineering lead approves any contract change, the developer reviews the code. The reverse verification loop stays human, and every step is still in Git.

**Company-specific models, on the company's own hardware.** Gemma fine-tuned on an organization's own code, decisions and past missions, running inside its network with NoX Local, for the code that can never leave. Gemini for everything else. One set of agents, the right model for each piece of work.

**Built-in governance.** Every AI action is already cited, versioned and attributed. At enterprise scale, that becomes an audit trail regulators can read: which requirement a line of code traces to, who approved it, what it was checked against. Guardrails from architecture decisions are enforced on every PR across the estate, building on NoX Shield, which already screens sources and questions with Model Armor.

**Delivery analytics that close the loop.** The flight recorder already streams every mission into BigQuery and shows where work waits and what bounces back. Next, it checks whether shipped changes delivered the outcome the business asked for, and feeds that back into NoX's own drafts.

**A cross-company contract network.** The same contract map that links applications inside a company can also link partners. API producers and consumers in different organizations receive notifications before breaking changes ship.

## The principles that don't change

However far NoX goes, four things hold:

1. **People own decisions.** Agents draft, refine, check and carry context. People approve and verify.
2. **Everything is grounded and cited.** No claim without a source, no guess without a question mark.
3. **Everything lands in Git.** Knowledge, specs and verification are files the enterprise owns.
4. **Each person gets the right slice, in their own words.** The business user never has to read an endpoint, and the developer never has to guess what the business meant.
