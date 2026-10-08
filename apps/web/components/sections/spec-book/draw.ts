/*
 * Everything printed on the spec book, drawn onto 2D canvases that become
 * the page textures. The book is a mission file, not a diploma: a deep-space
 * cover with the N●X star and the four seats' planets on their orbits, and
 * pages of clean white paper (a faint dot grid, an orbit watermark)
 * carrying the spec files in dense Markdown.
 *
 * Page text is laid out once per page into positioned runs; a redraw only
 * replays those runs up to the reveal count, so writing live is cheap.
 */

import { ROLES, ROLE_BY_ID, type RoleId } from "@/lib/app/roles";
import { BOOK_APP, BOOK_KEY, BOOK_PAGES, BOOK_TITLE, type Block, type BlockKind } from "@/lib/spec-book";

export const TEX_W = 1024;
export const TEX_H = 1414; // the page's 1 : 1.38 proportion

const INK = "#131A2C";
const INK_SOFT = "#3D4660";
const INK_FAINT = "rgba(19,26,44,.34)";
const RULE = "rgba(19,26,44,.12)";
const NOX_GOLD = "#D99A2B";
const CITE = "#2F67B1";
const SPACE_INK = "#ECEFF8";
const MARGIN = 76;
const TOP = 214;
const BOTTOM = TEX_H - 96;

export type Fonts = { sans: string; mono: string; display: string };

export function readFonts(): Fonts {
  const root = getComputedStyle(document.documentElement);
  const pick = (v: string, fallback: string) => (v.trim() ? `${v.trim()}, ${fallback}` : fallback);
  return {
    sans: pick(root.getPropertyValue("--font-sans"), "Helvetica Neue, Arial, sans-serif"),
    mono: pick(root.getPropertyValue("--font-mono"), "ui-monospace, Menlo, monospace"),
    display: pick(root.getPropertyValue("--font-display"), "Georgia, serif"),
  };
}

export function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TEX_W;
  c.height = TEX_H;
  return c;
}

const rand = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >>> 8) / 8388608;
  };
};

function roundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

/** A seat's planet, drawn like the app's role planets: a lit sphere, with its ring if it has one. */
function planet(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, role: RoleId, glow = 0) {
  const def = ROLE_BY_ID[role];
  const [light, base, shadow] = def.surface;
  if (glow) {
    const g = x.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.6);
    g.addColorStop(0, `${base}${Math.round(glow * 110).toString(16).padStart(2, "0")}`);
    g.addColorStop(1, `${base}00`);
    x.fillStyle = g;
    x.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
  }
  const ring = (front: boolean) => {
    if (def.feature !== "ring" && def.feature !== "bands") return;
    x.save();
    x.beginPath();
    x.rect(cx - r * 2, front ? cy : cy - r * 2, r * 4, r * 2);
    x.clip();
    x.strokeStyle = def.feature === "ring" ? `${base}dd` : `${light}99`;
    x.lineWidth = Math.max(1.5, r * (def.feature === "ring" ? 0.13 : 0.06));
    x.beginPath();
    x.ellipse(cx, cy, r * 1.75, r * 0.42, -0.28, 0, Math.PI * 2);
    x.stroke();
    x.restore();
  };
  ring(false);
  const g = x.createRadialGradient(cx - r * 0.36, cy - r * 0.44, r * 0.05, cx, cy, r);
  g.addColorStop(0, light);
  g.addColorStop(0.46, base);
  g.addColorStop(1, shadow);
  x.fillStyle = g;
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fill();
  ring(true);
  if (def.feature === "moon") {
    x.fillStyle = light;
    x.beginPath();
    x.arc(cx + r * 1.15, cy - r * 0.95, r * 0.22, 0, Math.PI * 2);
    x.fill();
  }
}

/** The N●X star: a hot core with a soft corona. */
function star(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const corona = x.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 4);
  corona.addColorStop(0, "rgba(247,181,66,.45)");
  corona.addColorStop(0.4, "rgba(233,113,60,.12)");
  corona.addColorStop(1, "rgba(233,113,60,0)");
  x.fillStyle = corona;
  x.fillRect(cx - r * 4, cy - r * 4, r * 8, r * 8);
  const core = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r);
  core.addColorStop(0, "#FFF7E2");
  core.addColorStop(0.42, "#FFDD82");
  core.addColorStop(0.7, "#F7B542");
  core.addColorStop(1, "#E9713C");
  x.fillStyle = core;
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fill();
}

/**
 * The star and the four seats on their orbits. `cleared` seats are solid;
 * later ones are drawn as open rings, so the diagram shows progress.
 */
