// Scenes 1-4: one sentence, lost in translation, AI everywhere, and the NoX ignition.
import { tl, hooks, cue, blur, $, $$, hash, sceneIn, setOff, maskWords, blurChars, rise, pop, typeText, scramble, cam2d, cam2dSet, blink, colorTo, HEX } from "./engine.js";
import { S, D, project, updaters, P, THREE } from "./world.js";
import { ROLES, mountPlanet, hover } from "./planets.js";
import { keyPath, comet, implode, burst } from "./fx.js";

export const capsule = { a: 0, c: "#FFD27A" };

export function build() {
  /* ============================================================ S1 (0-6) */
  tl.set(S.cam, { z: D + 520, drift: 1 }, 0);
  tl.to(S.cam, { z: D, duration: 6.4, ease: "power1.inOut" }, 0);
  colorTo(S.neb.c1, "#120A18", 0, 0.01); colorTo(S.neb.c2, "#9A6420", 0, 0.01); colorTo(S.neb.c3, "#3A2C78", 0, 0.01);
  tl.to(S.stars, { a: 1, duration: 2.6, ease: "power1.out" }, 0.0);
  tl.to(S.neb, { a: 0.75, duration: 3.5, ease: "power1.out" }, 0.2);
  tl.to(S.dust, { a: 0.55, duration: 3, ease: "power1.out" }, 0.6);
  sceneIn("#s1", 0.0, 0.3);
  // the box draws itself, a caret waits, then the sentence arrives
  gsap.set("#s1box", { autoAlpha: 0 });
  tl.fromTo("#s1rect", { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 1.3, ease: "power2.inOut" }, 0.25);
  tl.to("#s1rect", { opacity: 0, duration: 0.6 }, 1.6);
  tl.fromTo("#s1box", { autoAlpha: 0, scale: 0.985 }, { autoAlpha: 1, scale: 1, duration: 1.0, ease: "power2.out" }, 0.9);
  blurChars("#s1kt", 0.55, { stagger: 0.022 });
  tl.fromTo("#s1k .bar", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "expo.out" }, 0.6);
  const SENT = "Customers keep emailing support for invoices. Can they just download them?";
  cam2dSet("#s1cam", 0, 1.5, 616, 520, 760, 560);
  pop("#s1pl", 0.85, { scale: 0.3, y: 90, rotation: -20 }, 1.1, "back.out(1.5)");
  cue("pop", 0.95);
  // idle caret blinks before typing
  const car = $("#s1car");
  hooks.push((t) => { if (t > 0.9 && t < 1.45) { car.style.visibility = "visible"; car.style.opacity = Math.floor(t * 3) % 2 ? 0 : 1; } });
  typeText("#s1text", SENT, 1.45, 2.95, { caret: "#s1car", human: true, hold: 0.6 });
  cam2d("#s1cam", 1.4, 3.4, 1.0, 960, 540, 960, 540, "power2.inOut");
  blink($("#s1pl"), 2.6);
  const pl = $("#s1pl");
  tl.to(pl.querySelector(".bulb-glass"), { attr: { "fill-opacity": 1 }, duration: 0.3 }, 4.35)
    .to(pl.querySelector(".bulb-halo"), { opacity: 1, duration: 0.4 }, 4.35)
    .to(pl.querySelector(".specs"), { y: -7.5, duration: 0.45, ease: "back.out(1.8)" }, 4.45)
    .to(pl.querySelector(".bulb"), { keyframes: { rotation: [8, -6, 3, 0] }, duration: 0.9, ease: "sine.inOut", svgOrigin: "62 -44" }, 4.35);
  cue("ding", 4.35, { note: 0 });
  gsap.set("#s1who", { autoAlpha: 0 });
  rise("#s1who", 4.55, 0.7, 16);
  tl.fromTo("#s1sheen", { backgroundPosition: "130% 0" }, { backgroundPosition: "-30% 0", duration: 1.1, ease: "power2.inOut" }, 4.4);
  tl.to("#s1box", { boxShadow: "0 40px 120px rgba(0,0,0,.55),0 0 0 2px rgba(247,181,66,.7),0 0 90px rgba(247,181,66,.35)", duration: 0.6 }, 4.4);
  // the sentence becomes a capsule of light
  tl.to("#s1cam", { scale: 0.05, x: 1165 - 0.05 * 1165, y: 565 - 0.05 * 565, autoAlpha: 0, filter: "blur(6px)", duration: 0.55, ease: "power3.in" }, 5.25);
  tl.to("#s1k", { autoAlpha: 0, y: -20, duration: 0.4 }, 5.25);
  setOff("#s1", 6.0);
  blur(5.3, 6.35, 6);
  cue("whoosh", 5.35, { d: 0.8 });
  tl.set(capsule, { a: 0 }, 0);
  tl.to(capsule, { a: 1, duration: 0.2 }, 5.6);

  /* ============================================================ S2 (6-16) */
  const NODES = [
    { role: "business", name: "Business user", where: "in a meeting", x: 260 },
    { role: "product", name: "Product owner", where: "writes a ticket", x: 610 },
    { role: "engineering", name: "Engineering lead", where: "asks around", x: 960 },
    { role: "developer", name: "Developer", where: "a day in the code", x: 1310 },
    { role: null, name: "Shipped", where: "vs. the ticket", x: 1660 },
  ];
  const Y = 420;
  const host = $("#s2nodes");
  NODES.forEach((n, i) => {
    const el = document.createElement("div"); el.className = "pl"; el.id = "s2n" + i;
    el.style.left = n.x + "px"; el.style.top = Y + "px"; host.appendChild(el);
    if (n.role) mountPlanet(el, n.role, 150);
    else {
      el.style.width = el.style.height = "150px"; gsap.set(el, { xPercent: -50, yPercent: -50 });
      el.innerHTML = `<div style="width:100%;height:100%;border-radius:36px;display:grid;place-items:center;background:linear-gradient(180deg,#23283E,#11152A);border:2px solid rgba(233,113,60,.6);box-shadow:0 0 50px rgba(233,113,60,.3);font-size:76px;color:var(--ember);font-weight:800;transform:rotate(45deg) scale(.78)"><span style="transform:rotate(-45deg)">✓</span></div>`;
    }
    const lab = document.createElement("div"); lab.className = "plabel"; lab.id = "s2l" + i;
    lab.style.left = n.x + "px"; lab.style.top = (Y + 100) + "px";
    lab.innerHTML = `<div class="node-name" style="color:${n.role ? ROLES[n.role].hue : "var(--ember)"}">${n.name}</div><div class="node-where">${n.where}</div>`;
    host.appendChild(lab);
  });
  const QUOTES = [
    "Customers keep emailing support for invoices. Can they just download them?",
    "INV-88: add PDF export.",
    "New PDF service? Let’s ask around.",
    "Email every invoice as a PDF, nightly.",
    "Ticket closed.",
  ];
  const HUES = [HEX.biz, HEX.po, HEX.eng, HEX.dev, HEX.ember];
  $("#s2q").textContent = QUOTES[0];
  sceneIn("#s2", 6.0, 0.3);
  colorTo(S.neb.c2, "#8A4A1C", 6, 2); colorTo(S.neb.c3, "#4A2A6A", 6, 2);
  blurChars($("#s2k"), 6.05, { stagger: 0.015 });
  maskWords("#s2t", 6.15, { stagger: 0.05 });
  NODES.forEach((n, i) => { pop("#s2n" + i, 6.3 + i * 0.1, { scale: 0.2, y: 0 }, 0.75, "back.out(2)"); rise("#s2l" + i, 6.45 + i * 0.1, 0.6, 16); });
  cue("pop", 6.3); cue("pop", 6.5); cue("pop", 6.7);
  gsap.set(["#s2quote", "#s2meter"], { autoAlpha: 0 });
  rise("#s2quote", 6.7, 0.8, 24);
  rise("#s2meter", 6.9, 0.7, 16);
  tl.fromTo("#s2prog", { drawSVG: "0% 0%" }, { drawSVG: "0% 0%", duration: 0.01 }, 6.0);
  [1, 2, 3, 4].forEach((i) => tl.to(["#s2n" + i, "#s2l" + i], { opacity: 0.38, duration: 0.4 }, 7.0));
  const HOPS = [7.4, 9.0, 10.6, 12.2];
  const meter = [1, 0.7, 0.46, 0.24, 0.07];
  // capsule path: from the sentence card, then node to node
  const keys = [[5.55, 1165, 565, [760, 250]], [6.25, 260, Y]];
  HOPS.forEach((h, i) => { keys.push([h, NODES[i].x, Y]); keys.push([h + 0.55, NODES[i + 1].x, Y]); });
  const capPath = keyPath(keys);
  comet(capPath, capsule, { t0: 5.4, t1: 13.6 });
  HOPS.forEach((h, i) => {
    tl.to("#s2prog", { drawSVG: `0% ${25 * (i + 1)}%`, duration: 0.55, ease: "power2.inOut" }, h);
    cue("whoosh", h, { d: 0.5, soft: true });
    tl.to(["#s2n" + (i + 1), "#s2l" + (i + 1)], { opacity: 1, duration: 0.3 }, h + 0.35);
    tl.to(["#s2n" + i, "#s2l" + i], { opacity: 0.38, duration: 0.4 }, h + 0.3);
    tl.fromTo("#s2n" + (i + 1), { scale: 1 }, { scale: 1.2, duration: 0.16, yoyo: true, repeat: 1, ease: "power1.out", immediateRender: false }, h + 0.5);
    if (NODES[i + 1].role) hover("#s2n" + (i + 1), NODES[i + 1].role, h + 0.45, 1.0);
    scramble("#s2q", QUOTES[i + 1], h + 0.32, 0.8);
    tl.to(["#s2qa", "#s2qb"], { color: HUES[i + 1], duration: 0.3 }, h + 0.4);
    tl.to("#s2fill", { scaleX: meter[i + 1], duration: 0.6, ease: "power2.out" }, h + 0.45);
    if (i >= 1) tl.to("#s2fill", { background: i >= 2 ? "linear-gradient(90deg,#E9713C,#FF5D6C)" : "linear-gradient(90deg,#F7B542,#E9713C)", boxShadow: i >= 2 ? "0 0 20px rgba(255,93,108,.6)" : "0 0 20px rgba(233,113,60,.6)", duration: 0.5 }, h + 0.45);
    tl.to(capsule, { c: [HEX.nox, "#F39A50", HEX.ember, "#FF6A5A"][i], duration: 0.4 }, h);
    colorTo(S.neb.c2, ["#8A4A1C", "#8C3A1A", "#8A2A20", "#7A1E22"][i], h, 1.2);
  });
  tl.to("#s2q", { color: "#FFB3A0", duration: 0.4 }, 12.6);
  // verdict
  tl.to(capsule, { a: 0, duration: 0.3 }, 13.3);
  tl.to(["#s2nodes", "#s2line", "#s2quote", "#s2meter", "#s2k", "#s2t"], { autoAlpha: 0, y: -30, filter: "blur(8px)", duration: 0.45, ease: "power2.in", stagger: 0.02 }, 13.4);
  gsap.set(["#s2w1", "#s2w2", "#s2neq", "#s2sub"], { autoAlpha: 0 });
  tl.fromTo("#s2w1", { autoAlpha: 0, x: -160, filter: "blur(10px)" }, { autoAlpha: 1, x: 0, filter: "blur(0px)", duration: 0.7, ease: "expo.out" }, 13.8);
  tl.fromTo("#s2w2", { autoAlpha: 0, x: 160, filter: "blur(10px)" }, { autoAlpha: 1, x: 0, filter: "blur(0px)", duration: 0.7, ease: "expo.out" }, 13.8);
  tl.fromTo("#s2neq", { autoAlpha: 0, scale: 3.2 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "expo.out" }, 14.0);
  tl.fromTo("#flash", { opacity: 0 }, { opacity: 0.35, duration: 0.05, immediateRender: false }, 14.0);
  tl.to("#flash", { opacity: 0, duration: 0.5 }, 14.05);
  cue("impact", 14.0, { soft: true });
  maskWords("#s2sub", 14.45, { stagger: 0.04 });
  const neq = $("#s2neq");
  hooks.push((t) => {
    if (t < 13.95 || t > 16) return;
    const k = Math.floor(t * 30);
    const on = hash(k, 5) > 0.6 || (t > 14.0 && t < 14.3);
    const dx = on ? (hash(k, 9) - 0.5) * 24 : 0;
    neq.style.textShadow = on ? `${dx}px 0 #FF2D55, ${-dx}px 0 #2DE2FF` : "0 0 40px rgba(255,255,255,.35)";
  });
  cue("glitch", 14.7, { d: 0.25 }); cue("glitch", 15.3, { d: 0.2 });
  // glitch-out transition
  const gbs = $$(".glitchbar");
  hooks.push((t) => {
    const on = t > 15.55 && t < 16.05;
    gbs.forEach((g, i) => {
      if (!on) { g.style.opacity = 0; return; }
      const k = Math.floor(t * 30) + i * 7;
      g.style.opacity = hash(k, 1) > 0.35 ? 0.85 : 0;
      g.style.top = Math.floor(hash(k, 2) * 1040) + "px";
      g.style.height = 8 + Math.floor(hash(k, 3) * 60) + "px";
      g.style.background = ["#FF2D55", "#2DE2FF", "#F7B542"][i];
      g.style.transform = `translateX(${(hash(k, 4) - 0.5) * 300}px)`;
    });
    if (on) { const k = Math.floor(t * 30); $("#s2cam").style.transform = `translate(${(hash(k, 8) - 0.5) * 60}px, ${(hash(k, 9) - 0.5) * 16}px) skewX(${(hash(k, 10) - 0.5) * 10}deg)`; }
  });
  tl.to("#s2end", { autoAlpha: 0, duration: 0.2 }, 15.85);
  cue("glitch", 15.55, { d: 0.45 });
  setOff("#s2", 16.05);

  /* ============================================================ S3 (16-23) */
  const CH = [
    ["business", "Business user", "Turn my email into a requirement.", "Here’s a polished paragraph…", 110, 270],
    ["product", "Product owner", "Write acceptance criteria for this.", "Given… when… then…", 990, 270],
    ["engineering", "Engineering lead", "Which systems does this touch?", "I can’t see your systems.", 110, 600],
    ["developer", "Developer", "What did the business actually want?", "Could you paste the ticket?", 990, 600],
  ];
  const ch = $("#s3chats");
  CH.forEach(([role, name, q, a, x, y], i) => {
    const d = document.createElement("div"); d.className = "chat glass"; d.id = "s3c" + i;
    d.style.left = x + "px"; d.style.top = y + "px";
    d.innerHTML = `<div class="hd"><span style="position:relative;width:76px;height:64px;flex:none"><div class="pl" style="left:38px;top:32px"></div></span><span style="color:${ROLES[role].hue}">${name}</span><span class="mono" style="margin-left:auto;font-size:26px;color:var(--faint);font-weight:500">private chat</span></div>
      <div class="ub">${q}</div><div class="ab" id="s3a${i}"><span class="ai">AI</span><span class="txt"></span></div>`;
    ch.appendChild(d);
    mountPlanet(d.querySelector(".pl"), role, 64, false);
  });
  // links between the silos, which break
  const centers = CH.map(([, , , , x, y]) => [x + 410, y + 148]);
  const pairs = [[0, 1], [2, 3], [0, 2], [1, 3]];
  $("#s3links").innerHTML = pairs.map(([a, b], i) => `<line id="lk${i}" x1="${centers[a][0]}" y1="${centers[a][1]}" x2="${centers[b][0]}" y2="${centers[b][1]}" stroke="#86B9EE" stroke-width="3" stroke-dasharray="10 10" opacity=".55"/>` +
    `<g id="lx${i}" opacity="0" transform="translate(${(centers[a][0] + centers[b][0]) / 2} ${(centers[a][1] + centers[b][1]) / 2})"><circle r="26" fill="#1A0D12" stroke="#FF5D6C" stroke-width="3"/><path d="M-9 -9 L9 9 M9 -9 L-9 9" stroke="#FF5D6C" stroke-width="4" stroke-linecap="round"/></g>`).join("");
  sceneIn("#s3", 16.0, 0.25);
  colorTo(S.neb.c2, "#5A2A3A", 16, 1.5); colorTo(S.neb.c3, "#1E4A6A", 16, 1.5);
  blurChars($("#s3k"), 16.05, { stagger: 0.015 });
  maskWords("#s3t", 16.15, { stagger: 0.05 });
  CH.forEach((c, i) => {
    const t = 16.45 + i * 0.3;
    tl.fromTo("#s3c" + i, { autoAlpha: 0, y: 70, rotationX: -28, transformPerspective: 1600, transformOrigin: "50% 100%" }, { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.9, ease: "expo.out" }, t);
    cue("pop", t);
    rise(`#s3c${i} .ub`, t + 0.25, 0.45, 10);
    tl.fromTo(`#s3a${i}`, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, t + 0.6);
    typeText($(`#s3a${i} .txt`), c[3], t + 0.65, 0.55, { sound: i % 2 === 0 });
  });
  tl.fromTo("#s3links line", { drawSVG: "50% 50%" }, { drawSVG: "0% 100%", duration: 0.6, ease: "power2.out", stagger: 0.08 }, 17.6);
  // the links snap
  tl.to("#s3links line", { stroke: "#FF5D6C", attr: { "stroke-dasharray": "4 26" }, duration: 0.3, stagger: 0.05 }, 18.75);
  tl.fromTo("#s3links g", { opacity: 0, scale: 0.3, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(3)", stagger: 0.07 }, 18.8);
  cue("error", 18.8);
  tl.to(["#s3c0", "#s3c2"], { x: -46, duration: 1.0, ease: "power2.inOut" }, 18.9);
  tl.to(["#s3c1", "#s3c3"], { x: 46, duration: 1.0, ease: "power2.inOut" }, 18.9);
  tl.to(["#s3c0", "#s3c1"], { y: -22, duration: 1.0, ease: "power2.inOut" }, 18.9);
  tl.to(["#s3c2", "#s3c3"], { y: 22, duration: 1.0, ease: "power2.inOut" }, 18.9);
  tl.to(".chat", { borderColor: "rgba(255,93,108,.55)", duration: 0.5 }, 18.9);
  tl.to(["#s3chats", "#s3links", "#s3k", "#s3t"], { autoAlpha: 0, scale: 0.95, filter: "blur(10px)", duration: 0.45, ease: "power2.in" }, 19.65);
  gsap.set(["#s3p1", "#s3p2", "#s3p3"], { autoAlpha: 0 });
  ["#s3p1", "#s3p2", "#s3p3"].forEach((p, i) => {
    const t = 20.05 + i * 0.55;
    tl.set(p, { autoAlpha: 1 }, t);
    tl.fromTo(p + " .ic", { scale: 0, rotation: -60 }, { scale: 1, rotation: 0, duration: 0.6, ease: "back.out(2.4)" }, t);
    const st = new SplitText($(p + " .pt"), { type: "words", mask: "words" });
    tl.fromTo(st.words, { yPercent: 115 }, { yPercent: 0, duration: 0.7, ease: "expo.out", stagger: 0.035 }, t + 0.05);
    cue("hit", t);
  });
  tl.to(S.cam, { z: D - 260, duration: 3.2, ease: "power2.in" }, 20.0);
  // everything is sucked into one point
  tl.to(["#s3p1", "#s3p2", "#s3p3"], { scale: 0.04, y: (i) => [168, 0, -168][i], autoAlpha: 0, filter: "blur(10px)", duration: 0.6, ease: "power3.in", stagger: 0.03 }, 22.2);
  implode(960, 452, 21.9, 23.95, { n: 380 });
  tl.to(S.neb, { a: 0.18, duration: 1.4 }, 21.8);
  tl.to(S.stars, { a: 0.45, duration: 1.2 }, 21.9);
  tl.to(S.dust, { a: 0.15, duration: 1.2 }, 21.9);
  setOff("#s3", 22.95);
  cue("riser", 21.5, { d: 2.5 });
  blur(22.15, 22.85, 5);

  /* ============================================================ S4 (23-30) */
  tl.set(S.sun, { on: 1, x: 0, y: 88, z: 0, scale: 0.0, heat: 3.0, corona: 0.5, ring: 0, ringA: 0, flare: 0 }, 22.0);
  tl.set(S.cam, { z: D, x: 0, y: 0, tx: 0, ty: 0, tz: 0, drift: 0.35 }, 23.0);
  tl.to(S.sun, { scale: 0.1, duration: 1.0, ease: "power3.in" }, 22.95);
  tl.to(S.bloom, { strength: 1.2, threshold: 0.5, duration: 1.0, ease: "power2.in" }, 23.0);
  sceneIn("#s4", 22.95, 0.05);
  // IGNITION
  tl.to(S.sun, { scale: 1, duration: 0.95, ease: "elastic.out(1,0.55)" }, 24.0);
  tl.to(S.sun, { heat: 1.0, corona: 0.75, duration: 1.6, ease: "power2.out" }, 24.0);
  tl.fromTo(S.sun, { ring: 0.4, ringA: 1 }, { ring: 9, ringA: 0, duration: 1.5, ease: "power2.out", immediateRender: false }, 24.0);
  tl.fromTo(S.bloom, { strength: 2.4, threshold: 0.35 }, { strength: 0.75, threshold: 0.75, duration: 1.8, ease: "power2.out", immediateRender: false }, 24.0);
  tl.fromTo(S.god, { s: 1.6 }, { s: 0.3, duration: 2.0, ease: "power2.out", immediateRender: false }, 24.0);
  tl.fromTo(S.sun, { flare: 1.1 }, { flare: 0.4, duration: 1.8, ease: "power2.out", immediateRender: false }, 24.0);
  tl.fromTo("#whiteout", { opacity: 0 }, { opacity: 0.85, duration: 0.05, ease: "none", immediateRender: false }, 24.0);
  tl.to("#whiteout", { opacity: 0, duration: 0.45, ease: "power2.out" }, 24.05);
  tl.fromTo(S.cam, { z: D }, { z: D - 160, duration: 0.25, ease: "power2.out", immediateRender: false }, 24.0);
  tl.to(S.cam, { z: D, duration: 1.4, ease: "power2.inOut" }, 24.25);
  tl.to(S.neb, { a: 0.85, duration: 0.6 }, 24.0);
  tl.to(S.stars, { a: 1, duration: 0.4 }, 24.0);
  tl.to(S.dust, { a: 0.5, duration: 0.8 }, 24.0);
  colorTo(S.neb.c1, "#1A0E06", 24.0, 0.2); colorTo(S.neb.c2, "#C07A22", 24.0, 0.2); colorTo(S.neb.c3, "#7A2E14", 24.0, 0.2);
  burst(960, 452, 24.0, { n: 460, dur: 1.5 });
  blur(23.95, 24.6, 8);
  cue("impact", 24.0);
  // the wordmark: N and X slide out from behind the sun
  const L = { spread: 0, a: 0 };
  const N = $("#wmN"), X = $("#wmX");
  const nW = 230, xW = 220; // approximate glyph boxes at 330px; centred via translate(-50%)
  hooks.push(() => {});
  updaters.push(() => {
    if (L.a < 0.01 || S.sun.on < 0.01) { N.style.opacity = X.style.opacity = 0; return; }
    const s = project(S.sun.x, S.sun.y, S.sun.z);
    const k = S.sun.scale * s.s; // on-screen scale of the logo
    N.style.opacity = X.style.opacity = L.a;
    N.style.transform = `translate(${s.x - 266 * k * L.spread}px, ${s.y}px) translate(-50%,-50%) scale(${k})`;
    X.style.transform = `translate(${s.x + 262 * k * L.spread}px, ${s.y}px) translate(-50%,-50%) scale(${k})`;
  });
  gsap.set(["#wmN", "#wmX"], { opacity: 0, transformOrigin: "50% 50%" });
  tl.fromTo(L, { spread: 0.1, a: 0 }, { spread: 1, a: 1, duration: 1.0, ease: "expo.out", immediateRender: false }, 24.35);
  cue("whoosh", 24.3, { d: 0.6, soft: true });
  gsap.set("#s4tag", { autoAlpha: 0 });
  tl.set("#s4tag", { autoAlpha: 1 }, 25.05);
  const tagSplit = new SplitText("#s4tag", { type: "words" });
  tl.fromTo(tagSplit.words, { autoAlpha: 0, y: 26, filter: "blur(10px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.8, ease: "power3.out", stagger: 0.07 }, 25.05);
  // logo rises, the two halves appear
  tl.to(S.sun, { y: 88 + 268, scale: 0.42, duration: 1.0, ease: "power3.inOut" }, 26.55);
  tl.to(S.god, { s: 0.12, duration: 1.0 }, 26.55);
  tl.to(S.sun, { flare: 0.12, corona: 0.55, duration: 1.0 }, 26.55);
  tl.to("#s4tag", { y: -40, autoAlpha: 0, filter: "blur(8px)", duration: 0.5, ease: "power2.in" }, 26.5);
  tl.fromTo("#hA", { autoAlpha: 0, y: 140, rotationX: 38 }, { autoAlpha: 1, y: 0, rotationX: 0, duration: 1.1, ease: "expo.out" }, 26.95);
  tl.fromTo("#hB", { autoAlpha: 0, y: 140, rotationX: 38 }, { autoAlpha: 1, y: 0, rotationX: 0, duration: 1.1, ease: "expo.out" }, 27.12);
  tl.fromTo("#s4 .half .sheen", { backgroundPosition: "130% 0" }, { backgroundPosition: "-30% 0", duration: 1.2, ease: "power2.inOut", stagger: 0.2 }, 27.7);
  cue("pop", 27.0); cue("pop", 27.2);
  colorTo(S.neb.c2, "#9A6420", 26.6, 1.2); colorTo(S.neb.c3, "#2A3A7A", 26.6, 1.2);
  tl.to(S.neb, { a: 0.7, duration: 1.2 }, 26.6);
  // zoom through the Atlas card
  cam2d("#s4cam", 29.15, 0.8, 3.2, 545, 665, 960, 540, "power3.in");
  tl.to(L, { a: 0, duration: 0.3 }, 29.15);
  tl.to(S.sun, { on: 0, duration: 0.4 }, 29.15);
  tl.to(S.god, { s: 0, duration: 0.3 }, 29.15);
  tl.to(S.cam, { z: D - 900, duration: 0.9, ease: "power3.in" }, 29.15);
  tl.fromTo("#whiteout", { opacity: 0 }, { opacity: 0.55, duration: 0.3, ease: "power2.in", immediateRender: false }, 29.6);
  tl.to("#whiteout", { opacity: 0, duration: 0.5, ease: "power2.out" }, 29.9);
  setOff("#s4", 29.95);
  blur(29.15, 30.25, 8);
  cue("whoosh", 29.2, { d: 0.8 });
}
