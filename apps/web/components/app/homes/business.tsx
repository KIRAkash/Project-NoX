"use client";

import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CaptureBar } from "@/components/app/media/capture-bar";
import { CaptureCard } from "@/components/app/media/capture-card";
import { visibleCaptures } from "@/components/app/media/evidence-tab";
import { SightingCard } from "@/components/app/sighting-card";
import { EmptyState, useToast } from "@/components/app/ui";
import { VoiceInput } from "@/components/app/voice-input";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import { useAuth } from "@/lib/app/auth";
import { useMissionDraft } from "@/lib/app/mission-draft";
import type { RoleDef } from "@/lib/app/roles";
import type { Mission, Sighting } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";
import { useWorkspaceStage } from "@/lib/app/workspace-stage";

import { RequestCard } from "./shared";
import { useHomeTour } from "@/components/app/tour/tour";

type Suggestion = { id: string; name: string; score: number };

const EXAMPLES = [
  "Clients keep asking when their trade will settle. Can we show them the date?",
  "Compliance should see which desk placed each flagged order.",
  "Traders want an alert when a price moves more than 5% in a day.",
];

/**
 * The request desk: a business user's whole job is to ask, follow along and confirm. So the home is a composer and
 * their requests as parcel-tracker cards — in their own words, with no mission keys, stages or applications to pick.
 */
