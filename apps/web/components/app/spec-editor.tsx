"use client";

import {
  Bold,
  CheckSquare,
  Code,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquare,
  Paperclip,
  Send,
  Sparkles,
  Table,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, API_URL, ApiError, authHeaders } from "@/lib/app/api";
import { subscribe } from "@/lib/app/stream";
import type { MediaCapture } from "@/lib/app/types";

import { KbMarkdown } from "./markdown";
import { CaptureBar, CaptureChip } from "./media/capture-bar";
import { useToast } from "./ui";

type Op = { op: "replace" | "insert" | "delete"; from: number; to: number; lines: string[] };
type NoxEdit = { role: string; fromVersion: number; toVersion: number; ops: Op[]; markdown: string; reason: string; edits?: string[] };
/** One of NoX's section edits while its turn is still running (not saved yet). */
type NoxPartial = { role: string; step: number; fromVersion: number; ops: Op[]; markdown: string; what: string };

/** Line indices (in the new file) that an edit inserted or rewrote. */
function addedLines(ops: Op[]): Set<number> {
  const added = new Set<number>();
  let shift = 0;
  for (const op of ops) {
    const start = op.from + shift;
    op.lines.forEach((_, i) => added.add(start + i));
    shift += op.lines.length - (op.to - op.from);
  }
  return added;
}

/** Line indices in `after` that aren't in `before` (a line LCS), for tinting everything NoX has changed so far
 *  in a turn that is still running, across several section edits. */
function changedLines(before: string, after: string): Set<number> {
  const a = before.split("\n");
  const b = after.split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const out = new Set<number>();
  const n = ea - s;
  const m = eb - s;
  if (n * m > 4_000_000) {
    for (let j = s; j < eb; j++) out.add(j);
    return out;
  }
  // lcs[i][j] = LCS length of a[s+i..ea) and b[s+j..eb), flattened.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * (m + 1) + j] = a[s + i] === b[s + j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && a[s + i] === b[s + j]) {
      i++;
      j++;
    } else if (i < n && lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1]) i++;
    else out.add(s + j++);
  }
  return out;
}

/** 'added “Rollback”' → 'Rollback': the section an edit touched, for the jump links. */
function editedHeading(what: string): string | null {
  return what.match(/“(.+)”/)?.[1] ?? null;
}

const normHeading = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type ChatMsg = { id: string; author: "user" | "nox"; body: string; mediaIds?: string[]; createdAt: string };

const REFINE_KEY = "nox.refineOnSave";

