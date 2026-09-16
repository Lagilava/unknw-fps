const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("collision agreement holds with ground collider, and kills spawn moving debris", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  // The big ground collider must NOT affect wall collision (queried at y>=~0.5).
  const agree = await page.evaluate(() => {
    const env = window.RoomBreachEnvironment;
    const { MAP_W, MAP_H, mapToWorld } = env; const r = 0.32;
    let total = 0, disagree = 0;
    for (let my = 1; my < MAP_H - 1; my++) for (let mx = 1; mx < MAP_W - 1; mx++) {
      const c = mapToWorld(mx, my);
      total++; if (window.__physics.blocksAt(c.x, c.z, r) !== env.wallAtWorldRadius(c.x, c.z, r)) disagree++;
    }
    return { total, disagree };
  });
  console.log("AGREE-GROUND", JSON.stringify(agree));
  expect(agree.disagree).toBe(0);

  // Start, kill an enemy, confirm debris activates and then moves under gravity.
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__ecs.enemyCount() > 0, { timeout: 20000 });
  expect(await page.evaluate(() => window.__physics.debrisActive())).toBe(0);
  await page.evaluate(() => window.__rbTest.killNearest());
  await page.waitForTimeout(60);
  const active = await page.evaluate(() => window.__physics.debrisActive());
  console.log("DEBRIS active after kill:", active);
  expect(active).toBeGreaterThan(0); // a burst spawned

  // Debris is physics-driven: a piece moves (falls/bounces) between samples.
  const s0 = await page.evaluate(() => window.__physics.debrisSample());
  await page.waitForTimeout(400);
  const s1 = await page.evaluate(() => window.__physics.debrisSample());
  const moved = s0 && s1 ? Math.hypot(s1.x-s0.x, s1.y-s0.y, s1.z-s0.z) : 0;
  console.log("DEBRIS moved", moved.toFixed(3), JSON.stringify({s0, s1}));
  expect(moved).toBeGreaterThan(0.02);
});
