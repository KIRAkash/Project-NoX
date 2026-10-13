"use client";

import {
  ClipboardCheck,
  CreditCard,
  Database,
  Headset,
  Landmark,
  Layers,
  type LucideIcon,
  Megaphone,
  MonitorSmartphone,
  ScrollText,
  ShieldAlert,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { appHue } from "@/components/app/contract-map";
import { OrgLockup } from "@/components/app/org-mark";
import { KB_STATUS, type KbStatus } from "@/components/app/ui";
import { gsap, prefersReducedMotion } from "@/lib/motion";

export type SkyApp = { name: string; status: KbStatus; contracts: number; inFlight: boolean };
export type SkyTeam = { name: string; apps: SkyApp[] };

/** The beats the welcome's captions call, in order. Each one reveals a layer of the map. */
export type SkyBeat = "org" | "teams" | "apps" | "lit" | "flight";

export type SkyHandle = { play: (beat: SkyBeat, instant?: boolean) => void; reset: () => void };

type Line = SkyApp & { team: string; dx: number; dy: number; tx: number; ty: number };
type TeamNode = {
  name: string;
  x: number;
  y: number;
  R: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  nameX: number;
  nameY: number;
  anchor: "middle" | "start";
  apps: Line[];
};

const NAME = 13.5; // team name size
const APP = 10.5; // application name size (mono: 0.6em per character)
const ROW = 15; // application line height

/**
 * The demo company as a simple org map: its logo at the centre, a line out to each team, and each team a circle
 * with its icon, its name, and its applications listed underneath. Each application's dot lights up when its code
 * wiki is in orbit and gets a pulsing ring while a mission is changing it. On a phone the lists give way to a count,
 * and tapping a team shows its applications. Drawn at the container's real pixel size, so text stays legible.
 */
export const WelcomeSky = forwardRef<SkyHandle, { org: string; note?: string; teams: SkyTeam[]; tools?: React.ReactNode; onReady?: () => void }>(function WelcomeSky(
  { org, note, teams, tools, onReady },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [focus, setFocus] = useState<string | null>(null); // "app:<name>" or "team:<name>"
  const pulse = useRef<gsap.core.Tween | null>(null);
  const played = useRef<SkyBeat[]>([]); // beats shown so far, replayed in place when the map is redrawn at a new size

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, centre, compact } = useMemo(() => layout(teams, size.w, size.h), [teams, size.w, size.h]);

  // The map starts empty; each beat brings a layer in. `instant` jumps there (reduced motion, replays, resizes).
  useImperativeHandle(
    ref,
    () => {
      const q = (sel: string) => Array.from(box.current?.querySelectorAll<HTMLElement | SVGElement>(sel) ?? []);
      const still = prefersReducedMotion();
      return {
        reset() {
          played.current = [];
          pulse.current?.kill();
          gsap.set(q("[data-sky]"), { clearProps: "all" });
          gsap.set(q('[data-sky="org"], [data-sky="team"], [data-sky="app"], [data-sky="glow"], [data-sky="ring"]'), { opacity: 0 });
          gsap.set(q('[data-sky="spoke"]'), { strokeDashoffset: 1, opacity: 0 });
        },
        play(beat, instant = false) {
          if (!played.current.includes(beat)) played.current.push(beat);
          const fast = instant || still;
          const d = (s: number) => (fast ? 0 : s);
          const ease = "expo.out";
          if (beat === "org") {
            gsap.fromTo(q('[data-sky="org"]'), { opacity: 0, scale: fast ? 1 : 0.85, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: d(1.1), ease });
          } else if (beat === "teams") {
            gsap.to(q('[data-sky="spoke"]'), { strokeDashoffset: 0, opacity: 1, duration: d(0.9), ease: "power2.inOut", stagger: fast ? 0 : 0.12 });
            gsap.fromTo(
              q('[data-sky="team"]'),
              { opacity: 0, scale: fast ? 1 : 0.85, transformOrigin: "center" },
              { opacity: 1, scale: 1, duration: d(0.9), ease, stagger: fast ? 0 : 0.12, delay: d(0.45) },
            );
          } else if (beat === "apps") {
            gsap.fromTo(q('[data-sky="app"]'), { opacity: 0, x: fast ? 0 : -6 }, { opacity: 1, x: 0, duration: d(0.7), ease, stagger: fast ? 0 : 0.05 });
          } else if (beat === "lit") {
            gsap.fromTo(q('[data-sky="glow"]'), { opacity: 0, scale: fast ? 1 : 0.3, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: d(1.1), ease, stagger: fast ? 0 : 0.05 });
          } else if (beat === "flight") {
            const rings = q('[data-sky="ring"]');
            gsap.fromTo(rings, { opacity: 0, scale: fast ? 1 : 2.2, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: d(0.9), ease, stagger: fast ? 0 : 0.1 });
            pulse.current?.kill();
            if (!still) pulse.current = gsap.to(rings, { scale: 1.5, opacity: 0.35, transformOrigin: "center", duration: 1.6, ease: "sine.inOut", repeat: -1, yoyo: true, delay: d(1) });
          }
        },
      };
    },
    [],
  );

  useEffect(() => () => void pulse.current?.kill(), []);

  // A resize moves every element; animated transforms would stay at the old positions, so redraw the beats in place.
  useEffect(() => {
    const api = (ref as React.RefObject<SkyHandle | null>)?.current;
    const beats = [...played.current];
    if (!api || !beats.length) return;
    api.reset();
    beats.forEach((b) => api.play(b, true));
  }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new size redraws

  // Tell the page once the map is drawn, so its story starts on something visible.
  const drawn = size.w > 0;
  const told = useRef(false);
  useEffect(() => {
    if (drawn && !told.current) {
      told.current = true;
      onReady?.();
    }
  }, [drawn, onReady]);

  const total = teams.reduce((n, t) => n + t.apps.length, 0);
  const focusedApp = focus?.startsWith("app:") ? nodes.flatMap((t) => t.apps).find((a) => a.name === focus.slice(4)) : null;
  const focusedTeam = focus?.startsWith("team:") ? nodes.find((t) => t.name === focus.slice(5)) : null;
  const hover = (key: string) => ({
    onMouseEnter: () => setFocus(key),
    onMouseLeave: () => setFocus((f) => (f === key ? null : f)),
    onFocus: () => setFocus(key),
    onBlur: () => setFocus((f) => (f === key ? null : f)),
    onClick: () => setFocus((f) => (f === key ? null : key)),
  });

  return (
    <div ref={box} className="sky absolute inset-0">
      {drawn && (
        <svg
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          className="absolute inset-0 overflow-visible"
          role="group"
          aria-label={`${org}: ${teams.length} teams and ${total} applications. ${teams.map((t) => `${t.name}: ${t.apps.map((a) => a.name).join(", ")}`).join(". ")}.`}
        >
          <defs>
            <radialGradient id="sky-glow">
              <stop offset="0%" stopColor="var(--sky-glow)" />
              <stop offset="100%" stopColor="var(--sky-glow)" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sky-halo">
              <stop offset="0%" stopColor="rgb(247 181 66 / .24)" />
              <stop offset="100%" stopColor="rgb(247 181 66 / 0)" />
            </radialGradient>
          </defs>

          <g data-sky="org" style={{ opacity: 0 }}>
            <circle cx={centre.x} cy={centre.y} r={compact ? 70 : 100} fill="url(#sky-halo)" />
          </g>

          {/* A line from the company out to each team. */}
          {nodes.map((t) => (
            <line
              key={`spoke-${t.name}`}
              data-sky="spoke"
              x1={t.sx}
              y1={t.sy}
              x2={t.ex}
              y2={t.ey}
              pathLength={1}
              strokeDasharray="1 1"
              stroke={teamInk(t.name, 55)}
              strokeWidth={1.3}
              strokeLinecap="round"
              style={{ opacity: 0 }}
            />
          ))}

          {nodes.map((t) => {
            const Icon = teamIcon(t.name);
            const ic = t.R * 1.05;
            return (
              <g key={t.name}>
                {/* The team: a circle in its own colour with its icon, and its name. */}
                <g data-sky="team" style={{ opacity: 0 }}>
                  <g
                    {...(compact ? hover(`team:${t.name}`) : {})}
                    tabIndex={compact ? 0 : undefined}
                    role={compact ? "button" : undefined}
                    aria-label={compact ? `${t.name}: ${t.apps.map((a) => a.name).join(", ")}` : undefined}
                    className={compact ? "sky-star cursor-pointer outline-none" : undefined}
                  >
                    <circle cx={t.x} cy={t.y} r={t.R} fill={`color-mix(in srgb, ${appHue(t.name)} 10%, var(--void))`} stroke={teamInk(t.name, 60)} strokeWidth={1.3} />
                    <Icon x={t.x - ic / 2} y={t.y - ic / 2} width={ic} height={ic} color={teamInk(t.name, 85)} strokeWidth={1.8} aria-hidden />
                  </g>
                  <circle cx={t.ex} cy={t.ey} r={2.6} fill={teamInk(t.name, 70)} />
                  <text x={t.nameX} y={t.nameY} textAnchor={t.anchor} className="sky-label fill-ink font-sans" fontSize={compact ? 11.5 : NAME} fontWeight={600}>
                    {t.name}
                  </text>
                  {compact && (
                    <text x={t.nameX} y={t.nameY + 14} textAnchor={t.anchor} className="sky-label font-sans" fontSize={10.5} fill="var(--ink-faint)">
                      {t.apps.length} {t.apps.length === 1 ? "app" : "apps"}
                    </text>
                  )}
                </g>

                {/* Its applications, each a line with a status dot. On a phone only the dots show, inside the circle. */}
                {t.apps.map((a) => (
                  <g
                    key={a.name}
                    data-sky="app"
                    style={{ opacity: 0 }}
                    {...(compact ? {} : hover(`app:${a.name}`))}
                    tabIndex={compact ? undefined : 0}
                    role={compact ? undefined : "button"}
                    aria-label={compact ? undefined : `${a.name}. Code wiki ${KB_STATUS[a.status]?.label ?? a.status}. ${a.contracts} contracts.${a.inFlight ? " A mission is changing it." : ""}`}
                    className={compact ? undefined : "sky-star cursor-pointer outline-none"}
                  >
                    {!compact && <rect x={a.dx - 8} y={a.ty - ROW + 3} width={a.name.length * APP * 0.6 + 22} height={ROW} fill="transparent" />}
                    {a.status === "published" && <circle data-sky="glow" cx={a.dx} cy={a.dy} r={compact ? 7 : 9} fill="url(#sky-glow)" style={{ opacity: 0 }} />}
                    {a.inFlight && <circle data-sky="ring" cx={a.dx} cy={a.dy} r={compact ? 5 : 6} fill="none" stroke="var(--sky-flight)" strokeWidth={1.3} style={{ opacity: 0 }} />}
                    <circle cx={a.dx} cy={a.dy} r={compact ? 2.4 : 2.6} fill="var(--sky-star)" />
                    {!compact && (
                      <text x={a.tx} y={a.ty} className="sky-label font-mono" fontSize={APP} fill={focus === `app:${a.name}` ? "var(--ink)" : "var(--ink-faint)"}>
                        {a.name}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      )}

      {/* The company itself sits at the centre, as its logo. */}
      {drawn && (
        <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ left: centre.x, top: centre.y }}>
          <div data-sky="org" className="sky-lockup flex flex-col items-center rounded-full px-8 py-5" style={{ opacity: 0 }}>
            <OrgLockup name={org} note={note} compact={compact} />
            {/* The real tools it's built from sit right under the company, as logos. */}
            {tools && <div className="pointer-events-auto mt-2">{tools}</div>}
          </div>
        </div>
      )}

      {focusedApp && (
        <Tip left={Math.min(Math.max(focusedApp.tx + 40, 120), size.w - 120)} top={focusedApp.ty + 8}>
          <span className="block font-mono text-[12px] text-ink">{focusedApp.name}</span>
          <span className="flex items-center gap-1.5 text-ink-muted">
            <TeamIcon name={focusedApp.team} />
            {focusedApp.team} · <span style={{ color: KB_STATUS[focusedApp.status]?.color }}>{KB_STATUS[focusedApp.status]?.label}</span>
          </span>
          <span className="block text-ink-faint">
            {focusedApp.contracts} contracts{focusedApp.inFlight ? " · a mission is changing it" : ""}
          </span>
        </Tip>
      )}
      {focusedTeam && (
        // On a phone a tapped team lists its applications, docked at the map's bottom edge.
        <Tip left={size.w / 2} top={size.h - 4} above>
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <TeamIcon name={focusedTeam.name} /> {focusedTeam.name}
          </span>
          {focusedTeam.apps.map((a) => (
            <span key={a.name} className="mt-0.5 flex items-center gap-1.5 font-mono text-[11.5px] text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: KB_STATUS[a.status]?.color }} aria-hidden />
              {a.name}
              {a.inFlight && <span className="font-sans text-[11px] text-[color:var(--sky-flight)]">changing</span>}
            </span>
          ))}
        </Tip>
      )}
    </div>
  );
});

function Tip({ left, top, above = false, children }: { left: number; top: number; above?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`pointer-events-none absolute z-10 w-max max-w-[260px] -translate-x-1/2 rounded-sm border border-hairline bg-deck px-3 py-2 text-[12.5px] leading-snug shadow-[0_10px_30px_-12px_rgb(0_0_0/.5)] ${above ? "-translate-y-full" : ""}`}
      style={{ left, top }}
      role="status"
    >
      {children}
    </div>
  );
}

function layout(teams: SkyTeam[], w: number, h: number) {
  const compact = w < 560;
  const n = Math.max(teams.length, 1);
  const R = compact ? Math.min(26, w / 13) : Math.max(18, Math.min(23, h / 16));
  const pad = 6;
  // On a phone the logo fills the middle band, so teams sit in two rows: above it and below it.
  const top = Math.floor(n / 2);
  const angles = compact
    ? teams.map((_, i) =>
        i < top
          ? -Math.PI + ((i + 0.5) / top) * Math.PI * 0.9 + Math.PI * 0.05
          : ((i - top + 0.5) / (n - top)) * Math.PI * 0.9 + Math.PI * 0.05,
      )
    : teams.map((_, i) => -Math.PI / 2 + (i / n) * Math.PI * 2);
  const sin = angles.map(Math.sin);
  // A team above the logo puts its name and list beside its circle, clear of the line that reaches it from below.
  // On a phone, the upper row names itself above its circles instead.
  const beside = sin.map((s) => s < -0.85 && !compact);
  const above = sin.map((s) => compact && s < 0);
  const listH = (k: number) => (compact ? 30 : 22 + k * ROW);
  const width = (t: SkyTeam) => Math.max(t.name.length * NAME * 0.58, ...t.apps.map((a) => a.name.length * APP * 0.6 + 14));
  const up = teams.map((t, i) => (beside[i] ? Math.max(R, listH(t.apps.length) / 2) : above[i] ? R + 36 : R));
  const down = teams.map((t, i) => (beside[i] ? Math.max(R, listH(t.apps.length) / 2) : above[i] ? R : R + 4 + listH(t.apps.length)));

  // The tallest ring that still fits every circle and its list inside the box.
  const span = (ry: number) => Math.max(...sin.map((s, i) => s * ry + down[i])) - Math.min(...sin.map((s, i) => s * ry - up[i]));
  let lo = R * 1.4;
  let hi = Math.max(h, lo);
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (span(mid) <= h - pad * 2) lo = mid;
    else hi = mid;
  }
  // On a wide screen the teams stay close around the logo rather than spreading to the edges.
  const ry = compact ? lo : Math.min(lo, 165);
  const cy = pad - Math.min(...sin.map((s, i) => s * ry - up[i])) + (h - pad * 2 - span(ry)) / 2;
  const cx = w / 2;
  const half = Math.max(R, ...teams.map((t, i) => (beside[i] ? 0 : width(t) / 2)));
  const spread = Math.max(w / 2 - (compact ? Math.max(R, 46) : half) - 12, R * 2.2);
  const rx = compact ? spread : Math.min(spread, Math.max(250, Math.min(360, w * 0.25)));
  // The company's logo, as an ellipse the spokes start from.
  const hubX = compact ? 92 : 116;
  const hubY = compact ? 84 : 70;

  const nodes: TeamNode[] = teams.map((team, i) => {
    const x = cx + Math.cos(angles[i]) * rx;
    const y = cy + sin[i] * ry;
    const len = Math.hypot(x - cx, y - cy) || 1;
    const ux = (x - cx) / len;
    const uy = (y - cy) / len;
    const hub = 1 / Math.sqrt((ux / hubX) ** 2 + (uy / hubY) ** 2);
    const k = team.apps.length;
    let nameX: number;
    let nameY: number;
    let anchor: "middle" | "start";
    let left: number;
    if (beside[i]) {
      anchor = "start";
      nameX = x + R + (compact ? 10 : 14);
      nameY = compact ? y - 2 : y - (k * ROW) / 2 + 4;
      left = nameX + 4;
    } else {
      anchor = "middle";
      nameX = compact ? Math.min(Math.max(x, 52), w - 52) : x;
      nameY = above[i] ? y - R - 22 : y + R + (compact ? 15 : 19);
      left = x - width(team) / 2 + 4;
    }
    const firstRow = nameY + ROW + 1;
    const apps: Line[] = team.apps.map((a, j) => {
      if (compact) {
        // Dots ride inside the circle's lower rim on a phone, under the icon.
        const t = k === 1 ? 0 : (j / (k - 1) - 0.5) * 1.6;
        return { ...a, team: team.name, dx: x + Math.sin(t) * R * 0.66, dy: y + Math.cos(t) * R * 0.66, tx: x, ty: y };
      }
      const ty = firstRow + j * ROW;
      return { ...a, team: team.name, dx: left, dy: ty - 4, tx: left + 10, ty };
    });
    return { name: team.name, x, y, R, sx: cx + ux * hub, sy: cy + uy * hub, ex: x - ux * R, ey: y - uy * R, nameX, nameY, anchor, apps };
  });

  return { nodes, centre: { x: cx, y: cy }, compact };
}

/** A drawn icon for what a team does, matched from its name. */
const TEAM_ICONS: [RegExp, LucideIcon][] = [
  [/claim/i, ClipboardCheck],
  [/bill|pay|financ|account/i, CreditCard],
  [/fraud|risk|secur|compliance/i, ShieldAlert],
  [/customer|identity|member|people|crm/i, Users],
  [/polic|underwrit|contract|legal/i, ScrollText],
  [/digital|channel|web|mobile|app|portal/i, MonitorSmartphone],
  [/data|analytic|platform|insight/i, Database],
  [/support|service desk|care|contact/i, Headset],
  [/market|growth|brand/i, Megaphone],
  [/logist|ship|deliver|supply/i, Truck],
  [/bank|treasur|ledger/i, Landmark],
  [/ops|infra|devops|reliab|engineer/i, Wrench],
];

export function teamIcon(name: string): LucideIcon {
  return TEAM_ICONS.find(([re]) => re.test(name))?.[1] ?? Layers;
}

/** The team's hue mixed toward the page's ink, so it reads on the dark theme and the light one alike. */
function teamInk(name: string, pct: number) {
  return `color-mix(in srgb, ${appHue(name)} ${pct}%, var(--ink))`;
}

function TeamIcon({ name }: { name: string }) {
  const Icon = teamIcon(name);
  return <Icon size={12} color={teamInk(name, 85)} strokeWidth={2.2} aria-hidden />;
}
