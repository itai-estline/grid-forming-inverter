// World environment: dusk sky dome with stars, procedural ground with distant hills, fog, lights, env map.
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export const ENV = {
  fogDensity: 0.0009,
  sky: { zenith: 0x060914, upper: 0x111b36, horizon: 0x2b3b60, dusk: 0xe08a4a, duskStrength: 1.5, duskWidth: 0.55 },
  ground: { color: 0x39424f, far: 0x222a38 },
  hemi: { sky: 0x566384, ground: 0x0e131f, intensity: 3.5 },
  moon: { color: 0xb4c6ff, intensity: 2.7, dir: [0.35, 0.75, 0.55] },
  rim: { color: 0xffa264, intensity: 1.5, dir: [-1, 0.14, 0.12] },
  envIntensity: 0.8,
  stars: 520,
  flatRadius: 650
};

export function buildSky(tokens) {
  const S = ENV.sky;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZen: { value: new THREE.Color(S.zenith) }, uUp: { value: new THREE.Color(S.upper) }, uHor: { value: new THREE.Color(S.horizon) },
      uDusk: { value: new THREE.Color(S.dusk) }, uDuskK: { value: S.duskStrength }, uDuskW: { value: S.duskWidth }, uDim: { value: 0 }
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uZen, uUp, uHor, uDusk; uniform float uDuskK, uDuskW, uDim; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float e = clamp(d.y, -0.2, 1.0);
        vec3 c = mix(uHor, uUp, smoothstep(0.0, 0.18, e));
        c = mix(c, uZen, smoothstep(0.18, 0.75, e));
        // warm band low in the west (-X)
        vec2 h = normalize(d.xz + 1e-5);
        float west = pow(max(0.0, -h.x), 2.2);
        float band = exp(-max(e, 0.0) * 22.0) * west * smoothstep(-0.06, 0.0, e);
        float glow = exp(-max(e, 0.0) * 6.0) * pow(max(0.0, -h.x), 1.5) * 0.35;
        c += uDusk * (band * uDuskK + glow * 0.5) * (1.0 - 0.6 * uDim);
        c *= 1.0 - 0.35 * uDim;
        if (e < 0.0) c = mix(c, uHor * 0.8, smoothstep(0.0, -0.08, e));
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4500, 48, 24), mat);
  dome.name = 'sky_dome';
  dome.renderOrder = -10;
  dome.frustumCulled = false;

  // stars: a few hundred points on the upper sky, brighter toward the east (away from the dusk)
  const n = ENV.stars;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const u = rnd(), v = rnd();
    const th = u * Math.PI * 2, y = 0.08 + Math.pow(v, 0.8) * 0.92;
    const r = Math.sqrt(1 - y * y);
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    pos.set([x * 4300, y * 4300, z * 4300], i * 3);
    const east = 0.35 + 0.65 * Math.max(0, (x + 0.3) / 1.3);
    const b = (0.25 + rnd() * 0.75) * east * Math.min(1, y * 3);
    const k = rnd() < 0.04 ? 1.6 : 0.85;
    col.set([b * k * 0.9, b * k * 0.95, b * k * 1.1], i * 3);
    size[i] = 1.0 + rnd() * 1.6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const sm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uDim: { value: 0 } },
    vertexShader: `attribute float aSize; varying vec3 vC; uniform float uTime, uPx; void main(){ vC = color; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; float tw = 0.75 + 0.25 * sin(uTime * 1.3 + position.x * 0.01 + position.z * 0.013); vC *= tw; gl_PointSize = aSize * uPx; }`,
    fragmentShader: `varying vec3 vC; uniform float uDim; void main(){ vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(q)); gl_FragColor = vec4(vC * a * (1.0 + 0.4 * uDim), 1.0); }`,
    vertexColors: true
  });
  const stars = new THREE.Points(g, sm);
  stars.name = 'stars';
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  return { dome, stars };
}

export function buildGround() {
  const noise = new SimplexNoise({ random: (() => { let s = 777; return () => (s = (s * 16807) % 2147483647) / 2147483647; })() });
  const size = 9000, seg = 180;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const near = new THREE.Color(ENV.ground.color), far = new THREE.Color(ENV.ground.far), tmp = new THREE.Color();
  const cx = 150, cz = 40; // centre of the flat area
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const r = Math.hypot(x - cx, z - cz);
    const t = THREE.MathUtils.smoothstep(r, ENV.flatRadius, ENV.flatRadius + 900);
    const n1 = noise.noise(x * 0.0016, z * 0.0016) * 0.5 + 0.5;
    const n2 = noise.noise(x * 0.006, z * 0.006) * 0.5 + 0.5;
    const h = t * (35 + 140 * n1 * n1 + 25 * n2) + (r > 3000 ? (r - 3000) * 0.05 : 0);
    p.setY(i, h);
    const patch = noise.noise(x * 0.012, z * 0.012) * 0.5 + 0.5;
    tmp.copy(near).lerp(far, Math.min(1, t * 1.2));
    tmp.multiplyScalar(0.82 + 0.3 * patch);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  m.name = 'mat_ground';
  const ground = new THREE.Mesh(g, m);
  ground.name = 'ground';
  ground.receiveShadow = true;
  return ground;
}

// Flat ribbons for roads and the town street.
export function buildRoads(paths, width, color, y = 0.06) {
  const geoms = [];
  for (const pts of paths) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
    const n = Math.max(8, Math.round(curve.getLength() / 6));
    const pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n; const a = curve.getPointAt(u); const t = curve.getTangentAt(u);
      const nx = -t.z, nz = t.x; const l = Math.hypot(nx, nz) || 1;
      pos.push(a.x + nx / l * width / 2, y, a.z + nz / l * width / 2, a.x - nx / l * width / 2, y, a.z - nz / l * width / 2);
      if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure normals point up
    const nn = g.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    geoms.push(g);
  }
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.name = 'mat_road';
  const group = new THREE.Group();
  for (const g of geoms) { const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; group.add(mesh); }
  return group;
}

export function buildLights(scene, quality) {
  const hemi = new THREE.HemisphereLight(ENV.hemi.sky, ENV.hemi.ground, ENV.hemi.intensity);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(ENV.moon.color, ENV.moon.intensity);
  moon.position.set(...ENV.moon.dir).multiplyScalar(300);
  moon.castShadow = true;
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.4;
  moon.shadow.radius = 3;
  scene.add(moon);
  scene.add(moon.target);
  const rim = new THREE.DirectionalLight(ENV.rim.color, ENV.rim.intensity);
  rim.position.set(...ENV.rim.dir).multiplyScalar(300);
  scene.add(rim);
  scene.add(rim.target);
  return { hemi, moon, rim };
}
