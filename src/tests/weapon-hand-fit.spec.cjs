const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
test('weapons keep their grip and human proportions in idle and fire',async({page})=>{
  test.setTimeout(600000);
  await page.goto('http://127.0.0.1:8000/?test=1');
  await page.waitForFunction(()=>document.body.dataset.rbReady==='1',null,{timeout:180000});
  await page.locator('#startBtn').click();
  await page.waitForFunction(()=>window.__rbTest.getState()==='playing'&&window.__rbReload()?.rightHand,null,{timeout:60000});
  await page.evaluate(()=>{window.__rbTest.pauseForAnimationReview(true);window.__rbTest.tpTo(0,42);window.__rbTest.setUnlimitedHealth(true);});
  fs.mkdirSync('test-artifacts/weapon-fit',{recursive:true});const results=[];
  for(const gun of ['rifle','pistol','shotgun','sniper','smg','lmg','dmr','akimbo','flak']) {
    await page.evaluate(g=>window.__rbTest.grantGun(g),gun);
    for(const state of ['idle','fire','aim-up','aim-down','reload-strafe']) {
      const data=await page.evaluate(state=>window.__rbTest.reviewAnimation('player',state),state);
      const fit=await page.evaluate(()=>window.__rbTest.getWeaponHandFit());
      console.log(gun,state,JSON.stringify(fit));
      fs.writeFileSync(`test-artifacts/weapon-fit/${gun}-${state}.png`,Buffer.from(data.png.split(',')[1],'base64'));
      results.push({gun,state,...fit});
      expect(fit.valid).toBe(true);
      expect(fit.length).toBeLessThanOrEqual(1.11);
      if(state!=='reload-strafe')expect(fit.rightError).toBeLessThan(.005);
      expect(fit.leftError).toBeLessThan(.04);
    }
  }
  fs.writeFileSync('test-artifacts/weapon-fit/measurements.json',JSON.stringify(results,null,2));
  await page.evaluate(async()=>{
    const t=window.__rbTest;t.grantGun('rifle');await t.reviewAnimation('player','idle');t.pauseForAnimationReview(false);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({path:'test-artifacts/weapon-fit/gameplay.png'});
});
