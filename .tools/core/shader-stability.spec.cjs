// Guards the two invariants that keep "New Mission" from freezing.
//
// three.js bakes the count of VISIBLE lights into every shader (the light loops are
// unrolled, one iteration per light). If that count changes at runtime, every material
// in the scene misses the program cache and relinks — and with this scene's shaders a
// single link blocks the main thread for ~400ms. Starting a mission used to change the
// count several times, which cost ~10s of frozen gameplay spread over the first wave.
//
// So: once the game is warmed up, starting a mission must compile ZERO new GL programs,
// and the light count must not move while playing.
const { test, expect } = require("@playwright/test");

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("starting a mission compiles no new shaders and keeps the light count fixed", async ({ page }) => {
  page.setDefaultTimeout(120000);

  await page.addInitScript(() => {
    window.__progs = 0;
    const proto = WebGL2RenderingContext.prototype;
    const create = proto.createProgram;
    proto.createProgram = function () {
      window.__progs++;
      return create.call(this);
    };
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // Wait for the real end of boot. The menu's reveal has a watchdog and can appear
  // before the world is built, so keying off the loading screen races the shader warm
  // and makes this test meaningless. bootGame sets body[data-rb-ready] when done.
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => !!window.__rbTest && !!window.__rbCountLights, { timeout: 120000 });

  const progsAtMenu = await page.evaluate(() => window.__progs);
  const lightsAtMenu = await page.evaluate(() => window.__rbCountLights().PointLight);

  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 60000 });

  // Sample across the first seconds of the wave — the window where enemies spawn,
  // the player model appears and bolt effects fire.
  const lightSamples = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(600);
    lightSamples.push(await page.evaluate(() => window.__rbCountLights().PointLight));
  }

  const progsAfter = await page.evaluate(() => window.__progs);
  const newPrograms = progsAfter - progsAtMenu;

  console.log("point lights at menu: %d, during play: %s", lightsAtMenu, [...new Set(lightSamples)].join(","));
  console.log("GL programs created after clicking New Mission: %d", newPrograms);

  expect(new Set(lightSamples).size).toBe(1);
  expect(lightSamples[0]).toBe(lightsAtMenu);
  expect(newPrograms).toBe(0);
});
