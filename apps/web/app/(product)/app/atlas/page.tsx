"use client";

import { Building2, GitFork, Plus, Search, Settings2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { SourceLogos } from "@/components/app/brand-logo";
import { appHue, ContractMap } from "@/components/app/contract-map";
import { EmptyState, KbStatusChip, PageHeader, Panel, useToast } from "@/components/app/ui";
import { LiquidMetalLink } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID } from "@/lib/app/roles";
import type { Kb, Members, Org, OrgMap, OrgTree } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";
import { C } from "@/lib/app/palette";

export default function AtlasPage() {
  const { me } = useAuth();
  const caps = me!.capabilities;
  const role = ROLE_BY_ID[me!.role!];

  if (!caps.includes("see_atlas")) {
    return (
      <div className="mx-auto max-w-shell">
        <PageHeader eyebrow="Atlas" title="Not part of this seat" />
        <Panel title="Atlas" className="mt-8">
          <EmptyState line="The atlas — onboarding applications and their knowledge bases — belongs to product, engineering and development. Switch roles to explore it." />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-shell">
      <PageHeader
        eyebrow="Atlas"
        title="Your applications, mapped"
        lead="Every team, the applications it owns, and the code wiki NoX keeps in step with each one."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/atlas/connectors" className="inline-flex h-10 items-center gap-2 rounded-sm border border-hairline px-4 text-[13px] text-ink-muted hover:text-ink">
              <Settings2 size={15} /> Connectors
            </Link>
            {caps.includes("onboard_app") && (
              <LiquidMetalLink
                href="/app/atlas/new"
                hue={role.hue}
                className="inline-flex h-10 items-center gap-2 rounded-sm px-4 text-[13px] font-semibold"
              >
                <Plus size={15} strokeWidth={2.4} /> Onboard application
              </LiquidMetalLink>
            )}
          </div>
        }
      />
      <OrgExplorer />
    </div>
  );
}

function OrgExplorer() {
  const { me } = useAuth();
  const canManageOrgs = me!.capabilities.includes("manage_orgs");
  const orgs = useApi<Org[]>("/api/v1/orgs");
  const roots = useMemo(() => {
    const ids = new Set((orgs.data ?? []).map((o) => o.id));
    return (orgs.data ?? []).filter((o) => !o.parentOrgId || !ids.has(o.parentOrgId));
  }, [orgs.data]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && roots.length) setSelected(roots[0].id);
  }, [roots, selected]);

  if (orgs.loading) return <p className="mt-8 text-[13px] text-ink-faint">Loading the atlas…</p>;
  if (orgs.error) return <p className="mt-8 text-[13px] text-[color:var(--coral-ink)]">Couldn&rsquo;t load organizations: {orgs.error.detail}</p>;

  if (!roots.length) {
    return (
      <Panel title="Organizations" className="mt-8">
        <EmptyState line={canManageOrgs ? "No organizations yet. Chart your first one." : "You're not a member of any organization yet. An engineering lead can invite you."}>
          {canManageOrgs && <NewOrgForm onCreated={() => void orgs.reload()} />}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="mt-8 space-y-5">
      {roots.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Organizations">
          {roots.map((o) => {
            const on = selected === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setSelected(o.id)}
                className="flex items-center gap-2 rounded-md border px-3.5 py-2 text-[13px] transition-colors"
                style={{
                  borderColor: on ? "color-mix(in srgb, var(--role) 55%, transparent)" : "rgb(var(--line)/.2)",
                  background: on ? "color-mix(in srgb, var(--role) 12%, transparent)" : "rgb(var(--raise)/.6)",
                  color: on ? "var(--ink)" : "var(--ink-muted)",
                }}
              >
                <Building2 size={14} style={{ color: on ? "var(--role)" : undefined }} />
                {o.name}
              </button>
            );
          })}
        </div>
      )}
      {selected && <OrgCanvas key={selected} orgId={selected} canManageOrgs={canManageOrgs} onChanged={() => void orgs.reload()} />}
    </div>
  );
}

// ── The organization canvas: org → teams → sub-teams, applications as cards ──

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Tally = { teams: number; apps: number; orbit: number };

function tally(node: OrgTree): Tally {
  return node.children.reduce<Tally>(
    (t, c) => {
      const sub = tally(c);
      return { teams: t.teams + 1 + sub.teams, apps: t.apps + sub.apps, orbit: t.orbit + sub.orbit };
    },
    { teams: 0, apps: node.apps.length, orbit: node.apps.filter((a) => a.status === "published").length },
  );
}

