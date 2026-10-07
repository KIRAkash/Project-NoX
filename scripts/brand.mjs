#!/usr/bin/env node
/**
 * Draws the NoX logo and writes every copy of it: the brand kit in `brand/`
 * and the web app's favicon, icon and Apple touch icon in `apps/web/app/`.
 *
 * The wordmark is N●X: the star stands in for the O, at 0.76em, with the
 * same radial gradient and glow as `components/app/nox-mark.tsx`. The letters
 * are drawn as paths, not text, so the files look the same without DM Sans
 * installed. Run from the repo root after changing the shapes:
 *
 *   node scripts/brand.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND = join(ROOT, "brand");
const WEB_APP = join(ROOT, "apps/web/app");

const INK = "#ECEFF8";
const VOID = "#05060B";

// Geometry in em/100 units: cap height 70, stem 11, star 76 across.
const CAP = 70;
const STEM = 11;
const GLYPH = 56;
const GAP = 7;
const STAR = 76;

const star = (id, cx, cy, r, glow) => `
  <defs>
    <radialGradient id="${id}-fill" cx="0.34" cy="0.30" fx="0.34" fy="0.30" r="0.96">
      <stop offset="0" stop-color="#FFF7E2"/>
      <stop offset="0.42" stop-color="#FFDD82"/>
      <stop offset="0.68" stop-color="#F7B542"/>
      <stop offset="1" stop-color="#E9713C"/>
    </radialGradient>
    <filter id="${id}-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="${glow}"/>
    </filter>
  </defs>
  ${glow ? `<circle cx="${cx}" cy="${cy}" r="${r * 1.08}" fill="#F7B542" fill-opacity="0.5" filter="url(#${id}-glow)"/>` : ""}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-fill)"/>`;

// A stroke from (x0, top) to (x1, bottom) whose horizontal width keeps the
// perpendicular thickness at STEM.
function diagonal(x0, x1, y0 = 0, y1 = CAP) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = (STEM * Math.hypot(dx, dy)) / dy;
  const p = dx > 0
    ? [[x0, y0], [x0 + t, y0], [x1, y1], [x1 - t, y1]]
    : [[x0 - t, y0], [x0, y0], [x1 + t, y1], [x1, y1]];
  return `M${p.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
}

const letterN = (x) =>
  [
    `M${x} 0h${STEM}v${CAP}h-${STEM}Z`,
    `M${x + GLYPH - STEM} 0h${STEM}v${CAP}h-${STEM}Z`,
    diagonal(x, x + GLYPH),
  ].join("");

const letterX = (x) => [diagonal(x, x + GLYPH), diagonal(x + GLYPH, x)].join("");

function wordmark(ink, { pad = 26 } = {}) {
  const starX = GLYPH + GAP + STAR / 2;
  const xX = GLYPH + GAP * 2 + STAR;
  const width = xX + GLYPH;
  const cy = CAP / 2;
  const vb = [-pad, cy - STAR / 2 - pad, width + pad * 2, STAR + pad * 2];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" width="${vb[2] * 4}" height="${vb[3] * 4}">
  <title>NoX</title>${star("wm", starX, cy, STAR / 2, 9)}
  <path fill="${ink}" d="${letterN(0)}${letterX(xX)}"/>
</svg>
`;
}

// The star alone, for places too small for the wordmark.
function mark({ background = null, size = 512, starScale = 0.56, glow = true } = {}) {
  const c = size / 2;
  const r = (size * starScale) / 2;
  const radius = size * 0.22;
  const bg = background
    ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <title>NoX</title>${bg}${star("mk", c, c, r, glow ? size * 0.045 : 0)}
</svg>
`;
}

// An ICO holding PNG images (supported by every current browser).
function ico(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const png = (svg, width, height = width) =>
  sharp(Buffer.from(svg), { density: 300 }).resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log("wrote", path.replace(ROOT + "/", ""));
}

const files = {
  "wordmark-on-dark": wordmark(INK),
  "wordmark-on-light": wordmark(VOID),
  "mark": mark(),
  "app-icon": mark({ background: VOID }),
};

for (const [name, svg] of Object.entries(files)) {
  write(join(BRAND, `nox-${name}.svg`), svg);
}

// Raster copies for slides, social cards and anywhere SVG isn't accepted.
for (const w of [512, 1024, 2048]) {
  write(join(BRAND, "png", `nox-wordmark-on-dark-${w}.png`), await png(files["wordmark-on-dark"], w, Math.round((w * 128) / 254)));
  write(join(BRAND, "png", `nox-wordmark-on-light-${w}.png`), await png(files["wordmark-on-light"], w, Math.round((w * 128) / 254)));
}
for (const s of [64, 256, 512, 1024]) {
  write(join(BRAND, "png", `nox-mark-${s}.png`), await png(files.mark, s));
  write(join(BRAND, "png", `nox-app-icon-${s}.png`), await png(files["app-icon"], s));
}
write(join(BRAND, "png", "nox-wordmark-on-void-1200x630.png"), await sharp({
  create: { width: 1200, height: 630, channels: 4, background: VOID },
}).composite([{ input: await png(files["wordmark-on-dark"], 760, Math.round((760 * 128) / 254)), gravity: "center" }]).png().toBuffer());

// Web app icons, picked up by Next's file conventions. The favicon is the
// star on a void tile: it reads on light and dark tabs alike, and the
// wordmark is too wide to survive 16px. The glow is dropped at tiny sizes.
const tiny = mark({ background: VOID, starScale: 0.66, glow: false });
write(join(WEB_APP, "icon.svg"), mark({ background: VOID, starScale: 0.62 }));
write(join(WEB_APP, "favicon.ico"), ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(tiny, size) })))));
write(join(WEB_APP, "apple-icon.png"), await sharp(Buffer.from(mark({ background: VOID, size: 180 }).replace(/rx="[^"]+"/, 'rx="0"'))).png().toBuffer());
