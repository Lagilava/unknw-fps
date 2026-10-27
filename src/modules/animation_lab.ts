import * as THREE from 'three';
import { MAX_WEAPON_ELEVATION, limitWeaponElevation } from './weapon_pose_limits';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type LabState={weapon:string;motion:string;pitch:number;yaw:number;ads:boolean;clip:string;sweep:boolean;measureSkin?:boolean};
export function createAnimationLab({scene,renderer,canvas,weapons,clips,onWeapon,onReload,onReset,onStep,getSubject,getPlayerCamera}) {
  document.body.classList.add('animation-lab');
  const css=document.createElement('style');
  css.textContent=`
    body.animation-lab #hud,body.animation-lab #overlay,body.animation-lab #touch-controls,
    body.animation-lab #click-to-play,body.animation-lab #rb-perf-shadow-prompt {display:none!important}
    #animation-lab-panel{position:fixed;right:14px;top:14px;bottom:14px;width:290px;box-sizing:border-box;overflow:auto;
      z-index:20000;background:#101c28ed;border:1px solid #486174;border-radius:12px;padding:18px;color:#e5edf3;
      font:13px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px #0007}
    #animation-lab-panel h1{font-size:21px;margin:0 0 4px}#animation-lab-panel p{color:#aabfce;margin:4px 0 14px}
    #animation-lab-panel label{display:block;margin:12px 0 4px;color:#bdd3e0}
    #animation-lab-panel select,#animation-lab-panel button{font:inherit;color:#edf6ff;background:#233b4c;border:1px solid #567083;
      border-radius:5px;padding:8px;width:100%;box-sizing:border-box}
    #animation-lab-panel input[type=range]{width:100%;accent-color:#57d9b8}
    #animation-lab-panel .lab-row{display:flex;gap:6px;margin:9px 0}
    #animation-lab-panel .lab-row button{width:auto;flex:1}
    #animation-lab-panel output{float:right;color:#64e6c4;font-variant-numeric:tabular-nums}
    #lab-diagnostics{white-space:pre-wrap;background:#07131e;padding:10px;border-radius:6px;font:11px/1.6 monospace}
    #lab-note{position:fixed;left:18px;top:14px;z-index:20000;color:#d2e7f4;font:12px/1.5 system-ui;text-shadow:0 1px 3px #000}
    @media(max-width:700px){#animation-lab-panel{top:60%;bottom:0;right:0;width:100%;padding:12px;border-radius:12px 12px 0 0}#lab-note{max-width:100%;font-size:10px}}
  `;
  document.head.append(css);
  const panel=document.createElement('aside');panel.id='animation-lab-panel';
  panel.innerHTML=`<h1>Animation lab</h1><p>Production rig · no enemies · fixed-step playback</p>
    <label for="lab-weapon">Weapon</label><select id="lab-weapon"></select>
    <label for="lab-motion">Movement</label><select id="lab-motion">
      <option value="idle">Idle / ready</option><option value="jog">Armed jog</option><option value="sprint">Armed sprint</option>
      <option value="left">Strafe left</option><option value="right">Strafe right</option>
      <option value="back">Backpedal</option><option value="diagonal">Forward + right</option></select>
    <label for="lab-pitch">Aim elevation <output id="lab-pitch-value">0°</output></label><input id="lab-pitch" type="range" min="-7" max="7" step="1" value="0">
    <label for="lab-yaw">Body heading <output id="lab-yaw-value">0°</output></label><input id="lab-yaw" type="range" min="-180" max="180" step="1" value="0">
    <label><input id="lab-ads" type="checkbox"> Aim / ADS</label>
    <label><input id="lab-sweep" type="checkbox"> Sweep aim up and down</label>
    <label for="lab-clip">Clip comparison</label><select id="lab-clip"><option value="">Automatic weapon profile</option></select>
    <label for="lab-speed">Playback rate <output id="lab-speed-value">1×</output></label><input id="lab-speed" type="range" min=".1" max="1.5" step=".1" value="1">
    <div class="lab-row"><button id="lab-play">Pause</button><button id="lab-step">Step 1/60 s</button></div>
    <div class="lab-row"><button id="lab-reload">Reload</button><button id="lab-reset">Reset</button></div>
    <label for="lab-layout">View layout</label><select id="lab-layout"><option value="quad">Four synchronized views</option><option value="single">Single orbit view</option><option value="player">Player POV</option></select>
    <label><input id="lab-player-view" type="checkbox" checked> Player POV in first tile</label>
    <label>Camera</label><div class="lab-row"><button data-view="front">Front</button><button data-view="side">Side</button><button data-view="rear">Rear</button></div>
    <div class="lab-row"><button data-view="hands">Hands</button><button data-view="handsSide">Hands side</button><button data-view="handsRear">Hands rear</button><button data-view="handsTop">Hands top</button></div>
    <label><input id="lab-skeleton" type="checkbox"> Show bone chains</label>
    <label><input id="lab-skin-check" type="checkbox"> Measure skin stretch vs authored pose</label>\n    <label>Live measurements</label><pre id="lab-diagnostics">Preparing rig…</pre>
    <p>Drag to orbit · wheel to zoom. Movement follows the real animation and arm-pose pipeline. Clip comparison overrides automatic selection without changing game defaults.</p>
    <a href="./" style="color:#6fe7d0">Return to game</a>`;
  document.body.append(panel);
  const labels=document.createElement('div');labels.id='lab-view-labels';
  labels.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:19999;color:#d2e7f4;font:12px system-ui';
  const viewLabels=['Orbit','Front','Side','Rear'].map(name=>{
    const el=document.createElement('span');el.textContent=name;
    el.style.cssText='position:absolute;background:#101c28d9;border:1px solid #486174;border-radius:4px;padding:5px 9px';
    labels.append(el);return el;
  });document.body.append(labels);
  const note=document.createElement('div');note.id='lab-note';note.textContent='UNKNW / ANIMATION LAB\n1 metre grid · aim and grip diagnostics';document.body.append(note);
  const get=(id:string)=>panel.querySelector('#'+id) as HTMLInputElement;
  const weaponSelect=get('lab-weapon');
  for(const [key,spec] of Object.entries(weapons) as any) {
    const option=document.createElement('option'); option.value=key;option.textContent=spec.name;weaponSelect.append(option);
  }
  for(const name of clips) {
    const option=document.createElement('option'); option.value=name;option.textContent=name;get('lab-clip').append(option);
  }
  const state:LabState={weapon:'pistol',motion:'idle',pitch:0,yaw:0,ads:false,clip:'',sweep:false};
  let playing=true,speed=1,elapsed=0,accumulator=0,diagnostics:any={},last=performance.now(),frameMs=16.7;
  const camera=new THREE.PerspectiveCamera(43,innerWidth/innerHeight,.05,500);
  let layout='quad';
  let playerView=true;
  const playerCamera=new THREE.PerspectiveCamera();
  const usingPlayer=()=>layout==='player'||layout==='quad'&&playerView;
  const fixedCameras=['front','side','rear'].map(()=>new THREE.PerspectiveCamera(43,1,.05,500));
  // Orbit input belongs only to the orbit tile; the other views stay locked.
  const orbitSurface=document.createElement('div');orbitSurface.id='lab-orbit-surface';
  orbitSurface.style.cssText='position:fixed;left:0;top:0;z-index:19998;touch-action:none';
  document.body.append(orbitSurface);
  const controls=new OrbitControls(camera,orbitSurface);
  controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=.6;controls.maxDistance=9;
  controls.target.set(0,1,0);camera.position.set(3,1.7,3.6);controls.update();
  function viewportRects() {
    const size=renderer.getSize(new THREE.Vector2());
    const bounds=panel.getBoundingClientRect(),mobile=innerWidth<=700;
    const width=Math.max(1,mobile?size.x:Math.min(size.x,bounds.left-8));
    const height=Math.max(1,mobile?bounds.top:size.y),bottom=size.y-height;
    if(layout!=='quad')return [{x:0,y:bottom,width,height}];
    const halfW=Math.floor(width/2),halfH=Math.floor(height/2);
    return [{x:0,y:bottom+halfH,width:halfW,height:height-halfH},
      {x:halfW,y:bottom+halfH,width:width-halfW,height:height-halfH},
      {x:0,y:bottom,width:halfW,height:halfH},{x:halfW,y:bottom,width:width-halfW,height:halfH}];
  }
  function renderViews() {
    const rects=viewportRects(),size=renderer.getSize(new THREE.Vector2());
    const target=position.clone().add(new THREE.Vector3(0,1,0));
    const offsets=[[0,.35,-3.7],[3.7,.35,0],[0,.35,3.7]];
    fixedCameras.forEach((cam,i)=>{
      cam.position.copy(target).add(new THREE.Vector3(...offsets[i]).applyAxisAngle(new THREE.Vector3(0,1,0),state.yaw));
      cam.lookAt(target);
    });
    renderer.setScissorTest(false);renderer.setViewport(0,0,size.x,size.y);renderer.clear();
    renderer.setScissorTest(true);
    rects.forEach((r,i)=>{
      const usePlayer=i===0 && usingPlayer() && getPlayerCamera;
      let cam=i===0?camera:fixedCameras[i-1];
      if(usePlayer) {
        const source=getPlayerCamera();source.updateWorldMatrix(true,false);
        playerCamera.copy(source,false);source.getWorldPosition(playerCamera.position);source.getWorldQuaternion(playerCamera.quaternion);
        cam=playerCamera;
      }
      cam.aspect=r.width/r.height;cam.updateProjectionMatrix();
      renderer.setViewport(r.x,r.y,r.width,r.height);renderer.setScissor(r.x,r.y,r.width,r.height);
      renderer.render(scene,cam);
    });
    renderer.setScissorTest(false);renderer.setViewport(0,0,size.x,size.y);
    viewLabels.forEach((el,i)=>{
      const r=rects[i];el.hidden=!r;
      if(i===0)el.textContent=usingPlayer()?'Player POV':'Orbit';
      if(r){el.style.left=(r.x+12)+'px';el.style.top=(size.y-r.y-r.height+42)+'px';}
    });
    const orbit=rects[0];orbitSurface.style.top=(size.y-orbit.y-orbit.height)+'px';
    orbitSurface.hidden=usingPlayer();
    orbitSurface.style.width=orbit.width+'px';orbitSurface.style.height=orbit.height+'px';
  }
  scene.background=new THREE.Color(0x182633);scene.fog=null;scene.environment=null;
  scene.add(new THREE.HemisphereLight(0xe9f5ff,0x6f7b87,2.3));
  const key=new THREE.DirectionalLight(0xfff0df,2.5);key.position.set(3,7,5);scene.add(key);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(240,240),new THREE.MeshStandardMaterial({color:0x253440,roughness:1}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-.012;scene.add(floor);
  const grid=new THREE.GridHelper(200,200,0x81a9bb,0x3a5361);scene.add(grid);
  const skeleton=new THREE.SkeletonHelper(getSubject());skeleton.visible=false;scene.add(skeleton);
  const previous=new THREE.Vector3(),position=new THREE.Vector3();getSubject().getWorldPosition(previous);
  // Hand close-ups frame the weapon hands (about 1.45 m up) instead of the torso.
  const HAND_VIEWS={hands:[0,.05,-.8],handsSide:[.8,.05,0],handsRear:[.25,.2,.8],handsTop:[0,.8,-.3]};
  function view(name) {
    if(layout==='player')setLayout('single');
    if(layout==='quad'){playerView=false;get('lab-player-view').checked=false;}
    getSubject().getWorldPosition(position);
    const hand=HAND_VIEWS[name]&&diagnostics.handCenter;
    if(hand)controls.target.fromArray(hand);else controls.target.copy(position).y+=1;
    const direction=HAND_VIEWS[name]?new THREE.Vector3(...HAND_VIEWS[name]).applyAxisAngle(new THREE.Vector3(0,1,0),state.yaw)
      :name==='front'?new THREE.Vector3(0,.35,-3.7)
      :name==='side'?new THREE.Vector3(3.7,.35,0):new THREE.Vector3(0,.35,3.7);
    camera.position.copy(controls.target).add(direction);controls.update();
  }
  function refresh() {
    get('lab-pitch').value=String(Math.round(state.pitch*180/Math.PI));
    get('lab-yaw').value=String(Math.round(state.yaw*180/Math.PI));
    get('lab-pitch-value').textContent=get('lab-pitch').value+'°';get('lab-yaw-value').textContent=get('lab-yaw').value+'°';
    get('lab-speed-value').textContent=speed.toFixed(1)+'×';
    get('lab-play').textContent=playing?'Pause':'Play';
    weaponSelect.value=state.weapon;get('lab-motion').value=state.motion;get('lab-clip').value=state.clip;
    get('lab-ads').checked=state.ads;get('lab-sweep').checked=state.sweep;
  }
  function step(frames=1,draw=true) {
    for(let i=0;i<frames;i++) {
      elapsed+=1/60;
      if(state.sweep) state.pitch=Math.sin(elapsed*.7)*MAX_WEAPON_ELEVATION;
      diagnostics=onStep(state,1/60);
    }
    if(draw)render();return diagnostics;
  }
  function render() {
    getSubject().getWorldPosition(position);
    const delta=position.clone().sub(previous);camera.position.add(delta);controls.target.add(delta);previous.copy(position);
    floor.position.x=Math.round(position.x/50)*50;floor.position.z=Math.round(position.z/50)*50;
    grid.position.x=floor.position.x;grid.position.z=floor.position.z;
    controls.update();renderViews();
    const d=diagnostics.fit||{};
    get('lab-diagnostics').textContent=[
      'ACTION  '+(diagnostics.action||'—'),'PHASE   '+Number(diagnostics.phase||0).toFixed(2),
      'RIGHT   '+(100*(d.rightError||0)).toFixed(2)+' cm','LEFT    '+(100*(d.leftError||0)).toFixed(2)+' cm',
      'WRIST   '+(Math.max(d.leftWristDelta||0,d.rightWristDelta||0)*180/Math.PI).toFixed(1)+'° correction',
      'SKIN95  '+(diagnostics.skin?diagnostics.skin.p95.toFixed(2)+'×':'measurement off'),
      'LEGS    authored clip / foot locks off',
      'PELVIS  '+Number(diagnostics.pelvis?.[1]||0).toFixed(3)+' m · captured weight shift',
      'LENGTH  '+Number(d.length||0).toFixed(2)+' m','FRAME   '+frameMs.toFixed(1)+' ms',
      'PITCH   '+(state.pitch*180/Math.PI).toFixed(1)+'° / ±7°','YAW     '+(state.yaw*180/Math.PI).toFixed(1)+'°',
      diagnostics.reloading?'RELOAD  active':'RELOAD  ready'
    ].join('\n');
    refresh();
  }
  function set(values:Partial<LabState>,draw=true) {
    if(values.weapon && values.weapon!==state.weapon) onWeapon(values.weapon);
    Object.assign(state,values);state.pitch=limitWeaponElevation(state.pitch);diagnostics=onStep(state,0);if(draw){refresh();render();}
  }
  onWeapon(state.weapon);
  weaponSelect.addEventListener('change',()=>set({weapon:weaponSelect.value}));
  get('lab-motion').addEventListener('change',()=>set({motion:get('lab-motion').value}));
  get('lab-clip').addEventListener('change',()=>set({clip:get('lab-clip').value}));
  get('lab-pitch').addEventListener('input',()=>set({pitch:Number(get('lab-pitch').value)*Math.PI/180,sweep:false}));
  get('lab-yaw').addEventListener('input',()=>set({yaw:Number(get('lab-yaw').value)*Math.PI/180}));
  get('lab-ads').addEventListener('change',()=>set({ads:get('lab-ads').checked}));
  get('lab-sweep').addEventListener('change',()=>set({sweep:get('lab-sweep').checked}));
  get('lab-speed').addEventListener('input',()=>{speed=Number(get('lab-speed').value);refresh();});
  get('lab-play').addEventListener('click',()=>{playing=!playing;refresh();});
  get('lab-step').addEventListener('click',()=>{playing=false;step();});
  get('lab-reload').addEventListener('click',()=>{onReload();if(!playing)step();});
  get('lab-reset').addEventListener('click',()=>{
    elapsed=0;accumulator=0;onReset?.();
    set({motion:'idle',pitch:0,yaw:0,clip:'',sweep:false});
    step(12,false);view('front');render();
  });
  get('lab-skin-check').addEventListener('change',()=>set({measureSkin:get('lab-skin-check').checked}));
  function setLayout(value:string) {
    layout=['single','player'].includes(value)?value:'quad';get('lab-layout').value=layout;render();
  }
  get('lab-player-view').addEventListener('change',()=>{playerView=get('lab-player-view').checked;render();});
  get('lab-layout').addEventListener('change',()=>setLayout(get('lab-layout').value));
  get('lab-skeleton').addEventListener('change',()=>{skeleton.visible=get('lab-skeleton').checked;render();});
  panel.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>view(el.getAttribute('data-view'))));
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();render();});
  const api={set,step,getState:()=>({...state,playing}),getDiagnostics:()=>diagnostics,
    setPlaying:(value:boolean)=>{playing=value;refresh();},view,setLayout,getLayout:()=>layout,
    getViews:()=>viewportRects().map((rect,i)=>({name:i===0?(usingPlayer()?'player':'orbit'):['orbit','front','side','rear'][i],...rect})),
    getPlayerView:()=>({position:playerCamera.position.toArray(),quaternion:playerCamera.quaternion.toArray(),fov:playerCamera.fov}),
    getClips:()=>[...clips],reload:()=>onReload()};
  window.__animationLab=api;
  document.body.dataset.animationLabReady='1';
  step(30);
  function animate(now) {
    const dt=Math.min(.1,(now-last)/1000);last=now;frameMs+=(dt*1000-frameMs)*.1;
    if(playing) {
      accumulator+=dt*speed;
      const count=Math.floor(accumulator*60);
      if(count>0){accumulator-=count/60;step(count);}else render();
    } else {accumulator=0;render();}
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  return api;
}
