"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { APPS, MESH, SHELLS } from "@/lib/content";
import { bodyWorld } from "@/lib/orbit-math";
import { hexToHsl, hslToHex } from "@/lib/color";

/*
 * Everything in here lives inside <Canvas>, so it can use R3F's hooks
 * (useFrame, useThree) directly. Two clocks run side by side on purpose:
 * GSAP drives the one-time reveal (camera dolly, planets fading in, particles
 * settling), played once by the parent against real object refs it holds;
 * R3F's own useFrame drives what never stops — orbital motion, particle
 * drift, the corona's breathing, and (once arrived) the visitor's own drag —
 * exactly the split the SVG hero uses, for the same reason: a one-time story
 * and an ambient loop are different jobs.
 */

export const SUN_R = 22;

/** The application the "sources" beat flies in to — mid-orbit, so its neighbours and the sun stay in frame. */
export const FOCUS_APP = "refunds";

/** The focused application's knowledge sources, drawn as its moons. */
const SOURCES = [
  { name: "GitHub", what: "code", hue: "#E6EAF4", day: "#3A3446" },
  { name: "Jira", what: "tickets", hue: "#F7B542" },
  { name: "Confluence", what: "decisions", hue: "#5FCBD8" },
  { name: "Slack", what: "threads", hue: "#EC8FC2" },
  { name: "Notion", what: "specs", hue: "#A897F0" },
];

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
export const CAM_START_Z = 11; // inside the corona, particles close on every side
export const CAM_REST_Z = 560; // the full estate, comfortably in frame

// The whole orbital assembly tilts as one rigid body, rather than sitting
// dead level to the camera — the same jaunty, "looking down at an angle"
// composition the SVG hero uses, just as a real rotation instead of a 2D
// transform. This is the REST pose; a visitor's drag and the slow ambient
// spin both add a further yaw/pitch on top of it (see `RotationDrive`).
const SYSTEM_TILT: [number, number, number] = [0.3, 0, -0.13];

// Rings and planets only — never the star, which must stay at the world
// origin so it (and the wordmark anchored to its real projected position)
// stays exactly screen-centred within whatever panel the scene is docked to.
const RING_LIFT_Y = 27;

// Orbits are scaled up only for this scene, not in lib/content.ts, so the
// main hero's SVG diagram (which shares that data) is untouched.
const ORBIT_SCALE = 1.2;

const PARTICLE_COUNT = 3200;

// White through gold only — no cool or orange-red flecks.
const EMBER_PALETTE = ["#FFFFFF", "#FFF8E7", "#FFEFC2", "#FFDD82", "#F7B542"];
// Daylight: the same field as fine ink and amber dust on parchment.
const DUST_PALETTE = ["#2E2838", "#4A4058", "#6B5E70", "#C2531B", "#B9781A"];

/*
 * Light theme. Additive glow and bloom only work against black, so on parchment
 * the scene renders as a daylight star chart instead: normal blending, ink dust
 * for embers, a solid limb-shaded sun with a soft amber halo, ink orbit rings,
 * and contract lines in deep blue. Every component takes `light` and picks its
 * materials from it; nothing else about the choreography changes.
 */
const blendFor = (light: boolean) => (light ? THREE.NormalBlending : THREE.AdditiveBlending);

/**
 * A vertical multi-stop gradient, 8×N px. Mapped onto a sphere's default
 * equirectangular UVs this reads as latitude bands wrapping the body — the
 * technically correct way to put a "complex gradient" on a UV sphere (a 2D
 * radial texture would instead warp into a pinched blob near the poles).
 * Combined with the scene's real point light, a body gets both true lit/dark
 * shading AND colour variation across its surface, instead of one flat hue.
 */
function bandTexture(stops: string[]): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, size);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function planetBandStops(hue: string): string[] {
  // The same pale/light/base/dark/base/light/pale structure as the sun's own
  // gradient (SUN_BAND_STOPS), just in each planet's own hue — a "different
  // kind of gradient" per planet, but built the way the star's is. Planets
  // render small and the star is also the only light in the scene, lighting
  // mostly the hemisphere already facing the camera — so this needs more
  // contrast than the sun's own gradient just to still read as a gradient
  // at that size, rather than one blended-together tone.
  const { h, s, l } = hexToHsl(hue);
  const pale = hslToHex(h, s * 0.45, Math.min(0.97, l * 2.0));
  const light = hslToHex(h, s * 0.8, Math.min(0.92, l * 1.4));
  const base = hslToHex(h, s * 1.1, l);
  const dark = hslToHex(h, s * 0.95, Math.max(0.05, l * 0.3));
  return [pale, light, base, dark, base, light, pale];
}

const SUN_BAND_STOPS = ["#FFF7E2", "#FFE1A0", "#F7B542", "#E9713C", "#F7B542", "#FFE9B8", "#FFF7E2"];

/**
 * A soft radial-alpha texture for a camera-facing sprite — the correct tool
 * for a glow that truly fades to nothing at the edge (a flat-shaded sphere,
 * which is what this replaces, has a uniform alpha and so a hard silhouette
 * no matter how translucent it is).
 */
function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const PARTICLE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  varying vec3 vColor;
  varying float vSeed;
  varying float vPx;
  void main() {
    vColor = color;
    vSeed = aSeed;
    vec3 pos = position;
    // Gentle per-particle drift — a slow, organic float, never a straight line.
    pos.x += sin(uTime * 0.22 + aSeed * 12.9) * 1.6;
    pos.y += cos(uTime * 0.18 + aSeed * 7.3) * 1.6;
    pos.z += sin(uTime * 0.15 + aSeed * 4.1) * 1.6;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (340.0 / -mvPosition.z);
    vPx = gl_PointSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vSeed;
  uniform float uTime;
  uniform float uGain;
  uniform float uAlpha;
  uniform float uNearFade;
  varying float vPx;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    float twinkle = 0.72 + 0.28 * sin(uTime * 2.2 + vSeed * 18.0);
    // In daylight a mote right in front of the camera is a blurry smudge, not a glow: fade the big ones.
    float near = mix(1.0, clamp(14.0 / max(vPx, 1.0), 0.0, 1.0), uNearFade);
    gl_FragColor = vec4(vColor * (uGain * twinkle), glow * glow * uAlpha * near);
  }
