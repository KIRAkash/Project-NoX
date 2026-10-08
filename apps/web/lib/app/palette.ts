/**
 * Accent colours as CSS variables, so they follow the theme (see the tokens in
 * app/globals.css). Each accent has a fill, for dots, bars and glows, and an
 * `Ink` tone that stays legible as text on either theme's background.
 */
export const C = {
  nox: "var(--nox)",
  noxInk: "var(--nox-ink)",
  ember: "var(--ember)",
  emberInk: "var(--ember-ink)",
  ice: "var(--ice)",
  iceInk: "var(--ice-ink)",
  verify: "var(--verify)",
  verifyInk: "var(--verify-ink)",
  violet: "var(--violet)",
  violetInk: "var(--violet-ink)",
  coral: "var(--coral)",
  coralInk: "var(--coral-ink)",
  skyInk: "var(--sky-ink)",
  ink: "var(--ink)",
  inkMuted: "var(--ink-muted)",
  inkFaint: "var(--ink-faint)",
  inkDim: "var(--ink-dim)",
} as const;

/** `color` at `percent` opacity. Works for hex values and CSS variables alike. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** Any hue, as text: itself on dark, deepened toward ink on parchment so it still reads. */
export function legible(hue: string): string {
  return `color-mix(in srgb, ${hue} var(--hue-text), var(--ink))`;
}
