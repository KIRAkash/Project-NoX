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

type Dot = SkyApp & { team: string; x: number; y: number; r: number };
type TeamNode = { name: string; x: number; y: number; R: number; sx: number; sy: number; ex: number; ey: number; labelY: number };

/**
 * The demo company as a simple org map: its logo at the centre, a line out to each team, and each team a circle
 * holding one dot per application. A dot lights up when its code wiki is in orbit and gets a pulsing ring while a
 * mission is changing it. Drawn at the container's real pixel size, so labels stay legible at any width.
 */
export const WelcomeSky = forwardRef<SkyHandle, { org: string; note?: string; teams: SkyTeam[]; onReady?: () => void }>(function WelcomeSky(
  { org, note, teams, onReady },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [focus, setFocus] = useState<string | null>(null);
  const pulse = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { dots, nodes, centre, compact } = useMemo(() => layout(teams, size.w, size.h), [teams, size.w, size.h]);
  const byName = useMemo(() => Object.fromEntries(dots.map((d) => [d.name, d])), [dots]);

  // The map starts empty; each beat brings a layer in. `instant` jumps there (reduced motion, replays, resizes).
  useImperativeHandle(
    ref,
    () => {
      const q = (sel: string) => Array.from(box.current?.querySelectorAll<HTMLElement | SVGElement>(sel) ?? []);
      const still = prefersReducedMotion();
      return {
        reset() {
          pulse.current?.kill();
          gsap.set(q("[data-sky]"), { clearProps: "all" });
          gsap.set(q('[data-sky="org"], [data-sky="team"], [data-sky="dot"], [data-sky="glow"], [data-sky="ring"]'), { opacity: 0 });
          gsap.set(q('[data-sky="spoke"]'), { strokeDashoffset: 1, opacity: 0 });
        },
        play(beat, instant = false) {
          const fast = instant || still;
          const d = (s: number) => (fast ? 0 : s);
          const ease = "expo.out";
          if (beat === "org") {
            gsap.fromTo(q('[data-sky="org"]'), { opacity: 0, scale: fast ? 1 : 0.85, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: d(1.1), ease });
          } else if (beat === "teams") {
            gsap.to(q('[data-sky="spoke"]'), { strokeDashoffset: 0, opacity: 1, duration: d(0.9), ease: "power2.inOut", stagger: fast ? 0 : 0.12 });
            gsap.fromTo(
              q('[data-sky="team"]'),
              { opacity: 0, scale: fast ? 1 : 0.8, transformOrigin: "center" },
              { opacity: 1, scale: 1, duration: d(0.9), ease, stagger: fast ? 0 : 0.12, delay: d(0.45) },
            );
          } else if (beat === "apps") {
            gsap.fromTo(q('[data-sky="dot"]'), { opacity: 0, scale: fast ? 1 : 0, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: d(0.8), ease, stagger: fast ? 0 : 0.06 });
          } else if (beat === "lit") {
            gsap.fromTo(q('[data-sky="glow"]'), { opacity: 0, scale: fast ? 1 : 0.3, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: d(1.1), ease, stagger: fast ? 0 : 0.07 });
          } else if (beat === "flight") {
            const rings = q('[data-sky="ring"]');
            gsap.fromTo(rings, { opacity: 0, scale: fast ? 1 : 2.2, transformOrigin: "center" }, { opacity: 1, scale: 1, duration: d(0.9), ease, stagger: fast ? 0 : 0.1 });
            pulse.current?.kill();
            if (!still) pulse.current = gsap.to(rings, { scale: 1.4, opacity: 0.35, transformOrigin: "center", duration: 1.6, ease: "sine.inOut", repeat: -1, yoyo: true, delay: d(1) });
          }
        },
      };
    },
    [],
  );

  useEffect(() => () => void pulse.current?.kill(), []);

  // Tell the page once the map is drawn, so its story starts on something visible.
  const drawn = size.w > 0;
  const told = useRef(false);
  useEffect(() => {
    if (drawn && !told.current) {
      told.current = true;
      onReady?.();
    }
  }, [drawn, onReady]);

  const focused = focus ? byName[focus] : null;

  return (
    <div ref={box} className="sky absolute inset-0">
      {drawn && (
        <svg
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          className="absolute inset-0 overflow-visible"
          role="group"
          aria-label={`${org}: ${teams.length} teams and ${dots.length} applications. ${teams.map((t) => `${t.name}: ${t.apps.map((a) => a.name).join(", ")}`).join(". ")}.`}
        >
          <defs>
            <radialGradient id="sky-glow">
              <stop offset="0%" stopColor="var(--sky-glow)" />
              <stop offset="100%" stopColor="var(--sky-glow)" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sky-halo">
              <stop offset="0%" stopColor="rgb(247 181 66 / .26)" />
              <stop offset="100%" stopColor="rgb(247 181 66 / 0)" />
            </radialGradient>
          </defs>

          <g data-sky="org" style={{ opacity: 0 }}>
            <circle cx={centre.x} cy={centre.y} r={compact ? 70 : 105} fill="url(#sky-halo)" />
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

          {/* Each team: a circle in its own colour, with its icon and name underneath. */}
          {nodes.map((t) => {
            const Icon = teamIcon(t.name);
            const fs = compact ? 11.5 : 13.5;
            const ic = compact ? 12 : 14;
            const tw = t.name.length * fs * 0.58;
            const total = ic + 6 + tw;
            const left = Math.min(Math.max(t.x - total / 2, 4), size.w - total - 4);
            return (
              <g key={t.name} data-sky="team" style={{ opacity: 0 }}>
                <circle cx={t.x} cy={t.y} r={t.R} fill={`color-mix(in srgb, ${appHue(t.name)} 9%, var(--void))`} stroke={teamInk(t.name, 60)} strokeWidth={1.3} />
                <circle cx={t.ex} cy={t.ey} r={2.6} fill={teamInk(t.name, 70)} />
                <Icon x={left} y={t.labelY - ic * 0.82} width={ic} height={ic} color={teamInk(t.name, 85)} strokeWidth={2} aria-hidden />
                <text x={left + ic + 6} y={t.labelY} className="sky-label fill-ink font-sans" fontSize={fs} fontWeight={600}>
                  {t.name}
                </text>
              </g>
            );
          })}

          {/* One dot per application, inside its team's circle. */}
          {dots.map((s) => {
            const on = focus === s.name;
            return (
              <g
                key={s.name}
                tabIndex={0}
                role="button"
                aria-label={`${s.name}, ${s.team}. Code wiki ${KB_STATUS[s.status]?.label ?? s.status}. ${s.contracts} contracts.${s.inFlight ? " A mission is changing it." : ""}`}
                onMouseEnter={() => setFocus(s.name)}
                onMouseLeave={() => setFocus((f) => (f === s.name ? null : f))}
                onFocus={() => setFocus(s.name)}
                onBlur={() => setFocus((f) => (f === s.name ? null : f))}
                onClick={() => setFocus((f) => (f === s.name ? null : s.name))}
                className="sky-star cursor-pointer outline-none"
              >
                <circle cx={s.x} cy={s.y} r={Math.max(11, s.r + 6)} fill="transparent" />
                {s.status === "published" && <circle data-sky="glow" cx={s.x} cy={s.y} r={s.r * 3.4} fill="url(#sky-glow)" style={{ opacity: 0 }} />}
                {s.inFlight && <circle data-sky="ring" cx={s.x} cy={s.y} r={s.r + 4} fill="none" stroke="var(--sky-flight)" strokeWidth={1.3} style={{ opacity: 0 }} />}
                <circle data-sky="dot" cx={s.x} cy={s.y} r={on ? s.r + 1.5 : s.r} fill="var(--sky-star)" style={{ opacity: 0, transition: "r .2s" }} />
              </g>
            );
          })}
        </svg>
      )}

      {/* The company itself sits at the centre, as its logo. */}
      {drawn && (
        <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: centre.x, top: centre.y }}>
          <div data-sky="org" className="sky-lockup rounded-full px-6 py-4" style={{ opacity: 0 }}>
            <OrgLockup name={org} note={note} compact={compact} />
          </div>
        </div>
      )}

      {focused && (
        <div
          className={`pointer-events-none absolute z-10 w-max max-w-[240px] -translate-x-1/2 rounded-sm border border-hairline bg-deck px-3 py-2 text-[12.5px] leading-snug shadow-[0_10px_30px_-12px_rgb(0_0_0/.5)] ${compact ? "-translate-y-full" : ""}`}
          // Below its dot on a wide screen; on a phone it docks at the map's bottom edge, clear of the logo and the caption.
          style={compact ? { left: size.w / 2, top: size.h - 4 } : { left: Math.min(Math.max(focused.x, 120), size.w - 120), top: focused.y + focused.r + 12 }}
          role="status"
        >
          <span className="block font-mono text-[12px] text-ink">{focused.name}</span>
          <span className="flex items-center gap-1.5 text-ink-muted">
            <TeamIcon name={focused.team} />
            {focused.team} · <span style={{ color: KB_STATUS[focused.status]?.color }}>{KB_STATUS[focused.status]?.label}</span>
          </span>
          <span className="block text-ink-faint">
            {focused.contracts} contracts{focused.inFlight ? " · a mission is changing it" : ""}
          </span>
        </div>
      )}
    </div>
  );
});

