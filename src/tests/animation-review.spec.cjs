const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('capture live animation states from ten views at three phases', async ({ page }) => {
  test.setTimeout(900000);
  page.setDefaultTimeout(30000);
  const out = path.resolve('test-artifacts/animation-review'); fs.mkdirSync(out, { recursive: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8000/?test=1');
  console.log('Waiting for boot');
  await page.waitForFunction(() => document.body.dataset.rbReady === '1', null, { timeout: 180000 });
  await page.evaluate(() => window.__rbTest.pauseForAnimationReview(true));
  await page.locator('#intelBtn').click();
  console.log('Intel open');
  await expect(page.locator('.intel-evidence')).toHaveCount(8);
  for (const record of ['minutes','room','city','echo','drones','ghosts','returned','choir']) {
    console.log(`Intel ${record}`);
    await page.locator(`.intel-entry[data-record="${record}"]`).click();
    const img = page.locator(`.intel-record[data-record="${record}"] img`);
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth > 0), {timeout:30000}).toBe(true);
  }
  await page.screenshot({path: path.join(out,'intel.png')});
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__rbTest.pauseForAnimationReview(false));
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__rbTest?.getState() === 'playing', null, { timeout: 60000 });
  await page.evaluate(() => { const t=window.__rbTest; t.setUnlimitedHealth(true); t.freeCamOff(); t.tpTo(0,42); });
  await page.waitForFunction(() => window.__rbReload()?.rightHand, null, { timeout: 60000 });
  await page.evaluate(() => window.__rbTest.pauseForAnimationReview(true));
  const report=[];
  const capture=async(subject,state,prefix=subject)=>{
    console.log(`Review ${prefix} / ${state}`);
    const data=await page.evaluate(({subject,state})=>window.__rbTest.reviewAnimation(subject,state),{subject,state});
    const file=`${prefix}-${state}.png`.replaceAll(' ','_');
    fs.writeFileSync(path.join(out,file),Buffer.from(data.png.split(',')[1],'base64'));
    expect(data.finite).toBe(true);
    expect(data.views).toHaveLength(10);
    report.push({subject:prefix,state,file,views:data.views,frames:data.frames,finite:data.finite});
    fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(report,null,2));
  };
  for(const gun of ['pistol','rifle']) {
    await page.evaluate(g=>window.__rbTest.grantGun(g),gun);
    for(const state of ['idle','turn','walk','strafe','sprint','jump','land','hit','aim','aim-turn','aim-strafe','reload','reload-strafe','melee','fire','death'])
      await capture('player',state,gun);
    await page.evaluate(()=>window.__rbTest.reviewAnimation('player','idle'));
  }
  for(const [subject,states] of [
    ['Zombie',['idle','walk','run','turn','alert','attack','attackBite','attackLunge','attackNeck','crawl','runCrawl','hit','death']],
    ['Siege Drone',['idle','walk','turn','attack','hit','barrage','death']],
    ['Blink Seraph',['idle','walk','turn','attack','hit','blink','death']],
    ['Null Cherub',['idle','walk','turn','attack','hit','emp','channel','death']],
    ['Cloned Ghost',['idle','walk','run','strafe','retreat','turn','attack','hit','death']],
  ]) {
    await page.evaluate(subject=>window.__rbTest.spawnAt(subject,0,-8),subject);
    for(const state of states) await capture(subject,state);
  }
  expect(errors).toEqual([]);
});
