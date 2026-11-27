"use client";

import { AlertTriangle, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BrandLogo } from "@/components/app/brand-logo";
import { CaptureBar } from "@/components/app/media/capture-bar";
import { CaptureCard } from "@/components/app/media/capture-card";
import { visibleCaptures } from "@/components/app/media/evidence-tab";
import { PageHeader, Panel, useToast } from "@/components/app/ui";
import { VoiceInput } from "@/components/app/voice-input";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { useMissionDraft, type DraftMissionType } from "@/lib/app/mission-draft";
import { ROLE_BY_ID } from "@/lib/app/roles";
import type { Mission, Sighting } from "@/lib/app/types";

type Suggestion = { id: string; name: string; status: string; score: number };

const PLACEHOLDER: Record<string, string> = {
  business: "Customers keep asking where their refund is. Can we show them it's on its way?",
  product: "Partners need to see why a payment was declined, with the rule that triggered it.",
  engineering: "Rotate service tokens without downtime.",
  developer: "Add an idempotency key to order ingestion so retried requests don't create duplicate orders.",
};

export default function NewMissionPage() {
  const { me, refreshMe } = useAuth();
  const role = ROLE_BY_ID[me!.role!];
  const router = useRouter();
  const toast = useToast();
  const hasSightingParam = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sighting");
  const [sighting, setSighting] = useState<Sighting | null>(null);
  const { prompt, setPrompt, type, setType, jiraKey, setJiraKey, captures, mediaIds, hasSavedDraft, addCapture, updateCapture, removeCapture, clearDraft } =
    useMissionDraft(me?.id, { skipPersistence: hasSightingParam || Boolean(sighting) });
  const [apps, setApps] = useState<Suggestion[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [importKey, setImportKey] = useState("");
  const [importing, setImporting] = useState(false);
  const touched = useRef(false);
  const initialFetchDone = useRef(false);
  const grounded = captures.flatMap((c) => (c.status === "ready" ? c.apps ?? [] : []));

  useEffect(() => {
    if (jiraKey && !importKey) setImportKey(jiraKey);
  }, [jiraKey, importKey]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("sighting");
    if (!id) return;
    api<Sighting>(`/api/v1/sightings/${encodeURIComponent(id)}`)
      .then((s) => {
        setSighting(s);
        setPrompt(s.view.request);
        const sightingType: DraftMissionType =
          s.view.missionType === "bug" || s.view.missionType === "change" ? s.view.missionType : "feature";
        setType(sightingType);
        touched.current = true;
        setPicked(s.apps.map((a) => a.id));
      })
      .catch(() => toast("That sighting isn't available any more", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for ?sighting= query parameter
  }, [toast]);

  const importFromJira = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    try {
      const issue = await api<{ key: string; summary: string; description: string }>(`/api/v1/integrations/jira/issues/${encodeURIComponent(importKey.trim())}`);
      setPrompt([issue.summary, issue.description].filter(Boolean).join("\n\n").slice(0, 2000));
      setJiraKey(issue.key);
      toast(`${issue.key} imported. It'll be linked to the mission`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't read that ticket", "error");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    const text = prompt.trim();
    const delay = !initialFetchDone.current ? 0 : text.length >= 12 ? 600 : 0;
    initialFetchDone.current = true;
    const t = setTimeout(async () => {
      try {
        const res = await api<Suggestion[]>("/api/v1/missions/suggest-apps", {
          method: "POST",
          json: { prompt: text.length >= 3 ? text : "app" },
        });
        setApps(res);
        setAppsLoaded(true);
        if (!touched.current) {
          if (res.length === 1) {
            setPicked([res[0].id]);
          } else if (res[0]?.score > 0) {
            setPicked([res[0].id]);
          }
        }
      } catch {
        setAppsLoaded(true);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [prompt]);

  // When a capture is grounded, its applications replace the word-matching ranking: pre-ticked, still the user's call.
  useEffect(() => {
    if (!grounded.length || !apps.length) return;
    const rank = (name: string) => {
      const i = grounded.findIndex((g) => g.app === name);
      return i < 0 ? 99 : i;
    };
    setApps((xs) => (xs.every((x, i) => i === 0 || rank(xs[i - 1].name) <= rank(x.name)) ? xs : [...xs].sort((a, b) => rank(a.name) - rank(b.name))));
    if (!touched.current) {
      const top = grounded.filter((g) => g.confidence !== "low").map((g) => apps.find((a) => a.name === g.app)?.id).filter((x): x is string => !!x);
      if (top.length) setPicked(top);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-rank when the grounding changes, not on every re-render
  }, [JSON.stringify(grounded), apps.length]);

  const toggle = (id: string) => {
    touched.current = true;
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const m = await api<Mission>("/api/v1/missions", { method: "POST", json: { prompt: prompt.trim(), appIds: picked, type, jiraKey: jiraKey ?? undefined, mediaIds, sightingId: sighting?.id } });
      if (!sighting) clearDraft();
      void refreshMe();
      toast(`${m.key} started. NoX is drafting`, "success");
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
        <PageHeader eyebrow="New mission" title={role.id === "business" ? "Ask for a change" : "Start a mission"} lead="Say it the way you'd say it to a colleague, or show NoX: record your screen, take a screenshot or leave a voice note." />
      </div>
      <form onSubmit={importFromJira} className="mt-8 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="inline-flex items-center gap-2 text-ink-muted"><BrandLogo name="jira" size={14} />Starting from a Jira ticket?</span>
        <input value={importKey} onChange={(e) => setImportKey(e.target.value)} placeholder="APEX-42" aria-label="Jira key to import" className="h-9 w-[140px] rounded-sm border border-hairline bg-deck px-3 font-mono text-[13px] text-ink outline-none focus:border-[color:var(--role)]" />
        <button type="submit" disabled={importing || !/^[A-Za-z][A-Za-z0-9]+-\d+$/.test(importKey.trim())} className="h-9 rounded-sm border border-hairline px-3 text-ink hover:border-ink-faint disabled:opacity-40">
          {importing ? "Importing…" : "Import"}
        </button>
        {jiraKey && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[color:var(--role)]">
            linked: {jiraKey}
            <button
              type="button"
              onClick={() => {
                setJiraKey(null);
                setImportKey("");
              }}
              aria-label="Unlink Jira ticket"
              className="text-ink-dim hover:text-ink"
            >
              ×
            </button>
          </span>
        )}
      </form>
      {sighting && (
        <p className="mt-5 rounded-sm border border-hairline bg-[rgb(var(--line)/.04)] p-3 text-[13px] text-ink-muted">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[color:var(--role)]">From a NoX sighting</span>
          <span className="mt-1 block text-ink">{sighting.view.title}</span>
          NoX filled this in. Change anything you like; its evidence goes to every draft.
        </p>
      )}
      <form onSubmit={create} className="mt-5 space-y-5">
        <Panel
          title="The request"
          action={
            hasSavedDraft && !sighting ? (
              <span
                data-testid="draft-saved-badge"
                className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-verify" />
                Draft saved locally
              </span>
            ) : undefined
          }
        >
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
          <VoiceInput value={prompt} onChange={setPrompt} label="Or say it out loud" accent className="mt-2 w-full justify-end" />
          <div className="mt-4 border-t border-hairline pt-4">
            <CaptureBar global accent onMedia={(c, extra = []) => addCapture(c, extra)} />
            {captures.length > 0 && (
              <ul className="mt-4 space-y-3" aria-label="What you showed NoX">
                {visibleCaptures(captures).map((c) => (
                  <li key={c.id}>
                    <CaptureCard
                      capture={c}
                      onChange={(next) => {
                        updateCapture(next);
                        if (next.status === "ready" && next.kindOfRequest === "bug" && type === "feature") setType("bug");
                      }}
                      onDeleted={removeCapture}
                      onUseRequest={(sentence) => setPrompt(sentence)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
            {(
              [
                ["feature", "Something new"],
                ["bug", "Something broken"],
                ["change", "A change"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={type === v}
                onClick={() => setType(v)}
                className="rounded-full border px-3 py-1 text-[12.5px]"
                style={{ borderColor: type === v ? role.ink : "rgb(var(--line)/.2)", color: type === v ? role.ink : "var(--ink-muted)" }}
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
                      style={{ borderColor: on ? role.ink : "rgb(var(--line)/.18)", color: on ? "var(--ink)" : "var(--ink-muted)" }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex h-4 w-4 items-center justify-center rounded-[5px] border" style={{ borderColor: on ? role.ink : "rgb(var(--line)/.35)", background: on ? role.ink : "transparent" }}>
                          {on && <Check size={11} className="text-void" strokeWidth={3} />}
                        </span>
                        {a.name}
                      </span>
                      {grounded.some((g) => g.app === a.name) ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--role)]" title={grounded.find((g) => g.app === a.name)?.why}>
                          seen in your capture
                        </span>
                      ) : (
                        !grounded.length && a.score > 0 && prompt.trim().length >= 12 && <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-dim">suggested</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-hairline bg-[rgb(var(--line)/.04)] p-3 text-[13px] text-ink-muted">
              <span>No applications in your orbit yet. Onboard one in Atlas before starting a mission.</span>
              <Link href="/app/atlas" className="font-semibold hover:underline" style={{ color: role.ink }}>
                Open Atlas →
              </Link>
            </div>
          )}
          <p className="mt-3 text-[12px] text-ink-faint">The first one you pick is where the spec files are kept.</p>
        </Panel>

        {upstream.length > 0 && (
          <p className="rounded-sm border border-hairline bg-[rgb(var(--line)/.04)] p-3 text-[13px] text-ink-muted">
            Starting from the {role.name} seat: NoX drafts the {upstream.join(", ")} for you from this request and the knowledge base, then asks before you go ahead without their owners&rsquo; approval.
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {appsLoaded && apps.length === 0 ? (
            <div
              data-testid="new-mission-disabled-helper"
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-sm border px-3.5 py-2 text-[12.5px]"
              style={{
                borderColor: "color-mix(in srgb, var(--role) 40%, transparent)",
                background: "color-mix(in srgb, var(--role) 11%, transparent)",
              }}
            >
              <AlertTriangle size={14} className="shrink-0 text-[color:var(--role)]" aria-hidden />
              <span className="text-ink-muted">
                <strong className="font-semibold text-ink">No applications in Atlas yet:</strong> Onboard an application to enable Start mission.
              </span>
              <Link href="/app/atlas" className="font-semibold hover:underline" style={{ color: role.ink }}>
                Open Atlas →
              </Link>
            </div>
          ) : appsLoaded && !picked.length ? (
            <p data-testid="new-mission-disabled-helper" className="text-[13px] text-ink-muted">
              Select at least one application above, or{" "}
              <Link href="/app/atlas" className="font-semibold hover:underline" style={{ color: role.ink }}>
                open Atlas →
              </Link>
            </p>
          ) : prompt.trim().length < 8 ? (
            <p data-testid="new-mission-disabled-helper" className="text-[13px] text-ink-faint">
              Describe the change (at least 8 characters) to enable Start mission.
            </p>
          ) : (
            <span />
          )}
          <LiquidMetalButton
            type="submit"
            hue={role.hue}
            disabled={busy || prompt.trim().length < 8 || !picked.length}
            className="h-11 shrink-0 rounded-sm px-6 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Starting…" : "Start mission"}
          </LiquidMetalButton>
        </div>
      </form>
    </div>
  );
}
