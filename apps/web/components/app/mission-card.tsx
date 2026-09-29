"use client";

import Link from "next/link";

import { ROLE_BY_ID } from "@/lib/app/roles";
import { STAGE_INDEX, STAGE_LABEL, type Mission, type MissionStage } from "@/lib/app/types";

import { appHue } from "./contract-map";
import { OrbitArc } from "./ui";

/** The colour a stage wears: the owning seat's hue for the four spec stages, then build (developer), verify, done. */
export function stageHue(stage: MissionStage): string {
  if (stage === "build") return ROLE_BY_ID.developer.hue;
  if (stage === "verifying") return "#5FD29F";
  if (stage === "done") return "#A6AEC7";
  return ROLE_BY_ID[stage].hue;
}

/** `showPriority` is off where the column already says the priority (the product owner's board). */
export function MissionCard({ m, compact = false, showPriority = true }: { m: Mission; compact?: boolean; showPriority?: boolean }) {
  const verifying = m.stage === "verifying";
  const hue = stageHue(m.stage);
  const apps = m.apps.map((a) => a.name).join(", ");
  return (
    <Link
      href={`/app/missions/${m.key}`}
      // A stripe and a faint wash in the colour of the seat the mission is with.
      className="block rounded-md border border-hairline p-4 transition hover:border-[color:color-mix(in_srgb,var(--role)_45%,transparent)]"
      style={{
        background: `linear-gradient(90deg, color-mix(in srgb, ${hue} 8%, transparent), transparent 55%), rgba(6,7,13,.72)`,
        boxShadow: `inset 3px 0 0 color-mix(in srgb, ${hue} 70%, transparent)`,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-ink-dim">{m.key}</span>
        <span className="flex items-center gap-1.5">
          {showPriority && m.priority && <span className="rounded-sm border border-hairline px-1.5 font-mono text-[10px] text-ink-muted">{m.priority}</span>}
          <span className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: hue }}>
            {STAGE_LABEL[m.stage]}
          </span>
        </span>
      </div>
      <div className="mt-2 text-[14px] font-medium leading-snug text-ink">{m.title}</div>
      {!compact && <p className="mt-1 line-clamp-2 text-[12.5px] italic leading-relaxed text-ink-faint">&ldquo;{m.prompt}&rdquo;</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        {/* The application's own planet colour, the same as on the atlas. */}
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-faint" title={apps}>
          {m.apps[0] && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: appHue(m.apps[0].id) }} />}
          <span className="truncate">{apps}</span>
        </span>
        <span className="shrink-0"><OrbitArc current={STAGE_INDEX[m.stage]} reverse={verifying} width={72} /></span>
      </div>
    </Link>
  );
}
