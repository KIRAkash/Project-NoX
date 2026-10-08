"use client";

import { Check, UserRound } from "lucide-react";
import { useState } from "react";

import { Panel, useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import { ROLE_BY_ID, type RoleId } from "@/lib/app/roles";
import type { Person, TicketState } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

/**
 * The mission's ticket, read from its Firestore document: who it's assigned to and the pipeline it walks.
 * Anyone who can see the mission can assign it to anyone else who can see it.
 */
export function TicketPanel({ missionKey, state, onChanged }: { missionKey: string; state: TicketState | null; onChanged: () => void }) {
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = useApi<Person[]>(picking ? `/api/v1/missions/${missionKey}/people` : null);
  const a = state?.assignee ?? null;

  const assign = async (userId: string | null) => {
    setBusy(true);
    try {
      await api(`/api/v1/missions/${missionKey}/assignee`, { method: "PUT", json: { userId } });
      setPicking(false);
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't assign it", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Ticket"
      action={
        <button type="button" onClick={() => setPicking((p) => !p)} aria-expanded={picking} className="text-[12.5px] text-ink-dim hover:text-ink">
          {picking ? "Cancel" : a ? "Reassign" : "Assign"}
        </button>
      }
    >
      <div className="flex items-center gap-2.5 text-[13px]">
        {a?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.photoUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-hairline text-ink-dim">
            <UserRound size={14} />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-ink">{a ? a.name : "Unassigned"}</div>
          {a && (
            <div className="truncate text-[11.5px] text-ink-dim">
              by {a.assignedBy.name} · {new Date(a.assignedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
            </div>
          )}
        </div>
      </div>

      {picking && (
        <ul className="mt-3 max-h-[220px] space-y-0.5 overflow-y-auto border-t border-hairline pt-2" aria-label="Assign to">
          {people.loading && <li className="px-2 py-1.5 text-[12.5px] text-ink-faint">Loading people…</li>}
          {(people.data ?? []).map((p) => (
            <li key={p.id}>
              <button type="button" disabled={busy} onClick={() => void assign(p.id)} className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-[rgb(var(--line)/.08)] disabled:opacity-50">
                <span className="min-w-0 truncate">
                  <span className="text-ink">{p.name || p.email}</span>
                  {p.name && p.email && <span className="ml-1.5 text-ink-dim">{p.email}</span>}
                </span>
                {a?.userId === p.id && <Check size={13} className="shrink-0 text-[color:var(--role)]" />}
              </button>
            </li>
          ))}
          {a && (
            <li>
              <button type="button" disabled={busy} onClick={() => void assign(null)} className="w-full rounded-sm px-2 py-1.5 text-left text-[12.5px] text-ink-muted hover:bg-[rgb(var(--line)/.08)] disabled:opacity-50">
                Clear assignee
              </button>
            </li>
          )}
        </ul>
      )}

      {state && (
        <ol className="mt-4 space-y-1.5 border-t border-hairline pt-3" aria-label="Pipeline">
          {state.pipeline.map((s) => {
            const hue = ROLE_BY_ID[s.role as RoleId]?.hue ?? "#86B9EE";
            return (
              <li key={s.id} className="flex items-center gap-2.5 text-[12.5px]" aria-current={s.status === "current" ? "step" : undefined}>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${s.status === "current" ? "motion-safe:animate-pulse" : ""}`}
                  style={{ background: s.status === "pending" ? "transparent" : hue, border: `1px solid ${s.status === "pending" ? "rgb(var(--line)/.35)" : hue}` }}
                />
                <span className={s.status === "current" ? "text-ink" : s.status === "done" ? "text-ink-muted" : "text-ink-dim"}>{s.label}</span>
                {s.status === "current" && <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--role)]">now</span>}
              </li>
            );
          })}
          {state.currentStep === null && <li className="text-[12.5px] text-verify">Done</li>}
        </ol>
      )}
    </Panel>
  );
}
