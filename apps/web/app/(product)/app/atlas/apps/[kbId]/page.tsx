"use client";

import { Building2, ChevronRight, Code, Compass, ExternalLink, FileText, Folder, LayoutDashboard, List, type LucideIcon, Network, Pin, RefreshCw, RotateCcw, Search, Send, Sparkles, Square, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrandLogo, SourceLogos } from "@/components/app/brand-logo";
import { KbMarkdown } from "@/components/app/markdown";
import { EmptyState, FEED_LIST, KbStatusChip, type KbStatus, Panel, useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { streamPost, subscribe } from "@/lib/app/stream";
import { SOURCE_LABEL, type KbDetail, type KbEvent, type Org, type SourceType } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

type Tab = "overview" | "explore" | "ask";

export default function AppPage() {
  return (
    <Suspense>
      <AppPageInner />
    </Suspense>
  );
}

function AppPageInner() {
  const { kbId } = useParams<{ kbId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const tab = (search.get("tab") as Tab) || "overview";
  const kb = useApi<KbDetail>(`/api/v1/kb/${kbId}`);
  const [live, setLive] = useState<KbEvent[]>([]);

  // Live pipeline events: append to the feed and refresh the record when the status moves.
  const reloadRef = useRef(kb.reload);
  reloadRef.current = kb.reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return subscribe(`/api/v1/kb/${kbId}/stream`, ({ event, data }) => {
      const payload = (data as { payload?: Record<string, unknown> })?.payload ?? {};
      setLive((l) => [{ id: `live-${Date.now()}-${Math.random()}`, eventType: event, payload, createdAt: new Date().toISOString() }, ...l].slice(0, 60));
      clearTimeout(timer);
      timer = setTimeout(() => void reloadRef.current(), event === "status_change" || event === "pr_opened" ? 50 : 1500);
    });
  }, [kbId]);

  const setTab = (t: Tab) => router.replace(`?tab=${t}`, { scroll: false });

  if (kb.error) {
    return (
      <div className="mx-auto max-w-shell">
        <Panel title="Application">
          <EmptyState line={kb.error.status === 404 ? "This application isn't in your orbit." : kb.error.detail} />
        </Panel>
      </div>
    );
  }
  if (!kb.data) return <p className="text-[13px] text-ink-faint">Loading…</p>;
  const app = kb.data;

  return (
    <div className="mx-auto max-w-shell">
      <Breadcrumb orgId={app.orgId} appName={app.appName} />
      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--role)]">Application</span>
          <h1 className="mt-1 font-display text-[36px] leading-tight text-ink sm:text-[42px]">{app.appName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
            <KbStatusChip status={app.status} />
            {app.gitRepoUrl && (
              <a href={app.gitRepoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-ink-faint hover:text-ink">
                <BrandLogo name="github" size={13} />
                {app.gitRepoUrl.split("/").slice(-1)[0]} <ExternalLink size={12} />
              </a>
            )}
            {app.builtWith && <BuiltWith value={app.builtWith} />}
            <SourceLogos types={app.sourceUrls.map((s) => s.type)} size={13} />
          </div>
        </div>
      </header>

      <nav
        className="mt-6 grid grid-cols-3 gap-1.5 rounded-md border border-[rgba(143,160,204,.2)] bg-[linear-gradient(180deg,rgba(21,26,42,.86),rgba(13,16,28,.86))] p-1.5 shadow-[inset_0_1px_0_rgba(236,239,248,.05)]"
        aria-label="Application sections"
      >
        {TABS.map(({ id, label, hint, Icon }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={on ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-sm border px-2 py-2.5 text-center transition-colors sm:flex-row sm:justify-start sm:gap-3 sm:px-4 sm:text-left ${on ? "" : "border-transparent hover:bg-[rgba(236,239,248,.04)]"}`}
              style={
                on
                  ? {
                      borderColor: "color-mix(in srgb, var(--role) 50%, transparent)",
                      background: "linear-gradient(180deg, color-mix(in srgb, var(--role) 20%, transparent), color-mix(in srgb, var(--role) 8%, transparent))",
                      boxShadow: "0 0 22px -10px var(--role), inset 0 1px 0 rgba(236,239,248,.08)",
                    }
                  : undefined
              }
            >
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-sm"
                style={{ background: on ? "var(--role)" : "rgba(143,160,204,.1)", color: on ? "#05060B" : "#A6AEC7" }}
                aria-hidden
              >
                <Icon size={16} strokeWidth={2.1} />
              </span>
              <span className="min-w-0">
                <span className={`block whitespace-nowrap text-[13px] font-semibold sm:text-[14px] ${on ? "text-ink" : "text-ink-muted"}`}>{label}</span>
                <span className="hidden truncate text-[11.5px] text-ink-faint sm:block">{hint}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-6">
        {tab === "overview" && <Overview app={app} live={live} onChanged={() => void kb.reload()} />}
        {tab === "explore" && <Explorer app={app} />}
        {tab === "ask" && <Ask app={app} />}
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; hint: string; Icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", hint: "Lifecycle, sources and activity", Icon: LayoutDashboard },
  { id: "explore", label: "Explore", hint: "Browse the code wiki", Icon: Compass },
  { id: "ask", label: "Ask the KB", hint: "Question the knowledge base", Icon: Sparkles },
];

/** Atlas › organization › team › … › application, walked up from the application's owning org. */
function Breadcrumb({ orgId, appName }: { orgId: string; appName: string }) {
  const orgs = useApi<Org[]>("/api/v1/orgs");
  const path = useMemo(() => {
    const byId = new Map((orgs.data ?? []).map((o) => [o.id, o]));
    const chain: Org[] = [];
    for (let o = byId.get(orgId); o && chain.length < 8; o = o.parentOrgId ? byId.get(o.parentOrgId) : undefined) chain.unshift(o);
    return chain;
  }, [orgs.data, orgId]);
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <Link href="/app/atlas" className="text-ink-dim hover:text-ink">
        Atlas
      </Link>
      {path.map((o, i) => (
        <span key={o.id} className="flex items-center gap-1.5">
          <ChevronRight size={13} className="text-ink-dim" aria-hidden />
          {i === 0 ? (
            <Link href="/app/atlas" className="inline-flex items-center gap-1.5 text-ink-dim hover:text-ink">
              <Building2 size={13} aria-hidden /> {o.name}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ink-dim">
              <Users size={13} aria-hidden /> {o.name}
            </span>
          )}
        </span>
      ))}
      <ChevronRight size={13} className="text-ink-dim" aria-hidden />
      <span className="text-ink-muted" aria-current="page">{appName}</span>
    </nav>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

const TRAJECTORY: { status: KbStatus; label: string; hint: string }[] = [
  { status: "queued", label: "In the Void", hint: "Waiting for a worker" },
  { status: "ingesting", label: "Scanning Nebula", hint: "Reading code and docs" },
  { status: "generating", label: "Compiling Stars", hint: "Writing the code wiki" },
  { status: "in_review", label: "Awaiting Launch", hint: "Pull request open" },
  { status: "published", label: "In Orbit", hint: "Merged and monitored" },
];

function Trajectory({ status }: { status: KbStatus }) {
  const idx = status === "failed" ? -1 : TRAJECTORY.findIndex((t) => t.status === status);
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Knowledge base lifecycle">
      {TRAJECTORY.map((t, i) => {
        const done = idx > i;
        const active = idx === i;
        return (
          <li key={t.status} className="flex flex-col items-center text-center" aria-current={active ? "step" : undefined}>
            <span className="relative flex h-5 w-full items-center justify-center">
              {i > 0 && <span className="absolute left-0 right-1/2 top-1/2 h-px" style={{ background: done || active ? "var(--role)" : "rgba(143,160,204,.2)" }} />}
              {i < TRAJECTORY.length - 1 && <span className="absolute left-1/2 right-0 top-1/2 h-px" style={{ background: done ? "var(--role)" : "rgba(143,160,204,.2)" }} />}
              <span
                className={`relative h-3.5 w-3.5 rounded-full border ${active && i < 4 ? "animate-pulse motion-reduce:animate-none" : ""}`}
                style={{
                  background: done || active ? "var(--role)" : "#05060B",
                  borderColor: done || active ? "var(--role)" : "rgba(143,160,204,.35)",
                  boxShadow: active ? "0 0 12px var(--role)" : undefined,
                }}
              />
            </span>
            <span className={`mt-2 text-[12px] ${active ? "text-ink" : "text-ink-dim"}`}>{t.label}</span>
            <span className="hidden text-[11px] text-ink-faint sm:block">{t.hint}</span>
          </li>
        );
      })}
    </ol>
  );
}

function eventText(e: KbEvent): string {
  const m = e.payload?.message;
  if (typeof m === "string" && m) return m;
  if (e.eventType === "status_change" && typeof e.payload?.status === "string") return `Status → ${e.payload.status}`;
  return e.eventType.replaceAll("_", " ");
}

function Overview({ app, live, onChanged }: { app: KbDetail; live: KbEvent[]; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const canManage = me!.capabilities.includes("manage_sources");
  const [busy, setBusy] = useState<string | null>(null);

  const events = useMemo(() => {
    const stored = [...app.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const seen = new Set(stored.map((e) => `${e.eventType}|${eventText(e)}`));
    return [...live.filter((e) => !seen.has(`${e.eventType}|${eventText(e)}`)), ...stored].slice(0, 40);
  }, [app.events, live]);

  const act = async (key: string, path: string, done: string) => {
    setBusy(key);
    try {
      await api(`/api/v1/kb/${app.id}/${path}`, { method: "POST" });
      toast(done, "success");
      onChanged();
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : "That didn't work", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Panel title="Trajectory">
          <Trajectory status={app.status} />
          {app.status === "failed" && (
            <p className="mt-5 rounded-sm border border-[rgba(233,113,60,.35)] bg-[rgba(233,113,60,.08)] px-3 py-2 text-[13px] text-[#F3A27E]">
              Lost signal: the last run failed. Retry resumes from the failed step; restart runs everything again.
            </p>
          )}
          {app.status === "in_review" && app.prUrl && (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-sm border border-[rgba(247,181,66,.3)] bg-[rgba(247,181,66,.06)] px-4 py-3 text-[13px]">
              <span className="text-ink">The code wiki is ready for review.</span>
              <a href={app.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-nox hover:underline">
                Review the pull request <ExternalLink size={12} />
              </a>
              <span className="text-ink-faint">Merge it, then check status to put {app.appName} in orbit.</span>
            </div>
          )}
          {canManage && (
            <div className="mt-5 flex flex-wrap gap-2">
              <ActionButton busy={busy === "sync"} onClick={() => act("sync", "sync", "Status checked")} icon={<RefreshCw size={14} />}>
                Check PR status
              </ActionButton>
              <ActionButton busy={busy === "updates"} onClick={() => act("updates", "check-updates", "Checked every source for changes")} icon={<RefreshCw size={14} />}>
                Check sources for updates
              </ActionButton>
              {app.status === "failed" && (
                <ActionButton busy={busy === "retry"} onClick={() => act("retry", "retry", "Retrying from the failed step")} icon={<RotateCcw size={14} />}>
                  Retry failed step
                </ActionButton>
              )}
              <ActionButton
                busy={busy === "restart"}
                onClick={() => window.confirm(`Rebuild ${app.appName}'s knowledge base from scratch?`) && void act("restart", "restart", "Restarted from scratch")}
                icon={<RotateCcw size={14} />}
              >
                Restart
              </ActionButton>
            </div>
          )}
        </Panel>

        <Panel title="Flight log">
          {events.length ? (
            // Newest first, capped at a fixed height so a long run doesn't stretch the page.
            <ol tabIndex={0} aria-label="Flight log entries" className={`${FEED_LIST} space-y-2.5`}>
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 text-[13px]">
                  <span className="w-[62px] shrink-0 font-mono text-[11px] text-ink-dim">{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-ink-muted">{eventText(e)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-ink-faint">No activity yet.</p>
          )}
        </Panel>
      </div>

      <div className="space-y-5">
        <SourcesPanel app={app} canManage={canManage} onChanged={onChanged} />
        <QualityPanel app={app} />
      </div>
    </div>
  );
}

function ActionButton({ busy, onClick, icon, children }: { busy: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-sm border border-hairline px-3 text-[13px] text-ink-muted hover:border-[rgba(143,160,204,.35)] hover:text-ink disabled:opacity-50">
      <span className={busy ? "animate-spin" : ""}>{icon}</span>
      {children}
    </button>
  );
}

function SourcesPanel({ app, canManage, onChanged }: { app: KbDetail; canManage: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<SourceType>("confluence");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const check = await api<{ ok: boolean; detail: string }>("/api/v1/sources/validate", { method: "POST", json: { type, url } });
      if (!check.ok) {
        toast(check.detail, "error");
        return;
      }
      await api(`/api/v1/kb/${app.id}/add-source`, { method: "POST", json: { type, url } });
      toast("Source added — NoX is folding it into the knowledge base", "success");
      setUrl("");
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't add the source", "error");
    } finally {
      setBusy(false);
    }
  };
  const shield = useApi<ShieldState>(`/api/v1/kb/${app.id}/shield?v=${encodeURIComponent(app.updatedAt ?? "")}`);
  return (
    <Panel title="Sources" action={<ShieldChip state={shield.data} />}>
      <ul className="space-y-3">
        {app.sourceUrls.map((s) => {
          const mon = app.sourceMonitors.find((m) => (m.sourceUrl || m.repoUrl) === s.url);
          return (
            <li key={s.url} className="text-[13px]">
              <div className="flex items-center gap-2 text-ink">
                <BrandLogo name={s.type} size={15} />
                {SOURCE_LABEL[s.type] ?? s.type}
              </div>
              <div className="truncate pl-[23px] text-ink-faint" title={s.url}>
                {s.url}
              </div>
              {mon?.lastSyncedAt && <div className="pl-[23px] text-[11px] text-ink-dim">Synced {new Date(mon.lastSyncedAt).toLocaleString()}</div>}
            </li>
          );
        })}
      </ul>
      {canManage && (
        <form onSubmit={add} className="mt-4 space-y-2 border-t border-hairline pt-4">
          <div className="relative">
            <BrandLogo name={type} size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
            <select value={type} onChange={(e) => setType(e.target.value as SourceType)} aria-label="Source type" className="h-9 w-full rounded-sm border border-hairline bg-deck pl-8 pr-2 text-[13px] text-ink">
              {(["github", "confluence", "jira", "notion", "slack"] as SourceType[]).map((t) => (
                <option key={t} value={t}>
                  {SOURCE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="Source URL" aria-label="Source URL" className="h-9 min-w-0 flex-1 rounded-sm border border-hairline bg-deck px-3 text-[13px] text-ink outline-none focus:border-[color:var(--role)]" />
            <button type="submit" disabled={busy} className="h-9 rounded-sm border border-hairline px-3 text-[13px] text-ink hover:border-ink-faint disabled:opacity-50">
              {busy ? "…" : "Add"}
            </button>
          </div>
        </form>
      )}
      {shield.data && shield.data.withheld.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-3">
          <p className="text-[12px] text-ink-muted">NoX Shield kept these out of every prompt (possible prompt injection or unsafe content):</p>
          <ul className="mt-2 space-y-1.5">
            {shield.data.withheld.map((w) => (
              <li key={w.source} className="truncate text-[12px] text-[#F3A27E]" title={w.source}>
                {w.source}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

type ShieldState = { mode: "off" | "monitor" | "enforce"; screened: number; withheldCount: number; unscreened: number; withheld: { source: string; category: string; at: string | null }[] };

/** "Shielded" on the sources panel: how many documents Model Armor screened and how many it withheld. */
function ShieldChip({ state }: { state: ShieldState | null }) {
  if (!state || state.mode === "off") return null;
  const color = state.withheldCount ? "#F7B542" : "#5FD29F";
  const label = state.withheldCount ? `Shielded · ${state.withheldCount} withheld` : `Shielded · ${state.screened}`;
  const title = `NoX Shield (${state.mode}): ${state.screened} documents screened, ${state.withheldCount} withheld${state.unscreened ? `, ${state.unscreened} not screened` : ""}`;
  return (
    <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]" style={{ borderColor: `${color}55`, color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function QualityPanel({ app }: { app: KbDetail }) {
  const lint = useApi<{ is_valid?: boolean; errors?: unknown[]; warnings?: unknown[]; total_files?: number }>(app.status === "queued" ? null : `/api/v1/kb/${app.id}/lint`);
  const digest = useApi<{ digest?: string; content?: string }>(app.status === "queued" ? null : `/api/v1/kb/${app.id}/digest`);
  const brief = digest.data?.digest ?? digest.data?.content;
  return (
    <Panel title="Quality gate">
      {lint.data ? (
        <p className="text-[13px] text-ink-muted">
          {lint.data.total_files ?? 0} pages · <span className={(lint.data.errors?.length ?? 0) ? "text-[#F3A27E]" : "text-verify"}>{lint.data.errors?.length ?? 0} errors</span> ·{" "}
          {lint.data.warnings?.length ?? 0} warnings
        </p>
      ) : (
        <p className="text-[13px] text-ink-faint">Available once the wiki is compiled.</p>
      )}
      {brief && (
        <details className="mt-4 border-t border-hairline pt-3">
          <summary className="cursor-pointer text-[13px] text-ink">Agent brief (&lt;4k chars)</summary>
          <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink-faint">{brief}</pre>
        </details>
      )}
    </Panel>
  );
}

// ── Explore ──────────────────────────────────────────────────────────────────

type Pin = { id: string; pagePath: string; text: string; authorName: string | null; createdAt: string | null };

function Explorer({ app }: { app: KbDetail }) {
  const { me } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const search = useSearchParams();
  const tree = useApi<{ tree: { path: string; type: string }[] }>(`/api/v1/kb/${app.id}/tree`);
  const pins = useApi<Pin[]>(`/api/v1/kb/${app.id}/pins`);
  const pages = useMemo(() => (tree.data?.tree ?? []).filter((t) => t.type === "blob" && t.path.endsWith(".md")).map((t) => t.path), [tree.data]);
  const [path, setPath] = useState<string | null>(search.get("page"));
  const [content, setContent] = useState<string | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);

  const open = useCallback(
    async (p: string) => {
      setPath(p);
      setLoadingPage(true);
      try {
        const res = await api<{ content: string }>(`/api/v1/kb/${app.id}/file?path=${encodeURIComponent(p)}`);
        setContent(res.content);
      } catch (e) {
        setContent(e instanceof ApiError && e.status === 404 ? `# Not found\n\n\`${p}\` isn't in this knowledge base.` : "# Couldn't load this page");
      } finally {
        setLoadingPage(false);
      }
    },
    [app.id],
  );

  useEffect(() => {
    if (!path && pages.length) void open(pages.includes("index.md") ? "index.md" : pages[0]);
    else if (path && content === null) void open(path);
  }, [pages, path, content, open]);

  const openCross = async (appSlug: string, page: string) => {
    try {
      const res = await api<{ kb_id: string }>(`/api/v1/kb/resolve?target=${encodeURIComponent(appSlug)}`);
      router.push(`/app/atlas/apps/${res.kb_id}?tab=explore&page=${encodeURIComponent(page)}`);
    } catch {
      toast(`${appSlug} isn't onboarded in your orbit`, "error");
    }
  };

  const groups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const p of pages) {
      const top = p.includes("/") ? p.split("/")[0] : "";
      g.set(top, [...(g.get(top) ?? []), p]);
    }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [pages]);

  if (tree.loading) return <p className="text-[13px] text-ink-faint">Loading the wiki…</p>;
  if (!pages.length) return <Panel title="Code wiki"><EmptyState line="The code wiki appears here once NoX has compiled it." /></Panel>;

  const pagePins = (pins.data ?? []).filter((p) => p.pagePath === path);

  return (
    <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
      <nav aria-label="Wiki pages" className="rounded-md border border-hairline bg-[rgba(9,11,19,.66)] p-3 lg:max-h-[75vh] lg:overflow-y-auto">
        {groups.map(([group, items]) => (
          <div key={group || "root"} className="mb-3">
            {group && (
              <div className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">
                <Folder size={12} /> {group}
              </div>
            )}
            {items.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void open(p)}
                aria-current={p === path ? "page" : undefined}
                className={`flex w-full items-center gap-1.5 truncate rounded-sm px-2 py-1.5 text-left text-[13px] ${p === path ? "bg-[rgba(143,160,204,.1)] text-[color:var(--role)]" : "text-ink-muted hover:text-ink"}`}
              >
                <FileText size={12} className="shrink-0" />
                <span className="truncate">{p.split("/").pop()?.replace(/\.md$/, "")}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="space-y-5">
        <article className="rounded-md border border-hairline bg-[rgba(9,11,19,.66)] p-6 sm:p-8" aria-busy={loadingPage}>
          <div className="mb-4 font-mono text-[11px] text-ink-dim">{path}</div>
          {content !== null && <KbMarkdown content={content} onOpenPage={(p) => void open(p)} onOpenCrossKb={(a, p) => void openCross(a, p)} />}
        </article>
        {path && <PinsPanel kbId={app.id} path={path} pins={pagePins} onChanged={() => { void pins.reload(); void open(path); }} />}
      </div>
    </div>
  );
}

function PinsPanel({ kbId, path, pins, onChanged }: { kbId: string; path: string; pins: Pin[]; onChanged: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const canPin = me!.capabilities.includes("pin_correction");
  const [text, setText] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/v1/kb/${kbId}/pins`, { method: "POST", json: { pagePath: path, text } });
      toast("Correction pinned — it survives every future recompile", "success");
      setText("");
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't pin", "error");
    }
  };
  const remove = async (id: string) => {
    await api(`/api/v1/kb/${kbId}/pins/${id}`, { method: "DELETE" });
    onChanged();
  };
  if (!canPin && !pins.length) return null;
  return (
    <Panel title="Human corrections">
      {pins.length > 0 && (
        <ul className="mb-4 space-y-2">
          {pins.map((p) => (
            <li key={p.id} className="flex items-start gap-2 text-[13px]">
              <Pin size={13} className="mt-0.5 shrink-0 text-[color:var(--role)]" />
              <span className="flex-1 text-ink-muted">
                {p.text} <span className="text-ink-faint">— {p.authorName}</span>
              </span>
              {canPin && (
                <button type="button" aria-label="Remove correction" onClick={() => void remove(p.id)} className="text-ink-dim hover:text-ink">
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canPin && (
        <form onSubmit={submit} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} required minLength={3} placeholder="Something this page gets wrong…" aria-label="Correction" className="h-9 min-w-0 flex-1 rounded-sm border border-hairline bg-deck px-3 text-[13px] text-ink outline-none focus:border-[color:var(--role)]" />
          <button type="submit" className="flex h-9 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[13px] text-ink hover:border-ink-faint">
            <Pin size={13} /> Pin
          </button>
        </form>
      )}
    </Panel>
  );
}

/** Provenance of the current pages: NoX's cloud agents, or NoX Local (Gemma on a developer's machine). */
function BuiltWith({ value }: { value: string }) {
  const [where, ...rest] = value.split(":");
  const model = rest.join(":");
  const local = where === "local";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-0.5 font-mono text-[11px] text-ink-faint"
      title={local ? "Built on a developer's machine with NoX Local: the source code never left it. NoX received only the Markdown pages." : "Built by NoX's agent team on Gemini"}
    >
      <BrandLogo name={local ? "ollama" : "gemini"} size={12} />
      {local ? `Built locally · ${model} · code never left the laptop` : `Built by NoX's agents · ${model}`}
    </span>
  );
}

// ── Ask ──────────────────────────────────────────────────────────────────────

type AskStep = { tool: string; label: string };
type AskTurn = { q: string; steps: AskStep[]; a: string; refs: string[]; usage?: string; done: boolean; error?: string };

const STEP_ICON: Record<string, LucideIcon> = {
  search_kb: Search,
  read_kb_page: FileText,
  list_pages: List,
  find_interfaces: Network,
  grep_source: Code,
  read_source_file: Code,
};

function Ask({ app }: { app: KbDetail }) {
  const { me } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const busy = turns.length > 0 && !turns[turns.length - 1].done;
  const sessionId = useRef(`tab-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  const update = (fn: (t: AskTurn) => AskTurn) => setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? fn(t) : t)));

  const openRef = async (ref: string) => {
    const [refApp, ...rest] = ref.replace(/^kb:/, "").split("/");
    const page = `${rest.join("/") || "index"}`.replace(/(\.md)?$/, ".md");
    if (refApp === app.appName) {
      router.replace(`?tab=explore&page=${encodeURIComponent(page)}`, { scroll: false });
      return;
    }
    try {
      const res = await api<{ kb_id: string }>(`/api/v1/kb/resolve?target=${encodeURIComponent(refApp)}`);
      router.push(`/app/atlas/apps/${res.kb_id}?tab=explore&page=${encodeURIComponent(page)}`);
    } catch {
      toast(`${refApp} isn't onboarded in your orbit`, "error");
    }
  };

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setQ("");
    setTurns((ts) => [...ts, { q: question, steps: [], a: "", refs: [], done: false }]);
    const controller = new AbortController();
    stop.current = controller;
    try {
      await streamPost(
        `/api/v1/kb/${app.id}/ask`,
        { question, session_id: sessionId.current },
        ({ event, data }) => {
          const d = data as Record<string, unknown>;
          if (event === "step") update((t) => ({ ...t, steps: [...t.steps, { tool: String(d.tool), label: String(d.label) }] }));
          else if (event === "delta") update((t) => ({ ...t, a: t.a + String(d.text ?? "") }));
          else if (event === "citations") update((t) => ({ ...t, refs: (d.refs as string[]) ?? [] }));
          else if (event === "usage") update((t) => ({ ...t, usage: String(d.line ?? "") }));
          else if (event === "error") update((t) => ({ ...t, error: String(d.message ?? "NoX couldn't answer that."), done: true }));
          else if (event === "done") update((t) => ({ ...t, a: t.a || String(d.text ?? ""), done: true }));
        },
        controller.signal,
      );
      update((t) => ({ ...t, done: true }));
    } catch (err) {
      if (controller.signal.aborted) update((t) => ({ ...t, done: true }));
      else update((t) => ({ ...t, error: err instanceof Error ? err.message : "Couldn't reach NoX.", done: true }));
    }
  };

  return (
    <div className="mx-auto max-w-[820px]">
      {turns.length === 0 && (
        <EmptyState line={`Ask anything about ${app.appName}: its endpoints, data model, decisions or what depends on it. NoX looks it up in the code wiki, the contract map and the code, and cites what it read.`} />
      )}
      <ol className="space-y-6" aria-live="polite">
        {turns.map((t, i) => {
          const last = i === turns.length - 1;
          return (
            <li key={i}>
              <p className="ml-auto w-fit max-w-[85%] rounded-md bg-[rgba(143,160,204,.1)] px-4 py-2.5 text-[14px] text-ink">{t.q}</p>
              <div className="mt-3 rounded-md border border-hairline bg-[rgba(9,11,19,.66)] p-5">
                {t.steps.length > 0 && (
                  <ul className="mb-3 flex flex-col gap-1" aria-label="What NoX looked up">
                    {t.steps.map((s, j) => {
                      const Icon = STEP_ICON[s.tool] ?? Sparkles;
                      const running = last && !t.done && j === t.steps.length - 1 && !t.a;
                      return (
                        <li key={j} className="flex items-center gap-2 font-mono text-[11.5px] text-ink-faint">
                          {s.tool === "get_jira_issue" ? (
                            <BrandLogo name="jira" size={12} className={running ? "animate-pulse" : ""} />
                          ) : (
                            <Icon size={12} className={running ? "animate-pulse" : ""} style={{ color: "var(--role)" }} aria-hidden />
                          )}
                          <span className={running ? "animate-pulse" : ""}>{s.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {t.a ? (
                  <KbMarkdown content={t.a} onOpenPage={(p) => void openRef(`${app.appName}/${p}`)} onOpenCrossKb={(a, p) => void openRef(`${a}/${p}`)} />
                ) : !t.done ? (
                  <p className="animate-pulse text-[13px] text-ink-faint">{t.steps.length ? "Reading…" : "Thinking…"}</p>
                ) : null}
                {t.error && <p className="mt-2 text-[13px] italic text-ink-faint">{t.error}</p>}
                {t.done && t.refs.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
                    <span className="mr-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim">Sources</span>
                    {t.refs.map((r) => (
                      <button key={r} type="button" onClick={() => void openRef(r)} className="rounded-sm border border-hairline px-2 py-0.5 font-mono text-[11px] text-ink-faint hover:border-[color:var(--role)] hover:text-ink">
                        {r.startsWith(`${app.appName}/`) ? r.slice(app.appName.length + 1) : r}
                      </button>
                    ))}
                  </div>
                )}
                {t.done && t.usage && <p className="mt-2 text-right font-mono text-[10.5px] text-ink-dim">{t.usage}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <form onSubmit={ask} className="sticky bottom-20 mt-6 flex gap-2 lg:bottom-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask ${app.appName}…`} aria-label="Question" disabled={busy} className="h-11 min-w-0 flex-1 rounded-sm border border-hairline bg-deck px-4 text-[14px] text-ink outline-none focus:border-[color:var(--role)] disabled:opacity-60" />
        {busy ? (
          <button type="button" onClick={() => stop.current?.abort()} aria-label="Stop" className="flex h-11 w-11 items-center justify-center rounded-sm border border-hairline text-ink">
            <Square size={14} />
          </button>
        ) : (
          <button type="submit" aria-label="Ask" className="flex h-11 w-11 items-center justify-center rounded-sm text-void" style={{ background: "var(--role)" }}>
            <Send size={16} />
          </button>
        )}
      </form>
    </div>
  );
}
