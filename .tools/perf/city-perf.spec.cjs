const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test("city grid actual draw calls (spawn vs looking down the street)", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getState);
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  const read = async () => { await page.waitForTimeout(400); return page.evaluate(() => window.__rbTest.getFrameStats()); };
  // 1) interior spawn
  await page.evaluate(() => window.__rbTest.tpTo(0, 20, 0, 0));
  const spawn = await read();
  // 2) at the plaza mouth looking DOWN the city street (worst case: whole avenue in view)
  await page.evaluate(() => window.__rbTest.tpTo(0, 128, 0, 0)); // facing +? yaw 0
  const street = await read();
  // 3) deep in the city looking back down it
  await page.evaluate(() => window.__rbTest.tpTo(0, 360, Math.PI, 0));
  const deep = await read();
  console.log("DRAWS spawn=", spawn.drawCalls, "street=", street.drawCalls, "deep=", deep.drawCalls);
  console.log("TRIS  spawn=", spawn.triangles, "street=", street.triangles, "deep=", deep.triangles);
  expect(Math.max(spawn.drawCalls, street.drawCalls, deep.drawCalls)).toBeGreaterThan(0);
});
