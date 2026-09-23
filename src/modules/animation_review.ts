// Loaded only by the ?test=1 harness. Captures the live rig and live state updater.
import * as THREE from 'three';

export function captureAnimationReview(root: any, step: (dt: number) => void, label: string, forward = 1,
  duration = 1.2, attachments: () => any[] = () => []) {
  const size = 224;
  const views = [
    ['front', 0, .12, 1], ['left', -Math.PI / 2, .12, 1], ['right', Math.PI / 2, .12, 1],
    ['front-left', -.785, .12, 1], ['front-right', .785, .12, 1],
    ['back-left', -2.356, .12, 1], ['back-right', 2.356, .12, 1],
    ['elevated', .785, 1.1, 1], ['close', -.5, .12, .7], ['far', .5, .2, 2.2],
  ] as const;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x26313b);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8796a4, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(3, 6, 4); scene.add(light);
  const grid = new THREE.GridHelper(20, 40, 0x8090a0, 0x45515a); scene.add(grid);
  const camera = new THREE.PerspectiveCamera(42, 1, .05, 100);
  const sheet = document.createElement('canvas');
  sheet.width = size * views.length; sheet.height = (size + 24) * 3;
  const ctx = sheet.getContext('2d')!;
  const parent = root.parent, position = root.position.clone(), rotation = root.quaternion.clone();
  const wasVisible = root.visible;
  let finite = true;
  const motion: number[][] = [];
  const frames = [.15, .5, .95].map(t => t * duration);
  let elapsed = 0;
  let portrait = '';
  let framingHeight = root.userData.animationReviewHeight;
  try {
    for (let phase = 0; phase < 3; phase++) {
      while (elapsed < frames[phase] - 1e-6) {
        const dt = Math.min(1 / 60, frames[phase] - elapsed); step(dt); elapsed += dt;
      }
      const pose: number[] = [];
      root.traverse((o: any) => {
        if (o.isBone) { pose.push(...o.quaternion.toArray()); finite &&= o.matrix.elements.every(Number.isFinite); }
      });
      motion.push(pose);
      // Reload gun/magazine may be world-parented. Include them with the body,
      // then restore their original world-space transform after each capture.
      const detached = attachments().filter(o => o?.parent && !root.getObjectById(o.id)).map(o => ({
        o, parent: o.parent, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(),
      }));
      root.updateMatrixWorld(true);
      detached.forEach(({o}) => root.attach(o));
      const p = root.position.clone(), q = root.quaternion.clone();
      scene.add(root); root.position.set(0, 0, 0); root.quaternion.identity(); root.visible = true;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      // Expanding/hidden ability meshes must not pull the close-up camera away
      // from the body between phases. Keep the rig's first framing throughout.
      framingHeight ||= Math.min(3.5, Math.max(1.8, bounds.max.y));
      root.userData.animationReviewHeight = framingHeight;
      const height = framingHeight;
      const target = new THREE.Vector3(0, height * .48, 0);
      views.forEach(([name, az, el, dist], column) => {
        const radius = height * 1.8 * dist;
        camera.position.set(Math.sin(az) * Math.cos(el) * radius, target.y + Math.sin(el) * radius,
          Math.cos(az) * Math.cos(el) * radius * forward);
        camera.lookAt(target); renderer.render(scene, camera);
        const x = column * size, y = phase * (size + 24);
        ctx.drawImage(renderer.domElement, x, y);
        ctx.fillStyle = '#101820'; ctx.fillRect(x, y + size, size, 24);
        ctx.fillStyle = '#ffffff'; ctx.font = '11px sans-serif';
        ctx.fillText(`${label} | ${name} | ${frames[phase].toFixed(2)}s`, x + 4, y + size + 16);
      });
      if (phase === 1) {
        renderer.setSize(960, 540); camera.aspect = 960 / 540; camera.updateProjectionMatrix();
        camera.position.set(height * .8, target.y + height * .2, height * 1.8 * forward);
        camera.lookAt(target); renderer.render(scene, camera);
        portrait = renderer.domElement.toDataURL('image/png');
        renderer.setSize(size, size); camera.aspect = 1; camera.updateProjectionMatrix();
      }
      parent?.add(root); root.position.copy(p); root.quaternion.copy(q);
      detached.forEach(({o, parent, p, q, s}) => { parent.add(o); o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); });
    }
    return { png: sheet.toDataURL('image/png'), portrait, finite, motion,
      views: views.map(v => v[0]), frames };
  } finally {
    parent?.add(root); root.position.copy(position); root.quaternion.copy(rotation); root.visible = wasVisible;
    grid.geometry.dispose(); (grid.material as THREE.Material).dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }
}
