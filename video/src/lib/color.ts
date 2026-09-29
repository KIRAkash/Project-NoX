const parse = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/** `#RRGGBB` at an alpha, as an rgba() string. */
export const rgba = (hex: string, a: number) => {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};

/** Mix two `#RRGGBB` colours; t = 0 is a, t = 1 is b. */
export const mixHex = (a: string, b: string, t: number) => {
  const pa = parse(a);
  const pb = parse(b);
  const k = Math.max(0, Math.min(1, t));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

export const lighten = (hex: string, t: number) => mixHex(hex, "#FFFFFF", t);
export const darken = (hex: string, t: number) => mixHex(hex, "#000000", t);
