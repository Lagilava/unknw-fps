import { chromium } from "playwright-core";
import fs from "fs";

const OUT = "test-artifacts";
fs.mkdirSync(OUT, { recursive: true });
const URL = "http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE ERR:", m.text()); });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0, 120)));

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot:", name);
}
const activePanel = () => page.evaluate(() =>
  document.querySelector("[data-menu-panel].active")?.dataset.menuPanel || "none");

// 1) LOADING — catch early
await page.goto(URL, { waitUntil: "commit" });
await page.waitForTimeout(650);
await shot("01-loading");

// Wait until the game module has wired the menu (intelBtn.onclick becomes a fn)
await page.waitForFunction(() => {
  const b = document.getElementById("intelBtn");
  const l = document.getElementById("loading-screen");
  return b && typeof b.onclick === "function" && l && l.classList.contains("hidden");
}, { timeout: 40000 }).catch(() => console.log("WARN: menu-ready wait timed out"));
await page.waitForTimeout(900);
await shot("02-menu");

// 3) LOADOUT
await page.click("#loadoutBtn");
await page.waitForFunction(() => document.querySelector("[data-menu-panel].active")?.dataset.menuPanel === "loadout", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1000);
console.log("loadout panel:", await activePanel());
await shot("03-loadout");

// 4) INTEL
await page.click("#intelBtn");
await page.waitForFunction(() => document.querySelector("[data-menu-panel].active")?.dataset.menuPanel === "intel", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1800);
console.log("intel panel:", await activePanel());
await shot("04-intel");

// 5) MODEL PREVIEW
await page.click("#modelEditorBtn");
await page.waitForTimeout(1800);
console.log("model panel:", await activePanel());
await shot("05-model");

// back to briefing, then start -> HUD
await page.click("#startBtn");
await page.waitForTimeout(3000);
await page.mouse.click(720, 405).catch(() => {});
await page.waitForTimeout(1500);
await shot("06-hud");

await browser.close();
console.log("done");
