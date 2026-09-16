const { test, expect } = require("@playwright/test");
const BASE = "http://127.0.0.1:8000";

// The dev-console "cutscenes" category (modules/dev_engine.js). Verifies a
// developer preset actually reaches the cutscene runtime: the disable toggles
// are respected, and tuned durations/FOVs are what the cutscene runs with.

test("cutscenes: dev preset disables intro + blackout", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rb-dev-active-v1", JSON.stringify({
      version: 5,
      _categories: ["cutscenes"],
      cutscenes: {
        introEnabled: false, blackoutEnabled: false,
        introDurA: 3.4, introDurB: 2.2, introDurC: 2.3, introDurC2: 2.0,
        introDurGrab: 2.0, introDurZoom: 0.6, introTeleportFov: 45, introGrabOverheadHeight: 15.2,
        blackoutDurA: 5.1, blackoutDurB: 4.0, blackoutHandoffDur: 0.45, blackoutSunTiltFov: 46,
      },
    }));
  });
  await page.goto(`${BASE}/first_person_shooter_room_game%20(1).html?test=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });

  // Force-start hooks bypass the ?test=1 auto-skip guard but MUST still respect
  // an explicit developer disable.
  const introStarted = await page.evaluate(() => window.__rbTest.startIntroCutscene());
  const introState = await page.evaluate(() => window.__rbTest.getCutsceneState());
  expect(introStarted).toBe(false);
  expect(introState.active).toBe(false);

  const blackoutStarted = await page.evaluate(() => window.__rbTest.startBlackoutCutscene());
  const blackoutState = await page.evaluate(() => window.__rbTest.getCutsceneState());
  expect(blackoutStarted).toBe(false);
  expect(blackoutState.active).toBe(false);
});

test("cutscenes: dev preset re-times the intro and blackout on run", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rb-dev-active-v1", JSON.stringify({
      version: 5,
      _categories: ["cutscenes"],
      cutscenes: {
        introEnabled: true, blackoutEnabled: true,
        introDurA: 1.1, introDurB: 2.2, introDurC: 2.3, introDurC2: 2.0,
        introDurGrab: 2.0, introDurZoom: 0.6, introTeleportFov: 61, introGrabOverheadHeight: 15.2,
        blackoutDurA: 2.4, blackoutDurB: 4.0, blackoutHandoffDur: 0.45, blackoutSunTiltFov: 58,
      },
    }));
  });
  await page.goto(`${BASE}/first_person_shooter_room_game%20(1).html?test=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });

  await page.evaluate(() => window.__rbTest.startIntroCutscene());
  const introState = await page.evaluate(() => window.__rbTest.getCutsceneState());
  expect(introState.active).toBe(true);
  expect(introState.introDurA).toBe(1.1);
  expect(introState.introTeleportFov).toBe(61);

  // Cancel the intro before starting the blackout probe (both use `cutscene`).
  await page.evaluate(() => { window.__rbTest.freeCamOff(); });
  await page.evaluate(() => window.__rbTest.setWaveLighting(10));
  await page.evaluate(() => window.__rbTest.startBlackoutCutscene());
  const blackoutState = await page.evaluate(() => window.__rbTest.getCutsceneState());
  expect(blackoutState.active).toBe(true);
  expect(blackoutState.blackoutDurA).toBe(2.4);
  expect(blackoutState.blackoutSunTiltFov).toBe(58);
});
