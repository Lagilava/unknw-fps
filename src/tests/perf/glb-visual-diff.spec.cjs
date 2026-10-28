// Visual regression for src/scripts/optimize-glbs.mjs.
//
// For every GLB that has an original in assets-src/ (written by the optimiser),
// render the original and the optimised file in the same neutral studio setup
// (RoomEnvironment IBL, fixed 3/4 front + rear cameras, bind pose) through a
// GLTFLoader configured with MeshoptDecoder, then report PSNR / mean abs error.
// PNGs land in test-artifacts/glb-diff/ (git-ignored). Nothing is asserted on
// the numbers: a human looks at the images, the PSNR just ranks suspects.
//
//   npx playwright test src/tests/perf/glb-visual-diff.spec.cjs
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "../../..");
const OUT = path.join(ROOT, "test-artifacts", "glb-diff");
const SIZE = 640;
const VIEWER = "http://127.0.0.1:8000/__glb_viewer.html";

const VIEWER_HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#2b2f36">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/":"/node_modules/three/"}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
const SIZE = ${SIZE};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
window.renderGlb = async (url) => {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2b2f36); scene.environment = env;
  scene.add(new THREE.DirectionalLight(0xffffff, 1.2));
  scene.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const c = box.getCenter(new THREE.Vector3()); const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const cam = new THREE.PerspectiveCamera(35, 1, r / 100, r * 100);
  const shots = [];
  for (const yaw of [0.6, Math.PI + 0.6]) {
    cam.position.set(c.x + Math.sin(yaw) * r * 2.6, c.y + r * 0.5, c.z + Math.cos(yaw) * r * 2.6); cam.lookAt(c);
    renderer.render(scene, cam);
    shots.push(renderer.domElement.toDataURL("image/png").split(",")[1]);
  }
  let tris = 0, texBytes = 0;
  gltf.scene.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  scene.traverse(() => {});
  renderer.renderLists.dispose();
  return { shots, tris: Math.round(tris) };
};
window.viewerReady = true;
</script>`;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.toLowerCase().endsWith(".glb")) yield p;
  }
}

async function compare(a, b) {
  const ra = await sharp(a).removeAlpha().raw().toBuffer();
  const rb = await sharp(b).removeAlpha().raw().toBuffer();
  let se = 0, ae = 0;
  for (let i = 0; i < ra.length; i++) { const d = ra[i] - rb[i]; se += d * d; ae += Math.abs(d); }
  const mse = se / ra.length;
  return { psnr: mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse), mae: ae / ra.length };
}

test("optimised GLBs render like their originals", async ({ page }) => {
  test.setTimeout(600000);
  fs.mkdirSync(OUT, { recursive: true });
  const originals = [...walk(path.join(ROOT, "assets-src"))];
  test.skip(originals.length === 0, "no assets-src/ originals — run src/scripts/optimize-glbs.mjs first");

  await page.route(VIEWER, route => route.fulfill({ contentType: "text/html", body: VIEWER_HTML }));
  page.on("pageerror", e => console.log("PAGEERROR:", e.message));
  await page.goto(VIEWER);
  await page.waitForFunction(() => window.viewerReady, { timeout: 60000 });

  const report = [];
  for (const orig of originals) {
    const rel = path.relative(path.join(ROOT, "assets-src"), orig).split(path.sep).join("/");
    const slug = rel.replace(/[^\w]+/g, "_");
    const urlOf = base => `/${base}/${rel.split("/").map(encodeURIComponent).join("/")}`;
    const render = async base => {
      try { return await page.evaluate(u => window.renderGlb(u), urlOf(base)); }
      catch (e) { return { error: String(e.message || e).split("\n")[0] }; }
    };
    const before = await render("assets-src");
    const after = await render("assets");
    if (before.error || after.error) {
      report.push({ rel, error: `before: ${before.error || "ok"}; after: ${after.error || "ok"}` });
      console.log(`${rel}: RENDER ERROR  before=${before.error || "ok"} after=${after.error || "ok"}`);
      continue;
    }
    const views = [];
    for (let v = 0; v < 2; v++) {
      const fb = path.join(OUT, `${slug}_${v}_before.png`), fa = path.join(OUT, `${slug}_${v}_after.png`);
      fs.writeFileSync(fb, Buffer.from(before.shots[v], "base64"));
      fs.writeFileSync(fa, Buffer.from(after.shots[v], "base64"));
      views.push(await compare(fb, fa));
    }
    // side-by-side contact sheet: before | after, front over rear
    const sheet = path.join(OUT, `${slug}_sheet.png`);
    await sharp({ create: { width: SIZE * 2, height: SIZE * 2, channels: 3, background: "#000" } })
      .composite([0, 1].flatMap(v => [
        { input: path.join(OUT, `${slug}_${v}_before.png`), left: 0, top: v * SIZE },
        { input: path.join(OUT, `${slug}_${v}_after.png`), left: SIZE, top: v * SIZE },
      ])).png().toFile(sheet);
    const worst = views.reduce((m, x) => (x.psnr < m.psnr ? x : m));
    report.push({ rel, psnr: worst.psnr, mae: worst.mae, trisBefore: before.tris, trisAfter: after.tris, sheet });
    console.log(`${rel}: PSNR ${worst.psnr.toFixed(1)} dB, mean abs err ${worst.mae.toFixed(2)}/255, tris ${before.tris} -> ${after.tris}`);
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  expect(report.filter(r => r.error)).toEqual([]);
});
