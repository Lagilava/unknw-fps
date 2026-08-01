// Converts assets/Pete.fbx (Mixamo cm-scale rig) into a GLB via FBX2glTF. Loading
// Pete's raw FBX directly through three's FBXLoader produced a mesh whose bind-pose
// scale (Box3 on mesh.matrixWorld) disagreed with its bone world scale — the mesh
// nodes carried a baked-in ~0.0092 cascade scale the bone hierarchy did not, so
// skinning diverged from the bind pose the moment an animation moved a bone away
// from rest, blowing vertices out to raw centimetre-scale positions (the "giant
// exploded" look). FBX2glTF bakes/normalizes scale during conversion the same way
// it already does for the zombie and black-mask player models, avoiding the bug.
//
//   node scripts/convert-pete.mjs
//
import convert from "fbx2gltf";
import { existsSync } from "fs";

const SRC = "assets/Pete.fbx";
const DST = "assets/Pete.glb";

if (!existsSync(SRC)) {
  console.error(`Source not found: ${SRC}`);
  process.exit(1);
}

console.log(`Converting ${SRC} → ${DST} …`);
convert(SRC, DST, ["--pbr-metallic-roughness", "--binary"])
  .then((dest) => { console.log("Done:", dest); })
  .catch((err) => { console.error("Conversion failed:", String(err).slice(0, 400)); process.exit(1); });
