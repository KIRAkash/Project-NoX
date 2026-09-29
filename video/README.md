# NoX intro film

A 90-second, 1920×1080, 30 fps motion-design intro for NoX, made with [Remotion](https://www.remotion.dev).
It uses the landing page's space theme: the void palette, the star and its orbiting estate, the
N☉X wordmark, and the same three typefaces. It opens with the problem and then walks through the
features.

| Time | Scene | What it shows |
| --- | --- | --- |
| 0:00 | Cold open | Every change starts as one sentence. The business user's request arrives. |
| 0:05 | Signal decay | The sentence passes through five handoffs and its fidelity drops from 100% to 14%. |
| 0:18 | Chaos | Hundreds of apps and contracts no one sees in full. The agent sees one repository. |
| 0:26 | Missing map | The root cause. The frame collapses into a point of light. |
| 0:30 | Reveal | The drop. The star ignites, the estate forms and "Project N☉X" appears around it. |
| 0:38 | Atlas | One map of every application, with the contracts between them drawn in. |
| 0:46 | Knowledge | Six sources feed one Open Knowledge Format knowledge base, from In the Void to In Orbit. |
| 0:53 | Missions | Four seats each write their own spec file with NoX. People approve. |
| 1:02 | Blast radius | A change in Ledger Core reaches six apps. A guardrail refuses a bad diff. |
| 1:08 | Build | `/nox NOX-12` in the terminal, and the coding agents it works with. |
| 1:15 | Verify | Verified in reverse, back to the sentence. Fidelity returns to 100%. |
| 1:22 | Stack | Google ADK, Gemini, Gemma, Antigravity and Google Cloud. |
| 1:26 | Outro | The wordmark and "One sentence. Shipped across the enterprise." |

## Running it

This folder is its own npm project. It is not one of the repo's workspaces.

```bash
cd video
npm i
npm run dev        # Remotion Studio: preview and scrub the film and each scene
npm run render     # writes out/nox-intro.mp4
npm run still      # writes out/poster.png (the reveal)
npm run lint       # eslint + tsc
```

The Studio lists the full film as `NoxIntro`. Each scene is also listed on its own under
`NoxIntro-Scenes`, so you can preview and edit a scene in isolation.

The first render downloads Chrome Headless Shell. If a Chromium is already installed, pass it with
`--browser-executable=/path/to/headless_shell`.

## How it is built

```text
src/NoxIntro.tsx        the film: 13 scenes in a TransitionSeries, flash overlays on the cuts, grain, audio
src/Root.tsx            the NoxIntro composition, plus every scene as its own composition
src/scenes/             one file per scene
src/components/         Starfield, Sun, Planet, Estate (the orbital system), Wordmark, Kinetic (headlines),
                        Glitch, Camera (push-in, shake, beat bumps), Hud, Overlays (cut flash, light leak, grain)
src/lib/                theme (landing palette, seats, the Apex estate), motion (easing, beat, shake), 3D projection
scripts/soundtrack.mjs  synthesises the score into public/soundtrack.wav
public/fonts/           Outfit, DM Sans and JetBrains Mono (SIL Open Font License), bundled so renders work offline
public/logos/           copied from apps/web/public/logos
```

Every animation is driven by `useCurrentFrame()`. There are no CSS animations. The 3D orbits are
computed and projected in `src/lib/space.ts` and drawn as DOM and SVG, so the render needs no
WebGL. The one exception is the light leak on the reveal, which uses `@remotion/effects`.
`remotion.config.ts` enables ANGLE for it.

## The soundtrack

`scripts/soundtrack.mjs` synthesises the whole score from code: a 120 BPM track in A minor with
kicks, claps, hats, bass, pads, arpeggios, impacts, risers, whooshes and UI blips. Nothing is
sampled, so there is nothing to license. It runs before `dev`, `render` and `build`, and writes
`public/soundtrack.wav`. The WAV is ignored by Git.

At 30 fps, one beat is 15 frames and one bar is 60. Every scene starts on a beat. The script reads
each scene's `durationInFrames` from `src/NoxIntro.tsx`, so if you re-time a scene, its music
moves with it. Hits inside a scene use the same frame numbers as the scene's component. If you
move an animation inside a scene, move its hit in the score too.
