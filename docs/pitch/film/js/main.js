// Entry: mount the WebGL canvas and the planet characters, build every scene onto the
// master timeline once fonts are ready, and expose window.renderFrame(t).
import { renderer, renderGL } from "./world.js";
import { tl, hooks, cues, blurAt, seedFrame, DUR, $$ } from "./engine.js";
import { mountPlanet } from "./planets.js";

document.getElementById("gl").appendChild(renderer.domElement);
$$(".pl[data-role]").forEach((el) => mountPlanet(el, el.dataset.role, +el.dataset.size));

const SCENES = ["./s_intro.js", "./s_atlas.js", "./s_orbit.js", "./s_book.js", "./s_outro.js"];

async function boot() {
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; }))));
  for (const s of SCENES) {
    try { const m = await import(s); m.build(); }
    catch (e) { if (!String(e).includes("Failed to fetch")) { console.error(s, e); throw e; } }
  }
  tl.set({}, {}, DUR);
  // every planet blinks now and then, never in step with the others
  const eyes = $$(".eye");
  hooks.push((t) => {
    eyes.forEach((e, i) => {
      const k = Math.floor(i / 2), period = 3.6 + (k % 5) * 0.55, u = ((t + k * 1.37) % period) / 0.16;
      const s = u < 1 ? 1 - 0.92 * Math.sin(Math.PI * u) : 1;
      e.setAttribute("transform", `scale(1 ${s.toFixed(3)})`);
    });
  });
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
