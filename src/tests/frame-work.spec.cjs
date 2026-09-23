const { test, expect } = require('@playwright/test');

test('map ray indexes are ready and shader resize avoids frame layout reads', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  const indexed = await page.evaluate(() => window.__wallMeshes.filter(m => m.geometry?.boundsTree).length);
  expect(indexed).toBeGreaterThan(0);
  console.log({ indexedMapMeshes: indexed });
  const introResources = await page.evaluate(() => window.__rbTest.getIntroResources());
  expect(introResources.built).toBe(true);
  expect(introResources.hidden).toBe(true);
  expect(introResources.choirIds).toHaveLength(3);
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing');
  await page.setViewportSize({ width: 900, height: 600 });
  await page.waitForFunction(() => window.__rbWeaponSkin.uniforms.iResolution.value.x === 900 && window.__rbWeaponSkin.uniforms.iResolution.value.y === 600);
  const reads = await page.evaluate(async () => {
    const canvas = document.querySelector('#gameCanvas');
    let count = 0;
    for (const key of ['clientWidth', 'clientHeight']) {
      const getter = Object.getOwnPropertyDescriptor(Element.prototype, key).get;
      Object.defineProperty(canvas, key, { configurable: true, get() { count++; return getter.call(this); } });
    }
    // Let complete gameplay frames run, including shader and HUD updates.
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    delete canvas.clientWidth;
    delete canvas.clientHeight;
    return count;
  });
  expect(reads).toBe(0);
  expect(await page.evaluate(() => window.__rbTest.startIntroCutscene())).toBe(true);
  const startedResources = await page.evaluate(() => window.__rbTest.getIntroResources());
  expect(startedResources.wireId).toBe(introResources.wireId);
  expect(startedResources.beamId).toBe(introResources.beamId);
  expect(startedResources.choirIds).toEqual(introResources.choirIds);
  await page.screenshot({ path: 'test-artifacts/intro-prewarmed.png' });
  expect(errors).toEqual([]);
});
