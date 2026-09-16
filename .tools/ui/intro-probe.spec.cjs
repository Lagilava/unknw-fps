const { test } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
test("intro probe", async ({ page }) => {
  test.setTimeout(300000);
  page.on("pageerror", e => console.log("PAGEERROR:", String(e).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE:", m.text().slice(0, 200)); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.evaluate(() => window.__rbTest.startIntroCutscene());
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(3000);
    const st = await page.evaluate(() => ({ cs: window.__rbTest.getCutsceneState(), state: window.__rbTest.getState() }));
    console.log("T+" + (i*3) + "s:", JSON.stringify(st));
    if (!st.cs.active) break;
  }
});
