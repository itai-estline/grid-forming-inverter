// s03: a glowing frequency trace above the old plant, driven live by a small swing-equation model.
// Illustrative only: per-unit, one lumped machine, slow primary (governor) response.
import * as THREE from 'three';

export const SWING = {
  f0: 60,
  Hmax: 6.0,          // s, "lots of spinning machines"
  Hmin: 0.7,          // s, "almost none"
  D: 1.0,             // load damping (pu power per pu frequency)
  R: 0.05,            // governor droop
  Tg: 1.8,            // s, slow primary response
  bump: 0.08,         // pu load step
  bumpOn: 2.2,        // s the bump lasts
  period: 4.2,        // s between bumps
  window: 8,          // s of history shown
  yRange: 1.2         // Hz shown above/below 60
};

export function createSwing() {
  const s = { df: 0, pm: 0, t: 0, h: 1, hist: new Float32Array(480), head: 0, acc: 0 };
  const sampleDt = SWING.window / s.hist.length;
  function load(t) { const k = t % SWING.period; return (k > 0.6 && k < 0.6 + SWING.bumpOn) ? SWING.bump : 0; }
  function step(dt) {
    const H = SWING.Hmin + (SWING.Hmax - SWING.Hmin) * s.h;
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      s.t += h;
      const w = s.df / SWING.f0; // pu frequency deviation
      const pl = load(s.t);
      const dw = (s.pm - pl - SWING.D * w) / (2 * H);
      s.df += dw * SWING.f0 * h;
      s.pm += ((-w / SWING.R) - s.pm) / SWING.Tg * h * (s.t % SWING.period > 0.6 + SWING.bumpOn + 0.6 ? 0.6 : 1);
      // slow secondary drift back to zero so every bump starts from 60 Hz
      s.pm -= s.pm * 0.0 * h;
      s.df -= s.df * 0.25 * h * (pl === 0 ? 1 : 0);
    }
    s.acc += dt;
    while (s.acc >= sampleDt) { s.acc -= sampleDt; s.hist[s.head] = s.df; s.head = (s.head + 1) % s.hist.length; }
  }
  function reset() { s.df = 0; s.pm = 0; s.t = 0; s.hist.fill(0); s.acc = 0; }
  return { s, step, reset };
}

export function createHologram(tokens, widthM = 40, heightM = 18) {
  const W = 1024, H = 460;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: new THREE.Color(1.9, 1.9, 1.9), opacity: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mat);
  mesh.name = 'freq_hologram';
  mesh.renderOrder = 8;
  const ac = '#' + new THREE.Color(tokens.ac).getHexString();

  function draw(swing) {
    const s = swing.s;
    g.clearRect(0, 0, W, H);
    const x0 = 96, x1 = W - 40, y0 = 70, y1 = H - 90;
    const yc = (y0 + y1) / 2;
    const ys = (y1 - y0) / 2 / SWING.yRange;
    // frame + grid
    g.strokeStyle = 'rgba(63,224,255,0.16)'; g.lineWidth = 2;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.beginPath();
    for (let k = -1; k <= 1; k++) { if (!k) continue; g.moveTo(x0, yc - k * ys); g.lineTo(x1, yc - k * ys); }
    for (let i = 1; i < 8; i++) { const x = x0 + (x1 - x0) * i / 8; g.moveTo(x, y0); g.lineTo(x, y1); }
    g.stroke();
    g.strokeStyle = 'rgba(63,224,255,0.45)'; g.setLineDash([10, 10]);
    g.beginPath(); g.moveTo(x0, yc); g.lineTo(x1, yc); g.stroke(); g.setLineDash([]);
    g.font = '500 26px "DM Mono", monospace'; g.fillStyle = 'rgba(184,224,240,0.85)'; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText('60', x0 - 14, yc); g.fillText('61', x0 - 14, yc - ys); g.fillText('59', x0 - 14, yc + ys);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '600 26px "Barlow Condensed", sans-serif'; g.fillStyle = 'rgba(220,240,250,0.9)';
    g.fillText('GRID FREQUENCY  (Hz)', x0, y0 - 24);
    g.textAlign = 'right'; g.font = '500 40px "DM Mono", monospace';
    // lead: the readout warns as the frequency leaves 60 Hz (yellow past 0.2 Hz, red past 0.5 Hz)
    const dev = Math.abs(s.df);
    g.fillStyle = dev > 0.5 ? '#ff4a36' : dev > 0.2 ? '#ffd23f' : ac;
    g.fillText((SWING.f0 + s.df).toFixed(2), x1, y0 - 18);
    // trace (oldest -> newest)
    const n = s.hist.length;
    g.lineJoin = 'round';
    for (const [w, a] of [[14, 0.14], [6, 0.35], [3, 1]]) {
      g.strokeStyle = a === 1 ? ac : `rgba(63,224,255,${a})`;
      g.lineWidth = w;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const v = s.hist[(s.head + i) % n];
        const x = x0 + (x1 - x0) * i / (n - 1);
        const y = Math.max(y0, Math.min(y1, yc - v * ys));
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    // inertia gauge
    const gy = H - 44;
    g.font = '600 22px Inter, sans-serif'; g.textAlign = 'left'; g.fillStyle = 'rgba(220,240,250,0.85)';
    g.fillText('INERTIA', x0, gy + 8);
    const gx0 = x0 + 130, gx1 = x1 - 210;
    g.fillStyle = 'rgba(63,224,255,0.18)'; g.fillRect(gx0, gy - 4, gx1 - gx0, 10);
    g.fillStyle = ac; g.fillRect(gx0, gy - 4, (gx1 - gx0) * (0.04 + 0.96 * s.h), 10);
    g.textAlign = 'right'; g.font = '500 22px "DM Mono", monospace'; g.fillStyle = 'rgba(220,240,250,0.85)';
    g.fillText(s.h > 0.66 ? 'MANY MACHINES' : s.h > 0.33 ? 'SOME' : 'ALMOST NONE', x1, gy + 8);
    tex.needsUpdate = true;
  }
  return { mesh, draw };
}
