// Scene 5: the Atlas. A 3D orbital map of Apex Holdings (teams are orbits, apps are
// planets, contracts are glowing arcs), a dive into billing-service where sources
// stream into its code wiki, then the ADK agent team that writes it.
import { tl, cue, blur, $, $$, hash, sceneIn, setOff, maskWords, blurChars, rise, pop, counter, colorTo, HEX } from "./engine.js";
import { S, D, scene, project, updaters, P, THREE } from "./world.js";
import { planetMesh, glowTube, Circle } from "./gl3d.js";
import { streams } from "./fx.js";

const TEAMS = [{ name: "BILLING", r: 300 }, { name: "CUSTOMER", r: 520 }, { name: "DATA", r: 740 }];
const APPS = [
  { id: "rcp", name: "receipts-service", team: 0, a: 180, hue: "#5FD29F" },
  { id: "bil", name: "billing-service", team: 0, a: 2, hue: "#F7B542" },
  { id: "cpo", name: "customer-portal", team: 1, a: 148, hue: "#86B9EE" },
  { id: "sup", name: "support-desk", team: 1, a: 216, hue: "#EC8FC2", up: true },
  { id: "rep", name: "reporting", team: 2, a: 300, hue: "#A897F0" },
];
const LINKS = [["rcp", "cpo"], ["cpo", "sup"], ["bil", "rep"]];

export const atlasState = { on: 0, rot: -0.22, draw: 0, links: 0, planets: 0 };

