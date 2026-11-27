"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useAuth, type ReadinessSummary } from "@/lib/app/auth";
import { C } from "@/lib/app/palette";
import type { RoleDef } from "@/lib/app/roles";
import { useWorkspaceStage } from "@/lib/app/workspace-stage";

/**
 * Three-step workspace readiness bar: organizations -> applications -> first mission.
 * Replaces `FreshStart` so creating an empty organization advances setup to 1/3 instead of dropping guidance,
 * and lets users expand all hidden post-mission panels and secondary nav links in one click.
 */
export function WorkspaceSetup({
  role,
  readinessOverride,
}: {
  role: RoleDef;
  readinessOverride?: ReadinessSummary;
}) {
  const { me, chooseRole, chooseEstate } = useAuth();
  const { readiness: stageReadiness, showAllPanels, setShowAllPanels, setMoreNavOpen } = useWorkspaceStage();
  const [busy, setBusy] = useState(false);

  const r = readinessOverride ?? stageReadiness;
  const doneOrgs = r.orgs > 0;
  const doneApps = r.apps > 0;
  const doneMissions = r.missions > 0;
  const completed = Number(doneOrgs) + Number(doneApps) + Number(doneMissions);

  if (completed >= 3) return null;

  const lead = role.id === "engineering";
  const orgName = me?.orgs[0]?.name;
  const orgSummary = doneOrgs
    ? orgName
      ? `${orgName}${r.orgs > 1 ? ` +${r.orgs - 1}` : ""} charted`
      : `${r.orgs} ${r.orgs === 1 ? "organization" : "organizations"} charted`
    : "Chart first organization";

  const appSummary = doneApps
    ? `${r.apps} ${r.apps === 1 ? "application" : "applications"} onboarded${r.publishedWikis > 0 ? ` · ${r.publishedWikis} in orbit` : ""}`
    : "Onboard first application";

  const missionSummary = role.id === "business" ? "Send first request" : "Start first mission";

  const run = async (fn: () => Promise<unknown>, then?: () => void) => {
    setBusy(true);
    try {
      await fn();
      then?.();
    } finally {
      setBusy(false);
    }
  };

  const togglePanels = () => {
    const next = !showAllPanels;
    setShowAllPanels(next);
    if (next) setMoreNavOpen(true);
  };

  return (
    <section
      data-tour="fresh-start"
      aria-label="Workspace setup"
      className="surface-panel mt-6 rounded-xl border border-hairline px-5 py-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: role.ink }}>
          Workspace setup · {completed} of 3 complete
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {!doneOrgs && me?.demoAvailable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => chooseEstate("demo"), () => window.location.assign("/app"))}
              className="text-[12px] text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Explore demo instead
            </button>
          )}
          <button
            type="button"
            onClick={togglePanels}
            aria-pressed={showAllPanels}
            className="text-[12px] font-semibold transition hover:underline"
            style={{ color: role.ink }}
          >
            {showAllPanels ? "Hide empty panels" : "Show all panels"}
          </button>
        </div>
      </div>

      <ol className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <StepItem
          step={1}
          state={doneOrgs ? "done" : "active"}
          label={orgSummary}
          role={role}
          action={
            !doneOrgs ? (
              lead ? (
                <StepLink href="/app/atlas" role={role}>
                  Open Atlas →
                </StepLink>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => chooseRole("engineering"))}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition hover:opacity-90 disabled:opacity-50"
                  style={{
                    borderColor: "color-mix(in srgb, var(--role) 45%, transparent)",
                    background: "color-mix(in srgb, var(--role) 14%, transparent)",
                    color: role.ink,
                  }}
                >
                  Engineering lead <ArrowRight size={12} />
                </button>
              )
            ) : null
          }
        />

        <StepItem
          step={2}
          state={doneApps ? "done" : doneOrgs ? "active" : "pending"}
          label={appSummary}
          role={role}
          action={
            doneOrgs && !doneApps ? (
              <StepLink href="/app/atlas" role={role}>
                Open Atlas →
              </StepLink>
            ) : null
          }
        />

        <StepItem
          step={3}
          state={doneMissions ? "done" : doneOrgs && doneApps ? "active" : "pending"}
          label={missionSummary}
          role={role}
          action={
            doneOrgs && doneApps && !doneMissions ? (
              role.id === "business" ? (
                <a
                  href="#ask"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition hover:opacity-90"
                  style={{
                    borderColor: "color-mix(in srgb, var(--role) 45%, transparent)",
                    background: "color-mix(in srgb, var(--role) 14%, transparent)",
                    color: role.ink,
                  }}
                >
                  Write below ↓
                </a>
              ) : (
                <StepLink href="/app/missions/new" role={role}>
                  Start mission →
                </StepLink>
              )
            ) : null
          }
        />
      </ol>
    </section>
  );
}

function StepLink({ href, role, children }: { href: string; role: RoleDef; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition hover:opacity-90"
      style={{
        borderColor: "color-mix(in srgb, var(--role) 45%, transparent)",
        background: "color-mix(in srgb, var(--role) 14%, transparent)",
        color: role.ink,
      }}
    >
      {children}
    </Link>
  );
}

function StepItem({
  step,
  state,
  label,
  role,
  action,
}: {
  step: number;
  state: "done" | "active" | "pending";
  label: string;
  role: RoleDef;
  action?: React.ReactNode;
}) {
  const active = state === "active";
  const done = state === "done";
  return (
    <li
      aria-current={active ? "step" : undefined}
      className="flex min-w-0 items-center justify-between gap-2.5 rounded-lg border px-3 py-2 text-[12.5px]"
      style={{
        borderColor: active ? "color-mix(in srgb, var(--role) 55%, transparent)" : "rgb(var(--line)/.18)",
        background: active ? "color-mix(in srgb, var(--role) 8%, rgb(var(--void-rgb)/.55))" : "rgb(var(--void-rgb)/.4)",
      }}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {done ? (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-abyss"
            style={{ background: C.verify }}
            aria-label="Completed"
          >
            <Check size={12} strokeWidth={3} />
          </span>
        ) : (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10.5px] font-semibold"
            style={
              active
                ? { borderColor: role.ink, background: role.hue, color: "#14110A" }
                : { borderColor: "rgb(var(--line)/.3)", color: "var(--ink-dim)" }
            }
          >
            {step}
          </span>
        )}
        <span className={`truncate ${active ? "font-semibold text-ink" : done ? "font-medium text-ink-muted" : "text-ink-faint"}`}>{label}</span>
      </span>
      {action}
    </li>
  );
}
