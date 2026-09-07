const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

// Pistols now use the same clone-faithful TWO-HANDED pose as every other
// weapon (no more bespoke one-arm-tucked IK) — the support (left) hand should
// stay close to the shooting (right) hand through the shot, not sag below it.
test("pistol fire keeps a two-handed stance (left hand tracks the right)", async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(() => { for (const k of ["rb-dev-store-v1","rb-dev-active-v1","rb-dev-starter-installed"]) localStorage.removeItem(k); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && typeof window.__rbReload === "function", { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => { const r = window.__rbReload(); return r.gunPos && r.rightUpperArm && r.leftUpperArm; }, { timeout: 30000 });

  // Confirm we are on the pistol (the starter).
  const gun = await page.evaluate(() => window.__rbReload().gun);
  expect(gun).toBe("pistol");

  // Aim (right-mouse ADS) to raise the arms into the gun-ready pose, and fire a
  // couple of shots to add the recoil punch. Sample both upper-arm world heights.
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "right" }); // hold ADS
  const samples = [];
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 0) { await page.mouse.click(cx, cy); } // periodic shots for punch
    const r = await page.evaluate(() => window.__rbReload());
    // Measure the HANDS, not the upper-arm bone origins: an upper-arm bone's own
    // origin is the shoulder joint, which doesn't move when the arm rotates — only
    // its children (forearm/hand) do. The hands are where the one-handed tuck shows.
    if (r.rightHand && r.leftHand) {
      samples.push({
        rY: r.rightHand.y, lY: r.leftHand.y,
        dY: +(r.rightHand.y - r.leftHand.y).toFixed(3),
        span: +Math.hypot(r.rightHand.x - r.leftHand.x, r.rightHand.z - r.leftHand.z).toFixed(3),
      });
    }
    await page.waitForTimeout(120);
  }
  await page.mouse.up({ button: "right" });
  console.log("PISTOL ARM SAMPLES " + JSON.stringify(samples));
  expect(samples.length).toBeGreaterThan(6);

  // Two-handed proof: the support (left) hand stays close in height AND span to
  // the shooting (right) hand, like every other weapon's clone-faithful grip —
  // not sagging into its own lowered one-handed tuck.
  const avgDY = samples.reduce((a, s) => a + s.dY, 0) / samples.length;
  const avgSpan = samples.reduce((a, s) => a + s.span, 0) / samples.length;
  console.log("PISTOL avg right-left hand dY = " + avgDY.toFixed(3) + ", span = " + avgSpan.toFixed(3));
  expect(Math.abs(avgDY)).toBeLessThan(0.04);
  expect(avgSpan).toBeLessThan(0.25);
});
