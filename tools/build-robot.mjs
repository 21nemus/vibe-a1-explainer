// Builds web assets for the Vibe A1 explainer from the Vibe Robotics SDK
// (github.com/viberobotics/vibe_robotics_sdk, Apache-2.0) MuJoCo models.
//
//   node build-robot.mjs <path-to-sdk>
//
// Outputs into ../vibe-a1/assets/robot/:
//   parts.glb   every unique mesh once, welded + simplified + creased normals,
//               quantized and meshopt-compressed
//   robots.json kinematic trees (bodies, joints, geoms, inertials) per variant

import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, reorder, dedup, prune } from '@gltf-transform/functions';

const SDK = process.argv[2];
if (!SDK) throw new Error('usage: node build-robot.mjs <path-to-vibe_robotics_sdk>');
const MJ = path.join(SDK, 'viberobotics/assets/mujoco');
const OUT = path.resolve(import.meta.dirname, '../vibe-a1/assets/robot');
fs.mkdirSync(OUT, { recursive: true });

const VARIANTS = {
  a1: 'SundayA1_short_new', // Vibe A1 / A1 Pro: 25 DoF, gripper paws
  mini: 'SundayA1_short_mini', // Vibe A1 Mini: 19 DoF, rounded forearms
};

// Meshes that only exist as placeholders in the sim model.
const SKIP_MESHES = new Set(['internal_weight_395g__configuration_default', 'internal_weight_200g']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name, _path, _leaf, isAttribute) =>
    !isAttribute && ['body', 'geom', 'joint', 'mesh', 'material', 'position'].includes(name),
});

const vec = (s, n) => (s ? s.trim().split(/\s+/).map(Number) : new Array(n).fill(0));
// MuJoCo quats are (w x y z); store as three.js order (x y z w).
const quat = (s) => {
  if (!s) return [0, 0, 0, 1];
  const [w, x, y, z] = vec(s, 4);
  const l = Math.hypot(w, x, y, z);
  return [x / l, y / l, z / l, w / l];
};
const round = (a, d = 7) => a.map((v) => +v.toFixed(d));

function parseModel(dir) {
  const xml = parser.parse(fs.readFileSync(path.join(MJ, dir, 'robot.xml'), 'utf8')).mujoco;
  const materials = Object.fromEntries((xml.asset.material ?? []).map((m) => [m.name, vec(m.rgba, 4)]));
  const meshFiles = Object.fromEntries(
    (xml.asset.mesh ?? []).map((m) => [m.name ?? path.basename(m.file, '.stl'), m.file]),
  );
  const bodies = [];
  const walk = (b, parent) => {
    const j = b.joint?.find((jj) => (jj.type ?? 'hinge') === 'hinge');
    const inertial = b.inertial
      ? { mass: +b.inertial.mass, pos: round(vec(b.inertial.pos, 3)) }
      : { mass: 0, pos: [0, 0, 0] };
    const idx = bodies.length;
    bodies.push({
      name: b.name,
      parent,
      pos: round(vec(b.pos, 3)),
      quat: round(quat(b.quat)),
      joint: j
        ? { name: j.name, axis: round(vec(j.axis ?? '0 0 1', 3)), range: j.range ? vec(j.range, 2) : null }
        : null,
      inertial,
      geoms: (b.geom ?? [])
        .filter((g) => g.class === 'visual' && g.mesh && !SKIP_MESHES.has(g.mesh))
        .map((g) => ({
          mesh: g.mesh,
          pos: round(vec(g.pos, 3)),
          quat: round(quat(g.quat)),
          rgba: materials[g.material] ?? [1, 1, 1, 1],
        })),
    });
    for (const c of b.body ?? []) walk(c, idx);
  };
  for (const b of xml.worldbody.body) walk(b, -1);
  const actuators = (xml.actuator?.position ?? []).map((a) => a.joint);
  return { bodies, meshFiles, actuators };
}

function readSTL(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  if (84 + n * 50 !== buf.length) throw new Error(`not a binary STL: ${file}`);
  const pos = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) pos[i * 9 + k] = buf.readFloatLE(o + k * 4);
  }
  return pos;
}

async function processMesh(file) {
  const raw = readSTL(file);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(raw, 3));
  g = mergeVertices(g, 1e-6);
  const index = new Uint32Array(g.index.array);
  const positions = g.attributes.position.array;
  const triIn = index.length / 3;
  // Parts are a few cm across: 0.25% of extent keeps edges within ~0.1 mm.
  const target = Math.min(index.length, Math.max(3 * 600, Math.floor((index.length * 0.35) / 3) * 3));
  const [simplified] = MeshoptSimplifier.simplify(index, positions, 3, target, 0.0025, ['LockBorder']);
  g.setIndex(new THREE.BufferAttribute(simplified, 1));
  let flat = g.toNonIndexed();
  flat = toCreasedNormals(flat, THREE.MathUtils.degToRad(32));
  const out = mergeVertices(flat, 1e-6);
  return {
    position: new Float32Array(out.attributes.position.array),
    normal: new Float32Array(out.attributes.normal.array),
    index: new Uint32Array(out.index.array),
    triIn,
    triOut: out.index.count / 3,
  };
}

