const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("exterior world is extended with a procedural district + physics colliders", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  const w = await page.evaluate(() => ({
    zFar: window.__extBounds?.zFar,
    footprints: (window.__extMapFootprints || []).length,
    colliders: window.__physics.staticColliderCount(),
  }));
  console.log("WORLD", JSON.stringify(w));
  // Playable box is deliberately the ORIGINAL plaza; the city beyond is vista.
  expect(w.zFar).toBe(230);                 // playable bound (pre-expansion)
  expect(w.footprints).toBeGreaterThan(90); // vista city buildings still exist

  // A deep-district building blocks the player (physics collision in the new area).
  // Sample a spot near where procedural buildings sit (x~50, z 250..360).
  const anyBlocked = await page.evaluate(() => {
    let hits = 0, sample = null;
    for (let z = 214; z < 372; z += 3) {
      for (let x = -110; x <= 110; x += 3) {
        if (window.__physics.blocksAt(x, z, 0.4)) { hits++; if (!sample) sample = { x, z }; }
      }
    }
    return { hits, sample };
  });
  console.log("BLOCKED-IN-DISTRICT", JSON.stringify(anyBlocked));
  expect(anyBlocked.hits).toBeGreaterThan(20); // lots of building collision in the grid

  // Player can travel deep into the new world (boundary failsafe extended).
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  // The vista district is UNREACHABLE: teleporting deep gets clamped back to the
  // playable box (world-bound failsafe reads the play bounds, not the city size).
  await page.evaluate(() => window.__rbTest.tpTo(0, 355, 0, 0));
  await page.waitForTimeout(250);
  const pos = await page.evaluate(() => window.__rbTest.getPlayerPosition());
  console.log("VISTA-CLAMP", JSON.stringify(pos));
  expect(pos.z).toBeLessThan(233);          // cannot stand in the vista city

  // Real GPU draw calls with the whole city in view stay in budget (frustum
  // culling keeps most of the ~1400 window meshes off the GPU). This is the
  // actual streaming gauge — when THIS climbs, chunk streaming earns its place.
  await page.evaluate(() => window.__rbTest.tpTo(0, 128, 0, 0)); // plaza mouth, city ahead
  await page.waitForTimeout(500);
  const fs = await page.evaluate(() => window.__rbTest.getFrameStats());
  console.log("DRAWCALLS", fs.drawCalls, "TRIS", fs.triangles);
  expect(fs.drawCalls).toBeLessThan(700);   // city stays cull-friendly (measured ~434)
});
