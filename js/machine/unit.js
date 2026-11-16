// The inverter unit: placeholder geometry (PLAN 6.1 node names, sizes, positions),
// merging with the real unit.glb when it exists, the "rest dims" material system
// and the FEA thermal ramp patch for the heatsink.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NODE_TABLE, REQUIRED_NODES, OPTIONAL_NODES, ROUTES } from './cad.js';
import { applyUnitFixes } from '../core/unit-fix.js';

// ---------------------------------------------------------------------------------------
// Placeholder geometry. Pieces are authored in absolute "gl millimetres":
// X = CADx, Y = CADz, Z = -CADy. makeNode() recentres them so every node has its origin
// at its own bounding-box centre (fan_rotor: on its axis, which is its centre) and scales
// them to glTF metres. The node then sits in the x100 unit root like the real model.
// ---------------------------------------------------------------------------------------

function boxCad(THREE, min, size, radius = 0) {
  const [sx, sy, sz] = size;
  const g = radius > 0
    ? new RoundedBoxGeometry(sx, sz, sy, 2, Math.min(radius, sx / 2, sy / 2, sz / 2))
    : new THREE.BoxGeometry(sx, sz, sy);
  g.translate(min[0] + sx / 2, min[2] + sz / 2, -(min[1] + sy / 2));
  return g;
}

function cylCad(THREE, cx, cy, z0, h, r, seg = 32) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(cx, z0 + h / 2, -cy);
  return g;
}

function makeNode(THREE, name, parts) {
  // parts: [{ geo, mat }]; merges geometries that share a material
  const byMat = new Map();
  for (const p of parts) {
    if (!byMat.has(p.mat)) byMat.set(p.mat, []);
    byMat.get(p.mat).push(p.geo);
  }
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); tmp.copy(p.geo.boundingBox); box.union(tmp); }
  const c = box.getCenter(new THREE.Vector3());
  const node = new THREE.Group();
  node.name = name;
  node.position.copy(c).multiplyScalar(0.001);
  for (const [mat, geos] of byMat) {
    const clean = geos.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
      if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
      return n;
    });
    const g = clean.length > 1 ? mergeGeometries(clean, false) : clean[0];
    g.translate(-c.x, -c.y, -c.z);
    g.scale(0.001, 0.001, 0.001);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = `${name}_${mat.name}`;
    node.add(m);
  }
  return node;
}

// Torus winding: a helix wound around a torus that lies flat (axis = Y)
function windingCurve(THREE, R, a, turns) {
  class Winding extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()) {
      const th = t * Math.PI * 2;
      const ph = th * turns;
      const rr = R + a * Math.cos(ph);
      return out.set(rr * Math.cos(th), a * Math.sin(ph), rr * Math.sin(th));
    }
  }
  return new Winding();
}

