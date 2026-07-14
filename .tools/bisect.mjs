import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://127.0.0.1:8000/.tools/bisect.html",{waitUntil:"load"});
await p.waitForTimeout(5000);
console.log("ok:", await p.evaluate(()=>window.__ok), "maps:", await p.evaluate(()=>document.querySelectorAll('script[type=importmap]').length));
console.log("errs:", errs.slice(0,3));
await b.close();
