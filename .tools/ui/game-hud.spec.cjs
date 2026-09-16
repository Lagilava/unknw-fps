const { test, expect } = require('@playwright/test');
test('full combat HUD boots and fits desktop and mobile', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout:180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout:30000 });
  await expect(page.locator('#hud')).toHaveClass(/combat-hud/);
  await expect(page.locator('#equipment-readout')).toContainText('UTILITY CHARGE');
  await expect(page.locator('#mission-header #wave-val')).toBeVisible();
  await expect(page.locator('#health-condition')).not.toBeEmpty();
  await expect(page.locator('#encounter-progress')).toHaveAttribute('aria-valuenow', /\d+/);
  await page.screenshot({ path:'test-artifacts/game-hud-desktop.png' });
  const health = await page.locator('.health-readout').boundingBox();
  const weapon = await page.locator('.weapon-readout').boundingBox();
  expect(health.x + health.width).toBeLessThan(weapon.x);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({ path:'test-artifacts/game-hud-mobile.png' });
  for (const selector of ['#center-hud','#minimap-canvas','.health-readout','.weapon-readout']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(391);
  }
  const mobileHealth = await page.locator('.health-readout').boundingBox();
  const mobileWeapon = await page.locator('.weapon-readout').boundingBox();
  expect(mobileHealth.x + mobileHealth.width).toBeLessThanOrEqual(mobileWeapon.x);
  expect(errors).toEqual([]);
});

