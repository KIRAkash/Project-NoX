import { AbsoluteFill, useCurrentFrame } from "remotion";
import { rgba } from "../lib/color";
import { C } from "../lib/theme";
import { Starfield } from "./Starfield";

/*
 * The void every scene stands in: near-black, two slow nebula glows and a
 * star field drifting past. Scenes that need warp speed or a different
 * vanishing point pass their own star settings.
 */

type Nebula = { x: number; y: number; r: number; color: string; a: number };

type Props = {
  nebulae?: Nebula[];
  travel?: number;
  speed?: number;
  starOpacity?: number;
  starCount?: number;
  cx?: number;
  cy?: number;
  seed?: string;
  children?: React.ReactNode;
};

const DEFAULT_NEBULAE: Nebula[] = [
  { x: 0.78, y: 0.2, r: 900, color: C.ice, a: 0.09 },
  { x: 0.15, y: 0.85, r: 1000, color: C.nox, a: 0.06 },
];

export const Backdrop: React.FC<Props> = ({
  nebulae = DEFAULT_NEBULAE,
  travel,
  speed = 0,
  starOpacity = 1,
  starCount = 420,
  cx,
  cy,
  seed,
  children,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.void }}>
      {nebulae.map((n, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `calc(${n.x * 100}% - ${n.r}px + ${Math.sin(frame * 0.01 + i) * 30}px)`,
            top: `calc(${n.y * 100}% - ${n.r}px + ${Math.cos(frame * 0.012 + i) * 20}px)`,
            width: n.r * 2,
            height: n.r * 2,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${rgba(n.color, n.a)} 0%, ${rgba(n.color, n.a * 0.35)} 35%, transparent 70%)`,
          }}
        />
      ))}
      <Starfield
        travel={travel ?? frame * 2.2}
        speed={speed}
        opacity={starOpacity}
        count={starCount}
        cx={cx}
        cy={cy}
        seed={seed}
        spin={frame * 0.0007}
      />
      {children}
    </AbsoluteFill>
  );
};
