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
   const heights=[],pelvis=[];let error=0;
   for(let i=0;i<240;i++){
    const d=lab.step(1,false);heights.push(d.handCenter[1]);
    pelvis.push(d.pelvis);
    error=Math.max(error,d.fit.rightError,d.fit.leftError);
   }
   rows.push({motion,yaw,bounce:Math.max(...heights)-Math.min(...heights),error,
    hipRange:[0,1,2].map(axis=>Math.max(...pelvis.map(p=>p[axis]))-Math.min(...pelvis.map(p=>p[axis])))});
  }
  return {rows,views:lab.getViews(),layout:lab.getLayout()};
 });
 expect(report.layout).toBe('quad');
 expect(report.views.map(v=>v.name)).toEqual(['player','front','side','rear']);
 for(const row of report.rows){
  expect(row.bounce,`${row.motion} retains natural body motion`).toBeGreaterThan(.004);
  // The previous 2.5 cm hand ceiling rewarded a frozen pelvis. Validate captured
  // body travel and grip contact separately; the camera itself remains stable.
  expect(row.bounce,`${row.motion} carry bounce`).toBeLessThan(.13);expect(row.error).toBeLessThan(.02);
  expect(row.hipRange[1],`${row.motion} pelvis rises/falls with support`).toBeGreaterThan(.025);
  expect(row.hipRange[1]).toBeLessThan(.11);
  expect(Math.hypot(row.hipRange[0],row.hipRange[2]),`${row.motion} lateral weight transfer`).toBeGreaterThan(.015);
 }
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

test('player POV uses the gameplay camera and sprint carry smoothly yields to aim',async({page})=>{
 await page.goto('http://127.0.0.1:3000/?animationLab=1');
 await page.waitForFunction(()=>window.__animationLab,null,{timeout:180000});
 const result=await page.evaluate(()=>{
  const lab=window.__animationLab;lab.setPlaying(false);lab.setLayout('player');
  lab.set({weapon:'pistol',motion:'sprint',yaw:Math.PI/2,pitch:.08,ads:false},false);
  lab.step(120);const sprint=lab.getDiagnostics(),rendered=lab.getPlayerView();
  let previous=sprint.quaternions,previousPelvis=sprint.pelvis,maxJointJump=0,maxPelvisStep=0;
  const sample=()=>{
   const d=lab.step(1,false);
   for(const name of Object.keys(d.quaternions)) {
    const a=previous[name],b=d.quaternions[name];
    const dot=Math.abs(a.reduce((sum,v,i)=>sum+v*b[i],0))/(Math.hypot(...a)*Math.hypot(...b));
    maxJointJump=Math.max(maxJointJump,2*Math.acos(Math.min(1,dot)));
   }
   maxPelvisStep=Math.max(maxPelvisStep,Math.hypot(...d.pelvis.map((v,i)=>v-previousPelvis[i])));
   previousPelvis=d.pelvis;previous=d.quaternions;return d;
  };
  lab.set({ads:true},false);
  const transition=[];for(let i=0;i<45;i++)transition.push(sample().pistolCarry);
  const aimed=lab.getDiagnostics();
  for(const motion of ['left','right','back','diagonal','jog','sprint','idle']) {
   lab.set({motion,ads:false},false);for(let i=0;i<30;i++)sample();
  }
  lab.set({motion:'idle',ads:false},false);lab.step(60,false);const idle=lab.getDiagnostics();
  lab.set({motion:'sprint',ads:false},false);lab.step(60,false);
  lab.set({weapon:'rifle'},false);lab.step(30,false);const rifle=lab.getDiagnostics();
  lab.set({motion:'idle'},false);lab.step(90,false);lab.set({motion:'jog'},false);
  const acceleration=[];for(let i=0;i<12;i++)acceleration.push(Math.hypot(...lab.step(1,false).velocity));
  lab.set({motion:'idle'},false);
  const braking=[];for(let i=0;i<12;i++)braking.push(Math.hypot(...lab.step(1,false).velocity));
  return {sprint,rendered,transition,aimed,idle,rifle,maxJointJump,maxPelvisStep,acceleration,braking,views:lab.getViews()};
 });
 expect(result.views[0].name).toBe('player');
 expect(result.rendered).toEqual(result.sprint.playerCamera);
 expect(result.sprint.pistolCarry).toBeGreaterThan(.99);
 expect(result.maxJointJump).toBeLessThan(.55);
 expect(result.maxPelvisStep).toBeLessThan(.05);
 expect(result.acceleration[0]).toBeLessThan(result.acceleration.at(-1)*.5);
 for(let i=1;i<12;i++){
  expect(result.acceleration[i]).toBeGreaterThan(result.acceleration[i-1]);
  expect(result.braking[i]).toBeLessThan(result.braking[i-1]);
 }
 for(let i=1;i<result.transition.length;i++){
  expect(result.transition[i]).toBeLessThan(result.transition[i-1]);
  expect(result.transition[i-1]-result.transition[i]).toBeLessThan(.3);
 }
 expect(result.aimed.pistolCarry).toBeLessThan(.001);
 expect(result.idle.pistolCarry).toBeLessThan(.001);
 expect(result.rifle.fit.rightError).toBeLessThan(.02);
 expect(result.rifle.fit.leftError).toBeLessThan(.02);
});
