"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SightingCard } from "@/components/app/sighting-card";
import { EmptyState, PageHeader, Panel, useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID, ROLES, type RoleDef } from "@/lib/app/roles";
import { subscribe } from "@/lib/app/stream";
import { SIGHTING_KIND_LABEL, type Sighting, type SightingRun, type SightingSchedule } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

type OrgSchedule = { org: { id: string; name: string }; schedule: SightingSchedule; lastRun: SightingRun | null; canManage: boolean };
type Schedules = { orgs: OrgSchedule[]; kinds: Record<string, string[]> };
type Tab = "open" | "launched" | "dismissed";

const TABS: { id: Tab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "launched", label: "Started" },
  { id: "dismissed", label: "Dismissed" },
];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NODE_LABEL: Record<string, string> = { collect: "Reading signals", scout: "Looking through each seat's lens", merge: "Merging what overlaps", review: "Checking each one", write: "Writing for each seat", save: "Saving" };

/** Changes NoX suggests for the acting seat, and when NoX looks for them. */
export default function SightingsPage() {
  const { me } = useAuth();
  const role = ROLE_BY_ID[me!.role!];
  const [tab, setTab] = useState<Tab>("open");
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (asked && TABS.some((t) => t.id === asked)) setTab(asked as Tab);
  }, []);
  const [app, setApp] = useState("");
  const [kind, setKind] = useState("");
  const list = useApi<Sighting[]>(`/api/v1/sightings?status=${tab}`);
  const schedules = useApi<Schedules>("/api/v1/sightings/schedules");
  const items = list.data ?? [];
  const apps = useMemo(() => [...new Set(items.flatMap((s) => s.apps.map((a) => a.name)))].sort(), [items]);
  const kinds = useMemo(() => [...new Set(items.map((s) => s.kind).filter(Boolean))], [items]);
  const shown = items.filter((s) => (!app || s.apps.some((a) => a.name === app)) && (!kind || s.kind === kind));

  return (
    <div className="mx-auto max-w-shell">
      <PageHeader
        eyebrow="Sightings"
        title="Spotted by NoX"
        lead={`Changes NoX thinks are worth your time, written for the ${role.name.toLowerCase()}. Each one cites what it's based on. Start a mission from any of them in one click.`}
      />

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-sm border border-hairline" role="group" aria-label="Which sightings">
              {TABS.map((t) => (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className={`px-3 py-1.5 text-[13px] ${tab === t.id ? "bg-[color:var(--role)] text-void" : "text-ink-dim hover:text-ink"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {role.id !== "business" && apps.length > 1 && (
              <select aria-label="Application" value={app} onChange={(e) => setApp(e.target.value)} className="h-8 rounded-sm border border-hairline bg-deck px-2 text-[13px] text-ink">
                <option value="">All applications</option>
                {apps.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}
            {kinds.length > 1 && (
              <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-sm border border-hairline bg-deck px-2 text-[13px] text-ink">
                <option value="">All kinds</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>{SIGHTING_KIND_LABEL[k] ?? k}</option>
                ))}
              </select>
            )}
          </div>

          {list.loading && !list.data ? (
            <p className="text-[13px] text-ink-faint">Loading…</p>
          ) : list.error ? (
            <p className="text-[13px] text-ink-faint">{list.error.detail}</p>
          ) : shown.length ? (
            <div className="grid items-start gap-3 md:grid-cols-2">
              {shown.map((s) => (
                <SightingCard key={s.id} s={s} role={role} onChanged={() => void list.reload()} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-hairline">
              <EmptyState
                role={role}
                line={
                  tab === "open"
                    ? "Nothing worth your time right now. NoX looks again on its schedule, and only suggests what it can back up."
                    : tab === "launched"
                      ? "Nothing started from a sighting yet."
                      : "Nothing dismissed or hidden."
                }
              />
            </div>
          )}
        </div>

        <div className="space-y-5">
          {schedules.data?.orgs.map((o) => (
            <SchedulePanel key={o.org.id} entry={o} kinds={schedules.data!.kinds} role={role} many={schedules.data!.orgs.length > 1}
              onChanged={() => { void schedules.reload(); void list.reload(); }} />
          ))}
          {schedules.data && !schedules.data.orgs.length && <EmptyState line="Join an organisation to see what NoX spots in it." />}
        </div>
      </div>
    </div>
  );
}

function when(s: SightingSchedule): string {
  if (s.cadence === "off") return "NoX isn't looking on a schedule.";
  const at = `${String(s.hour).padStart(2, "0")}:00 ${s.timezone}`;
  return s.cadence === "daily" ? `NoX looks every day at ${at}.` : `NoX looks every ${WEEKDAYS[s.weekday]} at ${at}.`;
}

function SchedulePanel({ entry, kinds, role, many, onChanged }: { entry: OrgSchedule; kinds: Record<string, string[]>; role: RoleDef; many: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<SightingSchedule>(entry.schedule);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(entry.lastRun?.status === "running");
  const [steps, setSteps] = useState<string[]>([]);
  const [node, setNode] = useState("");
  const orgId = entry.org.id;
  const run = entry.lastRun;
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => setForm(entry.schedule), [entry.schedule]);
  useEffect(() => setRunning(entry.lastRun?.status === "running"), [entry.lastRun?.status]);

  useEffect(() => {
    if (!running) return;
    return subscribe(`/api/v1/orgs/${orgId}/sightings/stream`, (e) => {
      const ev = e.data as { type: string; payload: { label?: string; node?: string; counts?: Record<string, number> } };
      if (ev.type === "step" && ev.payload.label) setSteps((xs) => [...xs.slice(-4), ev.payload.label!]);
      if (ev.type === "node_started" && ev.payload.node) setNode(ev.payload.node);
      if (ev.type === "sightings.ready" || ev.type === "run.failed") {
        setRunning(false);
        setNode("");
        setSteps([]);
        if (ev.type === "sightings.ready") {
          const n = ev.payload.counts?.[role.id] ?? 0;
          toast(n ? `NoX spotted ${n} new for you` : "NoX looked. Nothing new for you this time", "success");
        } else toast("NoX couldn't finish looking. Try again", "error");
        changed.current();
      }
    });
  }, [running, orgId, role.id, toast]);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/v1/orgs/${orgId}/sightings/settings`, { method: "PUT", json: { cadence: form.cadence, weekday: form.weekday, hour: form.hour, timezone: form.timezone, seats: form.seats, focus: form.focus } });
      toast("Schedule saved", "success");
      setEditing(false);
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't save the schedule", "error");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    try {
      await api(`/api/v1/orgs/${orgId}/sightings/run`, { method: "POST" });
      setSteps([]);
      setRunning(true);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't start", "error");
    }
  };

  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const fresh = run?.counts?.[role.id];

  return (
    <Panel title={many ? `Schedule · ${entry.org.name}` : "Schedule"}>
      {!editing ? (
        <div className="space-y-3 text-[13.5px]">
          <p className="text-ink">{when(entry.schedule)}</p>
          {entry.schedule.nextRunAt && entry.schedule.cadence !== "off" && (
            <p className="text-[12.5px] text-ink-faint">Next look: {new Date(entry.schedule.nextRunAt + "Z").toLocaleString()}</p>
          )}
          {entry.schedule.focus.length > 0 && (
            <p className="text-[12.5px] text-ink-faint">Focus: {entry.schedule.focus.map((k) => SIGHTING_KIND_LABEL[k] ?? k).join(", ")}</p>
          )}
          {entry.canManage && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={runNow} disabled={running} className="h-8 rounded-sm px-3 text-[13px] font-semibold text-abyss disabled:opacity-50" style={{ background: role.hue }}>
                {running ? "Looking…" : "Look now"}
              </button>
              <button type="button" onClick={() => setEditing(true)} className="h-8 rounded-sm border border-hairline px-3 text-[13px] text-ink hover:border-ink-faint">
                Change schedule
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4 text-[13px]">
          <div className="flex rounded-sm border border-hairline" role="group" aria-label="How often">
            {(["off", "daily", "weekly"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, cadence: c })} aria-pressed={form.cadence === c} className={`flex-1 px-2 py-1.5 capitalize ${form.cadence === c ? "bg-[color:var(--role)] text-void" : "text-ink-dim hover:text-ink"}`}>
                {c}
              </button>
            ))}
          </div>
          {form.cadence !== "off" && (
            <div className="flex flex-wrap gap-2">
              {form.cadence === "weekly" && (
                <select aria-label="Day" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })} className="h-8 rounded-sm border border-hairline bg-deck px-2 text-ink">
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              )}
              <select aria-label="Hour" value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} className="h-8 rounded-sm border border-hairline bg-deck px-2 font-mono text-ink">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
              <input aria-label="Timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="h-8 min-w-0 flex-1 rounded-sm border border-hairline bg-deck px-2 font-mono text-ink outline-none focus:border-[color:var(--role)]" />
            </div>
          )}
          <fieldset>
            <legend className="mb-1.5 text-ink-dim">Write sightings for</legend>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((r) => (
                <button key={r.id} type="button" onClick={() => setForm({ ...form, seats: toggle(form.seats, r.id) })} aria-pressed={form.seats.includes(r.id)}
                  className="rounded-sm border px-2 py-1 text-[12px]" style={form.seats.includes(r.id) ? { borderColor: r.ink, color: r.ink } : { borderColor: "rgb(var(--line)/.14)", color: "var(--ink-dim)" }}>
                  {r.name}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-ink-dim">Focus on (optional)</legend>
            <div className="space-y-2">
              {ROLES.filter((r) => form.seats.includes(r.id)).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-full font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: r.ink }}>{r.name}</span>
                  {(kinds[r.id] ?? []).map((k) => (
                    <button key={k} type="button" onClick={() => setForm({ ...form, focus: toggle(form.focus, k) })} aria-pressed={form.focus.includes(k)}
                      className={`rounded-full border px-2 py-0.5 text-[11.5px] ${form.focus.includes(k) ? "border-[color:var(--role)] text-ink" : "border-hairline text-ink-dim hover:text-ink"}`}>
                      {SIGHTING_KIND_LABEL[k] ?? k}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving || !form.seats.length} className="h-8 rounded-sm px-3 font-semibold text-abyss disabled:opacity-50" style={{ background: role.hue }}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => { setForm(entry.schedule); setEditing(false); }} className="h-8 px-2 text-ink-dim hover:text-ink">Cancel</button>
          </div>
        </div>
      )}

      {(running || run) && (
        <div className="mt-5 border-t border-hairline pt-4 text-[12.5px]">
          {running ? (
            <>
              <p className="text-ink">{NODE_LABEL[node] ?? "Starting"}…</p>
              <ul className="mt-1.5 space-y-0.5 text-ink-faint">
                {steps.map((s, i) => (
                  <li key={`${i}-${s}`} className="truncate">{s}</li>
                ))}
              </ul>
            </>
          ) : run ? (
            <>
              <p className="text-ink-muted">
                Last look {run.finishedAt ? new Date(run.finishedAt + "Z").toLocaleString() : ""}
                {run.status === "failed" ? " didn't finish." : "."}
              </p>
              {run.status === "done" && (
                <p className="mt-1 text-ink-faint">
                  {fresh ? `${fresh} new for you` : "Nothing new for you"} · {run.appsScanned.length} application{run.appsScanned.length === 1 ? "" : "s"} looked at
                  {run.appsSkipped.length ? `, ${run.appsSkipped.length} unchanged` : ""}
                </p>
              )}
              {entry.canManage && run.usage?.line && (
                <p className="mt-1 font-mono text-[11px] text-ink-dim">
                  {run.usage.line}{typeof run.usage.cost === "number" ? ` · $${run.usage.cost.toFixed(2)}` : ""}
                </p>
              )}
            </>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
