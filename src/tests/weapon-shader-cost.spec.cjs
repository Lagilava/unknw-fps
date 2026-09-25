const { test, expect } = require('@playwright/test');

test('all nine gun finishes compile, render distinctly, and own their upgrade materials', async ({ page }) => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/finish-test',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto('http://127.0.0.1:8000/finish-test');
  await page.setContent('<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>');
  const result = await page.evaluate(async () => {
    const THREE=await import('three');
    const {createWeaponMaterials}=await import('/src/modules/weapon_materials');
    const {GUNS}=await import('/src/modules/gun_config');
    const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(900,600);document.body.append(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x101722);
    scene.add(new THREE.HemisphereLight(0xb8dfff,0x665544,3));
    const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(2,5,8);scene.add(light);
    const camera=new THREE.PerspectiveCamera(40,1.5,.1,100);camera.position.set(0,0,8);
    const finishes=Object.values(GUNS).map((type,i)=>{
      const mats=createWeaponMaterials(type,{value:1});
      const mesh=new THREE.Mesh(new THREE.TorusKnotGeometry(.37,.12,64,8),mats.bodyMat);
      mesh.position.set((i%3-1)*1.8,(1-Math.floor(i/3))*1.5,0);scene.add(mesh);
      return mats;
    });
    renderer.render(scene,camera);
    const first=finishes[0].bodyMat.emissive.getHex();finishes[1].bodyMat.emissive.setHex(0xff0000);
    const fallback=Object.values(GUNS).map(t=>createWeaponMaterials(t,{value:0},true).bodyMat.color.getHex());
    return {keys:new Set(finishes.map(m=>m.bodyMat.customProgramCacheKey())).size,colors:new Set(fallback).size,isolated:finishes[0].bodyMat.emissive.getHex()===first,programs:renderer.info.programs.length,runnable:renderer.info.programs.every(p=>p.diagnostics?.runnable!==false)};
  });
  expect(result.keys).toBe(9);expect(result.colors).toBe(9);expect(result.isolated).toBe(true);
  expect(result.programs).toBe(9);expect(result.runnable).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:'test-artifacts/weapon-finishes.png'});
});
