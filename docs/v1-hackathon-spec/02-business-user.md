# Business user

The Business user starts every request with one sentence and ends it by confirming, in their own words, that it came true. They never see ticket fields, contracts or code unless they choose to.

**Planet:** small, warm gold, `#E8C97A`. **Stage owned:** Signal, then the final Verify step. **Primary action on home:** "Ask for a change".

## Mission control

This is the simplest home in the app. It uses plain-language labels only.

| Panel | Shows | Example |
| --- | --- | --- |
| Ask for a change | One large text box: "What should be different?" | — |
| Needs your confirmation | Requests back from verification, waiting on "Is this now true?" | NOX-098 · "Show risk review status in the portal" |
| Your requests | Everything they started, with a plain status line | "With the product owner", "Being built", "Checking it works" |
| Done | Requests they confirmed, with the date | NOX-091 · confirmed 12 Sep |

The orbit arc is shown, but the stage names are relabelled for this seat: Asked → Defined → Designed → Built → Checked.

## Creating a new request

1. **Write the sentence.** A single box, no required fields. Placeholder: "Customers keep asking where their refund is. Can we show them it's on its way?" An optional toggle picks the type: something new / something broken / a change.
2. **NoX drafts the checklist.** This is the co-authoring animation from the landing page. The user's line stays at the top, and NoX's cursor writes beneath it:
   - **What should change**: 2–4 plain bullets
   - **What "done" looks like**: one observable outcome ("Refund-status tickets drop")
   - **Who it affects**: customers, support, finance
   - **Where this lives**: the applications NoX matched, in plain names ("the customer portal, the refunds system and customer emails")
3. **Edit in place.** Any bullet can be rewritten, removed or added to. NoX's lines are tinted gold. The user's edits turn white.
4. **Add a picture (optional).** They can drop in a screenshot or photo, like the image beat in the landing animation. NoX adds a one-line caption describing what it shows.
5. **Approve and send.** "This is what I mean → Send to Product owner". The checklist freezes and a packet animates to the Product owner's planet. A toast says "Sent. You'll hear back when it's ready to check."

The sentence stays editable until approval. After that, it's permanent.

## Tracking requests

- The Requests page uses the table view by default, with columns Request · Where it is (plain words) · Who has it · Last update.
- Opening a request shows the sentence, the frozen checklist, and a friendly timeline ("Priya defined it · 2h ago"). Later artifacts (spec, design, brief) appear as collapsed cards labelled "Technical details". They can open them, read-only.
- Commenting is allowed on any artifact.

## Final verification (reverse, last step)

This is the moment the demo builds toward.

- Full-width card with the **original sentence** in large serif quotes.
- Under it: "Here's what changed", a short plain-language summary NoX writes from the product verification, and a before/after screenshot if one exists.
- The Business checklist appears again, each line pre-ticked with evidence ("Refund status now shows on the portal, \[see screenshot\]").
- Two buttons: **Yes, this is what I asked for** · **Not quite**.
  - Yes: the request moves to Done. The orbit arc closes into a full ring with a short glow, and the event is recorded.
  - Not quite: needs a one-line reason, and the request returns to the Product owner at Definition.
- A follow-up option: "Watch the metric for 2 weeks". This adds a reminder chip to the Done request. It's display-only in the POC.

## Atlas, from this seat

A simplified view: each application as a planet card with its plain summary and "what it's for". No contracts, guardrails or dependencies. Clicking an app shows the requests that touch it. A toggle "Show technical view" is available but off by default.

## What the Business user cannot do

Write specs, set priority, change applications touched, open the agent workspace, or approve any stage other than their own.
