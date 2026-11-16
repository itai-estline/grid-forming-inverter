// Renderer + post chain (PLAN 4.3):
// RenderPass -> UnrealBloomPass (HDR threshold 1.0) -> OutputPass (ACES, sRGB) -> SMAA/FXAA -> grain + vignette + veil.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { POST, QUALITY } from './config.js';

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: POST.grain },
    uVignette: { value: POST.vignette },
    uVeil: { value: 0 },
    uVeilC: { value: new THREE.Vector3(...POST.veilCentre) },
    uVeilE: { value: new THREE.Vector3(...POST.veilEdge) },
    uAspect: { value: 1 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uVeil, uAspect;
    uniform vec3 uVeilC, uVeilE;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5; q.x *= uAspect;
      float r = length(q);
      // vignette: gentle darkening toward the corners
      c.rgb *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);
      // film grain (animated, luminance weighted so blacks stay black-ish)
      float n = hash(vUv * 1024.0 + fract(uTime * 7.13) * 91.7) - 0.5;
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += n * uGrain * (0.35 + 0.65 * (1.0 - lum)) ;
      // space-change veil: soft cyan-white glow, brighter in the centre
      vec3 veil = mix(uVeilC, uVeilE, smoothstep(0.0, 0.85, r));
      float v = clamp(uVeil, 0.0, 1.0);
      c.rgb = mix(c.rgb, veil, v * (0.85 + 0.15 * (1.0 - r)));
      gl_FragColor = vec4(c.rgb, 1.0);
    }`
};

export function createRenderer(canvas, tier) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = POST.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x05070d, 1);

  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), POST.bloom.strength, POST.bloom.radius, POST.bloom.threshold);
  // Bloom resolution scale per quality tier (half-res on medium/low).
  bloom.userData = { scale: 1 };
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(Math.max(2, Math.round(w * bloom.userData.scale)), Math.max(2, Math.round(h * bloom.userData.scale)));
  const output = new OutputPass();
  const smaa = new SMAAPass();
  const fxaa = new FXAAPass();
  const finish = new ShaderPass(FinishShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(smaa);
  composer.addPass(fxaa);
  composer.addPass(finish);

  const state = { tier, width: 1, height: 1, dpr: 1, grainOn: true };

  function applyTier(t) {
    state.tier = t;
    const q = QUALITY[t];
    renderer.shadowMap.enabled = q.shadows;
    bloom.userData.scale = q.bloomScale;
    smaa.enabled = q.aa === 'smaa';
    fxaa.enabled = q.aa === 'fxaa';
    finish.uniforms.uGrain.value = (q.grain && state.grainOn) ? POST.grain : 0;
    setSize(state.width, state.height);
  }

  function setSize(w, h) {
    state.width = w; state.height = h;
    const q = QUALITY[state.tier];
    let dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    const px = w * h * dpr * dpr;
    if (px > q.maxPixels) dpr = Math.sqrt(q.maxPixels / (w * h));
    state.dpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    finish.uniforms.uAspect.value = w / h;
  }

  function render(scene, camera, time, veil) {
    renderPass.scene = scene;
    renderPass.camera = camera;
    finish.uniforms.uTime.value = time;
    finish.uniforms.uVeil.value = veil;
    composer.render();
  }

  function setGrain(on) { state.grainOn = on; applyTier(state.tier); }

  applyTier(tier);
  return { renderer, composer, bloom, finish, state, setSize, render, applyTier, setGrain };
}

// Picks the starting tier from the device. ?quality= overrides.
export function detectTier(forced) {
  if (forced && QUALITY[forced]) return forced;
  const mobile = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  if (cores <= 4) return 'medium';
  return 'high';
}

export function isMobile() {
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
}

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}
