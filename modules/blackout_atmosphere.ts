import type * as ThreeTypes from 'three';

/** Pooled, depth-tested atmosphere; no additional lights or fullscreen passes. */
export function createBlackoutAtmosphere(THREE: typeof ThreeTypes, scene: ThreeTypes.Scene, lowEnd: boolean) {
  const root = new THREE.Group();
  root.name = 'BlackoutAtmosphere';
  root.visible = false;
  scene.add(root);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(170,190,200,0.45)');
  gradient.addColorStop(.4, 'rgba(140,165,180,0.2)');
  gradient.addColorStop(1, 'rgba(120,150,170,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mist = Array.from({ length: lowEnd ? 8 : 16 }, (_, i) => {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true,
      depthWrite: false, side: THREE.DoubleSide, opacity: .22, color: 0x718697 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(14 + i % 4 * 3, 2.4 + i % 3, 1);
    root.add(mesh);
    return mesh;
  });
  const count = lowEnd ? 70 : 180;
  const positions = new Float32Array(count * 3);
  const seeds = Array.from({ length: count }, (_, i) => ({
    x: (Math.sin(i * 127.1) * 43758.5 % 1 + 1) % 1 * 64,
    y: (i * .6180339 % 1) * 12,
    z: (Math.sin(i * 311.7) * 19642.3 % 1 + 1) % 1 * 64,
  }));
  const ashGeometry = new THREE.BufferGeometry();
  ashGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const ash = new THREE.Points(ashGeometry, new THREE.PointsMaterial({
    color: 0x9aaab3, size: .055, transparent: true, opacity: .32, depthWrite: false,
  }));
  ash.frustumCulled = false;
  root.add(ash);
  let time = 0;
  const wrap = (n: number) => ((n + 32) % 64 + 64) % 64 - 32;
  return (dt: number, active: boolean, position: ThreeTypes.Vector3) => {
    root.visible = active;
    if (!active) return;
    time += Math.min(dt, .1);
    mist.forEach((mesh, i) => {
      mesh.position.set(position.x + wrap(i * 19.7 + time * .36 - position.x),
        .65 + Math.sin(time * .17 + i) * .25,
        position.z + wrap(i * 31.3 + time * .17 - position.z));
      mesh.rotation.y = i * 2.4 + Math.sin(time * .04) * .2;
      // Fade near the camera so mist never becomes a sheet across the view.
      const distance = Math.hypot(mesh.position.x - position.x, mesh.position.z - position.z);
      mesh.material.opacity = Math.min(1, Math.max(0, (distance - 4) / 9)) * (.22 + Math.sin(time * .24 + i) * .06);
    });
    seeds.forEach((seed, i) => {
      positions[i * 3] = position.x + wrap(seed.x + time * .45 - position.x);
      positions[i * 3 + 1] = ((seed.y - time * .18) % 12 + 12) % 12;
      positions[i * 3 + 2] = position.z + wrap(seed.z + Math.sin(time * .12 + i) * 1.5 - position.z);
    });
    ashGeometry.attributes.position.needsUpdate = true;
  };
}
