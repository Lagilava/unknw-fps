const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("exterior AABB footprints are mirrored as Rapier colliders", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  const r = await page.evaluate(() => {
    const fp = window.__extMapFootprints || [];
    let centersInside = 0, total = 0;
    const misses = [];
    for (const c of fp) {
      if (!c || !(c.hw > 0) || !(c.hd > 0)) continue;
      total++;
      // A footprint's own centre must sit inside its collider.
      if (window.__physics.probe(c.x, c.z, 1)) centersInside++;
      else if (misses.length < 8) misses.push({ x: c.x, z: c.z, hw: c.hw, hd: c.hd });
    }
    return { total, centersInside, misses, colliders: window.__physics.staticColliderCount() };
  });
  console.log("EXT", JSON.stringify(r));
  expect(r.total).toBeGreaterThan(0);
  expect(r.centersInside).toBe(r.total); // every footprint centre is inside a collider
  // interior (117) + exterior footprints are all in the world
  expect(r.colliders).toBeGreaterThan(117 + r.total - 1);
});
