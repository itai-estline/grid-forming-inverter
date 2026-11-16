// Rotatable 3D part viewer for <figure class="part-viewer"> (PLAN 7.2).
//
// Attributes on the figure
//   data-model     glb file (GLTFLoader + MeshoptDecoder)
//   data-nodes     comma-separated node names to keep (missing = whole model)
//   data-ghost     comma-separated node names drawn semi-transparent
//   data-poster    still image shown at once, and kept if 3D cannot run
//   data-tier      "B" or "C" shows the tier badge
//   data-callouts  JSON list of { node, text }
//   data-view      optional "azimuth,elevation" in degrees for the first view (default "35,22")
//   data-alt       optional alt text for the poster (default: the caption text)
//
// This file is small on purpose: it shows the posters straight away and only
// imports three.js when a viewer scrolls into view and WebGL is available.
// Rendering is on demand: a frame is drawn only while the part is turning,
// being dragged, or settling, and only while the figure is on screen.

import { TIER_TEXT } from './nav.js';
import { applyUnitFixes } from '../core/unit-fix.js';

const MAX_LIVE = 6;            // WebGL contexts kept alive at once (browsers cap them)
const ENV_URL = new URL('../../assets/env/studio_1k.hdr', import.meta.url).href;

const states = new Map();      // figure -> state
const models = new Map();      // url -> Promise<gltf>
let threePromise = null;
let envPromise = null;
let glSupport = null;
let reduced = null;            // MediaQueryList
let io = null;

/* ---------- small helpers ---------- */

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function webglAvailable() {
  if (glSupport !== null) return glSupport;
  try {
    const c = document.createElement('canvas');
    const gl = window.WebGL2RenderingContext && c.getContext('webgl2');
    glSupport = !!gl;
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  } catch (err) {
    glSupport = false;
  }
  return glSupport;
}

function loadThree() {
  if (!threePromise) {
    threePromise = Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/environments/RoomEnvironment.js')
    ]).then(([THREE, gltf, meshopt, orbit, room]) => ({
      THREE,
      GLTFLoader: gltf.GLTFLoader,
      MeshoptDecoder: meshopt.MeshoptDecoder,
      OrbitControls: orbit.OrbitControls,
      RoomEnvironment: room.RoomEnvironment
    }));
  }
  return threePromise;
}

function loadModel(T, url) {
  if (!models.has(url)) {
    const loader = new T.GLTFLoader();
    loader.setMeshoptDecoder(T.MeshoptDecoder);
    // unit.glb gaps fixed at load time (js/core/unit-fix.js)
    models.set(url, loader.loadAsync(url).then((g) => { applyUnitFixes(T.THREE, g.scene); return g; }));
  }
  return models.get(url);
}

// The studio HDR as an equirectangular texture, or null if the file is missing.
function loadEnv(T) {
  if (!envPromise) {
    envPromise = (async () => {
      let Loader = null;
      try {
        Loader = (await import('three/addons/loaders/HDRLoader.js')).HDRLoader;
      } catch (e1) {
        try { Loader = (await import('three/addons/loaders/RGBELoader.js')).RGBELoader; } catch (e2) { return null; }
      }
      try {
        const tex = await new Loader().loadAsync(ENV_URL);
        tex.mapping = T.THREE.EquirectangularReflectionMapping;
        return tex;
      } catch (err) {
        return null;
      }
    })();
  }
  return envPromise;
}

function parseCallouts(fig) {
  if (!fig.dataset.callouts) return [];
  try {
    const list = JSON.parse(fig.dataset.callouts);
    if (!Array.isArray(list)) return [];
    return list
      .filter(c => c && c.text != null)
      .map(c => ({ node: c.node != null ? String(c.node).trim() : '', text: String(c.text) }));
  } catch (err) {
    console.warn('[part-viewer] data-callouts is not valid JSON', fig);
    return [];
  }
}

/* ---------- DOM that exists with or without 3D ---------- */

