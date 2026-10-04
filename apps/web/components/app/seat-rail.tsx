"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { REQUEST_STEPS, requestStep, NoxCommand, useRootOrgMap } from "@/components/app/homes/shared";
import { BrandLogo } from "@/components/app/brand-logo";
import { stageHue } from "@/components/app/mission-card";
import { Panel } from "@/components/app/ui";
import type { RoleId } from "@/lib/app/roles";
import type { Mission, OrgMap } from "@/lib/app/types";

/**
 * What each seat needs first on a mission page, above the spec files:
 * business — where their request is, in plain words; product — the acceptance criteria they own;
 * developer — the command to build it and the pull requests; engineering — the blast radius (in the side rail).
 */
export function SeatBanner({ m, seat }: { m: Mission; seat: RoleId }) {
  if (seat === "business") return <BusinessTrack m={m} />;
  if (seat === "product") return <AcceptanceSummary m={m} />;
  if (seat === "developer") return <BuildCard m={m} />;
  return null;
}

const BUSINESS_NOW: Record<number, string> = {
  0: "NoX wrote up your request. Read it below and confirm it's what you meant.",
  1: "Product and engineering are working out exactly what to build.",
  2: "A developer is building it.",
  3: "It's built. Each seat is checking it — you'll confirm last.",
  4: "Done. Everyone, including you, has confirmed it does what you asked.",
};

function BusinessTrack({ m }: { m: Mission }) {
  const step = requestStep(m);
  const yourTurn = m.stage === "verifying" && m.verifyRole === "business";
  return (
    <section
      className="mt-6 rounded-xl border p-5"
      style={{ borderColor: "color-mix(in srgb, var(--role) 35%, transparent)", background: "linear-gradient(180deg, color-mix(in srgb, var(--role) 9%, rgba(17,21,35,.85)), rgba(12,15,26,.85))" }}
    >
      <ol className="grid grid-cols-5 gap-1.5" aria-label={`Progress: ${REQUEST_STEPS[step]}`}>
        {REQUEST_STEPS.map((label, i) => {
          const done = i < step || step === 4;
          const now = i === step && step !== 4;
          return (
            <li key={label} className="min-w-0">
              <span className={`block h-2 rounded-full ${now ? "motion-safe:animate-pulse" : ""}`} style={{ background: done ? "var(--role)" : now ? "color-mix(in srgb, var(--role) 70%, transparent)" : "rgba(143,160,204,.16)" }} />
              <span className={`mt-2 block truncate text-[12px] ${now ? "text-ink" : done ? "text-ink-muted" : "text-ink-dim"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-[15px] text-ink">{yourTurn ? "Your turn: it's built. Check it below and say whether it does what you asked." : BUSINESS_NOW[step]}</p>
    </section>
  );
}

function AcceptanceSummary({ m }: { m: Mission }) {
  const file = m.files.find((f) => f.role === "product");
  const md = file?.markdown ?? "";
  // Acceptance criteria are the checklist items in the product spec.
  const criteria = (md.match(/^\s*[-*] \[[ xX]\]/gm) ?? []).length;
  const questions = (md.match(/open question/gi) ?? []).length;
  const verify = file?.verification?.items ?? [];
  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-3">
      <Stat label="Acceptance criteria" value={criteria || "—"} hint={criteria ? "in your product spec" : "none written yet"} />
      <Stat label="Priority" value={m.priority ?? "Unset"} hint={m.priority ? "set by you" : "set it above"} />
      <Stat
        label="Acceptance check"
        value={verify.length ? `${verify.filter((x) => x.checked).length}/${verify.length}` : questions ? `${questions} open` : "—"}
        hint={verify.length ? "ticked when it comes back" : questions ? "open questions in the spec" : "after the build"}
      />
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="rounded-md border border-[rgba(143,160,204,.18)] bg-[linear-gradient(180deg,rgba(21,26,42,.8),rgba(13,16,28,.8))] px-4 py-3">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--role)]">{label}</div>
      <div className="mt-1 font-display text-[28px] leading-none text-ink">{value}</div>
      <div className="mt-1 text-[12px] text-ink-faint">{hint}</div>
    </div>
  );
}

function BuildCard({ m }: { m: Mission }) {
  const prs = m.links.filter((l) => l.system === "github_pr");
  const jira = m.links.find((l) => l.system === "jira" && l.primary);
  const buildable = m.stage === "developer" || m.stage === "build";
  return (
    <section className="mt-6 rounded-md border border-[rgba(134,185,238,.28)] bg-[#04050A] p-4 font-mono text-[12.5px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-ink-dim"># {buildable ? "build it with your coding agent" : `stage: ${m.stage}`}</div>
          <div className="text-ink">
            $ nox context {m.key} --save
          </div>
        </div>
        <NoxCommand missionKey={m.key} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-hairline pt-3 text-[12px]">
        <span className="text-ink-dim">branch</span>
        <span className="text-[#CFE3FA]">nox/{m.key}</span>
        {jira && (
          <a href={jira.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink">
            <BrandLogo name="jira" size={12} />
            {jira.externalId} <ExternalLink size={11} />
          </a>
        )}
        {prs.map((l) => (
          <a key={l.externalId} href={l.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink">
            <BrandLogo name="github" size={12} />
            {l.externalId} · {typeof l.state?.state === "string" ? l.state.state : "open"} <ExternalLink size={11} />
          </a>
        ))}
        {!prs.length && <span className="text-ink-dim">no PR yet · nox pr {m.key}</span>}
      </div>
    </section>
  );
}

/** For the engineering lead: this mission's applications, what they expose, and every application tied to them by a contract. */
export function MissionBlastRadius({ m }: { m: Mission }) {
  const { map } = useRootOrgMap();
  const rows = useMemo(() => {
    const data: OrgMap | null = map.data;
    return m.apps.map((a) => {
      const links = (data?.links ?? []).filter((l) => l.from === a.id || l.to === a.id);
      const neighbours = links.map((l) => {
        const other = l.from === a.id ? l.to : l.from;
        return { id: other, name: data?.apps.find((x) => x.id === other)?.name ?? "?", count: l.count, outgoing: l.from === a.id };
      });
      return { ...a, interfaces: (data?.contracts ?? []).filter((c) => c.appId === a.id).length, neighbours };
    });
  }, [map.data, m.apps]);
  const hue = stageHue(m.stage);
  const reach = new Set(rows.flatMap((r) => r.neighbours.map((n) => n.id)));

  return (
    <Panel title="Blast radius">
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: hue, boxShadow: `0 0 8px ${hue}` }} />
              <Link href={`/app/atlas/apps/${r.id}?tab=explore`} className="truncate text-[13.5px] text-ink hover:text-[color:var(--role)]">
                {r.name}
              </Link>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-dim">{r.interfaces} interfaces</span>
            </div>
            {r.neighbours.length > 0 ? (
              <ul className="ml-[5px] mt-1.5 space-y-1 border-l border-hairline pl-3.5">
                {r.neighbours.map((n) => (
                  <li key={n.id} className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
                    <span className="font-mono text-ink-dim">{n.outgoing ? "→" : "←"}</span>
                    <Link href={`/app/atlas/apps/${n.id}?tab=explore`} className="truncate hover:text-ink">
                      {n.name}
                    </Link>
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-dim">×{n.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ml-[18px] mt-1 text-[12px] text-ink-faint">{map.data ? "No contracts with other applications." : "Mapping contracts…"}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-hairline pt-3 text-[12px] text-ink-faint">
        {m.apps.length} changing · {reach.size} more within one contract
      </p>
    </Panel>
  );
}
