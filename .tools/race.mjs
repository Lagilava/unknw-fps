import { chromium } from "playwright-core";
for (let i=0;i<3;i++){
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:8000/",{waitUntil:"domcontentloaded"});
  const maps = await p.evaluate(()=>document.querySelectorAll('script[type=importmap]').length);
  console.log("run",i,"maps:",maps);
  await b.close();
}
