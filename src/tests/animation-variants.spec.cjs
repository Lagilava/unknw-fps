const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const sharp=require('sharp');

test('weapon mechanisms and enemy field portraits use live models',async({page})=>{
  test.setTimeout(600000);
  await page.goto('http://127.0.0.1:8000/?test=1');
  await page.waitForFunction(()=>document.body.dataset.rbReady==='1',null,{timeout:180000});
  await page.locator('#startBtn').click();
  await page.waitForFunction(()=>window.__rbTest.getState()==='playing'&&window.__rbReload()?.rightHand,null,{timeout:60000});
  await page.evaluate(()=>{window.__rbTest.pauseForAnimationReview(true);window.__rbTest.setUnlimitedHealth(true);});
  const report=[]; fs.mkdirSync('test-artifacts/animation-review',{recursive:true});
  for(const gun of ['shotgun','sniper','lmg','flak','smg','dmr','akimbo']) {
    const selected=await page.evaluate(g=>window.__rbTest.grantGun(g),gun);
    expect(selected).toBe(gun);
    for(const state of ['idle','reload','reload-strafe']) {
      console.log(`Review ${gun}/${state}`);
      const data=await page.evaluate(state=>window.__rbTest.reviewAnimation('player',state),state);
      expect(data.finite).toBe(true);
      const file=`${gun}-${state}.png`;
      fs.writeFileSync(`test-artifacts/animation-review/${file}`,Buffer.from(data.png.split(',')[1],'base64'));
      report.push({subject:gun,state,file,views:data.views,frames:data.frames,finite:data.finite});
    }
  }
  fs.writeFileSync('test-artifacts/animation-review/variants.json',JSON.stringify(report,null,2));
  await page.evaluate(()=>window.__rbTest.reviewAnimation('player','idle'));
  for(const [subject,file] of [['Siege Drone','drone'],['Cloned Ghost','ghost'],['Zombie','returned'],['Null Cherub','choir']]) {
    await page.evaluate(subject=>window.__rbTest.spawnAt(subject,0,-8),subject);
    const data=await page.evaluate(subject=>window.__rbTest.reviewAnimation(subject,'idle'),subject);
    expect(data.finite).toBe(true);
    await sharp(Buffer.from(data.portrait.split(',')[1],'base64')).webp({quality:86}).toFile(`assets/intel/${file}.webp`);
  }
});