function pcbTexture(THREE) {
  const W = 1024, H = 768;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#0d3527';
  g.fillRect(0, 0, W, H);
  const X = (x) => ((x - 40) / 240) * W;
  const Y = (y) => ((190 - y) / 180) * H;
  // copper pours under the routes (slightly lighter mask)
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of ROUTES) {
    if (r.smooth) continue;
    g.strokeStyle = r.group === 'dc' ? '#1a5a40' : '#175237';
    g.lineWidth = r.group === 'dc' ? 26 : 16;
    g.beginPath();
    r.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
    g.stroke();
  }
  // thin signal traces and vias, deterministic pseudo-random
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = 'rgba(46,120,86,0.85)';
  g.lineWidth = 2;
  for (let i = 0; i < 70; i++) {
    let x = rnd() * W, y = rnd() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      if (rnd() > 0.5) x += (rnd() - 0.5) * 260; else y += (rnd() - 0.5) * 200;
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#b9a46a';
    g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
  }
  // silkscreen outlines around footprints
  g.strokeStyle = 'rgba(225,230,220,0.55)';
  g.lineWidth = 2.2;
  for (const [name, n] of Object.entries(NODE_TABLE)) {
    if (n.min[2] < 77 || n.min[2] > 78 || name.startsWith('enclosure')) continue;
    const [x0, y0] = n.min, [sx, sy] = n.size;
    if (name.startsWith('dclink') || name.startsWith('inductor')) {
      g.beginPath(); g.arc(X(x0 + sx / 2), Y(y0 + sy / 2), (sx / 2 + 2) / 240 * W, 0, Math.PI * 2); g.stroke();
    } else {
      g.strokeRect(X(x0 - 2), Y(y0 + sy + 2), (sx + 4) / 240 * W, (sy + 4) / 180 * H);
    }
  }
  // IPM footprint (the module sits under the board)
  g.strokeRect(X(80), Y(112.5), 40 / 240 * W, 25 / 180 * H);
  g.fillStyle = 'rgba(225,230,220,0.6)';
  g.font = '600 15px monospace';
  g.fillText('GFI POWER  REV C', X(48), Y(16));
  g.fillText('DC+  DC-', X(250), Y(194) + 26);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function textTexture(THREE, lines, w, h, color = '#c9ccd2', font = '600 46px monospace') {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((t, i) => g.fillText(t, w / 2, h / 2 + (i - (lines.length - 1) / 2) * h * 0.36));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeMaterials(THREE) {
  const S = (name, color, metalness, roughness, extra = {}) =>
    Object.assign(new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra }), { name });
  return {
    enclosure: S('mat_enclosure', 0x4a525e, 0.65, 0.48),
    alu: S('mat_heatsink', 0xaab3bd, 0.85, 0.36),
    pad: S('mat_thermal_pad', 0x5f7590, 0.0, 0.8),
    epoxy: S('mat_epoxy', 0x16171b, 0.05, 0.52),
    tin: S('mat_pins', 0xc7cbd1, 0.9, 0.3),
    mask: S('mat_pcb_mask', 0x0f3a2a, 0.1, 0.6),
    maskTop: S('mat_pcb_top', 0xffffff, 0.1, 0.55),
    capSleeve: S('mat_cap_sleeve', 0x1b2747, 0.15, 0.38),
    capTop: S('mat_cap_top', 0xb7bdc6, 0.85, 0.32),
    capBand: S('mat_cap_band', 0x8c95a8, 0.1, 0.45),
    core: S('mat_toroid_core', 0x2c3a37, 0.2, 0.6),
    copper: S('mat_copper', 0xc8763e, 1.0, 0.32),
    film: S('mat_film_cap', 0x2f3d58, 0.0, 0.5),
    blackMask: S('mat_ctrl_mask', 0x161b24, 0.1, 0.55),
    chip: S('mat_chip', 0x1a1b1f, 0.1, 0.45),
    passive: S('mat_passive', 0x8a7a62, 0.2, 0.5),
    header: S('mat_header', 0x202227, 0.0, 0.6),
    gold: S('mat_gold', 0xd8b25a, 1.0, 0.3),
    brass: S('mat_standoff', 0xb39a5c, 0.9, 0.35),
    terminal: S('mat_terminal', 0x2d6f55, 0.0, 0.55),
    steel: S('mat_screw', 0x9aa2ac, 0.9, 0.3),
    sensor: S('mat_sensor', 0x1d2026, 0.05, 0.5),
    label: S('mat_label', 0xd8dbe0, 0.0, 0.6),
    fanPlastic: S('mat_fan', 0x23262d, 0.0, 0.62),
    blade: S('mat_fan_blade', 0x2b2f38, 0.0, 0.5)
  };
}

