// Asset loaders handed to the spaces through ctx (PLAN 4.2).
// loadGLB / loadHDR resolve null when a file is missing, so spaces can fall back to placeholders.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export function createLoaders(renderer) {
  const gltf = new GLTFLoader();
  gltf.setMeshoptDecoder(MeshoptDecoder);
  const hdr = new HDRLoader();
  hdr.setDataType(THREE.HalfFloatType);
  let pmrem = null;
  const glbCache = new Map();
  const hdrCache = new Map();

  // A HEAD-free existence check: fetch once; a 404 resolves null without a console error from the loader.
  async function exists(url) {
    try {
      const r = await fetch(url, { method: 'GET', cache: 'force-cache' });
      if (!r.ok) return null;
      return await r.arrayBuffer();
    } catch (e) { return null; }
  }

  function loadGLB(url) {
    if (glbCache.has(url)) return glbCache.get(url);
    const p = (async () => {
      const buf = await exists(url);
      if (!buf) return null;
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      try {
        return await new Promise((res, rej) => gltf.parse(buf, base, res, rej));
      } catch (e) {
        console.warn('[loaders] could not parse', url, e);
        return null;
      }
    })();
    glbCache.set(url, p);
    return p;
  }

  function loadHDR(url) {
    if (hdrCache.has(url)) return hdrCache.get(url);
    const p = (async () => {
      const buf = await exists(url);
      if (!buf) return null;
      try {
        const data = hdr.parse(buf);
        const tex = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, data.type);
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false; tex.flipY = true;
        tex.needsUpdate = true;
        if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
        const env = pmrem.fromEquirectangular(tex).texture;
        tex.dispose();
        return env;
      } catch (e) {
        console.warn('[loaders] could not parse', url, e);
        return null;
      }
    })();
    hdrCache.set(url, p);
    return p;
  }

  // Build a PMREM environment from a small scene (procedural fallback for a missing HDR).
  function envFromScene(scene, sigma = 0.04) {
    if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
    return pmrem.fromScene(scene, sigma).texture;
  }

  return { loadGLB, loadHDR, envFromScene };
}
