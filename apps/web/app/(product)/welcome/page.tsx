"use client";

import { ArrowRight, BookOpen, ChevronLeft, ChevronRight, ExternalLink, RotateCcw } from "lucide-react";
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
const HOLD = [2400, 2600, 2800, 3000];

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
          A demo company is ready so you can see NoX at work. Or start empty with your own applications.
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
  const tidewell = demo.orgs[0]?.slug === "tidewell";
  const note = tidewell ? "(a mock insurance company)" : "(a mock enterprise)";
  const c = demo.counts!;

  const beats = useMemo<{ beat: SkyBeat; text: string }[]>(
    () => [
      { beat: "org", text: `${first ? `Hi ${first}. ` : ""}Meet ${org}, ${tidewell ? "a mock insurer" : "a mock company"} we set up for you.` },
      { beat: "teams", text: `It's organised into ${num(c.teams)} teams.` },
      { beat: "apps", text: `Each team owns its applications: ${num(c.apps)} in all.` },
      { beat: "lit", text: "NoX read their code and docs in real tools and wrote each one a code wiki." },
      {
        beat: "flight",
        text: c.missionsInFlight
          ? `${Num(c.missionsInFlight)} ${c.missionsInFlight === 1 ? "change is" : "changes are"} in flight right now.`
          : "Nothing is in flight yet. The first change can be yours.",
      },
    ],
    [first, org, tidewell, c],
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
      if (to < beats.length - 1) timer.current = setTimeout(() => go(to + 1, false), HOLD[to] ?? 2800);
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
      <div className="relative z-10 -mx-4 mt-2 min-h-[300px] flex-1 sm:-mx-8 lg:min-h-[250px]">
        <WelcomeSky
          ref={sky}
          org={org}
          note={note}
          teams={demo.teams}
          // The real tools arrive with the code wikis they fed, once the applications are on the map.
          tools={demo.sources.length > 0 ? <Tools groups={demo.sources} shown={beat >= 3} /> : undefined}
          onReady={start}
        />
      </div>

      <div className="mx-auto flex w-full max-w-[760px] flex-col items-center text-center">
        {/* The caption, with arrows to step back or ahead; left alone, the story moves on by itself. */}
        <div className="mt-2 flex w-full items-center justify-center gap-3">
          <StepArrow dir="back" disabled={beat <= 0} onClick={() => go(beat - 1, true)} />
          <div className="flex min-h-[2.8em] min-w-0 flex-1 items-center justify-center sm:min-h-[1.6em]" aria-live="polite">
            <p ref={caption} key={beat} className="text-balance font-display text-[18px] leading-[1.3] text-ink sm:text-[21px]">
              {beats[Math.max(beat, 0)].text}
            </p>
          </div>
          <StepArrow dir="next" disabled={beat >= beats.length - 1} onClick={() => go(beat + 1, false)} />
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

function StepArrow({ dir, disabled, onClick }: { dir: "back" | "next"; disabled: boolean; onClick: () => void }) {
  const Icon = dir === "back" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "back" ? "Previous" : "Next"}
      title={dir === "back" ? "Previous" : "Next"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline text-ink-muted transition-colors hover:border-[rgb(var(--line)/.4)] hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon size={16} />
    </button>
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
  wiki: { name: "Code wikis by NoX", one: "repository", many: "repositories" },
};

/**
 * Proof that the demo is real, kept small: the logos of the tools its applications are built from, under the
 * company's own logo. Each one opens a list of links to the actual repositories, spaces, projects, channels and pages.
 */
function Tools({ groups, shown }: { groups: SourceGroup[]; shown: boolean }) {
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

  const current = groups.find((g) => g.type === open);
  const kindOf = (t: string) => SOURCE_KIND[t] ?? { name: t, one: "source", many: "sources" };

  return (
    <div
      ref={root}
      aria-hidden={!shown}
      className="relative flex flex-wrap items-center justify-center gap-1.5 transition-opacity duration-700 motion-reduce:transition-none"
      style={{ opacity: shown ? 1 : 0, pointerEvents: shown ? "auto" : "none" }}
    >
      <span className="mr-0.5 text-[11px] text-ink-faint">Real tools:</span>
      {groups.map((g) => {
        const kind = kindOf(g.type);
        const n = g.items.length;
        const label = `${kind.name}: ${n} ${n === 1 ? kind.one : kind.many}`;
        return (
          <button
            key={g.type}
            type="button"
            onClick={() => setOpen(open === g.type ? null : g.type)}
            aria-expanded={open === g.type}
            aria-label={label}
            title={label}
            tabIndex={shown ? 0 : -1}
            className="flex h-6 w-6 items-center justify-center rounded-full border bg-deck transition-colors hover:border-[rgb(var(--line)/.4)]"
            style={{ borderColor: open === g.type ? "var(--nox)" : "rgb(var(--line)/.18)" }}
          >
            {g.type === "wiki" ? <BookOpen size={12} className="text-nox" aria-hidden /> : g.type in SOURCE_KIND ? <BrandLogo name={g.type as "github"} size={12} title="" /> : null}
          </button>
        );
      })}
      {current && (
        <div className="absolute left-1/2 top-full z-30 mt-2 w-max min-w-[230px] max-w-[300px] -translate-x-1/2 rounded-sm border border-hairline bg-deck p-3 text-left shadow-[0_14px_40px_-16px_rgb(0_0_0/.55)]">
          <p className="mb-2 text-[12px] font-semibold text-ink">
            {kindOf(current.type).name} · <span className="font-normal text-ink-faint">{current.items.length} {current.items.length === 1 ? kindOf(current.type).one : kindOf(current.type).many}</span>
          </p>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto">
            {current.items.map((it) => (
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
        </div>
      )}
    </div>
  );
}

export default function WelcomePage() {
  return (
    <RequireAuth needRole={false} needOnboarded={false}>
      <Welcome />
    </RequireAuth>
  );
}
