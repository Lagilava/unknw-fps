// Converts the Mixamo animation FBXs that have no GLB yet (player + zombie
// locomotion/combat clips) into animation-only GLBs next to the source file, so
// the game can load them GLB-first like the rest (asset_paths.ts,
// zombie_assets.ts). The FBX stays in the repo as the fallback/source.
//
//   node src/scripts/convert-fbx-anims.mjs                 # every FBX that lacks a sibling GLB
//   node src/scripts/convert-fbx-anims.mjs "assets/zombies/zombie idle.fbx"
//
// Same recipe as convert-pistol-anims.mjs: FBX2glTF, then drop meshes/skins/
// materials/textures and keep the skeleton nodes + animation. The game only reads
// the clip's bone tracks (makeInPlaceClipForModel binds them onto the target
// skeleton), and hips height comes from the clip's own scene, so unit changes
// (FBX centimetres -> glTF metres) are handled the same way as the existing player GLBs.
//
// Skipped on purpose: "Parasite L Starkie.fbx" (the zombie BASE MESH — already
// converted to parasite_zombie.glb by convert-zombie.mjs, never requested at runtime).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, existsSync, readdirSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, resolve, basename } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { prune, dedup } from "@gltf-transform/functions";

const DIRS = ["assets/models/player", "assets/zombies"];
const SKIP = new Set(["Parasite L Starkie.fbx"]);
const binDir = { linux: "Linux", darwin: "Darwin", win32: "Windows_NT" }[platform()];
const FBX2GLTF = resolve("node_modules/fbx2gltf/bin", binDir, platform() === "win32" ? "FBX2glTF.exe" : "FBX2glTF");

const args = process.argv.slice(2);
const sources = args.length
  ? args
  : DIRS.flatMap(d => readdirSync(d)
      .filter(f => /\.fbx$/i.test(f) && !SKIP.has(f) && !existsSync(join(d, f.replace(/\.fbx$/i, ".glb"))))
      .map(f => join(d, f)));

const io = new NodeIO();
const tmp = mkdtempSync(join(tmpdir(), "fbx-anims-"));
try {
  for (const src of sources) {
    const dst = src.replace(/\.fbx$/i, ".glb");
    const raw = join(tmp, basename(src).replace(/\W+/g, "_"));
    execFileSync(FBX2GLTF, ["--binary", "-i", src, "-o", raw], { stdio: "ignore" });
    // FBX2glTF may extract embedded textures into a .fbm folder beside the source.
    rmSync(src.replace(/\.fbx$/i, ".fbm"), { recursive: true, force: true });

    const doc = await io.read(`${raw}.glb`);
    const root = doc.getRoot();
    for (const node of root.listNodes()) { node.setMesh(null); node.setSkin(null); }
    for (const p of [...root.listSkins(), ...root.listMeshes(), ...root.listMaterials(), ...root.listTextures()]) p.dispose();
    await doc.transform(prune({ keepLeaves: true }), dedup());
    if (!root.listAnimations().length) throw new Error(`${src}: no animation survived`);
    await io.write(dst, doc);
    console.log(`${src}: ${(statSync(src).size / 1024).toFixed(0)} KB -> ${(statSync(dst).size / 1024).toFixed(0)} KB`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
