const {test} = require('node:test');
const assert = require('node:assert/strict');
const {transformSync} = require('esbuild');
const fs = require('node:fs');
const vm = require('node:vm');
const mod={exports:{}};
vm.runInNewContext(transformSync(fs.readFileSync('src/modules/gameplay_pacing.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module:mod,exports:mod.exports});
const {simulationFrame,RELAY_UPLOAD_SECONDS}=mod.exports;
test('upload and simulation retain wall time across 10–144 FPS',()=>{
  for(const fps of [10,20,30,40,60,144]) {
    let elapsed=0;
    for(let frame=0;frame<fps*7;frame++) {
      const {steps,dt}=simulationFrame(1/fps);
      assert.ok(dt<=.025 && steps<=4);
      elapsed+=steps*dt;
    }
    assert.ok(Math.abs(elapsed-RELAY_UPLOAD_SECONDS)<1e-8);
  }
});
test('tab stalls, invalid and backwards clocks cannot produce catch-up bursts',()=>{
  for(const raw of [5,Infinity,NaN,-1]) {
    const {steps,dt}=simulationFrame(raw);
    assert.ok(steps>=1 && steps<=4 && dt>=0 && dt<=.025);
    assert.ok(steps*dt<=.1);
  }
});
