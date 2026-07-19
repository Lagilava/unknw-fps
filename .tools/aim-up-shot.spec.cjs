const { test } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test("gun-in-hand poses", async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__rbReload && window.__rbReload().gunPos, { timeout: 30000 });
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // 1. Level ADS — triggers the hand-fit calibration capture, then rides the hand.
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/aim-level.png" });
  // 2. Steep down / steep up while ADS (gun should track the hand exactly).
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, -0.85));
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/aim-up.png" });
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0.7));
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/aim-down.png" });
  await page.mouse.up({ button: "right" });
  // 3. Hip carry (no ADS) and walking.
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-results/hip-idle.png" });
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-results/hip-walk.png" });
  await page.keyboard.up("KeyW");
});
