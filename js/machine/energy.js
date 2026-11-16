// Energy visuals: glowing conductors with travelling pulses, the DC-link "fill",
// IPM gate markers, air streaks through the heatsink fins and the fault flash.
// Every energy colour is normalised to luminance 1 and multiplied by a level, so
// level > 1 blooms (PLAN 4.3) and level < 1 reads as a quiet coloured line.
import { ROUTES, MM } from './cad.js';

export function energyColor(THREE, hex, lum = 1) {
  const c = new THREE.Color(hex);
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  return c.multiplyScalar(lum / Math.max(l, 1e-3));
}

const VERT = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform float uTime, uLevel, uDash, uPwm, uSine, uHot, uLen, uPhase, uSpeed, uSpacing, uFlow;
uniform vec3 uColor, uHotColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
#include <common>
#include <fog_pars_fragment>
void main() {
  float s = vUv.x * uLen;
  float x = s - uFlow;
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float dash = fract(x / uSpacing);
  dash = smoothstep(0.0, 0.06, dash) * (1.0 - smoothstep(0.12, 0.38, dash));
  float wl = uSpacing * 3.2;
  float car = fract(x / (uSpacing * 0.42));
  float duty = 0.5 + 0.44 * sin(6.28318 * x / wl + uPhase);
  float pwm = 1.0 - smoothstep(duty - 0.03, duty + 0.03, car);
  float sn = 0.5 + 0.5 * sin(6.28318 * x / wl + uPhase);
  float e = 0.42 + uDash * (dash * 1.7 - 0.12) + uPwm * (pwm * 1.35 - 0.3) + uSine * (sn * sn * 1.5 - 0.35);
  e = max(e, 0.06);
  vec3 col = mix(uColor, uHotColor * 1.25, uHot) * uLevel * e * (0.62 + 0.5 * facing);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

function roundedPolyline(THREE, pts, r) {
  const path = new THREE.CurvePath();
  const P = pts;
  let prev = P[0].clone();
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const d1 = b.distanceTo(a), d2 = c.distanceTo(b);
    const rr = Math.min(r, d1 * 0.45, d2 * 0.45);
    const p1 = b.clone().add(a.clone().sub(b).setLength(rr));
    const p2 = b.clone().add(c.clone().sub(b).setLength(rr));
    if (prev.distanceTo(p1) > 1e-4) path.add(new THREE.LineCurve3(prev, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
    prev = p2;
  }
  path.add(new THREE.LineCurve3(prev, P[P.length - 1].clone()));
  return path;
}

export function buildConductors(THREE, tokens, fog, tier) {
  const group = new THREE.Group();
  group.name = 'conductors';
  const colors = {
    dc: energyColor(THREE, tokens.dc), pin: energyColor(THREE, tokens.ac), pout: energyColor(THREE, tokens.ac),
    tap: energyColor(THREE, tokens.ac), sig: energyColor(THREE, tokens.ctl)
  };
  const hot = energyColor(THREE, tokens.warn);
  const maxSeg = tier === 'low' ? 56 : tier === 'medium' ? 80 : 110;
  const list = [];
  for (const r of ROUTES) {
    const pts = r.pts.map((p) => new THREE.Vector3(p[0] * MM, p[2] * MM, -p[1] * MM));
    const curve = r.smooth ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : roundedPolyline(THREE, pts, 0.7);
    const len = curve.getLength();
    const seg = Math.max(12, Math.min(maxSeg, Math.round(len / 0.12)));
    const geo = new THREE.TubeGeometry(curve, seg, r.r * MM, r.group === 'sig' ? 5 : 7, false);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uLevel: { value: 0.4 }, uDash: { value: 0.5 }, uPwm: { value: 0 }, uSine: { value: 0 },
        uHot: { value: 0 }, uLen: { value: len }, uPhase: { value: (r.phase || 0) * (Math.PI * 2 / 3) },
        uSpeed: { value: 1 }, uSpacing: { value: r.group === 'sig' ? 1.4 : 2.0 }, uFlow: { value: 0 },
        uColor: { value: colors[r.group].clone() }, uHotColor: { value: hot.clone() }
      }]),
      vertexShader: VERT, fragmentShader: FRAG, fog: !!fog
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `wire_${r.id}`;
    mesh.frustumCulled = true;
    group.add(mesh);
    list.push({ id: r.id, group: r.group, mesh, mat, len, flow: Math.random() * 10 });
  }
  return { group, list };
}

// Soft amber "level" shell around a DC-link capacitor
export function makeCapFill(THREE, color) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFill: { value: 0 }, uAmt: { value: 0 }, uColor: { value: color.clone() }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uFill, uAmt, uTime; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float h = vUv.y;
        float lvl = uFill + 0.012 * sin(uTime * 3.0 + vUv.x * 18.85);
        float body = step(h, lvl);
        float de = (h - lvl) * 40.0; float edge = exp(-de * de);
        float rr = 1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0); float rim = rr * rr;
        float a = (body * (0.10 + 0.55 * rim) + edge * 0.9) * uAmt;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  return mat;
}

// Air streaks along the fin channels (+X), as line segments moved in the vertex shader
export function makeStreaks(THREE, count, box, color) {
  // box: heatsink world box (scene units)
  const pos = new Float32Array(count * 2 * 3);
  const seed = new Float32Array(count * 2);
  const end = new Float32Array(count * 2);
  const ny = 12;
  for (let i = 0; i < count; i++) {
    const ch = i % ny;
    const zz = box.min.z + (box.max.z - box.min.z) * ((ch + 0.5) / ny + 0.02);
    const yy = box.min.y + 0.4 + Math.random() * (box.max.y - box.min.y - 1.6);
    const s = Math.random();
    for (let k = 0; k < 2; k++) {
      pos[(i * 2 + k) * 3 + 0] = 0;
      pos[(i * 2 + k) * 3 + 1] = yy;
      pos[(i * 2 + k) * 3 + 2] = zz;
      seed[i * 2 + k] = s;
      end[i * 2 + k] = k;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.boundingSphere = new THREE.Sphere(box.getCenter(new THREE.Vector3()), 20);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uAmt: { value: 0 }, uColor: { value: color.clone() },
      uX0: { value: box.min.x - 2.2 }, uX1: { value: box.max.x + 3.0 }
    },
    vertexShader: `attribute float aSeed; attribute float aEnd; uniform float uTime, uX0, uX1; varying float vA;
      void main(){
        float ph = fract(uTime * (0.35 + 0.3 * aSeed) + aSeed * 7.13);
        float x = mix(uX0, uX1, ph) - aEnd * (0.9 + 0.8 * aSeed);
        vA = sin(3.14159 * ph) * (1.0 - aEnd * 0.85);
        vec4 mv = modelViewMatrix * vec4(x, position.y, position.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uAmt; uniform vec3 uColor; varying float vA;
      void main(){ gl_FragColor = vec4(uColor * vA * uAmt, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.name = 'air_streaks';
  lines.frustumCulled = false;
  return lines;
}

// Radial glow sprite texture (shared)
let _glowTex = null;
export function glowTexture(THREE) {
  if (_glowTex) return _glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(cv);
  return _glowTex;
}

export function makeGlowSprite(THREE, color, size) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(THREE), color: color.clone(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  s.userData.base = color.clone();
  return s;
}
