// Servo bus wiring and flow visualisation.
//
// Each limb is one daisy chain: bus adapter -> first servo -> next servo ...
// ("each servo is plugged into the servo above itself or the servo driver").
// Power and data share the same 3-wire cable. Data shows what the SDK does on
// every 30 ms control tick: one group sync-write packet out to all servos,
// then each servo answers a sync-read with its position (slowed down here).

import * as THREE from 'three';
import { canvasTexture } from '../core/util.js';

const RADIAL = 6;
const PER_SEG = 10;

/* ---------------- dynamic tube ---------------- */

export class DynamicTube {
  constructor(maxPoints, radius, material) {
    this.max = maxPoints;
    this.radius = radius;
    const verts = maxPoints * (RADIAL + 1);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.nrm = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.s = new THREE.BufferAttribute(new Float32Array(verts), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('normal', this.nrm);
    g.setAttribute('aS', this.s);
    const idx = [];
    for (let i = 0; i < maxPoints - 1; i++)
      for (let j = 0; j < RADIAL; j++) {
        const a = i * (RADIAL + 1) + j;
        const b = a + RADIAL + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    g.setIndex(idx);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.length = 0;
    this.points = [];
    this.cum = [];
  }

  /** points: array of Vector3 (already sampled densely) */
  set(points) {
    const n = Math.min(points.length, this.max);
    this.points = points;
    const T = new THREE.Vector3();
    const N = new THREE.Vector3();
    const B = new THREE.Vector3();
    const prevT = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let s = 0;
    this.cum.length = 0;
    for (let i = 0; i < this.max; i++) {
      const k = Math.min(i, n - 1);
      const p = points[k];
      if (i > 0 && i < n) s += p.distanceTo(points[k - 1]);
      this.cum[i] = s;
      // tangent
      const a = points[Math.max(0, k - 1)];
      const b = points[Math.min(n - 1, k + 1)];
      T.subVectors(b, a);
      if (T.lengthSq() < 1e-12) T.set(0, 1, 0);
      T.normalize();
      if (i === 0) {
        tmp.set(0, 1, 0);
        if (Math.abs(T.dot(tmp)) > 0.9) tmp.set(1, 0, 0);
        N.crossVectors(T, tmp).normalize();
      } else {
        // parallel transport
        const axis = tmp.crossVectors(prevT, T);
        const len = axis.length();
        if (len > 1e-6) N.applyAxisAngle(axis.divideScalar(len), Math.asin(Math.min(1, len)));
      }
      B.crossVectors(T, N).normalize();
      prevT.copy(T);
      for (let j = 0; j <= RADIAL; j++) {
        const th = (j / RADIAL) * Math.PI * 2;
        const cx = Math.cos(th);
        const sy = Math.sin(th);
        const nx = N.x * cx + B.x * sy;
        const ny = N.y * cx + B.y * sy;
        const nz = N.z * cx + B.z * sy;
        const v = i * (RADIAL + 1) + j;
        this.pos.setXYZ(v, p.x + nx * this.radius, p.y + ny * this.radius, p.z + nz * this.radius);
        this.nrm.setXYZ(v, nx, ny, nz);
        this.s.setX(v, s);
      }
    }
    this.length = s;
    this.pos.needsUpdate = true;
    this.nrm.needsUpdate = true;
    this.s.needsUpdate = true;
  }

  /** World point at arc length d (clamped). */
  pointAt(d, target) {
    const pts = this.points;
    const cum = this.cum;
    if (!pts.length) return target.set(0, 0, 0);
    if (d <= 0) return target.copy(pts[0]);
    const n = Math.min(pts.length, this.max);
    if (d >= cum[n - 1]) return target.copy(pts[n - 1]);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid;
      else hi = mid;
    }
    const t = (d - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
    return target.lerpVectors(pts[lo], pts[hi], t);
  }
}

/* ---------------- cable material with flowing light ---------------- */

export function cableMaterial(planes) {
  const m = new THREE.MeshStandardMaterial({ color: 0x1d1f25, roughness: 0.45, metalness: 0.1 });
  m.clippingPlanes = planes;
  const u = {
    uTime: { value: 0 },
    uPower: { value: 0 },
    uData: { value: 0 },
    uDim: { value: 0 },
    uPowerColor: { value: new THREE.Color(0xffb547) },
    uDataColor: { value: new THREE.Color(0x4fd8ff) },
  };
  m.userData.u = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aS;\nvarying float vS;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = aS;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vS;\nuniform float uTime, uPower, uData, uDim;\nuniform vec3 uPowerColor, uDataColor;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float pw = smoothstep(0.45, 1.0, fract(vS * 26.0 - uTime * 1.3));
        float dd = smoothstep(0.82, 1.0, fract(vS * 44.0 - uTime * 3.2));
        totalEmissiveRadiance += uPowerColor * uPower * (0.35 + pw * 3.2) + uDataColor * uData * (0.25 + dd * 3.0);
        diffuseColor.rgb *= 1.0 - uDim * 0.6;`,
      );
  };
  m.customProgramCacheKey = () => 'cable-flow';
  return m;
}

let glowTex = null;
function glowTexture() {
  glowTex ??= canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  return glowTex;
}

export function makeGlow(color, size) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 }),
  );
  s.scale.setScalar(size);
  s.renderOrder = 10;
  return s;
}

/* ---------------- chains ---------------- */

const ARM = ['shoulder_pitch', 'shoulder_roll', 'shoulder_yaw', 'elbow_pitch', 'wrist_yaw', 'hand'];
const LEG = ['hip_roll', 'hip_pitch', 'hip_yaw', 'knee', 'ankle_pitch', 'ankle_roll'];

const COLORS = { power: new THREE.Color(0xffb547), data: new THREE.Color(0x4fd8ff), feedback: new THREE.Color(0xb48cff) };

export class Wiring {
  /**
   * robot: Robot, internals: result of buildInternals (already attached to the torso),
   * world: Object3D that holds world-space cables, planes: clipping planes for cables
   */
  constructor(robot, internals, world, planes) {
    this.robot = robot;
    this.internals = internals;
    this.group = new THREE.Group();
    this.group.name = 'wiring';
    world.add(this.group);
    this.material = cableMaterial(planes);
    this.tmp = new THREE.Vector3();
    robot.root.updateMatrixWorld(true);

    // connector point for each servo: centre pushed to the face that points outward-and-back
    // (the cable runs down the outer side of each limb, as on the real robot)
    const qInv = new THREE.Quaternion();
    for (const s of robot.servos) {
      const m = s.mesh;
      const bb = m.geometry.boundingBox;
      const wc = s.center.clone().applyMatrix4(m.matrixWorld);
      const side = Math.abs(wc.x) > 0.03 ? Math.sign(wc.x) : 0;
      const back = new THREE.Vector3(side, 0, side ? -0.55 : -1).normalize();
      s.outDir = back.clone();
      qInv.copy(m.getWorldQuaternion(new THREE.Quaternion())).invert();
      const local = back.clone().applyQuaternion(qInv);
      // scale-aware axis pick: compare in world units
      const sc = m.getWorldScale(new THREE.Vector3());
      const ax = [Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)];
      const k = ax.indexOf(Math.max(...ax));
      const half = (bb.max.getComponent(k) - bb.min.getComponent(k)) / 2;
      const off = new THREE.Vector3();
      off.setComponent(k, Math.sign(local.getComponent(k)) * (half + 0.0025 / sc.getComponent(k)));
      s.connector = s.center.clone().add(off);
    }

    const side = (name) => name.split('_')[0];
    const chains = [];
    const adapters = internals.anchors.adapters;
    const byJoint = new Map(robot.servos.map((s) => [s.joint, s]));
    for (const sd of ['right', 'left']) {
      const arm = ARM.map((j) => byJoint.get(`${sd}_${j}`)).filter(Boolean);
      if (arm.length) chains.push({ name: `${sd} arm`, bus: 'upper', adapter: adapters.upper, servos: arm });
      const leg = LEG.map((j) => byJoint.get(`${sd}_${j}`)).filter(Boolean);
      if (leg.length) chains.push({ name: `${sd} leg`, bus: 'lower', adapter: adapters.lower, servos: leg });
    }
    const head = byJoint.get('head_yaw');
    if (head) chains.push({ name: 'head', bus: 'upper', adapter: adapters.upper, servos: [head] });
    this.chains = chains;
    for (const c of chains) {
      const maxPts = (c.servos.length + 1) * PER_SEG * 2 + 4;
      c.tube = new DynamicTube(maxPts, 0.0016, this.material);
      c.tube.mesh.userData = { kind: 'cable', chain: c };
      this.group.add(c.tube.mesh);
      c.servoS = new Array(c.servos.length).fill(0);
    }

    // static cables inside the torso (torso frame, metres)
    this.torsoCables = [];
    const torso = robot.bodies[0].jointGroup;
    const ig = internals.group;
    ig.updateMatrixWorld(true);
    const toTorso = (obj, localMm) => {
      const p = localMm.clone().applyMatrix4(obj.matrixWorld);
      return torso.worldToLocal(p);
    };
    const staticCable = (pts, kind, radius = 0.0018) => {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const tube = new DynamicTube(32, radius, this.material);
      tube.set(curve.getSpacedPoints(31));
      tube.mesh.userData = { kind: 'cable', flow: kind };
      tube.flow = kind;
      torso.add(tube.mesh);
      this.torsoCables.push(tube);
      return tube;
    };
    const comp = internals.anchors.compute;
    const compUsb = toTorso(comp, new THREE.Vector3(-30, -36, 9));
    for (const key of ['upper', 'lower']) {
      const ad = adapters[key];
      const usb = toTorso(ad, ad.userData.usb);
      const mid = compUsb.clone().lerp(usb, 0.5).add(new THREE.Vector3(0, 0.025, -0.01));
      const t = staticCable([compUsb.clone(), mid, usb], 'data', 0.0017);
      t.adapter = key;
      (this.usb ??= {})[key] = t;
    }
    const term = (internals.anchors.batteries ?? [])[0];
    if (term) {
      const tp = toTorso(term, term.userData.terminal);
      for (const key of ['upper', 'lower']) {
        const ad = adapters[key];
        const jack = toTorso(ad, new THREE.Vector3(14, -14, 6));
        const mid = tp.clone().lerp(jack, 0.5).add(new THREE.Vector3(0, -0.01, 0.012));
        staticCable([tp.clone(), mid, jack], 'power', 0.002);
      }
    }

    // glows: one per servo, plus travelling packets
    this.halos = new Map();
    for (const s of robot.servos) {
      const h = makeGlow(COLORS.power, 0.07);
      this.group.add(h);
      this.halos.set(s, h);
    }
    this.packets = [];
    for (let i = 0; i < 64; i++) {
      const p = makeGlow(COLORS.data, 0.028);
      p.visible = false;
      this.group.add(p);
      this.packets.push(p);
    }
    this.mode = 'all';
    this.cycle = 0;
    this.amount = { power: 0, data: 0, dim: 0 };
    this.visible = 1;
    this.flashes = [];
  }

  servoWorld(s, target, connector = false) {
    return target.copy(connector ? s.connector : s.center).applyMatrix4(s.mesh.matrixWorld);
  }

  updateGeometry() {
    const pts = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const c of this.chains) {
      const backW = c.servos[c.servos.length - 1].outDir;
      const ad = c.adapter;
      const start = ad.userData.port.clone().applyMatrix4(ad.matrixWorld);
      const nodes = [start, ...c.servos.map((s) => this.servoWorld(s, new THREE.Vector3(), true))];
      const ctrl = [nodes[0]];
      for (let i = 1; i < nodes.length; i++) {
        a.copy(nodes[i - 1]);
        b.copy(nodes[i]);
        const mid = a.clone().lerp(b, 0.5).addScaledVector(backW, 0.006 + a.distanceTo(b) * 0.12);
        ctrl.push(mid, b.clone());
      }
      const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
      pts.length = 0;
      const n = (ctrl.length - 1) * PER_SEG;
      for (let i = 0; i <= n; i++) pts.push(curve.getPoint(i / n));
      c.tube.set(pts.slice());
      // arc length at each servo node (every 2*PER_SEG samples)
      for (let i = 0; i < c.servos.length; i++) c.servoS[i] = c.tube.cum[Math.min(c.tube.cum.length - 1, (i + 1) * 2 * PER_SEG)];
    }
  }

  /** mode: 'all' | 'power' | 'data' | 'balance'; load(servo) -> 0..1 */
  update(dt, time, mode, load, onAddress) {
    this.updateGeometry();
    const target = { power: mode === 'power' ? 1 : 0, data: mode === 'data' ? 1 : 0, dim: mode === 'balance' ? 1 : 0 };
    for (const k of ['power', 'data', 'dim']) this.amount[k] += (target[k] - this.amount[k]) * Math.min(1, dt * 4);
    const u = this.material.userData.u;
    u.uTime.value = time;
    u.uPower.value = this.amount.power;
    u.uData.value = this.amount.data * 0.35;
    u.uDim.value = this.amount.dim;

    // servo halos
    const p = this.tmp;
    for (const [s, h] of this.halos) {
      this.servoWorld(s, h.position);
      const ld = load ? load(s) : 0.3;
      const pw = this.amount.power * (0.25 + ld * 0.9);
      let flash = 0;
      let fcol = COLORS.data;
      for (const f of this.flashes)
        if (f.servo === s && f.v > flash) {
          flash = f.v;
          fcol = COLORS[f.color];
        }
      const fl = flash * this.amount.data;
      h.material.color.copy(COLORS.power).multiplyScalar(pw);
      h.material.color.r += fcol.r * fl;
      h.material.color.g += fcol.g * fl;
      h.material.color.b += fcol.b * fl;
      h.material.opacity = Math.min(1, pw + fl);
      h.scale.setScalar(0.045 + ld * 0.05 * this.amount.power + flash * 0.03);
      h.visible = h.material.opacity > 0.01 && this.visible > 0.5;
    }
    this.flashes = this.flashes.filter((f) => (f.v -= dt * 2.2) > 0);

    // packets
    for (const pk of this.packets) pk.visible = false;
    if (this.amount.data > 0.02 && this.visible > 0.5) this.animateBus(dt, onAddress);
  }

  animateBus(dt, onAddress) {
    // one control tick (30 ms) shown over ~2.6 s
    const period = 2.6;
    const prev = this.cycle;
    this.cycle = (this.cycle + dt / period) % 1;
    const t = this.cycle;
    let used = 0;
    const put = (pos, color, size = 0.026) => {
      if (used >= this.packets.length) return;
      const pk = this.packets[used++];
      pk.position.copy(pos);
      pk.material.color.copy(color);
      pk.material.opacity = this.amount.data;
      pk.scale.setScalar(size);
      pk.visible = true;
    };
    const p = this.tmp;
    // 1) USB: computer -> adapters (0.00 - 0.12)
    if (t < 0.12 && this.usb) {
      for (const tube of Object.values(this.usb)) put(tube.pointAt((t / 0.12) * tube.length, p), COLORS.data, 0.022);
    }
    // 2) sync write broadcast down every chain (0.12 - 0.45)
    if (t >= 0.12 && t < 0.45) {
      const k = (t - 0.12) / 0.33;
      for (const c of this.chains) {
        const d = k * c.tube.length;
        put(c.tube.pointAt(d, p), COLORS.data);
        c.servos.forEach((s, i) => {
          const sd = c.servoS[i];
          const prevD = (Math.max(0, prev - 0.12) / 0.33) * c.tube.length;
          if (sd <= d && sd > prevD && prev < t) {
            this.flashes.push({ servo: s, v: 1, color: 'data' });
            onAddress?.(s, 'write');
          }
        });
      }
    }
    // 3) sync read: each servo replies in turn, packet travels back to the adapter (0.48 - 0.95)
    if (t >= 0.48 && t < 0.95) {
      for (const c of this.chains) {
        const n = c.servos.length;
        c.servos.forEach((s, i) => {
          const start = 0.48 + (i / Math.max(1, n)) * 0.3;
          const dur = 0.17;
          if (t >= start && t < start + dur) {
            const k = (t - start) / dur;
            put(c.tube.pointAt(c.servoS[i] * (1 - k), p), COLORS.feedback, 0.022);
            if (prev < start && t >= start) {
              this.flashes.push({ servo: s, v: 1, color: 'feedback' });
              onAddress?.(s, 'read');
            }
          }
        });
      }
    }
    // 4) adapters -> computer
    if (t >= 0.9 && this.usb) {
      const k = Math.min(1, (t - 0.9) / 0.1);
      for (const tube of Object.values(this.usb)) put(tube.pointAt((1 - k) * tube.length, p), COLORS.feedback, 0.02);
    }
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v > 0.01;
    for (const t of this.torsoCables) t.mesh.visible = v > 0.01;
  }
}
