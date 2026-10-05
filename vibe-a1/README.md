# Inside the Vibe A1

An interactive, take-apart explainer of the open-source **Vibe A1** humanoid,
built with three.js. Cut it open, follow the power and the data, make it walk,
then look inside one of its 25 servos.

This folder is the whole site: static files, no build step, no CDN.

## Run it locally

Any static file server works (ES modules don't load from `file://`):

```bash
npx serve .
```

or `python3 -m http.server 8000` from this folder, then open the printed URL.

## Deploy

Upload this folder as-is:

- **Netlify:** drag the folder onto https://app.netlify.com/drop
- **Vercel:** `npx vercel` from this folder (framework: "Other", no build command)
- **GitHub Pages / your own host:** copy the folder; all paths are relative, so a sub-path such as `/vibe-a1/` works

The repo deploys to https://21nemus.github.io/vibe-a1-explainer/ through
`.github/workflows/pages.yml` on every push to `main`. If you host it elsewhere,
change the absolute URLs in the `og:*` and `twitter:*` tags in `index.html`;
X only shows the large preview card with an absolute image URL.

## Controls

| Input | Action |
| --- | --- |
| Drag / scroll / right-drag | orbit / zoom / pan |
| `1`–`4` | Follow: All, Power, Data, Balance (robot) · All, Power, Data, Gears (servo) |
| `W` `C` `E` | Whole, Cutaway, Exploded |
| `↑` `↓` | walk speed / shaft speed |
| `Space` | guided tour (~68 s across both scenes; handy for screen-recording a post) |
| `S` | switch scene |
| Click a servo | open the servo scene |
| Hand button | Vibe's recorded wave (robot) · reset overload protection (servo) |

## What's real and what's illustrative

**Real data**

- **Geometry and joints:** every printed part and servo, plus joint axes, limits and link masses, comes from the MuJoCo models in the [Vibe Robotics SDK](https://github.com/viberobotics/vibe_robotics_sdk) (Apache-2.0), which Vibe exported from its Onshape CAD. A1/Pro use `SundayA1_short_new`; the Mini uses `SundayA1_short_mini`. The center of mass is computed live from the CAD masses.
- **Servo IDs:** the bus IDs come from Vibe's electronics guide (25-servo build).
- **Specs:** height, weight, DoF, speeds, compute, sensors and battery life come from [viberobotics.co/docs](https://www.viberobotics.co/docs).
- **Walking:** the gait mirrors the SDK walker: footstep plan, then a linear-inverted-pendulum COM with lateral scale 0.5, ZMP bounded to 80% of the stance foot, and damped least-squares IK. At the slow end its timing matches the SDK (0.7 s swing, 0.07 s double support, 3 cm steps); the top end reaches the spec sheet's 0.15 m/s (0.12 m/s for the Mini).
- **Wave:** Vibe's recorded `waving_motion.json`.
- **Bus traffic:** one sync-write and per-servo replies every 30 ms tick, slowed down, as in the SDK's motor manager.
- **Servo data:** Feetech STS3215 (19.5 kg·cm, 345:1, 52 rpm, 2.5 A stall, 12-bit encoder, 1 Mbps) and STS3250 (the leg servos) datasheet values. The packet bytes shown use the real Feetech protocol and checksum.

**Illustrative**

- **Torso layout:** where the electronics sit inside the torso. The parts are from Vibe's bill of materials, but Vibe doesn't publish the layout.
- **Servo internals:** the STS3215's internal arrangement, and the split of its 345:1 ratio into four stages. The total ratio is from the datasheet.
- **Load and current:** servo load and current in the Power view are estimates.

Note that Vibe's own docs disagree in places (23 vs 25 servos, 7.4 V vs 12 V packs, Pi 5 vs Jetson). The page follows the current CAD and spec table.

## Rebuild the assets

The robot assets are generated from the SDK by the scripts in `../tools`:

```bash
cd ../tools && npm install
node build-robot.mjs /path/to/vibe_robotics_sdk   # assets/robot/parts.glb + robots.json
node vendor-three.mjs                             # vendor/three (minified three.js r186)
```

## Credits and licenses

Made by [@21nemus](https://x.com/21nemus). The original code is MIT (see `../LICENSE`).

- **Robot CAD and motions:** Vibe Robotics SDK, Apache-2.0. See `assets/robot/NOTICE.md` and `assets/robot/LICENSE-vibe-robotics-sdk.txt`.
- **three.js:** MIT, `vendor/three/LICENSE`.
- **Fonts:** Outfit and JetBrains Mono, SIL OFL 1.1, `assets/fonts/OFL-*.txt`.

This is an independent explainer and is not affiliated with Vibe Robotics. Vibe A1 is a trademark of Vibe Robotics Technologies Inc.
