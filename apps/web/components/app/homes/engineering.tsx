"use client";

import Link from "next/link";

import { ContractMap } from "@/components/app/contract-map";
import { stageHue } from "@/components/app/mission-card";
import { SightingsPanel } from "@/components/app/sighting-card";
import { EmptyState, Panel } from "@/components/app/ui";
import type { RoleDef } from "@/lib/app/roles";
import { STAGE_LABEL, type Mission } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

import { AtlasPanel, ConnectorHealth, MissionPanel, useRootOrgMap } from "./shared";

/**
 * The flight director: the engineering lead decides which applications change and what must not break.
 * So the home leads with the contract map, with every application an open mission touches ringed in the colour
 * of where that mission is — the blast radius — then the design reviews and the health of the estate.
 */
export function EngineeringHome({ role }: { role: RoleDef }) {
  const { root, map, loading } = useRootOrgMap();
  const all = useApi<Mission[]>("/api/v1/missions?view=all");
  const open = (all.data ?? []).filter((m) => m.stage !== "done");

  const lit: Record<string, string> = {};
  for (const m of [...open].reverse()) for (const a of m.apps) lit[a.id] = stageHue(m.stage);
  const touched = new Set(Object.keys(lit));

  return (
    <div className="mt-10 space-y-5">
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Panel
          title={root ? `Blast radius · ${root.name}` : "Blast radius"}
          className="lg:col-span-2"
          action={
            <Link href="/app/atlas" className="text-[12px] hover:underline" style={{ color: role.hue }}>
              Open atlas →
            </Link>
          }
        >
          {loading && !map.data ? (
            <p className="text-[13px] text-ink-faint">Mapping contracts…</p>
          ) : map.data?.apps.length ? (
            <>
              <ContractMap map={map.data} lit={lit} />
              {open.length > 0 && (
                <ul className="mt-4 space-y-1.5 border-t border-hairline pt-4">
                  {open.slice(0, 5).map((m) => (
                    <li key={m.key} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                      <span className="inline-block h-2 w-2 rounded-full border-2" style={{ borderColor: stageHue(m.stage) }} />
                      <Link href={`/app/missions/${m.key}`} className="font-mono text-ink-muted hover:text-ink">
                        {m.key}
                      </Link>
                      <span className="text-ink-dim">{STAGE_LABEL[m.stage]}</span>
                      <span className="text-ink-faint">touches {m.apps.map((a) => a.name).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[12px] text-ink-dim">
                {touched.size} of {map.data.apps.length} applications are changing in open missions.
              </p>
            </>
          ) : (
            <EmptyState role={role} line="No applications mapped yet. Once knowledge bases are built, their contracts draw the map." />
          )}
        </Panel>
        <div className="space-y-5">
          <MissionPanel title="Design review queue" view="waiting" empty="No product specs waiting on a design." role={role} />
          <ConnectorHealth />
        </div>
      </div>

      <SightingsPanel role={role} />

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <MissionPanel title="In build" view="flight" empty="Designs you've approved show here while they're built." />
        <MissionPanel title="Back for a scope check" view="back" empty="Shipped missions come back here for a scope check against your design." />
        <AtlasPanel role={role} title="Knowledge bases" />
      </div>
    </div>
  );
}
