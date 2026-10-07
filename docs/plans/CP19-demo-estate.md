# CP19: A new demo estate — one enterprise, many connected applications

The Apex demo was built for an earlier version of NoX. It is five small trading services (43 files in total), one Confluence space, one Jira project and one Slack channel. It still carries prefixes from the old project (`nte.`, `scfs.`, `com.gfmg.nte`), and its domain is hard for a business user to relate to: nobody outside a trading desk has an opinion about sub-35µs matching latency.

This plan replaces it with one fictional enterprise whose applications depend on each other the way real ones do. Every NoX capability gets something planted in the estate to show it, and every seat gets work that makes sense from where it sits.

| Part | What it adds |
| --- | --- |
| A. The enterprise and its map | Company, org tree, 15 applications, the contract catalogue |
| B. The estate manifest | `demo/estate.yaml`: one file that every script and check reads |
| C. Codebases | Reference code: readable, connected, not runnable |
| D. Sources | New Confluence spaces, Jira projects, Slack channels and Notion pages on the current sites |
| E. Planted beats | What each NoX capability needs, and where it lives |
| F. Seeding and tooling | Seeders driven by the manifest, history replay, name check |
| G. Build, evals, rehearsal | KBs in orbit, golden questions, captures, sightings eval |
| H. Retire Apex | Archive old repos and sources; update product copy and docs |

---

## What was built (reduced scope)

The demo is recorded, and judges use the live portal, so the estate was cut to what the demo shows. Everything lives in `demo/tidewell/`. Steps to finish setting it up are in `demo/tidewell/README.md`.

- **10 applications, not 17.** These are customer-portal, customer-identity, notifications-hub, rating-service, policy-admin, claims-intake, claims-management, fraud-scoring, billing-service and payments-gateway, in five teams with two squad levels. Dropped: mobile-bff, quote-engine, underwriting-rules, broker-workbench, document-service, core-ledger-bridge and platform-contracts.
- **Code is 4 to 15 files per app.** It covers README contracts, ADRs, models, handlers, clients, config and the planted problems.
- **Sources:** 13 Confluence pages in 4 spaces, 23 Jira issues in 2 projects (`TWPOL`, `TWCLM`), 13 Slack threads in 4 channels, and 3 Notion pages.
- **Seeded:** Slack, Notion, Confluence and Jira. GitHub is waiting on the new org.
- **Not built:** backdated Git history, `seed_history.py`, the sightings eval, the whiteboard image, and new Ask and Show NoX evals. Removing the old Apex files (part H) is left for a person to do.

---

## Ground rules

- **No old names anywhere.** No "apex", `nte`, `scfs`, `gfmg` or `sol-` in the demo code, sources, commit messages or URLs. A check script enforces it (part F).
- **The code is reference, not product.** It exists so NoX has something real to read: structure, contracts, decisions, data models, the odd TODO. It does not need to build, run or pass tests. Effort goes into what the knowledge base and the contract map read, not into making services work.
- **Everything a seat sees must be grounded.** NoX never invents numbers. If the business user should see "renewals fall by 9 points when the notice goes out late", that number has to be written in a seeded source. Part D plants these deliberately.
- **The contracts in the manifest are the truth.** Code, OpenAPI, AsyncAPI, Confluence and Slack agree with `demo/estate.yaml`, except where a mismatch is planted on purpose.
- **Retire, don't delete.** Old repos, spaces and channels are archived. A person deletes them later, after the new estate is in orbit.

---

## A. The enterprise and its map

### The company

**Tidewell Mutual** (working name, check it before recording): a home and motor insurer with 1.2 million customers, sold online and through brokers. It quotes, sells and renews policies, takes premiums monthly or yearly, and handles claims from first notice to payout.

Why insurance:

- **Everyone has bought a policy or made a claim.** Quotes, renewals, monthly payments and claims need no glossary, so a business user's sentence reads as a real request.
- **It is a large, layered enterprise.** Digital channels, policy, claims, billing and a legacy core sit in different teams with different stacks. One claim touches six applications.
- **It is regulated and full of personal data.** Claims hold injury details, addresses and bank accounts. Shield and the risk lens have real material.
- **Its numbers are business numbers.** Renewal rate, claim cycle time, cost per claim and fraud leakage are things a business user tracks.
- **It has screens.** A customer's claim tracker, a handler's claim console and a broker's quote screen make good Show NoX captures.

