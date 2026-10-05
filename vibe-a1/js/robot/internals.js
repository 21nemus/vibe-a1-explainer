// Electronics inside the torso, built procedurally from Vibe's bill of materials.
// The layout is illustrative (Vibe doesn't publish one); the parts are real:
//   A1 / Pro: Jetson Orin Nano Super dev kit, 2x Waveshare bus servo adapter,
//             2x 2S LiPo 3300 mAh, 2x 12V->5V buck, 9-DOF IMU, speaker + amp
//   Mini:     Raspberry Pi 5, 2x bus servo adapter, 12 V Li-ion pack, USB power bank, IMU, speaker
//
// Units: millimetres inside each part, the whole group is scaled to metres and
// lives in the torso body frame (MuJoCo axes: x = robot right, y = forward, z = up).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture } from '../core/util.js';
import { enhance } from '../core/materials.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function pcbTexture(seed, base, trace, { chips = 6, text = "" } = {}) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const r = rng(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = trace;
    ctx.lineWidth = 2;
    for (let i = 0; i < 90; i++) {
      let x = r() * w;
      let y = r() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        if (r() > 0.5) x += (r() - 0.5) * 160;
        else y += (r() - 0.5) * 160;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = 'rgba(210,190,120,0.8)';
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < chips; i++) {
      const cw = 40 + r() * 70;
      const ch = 30 + r() * 60;
      const x = r() * (w - cw);
      const y = r() * (h - ch);
      ctx.fillStyle = '#c9c4b5';
      for (let p = 4; p < cw - 4; p += 7) {
        ctx.fillRect(x + p, y - 4, 3, 5);
        ctx.fillRect(x + p, y + ch - 1, 3, 5);
      }
      ctx.fillStyle = '#16171b';
      ctx.fillRect(x, y, cw, ch);
    }
    if (text) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '600 22px "JetBrains Mono", monospace';
      ctx.fillText(text, 16, h - 18);
    }
  });
}

function labelTexture(lines, bg, fg) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = '700 64px Outfit, sans-serif';
    ctx.fillText(lines[0], 28, 100);
    ctx.font = '500 34px "JetBrains Mono", monospace';
    lines.slice(1).forEach((l, i) => ctx.fillText(l, 30, 160 + i * 44));
  });
}

/** Shared materials for one internals set (all clipped by the print plane). */
function internalsMaterials(planes) {
  const std = (o, cap = 0x8a7a66) => enhance(new THREE.MeshStandardMaterial(o), { cap, capIntensity: 0.6, planes });
  return {
    metal: std({ color: 0xb9bec7, roughness: 0.32, metalness: 0.95 }),
    darkMetal: std({ color: 0x1d2026, roughness: 0.55, metalness: 0.6 }),
    black: std({ color: 0x111215, roughness: 0.55, metalness: 0.1 }),
    plasticWhite: std({ color: 0xe9e6de, roughness: 0.6 }),
    copper: std({ color: 0xc27a45, roughness: 0.35, metalness: 1 }),
    gold: std({ color: 0xd4b263, roughness: 0.3, metalness: 1 }),
    red: std({ color: 0xb3262a, roughness: 0.5 }),
    yellow: std({ color: 0xe0b52a, roughness: 0.5 }),
    ledGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3cff9a).multiplyScalar(3) }),
    ledBlue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4fb8ff).multiplyScalar(3) }),
    ledRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4040).multiplyScalar(3) }),
    planes,
    std,
  };
}

const box = (w, d, h, mat, r = 0) => {
  const g = r > 0 ? new RoundedBoxGeometry(w, d, h, 2, r) : new THREE.BoxGeometry(w, d, h);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};
const at = (obj, x, y, z) => {
  obj.position.set(x, y, z);
  return obj;
};

/* ------------------------------------------------------------------ parts */

// Board-like parts are authored lying flat: x = width, y = depth, z = up (thickness).

