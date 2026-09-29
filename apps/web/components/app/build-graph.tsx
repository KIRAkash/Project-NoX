"use client";

import { useMemo } from "react";

import type { KbEvent } from "@/lib/app/types";

/** Events the graph panel reads; the flight log leaves the node_* ones out. */
export const GRAPH_EVENTS = new Set(["node_started", "node_finished"]);

type NodeState = "pending" | "active" | "done";
type GraphNode = { id: string; label: string; detail?: string; state: NodeState };

/**
 * The knowledge-base build as the ADK workflow graph that runs it (ai/agents/kb_builder.py):
 * Cartographer → Writers → Links → Quality gate ⇄ Reviewer → Done, lit from the build's node events.
 */
export function BuildGraph({ events }: { events: KbEvent[] }) {
  const build = useMemo(() => latestBuild(events), [events]);
  if (!build.nodes && !build.usage) return null;
  return (
    <div className="space-y-4">
      {build.nodes && (
        <ol className="flex flex-col gap-1.5 sm:flex-row sm:items-stretch sm:gap-0" aria-label="Agent graph of the latest build">
          {build.nodes.map((n, i) => (
            <li key={n.id} className="flex flex-col items-stretch sm:flex-1 sm:flex-row sm:items-center">
              {i > 0 && <Connector loop={n.id === "review"} />}
              <Node node={n} />
            </li>
          ))}
        </ol>
      )}
      {build.usage && <p className="font-mono text-[11.5px] text-ink-faint">{build.usage}</p>}
    </div>
  );
}

function Node({ node }: { node: GraphNode }) {
  const active = node.state === "active";
  const done = node.state === "done";
  return (
    <div
      className={`min-w-0 flex-1 rounded-sm border px-2.5 py-2 text-center transition-colors ${active ? "animate-pulse motion-reduce:animate-none" : ""}`}
      style={{
        borderColor: active || done ? "color-mix(in srgb, var(--role) 55%, transparent)" : "rgba(143,160,204,.2)",
        background: active ? "color-mix(in srgb, var(--role) 22%, transparent)" : done ? "color-mix(in srgb, var(--role) 8%, transparent)" : "transparent",
        boxShadow: active ? "0 0 16px -6px var(--role)" : undefined,
      }}
      aria-current={active ? "step" : undefined}
    >
      <span className={`block truncate text-[12px] ${active || done ? "text-ink" : "text-ink-dim"}`}>{node.label}</span>
      {node.detail && <span className="block truncate font-mono text-[10.5px] text-ink-faint">{node.detail}</span>}
    </div>
  );
}

/** An arrow between nodes: down when stacked on a phone, right from sm up. The reviewer's is two-way (the loop). */
function Connector({ loop }: { loop: boolean }) {
  return (
    <svg viewBox="0 0 24 12" className="mx-auto h-3 w-6 shrink-0 rotate-90 text-ink-dim sm:mx-1 sm:rotate-0" aria-hidden>
      <path d="M2 6h20M17 2l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {loop && <path d="M7 2 2 6l5 4" fill="none" stroke="currentColor" strokeWidth="1.3" />}
    </svg>
  );
}

function latestBuild(events: KbEvent[]): { nodes: GraphNode[] | null; usage: string | null } {
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const start = ordered.map((e) => e.eventType).lastIndexOf("compilation_started");
  const run = start >= 0 ? ordered.slice(start) : ordered;
  const has = (t: string) => run.some((e) => e.eventType === t);
  const last = (t: string) => [...run].reverse().find((e) => e.eventType === t);

  const usageEvent = last("build_usage");
  const usage = usageEvent ? usageLine(usageEvent.payload) : null;
  if (!run.some((e) => GRAPH_EVENTS.has(e.eventType))) return { nodes: null, usage };

  const state: Record<string, NodeState> = {};
  for (const e of run) {
    const n = String(e.payload?.node ?? "");
    if (e.eventType === "node_started") state[n] = "active";
    else if (e.eventType === "node_finished") state[n] = "done";
  }
  const of = (id: string): NodeState => state[id] ?? "pending";
  const finished = has("build_usage") || of("finish") === "done";
  const planned = (last("plan_ready")?.payload?.pages as unknown[] | undefined)?.length;
  const written = new Set(run.filter((e) => e.eventType === "page_compiled").map((e) => String(e.payload?.path ?? ""))).size;
  const writing: NodeState = state.synthesize || finished ? "done" : of("write_pages") === "active" || of("warm_cache") === "active" ? "active" : "pending";
  const round = Number(last("review_round")?.payload?.round ?? (has("review_started") ? 1 : 0));

  return {
    usage,
    nodes: [
      { id: "cartographer", label: "Cartographer", state: has("plan_ready") ? "done" : has("cartographer_started") ? "active" : "pending" },
      { id: "writers", label: "Writers", detail: planned ? `${Math.min(written, planned)}/${planned}` : undefined, state: writing },
      { id: "synthesize", label: "Links", state: finished ? "done" : of("synthesize") },
      { id: "lint_gate", label: "Quality gate", state: finished ? "done" : of("lint_gate") },
      { id: "review", label: "Reviewer", detail: round ? `round ${round}` : undefined, state: finished && round ? "done" : of("review") },
      { id: "finish", label: "Done", state: finished ? "done" : of("finish") },
    ],
  };
}

/** "Built by NoX's agents · 31 calls · 412k tokens · 38% cached · 2m 14s", from the build_usage event. */
function usageLine(p: Record<string, unknown>): string {
  const n = (k: string) => Number(p[k] ?? 0);
  const tokens = n("input_tokens") + n("output_tokens");
  const secs = Math.round(n("seconds"));
  const parts = [
    `${n("calls")} calls`,
    tokens >= 1000 ? `${Math.round(tokens / 1000)}k tokens` : `${tokens} tokens`,
    `${Math.round(100 * n("cached_share"))}% cached`,
    secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`,
  ];
  return ["Built by NoX's agents", ...parts].join(" · ");
}
