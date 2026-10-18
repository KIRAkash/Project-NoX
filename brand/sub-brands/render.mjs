// Render the NoX Atlas and NoX Missions lockups.
//   node brand/sub-brands/render.mjs
// Writes, for each of atlas and missions:
//   nox-<name>-on-light.png / -on-dark.png  transparent background, 3x
//   nox-<name>-on-light.jpg                 opaque on the deck paper (#faf7f5), for the pitch PDF
// Uses the Playwright install in docs/pitch/film/node_modules.
import { chromium } from "../../docs/pitch/film/node_modules/playwright/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 3 });
for (const theme of ["light", "dark"]) {
  await page.goto("file://" + path.join(here, "lockups.html"));
  await page.evaluate((t) => (document.body.className = t), theme);
  await page.waitForFunction(() => document.body.dataset.ready === "1");
  await page.waitForTimeout(300);
  for (const name of ["atlas", "missions"]) {
    const el = await page.$(`#${name}`);
    if (theme === "light") await el.screenshot({ path: path.join(here, `nox-${name}-on-light.jpg`), type: "jpeg", quality: 92 });
    await page.evaluate(() => (document.body.style.background = "transparent"));
    await el.screenshot({ path: path.join(here, `nox-${name}-on-${theme}.png`), omitBackground: true });
    await page.evaluate(() => (document.body.style.background = ""));
  }
}
await browser.close();
console.log("rendered");
