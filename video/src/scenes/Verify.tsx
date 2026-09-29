import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Check, Chip, Hud, cardStyle } from "../components/Chrome";
import { Kinetic } from "../components/Kinetic";
import { Planet } from "../components/Planet";
import { MonoLabel } from "../components/Type";
import { rgba } from "../lib/color";
import { display, sans } from "../lib/fonts";
import { CLAMP, ease, prog } from "../lib/motion";
import { C, SEATS } from "../lib/theme";

/*
 * 1:15 — Verify, in reverse. The mission flies back along its trajectory:
 * developer first, business user last, each ticking their own checklist.
 * Then the original sentence comes back, struck through and made true, with
 * the fidelity readout from the problem act back at 100%.
 */

const ORDER = [3, 2, 1, 0];
const XS = [1560, 1190, 820, 450];
const AT = [30, 60, 90, 120];
const Y = 430;
const QUESTIONS = ["Is the code what we built?", "Do the contracts hold?", "Are the criteria met?", "Is my sentence true now?"];

export const Verify: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cometX = interpolate(frame, [10, ...AT, 138], [1880, ...XS, 180], { ...CLAMP, easing: ease.inOut });
  const cometY = Y - Math.abs(Math.sin(((cometX - 180) / 370) * Math.PI)) * 60;
  const strike = prog(frame, 150, 160, ease.inOut);
  const fid = interpolate(frame, [166, 188], [14, 100], { ...CLAMP, easing: ease.out });
  const doneT = spring({ frame: frame - 138, fps, config: { damping: 11, stiffness: 190 } });

  const arc = [1880, ...XS, 180]
    .map((x, i, xs) => (i === 0 ? `M ${x} ${Y}` : `Q ${(xs[i - 1] + x) / 2} ${Y - 120} ${x} ${Y}`))
    .join(" ");

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.5, y: 0.4, r: 1000, color: C.verify, a: 0.05 + 0.05 * prog(frame, 120, 190) },
          { x: 0.9, y: 0.1, r: 700, color: C.ice, a: 0.06 },
        ]}
      />
      <Camera beat={1} hits={[...AT, 138]} shakeAmp={5}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 140 }}>
          <Kinetic text="Verified *in reverse*, against the sentence." start={4} stagger={2} size={80} align="center" accent="verify" />
        </div>

        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: 1 - prog(frame, 136, 144) * 0.9 }}>
          <path d={arc} fill="none" stroke={C.hairlineStrong} strokeWidth={1.6} strokeDasharray="3 9" />
          {Array.from({ length: 10 }, (_, i) => {
            const x = interpolate(frame - i * 1.4, [10, ...AT, 138], [1880, ...XS, 180], { ...CLAMP, easing: ease.inOut });
            const y = Y - Math.abs(Math.sin(((x - 180) / 370) * Math.PI)) * 60;
            return <circle key={i} cx={x} cy={y} r={Math.max(1, 10 - i)} fill={C.verify} opacity={(1 - i / 10) * 0.5} />;
          })}
          <circle cx={cometX} cy={cometY} r={11} fill="#EFFFF6" style={{ filter: `drop-shadow(0 0 10px ${C.verify}) drop-shadow(0 0 22px ${C.verify})` }} />
        </svg>

        {ORDER.map((seatIndex, k) => {
          const seat = SEATS[seatIndex];
          const x = XS[k];
          const reached = frame >= AT[k];
          const age = frame - AT[k];
          const check = spring({ frame: age, fps, config: { damping: 10, stiffness: 200 } });
          const ring = prog(frame, AT[k], AT[k] + 22, ease.out);
          return (
            <div key={seat.id}>
              <Planet x={x} y={Y} size={70} hue={seat.hue} glow={reached ? 1.2 : 0.4} opacity={reached ? 1 : 0.55} lit={reached ? Math.max(0.3, 1 - age / 20) : 0} />
              {reached && ring < 1 ? (
                <div
                  style={{
                    position: "absolute",
                    left: x - 40 - ring * 90,
                    top: Y - 40 - ring * 90,
                    width: 80 + ring * 180,
                    height: 80 + ring * 180,
                    borderRadius: "50%",
                    border: `2px solid ${C.verify}`,
                    opacity: 1 - ring,
                  }}
                />
              ) : null}
              {reached ? (
                <div
                  style={{
                    position: "absolute",
                    left: x + 26,
                    top: Y - 58,
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: C.verify,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    scale: String(check),
                    boxShadow: `0 0 24px ${rgba(C.verify, 0.7)}`,
                  }}
                >
                  <Check size={24} color="#05230F" draw={prog(frame, AT[k] + 3, AT[k] + 10)} />
                </div>
              ) : null}
              <div style={{ position: "absolute", left: x - 170, width: 340, top: Y + 60, textAlign: "center" }}>
                <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 27, color: reached ? C.ink : C.dim }}>{seat.name}</div>
                <div style={{ fontFamily: sans, fontSize: 22, marginTop: 6, color: reached ? seat.hue : C.dim, fontStyle: "italic" }}>
                  {QUESTIONS[k]}
                </div>
              </div>
            </div>
          );
        })}

        <div style={{ position: "absolute", left: 180 - 70, top: Y - 24, scale: String(doneT), opacity: Math.min(1, doneT * 2) }}>
          <Chip color={C.verify} filled size={18}>
            <Check size={18} /> Done
          </Chip>
        </div>

        {/* the sentence, made true */}
        <div
          style={{
            ...cardStyle(C.verify),
            left: 240,
            top: 700,
            width: 1440,
            height: 250,
            padding: "30px 44px",
            opacity: prog(frame, 140, 150),
            translate: `0px ${(1 - prog(frame, 140, 154, ease.out)) * 60}px`,
          }}
        >
          <MonoLabel size={16} color={C.faint}>
            The original sentence · NOX-12
          </MonoLabel>
          <div style={{ marginTop: 14, fontFamily: sans, fontSize: 32, color: C.faint, position: "relative", display: "inline-block" }}>
            “Refunds take three days, and customers keep calling us about it.”
            <div style={{ position: "absolute", left: 0, top: "54%", height: 3, width: `${strike * 100}%`, background: C.ember }} />
          </div>
          <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 16, opacity: prog(frame, 160, 168), translate: `0px ${(1 - prog(frame, 160, 170)) * 16}px` }}>
            <Check size={40} draw={prog(frame, 162, 172)} />
            <span style={{ fontFamily: sans, fontWeight: 600, fontSize: 46, color: C.verify, letterSpacing: "-0.02em" }}>
              Refunds now settle the same day.
            </span>
          </div>
          <div style={{ position: "absolute", right: 44, top: 32, textAlign: "right", opacity: prog(frame, 164, 170) }}>
            <MonoLabel size={15} color={C.faint}>
              Signal fidelity
            </MonoLabel>
            <div style={{ fontFamily: display, fontWeight: 600, fontSize: 96, lineHeight: 1, color: C.verify, letterSpacing: "-0.04em", textShadow: `0 0 40px ${rgba(C.verify, 0.5)}` }}>
              {Math.round(fid)}%
            </div>
          </div>
        </div>
      </Camera>
      <Hud chapter="05 — Verify · in reverse" tone="verify" />
    </AbsoluteFill>
  );
};
