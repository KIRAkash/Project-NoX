"use client";

/**
 * Hand off to Jules (CP20). The developer gives a mission in Build to Jules, Google's asynchronous coding agent.
 * The button is always there for the developer; when Jules can't be used it is greyed out and a line under it says
 * why and where to fix it (a line, not a tooltip: phones have no hover). Jules's sessions show in the Jira & pull
 * requests panel: its plan to approve, its questions to answer, and the PR it opens.
 */

import { Bot, ExternalLink, GitPullRequest, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import type { JulesSession, JulesStatus, Mission, MissionLink } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

/** The mission's Jules status, refetched whenever a Jules session on the mission changes (SSE reloads the links). */
export function useJules(missionKey: string, links: MissionLink[] | undefined, enabled = true) {
  const status = useApi<JulesStatus>(enabled ? `/api/v1/missions/${missionKey}/jules` : null);
  const version = useMemo(
    () => JSON.stringify((links ?? []).filter((l) => l.system === "jules").map((l) => [l.externalId, l.state?.state, l.state?.prUrl, l.state?.polledAt])),
    [links],
  );
  const { reload } = status;
  useEffect(() => {
    if (enabled) void reload();
  }, [version, enabled, reload]);
  return status;
}

const CHIP: Record<string, string> = {
  AWAITING_PLAN_APPROVAL: "#F7B542",
  AWAITING_USER_FEEDBACK: "#F7B542",
  COMPLETED: "#5FD29F",
  FAILED: "#E9713C",
};

function StateChip({ s }: { s: JulesSession }) {
  const color = CHIP[s.state] ?? "var(--role)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.04em]" style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, color }}>
      {s.active && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: color }} aria-hidden />}
      {s.label}
    </span>
  );
}

/** The header button (developer seat, Build stage) and, when Jules can't be used, the reason under it. */
export function JulesHandoff({ m, jules, onStarted }: { m: Mission; jules: ReturnType<typeof useJules>; onStarted: () => void }) {
  const [open, setOpen] = useState(false);
  const data = jules.data;
  const active = data?.sessions.find((s) => s.active);
  if (active) {
    return (
      <a href="#jules" className="flex h-9 items-center gap-1.5 rounded-sm border border-[color:color-mix(in_srgb,var(--role)_45%,transparent)] px-3 text-[13px] text-[color:var(--role)]">
        <Bot size={14} aria-hidden /> {active.label}
      </a>
    );
  }
  const ready = data?.readiness.state === "ready";
  return (
    <>
      <button
        type="button"
        onClick={() => ready && setOpen(true)}
        aria-disabled={!ready}
        aria-describedby={!ready ? "jules-why" : undefined}
        className={`flex h-9 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[13px] ${ready ? "text-ink-muted hover:border-ink-faint hover:text-ink" : "cursor-not-allowed text-ink-dim opacity-55"}`}
      >
        <Bot size={14} aria-hidden /> Hand off to Jules
      </button>
      {open && data && <HandoffSheet m={m} status={data} onClose={() => setOpen(false)} onStarted={() => { setOpen(false); void jules.reload(); onStarted(); }} />}
    </>
  );
}

/** Why the button is greyed out, with the place to fix it. Rendered under the file header, full width. */
export function JulesWhy({ jules }: { jules: ReturnType<typeof useJules> }) {
  const r = jules.data?.readiness;
  if (jules.loading && !jules.data) return null;
  if (jules.error) return <p id="jules-why" className="mb-3 text-right text-[12.5px] text-ink-faint">Couldn&rsquo;t check Jules: {jules.error.detail}</p>;
  if (!r || r.state === "ready" || jules.data?.sessions.some((s) => s.active)) return null;
  const toConnectors = r.state === "not_configured" || r.state === "failing";
  return (
    <p id="jules-why" className="mb-3 text-[12.5px] leading-relaxed text-ink-faint sm:text-right">
      {r.detail}
      {toConnectors && (
        <>
          {" "}
          <Link href="/app/atlas/connectors" className="text-ink-muted underline decoration-dotted hover:text-ink">
            Open Connectors
          </Link>
        </>
      )}
      {r.state === "repo_not_connected" && (
        <>
          {" "}
          <a href="https://jules.google.com" target="_blank" rel="noreferrer" className="text-ink-muted underline decoration-dotted hover:text-ink">
            Open Jules
          </a>
        </>
      )}
    </p>
  );
}

