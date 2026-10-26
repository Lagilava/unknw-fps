const { test,expect }=require('@playwright/test');
// A planted foot must stay put on the ground. In the lab the operator moves at the
// real game speeds, so the horizontal speed of a stance foot (lowest ankle heights
// of the cycle) along the travel direction is the skate. The old calibration played
// 2 m/s jog / strafe / backpedal loops for a 5.8 m/s mover (about 4 m/s of skate).
test('planted feet do not skate in any armed movement direction',async({page})=>{
  test.setTimeout(600000);
  await page.goto('http://127.0.0.1:3000/?animationLab=1');
  await page.waitForFunction(()=>document.body.dataset.animationLabReady==='1',null,{timeout:180000});
  const rows=await page.evaluate(()=>{
    const lab=window.__animationLab,out=[],dt=1/60;
    lab.setPlaying(false);
    for(const weapon of ['pistol','rifle'])for(const motion of ['jog','sprint','left','right','back','diagonal']){
      lab.set({weapon,motion,pitch:0,yaw:0,clip:''},false);lab.step(60,false);
      const frames=[];for(let i=0;i<240;i++){lab.step(1,false);frames.push(lab.getDiagnostics().feet);}
      const tx=frames[239].left[0]-frames[0].left[0],tz=frames[239].left[2]-frames[0].left[2];
      const travel=Math.hypot(tx,tz)/(239*dt),skate={};
      for(const side of ['left','right']){
        const ys=frames.map(f=>f[side][1]),low=Math.min(...ys)+.05,speeds=[];
        for(let i=1;i<frames.length;i++)if(ys[i]<low&&ys[i-1]<low)
          speeds.push(((frames[i][side][0]-frames[i-1][side][0])*tx+(frames[i][side][2]-frames[i-1][side][2])*tz)/Math.hypot(tx,tz)/dt);
        speeds.sort((a,b)=>a-b);skate[side]=speeds.length?speeds[speeds.length>>1]:0;
      }
      out.push({weapon,motion,action:lab.getDiagnostics().action,travel,...skate});
    }
    return out;
  });
  console.log('FOOT SKATE '+JSON.stringify(rows));
  for(const r of rows)for(const side of ['left','right'])
    expect(Math.abs(r[side]),`${r.weapon} ${r.motion} ${side} stance foot vs ${r.travel.toFixed(1)} m/s travel`).toBeLessThan(r.travel*.2);
});
