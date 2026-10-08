"use client";

import { AlertTriangle, Check, FileCode2, RotateCcw, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { subscribe } from "@/lib/app/stream";
import { fmtT, type MediaCapture } from "@/lib/app/types";

import { MediaPlayer, type PlayerHandle } from "./media-player";
import { addedBy, KIND_ICON, useMissionMedia } from "./mission-media";

const LIKELY: Record<string, string> = {
  bug: "Looks like a bug",
  intended_behaviour: "Working as designed",
  missing_feature: "Not built yet",
  unclear: "Not settled yet",
};

/**
 * One capture and what NoX made of it: the player, live steps while NoX watches, then the summary, key moments
 * (click to seek), what NoX found in the knowledge base, code and contracts for the engineering and developer seats,
 * and open questions. On the new-mission page it also offers the suggested request and applications (never applied
 * on its own: the user accepts them).
 */
export const CaptureCard = forwardRef<PlayerHandle, {
  capture: MediaCapture;
  onChange?: (capture: MediaCapture) => void;
  onDeleted?: (id: string) => void;
  onUseRequest?: (sentence: string) => void;
}>(function CaptureCard({ capture: initial, onChange, onDeleted, onUseRequest }, ref) {
  const toast = useToast();
  const { me } = useAuth();
  const [c, setC] = useState(initial);
  const [steps, setSteps] = useState<string[]>([]);
  const player = useRef<PlayerHandle>(null);
  useImperativeHandle(ref, () => ({ seek: (t: number) => player.current?.seek(t) }));
  const working = c.status === "uploading" || c.status === "analyzing";
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const refresh = useCallback(async () => {
    try {
      const next = await api<MediaCapture>(`/api/v1/media/${c.id}`);
      setC(next);
      onChangeRef.current?.(next);
    } catch {
      /* deleted, or gone out of reach */
    }
  }, [c.id]);

  useEffect(() => setC(initial), [initial]);

  // Live steps while NoX watches; a slow poll covers a dropped stream.
  useEffect(() => {
    if (!working) return;
    const stop = subscribe(`/api/v1/media/${c.id}/stream`, ({ event, data }) => {
      const p = (data as { payload?: { label?: string } })?.payload ?? {};
      if (event === "media.step" && p.label) setSteps((s) => (s.at(-1) === p.label ? s : [...s.slice(-5), p.label!]));
      if (event === "media.ready" || event === "media.failed" || event === "media.withheld") void refresh();
    });
    const poll = setInterval(() => void refresh(), 4000);
    return () => {
      stop();
      clearInterval(poll);
    };
  }, [c.id, working, refresh]);

  const retry = async () => {
    try {
      setSteps([]);
      const next = await api<MediaCapture>(`/api/v1/media/${c.id}/complete`, { method: "POST" });
      setC(next);
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't retry", "error");
    }
  };
  const remove = async () => {
    if (!window.confirm("Delete this capture? NoX stops using it, and it's removed from the mission.")) return;
    try {
      await api(`/api/v1/media/${c.id}`, { method: "DELETE" });
      onDeleted?.(c.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't delete it", "error");
    }
  };

  const Icon = KIND_ICON[c.kind];
  const n = useMissionMedia().findIndex((x) => x.id === c.id); // its number on the spec files' chips (E1, E2…)
  const seek = (t: number) => player.current?.seek(t);
  const problems = new Set(c.problemTimes ?? []);

  return (
    <article className="rounded-md border border-hairline bg-[rgb(var(--deck-rgb)/.66)] p-4" aria-label={`Capture: ${c.label}`} data-media={c.id}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="flex min-w-0 items-center gap-2 text-ink">
          <Icon size={14} className="shrink-0 text-[color:var(--role)]" aria-hidden />
          {n >= 0 && <span className="font-mono text-[11px] text-[color:var(--role)]">E{n + 1}</span>}
          <span className="truncate">{c.label}</span>
          {c.uploadedBy && <span className="truncate text-ink-faint">· added by {addedBy(c)}</span>}
        </span>
        <span className="flex items-center gap-2">
          {c.status === "ready" && c.likely && <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">{LIKELY[c.likely]}</span>}
          {(c.mine || (c.specRole && c.specRole === me?.role)) && (
            <button type="button" onClick={() => void remove()} aria-label="Delete capture" className="text-ink-dim hover:text-ink">
              <Trash2 size={13} />
            </button>
          )}
        </span>
      </header>

      {c.status !== "withheld" && <MediaPlayer ref={player} capture={c} />}
      {c.caption && <p className="mt-2 text-[12.5px] italic text-ink-muted">&ldquo;{c.caption}&rdquo;</p>}

      {working && (
        <div className="mt-3 space-y-1 text-[12.5px]" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-ink">
            <Sparkles size={13} className="text-[color:var(--violet-ink)]" /> {c.status === "uploading" ? "Uploading…" : "NoX is watching…"}
          </p>
          <ol className="space-y-0.5 pl-5 text-ink-faint">
            {steps.map((s, i) => (
              <li key={`${i}-${s}`} className={i === steps.length - 1 ? "text-ink-muted" : ""}>
                {s.split(/(`[^`]+`)/g).map((part, j) => (part.startsWith("`") ? <code key={j} className="font-mono text-[11.5px]">{part.slice(1, -1)}</code> : part))}
              </li>
            ))}
          </ol>
        </div>
      )}

      {c.status === "failed" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[rgba(233,113,60,.35)] px-3 py-2 text-[12.5px] text-[color:var(--coral-ink)]">
          <span className="flex items-center gap-2">
            <AlertTriangle size={13} /> {c.statusReason ?? "NoX couldn't watch this capture."}
          </span>
          {c.mine && (
            <button type="button" onClick={() => void retry()} className="flex items-center gap-1 text-ink underline">
              <RotateCcw size={12} /> Retry
            </button>
          )}
        </div>
      )}
      {c.status === "withheld" && (
        <p className="mt-1 flex items-start gap-2 rounded-sm border border-[rgba(233,113,60,.35)] px-3 py-2 text-[12.5px] text-[color:var(--coral-ink)]">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" /> {c.statusReason ?? "NoX Shield withheld this capture."} Only you can see it, and NoX won&rsquo;t use it.
        </p>
      )}

      {c.status === "ready" && (
        <div className="mt-4 space-y-4 text-[13.5px] leading-relaxed">
          <p className="text-ink">{c.summary}</p>
          {!!c.moments?.length && (
            <section>
              <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">Key moments</h3>
              <ul className="space-y-1">
                {c.moments.map((m, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {c.kind === "image" || c.kind === "screenshot" ? (
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-dim" aria-hidden />
                    ) : (
                      <button type="button" onClick={() => seek(m.t)} className="shrink-0 rounded-sm border border-hairline px-1.5 font-mono text-[11.5px] text-[color:var(--role)] hover:border-[color:var(--role)]" aria-label={`Play from ${fmtT(m.t)}`}>
                        {fmtT(m.t)}
                      </button>
                    )}
                    <span className={problems.has(m.t) ? "text-ink" : "text-ink-muted"}>{m.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(c.expected || c.actual) && (
            <p className="text-[12.5px] text-ink-muted">
              {c.expected && <><span className="text-ink-dim">Expected:</span> {c.expected}. </>}
              {c.actual && <><span className="text-ink-dim">Actual:</span> {c.actual}.</>}
            </p>
          )}
          {c.explanation && <p className="border-l-2 border-[color:var(--role)] pl-3 text-[13px] text-ink-muted">{c.explanation}</p>}
          {!!c.findings?.length && (
            <section>
              <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">What NoX found in the knowledge base</h3>
              <ul className="space-y-1.5">
                {c.findings.map((f) => (
                  <li key={f.ref}>
                    <span className="wikilink wikilink-cross font-mono text-[12px]">{f.ref}</span>
                    <span className="text-ink-muted"> — {f.why}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!c.code?.length && (
            <section>
              <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">Code locations</h3>
              <ul className="space-y-1">
                {c.code.map((x) => (
                  <li key={`${x.app}:${x.location}`} className="flex min-w-0 items-start gap-2">
                    <FileCode2 size={13} className="mt-1 shrink-0 text-ink-dim" aria-hidden />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <code className="font-mono text-[12px] text-ink">{x.location}</code> <span className="text-[12px] text-ink-faint">{x.app}</span>
                      {x.moment_t != null && (
                        <button type="button" onClick={() => seek(x.moment_t!)} className="ml-1 font-mono text-[11px] text-[color:var(--role)]">
                          ▶ {fmtT(x.moment_t)}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!c.contracts?.length && (
            <section>
              <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">Contracts touched</h3>
              <ul className="flex flex-wrap gap-1.5">
                {c.contracts.map((x) => (
                  <li key={`${x.app}:${x.identifier}`} className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[11.5px] text-ink-muted">
                    {x.identifier} <span className="text-ink-dim">· {x.app}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!c.openQuestions?.length && (
            <section>
              <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-dim">Open questions</h3>
              <ul className="list-disc space-y-1 pl-5 text-ink-muted">
                {c.openQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </section>
          )}
          {onUseRequest && c.suggestedRequest && (
            <section className="rounded-sm border border-[color:color-mix(in_srgb,var(--role)_40%,transparent)] p-3">
              <h3 className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--role)]">Suggested request</h3>
              <p className="text-ink">{c.suggestedRequest}</p>
              <button type="button" onClick={() => onUseRequest(c.suggestedRequest!)} className="mt-2 flex h-8 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[12.5px] text-ink hover:border-ink-faint">
                <Check size={13} /> Use this sentence
              </button>
            </section>
          )}
          {c.usage && <p className="font-mono text-[10.5px] text-ink-dim">Watched · {c.usage}</p>}
        </div>
      )}
    </article>
  );
});
