// Temporary probe: drives the blackout cutscene headless and screenshots each phase.
const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
const OUT = "C:/Users/emi/AppData/Local/Temp/claude/c--Users-emi-Downloads-Room-breach-fps11/c33d3916-a902-4f2b-8e84-3ac48b8052ce/scratchpad";

test("blackout cutscene: phases render and camera lands on the TP pose", async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 60000 });
  await page.waitForTimeout(4000); // let TP rig finish loading

  const started = await page.evaluate(() => window.__rbTest.startBlackoutCutscene());
  expect(started).toBe(true);

  // Phase A mid-point (game-time driven; headless framerate is slow, so poll t).
  await page.waitForFunction(() => window.__rbTest.getCutsceneState().t > 1.0, { timeout: 60000 });
  let st = await page.evaluate(() => window.__rbTest.getCutsceneState());
  expect(st.active).toBe(true);
  expect(st.phase).toBe(0);
  expect(st.letterbox).toBe(true);
  await page.screenshot({ path: OUT + "/cutscene-phaseA-sun.png" });

  await page.waitForFunction(() => window.__rbTest.getCutsceneState().phase === 1, { timeout: 90000 });
  await page.waitForFunction(() => window.__rbTest.getCutsceneState().t > 4.0, { timeout: 90000 });
  await page.screenshot({ path: OUT + "/cutscene-phaseB-pan.png" });

  await page.waitForFunction(() => window.__rbTest.getCutsceneState().phase === 2, { timeout: 90000 });
  await page.screenshot({ path: OUT + "/cutscene-phaseC-return.png" });

  await page.waitForFunction(() => !window.__rbTest.getCutsceneState().active, { timeout: 90000 });
  const end = await page.evaluate(() => ({
    ...window.__rbTest.getCutsceneState(),
    delta: window.__rbTest.getCutsceneLandingDelta(),
  }));
  expect(end.letterbox).toBe(false);
  expect(end.delta).toBeLessThan(0.05);

  await page.waitForTimeout(700); // HUD fade back
  const hudOp = await page.evaluate(() => getComputedStyle(document.getElementById("hud")).opacity);
  expect(parseFloat(hudOp)).toBeGreaterThan(0.9);
  await page.screenshot({ path: OUT + "/cutscene-end-gameplay.png" });
  console.log("landing delta:", end.delta);
});

test("unskippable: keys do NOT skip; cutscene completes and lands cleanly", async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__rbTest.startBlackoutCutscene());
  await page.waitForFunction(() => window.__rbTest.getCutsceneState().t > 0.5, { timeout: 60000 });
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => window.__rbTest.getCutsceneState());
  // Blackout cutscenes are UNSKIPPABLE (user requirement): input is swallowed.
  expect(st.active).toBe(true);
  expect(st.phase).toBeLessThan(2);
  await page.waitForFunction(() => !window.__rbTest.getCutsceneState().active, { timeout: 60000 });
  const delta = await page.evaluate(() => window.__rbTest.getCutsceneLandingDelta());
  expect(delta).toBeLessThan(0.05);
});
