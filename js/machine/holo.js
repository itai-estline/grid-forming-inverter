// Holographic instruments: flat glowing canvases and line meshes placed near the parts.
// Canvases are redrawn at <= 30 Hz and only while visible (PLAN performance rules).

const MONO = '"DM Mono", ui-monospace, Menlo, Consolas, monospace';

export function hexCss(h) { return '#' + h.toString(16).padStart(6, '0'); }

export class CanvasPanel {
  constructor(THREE, { px = [640, 360], width = 6, gain = 2.2, name = 'holo' }) {
    this.cv = document.createElement('canvas');
    this.cv.width = px[0]; this.cv.height = px[1];
    this.g = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.gain = gain;
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      fog: false, side: THREE.DoubleSide
    });
    this.mat.color.setScalar(0);
    const h = width * px[1] / px[0];
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), this.mat);
    this.mesh.name = name;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.size = [width, h];
    this.last = -1;
    this.vis = 0;
  }
  setVis(v) {
    this.vis = v;
    this.mesh.visible = v > 0.01;
    this.mat.color.setScalar(this.gain * v);
  }
  // returns true when it is time to redraw
  due(time, hz) {
    if (!this.mesh.visible) return false;
    if (this.last >= 0 && time - this.last < 1 / hz && time >= this.last) return false;
    this.last = time;
    return true;
  }
  commit() { this.tex.needsUpdate = true; }
  clear() {
    const { g, cv } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
  }
  frame(color = 'rgba(184,191,204,0.55)', title = null) {
    const { g, cv } = this;
    const W = cv.width, H = cv.height, c = 18, m = 6;
    g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath();
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      g.moveTo(x + dx * c, y); g.lineTo(x, y); g.lineTo(x, y + dy * c);
    }
    g.stroke();
    if (title) {
      g.fillStyle = 'rgba(184,191,204,0.7)';
      g.font = `500 ${Math.round(H * 0.06)}px ${MONO}`;
      g.textBaseline = 'top';
      g.fillText(title, m + 14, m + 10);
    }
  }
}

// Small text plate (watt values, axis words): drawn on demand
export function textPlate(THREE, { px = [256, 96], width = 2, gain = 1.6 }) {
  return new CanvasPanel(THREE, { px, width, gain, name: 'plate' });
}

// Holographic flywheel: rim, spokes, hub, tick marks. Spins about its local Z.
export function makeFlywheel(THREE, color, radius = 2.4) {
  const group = new THREE.Group();
  group.name = 'holo_flywheel';
  const spin = new THREE.Group();
  group.add(spin);
  const mat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const faint = mat.clone();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.028, 6, 96), mat);
  const rim2 = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, radius * 0.01, 4, 96), faint);
  const hub = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.16, radius * 0.03, 6, 32), mat);
  spin.add(rim, rim2, hub);
  const spokeG = new THREE.BoxGeometry(radius * 0.025, radius * 0.68, radius * 0.02);
  spokeG.translate(0, radius * 0.16 + radius * 0.34, 0);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(spokeG, mat);
    s.rotation.z = (i / 6) * Math.PI * 2;
    spin.add(s);
  }
  const tickG = new THREE.BoxGeometry(radius * 0.02, radius * 0.1, radius * 0.02);
  tickG.translate(0, radius * 1.1, 0);
  for (let i = 0; i < 24; i++) {
    const t = new THREE.Mesh(tickG, faint);
    t.rotation.z = (i / 24) * Math.PI * 2;
    group.add(t); // ticks stay still: they make the rotation readable
  }
  // mass markers on the rim (make the spin visible even in a still)
  const massG = new THREE.SphereGeometry(radius * 0.06, 10, 8);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(massG, mat);
    const a = (i / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    spin.add(s);
  }
  return { group, spin, mats: [mat, faint], base: color.clone() };
}

// Edge-lit frame around a box (12 thin bars)
export function makeEdgeFrame(THREE, box, color, t = 0.06) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const min = box.min, max = box.max, s = box.getSize(new THREE.Vector3());
  const bars = [];
  for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) bars.push([[s.x + t, t, t], [(min.x + max.x) / 2, y, z]]);
  for (const x of [min.x, max.x]) for (const z of [min.z, max.z]) bars.push([[t, s.y + t, t], [x, (min.y + max.y) / 2, z]]);
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) bars.push([[t, t, s.z + t], [x, y, (min.z + max.z) / 2]]);
  for (const [sz, p] of bars) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...sz), mat);
    m.position.set(...p);
    g.add(m);
  }
  return { group: g, mat, base: color.clone() };
}

