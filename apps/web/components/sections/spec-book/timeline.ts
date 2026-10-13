/*
 * The spec book's whole performance as one pure function of time, so the
 * landing's scroll scrub can move it forwards and backwards exactly:
 *
 *   appear → cover opens → each seat writes its page with NoX, and the page
 *   turns → the book closes → a lock band seals it → it shrinks aside and
 *   curved arrows reach out to the coding agents that can build from it →
 *   Antigravity is picked and builds with the book and the knowledge base
 *   at hand → the work comes back to the book, stamped built and verified.
 */

import { BOOK_PAGES } from "@/lib/spec-book";
import { AGENTS } from "./handoff";

export const BOOK_SPAN = 4.3;

const PAGES = BOOK_PAGES.length;
const WRITE_AT = (i: number) => 0.45 + i * 0.62;
const WRITE_LEN = 0.42;
const TURN_AT = (i: number) => WRITE_AT(i) + 0.43;
const TURN_LEN = 0.19;
const CLOSE_AT = 2.82;
const CLOSE_LEN = 0.14;
export const LOCK_AT = 3.04;
const HAND_AT = 3.18;
const HAND_LEN = 0.14;
const AGENTS_AT = 3.26;
/** When each agent's node and arrow start, after AGENTS_AT. */
const AGENT_GAP = 0.035;
const ARROW_LEN = 0.12;
const PICK_AT = 3.56;
const BUILD_AT = 3.66;
const BUILD_LEN = 0.42;
export const VERIFY_AT = 4.12;

/** Where each caption / progress step starts, for the seat buttons to jump to. */
export const STEP_TIMES = [
  ...BOOK_PAGES.map((_, i) => WRITE_AT(i) + WRITE_LEN - 0.02),
  LOCK_AT + 0.1,
  BUILD_AT + BUILD_LEN * 0.6,
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
  /** The locked book shrinking aside to make room for the agents. */
  hand: number;
  /** Each coding agent's node and arrow, 0–1. */
  agents: number[];
  /** Antigravity picked: the others dim. */
  pick: number;
  /** Antigravity's build log, 0–1. */
  build: number;
  /** The finished work travelling back to the book. */
  verify: number;
  verified: boolean;
  /** 0 intro, 1–4 the seats, 5 locked, 6 handed to the agents, 7 building, 8 verified. */
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
  const hand = ease(span(t, HAND_AT, HAND_LEN));
  const agents = AGENTS.map((_, i) => easeOut(span(t, AGENTS_AT + i * AGENT_GAP, ARROW_LEN)));
  const pick = ease(span(t, PICK_AT, 0.08));
  const build = span(t, BUILD_AT, BUILD_LEN);
  const verify = easeIn(span(t, VERIFY_AT - 0.06, 0.08));
  const verified = t >= VERIFY_AT;

  let step = 0;
  BOOK_PAGES.forEach((_, i) => {
    if (t >= WRITE_AT(i) - 0.04) step = i + 1;
  });
  if (t >= CLOSE_AT) step = 5;
  if (t >= HAND_AT) step = 6;
  if (t >= PICK_AT) step = 7;
  if (t >= VERIFY_AT) step = 8;

  return {
    appear,
    angles,
    written,
    writing,
    lastApproved: t >= WRITE_AT(PAGES - 1) + WRITE_LEN + 0.02,
    lock,
    hand,
    agents,
    pick,
    build,
    verify,
    verified,
    step,
  };
}
