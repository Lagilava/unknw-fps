// Locate the sun in an equirectangular .hdr and convert its pixel to the world
// direction the game's sky dome uses (u = (PI - atan2(z,x))/2PI, top row = zenith),
// so the exterior DirectionalLight can be aimed at the actual HDRI sun.
import fs from "node:fs";

const path = process.argv[2] || "./assets/hdri/kloppenheim_06_puresky_2k.hdr";
const buf = fs.readFileSync(path);

// ── Parse Radiance RGBE header ────────────────────────────────────────────────
let pos = 0;
function readLine() {
  let s = "";
  while (pos < buf.length) {
    const c = buf[pos++];
    if (c === 0x0a) break;
    s += String.fromCharCode(c);
  }
  return s;
}
let line, W = 0, H = 0;
while ((line = readLine()).length >= 0) {
  if (/^-Y \d+ \+X \d+$/.test(line)) {
    const m = line.match(/^-Y (\d+) \+X (\d+)$/);
    H = +m[1]; W = +m[2];
    break;
  }
  if (line === "" && (W || H)) break;
}
if (!W || !H) throw new Error("Could not parse HDR resolution");

// ── Decode RLE scanlines to RGBE, then to float luminance ─────────────────────
const lum = new Float32Array(W * H);
function rgbe2lum(r, g, b, e) {
  if (e === 0) return 0;
  const f = Math.pow(2, e - 128 - 8);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) * f;
}
for (let y = 0; y < H; y++) {
  // New-format RLE header: 2, 2, (W>>8), (W&0xff)
  const h0 = buf[pos], h1 = buf[pos + 1], h2 = buf[pos + 2], h3 = buf[pos + 3];
  if (h0 === 2 && h1 === 2 && ((h2 << 8) | h3) === W) {
    pos += 4;
    const scan = new Uint8Array(W * 4);
    for (let ch = 0; ch < 4; ch++) {
      let x = 0;
      while (x < W) {
        let count = buf[pos++];
        if (count > 128) { // run
          const val = buf[pos++];
          count -= 128;
          while (count--) scan[(x++) * 4 + ch] = val;
        } else { // literal
          while (count--) scan[(x++) * 4 + ch] = buf[pos++];
        }
      }
    }
    for (let x = 0; x < W; x++) {
      lum[y * W + x] = rgbe2lum(scan[x * 4], scan[x * 4 + 1], scan[x * 4 + 2], scan[x * 4 + 3]);
    }
  } else {
    // Flat (non-RLE) scanline
    for (let x = 0; x < W; x++) {
      const r = buf[pos++], g = buf[pos++], b = buf[pos++], e = buf[pos++];
      lum[y * W + x] = rgbe2lum(r, g, b, e);
    }
  }
}

// ── Find the sun: luminance-weighted centroid of the brightest pixels ─────────
let maxL = 0;
for (let i = 0; i < lum.length; i++) if (lum[i] > maxL) maxL = lum[i];
const thresh = maxL * 0.6; // near-peak = the solar disc
let sx = 0, sy = 0, sw = 0, n = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const l = lum[y * W + x];
  if (l >= thresh) { sx += x * l; sy += y * l; sw += l; n++; }
}
const px = sx / sw, py = sy / sw;

// ── Pixel → world direction (dome convention) ─────────────────────────────────
const u = px / W;
const A = Math.PI - 2 * Math.PI * u;          // atan2(z, x)
const el = (0.5 - py / H) * Math.PI;          // +zenith .. -nadir
const dir = {
  x: Math.cos(el) * Math.cos(A),
  y: Math.sin(el),
  z: Math.cos(el) * Math.sin(A),
};
const len = Math.hypot(dir.x, dir.y, dir.z);
dir.x /= len; dir.y /= len; dir.z /= len;

console.log(`HDR ${W}x${H}  maxLum=${maxL.toFixed(1)}  sunPixels=${n}`);
console.log(`sun pixel = (${px.toFixed(1)}, ${py.toFixed(1)})  u=${u.toFixed(4)}`);
console.log(`azimuth=${(A * 180 / Math.PI).toFixed(1)}deg  elevation=${(el * 180 / Math.PI).toFixed(1)}deg`);
console.log(`sunDir = new THREE.Vector3(${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)})`);
