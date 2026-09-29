"use client";

import { useState } from "react";

import { useToast } from "@/components/app/ui";
import { api, ApiError } from "@/lib/app/api";
import type { Mission } from "@/lib/app/types";

export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

/** Now / Next / Later: how a product owner reads priority. */
export const HORIZON: { key: string; label: string; hint: string; match: (p: string | null) => boolean }[] = [
  { key: "now", label: "Now", hint: "P1", match: (p) => p === "P1" },
  { key: "next", label: "Next", hint: "P2", match: (p) => p === "P2" },
  { key: "later", label: "Later", hint: "P3 · P4", match: (p) => p === "P3" || p === "P4" },
  { key: "untriaged", label: "Untriaged", hint: "no priority", match: (p) => !p },
];

/** Inline P1–P4 chips. Only the product owner can set priority (the API checks); others see a read-only label. */
export function PriorityChips({ m, onChanged }: { m: Mission; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const set = async (e: React.MouseEvent, priority: string) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await api(`/api/v1/missions/${m.key}`, { method: "PATCH", json: { priority } });
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't set priority", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex gap-1" role="radiogroup" aria-label={`Priority for ${m.key}`}>
      {PRIORITIES.map((p) => {
        const on = m.priority === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={busy}
            onClick={(e) => void set(e, p)}
            className="h-6 rounded-sm border px-1.5 font-mono text-[10.5px] transition disabled:opacity-50"
            style={{
              borderColor: on ? "var(--role)" : "rgba(143,160,204,.2)",
              background: on ? "var(--role)" : "transparent",
              color: on ? "#05060B" : "#A6AEC7",
            }}
          >
            {p}
          </button>
        );
      })}
    </span>
  );
}
