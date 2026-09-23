const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('turning keeps foot plants released across substeps and restores them after settling', async () => {
  const THREE = await import('three');
  const source = fs.readFileSync('src/three_fps_game.ts', 'utf8');
  const extract = name => {
    const start = source.indexOf(`  function ${name}(`);
    return source.slice(start, source.indexOf('\n  }', start) + 4);
  };
  const bone = (x, y) => ({ getWorldPosition: v => v.set(x, y, 0) });
  const ctx = { Math, yaw: { rotation: { y: 0.1 } }, footLockYaw: 0, footLockTurnHold: 0,
    FOOT_IK: true, FOOT_IK_MAX_WEIGHT: 0.8, FOOT_PLANT_LEAD: 0.02, FOOT_RELEASE_LEAD: 0.05,
    FOOT_MAX_SLIDE: 0.3, FOOT_MAX_REACH: 0.7, FOOT_IK_BLEND: 12,
    player: { grounded: true, jumpOffset: 0 }, propTopAt: () => 0, solveTwoBoneIK: () => {},
    _footL: new THREE.Vector3(), _footR: new THREE.Vector3(), _footTarget: new THREE.Vector3(), _hipWorld: new THREE.Vector3(),
    thirdPerson: { lastMove: { f: 1, s: 0 },
      footIK: { left: { locked: false, weight: 0 }, right: { locked: false, weight: 0 } },
      aimBones: { leftFoot: bone(-.1, .1), rightFoot: bone(.1, .2), leftUpLeg: bone(-.1, .8), rightUpLeg: bone(.1, .8) },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extract('solveFootLock') + '\n' + extract('applyThirdPersonFootIK'), ctx);
  for (let i = 0; i < 4; i++) {
    ctx.applyThirdPersonFootIK(1 / 60);
    assert.equal(ctx.thirdPerson.footIK.left.locked, false);
    assert.equal(ctx.thirdPerson.footIK.left.weight, 0);
  }
  for (let i = 0; i < 12; i++) ctx.applyThirdPersonFootIK(1 / 60);
  assert.equal(ctx.thirdPerson.footIK.left.locked, true);
  ctx.thirdPerson.lastMove.f = 0;
  ctx.applyThirdPersonFootIK(1 / 60);
  assert.equal(ctx.thirdPerson.footIK.left.locked, false);
});
