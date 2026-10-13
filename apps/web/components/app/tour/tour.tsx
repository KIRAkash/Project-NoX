"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/app/auth";
import type { RoleId } from "@/lib/app/roles";

import { freshTour, homeTour, type TourStep } from "./steps";

/**
 * Guided tours: one real element at a time, spotlit on the live page, with a short box beside it in the seat's hue.
 *
 * A page offers its tour with `usePageTour(key, steps, ready)`. It starts on its own once the page's data has loaded,
 * if the user hasn't finished or skipped it before (`me.toursSeen`, kept on the server). Steps point at
 * `[data-tour="…"]` anchors; a step whose anchor isn't on screen (an empty section, a narrow layout) is skipped.
 * Below 640px the box becomes a sheet at the bottom of the screen (or the top, when the target is down there).
 *
 * The rest of the page dims and can't be clicked; the spotlit element can, and using it ends the tour, so the tour
 * never fights real work. Esc ends it, ← and → move between steps, and the account menu can replay it.
 */

type Active = { key: string; steps: TourStep[]; index: number };
type Registered = { key: string; steps: TourStep[] };

type TourApi = {
  active: boolean;
  /** The tour this page offers, for "Replay the tour". */
  registered: Registered | null;
  register: (r: Registered | null) => void;
  start: (key: string, steps: TourStep[]) => boolean;
  replay: () => Promise<void>;
};

const TourContext = createContext<TourApi | null>(null);

const PROGRESS = (key: string) => `nox.tour.${key}`;
const PHONE = 640;
const GAP = 14;
const EDGE = 16;
const PAD = 6;

