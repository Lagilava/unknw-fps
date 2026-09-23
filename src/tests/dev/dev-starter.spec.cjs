const { test, expect } = require("@playwright/test");
const BASE = "http://127.0.0.1:8000";
const HTML = `${BASE}/first_person_shooter_room_game%20(1).html?test=1`;
const KEY = "rb-dev-active-v1";

test("opening dev.html auto-seeds & activates the Starter pack once", async ({ page }) => {
  // Ensure a clean slate so the first-run seed fires.
  // Clear ONLY on the very first load (sessionStorage sentinel survives reloads),
  // otherwise the reload below would wipe the store and falsely re-seed.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__cleared")) {
      localStorage.removeItem("rb-dev-store-v1");
      localStorage.removeItem("rb-dev-active-v1");
      localStorage.removeItem("rb-dev-starter-installed");
      sessionStorage.setItem("__cleared", "1");
    }
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/dev.html`, { waitUntil: "networkidle" });

  const state = await page.evaluate(() => ({
    installed: localStorage.getItem("rb-dev-starter-installed"),
    active: JSON.parse(localStorage.getItem("rb-dev-active-v1") || "{}"),
  }));
  expect(state.installed).toBe("1");
  expect(state.active._categories.sort()).toEqual(["camera", "lighting", "player", "weapons"]);
  expect(state.active.player.jumpVelocity).toBe(9.35);
  expect(state.active.camera.fpWalkFov).toBe(80.5);
  expect(state.active.weapons.sniper.damage).toBe(290.5);
  expect(state.active.lighting.ambientColor).toBe("#ffbb00");
  expect(errors).toEqual([]);

  // Second load must NOT re-seed (idempotent flag) — deactivate then reload.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("rb-dev-store-v1"));
    raw.active = {}; localStorage.setItem("rb-dev-store-v1", JSON.stringify(raw));
  });
  await page.reload({ waitUntil: "networkidle" });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("rb-dev-active-v1") || "{}"));
  expect(after._categories).toEqual([]); // stayed deactivated — no re-seed
});

test("enemy color + camera FP offset hot-apply live with no reload", async ({ page }) => {
  await page.goto(HTML, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => { window.__noReloadSentinel = true; });

  await page.evaluate((key) => {
    const snap = {
      version: 5, _categories: ["enemies", "camera"],
      enemies: { "Zombie": { hp: 240, speed: 6.5, damageMin: 11, damageMax: 17, attackRate: 0.55,
        scale: 1.6, xp: 5, glow: 0.6, color: "#ff0000", emissive: "#330000" } },
      camera: { fpWalkFov: 90, fpSprintFov: 100, tpWalkFov: 63, tpSprintFov: 70, near: 0.05, far: 480,
        cinematicFovOffset: -4, fpOffsetX: 0.2, fpOffsetY: 0.15, fpOffsetZ: -0.3,
        tpDistance: 1.34, tpShoulderX: 0.36, tpShoulderY: -0.52, tpCameraHeight: -0.86, tpCameraClearance: 0.34 },
    };
    const json = JSON.stringify(snap);
    localStorage.setItem(key, json);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: json, storageArea: localStorage }));
  }, KEY);

  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({
    reloaded: !window.__noReloadSentinel,
    zColor: window.__RB_DEV_ACTIVE?.enemies?.Zombie?.color,
    zScale: window.__RB_DEV_ACTIVE?.enemies?.Zombie?.scale,
    fpOffY: window.__RB_DEV_ACTIVE?.camera?.fpOffsetY,
    playing: window.__rbTest.getState(),
  }));
  expect(st.reloaded).toBe(false);
  expect(st.zColor).toBe("#ff0000");
  expect(st.zScale).toBe(1.6);
  expect(st.fpOffY).toBe(0.15);
  expect(st.playing).toBe("playing");
});
