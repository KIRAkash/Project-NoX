// The WebGL layer under the DOM: nebula, stars, dust, the NoX sun, and a screen-space
// particle layer for comets, streams, sparks and flares. Everything is driven by the
// plain state objects in `S`, which the GSAP timeline tweens; nothing here keeps time.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export const W = 1920, H = 1080;
export const FOV = 40;
export const D = H / 2 / Math.tan((FOV / 2) * Math.PI / 180); // camera distance where 1 world unit = 1 px at z = 0

export const SNOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const col = (hex) => new THREE.Color(hex);
const rgb = (hex) => { const c = new THREE.Color(hex); return { r: c.r, g: c.g, b: c.b }; };

/* ---------------- state the timeline tweens ---------------- */
export const S = {
  cam: { x: 0, y: 0, z: D, tx: 0, ty: 0, tz: 0, fov: FOV, roll: 0, drift: 1 },
  neb: { a: 0, c1: rgb("#2a1a08"), c2: rgb("#F7B542"), c3: rgb("#3b2a7a"), speed: 1, ox: 0, oy: 0 },
  stars: { a: 0, size: 1 },
  dust: { a: 0 },
  bloom: { strength: 0.6, radius: 0.5, threshold: 0.7 },
  exposure: { v: 1 },
  god: { s: 0, x: 0.5, y: 0.5 },
  sun: { on: 0, x: 0, y: 88, z: 0, scale: 1, heat: 1.6, corona: 1, ring: 0, ringA: 0, flare: 0 },
};
export const rgbOf = rgb;

/* ---------------- renderer + scenes ---------------- */
export const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x000000, 1);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 40000);
camera.position.set(0, 0, D);

export const overlay = new THREE.Scene();
export const ocam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -100, 100);

/* ---------------- nebula (fullscreen, behind everything) ---------------- */
const nebMat = new THREE.ShaderMaterial({
  depthWrite: false, depthTest: false,
  uniforms: {
    t: { value: 0 }, amp: { value: 0 }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() }, c3: { value: new THREE.Color() },
    off: { value: new THREE.Vector2() },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  fragmentShader: `varying vec2 vUv; uniform float t, amp; uniform vec3 c1, c2, c3; uniform vec2 off;
    float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
    float fbm(vec2 p){ float s=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ s+=a*noise(p); p=m*p; a*=.5; } return s; }
    void main(){
      vec2 p = (vUv-.5)*vec2(1.7778,1.)*2.0 + off;
      vec2 q = vec2(fbm(p + vec2(0., t*.012)), fbm(p + vec2(5.2,1.3) - t*.009));
      vec2 r = vec2(fbm(p + 3.2*q + vec2(1.7,9.2) + t*.016), fbm(p + 3.2*q + vec2(8.3,2.8)));
      float f = fbm(p + 3.0*r);
      vec3 c = mix(c1, c2, clamp(f*f*2.4, 0., 1.));
      c = mix(c, c3, clamp(length(q)*.75 - .2, 0., 1.)*.75);
      float dens = smoothstep(.28, 1.0, f);
      float lanes = smoothstep(.5, .8, fbm(p*1.8 + r*2.3));
      vec3 o = c * (dens*1.15 + .05) * (1. - lanes*.55);
      // gentle falloff to the frame edges
      vec2 e = vUv - .5; o *= 1. - dot(e, e)*.9;
      gl_FragColor = vec4(o*amp, 1.);
    }`,
});
const neb = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), nebMat);
neb.frustumCulled = false; neb.renderOrder = -10;
scene.add(neb);