/** The subtree matching `q`: a team whose name matches keeps everything; otherwise only matching applications. */
function prune(node: OrgTree, q: string): OrgTree | null {
  if (!q || node.name.toLowerCase().includes(q)) return node;
  const apps = node.apps.filter((a) => a.appName.toLowerCase().includes(q));
  const children = node.children.map((c) => prune(c, q)).filter((c): c is OrgTree => c !== null);
  return apps.length || children.length ? { ...node, apps, children } : null;
}

function OrgCanvas({ orgId, canManageOrgs, onChanged }: { orgId: string; canManageOrgs: boolean; onChanged: () => void }) {
  const tree = useApi<OrgTree>(`/api/v1/orgs/${orgId}/tree`);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (tree.data ? prune(tree.data, q) : null), [tree.data, q]);
  const totals = useMemo(() => (tree.data ? tally(tree.data) : null), [tree.data]);
  const changed = () => {
    void tree.reload();
    onChanged();
  };

  if (!tree.data || !totals) {
    return (
      <Panel title="Organization">
        {tree.error ? <p className="text-[13px] text-[color:var(--coral-ink)]">{tree.error.detail}</p> : <p className="text-[13px] text-ink-faint">Charting the organization…</p>}
      </Panel>
    );
  }
  const org = tree.data;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <section
          className="overflow-hidden rounded-md surface-panel"
          aria-label={org.name}
        >
          <header
            className="flex flex-col gap-4 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            style={{
              background: "linear-gradient(90deg, color-mix(in srgb, var(--role) 12%, transparent), transparent 75%)",
              borderColor: "color-mix(in srgb, var(--role) 22%, rgb(var(--line)/.14))",
            }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md border"
                style={{ borderColor: "color-mix(in srgb, var(--role) 45%, transparent)", background: "color-mix(in srgb, var(--role) 14%, transparent)", color: "var(--role)" }}
                aria-hidden
              >
                <Building2 size={18} />
              </span>
              <div className="min-w-0">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-faint">Organization</span>
                <h2 className="truncate font-display text-[24px] leading-tight text-ink">{org.name}</h2>
              </div>
            </div>
            <dl className="flex gap-5 text-[12px]">
              <Stat label="Teams" value={totals.teams} />
              <Stat label="Applications" value={totals.apps} />
              <Stat label="In orbit" value={totals.orbit} tone={C.verifyInk} />
            </dl>
          </header>

          <div className="space-y-4 p-5">
            <label className="flex h-10 items-center gap-2 rounded-sm border border-hairline bg-deck px-3 focus-within:border-[color:var(--role)]">
              <Search size={15} className="text-ink-dim" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find an application or team"
                aria-label="Find an application or team"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-dim"
              />
            </label>

            {shown ? (
              <TeamBody node={shown} depth={0} canManageOrgs={canManageOrgs} onChanged={changed} filtering={!!q} />
            ) : (
              <p className="py-6 text-center text-[13px] text-ink-faint">Nothing in {org.name} matches &ldquo;{query.trim()}&rdquo;.</p>
            )}
          </div>
        </section>
        <MapPanel orgId={orgId} />
      </div>

      <div className="space-y-5">
        {/* A jump list; with a handful of teams the canvas already shows the whole chart. */}
        {totals.teams > 4 && (
          <Panel title="Org chart">
            <Outline node={org} depth={0} />
          </Panel>
        )}
        <MembersPanel orgId={orgId} />
        {canManageOrgs && (
          <Panel title="New organization">
            <NewOrgForm onCreated={onChanged} />
          </Panel>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-dim">{label}</dt>
      <dd className="font-display text-[22px] leading-none text-ink" style={tone && value ? { color: tone } : undefined}>
        {value}
      </dd>
    </div>
  );
}

