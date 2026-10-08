"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { MissionCard } from "@/components/app/mission-card";
import { EmptyState, KbStatusChip, type KbStatus, Panel } from "@/components/app/ui";
import type { RoleDef } from "@/lib/app/roles";
import type { Mission, MissionStage, Org, OrgMap } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";
import { C, legible } from "@/lib/app/palette";

type Kb = { id: string; appName: string; status: KbStatus; prUrl?: string | null };
type Integration = { name: string; required: boolean; configured: boolean; ok: boolean; detail: string };

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** One mission list from `GET /missions?view=…`, as compact cards. */
export function MissionPanel({ title, view, empty, role, className }: { title: string; view: string; empty: string; role?: RoleDef; className?: string }) {
  const { data, loading } = useApi<Mission[]>(`/api/v1/missions?view=${view}`);
  return (
    <Panel title={data?.length ? `${title} · ${data.length}` : title} className={className}>
      {loading && !data ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : data?.length ? (
        <div className="space-y-3">
          {data.slice(0, 5).map((m) => (
            <MissionCard key={m.key} m={m} compact />
          ))}
        </div>
      ) : (
        <EmptyState role={role} line={empty} />
      )}
    </Panel>
  );
}

export function AtlasPanel({ role, className, title = "Atlas · applications" }: { role: RoleDef; className?: string; title?: string }) {
  const { data, loading, error } = useApi<Kb[]>("/api/v1/kb");
  return (
    <Panel
      title={title}
      className={className}
      action={
        <Link href="/app/atlas" className="text-[12px] hover:underline" style={{ color: role.ink }}>
          Open atlas →
        </Link>
      }
    >
      {loading ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : error ? (
        <p className="text-[13px] text-[color:var(--coral-ink)]">Couldn&rsquo;t load applications: {error.detail}</p>
      ) : !data?.length ? (
        <EmptyState line="No applications in your orbit yet. Onboard one from the atlas." />
      ) : (
        <ul className="divide-y divide-hairline">
          {data.map((kb) => (
            <li key={kb.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <Link href={`/app/atlas/apps/${kb.id}`} className="text-[14px] text-ink hover:text-[color:var(--role)]">
                {kb.appName}
              </Link>
              <span className="flex items-center gap-3">
                {kb.prUrl && kb.status === "in_review" && (
                  <a href={kb.prUrl} target="_blank" rel="noreferrer" className="text-[12px] text-ink-faint hover:text-ink">
                    Review PR ↗
                  </a>
                )}
                <KbStatusChip status={kb.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ConnectorHealth({ className }: { className?: string }) {
  const { data, loading } = useApi<{ ok: boolean; integrations: Integration[] }>("/api/v1/integrations/status");
  return (
    <Panel title="Connector health" className={className}>
      {loading ? (
        <p className="text-[13px] text-ink-faint">Checking connectors…</p>
      ) : (
        <ul className="space-y-2.5">
          {data?.integrations
            .filter((i) => i.configured || i.required)
            .map((i) => (
              <li key={i.name} className="flex items-start gap-2.5 text-[13px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i.ok ? C.verify : C.ember }} />
                <span>
                  <span className="capitalize text-ink">{i.name}</span>
                  <span className="block text-[12px] text-ink-faint">{i.detail}</span>
                </span>
              </li>
            ))}
        </ul>
      )}
    </Panel>
  );
}

/** The command a developer pastes into their coding agent, with a copy button. */
export function NoxCommand({ missionKey, className = "" }: { missionKey: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = `/nox ${missionKey}`;
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard can be blocked; the text is still selectable */
    }
  };
  return (
    <button
      type="button"
      onClick={(e) => void copy(e)}
      className={`inline-flex items-center gap-2 rounded-sm border border-[rgba(134,185,238,.3)] bg-[rgb(var(--void-rgb)/.8)] px-2.5 py-1 font-mono text-[12px] text-[color:var(--sky-ink)] hover:border-[rgba(134,185,238,.6)] ${className}`}
      aria-label={`Copy ${text}`}
    >
      <span className="text-ink-dim">&gt;</span>
      {text}
      {copied ? <Check size={12} className="text-verify" /> : <Copy size={12} className="text-ink-dim" />}
    </button>
  );
}

/** The contract map of the caller's first top-level organization. */
export function useRootOrgMap() {
  const orgs = useApi<Org[]>("/api/v1/orgs");
  const root = useMemo(() => {
    const list = orgs.data ?? [];
    const ids = new Set(list.map((o) => o.id));
    return list.find((o) => !o.parentOrgId || !ids.has(o.parentOrgId)) ?? null;
  }, [orgs.data]);
  const map = useApi<OrgMap>(root ? `/api/v1/orgs/${root.id}/map` : null);
  return { root, map, loading: orgs.loading || (Boolean(root) && map.loading) };
}

// ── The business user's plain-language track ────────────────────────────────

export const REQUEST_STEPS = ["Asked", "Planning", "Building", "Checking", "Done"] as const;

export function requestStep(m: Mission): number {
  const s: MissionStage = m.stage;
  if (s === "business") return 0;
  if (s === "product" || s === "engineering") return 1;
  if (s === "developer" || s === "build") return 2;
  if (s === "verifying") return 3;
  return 4;
}

/** A request as the business user sees it: their words, and a parcel-tracker line. No keys, no stage names. */
export function RequestCard({ m, highlight }: { m: Mission; highlight?: string }) {
  const step = requestStep(m);
  const hue = "var(--role)";
  return (
    <Link
      href={`/app/missions/${m.key}`}
      className="block rounded-lg border p-5 transition hover:border-[color:color-mix(in_srgb,var(--role)_55%,transparent)]"
      style={{
        borderColor: highlight ? "color-mix(in srgb, var(--role) 55%, transparent)" : "rgb(var(--line)/.18)",
        background: highlight
          ? "linear-gradient(180deg, color-mix(in srgb, var(--role) 12%, rgb(var(--raise)/.8)), rgb(var(--raise-lo)/.8))"
          : "linear-gradient(180deg, rgb(var(--raise)/.7), rgb(var(--raise-lo)/.7))",
      }}
    >
      {highlight && <div className="mb-2 text-[12.5px] font-semibold" style={{ color: legible(hue) }}>{highlight}</div>}
      <p className="text-[16px] leading-snug text-ink">&ldquo;{m.prompt}&rdquo;</p>
      <ol className="mt-5 grid grid-cols-5 gap-1" aria-label={`Progress: ${REQUEST_STEPS[step]}`}>
        {REQUEST_STEPS.map((label, i) => {
          const done = i < step || step === 4;
          const now = i === step && step !== 4;
          return (
            <li key={label} className="min-w-0">
              <span
                className={`block h-1.5 rounded-full ${now ? "motion-safe:animate-pulse" : ""}`}
                style={{ background: done ? hue : now ? "color-mix(in srgb, var(--role) 70%, transparent)" : "rgb(var(--line)/.16)" }}
              />
              <span className={`mt-1.5 block truncate text-[11px] ${now ? "text-ink" : done ? "text-ink-muted" : "text-ink-dim"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
      {m.apps.length > 0 && <p className="mt-3 text-[12px] text-ink-faint">Changes {m.apps.map((a) => a.name).join(", ")}</p>}
    </Link>
  );
}
