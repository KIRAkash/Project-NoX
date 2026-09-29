import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Check, Chip, Hud, cardStyle } from "../components/Chrome";
import { Kinetic } from "../components/Kinetic";
import { LogoTile } from "../components/LogoTile";
import { Planet } from "../components/Planet";
import { MonoLabel } from "../components/Type";
import { rgba } from "../lib/color";
import { mono, sans } from "../lib/fonts";
import { ease, prog, pulse } from "../lib/motion";
import { C, KB_STATES } from "../lib/theme";

/*
 * 0:46 — Every source, one knowledge base. The camera is on one application:
 * its sources orbit it as moons and stream into it, an Open Knowledge Format
 * page writes itself with every claim cited, and the knowledge base climbs
 * the five states from In the Void to In Orbit.
 */

const PX = 560;
const PY = 590;

const MOONS = [
  { logo: "github", label: "Code" },
  { logo: "jira", label: "Tickets" },
  { logo: "confluence", label: "Docs" },
  { logo: "slack", label: "Threads" },
  { logo: "notion", label: "Specs" },
  { mark: "PDF", label: "Uploads" },
];

type Seg = { t: string; c: string };
const DOC: { segs: Seg[]; size?: number; font?: string }[] = [
  { segs: [{ t: "---", c: C.dim }] },
  { segs: [{ t: "type: ", c: C.ice }, { t: "concept", c: C.ink }] },
  { segs: [{ t: "title: ", c: C.ice }, { t: "Refund lifecycle", c: C.ink }] },
  { segs: [{ t: "sources: ", c: C.ice }, { t: "[github, jira, confluence]", c: C.ink }] },
  { segs: [{ t: "---", c: C.dim }] },
  { segs: [{ t: "# Refund lifecycle", c: C.ink }], size: 34, font: sans },
  { segs: [{ t: "Owns request → settled, partial refunds too.", c: C.muted }], size: 25, font: sans },
  { segs: [{ t: "Retries for 72h ", c: C.muted }, { t: "src/refunds/retry.py:42", c: C.nox }], size: 25, font: sans },
  { segs: [{ t: "Settles via ", c: C.muted }, { t: "[[kb:ledger-core/settlement]]", c: C.verify }], size: 25, font: sans },
];

const STATE_AT = [30, 60, 90, 120, 150];

