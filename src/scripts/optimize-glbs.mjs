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
// DECIMATE: a few heavy static props (ferrari, tree) are also simplified to a triangle budget.
//
// Loaders: meshopt-compressed output needs MeshoptDecoder on the GLTFLoader — see
// modules/three_loaders.ts (configured loader) and exterior_map.js.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, prune, weld, quantize, meshopt, flatten, join as joinMeshes } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
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
// ferrari.glb is under the size sweep but is Draco-compressed and the game has no DRACOLoader,
// so it never rendered; decoding it and re-encoding as meshopt makes it loadable.
const EXTRA = ["models/ferrari.glb"];

// Triangle budgets, relative to assets/. `join` merges meshes that share a material
// (one mesh per material, so material-name lookups in exterior_map.js — the cloned
// lamp materials — still find their own meshes). Static meshes only.
const DECIMATE = {
  // x7 parked cars. No textures, so UVs are dropped; the inverted twin shell is removed.
  // plans: [material regex, fraction of triangles kept, max simplification error]; first match wins.
  // Interiors are barely visible from the street, so they are crushed hardest; the body, glass and
  // wheels keep detail.
  "models/ferrari.glb": {
    join: true, keepUV: false, dropTwins: true,
    plans: [[/interior|leather|carpet|carbon|plastic/i, 0.08, 0.1], [/body_color/i, 0.2, 0.02], [/tires/i, 0.4, 0.03], [/glass_gray/i, 0.25, 0.02], [/taillight|projector|turn_signal/i, 0.2, 0.03], [/./, 0.25, 0.03]],
  },
  // x15 trees (a voxel model). UVs index the 256x1 palette, so they are kept (colour seams stay borders).
  "models/tree.glb": { keepUV: true, plans: [[/./, 0.08, 0.05]] },
};// Simplification error limits to try, smallest (best fidelity) first, until a primitive reaches its ratio.
const ERROR_STEPS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.1];

const countTris = doc => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0), 0);

