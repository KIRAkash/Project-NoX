"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "@/lib/app/api";
import { ROLE_BY_ID, type RoleDef, type RoleId } from "@/lib/app/roles";
import { SIGHTING_KIND_LABEL, STAGE_LABEL, type Mission, type Sighting, type SightingEvidence } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

import { EmptyState, Panel, useToast } from "./ui";

const IMPACT_HUE: Record<Sighting["impact"], string> = { high: "var(--nox)", medium: "var(--ink-muted)", low: "var(--ink-dim)" };
const DISMISS: { id: string; label: string }[] = [
  { id: "not_relevant", label: "Not relevant to me" },
  { id: "already_known", label: "We already know" },
  { id: "wrong", label: "NoX got it wrong" },
];
const CODE_SEATS: RoleId[] = ["engineering", "developer"];

/** Card text with `inline code` rendered as code (the engineering and developer views name files and functions). */
function Text({ children }: { children: string }) {
  return (
    <>
      {children.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={i} className="break-words rounded-[3px] bg-[rgb(var(--line)/.1)] px-1 font-mono text-[0.92em] text-ink">{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function evidenceHref(e: SightingEvidence, s: Sighting): string | null {
  if (e.kind === "mission") return `/app/missions/${e.ref}`;
  if (e.kind === "kb") {
    const app = s.apps.find((a) => a.name === e.app);
    const page = e.ref.split("/").slice(1).join("/");
    return app ? `/app/atlas/apps/${app.id}?tab=explore&page=${encodeURIComponent(`${page}.md`)}` : null;
  }
  return null;
}

const EVIDENCE_LABEL: Record<SightingEvidence["kind"], string> = {
  kb: "page", code: "code", contract: "interface", mission: "mission", capture: "capture", jira: "jira", shield: "shield",
};

/**
 * One suggested change, written for the acting seat. Start mission turns it into a mission from this seat in one
 * click; Edit first opens the new-mission form filled in. Once any seat starts it, every seat sees it in flight.
 */
export function SightingCard({ s, role, onChanged, compact = false }: { s: Sighting; role: RoleDef; onChanged?: () => void; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = s.view;
  const technical = CODE_SEATS.includes(role.id);

  const launch = async () => {
    setBusy(true);
    try {
      const m = await api<Mission>(`/api/v1/sightings/${s.id}/launch`, { method: "POST" });
      toast(`${m.key} started. NoX is drafting`, "success");
      router.push(`/app/missions/${m.key}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't start the mission", "error");
      setBusy(false);
      onChanged?.();
    }
  };

  const feedback = async (action: string, reason?: string) => {
    setBusy(true);
    try {
      await api(`/api/v1/sightings/${s.id}/feedback`, { method: "POST", json: { action, reason } });
      toast(action === "snoozed" ? "Hidden for 30 days" : action === "dismissed" ? "Dismissed. NoX won't suggest it again" : "Back in your sightings", "success");
      onChanged?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't save that", "error");
    } finally {
      setBusy(false);
      setDismissing(false);
    }
  };

  return (
    <article className="flex min-w-0 flex-col rounded-md border border-hairline bg-[rgb(var(--void-rgb)/.5)] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.1em]">
        {s.kind && <span style={{ color: role.ink }}>{SIGHTING_KIND_LABEL[s.kind] ?? s.kind.replace(/_/g, " ")}</span>}
        <span className="inline-flex items-center gap-1.5 text-ink-dim">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: IMPACT_HUE[s.impact] }} aria-hidden />
          {s.impact} impact
        </span>
        {technical && s.effort && <span className="text-ink-dim">effort {s.effort}</span>}
        {role.id !== "business" && s.apps.length > 0 && <span className="truncate normal-case tracking-normal text-ink-faint">{s.apps.map((a) => a.name).join(" · ")}</span>}
      </div>
      <h3 className="mt-2 text-[15px] font-semibold leading-snug text-ink"><Text>{v.title}</Text></h3>
      <p className={`mt-1.5 text-[13.5px] leading-relaxed text-ink-muted ${compact ? "line-clamp-3" : ""}`}><Text>{v.why}</Text></p>
      {!compact && v.impact && <p className="mt-2 text-[13px] text-ink-faint"><Text>{v.impact}</Text></p>}

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-3 inline-flex items-center gap-1 self-start text-[12px] text-ink-dim hover:text-ink">
        How NoX knows
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l border-hairline pl-3 text-[12.5px] leading-relaxed">
          {v.howWeKnow.map((line) => (
            <p key={line} className="text-ink-muted"><Text>{line}</Text></p>
          ))}
          {s.evidence.length > 0 && (
            <ul className="space-y-1">
              {s.evidence.map((e) => {
                const href = evidenceHref(e, s);
                const ref = technical || e.kind !== "kb" ? e.ref : e.ref.split("/").slice(1).join("/");
                return (
                  <li key={`${e.kind}:${e.ref}`} className="min-w-0">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">{EVIDENCE_LABEL[e.kind]} </span>
                    {href ? (
                      <Link href={href} className="break-all font-mono text-[12px] text-ink hover:text-[color:var(--role)]">{ref}</Link>
                    ) : (
                      <span className="break-all font-mono text-[12px] text-ink">{ref}</span>
                    )}
                    <span className="text-ink-faint"> · <Text>{e.says}</Text></span>
                  </li>
                );
              })}
            </ul>
          )}
          {s.openQuestions.length > 0 && (
            <div>
              <p className="text-ink-dim">NoX couldn&apos;t settle:</p>
              <ul className="list-disc pl-4 text-ink-faint">
                {s.openQuestions.map((q) => (
                  <li key={q}><Text>{q}</Text></li>
                ))}
              </ul>
            </div>
          )}
          {!v.howWeKnow.length && !s.evidence.length && <p className="text-ink-faint">From the knowledge base and past missions.</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 pt-1 text-[13px]">
        {s.mission ? (
          <Link href={`/app/missions/${s.mission.key}`} className="text-ink-muted hover:text-ink">
            <span className="font-mono" style={{ color: role.ink }}>{s.mission.key}</span>
            {s.status === "shipped" ? " shipped" : ` · ${STAGE_LABEL[s.mission.stage]}`}
            <span className="text-ink-dim"> · started by {s.mission.startedBy ?? "someone"} as {ROLE_BY_ID[s.mission.startedAs].name.toLowerCase()}</span>
          </Link>
        ) : s.status === "open" ? (
          dismissing ? (
            <>
              <span className="text-ink-dim">Why?</span>
              {DISMISS.map((d) => (
                <button key={d.id} type="button" disabled={busy} onClick={() => feedback("dismissed", d.id)} className="h-8 rounded-sm border border-hairline px-2.5 text-ink-muted hover:border-ink-faint hover:text-ink disabled:opacity-40">
                  {d.label}
                </button>
              ))}
              <button type="button" onClick={() => setDismissing(false)} className="h-8 px-2 text-ink-dim hover:text-ink">Cancel</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={launch} className="h-8 rounded-sm px-3 font-semibold text-abyss disabled:opacity-50" style={{ background: role.hue }}>
                {busy ? "Starting…" : "Start mission"}
              </button>
              <Link href={`/app/missions/new?sighting=${s.id}`} className="inline-flex h-8 items-center rounded-sm border border-hairline px-3 text-ink hover:border-ink-faint">
                Edit first
              </Link>
              <span className="ml-auto flex gap-1">
                <button type="button" disabled={busy} onClick={() => feedback("snoozed")} className="h-8 px-2 text-ink-dim hover:text-ink disabled:opacity-40">Not now</button>
                <button type="button" disabled={busy} onClick={() => setDismissing(true)} className="h-8 px-2 text-ink-dim hover:text-ink disabled:opacity-40">Dismiss</button>
              </span>
            </>
          )
        ) : (
          <>
            <span className="text-ink-dim">{s.status === "snoozed" ? `Hidden until ${new Date(s.snoozedUntil!).toLocaleDateString()}` : s.statusReason ?? "Dismissed"}</span>
            <button type="button" disabled={busy} onClick={() => feedback("restore")} className="ml-auto h-8 rounded-sm border border-hairline px-3 text-ink hover:border-ink-faint disabled:opacity-40">
              Restore
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/** The top sightings for the acting seat, for its home. */
export function SightingsPanel({ role, className, limit = 3 }: { role: RoleDef; className?: string; limit?: number }) {
  const { data, loading, reload } = useApi<Sighting[]>("/api/v1/sightings");
  const items = data ?? [];
  return (
    <Panel
      title={items.length ? `Spotted by NoX · ${items.length}` : "Spotted by NoX"}
      className={className}
      action={
        <Link href="/app/sightings" className="text-[12px] hover:underline" style={{ color: role.ink }}>
          All sightings →
        </Link>
      }
    >
      {loading && !data ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : items.length ? (
        <div className="grid items-start gap-3 lg:grid-cols-3">
          {items.slice(0, limit).map((s) => (
            <SightingCard key={s.id} s={s} role={role} onChanged={() => void reload()} compact />
          ))}
        </div>
      ) : (
        <EmptyState role={role} line="Nothing spotted yet. NoX looks across your applications on a schedule and suggests changes worth your time." />
      )}
    </Panel>
  );
}
