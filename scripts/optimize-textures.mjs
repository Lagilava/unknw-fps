// Reproducible texture optimizer.
//
// GPU VRAM + sampling bandwidth scale with texture *dimensions*, not file size,
// so the biggest perf win is downscaling the oversized 2K maps that sit on small
// on-screen objects (the drone especially). Paths and PNG format are preserved,
// so both the Vite build and the standalone fallback HTML benefit with zero code
// changes. Originals are backed up to assets-original/ before anything is touched.
//
//   node scripts/optimize-textures.mjs          # optimize in place
//   node scripts/optimize-textures.mjs --dry    # report only, change nothing
//
import sharp from 'sharp';
import { readdir, mkdir, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry');
const BACKUP_DIR = join(ROOT, 'assets-original');

// Directories to sweep for textures. Deliberately excludes assets/textures/*
// (floor/wall/ceiling): those are 1K *tiling* PBR sets stretched across large
// surfaces where 1K is appropriate and 512 would visibly blur. We only target
// the oversized 2K maps on small objects (the drone) and loose model textures.
const TEXTURE_DIRS = [
  'assets/drones/angel/textures',
  'assets/models',
];

// Classify a texture by filename → target max edge. Data maps (roughness,
// metalness, AO) carry low-frequency detail and survive 512 fine; color and
// normal maps keep 1024. Returns null to skip (leave untouched).
function targetFor(name) {
  const n = name.toLowerCase();
  if (!/\.(png|jpg|jpeg)$/.test(n)) return null;
  if (/(metal|rough|_ao|occlusion|mixed_ao|scatter|glow|alpha)/.test(n)) return 512;
  if (/(normal|base_color|diffuse|color|albedo|_basecolor)/.test(n)) return 1024;
  return 1024; // default cap for any other oversized map
}

async function backup(absPath) {
  const rel = relative(ROOT, absPath);
  const dest = join(BACKUP_DIR, rel);
  if (existsSync(dest)) return; // already backed up — keep the pristine original
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(absPath, dest);
}

let totalBefore = 0, totalAfter = 0, changed = 0, skipped = 0;

for (const dir of TEXTURE_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  let files;
  try { files = await readdir(abs); } catch { continue; }
  for (const f of files) {
    const target = targetFor(f);
    if (!target) continue;
    const p = join(abs, f);
    let meta;
    try { meta = await sharp(p).metadata(); } catch { continue; }
    const before = (await stat(p)).size;
    const maxEdge = Math.max(meta.width || 0, meta.height || 0);
    if (maxEdge <= target) { skipped++; continue; }

    totalBefore += before;
    const mb = b => (b / 1048576).toFixed(2) + 'MB';
    if (DRY) {
      console.log(`would resize ${f}: ${meta.width}x${meta.height} -> ${target}px  (${mb(before)})`);
      changed++;
      continue;
    }
    await backup(p);
    const isPng = /\.png$/i.test(f);
    const buf = await sharp(p)
      .resize(target, target, { fit: 'inside', withoutEnlargement: true })
      [isPng ? 'png' : 'jpeg'](isPng ? { compressionLevel: 9, palette: false } : { quality: 88, mozjpeg: true })
      .toBuffer();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(p, buf);
    totalAfter += buf.length;
    changed++;
    console.log(`${f.padEnd(46)} ${meta.width}x${meta.height} -> ${target}px   ${mb(before)} -> ${mb(buf.length)}`);
  }
}

const mb = b => (b / 1048576).toFixed(1);
console.log('\n' + (DRY ? '[dry run] ' : '') +
  `optimized ${changed} textures, skipped ${skipped} already-small.`);
if (!DRY && changed) {
  console.log(`size: ${mb(totalBefore)}MB -> ${mb(totalAfter)}MB  (saved ${mb(totalBefore - totalAfter)}MB)`);
  console.log(`originals backed up under assets-original/`);
}
