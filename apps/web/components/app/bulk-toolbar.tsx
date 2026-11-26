"use client";

import { Archive, ArchiveRestore, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PRIORITIES } from "@/components/app/priority";
import { useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import type { RoleDef } from "@/lib/app/roles";
import { STAGE_LABEL, type Mission, type MissionStage } from "@/lib/app/types";

const STAGES: MissionStage[] = ["business", "product", "engineering", "developer", "build", "verifying", "done"];

/** Accessible checkbox supporting indeterminate state and Shift+Click range selection without double-toggling. */
export function MissionCheckbox({
  checked,
  indeterminate = false,
  onToggle,
  ariaLabel,
  className = "",
}: {
  checked: boolean;
  indeterminate?: boolean;
  onToggle: (shiftKey: boolean) => void;
  ariaLabel: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shiftRef = useRef(false);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        shiftRef.current = e.shiftKey;
      }}
      onChange={() => {
        const shift = shiftRef.current;
        shiftRef.current = false;
        onToggle(shift);
      }}
      className={`h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border border-[rgb(var(--line)/.4)] bg-[rgb(var(--void-rgb)/.85)] accent-[color:var(--role)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--role)] ${className}`}
    />
  );
}

/** Same rule as the API: permanent deletion is only allowed before a mission leaves the Business seat. */
export function isMissionDeletable(m: Mission, currentUserId: string): boolean {
  return m.createdBy === currentUserId && m.stage === "business" && !m.files.some((f) => f.status === "approved") && m.links.length === 0;
}

