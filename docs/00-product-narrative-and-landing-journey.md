# NoX — Product Narrative & Landing Page Journey

Sep 23, 2026 · @Someone

NoX keeps one living map of everything an enterprise builds: every application, what it depends on, who owns it. Every change starts as a single sentence from whoever wants it — and NoX carries that sentence, and its original intent, through every person who has to act on it before it ships, then back through everyone who has to confirm it actually happened.

## Two things, in order

First NoX maintains the map. Second, it uses the map. Everything else in this doc is the second part.

**The map.** NoX continuously reads the enterprise's code, docs, and tickets into one interconnected knowledge base — which applications exist, what each owns, what it depends on, what breaks if it changes. Not a wiki someone has to remember to update: a live index, checked against the code on every push.

**The use.** That map is the shared context every person in a change request would otherwise rebuild from scratch — in a meeting, in a doc nobody reads, in a Slack thread that gets lost. NoX hands each person the slice of the map their role needs, in their own language, at the moment they need it.

## The forward journey

One sentence becomes three role-specific artifacts, each building on the last — nobody works from a translation of what the last person said.

1. **Business user** writes one sentence, in plain language. NoX turns it into a short checklist back in that same language: what should change, what "done" looks like — no jargon, no ticket fields.
2. **Product owner** inherits the checklist, not the raw sentence. Defines the end goal and what "verified" means from a product standpoint: acceptance criteria, edge cases, the metric that proves it worked.
3. **Developer** inherits both artifacts, plus a technical brief NoX writes straight from the map: which services this actually touches, what already exists, what would break. Everything they'd otherwise spend a day finding.
4. **Coding agent** is where NoX stops handing off documents and starts working alongside the developer — as an agent or a skill inside their own tools. It grounds the agent in two things at once: everything this requirement has accumulated so far, and the live code wiki for whatever the change actually touches, so it starts with real context instead of a cold repo.

## The reverse journey

Once the change ships, verification runs back the way the request came — same three people, opposite direction.

1. **Developer** checks the diff against the technical scope: does the code do what was specified.
2. **Product owner** checks the result against their acceptance criteria: does it meet the goal, not just the ticket.
3. **Business user** checks it against their own original sentence, in their own words: is the thing they actually asked for now true.

Nobody signs off on a translation of what they meant. Everybody signs off on what they meant.

## Worked example

One sentence, seven artifacts.

> "Customers keep emailing support asking for their invoice as a PDF — can we just let them download it themselves?"

**1. Business checklist** (NoX's translation, confirmed by the business user)

- [ ] Customer can download a PDF of any past invoice
- [ ] Works without contacting support
- [ ] Covers one-time and subscription invoices
- [ ] Done = invoice-related tickets drop

**2. Product spec** (product owner)

- Goal: self-serve invoice PDFs from the billing history view
- AC: tax breakdown included; available same day the invoice is issued; works for one-time and subscription billing
- Edge case caught from the map, not the original ask: prorated invoices need a "partial period" line
- Metric: invoice-related support tickets, week over week

**3. Technical brief** (developer, generated from the map)

- Billing Service already stores line items and totals
- Receipts feature already has a PDF renderer — reuse it, don't rebuild it
- New: `GET /invoices/:id/pdf`; Customer Portal gets a Download button
- Contracts touched: Billing Service, Customer Portal — Reporting reads invoice totals too, flagged so it doesn't break

**4. Agent scope** — the developer hands all three artifacts to their coding agent. The agent already has NoX's map, so it knows the Receipts renderer exists before anyone tells it, and knows Reporting depends on invoice totals before it touches them.

Then, in reverse:

**5. Developer checklist** — endpoint returns a valid PDF, existing renderer reused not duplicated, Reporting's contract untouched, tests pass.

**6. Product owner checklist** — tax breakdown present, both invoice types covered, prorated case handled.

**7. Business user checklist** — "Can a customer get their invoice as a PDF without emailing us?" Yes. Ticket volume watched for two weeks.

## Landing page section design

One continuous scroll section, minimal text, mostly diagram — a closed loop, not a funnel. None of the earlier landing page's charts, card grids, or document-viewer panels carry over; one shape replaces all of them.

**Shape.** The journey is a loop, not a pipeline, so it's drawn as one — the same orbital motif already established in the hero, not a new metaphor. A single elliptical path with four stops: Business, Product, Developer + Agent, and a "Shipped" marker at the far point. One packet travels the top arc forward (the request); a second travels the bottom arc back (the verification) — rhyming with the contract-line packets already in the hero.

**Text budget.** "Minimal" describes the page's own copy, not the artifacts it shows — one caption per stop, 3–6 words, no paragraphs of explanation around them. The artifacts themselves should look substantial: a spec with headings, sub-points, and an image, not a 2–4-line checklist that reads as something the visitor could've written in the time it took the page to load.

**Artifact previews — co-authored, not generated.** Each stop plays out as two cursors writing the same document: the visitor's own (a short line, plain language) and NoX's (expanding it into headings, sub-points, and prose, in the same pass). The visitor's cursor returns to drop in an image — a placeholder is enough, it only has to read as "an image landed here" — and NoX's cursor annotates what it shows. The visitor's cursor clicks Approve; the document freezes and the card compresses into its finished state. Watching it get built, not reading a finished checklist, is what makes the contribution legible — a static two-line list would read as something the visitor could've typed themselves.

**Interaction.** Scroll-scrub or hover advances the packet along the path; the active stop's card comes forward, the rest recede — the same focus-and-neighbours pattern already built for the hero's planet hover, reused as interaction language rather than new visual content.

**Tabs, and what carries over.** Business / Product / Developer sit as tabs above the card. Switching tabs replays the same co-authoring sequence for that persona's own document — but the previous persona's now-frozen artifact stays visible, collapsed to a reference card, so the continuity of the chain is what a visitor actually sees, not just each stage in isolation.

## Technical approach

GSAP, not a new library or a pre-rendered animation — this scene is a 2D DOM sequence, not a 3D one, and the project already carries what it needs: `ScrollTrigger` to fire the first play-through once the section scrolls into view, `MotionPathPlugin` (already registered in `lib/motion.ts`) to move the two cursors along a curved path rather than snapping between points, and GSAP timelines to sequence type-in, the image drop, the annotation, and the approve/freeze beat.

**Real text, not baked-in animation.** Each persona's sequence is data — an ordered list of beats (`{author: "user" | "nox", type: "text" | "image" | "approve", content}`) in `lib/content.ts`, the same place `STAGES` and the worked example above would live — not a Lottie or Rive file. Real DOM text stays copyable, accessible, and editable later without re-exporting an animation asset.

**Typing itself** can lean on GSAP's `TextPlugin` for a straightforward reveal, or `SplitText` (free in recent GSAP versions — worth confirming against the installed one) for true character-by-character control; a hand-rolled span-per-character stagger is the fallback if neither fits.

**Two playback triggers, not one.** The first persona's sequence plays once on scroll-into-view (`ScrollTrigger`, `once: true`), matching how the rest of the page already reveals on scroll. Every tab switch after that is click-triggered, not scroll-scrubbed — jumping personas is a deliberate choice, not something to scrub past.

**Reduced motion.** `prefersReducedMotion()` already exists in `lib/motion.ts` — this sequence should honor it by skipping straight to each artifact's finished, frozen state, still tab-switchable, never trying to compress the typing animation instead of cutting it.