function setup(fig) {
  if (states.has(fig)) return states.get(fig);
  const caption = fig.querySelector('figcaption');
  const captionText = caption ? caption.textContent.trim().replace(/\s+/g, ' ') : '';
  const names = (fig.dataset.nodes || '').split(',').map(s => s.trim()).filter(Boolean);
  const view = (fig.dataset.view || '').split(',').map(Number);

  const st = {
    fig,
    modelUrl: fig.dataset.model || '',
    names,
    callouts: parseCallouts(fig),
    azimuth: isFinite(view[0]) ? view[0] : 35,
    elevation: isFinite(view[1]) ? view[1] : 22,
    posterOk: !!fig.dataset.poster,
    visible: false, lastSeen: 0,
    live: false, loading: false, failed: false, tries: 0, disposed: false,
    touched: false, savedCamera: null,
    raf: 0, activeUntil: 0, lastOcclusion: 0,
    marks: []
  };

  const stage = h('div', 'pv-stage');
  st.stage = stage;

  if (st.posterOk) {
    const img = h('img', 'pv-poster');
    img.alt = fig.dataset.alt || (captionText ? 'Render: ' + captionText : 'Render of the part');
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', () => {
      st.posterOk = false;
      img.remove();
      refresh(st);
    });
    img.src = fig.dataset.poster;
    stage.append(img);
    st.poster = img;
  }

  const snap = h('img', 'pv-snap');
  snap.alt = '';
  snap.hidden = true;
  snap.draggable = false;
  stage.append(snap);
  st.snap = snap;

  const empty = h('div', 'pv-empty');
  empty.innerHTML =
    '<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" focusable="false">' +
    '<path d="M24 5 41 14.500v19L24 43 7 33.500v-19z M7 14.500 24 24l17-9.500 M24 24v19" fill="none" stroke="currentColor" stroke-width="1.500" stroke-linejoin="round"/></svg>';
  empty.append(st.emptyText = h('p', null, ''));
  stage.append(empty);

  const layer = h('div', 'pv-callouts');
  layer.setAttribute('aria-hidden', 'true');
  stage.append(layer);
  st.layer = layer;

  const tier = (fig.dataset.tier || '').toUpperCase();
  if (TIER_TEXT[tier]) {
    const badge = h('span', 'pv-badge badge tier', TIER_TEXT[tier]);
    stage.append(badge);
  }

  const hint = h('span', 'pv-hint');
  stage.append(hint);
  st.hint = hint;

  const status = h('span', 'pv-status');
  status.setAttribute('role', 'status');
  stage.append(status);
  st.status = status;

  const tools = h('div', 'pv-tools');
  const mk = (label, text, fn) => {
    const b = h('button', null, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', fn);
    tools.append(b);
    return b;
  };
  mk('Zoom in', '+', () => st.api && st.api.dolly(0.82));
  mk('Zoom out', '−', () => st.api && st.api.dolly(1 / 0.82));
  mk('Reset the view', '↺', () => st.api && st.api.reset());
  stage.append(tools);

  fig.insertBefore(stage, fig.firstChild);

  if (st.callouts.length) {
    const legend = h('ol', 'pv-legend');
    st.callouts.forEach((c, i) => {
      const li = h('li');
      li.append(h('span', 'n', String(i + 1)), h('span', 't', c.text));
      li.addEventListener('pointerenter', () => hot(st, i, true));
      li.addEventListener('pointerleave', () => hot(st, i, false));
      legend.append(li);

      const mark = h('span', 'pv-mark');
      mark.hidden = true;
      mark.append(h('i'), h('b', null, String(i + 1)), h('span', 'pv-mark__text', c.text));
      mark.addEventListener('pointerenter', () => hot(st, i, true));
      mark.addEventListener('pointerleave', () => hot(st, i, false));
      mark.addEventListener('click', () => {
        const on = !mark.hasAttribute('data-open');
        st.marks.forEach(m => m.el.removeAttribute('data-open'));
        mark.toggleAttribute('data-open', on);
      });
      layer.append(mark);
      st.marks.push({ el: mark, li, anchor: null, node: null, occluded: false });
    });
    stage.after(legend);
  }

  fig.dataset.ready = 'true';
  states.set(fig, st);
  refresh(st);
  return st;
}

