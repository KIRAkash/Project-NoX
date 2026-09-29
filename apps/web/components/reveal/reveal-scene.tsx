"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { APPS, SHELLS } from "@/lib/content";
import { bodyWorld } from "@/lib/orbit-math";
import { hexToHsl, hslToHex } from "@/lib/color";

/*
 * Everything in here lives inside <Canvas>, so it can use R3F's hooks
 * (useFrame, useThree) directly. Two clocks run side by side on purpose:
 * GSAP drives the one-time reveal (camera dolly, planets fading in, particles
 * settling), played once by the parent against real object refs it holds;
 * R3F's own useFrame drives what never stops — orbital motion, particle
 * drift, the corona's breathing — exactly the split the SVG hero uses, for
 * the same reason: a one-time story and an ambient loop are different jobs.
 */

export const SUN_R = 22;
export const CAM_START_Z = 11; // inside the corona, particles close on every side
export const CAM_REST_Z = 560; // the full estate, comfortably in frame

// The whole orbital assembly tilts as one rigid body, rather than sitting
// dead level to the camera — the same jaunty, "looking down at an angle"
// composition the SVG hero uses, just as a real rotation instead of a 2D
// transform.
const SYSTEM_TILT: [number, number, number] = [0.3, 0, -0.13];

// Rings and planets only — never the star, which must stay at the world
// origin so it (and the wordmark anchored to its real projected position)
// stays exactly screen-centred. This is a plain world-space lift, so the
// rings can sit higher in frame regardless of where the camera looks; it is
// fine for a planet to pass in front of the wordmark near the top of its
// orbit.
const RING_LIFT_Y = 27;

// Orbits are scaled up only for this scene, not in lib/content.ts, so the
// main hero's SVG diagram (which shares that data) is untouched.
const ORBIT_SCALE = 1.2;

const PARTICLE_COUNT = 3200;

// White through gold only — no cool or orange-red flecks.
const EMBER_PALETTE = ["#FFFFFF", "#FFF8E7", "#FFEFC2", "#FFDD82", "#F7B542"];

function particleColor() {
  const hex = EMBER_PALETTE[Math.floor(Math.random() * EMBER_PALETTE.length)];
  return new THREE.Color(hex);
}

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
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vSeed;
  uniform float uTime;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    float twinkle = 0.72 + 0.28 * sin(uTime * 2.2 + vSeed * 18.0);
    gl_FragColor = vec4(vColor * (1.4 * twinkle), glow * glow);
  }
