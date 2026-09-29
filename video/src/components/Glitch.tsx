import { random, useCurrentFrame } from "remotion";

/*
 * Signal damage. At low amounts the content jitters and splits into red and
 * cyan ghosts; past a quarter, horizontal bands of it tear sideways. The
 * pattern changes every other frame so it reads as interference, not noise.
 */

type Props = {
  amount: number;
  seed?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export const Glitch: React.FC<Props> = ({ amount, seed = "glitch", children, style }) => {
  const frame = useCurrentFrame();
  if (amount <= 0.01) return <div style={{ position: "relative", ...style }}>{children}</div>;

  const step = Math.floor(frame / 2);
  const split = amount * 12;
  const jitter = (random(`${seed}-j-${step}`) - 0.5) * amount * 22;
  const bands = [0, 1, 2].map((k) => {
    const top = random(`${seed}-t-${k}-${step}`) * 90;
    const h = 3 + random(`${seed}-h-${k}-${step}`) * 16;
    return { top, h, off: (random(`${seed}-o-${k}-${step}`) - 0.5) * amount * 140 };
  });

  return (
    <div style={{ position: "relative", ...style }}>
      <div
        style={{
          translate: `${jitter}px 0px`,
          filter: `drop-shadow(${split}px 0 0 rgba(255,50,90,0.8)) drop-shadow(${-split}px 0 0 rgba(50,220,255,0.8))`,
        }}
      >
        {children}
      </div>
      {amount > 0.25
        ? bands.map((b, i) => (
            <div
              key={i}
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                clipPath: `inset(${b.top}% 0 ${Math.max(0, 100 - b.top - b.h)}% 0)`,
                translate: `${b.off}px 0px`,
                opacity: 0.9,
              }}
            >
              {children}
            </div>
          ))
        : null}
    </div>
  );
};