function HandoffSheet({ m, status, onClose, onStarted }: { m: Mission; status: JulesStatus; onClose: () => void; onStarted: () => void }) {
  const toast = useToast();
  const repos = status.readiness.repos.filter((r) => r.connected);
  const [repo, setRepo] = useState(repos[0]?.repo ?? "");
  const [planFirst, setPlanFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const target = repos.find((r) => r.repo === repo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = async () => {
    setBusy(true);
    try {
      await api(`/api/v1/missions/${m.key}/jules`, { method: "POST", json: { repo, requirePlanApproval: planFirst } });
      toast(planFirst ? "Handed to Jules. Its plan comes back to you first" : "Handed to Jules", "success");
      onStarted();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Jules didn't start", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,6,11,.7)] px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-0" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="jules-title" className="w-full max-w-[480px] rounded-md border border-hairline bg-deck p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="jules-title" className="flex items-center gap-2 text-[16px] font-semibold text-ink">
            <Bot size={16} className="text-[color:var(--role)]" aria-hidden /> Hand off to Jules
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-dim hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
          Jules, Google&rsquo;s coding agent, builds {m.key} from the four spec files and opens a pull request titled <span className="font-mono text-[12.5px] text-ink">{m.key}: …</span>. You review it and mark the mission completed, as usual.
        </p>

        <div className="mt-4 space-y-3 text-[13px]">
          {repos.length > 1 ? (
            <label className="block">
              <span className="text-ink-dim">Repository</span>
              <select value={repo} onChange={(e) => setRepo(e.target.value)} className="mt-1 h-9 w-full rounded-sm border border-hairline bg-void px-2 text-ink">
                {repos.map((r) => (
                  <option key={r.repo} value={r.repo}>
                    {r.repo} ({r.app})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-ink-dim">
              Repository: <span className="font-mono text-ink">{repo}</span>
            </p>
          )}
          {target && <p className="text-ink-dim">Starts from <span className="font-mono text-ink">{target.branch}</span>.</p>}
          <label className="flex items-start gap-2 text-ink-muted">
            <input type="checkbox" checked={planFirst} onChange={(e) => setPlanFirst(e.target.checked)} className="mt-0.5 accent-[color:var(--role)]" />
            <span>Let me approve Jules&rsquo;s plan before it writes code</span>
          </label>
          <p className="rounded-sm border border-hairline bg-void px-3 py-2 text-[12.5px] leading-relaxed text-ink-faint">
            Jules gets the four spec files, the relevant knowledge-base pages and NoX&rsquo;s rules: the PR title, unchanged contracts, and no ticked checklists. NoX Shield checks it for secrets first.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-sm border border-hairline px-4 text-[13px] text-ink-muted hover:text-ink">
            Cancel
          </button>
          <button type="button" disabled={busy || !repo} onClick={() => void start()} className="h-9 rounded-sm bg-[color:var(--role)] px-4 text-[13px] font-semibold text-void disabled:opacity-50">
            {busy ? "Handing off…" : "Hand off"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Jules's sessions on the mission, inside the Jira & pull requests panel. */
export function JulesSessions({ m, jules, onChanged }: { m: Mission; jules: ReturnType<typeof useJules>; onChanged: () => void }) {
  const sessions = jules.data?.sessions ?? [];
  if (!sessions.length) return null;
  return (
    <ul id="jules" className="mt-3 space-y-3 border-t border-hairline pt-3">
      {sessions.map((s) => (
        <SessionRow key={s.id} m={m} s={s} canAct={Boolean(jules.data?.canAct)} onChanged={() => { void jules.reload(); onChanged(); }} />
      ))}
    </ul>
  );
}

function SessionRow({ m, s, canAct, onChanged }: { m: Mission; s: JulesSession; canAct: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [showPlan, setShowPlan] = useState(s.state === "AWAITING_PLAN_APPROVAL");
  useEffect(() => {
    if (s.state === "AWAITING_PLAN_APPROVAL") setShowPlan(true);
  }, [s.state]);

  const act = async (path: string, json: unknown, done: string) => {
    setBusy(true);
    try {
      await api(`/api/v1/missions/${m.key}/jules/${s.id}/${path}`, { method: "POST", json });
      toast(done, "success");
      setReplying(false);
      setText("");
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Jules didn't take that", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ink">
          <Bot size={13} className="shrink-0 text-[color:var(--role)]" aria-hidden />
          <span className="truncate">Jules · {s.repo}</span>
        </span>
        <StateChip s={s} />
      </div>
      {s.active && s.progress && <p className="mt-1 text-[12px] text-ink-faint">{s.progress}</p>}
      {s.question && (
        <blockquote className="mt-2 rounded-sm border-l-2 border-[#F7B542] bg-[rgba(247,181,66,.06)] px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">{s.question}</blockquote>
      )}
      {s.state === "FAILED" && s.reason && <p className="mt-1 text-[12px] text-[#F3A27E]">{s.reason}</p>}
      {s.plan.length > 0 && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setShowPlan((v) => !v)} aria-expanded={showPlan} className="text-[12px] text-ink-dim underline decoration-dotted hover:text-ink">
            {showPlan ? "Hide" : "Show"} Jules&rsquo;s plan ({s.plan.length} step{s.plan.length === 1 ? "" : "s"})
          </button>
          {showPlan && (
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[12.5px] text-ink-muted">
              {s.plan.map((p, i) => (
                <li key={i}>
                  {p.title}
                  {p.description && <span className="block text-[11.5px] text-ink-faint">{p.description}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {s.prUrl && (
        <a href={s.prUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-ink hover:text-[color:var(--role)]">
          <GitPullRequest size={12} aria-hidden /> Jules&rsquo;s pull request <ExternalLink size={11} aria-hidden />
        </a>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canAct && s.state === "AWAITING_PLAN_APPROVAL" && (
          <button type="button" disabled={busy} onClick={() => void act("approve-plan", {}, "Plan approved. Jules is building")} className="h-8 rounded-sm bg-[color:var(--role)] px-3 text-[12.5px] font-semibold text-void disabled:opacity-50">
            Approve plan
          </button>
        )}
        {canAct && s.active && !replying && (
          <button type="button" onClick={() => setReplying(true)} className="h-8 rounded-sm border border-hairline px-3 text-[12.5px] text-ink-muted hover:text-ink">
            {s.question ? "Answer Jules" : "Message Jules"}
          </button>
        )}
        {s.url && (
          <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 text-[12px] text-ink-dim hover:text-ink">
            Open in Jules <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </div>
      {replying && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void act("message", { text: text.trim() }, "Sent to Jules");
          }}
        >
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} aria-label="Message to Jules" placeholder="What should Jules know?" className="w-full rounded-sm border border-hairline bg-void p-2 text-[13px] text-ink" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !text.trim()} className="h-8 rounded-sm border border-hairline px-3 text-[12.5px] text-ink hover:border-ink-faint disabled:opacity-50">
              Send
            </button>
            <button type="button" onClick={() => setReplying(false)} className="h-8 px-2 text-[12.5px] text-ink-dim hover:text-ink">
              Cancel
            </button>
          </div>
        </form>
      )}
      {s.startedBy && <p className="mt-1 text-[11px] text-ink-dim">Handed off by {s.startedBy}</p>}
    </li>
  );
}
