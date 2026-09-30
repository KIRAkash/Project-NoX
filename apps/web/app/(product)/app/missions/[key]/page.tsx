"use client";

import { CornerUpLeft, ExternalLink, Lock, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { BrandLogo } from "@/components/app/brand-logo";
import { FlightStrip } from "@/components/app/flight-recorder";
import { KbMarkdown } from "@/components/app/markdown";
import { Planet } from "@/components/app/planet";
import { MissionBlastRadius, SeatBanner } from "@/components/app/seat-rail";
import { SpecEditor } from "@/components/app/spec-editor";
import { TicketPanel } from "@/components/app/ticket-panel";
import { FEED_LIST, OrbitArc, Panel, useToast } from "@/components/app/ui";
import { VerifyPanel, VerifyStrip } from "@/components/app/verify-panel";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID, type RoleId } from "@/lib/app/roles";
import { subscribe } from "@/lib/app/stream";
import { SPEC_STATUS_LABEL, STAGE_INDEX, STAGE_LABEL, type Mission, type MissionEvent, type SpecFile, type TicketState } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

const ORDER: RoleId[] = ["business", "product", "engineering", "developer"];

const STATUS_COLOR: Record<SpecFile["status"], string> = {
  empty: "#6E7793",
  drafting: "#A897F0",
  ai_drafted: "#F7B542",
  draft: "#86B9EE",
  approved: "#5FD29F",
  stale: "#E9713C",
};

