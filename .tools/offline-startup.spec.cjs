const { test, expect } = require('@playwright/test');
test('standalone game starts with external networking blocked', async ({ page }) => {
  const external = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') {
      external.push(url.href); return route.abort('internetdisconnected');
    }
    return route.continue();
  });
  await page.goto('http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  expect(await page.evaluate(async () => typeof (await import('peerjs')).Peer)).toBe('function');
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__rbTest.getEnemyCount())).toBeGreaterThan(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