function layout(teams: SkyTeam[], w: number, h: number) {
  const compact = w < 560;
  const n = Math.max(teams.length, 1);
  const most = Math.max(1, ...teams.map((t) => t.apps.length));
  // Team circles big enough for their dots; the ring they sit on leaves room for each circle's name underneath.
  const R = compact ? Math.min(28, w / 11) : Math.min(50, 28 + most * 7, w / 15, h / 9);
  const label = compact ? 22 : 28;
  // Names sit centred under each circle, so the side margin only needs half a name's width.
  const halfName = compact ? 50 : 82;
  const cx = w / 2;
  const cy = h / 2 - label / 2;
  const rx = Math.max(w / 2 - Math.max(R, halfName) - 12, R * 2);
  const ry = Math.max(h / 2 - R - label - 6, R * 1.6);
  // The company's logo, as an ellipse the spokes start from.
  const hubX = compact ? 74 : 104;
  const hubY = compact ? 42 : 52;

  const nodes: TeamNode[] = [];
  const dots: Dot[] = [];
  teams.forEach((team, i) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    // The spoke runs from the logo's edge to the circle's edge.
    const len = Math.hypot(x - cx, y - cy) || 1;
    const dx = (x - cx) / len;
    const dy = (y - cy) / len;
    const hub = 1 / Math.sqrt((dx / hubX) ** 2 + (dy / hubY) ** 2);
    nodes.push({ name: team.name, x, y, R, sx: cx + dx * hub, sy: cy + dy * hub, ex: x - dx * R, ey: y - dy * R, labelY: dy < -0.6 ? y - R - (compact ? 9 : 11) : y + R + (compact ? 16 : 20) });  // a team above the logo names itself on top, clear of its line

    // One dot per application inside the circle: centred alone, otherwise on a small ring.
    const k = team.apps.length;
    const ring = k === 1 ? 0 : R * (k === 2 ? 0.36 : 0.46);
    team.apps.forEach((app, j) => {
      const a = -Math.PI / 2 + (j / Math.max(k, 1)) * Math.PI * 2 + (k === 2 ? Math.PI / 2 : 0);
      const r = (compact ? 2.4 : 3.2) + Math.min(app.contracts, 18) * (compact ? 0.12 : 0.2);
      dots.push({ ...app, team: team.name, x: x + Math.cos(a) * ring, y: y + Math.sin(a) * ring, r });
    });
  });

  return { dots, nodes, centre: { x: cx, y: cy }, compact };
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
