import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the production camera update, including its rig integration.
// Helper-only tests missed the unwanted motion added to the real camera.
const source = fs.readFileSync(new URL('../three_fps_game.ts', import.meta.url), 'utf8');
const start = source.indexOf('  function updateCameraFX(dt) {');
const end = source.indexOf('  // ── Interact prompt pill', start);
assert.ok(start > 0 && end > start);
function rig(tp = false) {
  const vector = { x: 0, y: 0, z: 0, set(x,y,z) {Object.assign(this,{x,y,z});}, copy(v) {this.set(v.x,v.y,v.z);} };
  const state = {
    game: {state:'playing'}, thirdPerson: {enabled:tp,ready:true,lastMove:{sprinting:false},switchPulse:0},
    mouse:{aiming:false}, GUN_SPECS:{rifle:{adsInSpeed:12,adsOutSpeed:12,adsFov:60}},
    GUNS:{RIFLE:'rifle',SNIPER:'sniper',SHOTGUN:'shotgun'}, currentGun:'rifle',
    keys:new Set(), viewState:{ads:0,lookBack:0}, gunState:{reloadTimer:0},
    pendingWeaponSwitch:false, weaponAnim:{switchBlend:0}, player:{grounded:true},
    cutscene:{active:false},darkWaveActive:false, cinematicState:{enabled:false},userFovOffset:0,
    devVal:(_group,_key,value)=>value, dampAds:(v,t,r,dt)=>v+(t-v)*(1-Math.exp(-r*dt)),
    dampValue:(v,t,r,dt)=>v+(t-v)*(1-Math.exp(-r*dt)), getWeaponAdsFov:(v)=>v,
    cameraFX:{shake:0,damageShake:0,recoil:0,recoilVel:0,roll:0,rollVel:0,hipFov:null,inTP:null},
    camera:{position:vector,rotation:{x:0,y:0,z:0},fov:90,near:0.05,updateProjectionMatrix(){}},
    hud:{},performance:{now:()=>12345},shouldUseFirstPersonAdsView:()=>false,
    unifiedFirstPersonBodyActive:()=>true,FP_CAM_OFF_X:0,FP_CAM_OFF_Y:0,FP_CAM_OFF_Z:0,
    UNIFIED_FP_EYE_UP:0.12,UNIFIED_FP_EYE_FORWARD:0.18,
    applyViewModeVisibility(){},updateAimSight(){},crosshair:{recoilX:0,recoilY:0},
    yaw:{position:{x:0,y:1.7,z:0},rotation:{y:0}},
    solved:{x:0.4,y:1.9,z:2.5},
  };
  state.resolveThirdPersonCameraPosition=()=>state.solved;
  vm.createContext(state);
  vm.runInContext(source.slice(start,end),state);
  return state;
}
test('running and reversing keep first-person camera attached at all frame rates',()=>{
  for(const fps of [30,60,144]){
    const s=rig();
    for(let i=0;i<fps*3;i++){
      s.thirdPerson.lastMove.sprinting=i>fps;
      s.yaw.position.x+= (i>fps*2?-1:1)*6/fps;
      s.yaw.position.y=1.7+Math.max(0,Math.sin(i/fps*4));
      s.yaw.rotation.y+=0.01;
      s.updateCameraFX(1/fps);
      assert.deepEqual([s.camera.position.x,s.camera.position.y,s.camera.position.z],[0,0.12,-0.18]);
      assert.deepEqual([s.camera.rotation.x,s.camera.rotation.y,s.camera.rotation.z],[0,0,0]);
    }
  }
});
test('third-person camera respects current collision solution without recovery lag',()=>{
  const s=rig(true);
  for(const z of [2.5,0.42,2.5,0.7,2.5]){
    s.solved={x:0.4,y:1.9,z};
    s.updateCameraFX(1/60);
    assert.equal(s.camera.position.z,z);
  }
});
test('sprint FOV eases monotonically without shifting camera position',()=>{
  const s=rig();s.updateCameraFX(1/60);assert.equal(s.camera.fov,90);
  s.thirdPerson.lastMove.sprinting=true;
  let previous=90;
  for(let i=0;i<60;i++){s.updateCameraFX(1/60);assert.ok(s.camera.fov>previous && s.camera.fov<100);previous=s.camera.fov;}
  assert.ok(Math.abs(s.camera.fov-(100-10*Math.exp(-8)))<1e-8);
});
test('combat feedback still moves the camera',()=>{
  const s=rig();s.cameraFX.damageShake=0.8;s.updateCameraFX(1/60);
  assert.notEqual(s.camera.position.x,0);
});
