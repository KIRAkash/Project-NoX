import { SUN_SURFACE } from "../lib/theme";

/*
 * The NoX star: the wordmark's O, as a body with a corona. Everything is
 * driven by props so a scene decides how it breathes; `spin` turns the
 * corona and `flare` draws the anamorphic streak through it.
 */

type Props = {
  x: number;
  y: number;
  size: number;
  glow?: number;
  spin?: number;
  flare?: number;
  opacity?: number;
};

export const Sun: React.FC<Props> = ({ x, y, size, glow = 1, spin = 0, flare = 0.5, opacity = 1 }) => {
  if (size <= 0.5) return null;
  const at = (d: number): React.CSSProperties => ({
    position: "absolute",
    left: x - d / 2,
    top: y - d / 2,
    width: d,
    height: d,
    borderRadius: "50%",
  });

  return (
    <div style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}>
      {/* the wide halo that lights the space around the star */}
      <div
        style={{
          ...at(size * 7),
          background:
            "radial-gradient(circle, rgba(247,181,66,0.34) 0%, rgba(233,113,60,0.14) 22%, rgba(233,113,60,0.04) 42%, transparent 62%)",
          opacity: Math.min(1, glow),
        }}
      />
      {/* corona: two ray fields turning against each other */}
      <div
        style={{
          ...at(size * 3.1),
          background: `repeating-conic-gradient(from ${spin}deg, rgba(255,221,130,0) 0deg, rgba(255,221,130,0.5) 2.2deg, rgba(255,221,130,0) 7deg)`,
          WebkitMaskImage: "radial-gradient(circle, #000 28%, rgba(0,0,0,0.5) 40%, transparent 66%)",
          maskImage: "radial-gradient(circle, #000 28%, rgba(0,0,0,0.5) 40%, transparent 66%)",
          filter: `blur(${Math.max(2, size * 0.025)}px)`,
          opacity: 0.8 * Math.min(1.4, glow),
        }}
      />
      <div
        style={{
          ...at(size * 2.3),
          background: `repeating-conic-gradient(from ${-spin * 1.6}deg, rgba(255,190,110,0) 0deg, rgba(255,190,110,0.45) 3.4deg, rgba(255,190,110,0) 11deg)`,
          WebkitMaskImage: "radial-gradient(circle, #000 35%, transparent 70%)",
          maskImage: "radial-gradient(circle, #000 35%, transparent 70%)",
          filter: `blur(${Math.max(1.5, size * 0.018)}px)`,
          opacity: 0.7 * Math.min(1.4, glow),
        }}
      />
      {/* the body */}
      <div
        style={{
          ...at(size),
          background: SUN_SURFACE,
          boxShadow: `0 0 ${size * 0.22}px ${size * 0.07}px rgba(247,181,66,0.62), 0 0 ${size * 0.8}px ${size * 0.1}px rgba(233,113,60,${0.32 * glow})`,
        }}
      />
      {/* slow surface convection */}
      <div
        style={{
          ...at(size),
          background: `conic-gradient(from ${spin * 0.7}deg, rgba(255,255,255,0.18), rgba(233,113,60,0.2), rgba(255,247,226,0.22), rgba(233,113,60,0.14), rgba(255,255,255,0.18))`,
          mixBlendMode: "overlay",
          opacity: 0.9,
        }}
      />
      {/* anamorphic streak */}
      <div
        style={{
          position: "absolute",
          left: x - size * 5,
          top: y - size * 0.03,
          width: size * 10,
          height: size * 0.06,
          borderRadius: "50%",
          background: "linear-gradient(90deg, transparent, rgba(255,236,196,0.8) 45%, #FFFFFF 50%, rgba(255,236,196,0.8) 55%, transparent)",
          filter: `blur(${Math.max(1, size * 0.012)}px)`,
          opacity: flare,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x - size * 3.2,
          top: y - size * 0.16,
          width: size * 6.4,
          height: size * 0.32,
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(134,185,238,0.22), transparent 70%)",
          opacity: flare,
        }}
      />
    </div>
  );
};
