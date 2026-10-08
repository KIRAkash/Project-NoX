// The four seat planets with their faces and props, drawn as SVG (ported from
// apps/web/components/app/planet-character.tsx), plus small app planets.
/* global gsap */
/* ---------- roles & planets ---------- */
export const ROLES = {
  business:    { hue: "#E8C97A", s: ["#FFF3CF", "#E8C97A", "#8C6A22"], f: "ring" },
  product:     { hue: "#A897F0", s: ["#E6E0FF", "#A897F0", "#4F3F9E"], f: "moon" },
  engineering: { hue: "#5FCBD8", s: ["#D6F7FB", "#5FCBD8", "#1F6B75"], f: "plain" },
  developer:   { hue: "#86B9EE", s: ["#E3F0FF", "#86B9EE", "#2D5C91"], f: "bands" },
};
let uidN = 0;
export function planetSVG(role, face = true) {
  const R = ROLES[role]; const [light, base, shadow] = R.s; const ink = "#10131F"; const u = "p" + (uidN++);
  const eye = (x, y) => `<g transform="translate(${x} ${y})"><g class="eye"><ellipse rx="4.4" ry="4.9" fill="${ink}"/><circle cx="-1.5" cy="-1.8" r="1.45" fill="#fff"/></g></g>`;
  let back = "", front = "", props = "";
  if (R.f === "ring") {
    back = `<g transform="rotate(-16 50 50)"><path d="M-37.5 50 A87.5 21 0 0 1 137.5 50" fill="none" stroke="${base}" stroke-opacity=".8" stroke-width="4"/></g>`;
    front = `<g transform="rotate(-16 50 50)"><path d="M-37.5 50 A87.5 21 0 0 0 137.5 50" fill="none" stroke="${base}" stroke-opacity=".8" stroke-width="4"/></g>`;
  }
  if (R.f === "bands") {
    front = `<g transform="rotate(-16 50 50)"><ellipse cx="50" cy="50" rx="77.5" ry="16" fill="none" stroke="${light}" stroke-opacity=".6" stroke-width="1.8" clip-path="url(#${u}bh)"/></g>`;
  }
  let body = `<circle cx="50" cy="50" r="50" fill="url(#${u}g)"/>`;
  if (R.f === "bands") {
    let st = ""; for (let i = -6; i < 9; i++) st += `<rect x="-40" y="${i * 16}" width="180" height="4" fill="${shadow}" fill-opacity=".28"/><rect x="-40" y="${i * 16 + 4}" width="180" height="3" fill="${light}" fill-opacity=".14"/>`;
    body += `<g clip-path="url(#${u}c)"><g transform="rotate(-8 50 50)">${st}</g></g>`;
  }
  body += `<circle cx="50" cy="50" r="50" fill="url(#${u}sh)"/>`;
  if (R.f === "moon") props += `<circle cx="96" cy="12" r="10" fill="url(#${u}m)"/>`;
  if (face) {
    const ey = role === "product"
      ? `${eye(37, 45)}<g transform="translate(60 45)"><g class="lid" transform="scale(1 0.72)"><g class="eye"><ellipse rx="4.4" ry="4.9" fill="${ink}"/><circle cx="-1.5" cy="-1.8" r="1.45" fill="#fff"/></g></g></g>`
      : eye(37, 45) + eye(60, 45);
    props += `<g class="eyes">${ey}</g>`;
    if (role === "business") {
      props += `<g transform="translate(0 3)"><g class="specs"><path d="M27 51.5 Q50 70 73 51.5" fill="none" stroke="${shadow}" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="0.1 2.3"/><g fill="${light}" fill-opacity=".18" stroke="${ink}" stroke-width="1.9" stroke-linejoin="round"><path d="M29.5 50 H44.5 A7.5 6.4 0 0 1 29.5 50 Z"/><path d="M52.5 50 H67.5 A7.5 6.4 0 0 1 52.5 50 Z"/></g><g fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"><path d="M44.5 50.4 Q48.5 47.8 52.5 50.4"/><path d="M29.5 50 L26.5 51.5"/><path d="M67.5 50 L73 51.5"/></g></g></g>
      <g class="bulb"><g transform="translate(62 -44) scale(1.35) translate(-62 34)">
        <circle class="bulb-halo" cx="62" cy="-10" r="24" fill="url(#${u}halo)" opacity="0"/>
        <path d="M62 -34 V-21" stroke="${ink}" stroke-width="1.1"/>
        <rect x="58.6" y="-21.5" width="6.8" height="5.5" rx="1.2" fill="${shadow}" stroke="${ink}" stroke-width=".8"/>
        <path class="bulb-glass" d="M59 -16 C59 -13.5 54.5 -12 54.5 -7.5 A7.5 7.5 0 0 0 69.5 -7.5 C69.5 -12 65 -13.5 65 -16 Z" fill="${light}" fill-opacity=".22" stroke="${light}" stroke-width="1.1" stroke-linejoin="round"/>
        <path class="filament" d="M60.3 -15.5 V-10.5 L61.2 -8.5 L62 -10.5 L62.8 -8.5 L63.7 -10.5 V-15.5" fill="none" stroke="${shadow}" stroke-width=".8"/>
      </g></g>`;
    }
    if (role === "product") {
      props += `<path class="brow" d="M55 36.2 Q60 33.6 65.2 36.4" fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"/>
      <g transform="translate(83 82)"><g class="pencil" transform="rotate(-62)"><rect x="0" y="-2.4" width="4" height="4.8" rx="1.2" fill="${light}" stroke="${shadow}" stroke-width=".6"/><rect x="4" y="-2.4" width="2" height="4.8" fill="${shadow}"/><rect x="6" y="-2.4" width="17" height="4.8" fill="${base}" stroke="${shadow}" stroke-width=".6"/><path d="M23 -2.4 L29 0 L23 2.4 Z" fill="${light}" stroke="${shadow}" stroke-width=".6"/><path d="M27.2 -.75 L29 0 L27.2 .75 Z" fill="${ink}"/></g></g>
      <path class="check" d="M99 92 L104 97.5 L115 84" fill="none" stroke="${light}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30" stroke-dashoffset="30"/>`;
    }
    if (role === "engineering") {
      props += `<path d="M7.5 42 C3 -22 97 -22 92.5 42" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>
      <path d="M11 30 C12 -8 88 -8 89 30" fill="none" stroke="#2A3050" stroke-width="2.4" stroke-linecap="round"/>
      <g class="mic"><path d="M6 62 C6 76 26 78 40 69.5" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="43.5" cy="68" rx="5.2" ry="3.9" fill="${ink}"/><circle class="mic-led" cx="46.4" cy="68.6" r="1.1" fill="#7CF0B0"/></g>
      <rect x="-4" y="38" width="16" height="28" rx="7.5" fill="${ink}"/><rect x="-1.5" y="42" width="6" height="20" rx="3" fill="${base}"/>
      <rect x="88" y="38" width="16" height="28" rx="7.5" fill="${ink}"/><rect x="95.5" y="42" width="6" height="20" rx="3" fill="${base}"/>
      <g fill="none" stroke="${light}" stroke-linecap="round"><path class="signal" d="M-8 45 Q-12 52 -8 59" stroke-width="1.8" opacity="0"/><path class="signal" d="M-13.5 40 Q-20 52 -13.5 64" stroke-width="1.6" opacity="0"/><path class="signal" d="M-19 35 Q-28 52 -19 69" stroke-width="1.4" opacity="0"/></g>`;
    }
    if (role === "developer") {
      props += `<g fill="${light}" fill-opacity=".14" stroke="${ink}" stroke-width="2.1"><circle cx="37" cy="45" r="8.6"/><circle cx="60" cy="45" r="8.6"/></g>
      <g fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round"><path d="M45.6 43.6 Q48.5 40.8 51.4 43.6"/><path d="M28.4 43.5 L13 40.5"/><path d="M68.6 43.5 L85 40.5"/></g>
      <g class="code" opacity="0" font-family="JB, monospace" font-size="13" font-weight="700" fill="${light}"><text x="50" y="-8" text-anchor="middle">&lt;/&gt;</text></g>`;
    }
  }
  return `<svg viewBox="0 0 100 100" width="100%" height="100%">
    <defs>
      <radialGradient id="${u}g" cx=".32" cy=".28" r=".8"><stop offset="0" stop-color="${light}"/><stop offset=".46" stop-color="${base}"/><stop offset="1" stop-color="${shadow}"/></radialGradient>
      <radialGradient id="${u}sh" cx=".3" cy=".25" r=".85"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></radialGradient>
      <radialGradient id="${u}m" cx=".35" cy=".3"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${light}"/><stop offset="1" stop-color="${shadow}"/></radialGradient>
      <radialGradient id="${u}halo"><stop offset="0" stop-color="${light}" stop-opacity=".95"/><stop offset=".45" stop-color="${base}" stop-opacity=".4"/><stop offset="1" stop-color="${base}" stop-opacity="0"/></radialGradient>
      <clipPath id="${u}c"><circle cx="50" cy="50" r="49.6"/></clipPath>
      <clipPath id="${u}bh"><rect x="-60" y="50" width="220" height="80"/></clipPath>
    </defs>${back}${body}${front}${props}</svg>`;
}
export function appPlanetSVG(hue) {
  const u = "a" + (uidN++);
  return `<svg viewBox="0 0 100 100" width="100%" height="100%"><defs><radialGradient id="${u}" cx=".32" cy=".28" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".18" stop-color="${hue}"/><stop offset="1" stop-color="#0B0E1A"/></radialGradient></defs><circle cx="50" cy="50" r="50" fill="url(#${u})"/></svg>`;
}
export function mountPlanet(el, role, size, face = true) {
  el.style.width = el.style.height = size + "px";
  const glow = document.createElement("div");
  glow.className = "pl-glow";
  glow.style.boxShadow = `0 0 ${size * 0.42}px ${size * 0.05}px ${ROLES[role].hue}55`;
  el.appendChild(glow);
  const s = document.createElement("div");
  s.style.cssText = "position:relative;width:100%;height:100%";
  s.innerHTML = planetSVG(role, face);
  el.appendChild(s);
  gsap.set(el, { xPercent: -50, yPercent: -50 });
}