/** A team's contents: its applications as a card grid, then its sub-teams as boxes. */
function TeamBody({ node, depth, canManageOrgs, onChanged, filtering }: { node: OrgTree; depth: number; canManageOrgs: boolean; onChanged: () => void; filtering: boolean }) {
  const { me } = useAuth();
  const canOnboard = me!.capabilities.includes("onboard_app");
  const [adding, setAdding] = useState(false);
  // Only a team with no applications anywhere beneath it gets a dashed tile; any other team offers onboarding in its header.
  const offerOnboard = !filtering && canOnboard && tally(node).apps === 0 && (depth > 0 || node.children.length === 0);
  const showGrid = node.apps.length > 0 || offerOnboard || (!filtering && node.children.length === 0);

  return (
    <div className="space-y-4">
      {showGrid && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
          {node.apps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
          {offerOnboard && (
            <Link
              href={`/app/atlas/new?org=${node.id}`}
              className="flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-[rgb(var(--line)/.25)] text-[12.5px] text-ink-dim transition-colors hover:border-[color:var(--role)] hover:text-[color:var(--role)]"
            >
              <Plus size={16} />
              Onboard into {node.name}
            </Link>
          )}
          {!filtering && !canOnboard && node.apps.length === 0 && node.children.length === 0 && (
            <p className="py-4 text-[13px] text-ink-faint">No applications onboarded here yet.</p>
          )}
        </div>
      )}

      {node.children.length > 0 && (
        <div className={depth === 0 ? "space-y-4" : "grid gap-4 xl:grid-cols-2"}>
          {node.children.map((c) => (
            <TeamBox key={c.id} node={c} depth={depth + 1} canManageOrgs={canManageOrgs} onChanged={onChanged} filtering={filtering} />
          ))}
        </div>
      )}

      {canManageOrgs && !filtering && (
        <div>
          {adding ? (
            <NewOrgForm parentId={node.id} onCreated={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-[12px] text-ink-dim hover:text-ink">
              <Plus size={13} /> {depth === 0 ? `Add a team to ${node.name}` : `Add a sub-team under ${node.name}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One team, drawn as a box. Top-level teams are lifted; sub-teams sit inset as darker wells. */
function TeamBox({ node, depth, canManageOrgs, onChanged, filtering }: { node: OrgTree; depth: number; canManageOrgs: boolean; onChanged: () => void; filtering: boolean }) {
  const { me } = useAuth();
  const canOnboard = me!.capabilities.includes("onboard_app");
  const t = tally(node);
  const top = depth === 1;
  return (
    <section
      id={`team-${node.id}`}
      className="scroll-mt-24 overflow-hidden rounded-md border"
      style={{
        borderColor: top ? "rgb(var(--line)/.22)" : "rgb(var(--line)/.16)",
        background: top ? "rgb(var(--glint)/.025)" : "rgb(var(--void-rgb)/.45)",
      }}
      aria-label={node.name}
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: top ? "var(--role)" : "color-mix(in srgb, var(--role) 45%, var(--ink-dim))" }} aria-hidden />
          {top ? <Users size={15} className="shrink-0 text-ink-muted" aria-hidden /> : <GitFork size={14} className="shrink-0 rotate-180 text-ink-dim" aria-hidden />}
          <h3 className={`truncate ${top ? "text-[15px] font-semibold" : "text-[14px] font-medium"} text-ink`}>{node.name}</h3>
        </div>
        <span className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
            {t.apps} app{t.apps === 1 ? "" : "s"}
            {t.teams > 0 && ` · ${t.teams} team${t.teams === 1 ? "" : "s"}`}
          </span>
          {canOnboard && !filtering && t.apps > 0 && (
            <Link
              href={`/app/atlas/new?org=${node.id}`}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-hairline px-2 text-[12px] text-ink-muted hover:border-[color:var(--role)] hover:text-[color:var(--role)]"
              aria-label={`Onboard an application into ${node.name}`}
            >
              <Plus size={13} /> Onboard
            </Link>
          )}
        </span>
      </header>
      <div className="p-4">
        <TeamBody node={node} depth={depth} canManageOrgs={canManageOrgs} onChanged={onChanged} filtering={filtering} />
      </div>
    </section>
  );
}

function AppCard({ app }: { app: Kb }) {
  const hue = appHue(app.id);
  const repo = app.gitRepoUrl?.split("/").filter(Boolean).slice(-1)[0];
  const sources = app.sourceUrls?.length ?? 0;
  return (
    <Link
      href={`/app/atlas/apps/${app.id}`}
      className="group relative flex min-h-[112px] flex-col justify-between gap-3 overflow-hidden rounded-md border border-[rgb(var(--line)/.18)] bg-[linear-gradient(160deg,rgb(var(--raise)/.9),rgb(var(--raise-lo)/.9))] p-3.5 transition-all hover:-translate-y-0.5 hover:border-[color:var(--role)] hover:shadow-[0_12px_28px_-16px_var(--role)] motion-reduce:hover:translate-y-0"
    >
      <span className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[.12] blur-xl" style={{ background: hue }} aria-hidden />
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 h-7 w-7 shrink-0 rounded-full"
          style={{ background: `radial-gradient(circle at 32% 30%, color-mix(in srgb, ${hue} 35%, #fff) 0%, ${hue} 42%, color-mix(in srgb, ${hue} 45%, #05060B) 100%)`, boxShadow: `0 0 14px -4px ${hue}` }}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-ink group-hover:text-[color:var(--role)]" title={app.appName}>
            {app.appName}
          </p>
          <p className="truncate text-[11.5px] text-ink-faint" title={`${repo ?? "No repository"} · updated ${new Date(app.updatedAt).toLocaleString()}`}>
            {sources} source{sources === 1 ? "" : "s"} · {ago(app.updatedAt)}
          </p>
          <SourceLogos types={(app.sourceUrls ?? []).map((s) => s.type)} size={13} className="mt-2" />
        </div>
      </div>
      <div>
        <KbStatusChip status={app.status} />
      </div>
    </Link>
  );
}

/** A compact org chart in the side rail; each team jumps to its box. */
function Outline({ node, depth }: { node: OrgTree; depth: number }) {
  const t = tally(node);
  const jump = () => document.getElementById(`team-${node.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className={depth ? "ml-2 border-l border-hairline pl-3" : ""}>
      {depth === 0 ? (
        <p className="mb-1 flex items-center justify-between gap-2 text-[13px] font-medium text-ink">
          <span className="flex items-center gap-2 truncate"><Building2 size={13} style={{ color: "var(--role)" }} aria-hidden />{node.name}</span>
          <span className="font-mono text-[11px] text-ink-dim">{t.apps}</span>
        </p>
      ) : (
        <button type="button" onClick={jump} className="flex w-full items-center justify-between gap-2 rounded-sm py-1 text-left text-[13px] text-ink-muted hover:text-ink">
          <span className="truncate">{node.name}</span>
          <span className="font-mono text-[11px] text-ink-dim">{t.apps}</span>
        </button>
      )}
      {node.children.map((c) => (
        <Outline key={c.id} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function NewOrgForm({ parentId, onCreated, onCancel }: { parentId?: string; onCreated: () => void; onCancel?: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/orgs", { method: "POST", json: { name: name.trim(), slug: slugify(name), parentOrgId: parentId ?? null } });
      toast(`${name.trim()} added to the atlas`, "success");
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Couldn't create it.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          placeholder={parentId ? "Team or division name" : "Organization name"}
          aria-label={parentId ? "Team name" : "Organization name"}
          className="h-9 min-w-0 flex-1 rounded-sm border border-hairline bg-deck px-3 text-[13px] text-ink outline-none focus:border-[color:var(--role)]"
        />
        <button type="submit" disabled={busy || name.trim().length < 2} className="h-9 rounded-sm border border-hairline px-3 text-[13px] text-ink hover:border-ink-faint disabled:opacity-50">
          {busy ? "…" : "Add"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-9 px-2 text-[13px] text-ink-dim">
            Cancel
          </button>
        )}
      </div>
      {error && <p className="text-[12px] text-[color:var(--coral-ink)]">{error}</p>}
    </form>
  );
}

function MembersPanel({ orgId }: { orgId: string }) {
  const { me } = useAuth();
  const toast = useToast();
  const canInvite = me!.capabilities.includes("invite_members");
  const members = useApi<Members>(`/api/v1/orgs/${orgId}/members`);
  const [email, setEmail] = useState("");
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api<{ status: string; email: string }>(`/api/v1/orgs/${orgId}/members`, { method: "POST", json: { email } });
      toast(res.status === "member" ? `${res.email} added` : `Invite saved — ${res.email} joins on first sign-in`, "success");
      setEmail("");
      void members.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't invite", "error");
    }
  };
  return (
    <Panel title="Members">
      {members.data ? (
        <ul className="space-y-2 text-[13px]">
          {members.data.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-ink">{m.name || m.email}</span>
              <span className="truncate text-ink-faint">{m.email}</span>
            </li>
          ))}
          {members.data.invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 text-ink-faint">
              <span className="truncate">{i.email}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em]">invited</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      )}
      {canInvite && (
        <form onSubmit={invite} className="mt-4 flex gap-2 border-t border-hairline pt-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            aria-label="Invite by email"
            className="h-9 min-w-0 flex-1 rounded-sm border border-hairline bg-deck px-3 text-[13px] text-ink outline-none focus:border-[color:var(--role)]"
          />
          <button type="submit" className="flex h-9 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[13px] text-ink hover:border-ink-faint">
            <UserPlus size={14} /> Invite
          </button>
        </form>
      )}
    </Panel>
  );
}

function MapPanel({ orgId }: { orgId: string }) {
  const map = useApi<OrgMap>(`/api/v1/orgs/${orgId}/map`);
  return (
    <Panel title="Contract map">
      {map.loading ? (
        <p className="text-[13px] text-ink-faint">Charting…</p>
      ) : map.data && map.data.apps.length ? (
        <ContractMap map={map.data} />
      ) : (
        <EmptyState line="Once applications are onboarded, the interfaces they expose and the links between them appear here." />
      )}
    </Panel>
  );
}
