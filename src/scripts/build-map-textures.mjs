// Rebuild compressed, local PBR maps from ambientCG 1K-JPG source archives.
// Usage: node src/scripts/build-map-textures.mjs <extracted-source-directory>
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
const source = process.argv[2];
if (!source) throw new Error('Pass the directory containing extracted ambientCG 1K-JPG sets.');
const output = path.resolve('assets/textures/photoreal');
await fs.mkdir(output, { recursive: true });
const sets = [
  ['asphalt', 'Asphalt012'], ['paving', 'PavingStones036'],
  ['brick', 'Bricks026'], ['concrete', 'Concrete023'], ['wood', 'Wood049'],
  ['block', 'Concrete023'],
  ['slab', 'Concrete034', 'assets/textures/floor'],
  ['metal', 'Metal063', 'assets/textures/wall'],
];
const report = { colorSize: 1024, dataSize: 512, sets: [], sourceBytes: 0, outputBytes: 0 };
for (const [name, id, local] of sets) {
  let prefix = path.join(local || path.join(source, id + '_1K-JPG'), id + '_1K-JPG_');
  try { for (const suffix of ['Color','NormalGL','Roughness']) await fs.access(prefix + suffix + '.jpg'); }
  catch { prefix = path.join(source, id + '_1K-JPG', id + '_1K-JPG_'); }
  const inputs = ['Color', 'NormalGL', 'Roughness'].map(suffix => prefix + suffix + '.jpg');
  let before = 0;
  for (const file of inputs) before += (await fs.stat(file)).size;
  let color = await sharp(inputs[0]).resize(1024, 1024).webp({ quality: 84, effort: 6 }).toBuffer();
  // Lossless normals avoid block artefacts and shifts in the neutral 128,128,255 vector.
  let normal = await sharp(inputs[1]).resize(512, 512).removeAlpha().webp({ lossless: true, effort: 6 }).toBuffer();
  if (name === 'block') {
    // Preserve the construction's 400 x 250 mm masonry courses, with scanned
    // concrete pores inside each block and recessed mortar in the normal map.
    const rgb = await sharp(inputs[0]).resize(1024,1024).removeAlpha().raw().toBuffer();
    const nrm = await sharp(inputs[1]).resize(512,512).removeAlpha().raw().toBuffer();
    const height = (x,y,size) => {
      const row=Math.floor(y/(size/16));
      const u=((x+(row%2)*size/20)%(size/10)+size/10)%(size/10);
      const v=((y%(size/16))+size/16)%(size/16);
      return Math.min(1, Math.min(u,size/10-u,v,size/16-v)/(size/512*1.3));
    };
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++) {
      const i=(y*1024+x)*3,h=height(x,y,1024);
      const tone=.9+Math.sin(Math.floor(y/64)*17+Math.floor((x+(Math.floor(y/64)%2)*51.2)/102.4)*13)*.045;
      for(let c=0;c<3;c++)rgb[i+c]=Math.round(rgb[i+c]*tone*h+123*(1-h));
    }
    for(let y=0;y<512;y++)for(let x=0;x<512;x++) {
      const i=(y*512+x)*3;
      const nx=(nrm[i]/127.5-1)+(height(x-1,y,512)-height(x+1,y,512))*.7;
      const ny=(nrm[i+1]/127.5-1)+(height(x,y+1,512)-height(x,y-1,512))*.7;
      const nz=Math.max(.15,nrm[i+2]/127.5-1),len=Math.hypot(nx,ny,nz);
      nrm[i]=Math.round((nx/len+1)*127.5);nrm[i+1]=Math.round((ny/len+1)*127.5);nrm[i+2]=Math.round((nz/len+1)*127.5);
    }
    color=await sharp(rgb,{raw:{width:1024,height:1024,channels:3}}).webp({quality:84,effort:6}).toBuffer();
    normal=await sharp(nrm,{raw:{width:512,height:512,channels:3}}).webp({lossless:true,effort:6}).toBuffer();
  }
  const rough = await sharp(inputs[2]).resize(512, 512).greyscale().raw().toBuffer();
  let ao;
  try { ao = await sharp(prefix + 'AmbientOcclusion.jpg').resize(512,512).greyscale().raw().toBuffer(); }
  catch { ao = Buffer.alloc(512 * 512, 255); }
  const packed = Buffer.alloc(512 * 512 * 3);
  for (let i = 0; i < rough.length; i++) {
    packed[i*3] = ao[i];
    // These are dry building surfaces. Preserve scanned variation without
    // turning concrete and timber into polished plastic under the HDR sky.
    packed[i*3+1] = name === 'metal' ? rough[i] : Math.max(175, rough[i]);
    packed[i*3+2] = name === 'metal' ? 230 : 0;
  }
  const orm = await sharp(packed, { raw: { width:512, height:512, channels:3 } }).webp({ lossless:true, effort:6 }).toBuffer();
  for (const [suffix, bytes] of [['color',color],['normal',normal],['orm',orm]])
    await fs.writeFile(path.join(output, `${name}-${suffix}.webp`), bytes);
  const after = color.length + normal.length + orm.length;
  report.sets.push({ name, source:id, sourceUrl:`https://ambientcg.com/a/${id}`, sourceBytes:before, outputBytes:after });
  if(name !== 'block') report.sourceBytes += before; // block derives from the same concrete scan
  report.outputBytes += after;
  console.log(`${name}: ${(before/1024).toFixed(0)} KB -> ${(after/1024).toFixed(0)} KB`);
}
// Worn road-marking paint reuses the asphalt aggregate as its damage mask.
const paintSource = path.join(source,'Asphalt012_1K-JPG','Asphalt012_1K-JPG_Color.jpg');
const paintRaw = await sharp(paintSource).resize(512,512).greyscale().raw().toBuffer();
for(let i=0;i<paintRaw.length;i++) {
  const grain=((Math.imul(i+17,1597334677)>>>0)%1000)/1000;
  paintRaw[i]=paintRaw[i]<38 || grain<.025 ? 55+paintRaw[i] : Math.min(250,218+paintRaw[i]*.25);
}
const paint=await sharp(paintRaw,{raw:{width:512,height:512,channels:1}}).webp({quality:85,effort:6}).toBuffer();
await fs.writeFile(path.join(output,'paint-color.webp'),paint);
report.outputBytes+=paint.length;
report.paintBytes=paint.length;
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(output, 'LICENSE.txt'), 'Source: ambientCG, CC0 1.0 Universal.\nhttps://ambientcg.com/license\n\n' + report.sets.map(s=>`${s.name}: ${s.sourceUrl}`).join('\n') + '\n\nCompressed derivatives: 1024px color WebP; 512px lossless OpenGL normal and packed AO/roughness/metalness WebP. No displacement geometry.\n');
console.log(`Total: ${(report.sourceBytes/1048576).toFixed(2)} MB -> ${(report.outputBytes/1048576).toFixed(2)} MB`);
