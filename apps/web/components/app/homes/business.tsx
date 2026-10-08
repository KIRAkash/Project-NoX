"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CaptureBar } from "@/components/app/media/capture-bar";
import { CaptureCard } from "@/components/app/media/capture-card";
import { visibleCaptures } from "@/components/app/media/evidence-tab";
import { EmptyState, useToast } from "@/components/app/ui";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { api, ApiError } from "@/lib/app/api";
import type { RoleDef } from "@/lib/app/roles";
import type { MediaCapture, Mission } from "@/lib/app/types";
import { useApi } from "@/lib/app/use-api";

import { RequestCard } from "./shared";

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
  const all = useApi<Mission[]>("/api/v1/missions?view=all");
  const back = useApi<Mission[]>("/api/v1/missions?view=back");
  const waiting = useApi<Mission[]>("/api/v1/missions?view=waiting");
  const needsYou = new Set([...(back.data ?? []), ...(waiting.data ?? [])].map((m) => m.key));
  const rest = (all.data ?? []).filter((m) => !needsYou.has(m.key));

  return (
    <div className="mx-auto mt-8 max-w-[860px] space-y-10">
      <RequestComposer role={role} />

      {(back.data?.length || waiting.data?.length) ? (
        <section>
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

      <section>
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
    </div>
  );
}

function RequestComposer({ role }: { role: RoleDef }) {
  const router = useRouter();
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [apps, setApps] = useState<Suggestion[]>([]);
  const [appId, setAppId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const picked = useRef(false); // the user chose the application themselves
  // Show NoX: draft captures made before the request exists (only their uploader sees them until it's sent).
  const [captures, setCaptures] = useState<MediaCapture[]>([]);
  const [hidden, setHidden] = useState<string[]>([]); // originals of marked-up screenshots: sent, not shown
  const ready = captures.filter((c) => c.status === "ready");
  const grounded = ready.flatMap((c) => c.apps ?? []).filter((g) => g.confidence !== "low");
  const bug = ready.some((c) => c.kindOfRequest === "bug");

  // NoX picks the application from the words; the business user can change it but never has to.
  useEffect(() => {
    const text = prompt.trim();
    const t = setTimeout(async () => {
      try {
        const res = await api<Suggestion[]>("/api/v1/missions/suggest-apps", { method: "POST", json: { prompt: text.length >= 3 ? text : "app" } });
        setApps(res);
        if (!picked.current && !grounded.length) setAppId((cur) => (text.length >= 12 && res[0] ? res[0].id : cur || res[0]?.id || ""));
      } catch {
        /* suggestions are optional */
      }
    }, text.length >= 12 ? 600 : 0);
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
      const mediaIds = [...captures.filter((c) => c.status !== "withheld").map((c) => c.id), ...hidden];
      const m = await api<Mission>("/api/v1/missions", { method: "POST", json: { prompt: prompt.trim(), appIds: [appId], type: bug ? "bug" : "change", mediaIds } });
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
      <label htmlFor="ask" className="block font-display text-[26px] leading-tight text-ink sm:text-[30px]">
        What would you like to change?
      </label>
      <p className="mt-1 text-[14px] text-ink-muted">Say it the way you&rsquo;d say it to a colleague, or show NoX. NoX writes it up and gets it to the right people.</p>
      <textarea
        id="ask"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        minLength={8}
        required
        placeholder={EXAMPLES[0]}
        className="mt-4 w-full resize-y rounded-lg border border-hairline bg-[rgb(var(--void-rgb)/.6)] p-4 text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-dim focus:border-[color:var(--role)]"
      />
      <div className="mt-3">
        <CaptureBar
          global
          onMedia={(c, extra = []) => {
            setCaptures((xs) => [...xs, c]);
            setHidden((h) => [...h, ...extra]);
          }}
        />
        {captures.length > 0 && (
          <ul className="mt-4 space-y-3" aria-label="What you showed NoX">
            {visibleCaptures(captures).map((c) => (
              <li key={c.id}>
                <CaptureCard
                  capture={c}
                  onChange={(next) => setCaptures((xs) => xs.map((x) => (x.id === next.id ? next : x)))}
                  onDeleted={(id) => setCaptures((xs) => xs.filter((x) => x.id !== id))}
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
        <span className="text-[13px] text-ink-faint">
          {apps.length > 0 && (
            <>
              This sounds like{" "}
              <select
                value={appId}
                onChange={(e) => {
                  picked.current = true;
                  setAppId(e.target.value);
                }}
                aria-label="Which application"
                className="rounded-sm border border-hairline bg-deck px-1.5 py-0.5 text-[13px] text-ink"
              >
                {apps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {app && app.id === seen?.id ? " — seen in your capture" : app && app.score > 0 && prompt.trim().length >= 12 ? " — NoX's guess" : ""}
            </>
          )}
        </span>
        <LiquidMetalButton
          type="submit"
          hue={role.hue}
          disabled={busy || prompt.trim().length < 8 || !appId}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send request"} <ArrowRight size={17} />
        </LiquidMetalButton>
      </div>
    </form>
  );
}