### The org tree (three levels)

```text
Tidewell Mutual                              (root, slug: tidewell)
├── Digital Channels
│   ├── Customer squad                       customer-portal, mobile-bff
│   └── Broker squad                         broker-workbench*
├── Policy
│   ├── Quote & Buy squad                    quote-engine, rating-service, underwriting-rules
│   └── Policy Admin squad                   policy-admin, document-service*
├── Claims
│   ├── Intake squad                         claims-intake
│   └── Handling squad                       claims-management, fraud-scoring
├── Billing & Payments                       billing-service, payments-gateway
├── Customer Platform                        customer-identity, notifications-hub*
└── Core Systems                             core-ledger-bridge*, platform-contracts*
                                             (* = light application)
```

`seed_org.py` only supports one level of teams today. Part F makes it recursive.

### The applications

| Application | Team | Stack | What it does | Size |
| --- | --- | --- | --- | --- |
| `customer-portal` | Customer | Next.js, TypeScript | Get a quote, manage a policy, pay, make and track a claim | Full |
| `mobile-bff` | Customer | NestJS, TypeScript | Backend for the mobile app; aggregates policy, claim and billing | Full |
| `quote-engine` | Quote & Buy | Python, FastAPI | Quote journeys, buying a policy | Full |
| `rating-service` | Quote & Buy | Kotlin | Premium calculation from risk factors | Full |
| `underwriting-rules` | Quote & Buy | Java, rules files | Accept, refer or decline; referral reasons | Full |
| `policy-admin` | Policy Admin | Java, Spring Boot | The policy record: issue, change, renew, cancel. The hub | Full |
| `claims-intake` | Intake | NestJS, TypeScript | First notice of loss: online, phone and broker | Full |
| `claims-management` | Handling | Java, Spring Boot | Claim lifecycle, handler assignment, reserves, settlement | Full |
| `fraud-scoring` | Handling | Python | Scores claims, calls an external fraud data vendor | Full |
| `billing-service` | Billing | Go | Payment plans, instalments, fees, arrears. **Hero repo** | Full |
| `payments-gateway` | Billing | Go | Card and direct debit collection, claim payouts | Full |
| `customer-identity` | Customer Platform | Go | Sign-in, tokens, customer profile, tenure | Full |
| `notifications-hub` | Customer Platform | TypeScript | Email, SMS, letters. Small enough for NoX Local on Gemma | Light |
| `broker-workbench` | Broker | Angular | Brokers quote and submit on a customer's behalf | Light |
| `document-service` | Policy Admin | Python | Policy documents and renewal notices as PDFs | Light |
| `core-ledger-bridge` | Core Systems | Java + COBOL copybooks | Adapter to the mainframe general ledger | Light |
| `platform-contracts` | Core Systems | TS and Python packages | Shared event schemas, published as libraries | Light |

That is 12 full and 5 light applications. The legacy bridge, with COBOL copybooks next to a Java adapter, is there because every real insurer has one, and it shows NoX reading code nobody wants to read.

### The contract catalogue

Events run on Google Cloud Pub/Sub. Topic names use three dot-separated parts in backticks, because that is what `agents/contracts.py` recognises.

**REST and gRPC**

