// All on-screen copy and spec numbers, with sources.
//   Vibe docs:   viberobotics.co/docs (spec tables, parts list, electronics guide)
//   Vibe SDK:    github.com/viberobotics/vibe_robotics_sdk (CAD, walker parameters)
//   Feetech:     STS3215 C001 and STS3250 datasheet values (vendor listings)

export const VARIANTS = {
  mini: {
    key: 'mini',
    name: 'Vibe A1 Mini',
    short: 'Mini',
    model: 'mini',
    height: 0.61,
    mass: 2.2,
    dof: 19,
    armDof: 3,
    speed: 0.12,
    turn: 1.2,
    battery: '~1.5 h',
    compute: 'Raspberry Pi 5',
    computeNote: '4 GB · quad-core Cortex-A76',
    camera: 'web camera',
    price: '$799 launch price',
    batteryText: 'a <b>12 V lithium pack</b>; a separate power bank runs the Pi',
  },
  a1: {
    key: 'a1',
    name: 'Vibe A1',
    short: 'A1',
    model: 'a1',
    height: 0.61,
    mass: 2.8,
    dof: 25,
    armDof: 6,
    speed: 0.15,
    turn: 1.5,
    battery: '~2 h',
    compute: 'Jetson Orin Nano',
    computeNote: '8 GB · 67 TOPS',
    camera: 'web camera',
    price: '$1,499 launch price',
    batteryText: '<b>two 7.4 V LiPo packs</b> (3300 mAh each)',
  },
  pro: {
    key: 'pro',
    name: 'Vibe A1 Pro',
    short: 'Pro',
    model: 'a1',
    height: 0.61,
    mass: 2.8,
    dof: 25,
    armDof: 6,
    speed: 0.15,
    turn: 1.5,
    battery: '~2 h',
    compute: 'Jetson Orin Nano',
    computeNote: '8 GB · 67 TOPS',
    camera: 'Intel RealSense D435i',
    price: '$1,999 launch price',
    batteryText: '<b>two 7.4 V LiPo packs</b> (3300 mAh each)',
  },
};

export const ROBOT = {
  eyebrow: 'Open-source humanoid',
  pre: 'Inside the',
  lede: (v) =>
    `An open-source humanoid you can build for under $800: printed plastic, hobby servos and a ${v.key === 'mini' ? 'Raspberry Pi' : 'small AI computer'}. Open it up, follow the power and the data, then make it walk.`,
  stats: (v, speed) => [
    { k: 'Height', v: v.height.toFixed(2), u: 'm' },
    { k: 'Joints', v: String(v.dof), u: 'DoF' },
    { k: 'Walking', v: speed.toFixed(2), u: 'm/s' },
  ],
  follow: [
    { key: 'all', label: 'All' },
    { key: 'power', label: 'Power', tone: 'power' },
    { key: 'data', label: 'Data', tone: 'data' },
    { key: 'balance', label: 'Balance', tone: 'balance' },
  ],
  views: [
    { key: 'whole', label: 'Whole' },
    { key: 'cutaway', label: 'Cutaway' },
    { key: 'exploded', label: 'Exploded' },
  ],
  card(state) {
    const { v, follow, view, speed, walking, counts } = state;
    if (view === 'cutaway')
      return `Cut open: the chest holds the <b>${v.compute}</b>, two <b>bus servo boards</b> and the <b>battery</b>. The neck and shoulder servos live in here too, and the hip servos hang just below. <span class="note">Electronics layout is illustrative; the parts are from Vibe's parts list. Click any servo to look inside it.</span>`;
    if (view === 'exploded')
      return `Pulled apart: <b>${counts.printed} printed parts</b> and <b>${counts.servos} servos</b>. Each joint is a servo bolted between two brackets; its output horn drives the next link, so a limb is just servo, bracket, servo, bracket.`;
    if (follow === 'power')
      return `<span class="pw">Power</span> comes from ${v.batteryText}. A DC splitter feeds two <b>bus servo boards</b>, one for the upper body and one for the legs. The same 3-wire cable carries power <i>and</i> data from servo to servo down each limb. <span class="note">Glow ≈ motor current: standing legs work hardest. Battery life ${v.battery}.</span>`;
    if (follow === 'data')
      return `The <b>${v.compute}</b> sends joint targets over USB to two <b>bus servo boards</b> that drive a <span class="dt">1 Mbps serial bus</span>. Each tick, one packet sets every position at once; then each servo, addressed by its <b>ID</b>, <span class="fb">replies</span> with where it actually is. <span class="note">One 30 ms control tick, slowed down about 85×.</span>`;
    if (follow === 'balance')
      return walking
        ? `The walking controller treats the robot as an <b>inverted pendulum</b>. It keeps the <span class="zm">zero-moment point</span>, where the ground effectively pushes back, inside the standing foot, and steers the <span class="bl">center of mass</span> with a <b>10-step lookahead</b> (MPC). <span class="note">Pink box: 80% of the foot, the ZMP limit in Vibe's SDK.</span>`
        : `Standing still, the <span class="bl">center of mass</span> sits over both feet and the <span class="zm">zero-moment point</span> is right below it. Raise the walk speed to watch it sway from foot to foot.`;
    if (walking)
      return `Walking at <b>${speed.toFixed(2)} m/s</b>${speed >= v.speed - 0.002 ? ', the top speed on the spec sheet' : ''}. Each step the controller picks where the next foot lands, slides the body over the standing foot, and solves every leg joint <b>33 times a second</b>.`;
    const arms = v.armDof === 6 ? '6 per arm' : '3 per arm';
    return `<b>Every white part is 3D-printed.</b> The joints are <b>${v.dof} smart servos</b>: 6 per leg, ${arms}, 1 for the neck. A <b>${v.compute}</b> in the chest runs the controller and talks to all of them over two shared data lines.${v.key === 'pro' ? ' The Pro adds an <b>Intel RealSense D435i</b> depth camera behind the face.' : ''}`;
  },
  variantToast: (v) =>
    ({
      mini: 'Vibe A1 Mini · 19 joints · Raspberry Pi 5 · 2.2 kg',
      a1: 'Vibe A1 · 25 joints · gripper hands · Jetson Orin Nano',
      pro: 'Vibe A1 Pro · adds the RealSense D435i depth camera',
    })[v.key],
};

