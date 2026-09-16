const { test, expect } = require("@playwright/test");
test.use({ channel: "chrome" });
test.setTimeout(120000);
const BASE = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html";
const QS = "?test=1&peerhost=127.0.0.1&peerport=9000";

test("guest auto-starts when host clicks Launch", async ({ browser }) => {
  const errors = [];
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  for (const [p, label] of [[host,"HOST"],[guest,"GUEST"]]) {
    p.on("pageerror", e => errors.push(`[${label}] ${e.message}`));
    p.on("console", m => { if (m.type() === "error") errors.push(`[${label}] ${m.text()}`); });
    await p.goto(BASE + QS, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  }

  // Host: open lobby and host
  await host.click("#multiplayerBtn");
  await host.click("#mp-host-btn");
  await host.waitForFunction(() => {
    const el = document.getElementById("mp-code-display");
    return el && el.textContent.trim().length >= 4;
  }, { timeout: 20000 });
  const code = (await host.locator("#mp-code-display").textContent()).trim();

  // Guest: join
  await guest.click("#multiplayerBtn");
  await guest.click("#mp-join-toggle");
  await guest.fill("#mp-code-input", code);
  await guest.click("#mp-join-btn");
  await host.waitForFunction(() => window.__rbTest.getNetActive(), { timeout: 15000 });
  await guest.waitForFunction(() => window.__rbTest.getNetActive(), { timeout: 15000 });

  // Confirm guest is still in the menu before host launches
  const guestBeforeState = await guest.evaluate(() => window.__rbTest ? "game_" + window.__game?.state : document.getElementById("overlay")?.classList.contains("hidden") ? "playing" : "menu");
  console.log("guest state before host launch:", guestBeforeState);
  expect(await guest.evaluate(() => !document.getElementById("overlay")?.classList.contains("hidden"))).toBe(true);

  // Host clicks Launch — guest should auto-start WITHOUT any manual action
  await host.click("#mp-start-btn");

  // Host overlay hides
  await expect(host.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });

  // Guest overlay should hide automatically (this is the bug being fixed)
  await expect(guest.locator("#overlay")).toHaveClass(/hidden/, { timeout: 12000 });

  // Guest should also be in playing state with enemies
  await guest.waitForFunction(() => window.__rbTest.getEnemyCount() >= 0, { timeout: 10000 });
  console.log("guest is now playing — enemy count:", await guest.evaluate(() => window.__rbTest.getEnemyCount()));

  const fatal = errors.filter(t => !/favicon|404|Failed to load resource/i.test(t));
  expect(fatal, fatal.join("\n")).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
