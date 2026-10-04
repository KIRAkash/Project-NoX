# CP17: Evidence-based verification and status updates

Verification today is a tick and a note. This checkpoint makes it evidence-based, and gives the request a structured way to go back and forth after a change ships, without building a comment system.

| Part | What it adds | Status |
| --- | --- | --- |
| A. Evidence-based verification | A verdict per checklist item (Verified, Failed, Can't verify) with typed evidence attached | Built |
| B. Status updates and send-back | A fixed set of update types with a one-line note, optional evidence and a target seat; rework reopens only the failing items | Built |
| C. Contributors and custom flows | Many people contributing to one seat's file; QA, security and architecture as contributor tags; a flow each organization can shape | **Not built. Recorded so it's clear it was thought of.** The role picker says "more customization coming soon" |

**Why.** A reverse check that ends in "I'm good, thanks" proves nothing. In a regulated company the value of the chain is that someone can show what was asked, who approved it and what evidence says it worked. The requester also needs a way to say "this isn't right" and have the right seat see exactly what to redo.

**Estimate:** about 3 working days: A 1½, B 1½.

---

## What shipped, and where it differs from the design

- **Minimal UI.** Each checklist item keeps its checkbox. Verdict, evidence and note sit behind one paperclip on the item, so a closed checklist looks as it did. There is no separate updates page and no Send update dialog.
- **Update kinds are worked out, not picked.** *Completed* is Verified, *partial* and *rework* come from **Send back** (some items passed or none did), and *blocked* is a **Blocked** button that appears when an item is marked Can't verify. The person picks nothing extra.
- **Updates are events, not a table.** They are stored as `mission.update` events, which already feed the timeline, the Firestore ticket pipeline and BigQuery, so there is no `0009` migration. `GET /missions/{key}/updates` lists them.
- **The update card is a banner for the seat it's addressed to.** It shows only when a send-back is for your seat. Older updates live in the API and the events log.
- **Pre-collection is the PR links.** NoX attaches the mission's pull requests to the developer's checklist. CI status and the diff-versus-criteria result are not fetched yet.
- **Business wording of the update dialog is not built.**

## Ground rules

- **People own verdicts.** NoX pre-collects evidence and may say whether it supports an item. It never sets a verdict (same rule as CP15's Show it works).
- **No comment threads.** No replies, mentions or free-form discussion. Every update is one of a fixed set of types. Longer talk happens in Slack.
- **The Markdown file stays the record.** Verdicts and evidence are written back into the file's checklist, as ticks and notes are today (`missions/verification.py`), and mirrored to Git.
- **Nothing that exists breaks.** The current tick, note, `verify` and `send-back` routes keep working. Old checklists load with every item as Verified or unticked.

---

## Part A: Evidence-based verification

### A1. Verdict per item

Each checklist item has one of three verdicts:

| Verdict | Meaning | Needs |
| --- | --- | --- |
| Verified | The item is true now | Evidence, or an explicit "no evidence needed" for the seat's own judgement items |
| Failed | The item isn't met | A reason, plus evidence when there is any |
| Can't verify | The person couldn't check it (no access, no data, not testable) | A reason; it routes as a question, not a failure |

A seat can mark itself **Verified** only when every item is Verified. Any Failed item makes the seat's result **Not met**. Can't-verify items block Verified until someone else settles them or the seat waives them with a reason. This is stricter than today's single verdict button and keeps the record honest.

### A2. Evidence types

A fixed list, so the model stays small:

| Type | What it holds | Where it comes from |
| --- | --- | --- |
| Link | URL plus a label (PR, CI run, dashboard, staging page) | Typed in, or auto-attached (A3) |
| Capture | A `media_assets` id (screenshot, recording, voice note), from CP15 | Show NoX in the verify panel |
| Metric | A name, a value and a date | Typed in |
| Note | Up to 500 characters | Typed in |

Up to 5 pieces of evidence per item.

### A3. What NoX pre-collects

When **Mark as completed** starts verification (`routers/missions.py` `mission_completed`), a job attaches what already exists, so people only add what's missing:

- The linked PR(s) and their CI status (`missions/prs.py`).
- The diff-versus-acceptance-criteria check the PR guard already runs, shown as a hint on the Product and Developer checklists.
- The Show it works hints from CP15 (`POST …/verify-evidence`) when captures exist.

**Advisory check.** A small ADK agent reads an item and its evidence and returns `supports` / `unclear` / `contradicts` with one sentence. It's a hint next to the item, never a gate. If the model can't read an evidence item (a link it can't fetch), the hint says so instead of guessing.

### A4. Storage

The checklist stays parsed from the file (`parse_checklist`). Items in `SpecFile.verification["items"]` grow two fields:

```json
{
  "text": "Accounts lock after five failed attempts",
  "checked": true,
  "verdict": "verified",
  "note": "Checked on staging with a test account",
  "evidence": [
    {"type": "link", "label": "CI run 4812", "url": "https://..."},
    {"type": "capture", "mediaId": "…"}
  ]
}
```

`checked` stays as the boolean for older code: `checked = (verdict == "verified")`. Evidence is written back under each item, so the file stays the record:

```
- [x] Accounts lock after five failed attempts
  - Verdict: verified
  - Evidence: [CI run 4812](https://...), [[media:<id>]]
  - Note: checked on staging with a test account
```

`write_checklist` and `parse_checklist` learn the two new sub-bullets and ignore anything they don't recognise. Capture evidence renders as a `[[media:id]]` chip, the same as elsewhere.

### A5. API

| Route | Purpose | Access |
| --- | --- | --- |
| `PUT /api/v1/missions/{key}/files/{role}/verification` | Existing. Now accepts `verdict` and `evidence` per item | The seat whose turn it is |
| `POST /api/v1/missions/{key}/files/{role}/verification/evidence-check` | Runs the advisory check for one or all items (202, result on the mission stream) | Same |

`POST …/verify` keeps its shape (`verified` or `not_met`) and now validates against the item verdicts, as A1 describes.

### A6. UI

In `components/app/verify-panel.tsx`:

- Each item shows three buttons (Verified, Failed, Can't verify), then an **Add evidence** row with the four types.
- The NoX hint shows under the item as one line with a small status dot.
- Pre-collected evidence appears with an "added by NoX" label and can be removed.
- The seat's **Verified** button stays disabled, with a plain reason, until A1's rule is met.
- On the mission page the evidence count shows next to each file's status, like CP15's "N evidence added".

---

## Part B: Status updates and send-back

### B1. Update types

A small fixed set, sent by whoever is verifying or has been asked to:

| Type | Use | Effect |
| --- | --- | --- |
| Completed | This seat confirms its part | Same as Verified today |
| Partially works | Some items pass, some fail | Sends back only the failing items |
| Needs rework | The change doesn't meet the file | Sends back to a chosen seat |
| Blocked | Can't proceed (waiting on data, access, another team) | Pauses verification; the mission shows who it's waiting on |

Each update has a one-line note (required, 300 characters), optional evidence (A2), and a target seat.

### B2. Rework goes back with only what failed

`verify_file` and `send_back` already move a mission to an earlier seat with a reason. This part changes what travels with it:

- The failing items, their notes and evidence are attached to the update.
- The target seat's file shows a **Rework** banner listing exactly those items.
- The mission keeps a **round** counter (`SpecFile.verification["round"]` already exists). Each pass through verification adds one.
- When the target seat sends it back, the verifiers are asked to re-check only the items that failed, not the full list. They can still reopen the rest.

### B3. Storage

New table `mission_updates` (Alembic `0009`):

| Column | Notes |
| --- | --- |
| `id`, `mission_id` | |
| `author_id`, `author_role` | Who sent it, and from which seat |
| `kind` | `completed`, `partial`, `rework`, `blocked` |
| `note` | 300 characters |
| `to_role` | Nullable; the seat it is addressed to |
| `items` | JSON: the failing item texts, verdicts and evidence |
| `round` | Verification round |
| `created_at` | |

Every update also goes through `missions/events.record()` as `mission.update` (feeding the timeline, the Firestore ticket pipeline and BigQuery), and to Jira through `on_stage_change`, as `mission.sent_back` and `verify.not_met` do now.

### B4. API and UI

| Route | Purpose | Access |
| --- | --- | --- |
| `POST /api/v1/missions/{key}/updates` | Send an update | The acting seat, checked like `send_back` |
| `GET /api/v1/missions/{key}/updates` | List the updates, newest first | Mission visibility |

- **Updates strip** on the mission page, above the file tabs: a short list of update cards (type, seat, note, evidence chips, round). Not a chat.
- The send-back and verify dialogs become one **Send update** dialog with the four types.
- The Business user sees the same dialog phrased in their terms: "It works", "Partly", "It's not what I asked", "I can't check".
- **Impact page** (CP14C) counts rework rounds and time per round, using `mission.update` events.

---

## Part C: Contributors and custom flows (not built)

Recorded here so it's clear the design covers it. The role picker says "more customization is coming soon".

- **Contributors inside a seat.** A seat is the accountable role, and several people can add to its file. QA adds acceptance criteria and edge cases to the Product file. Security and architecture add sections to the Engineering design. Each contribution carries a tag (Security, QA, Architecture), shown next to the section. NoX asks the right contributor when a section is thin.
- **QA and Security as tags, not seats.** `UPCOMING_ROLES` in `apps/web/lib/app/roles.ts` still lists QA and Security & Compliance as future seats. They would move to contributor tags when this ships.
- **A flow each organization can shape.** A small change skips Product. A risky one adds a Security review or a change board. Seats become participants that rules pull in.
- **Why not now.** All three change the access matrix and the mission stage model, which the whole app depends on. With the 2026-10-18 deadline, the risk outweighs the demo value.

---

## Files touched

| Area | Files |
| --- | --- |
| API | `missions/verification.py` (verdict, evidence, parse/write), `routers/missions.py` (`verify_file`, verification PUT, updates routes, `mission_completed` pre-collect job), new `missions/updates.py`, new `ai/agents/evidence_check.py` |
| Data | Alembic `0009_mission_updates.py`, `db/models.py` |
| Web | `components/app/verify-panel.tsx`, new `components/app/updates-strip.tsx`, `missions/[key]/page.tsx`, `lib/app/api.ts` |
| Docs | `apps/web/content/docs/` verification page, `docs/DEMO_SCRIPT.md` (one rework round in the demo) |

## Done when

- [ ] An item can be marked Verified, Failed or Can't verify, and evidence of each type can be attached.
- [ ] A seat can't mark itself Verified while any item is Failed or unsettled.
- [ ] Verdicts and evidence appear in the Markdown file and survive a Git sync round trip.
- [ ] Old checklists (ticks and notes only) load and verify as before.
- [ ] Marking a mission completed pre-attaches the PR and CI results.
- [ ] The advisory check shows a hint per item and never changes a verdict.
- [ ] A Partially works or Needs rework update reopens the target seat with only the failing items, and the round counter increases.
- [ ] Updates appear on the timeline, in Jira and on the Impact page.
- [ ] The Business user can send an update in their own words and attach a screenshot or recording.
- [ ] The role picker shows the "more customization coming soon" note.
- [ ] `make test` and `make lint` pass, with tests for the verdict rules, the file round trip and the update permissions.
