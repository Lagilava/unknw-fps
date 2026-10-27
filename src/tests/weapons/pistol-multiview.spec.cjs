const {test,expect}=require('@playwright/test');

test('four views share one pistol simulation and a steady carry through directional runs',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3000/?animationLab=1');
 await page.waitForFunction(()=>window.__animationLab,null,{timeout:180000});
 const report=await page.evaluate(()=>{
  const lab=window.__animationLab;lab.setPlaying(false);
  const rows=[];
  for(const motion of ['jog','sprint','left','right','diagonal','back'])for(const yaw of [0,Math.PI/2]){
   lab.set({weapon:'pistol',motion,yaw,pitch:0,clip:''},false);lab.step(90,false);
   const heights=[];let error=0;
   for(let i=0;i<240;i++){
    const d=lab.step(1,false);heights.push(d.handCenter[1]);
    error=Math.max(error,d.fit.rightError,d.fit.leftError);
   }
   rows.push({motion,yaw,bounce:Math.max(...heights)-Math.min(...heights),error});
  }
  return {rows,views:lab.getViews(),layout:lab.getLayout()};
 });
 expect(report.layout).toBe('quad');
 expect(report.views.map(v=>v.name)).toEqual(['orbit','front','side','rear']);
 for(const row of report.rows){expect(row.bounce,`${row.motion} carry bounce`).toBeLessThan(.025);expect(row.error).toBeLessThan(.02);}
 await page.evaluate(()=>{const l=window.__animationLab;l.set({motion:'left',yaw:0});l.step(60);});
 await page.screenshot({path:'test-artifacts/pistol-multiview.png'});
 const poseBefore=await page.evaluate(()=>window.__animationLab.getDiagnostics().quaternions);
 await page.selectOption('#lab-layout','single');
 expect(await page.evaluate(()=>window.__animationLab.getViews().length)).toBe(1);
 await page.click('[data-view="handsSide"]');
 await page.selectOption('#lab-layout','quad');
 expect(await page.evaluate(()=>window.__animationLab.getDiagnostics().quaternions)).toEqual(poseBefore);
 await page.setViewportSize({width:390,height:844});
 const layout=await page.evaluate(()=>({views:window.__animationLab.getViews(),panel:document.querySelector('#animation-lab-panel').getBoundingClientRect().toJSON()}));
 for(const v of layout.views){expect(v.width).toBeGreaterThan(150);expect(844-v.y).toBeLessThanOrEqual(layout.panel.top+1);}
 expect(errors).toEqual([]);
 console.log('PISTOL CARRY '+JSON.stringify(report.rows));
});
