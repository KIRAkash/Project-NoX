// Flatten SVG logos in img/logos/src/ onto white JPGs (PDF-safe: no transparency). Usage: node logo-flatten.mjs
import { chromium } from "../film/node_modules/playwright/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "img/logos/src");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 160, height: 160 } });
for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".svg"))) {
  const svg = fs.readFileSync(path.join(src, f), "utf8");
  await page.setContent(`<body style="margin:0;background:#fff;display:grid;place-items:center;width:160px;height:160px">
    <div style="width:124px;height:124px">${svg.replace(/<svg /, '<svg style="width:100%;height:100%" ')}</div></body>`);
  const out = path.join(here, "img/logos", f.replace(/\.svg$/, ".jpg"));
  await page.screenshot({ path: out, type: "jpeg", quality: 92 });
  console.log("wrote", path.relative(here, out));
}
await browser.close();