export default function MissionPage() {
  const { key } = useParams<{ key: string }>();
  const { me } = useAuth();
  const myRole = me!.role as RoleId;
  const mission = useApi<Mission>(`/api/v1/missions/${key}`);
  const events = useApi<MissionEvent[]>(`/api/v1/missions/${key}/events`);
  const ticket = useApi<TicketState>(`/api/v1/missions/${key}/state`);
  const [tab, setTab] = useState<RoleId>(myRole);
  // The business user reads their own file; the other three stay one click away.
  const [trail, setTrail] = useState(myRole !== "business");

  const reloads = useRef({ mission: mission.reload, events: events.reload, ticket: ticket.reload });
  reloads.current = { mission: mission.reload, events: events.reload, ticket: ticket.reload };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return subscribe(`/api/v1/missions/${key}/stream`, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void reloads.current.mission();
        void reloads.current.events();
        void reloads.current.ticket();
      }, 150);
    });
  }, [key]);

  if (mission.error) return <p className="text-[14px] text-ink-faint">{mission.error.status === 404 ? "This mission isn't in your orbit." : mission.error.detail}</p>;
  if (!mission.data) return <p className="text-[13px] text-ink-faint">Loading…</p>;
  const m = mission.data;
  const file = m.files.find((f) => f.role === tab)!;

  return (
    <div className="mx-auto max-w-[1320px]">
      <Link href="/app/missions" className="text-[13px] text-ink-dim hover:text-ink">
        ← {ROLE_BY_ID[myRole].missionsLabel}
      </Link>
      <Header m={m} onChanged={() => void mission.reload()} />
      <ProceedBanner m={m} onChanged={() => void mission.reload()} onReview={() => setTab("business")} />
      <SeatBanner m={m} seat={myRole} />
      {myRole !== "business" && <VerifyStrip m={m} />}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {!trail && (
            <button type="button" onClick={() => setTrail(true)} className="mb-2 text-[13px] text-ink-faint underline decoration-dotted hover:text-ink">
              Show the full trail — what product, engineering and development wrote
            </button>
          )}
          {trail && (
            <nav className="flex gap-1 overflow-x-auto border-b border-hairline" aria-label="Spec files">
              {ORDER.map((r) => {
                const f = m.files.find((x) => x.role === r)!;
                const role = ROLE_BY_ID[r];
                const active = tab === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTab(r)}
                    aria-current={active ? "page" : undefined}
                    className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[13.5px] ${active ? "text-ink" : "border-transparent text-ink-dim hover:text-ink"}`}
                    style={{ borderColor: active ? role.hue : "transparent" }}
                  >
                    <Planet role={role} size={14} />
                    {f.title}
                    {r !== myRole && <Lock size={11} className="text-ink-dim" aria-label="locked" />}
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[f.status] }} title={SPEC_STATUS_LABEL[f.status]} />
                  </button>
                );
              })}
            </nav>
          )}
          <FilePane m={m} file={file} onChanged={() => void mission.reload()} />
        </div>
        <aside className="space-y-5">
          {myRole === "engineering" ? (
            <MissionBlastRadius m={m} />
          ) : (
            <Panel title="Applications">
              <ul className="space-y-1.5 text-[13px]">
                {m.apps.map((a) => (
                  <li key={a.id}>
                    {me!.capabilities.includes("see_atlas") ? (
                      <Link href={`/app/atlas/apps/${a.id}`} className="text-ink hover:text-[color:var(--role)]">
                        {a.name}
                      </Link>
                    ) : (
                      <span className="text-ink">{a.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <TicketPanel missionKey={m.key} state={ticket.data} onChanged={() => void ticket.reload()} />
          {myRole !== "business" && <LinksPanel m={m} onChanged={() => void mission.reload()} />}
          <FlightStrip missionKey={m.key} version={events.data?.length} />
          <Timeline events={events.data ?? []} />
        </aside>
      </div>
    </div>
  );
}

function Header({ m, onChanged }: { m: Mission; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const setPriority = async (priority: string) => {
    try {
      await api(`/api/v1/missions/${m.key}`, { method: "PATCH", json: { priority } });
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't set priority", "error");
    }
  };
  return (
    <header className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
          <span className="text-[color:var(--role)]">{m.key}</span>
          <span className="text-ink-dim">{m.type}</span>
        </div>
        <h1 className="mt-1 font-display text-[32px] leading-tight text-ink sm:text-[40px]">{m.title}</h1>
        <p className="mt-2 max-w-[760px] text-[15px] italic leading-relaxed text-ink-muted">&ldquo;{m.prompt}&rdquo;</p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {me!.role === "product" ? (
          <select value={m.priority ?? ""} onChange={(e) => void setPriority(e.target.value)} aria-label="Priority" className="h-9 rounded-sm border border-hairline bg-deck px-2 text-[13px] text-ink">
            <option value="" disabled>
              Priority
            </option>
            {["P1", "P2", "P3", "P4"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        ) : (
          m.priority && <span className="rounded-sm border border-hairline px-2 py-1 font-mono text-[12px] text-ink-muted">{m.priority}</span>
        )}
        <div className="text-right">
          <OrbitArc current={STAGE_INDEX[m.stage]} reverse={m.stage === "verifying"} width={140} />
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">{STAGE_LABEL[m.stage]}</div>
        </div>
      </div>
    </header>
  );
}

function ProceedBanner({ m, onChanged, onReview }: { m: Mission; onChanged: () => void; onReview: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!m.awaitingProceed) return null;
  const drafting = m.files.some((f) => f.status === "drafting");
  const creator = ROLE_BY_ID[m.createdAsRole];
  const upstream = m.files.filter((f) => ORDER.indexOf(f.role) < ORDER.indexOf(m.createdAsRole)).map((f) => f.title.toLowerCase());
  const proceed = async () => {
    setBusy(true);
    try {
      await api(`/api/v1/missions/${m.key}/proceed`, { method: "POST" });
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't proceed", "error");
    } finally {
      setBusy(false);
    }
  };
  if (drafting) {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-md border border-[rgba(168,151,240,.35)] bg-[rgba(168,151,240,.07)] px-4 py-3 text-[14px] text-ink" role="status">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#A897F0]" /> NoX is drafting the {upstream.join(", ")} from your request and the knowledge base…
      </div>
    );
  }
  if (me!.role !== m.createdAsRole) {
    return <p className="mt-6 text-[13px] text-ink-faint">Waiting for the {creator.name} who started this mission to decide whether to proceed.</p>;
  }
  return (
    <div className="mt-6 rounded-md border border-[rgba(247,181,66,.4)] bg-[rgba(247,181,66,.07)] p-4" role="alertdialog" aria-label="Proceed without approval?">
      <p className="text-[14.5px] text-ink">
        <strong>No one has approved the {upstream.join(" and ")} yet.</strong> NoX drafted {upstream.length > 1 ? "them" : "it"} from your prompt and the knowledge base. Do you want to proceed anyway?
      </p>
      <p className="mt-1 text-[12.5px] text-ink-faint">The owners of those seats will be asked to confirm; their answer never blocks you.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onReview} className="h-9 rounded-sm border border-hairline px-4 text-[13px] text-ink hover:border-ink-faint">
          Review drafts first
        </button>
        <LiquidMetalButton disabled={busy} onClick={() => void proceed()} className="h-9 rounded-sm px-4 text-[13px] font-semibold disabled:opacity-50">
          {busy ? "…" : "Proceed"}
        </LiquidMetalButton>
      </div>
    </div>
  );
}

function FilePane({ m, file, onChanged }: { m: Mission; file: SpecFile; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const role = ROLE_BY_ID[file.role];
  const mine = me!.role === file.role;
  const [approving, setApproving] = useState(false);
  const [completing, setCompleting] = useState(false);
  // Once approved, your file reads as the rendered spec; the editor opens only on Edit.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (file.status === "approved") setEditing(false);
  }, [file.status, file.version]);

  const complete = async () => {
    setCompleting(true);
    try {
      await api(`/api/v1/missions/${m.key}/complete`, { method: "POST" });
      toast("Marked as completed — your checklist is first", "success");
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't mark it completed", "error");
    } finally {
      setCompleting(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    try {
      await api(`/api/v1/missions/${m.key}/files/${file.role}/approve`, { method: "POST" });
      toast(`${file.title} approved`, "success");
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Couldn't approve", "error");
    } finally {
      setApproving(false);
    }
  };

  const canApprove = mine && ["draft", "ai_drafted", "stale"].includes(file.status) && !(m.awaitingProceed && file.role === m.createdAsRole);

  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[13px]">
          <span className="font-mono text-ink-dim">{file.fileName}</span>
          <span className="rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em]" style={{ borderColor: `${STATUS_COLOR[file.status]}66`, color: STATUS_COLOR[file.status] }}>
            {SPEC_STATUS_LABEL[file.status]}
          </span>
          {file.version > 0 && <span className="text-ink-faint">v{file.version}</span>}
        </div>
        <div className="flex items-center gap-2">
          {mine && m.stage !== "verifying" && <SendBack m={m} onChanged={onChanged} />}
          {mine && file.role === "developer" && m.stage === "build" && (
            <LiquidMetalButton hue={role.hue} disabled={completing} onClick={() => void complete()} className="h-9 rounded-sm px-4 text-[13px] font-semibold disabled:opacity-50">
              {completing ? "Marking…" : "Mark as completed"}
            </LiquidMetalButton>
          )}
          {canApprove && (
            <LiquidMetalButton hue={role.hue} disabled={approving} onClick={() => void approve()} className="h-9 rounded-sm px-4 text-[13px] font-semibold disabled:opacity-50">
              {file.status === "ai_drafted" && m.createdAsRole !== file.role ? "Confirm — this is what I meant" : "Approve"}
            </LiquidMetalButton>
          )}
        </div>
      </div>

      <VerifyPanel m={m} file={file} mine={mine} onChanged={onChanged} />

      {file.status === "ai_drafted" && mine && (
        <p className="mb-4 rounded-sm border border-[rgba(247,181,66,.3)] bg-[rgba(247,181,66,.06)] px-3 py-2 text-[13px] text-ink-muted">
          NoX drafted this for your seat. Edit anything that&rsquo;s off, then confirm it — or leave it and the mission continues on the draft.
        </p>
      )}
      {file.status === "stale" && (
        <p className="mb-4 rounded-sm border border-[rgba(233,113,60,.35)] bg-[rgba(233,113,60,.07)] px-3 py-2 text-[13px] text-[#F3A27E]">
          An upstream file changed after this was approved. Review it against the new version and approve again.
        </p>
      )}

      {file.status === "drafting" ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-md border border-hairline text-[14px] text-ink-faint">
          <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-[#A897F0]" /> NoX is writing the first draft…
        </div>
      ) : file.status === "empty" ? (
        <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-md border border-dashed border-hairline text-center text-[14px] text-ink-faint">
          <Planet role={role} size={32} />
          <p className="mt-3 max-w-[340px]">The {role.name} writes this once the mission reaches their seat. NoX will have a first draft ready.</p>
        </div>
      ) : mine && (file.status !== "approved" || editing) ? (
        <>
          {editing && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-hairline bg-deck px-3 py-2 text-[13px] text-ink-muted">
              <span>Editing your approved file. Saving a change reopens it for approval and asks the files below it to be reviewed again.</span>
              <button type="button" onClick={() => setEditing(false)} className="text-ink underline">
                Close editor
              </button>
            </div>
          )}
          <SpecEditor missionKey={m.key} role={file.role} markdown={file.markdown ?? ""} version={file.version} onSaved={onChanged} />
        </>
      ) : mine ? (
        <article className="rounded-md border border-hairline bg-[rgba(9,11,19,.66)] p-6 sm:p-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">Approved — your final spec</span>
            {m.stage !== "done" && m.stage !== "verifying" && (
              <button type="button" onClick={() => setEditing(true)} className="flex h-8 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[13px] text-ink-muted hover:border-ink-faint hover:text-ink">
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
          <KbMarkdown content={file.markdown ?? ""} />
        </article>
      ) : (
        <article className="rounded-md border border-hairline bg-[rgba(9,11,19,.66)] p-6 sm:p-8">
          <div className="mb-4 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">
            <Lock size={11} /> Locked — only the {role.name} edits this file
          </div>
          <KbMarkdown content={file.markdown ?? ""} />
        </article>
      )}
    </div>
  );
}

function SendBack({ m, onChanged }: { m: Mission; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const earlier = useMemo(() => ORDER.slice(0, ORDER.indexOf(me!.role as RoleId)), [me]);
  const [to, setTo] = useState<RoleId | "">("");
  const [reason, setReason] = useState("");
  if (!earlier.length || m.stage === "done") return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/v1/missions/${m.key}/send-back`, { method: "POST", json: { toRole: to, reason } });
      toast(`Sent back to the ${ROLE_BY_ID[to as RoleId].name}`, "success");
      setOpen(false);
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't send back", "error");
    }
  };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-9 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[13px] text-ink-muted hover:text-ink" aria-expanded={open}>
        <CornerUpLeft size={14} /> Send back
      </button>
      {open && (
        <form onSubmit={submit} className="absolute right-0 top-11 z-20 w-[300px] space-y-2 rounded-md border border-hairline bg-deck p-3 shadow-xl">
          <select required value={to} onChange={(e) => setTo(e.target.value as RoleId)} aria-label="Send back to" className="h-9 w-full rounded-sm border border-hairline bg-void px-2 text-[13px] text-ink">
            <option value="" disabled>
              Send back to…
            </option>
            {earlier.map((r) => (
              <option key={r} value={r}>
                {ROLE_BY_ID[r].name}
              </option>
            ))}
          </select>
          <textarea required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="What needs another look?" aria-label="Reason" className="w-full rounded-sm border border-hairline bg-void p-2 text-[13px] text-ink" />
          <button type="submit" className="h-9 w-full rounded-sm border border-hairline text-[13px] text-ink hover:border-ink-faint">
            Send back
          </button>
        </form>
      )}
    </div>
  );
}