export function buildPlaceholderUnit(THREE, only = null) {
  const M = makeMaterials(THREE);
  const want = (n) => !only || only.includes(n);
  const nodes = {};
  const T = NODE_TABLE;

  if (want('enclosure_base')) {
    const t = 1.5;
    nodes.enclosure_base = makeNode(THREE, 'enclosure_base', [
      { geo: boxCad(THREE, [-t, -t, -t], [303, 203, t], 0.6), mat: M.enclosure },
      { geo: boxCad(THREE, [-t, -t, -t], [t, 203, 131.5]), mat: M.enclosure },
      { geo: boxCad(THREE, [300, -t, -t], [t, 203, 131.5]), mat: M.enclosure },
      { geo: boxCad(THREE, [-t, -t, -t], [303, t, 131.5]), mat: M.enclosure },
      { geo: boxCad(THREE, [-t, 200, -t], [303, t, 131.5]), mat: M.enclosure },
      // lip / flange along the top edge
      { geo: boxCad(THREE, [-3, -3, 127], [306, 4, 3], 0.6), mat: M.enclosure },
      { geo: boxCad(THREE, [-3, 199, 127], [306, 4, 3], 0.6), mat: M.enclosure },
      { geo: boxCad(THREE, [-3, -3, 127], [4, 206, 3], 0.6), mat: M.enclosure },
      { geo: boxCad(THREE, [299, -3, 127], [4, 206, 3], 0.6), mat: M.enclosure }
    ]);
  }
  if (want('enclosure_lid')) {
    nodes.enclosure_lid = makeNode(THREE, 'enclosure_lid', [
      { geo: boxCad(THREE, [-3, -3, 130], [306, 206, 1.5], 0.6), mat: M.enclosure }
    ]);
  }
  if (want('heatsink')) {
    const parts = [{ geo: boxCad(THREE, [40, 50, 50], [120, 100, 8], 0.8), mat: M.alu }];
    for (let i = 0; i < 13; i++) {
      const y = 50 + i * (100 - 1.5) / 12;
      parts.push({ geo: boxCad(THREE, [40, y, 2], [120, 1.5, 48]), mat: M.alu });
    }
    nodes.heatsink = makeNode(THREE, 'heatsink', parts);
  }
  if (want('thermal_pad')) {
    nodes.thermal_pad = makeNode(THREE, 'thermal_pad', [{ geo: boxCad(THREE, T.thermal_pad.min, T.thermal_pad.size), mat: M.pad }]);
  }
  if (want('ipm')) {
    const mark = new THREE.MeshStandardMaterial({
      name: 'mat_ipm_marking', map: textTexture(THREE, ['IKCM20L60GD', 'CIPOS'], 512, 256, '#b9bdc4'),
      transparent: true, roughness: 0.6, metalness: 0, depthWrite: false
    });
    const plane = new THREE.PlaneGeometry(26, 13);
    plane.rotateX(-Math.PI / 2);
    plane.translate(100, 61.33, -100);
    nodes.ipm = makeNode(THREE, 'ipm', [
      { geo: boxCad(THREE, T.ipm.min, T.ipm.size, 0.7), mat: M.epoxy },
      { geo: boxCad(THREE, [86, 92, 58.15], [28, 16, 0.1]), mat: M.tin }, // metal back toward the pad
      { geo: plane, mat: mark }
    ]);
  }
  if (want('ipm_pins')) {
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const x = 84.2 + i * 2.9;
      for (const [y, dir] of [[89.5, -1], [110.5, 1]]) {
        parts.push({ geo: boxCad(THREE, [x, dir < 0 ? y - 2 : y, 59.4], [0.6, 2, 0.5]), mat: M.tin });
        parts.push({ geo: boxCad(THREE, [x, dir < 0 ? y - 2.4 : y + 1.8, 59.4], [0.6, 0.6, 18.2]), mat: M.tin });
      }
    }
    nodes.ipm_pins = makeNode(THREE, 'ipm_pins', parts);
  }
  if (want('power_pcb')) {
    const topMat = M.maskTop;
    topMat.map = pcbTexture(THREE);
    const plane = new THREE.PlaneGeometry(240, 180);
    plane.rotateX(-Math.PI / 2);
    plane.translate(160, 77.62, -100);
    nodes.power_pcb = makeNode(THREE, 'power_pcb', [
      { geo: boxCad(THREE, T.power_pcb.min, T.power_pcb.size), mat: M.mask },
      { geo: plane, mat: topMat }
    ]);
  }
  for (const id of ['dclink_cap_1', 'dclink_cap_2']) {
    if (!want(id)) continue;
    const [x0, y0, z0] = T[id].min;
    const cx = x0 + 17.5, cy = y0 + 17.5;
    const vent = new THREE.MeshStandardMaterial({ name: 'mat_cap_vent', color: 0x55606e, metalness: 0.8, roughness: 0.4 });
    nodes[id] = makeNode(THREE, id, [
      { geo: cylCad(THREE, cx, cy, z0, 46, 17.5, 40), mat: M.capSleeve },
      { geo: cylCad(THREE, cx, cy, z0 + 46, 3.6, 16.6, 40), mat: M.capTop },
      { geo: cylCad(THREE, cx, cy, z0 + 49.4, 0.6, 15.8, 40), mat: M.capTop },
      { geo: boxCad(THREE, [cx - 12, cy - 0.8, z0 + 49.7], [24, 1.6, 0.3]), mat: vent },
      { geo: boxCad(THREE, [cx - 0.8, cy - 12, z0 + 49.7], [1.6, 24, 0.3]), mat: vent },
      { geo: cylCad(THREE, cx, cy, z0 + 30, 7, 17.65, 40), mat: M.capBand }
    ]);
  }
  {
    const R = 15.5, a = 11.6;
    const core = new THREE.TorusGeometry(R, a, 18, 48);
    core.rotateX(Math.PI / 2);
    const wind = new THREE.TubeGeometry(windingCurve(THREE, R, a + 1.35, 28), 28 * 14, 1.3, 5, true);
    for (const id of ['inductor_a', 'inductor_b', 'inductor_c']) {
      if (!want(id)) continue;
      const [x0, y0, z0] = T[id].min;
      const c = core.clone().translate(x0 + 29, z0 + 15, -(y0 + 29));
      const w = wind.clone().translate(x0 + 29, z0 + 15, -(y0 + 29));
      nodes[id] = makeNode(THREE, id, [{ geo: c, mat: M.core }, { geo: w, mat: M.copper }]);
    }
  }
  for (const id of ['filter_cap_a', 'filter_cap_b', 'filter_cap_c']) {
    if (!want(id)) continue;
    const { min, size } = T[id];
    const lab = new THREE.MeshStandardMaterial({
      name: 'mat_film_label', map: textTexture(THREE, ['20 µF', '310 V~  X2'], 256, 256, '#aeb6c6', '600 40px monospace'),
      transparent: true, roughness: 0.6, depthWrite: false
    });
    const p = new THREE.PlaneGeometry(30, 30);
    p.translate(min[0] + 21, min[2] + 24, -(min[1]) + 0.05);
    nodes[id] = makeNode(THREE, id, [{ geo: boxCad(THREE, min, size, 2.2), mat: M.film }, { geo: p, mat: lab }]);
  }
  if (want('control_board')) {
    const [x0, y0, z0] = T.control_board.min;
    const top = z0 + 1.6;
    const parts = [
      { geo: boxCad(THREE, [x0, y0, z0], [100, 70, 1.6], 0.4), mat: M.blackMask },
      { geo: boxCad(THREE, [184, 46, top], [16, 16, 1.8], 0.3), mat: M.chip },
      { geo: boxCad(THREE, [148, 78, top], [30, 6, 8.5]), mat: M.header },
      { geo: boxCad(THREE, [212, 30, top], [10, 8, 2.2], 0.4), mat: M.chip },
      { geo: boxCad(THREE, [224, 70, top], [10, 14, 6], 0.4), mat: M.header },
      { geo: boxCad(THREE, [168, 62, top], [6, 3, 2.5], 0.6), mat: M.tin }
    ];
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = 146 + rnd() * 86, y = 24 + rnd() * 50;
      if (x > 178 && x < 206 && y > 40 && y < 68) continue;
      parts.push({ geo: boxCad(THREE, [x, y, top], [2, 1.2, 0.8]), mat: M.passive });
    }
    for (let i = 0; i < 12; i++) parts.push({ geo: boxCad(THREE, [149.5 + i * 2.54, 80.5, top + 8.5], [0.6, 0.6, 3]), mat: M.gold });
    nodes.control_board = makeNode(THREE, 'control_board', parts);
  }
  if (want('standoffs')) {
    const parts = [];
    for (const [x, y] of [[145, 25], [235, 25], [145, 85], [235, 85]]) parts.push({ geo: cylCad(THREE, x, y, 77.6, 37.4, 2.6, 6), mat: M.brass });
    nodes.standoffs = makeNode(THREE, 'standoffs', parts);
  }
  if (want('terminal_block')) {
    const { min, size } = T.terminal_block;
    const parts = [{ geo: boxCad(THREE, min, size, 1.2), mat: M.terminal }];
    for (const [x, y] of [[260, 155], [266, 155], [272, 155], [261, 184], [269, 184]]) {
      parts.push({ geo: cylCad(THREE, x, y, 95.4, 1.0, 2.4, 14), mat: M.steel });
    }
    parts.push({ geo: boxCad(THREE, [256, 168, 95.4], [18, 1.2, 0.8]), mat: M.label });
    nodes.terminal_block = makeNode(THREE, 'terminal_block', parts);
  }
  for (const id of ['sensor_current_a', 'sensor_current_b', 'sensor_current_c', 'sensor_voltage']) {
    if (!want(id)) continue;
    const { min, size } = T[id];
    nodes[id] = makeNode(THREE, id, [
      { geo: boxCad(THREE, min, size, 1.2), mat: M.sensor },
      { geo: boxCad(THREE, [min[0] + 2, min[1] + 2, min[2] + size[2]], [size[0] - 4, 2, 0.2]), mat: M.label }
    ]);
  }
  if (want('fan_frame')) {
    const sh = new THREE.Shape();
    const rr = 5;
    const [ya, yb, za, zb] = [60, 140, 2, 82];
    sh.moveTo(ya + rr, za); sh.lineTo(yb - rr, za); sh.quadraticCurveTo(yb, za, yb, za + rr);
    sh.lineTo(yb, zb - rr); sh.quadraticCurveTo(yb, zb, yb - rr, zb); sh.lineTo(ya + rr, zb);
    sh.quadraticCurveTo(ya, zb, ya, zb - rr); sh.lineTo(ya, za + rr); sh.quadraticCurveTo(ya, za, ya + rr, za);
    const hole = new THREE.Path(); hole.absarc(100, 42, 38, 0, Math.PI * 2, true); sh.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 25, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1, curveSegments: 32 });
    g.rotateY(Math.PI / 2);
    g.translate(10, 0, 0);
    // hub support struts on the outlet side
    const parts = [{ geo: g, mat: M.fanPlastic }];
    for (let i = 0; i < 4; i++) {
      const st = new THREE.BoxGeometry(2, 38, 2.4);
      st.translate(0, 19, 0);
      st.rotateX(i * Math.PI / 2 + Math.PI / 4);
      st.translate(33.5, 42, -100);
      parts.push({ geo: st, mat: M.fanPlastic });
    }
    nodes.fan_frame = makeNode(THREE, 'fan_frame', parts);
  }
  if (want('fan_rotor')) {
    const hub = new THREE.CylinderGeometry(14.5, 14.5, 20, 32);
    hub.rotateZ(Math.PI / 2);
    hub.translate(22.5, 42, -100);
    const parts = [{ geo: hub, mat: M.fanPlastic }];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const b = new RoundedBoxGeometry(16, 23, 1.4, 1, 0.6);
      b.rotateY(0.62);
      b.translate(0, 14 + 11.5, 0);
      b.rotateX((i / n) * Math.PI * 2);
      b.translate(22.5, 42, -100);
      parts.push({ geo: b, mat: M.blade });
    }
    nodes.fan_rotor = makeNode(THREE, 'fan_rotor', parts);
  }
  if (want('screws')) {
    const parts = [];
    for (const [x, y] of [[45, 15], [275, 15], [45, 185], [275, 185]]) parts.push({ geo: cylCad(THREE, x, y, 77.6, 2, 3, 12), mat: M.steel });
    for (const [x, y] of [[145, 25], [235, 25], [145, 85], [235, 85]]) parts.push({ geo: cylCad(THREE, x, y, 116.6, 1.6, 2.6, 12), mat: M.steel });
    nodes.screws = makeNode(THREE, 'screws', parts);
  }
  return nodes;
}