export function FloatingBulkToolbar({
  selectedMissions,
  totalVisible,
  view,
  role,
  currentUserId,
  onSelectAll,
  onClear,
  onUpdated,
}: {
  selectedMissions: Mission[];
  totalVisible: number;
  view: string;
  role: RoleDef;
  currentUserId: string;
  onSelectAll: () => void;
  onClear: () => void;
  onUpdated: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const count = selectedMissions.length;

  useEffect(() => {
    setConfirmDelete(false);
  }, [count, view]);

  if (count === 0) return null;

  const ids = selectedMissions.map((m) => m.id);
  const noun = count === 1 ? "mission" : "missions";
  const allDeletable = selectedMissions.every((m) => isMissionDeletable(m, currentUserId));
  const allCreatedByMe = selectedMissions.every((m) => m.createdBy === currentUserId);
  const canTriageStages = role.id !== "business" && view !== "cancelled";

  const runBatchUpdate = async (payload: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    try {
      await api("/api/v1/missions/batch", { method: "PATCH", json: { ids, ...payload } });
      await onUpdated();
      onClear();
      toast(successMsg, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Batch update failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const runBatchDelete = async () => {
    setBusy(true);
    try {
      await api("/api/v1/missions/batch/delete", { method: "POST", json: { ids } });
      await onUpdated();
      onClear();
      toast(`Deleted ${count} ${noun}`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Batch delete failed", "error");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[70px] z-40 flex justify-center px-3 lg:bottom-5 lg:left-[232px]">
      <div
        role="toolbar"
        aria-label="Bulk mission actions"
        className="pointer-events-auto flex max-w-[960px] flex-wrap items-center gap-2 rounded-md border border-[rgb(var(--line)/.3)] bg-[rgb(var(--deck-rgb)/.95)] px-3.5 py-2.5 text-[13px] shadow-2xl backdrop-blur-md"
      >
        <div className="order-1 flex items-center gap-2 pr-1">
          <span
            className="inline-flex h-6 items-center rounded-sm px-2 font-mono text-[11.5px] font-semibold text-abyss"
            style={{ background: role.ink }}
          >
            {count} selected
          </span>
          {count < totalVisible && (
            <button
              type="button"
              disabled={busy}
              onClick={onSelectAll}
              className="text-[12px] text-ink-muted underline decoration-dotted hover:text-ink disabled:opacity-50"
            >
              Select all ({totalVisible})
            </button>
          )}
        </div>

        <span aria-hidden className="hidden h-4 w-px bg-hairline sm:order-2 sm:inline-block" />

        {confirmDelete ? (
          <div className="order-3 flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {allDeletable ? (
              <>
                <span className="text-[12.5px] text-ink">
                  Delete {count} {noun} permanently?
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runBatchDelete()}
                  className="h-8 rounded-sm border border-[rgba(233,113,60,.5)] bg-[rgba(233,113,60,.12)] px-3 text-[12.5px] font-medium text-[color:var(--coral-ink)] hover:bg-[rgba(233,113,60,.2)] disabled:opacity-50"
                >
                  {busy ? "Deleting…" : "Confirm delete"}
                </button>
              </>
            ) : (
              <>
                <span className="text-[12px] text-ink-muted">
                  Only unapproved Business-stage missions you started can be deleted permanently.
                </span>
                {view !== "archived" && view !== "cancelled" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runBatchUpdate({ status: "archived" }, `Archived ${count} ${noun}`)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[12.5px] text-ink hover:border-ink-faint disabled:opacity-50"
                  >
                    <Archive size={13} /> Archive instead
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
              className="h-8 rounded-sm border border-hairline px-2.5 text-[12.5px] text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Back
            </button>
          </div>
        ) : (
          <div className="order-3 flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {view === "archived" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runBatchUpdate({ status: "unarchived" }, `Unarchived ${count} ${noun}`)}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline bg-[rgb(var(--line)/.06)] px-3 text-[12.5px] font-medium text-ink hover:border-ink-faint disabled:opacity-50"
              >
                <ArchiveRestore size={14} /> Unarchive
              </button>
            ) : view === "cancelled" ? (
              allCreatedByMe && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runBatchUpdate({ status: "restored" }, `Restored ${count} ${noun}`)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline bg-[rgb(var(--line)/.06)] px-3 text-[12.5px] font-medium text-ink hover:border-ink-faint disabled:opacity-50"
                >
                  <RotateCcw size={13} /> Restore
                </button>
              )
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runBatchUpdate({ status: "archived" }, `Archived ${count} ${noun}`)}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline bg-[rgb(var(--line)/.06)] px-3 text-[12.5px] font-medium text-ink hover:border-ink-faint disabled:opacity-50"
              >
                <Archive size={14} /> Archive
              </button>
            )}

            {canTriageStages && (
              <select
                aria-label="Bulk status"
                disabled={busy}
                value=""
                onChange={(e) => {
                  const status = e.target.value;
                  if (!status) return;
                  const label = status === "archived" ? "Archived" : STAGE_LABEL[status as MissionStage];
                  void runBatchUpdate(
                    { status },
                    status === "archived" ? `Archived ${count} ${noun}` : `Moved ${count} ${noun} to ${label}`,
                  );
                }}
                className="h-8 rounded-sm border border-hairline bg-void px-2.5 text-[12.5px] text-ink outline-none hover:border-ink-faint focus:border-[color:var(--role)] disabled:opacity-50"
              >
                <option value="" disabled>
                  Set status…
                </option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
                {view !== "archived" && <option value="archived">Archived</option>}
              </select>
            )}

            {role.id === "product" && view !== "cancelled" && (
              <select
                aria-label="Bulk priority"
                disabled={busy}
                value=""
                onChange={(e) => {
                  const priority = e.target.value;
                  if (!priority) return;
                  void runBatchUpdate({ priority }, `Set ${count} ${noun} to ${priority}`);
                }}
                className="h-8 rounded-sm border border-hairline bg-void px-2 text-[12.5px] text-ink outline-none hover:border-ink-faint focus:border-[color:var(--role)] disabled:opacity-50"
              >
                <option value="" disabled>
                  Priority…
                </option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[rgba(233,113,60,.38)] px-3 text-[12.5px] text-[color:var(--coral-ink)] hover:bg-[rgba(233,113,60,.08)] disabled:opacity-50"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          className="order-2 ml-auto inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px] text-ink-faint hover:bg-[rgb(var(--line)/.08)] hover:text-ink disabled:opacity-50 sm:order-last"
        >
          <X size={13} />
          <span className="font-mono text-[10.5px] uppercase">Esc</span>
        </button>
      </div>
    </div>
  );
}
