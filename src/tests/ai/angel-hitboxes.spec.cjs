// Angel (Warden / Seraph / Cherub) hit registration + blackout god mode.
//
// The angels hover ~1.6 m above their grounded build pose and pose their arms and
// head in flight, so their hit volumes are bone-anchored. This spec shoots probe
// rays at the RENDERED skinned body (must hit), at the empty air under it (must
// miss), and at the head bone (must score a head part), then checks a real
// fireGun() shot lands, and that blackout waves make the player untouchable.
const { test, expect } = require("@playwright/test");

const ANGELS = ["Siege Drone", "Blink Seraph", "Null Cherub"];

test("angel hitboxes match the hovering body; blackout waves are god mode", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1");
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", null, { timeout: 180000 });
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest?.getState() === "playing", null, { timeout: 60000 });

  await page.evaluate((angels) => {
    const t = window.__rbTest;
    t.setUnlimitedHealth(true);
    angels.forEach((name, i) => t.spawnAt(name, (i - 1) * 4, -10));
  }, ANGELS);
  // Let each rig run its update() for a while so it is hovering / posed.
  await page.waitForTimeout(4000);

  const probes = await page.evaluate(() => window.__rbTest.probeAngelHitboxes(80));
  console.log("angel hitbox probes:", JSON.stringify(probes, null, 1));
  for (const name of ANGELS) {
    const p = probes.find((r) => r.type === name);
    expect(p, `${name} probed`).toBeTruthy();
    // It really is hovering: the lowest rendered vertex is off the floor (the
    // Cherub hunkers lowest, into its EMP charge).
    expect(p.bodyMinY).toBeGreaterThan(0.3);
    // Rays at the visible body connect (thin spikes/claw tips may slip through).
    expect(p.bodyHits / p.bodyShots, `${name} body coverage`).toBeGreaterThan(0.85);
    // Rays through the empty air beneath it do not.
    expect(p.airHits, `${name} phantom hits under the body`).toBe(0);
    // Where the rendered head is the first thing a ray meets, it scores "head".
    // (Probe points include the head's silhouette edge; side-on, a few of those
    // graze the near pauldron capsule and score torso instead — still a hit.)
    if (p.headVisible > 0) expect(p.headAgree / p.headVisible, `${name} head`).toBeGreaterThanOrEqual(0.5);
  }

  const headVisible = probes.reduce((s, p) => s + p.headVisible, 0);
  const headAgree = probes.reduce((s, p) => s + p.headAgree, 0);
  expect(headVisible, "at least one head was in view").toBeGreaterThan(0);
  expect(headAgree / headVisible, "visible head hits scored as head").toBeGreaterThanOrEqual(0.85);

  // A real shot aimed at the body's hit centre lands and flares the armour.
  // (Aim, let the camera render the new aim, then fire — the shot ray is cast
  // from the camera's world matrix. Any angel may take it: they crowd the line.)
  const shot = await page.evaluate(async (angels) => {
    const t = window.__rbTest;
    const angelHp = () => t.getEnemyDebug().filter((e) => angels.includes(e.type))
      .reduce((sum, e) => sum + e.hp, 0);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    let before = 0, after = 0;
    for (let attempt = 0; attempt < 6 && after >= before; attempt++) {
      t.aimAtNearest();
      await frame(); await frame();
      t.aimAtNearest();
      before = angelHp();
      t.fireAtNearest();
      after = angelHp();
      await new Promise((r) => setTimeout(r, 400)); // fire cooldown
    }
    return { before, after, ammo: t.getAmmo(), weapon: t.getWeaponSwitch(), state: t.getState() };
  }, ANGELS);
  console.log("real shot:", JSON.stringify(shot));
  expect(shot.after).toBeLessThan(shot.before);

  // Blackout (wave % 10 === 0): god mode. Normal waves: damage applies.
  const god = await page.evaluate(() => {
    const t = window.__rbTest;
    t.setUnlimitedHealth(false);
    t.setWaveLighting(10);
    const hp0 = t.getHp();
    const blackout = { god: t.isGodMode(), hit: t.forceDamage(40).hp, hp0 };
    t.setWaveLighting(11);
    const normal = { god: t.isGodMode(), hit: t.forceDamage(40).hp, hp0: blackout.hit };
    return { blackout, normal };
  });
  expect(god.blackout.god).toBe(true);
  expect(god.blackout.hit).toBe(god.blackout.hp0);
  expect(god.normal.god).toBe(false);
  expect(god.normal.hit).toBeLessThan(god.normal.hp0);

  await page.screenshot({ path: "test-artifacts/angel-hitboxes.png" });
  expect(errors).toEqual([]);
});
