/*
 * The hand-off after the book is locked: the coding agents that can build
 * from it, Antigravity's build log, and where everything sits in the
 * book's box. The 3D scene and the overlay both read handoffLayout(), so
 * the shrunken book and the arrows coming out of it always line up.
 */

import type { Brand } from "@/components/app/brand-logo";

/** `logo` is a mark in public/logos; Jules has none there yet, so it shows `mark`. */
export type Agent = { id: string; name: string; logo?: Brand; mark?: string };

/**
 * The `/nox` targets in packages/nox-cli/integrations, plus Jules. Antigravity sits in the
 * middle: it's the one in this developer's environment, so it's the one that builds.
 */
export const AGENTS: Agent[] = [
  { id: "jules", name: "Jules", mark: "J" },
  { id: "gemini", name: "Gemini CLI", logo: "gemini" },
  { id: "cursor", name: "Cursor", logo: "cursor" },
  { id: "antigravity", name: "Antigravity", logo: "antigravity" },
  { id: "claude", name: "Claude Code", logo: "claude" },
  { id: "codex", name: "Codex", logo: "codex" },
  { id: "copilot", name: "Copilot", logo: "copilot" },
];
/** The agent in the developer's environment: the one that builds. */
export const IN_IDE = AGENTS.findIndex((a) => a.id === "antigravity");

/** What Antigravity does with the book, one line at a time. `cite` lines read knowledge, `code` lines write it. */
export const BUILD_LOG: { text: string; meta?: string; kind: "cmd" | "cite" | "code" | "done" }[] = [
  { text: "/nox NOX-1", kind: "cmd" },
  { text: "Read the spec book", meta: "4 files", kind: "cite" },
  { text: "Read kb:login-api, kb:session", meta: "2 pages", kind: "cite" },
  { text: "src/auth.py", meta: "+48 −6", kind: "code" },
  { text: "src/config.py", meta: "+3", kind: "code" },
  { text: "7 new tests, 12 contract tests pass", kind: "code" },
  { text: "PR opened on nox/NOX-1", kind: "done" },
];

export type HandoffLayout = {
  /** Agents in a column to the right of the book, or in a row under it. */
  wide: boolean;
  /** The shrunken book: its centre, and the most of the box's height and width it may take (0–1). */
  book: { x: number; y: number; h: number; w: number };
  /** Each agent's badge centre, in px. */
  nodes: { x: number; y: number }[];
  /** The build log, in px. */
  panel: { x: number; y: number; w: number; h: number };
};

export const BADGE = 34;

export function handoffLayout(W: number, H: number): HandoffLayout {
  const n = AGENTS.length;
  const mid = (n - 1) / 2;
  if (W >= 880 && H >= 380) {
    const colX = W * 0.45;
    const nodes = AGENTS.map((_, i) => {
      const u = (i - mid) / mid;
      return { x: colX + W * 0.035 * (1 - u * u), y: H * (0.16 + (0.68 * i) / (n - 1)) };
    });
    const x = colX + W * 0.035 + 178;
    const w = Math.min(340, W - x - 12);
    const h = 236;
    const y = Math.min(H - h - 12, Math.max(12, nodes[IN_IDE].y - h / 2 + 30));
    return { wide: true, book: { x: 0.16, y: 0.5, h: 0.44, w: 0.22 }, nodes, panel: { x, y, w, h } };
  }
  const rowY = H * 0.43;
  const nodes = AGENTS.map((_, i) => {
    const u = (i - mid) / mid;
    return { x: W * (0.07 + (0.86 * i) / (n - 1)), y: rowY + H * 0.035 * (1 - u * u) };
  });
  const w = Math.min(360, W - 24);
  const top = rowY + H * 0.035 + BADGE / 2 + 30;
  const h = Math.max(150, H - top - 8);
  return { wide: false, book: { x: 0.5, y: 0.17, h: 0.26, w: 0.4 }, nodes, panel: { x: (W - w) / 2, y: top, w, h } };
}
