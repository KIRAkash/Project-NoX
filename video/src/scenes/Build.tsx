import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Hud, cardStyle } from "../components/Chrome";
import { Kinetic } from "../components/Kinetic";
import { LogoTile } from "../components/LogoTile";
import { Sun } from "../components/Sun";
import { MonoLabel, Typewriter } from "../components/Type";
import { rgba } from "../lib/color";
import { mono, sans } from "../lib/fonts";
import { prog, pulse } from "../lib/motion";
import { C } from "../lib/theme";

/*
 * 1:08 — Build. One command in the terminal loads the mission, the four
 * spec files and every knowledge base the change touches; the pull request
 * opens with the guard's verdict on it. Around the /nox core, the coding
 * agents it plugs into.
 */

type Line = { at: number; text: string; color: string; dim?: string };
const LINES: Line[] = [
  { at: 50, text: "▸ mission   ", dim: "NOX-12 · same-day refunds", color: C.ice },
  { at: 58, text: "▸ specs     ", dim: "01-business → 04-developer", color: C.ice },
  { at: 66, text: "▸ atlas     ", dim: "ledger-core · refunds · notify", color: C.ice },
  { at: 74, text: "▸ contract  ", dim: "refund.completed + settled_at", color: C.ice },
  { at: 82, text: "▸ build     ", dim: "4 repositories · 9 tasks", color: C.ice },
  { at: 118, text: "✓ PR #214   ", dim: "opened across 4 repos", color: C.verify },
  { at: 128, text: "✓ guard     ", dim: "ADR-014 respected · 0 violations", color: C.verify },
];

const AGENTS = [
  { logo: "antigravity", name: "Antigravity" },
  { logo: "cursor", name: "Cursor" },
  { logo: "codex", name: "Codex" },
  { logo: "copilot", name: "Copilot" },
  { logo: "claude", name: "Claude Code" },
];

const OX = 1470;
const OY = 590;
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export const Build: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const built = frame >= 112;

  const agents = AGENTS.map((a, i) => {
    const ang = -Math.PI / 2 + (i / AGENTS.length) * Math.PI * 2 + frame * 0.012;
    const z = Math.sin(ang);
    return { ...a, x: OX + Math.cos(ang) * 300, y: OY + z * 150, z, s: spring({ frame: frame - 18 - i * 7, fps, config: { damping: 11, stiffness: 180 } }) };
  });

  const tile = (a: (typeof agents)[number], i: number) => (
    <div
      key={a.name}
      style={{
        position: "absolute",
        left: a.x - 52,
        top: a.y - 52,
        scale: String(a.s * (0.8 + 0.2 * (a.z + 1) / 2)),
        opacity: Math.min(1, a.s * 2) * (0.7 + 0.3 * (a.z + 1) / 2),
      }}
    >
      <LogoTile logo={a.logo} size={104} accent={i === 0 ? C.nox : C.ice} glow={i === 0 ? 0.6 + 0.4 * pulse(frame, 15, 5) : 0} />
      <MonoLabel size={14} color={i === 0 ? C.nox : C.faint} style={{ textAlign: "center", marginTop: 10, width: 104 }}>
        {a.name}
      </MonoLabel>
    </div>
  );

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.77, y: 0.55, r: 800, color: C.nox, a: 0.08 },
          { x: 0.2, y: 0.8, r: 900, color: C.ice, a: 0.07 },
        ]}
      />
      <Camera beat={1} hits={[118]} shakeAmp={6}>
        <div style={{ position: "absolute", left: 140, top: 150, width: 1700 }}>
          <Kinetic text="Your coding agent gets the *map*." start={4} stagger={2} size={86} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 140,
            top: 262,
            width: 1300,
            fontFamily: sans,
            fontSize: 30,
            color: C.muted,
            opacity: prog(frame, 16, 26),
            translate: `0px ${(1 - prog(frame, 16, 28)) * 20}px`,
          }}
        >
          One command loads the mission and every knowledge base it touches.
        </div>

        {/* the terminal */}
        <div style={{ ...cardStyle(), left: 140, top: 350, width: 960, height: 540, opacity: prog(frame, 8, 18), scale: String(0.94 + 0.06 * prog(frame, 8, 22)) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "16px 22px", borderBottom: `1px solid ${C.hairline}` }}>
            {[C.ember, C.nox, C.verify].map((c) => (
              <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: rgba(c, 0.75) }} />
            ))}
            <span style={{ marginLeft: 14, fontFamily: mono, fontSize: 16, color: C.faint }}>~/payments-platform — antigravity</span>
          </div>
          <div style={{ padding: "26px 34px", fontFamily: mono, fontSize: 25, lineHeight: 1.72 }}>
            <div style={{ color: C.ink }}>
              <span style={{ color: C.nox }}>$ </span>
              <Typewriter text="/nox NOX-12" start={26} cps={0.8} caret={frame < 48} />
            </div>
            {LINES.map((l, i) => {
              if (frame < l.at) return null;
              const t = prog(frame, l.at, l.at + 5);
              const spinning = i === 4 && !built;
              return (
                <div key={i} style={{ opacity: t, translate: `${(1 - t) * -10}px 0px`, whiteSpace: "pre", color: l.color }}>
                  {l.text}
                  <span style={{ color: i >= 5 ? C.ink : C.muted }}>{l.dim}</span>
                  {spinning ? <span style={{ color: C.nox }}>{"  " + SPINNER[Math.floor(frame / 2) % SPINNER.length]}</span> : null}
                  {i === 4 && built ? <span style={{ color: C.verify }}>{"  ✓"}</span> : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* the /nox core and the agents around it */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <ellipse cx={OX} cy={OY} rx={300} ry={150} fill="none" stroke={rgba(C.ice, 0.22)} strokeWidth={1.5} strokeDasharray="3 8" />
          {agents.map((a, i) => {
            const t = (((frame - 20) * 0.03 + i * 0.2) % 1 + 1) % 1;
            return (
              <g key={a.name} opacity={a.s}>
                <line x1={OX} y1={OY} x2={a.x} y2={a.y} stroke={rgba(i === 0 ? C.nox : C.ice, 0.25)} strokeWidth={1.4} />
                <circle cx={OX + (a.x - OX) * t} cy={OY + (a.y - OY) * t} r={4} fill={i === 0 ? C.nox : C.ice} opacity={Math.sin(t * Math.PI)} />
              </g>
            );
          })}
        </svg>
        {agents.filter((a) => a.z < 0).map((a) => tile(a, agents.indexOf(a)))}
        <Sun x={OX} y={OY} size={96} glow={0.8 + 0.4 * pulse(frame)} spin={frame * 0.5} flare={0.25} opacity={prog(frame, 6, 16)} />
        <div
          style={{
            position: "absolute",
            left: OX - 60,
            top: OY - 18,
            width: 120,
            textAlign: "center",
            fontFamily: mono,
            fontWeight: 600,
            fontSize: 28,
            color: "#3A2206",
            opacity: prog(frame, 10, 18),
          }}
        >
          /nox
        </div>
        {agents.filter((a) => a.z >= 0).map((a) => tile(a, agents.indexOf(a)))}
        <MonoLabel size={17} color={C.muted} style={{ position: "absolute", left: OX - 400, width: 800, textAlign: "center", top: 860, opacity: prog(frame, 60, 72) }}>
          Works in the agent you already use
        </MonoLabel>
      </Camera>
      <Hud chapter="04 — Build · /nox" />
    </AbsoluteFill>
  );
};
