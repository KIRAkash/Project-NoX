// Render the NoX film frame by frame with headless Chromium (WebGL via SwiftShader).
//   node render.mjs stills 12,47.5        -> stills/t_<t>.png (motion blur applied where the timeline asks)
//   node render.mjs video [workers] [from] [to]  -> seg_<w>.mp4 per worker, segs.txt, cues.json
//   node render.mjs cues                  -> cues.json (the soundtrack syncs to it)
// Motion blur: frames inside a blur zone are the average of N subframes across a
// 180-degree shutter (half a frame), which turns fast moves into real streaks.
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
function need(names) { for (const n of names) { try { return require(n); } catch { /* next */ } } throw new Error("missing " + names[0]); }
const { chromium } = need(["playwright", "/opt/node-tools/node_modules/playwright"]);
const sharp = need(["sharp"]);

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FPS = 30, W = 1920, H = 1080, SHUTTER = 0.5 / FPS;
const mode = process.argv[2] || "stills";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html?render`;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/GL Driver|GPU stall/.test(m.text())) console.error("CONSOLE", m.text()); });
  await page.goto(URL_, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page;
}

async function shot(page, t) {
  await page.evaluate((t) => window.renderFrame(t), t);
  return page.screenshot({ type: "jpeg", quality: 95 });
}

/** one output frame as raw RGB, averaging subframes when the timeline asks for blur */
async function frameRGB(page, t) {
  const n = await page.evaluate((t) => window.__blurAt(t), t);
  if (n <= 1) return sharp(await shot(page, t)).removeAlpha().raw().toBuffer();
  const acc = new Uint32Array(W * H * 3);
  for (let k = 0; k < n; k++) {
    const tk = t + ((k + 0.5) / n - 0.5) * SHUTTER;
    const raw = await sharp(await shot(page, tk)).removeAlpha().raw().toBuffer();
    for (let i = 0; i < raw.length; i++) acc[i] += raw[i];
  }
  const out = Buffer.allocUnsafe(W * H * 3);
  for (let i = 0; i < out.length; i++) out[i] = (acc[i] / n + 0.5) | 0;
  return out;
}

const browser = await chromium.launch({ args: ["--font-render-hinting=none", "--ignore-gpu-blocklist"] });

if (mode === "stills") {
  const times = (process.argv[3] || "1").split(",").map(Number);
  fs.mkdirSync(path.join(ROOT, "stills"), { recursive: true });
  const page = await openPage(browser);
  for (const t of times) {
    const raw = await frameRGB(page, t);
    await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(ROOT, "stills", `t_${t.toFixed(2)}.png`));
    console.log("still", t);
  }
} else if (mode === "cues") {
  const page = await openPage(browser);
  fs.writeFileSync(path.join(ROOT, "cues.json"), JSON.stringify(await page.evaluate(() => window.__cues), null, 1));
  console.log("cues written");
} else if (mode === "video") {
  const workers = +(process.argv[3] || 3);
  const from = +(process.argv[4] || 0), to = +(process.argv[5] || 90);
  const prefix = process.argv[6] || "seg";
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
    const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-pix_fmt", "yuv444p", path.join(ROOT, `${prefix}_${w}.mp4`)], { stdio: ["pipe", "inherit", "inherit"] });
    for (let f = a; f < b; f++) {
      const buf = await frameRGB(page, from + f / FPS);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if ((f - a) % 60 === 0) console.log(`w${w} ${f}/${b} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
    await page.close();
  }));
  fs.writeFileSync(path.join(ROOT, `${prefix}s.txt`), Array.from({ length: workers }, (_, w) => `file '${prefix}_${w}.mp4'`).join("\n") + "\n");
  console.log("done in", ((Date.now() - t0) / 1000).toFixed(0), "s");
}
await browser.close();
server.close();
