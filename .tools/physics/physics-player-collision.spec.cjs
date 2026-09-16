const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("physics wall collision agrees with wallAtWorldRadius, and player moves + is blocked", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  // Agreement sweep across the interior grid extents.
  const agree = await page.evaluate(() => {
    const env = window.RoomBreachEnvironment;
    const { MAP_W, MAP_H, CELL, mapToWorld } = env;
    const r = 0.32;
    let total = 0, disagree = 0; const samples = [];
    // sample every cell centre AND cell quarter-offsets for sub-cell coverage
    for (let my = 1; my < MAP_H - 1; my++) {
      for (let mx = 1; mx < MAP_W - 1; mx++) {
        const c = mapToWorld(mx, my);
        for (const [ox, oz] of [[0,0],[CELL*0.3,0],[0,CELL*0.3],[-CELL*0.3,0]]) {
          const x = c.x + ox, z = c.z + oz;
          const phys = window.__physics.blocksAt(x, z, r);
          const grid = env.wallAtWorldRadius(x, z, r);
          total++;
          if (phys !== grid) { disagree++; if (samples.length < 10) samples.push({ x:+x.toFixed(2), z:+z.toFixed(2), phys, grid }); }
        }
      }
    }
    return { total, disagree, pct: +(100*(1-disagree/total)).toFixed(2), samples };
  });
  console.log("AGREE", JSON.stringify(agree));
  expect(agree.pct).toBeGreaterThan(98);

  // Player actually moves in open space, and is blocked walking into a wall.
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0)); // interior centre, facing north
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => window.__rbTest.getPlayerPosition());
  await page.keyboard.down("KeyW"); await page.waitForTimeout(900); await page.keyboard.up("KeyW");
  const after = await page.evaluate(() => window.__rbTest.getPlayerPosition());
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  console.log("MOVED", moved.toFixed(3), JSON.stringify({before, after}));
  expect(moved).toBeGreaterThan(0.03); // moved in open space (magnitude is frame-rate dependent)

  // Blocked by a wall: stand just south of the north wall and walk into it.
  const blocked = await page.evaluate(async () => {
    const env = window.RoomBreachEnvironment;
    // find an interior open cell directly south of a north-edge wall run
    window.__rbTest.tpTo(0, -30, Math.PI, 0); // near north interior wall, facing it
    await new Promise(r=>setTimeout(r,150));
    const b = window.__rbTest.getPlayerPosition();
    return b;
  });
  const b0 = await page.evaluate(() => window.__rbTest.getPlayerPosition());
  await page.keyboard.down("KeyW"); await page.waitForTimeout(700); await page.keyboard.up("KeyW");
  const b1 = await page.evaluate(() => window.__rbTest.getPlayerPosition());
  // must NOT have tunnelled through the wall (z stays within the play box)
  console.log("BLOCK", JSON.stringify({b0, b1}));
  expect(Number.isFinite(b1.x) && Number.isFinite(b1.z)).toBe(true);
  expect(b1.z).toBeGreaterThan(-70); // did not escape north through the wall
});
