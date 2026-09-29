import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Hud, Warn, cardStyle } from "../components/Chrome";
import { Kinetic } from "../components/Kinetic";
import { Planet } from "../components/Planet";
import { MonoLabel } from "../components/Type";
import { rgba } from "../lib/color";
import { display, mono } from "../lib/fonts";
import { CLAMP, ease, prog, pulse } from "../lib/motion";
import { APPS, C } from "../lib/theme";

/*
 * 1:02 — The contract map at work. A change lands in Ledger Core and the
 * shock travels along the contracts, lighting every application that feels
 * it, including the one nobody put in scope. Then a guardrail refuses the
 * diff that would have broken the rule.
 */

const CX = 1290;
const CY = 520;

/** Around Ledger Core, and the frame at which the change reaches each one. */
const NODES: { id: string; angle: number; hit: number | null; from: string }[] = [
  { id: "refunds", angle: -2.5, hit: 38, from: "ledger" },
  { id: "payments", angle: -0.6, hit: 44, from: "ledger" },
  { id: "reporting", angle: 1.9, hit: 50, from: "ledger" },
  { id: "notify", angle: -1.55, hit: 66, from: "refunds" },
  { id: "risk", angle: 0.35, hit: 72, from: "payments" },
  { id: "portal", angle: 1.05, hit: 78, from: "payments" },
  { id: "identity", angle: 2.85, hit: null, from: "portal" },
];

const RX = 440;
const RY = 250;

