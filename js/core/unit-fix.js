// Runtime fix for a gap in assets/models/inverter/unit.glb (added 2026-11-15).
//
// The terminal_block node has its screws, wire openings and clamp pins, but no plastic
// housing, so those parts float about 7 mm above the power PCB. This adds a plain housing
// under them, as a child of terminal_block, so it dims, ghosts and frames with that node.
// Used by the machine space (js/machine/unit.js), the detail-page part viewers
// (js/detail/part-viewer.js) and the standalone viewer.html.

// All runtime fixes for unit.glb, in one call. Safe to call more than once.
export function applyUnitFixes(THREE, scene) {
  addTerminalHousing(THREE, scene);
  fixFanHubText(THREE, scene);
}

// The "80 x 25 / 7 BLADE" lettering on the outer face of the fan hub (fan_rotor_3) was
// modelled mirrored, so it reads backwards from outside the box, which is where it is seen.
// Mirror the lettering left to right (world z) about its own centre.
export function fixFanHubText(THREE, scene) {
  const text = scene && scene.getObjectByName('fan_rotor_3');
  if (!text || !text.geometry || text.userData.mirrorFixed) return false;
  scene.updateWorldMatrix(true, true);
  text.geometry.computeBoundingBox();
  const c = text.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(text.matrixWorld);
  const mirrorWorld = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)
    .multiply(new THREE.Matrix4().makeScale(1, 1, -1))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  const inv = text.matrixWorld.clone().invert();
  const local = inv.multiply(mirrorWorld).multiply(text.matrixWorld);   // M^-1 · mirror · M
  text.geometry = text.geometry.clone();
  text.geometry.applyMatrix4(local);
  text.userData.mirrorFixed = true;
  return true;
}

export function addTerminalHousing(THREE, scene) {
  if (!scene || scene.getObjectByName('terminal_block_housing')) return null;
  const tb = scene.getObjectByName('terminal_block');
  const pcb = scene.getObjectByName('power_pcb');
  if (!tb || !pcb) return null;
  scene.updateWorldMatrix(true, true);

  const screw = tb.children.find((c) => [].concat(c.material || []).some((m) => m && m.name === 'mat_screw'));
  if (!screw) return null;
  const tbBox = new THREE.Box3().setFromObject(tb);
  const pcbTop = new THREE.Box3().setFromObject(pcb).max.y;
  const top = new THREE.Box3().setFromObject(screw).min.y;   // underside of the terminal screw heads
  const h = top - pcbTop;
  if (!(h > 0)) return null;                                  // already seated: nothing to fix

  // the wire openings face +x; keep the housing just inside them so they stay visible
  const w = (tbBox.max.x - tbBox.min.x) * 0.925;
  const d = tbBox.max.z - tbBox.min.z;
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ name: 'mat_terminal_housing', color: 0x2f6b4a, roughness: 0.55, metalness: 0 })
  );
  housing.name = 'terminal_block_housing';
  housing.position.set(tbBox.min.x + w / 2, pcbTop + h / 2, (tbBox.min.z + tbBox.max.z) / 2);
  housing.castShadow = true;
  housing.receiveShadow = true;
  housing.updateMatrixWorld(true);
  tb.attach(housing);   // keeps this world placement, now in terminal_block's local frame
  return housing;
}
