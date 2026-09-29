import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Check, Chip, Hud, cardStyle } from "../components/Chrome";
import { Estate, estateLayout } from "../components/Estate";
import { Kinetic } from "../components/Kinetic";
import { MonoLabel } from "../components/Type";
import { rgba } from "../lib/color";
import { mono, sans } from "../lib/fonts";
import { ease, prog, pulse } from "../lib/motion";
import { C } from "../lib/theme";

/*
 * 0:38 — Feature one: Atlas. Out of the star comes the estate itself, the
 * applications on their orbits and the contracts between them drawing on
 * one by one. Ledger Core lights up with the contracts it holds.
 */

const EX = 1260;
const EY = 560;

const POINTS = [
  "A code wiki for every application",
  "Built from code, docs, tickets and chat",
  "Contracts mapped across the whole org",
];

const LEVELS = ["Org", "Team", "Sub-team", "App"];

export const Atlas: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const arrive = prog(frame, 0, 30, ease.out);
  const yaw = 0.3 + frame * 0.004 + (1 - arrive) * 1.4;
  const params = {
    cx: EX,
    cy: EY,
    radius: 1.2 * (0.25 + 0.75 * arrive),
    pitch: 0.5,
    yaw,
    time: frame + 400,
    orbitSpeed: 5,
  };
  const focus = prog(frame, 158, 170, ease.out);
  const ledger = estateLayout(params).byId.ledger;

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.66, y: 0.52, r: 900, color: C.nox, a: 0.08 + 0.03 * pulse(frame) },
          { x: 0.05, y: 0.1, r: 800, color: C.ice, a: 0.07 },
        ]}
      />
      <Camera beat={1}>
        <Estate
          {...params}
          orbitDraw={prog(frame, 4, 34, ease.out)}
          pop={(i) => spring({ frame: frame - 8 - i * 3, fps, config: { damping: 12, stiffness: 170 } })}
          planetScale={1.25}
          sun={{ size: 96 * arrive, glow: 1 + 0.4 * pulse(frame), spin: frame * 0.4, flare: 0.3 }}
          labels={prog(frame, 34, 50)}
          mesh={(i) => prog(frame, 56 + i * 9, 72 + i * 9, ease.out)}
          lit={{ ledger: focus * (0.6 + 0.4 * pulse(frame, 15, 6)) }}
        />

        {/* Ledger Core, up close */}
        {frame >= 158 ? (
          <>
            <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: focus }}>
              <path
                d={`M ${ledger.x} ${ledger.y - 20} C ${ledger.x + 40} ${ledger.y - 160}, ${1500} ${330}, ${1520} ${290}`}
                fill="none"
                stroke={rgba(C.nox, 0.7)}
                strokeWidth={1.6}
                strokeDasharray="5 6"
              />
            </svg>
            <div
              style={{
                ...cardStyle(C.nox),
                left: 1400,
                top: 120,
                width: 430,
                padding: "22px 26px",
                opacity: focus,
                translate: `0px ${(1 - focus) * 30}px`,
              }}
            >
              <MonoLabel size={15} color={C.nox}>
                Ledger Core · book of record
              </MonoLabel>
              {[
                ["http", "POST /internal/entries", "refunds · payments"],
                ["event", "entry.settled", "reporting · notify"],
              ].map(([kind, left, right], i) => (
                <div
                  key={left}
                  style={{
                    marginTop: 14,
                    fontFamily: mono,
                    fontSize: 17,
                    color: C.ink,
                    opacity: prog(frame, 166 + i * 7, 174 + i * 7),
                  }}
                >
                  <span style={{ color: C.ice, marginRight: 10 }}>{kind}</span>
                  {left}
                  <div style={{ color: C.faint, fontSize: 15, marginTop: 4 }}>→ {right}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* the pitch */}
        <div style={{ position: "absolute", left: 140, top: 200, width: 760 }}>
          <Kinetic text="One map of every application your *enterprise* runs." start={8} stagger={2} size={80} />
          <div style={{ marginTop: 44, display: "flex", flexDirection: "column", gap: 22 }}>
            {POINTS.map((p, i) => {
              const t = prog(frame, 62 + i * 15, 76 + i * 15, ease.out);
              return (
                <div
                  key={p}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    fontFamily: sans,
                    fontSize: 34,
                    color: C.muted,
                    opacity: t,
                    translate: `${(1 - t) * -40}px 0px`,
                  }}
                >
                  <Check size={30} draw={prog(frame, 64 + i * 15, 76 + i * 15)} />
                  {p}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 50, display: "flex", alignItems: "center", gap: 12 }}>
            {LEVELS.map((level, i) => {
              const s = spring({ frame: frame - 118 - i * 7, fps, config: { damping: 11, stiffness: 190 } });
              return (
                <div key={level} style={{ display: "flex", alignItems: "center", gap: 12, opacity: Math.min(1, s * 2) }}>
                  <Chip color={i === 3 ? C.nox : C.ice} filled={i === 3} style={{ scale: String(0.5 + 0.5 * s) }}>
                    {level}
                  </Chip>
                  {i < 3 ? <span style={{ fontFamily: mono, fontSize: 22, color: C.faint }}>→</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      </Camera>
      <Hud chapter="02 — Atlas · the living map" />
    </AbsoluteFill>
  );
};
