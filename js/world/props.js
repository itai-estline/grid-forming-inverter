// World prop registry (PLAN 5.4).
// Each prop tries assets/models/world/<name>.glb first; if it is missing, a procedural stand-in with the
// SAME node names, sizes and material names is built, so the real model drops in with no code change.
// Materials named mat_window / mat_porch / mat_lamp / mat_nav_light / mat_status / mat_door_glow are
// replaced by engine-driven emissive materials (the engine controls their glow, also per instance).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PROP_NAMES = [
  'solar_table', 'wind_turbine', 'battery_container', 'inverter_station', 'transformer', 'transmission_tower',
  'substation', 'dist_pole', 'house_a', 'house_b', 'house_c', 'grid_cabinet', 'power_plant', 'cooling_tower',
  'street_light', 'tree_a', 'tree_b'
];
export const PROP_DIR = 'assets/models/world/';

// Base colours of the stand-ins (dusk-lit, so slightly lighter than a daylight albedo would be).
const PALETTE = {
  concrete: 0x6d7480, concreteDark: 0x4a505c, steel: 0x7d8796, galv: 0x9aa4b2, white: 0xc9d0da,
  roofA: 0x3a3f4a, roofB: 0x4a3c38, roofC: 0x343a44, wallA: 0x8c8378, wallB: 0x7a8590, wallC: 0x9a8f80,
  panel: 0x1b2c5a, frame: 0x8a929e, container: 0xa9b1bb, cabinet: 0x8e98a6, foliage: 0x22352e, foliage2: 0x2c3a2a,
  trunk: 0x3b2f27, insulator: 0x8fa8b8, copper: 0xb87333, rotor: 0x9aa3ae, rotorDark: 0x3c4450, asphalt: 0x1a1e26
};

const matCache = new Map();
function M(name, color, opts = {}) {
  const key = name;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.75, metalness: opts.metalness ?? 0.0, ...opts.extra });
  m.name = name;
  if (opts.side) m.side = opts.side;
  if (opts.map) m.map = opts.map;
  matCache.set(key, m);
  return m;
}

// ---------- geometry helpers ----------
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
function place(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  _m4.compose(_v.set(x, y, z), _q, _s);
  g.applyMatrix4(_m4);
  return g;
}
const box = (w, h, d, x, y, z, rx, ry, rz) => place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const cyl = (rt, rb, h, seg, x, y, z, rx, ry, rz) => place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz);
function strut(a, b, t) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(t, t, len);
  const dir = _v.subVectors(b, a).normalize();
  _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  _m4.compose(mid, _q, _s);
  g.applyMatrix4(_m4);
  return g;
}
function merge(list) {
  const clean = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  const out = mergeGeometries(clean, false);
  out.computeBoundingSphere();
  return out;
}
function mesh(name, geoms, mat, opts = {}) {
  const m = new THREE.Mesh(Array.isArray(geoms) ? merge(geoms) : geoms, mat);
  m.name = name;
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  return m;
}
function empty(name, x, y, z) { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); return o; }

// Gable prism (triangle in the XY plane, extruded along Z), built non-indexed with normals.
// spanZ = base width (along z), lengthX = extrusion (ridge along x).
function gable(spanZ, h, lengthX, y0) {
  const s = new THREE.Shape();
  s.moveTo(-spanZ / 2, 0); s.lineTo(spanZ / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: lengthX, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(-lengthX / 2, y0, 0);
  return g;
}

// ---------- textures ----------
let _cellTex = null;
function cellTexture() {
  if (_cellTex) return _cellTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1a2a52'; g.fillRect(0, 0, 256, 128);
  const cols = 12, rows = 6;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = i * 256 / cols, y = j * 128 / rows;
    const grd = g.createLinearGradient(x, y, x + 20, y + 20);
    grd.addColorStop(0, '#22386c'); grd.addColorStop(1, '#152548');
    g.fillStyle = grd; g.fillRect(x + 1.2, y + 1.2, 256 / cols - 2.4, 128 / rows - 2.4);
  }
  g.strokeStyle = 'rgba(170,190,230,0.35)'; g.lineWidth = 1;
  g.strokeRect(1, 1, 254, 126);
  _cellTex = new THREE.CanvasTexture(c);
  _cellTex.colorSpace = THREE.SRGBColorSpace;
  _cellTex.anisotropy = 8;
  return _cellTex;
}

