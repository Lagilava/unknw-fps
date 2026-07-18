const { test } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test("intel + loadout screenshots", async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#intelBtn").click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/ui-intel.png", fullPage: false });
  await page.evaluate(() => { const p = document.getElementById("intelPanel"); if (p) p.scrollTop = p.scrollHeight; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/ui-intel-2.png" });
  const lb = page.locator("#loadoutBtn");
  if (await lb.count()) { await lb.click(); await page.waitForTimeout(700); await page.screenshot({ path: "test-results/ui-loadout.png" }); }
});
