"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrandLogo } from "@/components/app/brand-logo";
import { PageHeader, Panel, useToast } from "@/components/app/ui";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID } from "@/lib/app/roles";
import type { Mission } from "@/lib/app/types";

type Suggestion = { id: string; name: string; status: string; score: number };

const PLACEHOLDER: Record<string, string> = {
  business: "Customers keep asking where their refund is. Can we show them it's on its way?",
  product: "Partners need to see why a payment was declined, with the rule that triggered it.",
  engineering: "Rotate service tokens without downtime.",
  developer: "Add an idempotency key to order ingestion so retried requests don't create duplicate orders.",
};

export default function NewMissionPage() {
  const { me } = useAuth();
  const role = ROLE_BY_ID[me!.role!];
  const router = useRouter();
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState("feature");
  const [apps, setApps] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [jiraKey, setJiraKey] = useState<string | null>(null);
  const [importKey, setImportKey] = useState("");
  const [importing, setImporting] = useState(false);
  const touched = useRef(false);

  const importFromJira = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    try {
      const issue = await api<{ key: string; summary: string; description: string }>(`/api/v1/integrations/jira/issues/${encodeURIComponent(importKey.trim())}`);
      setPrompt([issue.summary, issue.description].filter(Boolean).join("\n\n").slice(0, 2000));
      setJiraKey(issue.key);
      toast(`${issue.key} imported — it'll be linked to the mission`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't read that ticket", "error");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    const text = prompt.trim();
    const t = setTimeout(async () => {
      try {
        const res = await api<Suggestion[]>("/api/v1/missions/suggest-apps", { method: "POST", json: { prompt: text.length >= 3 ? text : "app" } });
        setApps(res);
        if (!touched.current && res[0]?.score > 0) setPicked([res[0].id]);
      } catch {
        /* suggestions are optional */
      }
    }, text.length >= 12 ? 600 : 0);
    return () => clearTimeout(t);
  }, [prompt]);

  const toggle = (id: string) => {
    touched.current = true;
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const m = await api<Mission>("/api/v1/missions", { method: "POST", json: { prompt: prompt.trim(), appIds: picked, type, jiraKey: jiraKey ?? undefined } });
      toast(`${m.key} started — NoX is drafting`, "success");
      router.push(`/app/missions/${m.key}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't start the mission", "error");
      setBusy(false);
    }
  };

  const upstream = { business: [], product: ["business requirement"], engineering: ["business requirement", "product spec"], developer: ["business requirement", "product spec", "engineering design"] }[role.id];

  return (
    <div className="mx-auto max-w-[820px]">
      <Link href="/app/missions" className="text-[13px] text-ink-dim hover:text-ink">
        ← Missions
      </Link>
      <div className="mt-4">
        <PageHeader eyebrow="New mission" title={role.id === "business" ? "Ask for a change" : "Start a mission"} lead="Say it the way you'd say it to a colleague. One sentence is enough." />
      </div>
      <form onSubmit={importFromJira} className="mt-8 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="inline-flex items-center gap-2 text-ink-muted"><BrandLogo name="jira" size={14} />Starting from a Jira ticket?</span>
        <input value={importKey} onChange={(e) => setImportKey(e.target.value)} placeholder="APEX-42" aria-label="Jira key to import" className="h-9 w-[140px] rounded-sm border border-hairline bg-deck px-3 font-mono text-[13px] text-ink outline-none focus:border-[color:var(--role)]" />
        <button type="submit" disabled={importing || !/^[A-Za-z][A-Za-z0-9]+-\d+$/.test(importKey.trim())} className="h-9 rounded-sm border border-hairline px-3 text-ink hover:border-ink-faint disabled:opacity-40">
          {importing ? "Importing…" : "Import"}
        </button>
        {jiraKey && <span className="font-mono text-[12px] text-[color:var(--role)]">linked: {jiraKey}</span>}
      </form>
      <form onSubmit={create} className="mt-5 space-y-5">
        <Panel title="The request">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            required
            minLength={8}
            autoFocus
            placeholder={PLACEHOLDER[role.id]}
            aria-label="The request"
            className="w-full resize-y rounded-sm border border-hairline bg-deck p-3 text-[15px] leading-relaxed text-ink outline-none focus:border-[color:var(--role)]"
          />
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
            {[
              ["feature", "Something new"],
              ["bug", "Something broken"],
              ["change", "A change"],
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={type === v}
                onClick={() => setType(v)}
                className="rounded-full border px-3 py-1 text-[12.5px]"
                style={{ borderColor: type === v ? role.hue : "rgba(143,160,204,.2)", color: type === v ? role.hue : "#A6AEC7" }}
              >
                {label}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Which applications?">
          {apps.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {apps.map((a) => {
                const on = picked.includes(a.id);
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => toggle(a.id)}
                      aria-pressed={on}
                      className="flex w-full items-center justify-between gap-2 rounded-sm border px-3 py-2.5 text-left text-[13.5px]"
                      style={{ borderColor: on ? role.hue : "rgba(143,160,204,.18)", color: on ? "#ECEFF8" : "#A6AEC7" }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex h-4 w-4 items-center justify-center rounded-[5px] border" style={{ borderColor: on ? role.hue : "rgba(143,160,204,.35)", background: on ? role.hue : "transparent" }}>
                          {on && <Check size={11} className="text-void" strokeWidth={3} />}
                        </span>
                        {a.name}
                      </span>
                      {a.score > 0 && prompt.trim().length >= 12 && <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-dim">suggested</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-faint">No applications in your orbit yet — they&rsquo;re onboarded from the atlas.</p>
          )}
          <p className="mt-3 text-[12px] text-ink-faint">The first one you pick is where the spec files are kept.</p>
        </Panel>

        {upstream.length > 0 && (
          <p className="rounded-sm border border-hairline bg-[rgba(143,160,204,.04)] p-3 text-[13px] text-ink-muted">
            Starting from the {role.name} seat: NoX drafts the {upstream.join(", ")} for you from this request and the knowledge base, then asks before you go ahead without their owners&rsquo; approval.
          </p>
        )}

        <div className="flex justify-end">
          <LiquidMetalButton type="submit" hue={role.hue} disabled={busy || prompt.trim().length < 8 || !picked.length} className="h-11 rounded-sm px-6 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "Starting…" : "Start mission"}
          </LiquidMetalButton>
        </div>
      </form>
    </div>
  );
}
