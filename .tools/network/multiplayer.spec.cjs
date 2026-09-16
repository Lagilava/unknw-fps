const { test, expect, chromium } = require("@playwright/test");

test.use({ channel: "chrome" });
test.setTimeout(180000);

const BASE = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html";
const QS = "?test=1&peerhost=127.0.0.1&peerport=9000";

async function boot(page, label) {
  const errors = [];
  page.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  page.on("console", m => { if (m.type() === "error") errors.push(`[${label}] ${m.text()}`); });
  await page.goto(BASE + QS, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const el = document.getElementById("loading-screen");
    return el && el.classList.contains("hidden");
  }, undefined, { timeout: 90000 });
  return errors;
}

test("two peers connect and see each other's avatar", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const errA = await boot(pageA, "HOST");
  const errB = await boot(pageB, "GUEST");

  // HOST: open multiplayer panel and host a game
  await pageA.click("#multiplayerBtn");
  await pageA.click("#mp-host-btn");
  // Wait for the room code to appear
  await pageA.waitForFunction(() => {
    const el = document.getElementById("mp-code-display");
    return el && !el.classList.contains("hidden") && el.textContent.trim().length >= 4;
  }, undefined, { timeout: 30000 });
  const code = (await pageA.locator("#mp-code-display").textContent()).trim();
  expect(code.length).toBeGreaterThanOrEqual(4);

  // GUEST: open panel, join with the code
  await pageB.click("#multiplayerBtn");
  await pageB.click("#mp-join-toggle");
  await pageB.fill("#mp-code-input", code);
  await pageB.click("#mp-join-btn");

  // Both sides should register the connection
  await pageA.waitForFunction(() => window.__rbTest.getNetActive(), undefined, { timeout: 20000 });
  await pageB.waitForFunction(() => window.__rbTest.getNetActive(), undefined, { timeout: 20000 });

  // Start the game from the host; guests auto-enter from the host "start" message.
  await pageA.click("#mp-start-btn");
  await expect(pageA.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });
  await expect(pageB.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });

  // Each client should create a remote avatar for the other within a few seconds
  await pageA.waitForFunction(() => window.__rbTest.getRemoteCount() >= 1, undefined, { timeout: 20000 });
  await pageB.waitForFunction(() => window.__rbTest.getRemoteCount() >= 1, undefined, { timeout: 20000 });

  // Drive HOST movement (hold W), confirm GUEST sees the remote target position change
  const before = await pageB.evaluate(() => window.__rbTest.getFirstRemoteTarget());
  await pageA.evaluate(() => {
    // simulate sustained forward movement
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
  });
  await pageA.waitForTimeout(2500);
  await pageA.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" })));
  const after = await pageB.evaluate(() => window.__rbTest.getFirstRemoteTarget());

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  console.log("HOST moved (seen by GUEST):", moved.toFixed(3), "from", before, "to", after);
  expect(moved).toBeGreaterThan(0.3);

  const fatal = [...errA, ...errB].filter(t => !/favicon|404|Failed to load resource/i.test(t));
  expect(fatal, fatal.join("\n")).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});
