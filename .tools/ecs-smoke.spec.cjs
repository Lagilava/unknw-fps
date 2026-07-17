const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test("ECS world tracks enemies alongside enemies[]", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  // miniplex loaded via importmap CDN if we got here without a module error.
  expect(await page.evaluate(() => !!window.__ecs)).toBe(true);
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.waitForFunction(() => window.__ecs.enemyCount() > 0, { timeout: 20000 });
  const ecsCount = await page.evaluate(() => window.__ecs.enemyCount());
  console.log("ECS enemy entities:", ecsCount);
  expect(ecsCount).toBeGreaterThan(0);
});
