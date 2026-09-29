import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Chip } from "../components/Chrome";
import { Estate } from "../components/Estate";
import { Kinetic } from "../components/Kinetic";
import { Scramble } from "../components/Type";
import { Wordmark } from "../components/Wordmark";
import { mono } from "../lib/fonts";
import { ease, prog, pulse, travelled } from "../lib/motion";
import { C } from "../lib/theme";

/*
 * 1:26 — The bookend. The star and its estate return, Project N☉X locks up
 * around it with the line from the landing page, and the film closes on the
 * star going out.
 */

const SX = 960;
const SY = 400;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ignite = spring({ frame, fps, config: { damping: 12, stiffness: 150 } });
  const out = prog(frame, 94, 110, ease.in);
  const collapse = prog(frame, 104, 117, ease.in);
  const beat = pulse(frame, 15, 5);
  const speedAt = (i: number) => 2 + 60 * Math.exp(-i / 8);

  return (
    <AbsoluteFill style={{ background: C.void }}>
      <AbsoluteFill style={{ opacity: 1 - out }}>
        <Backdrop
          travel={travelled(frame, speedAt)}
          speed={speedAt(frame)}
          cx={SX}
          cy={SY}
          nebulae={[
            { x: 0.5, y: 0.37, r: 1000, color: C.nox, a: 0.11 + 0.04 * beat },
            { x: 0.12, y: 0.9, r: 800, color: C.ice, a: 0.07 },
          ]}
        />
      </AbsoluteFill>
      <Estate
        cx={SX}
        cy={SY}
        radius={1.9}
        pitch={0.38}
        yaw={1.2 + frame * 0.004}
        time={frame + 900}
        orbitSpeed={7}
        orbitDraw={prog(frame, 0, 26, ease.out)}
        orbitOpacity={0.8 * (1 - out)}
        pop={(i) => spring({ frame: frame - 6 - i * 2, fps, config: { damping: 12, stiffness: 170 } }) * (1 - out)}
        sun={{
          size: 200 * ignite * (1 - collapse) * (1 + 0.03 * beat),
          glow: 1 + 0.4 * beat + collapse * 2,
          spin: frame * 0.4,
          flare: 0.4 + 0.3 * beat + collapse,
        }}
      />
      <Wordmark cx={SX} cy={SY} sunSize={200} letters={prog(frame, 4, 20, ease.back)} label={prog(frame, 14, 26)} opacity={1 - out} />

      <div style={{ position: "absolute", left: 0, right: 0, top: 660, opacity: 1 - out }}>
        <Kinetic text="One *sentence.* Shipped across the enterprise." start={22} stagger={2} size={74} align="center" />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 780,
          textAlign: "center",
          fontFamily: mono,
          fontSize: 20,
          letterSpacing: "0.34em",
          color: C.muted,
          opacity: prog(frame, 40, 46) * (1 - out),
        }}
      >
        <Scramble text="ATLAS · MISSIONS · /NOX · VERIFIED IN REVERSE" start={40} speed={0.5} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 860,
          display: "flex",
          justifyContent: "center",
          gap: 16,
          opacity: prog(frame, 52, 60) * (1 - out),
          translate: `0px ${(1 - prog(frame, 52, 62, ease.out)) * 20}px`,
        }}
      >
        <Chip color={C.nox} size={17}>
          AI Builder Cup · 2026
        </Chip>
        <Chip color={C.ice} size={17}>
          Built in Google Antigravity
        </Chip>
      </div>
    </AbsoluteFill>
  );
};
