const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {transformSync}=require('esbuild');

test('drone fragments fall in world space, land, settle, and reset on pool reuse',async()=>{
 const THREE=await import('three');
 const {mergeGeometries}=await import('three/addons/utils/BufferGeometryUtils.js');
 const code=transformSync(fs.readFileSync('src/modules/storm_warden.ts','utf8'),{loader:'ts',format:'esm'}).code+'\n//# sourceURL=storm-warden-fixture.js';
 const {createStormWarden}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
 // Texture generation is the only DOM dependency of the procedural rig.
 const ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},
   {get:(target,key)=>target[key] || (()=>{})});
 global.document={createElement:()=>({getContext:()=>ctx})};
 for(const scale of [.6,1,1.5]) {
  const scene=new THREE.Scene(),parent=new THREE.Group();scene.add(parent);
  parent.position.set(3,0,-4);parent.rotation.y=.8;parent.scale.setScalar(scale);
  const ground=.25;
  const drone=createStormWarden(THREE,mergeGeometries,{groundHeight:()=>ground});parent.add(drone.root);
  for(let i=0;i<60;i++)drone.update(1/60,{alive:true,visualSpeed:6,typeName:'Blink Seraph'});
  scene.updateMatrixWorld(true);
  const parts=[drone.rig.pelvis,drone.rig.chest,drone.rig.head,drone.rig.crown,drone.rig.shoulderL,drone.rig.shoulderR,...drone.rig.rods.map(r=>r.group),...drone.rig.crownShards];
  const positions=()=>{scene.updateMatrixWorld(true);return parts.map(p=>p.getWorldPosition(new THREE.Vector3()));};
  const before=positions();drone.setDead();drone.update(0,{alive:false});
  positions().forEach((p,i)=>assert.ok(p.distanceTo(before[i])<1e-6,'death begins at the current pose'));
  for(let i=0;i<45;i++)drone.update(1/60,{alive:false});
  const falling=positions();
  assert.ok(falling.every((p,i)=>p.y<before[i].y-.1),'all parts lose hover height');
  for(let i=0;i<135;i++)drone.update(1/60,{alive:false});
  const landed=positions();
  for(let i=0;i<30;i++)drone.update(1/60,{alive:false});
  positions().forEach((p,i)=>assert.ok(p.distanceTo(landed[i])<1e-5,'debris stops on the ground'));
  scene.updateMatrixWorld(true);drone.skeleton.update();
  const v=new THREE.Vector3();let lowest=Infinity;
  for(let i=0;i<drone.body.geometry.attributes.position.count;i++) {
    drone.body.getVertexPosition(i,v).applyMatrix4(drone.body.matrixWorld);lowest=Math.min(lowest,v.y);
  }
  assert.ok(lowest>=ground-.001,'metal pieces do not penetrate the floor');
  assert.ok(lowest<ground+.15,'metal debris rests near the floor');
  drone.setDead(false);
  assert.equal(drone.rig.reactorCore.scale.x,1,'reactor restored');
  drone.update(1/60,{alive:true,visualSpeed:0});
  assert.ok(positions()[2].y>landed[2].y+.5,'recycled drone flies again');
  drone.setDead();for(let i=0;i<180;i++)drone.update(1/60,{alive:false});
  assert.ok(positions().every(p=>Number.isFinite(p.y)),'second death stays finite');
  drone.dispose();
 }
 delete global.document;
});
