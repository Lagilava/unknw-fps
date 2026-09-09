const { test, expect } = require('@playwright/test');
test('relay replaces quota, requires presence, advances and resets', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 30000 });
  await page.evaluate(() => {
    const t = window.__rbTest;
    t.freeCamOff(); t.setWave(3); t.beginRelayForTest();
  });
  const relay = await page.evaluate(() => window.__rbTest.getRelay());
  expect(relay).toBeTruthy();
  await page.evaluate(() => window.__rbTest.completeWave());
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__rbTest.getRelay().wave)).toBe(3);
  await page.evaluate(() => window.__rbTest.tickRelayForTest(2));
  expect(await page.evaluate(() => window.__rbTest.getRelay().progress)).toBe(0);
  await page.evaluate(() => {
    const t = window.__rbTest, r = t.getRelay();
    t.teleportTo(r.x, r.z);
    t.spawnAt("Siege Drone", 1, 0);
    t.tickRelayForTest(2);
  });
  expect(await page.evaluate(() => window.__rbTest.getRelay().contested)).toBe(true);
  expect(await page.evaluate(() => window.__rbTest.getRelay().progress)).toBe(0);
  await page.evaluate(() => {
    const t = window.__rbTest;
    t.completeWave(); t.tickRelayForTest(18);
  });
  await page.waitForFunction(() => window.__rbTest.getState() === 'playing' && !window.__rbTest.getRelay(), null, { timeout: 30000 });
  const position = await page.evaluate(() => window.__rbTest.getPlayerPosition());
  expect(Math.hypot(position.x - relay.x, position.z - relay.z)).toBeLessThan(1);
  await page.evaluate(() => {
    const t = window.__rbTest;
    t.setWave(6); t.beginRelayForTest();
  });
  expect(await page.evaluate(() => window.__rbTest.getRelay())).toBeTruthy();
  await page.evaluate(() => window.__rbTest.restart());
  expect(await page.evaluate(() => window.__rbTest.getRelay())).toBeNull();
  expect(await page.evaluate(() => window.__rbTest.getState())).toBe('playing');
  expect(errors).toEqual([]);
});
