const {test,expect}=require('@playwright/test');
test('ability FX render, stay bounded, and expire',async({page})=>{
 await page.goto('http://127.0.0.1:8000/');
 await page.setContent('<style>body{margin:0;background:#07121e;color:#d4ecff;font:14px monospace}header{display:flex;justify-content:space-around;padding:18px}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script><header><span>LIGHTNING IMPACT</span><span>NULL FIELD</span><span>BLINK ARRIVAL</span></header>');
 const report=await page.evaluate(async()=>{
  const THREE=await import('three');const {createBoltCore,createAbilityImpacts}=await import('/modules/ability_fx');
  const scene=new THREE.Scene();scene.background=new THREE.Color('#07121e');
  const camera=new THREE.PerspectiveCamera(45,1280/600,.1,100);camera.position.set(0,7,18);camera.lookAt(0,1,0);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,600);document.body.append(renderer.domElement);
  const grid=new THREE.GridHelper(30,30,0x254359,0x112c40);scene.add(grid);
  const fx=createAbilityImpacts(THREE,scene,6);
  fx.spawn(-5,.1,0,0x8bdfff,2.5);fx.spawn(0,.1,0,0x62ffd6,4.4,'emp');fx.spawn(5,.1,0,0xbc8cff,2,'blink');fx.update(.12);
  const bolt=createBoltCore(THREE,6,0xe6fbff),path=new Float32Array([-5,6,0,-4.5,4.8,0,-4.5,4.8,0,-5.3,3.7,0,-5.3,3.7,0,-4.8,2.4,0,-4.8,2.4,0,-5,.1,0]);
  bolt.update(path,4,camera.position,.09);scene.add(bolt.mesh);renderer.render(scene,camera);
  window.fx=fx;
  return {vertices:bolt.mesh.geometry.drawRange.count,finite:Array.from(bolt.mesh.geometry.attributes.position.array).every(Number.isFinite),active:fx.activeCount};
 });
 expect(report).toEqual({vertices:24,finite:true,active:3});
 await page.screenshot({path:'test-artifacts/ability-effects.png'});
 expect(await page.evaluate(()=>{for(let i=0;i<100;i++)window.fx.spawn(0,0,0,0xffffff);return window.fx.activeCount;})).toBe(6);
 expect(await page.evaluate(()=>{window.fx.update(1);return window.fx.activeCount;})).toBe(0);
 expect(await page.evaluate(()=>{window.fx.spawn(0,0,0,0xffffff);window.fx.clear();return window.fx.activeCount;})).toBe(0);
});
