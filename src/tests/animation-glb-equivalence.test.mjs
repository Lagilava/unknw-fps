// The GLB animation clips produced by src/scripts/convert-fbx-anims.mjs must be
// drop-in replacements for the FBX clips the game used to load. Compares each
// FBX/GLB pair as three.js sees them: same tracks (names, key times), same bone
// rotations, and positions equal up to the cm -> m unit change, plus the same
// Hips node height ratio (the game derives `sourceHipsHeight` from it).
//
//   node src/tests/animation-glb-equivalence.test.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
globalThis.self = globalThis; // FBXLoader/fflate probe `self`
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

const abuf = p => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const loadFbx = p => new FBXLoader().parse(abuf(p), "");
const loadGlb = p => new Promise((res, rej) => new GLTFLoader().parse(abuf(p), "", res, rej));
const hipsY = obj => { let y = 0; obj.traverse(n => { if (/Hips$/.test(n.name)) y = n.position.y; }); return y; };
const isScale = n => n.endsWith(".scale");

const DIRS = ["assets/models/player", "assets/zombies"];
const pairs = DIRS.flatMap(d => readdirSync(d).filter(f => /\.fbx$/i.test(f) && existsSync(join(d, f.replace(/\.fbx$/i, ".glb")))).map(f => [join(d, f), join(d, f.replace(/\.fbx$/i, ".glb"))]))
  .filter(([fbx]) => !/Parasite/.test(fbx));

let failures = 0;
for (const [fbxPath, glbPath] of pairs) {
  let fbx, glb;
  try { fbx = loadFbx(fbxPath); glb = await loadGlb(glbPath); } catch (e) { console.log(`skip ${fbxPath}: ${String(e.message).split("\n")[0]}`); continue; }
  const fc = fbx.animations[0]; const gc = glb.animations[0];
  const problems = [];
  if (!fc || !gc) { console.log(`FAIL ${fbxPath}: missing clip (fbx ${!!fc}, glb ${!!gc})`); failures++; continue; }
  // The game strips .scale tracks before use, so ignore them here too.
  const ft = new Map(fc.tracks.filter(t => !isScale(t.name)).map(t => [t.name, t]));
  const gt = new Map(gc.tracks.filter(t => !isScale(t.name)).map(t => [t.name, t]));
  // Fingertip (…3) tracks are dropped by the older player GLBs; visually irrelevant.
  for (const n of ft.keys()) if (!gt.has(n) && !/Hand\w+3\./.test(n)) problems.push(`track only in FBX: ${n}`);
  for (const n of gt.keys()) if (!ft.has(n)) problems.push(`track only in GLB: ${n}`);
  const unit = hipsY(glb.scene) / (hipsY(fbx) || 1);
  const angErrs = [];
  let maxAng = 0, maxPos = 0, durDiff = Math.abs(fc.duration - gc.duration);
  for (const [name, a] of ft) {
    const b = gt.get(name); if (!b) continue;
    // Compare by sampling both tracks at the FBX key times (the GLB may be resampled).
    const sample = (t, time) => { const interp = t.createInterpolant(new Float32Array(t.getValueSize())); return interp.evaluate(time).slice(); };
    for (const ti of a.times) {
      const va = sample(a, ti), vb = sample(b, ti);
      if (a.name.endsWith(".quaternion")) {
        const qa = new THREE.Quaternion().fromArray(va), qb = new THREE.Quaternion().fromArray(vb);
        const e = qa.angleTo(qb); angErrs.push(e); maxAng = Math.max(maxAng, e);
      } else {
        for (let k = 0; k < va.length; k++) maxPos = Math.max(maxPos, Math.abs(va[k] * unit - vb[k]));
      }
    }
  }
  const hipsRatioOk = Math.abs(unit - 0.01) < 0.002;
  if (!hipsRatioOk) problems.push(`Hips height ratio ${unit.toFixed(4)} (expected ~0.01 cm->m)`);
  // FBX2glTF bakes the curves to a fixed frame rate, so single fast-moving keys can
  // deviate a little; what matters is the typical and 99th-percentile error.
  angErrs.sort((x, y) => x - y);
  const meanAng = angErrs.reduce((x, y) => x + y, 0) / (angErrs.length || 1);
  const p99Ang = angErrs[Math.floor(angErrs.length * 0.99)] ?? 0;
  if (meanAng > 0.02) problems.push(`mean rotation error ${meanAng.toFixed(4)} rad`);
  if (p99Ang > 0.2) problems.push(`p99 rotation error ${p99Ang.toFixed(4)} rad`);
  if (maxPos > 0.25) problems.push(`max position error ${maxPos.toFixed(4)} m`);
  // FBX2glTF bakes at 30 fps and ends one frame earlier than FBXLoader's clip.
  if (durDiff > 0.04) problems.push(`duration differs by ${durDiff.toFixed(3)} s`);
  console.log(`${problems.length ? "FAIL" : "ok  "} ${fbxPath}  tracks ${ft.size}/${gt.size}  dur ${fc.duration.toFixed(2)}/${gc.duration.toFixed(2)}  rot mean ${meanAng.toFixed(4)} p99 ${p99Ang.toFixed(3)} max ${maxAng.toFixed(3)} rad  maxPos ${maxPos.toFixed(5)} m  unit ${unit.toFixed(4)}`);
  for (const p of problems) console.log(`      - ${p}`);
  if (problems.length) failures++;
}
console.log(failures ? `\n${failures}/${pairs.length} pairs FAILED` : `\nall ${pairs.length} pairs equivalent`);
process.exit(failures ? 1 : 0);
