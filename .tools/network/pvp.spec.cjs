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

test("pvp: players damage, frag, and respawn", async ({ browser }) => {
  const errors = [];
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  await boot(host, "HOST", errors);
  await boot(guest, "GUEST", errors);

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

  // Host switches to PvP and the config should propagate to the guest
  await host.click("#mp-mode-btn");
  await guest.waitForFunction(() => window.__rbTest.getMode() === "pvp", undefined, { timeout: 15000 });

  // Start PvP from the host; guests auto-enter from the host "start" message.
  await host.click("#mp-start-btn");
  await expect(host.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });
  await expect(guest.locator("#overlay")).toHaveClass(/hidden/, { timeout: 8000 });

  expect(await host.evaluate(() => window.__rbTest.getMode())).toBe("pvp");
  expect(await guest.evaluate(() => window.__rbTest.getMode())).toBe("pvp");

  // Avatars present on both sides
  await host.waitForFunction(() => window.__rbTest.getRemoteCount() >= 1, undefined, { timeout: 20000 });
  await guest.waitForFunction(() => window.__rbTest.getRemoteCount() >= 1, undefined, { timeout: 20000 });

  // Host deals non-lethal damage; guest hp should drop
  const guestHp0 = await guest.evaluate(() => window.__rbTest.getHp());
  await host.evaluate(() => window.__rbTest.pvpHitFirstRemote(35, false));
  await guest.waitForFunction(h => window.__rbTest.getHp() < h, guestHp0, { timeout: 8000 });
  console.log("guest hp:", guestHp0, "->", await guest.evaluate(() => window.__rbTest.getHp()));

  // Host deals lethal damage; guest should die, host should earn a frag, guest should respawn
  await host.evaluate(() => window.__rbTest.pvpHitFirstRemote(500, true));
  await guest.waitForFunction(() => window.__rbTest.getPvpDead() === true, undefined, { timeout: 8000 });
  await host.waitForFunction(() => window.__rbTest.getMyFrags() >= 1, undefined, { timeout: 8000 });
  console.log("host frags:", await host.evaluate(() => window.__rbTest.getMyFrags()));

  // Guest respawns within ~4s with restored health
  await guest.waitForFunction(() => window.__rbTest.getPvpDead() === false, undefined, { timeout: 8000 });
  const guestHpAfter = await guest.evaluate(() => window.__rbTest.getHp());
  console.log("guest hp after respawn:", guestHpAfter);
  expect(guestHpAfter).toBeGreaterThan(50);

  const fatal = errors.filter(t => !/favicon|404|Failed to load resource/i.test(t));
  expect(fatal, fatal.join("\n")).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});
