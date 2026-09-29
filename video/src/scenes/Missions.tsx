import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Check, Chip, Hud, Lock, cardStyle } from "../components/Chrome";
import { Kinetic } from "../components/Kinetic";
import { Planet } from "../components/Planet";
import { Typewriter } from "../components/Type";
import { rgba } from "../lib/color";
import { mono, sans } from "../lib/fonts";
import { CLAMP, ease, prog, pulse } from "../lib/motion";
import { C, SEATS } from "../lib/theme";

/*
 * 0:53 — Feature two: missions. The sentence travels through four seats and
 * each one writes its own spec file with NoX as co-author, citing where every
 * line came from. Only a person approves, and the file then locks for the
 * other seats.
 */

const ENTER = [30, 75, 120, 165];
const CARD_W = 395;
const LEFTS = [110, 545, 980, 1415];
const TOP = 340;

const WRITES: string[][] = [
  ["Customers see a refund's status the same day.", "Today: a three-day wait and calls to support.", "Done: a final status on day one."],
  ["S1 · Full refunds settle the same day.", "S2 · Partial refunds, too.", "AC · A failed retry shows as failed."],
  ["Ledger Core gains intra-day settlement.", "refund.completed adds settled_at.", "Risk: Reporting reads settled_at."],
  ["T1 · notifications: tolerant parser.", "T2 · ledger-core: settle-now flag.", "T4 · refunds: call settle-now."],
];

const CITES: string[][] = [
  ["[[kb:portal/refund-flow]]", "PAY-311"],
  ["01-business.md §4", "[[kb:refunds/retries]]"],
  ["[[kb:ledger-core/settlement]]", "ADR-014"],
  ["retry.py:42", "settle.py:88"],
];

export const Missions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // the sentence hops from card to card as each one opens
  const cometX = interpolate(
    frame,
    [0, ENTER[0], ENTER[1] - 12, ENTER[1], ENTER[2] - 12, ENTER[2], ENTER[3] - 12, ENTER[3], 240],
    [-60, LEFTS[0] + CARD_W / 2, LEFTS[0] + CARD_W / 2, LEFTS[1] + CARD_W / 2, LEFTS[1] + CARD_W / 2, LEFTS[2] + CARD_W / 2, LEFTS[2] + CARD_W / 2, LEFTS[3] + CARD_W / 2, 2000],
    { ...CLAMP, easing: ease.inOut },
  );

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.5, y: 0.1, r: 900, color: C.nox, a: 0.07 },
          { x: 0.8, y: 0.9, r: 800, color: "#A897F0", a: 0.06 },
          { x: 0.15, y: 0.9, r: 700, color: "#5FCBD8", a: 0.05 },
        ]}
      />
      <Camera beat={1} hits={ENTER.map((e) => e + 40)} shakeAmp={5}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 138 }}>
          <Kinetic text="Four seats. *One* sentence. No re-typing." start={4} stagger={2} size={80} align="center" />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 250, display: "flex", justifyContent: "center", opacity: prog(frame, 14, 22) }}>
          <Chip color={C.nox} size={17}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: C.nox, boxShadow: `0 0 10px ${C.nox}` }} />
            NOX-12 · Same-day refunds for card payments
          </Chip>
        </div>

        {/* the trajectory joining the four files */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <line x1={LEFTS[0] + CARD_W / 2} y1={TOP - 16} x2={LEFTS[3] + CARD_W / 2} y2={TOP - 16} stroke={C.hairlineStrong} strokeWidth={1.5} strokeDasharray="3 9" />
          <circle cx={cometX} cy={TOP - 16} r={9} fill="#FFF6DF" style={{ filter: `drop-shadow(0 0 10px ${C.nox}) drop-shadow(0 0 20px ${C.nox})` }} />
        </svg>

        {SEATS.map((seat, k) => {
          const e = ENTER[k];
          const t = prog(frame, e, e + 16, ease.out);
          const approved = frame >= e + 40;
          const stamp = spring({ frame: frame - e - 40, fps, config: { damping: 10, stiffness: 200 } });
          const writing = frame >= e + 8 && !approved;
          return (
            <div
              key={seat.id}
              style={{
                ...cardStyle(seat.hue),
                left: LEFTS[k],
                top: TOP,
                width: CARD_W,
                height: 520,
                opacity: Math.min(1, t * 2),
                translate: `0px ${(1 - t) * 140}px`,
                rotate: `${(1 - t) * -6}deg`,
                transformOrigin: "left bottom",
              }}
            >
              <div style={{ height: 5, background: seat.hue, boxShadow: `0 0 20px ${seat.hue}` }} />
              <div style={{ padding: "22px 26px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ position: "relative", width: 40, height: 40 }}>
                    <Planet x={20} y={20} size={36} hue={seat.hue} glow={0.6} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 28, color: C.ink, letterSpacing: "-0.01em" }}>{seat.name}</div>
                    <div style={{ fontFamily: mono, fontSize: 16, color: C.faint, marginTop: 2 }}>{seat.file}</div>
                  </div>
                  {approved ? <Lock size={24} color={rgba(seat.hue, 0.8)} /> : null}
                </div>

                <div
                  style={{
                    marginTop: 18,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 12px",
                    borderRadius: 999,
                    background: rgba(seat.hue, 0.12),
                    fontFamily: mono,
                    fontSize: 14,
                    letterSpacing: "0.14em",
                    color: seat.hue,
                    opacity: writing ? 1 : approved ? 0.35 : 0,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: seat.hue, opacity: 0.4 + 0.6 * pulse(frame, 10, 4) }} />
                  {approved ? "WRITTEN WITH NOX" : "NOX CO-WRITING"}
                </div>

                <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                  {WRITES[k].map((line, i) => (
                    <div key={line} style={{ fontFamily: sans, fontSize: 23, lineHeight: 1.3, color: i === 2 && k === 2 ? C.ember : C.muted, minHeight: 30 }}>
                      <Typewriter text={line} start={e + 10 + i * 9} cps={2.4} caret={frame < e + 10 + i * 9 + line.length / 2.4 + 2} caretColor={seat.hue} />
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 8, opacity: prog(frame, e + 34, e + 40) }}>
                  {CITES[k].map((c) => (
                    <span
                      key={c}
                      style={{
                        fontFamily: mono,
                        fontSize: 14,
                        color: c.startsWith("[[") ? C.verify : C.nox,
                        padding: "4px 9px",
                        borderRadius: 6,
                        border: `1px solid ${C.hairlineStrong}`,
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              {approved ? (
                <div
                  style={{
                    position: "absolute",
                    right: 22,
                    bottom: 22,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 16px",
                    borderRadius: 10,
                    border: `2.5px solid ${C.verify}`,
                    background: rgba(C.verify, 0.12),
                    color: C.verify,
                    fontFamily: mono,
                    fontSize: 17,
                    fontWeight: 600,
                    letterSpacing: "0.16em",
                    rotate: "-6deg",
                    scale: String(interpolate(stamp, [0, 1], [2.4, 1])),
                    opacity: Math.min(1, stamp * 3),
                    boxShadow: `0 0 30px ${rgba(C.verify, 0.35)}`,
                  }}
                >
                  <Check size={20} /> APPROVED BY A PERSON
                </div>
              ) : null}
            </div>
          );
        })}

        <div style={{ position: "absolute", left: 0, right: 0, top: 905 }}>
          <Kinetic text="NoX drafts, refines and cites. *People* approve." start={214} stagger={2} size={56} align="center" color={C.ink} />
        </div>
      </Camera>
      <Hud chapter="03 — Missions · the spec chain" />
    </AbsoluteFill>
  );
};