| Contract | Owner | Consumers |
| --- | --- | --- |
| `POST /v1/auth/token`, `GET /v1/customers/{id}` | customer-identity | customer-portal, mobile-bff, broker-workbench, billing-service (after the hero mission) |
| `POST /v1/quotes`, `POST /v1/quotes/{id}/buy` | quote-engine | customer-portal, mobile-bff, broker-workbench |
| gRPC `RatingService.Price` | rating-service | quote-engine, policy-admin (mid-term changes) |
| `POST /v1/decisions` | underwriting-rules | quote-engine, policy-admin |
| `GET /v1/policies/{id}`, `POST /v1/policies/{id}/changes` | policy-admin | customer-portal, mobile-bff, claims-intake, claims-management, billing-service |
| `POST /v1/claims` | claims-intake | customer-portal, mobile-bff, broker-workbench |
| `GET /v1/claims/{id}` | claims-management | customer-portal, mobile-bff |
| `POST /v1/scores` | fraud-scoring | claims-management |
| `GET /v1/plans/{policyId}`, `POST /v1/plans` | billing-service | customer-portal, mobile-bff, policy-admin |
| `POST /v1/collections`, `POST /v1/payouts` | payments-gateway | billing-service, claims-management |
| `POST /v1/documents` | document-service | policy-admin |
| `POST /v1/messages` | notifications-hub | policy-admin, claims-management, billing-service |
| `POST /v1/journal-entries` | core-ledger-bridge | billing-service, claims-management |
| Library `@tidewell/events` / `tidewell-events` | platform-contracts | every event producer and consumer |

**Events**

| Topic | Producer | Consumers |
| --- | --- | --- |
| `policy.policy.issued` | policy-admin | billing, documents, notifications, customer-identity |
| `policy.renewal.due` | policy-admin | documents, notifications, billing |
| `policy.policy.cancelled` | policy-admin | billing, payments, claims-management |
| `claims.claim.reported` | claims-intake | claims-management, fraud-scoring |
| `claims.handler.assigned` | claims-management | **none** (planted orphan) |
| `claims.claim.settled` | claims-management | payments, core-ledger-bridge, notifications |
| `billing.instalment.due` | billing-service | payments-gateway, notifications |
| `billing.payment.missed` | billing-service | policy-admin, notifications |
| `payments.collection.succeeded` | payments-gateway | billing-service, core-ledger-bridge |
| `payments.payout.sent` | payments-gateway | claims-management, notifications |
| `fraud.score.flagged` | fraud-scoring | claims-management |
| `customer.profile.updated` | customer-identity | policy-admin (**not** billing: planted) |

**One planted structural smell:** claims-management reads policy-admin's `policy_cover` table directly to check cover, instead of calling `GET /v1/policies/{id}`. Policy-admin's ADR says each service owns its data. This is the engineering seat's best sighting.

---

## B. The estate manifest

Today the demo is described in three places that already disagree: `demo/app_sources.csv`, the `APPS` dict in `seed_org.py`, and hardcoded page lists in `seed_sources.py`. Replace them with one file, `demo/estate.yaml`:

```yaml
company: { slug: tidewell, name: Tidewell Mutual }
github_org: <new org>
orgs:                       # nested; seed_org walks it
  - slug: billing-payments
    name: Billing & Payments
  - slug: policy
    name: Policy
    children: [ { slug: quote-buy, name: Quote & Buy squad }, ... ]
apps:
  billing-service:
    org: billing-payments
    stack: go
    size: full
    hero: true
    provides: [ "GET /v1/plans/{policyId}", "POST /v1/plans" ]
    consumes: [ "GET /v1/policies/{id}", "POST /v1/collections" ]
    publishes: [ billing.instalment.due, billing.payment.missed ]
    subscribes: [ policy.policy.issued, payments.collection.succeeded ]
    sources:
      confluence: [ TWBILL ]
      jira: { project: TWPOL, component: billing-service }
      slack: [ tw-billing, tw-contact-centre ]
      notion: [ customer-research ]
      uploads: [ billing_openapi.yaml ]
planted:                    # every demo beat, with where its evidence lives
  - id: loyal-no-fee
    beat: hero-mission
    seats: [business]
    evidence: [ "notion:customer-research#long-standing", "confluence:TWBILL/fy26-retention", "slack:tw-contact-centre/2026-08-14" ]
```

Everything else reads it: the seeders, the push script, the consistency check, the evals and the demo script's checklist. Changing the theme later means changing this file and the content, not the scripts.

---

## C. Codebases

### What "reference code" means here

Each application is written to be read, not run:

