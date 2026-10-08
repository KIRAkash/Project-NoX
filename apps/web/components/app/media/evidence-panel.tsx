"use client";

import { Panel } from "@/components/app/ui";

import { seekMedia } from "./media-chip";
import { addedBy, KIND_ICON, useMissionMedia } from "./mission-media";
import { C } from "@/lib/app/palette";

const STATUS: Record<string, { color: string; label: string }> = {
  uploading: { color: C.violetInk, label: "Uploading" },
  analyzing: { color: C.violetInk, label: "NoX is looking" },
  failed: { color: C.emberInk, label: "Couldn't read it" },
  withheld: { color: C.emberInk, label: "Withheld by NoX Shield" },
};

/** The rail's list of everything shown to NoX on this mission: who added it, and one click to open it. */
export function EvidencePanel({ onOpenTab }: { onOpenTab: () => void }) {
  const media = useMissionMedia();
  return (
    <Panel
      title={media.length ? `Evidence · ${media.length}` : "Evidence"}
      action={
        <button type="button" onClick={onOpenTab} className="text-[12px] text-ink-dim hover:text-ink">
          {media.length ? "Open tab" : "Add"}
        </button>
      }
    >
      {media.length ? (
        <ul className="space-y-1" aria-label="Evidence on this mission">
          {media.map((c, i) => {
            const Icon = KIND_ICON[c.kind];
            const status = STATUS[c.status];
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => seekMedia(c.id, 0)}
                  className="-mx-1.5 flex w-[calc(100%+12px)] items-start gap-2 rounded-sm px-1.5 py-1.5 text-left hover:bg-[rgb(var(--line)/.07)]"
                >
                  <span className="mt-px w-6 shrink-0 font-mono text-[11px] text-[color:var(--role)]">E{i + 1}</span>
                  <Icon size={13} className="mt-0.5 shrink-0 text-ink-dim" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{c.label}</span>
                    <span className="block truncate text-[11.5px] text-ink-faint">
                      {addedBy(c)}
                      {status && (
                        <>
                          {" · "}
                          <span style={{ color: status.color }}>{status.label}</span>
                        </>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-faint">Nothing shown to NoX yet. A screenshot or a short recording often says more than a paragraph.</p>
      )}
    </Panel>
  );
}
