const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const compiled = transformSync(fs.readFileSync('modules/encounter_director.ts','utf8'), {loader:'ts',format:'cjs'}).code;
const mod = {exports:{}}; vm.runInNewContext(compiled, {module:mod,exports:mod.exports});
const enemy = (x, aggroed=false) => ({alive:true,aggroed,mesh:{position:{x,z:0}}});
function tick(d, seconds, key, enemies) { let result=[]; for(let i=0;i<seconds*10;i++){const push=d(.1,key,enemies,0,0);if(push.length)result=push;}return result; }
test('small pushes start after a grace period and respect nearby combat pressure',()=>{
 const d=mod.exports.createEncounterDirector(), enemies=[enemy(8),enemy(12),enemy(35),enemy(45)];
 assert.equal(tick(d,3,'wave1',enemies).length,0);
 assert.equal(tick(d,2,'wave1',enemies).length,2);
 enemies[0].aggroed=true; enemies[1].aggroed=true; enemies.push(enemy(15,true));
 assert.equal(tick(d,8,'wave1',enemies).length,0);
 assert.equal(tick(d,3,'wave2',enemies).length,0);
});
test('final stragglers close in even when already alerted and dead enemies are ignored',()=>{
 const d=mod.exports.createEncounterDirector(), enemies=[enemy(55,true),enemy(70,true),{...enemy(80),alive:false}];
 assert.equal(tick(d,12,'wave1',enemies).length,2);
});
