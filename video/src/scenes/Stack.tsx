import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Hud } from "../components/Chrome";
import { Kinetic } from "../components/Kinetic";
import { LogoTile } from "../components/LogoTile";
import { MonoLabel } from "../components/Type";
import { rgba } from "../lib/color";
import { sans } from "../lib/fonts";
import { CLAMP, ease, prog } from "../lib/motion";
import { C } from "../lib/theme";

/*
 * 1:22 — What it runs on, rapid fire on the eighth notes: Google ADK agents
 * on Gemini, Gemma for NoX Local, built in Antigravity, served from Google
 * Cloud, with knowledge in the Open Knowledge Format.
 */

const TILES = [
  { mark: "ADK", name: "Google ADK", note: "every agent", accent: C.ice },
  { logo: "gemini", name: "Gemini", note: "agent platform", accent: C.ice },
  { logo: "ollama", name: "Gemma", note: "NoX Local", accent: C.ice },
  { logo: "antigravity", name: "Antigravity", note: "built in · /nox", accent: C.nox },
  { logo: "google-cloud", name: "Cloud Run", note: "api · worker · web", accent: C.ice },
  { logo: "postgresql", name: "Cloud SQL", note: "pgvector search", accent: C.ice },
  { logo: "firebase", name: "Firebase", note: "authentication", accent: C.ice },
  { mark: "OKF", name: "OKF 0.2", note: "open knowledge format", accent: C.nox },
];

/** Eighth notes at 120 BPM: 7.5 frames apart. */
const AT = [12, 19, 27, 34, 42, 49, 57, 64];
const W = 360;
const H = 236;
const GAP = 34;
const X0 = (1920 - (W * 4 + GAP * 3)) / 2;

export const Stack: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shine = interpolate(frame, [74, 102], [-0.3, 1.3], CLAMP);

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.5, y: 0.55, r: 1000, color: C.ice, a: 0.08 },
          { x: 0.5, y: 0.1, r: 800, color: C.nox, a: 0.07 },
        ]}
      />
      <Camera beat={1} hits={AT} shakeAmp={4}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 150 }}>
          <Kinetic text="Agents on *Gemini.* Built in *Antigravity.*" start={2} stagger={2} size={82} mode="slam" align="center" />
        </div>

        {TILES.map((t, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const s = spring({ frame: frame - AT[i], fps, config: { damping: 12, stiffness: 230 } });
          const flash = Math.max(0, 1 - (frame - AT[i]) / 10);
          const x = X0 + col * (W + GAP);
          const y = 330 + row * (H + GAP);
          const band = shine * (1920 + 400) - 200;
          const sheen = Math.max(0, 1 - Math.abs(x + W / 2 - band) / 300);
          return (
            <div
              key={t.name}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: W,
                height: H,
                borderRadius: 20,
                background: "linear-gradient(180deg, rgba(16,19,32,0.92), rgba(8,9,16,0.92))",
                border: `1.5px solid ${rgba(t.accent, 0.25 + flash * 0.7 + sheen * 0.4)}`,
                boxShadow: `0 0 ${50 * flash + 30 * sheen}px ${rgba(t.accent, 0.35 * flash + 0.2 * sheen)}, 0 30px 60px -30px #000`,
                opacity: frame >= AT[i] ? Math.min(1, s * 2.5) : 0,
                scale: String(interpolate(s, [0, 1], [1.5, 1])),
                filter: s < 0.7 ? `blur(${(0.7 - s) * 16}px)` : undefined,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
              }}
            >
              <LogoTile logo={t.logo} mark={t.mark} size={96} accent={t.accent} glow={flash} />
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 32, color: C.ink, letterSpacing: "-0.01em" }}>{t.name}</div>
              <MonoLabel size={14} color={t.accent === C.nox ? C.nox : C.faint} style={{ marginTop: -8 }}>
                {t.note}
              </MonoLabel>
            </div>
          );
        })}

        <MonoLabel
          size={18}
          color={C.muted}
          style={{ position: "absolute", left: 0, right: 0, top: 880, textAlign: "center", opacity: prog(frame, 72, 82, ease.out) }}
        >
          Memorystore · Cloud Storage · Secret Manager · no API key deployed
        </MonoLabel>
      </Camera>
      <Hud chapter="06 — Built on Google" />
    </AbsoluteFill>
  );
};
