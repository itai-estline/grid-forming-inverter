// The camera rail (PLAN 4.4).
// p = continuous station index 0..N-1. s = scroll distance (gap lengths follow `weight`).
// Within a run of stations in one space the camera follows a centripetal Catmull-Rom curve through
// pose().position (+ via points); targets follow a curve through the pose targets; fov is lerped.
// A gap that changes space is flown half in the old space (station -> oldSpace.portals.exit) and half in
// the new one (newSpace.portals.entry -> station). The veil covers the cut.
import * as THREE from 'three';
import { CAMERA, SCROLL, VEIL } from './config.js';

const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function curveOf(points) {
  if (points.length === 1) points = [points[0], points[0].clone()];
  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}

// Maps t in [0,1] across control points [i0, i1] by chord length, returns curve parameter u.
function chordMapper(points, i0, i1) {
  const n = points.length;
  const lens = [];
  let total = 0;
  for (let i = i0; i < i1; i++) { const l = points[i].distanceTo(points[i + 1]) + 1e-6; lens.push(l); total += l; }
  return (t) => {
    if (i1 === i0 || n < 2) return n < 2 ? 0 : i0 / (n - 1);
    let d = t * total;
    for (let k = 0; k < lens.length; k++) {
      if (d <= lens[k] || k === lens.length - 1) return (i0 + k + Math.min(1, d / lens[k])) / (n - 1);
      d -= lens[k];
    }
    return i1 / (n - 1);
  };
}

export class Rail {
  // stations: [{ id, spaceId }] in journey order; spaces: { world, machine }
  constructor(stations, spaces) {
    this.stations = stations;
    this.spaces = spaces;
    this.n = stations.length;
    this.weights = [0];
    for (let k = 1; k < this.n; k++) this.weights.push(this._gapWeight(k));
    this.S = [0];
    for (let k = 1; k < this.n; k++) this.S.push(this.S[k - 1] + this.weights[k]);
    this.total = this.S[this.n - 1];
    this.gaps = [];
    this.aspect = 0;
  }

  def(k) { const st = this.stations[k]; return this.spaces[st.spaceId].stations[st.id] || {}; }

  _gapWeight(k) {
    const a = this.stations[k - 1], b = this.stations[k];
    const d = this.def(k);
    if (typeof d.weight === 'number') return Math.max(0.2, d.weight);
    if (a.spaceId !== b.spaceId) {
      const ex = this.spaces[a.spaceId].portals?.exit, en = this.spaces[b.spaceId].portals?.entry;
      return 0.5 * (ex?.weight ?? 1) + 0.5 * (en?.weight ?? 1);
    }
    return 1;
  }

  sToP(s) {
    s = Math.min(this.total, Math.max(0, s));
    for (let k = 1; k < this.n; k++) if (s <= this.S[k]) return (k - 1) + (s - this.S[k - 1]) / this.weights[k];
    return this.n - 1;
  }
  pToS(p) {
    p = Math.min(this.n - 1, Math.max(0, p));
    const k = Math.floor(p);
    if (k >= this.n - 1) return this.total;
    return this.S[k] + (p - k) * this.weights[k + 1];
  }

  _pose(k, aspect) {
    const d = this.def(k);
    const p = d.pose ? d.pose(aspect) : null;
    if (!p) return { position: new THREE.Vector3(0, 10, 30), target: new THREE.Vector3(), fov: CAMERA.fov };
    return { position: p.position.clone(), target: p.target.clone(), fov: p.fov ?? CAMERA.fov };
  }

