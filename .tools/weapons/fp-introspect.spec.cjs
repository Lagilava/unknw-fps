const { test } = require("@playwright/test");

test.use({ channel: "chrome", viewport: { width: 1280, height: 720 } });
test.setTimeout(120000);
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("introspect model", async ({ page }) => {
  page.on("pageerror", e => console.log("PAGEERROR:", e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 20000 });
  await page.waitForTimeout(1500);

  const dump = await page.evaluate(() => window.__rbTest.dumpModel());
  console.log("DUMP:", JSON.stringify(dump, null, 1));
});
