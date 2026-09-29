/*
 * The spec book's whole performance as one pure function of time, so the
 * landing's scroll scrub can move it forwards and backwards exactly:
 *
 *   appear → cover opens → each seat writes its page with NoX, and the page
 *   turns → the book closes → a lock band seals it → it's sent for
 *   development → it comes back stamped built and verified.
 */

import { BOOK_PAGES } from "@/lib/spec-book";

export const BOOK_SPAN = 3.6;

const PAGES = BOOK_PAGES.length;
const WRITE_AT = (i: number) => 0.45 + i * 0.62;
const WRITE_LEN = 0.42;
const TURN_AT = (i: number) => WRITE_AT(i) + 0.43;
const TURN_LEN = 0.19;
const CLOSE_AT = 2.82;
const CLOSE_LEN = 0.14;
export const LOCK_AT = 3.04;
const SEND_AT = 3.16;
export const RETURN_AT = 3.32;

/** Where each caption / progress step starts, for the seat buttons to jump to. */
export const STEP_TIMES = [
  ...BOOK_PAGES.map((_, i) => WRITE_AT(i) + WRITE_LEN - 0.02),
  LOCK_AT + 0.1,
  BOOK_SPAN - 0.05,
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const span = (t: number, a: number, len: number) => clamp01((t - a) / len);
const ease = (v: number) => v * v * (3 - 2 * v);
const easeIn = (v: number) => v * v * v;
const easeOut = (v: number) => 1 - (1 - v) ** 3;

export type BookState = {
  appear: number;
  /** Turn angle of the cover (0) and each page leaf (1…n), 0 = closed on the right, π = open on the left. */
  angles: number[];
  /** Characters revealed on each page, as a 0–1 share of its text. */
  written: number[];
  /** The page currently being written, or −1. */
  writing: number;
  lastApproved: boolean;
  lock: number;
  send: number;
  back: number;
  verified: boolean;
  /** 0 intro, 1–4 the seats, 5 locked, 6 sent, 7 returned. */
  step: number;
};

export function bookState(t: number): BookState {
  const appear = ease(span(t, 0, 0.15));
  const open = ease(span(t, 0.15, 0.25));
  const angles: number[] = [];

  // closing swings the left-hand stack back, top leaf first and the cover last, so the cover lands on top
  const closeFor = (layer: number) => ease(span(t, CLOSE_AT + layer * 0.02, CLOSE_LEN));

  angles.push(Math.PI * open * (1 - closeFor(PAGES - 1)));
  for (let i = 0; i < PAGES; i++) {
    if (i === PAGES - 1) {
      angles.push(0);
      continue;
    }
    const turn = ease(span(t, TURN_AT(i), TURN_LEN));
    const close = closeFor(PAGES - 2 - i);
    angles.push(Math.PI * turn * (1 - close));
  }

  const written = BOOK_PAGES.map((_, i) => span(t, WRITE_AT(i), WRITE_LEN));
  let writing = -1;
  written.forEach((w, i) => {
    if (w > 0 && w < 1) writing = i;
  });

  const lock = ease(span(t, LOCK_AT, 0.1));
  const send = easeIn(span(t, SEND_AT, 0.14));
  const back = easeOut(span(t, RETURN_AT, 0.16));
  const verified = t >= RETURN_AT;

  let step = 0;
  BOOK_PAGES.forEach((_, i) => {
    if (t >= WRITE_AT(i) - 0.04) step = i + 1;
  });
  if (t >= CLOSE_AT) step = 5;
  if (t >= SEND_AT) step = 6;
  if (t >= RETURN_AT) step = 7;

  return {
    appear,
    angles,
    written,
    writing,
    lastApproved: t >= WRITE_AT(PAGES - 1) + WRITE_LEN + 0.02,
    lock,
    send,
    back,
    verified,
    step,
  };
}
