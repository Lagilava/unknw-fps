const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  page.on("console", message => console.log(`[${message.type()}] ${message.text()}`));
  await page.goto("http://127.0.0.1:8000/first_person_shooter_room_game%20(1).html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js");
    const { FBXLoader } = await import("https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/FBXLoader.js");
    const loader = new FBXLoader();
    const url = new URL("./assets/drones/angel/source/skeleton.fbx", window.location.href);
    loader.setResourcePath(new URL("../textures/", url).href);
    const model = await loader.loadAsync(url.href);
    const meshes = [];
    model.traverse(obj => {
      if (!obj.isMesh) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      meshes.push({
        name: obj.name,
        type: obj.type,
        vertexCount: obj.geometry?.attributes?.position?.count ?? 0,
        materialNames: materials.map(mat => mat?.name || "(unnamed)"),
        materialTypes: materials.map(mat => mat?.type || "(none)"),
        maps: materials.map(mat => ({
          map: !!mat?.map,
          normalMap: !!mat?.normalMap,
          roughnessMap: !!mat?.roughnessMap,
          metalnessMap: !!mat?.metalnessMap,
          aoMap: !!mat?.aoMap,
        })),
      });
    });
    const box = new THREE.Box3().setFromObject(model);
    return {
      animations: model.animations.map(clip => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length })),
      box: { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() },
      meshes,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
