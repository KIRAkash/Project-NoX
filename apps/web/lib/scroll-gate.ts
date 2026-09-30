/**
 * Scroll rests for a scrubbed story. A long flick on a trackpad or wheel
 * would otherwise run through several beats at once; instead, when the page
 * scroll crosses a rest it is set back on that rest and held there for a
 * short beat while the rest of that flick (and its momentum) is swallowed.
 * The next deliberate scroll moves on at once: a fresh push shows up as a
 * gap in the input or a jump in its size, where momentum only ever fades.
 *
 * `stops` returns the rests in page pixels; it's read on every check, so it
 * can follow ScrollTrigger refreshes. `pass()` lets a programmatic scroll
 * (a step button's smooth scroll) run through without stopping.
 */

const MIN_HOLD_MS = 450;
const MAX_HOLD_MS = 1200;
const QUIET_MS = 140;
const KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"]);

export type ScrollGate = { pass: (ms?: number) => void; kill: () => void };

export function gateScroll(stops: () => number[]): ScrollGate {
  let last = window.scrollY;
  let held: number | null = null;
  let heldAt = 0;
  let lastInput = 0;
  let lastDelta = 0;
  let passUntil = 0;
  let timer = 0;

  const release = () => {
    held = null;
    window.clearInterval(timer);
  };

  const hold = (y: number) => {
    held = y;
    heldAt = lastInput = performance.now();
    lastDelta = 0;
    window.scrollTo({ top: y, behavior: "instant" });
    last = y;
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      const now = performance.now();
      if ((now - heldAt > MIN_HOLD_MS && now - lastInput > QUIET_MS) || now - heldAt > MAX_HOLD_MS) release();
    }, 50);
  };

  const onScroll = () => {
    const y = window.scrollY;
    if (performance.now() < passUntil) {
      last = y;
      return;
    }
    if (held !== null) {
      // touch momentum can't be cancelled, so it's undone as it happens
      if (Math.abs(y - held) > 1) window.scrollTo({ top: held, behavior: "instant" });
      return;
    }
    if (y === last) return;
    const down = y > last;
    const crossed = stops()
      .filter((s) => (down ? s > last + 1 && s <= y : s < last - 1 && s >= y))
      .sort((a, b) => (down ? a - b : b - a))[0];
    if (crossed === undefined) {
      last = y;
      return;
    }
    hold(crossed);
  };

  // while held, swallow the rest of the flick; a fresh push after the short beat moves on
  const onWheel = (e: WheelEvent) => {
    if (held === null) return;
    const now = performance.now();
    const size = Math.abs(e.deltaY);
    const fresh = now - lastInput > 90 || size > Math.max(6, lastDelta * 1.8);
    lastInput = now;
    lastDelta = size;
    if (now - heldAt > MIN_HOLD_MS && fresh) {
      release();
      return;
    }
    if (e.cancelable) e.preventDefault();
  };
  const onTouchStart = () => {
    if (held !== null && performance.now() - heldAt > MIN_HOLD_MS) release();
  };
  const onTouchMove = (e: TouchEvent) => {
    if (held === null) return;
    lastInput = performance.now();
    if (e.cancelable) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (held !== null && KEYS.has(e.key)) e.preventDefault();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("keydown", onKey);

  return {
    pass(ms = 1600) {
      release();
      passUntil = performance.now() + ms;
    },
    kill() {
      release();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
    },
  };
}
