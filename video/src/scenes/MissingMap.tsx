import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Glitch } from "../components/Glitch";
import { Kinetic } from "../components/Kinetic";
import { Scramble } from "../components/Type";
import { rgba } from "../lib/color";
import { mono } from "../lib/fonts";
import { CLAMP, ease, prog, travelled } from "../lib/motion";
import { C } from "../lib/theme";

/*
 * 0:26 — The root cause, four words at a time on the beat, then the whole
 * frame tears apart and implodes into a single point of light: the star
 * that the next scene ignites.
 */

export const MissingMap: React.FC = () => {
  const frame = useCurrentFrame();
  const tear = interpolate(frame, [58, 96], [0, 1], { ...CLAMP, easing: ease.in });
  const hitSpike = [2, 17, 32, 47].some((h) => frame >= h && frame < h + 4) ? 0.35 : 0;
  const implode = prog(frame, 84, 108, ease.in);
  const speedAt = (i: number) => 2 - 70 * prog(i, 80, 112, ease.in);
  const travel = travelled(frame, speedAt);
  const point = prog(frame, 96, 118, ease.out);
  const ring = prog(frame, 92, 118, ease.in);

  return (
    <AbsoluteFill>
      <Backdrop
        travel={travel}
        speed={speedAt(frame)}
        starOpacity={0.7}
        nebulae={[{ x: 0.5, y: 0.5, r: 900, color: C.ember, a: 0.06 * (1 - implode) }]}
      />
      <Camera hits={[2, 17, 32, 47]} shakeAmp={16} outro={false}>
        <AbsoluteFill
          style={{
            scale: String(1 - implode * 0.96),
            opacity: 1 - prog(frame, 100, 110),
            filter: implode > 0 ? `blur(${implode * 10}px)` : undefined,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 190,
              textAlign: "center",
              fontFamily: mono,
              fontSize: 22,
              letterSpacing: "0.4em",
              color: C.ember,
            }}
          >
            <Scramble text="ROOT CAUSE" start={0} speed={1.2} />
          </div>
          <Glitch amount={Math.min(1, tear * 1.1 + hitSpike)} seed="missing" style={{ position: "absolute", left: 0, right: 0, top: 280 }}>
            <Kinetic text="No context window" start={2} size={122} mode="slam" align="center" stagger={2} tracking="-0.035em" />
            <Kinetic text="is big enough" start={17} size={122} mode="slam" align="center" stagger={2} tracking="-0.035em" style={{ marginTop: 6 }} />
            <Kinetic text="to fix a" start={32} size={122} mode="slam" align="center" stagger={2} tracking="-0.035em" style={{ marginTop: 6 }} />
            <Kinetic
              text="*missing map.*"
              start={47}
              size={200}
              mode="slam"
              align="center"
              stagger={3}
              accent="ember"
              lineHeight={1}
              style={{ marginTop: 10 }}
            />
          </Glitch>
        </AbsoluteFill>

        {/* everything collapses to a single point of light */}
        {frame >= 90 ? (
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <div
              style={{
                position: "absolute",
                width: 1400 * (1 - ring),
                height: 1400 * (1 - ring),
                borderRadius: "50%",
                border: `2px solid ${rgba(C.nox, 0.7 * ring)}`,
                boxShadow: `0 0 40px ${rgba(C.nox, 0.4 * ring)}`,
              }}
            />
            <div
              style={{
                width: 6 + 18 * point,
                height: 6 + 18 * point,
                borderRadius: "50%",
                background: "#FFF6DF",
                opacity: point,
                boxShadow: `0 0 ${20 + 60 * point}px ${10 + 20 * point}px ${rgba(C.nox, 0.8)}`,
              }}
            />
          </AbsoluteFill>
        ) : null}
      </Camera>
    </AbsoluteFill>
  );
};
