"use client";

import Link from "next/link";

import { stageHue } from "@/components/app/mission-card";
import { HORIZON, PriorityChips } from "@/components/app/priority";
import { EmptyState, type KbStatus, Panel } from "@/components/app/ui";
import type { RoleDef } from "@/lib/app/roles";
import { STAGE_LABEL, type Mission } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

import { MissionPanel } from "./shared";

/**
 * The product board: the product owner triages what comes in, orders the backlog, and accepts what ships.
 * So the home leads with one triage queue (inline priority) beside what's back for acceptance, then a
 * Now / Next / Later count strip. Everything waiting on the product spec is already in triage, so there's no
 * second "waiting" list repeating it.
 */
export function ProductHome({ role }: { role: RoleDef }) {
  const all = useApi<Mission[]>("/api/v1/missions?view=all");
  const kbs = useApi<{ id: string; status: KbStatus }[]>("/api/v1/kb");
  const missions = all.data ?? [];
  const incoming = missions.filter((m) => m.stage === "business" || m.stage === "product");
  const open = missions.filter((m) => m.stage !== "done");
  const reload = () => void all.reload();
  const inOrbit = kbs.data?.filter((k) => k.status === "published").length ?? 0;

  return (
    <div className="mt-10 space-y-5">
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Panel title={incoming.length ? `Triage · ${incoming.length}` : "Triage"} className="lg:col-span-2">
          {all.loading && !all.data ? (
            <p className="text-[13px] text-ink-faint">Loading…</p>
          ) : incoming.length ? (
            <ul className="-my-3 divide-y divide-hairline">
              {incoming.map((m) => (
                <li key={m.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <Link href={`/app/missions/${m.key}`} className="min-w-0 hover:text-[color:var(--role)]">
                    <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.1em]">
                      <span className="text-ink-dim">{m.key}</span>
                      <span style={{ color: stageHue(m.stage) }}>{m.stage === "business" ? "New request" : "Needs your spec"}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[14px] text-ink">{m.title}</span>
                  </Link>
                  <PriorityChips m={m} onChanged={reload} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState role={role} line="Nothing to triage. New requests from the business land here first." />
          )}
        </Panel>
        <MissionPanel title="Back for acceptance" view="back" empty="Shipped work comes back here to check against your acceptance criteria." role={role} />
      </div>

      <Panel
        title="Roadmap"
        action={
          <Link href="/app/missions" className="text-[12px] hover:underline" style={{ color: role.hue }}>
            Open backlog →
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {HORIZON.map((h) => {
            const items = open.filter((m) => h.match(m.priority));
            return (
              <section key={h.key} className="min-w-0 rounded-md border border-hairline bg-[rgba(5,6,11,.5)] p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[14px] font-semibold text-ink">{h.label}</h3>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-dim">{h.hint}</span>
                </div>
                <div className="mt-2 font-display text-[28px] leading-none" style={{ color: items.length && h.key !== "untriaged" ? role.hue : "#6E7793" }}>
                  {items.length}
                </div>
                {items.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {items.slice(0, 3).map((m) => (
                      <li key={m.key} className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: stageHue(m.stage) }} title={STAGE_LABEL[m.stage]} />
                        <Link href={`/app/missions/${m.key}`} className="truncate text-ink-muted hover:text-ink" title={m.title}>
                          {m.title}
                        </Link>
                      </li>
                    ))}
                    {items.length > 3 && <li className="text-[11.5px] text-ink-dim">+{items.length - 3} more</li>}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </Panel>

      <p className="text-[13px] text-ink-faint">
        {kbs.data ? `${inOrbit} of ${kbs.data.length} applications ${inOrbit === 1 ? "has" : "have"} a knowledge base in orbit. ` : ""}
        <Link href="/app/atlas" className="hover:underline" style={{ color: role.hue }}>
          Open the atlas →
        </Link>
      </p>
    </div>
  );
}
