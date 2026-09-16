const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("game is third-person only — aiming never switches to first person", async ({ page }) => {
  await page.addInitScript(() => { for (const k of ["rb-dev-store-v1","rb-dev-active-v1","rb-dev-starter-installed"]) localStorage.removeItem(k); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && typeof window.__rbView === "function", { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });

  // Baseline: third person, no FP.
  let v = await page.evaluate(() => window.__rbView());
  expect(v.thirdPersonOnly).toBe(true);
  expect(v.thirdPersonEnabled).toBe(true);
  expect(v.fpAdsView).toBe(false);
  expect(v.unifiedFpBody).toBe(false);

  // Hold aim (right mouse) — must NOT flip to a first-person ADS view.
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(600);
  v = await page.evaluate(() => window.__rbView());
  await page.mouse.up({ button: "right" });
  expect(v.thirdPersonEnabled).toBe(true);
  expect(v.fpAdsView).toBe(false);
  expect(v.unifiedFpBody).toBe(false);

  // Pressing the view-toggle key (V) must be a no-op.
  await page.keyboard.press("KeyV");
  await page.waitForTimeout(150);
  v = await page.evaluate(() => window.__rbView());
  expect(v.thirdPersonEnabled).toBe(true);
});
