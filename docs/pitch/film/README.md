# The NoX film

A 90-second film for the AI Builder Cup submission, made as code. The finished files are
[`../nox-film.mp4`](../nox-film.mp4) (music and sound design) and
[`../nox-film-narrated.mp4`](../nox-film-narrated.mp4) (the same cut with a voice-over), both
1920×1080 at 30 fps. The poster frame is [`../nox-film-poster.jpg`](../nox-film-poster.jpg).

## The story

| Time | Scene | What it shows |
| --- | --- | --- |
| 0:00 | One sentence | A business user types *"Lock an account for 15 minutes after 5 failed password attempts."* The sentence becomes a capsule of light. |
| 0:06 | Lost in translation | The capsule passes through four seats and the sentence scrambles into *"Ticket closed."* The intent meter drains and the nebula turns red. *What shipped ≠ what was meant.* |
| 0:16 | AI everywhere | Four private AI chats; the links between them snap. Everything collapses into one point of light. |
| 0:23 | Meet NoX | The point ignites into the NoX sun, with a shockwave, god rays and a lens flare. N and X slide out. Atlas and Missions. |
| 0:30 | Atlas | Apex Holdings as a 3D orbital system with glowing contract arcs. The camera dives into mini-auth-service, where sources stream in and NoX Shield blocks a planted runbook. Then the ADK agent team, an OKF page, and the 8.7× faster build. |
| 0:42 | Missions | Four seats on one 3D trajectory; a comet carries the change along it. |
| 0:46 | The four seats | Business user, product owner, engineering lead and developer each write their file with NoX as co-author, and a person approves it. `/nox NOX-1` in Google Antigravity. |
| 1:10 | Verify in reverse | The comet returns through the same people; one send-back; then *"My sentence is now true."* Jira moves to Done. |
| 1:18 | Platform and trust | Shield, Show NoX, MCP + A2A, NoX Local, hybrid search, Impact; the trust principles. |
| 1:26 | Close | *Four people. Four files. One sentence, all the way to code and back.* The sun returns with the wordmark. |

The content follows [`docs/DEMO_SCRIPT.md`](../../DEMO_SCRIPT.md) and the pitch deck: mission NOX-1 on
mini-auth-service in the Apex demo org. The numbers are the ones in the product docs.

## How it is made

- **Picture.** [`index.html`](index.html) holds the UI layer and [`js/`](js/) the scenes. A WebGL layer
  ([`js/world.js`](js/world.js), three.js) draws a domain-warped nebula, a 3D star field, bokeh dust, the plasma
  sun with corona, shockwave, god rays and lens flare, and a screen-space particle layer for comets, streams and
  sparks, all through bloom. [`js/gl3d.js`](js/gl3d.js) makes the shaded planets with atmospheres and the glowing
  tubes used for orbits and contract arcs. Type is animated with GSAP's SplitText, ScrambleText and DrawSVG on one
  master timeline. Colours, fonts and the planet characters match the web app.
- **Deterministic frames.** `window.renderFrame(t)` seeks the timeline, reseeds `Math.random` for that frame and
  renders, so any frame can be rendered alone and in any order. [`render.mjs`](render.mjs) drives headless
  Chromium with Playwright across several pages in parallel. Frames inside a motion-blur zone (fast camera moves,
  whip pans, the ignition) are the average of up to 8 subframes across a 180° shutter.
- **Sound.** [`score.py`](score.py) writes the orchestral parts as MIDI and plays them through FluidSynth on the
  MuseScore General soundfont (piano, strings, cello, choir, brass, horn, pizzicato, celesta, timpani), synthesizes
  drums, sub bass, supersaws, a braam, risers and every sound effect, processes them with Spotify's pedalboard, and
  masters to -14 LUFS. Act I is in D minor (the piano motif detunes a little at each telephone hop); Act II drops
  into D major at 120 BPM; Act III lifts to E major and closes on the opening motif in major. Effects are placed
  from the cue list the timeline exports (`cues.json`).
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