// ---------------------------------------------------------------------------------------
// Canvas drawings. All take (panel, state) and use token colours.
// ---------------------------------------------------------------------------------------
export function drawDroop(p, s, col) {
  const { g, cv } = p;
  const W = cv.width, H = cv.height;
  p.clear(); p.frame();
  const x0 = W * 0.16, x1 = W * 0.92, y0 = H * 0.16, y1 = H * 0.8;
  g.strokeStyle = 'rgba(184,191,204,0.6)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0, y0 - 10); g.lineTo(x0, y1); g.lineTo(x1 + 10, y1); g.stroke();
  g.fillStyle = 'rgba(214,218,226,0.85)';
  g.font = `500 ${Math.round(H * 0.07)}px ${MONO}`;
  g.textBaseline = 'alphabetic';
  g.fillText('load', x1 - H * 0.18, y1 + H * 0.12);
  g.save(); g.translate(x0 - H * 0.06, y0 + H * 0.36); g.rotate(-Math.PI / 2); g.fillText('frequency', 0, 0); g.restore();
  // droop line
  const lx0 = x0 + 20, lx1 = x1 - 10, ly0 = y0 + H * 0.08, ly1 = y0 + H * 0.46;
  g.strokeStyle = col.ac; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(lx0, ly0); g.lineTo(lx1, ly1); g.stroke();
  // light / double load marks
  const at = (u) => [lx0 + (lx1 - lx0) * u, ly0 + (ly1 - ly0) * u];
  const uL = 0.3, uD = 0.78;
  g.setLineDash([6, 8]); g.lineWidth = 2; g.strokeStyle = 'rgba(184,191,204,0.45)';
  for (const u of [uL, uD]) { const [x, y] = at(u); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y1); g.moveTo(x, y); g.lineTo(x0, y); g.stroke(); }
  g.setLineDash([]);
  g.fillStyle = 'rgba(184,191,204,0.75)';
  g.font = `400 ${Math.round(H * 0.055)}px ${MONO}`;
  g.fillText('1×', at(uL)[0] - 10, y1 - 10);
  g.fillText('2×', at(uD)[0] - 10, y1 - 10);
  // moving dot + short trail
  const u = uL + (uD - uL) * s.load;
  const [dx, dy] = at(u);
  const gr = g.createRadialGradient(dx, dy, 0, dx, dy, 34);
  gr.addColorStop(0, col.ctlA); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(dx, dy, 34, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(dx, dy, 8, 0, Math.PI * 2); g.fill();
  g.strokeStyle = col.ctl; g.lineWidth = 3; g.beginPath(); g.arc(dx, dy, 14, 0, Math.PI * 2); g.stroke();
}

export function drawWaves(p, s, col) {
  const { g, cv } = p;
  const W = cv.width, H = cv.height;
  p.clear(); p.frame();
  const x0 = W * 0.06, x1 = W * 0.94, ym = H * 0.52, A = H * 0.28;
  g.strokeStyle = 'rgba(184,191,204,0.25)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x0, ym); g.lineTo(x1, ym); g.stroke();
  const N = 140, cycles = 2.6;
  const plot = (fn, stroke, w) => {
    g.strokeStyle = stroke; g.lineWidth = w; g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const y = ym - A * fn(u);
      const x = x0 + (x1 - x0) * u;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  };
  // time axis: u = 1 is "now"; s.t in cycles
  const ph = (u) => (s.t - (1 - u) * cycles) * Math.PI * 2;
  const ref = (u) => Math.sin(ph(u));
  const meas = (u) => {
    const tc = s.t - (1 - u) * cycles - s.td; // cycles since the disturbance
    let d = 0;
    if (tc > 0) d = s.amp * Math.exp(-tc / 0.09) * (1 - Math.exp(-tc / 0.015));
    return Math.sin(ph(u)) * (1 - d * 0.9) - d * 0.55;
  };
  plot(ref, col.ctl, 4);
  plot(meas, col.ac, 3);
  g.font = `500 ${Math.round(H * 0.065)}px ${MONO}`;
  g.textBaseline = 'top';
  g.fillStyle = col.ctl; g.fillText('reference', x0 + 10, H * 0.07);
  g.fillStyle = col.ac; g.fillText('measured', x0 + 10 + H * 0.5, H * 0.07);
}

export function drawCurrent(p, s, col) {
  const { g, cv } = p;
  const W = cv.width, H = cv.height;
  p.clear(); p.frame();
  const x0 = W * 0.06, x1 = W * 0.94, ym = H * 0.56, A = H * 0.3; // A = 10 A
  g.strokeStyle = 'rgba(184,191,204,0.25)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x0, ym); g.lineTo(x1, ym); g.stroke();
  // dashed limit lines at +/-10 A
  g.setLineDash([10, 9]); g.strokeStyle = col.warn; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(x0, ym - A); g.lineTo(x1, ym - A); g.moveTo(x0, ym + A); g.lineTo(x1, ym + A); g.stroke();
  g.setLineDash([]);
  g.fillStyle = col.warn;
  g.font = `500 ${Math.round(H * 0.075)}px ${MONO}`;
  g.textBaseline = 'bottom';
  g.fillText('10 A', x1 - H * 0.36, ym - A - 6);
  g.fillStyle = 'rgba(214,218,226,0.85)';
  g.textBaseline = 'top';
  g.font = `500 ${Math.round(H * 0.06)}px ${MONO}`;
  g.fillText('current', x0 + 10, H * 0.07);
  // trace: window of 3.2 s ending "now"
  const span = 3.2, N = 220;
  g.strokeStyle = s.hot > 0.05 ? col.hot : col.ac; g.lineWidth = 3.2; g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const t = s.t - (1 - u) * span;
    const y = ym - A * s.fn(t);
    const x = x0 + (x1 - x0) * u;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  // fault marker
  const tf = s.tFault;
  const uf = 1 - (s.t - tf) / span;
  if (uf > 0 && uf < 1) {
    const xf = x0 + (x1 - x0) * uf;
    g.strokeStyle = 'rgba(255,107,74,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(xf, H * 0.16); g.lineTo(xf, H * 0.94); g.stroke();
    g.fillStyle = col.warn; g.textBaseline = 'top';
    g.fillText('fault', xf + 8, H * 0.84);
  }
}

export function drawBarLabel(p, title, watts, color) {
  const { g, cv } = p;
  const W = cv.width, H = cv.height;
  p.clear();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.font = `500 ${Math.round(H * 0.42)}px ${MONO}`;
  g.fillText(title, W / 2, H * 0.3);
  g.fillStyle = 'rgba(226,230,236,0.95)';
  g.font = `400 ${Math.round(H * 0.3)}px ${MONO}`;
  g.fillText(`${Math.round(watts)} W`, W / 2, H * 0.75);
  g.textAlign = 'start';
}
