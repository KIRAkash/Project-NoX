# The NoX film

A 90-second motion film for the AI Builder Cup submission. The finished file is
[`../nox-film.mp4`](../nox-film.mp4) (1920×1080, 30 fps, with sound); the poster frame is
[`../nox-film-poster.jpg`](../nox-film-poster.jpg).

## The story

| Time | Scene | What it shows |
| --- | --- | --- |
| 0:00 | One sentence | A business user types *"Lock an account for 15 minutes after 5 failed password attempts."* |
| 0:06 | Lost in translation | The sentence passes through four seats and decays into *"Ticket closed."* What shipped ≠ what was meant. |
| 0:16 | AI everywhere | Four private AI chats, no shared context. Context rebuilt, wikis drift, nobody verifies intent. |
| 0:23 | Meet NoX | Ignition. *From a business sentence to verified, shipped code.* Atlas (the map) and Missions (the journey). |
| 0:30 | Atlas | Apex Holdings as an orbital map with its contracts; sources become a code wiki (NoX Shield withholds a planted runbook); the trajectory to *In Orbit*; the ADK agent team, an OKF page, and the 8.7× faster build. |
| 0:42 | Missions | Four seats on one trajectory. |
| 0:46 | Business user | NoX drafts `01-business.md` in plain words. The person approves. |
| 0:52 | Product owner | Acceptance criteria, an edge case the owner adds, a cited metric, a Jira ticket. |
| 0:58 | Engineering lead | The blast radius on the contract map; Ask answers who calls the login endpoint. |
| 1:04 | Developer | `/nox NOX-1` in Google Antigravity: context, edits, tests, PR, guard. Works in any coding agent. |
| 1:10 | Verify in reverse | Developer, engineering lead, product owner (one send-back), then the business user: *"My sentence is now true."* Jira moves to Done. |
| 1:18 | Platform | Shield, Show NoX, MCP + A2A, NoX Local, hybrid search, Impact, on Gemini, ADK, Gemma, Cloud Run and OKF. Then the trust principles. |
| 1:26 | Close | *Four people. Four files. One sentence, all the way to code and back.* |

The demo content follows [`docs/DEMO_SCRIPT.md`](../../DEMO_SCRIPT.md) and the pitch deck: mission NOX-1 on
mini-auth-service in the Apex demo org. The benchmark numbers are the ones in the product docs.

## How it is made

- [`index.html`](index.html) is the whole film: one GSAP master timeline plus a canvas star field. It is a pure
  function of time, `window.renderFrame(t)`, so frames render in any order. Open it through any static server to
  preview it live in a browser (append `#42` to start at 0:42). Colours, fonts and the planet characters match
  the web app (`apps/web/lib/app/roles.ts`, `components/app/planet-character.tsx`).
- [`render.mjs`](render.mjs) drives headless Chromium with Playwright, seeks each frame, and pipes JPEG frames
  into ffmpeg from several pages in parallel. It also writes `cues.json`, the sound cues the timeline declares.
- [`soundtrack.py`](soundtrack.py) synthesizes the music and sound effects with numpy, synced to `cues.json`:
  a D-minor bed for the problem, a riser into the ignition, a 120 BPM D-major build, and typing, whooshes,
  bells and impacts at the cue times.

## Rebuild

Needs Node 18+, Playwright with Chromium, Python 3 with numpy and scipy, and ffmpeg.

```bash
docs/pitch/film/build.sh          # about 4 minutes on 4 cores; WORKERS=8 to use more
```

To check a few frames while editing: `node render.mjs stills 12,47.5,76.3` writes PNGs to `stills/`.
