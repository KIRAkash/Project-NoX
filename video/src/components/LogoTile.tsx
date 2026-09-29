import { Img, staticFile } from "remotion";
import { rgba } from "../lib/color";
import { display } from "../lib/fonts";
import { C } from "../lib/theme";

/*
 * A glass tile holding a product logo from public/logos, or a short word
 * mark for things without one (ADK, OKF, uploads).
 */

type Props = {
  logo?: string;
  mark?: string;
  size: number;
  round?: boolean;
  accent?: string;
  glow?: number;
  style?: React.CSSProperties;
};

export const LogoTile: React.FC<Props> = ({ logo, mark, size, round = false, accent = C.ice, glow = 0, style }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: round ? "50%" : size * 0.24,
      background: "radial-gradient(circle at 30% 25%, rgba(40,46,70,0.95), rgba(9,11,19,0.96) 70%)",
      border: `1.5px solid ${rgba(accent, 0.35 + glow * 0.5)}`,
      boxShadow: `0 16px 40px -16px #000, 0 0 ${20 + glow * 40}px ${rgba(accent, 0.18 + glow * 0.4)}, inset 0 1px 0 rgba(255,255,255,0.08)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      ...style,
    }}
  >
    {logo ? (
      <Img src={staticFile(`logos/${logo}.svg`)} style={{ width: size * 0.5, height: size * 0.5, objectFit: "contain" }} />
    ) : (
      <span
        style={{
          fontFamily: display,
          fontWeight: 600,
          fontSize: size * 0.3,
          letterSpacing: "-0.02em",
          background: `linear-gradient(135deg, #FFFFFF, ${accent})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {mark}
      </span>
    )}
  </div>
);
