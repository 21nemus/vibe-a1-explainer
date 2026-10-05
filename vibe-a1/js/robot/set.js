// The robot's stage: a dark lab at night, a walk-test treadmill, and the light rig.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture } from '../core/util.js';

export const BELT = { width: 0.4, length: 1.1, top: 0.074 };

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function beltTexture() {
  return canvasTexture(
    256,
    1024,
    (ctx, w, h) => {
      ctx.fillStyle = '#121419';
      ctx.fillRect(0, 0, w, h);
      // fine transverse ribs
      for (let y = 0; y < h; y += 6) {
        ctx.fillStyle = y % 12 === 0 ? '#191c22' : '#15171c';
        ctx.fillRect(0, y, w, 2);
      }
      // marker stripes every 1/4 of the texture
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = 'rgba(160,180,210,0.10)';
        ctx.fillRect(0, i * (h / 4), w, 5);
      }
      const r = rng(7);
      for (let i = 0; i < 1400; i++) {
        ctx.fillStyle = `rgba(255,255,255,${r() * 0.035})`;
        ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
      }
    },
    { repeat: true },
  );
}

function rulerTexture(lengthCm) {
  return canvasTexture(4096, 96, (ctx, w, h) => {
    ctx.fillStyle = '#d9d4c7';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1d22';
    ctx.font = '500 30px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (let mm = 0; mm <= lengthCm * 10; mm += 5) {
      const x = 24 + (mm / (lengthCm * 10)) * (w - 48);
      const cm = mm / 10;
      const len = mm % 100 === 0 ? 44 : mm % 50 === 0 ? 30 : mm % 10 === 0 ? 20 : 10;
      ctx.fillRect(x - 1.5, 0, 3, len);
      if (mm % 100 === 0) ctx.fillText(`${cm}`, x, 82);
    }
    ctx.textAlign = 'right';
    ctx.fillText('cm', w - 30, 82);
  });
}

