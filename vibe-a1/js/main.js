import * as THREE from 'three';
import { createRenderer } from './core/renderer.js';
import { createStudioEnvironment } from './core/env.js';
import { loadRobotAssets } from './robot/model.js';
import { RobotScene } from './robot/robot-scene.js';
import { ServoScene } from './servo/servo-scene.js';
import { UI } from './ui.js';
import { isTouch } from './core/util.js';

const canvas = document.getElementById('gl');
const labelsEl = document.getElementById('labels');
const loader = document.getElementById('loader');

function fail(err) {
  console.error(err);
  loader.querySelector('.ltext').textContent = 'This explainer needs WebGL 2. Try a recent Chrome, Safari or Firefox.';
  loader.querySelector('.ring').style.display = 'none';
}

async function warmup(app, scenes) {
  // Compile every program up front (including things that start hidden) and
  // upload buffers, so the first cutaway / scene switch doesn't hitch.
  for (const s of scenes) {
    const hidden = [];
    s.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    await app.renderer.compileAsync(s.scene, s.camera);
    app.render(s.scene, s.camera, 1 / 60, 0);
    for (const o of hidden) o.visible = false;
  }
}

async function main() {
  const app = createRenderer(canvas);
  const env = createStudioEnvironment(app.renderer);
  await Promise.all([document.fonts.load('500 20px "JetBrains Mono"'), document.fonts.load('700 20px Outfit')]).catch(() => {});
  const [assets, wave] = await Promise.all([loadRobotAssets(), fetch('assets/motions/wave.json').then((r) => r.json())]);
  assets.wave = wave;
  app.assets = assets;

  const robot = new RobotScene(app, assets, labelsEl, env);
  const servo = new ServoScene(app, labelsEl, env);
  const scenes = { robot, servo };
  let active = robot;
  servo.controls.enabled = false;
  servo.labels.setActive(false);

  const fade = { v: 1, target: 0, pending: null };
  const switchScene = (name) => {
    if (scenes[name] === active || fade.pending) return;
    fade.pending = name;
    fade.target = 1;
  };
  const share = async () => {
    const data = { title: 'Inside the Vibe A1', text: 'Take apart an open-source humanoid in your browser.', url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(location.href);
        ui.toast('Link copied');
      }
    } catch {
      /* dismissed */
    }
  };
  const ui = new UI({ onScene: switchScene, onShare: share });
  ui.bind(robot);

  await warmup(app, [servo, robot]);

  /* ---------- pointer ---------- */
  let pointer = null;
  let down = null;
  let dragging = false;
  canvas.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY, type: e.pointerType };
    active.onPointerMove(e.clientX, e.clientY);
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) dragging = true;
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    active.onPointerLeave();
    ui.tooltip(null);
  });
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    dragging = false;
    ui.stopTour();
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = down && !dragging;
    down = null;
    dragging = false;
    if (!wasClick) return;
    active.onPointerMove(e.clientX, e.clientY);
    if (e.pointerType !== 'mouse') {
      const info = active.hover();
      if (info) ui.toast(`${info.title}${info.sub ? ' · ' + info.sub : ''}`);
    }
    const r = active.click();
    if (r?.goto) {
      if (r.mesh === 'sts3250') ui.toast('Leg joints use the STS3250: same 45 mm body as the STS3215, steel gears, 50 kg·cm at 12 V', 3600);
      switchScene(r.goto);
    }
  });
  addEventListener('resize', () => {
    for (const s of Object.values(scenes)) s.resize(innerWidth, innerHeight);
  });
  for (const s of Object.values(scenes)) s.resize(innerWidth, innerHeight);

  /* ---------- loop ---------- */
  const timer = new THREE.Timer(); // not connected to the page: rAF already pauses in hidden tabs and dt is clamped
  let time = 0;
  let hoverT = 0;

  /** Advance everything by dt (shared by the render loop and the automation hook). */
  function step(dt) {
    time += dt;
    // scene fade, swapping scenes at full black
    fade.v += Math.sign(fade.target - fade.v) * Math.min(Math.abs(fade.target - fade.v), dt * 3.2);
    if (fade.pending && fade.v >= 0.999) {
      const next = scenes[fade.pending];
      active.controls.enabled = false;
      active.labels.setActive(false);
      active.onPointerLeave();
      active.hover(); // clears any highlight
      active = next;
      active.controls.enabled = true;
      active.labels.setActive(true);
      ui.tooltip(null);
      ui.bind(active);
      fade.pending = null;
      fade.target = 0;
    }
    app.grade.uniforms.uFade.value = fade.v;
    ui.updateTour(dt);
    active.controls.update();
    active.update(dt, time);
  }

  app.renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 1 / 20);
    step(dt);
    hoverT += dt;
    if (pointer && pointer.type === 'mouse' && !down && hoverT > 0.05) {
      hoverT = 0;
      const info = active.hover();
      ui.tooltip(info, pointer.x, pointer.y);
      canvas.style.cursor = info ? (info.sub?.includes('click') ? 'pointer' : 'help') : '';
    }
    app.render(active.scene, active.camera, dt, time);
    ui.refresh();
  });

  loader.classList.add('done');
  if (isTouch()) ui.toast('Drag to orbit · pinch to zoom · tap parts', 3200);
  // Automation hook: step the simulation deterministically (testing, recording a video).
  window.__vibe = {
    app,
    scenes,
    ui,
    get active() {
      return active;
    },
    advance(seconds, fps = 60) {
      const dt = 1 / fps;
      for (let t = 0; t < seconds; t += dt) step(dt);
      app.render(active.scene, active.camera, dt, time);
      ui.refresh(true);
    },
  };
}

main().catch(fail);
