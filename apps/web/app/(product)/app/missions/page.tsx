"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RequestCard, NoxCommand } from "@/components/app/homes/shared";
import { MissionCard, stageHue } from "@/components/app/mission-card";
import { Planet } from "@/components/app/planet";
import { HORIZON, PriorityChips } from "@/components/app/priority";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { LiquidMetalLink } from "@/components/liquid-metal/liquid-metal";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID, isRoleId, type RoleDef, type RoleId } from "@/lib/app/roles";
import { STAGE_LABEL, type Mission, type MissionStage } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";
import { legible } from "@/lib/app/palette";

const COLUMNS: MissionStage[] = ["business", "product", "engineering", "developer", "build", "verifying", "done"];
const VIEWS = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting on you" },
  { key: "mine", label: "Mine" },
] as const;

type Layout = "lanes" | "priority" | "table";
const LAYOUTS: { key: Layout; label: string }[] = [
  { key: "lanes", label: "Stages" },
  { key: "priority", label: "Priority" },
  { key: "table", label: "Table" },
];

/** Each seat opens the missions page in the layout it thinks in. */
const SEAT: Record<RoleId, { layout: Layout; title: string; lead: string }> = {
  business: { layout: "lanes", title: "Everything you've asked for", lead: "Each request in your words, and how far along it is." },
  product: { layout: "priority", title: "The backlog, by priority", lead: "Set a priority on anything still being specified. Each mission still moves through the four spec files in turn." },
  engineering: {
    layout: "lanes",
    title: "Every change, from sentence to ship",
    lead: "Each mission carries one change through four spec files — business, product, engineering, developer — then back through verification.",
  },
  developer: { layout: "table", title: "What's ready to build", lead: "Copy the /nox command into your coding agent. NoX hands it the spec files and the knowledge base." },
};

export default function MissionsPage() {
  const { me } = useAuth();
  const role = ROLE_BY_ID[me!.role!];
  const seat = SEAT[role.id];
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>(role.id === "developer" ? "waiting" : "all");
  const [layout, setLayout] = useState<Layout>(seat.layout);
  const missions = useApi<Mission[]>(`/api/v1/missions?view=${view}`);
  const business = role.id === "business";

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow={role.missionsLabel}
        title={seat.title}
        lead={seat.lead}
        action={
          me!.capabilities.includes("create_mission") && (
            <LiquidMetalLink href="/app/missions/new" hue={role.hue} className="inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[13px] font-semibold">
              <Plus size={15} strokeWidth={2.4} /> {business ? "Ask for a change" : "New mission"}
            </LiquidMetalLink>
          )
        }
      />
      {!business && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Pills label="Filter missions" items={VIEWS} value={view} onChange={setView} role={role} />
          <Pills label="Layout" items={LAYOUTS} value={layout} onChange={setLayout} role={role} />
        </div>
      )}

      {missions.loading && !missions.data ? (
        <p className="mt-8 text-[13px] text-ink-faint">Loading missions…</p>
      ) : !missions.data?.length ? (
        <div className="mt-8 rounded-md border border-hairline">
          <EmptyState role={role} line={view === "waiting" ? "Nothing is waiting on your seat." : "No missions yet. They start from one sentence, from any seat."} />
        </div>
      ) : business ? (
        <div className="mx-auto mt-8 grid max-w-[860px] gap-4 sm:grid-cols-2">
          {missions.data.map((m) => (
            <RequestCard key={m.key} m={m} />
          ))}
        </div>
      ) : layout === "priority" ? (
        <PriorityBoard missions={missions.data} onChanged={() => void missions.reload()} canSet={role.id === "product"} />
      ) : layout === "table" ? (
        <BuildTable missions={missions.data} />
      ) : (
        <StageLanes missions={missions.data} role={role} />
      )}
    </div>
  );
}

