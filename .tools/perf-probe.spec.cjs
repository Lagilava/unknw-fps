const { test } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("profile draw calls in steady-state play", async ({ page }) => {
  const all = [];
  page.on("console", (m) => all.push(m.text()));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.waitForFunction(() => window.__rbTest.getEnemyCount() > 0, { timeout: 15000 });
  await page.waitForTimeout(2000);

  const est = await page.evaluate(() => window.__rbDraws && window.__rbDraws());
  await page.waitForTimeout(300);

  const drawLines = all.filter((l) => /draws|\binst×|_x#|merged|static|window|Window|ext_|Warden|angel|zombie|Sky|light|Light/i.test(l));
  console.log("EST TOTAL RETURN:", est);
  console.log("---- __rbDraws OUTPUT ----");
  for (const l of all.slice(-40)) console.log(l);
});
