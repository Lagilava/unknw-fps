import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://127.0.0.1:8000/imtest.html",{waitUntil:"load"});
await p.waitForTimeout(6000);
console.log("ok:", await p.evaluate(()=>window.__ok), "maps:", await p.evaluate(()=>document.querySelectorAll('script[type=importmap]').length), "ver:", (await b.version?.())||"");
console.log("errs:", errs);
await b.close();
