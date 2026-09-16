const { test } = require("@playwright/test");

test.use({ channel: "chrome", viewport: { width: 1280, height: 720 } });
test.setTimeout(180000);
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
const OUT = "test-artifacts";

const CONFIGS = JSON.parse(process.env.FP_CONFIGS || "[]");
const YAW = Number(process.env.FP_YAW ?? -1.5708); // face +X (map interior) from the corner

test("fp eval", async ({ page }) => {
  page.on("pageerror", e => console.log("PAGEERROR:", e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 20000 });
  await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
  await page.keyboard.press("KeyF");
  await page.waitForFunction(() => window.__rbTest.getFpState().unifiedActive === true, { timeout: 15000 });
  const p = await page.evaluate(() => window.__rbTest.getPlayerPosition());

  for (const c of CONFIGS) {
    await page.evaluate(t => window.__rbTest.setFpTune(t), c.tune);
    await page.evaluate(([x, z, y]) => window.__rbTest.tpTo(x, z, y, 0.0), [p.x, p.z, YAW]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/eval-${c.name}-level.png` });
    await page.evaluate(([x, z, y]) => window.__rbTest.tpTo(x, z, y, 0.5), [p.x, p.z, YAW]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/eval-${c.name}-down.png` });
    const st = await page.evaluate(() => window.__rbTest.getFpState());
    console.log("CFG", c.name, JSON.stringify(st));
  }
});
