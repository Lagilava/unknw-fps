import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto("http://localhost:3000/index.html?test=1", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.rbReady === "1", null, { timeout: 120000 });
await page.waitForTimeout(1000);
await page.getByText("NEW MISSION", { exact: false }).first().click({ timeout: 15000, force: true });
await page.waitForTimeout(3000);
await page.keyboard.press("Control+KeyH"); // invulnerable, applied early before drones can land a hit
await page.waitForTimeout(82000);
await page.screenshot({ path: "scripts/_grade_after.png" });
// Also grab the pause menu / bright UI area for a clean look at the grade on a lit scene.
await page.mouse.move(683, 384);
await page.waitForTimeout(500);
await page.screenshot({ path: "scripts/_grade_after2.png" });
await browser.close();
