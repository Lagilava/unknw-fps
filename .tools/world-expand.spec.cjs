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
  expect(w.zFar).toBe(380);                 // world extended deep
  expect(w.footprints).toBeGreaterThan(69); // procedural buildings added (was 69)

  // A deep-district building blocks the player (physics collision in the new area).
  // Sample a spot near where procedural buildings sit (x~50, z 250..360).
  const anyBlocked = await page.evaluate(() => {
    for (let z = 250; z < 366; z += 4) {
      for (const x of [-52, -50, -48, 48, 50, 52]) {
        if (window.__physics.blocksAt(x, z, 0.4)) return { x, z };
      }
    }
    return null;
  });
  console.log("BLOCKED-IN-DISTRICT", JSON.stringify(anyBlocked));
  expect(anyBlocked).not.toBeNull();        // collision exists in the new district

  // Player can travel deep into the new world (boundary failsafe extended).
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.tpTo(0, 355, 0, 0)); // deep in the new district
  await page.waitForTimeout(150);
  const pos = await page.evaluate(() => window.__rbTest.getPlayerPosition());
  console.log("DEEP", JSON.stringify(pos));
  expect(pos.z).toBeGreaterThan(340);       // stayed deep (not clamped back by the old bound)
});
