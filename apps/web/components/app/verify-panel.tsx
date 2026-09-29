"use client";

import { Check, CircleDashed, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Planet } from "@/components/app/planet";
import { useToast } from "@/components/app/ui";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import { ROLE_BY_ID, type RoleId } from "@/lib/app/roles";
import type { Mission, SpecFile, VerificationItem } from "@/lib/app/types";

/** Checklist items are one line of Markdown; show `code` spans and drop bold markers. */
function ItemText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={i} className="rounded-sm bg-[rgba(143,160,204,.1)] px-1 font-mono text-[12px]">
            {part.slice(1, -1)}
          </code>
        ) : (
          part.replace(/\*\*/g, "").replace(/\[\[kb:[^\]|]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[kb:([^\]]+)\]\]/g, (_, p: string) => p.split("/").pop() ?? p)
        ),
      )}
    </>
  );
}

export const VERIFY_ORDER: RoleId[] = ["developer", "engineering", "product", "business"];

/** Four steps, developer first: who has verified, whose turn it is, who is still to come. */
export function VerifyStrip({ m }: { m: Mission }) {
  if (m.stage !== "verifying" && m.stage !== "done" && !m.files.some((f) => f.verification?.result)) return null;
  return (
    <ol className="mt-5 flex flex-wrap items-center gap-2 text-[12.5px]" aria-label="Verification">
      <li className="mr-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">Coming back</li>
      {VERIFY_ORDER.map((r, i) => {
        const f = m.files.find((x) => x.role === r)!;
        const role = ROLE_BY_ID[r];
        const current = m.stage === "verifying" && m.verifyRole === r;
        const result = m.stage === "done" ? "verified" : f.verification?.result;
        const items = f.verification?.items ?? [];
        return (
          <li key={r} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-4 bg-hairline" aria-hidden />}
            <span
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1"
              style={{ borderColor: current ? role.hue : result === "verified" ? "rgba(95,210,159,.4)" : result === "not_met" ? "rgba(233,113,60,.5)" : "rgba(143,160,204,.18)", color: current ? role.hue : "#A6AEC7" }}
            >
              <Planet role={role} size={12} />
              {role.name}
              {result === "verified" && !current ? (
                <Check size={12} className="text-[#5FD29F]" aria-label="verified" />
              ) : result === "not_met" && !current ? (
                <X size={12} className="text-[#E9713C]" aria-label="not met" />
              ) : current ? (
                <span className="font-mono text-[10.5px]">
                  {items.filter((x) => x.checked).length}/{items.length}
                </span>
              ) : (
                <CircleDashed size={11} className="text-ink-dim" aria-label="waiting" />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The lit checklist for the seat whose turn it is. Only that seat ticks; everyone else watches. */
export function VerifyPanel({ m, file, mine, onChanged }: { m: Mission; file: SpecFile; mine: boolean; onChanged: () => void }) {
  const toast = useToast();
  const role = ROLE_BY_ID[file.role];
  const [items, setItems] = useState<VerificationItem[]>(file.verification?.items ?? []);
  const [saving, setSaving] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState("");
  const [backTo, setBackTo] = useState<RoleId>("developer");
  useEffect(() => setItems(file.verification?.items ?? []), [file.verification]);

  const lit = m.stage === "verifying" && m.verifyRole === file.role;
  const result = file.verification?.result;
  if (!lit && !result) return null;

  const persist = async (next: VerificationItem[]) => {
    setItems(next);
    setSaving(true);
    try {
      await api(`/api/v1/missions/${m.key}/files/${file.role}/verification`, { method: "PUT", json: { items: next.map((i) => ({ checked: i.checked, note: i.note ?? null })) } });
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't save the tick", "error");
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const verdict = async (v: "verified" | "not_met") => {
    try {
      await api(`/api/v1/missions/${m.key}/files/${file.role}/verify`, { method: "POST", json: v === "verified" ? { verdict: v } : { verdict: v, note, backTo } });
      toast(v === "verified" ? (file.role === "business" ? "Verified — mission done" : "Verified — passed to the next seat") : `Flagged as not met — back to the ${ROLE_BY_ID[backTo].name}`, "success");
      setFlagging(false);
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't record that", "error");
    }
  };

  const all = items.length > 0 && items.every((i) => i.checked);
  const editable = lit && mine;

  return (
    <section
      className="mb-5 rounded-md border p-4 sm:p-5"
      style={{ borderColor: lit ? role.hue : "rgba(143,160,204,.18)", background: lit ? "color-mix(in srgb, var(--role) 5%, transparent)" : "transparent", boxShadow: lit ? `0 0 0 1px ${role.hue}22, 0 0 28px ${role.hue}1f` : undefined }}
      aria-label="Verification checklist"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-ink">Verification checklist</h2>
        <span className="font-mono text-[11px] text-ink-dim">
          {lit
            ? editable
              ? `Your turn · ${items.filter((i) => i.checked).length}/${items.length}${saving ? " · saving…" : ""}`
              : `Waiting on the ${role.name}`
            : result === "verified"
              ? `Verified by ${file.verification?.verifiedBy ?? "?"}`
              : `Not met — ${file.verification?.note ?? ""}`}
        </span>
      </div>
      {!items.length && <p className="mt-3 text-[13px] text-ink-faint">This file has no checklist items. {editable ? "Mark it verified if the work matches it." : ""}</p>}
      <ul className="mt-3 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="rounded-sm border border-hairline bg-[rgba(9,11,19,.5)] px-3 py-2">
            <label className={`flex items-start gap-2.5 text-[13.5px] ${editable ? "cursor-pointer" : ""}`}>
              <input
                type="checkbox"
                checked={it.checked}
                disabled={!editable}
                onChange={() => void persist(items.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))}
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ accentColor: role.hue }}
              />
              <span className={`min-w-0 [overflow-wrap:anywhere] ${it.checked ? "text-ink" : "text-ink-muted"}`}>
                <ItemText text={it.text} />
              </span>
            </label>
            {editable ? (
              <input
                defaultValue={it.note ?? ""}
                placeholder="Add a note (optional)"
                aria-label={`Note for: ${it.text}`}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== (it.note ?? null)) void persist(items.map((x, j) => (j === i ? { ...x, note: v } : x)));
                }}
                className="mt-1.5 h-8 w-full rounded-sm border border-transparent bg-transparent px-6 text-[12.5px] text-ink-muted outline-none focus:border-hairline"
              />
            ) : (
              it.note && <p className="mt-1 pl-6 text-[12.5px] text-ink-faint">{it.note}</p>
            )}
          </li>
        ))}
      </ul>
      {editable && !flagging && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setFlagging(true)} className="h-9 rounded-sm border border-[rgba(233,113,60,.45)] px-4 text-[13px] text-[#F3A27E] hover:bg-[rgba(233,113,60,.08)]">
            Not met
          </button>
          <LiquidMetalButton hue={role.hue} disabled={!all && items.length > 0} onClick={() => void verdict("verified")} className="h-9 rounded-sm px-4 text-[13px] font-semibold disabled:opacity-40" title={all || !items.length ? undefined : "Tick every item first"}>
            Verified
          </LiquidMetalButton>
        </div>
      )}
      {editable && flagging && (
        <div className="mt-4 space-y-2 rounded-sm border border-[rgba(233,113,60,.35)] p-3">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus placeholder="What isn't met?" aria-label="What isn't met" className="w-full rounded-sm border border-hairline bg-void p-2 text-[13px] text-ink" />
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink-muted">Who fixes it?</span>
            <select value={backTo} onChange={(e) => setBackTo(e.target.value as RoleId)} aria-label="Send back to" className="h-9 rounded-sm border border-hairline bg-void px-2 text-ink">
              <option value="developer">Developer — the build needs another pass</option>
              {(["business", "product", "engineering"] as RoleId[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_BY_ID[r].name} — the requirement itself is off
                </option>
              ))}
            </select>
            <span className="flex-1" />
            <button type="button" onClick={() => setFlagging(false)} className="h-9 px-2 text-ink-dim">
              Cancel
            </button>
            <button type="button" disabled={note.trim().length < 3} onClick={() => void verdict("not_met")} className="h-9 rounded-sm bg-[#E9713C] px-4 font-semibold text-void disabled:opacity-40">
              Send back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
