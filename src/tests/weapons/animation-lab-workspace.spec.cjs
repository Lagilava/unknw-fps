const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const base='http://127.0.0.1:3000/';

test('lab workspace shares its setup, supports keyboard inspection, and exports all camera angles',async({page,context})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
 await page.goto(base+'?animationLab=1');
 await page.waitForFunction(()=>window.__animationLab,null,{timeout:180000});
 await page.selectOption('#lab-weapon','sniper');await page.selectOption('#lab-motion','right');
 await page.check('#lab-ads');await page.selectOption('#lab-layout','player');
 await page.evaluate(()=>{
  for(const [id,value] of [['lab-speed','.5'],['lab-yaw','90'],['lab-pitch','3']]){
   const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  window.__animationLab.setPlaying(false);
 });
 await page.click('#lab-share');
 await expect(page.locator('#lab-toast')).toContainText('Lab link copied');
 const url=await page.evaluate(()=>navigator.clipboard.readText());
 expect(url).toContain('motion=right');expect(url).toContain('rate=0.5');
 await page.goto(url);await page.waitForFunction(()=>window.__animationLab,null,{timeout:180000});
 const restored=await page.evaluate(()=>({state:window.__animationLab.getState(),layout:window.__animationLab.getLayout()}));
 expect(restored.state).toMatchObject({weapon:'sniper',motion:'right',ads:true,playing:false});
 expect(restored.state.yaw).toBeCloseTo(Math.PI/2);expect(restored.layout).toBe('player');
 await expect(page.locator('#lab-speed')).toHaveValue('0.5');
 await page.locator('#lab-header h1').click();
 await page.keyboard.press('Space');expect(await page.evaluate(()=>window.__animationLab.getState().playing)).toBe(true);
 await page.keyboard.press('Space');expect(await page.evaluate(()=>window.__animationLab.getState().playing)).toBe(false);
 const frame=async()=>Number((await page.locator('#lab-clock').textContent()).match(/f(\d+)/)[1]);
 const before=await frame();await page.keyboard.press('ArrowRight');expect(await frame()).toBe(before+1);
 await page.selectOption('#lab-layout','quad');
 const downloadPromise=page.waitForEvent('download');await page.click('#lab-save-frame');const download=await downloadPromise;
 expect(download.suggestedFilename()).toMatch(/^unknw-sniper-right-frame-\d+\.png$/);
 const png=fs.readFileSync(await download.path());expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
 expect(png.length).toBeGreaterThan(10000);expect(png.readUInt32BE(16)).toBeGreaterThan(900);
 await page.screenshot({path:'test-artifacts/polished-animation-lab-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#lab-play')).toBeVisible();await expect(page.locator('#lab-share')).toBeVisible();
 const mobile=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
  views:window.__animationLab.getViews(),bar:document.getElementById('lab-transport').getBoundingClientRect().toJSON()}));
 expect(mobile.scroll).toBeLessThanOrEqual(mobile.width);expect(mobile.bar.left).toBeGreaterThanOrEqual(0);
 expect(mobile.bar.right).toBeLessThanOrEqual(390);expect(mobile.views.every(v=>v.width>150&&v.height>0)).toBe(true);
 await page.screenshot({path:'test-artifacts/polished-animation-lab-mobile.png'});
 expect(errors).toEqual([]);
});

test('shared links validate unknown selections and out-of-range values',async({page})=>{
 await page.goto(base+'?animationLab=1&weapon=unknown&motion=unknown&pitch=999&yaw=-999&rate=100&layout=unknown&paused=1');
 await page.waitForFunction(()=>window.__animationLab,null,{timeout:180000});
 const d=await page.evaluate(()=>({state:window.__animationLab.getState(),diag:window.__animationLab.getDiagnostics(),views:window.__animationLab.getViews()}));
 expect(d.state).toMatchObject({weapon:'pistol',motion:'jog',playing:false});expect(d.diag.finite).toBe(true);
 expect(d.state.pitch).toBeCloseTo(7*Math.PI/180);expect(d.state.yaw).toBeCloseTo(-Math.PI);
 await expect(page.locator('#lab-speed')).toHaveValue('1.5');expect(d.views).toHaveLength(4);
});
