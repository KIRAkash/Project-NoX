# Product owner

The Product owner turns the Business user's approved checklist into a spec: the goal, acceptance criteria, edge cases and the metric that proves it worked. They also own priority. In reverse, they check the shipped result against the goal, not just the ticket.

**Planet:** violet with a single moon, `#A897F0`. **Stage owned:** Definition, then Verify (goals vs spec). **Primary action on home:** "Define next request".

## Mission control

| Panel | Shows | Example |
| --- | --- | --- |
| Waiting on you | Requests at Definition, sorted by age, with the business checklist as a chip | NOX-109 · "Partners want to know why a payment was declined" |
| Verify against goals | Requests in reverse waiting on product verification | — |
| Priority board | P1–P4 columns of every open request. Drag between columns to reprioritise | 1 × P1, 3 × P2 |
| Metrics to watch | Metrics from specs of shipped requests, with a placeholder sparkline | Invoice tickets / week |

## Requests and tickets

- Board view by default, filtered to Definition. The PO can see and filter the whole board.
- Only the PO can change `priority` and `title`.
- **New request on someone's behalf:** the PO can log a sentence for a stakeholder ("From: Support team"). It starts at Signal and is assigned to a Business user seat to approve the checklist, so the sentence still gets signed off by the person who meant it.

## Writing the spec

Opening a request at Definition shows the frozen Business checklist on top and a draft spec below. NoX starts drafting it the moment the page opens, using the co-authoring animation.

| Spec section | NoX drafts from | PO does |
| --- | --- | --- |
| Goal | Checklist "what should change" | Tightens to one sentence |
| Acceptance criteria | Checklist + atlas behaviour of the apps matched | Edits, adds, removes. Each AC is a checkbox that returns in verification |
| Edge cases | The atlas: known behaviours of each app (for example Refunds' partial-refund splitting) | Keeps or dismisses each one. Items from the atlas carry a small "from the map" badge |
| Out of scope | Similar past requests | Confirms |
| Success metric | Checklist "what done looks like" | Picks a number and a window ("-30% refund-status tickets in 2 weeks") |
| Priority | — | P1–P4 |
| Attachments | Business user's image, carried over | Can add mockups |

The "from the map" edge case is the key product moment of the demo. The PO sees a case the Business user never mentioned, and can see why NoX raised it by opening the linked atlas entry.

**Actions:** Approve and send to Engineering lead · Send back to Business user ("I need to know…") · Save draft.

## Verification (reverse, third step)

Arrives after the Engineering lead's scope check.

- Each acceptance criterion reappears as a check, with evidence NoX attaches: diff summary, a screenshot, and the developer's and Engineering lead's verify notes.
- Edge cases appear as separate checks, marked "from the map" where relevant.
- The metric is shown with "Watch starts on confirm".
- **Pass:** goes to the Business user for final sign-off. **Misses a goal:** back to Design, with the failing ACs attached.

## Atlas, from this seat

Summary view plus owners and what each app owns. Dependencies appear as a simple list ("Customer Portal depends on Refunds, Payments API, Identity"). Contracts and guardrails are collapsed behind "Technical details".

## Artifacts

Default filter: specs. Includes a "Specs by application" view, so the PO can see everything ever defined against Refunds Service.
