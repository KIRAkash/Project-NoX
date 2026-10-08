"use client";

import { Pause, Play, Square, Trash2 } from "lucide-react";
import { useEffect } from "react";

import { fmtT } from "@/lib/app/types";

/** The floating recorder: red dot, time out of the limit, pause, stop and discard. Esc stops (after asking). */
export function RecordingPill({
  state,
  countdown,
  elapsed,
  maxS,
  onPause,
  onResume,
  onStop,
  onDiscard,
}: {
  state: "countdown" | "recording" | "paused";
  countdown: number;
  elapsed: number;
  maxS: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state !== "countdown" && window.confirm("Stop recording? You can still retake it.")) onStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onStop]);

  const btn = "flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-ink hover:bg-[rgb(var(--line)/.14)]";
  return (
    <div
      role="region"
      aria-label="Screen recording"
      className="fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-full border border-[rgba(233,113,60,.5)] bg-deck px-2 py-1.5 shadow-2xl lg:bottom-8"
    >
      {state === "countdown" ? (
        <span className="px-4 py-1 font-mono text-[14px] text-ink" aria-live="assertive">
          Recording in {countdown}…
        </span>
      ) : (
        <>
          <span className="flex items-center gap-2 px-2 font-mono text-[12.5px] text-ink" aria-live="polite">
            <span className={`h-2.5 w-2.5 rounded-full bg-ember ${state === "recording" ? "animate-pulse motion-reduce:animate-none" : "opacity-50"}`} aria-hidden />
            {fmtT(elapsed)} / {fmtT(maxS)}
          </span>
          {state === "recording" ? (
            <button type="button" onClick={onPause} className={btn}>
              <Pause size={13} /> Pause
            </button>
          ) : (
            <button type="button" onClick={onResume} className={btn}>
              <Play size={13} /> Resume
            </button>
          )}
          <button type="button" onClick={onStop} className={`${btn} font-semibold`}>
            <Square size={12} className="fill-ember text-ember" /> Stop
          </button>
        </>
      )}
      <button type="button" onClick={onDiscard} className={`${btn} text-ink-muted`}>
        <Trash2 size={13} /> Discard
      </button>
    </div>
  );
}
