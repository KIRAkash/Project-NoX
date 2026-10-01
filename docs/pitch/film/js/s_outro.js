// Scenes 9 and 10: the platform on Google Cloud, the trust principles, and the close.
import { tl, cue, blur, $, $$, sceneIn, setOff, maskWords, blurChars, rise, colorTo, HEX } from "./engine.js";
import { S, D, project, updaters, P, THREE } from "./world.js";
import { burst } from "./fx.js";

export function build() {
  /* ============================================================ S9a (78 - 82) */
  const ICON = {
    shield: `<svg width="44" height="44" viewBox="0 0 24 24"><path d="M12 2.5 L20 5.5 V11 C20 16 16.5 19.8 12 21.5 C7.5 19.8 4 16 4 11 V5.5 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 11.8 L11 14.3 L15.8 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    play: `<svg width="44" height="44" viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 9 L15.5 12 L10 15 Z" fill="currentColor"/></svg>`,
    link: `<svg width="44" height="44" viewBox="0 0 24 24"><path d="M4 8 H16 M12 4 L16 8 L12 12 M20 16 H8 M12 12 L8 16 L12 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    laptop: `<svg width="44" height="44" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 19.5 H22" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    search: `<svg width="44" height="44" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 L21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
    chart: `<svg width="44" height="44" viewBox="0 0 24 24"><path d="M4 20 V4 M4 20 H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 16 V12 M12 16 V8 M16 16 V10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  };
  const T = [
    ["shield", "NoX Shield", "Model Armor screens every source, question and chat.", "#FF8A95"],
    ["play", "Show NoX", "Record your screen. Gemini watches and writes the request.", "#F7B542"],
    ["link", "MCP + A2A", "Any coding agent gets the same knowledge and permissions.", "#5FCBD8"],
    ["laptop", "NoX Local", "Gemma on a laptop. The code never leaves the building.", "#A897F0"],
    ["search", "Hybrid search", "gemini-embedding-2 vectors fused with full-text.", "#86B9EE"],
    ["chart", "Impact", "Every mission measured: time per stage, send-backs, AI cost.", "#5FD29F"],
  ];
  $("#s9tiles").innerHTML = T.map(([ic, tt, tx, c], i) => {
    const x = 110 + (i % 3) * 580, y = 300 + Math.floor(i / 3) * 268;
    return `<div class="ftile glass" id="tile${i}" style="left:${x}px;top:${y}px;border-color:${c}55"><div class="sheen"></div><div class="ic" style="color:${c};background:${c}1F;border:2px solid ${c}77;box-shadow:0 0 30px ${c}33">${ICON[ic]}</div><div class="tt">${tt}</div><div class="tx">${tx}</div></div>`;
  }).join("");
  $("#s9tech").innerHTML = `<span class="t"><img src="vendor/logos/gemini.svg">Gemini</span><span class="t"><span class="sq" style="background:#4285F4;color:#fff">ADK</span>Agent Development Kit</span><span class="t"><span class="sq" style="background:#A897F0;color:#120A2A">G</span>Gemma</span><span class="t"><img src="vendor/logos/google-cloud.svg">Cloud Run</span><span class="t"><span class="sq" style="background:#F7B542;color:#1A1204">OK</span>Open Knowledge Format</span>`;
  $("#s9logos").innerHTML = ["github:GitHub", "jira:Jira", "confluence:Confluence", "notion:Notion", "slack:Slack"].map((s) => { const [k, n] = s.split(":"); return `<span class="l"><img src="vendor/logos/${k}.svg">${n}</span>`; }).join("");
  const CK = (c) => `<svg class="ck" viewBox="0 0 72 72"><circle cx="36" cy="36" r="33" fill="${c}22" stroke="${c}" stroke-width="3"/><path d="M22 37 L32 47 L51 27" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const PR = ["People own every decision.", "Grounded and cited, or it doesn’t ship.", "Scope is set by NoX, never the model.", "Everything lands in Git."];
  PR.forEach((txt, i) => { $("#pr" + (i + 1)).innerHTML = CK(HEX.verify) + `<span class="tx">${txt}</span>`; });

  sceneIn("#s9", 77.95, 0.3);
  tl.set(S.cam, { x: 0, y: 0, z: D + 600, tx: 0, ty: 0, tz: 0, drift: 1 }, 77.95);
  tl.to(S.cam, { z: D - 100, duration: 4.2, ease: "power2.out" }, 77.95);
  colorTo(S.neb.c1, "#060A1A", 77.95, 0.5); colorTo(S.neb.c2, "#2A4A9A", 77.95, 0.5); colorTo(S.neb.c3, "#8A6A2A", 77.95, 0.5);
  tl.set(S.bloom, { strength: 0.7, threshold: 0.6 }, 77.95);
  blurChars($("#s9k"), 78.0, { stagger: 0.012 });
  maskWords("#s9t", 78.1, { stagger: 0.05 });
  T.forEach((x, i) => {
    const t = 78.35 + i * 0.2;
    tl.fromTo("#tile" + i, { autoAlpha: 0, y: 90, z: -400, rotationX: -40, transformPerspective: 1600 }, { autoAlpha: 1, y: 0, z: 0, rotationX: 0, duration: 0.9, ease: "expo.out" }, t);
    tl.fromTo(`#tile${i} .ic`, { scale: 0, rotation: -45 }, { scale: 1, rotation: 0, duration: 0.6, ease: "back.out(2.5)" }, t + 0.15);
    cue("pop", t);
  });
  tl.fromTo("#s9 .ftile .sheen", { backgroundPosition: "130% 0" }, { backgroundPosition: "-30% 0", duration: 1.1, ease: "power2.inOut", stagger: 0.08 }, 79.9);
  tl.fromTo("#s9tech .t", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.1 }, 79.8);
  tl.to("#s9a", { autoAlpha: 0, scale: 1.08, filter: "blur(10px)", duration: 0.5, ease: "power2.in" }, 81.9);
  tl.to(S.cam, { z: D - 900, duration: 0.6, ease: "power3.in" }, 81.85);
  blur(81.85, 82.45, 6);
  cue("whoosh", 81.9, { d: 0.6 });

  /* ============================================================ S9b (82.3 - 86) */
  sceneIn("#s9b", 82.3, 0.3);
  tl.set(S.cam, { z: D + 300 }, 82.3);
  tl.to(S.cam, { z: D, duration: 3.8, ease: "power2.out" }, 82.3);
  colorTo(S.neb.c1, "#04120C", 82.3, 0.8); colorTo(S.neb.c2, "#1E5A44", 82.3, 0.8); colorTo(S.neb.c3, "#6A5A2A", 82.3, 0.8);
  blurChars($("#s9bk"), 82.35, { stagger: 0.02 });
  PR.forEach((_, i) => {
    const t = 82.5 + i * 0.5, id = "#pr" + (i + 1);
    tl.fromTo(`${id} .ck circle`, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.5, ease: "power2.out" }, t);
    tl.fromTo(`${id} .ck path`, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.35, ease: "power2.out" }, t + 0.2);
    const st = new SplitText($(`${id} .tx`), { type: "words", mask: "words" });
    tl.fromTo(st.words, { yPercent: 115 }, { yPercent: 0, duration: 0.7, ease: "expo.out", stagger: 0.03 }, t + 0.05);
    cue("ding", t + 0.2, { note: i });
  });
  tl.fromTo("#s9logos .l", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.08 }, 84.4);
  tl.to("#s9", { autoAlpha: 0, filter: "blur(8px)", duration: 0.45 }, 85.6);
  setOff("#s9", 86.05);

  /* ============================================================ S10 (86 - 90) */
  sceneIn("#s10", 85.95, 0.3);
  colorTo(S.neb.c1, "#140C04", 86.0, 1.0); colorTo(S.neb.c2, "#9A6420", 86.0, 1.0); colorTo(S.neb.c3, "#3A2C78", 86.0, 1.0);
  tl.set(S.cam, { x: 0, y: 0, z: D, tx: 0, ty: 0, tz: 0, drift: 0.4 }, 86.0);
  maskWords("#s10l1a", 86.05, { stagger: 0.06 });
  maskWords("#s10l2a", 86.6, { stagger: 0.05 });
  tl.to("#s10a", { autoAlpha: 0, y: -60, filter: "blur(8px)", duration: 0.5, ease: "power2.in" }, 87.7);
  // the sun returns, and the wordmark with it
  tl.set(S.sun, { on: 1, x: 0, y: 70, z: 0, scale: 0, heat: 2.6, corona: 0.4, ring: 0, ringA: 0, flare: 0 }, 87.9);
  tl.to(S.sun, { scale: 0.8, duration: 0.9, ease: "elastic.out(1,0.6)" }, 88.1);
  tl.to(S.sun, { heat: 1.1, corona: 0.7, duration: 1.2, ease: "power2.out" }, 88.1);
  tl.fromTo(S.sun, { ring: 0.4, ringA: 0.9 }, { ring: 7, ringA: 0, duration: 1.3, ease: "power2.out", immediateRender: false }, 88.1);
  tl.fromTo(S.sun, { flare: 0.9 }, { flare: 0.35, duration: 1.4, immediateRender: false }, 88.1);
  tl.fromTo(S.god, { s: 1.0 }, { s: 0.25, duration: 1.6, immediateRender: false }, 88.1);
  tl.fromTo(S.bloom, { strength: 1.8, threshold: 0.4 }, { strength: 0.75, threshold: 0.7, duration: 1.4, immediateRender: false }, 88.1);
  tl.fromTo("#flash", { opacity: 0 }, { opacity: 0.6, duration: 0.05, immediateRender: false }, 88.1);
  tl.to("#flash", { opacity: 0, duration: 0.7 }, 88.15);
  burst(960, 470, 88.1, { n: 300, dur: 1.3, speed: 1300 });
  cue("impact", 88.1, { soft: true });
  const L = { spread: 0, a: 0 };
  const N = $("#s10N"), X = $("#s10X");
  N.style.fontSize = X.style.fontSize = "330px";
  updaters.push(() => {
    if (L.a < 0.01 || S.sun.on < 0.01) { N.style.opacity = X.style.opacity = 0; return; }
    const s = project(S.sun.x, S.sun.y, S.sun.z); const k = S.sun.scale * s.s;
    N.style.opacity = X.style.opacity = L.a;
    N.style.transform = `translate(${s.x - 266 * k * L.spread}px, ${s.y}px) translate(-50%,-50%) scale(${k})`;
    X.style.transform = `translate(${s.x + 262 * k * L.spread}px, ${s.y}px) translate(-50%,-50%) scale(${k})`;
  });
  tl.fromTo(L, { spread: 0.1, a: 0 }, { spread: 1, a: 1, duration: 0.9, ease: "expo.out", immediateRender: false }, 88.3);
  gsap.set(["#s10l1", "#s10l2"], { autoAlpha: 0 });
  tl.fromTo("#s10l1", { autoAlpha: 0, y: 20, filter: "blur(8px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.7, immediateRender: false }, 88.65);
  tl.fromTo("#s10l2", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.6, immediateRender: false }, 88.95);
  tl.to("#blackout", { opacity: 1, duration: 0.45, ease: "power1.in" }, 89.55);

  // corner mark
  tl.fromTo("#bug", { autoAlpha: 0 }, { autoAlpha: 0.75, duration: 0.6 }, 30.4);
  tl.to("#bug", { autoAlpha: 0, duration: 0.3 }, 45.5);
  tl.to("#bug", { autoAlpha: 0.75, duration: 0.5 }, 70.4);
  tl.to("#bug", { autoAlpha: 0, duration: 0.4 }, 85.6);
}
