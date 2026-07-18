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
    return { n: es.length, kills: window.__rbTest.getKills(), target: es[0] };
  });
  // Detonate directly on an enemy: a centre hit (1200) must KILL an 820-HP drone.
  await page.evaluate((t) => window.__rbTest.detonateGrenadeAt(t.x, t.y + 0.8, t.z), before.target);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({ n: window.__rbTest.getEnemyDebug().length, kills: window.__rbTest.getKills() }));
  console.log("DAMAGE", JSON.stringify({ nBefore: before.n, nAfter: after.n, killsBefore: before.kills, killsAfter: after.kills }));
  expect(after.kills).toBeGreaterThan(before.kills); // a direct hit killed at least one enemy
});
