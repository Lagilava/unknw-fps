const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3000/?test=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.body.dataset.rbReady==='1',null,{timeout:180000});
  await page.locator('#startBtn').click();
  await page.waitForFunction(()=>window.__rbTest?.getState()==='playing',null,{timeout:60000});
  await page.evaluate(()=>{window.__rbTest.setUnlimitedHealth(true);window.__rbTest.tpTo(0,42);});
  await page.waitForTimeout(1000);
  const result=await page.evaluate(async()=>{
   const before=window.__rbCountLights();
   window.__rbFx('enemyDeathMetal',4);
   await new Promise(resolve=>setTimeout(resolve,100));
   return {before,after:window.__rbCountLights(),particles:window.__rbParticles()};
  });
  await page.screenshot({path:'.tools/particle-fx-game.png'});
  console.log(JSON.stringify({result,errors}));
  if(errors.length || JSON.stringify(result.before)!==JSON.stringify(result.after)) process.exitCode=1;
 } finally {await browser.close();}
})();