function orbitDiagram(
  x: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  opts: { dark: boolean; cleared?: number; highlight?: number; planetR?: number; tilt?: number },
) {
  const tilt = opts.tilt ?? -0.24;
  const pr = opts.planetR ?? rx * 0.07;
  ROLES.forEach((role, i) => {
    const r = rx * (0.36 + i * 0.21);
    x.strokeStyle = opts.dark ? "rgba(236,239,248,.16)" : "rgba(19,26,44,.14)";
    x.lineWidth = 2;
    x.setLineDash(opts.dark ? [] : [6, 8]);
    x.beginPath();
    x.ellipse(cx, cy, r, r * 0.36, tilt, 0, Math.PI * 2);
    x.stroke();
    x.setLineDash([]);
    const a = [2.3, 5.6, 0.9, 3.9][i];
    const px = cx + Math.cos(a) * r * Math.cos(tilt) - Math.sin(a) * r * 0.36 * Math.sin(tilt);
    const py = cy + Math.cos(a) * r * Math.sin(tilt) + Math.sin(a) * r * 0.36 * Math.cos(tilt);
    const done = opts.cleared === undefined || i < opts.cleared;
    if (done) planet(x, px, py, pr * (i === opts.highlight ? 1.35 : 1), role.id, opts.dark || i === opts.highlight ? 0.6 : 0);
    else {
      x.strokeStyle = opts.dark ? "rgba(236,239,248,.4)" : "rgba(19,26,44,.3)";
      x.lineWidth = 2.5;
      x.beginPath();
      x.arc(px, py, pr, 0, Math.PI * 2);
      x.stroke();
    }
  });
  star(x, cx, cy, rx * 0.12);
}

/* ---- the book's shape -------------------------------------------------- */

const CUT = 110; // the diagonal cut on the fore-edge corners
const SPINE_R = 16;

/**
 * Every sheet is cut like a mission file: the two fore-edge corners cut off
 * on the diagonal, the spine corners just softened. `mirrored` is for a back
 * face, whose fore edge is on the left once it has turned.
 */
function sheetPath(x: CanvasRenderingContext2D, mirrored: boolean, inset = 0) {
  const i = inset;
  const c = CUT - i * 0.4;
  const pts: [number, number, number][] = mirrored
    ? [[i + c, i, 0], [TEX_W - i, i, SPINE_R], [TEX_W - i, TEX_H - i, SPINE_R], [i + c, TEX_H - i, 0], [i, TEX_H - i - c, 0], [i, i + c, 0]]
    : [[i, i, SPINE_R], [TEX_W - i - c, i, 0], [TEX_W - i, i + c, 0], [TEX_W - i, TEX_H - i - c, 0], [TEX_W - i - c, TEX_H - i, 0], [i, TEX_H - i, SPINE_R]];
  // start midway along the closing edge, so the first corner's arcTo has a point before it
  const [lx, ly] = pts[pts.length - 1];
  x.beginPath();
  x.moveTo((lx + pts[0][0]) / 2, (ly + pts[0][1]) / 2);
  pts.forEach(([px, py, r], k) => {
    const [nx, ny] = pts[(k + 1) % pts.length];
    if (r) x.arcTo(px, py, nx, ny, r);
    else x.lineTo(px, py);
  });
  x.closePath();
}

/** Cuts the sheet to shape: everything outside it becomes transparent (the shader discards it). */
function cutToShape(x: CanvasRenderingContext2D, mirrored: boolean) {
  x.save();
  x.globalCompositeOperation = "destination-in";
  sheetPath(x, mirrored);
  x.fillStyle = "#000";
  x.fill();
  x.restore();
}

/* ---- paper -------------------------------------------------------------- */

const paperCache: HTMLCanvasElement[] = [];

/**
 * Clean white paper with a fine dot grid, an orbit watermark in the outer
 * corner, a soft shadow at the spine and a fine printed edge.
 * `mirrored` puts the spine on the right, for the back of a leaf.
 */
function paper(mirrored = false): HTMLCanvasElement {
  const i = mirrored ? 1 : 0;
  if (paperCache[i]) return paperCache[i];
  const c = makeCanvas();
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, TEX_W, TEX_H);
  g.addColorStop(0, "#FFFFFF");
  g.addColorStop(1, "#F8F7F4");
  x.fillStyle = g;
  x.fillRect(0, 0, TEX_W, TEX_H);
  const img = x.getImageData(0, 0, TEX_W, TEX_H);
  const r = rand(1234567);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (r() - 0.5) * 7;
    img.data[p] += n;
    img.data[p + 1] += n;
    img.data[p + 2] += n;
  }
  x.putImageData(img, 0, 0);
  x.fillStyle = "rgba(47,72,130,.09)";
  for (let py = 40; py < TEX_H; py += 34) for (let px = 40; px < TEX_W; px += 34) x.fillRect(px, py, 2, 2);
  // orbit watermark in the outer bottom corner
  const wx = mirrored ? 150 : TEX_W - 150;
  x.strokeStyle = "rgba(47,72,130,.08)";
  x.lineWidth = 2;
  for (let k = 1; k <= 4; k++) {
    x.beginPath();
    x.ellipse(wx, TEX_H - 170, 70 * k, 26 * k, -0.24, 0, Math.PI * 2);
    x.stroke();
  }
  x.fillStyle = "rgba(47,72,130,.1)";
  x.beginPath();
  x.arc(wx, TEX_H - 170, 14, 0, Math.PI * 2);
  x.fill();
  const sx = mirrored ? TEX_W - 90 : 0;
  const s = x.createLinearGradient(mirrored ? TEX_W : 0, 0, sx + (mirrored ? 0 : 90), 0);
  s.addColorStop(0, "rgba(20,30,60,.12)");
  s.addColorStop(1, "rgba(20,30,60,0)");
  x.fillStyle = s;
  x.fillRect(sx, 0, 90, TEX_H);
  // the sheet's own edge, so white paper still reads against a pale page behind the book
  x.strokeStyle = "rgba(60,44,30,.24)";
  x.lineWidth = 4;
  sheetPath(x, mirrored, 2);
  x.stroke();
  paperCache[i] = c;
  return c;
}

