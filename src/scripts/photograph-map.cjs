// Real WebGL screenshots of the map builders, with disk-backed browser requests.
// No localhost connection or running game server is needed.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { transformSync } = require('esbuild');
const game = process.argv.includes('--game');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'docs/screenshots/photoreal', game ? 'game' : '');
(async () => {
  await fs.mkdir(output, { recursive:true });
  console.log('Launching map photography browser');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', timeout:30000,
    headless:true, args:['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
    page.on('console',msg=>{if(msg.type()==='error') {errors.push(msg.text());console.error(msg.text());}});
    await page.route('**/*', async route => {
      const url=new URL(route.request().url());
      let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(root+path.sep)) return route.abort();
      try {
        try { await fs.access(file); } catch {
          const ext=path.extname(file);
          for(const candidate of ext ? [file.slice(0,-ext.length)+'.ts'] : [file+'.ts',file+'.js',file+'.mjs']) {
            try {await fs.access(candidate);file=candidate;break;}catch{}
          }
        }
        let body=await fs.readFile(file);
        if(path.extname(file)==='.ts')body=Buffer.from(transformSync(body.toString(),{loader:'ts',format:'esm',target:'esnext'}).code);
        const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json',
          '.ts':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream';
        await route.fulfill({status:200,contentType:type,body});
      } catch(error) { console.error(`Missing ${url.pathname}: ${error.code}`);errors.push(`Missing ${url.pathname}: ${error.code}`);await route.fulfill({status:404,body:'Not found'}); }
    });
    await page.goto(game ? 'http://map-preview/src/first_person_shooter_room_game%20(1).html?test=1' : 'http://map-preview/src/map_photo.html');
    console.log('Map review page opened');
    if(game) {
      await page.waitForFunction(()=>document.body.dataset.rbReady==='1',null,{timeout:240000});
      await page.locator('#startBtn').click();
      await page.waitForFunction(()=>window.__rbTest?.getState()==='playing',null,{timeout:60000});
      await page.evaluate(()=>window.__rbTest.setUnlimitedHealth(true));
      await page.addStyleTag({content:'body > :not(canvas):not(script):not(style){visibility:hidden!important}'});
      for(const [name,x,z,yaw,pitch] of [
        ['street',20,149,-Math.PI/2,-.03],['construction',10,36,.7,-.03],['blockwork',24,90,.9,0],
      ]) {
        await page.evaluate(({x,z,yaw,pitch})=>window.__rbTest.tpTo(x,z,yaw,pitch),{x,z,yaw,pitch});
        await page.waitForTimeout(500);
        await page.screenshot({path:path.join(output,name+'.png')});
        console.log('Photographed game '+name);
      }
      await fs.writeFile(path.join(output,'validation.json'),JSON.stringify({errors},null,2)+'\n');
      if(errors.length)throw Error('Game rendering produced errors; see validation.json');
      return;
    }
    await page.waitForFunction(()=>document.body.dataset.ready==='1',null,{timeout:180000});
    // LoadingManager can finish before the last HDR decode. Wait until every scan
    // is decoded, so screenshots cannot silently capture empty white materials.
    await page.waitForFunction(()=>{
      let ready=true;window.mapPhoto.scene.traverse(o=>{
        for(const m of Array.isArray(o.material)?o.material:[o.material]) {
          if(!m?.userData.photographicSurface)continue;
          for(const key of ['map','normalMap','roughnessMap'])if(!m[key]?.image?.width)ready=false;
        }
      });return ready;
    },null,{timeout:120000});
    await page.evaluate(()=>document.body.classList.add('clean'));
    const report=await page.evaluate(()=>{
      const {scene,renderer}=window.mapPhoto;const surfaces=[];const seen=new Set();
      scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]) {
        if(!m?.userData.photographicSurface||seen.has(m))continue;seen.add(m);
        surfaces.push({name:m.name,set:m.userData.photographicSurface,colorSpace:m.map.colorSpace,
          dataSpace:m.normalMap.colorSpace,normalSize:m.normalMap.image.width,
          packed:m.aoMap===m.roughnessMap});
      }});
      return {surfaces,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures};
    });
    for(const view of ['Street','Brickwork','Paving','Construction','Blockwork','District']) {
      await page.evaluate(name=>window.mapPhoto.view(name),view);
      await page.screenshot({path:path.join(output,view.toLowerCase()+'.png')});
      console.log('Photographed '+view);
    }
    report.errors=errors;
    await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
    if(errors.length)throw Error('Map rendering produced errors; see validation.json');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
