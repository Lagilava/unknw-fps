const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("grenade: physics throw + fuse detonation + AoE damage via ECS", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__ecs.enemyCount() > 0, { timeout: 20000 });

  // --- Physics throw + fuse: a grenade becomes active, then detonates (count -> 0) ---
  const thrown = await page.evaluate(() => window.__rbTest.throwGrenade());
  console.log("thrown active =", thrown);
  expect(thrown).toBe(1);
  await page.waitForFunction(() => window.__rbTest.grenadeCount() === 0, { timeout: 20000 });
  console.log("grenade detonated (count back to 0)");

  // --- AoE damage via ECS: detonate on the enemy centroid, total enemy hp drops ---
  const before = await page.evaluate(() => {
    const es = window.__rbTest.getEnemyDebug();
    const c = es.reduce((a, e) => ({ x: a.x + e.x, y: a.y + e.y, z: a.z + e.z }), { x: 0, y: 0, z: 0 });
    const n = es.length || 1;
    return { totalHp: es.reduce((a, e) => a + e.hp, 0), n: es.length, cx: c.x / n, cy: c.y / n, cz: c.z / n };
  });
  await page.evaluate(({ x, y, z }) => window.__rbTest.detonateGrenadeAt(x, y + 1, z), { x: before.cx, y: before.cy, z: before.cz });
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => {
    const es = window.__rbTest.getEnemyDebug();
    return { totalHp: es.reduce((a, e) => a + e.hp, 0), n: es.length, kills: window.__rbTest.getKills() };
  });
  console.log("HP", JSON.stringify({ before: before.totalHp, after: after.totalHp, nBefore: before.n, nAfter: after.n, kills: after.kills }));
  // damage landed: either total hp fell or some enemies died
  expect(after.totalHp < before.totalHp || after.n < before.n).toBe(true);
});