export function BusinessHome({ role }: { role: RoleDef }) {
  const { hasMissions, showAllPanels } = useWorkspaceStage();
  const all = useApi<Mission[]>("/api/v1/missions?view=all");
  const back = useApi<Mission[]>("/api/v1/missions?view=back");
  const waiting = useApi<Mission[]>("/api/v1/missions?view=waiting");
  const needsYou = new Set([...(back.data ?? []), ...(waiting.data ?? [])].map((m) => m.key));
  const rest = (all.data ?? []).filter((m) => !needsYou.has(m.key));
  const liveHasMissions = hasMissions || Boolean(all.data?.length || back.data?.length || waiting.data?.length);
  const showQueue = liveHasMissions || showAllPanels;
  useHomeTour(role.id, !all.loading && !back.loading && !waiting.loading);

  return (
    <div className="mx-auto mt-8 max-w-[860px] space-y-10">
      <RequestComposer role={role} />

      {(back.data?.length || waiting.data?.length) ? (
        <section data-tour="needs-you">
          <h2 className="mb-4 text-[20px] font-semibold text-ink">Needs you</h2>
          <div className="grid gap-4">
            {(back.data ?? []).map((m) => (
              <RequestCard key={m.key} m={m} highlight="It's built — check it does what you asked" />
            ))}
            {(waiting.data ?? []).filter((m) => !back.data?.some((b) => b.key === m.key)).map((m) => (
              <RequestCard key={m.key} m={m} highlight={m.stage === "business" ? "NoX wrote up your request — read it and confirm" : "NoX updated your request — check it still says what you meant"} />
            ))}
          </div>
        </section>
      ) : null}

      {showQueue && (
        <section data-tour="on-their-way">
          <h2 className="mb-4 text-[20px] font-semibold text-ink">On their way</h2>
          {all.loading && !all.data ? (
            <p className="text-[14px] text-ink-faint">Loading…</p>
          ) : rest.length ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {rest.map((m) => (
                <RequestCard key={m.key} m={m} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-hairline">
              <EmptyState role={role} line="Nothing else on its way. Ask for a change above and follow it here." />
            </div>
          )}
        </section>
      )}

      <Ideas role={role} />
    </div>
  );
}

/** Changes NoX spotted that the business would feel, in plain words. Hidden when there are none. */
function Ideas({ role }: { role: RoleDef }) {
  const { data, reload } = useApi<Sighting[]>("/api/v1/sightings");
  if (!data?.length) return null;
  return (
    <section data-tour="ideas">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[20px] font-semibold text-ink">Ideas from NoX</h2>
        <Link href="/app/sightings" className="text-[13px] hover:underline" style={{ color: role.ink }}>
          See all {data.length} →
        </Link>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {data.slice(0, 4).map((s) => (
          <SightingCard key={s.id} s={s} role={role} onChanged={() => void reload()} compact />
        ))}
      </div>
    </section>
  );
}

function RequestComposer({ role }: { role: RoleDef }) {
  const { me, refreshMe } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { prompt, setPrompt, type, jiraKey, captures, mediaIds, hasSavedDraft, addCapture, updateCapture, removeCapture, clearDraft } =
    useMissionDraft(me?.id);
  const [apps, setApps] = useState<Suggestion[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [appId, setAppId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const picked = useRef(false); // the user chose the application themselves
  const initialFetchDone = useRef(false);
  const ready = captures.filter((c) => c.status === "ready");
  const grounded = ready.flatMap((c) => c.apps ?? []).filter((g) => g.confidence !== "low");
  const bug = ready.some((c) => c.kindOfRequest === "bug");

  // NoX picks the application from the words; the business user can change it but never has to.
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
        if (!picked.current && !grounded.length) {
          setAppId((cur) => {
            const validCur = res.some((r) => r.id === cur) ? cur : "";
            return text.length >= 12 && res[0] ? res[0].id : validCur || res[0]?.id || "";
          });
        }
      } catch {
        setAppsLoaded(true);
      }
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- suggest on typing; a capture's grounding is handled below
  }, [prompt]);

  // An application seen in a capture beats the word match, unless the user already picked one.
  const seen = apps.find((a) => a.name === grounded[0]?.app);
  useEffect(() => {
    if (seen && !picked.current) setAppId(seen.id);
  }, [seen?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const missionType = bug || type === "bug" ? "bug" : "change";
      const m = await api<Mission>("/api/v1/missions", {
        method: "POST",
        json: { prompt: prompt.trim(), appIds: [appId], type: missionType, jiraKey: jiraKey ?? undefined, mediaIds },
      });
      clearDraft();
      void refreshMe();
      toast("Request sent — NoX is writing it up", "success");
      router.push(`/app/missions/${m.key}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.detail : "Couldn't send the request", "error");
      setBusy(false);
    }
  };

  const app = apps.find((a) => a.id === appId);
  return (
    <form
      onSubmit={submit}
      className="rounded-xl border p-5 sm:p-7"
      style={{
        borderColor: "color-mix(in srgb, var(--role) 35%, transparent)",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--role) 9%, rgb(var(--raise)/.85)), rgb(var(--raise-lo)/.85))",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label htmlFor="ask" className="block font-display text-[26px] leading-tight text-ink sm:text-[30px]">
          What would you like to change?
        </label>
        {hasSavedDraft && (
          <span
            data-testid="draft-saved-badge"
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[rgb(var(--void-rgb)/.55)] px-2.5 py-1 text-[11.5px] text-ink-muted"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-verify" />
            Draft saved locally
          </span>
        )}
      </div>
      <p className="mt-1 text-[14px] text-ink-muted">Say it the way you&rsquo;d say it to a colleague, or show NoX. NoX writes it up and gets it to the right people.</p>
      <textarea
        id="ask"
        data-tour="composer"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        minLength={8}
        required
        placeholder={EXAMPLES[0]}
        className="mt-4 w-full resize-y rounded-lg border border-hairline bg-[rgb(var(--void-rgb)/.6)] p-4 text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-dim focus:border-[color:var(--role)]"
      />
      <div className="mt-2 flex justify-end">
        <span data-tour="voice" className="inline-flex">
          <VoiceInput value={prompt} onChange={setPrompt} label="Or just say it" accent />
        </span>
      </div>
      <div className="mt-3">
        <CaptureBar
          global
          accent
          onMedia={(c, extra = []) => addCapture(c, extra)}
        />
        {captures.length > 0 && (
          <ul className="mt-4 space-y-3" aria-label="What you showed NoX">
            {visibleCaptures(captures).map((c) => (
              <li key={c.id}>
                <CaptureCard
                  capture={c}
                  onChange={updateCapture}
                  onDeleted={removeCapture}
                  onUseRequest={(sentence) => setPrompt(sentence)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setPrompt(ex)} className="rounded-full border border-hairline px-3 py-1.5 text-left text-[12.5px] text-ink-muted hover:border-[color:var(--role)] hover:text-ink">
            {ex.length > 52 ? `${ex.slice(0, 50)}…` : ex}
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {apps.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span
              data-tour="app-guess"
              className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 self-start rounded-full border py-1 pl-3 pr-1.5 text-[13px] text-ink-muted"
              style={{ borderColor: "color-mix(in srgb, var(--role) 45%, transparent)", background: "color-mix(in srgb, var(--role) 10%, transparent)" }}
            >
              <Sparkles size={14} className="text-[color:var(--role)]" aria-hidden />
              This sounds like
              <select
                value={appId}
                onChange={(e) => {
                  picked.current = true;
                  setAppId(e.target.value);
                }}
                aria-label="Which application"
                className="rounded-full border border-[color:var(--role)] bg-[rgb(var(--void-rgb)/.7)] px-2.5 py-1 text-[13px] font-semibold text-ink outline-none focus:ring-2 focus:ring-[color:var(--role)]"
              >
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {app && (app.id === seen?.id || (app.score > 0 && prompt.trim().length >= 12)) && (
                <span className="pr-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[color:var(--role)]">
                  {app.id === seen?.id ? "seen in your capture" : "NoX's guess"}
                </span>
              )}
            </span>
            {prompt.trim().length < 8 && (
              <span data-testid="composer-short-prompt-helper" className="text-[12px] text-ink-faint">
                {prompt.trim().length === 0
                  ? "Describe the change above (at least 8 characters) to send."
                  : "Add a few more words (at least 8 characters) to send."}
              </span>
            )}
          </div>
        ) : appsLoaded ? (
          <div
            data-testid="composer-no-apps-helper"
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3.5 py-2 text-[12.5px]"
            style={{
              borderColor: "color-mix(in srgb, var(--role) 40%, transparent)",
              background: "color-mix(in srgb, var(--role) 11%, transparent)",
            }}
          >
            <AlertTriangle size={14} className="shrink-0 text-[color:var(--role)]" aria-hidden />
            <span className="text-ink-muted">
              <strong className="font-semibold text-ink">No applications in Atlas yet:</strong> Onboard an application before sending a request.
            </span>
            <Link href="/app/atlas" className="font-semibold hover:underline" style={{ color: role.ink }}>
              Open Atlas →
            </Link>
          </div>
        ) : (
          <span />
        )}
        <LiquidMetalButton
          type="submit"
          hue={role.hue}
          disabled={busy || prompt.trim().length < 8 || !appId}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send request"} <ArrowRight size={17} />
        </LiquidMetalButton>
      </div>
    </form>
  );
}
