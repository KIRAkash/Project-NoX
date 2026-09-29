/*
 * A few lines of 3D so orbits, meshes and star fields have real depth
 * without a WebGL canvas: rotate points, then project them onto the frame.
 */

export type V3 = { x: number; y: number; z: number };

export const rotX = (p: V3, a: number): V3 => ({
  x: p.x,
  y: p.y * Math.cos(a) - p.z * Math.sin(a),
  z: p.y * Math.sin(a) + p.z * Math.cos(a),
});

export const rotY = (p: V3, a: number): V3 => ({
  x: p.x * Math.cos(a) + p.z * Math.sin(a),
  y: p.y,
  z: -p.x * Math.sin(a) + p.z * Math.cos(a),
});

export const rotZ = (p: V3, a: number): V3 => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
  z: p.z,
});

export type Projected = { x: number; y: number; scale: number; z: number };

/** Perspective projection: z grows away from the viewer. */
export const project = (p: V3, cx: number, cy: number, focal = 1400): Projected => {
  const scale = focal / (focal + p.z);
  return { x: cx + p.x * scale, y: cy + p.y * scale, scale, z: p.z };
};

/** A point on a circular orbit of radius a, tilted by incl, seen from yaw/pitch. */
export const orbitPoint = (a: number, angle: number, incl: number, yaw: number, pitch: number): V3 => {
  let p: V3 = { x: Math.cos(angle) * a, y: 0, z: Math.sin(angle) * a };
  p = rotZ(p, incl);
  p = rotY(p, yaw);
  p = rotX(p, pitch);
  return p;
};
