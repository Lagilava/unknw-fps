// Converts the Mixamo pistol animation FBXs into animation-only GLBs.
//
// Each Mixamo download embeds the full "Ch16" character (7 skinned meshes + 4K
// textures), so every 13-frame clip weighed ~52 MB and the game downloaded
// ~258 MB just for five pistol motions. The game only uses the clip's bone
// rotations (makeInPlaceClipForModel binds them onto Pete's skeleton), so this
// keeps the skeleton nodes + animation and drops everything else — the same
// shape as the existing assets/models/player/*.glb animation files.
//
//   node src/scripts/convert-pistol-anims.mjs
//
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { prune, dedup } from "@gltf-transform/functions";

const DIR = "assets/Pistol Animations";
const CLIPS = ["Pistol Run", "Pistol Strafe", "Pistol Jump", "Grabbing Pistol", "Fallen Idle"];
const binDir = { linux: "Linux", darwin: "Darwin", win32: "Windows_NT" }[platform()];
const FBX2GLTF = resolve("node_modules/fbx2gltf/bin", binDir, platform() === "win32" ? "FBX2glTF.exe" : "FBX2glTF");

const io = new NodeIO();
const tmp = mkdtempSync(join(tmpdir(), "pistol-anims-"));
try {
  for (const name of CLIPS) {
    const src = join(DIR, `${name}.fbx`);
    const dst = join(DIR, `${name}.glb`);
    if (!existsSync(src)) { console.error(`missing ${src}`); process.exitCode = 1; continue; }
    const raw = join(tmp, name.replace(/\s+/g, "_"));
    execFileSync(FBX2GLTF, ["--binary", "-i", src, "-o", raw], { stdio: "ignore" });
    // FBX2glTF extracts the embedded textures into a .fbm folder beside the source.
    rmSync(join(DIR, `${name}.fbm`), { recursive: true, force: true });

    const doc = await io.read(`${raw}.glb`);
    const root = doc.getRoot();
    // Detach and drop every mesh/skin; the bone nodes and the animation stay.
    for (const node of root.listNodes()) { node.setMesh(null); node.setSkin(null); }
    for (const p of [...root.listSkins(), ...root.listMeshes(), ...root.listMaterials(), ...root.listTextures()]) p.dispose();
    await doc.transform(prune(), dedup());
    if (!root.listAnimations().length) throw new Error(`${name}: no animation survived`);
    await io.write(dst, doc);
    console.log(`${name}: ${(statSync(src).size / 1048576).toFixed(1)} MB → ${(statSync(dst).size / 1024).toFixed(0)} KB`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
