const { test, expect } = require("@playwright/test");

const BASE = "http://127.0.0.1:8000";

// Stage 1 "Live Preview" dock in dev.html: embeds the real game (same-origin
// iframe) so a developer can tune a dev-console parameter and watch it land
// live, in one screen. One test covers the whole lifecycle to amortize the
// ~15-60s game boot cost, matching this project's existing spec convention
// (see .tools/dev-cutscenes.spec.cjs, .tools/cutscene-shots.spec.cjs).
test("Live Preview dock: boots the game, live-applies a dev preset, drives toolbar hooks, and tears down", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/dev.html`, { waitUntil: "networkidle" });

  // Dock is present but closed by default (persisted-closed state on a fresh
  // profile); the iframe has no src until Start is clicked.
  await expect(page.locator("#previewDock")).toBeAttached();
  await expect(page.locator("#pdFrame")).toBeHidden();

  // Open the dock (toggle button), then Start.
  await page.click("#previewToggle");
  await expect(page.locator("body")).toHaveClass(/preview-open/);
  await page.click("#pdStart");
  await expect(page.locator("#pdStart")).toBeDisabled();
  await expect(page.locator("#pdFrame")).toBeVisible();

  // Boot takes 15-60s (world/shader warming) — wait for the same readiness
  // flag every other spec in this project polls.
  await expect(page.locator("#pdStatus")).toHaveClass(/ready/, { timeout: 120000 });
  const toolbarIds = ["pdRestart", "pdWave", "pdJumpWave", "pdGodMode", "pdIntro", "pdBlackout"];
  for (const id of toolbarIds) await expect(page.locator("#" + id)).toBeEnabled();

  // Reach into the iframe's window — same-origin, so this is direct access,
  // no postMessage bridge (per the plan).
  const frame = page.frames().find((f) => f.url().includes("first_person_shooter_room_game"));
  expect(frame).toBeTruthy();
  await frame.waitForFunction(() => !!window.__rbTest, null, { timeout: 15000 });

  // Enter "playing" (the real user flow) so state-dependent hooks work, and
  // wait for wave 1's enemies to actually spawn (async relative to the state
  // flip) before driving anything that depends on live enemies existing.
  await frame.locator("#startBtn").click();
  await frame.waitForFunction(() => window.__rbTest.getState() === "playing", null, { timeout: 15000 });
  await frame.waitForFunction(() => window.__ecs && window.__ecs.enemyCount() > 0, null, { timeout: 20000 });

  // A dev preset activated OUTSIDE the preview (a fresh import of the engine
  // module, same technique as .tools/dev-console.spec.cjs) must live-apply
  // into the running iframe via the existing storage-event channel — no new
  // plumbing, this is the core promise of the feature.
  await page.evaluate(() =>
    import("./modules/dev_engine.js").then((DE) => {
      const store = DE.loadStore();
      DE.createPreset(store, "player", "PreviewSpeedTest", { ...DE.DEFAULTS.player, speed: 21.5 });
      DE.activatePreset(store, "player", "PreviewSpeedTest");
      DE.saveStore(store);
    })
  );
  await frame.waitForFunction(
    () => window.__RB_DEV_ACTIVE?.player?.speed === 21.5,
    null,
    { timeout: 10000 }
  );

  // Toolbar wave-jump hook (setWave + completeWave) reaches the running game —
  // verified against the real HUD element (#wave-val), the same DOM contract
  // the game's own updateHUD() writes to during normal play. completeWave()
  // clears the wave, which advances the counter further via the game's own
  // wave-clear flow, so assert it moved off "1" rather than a specific number
  // (the exact post-clear value is an internal detail, not this feature's).
  await expect(frame.locator("#wave-val")).toHaveText("1");
  // The preview canvas engages pointer lock during play (FPS mouse-look).
  // Real browsers release it as part of shifting focus to an outside click,
  // but headless/CDP-driven synthetic clicks don't always model that — so
  // the dock's own "Go" click can silently fail to reach its handler while
  // the iframe still holds the lock. Release it explicitly before driving
  // the toolbar, matching what a real click-away would do.
  await frame.evaluate(() => { if (document.exitPointerLock) document.exitPointerLock(); });
  await page.waitForTimeout(200);
  await page.fill("#pdWave", "3");
  await page.click("#pdJumpWave");
  await expect(frame.locator("#wave-val")).not.toHaveText("1", { timeout: 10000 });

  // Stop tears the iframe down (frees the WebGL context) and resets the UI.
  await page.click("#pdStop");
  await expect(page.locator("#pdFrame")).toBeHidden();
  await expect(page.locator("#pdStart")).toBeEnabled();
  for (const id of toolbarIds) await expect(page.locator("#" + id)).toBeDisabled();

  expect(errors).toEqual([]);
});
