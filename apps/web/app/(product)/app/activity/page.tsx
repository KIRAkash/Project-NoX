"use client";

import { Map as MapIcon, Rocket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState, PageHeader, Panel } from "@/components/app/ui";
import { useAuth } from "@/lib/app/auth";
import { formatKbEvent, formatMissionEvent } from "@/lib/app/event-text";
import { ROLE_BY_ID, isRoleId } from "@/lib/app/roles";
import type { ActivityItem } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

type KindFilter = "all" | "mission" | "kb";

const FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mission", label: "Missions" },
  { id: "kb", label: "Knowledge bases" },
];

function formatWhen(iso: string): string {
  const normalized = iso.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalized);
  const diffMin = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ActivityPage() {
  const { me } = useAuth();
  const role = me?.role ? ROLE_BY_ID[me.role] : undefined;
  const [kind, setKind] = useState<KindFilter>("all");
  const query = kind === "all" ? "/api/v1/activity" : `/api/v1/activity?kind=${kind}`;
  const { data, loading, error } = useApi<ActivityItem[]>(query);
  const items = data ?? [];

  return (
    <div className="mx-auto max-w-shell">
      <PageHeader
        eyebrow="Activity"
        title="What moved, and who moved it"
        lead="Handoffs, approvals, knowledge-base syncs and Jira updates across your organizations, newest first."
      />
      <Panel
        title={items.length ? `Timeline · ${items.length}` : "Timeline"}
        className="mt-8"
        action={
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Activity filter">
            {FILTERS.map((f) => {
              const on = kind === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setKind(f.id)}
                  className="rounded-full border px-2.5 py-0.5 text-[11.5px] transition"
                  style={{
                    borderColor: on ? "color-mix(in srgb, var(--role) 55%, transparent)" : "rgb(var(--line)/.2)",
                    color: on ? "var(--role)" : "var(--ink-muted)",
                    background: on ? "color-mix(in srgb, var(--role) 10%, transparent)" : "transparent",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        }
      >
        {loading && !data ? (
          <p className="text-[13px] text-ink-faint">Loading activity…</p>
        ) : error ? (
          <p className="text-[13px] text-[color:var(--coral-ink)]">Couldn&rsquo;t load activity: {error.detail}</p>
        ) : items.length === 0 ? (
          <EmptyState role={role} line="Quiet so far. Handoffs and syncs will stream in here." />
        ) : (
          <ol className="divide-y divide-hairline" aria-label="Activity feed">
            {items.map((item) => {
              const isMission = item.kind === "mission";
              const Icon = isMission ? Rocket : MapIcon;
              const summary = isMission
                ? formatMissionEvent(item.type, item.payload)
                : formatKbEvent(item.type, item.payload);
              const actingRoleLabel = item.role && isRoleId(item.role) ? ROLE_BY_ID[item.role].name : null;

              return (
                <li key={`${item.kind}-${item.id}`} className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-hairline bg-[rgb(var(--void-rgb)/.6)] text-ink-muted"
                      aria-hidden
                    >
                      <Icon size={14} style={{ color: "var(--role)" }} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] leading-snug text-ink-muted">
                        <span className="font-medium text-ink">{item.actor ?? "NoX"}</span>
                        {actingRoleLabel && item.actor !== "NoX" && (
                          <span className="text-ink-faint"> ({actingRoleLabel})</span>
                        )}{" "}
                        {summary}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                        <Link
                          href={item.href}
                          className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline"
                          style={{ color: "var(--role)" }}
                        >
                          <span className="font-mono text-[11.5px]">{item.targetKey}</span>
                          {isMission && item.targetTitle && (
                            <span className="truncate font-sans font-normal text-ink-muted">· {item.targetTitle}</span>
                          )}
                        </Link>
                        {item.orgName && <span className="text-ink-dim">· {item.orgName}</span>}
                      </div>
                    </div>
                  </div>
                  <time dateTime={item.createdAt} className="shrink-0 pl-10 font-mono text-[11px] text-ink-dim sm:pl-0">
                    {formatWhen(item.createdAt)}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
