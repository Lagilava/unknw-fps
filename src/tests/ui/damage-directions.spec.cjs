const {test,expect}=require('@playwright/test');
test('damage bearings track turns, overlap, fade, and reset',async({page})=>{
 await page.goto('http://127.0.0.1:8000/');
 const report=await page.evaluate(async()=>{
  const {damageBearing,createDamageIndicators}=await import('/src/modules/damage_indicators');
  const directions=[[0,-10],[10,0],[0,10],[-10,0]].map(([x,z])=>damageBearing(x,z,0,0,0));
  const hud=createDamageIndicators(document);hud.hit(0,-10,20);hud.hit(10,0,20);hud.update(.1,0,0,0);
  const active=()=>[...document.querySelector('#damage-directions').children].filter(e=>Number(e.style.opacity)>0);
  const overlap=active().length;hud.update(0,0,0,Math.PI/2);const rotations=active().map(e=>e.style.transform);
  hud.update(2,0,0,0);const expired=active().length;
  for(let i=0;i<30;i++)hud.hit(i*2,10,20);hud.update(0,0,0,0);const bounded=active().length;
  hud.clear();const cleared=active().length;hud.hit(NaN,0,20);hud.update(0,0,0,0);const invalid=active().length;
  hud.hit(0,0,20);hud.update(0,0,0,0);const centered=active().length;hud.dispose();
  return {directions,overlap,rotations,expired,bounded,cleared,invalid,centered};
 });
 expect(report.directions[0]).toBeCloseTo(0);expect(report.directions[1]).toBeCloseTo(Math.PI/2);
 expect(Math.abs(report.directions[2])).toBeCloseTo(Math.PI);expect(report.directions[3]).toBeCloseTo(-Math.PI/2);
 expect(report.overlap).toBe(2);expect(report.rotations.some(r=>Math.abs(parseFloat(r.split('rotate(')[1])-Math.PI/2)<.001)).toBe(true);
 expect(report.expired).toBe(0);expect(report.bounded).toBe(8);expect(report.cleared).toBe(0);expect(report.invalid).toBe(0);expect(report.centered).toBe(0);
});

test('accepted damage shows a source indicator in game; god mode suppresses it',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8000/src/first_person_shooter_room_game%20(1).html?test=1');
 await page.waitForFunction(()=>document.body.dataset.rbReady==='1',null,{timeout:180000});
 await page.locator('#startBtn').click();
 await page.waitForFunction(()=>window.__rbTest?.getState()==='playing');
 await page.evaluate(()=>{const t=window.__rbTest,p=t.getPlayerPosition();t.forceDamage(10,{sx:p.x+10,sz:p.z});});
 await page.waitForFunction(()=>[...document.querySelector('#damage-directions').children].some(e=>Number(e.style.opacity)>0));
 await page.screenshot({path:'test-artifacts/damage-direction-game.png'});
 const immune=await page.evaluate(()=>{const t=window.__rbTest,p=t.getPlayerPosition();t.setUnlimitedHealth(true);t.forceDamage(10,{sx:p.x+10,sz:p.z});return [...document.querySelector('#damage-directions').children].every(e=>Number(e.style.opacity)===0);});
 expect(immune).toBe(true);expect(errors).toEqual([]);
});
