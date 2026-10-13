"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RequireAuth } from "@/components/app/guards";
import { NoxMark } from "@/components/app/nox-mark";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { KB_STATUS, type KbStatus } from "@/components/app/ui";
import { ApiError } from "@/lib/app/api";
import { type Estate, useAuth } from "@/lib/app/auth";
import { useApi } from "@/lib/app/use-api";

type DemoEstate = {
  available: boolean;
  orgs: { name: string; slug: string }[];
  teams: { name: string; apps: { name: string; status: KbStatus }[] }[];
  counts: { teams: number; apps: number; appsInOrbit: number; missionsInFlight: number; contracts: number } | null;
};

/**
 * First sign-in: greet the user, show them the demo estate (read-only, before they join it), and let them choose
 * between exploring it and starting with an empty sky. Either way the role picker comes next.
 */
function Welcome() {
  const { me, chooseEstate, signOut } = useAuth();
  const router = useRouter();
  const estate = useApi<DemoEstate>("/api/v1/me/demo-estate");
  const [busy, setBusy] = useState<Estate | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Already answered (a bookmark, the back button): carry on where they'd be.
  useEffect(() => {
    if (me?.onboarded && !busy) router.replace(me.role ? "/app" : "/choose-role");
  }, [me, busy, router]);

  const choose = async (choice: Estate) => {
    setBusy(choice);
    setError(null);
    try {
      await chooseEstate(choice);
      router.push("/choose-role");
    } catch (e) {
      setBusy(null);
      setError(e instanceof ApiError ? e.detail : "Couldn't save that. Try again.");
    }
  };

  const first = me?.name?.split(" ")[0];
  const demo = estate.data?.available ? estate.data : null;
  const demoName = demo?.orgs[0]?.name.split(" ")[0] ?? "the demo";
  const loading = estate.loading && !estate.data;

  return (
    <main className="mx-auto flex min-h-screen max-w-shell flex-col px-4 pb-16 pt-6 sm:px-8">
      <header className="flex items-center justify-between">
        <NoxMark size={22} />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button type="button" onClick={() => void signOut()} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-dim hover:text-ink">
            Sign out
          </button>
        </div>
      </header>

      <section className="mx-auto mt-12 flex w-full max-w-[680px] flex-col items-center text-center sm:mt-16">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-nox">{first ? `Hi ${first}` : "Hello"}</span>
        <h1 className="mt-3 font-display text-[44px] leading-[1.05] text-ink sm:text-[60px]">Welcome to NoX</h1>
        <p className="mt-4 max-w-[540px] text-[15px] leading-relaxed text-ink-muted">
          NoX keeps a live map of a company&rsquo;s applications and carries each change from one plain sentence to shipped,
          verified code.{" "}
          {demo || loading ? "We built a company for you to try it on." : "Let’s chart your first organization."}
        </p>

        {loading && <div className="mt-10 h-[220px] w-full animate-pulse rounded-lg border border-hairline bg-[rgb(var(--raise)/.4)] motion-reduce:animate-none" aria-hidden />}
        {demo && <EstateCard demo={demo} />}

        {demo ? (
          <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void choose("demo")}
              disabled={busy !== null}
              className="group flex flex-col gap-1.5 rounded-lg border p-5 text-left transition disabled:opacity-60"
              style={{
                borderColor: "rgb(var(--nox-rgb)/.65)",
                background: "linear-gradient(180deg, rgb(var(--nox-rgb)/.1), rgb(var(--raise-lo)/.8))",
                boxShadow: "0 18px 50px -30px rgb(var(--nox-rgb)/.9)",
              }}
            >
              <span className="flex items-center justify-between gap-2 text-[16px] font-semibold text-ink">
                {busy === "demo" ? `Joining ${demoName}…` : `Explore ${demoName}`}
                <span className="rounded-full border border-[rgb(var(--nox-rgb)/.6)] px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-nox">Recommended</span>
              </span>
              <span className="text-[13.5px] leading-relaxed text-ink-muted">Join the demo company. Pick a seat and follow real missions. A short tour shows you around.</span>
              <span className="mt-1 flex items-center gap-1 text-[13px] font-medium text-nox">
                Take me there <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => void choose("fresh")}
              disabled={busy !== null}
              className="group flex flex-col gap-1.5 rounded-lg border border-hairline bg-[rgb(var(--raise-lo)/.7)] p-5 text-left transition hover:border-[rgb(var(--line)/.35)] disabled:opacity-60"
            >
              <span className="text-[16px] font-semibold text-ink">{busy === "fresh" ? "Clearing the sky…" : "Start fresh"}</span>
              <span className="text-[13.5px] leading-relaxed text-ink-muted">An empty sky. Chart your own organization and onboard your own applications.</span>
              <span className="mt-1 flex items-center gap-1 text-[13px] text-ink-faint group-hover:text-ink">
                Start empty <ArrowRight size={14} />
              </span>
            </button>
          </div>
        ) : (
          !loading && (
            <button
              type="button"
              onClick={() => void choose("fresh")}
              disabled={busy !== null}
              className="mt-10 inline-flex h-12 items-center gap-2 rounded-full bg-nox px-6 text-[15px] font-semibold text-abyss disabled:opacity-60"
            >
              {busy ? "Getting ready…" : "Get started"} <ArrowRight size={17} />
            </button>
          )
        )}

        {error && (
          <p role="alert" className="mt-5 text-[13px] text-[color:var(--coral-ink)]">
            {error}
          </p>
        )}
        {demo && <p className="mt-6 text-[12.5px] text-ink-faint">You can join or leave the demo any time from your account menu.</p>}
      </section>
    </main>
  );
}

