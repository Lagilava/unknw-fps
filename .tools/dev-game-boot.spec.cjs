const { test, expect } = require("@playwright/test");
const BASE = "http://127.0.0.1:8000";

test("game reads the dev snapshot and applies a player + camera preset", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rb-dev-active-v1", JSON.stringify({
      version: 3,
      _categories: ["player", "camera", "debug"],
      player: { speed: 12.34, sprintSpeed: 20, startingWeapon: "sniper", maxHp: 250, hp: 250,
        radius: 0.32, maxStamina: 100, staminaDrain: 36, staminaRegen: 22,
        jumpVelocity: 5.85, jumpGravity: 13.6, maxJumpOffset: 1.12,
        unlimitedHealth: false, unlimitedSprint: true, unlimitedAmmo: false },
      camera: { fpWalkFov: 111, fpSprintFov: 100, tpWalkFov: 63, tpSprintFov: 70,
        near: 0.05, far: 480, cinematicFovOffset: -4, tpDistance: 1.34,
        tpShoulderX: 0.36, tpShoulderY: -0.52, tpCameraHeight: -0.86, tpCameraClearance: 0.34 },
      debug: { godMode: false, freezeEnemies: false, spawnWaveOverride: 0,
        showConfigBanner: true, autoReloadOnStructural: true },
    }));
  });

  await page.goto(`${BASE}/first_person_shooter_room_game%20(1).html?test=1`, { waitUntil: "domcontentloaded" });

  // The DEV bootstrap runs very early in the IIFE — wait for the global.
  await page.waitForFunction(() => !!window.__RB_DEV_ACTIVE, null, { timeout: 60000 });

  const snap = await page.evaluate(() => window.__RB_DEV_ACTIVE);
  expect(snap.player.speed).toBe(12.34);
  expect(snap.player.startingWeapon).toBe("sniper");
  expect(snap.camera.fpWalkFov).toBe(111);

  // The on-HUD DEV banner is intentionally NOT rendered (removed per design).
  await expect(page.locator("#dev-preset-banner")).toHaveCount(0);
});

test("with no active preset the game runs stock (no banner, empty snapshot)", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("rb-dev-active-v1"));
  await page.goto(`${BASE}/first_person_shooter_room_game%20(1).html?test=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__RB_DEV_ACTIVE, null, { timeout: 60000 });
  const snap = await page.evaluate(() => window.__RB_DEV_ACTIVE);
  expect(snap._categories).toEqual([]);
  await page.waitForTimeout(1500);
  await expect(page.locator("#dev-preset-banner")).toHaveCount(0);
});
