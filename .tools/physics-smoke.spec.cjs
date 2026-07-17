const { test, expect } = require("@playwright/test");
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1";

test("Rapier WASM loads on the importmap path and gravity works", async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // If Rapier's WASM failed to load via the esm.sh importmap, initPhysics() throws
  // during bootGame and rbReady never gets set — so reaching ready proves the load.
  await page.waitForFunction(() => document.body.dataset.rbReady === "1", { timeout: 180000 });
  expect(await page.evaluate(() => !!window.__physics && window.__physics.ready())).toBe(true);
  // Prove the WASM runtime is actually live: a dynamic body must fall under gravity.
  const st = await page.evaluate(() => window.__physics.selfTest());
  console.log("PHYSICS SELFTEST", JSON.stringify(st));
  expect(st.fell).toBe(true);
  expect(st.y1).toBeLessThan(st.y0);
  expect(errors.join("\n")).not.toMatch(/rapier|wasm/i);
});