export function SpecEditor({
  missionKey,
  role,
  markdown,
  version,
  onSaved,
}: {
  missionKey: string;
  role: string;
  markdown: string;
  version: number;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(markdown);
  const [base, setBase] = useState({ markdown, version });
  const [saving, setSaving] = useState(false);
  const [refineOnSave, setRefineOnSave] = useState(true);
  const [noxBusy, setNoxBusy] = useState<string | null>(null);
  const [noxMode, setNoxMode] = useState<"chat" | "refine" | null>(null);
  const [typing, setTyping] = useState<{ shown: string[]; cursorLine: number; added: Set<number> } | null>(null);
  const [lastEdit, setLastEdit] = useState<{ fromVersion: number; added: Set<number>; edits: string[] } | null>(null);
  // While NoX's turn runs: everything it has changed so far, against the file as the turn found it.
  const [liveAdded, setLiveAdded] = useState<Set<number> | null>(null);
  const turnStart = useRef<{ markdown: string; version: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [pendingEdit, setPendingEdit] = useState<NoxEdit | null>(null);
  const [view, setView] = useState<"write" | "preview">("write");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== base.markdown;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // The base as NoX's queued edits see it: updated synchronously, so back-to-back edits never read a stale render.
  const baseRef = useRef(base);
  baseRef.current = base;
  const adoptBase = (next: { markdown: string; version: number }) => {
    baseRef.current = next;
    setBase(next);
    setText(next.markdown);
  };
  // NoX's edits animate one after another, in the order they arrive.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (fn: () => Promise<void> | void) => {
    queue.current = queue.current.then(fn).catch(() => undefined);
  };
  const liveStep = useRef(0);

  useEffect(() => {
    try {
      setRefineOnSave(window.localStorage.getItem(REFINE_KEY) !== "false");
    } catch {
      /* default on */
    }
  }, []);

  // Server copy moved on (someone saved, NoX edited, a reload): adopt it when we have nothing unsaved.
  useEffect(() => {
    if (version !== base.version && !dirtyRef.current && !typing) {
      setBase({ markdown, version });
      setText(markdown);
    }
  }, [markdown, version, base.version, typing]);

  const animate = useCallback(
    async (edit: NoxEdit, { ms = 5000, final = true }: { ms?: number; final?: boolean } = {}) => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const added = addedLines(edit.ops);
      const base = baseRef.current;
      if (!reduce && base.version === edit.fromVersion) {
        // A fixed frame budget whatever the edit's size: each frame reveals a proportional
        // share of the inserted text, so long edits type faster rather than taking longer.
        const oldLines = base.markdown.replace(/\n$/, "").split("\n");
        const total = edit.ops.reduce((n, o) => n + o.lines.join("\n").length, 0);
        const frames = Math.max(1, Math.min(Math.round(ms / 55), total));
        const delay = Math.max(8, ms / frames - 20);
        for (let frame = 1; frame <= frames; frame++) {
          let budget = Math.round((total * frame) / frames);
          const lines = [...oldLines];
          let offset = 0;
          let cursorLine = 0;
          for (const op of edit.ops) {
            const at = op.from + offset;
            const shown: string[] = [];
            for (const full of op.lines) {
              if (budget <= 0) break;
              shown.push(full.slice(0, budget));
              budget -= full.length + 1;
            }
            lines.splice(at, op.to - op.from, ...shown);
            if (shown.length) cursorLine = at + shown.length - 1;
            offset += shown.length - (op.to - op.from);
            if (budget <= 0) break;
          }
          setTyping({ shown: lines, cursorLine, added });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      setTyping(null);
      adoptBase({ markdown: edit.markdown, version: edit.toVersion });
      if (final) finishTurn(edit);
      else if (turnStart.current) setLiveAdded(changedLines(turnStart.current.markdown, edit.markdown));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the live base through baseRef
    [],
  );

  /** NoX's turn saved: tint what it changed until the author keeps or undoes it. */
  const finishTurn = (edit: NoxEdit) => {
    turnStart.current = null;
    setLiveAdded(null);
    setLastEdit({ fromVersion: edit.fromVersion, added: addedLines(edit.ops), edits: edit.edits ?? [] });
    setView("preview"); // below lg the preview is the only place the tint shows
  };

  const animateRef = useRef(animate);
  animateRef.current = animate;
  useEffect(
    () =>
      subscribe(`/api/v1/missions/${missionKey}/stream`, ({ event, data }) => {
        const p = ((data as { payload?: Record<string, unknown> })?.payload ?? {}) as Record<string, unknown>;
        if (p.role !== role) return;
        if (event === "nox.thinking") {
          liveStep.current = 0;
          turnStart.current = dirtyRef.current ? null : { ...baseRef.current };
          setLastEdit(null);
          setNoxMode(p.reason === "chat" ? "chat" : "refine");
          setNoxBusy(p.reason === "chat" ? "NoX is reading your message…" : "NoX is refining your spec…");
        }
        if (event === "nox.step") setNoxBusy(`${String(p.label)}…`);
        if (event === "nox.done" || event === "nox.error") {
          setNoxBusy(null);
          setNoxMode(null);
          // Nothing was saved: take back the section edits shown live, so the editor matches the saved file.
          const start = turnStart.current;
          turnStart.current = null;
          enqueue(() => {
            setLiveAdded(null);
            if (start && !dirtyRef.current && baseRef.current.markdown !== start.markdown) adoptBase(start);
          });
          if (event === "nox.done")
            toast(p.discarded ? "NoX's edit wasn't saved — it would have removed a section" : "NoX had nothing to add", p.discarded ? "error" : "info");
          if (event === "nox.error") toast("NoX couldn't reach the model — try again", "error");
        }
        if (event === "chat.message" && p.author === "nox") {
          setNoxBusy(null);
          setNoxMode(null);
        }
        if (event === "nox.edit.partial") {
          // Show each section edit as it lands. Unsaved typing wins: the final edit then waits as a pending one.
          const part = p as unknown as NoxPartial;
          if (dirtyRef.current) return;
          const inOrder = part.step === liveStep.current + 1 && baseRef.current.version === part.fromVersion;
          liveStep.current = part.step;
          enqueue(() =>
            inOrder
              ? animateRef.current({ ...part, toVersion: part.fromVersion, reason: part.what }, { ms: 1600, final: false })
              : adoptBase({ markdown: part.markdown, version: baseRef.current.version }),
          );
        }
        if (event === "nox.edit") {
          setNoxBusy(null);
          setNoxMode(null);
          const edit = p as unknown as NoxEdit;
          if (dirtyRef.current) {
            setPendingEdit(edit);
            return;
          }
          enqueue(() => {
            if (baseRef.current.markdown === edit.markdown) {
              // Already on screen from the live edits: just adopt the saved version and offer undo.
              adoptBase({ markdown: edit.markdown, version: edit.toVersion });
              finishTurn(edit);
            } else return animateRef.current(edit);
          });
        }
      }),
    [missionKey, role, toast],
  );

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const f = await api<{ version: number; markdown: string }>(`/api/v1/missions/${missionKey}/files/${role}`, {
        method: "PUT",
        json: { markdown: text, baseVersion: base.version },
      });
      setBase({ markdown: f.markdown, version: f.version });
      setLastEdit(null);
      onSaved();
      if (refineOnSave) {
        await api(`/api/v1/missions/${missionKey}/files/${role}/refine`, { method: "POST", json: {} });
        setNoxBusy("NoX is refining your spec…");
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't save", "error");
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, missionKey, role, text, base.version, refineOnSave, onSaved, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const undoNox = async () => {
    if (!lastEdit) return;
    try {
      const f = await api<{ version: number; markdown: string }>(`/api/v1/missions/${missionKey}/files/${role}/revert`, {
        method: "POST",
        json: { toVersion: lastEdit.fromVersion },
      });
      setBase({ markdown: f.markdown, version: f.version });
      setText(f.markdown);
      setLastEdit(null);
      onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't undo", "error");
    }
  };

  // ── Toolbar helpers ───────────────────────────────────────────────────────
  const surround = (before: string, after = before, placeholder = "text") => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = text.slice(s, e) || placeholder;
    const next = text.slice(0, s) + before + sel + after + text.slice(e);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };
  const linePrefix = (prefix: string | ((i: number) => string)) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = text.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    const eIdx = text.indexOf("\n", ta.selectionEnd);
    const e = eIdx === -1 ? text.length : eIdx;
    const block = text.slice(s, e).split("\n").map((l, i) => (typeof prefix === "function" ? prefix(i) : prefix) + l).join("\n");
    setText(text.slice(0, s) + block + text.slice(e));
    requestAnimationFrame(() => ta.focus());
  };
  const insertBlock = (snippet: string) => {
    const ta = taRef.current;
    const at = ta ? ta.selectionEnd : text.length;
    const pre = text.slice(0, at);
    const glue = pre.endsWith("\n\n") || pre === "" ? "" : pre.endsWith("\n") ? "\n" : "\n\n";
    setText(pre + glue + snippet + "\n" + text.slice(at));
    requestAnimationFrame(() => ta?.focus());
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [mediaMenu, setMediaMenu] = useState<"closed" | "menu" | "capture">("closed");
  const uploadImage = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API_URL}/api/v1/missions/${missionKey}/assets`, { method: "POST", headers: await authHeaders(), body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? "Upload failed");
      insertBlock(body.markdown);
    } catch (e) {
      toast(String((e as Error).message || e), "error");
    }
  };

  const tools = [
    { icon: Heading2, label: "Heading", run: () => linePrefix("## ") },
    { icon: Heading3, label: "Subheading", run: () => linePrefix("### ") },
    { icon: Bold, label: "Bold", run: () => surround("**") },
    { icon: Italic, label: "Italic", run: () => surround("_") },
    { icon: List, label: "Bullet list", run: () => linePrefix("- ") },
    { icon: ListOrdered, label: "Numbered list", run: () => linePrefix((i) => `${i + 1}. `) },
    { icon: CheckSquare, label: "Checklist", run: () => linePrefix("- [ ] ") },
    { icon: Table, label: "Table", run: () => insertBlock("| Column | Column |\n| --- | --- |\n|  |  |") },
    { icon: Code, label: "Code block", run: () => insertBlock("```\ncode\n```") },
    { icon: Link2, label: "Link", run: () => surround("[", "](https://)", "link text") },
    { icon: ImagePlus, label: "Image or capture", run: () => setMediaMenu((m) => (m === "closed" ? "menu" : "closed")) },
  ];

  const previewText = typing ? typing.shown.join("\n") : text;
  const highlight = typing?.added ?? liveAdded ?? lastEdit?.added ?? null;
  const jumpTo = (heading: string) => {
    const box = previewRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-heading="${CSS.escape(normHeading(heading))}"]`);
    if (box && el) box.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1 rounded-t-md border border-b-0 border-hairline bg-deck px-2 py-1.5">
        {tools.map((t) => (
          <button key={t.label} type="button" onClick={t.run} title={t.label} aria-label={t.label} disabled={!!typing} className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted hover:bg-[rgba(143,160,204,.1)] hover:text-ink disabled:opacity-40">
            <t.icon size={15} strokeWidth={1.7} />
          </button>
        ))}
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void uploadImage(e.target.files[0])} />
        <span className="ml-auto flex items-center gap-3 pr-1">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-muted">
            <input
              type="checkbox"
              checked={refineOnSave}
              onChange={(e) => {
                setRefineOnSave(e.target.checked);
                try {
                  window.localStorage.setItem(REFINE_KEY, String(e.target.checked));
                } catch {
                  /* ignore */
                }
              }}
            />
            NoX refines on save
          </label>
          <span className="flex rounded-sm border border-hairline lg:hidden">
            {(["write", "preview"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`px-2 py-1 text-[12px] capitalize ${view === v ? "text-ink" : "text-ink-dim"}`}>
                {v}
              </button>
            ))}
          </span>
        </span>
      </div>

      {mediaMenu !== "closed" && (
        <div className="flex flex-wrap items-start gap-3 border border-b-0 border-hairline bg-deck px-3 py-2.5 text-[13px]">
          {mediaMenu === "menu" ? (
            <>
              <button type="button" onClick={() => { setMediaMenu("closed"); fileRef.current?.click(); }} className="h-8 rounded-sm border border-hairline px-3 text-ink-muted hover:text-ink">
                Insert an image into the file
              </button>
              <button type="button" onClick={() => setMediaMenu("capture")} className="h-8 rounded-sm border border-hairline px-3 text-ink-muted hover:text-ink">
                Show NoX a recording, screenshot or voice note
              </button>
            </>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-[12.5px] text-ink-faint">NoX watches it and adds it to the mission&rsquo;s evidence; a ▶ chip goes into the file where your cursor is.</p>
              <CaptureBar
                compact
                missionKey={missionKey}
                role={role}
                onMedia={(c) => {
                  setMediaMenu("closed");
                  insertBlock(`[[media:${c.id}${c.kind === "image" || c.kind === "screenshot" ? "" : "#t=0"}]]`);
                }}
              />
            </div>
          )}
          <button type="button" onClick={() => setMediaMenu("closed")} aria-label="Close" className="ml-auto text-ink-dim hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      {(noxBusy || typing) && (
        <div className="flex items-center gap-2 border border-b-0 border-hairline bg-[rgba(168,151,240,.08)] px-3 py-2 text-[13px] text-ink" role="status">
          <Sparkles size={14} className="text-[#A897F0]" /> {typing ? "NoX is writing…" : noxBusy}
        </div>
      )}
      {pendingEdit && (
        <div className="flex flex-wrap items-center gap-3 border border-b-0 border-hairline bg-[rgba(247,181,66,.07)] px-3 py-2 text-[13px] text-ink">
          NoX finished an edit while you were typing.
          <button type="button" className="underline" onClick={() => { setText(base.markdown); const e = pendingEdit; setPendingEdit(null); void animate(e); }}>
            Show NoX&rsquo;s version (discards your unsaved changes)
          </button>
          <button type="button" className="text-ink-dim underline" onClick={() => setPendingEdit(null)}>
            Keep mine
          </button>
        </div>
      )}
      {lastEdit && !typing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-b-0 border-hairline bg-[rgba(168,151,240,.1)] px-3 py-2 text-[13px] text-ink-muted">
          <Sparkles size={13} className="text-[#A897F0]" />
          <span className="text-ink">Review NoX&rsquo;s changes — they&rsquo;re tinted in the preview.</span>
          {lastEdit.edits.map((what, i) => {
            const heading = editedHeading(what);
            return heading ? (
              <button key={i} type="button" onClick={() => jumpTo(heading)} className="rounded-sm border border-[rgba(168,151,240,.4)] px-2 py-0.5 text-[12px] text-ink hover:border-[#A897F0]">
                {what.charAt(0).toUpperCase() + what.slice(1)}
              </button>
            ) : (
              <span key={i} className="text-[12px]">{what}</span>
            );
          })}
          <button type="button" onClick={() => setLastEdit(null)} className="text-ink underline">
            Keep
          </button>
          <button type="button" onClick={() => void undoNox()} className="inline-flex items-center gap-1 text-ink underline">
            <Undo2 size={12} /> Undo NoX&rsquo;s edit
          </button>
        </div>
      )}

      <div className="grid rounded-b-md border border-hairline lg:grid-cols-2">
        <textarea
          ref={taRef}
          value={typing ? typing.shown.join("\n") : text}
          readOnly={!!typing}
          onChange={(e) => setText(e.target.value)}
          aria-label="Spec file (Markdown)"
          spellCheck
          className={`${view === "preview" ? "hidden lg:block" : ""} min-h-[62vh] w-full resize-y border-hairline bg-deck p-4 font-mono text-[13px] leading-relaxed text-ink outline-none lg:border-r`}
        />
        <div ref={previewRef} className={`${view === "write" ? "hidden lg:block" : ""} relative max-h-[80vh] min-h-[62vh] overflow-y-auto bg-[rgba(9,11,19,.66)] p-6`}>
          <PreviewBlocks markdown={previewText} highlight={highlight} cursorLine={typing?.cursorLine ?? null} scrollRef={previewRef} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-3">
        {dirty && <span className="text-[12px] text-ink-faint">Unsaved changes · ⌘S</span>}
        <button
          type="button"
          disabled={!!typing || !!noxBusy || saving || (!dirty && !refineOnSave)}
          onClick={() =>
            dirty
              ? void save()
              : void api(`/api/v1/missions/${missionKey}/files/${role}/refine`, { method: "POST", json: {} }).then(() => setNoxBusy("NoX is refining your spec…"))
          }
          className="h-9 rounded-sm border border-hairline px-4 text-[13px] text-ink hover:border-ink-faint disabled:opacity-40"
        >
          {saving ? "Saving…" : dirty ? "Save" : "Ask NoX to refine"}
        </button>
      </div>

      <ChatDock missionKey={missionKey} role={role} busy={noxMode === "chat"} status={noxMode === "chat" ? noxBusy : null} />
    </div>
  );
}

