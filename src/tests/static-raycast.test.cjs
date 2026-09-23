const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const THREE = require('three');
const output = ts.transpileModule(fs.readFileSync('src/modules/static_raycast.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exported = {};
new Function('require', 'exports', output)(require, exported);

test('static acceleration preserves surface hits and triangle order', () => {
  const geometry = new THREE.TorusKnotGeometry(3, 1, 256, 32);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.set(2, 1, -3);
  mesh.rotation.set(.2, .4, .1);
  mesh.scale.set(1, 1.3, .8);
  mesh.updateMatrixWorld(true);
  const indices = Array.from(geometry.index.array);
  const rays = Array.from({ length: 100 }, (_, i) => {
    const origin = new THREE.Vector3(Math.sin(i) * 12, Math.cos(i * .7) * 12, 12);
    return new THREE.Raycaster(origin, mesh.position.clone().sub(origin).normalize(), 0, 40);
  });
  const start = performance.now();
  const baseline = rays.map(ray => ray.intersectObject(mesh, false));
  const originalMs = performance.now() - start;
  assert.equal(exported.accelerateStaticRaycasts([mesh]), 1);
  assert.deepEqual(Array.from(geometry.index.array), indices);
  const fastStart = performance.now();
  const accelerated = rays.map(ray => ray.intersectObject(mesh, false));
  const acceleratedMs = performance.now() - fastStart;
  baseline.forEach((hits, i) => {
    assert.equal(accelerated[i].length, hits.length);
    hits.forEach((hit, j) => {
      const actual = accelerated[i][j];
      assert.ok(Math.abs(actual.distance - hit.distance) < 1e-8);
      assert.ok(actual.point.distanceTo(hit.point) < 1e-8);
      assert.ok(actual.uv.distanceTo(hit.uv) < 1e-8);
      assert.ok(actual.face.normal.distanceTo(hit.face.normal) < 1e-8);
      assert.equal(actual.faceIndex, hit.faceIndex);
    });
  });
  const instance = new THREE.InstancedMesh(geometry, mesh.material, 1);
  const originalRaycast = instance.raycast;
  assert.equal(exported.accelerateStaticRaycasts([instance]), 0);
  assert.equal(instance.raycast, originalRaycast);
  console.log({ originalMs, acceleratedMs });
});
