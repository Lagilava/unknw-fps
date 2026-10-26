import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovementCamera, updateMovementCamera, smoothCameraBoom, dampCamera } from '../modules/movement_camera.ts';

const base = { x: 0, y: 1.7, z: 0, yaw: 0, maxSpeed: 6, ads: 0, active: true, grounded: true, dt: 1 / 60 };
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
function travel(fps, seconds = 1, overrides = {}) {
  const state = createMovementCamera();
  updateMovementCamera(state, { ...base, ...overrides, dt: 1 / fps });
  let result;
  for (let i = 1; i <= fps * seconds; i++) {
    result = updateMovementCamera(state, { ...base, ...overrides, x: i * 6 / fps, dt: 1 / fps });
  }
  return { state, result };
}

test('standing camera has no idle oscillation', () => {
  const state = createMovementCamera();
  for (let i = 0; i < 600; i++) assert.deepEqual(updateMovementCamera(state, base), { x: 0, y: 0, z: 0 });
});
test('constant running settles without bob, pitch or roll', () => {
  const { state, result } = travel(60, 3);
  near(result.x, -0.025); near(result.z, 0.025); near(result.y, 0);
  const next = updateMovementCamera(state, { ...base, x: 18.1 });
  near(next.x, result.x); near(next.z, result.z);
});
test('movement framing is equivalent at 30, 60 and 144 fps', () => {
  const reference = travel(60).result;
  for (const fps of [30, 144]) {
    const result = travel(fps).result;
    near(result.x, reference.x); near(result.z, reference.z);
  }
});
test('stopping at a wall settles even if movement input remains held', () => {
  const { state } = travel(60);
  let result;
  for (let i = 0; i < 120; i++) result = updateMovementCamera(state, { ...base, x: 6 });
  near(result.x, 0, 1e-8); near(result.z, 0, 1e-8);
});
test('reversing strafe eases without overshoot and remains bounded', () => {
  const { state, result } = travel(60);
  const next = updateMovementCamera(state, { ...base, x: 5.9 });
  assert.ok(next.x > result.x && next.x < 0);
  assert.ok(Math.abs(next.x) <= 0.025 && next.z <= 0.025);
});
test('mouse heading is used immediately for local movement framing', () => {
  const { result } = travel(60, 2, { yaw: Math.PI / 2 });
  near(result.x, 0); near(result.z, 0.025);
});
test('ADS removes locomotion offsets', () => {
  const { result } = travel(60, 2, { ads: 1 });
  assert.deepEqual(result, { x: 0, y: 0, z: 0 });
});
test('steps and landings ease visually without changing physical height', () => {
  const state = createMovementCamera();
  updateMovementCamera(state, base);
  const input = { ...base, y: 2.2 };
  let result = updateMovementCamera(state, input);
  assert.ok(result.y > -0.5 && result.y < 0);
  assert.equal(input.y, 2.2);
  for (let i = 0; i < 60; i++) result = updateMovementCamera(state, input);
  near(result.y, 0, 1e-8);
});
test('teleports, paused views and long frames reset follow without dragging', () => {
  for (const extra of [{ x: 100, y: 4 }, { active: false }, { dt: 0.5 }, { dt: 0 }]) {
    const { state } = travel(60);
    assert.deepEqual(updateMovementCamera(state, { ...base, ...extra }), { x: 0, y: 0, z: 0 });
  }
});
test('boom retracts immediately, recovers smoothly and never crosses safe limit', () => {
  assert.equal(smoothCameraBoom(1, 0.3, 1 / 60), 0.3);
  let value = smoothCameraBoom(0.3, 1, 1 / 60);
  assert.ok(value > 0.3 && value < 1);
  for (let i = 0; i < 120; i++) { value = smoothCameraBoom(value, 1, 1 / 60); assert.ok(value <= 1); }
  assert.equal(smoothCameraBoom(value, 0.2, 1 / 60), 0.2);
});
test('FOV easing is frame-rate independent without overshoot', () => {
  for (const fps of [30, 60, 144]) {
    let fov = 90;
    for (let i = 0; i < fps; i++) { fov = dampCamera(fov, 100, 8, 1 / fps); assert.ok(fov <= 100); }
    near(fov, 100 - 10 * Math.exp(-8));
  }
});