/* ---------------- star field (3D shell around the scene) ---------------- */
function rnd(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rnd(1234);
const NS = 4200;
const sp = new Float32Array(NS * 3), ss = new Float32Array(NS), sph = new Float32Array(NS), sc = new Float32Array(NS * 3);
for (let i = 0; i < NS; i++) {
  const u = R() * 2 - 1, th = R() * Math.PI * 2, rr = 5000 + R() * 9000;
  const s = Math.sqrt(1 - u * u);
  sp[i * 3] = rr * s * Math.cos(th); sp[i * 3 + 1] = rr * u * 0.8; sp[i * 3 + 2] = rr * s * Math.sin(th) - 2000;
  const big = R() < 0.03;
  ss[i] = (big ? 24 : 11) * (0.55 + R());
  sph[i] = R();
  const k = R();
  const c = k < 0.10 ? col("#FFE2A8") : k < 0.26 ? col("#BBD3FF") : k < 0.3 ? col("#FFB3A0") : col("#EEF1FA");
  sc[i * 3] = c.r; sc[i * 3 + 1] = c.g; sc[i * 3 + 2] = c.b;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
starGeo.setAttribute("size", new THREE.BufferAttribute(ss, 1));
starGeo.setAttribute("phase", new THREE.BufferAttribute(sph, 1));
starGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
const starMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { t: { value: 0 }, a: { value: 0 }, k: { value: 1 } },
  vertexShader: `attribute float size; attribute float phase; attribute vec3 color; uniform float t, k; varying vec3 vC; varying float vT;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
      vT = .7 + .3*sin(t*(.6+phase*1.8) + phase*31.);
      gl_PointSize = clamp(size*k*1500./-mv.z, 2.4, 16.); vC = color; }`,
  fragmentShader: `varying vec3 vC; varying float vT; uniform float a;
    void main(){ vec2 c = gl_PointCoord*2.-1.; float d = dot(c,c); if(d>1.) discard;
      float core = exp(-d*7.); float halo = exp(-d*2.5)*.08;
      gl_FragColor = vec4(vC*(core*4.2+halo*1.6)*vT*a, 1.); }`,
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
scene.add(stars);

/* ---------------- dust / bokeh close to the camera ---------------- */
const ND = 70;
const dp = new Float32Array(ND * 3), ds = new Float32Array(ND), dph = new Float32Array(ND), dc = new Float32Array(ND * 3);
for (let i = 0; i < ND; i++) {
  dp[i * 3] = (R() - 0.5) * 2600; dp[i * 3 + 1] = (R() - 0.5) * 1500; dp[i * 3 + 2] = -600 + R() * 1500;
  ds[i] = 14 + R() * 46; dph[i] = R();
  const c = R() < 0.5 ? col("#FFD9A0") : col("#A9C4FF");
  dc[i * 3] = c.r; dc[i * 3 + 1] = c.g; dc[i * 3 + 2] = c.b;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
dustGeo.setAttribute("size", new THREE.BufferAttribute(ds, 1));
dustGeo.setAttribute("phase", new THREE.BufferAttribute(dph, 1));
dustGeo.setAttribute("color", new THREE.BufferAttribute(dc, 3));
const dustMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  uniforms: { t: { value: 0 }, a: { value: 0 } },
  vertexShader: `attribute float size; attribute float phase; attribute vec3 color; uniform float t; varying vec3 vC; varying float vP;
    void main(){ vec3 p = position + vec3(sin(t*.11+phase*9.)*40., cos(t*.09+phase*7.)*30., 0.);
      vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
      gl_PointSize = clamp(size*900./-mv.z, 2., 400.); vC = color; vP = phase; }`,
  fragmentShader: `varying vec3 vC; varying float vP; uniform float a;
    void main(){ vec2 c = gl_PointCoord*2.-1.; float d = length(c); if(d>1.) discard;
      float disc = smoothstep(1., .7, d)*.35 + smoothstep(1.,.0,d)*.3;
      gl_FragColor = vec4(vC*disc*a*(.12+.22*vP), 1.); }`,
});
const dust = new THREE.Points(dustGeo, dustMat);
dust.frustumCulled = false;
scene.add(dust);

/* ---------------- the NoX sun ---------------- */
export const sunGroup = new THREE.Group();
scene.add(sunGroup);
const SUN_R = 125;
const sunMat = new THREE.ShaderMaterial({
  uniforms: { t: { value: 0 }, heat: { value: 1.6 } },
  vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV;
    void main(){ vN = normalize(normalMatrix*normal); vP = position; vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: SNOISE + `varying vec3 vN; varying vec3 vP; varying vec3 vV; uniform float t, heat;
    void main(){
      vec3 q = normalize(vP);
      float n1 = snoise(q*2.2 + vec3(0., t*.12, 0.));
      float n2 = snoise(q*6.0 - vec3(t*.2));
      float n3 = snoise(q*15.0 + vec3(t*.35, 0., t*.2));
      float g = n1*.5 + n2*.32 + n3*.18;
      float mu = max(dot(vN, vV), 0.);
      // the brand orb: cream core, gold, amber, ember at the limb (linear-space values)
      vec3 core = vec3(1.0, .93, .78), gold = vec3(1.0, .72, .25), amber = vec3(.93, .46, .06), ember = vec3(.80, .17, .04);
      float m = mu + g*.10;
      vec3 c = mix(ember, amber, smoothstep(.0, .35, m));
      c = mix(c, gold, smoothstep(.3, .7, m));
      c = mix(c, core, smoothstep(.72, 1.02, m));
      c *= .85 + g*.22;
      gl_FragColor = vec4(c*heat, 1.);
    }`,
});
const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 96, 64), sunMat);
sunGroup.add(sun);

const coronaMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { t: { value: 0 }, amt: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: SNOISE + `varying vec2 vUv; uniform float t, amt;
    void main(){
      vec2 p = (vUv-.5)*10.; float r = length(p); float a = atan(p.y, p.x);
      float rays = snoise(vec3(cos(a)*2.5, sin(a)*2.5, t*.25))*.5+.5; rays = pow(rays, 2.5);
      float fine = snoise(vec3(cos(a)*11., sin(a)*11., t*.4+3.))*.5+.5; fine = pow(fine, 3.);
      float fall = exp(-max(r-1.,0.)*1.5);
      float glow = exp(-max(r-1.,0.)*.7)*.16;
      float streak = fall*(.25 + rays*1.1 + fine*.6);
      vec3 c = mix(vec3(1.,.42,.12), vec3(1.,.86,.55), clamp(fall*1.2,0.,1.));
      gl_FragColor = vec4(c*(streak + glow)*amt*smoothstep(.0,.4,r), 1.);
    }`,
});
const corona = new THREE.Mesh(new THREE.PlaneGeometry(SUN_R * 10, SUN_R * 10), coronaMat);
sunGroup.add(corona);

const ringMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { a: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec2 vUv; uniform float a;
    void main(){ float r = length(vUv-.5)*2.; float band = exp(-pow((r-.92)*18., 2.)) + exp(-pow((r-.86)*8., 2.))*.35;
      gl_FragColor = vec4(vec3(1.,.82,.5)*band*a*1.6, 1.); }`,
});
const shock = new THREE.Mesh(new THREE.PlaneGeometry(SUN_R * 2.4, SUN_R * 2.4), ringMat);
sunGroup.add(shock);

/* ---------------- screen-space particles (overlay) ---------------- */
const MAXP = 6000;
const pp = new Float32Array(MAXP * 3), psz = new Float32Array(MAXP), pc = new Float32Array(MAXP * 3), pa = new Float32Array(MAXP), pk = new Float32Array(MAXP);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute("position", new THREE.BufferAttribute(pp, 3));
pGeo.setAttribute("aSize", new THREE.BufferAttribute(psz, 1));
pGeo.setAttribute("aColor", new THREE.BufferAttribute(pc, 3));
pGeo.setAttribute("aAlpha", new THREE.BufferAttribute(pa, 1));
pGeo.setAttribute("aKind", new THREE.BufferAttribute(pk, 1));
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute float aSize; attribute vec3 aColor; attribute float aAlpha; attribute float aKind; varying vec3 vC; varying float vA; varying float vK;
    void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize = aSize; vC = aColor; vA = aAlpha; vK = aKind; }`,
  fragmentShader: `varying vec3 vC; varying float vA; varying float vK;
    void main(){ vec2 c = gl_PointCoord*2.-1.; float d = dot(c,c); if(d>1.) discard;
      float v;
      if (vK < .5) v = exp(-d*10.)*1.3 + exp(-d*3.)*.3;          // spark: hot core, soft halo
      else if (vK < 1.5) v = exp(-d*2.2)*(1.-d);                   // glow: wide soft blob
      else { float r = sqrt(d); v = smoothstep(1., .9, r)*.5 + smoothstep(.9,.0,r)*.12; } // ghost: lens-flare disc
      gl_FragColor = vec4(vC*v*vA, 1.); }`,
});
const pts = new THREE.Points(pGeo, pMat);
pts.frustumCulled = false;
overlay.add(pts);
let pn = 0;
export const P = {
  /** add a particle at screen pixel (x, y). kind: 0 spark, 1 glow, 2 ghost */
  add(x, y, size, c, a, kind = 0) {
    if (pn >= MAXP || a <= 0.002 || size < 0.5) return;
    pp[pn * 3] = x - W / 2; pp[pn * 3 + 1] = H / 2 - y; pp[pn * 3 + 2] = 0;
    psz[pn] = Math.min(1020, size); pc[pn * 3] = c.r; pc[pn * 3 + 1] = c.g; pc[pn * 3 + 2] = c.b; pa[pn] = a; pk[pn] = kind;
    pn++;
  },
  reset() { pn = 0; },
  commit() {
    pGeo.setDrawRange(0, pn);
    for (const k of ["position", "aSize", "aColor", "aAlpha", "aKind"]) pGeo.attributes[k].needsUpdate = true;
  },
};

