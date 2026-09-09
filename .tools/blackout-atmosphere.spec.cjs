const { test, expect } = require('@playwright/test');
test('blackout atmosphere renders and daylight returns', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error' && /shader|WebGLProgram/i.test(msg.text())) errors.push(msg.text()); });
  await page.goto('http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 30000 });
  await page.evaluate(() => { window.__rbTest.freeCamOff(); window.__rbTest.setWave(10); });
  await expect(page.locator('#hud')).toHaveAttribute('data-blackout', 'true');
  await page.keyboard.press('f');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-artifacts/blackout-atmosphere.png' });
  await page.evaluate(() => window.__rbTest.setWave(11));
  await expect(page.locator('#hud')).toHaveAttribute('data-blackout', 'false');
  await page.screenshot({ path: 'test-artifacts/blackout-daylight-restored.png' });
  expect(errors).toEqual([]);
});
