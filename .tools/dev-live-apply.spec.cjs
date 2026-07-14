const { test, expect } = require("@playwright/test");
const HTML = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
const KEY = "rb-dev-active-v1";

async function bootAndPlay(page) {
  await page.goto(HTML, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
}

// Simulate what dev.html does in another tab: write the snapshot + fire `storage`.
async function pushSnapshot(page, snap) {
  await page.evaluate(({ key, snap }) => {
    const json = JSON.stringify(snap);
    localStorage.setItem(key, json);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: json, storageArea: localStorage }));
  }, { key: KEY, snap });
}

test("tuning categories hot-apply live with NO reload", async ({ page }) => {
  await bootAndPlay(page);
  // Sentinel: survives a live re-apply, wiped by a reload.
  await page.evaluate(() => { window.__noReloadSentinel = true; });

  await pushSnapshot(page, {
    version: 4, _categories: ["player", "camera", "gameplay"],
    player: { speed: 15.5, sprintSpeed: 22, maxHp: 300, hp: 300, radius: 0.32, maxStamina: 100,
      staminaDrain: 36, staminaRegen: 22, jumpVelocity: 9, jumpGravity: 13.6, maxJumpOffset: 1.12,
      unlimitedHealth: false, unlimitedSprint: true, unlimitedAmmo: false, startingWeapon: "rifle" },
    camera: { fpWalkFov: 120, fpSprintFov: 100, tpWalkFov: 63, tpSprintFov: 70, near: 0.05, far: 480,
      cinematicFovOffset: -4, tpDistance: 1.34, tpShoulderX: 0.36, tpShoulderY: -0.52, tpCameraHeight: -0.86, tpCameraClearance: 0.34 },
    gameplay: { waveCountBase: 1.6, waveCountPerWave: 1.35, waveCountMax: 20, hpScalePerWave: 0.05, hpScaleMax: 1.85,
      speedScalePerWave: 0.022, speedScaleMax: 0.45, damageScalePerWave: 0.032, damageScaleMax: 0.7,
      playerDamageMult: 2, enemyDamageMult: 1 },
  });

  await page.waitForTimeout(300);
  const state = await page.evaluate(() => ({
    reloaded: !window.__noReloadSentinel,
    devSpeed: window.__RB_DEV_ACTIVE?.player?.speed,
    devFov: window.__RB_DEV_ACTIVE?.camera?.fpWalkFov,
    playing: window.__rbTest.getState(),
    toast: !!document.getElementById("dev-applied-toast"),
    noBanner: !document.getElementById("dev-preset-banner"),
  }));

  expect(state.reloaded).toBe(false);          // ← the key assertion: no reload
  expect(state.devSpeed).toBe(15.5);           // snapshot swapped in place
  expect(state.devFov).toBe(120);
  expect(state.playing).toBe("playing");        // still in the same session
  expect(state.toast).toBe(true);               // live-applied confirmation shown
  expect(state.noBanner).toBe(true);            // no persistent HUD banner
});

test("deactivating a category live reverts to built-ins with NO reload", async ({ page }) => {
  await bootAndPlay(page);
  await page.evaluate(() => { window.__noReloadSentinel = true; });
  // activate then clear
  await pushSnapshot(page, { version: 4, _categories: ["player"], player: { speed: 3, maxHp: 100, hp: 100, radius: 0.32, sprintSpeed: 9.2, maxStamina: 100, staminaDrain: 36, staminaRegen: 22, jumpVelocity: 5.85, jumpGravity: 13.6, maxJumpOffset: 1.12, unlimitedHealth: false, unlimitedSprint: true, unlimitedAmmo: false, startingWeapon: "rifle" } });
  await page.waitForTimeout(150);
  await pushSnapshot(page, { version: 4, _categories: [] });
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({
    reloaded: !window.__noReloadSentinel,
    cats: window.__RB_DEV_ACTIVE?._categories,
    banner: !!document.getElementById("dev-preset-banner"),
  }));
  expect(st.reloaded).toBe(false);
  expect(st.cats).toEqual([]);
  expect(st.banner).toBe(false); // banner removed when nothing active
});

test("a map change DOES reload (structural)", async ({ page }) => {
  await bootAndPlay(page);
  await page.evaluate(() => { window.__noReloadSentinel = true; });
  await pushSnapshot(page, {
    version: 4, _categories: ["map"],
    map: { rows: ["#####", "#...#", "#.+.#", "#...#", "#####"], cell: 4 },
  });
  // reload is scheduled ~300ms out; give it time, then the sentinel is gone.
  await page.waitForFunction(() => !window.__noReloadSentinel, null, { timeout: 20000 });
  expect(await page.evaluate(() => !window.__noReloadSentinel)).toBe(true);
});