// The ferrari is exported double-shelled: every surface exists twice, as an outward shell and an
// inverted twin with identical positions (every position-welded edge has valence 4). Meshopt cannot
// simplify coincident layers, and the inverted twin is back-face culled anyway, so `dropTwins` removes
// it first. Both source meshes are also triangle soups (per-face vertices), so before simplifying the
// topology is re-welded by position (+ UV when the UVs matter, e.g. the tree's palette lookup), and
// normals are taken from the source corner that best faces each output triangle.
function decimateDocument(doc, { keepUV, dropTwins, plans }) {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const prims = root.listMeshes().flatMap(m => m.listPrimitives());
  const q = v => Math.round(v * 1e5);
  // Voxel occupancy of every vertex in the file, to ray-test which twin of a coincident pair faces open air.
  let occupied = null, cell = 0, origin = [0, 0, 0];
  if (dropTwins) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const pr of prims) { const A = pr.getAttribute("POSITION").getArray(); for (let i = 0; i < A.length; i += 3) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], A[i + j]); hi[j] = Math.max(hi[j], A[i + j]); } }
    cell = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 160; origin = lo;
    occupied = new Set();
    const key = (x, y, z) => ((Math.floor((x - lo[0]) / cell) + 4) * 1024 + Math.floor((y - lo[1]) / cell) + 4) * 1024 + Math.floor((z - lo[2]) / cell) + 4;
    for (const pr of prims) {
      const A = pr.getAttribute("POSITION").getArray(), Ix = pr.getIndices() && pr.getIndices().getArray();
      for (let i = 0; i < A.length; i += 3) occupied.add(key(A[i], A[i + 1], A[i + 2]));
      if (Ix) for (let t = 0; t < Ix.length; t += 3) {   // centroids fill the gaps in big triangles
        const a = Ix[t] * 3, b = Ix[t + 1] * 3, c = Ix[t + 2] * 3;
        occupied.add(key((A[a] + A[b] + A[c]) / 3, (A[a + 1] + A[b + 1] + A[c + 1]) / 3, (A[a + 2] + A[b + 2] + A[c + 2]) / 3));
      }
    }
    occupied.key = key;
  }
  // true if a ray leaving point p along unit direction d reaches open air (no occupied voxel within 4 m).
  const escapes = (p, d) => {
    for (let s = 2.5; s < 160; s += 0.6) if (occupied.has(occupied.key(p[0] + d[0] * s * cell, p[1] + d[1] * s * cell, p[2] + d[2] * s * cell))) return false;
    return true;
  };
  for (const prim of prims) {
    const pos = prim.getAttribute("POSITION"), nrm = prim.getAttribute("NORMAL");
    const uvAcc = keepUV ? prim.getAttribute("TEXCOORD_0") : null;
    const n = pos.getCount();
    const P = pos.getArray(), Nsrc = nrm.getArray(), UV = uvAcc && uvAcc.getArray();
    const I = prim.getIndices() ? prim.getIndices().getArray() : Uint32Array.from({ length: n }, (_, i) => i);
    // weld by position (+ uv)
    const map = new Map(), canon = new Uint32Array(n), keep = [];
    for (let i = 0; i < n; i++) {
      const k = q(P[i * 3]) + "," + q(P[i * 3 + 1]) + "," + q(P[i * 3 + 2]) + (UV ? "," + q(UV[i * 2]) + "," + q(UV[i * 2 + 1]) : "");
      let c = map.get(k);
      if (c === undefined) { c = keep.length; map.set(k, c); keep.push(i); }
      canon[i] = c;
    }
    const nTri = I.length / 3;
    const drop = new Uint8Array(nTri);
    if (dropTwins) {
      // components: triangles linked through shared (position, coarse normal) corners = one layer of one part
      const par = Int32Array.from({ length: nTri }, (_, i) => i);
      const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const first = new Map();
      for (let t = 0; t < nTri; t++) for (let k = 0; k < 3; k++) {
        const i = I[t * 3 + k];
        const key = canon[i] + "," + Math.round(Nsrc[i * 3] * 4) + "," + Math.round(Nsrc[i * 3 + 1] * 4) + "," + Math.round(Nsrc[i * 3 + 2] * 4);
        const o = first.get(key);
        if (o === undefined) first.set(key, t); else par[find(t)] = find(o);
      }
      // outwardness of a component: sum of area-weighted normal . (point - component centroid) > 0 for an outward shell
      const acc = new Map();
      for (let t = 0; t < nTri; t++) {
        const r = find(t), e = acc.get(r) || { c: [0, 0, 0], k: 0, tris: [] };
        for (let k = 0; k < 3; k++) { const i = I[t * 3 + k]; e.c[0] += P[i * 3]; e.c[1] += P[i * 3 + 1]; e.c[2] += P[i * 3 + 2]; e.k++; }
        e.tris.push(t); acc.set(r, e);
      }
      const score = new Map();
      for (const [r, e] of acc) {
        const c = e.c.map(v => v / e.k); let sc = 0;
        for (const t of e.tris) {
          const [a, b, d] = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
          const u = [0, 1, 2].map(j => P[b * 3 + j] - P[a * 3 + j]), v = [0, 1, 2].map(j => P[d * 3 + j] - P[a * 3 + j]);
          const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          sc += g[0] * (P[a * 3] - c[0]) + g[1] * (P[a * 3 + 1] - c[1]) + g[2] * (P[a * 3 + 2] - c[2]);
        }
        score.set(r, sc);
      }
      const centroidOf = t => [0, 1, 2].map(j => (P[I[t * 3] * 3 + j] + P[I[t * 3 + 1] * 3 + j] + P[I[t * 3 + 2] * 3 + j]) / 3);
      const unitNormalOf = t => {   // the winding normal; the stored normals agree with it
        const [a, b, d] = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
        const u = [0, 1, 2].map(j => P[b * 3 + j] - P[a * 3 + j]), v = [0, 1, 2].map(j => P[d * 3 + j] - P[a * 3 + j]);
        const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...g) || 1;
        return g.map(x => x / l);
      };
      // a triangle whose position triple also occurs in another triangle is half of a twin pair: keep the more outward one
      const seen = new Map(), pairs = [], vote = new Map();
      for (let t = 0; t < nTri; t++) {
        const k = [canon[I[t * 3]], canon[I[t * 3 + 1]], canon[I[t * 3 + 2]]].sort((x, y) => x - y).join(",");
        const o = seen.get(k);
        if (o === undefined) { seen.set(k, t); continue; }
        pairs.push([o, t]);
        // ray test: which of the two coincident triangles faces open air? Votes accumulate per component so a
        // whole panel switches together instead of speckling triangle by triangle.
        const d = (escapes(centroidOf(t), unitNormalOf(t)) ? 1 : 0) - (escapes(centroidOf(o), unitNormalOf(o)) ? 1 : 0);
        vote.set(find(t), (vote.get(find(t)) || 0) + d); vote.set(find(o), (vote.get(find(o)) || 0) - d);
      }
      const rank = t => (vote.get(find(t)) || 0) * 1e6 + score.get(find(t)) / 1e9;   // votes first, shell outwardness as tie-break
      for (const [o, t] of pairs) { if (rank(t) > rank(o)) drop[o] = 1; else drop[t] = 1; }
    }
    const vp = new Float32Array(keep.length * 3), vu = UV ? new Float32Array(keep.length * 2) : null;
    keep.forEach((src, c) => { vp.set(P.subarray(src * 3, src * 3 + 3), c * 3); if (vu) vu.set(UV.subarray(src * 2, src * 2 + 2), c * 2); });
    // per canonical vertex: the distinct source normals seen at it (picked per output triangle below)
    const cand = Array.from({ length: keep.length }, () => []);
    const idxOut = new Uint32Array(I.length), srcOf = new Map(); let w = 0;
    for (let t = 0; t < nTri; t++) {
      const a = canon[I[t * 3]], b = canon[I[t * 3 + 1]], c = canon[I[t * 3 + 2]];
      if (drop[t] || a === b || b === c || a === c) continue;
      idxOut[w++] = a; idxOut[w++] = b; idxOut[w++] = c;
      for (let k = 0; k < 3; k++) {
        const i = I[t * 3 + k], list = cand[canon[i]];
        if (list.length < 8 && !list.some(x => Math.abs(x[0] - Nsrc[i * 3]) + Math.abs(x[1] - Nsrc[i * 3 + 1]) + Math.abs(x[2] - Nsrc[i * 3 + 2]) < 0.05)) list.push([Nsrc[i * 3], Nsrc[i * 3 + 1], Nsrc[i * 3 + 2]]);
      }
    }
    const idx = idxOut.slice(0, w);
    const [, ratio, maxError] = plans.find(([re]) => re.test(prim.getMaterial()?.getName() || "")) || plans[plans.length - 1];
    const target = Math.max(12, Math.floor((w / 3) * ratio)) * 3;
    let simplified = idx;
    for (const error of ERROR_STEPS.filter(e => e <= maxError)) {   // gentlest error limit that reaches the ratio
      [simplified] = MeshoptSimplifier.simplify(idx, vp, 3, target, error, []);
      if (simplified.length <= target * 1.1) break;
    }
    const T = simplified.length / 3;
    const cornerP = new Float32Array(T * 9), cornerN = new Float32Array(T * 9), cornerU = vu ? new Float32Array(T * 6) : null;
    for (let t = 0; t < T; t++) {
      const [a, b, c] = [simplified[t * 3], simplified[t * 3 + 1], simplified[t * 3 + 2]];
      const u = [0, 1, 2].map(j => vp[b * 3 + j] - vp[a * 3 + j]), v = [0, 1, 2].map(j => vp[c * 3 + j] - vp[a * 3 + j]);
      const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const gl = Math.hypot(g[0], g[1], g[2]) || 1;
      [a, b, c].forEach((vi, k) => {
        let best = null, bd = -2;
        for (const cn of cand[vi]) { const d = (cn[0] * g[0] + cn[1] * g[1] + cn[2] * g[2]) / gl; if (d > bd) { bd = d; best = cn; } }
        best = best || [g[0] / gl, g[1] / gl, g[2] / gl];
        const o = t * 3 + k;
        cornerP.set(vp.subarray(vi * 3, vi * 3 + 3), o * 3);
        cornerN.set(best.map(x => Math.round(x * 1e3) / 1e3), o * 3);
        if (cornerU) cornerU.set(vu.subarray(vi * 2, vi * 2 + 2), o * 2);
      });
    }
    const mk = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    for (const sem of prim.listSemantics()) prim.setAttribute(sem, null);
    prim.setAttribute("POSITION", mk("VEC3", cornerP)).setAttribute("NORMAL", mk("VEC3", cornerN));
    if (cornerU) prim.setAttribute("TEXCOORD_0", mk("VEC2", cornerU));
    prim.setIndices(null);
  }
}

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

