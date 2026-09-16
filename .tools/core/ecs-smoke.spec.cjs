const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test("ECS world stays in lock-step with enemies[] (add + query parity)", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  // If miniplex failed to load via the importmap CDN, boot would have thrown.
  expect(await page.evaluate(() => !!window.__ecs)).toBe(true);
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.waitForFunction(() => window.__ecs.enemyCount() > 0, { timeout: 20000 });
  // Parity: the ECS query and the game's live-enemy array report the same count
  // (the register/unregister strangler seam holds the same objects in both).
  const parity = await page.evaluate(() => ({
    ecs: window.__ecs.enemyCount(),
    arr: window.__rbTest.getEnemyCount(),
  }));
  console.log("PARITY", JSON.stringify(parity));
  expect(parity.ecs).toBe(parity.arr);
  expect(parity.ecs).toBeGreaterThan(0);
});
