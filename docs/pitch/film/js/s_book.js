// Scene 7: the spec book. One mission is one book; every role writes its own page, with
// NoX writing beside the person, and signs it. Each page builds on the one before. Then
// the book closes and, with the Atlas, becomes the coding agent's context.
import { tl, cue, $, $$, sceneIn, setOff, rise, typeText, maskWords, blur, HEX } from "./engine.js";
import { S, D, updaters, P, THREE } from "./world.js";
import { planetSVG, appPlanetSVG } from "./planets.js";

const PAPER = { business: "#9A7414", product: "#5B47C2", engineering: "#137E8C", developer: "#2F67A8" };
const NAME = { business: "Business user", product: "Product owner", engineering: "Engineering lead", developer: "Developer" };
const LOCK = `<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8.5 10.5 V7.5 a3.5 3.5 0 0 1 7 0 V10.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;
const ARROW = (c) => `<svg class="arrow" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 16.8 L20 16.8 Z" fill="${c}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

/* page sources: {{n:id|text}} is typed by NoX, {{u:id|text}} by the person */
const PAGES = [
  { role: "business", file: "01-business.md", t0: 46.3, sign: 50.55, turn: 51.0, nox: [47.0, 2.3], me: [47.45, 2.45], body: `
<div class="meta">status: draft · mission: NOX-1 · version 2</div>
<div class="h1">Self-serve invoice PDFs</div>
<div class="h2">The request</div>
<div class="b">“Customers keep emailing support for invoices. Can they just download them?”</div>
<div class="by"><div class="h2">Problem</div>
<div class="b">Support answered 1,340 invoice emails last quarter. {{u:Each takes about 6 minutes, and the customer waits a day.}}</div></div>
<div class="nx"><div class="h2">What changes for customers</div>
<div class="b">{{n:Customers download any past invoice as a PDF from their billing history, without contacting support.}} <span class="kb">[[kb:billing-service/invoices]]</span></div></div>
<div class="h2">Who is affected</div>
<div class="b li">Customers on one-time and subscription plans</div>
<div class="b li">Support agents, who stop sending invoices by hand</div>
<div class="b li">Finance, who rely on the same invoice numbers</div>
<div class="h2">Done when</div>
<div class="b li">Support stops answering invoice emails</div>
<div class="b li">Invoice tickets fall by 80% within a quarter</div>
<div class="h2">Out of scope</div>
<div class="b li">Editing or re-issuing invoices</div>` },
  { role: "product", file: "02-product.md", t0: 51.45, sign: 55.6, turn: 56.0, nox: [52.25, 1.7], me: [52.85, 2.3], body: `
<div class="meta">status: draft · builds on: 01-business.md · version 4</div>
<div class="h1">Product spec</div>
<div class="h2">Goal</div>
<div class="b">Customers get any invoice themselves, the day it is issued, in the format finance sends today.</div>
<div class="h2">User stories</div>
<div class="b li">As a customer, I download a past invoice from billing history.</div>
<div class="b li">As a support agent, I share one link instead of attaching files.</div>
<div class="nx"><div class="h2">Acceptance criteria</div>
<div class="b ck"><span class="ac">AC-1</span> Any invoice downloads as a PDF from billing history</div>
<div class="b ck"><span class="ac">AC-2</span> The tax breakdown is included, the day it is issued</div>
<div class="b ck"><span class="ac">AC-3</span> {{n:The PDF totals match what reporting reads}} <span class="kb">[[kb:reporting/invoice-totals]]</span></div></div>
<div class="by"><div class="h2">Edge cases</div>
<div class="b li">{{u:Prorated invoices need a “partial period” line.}}</div>
<div class="b li">Credit notes download the same way</div></div>
<div class="h2">Success metric</div>
<div class="b">Invoice tickets to support, week over week. Baseline 103 a week, target under 20.</div>
<div class="h2">Rollout</div>
<div class="b li">Behind a flag for 10% of accounts for one week</div>` },
  { role: "engineering", file: "03-engineering.md", t0: 56.45, sign: 60.6, turn: 61.0, nox: [57.45, 1.6], me: [58.25, 1.9], body: `
<div class="meta">status: draft · builds on: 02-product.md · version 2</div>
<div class="h1">Engineering design</div>
<div class="nx"><div class="h2">Scope</div><div class="b"><code>billing-service</code> and <code>customer-portal</code>. No other application changes. <span class="kb">[[kb:billing-service/overview]]</span></div></div>
<div class="h2">From the Atlas</div>
<svg class="bkmap" viewBox="0 0 430 116" width="430" height="116" style="display:block;margin:2px 0 2px">
  <path d="M68 24 L215 60" stroke="#2a9d68" stroke-width="2.5"/><path d="M68 96 L215 60" stroke="#6f5bd6" stroke-width="2.5"/><path d="M362 60 L215 60" stroke="#3f7cc0" stroke-width="2" stroke-dasharray="4 4"/>
  <circle cx="215" cy="60" r="17" fill="#F7B542" stroke="#b07a10" stroke-width="1.5"/><text x="215" y="98" fill="#1c2030" font-size="13" font-family="Manrope" font-weight="800" text-anchor="middle">billing-service</text>
  <circle cx="58" cy="24" r="10" fill="#5FD29F" stroke="#2a9d68" stroke-width="1.5"/><text x="76" y="14" fill="#2b3042" font-size="12" font-family="JB">receipts · renderPdf()</text>
  <circle cx="58" cy="96" r="10" fill="#A897F0" stroke="#6f5bd6" stroke-width="1.5"/><text x="76" y="114" fill="#2b3042" font-size="12" font-family="JB">reporting · invoice totals</text>
  <circle cx="372" cy="60" r="10" fill="#86B9EE" stroke="#3f7cc0" stroke-width="1.5"/><text x="372" y="88" fill="#2b3042" font-size="12" font-family="JB" text-anchor="middle">portal</text>
</svg>
<div class="nx"><div class="h2">Contracts</div>
<div class="b li">Reuse <code>receipts.renderPdf()</code>: no new PDF service</div>
<div class="b li">{{n:Reporting reads invoice totals: keep that contract}} <span class="kb">[[kb:reporting/invoice-totals]]</span></div></div>
<div class="by"><div class="h2">Sequence</div>
<div class="pre">GET /invoices/{id}/pdf
  → load invoice + lines   (billing db)
  → {{u:renderPdf(template="invoice")}}</div></div>
<div class="h2">Failure modes</div>
<div class="b li">Renderer slow: 2 s budget, then queue and email</div>
<div class="b li">Missing tax lines: refuse, and log the invoice id</div>` },
  { role: "developer", file: "04-developer.md", t0: 61.45, sign: 64.3, turn: null, nox: [62.0, 1.3], me: [62.35, 1.45], body: `
<div class="meta">status: draft · builds on: 03-engineering.md · version 1</div>
<div class="h1">Build spec</div>
<div class="nx"><div class="h2">Files</div>
<div class="b li"><code>src/pdf.py</code>: render with the receipts template</div>
<div class="b li"><code>src/routes.py</code>: <code>GET /invoices/{id}/pdf</code></div>
<div class="b li">{{n:ui/Download.tsx: a button in billing history}}</div></div>
<div class="by"><div class="h2">Tasks</div>
<div class="b ck">Reuse <code>renderPdf</code> with an invoice template</div>
<div class="b ck">Add the partial period line</div>
<div class="b ck">{{u:Flag invoices.pdf, off by default}}</div></div>
<div class="h2">Tests</div>
<div class="b ck"><code>test_pdf_matches_reporting_totals</code></div>
<div class="b ck"><code>test_prorated_partial_period_line</code></div>
<div class="b ck"><code>test_credit_note_pdf</code></div>
<div class="h2">Done</div>
<div class="b li">PR opened against <code>billing-service</code>, NoX guard green</div>` },
];

