const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("firing ejects brass physics shell casings", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  // wait for the TP weapon to exist (casings eject from it)
  await page.waitForFunction(() => window.__rbReload && window.__rbReload().gunPos, { timeout: 30000 });

  expect(await page.evaluate(() => window.__physics.debrisActive())).toBe(0);
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
  await page.waitForTimeout(80);

  const s = await page.evaluate(() => ({ active: window.__physics.debrisActive(), sample: window.__physics.debrisSample() }));
  console.log("CASINGS", JSON.stringify(s));
  expect(s.active).toBeGreaterThan(0);              // casings ejected on fire
  expect(s.sample.color).toBe(0xc9a227);            // brass
  expect(s.sample.scale).toBeLessThan(0.18);        // small, pistol-sized (0.13)
});
