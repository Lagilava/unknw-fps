const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {transformSync}=require('esbuild');

async function fixture() {
  const THREE=await import('three');
  const code=transformSync(fs.readFileSync('src/modules/zombie_character.ts','utf8'),{loader:'ts',format:'esm'}).code;
  const {createZombieCharacter}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const source=new THREE.Group();
  const geometry=new THREE.BoxGeometry(.5,1.8,.3), material=new THREE.MeshBasicMaterial();
  source.add(new THREE.Mesh(geometry,material));
  const bone=new THREE.Bone(); bone.name='mixamorigSpine'; source.add(bone);
  const clip=(name,duration)=>new THREE.AnimationClip(name,duration,[new THREE.QuaternionKeyframeTrack('mixamorigSpine.quaternion',[0,duration],[0,0,0,1,0,0,0,1])]);
  const clips={idle:clip('idle',3),walk:clip('walk',1),run:clip('run',1),scream:clip('scream',3),attack:clip('attack',2),death:clip('death',2)};
  return {source,geometry,material,create:()=>createZombieCharacter(THREE,source,clips,s=>s.clone(true))};
}
test('idle desynchronizes, stationary AI runs still idle, and one-shots ignore speed',async()=>{
  const f=await fixture(),a=f.create(),b=f.create();
  assert.notEqual(a.actions.idle.time,b.actions.idle.time);
  a.update(.02,{alive:true,locoState:'run',visualSpeed:0});
  assert.equal(a._diag().activeName,'idle');
  a.update(.02,{alive:true,aggroed:true,visualSpeed:0});
  assert.equal(a._diag().activeName,'scream');
  assert.ok(a.actions.scream.timeScale>2);
  for(let i=0;i<60;i++)a.update(.02,{alive:true,aggroed:true,visualSpeed:0});
  assert.equal(a._diag().activeName,'idle');
  a.setDead(); a.update(.02,{alive:false});
  assert.equal(a.actions.death.timeScale,1);
  a.setDead(false);a.update(.02,{alive:true,aggroed:true});
  assert.equal(a._diag().activeName,'scream');
  a.dispose();b.dispose();f.geometry.dispose();f.material.dispose();
});
test('disposal leaves shared assets alive and sparse clips never accumulate offsets',async()=>{
  const f=await fixture(),a=f.create();let disposed=0;
  f.geometry.addEventListener('dispose',()=>disposed++);f.material.addEventListener('dispose',()=>disposed++);
  for(let i=0;i<3600;i++)a.update(1/60,{alive:true,visualTurn:1,visualSpeed:0});
  const q=a.model.getObjectByName('mixamorigSpine').quaternion;
  assert.ok(Number.isFinite(q.w)&&Math.abs(q.w)>.9);
  a.dispose();assert.equal(disposed,0);
  f.geometry.dispose();f.material.dispose();
});
