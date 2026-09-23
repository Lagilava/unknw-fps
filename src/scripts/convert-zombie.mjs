// Converts the legacy zombie base mesh (FBX 6100, which three's FBXLoader cannot
// read) into a GLB that loads in-engine. The Mixamo animation FBX files are 7.x and
// load directly, so only the base mesh needs converting.
//
//   node scripts/convert-zombie.mjs
//
import convert from "fbx2gltf";
import { existsSync } from "fs";

const SRC = "assets/zombies/Parasite L Starkie.fbx";
const DST = "assets/zombies/parasite_zombie.glb";

if (!existsSync(SRC)) {
  console.error(`Source not found: ${SRC}`);
  process.exit(1);
}

console.log(`Converting ${SRC} → ${DST} …`);
convert(SRC, DST, ["--pbr-metallic-roughness", "--binary"])
  .then((dest) => { console.log("Done:", dest); })
  .catch((err) => { console.error("Conversion failed:", String(err).slice(0, 400)); process.exit(1); });
