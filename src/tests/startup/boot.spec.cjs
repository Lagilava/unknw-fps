const { test, expect } = require('@playwright/test');
for (const [name, url] of [
  ['multiplayer server', 'http://127.0.0.1:8011/?test=1'],
  ['production build', 'http://127.0.0.1:8012/play/?test=1'],
]) {
  test(`${name} boots and starts a mission`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && /\.(?:js|ts|css)(?:\?|$)/.test(response.url()))
        errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(url);
    await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 240000 });
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 30000 });
    expect(errors).toEqual([]);
  });
}
