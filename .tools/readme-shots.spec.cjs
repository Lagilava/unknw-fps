// Regenerates the README gallery in docs/screenshots/.
//
// Run against a real GPU (headed Chrome) — SwiftShader renders this scene at
// ~2.5 fps and washes out the HDR sky, which is exactly what a README shot
// must not look like:
//
//   npx playwright test .tools/readme-shots.spec.cjs --headed
//
// Every shot is staged through the read-only `?test=1` harness (`window.__rbTest`):
// clear the field, teleport the player, spawn the enemies the shot is about, let
// the scene settle, capture. Shots are wrapped individually so one bad stage
// can't lose the batch.
//
// Geometry notes (both cost a re-run when guessed wrong):
//   • `tpTo(x, z, yawRad, pitchRad)` — yaw = π faces **+Z**, yaw = 0 faces −Z.
//   • `spawnAt(type, dx, dz)` offsets are in WORLD axes, not camera-relative, so
//     "in front of a yaw = π player" means **positive dz**.
// Fixed world anchors: Pack-a-Punch (0, 22), mystery box (10, 140), perk statue (0, 175).
const { test } = require("@playwright/test");
const path = require("path");

const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";
const OUT = path.join(__dirname, "..", "docs", "screenshots");
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

// The scene keeps animating (walk cycles, ring pulses, particle drain), so a
// real-time settle beats any single-frame wait.
const settle = (page, ms = 2200) => page.waitForTimeout(ms);

// Enemies persist and swarm the camera between stages — wipe the field first.
async function clearField(page) {
  await page.evaluate(() => window.__rbTest.completeWave());
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 60000 });
  await settle(page, 1200);
}

// `SHOTS=hero_combat,zombies npx playwright test …` re-takes just those, so one
// bad frame doesn't cost you the frames that already came out well.
const ONLY = (process.env.SHOTS || "").split(",").map(s => s.trim()).filter(Boolean);

