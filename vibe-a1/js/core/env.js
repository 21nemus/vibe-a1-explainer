// A small "lightbox" scene baked into a PMREM for reflections: dark room,
// warm key softbox, cool fill, lavender and cyan rim strips.

import * as THREE from 'three';

export function createStudioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(12, 7, 12),
    new THREE.MeshBasicMaterial({ color: 0x0a0d17, side: THREE.BackSide }),
  );
  room.position.y = 2.5;
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: 0x06080e }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.99;
  scene.add(floor);

  const panel = (w, h, color, intensity, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0.4, 0);
    scene.add(m);
  };
  panel(3.2, 2.2, 0xfff0df, 7.5, [2.6, 3.4, 3.2]); // key softbox
  panel(2.4, 3.2, 0x9db6ff, 1.6, [-4.4, 1.8, 1.6]); // cool fill
  panel(0.7, 4.6, 0xb79dff, 5.5, [-3.0, 2.2, -3.8]); // lavender rim
  panel(0.7, 4.6, 0x67d4ff, 4.2, [3.4, 2.0, -3.6]); // cyan rim
  panel(8, 0.35, 0xdfe8ff, 2.2, [0, 5.4, -0.5]); // ceiling strip
  panel(2.5, 0.9, 0xffc78a, 0.9, [0.5, 0.2, 4.6]); // warm low bounce

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return env;
}
