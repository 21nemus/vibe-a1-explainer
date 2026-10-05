// Walking for the Vibe A1, modeled on the Vibe Robotics SDK walker
// (scripts/walking: footstep generator -> LIPM/ZMP COM plan -> swing-foot
// curve -> damped least-squares IK). At the slow end the timing matches the
// SDK (0.7 s single support, 0.07 s double support, 3 cm steps); the fast end
// reaches the spec sheet's 0.15 m/s.
//
// Frames: the gait is planned in three.js axes (x lateral, y up, z forward) in
// the treadmill *belt* frame; the IK works in the robot's MuJoCo base frame.

import * as THREE from 'three';

const G = 9.81;
export const MAX_SPEED = 0.15; // m/s, spec sheet
export const SDK_SSP = 0.7;
export const SDK_DSP = 0.07;
const FAST_SSP = 0.3;
const STEP_HEIGHT = 0.022; // peak foot lift; the SDK's 3 cm clearance shapes its spline tangents
const CROUCH = 0.012; // base drop below the zero pose, for bent knees
export const LATERAL_SCALE = 0.5; // SDK _get_targets(): lateral COM scale when walking straight
export const CONTROL_DT = 0.03; // SDK control period (33 Hz)

const LEG = ['hip_roll', 'hip_pitch', 'hip_yaw', 'knee', 'ankle_pitch', 'ankle_roll'];
const smoother = (s) => s * s * s * (s * (s * 6 - 15) + 10);

/* ---------------- small dense linear algebra ---------------- */

