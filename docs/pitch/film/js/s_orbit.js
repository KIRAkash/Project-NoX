// Scenes 6 and 8: the mission trajectory as a 3D orbit. Forward along the far arc
// (business -> product -> engineering -> developer), back along the near arc for verification.
import { tl, cue, blur, $, $$, sceneIn, setOff, maskWords, blurChars, rise, blink, colorTo, HEX } from "./engine.js";
import { S, D, scene, project, updaters, P, THREE } from "./world.js";
import { ROLES, mountPlanet } from "./planets.js";
import { glowTube, Circle } from "./gl3d.js";

const RO = 700;
const at = (th) => new THREE.Vector3(RO * Math.cos(th), 0, -RO * Math.sin(th)); // th=90deg is the far side
const DEG = Math.PI / 180;
const SEATS = [
  { role: "business", name: "Business user", home: "Request desk", th: 180 * DEG },
  { role: "product", name: "Product owner", home: "Product board", th: 122 * DEG },
  { role: "engineering", name: "Engineering lead", home: "Flight director", th: 58 * DEG },
  { role: "developer", name: "Developer", home: "Build bay", th: 0 },
];

export function build() {
  const O = { on: 0, fwd: 0, back: 0, ring: 0, planets: 0 };
  const grp = new THREE.Group(); scene.add(grp); grp.visible = false;
  // a curve through th0 -> th1 (radians, decreasing allowed)
  class Arc extends THREE.Curve { constructor(a, b) { super(); this.a = a; this.b = b; } getPoint(u, v = new THREE.Vector3()) { return v.copy(at(this.a + (this.b - this.a) * u)); } }
  const ring = glowTube(new Circle(RO), "#8FA0CC", { radius: 1.6, segs: 300, a: 0.3, dash: 90 });
  const fwd = glowTube(new Arc(Math.PI, 0), HEX.biz, { radius: 4.2, segs: 240, a: 0.9, hex2: HEX.dev, pulse: 3, speed: 0.5 });
  // two-stop gradient is not enough for four hues: tint the middle with a second tube underneath
  const fwdMid = glowTube(new Arc(Math.PI * 0.75, Math.PI * 0.25), HEX.po, { radius: 5.0, segs: 160, a: 0.35, hex2: HEX.eng });
  const back = glowTube(new Arc(0, -Math.PI), HEX.verify, { radius: 4.2, segs: 240, a: 0.9, pulse: 3, speed: 0.6 });
  grp.add(ring, fwdMid, fwd, back);

  // DOM: seat planets, labels and badges, placed from 3D each frame
  const host = $("#oplanets");
  SEATS.forEach((p, i) => {
    host.insertAdjacentHTML("beforeend", `<div class="abs" id="on${i}" style="left:0;top:0;width:0;height:0"><div class="pl" id="op${i}"></div><div class="badge" id="ob${i}" style="left:24px;top:-110px">✓</div></div><div class="olabel" id="ol${i}"><div class="n" style="color:${ROLES[p.role].hue}">${p.name}</div><div class="h">${p.home}</div></div>`);
    const el = $("#op" + i); el.style.left = "0px"; el.style.top = "0px";
    mountPlanet(el, p.role, 160);
  });
  gsap.set($$("#oplanets .badge"), { autoAlpha: 0 });

  // comet along the orbit: th(t) from keys, trail sampled at earlier times
  const KEYS = [];
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const thAt = (t) => {
    if (!KEYS.length || t <= KEYS[0][0]) return KEYS.length ? KEYS[0][1] : Math.PI;
    for (let i = 1; i < KEYS.length; i++) if (t <= KEYS[i][0]) { const [t0, a0] = KEYS[i - 1], [t1, a1] = KEYS[i]; return a0 + (a1 - a0) * ease((t - t0) / (t1 - t0)); }
    return KEYS[KEYS.length - 1][1];
  };
  const key = (t, th) => KEYS.push([t, th]);
  const CM = { a: 0, c: "#FFD27A" };
  const hot = new THREE.Color("#FFFFFF");
  const v = new THREE.Vector3();

  updaters.push((t) => {
    grp.visible = O.on > 0.001;
    host.style.display = grp.visible ? "block" : "none";
    if (!grp.visible) return;
    ring.material.uniforms.a.value = 0.3 * O.on; ring.material.uniforms.prog.value = O.ring; ring.material.uniforms.t.value = t;
    fwd.material.uniforms.prog.value = O.fwd; fwd.material.uniforms.t.value = t; fwd.material.uniforms.a.value = 0.9 * O.on;
    fwdMid.material.uniforms.prog.value = Math.min(1, Math.max(0, (O.fwd - 0.25) / 0.5)); fwdMid.material.uniforms.a.value = 0.35 * O.on;
    back.material.uniforms.prog.value = O.back; back.material.uniforms.t.value = t; back.material.uniforms.a.value = 0.9 * O.on;
    SEATS.forEach((p, i) => {
      const w = at(p.th); const s = project(w.x, w.y, w.z);
      const k = s.s * 1.05;
      const node = $("#on" + i);
      node.style.transform = `translate(${s.x}px, ${s.y}px) scale(${k})`;
      node.style.zIndex = Math.round(1000 - s.z * 100);
      const lab = $("#ol" + i);
      lab.style.transform = `translate(${s.x}px, ${s.y + 92 * k}px) translate(-50%, 0)`;
      lab.style.opacity = O.planets;
      p._s = s;
    });
    // comet
    if (CM.a > 0.01) {
      const col = new THREE.Color(CM.c);
      for (let i = 46; i >= 0; i--) {
        const u = i / 46; v.copy(at(thAt(t - u * 0.4)));
        const s = project(v.x, v.y, v.z);
        P.add(s.x, s.y, (1 - u) * 22 * s.s + 3, i < 2 ? hot : col, CM.a * (1 - u) * 0.75, 0);
      }
      v.copy(at(thAt(t))); const s = project(v.x, v.y, v.z);
      P.add(s.x, s.y, 170 * s.s, col, CM.a * 0.45, 1);
      P.add(s.x, s.y, 30 * s.s + 6, hot, CM.a, 0);
    }
  });

  /* ============================================================ S6 (42 - 46) */
  sceneIn("#s6", 41.95, 0.3);
  gsap.set(["#s8k", "#s8t", "#cap", "#jira"], { autoAlpha: 0 });
  tl.set(O, { on: 1 }, 41.95);
  tl.set(S.cam, { x: 0, y: 430, z: 1420, tx: 0, ty: 70, tz: 0, drift: 0.8 }, 41.95);
  tl.fromTo(S.cam, { x: -500, y: 900, z: 1100 }, { x: 0, y: 430, z: 1420, duration: 2.2, ease: "power3.out", immediateRender: false }, 41.95);
  colorTo(S.neb.c1, "#0E0A1A", 41.95, 0.4); colorTo(S.neb.c2, "#6A4A9A", 41.95, 0.4); colorTo(S.neb.c3, "#7A5A20", 41.95, 0.4);
  tl.set(S.bloom, { strength: 0.8, threshold: 0.55 }, 41.95);
  blurChars($("#s6k"), 42.0, { stagger: 0.015 });
  maskWords("#s6t", 42.1, { stagger: 0.05 });
  tl.fromTo(O, { ring: 0 }, { ring: 1, duration: 1.2, ease: "power2.inOut", immediateRender: false }, 42.05);
  SEATS.forEach((p, i) => {
    const t = 42.3 + i * 0.22;
    tl.fromTo("#op" + i, { scale: 0.1, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.8, ease: "back.out(2)" }, t);
    cue("pop", t);
    blink($("#op" + i), 43.7 + i * 0.3);
  });
  tl.fromTo(O, { planets: 0 }, { planets: 1, duration: 0.6 }, 42.6);
  key(0, Math.PI); key(43.6, Math.PI); key(45.4, 0);
  tl.to(CM, { a: 1, duration: 0.3 }, 43.5);
  tl.fromTo(O, { fwd: 0 }, { fwd: 1, duration: 1.8, ease: "power2.inOut", immediateRender: false }, 43.6);
  cue("whoosh", 43.6, { d: 1.8, soft: true });
  [1, 2, 3].forEach((i) => tl.fromTo("#op" + i, { scale: 1 }, { scale: 1.16, duration: 0.15, yoyo: true, repeat: 1, immediateRender: false }, 43.6 + (i / 3) * 1.8 - 0.12));
  tl.to(CM, { a: 0, duration: 0.3 }, 45.45);
  // dive into the business planet
  const B = at(Math.PI);
  tl.to(S.cam, { x: B.x + 40, y: 120, z: B.z + 380, tx: B.x, ty: 20, tz: B.z, duration: 0.65, ease: "power3.in" }, 45.35);
  tl.to(["#s6k", "#s6t", "#ol1", "#ol2", "#ol3"], { autoAlpha: 0, duration: 0.3 }, 45.3);
  tl.to(O, { on: 0, duration: 0.3 }, 45.7);
  setOff("#s6", 46.0);
  blur(45.35, 46.1, 8);
  cue("whoosh", 45.4, { d: 0.6 });

  /* ============================================================ S8 (70 - 78) */
  tl.set(["#s6k", "#s6t"], { autoAlpha: 0 }, 69.0);
  tl.set(["#ol1", "#ol2", "#ol3"], { autoAlpha: 1 }, 69.0);
  tl.set(O, { fwd: 1, ring: 1, back: 0, planets: 1 }, 69.0);
  sceneIn("#s6", 69.95, 0.35);
  tl.set(O, { on: 1 }, 69.95);
  tl.set(S.cam, { x: 0, y: 430, z: 1420, tx: 0, ty: 25, tz: 0, drift: 0.8 }, 69.95);
  tl.fromTo(S.cam, { x: 600, y: 300, z: 1250 }, { x: 0, y: 430, z: 1420, duration: 1.6, ease: "power3.out", immediateRender: false }, 69.95);
  colorTo(S.neb.c1, "#06120E", 69.95, 0.4); colorTo(S.neb.c2, "#2A6A5A", 69.95, 0.4); colorTo(S.neb.c3, "#3A3A8A", 69.95, 0.4);
  blurChars($("#s8k"), 70.0, { stagger: 0.015 });
  maskWords("#s8t", 70.1, { stagger: 0.05 });
  tl.fromTo("#jira", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 70.3);
  tl.set("#j3", { className: "s on" }, 70.3);
  tl.set("#cap", { autoAlpha: 1 }, 70.5);
  const A_DEV = 0, A_ENG = -Math.PI / 3, A_PO = -2 * Math.PI / 3, A_BIZ = -Math.PI;
  key(69.9, A_DEV); key(70.7, A_DEV); key(71.6, A_ENG); key(72.3, A_ENG); key(73.2, A_PO);
  key(73.85, A_PO); key(74.45, A_DEV); key(74.7, A_DEV); key(75.3, A_PO); key(75.55, A_PO); key(76.25, A_BIZ);
  tl.to(CM, { a: 1, duration: 0.3 }, 70.5);
  tl.set(CM, { c: "#9DF5C8" }, 70.5);
  const caption = (t, who, color, text, size = 64) => {
    tl.to("#cap", { autoAlpha: 0, y: -14, duration: 0.15 }, t - 0.15);
    const w = $("#capw"), c = $("#capc"); const o = { k: 0 };
    tl.to(o, { k: 1, duration: 0.01, onUpdate() { if (o.k >= 1) { w.textContent = who; w.style.color = color; c.innerHTML = text; c.style.fontSize = size + "px"; } } }, t);
    tl.fromTo("#cap", { autoAlpha: 0, y: 24, filter: "blur(8px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.4, immediateRender: false }, t);
  };
  const check = (i, t, bad = false) => {
    tl.fromTo("#ob" + i, { autoAlpha: 0, scale: 0.2, rotation: -40 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.5, ease: "back.out(2.5)", immediateRender: false }, t);
    tl.fromTo("#op" + i, { scale: 1 }, { scale: 1.16, duration: 0.15, yoyo: true, repeat: 1, immediateRender: false }, t);
    cue(bad ? "error" : "ding", t, { note: i });
  };
  const flare = (i, t, hex, a = 0.6) => {
    const st = { a: 0 };
    updaters.push(() => { if (st.a > 0.01 && SEATS[i]._s) P.add(SEATS[i]._s.x, SEATS[i]._s.y, 420 * SEATS[i]._s.s, new THREE.Color(hex), st.a, 1); });
    tl.fromTo(st, { a: a }, { a: 0, duration: 0.9, ease: "power2.out", immediateRender: false }, t);
  };
  tl.to(O, { back: 1 / 6, duration: 0.9, ease: "power2.inOut" }, 70.7);
  check(3, 70.75); flare(3, 70.75, HEX.verify);
  caption(70.75, "Developer", "var(--dev)", "The code matches the build spec.");
  check(2, 72.0); flare(2, 72.0, HEX.verify);
  caption(72.0, "Engineering lead", "var(--eng)", "No contract broke.");
  tl.to(O, { back: 0.5, duration: 1.3, ease: "power2.inOut" }, 71.6);
  tl.set("#ob1", { className: "badge x", textContent: "✕" }, 73.15);
  check(1, 73.2, true); flare(1, 73.2, HEX.red, 0.8);
  tl.set(CM, { c: "#FF8A95" }, 73.2);
  caption(73.2, "Product owner", "var(--red)", "Prorated invoices missing. Sent back.");
  tl.fromTo(S.cam, { x: 0 }, { keyframes: { x: [-22, 18, -12, 7, 0] }, duration: 0.45, ease: "none", immediateRender: false }, 73.2);
  tl.fromTo("#op3", { scale: 1 }, { scale: 1.2, duration: 0.15, yoyo: true, repeat: 1, immediateRender: false }, 74.45);
  tl.set(CM, { c: "#9DF5C8" }, 74.5);
  tl.to("#ob1", { autoAlpha: 0, scale: 0.4, duration: 0.15 }, 75.1);
  tl.set("#ob1", { className: "badge", textContent: "✓" }, 75.27);
  check(1, 75.3); flare(1, 75.3, HEX.verify);
  caption(75.3, "Product owner", "var(--po)", "Every criterion met.");
  tl.to(O, { back: 1, duration: 0.95, ease: "power2.inOut" }, 75.3);
  check(0, 76.25); flare(0, 76.25, HEX.nox, 0.9);
  caption(76.25, "Business user", "var(--biz)", "<em>“My sentence is now true.”</em>", 96);
  tl.fromTo("#op0 .bulb-halo", { opacity: 0 }, { opacity: 1, duration: 0.4, immediateRender: false }, 76.25);
  tl.fromTo("#op0 .bulb-glass", { attr: { "fill-opacity": 0.22 } }, { attr: { "fill-opacity": 1 }, duration: 0.3, immediateRender: false }, 76.25);
  tl.fromTo(S.bloom, { strength: 1.6 }, { strength: 0.8, duration: 1.2, immediateRender: false }, 76.25);
  tl.to(CM, { a: 0, duration: 0.4 }, 76.4);
  tl.set("#j3", { className: "s" }, 76.6);
  tl.set("#j4", { className: "s done" }, 76.6);
  tl.fromTo("#j4", { scale: 1 }, { scale: 1.25, duration: 0.18, yoyo: true, repeat: 1, immediateRender: false }, 76.6);
  cue("success", 76.3);
  tl.to("#s6", { autoAlpha: 0, duration: 0.45 }, 77.55);
  tl.to(O, { on: 0, duration: 0.45 }, 77.55);
  tl.to(S.cam, { z: 900, y: 200, duration: 0.6, ease: "power3.in" }, 77.45);
  blur(77.45, 78.1, 6);
}
