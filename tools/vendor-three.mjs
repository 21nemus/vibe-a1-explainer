// Copies the three.js build plus only the addons the site imports (and their
// relative dependencies) into ../vibe-a1/vendor/three, so the site has no CDN
// dependency. Run after changing the addon list.

import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

const SRC = path.resolve(import.meta.dirname, 'node_modules/three');
const DST = path.resolve(import.meta.dirname, '../vibe-a1/vendor/three');

const ADDONS = [
  'controls/OrbitControls.js',
  'loaders/GLTFLoader.js',
  'libs/meshopt_decoder.module.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/ShaderPass.js',
  'geometries/RoundedBoxGeometry.js',
];

fs.rmSync(DST, { recursive: true, force: true });
// Each file is minified on its own so relative ES module imports stay intact.
const minify = (code) => transformSync(code, { minify: true, format: 'esm', legalComments: 'inline' }).code;
fs.mkdirSync(path.join(DST, 'build'), { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) {
  fs.writeFileSync(path.join(DST, 'build', f), minify(fs.readFileSync(path.join(SRC, 'build', f), 'utf8')));
}
fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(DST, 'LICENSE'));

const seen = new Set();
const copy = (rel) => {
  if (seen.has(rel)) return;
  seen.add(rel);
  const from = path.join(SRC, 'examples/jsm', rel);
  const to = path.join(DST, 'addons', rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const code = fs.readFileSync(from, 'utf8');
  fs.writeFileSync(to, minify(code));
  for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    copy(path.normalize(path.join(path.dirname(rel), m[1])));
  }
};
ADDONS.forEach(copy);

const size = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => {
    const p = path.join(dir, e.name);
    return s + (e.isDirectory() ? size(p) : fs.statSync(p).size);
  }, 0);
console.log(`vendored ${seen.size} addon files, ${(size(DST) / 1024).toFixed(0)} KB total`);
console.log([...seen].sort().join('\n'));
