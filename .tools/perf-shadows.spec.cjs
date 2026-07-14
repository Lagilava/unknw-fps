const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

async function boot(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
}

test("shadows are ON by default on desktop", async ({ page }) => {
  await page.addInitScript(() => { for (const k of ["rb-dev-store-v1","rb-dev-active-v1","rb-dev-starter-installed"]) localStorage.removeItem(k); });
  await boot(page);
  expect((await page.evaluate(() => window.__rbTest.getFrameStats())).shadows).toBe(true);
});

test("quality.shadows='off' disables shadows at boot", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rb-dev-active-v1", JSON.stringify({
      version: 5, _categories: ["quality"],
      quality: { renderer: "webgl", autoFallback: true, shadows: "off", autoPerfGovernor: true, renderScaleCap: 0, pixelRatioCap: 0, maxActiveLights: 0 },
    }));
  });
  await boot(page);
  expect((await page.evaluate(() => window.__rbTest.getFrameStats())).shadows).toBe(false);
});

test("toggling quality.shadows off live disables shadows with no reload", async ({ page }) => {
  await page.addInitScript(() => { for (const k of ["rb-dev-store-v1","rb-dev-active-v1","rb-dev-starter-installed"]) localStorage.removeItem(k); });
  await boot(page);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => { window.__noReload = true; });
  expect((await page.evaluate(() => window.__rbTest.getFrameStats())).shadows).toBe(true);

  await page.evaluate((key) => {
    const snap = { version: 5, _categories: ["quality"],
      quality: { renderer: "auto", autoFallback: true, shadows: "off", autoPerfGovernor: true, renderScaleCap: 0, pixelRatioCap: 0, maxActiveLights: 0 } };
    const json = JSON.stringify(snap);
    localStorage.setItem(key, json);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: json, storageArea: localStorage }));
  }, "rb-dev-active-v1");
  await page.waitForTimeout(300);

  const st = await page.evaluate(() => ({ shadows: window.__rbTest.getFrameStats().shadows, reloaded: !window.__noReload, playing: window.__rbTest.getState() }));
  expect(st.reloaded).toBe(false);
  expect(st.shadows).toBe(false);
  expect(st.playing).toBe("playing");
});
