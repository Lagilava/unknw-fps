import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { inPlacePelvisTrack } from '../modules/weapon_locomotion.ts';

test('pelvis retarget keeps captured weight transfer while removing world travel',()=>{
 const times=Array.from({length:61},(_,i)=>i/60),values=[];
 for(const t of times)values.push(.03*Math.sin(t*Math.PI*2),.99+.025*Math.cos(t*Math.PI*4),4*t+.01*Math.sin(t*Math.PI*2));
 const source=new THREE.VectorKeyframeTrack('mixamorigHips.position',times,values);
 const rest=new THREE.Vector3(0,.95,.01),track=inPlacePelvisTrack(source,rest,1.14,1);
 // The knees are bent in a running frame: anchoring that frame at bind height
 // would incorrectly raise the entire body. Absolute source bind height matters.
 assert.ok(track.values[1]<.86 && track.values[1]>.83);
 const ranges=[0,1,2].map(axis=>{
  const data=Array.from(track.values).filter((_,i)=>i%3===axis);
  return Math.max(...data)-Math.min(...data);
 });
 assert.ok(ranges[0]>.045 && ranges[0]<.055);
 assert.ok(ranges[1]>.04 && ranges[1]<.045);
 assert.ok(ranges[2]<.02,'four metres of forward root travel removed');
 for(let axis=0;axis<3;axis++)assert.ok(Math.abs(track.values[axis]-track.values.at(-3+axis))<1e-6,'continuous loop');
 assert.deepEqual(Array.from(source.values),Array.from(new Float32Array(values)),'source data retained');
});

test('centimetre FBX and metre GLB hips retarget to the same character',()=>{
 const rest=new THREE.Vector3(0,.95,0),times=[0,.25,.5,.75,1];
 const values=[0,1,0,.03,.97,1,0,1.02,2,-.03,.97,3,0,1,4];
 const metres=inPlacePelvisTrack(new THREE.VectorKeyframeTrack('Hips.position',times,values),rest,1.14,1);
 const centimetres=inPlacePelvisTrack(new THREE.VectorKeyframeTrack('Hips.position',times,values.map(v=>v*100)),rest,114,1);
 metres.values.forEach((v,i)=>assert.ok(Math.abs(v-centimetres.values[i])<1e-6));
});
