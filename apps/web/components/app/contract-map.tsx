"use client";

import { useMemo, useState } from "react";

import type { OrgMap } from "@/lib/app/types";

import { KbStatusChip } from "./ui";

/** The landing page's "constellation" hues. */
const HUES = ["#E8C97A", "#86B9EE", "#EC8FC2", "#A897F0", "#E9713C", "#5FCBD8", "#F0877E", "#5FD29F"];

/** Each application keeps one hue, picked from its id, so its planet looks the same on every page. */
export function appHue(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

const TYPE_LABEL: Record<string, string> = {
  rest_endpoint: "REST",
  grpc_service: "gRPC",
  event_topic: "Event",
  shared_model: "Model",
  sdk_client: "SDK",
};

/** `lit` rings applications in a colour (the engineering lead's blast radius: what in-flight missions touch). */
export function ContractMap({ map, lit }: { map: OrgMap; lit?: Record<string, string> }) {
  const [focus, setFocus] = useState<string | null>(null);
  const W = 640;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2;

  const nodes = useMemo(() => {
    const n = map.apps.length;
    return map.apps.map((app, i) => {
      const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
      const contracts = map.contracts.filter((c) => c.appId === app.id).length;
      return {
        ...app,
        x: cx + Math.cos(angle) * (n === 1 ? 150 : 230),
        y: cy + Math.sin(angle) * (n === 1 ? 0 : 128),
        r: 10 + Math.min(14, contracts * 1.6),
        hue: appHue(app.id),
        contracts,
      };
    });
  }, [map, cx, cy]);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const focused = focus ? byId[focus] : null;
  const focusedContracts = focus ? map.contracts.filter((c) => c.appId === focus) : [];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Applications and the links between them">
        <ellipse cx={cx} cy={cy} rx={230} ry={128} fill="none" stroke="rgba(143,160,204,.16)" strokeDasharray="3 5" />
        <circle cx={cx} cy={cy} r={16} fill="url(#sun)" />
        <defs>
          <radialGradient id="sun" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#FFF7E2" />
            <stop offset="45%" stopColor="#FFDD82" />
            <stop offset="75%" stopColor="#F7B542" />
            <stop offset="100%" stopColor="#E9713C" />
          </radialGradient>
        </defs>
        {map.links.map((l) => {
          const a = byId[l.from];
          const b = byId[l.to];
          if (!a || !b) return null;
          const lit = !focus || focus === l.from || focus === l.to;
          const mx = (a.x + b.x) / 2 + (cy - (a.y + b.y) / 2) * 0.25;
          const my = (a.y + b.y) / 2 + ((a.x + b.x) / 2 - cx) * 0.25;
          return (
            <path
              key={`${l.from}-${l.to}`}
              d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
              fill="none"
              stroke={a.hue}
              strokeOpacity={lit ? 0.7 : 0.12}
              strokeWidth={Math.min(3, 1 + l.count * 0.3)}
            >
              <title>{`${a.name} → ${b.name} (${l.count} link${l.count > 1 ? "s" : ""})`}</title>
            </path>
          );
        })}
        {nodes.map((n) => (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-label={`${n.name}: ${n.contracts} interfaces`}
            onClick={() => setFocus(focus === n.id ? null : n.id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setFocus(focus === n.id ? null : n.id)}
            className="cursor-pointer focus:outline-none"
            opacity={!focus || focus === n.id ? 1 : 0.35}
          >
            <circle cx={n.x} cy={n.y} r={n.r + 8} fill={n.hue} opacity={focus === n.id ? 0.16 : 0.07} />
            {lit?.[n.id] && (
              <circle cx={n.x} cy={n.y} r={n.r + 5} fill="none" stroke={lit[n.id]} strokeWidth={2} strokeDasharray="4 3" className="origin-center motion-safe:animate-[spin_12s_linear_infinite]" style={{ transformBox: "fill-box" }}>
                <title>{`${n.name} is changing in a mission`}</title>
              </circle>
            )}
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.hue} />
            <text x={n.x} y={n.y + n.r + 16} textAnchor="middle" fill="#ECEFF8" fontSize="12" fontFamily="var(--font-sans)">
              {n.name}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-4 border-t border-hairline pt-4">
        {focused ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px] font-medium" style={{ color: focused.hue }}>
                {focused.name} · {focusedContracts.length} interfaces
              </span>
              <KbStatusChip status={focused.status} />
            </div>
            <ul className="space-y-1.5">
              {focusedContracts.map((c) => (
                <li key={`${c.type}-${c.identifier}`} className="flex items-baseline gap-3 text-[13px]">
                  <span className="w-12 shrink-0 font-mono text-[10.5px] uppercase text-ink-dim">{TYPE_LABEL[c.type] ?? c.type}</span>
                  <span className="font-mono text-ink">{c.identifier}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-[13px] text-ink-faint">
            {map.contracts.length} interfaces across {map.apps.length} application{map.apps.length === 1 ? "" : "s"}
            {map.links.length ? `, ${map.links.length} cross-app link${map.links.length === 1 ? "" : "s"}` : ""}. Select a planet to see what it exposes.
          </p>
        )}
      </div>
    </div>
  );
}
