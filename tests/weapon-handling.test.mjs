import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGunState, GUN_SPECS } from '../src/modules/gun_config.ts';
import { beginWeaponReload, advanceWeaponReload, cancelWeaponReload, weaponReloadProgress,
  aimCursorTangents, adsLookScale, dampAds } from '../src/modules/weapon_handling.ts';

for (const gun of Object.keys(GUN_SPECS)) {
  test(gun + ': full, empty reserve, partial and upgraded reloads conserve ammo', () => {
    const s = createGunState(gun);
    assert.equal(beginWeaponReload(s), false);
    s.mag = 0; s.ammo = 0;
    assert.equal(beginWeaponReload(s), false);
    s.ammo = 3;
    assert.equal(beginWeaponReload(s), true);
    assert.equal(beginWeaponReload(s), false);
    assert.equal(advanceWeaponReload(s, s.reloadDuration / 2), false);
    assert.equal(s.mag, 0);
    assert.ok(Math.abs(weaponReloadProgress(s) - .5) < 1e-9);
    assert.equal(advanceWeaponReload(s, s.reloadDuration), true);
    assert.equal(s.mag, 3); assert.equal(s.ammo, 0);
    assert.equal(advanceWeaponReload(s, 10), false);
    s.mag = 1; s.ammo = 100;
    s.reloadTime *= .72;
    beginWeaponReload(s);
    assert.equal(s.reloadDuration, s.reloadTime);
    s.reloadTime *= .5; // an active reload retains its duration snapshot
    const snapshot = s.reloadDuration;
    advanceWeaponReload(s, snapshot / 2);
    assert.ok(Math.abs(weaponReloadProgress(s) - .5) < 1e-9);
    advanceWeaponReload(s, snapshot);
    assert.equal(s.mag, s.magSize);
    assert.equal(s.ammo + s.mag, 101);
  });
  test(gun + ': cancellation and pause do not grant ammo or retain reload state', () => {
    const s = createGunState(gun); s.mag = 0;
    beginWeaponReload(s);
    const timer = s.reloadTimer;
    advanceWeaponReload(s, 0); advanceWeaponReload(s, NaN); advanceWeaponReload(s, -1);
    assert.equal(s.reloadTimer, timer);
    advanceWeaponReload(s, timer * .4); s.isAutoReloading = true;
    cancelWeaponReload(s);
    assert.equal(s.reloadTimer, 0); assert.equal(s.isAutoReloading, false);
    assert.equal(advanceWeaponReload(s, 10), false); assert.equal(s.mag, 0);
    assert.equal(beginWeaponReload(s), true);
  });
}

test('reticle pixels project back to their original position at every weapon zoom and aspect', () => {
  for (const { adsFov } of Object.values(GUN_SPECS)) {
    for (const [w,h] of [[1920,1080],[390,844],[2560,1080]]) {
      const p = aimCursorTangents(12,-7,w,h,adsFov,w/h);
      const tan = Math.tan(adsFov * Math.PI / 360);
      assert.ok(Math.abs(p.x / (tan * w/h) * w/2 - 12) < 1e-9);
      assert.ok(Math.abs(-p.y / tan * h/2 + 7) < 1e-9);
    }
  }
});
test('scoped sensitivity preserves screen-space travel and hip sensitivity', () => {
  assert.equal(adsLookScale(63,63), 1);
  for (const { adsFov } of Object.values(GUN_SPECS)) {
    const fov = Math.min(adsFov,63), scale = adsLookScale(fov,63);
    assert.ok(scale > 0 && scale <= 1);
    assert.ok(Math.abs(scale / Math.tan(fov*Math.PI/360) - 1/Math.tan(63*Math.PI/360)) < 1e-9);
  }
});
test('ADS blends identically at 30, 60 and 144 FPS', () => {
  const results = [30,60,144].map(fps => {
    let value = 0; for(let i=0;i<fps;i++) value = dampAds(value,1,8,1/fps);
    return value;
  });
  assert.ok(Math.max(...results)-Math.min(...results) < 1e-12);
});
