import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const msgs = [];
page.on("console", (m) => msgs.push(m.type()+": "+m.text()));
page.on("pageerror", (e) => msgs.push("PAGEERR: " + (e.stack||e.message)));
page.on("requestfailed", (r) => msgs.push("REQFAIL: " + r.url() + " " + (r.failure()?.errorText||"")));
await page.goto("http://127.0.0.1:8000/", { waitUntil: "load" });
await page.waitForTimeout(12000);
const info = await page.evaluate(() => ({
  onclick: typeof document.getElementById("intelBtn").onclick,
  importmaps: document.querySelectorAll('script[type="importmap"]').length,
  moduleScripts: Array.from(document.querySelectorAll('script[type="module"]')).map(s=>s.src),
}));
console.log("INFO:", JSON.stringify(info));
console.log("MSGS:\n" + msgs.slice(0,25).join("\n"));
await browser.close();
