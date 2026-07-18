const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("debris is tinted + sized per enemy type", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__ecs.enemyCount() > 0, { timeout: 20000 });

  await page.evaluate(() => window.__rbTest.killNearest());
  await page.waitForTimeout(60);
  const s = await page.evaluate(() => ({ active: window.__physics.debrisActive(), sample: window.__physics.debrisSample() }));
  console.log("TINT", JSON.stringify(s));
  expect(s.active).toBeGreaterThan(0);
  // Wave-1 enemy is the Siege Drone (color 0x77cfff, scale 1.12) — debris must be
  // tinted its colour (NOT the default 0x8a94a0) and sized around its scale.
  expect(s.sample.color).toBe(0x77cfff);
  expect(s.sample.color).not.toBe(0x8a94a0);
  expect(s.sample.scale).toBeGreaterThan(0.6); // scaled around 1.12 (0.7..1.3 jitter)
});
