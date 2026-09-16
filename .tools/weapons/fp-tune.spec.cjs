const { test } = require("@playwright/test");
const fs = require("fs");

test.use({ channel: "chrome", viewport: { width: 1280, height: 720 } });
test.setTimeout(300000);

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
const OUT = "test-artifacts";

// Configs come from env FP_CONFIGS (JSON array of {name, tune}); default is a sweep.
const CONFIGS = JSON.parse(process.env.FP_CONFIGS || JSON.stringify([
  { name: "efwd-0.34", tune: { eyeForward: 0.34 } },
  { name: "efwd-0.80", tune: { eyeForward: 0.80 } },
  { name: "efwd-1.50", tune: { eyeForward: 1.50 } },
  { name: "efwd-neg0.30", tune: { eyeForward: -0.30 } },
]));

test("fp tune sweep", async ({ page }) => {
  page.on("pageerror", e => console.log("PAGEERROR:", e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 20000 });

  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.keyboard.press("KeyF");
  const noEnemy = process.env.FP_NOENEMY === "1";
  if (!noEnemy) {
    // enemy dead ahead for world reference, at eye-ish level
    await page.evaluate(() => window.__rbTest.spawnAt("Cloned Ghost", 0, -9));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__rbTest.aimAtNearest());
  }
  await page.waitForTimeout(1200); // warmup: let flashlight + lighting settle

  for (const c of CONFIGS) {
    const applied = await page.evaluate(t => window.__rbTest.setFpTune(t), c.tune);
    if (!noEnemy) await page.evaluate(() => window.__rbTest.aimAtNearest());
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/tune-${c.name}.png` });
    const st = await page.evaluate(() => window.__rbTest.getFpState());
    console.log("CONFIG", c.name, "=>", JSON.stringify(applied), "STATE", JSON.stringify(st));
  }
});
