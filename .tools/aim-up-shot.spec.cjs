const { test } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test("aim-up pose screenshot", async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__rbReload && window.__rbReload().gunPos, { timeout: 30000 });
  // Look steeply UP (the reported broken pose) and hold ADS.
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, -0.85));
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-results/aim-up.png" });
  // And steeply DOWN.
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0.7));
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/aim-down.png" });
  // And level.
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/aim-level.png" });
  await page.mouse.up({ button: "right" });
});
