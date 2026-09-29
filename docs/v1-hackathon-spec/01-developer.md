# Developer

The Developer is the biggest planet because this is where the loop turns: they build the change with a coding agent that already knows the estate, mark it shipped, then run the first verification step in reverse.

**Planet:** banded blue gas giant with one ring, `#86B9EE`. **Stage owned:** Build, then Verify (code vs brief). **Primary action on home:** "Open next build".

## Mission control

| Panel | Shows | Example |
| --- | --- | --- |
| Waiting on you | Requests at Build with an approved design, oldest first | NOX-104 Invoice PDFs · design approved 2h ago |
| Verify your work | Shipped requests awaiting the developer's reverse check | — |
| In flight | Requests you shipped, now being verified further up | NOX-098 · with Business user |
| Agent sessions | Recent workspace sessions, with status | NOX-104 · plan ready, 3 files |
| Atlas alerts | Guardrails your open requests touch | ADR-014: no direct ledger writes |

## Requests and tickets

- Default filter: **My stage = Build**. Clearing it shows the full board.
- At Build, a request becomes a ticket: the technical brief is split into tasks (for example "Add `GET /invoices/:id/pdf`", "Reuse Receipts renderer", "Add Download button to portal"). Each task has a checkbox, an app dot and an estimate.
- The developer can add tasks, reorder them, or split one. They cannot change the acceptance criteria or the design. Those are shown frozen above, with a "Send back to Engineering lead" link if they're wrong.
- **New request (bug):** the developer can file a bug directly. It starts at Signal with the developer's sentence, and NoX drafts the checklist for a Business user to confirm, so bugs follow the same loop.

## Request detail, from this seat

1. Pinned: the original sentence.
2. Frozen chips: Business checklist → Product spec → Engineering design, each expandable.
3. Open: the **technical brief** NoX generates from the design and the atlas:
   - Apps and files touched, with paths (`RefundPanel.tsx`, `refunds:/v1/refunds`)
   - What already exists to reuse
   - Contracts that must not change, and who reads them
   - Tests to run and tests to add
4. Task list (the ticket).
5. Footer: **Open in workspace** · **Mark shipped** (enabled once every task is ticked) · Send back.

## Workspace (coding agent)

The workspace is where NoX stops handing over documents and starts working alongside the developer. In the POC it is a simulated agent session with a scripted plan and diff, streamed live when the API is on.

- **Left:** context the agent was grounded in. That's the three frozen artifacts plus the atlas pages for each app touched. Each item can be toggled so judges see what the agent knows.
- **Centre:** the chat and plan. The agent opens with a plan citing the atlas ("RefundPanel.tsx already calls /v1/refunds, so I'll extend it rather than add a new panel"), then proposes a diff per task.
- **Right:** the diff viewer, with each hunk tagged to the task it completes. Guardrail hits show as amber callouts ("This touches `entry.settled`; Reporting reads it").
- **Actions:** Accept hunk, Ask agent, Mark task done. "Copy as `nox` skill prompt" copies the context bundle for use in the developer's own agent. This mirrors the landing page's Agent downlink section.

## Verify (reverse, first step)

After Mark shipped, the request comes straight back to the developer as **Verify: code vs brief**.

| Check | Pre-ticked by NoX when |
| --- | --- |
| Every task in the brief has a matching change | Each task has an accepted hunk |
| Existing component reused, not duplicated | No new file duplicates a reused path |
| Contracts untouched | Diff doesn't change any contract the atlas lists as read elsewhere |
| Tests pass | Scripted as passing in the POC |

Passing sends the request to the Engineering lead's verify step. Failing sends it back to Build with the unticked items as tasks.

## Atlas, from this seat

The full atlas, including contracts, guardrails, code locations and freshness. Clicking an app opens its page with a list of open requests touching it. The developer can't onboard applications. That's the Engineering lead's job.

## Artifacts

Filter defaults to briefs and verification reports. Every artifact opens read-only, with its authorship tint: NoX's blocks in the role hue, human-written blocks in white.