/* ---- layout ------------------------------------------------------------- */

type Seg = { text: string; style: "text" | "code" | "cite" };
type Run = { x: number; y: number; text: string; font: string; size: number; color: string; style: Seg["style"] | "block"; start: number };
type Rule = { y0: number; y1: number; start: number };
type Box = { x: number; y: number; start: number };
type Panel = { y0: number; y1: number; start: number };
export type PageLayout = { runs: Run[]; rules: Rule[]; boxes: Box[]; panels: Panel[]; total: number; authorAt: { start: number; by: Block["by"] }[] };

const STYLE: Record<BlockKind, { size: number; weight: number; lead: number; before: number; after: number; marker: string }> = {
  meta: { size: 14.5, weight: 500, lead: 21, before: 0, after: 10, marker: "" },
  h1: { size: 31, weight: 700, lead: 39, before: 0, after: 6, marker: "# " },
  h2: { size: 20, weight: 700, lead: 27, before: 12, after: 1, marker: "## " },
  p: { size: 17, weight: 400, lead: 24, before: 1, after: 2, marker: "" },
  li: { size: 17, weight: 400, lead: 24, before: 0, after: 0, marker: "" },
  check: { size: 17, weight: 400, lead: 24, before: 0, after: 0, marker: "" },
  code: { size: 14.5, weight: 500, lead: 21, before: 5, after: 6, marker: "" },
};

function segments(text: string): Seg[] {
  return text
    .split(/(`[^`]+`|\[\[[^\]]+\]\])/)
    .filter(Boolean)
    .map((t) =>
      t.startsWith("`")
        ? { text: t.slice(1, -1), style: "code" as const }
        : t.startsWith("[[")
          ? { text: `kb:${BOOK_APP}/${t.slice(5, -2)}`, style: "cite" as const }
          : { text: t, style: "text" as const },
    );
}

const layoutCache = new Map<number, PageLayout>();

export function layoutPage(ctx: CanvasRenderingContext2D, index: number, fonts: Fonts): PageLayout {
  const hit = layoutCache.get(index);
  if (hit) return hit;
  const page = BOOK_PAGES[index];
  const runs: Run[] = [];
  const rules: Rule[] = [];
  const boxes: Box[] = [];
  const panels: Panel[] = [];
  const authorAt: PageLayout["authorAt"] = [];
  let count = 0;
  let y = TOP;

  for (const block of page.blocks) {
    const st = STYLE[block.kind];
    if (y + st.before + st.lead > BOTTOM) break; // never print past the footer
    y += st.before;
    const indent = block.kind === "li" ? 30 : block.kind === "check" ? 38 : 0;
    const left = MARGIN + indent;
    const right = TEX_W - MARGIN;
    const blockTop = y;
    authorAt.push({ start: count, by: block.by });

    if (block.kind === "code") {
      const font = `${st.weight} ${st.size}px ${fonts.mono}`;
      const lines = block.text.split("\n");
      panels.push({ y0: y - 4, y1: y + lines.length * st.lead + 14, start: count });
      y += 10;
      for (const line of lines) {
        runs.push({ x: left + 22, y: y + st.size, text: line, font, size: st.size, color: "#22304F", style: "block", start: count });
        count += line.length + 1;
        y += st.lead;
      }
      y += st.after + 8;
      if (block.by === "nox") rules.push({ y0: blockTop, y1: y - st.after - 8, start: authorAt[authorAt.length - 1].start });
      continue;
    }

    if (block.kind === "li") runs.push({ x: MARGIN + 6, y: y + st.size, text: "–", font: `400 ${st.size}px ${fonts.sans}`, size: st.size, color: INK_FAINT, style: "text", start: count });
    if (block.kind === "check") boxes.push({ x: MARGIN, y: y + st.size * 0.12, start: count });
    if (st.marker) {
      const font = `500 ${Math.round(st.size * 0.72)}px ${fonts.mono}`;
      ctx.font = font;
      runs.push({ x: left - ctx.measureText(st.marker).width - 8, y: y + st.size, text: st.marker.trim(), font, size: st.size, color: "rgba(19,26,44,.22)", style: "text", start: count });
    }

    let x = left;
    for (const seg of segments(block.text)) {
      const size = seg.style === "code" ? st.size * 0.86 : seg.style === "cite" ? st.size * 0.74 : st.size;
      const font =
        block.kind === "meta"
          ? `500 ${st.size}px ${fonts.mono}`
          : seg.style === "text"
            ? `${st.weight} ${st.size}px ${fonts.sans}`
            : `500 ${size}px ${fonts.mono}`;
      const color = block.kind === "meta" ? "rgba(19,26,44,.45)" : seg.style === "cite" ? CITE : block.kind === "h1" || block.kind === "h2" ? INK : INK_SOFT;
      ctx.font = font;
      // code and citations never break; prose wraps on spaces
      const words = seg.style === "text" ? seg.text.split(/(?<= )/) : [seg.text];
      for (const word of words) {
        const pad = seg.style === "text" ? 0 : 10;
        const w = ctx.measureText(word).width + pad;
        if (x + w > right && x > left) {
          x = left;
          y += st.lead;
        }
        runs.push({ x: x + (pad ? 5 : 0), y: y + st.size, text: word, font, size, color, style: seg.style, start: count });
        count += word.length;
        x += w + (pad ? 4 : 0);
      }
    }
    y += st.lead + st.after;
    if (block.kind === "meta") {
      rules.push({ y0: -1, y1: -1, start: count }); // placeholder keeps author spans aligned
      continue;
    }
    if (block.by === "nox") rules.push({ y0: blockTop + 4, y1: y - st.after - 6, start: authorAt[authorAt.length - 1].start });
  }

  const layout = { runs, rules: rules.filter((r) => r.y0 >= 0), boxes, panels, total: count, authorAt };
  layoutCache.set(index, layout);
  return layout;
}

