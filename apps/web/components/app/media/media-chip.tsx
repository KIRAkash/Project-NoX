"use client";

import { Play } from "lucide-react";

import { fmtT } from "@/lib/app/types";

import { addedBy, KIND_ICON, useMissionMedia, useShownId } from "./mission-media";

export const MEDIA_SEEK = "nox:media-seek";
export type MediaSeek = { id: string; t: number };

/** Ask whoever shows the capture (the mission's Evidence tab) to open it and play from `t`. */
export function seekMedia(id: string, t: number) {
  window.dispatchEvent(new CustomEvent<MediaSeek>(MEDIA_SEEK, { detail: { id, t } }));
}

/**
 * `[[media:<id>]]` or `[[media:<id>#t=42]]` in a spec file: a chip that opens the capture on the Evidence tab (at that
 * moment, for a recording). On the mission page it's labelled with the capture's number, kind and who added it.
 */
export function MediaChip({ id: cited, t }: { id: string; t: number | null }) {
  const media = useMissionMedia();
  const id = useShownId()(cited);
  const n = media.findIndex((c) => c.id === id);
  const c = n < 0 ? null : media[n];
  const Icon = c ? KIND_ICON[c.kind] : Play;
  return (
    <button
      type="button"
      onClick={() => seekMedia(id, t ?? 0)}
      title={c ? `Open ${c.label}, added by ${addedBy(c)}` : "Open this capture"}
      className="mx-0.5 inline-flex max-w-[280px] items-center gap-1 rounded-full border border-[color:var(--role)] px-1.5 py-px align-baseline font-mono text-[11.5px] text-[color:var(--role)] hover:bg-[color:color-mix(in_srgb,var(--role)_12%,transparent)]"
    >
      <Icon size={10} className={c ? "shrink-0" : "shrink-0 fill-current"} aria-hidden />
      <span className="truncate">
        {c ? `E${n + 1} · ${c.label}` : "capture"}
        {t !== null && ` · ${fmtT(t)}`}
      </span>
    </button>
  );
}

/** Parse `media:<id>#t=<seconds>` (the part inside the brackets). */
export function parseMediaRef(target: string): { id: string; t: number | null } | null {
  const m = /^media:([0-9a-fA-F-]{8,36})(?:#t=(\d+(?:\.\d+)?))?$/.exec(target.trim());
  return m ? { id: m[1], t: m[2] ? Number(m[2]) : null } : null;
}