function pagePl(role, size) { return `<span class="pl" style="position:relative;display:inline-block;flex:none;width:${size}px;height:${size}px">${planetSVG(role)}</span>`; }
function head(p) { return `<div class="hd" style="color:${PAPER[p.role]}">${pagePl(p.role, 30)}${NAME[p.role]}<span class="file">${p.file}</span></div>`; }

/** front: typing targets and live cursors; back: the finished, signed page */
function faces(p, i) {
  const rc = PAPER[p.role];
  const typed = [];
  const front = p.body.replace(/\{\{([nu]):([^}]*)\}\}/g, (_, k, text) => {
    const id = `bk${i}${k}`;
    typed.push({ k, id, text });
    const caret = k === "n"
      ? `<span class="bkc nox" id="${id}c"><span class="flag">✦ NoX</span></span>`
      : `<span class="bkc me" id="${id}c">${ARROW(rc)}<span class="who">${NAME[p.role]}</span></span>`;
    return `<span id="${id}"></span>${caret}`;
  });
  const back = p.body.replace(/\{\{[nu]:([^}]*)\}\}/g, "$1").replace("status: draft", "status: approved");
  return {
    typed,
    html: `<div class="bk-face front" style="--rc:${rc}">${head(p)}<div class="pg">${front}</div><div class="fade"></div><div class="bk-stamp" id="bk${i}st">✓ SIGNED · ${NAME[p.role]}</div><div class="bk-shade"></div></div>
      <div class="bk-face back" style="--rc:${rc}">${head(p)}<div class="pg">${back}</div><div class="fade"></div><div class="bk-lock">${LOCK}read-only</div><div class="bk-stamp">✓ SIGNED · ${NAME[p.role]}</div><div class="bk-shade"></div></div>`,
  };
}

