// Balance overlay drawn on the treadmill belt: footprints, the stance foot's
// contact area (the SDK bounds the ZMP to 80% of it), the ZMP and its trail,
// the centre of mass with its ground trail, and the inverted pendulum line
// that the walking controller models the robot as.

import * as THREE from 'three';
import { makeGlow } from './wiring.js';

const GREEN = new THREE.Color(0x5cf2b0);
const PINK = new THREE.Color(0xff6b9a);
const WHITE = new THREE.Color(0xdfe8ff);

class Ribbon {
  constructor(max, width, color) {
    this.max = max;
    this.width = width;
    this.color = color.clone();
    this.points = [];
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    const idx = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  push(p) {
    this.points.push(p.clone());
    if (this.points.length > this.max) this.points.shift();
  }
  clear() {
    this.points.length = 0;
  }
  update(opacity, fadeZ) {
    const n = this.points.length;
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let i = 0; i < this.max; i++) {
      const k = Math.min(i, Math.max(0, n - 1));
      const p = this.points[k] ?? new THREE.Vector3();
      const a = this.points[Math.max(0, k - 1)] ?? p;
      const b = this.points[Math.min(n - 1, k + 1)] ?? p;
      dir.subVectors(b, a).setY(0);
      if (dir.lengthSq() < 1e-10) dir.set(0, 0, 1);
      dir.normalize();
      side.set(dir.z, 0, -dir.x).multiplyScalar(this.width / 2);
      this.pos.setXYZ(i * 2, p.x + side.x, p.y, p.z + side.z);
      this.pos.setXYZ(i * 2 + 1, p.x - side.x, p.y, p.z - side.z);
      const age = n > 1 ? k / (n - 1) : 0; // 0 old .. 1 new
      const a2 = i < n ? Math.pow(age, 1.6) * opacity * fadeZ(p) : 0;
      for (const v of [i * 2, i * 2 + 1]) this.col.setXYZW(v, this.color.r * a2, this.color.g * a2, this.color.b * a2, a2);
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}

function rectOutline(w, l, color, dashed = false) {
  const hw = w / 2;
  const hl = l / 2;
  const pts = [
    new THREE.Vector3(-hw, 0, -hl),
    new THREE.Vector3(hw, 0, -hl),
    new THREE.Vector3(hw, 0, hl),
    new THREE.Vector3(-hw, 0, hl),
    new THREE.Vector3(-hw, 0, -hl),
  ];
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.008, gapSize: 0.006, transparent: true, depthWrite: false, toneMapped: false })
    : new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false, toneMapped: false });
  const line = new THREE.Line(g, m);
  if (dashed) line.computeLineDistances();
  line.renderOrder = 4;
  return line;
}

function rectFill(w, l, color) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, l),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

