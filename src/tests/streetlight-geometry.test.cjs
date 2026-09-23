const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('streetlight poles, arms, housings and lenses form connected fixtures', () => {
  const source = fs.readFileSync('src/exterior_map.js', 'utf8');
  const start = source.indexOf('    function buildLampposts()');
  const end = source.indexOf('\n    }', start) + 6;
  const pieces = [], colliders = [];
  const box = (w, h, d, x, y, z) => pieces.push({ x, y, z, w, h, d });
  const ctx = { std: x => x, M: {},
    queueBox: box,
    queueCyl: (top, bottom, h, x, y, z) => box(2 * Math.max(top, bottom), h, 2 * Math.max(top, bottom), x, y, z),
    addCollider: (x, z, w, d) => colliders.push({ x, z, w, d }),
  };
  vm.createContext(ctx); vm.runInContext(source.slice(start, end) + '\nbuildLampposts();', ctx);
  assert.equal(colliders.length, 12);
  const touches = (a, b) => ['x', 'y', 'z'].every((axis, i) =>
    Math.abs(a[axis] - b[axis]) <= (a[['w','h','d'][i]] + b[['w','h','d'][i]]) / 2 + 1e-6);
  for (const c of colliders) {
    const fixture = pieces.filter(p => p.z === c.z && Math.abs(p.x - c.x) < 2);
    assert.equal(fixture.length, 4);
    const connected = new Set([fixture[0]]);
    for (let i = 0; i < fixture.length; i++) for (const piece of fixture) {
      if ([...connected].some(other => touches(piece, other))) connected.add(piece);
    }
    assert.equal(connected.size, fixture.length, `Detached part at ${c.x}, ${c.z}`);
    const head = fixture[2];
    assert.ok(Math.abs(head.x) < Math.abs(c.x), 'Housing must face the road');
  }
  for (const match of source.matchAll(/makePowerLine\([^\n]*?,\s*(-?\d+(?:\.\d+)?),\s*7\.0,\s*(\d+),/g)) {
    assert.ok(colliders.some(c => c.x === Number(match[1]) && c.z === Number(match[2])), 'Cable must terminate at a pole');
  }
});
