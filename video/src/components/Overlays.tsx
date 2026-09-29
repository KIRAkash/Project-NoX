import { lightLeak } from "@remotion/effects/light-leak";
import { AbsoluteFill, interpolate, random, Solid, useCurrentFrame, useVideoConfig } from "remotion";
import { rgba } from "../lib/color";
import { CLAMP } from "../lib/motion";
import { C, TONE, type Tone } from "../lib/theme";

/*
 * What plays over a cut. `CutFlash` is the hard hit between chapters: a
 * flash that peaks exactly on the cut, an anamorphic streak and a burst of
 * speed lines. `LightLeakOverlay` is the warm wash for the big reveal.
 */

export const CutFlash: React.FC<{ tone?: Tone; strength?: number }> = ({ tone = "nox", strength = 1 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const mid = durationInFrames / 2;
  const d = frame - mid;
  const flash = d < 0 ? interpolate(d, [-3, 0], [0, 1], CLAMP) : Math.exp(-d / 2.6);
  const streak = d < 0 ? interpolate(d, [-mid, 0], [0, 1], CLAMP) : Math.exp(-d / 5);
  const hue = TONE[tone];

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, #FFFFFF 0%, ${rgba(hue, 0.9)} 30%, ${rgba(hue, 0.25)} 65%, transparent 100%)`,
          opacity: flash * 0.85 * strength,
          mixBlendMode: "screen",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: height / 2 - 5,
          width,
          height: 10,
          background: `linear-gradient(90deg, transparent, ${rgba(hue, 0.8)} 30%, #FFFFFF 50%, ${rgba(hue, 0.8)} 70%, transparent)`,
          filter: "blur(3px)",
          scale: `${0.2 + streak * 1.2} ${0.4 + streak}`,
          opacity: streak * strength,
        }}
      />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: streak * strength }}>
        {Array.from({ length: 26 }, (_, i) => {
          const y = random(`cut-y-${i}`) * height;
          const len = 200 + random(`cut-l-${i}`) * 700;
          const x = (random(`cut-x-${i}`) * width - len / 2) + d * (random(`cut-v-${i}`) - 0.5) * 160;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={len}
              height={1 + random(`cut-h-${i}`) * 2.5}
              fill={i % 3 === 0 ? hue : "#FFFFFF"}
              opacity={0.25 + random(`cut-o-${i}`) * 0.5}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

export const LightLeakOverlay: React.FC<{ seed?: number; hueShift?: number }> = ({ seed = 3, hueShift = 0 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, height, width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      <Solid
        width={width}
        height={height}
        effects={[
          lightLeak({
            seed,
            hueShift,
            progress: interpolate(frame, [0, durationInFrames - 1], [0, 1], CLAMP),
          }),
        ]}
      />
    </AbsoluteFill>
  );
};

/** Film grain and a vignette over the whole film. */
export const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,0.38) 100%)",
        }}
      />
      <svg
        width={width / 2}
        height={height / 2}
        style={{ position: "absolute", left: 0, top: 0, width, height, opacity: 0.09, mixBlendMode: "overlay" }}
      >
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={frame % 12} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      <AbsoluteFill style={{ boxShadow: `inset 0 0 0 1px ${C.hairline}` }} />
    </AbsoluteFill>
  );
};