export const BlastRadius: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pos: Record<string, { x: number; y: number }> = { ledger: { x: CX, y: CY } };
  NODES.forEach((n) => {
    const a = n.angle + Math.sin(frame * 0.01) * 0.03;
    pos[n.id] = { x: CX + Math.cos(a) * RX, y: CY + Math.sin(a) * RY };
  });
  const hits = NODES.filter((n) => n.hit !== null && frame >= n.hit).length;
  const appear = prog(frame, 0, 20, ease.out);
  const guard = prog(frame, 118, 132, ease.out);
  const refused = spring({ frame: frame - 140, fps, config: { damping: 10, stiffness: 220 } });

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.67, y: 0.48, r: 900, color: C.ember, a: 0.05 + 0.06 * prog(frame, 30, 80) },
          { x: 0.1, y: 0.2, r: 700, color: C.ice, a: 0.06 },
        ]}
      />
      <Camera beat={1} hits={[26]} shakeAmp={10}>
        {/* shockwaves from the change */}
        {[26, 40, 54].map((d, i) => {
          const t = prog(frame, d, d + 40, ease.out);
          if (t <= 0 || t >= 1) return null;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: CX - t * 620,
                top: CY - t * 360,
                width: t * 1240,
                height: t * 720,
                borderRadius: "50%",
                border: `${3 * (1 - t) + 1}px solid ${rgba(C.ember, 0.8 * (1 - t))}`,
              }}
            />
          );
        })}

        {/* contracts, turning ember as the change travels along them */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: appear }}>
          {NODES.map((n) => {
            const a = pos[n.from];
            const b = pos[n.id];
            const start = n.hit === null ? Infinity : n.hit - 12;
            const t = n.hit === null ? 0 : prog(frame, start, n.hit, ease.inOut);
            return (
              <g key={n.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={rgba(C.ice, 0.3)} strokeWidth={1.6} strokeDasharray="4 6" />
                {t > 0 ? (
                  <>
                    <line x1={a.x} y1={a.y} x2={a.x + (b.x - a.x) * t} y2={a.y + (b.y - a.y) * t} stroke={rgba(C.ember, 0.3)} strokeWidth={9} strokeLinecap="round" />
                    <line x1={a.x} y1={a.y} x2={a.x + (b.x - a.x) * t} y2={a.y + (b.y - a.y) * t} stroke={C.ember} strokeWidth={2.4} />
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>

        {NODES.map((n, i) => {
          const app = APPS.find((a) => a.id === n.id)!;
          const p = pos[n.id];
          const s = spring({ frame: frame - 4 - i * 2, fps, config: { damping: 12, stiffness: 170 } });
          const hitAge = n.hit === null ? -1 : frame - n.hit;
          const lit = hitAge >= 0 ? Math.max(0.35, 1 - hitAge / 20) : 0;
          return (
            <div key={n.id}>
              <Planet x={p.x} y={p.y} size={58 * s * (hitAge >= 0 && hitAge < 8 ? 1.25 - hitAge * 0.03 : 1)} hue={app.hue} lit={lit} glow={0.8} />
              {hitAge >= 0 ? (
                <div
                  style={{
                    position: "absolute",
                    left: p.x - 50,
                    top: p.y - 50,
                    width: 100,
                    height: 100,
                    borderRadius: "50%",
                    border: `2px solid ${C.ember}`,
                    opacity: Math.max(0.25, 1 - hitAge / 16),
                    scale: String(1 + Math.min(1, hitAge / 16) * 0.5),
                  }}
                />
              ) : null}
              <div style={{ position: "absolute", left: p.x - 140, width: 280, top: p.y + 44, textAlign: "center", opacity: s }}>
                <div style={{ fontFamily: mono, fontSize: 17, color: C.ink }}>{app.name}</div>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 13,
                    letterSpacing: "0.16em",
                    marginTop: 4,
                    color: hitAge >= 0 ? C.ember : C.dim,
                  }}
                >
                  {n.id === "reporting" && frame >= 92 ? "NOT IN SCOPE · FOUND" : hitAge >= 0 ? "AFFECTED" : "UPSTREAM · SAFE"}
                </div>
              </div>
            </div>
          );
        })}
        {frame >= 92 ? (
          <div
            style={{
              position: "absolute",
              left: pos.reporting.x - 64,
              top: pos.reporting.y - 64,
              width: 128,
              height: 128,
              borderRadius: "50%",
              border: `2px dashed ${C.nox}`,
              rotate: `${frame * 1.4}deg`,
              opacity: prog(frame, 92, 100),
            }}
          />
        ) : null}

        <Planet x={CX} y={CY} size={120 * appear} hue="#E8C97A" ring lit={frame >= 26 ? 0.4 + 0.6 * pulse(frame - 26, 15, 6) : 0} glow={1.2} />
        <div style={{ position: "absolute", left: CX - 160, width: 320, top: CY + 76, textAlign: "center", opacity: appear }}>
          <div style={{ fontFamily: mono, fontSize: 18, color: C.ink }}>Ledger Core</div>
        </div>
        <div
          style={{
            position: "absolute",
            left: CX - 125,
            top: CY - 150,
            opacity: prog(frame, 18, 26),
            scale: String(interpolate(frame, [18, 26], [1.6, 1], { ...CLAMP, easing: ease.out })),
            fontFamily: mono,
            fontSize: 17,
            color: C.verify,
            padding: "7px 12px",
            borderRadius: 8,
            border: `1.5px solid ${rgba(C.verify, 0.6)}`,
            background: "rgba(9,11,19,0.85)",
            whiteSpace: "nowrap",
          }}
        >
          + intra-day settlement
        </div>

        {/* the pitch and the count */}
        <div style={{ position: "absolute", left: 140, top: 200, width: 680 }}>
          <Kinetic text="See the *blast radius* before anything ships." start={4} stagger={2} size={78} accent="ember" />
          <MonoLabel size={18} color={C.faint} style={{ marginTop: 54 }}>
            Applications affected
          </MonoLabel>
          <div
            style={{
              fontFamily: display,
              fontWeight: 600,
              fontSize: 190,
              lineHeight: 1,
              color: hits > 0 ? C.ember : C.dim,
              letterSpacing: "-0.04em",
              marginTop: 6,
              textShadow: hits > 0 ? `0 0 50px ${rgba(C.ember, 0.4)}` : undefined,
            }}
          >
            {hits}
          </div>
        </div>

        {/* the guardrail */}
        <div
          style={{
            ...cardStyle(C.ember),
            left: 140,
            top: 830,
            width: 700,
            padding: "20px 26px",
            opacity: guard,
            translate: `${(1 - guard) * -60}px 0px`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Warn size={24} />
            <MonoLabel size={16} color={C.ember}>
              ADR-014 · only Ledger Core writes entries
            </MonoLabel>
          </div>
          <div style={{ marginTop: 12, fontFamily: mono, fontSize: 20, color: C.muted, position: "relative", display: "inline-block" }}>
            refunds → POST /internal/entries
            <div
              style={{
                position: "absolute",
                left: 0,
                top: "52%",
                height: 2.5,
                width: `${prog(frame, 134, 142) * 100}%`,
                background: C.ember,
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              right: 26,
              top: 50,
              padding: "8px 14px",
              border: `2.5px solid ${C.ember}`,
              borderRadius: 8,
              color: C.ember,
              fontFamily: mono,
              fontWeight: 600,
              fontSize: 20,
              letterSpacing: "0.2em",
              rotate: "-8deg",
              opacity: Math.min(1, refused * 3),
              scale: String(interpolate(refused, [0, 1], [2.6, 1])),
            }}
          >
            REFUSED
          </div>
        </div>
      </Camera>
      <Hud chapter="03 — Missions · blast radius" tone="ember" />
    </AbsoluteFill>
  );
};