export const Knowledge: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const feed = prog(frame, 30, 150);
  let state = 0;
  STATE_AT.forEach((s, i) => {
    if (frame >= s) state = i;
  });

  const moons = MOONS.map((m, i) => {
    const arrive = prog(frame, 4 + i * 5, 24 + i * 5, ease.out);
    const a = (i / MOONS.length) * Math.PI * 2 + frame * 0.013;
    const rx = 300 + (1 - arrive) * 700;
    const ry = 118 + (1 - arrive) * 300;
    const z = Math.sin(a);
    return { ...m, x: PX + Math.cos(a) * rx, y: PY + z * ry, z, s: 0.82 + 0.18 * (z + 1) / 2, arrive };
  });

  let lineStart = 34;
  const lines = DOC.map((l) => {
    const text = l.segs.map((s) => s.t).join("");
    const start = lineStart;
    lineStart += Math.ceil(text.length / 3.2) + 3;
    return { ...l, text, start };
  });

  const moon = (m: (typeof moons)[number], i: number) => (
    <div
      key={i}
      style={{
        position: "absolute",
        left: m.x - 46,
        top: m.y - 46,
        opacity: m.arrive,
        scale: String(m.s * (0.4 + 0.6 * m.arrive)),
      }}
    >
      <LogoTile logo={m.logo} mark={m.mark} size={92} round accent={C.ice} glow={0.3 * pulse(frame + i * 5, 30, 8)} />
      <MonoLabel size={14} color={C.faint} style={{ textAlign: "center", marginTop: 8 }}>
        {m.label}
      </MonoLabel>
    </div>
  );

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.29, y: 0.55, r: 800, color: C.ice, a: 0.1 + 0.05 * feed },
          { x: 0.8, y: 0.3, r: 800, color: C.verify, a: 0.05 },
        ]}
      />
      <Camera beat={1}>
        {/* data streams from every source into the one knowledge base */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {moons.map((m, i) =>
            frame > 30
              ? Array.from({ length: 5 }, (_, k) => {
                  const t = (((frame - 30) * 0.03 + k / 5 + i * 0.11) % 1 + 1) % 1;
                  return (
                    <circle
                      key={`${i}-${k}`}
                      cx={m.x + (PX - m.x) * t}
                      cy={m.y + (PY - m.y) * t}
                      r={3.5}
                      fill={k % 2 ? C.ice : C.nox}
                      opacity={Math.sin(t * Math.PI) * 0.9}
                    />
                  );
                })
              : null,
          )}
          {moons.map((m, i) => (
            <line key={i} x1={m.x} y1={m.y} x2={PX} y2={PY} stroke={rgba(C.ice, 0.14 * m.arrive)} strokeWidth={1.4} />
          ))}
        </svg>
        {moons.filter((m) => m.z < 0).map((m) => moon(m, moons.indexOf(m)))}
        <Planet x={PX} y={PY} size={200} hue={C.ice} glow={1 + feed} lit={0.3 * pulse(frame, 30, 10)} />
        {moons.filter((m) => m.z >= 0).map((m) => moon(m, moons.indexOf(m)))}
        <MonoLabel size={17} color={C.ink} style={{ position: "absolute", left: PX - 200, width: 400, textAlign: "center", top: PY + 250 }}>
          kb-refunds
        </MonoLabel>

        {/* the page it writes */}
        <div style={{ ...cardStyle(C.ice), left: 1010, top: 330, width: 790, height: 520 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "20px 28px",
              borderBottom: `1px solid ${C.hairline}`,
            }}
          >
            <span style={{ fontFamily: mono, fontSize: 17, color: C.faint }}>kb-refunds / refund-lifecycle.md</span>
            <Chip color={state === 4 ? C.verify : C.nox} size={14} filled>
              {KB_STATES[state]}
            </Chip>
          </div>
          <div style={{ padding: "22px 30px" }}>
            {lines.map((l, i) => {
              let used = 0;
              const n = Math.max(0, Math.floor((frame - l.start) * 3.2));
              return (
                <div
                  key={i}
                  style={{
                    fontFamily: l.font ?? mono,
                    fontSize: l.size ?? 22,
                    fontWeight: l.font === sans && i === 5 ? 600 : 400,
                    lineHeight: 1.62,
                    minHeight: (l.size ?? 22) * 1.62,
                    whiteSpace: "nowrap",
                  }}
                >
                  {l.segs.map((s, si) => {
                    const take = Math.max(0, Math.min(s.t.length, n - used));
                    used += s.t.length;
                    return (
                      <span key={si} style={{ color: s.c }}>
                        {s.t.slice(0, take)}
                      </span>
                    );
                  })}
                  {frame >= l.start && n < l.text.length ? (
                    <span style={{ display: "inline-block", width: 3, height: "1em", background: C.nox, translate: "2px 3px" }} />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ position: "absolute", left: 140, top: 150, width: 1500 }}>
          <Kinetic text="Every source, *one* knowledge base." start={4} stagger={2} size={78} />
        </div>
        <div style={{ position: "absolute", left: 140, top: 262, display: "flex", gap: 16 }}>
          {["Open Knowledge Format · OKF 0.2", "Checked on every push"].map((t, i) => {
            const s = spring({ frame: frame - 56 - i * 12, fps, config: { damping: 12, stiffness: 180 } });
            return (
              <Chip key={t} color={i === 0 ? C.nox : C.verify} size={16} style={{ opacity: Math.min(1, s * 2), scale: String(0.6 + 0.4 * s) }}>
                {t}
              </Chip>
            );
          })}
        </div>

        {/* In the Void → In Orbit */}
        <div style={{ position: "absolute", left: 180, right: 180, top: 940, height: 40 }}>
          <div style={{ position: "absolute", left: 60, right: 60, top: 19, height: 2, background: C.hairline }} />
          <div
            style={{
              position: "absolute",
              left: 60,
              top: 19,
              height: 2,
              width: `calc((100% - 120px) * ${prog(frame, 30, 150, ease.soft)})`,
              background: `linear-gradient(90deg, ${C.nox}, ${state === 4 ? C.verify : C.nox})`,
              boxShadow: `0 0 12px ${C.nox}`,
            }}
          />
          <div style={{ position: "relative", display: "flex", justifyContent: "space-between" }}>
            {KB_STATES.map((s, i) => {
              const on = frame >= STATE_AT[i];
              const hit = frame - STATE_AT[i];
              const done = i === 4 && on;
              const color = done ? C.verify : on ? C.nox : C.dim;
              return (
                <div
                  key={s}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 16px",
                    borderRadius: 999,
                    background: on ? rgba(color, 0.14) : C.deck,
                    border: `1.5px solid ${rgba(color, on ? 0.8 : 0.4)}`,
                    fontFamily: mono,
                    fontSize: 16,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: on ? C.ink : C.dim,
                    boxShadow: on && hit < 14 ? `0 0 ${40 * (1 - hit / 14)}px ${color}` : undefined,
                    scale: String(on && hit < 8 ? 1 + 0.12 * (1 - hit / 8) : 1),
                  }}
                >
                  {done ? <Check size={18} /> : <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />}
                  {s}
                </div>
              );
            })}
          </div>
        </div>
      </Camera>
      <Hud chapter="02 — Atlas · knowledge bases" />
    </AbsoluteFill>
  );
};
