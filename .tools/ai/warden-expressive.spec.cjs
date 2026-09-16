// Verification-only (not part of the required suite): confirms the angel rigs'
// expressive motion — each variant's head bone moves with a distinct signature,
// and two instances of the same variant are desynced (per-instance seeds).
const { test, expect } = require("@playwright/test");

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("angel variants move expressively and instances desync", async ({ page }) => {
  test.setTimeout(300000);
  page.setDefaultTimeout(180000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => !!window.__rbTest, { timeout: 120000 });

  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 60000 });

  // One of each variant + a second Warden for the desync check.
  await page.evaluate(() => {
    window.__rbTest.spawnAt("Siege Drone", 6, -10);
    window.__rbTest.spawnAt("Siege Drone", -6, -10);
    window.__rbTest.spawnAt("Blink Seraph", 6, -16);
    window.__rbTest.spawnAt("Null Cherub", -6, -16);
  });
  await page.waitForTimeout(1500);

  // Sample each rig's head-bone world Y + yaw basis over ~3s.
  const data = await page.evaluate(async () => {
    const scene = window.__extSun?.parent;
    const rigs = [];
    scene?.traverse((o) => {
      if (o.name === "StormWarden") {
        let head = null;
        o.traverse((c) => { if (!head && c.isBone && c.name === "head") head = c; });
        if (head) rigs.push({ root: o, head });
      }
    });
    const out = rigs.map(() => ({ y: [], rx: [] }));
    for (let i = 0; i < 60; i++) {
      rigs.forEach((r, idx) => {
        r.head.updateWorldMatrix(true, false);
        const e = r.head.matrixWorld.elements;
        out[idx].y.push(e[13]);   // world Y (hover bob)
        out[idx].rx.push(e[0]);   // basis X.x (captures head yaw/tilt changes)
      });
      await new Promise((res) => setTimeout(res, 50));
    }
    return { count: rigs.length, out };
  });

  console.log("angel rigs captured:", data.count);
  expect(data.count).toBeGreaterThanOrEqual(4);

  const spread = (a) => Math.max(...a) - Math.min(...a);
  const corr = (a, b) => {
    const n = Math.min(a.length, b.length);
    const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return num / Math.max(1e-9, Math.sqrt(da * db));
  };

  // Every rig's head must move (bob + look), and its orientation must vary.
  data.out.forEach((s, i) => {
    console.log(`rig ${i}: ySpread=${spread(s.y).toFixed(3)} rxSpread=${spread(s.rx).toFixed(3)}`);
    expect(spread(s.y)).toBeGreaterThan(0.03);
    expect(spread(s.rx)).toBeGreaterThan(0.002);
  });

  // Instances must be desynced: no pair of bob series may be near-lockstep.
  for (let i = 0; i < data.out.length; i++) {
    for (let j = i + 1; j < data.out.length; j++) {
      // De-trend by differencing so shared vertical drift doesn't mask phase.
      const d = (a) => a.slice(1).map((v, k) => v - a[k]);
      const c = corr(d(data.out[i].y), d(data.out[j].y));
      console.log(`bob-delta correlation rig${i} vs rig${j}: ${c.toFixed(3)}`);
      expect(Math.abs(c)).toBeLessThan(0.9);
    }
  }
});
