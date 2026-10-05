# Robot geometry: source and modifications

`parts.glb` and `robots.json` are derived from the **Vibe Robotics SDK**
(https://github.com/viberobotics/vibe_robotics_sdk, commit `4c29bee`),
Copyright 2026 Vibe Robotics Technologies Inc., licensed under the Apache
License 2.0 (see `LICENSE-vibe-robotics-sdk.txt`). "Vibe Robotics", "Vibe A1"
and "Sunday A1" are trademarks of Vibe Robotics Technologies Inc.

Source models: `viberobotics/assets/mujoco/SundayA1_short_new` (Vibe A1 / A1 Pro)
and `viberobotics/assets/mujoco/SundayA1_short_mini` (Vibe A1 Mini), exported
by Vibe from Onshape with onshape-to-robot.

Changes made by `tools/build-robot.mjs`:

- STL meshes welded, simplified with meshoptimizer (about 400k to 140k
  triangles), given creased normals, quantized and meshopt-compressed into one GLB.
- MJCF body/joint/geom/inertial data converted to JSON; the sim-only
  `internal_weight` placeholder geoms were dropped.
- The Mini's two `forearm0227` geoms are exported in the SDK with model-frame
  coordinates inside a rotated body; they were converted to body-local
  coordinates so the forearms hang from the elbows.

`../motions/wave.json` holds the right-arm channels of the SDK's
`waving_motion.json`, re-keyed by joint name.
