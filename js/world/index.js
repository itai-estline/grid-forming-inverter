// The landscape space (PLAN 5): stations s01-s05, s15, s16.
// Builds the dusk world from env.js / props.js / flows.js / holo.js and drives the per-station moments.
import * as THREE from 'three';
import { ENV, buildSky, buildGround, buildRoads, buildLights } from './env.js';
import { createFlows, spanPath, sagPoints } from './flows.js';
import { createSwing, createHologram, SWING } from './holo.js';
import { createGlowMaterials, loadProps, instancify, T, attachPoint } from './props.js';

// ---------------------------------------------------------------------------------------------
// Per-station numbers (tune here). Poses: pos = camera, subj = the thing to frame, ndc = where the subject sits
// on screen in landscape (x right of centre so the text has the left), p* = portrait reframing.
// ---------------------------------------------------------------------------------------------
export const CFG = {
  poses: {
    s01: { pos: [-345, 105, 175], subj: [-160, 0, -30], ndc: [0.3, -0.12], pScale: 1.25, pFov: 58, pNdcY: -0.3 },
    s02: { pos: [-29.5, 6.4, 164.5], subj: [-41, 4.6, 171], ndc: [0.36, 0], pScale: 1.5, pFov: 52, pNdcY: -0.3 },
    s03: { pos: [40, 42, 110], subj: [-40, 22, 175], ndc: [0.3, -0.05], pScale: 1.45, pFov: 52, pNdcY: -0.3 },
    s04: { pos: [505, 58, 240], subj: [502, 4, 102], ndc: [0.27, -0.05], pScale: 1.3, pFov: 54, pNdcY: -0.28 },
    s05: { pos: [612, 56, 186], subj: [520, 0, 92], ndc: [0.3, -0.05], pScale: 1.45, pFov: 54, pNdcY: -0.28 },
    s15: { pos: [-340, 150, 255], subj: [40, 0, 30], ndc: [0.3, -0.02], pScale: 1.05, pFov: 56, pNdcY: -0.3 },
    s16: { pos: [-520, 260, 420], subj: [80, 60, 0], ndc: [0.25, -0.02], pScale: 1.2, pFov: 56, pNdcY: -0.3 }
  },
  portalExit: { via: [[320, 48, 85], [160, 42, 45], [0, 32, 38]], position: [-50, 4, 10], target: [-68, 2.2, 10] },
  portalEntry: { position: [-300, 240, 330], target: [-60, 0, 20] },
  rotor: { turnsPerSec: 0.55, pulseLife: 1.0, pulseGain: 4.5 },
  s03: { holoPos: [-40, 40, 176], holoSize: [56, 25.2], startInertia: 0.35, dragGain: 0.9, rotorShake: 6 },
  s04: { period: 9, dieAt: 2.2, backAt: 6.4, backDur: 1.5 },
  s05: { period: 13.5, outage: 1.5, rise: 6, hold: 11.5, dimDark: 1 },
  s15: { period: 5.6, speed: 150, passDamp: 0.6, origin: [515, 0.5, 100] },
  markers: [[-180, -25], [-205, -125], [-130, 72], [-6, 188]],  // solar, wind, battery, plant site
  glow: { window: 2.1, porch: 1.3, lamp: 2.0, flowSpeedScale: 1 },
  trees: { high: 230, low: 110 },
  dimFactor: { hemi: 0.5, moon: 0.55, rim: 0.4, sky: 0.5 }
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ryAlong = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; return Math.atan2(-dx / l, -dz / l); };
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [t, a] of stops) grd.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function createSpace(ctx) {
  const { tokens, quality, camera } = ctx;
  const prog = (f) => ctx.onProgress && ctx.onProgress(f);
  prog(0.02);
  const lowQ = quality.tier === 'low' || quality.mobile;
  const white = new THREE.Color(1, 1, 1);
  const homeC = new THREE.Color(tokens.home);
  const acC = new THREE.Color(tokens.ac), warnC = new THREE.Color(tokens.warn), mintC = new THREE.Color(tokens.inv1);

  // ---- scene, sky, ground, lights ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(tokens.night1);
  scene.fog = new THREE.FogExp2(tokens.night2, ENV.fogDensity);
  const sky = buildSky(tokens);
  scene.add(sky.dome, sky.stars);
  scene.add(buildGround());
  const lights = buildLights(scene, quality);
  const sh = lights.moon.shadow.camera;
  sh.left = -150; sh.right = 150; sh.top = 150; sh.bottom = -150; sh.near = 1; sh.far = 900; sh.updateProjectionMatrix();
  lights.moon.shadow.mapSize.set(quality.tier === 'high' ? 2048 : 1024, quality.tier === 'high' ? 2048 : 1024);
  const base = { hemi: lights.hemi.intensity, moon: lights.moon.intensity, rim: lights.rim.intensity };
  ctx.loadHDR('assets/env/dusk_1k.hdr').then((env) => { if (env) { scene.environment = env; scene.environmentIntensity = ENV.envIntensity; } }).catch(() => {});

  // ---- props ----
  const glow = createGlowMaterials(tokens);
  const props = await loadProps(ctx, glow, (f) => prog(0.05 + 0.55 * f));
  const addInst = (name, mats, opts = {}) => {
    const r = instancify(props[name], mats, { glowColor: () => white, ...opts });
    scene.add(r.group);
    return r;
  };
  const single = (name, x, z, ry = 0, s = 1) => {
    const o = props[name].clone(true);
    o.position.set(x, 0, z); o.rotation.y = ry; o.scale.setScalar(s);
    scene.add(o); o.updateMatrixWorld(true);
    return o;
  };
  // unique warm emissive materials for non-instanced props that use mat_window / mat_lamp
  const ownGlow = (root, k) => {
    const mats = {};
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material && o.material.name;
      if (n === 'mat_window_engine' || n === 'mat_lamp_engine') {
        mats[n] = mats[n] || Object.assign(o.material.clone(), { color: homeC.clone().multiplyScalar(k) });
        o.material = mats[n];
      }
    });
    return mats;
  };

  // solar farm: 8 rows x 12 tables
  {
    const m = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) m.push(T(-230 + (i - 5.5) * 7.5, 0, -30 + (j - 3.5) * 9));
    addInst('solar_table', m);
  }
  // battery yard: 2 rows x 5
  {
    const m = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 5; i++) m.push(T(-130 + (i - 2) * 16.2, 0, 50 + (j - 0.5) * 6.4));
    addInst('battery_container', m);
  }
  // wind turbines
  const turbines = [];
  for (const [x, z] of [[-330, -160], [-270, -200], [-200, -170], [-140, -215], [-80, -180]]) {
    const t = single('wind_turbine', x, z, 0.64);
    turbines.push({ rotor: t.getObjectByName('rotor'), speed: 0.9 + Math.random() * 0.25, phase: Math.random() * 6 });
    if (turbines[turbines.length - 1].rotor) turbines[turbines.length - 1].rotor.rotation.z = turbines.length;
  }
  // inverter station (door faces +X), transformer
  const station = single('inverter_station', -70, 10, Math.PI / 2);
  const trafoRy = -Math.PI / 2;
  const trafo = single('transformer', -56, 16, trafoRy);
  const trafoM = T(-56, 0, 16, trafoRy);
  // old power plant: cutaway faces +X / -Z toward the s02 camera
  const plantPos = V(-40, 0, 170), plantRy = 3 * Math.PI / 4;
  const rotorBox = new THREE.Box3(), rotorLocal = { c: V(3, 4.4, -1), r: 1.9 };
  {
    const rn = props.power_plant.getObjectByName('generator_rotor');
    if (rn) { props.power_plant.updateMatrixWorld(true); rotorBox.setFromObject(rn); rotorBox.getCenter(rotorLocal.c); const s = rotorBox.getSize(V(0, 0, 0)); rotorLocal.r = Math.max(s.y, s.z) * 0.5 + 0.2; }
  }
  const plant = props.power_plant; // single instance: use the template itself
  plant.position.copy(plantPos); plant.rotation.y = plantRy; scene.add(plant); plant.updateMatrixWorld(true);
  ownGlow(plant, 0.55);
  const rotor = plant.getObjectByName('generator_rotor');
  const hallLight = new THREE.PointLight(0xffd7a0, 110, 60, 2); hallLight.position.set(-6, 9, -4); plant.add(hallLight);
  const hallCyan = new THREE.PointLight(tokens.ac, 260, 40, 2); hallCyan.position.set(rotorLocal.c.x, rotorLocal.c.y + 3, rotorLocal.c.z + 5); plant.add(hallCyan);
  single('cooling_tower', -85, 205); single('cooling_tower', -35, 222);
  // substation
  const substation = single('substation', 310, 40);
  const subLamps = ownGlow(substation, 2);

  // transmission towers
  const towerXZ = [[0, 20], [80, 10], [160, 15], [240, 30]];
  const towerM = towerXZ.map(([x, z], i) => {
    const a = towerXZ[Math.min(i + 1, 3)], b = towerXZ[Math.max(i - 1, 0)];
    const ry = i < 3 ? ryAlong(a[0] - x, a[1] - z) : ryAlong(x - b[0], z - b[1]);
    single('transmission_tower', x, z, ry);
    return T(x, 0, z, ry);
  });

  // distribution poles: three along the line, then every 30 m along the street, plus one by the plant
  const poleXZ = [[350, 60], [385, 75], [420, 90], [450, 92], [480, 92], [510, 92], [540, 92], [570, 92], [590, 92]];
  const poleM = poleXZ.map(([x, z], i) => {
    const a = poleXZ[Math.min(i + 1, poleXZ.length - 1)], b = poleXZ[Math.max(i - 1, 0)];
    const ry = i < poleXZ.length - 1 ? ryAlong(a[0] - x, a[1] - z) : ryAlong(x - b[0], z - b[1]);
    return T(x, 0, z, ry);
  });
  const spurPoleM = T(12, 0, 128, ryAlong(-12, -108));
  addInst('dist_pole', [...poleM, spurPoleM]);

  // town: two courts of houses, cabinets, street lights
  const houses = [];
  const variants = { a: [], b: [], c: [] };
  const order = ['a', 'b', 'c', 'c', 'a', 'b'];
  [[450, 'A'], [530, 'B']].forEach(([x0, court]) => {
    let k = 0;
    for (const [z, ry] of [[82, 0], [118, Math.PI]]) for (let i = 0; i < 3; i++) {
      const v = order[(k++ + (court === 'A' ? 0 : 2)) % 6];
      const x = x0 + i * 25;
      houses.push({ v, court, x, z, ry, idx: variants[v].length, lvl: 1, rate: 3 + Math.random() * 5, rnd: Math.random() });
      variants[v].push(T(x, 0, z, ry));
    }
  });
  const houseInst = {};
  for (const v of ['a', 'b', 'c']) {
    const r = addInst('house_' + v, variants[v]);
    houseInst[v] = { win: r.meshes.find((m) => m.materialName === 'mat_window'), porch: r.meshes.find((m) => m.materialName === 'mat_porch') };
  }
  const lampXZ = [];
  for (let x = 430, i = 0; x <= 600; x += 25, i++) lampXZ.push([x, i % 2 ? 104 : 96, i % 2 ? Math.PI : 0]);
  const lampInst = addInst('street_light', lampXZ.map(([x, z, ry]) => T(x, 0, z, ry)));
  const lampMesh = lampInst.meshes.find((m) => m.materialName === 'mat_lamp');
  const lampLvl = lampXZ.map(() => 1);

  // cabinets with their own status material (court A follows, court B forms)
  const makeCabinet = (x, z, s = 1, ry = 0) => {
    const c = single('grid_cabinet', x, z, ry, s);
    const st = c.getObjectByName('status');
    if (st) { st.material = st.material.clone(); st.material.color.copy(mintC).multiplyScalar(3); }
    return { obj: c, status: st };
  };
  const cabA = makeCabinet(462, 105), cabB = makeCabinet(542, 105);

  // roads
  scene.add(buildRoads([[[-90, 70], [-20, 62], [60, 68], [160, 75], [260, 90], [350, 100], [430, 100], [600, 100]], [[-20, 70], [-8, 125], [-22, 158]]], 7, 0x161a22));

  // trees (instanced clusters near the town, the plant and along the line)
  {
    const R = rng(4242), ma = [], mb = [];
    const want = lowQ ? CFG.trees.low : CFG.trees.high;
    const avoid = (x, z) => {
      if (x > 440 && x < 600 && z > 66 && z < 134) return true;                   // courts + street
      if (x > 470 && x < 570 && z > 130 && z < 190) return true;                  // s04 line of sight
      if (Math.hypot(x + 40, z - 170) < 36) return true;                          // plant hall
      if (Math.hypot(x + 85, z - 205) < 22 || Math.hypot(x + 35, z - 222) < 22) return true;
      if (Math.hypot(x + 8, z - 148) < 22 || Math.hypot(x - 40, z - 110) < 20) return true; // s02 / s03 cameras
      if (x > -300 && x < -180 && z > -75 && z < 15) return true;                 // solar farm
      if (x > -175 && x < -85 && z > 38 && z < 62) return true;                   // battery yard
      if (x > -85 && x < -45 && z > -2 && z < 30) return true;                   // station + transformer
      if (x > 290 && x < 330 && z > 25 && z < 55) return true;                    // substation
      if (z > 94 && z < 106 && x > 330) return true;
      for (const [tx, tz] of towerXZ) if (Math.hypot(x - tx, z - tz) < 14) return true;
      return false;
    };
    const zones = [[410, 620, 20, 170, 0.34], [-130, 60, 100, 260, 0.26], [-30, 330, 35, 115, 0.26], [-460, -300, -90, 120, 0.14]];
    let guard = 0;
    while (ma.length + mb.length < want && guard++ < 6000) {
      let r = R(), z = zones[0];
      let acc = 0; for (const zn of zones) { acc += zn[4]; if (r * 1.0 <= acc) { z = zn; break; } }
      const x = z[0] + R() * (z[1] - z[0]), zz = z[2] + R() * (z[3] - z[2]);
      if (avoid(x, zz)) continue;
      const s = 0.8 + R() * 0.7;
      (R() < 0.55 ? ma : mb).push(T(x, 0, zz, R() * 6.28, s));
    }
    if (ma.length) addInst('tree_a', ma);
    if (mb.length) addInst('tree_b', mb);
  }
  prog(0.7);

  // ---- energy flows and wires ----
  const flows = createFlows(tokens);
  const P = (name, m, fb) => attachPoint(props[name.split(':')[0]], name.split(':')[1], m, fb);
  const stationDoor = V(-72.7, 2.0, 10);
  // DC in
  for (const z of [-56, -30, -4]) flows.add('dc', 'dc', tokens.dc, [V(-188, 0.9, z), V(-150, 0.9, z * 0.5 + 4), V(-105, 0.9, z * 0.15 + 6), V(-82, 1.4, 9), stationDoor]);
  flows.add('dc', 'dc', tokens.dc, [V(-108, 0.9, 48), V(-97, 0.9, 36), V(-82, 1.3, 20), V(-73, 2.2, 12)]);
  // station -> transformer (LV), transformer HV -> towers -> substation
  const lv = [1, 2, 3].map((i) => P('transformer:lv_' + i, trafoM, V(-56, 2.8, 16)));
  flows.add('st', 'dist', tokens.ac, [V(-70, 3.9, 10), V(-64, 5.6, 12), lv[1].clone().add(V(0, 0.4, 0)), lv[1]]);
  const hv = [1, 2, 3].map((i) => P('transformer:hv_' + i, trafoM, V(-56, 3.4, 16)));
  const subM = T(310, 0, 40);
  const subIn = [1, 2, 3].map((i) => attachPoint(props.substation, 'in_' + i, subM, V(298, 10.6, 37 + 3 * i)));
  const subOut = [1, 2, 3].map((i) => attachPoint(props.substation, 'out_' + i, subM, V(322, 10.6, 37 + 3 * i)));
  for (let i = 0; i < 3; i++) {
    const pts = [hv[i], ...towerM.map((m) => attachPoint(props.transmission_tower, 'wire_L' + (i + 1), m, V(0, 20 + 4.5 * i, -7))), subIn[i]];
    flows.add('txL', 'tx', tokens.ac, spanPath(pts, 0.03, 0.4));
  }
  // spur from the plant (pole by the plant -> T1 right arms -> ... -> substation)
  for (let i = 0; i < 3; i++) {
    const pole = attachPoint(props.dist_pole, 'wire_' + (i + 1), spurPoleM, V(0, 9.7, 128));
    const pts = [pole, ...towerM.map((m) => attachPoint(props.transmission_tower, 'wire_R' + (i + 1), m, V(0, 20 + 4.5 * i, 7))), subIn[i].clone().add(V(0, -0.4, 0.2))];
    flows.add('txR', 'tx', tokens.ac, spanPath(pts, 0.03, 0.4));
  }
  // distribution line along the poles
  for (let i = 0; i < 3; i++) {
    const pts = [subOut[i], ...poleM.map((m) => attachPoint(props.dist_pole, 'wire_' + (i + 1), m, V(0, 9.7, 0)))];
    flows.add('dist', 'dist', tokens.ac, spanPath(pts, 0.025, 0.25));
  }
  // drops to houses (grid) and from cabinet B (island)
  houses.forEach((h, i) => {
    let bi = 3, bd = 1e9;
    poleXZ.forEach(([px], k) => { if (k >= 3 && Math.abs(px - h.x) < bd) { bd = Math.abs(px - h.x); bi = k; } });
    const a = attachPoint(props.dist_pole, 'drop', poleM[bi], V(poleXZ[bi][0], 7, 92.4));
    const b = V(h.x, 3.0, h.z + (h.z < 100 ? 4.3 : -4.3));
    h.u = clamp01((h.x - 322) / 270);
    flows.add('drop' + i, 'drop', tokens.ac, sagPoints(a, b, 1.2, 8));
    if (h.court === 'B') {
      const c = V(542, 1.9, 105);
      flows.add('cabB', 'cab', tokens.ac, sagPoints(c, V(h.x, 1.8, h.z + (h.z < 100 ? 4.3 : -4.3)), 0.8, 10));
    }
  });
  scene.add(flows.build());
  // dark wires under the glow, so a dead line still reads as a wire
  {
    const pos = [];
    for (const p of flows.paths) for (let i = 1; i < p.points.length; i++) { const a = p.points[i - 1], b = p.points[i]; pos.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3b4863 }));
    wires.name = 'wires'; wires.frustumCulled = false; scene.add(wires);
  }

  // ---- halos and island glows ----
  const haloTex = radialTexture([[0, 1], [0.25, 0.45], [1, 0]]);
  const mkHalo = (x, y, z, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    s.position.set(x, y, z); s.scale.setScalar(size); s.renderOrder = 9; scene.add(s); return s;
  };
  const mkPool = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: haloTex, color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.4, z); m.renderOrder = 4; scene.add(m); return m;
  };
  const poolA = mkPool(475, 100, 125, 85), poolB = mkPool(555, 100, 125, 85);
  const haloA = mkHalo(462, 1.8, 105, 9), haloB = mkHalo(542, 1.8, 105, 9);
  const stationHalo = mkHalo(-67, 2.6, 10, 12);

  // ---- s02 / s03: rotor ring pulse, ghost rotors, frequency hologram ----
  const swing = createSwing(); swing.s.h = CFG.s03.startInertia;
  const holo = createHologram(tokens, ...CFG.s03.holoSize);
  holo.mesh.position.set(...CFG.s03.holoPos);
  holo.mesh.rotation.y = Math.atan2(CFG.poses.s03.pos[0] - CFG.s03.holoPos[0], CFG.poses.s03.pos[2] - CFG.s03.holoPos[2]);
  scene.add(holo.mesh);
  const ringMat = new THREE.MeshBasicMaterial({ color: acC.clone().multiplyScalar(3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const pulseRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64).rotateY(Math.PI / 2), ringMat);
  pulseRing.position.copy(rotorLocal.c); pulseRing.renderOrder = 7;
  const steadyMat = new THREE.MeshBasicMaterial({ color: acC.clone().multiplyScalar(2.2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const steadyRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 8, 72).rotateY(Math.PI / 2), steadyMat);
  steadyRing.position.copy(rotorLocal.c); steadyRing.scale.set(1, rotorLocal.r * 1.25, rotorLocal.r * 1.25); steadyRing.renderOrder = 7;
  const ghosts = [];
  if (rotor) {
    rotor.parent.add(pulseRing, steadyRing);
    for (let i = 0; i < 3; i++) {
      const gm = new THREE.MeshBasicMaterial({ color: acC.clone().multiplyScalar(1.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: i === 2 });
      const g = rotor.clone(true);
      g.traverse((o) => { if (o.isMesh) { o.material = gm; o.castShadow = false; } });
      g.scale.set(1, 1 + 0.1 * (i + 1), 1 + 0.1 * (i + 1));
      rotor.parent.add(g);
      ghosts.push({ obj: g, mat: gm });
    }
  }
  const spin = { a: 0, lastTurn: 0, pulse: 1 };

  // ---- s15 markers + ripple ----
  const markers = CFG.markers.map(([x, z]) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.visible = false;
    const cab = props.grid_cabinet.clone(true); cab.scale.setScalar(2);
    const st = cab.getObjectByName('status'); if (st) { st.material = st.material.clone(); st.material.color.copy(acC).multiplyScalar(4); }
    g.add(cab);
    const beamMat = new THREE.MeshBasicMaterial({ color: acC.clone().multiplyScalar(2.2), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 2.4, 90, 12, 1, true), beamMat); beam.position.y = 45; g.add(beam);
    const baseMat = new THREE.MeshBasicMaterial({ color: acC.clone().multiplyScalar(2.5), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const base = new THREE.Mesh(new THREE.RingGeometry(14, 17, 48).rotateX(-Math.PI / 2), baseMat); base.position.y = 0.5; g.add(base);
    const hl = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: acC.clone().multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    hl.position.y = 4; hl.scale.setScalar(70); g.add(hl);
    scene.add(g);
    const d = Math.hypot(x - CFG.s15.origin[0], z - CFG.s15.origin[2]);
    return { g, beamMat, baseMat, hl, d, pulse: 0, passed: false, vis: 0 };
  });
  const rippleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 256).rotateX(-Math.PI / 2), rippleMat);
  const rippleSoft = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 256).rotateX(-Math.PI / 2), rippleMat.clone());
  for (const r of [ripple, rippleSoft]) { r.position.set(...CFG.s15.origin); r.visible = false; r.renderOrder = 6; r.frustumCulled = false; scene.add(r); }
  const rip = { t: 0, amp: 1, vis: 0 };

  // ---- state ----
  const L = { up: 1, feed: 1, A: 1, B: 1, dim: 0, cabOut: 0, markers: 0 };
  const court = { mode: '', t: 0 };
  const fOf = {}, fStamp = {};
  let frameNo = 0;
  const F = (id) => (frameNo - (fStamp[id] ?? -9) <= 1 ? fOf[id] : 9);
  const sw = { ready: false };
  let time = 0;

  function targets(mode, t) {
    const o = { up: 1, feed: 1, A: 1, B: 1, dim: 0, fill: 1, dir: 1, cabOut: 0 };
    if (mode === 's04') {
      const c = CFG.s04, p = t % c.period;
      if (p >= c.dieAt && p < c.backAt) { o.feed = 0; o.A = 0; o.cabOut = 1; }
      else if (p >= c.backAt && p < c.backAt + c.backDur) { o.fill = (p - c.backAt) / c.backDur; o.cabOut = 0.6; }
    } else if (mode === 's05' && !(F('s05') > 0.08)) {
      const c = CFG.s05, p = t % c.period;
      const dark = () => { o.feed = 0; o.A = 0; o.up = 0.12; o.dim = c.dimDark; o.cabOut = 1; };
      if (p < c.outage) dark();
      else if (p < c.outage + c.rise) {
        const k = (p - c.outage) / c.rise, e = k * k * (3 - 2 * k) * 0.6 + k * 0.4;
        o.fill = e; o.dir = -1; o.up = e > 0.985 ? 1 : 0.12; o.dim = c.dimDark * (1 - 0.75 * e); o.cabOut = 1;
      } else if (p < c.hold) { /* lit again */ } else dark();
    }
    return o;
  }

  const tmpV = V(0, 0, 0), tmpC = new THREE.Color();
  const offC = new THREE.Color(0.012, 0.016, 0.026);

  function update(dt, tm, nearestId) {
    time = tm; frameNo++;
    const mode = nearestId;
    if (court.mode !== mode) { court.mode = mode; court.t = 0; }
    court.t += dt;
    const tg = targets(mode, court.t);
    const k = (r) => 1 - Math.exp(-dt * r);
    L.up += (tg.up - L.up) * k(2.5); L.feed += (tg.feed - L.feed) * k(6); L.dim += (tg.dim - L.dim) * k(2);
    L.cabOut += (tg.cabOut - L.cabOut) * k(3);
    const aOn = tg.A > 0.5;
    const blink = Math.sin(tm * 1.9) > 0 ? 1 : 0.15;

    // flows
    flows.set('dc', { vis: L.up }); flows.set('st', { vis: L.up }); flows.set('txL', { vis: L.up }); flows.set('txR', { vis: L.up });
    flows.set('dist', { vis: tg.feed > 0.5 || tg.fill < 1 ? 1 : 0.03, fill: tg.fill, dir: tg.dir });
    flows.set('cabB', { vis: 0.12 + 0.88 * L.cabOut });
    // house glow
    let anyChange = false;
    houses.forEach((h, i) => {
      let target;
      if (h.court === 'B') target = tg.B > 0.5 ? 1 : 0;
      else target = aOn && (tg.dir > 0 ? tg.fill >= h.u : tg.fill >= 1 - h.u) ? 1 : 0;
      h.lvl += (target - h.lvl) * k(h.rate);
      const fl = h.lvl > 0.02 && h.lvl < 0.98 ? 0.75 + 0.25 * Math.sin(tm * 40 + i * 5) : 1;
      const vis = h.lvl * fl;
      flows.set('drop' + i, { vis: h.court === 'B' ? (tg.feed > 0.5 ? 1 : 0.02) : (aOn && target ? vis : 0.02) });
      const e = houseInst[h.v];
      tmpC.copy(offC).lerp(homeC, 0).lerp(homeC.clone().multiplyScalar(CFG.glow.window * (0.78 + 0.22 * h.rnd)), vis);
      if (e.win) { e.win.mesh.setColorAt(h.idx, tmpC); }
      tmpC.setRGB(vis, vis, vis);
      if (e.porch) e.porch.mesh.setColorAt(h.idx, tmpC);
    });
    for (const v of ['a', 'b', 'c']) { const e = houseInst[v]; if (e.win && e.win.mesh.instanceColor) e.win.mesh.instanceColor.needsUpdate = true; if (e.porch && e.porch.mesh.instanceColor) e.porch.mesh.instanceColor.needsUpdate = true; }
    // street lights
    if (lampMesh) {
      lampXZ.forEach(([x], i) => {
        const tgt = x < 520 ? (aOn ? 1 : 0) : 1;
        lampLvl[i] += (tgt - lampLvl[i]) * k(5);
        tmpC.copy(offC).lerp(homeC.clone().multiplyScalar(CFG.glow.lamp), lampLvl[i]);
        lampMesh.mesh.setColorAt(i, tmpC);
      });
      lampMesh.mesh.instanceColor.needsUpdate = true;
    }
    // pools of light, cabinets, substation, station
    const aLvl = houses.filter((h) => h.court === 'A').reduce((s, h) => s + h.lvl, 0) / 6;
    poolA.material.color.copy(homeC).multiplyScalar(0.22 * aLvl * aLvl);
    poolB.material.color.copy(homeC).multiplyScalar(0.22 + 0.2 * L.dim);
    const pulse = 0.5 + 0.5 * Math.sin(tm * 5);
    if (cabA.status) cabA.status.material.color.copy(mintC).multiplyScalar(3).lerp(warnC.clone().multiplyScalar(0.7), L.cabOut > 0.5 && !aOn ? 1 : 0);
    if (cabB.status) cabB.status.material.color.copy(acC).multiplyScalar(2.5 + 3 * L.cabOut * pulse);
    haloA.material.color.copy(L.cabOut > 0.5 && !aOn ? warnC : mintC).multiplyScalar(0.25 + 0.05 * pulse);
    haloB.material.color.copy(acC).multiplyScalar(0.3 + 1.6 * L.cabOut * pulse);
    glow.mat_door_glow.color.copy(acC).multiplyScalar(3.5 * (0.15 + 0.85 * L.up) * (0.9 + 0.2 * Math.sin(tm * 2)));
    stationHalo.material.color.copy(acC).multiplyScalar(0.55 * L.up);
    for (const n in subLamps) subLamps[n].color.copy(homeC).multiplyScalar(2 * (0.1 + 0.9 * L.up));
    glow.mat_nav_light.color.copy(glow.mat_nav_light.userData.base).multiplyScalar(0.12 + 0.88 * blink);
    for (const t of turbines) if (t.rotor) t.rotor.rotation.z += dt * 0.55 * t.speed;

    // lighting dim for the dark-landscape moment
    const D = CFG.dimFactor;
    lights.hemi.intensity = base.hemi * (1 - D.hemi * L.dim); lights.moon.intensity = base.moon * (1 - D.moon * L.dim); lights.rim.intensity = base.rim * (1 - D.rim * L.dim);
    sky.dome.material.uniforms.uDim.value = L.dim * D.sky; sky.stars.material.uniforms.uDim.value = L.dim * 0.5;
    sky.stars.material.uniforms.uTime.value = tm;
    sky.stars.material.uniforms.uPx.value = ctx.renderer.getPixelRatio();

    // shadow window follows the camera
    camera.getWorldDirection(tmpV);
    const fx = Math.round(camera.position.x + tmpV.x * 70), fz = Math.round(camera.position.z + tmpV.z * 70);
    lights.moon.target.position.set(fx, 0, fz);
    lights.moon.position.set(fx + ENV.moon.dir[0] * 300, ENV.moon.dir[1] * 300, fz + ENV.moon.dir[2] * 300);

    // rotor
    const near23 = Math.abs(F('s02')) < 1 || Math.abs(F('s03')) < 1;
    if (rotor && near23) {
      const df = swing.s.df;
      const sp = CFG.rotor.turnsPerSec * Math.PI * 2 * (1 + (df / 60) * CFG.s03.rotorShake);
      spin.a += dt * sp;
      rotor.rotation.x = spin.a;
      ghosts.forEach((g, i) => { g.obj.rotation.x = spin.a - 0.25 * (i + 1); });
      const turn = Math.floor(spin.a / (Math.PI * 2));
      if (turn !== spin.lastTurn) { spin.lastTurn = turn; spin.pulse = 0; }
      spin.pulse += dt / CFG.rotor.pulseLife;
      const pk = clamp01(spin.pulse);
      pulseRing.visible = pk < 1;
      const sc = rotorLocal.r * (1.1 + 1.6 * (1 - Math.pow(1 - pk, 2)));
      pulseRing.scale.set(1, sc, sc);
      ringMat.opacity = Math.pow(1 - pk, 1.5) * 0.9 * clamp01(near23 ? 1 : 0);
      const h = swing.s.h;
      steadyRing.scale.set(0.35 + 2.4 * h, rotorLocal.r * 1.25, rotorLocal.r * 1.25);
      steadyMat.opacity = 0.18 + 0.5 * h;
      const gv = smooth(0.0, 1.0, 1 - Math.abs(F('s03')));
      ghosts[0] && (ghosts[0].mat.opacity = gv * 0.28 * smooth(0.12, 0.4, h));
      ghosts[1] && (ghosts[1].mat.opacity = gv * 0.22 * smooth(0.4, 0.7, h));
      ghosts[2] && (ghosts[2].mat.opacity = gv * 0.2 * smooth(0.65, 0.95, h));
    }

    // s03 hologram
    const f3 = F('s03'), f2 = F('s02');
    if (Math.abs(f3) < 1) {
      if (!sw.ready) { for (let i = 0; i < 700; i++) swing.step(1 / 60); sw.ready = true; }
      swing.step(dt);
      holo.draw(swing);
    }
    const holoVis = f3 < 0 ? smooth(-0.9, -0.2, f3) * (f2 > -0.2 ? 1 : 1) : 1 - smooth(0.35, 0.8, f3);
    holo.mesh.material.opacity = Math.abs(f3) < 1 ? holoVis : 0;
    holo.mesh.visible = holo.mesh.material.opacity > 0.01;
    // keep a little frequency motion even from afar so the first sight is alive
    // s15 ripple + markers
    const in15 = mode === 's15', in16 = mode === 's16';
    L.markers += (((in15 || in16) ? 1 : 0) - L.markers) * k(1.6);
    rip.vis += ((in15 ? 1 : 0) - rip.vis) * k(3);
    if (in15) {
      rip.t += dt;
      if (rip.t > CFG.s15.period) { rip.t = 0; rip.amp = 1; markers.forEach((m) => { m.passed = false; }); }
    } else { rip.t = Math.min(rip.t, 0); rip.amp = 1; }
    const rr = Math.max(0.01, rip.t * CFG.s15.speed);
    for (const m of markers) {
      if (!m.passed && rr >= m.d && in15) { m.passed = true; m.pulse = 1; rip.amp *= CFG.s15.passDamp; }
      m.pulse *= Math.exp(-dt * 2.2);
      m.g.visible = L.markers > 0.02;
      const b = (0.55 + 0.45 * Math.sin(tm * 1.2 + m.d)) * L.markers;
      m.beamMat.opacity = (0.16 + 0.1 * b + 0.5 * m.pulse) * L.markers;
      m.baseMat.opacity = (0.5 + 0.2 * b + 0.8 * m.pulse) * L.markers;
      m.hl.material.opacity = (0.5 + 0.5 * m.pulse) * L.markers;
    }
    const rv = rip.vis > 0.02 && rip.t > 0.05 && rr < 900;
    for (const [i, r] of [ripple, rippleSoft].entries()) {
      r.visible = rv; r.scale.setScalar(rr);
      r.material.color.copy(acC).multiplyScalar((i ? 0.8 : 5.5) * rip.amp * rip.vis * smooth(0, 40, rr) * (1 - smooth(780, 900, rr)));
    }
  }

  // ---- stations ----
  const mkPose = (c) => (aspect) => {
    const portrait = aspect < 0.8;
    const subj = V(...c.subj);
    let pos = V(...c.pos);
    let fov = c.fov ?? 42, nx = c.ndc[0], ny = c.ndc[1];
    if (portrait) { pos = subj.clone().add(pos.sub(subj).multiplyScalar(c.pScale ?? 1.4)); fov = c.pFov ?? 52; nx = 0; ny = c.pNdcY ?? -0.3; }
    const fwd = subj.clone().sub(pos); const d = fwd.length(); fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, V(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const hh = d * Math.tan(THREE.MathUtils.degToRad(fov) / 2), hw = hh * aspect;
    const target = subj.clone().addScaledVector(right, -nx * hw).addScaledVector(up, -ny * hh);
    return { position: pos, target, fov };
  };
  const track = (id, extra = {}) => ({ pose: mkPose(CFG.poses[id]), update(f) { fOf[id] = f; fStamp[id] = frameNo; }, ...extra });
  const stations = {
    s01: track('s01'),
    s02: track('s02'),
    s03: track('s03', {
      pointer(e) {
        if (e.type === 'move') swing.s.h = clamp01(swing.s.h + e.dx * CFG.s03.dragGain);
      }
    }),
    s04: track('s04', { labels: [
      { text: 'Grid-following inverter', anchor: V(462, 4.2, 104), tone: 'warn' },
      { text: 'Grid-forming inverter', anchor: V(542, 4.2, 104), tone: 'ac' }
    ] }),
    s05: track('s05'),
    s15: track('s15'),
    s16: track('s16')
  };
  const portals = {
    exit: { position: V(...CFG.portalExit.position), target: V(...CFG.portalExit.target), via: CFG.portalExit.via.map((a) => V(...a)) },
    entry: { position: V(...CFG.portalEntry.position), target: V(...CFG.portalEntry.target) }
  };
  prog(1);
  return {
    id: 'world', scene, stations, portals, update,
    camera: { near: 0.4, far: 7000 },
    setQuality(t) {
      const s = t === 'high' ? 2048 : 1024;
      if (lights.moon.shadow.mapSize.x !== s) { lights.moon.shadow.mapSize.set(s, s); lights.moon.shadow.map?.dispose(); lights.moon.shadow.map = null; }
    }
  };
}
