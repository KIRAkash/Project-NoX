import { random, useCurrentFrame } from "remotion";
import { mono } from "../lib/fonts";
import { C } from "../lib/theme";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&+=<>/";

/** Decodes text out of random glyphs, left to right. */
export const Scramble: React.FC<{
  text: string;
  start?: number;
  speed?: number;
  seed?: string;
  style?: React.CSSProperties;
}> = ({ text, start = 0, speed = 1, seed = "scramble", style }) => {
  const frame = useCurrentFrame();
  const step = Math.floor(frame / 2);
  return (
    <span style={{ whiteSpace: "pre", ...style }}>
      {text.split("").map((ch, i) => {
        const appear = start + i * speed * 0.35;
        const settle = start + i * speed + 6;
        if (frame < appear) return <span key={i} style={{ opacity: 0 }}>{ch}</span>;
        if (frame >= settle || ch === " ") return <span key={i}>{ch}</span>;
        const g = GLYPHS[Math.floor(random(`${seed}-${i}-${step}`) * GLYPHS.length)];
        return (
          <span key={i} style={{ opacity: 0.55 }}>
            {g}
          </span>
        );
      })}
    </span>
  );
};

/** Types text out at `cps` characters per frame, with a blinking caret. */
export const Typewriter: React.FC<{
  text: string;
  start?: number;
  cps?: number;
  caret?: boolean;
  caretColor?: string;
  style?: React.CSSProperties;
}> = ({ text, start = 0, cps = 1.2, caret = true, caretColor = C.nox, style }) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.min(text.length, Math.floor((frame - start) * cps)));
  const typing = frame >= start && n < text.length;
  const showCaret = caret && frame >= start && (typing || Math.floor(frame / 8) % 2 === 0);
  return (
    <span style={{ whiteSpace: "pre-wrap", ...style }}>
      {text.slice(0, n)}
      {showCaret ? (
        <span
          style={{
            display: "inline-block",
            width: "0.08em",
            height: "0.95em",
            marginLeft: "0.06em",
            translate: "0px 0.14em",
            background: caretColor,
            boxShadow: `0 0 12px ${caretColor}`,
          }}
        />
      ) : null}
    </span>
  );
};

/** Small uppercase label in the landing page's mono style. */
export const MonoLabel: React.FC<{
  children: React.ReactNode;
  size?: number;
  color?: string;
  tracking?: string;
  style?: React.CSSProperties;
}> = ({ children, size = 18, color = C.faint, tracking = "0.22em", style }) => (
  <div
    style={{
      fontFamily: mono,
      fontSize: size,
      letterSpacing: tracking,
      textTransform: "uppercase",
      color,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);
