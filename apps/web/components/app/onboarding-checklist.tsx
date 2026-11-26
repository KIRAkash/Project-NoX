"use client";

import { ArrowRight, Building2, Check, GitBranch, Rocket, UserPlus, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { C, tint } from "@/lib/app/palette";
import type { RoleDef } from "@/lib/app/roles";
import type { OnboardingChecklistData, OnboardingMilestoneKey, OnboardingStep } from "@/lib/app/types";

const STEP_ICON: Record<OnboardingMilestoneKey, LucideIcon> = {
  create_org: Building2,
  link_connector: GitBranch,
  invite_seat: UserPlus,
  launch_mission: Rocket,
};

function storageKey(userId: string, workspaceId: string | null): string {
  return `nox.onboardingChecklist.dismissed.${userId}.${workspaceId ?? "fresh"}`;
}

function readLocalDismissed(userId: string, workspaceId: string | null): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId, workspaceId)) === "1";
  } catch {
    return false;
  }
}

function writeLocalDismissed(userId: string, workspaceId: string | null, dismissed: boolean): void {
  try {
    const key = storageKey(userId, workspaceId);
    if (dismissed) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

function shouldRefreshChecklist(path: string): boolean {
  if (path.startsWith("/api/v1/me/checklist")) return false;
  if (path.startsWith("/api/v1/missions/suggest-apps")) return false;
  if (path.startsWith("/api/v1/sources/validate")) return false;
  return (
    path.startsWith("/api/v1/orgs") ||
    path.startsWith("/api/v1/kb") ||
    path.startsWith("/api/v1/missions") ||
    path.startsWith("/api/v1/sightings") ||
    path.startsWith("/api/v1/me/onboarding")
  );
}

export function OnboardingChecklist({ role }: { role: RoleDef }) {
  const { me } = useAuth();
  const [data, setData] = useState<OnboardingChecklistData | null>(null);
  const [dismissedLocal, setDismissedLocal] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const userId = me?.id ?? "";
  const orgCount = me?.orgs.length ?? 0;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const next = await api<OnboardingChecklistData>("/api/v1/me/checklist");
      setData(next);
      setDismissedLocal(readLocalDismissed(userId, next.workspaceId));
    } catch {
      /* keep prior state if transient network error occurs */
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, orgCount]);

  useEffect(() => {
    const onMutation = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      if (detail?.path && shouldRefreshChecklist(detail.path)) {
        void load();
      }
    };
    const onFocus = () => void load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("nox:api-mutation", onMutation);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("nox:api-mutation", onMutation);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  if (!me || !data || data.completed || data.dismissed || dismissedLocal) {
    return null;
  }

  const canOnboardApp = me.capabilities.includes("onboard_app");

  const dismiss = async () => {
    setDismissing(true);
    setDismissedLocal(true);
    writeLocalDismissed(me.id, data.workspaceId, true);
    try {
      const updated = await api<OnboardingChecklistData>("/api/v1/me/checklist/dismiss", {
        method: "POST",
        json: { orgId: data.workspaceId },
      });
      setData(updated);
    } catch {
      /* localStorage preference still keeps it dismissed locally */
    } finally {
      setDismissing(false);
    }
  };

  return (
    <section
      aria-label="Workspace onboarding checklist"
      data-testid="onboarding-checklist"
      className="surface-panel mt-8 overflow-hidden rounded-md"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: role.ink }} />
            {data.workspaceName ? `Workspace setup · ${data.workspaceName}` : "Workspace setup"}
          </h2>
          <span className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[10.5px] text-ink-faint">
            {data.completedCount} of {data.totalCount} steps completed
          </span>
        </div>
        <button
          type="button"
          disabled={dismissing}
          onClick={() => void dismiss()}
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] text-ink-faint transition-colors hover:bg-[rgb(var(--line)/.08)] hover:text-ink disabled:opacity-50"
        >
          <X size={13} aria-hidden />
          Dismiss checklist
        </button>
      </header>

      <div className="p-5">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <p className="text-ink-muted">Complete these milestones to connect your estate and launch your first mission.</p>
          <span className="shrink-0 font-mono text-[12px] font-semibold" style={{ color: role.ink }}>
            {data.progressPercent}%
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Workspace setup progress"
          aria-valuenow={data.progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--line)/.16)]"
        >
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${data.progressPercent}%`, background: role.ink }}
          />
        </div>

        <ol className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {data.steps.map((step) => (
            <ChecklistItem key={step.key} step={step} role={role} canOnboardApp={canOnboardApp} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function ChecklistItem({ step, role, canOnboardApp }: { step: OnboardingStep; role: RoleDef; canOnboardApp: boolean }) {
  const Icon = STEP_ICON[step.key] ?? Rocket;
  const href = step.key === "link_connector" && !canOnboardApp ? "/app/atlas/connectors" : step.href;

  return (
    <li
      className="flex flex-col justify-between gap-3 rounded-md border p-3.5 transition-colors"
      style={{
        borderColor: step.completed ? tint(C.verify, 28) : "rgb(var(--line)/.18)",
        background: step.completed ? tint(C.verify, 6) : "rgb(var(--void-rgb)/.4)",
      }}
    >
      <div className="flex items-start gap-3">
        {step.completed ? (
          <span
            aria-hidden
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: tint(C.verify, 20), color: C.verifyInk }}
          >
            <Check size={13} strokeWidth={2.6} />
          </span>
        ) : (
          <span
            aria-hidden
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hairline text-ink-muted"
          >
            <Icon size={13} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[13.5px] font-medium ${step.completed ? "text-ink-muted line-through" : "text-ink"}`}>
              {step.title}
            </span>
            {step.completed && (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: C.verifyInk }}>
                Done
              </span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{step.description}</p>
        </div>
      </div>

      {!step.completed && (
        <div className="pl-9">
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:underline"
            style={{ color: role.ink }}
          >
            {step.actionLabel}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      )}
    </li>
  );
}