  build(aspect) {
    this.aspect = aspect;
    const poses = [];
    for (let k = 0; k < this.n; k++) poses.push(this._pose(k, aspect));
    this.poses = poses;
    this.gaps = [null];
    // Runs of consecutive stations in the same space.
    let k = 0;
    while (k < this.n) {
      const sp = this.stations[k].spaceId;
      let e = k;
      while (e + 1 < this.n && this.stations[e + 1].spaceId === sp) e++;
      const pts = [], idx = [], tgts = [];
      for (let j = k; j <= e; j++) {
        if (j > k) for (const v of (this.def(j).via || [])) pts.push(v.clone());
        idx.push(pts.length);
        pts.push(poses[j].position);
        tgts.push(poses[j].target);
      }
      const posCurve = curveOf(pts), tgtCurve = curveOf(tgts);
      for (let j = k + 1; j <= e; j++) {
        const a = j - 1 - k;
        this.gaps[j] = {
          type: 'run', space: sp, posCurve, tgtCurve,
          map: chordMapper(pts, idx[a], idx[a + 1]),
          tA: a / Math.max(1, tgts.length - 1), tB: (a + 1) / Math.max(1, tgts.length - 1),
          fovA: poses[j - 1].fov, fovB: poses[j].fov
        };
      }
      if (e + 1 < this.n) {
        // Space change from station e to e+1.
        const spA = this.spaces[sp], spB = this.spaces[this.stations[e + 1].spaceId];
        const ex = spA.portals?.exit || { position: poses[e].position.clone().add(new THREE.Vector3(0, 0, -20)), target: poses[e].target };
        const en = spB.portals?.entry || { position: poses[e + 1].position.clone().add(new THREE.Vector3(0, 0, 20)), target: poses[e + 1].target };
        const outPts = [poses[e].position, ...(ex.via || []).map(v => v.clone()), ex.position.clone()];
        const inPts = [en.position.clone(), ...(en.via || []).map(v => v.clone()), ...(this.def(e + 1).via || []).map(v => v.clone()), poses[e + 1].position];
        this.gaps[e + 1] = {
          type: 'change', spaceA: sp, spaceB: this.stations[e + 1].spaceId,
          outCurve: curveOf(outPts), inCurve: curveOf(inPts),
          outMap: chordMapper(outPts, 0, outPts.length - 1), inMap: chordMapper(inPts, 0, inPts.length - 1),
          tgtA0: poses[e].target, tgtA1: ex.target.clone(), tgtB0: en.target.clone(), tgtB1: poses[e + 1].target,
          fovA0: poses[e].fov, fovA1: ex.fov ?? poses[e].fov, fovB0: en.fov ?? poses[e + 1].fov, fovB1: poses[e + 1].fov
        };
      }
      k = e + 1;
    }
  }

  // out: { space, position, target, fov, veil }
  evaluate(p, out) {
    p = Math.min(this.n - 1, Math.max(0, p));
    let k = Math.floor(p);
    let t = p - k;
    if (k >= this.n - 1) { k = this.n - 2; t = 1; }
    const g = this.gaps[k + 1];
    out.veil = 0;
    if (g.type === 'run') {
      const te = t + (smoother(t) - t) * SCROLL.stationEase;
      const u = g.map(te);
      g.posCurve.getPoint(u, out.position);
      g.tgtCurve.getPoint(g.tA + (g.tB - g.tA) * te, out.target);
      out.fov = g.fovA + (g.fovB - g.fovA) * te;
      out.space = g.space;
    } else {
      out.veil = smooth(VEIL.fadeInStart, VEIL.opaqueStart, t) * (1 - smooth(VEIL.opaqueEnd, VEIL.fadeOutEnd, t));
      if (t < 0.5) {
        const x = t / 0.5;
        const e = x * x * (3 - 2 * x) * 0.5 + x * x * 0.5; // leaves slowly, arrives fast
        g.outCurve.getPoint(g.outMap(e), out.position);
        const te = smooth(0, 1, x);
        out.target.copy(g.tgtA0).lerp(g.tgtA1, te);
        out.fov = g.fovA0 + (g.fovA1 - g.fovA0) * te;
        out.space = g.spaceA;
      } else {
        const x = (t - 0.5) / 0.5;
        const e = x * x * (3 - 2 * x); // lead: an even glide in, so the first view after the cut is the wide one
        const ee = Math.min(1, Math.max(0, e));
        g.inCurve.getPoint(g.inMap(ee), out.position);
        const te = smooth(0, 1, x);
        out.target.copy(g.tgtB0).lerp(g.tgtB1, te);
        out.fov = g.fovB0 + (g.fovB1 - g.fovB0) * te;
        out.space = g.spaceB;
      }
    }
    return out;
  }
}
