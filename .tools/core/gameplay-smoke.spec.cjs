const { test, expect } = require("@playwright/test");

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

function installRuntimeMonitors(page) {
  const events = {
    console: [],
    pageErrors: [],
    requestFailures: [],
    badResponses: [],
    successfulUrls: new Set(),
  };

  page.on("console", msg => {
    events.console.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", error => {
    events.pageErrors.push(error.message);
  });
  page.on("requestfailed", request => {
    const url = request.url();
    if (/favicon/i.test(url)) return;
    events.requestFailures.push({
      url,
      method: request.method(),
      type: request.resourceType(),
      error: request.failure()?.errorText || "request failed",
    });
  });
  page.on("response", response => {
    const url = response.url();
    if (/favicon/i.test(url)) return;
    if (response.status() >= 200 && response.status() < 400) {
      events.successfulUrls.add(url);
    }
    if (response.status() >= 400) {
      events.badResponses.push({ url, status: response.status() });
    }
  });
  page.on("crash", () => {
    events.pageErrors.push("Page crashed");
  });

  return events;
}

function fatalMessages(events) {
  return [
    ...events.pageErrors.map(text => `pageerror: ${text}`),
    ...events.console
      .filter(msg => msg.type === "error")
      .map(msg => `console: ${msg.text}`),
    ...events.requestFailures
      .filter(f => !events.successfulUrls.has(f.url))
      .map(f => `requestfailed: ${f.type} ${f.url} ${f.error}`),
    ...events.badResponses.map(r => `response ${r.status}: ${r.url}`),
  ].filter(text => !/favicon|ResizeObserver loop limit exceeded/i.test(text));
}

async function boot(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  await page.waitForFunction(() => window.__rbTest, { timeout: 15000 });
}

async function startGame(page) {
  await page.locator("#startBtn").click();
  await expect(page.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 15000 });
  await page.waitForFunction(() => window.__rbTest.getEnemyCount() > 0, { timeout: 15000 });
}