function hot(st, i, on) {
  const m = st.marks[i];
  if (!m) return;
  m.el.toggleAttribute('data-hot', on);
  m.li.toggleAttribute('data-hot', on);
}

// One place that decides what the stage shows.
function refresh(st) {
  const can3d = !!st.modelUrl && webglAvailable() && !st.failed;
  let state;
  if (st.live) state = 'live';
  else if (st.loading) state = 'loading';
  else if (st.posterOk || !st.snap.hidden) state = 'poster';
  else if (can3d) state = 'idle';
  else state = 'empty';
  st.stage.dataset.state = state;
  st.stage.toggleAttribute('data-has-poster', st.posterOk);
  st.fig.toggleAttribute('data-fallback', !can3d);

  st.status.textContent = state === 'loading' ? 'Loading the 3D view' : '';
  st.hint.textContent = state === 'live' ? (st.touched ? '' : 'Drag to rotate')
    : (!can3d && state === 'poster' ? 'Still image' : '');
  st.emptyText.textContent = state === 'empty' ? 'The 3D view could not be loaded.' : '';
  if (state !== 'live') st.marks.forEach(m => { m.el.hidden = true; });
}

/* ---------- 3D ---------- */

async function activate(st) {
  if (st.live || st.loading || st.failed || st.disposed) return;
  if (!st.modelUrl || !webglAvailable()) { refresh(st); return; }
  st.loading = true;
  refresh(st);
  try {
    const T = await loadThree();
    const [gltf, env] = await Promise.all([loadModel(T, st.modelUrl), loadEnv(T)]);
    if (st.disposed) return;
    build(st, T, gltf, env);
    st.live = true;
  } catch (err) {
    st.failed = true;
    console.warn('[part-viewer] 3D view not available, keeping the still image:', (err && err.message) || err);
    teardown(st, false);
  } finally {
    st.loading = false;
    refresh(st);
  }
  if (st.live) {
    st.api.invalidate(0);
    enforceLimit();
  }
}

