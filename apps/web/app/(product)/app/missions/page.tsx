"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FloatingBulkToolbar, MissionCheckbox } from "@/components/app/bulk-toolbar";
import { RequestCard, NoxCommand } from "@/components/app/homes/shared";
import { MissionCard, stageHue } from "@/components/app/mission-card";
import { Planet } from "@/components/app/planet";
import { HORIZON, PriorityChips } from "@/components/app/priority";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { LiquidMetalLink } from "@/components/liquid-metal/liquid-metal";
import { useAuth } from "@/lib/app/auth";
import { legible } from "@/lib/app/palette";
import { ROLE_BY_ID, isRoleId, type RoleDef, type RoleId } from "@/lib/app/roles";
import { STAGE_LABEL, type Mission, type MissionStage } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

const COLUMNS: MissionStage[] = ["business", "product", "engineering", "developer", "build", "verifying", "done"];
const VIEWS = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting on you" },
  { key: "mine", label: "Mine" },
  { key: "archived", label: "Archived" },
  { key: "cancelled", label: "Cancelled" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];
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

type SelectionApi = {
  selectedIds: Set<string>;
  allSelected: boolean;
  someSelected: boolean;
  onToggle: (id: string, shiftKey: boolean) => void;
  onToggleAll: () => void;
};

export default function MissionsPage() {
  const { me } = useAuth();
  const role = ROLE_BY_ID[me!.role!];
  const seat = SEAT[role.id];
  const [view, setView] = useState<ViewKey>(role.id === "developer" ? "waiting" : "all");
  const [layout, setLayout] = useState<Layout>(seat.layout);
  const missions = useApi<Mission[]>(`/api/v1/missions?view=${view}`);
  const business = role.id === "business";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  /** Visual order of visible missions in the active layout so Shift+Click selects contiguous items. */
  const orderedMissions = useMemo(() => {
    const list = missions.data ?? [];
    if (!list.length || business || view === "archived" || view === "cancelled") return list;
    if (layout === "lanes") return COLUMNS.flatMap((col) => list.filter((m) => m.stage === col));
    if (layout === "priority") return HORIZON.flatMap((h) => list.filter((m) => h.match(m.priority)));
    return list;
  }, [missions.data, business, view, layout]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
  }, []);

  // Reset selection when switching filter views so off-screen missions are never acted on accidentally.
  useEffect(() => {
    clearSelection();
  }, [view, clearSelection]);

  // Drop stale IDs whenever the reloaded mission list changes (zero UI/backend desynchronization).
  useEffect(() => {
    if (!missions.data) return;
    const valid = new Set(missions.data.map((m) => m.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [missions.data]);

  // Pressing Escape clears active row selections and hides the floating toolbar.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds.size, clearSelection]);

  const toggleMission = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const shouldSelect = !prev.has(id);
        if (shiftKey && anchorId && anchorId !== id) {
          const a = orderedMissions.findIndex((m) => m.id === anchorId);
          const b = orderedMissions.findIndex((m) => m.id === id);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) {
              if (shouldSelect) next.add(orderedMissions[i].id);
              else next.delete(orderedMissions[i].id);
            }
            return next;
          }
        }
        if (shouldSelect) next.add(id);
        else next.delete(id);
        return next;
      });
      setAnchorId(id);
    },
    [anchorId, orderedMissions],
  );

  const allSelected = orderedMissions.length > 0 && orderedMissions.every((m) => selectedIds.has(m.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(orderedMissions.map((m) => m.id)));
  }, [orderedMissions]);

  const toggleAllVisible = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAllVisible();
    }
  }, [allSelected, clearSelection, selectAllVisible]);

  const selectedMissions = useMemo(
    () => orderedMissions.filter((m) => selectedIds.has(m.id)),
    [orderedMissions, selectedIds],
  );

  const selection: SelectionApi = {
    selectedIds,
    allSelected,
    someSelected,
    onToggle: toggleMission,
    onToggleAll: toggleAllVisible,
  };

  return (
    <div className={`mx-auto max-w-[1400px] ${selectedMissions.length > 0 ? "pb-44 lg:pb-24" : ""}`}>
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
      {!business ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Pills label="Filter missions" items={VIEWS} value={view} onChange={setView} role={role} />
          {view !== "cancelled" && view !== "archived" && <Pills label="Layout" items={LAYOUTS} value={layout} onChange={setLayout} role={role} />}
        </div>
      ) : (
        <div className="mx-auto mt-6 flex max-w-[860px] justify-end gap-4">
          {view !== "all" && (
            <button type="button" onClick={() => setView("all")} className="text-[13px] text-ink-faint underline decoration-dotted hover:text-ink">
              Back to your requests
            </button>
          )}
          {view !== "archived" && (
            <button type="button" onClick={() => setView("archived")} className="text-[13px] text-ink-faint underline decoration-dotted hover:text-ink">
              Archived requests
            </button>
          )}
          {view !== "cancelled" && (
            <button type="button" onClick={() => setView("cancelled")} className="text-[13px] text-ink-faint underline decoration-dotted hover:text-ink">
              Cancelled requests
            </button>
          )}
        </div>
      )}

      {missions.loading && !missions.data ? (
        <p className="mt-8 text-[13px] text-ink-faint">Loading missions…</p>
      ) : !missions.data?.length ? (
        <div className="mt-8 rounded-md border border-hairline">
          <EmptyState
            role={role}
            line={
              view === "waiting"
                ? "Nothing is waiting on your seat."
                : view === "archived"
                  ? "Nothing has been archived yet."
                  : view === "cancelled"
                    ? "Nothing has been cancelled."
                    : "No missions yet. They start from one sentence, from any seat."
            }
          />
        </div>
      ) : view === "cancelled" ? (
        <CancelledList missions={missions.data} selection={selection} />
      ) : view === "archived" ? (
        <ArchivedList missions={missions.data} selection={selection} />
      ) : business ? (
        <div className="mx-auto mt-8 grid max-w-[860px] gap-4 sm:grid-cols-2">
          {missions.data.map((m) => (
            <RequestCard key={m.key} m={m} />
          ))}
        </div>
      ) : layout === "priority" ? (
        <>
          <BoardSelectionBar total={orderedMissions.length} selectedCount={selectedMissions.length} selection={selection} />
          <PriorityBoard missions={missions.data} onChanged={() => void missions.reload()} canSet={role.id === "product"} selection={selection} />
        </>
      ) : layout === "table" ? (
        <BuildTable missions={missions.data} selection={selection} />
      ) : (
        <>
          <BoardSelectionBar total={orderedMissions.length} selectedCount={selectedMissions.length} selection={selection} />
          <StageLanes missions={missions.data} role={role} selection={selection} />
        </>
      )}

      <FloatingBulkToolbar
        selectedMissions={selectedMissions}
        totalVisible={orderedMissions.length}
        view={view}
        role={role}
        currentUserId={me!.id}
        onSelectAll={selectAllVisible}
        onClear={clearSelection}
        onUpdated={() => missions.reload()}
      />
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

