"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/app/brand-logo";
import { stageHue } from "@/components/app/mission-card";
import { EmptyState, Panel } from "@/components/app/ui";
import type { RoleDef } from "@/lib/app/roles";
import { STAGE_LABEL, type Mission } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

import { AtlasPanel, MissionPanel, NoxCommand } from "./shared";
import { C, legible } from "@/lib/app/palette";

type Token = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

/**
 * The build bay: the developer builds with their own coding agent. So the home is a build queue with the exact
 * `/nox NOX-n` command to paste, the pull requests in flight, and — until the CLI has signed in — how to set it up.
 */
export function DeveloperHome({ role }: { role: RoleDef }) {
  const waiting = useApi<Mission[]>("/api/v1/missions?view=waiting");
  const all = useApi<Mission[]>("/api/v1/missions?view=all");
  const tokens = useApi<Token[]>("/api/v1/me/tokens");
  const prs = (all.data ?? []).flatMap((m) => m.links.filter((l) => l.system === "github_pr").map((l) => ({ m, l })));

  return (
    <div className="mt-10 space-y-5">
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Panel title={waiting.data?.length ? `Build queue · ${waiting.data.length}` : "Build queue"} className="lg:col-span-2">
          {waiting.loading && !waiting.data ? (
            <p className="font-mono text-[13px] text-ink-faint">loading…</p>
          ) : waiting.data?.length ? (
            <ul className="space-y-2">
              {waiting.data.map((m) => (
                <li key={m.key} className="flex flex-col gap-2 rounded-md border border-hairline bg-[rgb(var(--void-rgb)/.6)] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <Link href={`/app/missions/${m.key}`} className="min-w-0 hover:text-[color:var(--role)]">
                    <span className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="text-ink-muted">{m.key}</span>
                      <span style={{ color: legible(stageHue(m.stage)) }}>{m.stage === "build" ? "building" : STAGE_LABEL[m.stage].toLowerCase()}</span>
                      <span className="truncate text-ink-dim">{m.apps.map((a) => a.name).join(" · ")}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[14px] text-ink">{m.title}</span>
                  </Link>
                  {(m.stage === "build" || m.stage === "developer") && <NoxCommand missionKey={m.key} className="self-start sm:self-auto" />}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState role={role} line="Nothing in the queue. Missions land here once the engineering design is approved." />
          )}
        </Panel>
        <CliPanel tokens={tokens.data} loading={tokens.loading} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Panel title={prs.length ? `Pull requests · ${prs.length}` : "Pull requests"}>
          {prs.length ? (
            <ul className="space-y-2.5">
              {prs.slice(0, 6).map(({ m, l }) => {
                const state = typeof l.state?.state === "string" ? l.state.state : "open";
                const guard = l.state?.guard as { compliant?: boolean } | undefined;
                return (
                  <li key={`${m.key}-${l.externalId}`} className="flex items-center justify-between gap-2 font-mono text-[12px]">
                    <a href={l.url ?? "#"} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-ink hover:text-[color:var(--role)]">
                      <BrandLogo name="github" size={12} />
                      <span className="truncate">{l.externalId}</span>
                      <ExternalLink size={11} className="shrink-0 text-ink-dim" />
                    </a>
                    <span className="flex shrink-0 items-center gap-2">
                      {guard && <span style={{ color: guard.compliant ? C.verifyInk : C.emberInk }}>{guard.compliant ? "guard ok" : "guard ✕"}</span>}
                      <span style={{ color: state === "merged" ? C.violetInk : state === "closed" ? "var(--ink-dim)" : C.verifyInk }}>{state}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState line="No pull requests linked yet. `nox pr NOX-n` links one and runs the guard." />
          )}
        </Panel>
        <MissionPanel title="Verify first" view="back" empty="After you mark a mission completed, your verification checklist lights up here first." role={role} />
        <AtlasPanel role={role} title="Your applications" />
      </div>
    </div>
  );
}

function CliPanel({ tokens, loading }: { tokens: Token[] | null; loading: boolean }) {
  const connected = Boolean(tokens?.length);
  const last = tokens?.map((t) => t.lastUsedAt).filter(Boolean).sort().pop();
  return (
    <Panel
      title="Terminal"
      action={
        <Link href="/app/cli" className="font-mono text-[11.5px] text-ink-dim hover:text-ink">
          cli →
        </Link>
      }
    >
      <div className="rounded-md console border p-4 font-mono text-[12.5px] leading-6">
        {loading ? (
          <span className="text-ink-dim">checking…</span>
        ) : connected ? (
          <>
            <div className="text-ink-dim">$ nox whoami</div>
            <div className="text-verify">✓ signed in · {tokens!.length} token{tokens!.length > 1 ? "s" : ""}</div>
            {last && <div className="text-ink-dim">last call {new Date(last).toLocaleString()}</div>}
            <div className="mt-2 text-ink-dim">$ nox missions --view waiting</div>
            <div className="text-ink-dim">
              then in your agent: <span className="text-[color:var(--sky-ink)]">/nox NOX-n</span>
            </div>
          </>
        ) : (
          <>
            <div className="text-ink-dim"># not signed in yet</div>
            <div className="text-ink">$ packages/nox-cli/install.sh</div>
            <div className="text-ink">$ nox login</div>
            <div className="text-ink">$ nox init antigravity</div>
            <div className="mt-1 text-ink-dim">then in your agent:</div>
            <div className="text-[color:var(--sky-ink)]">&gt; /nox NOX-n</div>
          </>
        )}
      </div>
    </Panel>
  );
}
