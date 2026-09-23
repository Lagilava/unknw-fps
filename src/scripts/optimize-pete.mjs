// One-off: downsizes the textures embedded inside assets/Pete.glb.
//
// Pete.fbx ships Mixamo/CC-style 4096x4096 diffuse + normal maps (plus a 2048
// second diffuse), carried through untouched by FBX2glTF during conversion
// (scripts/convert-pete.mjs). At full res that's ~50MB of embedded PNG the GPU
// has to decompress and sample every frame for a single third-person character
// — the same oversized-texture perf trap scripts/optimize-textures.mjs already
// guards against for loose files, but this model's textures are embedded in
// the GLB binary so that script can't reach them.
//
//   node scripts/optimize-pete.mjs
//
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = 'assets/Pete.glb';
const BACKUP = 'assets-original/assets/Pete.glb';

if (!existsSync(BACKUP)) {
  mkdirSync(dirname(BACKUP), { recursive: true });
  copyFileSync(SRC, BACKUP);
  console.log(`backed up original to ${BACKUP}`);
}

const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();

for (const tex of root.listTextures()) {
  const image = tex.getImage();
  if (!image) continue;
  const meta = await sharp(Buffer.from(image)).metadata();
  const maxEdge = Math.max(meta.width || 0, meta.height || 0);
  const name = (tex.getName() || tex.getURI() || '').toLowerCase();
  const target = /(metal|rough|_ao|occlusion|glossiness)/.test(name) ? 512 : 1024;
  if (maxEdge <= target) continue;
  const resized = await sharp(Buffer.from(image))
    .resize(target, target, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  tex.setImage(resized);
  console.log(`${tex.getName() || tex.getURI()}: ${meta.width}x${meta.height} -> ${target}px  (${(image.byteLength/1048576).toFixed(1)}MB -> ${(resized.byteLength/1048576).toFixed(1)}MB)`);
}

await io.write(SRC, doc);
console.log('wrote', SRC);