export function build() {
  /* ---------- left column: titles, subs, the path of roles ---------- */
  const TITLES = [
    [46.1, "Every role writes <em>its own page.</em>"],
    [51.25, "Each page <em>builds on the last.</em>"],
    [56.25, "Grounded in <em>the Atlas.</em>"],
    [61.25, "Only people <em>sign a page.</em>"],
    [65.9, "The book and <em>the map</em> become the context."],
  ];
  const SUBS = [
    [46.45, "One mission, one book. Each role writes its page, with NoX writing beside them."],
    [51.5, "The page before is signed and locked. The next role reads it and adds what only they know."],
    [56.5, "NoX finds what already exists and who depends on it, and cites the map."],
    [61.5, "NoX drafts, looks things up and checks. People approve."],
  ];
  $("#bkts").innerHTML = TITLES.map((_, i) => `<div class="title" id="bkt${i}">${TITLES[i][1]}</div>`).join("");
  $("#bkss").innerHTML = SUBS.map((_, i) => `<div class="sub" id="bks${i}">${SUBS[i][1]}</div>`).join("");
  gsap.set("#bkss .sub", { autoAlpha: 0 });
  TITLES.forEach(([t], i) => {
    maskWords(`#bkt${i}`, t, { stagger: 0.045, d: 0.8 });
    if (i < TITLES.length - 1) tl.to(`#bkt${i}`, { autoAlpha: 0, y: -24, duration: 0.3, ease: "power2.in" }, TITLES[i + 1][0] - 0.32);
  });
  SUBS.forEach(([t], i) => {
    tl.fromTo(`#bks${i}`, { autoAlpha: 0, y: 18, filter: "blur(6px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.6, immediateRender: false }, t);
    tl.to(`#bks${i}`, { autoAlpha: 0, duration: 0.25 }, i < SUBS.length - 1 ? SUBS[i + 1][0] - 0.3 : 65.6);
  });
  gsap.set("#bkk", { autoAlpha: 0 });
  rise("#bkk", 46.0, 0.6, 16);
  tl.set("#bkkt", { textContent: "Missions · build" }, 65.9);

  const ROWS = ["business", "product", "engineering", "developer"];
  $("#bkpath").innerHTML = ROWS.map((r, i) => `<div class="bkr" id="bkr${i}"><span class="pl">${planetSVG(r)}</span>${NAME[r]}<span class="st" id="bkst${i}">next</span></div>`).join("")
    + `<div class="bkr more" id="bkrm"><span class="ring">+</span><span>More roles coming soon<small>sales · compliance · design · security</small></span><span class="soon">soon</span></div>`;
  rise("#bkpath .bkr", 46.55, 0.6, 24, 0.07);
  PAGES.forEach((p, i) => {
    const hue = HEX[{ business: "biz", product: "po", engineering: "eng", developer: "dev" }[p.role]];
    tl.set(`#bkst${i}`, { textContent: "✎ writing" }, p.t0);
    tl.to(`#bkr${i}`, { color: hue, duration: 0.3 }, p.t0);
    tl.to(`#bkst${i}`, { color: hue, borderColor: hue, boxShadow: `0 0 20px -4px ${hue}`, duration: 0.3 }, p.t0);
    tl.set(`#bkst${i}`, { textContent: "✓ signed" }, p.sign);
    tl.to(`#bkr${i}`, { color: "#ECEFF8", duration: 0.3 }, p.sign);
    tl.to(`#bkst${i}`, { color: HEX.verify, borderColor: HEX.verify, boxShadow: "0 0 0px rgba(0,0,0,0)", duration: 0.3 }, p.sign);
  });
  tl.fromTo("#bkrm .soon", { scale: 1 }, { scale: 1.15, duration: 0.25, yoyo: true, repeat: 1, immediateRender: false }, 63.0);
  tl.to("#bkpath", { autoAlpha: 0, y: 20, duration: 0.4, ease: "power2.in" }, 65.55);

  /* ---------- the book ---------- */
  const built = PAGES.map((p, i) => faces(p, i));
  const coverFront = `<div class="bk-face front" style="padding:0"><div class="cover" style="border-radius:3px 14px 14px 3px">
      <div class="bk-ribbons" id="bkrib"><i style="background:var(--biz)"></i><i style="background:var(--po)"></i><i style="background:var(--eng)"></i><i style="background:var(--dev)"></i></div>
      <div style="font-family:JB;font-weight:600;font-size:17px;letter-spacing:.14em;color:var(--nox)">NOX-1 · SPEC BOOK</div>
      <div class="bk-cover-t">Self-serve<br><em style="font-style:italic">invoice PDFs</em></div>
      <div style="font-family:JB;font-size:15px;color:var(--muted);margin-top:22px">billing-service · customer-portal</div>
      <div class="bk-band" id="bkband">✓ signed by every role</div>
      <div style="position:absolute;left:44px;bottom:40px;display:flex;gap:10px">${ROWS.map((r) => pagePl(r, 44)).join("")}</div>
    </div><div class="bk-shade"></div></div>`;
  const coverBack = `<div class="bk-face back" style="padding:44px 40px 30px 40px">
      <div style="font-family:JB;font-weight:600;font-size:15px;letter-spacing:.14em;color:#a2670a">NOX-1 · SPEC BOOK</div>
      <div style="font-family:'Instrument Serif';font-size:56px;line-height:1.02;margin-top:30px;color:#10131f">Self-serve<br><em style="font-style:italic">invoice PDFs</em></div>
      <div class="b" style="margin-top:18px;color:#4a5168">billing-service · customer-portal</div>
      <div class="h2" style="margin-top:44px">Contents</div>
      ${ROWS.map((r, i) => `<div class="b" style="display:flex;align-items:center;gap:10px;margin:7px 0;font-size:15px">${pagePl(r, 22)}<span style="font-family:JB;font-size:13px;color:#6b7288">0${i + 1}</span>${NAME[r]}</div>`).join("")}
      <div class="b" style="display:flex;align-items:center;gap:10px;margin:7px 0;font-size:15px;color:#6b7288"><span style="width:22px;height:22px;border-radius:50%;border:1.5px dashed #8a90a3;display:inline-block"></span>more roles, coming soon</div>
      <div class="b" style="position:absolute;left:40px;bottom:34px;font-size:13.5px;color:#6b7288">Opened by the business user, Oct 2</div>
      <div class="bk-shade"></div></div>`;
  $("#bkleaves").innerHTML = `<div class="bk-leaf" id="bkcov">${coverFront}${coverBack}</div>`
    + built.map((b, i) => `<div class="bk-leaf" id="bkl${i}">${b.html}</div>`).join("");

  // start: cover open on the left, pages stacked on the right, top page first
  gsap.set("#bkcov", { rotationY: -180, zIndex: 30, transformPerspective: 2600 });
  PAGES.forEach((p, i) => gsap.set(`#bkl${i}`, { rotationY: 0, zIndex: 40 - i, transformPerspective: 2600 }));
  gsap.set("#bkband", { autoAlpha: 0, scaleX: 0 });
  gsap.set("#bkrib i", { yPercent: -100 });

  sceneIn("#sbk", 45.95, 0.3);
  tl.fromTo("#bkstage", { x: 420, rotationY: -30, autoAlpha: 0 }, { x: 0, rotationY: 0, autoAlpha: 1, duration: 1.1, ease: "expo.out" }, 46.0);
  cue("whoosh", 46.0, { d: 0.6, soft: true });
  // a slow push towards the page being written
  PAGES.forEach((p) => tl.fromTo("#bktilt", { scale: 1 }, { scale: 1.05, duration: 4.4, ease: "power1.inOut", immediateRender: false, transformOrigin: "75% 45%" }, p.t0));

  PAGES.forEach((p, i) => {
    const leaf = `#bkl${i}`;
    // NoX drafts the page: blocks stream in from the top (blank paper until then)
    gsap.set(`${leaf} .front .pg > *`, { autoAlpha: 0 });
    tl.fromTo(`${leaf} .front .pg > *`, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.25, stagger: 0.035, ease: "power2.out", immediateRender: false }, p.t0);
    cue("shimmer", p.t0, { d: 0.6 });
    if (i === 2) {
      gsap.set(`${leaf} .front .bkmap path`, { drawSVG: "0%" });
      tl.to(`${leaf} .front .bkmap path`, { drawSVG: "100%", duration: 0.6, stagger: 0.12 }, p.t0 + 0.5);
      tl.fromTo(`${leaf} .front .bkmap circle`, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.35, stagger: 0.08, ease: "back.out(2.4)", immediateRender: false }, p.t0 + 0.45);
    }
    // two writers at once
    const [nT] = built[i].typed.filter((x) => x.k === "n"), [uT] = built[i].typed.filter((x) => x.k === "u");
    typeText("#" + nT.id, nT.text, p.nox[0], p.nox[1], { caret: "#" + nT.id + "c", hold: 0.5 });
    typeText("#" + uT.id, uT.text, p.me[0], p.me[1], { caret: "#" + uT.id + "c", human: true, hold: 0.45 });
    // signed
    gsap.set(`#bk${i}st`, { autoAlpha: 0 });
    tl.fromTo(`#bk${i}st`, { autoAlpha: 0, scale: 2.2, rotation: -16 }, { autoAlpha: 1, scale: 1, rotation: -7, duration: 0.35, ease: "back.out(1.8)", immediateRender: false }, p.sign);
    cue("click", p.sign); cue("ding", p.sign + 0.05, { note: i + 1 });
    signBurst(`#bk${i}st`, p.sign);
    // the page turns onto the left-hand stack
    if (p.turn) {
      tl.set(leaf, { zIndex: 60 }, p.turn);
      tl.to(leaf, { rotationY: -180, duration: 0.75, ease: "power2.inOut" }, p.turn);
      tl.fromTo(`${leaf} .bk-shade`, { opacity: 0 }, { opacity: 0.55, duration: 0.375, yoyo: true, repeat: 1, ease: "sine.inOut", immediateRender: false }, p.turn);
      tl.set(leaf, { zIndex: 50 + i }, p.turn + 0.76);
      cue("whoosh", p.turn, { d: 0.5, soft: true });
    }
  });

  // NoX sparkles where it is typing
  const gold = new THREE.Color("#FFD27A");
  const noxCarets = $$(".bkc.nox");
  updaters.push((t) => {
    if (t < 46 || t > 65) return;
    for (const c of noxCarets) {
      if (!(parseFloat(c.style.opacity) > 0.5)) continue;
      const r = c.getBoundingClientRect();
      if (!r.height) continue;
      const x = r.left, y = r.top + r.height / 2;
      for (let k = 0; k < 9; k++) {
        const life = 0.6, q = t / life + k / 9, ph = q % 1, seed = Math.floor(q) * 13 + k;
        const a = ((Math.sin(seed * 12.9898) * 43758.5453) % 1) * Math.PI * 2;
        const rr = 8 + ph * 34;
        P.add(x + Math.cos(a) * rr, y + Math.sin(a) * rr - ph * 14, 2 + (1 - ph) * 5, gold, (1 - ph) * 0.8, 0);
      }
      P.add(x, y, 50, gold, 0.25, 1);
    }
  });

  /* ---------- the book closes, signed by every role ---------- */
  const CL = 64.9;
  [2, 1, 0].forEach((i, k) => {
    tl.set(`#bkl${i}`, { zIndex: 70 + k }, CL + k * 0.12);
    tl.to(`#bkl${i}`, { rotationY: 0, duration: 0.42, ease: "power2.inOut" }, CL + k * 0.12);
  });
  tl.set("#bkcov", { zIndex: 90 }, CL + 0.4);
  tl.to("#bkcov", { rotationY: 0, duration: 0.55, ease: "power2.inOut" }, CL + 0.4);
  cue("whoosh", CL, { d: 0.7 });
  tl.to("#sbk .bk-board", { left: 486, duration: 0.5, ease: "power2.inOut" }, CL + 0.45);
  tl.to("#sbk .bk-edge.l", { autoAlpha: 0, duration: 0.3 }, CL + 0.45);
  tl.to("#sbk .bk-spine", { autoAlpha: 0, duration: 0.3 }, CL + 0.45);
  tl.to("#bktilt", { scale: 1, rotationY: -18, duration: 1.0, ease: "power3.inOut" }, CL + 0.6);
  tl.to("#bkstage", { x: -170, y: 10, duration: 1.0, ease: "power3.inOut" }, CL + 0.6);
  tl.to("#bkband", { autoAlpha: 1, scaleX: 1, duration: 0.5, ease: "expo.out" }, 66.05);
  tl.to("#bkrib i", { yPercent: 0, duration: 0.5, stagger: 0.07, ease: "back.out(1.6)" }, 66.15);
  cue("success", 66.05, { soft: true });
  signBurst("#bkband", 66.05, 26);

  /* ---------- the book and the map become the context ---------- */
  $("#bkatp").innerHTML = appPlanetSVG("#F7B542");
  const TB = [
    `<span class="f">~/billing-service ›</span> <span class="g" id="bkcmd"></span><span class="bkc nox" id="bkcmdc" style="height:1em"></span>`,
    ``,
    `<span class="ok">✓</span> spec book   every page signed`,
    `<span class="ok">✓</span> Atlas       receipts · renderPdf()`,
    `              reporting · invoice totals`,
    `<span class="g">◆</span> building    src/pdf.py · ui/Download.tsx`,
    `<span class="ok">✓</span> PR opened   NOX-1 · NoX guard green`,
  ];
  $("#bktb").innerHTML = TB.map((h, i) => `<div class="row" id="bktr${i}">${h || " "}</div>`).join("");
  tl.fromTo("#bkterm", { autoAlpha: 0, y: 60, rotationX: 12, transformPerspective: 1800 }, { autoAlpha: 1, y: 0, rotationX: 0, duration: 0.8, ease: "expo.out", immediateRender: false }, 66.25);
  tl.set("#bktr0", { autoAlpha: 1 }, 66.4);
  typeText("#bkcmd", "/nox NOX-1", 66.65, 0.55, { caret: "#bkcmdc", human: true, hold: 0.2 });
  [2, 3, 4, 5, 6].forEach((r, k) => {
    const t = 67.45 + k * 0.36;
    tl.fromTo("#bktr" + r, { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.25, immediateRender: false }, t);
    cue("tick", t);
  });
  tl.set("#bktr1", { autoAlpha: 1 }, 67.4);
  tl.fromTo("#bkag", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, immediateRender: false }, 68.2);
  tl.fromTo("#bkag img", { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.35, stagger: 0.08, ease: "back.out(2)", immediateRender: false }, 68.3);
  tl.fromTo("#bkatlas", { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.6, immediateRender: false }, 66.5);

  // streams of light: book → agent, Atlas → agent
  const BM = { a: 0 };
  tl.to(BM, { a: 1, duration: 0.5 }, 66.8);
  tl.to(BM, { a: 0, duration: 0.35 }, 69.3);
  const amber = new THREE.Color("#F7B542"), green = new THREE.Color("#FFE2A0");
  const lines = [
    { a: [1300, 560], b: [1012, 600], c: green },
    { a: [1205, 975], b: [1012, 800], c: amber },
  ];
  updaters.push((t) => {
    if (BM.a < 0.01) return;
    for (const L of lines) {
      for (let k = 0; k < 14; k++) {
        const u = ((t * 0.9 + k / 14) % 1);
        const x = L.a[0] + (L.b[0] - L.a[0]) * u, y = L.a[1] + (L.b[1] - L.a[1]) * u + Math.sin(u * Math.PI) * 26;
        P.add(x, y, 4 + 3 * Math.sin(u * Math.PI), L.c, BM.a * Math.sin(u * Math.PI) * 0.95, 0);
      }
    }
  });

  // background: a calm drift for the whole scene
  tl.set(S.cam, { x: 0, y: 0, z: D + 220, tx: 0, ty: 0, tz: 0, drift: 1 }, 45.95);
  tl.to(S.cam, { z: D - 120, duration: 23.4, ease: "none" }, 45.95);
  tl.set(S.bloom, { strength: 0.6, threshold: 0.7 }, 45.95);

  // out: the mission shoots back to the orbit
  tl.to("#sbk", { autoAlpha: 0, scale: 0.96, filter: "blur(8px)", duration: 0.45, ease: "power2.in" }, 69.45);
  tl.to(S.cam, { z: D - 700, duration: 0.55, ease: "power3.in" }, 69.4);
  setOff("#sbk", 69.92);
  blur(69.4, 70.05, 6);
  cue("whoosh", 69.5, { d: 0.6 });
}

/** a ring of green light around an element at time t */
function signBurst(sel, t, n = 18) {
  const st = { a: 0 };
  const green = new THREE.Color(HEX.verify);
  const el = $(sel);
  updaters.push(() => {
    if (st.a < 0.01) return;
    const r0 = el.getBoundingClientRect();
    const bx = r0.left + r0.width / 2, by = r0.top + r0.height / 2;
    const k = 1 - st.a;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const r = 30 + k * 120; P.add(bx + Math.cos(a) * r, by + Math.sin(a) * r * 0.75, 5 * st.a + 2, green, st.a, 0); }
    P.add(bx, by, 200, green, st.a * 0.25, 1);
  });
  tl.fromTo(st, { a: 1 }, { a: 0, duration: 0.7, ease: "power2.out", immediateRender: false }, t);
}
