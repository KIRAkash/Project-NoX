"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import { gsap } from "@/lib/motion";
import { BOOK_PAGES } from "@/lib/spec-book";
import { drawBackCover, drawCover, drawSpecPage, drawStatus, layoutPage, makeCanvas, readFonts, type Fonts } from "./draw";
import { bookState } from "./timeline";

/*
 * The spec book in three.js: a cover and one leaf per spec file, hinged at
 * the spine, over a back cover. Each leaf is a plane whose vertices are
 * placed in the vertex shader by integrating a bend angle along the page —
 * paper doesn't stretch, so as a page turns its free edge trails and the
 * sheet curls instead of rotating like a rigid card (the arc-length idea
 * from ThreeUI's 3D Paper, MIT). Faces are canvas textures from draw.ts;
 * the front and back of a leaf are picked per fragment.
 *
 * Everything is driven by `timeRef` through bookState(), so the scroll
 * scrub can run it forwards and back; each leaf follows its angle on a
 * spring, and its curl comes from how fast it's moving. Rendering is on
 * demand and only while the beat is on screen.
 */

const PAGE_W = 1;
const PAGE_H = 1.38;
const COVER_W = 1.035;
const COVER_H = 1.42;
const LAYER = 0.007;
const PAGE_LIFT = 0.14;
// the approval stamp takes this long to come down, in real time, however fast the visitor scrolls
const STAMP_SECONDS = 0.55;
// each leaf follows its scroll-given angle on a spring, so turns ease in and settle with a little follow-through
const SPRING_K = 70;
const SPRING_C = 2 * Math.sqrt(SPRING_K) * 0.82;

const BEND = /* glsl */ `
uniform float uAngle, uDir, uLag, uLift, uW, uH, uZ, uTime;

// uDir carries how fast (and which way) the leaf is moving, so a quick turn curls more;
// the bottom corner lags less than the top, so the sheet bends on a diagonal like a real page
float leafTheta(float s, float v){
  float corner = 1.0 - 0.24 * (0.5 - v);
  float lag  = uLag * uDir * sin(uAngle) * pow(s, 1.35) * corner;
  float lift = uLift * exp(-7.0 * s) * cos(uAngle);
  float flutter = 0.035 * sin(uAngle) * sin(uTime * 3.1 + s * 4.0) * s;
  return uAngle - lag + lift + flutter;
}

// integrate the bend along the page so its length is conserved
void leafPoint(vec2 q, out vec3 P, out vec3 N){
  float x = 0.0, z = 0.0;
  const int NS = 24;
  float h = 1.0 / float(NS);
  for (int i = 0; i < NS; i++) {
    float s = (float(i) + 0.5) * h;
    float w = clamp((q.x - (s - 0.5 * h)) / h, 0.0, 1.0);
    float th = leafTheta(s, q.y);
    x += cos(th) * h * w;
    z += sin(th) * h * w;
  }
  float th0 = leafTheta(q.x, q.y);
  P = vec3(x * uW, (q.y - 0.5) * uH, z * uW + uZ);
  N = normalize(vec3(-sin(th0), 0.0, cos(th0)));
}`;

type LeafUniforms = {
  uAngle: { value: number };
  uDir: { value: number };
  uLag: { value: number };
  uLift: { value: number };
  uW: { value: number };
  uH: { value: number };
  uZ: { value: number };
  uTime: { value: number };
  uRim: { value: number };
  uBack: { value: THREE.Texture | null };
};

