const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test('profile gameplay CPU without changing graphics settings', async ({ page }) => {
  await page.goto('http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => { const t = window.__rbTest; t.freeCamOff(); t.setUnlimitedHealth(true); t.tpTo(0, 145, Math.PI); });
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const frames = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(500);
    frames.push(await page.evaluate(() => window.__rbTest.getFrameStats()));
  }
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const child of n.children || []) parent.set(child, n.id);
  const self = new Map(), inclusive = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    let id = profile.samples[i]; const time = profile.timeDeltas[i] / 1000;
    const key = n => `${n.callFrame.functionName || '(anonymous)'} @ ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    self.set(key(byId.get(id)), (self.get(key(byId.get(id))) || 0) + time);
    const seen = new Set();
    while (id) {
      const name = key(byId.get(id));
      if (!seen.has(name)) inclusive.set(name, (inclusive.get(name) || 0) + time);
      seen.add(name); id = parent.get(id);
    }
  }
  const top = map => [...map].sort((a,b) => b[1]-a[1]).slice(0, 35).map(([name, ms]) => ({ name, ms: Math.round(ms) }));
  const report = { frames, self: top(self), inclusive: top(inclusive) };
  fs.mkdirSync('test-artifacts', { recursive: true });
  fs.writeFileSync(`test-artifacts/cpu-${process.env.PROFILE_LABEL || 'current'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  expect(frames.every(f => f.drawCalls > 0 && f.shadows)).toBe(true);
});
