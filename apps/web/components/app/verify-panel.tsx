"use client";

import { Check, CircleDashed, MonitorPlay, Paperclip, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { RememberToggle } from "@/components/app/lessons";
import { CaptureBar } from "@/components/app/media/capture-bar";
import { MediaChip, seekMedia } from "@/components/app/media/media-chip";
import { Planet } from "@/components/app/planet";
import { useToast } from "@/components/app/ui";
import { VoiceInput } from "@/components/app/voice-input";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import { ROLE_BY_ID, type RoleId } from "@/lib/app/roles";
import { type Evidence, fmtT, type Mission, type SpecFile, type Verdict, type VerificationItem } from "@/lib/app/types";
import { C, tint } from "@/lib/app/palette";

/** Checklist items are one line of Markdown; show `code` spans and drop bold markers. */
function ItemText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={i} className="rounded-sm bg-[rgb(var(--line)/.1)] px-1 font-mono text-[12px]">
            {part.slice(1, -1)}
          </code>
        ) : (
          part.replace(/\*\*/g, "").replace(/\[\[media:[^\]]+\]\]/g, "▶").replace(/\[\[kb:[^\]|]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[kb:([^\]]+)\]\]/g, (_, p: string) => p.split("/").pop() ?? p)
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
              style={{ borderColor: current ? role.ink : result === "verified" ? "rgba(95,210,159,.4)" : result === "not_met" ? "rgba(233,113,60,.5)" : "rgb(var(--line)/.18)", color: current ? role.ink : "var(--ink-muted)" }}
            >
              <Planet role={role} size={12} />
              {role.name}
              {result === "verified" && !current ? (
                <Check size={12} className="text-verify" aria-label="verified" />
              ) : result === "not_met" && !current ? (
                <X size={12} className="text-ember" aria-label="not met" />
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

/** What someone typed into the evidence box: a link, a metric written `name = value`, or a note. */
function parseEvidence(raw: string): Evidence | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\/\S+$/i.test(t)) {
    let label = t;
    try {
      label = new URL(t).host;
    } catch {}
    return { type: "link", label, url: t };
  }
  const m = /^(.{1,40}?)\s=\s(.{1,60})$/.exec(t);
  return m ? { type: "metric", name: m[1], value: m[2] } : { type: "note", text: t };
}

