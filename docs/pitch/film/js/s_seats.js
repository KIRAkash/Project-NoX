// Scene 7: the four seats. Each seat writes its own file with NoX as co-author, and a
// person approves it. The camera zooms onto the typing; whip pans join the seats.
import { tl, hooks, cue, blur, $, $$, sceneIn, setOff, rise, typeText, cam2d, cam2dSet, blink, colorTo, HEX } from "./engine.js";
import { S, D, updaters, P, THREE } from "./world.js";

export function build() {
  const SEATS = [["Business", "var(--biz)"], ["Product", "var(--po)"], ["Engineering", "var(--eng)"], ["Developer", "var(--dev)"]];
  $("#hud").innerHTML = SEATS.map(([n], i) => `${i ? '<span class="ln"></span>' : ""}<span class="step" id="hs${i}"><i></i>${n}</span>`).join("");
  const LOCK = `<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 10.5 V7.5 a3.5 3.5 0 0 1 7 0 V10.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  const TABS = ["01 business", "02 product", "03 engineering", "04 developer"];
  $$(".tabs").forEach((el) => { const on = +el.dataset.on; el.innerHTML = TABS.map((n, i) => `<div class="tab ${i === on ? "on" : ""}">${i === on ? "" : LOCK}${n}</div>`).join(""); });

  const ST = [46.0, 52.0, 58.0, 64.0];
  tl.fromTo("#hud", { autoAlpha: 0, y: -20 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 46.1);
  ST.forEach((t, i) => {
    tl.to("#hs" + i, { color: SEATS[i][1], duration: 0.3 }, t);
    tl.to("#hs" + i + " i", { boxShadow: "0 0 18px currentColor", scale: 1.3, duration: 0.3 }, t);
    tl.to("#hs" + i, { color: HEX.verify, duration: 0.3 }, t + 5.6);
    tl.to("#hs" + i + " i", { scale: 1, boxShadow: "0 0 0px rgba(0,0,0,0)", duration: 0.3 }, t + 5.6);
  });
  tl.to("#hud", { autoAlpha: 0, duration: 0.4 }, 69.6);

  // background: camera re-framed for the UI scenes, gentle push per seat
  tl.set(S.cam, { x: 0, y: 0, z: D + 200, tx: 0, ty: 0, tz: 0, drift: 1 }, 45.95);
  ST.forEach((t) => tl.fromTo(S.cam, { z: D + 260 }, { z: D - 40, duration: 5.6, ease: "power1.inOut", immediateRender: false }, t));
  tl.set(S.bloom, { strength: 0.7, threshold: 0.6 }, 45.95);

  // sparkles where NoX is typing
  const spark = { a: 1 };
  const carets = $$(".cur:not(.me)");
  const gold = new THREE.Color("#FFD27A");
  updaters.push((t) => {
    if (t < 46 || t > 70) return;
    for (const c of carets) {
      if (!(parseFloat(c.style.opacity) > 0.5)) continue;
      const r = c.getBoundingClientRect();
      if (!r.width) continue;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      for (let i = 0; i < 12; i++) {
        const life = 0.55, k = t / life + i / 12, ph = k % 1, seed = Math.floor(k) * 13 + i;
        const a = ((Math.sin(seed * 12.9898) * 43758.5453) % 1) * Math.PI * 2;
        const rr = 18 + ph * 60;
        P.add(x + Math.cos(a) * rr, y + Math.sin(a) * rr - ph * 20, 3 + (1 - ph) * 7, gold, (1 - ph) * 0.9 * spark.a, 0);
      }
      P.add(x, y, 90, gold, 0.35 * spark.a, 1);
    }
  });

  const ptr = $("#ptr");
  const hud = (t, on) => tl.to("#hud", { autoAlpha: on ? 1 : 0, duration: 0.3 }, t);
  const seatEnter = (id, t, c1, c2, c3) => {
    sceneIn(id, t, 0.3);
    colorTo(S.neb.c1, c1, t, 0.6); colorTo(S.neb.c2, c2, t, 0.6); colorTo(S.neb.c3, c3, t, 0.6);
    tl.fromTo(`${id} .seatL .pl`, { scale: 0.3, autoAlpha: 0, x: -60, rotation: -25 }, { scale: 1, autoAlpha: 1, x: 0, rotation: 0, duration: 0.9, ease: "back.out(1.6)" }, t + 0.05);
    tl.fromTo(`${id} .seatL .nm, ${id} .seatL .home, ${id} .seatL .file`, { autoAlpha: 0, x: -50, filter: "blur(6px)" }, { autoAlpha: 1, x: 0, filter: "blur(0px)", duration: 0.7, stagger: 0.08 }, t + 0.15);
    tl.fromTo(`${id} .win, ${id} .ask`, { autoAlpha: 0, x: 260, rotationY: -18, transformPerspective: 1800 }, { autoAlpha: 1, x: 0, rotationY: 0, duration: 0.9, ease: "expo.out", stagger: 0.1 }, t + 0.08);
    cue("whoosh", t, { d: 0.5, soft: true });
  };
  const seatExit = (id, t) => {
    tl.to(`${id} .cam`, { x: -420, autoAlpha: 0, duration: 0.45, ease: "power3.in" }, t);
    tl.set(id, { autoAlpha: 0 }, t + 0.46);
    tl.to(S.cam, { tx: 1400, x: 700, duration: 0.55, ease: "whip" }, t);
    tl.set(S.cam, { tx: 0, x: 0 }, t + 0.56);
    blur(t + 0.05, t + 0.62, 8);
    cue("whoosh", t, { d: 0.6 });
  };
  const callout = (id, t) => tl.fromTo(`${id} .seatL .call`, { autoAlpha: 0, y: 24, filter: "blur(6px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.7 }, t);
  const approveAt = (t, bx, by, label, color, btn) => {
    tl.set(ptr, { "--pc": color }, t - 0.6);
    tl.set("#ptrlab", { textContent: label, backgroundColor: color }, t - 0.6);
    tl.fromTo(ptr, { autoAlpha: 0, x: bx + 260, y: by + 190 }, { autoAlpha: 1, x: bx, y: by, duration: 0.6, ease: "power3.out", immediateRender: false }, t - 0.6);
    tl.to(ptr, { scale: 0.85, duration: 0.08, yoyo: true, repeat: 1, transformOrigin: "0 0" }, t);
    tl.fromTo("#ripple", { autoAlpha: 1, x: bx - 30, y: by - 30, scale: 0.3 }, { autoAlpha: 0, scale: 3.4, duration: 0.6, ease: "power2.out", immediateRender: false }, t);
    tl.to(btn, { backgroundColor: HEX.verify, boxShadow: "0 0 44px rgba(95,210,159,.75)", duration: 0.2 }, t);
    tl.set(btn.querySelector(".ok"), { display: "inline" }, t);
    tl.set(btn.querySelector(".lbl"), { textContent: "Approved" }, t);
    tl.fromTo(btn, { scale: 1 }, { scale: 1.1, duration: 0.12, yoyo: true, repeat: 1, immediateRender: false }, t);
    tl.to(ptr, { autoAlpha: 0, duration: 0.3 }, t + 0.5);
    // a little burst of green light at the click
    const st = { a: 0 };
    const green = new THREE.Color(HEX.verify);
    updaters.push((tt) => {
      if (st.a < 0.01) return;
      const k = 1 - st.a;
      for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; const r = 30 + k * 140; P.add(bx + Math.cos(a) * r, by + Math.sin(a) * r * 0.8, 6 * st.a + 2, green, st.a, 0); }
      P.add(bx, by, 260, green, st.a * 0.3, 1);
    });
    tl.fromTo(st, { a: 1 }, { a: 0, duration: 0.7, ease: "power2.out", immediateRender: false }, t);
    cue("click", t); cue("ding", t + 0.05, { note: 3 });
  };
  const approve = (id, t, label, color) => {
    const win = $(`${id} .win`);
    const bx = 700 + 1140 - 30 - 110, by = parseFloat(getComputedStyle(win).top) + parseFloat(win.style.height || 850) - 52;
    approveAt(t, bx, by, label, color, $(`${id} .approve`));
  };
  gsap.set("#ripple", { autoAlpha: 0 });

  /* --- Business user (46 - 52) --- */
  seatEnter("#sb", 45.95, "#140E04", "#8A6A2A", "#5A3A1A");
  const sbPl = $("#sb .seatL .pl");
  cam2dSet("#sbcam", 45.95, 1, 0, 0);
  cam2d("#sbcam", 46.5, 0.9, 1.5, 700, 262, 105, 0); hud(46.45, 0);
  typeText("#sb1", "Customers download any past invoice as a PDF, without contacting support.", 46.9, 1.6, { caret: "#sb1c" });
  typeText("#sb2", "It works for one-time and subscription invoices.", 48.55, 0.95, { caret: "#sb2c" });
  typeText("#sb3", "Support stops answering invoice emails.", 49.55, 0.75, { caret: "#sb3c" });
  cam2d("#sbcam", 49.75, 0.9, 1, 0, 0, 0, 0); hud(50.3, 1);
  tl.fromTo("#sbchips .chip", { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.4, stagger: 0.12, ease: "back.out(2)" }, 50.3);
  cue("pop", 50.3);
  callout("#sb", 49.8);
  tl.to(sbPl.querySelector(".bulb-glass"), { attr: { "fill-opacity": 1 }, duration: 0.3 }, 46.9);
  tl.to(sbPl.querySelector(".bulb-halo"), { opacity: 1, duration: 0.3 }, 46.9);
  blink(sbPl, 48.2);
  approve("#sb", 51.15, "Business user", HEX.biz);
  tl.set("#sbstat", { textContent: "✓ Approved by the business user", color: HEX.verify }, 51.15);
  seatExit("#sb", 51.6);

  /* --- Product owner (52 - 58) --- */
  seatEnter("#sp", 51.95, "#0E0A1E", "#5A4A9A", "#6A5A2A");
  const spPl = $("#sp .seatL .pl");
  cam2dSet("#spcam", 51.95, 1, 0, 0);
  cam2d("#spcam", 52.45, 0.8, 1.5, 700, 262, 105, 0); hud(52.4, 0);
  typeText("#sp1", "Any invoice downloads as a PDF from billing history.", 52.75, 1.05, { caret: "#sp1c" });
  typeText("#sp2", "The tax breakdown is included, the day it’s issued.", 53.85, 0.85, { caret: "#sp2c" });
  cam2d("#spcam", 54.5, 1.4, 1.56, 700, 300, 80, 0);
  typeText("#sp3", "Prorated invoices need a “partial period” line.", 54.75, 1.3, { caret: "#sp3c", human: true });
  tl.to(spPl.querySelector(".pencil"), { rotation: -18, x: 4, y: 3, duration: 0.3, yoyo: true, repeat: 3 }, 54.75);
  tl.to(spPl.querySelector(".check"), { attr: { "stroke-dashoffset": 0 }, duration: 0.3 }, 56.1);
  tl.to(spPl.querySelector(".brow"), { y: -3, rotation: -6, duration: 0.3, transformOrigin: "50% 50%" }, 54.8);
  cam2d("#spcam", 56.1, 0.8, 1, 0, 0, 0, 0); hud(56.6, 1);
  typeText("#sp4", "Invoice tickets to support, week over week.", 56.15, 0.7, { caret: "#sp4c" });
  tl.fromTo("#spcite", { autoAlpha: 0, x: -20 }, { autoAlpha: 1, x: 0, duration: 0.4 }, 56.8);
  tl.fromTo("#spjira", { autoAlpha: 0, y: 40, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(2)" }, 56.55);
  cue("pop", 56.55);
  callout("#sp", 56.2);
  approve("#sp", 57.2, "Product owner", HEX.po);
  seatExit("#sp", 57.6);

  /* --- Engineering lead (58 - 64) --- */
  seatEnter("#se", 57.95, "#04121A", "#1E6A7A", "#2A3A7A");
  const sePl = $("#se .seatL .pl");
  const M = { bil: [570, 215, "#F7B542", "billing-service", 46], cpo: [200, 95, "#86B9EE", "customer-portal", 30], rep: [230, 330, "#A897F0", "reporting", 30], rcp: [930, 100, "#5FD29F", "receipts-service", 30], sup: [930, 330, "#EC8FC2", "support-desk", 30] };
  let ms = `<defs><filter id="gl"><feGaussianBlur stdDeviation="6"/></filter><radialGradient id="mg"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".25" stop-color="#fff" stop-opacity=".0"/></radialGradient></defs>`;
  [["rep", "bil", "#A897F0"], ["rcp", "bil", "#5FD29F"], ["cpo", "bil", 0], ["sup", "rep", 0]].forEach(([a, b, hot], i) => {
    ms += `<line id="ml${i}" x1="${M[a][0]}" y1="${M[a][1]}" x2="${M[b][0]}" y2="${M[b][1]}" stroke="${hot || "rgba(143,160,204,.3)"}" stroke-width="${hot ? 5 : 3}" stroke-dasharray="10 10"/>`;
  });
  ms += `<circle id="mring" cx="570" cy="215" r="80" fill="none" stroke="#5FCBD8" stroke-width="3" opacity=".7"/>`;
  Object.entries(M).forEach(([k, [x, y, c, n, r]]) => {
    ms += `<g id="mn_${k}"><circle cx="${x}" cy="${y}" r="${r + 12}" fill="${c}" opacity=".3" filter="url(#gl)"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.35}" r="${r}" fill="url(#mg)"/><text x="${x}" y="${y + r + 38}" text-anchor="middle" fill="#ECEFF8" font-family="Manrope" font-weight="700" font-size="${k === "bil" ? 32 : 28}">${n}</text></g>`;
  });
  ms += `<g class="mpill" opacity="0"><rect x="278" y="206" width="216" height="44" rx="12" fill="#05080F" stroke="#A897F0" stroke-width="2"/><text x="386" y="236" text-anchor="middle" fill="#A897F0" font-family="JB" font-size="24" font-weight="600">invoice totals</text></g>`;
  ms += `<g class="mpill" opacity="0"><rect x="632" y="94" width="184" height="44" rx="12" fill="#05080F" stroke="#5FD29F" stroke-width="2"/><text x="724" y="124" text-anchor="middle" fill="#5FD29F" font-family="JB" font-size="24" font-weight="600">renderPdf()</text></g>`;
  $("#semap").innerHTML = ms;
  cam2dSet("#secam", 57.95, 1, 0, 0);
  tl.fromTo("#semap g[id^=mn_]", { opacity: 0, scale: 0.4, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.5, stagger: 0.08, ease: "back.out(2)" }, 58.4);
  tl.fromTo("#semap line", { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.6, stagger: 0.08 }, 58.5);
  tl.fromTo("#mring", { attr: { r: 50 }, opacity: 0 }, { attr: { r: 120 }, opacity: 0.8, duration: 0.8, ease: "power2.out" }, 58.6);
  hooks.push((t) => { if (t < 59.2 || t > 64.2) return; for (let i = 0; i < 4; i++) $("#ml" + i).setAttribute("stroke-dashoffset", -t * 50); const r = 95 + 25 * ((t * 0.8) % 1); $("#mring").setAttribute("r", r); $("#mring").setAttribute("opacity", 0.8 * (1 - ((t * 0.8) % 1))); });
  cam2d("#secam", 58.95, 0.8, 1.5, 700, 380, 105, 0); hud(58.9, 0);
  typeText("#se1", "What already exists, and who reads invoices?", 59.2, 1.1, { caret: "#se1c", human: true });
  tl.fromTo("#sesteps .chip", { autoAlpha: 0, x: -20 }, { autoAlpha: 1, x: 0, duration: 0.3, stagger: 0.2 }, 60.4);
  cue("tick", 60.4); cue("tick", 60.6); cue("tick", 60.8);
  typeText("#se2", "Reuse the receipts PDF renderer. Reporting reads invoice totals: keep that contract.", 61.0, 1.5, { caret: "#se2c" });
  cam2d("#secam", 62.0, 0.9, 1, 0, 0, 0, 0); hud(62.5, 1);
  tl.to("#semap .mpill", { opacity: 1, duration: 0.3, stagger: 0.15 }, 61.9);
  tl.fromTo("#mn_rcp", { scale: 1 }, { scale: 1.25, duration: 0.2, yoyo: true, repeat: 1, svgOrigin: "930 100", immediateRender: false }, 61.6);
  tl.fromTo("#mn_rep", { scale: 1 }, { scale: 1.25, duration: 0.2, yoyo: true, repeat: 1, svgOrigin: "230 330", immediateRender: false }, 62.2);
  tl.to(sePl.querySelector(".mic"), { rotation: -7, duration: 0.4, ease: "back.out(2)", svgOrigin: "6 62" }, 59.1);
  tl.to(sePl.querySelectorAll(".signal"), { opacity: 1, duration: 0.25, stagger: 0.12 }, 59.3);
  tl.to(sePl.querySelectorAll(".signal"), { opacity: 0, duration: 0.25, stagger: 0.12 }, 60.0);
  tl.to(sePl.querySelector(".mic-led"), { opacity: 0.15, duration: 0.12, repeat: 5, yoyo: true, ease: "none" }, 59.3);
  callout("#se", 62.1);
  tl.fromTo("#sejira", { autoAlpha: 0, y: 40, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(2)" }, 63.35);
  cue("pop", 63.35);
  approveAt(63.2, 1735, 175, "Engineering lead", HEX.eng, $("#seapp"));
  seatExit("#se", 63.6);

  /* --- Developer (64 - 70) --- */
  seatEnter("#sd", 63.95, "#040A1A", "#2A4A8A", "#1E5A6A");
  const sdPl = $("#sd .seatL .pl");
  const LINES = [
    ["big", `<span class="pr">~/billing-service ›</span> <span id="sdcmd"></span><span class="cur me" id="sdcc" style="--seat:var(--dev)"><b>Developer</b></span>`],
    ["", `<span class="gd">●</span> nox context NOX-1`],
    ["", `  <span class="ok">✓</span> 4 approved spec files`],
    ["", `  <span class="ok">✓</span> knowledge-base pages · contracts`],
    ["", `<span class="gd">●</span> edit  <span class="dm">src/</span>pdf.py  <span class="dm">src/</span>routes.py  <span class="dm">ui/</span>Download.tsx`],
    ["", `<span class="gd">●</span> test  <span class="ok">all passing ✓</span>`],
    ["", `<span class="ok">✓ PR opened</span>  NOX-1: self-serve invoice PDFs`],
    ["", `<span class="gd">⛨ NoX guard</span>  receipts renderer reused, rules ok`],
    ["", `<span class="pr">›</span> nox complete NOX-1  <span class="dm">→ back up the chain</span>`],
  ];
  $("#sdterm").innerHTML = LINES.map(([c, h], i) => `<div class="row ${c}" id="tr${i}">${h}</div>`).join("");
  cam2dSet("#sdcam", 63.95, 1, 0, 0);
  tl.set("#tr0", { autoAlpha: 1 }, 64.3);
  cam2d("#sdcam", 64.35, 0.7, 1.9, 740, 268, 160, 400); hud(64.3, 0);
  typeText("#sdcmd", "/nox NOX-1", 64.6, 0.65, { caret: "#sdcc", human: true });
  cam2d("#sdcam", 65.4, 1.0, 1.5, 700, 132, 105, 30);
  [1, 2, 3, 4, 5, 6, 7].forEach((i) => {
    const t = 65.35 + (i - 1) * 0.38;
    tl.fromTo("#tr" + i, { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.25 }, t);
    cue("tick", t);
  });
  cue("typeA", 65.35, { d: 2.6, n: 120 });
  tl.to(sdPl.querySelector(".code"), { opacity: 1, y: -3, duration: 0.35 }, 64.6);
  blink(sdPl, 66.2);
  cam2d("#sdcam", 67.9, 0.9, 1, 0, 0, 0, 0); hud(68.4, 1);
  tl.fromTo("#tr8", { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.25 }, 68.15);
  cue("typeH", 68.15, { d: 0.4, n: 18 });
  gsap.set("#sdagents", { autoAlpha: 0 });
  tl.fromTo("#sdagents", { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.6, immediateRender: false }, 67.4);
  tl.fromTo("#sdagents .a", { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.4, stagger: 0.1, ease: "back.out(2)" }, 67.5);
  callout("#sd", 67.0);
  cue("success", 66.9, { soft: true });
  // the mission shoots back out to the orbit
  tl.to("#sd .cam", { autoAlpha: 0, scale: 0.94, filter: "blur(8px)", duration: 0.45, ease: "power2.in" }, 69.45);
  tl.to(S.cam, { z: D - 700, duration: 0.55, ease: "power3.in" }, 69.4);
  setOff("#sd", 69.92);
  blur(69.4, 70.05, 6);
  cue("whoosh", 69.5, { d: 0.6 });
}
