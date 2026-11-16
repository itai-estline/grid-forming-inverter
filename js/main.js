// Home page boot and wiring: quality tier, loading screen, spaces, rail camera, input, overlay, audio.
import * as THREE from 'three';
import { TOKENS, SCROLL, CAMERA, QUALITY_ORDER, AUTO_QUALITY, PATHS } from './core/config.js';
import { createRenderer, detectTier, isMobile, hasWebGL } from './core/renderer.js';
import { createLoaders } from './core/loaders.js';
import { Rail } from './core/rail.js';
import { createInput } from './core/input.js';
import { createOverlay } from './core/overlay.js';
import { createHeadline3D } from './core/headline3d.js';
import { createAudio } from './core/audio.js';
import { buildFallback } from './core/fallback.js';
import { createStubMachine } from './core/stub-machine.js';

const params = new URLSearchParams(location.search);
let readyResolve;
const journey = {
  ready: new Promise((r) => { readyResolve = r; }),
  progress: 0, stations: [], fps: 0, mode: 'loading', tier: null,
  goTo() {}, setQuality() {}
};
window.__journey = journey;

function smoothDamp(cur, target, st, smoothTime, dt) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (st.v + omega * change) * dt;
  st.v = (st.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

async function boot() {
  let content;
  try {
    content = await fetch(PATHS.content).then((r) => r.json());
  } catch (e) {
    console.error('[engine] could not load content', e);
    readyResolve(); return;
  }
  journey.stations = content.stations.map((s) => s.id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reason = params.get('static') === '1' ? 'param' : reduce ? 'reduced-motion' : !hasWebGL() ? 'no-webgl' : null;
  if (reason) {
    buildFallback(content, reason);
    journey.mode = 'static';
    readyResolve();
    return;
  }
  try {
    await run3D(content);
  } catch (e) {
    console.error('[engine] 3D failed, showing the static page', e);
    buildFallback(content, 'error');
    journey.mode = 'static';
    readyResolve();
  }
}

async function run3D(content) {
  const forced = params.get('quality');
  let tier = detectTier(forced);
  const mobile = isMobile();
  // canvas-drawn text (3D headline, holograms) needs the web fonts loaded first
  try { await Promise.all(['400 40px "Bodoni Moda"', '500 20px "DM Mono"', '600 20px "Barlow Condensed"'].map((f) => document.fonts.load(f))); } catch (e) {}
  const canvas = document.getElementById('gl');
  const R = createRenderer(canvas, tier);
  if (params.get('nograin') === '1') R.setGrain(false);
  const renderer = R.renderer;
  const viewport = { width: innerWidth, height: innerHeight };
  R.setSize(viewport.width, viewport.height);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, viewport.width / viewport.height, CAMERA.defaultClip.near, CAMERA.defaultClip.far);
  const loaders = createLoaders(renderer);
  const audio = createAudio();

  const stations = content.stations.map((s, i) => ({ id: s.id, spaceId: s.space, index: i, data: s }));
  const N = stations.length;

  // ---- overlay (shows the loader immediately) ----
  let goToImpl = () => {};
  const overlay = createOverlay(content, { goTo: (i) => goToImpl(i), toggleSound: () => audio.toggle() });
  const prog = { world: 0, machine: 0 };
  const pushProg = () => overlay.setLoad(0.1 + 0.9 * (prog.world * 0.6 + prog.machine * 0.4));
  pushProg();

  const quality = { tier, mobile };
  const baseCtx = {
    THREE, renderer, camera, quality, tokens: TOKENS, content,
    loadGLB: loaders.loadGLB, loadHDR: loaders.loadHDR
  };

  async function loadWorld() {
    const mod = await import('./world/index.js');
    return mod.createSpace({ ...baseCtx, onProgress: (f) => { prog.world = f; pushProg(); } });
  }
  async function loadMachine() {
    const ctx = { ...baseCtx, onProgress: (f) => { prog.machine = f; pushProg(); } };
    try {
      const mod = await import('./machine/index.js');
      const sp = await mod.createSpace(ctx);
      if (!sp || !sp.scene || !sp.stations) throw new Error('machine space did not return a valid space');
      return sp;
    } catch (e) {
      console.warn('[engine] machine space unavailable, using the built-in stub:', e && e.message);
      return createStubMachine(ctx);
    }
  }
  const [world, machine] = await Promise.all([loadWorld(), loadMachine()]);
  const spaces = { world, machine };
  prog.world = prog.machine = 1; pushProg();

  const rail = new Rail(stations, spaces);
  const portrait = () => viewport.width / viewport.height < CAMERA.portraitAspect;
  rail.build(viewport.width / viewport.height);
  overlay.setPortrait(portrait());
  const headline = createHeadline3D(journey.stations);
  await document.fonts?.ready;

  // Warm up shaders for both spaces.
  const cam = { space: 'world', position: new THREE.Vector3(), target: new THREE.Vector3(), fov: CAMERA.fov, veil: 0 };
  for (const k of [0, 5, N - 1]) {
    rail.evaluate(k, cam);
    camera.position.copy(cam.position); camera.lookAt(cam.target); camera.updateMatrixWorld();
    try { await renderer.compileAsync(spaces[cam.space].scene, camera); } catch (e) { /* not fatal */ }
  }

  // ---- scroll state ----
  let sTarget = 0, sCur = 0;
  const vel = { v: 0 };
  let magnetArmed = false;
  let jump = null; // { k, t, phase }
  let jumpVeil = 0;

  const indexOf = (idOrIndex) => {
    if (typeof idOrIndex === 'number') return Math.max(0, Math.min(N - 1, Math.round(idOrIndex)));
    const s = String(idOrIndex).replace('#', '');
    const k = journey.stations.indexOf(s);
    if (k >= 0) return k;
    const n = parseInt(s.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(N - 1, n - 1)) : 0;
  };

  function goTo(idOrIndex, opts = {}) {
    const k = indexOf(idOrIndex);
    const pNow = rail.sToP(sCur);
    magnetArmed = false;
    if (opts.instant) {
      sTarget = sCur = rail.S[k]; vel.v = 0; jump = null; jumpVeil = 0;
      return;
    }
    if (Math.abs(k - pNow) > SCROLL.jumpVeilDistance) { jump = { k, t: 0, phase: 'in' }; return; }
    sTarget = rail.S[k];
  }
  goToImpl = goTo;
  journey.goTo = goTo;

  const input = createInput(canvas, {
    scroll(ds) { if (jump) return; sTarget = Math.max(0, Math.min(rail.total, sTarget + ds)); magnetArmed = true; },
    step(dir) {
      if (jump) return;
      const pT = rail.sToP(sTarget);
      const k = dir > 0 ? Math.floor(pT + 0.02) + 1 : Math.ceil(pT - 0.02) - 1;
      goTo(Math.max(0, Math.min(N - 1, k)));
    },
    home() { goTo(0); }, end() { goTo(N - 1); },
    blocked(e) { return overlay.isMenuOpen() && e.type === 'keydown'; },
    canDrag() {
      const p = rail.sToP(sCur); const k = Math.round(p);
      const d = rail.def(k);
      return d.pointer && Math.abs(p - k) < 0.3 ? 'x' : 'none';
    },
    drag(ev) {
      const k = Math.round(rail.sToP(sCur));
      const d = rail.def(k);
      if (d.pointer) { try { d.pointer(ev); } catch (e) { console.warn(e); } }
      if (ev.type === 'move') overlay.hintDragged(stations[k].id);
    },
    mouse(nx, ny) { mouse.tx = nx; mouse.ty = ny; }
  });
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

  // ---- initial station: ?station=s07 or #s07 ----
  const startId = params.get('station') || (location.hash ? location.hash.slice(1) : null);
  if (startId) goTo(startId, { instant: true });
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id && id !== stations[lastNearest]?.id && journey.stations.includes(id)) goTo(id);
  });

  // ---- quality ----
  let tierChangedAt = 0;
  function setQuality(t) {
    if (!QUALITY_ORDER.includes(t)) return;
    tier = t; quality.tier = t; journey.tier = t;
    R.applyTier(t);
    for (const id in spaces) spaces[id].setQuality && spaces[id].setQuality(t);
    tierChangedAt = clock.elapsed;
    frameLog.length = 0;
  }
  journey.setQuality = setQuality;
  journey.tier = tier;

  // ---- resize ----
  function onResize() {
    viewport.width = innerWidth; viewport.height = innerHeight;
    R.setSize(viewport.width, viewport.height);
    camera.aspect = viewport.width / viewport.height;
    camera.updateProjectionMatrix();
    rail.build(camera.aspect);
    overlay.setPortrait(portrait());
    for (const id in spaces) spaces[id].resize && spaces[id].resize(viewport.width, viewport.height);
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ---- frame loop ----
  const clock = { last: performance.now(), elapsed: 0 };
  const frameLog = [];
  let lastNearest = -1;
  let activeSpace = null;
  let hashTimer = 0;
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  const labelOut = [];
  const tmpV = new THREE.Vector3();
  const dtLog = [];

  function frame() {
    const now = performance.now();
    const rawDt = (now - clock.last) / 1000;
    clock.last = now;
    const dt = Math.min(0.05, Math.max(0.0001, rawDt));
    clock.elapsed += dt;
    const time = clock.elapsed;

    // jump veil
    if (jump) {
      jump.t += dt;
      if (jump.phase === 'in') {
        jumpVeil = Math.min(1, jump.t / 0.35);
        if (jump.t >= 0.4) { sTarget = sCur = rail.S[jump.k]; vel.v = 0; jump.phase = 'out'; jump.t = 0; }
      } else {
        jumpVeil = Math.max(0, 1 - jump.t / 0.55);
        if (jump.t >= 0.55) { jump = null; jumpVeil = 0; }
      }
    }
    // soft magnet
    if (SCROLL.magnet && !jump && magnetArmed && input.idleFor() > SCROLL.magnetDelay && !input.isDragging()) {
      const pT = rail.sToP(sTarget);
      const fl = Math.floor(pT), fr = pT - fl;
      let k;
      if (input.lastDir > 0) k = fr > SCROLL.magnetBias ? fl + 1 : fl;
      else k = (1 - fr) > SCROLL.magnetBias && fr > 1e-4 ? fl : Math.ceil(pT);
      if (fr < 1e-4) k = fl;
      sTarget = rail.S[Math.max(0, Math.min(N - 1, k))];
      magnetArmed = false;
    }
    sCur = smoothDamp(sCur, sTarget, vel, SCROLL.smoothTime, dt);
    if (Math.abs(sCur - sTarget) < 1e-5 && Math.abs(vel.v) < 1e-5) sCur = sTarget;
    const p = rail.sToP(sCur);
    journey.progress = p;

    rail.evaluate(p, cam);
    const nearest = Math.max(0, Math.min(N - 1, Math.round(p)));
    const f = p - nearest;

    // space switch
    const space = spaces[cam.space];
    if (activeSpace !== space) {
      activeSpace = space;
      const clip = space.camera || CAMERA.defaultClip;
      camera.near = clip.near ?? CAMERA.defaultClip.near; camera.far = clip.far ?? CAMERA.defaultClip.far;
      camera.updateProjectionMatrix();
      audio.setSpace(space.id);
      document.body.dataset.space = space.id;
    }

    // station change: exit / enter, overlay, hash
    if (nearest !== lastNearest) {
      const dir = lastNearest < 0 ? 1 : Math.sign(nearest - lastNearest);
      if (lastNearest >= 0) { const d = rail.def(lastNearest); d.exit && safe(() => d.exit(dir)); }
      const d = rail.def(nearest); d.enter && safe(() => d.enter(dir));
      overlay.setStation(nearest, lastNearest < 0);
      lastNearest = nearest;
      clearTimeout(hashTimer);
      const id = stations[nearest].id;
      hashTimer = setTimeout(() => { if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id + ''); }, 400);
    }

    // camera: rail pose + idle sway + mouse parallax
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 2.5);
    mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 2.5);
    camPos.copy(cam.position); camTgt.copy(cam.target);
    const dist = camPos.distanceTo(camTgt);
    fwd.subVectors(camTgt, camPos).normalize();
    right.crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
    up.crossVectors(right, fwd).normalize();
    const veilNow = Math.max(cam.veil, jumpVeil);
    const sway = CAMERA.swayAmount * dist;
    const par = input.isDragging() ? 0 : CAMERA.parallaxAmount * dist;
    camPos.addScaledVector(right, Math.sin(time * 0.31) * sway + mouse.x * par);
    camPos.addScaledVector(up, Math.sin(time * 0.23 + 1.3) * sway * 0.7 + mouse.y * par * 0.6);
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    if (Math.abs(camera.fov - cam.fov) > 1e-3 || camera.aspect !== viewport.width / viewport.height) {
      camera.fov = cam.fov; camera.aspect = viewport.width / viewport.height; camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();

    // station updates (|f| < 1), space ambient update
    for (let k = Math.max(0, Math.floor(p) - 1); k <= Math.min(N - 1, Math.ceil(p) + 1); k++) {
      const fk = p - k;
      if (Math.abs(fk) >= 1) continue;
      const d = rail.def(k);
      if (d.update) safe(() => d.update(fk, dt, time));
    }
    safe(() => space.update && space.update(dt, time, stations[nearest].id));

    // labels
    labelOut.length = 0;
    const nd = rail.def(nearest);
    if (nd.labels && stations[nearest].spaceId === cam.space && Math.abs(f) < SCROLL.labelFade) {
      const lo = 1 - Math.abs(f) / SCROLL.labelFade;
      for (const L of nd.labels) {
        if (L.anchor && L.anchor.isObject3D) L.anchor.getWorldPosition(tmpV); else if (L.anchor) tmpV.copy(L.anchor); else continue;
        tmpV.project(camera);
        if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1) continue;
        labelOut.push({ text: L.text, tone: L.tone, x: Math.min(viewport.width - 88, Math.max(88, (tmpV.x * 0.5 + 0.5) * viewport.width)), y: (-tmpV.y * 0.5 + 0.5) * viewport.height, opacity: lo * (L.opacity ?? 1) });
      }
    }
    overlay.setLabels(labelOut);
    overlay.frame(p, f, nearest);
    headline.update(p, camera, space.scene, viewport);

    R.render(space.scene, camera, time, veilNow);

    // fps + auto quality
    if (rawDt < 0.25) {
      dtLog.push(rawDt); if (dtLog.length > 60) dtLog.shift();
      journey.fps = dtLog.length / dtLog.reduce((a, b) => a + b, 0);
      if (!forced && !document.hidden && time - tierChangedAt > AUTO_QUALITY.settleSeconds) {
        frameLog.push([time, rawDt * 1000]);
        while (frameLog.length && time - frameLog[0][0] > AUTO_QUALITY.windowSeconds) frameLog.shift();
        if (frameLog.length > 20 && time - frameLog[0][0] > AUTO_QUALITY.windowSeconds * 0.95) {
          const avg = frameLog.reduce((a, b) => a + b[1], 0) / frameLog.length;
          const i = QUALITY_ORDER.indexOf(tier);
          if (avg > AUTO_QUALITY.frameMsLimit && i < QUALITY_ORDER.length - 1) {
            console.info(`[engine] average frame ${avg.toFixed(1)} ms, stepping quality down to ${QUALITY_ORDER[i + 1]}`);
            setQuality(QUALITY_ORDER[i + 1]);
          }
        }
      }
    }
    requestAnimationFrame(frame);
  }

  function safe(fn) { try { fn(); } catch (e) { if (!safe.warned) { console.warn('[engine] space callback threw', e); safe.warned = true; } } }

  requestAnimationFrame(frame);
  journey.mode = '3d';
  // let a couple of frames render before revealing
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  overlay.hideLoader();
  readyResolve();
}

boot();
