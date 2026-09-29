import { useCurrentFrame } from "remotion";
import { rgba } from "../lib/color";
import { mono, sans } from "../lib/fonts";
import { ease, prog } from "../lib/motion";
import { C, SUN_SURFACE, TONE, type Tone } from "../lib/theme";
import { Scramble } from "./Type";

/** N☉X: the wordmark with the star as its O. */
export const MiniMark: React.FC<{ size?: number; glow?: number }> = ({ size = 28, glow = 1 }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      fontFamily: sans,
      fontWeight: 600,
      fontSize: size,
      lineHeight: 1,
      color: C.ink,
    }}
  >
    N
    <span
      style={{
        display: "inline-block",
        width: size * 0.76,
        height: size * 0.76,
        margin: `0 ${size * 0.07}px`,
        borderRadius: "50%",
        background: SUN_SURFACE,
        boxShadow: `0 0 ${size * 0.4}px ${size * 0.08}px rgba(247,181,66,${0.5 * glow})`,
      }}
    />
    X
  </span>
);

/** Gold rule + mono caption, the landing page's section eyebrow. */
export const Eyebrow: React.FC<{
  text: string;
  start?: number;
  tone?: Tone;
  size?: number;
  style?: React.CSSProperties;
}> = ({ text, start = 0, tone = "nox", size = 20, style }) => {
  const frame = useCurrentFrame();
  const t = prog(frame, start, start + 14, ease.out);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, opacity: Math.min(1, t * 3), ...style }}>
      <span style={{ display: "block", height: 2, width: 34 * t, background: rgba(TONE[tone], 0.75) }} />
      <Scramble
        text={text.toUpperCase()}
        start={start + 2}
        speed={0.7}
        seed={text}
        style={{ fontFamily: mono, fontSize: size, letterSpacing: "0.22em", color: TONE[tone] }}
      />
    </div>
  );
};

/** A small mono pill. */
export const Chip: React.FC<{
  children: React.ReactNode;
  color?: string;
  size?: number;
  filled?: boolean;
  style?: React.CSSProperties;
}> = ({ children, color = C.ice, size = 18, filled = false, style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: `${size * 0.5}px ${size * 0.9}px`,
      borderRadius: 999,
      border: `1.5px solid ${rgba(color, 0.55)}`,
      background: filled ? rgba(color, 0.16) : "rgba(9,11,19,0.72)",
      fontFamily: mono,
      fontSize: size,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

/** A panel in the product's deck colour. */
export const cardStyle = (accent?: string): React.CSSProperties => ({
  position: "absolute",
  borderRadius: 18,
  background: "linear-gradient(180deg, rgba(13,16,28,0.94), rgba(7,8,15,0.94))",
  border: `1.5px solid ${accent ? rgba(accent, 0.45) : C.hairlineStrong}`,
  boxShadow: `0 30px 80px -30px rgba(0,0,0,0.9)${accent ? `, 0 0 60px -20px ${rgba(accent, 0.45)}` : ""}`,
  overflow: "hidden",
});

export const Check: React.FC<{ size?: number; color?: string; draw?: number }> = ({
  size = 28,
  color = C.verify,
  draw = 1,
}) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <path
      d="M2 8.6 6.1 12.6 14 4.2"
      stroke={color}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - draw}
    />
  </svg>
);

export const Warn: React.FC<{ size?: number; color?: string }> = ({ size = 26, color = C.ember }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <path d="M8 1.6 14.2 12.4H1.8L8 1.6Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 6.2v2.6M8 10.6v.1" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const Lock: React.FC<{ size?: number; color?: string }> = ({ size = 22, color = C.faint }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    <rect x="3" y="7" width="10" height="7.2" rx="1.6" stroke={color} strokeWidth="1.3" />
    <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" stroke={color} strokeWidth="1.3" />
  </svg>
);

/**
 * The HUD every chapter shares: corner brackets, the chapter eyebrow, the
 * mark top right and the event bottom right. It builds in with the scene.
 */
export const Hud: React.FC<{ chapter: string; tone?: Tone; opacity?: number }> = ({
  chapter,
  tone = "nox",
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const t = prog(frame, 0, 16, ease.out);
  const arm = 34 * t;
  const bracket = (pos: React.CSSProperties, bx: string, by: string): React.CSSProperties => ({
    position: "absolute",
    width: arm,
    height: arm,
    borderColor: C.hairlineStrong,
    borderStyle: "solid",
    borderWidth: 0,
    [bx]: 2,
    [by]: 2,
    ...pos,
  });

  return (
    <div style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}>
      <div style={bracket({ left: 44, top: 40 }, "borderLeftWidth", "borderTopWidth")} />
      <div style={bracket({ right: 44, top: 40 }, "borderRightWidth", "borderTopWidth")} />
      <div style={bracket({ left: 44, bottom: 40 }, "borderLeftWidth", "borderBottomWidth")} />
      <div style={bracket({ right: 44, bottom: 40 }, "borderRightWidth", "borderBottomWidth")} />

      <Eyebrow text={chapter} tone={tone} size={19} style={{ position: "absolute", left: 84, top: 70 }} />

      <div style={{ position: "absolute", right: 86, top: 62, opacity: t }}>
        <MiniMark size={30} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 86,
          bottom: 62,
          fontFamily: mono,
          fontSize: 14,
          letterSpacing: "0.26em",
          color: C.dim,
          opacity: t,
        }}
      >
        PROJECT NOX · FROM A SENTENCE TO SHIPPED SOFTWARE
      </div>
      <div
        style={{
          position: "absolute",
          right: 86,
          bottom: 62,
          fontFamily: mono,
          fontSize: 14,
          letterSpacing: "0.26em",
          color: C.dim,
          opacity: t,
        }}
      >
        AI BUILDER CUP · 2026
      </div>
    </div>
  );
};
