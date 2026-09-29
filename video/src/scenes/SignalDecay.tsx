import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Hud, Warn } from "../components/Chrome";
import { Glitch } from "../components/Glitch";
import { Kinetic } from "../components/Kinetic";
import { MonoLabel } from "../components/Type";
import { mixHex, rgba } from "../lib/color";
import { display, sans } from "../lib/fonts";
import { CLAMP, ease, prog } from "../lib/motion";
import { C } from "../lib/theme";

/*
 * 0:05 — The problem, as a relay. The sentence flies from seat to seat along
 * a trajectory; at every handoff its fidelity drops (100 → 14%), the packet
 * dims and the text of the spec itself starts to corrupt. Then the line from
 * the landing page lands: it is lost *between* the work.
 */

const STATIONS = [
  {
    name: "Business",
    fid: 100,
    line: "“Refunds take three days, and customers keep calling us about it.”",
    loss: "Knows the pain exactly. Knows nothing about which systems cause it.",
  },
  {
    name: "Product",
    fid: 74,
    line: "Becomes a one-line Jira epic: “Faster refunds.”",
    loss: "The partial-refund edge case is already gone. Nobody noticed.",
  },
  {
    name: "Architecture",
    fid: 52,
    line: "A spec written from memory of a system that changed two quarters ago.",
    loss: "Misses that Ledger Core owns idempotency, not Payments.",
  },
  {
    name: "Build",
    fid: 32,
    line: "The agent reads one repository and writes a correct change to the wrong service.",
    loss: "It never saw the three other services the change touches.",
  },
  {
    name: "Verify",
    fid: 14,
    line: "QA tests the ticket. Nobody tests the sentence.",
    loss: "Shipped, closed — and still three days.",
  },
];

/** Arrival frame at each station, one bar apart. */
const ARRIVE = [15, 75, 135, 195, 255];
const END = 312;
const XS = [250, 605, 960, 1315, 1670];
const Y = 300;

const fidColor = (fid: number) => {
  const t = fid / 100;
  return t > 0.5 ? mixHex(C.ember, C.nox, (t - 0.5) / 0.5) : mixHex("#8C4150", C.ember, t / 0.5);
};

const GLYPHS = "#%&@$?!/<>*";
const corrupt = (text: string, rate: number, seed: string) =>
  text
    .split("")
    .map((ch, i) => (ch !== " " && random(`${seed}-${i}`) < rate ? GLYPHS[Math.floor(random(`${seed}-g-${i}`) * GLYPHS.length)] : ch))
    .join("");

/** Where the packet is at a frame: flying in, then hopping along arcs between stations. */
const packetAt = (f: number) => {
  if (f < ARRIVE[0]) {
    const t = prog(f, 0, ARRIVE[0], ease.out);
    return { x: interpolate(t, [0, 1], [-80, XS[0]]), y: Y };
  }
  for (let k = 1; k < ARRIVE.length; k++) {
    const a = ARRIVE[k] - 26;
    if (f < a) return { x: XS[k - 1], y: Y };
    if (f < ARRIVE[k]) {
      const t = prog(f, a, ARRIVE[k], ease.inOut);
      const x = interpolate(t, [0, 1], [XS[k - 1], XS[k]]);
      return { x, y: Y - Math.sin(t * Math.PI) * 110 };
    }
  }
  return { x: XS[4], y: Y };
};

