const { test, expect } = require('@playwright/test');

test('idle look keeps feet free and XP stays readable across HUD sizes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => {
    const t = window.__rbTest;
    t.freeCamOff(); t.setUnlimitedHealth(true); t.tpTo(0, 42); t.giveXp(1250);
  });
  await expect(page.locator('#wallet-readout')).toBeVisible();
  await expect(page.locator('#xp-val')).toHaveText('1250');
  for (const angle of [0.4, -0.4, 1.2, -1.2, 3.15, 6.3, 0]) {
    await page.evaluate(a => window.__rbTest.tpTo(0, 42, a, 0.25), angle);
    await page.waitForTimeout(120);
    const feet = await page.evaluate(() => window.__rbFootIK());
    expect(feet.hasLegs).toBe(true);
    expect(feet.left.locked || feet.right.locked).toBe(false);
    expect(feet.left.weight + feet.right.weight).toBe(0);
    for (const foot of [feet.left.foot, feet.right.foot]) expect(foot.every(Number.isFinite)).toBe(true);
  }
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, -0.12));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-artifacts/map-arena-finish.png' });
  await page.evaluate(() => window.__rbTest.tpTo(0, 145, Math.PI, -0.05));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-artifacts/map-street-finish.png' });
  const booms = await page.evaluate(() => {
    const result = [];
    for (let i = 0; i < 72; i++) {
      window.__rbTest.tpTo(-63.5, 42, i * Math.PI / 36);
      result.push(window.__rbTest.getCutsceneState().tpLocalPos);
    }
    return result;
  });
  const shoulderSlope = booms[0][0] / booms[0][2];
  const lengths = booms.map(boom => Math.hypot(...boom));
  expect(Math.min(...lengths)).toBeLessThan(Math.max(...lengths) * 0.75);
  for (const boom of booms) {
    expect(boom.every(Number.isFinite)).toBe(true);
    expect(boom[0] / boom[2]).toBeCloseTo(shoulderSlope, 5);
  }
  await page.evaluate(() => window.__rbTest.giveXp(-250));
  await expect(page.locator('#xp-val')).toHaveText('1000');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#wallet-readout')).toBeVisible();
  const box = await page.locator('#wallet-readout').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