function makeJetson(M) {
  const g = new THREE.Group();
  g.name = 'Jetson Orin Nano Super';
  const carrier = box(103, 90.5, 1.6, M.std({ map: pcbTexture(1, '#141821', '#25324a', { chips: 9, text: 'P3768' }), roughness: 0.45, metalness: 0.2 }));
  g.add(at(carrier, 0, 0, 0.8));
  const som = box(69.6, 45, 1.2, M.std({ map: pcbTexture(2, '#15301f', '#2e5a3a', { chips: 5 }), roughness: 0.4 }));
  g.add(at(som, 4, 8, 6));
  // heatsink: base + fins
  const hsMat = M.darkMetal;
  g.add(at(box(64, 52, 4, hsMat), 4, 8, 9));
  const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 52, 14), hsMat, 22);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 22; i++) fins.setMatrixAt(i, mtx.makeTranslation(4 - 30 + i * 2.85, 8, 18));
  fins.castShadow = true;
  g.add(fins);
  // fan
  const fanFrame = box(42, 42, 9, M.black, 3);
  g.add(at(fanFrame, 4, 8, 29.5));
  const blades = new THREE.Group();
  const bladeGeo = new THREE.BoxGeometry(17, 7, 1.2);
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(bladeGeo, M.black);
    b.position.set(9.5 * Math.cos((i / 7) * Math.PI * 2), 9.5 * Math.sin((i / 7) * Math.PI * 2), 0);
    b.rotation.set(0.35, 0, (i / 7) * Math.PI * 2);
    blades.add(b);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 3, 24), M.std({ map: labelTexture(['NVIDIA'], '#76b900', '#0a0a0a'), roughness: 0.5 }));
  hub.rotation.x = Math.PI / 2;
  blades.add(hub);
  blades.position.set(4, 8, 34.5);
  g.add(blades);
  g.userData.fan = blades;
  // ports along the back edge (y = -45)
  for (let i = 0; i < 2; i++) g.add(at(box(14, 17, 15, M.metal), -38 + i * 17, -36, 9));
  g.add(at(box(16, 21, 13, M.metal), -2, -35, 8)); // RJ45
  g.add(at(box(9, 9, 11, M.black), 16, -38, 7)); // DC jack
  g.add(at(box(17, 10, 6, M.black), 33, -38, 4.5)); // DisplayPort
  // M.2 Wi-Fi card (AC8265)
  g.add(at(box(22, 30, 1.5, M.std({ map: pcbTexture(3, '#0d2f1c', '#1c5a33', { chips: 2 }), roughness: 0.4 })), -38, 22, 4));
  const led = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 1), M.ledGreen);
  g.add(at(led, 46, 40, 2));
  g.userData.leds = [led];
  g.userData.size = new THREE.Vector3(103, 90.5, 40);
  return g;
}

function makePi5(M) {
  const g = new THREE.Group();
  g.name = 'Raspberry Pi 5';
  g.add(at(box(85, 56, 1.4, M.std({ map: pcbTexture(5, '#1f6b3a', '#2f8a4f', { chips: 6, text: 'Raspberry Pi 5' }), roughness: 0.45 })), 0, 0, 0.7));
  g.add(at(box(17, 21, 14, M.metal), 34, -16, 8)); // ethernet
  for (let i = 0; i < 2; i++) g.add(at(box(17, 13, 15, M.metal), 34, 3 + i * 16, 8.5)); // USB
  // active cooler
  g.add(at(box(36, 36, 6, M.darkMetal), -10, 4, 5));
  const blades = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 1), M.black);
    b.position.set(7 * Math.cos((i / 7) * Math.PI * 2), 7 * Math.sin((i / 7) * Math.PI * 2), 0);
    b.rotation.set(0.35, 0, (i / 7) * Math.PI * 2);
    blades.add(b);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 2, 20), M.black);
  hub.rotation.x = Math.PI / 2;
  blades.add(hub);
  blades.position.set(-10, 4, 9);
  g.add(blades);
  g.userData.fan = blades;
  const led = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 1), M.ledGreen);
  g.add(at(led, -40, -24, 2));
  g.userData.leds = [led];
  g.userData.size = new THREE.Vector3(85, 56, 16);
  return g;
}

function makeBusAdapter(M, seed) {
  const g = new THREE.Group();
  g.name = 'Bus servo adapter';
  g.add(at(box(42, 33, 1.6, M.std({ map: pcbTexture(seed, '#13161c', '#2b3446', { chips: 2, text: 'BUS SERVO' }), roughness: 0.45 })), 0, 0, 0.8));
  g.add(at(box(9, 7.5, 3.2, M.metal), -16, 0, 3.2)); // USB-C
  g.add(at(box(9, 11, 11, M.black), 14, -9, 6)); // DC jack
  for (let i = 0; i < 2; i++) g.add(at(box(8, 5, 6, M.plasticWhite), 12 + i * 0, 6 + i * 7, 4.6)); // 5264 headers
  g.add(at(box(6, 6, 1.6, M.black), -3, 4, 2.4)); // MCU
  const led = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.8), M.ledBlue);
  g.add(at(led, -6, -12, 2));
  g.userData.leds = [led];
  g.userData.port = new THREE.Vector3(14, 9.5, 7); // servo bus header
  g.userData.usb = new THREE.Vector3(-20, 0, 3.2);
  return g;
}

