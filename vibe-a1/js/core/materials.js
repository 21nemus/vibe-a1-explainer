// Material helpers shared by both scenes.
//
// enhance(): back faces seen through a clipping plane are drawn as a flat
// "cross-section" colour (cutaways, the 3D-print transition), and a highlight
// uniform tints the part under the cursor. Clipping planes stay attached at all
// times (parked far away when unused) so toggling modes never recompiles shaders.

import * as THREE from 'three';

export const PARKED = 1e6;

export function parkedPlane(normal = new THREE.Vector3(0, -1, 0)) {
  return new THREE.Plane(normal.clone(), PARKED);
}

export function enhance(material, { cap = 0xff9d4d, capIntensity = 1.4, planes = [] } = {}) {
  material.side = THREE.DoubleSide;
  material.clippingPlanes = planes;
  material.clipShadows = true;
  const u = {
    uCapColor: { value: new THREE.Color(cap) },
    uCapIntensity: { value: capIntensity },
    uHighlight: { value: 0 },
    uHighlightColor: { value: new THREE.Color(0x8fd3ff) },
  };
  material.userData.u = u;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uCapColor; uniform float uCapIntensity; uniform float uHighlight; uniform vec3 uHighlightColor;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (!gl_FrontFacing) { gl_FragColor = vec4(uCapColor * uCapIntensity, 1.0); }
        else { gl_FragColor.rgb = mix(gl_FragColor.rgb, uHighlightColor * 1.4, uHighlight * 0.32); }`,
      );
  };
  material.customProgramCacheKey = () => 'enhanced';
  return material;
}

// Kept out of userData: Material.clone() JSON-copies userData.
const twins = new WeakMap();

/** A twin of an enhanced material with the highlight turned on (for hover). */
export function highlightTwin(material) {
  if (twins.has(material)) return twins.get(material);
  const twin = material.clone();
  enhance(twin, { planes: material.clippingPlanes });
  twin.userData.u.uCapColor = material.userData.u.uCapColor; // share cap uniforms
  twin.userData.u.uCapIntensity = material.userData.u.uCapIntensity;
  twin.userData.u.uHighlight.value = 1;
  twins.set(material, twin);
  return twin;
}

/** Materials for one robot instance. `cut` clips the shells, `print` clips everything. */
export function createRobotMaterials({ cutPlane, printPlane }) {
  const all = [printPlane];
  const plastic = enhance(
    new THREE.MeshPhysicalMaterial({
      name: 'pla-white',
      color: 0xe8e5de,
      roughness: 0.5,
      metalness: 0,
      sheen: 0.4,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(0xffffff),
      envMapIntensity: 0.6,
    }),
    { planes: all },
  );
  const plasticGrey = enhance(plastic.clone(), { planes: all });
  plasticGrey.name = 'pla-grey';
  plasticGrey.color.set(0xd6d8dc);
  const shell = enhance(plastic.clone(), { planes: [printPlane, cutPlane] });
  shell.name = 'pla-shell';
  const servo = enhance(
    new THREE.MeshPhysicalMaterial({
      name: 'servo-case',
      color: 0x1a1c21,
      roughness: 0.36,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.45,
      envMapIntensity: 1.1,
    }),
    { cap: 0x3a3f4a, planes: all },
  );
  const sensor = enhance(
    new THREE.MeshPhysicalMaterial({ name: 'sensor', color: 0x2c3038, roughness: 0.28, metalness: 0.8, envMapIntensity: 1.2 }),
    { planes: all },
  );
  const pcb = enhance(new THREE.MeshStandardMaterial({ name: 'pcb', color: 0x2b1f55, roughness: 0.45, metalness: 0.15 }), { planes: all });
  return { plastic, plasticGrey, shell, servo, sensor, pcb, list: [plastic, plasticGrey, shell, servo, sensor, pcb] };
}

export function setCap(mats, color, intensity) {
  for (const m of mats) {
    m.userData.u.uCapColor.value.set(color);
    m.userData.u.uCapIntensity.value = intensity;
  }
}
