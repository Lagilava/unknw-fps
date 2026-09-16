const { test } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test("ui screenshots", async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "test-results/ui-loading.png" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/ui-menu.png" });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "test-results/ui-hud.png" });
});
