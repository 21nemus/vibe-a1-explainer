// Scene 2: one STS3215 joint servo, cut open on a test fixture.
//
// Built procedurally at real size (45.2 x 24.7 x 35 mm, modelled in mm and
// scaled 1 mm -> 1 cm). Datasheet values: 345:1 metal gears, 19.5 kg·cm stall
// and 5 kg·cm rated torque at 7.4 V, 0.192 s/60° (~52 rpm), 2.5 A stall,
// 0.15 A no-load, 12-bit magnetic encoder, 1 Mbps half-duplex TTL bus.
// The internal arrangement is a typical standard-servo layout and the
// four-stage tooth split is illustrative (it multiplies to exactly 345:1).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LabelLayer } from '../core/labels.js';
import { enhance, parkedPlane, PARKED, highlightTwin } from '../core/materials.js';
import { canvasTexture, damp, ease, Tweens, clamp, isSmallScreen, fmt } from '../core/util.js';
import { pcbTexture } from '../robot/internals.js';
import { DynamicTube, cableMaterial, makeGlow } from '../robot/wiring.js';
import { SERVO } from '../content.js';

const MM = 0.01; // world units per mm
const SERVO_Y = 1.12; // height of the case centre
const CASE = { L: 45.2, W: 24.7, H: 35, wall: 1.6, r: 2.6 };
const SHAFT_X = -11.3;
const MOTOR_X = 11.2;
const MODULE = 0.27;
// stages: [pinion teeth, gear teeth]; 40/8 * 45/10 * 40/10 * 46/12 = 345
const STAGES = [
  [8, 40],
  [10, 45],
  [10, 40],
  [12, 46],
];
const LAYERS = [25.9, 28.0, 30.1, 32.2];
const GEAR_T = 1.5;
const G = 9.81;

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function roundedRectPath(w, h, r) {
  const p = new THREE.Path();
  const s = roundedRect(w, h, r);
  p.curves = s.curves;
  return p;
}

function gearShape(teeth, module, holeR) {
  const rp = (teeth * module) / 2;
  const ra = rp + module;
  const rr = rp - 1.25 * module;
  const s = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [rr, a - step * 0.5],
      [rr, a - step * 0.27],
      [ra, a - step * 0.12],
      [ra, a + step * 0.12],
      [rr, a + step * 0.27],
    ];
    for (const [r, t] of pts) {
      const x = r * Math.cos(t);
      const y = r * Math.sin(t);
      if (i === 0 && t === pts[0][1]) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
  }
  s.closePath();
  if (holeR) {
    const h = new THREE.Path();
    h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  return s;
}

function gearMesh(teeth, mat, thickness = GEAR_T, holeR = 0.5) {
  const g = new THREE.ExtrudeGeometry(gearShape(teeth, MODULE, holeR), { depth: thickness, bevelEnabled: false, curveSegments: 2 });
  g.translate(0, 0, -thickness / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Find axle positions so every gear stays inside the case (small grid search). */
function layoutAxles() {
  const r = STAGES.map(([p, g]) => [(p * MODULE) / 2, (g * MODULE) / 2]);
  const d = STAGES.map(([p, g]) => ((p + g) * MODULE) / 2);
  const M = new THREE.Vector2(MOTOR_X, 0);
  const O = new THREE.Vector2(SHAFT_X, 0);
  const inner = CASE.W / 2 - CASE.wall - 0.4;
  let best = null;
  for (let a1 = 100; a1 <= 260; a1 += 2)
    for (let a2 = 100; a2 <= 260; a2 += 2) {
      const A = M.clone().add(new THREE.Vector2(Math.cos((a1 * Math.PI) / 180), Math.sin((a1 * Math.PI) / 180)).multiplyScalar(d[0]));
      const B = A.clone().add(new THREE.Vector2(Math.cos((a2 * Math.PI) / 180), Math.sin((a2 * Math.PI) / 180)).multiplyScalar(d[1]));
      const BO = O.clone().sub(B);
      const dist = BO.length();
      if (dist > d[2] + d[3] || dist < Math.abs(d[2] - d[3])) continue;
      const a = (dist * dist + d[2] * d[2] - d[3] * d[3]) / (2 * dist);
      const h = Math.sqrt(Math.max(0, d[2] * d[2] - a * a));
      const P = B.clone().add(BO.clone().multiplyScalar(a / dist));
      const perp = new THREE.Vector2(-BO.y, BO.x).divideScalar(dist);
      for (const sgn of [1, -1]) {
        const C = P.clone().add(perp.clone().multiplyScalar(h * sgn));
        const over = Math.max(
          Math.abs(A.y) + r[0][1] - inner,
          Math.abs(B.y) + r[1][1] - inner,
          Math.abs(C.y) + r[2][1] - inner,
          Math.abs(O.y) + r[3][1] - inner,
          A.x + r[0][1] - (CASE.L / 2 - CASE.wall),
          -(C.x - r[2][1]) - (CASE.L / 2 - CASE.wall),
        );
        const score = over + Math.abs(A.y) * 0.02 + Math.abs(C.y) * 0.02;
        if (!best || score < best.score) best = { score, A, B, C };
      }
    }
  return { M, A: best.A, B: best.B, C: best.C, O };
}

function stickerTexture() {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#16181d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2c6ee8';
    ctx.fillRect(0, 0, w, 120);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 84px Outfit, sans-serif';
    ctx.fillText('STS3215', 40, 92);
    ctx.fillStyle = '#c7cfdd';
    ctx.font = '500 46px "JetBrains Mono", monospace';
    ctx.fillText('7.4V · 19.5 kg·cm', 40, 220);
    ctx.fillText('1:345 · 12-bit', 40, 290);
    ctx.fillText('TTL bus · 1 Mbps', 40, 360);
    ctx.fillStyle = '#5c6474';
    ctx.font = '500 34px "JetBrains Mono", monospace';
    ctx.fillText('GND  V+  SIG', 40, 460);
  });
}

function weightTexture(text) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#2a2d33';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8e4da';
    ctx.font = '700 54px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, 84);
  });
}

