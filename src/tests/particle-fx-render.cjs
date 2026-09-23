const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
 const page = await browser.newPage({viewport:{width:1280,height:840},deviceScaleFactor:1});
 const errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 page.on('console', m=>{if(m.type()==='error') errors.push(m.text());});
 await page.goto('http://127.0.0.1:3000/modules/particle_fx.ts');
 const result=await page.evaluate(async()=>{
   const THREE=await import('/node_modules/three/build/three.module.js');
   const {createParticleFX}=await import('/modules/particle_fx.ts');
   document.body.innerHTML='';
   document.body.style.cssText='margin:0;background:#111923;color:#b7d0e1;font:14px system-ui';
   const title=document.createElement('div'); title.textContent='ENEMY IMPACTS  /  40ms · 160ms · 350ms'; title.style.cssText='padding:20px;letter-spacing:3px'; document.body.appendChild(title);
   const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(1280,720); document.body.appendChild(renderer.domElement);
   renderer.setScissorTest(true);
   const results=[];
   for (const [col,kind] of ['enemyArmorHit','enemyDeathMetal','bulletFlesh','enemyDeath'].entries()) {
     const label=document.createElement('div'); label.textContent=kind; label.style.cssText=`position:absolute;top:64px;left:${col*320+18}px`; document.body.appendChild(label);
     for (const [row,time] of [.04,.16,.35].entries()) {
       const scene=new THREE.Scene(); scene.background=new THREE.Color(0x111b28);
       const camera=new THREE.PerspectiveCamera(48,320/240,.1,100); camera.position.set(0,1,4.5);
       const fx=createParticleFX(THREE,scene,{viewportHeight:()=>240});
       let seed=91; const random=Math.random; Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
       fx.emit(kind,{x:0,y:1,z:0},{x:0,y:.15,z:1}); Math.random=random;
       let elapsed=0; while(elapsed<time) {const step=Math.min(1/120,time-elapsed); fx.update(step); elapsed+=step;}
       renderer.setViewport(col*320,(2-row)*240,320,240);renderer.setScissor(col*320,(2-row)*240,320,240);
       renderer.render(scene,camera);
       results.push({kind,time,calls:renderer.info.render.calls,live:fx.count(),programs:renderer.info.programs.map(p=>p.diagnostics?.runnable ?? true)});
       fx.dispose();
     }
   }
   return results;
 });
 await page.screenshot({path:'.tools/particle-fx-preview.png'});
 console.log(JSON.stringify({result,errors}));
 if(errors.length || result.some(r=>r.calls>2 || r.programs.includes(false))) process.exitCode=1;
 } finally { await browser.close(); }
})();