export const SignalDecay: React.FC = () => {
  const frame = useCurrentFrame();

  // which station the signal has reached, and the fidelity readout easing between them
  let k = 0;
  for (let i = 0; i < ARRIVE.length; i++) if (frame >= ARRIVE[i]) k = i;
  const prevFid = k === 0 ? 100 : STATIONS[k - 1].fid;
  const fid = interpolate(frame, [ARRIVE[k], ARRIVE[k] + 14], [prevFid, STATIONS[k].fid], { ...CLAMP, easing: ease.out });
  const color = fidColor(fid);
  const sinceHit = frame - ARRIVE[k];
  const spike = frame >= ARRIVE[0] && sinceHit < 7 && k > 0 ? 1 - sinceHit / 7 : 0;
  const damage = (1 - fid / 100) * 0.27 + spike * 0.6;

  const pushBack = prog(frame, END - 4, END + 12, ease.out);
  const pk = packetAt(frame);
  const jitter = (1 - fid / 100) * 9;
  const jx = (random(`pj-x-${Math.floor(frame / 2)}`) - 0.5) * jitter;
  const jy = (random(`pj-y-${Math.floor(frame / 2)}`) - 0.5) * jitter;

  const arcPath = XS.slice(1)
    .map((x, i) => `Q ${(XS[i] + x) / 2} ${Y - 220} ${x} ${Y}`)
    .join(" ");

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.2, y: 0.25, r: 900, color: C.nox, a: 0.07 * (fid / 100) },
          { x: 0.85, y: 0.8, r: 1000, color: C.ember, a: 0.06 + 0.04 * (1 - fid / 100) },
        ]}
      />
      <Camera hits={[...ARRIVE.slice(1), 345]} shakeAmp={10}>
        <AbsoluteFill
          style={{
            opacity: 1 - pushBack * 0.9,
            scale: String(1 - pushBack * 0.08),
            filter: pushBack > 0 ? `blur(${pushBack * 7}px)` : undefined,
          }}
        >
          {/* the trajectory */}
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
            <path
              d={`M ${XS[0]} ${Y} ${arcPath}`}
              fill="none"
              stroke={C.hairlineStrong}
              strokeWidth={2}
              strokeDasharray="4 10"
            />
            {Array.from({ length: 12 }, (_, i) => {
              const p = packetAt(frame - i * 1.5);
              return (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={Math.max(1, (10 - i * 0.7) * (0.55 + (0.45 * fid) / 100))}
                  fill={color}
                  opacity={(1 - i / 12) * 0.55}
                />
              );
            })}
          </svg>

          {XS.map((x, i) => {
            const reached = frame >= ARRIVE[i];
            const hit = frame - ARRIVE[i];
            const ring = reached ? prog(frame, ARRIVE[i], ARRIVE[i] + 20, ease.out) : 0;
            const c = fidColor(STATIONS[i].fid);
            return (
              <div key={i}>
                <div
                  style={{
                    position: "absolute",
                    left: x - 26,
                    top: Y - 26,
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    border: `2px solid ${reached ? c : C.hairlineStrong}`,
                    background: reached ? rgba(c, 0.18) : "transparent",
                    boxShadow: reached ? `0 0 ${24 + (hit < 12 ? 40 * (1 - hit / 12) : 0)}px ${rgba(c, 0.6)}` : undefined,
                  }}
                />
                {reached && ring < 1 ? (
                  <div
                    style={{
                      position: "absolute",
                      left: x - 26 - ring * 70,
                      top: Y - 26 - ring * 70,
                      width: 52 + ring * 140,
                      height: 52 + ring * 140,
                      borderRadius: "50%",
                      border: `2px solid ${c}`,
                      opacity: 1 - ring,
                    }}
                  />
                ) : null}
                <MonoLabel
                  size={17}
                  color={reached ? C.ink : C.dim}
                  style={{ position: "absolute", left: x - 150, width: 300, top: Y + 48, textAlign: "center" }}
                >
                  {`0${i + 1} · ${STATIONS[i].name}`}
                </MonoLabel>
              </div>
            );
          })}

          {/* the packet: the sentence itself */}
          <div
            style={{
              position: "absolute",
              left: pk.x + jx - 14,
              top: pk.y + jy - 14,
              width: 28,
              height: 28,
              borderRadius: 14,
              background: mixHex("#FFFFFF", color, 0.35),
              boxShadow: `0 0 ${16 + fid * 0.3}px ${6 + fid * 0.08}px ${rgba(color, 0.85)}`,
              opacity: 0.45 + (0.55 * fid) / 100,
            }}
          />

          {/* fidelity readout */}
          <div style={{ position: "absolute", left: 140, top: 520, width: 560 }}>
            <MonoLabel size={19} color={C.faint}>
              Signal fidelity
            </MonoLabel>
            <Glitch amount={damage * 0.8} seed="fid">
              <div
                style={{
                  fontFamily: display,
                  fontWeight: 600,
                  fontSize: 230,
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                  color,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 8,
                  textShadow: `0 0 60px ${rgba(color, 0.35)}`,
                }}
              >
                {Math.round(fid)}%
              </div>
            </Glitch>
            <div style={{ marginTop: 22, width: 520, height: 6, borderRadius: 3, background: C.hairline }}>
              <div
                style={{
                  width: `${fid}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: `linear-gradient(90deg, ${color}, ${rgba(color, 0.2)})`,
                  boxShadow: `0 0 18px ${rgba(color, 0.7)}`,
                }}
              />
            </div>
          </div>

          {/* the spec as it stands at this seat */}
          {STATIONS.map((s, i) => {
            const from = ARRIVE[i];
            const to = i < 4 ? ARRIVE[i + 1] : END + 20;
            if (frame < from - 1 || frame > to + 4) return null;
            const rate = [0, 0.02, 0.04, 0.07, 0.1][i];
            const step = Math.floor(frame / 3);
            const lineColor = mixHex(C.ink, C.muted, 1 - s.fid / 100);
            return (
              <div key={i} style={{ position: "absolute", left: 800, top: 540, width: 1000 }}>
                <MonoLabel size={20} color={fidColor(s.fid)} style={{ opacity: prog(frame, from, from + 6) }}>
                  {`0${i + 1} · ${s.name} · fidelity ${s.fid}%`}
                </MonoLabel>
                <Glitch amount={i === 0 ? spike * 0.4 : damage} seed={`line-${i}`} style={{ marginTop: 20 }}>
                  <Kinetic
                    text={corrupt(s.line, rate, `c-${i}-${step}`)}
                    start={from + 2}
                    stagger={1}
                    size={54}
                    weight={500}
                    color={lineColor}
                    lineHeight={1.16}
                    tracking="-0.02em"
                    exit={to - 9}
                  />
                </Glitch>
                <div
                  style={{
                    marginTop: 28,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontFamily: sans,
                    fontSize: 30,
                    color: rgba(C.ember, 0.95),
                    opacity: prog(frame, from + 16, from + 24) * (1 - prog(frame, to - 9, to - 2)),
                    translate: `0px ${(1 - prog(frame, from + 16, from + 26)) * 18}px`,
                  }}
                >
                  <Warn size={30} />
                  {s.loss}
                </div>
              </div>
            );
          })}
        </AbsoluteFill>

        {/* the line the whole problem comes down to */}
        {frame >= END ? (
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 34 }}>
            <Kinetic text="Nothing is lost in the work." start={END + 2} stagger={2} size={92} mode="rise" align="center" color={C.muted} />
            <Glitch amount={frame >= 345 && frame < 351 ? 0.6 : 0} seed="between">
              <Kinetic text="It is lost *between* the work." start={345} stagger={3} size={138} mode="slam" accent="ember" align="center" tracking="-0.035em" />
            </Glitch>
          </AbsoluteFill>
        ) : null}
      </Camera>
      <Hud chapter="01 — The problem" tone="ember" />
    </AbsoluteFill>
  );
};