// ---------- procedural stand-ins ----------
const BUILD = {
  solar_table() {
    const g = new THREE.Group();
    const tilt = THREE.MathUtils.degToRad(25);
    const cy = 0.8 + 2.0 * Math.sin(tilt);
    const panel = new THREE.BoxGeometry(6.6, 0.05, 4.0);
    place(panel, 0, cy, 0, tilt, 0, 0);
    const pm = M('mat_panel', 0xffffff, { roughness: 0.22, metalness: 0.35, map: cellTexture() });
    g.add(mesh('panels', panel, pm));
    const fr = [];
    for (const x of [-2.6, 0, 2.6]) {
      fr.push(box(0.12, 0.85, 0.12, x, 0.42, 1.55));
      fr.push(box(0.12, 2.5, 0.12, x, 1.25, -1.55));
      fr.push(strut(new THREE.Vector3(x, 0.8, 1.81), new THREE.Vector3(x, 2.49, -1.81), 0.1));
    }
    fr.push(place(new THREE.BoxGeometry(6.6, 0.08, 0.08), 0, 1.2, 0.95, tilt, 0, 0));
    fr.push(place(new THREE.BoxGeometry(6.6, 0.08, 0.08), 0, 2.0, -0.85, tilt, 0, 0));
    g.add(mesh('frame', fr, M('mat_frame', PALETTE.frame, { roughness: 0.45, metalness: 0.7 })));
    return g;
  },

  wind_turbine() {
    const g = new THREE.Group();
    const white = M('mat_turbine', PALETTE.white, { roughness: 0.55 });
    g.add(mesh('tower', [cyl(1.1, 2.1, 58.5, 16, 0, 29.25, 0), cyl(2.4, 2.6, 0.6, 16, 0, 0.3, 0)], white));
    g.add(mesh('nacelle', [box(3.0, 3.2, 8.0, 0, 60, -1.2), cyl(1.5, 1.5, 0.6, 12, 0, 60, 2.9, Math.PI / 2)], white));
    const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.position.set(0, 60, 3.6);
    const parts = [place(new THREE.ConeGeometry(1.3, 2.6, 14), 0, 0, 1.0, Math.PI / 2, 0, 0), place(new THREE.SphereGeometry(1.3, 14, 10), 0, 0, 0)];
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const blade = new THREE.CylinderGeometry(0.18, 0.75, 24, 6, 1);
      blade.scale(1, 1, 0.32);
      blade.rotateY(0.3);
      blade.translate(0, 13.2, 0);
      place(blade, 0, 0, 0, 0, 0, a);
      parts.push(blade);
    }
    rotor.add(mesh('rotor_mesh', parts, white));
    g.add(rotor);
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), M('mat_nav_light', 0xff2020));
    nav.name = 'nav_light'; nav.position.set(0, 61.8, -4.2); nav.castShadow = false;
    g.add(nav);
    return g;
  },

  battery_container() {
    const g = new THREE.Group();
    const body = [box(12.2, 2.9, 2.44, 0, 1.45, 0)];
    for (let i = -5; i <= 5; i++) { body.push(box(0.08, 2.6, 0.06, i * 1.08, 1.45, 1.24)); body.push(box(0.08, 2.6, 0.06, i * 1.08, 1.45, -1.24)); }
    body.push(box(1.6, 1.2, 1.9, 5.1, 3.5, 0)); // HVAC unit on the roof
    g.add(mesh('body', body, M('mat_container', PALETTE.container, { roughness: 0.6, metalness: 0.2 })));
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.04), M('mat_status', 0x7cf29c));
    st.name = 'status_light'; st.position.set(-5.2, 2.4, 1.3); st.castShadow = false;
    g.add(st);
    return g;
  },

  inverter_station() {
    const g = new THREE.Group();
    const body = [box(8, 3.6, 5, 0, 1.8, 0), box(8.4, 0.18, 5.4, 0, 3.69, 0), box(8.2, 0.3, 5.2, 0, 0.15, 0)];
    g.add(mesh('body', body, M('mat_station', 0xb3bac4, { roughness: 0.55, metalness: 0.25 })));
    const lv = [];
    for (let i = 0; i < 6; i++) { lv.push(box(1.6, 0.07, 0.12, -2.4, 1.4 + i * 0.22, 2.53, -0.5)); lv.push(box(1.6, 0.07, 0.12, 2.4, 1.4 + i * 0.22, 2.53, -0.5)); }
    g.add(mesh('louvres', lv, M('mat_louvre', 0x5d6673, { roughness: 0.5, metalness: 0.4 })));
    g.add(mesh('door', box(1.2, 2.25, 0.08, 0, 1.43, 2.54), M('mat_door', 0x3d4552, { roughness: 0.45, metalness: 0.5 })));
    const glow = [box(1.42, 0.07, 0.06, 0, 2.6, 2.58), box(0.07, 2.3, 0.06, -0.67, 1.45, 2.58), box(0.07, 2.3, 0.06, 0.67, 1.45, 2.58), box(0.5, 0.12, 0.2, 0, 3.05, 2.65)];
    const dg = mesh('door_glow', glow, M('mat_door_glow', 0x3fe0ff)); dg.castShadow = false;
    g.add(dg);
    g.add(mesh('sign_plate', box(0.6, 0.4, 0.04, 1.1, 1.9, 2.56), M('mat_sign', 0xd8dde4, { roughness: 0.4 })));
    return g;
  },

  transformer() {
    const g = new THREE.Group();
    const body = [box(3, 2.2, 2.5, 0, 1.1, 0), box(3.2, 0.2, 2.7, 0, 2.3, 0), box(1.0, 0.8, 0.8, 1.0, 2.8, -0.6)];
    for (let i = 0; i < 7; i++) { body.push(box(0.06, 1.7, 0.5, -1.2 + i * 0.4, 1.0, 1.5)); body.push(box(0.06, 1.7, 0.5, -1.2 + i * 0.4, 1.0, -1.5)); }
    g.add(mesh('tank', body, M('mat_trafo', 0x5f6b5a, { roughness: 0.6, metalness: 0.3 })));
    const bush = [];
    for (let i = 0; i < 3; i++) {
      const x = -1 + i;
      for (let k = 0; k < 5; k++) bush.push(cyl(0.16, 0.16, 0.08, 10, x, 2.6 + k * 0.18, -0.3));
      bush.push(cyl(0.08, 0.1, 1.0, 8, x, 2.85, -0.3));
      bush.push(cyl(0.07, 0.07, 0.5, 8, x, 2.55, 0.8));
    }
    g.add(mesh('bushings', bush, M('mat_insulator', PALETTE.insulator, { roughness: 0.3 })));
    for (let i = 0; i < 3; i++) { g.add(empty(`hv_${i + 1}`, -1 + i, 3.4, -0.3)); g.add(empty(`lv_${i + 1}`, -1 + i, 2.8, 0.8)); }
    return g;
  },

  transmission_tower() {
    const g = new THREE.Group();
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const s = [];
    const levels = [0, 6, 11.5, 16.5, 21, 25, 30];
    const half = (y) => 4 - (3 / 30) * y * 1.0; // 4 m at the base to 1 m at the top
    const corners = (y) => { const h = half(y); return [V(-h, y, -h), V(h, y, -h), V(h, y, h), V(-h, y, h)]; };
    for (let k = 0; k < 4; k++) s.push(strut(corners(0)[k], corners(30)[k], 0.32));
    for (let L = 0; L < levels.length - 1; L++) {
      const a = corners(levels[L]), b = corners(levels[L + 1]);
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        s.push(strut(a[k], b[k2], 0.12)); s.push(strut(a[k2], b[k], 0.12));
        s.push(strut(b[k], b[k2], 0.14));
      }
    }
    const arms = [[20, 7.5], [24.5, 6.5], [29, 5]];
    for (const [y, len] of arms) {
      s.push(strut(V(-len, y, -0.5), V(len, y, -0.5), 0.22)); s.push(strut(V(-len, y, 0.5), V(len, y, 0.5), 0.22));
      s.push(strut(V(-len, y, 0), V(-half(y - 2.5), y - 2.5, 0), 0.14)); s.push(strut(V(len, y, 0), V(half(y - 2.5), y - 2.5, 0), 0.14));
      for (let x = -len; x <= len; x += 1.5) s.push(strut(V(x, y, -0.5), V(x + 0.75, y, 0.5), 0.08));
    }
    s.push(strut(V(0, 30, 0), V(0, 32.5, 0), 0.2));
    g.add(mesh('lattice', s, M('mat_steel', PALETTE.galv, { roughness: 0.5, metalness: 0.6 })));
    const ins = [];
    arms.forEach(([y, len], i) => {
      for (const sx of [-1, 1]) {
        ins.push(cyl(0.12, 0.12, 2.2, 6, sx * (len - 0.3), y - 1.1, 0));
        for (let k = 0; k < 6; k++) ins.push(cyl(0.28, 0.28, 0.06, 10, sx * (len - 0.3), y - 0.3 - k * 0.32, 0));
        g.add(empty(`wire_${sx < 0 ? 'L' : 'R'}${i + 1}`, sx * (len - 0.3), y - 2.25, 0));
      }
    });
    g.add(mesh('insulators', ins, M('mat_insulator', PALETTE.insulator, { roughness: 0.3 }), { cast: false }));
    return g;
  },

  substation() {
    const g = new THREE.Group();
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const fence = [];
    for (let x = -15; x <= 15; x += 2.5) { fence.push(box(0.08, 2.2, 0.08, x, 1.1, -10)); fence.push(box(0.08, 2.2, 0.08, x, 1.1, 10)); }
    for (let z = -10; z <= 10; z += 2.5) { fence.push(box(0.08, 2.2, 0.08, -15, 1.1, z)); fence.push(box(0.08, 2.2, 0.08, 15, 1.1, z)); }
    for (const y of [0.4, 2.1]) { fence.push(box(30, 0.05, 0.05, 0, y, -10)); fence.push(box(30, 0.05, 0.05, 0, y, 10)); fence.push(box(0.05, 0.05, 20, -15, y, 0)); fence.push(box(0.05, 0.05, 20, 15, y, 0)); }
    g.add(mesh('fence', fence, M('mat_fence', 0x6f7886, { roughness: 0.6, metalness: 0.5 }), { cast: false }));
    g.add(mesh('gravel', box(30, 0.1, 20, 0, 0.05, 0), M('mat_gravel', 0x3c414b, { roughness: 1 }), { cast: false }));
    const st = [];
    for (const x of [-12, 12]) {
      for (const z of [-6, 6]) st.push(strut(V(x, 0, z), V(x, 11, z), 0.4));
      st.push(strut(V(x, 11, -6.2), V(x, 11, 6.2), 0.45));
      st.push(strut(V(x, 9, -6), V(x, 11, -3), 0.15)); st.push(strut(V(x, 9, 6), V(x, 11, 3), 0.15));
    }
    g.add(mesh('gantries', st, M('mat_steel', PALETTE.galv, { roughness: 0.5, metalness: 0.6 })));
    const bus = [];
    for (let i = 0; i < 3; i++) bus.push(cyl(0.12, 0.12, 24, 8, 0, 8.5, -3 + i * 3, 0, 0, Math.PI / 2));
    for (let i = 0; i < 3; i++) for (const x of [-6, 0, 6]) bus.push(cyl(0.1, 0.1, 8.5, 6, x, 4.25, -3 + i * 3));
    g.add(mesh('bus_bars', bus, M('mat_alu', 0xb9c0ca, { roughness: 0.35, metalness: 0.8 })));
    const brk = [];
    for (const x of [-6, 6]) for (let i = 0; i < 3; i++) { brk.push(cyl(0.35, 0.35, 2.4, 10, x, 1.6, -3 + i * 3)); brk.push(box(1.0, 0.8, 1.0, x, 0.4, -3 + i * 3)); }
    g.add(mesh('breakers', brk, M('mat_breaker', 0x8a95a3, { roughness: 0.5, metalness: 0.3 })));
    const tr = [];
    for (const x of [-4, 4]) {
      tr.push(box(4, 3.2, 3, x, 1.6, 6.5));
      for (let i = 0; i < 8; i++) tr.push(box(0.06, 2.4, 0.6, x - 1.75 + i * 0.5, 1.4, 8.3));
      for (let i = 0; i < 3; i++) tr.push(cyl(0.12, 0.16, 1.4, 8, x - 1 + i, 3.9, 6.0));
    }
    g.add(mesh('transformers', tr, M('mat_trafo', 0x5f6b5a, { roughness: 0.6, metalness: 0.3 })));
    const lamps = [box(0.5, 0.2, 0.3, -12, 11.4, 0), box(0.5, 0.2, 0.3, 12, 11.4, 0)];
    const lm = mesh('yard_lamps', lamps, M('mat_lamp', 0xffe2b0), { cast: false }); g.add(lm);
    for (let i = 0; i < 3; i++) { g.add(empty(`in_${i + 1}`, -12, 10.6, -3 + i * 3)); g.add(empty(`out_${i + 1}`, 12, 10.6, -3 + i * 3)); }
    return g;
  },

  dist_pole() {
    const g = new THREE.Group();
    g.add(mesh('pole', [cyl(0.12, 0.17, 10, 8, 0, 5, 0), box(2.4, 0.12, 0.12, 0, 9.3, 0), strut(new THREE.Vector3(-0.8, 9.25, 0), new THREE.Vector3(0, 8.5, 0), 0.06), strut(new THREE.Vector3(0.8, 9.25, 0), new THREE.Vector3(0, 8.5, 0), 0.06)], M('mat_wood', 0x4b3d33, { roughness: 0.9 })));
    const ins = [];
    for (const x of [-1.05, 0, 1.05]) ins.push(cyl(0.06, 0.08, 0.3, 8, x, 9.5, 0));
    g.add(mesh('insulators', ins, M('mat_insulator', PALETTE.insulator, { roughness: 0.3 }), { cast: false }));
    g.add(mesh('pole_transformer', [cyl(0.32, 0.32, 0.95, 12, 0.42, 7.4, 0), box(0.1, 0.4, 0.1, 0.2, 7.4, 0)], M('mat_can', 0x7d8794, { roughness: 0.45, metalness: 0.5 })));
    g.add(empty('wire_1', -1.05, 9.68, 0)); g.add(empty('wire_2', 0, 9.68, 0)); g.add(empty('wire_3', 1.05, 9.68, 0));
    g.add(empty('drop', 0.42, 7.0, 0));
    return g;
  },

  house_a() { return house('a'); },
  house_b() { return house('b'); },
  house_c() { return house('c'); },

  grid_cabinet() {
    const g = new THREE.Group();
    const body = [box(2.4, 1.9, 1.0, 0, 1.0, 0), box(2.5, 0.08, 1.1, 0, 1.99, 0), box(2.4, 0.1, 1.0, 0, 0.05, 0)];
    for (let i = 0; i < 6; i++) body.push(box(0.5, 0.04, 0.03, 0.75, 0.4 + i * 0.12, 0.51));
    body.push(box(0.02, 1.6, 0.02, 0, 1.0, 0.51));
    g.add(mesh('body', body, M('mat_cabinet', PALETTE.cabinet, { roughness: 0.5, metalness: 0.35 })));
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.04), M('mat_status', 0x7cf29c));
    st.name = 'status'; st.position.set(-0.2, 1.72, 0.52); st.castShadow = false;
    g.add(st);
    return g;
  },

  power_plant() {
    const g = new THREE.Group();
    const W = 40, D = 20, H = 14;
    const conc = M('mat_hall', PALETTE.concrete, { roughness: 0.85 });
    const hall = [
      box(W, 0.4, D, 0, 0.2, 0),                     // floor slab
      box(W, H, 0.5, 0, H / 2, -D / 2 + 0.25),        // back wall
      box(0.5, H, D, -W / 2 + 0.25, H / 2, 0),        // end walls
      box(0.5, H, D, W / 2 - 0.25, H / 2, 0),
      box(W, 0.5, D / 2, 0, H, -D / 4),               // half roof (back half)
      box(W, 1.2, 0.6, 0, H - 0.6, 0.2),              // roof edge beam
      box(W * 0.35, 1.2, 0.5, -W * 0.325, 0.6 + 0.0, D / 2 - 0.25) // low stub of the cut front wall
    ];
    for (let x = -W / 2 + 4; x < W / 2; x += 6) {
      hall.push(box(0.6, H, 0.6, x, H / 2, D / 2 - 0.3));          // front columns
      hall.push(box(0.4, 0.8, D / 2, x, H - 0.4, D / 4));          // exposed roof trusses over the cut half
      hall.push(strut(new THREE.Vector3(x, H - 0.8, D / 2 - 0.3), new THREE.Vector3(x, H - 3.5, D / 2 - 3.5), 0.3));
    }
    hall.push(box(W, 0.5, 0.5, 0, H - 2.0, D / 2 - 0.3)); // crane rail
    hall.push(box(1.2, 1.0, D - 2, 4, H - 2.7, 0));       // overhead crane bridge
    g.add(mesh('hall', hall, conc));
    // window band on the back wall, glowing faintly from inside
    const winb = mesh('hall_windows', [box(W - 4, 1.6, 0.1, 0, H - 3.5, -D / 2 + 0.55)], M('mat_window', 0xffe2b0), { cast: false });
    g.add(winb);
    const ped = [box(18, 2.2, 3.2, 0, 1.3, -1), box(4, 3.0, 4.2, -8.2, 1.7, -1), box(4, 3.0, 4.2, 8.2, 1.7, -1)];
    g.add(mesh('pedestal', ped, M('mat_pedestal', PALETTE.concreteDark, { roughness: 0.9 })));
    // generator rotor: shaft + turbine discs + generator drum, origin on the axis, spin axis local X
    const rotor = new THREE.Group(); rotor.name = 'generator_rotor'; rotor.position.set(0, 4.4, -1);
    const R = [cyl(0.35, 0.35, 16, 16, 0, 0, 0, 0, 0, Math.PI / 2)];
    const discs = [[-6.2, 1.05], [-5.4, 1.15], [-4.6, 1.25], [-3.6, 1.4], [-2.6, 1.5], [-1.6, 1.55]];
    for (const [x, r] of discs) R.push(cyl(r, r, 0.35, 28, x, 0, 0, 0, 0, Math.PI / 2));
    const drum = [cyl(1.5, 1.5, 5.6, 32, 3.6, 0, 0, 0, 0, Math.PI / 2)];
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; drum.push(box(5.4, 0.12, 0.25, 3.6, Math.cos(a) * 1.5, Math.sin(a) * 1.5, a, 0, 0)); }
    const rotMesh = mesh('rotor_body', R, M('mat_rotor', PALETTE.rotor, { roughness: 0.3, metalness: 0.9 }));
    const drumMesh = mesh('rotor_drum', drum, M('mat_copper', PALETTE.copper, { roughness: 0.35, metalness: 0.85 }));
    rotor.add(rotMesh, drumMesh);
    g.add(rotor);
    // stator / casings: lower half shells
    const half = (r, len, x) => { const c = new THREE.CylinderGeometry(r, r, len, 32, 1, true, Math.PI, Math.PI); place(c, x, 4.4, -1, 0, 0, Math.PI / 2); return c; };
    const stator = [half(2.0, 6.2, 3.6), half(1.9, 5.6, -4.0), box(6.2, 0.3, 4.4, 3.6, 2.5, -1), box(5.6, 0.3, 4.2, -4.0, 2.5, -1)];
    g.add(mesh('generator_stator', stator, M('mat_stator', 0x56606e, { roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide })));
    const stack = mesh('stack', [cyl(1.6, 2.4, 46, 16, -14, 23, -16), cyl(1.75, 1.75, 1.2, 16, -14, 45.2, -16)], conc);
    g.add(stack);
    // warm interior lamps
    const lamps = [];
    for (let x = -15; x <= 15; x += 6) lamps.push(box(1.2, 0.15, 0.5, x, H - 0.75, -4));
    g.add(mesh('hall_lamps', lamps, M('mat_lamp', 0xffe2b0), { cast: false }));
    return g;
  },

  cooling_tower() {
    const pts = [];
    const r0 = 14, rw = 8.6, yw = 28, H = 38;
    for (let i = 0; i <= 24; i++) {
      const y = (i / 24) * H;
      const a = (y - yw) / (y < yw ? yw : H - yw);
      const r = rw + (y < yw ? (r0 - rw) : (10.2 - rw)) * a * a;
      pts.push(new THREE.Vector2(r, y));
    }
    const g = new THREE.Group();
    const geo = new THREE.LatheGeometry(pts, 40);
    g.add(mesh('shell', geo, M('mat_tower_shell', 0x7b818b, { roughness: 0.9, side: THREE.DoubleSide })));
    const legs = [];
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; legs.push(strut(new THREE.Vector3(Math.cos(a) * 14.4, 0, Math.sin(a) * 14.4), new THREE.Vector3(Math.cos(a + 0.12) * 13.8, 2.2, Math.sin(a + 0.12) * 13.8), 0.35)); }
    g.add(mesh('legs', legs, M('mat_hall', PALETTE.concrete, { roughness: 0.85 })));
    return g;
  },

  street_light() {
    const g = new THREE.Group();
    g.add(mesh('pole', [cyl(0.07, 0.11, 7, 8, 0, 3.5, 0), strut(new THREE.Vector3(0, 6.9, 0), new THREE.Vector3(0, 7.0, 1.4), 0.07)], M('mat_pole', 0x5a6270, { roughness: 0.5, metalness: 0.6 })));
    const lamp = mesh('lamp', box(0.5, 0.12, 0.28, 0, 6.92, 1.5), M('mat_lamp', 0xffe2b0), { cast: false });
    g.add(lamp);
    return g;
  },

  tree_a() {
    const g = new THREE.Group();
    g.add(mesh('trunk', cyl(0.14, 0.22, 2.0, 6, 0, 1.0, 0), M('mat_trunk', PALETTE.trunk, { roughness: 0.95 })));
    g.add(mesh('crown', [place(new THREE.ConeGeometry(2.4, 4.0, 8), 0, 3.4, 0), place(new THREE.ConeGeometry(1.8, 3.4, 8), 0, 5.4, 0), place(new THREE.ConeGeometry(1.1, 2.6, 8), 0, 7.2, 0)], M('mat_foliage', PALETTE.foliage, { roughness: 0.95 })));
    return g;
  },
  tree_b() {
    const g = new THREE.Group();
    g.add(mesh('trunk', cyl(0.16, 0.26, 2.6, 6, 0, 1.3, 0), M('mat_trunk', PALETTE.trunk, { roughness: 0.95 })));
    const c1 = new THREE.IcosahedronGeometry(2.6, 1); c1.scale(1, 0.9, 1); c1.translate(0, 4.2, 0);
    const c2 = new THREE.IcosahedronGeometry(1.7, 1); c2.translate(1.2, 5.2, 0.6);
    const c3 = new THREE.IcosahedronGeometry(1.6, 1); c3.translate(-1.0, 5.0, -0.8);
    g.add(mesh('crown', [c1, c2, c3], M('mat_foliage2', PALETTE.foliage2, { roughness: 0.95, extra: { flatShading: true } })));
    return g;
  }
};

