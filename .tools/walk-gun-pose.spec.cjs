const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("gun stays held in the hands while walking (not centered on the body)", async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(() => { for (const k of ["rb-dev-store-v1","rb-dev-active-v1","rb-dev-starter-installed"]) localStorage.removeItem(k); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && typeof window.__rbReload === "function", { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => { const r = window.__rbReload(); return r.gunPos && r.rightHand && r.leftHand; }, { timeout: 30000 });

  // Walk forward and sample hand span + gun-vs-hand-midpoint distance.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600); // let the walk clip fade in fully
  const samples = [];
  for (let i = 0; i < 12; i++) {
    const r = await page.evaluate(() => window.__rbReload());
    if (r.gunPos && r.leftHand && r.rightHand) {
      const span = Math.hypot(r.rightHand.x - r.leftHand.x, r.rightHand.y - r.leftHand.y, r.rightHand.z - r.leftHand.z);
      const mid = { x: (r.leftHand.x + r.rightHand.x) / 2, y: (r.leftHand.y + r.rightHand.y) / 2, z: (r.leftHand.z + r.rightHand.z) / 2 };
      const gunToMid = Math.hypot(r.gunPos.x - mid.x, r.gunPos.y - mid.y, r.gunPos.z - mid.z);
      samples.push({ span: +span.toFixed(3), gunToMid: +gunToMid.toFixed(3) });
    }
    await page.waitForTimeout(250);
  }
  await page.keyboard.up("KeyW");
  console.log("WALK SAMPLES " + JSON.stringify(samples));
  expect(samples.length).toBeGreaterThan(5);

  // With the rifle-carry upper-body layer, hands hold a two-handed grip while
  // walking: they must stay apart (unarmed walk lets them swing past each other,
  // span collapsing near 0 → gun in body middle) and the gun must ride the grip.
  const minSpan = Math.min(...samples.map(s => s.span));
  const maxGunToMid = Math.max(...samples.map(s => s.gunToMid));
  expect(minSpan).toBeGreaterThan(0.2);
  expect(maxGunToMid).toBeLessThan(0.6);
});