/* ---- page furniture ----------------------------------------------------- */

export type PageStatus = "waiting" | "writing" | "approved";

/**
 * The top of a spec page: its path, then the owner in large type on the
 * left (their planet, their seat, what they write) and a status chip.
 */
function ownerHeader(x: CanvasRenderingContext2D, fonts: Fonts, index: number, status: PageStatus) {
  const page = BOOK_PAGES[index];
  const def = ROLE_BY_ID[page.role];
  x.textBaseline = "alphabetic";
  x.font = `500 16px ${fonts.mono}`;
  x.fillStyle = "rgba(19,26,44,.45)";
  x.fillText(`missions/${BOOK_KEY}/${page.file}`, MARGIN, 72);
  const pg = `page ${index + 1} of ${BOOK_PAGES.length}`;
  x.fillText(pg, TEX_W - MARGIN - x.measureText(pg).width, 72);

  x.fillStyle = `${def.hue}2e`;
  roundRect(x, MARGIN - 14, 92, TEX_W - MARGIN * 2 + 28, 96, 16);
  x.fill();
  planet(x, MARGIN + 32, 140, 27, page.role);
  x.fillStyle = INK;
  x.font = `700 38px ${fonts.sans}`;
  x.fillText(def.name, MARGIN + 82, 138);
  x.font = `600 15px ${fonts.mono}`;
  x.fillStyle = def.surface[2];
  x.fillText(`OWNER · ${def.deskLine.toUpperCase()}`, MARGIN + 84, 167);

  const label = status === "approved" ? "APPROVED" : status === "writing" ? "WRITING NOW" : "UP NEXT";
  const color = status === "approved" ? "#2E9E6B" : status === "writing" ? def.surface[2] : "rgba(19,26,44,.35)";
  x.font = `700 15px ${fonts.mono}`;
  const pad = status === "writing" ? 34 : 20;
  const w = x.measureText(label).width + pad + 18;
  const cx = TEX_W - MARGIN - w;
  x.fillStyle = color;
  roundRect(x, cx, 123, w, 34, 17);
  x.fill();
  x.fillStyle = "#fff";
  if (status === "writing") {
    x.beginPath();
    x.arc(cx + 18, 140, 5, 0, Math.PI * 2);
    x.fill();
  }
  x.fillText(label, cx + pad, 145);
}

function pageFooter(x: CanvasRenderingContext2D, fonts: Fonts, right: string, mirrored = false) {
  const l = mirrored ? MARGIN - 10 : MARGIN;
  x.font = `500 15px ${fonts.mono}`;
  x.fillStyle = "rgba(19,26,44,.36)";
  x.fillText(`${BOOK_KEY} · spec-driven development`, l, TEX_H - 62);
  x.fillText(right, TEX_W - MARGIN - x.measureText(right).width, TEX_H - 62);
}

/**
 * A round mission patch in the seat's colour: its planet, APPROVED, and the
 * seat. `press` (0–1) animates the stamping: it comes down large and faint
 * with a shadow under it, lands with a squash, leaves an ink ring, settles.
 */