function build(st, T, gltf, envTex) {
  const { THREE } = T;
  const stage = st.stage;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const canvas = renderer.domElement;
  canvas.className = 'pv-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label',
    '3D view of the part. Drag to rotate. With the keyboard: arrow keys rotate, plus and minus zoom, 0 resets.');

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);

  /* keep only the requested nodes (clones share geometry and materials with the cached model) */
  gltf.scene.updateMatrixWorld(true);
  const kept = new Map();
  const missing = [];
  st.names.forEach(name => {
    const src = gltf.scene.getObjectByName(name);
    if (!src) { missing.push(name); return; }
    const copy = src.clone(true);
    src.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    root.add(copy);
    kept.set(name, copy);
  });
  if (missing.length) console.warn('[part-viewer] nodes not found in ' + st.modelUrl + ': ' + missing.join(', '));
  let whole = null;
  if (!kept.size) {
    whole = gltf.scene.clone(true);
    /* whole unit: show it with the lid off so the inside is visible */
    const lid = whole.getObjectByName('enclosure_lid'); if (lid) lid.visible = false;
    const lidScrews = whole.getObjectByName('screws'); if (lidScrews) lidScrews.visible = false;
    root.add(whole);
  }

  /* data-ghost: nodes drawn semi-transparent (e.g. the enclosure walls), so the inside shows through */
  (st.fig.dataset.ghost || '').split(',').map(n => n.trim()).filter(Boolean).forEach(name => {
    const node = root.getObjectByName(name);
    if (!node) return;
    node.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const ghostMat = m => {
        const c = m.clone();
        c.transparent = true; c.opacity = 0.22; c.depthWrite = false; c.side = THREE.DoubleSide;
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(ghostMat) : ghostMat(o.material);
      o.renderOrder = 2;
      o.userData.ghost = true;
    });
  });

  /* centre it and scale it to a unit sphere, so the camera maths is the same for any part */
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('the model has no geometry to show');
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const k = 1 / Math.max(sphere.radius, 1e-9);
  root.scale.setScalar(k);
  root.position.copy(sphere.center).multiplyScalar(-k);
  root.updateMatrixWorld(true);

  let tris = 0;
  root.traverse(o => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      /* anisotropy without tangents or UVs renders as NaN noise: switch it off */
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m && m.anisotropy && !(g.attributes.tangent && g.attributes.uv)) { m.anisotropy = 0; m.needsUpdate = true; }
      }
      tris += (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3;
    }
  });

  /* light: studio HDR if it is there, otherwise a neutral room */
  let pmremTarget = null;
  /* lead: the dark studio HDR left metal parts nearly black on the dark page, so the viewer always uses the bright neutral room */
  if (envTex && false) {
    scene.environment = envTex;
    scene.environmentIntensity = 2.4;
  } else {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new T.RoomEnvironment();
    pmremTarget = pmrem.fromScene(room, 0.04);
    scene.environment = pmremTarget.texture;
    scene.environmentIntensity = 1.15;
    pmrem.dispose();
    room.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  const key = new THREE.DirectionalLight(0xfff4e6, 1.8);
  key.position.set(-2.5, 4, 3);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.5);
  rim.position.set(3, 1.5, -3.5);
  const fill = new THREE.HemisphereLight(0xdfe8ff, 0x1a2233, 0.9);
  scene.add(key, rim, fill);

  /* camera and controls */
  const fov = 30;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 50);
  const controls = new T.OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.rotateSpeed = 0.9;
  controls.zoomSpeed = 0.8;
  controls.enableZoom = false;              // the wheel scrolls the page until the viewer is clicked
  controls.autoRotateSpeed = 0.8;
  controls.autoRotate = !st.touched && !(reduced && reduced.matches);
  canvas.style.touchAction = 'pan-y';       // a vertical swipe still scrolls the page

  let fitDist = 4;
  function fit() {
    const w = Math.max(1, stage.clientWidth);
    const hgt = Math.max(1, stage.clientHeight);
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    const vHalf = THREE.MathUtils.degToRad(fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    fitDist = 1.06 / Math.sin(Math.min(vHalf, hHalf));
    controls.minDistance = fitDist * 0.45;
    controls.maxDistance = fitDist * 1.7;
    camera.near = fitDist / 60;
    camera.far = fitDist * 6;
    camera.updateProjectionMatrix();
  }
  function home() {
    const az = THREE.MathUtils.degToRad(st.azimuth);
    const elv = THREE.MathUtils.degToRad(st.elevation);
    camera.position.set(Math.sin(az) * Math.cos(elv), Math.sin(elv), Math.cos(az) * Math.cos(elv)).multiplyScalar(fitDist);
    controls.target.set(0, 0, 0);
    controls.update();
  }
  fit();
  if (st.savedCamera) {
    camera.position.fromArray(st.savedCamera);
    controls.update();
  } else {
    home();
  }

  /* callout anchors: the centre of each named node */
  const tmpBox = new THREE.Box3();
  st.marks.forEach((m, i) => {
    const name = st.callouts[i].node;
    const node = name ? (kept.get(name) || (whole && whole.getObjectByName(name)) || root.getObjectByName(name)) : null;
    m.node = node || null;
    m.anchor = node ? tmpBox.setFromObject(node).getCenter(new THREE.Vector3()) : null;
    m.occluded = false;
  });
  const anyAnchors = st.marks.some(m => m.anchor);
  const raycaster = new THREE.Raycaster();
  const v = new THREE.Vector3();
  const ndc = new THREE.Vector2();
  const canOcclude = anyAnchors && tris <= 200000;

  function isInside(obj, parent) {
    for (let o = obj; o; o = o.parent) if (o === parent) return true;
    return false;
  }

  function placeMarks(now) {
    if (!anyAnchors) return;
    const w = stage.clientWidth;
    const hgt = stage.clientHeight;
    const testOcclusion = canOcclude && now - st.lastOcclusion > 220;
    if (testOcclusion) st.lastOcclusion = now;
    st.marks.forEach(m => {
      if (!m.anchor) { m.el.hidden = true; return; }
      v.copy(m.anchor).project(camera);
      const off = v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02;
      m.el.hidden = off;
      if (off) return;
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * hgt;
      m.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      m.el.toggleAttribute('data-flip', x > w - 150);
      if (testOcclusion) {
        ndc.set(v.x, v.y);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObject(root, true).find(h => !h.object.userData.ghost);
        const dist = camera.position.distanceTo(m.anchor);
        m.occluded = !!hit && hit.distance < dist - 0.02 && !isInside(hit.object, m.node);
        m.el.toggleAttribute('data-occluded', m.occluded);
      }
    });
  }

  /* render on demand */
  let last = 0;
  function frame(now) {
    st.raf = 0;
    if (!st.live || !st.visible) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    controls.update(dt);
    renderer.render(scene, camera);
    placeMarks(now);
    if (!st.raf && (controls.autoRotate || performance.now() < st.activeUntil)) st.raf = requestAnimationFrame(frame);
    else if (!st.raf) last = 0;
  }
  function invalidate(ms) {
    st.activeUntil = Math.max(st.activeUntil, performance.now() + (ms || 0));
    if (!st.raf && st.live && st.visible) st.raf = requestAnimationFrame(frame);
  }

  function userTook() {
    if (!st.touched) {
      st.touched = true;
      st.hint.textContent = '';
    }
    controls.autoRotate = false;
  }
  function orbit(dTheta, dPhi) {
    userTook();
    const off = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += dTheta;
    sph.phi = Math.min(Math.PI - 0.12, Math.max(0.12, sph.phi + dPhi));
    camera.position.copy(controls.target).add(off.setFromSpherical(sph));
    invalidate(300);
  }
  function dolly(factor) {
    userTook();
    const off = camera.position.clone().sub(controls.target);
    off.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * factor)));
    camera.position.copy(controls.target).add(off);
    invalidate(300);
  }
  function reset() {
    home();
    invalidate(300);
  }

  controls.addEventListener('change', () => invalidate(0));
  controls.addEventListener('start', () => { userTook(); invalidate(200); });
  controls.addEventListener('end', () => invalidate(1500));

  const engage = on => { controls.enableZoom = on; stage.toggleAttribute('data-engaged', on); };
  const onDown = () => { engage(true); };
  const onLeave = e => { if (e.pointerType === 'mouse') engage(false); };
  const onBlur = () => engage(false);
  const onKey = e => {
    const step = Math.PI / 18;
    switch (e.key) {
      case 'ArrowLeft': orbit(-step, 0); break;
      case 'ArrowRight': orbit(step, 0); break;
      case 'ArrowUp': orbit(0, -step); break;
      case 'ArrowDown': orbit(0, step); break;
      case '+': case '=': dolly(0.85); break;
      case '-': case '_': dolly(1 / 0.85); break;
      case '0': case 'Home': reset(); break;
      default: return;
    }
    e.preventDefault();
  };
  const onLost = e => {
    e.preventDefault();
    // The browser took the context away (too many on the page, or a GPU reset): fall back to the still.
    st.savedCamera = camera.position.toArray();
    teardown(st, false);
    if (++st.tries > 2) st.failed = true;
    refresh(st);
  };
  canvas.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('blur', onBlur);
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('webglcontextlost', onLost);

  let ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(() => {
      if (!st.live) return;
      const before = fitDist;
      const dist = camera.position.distanceTo(controls.target);
      fit();
      // Keep the same relative zoom when the stage changes shape.
      camera.position.sub(controls.target).setLength(dist * (fitDist / before)).add(controls.target);
      invalidate(0);
    });
    ro.observe(stage);
  }

  stage.insertBefore(canvas, st.layer);

  st.three = { renderer, scene, camera, controls, canvas, root, pmremTarget, ro };
  st.api = { invalidate, dolly, reset, orbit, engage };
  st.off = () => {
    stage.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('blur', onBlur);
    canvas.removeEventListener('keydown', onKey);
    canvas.removeEventListener('webglcontextlost', onLost);
  };
}