function house(variant) {
  const g = new THREE.Group();
  const W = 9, D = 8, wallH = variant === 'c' ? 5.6 : 3.4, roofH = variant === 'c' ? 1.6 : 3.4;
  const wallC = { a: PALETTE.wallA, b: PALETTE.wallB, c: PALETTE.wallC }[variant];
  const roofC = { a: PALETTE.roofA, b: PALETTE.roofB, c: PALETTE.roofC }[variant];
  const walls = [box(W, wallH, D, 0, wallH / 2, 0), gable(D, roofH * 0.98, W - 0.02, wallH)];
  if (variant === 'a') walls.push(box(3.2, 2.8, 2.4, -2.4, 1.4, D / 2 + 1.2)); // small porch block
  g.add(mesh('walls', walls, M(`mat_wall_${variant}`, wallC, { roughness: 0.85 })));
  // roof: two slabs along x (ridge along x), overhanging
  const slope = Math.atan2(roofH, D / 2);
  const len = Math.hypot(roofH, D / 2) + 0.5;
  const roof = [
    box(W + 0.6, 0.18, len, 0, wallH + roofH / 2 + 0.05, D / 4 + 0.08, slope, 0, 0),
    box(W + 0.6, 0.18, len, 0, wallH + roofH / 2 + 0.05, -D / 4 - 0.08, -slope, 0, 0)
  ];
  if (variant === 'a') roof.push(box(3.6, 0.15, 2.8, -2.4, 2.9, D / 2 + 1.2));
  g.add(mesh('roof', roof, M(`mat_roof_${variant}`, roofC, { roughness: 0.8 })));
  g.add(mesh('chimney', box(0.7, 2.0, 0.7, W / 2 - 1.6, wallH + roofH * 0.7, -1.2), M('mat_brick', 0x6b4a40, { roughness: 0.9 })));
  // windows (front +Z, back, sides); engine drives their glow
  const win = [];
  const front = variant === 'a' ? [1.0, 3.2] : [-3.0, -0.8, 1.6, 3.4];
  const rows = variant === 'c' ? [1.6, 4.2] : [1.7];
  for (const y of rows) for (const x of front) { win.push(box(1.1, 1.2, 0.08, x, y, D / 2 + 0.03)); win.push(box(1.1, 1.2, 0.08, x * 0.9, y, -D / 2 - 0.03)); }
  for (const y of rows) { win.push(box(0.08, 1.1, 1.2, W / 2 + 0.03, y, 1.5)); win.push(box(0.08, 1.1, 1.2, -W / 2 - 0.03, y, -1.5)); }
  if (variant !== 'c') win.push(box(0.9, 0.9, 0.08, 0, wallH + 1.0, D / 2 + 0.02));
  g.add(mesh('windows', win, M('mat_window', 0xffe2b0), { cast: false }));
  const doorX = variant === 'a' ? -2.4 : -1.0;
  const doorZ = variant === 'a' ? D / 2 + 2.42 : D / 2 + 0.04;
  g.add(mesh('door', box(1.0, 2.1, 0.06, doorX, 1.05, doorZ), M('mat_door_house', 0x3a2c26, { roughness: 0.7 })));
  const porch = mesh('porch_light', box(0.22, 0.22, 0.12, doorX + 0.85, 2.4, doorZ + 0.06), M('mat_porch', 0xffe2b0), { cast: false });
  g.add(porch);
  if (variant === 'b') {
    const pv = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const z = D / 2 * (0.68 - j * 0.42);
      pv.push(place(new THREE.BoxGeometry(1.7, 0.06, 1.3), -2.9 + i * 1.95, wallH + roofH * (1 - z / (D / 2)) + 0.24, z, slope, 0, 0));
    }
    const pvGroup = merge(pv);
    g.add(mesh('roof_solar', pvGroup, M('mat_panel', 0xffffff, { roughness: 0.22, metalness: 0.35, map: cellTexture() })));
  }
  return g;
}

