"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ComingSoonPlanet } from "@/components/app/coming-soon-planet";
import { RequireAuth } from "@/components/app/guards";
import { PlanetCharacter } from "@/components/app/planet-character";
import { NoxMark } from "@/components/app/nox-mark";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { useAuth } from "@/lib/app/auth";
import { ROLE_BY_ID, ROLES, type RoleId, UPCOMING_ROLES } from "@/lib/app/roles";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Room for a planet and its props (the bulb, the ring) at each breakpoint. */
const PLANET_BOX = "h-[150px] sm:h-[190px] lg:h-[150px] xl:h-[170px]";

/** Planet size for the picker's grid: two columns on phones and tablets, five in a row from `lg`. */
const PLANET_SIZES: [query: string, size: number][] = [
  ["(min-width: 1280px)", 132],
  ["(min-width: 1024px)", 116],
  ["(min-width: 640px)", 156],
];

function usePlanetSize(): number {
  const [size, setSize] = useState(128);
  useEffect(() => {
    const queries = PLANET_SIZES.map(([q, px]) => [window.matchMedia(q), px] as const);
    const update = () => setSize(queries.find(([mq]) => mq.matches)?.[1] ?? 128);
    update();
    queries.forEach(([mq]) => mq.addEventListener("change", update));
    return () => queries.forEach(([mq]) => mq.removeEventListener("change", update));
  }, []);
  return size;
}

function RolePicker() {
  const { me, chooseRole, signOut } = useAuth();
  const router = useRouter();
  const [picked, setPicked] = useState<RoleId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<RoleId | null>(null);
  const size = usePlanetSize();

  const pick = async (role: RoleId) => {
    if (picked) return;
    setPicked(role);
    setError(null);
    try {
      await chooseRole(role);
      if (!prefersReducedMotion()) await new Promise((r) => setTimeout(r, 650));
      router.push(`/app`);
    } catch {
      setPicked(null);
      setError("Couldn't switch roles. Try again.");
    }
  };

  const current = me?.role ? ROLE_BY_ID[me.role] : null;

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

      <section className="mt-14 text-center sm:mt-20">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-nox">Demo mode</span>
        <h1 className="mt-3 font-display text-[40px] leading-[1.05] text-ink sm:text-[56px]">Choose a role to experience NoX</h1>
        <p className="mx-auto mt-4 max-w-[560px] text-[15px] leading-relaxed text-ink-muted">
          You&rsquo;re picking a role only to try the platform from that seat. Everything behind it is real. Your
          applications, knowledge bases and tickets. Switch any time from the top bar.
        </p>
        {current && (
          <button
            type="button"
            onClick={() => void pick(current.id)}
            className="mt-6 inline-flex items-center gap-2 text-[14px] font-medium hover:underline"
            style={{ color: current.ink }}
          >
            Continue as {current.name} →
          </button>
        )}
      </section>

      <ul className="mt-12 grid grid-cols-2 gap-x-4 gap-y-10 sm:mt-16 lg:grid-cols-5 lg:gap-x-4 xl:gap-x-6">
        {ROLES.map((role, index) => {
          const isPicked = picked === role.id;
          const dimmed = picked !== null && !isPicked;
          return (
            <li key={role.id}>
              <button
                type="button"
                onClick={() => void pick(role.id)}
                onMouseEnter={() => setHovered(role.id)}
                onMouseLeave={() => setHovered((h) => (h === role.id ? null : h))}
                onFocus={() => setHovered(role.id)}
                onBlur={() => setHovered((h) => (h === role.id ? null : h))}
                disabled={picked !== null}
                aria-label={`Play as ${role.name}`}
                className="group flex w-full flex-col items-center rounded-md px-2 py-4 text-center transition-opacity duration-500 focus-visible:outline-offset-4 disabled:cursor-default"
                style={{ opacity: dimmed ? 0.15 : 1 }}
              >
                <span
                  className={`flex ${PLANET_BOX} items-center justify-center transition-transform duration-[650ms] ease-[cubic-bezier(.2,.7,.2,1)] group-hover:scale-105 group-focus-visible:scale-105 motion-reduce:transition-none`}
                  style={{ transform: isPicked ? "scale(1.35)" : undefined }}
                >
                  <PlanetCharacter role={role} size={size} index={index} active={hovered === role.id || isPicked} />
                </span>
                <span className="mt-5 text-[18px] font-semibold text-ink" style={{ color: isPicked ? role.ink : undefined }}>
                  {role.name}
                </span>
                <span className="mt-2 max-w-[250px] text-[13px] leading-[1.55] text-ink-muted">{role.blurb}</span>
              </button>
            </li>
          );
        })}
        <ComingSoon size={size} dimmed={picked !== null} />
      </ul>

      {error && (
        <p role="alert" className="mt-8 text-center text-[13px] text-[color:var(--coral-ink)]">
          {error}
        </p>
      )}
      <p className="mt-auto pt-14 text-center text-[13px] text-ink-faint">
        New here? Start as the Business user. That&rsquo;s where every request begins.
      </p>
    </main>
  );
}

/** Not a seat yet: a placeholder planet that shows which seats are next when highlighted. */
function ComingSoon({ size, dimmed }: { size: number; dimmed: boolean }) {
  const [active, setActive] = useState(false);
  const on = () => setActive(true);
  const off = () => setActive(false);

  return (
    <li className="col-span-2 lg:col-span-1">
      <div
        role="group"
        tabIndex={0}
        aria-label="More roles coming soon"
        onMouseEnter={on}
        onMouseLeave={off}
        onFocus={on}
        onBlur={off}
        onClick={on}
        className="mx-auto flex w-full max-w-[340px] flex-col items-center rounded-md px-2 py-4 text-center transition-opacity duration-500 focus-visible:outline-offset-4"
        style={{ opacity: dimmed ? 0.15 : 1 }}
      >
        <span className={`flex ${PLANET_BOX} items-center justify-center`}>
          <ComingSoonPlanet size={Math.round(size * 0.88)} active={active} />
        </span>
        <span className="mt-5 text-[18px] font-semibold text-ink-muted">More coming soon</span>
        <span className="mt-2 grid">
          <span
            className="text-[13px] leading-[1.55] text-ink-faint transition-opacity duration-300 [grid-area:1/1] motion-reduce:transition-none"
            style={{ opacity: active ? 0 : 1 }}
          >
            More seats are lining up to join the crew.
          </span>
          <span className="flex flex-col items-center transition-opacity duration-300 [grid-area:1/1] motion-reduce:transition-none" style={{ opacity: active ? 1 : 0 }}>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">Joining the queue</span>
            <span className="mt-2 flex flex-wrap justify-center gap-1.5">
              {UPCOMING_ROLES.map((seat) => (
                <span key={seat.name} className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[12px] text-ink-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: seat.hue }} />
                  {seat.name}
                </span>
              ))}
            </span>
          </span>
        </span>
      </div>
    </li>
  );
}

export default function ChooseRolePage() {
  return (
    <RequireAuth needRole={false}>
      <RolePicker />
    </RequireAuth>
  );
}
