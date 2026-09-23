const { test, expect } = require('@playwright/test');

test('wave protection, pursuit, and blackout arc-caster rules', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 30000 });

  expect(await page.evaluate(() => window.__rbTest.getWaveProtection())).toBeGreaterThan(4);
  const protectedDamage = await page.evaluate(() => window.__rbTest.forceDamage(40));
  expect(protectedDamage.hp).toBe(100);

  await page.waitForFunction(() => window.__rbTest.getEnemyDebug().every(enemy => enemy.aggroed), null, { timeout: 5000 });

  await page.evaluate(() => window.__rbTest.setWave(10));
  expect(await page.evaluate(() => window.__rbTest.isBlackoutHudDisrupted())).toBe(true);
  await expect(page.locator('#center-hud')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#xhair')).toHaveCSS('visibility', 'hidden');

  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const before = window.__rbTest.getAmmo();
    window.__rbTest.fireAtNearest();
    return { before, after: window.__rbTest.getAmmo(), diagnostics: window.__rbTest.getRuntimeCounts() };
  });
  expect(result.after.mag).toBe(result.before.mag);
  expect(result.after.reserve).toBe(result.before.reserve);
  expect(result.diagnostics.lightningEffects).toBeGreaterThan(0);

  await page.evaluate(() => window.__rbTest.setWave(11));
  expect(await page.evaluate(() => window.__rbTest.isBlackoutHudDisrupted())).toBe(false);
  expect(errors).toEqual([]);
});
