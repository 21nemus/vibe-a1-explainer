import * as THREE from 'three';

export const clamp = THREE.MathUtils.clamp;
export const lerp = THREE.MathUtils.lerp;

/** Frame-rate independent exponential smoothing. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export const ease = {
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

/** Draw into a 2D canvas and wrap it as an sRGB texture. */
export function canvasTexture(width, height, draw, { repeat = false, anisotropy = 8, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.userData.canvas = c;
  tex.userData.ctx = ctx;
  return tex;
}

/** Simple timeline of tweens keyed by name, so a new tween on a key replaces the old one. */
export class Tweens {
  constructor() {
    this.items = new Map();
  }
  to(key, { from, to, duration = 1, easing = ease.inOutCubic, onUpdate, onDone, delay = 0 }) {
    this.items.set(key, { t: -delay, from, to, duration, easing, onUpdate, onDone });
  }
  has(key) {
    return this.items.has(key);
  }
  update(dt) {
    for (const [key, tw] of this.items) {
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(1, tw.t / tw.duration);
      tw.onUpdate?.(tw.easing(k), tw);
      if (k >= 1) {
        this.items.delete(key);
        tw.onDone?.();
      }
    }
  }
}

export const isTouch = () => matchMedia('(pointer: coarse)').matches;
export const isSmallScreen = () => innerWidth < 860;
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Format a number with fixed decimals and thin-space thousands separators. */
export function fmt(v, d = 0) {
  const s = Math.abs(v).toFixed(d);
  const [i, f] = s.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '−' : '') + grouped + (f ? '.' + f : '');
}