/** Compact select-all header bar above board layouts (Stages / Priority). */
function BoardSelectionBar({ total, selectedCount, selection }: { total: number; selectedCount: number; selection: SelectionApi }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-hairline bg-[rgb(var(--void-rgb)/.55)] px-3 py-2 text-[12px] text-ink-muted">
      <label className="inline-flex cursor-pointer items-center gap-2.5 select-none">
        <MissionCheckbox
          checked={selection.allSelected}
          indeterminate={selection.someSelected}
          onToggle={() => selection.onToggleAll()}
          ariaLabel="Select all missions"
        />
        <span>Select all visible ({total})</span>
      </label>
      <span className="font-mono text-[11px] text-ink-dim">
        {selectedCount > 0 ? `${selectedCount} of ${total} selected` : "Tip: Shift+Click selects a range"}
      </span>
    </div>
  );
}

function StageLanes({ missions, role, selection }: { missions: Mission[]; role: RoleDef; selection: SelectionApi }) {
  return (
    <div className="mt-4 flex gap-4 overflow-x-auto pb-4">
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
                <MissionCard
                  key={m.key}
                  m={m}
                  selected={selection.selectedIds.has(m.id)}
                  onToggleSelect={(shift) => selection.onToggle(m.id, shift)}
                />
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
function PriorityBoard({
  missions,
  onChanged,
  canSet,
  selection,
}: {
  missions: Mission[];
  onChanged: () => void;
  canSet: boolean;
  selection: SelectionApi;
}) {
  return (
    <div className="mt-4 grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                  <MissionCard
                    m={m}
                    compact
                    showPriority={false}
                    selected={selection.selectedIds.has(m.id)}
                    onToggleSelect={(shift) => selection.onToggle(m.id, shift)}
                  />
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

/** The developer's dense list: checkbox, key, title, apps, stage, pull request, and the command to paste. Cards on a phone. */
function BuildTable({ missions, selection }: { missions: Mission[]; selection: SelectionApi }) {
  const selectedCount = missions.filter((m) => selection.selectedIds.has(m.id)).length;
  return (
    <div className="mt-6 overflow-hidden rounded-md border border-hairline bg-[rgb(var(--void-rgb)/.7)] font-mono text-[12.5px]">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 text-[10.5px] uppercase tracking-[0.12em] text-ink-dim xl:grid xl:grid-cols-[24px_80px_minmax(0,1fr)_160px_100px_70px_140px]">
        <MissionCheckbox
          checked={selection.allSelected}
          indeterminate={selection.someSelected}
          onToggle={() => selection.onToggleAll()}
          ariaLabel="Select all missions"
        />
        <span className="xl:hidden">
          {selectedCount > 0 ? `${selectedCount} of ${missions.length} selected` : `Select all (${missions.length})`}
        </span>
        <span className="hidden xl:inline">Key</span>
        <span className="hidden xl:inline">
          Title{selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
        </span>
        <span className="hidden xl:inline">Apps</span>
        <span className="hidden xl:inline">Stage</span>
        <span className="hidden xl:inline">PR</span>
        <span className="hidden xl:inline">Agent</span>
      </div>
      <ul className="divide-y divide-hairline">
        {missions.map((m) => {
          const pr = m.links.find((l) => l.system === "github_pr");
          const prState = typeof pr?.state?.state === "string" ? pr.state.state : pr ? "open" : "—";
          const selected = selection.selectedIds.has(m.id);
          return (
            <li
              key={m.key}
              className={`grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-4 py-3 transition xl:grid-cols-[24px_80px_minmax(0,1fr)_160px_100px_70px_140px] xl:items-center ${
                selected ? "bg-[color:color-mix(in_srgb,var(--role)_8%,transparent)]" : ""
              }`}
            >
              <span className="pt-0.5 xl:pt-0">
                <MissionCheckbox
                  checked={selected}
                  onToggle={(shift) => selection.onToggle(m.id, shift)}
                  ariaLabel={`Select ${m.key}: ${m.title}`}
                />
              </span>
              <div className="grid min-w-0 gap-1.5 xl:contents">
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
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Archived missions: tucked off the active board during triage, ready to unarchive in one click. */
function ArchivedList({ missions, selection }: { missions: Mission[]; selection: SelectionApi }) {
  const selectedCount = missions.filter((m) => selection.selectedIds.has(m.id)).length;
  return (
    <div className="mx-auto mt-6 max-w-[960px] overflow-hidden rounded-md border border-hairline bg-[rgb(var(--void-rgb)/.6)]">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">
        <label className="inline-flex cursor-pointer items-center gap-3 select-none">
          <MissionCheckbox
            checked={selection.allSelected}
            indeterminate={selection.someSelected}
            onToggle={() => selection.onToggleAll()}
            ariaLabel="Select all missions"
          />
          <span>Archived missions ({missions.length})</span>
        </label>
        {selectedCount > 0 && <span>{selectedCount} selected</span>}
      </div>
      <ul className="divide-y divide-hairline">
        {missions.map((m) => {
          const selected = selection.selectedIds.has(m.id);
          return (
            <li
              key={m.key}
              className={`flex items-start gap-3 px-4 py-3 transition ${
                selected ? "bg-[color:color-mix(in_srgb,var(--role)_8%,transparent)]" : ""
              }`}
            >
              <span className="pt-1">
                <MissionCheckbox
                  checked={selected}
                  onToggle={(shift) => selection.onToggle(m.id, shift)}
                  ariaLabel={`Select ${m.key}: ${m.title}`}
                />
              </span>
              <Link href={`/app/missions/${m.key}`} className="group block min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span className="shrink-0 font-mono text-[12px] text-ink-dim">{m.key}</span>
                    <span className="truncate text-[14px] text-ink group-hover:text-[color:var(--role)]">{m.title}</span>
                  </div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em]" style={{ color: legible(stageHue(m.stage)) }}>
                    {STAGE_LABEL[m.stage]}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-ink-faint">
                  Archived {m.archived ? new Date(m.archived.at).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                  {m.apps.length ? ` · ${m.apps.map((a) => a.name).join(", ")}` : ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Cancelled missions: kept for the record, out of every lane. Their creator can restore them from the mission page or toolbar. */
function CancelledList({ missions, selection }: { missions: Mission[]; selection: SelectionApi }) {
  const selectedCount = missions.filter((m) => selection.selectedIds.has(m.id)).length;
  return (
    <div className="mx-auto mt-6 max-w-[860px] overflow-hidden rounded-md border border-hairline">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">
        <label className="inline-flex cursor-pointer items-center gap-3 select-none">
          <MissionCheckbox
            checked={selection.allSelected}
            indeterminate={selection.someSelected}
            onToggle={() => selection.onToggleAll()}
            ariaLabel="Select all missions"
          />
          <span>Cancelled missions ({missions.length})</span>
        </label>
        {selectedCount > 0 && <span>{selectedCount} selected</span>}
      </div>
      <ul className="divide-y divide-hairline">
        {missions.map((m) => {
          const selected = selection.selectedIds.has(m.id);
          return (
            <li
              key={m.key}
              className={`flex items-start gap-3 px-4 py-3 transition ${
                selected ? "bg-[color:color-mix(in_srgb,var(--role)_8%,transparent)]" : ""
              }`}
            >
              <span className="pt-1">
                <MissionCheckbox
                  checked={selected}
                  onToggle={(shift) => selection.onToggle(m.id, shift)}
                  ariaLabel={`Select ${m.key}: ${m.title}`}
                />
              </span>
              <Link href={`/app/missions/${m.key}`} className="group block min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <span className="shrink-0 font-mono text-[12px] text-ink-dim">{m.key}</span>
                  <span className="truncate text-[14px] text-ink group-hover:text-[color:var(--role)]">{m.title}</span>
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-ink-faint">
                  Cancelled {m.cancelled ? new Date(m.cancelled.at).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                  {m.cancelled?.reason ? ` · ${m.cancelled.reason}` : ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
