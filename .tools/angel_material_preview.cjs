const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  page.on("console", message => console.log(`[${message.type()}] ${message.text()}`));
  await page.goto("http://127.0.0.1:8000/", { waitUntil: "domcontentloaded" });
  await page.setContent(`
    <script type="importmap">
      { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js" } }
    </script>
    <canvas id="c" style="width:960px;height:720px"></canvas>
  `);
  await page.evaluate(async () => {
    const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js");
    const { FBXLoader } = await import("https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/loaders/FBXLoader.js");

    const base = "http://127.0.0.1:8000/assets/drones/angel";
    const loadTexture = (path, color = false) => {
      const texture = new THREE.TextureLoader().load(`${base}/textures/${path}`);
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      return texture;
    };
    const materials = {
      skeleton: new THREE.MeshStandardMaterial({
        map: loadTexture("skeleton_mat_Base_color_sRGB.png", true),
        normalMap: loadTexture("skeleton_mat_Normal_DirectX_Raw.png"),
        normalScale: new THREE.Vector2(1, -1),
        roughnessMap: loadTexture("skeleton_mat_Roughness_Raw.png"),
        metalnessMap: loadTexture("skeleton_mat_Metallic_Raw.png"),
        aoMap: loadTexture("low_s_skeleton_mat_Mixed_AO_Raw.png"),
        roughness: 0.72,
        metalness: 0.58,
      }),
      arm: new THREE.MeshStandardMaterial({
        map: loadTexture("arm_mat_Base_color_sRGB_noGreen.png", true),
        normalMap: loadTexture("arm_mat_Normal.png"),
        roughnessMap: loadTexture("arm_mat_Roughness.png"),
        metalnessMap: loadTexture("arm_mat_Metallic.png"),
        aoMap: loadTexture("arm_mat_Ambient_occlusion_Raw.png"),
        roughness: 0.64,
        metalness: 0.44,
      }),
      glow: new THREE.MeshBasicMaterial({
        color: 0x9eeaff,
        alphaMap: loadTexture("glow_alpha.png"),
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    };
    const originalWarn = console.warn;
    console.warn = (...args) => {
      const text = args.map(arg => String(arg)).join(" ");
      if (["Maya|base", "unknown material type", "Vertex has more than 4 skinning weights"].some(pattern => text.includes(pattern))) return;
      originalWarn(...args);
    };
    const loader = new FBXLoader();
    const model = await loader.loadAsync(`${base}/source/skeleton.fbx`);
    console.warn = originalWarn;
    const removals = [];
    model.traverse(obj => {
      if (!obj.isMesh) return;
      if (/^(bg_plane|halo_outer_ring|blood_drops_|inner_torus|outter_torus)$/i.test(obj.name || "")) {
        removals.push(obj);
        return;
      }
      if (!obj.geometry.attributes.uv2 && obj.geometry.attributes.uv) obj.geometry.setAttribute("uv2", obj.geometry.attributes.uv);
      const name = `${obj.name || ""} ${Array.isArray(obj.material) ? obj.material.map(mat => mat?.name || "").join(" ") : obj.material?.name || ""}`.toLowerCase();
      obj.material = name.includes("arm_mat") || name.includes("arm_mesh") ? materials.arm : name.includes("glow") ? materials.glow : materials.skeleton;
      obj.frustumCulled = false;
    });
    removals.forEach(obj => obj.parent?.remove(obj));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101318);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 3.8);
    key.position.set(4, 7, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fdfff, 1.6);
    rim.position.set(-5, 3, -4);
    scene.add(rim);
    const root = new THREE.Group();
    const copy = model;
    root.add(copy);
    scene.add(root);
    let box = new THREE.Box3().setFromObject(copy);
    const size = box.getSize(new THREE.Vector3());
    copy.scale.setScalar(2 / Math.max(0.001, size.y));
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(copy);
    const center = box.getCenter(new THREE.Vector3());
    copy.position.x -= center.x;
    copy.position.y -= box.min.y;
    copy.position.z -= center.z;
    copy.rotation.y = Math.PI * 0.15;
    const camera = new THREE.PerspectiveCamera(45, 960 / 720, 0.01, 100);
    camera.position.set(0, 1.35, 5.4);
    camera.lookAt(0, 1.05, 0);
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("c"), antialias: true });
    renderer.setSize(960, 720, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.render(scene, camera);
  });
  await page.screenshot({ path: "test-artifacts/angel-material-preview.png", fullPage: true });
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
