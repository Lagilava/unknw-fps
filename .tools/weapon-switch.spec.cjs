const {test,expect}=require('@playwright/test');
test('wheel cycles owned guns once and holsters before swapping',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html?test=1');
 await page.waitForFunction(()=>document.body.dataset.rbReady==='1',null,{timeout:180000});
 await page.locator('#startBtn').click();
 await page.waitForFunction(()=>window.__rbTest?.getState()==='playing',null,{timeout:30000});
 await page.evaluate(()=>{const t=window.__rbTest;t.grantGun('rifle');t.grantGun('shotgun');t.grantGun('pistol');});
 await page.locator('#gameCanvas').click({position:{x:640,y:360},force:true});
 await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.waitForFunction(()=>window.__rbTest.getWeaponSwitch().draw===0);
 const before=await page.evaluate(()=>{
  window.dispatchEvent(new WheelEvent('wheel',{deltaY:1200,cancelable:true}));return window.__rbTest.getWeaponSwitch();
 });
 expect(before.gun).toBe('pistol');expect(before.pending).toBe('rifle');
 await page.waitForFunction(()=>window.__rbTest.getWeaponSwitch().gun==='rifle'&&window.__rbTest.getWeaponSwitch().draw===0);
 const reverse=await page.evaluate(()=>{
  window.dispatchEvent(new WheelEvent('wheel',{deltaY:-3,deltaMode:1,cancelable:true}));return window.__rbTest.getWeaponSwitch();
 });
 expect(reverse.pending).toBe('pistol');
 await page.waitForFunction(()=>window.__rbTest.getWeaponSwitch().gun==='pistol'&&window.__rbTest.getWeaponSwitch().draw===0);
 await page.evaluate(()=>document.exitPointerLock());
 await page.waitForFunction(()=>!document.pointerLockElement);
 await page.evaluate(()=>window.dispatchEvent(new WheelEvent('wheel',{deltaY:100,cancelable:true})));
 expect((await page.evaluate(()=>window.__rbTest.getWeaponSwitch())).pending).toBeNull();
 expect(errors).toEqual([]);
});
