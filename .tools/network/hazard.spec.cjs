const { test, expect } = require("@playwright/test");

test.use({ channel: "chrome" });
test.setTimeout(120000);

const BASE = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html";
const QS = "?test=1&peerhost=127.0.0.1&peerport=9000";

test("pvp hazard zones telegraph and damage players inside", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + QS, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  // Host a PvP session solo (hazards run host-side; no guest needed)
  await page.click("#multiplayerBtn");
  await page.click("#mp-host-btn");
  await page.waitForFunction(() => window.__rbTest.getNetActive(), { timeout: 20000 });
  await page.click("#mp-mode-btn"); // -> pvp
  await page.click("#mp-start-btn");
  await expect(page.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });
  expect(await page.evaluate(() => window.__rbTest.getMode())).toBe("pvp");

  // Wait until a hazard zone becomes live, then stand in it and confirm damage
  await page.waitForFunction(() => window.__rbTest.getHazardState() === "active" && window.__rbTest.getActiveHazardPos(), { timeout: 20000 });
  const zone = await page.evaluate(() => window.__rbTest.getActiveHazardPos());
  expect(zone).not.toBeNull();

  const hp0 = await page.evaluate(() => window.__rbTest.getHp());
  // Teleport onto the live zone center and hold there
  await page.evaluate(z => {
    window.__rbTest.teleportTo(z.x, z.z);
  }, zone);
  // keep re-centering for ~1.5s while it's active so we accumulate burn damage
  await page.evaluate(async z => {
    const start = performance.now();
    while (performance.now() - start < 1500) {
      if (window.__rbTest.getHazardState() === "active") window.__rbTest.teleportTo(z.x, z.z);
      await new Promise(r => setTimeout(r, 60));
    }
  }, zone);

  const hp1 = await page.evaluate(() => window.__rbTest.getHp());
  console.log("hazard hp:", hp0, "->", hp1);
  expect(hp1).toBeLessThan(hp0);

  const fatal = errors.filter(t => !/favicon|404|Failed to load resource/i.test(t));
  expect(fatal, fatal.join("\n")).toEqual([]);
});
