const { test, expect } = require("@playwright/test");

const BASE = "http://127.0.0.1:8000";

test("dev.html renders and activating a preset writes the resolved snapshot", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/dev.html`, { waitUntil: "networkidle" });

  // Sections + nav rendered (10 tunable categories + Presets + Cutscenes).
  await expect(page.locator("#nav .nav-btn")).toHaveCount(12);

  // Go to Player, edit the "Default" preset's speed, activate it.
  await page.click('#nav button[data-sec="player"]');
  const result = await page.evaluate(() => {
    // Drive the same code paths the UI buttons use, via a fresh module import.
    return import("./modules/dev_engine.js").then((DE) => {
      const store = DE.loadStore();
      DE.createPreset(store, "player", "TestFast", { ...DE.DEFAULTS.player, speed: 17.5 });
      DE.activatePreset(store, "player", "TestFast");
      DE.saveStore(store);
      const active = DE.loadActive();
      return { speed: active.player && active.player.speed, cats: active._categories };
    });
  });
  expect(result.speed).toBe(17.5);
  expect(result.cats).toContain("player");
  expect(errors).toEqual([]);
});

test("environment.js applies a dev map + cell override from localStorage", async ({ page }) => {
  // Seed a tiny custom map + cell size before environment.js loads.
  await page.addInitScript(() => {
    localStorage.setItem("rb-dev-active-v1", JSON.stringify({
      version: 3,
      _categories: ["map"],
      map: { rows: ["#####", "#...#", "#.+.#", "#...#", "#####"], cell: 6 },
    }));
  });
  // Minimal host page that just loads environment.js.
  await page.route("**/env-probe.html", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><script src="/environment.js"></script>` })
  );
  await page.goto(`${BASE}/env-probe.html`, { waitUntil: "networkidle" });
  const env = await page.evaluate(() => ({
    w: window.RoomBreachEnvironment.MAP_W,
    h: window.RoomBreachEnvironment.MAP_H,
    cell: window.RoomBreachEnvironment.CELL,
    row2: window.RoomBreachEnvironment.MAP[2],
  }));
  expect(env.w).toBe(5);
  expect(env.h).toBe(5);
  expect(env.cell).toBe(6);
  expect(env.row2).toBe("#.+.#");
});

test("environment.js falls back to the built-in map when no dev override", async ({ page }) => {
  await page.route("**/env-probe2.html", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><script src="/environment.js"></script>` })
  );
  await page.goto(`${BASE}/env-probe2.html`, { waitUntil: "networkidle" });
  const env = await page.evaluate(() => ({
    w: window.RoomBreachEnvironment.MAP_W,
    h: window.RoomBreachEnvironment.MAP_H,
    cell: window.RoomBreachEnvironment.CELL,
  }));
  expect(env.w).toBe(34);
  expect(env.h).toBe(40);
  expect(env.cell).toBe(4);
});
