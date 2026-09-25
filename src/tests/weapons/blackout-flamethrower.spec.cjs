// Guards the blackout incinerator (three_fps_game.ts updateFlamethrower) and the
// randomised relay objective + its screen waypoint.
//
// The flamethrower is the only CONTINUOUS weapon in the game: fireGun() steps
// aside for it entirely and a per-frame update owns the trigger. So the things
// worth pinning down are that holding the trigger actually spins a jet up, that
// it emits into the pooled particle system rather than spawning meshes, that
// releasing spins it back down, and — critically — that none of it changes the
// visible light count (see the shader-cache invariant in CLAUDE.md).
const { test, expect } = require("@playwright/test");

const URL = "http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1";

async function boot(page) {
  page.setDefaultTimeout(120000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 60000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth?.(true));
  await page.waitForTimeout(2000);
}

const pressTrigger = (page, type) =>
  page.evaluate((t) => {
    const canvas = document.querySelector("canvas");
    canvas.dispatchEvent(new MouseEvent(t, { button: 0, bubbles: true }));
    if (t === "mouseup") window.dispatchEvent(new MouseEvent(t, { button: 0, bubbles: true }));
  }, type);

test("blackout incinerator spins up, emits fire, and adds no lights", async ({ page }) => {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await boot(page);

  const lightsBefore = await page.evaluate(() => window.__rbCountLights().total ?? window.__rbCountLights());

  // Outside a blackout the weapon is normal: no jet, no flame audio graph.
  const normal = await page.evaluate(() => window.__rbFlame());
  expect(normal.blackout).toBe(false);
  expect(normal.throttle).toBe(0);

  await page.evaluate(() => window.__rbTest.setWaveLighting(10));
  expect(await page.evaluate(() => window.__rbFlame().blackout)).toBe(true);

  // Hold the trigger: the jet must spin up and put particles in the pool.
  await pressTrigger(page, "mousedown");
  await page.waitForFunction(() => window.__rbFlame().throttle > 0.5, { timeout: 30000 });
  const firing = await page.evaluate(() => window.__rbFlame());
  expect(firing.firing).toBe(true);
  expect(firing.particles).toBeGreaterThan(0);
  // The fire is a thrown stream (modules/flame_jet.ts): real forward momentum
  // and live flame particles, leaving from the actual muzzle, not the camera.
  expect(firing.jet.flames).toBeGreaterThan(0);
  expect(firing.jet.throwSpeed).toBeGreaterThan(15);
  expect(Math.hypot(...firing.muzzle.map((v, i) => v - firing.camera[i]))).toBeGreaterThan(0.5);
  // The sustained voice is built lazily and follows the throttle.
  expect(firing.audioLevel === null || firing.audioLevel > 0).toBe(true);

  // Release: the throttle bleeds down instead of cutting dead.
  await pressTrigger(page, "mouseup");
  await page.waitForFunction(() => window.__rbFlame().throttle === 0, { timeout: 30000 });
  expect(await page.evaluate(() => window.__rbFlame().firing)).toBe(false);

  // Still two draw calls, and the light count never moved.
  const particles = await page.evaluate(() => window.__rbParticles());
  expect(particles.layers).toHaveLength(2);
  const lightsAfter = await page.evaluate(() => window.__rbCountLights().total ?? window.__rbCountLights());
  expect(lightsAfter).toEqual(lightsBefore);

  expect(errors.filter((e) => !/favicon|404/i.test(e))).toEqual([]);
});

test("relay objective is placed randomly and carries a waypoint", async ({ page }) => {
  await boot(page);

  const first = await page.evaluate(() => window.__rbRelay());
  expect(first.active).toBe(true);
  expect(first.waypointVisible).toBe(true);
  // The old placement took whatever cell BFS visited last within 8 steps, which
  // parked the relay in the same few spots. The band now reaches much further.
  expect(first.distance).toBeGreaterThan(8);

  // Re-rolling the objective repeatedly must not keep landing in one place.
  const sites = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      window.__rbTest.rollRelay();
      const r = window.__rbRelay();
      out.push(`${Math.round(r.x / 4)},${Math.round(r.z / 4)}`);
    }
    return out;
  });
  expect(new Set(sites).size).toBeGreaterThan(4);
});
