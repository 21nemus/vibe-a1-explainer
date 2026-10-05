// Renderer + post: MSAA HDR target -> bloom -> tone mapping -> grade (vignette, grain, fade).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { isTouch, isSmallScreen } from './util.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uVignette: { value: 1 },
    uGrain: { value: 0.03 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color(0x070a12) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uVignette, uGrain, uFade;
    uniform vec3 uFadeColor;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(1.15, 0.2, length(d) * uVignette);
      c.rgb *= mix(0.5, 1.0, v);
      c.rgb += (hash(vUv * 1931.0 + fract(uTime * 7.13) * 97.0) - 0.5) * uGrain;
      c.rgb = mix(c.rgb, uFadeColor, uFade);
      gl_FragColor = c;
    }`,
};

export function createRenderer(canvas) {
  const low = isTouch() || isSmallScreen() || (navigator.hardwareConcurrency ?? 8) <= 4;
  const quality = { low, maxDpr: low ? 1.5 : 2, shadowSize: low ? 1024 : 2048, msaa: low ? 2 : 4 };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: PCFSoft is folded into PCF + shadow.radius
  renderer.localClippingEnabled = true;

  let dpr = Math.min(devicePixelRatio, quality.maxDpr);
  renderer.setPixelRatio(dpr);

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.msaa });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 1.7);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  const size = new THREE.Vector2();
  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    size.set(w, h);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    grade.uniforms.uAspect.value = w / h;
  };
  addEventListener('resize', resize);
  resize();

  // Adaptive resolution: step the pixel ratio down if frames are consistently slow.
  let acc = 0;
  let frames = 0;
  const adapt = (dt) => {
    acc += dt;
    frames++;
    if (acc < 2.5) return;
    const avg = acc / frames;
    acc = 0;
    frames = 0;
    if (avg > 1 / 40 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      resize();
    }
  };

  return {
    renderer,
    composer,
    bloom,
    grade,
    quality,
    size,
    render(scene, camera, dt, time) {
      renderPass.scene = scene;
      renderPass.camera = camera;
      grade.uniforms.uTime.value = time;
      composer.render(dt);
      adapt(dt);
    },
    get dpr() {
      return dpr;
    },
  };
}
