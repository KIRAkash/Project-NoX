"use client";

import { Play } from "lucide-react";

import { fmtT } from "@/lib/app/types";

export const MEDIA_SEEK = "nox:media-seek";
export type MediaSeek = { id: string; t: number };

/** Ask whoever shows the capture (the mission's Evidence tab) to open it and play from `t`. */
export function seekMedia(id: string, t: number) {
  window.dispatchEvent(new CustomEvent<MediaSeek>(MEDIA_SEEK, { detail: { id, t } }));
}

/** `[[media:<id>#t=42]]` in a spec file: a chip that opens the capture at that moment. */
export function MediaChip({ id, t }: { id: string; t: number | null }) {
  return (
    <button
      type="button"
      onClick={() => seekMedia(id, t ?? 0)}
      title="Play this moment of the capture"
      className="mx-0.5 inline-flex items-center gap-1 rounded-full border border-[color:var(--role)] px-1.5 py-px align-baseline font-mono text-[11.5px] text-[color:var(--role)] hover:bg-[color:color-mix(in_srgb,var(--role)_12%,transparent)]"
    >
      <Play size={9} className="fill-current" aria-hidden />
      {t === null ? "capture" : fmtT(t)}
    </button>
  );
}

/** Parse `media:<id>#t=<seconds>` (the part inside the brackets). */
export function parseMediaRef(target: string): { id: string; t: number | null } | null {
  const m = /^media:([0-9a-fA-F-]{8,36})(?:#t=(\d+(?:\.\d+)?))?$/.exec(target.trim());
  return m ? { id: m[1], t: m[2] ? Number(m[2]) : null } : null;
}
