"use client";

import { Panel } from "@/components/app/ui";
import { ROLE_BY_ID } from "@/lib/app/roles";
import { STAGE_LABEL, type MissionStage } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

/** Each stage takes the hue of the seat that owns it; build is the developer's, verifying is shared. */
export const STAGE_HUE: Record<string, string> = {
  business: ROLE_BY_ID.business.hue,
  product: ROLE_BY_ID.product.hue,
  engineering: ROLE_BY_ID.engineering.hue,
  developer: ROLE_BY_ID.developer.hue,
  build: ROLE_BY_ID.developer.hue,
  verifying: "var(--verify)",
};

const STAGE_ORDER = ["business", "product", "engineering", "developer", "build", "verifying"];

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function sortStages<T extends { stage: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
}

/** Horizontal bars, one per stage: plain SVG-free divs so labels wrap and nothing scrolls sideways on a phone. */
export function StageBars({ rows, caption }: { rows: { stage: string; seconds: number | null; missions?: number }[]; caption?: string }) {
  const sorted = sortStages(rows).filter((r) => r.seconds != null);
  const max = Math.max(1, ...sorted.map((r) => r.seconds ?? 0));
  if (!sorted.length) return <p className="text-[13px] text-ink-faint">No stage has closed yet.</p>;
  return (
    <figure>
      <ul className="space-y-2.5" aria-label={caption ?? "Median time per stage"}>
        {sorted.map((r) => (
          <li key={r.stage} className="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-3 text-[12.5px]">
            <span className="truncate text-ink-muted">{STAGE_LABEL[r.stage as MissionStage] ?? r.stage}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-[rgb(var(--line)/.1)]">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(3, ((r.seconds ?? 0) / max) * 100)}%`, background: STAGE_HUE[r.stage] ?? "#8FA0CC" }} />
            </span>
            <span className="text-right font-mono text-[12px] text-ink">{fmtDuration(r.seconds)}</span>
          </li>
        ))}
      </ul>
      {caption && <figcaption className="mt-3 text-[11.5px] text-ink-dim">{caption}</figcaption>}
    </figure>
  );
}

type Flight = { key: string; stage: string; stages: { stage: string; seconds: number; current: boolean }[] };

/** The thin strip above a mission's timeline: how long it has spent in each stage so far. */
export function FlightStrip({ missionKey, version }: { missionKey: string; version?: number }) {
  const flight = useApi<Flight>(`/api/v1/missions/${missionKey}/flight${version ? `?v=${version}` : ""}`);
  const stages = sortStages(flight.data?.stages ?? []);
  const total = stages.reduce((n, s) => n + s.seconds, 0);
  if (!stages.length || !total) return null;
  return (
    <Panel title="Flight recorder">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[rgb(var(--line)/.1)]" role="img" aria-label={stages.map((s) => `${STAGE_LABEL[s.stage as MissionStage] ?? s.stage} ${fmtDuration(s.seconds)}`).join(", ")}>
        {stages.map((s) => (
          <span key={s.stage} className={s.current ? "animate-pulse motion-reduce:animate-none" : ""} style={{ width: `${(s.seconds / total) * 100}%`, background: STAGE_HUE[s.stage] ?? "#8FA0CC", minWidth: 3 }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        {stages.map((s) => (
          <li key={s.stage} className="flex min-w-0 items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STAGE_HUE[s.stage] ?? "#8FA0CC" }} />
            <span className="truncate text-ink-muted">{STAGE_LABEL[s.stage as MissionStage] ?? s.stage}</span>
            <span className="ml-auto font-mono text-ink">{fmtDuration(s.seconds)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11.5px] text-ink-dim">Read off this mission&apos;s own event log. {flight.data?.stage === "done" ? "" : "The current stage is still counting."}</p>
    </Panel>
  );
}
