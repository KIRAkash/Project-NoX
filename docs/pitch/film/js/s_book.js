// Scene 7: the spec book. One mission is one book; every role writes its own page, with
// NoX writing beside the person, and signs it. Each page builds on the one before. Then
// the book closes and, with the Atlas, becomes the coding agent's context.
import { tl, cue, $, $$, sceneIn, setOff, rise, typeText, maskWords, blur, HEX } from "./engine.js";
import { S, D, updaters, P, THREE } from "./world.js";
import { planetSVG, appPlanetSVG, hover, comingSoonSVG, csActivate } from "./planets.js";

const PAPER = { business: "#9A7414", product: "#5B47C2", engineering: "#137E8C", developer: "#2F67A8" };
const NAME = { business: "Business user", product: "Product owner", engineering: "Engineering lead", developer: "Developer" };
const LOCK = `<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8.5 10.5 V7.5 a3.5 3.5 0 0 1 7 0 V10.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;
const ARROW = (c) => `<svg class="arrow" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 16.8 L20 16.8 Z" fill="${c}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

/* page sources: {{n:id|text}} is typed by NoX, {{u:id|text}} by the person */
const PAGES = [
  { role: "business", file: "01-business.md", note: 49.85, t0: 46.3, sign: 50.55, turn: 51.0, nox: [47.0, 2.3], me: [47.45, 2.45], body: `
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
  { role: "product", file: "02-product.md", note: 54.85, t0: 51.45, sign: 55.6, turn: 56.0, nox: [52.25, 1.7], me: [52.85, 2.3], body: `
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
  { role: "developer", file: "04-developer.md", t0: 61.45, sign: 63.95, turn: null, nox: [62.0, 1.2], me: [62.3, 1.3], body: `
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

/* a screenshot the person pins to their page: a small print held by a paper clip */
const CLIP = `<svg class="clip" viewBox="0 0 22 52"><path d="M7 46 V10 a4 4 0 0 1 8 0 V40 a6.5 6.5 0 0 1 -13 0 V14" fill="none" stroke="#9aa1b3" stroke-width="2.6" stroke-linecap="round"/><path d="M7 46 V10 a4 4 0 0 1 8 0 V40 a6.5 6.5 0 0 1 -13 0 V14" fill="none" stroke="#eef0f5" stroke-width="1" stroke-linecap="round" transform="translate(-.6 -.6)"/></svg>`;
const SHOTS = {
  business: { cap: "screenshot · support inbox", svg: `<svg viewBox="0 0 144 92" width="144" height="92"><rect width="144" height="92" rx="4" fill="#f4f5f8"/><rect width="144" height="14" rx="4" fill="#2b3042"/><circle cx="8" cy="7" r="2.2" fill="#ff6b6b"/><circle cx="15" cy="7" r="2.2" fill="#ffd166"/><circle cx="22" cy="7" r="2.2" fill="#5FD29F"/><text x="34" y="10" font-size="6.5" font-family="Manrope" font-weight="700" fill="#fff">Support inbox · 212 open</text>
    ${["Can I get my March invoice?", "Invoice PDF please", "Need invoice for expenses", "Where do I download invoices?", "Invoice #4471 copy?"].map((t, i) => `<rect x="6" y="${19 + i * 14}" width="132" height="11" rx="2" fill="${i % 2 ? "#ffffff" : "#e9ebf1"}"/><circle cx="12" cy="${24.5 + i * 14}" r="2.2" fill="#E9713C"/><text x="18" y="${27 + i * 14}" font-size="6.3" font-family="Manrope" font-weight="600" fill="#2b3042">${t}</text>`).join("")}</svg>` },
  product: { cap: "screenshot · billing history", svg: `<svg viewBox="0 0 144 92" width="144" height="92"><rect width="144" height="92" rx="4" fill="#f4f5f8"/><rect width="144" height="14" rx="4" fill="#2b3042"/><text x="8" y="10" font-size="6.5" font-family="Manrope" font-weight="700" fill="#fff">Billing history</text>
    ${[["INV-4471", "Mar 1", "$240.00", 0], ["INV-4502", "Mar 14", "$96.77", 1], ["INV-4519", "Apr 1", "$240.00", 0], ["INV-4560", "May 1", "$240.00", 0]].map(([n, d, a, hot], i) => `<rect x="6" y="${19 + i * 17}" width="132" height="14" rx="2" fill="${hot ? "#fde7c2" : "#ffffff"}" ${hot ? 'stroke="#E9713C" stroke-width="1.2"' : ""}/><text x="11" y="${28 + i * 17}" font-size="6.5" font-family="JB" fill="#2b3042">${n}</text><text x="52" y="${28 + i * 17}" font-size="6.5" font-family="Manrope" fill="#4a5168">${d}${hot ? " · prorated" : ""}</text><text x="133" y="${28 + i * 17}" font-size="6.5" font-family="JB" fill="#2b3042" text-anchor="end">${a}</text>`).join("")}</svg>` },
};
const note = (role, id = "") => SHOTS[role] ? `<div class="bk-note" ${id ? `id="${id}"` : ""}>${CLIP}${SHOTS[role].svg}<div class="cap">${SHOTS[role].cap}</div></div>` : "";

const BACKS = [
  // Leaf 0 turns to face Product Owner on the right
  {
    role: "product",
    signer: "Business user",
    file: "builds on 01-business.md",
    badge: "original request · signed by Business user",
    tag: "Initial Requirement",
    quote: "“Customers keep emailing support for invoices. Can they just download them?”",
    body: `
<div class="h2">Problem</div>
<div class="b">Support answered 1,340 invoice emails last quarter. Each takes about 6 minutes, and the customer waits a day.</div>
<div class="h2">What changes for customers</div>
<div class="b">Customers download any past invoice as a PDF from their billing history, without contacting support. <span class="kb">[[kb:billing-service/invoices]]</span></div>
<div class="h2">Done when</div>
<div class="b li">Support stops answering invoice emails</div>
<div class="b li">Invoice tickets fall by 80% within a quarter</div>`,
  },
  // Leaf 1 turns to face Engineering Lead on the right
  {
    role: "engineering",
    signer: "Product owner",
    file: "builds on 02-product.md",
    badge: "product specification · signed by Product owner",
    tag: "Product Goal",
    quote: "“Customers get any invoice themselves, the day it is issued, in the format finance sends today.”",
    body: `
<div class="h2">Key acceptance criteria</div>
<div class="b ck on"><span class="ac">AC-1</span> Any invoice downloads as a PDF from billing history</div>
<div class="b ck on"><span class="ac">AC-2</span> The tax breakdown is included, the day it is issued</div>
<div class="b ck on"><span class="ac">AC-3</span> The PDF totals match what reporting reads <span class="kb">[[kb:reporting/invoice-totals]]</span></div>
<div class="h2">Edge cases from the map</div>
<div class="b li">Prorated invoices need a “partial period” line</div>
<div class="b li">Credit notes download the same way</div>`,
  },
  // Leaf 2 turns to face Developer on the right
  {
    role: "developer",
    signer: "Engineering lead",
    file: "builds on 03-engineering.md",
    badge: "engineering design · signed by Engineering lead",
    tag: "Architecture Directive",
    quote: "“billing-service and customer-portal. Reuse receipts.renderPdf() — no new PDF service.”",
    body: `
<div class="h2">Contracts</div>
<div class="b li">Reuse <code>receipts.renderPdf()</code>: keep contract intact</div>
<div class="b li">Reporting reads invoice totals: unchanged contract <span class="kb">[[kb:reporting/invoice-totals]]</span></div>
<div class="h2">Sequence</div>
<div class="pre">GET /invoices/{id}/pdf
  → load invoice + lines   (billing db)
  → renderPdf(template="invoice")</div>
<div class="h2">Failure modes</div>
<div class="b li">Renderer slow: 2 s budget, then queue and email</div>`,
  },
  // Fallback
  {
    role: "developer",
    signer: "Developer",
    file: "04-developer.md",
    badge: "build spec · signed by Developer",
    tag: "Verification",
    quote: "“PR opened against billing-service, NoX guard green.”",
    body: `<div class="b">Ready for agent execution.</div>`,
  },
];

/** front: typing targets and live cursors; back: the finished, signed upstream context page */
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
  const drag = p.note ? `<div class="bk-drag" id="bk${i}drag" style="--rc:${rc}">${ARROW(rc)}<span class="who">${NAME[p.role]}</span></div>` : "";

  const bp = BACKS[i] || BACKS[3];
  const bHead = `<div class="hd" style="color:${PAPER[bp.role]}">${pagePl(bp.role, 30)}${NAME[bp.role]}<span class="file">${bp.file}</span></div>`;
  const backHtml = `
    <div class="meta">${bp.badge}</div>
    <div class="h2" style="margin-top:14px;color:#6b7288;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-family:JB">${bp.tag}</div>
    <div style="font-family:'Instrument Serif';font-size:31px;line-height:1.2;margin:6px 0 16px;color:#10131f;font-style:italic">${bp.quote}</div>
    ${bp.body}
  `;

  return {
    typed,
    html: `<div class="bk-face front" style="--rc:${rc}">${head(p)}<div class="pg">${front}</div><div class="fade"></div>${note(p.role, `bk${i}note`)}${drag}<div class="bk-stamp" id="bk${i}st">✓ SIGNED · ${NAME[p.role]}</div><div class="bk-shade"></div></div>
      <div class="bk-face back" style="--rc:${PAPER[bp.role]}">${bHead}<div class="pg">${backHtml}</div><div class="fade"></div><div class="bk-lock">${LOCK}read-only</div><div class="bk-stamp">✓ SIGNED · ${bp.signer}</div><div class="bk-shade"></div></div>`,
  };
}

const AGENTS = [["antigravity", "Antigravity"], ["claude", "Claude Code"], ["cursor", "Cursor"], ["codex", "Codex"], ["copilot", "Copilot"], ["gemini", "Gemini CLI"]];
const AG_X = (i) => 600 + i * 144, AG_Y = 420;

export function build() {
  /* ---------- left column: titles, subs, the path of roles ---------- */
  const TITLES = [
    [46.1, "Every role writes <em>its own page.</em>"],
    [51.25, "Each page <em>builds on the last.</em>"],
    [56.25, "Grounded in <em>the Atlas.</em>"],
    [61.25, "Only people <em>sign a page.</em>"],
    [65.05, "The book and <em>the map</em> become the context."],
    [67.55, "One command, <em>in Antigravity.</em>"],
  ];
  const SUBS = [
    [46.45, "One mission, one book. Each role writes its page, with NoX drafting from the Atlas."],
    [51.5, "The page before is signed and locked. The next role reads it and adds what only they know."],
    [56.5, "NoX reads the Atlas: what already exists, who depends on it, and every contract it touches."],
    [61.5, "Every line cites the Atlas. NoX drafts and checks. People approve."],
  ];
  $("#bkts").innerHTML = TITLES.map((_, i) => `<div class="title" id="bkt${i}"${i >= 4 ? ' style="width:1700px;white-space:nowrap"' : ""}>${TITLES[i][1]}</div>`).join("");
  $("#bkss").innerHTML = SUBS.map((_, i) => `<div class="sub" id="bks${i}">${SUBS[i][1]}</div>`).join("");
  gsap.set("#bkss .sub", { autoAlpha: 0 });
  TITLES.forEach(([t], i) => {
    maskWords(`#bkt${i}`, t, { stagger: 0.045, d: 0.8 });
    if (i < TITLES.length - 1) tl.to(`#bkt${i}`, { autoAlpha: 0, y: -24, duration: 0.3, ease: "power2.in" }, TITLES[i + 1][0] - 0.32);
  });
  SUBS.forEach(([t], i) => {
    tl.fromTo(`#bks${i}`, { autoAlpha: 0, y: 18, filter: "blur(6px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.6, immediateRender: false }, t);
    tl.to(`#bks${i}`, { autoAlpha: 0, duration: 0.25 }, i < SUBS.length - 1 ? SUBS[i + 1][0] - 0.3 : 64.7);
  });
  gsap.set("#bkk", { autoAlpha: 0 });
  rise("#bkk", 46.0, 0.6, 16);
  tl.set("#bkkt", { textContent: "Missions · build" }, 65.05);

  const ROWS = ["business", "product", "engineering", "developer"];
  $("#bkpath").innerHTML = ROWS.map((r, i) => `<div class="bkr" id="bkr${i}"><span class="pl">${planetSVG(r)}</span>${NAME[r]}<span class="st" id="bkst${i}">next</span></div>`).join("")
    + `<div class="bkr more" id="bkrm"><span class="pl">${comingSoonSVG()}</span><span>More roles coming soon<small>sales · design · security · QA</small></span><span class="soon">soon</span></div>`;
  rise("#bkpath .bkr", 46.55, 0.6, 24, 0.07);
  PAGES.forEach((p, i) => {
    const hue = HEX[{ business: "biz", product: "po", engineering: "eng", developer: "dev" }[p.role]];
    tl.set(`#bkst${i}`, { textContent: "✎ writing" }, p.t0);
    tl.to(`#bkr${i}`, { color: hue, duration: 0.3 }, p.t0);
    tl.to(`#bkst${i}`, { color: hue, borderColor: hue, boxShadow: `0 0 20px -4px ${hue}`, duration: 0.3 }, p.t0);
    tl.fromTo(`#bkr${i} .pl`, { scale: 1 }, { scale: 1.25, duration: 0.3, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, p.t0);
    hover(`#bkr${i}`, p.role, p.t0, 1.8);
    tl.set(`#bkst${i}`, { textContent: "✓ signed" }, p.sign);
    tl.to(`#bkr${i}`, { color: "#ECEFF8", duration: 0.3 }, p.sign);
    tl.to(`#bkst${i}`, { color: HEX.verify, borderColor: HEX.verify, boxShadow: "0 0 0px rgba(0,0,0,0)", duration: 0.3 }, p.sign);
  });
  csActivate("#bkrm", 62.6, 1.8);
  tl.fromTo("#bkrm .soon", { scale: 1 }, { scale: 1.15, duration: 0.25, yoyo: true, repeat: 1, immediateRender: false }, 62.7);
  tl.to("#bkpath", { autoAlpha: 0, y: 20, duration: 0.4, ease: "power2.in" }, 64.65);

  /* ---------- the book ---------- */
  const built = PAGES.map((p, i) => faces(p, i));
  const coverFront = `<div class="bk-face front" style="padding:0"><div class="cover" style="border-radius:3px 14px 14px 3px">
      <div class="bk-ribbons" id="bkrib"><i style="background:var(--biz)"></i><i style="background:var(--po)"></i><i style="background:var(--eng)"></i><i style="background:var(--dev)"></i></div>
      <div style="font-family:JB;font-weight:600;font-size:17px;letter-spacing:.14em;color:var(--nox)">NOX-1 · SPEC BOOK</div>
      <div class="bk-cover-t">Self-serve<br><em style="font-style:italic">invoice PDFs</em></div>
      <div style="font-family:JB;font-size:15px;color:var(--muted);margin-top:22px">billing-service · customer-portal</div>
      <div class="bk-band" id="bkband">✓ signed by every role</div>
      <div id="bkcav" style="position:absolute;left:44px;bottom:40px;display:flex;gap:10px;align-items:center">${ROWS.map((r) => pagePl(r, 44)).join("")}<span class="pl" style="position:relative;display:inline-block;width:40px;height:40px;opacity:.9">${comingSoonSVG()}</span></div>
    </div><div class="bk-shade"></div></div>`;
  const coverBack = `<div class="bk-face back" style="padding:44px 40px 30px 40px">
      <div style="font-family:JB;font-weight:600;font-size:15px;letter-spacing:.14em;color:#a2670a">NOX-1 · SPEC BOOK</div>
      <div style="font-family:'Instrument Serif';font-size:56px;line-height:1.02;margin-top:30px;color:#10131f">Self-serve<br><em style="font-style:italic">invoice PDFs</em></div>
      <div class="b" style="margin-top:18px;color:#4a5168">billing-service · customer-portal · grounded in the Atlas</div>
      <div class="h2" style="margin-top:44px">Contents</div>
      ${ROWS.map((r, i) => `<div class="b" style="display:flex;align-items:center;gap:10px;margin:7px 0;font-size:15px">${pagePl(r, 22)}<span style="font-family:JB;font-size:13px;color:#6b7288">0${i + 1}</span>${NAME[r]}</div>`).join("")}
      <div class="b" style="display:flex;align-items:center;gap:10px;margin:7px 0;font-size:15px;color:#6b7288"><span style="position:relative;display:inline-block;width:22px;height:22px">${comingSoonSVG()}</span>more roles, coming soon</div>
      <div class="b" style="position:absolute;left:40px;bottom:34px;font-size:13.5px;color:#6b7288">Opened by the business user, Oct 2</div>
      <div class="bk-shade"></div></div>`;
  $("#bkleaves").innerHTML = `<div class="bk-leaf" id="bkcov">${coverFront}${coverBack}</div>`
    + built.map((b, i) => `<div class="bk-leaf" id="bkl${i}">${b.html}</div>`).join("");

  gsap.set("#bkcov", { rotationY: -180, zIndex: 30, transformPerspective: 2600 });
  PAGES.forEach((p, i) => gsap.set(`#bkl${i}`, { rotationY: 0, zIndex: 40 - i, transformPerspective: 2600 }));
  gsap.set("#bkband", { autoAlpha: 0, scaleX: 0 });
  gsap.set("#bkrib i", { yPercent: -100 });

  sceneIn("#sbk", 45.95, 0.3);
  tl.fromTo("#bkstage", { x: 420, rotationY: -30, autoAlpha: 0 }, { x: 0, rotationY: 0, autoAlpha: 1, duration: 1.1, ease: "expo.out" }, 46.0);
  cue("whoosh", 46.0, { d: 0.6, soft: true });
  PAGES.forEach((p) => tl.fromTo("#bktilt", { scale: 1 }, { scale: 1.05, duration: 4.2, ease: "power1.inOut", immediateRender: false, transformOrigin: "75% 45%" }, p.t0));

  PAGES.forEach((p, i) => {
    const leaf = `#bkl${i}`;
    gsap.set(`${leaf} .front .pg > *`, { autoAlpha: 0 });
    tl.fromTo(`${leaf} .front .pg > *`, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.25, stagger: 0.035, ease: "power2.out", immediateRender: false }, p.t0);
    cue("shimmer", p.t0, { d: 0.6 });
    hover(`${leaf} .front .hd`, p.role, p.t0 + 0.2, 1.4);
    if (i === 2) {
      gsap.set(`${leaf} .front .bkmap path`, { drawSVG: "0%" });
      tl.to(`${leaf} .front .bkmap path`, { drawSVG: "100%", duration: 0.6, stagger: 0.12 }, p.t0 + 0.5);
      tl.fromTo(`${leaf} .front .bkmap circle`, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.35, stagger: 0.08, ease: "back.out(2.4)", immediateRender: false }, p.t0 + 0.45);
    }
    const [nT] = built[i].typed.filter((x) => x.k === "n"), [uT] = built[i].typed.filter((x) => x.k === "u");
    typeText("#" + nT.id, nT.text, p.nox[0], p.nox[1], { caret: "#" + nT.id + "c", hold: 0.5 });
    typeText("#" + uT.id, uT.text, p.me[0], p.me[1], { caret: "#" + uT.id + "c", human: true, hold: 0.45 });
    // the person pins a screenshot to the corner of the page
    if (p.note) {
      gsap.set([`#bk${i}note`, `#bk${i}drag`], { autoAlpha: 0 });
      tl.fromTo(`#bk${i}note`, { autoAlpha: 1, x: 300, y: 140, rotation: 22, scale: 1.12 }, { x: 0, y: 0, rotation: 5, scale: 1, duration: 0.55, ease: "power3.out", immediateRender: false }, p.note);
      tl.fromTo(`#bk${i}drag`, { autoAlpha: 1, x: 300, y: 140 }, { x: 0, y: 0, duration: 0.55, ease: "power3.out", immediateRender: false }, p.note);
      tl.to(`#bk${i}note`, { keyframes: { rotation: [8, 3.5, 5] }, duration: 0.3, ease: "sine.inOut" }, p.note + 0.55);
      tl.to(`#bk${i}drag`, { autoAlpha: 0, x: 40, y: 50, duration: 0.3 }, p.note + 0.6);
      cue("pop", p.note + 0.5); cue("click", p.note + 0.55);
    }
    gsap.set(`#bk${i}st`, { autoAlpha: 0 });
    tl.fromTo(`#bk${i}st`, { autoAlpha: 0, scale: 2.2, rotation: -16 }, { autoAlpha: 1, scale: 1, rotation: -7, duration: 0.35, ease: "back.out(1.8)", immediateRender: false }, p.sign);
    cue("click", p.sign); cue("ding", p.sign + 0.05, { note: i + 1 });
    signBurst(`#bk${i}st`, p.sign);
    if (p.turn) {
      tl.set(leaf, { zIndex: 60 }, p.turn);
      tl.to(leaf, { rotationY: -180, duration: 0.75, ease: "power2.inOut" }, p.turn);
      tl.fromTo(`${leaf} .bk-shade`, { opacity: 0 }, { opacity: 0.55, duration: 0.375, yoyo: true, repeat: 1, ease: "sine.inOut", immediateRender: false }, p.turn);
      tl.set(leaf, { zIndex: 50 + i }, p.turn + 0.76);
      cue("page", p.turn);
    }
  });

  const gold = new THREE.Color("#FFD27A");
  const noxCarets = $$(".bkc.nox");
  updaters.push((t) => {
    if (t < 46 || t > 69.6) return;
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
  const CL = 64.3;
  [2, 1, 0].forEach((i, k) => {
    tl.set(`#bkl${i}`, { zIndex: 70 + k }, CL + k * 0.1);
    tl.to(`#bkl${i}`, { rotationY: 0, duration: 0.36, ease: "power2.inOut" }, CL + k * 0.1);
  });
  tl.set("#bkcov", { zIndex: 90 }, CL + 0.32);
  tl.to("#bkcov", { rotationY: 0, duration: 0.45, ease: "power2.inOut" }, CL + 0.32);
  cue("page", CL); cue("page", CL + 0.12); cue("page", CL + 0.24); cue("whoosh", CL + 0.3, { d: 0.5, soft: true });
  tl.to("#sbk .bk-board", { left: 486, duration: 0.4, ease: "power2.inOut" }, CL + 0.36);
  tl.to(["#sbk .bk-edge.l", "#sbk .bk-spine"], { autoAlpha: 0, duration: 0.3 }, CL + 0.36);
  // the closed book settles, smaller, at the centre of the frame
  tl.to("#bktilt", { scale: 1, rotationY: -6, rotationX: 4, duration: 0.8, ease: "power3.inOut" }, CL + 0.75);
  tl.to("#bkstage", { x: -570, y: 175, scale: 0.6, duration: 0.8, ease: "power3.inOut" }, CL + 0.75);
  tl.to("#bkband", { autoAlpha: 1, scaleX: 1, duration: 0.5, ease: "expo.out" }, 65.15);
  tl.to("#bkrib i", { yPercent: 0, duration: 0.5, stagger: 0.07, ease: "back.out(1.6)" }, 65.25);
  hover("#bkcav", "business", 65.3, 1.2); hover("#bkcav", "product", 65.4, 1.2); hover("#bkcav", "engineering", 65.5, 1.2); hover("#bkcav", "developer", 65.6, 1.2);
  cue("success", 65.15, { soft: true });
  signBurst("#bkband", 65.15, 26);

  /* ---------- every coding agent is wired to the book; a copy goes to Antigravity ---------- */
  $("#bkags").innerHTML = AGENTS.map(([k, n], i) => `<div class="bk-ag" id="bkag${i}" style="left:${AG_X(i)}px;top:${AG_Y}px"><div class="ic"><img src="vendor/logos/${k}.svg"></div><div class="n">${n}</div></div>`).join("");
  const BOOK_TOP = [960, 545], ATLAS = [470, 760];
  $("#bkwire").innerHTML = AGENTS.map((_, i) => { const [x, y] = [AG_X(i), AG_Y + 52]; return `<path id="bkw${i}" d="M${BOOK_TOP[0]} ${BOOK_TOP[1]} C${BOOK_TOP[0]} ${BOOK_TOP[1] - 60} ${x} ${y + 70} ${x} ${y}" fill="none" stroke="rgba(247,181,66,.55)" stroke-width="2.5" stroke-dasharray="6 8"/>`; }).join("")
    + `<path id="bkwa" d="M${ATLAS[0] + 70} ${ATLAS[1]} C620 ${ATLAS[1]} 700 760 790 760" fill="none" stroke="rgba(134,185,238,.7)" stroke-width="3" stroke-dasharray="6 8"/>`;
  $("#bkatp").innerHTML = appPlanetSVG("#F7B542");
  gsap.set(["#bkags .bk-ag", "#bkatlas"], { autoAlpha: 0 });
  tl.fromTo("#bkags .bk-ag", { autoAlpha: 0, y: -40, scale: 0.6 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.07, ease: "back.out(2)", immediateRender: false }, 65.35);
  AGENTS.forEach((_, i) => cue("tick", 65.35 + i * 0.07));
  tl.fromTo("#bkatlas", { autoAlpha: 0, x: -40 }, { autoAlpha: 1, x: 0, duration: 0.5, immediateRender: false }, 65.35);
  gsap.set("#bkwire path", { drawSVG: "0%" });
  tl.to("#bkwire path", { drawSVG: "100%", duration: 0.5, stagger: 0.05, ease: "power2.out" }, 65.6);
  const wires = $$("#bkwire path"), WS = { a: 0 };
  tl.to(WS, { a: 1, duration: 0.3 }, 65.9);
  tl.to(WS, { a: 0, duration: 0.3 }, 67.35);
  const amber = new THREE.Color("#FFD27A"), ice = new THREE.Color("#9CC8FF");
  updaters.push((t) => {
    if (WS.a < 0.01) return;
    wires.forEach((w, wi) => {
      const L = w.getTotalLength(), back = wi === wires.length - 1;
      for (let k = 0; k < 5; k++) {
        const u = (t * 0.85 + k / 5 + wi * 0.13) % 1, pt = w.getPointAtLength(L * u);
        P.add(pt.x, pt.y, 7, back ? ice : amber, WS.a * Math.sin(u * Math.PI), 0);
      }
    });
  });
  // the copy flies to Antigravity
  gsap.set("#bkcopy", { autoAlpha: 0 });
  tl.fromTo("#bkcopy", { autoAlpha: 1, x: BOOK_TOP[0] - 45, y: BOOK_TOP[1] + 20, scale: 1, rotation: 0 }, { x: AG_X(0) - 45, y: AG_Y - 30, scale: 0.45, rotation: -12, duration: 0.6, ease: "power3.inOut", immediateRender: false }, 66.75);
  tl.to("#bkcopy", { autoAlpha: 0, duration: 0.15 }, 67.33);
  cue("whoosh", 66.75, { d: 0.5, soft: true });
  tl.fromTo("#bkag0 .ic", { boxShadow: "0 0 0px rgba(247,181,66,0)" }, { boxShadow: "0 0 60px 10px rgba(247,181,66,.85)", duration: 0.25, yoyo: true, repeat: 1, immediateRender: false }, 67.3);
  signBurst("#bkag0 .ic", 67.3, 20);
  cue("ding", 67.3, { note: 5 });
  // Antigravity opens: the window grows out of its icon
  tl.to(["#bkstage", "#bkags .bk-ag:not(#bkag0)", "#bkwire", "#bkatlas"], { autoAlpha: 0, duration: 0.3 }, 67.45);
  tl.to("#bkag0", { autoAlpha: 0, scale: 1.6, duration: 0.3 }, 67.5);

  const TB = [
    `<span class="f">~/billing-service ›</span> <span class="g" id="bkcmd"></span><span class="bkc nox" id="bkcmdc" style="height:1em"></span>`,
    ``,
    `<span class="g">◆</span> spec book   4 pages, every one signed`,
    `<span class="g">◆</span> Atlas       receipts · renderPdf() · reporting · invoice totals`,
    `<span class="ok">✓</span> plan        src/pdf.py · src/routes.py · ui/Download.tsx`,
    `<span class="ok">✓</span> tests       7 passing`,
    `<span class="ok">✓</span> PR opened   NOX-1 · NoX guard green`,
  ];
  $("#bktb").innerHTML = TB.map((h, i) => `<div class="row" id="bktr${i}">${h || " "}</div>`).join("");
  tl.fromTo("#bkterm", { autoAlpha: 0, scale: 0.12, x: AG_X(0) - 960, y: AG_Y - 610 }, { autoAlpha: 1, scale: 1, x: 0, y: 0, duration: 0.5, ease: "expo.out", immediateRender: false }, 67.5);
  cue("whoosh", 67.5, { d: 0.4 });
  tl.set(["#bktr0", "#bktr1"], { autoAlpha: 1 }, 67.85);
  typeText("#bkcmd", "/nox NOX-1", 67.95, 0.5, { caret: "#bkcmdc", human: true, hold: 0.15 });
  [2, 3, 4, 5, 6].forEach((r, k) => {
    const t = 68.55 + k * 0.2;
    tl.fromTo("#bktr" + r, { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.22, immediateRender: false }, t);
    cue("tick", t);
  });

  tl.set(S.cam, { x: 0, y: 0, z: D + 220, tx: 0, ty: 0, tz: 0, drift: 1 }, 45.95);
  tl.to(S.cam, { z: D - 120, duration: 23.4, ease: "none" }, 45.95);
  tl.set(S.bloom, { strength: 0.6, threshold: 0.7 }, 45.95);

  tl.to("#sbk", { autoAlpha: 0, scale: 0.96, filter: "blur(8px)", duration: 0.4, ease: "power2.in" }, 69.55);
  tl.to(S.cam, { z: D - 700, duration: 0.5, ease: "power3.in" }, 69.45);
  setOff("#sbk", 69.95);
  blur(69.45, 70.05, 6);
  cue("whoosh", 69.5, { d: 0.6 });
}

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