// Free the WebGL context of one viewer. The cached model (geometry, materials) stays for the others.
function teardown(st, keepSnapshot) {
  const t = st.three;
  if (st.raf) cancelAnimationFrame(st.raf);
  st.raf = 0;
  if (!t) { st.live = false; return; }
  if (keepSnapshot && st.live) {
    try {
      t.renderer.render(t.scene, t.camera);
      st.snap.src = t.canvas.toDataURL('image/png');
      st.snap.hidden = false;
      st.savedCamera = t.camera.position.toArray();
    } catch (err) { /* keep the poster */ }
  }
  if (st.off) st.off();
  if (t.ro) t.ro.disconnect();
  t.controls.dispose();
  if (t.pmremTarget) t.pmremTarget.dispose();
  t.scene.environment = null;
  t.renderer.dispose();
  try { t.renderer.forceContextLoss(); } catch (err) { /* already gone */ }
  t.canvas.remove();
  st.stage.removeAttribute('data-engaged');
  st.three = null;
  st.api = null;
  st.off = null;
  st.live = false;
}

// Too many live contexts: put the ones that are off screen back to a still frame.
function enforceLimit() {
  const live = Array.from(states.values()).filter(s => s.live);
  if (live.length <= MAX_LIVE) return;
  live.filter(s => !s.visible)
    .sort((a, b) => a.lastSeen - b.lastSeen)
    .slice(0, live.length - MAX_LIVE)
    .forEach(s => { teardown(s, true); refresh(s); });
}

