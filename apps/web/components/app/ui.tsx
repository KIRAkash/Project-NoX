"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { C, tint } from "@/lib/app/palette";
import type { RoleDef } from "@/lib/app/roles";

import { Planet } from "./planet";

// ── Panel ────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // A lifted slate surface over the void, so panels separate from the starfield and the dark cards inside
    // read as wells. The header carries the acting seat's hue (`--role`, set by the shell).
    <section className={`surface-panel overflow-hidden rounded-md ${className}`}>
      <header
        className="flex items-center justify-between gap-3 border-b px-5 py-3.5"
        style={{
          background: "linear-gradient(90deg, color-mix(in srgb, var(--role-glow) 10%, transparent), transparent 70%)",
          borderColor: "color-mix(in srgb, var(--role) 22%, rgb(var(--line)/.14))",
        }}
      >
        <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: "color-mix(in srgb, var(--role) 75%, var(--ink))" }}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--role)", boxShadow: "0 0 8px var(--role-glow)" }} />
          {title}
        </h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ── Scrolling feed: a fixed-height, keyboard-scrollable list for logs and timelines ──

export const FEED_LIST = "-mr-2 max-h-[340px] overflow-y-auto overscroll-contain pr-2 outline-none [scrollbar-color:rgb(var(--line)/.3)_transparent] [scrollbar-width:thin] focus-visible:ring-1 focus-visible:ring-[color:var(--role)]";

// ── Empty state: a lone planet and one line ─────────────────────────────────

export function EmptyState({ role, line, children }: { role?: RoleDef; line: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      {role ? (
        <Planet role={role} size={36} />
      ) : (
        <span className="h-9 w-9 rounded-full border border-dashed border-[rgb(var(--line)/.35)]" aria-hidden />
      )}
      <p className="mt-4 max-w-[320px] text-[14px] leading-relaxed text-ink-faint">{line}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

// ── Knowledge-base lifecycle chip ────────────────────────────────────────────

export type KbStatus = "queued" | "ingesting" | "generating" | "in_review" | "published" | "failed";

const KB_STATUS: Record<KbStatus, { label: string; color: string; pulse?: boolean }> = {
  queued: { label: "In the Void", color: C.inkFaint },
  ingesting: { label: "Scanning Nebula", color: C.iceInk, pulse: true },
  generating: { label: "Compiling Stars", color: C.violetInk, pulse: true },
  in_review: { label: "Awaiting Launch", color: C.noxInk },
  published: { label: "In Orbit", color: C.verifyInk },
  failed: { label: "Lost Signal", color: C.emberInk },
};

export function KbStatusChip({ status }: { status: KbStatus }) {
  const s = KB_STATUS[status] ?? KB_STATUS.queued;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]"
      style={{ borderColor: tint(s.color, 33), color: s.color }}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.pulse ? "animate-pulse motion-reduce:animate-none" : ""}`} style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

// ── Orbit arc: where a mission sits in the loop ─────────────────────────────

export const STAGES = ["Business", "Product", "Engineering", "Build", "Verify"] as const;

export function OrbitArc({ current, reverse = false, width = 132 }: { current: number; reverse?: boolean; width?: number }) {
  const h = width * 0.34;
  const pts = STAGES.map((_, i) => {
    const t = i / (STAGES.length - 1);
    const x = 6 + t * (width - 12);
    const y = h - 4 - Math.sin(t * Math.PI) * (h - 10);
    return { x, y };
  });
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={`Stage: ${STAGES[current]}${reverse ? " (verifying)" : ""}`}>
      <path
        d={`M ${pts[0].x} ${pts[0].y} Q ${width / 2} ${-h * 0.35} ${pts[4].x} ${pts[4].y}`}
        fill="none"
        stroke="rgb(var(--line)/.28)"
        strokeDasharray="2 3"
      />
      {pts.map((p, i) => {
        const done = reverse ? i >= current : i < current;
        const active = i === current;
        return (
          <circle
            key={STAGES[i]}
            cx={p.x}
            cy={p.y}
            r={active ? 4.2 : 2.6}
            fill={active ? (reverse ? C.verify : C.nox) : done ? "var(--ink-muted)" : "transparent"}
            stroke={active ? "none" : "var(--ink-dim)"}
            strokeWidth={1}
          >
            {active && <title>{STAGES[i]}</title>}
          </circle>
        );
      })}
    </svg>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────

type Toast = { id: number; text: string; tone: "info" | "success" | "error" };
const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col gap-2 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-md border bg-deck px-4 py-3 text-[13px] text-ink shadow-lg"
            style={{ borderColor: t.tone === "error" ? tint(C.ember, 40) : t.tone === "success" ? tint(C.verify, 40) : "rgb(var(--line)/.25)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.tone === "error" ? C.ember : t.tone === "success" ? C.verify : C.nox }} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ── Popover helper: closes on outside click / Escape ────────────────────────

export function usePopover() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-popover]")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  return { open, setOpen, toggle: () => setOpen((o) => !o) };
}

// ── Page header ──────────────────────────────────────────────────────────────

export function PageHeader({ eyebrow, title, lead, action }: { eyebrow: string; title: string; lead?: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--role)]">{eyebrow}</span>
        <h1 className="mt-1 font-display text-[34px] leading-tight text-ink sm:text-[40px]">{title}</h1>
        {lead && <p className="mt-2 max-w-[620px] text-[15px] leading-relaxed text-ink-muted">{lead}</p>}
      </div>
      {action}
    </header>
  );
}
