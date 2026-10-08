"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { fmtDuration, StageBars, STAGE_HUE } from "@/components/app/flight-recorder";
import { EmptyState, PageHeader, Panel } from "@/components/app/ui";
import { useAuth } from "@/lib/app/auth";
import { STAGE_LABEL, type MissionStage } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

type Impact = {
  source: "postgres" | "bigquery";
  since: string;
  days: number;
  missions: number;
  missionsDone: number;
  medianTimeToVerified: number | null;
  stageMedians: { stage: string; seconds: number | null; missions: number }[];
  sendBacks: number;
  sendBacksByStage: { stage: string; count: number }[];
  groundedShare: number | null;
  groundedBasis: string;
  aiCostPerMission: number | null;
  kbFreshnessMedian: number | null;
  recent: { key: string; title: string; stage: string; flightSeconds: number }[];
};

const RANGES = [7, 30, 90];

/** Measured, not claimed: flight times, send-backs, grounding and AI cost from the missions NoX has flown. */
export default function ImpactPage() {
  const { me } = useAuth();
  const roots = useMemo(() => {
    const orgs = me?.orgs ?? [];
    const ids = new Set(orgs.map((o) => o.id));
    return orgs.filter((o) => !o.parentOrgId || !ids.has(o.parentOrgId));
  }, [me]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const org = orgId ?? roots[0]?.id ?? null;
  const impact = useApi<Impact>(org ? `/api/v1/orgs/${org}/impact?days=${days}` : null);
  const d = impact.data;

  const sendBackRate = d && d.missions ? d.sendBacks / d.missions : null;
  const basis = d ? `From ${d.missions} mission${d.missions === 1 ? "" : "s"} in the last ${d.days} days${d.source === "bigquery" ? " (BigQuery flight recorder)" : ""}.` : "";

  return (
    <div className="mx-auto max-w-shell">
      <PageHeader
        eyebrow="Impact"
        title="The flight recorder"
        lead="How long a request takes to go from a sentence to verified code, where it waits, and what the AI costs. Every number comes from recorded events."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {roots.length > 1 && (
              <select aria-label="Organisation" value={org ?? ""} onChange={(e) => setOrgId(e.target.value)} className="rounded-sm border border-hairline bg-deck px-2 py-1.5 text-[13px] text-ink">
                {roots.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex rounded-sm border border-hairline" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button key={r} type="button" onClick={() => setDays(r)} aria-pressed={days === r} className={`px-2.5 py-1.5 font-mono text-[12px] ${days === r ? "bg-[color:var(--role)] text-void" : "text-ink-dim hover:text-ink"}`}>
                  {r}d
                </button>
              ))}
            </div>
          </div>
        }
      />

      {!org ? (
        <div className="mt-8"><EmptyState line="Join an organisation to see its impact." /></div>
      ) : impact.error ? (
        <p className="mt-8 text-[14px] text-ink-faint">{impact.error.detail}</p>
      ) : !d ? (
        <p className="mt-8 font-mono text-[13px] text-ink-faint">loading…</p>
      ) : !d.missions ? (
        <div className="mt-8"><EmptyState line={`No missions in the last ${d.days} days yet. Fly one from a sentence to verified code and it shows up here.`} /></div>
      ) : (
        <>
          <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Time to verified" value={fmtDuration(d.medianTimeToVerified)} note={d.missionsDone ? `median of ${d.missionsDone} done` : "none done yet"} />
            <Stat label="Send-back rate" value={sendBackRate == null ? "—" : `${Math.round(sendBackRate * 100)}%`} note={`${d.sendBacks} send-back${d.sendBacks === 1 ? "" : "s"}`} />
            <Stat label="Grounded" value={d.groundedShare == null ? "—" : `${Math.round(d.groundedShare * 100)}%`} note={`cite a source · ${d.groundedBasis}`} />
            <Stat label="AI cost / mission" value={d.aiCostPerMission == null ? "—" : `$${d.aiCostPerMission.toFixed(2)}`} note="estimate at list prices" />
          </dl>
          <p className="mt-2 text-[12px] text-ink-dim">{basis}</p>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <Panel title="Median time per stage" className="lg:col-span-2">
              <StageBars rows={d.stageMedians} caption={`Median time a mission spends in each stage. ${basis}`} />
            </Panel>
            <Panel title="Where work comes back">
              {d.sendBacksByStage.length ? (
                <ul className="space-y-2 text-[13px]">
                  {d.sendBacksByStage.map((s) => (
                    <li key={s.stage} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: STAGE_HUE[s.stage] ?? "#8FA0CC" }} />
                      <span className="text-ink-muted">sent back from {STAGE_LABEL[s.stage as MissionStage] ?? s.stage}</span>
                      <span className="ml-auto font-mono text-ink">{s.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-ink-faint">Nothing was sent back in this range.</p>
              )}
              <p className="mt-4 border-t border-hairline pt-3 text-[12px] text-ink-dim">
                Knowledge-base freshness: {d.kbFreshnessMedian == null ? "no source pushes synced in this range" : `${fmtDuration(d.kbFreshnessMedian)} median from a push to its patch PR`}.
              </p>
            </Panel>
          </div>

          <Panel title="Recent missions" className="mt-5">
            <ul className="divide-y divide-hairline">
              {d.recent.map((m) => (
                <li key={m.key} className="flex items-center gap-3 py-2.5 text-[13px]">
                  <Link href={`/app/missions/${m.key}`} className="shrink-0 font-mono text-[12px] text-[color:var(--role)] hover:underline">
                    {m.key}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-ink">{m.title}</span>
                  <span className="hidden shrink-0 text-ink-dim sm:inline">{STAGE_LABEL[m.stage as MissionStage] ?? m.stage}</span>
                  <span className="shrink-0 font-mono text-[12px] text-ink" title="Total flight time so far">{fmtDuration(m.flightSeconds)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[rgb(var(--line)/.2)] bg-[rgb(var(--raise-lo)/.7)] p-4">
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">{label}</dt>
      <dd className="mt-1.5 font-display text-[28px] leading-none text-ink">{value}</dd>
      <dd className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">{note}</dd>
    </div>
  );
}
