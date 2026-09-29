/**
 * Minimal hex↔HSL helpers shared by anything that needs to derive shaded
 * variants of an application's identity colour (the "constellation" set).
 */

export function hexToHsl(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number) {
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  h = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  const i = Math.floor(h * 6);
  if (i === 0) [r, g, b] = [c, x, 0];
  else if (i === 1) [r, g, b] = [x, c, 0];
  else if (i === 2) [r, g, b] = [0, c, x];
  else if (i === 3) [r, g, b] = [0, x, c];
  else if (i === 4) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  const byte = (v: number) => Math.min(255, Math.max(0, v));
  return (
    "#" +
    [to255(r), to255(g), to255(b)]
      .map((v) => byte(v).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}