type JiraHit = { key: string; summary: string; status: string; type: string; url: string };

function LinksPanel({ m, onChanged }: { m: Mission; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<"idle" | "link" | "create">("idle");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<JiraHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issueType, setIssueType] = useState("Task");
  const jira = m.links.filter((l) => l.system === "jira");
  const prs = m.links.filter((l) => l.system === "github_pr");

  useEffect(() => {
    if (mode !== "link" || q.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setHits(await api<JiraHit[]>(`/api/v1/integrations/jira/search?q=${encodeURIComponent(q.trim())}`));
      } catch (e) {
        toast(e instanceof ApiError ? e.detail : "Jira search failed", "error");
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q, mode, toast]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done, "success");
      setMode("idle");
      setQ("");
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "Jira didn't accept that", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Jira & pull requests">
      {jira.length > 0 && (
        <ul className="space-y-2.5">
          {jira.map((l) => (
            <li key={l.externalId} className="text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <a href={l.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-[color:var(--role)]">
                  <BrandLogo name="jira" size={13} />
                  {l.externalId} <ExternalLink size={11} />
                </a>
                <span className="flex items-center gap-2">
                  {typeof l.state?.status === "string" && <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10.5px] text-ink-muted">{l.state.status}</span>}
                  <button type="button" aria-label={`Unlink ${l.externalId}`} disabled={busy} onClick={() => void run(() => api(`/api/v1/missions/${m.key}/jira/${l.externalId}`, { method: "DELETE" }), "Unlinked")} className="text-ink-dim hover:text-ink">
                    <X size={13} />
                  </button>
                </span>
              </div>
              {typeof l.state?.summary === "string" && <div className="mt-0.5 truncate text-[12px] text-ink-faint">{l.state.summary}</div>}
              {typeof l.state?.assignee === "string" && <div className="text-[11.5px] text-ink-dim">Assignee: {l.state.assignee}</div>}
              {l.primary && jira.length > 1 && <div className="font-mono text-[10px] uppercase text-ink-dim">primary</div>}
            </li>
          ))}
        </ul>
      )}
      {prs.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3 text-[13px]">
          {prs.map((l) => (
            <li key={l.externalId}>
              <a href={l.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-ink hover:text-[color:var(--role)]">
                <BrandLogo name="github" size={13} />
                <span className="font-mono text-[10.5px] uppercase text-ink-dim">PR</span> {l.externalId} <ExternalLink size={11} />
              </a>
              {typeof l.state?.state === "string" && <span className="ml-2 text-[12px] text-ink-faint">{l.state.state}</span>}
              {(() => {
                const g = l.state?.guard as { compliant?: boolean; violations?: number; rules?: number } | undefined;
                if (!g) return null;
                return (
                  <div className={`mt-0.5 text-[11.5px] ${g.compliant ? "text-[#5FD29F]" : "text-[#F7B542]"}`}>
                    Guard: {g.compliant ? `clear against ${g.rules ?? 0} rules` : `${g.violations} possible conflict${g.violations === 1 ? "" : "s"} — see the PR`}
                  </div>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
      {!jira.length && !prs.length && mode === "idle" && <p className="text-[13px] text-ink-faint">No Jira ticket or pull request linked yet.</p>}

      {mode === "idle" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode("link")} className="h-8 rounded-sm border border-hairline px-3 text-[12.5px] text-ink-muted hover:text-ink">
            <span className="inline-flex items-center gap-1.5"><BrandLogo name="jira" size={12} />Link existing</span>
          </button>
          <button type="button" onClick={() => setMode("create")} className="h-8 rounded-sm border border-hairline px-3 text-[12.5px] text-ink-muted hover:text-ink">
            <span className="inline-flex items-center gap-1.5"><BrandLogo name="jira" size={12} />Create ticket</span>
          </button>
          {me!.role === "developer" && jira.some((l) => l.primary) && (
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              const r = await api<{ created: string[] }>(`/api/v1/missions/${m.key}/jira/subtasks`, { method: "POST" });
              if (!r.created.length) throw new ApiError(409, "Every task already has a sub-task");
            }, "Sub-tasks created from the build spec")} className="h-8 rounded-sm border border-hairline px-3 text-[12.5px] text-ink-muted hover:text-ink">
              Sub-tasks from build spec
            </button>
          )}
        </div>
      )}
      {mode === "link" && (
        <div className="mt-3 space-y-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="APEX-42 or words from the summary" aria-label="Search Jira" className="h-9 w-full rounded-sm border border-hairline bg-void px-3 text-[13px] text-ink outline-none focus:border-[color:var(--role)]" />
          {searching && <p className="text-[12px] text-ink-faint">Searching Jira…</p>}
          <ul className="max-h-[220px] space-y-1 overflow-y-auto">
            {hits.map((h) => (
              <li key={h.key}>
                <button type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/missions/${m.key}/jira/link`, { method: "POST", json: { issueKey: h.key } }), `${h.key} linked`)} className="w-full rounded-sm px-2 py-1.5 text-left text-[12.5px] hover:bg-[rgba(143,160,204,.08)]">
                  <span className="font-mono text-ink">{h.key}</span> <span className="text-ink-muted">{h.summary}</span>
                  <span className="ml-1 text-[11px] text-ink-dim">· {h.status}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setMode("idle")} className="text-[12px] text-ink-dim hover:text-ink">
            Cancel
          </button>
        </div>
      )}
      {mode === "create" && (
        <div className="mt-3 space-y-2 text-[13px]">
          <p className="text-ink-muted">A ticket in the team&rsquo;s Jira project, summarising these spec files, with a link back here.</p>
          <select value={issueType} onChange={(e) => setIssueType(e.target.value)} aria-label="Issue type" className="h-9 w-full rounded-sm border border-hairline bg-void px-2 text-ink">
            {["Task", "Story", "Bug", "Epic"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void run(() => api(`/api/v1/missions/${m.key}/jira/create`, { method: "POST", json: { issueType } }), "Jira ticket created")} className="h-9 rounded-sm px-4 text-[13px] font-semibold text-void disabled:opacity-50" style={{ background: "var(--role)" }}>
              {busy ? "Creating…" : "Create"}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="h-9 px-2 text-ink-dim">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

const EVENT_TEXT: Record<string, (e: MissionEvent) => string> = {
  "mission.created": () => "started the mission",
  "file.drafting": (e) => `is drafting the ${e.payload.role} file`,
  "file.drafted": (e) => `drafted the ${e.payload.role} file`,
  "file.draft_failed": (e) => `couldn't draft the ${e.payload.role} file`,
  "drafts.ready": () => "finished the drafts",
  "mission.proceeded": () => "proceeded past the unapproved AI drafts",
  "file.saved": (e) => `saved the ${e.payload.role} file (v${e.payload.version})`,
  "file.approved": (e) => `approved the ${e.payload.role} file`,
  "mission.sent_back": (e) => `sent it back to ${e.payload.toRole}: “${e.payload.reason}”`,
  "mission.updated": () => "updated the mission",
  "mission.assigned": (e) => (e.payload.assignee ? `assigned it to ${e.payload.assignee}` : "cleared the assignee"),
  "pr.linked": (e) => `linked pull request ${e.payload.pr}`,
  "pr.updated": (e) => `${e.payload.pr} is now ${e.payload.state}`,
  "pr.guarded": (e) => (e.payload.compliant ? `checked ${e.payload.pr}: no rule conflicts` : `checked ${e.payload.pr}: ${e.payload.violations} possible rule conflicts`),
  "pr.guard_failed": (e) => `couldn't read ${e.payload.pr} for the guard`,
  "mission.completed": () => "marked the mission as completed — verification started",
  "verify.progress": (e) => `ticked ${e.payload.checked}/${e.payload.total} on the ${e.payload.role} checklist`,
  "verify.verified": (e) => `verified the ${e.payload.role} file${e.payload.next ? "" : " — mission done"}`,
  "verify.not_met": (e) => `flagged the ${e.payload.role} file as not met: “${e.payload.note}”`,
  "jira.linked": (e) => `linked ${e.payload.key}`,
  "jira.created": (e) => `created ${e.payload.key} in Jira`,
  "jira.unlinked": (e) => `unlinked ${e.payload.key}`,
  "jira.synced": (e) => `moved ${e.payload.key} to ${e.payload.status ?? "its next status"}`,
  "jira.sync_failed": (e) => `couldn't update ${e.payload.key} in Jira`,
  "jira.subtasks": (e) => `created ${(e.payload.created as string[] | undefined)?.length ?? 0} Jira sub-tasks`,
  "jira.updated": (e) => `${e.payload.key}: ${[e.payload.status && `status → ${e.payload.status}`, e.payload.assignee && `assigned to ${e.payload.assignee}`, e.payload.comment && `“${String(e.payload.comment).slice(0, 80)}”`].filter(Boolean).join(", ")} (by ${e.payload.by})`,
  "nox.edit": (e) => `refined the ${e.payload.role} file`,
  "file.reverted": (e) => `undid NoX's edit to the ${e.payload.role} file`,
  "shield.refused": () => "flagged a message as a possible prompt injection (NoX Shield); NoX didn't act on it",
  "chat.message": (e) => (e.payload.author === "nox" ? "replied in the chat" : "asked NoX something"),
  "git.synced": (e) => `saved the ${e.payload.role} file to Git (${e.payload.sha})`,
};

function Timeline({ events }: { events: MissionEvent[] }) {
  return (
    <Panel title="Timeline">
      {events.length ? (
        // Newest first, capped at a fixed height so a busy mission doesn't stretch the page.
        <ol tabIndex={0} aria-label="Timeline entries" className={`${FEED_LIST} space-y-3`}>
          {events.slice(0, 30).map((e) => (
            <li key={e.id} className="text-[12.5px] leading-snug">
              <span className="text-ink">{e.actor ?? "NoX"}</span> <span className="text-ink-muted">{(EVENT_TEXT[e.type] ?? (() => e.type.replaceAll(".", " ")))(e)}</span>
              <div className="font-mono text-[10.5px] text-ink-dim">{new Date(e.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-ink-faint">Quiet so far.</p>
      )}
    </Panel>
  );
}
