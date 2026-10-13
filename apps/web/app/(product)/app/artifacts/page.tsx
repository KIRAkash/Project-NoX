"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { KbMarkdown } from "@/components/app/markdown";
import { EmptyState, PageHeader, Panel } from "@/components/app/ui";
import { useApi } from "@/lib/app/use-api";
import { ROLE_BY_ID, ROLES, RoleId } from "@/lib/app/roles";
import { SPEC_STATUS_LABEL, SpecItem, SpecStatus } from "@/lib/app/types";

const STATUS_OPTIONS: { id: SpecStatus | "all"; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "approved", label: "Approved" },
  { id: "draft", label: "Draft" },
  { id: "ai_drafted", label: "AI-drafted" },
  { id: "stale", label: "Stale" },
];

export default function ArtifactsPage() {
  const [selectedRole, setSelectedRole] = useState<RoleId | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<SpecStatus | "all">("all");
  const [selectedAppId, setSelectedAppId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [previewSpec, setPreviewSpec] = useState<SpecItem | null>(null);

  // Fetch available applications for app filter dropdown
  const { data: kbs } = useApi<{ id: string; appName: string }[]>("/api/v1/kb");

  // Construct query string for specs API
  const params = new URLSearchParams();
  if (selectedRole !== "all") params.set("role", selectedRole);
  if (selectedStatus !== "all") params.set("status", selectedStatus);
  if (selectedAppId !== "all") params.set("app_id", selectedAppId);
  if (searchQuery.trim()) params.set("q", searchQuery.trim());

  const apiPath = `/api/v1/specs${params.toString() ? `?${params.toString()}` : ""}`;
  const { data: specs, loading, error, reload } = useApi<SpecItem[]>(apiPath);

  // Keyboard shortcut listener for Esc key to close preview drawer
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && previewSpec) {
        setPreviewSpec(null);
      }
    },
    [previewSpec]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const resetFilters = () => {
    setSelectedRole("all");
    setSelectedStatus("all");
    setSelectedAppId("all");
    setSearchQuery("");
  };

  return (
    <div className="mx-auto max-w-shell">
      <PageHeader
        eyebrow="Artifacts"
        title="Every spec, in one library"
        lead="Business requirements, product specs, engineering designs and build specs from every mission, readable by every seat."
      />

      {/* Filter and Search Bar */}
      <Panel title="Specification Library" className="mt-8">
        <div className="flex flex-col gap-4">
          {/* Top row: Keyword Search + App Filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search specifications by keyword, mission title or key..."
                aria-label="Search specifications"
                className="w-full rounded-sm border border-hairline bg-surface px-3.5 py-2 pl-9 text-[13px] text-ink placeholder-ink-faint outline-none focus:border-[color:var(--role)]"
              />
              <span className="pointer-events-none absolute left-3 top-2.5 text-[13px] text-ink-faint">🔍</span>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search query"
                  className="absolute right-3 top-2 text-[12px] text-ink-muted hover:text-ink"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Application Dropdown */}
            {kbs && kbs.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="app-filter" className="font-mono text-[11px] uppercase tracking-wider text-ink-muted whitespace-nowrap">
                  App:
                </label>
                <select
                  id="app-filter"
                  value={selectedAppId}
                  onChange={(e) => setSelectedAppId(e.target.value)}
                  className="rounded-sm border border-hairline bg-surface px-3 py-2 text-[12.5px] text-ink outline-none focus:border-[color:var(--role)]"
                >
                  <option value="all">All applications</option>
                  {kbs.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.appName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Role Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-hairline">
            <span className="mr-2 font-mono text-[11px] uppercase tracking-wider text-ink-muted">Seat:</span>
            <button
              type="button"
              onClick={() => setSelectedRole("all")}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                selectedRole === "all"
                  ? "bg-[rgb(var(--line)/.2)] text-ink border border-hairline"
                  : "text-ink-muted hover:text-ink hover:bg-[rgb(var(--line)/.08)]"
              }`}
            >
              All seats
            </button>
            {ROLES.map((r) => {
              const active = selectedRole === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRole(r.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors border ${
                    active
                      ? "border-current text-ink font-semibold"
                      : "border-transparent text-ink-muted hover:text-ink hover:bg-[rgb(var(--line)/.08)]"
                  }`}
                  style={{
                    color: active ? r.hue : undefined,
                    borderColor: active ? r.hue : "transparent",
                    backgroundColor: active ? `${r.hue}18` : undefined,
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: r.hue }} />
                  {r.name}
                </button>
              );
            })}
          </div>

          {/* Status Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-hairline">
            <span className="mr-2 font-mono text-[11px] uppercase tracking-wider text-ink-muted">Status:</span>
            {STATUS_OPTIONS.map((st) => {
              const active = selectedStatus === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedStatus(st.id as SpecStatus | "all")}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors border ${
                    active
                      ? "border-[color:var(--role)] bg-[rgb(var(--line)/.15)] text-ink font-semibold"
                      : "border-transparent text-ink-muted hover:text-ink hover:bg-[rgb(var(--line)/.08)]"
                  }`}
                >
                  {st.label}
                </button>
              );
            })}

            {(selectedRole !== "all" || selectedStatus !== "all" || selectedAppId !== "all" || searchQuery) && (
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto text-[11.5px] text-ink-muted underline decoration-dotted hover:text-ink"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      </Panel>

      {/* Specification Cards List */}
      <div className="mt-6">
        {loading ? (
          <Panel title="Loading specifications">
            <div className="py-12 text-center text-ink-faint">
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-hairline border-t-[color:var(--role)]" />
              <p className="mt-3 text-[13px]">Scanning cross-mission specification index…</p>
            </div>
          </Panel>
        ) : error ? (
          <Panel title="Error loading specifications">
            <div className="py-8 text-center text-ember">
              <p className="text-[14px]">Failed to load specifications: {error.detail}</p>
              <button
                type="button"
                onClick={reload}
                className="mt-4 rounded-sm border border-hairline bg-surface px-4 py-1.5 text-[12.5px] text-ink hover:border-ink-faint"
              >
                Retry
              </button>
            </div>
          </Panel>
        ) : !specs || specs.length === 0 ? (
          <Panel title="Spec files">
            <EmptyState line="No specification files match your filter criteria.">
              {(selectedRole !== "all" || selectedStatus !== "all" || selectedAppId !== "all" || searchQuery) && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-sm border border-hairline bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:border-ink-faint"
                >
                  Clear search and filters
                </button>
              )}
            </EmptyState>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {specs.map((spec) => (
              <SpecCard key={spec.id} spec={spec} onSelect={() => setPreviewSpec(spec)} />
            ))}
          </div>
        )}
      </div>

      {/* Quick-Preview Side Drawer */}
      {previewSpec && (
        <SpecPreviewDrawer spec={previewSpec} onClose={() => setPreviewSpec(null)} />
      )}
    </div>
  );
}

