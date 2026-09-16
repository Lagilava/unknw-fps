const { test, expect } = require("@playwright/test");
test.use({ channel: "chrome", viewport: { width: 1280, height: 720 } });
test.setTimeout(90000);
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("verify sky + lobby code + pvp hud", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  // Screenshot the menu view — the sky dome is visible through the windows
  await page.screenshot({ path: "test-artifacts/sky-after.png" });

  // Lobby: host game and confirm code is visible
  await page.click("#multiplayerBtn");
  await page.click("#mp-host-btn");
  await page.waitForFunction(() => {
    const wrap = document.getElementById("mp-code-wrap");
    const code = document.getElementById("mp-code-display");
    return wrap && wrap.style.display !== "none" && code.textContent.trim().length >= 4;
  }, { timeout: 20000 });
  await page.screenshot({ path: "test-artifacts/lobby-code-after.png" });

  const codeState = await page.evaluate(() => {
    const wrap = document.getElementById("mp-code-wrap");
    const code = document.getElementById("mp-code-display");
    return {
      wrapDisplay: getComputedStyle(wrap).display,
      codeText: code.textContent.trim(),
    };
  });
  console.log("CODE STATE:", JSON.stringify(codeState));
  expect(codeState.codeText.length).toBeGreaterThanOrEqual(4);
  expect(codeState.wrapDisplay).not.toBe("none");

  // PvP HUD — switch to pvp, start game
  await page.click("#mp-mode-btn");
  await page.click("#mp-start-btn");
  await expect(page.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-artifacts/pvp-hud-after.png" });

  const pvpHudVisible = await page.evaluate(() => {
    const el = document.getElementById("pvp-hud");
    return el && getComputedStyle(el).display !== "none";
  });
  console.log("PvP HUD visible:", pvpHudVisible);
  expect(pvpHudVisible).toBe(true);

  const fatal = errors.filter(t => !/favicon|404|Failed to load resource/i.test(t));
  expect(fatal, fatal.join("\n")).toEqual([]);
});
