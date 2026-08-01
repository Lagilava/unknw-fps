// Guards the pooled particle system (modules/particle_fx.ts).
//
// The whole point of the rewrite is that ALL particle FX cost a fixed two draw
// calls no matter how many particles are live — the old mesh-per-particle pool
// capped the budget at 36 draws on a frame that is already CPU-bound on draw
// issue. So the invariants are: two permanent Points layers, particles that
// actually spawn with real on-screen size, a hard capacity ceiling, and a clean
// return to zero (a leak here would silently eat the budget for the next wave).
const { test, expect } = require("@playwright/test");

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

async function boot(page) {
  page.setDefaultTimeout(120000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 60000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth?.(true));
  await page.waitForTimeout(2000);
}

test("particle FX render in exactly two draw calls and never leak", async ({ page }) => {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await boot(page);

  // 1. Two layers, both permanently in the scene.
  const info = await page.evaluate(() => window.__rbParticles());
  expect(info.layers).toHaveLength(2);
  for (const layer of info.layers) expect(layer.inScene).toBe(true);
  expect(info.capacity).toBeGreaterThan(500);

  // 2. Every composite effect actually emits.
  for (const kind of ["bulletWall", "bulletFlesh", "headshot", "enemyDeath", "energyImpact", "explosion"]) {
    const live = await page.evaluate((k) => {
      const before = window.__rbParticles().live;
      window.__rbFx(k, 4);
      return window.__rbParticles().live - before;
    }, kind);
    expect(live, `${kind} emitted nothing`).toBeGreaterThan(0);
    await page.waitForTimeout(50);
  }

  // 3. Capacity is a hard ceiling — a spam burst must not grow past it.
  const saturated = await page.evaluate(() => {
    for (let i = 0; i < 200; i++) window.__rbFx("explosion", 4);
    return window.__rbParticles();
  });
  expect(saturated.live).toBeLessThanOrEqual(saturated.capacity);

  // 4. Everything drains back to zero — no stuck slots.
  // NOTE: poll rather than sleep. Particles age in GAME time, and headless
  // Chrome runs this scene at ~2.5 fps, so a few seconds of wall clock is only a
  // fraction of a second of simulated life. Asserting on a fixed sleep here
  // reports a leak that does not exist.
  await page.waitForFunction(() => window.__rbParticles().live === 0, { timeout: 120000 });

  // 5. Still two draw calls after all that, and no GL/shader errors.
  const after = await page.evaluate(() => window.__rbParticles());
  expect(after.layers).toHaveLength(2);
  expect(errors.filter((e) => /shader|WebGL|GLSL/i.test(e))).toEqual([]);
});