function solve6(A, b) {
  const n = 6;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

/* ---------------- leg inverse kinematics ---------------- */

const _r = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _pe = new THREE.Vector3();
const _qe = new THREE.Quaternion();
const _ep = new THREE.Vector3();
const _er = new THREE.Vector3();
const _a = new THREE.Vector3();
const _lin = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _tq = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();

export class LegIK {
  /** side: 'left' | 'right' */
  constructor(robot, side) {
    this.side = side;
    this.joints = LEG.map((n) => robot.joints.get(`${side}_${n}`));
    this.links = this.joints.map((j) =>
      new THREE.Matrix4().compose(j.body.group.position, j.body.group.quaternion, new THREE.Vector3(1, 1, 1)),
    );
    if (robot.bodies[this.joints[0].body.parent].parent !== -1) throw new Error('leg chain must start at the base body');
    this.frames = Array.from({ length: 6 }, () => new THREE.Matrix4());
    this.end = new THREE.Matrix4();
    this.sole = null;

    // Sole frame: bottom-centre of the foot meshes, rotation = identity at the zero pose.
    const zeroEnd = this.fk(new Array(6).fill(0)).clone();
    robot.root.updateMatrixWorld(true);
    const toBase = robot.model.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    for (const mesh of this.joints[5].body.meshes) {
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(g.boundingBox.clone().applyMatrix4(toBase.clone().multiply(mesh.matrixWorld)));
    }
    this.zeroSole = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
    this.footSize = new THREE.Vector2(box.max.x - box.min.x, box.max.y - box.min.y); // (width, length)
    const inv = zeroEnd.invert();
    this.sole = new THREE.Matrix4().extractRotation(inv).setPosition(this.zeroSole.clone().applyMatrix4(inv));
    // Seed on the knee-forward branch (positive knee angle on both legs); from
    // the straight, singular zero pose the solver could otherwise pick the
    // backward "bird knee" solution.
    this.q = [0, 0, 0, 0.8, 0, 0];
    this.solve(this.zeroSole.clone().setZ(this.zeroSole.z + CROUCH), IDENTITY, 80);
  }

  /** Forward kinematics in the base frame; fills this.frames (joint frames before rotation) and this.end. */
  fk(q) {
    const T = this.end.identity();
    for (let i = 0; i < 6; i++) {
      T.multiply(this.links[i]);
      this.frames[i].copy(T);
      T.multiply(_r.makeRotationAxis(this.joints[i].axis, q[i]));
    }
    if (this.sole) T.multiply(this.sole);
    return T;
  }

  /** Damped least-squares solve for a sole target in the base frame. */
  solve(targetPos, targetQuat, iterations = 16) {
    const q = this.q;
    _tp.copy(targetPos);
    _tq.copy(targetQuat);
    for (let it = 0; it < iterations; it++) {
      const end = this.fk(q);
      _pe.setFromMatrixPosition(end);
      _qe.setFromRotationMatrix(end);
      _ep.copy(_tp).sub(_pe);
      _q.copy(_tq).multiply(_qe.invert());
      if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
      _er.set(_q.x, _q.y, _q.z).multiplyScalar(2);
      if (_ep.lengthSq() < 4e-10 && _er.lengthSq() < 4e-8) break;
      const J = [];
      for (let i = 0; i < 6; i++) {
        _a.copy(this.joints[i].axis).transformDirection(this.frames[i]);
        _v.setFromMatrixPosition(this.frames[i]);
        _lin.copy(_a).cross(_v.subVectors(_pe, _v));
        J.push([_lin.x, _lin.y, _lin.z, _a.x * 0.1, _a.y * 0.1, _a.z * 0.1]);
      }
      const e = [_ep.x, _ep.y, _ep.z, _er.x * 0.1, _er.y * 0.1, _er.z * 0.1];
      const JJt = [];
      for (let r = 0; r < 6; r++) {
        const row = [];
        for (let c = 0; c < 6; c++) {
          let s = r === c ? 4e-7 : 0;
          for (let k = 0; k < 6; k++) s += J[k][r] * J[k][c];
          row.push(s);
        }
        JJt.push(row);
      }
      const y = solve6(JJt, e);
      for (let k = 0; k < 6; k++) {
        let d = 0;
        for (let r = 0; r < 6; r++) d += J[k][r] * y[r];
        q[k] += THREE.MathUtils.clamp(d, -0.3, 0.3);
        const range = this.joints[k].range;
        if (range) q[k] = THREE.MathUtils.clamp(q[k], range[0], range[1]);
      }
    }
    return q;
  }

  apply(robot) {
    this.joints.forEach((j, i) => robot.setJoint(j.name, this.q[i]));
  }
}

/* ---------------- gait generator ---------------- */

export class Gait {
  constructor(robot) {
    this.robot = robot;
    this.legs = { left: new LegIK(robot, 'left'), right: new LegIK(robot, 'right') };
    this.toThree = robot.model.quaternion.clone();
    this.invBase = this.toThree.clone().invert();
    this.soleNominal = {
      left: this.legs.left.zeroSole.clone().applyQuaternion(this.toThree),
      right: this.legs.right.zeroSole.clone().applyQuaternion(this.toThree),
    };
    this.halfSpread = Math.abs(this.soleNominal.left.x - this.soleNominal.right.x) / 2;
    this.footSize = this.legs.left.footSize;
    this.baseHeight = robot.model.position.y - CROUCH;
    // COM relative to the base origin at the zero pose (three axes), so the
    // planned COM, not the torso origin, tracks the plan.
    robot.root.updateMatrixWorld(true);
    this.comOffset = robot.centerOfMass().sub(robot.model.getWorldPosition(new THREE.Vector3()));
    this.reset();
  }

  reset() {
    this.speed = 0;
    this.targetSpeed = 0;
    this.phase = 'stand';
    this.timer = 0;
    this.firstDsp = false;
    this.stance = 'left';
    this.feet = {
      left: new THREE.Vector3(this.soleNominal.left.x, 0, this.soleNominal.left.z),
      right: new THREE.Vector3(this.soleNominal.right.x, 0, this.soleNominal.right.z),
    };
    this.swingFrom = new THREE.Vector3();
    this.swingTo = new THREE.Vector3();
    this.sspDuration = SDK_SSP;
    this.swingHeight = STEP_HEIGHT;
    this.base = new THREE.Vector3(-this.comOffset.x, this.baseHeight, -this.comOffset.z);
    this.latRaw = 0;
    this.lateral = 0;
    this.zmp = new THREE.Vector3();
    this.com = new THREE.Vector3();
    this.zmpBlend = 1;
    this.stepIndex = 0;
    this.stepLength = 0;
    this.swingProgress = 0;
    this.events = [];
  }

  timing() {
    const u = THREE.MathUtils.clamp(this.speed / MAX_SPEED, 0, 1);
    const ssp = THREE.MathUtils.lerp(SDK_SSP, FAST_SSP, Math.sqrt(u));
    return { ssp, dsp: SDK_DSP, period: ssp + SDK_DSP };
  }

  get walking() {
    return this.phase !== 'stand';
  }

  get swingSide() {
    return this.stance === 'left' ? 'right' : 'left';
  }

  update(dt) {
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 2.5);
    const { dsp, period } = this.timing();
    const wantWalk = this.targetSpeed > 0.004;
    this.events.length = 0;

    if (this.phase === 'stand' && wantWalk) {
      this.phase = 'dsp';
      this.timer = 0;
      this.firstDsp = true;
      this.stance = 'left';
      this.stepIndex = 0;
    }
    if (this.phase === 'dsp') {
      this.timer += dt;
      const dur = this.firstDsp ? dsp * 5 : dsp;
      this.zmpBlend = smoother(Math.min(1, this.timer / dur));
      if (this.timer >= dur) {
        if (!wantWalk && this.feetTogether()) this.phase = 'stand';
        else this.beginSwing();
      }
    } else if (this.phase === 'ssp') {
      this.timer += dt;
      const s = Math.min(1, this.timer / this.sspDuration);
      this.swingProgress = s;
      const f = this.feet[this.swingSide];
      const h = smoother(s);
      f.x = THREE.MathUtils.lerp(this.swingFrom.x, this.swingTo.x, h);
      f.z = THREE.MathUtils.lerp(this.swingFrom.z, this.swingTo.z, h);
      f.y = this.swingHeight * 16 * s * s * (1 - s) * (1 - s);
      if (s >= 1) {
        f.y = 0;
        const landed = this.swingSide;
        this.events.push({ type: 'land', side: landed, pos: f.clone() });
        this.stance = landed;
        this.phase = 'dsp';
        this.timer = 0;
        this.firstDsp = false;
        this.zmpBlend = 0;
        this.stepIndex++;
      }
    }

    // --- lateral COM: periodic linear-inverted-pendulum solution ---
    // tau = 0 at the middle of each double support (where the ZMP switches feet).
    const comHeight = this.baseHeight + this.comOffset.y;
    const Tc = Math.sqrt(comHeight / G);
    const lateralAt = (side, tau) => {
      const w = this.soleNominal[side].x;
      const A = w / Math.cosh(period / (2 * Tc));
      return w - A * Math.cosh((tau - period / 2) / Tc);
    };
    let lat;
    if (this.phase === 'ssp') lat = lateralAt(this.stance, dsp / 2 + this.timer);
    else if (this.phase === 'dsp') {
      const prev = this.swingSide;
      if (this.firstDsp) lat = lateralAt(this.stance, dsp / 2) * smoother(Math.min(1, this.timer / (dsp * 5)));
      else if (this.timer < dsp / 2) lat = lateralAt(prev, period - dsp / 2 + this.timer);
      else lat = lateralAt(this.stance, this.timer - dsp / 2);
    } else lat = this.latRaw * Math.exp(-dt * 6);
    this.latRaw = lat;
    this.lateral = lat * LATERAL_SCALE;

    // Forward: the SDK keeps the COM within +-2 mm of the feet midpoint.
    const mid = this.feet.left.clone().add(this.feet.right).multiplyScalar(0.5);
    this.com.set(mid.x + this.lateral, comHeight, mid.z);
    this.base.set(this.com.x - this.comOffset.x, this.baseHeight, this.com.z - this.comOffset.z);

    // ZMP reference
    if (this.phase === 'ssp') this.zmp.copy(this.feet[this.stance]);
    else if (this.phase === 'dsp') {
      const from = this.firstDsp ? mid : this.feet[this.swingSide];
      this.zmp.copy(from).lerp(this.feet[this.stance], this.zmpBlend);
    } else this.zmp.lerp(mid, Math.min(1, dt * 6));
    this.zmp.y = 0;
  }

  feetTogether() {
    return Math.abs(this.feet.left.z - this.feet.right.z) < 0.004;
  }

  beginSwing() {
    const { ssp, period } = this.timing();
    const swing = this.swingSide;
    const wantWalk = this.targetSpeed > 0.004;
    const stanceFoot = this.feet[this.stance];
    const L = wantWalk ? Math.max(0.012, this.speed * period) : 0; // body advance per step
    this.stepLength = L;
    this.swingFrom.copy(this.feet[swing]);
    this.swingTo.set(this.soleNominal[swing].x, 0, stanceFoot.z + L);
    this.sspDuration = ssp;
    this.swingHeight = wantWalk ? STEP_HEIGHT * THREE.MathUtils.lerp(0.8, 1, this.speed / MAX_SPEED) : STEP_HEIGHT * 0.6;
    this.phase = 'ssp';
    this.timer = 0;
    this.swingProgress = 0;
    this.events.push({ type: 'plan', side: swing, pos: this.swingTo.clone() });
  }

  /** Solve both legs for the current plan and write the joint angles. */
  solve(robot) {
    for (const side of ['left', 'right']) {
      _v.copy(this.feet[side]).sub(this.base).applyQuaternion(this.invBase);
      this.legs[side].solve(_v, IDENTITY);
      this.legs[side].apply(robot);
    }
  }
}