// ---------------------------------------------------------------------------------------
// Load: real glb where present, placeholder for each missing required node.
// ---------------------------------------------------------------------------------------
export async function loadUnit(THREE, ctx, url) {
  let gltf = null;
  try { gltf = await ctx.loadGLB(url); } catch (e) { gltf = null; }
  const root = new THREE.Group();
  root.name = 'unit_root';
  root.scale.setScalar(100);
  const nodes = {};
  const report = { usedGLB: !!gltf, placeholder: [], missingOptional: [] };
  if (gltf && gltf.scene) {
    const sc = gltf.scene;
    for (const n of [...REQUIRED_NODES, ...OPTIONAL_NODES]) {
      const o = sc.getObjectByName(n);
      if (o) nodes[n] = o;
    }
    root.add(sc);
  }
  const missing = REQUIRED_NODES.filter((n) => !nodes[n]);
  const missingOpt = OPTIONAL_NODES.filter((n) => !nodes[n]);
  // placeholder optional detail only when the whole model is placeholder
  const build = gltf ? missing : [...missing, ...missingOpt];
  if (build.length) {
    const ph = buildPlaceholderUnit(THREE, build);
    for (const [n, o] of Object.entries(ph)) { nodes[n] = o; root.add(o); }
  }
  report.placeholder = missing;
  report.missingOptional = gltf ? missingOpt : [];
  root.updateMatrixWorld(true);
  if (gltf && gltf.scene) applyUnitFixes(THREE, gltf.scene);   // unit.glb gaps: terminal housing, mirrored fan text
  root.updateMatrixWorld(true);
  return { root, nodes, report };
}