/** The demo estate at a glance: its teams with their applications, and what's going on in it. */
function EstateCard({ demo }: { demo: DemoEstate }) {
  const teams = demo.teams.filter((t) => t.apps.length).slice(0, 6);
  const c = demo.counts!;
  return (
    <section aria-label={`${demo.orgs[0]?.name ?? "Demo"} estate`} className="mt-10 w-full rounded-lg border border-hairline bg-[rgb(var(--raise-lo)/.75)] p-5 text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[20px] text-ink">{demo.orgs.map((o) => o.name).join(" · ")}</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--nox-rgb)/.5)] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-nox">
          <Sparkles size={11} aria-hidden /> Demo estate
        </span>
      </div>
      <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((t) => (
          <li key={t.name} className="min-w-0 rounded-md border border-hairline p-3">
            <span className="block text-[13px] font-semibold text-ink">{t.name}</span>
            <ul className="mt-1.5 space-y-1">
              {t.apps.slice(0, 3).map((a) => (
                <li key={a.name} className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px] text-ink-muted">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: KB_STATUS[a.status]?.color }} title={KB_STATUS[a.status]?.label} />
                  <span className="truncate">{a.name}</span>
                </li>
              ))}
              {t.apps.length > 3 && <li className="text-[11.5px] text-ink-dim">+{t.apps.length - 3} more</li>}
            </ul>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-faint">
        <span><b className="font-semibold tabular-nums text-ink">{c.teams}</b> teams</span>
        <span><b className="font-semibold tabular-nums text-ink">{c.apps}</b> applications, {c.appsInOrbit} with a code wiki in orbit</span>
        <span><b className="font-semibold tabular-nums text-ink">{c.missionsInFlight}</b> missions in flight</span>
        {c.contracts > 0 && <span><b className="font-semibold tabular-nums text-ink">{c.contracts}</b> contracts mapped</span>}
      </p>
    </section>
  );
}

export default function WelcomePage() {
  return (
    <RequireAuth needRole={false} needOnboarded={false}>
      <Welcome />
    </RequireAuth>
  );
}