`;

/** The glowing embers the camera starts inside of and dollies through — a
 *  dense core near the star, thinning into a long tail that reaches well
 *  past the rest camera's frustum, so the field still spans the frame once
 *  the dolly settles instead of shrinking to a clump at screen centre. */
function ParticleField({ settleRef }: { settleRef: React.MutableRefObject<number> }) {
  const points = useRef<THREE.Points>(null);
  const material = useRef<THREE.ShaderMaterial>(null);

  const [positions, colors, sizes, seeds] = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const col = new Float32Array(PARTICLE_COUNT * 3);
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
      const c = particleColor();
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      // Distant particles read as pinpoint stars, not blobs.
      size[i] = r < 120 ? 1.6 + Math.random() * 3.6 : 0.7 + Math.random() * 1.6;
      seed[i] = Math.random() * 100;
    }
    return [pos, col, size, seed];
  }, []);

  useFrame((state) => {
    if (material.current) {
      material.current.uniforms.uTime.value = state.clock.elapsedTime;
      // Recedes to a faint ambient sparkle once the dolly settles, rather
      // than vanishing outright — the estate should still feel inhabited.
      material.current.opacity = THREE.MathUtils.lerp(1, 0.45, settleRef.current);
    }
    if (points.current) {
      points.current.rotation.y = state.clock.elapsedTime * 0.012;
    }
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={material}
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={PARTICLE_VERTEX}
        fragmentShader={PARTICLE_FRAGMENT}
        uniforms={{ uTime: { value: 0 } }}
      />
    </points>
  );
}

/** The star: a banded-gradient core (never a flat fill) plus two layered,
 *  camera-facing glow sprites that truly fade to nothing at their edge —
 *  the corona is no longer a uniform, hard-edged sphere silhouette. */
function Star() {
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

  useFrame((state) => {
    const breathe = 1 + Math.sin(state.clock.elapsedTime * 0.7) * 0.06;
    innerGlow.current?.scale.set(SUN_R * 4.4 * breathe, SUN_R * 4.4 * breathe, 1);
    outerGlow.current?.scale.set(SUN_R * 9.5 * (2 - breathe), SUN_R * 9.5 * (2 - breathe), 1);
  });

  return (
    <group>
      <sprite ref={outerGlow} scale={[SUN_R * 9.5, SUN_R * 9.5, 1]}>
        <spriteMaterial
          map={outerGlowTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <sprite ref={innerGlow} scale={[SUN_R * 4.4, SUN_R * 4.4, 1]}>
        <spriteMaterial
          map={innerGlowTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
      <mesh>
        <sphereGeometry args={[SUN_R, 48, 48]} />
        <meshBasicMaterial map={sunTexture} color="#ffffff" toneMapped={false} />
      </mesh>
      <pointLight color="#FFDFA6" intensity={420} distance={0} decay={2} />
    </group>
  );
}

type PlanetRef = { mesh: THREE.Mesh; glow: THREE.Sprite | null; reveal: { current: number } };

/** The estate: eight bodies on their real orbits, each with a banded surface
 *  gradient instead of a flat fill, plus one ring per shell — all tilted
 *  together as a single rigid assembly. */
function Planets({ planetRefs }: { planetRefs: React.MutableRefObject<Map<string, PlanetRef>> }) {
  const t = useRef(0);

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

  useFrame((_, delta) => {
    t.current += delta;
    for (const app of APPS) {
      const entry = planetRefs.current.get(app.id);
      if (!entry || !entry.mesh) continue;
      const w = bodyWorld(app.orbit, t.current);
      const px = w.wx * ORBIT_SCALE;
      const py = w.wy * ORBIT_SCALE;
      const pz = w.wz * ORBIT_SCALE;
      entry.mesh.position.set(px, py, pz);
      const reveal = entry.reveal.current;
      const bodyScale = app.orbit.size * 0.408 * reveal; // 0.34 * 1.2
      entry.mesh.scale.setScalar(bodyScale);
      const mat = entry.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = reveal;
      if (entry.glow) {
        entry.glow.position.set(px, py, pz);
        const glowSize = bodyScale * 3.1;
        entry.glow.scale.set(glowSize, glowSize, 1);
        (entry.glow.material as THREE.SpriteMaterial).opacity = reveal * 0.8;
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
        const material = new THREE.LineBasicMaterial({ color: "#8FA0CC", transparent: true, opacity: 0.22 });
        return new THREE.Line(geometry, material);
      }),
    [],
  );

  return (
    <group position={[0, RING_LIFT_Y, 0]} rotation={SYSTEM_TILT}>
      {rings.map((ring, i) => (
        <primitive key={i} object={ring} />
      ))}
      {APPS.map((app) => (
        <group key={app.id}>
          {/* Both refs merge into the same map entry defensively, since which
              of two sibling refs fires first is not guaranteed — each keeps
              whatever the other has already set, including the shared
              `reveal` object GSAP tweens by reference. */}
          <sprite
            ref={(sprite) => {
              const prev = planetRefs.current.get(app.id);
              planetRefs.current.set(app.id, {
                mesh: prev?.mesh ?? null!,
                glow: sprite,
                reveal: prev?.reveal ?? { current: 0 },
              });
            }}
          >
            <spriteMaterial
              map={glowTextures.get(app.id)}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              opacity={0}
              toneMapped={false}
            />
          </sprite>
          <mesh
            ref={(mesh) => {
              if (!mesh) return;
              const prev = planetRefs.current.get(app.id);
              planetRefs.current.set(app.id, {
                mesh,
                glow: prev?.glow ?? null,
                reveal: prev?.reveal ?? { current: 0 },
              });
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
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * A slow ambient turn once the dolly has settled, so the scene never sits
 * dead still. The camera always looks exactly at the origin, with no added
 * pitch: the sun (and so the wordmark, which is anchored to the sun's real
 * projected position) must render at true screen centre. Rebalancing the
 * ring/planet spread happens on the orbital system's own tilt instead (see
 * SYSTEM_TILT) — that shifts what surrounds the star without ever moving the
 * star, and therefore the wordmark, off centre.
 */
function AmbientCamera({ settleRef }: { settleRef: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  useFrame((state) => {
    if (settleRef.current >= 0.98) {
      const drift = Math.sin(state.clock.elapsedTime * 0.05) * 14;
      camera.position.x = drift;
    }
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export type SceneHandle = {
  camera: THREE.PerspectiveCamera | null;
  planetRefs: React.MutableRefObject<Map<string, PlanetRef>>;
  settleRef: React.MutableRefObject<number>;
};

export default function RevealScene({ onReady }: { onReady: (handle: SceneHandle) => void }) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null!);
  const planetRefs = useRef(new Map<string, PlanetRef>());
  const settleRef = useRef(0);
  const reported = useRef(false);

  useFrame(() => {
    if (!reported.current && cameraRef.current) {
      reported.current = true;
      onReady({ camera: cameraRef.current, planetRefs, settleRef });
    }
  });

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault fov={50} near={0.5} far={4000} position={[0, 0, CAM_START_Z]} />
      <ambientLight intensity={0.12} />
      <Star />
      <ParticleField settleRef={settleRef} />
      <Planets planetRefs={planetRefs} />
      <AmbientCamera settleRef={settleRef} />
      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={0.22} luminanceSmoothing={0.3} intensity={1.15} radius={0.85} />
      </EffectComposer>
    </>
  );
}