- **Kept:** README, `docs/adr/`, OpenAPI or AsyncAPI, the domain model, the handlers or controllers that expose contracts, the clients and subscribers that consume them, config with topic names and service URLs, CODEOWNERS, a CI file, a few test files that show intent.
- **Skipped:** build correctness, dependency locking, wiring that only matters at runtime, test suites that pass, Docker setups that start.
- **Size:** full applications 15–30 files, light ones 5–12. About 350 files in total, against 43 today. Every file earns its place by carrying a contract, a decision, a model or a planted item.

### How to write them

1. Write the manifest and a short brief per application: purpose, data model, contracts with exact paths and payloads, planted items.
2. Generate each application from its brief with a coding agent in Google Antigravity, in dependency order (platform-contracts → identity → rating, underwriting, policy-admin → quote, billing, payments → claims → portal, BFF, broker, notifications), so consumers use the real shapes.
3. Read every contract once by hand. Generated code is fine; contracts that drift from the manifest are not.
4. Run `scripts/check_estate.py` (part F).

### Git history and branches

Push each repository with a handful of backdated commits (scaffold → feature → fix), authored by the fictional people who also appear in Slack and Jira, with messages that reference Jira keys (`TWPOL-112: add instalment fee waiver flag`). This is a script, not hand work.

Prepare these branches without merging them:

| Branch | Repo | Used for |
| --- | --- | --- |
| `docs/readme-typo` | rating-service | Flow B: the gatekeeper skips a trivial push |
| `feat/issued-channel-field` | policy-admin | Flow B: adds a field to `policy.policy.issued`; KB patch PR; consumers flagged |
| `refactor/drop-excess-field` | claims-intake | PR guard: removes a field claims-management reads; guard comment on the PR |
| `nox/NOX-1` | billing-service | The finished hero build, as a backup during the demo |

### The hero repository: `billing-service`

The live `/nox NOX-1` beat edits this repository and opens a PR. Since the code does not run, the beat shows the plan, the edits and the PR, not a passing test run. Keep the fee logic in one small, obvious file (`internal/fees/instalment.go`) with a clear place for a waiver rule, a customer-identity client that already exists but isn't used for tenure yet, and `nox init antigravity` committed.

---

## D. Sources (new, on the current sites)

New spaces, projects and channels sit beside the old Apex ones on the same Atlassian, Slack and Notion sites. Keys and names carry a `TW` or `tw-` prefix so the two never mix during the changeover.

### Confluence (four spaces)

| Space | Pages |
| --- | --- |
| `TWDIG` Digital Channels | Space overview; ADRs for the BFF and portal sessions; **Digital claims journey review, Q3** (states: 41% of online claims get a "where is my claim?" call within 5 days) |
| `TWPOL` Policy | ADRs for rating, referral rules, "each service owns its data"; **Renewals review FY26** (states: renewal rate 82% when the notice arrives 30 days ahead, 73% at 21 days; the current notice goes at 21) |
| `TWCLM` Claims | Claim lifecycle ADR; fraud vendor integration; **Claims payout runbook** with the planted prompt injection for Shield |
| `TWBILL` Billing & Payments | Payment plan rules; arrears process; **Retention and fees, FY26** (states: customers of 5+ years pay £38 a year in instalment fees and cancel at twice the average rate after a fee rise) |

Plus a `TWPLAT` page set under Core Systems: event conventions, Pub/Sub standards, the ledger bridge, and one incident review. About 25 pages in total. The business numbers live here on purpose: they are what lets the business seat see real figures.

### Jira (four projects)

| Project | Covers |
| --- | --- |
| `TWDIG` | Digital Channels |
| `TWPOL` | Policy, Billing & Payments. **Default project for missions** (the hero lands in billing) |
| `TWCLM` | Claims |
| `TWPLAT` | Customer Platform, Core Systems |

About 60 issues: epics, stories and bugs, with **components named after the applications**, so linking is exact. A mix of Done, In Progress and To Do. Planted issues include a customer-reported bug ("My claim says Submitted but a handler already called me"), a contact-centre request ("We refund instalment fees by hand when long-standing customers complain, about 300 a month"), and one issue ready to import as a mission. Set `JIRA_DEFAULT_PROJECT=TWPOL` and `JIRA_ALLOWED_PROJECTS=TWDIG,TWPOL,TWCLM,TWPLAT`.

