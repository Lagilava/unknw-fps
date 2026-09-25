// Guards src/fx_lab.html — the isolated VFX lab used to author the flamethrower —
// and, through it, the shape of the stream itself.
//
// The lab exists because a continuous effect cannot be judged from one still at
// one angle, and reaching a blackout wave in the real game costs ~40 s of boot.
// It drives the SAME modules/flame_jet.ts + modules/particle_fx.ts the game
// does, so it is only useful while it keeps working — hence this test. It runs
// in a couple of seconds; if it fails, the lab has drifted from the modules.
const { test, expect } = require("@playwright/test");

const URL = "http://127.0.0.1:8000/src/fx_lab.html";

// Distances from the muzzle of every VISIBLE particle, per layer.
const measure = () => {
  const L = window.__fxLab, M = L.MUZZLE;
  const out = { nearestFire: 1e9, farthestFire: 0, nearestSmoke: 1e9, smokeVisible: 0 };
  const [add, alpha] = L.particleFX.objects.map((o) => o.geometry);
  const scan = (g, fn) => {
    const p = g.attributes.position.array, a = g.attributes.aAlpha.array, n = g.drawRange.count;
    for (let i = 0; i < n; i++) {
      if (a[i] > 0.01) fn(Math.hypot(p[i * 3] - M.x, p[i * 3 + 1] - M.y, p[i * 3 + 2] - M.z));
    }
  };
  scan(add, (d) => { out.nearestFire = Math.min(out.nearestFire, d); out.farthestFire = Math.max(out.farthestFire, d); });
  scan(alpha, (d) => { out.nearestSmoke = Math.min(out.nearestSmoke, d); out.smokeVisible++; });
  return out;
};

test("fx lab drives the shared flame jet against the real particle system", async ({ page }) => {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.fxLabReady === "1", { timeout: 60000 });

  // Stepping is deterministic and independent of the page's real frame rate.
  const steady = await page.evaluate(() => {
    window.__fxLab.reset();
    window.__fxLab.step(80);
    return window.__fxLab.stats();
  });
  expect(steady.particles).toBeGreaterThan(120);
  expect(steady.particles).toBeLessThanOrEqual(steady.capacity);
  // The jet must light the world: that is half of why it reads as fire.
  expect(steady.lightIntensity).toBeGreaterThan(5);

  // Every named angle renders and reads back inside one task.
  for (const view of ["gameplay", "side", "threeQuarter", "top", "headOn", "closeLow"]) {
    const url = await page.evaluate((v) => window.__fxLab.shot(v, 30), view);
    expect(url.startsWith("data:image/png"), `${view} did not render`).toBe(true);
  }

  // Releasing the trigger drains the pool — no stuck slots.
  await page.evaluate(() => { window.__fxLab.setThrottle(0); window.__fxLab.step(200); });
  expect((await page.evaluate(() => window.__fxLab.stats())).particles).toBe(0);
  await page.evaluate(() => window.__fxLab.setThrottle(1));

  expect(errors.filter((e) => !/favicon|404/i.test(e))).toEqual([]);
});

test("the flame is a forward-moving stream, not a fireball", async ({ page }) => {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.fxLabReady === "1", { timeout: 60000 });
  await page.evaluate(`window.__measure = ${measure.toString()}`);

  // Fuel is THROWN from the muzzle. One frame after the trigger, nothing can be
  // far from the nozzle; half a second later the stream reaches out to ~10 m+.
  // (The old jet seeded particles along the whole ray on frame one — a static
  // cloud with no forward motion, which is exactly what read as a fireball.)
  const oneFrame = await page.evaluate(() => {
    const L = window.__fxLab; L.reset(); L.setWall(0); L.step(1); return window.__measure();
  });
  expect(oneFrame.farthestFire).toBeLessThan(1.5);
  const settled = await page.evaluate(() => { window.__fxLab.step(60); return window.__measure(); });
  expect(settled.farthestFire).toBeGreaterThan(10);
  // Attached to the nozzle: no speed×dt gap between the gun and the fire.
  expect(settled.nearestFire).toBeLessThan(0.3);
  // Smoke only appears downstream, where the flame is cooling.
  expect(settled.smokeVisible).toBeGreaterThan(0);
  expect(settled.nearestSmoke).toBeGreaterThan(3);

  // Still attached, and still bounded, while the muzzle whips round.
  const swinging = await page.evaluate(() => {
    const L = window.__fxLab; L.reset(); L.setWall(0); L.motion({ yawRate: 3, vx: 4 }); L.step(90);
    return { ...window.__measure(), count: L.particleFX.count() };
  });
  expect(swinging.nearestFire).toBeLessThan(0.3);

  // Budgets per quality tier are real and ordered.
  const tiers = await page.evaluate(() => {
    const L = window.__fxLab, out = {};
    for (const q of ["low", "medium", "high"]) {
      L.reset(); L.setWall(0); L.quality(q); L.step(150);
      out[q] = { total: L.particleFX.count(), ...L.stats().jet };
    }
    L.quality("high");
    return out;
  });
  expect(tiers.low.total).toBeLessThan(tiers.medium.total);
  expect(tiers.medium.total).toBeLessThan(tiers.high.total);
  expect(tiers.high.total).toBeLessThan(360);
  expect(tiers.high.flames).toBeLessThanOrEqual(200);

  // Still exactly the two shared particle layers: the fire adds no draw calls.
  expect(await page.evaluate(() => window.__fxLab.particleFX.objects.length)).toBe(2);
});
