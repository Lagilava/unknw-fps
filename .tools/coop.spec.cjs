const { test, expect } = require("@playwright/test");

test.use({ channel: "chrome" });
test.setTimeout(180000);

const BASE = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html";
const QS = "?test=1&peerhost=127.0.0.1&peerport=9000";

async function boot(page, label, errors) {
  page.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
  page.on("console", m => { if (m.type() === "error") errors.push(`[${label}] ${m.text()}`); });
  await page.goto(BASE + QS, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
}

test("co-op: guest sees host enemies and kills are host-authoritative", async ({ browser }) => {
  const errors = [];
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  await boot(host, "HOST", errors);
  await boot(guest, "GUEST", errors);

  // Connect
  await host.click("#multiplayerBtn");
  await host.click("#mp-host-btn");
  await host.waitForFunction(() => {
    const el = document.getElementById("mp-code-display");
    return el && !el.classList.contains("hidden") && el.textContent.trim().length >= 4;
  }, undefined, { timeout: 30000 });
  const code = (await host.locator("#mp-code-display").textContent()).trim();

  await guest.click("#multiplayerBtn");
  await guest.click("#mp-join-toggle");
  await guest.fill("#mp-code-input", code);
  await guest.click("#mp-join-btn");
  await host.waitForFunction(() => window.__rbTest.getNetActive(), undefined, { timeout: 20000 });
  await guest.waitForFunction(() => window.__rbTest.getNetActive(), undefined, { timeout: 20000 });

  // Start co-op from the host; guests auto-enter from the host "start" message.
  await host.click("#mp-start-btn");
  await expect(host.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });
  await expect(guest.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });

  // Host should have real enemies; guest should receive proxies for them
  await host.waitForFunction(() => window.__rbTest.getEnemyCount() > 0, undefined, { timeout: 20000 });
  await guest.waitForFunction(() => window.__rbTest.getCoopProxyCount() > 0, undefined, { timeout: 20000 });

  const hostEnemies0 = await host.evaluate(() => window.__rbTest.getEnemyCount());
  const guestProxies0 = await guest.evaluate(() => window.__rbTest.getCoopProxyCount());
  console.log("host enemies:", hostEnemies0, "guest proxies:", guestProxies0);
  expect(guestProxies0).toBeGreaterThan(0);

  // Guest kills an enemy -> host authority applies it -> host kill count rises
  const hostKilled0 = await host.evaluate(() => window.__rbTest.getKilled());
  await guest.evaluate(() => window.__rbTest.guestDamageNearest());
  await host.waitForFunction(k => window.__rbTest.getKilled() > k, hostKilled0, { timeout: 10000 });
  const hostKilled1 = await host.evaluate(() => window.__rbTest.getKilled());
  console.log("host killed:", hostKilled0, "->", hostKilled1);
  expect(hostKilled1).toBeGreaterThan(hostKilled0);

  // Guest's kill count should reflect host authority via snapshot sync
  await guest.waitForFunction(k => window.__rbTest.getKilled() >= k, hostKilled1, { timeout: 10000 });
  const guestKilled = await guest.evaluate(() => window.__rbTest.getKilled());
  console.log("guest sees killed:", guestKilled);
  expect(guestKilled).toBeGreaterThanOrEqual(hostKilled1);

  const fatal = errors.filter(t => !/favicon|404|Failed to load resource/i.test(t));
  expect(fatal, fatal.join("\n")).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});
