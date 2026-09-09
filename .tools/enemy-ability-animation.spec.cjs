const { test, expect } = require('@playwright/test');
test('ability poses move the rig, recover and survive pooling', async ({page}) => {
  await page.goto('http://127.0.0.1:8000/');
  await page.setContent('<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>');
  const results = await page.evaluate(async () => {
    const THREE = await import('three');
    const {mergeGeometries} = await import('/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
    const {createStormWarden} = await import('/modules/storm_warden');
    const output = [];
    for (const [name, ability] of [['Siege Drone',{barrageActive:true}],['Blink Seraph',{phaseOut:1}],['Null Cherub',{megaBlastTimer:3}],['Null Cherub',{empWindUp:.1}],['Siege Drone',{lightningWindUp:.1,lightningWindUpDuration:.85}]]) {
      const model = createStormWarden(THREE,mergeGeometries);
      const ref = {typeName:name,alive:true,hp:100,maxHp:100};
      const tick = n => {for(let i=0;i<n;i++) model.update(1/60,ref);};
      const pose = () => [model.rig.shoulderL.rotation.x,model.rig.shoulderL.rotation.z,model.rig.shoulderR.rotation.x,model.rig.shoulderR.rotation.z];
      tick(60); const idle = pose(); Object.assign(ref,ability); tick(30); const active = pose();
      for(const key of Object.keys(ability)) ref[key] = 0;
      tick(180); const recovered = pose();
      model.setDead(true); tick(20); model.setDead(false); tick(60);
      const pooled = pose();
      output.push({name, delta:Math.max(...active.map((v,i)=>Math.abs(v-idle[i]))), recovery:Math.max(...recovered.map((v,i)=>Math.abs(v-idle[i]))), finite:pooled.every(Number.isFinite)});
      model.dispose();
    }
    return output;
  });
  for(const result of results) {
    expect(result.delta,result.name).toBeGreaterThan(.5);
    expect(result.recovery,result.name).toBeLessThan(.4);
    expect(result.finite,result.name).toBe(true);
  }
});
