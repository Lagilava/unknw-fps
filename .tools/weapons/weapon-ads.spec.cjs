const { test, expect } = require('@playwright/test');

test('all weapons aim inward with distinct sights and restore the shoulder view', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && m.text().includes('[animate]')) { errors.push(m.text()); console.log(m.text()); } });
  // Keep the full-scene test tractable on software-rendered CI browsers.
  await page.addInitScript(() => localStorage.setItem('rb-dev-active-v1', JSON.stringify({
    version:5, _categories:['quality'], quality:{renderer:'webgl',shadows:'off',renderScaleCap:.5,maxActiveLights:2,autoFallback:false}
  })));
  await page.goto('http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout:180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing');
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  const result = [];
  for (const gun of ['pistol','rifle','shotgun','smg','lmg','dmr','akimbo','flak','sniper']) {
    console.log('Checking ADS:', gun);
    await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', {button:2})));
    await page.evaluate(g => window.__rbTest.grantGun(g), gun);
    await page.waitForFunction(g => window.__rbView().gun === g && window.__rbView().ads < .03, gun, {timeout:30000}).catch(async e => {
      console.log('Stalled view:', await page.evaluate(() => ({view:window.__rbView(),stats:window.__rbTest.getFrameStats()})));
      throw e;
    });
    const hip = await page.evaluate(() => window.__rbView().targetFov);
    await page.locator('#gameCanvas').dispatchEvent('mousedown', {button:2});
    await page.waitForFunction(() => window.__rbView().ads > .95, null, {timeout:20000});
    const view = await page.evaluate(() => window.__rbView());
    expect(view.targetFov).toBeLessThan(hip);
    await expect(page.locator('#weapon-aim-sight')).toBeVisible();
    await expect(page.locator('#weapon-aim-sight')).toHaveAttribute('data-weapon', gun);
    await expect(page.locator('#weapon-aim-sight')).toHaveAttribute('data-sight', view.sight);
    await expect(page.locator('#xhair')).toHaveCSS('opacity', '0');
    if (['pistol','dmr','sniper'].includes(gun)) await page.screenshot({path:`test-artifacts/ads-${gun}.png`});
    result.push({gun, fov:view.targetFov, sight:view.sight});
  }
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', {button:2})));
  await page.waitForFunction(() => window.__rbView().ads < .02, null, {timeout:20000});
  await expect(page.locator('#weapon-aim-sight')).toBeHidden();
  expect(new Set(result.map(v => v.sight)).size).toBe(6);
  expect(result.find(v => v.gun === 'sniper').fov).toBeLessThan(result.find(v => v.gun === 'dmr').fov);
  expect(errors).toEqual([]);
  console.log('ADS profiles:', result);
});
