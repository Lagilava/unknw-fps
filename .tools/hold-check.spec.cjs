const { test } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

async function boot(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.waitForFunction(() => window.__rbReload && window.__rbReload().gunPos, { timeout: 30000 });
}

async function checkGun(page, gun) {
  await page.evaluate((g) => window.__rbTest.grantGun(g), gun);
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
  await page.waitForTimeout(400);
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // ADS-hold to trigger auto-calibration; keep held while shooting angles.
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(1400);

  const shots = [
    { name: "front-right", cam: [1.6, 1.5, 39.8], tgt: [0, 1.4, 42], fov: undefined },
    { name: "side", cam: [2.6, 1.4, 42], tgt: [0, 1.4, 42], fov: undefined },
    { name: "closeup", cam: [0.9, 1.45, 40.9], tgt: [0, 1.4, 42], fov: 35 },
    { name: "top", cam: [0, 4.5, 42.01], tgt: [0, 1.4, 42], fov: undefined },
  ];
  for (const s of shots) {
    await page.evaluate(({ cam, tgt, fov }) => window.__rbTest.freeCam(cam[0], cam[1], cam[2], tgt[0], tgt[1], tgt[2], fov), s);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/hold-${gun}-${s.name}.png` });
  }
  await page.evaluate(() => window.__rbTest.freeCamOff());
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(400);

  // Relaxed walk shot with side freeCam.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const p = window.__rbTest.getPlayerPosition();
    window.__rbTest.freeCam(p.x + 2.6, 1.4, p.z, p.x, 1.2, p.z);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `test-results/hold-${gun}-walk.png` });
  await page.keyboard.up("KeyW");
  await page.evaluate(() => window.__rbTest.freeCamOff());
}

test("pistol hold check", async ({ page }) => {
  test.setTimeout(420000);
  await boot(page);
  await checkGun(page, "pistol");
});

test("akimbo hold check", async ({ page }) => {
  test.setTimeout(420000);
  await boot(page);
  await checkGun(page, "akimbo");
});
