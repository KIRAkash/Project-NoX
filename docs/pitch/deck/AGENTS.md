# NoX pitch deck: instructions for the next agent

The AI Builder Cup pitch PDF, written as one HTML page and exported with headless Chromium.

- Source: `index.html` (all 19 pages, all CSS inline)
- Output: `../nox-pitch-2026.pdf`
- Images: `img/` (product screenshots, team photos, Cup banner, `img/logos/` coding-agent logos)
- Exporter: `export.mjs` (uses the Playwright install in `../film/node_modules`; run `npm i` there if missing)

```bash
node docs/pitch/deck/export.mjs pdf          # writes docs/pitch/nox-pitch-2026.pdf
node docs/pitch/deck/export.mjs png 3,9      # writes stills/03.png, stills/09.png to check pages
```

Always render the pages you changed to PNG and look at them before exporting the PDF. `stills/` is ignored by Git.

No italics anywhere: highlighted words in headings are gold, upright, same weight (`h2 em`). Colour is the only distinction.

## Page order

Each page is a `<section class="slide" data-n="N">`, preceded by a comment `<!-- ==== NN NAME -->`.

| # | Page | Status |
|---|---|---|
| 1 | Team: Cup banner, project, category, AstroRangers card (Akash Bajpai, SDE 3, Walmart Global Tech, Mission Commander / Team Leader; Kritika Singh, SDE, Lowe's India, Flight Director) | approved |
| 2 | Context as a hub: “In any / Enterprise” large in the centre inside one dashed orbit, with three dotted gold spokes to three pictures. Each has a number, a 34px heading (① and ② on two even lines, ③ on one line) and one short line. ① a small galaxy: three tilted orbits, seven Tidewell apps as planets in their team colours, each labelled. ② a comet through customer-portal → claims-intake → notifications-hub. ③ “Requirements are scattered.” (not “Its…”, so it reads on its own): four notes around a dashed “?” (Jira TW-2214, Slack #tw-claims, Confluence policy, someone’s head). The dark strip sits at the very bottom of the page (about 20px gap). Keep it calm: the user rejected a busy full-estate scene | approved |
| 3 | Problem: "Knowledge lives across many connected systems." Agent sees one repo (other sources greyed); can't see what it breaks | approved |
| 4 | Problem: "The intent gets lost, and is never verified." Slack answer never reaches the ticket; tasks checked, intent never | approved |
| 5 | Cover: N●X wordmark in a small solar system, tagline, links | links are placeholders |
| 6 | Meet NoX: Atlas on top, Missions below | approved |
| 7 | Atlas: real screenshot of the blast-radius map | approved |
| 8 | Inside the build: ingest and screen → full Google ADK workflow graph (light card, Gemini logo under its heading) → check and publish | approved |
| 9 | Built on top of NoX Atlas: six features around the Atlas logo. For your agents: /nox skill, MCP server (10 tools), A2A agent. For you: web app, nox CLI, NoX Local (Gemma 4). Plain product names, no fancy names | new |
| 10 | Meet NoX Missions: Missions logo (126px) centred above a 48px heading. Start a mission: a compact copy of the real "What would you like to change?" box (type, Or just say it, Show NoX buttons, attachments, app guess) with numbered callouts; no Sighting here → four seats write the spec in order, then /nox build, verified in reverse, the real stage track, four rules → Done when every requirement is verified (send back, Git, Jira). Replaces the old Show NoX page | new |
| 11 | Spec book: closed cover with four A4 spec pages fanned over it | approved |
| 12 | One line in, a grounded spec out; Refine / Chat / Context | approved |
| 13 | Build: book wired to six coding agents, Antigravity with `/nox` MCP calls | approved |
| 14 | Verify loop: "Done means every requirement is verified." Each seat checks its own file's checklist in reverse, with evidence. Never "the person who asked says yes" | approved |
| 15 | Sightings: a big “Sightings” wordmark (i-dots are gold and violet sparkles) over the NoX Missions logo at the same width, heading beside it. Left: the sighting card (Impact: High, Effort: Low, kind) on a pile of four. Right: four role scouts (business, product, engineering, developer, with what each may read) merge into the NoX sun (merge · score per role), then fan out to four planets, each with a stack of placeholder cards. Sightings stays a Missions feature, not a separate product | approved |
| 16 | Impact: operating-gap table, each row with a coloured icon. No footer numbers (the $0.08 and 65% had no proof) | approved |
| 17 | Built on Google: every product tile has a 32px logo. Antigravity and Gemini use their own logos; Firestore and Firebase Auth use Firebase; ADK, Memory Bank, OKF and the 11 Cloud services use Google Cloud; Jules and Gemma use the Google G. Firebase, Google Cloud and Google come from SVGs in `img/logos/src/`, flattened to white JPGs by `node logo-flatten.mjs` (logos must have no transparency). The big number is the tile count (23). No agent count | approved |
| 18 | Future scope: "Two products today. A bigger NoX, coming soon." Top: a solar system. The NoX sun with Atlas and Missions (their real lockups) on the inner orbit, labelled Today. Three small new planets with smooth tapered trails (opaque gradient fill, no stepped strokes) on a dashed outer orbit (Next); the notes sit close to their planets, following the orbit, each joined by a dotted leader to a row: its own lockup (44px) with the tagline below, a thin vertical divider, then two or three lines of text. The lockup is (N●X + name with a small mark): NoX Comms (green, signal arcs; Slack, Teams and email, warns everyone a change touches, gets acceptance, brings them into the spec), NoX Orbit (rose, ring round the O; after launch, Orbit and Responder merged on purpose), NoX Sunset (ember, setting sun; unused APIs, events and code). No "builds on" lines (the user removed them). Bottom: "Growing Atlas and Missions", four cards each with a small drawing and a tag: More connectors and Roles and team templates (coming soon), Approval policies and SLAs (remind, delegate, escalate) and Permission-aware knowledge (each person sees only what the source tool allows), both next. Runtime-aware Atlas and Simulate before approving were cut by the user. No invented numbers in the drawings. | new |
| 19 | Close: clean, no team details. "Thank you." with the NoX sun as the o in "you", one line just below it to judges ("Thank you for reading. We’d love you to try NoX live.", signed “— AstroRangers” on the line below), and three dashed link slots: Live app, Film, Code | links are placeholders |

Top band: `.hackathon-bar` crops `img/hackathon-banner.png` to 56px tall in CSS (`object-fit: cover`, centred), and slides that have it use 8px top padding so it sits close to the top edge.

Per-page spacing rules sit in the head under `/* spacing after the slimmer top band */` (extra padding around the heading on pages 3, 4, 9, 11–14 and 16, and the top gap on page 7). Page 6 spreads its two bands with inline margins.

Page titles: only pages 2, 3, 4, 6, 11, 12, 16 and 18 have a title above the heading (`.ttl`, centred, heading font in the muted grey, regular weight 400, 28px, so it labels the page without competing with the heading). Every other page has an empty `<div></div>` in `.top` so the N●X mark stays on the right. No page numbers in the top bar. Page 5 keeps its Cup line.

The footer is hidden by the user (`.foot { display: none }` in the head); leave it. The footer trajectory is drawn by the script at the bottom of `index.html`. If you add or remove pages, update `TOTAL` and the `ACTS` ranges there, and renumber `data-n` and the section comments.

## What the user wants (feedback so far)

- A judge spends about 30 seconds on the whole deck. Each page: one heading that states the point on its own, one visual, very little text. Plain words, not literary ones.
- Prefer diagrams, arrows, steps and mock UIs over paragraphs and dense screenshots.
- Light parchment theme from the website, with the space vocabulary: sun, planets, orbits, comet, the spec book. Seat colours: business gold, product violet, engineering teal, developer blue. NoX's writing is highlighted in gold.
- Target is 14–16 pages. The deck is 19 now: Trust, Architecture + proof and the old Close were deleted on 2026-10-17, then Future scope and a new Close were added as pages 18–19 (act "Next orbits").
- Open items: real live-app URL and film link (page 5 and page 19).

## Hard rules

- **No `box-shadow`, and no gradient or image with transparency.** Chrome writes those as soft-masked images, and some PDF viewers draw them as grey or orange boxes. A global rule in the head forces `box-shadow: none`. Make every gradient opaque by pre-blending with the paper colour `#faf7f5`, and flatten any transparent PNG onto white (as `img/*.jpg`). After each export, check that the count is still zero:
  ```bash
  python3 -c "import re;d=open('docs/pitch/nox-pitch-2026.pdf','rb').read();print(len(re.findall(rb'/SMask',d)))"
  ```
- Only real numbers, each with a source chip: 41% and £6.80 come from Tidewell's `TWDIG/digital-claims-review-q3`; 8.7×, 29 s vs 252 s and 12 vs 19 calls come from `scripts/bench_kb.py` in the docs. Never invent metrics.
- Names come from the real Tidewell demo (`demo/tidewell/`): `claims-management`, `customer-portal`, `GET /v1/claims/{id}`, `claims.handler.assigned`, ADR-0002. Tool names come from `apps/api/nox_api/ai/tools/` and `interop/mcp_server.py`.
- Write the product name as NoX, and the team as AstroRangers (no space). Present Google Antigravity as the build environment. Don't mention Claude Code as a build tool (it may appear only as one supported coding agent).
- Don't overwrite `../Nox-AI-Builder-Cup-2026.pdf`. It is the old tracked deck, and macOS treats `NoX-` and `Nox-` as the same filename.
