import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message.slice(0,80)));
await p.goto("http://127.0.0.1:8000/boot3.html",{waitUntil:"load"});
await p.waitForTimeout(8000);
const r = await p.evaluate(()=>({maps:document.querySelectorAll('script[type=importmap]').length, onclick: typeof (document.getElementById('intelBtn')||{}).onclick}));
console.log("boot3:", JSON.stringify(r), "errs:", errs.slice(0,3));
await b.close();
