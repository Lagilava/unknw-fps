const { test,expect }=require('@playwright/test');
test('isolated production animation lab: arm continuity, all weapons, real directional clips',async({page})=>{
  test.setTimeout(600000);
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>requests.push(r.url()));
  await page.addInitScript(()=>localStorage.setItem('rb_foot_ik','1'));
  await page.goto('http://127.0.0.1:3000/?animationLab=1');
  await page.waitForFunction(()=>document.body.dataset.animationLabReady==='1',null,{timeout:180000});
  await page.evaluate(()=>window.__animationLab.setPlaying(false));
  expect(await page.evaluate(()=>window.__rbTest.getEnemyCount())).toBe(0);
  expect(requests.filter(u=>/assets\/(drones|zombies)\/|\.hdr(?:\?|$)/.test(u))).toEqual([]);
  const clips=await page.evaluate(()=>window.__animationLab.getClips());
  for(const name of ['rifleRun','pistolRun','armedStrafeLeft','armedStrafeRight','armedBack','pistolBack'])expect(clips).toContain(name);
  const matrix=await page.evaluate(()=>{
    const lab=window.__animationLab,report=[];
    const set=v=>lab.set(v,false);
    const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.reduce((v,x,i)=>v+x*b[i],0))));
    for(const weapon of ['pistol','rifle','shotgun','sniper','smg','lmg','dmr','akimbo','flak']){
      set({weapon,pitch:0,yaw:0,motion:'idle',clip:''});lab.step(60,false);
      const row={weapon,right:0,left:0,jump:0,finite:true,actions:{},maxElevation:0,maxLegOverride:0,maxWrist:0};
      for(const motion of ['idle','jog','diagonal','left','right','back','sprint']){
        for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
          set({motion,yaw,pitch:-1.15});lab.step(60,false);
          let prev=null;
          for(let i=0;i<=48;i++){
            set({pitch:-1.15+i*2.3/48});
            const d=lab.step(1,false);
            row.right=Math.max(row.right,d.fit.rightError);row.left=Math.max(row.left,d.fit.leftError);
            row.finite &&= d.finite;
            row.maxElevation=Math.max(row.maxElevation,Math.abs(d.fit.elevation));
            row.maxWrist=Math.max(row.maxWrist,d.fit.leftWristDelta,d.fit.rightWristDelta);
            for(const name of Object.keys(d.legs)) for(let k=0;k<4;k++)
              row.maxLegOverride=Math.max(row.maxLegOverride,Math.abs(d.legs[name][k]-d.authoredLegQuats[name][k]));
            if(d.footLocks.left.weight || d.footLocks.right.weight)throw Error('Foot IK fought armed legs');
            if(prev)for(const name of Object.keys(d.quaternions)){
              const jump=angle(prev[name],d.quaternions[name]);
              if(jump>row.jump){row.jump=jump;row.worst={motion,yaw,pitch:-1.15+i*2.3/48,bone:name};}
            }
            prev=d.quaternions;row.actions[motion]=d.action;
          }
        }
      }
      report.push(row);
    }
    return report;
  });
  console.log('ANIMATION MATRIX '+JSON.stringify(matrix));
  for(const r of matrix){
    expect(r.finite,r.weapon).toBe(true);
    expect(r.maxElevation,r.weapon+' 7-degree aim limit').toBeLessThanOrEqual(7*Math.PI/180+1e-7);
    expect(r.maxWrist,r.weapon+' authored wrist correction').toBeLessThanOrEqual(.350001);
    expect(r.maxLegOverride,r.weapon+' legs must equal authored mixer pose').toBeLessThan(1e-6);
    expect(r.right,r.weapon+' trigger grip error').toBeLessThan(.065);
    expect(r.left,r.weapon+' support grip error').toBeLessThan(.085);
    expect(r.jump,r.weapon+' joint discontinuity').toBeLessThan(.55);
    expect(r.actions.left).not.toBe(r.actions.right);
    expect(r.actions.back).not.toBe(r.actions.jog);
  }
  const skin=await page.evaluate(()=>{
    const lab=window.__animationLab,rows=[];
    for(const weapon of ['pistol','rifle','shotgun','sniper','smg','lmg','dmr','akimbo','flak'])
      for(const motion of ['idle','jog','diagonal','left','right']) {
        lab.set({weapon,motion,pitch:0,yaw:0,measureSkin:false},false);lab.step(60,false);
        for(const pitch of [-7,0,7]){
          lab.set({pitch:pitch*Math.PI/180,measureSkin:true},false);
          const d=lab.step(1,false);
          rows.push({weapon,motion,pitch,...d.skin});
        }
      }
    lab.set({measureSkin:false},false);
    return rows;
  });
  console.log('SKIN STRETCH '+JSON.stringify(skin));
  for(const row of skin) {
    expect(row.samples,row.weapon+' skin samples').toBeGreaterThan(30);
    expect(row.finite,row.weapon+' skin finite').toBe(true);
    expect(row.p95,row.weapon+' '+row.motion+' skin distortion').toBeLessThan(1.25);
  }
  const gait=await page.evaluate(()=>{
    const lab=window.__animationLab,rows=[];
    const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.reduce((s,v,k)=>s+v*b[k],0))/
      (Math.hypot(...a)*Math.hypot(...b))));
    for(const motion of ['jog','diagonal','left','right']){
      lab.set({weapon:'rifle',motion,pitch:0,yaw:0},false);lab.step(60,false);
      let prev=null,maxJump=0;
      for(let frame=0;frame<360;frame++){
        const d=lab.step(1,false);
        if(prev)for(const name of Object.keys(d.legs))maxJump=Math.max(maxJump,angle(prev[name],d.legs[name]));
        prev=d.legs;
      }
      rows.push({motion,maxJump});
    }
    return rows;
  });
  console.log('GAIT CONTINUITY '+JSON.stringify(gait));
  for(const row of gait)expect(row.maxJump,row.motion+' knee/ankle discontinuity').toBeLessThan(.45);
  const feet=await page.evaluate(()=>{
    const lab=window.__animationLab;lab.set({weapon:'rifle',motion:'idle',yaw:0,pitch:0});lab.step(60,false);
    const base=lab.getDiagnostics().feet,measurements=[];
    for(const pitch of [-1.15,1.15,0]){lab.set({pitch});measurements.push(lab.getDiagnostics().feet);}
    return {base,measurements};
  });
  for(const f of feet.measurements)for(const side of ['left','right'])
    expect(Math.hypot(...f[side].map((v,i)=>v-feet.base[side][i]))).toBeLessThan(.005);
  for(const weapon of ['pistol','rifle','sniper']){
    for(const [label,pitch] of [['down',-1.15],['level',0],['up',1.15]]){
      await page.evaluate(({weapon,pitch})=>{
        const lab=window.__animationLab;lab.set({weapon,motion:'idle',yaw:0,pitch:0});
        lab.step(30,false);lab.set({pitch});lab.step(30);lab.view('side');
      },{weapon,pitch});
      await page.screenshot({path:'test-artifacts/animation-lab-'+weapon+'-'+label+'.png'});
    }
  }
  expect(errors).toEqual([]);
});
