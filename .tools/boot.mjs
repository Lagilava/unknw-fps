import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({viewport:{width:1440,height:810}});
const errs=[]; p.on("pageerror",e=>errs.push(e.message.slice(0,90)));
await p.goto("http://127.0.0.1:8000/.tools/boot.html",{waitUntil:"load"});
await p.waitForTimeout(9000);
const r = await p.evaluate(()=>({maps:document.querySelectorAll('script[type=importmap]').length, onclick: typeof document.getElementById('intelBtn').onclick, overlayHidden: document.getElementById('overlay').classList.contains('hidden')}));
console.log("result:", JSON.stringify(r), "errs:", errs.slice(0,4));
await b.close();
