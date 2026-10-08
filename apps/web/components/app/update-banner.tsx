"use client";

import { MediaChip } from "@/components/app/media/media-chip";
import { ROLE_BY_ID } from "@/lib/app/roles";
import type { Evidence, Mission, MissionUpdate } from "@/lib/app/types";

const KIND: Record<MissionUpdate["kind"], string> = {
  completed: "Verified",
  partial: "Partly works",
  rework: "Needs rework",
  blocked: "Blocked",
};

function EvidenceLine({ e }: { e: Evidence }) {
  if (e.type === "capture") return <MediaChip id={e.mediaId} t={null} />;
  if (e.type === "link")
    return (
      <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-ink">
        {e.label}
      </a>
    );
  return <span>{e.type === "metric" ? `${e.name} = ${e.value}` : e.text}</span>;
}

/**
 * The latest update, when it is for you: a send-back addressed to your seat, with only what failed. Older updates
 * live on the timeline. One quiet card, never a thread.
 */
export function UpdateBanner({ m, updates, myRole }: { m: Mission; updates: MissionUpdate[]; myRole: string }) {
  const u = updates[0];
  if (!u || m.stage === "verifying" || m.stage === "done") return null;
  if (u.kind === "completed" || u.kind === "blocked" || u.toRole !== myRole) return null;
  const from = ROLE_BY_ID[u.role];
  return (
    <section className="mt-4 rounded-md border border-[rgba(233,113,60,.35)] px-4 py-3 text-[13px]" aria-label="Update for you">
      <p className="text-ink">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[color:var(--coral-ink)]">
          {KIND[u.kind]} · round {u.round}
        </span>{" "}
        {from.name} sent this back{u.note ? `: ${u.note}` : "."}
      </p>
      {u.items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {u.items.slice(0, 6).map((it, i) => (
            <li key={i} className="text-ink-muted">
              <span className="text-ink">{it.text}</span>
              {it.note && <span className="text-ink-faint"> — {it.note}</span>}
              {it.evidence.length > 0 && (
                <span className="ml-2 inline-flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-faint">
                  {it.evidence.map((e, k) => (
                    <EvidenceLine key={k} e={e} />
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
