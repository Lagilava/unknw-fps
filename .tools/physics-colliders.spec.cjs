const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("static wall colliders match the MAP grid", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  const r = await page.evaluate(() => {
    const env = window.RoomBreachEnvironment;
    const { MAP, MAP_W, MAP_H, mapToWorld } = env;
    let checked = 0, mismatch = 0, wallInside = 0, openOutside = 0;
    const samples = [];
    for (let my = 0; my < MAP_H; my++) {
      for (let mx = 0; mx < MAP_W; mx++) {
        const isWall = MAP[my][mx] === "#";
        const w = mapToWorld(mx, my);
        const inside = window.__physics.probe(w.x, w.z, 1);
        checked++;
        if (inside === isWall) { isWall ? wallInside++ : openOutside++; }
        else { mismatch++; if (samples.length < 8) samples.push({ mx, my, isWall, inside }); }
      }
    }
    return { checked, mismatch, wallInside, openOutside,
             count: window.__physics.staticColliderCount(), samples };
  });
  console.log("COLLIDERS", JSON.stringify(r));
  expect(r.count).toBeGreaterThan(0);
  expect(r.wallInside).toBeGreaterThan(0);   // wall cells are inside a collider
  expect(r.openOutside).toBeGreaterThan(0);  // open cells are not
  expect(r.mismatch).toBe(0);                // colliders exactly mirror the grid
});
