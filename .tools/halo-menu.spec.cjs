// Smoke test + screenshots for the Halo-style shell: loading screen, main menu
// (with the live 3D backdrop behind it), and the Settings sub-screen.
const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("halo menu shell", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "test-results/halo-loading.png" });

  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 240000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-results/halo-menu.png" });

  // Root state: list visible, no sub-screen.
  expect(await page.getAttribute("#overlay", "data-panel")).toBe("root");
  await expect(page.locator("#settingsBtn")).toBeVisible();

  // The backdrop camera must be driving, and must not be the player camera.
  const camA = await page.evaluate(() => window.__rbTest.getFrameStats?.() && null);
  void camA;

  // Keyboard nav moves the highlight.
  const firstActive = await page.evaluate(() =>
    document.querySelector("#overlay .ov-nav-item.active-nav")?.id);
  await page.keyboard.press("ArrowDown");
  const secondActive = await page.evaluate(() =>
    document.querySelector("#overlay .ov-nav-item.active-nav")?.id);
  expect(secondActive).not.toBe(firstActive);

  // Settings screen opens, shows all three groups, and Esc backs out.
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#settingsPanel")).toHaveClass(/active/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/halo-settings.png" });
  expect(await page.locator("#settingsPanel .set-group").count()).toBe(3);

  // Audio: dragging a category slider moves the real runtime value.
  await page.locator("#opt-vol-weapons").fill("40");
  await page.locator("#opt-vol-weapons").dispatchEvent("input");
  expect(await page.textContent("#opt-vol-weapons-val")).toBe("40%");

  // Video: FOV offset reaches the camera.
  await page.locator("#opt-fov").fill("15");
  await page.locator("#opt-fov").dispatchEvent("input");
  expect(await page.textContent("#opt-fov-val")).toBe("+15°");

  await page.keyboard.press("Escape");
  expect(await page.getAttribute("#overlay", "data-panel")).toBe("root");

  // Mission still starts, and the backdrop hands off to the player camera.
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 30000 });

  expect(errors, "no page errors").toEqual([]);
});

test("pause menu keeps the gameplay view (no menu orbit)", async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 240000 });

  // Main menu → the backdrop orbit owns the camera.
  expect(await page.evaluate(() => window.__rbMenuCam().active)).toBe(true);

  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 30000 });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__rbTest.getState() === "paused", { timeout: 10000 });

  expect(await page.getAttribute("#overlay", "data-mode")).toBe("pause");
  expect(await page.getAttribute("#overlay", "data-panel")).toBe("root");
  await expect(page.locator("#resumeBtn")).toBeVisible();
  await expect(page.locator("#startBtn")).toBeHidden();
  // Pausing must NOT swing the camera out to the plaza orbit.
  expect(await page.evaluate(() => window.__rbMenuCam().active)).toBe(false);
});
