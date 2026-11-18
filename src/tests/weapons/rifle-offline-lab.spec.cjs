const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Serves the production build inside Chromium without binding a local port.
// Useful on Windows hosts where loopback sockets are unavailable to tests.
test('Blender rifle loads and the animation lab captures its reload', async ({ page }) => {
  test.setTimeout(240000);
  const root = path.resolve('dist');
  const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
    '.json':'application/json', '.glb':'model/gltf-binary', '.wasm':'application/wasm',
    '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.ogg':'audio/ogg',
    '.mp3':'audio/mpeg', '.wav':'audio/wav', '.svg':'image/svg+xml' };
  let rifleLoaded = false;
  await page.route('http://127.0.0.1:8000/**', async route => {
    const url = new URL(route.request().url());
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      await route.fulfill({ status: 404, body: 'Not found' }); return;
    }
    if (pathname.includes('rifle-reload-') && pathname.endsWith('.glb')) rifleLoaded = true;
    await route.fulfill({ status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto('http://127.0.0.1:8000/?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing' && window.__rbReload()?.rightHand,
    null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__rbTest.setUnlimitedHealth(true);
    window.__rbTest.grantGun('rifle');
    window.__rbTest.pauseForAnimationReview(true);
  });
  await expect.poll(() => rifleLoaded, { timeout: 15000 }).toBe(true);
  const result = await page.evaluate(() => window.__rbTest.reviewAnimation('player','reload'));
  expect(result.finite).toBe(true);
  expect(result.views).toHaveLength(10);
  const out = path.resolve('test-artifacts/rifle-prototype');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out,'rifle-in-game-angles.png'),Buffer.from(result.png.split(',')[1],'base64'));
});