// Draco decoder for reading Draco inputs, taken from three's own copy (no extra dependency).
async function createDracoDecoder() {
  const dir = resolve("node_modules/three/examples/jsm/libs/draco/gltf");
  const ctx = { module: { exports: {} }, require: createRequire(import.meta.url), __dirname: dir, console, process, WebAssembly, TextDecoder, setTimeout };
  ctx.exports = ctx.module.exports; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(`${dir}/draco_decoder.js`, "utf8"), ctx);
  return ctx.module.exports({ wasmBinary: readFileSync(`${dir}/draco_decoder.wasm`) });
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder, "draco3d.decoder": await createDracoDecoder() });

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
  // Draco inputs are decoded on read; drop the extension so the output is not Draco.
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === "KHR_draco_mesh_compression") ext.dispose();
  // assets-src/ is git-ignored, so on a fresh clone the files in assets/ are already
  // the optimised ones. Re-encoding them would be a second lossy generation (and would
  // back the optimised file up as if it were the original) — skip instead.
  const alreadyOptimised = root.listExtensionsUsed().some(e => e.extensionName === "EXT_texture_webp" || e.extensionName === "EXT_meshopt_compression");
  if (source === file && alreadyOptimised) {
    console.log(`${key}: already optimised and no original in assets-src/ — skipped (restore the original from git history into assets-src/ to re-run)`);
    continue;
  }
  const skinned = root.listSkins().length > 0;
  const repaired = await repairUnreadableTextures(doc);

  const decim = DECIMATE[key];
  const budget = decim && !skinned ? 1 : 0;
  const base = [dedup(), prune({ keepLeaves: true })];
  if (budget && decim.join) base.push(flatten(), joinMeshes({ keepNamed: false }));
  if (!skinned && !budget) base.push(weld());
  await doc.transform(...base);
  if (budget) {
    decimateDocument(doc, decim);
    await doc.transform(weld());   // re-index the per-corner output (identical position/normal/uv merge)
  }
  if (!skinned) await doc.transform(quantize(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
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
  console.log(`${key}: ${MB(before)} -> ${MB(after)} (${(100 * (1 - after / before)).toFixed(0)}% smaller)${skinned ? " [skinned: textures only]" : ""}${hero ? " [hero 2048]" : ""}${budget ? ` [decimated to ${Math.round(countTris(doc))} tris, ${doc.getRoot().listMeshes().length} meshes]` : ""}`);
}

const tb = rows.reduce((s, r) => s + r.before, 0);
const ta = rows.reduce((s, r) => s + r.after, 0);
console.log(`\n${rows.length} files: ${MB(tb)} -> ${MB(ta)}${dryRun ? " (dry run, nothing written)" : ""}`);
