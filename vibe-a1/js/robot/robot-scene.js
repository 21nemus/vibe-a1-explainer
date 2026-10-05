// Scene 1: the Vibe A1 on a walk-test treadmill.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LabelLayer } from '../core/labels.js';
import { parkedPlane, createRobotMaterials, setCap, highlightTwin, PARKED } from '../core/materials.js';
import { damp, ease, Tweens, clamp, isSmallScreen } from '../core/util.js';
import { Robot, SERVO_MESHES, jointLabel } from './model.js';
import { Gait } from './gait.js';
import { buildSet, BELT } from './set.js';
import { buildInternals, makeWebcam } from './internals.js';
import { Wiring, makeGlow } from './wiring.js';
import { BalanceOverlay } from './overlay.js';
import { ROBOT, VARIANTS } from '../content.js';

const CUT_COLOR = 0xff9d4d;
const HOT_COLOR = 0xffa45c;

const VIEWS = {
  whole: { pos: [0.98, 0.44, 1.5], target: [0, 0.3, 0] },
  cutaway: { pos: [0.56, 0.6, 1.12], target: [0, 0.36, 0.02] },
  exploded: { pos: [0.66, 0.8, 1.78], target: [0, 0.5, 0.04] },
  balance: { pos: [0.98, 1.08, 1.42], target: [0, 0.17, 0.02] },
  data: { pos: [-0.9, 0.66, 1.18], target: [0, 0.29, 0] },
  power: { pos: [-0.9, 0.66, 1.18], target: [0, 0.29, 0] },
};
const MOBILE_SCALE = 1.5;

