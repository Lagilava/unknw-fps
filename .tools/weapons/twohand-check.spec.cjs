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

async function probe(page, label) {
  const d = await page.evaluate(() => {
    const r = window.__rbReload();
    const dist = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : NaN;
    return {
      gun: r.gunPos, rh: r.rightHand, lh: r.leftHand,
      gunToRight: dist(r.gunPos, r.rightHand),
      gunToLeft: dist(r.gunPos, r.leftHand),
      gunAboveRight: r.gunPos && r.rightHand ? (r.gunPos.y - r.rightHand.y) : NaN,
    };
  });
  console.log(`[PROBE] ${label}: gun→rightHand=${d.gunToRight.toFixed(3)}  gun→leftHand=${d.gunToLeft.toFixed(3)}  gunY-rightY=${d.gunAboveRight.toFixed(3)}  gun=(${d.gun.x.toFixed(2)},${d.gun.y.toFixed(2)},${d.gun.z.toFixed(2)}) rh=(${d.rh.x.toFixed(2)},${d.rh.y.toFixed(2)},${d.rh.z.toFixed(2)})`);
  return d;
}

async function shots(page, tag) {
  const views = [
    { name: "side", cam: [2.8, 1.6, 42], tgt: [0, 1.3, 42] },
    { name: "threequarter", cam: [2.0, 1.8, 39.6], tgt: [0, 1.3, 42] },
  ];
  for (const v of views) {
    await page.evaluate(({ cam, tgt }) => window.__rbTest.freeCam(cam[0], cam[1], cam[2], tgt[0], tgt[1], tgt[2]), v);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `test-results/twohand-shotgun-${tag}-${v.name}.png` });
  }
  await page.evaluate(() => window.__rbTest.freeCamOff());
  await page.waitForTimeout(150);
}

// Clean pass: NO freeCam (freeCam moves the real `camera`, which aimArmAtPoint
// reads — it corrupts the aim solve). Default TP camera only.
test("shotgun clean default-camera pass", async ({ page }) => {
  test.setTimeout(420000);
  await boot(page);
  await page.evaluate(() => window.__rbTest.grantGun("shotgun"));
  await page.waitForTimeout(600);

  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, -0.8));
  await page.waitForTimeout(500);
  await probe(page, "clean precal lookdown hip");
  await page.screenshot({ path: "test-results/twohand-clean-precal-lookdown-hip.png" });

  // Calibrate at level ADS
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
  const box = await page.locator("#gameCanvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(1400);
  await probe(page, "clean postcal level ADS");
  await page.screenshot({ path: "test-results/twohand-clean-postcal-level-ads.png" });

  // Sweep pitch while ADS, default camera
  for (const p of [-0.4, -0.8, 0.4]) {
    await page.evaluate((pv) => window.__rbTest.tpTo(0, 42, 0, pv), p);
    await page.waitForTimeout(500);
    await probe(page, `clean postcal ADS pitch ${p}`);
    await page.screenshot({ path: `test-results/twohand-clean-postcal-ads-pitch${p}.png` });
  }
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, -0.8));
  await page.waitForTimeout(500);
  await probe(page, "clean postcal lookdown hip");
  await page.screenshot({ path: "test-results/twohand-clean-postcal-lookdown-hip.png" });
});

test("shotgun two-hand hold diagnosis", async ({ page }) => {
  test.setTimeout(420000);
  page.on("console", (m) => { if (m.text().startsWith("[")) console.log("PAGE:", m.text()); });
  await boot(page);
  await page.evaluate(() => window.__rbTest.grantGun("shotgun"));
  await page.waitForTimeout(600);

  // ── UNCALIBRATED (legacy world-pose path) ──
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
  await page.waitForTimeout(500);
  await probe(page, "precal level hip");
  await shots(page, "precal-level-hip");

  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, -0.8)); // looking DOWN
  await page.waitForTimeout(500);
  await probe(page, "precal lookdown hip");
  await shots(page, "precal-lookdown-hip");

  // ── CALIBRATE: ADS at level pitch ──
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
  await page.waitForTimeout(300);
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(1400);
  await probe(page, "postcal level ADS");
  await shots(page, "postcal-level-ads");

  // ── looking down while ADS (calibrated, gun parented to hand) ──
  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, -0.8));
  await page.waitForTimeout(500);
  await probe(page, "postcal lookdown ADS");
  await shots(page, "postcal-lookdown-ads");

  // ── release ADS: hip poses, still calibrated/parented ──
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(800);
  await probe(page, "postcal lookdown hip");
  await shots(page, "postcal-lookdown-hip");

  await page.evaluate(() => window.__rbTest.tpTo(0, 42, 0, 0));
  await page.waitForTimeout(600);
  await probe(page, "postcal level hip");
  await shots(page, "postcal-level-hip");
});
