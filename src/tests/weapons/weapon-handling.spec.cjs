const { test, expect } = require('@playwright/test');
test('all nine weapons reload, cancel, aim, and fit the body', async ({page}) => {
  test.setTimeout(600000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('rb-dev-active-v1', JSON.stringify({
    version:5,_categories:['quality'],quality:{renderer:'webgl',shadows:'off',renderScaleCap:.5,maxActiveLights:2,autoFallback:false}
  })));
  await page.goto('http://127.0.0.1:3000/?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1',null,{timeout:240000});
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing',null,{timeout:60000});
  await page.waitForFunction(() => window.__rbReload()?.rightHand,null,{timeout:60000});
  await page.evaluate(() => { window.__rbTest.setUnlimitedHealth(true); window.__rbTest.pauseForAnimationReview(true); });
  const results = [];
  for (const gun of ['pistol','rifle','shotgun','sniper','smg','lmg','dmr','akimbo','flak']) {
    await page.evaluate(g => {
      window.__rbTest.grantGun(g);
      for(let i=0;i<120;i++) window.__rbTest.tickHandlingForTest(1/60);
    },gun);
    const before = await page.evaluate(() => window.__rbTest.getAmmo());
    await page.evaluate(() => window.__rbTest.startReloadForTest());
    const during = await page.evaluate(() => {
      const duration = window.__rbTest.getAmmo().reloadTimer;
      let clip = false;
      for(let i=0;i<120;i++) {
        const r = window.__rbTest.tickHandlingForTest(duration/240);
        clip ||= r.reload.clipVisible;
      }
      return {ammo:window.__rbTest.getAmmo(),body:window.__rbReload(),clip};
    });
    expect(during.ammo.reloadTimer).toBeGreaterThan(0);
    expect(during.body.reloading).toBe(true);
    expect(during.body.reloadT).toBeCloseTo(.5,1);
    expect(during.clip).toBe(true);
    const after = await page.evaluate(() => {
      const remaining = window.__rbTest.getAmmo().reloadTimer;
      window.__rbTest.tickHandlingForTest(remaining + .001);
      return {ammo:window.__rbTest.getAmmo(),body:window.__rbReload()};
    });
    expect(after.ammo.mag).toBe(before.mag);
    expect(after.ammo.reserve).toBe(before.reserve - 1);
    expect(after.body.reloading).toBe(false);
    expect(after.body.clipVisible).toBe(false);
    expect(after.body.magVisible).toBe(true);
    await page.locator('#gameCanvas').dispatchEvent('mousedown',{button:2});
    const aimed = await page.evaluate(() => {
      let r; for(let i=0;i<120;i++) r = window.__rbTest.tickHandlingForTest(1/60);
      window.__rbTest.tickHandlingForTest(0,true);
      return r;
    });
    expect(aimed.view.ads).toBeGreaterThan(.95);
    expect(aimed.view.fov).toBeCloseTo(aimed.view.targetFov,3);
    expect(aimed.fit.valid).toBe(true);
    expect(Number.isFinite(aimed.fit.rightError)).toBe(true);
    expect(aimed.fit.length).toBeLessThanOrEqual(1);
    await expect(page.locator('#weapon-aim-sight')).toBeVisible();
    await expect(page.locator('#weapon-aim-sight')).toHaveAttribute('data-weapon',gun);
    await page.screenshot({path:'test-artifacts/handling-' + gun + '.png'});
    await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup',{button:2})));
    const lowered = await page.evaluate(() => {
      let r; for(let i=0;i<120;i++) r = window.__rbTest.tickHandlingForTest(1/60);
      return r.view.ads;
    });
    expect(lowered).toBeLessThan(.01);
    // Direct grants use the same final switch commit as mystery-box pickups.
    await page.evaluate(g => {
      window.__rbTest.startReloadForTest();
      window.__rbTest.grantGun(g === 'pistol' ? 'rifle' : 'pistol');
    },gun);
    const switched = await page.evaluate(() => ({ammo:window.__rbTest.getAmmo(),reload:window.__rbReload()}));
    expect(switched.ammo.reloadTimer).toBe(0);
    expect(switched.reload.reloading).toBe(false);
    expect(switched.reload.clipVisible).toBe(false);
    results.push({gun,fit:aimed.fit,fov:aimed.view.fov});
  }
  console.log(JSON.stringify(results,null,2));
  expect(errors).toEqual([]);
});
