import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Chip, Check, cardStyle } from "../components/Chrome";
import { Kinetic } from "../components/Kinetic";
import { MonoLabel, Typewriter } from "../components/Type";
import { rgba } from "../lib/color";
import { display, mono, sans } from "../lib/fonts";
import { CLAMP, ease, prog, pulse, travelled } from "../lib/motion";
import { C, SEATS } from "../lib/theme";

/*
 * 0:00 — Out of warp speed, four hits on the beat: EVERY CHANGE / STARTS AS /
 * ONE / SENTENCE. Then the sentence itself arrives as a transmission from the
 * business user, and collapses into a point of light that the next scene
 * carries through the handoffs.
 */

const QUOTE = "Refunds take three days, and customers keep calling us about it.";

/** One phrase that slams in on its beat and is punched away by the next. */
const Phrase: React.FC<{ text: string; at: number; until: number; size: number }> = ({ text, at, until, size }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > until + 8) return null;
  const leave = prog(frame, until, until + 6, ease.in);
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: 1 - leave,
        scale: String(1 - leave * 0.35),
        filter: leave > 0 ? `blur(${leave * 14}px)` : undefined,
      }}
    >
      <Kinetic text={text} start={at} stagger={2} size={size} mode="slam" align="center" tracking="-0.04em" lineHeight={0.95} />
    </AbsoluteFill>
  );
};

export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const speedAt = (i: number) => 3 + 90 * Math.exp(-i / 12) + 140 * prog(i, 128, 150, ease.in);
  const travel = travelled(frame, speedAt);

  // the transmission card: a line that opens into a panel, then shuts back down to a point
  const open = prog(frame, 70, 77, ease.out);
  const tall = prog(frame, 76, 86, ease.out);
  const shutY = prog(frame, 134, 140, ease.in);
  const shutX = prog(frame, 139, 145, ease.in);
  const cardScaleX = Math.max(0.004, open * (1 - shutX));
  const cardScaleY = Math.max(0.012, tall * (1 - shutY));
  const cardVisible = frame >= 70 && frame < 146;
  const dot = interpolate(frame, [138, 142, 150], [0, 1, 1.6], CLAMP);

  return (
    <AbsoluteFill style={{ background: C.void }}>
      <Backdrop
        travel={travel}
        speed={speedAt(frame)}
        nebulae={[
          { x: 0.5, y: 0.5, r: 900, color: C.nox, a: 0.07 + 0.05 * pulse(frame) },
          { x: 0.85, y: 0.1, r: 800, color: C.ice, a: 0.08 },
        ]}
      />
      <Camera intro={false} hits={[0, 15, 30, 45]} shakeAmp={18} beat={frame < 60 ? 1 : 0}>
        <Phrase text="EVERY CHANGE" at={0} until={14} size={200} />
        <Phrase text="STARTS AS" at={15} until={29} size={220} />
        <Phrase text="ONE" at={30} until={44} size={400} />
        <Phrase text="*SENTENCE.*" at={45} until={68} size={330} />

        {cardVisible ? (
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <div
              style={{
                ...cardStyle(C.nox),
                position: "relative",
                width: 1480,
                padding: "54px 70px 58px",
                scale: `${cardScaleX} ${cardScaleY}`,
                background:
                  "linear-gradient(180deg, rgba(20,18,14,0.95), rgba(8,9,15,0.95))",
                boxShadow: `0 0 120px -20px ${rgba(C.nox, 0.5)}, 0 40px 100px -40px #000`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 7,
                      background: C.nox,
                      boxShadow: `0 0 ${10 + 14 * pulse(frame, 15, 5)}px ${C.nox}`,
                    }}
                  />
                  <MonoLabel size={20} color={C.nox}>
                    Incoming transmission
                  </MonoLabel>
                </div>
                <MonoLabel size={18} color={SEATS[0].hue}>
                  Seat · Business user
                </MonoLabel>
              </div>
              <div
                style={{
                  marginTop: 40,
                  display: "flex",
                  gap: 22,
                  fontFamily: sans,
                  fontSize: 78,
                  fontWeight: 500,
                  lineHeight: 1.12,
                  letterSpacing: "-0.025em",
                  color: C.ink,
                  minHeight: 175,
                }}
              >
                <span style={{ fontFamily: display, fontStyle: "italic", color: C.nox, fontSize: 110, lineHeight: 0.9 }}>“</span>
                <Typewriter text={`${QUOTE}”`} start={86} cps={1.7} />
              </div>
              <div
                style={{
                  marginTop: 34,
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  opacity: prog(frame, 124, 130),
                  translate: `0px ${(1 - prog(frame, 124, 132)) * 16}px`,
                }}
              >
                <Chip color={C.verify} filled>
                  <Check size={20} draw={prog(frame, 126, 134)} /> Mission NOX-12 opened
                </Chip>
                <span style={{ fontFamily: mono, fontSize: 18, letterSpacing: "0.18em", color: C.faint }}>
                  SIGNAL FIDELITY 100%
                </span>
              </div>
            </div>
          </AbsoluteFill>
        ) : null}

        {/* the sentence, compressed into a point of light */}
        {frame >= 138 ? (
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                background: "#FFF6DF",
                scale: String(dot),
                translate: `${interpolate(frame, [142, 150], [0, 900], { ...CLAMP, easing: Easing.in(Easing.cubic) })}px 0px`,
                boxShadow: `0 0 30px 10px ${rgba(C.nox, 0.9)}, 0 0 90px 30px ${rgba(C.ember, 0.5)}`,
              }}
            />
          </AbsoluteFill>
        ) : null}
      </Camera>
    </AbsoluteFill>
  );
};
