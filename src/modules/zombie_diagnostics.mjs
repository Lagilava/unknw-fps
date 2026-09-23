// Headless test/debug harness for the Zombie enemy integration.
//
// Loads the converted base mesh (GLB) + the Mixamo animation clips (FBX) with NO
// renderer, then validates everything the in-game code depends on:
//   * the GLB has a skinned mesh + a usable skeleton
//   * each animation clip's tracks bind to bones that exist on the base skeleton
//   * the "bite" family is excluded and the rest are present
//   * an AnimationMixer can crossfade between states without NaNs
//   * the procedural turn-lean stays in sane ranges
//
//   node modules/zombie_diagnostics.mjs
//
import * as THREE from "three";
global.self = global; // FBXLoader/fflate probe `self`
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
import { readFileSync } from "fs";

import {
  ZOMBIE_MODEL_GLB_PATH, ZOMBIE_ANIMATION_PATHS, ZOMBIE_EXCLUDED_ANIMATIONS,
} from "./zombie_assets.js";

const abuf = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const _v = new THREE.Vector3(); // scratch for world-position sampling

// ── Load base mesh ───────────────────────────────────────────────────────────
function loadGLB(path) {
  return new Promise((res, rej) => {
    new GLTFLoader().parse(abuf(path), "", (g) => res(g), (e) => rej(e));
  });
}
const gltf = await loadGLB(ZOMBIE_MODEL_GLB_PATH);
const model = gltf.scene;

let skinned = 0, bones = [], tris = 0, skinnedMesh = null;
model.traverse((o) => {
  if (o.isSkinnedMesh) { skinned++; skinnedMesh = o; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; }
  if (o.isBone) bones.push(o.name);
});
const boneSet = new Set(bones);
const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());

console.log("══ Zombie base mesh (GLB) ══");
console.log(`  skinnedMeshes=${skinned}  bones=${bones.length}  tris~${Math.round(tris)}  size=${size.x.toFixed(1)}/${size.y.toFixed(1)}/${size.z.toFixed(1)}`);
console.log(`  baked animations: ${gltf.animations.length}`);
let flags = [];
if (!skinned) flags.push("❌ no skinned mesh in GLB");
if (!boneSet.has("mixamorigHips")) flags.push("❌ missing mixamorigHips bone");

// ── Load animation clips (FBX) ───────────────────────────────────────────────
function loadFBXClip(path) {
  const obj = new FBXLoader().parse(abuf(path), "");
  return obj.animations[0] || null;
}

// Mixamo FBX tracks are named "<bone>.position/.quaternion". The retarget step the
// game uses strips the "mixamorig" prefix sometimes; check raw names map to bones.
function trackBoneName(trackName) { return trackName.split(".")[0]; }

console.log("\n══ Animation clips ══");
const clips = {};
let totalUnbound = 0;
for (const [key, path] of Object.entries(ZOMBIE_ANIMATION_PATHS)) {
  let clip;
  try { clip = loadFBXClip(path); } catch (e) { flags.push(`❌ ${key}: parse failed ${e.message.slice(0, 40)}`); continue; }
  if (!clip) { flags.push(`❌ ${key}: no clip`); continue; }
  clips[key] = clip;
  // how many tracks bind to a bone that exists on the base skeleton?
  let bound = 0, unbound = 0, badNum = 0;
  for (const t of clip.tracks) {
    const bn = trackBoneName(t.name);
    if (boneSet.has(bn)) bound++; else unbound++;
    if (t.values.some((v) => !Number.isFinite(v))) badNum++;
  }
  totalUnbound += unbound;
  const pct = ((bound / clip.tracks.length) * 100).toFixed(0);
  console.log(`  ${key.padEnd(12)} dur=${clip.duration.toFixed(2)}s tracks=${clip.tracks.length} bound=${bound}(${pct}%) unbound=${unbound}${badNum ? ` ❌NaN=${badNum}` : ""}`);
  if (bound === 0) flags.push(`❌ ${key}: NO tracks bind to the base skeleton`);
  if (badNum) flags.push(`❌ ${key}: ${badNum} tracks contain NaN`);
}

// ── Excluded set check ───────────────────────────────────────────────────────
console.log("\n══ Bite exclusion ══");
const present = new Set(Object.keys(ZOMBIE_ANIMATION_PATHS).map((k) => k.toLowerCase()));
const leakedBites = [...present].filter((k) => /bite|biting/.test(k));
console.log(`  included: ${Object.keys(ZOMBIE_ANIMATION_PATHS).join(", ")}`);
console.log(`  excluded: ${ZOMBIE_EXCLUDED_ANIMATIONS.join(", ")}`);
if (leakedBites.length) flags.push(`❌ bite animation leaked into included set: ${leakedBites.join(", ")}`);

