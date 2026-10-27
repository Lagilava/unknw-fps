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
    body.animation-lab{--lab-bg:#101c28;--lab-line:#354b5d;--lab-text:#e5edf3;--lab-muted:#a3b8c8;
      --lab-accent:#8ac8ee;color:var(--lab-text);font:13px/1.45 'Segoe UI',system-ui,sans-serif}
    #lab-header{position:fixed;inset:0 0 auto;height:64px;z-index:20000;display:flex;align-items:center;
      gap:18px;padding:0 20px;background:#101c28;border-bottom:1px solid var(--lab-line);box-sizing:border-box}
    #lab-header .lab-brand{font:600 18px 'Bahnschrift','Arial Narrow',sans-serif;letter-spacing:3px;color:#8ac8ee}
    #lab-header h1{font-size:16px;font-weight:600;margin:0}#lab-header .lab-tagline{font-size:11px;color:var(--lab-muted)}
    #lab-status{margin-left:auto;border:1px solid #426278;background:#20384b;border-radius:20px;padding:5px 12px;
      color:#b7def4;font-size:11px;white-space:nowrap}#lab-status[data-paused=true]{color:#edd09a;border-color:#716044;background:#352f25}
    #lab-header a{color:var(--lab-muted);text-decoration:none;font-size:12px}
    #animation-lab-panel{position:fixed;right:14px;top:78px;bottom:14px;width:310px;box-sizing:border-box;overflow:auto;
      z-index:20000;background:#101c28f5;border:1px solid var(--lab-line);border-radius:10px;padding:0;color:var(--lab-text);
      scrollbar-width:thin;scrollbar-color:#426278 transparent;box-shadow:0 10px 36px #0003}
    #animation-lab-panel section{padding:16px 18px;border-bottom:1px solid #2b4051}
    #animation-lab-panel h2{font-size:12px;font-weight:600;letter-spacing:.6px;margin:0 0 12px;color:#cfe5f3}
    #animation-lab-panel label{display:block;margin:12px 0 5px;color:#adbfcc;font-size:12px}
    #animation-lab-panel label.lab-check{display:flex;align-items:center;gap:8px;margin:10px 0;font-size:12px}
    #animation-lab-panel input[type=checkbox]{accent-color:var(--lab-accent);margin:0;width:15px;height:15px}
    body.animation-lab select,body.animation-lab button{font:inherit;color:var(--lab-text);background:#203344;border:1px solid #426075;
      border-radius:6px;padding:8px 10px;box-sizing:border-box;min-height:36px;cursor:pointer}
    #animation-lab-panel select{width:100%}body.animation-lab button:hover{background:#2d4b60;border-color:#82b0cd}
    body.animation-lab :is(button,select,input,a,summary):focus-visible{outline:2px solid #8ac8ee;outline-offset:3px}
    #animation-lab-panel input[type=range],#lab-speed{width:100%;accent-color:var(--lab-accent);cursor:pointer}
    #animation-lab-panel .lab-row{display:flex;gap:6px;margin:9px 0;flex-wrap:wrap}
    #animation-lab-panel .lab-row button{flex:1;font-size:11px;padding:6px;min-width:48px}
    #animation-lab-panel output{float:right;color:#b5dcf5;font:12px Consolas,monospace}
    #animation-lab-panel details{padding:16px 18px}#animation-lab-panel summary{cursor:pointer;color:#adbfcc;font-size:12px}
    #lab-diagnostics{white-space:pre-wrap;background:#0b1620;padding:10px;border:1px solid #2b4051;border-radius:6px;font:10px/1.7 Consolas,monospace;overflow:auto}
    #animation-lab-panel .lab-help{color:#819caf;font-size:11px;margin:10px 0 0}
    #animation-lab-panel .lab-return{display:block;padding:14px 18px;color:#9dcced;font-size:12px;text-decoration:none;border-top:1px solid #2b4051}
    #lab-live-metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    #lab-live-metrics span{display:block;color:#8faabd;font-size:10px;margin-bottom:3px}
    #lab-live-metrics strong{font:18px Consolas,monospace;color:#deedf7}
    #lab-transport{position:fixed;left:14px;bottom:14px;right:338px;min-height:62px;display:flex;align-items:center;gap:10px;
      box-sizing:border-box;padding:10px 12px;z-index:20000;background:#101c28f5;border:1px solid var(--lab-line);border-radius:10px}
    #lab-play{background:#8ac8ee!important;color:#102432!important;border-color:#a3d6f5!important;font-weight:600!important;min-width:88px}
    #lab-rate-control{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:11px;color:#a3b8c8}
    #lab-speed{width:95px}#lab-speed-value{min-width:30px;font:12px Consolas,monospace;color:#d7eaf6}
    #lab-clock{font:11px Consolas,monospace;color:#a3b8c8;min-width:80px;text-align:center}
    #lab-note{position:fixed;left:24px;top:78px;z-index:20000;color:#adc5d6;font:11px/1.5 'Segoe UI',sans-serif;pointer-events:none}
    .lab-view-label{position:absolute;background:#101c28d9;border:1px solid #486174;border-radius:5px;padding:5px 9px;font-size:11px}
    #lab-toast{position:fixed;left:50%;top:76px;transform:translateX(-50%);padding:10px 16px;border:1px solid #76afd2;background:#172d3e;
      color:#deedf7;border-radius:7px;z-index:22000;max-width:85%;box-sizing:border-box;font-size:12px}
    #lab-toast[hidden]{display:none}
    @media(max-width:1100px){#lab-transport{gap:6px}#lab-clock{display:none}#lab-speed{width:60px}#lab-rate-control>span{display:none}}
    @media(max-width:800px){#lab-header{padding:0 12px;gap:10px}#lab-header .lab-tagline{display:none}#lab-status{padding:4px 8px}
      #lab-header a,#lab-status{display:none}#lab-share{margin-left:auto}#animation-lab-panel{top:60%;bottom:0;right:0;width:100%;border-radius:10px 10px 0 0}
      #animation-lab-panel section{padding:12px 16px}#lab-note{top:72px;left:16px;font-size:10px}
      #lab-transport{bottom:40%;right:8px;left:8px;padding:7px;min-height:52px;transform:translateY(-8px);border-radius:8px}
      #lab-transport button{font-size:11px;padding:6px}#lab-play{min-width:64px}#lab-rate-control{gap:4px}#lab-speed{width:48px}
      #lab-save-frame{display:none}#lab-header .lab-brand{font-size:14px;letter-spacing:2px}#lab-header h1{font-size:14px}}
    @media(prefers-reduced-motion:reduce){body.animation-lab *{scroll-behavior:auto!important}}
  `;
  document.head.append(css);
  const panel=document.createElement('aside');panel.id='animation-lab-panel';
  panel.setAttribute('aria-label','Animation settings');
  panel.innerHTML=`<section><h2>Motion setup</h2>
    <label for="lab-weapon">Weapon</label><select id="lab-weapon"></select>
    <label for="lab-motion">Movement</label><select id="lab-motion">
      <option value="idle">Idle / ready</option><option value="jog">Run</option><option value="sprint">Sprint</option>
      <option value="left">Strafe left</option><option value="right">Strafe right</option>
      <option value="back">Backpedal</option><option value="diagonal">Forward + right</option></select>
    <label class="lab-check"><input id="lab-ads" type="checkbox"> Aim down sights</label>
    <div class="lab-row"><button id="lab-reload">Reload weapon</button><button id="lab-reset">Reset pose</button></div></section>
    <section><h2>Aim &amp; heading</h2>
    <label for="lab-pitch">Aim elevation <output id="lab-pitch-value">0°</output></label><input id="lab-pitch" type="range" min="-7" max="7" step="1" value="0">
    <label for="lab-yaw">Body heading <output id="lab-yaw-value">0°</output></label><input id="lab-yaw" type="range" min="-180" max="180" step="1" value="0">
    <label class="lab-check"><input id="lab-sweep" type="checkbox"> Sweep aim up and down</label></section>
    <section><h2>View workspace</h2>
    <label for="lab-layout">View layout</label><select id="lab-layout"><option value="quad">Four synchronized views</option><option value="single">Single orbit view</option><option value="player">Player POV</option></select>
    <label class="lab-check"><input id="lab-player-view" type="checkbox" checked> Player POV in first tile</label>
    <label>Orbit camera presets</label><div class="lab-row"><button data-view="front">Front</button><button data-view="side">Side</button><button data-view="rear">Rear</button></div>
    <div class="lab-row"><button data-view="hands">Hands</button><button data-view="handsSide">Hands side</button><button data-view="handsRear">Hands rear</button><button data-view="handsTop">Hands top</button></div>
    <p class="lab-help">Camera presets replace the first tile with an orbit view. Drag to rotate; scroll to zoom.</p></section>
    <section><h2>Live motion</h2><div id="lab-live-metrics" aria-label="Live motion measurements">
      <div><span>Ground speed</span><strong id="lab-ground-speed">—</strong></div><div><span>Clip cadence</span><strong id="lab-cadence">—</strong></div>
      <div><span>Cycle phase</span><strong id="lab-phase">—</strong></div><div><span>Grip error</span><strong id="lab-grip">—</strong></div></div></section>
    <details><summary>Clip comparison &amp; rig diagnostics</summary>
    <label for="lab-clip">Override clip</label><select id="lab-clip"><option value="">Automatic weapon profile</option></select>
    <label class="lab-check"><input id="lab-skeleton" type="checkbox"> Show bone chains</label>
    <label class="lab-check"><input id="lab-skin-check" type="checkbox"> Measure skin stretch</label><pre id="lab-diagnostics">Preparing rig…</pre>
    <p class="lab-help">Overrides apply only in the lab. Space: play or pause. Right arrow: advance one frame.</p></details>
    <a class="lab-return" href="./">Return to game ↗</a>`;
  document.body.append(panel);
  const header=document.createElement('header');header.id='lab-header';
  header.innerHTML=`<div class="lab-brand">UNKNW</div><div><h1>Animation lab</h1><div class="lab-tagline">One performance. Every angle.</div></div>
    <span id="lab-status" role="status">Playing · synchronized</span><button id="lab-share">Copy lab link</button><a href="./">Return to game ↗</a>`;
  document.body.append(header);
  const transport=document.createElement('nav');transport.id='lab-transport';transport.setAttribute('aria-label','Playback controls');
  transport.innerHTML=`<button id="lab-play" title="Space: play or pause">Pause</button><button id="lab-step" title="Right arrow: step one frame">Step frame</button>
    <button id="lab-save-frame">Save frame</button><output id="lab-clock" aria-live="off">00:00 · f0</output>
    <label id="lab-rate-control" for="lab-speed"><span>Review speed</span><input id="lab-speed" type="range" min=".1" max="1.5" step=".1" value="1"><output id="lab-speed-value" aria-live="off">1×</output></label>`;
  document.body.append(transport);
  const toast=document.createElement('div');toast.id='lab-toast';toast.hidden=true;toast.setAttribute('role','status');document.body.append(toast);
  const labels=document.createElement('div');labels.id='lab-view-labels';
  labels.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:19999;color:#d2e7f4;font:12px system-ui';
  const viewLabels=['Orbit','Front','Side','Rear'].map(name=>{
    const el=document.createElement('span');el.textContent=name;
    el.className='lab-view-label';
    labels.append(el);return el;
  });document.body.append(labels);
  const note=document.createElement('div');note.id='lab-note';note.textContent='Four views · one shared animation clock';document.body.append(note);
  const get=(id:string)=>document.getElementById(id) as HTMLInputElement;
  panel.insertBefore(get('lab-live-metrics').parentElement,panel.children[1]);
  const weaponSelect=get('lab-weapon');
  for(const [key,spec] of Object.entries(weapons) as any) {
    const option=document.createElement('option'); option.value=key;option.textContent=spec.name;weaponSelect.append(option);
  }
  for(const name of clips) {
    const option=document.createElement('option'); option.value=name;option.textContent=name;get('lab-clip').append(option);
  }
  const params=new URLSearchParams(location.search);
  const numberParam=(name:string,fallback:number)=>params.has(name)&&params.get(name)!==''&&Number.isFinite(Number(params.get(name)))?Number(params.get(name)):fallback;
  const motions=Array.from(get('lab-motion').querySelectorAll('option')).map(option=>option.value);
  const state:LabState={weapon:Object.hasOwn(weapons,params.get('weapon'))?params.get('weapon'):'pistol',
    motion:motions.includes(params.get('motion'))?params.get('motion'):'jog',
    pitch:limitWeaponElevation(numberParam('pitch',0)*Math.PI/180),yaw:THREE.MathUtils.clamp(numberParam('yaw',0),-180,180)*Math.PI/180,
    ads:params.get('ads')==='1',clip:clips.includes(params.get('clip'))?params.get('clip'):'',sweep:false};
  let playing=params.get('paused')!=='1',speed=Math.round(THREE.MathUtils.clamp(numberParam('rate',1),.1,1.5)*10)/10,elapsed=0,accumulator=0,
    diagnostics:any={},last=performance.now(),frameMs=16.7,toastTimer:ReturnType<typeof setTimeout>;
  const viewBorders=viewLabels.map(()=>{
    const border=document.createElement('div');border.style.cssText='position:absolute;border:1px solid #3d5768;border-radius:7px;box-sizing:border-box';
    labels.prepend(border);return border;
  });
  const camera=new THREE.PerspectiveCamera(43,innerWidth/innerHeight,.05,500);
  let layout=['player','single'].includes(params.get('layout'))?params.get('layout'):'quad';
  let playerView=params.get('orbit')!=='1';
  get('lab-player-view').checked=playerView;get('lab-layout').value=layout;
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
    const bounds=panel.getBoundingClientRect(),mobile=innerWidth<=800,left=mobile?8:14,gap=10;
    const width=Math.max(1,mobile?size.x-16:Math.min(size.x,bounds.left)-28);
    const bottom=size.y-transport.getBoundingClientRect().top+12,height=Math.max(1,size.y-100-bottom);
    if(layout!=='quad')return [{x:left,y:bottom,width,height}];
    const halfW=Math.max(1,Math.floor((width-gap)/2)),halfH=Math.max(1,Math.floor((height-gap)/2));
    return [{x:left,y:bottom+halfH+gap,width:halfW,height:height-halfH-gap},
      {x:left+halfW+gap,y:bottom+halfH+gap,width:width-halfW-gap,height:height-halfH-gap},
      {x:left,y:bottom,width:halfW,height:halfH},{x:left+halfW+gap,y:bottom,width:width-halfW-gap,height:halfH}];
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
      const border=viewBorders[i];border.hidden=!r;
      if(r){
        el.style.left=(r.x+12)+'px';el.style.top=(size.y-r.y-r.height+12)+'px';
        Object.assign(border.style,{left:r.x+'px',top:(size.y-r.y-r.height)+'px',width:r.width+'px',height:r.height+'px'});
      }
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
    const direction=HAND_VIEWS[name]?new THREE.Vector3(...HAND_VIEWS[name])
      :name==='front'?new THREE.Vector3(0,.35,-3.7)
      :name==='side'?new THREE.Vector3(3.7,.35,0):new THREE.Vector3(0,.35,3.7);
    direction.applyAxisAngle(new THREE.Vector3(0,1,0),state.yaw);
    camera.position.copy(controls.target).add(direction);previous.copy(position);controls.update();
  }
  function refresh() {
    get('lab-pitch').value=String(Math.round(state.pitch*180/Math.PI));
    get('lab-yaw').value=String(Math.round(state.yaw*180/Math.PI));
    get('lab-pitch-value').textContent=get('lab-pitch').value+'°';get('lab-yaw-value').textContent=get('lab-yaw').value+'°';
    get('lab-speed-value').textContent=speed.toFixed(1)+'×';
    get('lab-speed').value=String(speed);
    get('lab-play').textContent=playing?'Pause':'Play';
    get('lab-play').setAttribute('aria-pressed',String(playing));
    const statusText=playing?'Playing · synchronized':'Paused · frame inspection';
    if(get('lab-status').textContent!==statusText)get('lab-status').textContent=statusText;
    get('lab-status').dataset.paused=String(!playing);
    get('lab-clock').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(Math.floor(elapsed%60)).padStart(2,'0')+' · f'+Math.round(elapsed*60);
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
    get('lab-ground-speed').textContent=Math.hypot(...(diagnostics.velocity||[0,0])).toFixed(2)+' m/s';
    get('lab-cadence').textContent=Math.abs(diagnostics.rate||0).toFixed(2)+'×';
    get('lab-phase').textContent=Math.round(THREE.MathUtils.euclideanModulo(diagnostics.phase||0,1)*100)+'%';
    get('lab-grip').textContent=(1000*Math.max(d.rightError||0,d.leftError||0)).toFixed(1)+' mm';
    note.textContent=layout==='quad'?'Four synchronized views · Space: play / pause · →: step':layout==='player'?'Gameplay camera · Space: play / pause · →: step':'Orbit view · drag to rotate · scroll to zoom';
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
  function announce(message:string) {
    clearTimeout(toastTimer);toast.textContent=message;toast.hidden=false;
    toastTimer=setTimeout(()=>{toast.hidden=true;},3500);
  }
  function shareUrl() {
    const url=new URL(location.href);url.search='';url.hash='';
    const p=url.searchParams;p.set('animationLab','1');p.set('weapon',state.weapon);p.set('motion',state.motion);
    if(state.pitch)p.set('pitch',String(Math.round(state.pitch*180/Math.PI)));
    if(state.yaw)p.set('yaw',String(Math.round(state.yaw*180/Math.PI)));
    if(state.ads)p.set('ads','1');if(state.clip)p.set('clip',state.clip);
    if(speed!==1)p.set('rate',speed.toFixed(1));if(!playing)p.set('paused','1');
    if(layout!=='quad')p.set('layout',layout);if(!playerView)p.set('orbit','1');
    return url.href;
  }
  get('lab-share').addEventListener('click',async()=>{
    const url=shareUrl();
    try {await navigator.clipboard.writeText(url);announce('Lab link copied. Your motion and view settings are included.');}
    catch {history.replaceState(null,'',url);announce('Your setup is in the address bar. Copy the address to share it.');}
  });
  get('lab-save-frame').addEventListener('click',()=>{
    try {
      render();
      const rects=viewportRects(),size=renderer.getSize(new THREE.Vector2());
      const left=Math.min(...rects.map(r=>r.x)),bottom=Math.min(...rects.map(r=>r.y));
      const right=Math.max(...rects.map(r=>r.x+r.width)),top=Math.max(...rects.map(r=>r.y+r.height));
      const capture=document.createElement('canvas');capture.width=Math.round(right-left);capture.height=Math.round(top-bottom);
      const ctx=capture.getContext('2d');ctx.fillStyle='#182633';ctx.fillRect(0,0,capture.width,capture.height);
      ctx.drawImage(canvas,left*canvas.width/size.x,(size.y-top)*canvas.height/size.y,
        (right-left)*canvas.width/size.x,(top-bottom)*canvas.height/size.y,0,0,capture.width,capture.height);
      ctx.font='12px Segoe UI, sans-serif';
      rects.forEach((r,i)=>{
        const text=viewLabels[i].textContent,x=r.x-left+12,y=top-r.y-r.height+12;
        ctx.fillStyle='#101c28';ctx.fillRect(x,y,ctx.measureText(text).width+18,24);
        ctx.fillStyle='#deedf7';ctx.fillText(text,x+9,y+16);
      });
      const link=document.createElement('a');link.download=`unknw-${state.weapon}-${state.motion}-frame-${Math.round(elapsed*60)}.png`;
      link.href=capture.toDataURL('image/png');link.click();announce('Frame saved with all visible camera angles.');
    } catch {announce('Frame could not be saved. Try pausing playback and saving again.');}
  });
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
  addEventListener('keydown',event=>{
    const target=event.target as HTMLElement;
    if(event.ctrlKey||event.metaKey||event.altKey||target?.closest('input,select,textarea,button,a,summary,[contenteditable=true]'))return;
    if(event.code!=='Space'&&event.code!=='ArrowRight')return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.code==='Space'){if(!event.repeat){playing=!playing;refresh();}}
    else {playing=false;step();}
  },true);
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
    setPlaying:(value:boolean)=>{playing=value;refresh();},view,setLayout,getLayout:()=>layout,getShareUrl:shareUrl,
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