// ---------- engine emissive materials ----------
// Shared MeshBasicMaterials with HDR colours (> 1 blooms). Instanced meshes add per-instance colour.
export function createGlowMaterials(tokens) {
  const C = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
  const mk = (name, color) => { const m = new THREE.MeshBasicMaterial({ color }); m.name = name + '_engine'; m.userData.base = color.clone(); return m; };
  return {
    mat_window: mk('mat_window', new THREE.Color(1, 1, 1)),       // instance colour carries the glow
    mat_porch: mk('mat_porch', C(tokens.home, 4.0)),
    mat_lamp: mk('mat_lamp', new THREE.Color(1, 1, 1)),
    mat_nav_light: mk('mat_nav_light', C(0xff2a20, 5.0)),
    mat_status: mk('mat_status', C(tokens.inv1, 3.0)),
    mat_door_glow: mk('mat_door_glow', C(tokens.ac, 3.5))
  };
}

// Replace placeholder/glb emissive materials by the engine's materials.
function adoptMaterials(root, glow) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => (m && glow[m.name]) ? glow[m.name] : m;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    if (o.material && glow[o.material.name?.replace('_engine', '')]) { o.castShadow = false; }
  });
}

// ---------- registry ----------
export async function loadProps(ctx, glow, onEach) {
  const out = {};
  let done = 0;
  await Promise.all(PROP_NAMES.map(async (name) => {
    let root = null, source = 'procedural';
    try {
      const gltf = await ctx.loadGLB(PROP_DIR + name + '.glb');
      if (gltf && gltf.scene) { root = gltf.scene; source = 'glb'; root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }
    } catch (e) { root = null; }
    if (!root) root = BUILD[name]();
    root.name = name;
    root.userData.source = source;
    adoptMaterials(root, glow);
    out[name] = root;
    done++; onEach && onEach(done / PROP_NAMES.length);
  }));
  return out;
}