export const SERVO = {
  eyebrow: 'One of its joints',
  pre: 'One servo,',
  title: 'three jobs',
  lede: 'Every joint of the Vibe A1 is a smart servo like this Feetech STS3215. It turns, it measures where it is, and it talks on a shared bus, all inside a 45 mm box.',
  follow: [
    { key: 'all', label: 'All' },
    { key: 'power', label: 'Power', tone: 'power' },
    { key: 'data', label: 'Data', tone: 'data' },
    { key: 'gears', label: 'Gears', tone: 'feedback' },
  ],
  scenarios: [
    { key: 'sweep', label: 'Sweep' },
    { key: 'lift', label: 'Lift' },
    { key: 'overload', label: 'Overload' },
  ],
  views: [
    { key: 'whole', label: 'Whole' },
    { key: 'cutaway', label: 'Cutaway' },
    { key: 'exploded', label: 'Exploded' },
  ],
  spec: {
    ratio: 345,
    stallTorque: 19.5, // kg·cm @ 7.4 V
    ratedTorque: 5,
    noLoadRpm: 52, // 0.192 s / 60° @ 7.4 V
    stallCurrent: 2.5, // A
    noLoadCurrent: 0.15, // A
    steps: 4096,
    mass: 55,
    size: '45.2 × 24.7 × 35 mm',
  },
  card(state) {
    const { follow, view, scenario, speedPct, torque, current, tripped } = state;
    const s = this.spec;
    if (view === 'cutaway')
      return `Inside: the <b>motor</b> runs along the body, <b>four gear stages</b> sit above it, the <b>output shaft</b> rides a ball bearing with a <b>magnet</b> at its foot, and the <b>control board</b> underneath reads that magnet through an encoder chip right below it.`;
    if (view === 'exploded')
      return `Pulled apart: a three-part case, the motor, the metal gear train, the output shaft and horn, the magnet, the control board and two bus connectors, one in and one out, so servos chain together.`;
    if (scenario === 'overload')
      return tripped
        ? `<b>Overload protection tripped.</b> The motor stalled against <b>${torque.toFixed(0)} kg·cm</b>, more than its <b>${s.stallTorque} kg·cm</b> stall torque, drawing <b>${s.stallCurrent} A</b> until it cut the torque to save itself. On the A1 this raises the <b>joint overheat alert</b>.`
        : `Asking for <b>${torque.toFixed(0)} kg·cm</b>, more than the <b>${s.stallTorque} kg·cm</b> stall torque. The motor stalls, current climbs toward <b>${s.stallCurrent} A</b> and the winding heats up…`;
    if (follow === 'power')
      return `<span class="pw">Current</span> arrives on the same 3-pin cable as the data (GND, V+, signal). An H-bridge on the control board switches it through the motor in either direction and sets the effort by pulse-width modulation. <span class="note">${current.toFixed(2)} A now · ${s.noLoadCurrent} A unloaded · ${s.stallCurrent} A stalled</span>`;
    if (follow === 'data')
      return `A <span class="dt">command packet</span> arrives: FF FF, the servo's ID, length, instruction, goal position and a checksum. Only the servo with that ID acts. It <span class="fb">replies</span> with position, speed, load, voltage and temperature, read from the <b>12-bit magnetic encoder</b>: ${s.steps} steps per turn, 0.088° each.`;
    if (follow === 'gears')
      return `Each gear stage trades speed for torque. Together they multiply to <b>${s.ratio}:1</b>: the motor turns ${s.ratio} times for one turn of the output. <span class="note">The four-stage split is illustrative; ${s.ratio}:1 is the datasheet total.</span>`;
    if (scenario === 'lift')
      return `Lifting <b>0.5 kg</b> on a 6 cm arm: <b>${torque.toFixed(0)} kg·cm</b>, near its <b>${s.ratedTorque} kg·cm</b> rated torque. Even holding still, the motor pushes the whole time and draws <b>${current.toFixed(2)} A</b>. That's why a standing robot's knee servos get warm.`;
    return `The motor spins at up to <b>~${Math.round((s.noLoadRpm * s.ratio) / 100) * 100} rpm</b>. A <b>${s.ratio}:1</b> metal gear train slows that to <b>${s.noLoadRpm} rpm</b> at the output and multiplies the torque to <b>${s.stallTorque} kg·cm</b>. Running at ${speedPct}%.`;
  },
};

export const SOURCES = {
  sdk: 'https://github.com/viberobotics/vibe_robotics_sdk',
  docs: 'https://www.viberobotics.co/docs',
};
