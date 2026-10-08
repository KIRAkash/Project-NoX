"use client";

/**
 * Team memory (CP20): lessons people taught NoX by sending work back. Three pieces share this file:
 *  - RememberToggle: the "Remember this for next time" box on Send back and Not met (ticked by default).
 *  - LessonsChip: on a spec file, the lessons NoX's latest draft used, with where each was learned.
 *  - LessonsPanel: on the application page, everything NoX has learned there; forget a lesson or teach one.
 */

import { GraduationCap, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FEED_LIST, Panel, useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import { ROLE_BY_ID, type RoleId } from "@/lib/app/roles";
import { useApi } from "@/lib/app/use-api";

export type Lesson = {
  id: string;
  kbId: string;
  app: string | null;
  seat: RoleId | null;
  fact: string;
  kind: string;
  status: string;
  origin: string;
  appliedCount: number;
  createdAt: string | null;
  inMemoryBank: boolean;
  sources: { missionKey: string | null; quote: string; by: string; role: string | null; at: string }[];
};

/** A `[[memory:<id>]]` citation in a file asks the chip above it to open on that lesson. */
export const LESSON_OPEN = "nox:lesson";

export function openLesson(id: string) {
  window.dispatchEvent(new CustomEvent(LESSON_OPEN, { detail: id }));
}

export function RememberToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[color:var(--role)]" />
      <span>
        Remember this for next time
        <span className="block text-ink-faint">NoX keeps the lesson for this application and applies it to later missions. You can remove it any time.</span>
      </span>
    </label>
  );
}

function SourceLine({ l }: { l: Lesson }) {
  const first = l.sources[0];
  return (
    <span className="text-[11.5px] text-ink-dim">
      {first?.missionKey ? (
        <>
          Learned from{" "}
          <Link href={`/app/missions/${first.missionKey}`} className="text-ink-muted underline decoration-dotted hover:text-ink">
            {first.missionKey}
          </Link>
          {first.role && ROLE_BY_ID[first.role as RoleId] ? ` · ${ROLE_BY_ID[first.role as RoleId].name}` : ""}
        </>
      ) : (
        <>Taught by {first?.by ?? "someone"}</>
      )}
      {l.sources.length > 1 && ` · +${l.sources.length - 1} more`}
    </span>
  );
}

/** "2 lessons applied" on a spec file; opens the list (also when a [[memory:…]] citation in the file is clicked). */
export function LessonsChip({ missionKey, role, version }: { missionKey: string; role: RoleId; version: number }) {
  const data = useApi<Record<string, { cited: boolean; lessons: Lesson[] }>>(`/api/v1/missions/${missionKey}/lessons?v=${version}`);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const mine = data.data?.[role];
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (mine?.lessons.some((l) => l.id === id)) {
        setFocus(id);
        setOpen(true);
      }
    };
    window.addEventListener(LESSON_OPEN, onOpen);
    return () => window.removeEventListener(LESSON_OPEN, onOpen);
  }, [mine]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!mine?.lessons.length) return null;
  const n = mine.lessons.length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Rules people taught NoX on earlier missions"
        className="flex items-center gap-1 whitespace-nowrap rounded-full border border-[rgba(95,210,159,.4)] px-2 py-0.5 text-[12px] text-verify hover:bg-[rgba(95,210,159,.08)]"
      >
        <GraduationCap size={12} aria-hidden /> {n} lesson{n === 1 ? "" : "s"} {mine.cited ? "applied" : "in mind"}
      </button>
      {open && (
        <div role="dialog" aria-label="Lessons NoX applied" className="absolute left-0 top-8 z-30 w-[min(340px,calc(100vw-48px))] rounded-md border border-hairline bg-deck p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">What the team taught NoX</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-ink-dim hover:text-ink">
              <X size={14} />
            </button>
          </div>
          <ul className="space-y-2.5">
            {mine.lessons.map((l) => (
              <li key={l.id} className={`rounded-sm px-2 py-1.5 ${focus === l.id ? "bg-[rgba(95,210,159,.08)]" : ""}`}>
                <p className="text-[13px] leading-snug text-ink">{l.fact}</p>
                <SourceLine l={l} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] leading-snug text-ink-faint">
            {mine.cited ? "Each is cited in the file where NoX used it." : "NoX kept these in mind while writing this file."} Manage them on the application&rsquo;s page.
          </p>
        </div>
      )}
    </div>
  );
}