/* anamorphic streak for the flare */
const streakMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  uniforms: { a: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec2 vUv; uniform float a;
    void main(){ vec2 p = vUv*2.-1.; float v = exp(-p.y*p.y*60.)*exp(-abs(p.x)*2.6) + exp(-p.y*p.y*600.)*exp(-abs(p.x)*1.2)*.6;
      gl_FragColor = vec4(vec3(.75,.85,1.)*v*a, 1.); }`,
});
export const streak = new THREE.Mesh(new THREE.PlaneGeometry(2200, 90), streakMat);
overlay.add(streak);

/* ---------------- post: god rays, bloom, output ---------------- */
export const composer = new EffectComposer(renderer);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const ovPass = new RenderPass(overlay, ocam);
ovPass.clear = false; ovPass.clearDepth = true;
composer.addPass(ovPass);
const godPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, center: { value: new THREE.Vector2(0.5, 0.5) }, strength: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 center; uniform float strength; varying vec2 vUv;
    void main(){ vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 d = (vUv - center) * (1.0/40.0) * .85; vec2 uv = vUv; float decay = 1.; vec3 acc = vec3(0.);
      for (int i = 0; i < 40; i++){ uv -= d; vec3 s = texture2D(tDiffuse, uv).rgb; s = max(s - vec3(1.05), vec3(0.)); acc += s*decay; decay *= .955; }
      gl_FragColor = vec4(base + acc*strength/40.0*2.2, 1.); }`,
});
composer.addPass(godPass);
export const bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.5, 0.7);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

/* ---------------- helpers ---------------- */
const v3 = new THREE.Vector3();
/** world point -> screen pixels {x, y, depth, s} where s is the pixel scale of one world unit there */
export function project(x, y, z) {
  v3.set(x, y, z).project(camera);
  const sx = (v3.x * 0.5 + 0.5) * W, sy = (-v3.y * 0.5 + 0.5) * H;
  const dist = camera.position.distanceTo(new THREE.Vector3(x, y, z));
  return { x: sx, y: sy, z: v3.z, s: (H / 2) / Math.tan((camera.fov / 2) * Math.PI / 180) / dist, behind: v3.z > 1 };
}

// smooth deterministic drift so the camera never sits dead still
function drift(t, k) {
  return {
    x: Math.sin(t * 0.21) * 9 + Math.sin(t * 0.53 + 1.3) * 4,
    y: Math.cos(t * 0.17) * 6 + Math.sin(t * 0.41 + 0.4) * 3,
    r: Math.sin(t * 0.13) * 0.004,
  };
}

export const updaters = []; // per-frame scene updates registered by scenes (before render)