### Slack (five channels)

`#tw-architecture`, `#tw-claims`, `#tw-billing`, `#tw-contact-centre`, `#tw-incidents`. About 40 threads, between the same fictional people who author commits and tickets. Planted:

- `#tw-contact-centre`: agents asking why loyal customers are charged instalment fees (hero evidence).
- `#tw-contact-centre`: "customers keep calling to ask if anyone's picked up their claim" (Show NoX beat).
- `#tw-incidents`: the fraud vendor slowed down and claim registration stalled; no timeout on our side (reliability sighting).
- One message pasting a claimant's name, phone number and injury details, which Shield should redact.

### Notion (one new top-level page, "Tidewell")

- **Customer research**: interview notes; long-standing customers name instalment fees and slow claim updates as reasons to leave.
- **Product requirements**: digital claims v2, broker quote parity.
- **Data dictionary**: Policy, Cover, Claim, Reserve, PaymentPlan, Instalment, Customer.

### Uploads

OpenAPI files for the REST owners, AsyncAPI for the event bus, a COBOL copybook as a text upload for the ledger bridge, and one **architecture whiteboard photo** (PNG), so the cartographer's image input has something to read.

---

## E. Planted beats: what each capability needs

| Capability | What is planted | Where |
| --- | --- | --- |
| Atlas, three levels | The org tree above | `estate.yaml` |
| KB build, cross-app links | 17 applications whose pages cite each other through contracts | code + sources |
| Contract map | 14 REST/gRPC contracts, 12 topics, one library, one orphan topic, one shared-table read | code |
| Org rollup | 17 published apps → `kb-org-tidewell` | automatic |
| Ask | Cross-app golden questions ("What happens after a claim is reported?", "Who reads `policy.policy.cancelled`?", "How does a payout reach the ledger?") | evals |
| **Hero mission** (four seats) | "Stop charging instalment fees to customers who've been with us more than five years." Lands in billing-service only. The engineering seat sees a new consumer of the unchanged `GET /v1/customers/{id}` (tenure) and the consumers of `GET /v1/plans/{policyId}` | billing-service + sources |
| Sightings, business | Late renewal notices (revenue: 82% vs 73%); manual fee refunds (operating cost: 300 a month); "where is my claim?" calls (customer experience: 41%) | Confluence, Jira, Slack, Notion |
| Sightings, product | Claim tracker never shows the handler (missing state); brokers can't see referral reasons that the portal shows (inconsistency); mid-term changes exist in policy-admin but the app can't reach them (unexposed capability) | code + Jira |
| Sightings, engineering | Shared `policy_cover` table (architecture); pro-rata premium maths in both rating-service and billing-service (duplication); no timeout on the fraud vendor (reliability); address changes never reach billing (`customer.profile.updated` not consumed) | code + ADR + `#tw-incidents` |
| Sightings, developer | Query in a loop when policy-admin lists covers (performance); untested rating factor table (test gap); Java 8 in core-ledger-bridge (dependency); TODO cluster in claims-intake (code health) | code |
| Show NoX | Mock screens: the customer's claim tracker stuck on Submitted, the handler console showing the claim assigned, a broker quote screen. The capture grounds to the orphan `claims.handler.assigned` | `demo/screens/` |
| Show it works | A second capture of the tracker after the fix, for evidence-based verification | `demo/screens/captures/` |
| Shield | Prompt injection in the payout runbook; claimant PII in Slack; a fake key in a non-provider format in notifications-hub config | sources + code |
| Flow B | `docs/readme-typo` (skipped) and `feat/issued-channel-field` (patched) | branches |
| PR guard | `refactor/drop-excess-field` | branch |
| Jira | Import an issue as a mission; status sync during the hero run | `TWPOL`, `TWCLM` |
| MCP / A2A | "Who consumes `claims.claim.settled`?" from Antigravity | contract map |
| NoX Local | `nox kb build` on notifications-hub with Gemma | light repo |
| Scoping | A second demo account in the Claims team only; it cannot see billing or policy apps, or sightings that cite them | `estate.yaml` members |
| Impact | Six to eight finished missions replayed through the API by the demo seats before recording | part F |