/** Markdown split into blank-line blocks, so blocks NoX wrote can be tinted and the typing cursor placed. */
function PreviewBlocks({
  markdown,
  highlight,
  cursorLine,
  scrollRef,
}: {
  markdown: string;
  highlight: Set<number> | null;
  cursorLine: number | null;
  /** The scrolling preview pane: kept on NoX's cursor while it types, and brought to its first change after. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const blocks = useMemo(() => {
    const lines = markdown.split("\n");
    const out: { start: number; end: number; text: string }[] = [];
    let start = 0;
    let inFence = false;
    for (let i = 0; i <= lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && line.trimStart().startsWith("```")) inFence = !inFence;
      if (i === lines.length || (!inFence && line.trim() === "" )) {
        if (i > start) out.push({ start, end: i, text: lines.slice(start, i).join("\n") });
        start = i + 1;
      }
    }
    return out;
  }, [markdown]);
  const touched = (b: { start: number; end: number }) => !!highlight && [...Array(b.end - b.start).keys()].some((k) => highlight.has(b.start + k));

  // Bring the change into view: NoX's cursor while it types, otherwise the first tinted block once an edit lands.
  const firstTouched = blocks.findIndex(touched);
  const target = cursorLine !== null ? blocks.findIndex((b) => cursorLine >= b.start && cursorLine < b.end) : firstTouched;
  const follow = cursorLine !== null;
  useEffect(() => {
    const box = scrollRef.current;
    const el = target >= 0 ? box?.querySelector<HTMLElement>(`[data-block="${target}"]`) : null;
    if (!box || !el) return;
    const top = el.offsetTop;
    const visible = top >= box.scrollTop && top + el.offsetHeight <= box.scrollTop + box.clientHeight;
    if (!visible) box.scrollTo({ top: Math.max(0, top - (follow ? box.clientHeight / 3 : 16)), behavior: follow ? "auto" : "smooth" });
    // Only when the target block changes, not on every keystroke of typing inside it.
  }, [target, follow, scrollRef]);

  return (
    <div>
      {blocks.map((b, bi) => {
        const isTouched = touched(b);
        const hasCursor = cursorLine !== null && cursorLine >= b.start && cursorLine < b.end;
        const heading = b.text.match(/^##\s+(.+?)\s*#*$/m)?.[1];
        // A tinted '## ' heading line is one NoX added, so the whole section is new.
        const newSection = isTouched && !!highlight && /^##\s/.test(b.text) && highlight.has(b.start);
        return (
          <div
            key={`${b.start}-${b.text.slice(0, 12)}`}
            data-block={bi}
            data-heading={heading ? normHeading(heading) : undefined}
            className={`relative -mx-2 rounded-sm px-2 transition-colors duration-500 ${isTouched ? "bg-[rgba(168,151,240,.14)] shadow-[inset_3px_0_0_#A897F0]" : ""}`}
          >
            {newSection && (
              <span className="absolute right-2 top-2 rounded-sm bg-[rgba(168,151,240,.22)] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#CFC6FA]">
                New · NoX
              </span>
            )}
            <KbMarkdown content={b.text} />
            {hasCursor && (
              <span className="pointer-events-none absolute -bottom-1 right-2 inline-flex items-center gap-1 rounded-sm bg-[#A897F0] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-void shadow">
                <span className="h-3 w-[2px] animate-pulse bg-void" /> NoX
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChatDock({ missionKey, role, busy, status }: { missionKey: string; role: string; busy: boolean; status: string | null }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const [attached, setAttached] = useState<MediaCapture[]>([]);
  const listRef = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    try {
      setMsgs(await api<ChatMsg[]>(`/api/v1/missions/${missionKey}/files/${role}/chat`));
    } catch {
      /* ignore */
    }
  }, [missionKey, role]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  useEffect(
    () =>
      subscribe(`/api/v1/missions/${missionKey}/stream`, ({ event, data }) => {
        const p = (data as { payload?: { role?: string; text?: string; author?: string; questions?: number } })?.payload;
        if (p?.role !== role) return;
        if (event === "chat.delta") setStreaming((t) => t + (p.text ?? ""));
        if (event === "chat.message") {
          // NoX asks for decisions in the chat rather than the file, so open it when a refine comes back with questions.
          if (p.author === "nox" && p.questions) setOpen(true);
          void load().then(() => setStreaming(""));
        }
      }),
    [missionKey, role, load],
  );
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs, busy, streaming, status]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim() || (attached.length ? "Here's what I mean." : "");
    if (!body) return;
    const mediaIds = attached.map((c) => c.id);
    setText("");
    setAttached([]);
    setAttach(false);
    setMsgs((m) => [...m, { id: `tmp-${Date.now()}`, author: "user", body, mediaIds, createdAt: new Date().toISOString() }]);
    await api(`/api/v1/missions/${missionKey}/files/${role}/chat`, { method: "POST", json: { message: body, mediaIds } });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="fixed bottom-20 right-4 z-40 flex h-12 items-center gap-2 rounded-full border border-[rgba(168,151,240,.5)] bg-deck px-4 text-[13px] text-ink shadow-xl hover:border-[#A897F0] lg:bottom-6 lg:right-6">
        <MessageSquare size={16} className="text-[#A897F0]" /> Ask NoX
      </button>
    );
  }
  return (
    <section aria-label="Chat with NoX" className="fixed bottom-20 right-4 z-40 flex h-[min(520px,calc(100vh-7rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-hairline bg-deck shadow-2xl lg:bottom-6 lg:right-6">
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="flex items-center gap-2 text-[13px] text-ink">
          <Sparkles size={14} className="text-[#A897F0]" /> NoX · this file
        </span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="text-ink-dim hover:text-ink">
          <X size={15} />
        </button>
      </header>
      <ol ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {!msgs.length && <li className="text-[12.5px] text-ink-faint">Ask NoX to add a section, rewrite the acceptance criteria, or explain something from the knowledge base. Edits appear in the file as NoX types them.</li>}
        {msgs.map((m) => (
          <li key={m.id} className={`max-w-[88%] whitespace-pre-line rounded-md px-3 py-2 text-[13px] leading-snug ${m.author === "user" ? "ml-auto bg-[rgba(143,160,204,.12)] text-ink" : "bg-[rgba(168,151,240,.1)] text-ink"}`}>
            {m.body}
            {!!m.mediaIds?.length && <span className="mt-1 block font-mono text-[10.5px] text-ink-dim">+ {m.mediaIds.length} capture{m.mediaIds.length > 1 ? "s" : ""}</span>}
          </li>
        ))}
        {streaming ? (
          <li className="max-w-[88%] whitespace-pre-line rounded-md bg-[rgba(168,151,240,.1)] px-3 py-2 text-[13px] leading-snug text-ink">{streaming}</li>
        ) : (
          busy && <li className="animate-pulse text-[12.5px] text-ink-faint">{status ?? "NoX is thinking…"}</li>
        )}
      </ol>
      {(attach || attached.length > 0) && (
        <div className="max-h-[45%] space-y-2 overflow-y-auto border-t border-hairline p-2">
          {attached.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attached.map((c) => (
                <CaptureChip key={c.id} capture={c} onRemove={() => setAttached((xs) => xs.filter((x) => x.id !== c.id))} />
              ))}
            </div>
          )}
          {attach && attached.length < 4 && (
            <CaptureBar
              compact
              missionKey={missionKey}
              role={role}
              onMedia={(c) => {
                setAttached((xs) => [...xs, c]);
                setAttach(false);
              }}
            />
          )}
        </div>
      )}
      <form onSubmit={send} className="flex gap-2 border-t border-hairline p-2">
        <button type="button" onClick={() => setAttach((a) => !a)} aria-label="Attach a recording, screenshot or voice note" aria-expanded={attach} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-hairline text-ink-muted hover:text-ink">
          <Paperclip size={14} />
        </button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a rollback section…" aria-label="Message NoX" className="h-9 min-w-0 flex-1 rounded-sm border border-hairline bg-void px-3 text-[13px] text-ink outline-none focus:border-[#A897F0]" />
        <button type="submit" aria-label="Send" className="flex h-9 w-9 items-center justify-center rounded-sm bg-[#A897F0] text-void">
          <Send size={14} />
        </button>
      </form>
    </section>
  );
}
