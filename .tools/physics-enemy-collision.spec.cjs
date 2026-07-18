const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("enemy-radius physics collision agrees with grid, and enemies still move", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  // Agreement at the default enemy collision radius (0.5).
  const agree = await page.evaluate(() => {
    const env = window.RoomBreachEnvironment;
    const { MAP_W, MAP_H, CELL, mapToWorld } = env;
    const r = 0.5; let total = 0, disagree = 0; const samples = [];
    for (let my = 1; my < MAP_H - 1; my++) for (let mx = 1; mx < MAP_W - 1; mx++) {
      const c = mapToWorld(mx, my);
      for (const [ox, oz] of [[0,0],[CELL*0.35,0],[0,CELL*0.35]]) {
        const x = c.x+ox, z = c.z+oz;
        const phys = window.__physics.blocksAt(x, z, r);
        const grid = env.wallAtWorldRadius(x, z, r);
        total++; if (phys !== grid) { disagree++; if (samples.length<10) samples.push({x:+x.toFixed(2),z:+z.toFixed(2),phys,grid}); }
      }
    }
    return { total, disagree, pct:+(100*(1-disagree/total)).toFixed(2), samples };
  });
  console.log("ENEMY-AGREE", JSON.stringify(agree));
  expect(agree.pct).toBeGreaterThan(98);

  // Enemies spawn and MOVE (not stuck against physics colliders at spawn).
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__ecs.enemyCount() > 0, { timeout: 20000 });
  const p0 = await page.evaluate(() => window.__rbTest.getEnemyDebug().map(e => ({x:e.x, z:e.z})));
  await page.waitForTimeout(2500);
  const p1 = await page.evaluate(() => window.__rbTest.getEnemyDebug().map(e => ({x:e.x, z:e.z})));
  let maxMove = 0;
  for (let i = 0; i < Math.min(p0.length, p1.length); i++) {
    maxMove = Math.max(maxMove, Math.hypot(p1[i].x - p0[i].x, p1[i].z - p0[i].z));
  }
  console.log("ENEMY-MOVE maxMove=", maxMove.toFixed(3), "n=", p0.length);
  expect(maxMove).toBeGreaterThan(0.03); // enemies advance, not frozen-stuck (magnitude is throttled in headless)
});
