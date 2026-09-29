import { Fragment } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { display, sans } from "../lib/fonts";
import { CLAMP, ease, prog } from "../lib/motion";
import { C, TONE, type Tone } from "../lib/theme";

/*
 * Kinetic headlines. Words wrapped in *asterisks* become the landing page's
 * accent: display italic in a tone. A newline forces a line break. Each word
 * arrives on its own frame, `stagger` frames after the one before it.
 *
 *   slam — punches in from large and blurred, the high-energy hit
 *   rise — slides up out of a mask, the calm reveal
 *   fade — drifts up out of a blur
 */

type Piece = { t: string; accent: boolean };
type Token = { kind: "word"; pieces: Piece[] } | { kind: "br" };

const tokenize = (text: string): Token[] => {
  const out: Token[] = [];
  let cur: Piece[] = [];
  const flush = () => {
    if (cur.length) out.push({ kind: "word", pieces: cur });
    cur = [];
  };
  text.split("*").forEach((segment, si) => {
    const accent = si % 2 === 1;
    for (const part of segment.split(/(\s+)/)) {
      if (part === "") continue;
      if (/^\s+$/.test(part)) {
        flush();
        if (part.includes("\n")) out.push({ kind: "br" });
        continue;
      }
      cur.push({ t: part, accent });
    }
  });
  flush();
  return out;
};

export type KineticProps = {
  text: string;
  start?: number;
  stagger?: number;
  size: number;
  weight?: number;
  color?: string;
  accent?: Tone;
  mode?: "slam" | "rise" | "fade";
  align?: "left" | "center" | "right";
  lineHeight?: number;
  tracking?: string;
  /** frame at which the words leave again */
  exit?: number;
  font?: string;
  style?: React.CSSProperties;
};

export const Kinetic: React.FC<KineticProps> = ({
  text,
  start = 0,
  stagger = 3,
  size,
  weight = 600,
  color = C.ink,
  accent = "nox",
  mode = "rise",
  align = "left",
  lineHeight = 1.06,
  tracking = "-0.028em",
  exit,
  font = sans,
  style,
}) => {
  const frame = useCurrentFrame();
  const tokens = tokenize(text);
  let wordIndex = 0;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        alignItems: "baseline",
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        lineHeight,
        letterSpacing: tracking,
        color,
        ...style,
      }}
    >
      {tokens.map((token, ti) => {
        if (token.kind === "br") return <div key={ti} style={{ flexBasis: "100%", height: 0 }} />;
        const i = wordIndex++;
        const d = start + i * stagger;
        const out = exit === undefined ? 0 : prog(frame, exit + i, exit + i + 10, ease.in);

        const content = token.pieces.map((p, pi) => (
          <span
            key={pi}
            style={
              p.accent
                ? {
                    fontFamily: display,
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: "1.04em",
                    letterSpacing: "-0.01em",
                    color: TONE[accent],
                  }
                : undefined
            }
          >
            {p.t}
          </span>
        ));

        const gap: React.CSSProperties = { marginRight: "0.26em" };

        if (mode === "rise") {
          const t = prog(frame, d, d + 16, ease.out);
          return (
            <span
              key={ti}
              style={{
                display: "inline-block",
                overflow: "hidden",
                // room for descenders and the italic overhang, given back by the negative margin
                padding: "0.08em 0.14em 0.14em 0.02em",
                margin: "-0.08em 0.12em -0.14em -0.02em",
                opacity: 1 - out,
                filter: out > 0 ? `blur(${out * 10}px)` : undefined,
                translate: `0px ${-out * 40}px`,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  translate: `0px ${(1 - t) * 110}%`,
                  rotate: `${(1 - t) * 5}deg`,
                  transformOrigin: "left bottom",
                }}
              >
                {content}
              </span>
            </span>
          );
        }

        if (mode === "slam") {
          const t = prog(frame, d, d + 12, ease.out);
          return (
            <span
              key={ti}
              style={{
                ...gap,
                display: "inline-block",
                opacity: interpolate(frame, [d, d + 3], [0, 1], CLAMP) * (1 - out),
                scale: interpolate(frame, [d, d + 12], [2.2, 1], {
                  ...CLAMP,
                  easing: ease.out,
                  output: "perceptual-scale",
                }),
                filter: `blur(${(1 - t) * 16 + out * 12}px)`,
                translate: `0px ${-out * 50}px`,
              }}
            >
              {content}
            </span>
          );
        }

        const t = prog(frame, d, d + 18, ease.out);
        return (
          <Fragment key={ti}>
            <span
              style={{
                ...gap,
                display: "inline-block",
                opacity: t * (1 - out),
                filter: `blur(${(1 - t) * 12 + out * 10}px)`,
                translate: `0px ${(1 - t) * 34 - out * 40}px`,
              }}
            >
              {content}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
};