function readProgress(key: string): number {
  try {
    return Number(window.sessionStorage.getItem(PROGRESS(key)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeProgress(key: string, index: number | null) {
  try {
    if (index === null) window.sessionStorage.removeItem(PROGRESS(key));
    else window.sessionStorage.setItem(PROGRESS(key), String(index));
  } catch {
    /* storage unavailable: progress lives for this page view only */
  }
}

/** The first visible element carrying this anchor (the sidebar and the bottom nav both carry nav anchors). */
export function findTarget(name: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

function present(step: TourStep) {
  return !step.target || findTarget(step.target) !== null;
}

function inFixedLayer(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const pos = getComputedStyle(node).position;
    if (pos === "fixed" || pos === "sticky") return true;
  }
  return false;
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { markTourSeen, replayTour } = useAuth();
  const [active, setActive] = useState<Active | null>(null);
  const [registered, setRegistered] = useState<Registered | null>(null);
  const pathname = usePathname();
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;
  const startedOn = useRef<string | null>(null);

  const start = useCallback(
    (key: string, steps: TourStep[]) => {
      const live = steps.filter(present);
      if (live.filter((s) => s.target).length < 2) return false; // not enough on screen to be worth a tour
      startedOn.current = pathname;
      setActive({ key, steps: live, index: Math.min(readProgress(key), live.length - 1) });
      return true;
    },
    [pathname],
  );

  const end = useCallback(
    (seen: boolean) => {
      const cur = activeRef.current;
      if (!cur) return;
      activeRef.current = null;
      writeProgress(cur.key, seen ? null : cur.index);
      if (seen) markTourSeen(cur.key);
      setActive(null);
    },
    [markTourSeen],
  );

  const replay = useCallback(async () => {
    if (!registered) return;
    writeProgress(registered.key, null);
    await replayTour(registered.key).catch(() => undefined);
    start(registered.key, registered.steps);
  }, [registered, replayTour, start]);

  // Leaving the page (the back button) puts the tour away; it resumes at the same step next visit.
  useEffect(() => {
    if (activeRef.current && startedOn.current !== pathname) end(false);
  }, [pathname, end]);

  const value = useMemo<TourApi>(() => ({ active: active !== null, registered, register: setRegistered, start, replay }), [active, registered, start, replay]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && (
        <TourOverlay
          key={active.key}
          tour={active}
          onIndex={(index) => {
            writeProgress(active.key, index);
            setActive({ ...active, index });
          }}
          onEnd={end}
        />
      )}
    </TourContext.Provider>
  );
}

export function useTour(): TourApi {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside <TourProvider>");
  return ctx;
}

/**
 * Offer this page's tour. It starts by itself once `ready` (the page's data is in), after a short settle, unless the
 * user has seen it. Pass a different `key` to offer a different tour (the fresh-start tour on an empty home).
 */
export function usePageTour(key: string, steps: TourStep[], ready: boolean) {
  const { me } = useAuth();
  const { register, start, active } = useTour();
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  useEffect(() => {
    register({ key, steps: stepsRef.current });
    return () => register(null);
  }, [key, register]);
  useEffect(() => {
    register({ key, steps });
  }, [steps]); // eslint-disable-line react-hooks/exhaustive-deps -- keep the replay list current

  const seen = !me?.onboarded || me.toursSeen.includes(key);
  const tried = useRef(false);
  useEffect(() => {
    tried.current = false;
  }, [key]);
  useEffect(() => {
    if (!ready || seen || active || tried.current) return;
    const t = setTimeout(() => {
      tried.current = start(key, stepsRef.current);
    }, 700);
    return () => clearTimeout(t);
  }, [ready, seen, active, key, start]);
}

// ── The overlay: spotlight, scrim and the step box ───────────────────────────

type Rect = { top: number; left: number; width: number; height: number };

function sameRect(a: Rect | null, b: Rect | null) {
  return !!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

function TourOverlay({ tour, onIndex, onEnd }: { tour: Active; onIndex: (i: number) => void; onEnd: (seen: boolean) => void }) {
  const step = tour.steps[tour.index];
  const last = tour.index === tour.steps.length - 1;
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState({ w: 340, h: 180 });
  const boxRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = `tour-title-${tour.index}`;
  const bodyId = `tour-body-${tour.index}`;

  const go = useCallback(
    (dir: 1 | -1) => {
      let i = tour.index + dir;
      while (i >= 0 && i < tour.steps.length && !present(tour.steps[i])) i += dir; // its anchor left the page
      if (i < 0) return;
      if (i >= tour.steps.length) onEnd(true);
      else onIndex(i);
    },
    [tour, onIndex, onEnd],
  );

  // Find this step's target and bring it into view, clear of the sticky top bar and of the box.
  useEffect(() => {
    if (!step.target) {
      setTarget(null);
      setRect(null);
      return;
    }
    const el = findTarget(step.target);
    if (!el) {
      go(1);
      return;
    }
    setTarget(el);
    if (!inFixedLayer(el)) {
      const r = el.getBoundingClientRect();
      const phone = window.innerWidth < PHONE;
      const room = phone ? window.innerHeight * 0.5 : window.innerHeight - 220;
      if (r.top < 72 || r.bottom > room) {
        window.scrollTo({ top: window.scrollY + r.top - (phone ? 76 : 96), behavior: reducedMotion() ? "auto" : "smooth" });
      }
    }
  }, [step, go]);

  // Follow the target as the page scrolls, resizes or reflows.
  useEffect(() => {
    let frame = 0;
    let prev: Rect | null = null;
    const tick = () => {
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      if (target) {
        if (!target.isConnected) {
          go(1);
          return;
        }
        const r = target.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        if (!sameRect(prev, next)) {
          prev = next;
          setRect(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target, go]);

  // Using the spotlit element is the real thing: let it through and put the tour away.
  useEffect(() => {
    if (!target) return;
    const used = () => onEnd(true);
    target.addEventListener("pointerdown", used, { capture: true });
    return () => target.removeEventListener("pointerdown", used, { capture: true });
  }, [target, onEnd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEnd(true);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onEnd]);

  // Focus moves into the box with each step and goes back where it was when the tour ends.
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    return () => returnFocus.current?.focus?.();
  }, []);
  useEffect(() => {
    boxRef.current?.focus({ preventScroll: true });
  }, [tour.index]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.w === el.offsetWidth && b.h === el.offsetHeight ? b : { w: el.offsetWidth, h: el.offsetHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tour.index]);

  if (!view.w) return null;
  const phone = view.w < PHONE;
  // A tall section (a long list, a big map) is spotlit from its top: its heading and first items, with room below for the box.
  const tallCap = phone ? view.h * 0.4 : Math.max(240, view.h * 0.45);
  const hole: Rect | null = rect
    ? {
        top: Math.max(rect.top - PAD, 0),
        left: Math.max(rect.left - PAD, 0),
        width: Math.min(rect.width + PAD * 2, view.w),
        height: Math.min(rect.height + PAD * 2, tallCap, view.h - Math.max(rect.top - PAD, 0)),
      }
    : null;
  const waiting = Boolean(step.target) && !hole; // the target is found but not measured yet

  // Where the box goes: below, above, right or left of the hole, whichever fits; centred when there's no target.
  let place: { top: number; left: number; arrow?: { side: "top" | "bottom" | "left" | "right"; at: number } } | null = null;
  let sheetAt: "top" | "bottom" = "bottom";
  if (phone) {
    sheetAt = hole && hole.top + hole.height / 2 > view.h * 0.55 ? "top" : "bottom";
  } else if (!hole) {
    place = { top: Math.max((view.h - box.h) / 2, EDGE), left: (view.w - box.w) / 2 };
  } else {
    const clampX = (x: number) => Math.min(Math.max(x, EDGE), view.w - box.w - EDGE);
    const clampY = (y: number) => Math.min(Math.max(y, 72), view.h - box.h - EDGE);
    const cx = hole.left + hole.width / 2;
    const cy = hole.top + hole.height / 2;
    if (hole.top + hole.height + GAP + box.h <= view.h - EDGE) {
      const left = clampX(hole.left);
      place = { top: hole.top + hole.height + GAP, left, arrow: { side: "top", at: Math.min(Math.max(cx - left, 22), box.w - 22) } };
    } else if (hole.top - GAP - box.h >= 64) {
      const left = clampX(hole.left);
      place = { top: hole.top - GAP - box.h, left, arrow: { side: "bottom", at: Math.min(Math.max(cx - left, 22), box.w - 22) } };
    } else if (hole.left + hole.width + GAP + box.w <= view.w - EDGE) {
      const top = clampY(cy - 40);
      place = { top, left: hole.left + hole.width + GAP, arrow: { side: "left", at: Math.min(Math.max(cy - top, 22), box.h - 22) } };
    } else if (hole.left - GAP - box.w >= EDGE) {
      const top = clampY(cy - 40);
      place = { top, left: hole.left - GAP - box.w, arrow: { side: "right", at: Math.min(Math.max(cy - top, 22), box.h - 22) } };
    } else {
      place = { top: view.h - box.h - EDGE, left: view.w - box.w - EDGE }; // a very large target: sit in its corner
    }
  }

  const ring: React.CSSProperties = hole
    ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height }
    : { top: view.h / 2, left: view.w / 2, width: 0, height: 0 };
  const blockers: React.CSSProperties[] = hole
    ? [
        { top: 0, left: 0, right: 0, height: hole.top },
        { top: hole.top + hole.height, left: 0, right: 0, bottom: 0 },
        { top: hole.top, left: 0, width: hole.left, height: hole.height },
        { top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height },
      ]
    : [{ inset: 0 }];

  const intro = !step.target;
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--role)]">
          {intro ? "Quick tour" : `Step ${tour.steps.slice(0, tour.index + 1).filter((s) => s.target).length} of ${tour.steps.filter((s) => s.target).length}`}
        </span>
        <button type="button" onClick={() => onEnd(true)} aria-label="End the tour" className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full text-ink-dim hover:bg-[rgb(var(--line)/.08)] hover:text-ink">
          <X size={15} />
        </button>
      </div>
      <h2 id={titleId} className="mt-1.5 font-display text-[17px] font-semibold leading-snug text-ink">
        {step.title}
      </h2>
      <p id={bodyId} className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-muted">
        {step.body}
      </p>
      {step.tip && <p className="mt-2.5 border-l-2 border-[color:var(--role)] pl-2.5 text-[12.5px] leading-relaxed text-ink">{step.tip}</p>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="h-1 min-w-[40px] max-w-[120px] flex-1 overflow-hidden rounded-full bg-[rgb(var(--line)/.18)]" aria-hidden>
          <span
            className="block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${((tour.index + 1) / tour.steps.length) * 100}%`, background: "var(--role)" }}
          />
        </span>
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          {tour.index === 0 ? (
            <button type="button" onClick={() => onEnd(true)} className="h-8 rounded-sm px-2.5 text-[12.5px] text-ink-faint hover:text-ink">
              {intro ? "Not now" : "Skip tour"}
            </button>
          ) : (
            <button type="button" onClick={() => go(-1)} className="h-8 rounded-sm border border-hairline px-3 text-[12.5px] text-ink-muted hover:text-ink">
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => go(1)}
            className="h-8 rounded-sm px-3.5 text-[12.5px] font-semibold text-abyss"
            style={{ background: "var(--role-glow, var(--role))" }}
          >
            {last ? "Done" : intro ? "Show me around" : "Next"}
          </button>
        </span>
      </div>
    </>
  );

  return (
    <div className="tour-layer fixed inset-0 z-[60]" data-tour-active="">
      {blockers.map((style, i) => (
        <div key={i} className="fixed" style={style} aria-hidden />
      ))}
      {/* One element draws both the dimmed page (its huge shadow) and the ring around the target. */}
      <div
        aria-hidden
        className={`tour-spot pointer-events-none fixed rounded-[14px] transition-[top,left,width,height] duration-200 ease-out motion-reduce:transition-none ${hole ? "" : "no-hole"}`}
        style={{ ...ring, opacity: waiting ? 0 : 1 }}
      />
      {hole && <div aria-hidden className="tour-halo pointer-events-none fixed rounded-[14px]" style={ring} />}

      {phone ? (
        <div
          ref={boxRef}
          key={tour.index}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
          className={`tour-in fixed inset-x-0 border-hairline bg-deck px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-2.5 shadow-2xl outline-none ${
            sheetAt === "bottom" ? "bottom-0 rounded-t-[20px] border-t" : "top-0 rounded-b-[20px] border-b pt-[calc(12px+env(safe-area-inset-top,0px))]"
          }`}
          style={{ opacity: waiting ? 0 : 1 }}
        >
          {sheetAt === "bottom" && <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-[rgb(var(--line)/.3)]" aria-hidden />}
          {content}
        </div>
      ) : (
        <div
          ref={boxRef}
          key={tour.index}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
          className="tour-in fixed w-[340px] max-w-[calc(100vw-32px)] rounded-[14px] border border-[rgb(var(--line)/.3)] bg-deck p-4 shadow-2xl outline-none"
          style={{ top: place?.top, left: place?.left, opacity: waiting ? 0 : 1 }}
        >
          {place?.arrow && <Arrow side={place.arrow.side} at={place.arrow.at} />}
          {content}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {step.title}
      </span>
    </div>
  );
}

function Arrow({ side, at }: { side: "top" | "bottom" | "left" | "right"; at: number }) {
  const base = "absolute h-3 w-3 rotate-45 border-[rgb(var(--line)/.3)] bg-deck";
  if (side === "top") return <span aria-hidden className={`${base} -top-[7px] border-l border-t`} style={{ left: at - 6 }} />;
  if (side === "bottom") return <span aria-hidden className={`${base} -bottom-[7px] border-b border-r`} style={{ left: at - 6 }} />;
  if (side === "left") return <span aria-hidden className={`${base} -left-[7px] border-b border-l`} style={{ top: at - 6 }} />;
  return <span aria-hidden className={`${base} -right-[7px] border-r border-t`} style={{ top: at - 6 }} />;
}

/** A seat's home offers its own tour, or the fresh-start tour while the user isn't in any organization. */
export function useHomeTour(role: RoleId, ready: boolean) {
  const { me } = useAuth();
  const fresh = (me?.orgs.length ?? 0) === 0;
  const key = fresh ? "fresh" : `home:${role}`;
  const steps = useMemo(() => (fresh ? freshTour(role) : homeTour(role)), [fresh, role]);
  usePageTour(key, steps, ready);
}