// ---------------------------------------------------------------------------------------
// "The rest dims": per node, cloned materials eased toward a dark, desaturated,
// slightly transparent look; ghost = smoked and mostly transparent; vis = fade (lid).
// ---------------------------------------------------------------------------------------
export class NodeLook {
  constructor(THREE, node, opts = {}) {
    this.node = node;
    this.entries = [];
    this.dim = 0; this.ghost = 0; this.vis = 1;
    this._d = -1; this._g = -1; this._v = -1;
    this.dimOpacity = opts.dimOpacity ?? 0.72;
    this.tint = new THREE.Color(opts.tint ?? 0x0b1220);
    this.ghostTint = new THREE.Color(opts.ghostTint ?? 0x0a1418);
    this.ghostOpacity = opts.ghostOpacity ?? 0.14;
    const cache = new Map();
    node.traverse((o) => {
      if (!o.isMesh) return;
      const one = (m) => {
        if (cache.has(m)) return cache.get(m);
        const c = m.clone();
        // anisotropy without UVs/tangents gives NaN in the shader, which poisons the bloom
        if (c.anisotropy && !(o.geometry.attributes.uv && o.geometry.attributes.tangent)) c.anisotropy = 0;
        cache.set(m, c);
        this.entries.push({
          m: c,
          color: c.color ? c.color.clone() : null,
          emissive: c.emissive ? c.emissive.clone() : null,
          opacity: c.opacity,
          transparent: c.transparent,
          depthWrite: c.depthWrite
        });
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    });
  }
  apply(dim, ghost, vis) {
    if (Math.abs(dim - this._d) < 0.003 && Math.abs(ghost - this._g) < 0.003 && Math.abs(vis - this._v) < 0.003) return;
    this._d = dim; this._g = ghost; this._v = vis;
    this.node.visible = vis > 0.01;
    for (const e of this.entries) {
      const m = e.m;
      if (e.color) {
        const c = e.color;
        const lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
        // dim: desaturate + darken toward a night tint
        const k = dim * 0.55;
        let r = c.r + (lum * 0.32 + this.tint.r * 0.5 - c.r) * k;
        let g = c.g + (lum * 0.32 + this.tint.g * 0.5 - c.g) * k;
        let b = c.b + (lum * 0.32 + this.tint.b * 0.5 - c.b) * k;
        const q = ghost * 0.85;
        r += (this.ghostTint.r - r) * q; g += (this.ghostTint.g - g) * q; b += (this.ghostTint.b - b) * q;
        m.color.setRGB(r, g, b);
      }
      if (e.emissive) m.emissive.copy(e.emissive).multiplyScalar(1 - 0.85 * Math.max(dim, ghost));
      const op = e.opacity * (1 - (1 - this.dimOpacity) * dim) * (1 - (1 - this.ghostOpacity) * ghost) * vis;
      const tr = e.transparent || op < 0.995;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = op;
      m.depthWrite = e.depthWrite && op > 0.6;
    }
  }
}

// ---------------------------------------------------------------------------------------
// FEA thermal ramp on the heatsink materials (onBeforeCompile). Temperature is a function
// of world position: hottest under the IPM footprint at the top of the base plate, cooler
// toward the fin tips (down) and the edges. Shared uniforms: { uFea, uHot, uSpread, uRamp }.
// ---------------------------------------------------------------------------------------
export function makeFeaUniforms(THREE, feaHex) {
  return {
    uFea: { value: 0 },
    uHot: { value: new THREE.Vector3() },
    uSpread: { value: new THREE.Vector3(5, 5.4, 4.6) }, // x, fin depth (y), z falloffs, scene units
    uRamp: { value: feaHex.map((h) => new THREE.Color(h)) }
  };
}

export function patchFea(material, U) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFeaW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFeaW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFeaW;
uniform float uFea; uniform vec3 uHot; uniform vec3 uSpread; uniform vec3 uRamp[7];
vec3 feaRamp(float t) {
  t = clamp(t, 0.0, 1.0) * 6.0;
  vec3 c = uRamp[0];
  for (int i = 0; i < 6; i++) { c = mix(c, uRamp[i + 1], clamp(t - float(i), 0.0, 1.0)); }
  return c;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 d = (vFeaW - uHot) / uSpread;
  float lat = exp(-0.5 * (d.x * d.x + d.z * d.z));
  float down = clamp(-d.y, 0.0, 1.4);
  float t = 0.12 + 0.88 * lat * (1.0 - 0.55 * down) + 0.18 * (1.0 - down * 0.7) - 0.1;
  vec3 fc = feaRamp(t);
  diffuseColor.rgb = mix(diffuseColor.rgb, fc * 0.35, uFea);
  totalEmissiveRadiance += fc * uFea * 0.62;
}`);
  };
  material.customProgramCacheKey = () => 'gfi-fea';
  material.needsUpdate = true;
}
