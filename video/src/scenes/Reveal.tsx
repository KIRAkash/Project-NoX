import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Estate } from "../components/Estate";
import { Kinetic } from "../components/Kinetic";
import { Scramble } from "../components/Type";
import { Wordmark } from "../components/Wordmark";
import { rgba } from "../lib/color";
import { mono } from "../lib/fonts";
import { ease, prog, pulse, travelled } from "../lib/motion";
import { C } from "../lib/theme";

/*
 * 0:30 — The drop. The point of light ignites into the star, shockwaves roll
 * out, the estate's orbits draw on and its applications pop into place, and
 * "Project N☉X" assembles around the star exactly as it does on the landing
 * page. Then the camera dives into the star.
 */

const SX = 960;
const SY = 440;

export const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const ignite = spring({ frame, fps, config: { damping: 11, stiffness: 120, mass: 0.9 } });
  const beat = pulse(frame, 15, 5);
  const sunSize = 210 * ignite * (1 + 0.035 * beat);
  const speedAt = (i: number) => 3 + 110 * Math.exp(-i / 9);
  const dive = prog(frame, 198, 240, ease.in);
  const textOut = prog(frame, 192, 204, ease.in);

  return (
    <AbsoluteFill>
      <Backdrop
        travel={travelled(frame, speedAt)}
        speed={speedAt(frame)}
        cx={SX}
        cy={SY}
        nebulae={[
          { x: 0.5, y: 0.41, r: 1000, color: C.nox, a: 0.1 + 0.05 * beat },
          { x: 0.1, y: 0.9, r: 900, color: C.ice, a: 0.07 },
          { x: 0.92, y: 0.15, r: 700, color: C.ember, a: 0.06 },
        ]}
      />
      <Camera intro={false} outro={false} hits={[0]} shakeAmp={24} zoom={1 + dive * dive * 9} origin={`${SX}px ${SY}px`}>
        {/* shockwaves */}
        {[0, 6, 12].map((d, i) => {
          const t = prog(frame, d, d + 42, ease.out);
          if (t <= 0 || t >= 1) return null;
          const r = 60 + t * 1500;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: SX - r,
                top: SY - r * 0.62,
                width: r * 2,
                height: r * 1.24,
                borderRadius: "50%",
                border: `${Math.max(1, 8 * (1 - t))}px solid ${rgba(i === 1 ? C.ember : C.nox, 0.9 * (1 - t))}`,
                boxShadow: `0 0 50px ${rgba(C.nox, 0.4 * (1 - t))}`,
              }}
            />
          );
        })}

        <Estate
          cx={SX}
          cy={SY}
          radius={1.72}
          pitch={0.42}
          yaw={0.4 + frame * 0.0035}
          time={frame}
          orbitSpeed={7}
          orbitDraw={Math.min(prog(frame, 8, 42, ease.out), 1)}
          orbitOpacity={1 - textOut * 0.5}
          pop={(i) => spring({ frame: frame - 26 - i * 4, fps, config: { damping: 12, stiffness: 160 } })}
          sun={{ size: sunSize, glow: 0.9 + 0.5 * beat + (1 - ignite) * 2, spin: frame * 0.35, flare: 0.35 + 0.4 * beat }}
        />

        <Wordmark cx={SX} cy={SY} sunSize={210} letters={prog(frame, 38, 58, ease.back)} label={prog(frame, 56, 72)} opacity={1 - textOut} />

        <div style={{ position: "absolute", left: 0, right: 0, top: 770, opacity: 1 - textOut }}>
          <Kinetic text="From a sentence to *shipped software.*" start={96} stagger={3} size={80} mode="rise" align="center" />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 890,
            textAlign: "center",
            fontFamily: mono,
            fontSize: 22,
            letterSpacing: "0.34em",
            color: C.muted,
            opacity: prog(frame, 140, 150) * (1 - textOut),
          }}
        >
          <Scramble text="ATLAS  ·  MISSIONS  ·  VERIFIED IN REVERSE" start={140} speed={0.6} />
        </div>
      </Camera>
    </AbsoluteFill>
  );
};
