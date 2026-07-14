const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("reload stages the gun in the left hand + a fresh clip in the right hand", async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => { for (const k of ["rb-dev-store-v1","rb-dev-active-v1","rb-dev-starter-installed"]) localStorage.removeItem(k); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && typeof window.__rbReload === "function", { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  // Wait for the third-person character rig + weapon to finish initializing.
  await page.waitForFunction(() => { const r = window.__rbReload(); return r.gunPos && r.rightHand && r.leftHand; }, { timeout: 30000 });

  // Fire once so the mag isn't full, then start a reload.
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() => window.__rbReload().reloading, { timeout: 5000 });

  // Sample the reload across its duration (headless steps dt slowly, so poll).
  const seen = { clipVisible: false, magHiddenDuringTransit: false, clipNearRightHand: false, gunNearLeftHand: false, mid: null };
  for (let i = 0; i < 80 && !seen.done; i++) {
    const r = await page.evaluate(() => window.__rbReload());
    if (!r.reloading) break;
    if (r.clipVisible) {
      seen.clipVisible = true;
      if (!r.magVisible) seen.magHiddenDuringTransit = true;
      if (r.clipPos && r.rightHand) {
        const d = Math.hypot(r.clipPos.x - r.rightHand.x, r.clipPos.y - r.rightHand.y, r.clipPos.z - r.rightHand.z);
        // Early in the transit the clip should be close to the right hand.
        if (r.reloadT < 0.4 && d < 0.6) seen.clipNearRightHand = true;
      }
      if (r.gunPos && r.leftHand && r.rightHand) {
        const dl = Math.hypot(r.gunPos.x - r.leftHand.x, r.gunPos.z - r.leftHand.z);
        const dr = Math.hypot(r.gunPos.x - r.rightHand.x, r.gunPos.z - r.rightHand.z);
        // During reload the gun should sit nearer the LEFT hand than the right.
        if (dl <= dr + 0.05) seen.gunNearLeftHand = true;
      }
      if (r.reloadT > 0.3 && r.reloadT < 0.55) seen.mid = r;
    }
    await page.waitForTimeout(250);
  }

  console.log("RELOAD SEEN " + JSON.stringify(seen));
  expect(seen.clipVisible).toBe(true);               // a fresh clip is shown
  expect(seen.magHiddenDuringTransit).toBe(true);    // old mag hidden while clip travels
  expect(seen.gunNearLeftHand).toBe(true);           // gun held in the left hand
  expect(seen.clipNearRightHand).toBe(true);         // clip starts at the right hand

  // After the reload completes, the gun's mag is restored and the clip is hidden.
  await page.waitForFunction(() => !window.__rbReload().reloading, { timeout: 60000 });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__rbReload());
  expect(after.magVisible).toBe(true);
  expect(after.clipVisible).toBe(false);
});
