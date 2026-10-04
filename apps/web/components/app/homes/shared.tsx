"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { appHue } from "@/components/app/contract-map";
import { MissionCard } from "@/components/app/mission-card";
import { EmptyState, KbStatusChip, type KbStatus, Panel } from "@/components/app/ui";
import { useAuth } from "@/lib/app/auth";
import type { RoleDef } from "@/lib/app/roles";
import type { Mission, MissionStage, Org, OrgMap } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

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
        <Link href="/app/atlas" className="text-[12px] hover:underline" style={{ color: role.hue }}>
          Open atlas →
        </Link>
      }
    >
      {loading ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : error ? (
        <p className="text-[13px] text-[#F3A27E]">Couldn&rsquo;t load applications: {error.detail}</p>
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
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i.ok ? "#5FD29F" : "#E9713C" }} />
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
      className={`inline-flex items-center gap-2 rounded-sm border border-[rgba(134,185,238,.3)] bg-[rgba(5,6,11,.8)] px-2.5 py-1 font-mono text-[12px] text-[#CFE3FA] hover:border-[rgba(134,185,238,.6)] ${className}`}
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

const SEAT_NAME: Record<string, string> = { business: "you", product: "the product owner", engineering: "the engineering lead", developer: "a developer" };

/** Where a request is right now, in words a business user would use. `mine` = it is waiting on the viewer. */
function whereItIs(m: Mission, mine: boolean): { label: string; line: string; tone: "you" | "work" | "done" } {
  if (m.stage === "done") return { label: "Done", line: "Delivered and checked", tone: "done" };
  if (mine) return { label: "Waiting on you", line: m.stage === "verifying" ? "Built — check it does what you asked" : "Read it and confirm it says what you meant", tone: "you" };
  switch (m.stage) {
    case "business": return { label: "NoX is writing it up", line: "NoX is turning your words into a request", tone: "work" };
    case "product": return { label: "With the product owner", line: "Being turned into a spec with goals and acceptance checks", tone: "work" };
    case "engineering": return { label: "With the engineering lead", line: "Deciding what changes and what must not break", tone: "work" };
    case "developer":
    case "build": return { label: "Being built", line: "A developer is building it", tone: "work" };
    default: {
      const who = m.verifyRole ? SEAT_NAME[m.verifyRole] : null;
      return { label: "Being checked", line: who ? `Being checked by ${who}` : "Being checked before it reaches you", tone: "work" };
    }
  }
}

const ACTIVITY_VERB: Record<string, string> = {
  "mission.created": "sent the request",
  "mission.proceeded": "moved it on",
  "mission.sent_back": "sent it back for changes",
  "mission.completed": "marked it done",
  "mission.assigned": "assigned it",
  "file.approved": "approved a step",
  "verify.verified": "checked it off",
  "verify.not_met": "found something missing",
  "verify.blocked": "flagged a blocker",
};

const ROLE_LABEL: Record<string, string> = { business: "Business", product: "Product owner", engineering: "Engineering lead", developer: "Developer" };

function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h ago`;
  if (min < 60 * 24 * 7) return `${Math.round(min / 60 / 24)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function dateOf(iso: string): string {
  const t = new Date(iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: t.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/**
 * A request as the business user sees it: their words, which application, who has it now, who asked and when, what
 * last happened, and a parcel-tracker line. `highlight` marks one that is waiting on them.
 */
export function RequestCard({ m, highlight }: { m: Mission; highlight?: string }) {
  const { me } = useAuth();
  const step = requestStep(m);
  const hue = "var(--role)";
  const where = whereItIs(m, Boolean(highlight));
  const app = m.apps[0];
  const asker = m.requestedBy?.name ? (m.requestedBy.name === me?.name || m.requestedBy.name === me?.email ? "You" : m.requestedBy.name) : null;
  const last = m.lastActivity;
  const lastBy = last?.by && last.by !== "NoX" ? last.by : last ? "NoX" : null;
  const pill = where.tone === "you" ? { color: "#14110A", background: hue } : where.tone === "done" ? { color: "#5FD29F", background: "rgba(95,210,159,.12)" } : { color: hue, background: "color-mix(in srgb, var(--role) 12%, transparent)" };
  return (
    <Link
      href={`/app/missions/${m.key}`}
      className="block rounded-lg border p-5 transition hover:border-[color:color-mix(in_srgb,var(--role)_55%,transparent)]"
      style={{
        borderColor: highlight ? "color-mix(in srgb, var(--role) 55%, transparent)" : "rgba(143,160,204,.18)",
        background: highlight ? "color-mix(in srgb, var(--role) 8%, #0f1322)" : "#0f1322",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-[12px] text-ink-muted">
          <span className="font-mono text-ink-dim">{m.key}</span>
          {app && (
            <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-hairline px-2 py-0.5" title={m.apps.map((a) => a.name).join(", ")}>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: appHue(app.id) }} />
              <span className="truncate text-ink">{m.apps.map((a) => a.name).join(", ")}</span>
            </span>
          )}
        </span>
        <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold" style={pill}>{where.label}</span>
      </div>

      <p className="mt-3 line-clamp-3 text-[16px] leading-snug text-ink">&ldquo;{m.prompt}&rdquo;</p>
      {highlight && <p className="mt-2 text-[12.5px] font-semibold" style={{ color: hue }}>{highlight}</p>}

      <ol className="mt-4 grid grid-cols-5 gap-1" aria-label={`Progress: ${REQUEST_STEPS[step]}`}>
        {REQUEST_STEPS.map((label, i) => {
          const done = i < step || step === 4;
          const now = i === step && step !== 4;
          return (
            <li key={label} className="min-w-0">
              <span
                className={`block h-1.5 rounded-full ${now ? "motion-safe:animate-pulse" : ""}`}
                style={{ background: done ? hue : now ? "color-mix(in srgb, var(--role) 70%, transparent)" : "rgba(143,160,204,.16)" }}
              />
              <span className={`mt-1.5 block truncate text-[11px] ${now ? "text-ink" : done ? "text-ink-muted" : "text-ink-dim"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[12.5px] text-ink-muted">{where.line}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline pt-3 text-[12px]">
        <div className="min-w-0">
          <dt className="text-ink-dim">Asked</dt>
          <dd className="truncate text-ink-muted" title={new Date(m.createdAt).toString()}>
            {dateOf(m.createdAt)}{asker ? ` · ${asker}` : ""}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-dim">{m.stage === "done" ? "Finished" : "Last update"}</dt>
          <dd className="truncate text-ink-muted" title={last ? `${lastBy} ${ACTIVITY_VERB[last.type] ?? "updated it"}` : undefined}>
            {m.stage === "done" && m.completedAt
              ? dateOf(m.completedAt)
              : last
                ? `${ago(last.at)} · ${lastBy}${last.role && lastBy !== "NoX" ? ` (${ROLE_LABEL[last.role] ?? last.role})` : ""} ${ACTIVITY_VERB[last.type] ?? "updated it"}`
                : ago(m.updatedAt ?? m.createdAt)}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
