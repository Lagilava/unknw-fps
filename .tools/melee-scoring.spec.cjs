const { test, expect } = require("@playwright/test");

test.use({ channel: "chrome" });
test.setTimeout(120000);

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("melee + scoring systems work without breaking the game", async ({ page }) => {
  const errors = [];
  const messages = [];
  page.on("console", m => {
    messages.push(`${m.type()}: ${m.text()}`);
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", e => errors.push(e.message));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });

  // New HUD score badge should be present and initialized.
  await expect(page.locator("#score-val")).toHaveText("0");
  await expect(page.locator("#best-score-val")).toBeVisible();

  await page.locator("#startBtn").click();
  await expect(page.locator("#overlay")).toHaveClass(/hidden/, { timeout: 5000 });

  // Wait until the test hook is live and enemies have spawned.
  await page.waitForFunction(() => window.__rbTest && window.__rbTest.getEnemyCount() > 0, { timeout: 15000 });

  // --- Scoring: a normal kill awards points ---
  const afterFirstKill = await page.evaluate(() => {
    const before = window.__rbTest.getScore();
    window.__rbTest.killNearest(false);
    return { before, after: window.__rbTest.getScore() };
  });
  expect(afterFirstKill.after).toBeGreaterThan(afterFirstKill.before);

  // --- Headshot awards more than a body kill of the same enemy value ---
  // Compare two single (non-multikill) kills: wait out the multikill window between them.
  await page.waitForTimeout(2000);
  const bodyKill = await page.evaluate(() => {
    const before = window.__rbTest.getScore();
    window.__rbTest.killNearest(false);
    return window.__rbTest.getScore() - before;
  });
  await page.waitForTimeout(2000);
  const headKill = await page.evaluate(() => {
    const before = window.__rbTest.getScore();
    window.__rbTest.killNearest(true);
    return window.__rbTest.getScore() - before;
  });
  // Headshot bonus (+75) should make a headshot kill worth strictly more.
  expect(headKill).toBeGreaterThan(bodyKill);

  // --- Multi-kill multiplier: two fast kills, second worth more than its base ---
  const multi = await page.evaluate(() => {
    // ensure enough enemies; jump nothing, just read deltas on rapid kills
    const k1Before = window.__rbTest.getScore();
    const ok1 = window.__rbTest.killNearest(false);
    const k1 = window.__rbTest.getScore() - k1Before;
    const k2Before = window.__rbTest.getScore();
    const ok2 = window.__rbTest.killNearest(false);
    const k2 = window.__rbTest.getScore() - k2Before;
    return { ok1, ok2, k1, k2 };
  });
  if (multi.ok1 && multi.ok2) {
    // Second rapid kill carries the x1.5 (or higher) multiplier -> larger than first.
    expect(multi.k2).toBeGreaterThan(multi.k1);
  }

  // --- Melee does not throw and updates HUD safely ---
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__rbTest.triggerMelee(); });
  await page.keyboard.press("KeyV");
  await page.waitForTimeout(500);

  // HUD score reflects internal score.
  const hudScore = await page.locator("#score-val").textContent();
  const internalScore = await page.evaluate(() => window.__rbTest.getScore());
  expect(Number(hudScore.replace(/,/g, ""))).toBe(internalScore);

  await page.screenshot({ path: "test-artifacts/melee-scoring.png" });

  const fatal = errors.filter(t => !/favicon|Failed to load resource.*404/i.test(t));
  expect(fatal, messages.join("\n")).toEqual([]);
});
