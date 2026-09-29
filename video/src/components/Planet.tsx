import { darken, lighten, rgba } from "../lib/color";

/*
 * A lit sphere in an application's or seat's hue: a highlight towards the
 * star, a terminator on the far side, and a glow of its own colour.
 */

type Props = {
  x: number;
  y: number;
  size: number;
  hue: string;
  glow?: number;
  opacity?: number;
  ring?: boolean;
  /** 0..1: an extra rim of light, for a planet that has just been hit or picked */
  lit?: number;
};

export const Planet: React.FC<Props> = ({ x, y, size, hue, glow = 1, opacity = 1, ring = false, lit = 0 }) => {
  if (size <= 0.5 || opacity <= 0.001) return null;
  return (
    <div style={{ position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, opacity }}>
      <div
        style={{
          position: "absolute",
          inset: -size * 0.9,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${rgba(hue, 0.3 * glow + 0.35 * lit)} 0%, ${rgba(hue, 0.08 * glow)} 38%, transparent 68%)`,
        }}
      />
      {ring ? (
        <div
          style={{
            position: "absolute",
            left: -size * 0.55,
            top: size * 0.36,
            width: size * 2.1,
            height: size * 0.28,
            borderRadius: "50%",
            border: `${Math.max(1, size * 0.035)}px solid ${rgba(lighten(hue, 0.3), 0.7)}`,
            rotate: "-14deg",
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: `radial-gradient(circle at 32% 28%, ${lighten(hue, 0.72)} 0%, ${lighten(hue, 0.15)} 30%, ${hue} 52%, ${darken(hue, 0.55)} 100%)`,
          boxShadow: `inset ${-size * 0.16}px ${-size * 0.12}px ${size * 0.28}px rgba(0,0,0,0.55), 0 0 ${size * 0.35 + lit * size * 0.6}px ${rgba(hue, 0.55 + lit * 0.4)}`,
        }}
      />
      {lit > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: -size * 0.28 * lit,
            borderRadius: "50%",
            border: `2px solid ${rgba(lighten(hue, 0.4), 0.9 * lit)}`,
          }}
        />
      ) : null}
    </div>
  );
};
