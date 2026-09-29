# NoX web

The Next.js app: today the landing page, and from CP3 onward the NoX product (login, role picker, Atlas, Missions).

## What the page argues

| Section | Claim |
| --- | --- |
| Hero | The estate is a system with a centre, and NoX sits at it. |
| 01 The problem | Context is not lost in the work, it is lost between the work. |
| 02 The atlas | NoX already knows your system — and six compiler rules say why that map can be trusted. |
| 03 The lifecycle | One change, five stages, each drafted against the atlas before a human reads it. |
| 04 The return | The delivered change is judged against the original sentence, not the ticket it became. |
| 05 Ground stations | Jira, Confluence, GitHub, Slack and Notion keep working. |
| 06 Agent downlink | The `nox` skill gives a coding agent the cross-application map. |

## Running it

```bash
npm install
npm run dev:web   # from the repo root
```

Then open http://localhost:3000.

## Stack

- **Next.js 15** (App Router) and **React 19**
- **GSAP 3** with `ScrollTrigger` and `MotionPathPlugin`, driven through `@gsap/react`'s `useGSAP`
- **Tailwind CSS 3** for layout; design tokens live in `tailwind.config.ts`
- `next/font` for Instrument Serif, Manrope and IBM Plex Mono — no webfont request at runtime

## Layout

```
apps/web/app/
  layout.tsx          fonts, metadata, <body>
  page.tsx            section order
  globals.css         tokens, starfield, reduced-motion and no-JS fallbacks
components/landing/
  primitives.tsx      Section, SectionHead, Accent, buttons, icons
  nav.tsx             transparent over the hero, gains its rule on scroll
  hero.tsx            staggered entrance
  orbital-system.tsx  the signature diagram (see below)
  handoff-decay.tsx   the fidelity bars that shrink across five columns
  atlas.tsx           interactive application browser + compiler rules
  lifecycle.tsx       the pinned, scroll-driven five-stage journey
  verification.tsx    provenance chain + verification report
  ground-stations.tsx integrations
  agent-downlink.tsx  terminal session
  cta.tsx / footer.tsx
lib/
  content.ts          every string and every data structure the page renders
  motion.ts           GSAP registration, the reveal hook, reduced-motion guard
```

### The orbital system

Applications sit on three tilted ellipses around NoX at `(380, 380)` in a `760×760` viewBox.
Coordinates are baked into `lib/content.ts` rather than computed, so nodes can be nudged for
balance without recomputing an ellipse parameter.

Two things worth keeping if you refactor it:

- **Rings travel by `strokeDashoffset`, never by rotation.** Rotating an ellipse about its own
  centre makes its silhouette visibly wobble.
- **The comet rides a real `<path>`** (`#comet-track`) inside the same tilted `<g>`, so
  `MotionPathPlugin` works in that group's local coordinate space.

### The lifecycle journey

`lifecycle.tsx` pins its panel for `RUNWAY` pixels of scroll and derives the active stage from
`ScrollTrigger` progress, while the probe travels the trajectory path. Pinning is wrapped in
`gsap.matchMedia("(min-width: 1024px)")` — below that the stage buttons are simply tappable,
because a tall pinned panel traps a phone reader.

### Motion contract

Everything is guarded two ways:

- `prefers-reduced-motion: reduce` skips every animation and leaves the final state.
- Elements are only hidden up front once `.js-ready` lands on `<html>`, so a JS-less or errored
  page still renders all of its content.

## Content placeholders

The footer carries `[YOUR CONTACT EMAIL]` and `[YOUR COMPANY ADDRESS]`. The application names,
change request CR-2291 and the file paths in the terminal are an illustrative estate — replace
them with a real one before the page goes public.
