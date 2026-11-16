// Wires with sag + the energy flow system (PLAN 5.2).
// Every path is a thin tube whose shader draws travelling dashes. Per-path state (visibility, speed,
// fill front) lives in a uniform array, so a station can switch whole groups of paths on and off.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FLOW = {
  maxPaths: 96,
  gain: 0.6,
  base: 0.22,          // steady glow of an energised wire
  dash: 2.4,           // dash brightness on top
  ease: 2.2,           // 1/s, how fast visibility follows its target
  kinds: {             // radius (m), dash spacing (m), dash length fraction, speed (m/s), colour intensity
    tx:   { r: 0.16, spacing: 16, len: 0.22, speed: 26, k: 1.6 },
    dist: { r: 0.11, spacing: 9,  len: 0.25, speed: 14, k: 1.7 },
    drop: { r: 0.07, spacing: 4,  len: 0.3,  speed: 6,  k: 1.8 },
    dc:   { r: 0.13, spacing: 7,  len: 0.28, speed: 9,  k: 1.6 },
    cab:  { r: 0.12, spacing: 3.5, len: 0.35, speed: 5, k: 2.0 }
  }
};

// Catenary-ish sag between two points (parabola), n samples, excluding the start point when skipFirst.
export function sagPoints(a, b, sag, n = 12, skipFirst = false) {
  const out = [];
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= sag * 4 * t * (1 - t);
    out.push(p);
  }
  return out;
}
// A path through several attachment points, sagging on every span.
export function spanPath(points, sagRatio = 0.03, minSag = 0.3) {
  const out = [points[0].clone()];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    out.push(...sagPoints(a, b, Math.max(minSag, d * sagRatio), Math.max(4, Math.round(d / 6)), true));
  }
  return out;
}

export function createFlows(tokens) {
  const paths = [];   // { id, group, kind, color, points, length }
  const groups = new Map(); // group -> [path indices]

  function add(group, kind, color, points) {
    if (paths.length >= FLOW.maxPaths) { console.warn('[flows] too many paths'); return -1; }
    const id = paths.length;
    let L = 0; for (let i = 1; i < points.length; i++) L += points[i].distanceTo(points[i - 1]);
    paths.push({ id, group, kind, color, points, length: L });
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(id);
    return id;
  }

  const state = new Float32Array(FLOW.maxPaths * 4);       // current: vis, speedScale, fill, fillDir
  const target = new Float32Array(FLOW.maxPaths * 4);
  const uState = [];
  for (let i = 0; i < FLOW.maxPaths; i++) uState.push(new THREE.Vector4(1, 1, 1, 1));
  let mesh = null;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uGain: { value: FLOW.gain }, uBase: { value: FLOW.base }, uDash: { value: FLOW.dash } }]);
  uniforms.uState = { value: uState };

  function build() {
    const geoms = [];
    for (const p of paths) {
      const K = FLOW.kinds[p.kind];
      const curve = new THREE.CatmullRomCurve3(p.points, false, 'centripetal');
      const segs = Math.max(6, Math.min(400, Math.round(p.length / 2.5)));
      const g = new THREE.TubeGeometry(curve, segs, K.r, 4, false);
      const count = g.attributes.position.count;
      const aR = new Float32Array(count).fill(K.r), aS = new Float32Array(count), aInfo = new Float32Array(count * 4), aCol = new Float32Array(count * 3);
      const ring = 5; // radialSegments + 1
      const c = new THREE.Color(p.color).multiplyScalar(K.k);
      for (let v = 0; v < count; v++) {
        const i = Math.floor(v / ring);
        aS[v] = (i / segs) * p.length;
        aInfo.set([p.id, p.length, K.spacing, K.speed], v * 4);
        aCol.set([c.r, c.g, c.b], v * 3);
      }
      g.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
      g.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
      g.setAttribute('aInfo', new THREE.BufferAttribute(aInfo, 4));
      g.setAttribute('aCol', new THREE.BufferAttribute(aCol, 3));
      g.deleteAttribute('uv');
            geoms.push(g);
    }
    const geo = mergeGeometries(geoms, false);
    const mat = new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      defines: { MAXP: FLOW.maxPaths },
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        attribute float aS, aR; attribute vec4 aInfo; attribute vec3 aCol;
        varying float vS; varying vec4 vInfo; varying vec3 vCol;
        void main() {
          vS = aS; vInfo = aInfo; vCol = aCol;
          float grow = clamp(length(cameraPosition - position) / 70.0, 1.0, 6.0);
          vec4 mvPosition = modelViewMatrix * vec4(position + normal * aR * (grow - 1.0), 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        uniform vec4 uState[MAXP]; uniform float uTime, uGain, uBase, uDash;
        varying float vS; varying vec4 vInfo; varying vec3 vCol;
        void main() {
          int id = int(vInfo.x + 0.5);
          vec4 st = uState[id];
          float L = vInfo.y, spacing = vInfo.z, speed = vInfo.w * st.y;
          float u = vS / L;
          float fu = st.w > 0.0 ? u : 1.0 - u;
          float fill = st.z >= 0.999 ? 1.0 : 1.0 - smoothstep(st.z - 0.02, st.z + 0.005, fu);
          float front = exp(-pow((fu - st.z) * L / 6.0, 2.0)) * step(st.z, 0.995) * step(0.005, st.z);
          float ph = fract((vS - uTime * speed) / spacing);
          // comet-shaped dash: bright head, soft tail (head direction follows the speed sign)
          float d = speed >= 0.0 ? 1.0 - ph : ph;
          float dash = smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.05, 0.32, d));
          float I = (uBase + dash * uDash) * st.x * fill + front * 4.0 * st.x;
          vec3 col = vCol * I * uGain;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'energy_flows';
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    for (let i = 0; i < paths.length; i++) { target.set([1, 1, 1, 1], i * 4); state.set([1, 1, 1, 1], i * 4); }
    return mesh;
  }

  // set(group, { vis, speed, fill, dir }) sets targets; fill/dir jump immediately (they are animated by the caller)
  function set(group, o) {
    const ids = groups.get(group); if (!ids) return;
    for (const id of ids) {
      const k = id * 4;
      if (o.vis != null) target[k] = o.vis;
      if (o.speed != null) target[k + 1] = o.speed;
      if (o.fill != null) { target[k + 2] = o.fill; state[k + 2] = o.fill; }
      if (o.dir != null) { target[k + 3] = o.dir; state[k + 3] = o.dir; }
    }
  }

  function update(dt, time) {
    const a = 1 - Math.exp(-dt * FLOW.ease);
    for (let i = 0; i < paths.length; i++) {
      const k = i * 4;
      state[k] += (target[k] - state[k]) * a;
      state[k + 1] += (target[k + 1] - state[k + 1]) * Math.min(1, a * 2);
      uState[i].set(state[k], state[k + 1], state[k + 2], state[k + 3]);
    }
    uniforms.uTime.value = time;
  }

  return { add, build, set, update, paths, groups, get mesh() { return mesh; }, uniforms };
}
