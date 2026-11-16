// Big split headline words drawn inside the 3D scene (blocks in HEADLINES with depth > 0),
// so nearer scene objects pass in front of the letters, like the reference intro.
import * as THREE from 'three';
import { HEADLINES } from './config.js';

const WORD_LINEAR = 0.72; // scene-linear grey: stays under the bloom threshold, renders close to --ink

function wordTexture(text) {
  const fontPx = 220;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `400 ${fontPx}px "Bodoni Moda", Georgia, serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width + fontPx * 0.2);
  const h = Math.ceil(fontPx * 1.25);
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText(text, w / 2, h * 0.52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: w / h, emRatio: h / fontPx };
}

export function createHeadline3D(stationIds) {
  const groups = {};
  for (const id of Object.keys(HEADLINES)) {
    const index = stationIds.indexOf(id);
    if (index < 0) continue;
    const g = new THREE.Group();
    g.name = `headline_${id}`;
    g.renderOrder = 10;
    groups[id] = { index, group: g, words: [] };
    const h = HEADLINES[id];
    for (const mode of ['landscape', 'portrait']) {
      for (const b of h[mode]) {
        if (!b.depth) continue;
        const { tex, aspect, emRatio } = wordTexture(b.text);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, color: new THREE.Color(WORD_LINEAR, WORD_LINEAR * 0.985, WORD_LINEAR * 0.96), opacity: 0 });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        m.frustumCulled = false;
        m.renderOrder = 10;
        g.add(m);
        groups[id].words.push({ mesh: m, block: b, mode, aspect, emRatio });
      }
    }
  }

  const tmp = new THREE.Vector3();
  let parentScene = null;

  // p: rail progress; camera already placed for this frame; scene = active scene
  function update(p, camera, scene, viewport) {
    const portrait = viewport.width / viewport.height < 0.8;
    const fontPx = portrait ? Math.min(80, Math.max(44, viewport.width * 0.13)) : Math.min(140, Math.max(52, viewport.width * 0.086)); // same as .hl-word in home.css
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    let any = false;
    for (const id in groups) {
      const G = groups[id];
      const f = p - G.index;
      const a = Math.abs(f);
      const vis = Math.max(0, 1 - a / 0.45);
      G.group.visible = vis > 0.001;
      if (!G.group.visible) continue;
      any = true;
      if (G.group.parent !== scene) scene.add(G.group);
      G.group.position.copy(camera.position);
      G.group.quaternion.copy(camera.quaternion);
      for (const w of G.words) {
        const show = (w.mode === 'portrait') === portrait;
        w.mesh.visible = show;
        if (!show) continue;
        const d = w.block.depth;
        const worldPerPx = (2 * d * tanHalf) / viewport.height;
        const hgt = fontPx * w.emRatio * worldPerPx;
        w.mesh.scale.set(hgt * w.aspect, hgt, 1);
        const ndcX = w.block.x * 2 - 1, ndcY = -(w.block.y * 2 - 1);
        // drift: words slide apart slightly as you scroll away
        const drift = f * 0.12;
        tmp.set((ndcX + Math.sign(ndcX || 1) * drift * 0.6) * d * tanHalf * camera.aspect, (ndcY - f * 0.25) * d * tanHalf, -d);
        w.mesh.position.copy(tmp);
        w.mesh.material.opacity = vis * vis * (3 - 2 * vis);
      }
    }
    parentScene = any ? scene : null;
  }

  return { update };
}
