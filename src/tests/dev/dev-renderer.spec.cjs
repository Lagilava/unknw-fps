const { test, expect } = require("@playwright/test");
const BASE = "http://127.0.0.1:8000";
const HTML = `${BASE}/first_person_shooter_room_game%20(1).html?test=1`;

test("desktop 'auto' takes the WebGL fast path (no WebGPU attempt)", async ({ page }) => {
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto(HTML, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  const backend = await page.evaluate(() => document.getElementById("gameCanvas")?.dataset.rendererBackend);
  expect(backend).toBe("webgl");
  // Under 'auto' on desktop we must NOT even try WebGPU (avoids its slow path).
  expect(logs.some((l) => /Using WebGL renderer/.test(l))).toBe(true);
  expect(logs.some((l) => /falling back to WebGL/.test(l))).toBe(false);
});

test("a quality preset forcing webgpu is read by the renderer selector", async ({ page }) => {
  // Force webgpu via the resolved snapshot; headless has no adapter, so it will
  // attempt WebGPU then fall back — proving the preference is honored.
  await page.addInitScript(() => {
    localStorage.setItem("rb-dev-active-v1", JSON.stringify({
      version: 4, _categories: ["quality"],
      quality: { renderer: "webgpu", autoFallback: true, renderScaleCap: 0, pixelRatioCap: 0, maxActiveLights: 0 },
    }));
  });
  const logs = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto(HTML, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  // It tried WebGPU (adapter unavailable in headless) and fell back — confirming
  // the quality.renderer preference drove the attempt.
  expect(logs.some((l) => /WebGPU adapter unavailable|falling back to WebGL/.test(l))).toBe(true);
  const backend = await page.evaluate(() => document.getElementById("gameCanvas")?.dataset.rendererBackend);
  expect(backend).toBe("webgl"); // fell back cleanly
});

test("renderScaleCap from a quality preset clamps the render scale", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rb-dev-active-v1", JSON.stringify({
      version: 4, _categories: ["quality"],
      quality: { renderer: "webgl", autoFallback: true, renderScaleCap: 0.5, pixelRatioCap: 0, maxActiveLights: 0 },
    }));
  });
  await page.goto(HTML, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__rbTest, { timeout: 60000 });
  const stats = await page.evaluate(() => window.__rbTest.getFrameStats());
  expect(stats.renderScale).toBeLessThanOrEqual(0.5 + 1e-6);
});
