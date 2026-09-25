const {test,expect}=require('@playwright/test');
test('construction shell renders textured dry surfaces without changing its wall grid',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/src/construction-preview',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>'}));
 await page.goto('http://127.0.0.1:8000/src/construction-preview');
 await page.addScriptTag({url:'/src/environment.js'});
 const report=await page.evaluate(async()=>{
  const THREE=await import('three'),env=window.RoomBreachEnvironment;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xc0c9cb);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,720);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xc5dcff,0x9b8261,2));const sun=new THREE.DirectionalLight(0xffedcf,3);sun.position.set(-18,30,20);scene.add(sun);
  const camera=new THREE.PerspectiveCamera(65,1280/720,.1,400);camera.position.set(10,2.5,36);camera.lookAt(-12,2,3);
  const loaded=new Promise(resolve=>{THREE.DefaultLoadingManager.onLoad=resolve;});
  const collision=[];env.buildLevel(THREE,scene,renderer,collision);await loaded;
  renderer.render(scene,camera);window.preview={scene,camera,renderer};
  const s=scene.userData.environmentSurfaces;
  const wallCells=env.MAP.join('').split('#').length-1;
  const removedWindows=env.MAP_W-4;
  return {count:s.walls.count+s.blockWalls.count,expected:wallCells-removedWindows,formwork:s.wallMat.name,block:s.blockMat.name,roughness:s.floorMat.roughness,metalness:s.floorMat.metalness,relief:!!s.wallMat.bumpMap,rebar:!!scene.getObjectByName('Construction / exposed reinforcement'),draws:renderer.info.render.calls};
 });
 expect(report.count).toBe(report.expected);expect(report.formwork).toContain('formwork');expect(report.block).toContain('block');expect(report.relief).toBe(true);expect(report.rebar).toBe(true);expect(report.roughness).toBeGreaterThan(.9);expect(report.metalness).toBe(0);expect(report.draws).toBeLessThan(250);
 await page.screenshot({path:'test-artifacts/construction-interior.png'});
 await page.evaluate(()=>{const {camera,scene,renderer}=window.preview;camera.position.set(24,3,90);camera.lookAt(10,2,66);renderer.render(scene,camera);});
 await page.screenshot({path:'test-artifacts/construction-blockwork.png'});
 expect(errors).toEqual([]);
});
