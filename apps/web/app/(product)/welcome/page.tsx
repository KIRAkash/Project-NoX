"use client";

import { ArrowRight, BookOpen, Check, ExternalLink, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrandLogo } from "@/components/app/brand-logo";
import { RequireAuth } from "@/components/app/guards";
import { NoxMark } from "@/components/app/nox-mark";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { type SkyBeat, type SkyHandle, type SkyTeam, WelcomeSky } from "@/components/app/welcome-sky";
import { LiquidMetalButton } from "@/components/liquid-metal/liquid-metal";
import { ApiError } from "@/lib/app/api";
import { type Estate, useAuth } from "@/lib/app/auth";
import { useApi } from "@/lib/app/use-api";
import { gsap, prefersReducedMotion } from "@/lib/motion";

type DemoEstate = {
  available: boolean;
  orgs: { name: string; slug: string }[];
  teams: SkyTeam[];
  sources: SourceGroup[];
  counts: { teams: number; apps: number; appsInOrbit: number; missionsInFlight: number; contracts: number } | null;
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const num = (n: number) => WORDS[n] ?? String(n);
const Num = (n: number) => {
  const w = num(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** How long each caption holds before the next one, in ms. */
const HOLD = [3200, 3600, 3800, 4000];

/**
 * First sign-in. The demo company is drawn as a night sky while short captions tell its story one after another:
 * the company, its teams and applications, the code wikis NoX wrote and the contracts it mapped, the work in flight.
 * One action, Proceed with Tidewell; starting fresh is a quiet link beside it.
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

  const demo = estate.data?.available ? estate.data : null;
  const loading = estate.loading && !estate.data;

  return (
    <main className="relative mx-auto flex min-h-[100svh] w-full max-w-[1320px] flex-col px-4 pb-5 pt-5 sm:px-8">
      {/* The headline carries the wordmark on this page, so the header keeps only the controls, floating in the corner. */}
      <header className="absolute right-4 top-4 z-20 flex items-center sm:right-8">
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button type="button" onClick={() => void signOut()} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint hover:text-ink">
            Sign out
          </button>
        </div>
      </header>

      <h1 className="mt-10 flex flex-wrap items-center justify-center gap-x-[0.28em] text-center font-display text-[38px] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[52px] lg:mt-1">
        <span>Welcome to</span>
        <span className="sr-only">NoX</span>
        <span aria-hidden className="translate-y-[0.04em] sm:hidden">
          <NoxMark size={38} />
        </span>
        <span aria-hidden className="hidden translate-y-[0.04em] sm:inline-flex">
          <NoxMark size={52} />
        </span>
      </h1>
      {(loading || demo) && (
        <p className="mx-auto mt-2 max-w-[640px] text-balance text-center text-[14.5px] leading-relaxed text-ink-muted sm:text-[15.5px]">
          We&rsquo;ve set up a demo company so you can see NoX at work right away. Or start with an empty workspace and onboard
          your own applications.
        </p>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center" role="status" aria-label="Loading">
          <span className="h-2.5 w-2.5 animate-ping rounded-full bg-nox motion-reduce:animate-none" />
        </div>
      ) : demo ? (
        <Story demo={demo} first={me?.name?.split(" ")[0] ?? null} busy={busy} onChoose={(c) => void choose(c)} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="max-w-[520px] text-[17px] leading-relaxed text-ink-muted">
            NoX keeps a live map of a company&rsquo;s applications and carries each change from one plain sentence to shipped,
            verified code. Let&rsquo;s chart your first organization.
          </p>
          <LiquidMetalButton
            type="button"
            onClick={() => void choose("fresh")}
            disabled={busy !== null}
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold disabled:opacity-60"
          >
            {busy ? "Getting ready…" : "Get started"} <ArrowRight size={17} />
          </LiquidMetalButton>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-center text-[13px] text-[color:var(--coral-ink)]">
          {error}
        </p>
      )}
    </main>
  );
}

