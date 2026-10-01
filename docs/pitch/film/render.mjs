// Render the NoX film frame by frame with headless Chromium.
//   node render.mjs stills 0.5,3,12     -> stills/t_<t>.png
//   node render.mjs video [workers]     -> seg_<i>.mp4 (one per worker) + cues.json
//   node render.mjs cues                -> cues.json only (the soundtrack syncs to it)
// The page is a pure function of time: window.renderFrame(t) seeks the GSAP master
// timeline and redraws the star field, so frames can be rendered in any order and in parallel.
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
    try { return require(p); } catch { /* try the next one */ }
  }
  throw new Error("Playwright not found: npm i -D playwright");
}
const { chromium } = loadPlaywright();

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FPS = 30;
const mode = process.argv[2] || "stills";

// tiny static server, so fonts and images load over http rather than file://
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html?render`;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text()); });
  await page.goto(URL_, { waitUntil: "load" });
  await page.evaluate(() => window.__ready);
  return page;
}

const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });

if (mode === "stills") {
  const times = (process.argv[3] || "1").split(",").map(Number);
  fs.mkdirSync(path.join(ROOT, "stills"), { recursive: true });
  const page = await openPage(browser);
  for (const t of times) {
    await page.evaluate((t) => window.renderFrame(t), t);
    await page.screenshot({ path: path.join(ROOT, "stills", `t_${t.toFixed(2)}.png`) });
    console.log("still", t);
  }
} else if (mode === "cues") {
  const page = await openPage(browser);
  const cues = await page.evaluate(() => window.__cues);
  fs.writeFileSync(path.join(ROOT, "cues.json"), JSON.stringify(cues, null, 1));
  console.log(cues.length, "cues");
} else if (mode === "video") {
  const workers = +(process.argv[3] || 3);
  const from = +(process.argv[4] || 0), to = +(process.argv[5] || 90);
  const total = Math.round((to - from) * FPS);
  const per = Math.ceil(total / workers);
  const page0 = await openPage(browser);
  fs.writeFileSync(path.join(ROOT, "cues.json"), JSON.stringify(await page0.evaluate(() => window.__cues), null, 1));
  await page0.close();
  const t0 = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    if (a >= b) return;
    const page = await openPage(browser);
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", path.join(ROOT, `seg_${w}.mp4`)], { stdio: ["pipe", "inherit", "inherit"] });
    for (let f = a; f < b; f++) {
      const t = from + f / FPS;
      await page.evaluate((t) => window.renderFrame(t), t);
      const buf = await page.screenshot({ type: "jpeg", quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if ((f - a) % 150 === 0) console.log(`w${w} frame ${f}/${b} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
    await page.close();
  }));
  fs.writeFileSync(path.join(ROOT, "segs.txt"), Array.from({ length: workers }, (_, w) => `file 'seg_${w}.mp4'`).join("\n") + "\n");
  console.log("done in", ((Date.now() - t0) / 1000).toFixed(0), "s");
}
await browser.close();
server.close();