function patch(x: CanvasRenderingContext2D, fonts: Fonts, cx: number, cy: number, role: RoleId, scale = 1, press = 1) {
  const def = ROLE_BY_ID[role];
  const ink = def.surface[2];
  const LAND = 0.55;
  let k = 1;
  let alpha = 0.92;
  let lift = 0;
  if (press < LAND) {
    const e = (press / LAND) ** 2;
    k = 1 + 1.25 * (1 - e);
    alpha = 0.15 + 0.7 * (press / LAND);
    lift = 1 - e;
  } else if (press < 0.8) {
    const q = (press - LAND) / (0.8 - LAND);
    k = 1 - 0.07 * Math.sin(q * Math.PI);
  }
  x.save();
  x.translate(cx, cy);
  if (lift > 0) {
    // the stamp's shadow on the paper, sharpening as it comes down
    x.fillStyle = `rgba(19,26,44,${0.16 * (1 - lift)})`;
    x.beginPath();
    x.ellipse(14 * lift, 24 * lift, 96 * scale * (1 + lift * 0.3), 96 * scale * (1 + lift * 0.3), 0, 0, Math.PI * 2);
    x.fill();
  }
  if (press >= LAND && press < 1) {
    // ink spreading out from the impact
    const q = (press - LAND) / (1 - LAND);
    x.strokeStyle = ink;
    x.globalAlpha = 0.35 * (1 - q);
    x.lineWidth = 3;
    x.beginPath();
    x.arc(0, 0, 96 * scale * (1 + q * 0.45), 0, Math.PI * 2);
    x.stroke();
    x.globalAlpha = 1;
  }
  x.rotate(-0.14 - 0.25 * lift);
  x.scale(scale * k, scale * k);
  x.globalAlpha = alpha;
  x.fillStyle = `${def.hue}1f`;
  x.beginPath();
  x.arc(0, 0, 96, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = ink;
  x.lineWidth = 4;
  x.stroke();
  x.lineWidth = 1.5;
  x.beginPath();
  x.arc(0, 0, 84, 0, Math.PI * 2);
  x.stroke();
  x.strokeStyle = `${ink}66`;
  x.beginPath();
  x.ellipse(0, -18, 58, 17, -0.25, 0, Math.PI * 2);
  x.stroke();
  planet(x, 0, -18, 19, role);
  x.fillStyle = ink;
  x.textAlign = "center";
  x.font = `700 23px ${fonts.mono}`;
  x.fillText("APPROVED", 0, 30);
  x.font = `600 13px ${fonts.sans}`;
  x.fillText(def.name.toUpperCase(), 0, 54);
  x.restore();
  x.textAlign = "left";
}

function signature(x: CanvasRenderingContext2D, px: number, py: number, seed: number, color: string, scale = 1) {
  const r = rand(seed * 7919 + 13);
  x.save();
  x.translate(px, py);
  x.scale(scale, scale);
  x.strokeStyle = color;
  x.lineWidth = 2.6;
  x.lineCap = "round";
  x.lineJoin = "round";
  x.beginPath();
  x.moveTo(0, 14);
  x.bezierCurveTo(-3, -8, 11, -24, 18, -5);
  let cx = 18;
  let cy = -5;
  for (let i = 0; i < 6; i++) {
    const step = 13 + r() * 15;
    const nx = cx + step;
    const ny = (i % 2 ? 8 : -8) - r() * 10;
    x.bezierCurveTo(cx + step * 0.35, cy - 13 - r() * 10, nx - step * 0.35, ny + 11, nx, ny);
    cx = nx;
    cy = ny;
  }
  x.stroke();
  x.lineWidth = 1.6;
  x.beginPath();
  x.moveTo(-6, 24);
  x.quadraticCurveTo(cx * 0.5, 32, cx + 24, 16);
  x.stroke();
  x.restore();
}

/* ---- the faces ---------------------------------------------------------- */

/**
 * A spec page, `reveal` characters in. While the page is being written the
 * current author's cursor sits at the end of the text, with a name flag.
 * `stamp` (0–1) is the approval stamp coming down once the page is signed off.
 */
export function drawSpecPage(
  c: HTMLCanvasElement,
  index: number,
  reveal: number,
  fonts: Fonts,
  opts: { cursor: boolean; blink: boolean; stamp: number },
) {
  const x = c.getContext("2d")!;
  x.drawImage(paper(), 0, 0);
  const page = BOOK_PAGES[index];
  const L = layoutPage(x, index, fonts);
  const status: PageStatus = opts.stamp > 0 ? "approved" : reveal > 0 ? "writing" : "waiting";
  ownerHeader(x, fonts, index, status);
  pageFooter(x, fonts, `${L.total.toLocaleString("en")} characters`);

  for (const panel of L.panels) {
    if (panel.start >= reveal) continue;
    x.fillStyle = "rgba(47,72,130,.07)";
    roundRect(x, MARGIN, panel.y0, TEX_W - MARGIN * 2, panel.y1 - panel.y0, 8);
    x.fill();
  }
  for (const rule of L.rules) {
    if (rule.start >= reveal) continue;
    x.fillStyle = "rgba(217,154,43,.6)";
    x.fillRect(MARGIN - 26, rule.y0, 3.5, rule.y1 - rule.y0);
  }
  for (const box of L.boxes) {
    if (box.start >= reveal) continue;
    x.strokeStyle = "rgba(19,26,44,.42)";
    x.lineWidth = 2;
    roundRect(x, box.x, box.y, 17, 17, 4);
    x.stroke();
  }

  let end = { x: MARGIN, y: TOP + 26, h: 26 };
  x.textBaseline = "alphabetic";
  for (const run of L.runs) {
    if (run.start >= reveal) break;
    const text = run.text.slice(0, Math.max(0, reveal - run.start));
    x.font = run.font;
    const w = x.measureText(text).width;
    if (run.style === "code" || run.style === "cite") {
      x.fillStyle = run.style === "cite" ? "rgba(47,103,177,.1)" : "rgba(19,26,44,.07)";
      roundRect(x, run.x - 5, run.y - run.size * 0.95, w + 10, run.size * 1.3, 4);
      x.fill();
    }
    x.fillStyle = run.color;
    x.fillText(text, run.x, run.y);
    end = { x: run.x + w, y: run.y, h: run.size };
  }

  if (opts.cursor && reveal < L.total) {
    let by: Block["by"] = "person";
    for (const a of L.authorAt) if (a.start <= reveal) by = a.by;
    const def = ROLE_BY_ID[page.role];
    const color = by === "nox" ? NOX_GOLD : def.surface[2];
    const label = by === "nox" ? "NoX" : def.name;
    if (!opts.blink) {
      x.fillStyle = color;
      x.fillRect(end.x + 2, end.y - end.h * 0.95, 3, end.h * 1.2);
    }
    // the name flag hangs below the caret, over lines not yet written
    x.font = `600 16px ${fonts.sans}`;
    const lw = x.measureText(label).width + 16;
    const fx = Math.min(end.x + 2, TEX_W - MARGIN - lw);
    const fy = end.y + end.h * 0.35;
    x.fillStyle = color;
    roundRect(x, fx, fy, lw, 24, 5);
    x.fill();
    x.fillStyle = "#fff";
    x.fillText(label, fx + 8, fy + 17);
  }

  if (opts.stamp > 0) patch(x, fonts, TEX_W - MARGIN - 110, TEX_H - 210, page.role, 0.95, opts.stamp);
  cutToShape(x, false);
}

/**
 * The left-hand page while a seat writes (inside the cover, then the back of
 * each finished page): who is writing now, large, and below it, smaller,
 * every seat cleared so far and the ones still to come. `current` is the
 * seat writing on the facing page; `current === 4` means all are cleared.
 */
export function drawStatus(c: HTMLCanvasElement, current: number, fonts: Fonts) {
  const x = c.getContext("2d")!;
  x.drawImage(paper(true), 0, 0);
  const l = MARGIN - 10;
  const r = TEX_W - MARGIN;
  x.textBaseline = "alphabetic";
  x.font = `500 16px ${fonts.mono}`;
  x.fillStyle = "rgba(19,26,44,.45)";
  x.fillText(`missions/${BOOK_KEY} · ${BOOK_APP}`, l, 72);
  x.fillStyle = INK;
  x.font = `700 46px ${fonts.sans}`;
  x.fillText("Flight plan", l, 140);

  // now writing — the one thing to look at
  const box = { y: 190, h: 270 };
  if (current < BOOK_PAGES.length) {
    const page = BOOK_PAGES[current];
    const def = ROLE_BY_ID[page.role];
    x.fillStyle = `${def.hue}2e`;
    roundRect(x, l, box.y, r - l, box.h, 20);
    x.fill();
    x.strokeStyle = def.surface[1];
    x.lineWidth = 3;
    x.stroke();
    x.fillStyle = def.surface[2];
    x.beginPath();
    x.arc(l + 36, box.y + 44, 6, 0, Math.PI * 2);
    x.fill();
    x.font = `700 17px ${fonts.mono}`;
    x.fillText("NOW WRITING", l + 52, box.y + 50);
    planet(x, l + 78, box.y + 138, 44, page.role, 0.5);
    x.fillStyle = INK;
    x.font = `700 50px ${fonts.sans}`;
    x.fillText(def.name, l + 148, box.y + 134);
    x.font = `500 19px ${fonts.mono}`;
    x.fillStyle = INK_SOFT;
    x.fillText(`${page.file} · ${def.deskLine.toLowerCase()}`, l + 150, box.y + 170);
    x.font = `400 20px ${fonts.sans}`;
    x.fillText(`With NoX, grounded in the knowledge base of ${BOOK_APP}.`, l + 36, box.y + 232);
  } else {
    x.fillStyle = "rgba(95,210,159,.16)";
    roundRect(x, l, box.y, r - l, box.h, 20);
    x.fill();
    x.fillStyle = INK;
    x.font = `700 46px ${fonts.sans}`;
    x.fillText("Every seat cleared", l + 36, box.y + 120);
    x.font = `400 21px ${fonts.sans}`;
    x.fillStyle = INK_SOFT;
    x.fillText("Locked and sent for development.", l + 36, box.y + 170);
  }

  // cleared so far — a smaller sub-section
  let y = box.y + box.h + 64;
  x.font = `700 16px ${fonts.mono}`;
  x.fillStyle = "rgba(19,26,44,.5)";
  x.fillText(`CLEARED · ${current} OF ${BOOK_PAGES.length}`, l, y);
  x.fillStyle = RULE;
  x.fillRect(l, y + 14, r - l, 1.5);
  y += 30;
  if (current === 0) {
    x.font = `400 20px ${fonts.sans}`;
    x.fillStyle = INK_SOFT;
    x.fillText("Nothing cleared yet. The business user goes first.", l, y + 34);
    y += 64;
  }
  for (let i = 0; i < Math.min(current, BOOK_PAGES.length); i++) {
    const page = BOOK_PAGES[i];
    const def = ROLE_BY_ID[page.role];
    const blocks = page.blocks.length;
    const cited = page.blocks.filter((b) => b.text.includes("[[kb:")).length;
    planet(x, l + 20, y + 34, 16, page.role);
    x.fillStyle = INK;
    x.font = `600 24px ${fonts.sans}`;
    x.fillText(def.name, l + 52, y + 36);
    x.font = `500 15px ${fonts.mono}`;
    x.fillStyle = "rgba(19,26,44,.5)";
    x.fillText(`${page.file} · ${blocks} blocks · ${cited} cited`, l + 52, y + 62);
    signature(x, r - 260, y + 36, i + 3, def.surface[2], 0.72);
    patch(x, fonts, r - 44, y + 40, page.role, 0.38);
    x.fillStyle = RULE;
    x.fillRect(l, y + 84, r - l, 1);
    y += 96;
  }

  // still to come, faint
  if (current + 1 < BOOK_PAGES.length) {
    y += 26;
    x.font = `700 16px ${fonts.mono}`;
    x.fillStyle = "rgba(19,26,44,.4)";
    x.fillText("NEXT", l, y);
    y += 16;
    for (let i = current + 1; i < BOOK_PAGES.length; i++) {
      const page = BOOK_PAGES[i];
      const def = ROLE_BY_ID[page.role];
      x.globalAlpha = 0.45;
      planet(x, l + 16, y + 26, 12, page.role);
      x.fillStyle = INK;
      x.font = `500 20px ${fonts.sans}`;
      x.fillText(def.name, l + 44, y + 33);
      x.font = `500 15px ${fonts.mono}`;
      x.fillText(page.file, l + 260, y + 33);
      x.globalAlpha = 1;
      y += 48;
    }
  }

  // the mission so far, on its orbits: cleared seats and the one writing are solid, the rest still open rings
  orbitDiagram(x, TEX_W / 2 - 10, TEX_H - 290, 360, { dark: false, cleared: Math.min(current + 1, BOOK_PAGES.length), highlight: current, planetR: 16 });

  pageFooter(x, fonts, "flight plan", true);
  cutToShape(x, true);
}

/**
 * Deep space in indigo: lighter and bluer than the landing's near-black, so
 * the closed book stands off the page, with violet and blue nebulae and a
 * scatter of stars.
 */
function space(x: CanvasRenderingContext2D, seed: number) {
  const g = x.createLinearGradient(0, 0, TEX_W * 0.4, TEX_H);
  g.addColorStop(0, "#343A86");
  g.addColorStop(0.5, "#20245C");
  g.addColorStop(1, "#141640");
  x.fillStyle = g;
  x.fillRect(0, 0, TEX_W, TEX_H);
  const nebula = (cx: number, cy: number, r: number, col: string) => {
    const n = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    n.addColorStop(0, col);
    n.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = n;
    x.fillRect(0, 0, TEX_W, TEX_H);
  };
  nebula(TEX_W * 0.82, TEX_H * 0.2, 560, "rgba(150,110,255,.42)");
  nebula(TEX_W * 0.12, TEX_H * 0.72, 600, "rgba(70,140,230,.38)");
  nebula(TEX_W * 0.6, TEX_H * 0.97, 460, "rgba(233,113,60,.16)");
  const r = rand(seed);
  for (let i = 0; i < 520; i++) {
    const px = r() * TEX_W;
    const py = r() * TEX_H;
    const big = r() > 0.965;
    x.globalAlpha = 0.25 + r() * 0.6;
    x.fillStyle = r() > 0.85 ? "#FFE3A8" : r() > 0.7 ? "#BFD6FF" : "#FFFFFF";
    x.beginPath();
    x.arc(px, py, big ? 2 + r() * 1.4 : 0.6 + r() * 0.9, 0, Math.PI * 2);
    x.fill();
    if (big) {
      x.globalAlpha = 0.18;
      x.beginPath();
      x.arc(px, py, 8, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.globalAlpha = 1;
  const s = x.createLinearGradient(0, 0, 60, 0);
  s.addColorStop(0, "rgba(0,0,0,.5)");
  s.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = s;
  x.fillRect(0, 0, 60, TEX_H);
}

/** The cover's edge: a glowing gold line along the cut shape, and a faint inner one. */
function coverEdge(x: CanvasRenderingContext2D, mirrored: boolean) {
  x.save();
  x.shadowColor = "rgba(247,181,66,.9)";
  x.shadowBlur = 22;
  x.strokeStyle = "rgba(247,181,66,.95)";
  x.lineWidth = 7;
  sheetPath(x, mirrored, 5);
  x.stroke();
  x.shadowBlur = 0;
  x.strokeStyle = "rgba(236,239,248,.22)";
  x.lineWidth = 2;
  sheetPath(x, mirrored, 38);
  x.stroke();
  x.restore();
  cutToShape(x, mirrored);
}

/**
 * The front cover: a mission file in deep space. `lock` (0–1) draws the band
 * that seals it once every seat has signed; `verified` (0–1) the stamp it
 * comes back with.
 */
export function drawCover(c: HTMLCanvasElement, fonts: Fonts, lock: number, verified: number) {
  const x = c.getContext("2d")!;
  space(x, 777);

  x.textAlign = "center";
  x.fillStyle = "rgba(247,181,66,.85)";
  x.font = `500 20px ${fonts.mono}`;
  x.letterSpacing = "6px";
  x.fillText(`${BOOK_KEY}  ·  MISSION FILE`, TEX_W / 2, 150);
  x.fillStyle = SPACE_INK;
  x.font = `600 70px ${fonts.sans}`;
  x.letterSpacing = "16px";
  x.fillText("SPECIFICATIONS", TEX_W / 2 + 8, 250);
  x.letterSpacing = "0px";
  x.font = `400 30px ${fonts.sans}`;
  x.fillStyle = "rgba(236,239,248,.62)";
  x.fillText("Spec-driven development", TEX_W / 2, 304);
  x.textAlign = "left";

  orbitDiagram(x, TEX_W / 2, 610, 440, { dark: true, planetR: 17 });

  x.textAlign = "center";
  x.fillStyle = SPACE_INK;
  x.font = `600 40px ${fonts.sans}`;
  x.fillText(BOOK_TITLE, TEX_W / 2, 1062);
  x.font = `500 21px ${fonts.mono}`;
  x.fillStyle = "rgba(236,239,248,.5)";
  x.fillText(`${BOOK_APP}  ·  4 seats  ·  4 files`, TEX_W / 2, 1104);

  // the N●X mark at the foot
  x.font = `600 44px ${fonts.sans}`;
  x.fillStyle = SPACE_INK;
  x.textAlign = "right";
  x.fillText("N", TEX_W / 2 - 20, TEX_H - 128);
  x.textAlign = "left";
  x.fillText("X", TEX_W / 2 + 20, TEX_H - 128);
  x.textAlign = "left";
  const core = x.createRadialGradient(TEX_W / 2 - 5, TEX_H - 150, 2, TEX_W / 2, TEX_H - 144, 17);
  core.addColorStop(0, "#FFF7E2");
  core.addColorStop(0.42, "#FFDD82");
  core.addColorStop(0.7, "#F7B542");
  core.addColorStop(1, "#E9713C");
  x.fillStyle = core;
  x.beginPath();
  x.arc(TEX_W / 2, TEX_H - 144, 16, 0, Math.PI * 2);
  x.fill();

  if (lock > 0.001) {
    x.save();
    x.globalAlpha = Math.min(1, lock);
    const by = 880;
    x.fillStyle = "rgba(5,6,11,.82)";
    x.fillRect(0, by, TEX_W, 120);
    x.fillStyle = "rgba(247,181,66,.9)";
    x.fillRect(0, by, TEX_W, 3);
    x.fillRect(0, by + 117, TEX_W, 3);
    const lx = 250;
    const ly = by + 34;
    x.strokeStyle = "#F7B542";
    x.lineWidth = 6;
    x.beginPath();
    x.arc(lx, ly + 12, 16, Math.PI, 0);
    x.stroke();
    x.fillStyle = "#F7B542";
    roundRect(x, lx - 24, ly + 12, 48, 38, 5);
    x.fill();
    x.fillStyle = "#05060B";
    x.fillRect(lx - 3, ly + 24, 6, 13);
    x.font = `700 32px ${fonts.mono}`;
    x.fillStyle = "#F7B542";
    x.fillText("LOCKED", lx + 52, by + 58);
    x.font = `500 20px ${fonts.sans}`;
    x.fillStyle = "rgba(247,181,66,.75)";
    x.fillText("4 specs approved · sent for development", lx + 52, by + 90);
    x.restore();
  }

  if (verified > 0.001) {
    x.save();
    x.globalAlpha = Math.min(1, verified) * 0.95;
    // tucked into the bottom corner, clear of the title
    x.translate(TEX_W - 190, TEX_H - 232);
    x.rotate(-0.2);
    x.scale(0.78, 0.78);
    x.strokeStyle = "#5FD29F";
    x.fillStyle = "rgba(5,6,11,.7)";
    x.lineWidth = 5;
    x.beginPath();
    x.arc(0, 0, 124, 0, Math.PI * 2);
    x.fill();
    x.stroke();
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(0, 0, 108, 0, Math.PI * 2);
    x.stroke();
    x.fillStyle = "#5FD29F";
    x.textAlign = "center";
    x.font = `700 62px ${fonts.sans}`;
    x.fillText("✓", 0, -16);
    x.font = `700 25px ${fonts.mono}`;
    x.fillText("BUILT &", 0, 28);
    x.fillText("VERIFIED", 0, 58);
    x.restore();
    x.textAlign = "left";
  }
  coverEdge(x, false);
}

export function drawBackCover(c: HTMLCanvasElement) {
  const x = c.getContext("2d")!;
  space(x, 4242);
  coverEdge(x, false);
}
