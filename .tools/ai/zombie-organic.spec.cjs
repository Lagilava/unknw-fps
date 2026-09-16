// Verification-only (not part of the required suite): confirms the zombie shamble
// reads organic — a single zombie's head bone varies over time, and two zombies are
// desynced rather than moving in lockstep.
const { test, expect } = require("@playwright/test");

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("zombies shamble organically and desync between instances", async ({ page }) => {
  test.setTimeout(300000);
  page.setDefaultTimeout(180000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => !!window.__rbTest, { timeout: 120000 });

  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 60000 });

  // Spawn two zombies at different offsets.
  await page.evaluate(() => {
    window.__rbTest.spawnAt("Zombie", 3, -8);
    window.__rbTest.spawnAt("Zombie", -3, -8);
  });
  await page.waitForTimeout(1500);

  // Sample the world Y of each zombie's head bone over ~2s.
  const series = await page.evaluate(async () => {
    const scene = window.__extSun?.parent;
    const findZombieHeads = () => {
      const heads = [];
      scene?.traverse((o) => {
        if (o.name === "Zombie") {
          const h = o.getObjectByName("mixamorigHead");
          if (h) heads.push(h);
        }
      });
      return heads;
    };
    const THREE = window.THREE || (window.__extSun && window.__extSun.constructor && null);
    const heads = findZombieHeads();
    const out = heads.map(() => []);
    for (let i = 0; i < 40; i++) {
      heads.forEach((h, idx) => {
        h.updateWorldMatrix(true, false);
        const p = h.matrixWorld.elements;
        out[idx].push([+p[12].toFixed(4), +p[13].toFixed(4), +p[14].toFixed(4)]);
      });
      await new Promise((r) => setTimeout(r, 50));
    }
    return { count: heads.length, out };
  });

  console.log("zombie heads captured:", series.count);
  expect(series.count).toBeGreaterThanOrEqual(2);

  // A single head must move over the window (not frozen).
  const spread = (arr, k) => {
    const vals = arr.map((p) => p[k]);
    return Math.max(...vals) - Math.min(...vals);
  };
  const s0 = spread(series.out[0], 1) + spread(series.out[0], 0) + spread(series.out[0], 2);
  const s1 = spread(series.out[1], 1) + spread(series.out[1], 0) + spread(series.out[1], 2);
  console.log("head motion spread (m): z0=%s z1=%s", s0.toFixed(4), s1.toFixed(4));
  expect(s0).toBeGreaterThan(0.002);
  expect(s1).toBeGreaterThan(0.002);

  // The two heads must not move identically (desync): compare their vertical series.
  let maxDiff = 0;
  for (let i = 0; i < series.out[0].length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(series.out[0][i][1] - series.out[1][i][1]));
  }
  console.log("max vertical difference between the two zombies (m):", maxDiff.toFixed(4));
  expect(maxDiff).toBeGreaterThan(0.001);
});
