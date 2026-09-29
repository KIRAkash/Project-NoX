import { useMemo } from "react";
import { AbsoluteFill, random, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Camera } from "../components/Camera";
import { Hud } from "../components/Chrome";
import { Glitch } from "../components/Glitch";
import { Kinetic } from "../components/Kinetic";
import { MonoLabel } from "../components/Type";
import { rgba } from "../lib/color";
import { ease, prog, pulse } from "../lib/motion";
import { project, rotX, rotY, type V3 } from "../lib/space";
import { APPS, C } from "../lib/theme";

/*
 * 0:18 — Why the relay fails: the estate. A tangle of applications and
 * contracts bursts out of the centre while the scale lands on the beat.
 * Then everything dims but one node: the single repository a coding agent
 * is shown, and the wrong service it changes.
 */

const N = 110;
const EDGES = 170;
const CX = 960;
const CY = 540;

export const Chaos: React.FC = () => {
  const frame = useCurrentFrame();

  const nodes = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const u = random(`n-u-${i}`) * 2 - 1;
        const th = random(`n-t-${i}`) * Math.PI * 2;
        const r = 260 + Math.cbrt(random(`n-r-${i}`)) * 560;
        const s = Math.sqrt(1 - u * u);
        return {
          p: { x: Math.cos(th) * s * r * 1.7, y: u * r * 0.85, z: Math.sin(th) * s * r } as V3,
          hue: APPS[Math.floor(random(`n-h-${i}`) * APPS.length)].hue,
          size: 5 + random(`n-s-${i}`) * 9,
          warn: random(`n-w-${i}`) < 0.09,
        };
      }),
    [],
  );
  const edges = useMemo(
    () =>
      Array.from({ length: EDGES }, (_, i) => {
        const a = Math.floor(random(`e-a-${i}`) * N);
        let b = Math.floor(random(`e-b-${i}`) * N);
        if (b === a) b = (b + 7) % N;
        return [a, b] as const;
      }),
    [],
  );

  const burst = prog(frame, 0, 26, ease.out);
  const yaw = frame * 0.006 + (1 - burst) * 0.8;
  const focus = prog(frame, 122, 140, ease.out);
  const pts = nodes.map((n) => {
    let p: V3 = { x: n.p.x * burst, y: n.p.y * burst, z: n.p.z * burst };
    p = rotY(p, yaw);
    p = rotX(p, 0.28);
    return project(p, CX, CY, 1500);
  });
  const step = Math.floor(frame / 3);

  // the one repository the agent is shown, and the service it wrongly changes
  const repo = { x: 1400, y: 610 };
  const wrong = { x: 1690, y: 330 };
  const stamp = prog(frame, 172, 180, ease.out);

  return (
    <AbsoluteFill>
      <Backdrop
        nebulae={[
          { x: 0.5, y: 0.5, r: 1100, color: C.ember, a: 0.05 + 0.04 * pulse(frame) },
          { x: 0.1, y: 0.1, r: 800, color: C.ice, a: 0.06 },
        ]}
      />
      <Camera hits={[3, 33, 63, 172]} shakeAmp={12} beat={frame < 120 ? 1 : 0}>
        <AbsoluteFill style={{ opacity: 1 - focus * 0.78 }}>
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
            {edges.map(([a, b], i) => {
              const hot = random(`e-hot-${i}-${step}`) < 0.06;
              const pa = pts[a];
              const pb = pts[b];
              return (
                <line
                  key={i}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={hot ? C.ember : "rgba(143,160,204,1)"}
                  strokeWidth={hot ? 1.8 : 1}
                  opacity={(hot ? 0.75 : 0.16) * Math.min(pa.scale, pb.scale) * burst}
                />
              );
            })}
          </svg>
          {nodes.map((n, i) => {
            const p = pts[i];
            const d = n.size * p.scale * 1.6;
            const blink = n.warn && Math.floor((frame + i * 5) / 12) % 3 === 0;
            return (
              <div key={i}>
                <div
                  style={{
                    position: "absolute",
                    left: p.x - d / 2,
                    top: p.y - d / 2,
                    width: d,
                    height: d,
                    borderRadius: "50%",
                    background: n.hue,
                    opacity: 0.35 + 0.55 * Math.min(1, p.scale),
                    boxShadow: `0 0 ${d}px ${rgba(n.hue, 0.6)}`,
                  }}
                />
                {blink ? (
                  <div
                    style={{
                      position: "absolute",
                      left: p.x - d * 1.6,
                      top: p.y - d * 1.6,
                      width: d * 3.2,
                      height: d * 3.2,
                      borderRadius: "50%",
                      border: `1.5px solid ${C.ember}`,
                      opacity: 0.8,
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </AbsoluteFill>

        {/* the scale, landing on the beat */}
        <AbsoluteFill
          style={{
            background: "radial-gradient(ellipse 900px 460px at 50% 50%, rgba(5,6,11,0.88), rgba(5,6,11,0.4) 60%, transparent 80%)",
            opacity: 1 - prog(frame, 116, 126),
          }}
        />
        <div style={{ position: "absolute", left: 0, right: 0, top: 300 }}>
          <Kinetic text="Hundreds of *applications.*" start={3} stagger={3} size={104} mode="slam" accent="ember" align="center" exit={114} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 440 }}>
          <Kinetic text="Dozens of *teams.*" start={33} stagger={3} size={104} mode="slam" accent="ember" align="center" exit={116} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 580 }}>
          <Kinetic text="Contracts no one sees *in full.*" start={63} stagger={3} size={104} mode="slam" accent="ember" align="center" exit={118} />
        </div>

        {/* the agent's view: one repository */}
        {frame >= 122 ? (
          <>
            <div
              style={{
                position: "absolute",
                left: repo.x - 90,
                top: repo.y - 90,
                width: 180,
                height: 180,
                borderRadius: "50%",
                border: `2px dashed ${rgba(C.ice, 0.8)}`,
                rotate: `${frame * 1.2}deg`,
                opacity: focus,
                scale: String(0.6 + 0.4 * focus),
              }}
            />
            <div
              style={{
                position: "absolute",
                left: repo.x - 22,
                top: repo.y - 22,
                width: 44,
                height: 44,
                borderRadius: 22,
                background: C.ice,
                boxShadow: `0 0 40px ${C.ice}`,
                opacity: focus,
              }}
            />
            <MonoLabel size={18} color={C.ice} style={{ position: "absolute", left: repo.x - 150, width: 300, textAlign: "center", top: repo.y + 110, opacity: focus }}>
              The one repository it sees
            </MonoLabel>

            <div style={{ position: "absolute", left: wrong.x - 28, top: wrong.y - 28, opacity: stamp }}>
              <Glitch amount={frame < 184 ? 0.7 : 0.1} seed="wrong">
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    background: rgba(C.ember, 0.3),
                    border: `2px solid ${C.ember}`,
                    boxShadow: `0 0 40px ${C.ember}`,
                    scale: String(2 - stamp),
                  }}
                />
              </Glitch>
            </div>
            <MonoLabel size={18} color={C.ember} style={{ position: "absolute", left: wrong.x - 150, width: 300, textAlign: "center", top: wrong.y + 50, opacity: stamp }}>
              Changed · wrong service
            </MonoLabel>
            <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: stamp }}>
              <path
                d={`M ${repo.x + 30} ${repo.y - 40} Q ${repo.x + 200} ${repo.y - 220} ${wrong.x - 30} ${wrong.y + 30}`}
                fill="none"
                stroke={C.ember}
                strokeWidth={2}
                strokeDasharray="6 8"
              />
            </svg>

            <div style={{ position: "absolute", left: 140, top: 330, width: 1060 }}>
              <Kinetic text="Your coding agent sees *one* repository." start={128} stagger={2} size={80} accent="ice" />
            </div>
            <div style={{ position: "absolute", left: 140, top: 560, width: 1060 }}>
              <Glitch amount={frame >= 172 && frame < 178 ? 0.5 : 0} seed="ships">
                <Kinetic text="…and ships a correct change to the *wrong service.*" start={168} stagger={2} size={80} accent="ember" />
              </Glitch>
            </div>
          </>
        ) : null}
      </Camera>
      <Hud chapter="01 — The problem" tone="ember" />
    </AbsoluteFill>
  );
};