export class RobotScene {
  constructor(app, assets, labelsEl, env) {
    this.app = app;
    this.name = 'robot';
    this.scene = new THREE.Scene();
    this.scene.environment = env;
    this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.02, 60);
    this.controls = new OrbitControls(this.camera, app.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.07,
      minDistance: 0.35,
      maxDistance: 3.4,
      maxPolarAngle: 1.5,
      rotateSpeed: 0.7,
      zoomSpeed: 0.8,
      panSpeed: 0.6,
    });
    this.labels = new LabelLayer(labelsEl);
    this.tweens = new Tweens();
    this.set = buildSet(this.scene, app.quality);

    // belt frame: everything that walks lives here
    this.belt = new THREE.Group();
    this.belt.position.y = BELT.top;
    this.scene.add(this.belt);
    this.beltZ = 0;
    this.distance = 0;

    this.state = { variant: 'a1', follow: 'all', view: 'whole', speed: 0 };
    this.instances = {};
    for (const key of ['a1', 'mini']) this.instances[key] = this.buildInstance(assets, key);
    this.instances.mini.root.visible = false;
    this.instances.mini.overlay.group.visible = false;
    this.instances.mini.wiring.setVisible(0);
    this.active = this.instances.a1;
    this.applyVariantDetails();

    // print-head line for variant transitions
    this.printLine = makeGlow(new THREE.Color(HOT_COLOR).multiplyScalar(2), 0.6);
    this.printLine.scale.set(0.55, 0.012, 1);
    this.printLine.visible = false;
    this.belt.add(this.printLine);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(9, 9);
    this.hovered = null;
    this.headTarget = 0;
    this.wave = null;
    this.time = 0;
    this.setCamera('whole', 0);
  }

  /* ---------------------------------------------------------------- build */

  buildInstance(assets, key) {
    const cutPlane = parkedPlane(new THREE.Vector3(0, 0, -1));
    const printPlane = parkedPlane(new THREE.Vector3(0, -1, 0));
    const mats = createRobotMaterials({ cutPlane, printPlane });
    const robot = new Robot(assets, key, mats);
    this.belt.add(robot.root);
    const torso = robot.bodies[0].jointGroup;

    const internals = buildInternals(key, [printPlane]);
    torso.add(internals.group);
    const work = new THREE.PointLight(0xdfe8ff, 0, 0.32, 2);
    work.position.set(0, 0.16, 0.07); // torso frame: in front of the electronics
    torso.add(work);
    internals.light = work;
    internals.group.visible = false;
    for (const m of internals.group.children) m.userData.base = m.position.clone();

    // head camera: RealSense (Pro) or a small USB webcam (A1, Mini)
    robot.root.updateMatrixWorld(true);
    const rs = robot.meshes.find((m) => m.userData.mesh === 'realsense_d435i');
    const headJoint = robot.joints.get('head_yaw').group;
    const webcam = makeWebcam([printPlane]);
    const c = rs.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(rs.matrixWorld);
    webcam.position.copy(c).add(new THREE.Vector3(0, -0.006, 0.004));
    webcam.rotation.x = Math.PI / 2;
    robot.root.add(webcam);
    webcam.updateMatrixWorld(true);
    headJoint.attach(webcam);

    const gait = new Gait(robot);
    const wiring = new Wiring(robot, internals, this.scene, [printPlane]);
    const overlay = new BalanceOverlay(gait, robot);
    this.belt.add(overlay.group);

    const inst = { key, robot, root: robot.root, mats, cutPlane, printPlane, internals, gait, wiring, overlay, rs, webcam, prevAngles: new Map(), vel: new Map() };
    this.prepareExplode(inst);
    this.buildLabels(inst);
    inst.counts = {
      printed: robot.meshes.filter((m) => !SERVO_MESHES.has(m.userData.mesh) && !/realsense|max4466/.test(m.userData.mesh)).length,
      servos: robot.servoCount,
    };
    gait.solve(robot);
    return inst;
  }

  prepareExplode(inst) {
    // Offsets are computed in world space when the explode starts (see computeExplode).
    inst.explode = 0;
    inst.explodeReady = false;
    inst.torsoLift = new THREE.Vector3();
    const chains = {
      arm: ['shoulder_pitch', 'shoulder_roll', 'shoulder_yaw', 'elbow_pitch', 'wrist_yaw', 'hand'],
      leg: ['hip_roll', 'hip_pitch', 'hip_yaw', 'knee', 'ankle_pitch', 'ankle_roll'],
    };
    for (const b of inst.robot.bodies) {
      b.limb = null;
      b.depth = 0;
      b.explodeDelta = new THREE.Vector3();
    }
    for (const [limb, names] of Object.entries(chains))
      for (const side of ['left', 'right'])
        names.forEach((n, i) => {
          const j = inst.robot.joints.get(`${side}_${n}`);
          if (!j) return;
          j.body.limb = limb;
          j.body.depth = i + 1;
        });
    const head = inst.robot.joints.get('head_yaw');
    if (head) {
      head.body.limb = 'head';
      head.body.depth = 1;
    }
  }

  /** World-space exploded layout, converted to local deltas at the current (standing) pose. */
  computeExplode(inst) {
    const { robot, internals } = inst;
    robot.root.updateMatrixWorld(true);
    const lift = 0.2;
    inst.torsoLift.set(0, lift, 0);
    const desired = new Map(); // body -> world offset
    const worldPos = (o) => o.getWorldPosition(new THREE.Vector3());
    for (const b of robot.bodies) {
      if (b.parent < 0) continue;
      const c = worldPos(b.jointGroup);
      const side = Math.sign(c.x) || 1;
      const d = b.depth;
      let off;
      if (b.limb === 'leg') off = new THREE.Vector3(side * (0.012 + 0.006 * (6 - d)), (6 - d) * 0.034, 0);
      else if (b.limb === 'arm') off = new THREE.Vector3(side * (0.055 + 0.014 * d), lift - 0.024 * d, 0);
      else if (b.limb === 'head') off = new THREE.Vector3(0, lift + 0.075, 0);
      else off = new THREE.Vector3(0, lift, 0);
      desired.set(b, off);
    }
    // local deltas: child offset minus parent offset, expressed in the parent joint frame
    const q = new THREE.Quaternion();
    for (const b of robot.bodies) {
      if (b.parent < 0) continue;
      const parent = robot.bodies[b.parent];
      const parentOff = parent.parent < 0 ? inst.torsoLift : desired.get(parent);
      const delta = desired.get(b).clone().sub(parentOff);
      parent.jointGroup.getWorldQuaternion(q).invert();
      b.explodeDelta.copy(delta.applyQuaternion(q));
    }
    // parts within each body: pull the servo and the brackets a little apart
    for (const b of robot.bodies) {
      const centroid = new THREE.Vector3();
      for (const m of b.meshes) centroid.add(m.userData.holderBase);
      centroid.divideScalar(Math.max(1, b.meshes.length));
      b.jointGroup.getWorldQuaternion(q).invert();
      for (const m of b.meshes) {
        const name = m.userData.mesh;
        let delta;
        if (b.parent < 0) {
          let w = new THREE.Vector3();
          if (/^(torso|back_cover)/.test(name)) w.set(0, 0.03, -0.17);
          else if (/^leg_/.test(name)) w.set(0, -0.03, 0);
          delta = w.applyQuaternion(q);
        } else {
          const d = m.userData.holderBase.clone().sub(centroid);
          delta = b.meshes.length > 1 && d.lengthSq() > 1e-10 ? d.normalize().multiplyScalar(0.014) : new THREE.Vector3();
        }
        m.userData.explodeHolder = m.userData.holderBase.clone().add(delta);
      }
    }
    // electronics fan out in front of the chest (world offsets from each part's rest position)
    const fan = {
      compute: [0, 0.03, 0.2],
      battery: [0, -0.05, 0.16],
      adapter: [0, 0.0, 0.12],
      imu: [0, -0.1, 0.13],
      speaker: [0.0, 0.08, 0.14],
      buck: [0, -0.02, 0.09],
      bank: [0, -0.02, 0.2],
    };
    const ig = internals.group;
    for (const p of internals.parts) {
      const key = p.userData.info.key;
      const rest = p.userData.base.clone();
      const restWorld = ig.localToWorld(rest.clone());
      const off = new THREE.Vector3(...(fan[key] ?? [0, 0, 0.12]));
      if (key === 'adapter' || key === 'buck') off.x = Math.sign(restWorld.x - worldPos(robot.model).x) * 0.09;
      if (key === 'battery') off.y += (p.userData.base.y - 64) * 0.0012;
      if (key === 'speaker') off.x = -0.11;
      p.userData.explode = ig.worldToLocal(restWorld.add(off));
    }
    inst.explodeReady = true;
  }

  buildLabels(inst) {
    const L = this.labels;
    const { robot, internals, overlay, key } = inst;
    const g = (name) => `${key}:${name}`;
    const center = (mesh) => () => mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);

    // exploded: a curated label per part type, on the robot's right side (screen left)
    const CURATED = ['Head frame', 'Torso shell', 'Shoulder bracket', 'Upper arm', 'Elbow bracket', 'Forearm', 'Gripper paw', 'Gripper thumb', 'Hip bracket', 'Thigh', 'Knee bracket', 'Shin', 'Ankle bracket', 'Foot', 'STS3215 servo', 'STS3250 servo'];
    const seen = new Set();
    for (const m of robot.meshes) {
      const info = m.userData.info;
      if (!CURATED.includes(info.name) || seen.has(info.name)) continue;
      const wc = m.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
      const central = /^(Head|Torso)/.test(info.name);
      if (!central && wc.x > 0) continue; // robot's right side is -x
      seen.add(info.name);
      const servo = SERVO_MESHES.has(m.userData.mesh);
      L.add(center(m), {
        text: info.name,
        sub: servo ? info.note : 'printed',
        color: servo ? '#9fb0c8' : '#f2f0eb',
        group: g('parts'),
        small: true,
        offset: central ? [110, -10] : [servo ? -120 : -80, 0],
      });
    }
    // cutaway / internals
    const seenInt = new Set();
    const OFFSETS = { compute: [-150, -70], battery: [-140, 46], imu: [70, 64], speaker: [150, -40], buck: [0, 0], bank: [140, 40] };
    for (const p of internals.parts) {
      const info = p.userData.info;
      if (seenInt.has(info.name) || info.key === 'buck') continue;
      seenInt.add(info.name);
      const color = info.key === 'battery' ? '#ffb547' : info.key === 'compute' ? '#76e0ff' : info.key === 'adapter' ? '#4fd8ff' : '#c7cfdd';
      let off = OFFSETS[info.key] ?? [0, 0];
      if (info.key === 'adapter') off = [p.position.x > 0 ? -170 : 170, -10];
      const at = () => p.getWorldPosition(new THREE.Vector3());
      L.add(at, { text: info.name, sub: info.note, color, group: g('internals'), offset: off });
      L.add(at, { text: info.name, sub: info.note, color, group: g('parts-int'), small: true, offset: [120, 0] });
    }
    const head = robot.servos.find((s) => s.joint === 'head_yaw');
    if (head) L.add(() => this.servoCenter(head), { text: 'Neck servo', sub: 'head yaw', color: '#9fb0c8', group: g('internals'), small: true, offset: [110, -36] });
    L.add(() => inst.webcam.getWorldPosition(new THREE.Vector3()), { text: 'Web camera', sub: 'USB', color: '#c7cfdd', group: g('cam-web'), small: true });
    L.add(() => inst.rs.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(inst.rs.matrixWorld), { text: 'RealSense D435i', sub: 'depth + IMU', color: '#c7cfdd', group: g('cam-rs'), small: true });

    // data: servo IDs (documented for the 25-servo build) or joint names
    inst.idLabels = new Map();
    for (const s of robot.servos) {
      const text = key === 'a1' && s.id ? `ID ${s.id}` : jointLabel(s.joint);
      const item = L.add(() => this.servoCenter(s), { text, color: '#4fd8ff', group: g('ids'), tiny: true });
      inst.idLabels.set(s, item);
    }
    // power
    for (const b of internals.anchors.batteries) {
      L.add(() => b.getWorldPosition(new THREE.Vector3()), { text: 'Battery', sub: key === 'mini' ? '12 V' : '7.4 V', color: '#ffb547', group: g('power') });
      break;
    }
    const legChain = inst.wiring.chains.find((c) => c.name === 'left leg');
    if (legChain) L.add(() => this.servoCenter(legChain.servos[3]), { text: 'Knee servo', sub: 'STS3250', color: '#ffb547', group: g('power'), small: true });
    // balance
    L.add(overlay.anchors.com, { text: 'Center of mass', color: '#5cf2b0', group: g('balance'), offset: [0, -16] });
    L.add(overlay.anchors.zmp, { text: 'Zero-moment point', color: '#ff6b9a', group: g('balance'), offset: [0, 18] });
    inst.nextLabel = L.add(overlay.anchors.next, { text: 'Next step', sub: '', color: '#dfe8ff', group: g('balance-walk'), small: true });
  }

  servoCenter(s) {
    return s.center.clone().applyMatrix4(s.mesh.matrixWorld);
  }

  /* ---------------------------------------------------------------- UI hooks */

  get config() {
    const v = VARIANTS[this.state.variant];
    return {
      eyebrow: ROBOT.eyebrow,
      pre: ROBOT.pre,
      title: v.name,
      lede: ROBOT.lede(v),
      followLabel: 'Follow',
      follow: ROBOT.follow,
      sliderLabel: 'Walk speed',
      variantLabel: 'Model',
      variants: [
        { key: 'mini', label: 'Mini' },
        { key: 'a1', label: 'A1' },
        { key: 'pro', label: 'Pro' },
      ],
      viewLabel: 'View',
      views: ROBOT.views,
      action: { title: 'Wave (recorded motion from Vibe)', icon: 'wave' },
    };
  }

  get variant() {
    return VARIANTS[this.state.variant];
  }

  hud() {
    const v = this.variant;
    const g = this.active.gait;
    const speed = g.walking ? g.speed : 0;
    return {
      stats: ROBOT.stats(v, speed),
      card: ROBOT.card({ v, follow: this.state.follow, view: this.state.view, speed, walking: g.walking && g.targetSpeed > 0, counts: this.active.counts }),
      cardKey: [this.state.variant, this.state.follow, this.state.view, g.walking && g.targetSpeed > 0].join('|'),
      sliderText: `${(this.state.speed * v.speed).toFixed(2)} m/s`,
      title: v.name,
      lede: ROBOT.lede(v),
    };
  }

  setFollow(key) {
    this.state.follow = key;
    if (this.state.view === 'exploded' && key !== 'all') this.setView('whole', false);
    if (key === 'balance' || key === 'data' || key === 'power') this.setCamera(key);
    else this.setCamera(this.state.view);
  }

  setSlider(u) {
    this.state.speed = u;
    if (u > 0 && this.state.view === 'exploded') this.setView('whole', false);
  }

  setView(key, moveCamera = true) {
    const prev = this.state.view;
    this.state.view = key;
    if (key === 'exploded' && this.state.follow !== 'all') this.state.follow = 'all';
    if (moveCamera) this.setCamera(key === 'whole' && this.state.follow !== 'all' ? this.state.follow : key);
    if (key === 'exploded') this.state.speed = 0;
    return prev;
  }

  setVariant(key) {
    if (!VARIANTS[key] || key === this.state.variant) return;
    const from = this.instances[VARIANTS[this.state.variant].model];
    this.state.variant = key;
    const to = this.instances[VARIANTS[key].model];
    if (from !== to) this.printTransition(from, to);
    else this.headSwap();
    this.applyVariantDetails();
  }

  applyVariantDetails() {
    const pro = this.state.variant === 'pro';
    for (const inst of Object.values(this.instances)) {
      inst.rs.visible = pro && inst.key === 'a1';
      inst.webcam.visible = !(pro && inst.key === 'a1');
    }
  }

  headSwap() {
    // quick scan across the head when swapping cameras
    const inst = this.active;
    const head = inst.robot.joints.get('head_yaw').group;
    const box = new THREE.Box3().setFromObject(head);
    const p = inst.printPlane;
    setCap(inst.mats.list, HOT_COLOR, 2.4);
    this.tweens.to('headscan', {
      from: 0,
      to: 1,
      duration: 0.7,
      easing: ease.inOutSine,
      onUpdate: (k) => {
        p.normal.set(0, -1, 0);
        p.constant = THREE.MathUtils.lerp(box.min.y, box.max.y + 0.01, k);
        if (k < 0.02) p.constant = box.min.y;
      },
      onDone: () => {
        p.constant = PARKED;
        setCap(inst.mats.list, CUT_COLOR, 1.4);
      },
    });
  }

  printTransition(from, to) {
    // stand both robots, then "re-print" from the bed up
    to.gait.reset();
    to.gait.solve(to.robot);
    from.gait.targetSpeed = 0;
    to.root.visible = true;
    this.active = to;
    to.overlay.clear();
    const H = Math.max(from.robot.height, to.robot.height) + 0.03 + from.explode * 0.32;
    setCap(from.mats.list, HOT_COLOR, 2.6);
    setCap(to.mats.list, HOT_COLOR, 2.6);
    from.printPlane.normal.set(0, 1, 0);
    to.printPlane.normal.set(0, -1, 0);
    this.printLine.visible = true;
    const beltY = BELT.top;
    this.transitioning = true;
    this.tweens.to('print', {
      from: 0,
      to: 1,
      duration: 1.6,
      easing: ease.inOutSine,
      onUpdate: (k) => {
        const h = beltY + k * H;
        from.printPlane.constant = -h;
        to.printPlane.constant = h;
        this.printLine.position.set(0, h - beltY, to.gait.base.z);
        this.printLine.material.opacity = Math.sin(k * Math.PI) * 0.9 + 0.1;
      },
      onDone: () => {
        from.root.visible = false;
        from.wiring.setVisible(0);
        from.overlay.group.visible = false;
        from.overlay.amount = 0;
        from.printPlane.constant = PARKED;
        to.printPlane.constant = PARKED;
        setCap(from.mats.list, CUT_COLOR, 1.4);
        setCap(to.mats.list, CUT_COLOR, 1.4);
        this.printLine.visible = false;
        this.transitioning = false;
      },
    });
    to.wiring.setVisible(1);
    // carry the explode / cutaway state over instantly
    to.explode = from.explode;
  }

  action() {
    if (this.wave || this.transitioning) return;
    this.state.speed = 0;
    this.waitWave = true;
  }

  startWave() {
    const frames = this.app.assets.wave.frames;
    this.wave = { t: 0, frames, i: 0, from: {}, to: frames[0].q };
  }

  setCamera(key, duration = 1.4) {
    const v = VIEWS[key] ?? VIEWS.whole;
    const scale = isSmallScreen() ? MOBILE_SCALE : 1;
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
    // travel on a gentle arc around the target
    this.tweens.to('camera', {
      from: 0,
      to: 1,
      duration,
      easing: ease.inOutCubic,
      onUpdate: (k) => {
        this.controls.target.lerpVectors(t0, target, k);
        const a = p0.clone().sub(t0);
        const b = pos.clone().sub(target);
        const sa = new THREE.Spherical().setFromVector3(a);
        const sb = new THREE.Spherical().setFromVector3(b);
        let dTheta = sb.theta - sa.theta;
        if (dTheta > Math.PI) dTheta -= Math.PI * 2;
        if (dTheta < -Math.PI) dTheta += Math.PI * 2;
        const s = new THREE.Spherical(
          THREE.MathUtils.lerp(sa.radius, sb.radius, k),
          THREE.MathUtils.lerp(sa.phi, sb.phi, k),
          sa.theta + dTheta * k,
        );
        this.camera.position.setFromSpherical(s).add(this.controls.target);
      },
    });
  }

  cameraIdle() {
    return !this.tweens.has('camera');
  }

  /* ---------------------------------------------------------------- picking */

  pick() {
    if (this.pointer.x > 2) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const inst = this.active;
    const targets = [...inst.robot.meshes];
    if (inst.internals.group.visible) inst.internals.group.traverse((o) => o.isMesh && targets.push(o));
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      const planes = h.object.material.clippingPlanes ?? [];
      if (planes.some((p) => p.distanceToPoint(h.point) < 0)) continue;
      if (!h.object.visible || !visibleUp(h.object)) continue;
      return h.object;
    }
    return null;
  }

  hover() {
    const obj = this.pick();
    if (obj === this.hovered) return this.tooltip(obj);
    if (this.hovered) unhighlight(this.hovered);
    this.hovered = obj;
    if (obj) highlight(obj);
    return this.tooltip(obj);
  }

  tooltip(obj) {
    if (!obj) return null;
    const d = obj.userData;
    if (d.kind === 'robot-part') {
      const s = d.servo;
      if (s) {
        const id = this.active.key === 'a1' && s.id ? ` · ID ${s.id}` : '';
        return { title: d.info.name, sub: `${jointLabel(s.joint)}${id} · click to look inside`, file: d.info.file };
      }
      return { title: d.info.name, sub: d.info.note, file: `${d.info.file}.stl` };
    }
    if (d.kind === 'internal') return { title: d.info.name, sub: d.info.note, file: 'illustrative' };
    return null;
  }

  click() {
    const obj = this.pick();
    if (obj?.userData.servo) return { goto: 'servo', servo: obj.userData.servo, mesh: obj.userData.mesh };
    return null;
  }

  /* ---------------------------------------------------------------- update */

  update(dt, time) {
    this.time = time;
    this.tweens.update(dt);
    const inst = this.active;
    const { robot, gait, wiring, overlay, internals } = inst;
    const v = this.variant;
    const view = this.state.view;

    // walking
    let target = this.state.speed * v.speed;
    if (view === 'exploded' || this.transitioning || this.wave || this.waitWave) target = 0;
    gait.targetSpeed = target;
    gait.update(dt);
    if (this.waitWave && !gait.walking) {
      this.waitWave = false;
      this.startWave();
    }

    // treadmill: keep the robot centred
    const baseWorldZ = this.beltZ + gait.base.z;
    const beltSpeed = gait.walking ? gait.speed + clamp(baseWorldZ - 0.02, -0.2, 0.2) * 1.2 : 0;
    this.beltZ -= beltSpeed * dt;
    this.distance += Math.max(0, beltSpeed) * dt;
    this.belt.position.z = this.beltZ;
    this.set.update(dt, gait.walking ? gait.speed : 0, -this.beltZ, this.distance);
    // the robot and overlay ride the belt frame
    robot.model.position.copy(gait.base);

    // joints: legs from IK, arms swing, head follows the pointer
    gait.solve(robot);
    this.updateUpperBody(dt, inst);
    robot.root.updateMatrixWorld(true);

    // explode
    const ex = view === 'exploded' ? 1 : 0;
    inst.explode = damp(inst.explode, ex, 3.2, dt);
    this.applyExplode(inst);
    robot.root.updateMatrixWorld(true);

    // cutaway plane (world): remove the front of the shells
    const follow0 = this.state.follow;
    const cutAmt = view === 'cutaway' || (view === 'whole' && (follow0 === 'power' || follow0 === 'data')) ? 1 : 0;
    inst.cut = damp(inst.cut ?? 0, cutAmt, 4, dt);
    const torsoZ = robot.bodies[0].jointGroup.getWorldPosition(new THREE.Vector3()).z + 0.047;
    if (inst.cut > 0.01) inst.cutPlane.constant = THREE.MathUtils.lerp(torsoZ + 0.2, torsoZ + 0.006, ease.outCubic(inst.cut));
    else inst.cutPlane.constant = PARKED;
    internals.group.visible = inst.cut > 0.01 || inst.explode > 0.01;
    internals.light.intensity = inst.cut * 0.008; // physical units: ~key-light illuminance at 8 cm
    for (const f of internals.fans) f.rotation.z += dt * 22;
    for (const [i, l] of internals.leds.entries()) l.visible = Math.sin(time * (3 + i) + i) > -0.6;

    // wiring + flows
    const follow = view === 'exploded' ? 'all' : this.state.follow;
    wiring.setVisible(inst.explode < 0.05 ? 1 : 0);
    if (inst.explode < 0.05) wiring.update(dt, time, follow, (s) => this.servoLoad(inst, s), (s, kind) => this.onAddress(inst, s, kind));

    // balance overlay
    overlay.update(dt, follow === 'balance' ? 1 : 0);

    // labels
    this.updateLabels(inst, follow);
  }

  updateUpperBody(dt, inst) {
    const { robot, gait } = inst;
    const swing = gait.walking ? Math.min(1, gait.speed / 0.15) : 0;
    let phase = 0;
    if (gait.phase === 'ssp') phase = (gait.swingSide === 'right' ? 1 : -1) * Math.sin(gait.swingProgress * Math.PI);
    inst.armPhase = damp(inst.armPhase ?? 0, phase * swing, 8, dt);
    const pose = {};
    if (this.wave) {
      this.updateWave(dt, pose);
    } else {
      pose.right_shoulder_pitch = inst.armPhase * 0.28;
      pose.left_shoulder_pitch = inst.armPhase * 0.28;
      pose.right_shoulder_roll = -0.06 * swing;
      pose.left_shoulder_roll = 0.06 * swing;
    }
    // head looks toward the pointer
    this.headAngle = damp(this.headAngle ?? 0, this.headTarget, 3, dt);
    pose.head_yaw = this.headAngle;
    robot.setPose(pose);
  }

  updateWave(dt, pose) {
    const w = this.wave;
    const robot = this.active.robot;
    const move = 0.42;
    const hold = 0.22;
    w.t += dt;
    if (w.i === 0 && !w.started) {
      w.started = true;
      for (const k in w.frames[0].q) w.from[k] = robot.joints.get(k)?.angle ?? 0;
    }
    const k = Math.min(1, w.t / move);
    const e = ease.inOutCubic(k);
    const to = w.frames[w.i].q;
    for (const j in to) pose[j] = THREE.MathUtils.lerp(w.from[j] ?? 0, to[j], e);
    if (w.t >= move + hold) {
      w.i++;
      w.t = 0;
      if (w.i >= w.frames.length) {
        this.wave = null;
        return;
      }
      for (const j in to) w.from[j] = to[j];
    }
  }

  servoLoad(inst, s) {
    const { gait } = inst;
    const j = s.joint;
    const leg = /hip|knee|ankle/.test(j);
    const side = j.startsWith('left') ? 'left' : 'right';
    let base = leg ? 0.35 : 0.1;
    if (leg && gait.walking) base = gait.phase === 'ssp' ? (side === gait.stance ? 0.9 : 0.25) : 0.6;
    if (leg && /knee|hip_roll/.test(j)) base *= 1.15;
    const ang = inst.robot.joints.get(j)?.angle ?? 0;
    const prev = inst.prevAngles.get(j) ?? ang;
    inst.prevAngles.set(j, ang);
    const vel = Math.abs(ang - prev) * 60;
    return clamp(base + vel * 0.1, 0, 1);
  }

  onAddress(inst, s, kind) {
    const item = inst.idLabels.get(s);
    if (!item) return;
    item.el.style.setProperty('--c', kind === 'read' ? '#b48cff' : '#4fd8ff');
    item.flash(320);
  }

  applyExplode(inst) {
    const e = ease.inOutCubic(clamp(inst.explode, 0, 1));
    const { robot, internals } = inst;
    if (e <= 0.0001) {
      if (inst.explodeReady) {
        for (const b of robot.bodies) b.group.position.copy(b.basePos);
        for (const m of robot.meshes) m.userData.holder.position.copy(m.userData.holderBase);
        for (const p of internals.parts) p.position.copy(p.userData.base);
        inst.explodeReady = false;
      }
      return;
    }
    if (!inst.explodeReady) this.computeExplode(inst);
    for (const b of robot.bodies) if (b.parent >= 0) b.group.position.copy(b.basePos).addScaledVector(b.explodeDelta, e);
    for (const m of robot.meshes) m.userData.holder.position.lerpVectors(m.userData.holderBase, m.userData.explodeHolder, e);
    for (const p of internals.parts) p.position.lerpVectors(p.userData.base, p.userData.explode, e);
    robot.model.position.addScaledVector(inst.torsoLift, e);
  }

  updateLabels(inst, follow) {
    const k = inst.key;
    const view = this.state.view;
    const groups = [];
    if (inst.explode > 0.6) groups.push(`${k}:parts`, `${k}:parts-int`);
    else if (inst.explode < 0.05) {
      if (view === 'cutaway' && follow === 'all' && inst.cut > 0.6) {
        groups.push(`${k}:internals`);
        groups.push(inst.rs.visible ? `${k}:cam-rs` : `${k}:cam-web`);
      }
      if (follow === 'data') groups.push(`${k}:ids`);
      if (follow === 'power') groups.push(`${k}:power`);
      if (follow === 'balance') {
        groups.push(`${k}:balance`);
        if (inst.gait.phase === 'ssp') groups.push(`${k}:balance-walk`);
      }
    }
    if (this.transitioning) groups.length = 0;
    this.labels.only(groups);
    if (inst.nextLabel) inst.nextLabel.setSub(`${(inst.gait.stepLength * 200).toFixed(1)} cm stride`);
    this.labels.update(this.camera, innerWidth, innerHeight);
  }

  onPointerMove(x, y) {
    this.pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    // head yaw toward the pointer, in the robot's frame (robot faces +z)
    this.headTarget = clamp(-this.pointer.x * 0.55, -0.6, 0.6) * (this.camera.position.z > 0 ? 1 : -1);
  }

  onPointerLeave() {
    this.pointer.set(9, 9);
    this.headTarget = 0;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // phones: push the subject up into the space between the title and the docked controls
    if (w < 860) this.camera.setViewOffset(w, h, 0, h * 0.11, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Scripted tour for the play button: robot, then one of its servos (~68 s). */
  tour() {
    return [
      { t: 0, ui: { variant: 'a1', view: 'whole', follow: 'all', slider: 0 }, do: () => this.setCamera('whole') },
      { t: 2.5, ui: { slider: 1 } },
      { t: 6, ui: { follow: 'balance' } },
      { t: 12, ui: { follow: 'power' } },
      { t: 16.5, ui: { follow: 'data' } },
      { t: 21.5, ui: { follow: 'all', slider: 0, view: 'cutaway' } },
      { t: 27, ui: { view: 'exploded' } },
      { t: 32, ui: { view: 'whole', variant: 'mini' } },
      { t: 35, ui: { variant: 'pro' } },
      { t: 38, ui: { action: true } },
      { t: 43, ui: { scene: 'servo' } },
      { t: 44.5, ui: { variant: 'sweep', slider: 0.8, view: 'cutaway', follow: 'gears' } },
      { t: 50, ui: { follow: 'data' } },
      { t: 54.5, ui: { follow: 'all', view: 'exploded' } },
      { t: 59, ui: { view: 'whole', variant: 'overload' } },
      { t: 68, end: true },
    ];
  }
}

function visibleUp(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function highlight(mesh) {
  mesh.userData.baseMaterial = mesh.material;
  if (mesh.material.userData?.u) mesh.material = highlightTwin(mesh.material);
}

function unhighlight(mesh) {
  if (mesh.userData.baseMaterial) mesh.material = mesh.userData.baseMaterial;
}

