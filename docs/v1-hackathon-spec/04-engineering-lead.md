# Engineering lead

The Engineering lead decides which applications change, which contracts are involved and what must not break. They also own the atlas itself, including onboarding new applications. In reverse, they check the shipped scope against their design.

**Planet:** teal with a wide ring, `#5FCBD8`. **Stage owned:** Design, then Verify (scope vs design). **Primary action on home:** "Review next design".

## Mission control

| Panel | Shows | Example |
| --- | --- | --- |
| Waiting on you | Requests at Design with an approved spec | NOX-107 · "Morning report missing yesterday's refunds" |
| Verify scope | Requests in reverse after the developer's check | — |
| Blast radius this week | The atlas orbit with each app sized by open requests touching it, and a red ring where two requests touch the same contract | Ledger Core · 3 requests |
| Atlas health | Freshness per app, and guardrails hit this week | Reporting · synced 33 min ago |

## Requests and tickets

- Board filtered to Design by default. The Engineering lead can see every stage.
- Can confirm or edit `apps` (applications touched). This is the only role that can.
- **New request (tech debt / change):** can start a request directly ("Rotate service tokens without downtime"). Like all requests, it still begins at Signal with a sentence.

## Writing the design

The frozen checklist and spec appear on top. Below is the design draft, with the **impact map** at the centre.

- **Impact map:** the landing page's orbital diagram, zoomed to the apps this request touches. Touched apps glow and dependents dim in. Contract lines between them are drawn, and hovering one shows the contract (`refund.completed → notifications:refund-mail`).
- NoX's draft sections:

| Design section | NoX drafts from | Eng lead does |
| --- | --- | --- |
| Applications changing | Atlas match of the spec | Confirms, adds or removes apps |
| Approach | Spec + what each app owns | Rewrites as needed |
| Contracts affected | Atlas contracts of touched apps | Marks each: unchanged / additive / breaking |
| Must not break | Atlas `breaks` + guardrails | Keeps or overrides with a reason |
| Guardrails in play | ADRs from the atlas (for example ADR-014: no direct ledger writes) | Acknowledges each |
| Reuse | Existing components found in the atlas | Confirms |
| Risks | Similar past requests | Edits |

- A **breaking** contract turns the approve button amber and requires a deprecation note. This mirrors the Payments API guardrail on the landing page.
- **Actions:** Approve and send to Developer · Send back to Product owner · Save draft.

## Verification (reverse, second step)

- Scope checklist: each app in the design, with NoX's evidence that it changed (or didn't, where it shouldn't have).
- Contract check: every contract marked unchanged is confirmed untouched against the diff. Pre-ticked by NoX, overridable.
- Guardrails: each acknowledged ADR, shown as pass or fail.
- **Pass:** goes to the Product owner. **Fail:** back to Build with notes.

## Atlas, from this seat (owner)

Full atlas: orbit overview, then per-app pages with summary, owns, depends, breaks, contracts, guardrail, freshness and open requests.

**Onboard an application** (Engineering lead only):

1. Name, kind, tier (core / service / edge), owner team, repo URL.
2. NoX "reads" the repo. In the POC this is a scripted scan animation that fills owns, depends and contracts from a template.
3. The lead reviews each inferred fact. Any fact can be pinned as a human correction, which survives re-syncs (as the Notifications example on the landing page shows).
4. Publish: the new planet animates onto its orbital shell, in a newly picked hue.

**Edit guardrails:** add or retire an ADR on an app. Guardrails feed every future design and verification.

## Workspace

The Engineering lead can open any Developer workspace read-only, to see the agent's plan and diff, and can comment on hunks.