function skylineTexture() {
  const tex = canvasTexture(2048, 768, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#060a1c');
    g.addColorStop(0.45, '#121a3e');
    g.addColorStop(0.72, '#2c2a58');
    g.addColorStop(0.86, '#5b3f63');
    g.addColorStop(1, '#8c5a52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const r = rng(42);
    // far skyline
    const layer = (base, maxH, color, lit, count) => {
      let x = 0;
      while (x < w) {
        const bw = 30 + r() * 110;
        const bh = maxH * (0.25 + r() * 0.75);
        ctx.fillStyle = color;
        ctx.fillRect(x, base - bh, bw, bh + 4);
        for (let k = 0; k < count * (bw / 60); k++) {
          if (r() > lit) continue;
          const wx = x + 4 + r() * (bw - 10);
          const wy = base - bh + 6 + r() * (bh - 12);
          const warm = r() > 0.35;
          ctx.fillStyle = warm ? `rgba(255,${190 + r() * 50},${120 + r() * 60},${0.55 + r() * 0.45})` : `rgba(170,210,255,${0.4 + r() * 0.5})`;
          ctx.fillRect(wx, wy, 3 + r() * 3, 2 + r() * 2);
        }
        if (bh > maxH * 0.85 && r() > 0.5) {
          ctx.fillStyle = '#ff3b3b';
          ctx.fillRect(x + bw / 2, base - bh - 6, 4, 4);
        }
        x += bw + r() * 6;
      }
    };
    layer(h * 0.97, h * 0.42, '#141632', 0.5, 6);
    layer(h * 1.0, h * 0.3, '#0b0c1c', 0.35, 10);
  });
  // soften: draw blurred copy
  const src = tex.userData.canvas;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(3px)';
  ctx.drawImage(src, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function concreteTexture() {
  return canvasTexture(
    1024,
    1024,
    (ctx, w, h) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      const r = rng(3);
      for (let i = 0; i < 260; i++) {
        const x = r() * w;
        const y = r() * h;
        const rad = 30 + r() * 160;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const v = 100 + r() * 70;
        g.addColorStop(0, `rgba(${v},${v},${v},0.25)`);
        g.addColorStop(1, 'rgba(128,128,128,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      for (let i = 0; i < 9000; i++) {
        const v = 90 + r() * 90;
        ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
        ctx.fillRect(r() * w, r() * h, 1.5, 1.5);
      }
    },
    { repeat: true, srgb: false },
  );
}

function displayTexture() {
  return canvasTexture(512, 160, () => {});
}

export function buildSet(scene, quality) {
  const set = { beltOffset: 0, speed: 0 };
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.FogExp2(0x05070d, 0.11);

  /* ---------- floor ---------- */
  const rough = concreteTexture();
  rough.repeat.set(6, 6);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x0c0f18, roughness: 0.42, metalness: 0, roughnessMap: rough, envMapIntensity: 0.7 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  /* ---------- treadmill ---------- */
  const tm = new THREE.Group();
  tm.name = 'treadmill';
  scene.add(tm);
  const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x1c2029, roughness: 0.34, metalness: 0.7, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const deck = new THREE.Mesh(new RoundedBoxGeometry(BELT.width + 0.16, 0.06, BELT.length + 0.14, 4, 0.014), frameMat);
  deck.position.y = 0.032;
  deck.castShadow = deck.receiveShadow = true;
  tm.add(deck);

  const beltTex = beltTexture();
  beltTex.repeat.set(1, 2.2);
  const belt = new THREE.Mesh(
    new THREE.PlaneGeometry(BELT.width, BELT.length),
    new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.82, metalness: 0, envMapIntensity: 0.5 }),
  );
  belt.rotation.x = -Math.PI / 2;
  belt.position.y = BELT.top;
  belt.receiveShadow = true;
  tm.add(belt);

  const railGeo = new RoundedBoxGeometry(0.062, 0.024, BELT.length + 0.1, 3, 0.006);
  const rulerTex = rulerTexture(110);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, frameMat);
    rail.position.set(side * (BELT.width / 2 + 0.035), BELT.top + 0.004, 0);
    rail.castShadow = rail.receiveShadow = true;
    tm.add(rail);
    // LED strip on the outer face
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, 0.004, BELT.length + 0.06),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4fd8ff).multiplyScalar(2.2), toneMapped: true }),
    );
    led.position.set(side * (BELT.width / 2 + 0.067), BELT.top - 0.012, 0);
    tm.add(led);
    (set.leds ??= []).push(led);
  }
  // ruler on top of the camera-side (+x) rail
  const ruler = new THREE.Mesh(
    new THREE.PlaneGeometry(BELT.length + 0.06, 0.03),
    new THREE.MeshStandardMaterial({ map: rulerTex, roughness: 0.6, metalness: 0 }),
  );
  ruler.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  ruler.position.set(BELT.width / 2 + 0.035, BELT.top + 0.0165, 0);
  tm.add(ruler);

  // end rollers
  const rollers = [];
  for (const end of [-1, 1]) {
    const roller = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, BELT.width + 0.01, 32),
      new THREE.MeshStandardMaterial({ color: 0x0f1115, roughness: 0.6, metalness: 0.4 }),
    );
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, BELT.top - 0.026, end * (BELT.length / 2));
    tm.add(roller);
    rollers.push(roller);
  }

  // console with a live readout
  const consoleGroup = new THREE.Group();
  consoleGroup.position.set(0, 0, BELT.length / 2 + 0.11);
  tm.add(consoleGroup);
  const pod = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.09, 0.07, 3, 0.012), frameMat);
  pod.position.y = 0.05;
  pod.rotation.x = -0.35;
  pod.castShadow = true;
  consoleGroup.add(pod);
  const dispTex = displayTexture();
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.066),
    new THREE.MeshBasicMaterial({ map: dispTex, color: new THREE.Color(1.6, 1.6, 1.6) }),
  );
  screen.position.set(0, 0, 0.0352);
  pod.add(screen);
  let lastText = '';
  const drawDisplay = (speed, dist) => {
    const text = `${speed.toFixed(2)}|${dist.toFixed(2)}`;
    if (text === lastText) return;
    lastText = text;
    const ctx = dispTex.userData.ctx;
    const { width: w, height: h } = dispTex.userData.canvas;
    ctx.fillStyle = '#04080c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(79,216,255,0.55)';
    ctx.font = '500 20px "JetBrains Mono", monospace';
    ctx.fillText('WALK TEST', 22, 34);
    ctx.textAlign = 'right';
    ctx.fillText('DIST', w - 22, 34);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7fe6ff';
    ctx.font = '500 64px "JetBrains Mono", monospace';
    ctx.fillText(speed.toFixed(2), 20, 112);
    ctx.font = '500 22px "JetBrains Mono", monospace';
    ctx.fillText('m/s', 200, 112);
    ctx.textAlign = 'right';
    ctx.font = '500 40px "JetBrains Mono", monospace';
    ctx.fillText(`${dist.toFixed(1)} m`, w - 20, 112);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(79,216,255,0.18)';
    ctx.fillRect(22, 130, w - 44, 6);
    ctx.fillStyle = '#7fe6ff';
    ctx.fillRect(22, 130, (w - 44) * Math.min(1, speed / 0.15), 6);
    dispTex.needsUpdate = true;
  };
  drawDisplay(0, 0);

  /* ---------- background ---------- */
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.9 });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(24, 8), wallMat);
  backWall.position.set(0, 4, -5.2);
  scene.add(backWall);
  const sky = skylineTexture();
  const winMat = new THREE.MeshBasicMaterial({ map: sky, color: new THREE.Color(0.85, 0.85, 0.95), fog: false });
  const windows = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 3.6), winMat);
  windows.position.set(-0.2, 2.25, -5.15);
  scene.add(windows);
  const mullionMat = new THREE.MeshStandardMaterial({ color: 0x07090f, roughness: 0.6, metalness: 0.4 });
  for (let i = -3; i <= 3; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.7, 0.1), mullionMat);
    m.position.set(-0.2 + i * 1.75, 2.25, -5.1);
    scene.add(m);
  }
  for (const y of [0.45, 1.65, 4.05]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.08, 0.1), mullionMat);
    m.position.set(-0.2, y, -5.1);
    scene.add(m);
  }

  // shelving on the left with status LEDs
  const shelf = new THREE.Group();
  shelf.position.set(-3.3, 0, -1.7);
  shelf.rotation.y = 0.9;
  scene.add(shelf);
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x151924, roughness: 0.7, metalness: 0.3 });
  const r = rng(11);
  for (let lvl = 0; lvl < 5; lvl++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.45), shelfMat);
    board.position.y = 0.2 + lvl * 0.42;
    shelf.add(board);
    for (let k = 0; k < 4; k++) {
      if (r() < 0.3) continue;
      const bw = 0.18 + r() * 0.2;
      const bh = 0.12 + r() * 0.2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.32), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.6, 0.15, 0.08 + r() * 0.06), roughness: 0.8 }));
      box.position.set(-0.6 + k * 0.36 + bw / 2, board.position.y + 0.015 + bh / 2, 0);
      shelf.add(box);
      if (r() > 0.4) {
        const led = new THREE.Mesh(
          new THREE.SphereGeometry(0.008, 8, 8),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(r() > 0.5 ? 0x3cff9a : 0x4fd8ff).multiplyScalar(4) }),
        );
        led.position.set(box.position.x + bw / 2 - 0.03, box.position.y + bh / 2 - 0.03, 0.17);
        shelf.add(led);
      }
    }
  }
  for (const x of [-0.7, 0.7]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.2, 0.45), shelfMat);
    post.position.set(x, 1.1, 0);
    shelf.add(post);
  }

  // a 3D printer on a side table, glowing warm: every white part is printed
  const printer = new THREE.Group();
  printer.position.set(-0.7, 0, -3.3);
  printer.rotation.y = 0.45;
  scene.add(printer);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.6), shelfMat);
  table.position.y = 0.72;
  printer.add(table);
  for (const [x, z] of [[-0.46, -0.26], [0.46, -0.26], [-0.46, 0.26], [0.46, 0.26]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 0.04), shelfMat);
    leg.position.set(x, 0.36, z);
    printer.add(leg);
  }
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.46, 0.42, 3, 0.02), new THREE.MeshStandardMaterial({ color: 0x12151d, roughness: 0.5, metalness: 0.3 }));
  body.position.y = 0.74 + 0.23;
  printer.add(body);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.36), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb36b).multiplyScalar(1.6) }));
  glow.position.set(0, 0.74 + 0.23, 0.2115);
  printer.add(glow);
  const part = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.07, 0.08, 2, 0.01), new THREE.MeshStandardMaterial({ color: 0xf2f0eb, roughness: 0.5 }));
  part.position.set(0, 0.79, 0.215);
  printer.add(part);
  const warm = new THREE.PointLight(0xffa860, 1.2, 2.2, 2);
  warm.position.set(0, 0.95, 0.4);
  printer.add(warm);

  /* ---------- lights ---------- */
  const key = new THREE.DirectionalLight(0xfff1e2, 1.65);
  key.position.set(1.3, 2.6, 1.9);
  key.target.position.set(0, 0.28, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  const sc = key.shadow.camera;
  sc.left = -0.75;
  sc.right = 0.75;
  sc.top = 0.85;
  sc.bottom = -0.6;
  sc.near = 0.5;
  sc.far = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  const hemi = new THREE.HemisphereLight(0x8aa4ff, 0x0b0d14, 0.2);
  scene.add(hemi);

  const rimA = new THREE.SpotLight(0xb69cff, 9, 7, 0.55, 1, 1.4);
  rimA.position.set(-1.3, 1.5, -1.5);
  rimA.target.position.set(0, 0.3, 0);
  scene.add(rimA, rimA.target);
  const rimB = new THREE.SpotLight(0x67d4ff, 7, 7, 0.55, 1, 1.4);
  rimB.position.set(1.5, 1.1, -1.3);
  rimB.target.position.set(0, 0.3, 0);
  scene.add(rimB, rimB.target);

  set.lights = { key, hemi, rimA, rimB };
  set.treadmill = tm;

  set.update = (dt, speed, beltOffset, distance) => {
    set.speed = speed;
    beltTex.offset.y = (-beltOffset / BELT.length) * beltTex.repeat.y;
    for (const r of rollers) r.rotation.x = -beltOffset / 0.026;
    const glowAmt = 0.9 + Math.min(1, speed / 0.15) * 1.0;
    for (const led of set.leds) led.material.color.setRGB(0.31 * glowAmt, 0.85 * glowAmt, glowAmt);
    drawDisplay(speed, distance);
  };
  return set;
}