function makeLipo(M, w, d, h, label) {
  const g = new THREE.Group();
  g.name = 'LiPo pack';
  const tex = labelTexture(label, '#1b1f2a', '#ffcf5a');
  const body = box(w, d, h, M.std({ map: tex, roughness: 0.42, metalness: 0.1 }), 3);
  g.add(at(body, 0, 0, h / 2));
  // leads + XT30 connector
  const lead = (mat, dy) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 16, 8), mat);
    c.rotation.z = Math.PI / 2;
    return at(c, w / 2 + 8, dy, h * 0.6);
  };
  g.add(lead(M.red, -2), lead(M.black, 2));
  g.add(at(box(9, 9, 6, M.yellow, 1), w / 2 + 19, 0, h * 0.6));
  g.userData.terminal = new THREE.Vector3(w / 2 + 23, 0, h * 0.6);
  return g;
}

function makeBuck(M, seed) {
  const g = new THREE.Group();
  g.name = '12V-5V buck';
  g.add(at(box(22, 17, 1.4, M.std({ map: pcbTexture(seed, '#1b5c34', '#2f8a4f', { chips: 1 }), roughness: 0.45 })), 0, 0, 0.7));
  const ind = new THREE.Mesh(new RoundedBoxGeometry(8, 8, 5, 2, 1), M.darkMetal);
  g.add(at(ind, -4, 0, 4));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 7, 16), M.metal);
  cap.rotation.x = Math.PI / 2;
  g.add(at(cap, 6, 3, 4.9));
  return g;
}

function makeIMU(M) {
  const g = new THREE.Group();
  g.name = '9-DOF IMU';
  g.add(at(box(20, 27, 1.4, M.std({ map: pcbTexture(9, '#3c2a6b', '#5a46a0', { chips: 1, text: 'IMU' }), roughness: 0.45 })), 0, 0, 0.7));
  g.add(at(box(5, 5, 1.2, M.black), 0, 2, 2)); // the sensor
  for (let i = 0; i < 6; i++) g.add(at(box(1.6, 1.6, 4, M.gold), -6.35 + i * 2.54, -11, 3));
  return g;
}

function makeSpeaker(M, d = 40) {
  const g = new THREE.Group();
  g.name = 'Speaker';
  const frame = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, 2, 40), M.darkMetal);
  frame.rotation.x = Math.PI / 2;
  g.add(at(frame, 0, 0, 1));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(d / 2 - 2, 7, 40, 1, true), M.std({ color: 0x1a1a1c, roughness: 0.85, side: THREE.DoubleSide }));
  cone.rotation.x = -Math.PI / 2;
  g.add(at(cone, 0, 0, 5));
  const magnet = new THREE.Mesh(new THREE.CylinderGeometry(d / 4, d / 4, 8, 32), M.metal);
  magnet.rotation.x = Math.PI / 2;
  g.add(at(magnet, 0, 0, -4));
  return g;
}

function makePowerBank(M) {
  const g = new THREE.Group();
  g.name = 'Power bank';
  g.add(at(box(92, 62, 15, M.std({ map: labelTexture(['5V 3A', 'USB-C PD'], '#e7e4dc', '#2a2d33'), roughness: 0.5 }), 4), 0, 0, 7.5));
  return g;
}

/** Small USB webcam for the A1 / Mini head (the Pro carries the RealSense D435i instead). */
export function makeWebcam(planes) {
  const M = internalsMaterials(planes);
  const g = new THREE.Group();
  g.name = 'USB web camera';
  g.add(at(box(30, 14, 20, M.black, 3), 0, 0, 0));
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3, 32), M.std({ color: 0x0b0d12, roughness: 0.05, metalness: 0.6 }));
  lens.rotation.x = Math.PI / 2;
  g.add(at(lens, 0, 7.6, 1));
  const glass = new THREE.Mesh(new THREE.CircleGeometry(3.6, 32), new THREE.MeshPhysicalMaterial({ color: 0x223355, roughness: 0, metalness: 0.2, clearcoat: 1 }));
  g.add(at(glass, 0, 9.2, 1));
  glass.rotation.x = -Math.PI / 2;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), M.ledRed);
  g.add(at(led, 10, 7.2, 5));
  g.scale.setScalar(0.001);
  return g;
}