async function stage(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

test.use({ channel: "chrome", viewport: { width: 1600, height: 900 } });

test("regenerate README screenshots", async ({ page }) => {
  test.setTimeout(1200000);
  page.on("pageerror", e => console.log("PAGEERROR:", e.message));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 240000 });
  await settle(page, 3000);

  // ── Menu shell (live 3D backdrop orbiting the plaza statue) ────────────────
  await stage("menu", async () => {
    await page.waitForFunction(() => document.getElementById("overlay")?.dataset.panel === "root", { timeout: 10000 });
    await settle(page, 2500);
    await shot(page, "menu");
  });

  await stage("intel_records", async () => {
    await page.locator("#intelBtn").click();
    await settle(page, 1600);
    await shot(page, "intel_records");
    await page.keyboard.press("Escape");
    await settle(page, 900);
  });

  // ── Into the mission ───────────────────────────────────────────────────────
  await page.locator("#startBtn").click();
  await page.waitForFunction(() => window.__rbTest.getState() === "playing", { timeout: 30000 });
  await page.evaluate(() => {
    window.__rbTest.setUnlimitedHealth(true);
    window.__rbTest.giveXp(90000);
  });
  await settle(page, 3500);

  // ── Interactables: stand south of each and look north (+Z) ─────────────────
  await stage("pack_a_punch", async () => {
    await clearField(page);
    await page.evaluate(() => window.__rbTest.tpTo(0.6, 16, Math.PI, -0.02));
    await settle(page, 2600);
    await shot(page, "pack_a_punch");
  });

  await stage("mystery_box", async () => {
    await page.evaluate(() => window.__rbTest.tpTo(10, 137.2, Math.PI, -0.06));
    await settle(page, 2600);
    await shot(page, "mystery_box");
  });

  await stage("perk_machine", async () => {
    await page.evaluate(() => window.__rbTest.tpTo(0, 167, Math.PI, 0.03));
    await settle(page, 2600);
    await shot(page, "perk_machine");
  });

  // ── City vista (Phase 4 procedural district) ───────────────────────────────
  await stage("city_district", async () => {
    await page.evaluate(() => window.__rbTest.freeCam(-40, 46, 120, 10, 4, 210, 62));
    await settle(page, 2600);
    await shot(page, "city_district");
    await page.evaluate(() => window.__rbTest.freeCamOff());
    await settle(page, 900);
  });

  // ── Combat ─────────────────────────────────────────────────────────────────
  // Staged INSIDE the arena: `spawnAt` resolves through `isOpenCell`, which only
  // covers the MAP grid (z ≈ −40 … 120), so an exterior spawn silently relocates
  // the enemy to the nearest interior cell — off camera. The open southern band
  // (z ≈ 96–114, all cells open) is the room to fight in; look north (yaw = 0).
  // `aimAtNearest` after spawning guarantees the enemies are actually in frame.
  const ARENA = { x: 0, z: 112 };

  await stage("hero_combat", async () => {
    await clearField(page);
    await page.evaluate(a => {
      window.__rbTest.tpTo(a.x, a.z, 0, 0);
      window.__rbTest.grantGun("rifle");
      window.__rbTest.spawnAt("Siege Drone", -8, -24);
      window.__rbTest.spawnAt("Siege Drone", 9, -27);
      window.__rbTest.spawnAt("Zombie", -4, -17);
      window.__rbTest.spawnAt("Zombie", 6, -19);
      window.__rbTest.spawnAt("Zombie", 0, -21);
    }, ARENA);
    await settle(page, 1600);
    await page.evaluate(() => window.__rbTest.aimAtNearest());
    await settle(page, 300);
    // A short tap only: a held burst at this wave scale kills the whole group
    // before the shutter, and an empty plaza is not the shot.
    await page.mouse.down();
    await settle(page, 120);
    await shot(page, "hero_combat");
    await page.mouse.up();
  });

  await stage("warden_ability", async () => {
    await clearField(page);
    await page.evaluate(a => {
      window.__rbTest.tpTo(a.x, a.z, 0, 0);
      window.__rbTest.spawnAt("Siege Drone", -8, -30);
      window.__rbTest.spawnAt("Siege Drone", 9, -33);
      window.__rbTest.spawnAt("Siege Drone", 0, -36);
    }, ARENA);
    await settle(page, 1500);
    await page.evaluate(() => window.__rbTest.aimAtNearest());
    // Enough aggro for the rod fans to flare, short enough that the pack has not
    // closed to melee (contact triggers the red damage vignette over everything).
    await settle(page, 2200);
    await shot(page, "warden_ability");
  });

  await stage("cherub_sanctuary", async () => {
    await clearField(page);
    await page.evaluate(a => {
      window.__rbTest.tpTo(a.x, a.z, 0, 0);
      window.__rbTest.spawnAt("Null Cherub", 0, -21);
    }, ARENA);
    await settle(page, 1400);
    await page.evaluate(() => {
      window.__rbTest.aimAtNearest();
      window.__rbTest.forceMegaBlast();
    });
    await settle(page, 900);
    await shot(page, "cherub_sanctuary");
  });

  await stage("zombies", async () => {
    await clearField(page);
    await page.evaluate(a => {
      window.__rbTest.tpTo(a.x, a.z, 0, 0);
      window.__rbTest.grantGun("shotgun");
      for (let i = 0; i < 8; i++) {
        window.__rbTest.spawnAt("Zombie", -9 + i * 2.6, -11 - (i % 3) * 3.5);
      }
    }, ARENA);
    await settle(page, 2800);
    await page.evaluate(() => window.__rbTest.aimAtNearest());
    await settle(page, 900);
    await shot(page, "zombies");
  });

  // ── Blackout wave (every 10th: power dies, the sky burns) ──────────────────
  await stage("blackout_firesky", async () => {
    await clearField(page);
    await page.evaluate(a => {
      window.__rbTest.setWave(10);
      window.__rbTest.setWaveLighting(10);
      window.__rbTest.tpTo(a.x, a.z, 0, 0);
      window.__rbTest.grantGun("rifle");
      window.__rbTest.spawnAt("Zombie", -5, -17);
      window.__rbTest.spawnAt("Zombie", 4, -15);
      window.__rbTest.spawnAt("Siege Drone", 7, -22);
      window.__rbTest.spawnAt("Siege Drone", -8, -25);
    }, ARENA);
    await settle(page, 1500);
    // Enemies were spawned due north, so hold yaw = 0 and tilt up — the burning
    // dome, not the silhouettes, is what this shot is about.
    await page.evaluate(a => window.__rbTest.tpTo(a.x, a.z, 0, -0.13), ARENA);
    await settle(page, 1400);
    await shot(page, "blackout_firesky");
  });

  // ── Cinematic intro ────────────────────────────────────────────────────────
  // Beat A owns the black-cover fade, so the clock has to be walked through the
  // beats — jumping straight to a later one leaves the cover fully opaque.
  await stage("intro_cutscene", async () => {
    await page.evaluate(() => {
      window.__rbTest.setWave(1);
      window.__rbTest.setWaveLighting(1);
      window.__rbTest.startIntroCutscene();
    });
    await page.evaluate(() => window.__rbTest.introJump(1.6)); // TRON grid draw-in
    await settle(page, 2400);
    await shot(page, "intro_cutscene");
    // Two more beats as alternates — pick the best one, delete the rest.
    for (const [t, name] of [[2.75, "render"], [4.5, "choir"], [6.9, "teleport"], [11.1, "grab"]]) {
      await page.evaluate(tt => window.__rbTest.introJump(tt), t);
      await settle(page, 1800);
      await shot(page, `_alt_intro_${name}`);
    }
    await page.evaluate(() => window.__rbTest.skipCutscene());
  });
});

test("dev console screenshot", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("http://127.0.0.1:8000/dev.html", { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await shot(page, "dev_console");
});
