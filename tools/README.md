# Asset pipeline for `../vibe-a1`

Not deployed. Rebuilds the site's generated files.

```bash
npm install
git clone --depth 1 https://github.com/viberobotics/vibe_robotics_sdk.git /tmp/vibe-sdk
node build-robot.mjs /tmp/vibe-sdk   # -> ../vibe-a1/assets/robot/parts.glb + robots.json
node vendor-three.mjs                # -> ../vibe-a1/vendor/three (minified three.js + used addons)
node serve.mjs 5173                  # local preview at http://localhost:5173
```

- `build-robot.mjs` parses the SDK's MuJoCo models (`SundayA1_short_new` for the A1/Pro,
  `SundayA1_short_mini` for the Mini), welds and simplifies the STL meshes with meshoptimizer,
  and writes one quantized, meshopt-compressed GLB plus a JSON joint tree. It also fixes the
  Mini forearm transforms that the SDK exports in model space.
- `vendor-three.mjs` copies three.js r186 and only the addons the site imports (plus their
  relative imports), each minified with esbuild so the import graph stays intact.
- `serve.mjs` is a zero-dependency static server. It also accepts `POST /__save/assets/<file>`,
  which was used to save `assets/og-image.jpg` from the browser. Don't deploy it.
