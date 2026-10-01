// Shared 3D building blocks: shaded planets with atmospheres, glowing tubes along curves.
import { THREE, SNOISE } from "./world.js";

export function planetMesh(hex, radius, { bands = 0, emissive = 0 } = {}) {
  const g = new THREE.Group();
  const base = new THREE.Color(hex);
  const mat = new THREE.ShaderMaterial({
    uniforms: { base: { value: base }, lightPos: { value: new THREE.Vector3(0, 0, 0) }, t: { value: 0 }, bands: { value: bands }, emiss: { value: emissive }, a: { value: 1 } },
    transparent: true,
    vertexShader: `varying vec3 vWN; varying vec3 vWP; varying vec3 vP;
      void main(){ vWN = normalize(mat3(modelMatrix)*normal); vec4 wp = modelMatrix*vec4(position,1.); vWP = wp.xyz; vP = position; gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: SNOISE + `varying vec3 vWN; varying vec3 vWP; varying vec3 vP; uniform vec3 base, lightPos; uniform float t, bands, emiss, a;
      void main(){
        vec3 L = normalize(lightPos - vWP); vec3 V = normalize(cameraPosition - vWP);
        float dif = max(dot(vWN, L), 0.);
        vec3 q = normalize(vP);
        float n = snoise(q*3.0 + vec3(t*.04, 0., t*.03))*.5 + .5;
        float b = bands > .5 ? sin(q.y*bands*3.14 + n*2.2)*.5 + .5 : .5;
        vec3 c = base*(0.10 + 1.15*dif)*(0.78 + 0.32*n)*(0.85 + 0.3*b);
        c += vec3(1.)*pow(max(dot(reflect(-L, vWN), V), 0.), 24.)*.25*dif;
        float rim = pow(1. - max(dot(vWN, V), 0.), 2.6);
        c += base*rim*(0.35 + 0.9*dif);
        c += base*emiss;
        gl_FragColor = vec4(c, a);
      }`,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), mat);
  const atmMat = new THREE.ShaderMaterial({
    uniforms: { base: { value: base.clone().lerp(new THREE.Color("#ffffff"), 0.25) }, a: { value: 1 } },
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vWN; varying vec3 vWP; void main(){ vWN = normalize(mat3(modelMatrix)*normal); vec4 wp = modelMatrix*vec4(position,1.); vWP = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `varying vec3 vWN; varying vec3 vWP; uniform vec3 base; uniform float a;
      void main(){ vec3 V = normalize(cameraPosition - vWP); float f = pow(max(0., .72 + dot(vWN, V)*.9), 3.2); gl_FragColor = vec4(base*f*1.4*a, 1.); }`,
  });
  const atm = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.32, 48, 32), atmMat);
  g.add(atm, body);
  g.userData = { mat, atmMat, radius };
  return g;
}

/** glowing tube along a curve; uniform `prog` draws it on, `pulse` sends light along it */
export function glowTube(curve, hex, { radius = 2, segs = 160, a = 0.6, pulse = 0, speed = 0.6, dash = 0, hex2 = null } = {}) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { c1: { value: new THREE.Color(hex) }, c2: { value: new THREE.Color(hex2 || hex) }, a: { value: a }, prog: { value: 1 }, start: { value: 0 }, t: { value: 0 }, pulse: { value: pulse }, speed: { value: speed }, dash: { value: dash } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform vec3 c1, c2; uniform float a, prog, start, t, pulse, speed, dash;
      void main(){ float x = vUv.x; if (x > prog || x < start) discard;
        float d = dash > 0. ? step(.45, fract(x*dash + t*.4)) : 1.;
        float p = 0.; if (pulse > 0.) { float f = fract(x*pulse - t*speed); p = pow(smoothstep(.0, .12, f)*(1.-smoothstep(.12, .2, f)), 1.5)*4.; }
        float head = smoothstep(prog - .03, prog, x)*step(prog, .999)*3.;
        vec3 c = mix(c1, c2, x);
        gl_FragColor = vec4(c*(a*d + p*a + head*a), 1.); }`,
  });
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 8, false), mat);
  mesh.frustumCulled = false;
  return mesh;
}

export class Circle extends THREE.Curve {
  constructor(r, a0 = 0, a1 = Math.PI * 2) { super(); this.r = r; this.a0 = a0; this.a1 = a1; }
  getPoint(u, target = new THREE.Vector3()) { const a = this.a0 + (this.a1 - this.a0) * u; return target.set(this.r * Math.cos(a), 0, this.r * Math.sin(a)); }
}