/* ---------- the role picker's hover animations, played on the timeline ---------- */
import { tl } from "./engine.js";

/** play `role`'s hover animation on every planet matched by `sel` at t, and let it go after `hold` s */
export function hover(sel, role, t, hold = 1.6) {
  const q = (c) => document.querySelectorAll(`${sel} .${c}`);
  const on = (targets, from, to, at = t, d = 0.35, ease = "power2.out") => {
    if (!targets.length) return;
    tl.fromTo(targets, from, { ...to, duration: d, ease, immediateRender: false }, at);
    tl.fromTo(targets, to, { ...from, duration: 0.4, ease: "power2.inOut", immediateRender: false }, t + hold);
  };
  if (role === "business") {
    on(q("bulb-glass"), { attr: { "fill-opacity": 0.22 } }, { attr: { "fill-opacity": 1 } });
    on(q("bulb-halo"), { opacity: 0 }, { opacity: 1 }, t, 0.45);
    on(q("filament"), { attr: { stroke: "#8C6A22" } }, { attr: { stroke: "#FFFFFF" } });
    on(q("eyes"), { y: 0 }, { y: -1.4 }, t + 0.05);
    on(q("specs"), { y: 0 }, { y: -7.5 }, t + 0.1, 0.45, "back.out(1.8)");
    const b = q("bulb");
    if (b.length) tl.fromTo(b, { rotation: 0 }, { keyframes: { rotation: [7, -5, 2.5, 0] }, duration: 0.9, ease: "sine.inOut", svgOrigin: "62 -44", immediateRender: false }, t);
  } else if (role === "product") {
    on(q("brow"), { y: 0, rotation: 0 }, { y: -3.2, rotation: -6, transformOrigin: "50% 50%" });
    on(q("lid"), { scaleY: 0.72 }, { scaleY: 1 });
    on(q("pencil"), { rotation: -62, x: 0, y: 0 }, { rotation: -80, x: 4, y: 3 });
    on(q("check"), { attr: { "stroke-dashoffset": 30 } }, { attr: { "stroke-dashoffset": 0 } }, t + 0.2, 0.3);
  } else if (role === "engineering") {
    on(q("mic"), { rotation: 0 }, { rotation: -7, svgOrigin: "6 62" }, t, 0.4, "back.out(2)");
    const led = q("mic-led");
    if (led.length) tl.fromTo(led, { opacity: 1 }, { opacity: 0.15, duration: 0.12, repeat: 5, yoyo: true, ease: "none", immediateRender: false }, t + 0.2);
    const sig = q("signal");
    if (sig.length) {
      tl.fromTo(sig, { opacity: 0, scale: 0.6, transformOrigin: "100% 50%" }, { opacity: 1, scale: 1, duration: 0.35, stagger: 0.14, immediateRender: false }, t + 0.15);
      tl.to(sig, { opacity: 0, duration: 0.3, stagger: 0.14 }, t + 0.9);
    }
  } else if (role === "developer") {
    on(q("code"), { opacity: 0, y: 0 }, { opacity: 1, y: -3 });
    const e = q("eyes");
    if (e.length) tl.fromTo(e, { x: 0 }, { keyframes: { x: [-2, 2.2, -2, 2.2, 0] }, duration: 1.3, ease: "none", immediateRender: false }, t);
  }
}

