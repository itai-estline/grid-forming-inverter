// Built-in stand-in for the machine space, used only when js/machine/index.js is missing or throws.
// Dark interior, a few glowing placeholder boxes, simple poses for s06..s14, so the journey always runs.
export async function createStubMachine(ctx) {
  const { THREE, tokens } = ctx;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(tokens.night0);
  scene.fog = new THREE.FogExp2(tokens.night1, 0.012);
  scene.add(new THREE.HemisphereLight(0x5a6c96, 0x05070d, 0.8));
  const key = new THREE.DirectionalLight(0xbfd4ff, 1.2); key.position.set(10, 30, 20); scene.add(key);

  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2740, roughness: 0.6, metalness: 0.5 });
  const glow = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); scene.add(b); return b; };

  // Enclosure floor and a "PCB" (units: 0.1 mm * 100 -> 1 unit = 1 cm; the box is ~30 x 13 x 20).
  box(30, 0.3, 20, dark, 15, 0, -10);
  box(24, 0.16, 18, new THREE.MeshStandardMaterial({ color: 0x0d3b2a, roughness: 0.7 }), 16, 7.6, -10);
  const caps = [box(3.5, 5, 3.5, glow(tokens.dc, 2.2), 6, 10.3, -4), box(3.5, 5, 3.5, glow(tokens.dc, 2.2), 6, 10.3, -16)];
  const ipm = box(3.6, 0.6, 2.1, glow(tokens.ac, 2.5), 10, 6, -10);
  const coils = [0, 1, 2].map(i => { const m = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.8, 10, 24), glow(tokens.ac, 1.6)); m.rotation.x = Math.PI / 2; m.position.set(18 + i * 3, 9.5, -4); scene.add(m); return m; });
  const board = box(10, 0.16, 7, glow(tokens.ctl, 1.4), 19, 11.6, -5);
  const sink = box(12, 5.6, 10, new THREE.MeshStandardMaterial({ color: 0x8a94a8, roughness: 0.35, metalness: 0.9 }), 10, 3, -10);
  const unit2 = box(30, 13, 20, new THREE.MeshStandardMaterial({ color: tokens.inv2, roughness: 0.5, transparent: true, opacity: 0.25 }), 15, 6.5, -40);
  unit2.visible = false;

  const look = (obj, off) => (aspect) => {
    const t = obj.position.clone();
    const p = t.clone().add(off);
    if (aspect < 0.8) p.add(V(0, off.length() * 0.35, off.length() * 0.5));
    return { position: p, target: t.clone().add(V(aspect < 0.8 ? 0 : -2, aspect < 0.8 ? -2 : 0, 0)), fov: 40 };
  };
  const stations = {
    s06: { pose: look(caps[0], V(-12, 9, 14)) },
    s07: { pose: look(ipm, V(-8, 8, 9)) },
    s08: { pose: look(coils[1], V(-10, 10, 14)) },
    s09: { pose: look(board, V(-10, 9, 12)) },
    s10: { pose: look(board, V(-6, 12, 14)) },
    s11: { pose: look(coils[2], V(-8, 8, 12)) },
    s12: { pose: look(coils[0], V(-10, 6, 10)) },
    s13: { pose: look(sink, V(-14, 2, 14)) },
    s14: { pose: (a) => ({ position: V(-30, 40, 30 + (a < 0.8 ? 40 : 0)), target: V(12, 4, -25), fov: 40 }), enter() { unit2.visible = true; }, exit(d) { if (d < 0) unit2.visible = false; } }
  };
  ctx.onProgress && ctx.onProgress(1);
  return {
    id: 'machine', scene, stations,
    portals: { entry: { position: V(40, 8, 10), target: V(15, 6, -10) }, exit: { position: V(-60, 90, 60), target: V(15, 0, -25) } },
    update(dt, time) {
      for (const c of caps) c.material.color.setHex(tokens.dc).multiplyScalar(1.8 + 0.6 * Math.sin(time * 3));
      for (let i = 0; i < 3; i++) coils[i].rotation.z += dt * 0.5;
    }
  };
}
