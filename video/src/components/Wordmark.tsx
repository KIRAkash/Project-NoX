import { mono, sans } from "../lib/fonts";
import { C } from "../lib/theme";

/*
 * "Project N☉X" around a star drawn elsewhere: N and X sit either side of
 * the star at (cx, cy), the way the landing page's wordmark tracks its sun.
 * `letters` and `label` are 0..1 arrival progress.
 */

export const Wordmark: React.FC<{
  cx: number;
  cy: number;
  sunSize: number;
  letters: number;
  label: number;
  opacity?: number;
}> = ({ cx, cy, sunSize, letters, label, opacity = 1 }) => {
  const fontSize = sunSize * 0.98;
  const gap = sunSize * 0.1;
  const common: React.CSSProperties = {
    position: "absolute",
    top: cy - fontSize * 0.52,
    fontFamily: sans,
    fontWeight: 600,
    fontSize,
    lineHeight: 1,
    color: C.ink,
    letterSpacing: "-0.02em",
    opacity: Math.min(1, letters * 1.6) * opacity,
    filter: letters < 1 ? `blur(${(1 - letters) * 14}px)` : undefined,
    textShadow: "0 0 50px rgba(247,181,66,0.25)",
  };
  return (
    <>
      <div style={{ ...common, right: 1920 - (cx - sunSize / 2 - gap), translate: `${-(1 - letters) * 340}px 0px` }}>N</div>
      <div style={{ ...common, left: cx + sunSize / 2 + gap, translate: `${(1 - letters) * 340}px 0px` }}>X</div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: cy - sunSize / 2 - sunSize * 0.42,
          textAlign: "center",
          fontFamily: mono,
          fontSize: Math.max(16, sunSize * 0.14),
          letterSpacing: "0.55em",
          textIndent: "0.55em",
          color: "#FFFFFF",
          textTransform: "uppercase",
          opacity: label * opacity,
          translate: `0px ${(1 - label) * 18}px`,
        }}
      >
        Project
      </div>
    </>
  );
};