`;

/** The glowing embers the camera starts inside of and dollies through — a
 *  dense core near the star, thinning into a long tail that reaches well
 *  past the rest camera's frustum, so the field still spans the frame once
 *  the dolly settles instead of shrinking to a clump at screen centre. */
function ParticleField({ settleRef, light }: { settleRef: React.MutableRefObject<number>; light: boolean }) {
  const points = useRef<THREE.Points>(null);
  const material = useRef<THREE.ShaderMaterial>(null);

  const [positions, colors, dust, sizes, seeds] = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const col = new Float32Array(PARTICLE_COUNT * 3);
    const ink = new Float32Array(PARTICLE_COUNT * 3);
    const size = new Float32Array(PARTICLE_COUNT);
    const seed = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // A steep inner bias (dense corona at start) with a long outer tail
      // (fills a widescreen frame at CAM_REST_Z, whose half-width there is
      // on the order of several hundred units) — realistic star-field falloff.
      const r = 6 + Math.pow(Math.random(), 1.7) * 720;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      const pick = Math.floor(Math.random() * EMBER_PALETTE.length);
      const c = new THREE.Color(EMBER_PALETTE[pick]);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      const d = new THREE.Color(DUST_PALETTE[pick]);
      ink[i * 3] = d.r;
      ink[i * 3 + 1] = d.g;
      ink[i * 3 + 2] = d.b;
      // Distant particles read as pinpoint stars, not blobs.
      size[i] = r < 120 ? 1.6 + Math.random() * 3.6 : 0.7 + Math.random() * 1.6;
      seed[i] = Math.random() * 100;
    }
    return [pos, col, ink, size, seed];
  }, []);

  useFrame((state) => {
    if (material.current) {
      material.current.uniforms.uTime.value = state.clock.elapsedTime;
      // Recedes to a faint ambient sparkle once the dolly settles, rather
      // than vanishing outright — the estate should still feel inhabited.
      material.current.opacity = THREE.MathUtils.lerp(1, 0.45, settleRef.current);
      material.current.uniforms.uGain.value = light ? 1 : 1.4;
      material.current.uniforms.uAlpha.value = light ? THREE.MathUtils.lerp(0.7, 0.85, settleRef.current) : 1;
      material.current.uniforms.uNearFade.value = light ? 1 : 0;
    }
    if (points.current) {
      points.current.rotation.y = state.clock.elapsedTime * 0.012;
    }
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute key={light ? "dust" : "embers"} attach="attributes-color" args={[light ? dust : colors, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={material}
        vertexColors
        transparent
        depthWrite={false}
        blending={blendFor(light)}
        vertexShader={PARTICLE_VERTEX}
        fragmentShader={PARTICLE_FRAGMENT}
        uniforms={{ uTime: { value: 0 }, uGain: { value: 1.4 }, uAlpha: { value: 1 }, uNearFade: { value: 0 } }}
      />
    </points>
  );
}

/** Daylight sun surface: a limb-darkened disc (pale centre, ember rim) from
 *  the view angle, so the star reads as a solid sun without bloom behind it. */
const SUN_DAY_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const SUN_DAY_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    vec3 rim = vec3(0.86, 0.38, 0.16);
    vec3 mid = vec3(0.97, 0.66, 0.24);
    vec3 core = vec3(1.0, 0.93, 0.74);
    vec3 c = mix(rim, mid, smoothstep(0.0, 0.45, f));
    c = mix(c, core, smoothstep(0.45, 1.0, f));
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** The star: a banded-gradient core (never a flat fill) plus two layered,
 *  camera-facing glow sprites that truly fade to nothing at their edge —
 *  the corona is no longer a uniform, hard-edged sphere silhouette. */
function Star({ light }: { light: boolean }) {
  const innerGlow = useRef<THREE.Sprite>(null);
  const outerGlow = useRef<THREE.Sprite>(null);

  const sunTexture = useMemo(() => bandTexture(SUN_BAND_STOPS), []);
  const innerGlowTex = useMemo(
    () =>
      glowTexture([
        [0, "rgba(255,246,222,0.95)"],
        [0.28, "rgba(255,225,160,0.55)"],
        [0.6, "rgba(247,181,66,0.22)"],
        [1, "rgba(247,181,66,0)"],
      ]),
    [],
  );
  const outerGlowTex = useMemo(
    () =>
      glowTexture([
        [0, "rgba(247,181,66,0.32)"],
        [0.4, "rgba(233,113,60,0.14)"],
        [0.75, "rgba(233,113,60,0.045)"],
        [1, "rgba(233,113,60,0)"],
      ]),
    [],
  );
  // Daylight halo: painted over parchment, so it carries its own colour rather than adding light.
  const dayInnerTex = useMemo(
    () =>
      glowTexture([
        [0, "rgba(255,214,140,0.9)"],
        [0.3, "rgba(247,181,66,0.5)"],
        [0.62, "rgba(233,113,60,0.14)"],
        [1, "rgba(233,113,60,0)"],
      ]),
    [],
  );
  const dayOuterTex = useMemo(
    () =>
      glowTexture([
        [0, "rgba(247,181,66,0.24)"],
        [0.45, "rgba(233,113,60,0.08)"],
        [0.8, "rgba(233,113,60,0.02)"],
        [1, "rgba(233,113,60,0)"],
      ]),
    [],
  );

  useFrame((state) => {
    const breathe = 1 + Math.sin(state.clock.elapsedTime * 0.7) * 0.06;
    innerGlow.current?.scale.set(SUN_R * 4.4 * breathe, SUN_R * 4.4 * breathe, 1);
    outerGlow.current?.scale.set(SUN_R * 9.5 * (2 - breathe), SUN_R * 9.5 * (2 - breathe), 1);
  });

  return (
    <group>
      <sprite ref={outerGlow} scale={[SUN_R * 9.5, SUN_R * 9.5, 1]}>
        <spriteMaterial
          map={light ? dayOuterTex : outerGlowTex}
          transparent
          depthWrite={false}
          blending={blendFor(light)}
          toneMapped={false}
        />
      </sprite>
      <sprite ref={innerGlow} scale={[SUN_R * 4.4, SUN_R * 4.4, 1]}>
        <spriteMaterial
          map={light ? dayInnerTex : innerGlowTex}
          transparent
          depthWrite={false}
          blending={blendFor(light)}
          toneMapped={false}
        />
      </sprite>
      <mesh>
        <sphereGeometry args={[SUN_R, 48, 48]} />
        {light ? (
          <shaderMaterial key="day" vertexShader={SUN_DAY_VERTEX} fragmentShader={SUN_DAY_FRAGMENT} toneMapped={false} />
        ) : (
          <meshBasicMaterial key="night" map={sunTexture} color="#ffffff" toneMapped={false} />
        )}
      </mesh>
      <pointLight color="#FFDFA6" intensity={420} distance={0} decay={2} />
    </group>
  );
}

/** How far the whole star system — sun, planets, AND the particle field's
 *  own dense core, which is built to sit right around the star — sits from
 *  world origin. Tweened by the parent so the estate can visually lean
 *  toward one side of the frame without ever cropping or resizing the
 *  canvas itself. The camera always keeps looking at true origin (see
 *  AmbientCamera below), so an offset here is what actually produces the
 *  "docked" look: the star renders off-centre because it *is* off-centre,
 *  not because the viewport was cropped around it. The CSS starfield behind
 *  everything (see globals.css) is what keeps the text panel from ever
 *  looking empty — it never moves, so it doesn't need to. */
export type SystemOffset = { x: number; y: number };

function SystemGroup({
  offsetRef,
  scaleRef,
  children,
}: {
  offsetRef: React.MutableRefObject<SystemOffset>;
  /** 1 = full size, tweened toward ~0 for the "estate shrinks away and
   *  vanishes" handoff into the relay beat — a single scale on the shared
   *  parent shrinks the star, particles, planets, rings and connections all
   *  together as one rigid body, the same way the offset moves them all
   *  together, rather than animating each piece's own size separately. */
  scaleRef: React.MutableRefObject<number>;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.position.set(offsetRef.current.x, offsetRef.current.y, 0);
      ref.current.scale.setScalar(scaleRef.current);
      // Scale alone can leave a faint residual glow once fully shrunk: the
      // additive glow sprites can still rasterize a sub-pixel at near-zero
      // size that Bloom's blur radius smears into a visible dot, and the
      // sun's point light's *intensity* isn't reduced by parent scale at
      // all (only its position collapses toward origin). Pulling the whole
      // group out of the render entirely at that point is the only way to
      // be sure nothing — mesh, sprite, or light — still contributes.
      ref.current.visible = scaleRef.current > 0.001;
    }
  });
  return <group ref={ref}>{children}</group>;
}

type PlanetRef = {
  mesh: THREE.Mesh;
  glow: THREE.Sprite | null;
  labelAnchor: THREE.Group | null;
  labelEl: HTMLSpanElement | null;
  reveal: { current: number };
};

/** Live contract mesh between applications — deliberately a different line
 *  language from the orbit rings (dashed and faint, where the rings are
 *  solid and bold) so the two kinds of line are never ambiguous: an orbit
 *  is a fixed path a body travels; a contract is a relationship drawn
 *  between two bodies that happen to be somewhere on their own paths right
 *  now. The same pairs and the same "faint always, bright and singled-out
 *  on focus" treatment as the SVG hero's diagram, just recomputed every
 *  frame in world space instead of projected to a 2D path. A plain
 *  `THREE.Line` per pair, geometry rewritten each frame, mounted via
 *  `<primitive>` for the same reason the orbit rings are (see below) —
 *  `<line>` collides with React's own SVG intrinsic in this JSX namespace. */
// dashSize + gapSize for every connection's material below — kept as one
// constant so the running-dash offset (see useFrame) wraps against exactly
// the pattern length it's animating.
const DASH_SIZE = 1.6;
const GAP_SIZE = 3.2;
const DASH_TOTAL = DASH_SIZE + GAP_SIZE;
const DASH_SPEED = 3.4; // pattern-units per second, i.e. how fast current "flows"

// Screen-space, in pixels — real width via Line2/LineMaterial (fat lines),
// since a plain THREE.Line ignores its `linewidth` on core WebGL profiles
// and always renders at ~1px regardless of what's asked for. Doubled from
// that effective ~1px baseline.
const CONNECTION_WIDTH_PX = 2;

/** Live contract mesh between applications — deliberately a different line
 *  language from the orbit rings (dashed and faint, where the rings are
 *  solid and bold) so the two kinds of line are never ambiguous: an orbit
 *  is a fixed path a body travels; a contract is a relationship drawn
 *  between two bodies that happen to be somewhere on their own paths right
 *  now. The same pairs and the same "faint always, bright and singled-out
 *  on focus" treatment as the SVG hero's diagram, just recomputed every
 *  frame in world space instead of projected to a 2D path. Built on Line2 /
 *  LineMaterial (three's "fat lines" addon) rather than a plain THREE.Line,
 *  so the width is real and controllable instead of pinned to ~1px, and so
 *  the dash pattern can be offset every frame for a "current flowing along
 *  the wire" read instead of sitting static. */
function Connections({
  planetRefs,
  hoverRef,
  rotRef,
  mapRevealRef,
  light,
}: {
  planetRefs: React.MutableRefObject<Map<string, PlanetRef>>;
  hoverRef: React.MutableRefObject<string | null>;
  rotRef: React.MutableRefObject<RotationDrive>;
  mapRevealRef: React.MutableRefObject<number>;
  light: boolean;
}) {
  const { size } = useThree();

  const lines = useMemo(
    () =>
      MESH.map(() => {
        const geometry = new LineGeometry();
        geometry.setPositions([0, 0, 0, 0, 0, 0]);
        const material = new LineMaterial({
          color: 0x86b9ee,
          transparent: true,
          opacity: 0.06,
          linewidth: CONNECTION_WIDTH_PX,
          dashed: true,
          dashSize: DASH_SIZE,
          gapSize: GAP_SIZE,
          // Additive so the lines actually bloom once they brighten toward
          // white below, instead of just becoming a more opaque flat tint.
          blending: THREE.AdditiveBlending,
        });
        const line = new Line2(geometry, material);
        line.computeLineDistances();
        return line;
      }),
    [],
  );
  const baseColor = useMemo(() => new THREE.Color("#86B9EE"), []);
  const revealGlowColor = useMemo(() => new THREE.Color("#F2F8FF"), []);
  const focusColor = useMemo(() => new THREE.Color("#F7B542"), []);
  // daylight: ink-blue wires that deepen as the map reveals, ember on focus
  const dayBase = useMemo(() => new THREE.Color("#3F78B5"), []);
  const dayReveal = useMemo(() => new THREE.Color("#1F4F86"), []);
  const dayFocus = useMemo(() => new THREE.Color("#C2531B"), []);

  useEffect(() => {
    lines.forEach((line) => {
      const mat = line.material as LineMaterial;
      mat.blending = blendFor(light);
      mat.needsUpdate = true;
    });
  }, [lines, light]);

  // `linewidth` above is in screen pixels, which LineMaterial converts using
  // this — without it every line renders at the wrong (usually invisible)
  // width. Kept in sync with the canvas's actual size, not just set once.
  useEffect(() => {
    lines.forEach((line) => (line.material as LineMaterial).resolution.set(size.width, size.height));
  }, [lines, size]);

  useFrame((state) => {
    const focus = rotRef.current.dragging ? null : hoverRef.current;
    // Real dash-offset support, rather than hand-shifting a distance
    // attribute — the pattern reads as continuously marching from one
    // planet toward the other.
    const dashOffset = -((state.clock.elapsedTime * DASH_SPEED) % DASH_TOTAL);
    MESH.forEach(([aId, bId], i) => {
      const a = planetRefs.current.get(aId);
      const b = planetRefs.current.get(bId);
      const line = lines[i];
      if (!a?.mesh || !b?.mesh) return;

      const geometry = line.geometry as LineGeometry;
      geometry.setPositions([
        a.mesh.position.x,
        a.mesh.position.y,
        a.mesh.position.z,
        b.mesh.position.x,
        b.mesh.position.y,
        b.mesh.position.z,
      ]);
      line.computeLineDistances();

      const lit = focus === aId || focus === bId;
      const mat = line.material as LineMaterial;
      mat.dashOffset = dashOffset;
      if (!focus) {
        // Blended toward fully visible AND brightened toward white as the
        // visitor scrolls through the "map" beat — the whole point there is
        // showing every connection at once, and making them read as newly
        // lit-up rather than just a flat tint fading in, not waiting for a
        // hover to prove any one of them exists. Color values are pushed
        // past 1.0 (valid for an additive-blended, tone-mapped-off material)
        // so the brightening is a genuine glow Bloom picks up, not just a
        // more-opaque tint — doubled in intensity at full reveal.
        const reveal = mapRevealRef.current;
        if (light) {
          mat.color.copy(dayBase).lerp(dayReveal, reveal);
          mat.opacity = THREE.MathUtils.lerp(0.14, 0.75, reveal);
        } else {
          mat.color.copy(baseColor).lerp(revealGlowColor, reveal).multiplyScalar(1 + reveal);
          mat.opacity = THREE.MathUtils.lerp(0.06, 0.7, reveal);
        }
      } else if (lit) {
        // Doubled glow on hover focus, the same way.
        if (light) mat.color.copy(dayFocus);
        else mat.color.copy(focusColor).multiplyScalar(2);
        mat.opacity = light ? 0.9 : 0.8;
      } else {
        mat.color.copy(light ? dayBase : baseColor);
        mat.opacity = light ? 0.05 : 0.02;
      }
    });
  });

  return (
    <>
      {lines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </>
  );
}

export type RotationDrive = {
  /** Extra yaw/pitch layered on top of SYSTEM_TILT — driven by drag + ambient spin. */
  yaw: number;
  pitch: number;
  vYaw: number;
  vPitch: number;
  /** True while the visitor's pointer is actively dragging the system. */
  dragging: boolean;
};

/** Eases the estate into a tighter, more legible composition once docked
 *  into its own panel — orbits pull in and bodies grow, so the same eight
 *  applications read clearly in roughly half the screen real estate instead
 *  of looking sparse. Tweened by GSAP in the parent alongside the docking
 *  transition itself. */
export type LayoutDrive = {
  orbit: number;
  planet: number;
};

/** The estate: eight bodies on their real orbits, each with a banded surface
 *  gradient instead of a flat fill, plus one ring per shell — all tilted
 *  together as a single rigid assembly that can also be spun by the visitor
 *  once `interactive` is true. */
function Planets({
  planetRefs,
  rotRef,
  hoverRef,
  layoutRef,
  scaleRef,
  mapRevealRef,
  focusRef,
  showLabels,
  interactive,
  light,
}: {
  planetRefs: React.MutableRefObject<Map<string, PlanetRef>>;
  rotRef: React.MutableRefObject<RotationDrive>;
  hoverRef: React.MutableRefObject<string | null>;
  layoutRef: React.MutableRefObject<LayoutDrive>;
  scaleRef: React.MutableRefObject<number>;
  mapRevealRef: React.MutableRefObject<number>;
  focusRef: React.MutableRefObject<number>;
  showLabels: boolean;
  interactive: boolean;
  light: boolean;
}) {
  const t = useRef(0);
  const groupRef = useRef<THREE.Group>(null);
  const ringsGroupRef = useRef<THREE.Group>(null);

  const textures = useMemo(() => {
    const m = new Map<string, THREE.CanvasTexture>();
    for (const app of APPS) m.set(app.id, bandTexture(planetBandStops(app.hue)));
    return m;
  }, []);

  // A small, subtle halo per planet — its own hue, tight falloff, well below
  // the sun's glow in both size and opacity ("a little glow, not a lot").
  const glowTextures = useMemo(() => {
    const m = new Map<string, THREE.CanvasTexture>();
    for (const app of APPS) {
      const { h, s, l } = hexToHsl(app.hue);
      const bright = hslToHex(h, s, Math.min(0.85, l * 1.2));
      m.set(
        app.id,
        glowTexture([
          [0, `${bright}55`],
          [0.45, `${bright}22`],
          [1, `${bright}00`],
        ]),
      );
    }
    return m;
  }, []);

  // Who each application holds a contract with, precomputed once — the same
  // "focus and its neighbours" set the SVG hero highlights on hover.
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const app of APPS) m.set(app.id, new Set());
    for (const [a, b] of MESH) {
      m.get(a)?.add(b);
      m.get(b)?.add(a);
    }
    return m;
  }, []);

  useFrame((_, delta) => {
    t.current += delta;

    // Ambient spin, always running, plus whatever the visitor's drag added —
    // matching the SVG hero's own "inertia, then a slow idle drift" feel.
    const r = rotRef.current;
    if (!r.dragging) {
      r.yaw += r.vYaw;
      // Wide enough to hold the ~45° rest tilt the docking transition itself
      // lands on without an immediate drag clamping it back down.
      r.pitch = THREE.MathUtils.clamp(r.pitch + r.vPitch, -0.55, 0.95);
      r.vYaw *= 0.94;
      r.vPitch *= 0.9;
      if (Math.abs(r.vYaw) < 0.0004) r.vYaw = 0;
      if (interactive) r.yaw += delta * 0.05;
    }
    const layout = layoutRef.current;
    if (groupRef.current) {
      groupRef.current.rotation.set(SYSTEM_TILT[0] + r.pitch, SYSTEM_TILT[1] + r.yaw, SYSTEM_TILT[2]);
      groupRef.current.position.y = RING_LIFT_Y * layout.orbit;
    }
    if (ringsGroupRef.current) {
      ringsGroupRef.current.scale.setScalar(layout.orbit);
    }

    const focus = interactive && !r.dragging ? hoverRef.current : null;

    for (const app of APPS) {
      const entry = planetRefs.current.get(app.id);
      if (!entry || !entry.mesh) continue;
      // The outer shell's real period (118s) is accurate but reads as
      // motionless over the short time anyone actually watches this scene —
      // especially now that `layout.orbit` compresses its radius further
      // once arrived, shrinking the same angular speed into even fewer
      // screen pixels. Sped up here, in the presentation layer only, so the
      // shared orbital data (also used for the SVG diagram's own realistic
      // pacing) never has to change.
      const speed = app.orbit.a > 250 ? 1.8 : 1;
      const w = bodyWorld(app.orbit, t.current * speed);
      const px = w.wx * ORBIT_SCALE * layout.orbit;
      const py = w.wy * ORBIT_SCALE * layout.orbit;
      const pz = w.wz * ORBIT_SCALE * layout.orbit;
      entry.mesh.position.set(px, py, pz);
      const reveal = entry.reveal.current;
      const zoom = smooth(focusRef.current);
      const isHero = app.id === FOCUS_APP;
      // the focused application grows into the hero of the "sources" beat
      const bodyScale = app.orbit.size * 0.408 * reveal * layout.planet * (isHero ? 1 + 1.6 * zoom : 1); // 0.34 * 1.2
      entry.mesh.scale.setScalar(bodyScale);
      const mat = entry.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = reveal;

      const isFocus = app.id === focus;
      const related = !focus || isFocus || (neighbours.get(app.id)?.has(focus) ?? false);
      const dim = focus && !related ? 0.28 : 1;

      if (entry.glow) {
        entry.glow.position.set(px, py, pz);
        const glowSize = bodyScale * (isFocus ? 4.2 : 3.1);
        entry.glow.scale.set(glowSize, glowSize, 1);
        (entry.glow.material as THREE.SpriteMaterial).opacity = reveal * (isFocus ? 1 : 0.8) * dim * (light ? 0.6 : 1);
      }
      if (entry.labelAnchor) {
        entry.labelAnchor.position.set(px, py + bodyScale + 3.4, pz);
      }
      if (entry.labelEl) {
        // As the whole estate shrinks toward the relay handoff, every label
        // anchor converges toward the same collapsing point on screen —
        // without this, the (otherwise scale-independent) HTML labels would
        // keep sitting there at full opacity, reading as a stray leftover
        // word rather than actually vanishing with everything else.
        const shrinkFade = Math.min(1, scaleRef.current * 20);
        // while zoomed in, the hero's own name moves to its knowledge-base label; the rest step back
        const zoomFade = isHero ? 1 - zoom : 1 - 0.45 * zoom;
        entry.labelEl.style.opacity = (reveal * dim * shrinkFade * zoomFade).toFixed(3);
        entry.labelEl.style.color = isFocus ? "var(--ink)" : "";
        entry.labelEl.style.background = isFocus ? "rgba(247,181,66,.16)" : "";
      }
    }
  });

  // `<line>` collides with React's own SVG intrinsic in this JSX namespace,
  // so the ring is built as a real THREE.Line and mounted via <primitive>.
  const rings = useMemo(
    () =>
      SHELLS.map((shell) => {
        const pts: THREE.Vector3[] = [];
        const a = shell.a * ORBIT_SCALE;
        const ci = Math.cos(shell.incl);
        const si = Math.sin(shell.incl);
        for (let i = 0; i <= 128; i++) {
          const th = (i / 128) * Math.PI * 2;
          const pz = a * Math.sin(th);
          pts.push(new THREE.Vector3(a * Math.cos(th), -pz * si, pz * ci));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(pts);
        // Solid, unlike the (dashed) contract lines — an orbit is
        // structural, not a relationship — but kept light and low-contrast
        // so it recedes into the scene rather than competing with the
        // contract lines for attention once those brighten up on reveal.
        const material = new THREE.LineBasicMaterial({ color: "#C6D0E8", transparent: true, opacity: 0.22 });
        return new THREE.Line(geometry, material);
      }),
    [],
  );

  useEffect(() => {
    rings.forEach((ring) => {
      const mat = ring.material as THREE.LineBasicMaterial;
      mat.color.set(light ? "#4A4058" : "#C6D0E8");
      mat.opacity = light ? 0.3 : 0.22;
    });
  }, [rings, light]);

  // All refs for one app merge into the same map entry defensively, since
  // which of several sibling refs fires first is not guaranteed — each
  // keeps whatever the others have already set, including the shared
  // `reveal` object GSAP tweens by reference.
  const patch = (id: string, part: Partial<PlanetRef>) => {
    const prev = planetRefs.current.get(id);
    planetRefs.current.set(id, {
      mesh: prev?.mesh ?? null!,
      glow: prev?.glow ?? null,
      labelAnchor: prev?.labelAnchor ?? null,
      labelEl: prev?.labelEl ?? null,
      reveal: prev?.reveal ?? { current: 0 },
      ...part,
    });
  };

  return (
    <group ref={groupRef} position={[0, RING_LIFT_Y, 0]} rotation={SYSTEM_TILT}>
      {/* Rings live in their own scaled sub-group — `layout.orbit` shrinks
          this uniformly, while the bodies (in the parent group's space)
          shrink their own orbit radius directly, so both stay in step
          without recomputing the rings' geometry every frame. */}
      <group ref={ringsGroupRef}>
        {rings.map((ring, i) => (
          <primitive key={i} object={ring} />
        ))}
      </group>
      {/* Held back until arrival — the one-time reveal is meant to read as a
          pure graphic moment, not the estate's contract diagram. */}
      {showLabels && (
        <Connections planetRefs={planetRefs} hoverRef={hoverRef} rotRef={rotRef} mapRevealRef={mapRevealRef} light={light} />
      )}
      {APPS.map((app) => (
        <group key={app.id}>
          <sprite ref={(sprite) => patch(app.id, { glow: sprite })}>
            <spriteMaterial
              map={glowTextures.get(app.id)}
              transparent
              depthWrite={false}
              blending={blendFor(light)}
              opacity={0}
              toneMapped={false}
            />
          </sprite>
          <mesh
            ref={(mesh) => {
              if (mesh) patch(app.id, { mesh });
            }}
            onPointerOver={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              hoverRef.current = app.id;
            }}
            onPointerOut={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              if (hoverRef.current === app.id) hoverRef.current = null;
            }}
          >
            <sphereGeometry args={[1, 28, 28]} />
            <meshStandardMaterial
              map={textures.get(app.id)}
              color="#ffffff"
              emissiveMap={textures.get(app.id)}
              emissive={app.hue}
              emissiveIntensity={0.55}
              roughness={0.55}
              metalness={0.1}
              transparent
              opacity={0}
            />
            {/* An invisible, generously sized hit target — the visible sphere
                alone is too small to reliably hover once it's rendered a
                handful of pixels across. */}
            <mesh>
              <sphereGeometry args={[2.2, 12, 12]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          </mesh>
          {/* A separate, unscaled anchor for the HTML label — a child of the
              mesh would inherit its (animated, quite small) scale, which
              would shrink or warp the label offset along with the planet. */}
          <group ref={(g) => patch(app.id, { labelAnchor: g })}>
            {showLabels && (
              <Html center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
                <span
                  ref={(el) => patch(app.id, { labelEl: el })}
                  className="whitespace-nowrap rounded-[2px] bg-[rgb(var(--void-rgb)/.62)] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-muted transition-colors duration-150"
                >
                  {app.name}
                </span>
              </Html>
            )}
          </group>
        </group>
      ))}
    </group>
  );
}

/**
 * A slow ambient turn once the dolly has settled, so the scene never sits
 * dead still. The camera always looks exactly at true world origin, full
 * stop — never at wherever the star system has been offset to (see
 * `SystemOffset`). That fixed gaze is what makes an offset star actually
 * render off-centre on screen; if the camera re-aimed at it instead, it
 * would just snap back to the middle of the frame and the "docked" look
 * would disappear. Re-orienting the estate around the visitor happens
 * entirely on the Planets group's own rotation (see RotationDrive), which
 * turns independently of where the whole assembly sits.
 */
function AmbientCamera({
  settleRef,
  focusRef,
  planetRefs,
}: {
  settleRef: React.MutableRefObject<number>;
  focusRef: React.MutableRefObject<number>;
  planetRefs: React.MutableRefObject<Map<string, PlanetRef>>;
}) {
  const { camera, size } = useThree();
  const v = useMemo(
    () => ({ hero: new THREE.Vector3(), look: new THREE.Vector3(), pos: new THREE.Vector3(), rest: new THREE.Vector3(), aim: new THREE.Vector3(), origin: new THREE.Vector3() }),
    [],
  );
  useFrame((state) => {
    const drift = Math.sin(state.clock.elapsedTime * 0.05) * 14;
    if (settleRef.current >= 0.98) camera.position.x = drift;
    const zoom = smooth(focusRef.current);
    const mesh = planetRefs.current.get(FOCUS_APP)?.mesh;
    if (zoom <= 0 || !mesh) {
      camera.lookAt(0, 0, 0);
      return;
    }
    // Fly in to the focused planet and keep following it along its orbit. It is framed off-centre —
    // right of the text panel on wide screens, below it on narrow ones — close enough to be the
    // subject, far enough that its neighbours and the sun's glow stay in the frame.
    mesh.getWorldPosition(v.hero);
    const wide = size.width >= 1024;
    const aspect = size.width / size.height;
    const dist = wide ? 250 : 430;
    const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(25));
    v.look.copy(v.hero);
    if (wide) v.look.x -= 0.17 * visH * aspect;
    else v.look.y += 0.19 * visH;
    v.pos.set(v.look.x, v.look.y + dist * 0.12, v.look.z + dist);
    v.rest.set(drift, 0, CAM_REST_Z);
    camera.position.lerpVectors(v.rest, v.pos, zoom);
    v.aim.lerpVectors(v.origin, v.look, zoom);
    camera.lookAt(v.aim);
  });
  return null;
}

/** A soft ring texture: the knowledge base forming around the focused planet. */
function ringTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.34, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.62, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(255,255,255,0.85)");
  g.addColorStop(0.78, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * The "sources" beat: the focused application's knowledge sources as moons on one tilted orbit,
 * each feeding the planet along a marching line with a packet of light, and a soft ring on the
 * planet — its one knowledge base. Everything is driven by `focusRef` (0 → 1, scroll-scrubbed):
 * the moons appear one after another once the camera has mostly arrived, then the feeds switch on.
 */
function SourceMoons({
  planetRefs,
  focusRef,
  light,
}: {
  planetRefs: React.MutableRefObject<Map<string, PlanetRef>>;
  focusRef: React.MutableRefObject<number>;
  light: boolean;
}) {
  const { size } = useThree();
  const rig = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const kbRing = useRef<THREE.Sprite>(null);
  const kbLabel = useRef<THREE.Group>(null);
  const kbLabelEl = useRef<HTMLDivElement>(null);
  const kbSubEl = useRef<HTMLDivElement>(null);
  const moonRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRefs = useRef<(THREE.Sprite | null)[]>([]);
  const packetRefs = useRef<(THREE.Sprite | null)[]>([]);
  const labelEls = useRef<(HTMLSpanElement | null)[]>([]);
  const v = useMemo(() => ({ hero: new THREE.Vector3(), moon: new THREE.Vector3(), edge: new THREE.Vector3(), scale: new THREE.Vector3(), rim: new THREE.Vector3(), centre: new THREE.Vector3() }), []);

  const glowTex = useMemo(
    () =>
      glowTexture([
        [0, "rgba(255,255,255,0.95)"],
        [0.35, "rgba(255,255,255,0.35)"],
        [1, "rgba(255,255,255,0)"],
      ]),
    [],
  );
  const ringTex = useMemo(() => ringTexture(), []);
  const heroHue = useMemo(() => APPS.find((a) => a.id === FOCUS_APP)?.hue ?? "#86B9EE", []);
  const heroName = useMemo(() => APPS.find((a) => a.id === FOCUS_APP)?.name ?? "", []);

  const orbitLine = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const th = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(th), Math.sin(th), 0));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: "#C6D0E8", transparent: true, opacity: 0, depthWrite: false }),
    );
    return line;
  }, []);

  const feeds = useMemo(
    () =>
      SOURCES.map((src) => {
        const geometry = new LineGeometry();
        geometry.setPositions([0, 0, 0, 0, 0, 0]);
        const material = new LineMaterial({
          color: new THREE.Color(src.hue),
          transparent: true,
          opacity: 0,
          linewidth: 1.6,
          dashed: true,
          dashSize: 1.4,
          gapSize: 2.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const line = new Line2(geometry, material);
        line.computeLineDistances();
        return line;
      }),
    [],
  );
  useEffect(() => {
    feeds.forEach((line) => (line.material as LineMaterial).resolution.set(size.width, size.height));
  }, [feeds, size]);
  // a source's own colour, or its daylight stand-in where the night colour is near-white
  const hueOf = (src: (typeof SOURCES)[number]) => (light && "day" in src && src.day) || src.hue;
  useEffect(() => {
    feeds.forEach((line, i) => {
      const mat = line.material as LineMaterial;
      mat.blending = blendFor(light);
      mat.color.set(hueOf(SOURCES[i]));
      mat.needsUpdate = true;
    });
    (orbitLine.material as THREE.LineBasicMaterial).color.set(light ? "#4A4058" : "#C6D0E8");
  }, [feeds, orbitLine, light]);

  useFrame((state) => {
    const f = focusRef.current;
    const mesh = planetRefs.current.get(FOCUS_APP)?.mesh;
    const g = rig.current;
    if (!g || !mesh) return;
    g.visible = f > 0.02;
    feeds.forEach((line) => (line.visible = g.visible));
    if (!g.visible) {
      if (kbLabelEl.current) kbLabelEl.current.style.opacity = "0";
      labelEls.current.forEach((el) => el && (el.style.opacity = "0"));
      return;
    }
    const time = state.clock.elapsedTime;
    mesh.getWorldPosition(v.hero);
    mesh.getWorldScale(v.scale);
    const planetR = v.scale.x;
    const narrow = size.width < 640;
    const orbitR = Math.max(planetR * (narrow ? 2.6 : 3.2), 1);
    // a more upright ring on phones spreads the moons (and their labels) vertically
    if (tilt.current) tilt.current.rotation.x = narrow ? 0.62 : 1.02;

    g.position.copy(v.hero);
    orbitLine.scale.setScalar(orbitR);
    (orbitLine.material as THREE.LineBasicMaterial).opacity = 0.28 * smooth((f - 0.45) / 0.25);

    const spin = time * 0.09;
    SOURCES.forEach((src, i) => {
      const appear = smooth((f - 0.5 - i * 0.07) / 0.18);
      const feed = smooth((f - 0.78 - i * 0.03) / 0.12);
      const th = spin + (i / SOURCES.length) * Math.PI * 2;
      const moon = moonRefs.current[i];
      if (moon) {
        moon.position.set(Math.cos(th) * orbitR, Math.sin(th) * orbitR, 0);
        moon.scale.setScalar(Math.max(0.0001, planetR * 0.16 * appear));
        (moon.material as THREE.MeshStandardMaterial).opacity = appear;
        moon.getWorldPosition(v.moon);
      }
      const glow = glowRefs.current[i];
      if (glow && moon) {
        glow.position.copy(moon.position);
        const gs = planetR * 0.55 * appear;
        glow.scale.set(gs, gs, 1);
        (glow.material as THREE.SpriteMaterial).opacity = 0.3 * appear;
      }
      const label = labelEls.current[i];
      if (label) {
        label.style.opacity = appear.toFixed(3);
        // beside the moon, on the side away from the planet, so no label ever sits on it
        // phones have no room at the sides: the label sits above the moon instead
        const right = v.moon.x >= v.hero.x;
        label.style.transform = narrow
          ? "translateY(calc(-100% - 6px))"
          : right
            ? "translateX(calc(50% + 12px))"
            : "translateX(calc(-50% - 12px))";
      }

      // the feed: a marching line from the moon to the planet's edge, and a packet of light riding it
      v.edge.copy(v.moon).sub(v.hero).setLength(planetR * 1.05).add(v.hero);
      const line = feeds[i];
      const geometry = line.geometry as LineGeometry;
      geometry.setPositions([v.moon.x, v.moon.y, v.moon.z, v.edge.x, v.edge.y, v.edge.z]);
      line.computeLineDistances();
      const lm = line.material as LineMaterial;
      lm.opacity = 0.7 * feed;
      lm.dashOffset = -((time * 2.6) % 4);

      const packet = packetRefs.current[i];
      if (packet) {
        const p = (time * 0.45 + i * 0.21) % 1;
        packet.position.lerpVectors(v.moon, v.edge, p);
        const ps = planetR * 0.3;
        packet.scale.set(ps, ps, 1);
        (packet.material as THREE.SpriteMaterial).opacity = feed * Math.sin(p * Math.PI);
      }
    });

    const kb = smooth((f - 0.82) / 0.14);
    if (kbRing.current) {
      kbRing.current.position.copy(v.hero);
      const pulse = 1 + Math.sin(time * 2.4) * 0.035;
      const rs = planetR * 2.55 * pulse;
      kbRing.current.scale.set(rs, rs, 1);
      (kbRing.current.material as THREE.SpriteMaterial).opacity = 0.32 * kb;
    }
    if (kbLabel.current) kbLabel.current.position.copy(v.hero);
    const kbEl = kbLabelEl.current;
    if (kbEl) {
      kbEl.style.opacity = kb.toFixed(3);
      // The label sits on the planet, so it's sized from the planet's on-screen diameter:
      // project the centre and a point one radius "up" in screen space, then measure in px.
      const cam = state.camera;
      v.rim.set(0, 1, 0).applyQuaternion(cam.quaternion).multiplyScalar(planetR).add(v.hero).project(cam);
      v.centre.copy(v.hero).project(cam);
      const d = 2 * Math.hypot(((v.rim.x - v.centre.x) * size.width) / 2, ((v.rim.y - v.centre.y) * size.height) / 2);
      kbEl.style.setProperty("--kb-d", `${d.toFixed(1)}px`);
      // too small a disc for the two detail lines: keep just the name
      if (kbSubEl.current) kbSubEl.current.style.display = d < 150 ? "none" : "";
    }
  });

  return (
    <>
      <group ref={rig}>
        {/* the moons' orbit, tilted so it reads as a ring around the planet, not a flat circle */}
        <group ref={tilt} rotation={[1.02, 0, 0.26]}>
          <primitive object={orbitLine} />
          {SOURCES.map((src, i) => (
            <group key={src.name}>
              <sprite ref={(el) => {
                  glowRefs.current[i] = el;
                }}>
                <spriteMaterial map={glowTex} color={hueOf(src)} transparent depthWrite={false} blending={blendFor(light)} opacity={0} toneMapped={false} />
              </sprite>
              <mesh ref={(el) => {
                  moonRefs.current[i] = el;
                }}>
                <sphereGeometry args={[1, 24, 24]} />
                <meshStandardMaterial color={hueOf(src)} emissive={hueOf(src)} emissiveIntensity={0.3} roughness={0.6} transparent opacity={0} />
                <Html center zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
                  <span
                    ref={(el) => {
                  labelEls.current[i] = el;
                }}
                    className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[rgb(var(--line)/.2)] bg-[rgb(var(--void-rgb)/.78)] px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-ink"
                    style={{ opacity: 0 }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: hueOf(src), boxShadow: `0 0 6px ${hueOf(src)}` }} />
                    {src.name}
                    <span className="hidden normal-case tracking-normal text-ink-dim sm:inline">{src.what}</span>
                  </span>
                </Html>
              </mesh>
            </group>
          ))}
        </group>
      </group>
      {feeds.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
      {SOURCES.map((src, i) => (
        <sprite key={src.name} ref={(el) => {
                  packetRefs.current[i] = el;
                }}>
          <spriteMaterial map={glowTex} color={hueOf(src)} transparent depthWrite={false} blending={blendFor(light)} opacity={0} toneMapped={false} />
        </sprite>
      ))}
      <sprite ref={kbRing}>
        <spriteMaterial map={ringTex} color={heroHue} transparent depthWrite={false} blending={blendFor(light)} opacity={0} toneMapped={false} />
      </sprite>
      <group ref={kbLabel}>
        <Html center zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
          {/* Sits on the planet's centre, so it's shadowed rather than boxed to read against the lit sphere. */}
          <div
            ref={kbLabelEl}
            className="flex flex-col items-center whitespace-nowrap text-center"
            style={{ opacity: 0, textShadow: "0 1px 10px rgba(5,6,11,.75), 0 0 2px rgba(5,6,11,.6)" }}
          >
            <span
              className="font-sans font-semibold leading-tight tracking-[-0.01em] text-white"
              style={{ fontSize: "clamp(12px, calc(var(--kb-d, 190px) * 0.1), 24px)" }}
            >
              {heroName}
            </span>
            <div
              ref={kbSubEl}
              className="mt-[0.5em] flex flex-col items-center gap-[0.2em] font-mono"
              style={{ fontSize: "clamp(8px, calc(var(--kb-d, 190px) * 0.048), 10.5px)" }}
            >
              <span className="uppercase tracking-[0.16em] text-white/85">One knowledge base</span>
              <span className="tracking-[0.04em] text-white/65">{SOURCES.length} sources, read continuously</span>
            </div>
          </div>
        </Html>
      </group>
    </>
  );
}

export type SceneHandle = {
  camera: THREE.PerspectiveCamera | null;
  planetRefs: React.MutableRefObject<Map<string, PlanetRef>>;
  settleRef: React.MutableRefObject<number>;
};

export default function ExperienceScene({
  onReady,
  rotRef,
  layoutRef,
  offsetRef,
  scaleRef,
  mapRevealRef,
  focusRef,
  showLabels,
  interactive,
  light = false,
}: {
  onReady: (handle: SceneHandle) => void;
  rotRef: React.MutableRefObject<RotationDrive>;
  layoutRef: React.MutableRefObject<LayoutDrive>;
  offsetRef: React.MutableRefObject<SystemOffset>;
  scaleRef: React.MutableRefObject<number>;
  mapRevealRef: React.MutableRefObject<number>;
  /** 0 → 1: the camera flies in to FOCUS_APP and its knowledge sources appear as moons. */
  focusRef: React.MutableRefObject<number>;
  showLabels: boolean;
  interactive: boolean;
  /** Render the daylight star chart instead of the night sky (the site's light theme). */
  light?: boolean;
}) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null!);
  const planetRefs = useRef(new Map<string, PlanetRef>());
  const settleRef = useRef(0);
  const reported = useRef(false);
  const hoverRef = useRef<string | null>(null);

  useFrame(() => {
    if (!reported.current && cameraRef.current) {
      reported.current = true;
      onReady({ camera: cameraRef.current, planetRefs, settleRef });
    }
  });

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault fov={50} near={0.5} far={4000} position={[0, 0, CAM_START_Z]} />
      {/* in daylight the night sides of the planets lift a little, so they don't read as holes in the paper */}
      <ambientLight intensity={light ? 0.5 : 0.12} />
      <SystemGroup offsetRef={offsetRef} scaleRef={scaleRef}>
        <Star light={light} />
        <ParticleField settleRef={settleRef} light={light} />
        <Planets
          planetRefs={planetRefs}
          rotRef={rotRef}
          hoverRef={hoverRef}
          layoutRef={layoutRef}
          scaleRef={scaleRef}
          mapRevealRef={mapRevealRef}
          focusRef={focusRef}
          showLabels={showLabels}
          interactive={interactive}
          light={light}
        />
      </SystemGroup>
      {showLabels && <SourceMoons planetRefs={planetRefs} focusRef={focusRef} light={light} />}
      <AmbientCamera settleRef={settleRef} focusRef={focusRef} planetRefs={planetRefs} />
      {/* Bloom picks out what is brighter than its surroundings; on parchment that is everything.
          Disabled rather than unmounted, so switching theme keeps the composer's buffers intact. */}
      <EffectComposer enabled={!light}>
        <Bloom mipmapBlur luminanceThreshold={0.22} luminanceSmoothing={0.3} intensity={1.15} radius={0.85} />
      </EffectComposer>
    </>
  );
}
