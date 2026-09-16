const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("live-archetype stays in lock-step with .alive across kills", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__ecs.liveCount() > 0, { timeout: 20000 });

  // At mission start every enemy is alive: live archetype == array-alive == all.
  const start = await page.evaluate(() => ({
    live: window.__ecs.liveCount(),
    arr: window.__rbTest.getEnemyCount(),
    all: window.__ecs.enemyCount(),
  }));
  console.log("START", JSON.stringify(start));
  expect(start.live).toBe(start.arr);
  expect(start.live).toBe(start.all);
  expect(start.live).toBeGreaterThan(0);

  // Kill enemies one at a time; after each, the live archetype must still equal
  // the array's alive count — proving the `live` tag tracks `.alive` exactly.
  const samples = [];
  for (let i = 0; i < start.all + 1; i++) {
    const killed = await page.evaluate(() => window.__rbTest.killNearest());
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => ({
      live: window.__ecs.liveCount(),
      arr: window.__rbTest.getEnemyCount(),
    }));
    s.killed = killed;
    samples.push(s);
    expect(s.live).toBe(s.arr); // the invariant under test
    if (!killed) break;
  }
  console.log("KILLS", JSON.stringify(samples));
});