// ── Mixer crossfade smoke test ───────────────────────────────────────────────
console.log("\n══ Mixer crossfade (idle→walk→run→attack→idle) ══");
const mixer = new THREE.AnimationMixer(model);
const actionFor = (k) => clips[k] ? mixer.clipAction(clips[k]) : null;
const seq = ["idle", "walk", "run", "attack", "idle"].filter((k) => clips[k]);
let active = actionFor(seq[0]); if (active) { active.play(); }
let nan = 0, hipPosSeen = false;
const hip = model.getObjectByName("mixamorigHips");
for (let s = 0; s < seq.length; s++) {
  const next = actionFor(seq[s]);
  if (next && next !== active) { next.reset().fadeIn(0.2).play(); active?.fadeOut(0.2); active = next; }
  for (let i = 0; i < 60; i++) {
    mixer.update(1 / 60);
    model.updateMatrixWorld(true);
    if (hip) { hip.getWorldPosition(_v); if (!Number.isFinite(_v.x + _v.y + _v.z)) nan++; else hipPosSeen = true; }
  }
}
console.log(`  ran ${seq.length} states × 60 frames, hip NaN frames=${nan}, hip animated=${hipPosSeen}`);
if (nan) flags.push(`❌ mixer produced ${nan} NaN hip frames`);

// ── Factory behaviour test: createZombieCharacter through real scenarios ──────
console.log("\n══ Zombie factory (createZombieCharacter) ══");
const { clone: skeletonClone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
const { createZombieCharacter } = await import("./zombie_character.js");

const z = createZombieCharacter(THREE, model, clips, skeletonClone, { targetHeight: 1.8 });
console.log(`  built: height target 1.80 → scale ${z.scale.toFixed(3)}, visualSize ${z.visualSize.y.toFixed(2)}`);

// scenario script: idle → aggro(scream) → walk → run(turning) → attack → death
const scenarios = [
  { t: 0.6,  e: { alive: true, aggroed: false, visualSpeed: 0,   visualTurn: 0,   isAttacking: false } },
  { t: 0.6,  e: { alive: true, aggroed: true,  visualSpeed: 0,   visualTurn: 0,   isAttacking: false } }, // scream
  { t: 3.4,  e: { alive: true, aggroed: true,  visualSpeed: 1.6, visualTurn: 0.4, isAttacking: false } }, // walk (past scream lock)
  { t: 1.5,  e: { alive: true, aggroed: true,  visualSpeed: 3.6, visualTurn: 2.2, isAttacking: false } }, // run+turn
  { t: 0.8,  e: { alive: true, aggroed: true,  visualSpeed: 0.2, visualTurn: 0,   isAttacking: true  } }, // attack
  { t: 1.5,  e: { alive: false, aggroed: true, visualSpeed: 0,   visualTurn: 0,   isAttacking: false } }, // death
];
const hipB = z.model.getObjectByName("mixamorigHips");
let zNaN = 0, statesSeen = new Set(), leanMax = 0, leadMax = 0, hunchMax = 0;
const wp = new THREE.Vector3();
for (const sc of scenarios) {
  const frames = Math.round(sc.t * 60);
  for (let i = 0; i < frames; i++) {
    z.update(1 / 60, sc.e);
    z.root.updateMatrixWorld(true);
    const d = z._diag(); statesSeen.add(d.activeName);
    leanMax = Math.max(leanMax, Math.abs(d.leanTurn)); leadMax = Math.max(leadMax, Math.abs(d.leadTurn)); hunchMax = Math.max(hunchMax, Math.abs(d.hunch));
    if (hipB) { hipB.getWorldPosition(wp); if (!Number.isFinite(wp.x + wp.y + wp.z)) zNaN++; }
    // NaN scan on a few skinned-mesh bones
    z.model.traverse((o) => { if (o.isBone) { const q = o.quaternion; if (!Number.isFinite(q.x + q.y + q.z + q.w)) zNaN++; } });
  }
}
console.log(`  states exercised: ${[...statesSeen].join(", ")}`);
console.log(`  turn-lean ranges: bank=${leanMax.toFixed(3)} headLead=${leadMax.toFixed(3)} hunch=${hunchMax.toFixed(3)} rad`);
console.log(`  bone NaN count: ${zNaN}`);
if (zNaN) flags.push(`❌ factory produced ${zNaN} NaN bone/hip values`);
const wantStates = ["idle", "scream", "walk", "run", "attack", "death"];
const missing = wantStates.filter((s) => !statesSeen.has(s));
if (missing.length) flags.push(`❌ states never reached: ${missing.join(", ")}`);
if (leanMax < 0.02 || leadMax < 0.02) flags.push("⚠ procedural turn lean/lead barely moved — turning may still read robotic");
z.dispose();

console.log("\n" + (flags.length ? "FLAGS:\n  " + flags.join("\n  ") : "✓ all zombie asset + factory checks passed"));
process.exit(flags.length ? 1 : 0);