export function renderGL(t) {
  // camera
  const C = S.cam, dr = drift(t);
  camera.fov = C.fov; camera.updateProjectionMatrix();
  camera.position.set(C.x + dr.x * C.drift, C.y + dr.y * C.drift, C.z);
  camera.up.set(Math.sin(C.roll + dr.r * C.drift), Math.cos(C.roll + dr.r * C.drift), 0);
  camera.lookAt(C.tx + dr.x * C.drift * 0.6, C.ty + dr.y * C.drift * 0.6, C.tz);
  camera.updateMatrixWorld();
  // background
  nebMat.uniforms.t.value = t * S.neb.speed; nebMat.uniforms.amp.value = S.neb.a;
  nebMat.uniforms.c1.value.setRGB(S.neb.c1.r, S.neb.c1.g, S.neb.c1.b);
  nebMat.uniforms.c2.value.setRGB(S.neb.c2.r, S.neb.c2.g, S.neb.c2.b);
  nebMat.uniforms.c3.value.setRGB(S.neb.c3.r, S.neb.c3.g, S.neb.c3.b);
  // the nebula drifts with the camera's aim, a little, for parallax
  nebMat.uniforms.off.value.set(S.neb.ox + (C.tx - C.x) * 0.00012 + C.x * 0.00008, S.neb.oy + C.y * 0.00008);
  neb.visible = false; // the backdrop is a quiet star field only
  starMat.uniforms.t.value = t; starMat.uniforms.a.value = S.stars.a; starMat.uniforms.k.value = S.stars.size;
  stars.visible = S.stars.a > 0.001;
  stars.rotation.set(t * 0.0012, t * 0.0045, 0); // a slow, steady drift
  dustMat.uniforms.t.value = t; dustMat.uniforms.a.value = S.dust.a;
  dust.visible = false;
  // sun
  const U = S.sun;
  sunGroup.visible = U.on > 0.001;
  sunGroup.position.set(U.x, U.y, U.z);
  sun.scale.setScalar(Math.max(0.0001, U.scale));
  sunMat.uniforms.t.value = t; sunMat.uniforms.heat.value = U.heat * U.on;
  coronaMat.uniforms.t.value = t; coronaMat.uniforms.amt.value = U.corona * U.on;
  corona.scale.setScalar(Math.max(0.0001, U.scale));
  corona.quaternion.copy(camera.quaternion);
  shock.scale.setScalar(Math.max(0.0001, U.ring));
  shock.quaternion.copy(camera.quaternion);
  ringMat.uniforms.a.value = U.ringA;
  // per-scene updates, then particles
  P.reset();
  for (const u of updaters) u(t);
  // lens flare tied to the sun's screen position
  if (U.flare > 0.001 && U.on > 0.01) {
    const s = project(U.x, U.y, U.z);
    const cx = W / 2, cy = H / 2;
    streak.position.set(s.x - W / 2, H / 2 - s.y, 0);
    streakMat.uniforms.a.value = U.flare * 0.55;
    const G = [[0.35, 70, "#FFC27A", 0.10], [0.62, 36, "#7FD6E8", 0.14], [1.15, 120, "#A897F0", 0.06], [1.42, 54, "#F7B542", 0.10], [1.8, 180, "#5FCBD8", 0.05], [2.1, 26, "#FFE2A8", 0.16]];
    for (const [k, sz, h, a] of G) P.add(s.x + (cx - s.x) * k, s.y + (cy - s.y) * k, sz, col(h), a * U.flare, 2);
    P.add(s.x, s.y, 560 * U.scale * s.s, col("#FF9A3A"), 0.22 * U.flare, 1);
  } else streakMat.uniforms.a.value = 0;
  P.commit();
  // god rays from the sun
  if (S.god.s > 0.001) {
    const s = project(U.x, U.y, U.z);
    godPass.enabled = true; godPass.uniforms.center.value.set(s.x / W, 1 - s.y / H); godPass.uniforms.strength.value = S.god.s;
  } else godPass.enabled = false;
  bloomPass.strength = S.bloom.strength; bloomPass.radius = S.bloom.radius; bloomPass.threshold = S.bloom.threshold;
  renderer.toneMappingExposure = S.exposure.v;
  composer.render();
}

export { THREE, SUN_R };
