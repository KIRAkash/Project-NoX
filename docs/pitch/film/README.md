# The NoX film

A 90-second film for the AI Builder Cup submission, made as code. The finished files are
[`../nox-film.mp4`](../nox-film.mp4) (music and sound design) and
[`../nox-film-narrated.mp4`](../nox-film-narrated.mp4) (the same cut with a voice-over), both
1920×1080 at 30 fps. The poster frame is [`../nox-film-poster.jpg`](../nox-film-poster.jpg).

## The story

| Time | Scene | What it shows |
| --- | --- | --- |
| 0:00 | One sentence | A business user types *"Customers keep emailing support for invoices. Can they just download them?"* The sentence becomes a capsule of light. |
| 0:06 | Lost in translation | The capsule passes from person to person (*"INV-88: add PDF export."*, *"New PDF service?"*, *"Email every invoice as a PDF, nightly."*) and the sentence scrambles into *"Ticket closed."* The intent meter drains. *What shipped ≠ what was meant.* |
| 0:16 | AI everywhere | Four private AI chats; the links between them snap. Everything collapses into one point of light. |
| 0:23 | Meet NoX | The point ignites into the NoX sun, with a shockwave, god rays and a lens flare. N and X slide out. Atlas and Missions. |
| 0:30 | Atlas | A living, deeply interconnected map of the enterprise: Apex Holdings as a 3D orbital system with glowing contract arcs. The camera dives into billing-service, where sources stream in and NoX Shield blocks a planted runbook. Then the team of Gemini agents, a page in Google Cloud's Open Knowledge Format for the invoices API, and the 8.7× faster build. |
| 0:42 | Missions | Every role on one 3D trajectory, with the role picker's "More coming soon" planet waiting beside it; a comet carries the change along it. |
| 0:46 | The spec book | One mission is one book. Each role writes its own page while NoX writes beside them: two live cursors, the person's and NoX's. The business user states the problem; the product owner adds the prorated-invoice edge case; the engineering lead's page carries a map from the Atlas (reuse the receipts PDF renderer, keep reporting's invoice-totals contract); the developer writes the build spec. A person signs each page, it locks and turns. The business user and the product owner pin screenshots to their pages. NoX drafts from the Atlas and every line cites it. The path lists the roles, with more roles coming soon. |
| 1:04 | Build | The book closes, signed by every role, and shrinks to the centre. The Atlas feeds it, and every coding agent (Antigravity, Claude Code, Cursor, Codex, Copilot, Gemini CLI) is wired to it. A copy flies to Antigravity, which opens: `/nox NOX-1`. |
| 1:10 | Verify in reverse | The comet returns through the same people; one send-back (*"Prorated invoices missing."*); then *"My sentence is now true."* Jira moves to Done. |
| 1:18 | Platform and trust | Shield, Show NoX, MCP + A2A, NoX Local, hybrid search, Impact; the trust principles. |
| 1:26 | Close | *Every role. One book. One sentence, all the way to code and back.* The sun returns with the wordmark. |

The example is the worked one in [`docs/00-product-narrative-and-landing-journey.md`](../../00-product-narrative-and-landing-journey.md):
self-serve invoice PDFs, mission NOX-1 on billing-service. The numbers are the ones in the product docs.

## How it is made

- **Picture.** [`index.html`](index.html) holds the UI layer and [`js/`](js/) the scenes. A WebGL layer
  ([`js/world.js`](js/world.js), three.js) draws a quiet, slowly drifting star field, the plasma
  sun with corona, shockwave, god rays and lens flare, and a screen-space particle layer for comets, streams and
  sparks, all through bloom. [`js/gl3d.js`](js/gl3d.js) makes the shaded planets with atmospheres and the glowing
  tubes used for orbits and contract arcs. Type is animated with GSAP's SplitText, ScrambleText and DrawSVG on one
  master timeline. Colours, fonts and the planet characters match the web app, including the role picker's hover animations and its "More coming soon" placeholder.
- **Deterministic frames.** `window.renderFrame(t)` seeks the timeline, reseeds `Math.random` for that frame and
  renders, so any frame can be rendered alone and in any order. [`render.mjs`](render.mjs) drives headless
  Chromium with Playwright across several pages in parallel. Frames inside a motion-blur zone (fast camera moves,
  whip pans, the ignition) are the average of up to 8 subframes across a 180° shutter.
- **Sound.** [`score.py`](score.py) is a cinematic hybrid. A felt piano carries the motif, a spiccato cello and
  contrabass drive the groove, low strings hold the harmony, and low brass and horn land the reveals; these parts are
  written as MIDI and played through FluidSynth on the MuseScore General soundfont. Taiko, shime, frame drum, shakers,
  the sub and every sound effect (mechanical keys for people, a graphite scratch for NoX, page turns, a rubber stamp
  for each signature) are synthesized, processed with Spotify's pedalboard, and mastered to -14 LUFS. Act I is in
  D minor (the piano motif detunes a little at each telephone hop); Act II drops into D major at 120 BPM; Act III
  lifts to E major and closes on the opening motif in major. Effects are placed from the cue list the timeline
  exports (`cues.json`).
- **Voice.** [`narrate.py`](narrate.py) speaks the script with Kokoro, an open neural TTS model, fitting each line
  into its slot; [`mix_narrated.py`](mix_narrated.py) ducks the score under the voice.
- **Finish.** `build.sh` grades the frames (a soft glow on highlights and fine luma grain) and encodes H.264.

## Rebuild

```bash
sudo apt install fluidsynth musescore-general-soundfont-lossless ffmpeg
pip install -r docs/pitch/film/requirements.txt
docs/pitch/film/build.sh          # about an hour on 4 cores; WORKERS=8 to use more, NARRATION=0 to skip the voice
```

To check a few frames while editing: `node render.mjs stills 12,47.5,76.3` writes PNGs to `stills/`
(motion blur included). To preview in a browser, serve this folder after `build.sh` has copied the assets and open
`index.html#42` to start at 0:42.
