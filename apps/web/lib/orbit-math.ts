import type { AppNode } from "./content";

export const TAU = Math.PI * 2;

/**
 * World position of a body on its inclined circular orbit at time `t`.
 * Shared between the SVG hero diagram and any other renderer of the same
 * estate (e.g. the Three.js reveal scene), so the two never drift apart.
 * The Y axis is "up"; the orbital plane is the XZ plane before `incl` tilts it.
 */
export function bodyWorld(o: AppNode["orbit"], t: number) {
  const th = o.phase + (TAU * t) / o.period;
  const pz = o.a * Math.sin(th);
  const ci = Math.cos(o.incl);
  const si = Math.sin(o.incl);
  return { wx: o.a * Math.cos(th), wy: -pz * si, wz: pz * ci, theta: th };
}