/** Everything NoX has learned for one application: forget a lesson, or teach one directly. */
export function LessonsPanel({ kbId }: { kbId: string }) {
  const toast = useToast();
  const data = useApi<{ memories: Lesson[]; backend: string; canCurate: boolean }>(`/api/v1/kb/${kbId}/memories`);
  const [fact, setFact] = useState("");
  const [seat, setSeat] = useState<RoleId | "">("");
  const [busy, setBusy] = useState(false);
  const lessons = data.data?.memories ?? [];
  const canCurate = Boolean(data.data?.canCurate);
  if (data.data?.backend === "off") return null;

  const teach = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ memories: (Lesson & { action: string })[] }>(`/api/v1/kb/${kbId}/memories`, { method: "POST", json: { fact, seat: seat || null } });
      toast(res.memories[0]?.action === "merged" ? "NoX already knew something close: added to that lesson" : "NoX will apply this to later missions", "success");
      setFact("");
      void data.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't keep that lesson", "error");
    } finally {
      setBusy(false);
    }
  };
  const forget = async (l: Lesson) => {
    if (!window.confirm(`Forget this lesson?\n\n${l.fact}`)) return;
    try {
      await api(`/api/v1/memories/${l.id}`, { method: "DELETE" });
      toast("Forgotten. Later drafts won't use it", "success");
      void data.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't forget it", "error");
    }
  };

  return (
    <Panel title="What NoX has learned">
      {lessons.length ? (
        <ul tabIndex={0} aria-label="Lessons" className={`${FEED_LIST} space-y-3`}>
          {lessons.map((l) => (
            <li key={l.id} className="flex items-start gap-2">
              <GraduationCap size={13} className="mt-1 shrink-0 text-verify" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-ink">{l.fact}</p>
                <div className="flex flex-wrap items-center gap-x-2">
                  <SourceLine l={l} />
                  <span className="text-[11px] text-ink-dim">· {l.seat ? `${ROLE_BY_ID[l.seat].name} files` : "every file"}</span>
                  {l.appliedCount > 0 && <span className="text-[11px] text-ink-dim">· used {l.appliedCount}×</span>}
                </div>
              </div>
              {canCurate && (
                <button type="button" aria-label={`Forget: ${l.fact}`} onClick={() => void forget(l)} className="mt-0.5 text-ink-dim hover:text-ink">
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-faint">Nothing yet. When someone sends work back with &ldquo;Remember this&rdquo; ticked, the lesson shows up here.</p>
      )}
      {canCurate && (
        <form onSubmit={teach} className="mt-4 space-y-2 border-t border-hairline pt-3">
          <label htmlFor="teach-nox" className="text-[12px] text-ink-dim">
            Teach NoX a rule for this application
          </label>
          <textarea id="teach-nox" value={fact} onChange={(e) => setFact(e.target.value)} required minLength={8} maxLength={500} rows={2} placeholder="e.g. Refund emails always name the claim number." className="w-full rounded-sm border border-hairline bg-deck p-2 text-[13px] text-ink outline-none focus:border-[color:var(--role)]" />
          <div className="flex flex-wrap gap-2">
            <select value={seat} onChange={(e) => setSeat(e.target.value as RoleId | "")} aria-label="Which files apply it" className="h-9 min-w-0 flex-1 rounded-sm border border-hairline bg-deck px-2 text-[13px] text-ink">
              <option value="">Every file</option>
              {(["business", "product", "engineering", "developer"] as RoleId[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_BY_ID[r].name} files
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy || fact.trim().length < 8} className="h-9 rounded-sm border border-hairline px-3 text-[13px] text-ink hover:border-ink-faint disabled:opacity-50">
              {busy ? "Keeping…" : "Teach NoX"}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}
