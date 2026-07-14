import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage();
await p.goto("http://127.0.0.1:8000/", { waitUntil: "domcontentloaded" });
const head = await p.evaluate(() => {
  const im = document.querySelector('script[type="importmap"]');
  return {
    firstHeadChild: document.head.firstElementChild?.outerHTML?.slice(0,80),
    importmapPresent: !!im,
    importmapParent: im ? im.parentElement.tagName : "none",
    scriptsInHead: document.head.querySelectorAll("script").length,
    bodyImportmaps: document.body ? document.body.querySelectorAll('script[type="importmap"]').length : -1,
    headChildTags: Array.from(document.head.children).slice(0,6).map(c=>c.tagName+(c.type?("/"+c.type):"")),
  };
});
console.log(JSON.stringify(head, null, 2));
await b.close();
