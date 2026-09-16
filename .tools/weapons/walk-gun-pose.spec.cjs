const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test.use({ channel: 'chromium' });
test("two-handed carry stays level through switching, movement and aim, viewed around the player", async ({ page }) => {
  test.setTimeout(900000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('rb-dev-active-v1', JSON.stringify({
    version: 5, _categories: ['quality'], quality: {renderer: 'webgl', shadows: 'off', renderScaleCap: 0.75, maxActiveLights: 2, autoFallback: false}
  })));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", null, { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing");
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__rbReload().rightHand !== null);
  const views = [
    ["rear", 0, 0.1], ["right", Math.PI / 2, 0.1],
    ["front", Math.PI, 0.1], ["left", -Math.PI / 2, 0.1],
    ["front-quarter", 2.4, 0.1], ["above", 2.4, 0.8],
    ["below", 2.4, -0.3], ["rear-quarter", -0.7, 0.1],
  ];
  for (const gun of ["rifle", "shotgun", "sniper", "lmg", "dmr", "flak", "rifle"]) {
    console.log('Checking carry:', gun);
    await page.evaluate(g => { window.__rbTest.tpTo(0, 42, 0, 0); window.__rbTest.grantGun(g); }, gun);
    await page.waitForFunction(g => window.__rbReload().gun === g && window.__rbTest.getWeaponSwitch().draw === 0, gun);
    await page.mouse.down({ button: "right" });
    await page.waitForTimeout(600);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const pitch of [0, -0.7, 0.7]) {
        await page.evaluate(({yaw, pitch}) => window.__rbTest.tpTo(0, 42, yaw, pitch), {yaw, pitch});
        await page.waitForTimeout(120);
        const r = await page.evaluate(() => window.__rbReload());
        expect(r.handFit).toBe(false);
        expect(r.gunRootParented).toBe(true);
        const forward = -Math.sin(yaw) * r.gunForward[0] - Math.cos(yaw) * r.gunForward[2];
        expect(forward).toBeGreaterThan(0.8);
        if (pitch === 0) expect(Math.abs(r.gunForward[1])).toBeLessThan(0.15);
      }
    }
    // Leave scoped ADS before observing the body: the sniper hides the operator
    // in its normal scope view, including when the diagnostic camera renders.
    await page.mouse.up({ button: "right" });
    await page.waitForFunction(() => window.__rbView().ads < 0.02);
    await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
    for (const [name, azimuth, elevation] of views) {
      await page.evaluate(opts => window.__rbTest.orbitCam(opts), {on: true, azimuth, elevation, dist: 3});
      await page.waitForTimeout(120);
      await page.screenshot({path: `test-artifacts/weapon-pose/${gun}-${name}.png`});
    }
    await page.mouse.up({ button: "right" });
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(600);
    const walking = await page.evaluate(() => window.__rbReload());
    expect(walking.handFit).toBe(false);
    expect(Math.abs(walking.gunForward[1])).toBeLessThan(0.15);
    await page.screenshot({path: `test-artifacts/weapon-pose/${gun}-walking.png`});
    await page.keyboard.up("KeyW");
    await page.evaluate(() => window.__rbTest.orbitCam({on: false}));
  }
  expect(errors).toEqual([]);
});

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

  // With the Mixamo pistol locomotion clips (gripStyle oneHand), the sidearm is
  // carried COMPACT — hands close together — so a span floor no longer applies.
  // The contract now: the gun rides the RIGHT hand (hand-bone parenting) and
  // never drifts to the body midline.
  const maxGunToMid = Math.max(...samples.map(s => s.gunToMid));
  expect(maxGunToMid).toBeLessThan(0.6);
  const last = await page.evaluate(() => window.__rbReload());
  const gunToRight = Math.hypot(last.gunPos.x - last.rightHand.x, last.gunPos.y - last.rightHand.y, last.gunPos.z - last.rightHand.z);
  console.log("gunToRight", gunToRight.toFixed(3));
  expect(gunToRight).toBeLessThan(0.5);
});
