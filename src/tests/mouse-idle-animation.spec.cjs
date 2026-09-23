const { test, expect } = require('@playwright/test');

test('mouse-only look keeps the idle clip through input gaps and simulation substeps', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => {
    const t = window.__rbTest;
    t.freeCamOff(); t.setUnlimitedHealth(true); t.pauseForAnimationReview(true); t.tpTo(0, 42);
  });
  // Acquire real pointer lock without firing a weapon; subsequent events go
  // through the game's mousemove listener, not a direct yaw test setter.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => !document.pointerLockElement);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'test-lock'; button.textContent = 'Lock mouse';
    button.style.cssText = 'position:fixed;top:0;left:0;z-index:999999';
    button.onclick = () => document.getElementById('gameCanvas').requestPointerLock();
    document.body.append(button);
  });
  await page.locator('#test-lock').click({ timeout: 10000 });
  await page.waitForFunction(() => document.pointerLockElement === document.getElementById('gameCanvas'), null, { timeout: 10000 });
  await page.waitForFunction(() => window.__rbTest.getPlayerAnimation().mouseLocked, null, { timeout: 10000 });
  for (const gun of ['pistol', 'rifle']) {
    const samples = await page.evaluate(gun => {
      const t = window.__rbTest;
      t.grantGun(gun);
      for (let i = 0; i < 90; i++) t.tickReloadForTest(1 / 60);
      const baseline = t.getPlayerAnimation();
      const frames = [];
      for (const dx of [12, 0, 12, 0, -12, 0, 1, 0, -1, 30, -30]) {
        window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dx / 4 }));
        // 30 FPS: two physics/animation updates share one mouse sample.
        for (let step = 0; step < 2; step++) {
          t.tickReloadForTest(1 / 60);
          frames.push(t.getPlayerAnimation());
        }
      }
      return { baseline, frames };
    }, gun);
    expect(samples.baseline.action).toBe(gun === 'pistol' ? 'idlePistol' : 'idleRifle');
    expect(samples.baseline.state).toBe('playing');
    expect(samples.baseline.mouseLocked).toBe(true);
    expect(samples.frames.some(f => f.yaw !== samples.baseline.yaw)).toBe(true);
    for (const frame of samples.frames) {
      expect(frame.action).toBe(samples.baseline.action);
      expect(frame.position).toEqual(samples.baseline.position);
    }
  }
  await page.evaluate(() => {
    document.getElementById('test-lock').remove();
    document.exitPointerLock();
    window.__rbTest.pauseForAnimationReview(false);
    window.__rbTest.freeCam(-7.5, 5, 131, -13.5, 4.5, 137, 50);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-artifacts/streetlight-left-fixed.png' });
  await page.evaluate(() => window.__rbTest.freeCam(14.5, 5, 131, 20.5, 4.5, 137, 50));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-artifacts/streetlight-right-fixed.png' });
  expect(errors).toEqual([]);
});