/* ------------------------------------------------------------------ assembly */

/**
 * Build the internals for a variant. Returns a group in the torso frame (metres)
 * plus named anchors used by the wiring.
 */
export function buildInternals(variant, planes) {
  const M = internalsMaterials(planes);
  const g = new THREE.Group();
  g.name = 'internals';
  g.scale.setScalar(0.001);
  const parts = [];
  const add = (obj, pos, rot = [0, 0, 0], info = {}) => {
    obj.position.set(...pos);
    obj.rotation.set(...rot);
    g.add(obj);
    obj.userData.info = info;
    obj.traverse((o) => {
      if (o.isMesh) o.userData = { kind: 'internal', part: obj, info };
    });
    parts.push(obj);
    return obj;
  };

  // Torso cavity (model frame, mm): x [-82, 82], y [-15, 109], z [-2, 134]
  const anchors = {};
  if (variant === 'mini') {
    const pi = add(makePi5(M), [0, -6, 44], [-Math.PI / 2, 0, 0], { name: 'Raspberry Pi 5', note: '4 GB · quad Cortex-A76 · 2.4 GHz', key: 'compute' });
    anchors.compute = pi;
    const pack = add(makeLipo(M, 98, 38, 22, ['12V Li-ion', 'servo bus']), [14, 66, 1], [0, 0, Math.PI], { name: 'Li-ion battery', note: '12 V · powers the servo bus', key: 'battery' });
    anchors.batteries = [pack];
    const bank = add(makePowerBank(M), [0, 36, 23], [0, 0, 0], { name: 'Power bank', note: '5 V for the Pi', key: 'bank' });
    anchors.bank = bank;
  } else {
    const jet = add(makeJetson(M), [0, -12, 50], [-Math.PI / 2, 0, 0], { name: 'Jetson Orin Nano Super', note: '8 GB · 67 TOPS · 6-core A78AE', key: 'compute' });
    anchors.compute = jet;
    const b1 = add(makeLipo(M, 118, 36, 22, ['2S LiPo', '7.4V 3300mAh']), [12, 44, 1], [0, 0, Math.PI], { name: 'LiPo pack', note: '2S · 7.4 V · 3300 mAh', key: 'battery' });
    const b2 = add(makeLipo(M, 118, 36, 22, ['2S LiPo', '7.4V 3300mAh']), [12, 84, 1], [0, 0, Math.PI], { name: 'LiPo pack', note: '2S · 7.4 V · 3300 mAh', key: 'battery' });
    anchors.batteries = [b1, b2];
    add(makeBuck(M, 21), [-58, 28, 30], [0, 0, 0], { name: '12V→5V buck', note: '3 A', key: 'buck' });
    add(makeBuck(M, 22), [58, 28, 30], [0, 0, Math.PI], { name: '12V→5V buck', note: '3 A', key: 'buck' });
  }
  // Bus servo adapters on the side walls (upper body on the robot's right, legs on the left)
  const upper = add(makeBusAdapter(M, 31), [76, 66, 42], [0, -Math.PI / 2, 0], { name: 'Bus adapter · upper body', note: 'USB → 1 Mbps TTL bus', key: 'adapter' });
  const lower = add(makeBusAdapter(M, 32), [-76, 66, 42], [0, Math.PI / 2, 0], { name: 'Bus adapter · legs', note: 'USB → 1 Mbps TTL bus', key: 'adapter' });
  anchors.adapters = { upper, lower };
  add(makeIMU(M), [0, 30, 0.5], [0, 0, 0], { name: '9-DOF IMU', note: 'body orientation', key: 'imu' });
  const spk = add(makeSpeaker(M, 28), [-52, 100, 40], [-Math.PI / 2, 0, 0], { name: 'Speaker', note: variant === 'mini' ? '8 Ω · 5 W' : '8 Ω · 5 W + amp', key: 'speaker' });
  anchors.speaker = spk;

  const fans = parts.map((p) => p.userData.fan).filter(Boolean);
  const leds = parts.flatMap((p) => p.userData.leds ?? []);
  return { group: g, parts, anchors, fans, leds, materials: M };
}