function Pills<K extends string>({ label, items, value, onChange, role }: { label: string; items: readonly { key: K; label: string }[]; value: K; onChange: (k: K) => void; role: RoleDef }) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={label}>
      {items.map((v) => (
        <button
          key={v.key}
          role="tab"
          aria-selected={value === v.key}
          type="button"
          onClick={() => onChange(v.key)}
          className="rounded-full border px-3 py-1 text-[13px]"
          style={{ borderColor: value === v.key ? role.ink : "rgb(var(--line)/.2)", color: value === v.key ? role.ink : "var(--ink-muted)" }}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function StageLanes({ missions, role }: { missions: Mission[]; role: RoleDef }) {
  return (
    <div className="mt-6 flex gap-4 overflow-x-auto pb-4">
      {COLUMNS.map((col) => {
        const items = missions.filter((m) => m.stage === col);
        const hue = stageHue(col);
        const seat = isRoleId(col) ? ROLE_BY_ID[col] : null;
        const yours = col === role.id;
        return (
          // Each lane wears its stage's colour; the four spec lanes are the four seats, and yours stands out.
          <section
            key={col}
            aria-label={STAGE_LABEL[col]}
            className="w-[272px] shrink-0 rounded-md border bg-[color:var(--panel)] p-3"
            style={{ borderColor: yours ? `color-mix(in srgb, ${hue} 45%, rgb(var(--line)/.14))` : "rgb(var(--line)/.14)" }}
          >
            <h2
              className="mb-3 flex items-center gap-2 border-b pb-2.5 font-mono text-[11px] uppercase tracking-[0.14em]"
              style={{ color: legible(hue), borderColor: `color-mix(in srgb, ${hue} 20%, transparent)` }}
            >
              {seat ? <Planet role={seat} size={14} /> : <span aria-hidden className="mx-[3px] h-2 w-2 rounded-full" style={{ background: hue }} />}
              {STAGE_LABEL[col]}
              {yours && <span className="rounded-full border px-1.5 text-[9.5px] tracking-[0.1em]" style={{ borderColor: `color-mix(in srgb, ${hue} 50%, transparent)` }}>You</span>}
              <span className="ml-auto text-ink-dim">{items.length}</span>
            </h2>
            <div className="space-y-3">
              {items.map((m) => (
                <MissionCard key={m.key} m={m} />
              ))}
              {!items.length && <div className="h-16 rounded-md border border-dashed" style={{ borderColor: `color-mix(in srgb, ${hue} 22%, rgb(var(--line)/.14))` }} />}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Priority can still change while a mission is being specified; after that it's history. */
const PRE_BUILD: MissionStage[] = ["business", "product", "engineering", "developer"];

/** The product owner's board: Now / Next / Later / Untriaged, with priority set in place. Columns hug their cards. */
function PriorityBoard({ missions, onChanged, canSet }: { missions: Mission[]; onChanged: () => void; canSet: boolean }) {
  return (
    <div className="mt-6 grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {HORIZON.map((h) => {
        const items = missions.filter((m) => h.match(m.priority));
        return (
          <section key={h.key} aria-label={h.label} className="rounded-md border border-[rgb(var(--line)/.18)] bg-[linear-gradient(180deg,rgb(var(--raise)/.8),rgb(var(--raise-lo)/.8))] p-3">
            <h2 className="mb-3 flex items-baseline justify-between border-b border-hairline pb-2.5">
              <span className="text-[16px] font-semibold text-ink">{h.label}</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">
                {h.hint} · {items.length}
              </span>
            </h2>
            <div className="space-y-3">
              {items.map((m) => (
                <div key={m.key} className="space-y-1.5">
                  <MissionCard m={m} compact showPriority={false} />
                  {canSet && PRE_BUILD.includes(m.stage) && <PriorityChips m={m} onChanged={onChanged} />}
                </div>
              ))}
              {!items.length && <p className="py-4 text-center text-[12.5px] text-ink-dim">Nothing here yet</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The developer's dense list: key, title, apps, stage, pull request, and the command to paste. Cards on a phone. */
function BuildTable({ missions }: { missions: Mission[] }) {
  return (
    <div className="mt-6 overflow-hidden rounded-md border border-hairline bg-[rgb(var(--void-rgb)/.7)] font-mono text-[12.5px]">
      <div className="hidden grid-cols-[80px_minmax(0,1fr)_160px_100px_70px_140px] gap-3 border-b border-hairline px-4 py-2.5 text-[10.5px] uppercase tracking-[0.12em] text-ink-dim xl:grid">
        <span>Key</span>
        <span>Title</span>
        <span>Apps</span>
        <span>Stage</span>
        <span>PR</span>
        <span>Agent</span>
      </div>
      <ul className="divide-y divide-hairline">
        {missions.map((m) => {
          const pr = m.links.find((l) => l.system === "github_pr");
          const prState = typeof pr?.state?.state === "string" ? pr.state.state : pr ? "open" : "—";
          return (
            <li key={m.key} className="grid gap-1.5 px-4 py-3 xl:grid-cols-[80px_minmax(0,1fr)_160px_100px_70px_140px] xl:items-center xl:gap-3">
              <Link href={`/app/missions/${m.key}`} className="text-ink-muted hover:text-[color:var(--role)]">
                {m.key}
              </Link>
              <Link href={`/app/missions/${m.key}`} className="truncate font-sans text-[13.5px] text-ink hover:text-[color:var(--role)]">
                {m.title}
              </Link>
              <span className="truncate text-ink-faint">{m.apps.map((a) => a.name).join(", ")}</span>
              <span style={{ color: legible(stageHue(m.stage)) }}>{STAGE_LABEL[m.stage].toLowerCase()}</span>
              {pr?.url ? (
                <a href={pr.url} target="_blank" rel="noreferrer" className="text-ink-muted hover:text-ink">
                  {prState} ↗
                </a>
              ) : (
                <span className="text-ink-dim">{prState}</span>
              )}
              <span>{(m.stage === "developer" || m.stage === "build") && <NoxCommand missionKey={m.key} />}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