/** Feetech protocol packet bytes with checksum. */
function packet(id, instr, params) {
  const len = params.length + 2;
  const sum = id + len + instr + params.reduce((a, b) => a + b, 0);
  const chk = ~sum & 0xff;
  return [0xff, 0xff, id, len, instr, ...params, chk].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export class ServoScene {
  constructor(app, labelsEl, env) {
    this.app = app;
    this.name = 'servo';
    this.scene = new THREE.Scene();
    this.scene.environment = env;
    this.scene.background = canvasTexture(64, 512, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#04060c');
      g.addColorStop(0.55, '#0b0f22');
      g.addColorStop(0.8, '#161536');
      g.addColorStop(1, '#07080f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    this.scene.fog = new THREE.FogExp2(0x05070d, 0.16);
    this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.02, 60);
    this.controls = new OrbitControls(this.camera, app.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.07, minDistance: 0.6, maxDistance: 5, maxPolarAngle: 1.52, rotateSpeed: 0.7, zoomSpeed: 0.8, panSpeed: 0.6 });
    this.labels = new LabelLayer(labelsEl);
    this.tweens = new Tweens();
    this.state = { follow: 'all', scenario: 'sweep', view: 'whole', slider: 0.7 };
    this.cutPlane = parkedPlane(new THREE.Vector3(0, -1, 0));
    this.planes = [this.cutPlane];
    this.angle = 0; // output shaft angle (rad)
    this.omega = 0;
    this.current = SERVO.spec.noLoadCurrent;
    this.temp = 31;
    this.tripped = false;
    this.tripTimer = 0;
    this.explode = 0;
    this.cut = 0;
    this.time = 0;
    this.motorAngle = 0;
    this.buildStage();
    this.buildServo();
    this.buildLoad();
    this.buildFlows();
    this.buildLabels();
    this.setCamera('whole', 0);
  }

  /* ---------------------------------------------------------------- build */

  buildStage() {
    const s = this.scene;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: 0x0a0d15, roughness: 0.5 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.08, 96), new THREE.MeshPhysicalMaterial({ color: 0x151a26, roughness: 0.35, metalness: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
    ped.position.set(0.05, 0.04, -0.32);
    ped.castShadow = ped.receiveShadow = true;
    s.add(ped);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.505, 0.005, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4fd8ff).multiplyScalar(2.5) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0.05, 0.08, -0.32);
    s.add(ring);
    this.ring = ring;
    // test stand: a post with a backplate the servo bolts to
    const alu = new THREE.MeshPhysicalMaterial({ color: 0x9aa3b2, roughness: 0.32, metalness: 0.9, clearcoat: 0.2 });
    const post = new THREE.Mesh(new RoundedBoxGeometry(0.12, 1.12, 0.12, 3, 0.02), alu);
    post.position.set(0.22, 0.64, -0.36);
    post.castShadow = true;
    s.add(post);
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.36, 0.04, 3, 0.012), alu);
    plate.position.set(0.0, SERVO_Y, -0.255);
    plate.castShadow = plate.receiveShadow = true;
    s.add(plate);
    this.fixture = [post, plate];

    // background: far blurred light panels
    for (const [x, y, z, w, h, c, k] of [
      [-4, 2.2, -6, 3, 2.2, 0x2b3c78, 0.55],
      [3.5, 2.6, -6.5, 2.2, 3, 0x4a2f7a, 0.5],
      [0, 3.5, -7, 6, 0.25, 0xdfe8ff, 0.7],
      [-6.5, 1.6, -2, 0.3, 2.5, 0x4fd8ff, 0.3],
    ]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), fog: false }));
      p.position.set(x, y, z);
      p.lookAt(0, 1, 0);
      s.add(p);
    }

    const key = new THREE.DirectionalLight(0xfff1e2, 2.1);
    key.position.set(1.4, 3.2, 2.2);
    key.target.position.set(0, 1.0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(this.app.quality.shadowSize, this.app.quality.shadowSize);
    Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.0, near: 0.5, far: 8 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    s.add(key, key.target);
    s.add(new THREE.HemisphereLight(0x8aa4ff, 0x0b0d14, 0.45));
    const fill = new THREE.DirectionalLight(0xbfd0ff, 0.6);
    fill.position.set(-1.6, 1.8, 1.4);
    s.add(fill);
    const rimA = new THREE.SpotLight(0xb69cff, 14, 9, 0.6, 1, 1.4);
    rimA.position.set(-2.2, 2.0, -2.0);
    rimA.target.position.set(0, 0.8, 0);
    s.add(rimA, rimA.target);
    const rimB = new THREE.SpotLight(0x67d4ff, 10, 9, 0.6, 1, 1.4);
    rimB.position.set(2.4, 1.6, -1.8);
    rimB.target.position.set(0, 0.8, 0);
    s.add(rimB, rimB.target);
  }

  buildServo() {
    const P = this.planes;
    const caseMat = enhance(new THREE.MeshPhysicalMaterial({ color: 0x17191e, roughness: 0.42, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5 }), { cap: 0xff9d4d, capIntensity: 1.5, planes: P });
    const brass = enhance(new THREE.MeshStandardMaterial({ color: 0xd08c55, roughness: 0.3, metalness: 1 }), { cap: 0xffd0a0, planes: P });
    const steel = enhance(new THREE.MeshStandardMaterial({ color: 0xc3c7cf, roughness: 0.38, metalness: 1 }), { cap: 0xd8dde6, capIntensity: 0.9, planes: P });
    const alu = enhance(new THREE.MeshPhysicalMaterial({ color: 0xb6bcc6, roughness: 0.36, metalness: 0.95 }), { cap: 0xd8dde6, capIntensity: 0.9, planes: P });
    const black = enhance(new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.55 }), { cap: 0x555555, planes: P });
    const white = enhance(new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.55 }), { cap: 0xcccccc, planes: P });
    const copper = enhance(new THREE.MeshStandardMaterial({ color: 0xb8673a, roughness: 0.35, metalness: 1 }), { cap: 0xffb080, planes: P });
    const motorCan = enhance(new THREE.MeshStandardMaterial({ color: 0xaeb4bd, roughness: 0.34, metalness: 1 }), { cap: 0xc07040, capIntensity: 1.1, planes: P });
    const pcbMat = enhance(new THREE.MeshStandardMaterial({ map: pcbTexture(77, '#13301f', '#2c6a43', { chips: 3 }), roughness: 0.45, metalness: 0.1 }), { cap: 0x2c6a43, planes: P });
    const magN = enhance(new THREE.MeshStandardMaterial({ color: 0xc23a3a, roughness: 0.4, metalness: 0.4 }), { planes: P });
    const magS = enhance(new THREE.MeshStandardMaterial({ color: 0x3a64c2, roughness: 0.4, metalness: 0.4 }), { planes: P });
    this.mats = { caseMat, brass, steel, alu, black, white, copper, motorCan, pcbMat };

    const root = new THREE.Group();
    root.name = 'sts3215';
    root.scale.setScalar(MM);
    root.position.set(0, SERVO_Y, 0); // case centre in world
    this.scene.add(root);
    this.root = root;
    const parts = [];
    const part = (name, obj, explode, info = {}) => {
      obj.name = name;
      obj.userData.base = obj.position.clone();
      obj.userData.explode = obj.position.clone().add(new THREE.Vector3(...explode));
      obj.userData.info = { name, ...info };
      obj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
          Object.assign(o.userData, { kind: 'servo-part', part: obj, info: obj.userData.info });
        }
      });
      root.add(obj);
      parts.push(obj);
      return obj;
    };
    // local frame: x = length, y = width (vertical in the scene), z = shaft axis (towards camera)
    const z0 = -CASE.H / 2; // bottom of case in local z
    const ring = (z, h, withPlate, plateAtTop, hole) => {
      const shape = roundedRect(CASE.L, CASE.W, CASE.r);
      const holePath = roundedRectPath(CASE.L - CASE.wall * 2, CASE.W - CASE.wall * 2, CASE.r - CASE.wall * 0.6);
      const g = new THREE.Group();
      const wallH = withPlate ? h - CASE.wall : h;
      const sh = shape.clone();
      sh.holes = [holePath];
      const walls = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: wallH, bevelEnabled: false, curveSegments: 6 }), caseMat);
      walls.position.z = withPlate && !plateAtTop ? CASE.wall : 0;
      g.add(walls);
      if (withPlate) {
        const ps = roundedRect(CASE.L, CASE.W, CASE.r);
        if (hole) {
          const hp = new THREE.Path();
          hp.absarc(hole.x, hole.y, hole.r, 0, Math.PI * 2, true);
          ps.holes.push(hp);
        }
        const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(ps, { depth: CASE.wall, bevelEnabled: false, curveSegments: 6 }), caseMat);
        plate.position.z = plateAtTop ? wallH : 0;
        g.add(plate);
      }
      g.position.z = z0 + z;
      return g;
    };
    const bottom = part('Bottom cover', ring(0, 8, true, false), [0, 0, -46], { note: 'PA + glass fibre' });
    const middle = part('Middle frame', ring(8, 17, false), [0, 0, -6], { note: 'motor + gear housing' });
    const top = part('Top cover', ring(25, 10, true, true, { x: SHAFT_X, y: 0, r: 4.2 }), [0, 0, 40], { note: 'holds the output bearing' });
    // boss around the output shaft + sticker on the +y face
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6.2, 2.4, 40, 1, true), caseMat);
    boss.rotation.x = Math.PI / 2;
    boss.position.set(SHAFT_X, 0, 11.2); // sits on the top plate (top group spans z 0..10)
    top.add(boss);
    const sticker = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), enhance(new THREE.MeshStandardMaterial({ map: stickerTexture(), roughness: 0.4 }), { planes: P }));
    sticker.rotation.set(-Math.PI / 2, 0, 0); // on the +y face, text reading along the length
    sticker.position.set(2, CASE.W / 2 + 0.06, 8.5);
    middle.add(sticker);

    // connectors at the +x end of the bottom section
    const conns = new THREE.Group();
    for (const y of [-5.2, 5.2]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(6, 7.6, 5.2), white);
      c.position.set(CASE.L / 2 - 1.5, y, z0 + 4.2);
      conns.add(c);
      for (let k = 0; k < 3; k++) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.64, 0.64), copper);
        pin.position.set(CASE.L / 2 + 0.8, y - 2.54 + k * 2.54, z0 + 4.2);
        conns.add(pin);
      }
    }
    part('Bus connectors', conns, [12, -16, -27], { note: '5264 3-pin · in + out (daisy chain)' });

    // PCB with components
    const pcb = new THREE.Group();
    const board = new THREE.Mesh(new RoundedBoxGeometry(40, 20.5, 1.2, 2, 0.4), pcbMat);
    board.position.set(0, 0, z0 + 6.2);
    pcb.add(board);
    const chip = (w, d, h, x, y, mat = black) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
      m.position.set(x, y, z0 + 6.8 + h / 2);
      pcb.add(m);
      return m;
    };
    this.encoderChip = chip(4, 4, 0.9, SHAFT_X, 0);
    this.mcu = chip(5, 5, 0.9, 1.5, 4.2);
    this.hbridge = [chip(4, 5, 1.4, 9.5, -4.6), chip(4, 5, 1.4, 9.5, 4.6)];
    chip(3, 1.6, 1.0, -3, -6);
    chip(2.4, 1.2, 0.8, 5, -6.5);
    for (const [x, y] of [[15.5, -6.6], [15.5, 6.6], [-4.5, 6.5]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 3.2, 20), alu);
      c.rotation.x = Math.PI / 2;
      c.position.set(x, y, z0 + 8.4);
      pcb.add(c);
    }
    part('Control board', pcb, [0, 0, -27], { note: 'MCU · H-bridge · encoder chip' });

    // motor (vertical, at the far end), terminals down to the board
    const motor = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 14.5, 40), motorCan);
    can.rotation.x = Math.PI / 2;
    can.position.set(MOTOR_X, 0, z0 + 17);
    motor.add(can);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(6.0, 6.0, 1.6, 40), black);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(MOTOR_X, 0, z0 + 9.2);
    motor.add(cap);
    for (const y of [-2.6, 2.6]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 2.6), copper);
      t.position.set(MOTOR_X, y, z0 + 7.6);
      motor.add(t);
    }
    const mshaft = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 4, 12), steel);
    mshaft.rotation.x = Math.PI / 2;
    mshaft.position.set(MOTOR_X, 0, z0 + 25.2);
    motor.add(mshaft);
    part('Motor', motor, [0, 22, 4], { note: 'DC motor · up to ~18,000 rpm' });

    // gear train
    const L = layoutAxles();
    this.axles = L;
    const train = new THREE.Group();
    const axleGeo = new THREE.CylinderGeometry(0.5, 0.5, 9.5, 10);
    const spinners = []; // { obj, ratioFromOutput }
    const ratios = STAGES.map(([p, g]) => g / p);
    // speed of each axle relative to the output: motor = product of all ratios
    const rel = [ratios[0] * ratios[1] * ratios[2] * ratios[3], ratios[1] * ratios[2] * ratios[3], ratios[2] * ratios[3], ratios[3], 1];
    const axlePos = [L.M, L.A, L.B, L.C, L.O];
    this.gearInfo = [];
    // motor pinion
    const pin0 = gearMesh(STAGES[0][0], steel, GEAR_T, 0.4);
    pin0.position.set(L.M.x, L.M.y, z0 + LAYERS[0]);
    train.add(pin0);
    spinners.push({ obj: pin0, rel: rel[0], dir: 1 });
    for (let i = 0; i < 4; i++) {
      const pos = axlePos[i + 1];
      const big = gearMesh(STAGES[i][1], i === 3 ? steel : brass, GEAR_T, 0.55);
      big.position.set(pos.x, pos.y, z0 + LAYERS[i]);
      train.add(big);
      const dir = i % 2 === 0 ? -1 : 1;
      spinners.push({ obj: big, rel: rel[i + 1], dir });
      this.gearInfo.push({ obj: big, teeth: STAGES[i][1], pinion: STAGES[i][0], rel: rel[i + 1], stage: i + 1 });
      if (i < 3) {
        const small = gearMesh(STAGES[i + 1][0], steel, GEAR_T, 0.45);
        small.position.set(pos.x, pos.y, z0 + LAYERS[i + 1]);
        train.add(small);
        spinners.push({ obj: small, rel: rel[i + 1], dir });
        const axle = new THREE.Mesh(axleGeo, steel);
        axle.rotation.x = Math.PI / 2;
        axle.position.set(pos.x, pos.y, z0 + 29.3);
        train.add(axle);
      }
    }
    // a spin-blur disc over the motor pinion for when it is a blur
    this.blur = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32), new THREE.MeshBasicMaterial({ color: 0xc8ccd3, transparent: true, opacity: 0, depthWrite: false }));
    this.blur.position.set(L.M.x, L.M.y, z0 + LAYERS[0] + GEAR_T / 2 + 0.05);
    train.add(this.blur);
    this.spinners = spinners;
    part('Gear train', train, [0, 0, 20], { note: '4 metal stages · 345:1' });

    // output shaft assembly: shaft, spline, bearing, magnet; rotates with the output
    const out = new THREE.Group();
    out.position.set(SHAFT_X, 0, 0);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 27, 32), steel);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, z0 + 9.6 + 13.5);
    out.add(shaft);
    const spline = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 2.95, 3.2, 50), steel);
    const sp = spline.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i);
      const z = sp.getZ(i);
      const a = Math.atan2(z, x);
      const k = Math.cos(a * 25) > 0 ? 1 : 0.88;
      const r = Math.hypot(x, z);
      if (r > 0.1) {
        sp.setX(i, (x / r) * 2.95 * k);
        sp.setZ(i, (z / r) * 2.95 * k);
      }
    }
    spline.geometry.computeVertexNormals();
    spline.rotation.x = Math.PI / 2;
    spline.position.set(0, 0, z0 + 37.2);
    out.add(spline);
    const magnet = new THREE.Group();
    const half = (mat, rot) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.4, 24, 1, false, rot, Math.PI), mat);
      m.rotation.x = Math.PI / 2;
      return m;
    };
    magnet.add(half(magN, 0), half(magS, Math.PI));
    magnet.position.set(0, 0, z0 + 9.0);
    out.add(magnet);
    this.magnet = magnet;
    const outGearLocal = new THREE.Group(); // the output gear lives in the train; keep its spin here
    out.add(outGearLocal);
    part('Output shaft', out, [0, 0, 64], { note: '25-tooth spline · magnet at its foot' });
    this.output = out;
    const bearing = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.9, 12, 32), steel);
    bearing.position.set(SHAFT_X, 0, z0 + 34.2);
    part('Ball bearing', bearing, [0, 0, 52], { note: 'carries the output shaft' });

    // horn (rotates with the output)
    const hornShape = new THREE.Shape();
    hornShape.absarc(0, 0, 10, 0, Math.PI * 2, false);
    for (let i = 0; i < 4; i++) {
      const h = new THREE.Path();
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      h.absarc(Math.cos(a) * 7, Math.sin(a) * 7, 1.1, 0, Math.PI * 2, true);
      hornShape.holes.push(h);
    }
    const center = new THREE.Path();
    center.absarc(0, 0, 1.6, 0, Math.PI * 2, true);
    hornShape.holes.push(center);
    const horn = new THREE.Mesh(new THREE.ExtrudeGeometry(hornShape, { depth: 2.6, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 2, curveSegments: 24 }), alu);
    horn.position.set(0, 0, z0 + 38.9);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 1.4, 6), steel);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0, 0, z0 + 42.2);
    const hornGroup = new THREE.Group();
    hornGroup.position.set(SHAFT_X, 0, 0);
    hornGroup.add(horn, screw);
    part('Horn', hornGroup, [0, 0, 82], { note: 'aluminium · bolts to the next link' });
    this.horn = hornGroup;
    this.parts = parts;
    this.z0 = z0;
    // work light that comes on when the case is opened (world units ~ 1 cm)
    this.workLight = new THREE.PointLight(0xfff2e0, 0, 1.2, 2);
    this.workLight.position.set(-2, 6, z0 + 62);
    root.add(this.workLight);
    this.outputGear = this.gearInfo[3].obj;
  }

  buildLoad() {
    // lever arm on the horn with a weight hanger (Lift / Overload)
    const z0 = this.z0;
    const alu = this.mats.alu;
    const armLen = 60; // mm
    this.armLen = armLen;
    const arm = new THREE.Group();
    const bar = new THREE.Mesh(new RoundedBoxGeometry(armLen + 10, 8, 2.5, 2, 1), alu);
    bar.position.set(armLen / 2, 0, 0);
    arm.add(bar);
    arm.position.set(0, 0, z0 + 43.6);
    this.horn.add(arm);
    this.arm = arm;
    const hanger = new THREE.Group();
    this.scene.add(hanger);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 6), new THREE.MeshStandardMaterial({ color: 0xd8dce4, metalness: 1, roughness: 0.3 }));
    hanger.add(wire);
    this.wire = wire;
    const plates = new THREE.Group();
    const plateMat = new THREE.MeshPhysicalMaterial({ color: 0x9aa1ad, roughness: 0.28, metalness: 0.95, clearcoat: 0.4 });
    const plateGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.052, 64);
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(plateGeo, plateMat);
      p.position.y = -i * 0.058;
      p.castShadow = true;
      plates.add(p);
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 12), plateMat);
    rod.position.y = -0.17;
    plates.add(rod);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshBasicMaterial({ map: weightTexture('0.5 kg'), transparent: true }));
    tag.position.set(0, 0, 0.152);
    plates.add(tag);
    this.tag = tag;
    this.tagTex = { lift: weightTexture('0.5 kg'), overload: weightTexture('3.5 kg') };
    hanger.add(plates);
    this.plates = plates;
    this.hanger = hanger;
    this.hangerPos = new THREE.Vector3();
  }

  buildFlows() {
    // traces on the board (power: connector -> H-bridge -> motor; data: connector -> MCU) and the bus cable
    const z = this.z0 + 6.9;
    const pts = (arr) => arr.map(([x, y, zz = z]) => new THREE.Vector3(x, y, zz));
    const mat = cableMaterial(this.planes);
    this.flowMat = mat;
    const traceSets = {
      power: [
        pts([[21.5, -5.2], [15, -5.2], [11.5, -4.6]]),
        pts([[11.5, -4.6], [11.5, -2.6], [11.2, -2.6, this.z0 + 7.6]]),
        pts([[21.5, 5.2], [15, 5.2], [11.5, 4.6]]),
        pts([[11.5, 4.6], [11.5, 2.6], [11.2, 2.6, this.z0 + 7.6]]),
      ],
      data: [pts([[21.5, 0], [12, 0.6], [4, 4.2]]), pts([[SHAFT_X, 0], [-6, 2.4], [-1, 4.2]]), pts([[4, 3], [8.5, -3.2]])],
    };
    this.traces = [];
    for (const [kind, list] of Object.entries(traceSets))
      for (const p of list) {
        const tube = new DynamicTube(24, 0.34, mat.clone());
        const curve = new THREE.CatmullRomCurve3(p, false, 'centripetal');
        tube.set(curve.getSpacedPoints(23));
        tube.kind = kind;
        tube.mesh.material = cableMaterial(this.planes);
        this.root.add(tube.mesh);
        this.traces.push(tube);
      }
    // bus cable leaving the connectors, down to the pedestal
    const cableMat = cableMaterial([]);
    this.busMat = cableMat;
    this.busCable = new DynamicTube(48, 0.012, cableMat);
    this.scene.add(this.busCable.mesh);
    const start = new THREE.Vector3(CASE.L / 2 + 3, 0, this.z0 + 4.2).multiplyScalar(MM).add(this.root.position);
    const curve = new THREE.CatmullRomCurve3([start, start.clone().add(new THREE.Vector3(0.12, -0.02, 0)), new THREE.Vector3(0.45, 0.62, -0.1), new THREE.Vector3(0.42, 0.09, -0.12)], false, 'centripetal');
    this.busCable.set(curve.getSpacedPoints(47));

    this.packets = [];
    for (let i = 0; i < 6; i++) {
      const g = makeGlow(new THREE.Color(0x4fd8ff), 0.05);
      this.scene.add(g);
      this.packets.push(g);
    }
    this.motorGlow = makeGlow(new THREE.Color(0xffb547), 0.4);
    this.scene.add(this.motorGlow);
    this.encGlow = makeGlow(new THREE.Color(0xb48cff), 0.18);
    this.scene.add(this.encGlow);
    this.mcuGlow = makeGlow(new THREE.Color(0x4fd8ff), 0.12);
    this.scene.add(this.mcuGlow);
    this.flowAmt = { power: 0, data: 0, gears: 0 };
    this.cycle = 0;
  }

  buildLabels() {
    const L = this.labels;
    const local = (obj, v) => () => obj.localToWorld(v.clone());
    const z0 = this.z0;
    const r = this.root;
    const pos = (x, y, z) => () => r.localToWorld(new THREE.Vector3(x, y, z));
    // cutaway
    L.add(pos(MOTOR_X, -2, z0 + 17), { text: 'Motor', sub: 'DC, ~18,000 rpm', color: '#ffb547', group: 'cut' });
    L.add(pos(this.axles.A.x, this.axles.A.y, z0 + 34), { text: 'Gear train', sub: '345 : 1', color: '#d08c55', group: 'cut' });
    L.add(pos(SHAFT_X, -3.5, z0 + 22), { text: 'Output shaft', sub: '25T spline', color: '#c8ccd3', group: 'cut' });
    L.add(pos(SHAFT_X, 2, z0 + 9), { text: 'Magnet', sub: 'diametric', color: '#ff6b9a', group: 'cut', offset: [-40, 0] });
    L.add(pos(SHAFT_X, -2, z0 + 7.5), { text: 'Encoder', sub: '12-bit · 4096 steps', color: '#b48cff', group: 'cut', offset: [-10, 18] });
    L.add(pos(0, -4, z0 + 6.8), { text: 'Control board', sub: 'MCU + H-bridge', color: '#5cf2b0', group: 'cut', offset: [10, 14] });
    L.add(pos(SHAFT_X, 4, z0 + 34.2), { text: 'Ball bearing', color: '#c8ccd3', group: 'cut', small: true, offset: [0, -14] });
    L.add(pos(CASE.L / 2 + 2, 6, z0 + 4.2), { text: 'Bus in / out', sub: 'GND · V+ · data', color: '#4fd8ff', group: 'cut', small: true });
    // exploded
    this.parts.forEach((p, i) => {
      const info = p.userData.info;
      L.add(() => new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3()), {
        text: info.name,
        sub: info.note,
        color: '#e9e6de',
        group: 'exploded',
        small: true,
        offset: [0, i % 2 ? 64 : -64],
      });
    });
    // follow modes
    L.add(pos(9.5, -4.6, z0 + 8.5), { text: 'H-bridge', sub: 'PWM', color: '#ffb547', group: 'power', small: true });
    L.add(pos(MOTOR_X, 0, z0 + 25), { text: 'Motor', sub: '', color: '#ffb547', group: 'power' });
    this.currentLabel = L.add(pos(CASE.L / 2 + 4, -5, z0 + 4.2), { text: 'Current', sub: '', color: '#ffb547', group: 'power' });
    this.packetLabel = L.add(() => this.packetAnchor ?? new THREE.Vector3(), { text: '', sub: '', color: '#4fd8ff', group: 'data-packet' });
    L.add(pos(1.5, 4.2, z0 + 8.4), { text: 'MCU', sub: 'decodes packets', color: '#4fd8ff', group: 'data', small: true });
    this.encLabel = L.add(pos(SHAFT_X, -2.5, z0 + 7.6), { text: 'Encoder', sub: '', color: '#b48cff', group: 'data', small: true, offset: [-30, 16] });
    this.gearLabels = [];
    const m = this.axles.M;
    this.motorRpmLabel = L.add(pos(m.x, m.y, z0 + LAYERS[0] + 1.5), { text: 'Motor', sub: '', color: '#ffb547', group: 'gears', small: true, offset: [26, -10] });
    for (const gi of this.gearInfo) {
      const p = gi.obj.position;
      const item = L.add(pos(p.x, p.y + 2, p.z + 1.4), { text: `Stage ${gi.stage}`, sub: '', color: '#d08c55', group: 'gears', small: true });
      this.gearLabels.push({ item, gi });
    }
    this.loadLabel = L.add(() => this.hanger.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.3, -0.1, 0)), { text: 'Load', sub: '', color: '#e9e6de', group: 'load' });
    this.tempLabel = L.add(pos(MOTOR_X, 9, z0 + 17), { text: 'Winding', sub: '', color: '#ff6b6b', group: 'temp' });
  }

  /* ---------------------------------------------------------------- UI hooks */

  get config() {
    return {
      eyebrow: SERVO.eyebrow,
      pre: SERVO.pre,
      title: SERVO.title,
      lede: SERVO.lede,
      followLabel: 'Follow',
      follow: SERVO.follow,
      sliderLabel: 'Shaft speed',
      variantLabel: 'Scenario',
      variants: SERVO.scenarios,
      viewLabel: 'Servo',
      views: SERVO.views,
      action: { title: 'Reset protection', icon: 'kick' },
    };
  }

  hud() {
    const s = SERVO.spec;
    const outRpm = (Math.abs(this.omega) * 60) / (Math.PI * 2);
    return {
      stats: [
        { k: 'Motor', v: fmt(outRpm * s.ratio, 0), u: 'rpm' },
        { k: 'Output', v: outRpm.toFixed(1), u: 'rpm' },
        { k: 'Current', v: this.current.toFixed(2), u: 'A' },
      ],
      card: SERVO.card({
        follow: this.state.follow,
        view: this.state.view,
        scenario: this.state.scenario,
        speedPct: Math.round(this.state.slider * 100),
        torque: this.loadTorque(),
        current: this.current,
        tripped: this.tripped,
      }),
      cardKey: [this.state.follow, this.state.view, this.state.scenario, this.tripped].join('|'),
      sliderText: `${Math.round(this.state.slider * 100)}%`,
      title: SERVO.title,
      lede: SERVO.lede,
    };
  }

  setFollow(k) {
    this.state.follow = k;
    if (this.state.view === 'exploded' && k !== 'all') this.setView('whole', false);
    this.setCamera(k === 'all' ? this.state.view : k);
  }
  setSlider(u) {
    this.state.slider = u;
  }
  setVariant(k) {
    if (!SERVO.scenarios.some((s) => s.key === k)) return;
    this.state.scenario = k;
    this.tripped = false;
    this.tripTimer = 0;
    this.temp = 31;
    if (k !== 'sweep') this.setCamera('load');
  }
  setView(k, move = true) {
    this.state.view = k;
    if (k === 'exploded') this.state.follow = 'all';
    if (move) this.setCamera(k);
  }
  action() {
    this.tripped = false;
    this.tripTimer = 0;
    this.temp = 31;
  }

  setCamera(key, duration = 1.3) {
    const views = {
      whole: { pos: [0.95, 1.75, 1.95], target: [0.02, 1.0, 0.02] },
      cutaway: { pos: [0.05, 2.25, 0.66], target: [0.0, 1.11, 0.06] },
      exploded: { pos: [2.55, 1.62, 0.5], target: [0, 1.14, 0.18] },
      power: { pos: [0.32, 1.72, 0.98], target: [0.02, 1.1, -0.06] },
      data: { pos: [-0.12, 1.72, 0.98], target: [-0.02, 1.1, -0.06] },
      gears: { pos: [0.05, 1.62, 0.98], target: [0.0, 1.12, 0.08] },
      load: { pos: [0.55, 1.35, 2.6], target: [0.18, 0.85, 0.1] },
    };
    const v = views[key] ?? views.whole;
    const scale = isSmallScreen() ? 1.4 : 1;
    const target = new THREE.Vector3(...v.target);
    const pos = new THREE.Vector3(...v.pos).sub(target).multiplyScalar(scale).add(target);
    if (duration === 0) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    this.tweens.to('camera', {
      from: 0,
      to: 1,
      duration,
      onUpdate: (k) => {
        this.controls.target.lerpVectors(t0, target, k);
        this.camera.position.lerpVectors(p0, pos, k);
      },
    });
  }

  /* ---------------------------------------------------------------- picking */

  pick() {
    if (this.pointer?.x === undefined || this.pointer.x > 2) return null;
    const rc = (this.raycaster ??= new THREE.Raycaster());
    rc.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    this.root.traverse((o) => o.isMesh && o.userData.kind === 'servo-part' && meshes.push(o));
    for (const h of rc.intersectObjects(meshes, false)) {
      if ((h.object.material.clippingPlanes ?? []).some((p) => p.distanceToPoint(h.point) < 0)) continue;
      return h.object;
    }
    return null;
  }

  hover() {
    const obj = this.pick();
    if (obj !== this.hovered) {
      if (this.hovered) this.hovered.material = this.hovered.userData.baseMaterial ?? this.hovered.material;
      this.hovered = obj;
      if (obj && obj.material.userData?.u) {
        obj.userData.baseMaterial = obj.material;
        obj.material = highlightTwin(obj.material);
      }
    }
    if (!obj) return null;
    return { title: obj.userData.info.name, sub: obj.userData.info.note ?? '' };
  }

  click() {
    return null;
  }

  onPointerMove(x, y) {
    (this.pointer ??= new THREE.Vector2()).set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  }
  onPointerLeave() {
    this.pointer?.set(9, 9);
  }

  /* ---------------------------------------------------------------- physics-ish */

  loadTorque() {
    if (this.state.scenario === 'lift') return 0.5 * (this.armLen / 10); // kg·cm
    if (this.state.scenario === 'overload') return 3.5 * (this.armLen / 10);
    return 0;
  }

  simulate(dt) {
    const s = SERVO.spec;
    const sc = this.state.scenario;
    const wMax = ((s.noLoadRpm * Math.PI * 2) / 60) * Math.max(0.02, this.state.slider);
    const prev = this.angle;
    let target;
    if (sc === 'sweep') target = Math.sin(this.time * (wMax / 1.05)) * 1.05;
    else if (sc === 'lift') target = Math.sin(this.time * (wMax / 0.7)) * 0.7;
    else target = 0.35; // try to lift above horizontal
    const tq = this.loadTorque();
    const gravity = tq * Math.cos(this.angle); // kg·cm needed to hold against gravity
    if (sc === 'overload' && (this.tripped || Math.abs(gravity) > s.stallTorque)) {
      // stalled or released: the weight wins
      if (this.tripped) this.angle = damp(this.angle, -Math.PI / 2, 3, dt);
      else this.angle = damp(this.angle, Math.max(this.angle - 0.01, -0.1), 6, dt);
      this.omega = (this.angle - prev) / Math.max(dt, 1e-4);
      const stall = !this.tripped;
      this.current = damp(this.current, stall ? s.stallCurrent : s.noLoadCurrent * 0.5, 6, dt);
      if (stall) {
        this.temp += dt * 9;
        this.tripTimer += dt;
        if (this.tripTimer > 3.2) this.tripped = true;
      } else {
        this.temp = Math.max(31, this.temp - dt * 2);
        this.tripTimer += dt;
        if (this.tripTimer > 9) {
          this.tripped = false;
          this.tripTimer = 0;
          this.temp = 31;
        }
      }
    } else {
      const err = target - this.angle;
      const vCmd = clamp(err * 6, -wMax, wMax);
      this.omega = damp(this.omega, vCmd, 10, dt);
      this.angle += this.omega * dt;
      const tqNeed = Math.abs(gravity) + Math.abs(this.omega) * 0.25;
      const frac = clamp(tqNeed / s.stallTorque, 0, 1);
      const I = s.noLoadCurrent + (s.stallCurrent - s.noLoadCurrent) * frac + Math.abs(this.omega / ((s.noLoadRpm * Math.PI * 2) / 60)) * 0.05;
      this.current = damp(this.current, I, 6, dt);
      this.temp = damp(this.temp, 31 + this.current * 3, 0.3, dt);
    }
  }

  /* ---------------------------------------------------------------- update */

  update(dt, time) {
    this.time = time;
    this.tweens.update(dt);
    this.simulate(dt);
    const sc = this.state.scenario;
    const view = this.state.view;
    const follow = view === 'exploded' ? 'all' : this.state.follow;

    // rotate output assembly + gears
    this.output.rotation.z = this.angle;
    this.horn.rotation.z = this.angle;
    const capRev = 1.4 * Math.PI * 2; // visual cap: rad/s
    let blur = 0;
    for (const sp of this.spinners) {
      const w = this.omega * sp.rel;
      const shown = clamp(w, -capRev, capRev);
      sp.obj.rotation.z += shown * sp.dir * dt;
      if (sp.rel > 300) blur = clamp((Math.abs(w) - capRev) / (capRev * 20), 0, 0.85);
    }
    this.blur.material.opacity = blur;
    // the output gear is exact (rides the shaft)
    this.outputGear.rotation.z = this.angle;

    // hanger follows the arm tip
    const showLoad = sc !== 'sweep';
    this.hanger.visible = showLoad && this.explode < 0.05;
    if (showLoad) {
      const tip = this.arm.localToWorld(new THREE.Vector3(this.armLen, 0, 0));
      const len = 0.3;
      this.wire.position.set(tip.x, tip.y - len / 2, tip.z);
      this.wire.scale.y = len;
      this.plates.position.set(tip.x, tip.y - len - 0.04, tip.z);
      const n = sc === 'overload' ? 7 : 1; // 0.5 kg plates
      this.plates.children.forEach((p, i) => {
        if (p.geometry?.type === 'CylinderGeometry' && p.geometry.parameters.radiusTop > 0.1) p.visible = i < n;
      });
      this.tag.material.map = this.tagTex[sc];
      this.tag.position.y = 0;
    }

    // explode / cutaway
    this.explode = damp(this.explode, view === 'exploded' ? 1 : 0, 3.2, dt);
    const e = ease.inOutCubic(this.explode);
    for (const p of this.parts) p.position.lerpVectors(p.userData.base, p.userData.explode, e);
    // Cuts peel the servo in layers along its shaft:
    //   section: lengthwise through the whole stack (Cutaway)
    //   gears:   top cover off, gear train face-on (Gears)
    //   board:   down to the control board (Power, Data)
    let mode = null;
    if (view === 'cutaway') mode = follow === 'gears' ? 'gears' : follow === 'power' || follow === 'data' ? 'board' : 'section';
    else if (view === 'whole' && follow !== 'all') mode = follow === 'gears' ? 'gears' : 'board';
    if (mode !== this.cutMode) {
      if (mode && this.cutMode) this.cut = 0; // replay the cut when switching layers
      if (mode) this.cutMode = mode;
      else if (this.cut < 0.02) this.cutMode = null;
    }
    this.cut = damp(this.cut, mode ? 1 : 0, 4, dt);
    const k = ease.outCubic(this.cut);
    const p = this.cutPlane;
    if (!this.cutMode || this.cut < 0.005) p.constant = PARKED;
    else if (this.cutMode === 'section') {
      p.normal.set(0, -1, 0);
      p.constant = THREE.MathUtils.lerp(SERVO_Y + 0.3, SERVO_Y + 0.0005, k);
    } else {
      const zLocal = this.cutMode === 'gears' ? this.z0 + 33.2 : this.z0 + 8.4;
      p.normal.set(0, 0, -1);
      p.constant = THREE.MathUtils.lerp(0.6, this.root.position.z + zLocal * MM, k);
    }
    this.arm.visible = this.explode < 0.5;
    for (const f of this.fixture) f.visible = this.explode < 0.15;
    this.workLight.intensity = this.cut * (this.cutMode === 'section' ? 0.12 : 0.22);

    // flows
    const tgt = { power: follow === 'power' ? 1 : 0, data: follow === 'data' ? 1 : 0, gears: follow === 'gears' ? 1 : 0 };
    for (const k in tgt) this.flowAmt[k] = damp(this.flowAmt[k], tgt[k], 4, dt);
    const iFrac = clamp(this.current / SERVO.spec.stallCurrent, 0, 1);
    for (const t of this.traces) {
      const u = t.mesh.material.userData.u;
      u.uTime.value = time * (0.6 + iFrac);
      u.uPower.value = t.kind === 'power' ? this.flowAmt.power * (0.4 + iFrac) : 0;
      u.uData.value = t.kind === 'data' ? this.flowAmt.data * 0.8 : 0;
      t.mesh.visible = this.explode < 0.05;
    }
    const bu = this.busMat.userData.u;
    bu.uTime.value = time;
    bu.uPower.value = this.flowAmt.power * 0.8;
    bu.uData.value = this.flowAmt.data * 0.5;
    this.busCable.mesh.visible = this.explode < 0.3;

    const motorPos = this.root.localToWorld(new THREE.Vector3(MOTOR_X, 0, this.z0 + 17));
    this.motorGlow.position.copy(motorPos);
    const heat = clamp((this.temp - 31) / 40, 0, 1);
    this.motorGlow.material.color.setRGB(1, 0.71 - heat * 0.4, 0.28 - heat * 0.2);
    this.motorGlow.material.opacity = this.flowAmt.power * (0.25 + iFrac * 0.75) + heat * 0.8;
    this.motorGlow.scale.setScalar(0.25 + iFrac * 0.25 + heat * 0.2);
    this.encGlow.position.copy(this.root.localToWorld(new THREE.Vector3(SHAFT_X, 0, this.z0 + 8)));
    this.encGlow.material.opacity = this.flowAmt.data * (0.5 + 0.5 * Math.sin(time * 8));
    this.mcuGlow.position.copy(this.root.localToWorld(new THREE.Vector3(1.5, 4.2, this.z0 + 7.5)));
    this.animatePackets(dt);
    this.ring.material.color.setRGB(0.31, 0.85, 1).multiplyScalar(1.6 + iFrac * 1.5);

    // labels
    const groups = [];
    if (this.explode > 0.6) groups.push('exploded');
    else if (view === 'cutaway' && follow === 'all') groups.push('cut');
    if (this.explode < 0.3) {
      if (follow === 'power') groups.push('power');
      if (follow === 'data') groups.push('data', 'data-packet');
      if (follow === 'gears') groups.push('gears');
      if (showLoad && view !== 'exploded') groups.push('load');
      if (sc === 'overload' && view !== 'exploded') groups.push('temp');
    }
    this.labels.only(this.packetVisible ? groups : groups.filter((g) => g !== 'data-packet'));
    const outRpm = (Math.abs(this.omega) * 60) / (Math.PI * 2);
    this.motorRpmLabel.setSub(`${fmt(outRpm * 345)} rpm · 8T`);
    for (const { item, gi } of this.gearLabels) item.setSub(`${gi.pinion}→${gi.teeth}T · ${fmt(outRpm * gi.rel, gi.rel < 10 ? 1 : 0)} rpm`);
    this.currentLabel.setSub(`${this.current.toFixed(2)} A`);
    const pos12 = Math.round((((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 4096 + 2048) % 4096;
    this.encLabel.setSub(`${pos12} / 4096`);
    this.loadLabel.setText(sc === 'overload' ? '3.5 kg' : '0.5 kg');
    this.loadLabel.setSub(`${this.loadTorque().toFixed(0)} kg·cm at 6 cm`);
    this.tempLabel.setSub(`${this.temp.toFixed(0)} °C${this.tripped ? ' · protection on' : ''}`);
    this.labels.update(this.camera, innerWidth, innerHeight);
  }

  animatePackets(dt) {
    for (const p of this.packets) p.material.opacity = 0;
    this.packetVisible = false;
    if (this.flowAmt.data < 0.05) return;
    const period = 3.2;
    this.cycle = (this.cycle + dt / period) % 1;
    const t = this.cycle;
    const a = this.flowAmt.data;
    const cable = this.busCable;
    const enter = this.root.localToWorld(new THREE.Vector3(21.5, 0, this.z0 + 6.9));
    const mcu = this.root.localToWorld(new THREE.Vector3(1.5, 4.2, this.z0 + 7.6));
    const pos = Math.round((((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 4096 + 2048) % 4096;
    const goal = Math.round(2048 + (Math.sin(this.time) * 0.5 + 0.5) * 1024);
    const glow = (i, p, color, size = 0.05) => {
      const g = this.packets[i];
      g.position.copy(p);
      g.material.color.set(color);
      g.material.opacity = a;
      g.scale.setScalar(size);
    };
    if (t < 0.3) {
      // command packet travels in along the cable
      const k = t / 0.3;
      const p = cable.pointAt((1 - k) * cable.length, new THREE.Vector3());
      glow(0, p, 0x4fd8ff);
      this.packetAnchor = p;
      this.packetLabel.setText(packet(1, 0x03, [0x2a, goal & 0xff, goal >> 8]));
      this.packetLabel.setSub('write goal position');
      this.packetLabel.el.style.setProperty('--c', '#4fd8ff');
      this.packetVisible = true;
    } else if (t < 0.45) {
      const k = (t - 0.3) / 0.15;
      glow(0, enter.clone().lerp(mcu, k), 0x4fd8ff, 0.035);
      this.mcuGlow.material.opacity = a * k;
    } else if (t < 0.6) {
      this.mcuGlow.material.opacity = a * (1 - (t - 0.45) / 0.15);
    } else if (t < 0.92) {
      const k = (t - 0.6) / 0.32;
      const p = cable.pointAt(k * cable.length, new THREE.Vector3());
      glow(1, p, 0xb48cff);
      this.packetAnchor = p;
      this.packetLabel.setText(packet(1, 0x00, [pos & 0xff, pos >> 8]));
      this.packetLabel.setSub('status: present position');
      this.packetLabel.el.style.setProperty('--c', '#b48cff');
      this.packetVisible = true;
    }
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // phones: push the subject up into the space between the title and the docked controls
    if (w < 860) this.camera.setViewOffset(w, h, 0, h * 0.11, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  tour() {
    return [
      { t: 0, ui: { view: 'whole', follow: 'all', variant: 'sweep', slider: 0.7 } },
      { t: 4, ui: { view: 'cutaway' } },
      { t: 10, ui: { follow: 'gears' } },
      { t: 16, ui: { follow: 'power' } },
      { t: 21, ui: { follow: 'data' } },
      { t: 28, ui: { follow: 'all', view: 'exploded' } },
      { t: 34, ui: { view: 'whole', variant: 'lift' } },
      { t: 39, ui: { variant: 'overload' } },
      { t: 50, end: true },
    ];
  }
}
