import { rgba } from "../lib/color";
import { mono } from "../lib/fonts";
import { orbitPoint, project, type Projected } from "../lib/space";
import { APPS, C, MESH, SHELL_TILT } from "../lib/theme";
import { Planet } from "./Planet";
import { Sun } from "./Sun";

/*
 * The landing page's orbital system: the star at the centre, three tilted
 * shells, and the eight applications of the Apex estate on them. Planets
 * behind the star are drawn before it and planets in front after it, so
 * the system has real depth. Contract lines and their travelling pulses are
 * optional, for the scenes about the map.
 */

const SHELLS = [135.7, 218.5, 301.3];

type Props = {
  cx: number;
  cy: number;
  radius: number;
  pitch: number;
  yaw: number;
  /** frames of orbital motion */
  time: number;
  orbitSpeed?: number;
  orbitDraw?: number;
  orbitOpacity?: number;
  /** 0..1 arrival of each planet */
  pop?: (i: number) => number;
  planetScale?: number;
  sun?: { size: number; glow?: number; spin?: number; flare?: number } | null;
  labels?: number;
  /** 0..1 draw-on of each MESH line */
  mesh?: (i: number) => number;
  lit?: Record<string, number>;
  focal?: number;
};

export type EstateLayout = { byId: Record<string, Projected & { size: number }> };

export const estateLayout = (p: Omit<Props, "sun">): EstateLayout => {
  const byId: EstateLayout["byId"] = {};
  APPS.forEach((app, i) => {
    const angle = app.phase + p.time * ((Math.PI * 2) / (app.period * 30)) * (p.orbitSpeed ?? 6);
    const pt = project(orbitPoint(app.a * p.radius, angle, SHELL_TILT[app.a], p.yaw, p.pitch), p.cx, p.cy, p.focal ?? 1600);
    const pop = p.pop ? p.pop(i) : 1;
    byId[app.id] = { ...pt, size: app.size * 2.3 * (p.planetScale ?? 1) * pt.scale * pop };
  });
  return { byId };
};

export const Estate: React.FC<Props> = (props) => {
  const { cx, cy, radius, pitch, yaw, orbitDraw = 1, orbitOpacity = 1, sun, labels = 0, mesh, lit = {}, focal = 1600 } = props;
  const { byId } = estateLayout(props);

  const ring = (a: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 96; i++) {
      const p = project(orbitPoint(a * radius, (i / 96) * Math.PI * 2, SHELL_TILT[a], yaw, pitch), cx, cy, focal);
      pts.push(`${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
    }
    return pts.join(" ");
  };

  const planet = (id: string) => {
    const app = APPS.find((a) => a.id === id)!;
    const p = byId[id];
    return <Planet key={id} x={p.x} y={p.y} size={p.size} hue={app.hue} lit={lit[id] ?? 0} ring={id === "ledger"} />;
  };

  const back = APPS.filter((a) => byId[a.id].z > 0).sort((a, b) => byId[b.id].z - byId[a.id].z);
  const front = APPS.filter((a) => byId[a.id].z <= 0).sort((a, b) => byId[b.id].z - byId[a.id].z);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {SHELLS.map((a, i) => (
          <path
            key={a}
            d={ring(a)}
            fill="none"
            stroke={rgba(C.ice, 0.32 - i * 0.05)}
            strokeWidth={1.6}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - orbitDraw}
            opacity={orbitOpacity}
          />
        ))}
        {mesh
          ? MESH.map(([a, b], i) => {
              const t = mesh(i);
              if (t <= 0) return null;
              const pa = byId[a];
              const pb = byId[b];
              const x2 = pa.x + (pb.x - pa.x) * t;
              const y2 = pa.y + (pb.y - pa.y) * t;
              const k = ((props.time * 0.028 + i * 0.37) % 1 + 1) % 1;
              return (
                <g key={`${a}-${b}`}>
                  <line x1={pa.x} y1={pa.y} x2={x2} y2={y2} stroke={rgba(C.ice, 0.25)} strokeWidth={8} strokeLinecap="round" />
                  <line x1={pa.x} y1={pa.y} x2={x2} y2={y2} stroke={rgba(C.ice, 0.9)} strokeWidth={1.8} />
                  {t >= 1 ? (
                    <circle cx={pa.x + (pb.x - pa.x) * k} cy={pa.y + (pb.y - pa.y) * k} r={4.5} fill="#FFFFFF" opacity={0.9} style={{ filter: `drop-shadow(0 0 6px ${C.ice})` }} />
                  ) : null}
                </g>
              );
            })
          : null}
      </svg>
      {back.map((a) => planet(a.id))}
      {sun ? <Sun x={cx} y={cy} size={sun.size} glow={sun.glow} spin={sun.spin} flare={sun.flare} /> : null}
      {front.map((a) => planet(a.id))}
      {labels > 0
        ? APPS.map((app) => {
            const p = byId[app.id];
            if (p.size < 2) return null;
            return (
              <div
                key={app.id}
                style={{
                  position: "absolute",
                  left: p.x + p.size * 0.7 + 8,
                  top: p.y - 11,
                  opacity: labels,
                  whiteSpace: "nowrap",
                }}
              >
                <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: "0.08em", color: C.ink, textShadow: "0 0 8px #05060B" }}>{app.name}</div>
              </div>
            );
          })
        : null}
    </div>
  );
};
