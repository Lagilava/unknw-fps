const { test } = require("@playwright/test");

test.use({ channel: "chrome", viewport: { width: 1280, height: 720 } });
test.setTimeout(120000);

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

async function boot(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getEnemyCount() >= 0, { timeout: 15000 });
}

test("capture weapon sizes + megablast", async ({ page }) => {
  page.on("pageerror", e => console.log("PAGEERROR:", e.message));
  await boot(page);
  await page.keyboard.press("KeyF"); // flashlight on for visibility

  // Third-person view to see the player's held weapon
  await page.keyboard.press("KeyM");
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-artifacts/cap-thirdperson-weapon.png" });

  // Spawn a cloned ghost right in front (1m below eye height view) and look at it
  await page.evaluate(() => window.__rbTest.spawnAt("Cloned Ghost", 0, -3.5));
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-artifacts/cap-ghost-weapon.png" });

  // Trigger the megablast (kamehameha)
  await page.evaluate(() => window.__rbTest.forceMegaBlast());
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-artifacts/cap-megablast.png" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: "test-artifacts/cap-megablast-2.png" });
});