/** the role picker's placeholder: an outlined planet with a plus, and a moon for each role that is coming */
export const UPCOMING = [["Sales", "#F3A27E"], ["Design", "#E79AD0"], ["Security & Compliance", "#7FD6A4"], ["QA", "#C3D86A"]];
const CS_TILT = (-16 * Math.PI) / 180, CS_ANG = [20, 65, 115, 160];
export const csOrbit = (deg) => { const r = (deg * Math.PI) / 180, x = 72 * Math.cos(r), y = 19 * Math.sin(r); return [50 + x * Math.cos(CS_TILT) - y * Math.sin(CS_TILT), 50 + x * Math.sin(CS_TILT) + y * Math.cos(CS_TILT)]; };
export const csQueue = (i) => [108 + i * 11, 14 - i * 7];
export function comingSoonSVG() {
  const u = "cs" + (uidN++);
  const moons = UPCOMING.map(([, hue], i) => { const [x, y] = csQueue(i), s = 0.58 - i * 0.07; return `<g class="cs-moon" data-i="${i}" transform="translate(${x} ${y}) scale(${s})"><circle r="5.5" fill="${hue}" fill-opacity=".4"/></g>`; }).join("");
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" overflow="visible">
    <defs><radialGradient id="${u}b" cx="32%" cy="28%" r="80%"><stop offset="0%" stop-color="#2A3150"/><stop offset="60%" stop-color="#141A2C"/><stop offset="100%" stop-color="#0A0D17"/></radialGradient>
    <clipPath id="${u}f" clipPathUnits="userSpaceOnUse"><rect x="-40" y="50" width="180" height="40"/></clipPath></defs>
    <g class="cs-orbit" opacity="0" transform="rotate(-16 50 50)"><ellipse cx="50" cy="50" rx="72" ry="19" fill="none" stroke="#7C86A3" stroke-opacity=".45" stroke-width=".8" stroke-dasharray="2 3"/></g>
    <circle cx="50" cy="50" r="48" fill="url(#${u}b)"/>
    <circle class="cs-ring" cx="50" cy="50" r="48" fill="none" stroke="#6E7793" stroke-width="1.2" stroke-dasharray="4 5"/>
    <g class="cs-plus" stroke="#7C86A3" stroke-width="3" stroke-linecap="round"><line x1="50" y1="39" x2="50" y2="61"/><line x1="39" y1="50" x2="61" y2="50"/></g>
    <g class="cs-orbit" opacity="0" transform="rotate(-16 50 50)"><ellipse cx="50" cy="50" rx="72" ry="19" fill="none" stroke="#7C86A3" stroke-opacity=".45" stroke-width=".8" stroke-dasharray="2 3" clip-path="url(#${u}f)"/></g>
    ${moons}</svg>`;
}
/** the placeholder lights up: the orbit appears and the waiting moons swing into it, one after another */
export function csActivate(sel, t, hold = 0) {
  const all = (c) => document.querySelectorAll(`${sel} .${c}`);
  tl.to(all("cs-orbit"), { opacity: 1, duration: 0.5 }, t);
  tl.to(all("cs-ring"), { attr: { stroke: "#A6AEC7" }, rotation: 40, svgOrigin: "50 50", duration: 0.7 }, t);
  tl.to(all("cs-plus"), { attr: { stroke: "#F7B542" }, duration: 0.5 }, t);
  document.querySelectorAll(`${sel} .cs-moon`).forEach((m) => {
    const i = +m.dataset.i, [x, y] = csOrbit(CS_ANG[i]);
    tl.to(m, { attr: { transform: `translate(${x} ${y}) scale(1)` }, duration: 0.7, ease: "power3.out" }, t + i * 0.09);
    tl.to(m.querySelector("circle"), { attr: { "fill-opacity": 1 }, duration: 0.7 }, t + i * 0.09);
  });
  if (hold) {
    tl.to(all("cs-orbit"), { opacity: 0, duration: 0.5 }, t + hold);
    tl.to(all("cs-ring"), { attr: { stroke: "#6E7793" }, rotation: 0, svgOrigin: "50 50", duration: 0.7 }, t + hold);
    tl.to(all("cs-plus"), { attr: { stroke: "#7C86A3" }, duration: 0.5 }, t + hold);
    document.querySelectorAll(`${sel} .cs-moon`).forEach((m) => {
      const i = +m.dataset.i, [x, y] = csQueue(i), s = 0.58 - i * 0.07;
      tl.to(m, { attr: { transform: `translate(${x} ${y}) scale(${s})` }, duration: 0.7, ease: "power3.inOut" }, t + hold + (3 - i) * 0.09);
      tl.to(m.querySelector("circle"), { attr: { "fill-opacity": 0.4 }, duration: 0.7 }, t + hold);
    });
  }
}
