const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("daytime scene has no car head/tail point lights (low light count)", async ({ page }) => {
  await page.addInitScript(() => {
    for (const k of ["rb-dev-store-v1", "rb-dev-active-v1", "rb-dev-starter-installed"]) localStorage.removeItem(k);
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => typeof window.__rbCountLights === "function", { timeout: 15000 });

  const lights = await page.evaluate(() => window.__rbCountLights());
  console.log("LIGHTBREAKDOWN " + JSON.stringify(lights));
  // The 7 cars added 14 real-time PointLights (2 each) to the outdoor arena.
  // With them disabled for the daytime scene the total drops well below the
  // pre-fix ~32 (headless uses fallback enemies which add their own lights, so
  // we assert the car-light reduction rather than an absolute floor).
  expect(lights.PointLight).toBeLessThanOrEqual(20);
});
