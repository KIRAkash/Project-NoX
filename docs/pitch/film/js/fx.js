// Screen-space particle effects. Each one registers an updater that is a pure
// function of time, so trails, bursts and sparks are deterministic per frame.
import { P, updaters, THREE } from "./world.js";
import { hash } from "./engine.js";

const C = (hex) => new THREE.Color(hex);
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); // cubic in-out

/** A keyframed path: keys = [[t, x, y], ...]; eased between keys. Returns {x, y} at time t. */
export function keyPath(keys) {
  return (t) => {
    if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, x0, y0, c] = keys[i - 1], [t1, x1, y1] = keys[i];
        const k = ease((t - t0) / (t1 - t0));
        if (c) { // quadratic bend: c = [cx, cy]
          const u = k;
          return { x: (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * c[0] + u * u * x1, y: (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * c[1] + u * u * y1 };
        }
        return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k };
      }
    }
    const L = keys[keys.length - 1];
    return { x: L[1], y: L[2] };
  };
}

/**
 * A comet: bright head plus a fading trail sampled from the path at earlier times.
 * state: { a: alpha 0..1, c: hex } tweened by the timeline. path(t) -> {x,y}.
 */
export function comet(path, state, { t0 = 0, t1 = 999, trail = 0.34, n = 44, head = 30, glow = 150 } = {}) {
  updaters.push((t) => {
    if (t < t0 || t > t1 || state.a < 0.005) return;
    const col = C(state.c), hot = C("#FFFFFF");
    for (let i = n - 1; i >= 0; i--) {
      const u = i / n, tt = t - u * trail;
      const p = path(tt);
      const s = (1 - u) * (head * 0.75) + 3;
      P.add(p.x, p.y, s, i < 2 ? hot : col, state.a * (1 - u) * (i < 2 ? 1 : 0.7), 0);
    }
    const h = path(t);
    P.add(h.x, h.y, glow, col, state.a * 0.45, 1);
    P.add(h.x, h.y, head, hot, state.a, 0);
  });
}

/** particles spiralling into (cx, cy) between t0 and t1 */
export function implode(cx, cy, t0, t1, { n = 340, r0 = 1100, colors = ["#FFD9A0", "#F7B542", "#A9C4FF", "#FFFFFF"] } = {}) {
  const cols = colors.map(C);
  updaters.push((t) => {
    if (t < t0 || t > t1 + 0.05) return;
    const k = (t - t0) / (t1 - t0);
    for (let i = 0; i < n; i++) {
      const d = hash(i, 3) * 0.55;                 // start delay
      let u = (k - d) / (1 - d); if (u <= 0 || u >= 1) continue;
      const e = u * u * u;
      const a0 = hash(i, 1) * Math.PI * 2, r = (r0 * (0.35 + hash(i, 2))) * (1 - e);
      const a = a0 + e * (2.4 + hash(i, 5) * 2);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.75;
      P.add(x, y, 3 + hash(i, 4) * 7 + e * 6, cols[i % cols.length], Math.min(1, u * 3) * (0.5 + e), 0);
    }
  });
}

/** particles flung outward from (cx, cy) starting at t0 */
export function burst(cx, cy, t0, { n = 420, dur = 1.6, speed = 1700, colors = ["#FFF1D0", "#FFD27A", "#F7B542", "#FFFFFF", "#A9C4FF"] } = {}) {
  const cols = colors.map(C);
  updaters.push((t) => {
    if (t < t0 || t > t0 + dur) return;
    const k = (t - t0) / dur;
    for (let i = 0; i < n; i++) {
      const a = hash(i, 11) * Math.PI * 2, sp = speed * (0.25 + hash(i, 12) ** 2 * 1.2);
      const dist = sp * (1 - Math.pow(1 - k, 2.2)) * dur * 0.6 + 60;
      const x = cx + Math.cos(a) * dist, y = cy + Math.sin(a) * dist * 0.85;
      P.add(x, y, 2 + hash(i, 13) * 6, cols[i % cols.length], (1 - k) ** 1.3 * (0.6 + hash(i, 14) * 0.6), 0);
    }
  });
}

/** sparkles around a DOM element while state.a > 0 (e.g. NoX's caret while it writes) */
export function sparkleAt(getXY, state, { n = 14, color = "#FFD27A", radius = 46 } = {}) {
  const col = C(color);
  updaters.push((t) => {
    if (state.a < 0.01) return;
    const p = getXY(); if (!p) return;
    for (let i = 0; i < n; i++) {
      const life = 0.6, ph = (t / life + hash(i, 21)) % 1;
      const a = hash(i + Math.floor(t / life + hash(i, 21)) * 31, 22) * Math.PI * 2;
      const r = radius * (0.2 + ph * 0.9);
      P.add(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r - ph * 18, 3 + (1 - ph) * 6, col, state.a * (1 - ph) * 0.9, 0);
    }
  });
}

/** soft glow blob at a point, alpha from state */
export function glowAt(getXY, state, { size = 400, color = "#F7B542" } = {}) {
  const col = C(color);
  updaters.push(() => { if (state.a < 0.005) return; const p = getXY(); if (p) P.add(p.x, p.y, size * (state.s || 1), col, state.a, 1); });
}

/** particles flowing along screen paths (bezier from a to b), e.g. data streams */
export function streams(lines, state, { n = 7, speed = 0.75 } = {}) {
  // lines: [{a:{x,y}, b:{x,y}, c:{x,y}, color, blocked? (t)=>bool}]
  const cols = lines.map((l) => C(l.color));
  updaters.push((t) => {
    if (state.a < 0.01) return;
    lines.forEach((l, li) => {
      for (let j = 0; j < n; j++) {
        let u = (t * speed + j / n + li * 0.137) % 1;
        const stop = l.blocked && l.blocked(t);
        if (stop && u > 0.45) continue;
        const x = (1 - u) * (1 - u) * l.a.x + 2 * (1 - u) * u * l.c.x + u * u * l.b.x;
        const y = (1 - u) * (1 - u) * l.a.y + 2 * (1 - u) * u * l.c.y + u * u * l.b.y;
        const fade = Math.sin(u * Math.PI);
        P.add(x, y, 9, cols[li], state.a * fade, 0);
        P.add(x, y, 40, cols[li], state.a * fade * 0.18, 1);
      }
    });
  });
}