export function build() {
  const A = atlasState;
  const group = new THREE.Group();
  scene.add(group);
  group.visible = false;

  // core: Apex Holdings
  const core = planetMesh("#C9BEFF", 46, { emissive: 0.55 });
  group.add(core);
  // orbits
  const rings = TEAMS.map((T) => { const m = glowTube(new Circle(T.r), "#8FA0CC", { radius: 1.5, segs: 256, a: 0.35, dash: 60 }); group.add(m); return m; });
  // planets
  const local = {};
  const planets = APPS.map((ap) => {
    const r = TEAMS[ap.team].r, a = (ap.a * Math.PI) / 180;
    const p = new THREE.Vector3(r * Math.cos(a), 0, r * Math.sin(a));
    local[ap.id] = p;
    const m = planetMesh(ap.hue, ap.id === "bil" ? 42 : 36, { bands: ap.id === "bil" ? 6 : 0 });
    m.position.copy(p); group.add(m);
    return m;
  });
  // contract arcs, lifted above the plane
  const arcs = LINKS.map(([x, y]) => {
    const P0 = local[x], P1 = local[y];
    const mid = P0.clone().add(P1).multiplyScalar(0.5); mid.y += 150;
    const m = glowTube(new THREE.QuadraticBezierCurve3(P0, mid, P1), "#5FCBD8", { radius: 2.6, a: 0.55, pulse: 2, speed: 0.7, hex2: "#86B9EE" });
    group.add(m);
    return m;
  });

  // DOM labels
  const host = $("#s5labels");
  host.innerHTML =
    `<div class="label3d" id="orgl" style="font-size:34px">Apex Holdings</div>` +
    TEAMS.map((T, i) => `<div class="team3d" id="tm${i}">${T.name}</div>`).join("") +
    APPS.map((a) => `<div class="label3d" id="al_${a.id}">${a.name}</div>`).join("") +
    `<div class="cpill" id="cpA">invoice totals</div><div class="cpill" id="cpB">renderPdf()</div>`;
  const L = (id) => $("#" + id);
  const place = (el, x, y, a, ax = -0.5, ay = 0) => { el.style.opacity = a; el.style.transform = `translate(${x}px, ${y}px) translate(${ax * 100}%, ${ay * 100}%)`; };

  const lab = { org: 0, team: 0, app: 0, pill: 0 };
  const v = new THREE.Vector3();
  updaters.push((t) => {
    group.visible = A.on > 0.001;
    if (!group.visible) { host.style.display = "none"; return; }
    host.style.display = "block";
    group.rotation.y = A.rot;
    group.updateMatrixWorld(true);
    const lightPos = new THREE.Vector3(0, 30, 0);
    core.userData.mat.uniforms.t.value = t;
    core.scale.setScalar(Math.max(1e-4, A.planets));
    planets.forEach((m, i) => {
      m.userData.mat.uniforms.lightPos.value.copy(lightPos); m.userData.mat.uniforms.t.value = t;
      const s = Math.max(1e-4, Math.min(1, (A.planets * 6 - i * 0.6)));
      m.scale.setScalar(s);
      m.rotation.y = t * 0.25;
    });
    rings.forEach((m, i) => { m.material.uniforms.prog.value = Math.min(1, Math.max(0, A.draw * 1.6 - i * 0.3)); m.material.uniforms.t.value = t; m.material.uniforms.a.value = 0.35 * A.on; });
    arcs.forEach((m, i) => { m.material.uniforms.prog.value = Math.min(1, Math.max(0, A.links * 1.5 - i * 0.25)); m.material.uniforms.t.value = t; m.material.uniforms.a.value = 0.55 * A.on; });
    // glow around the core (overlay)
    const c = project(0, 0, 0);
    P.add(c.x, c.y, 360 * c.s, new THREE.Color("#9C8FFF"), 0.22 * A.planets * A.on, 1);
    place(L("orgl"), c.x, c.y + 58 * c.s + 8, lab.org * A.on);
    TEAMS.forEach((T, i) => { const p = project(0, -6, T.r); place(L("tm" + i), p.x, p.y + 14, lab.team * A.on); });
    APPS.forEach((ap, i) => {
      v.copy(local[ap.id]).applyMatrix4(group.matrixWorld);
      const p = project(v.x, v.y, v.z);
      const r = (ap.id === "bil" ? 42 : 36) * p.s;
      const a = Math.min(1, Math.max(0, lab.app * 5 - i * 0.7)) * A.on;
      if (ap.up) place(L("al_" + ap.id), p.x, p.y - r - 52, a); else place(L("al_" + ap.id), p.x, p.y + r + 10, a);
      ap._s = p;
    });
    const mas = APPS[4]._s, ome = APPS[0]._s;
    const mdg = APPS[1]._s;
    place(L("cpA"), (mdg.x + mas.x) / 2 + 250, (mdg.y + mas.y) / 2 - 20, lab.pill * A.on);
    place(L("cpB"), ome.x - 330, ome.y - 24, lab.pill * A.on);
  });

  /* ---------------- timeline: S5a map (30 - 33.6) ---------------- */
  sceneIn("#s5", 29.85, 0.3);
  tl.set(S.cam, { x: 0, y: 600, z: 1290, tx: 0, ty: 40, tz: 0, drift: 0.8 }, 29.9);
  tl.fromTo(S.cam, { y: 1350, z: 700 }, { y: 600, z: 1290, duration: 3.8, ease: "power3.out", immediateRender: false }, 29.9);
  colorTo(S.neb.c1, "#0A0C1E", 29.9, 0.3); colorTo(S.neb.c2, "#3A3A8A", 29.9, 0.3); colorTo(S.neb.c3, "#1C5A6A", 29.9, 0.3);
  tl.to(S.neb, { a: 0.8, duration: 1 }, 29.9);
  tl.set(S.bloom, { strength: 0.8, threshold: 0.55 }, 29.9);
  tl.set(A, { on: 1 }, 29.9);
  tl.fromTo(A, { rot: -0.28 }, { rot: 0.06, duration: 4.0, ease: "power1.inOut", immediateRender: false }, 29.9);
  tl.fromTo(A, { planets: 0 }, { planets: 1, duration: 1.2, ease: "power2.out", immediateRender: false }, 30.0);
  tl.fromTo(A, { draw: 0 }, { draw: 1, duration: 1.3, ease: "power2.inOut", immediateRender: false }, 30.05);
  tl.fromTo(A, { links: 0 }, { links: 1, duration: 1.2, ease: "power2.inOut", immediateRender: false }, 31.6);
  tl.fromTo(lab, { org: 0 }, { org: 1, duration: 0.5 }, 30.4);
  tl.fromTo(lab, { team: 0 }, { team: 1, duration: 0.6 }, 30.8);
  tl.fromTo(lab, { app: 0 }, { app: 1, duration: 1.2, ease: "none" }, 30.7);
  tl.fromTo(lab, { pill: 0 }, { pill: 1, duration: 0.5 }, 32.4);
  blurChars($("#s5k"), 30.05, { stagger: 0.015 });
  maskWords("#s5t", 30.15, { stagger: 0.05 });
  [30.4, 30.55, 30.7, 30.85, 31.0].forEach((t) => cue("tick", t));
  cue("shimmer", 31.6, { d: 1.4 });

  // dive into billing-service
  const masLocal = local.bil;
  const rotAt = 0.06; // A.rot at the dive
  const mx = masLocal.x * Math.cos(rotAt) + masLocal.z * Math.sin(rotAt), mz = -masLocal.x * Math.sin(rotAt) + masLocal.z * Math.cos(rotAt);
  tl.to(S.cam, { x: mx * 0.95, y: 60, z: mz + 140, tx: mx, ty: 0, tz: mz, duration: 0.95, ease: "power2.in" }, 33.4);
  tl.to(["#s5k", "#s5t"], { autoAlpha: 0, y: -30, duration: 0.3 }, 33.5);
  tl.to(lab, { org: 0, team: 0, app: 0, pill: 0, duration: 0.3 }, 33.5);
  tl.fromTo("#whiteout", { opacity: 0 }, { opacity: 0.8, duration: 0.25, ease: "power2.in", immediateRender: false }, 34.1);
  tl.to("#whiteout", { opacity: 0, duration: 0.45, ease: "power2.out" }, 34.35);
  tl.set(A, { on: 0 }, 34.35);
  blur(33.5, 34.45, 8);
  cue("whoosh", 33.5, { d: 0.9 });

  /* ---------------- S5b: sources stream into the code wiki (34.35 - 37.7) ---------------- */
  const hero = planetMesh("#F7B542", 112, { bands: 7 });
  hero.position.set(0, -110, 0);
  scene.add(hero);
  const H = { on: 0, s: 0 };
  updaters.push((t) => {
    hero.visible = H.on > 0.001;
    if (!hero.visible) return;
    hero.scale.setScalar(Math.max(1e-4, H.s));
    hero.rotation.y = t * 0.3; hero.rotation.z = 0.25;
    hero.userData.mat.uniforms.lightPos.value.set(-900, 700, 900);
    hero.userData.mat.uniforms.t.value = t;
    const p = project(0, -110, 0);
    P.add(p.x, p.y, 640 * H.s * p.s, new THREE.Color("#F7B542"), 0.22 * H.on, 1);
    const lb = $("#s5corel"); lb.style.transform = `translate(${p.x}px, ${p.y + 140 * p.s}px) translate(-50%, 0)`;
  });
  sceneIn("#s5b", 34.3, 0.3);
  tl.set(S.cam, { x: 0, y: 0, z: D, tx: 0, ty: 0, tz: 0, drift: 1 }, 34.35);
  tl.fromTo(S.cam, { z: D - 260 }, { z: D + 60, duration: 3.4, ease: "power2.out", immediateRender: false }, 34.35);
  colorTo(S.neb.c1, "#140C06", 34.35, 0.2); colorTo(S.neb.c2, "#7A5420", 34.35, 0.2); colorTo(S.neb.c3, "#2A3A7A", 34.35, 0.2);
  tl.set(H, { on: 1 }, 34.35);
  tl.fromTo(H, { s: 0.6 }, { s: 1, duration: 0.9, ease: "back.out(1.6)", immediateRender: false }, 34.35);
  blurChars($("#s5bk"), 34.45, { stagger: 0.015 });
  maskWords("#s5bt", 34.5, { stagger: 0.05 });
  gsap.set("#s5corel", { autoAlpha: 0 });
  rise("#s5corel", 34.7, 0.5, 0);
  const SRC = [["github", "GitHub", 360, 420], ["confluence", "Confluence", 600, 350], ["jira", "Jira", 840, 318], ["notion", "Notion", 1080, 318], ["slack", "Slack", 1320, 350], [null, "Uploads", 1560, 420]];
  $("#s5srcs").innerHTML = SRC.map(([k, n, x, y], i) => `<div class="src" id="src${i}" style="left:${x - 75}px;top:${y - 63}px"><div class="stile">${k ? `<img src="vendor/logos/${k}.svg">` : `<svg width="60" height="66" viewBox="0 0 30 33"><path d="M4 1 H19 L27 9 V31 H4 Z" fill="none" stroke="#DDE2F0" stroke-width="2.2" stroke-linejoin="round"/><path d="M19 1 V9 H27" fill="none" stroke="#DDE2F0" stroke-width="2.2"/><path d="M10 18 H21 M10 23 H18" stroke="#F7B542" stroke-width="2.2" stroke-linecap="round"/></svg>`}</div><div class="n">${n}</div></div>`).join("");
  SRC.forEach((s_, i) => { pop("#src" + i, 34.6 + i * 0.09, { scale: 0.4, y: -40 }, 0.7, "back.out(2)"); });
  cue("pop", 34.6); cue("pop", 34.85);
  const ST = { a: 0 };
  const lines = SRC.map(([k, n, x, y], i) => ({ a: { x, y: y + 115 }, b: { x: 960, y: 650 }, c: { x: (x + 960) / 2, y: (y + 650) / 2 + 40 }, color: i === 1 ? "#FF6A7A" : "#FFE2A0", blocked: i === 1 ? (t) => t > 35.4 : null }));
  streams(lines, ST, { n: 8, speed: 0.8 });
  tl.to(ST, { a: 1, duration: 0.4 }, 34.95);
  tl.to(ST, { a: 0, duration: 0.4 }, 37.25);
  cue("shimmer", 35.0, { d: 2.0 });
  // NoX Shield withholds the planted runbook
  tl.to("#src1 .stile", { borderColor: "rgba(255,93,108,.95)", boxShadow: "0 0 50px rgba(255,93,108,.6)", duration: 0.3 }, 35.4);
  tl.fromTo("#s5shield", { autoAlpha: 0, x: -60 }, { autoAlpha: 1, x: 0, duration: 0.5 }, 35.45);
  cue("alert", 35.45);
  // the trajectory
  const STG = ["In the Void", "Scanning Nebula", "Compiling Stars", "Awaiting Launch", "In Orbit"];
  $("#s5traj").insertAdjacentHTML("beforeend", STG.map((s_, i) => `<div class="st" id="st${i}"><i></i><span>${s_}</span></div>`).join(""));
  gsap.set("#s5traj", { autoAlpha: 0 });
  rise("#s5traj", 34.8, 0.6, 20);
  tl.fromTo("#trajbar", { scaleX: 0 }, { scaleX: 1, duration: 2.2, ease: "none" }, 35.0);
  STG.forEach((s_, i) => {
    const t = 35.0 + i * 0.55, c = i === 4 ? HEX.verify : HEX.nox;
    tl.to(`#st${i}`, { color: c, duration: 0.25 }, t);
    tl.to(`#st${i} i`, { borderColor: c, backgroundColor: c, boxShadow: `0 0 26px ${c}`, scale: 1.3, duration: 0.25 }, t);
    if (i < 4) tl.to(`#st${i} i`, { scale: 1, duration: 0.3 }, t + 0.3);
    cue("tick", t);
  });
  tl.fromTo("#s5sync", { autoAlpha: 0, x: 60 }, { autoAlpha: 1, x: 0, duration: 0.5 }, 37.2);
  cue("ding", 37.2, { note: 2 });
  // whip to the agent team
  tl.to("#s5b", { autoAlpha: 0, x: -260, filter: "blur(6px)", duration: 0.45, ease: "power2.in" }, 37.6);
  tl.to(H, { on: 0, duration: 0.35 }, 37.65);
  tl.to(S.cam, { tx: 900, x: 500, duration: 0.6, ease: "whip" }, 37.6);
  tl.set(S.cam, { tx: 0, x: 0 }, 38.2);
  blur(37.6, 38.25, 8);
  cue("whoosh", 37.6, { d: 0.6 });

  /* ---------------- S5c: the agent team (38 - 42) ---------------- */
  const AG = [["Cartographer", "DEEP", "maps the codebase", "#A897F0", 110], ["Page writers ×N", "PARALLEL", "one shared cache", "#86B9EE", 560], ["Reviewer ⇄ gate", "LOOP", "fixes what fails", "#5FCBD8", 1010], ["OKF bundle → PR", "REVIEWED", "people merge it", "#5FD29F", 1460]];
  $("#s5agents").innerHTML = AG.map(([n, tier, sub, c, x], i) => `<div class="agent glass" id="ag${i}" style="left:${x}px;border-color:${c}66"><div class="nm">${n}</div><div class="tier" style="color:${c}">${tier}</div><div class="sb">${sub}</div></div>`).join("");
  let cs = "";
  [0, 1, 2].forEach((i) => { const x1 = AG[i][4] + 400, x2 = AG[i + 1][4]; cs += `<line x1="${x1 + 4}" y1="440" x2="${x2 - 6}" y2="440" stroke="rgba(143,160,204,.4)" stroke-width="3"/><path d="M${x2 - 16} 431 L${x2 - 4} 440 L${x2 - 16} 449" fill="none" stroke="rgba(143,160,204,.7)" stroke-width="3"/>`; });
  for (let j = 0; j < 5; j++) { const x = 600 + j * 66; cs += `<g class="pg" opacity="0"><rect x="${x}" y="262" width="48" height="60" rx="6" fill="rgba(134,185,238,.18)" stroke="#86B9EE" stroke-width="2"/><path d="M${x + 9} 279 H${x + 39} M${x + 9} 291 H${x + 33} M${x + 9} 303 H${x + 37}" stroke="#86B9EE" stroke-width="2.4" stroke-linecap="round"/></g>`; }
  cs += `<path id="loop" d="M1110 326 C1110 270 1310 270 1310 326" fill="none" stroke="#5FCBD8" stroke-width="3" stroke-dasharray="8 8" opacity="0"/><path d="M1300 314 L1310 328 L1320 314" fill="none" stroke="#5FCBD8" stroke-width="3" class="loopa" opacity="0"/>`;
  $("#s5csvg").innerHTML = cs;
  $("#okf").innerHTML = `<span class="k3">---</span>\n<span class="k1">type:</span> <span class="k2">Interface Reference</span>\n<span class="k1">title:</span> <span class="k2">Invoices API</span>\n<span class="k1">sources:</span> <span class="k2">[src/invoices.py]</span>\n<span class="k3">---</span>\n<span class="k5">## GET /invoices/{id}</span>\n<span class="k2">Totals read by </span><span class="k4">[[kb:reporting/invoice-totals]]</span>`;
  sceneIn("#s5c", 37.95, 0.3);
  colorTo(S.neb.c1, "#0A0A1C", 38.0, 0.6); colorTo(S.neb.c2, "#46327A", 38.0, 0.6); colorTo(S.neb.c3, "#1A5A5A", 38.0, 0.6);
  tl.fromTo(S.cam, { z: D + 200 }, { z: D - 60, duration: 4, ease: "power1.inOut", immediateRender: false }, 38.0);
  blurChars($("#s5ck"), 38.0, { stagger: 0.015 });
  maskWords("#s5ct", 38.1, { stagger: 0.05 });
  // pulses travel the pipeline (overlay)
  const pulse = { a: 0 };
  updaters.push((t) => {
    if (pulse.a < 0.01) return;
    [0, 1, 2].forEach((i) => {
      const x1 = AG[i][4] + 404, x2 = AG[i + 1][4] - 6;
      const u = ((t - 38.5) * 1.1 - i * 0.33) % 1;
      if (u < 0) return;
      P.add(x1 + (x2 - x1) * u, 440, 16, new THREE.Color(AG[i + 1][3]), pulse.a, 0);
      P.add(x1 + (x2 - x1) * u, 440, 70, new THREE.Color(AG[i + 1][3]), pulse.a * 0.25, 1);
    });
  });
  AG.forEach((a, i) => {
    const t = 38.25 + i * 0.4;
    tl.fromTo("#ag" + i, { autoAlpha: 0, y: 60, rotationY: -30, transformPerspective: 1400 }, { autoAlpha: 1, y: 0, rotationY: 0, duration: 0.8, ease: "expo.out" }, t);
    tl.to("#ag" + i, { boxShadow: `0 0 0 2px ${a[3]}, 0 0 70px ${a[3]}77`, duration: 0.3, yoyo: true, repeat: 1 }, t + 0.3);
    cue("tick", t + 0.1);
  });
  tl.to(pulse, { a: 1, duration: 0.3 }, 38.6);
  tl.to(pulse, { a: 0, duration: 0.3 }, 41.3);
  tl.fromTo(".pg", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.07, ease: "back.out(2)" }, 38.8);
  tl.fromTo("#loop", { opacity: 0, drawSVG: "0%" }, { opacity: 1, drawSVG: "100%", duration: 0.6 }, 39.2);
  tl.to(".loopa", { opacity: 1, duration: 0.2 }, 39.75);
  tl.fromTo("#okf", { autoAlpha: 0, y: 70, rotationX: 25, transformPerspective: 1400 }, { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.8, ease: "expo.out" }, 39.4);
  tl.fromTo("#stat", { autoAlpha: 0, x: 70 }, { autoAlpha: 1, x: 0, duration: 0.7 }, 39.6);
  counter("#statn", 1, 8.7, 39.7, 1.4, 1);
  cue("count", 39.7, { d: 1.4 });
  const statGlow = { a: 0 };
  updaters.push(() => { if (statGlow.a > 0.01) P.add(1290, 690, 520, new THREE.Color("#F7B542"), statGlow.a * 0.22, 1); });
  tl.to(statGlow, { a: 1, duration: 0.6 }, 40.9);
  tl.to(statGlow, { a: 0, duration: 0.5 }, 41.5);
  tl.to("#s5c", { autoAlpha: 0, scale: 0.96, filter: "blur(6px)", duration: 0.45, ease: "power2.in" }, 41.55);
  setOff("#s5", 42.0);
}