function SpecCard({ spec, onSelect }: { spec: SpecItem; onSelect: () => void }) {
  const roleDef = ROLE_BY_ID[spec.role];
  const excerpt = getExcerpt(spec.markdown);

  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Preview ${spec.title} for ${spec.missionKey}`}
      className="group flex flex-col justify-between rounded-md border border-hairline bg-deck p-5 transition-all hover:border-[color:var(--role)] hover:shadow-md cursor-pointer focus:outline-none focus:ring-1 focus:ring-[color:var(--role)]"
    >
      <div>
        {/* Top Header Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider font-semibold"
              style={{
                borderColor: `${roleDef?.hue ?? "var(--role)"}40`,
                color: roleDef?.hue ?? "var(--role)",
                backgroundColor: `${roleDef?.hue ?? "var(--role)"}12`,
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: roleDef?.hue ?? "var(--role)" }} />
              {roleDef?.name ?? spec.role}
            </span>
            <span className="font-mono text-[11px] text-ink-faint">v{spec.version}</span>
          </div>

          <StatusBadge status={spec.status} />
        </div>

        {/* Title and File Name */}
        <h3 className="mt-3 font-display text-[18px] font-semibold text-ink group-hover:text-[color:var(--role)] transition-colors">
          {spec.title}
        </h3>
        <p className="font-mono text-[11px] text-ink-muted">{spec.fileName}</p>

        {/* Parent Mission info */}
        <div className="mt-3 flex items-center gap-2 rounded-sm bg-surface px-2.5 py-1.5 border border-hairline">
          <span className="font-mono text-[11px] font-bold text-[color:var(--role)]">{spec.missionKey}</span>
          <span className="truncate text-[12.5px] text-ink-muted" title={spec.missionTitle}>
            {spec.missionTitle}
          </span>
        </div>

        {/* Markdown Excerpt */}
        {excerpt && (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-faint line-clamp-3">
            {excerpt}
          </p>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 font-mono text-[11px] text-ink-faint">
        <div className="flex items-center gap-2 truncate">
          {spec.apps && spec.apps.length > 0 ? (
            spec.apps.map((a) => (
              <span key={a.id} className="rounded-sm bg-[rgb(var(--line)/.08)] px-2 py-0.5 text-ink-muted">
                {a.name}
              </span>
            ))
          ) : (
            <span>No app linked</span>
          )}
        </div>

        <span className="shrink-0 group-hover:translate-x-0.5 transition-transform text-ink-muted">
          Preview →
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SpecStatus }) {
  const label = SPEC_STATUS_LABEL[status] ?? status;

  let color = "var(--ink-faint)";
  if (status === "approved") color = "var(--seat-engineering)";
  if (status === "draft" || status === "ai_drafted") color = "var(--seat-product)";
  if (status === "stale") color = "var(--seat-business)";

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider font-medium"
      style={{ borderColor: `${color}40`, color, backgroundColor: `${color}10` }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function SpecPreviewDrawer({ spec, onClose }: { spec: SpecItem; onClose: () => void }) {
  const roleDef = ROLE_BY_ID[spec.role];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgb(var(--void-rgb)/.7)] backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-2xl flex-col border-l border-hairline bg-deck shadow-2xl animate-in slide-in-from-right duration-200"
      >
        {/* Drawer Header */}
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4 bg-surface">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider font-semibold"
              style={{
                borderColor: `${roleDef?.hue ?? "var(--role)"}40`,
                color: roleDef?.hue ?? "var(--role)",
                backgroundColor: `${roleDef?.hue ?? "var(--role)"}12`,
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: roleDef?.hue ?? "var(--role)" }} />
              {roleDef?.name ?? spec.role}
            </span>
            <span className="font-mono text-[12px] text-ink-faint">v{spec.version}</span>
            <StatusBadge status={spec.status} />
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-md p-1.5 text-ink-muted hover:bg-[rgb(var(--line)/.1)] hover:text-ink"
          >
            ✕
          </button>
        </header>

        {/* Drawer Sub-Header Metadata */}
        <div className="border-b border-hairline bg-deck px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-[22px] font-bold text-ink">{spec.title}</h2>
              <p className="font-mono text-[12px] text-ink-muted">{spec.fileName}</p>
            </div>

            <Link
              href={`/app/missions/${spec.missionKey}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink hover:border-ink-faint hover:text-[color:var(--role)] transition-colors"
            >
              Open Mission {spec.missionKey} →
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-surface p-3 border border-hairline text-[12px]">
            <div>
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-muted block">Mission</span>
              <span className="font-medium text-ink">{spec.missionTitle}</span>
            </div>
            <div>
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-muted block">Applications</span>
              <span className="font-medium text-ink">
                {spec.apps && spec.apps.length > 0 ? spec.apps.map((a) => a.name).join(", ") : "None"}
              </span>
            </div>
            {spec.authorName && (
              <div>
                <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-muted block">Author</span>
                <span className="text-ink">{spec.authorName}</span>
              </div>
            )}
            {spec.approvedByName && (
              <div>
                <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-muted block">Approved By</span>
                <span className="text-ink">{spec.approvedByName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Drawer Scrollable Markdown Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {spec.markdown && spec.markdown.trim() ? (
            <KbMarkdown content={spec.markdown} />
          ) : (
            <div className="py-12 text-center text-ink-faint">
              <p className="text-[14px]">This specification file is empty.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getExcerpt(md?: string): string {
  if (!md) return "";
  const lines = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("-"));
  return lines.slice(0, 2).join(" ");
}