function leafMaterial(front: THREE.Texture, back: THREE.Texture, opts: { w: number; h: number; lag: number; lift: number; cover?: boolean }) {
  const uniforms: LeafUniforms = {
    uAngle: { value: 0 },
    uDir: { value: 0 },
    uLag: { value: opts.lag },
    uLift: { value: opts.lift },
    uW: { value: opts.w },
    uH: { value: opts.h },
    uZ: { value: 0 },
    uTime: { value: 0 },
    uRim: { value: opts.cover ? 0.4 : 0.32 },
    uBack: { value: back },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    map: front,
    side: THREE.DoubleSide,
    roughness: opts.cover ? 0.5 : 0.82,
    metalness: 0,
    clearcoat: opts.cover ? 0.35 : 0,
    clearcoatRoughness: 0.4,
    sheen: opts.cover ? 0 : 0.35,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color("#fff6e8"),
    envMapIntensity: opts.cover ? 0.9 : 0.55,
    transparent: true,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${BEND}`)
      .replace(
        "#include <beginnormal_vertex>",
        `vec3 leafP; vec3 objectNormal;
         leafPoint(uv, leafP, objectNormal);
         #ifdef USE_TANGENT
           vec3 objectTangent = vec3( tangent.xyz );
         #endif`,
      )
      .replace("#include <begin_vertex>", "vec3 transformed = leafP;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uBack;\nuniform float uRim;")
      // front and back of the leaf carry different prints; the back reads mirrored across the spine
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
           vec4 sampledDiffuseColor = gl_FrontFacing ? texture2D( map, vMapUv ) : texture2D( uBack, vec2( 1.0 - vMapUv.x, vMapUv.y ) );
           diffuseColor *= sampledDiffuseColor;
         #endif`,
      )
      // the sheets are cut to shape in their textures: drop what's outside, judged on the print's
      // own alpha so the fade-in (opacity) never cuts the whole cover away
      .replace("#include <alphatest_fragment>", "if ( diffuseColor.a / max( opacity, 1e-4 ) < 0.5 ) discard;")
      .replace(
        "#include <opaque_fragment>",
        `float fres = pow( 1.0 - clamp( abs( dot( geometryNormal, geometryViewDir ) ), 0.0, 1.0 ), 3.0 );
         outgoingLight += fres * uRim * vec3( 1.0, 0.96, 0.9 );
         #include <opaque_fragment>`,
      );
  };
  // one pass: three draws transparent double-sided materials in two passes by default and flips
  // the winding for the back one, which would invert gl_FrontFacing and swap front and back prints
  mat.forceSinglePass = true;
  mat.customProgramCacheKey = () => "nox-spec-leaf";
  return { mat, uniforms };
}

