import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BEAT, ease, prog, pulse, shake } from "../lib/motion";

/*
 * The scene's camera. It pushes in through a blur as the scene arrives and
 * keeps pushing as it leaves, so every cut reads as flying forward. Hits
 * shake it; `beat` bumps it on every beat of the soundtrack.
 */

type Props = {
  children: React.ReactNode;
  hits?: number[];
  shakeAmp?: number;
  beat?: number;
  intro?: boolean;
  outro?: boolean;
  /** extra zoom a scene drives itself */
  zoom?: number;
  origin?: string;
};

export const Camera: React.FC<Props> = ({
  children,
  hits = [],
  shakeAmp = 14,
  beat = 0,
  intro = true,
  outro = true,
  zoom = 1,
  origin = "50% 50%",
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const inT = intro ? prog(frame, 0, 14, ease.out) : 1;
  const outT = outro ? prog(frame, durationInFrames - 9, durationInFrames, ease.in) : 0;
  const s = shake(frame, hits, shakeAmp);
  const bump = beat * 0.014 * pulse(frame, BEAT, 3.5);
  const scale = (1.14 - 0.14 * inT) * (1 + 0.1 * outT) * (1 + bump) * zoom;
  const blur = (1 - inT) * 10 + outT * 8;

  return (
    <AbsoluteFill
      style={{
        scale: String(scale),
        translate: `${s.x}px ${s.y}px`,
        transformOrigin: origin,
        filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
        opacity: intro ? Math.min(1, inT * 2.5) : 1,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
