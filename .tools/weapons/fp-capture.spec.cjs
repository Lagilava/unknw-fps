const { test } = require("@playwright/test");

test.use({ channel: "chrome", viewport: { width: 1280, height: 720 } });
test.setTimeout(120000);

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
const OUT = "test-artifacts";

test("capture unified first-person view", async ({ page }) => {
  const errs = [];
  page.on("pageerror", e => { errs.push(e.message); console.log("PAGEERROR:", e.message); });
  page.on("console", m => { if (m.type() === "error" || /WebGPU|WebGL|renderer/i.test(m.text())) console.log("CONSOLE:", m.type(), m.text()); });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState() === "playing", { timeout: 20000 });

  const backend = await page.evaluate(() => document.getElementById("gameCanvas")?.dataset?.rendererBackend);
  console.log("RENDERER BACKEND:", backend);

  await page.keyboard.press("KeyF"); // flashlight for visibility
  await page.waitForTimeout(2500);

  // FP straight ahead
  await page.screenshot({ path: `${OUT}/fp-01-straight.png` });

  // Look down a bit to see gun/hands
  await page.evaluate(() => { window.__rbTest.aimAtNearest?.(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/fp-02-aim.png` });

  // Spawn enemy in front and aim so world is visible
  await page.evaluate(() => window.__rbTest.spawnAt?.("Cloned Ghost", 0, -6));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__rbTest.aimAtNearest?.());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/fp-03-enemy.png` });

  // Third person for comparison
  await page.keyboard.press("KeyM");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/fp-04-thirdperson.png` });

  // Back to FP
  await page.keyboard.press("KeyM");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/fp-05-fp-again.png` });

  console.log("PAGEERRORS:", JSON.stringify(errs));
});
