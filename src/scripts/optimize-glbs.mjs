// Shrinks the oversized GLBs in assets/ (textures dominate: 2048² PNGs).
//
//   node src/scripts/optimize-glbs.mjs            # optimise every target
//   node src/scripts/optimize-glbs.mjs --dry-run  # report only, write nothing
//   node src/scripts/optimize-glbs.mjs assets/tv_old_1960s.glb   # specific files
//
// What it does, per file: dedup + prune + (weld, quantize, meshopt for static
// meshes) and re-encodes textures to WebP, capped at 1024 px for props / 2048 px
// for the hero rigs listed in HERO.
//
// Skinned meshes (player, zombie) get textures + dedup/prune ONLY: position
// quantization on a skinned mesh would change the bind pose the animation
// retargeting (makeInPlaceClipForModel) was tuned against, and their geometry is
// a few KB anyway. prune keeps leaf nodes so name-based bone/socket lookups in
// the game still resolve.
//
// Originals: the first time a file is optimised its untouched original is copied
// to assets-src/<same relative path> (git-ignored, never copied into dist). Every
// run re-optimises FROM that original, so the script is idempotent and settings
// can be changed without generation loss.
//
// Loaders: meshopt-compressed output needs MeshoptDecoder on the GLTFLoader — see
// modules/three_loaders.ts (configured loader) and exterior_map.js.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, weld, quantize, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ASSETS = resolve("assets");
const BACKUP = resolve("assets-src");
const MIN_BYTES = 2 * 1024 * 1024; // sweep: every GLB at/over this size
const PROP_MAX = 1024;
const HERO_MAX = 2048;
// Relative to assets/, forward slashes. Heroes keep up to 2048 px.
const HERO = new Set([
  "Pete.glb",
  "zombies/parasite_zombie.glb",
  "models/character.glb",
  "models/player/black mask.glb",
  "world/landmark-statue.glb",
]);
// Always processed even if under MIN_BYTES.
const EXTRA = [];

const dryRun = process.argv.includes("--dry-run");
const explicit = process.argv.slice(2).filter(a => !a.startsWith("--"));

const rel = p => relative(ASSETS, p).split(sep).join("/");

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".glb")) yield p;
  }
}

function targets() {
  if (explicit.length) return explicit.map(f => resolve(f));
  const out = new Set(EXTRA.map(f => join(ASSETS, f)));
  for (const p of walk(ASSETS)) {
    // The backup of an earlier run may be the larger file; judge by the original.
    const orig = join(BACKUP, rel(p));
    const size = statSync(existsSync(orig) ? orig : p).size;
    if (size >= MIN_BYTES) out.add(p);
  }
  return [...out].sort();
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

// Some shipped textures have JPEG data gltf-transform's strict size parser
// rejects (Pete.glb). Re-encode those through sharp (which is tolerant) first.
async function repairUnreadableTextures(doc) {
  let n = 0;
  for (const tex of doc.getRoot().listTextures()) {
    try { tex.getSize(); } catch {
      const png = await sharp(Buffer.from(tex.getImage())).png().toBuffer();
      tex.setImage(new Uint8Array(png)).setMimeType("image/png");
      n++;
    }
  }
  return n;
}

// Textures under this many pixels are left byte-for-byte alone: they are palettes /
// lookup strips (tree.glb's 256x1 colour ramp), where lossy WebP chroma
// subsampling visibly shifts the colours and the saving is a few hundred bytes.
const MIN_TEXTURE_PIXELS = 128 * 128;

// Re-encodes every sizeable texture to WebP, downscaled to fit maxSize. Normal
// maps get a near-lossless quality; everything else is 85.
async function compressTextures(doc, maxSize) {
  const normals = new Set(doc.getRoot().listMaterials().map(m => m.getNormalTexture()).filter(Boolean));
  let converted = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const [w, h] = tex.getSize();
    if (w * h < MIN_TEXTURE_PIXELS) continue;
    let img = sharp(Buffer.from(tex.getImage()));
    if (Math.max(w, h) > maxSize) img = img.resize(maxSize, maxSize, { fit: "inside" });
    const out = await img.webp({ quality: normals.has(tex) ? 95 : 85, effort: 5 }).toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
    converted++;
  }
  if (converted) doc.createExtension(EXTTextureWebP).setRequired(true);
  return converted;
}

const MB = n => (n / 1048576).toFixed(2) + " MB";
const rows = [];

for (const file of targets()) {
  if (!existsSync(file)) { console.error(`missing ${file}`); process.exitCode = 1; continue; }
  const key = rel(file);
  const backup = join(BACKUP, key);
  const source = existsSync(backup) ? backup : file;
  const before = statSync(source).size;
  const hero = HERO.has(key);
  const maxSize = hero ? HERO_MAX : PROP_MAX;

  const doc = await io.read(source);
  const root = doc.getRoot();
  const skinned = root.listSkins().length > 0;
  const repaired = await repairUnreadableTextures(doc);

  const steps = [dedup(), prune({ keepLeaves: true })];
  if (!skinned) steps.push(weld(), quantize(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await doc.transform(...steps);
  await compressTextures(doc, maxSize);

  let after = before;
  if (!dryRun) {
    if (!existsSync(backup)) {
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(file, backup);
    }
    await io.write(file, doc);
    after = statSync(file).size;
  } else {
    after = (await io.writeBinary(doc)).byteLength;
  }
  rows.push({ key, before, after, hero, skinned, repaired });
  console.log(`${key}: ${MB(before)} -> ${MB(after)} (${(100 * (1 - after / before)).toFixed(0)}% smaller)${skinned ? " [skinned: textures only]" : ""}${hero ? " [hero 2048]" : ""}`);
}

const tb = rows.reduce((s, r) => s + r.before, 0);
const ta = rows.reduce((s, r) => s + r.after, 0);
console.log(`\n${rows.length} files: ${MB(tb)} -> ${MB(ta)}${dryRun ? " (dry run, nothing written)" : ""}`);
