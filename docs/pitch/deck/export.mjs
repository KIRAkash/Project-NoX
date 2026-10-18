// Export the deck: node export.mjs [pdf|png] [pages]
//   pdf  → ../nox-pitch-2026.pdf (one 1600×900 page per slide, text selectable)
//   png  → stills/NN.png for checking, optionally only the listed pages (e.g. 3,7)
// Uses the Playwright install from ../film (npm i there first).
import { chromium } from "../film/node_modules/playwright/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [mode = "pdf", only] = process.argv.slice(2);
const pick = only ? new Set(only.split(",").map(Number)) : null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: mode === "png" ? 1 : 1 });
await page.goto("file://" + path.join(here, "index.html"), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

if (mode === "pdf") {
  await page.emulateMedia({ media: "print" });
  const out = path.join(here, "..", "nox-pitch-2026.pdf");
  await page.pdf({ path: out, width: "1600px", height: "900px", printBackground: true, preferCSSPageSize: true });
  console.log("wrote", out, (fs.statSync(out).size / 1e6).toFixed(1), "MB");
} else {
  fs.mkdirSync(path.join(here, "stills"), { recursive: true });
  const slides = await page.$$(".slide");
  for (const [i, s] of slides.entries()) {
    if (pick && !pick.has(i + 1)) continue;
    await s.screenshot({ path: path.join(here, "stills", String(i + 1).padStart(2, "0") + ".png") });
  }
  console.log("stills written");
}
await browser.close();