export class BalanceOverlay {
  constructor(gait, robot) {
    this.gait = gait;
    this.robot = robot;
    this.group = new THREE.Group();
    this.group.name = 'balance-overlay';
    const [fw, fl] = [gait.footSize.x, gait.footSize.y];
    this.footW = fw;
    this.footL = fl;
    const Y = 0.0012;

    this.prints = [];
    for (let i = 0; i < 12; i++) {
      const o = rectOutline(fw, fl, GREEN.clone().multiplyScalar(1.6));
      o.visible = false;
      o.position.y = Y;
      this.group.add(o);
      this.prints.push({ line: o, life: 0 });
    }
    this.next = rectOutline(fw, fl, WHITE.clone().multiplyScalar(2), true);
    this.next.position.y = Y;
    this.group.add(this.next);

    this.support = [rectFill(fw * 0.8, fl * 0.8, PINK), rectFill(fw * 0.8, fl * 0.8, PINK)];
    this.supportOutline = [rectOutline(fw * 0.8, fl * 0.8, PINK.clone().multiplyScalar(1.6)), rectOutline(fw * 0.8, fl * 0.8, PINK.clone().multiplyScalar(1.6))];
    for (let i = 0; i < 2; i++) {
      this.support[i].position.y = Y * 1.5;
      this.supportOutline[i].position.y = Y * 1.6;
      this.group.add(this.support[i], this.supportOutline[i]);
    }

    this.comTrail = new Ribbon(160, 0.006, GREEN.clone().multiplyScalar(1.5));
    this.zmpTrail = new Ribbon(100, 0.004, PINK.clone().multiplyScalar(1.3));
    this.group.add(this.comTrail.mesh, this.zmpTrail.mesh);

    this.zmpDot = makeGlow(PINK.clone().multiplyScalar(2.2), 0.03);
    this.comDot = makeGlow(GREEN.clone().multiplyScalar(2.2), 0.04);
    this.comGround = makeGlow(GREEN.clone().multiplyScalar(1.4), 0.025);
    this.group.add(this.zmpDot, this.comDot, this.comGround);

    // the pendulum: ZMP -> COM, and the COM plumb line
    const lineMat = (c, o) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false, toneMapped: false });
    this.pendulum = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat(WHITE.clone().multiplyScalar(2.6), 1));
    this.plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat(GREEN.clone().multiplyScalar(1.5), 0.6));
    this.pendulum.renderOrder = this.plumb.renderOrder = 11;
    this.pendulum.frustumCulled = this.plumb.frustumCulled = false;
    this.group.add(this.pendulum, this.plumb);

    this.amount = 0;
    this.sampleT = 0;
    this.com = new THREE.Vector3(); // belt frame
    this.anchors = {
      com: new THREE.Object3D(),
      zmp: new THREE.Object3D(),
      next: new THREE.Object3D(),
    };
    for (const a of Object.values(this.anchors)) this.group.add(a);
  }

  /** frameToBelt: matrix mapping world -> belt frame (inverse of the group's world matrix). */
  update(dt, amount) {
    this.amount += (amount - this.amount) * Math.min(1, dt * 4);
    const a = this.amount;
    this.group.visible = a > 0.01;
    const g = this.gait;
    for (const ev of g.events) {
      if (ev.type === 'land') {
        const p = this.prints.find((x) => x.life <= 0) ?? this.prints[0];
        p.line.position.set(ev.pos.x, p.line.position.y, ev.pos.z);
        p.life = 1;
      }
    }
    // real centre of mass (from the CAD inertials), expressed in the belt frame
    this.group.updateMatrixWorld();
    const inv = this.group.matrixWorld.clone().invert();
    this.robot.centerOfMass(this.com).applyMatrix4(inv);

    if (!this.group.visible) return;
    const fadeZ = (p) => {
      const wz = p.z + this.group.position.z;
      return THREE.MathUtils.smoothstep(wz, -0.55, -0.35);
    };
    for (const p of this.prints) {
      if (p.life <= 0) {
        p.line.visible = false;
        continue;
      }
      p.life -= dt * 0.22;
      p.line.visible = true;
      p.line.material.opacity = a * Math.min(1, p.life * 2) * fadeZ(p.line.position) * 0.9;
    }
    const walking = g.phase === 'ssp';
    this.next.visible = walking;
    if (walking) {
      this.next.position.set(g.swingTo.x, this.next.position.y, g.swingTo.z);
      this.next.material.opacity = a * (0.55 + 0.45 * Math.sin(performance.now() / 120));
      this.anchors.next.position.set(g.swingTo.x, 0.01, g.swingTo.z + this.footL / 2 + 0.02);
    }
    // support area
    const stance = g.feet[g.stance];
    const other = g.feet[g.swingSide];
    const both = g.phase !== 'ssp';
    this.support[0].position.set(stance.x, this.support[0].position.y, stance.z);
    this.supportOutline[0].position.set(stance.x, this.supportOutline[0].position.y, stance.z);
    this.support[1].position.set(other.x, this.support[1].position.y, other.z);
    this.supportOutline[1].position.set(other.x, this.supportOutline[1].position.y, other.z);
    this.support[0].material.opacity = a * 0.22;
    this.supportOutline[0].material.opacity = a * 0.85;
    this.support[1].material.opacity = both ? a * 0.12 : 0;
    this.supportOutline[1].material.opacity = both ? a * 0.5 : 0;

    // trails
    this.sampleT += dt;
    if (this.sampleT > 1 / 30) {
      this.sampleT = 0;
      this.comTrail.push(new THREE.Vector3(this.com.x, 0.0016, this.com.z));
      this.zmpTrail.push(new THREE.Vector3(g.zmp.x, 0.0018, g.zmp.z));
    }
    this.comTrail.update(a, fadeZ);
    this.zmpTrail.update(a * 0.9, fadeZ);

    this.zmpDot.position.set(g.zmp.x, 0.003, g.zmp.z);
    this.zmpDot.material.opacity = a;
    this.comDot.position.copy(this.com);
    this.comDot.material.opacity = a;
    this.comGround.position.set(this.com.x, 0.003, this.com.z);
    this.comGround.material.opacity = a * 0.8;
    this.anchors.com.position.copy(this.com);
    this.anchors.zmp.position.set(g.zmp.x, 0.004, g.zmp.z);

    const pp = this.pendulum.geometry.attributes.position;
    pp.setXYZ(0, g.zmp.x, 0.003, g.zmp.z);
    pp.setXYZ(1, this.com.x, this.com.y, this.com.z);
    pp.needsUpdate = true;
    this.pendulum.material.opacity = a * 0.9;
    const pl = this.plumb.geometry.attributes.position;
    pl.setXYZ(0, this.com.x, this.com.y, this.com.z);
    pl.setXYZ(1, this.com.x, 0.003, this.com.z);
    pl.needsUpdate = true;
    this.plumb.material.opacity = a * 0.5;
  }

  clear() {
    this.comTrail.clear();
    this.zmpTrail.clear();
    for (const p of this.prints) p.life = 0;
  }
}
