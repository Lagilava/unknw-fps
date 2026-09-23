const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const THREE = require('three');
const output = ts.transpileModule(fs.readFileSync('src/modules/particle_fx.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exported = {};
new Function('exports', output)(exported);
for (const backend of ['webgl', 'webgpu']) {
  test(`${backend}: burst saturation, expiration and clearing stay bounded`, () => {
    const scene = new THREE.Scene();
    const fx = exported.createParticleFX(THREE, scene, { backend, lowEnd: true });
    const p = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 300; i++) fx.emit('enemyDeathMetal', p);
    assert.ok(fx.count() <= fx.capacity());
    assert.equal(scene.children.length, 2);
    fx.update(.016);
    fx.trim(.1);
    assert.ok(fx.count() <= fx.capacity() * .1);
    fx.update(3);
    assert.equal(fx.count(), 0);
    for (const object of fx.objects) assert.equal(object.geometry.drawRange.count, 0);
    fx.emit('enemyArmorHit', p); fx.update(.016); fx.clear();
    for (const object of fx.objects) assert.equal(object.geometry.drawRange.count, 0);
    fx.dispose();
    assert.equal(scene.children.length, 0);
  });
}
test('distant effects and zero budgets emit nothing', () => {
  const fx = exported.createParticleFX(THREE, new THREE.Scene(), { viewerPosition: () => ({ x: 0, y: 0, z: 0 }) });
  fx.emit('enemyDeathMetal', { x: 100, y: 0, z: 0 });
  assert.equal(fx.count(), 0);
  fx.setBudget(0);
  fx.emit('enemyDeathMetal', { x: 0, y: 1, z: 0 });
  assert.equal(fx.count(), 0);
  fx.dispose();
});

test('low density preserves the impact signature and delayed rupture ages correctly', () => {
  const fx = exported.createParticleFX(THREE, new THREE.Scene(), { lowEnd: true });
  fx.setBudget(.001);
  fx.emit('enemyDeathMetal', { x: 0, y: 1, z: 0 });
  const geometry = fx.objects[0].geometry;
  const styles = geometry.attributes.aStyle.array;
  const alpha = geometry.attributes.aAlpha.array;
  const findShape = shape => {
    for (let i = 0; i < fx.count(); i++) if (styles[i * 2] === shape) return i;
    return -1;
  };
  assert.ok(findShape(6) >= 0, 'instant flare');
  const ring = findShape(2), arc = findShape(3);
  assert.ok(ring >= 0 && arc >= 0);
  fx.update(.02);
  assert.equal(alpha[ring], 0);
  assert.equal(alpha[arc], 0);
  fx.update(.025);
  assert.ok(alpha[ring] > 0);
  assert.equal(alpha[arc], 0);
  fx.update(.03);
  assert.ok(alpha[arc] > 0);
  fx.update(3);
  assert.equal(fx.count(), 0);
  fx.dispose();
});
