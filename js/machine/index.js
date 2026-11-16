// Machine space: the inside of Itai's grid-forming inverter unit, stations s06..s14.
// Implements the Space contract of PLAN 4.2. All station logic addresses parts by node name.
// Tuning knobs: js/machine/stations.js (poses, focus, glow levels, timelines).
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadUnit, NodeLook, makeFeaUniforms, patchFea, buildPlaceholderUnit } from './unit.js';
import { buildConductors, energyColor, makeCapFill, makeStreaks, makeGlowSprite } from './energy.js';
import { CanvasPanel, makeFlywheel, makeEdgeFrame, drawDroop, drawWaves, drawCurrent, drawBarLabel, hexCss, textPlate } from './holo.js';
import { STATIONS, BASE_GLOW, PORTALS, PARALLEL, TIMING } from './stations.js';
import { cad, PCB_CENTRE_CAD, POINTS, REQUIRED_NODES } from './cad.js';

export { buildPlaceholderUnit };

const IDS = ['s06', 's07', 's08', 's09', 's10', 's11', 's12', 's13', 's14'];
const GROUPS = ['dc', 'pin', 'pout', 'tap', 'sig'];
const D2R = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const visOf = (w) => ss(0.35, 0.92, w);

export async function createSpace(ctx) {
  const { THREE, camera, renderer, tokens } = ctx;
  const progress = (f) => { try { ctx.onProgress && ctx.onProgress(f); } catch (e) { /* ignore */ } };
  let tier = (ctx.quality && ctx.quality.tier) || 'high';
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

  // ------------------------------------------------------------------ scene, env, lights
  const scene = new THREE.Scene();
  scene.name = 'machine';
  scene.background = new THREE.Color(tokens.night1);
  scene.fog = new THREE.FogExp2(tokens.night1, 0.0105);

  {
    // soft vertical gradient behind everything (fog-free)
    const g = new THREE.SphereGeometry(900, 24, 12);
    const m = new THREE.ShaderMaterial({
      uniforms: { a: { value: new THREE.Color(tokens.night2) }, b: { value: new THREE.Color(tokens.night1) }, c: { value: new THREE.Color(tokens.night0) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 a,b,c; varying vec3 vP; void main(){ float h=vP.y; vec3 col = h>0.0 ? mix(b,a,smoothstep(0.0,0.7,h)) : mix(b,c,smoothstep(0.0,-0.5,h)); gl_FragColor=vec4(col,1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    const sky = new THREE.Mesh(g, m);
    sky.name = 'backdrop';
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
  }

  let env = null;
  try { env = await ctx.loadHDR('assets/env/studio_1k.hdr'); } catch (e) { env = null; }
  if (!env) {
    const pm = new THREE.PMREMGenerator(renderer);
    env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  scene.environment = env;
  scene.environmentIntensity = 0.95;
  progress(0.15);

  const hemi = new THREE.HemisphereLight(0x4a62a0, 0x0a0e18, 0.7);
  const key = new THREE.DirectionalLight(0xcfe0ff, 2.0);
  key.position.set(-18, 40, 34);
  const kicker = new THREE.DirectionalLight(0xffc49a, 0.45);
  kicker.position.set(48, 14, -36);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 0.7);
  rim.position.set(6, 22, -60);
  scene.add(hemi, key, kicker, rim);
  for (const l of [key, kicker, rim]) { l.target.position.set(15, 5, -12); scene.add(l.target); }

  const mkPoint = (hex) => { const l = new THREE.PointLight(hex, 0, 16, 2); scene.add(l); return l; };
  const pAmber = mkPoint(tokens.dc), pCyan = mkPoint(tokens.ac), pCtl = mkPoint(tokens.ctl), pWarn = mkPoint(tokens.warn);

  // ------------------------------------------------------------------ the unit
  const { root, nodes, report } = await loadUnit(THREE, ctx, 'assets/models/inverter/unit.glb');
  progress(0.7);
  const unit1 = new THREE.Group();
  unit1.name = 'unit1';
  unit1.add(root);
  scene.add(unit1);
  root.updateMatrixWorld(true);

  const boxes = {};
  for (const [n, o] of Object.entries(nodes)) boxes[n] = new THREE.Box3().setFromObject(o);
  const centre = (n) => boxes[n].getCenter(V());

  const looks = {};
  for (const [n, o] of Object.entries(nodes)) {
    const opts = {};
    if (n === 'power_pcb') { opts.ghostOpacity = 0.12; opts.dimOpacity = 0.85; }
    if (n === 'enclosure_base') { opts.ghostOpacity = 0.1; opts.dimOpacity = 0.9; }
    looks[n] = new NodeLook(THREE, o, opts);
    looks[n].cur = { dim: 0, ghost: 0, vis: 1 };
  }
  if (looks.enclosure_lid) { looks.enclosure_lid.cur.vis = 0; looks.enclosure_lid.apply(0, 0, 0); }

  // ------------------------------------------------------------------ lead: lid-opening intro (s05 -> s06)
  // The space opens on the closed box. As the user scrolls, the lid screws unscrew and lift away,
  // then the lid hinges open along its back edge and fades, and the camera settles on the inside.
  const lidNode = nodes.enclosure_lid || null;
  const intro = { ok: false, screws: [], pos0: V(), quat0: new THREE.Quaternion(), hinge: V(), q: new THREE.Quaternion(), v: V(), axis: V(1, 0, 0) };
  if (lidNode && boxes.enclosure_lid) {
    intro.ok = true;
    intro.pos0.copy(lidNode.position); intro.quat0.copy(lidNode.quaternion);
    const lb = boxes.enclosure_lid;
    intro.hinge.set((lb.min.x + lb.max.x) / 2, lb.min.y, lb.min.z);   // bottom back edge
    lidNode.parent.worldToLocal(intro.hinge);
    intro.liftK = 0.4 / (lidNode.parent.getWorldScale(V()).y || 1);   // 4 mm lift, in the parent's units
    const pts = [];
    if (nodes.screws) {
      const cells = new Map(), v = V();
      nodes.screws.traverse((o) => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
        const pa = o.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
          if (v.y < lb.min.y - 0.6) continue;
          const key = Math.round(v.x / 1.2) + ':' + Math.round(v.z / 1.2);
          let c = cells.get(key); if (!c) { c = { x: 0, z: 0, n: 0, y: -1e9 }; cells.set(key, c); }
          c.x += v.x; c.z += v.z; c.n++; c.y = Math.max(c.y, v.y);
        }
      });
      for (const c of cells.values()) {
        const p = V(c.x / c.n, c.y, c.z / c.n);
        const near = pts.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.4);
        if (near) near.y = Math.max(near.y, p.y); else pts.push(p);
      }
    }
    if (pts.length < 2 || pts.length > 12) {
      pts.length = 0;
      for (const [fx, fz] of [[0.06, 0.08], [0.94, 0.08], [0.06, 0.92], [0.94, 0.92]]) pts.push(V(lb.min.x + fx * (lb.max.x - lb.min.x), lb.max.y, lb.min.z + fz * (lb.max.z - lb.min.z)));
    }
    pts.sort((a, b) => (a.x - a.z * 0.4) - (b.x - b.z * 0.4));
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8d0dc, metalness: 1, roughness: 0.28 });
    const slotMat = new THREE.MeshBasicMaterial({ color: 0x0a0d14 });
    const headG = new THREE.CylinderGeometry(0.62, 0.62, 0.26, 24), shankG = new THREE.CylinderGeometry(0.26, 0.26, 2.0, 14), slotG = new THREE.BoxGeometry(0.9, 0.07, 0.17);
    for (const p of pts) {
      const g = new THREE.Group();
      const head = new THREE.Mesh(headG, steel); head.position.y = 0.13;
      const shank = new THREE.Mesh(shankG, steel); shank.position.y = -1.0;
      const slot = new THREE.Mesh(slotG, slotMat); slot.position.y = 0.27;
      g.add(head, shank, slot); g.position.copy(p); g.userData.y0 = p.y; g.visible = false;
      scene.add(g); intro.screws.push(g);
    }
  }

  // FEA ramp on the heatsink
  const feaU = makeFeaUniforms(THREE, tokens.fea);
  if (looks.heatsink) {
    for (const e of looks.heatsink.entries) if (e.m.isMeshStandardMaterial || e.m.isMeshPhysicalMaterial) patchFea(e.m, feaU);
    const hb = boxes.heatsink, ib = boxes.ipm || hb;
    const s = hb.getSize(V());
    feaU.uHot.value.set((ib.min.x + ib.max.x) / 2, hb.max.y, (ib.min.z + ib.max.z) / 2);
    feaU.uSpread.value.set(s.x * 0.34, s.y * 0.95, s.z * 0.36);
  }

  // ------------------------------------------------------------------ energy
  const cond = buildConductors(THREE, tokens, true, tier);
  unit1.add(cond.group);
  // follow the real PCB if it is not where the CAD table says
  {
    const exp = cad(THREE, ...PCB_CENTRE_CAD);
    const off = centre('power_pcb').sub(exp);
    if (off.length() > 0.05) cond.group.position.copy(off);
  }
  const wiresByGroup = {};
  for (const g of GROUPS) wiresByGroup[g] = cond.list.filter((w) => w.group === g);
  const groupSpeed = { dc: 1.1, pin: 2.6, pout: 2.0, tap: 1.5, sig: 2.6 };

  const fx = new THREE.Group();
  fx.name = 'machine_fx';
  unit1.add(fx);

  // DC-link fill shells
  const amberFill = energyColor(THREE, tokens.dc, 1.4);
  const capFills = [];
  for (const n of ['dclink_cap_1', 'dclink_cap_2']) {
    if (!boxes[n]) continue;
    const b = boxes[n], s = b.getSize(V());
    const mat = makeCapFill(THREE, amberFill);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), mat);
    m.scale.set(Math.max(s.x, s.z) * 0.535, s.y * 0.97, Math.max(s.x, s.z) * 0.535);
    m.position.copy(b.getCenter(V()));
    m.renderOrder = 5;
    m.visible = false;
    fx.add(m);
    capFills.push(m);
  }

  // IPM gate markers: 2 rows (high side / low side) x 3 phases
  const gates = [];
  if (boxes.ipm) {
    const b = boxes.ipm, c = b.getCenter(V()), s = b.getSize(V());
    const g = new THREE.BoxGeometry(s.x * 0.075, 0.035, s.z * 0.13);
    for (let k = 0; k < 3; k++) for (let row = 0; row < 2; row++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
      m.position.set(c.x + (k - 1) * s.x * 0.27, b.max.y + 0.02, c.z + (row ? 1 : -1) * s.z * 0.24);
      m.userData = { k, row };
      m.visible = false;
      fx.add(m);
      gates.push(m);
    }
  }
  const acCol = energyColor(THREE, tokens.ac, 1);
  const ctlCol = energyColor(THREE, tokens.ctl, 1);
  const warnCol = energyColor(THREE, tokens.warn, 1);

  // coil glow overlays (s08): additive copies of the chopped-pulse shader on a torus shell
  const coils = [];
  for (const n of ['inductor_a', 'inductor_b', 'inductor_c']) {
    if (!boxes[n] || !wiresByGroup.pin.length) continue;
    const b = boxes[n], s = b.getSize(V());
    const R = s.x * 0.27, a = s.y * 0.5;
    const mat = wiresByGroup.pin[0].mat.clone();
    mat.transparent = true; mat.depthWrite = false; mat.blending = THREE.AdditiveBlending;
    mat.uniforms.uLen.value = Math.PI * 2 * R;
    mat.uniforms.uSpacing.value = 1.2;
    mat.uniforms.uPhase.value = coils.length * Math.PI * 2 / 3;
    const geo = new THREE.TorusGeometry(R, a * 0.98, 10, 48);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(b.getCenter(V()));
    m.visible = false;
    m.renderOrder = 4;
    fx.add(m);
    coils.push({ m, mat, flow: 0 });
  }

  // air streaks through the heatsink fins (s13)
  const streakCount = { high: 72, medium: 48, low: 28 };
  let streaks = null;
  if (boxes.heatsink) {
    streaks = makeStreaks(THREE, 72, boxes.heatsink, energyColor(THREE, 0xbfefff, 1.6));
    streaks.geometry.setDrawRange(0, streakCount[tier] * 2);
    streaks.visible = false;
    fx.add(streaks);
  }

  // fault flash at the terminal (s12)
  const acTerm = cad(THREE, ...POINTS.acTerminal).add(cond.group.position);
  const flash = makeGlowSprite(THREE, energyColor(THREE, tokens.warn, 4), 5);
  flash.position.copy(acTerm).add(V(0, 0.4, 0));
  flash.visible = false;
  fx.add(flash);

  // ------------------------------------------------------------------ holograms
  const holoHz = () => (tier === 'low' ? 15 : 30);
  const cssCol = {
    ac: hexCss(tokens.ac), ctl: hexCss(tokens.ctl), warn: hexCss(tokens.warn), hot: '#ffd2b0',
    ctlA: 'rgba(255,79,216,0.55)'
  };
  const board = boxes.control_board;
  const boardC = board.getCenter(V());

  const fly = makeFlywheel(THREE, energyColor(THREE, tokens.ctl, 0.6), 2.3);
  fly.group.position.set(boardC.x, board.max.y + 3.4, boardC.z);
  fly.group.visible = false;
  scene.add(fly.group);
  let flyAngle = 0;

  const droop = new CanvasPanel(THREE, { px: [640, 420], width: 6.2, gain: 2.0, name: 'holo_droop' });
  droop.mesh.position.set(boardC.x + 5.6, board.max.y + 3.6, boardC.z - 1.2);
  scene.add(droop.mesh);

  const fcAB = new THREE.Box3();
  for (const n of ['filter_cap_a', 'filter_cap_b']) if (boxes[n]) fcAB.union(boxes[n]);
  const waves = new CanvasPanel(THREE, { px: [720, 340], width: 7.4, gain: 2.0, name: 'holo_waves' });
  waves.mesh.position.set((fcAB.min.x + fcAB.max.x) / 2 - 1, fcAB.max.y + 3.6, (fcAB.min.z + fcAB.max.z) / 2);
  scene.add(waves.mesh);

  const sens = new THREE.Box3();
  for (const n of ['sensor_current_a', 'sensor_current_b', 'sensor_current_c']) if (boxes[n]) sens.union(boxes[n]);
  const current = new CanvasPanel(THREE, { px: [660, 360], width: 6.6, gain: 2.0, name: 'holo_current' });
  current.mesh.position.set((sens.min.x + sens.max.x) / 2 - 3.6, sens.max.y + 4.6, (sens.min.z + sens.max.z) / 2 - 0.6);
  scene.add(current.mesh);

  const panels = [droop, waves, current];
  const holoBox = (obj, w, h) => {
    const p = obj.position, r = Math.max(w, h) * 0.5;
    return new THREE.Box3(V(p.x - r, p.y - h / 2, p.z - r * 0.6), V(p.x + r, p.y + h / 2, p.z + r * 0.6));
  };
  const holoBoxes = {
    flywheel: holoBox(fly.group, 4.8, 4.8),
    droop: holoBox(droop.mesh, ...droop.size),
    waves: holoBox(waves.mesh, ...waves.size),
    current: holoBox(current.mesh, ...current.size)
  };

  // ------------------------------------------------------------------ s14: second unit, bus, bars
  const encl = new THREE.Box3();
  if (boxes.enclosure_base) encl.union(boxes.enclosure_base);
  if (boxes.enclosure_lid) encl.union(boxes.enclosure_lid);
  const enclSize = encl.getSize(V());
  const unit2Offset = -(enclSize.z + PARALLEL.gap * 0.1);
  const unit2 = new THREE.Group();
  unit2.name = 'unit2';
  {
    const c = root.clone(true);
    const mcache = new Map();
    c.traverse((o) => {
      if (!o.isMesh) return;
      const one = (m) => { if (!mcache.has(m)) { const k = m.clone(); k.transparent = false; k.opacity = 1; k.depthWrite = true; mcache.set(m, k); } return mcache.get(m); };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    });
    c.traverse((o) => { o.visible = true; });
    unit2.add(c);
  }
  unit2.visible = false;
  scene.add(unit2);
  const unit2Anchor = new THREE.Object3D();
  unit2Anchor.position.set((encl.min.x + encl.max.x) / 2 - 3, encl.max.y + 1.2, (encl.min.z + encl.max.z) / 2);
  unit2.add(unit2Anchor);

  const frame1 = makeEdgeFrame(THREE, encl.clone().expandByScalar(0.08), energyColor(THREE, tokens.inv1, 2.6), 0.07);
  const frame2 = makeEdgeFrame(THREE, encl.clone().expandByScalar(0.08), energyColor(THREE, tokens.inv2, 2.6), 0.07);
  frame1.group.visible = false;
  unit1.add(frame1.group);
  unit2.add(frame2.group);

  // shared output bus and the load block
  const par = new THREE.Group();
  par.name = 'parallel_rig';
  par.visible = false;
  scene.add(par);
  // lead: a dark, slightly reflective floor so the two units sit on something at s14
  const floor14 = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), new THREE.MeshStandardMaterial({ color: 0x0e1626, metalness: 0.7, roughness: 0.34 }));
  floor14.rotation.x = -Math.PI / 2;
  floor14.position.set((encl.min.x + encl.max.x) / 2, encl.min.y - 0.2, encl.min.z - 14);
  par.add(floor14);
  const termC = boxes.terminal_block ? boxes.terminal_block.getCenter(V()) : V(26.5, 8.7, -17);
  const xOut = encl.max.x;
  const busX = xOut + 4.2, busY = 4.2;
  const z1 = termC.z, z2 = termC.z + unit2Offset, zMid = (z1 + z2) / 2;
  const loadPos = V(busX + 9, 1.6, zMid);
  const tubeMat = (hex, lum, phase = 0) => {
    const m = wiresByGroup.dc[0].mat.clone();
    m.uniforms.uColor.value.copy(energyColor(THREE, hex, 1));
    m.uniforms.uLevel.value = lum;
    m.uniforms.uDash.value = 0.9;
    m.uniforms.uPhase.value = phase;
    return m;
  };
  const parWires = [];
  const addTube = (pts, hex, r, lum) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.08);
    const len = curve.getLength();
    const mat = tubeMat(hex, lum);
    mat.uniforms.uLen.value = len;
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(80, Math.round(len * 3)), r, 8, false), mat);
    par.add(m);
    parWires.push({ m, mat, flow: 0, base: lum });
    return m;
  };
  addTube([V(xOut, termC.y + 0.4, z1), V(xOut + 1.6, termC.y, z1), V(busX, busY + 0.6, z1), V(busX, busY, z1 - 0.8)], tokens.inv1, 0.13, 1.8);
  addTube([V(xOut, termC.y + 0.4, z2), V(xOut + 1.6, termC.y, z2), V(busX, busY + 0.6, z2), V(busX, busY, z2 + 0.8)], tokens.inv2, 0.13, 1.8);
  addTube([V(busX, busY, z1 - 0.2), V(busX, busY, zMid + 2), V(busX, busY, zMid - 2), V(busX, busY, z2 + 0.2)], tokens.ac, 0.24, 2.2);
  addTube([V(busX, busY, zMid), V(busX + 2.6, busY, zMid), V(loadPos.x - 2.6, loadPos.y + 1.0, zMid), V(loadPos.x - 1.5, loadPos.y + 0.6, zMid)], tokens.ac, 0.2, 2.2);
  {
    const lb = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 3.2, 4.4),
      new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.6, roughness: 0.45, name: 'mat_load' })
    );
    lb.position.copy(loadPos);
    par.add(lb);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.18, 3.6), new THREE.MeshBasicMaterial({ color: energyColor(THREE, tokens.ac, 2.2), fog: false }));
    slot.position.copy(loadPos).add(V(0, 0.9, 0));
    par.add(slot);
    const plate = textPlate(THREE, { px: [256, 80], width: 2.6, gain: 1.4 });
    const g = plate.g;
    g.fillStyle = 'rgba(226,230,236,0.9)'; g.font = '500 40px "DM Mono", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LOAD', 128, 40);
    plate.commit();
    plate.setVis(1);
    plate.mesh.position.copy(loadPos).add(V(0, 2.6, 0));
    par.add(plate.mesh);
    par.userData.loadPlate = plate;
  }
  // power bars
  const barH = 30, barW = 4.2;
  const bars = [];
  const mkBar = (hex, x, z, title) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const col = energyColor(THREE, hex, 1);
    const fillMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.6), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const fill = new THREE.Mesh(new THREE.BoxGeometry(barW, 1, barW * 0.5), fillMat);
    fill.geometry.translate(0, 0.5, 0);
    g.add(fill);
    const frameBox = new THREE.Box3(V(-barW / 2 - 0.1, 0, -barW * 0.25 - 0.1), V(barW / 2 + 0.1, barH, barW * 0.25 + 0.1));
    const fr = makeEdgeFrame(THREE, frameBox, col.clone().multiplyScalar(0.55), 0.035);
    g.add(fr.group);
    const baseMark = new THREE.Mesh(new THREE.BoxGeometry(barW + 0.9, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(1.3), fog: false, transparent: true, depthWrite: false }));
    g.add(baseMark);
    const plate = textPlate(THREE, { px: [256, 128], width: 2.6, gain: 1.35 });
    g.add(plate.mesh);
    par.add(g);
    const b = { g, fill, fillMat, fr, baseMark, plate, title, css: hexCss(hex), shown: 0, drawn: -1, col };
    bars.push(b);
    return b;
  };
  const barX = xOut + 2.4;
  mkBar(tokens.inv1, barX, (encl.min.z + encl.max.z) / 2 + 2.5, '1');
  mkBar(tokens.inv2, barX, (encl.min.z + encl.max.z) / 2 + unit2Offset + 2.5, '2');
  let loadScale = 1;
  let dragging = null;

  // ------------------------------------------------------------------ station objects
  const contentById = {};
  for (const s of (ctx.content && ctx.content.stations) || []) contentById[s.id] = s;
  const S = {};
  for (const id of IDS) {
    const cfg = STATIONS[id];
    const cont = contentById[id] || {};
    let focus;
    if (cfg.focus === 'all' || !cont.focus) focus = null;
    else focus = new Set([...(cont.focus || []), ...(cfg.focus || [])]);
    S[id] = { cfg, focus, ghost: new Set(cfg.ghost || []), t: 0, seen: -10 };
  }

  const both = new THREE.Box3();
  const bothBox = () => {
    both.copy(encl);
    both.union(encl.clone().translate(V(0, 0, unit2Offset)));
    both.expandByPoint(loadPos);
    both.expandByPoint(V(barX, barH * 0.75, encl.min.z));
    return both;
  };
  const subject = (id) => {
    const f = STATIONS[id].frame;
    const b = new THREE.Box3();
    for (const n of f.nodes) {
      if (n === '__both') b.union(bothBox());
      else if (boxes[n]) b.union(boxes[n]);
    }
    for (const h of f.holos || []) if (holoBoxes[h]) b.union(holoBoxes[h]);
    if (b.isEmpty()) b.copy(encl);
    return b;
  };

  const UP = V(0, 1, 0);
  const poseCache = new Map();
  function poseFor(id, aspect) {
    const key = id + ':' + aspect.toFixed(3);
    if (poseCache.has(key)) return poseCache.get(key);
    const f = STATIONS[id].frame;
    const portrait = aspect < 0.8;
    const fov = (portrait && f.fovP) || f.fov || 38;
    const box = subject(id);
    const c = box.getCenter(V());
    const r = box.getBoundingSphere(new THREE.Sphere()).radius;
    const az = (portrait && f.azP != null ? f.azP : f.az) * D2R;
    const el = (portrait && f.elP != null ? f.elP : f.el) * D2R;
    const dir = V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const tanV = Math.tan((fov * D2R) / 2), tanH = tanV * aspect;
    const R = r * (portrait ? (f.kp ?? f.k) : f.k);
    let d, sx, sy;
    if (!portrait) { d = Math.max(R / (0.62 * tanH), R / (0.86 * tanV)); sx = 0.4; sy = 0.05; }
    else { d = Math.max(R / (0.92 * tanH), R / (0.6 * tanV)); sx = 0; sy = -0.2; }
    const fwd = dir.clone().negate();
    const right = V().crossVectors(fwd, UP).normalize();
    const up = V().crossVectors(right, fwd).normalize();
    const hh = d * tanV, hw = d * tanH;
    const target = c.clone().addScaledVector(right, -sx * hw).addScaledVector(up, -sy * hh + (f.lift || 0) * r);
    const position = target.clone().addScaledVector(dir, d);
    const pose = { position, target, fov };
    if (poseCache.size > 200) poseCache.clear();
    poseCache.set(key, pose);
    return pose;
  }

  const labelAnchor = (ref) => {
    if (Array.isArray(ref)) return V(...ref);
    if (ref === '__unit1') return V((encl.min.x + encl.max.x) / 2 - 3, encl.max.y + 1.2, (encl.min.z + encl.max.z) / 2);
    if (ref === '__unit2') return unit2Anchor;
    const b = boxes[ref];
    if (!b) return V();
    return V((b.min.x + b.max.x) / 2, b.max.y + 0.5, (b.min.z + b.max.z) / 2);
  };

  let frameNo = 0;
  const active = new Map();
  const stations = {};
  for (const id of IDS) {
    const cfg = STATIONS[id];
    const st = S[id];
    const o = {
      pose: (aspect) => poseFor(id, aspect || 1.6),
      enter() { st.t = 0; st.seen = frameNo; },
      exit() { if (id === 's14') dragging = null; },
      update(f, dt) {
        if (frameNo - st.seen > 2) st.t = 0;
        st.seen = frameNo;
        st.t += Math.min(dt || 0, 0.1);
        active.set(id, f);
      },
      labels: (cfg.labels || []).map(([text, ref, tone]) => ({ text, anchor: labelAnchor(ref), tone }))
    };
    if (cfg.via) o.via = cfg.via.map((p) => V(...p));
    if (cfg.weight) o.weight = cfg.weight;
    if (id === 's14') {
      o.pointer = (e) => {
        if (!e) return;
        if (e.type === 'start') dragging = { x: e.x || 0, y: e.y || 0, s: loadScale };
        else if (e.type === 'move' && dragging) {
          // right or up = more load (y assumed up-positive, NDC style)
          const d = ((e.x || 0) - dragging.x) + ((e.y || 0) - dragging.y);
          loadScale = Math.min(PARALLEL.scaleMax, Math.max(PARALLEL.scaleMin, dragging.s + d * 0.9));
        } else if (e.type === 'end') dragging = null;
      };
    }
    stations[id] = o;
  }

  const portals = {
    entry: { position: V(...PORTALS.entry.position), target: V(...PORTALS.entry.target) },
    exit: { position: V(...PORTALS.exit.position), target: V(...PORTALS.exit.target) }
  };

  // ------------------------------------------------------------------ per-frame state
  const glowNow = {};
  for (const g of GROUPS) glowNow[g] = [0, 0, 0, 0, 0];
  const lightPos = { cyan: V() };
  const tmpV = V();
  const nodeNames = Object.keys(looks);
  const bar1 = bars[0], bar2 = bars[1];
  let fanAngleSpeed = 4;

  function stationPhase(id) { return S[id].t; }

  function update(dt, time, nearest) {
    frameNo++;
    dt = Math.min(dt || 0.016, 0.1);
    if (active.size === 0 && nearest && S[nearest]) active.set(nearest, 0);
    // weights
    let W = 0;
    const w = {};
    for (const [id, f] of active) { const ww = 1 - Math.min(1, Math.abs(f)); w[id] = ww; W += ww; }
    if (W > 1) { for (const id in w) w[id] /= W; W = 1; }
    const wOf = (id) => w[id] || 0;
    const fOf = (id) => (active.has(id) ? active.get(id) : null);

    // ---- looks: dims, ghosts, lid
    let lid = 0;
    const f13 = fOf('s13'), f14 = fOf('s14');
    if (f13 !== null && f13 > 0) lid = Math.max(lid, ss(0.2, 0.8, f13));
    if (f14 !== null) lid = Math.max(lid, ss(-0.8, -0.2, f14));
    const lidLate = lid;
    // lead: lid-opening intro, scroll-linked to the approach to s06 (u: 0 = closed box at the cut, 1 = open)
    const f06 = fOf('s06');
    const introOn = intro.ok && f06 !== null && f06 < 0;
    const u = introOn ? clamp01((f06 + 0.5) / 0.44) : 1;
    const introDim = introOn ? ss(0.55, 1, u) : 1;
    // review 3: while the lid is shut (before it starts to open, or back on at s13/s14) no conductor may show through it
    const lidShut = (introOn && u < 0.5) || lidLate > 0.99;
    if (intro.ok) {
      const o = introOn ? ss(0.52, 0.94, u) : 0;                // lid opening 0..1
      if (introOn) lid = Math.max(lid, 1 - ss(0.82, 0.99, u));
      if (o > 0) {
        intro.q.setFromAxisAngle(intro.axis, -o * 1.92);
        intro.v.copy(intro.pos0).sub(intro.hinge).applyQuaternion(intro.q).add(intro.hinge);
        intro.v.y += intro.liftK * ss(0.46, 0.6, u);
        lidNode.position.copy(intro.v);
        lidNode.quaternion.copy(intro.q).multiply(intro.quat0);
      } else { lidNode.position.copy(intro.pos0); lidNode.quaternion.copy(intro.quat0); }
      const n = intro.screws.length, gap = Math.min(0.04, 0.26 / Math.max(1, n));
      for (let i = 0; i < n; i++) {
        const g = intro.screws[i];
        const si = introOn ? ss(0.12 + i * gap, 0.12 + i * gap + 0.26, u) : 1;
        const sc = 1 - ss(0.72, 1, si);
        g.visible = introOn && sc > 0.01;
        if (!g.visible) continue;
        g.position.y = g.userData.y0 + 6.5 * si * si;
        g.rotation.y = si * Math.PI * 12;
        g.scale.setScalar(sc);
      }
    }
    const ease = Math.min(1, dt * 7);
    for (const n of nodeNames) {
      let dim = 0, ghost = 0;
      for (const id in w) {
        const st = S[id];
        if (st.focus && !st.focus.has(n)) dim += w[id];
        if (st.ghost.has(n)) ghost += w[id];
      }
      if (n === 'enclosure_base') dim *= 0.5;
      if (introOn) { dim *= introDim; ghost *= introDim; }
      if (n === 'enclosure_lid') { dim = 0; ghost = 0; }
      const L = looks[n], c = L.cur;
      c.dim += (dim - c.dim) * ease;
      c.ghost += (ghost - c.ghost) * ease;
      if (n === 'enclosure_lid') c.vis = lid; // scroll-linked, no easing
      if (n === 'screws') c.vis = lidLate;      // the model's own screws only show when the lid is back on (s13, s14)
      L.apply(c.dim, c.ghost, c.vis);
    }

    // ---- conductor glow
    for (const g of GROUPS) {
      const out = glowNow[g], base = BASE_GLOW[g];
      for (let i = 0; i < 5; i++) out[i] = base[i] * (1 - W);
      for (const id in w) {
        const v = STATIONS[id].glow[g] || base;
        for (let i = 0; i < 5; i++) out[i] += v[i] * w[id];
      }
    }
    // station-specific modulation
    const w06 = wOf('s06'), w09 = wOf('s09'), w10 = wOf('s10'), w12 = wOf('s12'), w13 = wOf('s13'), w14 = wOf('s14');
    // lead: the camera sits much further back on narrow screens and at s14, so thin the fog there or it swallows the unit
    scene.fog.density = 0.0105 * (ctx.camera.aspect < 0.8 ? 0.55 : 1) * (1 - 0.8 * w14);
    const fill = w06 > 0 ? ss(0, 1, stationPhase('s06') / TIMING.capFill) : 0;
    glowNow.dc[0] *= 1 - w06 * 0.45 * (1 - fill);

    // s09 bump / s10 load
    const t09 = stationPhase('s09') % TIMING.s09Period - TIMING.s09Bump;
    const bump = t09 > 0 ? (t09 / 0.35) * Math.exp(1 - t09 / 0.35) : 0;
    const t10 = stationPhase('s10') % TIMING.s10Period;
    const load10 = ss(1.2, 2.6, t10) * (1 - ss(5.2, 6.6, t10));
    glowNow.sig[0] *= 1 + w09 * bump * 0.8;

    // s12 fault timeline
    const t12 = stationPhase('s12');
    const tt12 = t12 % TIMING.s12Period;
    const tau = tt12 - TIMING.s12Fault;
    let hot = 0, flashAmt = 0;
    if (tau >= 0 && tau < 4.2) { hot = tau < 0.3 ? 1 : 0.4 + 0.6 * Math.exp(-(tau - 0.3) / 0.8); flashAmt = Math.exp(-tau / 0.2); }
    else if (tau >= 4.2 && tau < 4.8) hot = 0.4 * (1 - (tau - 4.2) / 0.6);
    hot *= w12;
    glowNow.pout[4] += hot;
    glowNow.pout[0] *= 1 + hot * 0.5;

    for (const g of GROUPS) {
      const v = glowNow[g];
      for (const wr of wiresByGroup[g]) {
        const u = wr.mat.uniforms;
        wr.flow += dt * groupSpeed[g] * (g === 'pout' && hot > 0 ? 1 + hot : 1);
        u.uFlow.value = wr.flow;
        u.uTime.value = time;
        u.uLevel.value = v[0]; u.uDash.value = v[1]; u.uPwm.value = v[2]; u.uSine.value = v[3]; u.uHot.value = v[4];
        if (wr.mesh) wr.mesh.visible = v[0] > 0.03 && !lidShut;
      }
    }

    // ---- point lights
    let wl = 0;
    lightPos.cyan.set(0, 0, 0);
    let ia = 0, ic = 0, im = 0, iw = 0;
    for (const id in w) {
      const L = STATIONS[id].lights;
      ia += L.amber * w[id]; ic += L.cyan * w[id]; im += L.ctl * w[id]; iw += L.warn * w[id];
      const at = STATIONS[id].cyanAt;
      if (boxes[at]) { lightPos.cyan.addScaledVector(boxes[at].getCenter(tmpV), w[id]); wl += w[id]; }
    }
    if (wl > 0) pCyan.position.copy(lightPos.cyan.multiplyScalar(1 / wl)).add(V0.set(0, 2.2, 1.2));
    pAmber.intensity = ia * (0.35 + 0.65 * fill);
    pCyan.intensity = ic;
    pCtl.intensity = im * (1 + bump * w09 * 0.6);
    pWarn.intensity = iw + w12 * (40 * flashAmt + 10 * hot);

    // ---- s06 fill
    for (const m of capFills) {
      const v = visOf(w06);
      m.visible = v > 0.01;
      m.material.uniforms.uFill.value = fill;
      m.material.uniforms.uAmt.value = v;
      m.material.uniforms.uTime.value = time;
    }

    // ---- s07 gates
    const w07 = wOf('s07');
    if (gates.length) {
      const v = visOf(w07);
      const t7 = stationPhase('s07');
      for (const g of gates) {
        g.visible = v > 0.01;
        if (!g.visible) continue;
        const { k, row } = g.userData;
        const s = Math.sin(t7 * Math.PI * 2 * 0.8 - k * Math.PI * 2 / 3);
        const on = (row === 0 ? s > 0 : s <= 0) ? 1 : 0;
        const chop = ((t7 * 9 + k * 0.33) % 1) < 0.55 + 0.4 * Math.abs(s) ? 1 : 0.25;
        g.material.color.copy(acCol).multiplyScalar(v * (0.12 + on * chop * 4.2));
      }
    }

    // ---- s08 coils
    const w08 = wOf('s08');
    for (const c of coils) {
      const v = visOf(w08);
      c.m.visible = v > 0.01;
      if (!c.m.visible) continue;
      c.flow += dt * 2.4;
      const u = c.mat.uniforms;
      u.uFlow.value = c.flow; u.uLevel.value = 0.7 * v; u.uPwm.value = 1; u.uDash.value = 0; u.uSine.value = 0;
    }

    // ---- s09 / s10 flywheel
    const fv = Math.max(visOf(w09), visOf(w10));
    fly.group.visible = fv > 0.01;
    {
      const nW = w09 + w10;
      const om09 = 2.6 * (1 - 0.42 * bump);
      const om10 = 2.6 * (1 - 0.16 * load10);
      const om = nW > 0 ? (om09 * w09 + om10 * w10) / nW : 2.6;
      flyAngle += om * dt;
      fly.spin.rotation.z = -flyAngle;
      if (fly.group.visible) {
        fly.group.quaternion.copy(camera.quaternion);
        fly.group.rotateX(-0.42);
        const sc = 1 - 0.28 * (nW > 0 ? w10 / nW : 0);
        fly.group.scale.setScalar(sc);
        fly.group.position.set(boardC.x - (nW > 0 ? (w10 / nW) * 1.2 : 0), board.max.y + 3.4 - (nW > 0 ? (w10 / nW) * 0.4 : 0), boardC.z);
        fly.mats[0].color.copy(fly.base).multiplyScalar(fv * (1 + 0.5 * bump * w09));
        fly.mats[1].color.copy(fly.base).multiplyScalar(fv * 0.35);
      }
    }

    // ---- canvases
    const hz = holoHz();
    droop.setVis(visOf(w10));
    if (droop.due(time, hz)) { drawDroop(droop, { load: load10 }, cssCol); droop.commit(); }
    const w11 = wOf('s11');
    waves.setVis(visOf(w11));
    if (waves.due(time, hz)) {
      const t11 = stationPhase('s11');
      const per = TIMING.s11Period, cyc = 0.9;
      const td = (Math.floor(t11 / per) * per + TIMING.s11Dist) / cyc;
      drawWaves(waves, { t: t11 / cyc, td, amp: 0.65 }, cssCol);
      waves.commit();
    }
    current.setVis(visOf(w12));
    if (current.due(time, hz)) {
      const per = TIMING.s12Period, tf0 = TIMING.s12Fault;
      const fn = (tAbs) => {
        if (tAbs < 0) tAbs += per;
        const tt = tAbs % per, ta = tt - tf0;
        const sn = Math.sin(tAbs * Math.PI * 2 * 1.6);
        let a = 0.42;
        if (ta >= 0 && ta < 0.12) a = 0.42 + (1.5 - 0.42) * (ta / 0.12);
        else if (ta >= 0.12 && ta < 0.32) a = 1.5 - 0.5 * ((ta - 0.12) / 0.2);
        else if (ta >= 0.32 && ta < 4.2) return Math.max(-1, Math.min(1, 1.18 * sn));
        else if (ta >= 4.2 && ta < 4.8) a = 1 - 0.58 * ((ta - 4.2) / 0.6);
        return a * sn;
      };
      const tFault = Math.floor((t12 - tf0) / per) * per + tf0;
      drawCurrent(current, { t: t12, fn, tFault, hot: hot / Math.max(w12, 1e-3) }, cssCol);
      current.commit();
    }
    for (const p of panels) if (p.mesh.visible) p.mesh.quaternion.copy(camera.quaternion);
    flash.visible = w12 > 0.05 && flashAmt > 0.01;
    if (flash.visible) {
      flash.material.color.copy(flash.userData.base).multiplyScalar(flashAmt * visOf(w12));
      flash.scale.setScalar(3 + 5 * (1 - flashAmt));
    }

    // ---- s13 heat, fan, streaks
    const t13 = stationPhase('s13');
    const feaTarget = w13 * ss(0.4, 1.0, w13) * ss(0, 1.6, t13);
    feaU.uFea.value += (Math.max(feaTarget, f13 !== null && f13 > 0 ? feaU.uFea.value * (1 - f13) : 0) - feaU.uFea.value) * Math.min(1, dt * 4);
    if (w13 === 0 && f13 === null) feaU.uFea.value *= 1 - Math.min(1, dt * 3);
    if (streaks) {
      const v = visOf(w13);
      streaks.visible = v > 0.01;
      streaks.material.uniforms.uAmt.value = v;
      streaks.material.uniforms.uTime.value = time;
    }
    const fanTarget = 5 + 22 * w13;
    fanAngleSpeed += (fanTarget - fanAngleSpeed) * Math.min(1, dt * 2);
    if (nodes.fan_rotor) nodes.fan_rotor.rotateOnWorldAxis(XAXIS, fanAngleSpeed * dt);

    // ---- s14 parallel
    const showPar = w14 > 0.001 || (f14 !== null);
    par.visible = showPar;
    unit2.visible = showPar;
    frame1.group.visible = showPar;
    if (showPar) {
      const slide = f14 === null ? 1 : ss(-0.85, -0.12, f14);
      unit2.position.set(0, 0, unit2Offset - 30 * (1 - slide));
      const ev = visOf(w14);
      frame1.mat.color.copy(frame1.base).multiplyScalar(ev);
      frame2.mat.color.copy(frame2.base).multiplyScalar(Math.max(ev, 0.0) * slide);
      const t14 = stationPhase('s14') % TIMING.s14Period;
      let e = ss(2.0, 2.7, t14) * (1 - ss(6.2, 6.9, t14));
      if (dragging) e = 1;
      const L = PARALLEL.baseLoad + PARALLEL.stepLoad * loadScale * e;
      const dW = (2 * PARALLEL.P0 - L) / (PARALLEL.D1 + PARALLEL.D2);
      const P1 = PARALLEL.P0 - PARALLEL.D1 * dW, P2 = PARALLEL.P0 - PARALLEL.D2 * dW;
      const base1 = PARALLEL.P0 - PARALLEL.D1 * (2 * PARALLEL.P0 - PARALLEL.baseLoad) / (PARALLEL.D1 + PARALLEL.D2);
      const base2 = PARALLEL.P0 - PARALLEL.D2 * (2 * PARALLEL.P0 - PARALLEL.baseLoad) / (PARALLEL.D1 + PARALLEL.D2);
      const k = 1 - Math.exp(-dt / 0.3);
      if (bar1.shown === 0) { bar1.shown = P1; bar2.shown = P2; }
      bar1.shown += (P1 - bar1.shown) * k;
      bar2.shown += (P2 - bar2.shown) * k;
      const bv = ev * slide;
      for (const [b, base] of [[bar1, base1], [bar2, base2]]) {
        const h = Math.max(0.05, (b.shown / PARALLEL.maxW) * barH);
        b.fill.scale.y = h;
        b.fillMat.opacity = 0.85 * bv;
        b.fr.mat.color.copy(b.fr.base).multiplyScalar(bv);
        b.baseMark.position.y = (base / PARALLEL.maxW) * barH;
        b.baseMark.material.opacity = 0.9 * bv;
        b.plate.setVis(bv);
        b.plate.mesh.position.set(0, h + 1.15, 0);
        b.plate.mesh.quaternion.copy(camera.quaternion);
        const ww = Math.round(b.shown);
        if (bv > 0.01 && ww !== b.drawn && b.plate.due(time, 15)) {
          b.drawn = ww;
          drawBarLabel(b.plate, b.title, ww, b.css);
          b.plate.commit();
        }
      }
      bar2.g.position.z = (encl.min.z + encl.max.z) / 2 + unit2.position.z + 2.5;
      const lp = par.userData.loadPlate;
      lp.setVis(ev);
      lp.mesh.quaternion.copy(camera.quaternion);
      for (const pw of parWires) {
        pw.flow += dt * (1.6 + 1.4 * e);
        const u = pw.mat.uniforms;
        u.uFlow.value = pw.flow; u.uTime.value = time;
        u.uLevel.value = pw.base * (0.25 + 0.75 * ev) * (1 + 0.35 * e);
      }
      // conductor glow on unit 1 hidden by the lid, so tint via edge frames only
    } else {
      bar1.shown = 0; bar2.shown = 0;
    }

    active.clear();
  }
  const XAXIS = V(1, 0, 0);
  const V0 = V();

  function setQuality(t) {
    tier = t || tier;
    if (streaks) streaks.geometry.setDrawRange(0, (streakCount[tier] || 48) * 2);
  }

  progress(1);

  const space = {
    id: 'machine',
    scene,
    stations,
    portals,
    update,
    resize() { poseCache.clear(); },
    setQuality,
    debug: { report, nodes, boxes, looks }
  };
  return space;
}
