const { test } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
async function boot(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForTimeout(1200);
}
test("intro beats", async ({ page }) => {
  test.setTimeout(540000);
  await boot(page);
  await page.evaluate(() => window.__rbTest.startIntroCutscene());
  // Headless SwiftShader renders the aerial beat at ~1fps — jump the intro clock
  // to each beat instead of waiting real time (real GPUs run it fine).
  const at = async (t, path) => { await page.evaluate((tt) => window.__rbTest.introJump(tt), t); await page.waitForTimeout(2600); await page.screenshot({ path }); };
  await at(1.15, "test-results/cs-intro-tron.png");
  await at(2.75, "test-results/cs-intro-render.png");
  await at(4.5, "test-results/cs-intro-choir.png");
  await at(6.9, "test-results/cs-intro-teleport.png");
  await at(8.9, "test-results/cs-intro-sunarrive.png");
  await at(11.1, "test-results/cs-intro-grab.png");
  await page.evaluate(() => window.__rbTest.introJump(12.94));
  await page.waitForFunction(() => !window.__rbTest.getCutsceneState().active, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/cs-intro-end.png" });
});
test("blackout beats", async ({ page }) => {
  test.setTimeout(540000);
  await boot(page);
  await page.evaluate(() => window.__rbTest.startBlackoutCutscene());
  const at = async (t, path) => { await page.waitForFunction((tt) => window.__rbTest.getCutsceneState().t > tt, t, { timeout: 90000 }); await page.screenshot({ path }); };
  await at(0.9, "test-results/cs-bo-wide.png");
  await at(2.3, "test-results/cs-bo-close.png");
  await page.waitForFunction((tt) => window.__rbTest.getCutsceneState().t > tt, 8.1, { timeout: 300000 }); await page.screenshot({ path: "test-results/cs-bo-advance.png" });
  await page.waitForFunction(() => !window.__rbTest.getCutsceneState().active, { timeout: 180000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/cs-bo-end.png" });
});