function Story({ demo, first, busy, onChoose }: { demo: DemoEstate; first: string | null; busy: Estate | null; onChoose: (c: Estate) => void }) {
  const sky = useRef<SkyHandle>(null);
  const caption = useRef<HTMLParagraphElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [beat, setBeat] = useState(-1);
  const org = demo.orgs[0]?.name ?? "the demo company";
  const short = org.split(" ")[0];
  const note = demo.orgs[0]?.slug === "tidewell" ? "(a mock insurance company)" : "(a mock enterprise)";
  const c = demo.counts!;

  const beats = useMemo<{ beat: SkyBeat; text: string }[]>(
    () => [
      { beat: "org", text: `${first ? `Hi ${first}. ` : ""}To show you NoX at work, we set up a mock enterprise: ${org}.` },
      { beat: "teams", text: `It's organised into ${num(c.teams)} teams, the way a real company would be.` },
      { beat: "apps", text: `Each team owns its own applications, ${num(c.apps)} in all. Every dot is one.` },
      {
        beat: "lit",
        text: c.contracts
          ? `NoX read each application's code and docs from the tools below, wrote it a code wiki that stays in sync, and mapped the ${c.contracts} contracts between them.`
          : "NoX read each application's code and docs from the tools below and wrote it a code wiki that stays in sync.",
      },
      {
        beat: "flight",
        text: c.missionsInFlight
          ? `${Num(c.missionsInFlight)} ${c.missionsInFlight === 1 ? "change is" : "changes are"} already in flight across these teams, each moving through four seats.`
          : "Nothing is in flight yet, so the first change can be yours.",
      },
    ],
    [first, org, c],
  );

  // Jump to a beat: the sky shows every layer up to it at once, then the story carries on from there.
  const go = useCallback(
    (to: number, instant: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      if (instant) {
        sky.current?.reset();
        for (let i = 0; i <= to; i++) sky.current?.play(beats[i].beat, true);
      } else {
        sky.current?.play(beats[to].beat);
      }
      setBeat(to);
      if (to < beats.length - 1) timer.current = setTimeout(() => go(to + 1, false), HOLD[to] ?? 3600);
    },
    [beats],
  );

  const start = useCallback(() => {
    sky.current?.reset();
    go(0, false);
  }, [go]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Each caption arrives out of a soft blur and leaves upward; with reduced motion it only fades.
  useEffect(() => {
    const el = caption.current;
    if (!el || beat < 0) return;
    const still = prefersReducedMotion();
    gsap.fromTo(
      el,
      still ? { opacity: 0 } : { opacity: 0, y: 14, filter: "blur(8px)" },
      still ? { opacity: 1, duration: 0.4 } : { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.8, ease: "expo.out" },
    );
  }, [beat]);

  const done = beat === beats.length - 1;

  return (
    <>
      {/* The map takes whatever height is left, so the whole page fits one screen on a laptop. */}
      <div className="relative -mx-4 mt-2 min-h-[300px] flex-1 sm:-mx-8 lg:min-h-[250px]">
        <WelcomeSky ref={sky} org={org} note={note} teams={demo.teams} onReady={start} />
      </div>

      {/* The real tools behind the demo arrive once its applications have. */}
      {demo.sources.length > 0 && (
        <div
          className="transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none"
          style={{ opacity: beat >= 3 ? 1 : 0, transform: beat >= 3 ? "none" : "translateY(8px)", pointerEvents: beat >= 3 ? "auto" : "none" }}
          aria-hidden={beat < 3}
        >
          <Sources groups={demo.sources} />
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[760px] flex-col items-center text-center">
        <div className="mt-3 flex min-h-[4em] items-center justify-center sm:min-h-[2.8em]" aria-live="polite">
          <p ref={caption} key={beat} className="text-balance font-display text-[19px] leading-[1.3] text-ink sm:text-[22px]">
            {beats[Math.max(beat, 0)].text}
          </p>
        </div>

        <div className="mt-1 flex items-center gap-1.5" role="group" aria-label="Story">
          {beats.map((b, i) => (
            <button
              key={b.beat}
              type="button"
              onClick={() => go(i, true)}
              aria-label={`Part ${i + 1} of ${beats.length}`}
              aria-current={i === beat ? "step" : undefined}
              className="group -mx-[5px] flex h-6 items-center"
            >
              <span
                className="block h-[3px] w-[22px] rounded-full transition-[transform,opacity,background-color] duration-300 motion-reduce:transition-none"
                style={{
                  transform: `scaleX(${i === beat ? 1 : 8 / 22})`,
                  background: i <= beat ? "var(--nox)" : "rgb(var(--line)/.25)",
                  opacity: i < beat ? 0.55 : 1,
                }}
              />
            </button>
          ))}
          <button
            type="button"
            onClick={start}
            aria-label="Watch again"
            title="Watch again"
            className="ml-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ink-dim transition-opacity hover:text-ink"
            style={{ opacity: done ? 1 : 0, pointerEvents: done ? "auto" : "none" }}
          >
            <RotateCcw size={13} />
          </button>
        </div>

        <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
          <LiquidMetalButton
            type="button"
            onClick={() => onChoose("demo")}
            disabled={busy !== null}
            className="group inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold disabled:opacity-60"
          >
            {busy === "demo" ? `Joining ${short}…` : `Proceed with ${short}`}
            <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </LiquidMetalButton>
          <button
            type="button"
            onClick={() => onChoose("fresh")}
            disabled={busy !== null}
            className="text-[13.5px] text-ink-faint underline decoration-[rgb(var(--line)/.35)] underline-offset-4 transition-colors hover:text-ink hover:decoration-current disabled:opacity-50"
          >
            {busy === "fresh" ? "Setting up an empty workspace…" : "Start empty and onboard my own applications"}
          </button>
        </div>
      </div>
    </>
  );
}

type SourceGroup = { type: string; items: { url: string | null; label: string; apps: string[] }[] };

const SOURCE_KIND: Record<string, { name: string; one: string; many: string }> = {
  github: { name: "GitHub", one: "repository", many: "repositories" },
  confluence: { name: "Confluence", one: "space", many: "spaces" },
  jira: { name: "Jira", one: "project", many: "projects" },
  slack: { name: "Slack", one: "channel", many: "channels" },
  notion: { name: "Notion", one: "page", many: "pages" },
  upload: { name: "Uploads", one: "file", many: "files" },
  wiki: { name: "Code wikis by NoX", one: "repo", many: "repos" },
};

/**
 * Proof that the demo is real: one ticked chip per tool its applications are built from. Each chip opens a list of
 * links to the actual repositories, spaces, projects, channels and pages. The last chip is what NoX produced from them.
 */
function Sources({ groups }: { groups: SourceGroup[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <section ref={root} aria-label="The real tools behind the demo" className="mx-auto mt-1 flex w-full flex-col items-center gap-2">
      <p className="text-center text-[12.5px] text-ink-faint">
        <span className="font-medium text-ink-muted">The company is made up. Its tools are real.</span> Open any of them:
      </p>
      <ul className="flex flex-wrap justify-center gap-1.5">
        {groups.map((g) => {
          const kind = SOURCE_KIND[g.type] ?? { name: g.type, one: "source", many: "sources" };
          const n = g.items.length;
          const isOpen = open === g.type;
          return (
            <li key={g.type} className="relative">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : g.type)}
                aria-expanded={isOpen}
                aria-label={`${kind.name}: ${n} ${n === 1 ? kind.one : kind.many}`}
                title={`${kind.name}: ${n} ${n === 1 ? kind.one : kind.many}`}
                className="flex h-8 items-center gap-1.5 rounded-full border border-hairline bg-[rgb(var(--raise-lo)/.75)] pl-1.5 pr-2.5 text-[12.5px] transition-colors hover:border-[rgb(var(--line)/.35)]"
                style={isOpen ? { borderColor: "var(--nox)" } : undefined}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[color:var(--verify)] text-abyss" aria-hidden>
                  <Check size={10} strokeWidth={3} />
                </span>
                {/* The tool's logo says which it is; the name is in the tooltip and for screen readers. */}
                {g.type === "wiki" ? <BookOpen size={15} className="shrink-0 text-nox" aria-hidden /> : g.type in SOURCE_KIND ? <BrandLogo name={g.type as "github"} size={15} title="" /> : null}
                <span className="font-medium tabular-nums text-ink" aria-hidden>
                  {n}
                  {g.type === "wiki" && <span className="font-normal text-ink-faint"> code wikis</span>}
                </span>
              </button>
              {isOpen && (
                <ul className="absolute bottom-full left-1/2 z-30 mb-2 max-h-56 w-max min-w-[220px] max-w-[300px] -translate-x-1/2 space-y-1.5 overflow-y-auto rounded-sm border border-hairline bg-deck p-3 text-left shadow-[0_14px_40px_-16px_rgb(0_0_0/.55)]">
                  {g.items.map((it) => (
                    <li key={`${it.label}-${it.url}`} className="min-w-0 leading-snug">
                      {it.url ? (
                        <a href={it.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-[12px] text-ink-muted hover:text-ink">
                          <span className="truncate">{it.label}</span>
                          <ExternalLink size={11} className="shrink-0 text-ink-dim" aria-hidden />
                        </a>
                      ) : (
                        <span className="font-mono text-[12px] text-ink-muted">{it.label}</span>
                      )}
                      {it.apps.length > 1 && <span className="block truncate text-[11.5px] text-ink-faint">{it.apps.join(", ")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
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