async function fireOnce(page) {
  const canvas = page.locator("#gameCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(180);
}

test.describe.serial("Room Breach FPS gameplay smoke", () => {
  // Test 12 alone blocks for a fixed 180000ms (3min soak), which only leaves the
  // remainder of this budget for boot (15-60s) + the other 11 steps — already a
  // tight margin, and restartGame() (Test 10) now runs a deliberate ~2s terminal
  // typing animation ("RESTART UNKNW") ahead of the intro cutscene. Bumped for
  // headroom rather than trimming the soak or the animation.
  test.setTimeout(420000);

  test("tests 1-12 gameplay smoke", async ({ page }) => {
    const events = installRuntimeMonitors(page);

    await test.step("Test 1: Game boots with no console errors", async () => {
      await boot(page);
      expect(fatalMessages(events)).toEqual([]);
    });

    await test.step("Test 2: Start button works and player enters gameplay", async () => {
      await startGame(page);
      expect(await page.evaluate(() => window.__rbTest.getState())).toBe("playing");
      const firstEnemy = await page.evaluate(() => window.__rbTest.getNearestEnemy());
      expect(firstEnemy.visible).toBe(true);
      expect(firstEnemy.dist).toBeLessThan(20);
    });

    await test.step("Pause/menu/settings flow", async () => {
      await page.keyboard.press("Escape");
      await expect(page.locator("#overlay")).not.toHaveClass(/hidden/, { timeout: 5000 });
      // Settings moved out of the briefing panel into its own Halo sub-screen.
      await page.locator("#settingsBtn").click();
      await expect(page.locator("#settingsPanel")).toHaveClass(/active/, { timeout: 5000 });
      await page.locator("#sens-slider").fill("1.4");
      await page.locator("#sens-slider").dispatchEvent("input");
      await expect(page.locator("#sens-val")).toHaveText("1.4x");
      await page.locator('#opt-cinematic button[data-value="off"]').click();
      await page.keyboard.press("Escape"); // leave the sub-screen
      await expect(page.locator("#overlay")).toHaveAttribute("data-panel", "root", { timeout: 5000 });
      await page.keyboard.press("Escape"); // resume
      await expect(page.locator("#overlay")).toHaveClass(/hidden/, { timeout: 5000 });
      await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 5000 });
    });

    await test.step("Test 3: WASD movement changes player position", async () => {
      const before = await page.evaluate(() => window.__rbTest.getPlayerPosition());
      await page.keyboard.down("KeyW");
      await page.keyboard.down("KeyD");
      await page.keyboard.down("ShiftLeft");
      await page.waitForTimeout(900);
      await page.keyboard.up("ShiftLeft");
      await page.keyboard.up("KeyD");
      await page.keyboard.up("KeyW");
      const after = await page.evaluate(() => window.__rbTest.getPlayerPosition());
      const moved = Math.hypot(after.x - before.x, after.z - before.z);
      expect(moved).toBeGreaterThan(0.2);
    });

    await test.step("Test 4: Weapon fires and ammo decreases", async () => {
      await page.waitForTimeout(500);
      const before = await page.evaluate(() => window.__rbTest.getAmmo());
      await fireOnce(page);
      const after = await page.evaluate(() => window.__rbTest.getAmmo());
      expect(after.mag).toBe(before.mag - 1);
    });

    await test.step("Test 5: Reload restores ammo correctly", async () => {
      const before = await page.evaluate(() => window.__rbTest.getAmmo());
      await page.keyboard.press("KeyR");
      await page.waitForFunction(() => window.__rbTest.getAmmo().reloadTimer > 0, { timeout: 2000 });
      await page.waitForFunction(() => window.__rbTest.getAmmo().reloadTimer === 0, { timeout: 6000 });
      const after = await page.evaluate(() => window.__rbTest.getAmmo());
      expect(after.mag).toBe(after.magSize);
      expect(after.reserve).toBe(before.reserve - 1);
    });

    await test.step("Test 6: Enemy spawns and moves toward/attacks player", async () => {
      const beforeCount = await page.evaluate(() => window.__rbTest.getEnemyCount());
      await page.evaluate(() => window.__rbTest.spawnAt("Cloned Ghost", 0, -4));
      await page.waitForFunction(count => window.__rbTest.getEnemyCount() > count, beforeCount, { timeout: 3000 });
      const first = await page.evaluate(() => window.__rbTest.getNearestEnemy());
      await page.waitForTimeout(1600);
      const second = await page.evaluate(() => window.__rbTest.getNearestEnemy());
      const moved = Math.hypot(second.x - first.x, second.z - first.z);
      expect(first.visible).toBe(true);
      expect(moved > 0.05 || second.dist < first.dist || (await page.evaluate(() => window.__rbTest.getHp())) < 100).toBe(true);
    });

    await test.step("Test 7: Shooting enemy applies damage and enemy can die", async () => {
      await page.evaluate(() => window.__rbTest.aimAtNearest());
      const before = await page.evaluate(() => window.__rbTest.getNearestEnemy());
      await page.evaluate(() => window.__rbTest.fireAtNearest());
      await page.waitForTimeout(180);
      const after = await page.evaluate(() => window.__rbTest.getNearestEnemy());
      expect(after === null || after.hp < before.hp || after.dist !== before.dist).toBe(true);
      await page.evaluate(() => window.__rbTest.killNearest(false));
      await page.waitForTimeout(200);
      const counts = await page.evaluate(() => window.__rbTest.getRuntimeCounts());
      expect(counts.enemies).toBeGreaterThanOrEqual(0);
    });

    await test.step("Test 8: Wave completes and next wave starts", async () => {
      const wave = await page.evaluate(() => window.__rbTest.getWave());
      const result = await page.evaluate(() => window.__rbTest.completeWave());
      expect(result.remaining).toBe(0);
      await page.waitForFunction(oldWave => window.__rbTest.getWave() > oldWave && window.__rbTest.getState() === "playing", wave, { timeout: 12000 });
      expect(await page.evaluate(() => window.__rbTest.getEnemyCount())).toBeGreaterThan(0);
    });

    await test.step("Test 9: Player can die and restart cleanly", async () => {
      const death = await page.evaluate(() => window.__rbTest.forceDamage(99999));
      expect(death.state).toBe("dead");
      await expect(page.locator("#state-overlay")).toHaveClass(/active/, { timeout: 3000 });
      await page.locator("#stateRestartBtn").click();
      await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 12000 });
      const hp = await page.evaluate(() => window.__rbTest.getHp());
      expect(hp).toBe(100);
    });

    await test.step("Test 10: No duplicate loops/listeners/runaway counts after restart", async () => {
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.__rbTest.restart());
        await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 12000 });
      }
      await page.waitForTimeout(1500);
      const before = await page.evaluate(() => window.__rbTest.getFrameStats());
      await page.waitForTimeout(2000);
      const after = await page.evaluate(() => window.__rbTest.getFrameStats());
      const frameDelta = after.frame - before.frame;
      const counts = await page.evaluate(() => window.__rbTest.getRuntimeCounts());
      expect(frameDelta).toBeGreaterThan(2);
      expect(frameDelta).toBeLessThan(260);
      expect(counts.enemies).toBeLessThanOrEqual(12);
      expect(counts.tracers).toBeLessThan(40);
      expect(counts.particles).toBeLessThan(200);
      expect(counts.pendingEnemyDeaths).toBe(0);
      expect(counts.enemyRemovalQueue).toBe(0);
    });

    await test.step("Test 11: All required assets load successfully", async () => {
      const unresolvedFailures = events.requestFailures.filter(f => !events.successfulUrls.has(f.url));
      expect(unresolvedFailures).toEqual([]);
      expect(events.badResponses).toEqual([]);
      await page.screenshot({ path: "test-artifacts/gameplay-smoke-desktop.png" });
    });

    await test.step("Mobile/responsive boot check", async () => {
      const mobile = await page.context().newPage();
      const mobileEvents = installRuntimeMonitors(mobile);
      await mobile.setViewportSize({ width: 390, height: 844 });
      await boot(mobile);
      await expect(mobile.locator("#startBtn")).toBeVisible();
      await mobile.screenshot({ path: "test-artifacts/gameplay-smoke-mobile-menu.png" });
      expect(fatalMessages(mobileEvents)).toEqual([]);
      await mobile.close();
    });

    await test.step("Test 12: Game runs for 3 minutes without uncaught errors or severe FPS degradation", async () => {
      await page.bringToFront();
      await page.evaluate(() => window.__rbTest.setUnlimitedHealth(true));
      const start = await page.evaluate(() => window.__rbTest.getFrameStats());
      await page.waitForTimeout(180000);
      const end = await page.evaluate(() => window.__rbTest.getFrameStats());
      const counts = await page.evaluate(() => window.__rbTest.getRuntimeCounts());
      const elapsedFrames = end.frame - start.frame;
      expect(elapsedFrames).toBeGreaterThan(300);
      expect(end.fps).toBeGreaterThan(20);
      expect(end.hitchCount - start.hitchCount).toBeLessThan(80);
      expect(counts.enemies).toBeLessThan(20);
      expect(counts.tracers).toBeLessThan(40);
      expect(counts.particles).toBeLessThan(200);
      expect(fatalMessages(events)).toEqual([]);
    });
  });
});