function EvidenceChip({ e, onRemove }: { e: Evidence; onRemove?: () => void }) {
  const body =
    e.type === "capture" ? (
      <MediaChip id={e.mediaId} t={null} />
    ) : e.type === "link" ? (
      <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-ink">
        {e.label}
      </a>
    ) : e.type === "metric" ? (
      <span className="font-mono text-[11.5px]">
        {e.name} = {e.value}
      </span>
    ) : (
      <span>{e.text}</span>
    );
  return (
    <span className="inline-flex max-w-full items-center gap-1 text-[12.5px] text-ink-muted">
      {body}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove evidence" className="text-ink-dim hover:text-ink">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

const VERDICT_LABEL: Record<Verdict, string> = { verified: "Verified", failed: "Failed", cant: "Can\u2019t verify" };
const FIT_DOT = { supports: C.verify, unclear: C.nox, contradicts: C.ember } as const;

/** The lit checklist for the seat whose turn it is. Only that seat checks; everyone else watches. */
export function VerifyPanel({ m, file, mine, onChanged }: { m: Mission; file: SpecFile; mine: boolean; onChanged: () => void }) {
  const toast = useToast();
  const role = ROLE_BY_ID[file.role];
  const [items, setItems] = useState<VerificationItem[]>(file.verification?.items ?? []);
  const [saving, setSaving] = useState(false);
  const [flagging, setFlagging] = useState<"back" | "blocked" | null>(null);
  const [note, setNote] = useState("");
  const [backTo, setBackTo] = useState<RoleId>("developer");
  const [remember, setRemember] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [showing, setShowing] = useState<"closed" | "open" | "comparing">("closed");
  const hints = file.verification?.hints ?? [];
  const checks = file.verification?.checks ?? [];
  const auto = file.verification?.auto ?? [];
  const after = file.verification?.evidence?.after?.at(-1);
  useEffect(() => {
    if (hints.length) setShowing("closed");
  }, [hints.length]);
  useEffect(() => setItems(file.verification?.items ?? []), [file.verification]);

  const lit = m.stage === "verifying" && m.verifyRole === file.role;
  const result = file.verification?.result;
  const blocked = file.verification?.blocked;
  if (!lit && !result) return null;

  const persist = async (next: VerificationItem[]) => {
    setItems(next);
    setSaving(true);
    try {
      await api(`/api/v1/missions/${m.key}/files/${file.role}/verification`, {
        method: "PUT",
        json: { items: next.map((i) => ({ checked: i.verdict === "verified", verdict: i.verdict ?? null, note: i.note ?? null, evidence: i.evidence ?? [] })) },
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't save that", "error");
      onChanged();
    } finally {
      setSaving(false);
    }
  };
  const patch = (i: number, change: Partial<VerificationItem>) => {
    const next = items.map((x, j) => (j === i ? { ...x, ...change, recheck: change.verdict !== undefined ? false : x.recheck } : x));
    void persist(next.map((x) => ({ ...x, checked: x.verdict === "verified" })));
  };

  const send = async (v: "verified" | "not_met" | "blocked") => {
    try {
      await api(`/api/v1/missions/${m.key}/files/${file.role}/verify`, { method: "POST", json: v === "verified" ? { verdict: v } : v === "blocked" ? { verdict: v, note } : { verdict: v, note, backTo, remember } });
      toast(
        v === "verified" ? (file.role === "business" ? "Verified: mission done" : "Verified: passed to the next seat") : v === "blocked" ? "Reported as blocked" : `Sent back to the ${ROLE_BY_ID[backTo].name}`,
        "success",
      );
      setFlagging(null);
      setNote("");
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't record that", "error");
    }
  };

  const all = items.length > 0 && items.every((i) => i.verdict === "verified");
  const anyFailed = items.some((i) => i.verdict === "failed");
  const anyCant = items.some((i) => i.verdict === "cant");
  const anyEvidence = items.some((i) => i.evidence?.length);
  const editable = lit && mine;
  const done = items.filter((i) => i.verdict === "verified").length;

  const compare = async (mediaId: string) => {
    setShowing("comparing");
    try {
      await api(`/api/v1/missions/${m.key}/files/${file.role}/verify-evidence`, { method: "POST", json: { mediaIds: [mediaId] } });
      toast("NoX is comparing it with the original recording", "info");
    } catch (e) {
      setShowing("open");
      toast(e instanceof ApiError ? e.detail : "Couldn't compare the recordings", "error");
    }
  };

  const checkEvidence = async () => {
    try {
      await api(`/api/v1/missions/${m.key}/files/${file.role}/verification/evidence-check`, { method: "POST" });
      toast("NoX is looking at your evidence", "info");
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't check the evidence", "error");
    }
  };

  return (
    <section
      className="mb-5 rounded-md border p-4 sm:p-5"
      style={{ borderColor: lit ? role.ink : "rgb(var(--line)/.18)", background: lit ? "color-mix(in srgb, var(--role) 5%, transparent)" : "transparent", boxShadow: lit ? `0 0 0 1px ${tint(role.ink, 13)}, 0 0 28px ${tint(role.hue, 12)}` : undefined }}
      aria-label="Verification checklist"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-ink">Verification checklist</h2>
        <span className="font-mono text-[11px] text-ink-dim">
          {lit
            ? blocked
              ? `Blocked: ${blocked.note}`
              : editable
                ? `Your turn · ${done}/${items.length}${saving ? " · saving…" : ""}`
                : `Waiting on the ${role.name}`
            : result === "verified"
              ? `Verified by ${file.verification?.verifiedBy ?? "?"}`
              : `Not met: ${file.verification?.note ?? ""}`}
        </span>
      </div>
      {auto.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-faint">
          <span className="text-ink-dim">NoX attached</span>
          {auto.map((a) => (
            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-ink">
              {a.label}
            </a>
          ))}
        </p>
      )}
      {!items.length && <p className="mt-3 text-[13px] text-ink-faint">This file has no checklist items. {editable ? "Mark it verified if the work matches it." : ""}</p>}
      <ul className="mt-3 space-y-2">
        {items.map((it, i) => {
          const evidence = it.evidence ?? [];
          const isOpen = editable && open === i;
          const fit = checks.find((c) => c.index === i);
          return (
            <li key={i} className="rounded-sm border border-hairline bg-[rgb(var(--deck-rgb)/.5)] px-3 py-2" style={it.verdict === "failed" ? { borderColor: "rgba(233,113,60,.5)" } : undefined}>
              <div className="flex items-start gap-2.5 text-[13.5px]">
                <input
                  type="checkbox"
                  checked={it.verdict === "verified"}
                  disabled={!editable}
                  aria-label={`Verified: ${it.text}`}
                  onChange={() => patch(i, { verdict: it.verdict === "verified" ? null : "verified" })}
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{ accentColor: role.ink }}
                />
                <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${it.verdict === "verified" ? "text-ink" : "text-ink-muted"}`}>
                  <ItemText text={it.text} />
                  {it.verdict && it.verdict !== "verified" && (
                    <span className="ml-2 font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: it.verdict === "failed" ? C.coralInk : C.noxInk }}>
                      {VERDICT_LABEL[it.verdict]}
                    </span>
                  )}
                  {it.recheck && !it.verdict && <span className="ml-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-dim">Re-check</span>}
                </span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    aria-label={`Details for: ${it.text}`}
                    className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] text-ink-dim hover:text-ink"
                  >
                    <Paperclip size={13} />
                    {evidence.length > 0 && <span className="font-mono">{evidence.length}</span>}
                  </button>
                )}
              </div>

              {!isOpen && (evidence.length > 0 || it.note) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
                  {evidence.map((e, k) => (
                    <EvidenceChip key={k} e={e} />
                  ))}
                  {it.note && <span className="text-[12.5px] text-ink-faint">{it.note}</span>}
                </div>
              )}

              {isOpen && (
                <div className="mt-2 space-y-2 pl-6">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Verdict">
                    {(["verified", "failed", "cant"] as Verdict[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={it.verdict === v}
                        onClick={() => patch(i, { verdict: it.verdict === v ? null : v })}
                        className="h-7 rounded-full border px-2.5 text-[12px]"
                        style={it.verdict === v ? { borderColor: role.ink, color: role.ink } : { borderColor: "rgb(var(--line)/.2)", color: "var(--ink-muted)" }}
                      >
                        {VERDICT_LABEL[v]}
                      </button>
                    ))}
                  </div>
                  {evidence.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {evidence.map((e, k) => (
                        <EvidenceChip key={k} e={e} onRemove={() => patch(i, { evidence: evidence.filter((_, n) => n !== k) })} />
                      ))}
                    </div>
                  )}
                  {evidence.length < 5 && (
                    <input
                      placeholder="Add evidence: a link, a metric (name = value) or a note"
                      aria-label={`Evidence for: ${it.text}`}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        const ev = parseEvidence(e.currentTarget.value);
                        if (!ev) return;
                        e.currentTarget.value = "";
                        patch(i, { evidence: [...evidence, ev] });
                      }}
                      className="h-8 w-full rounded-sm border border-hairline bg-transparent px-2 text-[12.5px] text-ink outline-none focus:border-[color:var(--role)]"
                    />
                  )}
                  <input
                    defaultValue={it.note ?? ""}
                    placeholder={it.verdict === "failed" || it.verdict === "cant" ? "Why? (required to send it back)" : "Note (optional)"}
                    aria-label={`Note for: ${it.text}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== (it.note ?? null)) patch(i, { note: v });
                    }}
                    className="h-8 w-full rounded-sm border border-hairline bg-transparent px-2 text-[12.5px] text-ink-muted outline-none focus:border-[color:var(--role)]"
                  />
                  {evidence.length < 5 &&
                    (capturing ? (
                      <CaptureBar
                        compact
                        missionKey={m.key}
                        role={file.role}
                        onMedia={(c) => {
                          setCapturing(false);
                          patch(i, { evidence: [...evidence, { type: "capture", mediaId: c.id }] });
                        }}
                      />
                    ) : (
                      <button type="button" onClick={() => setCapturing(true)} className="flex items-center gap-1.5 text-[12px] text-ink-dim hover:text-ink">
                        <MonitorPlay size={12} /> Show it
                      </button>
                    ))}
                </div>
              )}

              {fit && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-[12.5px] text-ink-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: FIT_DOT[fit.fit] }} aria-hidden />
                  <span className="text-ink-dim">NoX: {fit.fit}</span> {fit.why}
                </p>
              )}
              {hints
                .filter((h) => h.index === i)
                .map((h) => (
                  <p key={h.index} className="mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-[12.5px] text-ink-muted">
                    <Sparkles size={11} className="text-[color:var(--violet-ink)]" aria-hidden />
                    <span className="text-ink-dim">NoX saw:</span> {h.hint}
                    {after && h.t != null && (
                      <button type="button" onClick={() => seekMedia(after, h.t!)} className="font-mono text-[11px] text-[color:var(--role)]">
                        ▶ {fmtT(h.t)}
                      </button>
                    )}
                  </p>
                ))}
            </li>
          );
        })}
      </ul>
      {editable && showing !== "closed" && (
        <div className="mt-4 rounded-sm border border-hairline p-3">
          {showing === "comparing" ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted" role="status">
              <Sparkles size={13} className="animate-pulse text-[color:var(--violet-ink)]" /> NoX is comparing your recording with the original…
            </p>
          ) : (
            <>
              <p className="mb-2 text-[12.5px] text-ink-faint">Record the change working. NoX compares it with the mission&rsquo;s original capture and notes what it sees beside each item. You still decide every item.</p>
              <CaptureBar compact missionKey={m.key} role={file.role} onMedia={(c) => void compare(c.id)} />
            </>
          )}
        </div>
      )}
      {editable && !flagging && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto flex gap-1.5">
            {showing === "closed" && (
              <button type="button" onClick={() => setShowing("open")} className="flex h-9 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[13px] text-ink-muted hover:text-ink">
                <MonitorPlay size={14} /> Show it works
              </button>
            )}
            {anyEvidence && (
              <button type="button" onClick={() => void checkEvidence()} className="flex h-9 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[13px] text-ink-muted hover:text-ink">
                <Sparkles size={13} /> Check evidence
              </button>
            )}
          </span>
          {anyCant && !anyFailed && (
            <button type="button" onClick={() => setFlagging("blocked")} className="h-9 rounded-sm border border-[rgb(var(--nox-rgb)/.45)] px-4 text-[13px] text-nox hover:bg-[rgb(var(--nox-rgb)/.08)]">
              Blocked
            </button>
          )}
          <button type="button" onClick={() => setFlagging("back")} className="h-9 rounded-sm border border-[rgba(233,113,60,.45)] px-4 text-[13px] text-[color:var(--coral-ink)] hover:bg-[rgba(233,113,60,.08)]">
            Send back
          </button>
          <LiquidMetalButton hue={role.hue} disabled={!all && items.length > 0} onClick={() => void send("verified")} className="h-9 rounded-sm px-4 text-[13px] font-semibold disabled:opacity-40" title={all || !items.length ? undefined : "Verify every item first"}>
            Verified
          </LiquidMetalButton>
        </div>
      )}
      {editable && flagging && (
        <div className="mt-4 space-y-2 rounded-sm border border-[rgba(233,113,60,.35)] p-3">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus placeholder={flagging === "blocked" ? "What are you waiting for?" : "What isn't met?"} aria-label={flagging === "blocked" ? "What are you waiting for" : "What isn't met"} className="w-full rounded-sm border border-hairline bg-void p-2 text-[13px] text-ink" />
          <VoiceInput value={note} onChange={setNote} label="Or say it" className="w-full justify-end" />
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            {flagging === "back" && (
              <>
                <span className="text-ink-muted">Who fixes it?</span>
                <select value={backTo} onChange={(e) => setBackTo(e.target.value as RoleId)} aria-label="Send back to" className="h-9 rounded-sm border border-hairline bg-void px-2 text-ink">
                  <option value="developer">Developer: the build needs another pass</option>
                  {(["business", "product", "engineering"] as RoleId[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_BY_ID[r].name}: the requirement itself is off
                    </option>
                  ))}
                </select>
              </>
            )}
            <span className="flex-1" />
            {flagging === "back" && (
              <div className="w-full">
                <RememberToggle checked={remember} onChange={setRemember} />
              </div>
            )}
            <button type="button" onClick={() => setFlagging(null)} className="h-9 px-2 text-ink-dim">
              Cancel
            </button>
            <button type="button" disabled={note.trim().length < 3} onClick={() => void send(flagging === "blocked" ? "blocked" : "not_met")} className="h-9 rounded-sm bg-ember px-4 font-semibold text-abyss disabled:opacity-40">
              {flagging === "blocked" ? "Report blocked" : "Send back"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