function canvasTexture(c: HTMLCanvasElement, anisotropy: number) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** A soft studio: warm key upper left, cool fill, as an environment for the cover's clearcoat. */
function envTexture() {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#3a3d47");
  g.addColorStop(0.5, "#171820");
  g.addColorStop(1, "#08080a");
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const blob = (cx: number, cy: number, r: number, col: string) => {
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = rg;
    x.fillRect(0, 0, w, h);
  };
  blob(w * 0.3, h * 0.25, 160, "rgba(255,248,236,.95)");
  blob(w * 0.74, h * 0.34, 120, "rgba(150,175,235,.4)");
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type Pointer = { x: number; y: number };

export default function BookScene({
  timeRef,
  pointerRef,
  isVisible,
  onStep,
}: {
  timeRef: MutableRefObject<number>;
  pointerRef: MutableRefObject<Pointer>;
  isVisible: () => boolean;
  onStep: (step: number) => void;
}) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const root = useRef<THREE.Group>(null);
  const block = useRef<THREE.Group>(null);
  const fontsRef = useRef<Fonts | null>(null);
  const stepRef = useRef(-1);
  const keys = useRef<string[]>([]);
  const lastReveal = useRef<{ chars: number; at: number }>({ chars: -1, at: 0 });
  const tilt = useRef({ x: 0, y: 0 });
  // when each page's approval began (clock seconds), or null while it isn't approved
  const stampAt = useRef<(number | null)[]>(BOOK_PAGES.map(() => null));
  // sprung leaf angles: position, velocity, and the way each last moved
  const spring = useRef(Array.from({ length: BOOK_PAGES.length + 1 }, () => ({ a: 0, v: 0, way: 1 })));

  // canvases, textures and materials — built once
  const book = useMemo(() => {
    const aniso = gl.capabilities.getMaxAnisotropy();
    const coverFront = makeCanvas();
    const coverBack = makeCanvas();
    const backCover = makeCanvas();
    const fronts = BOOK_PAGES.map(() => makeCanvas());
    const backs = BOOK_PAGES.map(() => makeCanvas());
    const tex = {
      coverFront: canvasTexture(coverFront, aniso),
      coverBack: canvasTexture(coverBack, aniso),
      backCover: canvasTexture(backCover, aniso),
      fronts: fronts.map((c) => canvasTexture(c, aniso)),
      backs: backs.map((c) => canvasTexture(c, aniso)),
    };
    const cover = leafMaterial(tex.coverFront, tex.coverBack, { w: COVER_W, h: COVER_H, lag: 0.12, lift: 0, cover: true });
    const pages = BOOK_PAGES.map((_, i) => leafMaterial(tex.fronts[i], tex.backs[i], { w: PAGE_W, h: PAGE_H, lag: 0.95, lift: PAGE_LIFT }));
    const backLeaf = leafMaterial(tex.backCover, tex.backCover, { w: COVER_W, h: COVER_H, lag: 0, lift: 0, cover: true });
    const geometry = new THREE.PlaneGeometry(1, 1, 40, 2);
    return { canvases: { coverFront, coverBack, backCover, fronts, backs }, tex, cover, pages, backLeaf, geometry };
  }, [gl]);

  const halo = useMemo(() => {
    const s = 256;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(247,181,66,.16)");
    g.addColorStop(0.45, "rgba(134,185,238,.05)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  }, []);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromEquirectangular(envTexture()).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  // draw the static faces once the page fonts are in, so canvas text uses them
  useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => {
      if (!alive) return;
      const fonts = readFonts();
      fontsRef.current = fonts;
      const probe = book.canvases.fronts[0].getContext("2d")!;
      // the left-hand pages: inside the cover while the first seat writes, then the back of each
      // finished page while the next seat writes — who's writing now, and who has cleared
      BOOK_PAGES.forEach((_, i) => {
        layoutPage(probe, i, fonts);
        drawStatus(book.canvases.backs[i], i + 1, fonts);
        book.tex.backs[i].needsUpdate = true;
      });
      drawStatus(book.canvases.coverBack, 0, fonts);
      drawBackCover(book.canvases.backCover);
      book.tex.coverBack.needsUpdate = true;
      book.tex.backCover.needsUpdate = true;
      keys.current = [];
      invalidate();
    });
    return () => {
      alive = false;
    };
  }, [book, invalidate]);

  // render only while the beat is on screen; the scene idles gently in between scroll moves
  useEffect(() => {
    const tick = () => {
      if (isVisible()) invalidate();
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [invalidate, isVisible]);

  useEffect(
    () => () => {
      book.geometry.dispose();
      [book.cover, book.backLeaf, ...book.pages].forEach((m) => m.mat.dispose());
      [book.tex.coverFront, book.tex.coverBack, book.tex.backCover, ...book.tex.fronts, ...book.tex.backs].forEach((t) => t.dispose());
      halo.dispose();
    },
    [book, halo],
  );

  // fit the book into whatever box the canvas has: the open spread is twice as wide as the
  // closed book, so on narrow screens the closed book can be drawn much larger
  const fit = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const visH = 2 * cam.position.z * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const visW = visH * (size.width / Math.max(1, size.height));
    const byH = (visH * 0.86) / COVER_H;
    const open = Math.min(byH, (visW * 0.94) / (COVER_W * 2));
    // closed, the book grows into the space the spread needs — but not so much that opening it reads as a zoom
    return { open, closed: Math.min(byH * 0.84, (visW * 0.8) / COVER_W, open * 1.6) };
  }, [camera, size]);

  useFrame((state, delta) => {
    const fonts = fontsRef.current;
    const g = root.current;
    const inner = block.current;
    if (!fonts || !g || !inner) return;
    const t = timeRef.current;
    const clock = state.clock.elapsedTime;
    const s = bookState(t);

    if (s.step !== stepRef.current) {
      stepRef.current = s.step;
      onStep(s.step);
    }

    // ---- faces: redraw a canvas only when what's printed on it changes
    const coverKey = `${Math.round(s.lock * 24)}|${s.verified ? 1 : 0}`;
    if (keys.current[0] !== coverKey) {
      keys.current[0] = coverKey;
      drawCover(book.canvases.coverFront, fonts, s.lock, s.verified ? 1 : 0);
      book.tex.coverFront.needsUpdate = true;
    }
    let impact = 0;
    BOOK_PAGES.forEach((_, i) => {
      const total = layoutPage(book.canvases.fronts[i].getContext("2d")!, i, fonts).total;
      const chars = Math.round(s.written[i] * total);
      const cursor = s.writing === i;
      if (cursor && chars !== lastReveal.current.chars) lastReveal.current = { chars, at: clock };
      // the caret blinks only once the writing pauses (the visitor stopped scrolling)
      const blink = cursor && clock - lastReveal.current.at > 0.4 && Math.floor(clock * 2.2) % 2 === 1;
      const approved = s.written[i] >= 1 && (i < BOOK_PAGES.length - 1 || s.lastApproved);
      if (!approved) stampAt.current[i] = null;
      else if (stampAt.current[i] === null) stampAt.current[i] = clock;
      const at = stampAt.current[i];
      const stamp = at === null ? 0 : Math.min(1, (clock - at) / STAMP_SECONDS);
      if (stamp > 0.55 && stamp < 0.8) impact = Math.max(impact, Math.sin(((stamp - 0.55) / 0.25) * Math.PI));
      const key = `${chars}|${cursor ? 1 : 0}|${blink ? 1 : 0}|${Math.round(stamp * 40)}`;
      if (keys.current[i + 1] !== key) {
        keys.current[i + 1] = key;
        drawSpecPage(book.canvases.fronts[i], i, chars, fonts, { cursor, blink, stamp });
        book.tex.fronts[i].needsUpdate = true;
      }
    });

    // ---- leaves: angle, curl direction and stacking order
    const n = BOOK_PAGES.length + 1;
    const leaves = [book.cover, ...book.pages];
    const dt = Math.min(delta, 1 / 30);
    const angles = spring.current.map((sp, k) => {
      const target = s.angles[k];
      // a large jump (seeking to a step, or the first frame) snaps rather than swinging through pages
      if (Math.abs(target - sp.a) > 2.2) {
        sp.a = target;
        sp.v = 0;
      }
      sp.v += (SPRING_K * (target - sp.a) - SPRING_C * sp.v) * dt;
      sp.a = Math.min(Math.PI + 0.04, Math.max(-0.04, sp.a + sp.v * dt));
      if (Math.abs(sp.v) > 0.05) sp.way = Math.sign(sp.v);
      return sp;
    });
    const coverOpen = Math.min(1, Math.max(0, angles[0].a / Math.PI));
    leaves.forEach((leaf, k) => {
      const { a, v, way } = angles[k];
      leaf.uniforms.uAngle.value = a;
      // a gentle curl while a page is off the stack, more the faster it moves
      const turning = a > 0.02 && a < Math.PI - 0.02;
      leaf.uniforms.uDir.value = turning ? way * (0.32 + Math.min(0.8, Math.abs(v) * 0.22)) : 0;
      leaf.uniforms.uTime.value = clock;
      // pages rise off the spine only in an open book; closed, they lie flat under the cover
      if (k > 0) leaf.uniforms.uLift.value = PAGE_LIFT * coverOpen;
      // right-hand stack: cover on top; left-hand stack: the most recently turned on top
      leaf.uniforms.uZ.value = a < Math.PI / 2 ? (n - k) * LAYER : (k + 1) * LAYER;
      leaf.mat.opacity = s.appear;
    });
    book.backLeaf.uniforms.uZ.value = 0;
    book.backLeaf.mat.opacity = s.appear;
    halo.opacity = s.appear;

    // ---- the whole book: centred while closed, slid to the spread once open
    inner.position.x = -0.5 * COVER_W * (1 - coverOpen);

    const idle = Math.sin(clock * 0.6) * 0.02;
    tilt.current.x += (pointerRef.current.y * 0.1 - tilt.current.x) * 0.06;
    tilt.current.y += (pointerRef.current.x * 0.16 - tilt.current.y) * 0.06;
    const away = s.verified ? 1 - s.back : s.send;
    const scale = fit.closed + (fit.open - fit.closed) * coverOpen;
    g.scale.setScalar(scale * (0.92 + 0.08 * s.appear));
    // the book gives a little under the stamp as it lands
    g.position.set(away * 6.2, -0.35 * (1 - s.appear) + idle, -1.6 * away - 0.05 * impact);
    g.rotation.set(-0.2 + tilt.current.x + idle * 0.5, 0.1 + tilt.current.y - 0.6 * away, 0.015 * Math.sin(clock * 0.4));
  });

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[-3.2, 2.4, 3]} intensity={1.9} color="#fff4e6" />
      <directionalLight position={[3.6, -1.6, 2]} intensity={0.35} color="#9fb6ff" />
      <mesh position={[0, 0, -0.9]} scale={[6.5, 5.2, 1]} material={halo}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <group ref={root}>
        <group ref={block}>
          <mesh geometry={book.geometry} material={book.backLeaf.mat} renderOrder={0} frustumCulled={false} />
          {[book.cover, ...book.pages].map((leaf, k) => (
            <mesh key={k} geometry={book.geometry} material={leaf.mat} renderOrder={k + 1} frustumCulled={false} />
          ))}
        </group>
      </group>
    </>
  );
}