function setVisible(st, visible) {
  st.visible = visible;
  if (visible) {
    st.lastSeen = performance.now();
    if (st.live) st.api.invalidate(0);
    else activate(st);
  } else if (st.live) {
    st.api.engage(false);
  }
}

/* ---------- public ---------- */

export function initPartViewers(figures, options) {
  const opts = options || {};
  if (!reduced) {
    reduced = opts.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.addEventListener('change', () => {
      states.forEach(st => {
        if (!st.live) return;
        st.three.controls.autoRotate = !st.touched && !reduced.matches;
        st.api.invalidate(0);
      });
    });
    window.addEventListener('pagehide', e => { if (!e.persisted) disposePartViewers(); });
  }
  const list = Array.from(figures || document.querySelectorAll('figure.part-viewer'));
  const sts = list.map(setup);
  if ('IntersectionObserver' in window) {
    if (!io) {
      io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const st = states.get(entry.target);
          if (st) setVisible(st, entry.isIntersecting);
        });
      }, { rootMargin: '120px 0px' });
    }
    sts.forEach(st => io.observe(st.fig));
  } else {
    sts.forEach(st => setVisible(st, true));
  }
  return sts;
}

export function disposePartViewers() {
  states.forEach(st => {
    st.disposed = true;
    teardown(st, false);
  });
  if (io) io.disconnect();
  models.forEach(promise => {
    promise.then(gltf => {
      gltf.scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach(m => {
          for (const key in m) if (m[key] && m[key].isTexture) m[key].dispose();
          m.dispose();
        });
      });
    }).catch(() => {});
  });
  models.clear();
  if (envPromise) envPromise.then(tex => tex && tex.dispose()).catch(() => {});
  envPromise = null;
  states.clear();
}