The business user's view of all this stays in plain words: sightings about renewals, fees and claim calls, an Impact page with missions moving, and a hero mission that starts from one sentence. None of it mentions endpoints or topics.

---

## F. Seeding and tooling

| Script | Change |
| --- | --- |
| `demo/estate.yaml` | New. Replaces `app_sources.csv`. |
| `nox_api/demo/seed_org.py` | Read the manifest; nested orgs; members per org, including the scoped Claims account. |
| `nox_api/demo/seed_sources.py` | Multiple spaces, projects and channels from the manifest; components on Jira issues; authors on Slack threads; the Notion page tree. |
| `nox_api/demo/push_repos.py` | Target the new GitHub org; create repos if missing; push the backdated history and the prepared branches. |
| `nox_api/demo/seed_history.py` | New. Replays finished missions through the API as the demo seats, so Impact and the sightings' mission signals have data. People's approvals are scripted as those people, in the demo org only. |
| `nox_api/demo/reset_missions.py` | Keep the replayed history; delete only rehearsal missions. |
| `scripts/check_estate.py` | New. Each manifest contract appears in the owner's code and spec and in each consumer; each planted item's evidence exists; banned names (`apex`, `nte.`, `scfs`, `gfmg`, `sol-`) appear nowhere under `demo/`. |
| `Makefile` | `make seed-demo` runs the check first. |

**The new GitHub org.** Once it exists: install the NoX GitHub App on it, then set `GITHUB_DEFAULT_ORG` and `GITHUB_APP_INSTALLATION_ID` locally and in `scripts/deploy_gcp.sh`. Knowledge-base repositories (`kb-<app>`, `kb-org-tidewell`) are created in the same org.

---

## G. Build, evals and rehearsal

1. Build two applications first and run `scripts/bench_kb.py` on them, to see cost and time before building all seventeen.
2. Build the rest; confirm every app is In Orbit and the org rollup exists.
3. Rewrite `scripts/eval_ask.py` golden questions for the new estate, with at least five cross-app questions.
4. Rewrite `scripts/eval_media.py` captures for the new screens.
5. Write `scripts/eval_sightings.py` (listed as not built in CP18). The `planted` list in `estate.yaml` is its answer key: a run should find most planted opportunities, for the right seat, with citations that resolve.
6. Rewrite `docs/DEMO_SCRIPT.md` around the hero mission, then rehearse twice.

---

## H. Retire Apex

- **External systems.** Archive the five Apex GitHub repos, the `APEX` Confluence space and Jira project, the Apex Notion pages and the old Slack channel. A person deletes them later.
- **Product code that names the demo:**
  - `apps/web/lib/spec-book.ts` (landing spec book: NOX-1 on mini-auth-service)
  - placeholders in `missions/new/page.tsx` (`APEX-42`) and `atlas/new/page.tsx` (`order-matching-engine`)
  - `core/config.py`, `.env.example`, `scripts/deploy_gcp.sh` (`JIRA_DEFAULT_PROJECT=APEX`, `NOX_DEMO_ORG_SLUGS=apex`)
  - the `nte` example in the `agents/compiler.py` prompt and the comment in `routers/kb.py`
- **Docs:** `README.md`, `PRODUCT.md`, `AGENTS.md` (`demo/` line), `docs/DEMO_SCRIPT.md`, user docs chapters 03, 04 and 08, and the pitch deck.
- **Tests** that use Apex names as fixtures can stay unless they read files under `demo/`. Check `test_media.py` and `test_shield.py`.
- Remove `demo/codebases/*`, `demo/sources/*`, `demo/app_sources.csv` and `demo/screens/trade-desk.html` once the new estate is in orbit.

GCP resources named `sol-*` are out of scope here.

---

## Order of work

1. Manifest and per-app briefs (A, B). Everything else depends on them.
2. Sources content (D) and codebases (C) in parallel, both written from the briefs.
3. Tooling (F), then `check_estate.py` until it is clean.
4. Seed sources, push repos, build two KBs and benchmark, then build the rest (G).
5. Evals, history replay, demo script, rehearsal.
6. Retire Apex (H).