// Local-to-model transform at the zero pose, to report where each geom lands.
function zeroPoseReport(model, bounds) {
  const world = [];
  const rows = [];
  model.bodies.forEach((b, i) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...b.pos),
      new THREE.Quaternion(...b.quat),
      new THREE.Vector3(1, 1, 1),
    );
    world[i] = b.parent >= 0 ? world[b.parent].clone().multiply(m) : m;
    b.geoms.forEach((gm) => {
      const gmat = new THREE.Matrix4().compose(
        new THREE.Vector3(...gm.pos),
        new THREE.Quaternion(...gm.quat),
        new THREE.Vector3(1, 1, 1),
      );
      const c = bounds[gm.mesh].clone().applyMatrix4(world[i].clone().multiply(gmat));
      rows.push({ body: b.name, mesh: gm.mesh, center: c.toArray().map((v) => +v.toFixed(3)) });
    });
  });
  return rows;
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const models = Object.fromEntries(Object.entries(VARIANTS).map(([k, dir]) => [k, parseModel(dir)]));

// The SDK's Mini model exports both forearm geoms with model-frame (world)
// pos/quat although they sit inside the rotated tricep body. Convert them to
// body-local so the forearms hang from the elbows like on the real robot.
function bodyWorldMatrices(model) {
  const world = [];
  model.bodies.forEach((b, i) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
    world[i] = b.parent >= 0 ? world[b.parent].clone().multiply(m) : m;
  });
  return world;
}
{
  const world = bodyWorldMatrices(models.mini);
  models.mini.bodies.forEach((b, i) => {
    for (const g of b.geoms) {
      if (g.mesh !== 'forearm0227') continue;
      const desired = new THREE.Matrix4().compose(new THREE.Vector3(...g.pos), new THREE.Quaternion(...g.quat), new THREE.Vector3(1, 1, 1));
      const local = world[i].clone().invert().multiply(desired);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      local.decompose(p, q, new THREE.Vector3());
      g.pos = round(p.toArray());
      g.quat = round(q.toArray());
    }
  });
}

// Unique meshes across variants (same file name == same part).
const meshSources = new Map();
for (const [k, dir] of Object.entries(VARIANTS)) {
  for (const b of models[k].bodies)
    for (const g of b.geoms) {
      const file = path.join(MJ, dir, 'assets', models[k].meshFiles[g.mesh] ?? `${g.mesh}.stl`);
      if (!meshSources.has(g.mesh)) meshSources.set(g.mesh, file);
    }
}

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('parts');
const bounds = {};
let totalIn = 0;
let totalOut = 0;
for (const [name, file] of meshSources) {
  const m = await processMesh(file);
  totalIn += m.triIn;
  totalOut += m.triOut;
  const box = new THREE.Box3().setFromArray(m.position);
  bounds[name] = box.getCenter(new THREE.Vector3());
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(m.position).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(m.normal).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(m.index).setBuffer(buffer));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
  const size = box.getSize(new THREE.Vector3()).toArray().map((v) => (v * 1000).toFixed(1));
  console.log(`${name.padEnd(28)} ${String(m.triIn).padStart(6)} -> ${String(m.triOut).padStart(6)} tris  ${size.join(' x ')} mm`);
}
console.log(`total triangles ${totalIn} -> ${totalOut}`);

await doc.transform(dedup(), prune(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizePosition: 14, quantizeNormal: 10 }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
doc.createExtension(KHRMeshQuantization).setRequired(true);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await io.write(path.join(OUT, 'parts.glb'), doc);
console.log('parts.glb', (fs.statSync(path.join(OUT, 'parts.glb')).size / 1024).toFixed(0), 'KB');

const out = {};
for (const [k, model] of Object.entries(models)) {
  out[k] = { source: VARIANTS[k], actuators: model.actuators, bodies: model.bodies };
  const mass = model.bodies.reduce((s, b) => s + b.inertial.mass, 0);
  console.log(`\n== ${k} (${VARIANTS[k]}) bodies=${model.bodies.length} joints=${model.bodies.filter((b) => b.joint).length} mass=${mass.toFixed(3)} kg`);
  for (const r of zeroPoseReport(model, bounds)) console.log(`   ${r.body.padEnd(20)} ${r.mesh.padEnd(26)} ${r.center.join(', ')}`);
}
fs.writeFileSync(path.join(OUT, 'robots.json'), JSON.stringify(out));
console.log('robots.json', (fs.statSync(path.join(OUT, 'robots.json')).size / 1024).toFixed(1), 'KB');
