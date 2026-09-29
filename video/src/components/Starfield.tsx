import { useMemo } from "react";
import { random, useVideoConfig } from "remotion";

/*
 * Stars in a 3D box that the camera flies through. `travel` is how far the
 * camera has moved forward; `speed` stretches each star into a streak, so the
 * same field drifts gently at low speed and becomes a warp tunnel at high
 * speed. Negative speed pulls the stars back in towards the vanishing point.
 */

const NEAR = 40;
const FAR = 2400;
const FOCAL = 620;

type Props = {
  travel?: number;
  speed?: number;
  count?: number;
  seed?: string;
  cx?: number;
  cy?: number;
  spin?: number;
  opacity?: number;
};

export const Starfield: React.FC<Props> = ({
  travel = 0,
  speed = 0,
  count = 420,
  seed = "stars",
  cx,
  cy,
  spin = 0,
  opacity = 1,
}) => {
  const { width, height } = useVideoConfig();
  const ox = cx ?? width / 2;
  const oy = cy ?? height / 2;

  const stars = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: (random(`${seed}-x-${i}`) - 0.5) * 5200,
        y: (random(`${seed}-y-${i}`) - 0.5) * 3200,
        z: NEAR + random(`${seed}-z-${i}`) * (FAR - NEAR),
        size: 0.7 + random(`${seed}-s-${i}`) ** 4 * 2.6,
        tint: random(`${seed}-t-${i}`),
        twinkle: random(`${seed}-p-${i}`) * Math.PI * 2,
      })),
    [count, seed],
  );

  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  const span = FAR - NEAR;

  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity }}>
      {stars.map((s, i) => {
        const z = ((((s.z - NEAR - travel) % span) + span) % span) + NEAR;
        const x = s.x * cos - s.y * sin;
        const y = s.x * sin + s.y * cos;
        const k = FOCAL / z;
        const px = ox + x * k;
        const py = oy + y * k;
        if (px < -40 || px > width + 40 || py < -40 || py > height + 40) return null;
        const tailZ = Math.max(NEAR, Math.min(FAR, z + speed * 2.4));
        const kt = FOCAL / tailZ;
        const tx = ox + x * kt;
        const ty = oy + y * kt;
        const fade = Math.min(1, (FAR - z) / 500) * Math.min(1, (z - NEAR) / 80);
        const twinkle = 0.75 + 0.25 * Math.sin(travel * 0.02 + s.twinkle + i);
        const w = Math.min(5, s.size * (0.45 + k * 0.9));
        const color = s.tint > 0.86 ? "#FFE2A8" : s.tint < 0.18 ? "#CFE0FF" : "#FFFFFF";
        return (
          <line
            key={i}
            x1={tx}
            y1={ty}
            x2={px + 0.01}
            y2={py}
            stroke={color}
            strokeWidth={w}
            strokeLinecap="round"
            opacity={fade * twinkle * (0.35 + Math.min(0.65, k))}
          />
        );
      })}
    </svg>
  );
};