// Build InstancedMeshes from a template for many transforms.
// Returns { group, meshes: [{ mesh, materialName }] }. Meshes with an engine glow material get instanceColor.
const _rel = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _mm = new THREE.Matrix4();
export function instancify(template, matrices, opts = {}) {
  const group = new THREE.Group();
  group.name = template.name + '_instances';
  template.updateMatrixWorld(true);
  _inv.copy(template.matrixWorld).invert();
  const meshes = [];
  template.traverse((o) => {
    if (!o.isMesh) return;
    _rel.multiplyMatrices(_inv, o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
    im.name = o.name + '_inst';
    for (let i = 0; i < matrices.length; i++) { _mm.multiplyMatrices(matrices[i], _rel); im.setMatrixAt(i, _mm); }
    im.instanceMatrix.needsUpdate = true;
    const isGlow = o.material && /_engine$/.test(o.material.name);
    if (isGlow) {
      const base = o.material.userData.base || new THREE.Color(1, 1, 1);
      for (let i = 0; i < matrices.length; i++) im.setColorAt(i, opts.glowColor ? opts.glowColor(i, o.material.name) : base);
      im.instanceColor.needsUpdate = true;
    }
    im.castShadow = !isGlow && (opts.cast ?? o.castShadow);
    im.receiveShadow = !isGlow && (opts.receive ?? true);
    im.computeBoundingSphere();
    im.frustumCulled = true;
    group.add(im);
    meshes.push({ mesh: im, materialName: (o.material.name || '').replace('_engine', ''), nodeName: o.name });
  });
  return { group, meshes };
}

// Placement matrix helper.
export function T(x, y, z, ry = 0, s = 1) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));
}

// Find an attachment empty in a placed (cloned or virtual) prop: returns world position.
export function attachPoint(template, nodeName, matrix, fallback) {
  const node = template.getObjectByName(nodeName);
  const v = new THREE.Vector3();
  if (node) {
    template.updateMatrixWorld(true);
    _inv.copy(template.matrixWorld).invert();
    v.setFromMatrixPosition(_rel.multiplyMatrices(_inv, node.matrixWorld));
  } else if (fallback) v.copy(fallback);
  return v.applyMatrix4(matrix);
}
