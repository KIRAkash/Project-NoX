// Entry: mount the WebGL canvas and the planet characters, build every scene onto the
// master timeline once fonts are ready, and expose window.renderFrame(t).
import { renderer, renderGL } from "./world.js";
import { tl, hooks, cues, blurAt, seedFrame, DUR, $$ } from "./engine.js";
import { mountPlanet } from "./planets.js";

document.getElementById("gl").appendChild(renderer.domElement);
$$(".pl[data-role]").forEach((el) => mountPlanet(el, el.dataset.role, +el.dataset.size));

const SCENES = ["./s_intro.js", "./s_atlas.js", "./s_orbit.js", "./s_seats.js", "./s_outro.js"];

async function boot() {
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; }))));
  for (const s of SCENES) {
    try { const m = await import(s); m.build(); }
    catch (e) { if (!String(e).includes("Failed to fetch")) { console.error(s, e); throw e; } }
  }
  tl.set({}, {}, DUR);
  window.renderFrame = (t) => { seedFrame(t); tl.seek(t, false); for (const h of hooks) h(t); renderGL(t); };
  window.__cues = cues;
  window.__blurAt = blurAt;
  window.__dur = DUR;
  window.__ready = true;
  if (!/[?&]render/.test(location.search)) {
    const t0 = parseFloat((location.hash || "#0").slice(1)) || 0, start = performance.now();
    const loop = () => { window.renderFrame((t0 + (performance.now() - start) / 1000) % DUR); requestAnimationFrame(loop); };
    loop();
  }
}
boot();
