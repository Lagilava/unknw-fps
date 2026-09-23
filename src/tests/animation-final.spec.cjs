const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const sharp=require('sharp');
test('death rewards are immediate and final grounding corrections render from all views',async({page})=>{
  test.setTimeout(300000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8000/?test=1');
  await page.waitForFunction(()=>document.body.dataset.rbReady==='1',null,{timeout:180000});
  await page.locator('#startBtn').click();
  await page.waitForFunction(()=>window.__rbTest.getState()==='playing',null,{timeout:60000});
  await page.evaluate(()=>{const t=window.__rbTest;t.pauseForAnimationReview(true);t.setUnlimitedHealth(true);t.tpTo(0,42);t.completeWave();t.spawnAt('Zombie',0,-1);});
  const killed=await page.evaluate(()=>{
    const t=window.__rbTest,before=t.getScore();t.killNearest();
    return {before,after:t.getScore(),dead:t.getDeathVisuals()};
  });
  expect(killed.after).toBeGreaterThan(killed.before);
  expect(killed.dead.some(e=>e.type==='Zombie'&&!e.alive&&e.visible&&e.remaining>0)).toBe(true);
  await page.evaluate(()=>{for(let i=0;i<90;i++)window.__rbTest.tickDeathVisualsForTest(1/60);});
  expect(await page.evaluate(()=>window.__rbTest.getDeathVisuals())).toEqual([]);
  expect(await page.evaluate(()=>window.__rbTest.getScore())).toBe(killed.after);
  const report=[];
  for(const gun of ['pistol','rifle']) {
    await page.evaluate(g=>window.__rbTest.grantGun(g),gun);
    const data=await page.evaluate(()=>window.__rbTest.reviewAnimation('player','melee'));
    const file=`${gun}-melee.png`;
    fs.writeFileSync(`test-artifacts/animation-review/${file}`,Buffer.from(data.png.split(',')[1],'base64'));
    report.push({subject:gun,state:'melee',file,views:data.views,frames:data.frames,finite:data.finite});
    await page.evaluate(()=>window.__rbTest.reviewAnimation('player','idle'));
  }
  for(const [subject,states] of [['Zombie',['crawl','runCrawl','death']],['Cloned Ghost',['death','idle','walk','run','strafe','retreat','turn','attack','hit']],['Siege Drone',['idle','walk','turn','attack','hit','barrage','death']],['Blink Seraph',['idle','walk','turn','attack','hit','blink','death']],['Null Cherub',['idle','walk','turn','attack','hit','emp','channel','death']]]) {
    await page.evaluate(subject=>window.__rbTest.spawnAt(subject,0,-8),subject);
    for(const state of states) {
      const data=await page.evaluate(({subject,state})=>window.__rbTest.reviewAnimation(subject,state),{subject,state});
      expect(data.finite).toBe(true);
      const file=`${subject}-${state}.png`.replaceAll(' ','_');
      fs.writeFileSync(`test-artifacts/animation-review/${file}`,Buffer.from(data.png.split(',')[1],'base64'));
      if(subject==='Cloned Ghost'&&state==='idle') await sharp(Buffer.from(data.portrait.split(',')[1],'base64')).webp({quality:86}).toFile('assets/intel/ghost.webp');
      report.push({subject,state,file,views:data.views,frames:data.frames,finite:data.finite});
    }
  }
  fs.writeFileSync('test-artifacts/animation-review/corrections.json',JSON.stringify(report,null,2));
  expect(errors).toEqual([]);
});
