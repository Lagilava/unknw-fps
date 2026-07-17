// The Storm Warden — procedural skinned enemy character.
//
// Adapted from a standalone Three.js showcase into a per-instance, engine-ready
// factory for UNKNW. Changes vs the original demo:
//   * No renderer/scene/camera/OrbitControls/bloom/HUD/lightning-demo — pure model.
//   * Per-instance: every call builds its own group, bones, skeleton, skinned mesh
//     and materials, so many can exist at once (the demo used module globals).
//   * WebGPU-safe materials only: the original energy parts used a GLSL
//     ShaderMaterial, which the game's WebGPURenderer cannot compile. They are
//     replaced with emissive built-in materials (additive, tone-mapping off) that
//     pulse via emissiveIntensity/opacity — same glow read, WebGPU-compatible.
//   * Self-driving animation via update(dt, enemyRef): idle ↔ move ↔ attack states
//     are derived from the enemy's own world-space movement and live combat state,
//     so no external animation plumbing is needed.
//
// Returns { root, rig, update, setDead, dispose } — root is a THREE.Group that
// stands on y≈0 (feet grounded) so the caller can scale/position it like any model.

// THREE and mergeGeometries are passed in by the caller (matching how the rest of
// this project hands the dynamically-imported THREE to its helper modules), so we
// never statically import three here — keeps a single THREE instance and avoids a
// duplicate copy in the bundle.
// ── Shared procedural detail textures ─────────────────────────────────────────
// Built once per THREE instance (cached) and reused across every Warden/Seraph/
// Cherub material — a small canvas-drawn scratched-metal noise map used as
// roughnessMap + bumpMap. This is what gives the armor plating micro-detail
// (scratches, worn patches, soot blotches) instead of a single flat color/
// roughness value, without adding any new lights or per-instance texture cost
// (the canvas is drawn once and shared by every pooled enemy instance).
let _sharedWardenTex = null;
function getSharedWardenTextures(THREE) {
  if (_sharedWardenTex) return _sharedWardenTex;
  const size = 512; // higher-res so panel seams/rivets read cleanly up close
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Base: soft vertical value gradient (subtle top-lit plating read)
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, "#9c9c9c");
  bg.addColorStop(1, "#7a7a7a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  // Brushed metal grain (long, low, near-horizontal streaks — machined plate look)
  for (let i = 0; i < 5200; i++) {
    const v = Math.random() * 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + Math.random() * 0.11})`;
    const x = Math.random() * size, y = Math.random() * size;
    const w = 6 + Math.random() * 46, h = 1 + Math.random() * 1.8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.22);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  // Panel-seam grid: darker recessed grooves so the bumpMap carves real plate edges
  ctx.strokeStyle = "rgba(18,18,18,0.55)";
  ctx.lineWidth = 2.4;
  for (let gx = 72; gx < size; gx += 104) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, size); ctx.stroke(); }
  for (let gy = 88; gy < size; gy += 128) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(size, gy); ctx.stroke(); }
  // A brighter hairline beside each groove (raised bevel lip)
  ctx.strokeStyle = "rgba(225,225,225,0.28)";
  ctx.lineWidth = 1;
  for (let gx = 74; gx < size; gx += 104) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, size); ctx.stroke(); }
  // Rivets punched along the seams
  for (let gx = 72; gx < size; gx += 104) {
    for (let gy = 44; gy < size; gy += 64) {
      ctx.fillStyle = "rgba(28,28,28,0.6)";
      ctx.beginPath(); ctx.arc(gx, gy, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(235,235,235,0.35)";
      ctx.beginPath(); ctx.arc(gx - 0.8, gy - 0.8, 1.1, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Soft wear/soot blotches (breaks up uniform flatness at a larger scale)
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 14 + Math.random() * 68;
    const dark = Math.random() > 0.42;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark ? "rgba(12,12,12,0.34)" : "rgba(240,240,240,0.20)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const detailMap = new THREE.CanvasTexture(canvas);
  detailMap.wrapS = detailMap.wrapT = THREE.RepeatWrapping;
  detailMap.repeat.set(2, 2);
  detailMap.anisotropy = 4;
  detailMap.needsUpdate = true;
  _sharedWardenTex = { detailMap };
  return _sharedWardenTex;
}

export function createStormWarden(THREE: any, mergeGeometries: any, options: any = {}) {
  const palette = options.palette || {};
  const DIAG = !!options.diagnostics; // when true, expose rig.gait for warden_diagnostics.mjs
  const accent = new THREE.Color(palette.accent ?? 0x4fc3ff);
  const accent2 = new THREE.Color(palette.accent2 ?? 0x66d4ff);
  const accent3 = new THREE.Color(palette.accent3 ?? 0xb266ff);
  const { detailMap } = getSharedWardenTextures(THREE);

  // ── Materials (per instance) ────────────────────────────────────────────────
  // roughnessMap + bumpMap add scratch/wear micro-detail on top of the flat
  // base color so the armor reads as worn metal under the game's point lights
  // instead of a single flat-shaded blob. envMapIntensity is nudged up slightly
  // so the scene's HDR sky contributes a believable specular response.
  const metal = (color, rough = 0.5, metalness = 0.95, envMul = 1.0) =>
    new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness,
      roughnessMap: detailMap, bumpMap: detailMap, bumpScale: 0.012,
      envMapIntensity: 1.25 * envMul,
    });

  // WebGPU-safe "energy" material: emissive, additive, untouched by tone mapping.
  const energyMats = [];
  const energy = (color) => {
    const m = new THREE.MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    m.userData.baseColor = color.clone();
    energyMats.push(m);
    return m;
  };

  // Battle-worn celestial plate: deep gunmetal base, brighter machined steel for
  // secondary plates, scorched under-armor, and a rich ceremonial gold for trim.
  const matMetalDark = metal(0x212734, 0.5, 0.96, 1.05);
  const matMetalSteel = metal(0x5a6678, 0.36, 0.92, 1.15);
  const matMetalScorch = metal(0x191316, 0.66, 0.8, 0.9);
  const matMetalGold = metal(0xb98a3c, 0.24, 1.0, 1.4);
  const matCoreGlow = energy(accent);
  const matVeinGlow = energy(accent2);
  const matCrownGlow = energy(accent3);
  const allMaterials = [matMetalDark, matMetalSteel, matMetalScorch, matMetalGold, matCoreGlow, matVeinGlow, matCrownGlow];

  const warden = new THREE.Group();
  warden.name = "StormWarden";
  const rig: Record<string, any> = {};

  function addMesh(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.scale.set(...scl);
    m.castShadow = false;
    m.receiveShadow = false;
    parent.add(m);
    return m;
  }

  // ── Pelvis / spine / chest ──────────────────────────────────────────────────
  let pelvis = new THREE.Group();
  pelvis.position.y = 1.05;
  warden.add(pelvis);
  rig.pelvis = pelvis;
  addMesh(pelvis, new THREE.BoxGeometry(0.5, 0.32, 0.34), matMetalDark);
  addMesh(pelvis, new THREE.CylinderGeometry(0.16, 0.2, 0.22, 8), matMetalSteel, [0, 0.18, 0]);
  // Gold waist belt + hanging tassets to finish the silhouette below the cuirass.
  addMesh(pelvis, new THREE.BoxGeometry(0.56, 0.07, 0.38), matMetalGold, [0, 0.1, 0]);
  addMesh(pelvis, new THREE.BoxGeometry(0.17, 0.28, 0.14), matMetalScorch, [0.22, -0.16, 0.08], [0, 0, 0.16]);
  addMesh(pelvis, new THREE.BoxGeometry(0.17, 0.28, 0.14), matMetalScorch, [-0.22, -0.16, 0.08], [0, 0, -0.16]);

  let spine = new THREE.Group();
  spine.position.y = 0.22;
  pelvis.add(spine);
  rig.spine = spine;

  const chest = new THREE.Group();
  chest.position.y = 0.42;
  spine.add(chest);
  rig.chest = chest;

  // Cuirass — a rounded 8-sided torso shell reads as forged plate, not a flat box.
  addMesh(chest, new THREE.CylinderGeometry(0.34, 0.24, 0.62, 8, 1), matMetalDark, [0, 0.12, 0]);
  // Upper-chest / pectoral bevel flaring up to the collar.
  addMesh(chest, new THREE.CylinderGeometry(0.3, 0.34, 0.2, 8, 1), matMetalSteel, [0, 0.4, 0]);
  // Raised sternum ridge with a ceremonial gold inlay.
  addMesh(chest, new THREE.BoxGeometry(0.1, 0.5, 0.12), matMetalSteel, [0, 0.22, 0.24], [0.06, 0, 0]);
  addMesh(chest, new THREE.BoxGeometry(0.05, 0.5, 0.05), matMetalGold, [0, 0.24, 0.31], [0.06, 0, 0]);
  // Collar / gorget ring at the throat.
  addMesh(chest, new THREE.TorusGeometry(0.16, 0.03, 8, 18), matMetalGold, [0, 0.52, 0], [Math.PI / 2, 0, 0]);
  // Segmented abdominal plates with a gold belt line.
  addMesh(chest, new THREE.BoxGeometry(0.52, 0.12, 0.4), matMetalDark, [0, -0.14, 0.02]);
  addMesh(chest, new THREE.BoxGeometry(0.4, 0.1, 0.36), matMetalScorch, [0, -0.26, 0.02]);
  addMesh(chest, new THREE.BoxGeometry(0.58, 0.035, 0.42), matMetalGold, [0, -0.06, 0.02]);

  // Layered pauldrons (decorative shoulder armor sitting over the arm pivots).
  // Right (cannon) side is the heavier, spiked pauldron; left is a clean dome —
  // gives the imposing asymmetric silhouette without a jumble of loose cones.
  const pauldron = (sx, big) => {
    const r = big ? 0.27 : 0.22;
    addMesh(chest, new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), matMetalSteel, [sx * 0.5, 0.42, 0]);
    addMesh(chest, new THREE.TorusGeometry(r * 0.92, 0.028, 8, 16, Math.PI), matMetalGold, [sx * 0.5, 0.42, 0], [Math.PI / 2, 0, 0]);
    addMesh(chest, new THREE.SphereGeometry(r * 0.6, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), matMetalDark, [sx * 0.5, 0.5, 0]);
    if (big) {
      addMesh(chest, new THREE.ConeGeometry(0.06, 0.36, 5), matMetalScorch, [sx * 0.64, 0.58, 0], [0, 0, sx * -0.4]);
      addMesh(chest, new THREE.ConeGeometry(0.04, 0.22, 4), matMetalGold, [sx * 0.58, 0.62, 0.06], [0, 0, sx * -0.5]);
    }
  };
  pauldron(-1, false);
  pauldron(1, true);

  // Reactor core (energy)
  const reactorGroup = new THREE.Group();
  reactorGroup.position.set(0, 0.18, 0.24);
  chest.add(reactorGroup);
  addMesh(reactorGroup, new THREE.TorusGeometry(0.14, 0.025, 8, 20), matMetalGold);
  addMesh(reactorGroup, new THREE.TorusGeometry(0.1, 0.018, 8, 20), matMetalSteel, [0, 0, 0], [Math.PI / 2, 0, 0]);
  rig.reactorCore = addMesh(reactorGroup, new THREE.IcosahedronGeometry(0.085, 1), matCoreGlow, [0, 0, 0.02]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    addMesh(chest, new THREE.BoxGeometry(0.02, 0.18, 0.02), matVeinGlow,
      [Math.cos(a) * 0.18, 0.18 + Math.sin(a) * 0.18 * 0.6, 0.23], [0, 0, a]);
  }

  // ── Head + halo ─────────────────────────────────────────────────────────────
  const neck = new THREE.Group();
  neck.position.y = 0.62;
  chest.add(neck);
  const head = new THREE.Group();
  neck.add(head);
  rig.head = head;
  // Helm — a rounded skull with a knightly/celestial visor read instead of a
  // bare octahedron. Gold brow crest gives the menacing sentinel silhouette.
  addMesh(head, new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.8), matMetalSteel, [0, 0.1, 0], [0, 0, 0], [1, 1.12, 0.98]);
  // Angled faceplate housing the visor.
  addMesh(head, new THREE.BoxGeometry(0.2, 0.17, 0.09), matMetalDark, [0, 0.08, 0.09], [0.18, 0, 0]);
  // Gold brow crest sweeping back over the crown.
  addMesh(head, new THREE.BoxGeometry(0.05, 0.05, 0.24), matMetalGold, [0, 0.24, -0.01], [-0.2, 0, 0]);
  addMesh(head, new THREE.ConeGeometry(0.045, 0.16, 4), matMetalGold, [0, 0.26, -0.14], [-1.35, 0, 0]);
  // Cheek fins framing the face.
  addMesh(head, new THREE.ConeGeometry(0.03, 0.17, 4), matMetalScorch, [0.11, 0.05, 0.02], [0, 0, -0.5]);
  addMesh(head, new THREE.ConeGeometry(0.03, 0.17, 4), matMetalScorch, [-0.11, 0.05, 0.02], [0, 0, 0.5]);
  // Visor slit — the glowing eye band recessed into the faceplate.
  rig.faceCore = addMesh(head, new THREE.BoxGeometry(0.15, 0.028, 0.02), matCoreGlow, [0, 0.09, 0.16], [0.18, 0, 0]);
  // Visor slit gets its own cloned energy material so it can quick-pulse on
  // attacks independently of the bulk glow pass (clone at rig-build time only —
  // same MeshBasicMaterial program, no new shaders).
  const matVisor = matCoreGlow.clone();
  matVisor.userData.baseColor = accent.clone();
  matVisor.userData.isVisor = true;
  allMaterials.push(matVisor);
  energyMats.push(matVisor);
  rig.faceCore.material = matVisor;

  const crown = new THREE.Group();
  crown.position.set(0.04, 0.34, -0.02);
  head.add(crown);
  rig.crown = crown;
  addMesh(crown, new THREE.TorusGeometry(0.34, 0.022, 8, 28, Math.PI * 1.5), matCrownGlow, [0, 0, 0], [Math.PI / 2.1, 0, 0.5]);
  addMesh(crown, new THREE.TorusGeometry(0.34, 0.008, 6, 28, Math.PI * 1.5), matMetalGold, [0, 0, 0], [Math.PI / 2.1, 0, 0.5]);
  rig.crownShards = [];
  [0.45, -0.55, 2.1, 2.9].forEach((a, i) => {
    const r = 0.34;
    rig.crownShards.push(addMesh(crown, new THREE.ConeGeometry(0.03, 0.13, 4), matCrownGlow,
      [Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55 + 0.05, 0.05 + i * 0.02], [Math.PI, 0, a]));
  });

  // ── Arms (asymmetric: R = cannon, L = clawed) ───────────────────────────────
  function buildArm(side, isCannon) {
    const s = side === "L" ? 1 : -1;
    const scale = isCannon ? 1.0 : 0.82;
    const length = isCannon ? 1.0 : 1.18;
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(s === -1 ? -0.5 : 0.42, 0.36, 0);
    chest.add(shoulderPivot);

    const upperArm = new THREE.Group();
    shoulderPivot.add(upperArm);
    addMesh(upperArm, new THREE.CylinderGeometry(0.1 * scale, 0.09 * scale, 0.42 * length, 8), matMetalSteel, [0, -0.21 * length, 0]);
    // Rounded shoulder cap plate seating the arm into the pauldron.
    addMesh(upperArm, new THREE.SphereGeometry(0.12 * scale, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), matMetalDark, [0, 0.0, 0]);
    addMesh(upperArm, new THREE.BoxGeometry(0.16 * scale, 0.12 * scale, 0.16 * scale), matMetalDark, [0, -0.02, 0]);
    addMesh(upperArm, new THREE.CylinderGeometry(0.022, 0.022, 0.4 * length, 6), matVeinGlow, [0.07 * scale, -0.21 * length, 0.06]);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.y = -0.42 * length;
    upperArm.add(elbowPivot);

    const forearm = new THREE.Group();
    elbowPivot.add(forearm);
    addMesh(forearm, new THREE.CylinderGeometry(0.085 * scale, 0.075 * scale, 0.4 * length, 8), matMetalSteel, [0, -0.2 * length, 0]);
    // Armored vambrace plate with a gold cuff.
    addMesh(forearm, new THREE.BoxGeometry(0.16 * scale, 0.3 * length, 0.14 * scale), matMetalDark, [0, -0.2 * length, 0.012]);
    addMesh(forearm, new THREE.BoxGeometry(0.17 * scale, 0.035, 0.15 * scale), matMetalGold, [0, -0.34 * length, 0.012]);
    addMesh(forearm, new THREE.CylinderGeometry(0.02, 0.02, 0.38 * length, 6), matVeinGlow, [0.065 * scale, -0.2 * length, 0.05]);

    if (isCannon) {
      const cannon = new THREE.Group();
      cannon.position.set(0, -0.42 * length, 0);
      forearm.add(cannon);
      addMesh(cannon, new THREE.CylinderGeometry(0.1, 0.14, 0.3, 6), matMetalDark, [0, -0.14, 0]);
      addMesh(cannon, new THREE.CylinderGeometry(0.06, 0.1, 0.16, 6), matMetalScorch, [0, -0.32, 0]);
      addMesh(cannon, new THREE.TorusGeometry(0.1, 0.018, 8, 14), matMetalGold, [0, -0.26, 0], [Math.PI / 2, 0, 0]);
      rig.muzzle = addMesh(cannon, new THREE.SphereGeometry(0.065, 10, 10), matCoreGlow, [0, -0.41, 0]);
      rig["cannon" + side] = cannon;
    } else {
      const hand = new THREE.Group();
      hand.position.set(0, -0.42 * length, 0);
      forearm.add(hand);
      addMesh(hand, new THREE.BoxGeometry(0.09, 0.08, 0.1), matMetalSteel);
      for (let i = 0; i < 4; i++) {
        addMesh(hand, new THREE.ConeGeometry(0.014, 0.13, 5), matMetalDark, [(i - 1.5) * 0.025, -0.1, 0.01], [0.25, 0, 0]);
      }
      rig["hand" + side] = hand;
    }
    rig["shoulder" + side] = shoulderPivot;
    rig["upperArm" + side] = upperArm;
    rig["elbow" + side] = elbowPivot;
    rig["forearm" + side] = forearm;
  }
  buildArm("L", false);
  buildArm("R", true);

  // ── Legs ────────────────────────────────────────────────────────────────────
  function buildLeg(side) {
    const s = side === "L" ? 1 : -1;
    const hipPivot = new THREE.Group();
    hipPivot.position.set(s * 0.2, -0.16, 0);
    pelvis.add(hipPivot);

    const thigh = new THREE.Group();
    hipPivot.add(thigh);
    addMesh(thigh, new THREE.CylinderGeometry(0.12, 0.1, 0.46, 8), matMetalSteel, [0, -0.23, 0]);
    addMesh(thigh, new THREE.BoxGeometry(0.2, 0.16, 0.2), matMetalDark, [0, -0.02, 0]);

    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.46;
    thigh.add(kneePivot);
    kneePivot.rotation.x = 0.25;

    const shin = new THREE.Group();
    kneePivot.add(shin);
    addMesh(shin, new THREE.CylinderGeometry(0.09, 0.06, 0.42, 8), matMetalSteel, [0, -0.21, 0]);
    addMesh(shin, new THREE.CylinderGeometry(0.018, 0.018, 0.4, 6), matVeinGlow, [0.06, -0.21, 0.04]);

    const anklePivot = new THREE.Group();
    anklePivot.position.y = -0.42;
    shin.add(anklePivot);
    anklePivot.rotation.x = -0.35;

    const foot = new THREE.Group();
    anklePivot.add(foot);
    addMesh(foot, new THREE.BoxGeometry(0.14, 0.08, 0.26), matMetalDark, [0, -0.04, 0.06]);
    addMesh(foot, new THREE.ConeGeometry(0.06, 0.12, 4), matMetalScorch, [0, -0.04, 0.2], [Math.PI / 2, 0, 0]);

    rig["hip" + side] = hipPivot;
    rig["thigh" + side] = thigh;
    rig["knee" + side] = kneePivot;
    rig["shin" + side] = shin;
    rig["ankle" + side] = anklePivot;
    rig["foot" + side] = foot;
  }
  // Legs intentionally NOT built — the Warden is a flying entity (redesign). The
  // buildLeg factory is retained above but never invoked, so no leg bones/meshes exist.

  // ── Back: tesla-coil conductor fan ──────────────────────────────────────────
  const backRig = new THREE.Group();
  backRig.position.set(0, 0.26, -0.3);
  chest.add(backRig);
  rig.backRig = backRig; // exposed for consistency (arc lines & rods live under it)
  rig.rods = [];
  [
    { x: -0.32, baseY: 0.0, h: 0.34, tilt: -0.5 },
    { x: -0.14, baseY: 0.08, h: 0.5, tilt: -0.22 },
    { x: 0.04, baseY: 0.16, h: 0.66, tilt: 0.0 },
    { x: 0.22, baseY: 0.1, h: 0.46, tilt: 0.25 },
    { x: 0.38, baseY: 0.02, h: 0.3, tilt: 0.45 },
  ].forEach((d, i) => {
    const rodGroup = new THREE.Group();
    rodGroup.position.set(d.x, d.baseY, 0);
    rodGroup.rotation.z = d.tilt;
    backRig.add(rodGroup);
    addMesh(rodGroup, new THREE.CylinderGeometry(0.02, 0.028, d.h, 8), matMetalGold, [0, d.h * 0.5, 0]);
    // Store the tip mesh reference for independent animation (same geometry/material, just saving returned value)
    const tipMesh = addMesh(rodGroup, new THREE.ConeGeometry(0.05, 0.1, 6), matCrownGlow, [0, d.h + 0.04, 0]);
    // Clone the crown glow material per rod so each tip can animate opacity independently
    const tipMat = matCrownGlow.clone();
    tipMat.userData.isRodTip = true; // animated separately below → skip in the bulk glow pass
    energyMats.push(tipMat);
    tipMesh.material = tipMat;
    rig.rods.push({ group: rodGroup, basePos: [d.x, d.baseY, 0], baseTilt: d.tilt, tipMesh, tipMat, tipY: d.h + 0.04 });
  });

  // ── Skeleton conversion: pivot groups → Bones + Skeleton + one SkinnedMesh ───
  function convertToBone(obj, name) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.copy(obj.position);
    bone.quaternion.copy(obj.quaternion);
    bone.scale.copy(obj.scale);
    const parent = obj.parent;
    [...obj.children].forEach((c) => bone.add(c));
    if (parent) { parent.add(bone); parent.remove(obj); }
    return bone;
  }
  const boneKeys = [
    "pelvis", "spine", "chest", "head", "crown",
    "shoulderL", "upperArmL", "elbowL", "forearmL", "handL",
    "shoulderR", "upperArmR", "elbowR", "forearmR", "cannonR",
    // legs removed — flying redesign
  ];
  boneKeys.forEach((key) => { if (rig[key]) rig[key] = convertToBone(rig[key], key); });
  pelvis = rig.pelvis;
  spine = rig.spine;

  const bones = [];
  warden.traverse((o) => { if (o.isBone) bones.push(o); });
  const skeleton = new THREE.Skeleton(bones);

  // Energy/VFX parts animate beyond their parent bone, so keep them OUT of the
  // baked skin (left as live bone-attached children).
  const excludeFromSkin = new Set([rig.reactorCore, rig.faceCore]);
  if (rig.muzzle) excludeFromSkin.add(rig.muzzle);
  rig.crownShards.forEach((s) => excludeFromSkin.add(s));
  backRig.traverse((o) => { if (o.isMesh) excludeFromSkin.add(o); });
  const energySet = new Set([matCoreGlow, matVeinGlow, matCrownGlow]);
  warden.traverse((o) => { if (o.isMesh && energySet.has(o.material)) excludeFromSkin.add(o); });
  // Also exclude individually-cloned rod tip materials
  rig.rods.forEach((r) => { if (r.tipMesh) excludeFromSkin.add(r.tipMesh); });

  function buildSkinnedBody() {
    warden.updateMatrixWorld(true);
    const candidates = [];
    warden.traverse((o) => { if (o.isMesh && !excludeFromSkin.has(o)) candidates.push(o); });

    const uniqueMaterials = [];
    const matIndexOf = (m) => {
      let i = uniqueMaterials.indexOf(m);
      if (i < 0) { i = uniqueMaterials.length; uniqueMaterials.push(m); }
      return i;
    };
    const prepared = [];
    candidates.forEach((mesh) => {
      mesh.updateWorldMatrix(true, false);
      let anc = mesh.parent;
      while (anc && !anc.isBone) anc = anc.parent;
      if (!anc) return;
      const boneIdx = bones.indexOf(anc);
      if (boneIdx < 0) return;
      let geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld); // bake to bind-pose world space
      if (geo.index) geo = geo.toNonIndexed();
      const vCount = geo.attributes.position.count;
      const skinIndex = new Uint16Array(vCount * 4);
      const skinWeight = new Float32Array(vCount * 4);
      for (let i = 0; i < vCount; i++) { skinIndex[i * 4] = boneIdx; skinWeight[i * 4] = 1; }
      geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
      geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
      prepared.push({ geo, materialIndex: matIndexOf(mesh.material) });
      mesh.parent.remove(mesh);
      mesh.geometry?.dispose?.();
    });

    const merged = mergeGeometries(prepared.map((p) => p.geo), false);
    prepared.forEach((p) => p.geo.dispose?.());
    if (!merged) return null;
    let offset = 0;
    prepared.forEach((p) => {
      const count = p.geo.attributes.position.count;
      merged.addGroup(offset, count, p.materialIndex);
      offset += count;
    });
    const skinnedMesh = new THREE.SkinnedMesh(merged, uniqueMaterials);
    skinnedMesh.castShadow = true; // per-frame shadow map: Warden casts a sun shadow
    skinnedMesh.receiveShadow = false;
    skinnedMesh.frustumCulled = false;
    skinnedMesh.name = "StormWardenBody";
    warden.add(skinnedMesh);
    warden.updateMatrixWorld(true);
    skinnedMesh.bind(skeleton);
    return skinnedMesh;
  }
  const body = buildSkinnedBody();

  // ── Ground the model so feet sit at y≈0 (callers stand it on the floor) ──────
  warden.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(warden);
  if (!box.isEmpty()) warden.position.y -= box.min.y;

  // ── VFX geometry (live children, NOT baked into the SkinnedMesh) ───────────

  // Discharge ring: flat horizontal ring parented to the chest bone.
  // On every lightning fire it blasts outward from scale 0 to ~6, then fades.
  const dischargeRingMat = new THREE.MeshBasicMaterial({
    color: 0xdd66ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  allMaterials.push(dischargeRingMat);
  const dischargeRing = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.90, 36), dischargeRingMat);
  dischargeRing.rotation.x = Math.PI / 2; // lie flat
  dischargeRing.frustumCulled = false;
  rig.chest.add(dischargeRing);

  // Arc lines: electricity crackling between adjacent rod tips every frame.
  // Geometry vertices are re-randomized each frame for a jagged lightning look.
  const ARC_PTS = 9; // intermediate jagged points per arc segment
  const arcBaseMat = new THREE.LineBasicMaterial({
    color: 0xff99ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  allMaterials.push(arcBaseMat);
  rig.arcLines = [];
  for (let i = 0; i < rig.rods.length - 1; i++) {
    const nPts   = ARC_PTS + 2; // 2 endpoints + ARC_PTS intermediate
    const posArr = new Float32Array(nPts * 3);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const mat    = arcBaseMat.clone();
    allMaterials.push(mat);
    const arcLine = new THREE.Line(arcGeo, mat);
    arcLine.frustumCulled = false;
    backRig.add(arcLine); // backRig follows chest bone
    rig.arcLines.push({ arcLine, posArr, nPts, mat });
  }
  // Reusable vector for world→local arc tip calculations
  const _arcV = new THREE.Vector3();

  // Footstep impact rings: a flat energy ring flashes on the floor when a foot
  // plants, expanding and fading. Sells the weight of each step now that the legs
  // are load-bearing. Parented to each foot bone so they sit at the contact point.
  const footRingMatBase = new THREE.MeshBasicMaterial({
    color: 0x9ab8ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  allMaterials.push(footRingMatBase);
  const makeFootRing = (footBone) => {
    const mat = footRingMatBase.clone();
    allMaterials.push(mat);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.22, 22), mat);
    ring.rotation.x = -Math.PI / 2;  // lie flat on the floor
    ring.position.y = -0.06;         // at the sole
    ring.frustumCulled = false;
    footBone.add(ring);
    return { ring, mat };
  };
  rig.footRingL = rig.footL ? makeFootRing(rig.footL) : null;
  rig.footRingR = rig.footR ? makeFootRing(rig.footR) : null;

  // ── Animation ───────────────────────────────────────────────────────────────
  const damp = THREE.MathUtils.damp;
  const clamp      = (v, a, b) => Math.max(a, Math.min(b, v));
  const clamp01    = (v) => clamp(v, 0, 1);
  // S-curve: slow → fast → slow. Removes the "linear jerk" from raw lerps.
  const smoothstep  = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
  // Extra-smooth S-curve: used for arms/spine where any sharpness reads as a jerk.
  const smootherStep= (t) => { const c = clamp01(t); return c * c * c * (c * (c * 6 - 15) + 10); };

  // ── Two-bone leg IK (analytic, sagittal plane) ──────────────────────────────
  // ── Flying Warden animation ─────────────────────────────────────────────────
  // Redesign: the Warden is a legless flying entity. When it RUSHES the player at
  // speed its parts (arms, head, crown, rods, shards) detach and float apart; when
  // it slows to ATTACK they snap back together and it fires a lightning strike.
  const HOVER_BASE = 0.85;          // resting float height above the grounded base
  let elapsed = 0;
  let baseY = null;
  let dead = false, deadTime = 0;
  let prevIsAttacking = false;

  let attackWindUp = 0;             // 0→1 charge
  let attackFireFlash = 0;          // 0→1→0 on fire
  let fireHoldTimer = 0;
  let reactorPulsePhase = 0;
  let crownSpin = 0;
  let hoverPhase = Math.random() * Math.PI * 2;

  let separation = 0;               // 0 = assembled (attacking), 1 = scattered (flying fast)
  let bodyPitch = 0;                // forward dive tilt
  let bodyBank = 0;                 // roll into turns

  // AI-phase pose blends (driven by enemyRef.aiPhase from the game's warden brain).
  // Smoothed 0..1 weights so phase changes read as deliberate posture shifts.
  let poseRush = 0;                 // hunt: arms swept back, head down, rod fan folded flat
  let poseAnchor = 0;               // anchor: planted stance, rod fan flared open
  let poseRecover = 0;              // recover: loose side-drift sway
  let latBank = 0;                  // strafe bank from lateral velocity

  let ringPulseScale = 0.08, ringPulseOpacity = 0;
  let rageBlend = 0;
  const rageColor = new THREE.Color(palette.rage ?? 0xffb8ff);

  // ── Per-instance desync seeds (zombie-organic pattern) ──────────────────────
  // Random phase offsets + detuned frequencies so several angels on screen never
  // move in unison. Reseeded on pool recycle via setDead(false).
  const seed: Record<string, any> = {};
  function reseed() {
    seed.f1 = 0.85 + Math.random() * 0.3;
    seed.f2 = 0.85 + Math.random() * 0.3;
    seed.f3 = 0.85 + Math.random() * 0.3;
    seed.p1 = Math.random() * Math.PI * 2;
    seed.p2 = Math.random() * Math.PI * 2;
    seed.p3 = Math.random() * Math.PI * 2;
    seed.tw = 0.6 + Math.random() * 1.2;  // Seraph head-twitch cadence
    seed.fr = 2.2 + Math.random() * 2.6;  // Cherub freeze cadence
    hoverPhase = Math.random() * Math.PI * 2;
  }

  // ── Expressive-motion state (all springs/damps — never accumulated into
  //    transforms; offsets are recomputed from base poses every frame) ─────────
  let headYaw = 0;                      // smoothed head look offset (all variants)
  let twitchTimer = 0.8, twitchYaw = 0; // Seraph: sudden head snaps
  let freezeTimer = 3, freezeHold = 0, freezeTilt = 0, bobGate = 1; // Cherub freeze-then-tilt
  let prevSpeedNorm = 0, overshoot = 0, overshootVel = 0; // Seraph stop-overshoot spring
  let flinch = 0, flinchVel = 0, prevHitFlash = 0, flinchSide = 1; // hit reaction spring
  let crownWobble = 0, crownWobbleVel = 0, prevTurn = 0; // halo wobble on hard turns
  let rodLagPitch = 0;                  // back-rig rods lag the body pitch (delayed follow)
  let shardFlare = 0;                   // Warden crown shards flare when aggroed
  let barrageBlend = 0;                 // Warden Rolling Barrage stance
  let channelBlend = 0;                 // Cherub Sanctuary Collapse channel stance
  let empFlash = 0, prevEmpT = 0;       // Cherub Null Field EMP release pop
  let blinkCrouch = 0, arrivalWhip = 0, prevPhaseOut = 0; // Seraph blink coil + arrival whip
  reseed();

  // Separable parts, captured on first update (after the skeleton settles into bind).
  // Each stores its base local transform + a scatter direction/amplitude + a tumble.
  let _captured = false;
  const sepParts = [];
  function captureParts() {
    const add = (obj, dir, amp, spin, isShard?) => {
      if (!obj) return;
      sepParts.push({
        obj, isCrown: obj === rig.crown, isShard: !!isShard,
        bx: obj.position.x, by: obj.position.y, bz: obj.position.z,
        rx: obj.rotation.x, ry: obj.rotation.y, rz: obj.rotation.z,
        dx: dir[0], dy: dir[1], dz: dir[2], amp,
        sx: spin[0], sy: spin[1], sz: spin[2],
      });
    };
    add(rig.shoulderL, [-1.0, 0.35, 0.5], 0.55, [0.6, 0.8, -0.7]);
    add(rig.shoulderR, [ 1.0, 0.35, 0.5], 0.55, [0.6, -0.8, 0.7]);
    add(rig.head,      [ 0.0, 0.7, -0.35], 0.34, [0.3, 0.5, 0.0]);
    add(rig.crown,     [ 0.0, 0.9, 0.0],  0.42, [0.0, 1.4, 0.0]);
    rig.rods.forEach((r, i) => add(r.group, [(i - 2) * 0.5, 0.45, -0.8], 0.5, [0.7, 0.3, (i - 2) * 0.4]));
    rig.crownShards.forEach((s, i) => {
      const a = i * 1.7;
      add(s, [Math.cos(a), 0.5, Math.sin(a)], 0.6, [0.8, 0.8, 0.8], true);
    });
    _captured = true;
  }

  // Scatter parts outward by `sep` (0..1) with a floating tumble; crown.y is left for
  // the spin term applied afterwards.
  function applySeparation(sep, tumble) {
    for (const p of sepParts) {
      const o = sep * p.amp;
      p.obj.position.set(p.bx + p.dx * o, p.by + p.dy * o, p.bz + p.dz * o);
      const wobX = Math.sin(tumble * 0.9 + p.bx * 4);
      const wobZ = Math.cos(tumble * 0.7 + p.bz * 4);
      p.obj.rotation.set(
        p.rx + p.sx * sep * wobX,
        p.ry + p.sy * sep,
        p.rz + p.sz * sep * wobZ,
      );
    }
  }

  function update(dt, enemyRef) {
    if (dt > 0.1) dt = 0.1;
    elapsed += dt;
    if (!_captured) captureParts();
    if (baseY === null) baseY = warden.position.y;

    const alive       = enemyRef ? enemyRef.alive !== false : true;
    const isAttacking = !!enemyRef?.isAttacking;
    const atkPulse    = clamp01((enemyRef?.attackPulse || 0) / 1.2);
    const windUpTimer = enemyRef?.lightningWindUp || 0;
    const windUpProgress = windUpTimer > 0 ? clamp01(1 - windUpTimer / 0.34) : 0;
    const visualTurn  = enemyRef?.visualTurn || 0;
    const visualSpeed = enemyRef?.visualSpeed || 0;
    const hpRatio     = (enemyRef && enemyRef.maxHp > 0) ? clamp01(enemyRef.hp / enemyRef.maxHp) : 1;

    // Variant identity (all three angels share this rig factory).
    const tn = enemyRef?.typeName;
    const isSeraph = tn === "Blink Seraph";
    const isCherub = tn === "Null Cherub";

    if (!alive && !dead) { dead = true; deadTime = 0; }
    if (dead) { _updateDead(dt); return; }

    // ── Ability stance blends (anticipation → release, keyed off existing AI
    //    timings; no AI/ability logic changed here) ───────────────────────────
    barrageBlend = damp(barrageBlend, enemyRef?.barrageActive === true ? 1 : 0, 5, dt);
    channelBlend = damp(channelBlend, (enemyRef?.megaBlastTimer || 0) > 0 ? 1 : 0, 7, dt);
    const empT = enemyRef?.empWindUp || 0;
    const empCharge = empT > 0 ? clamp01(1 - empT / 0.6) : 0; // parts contract as EMP charges
    if (prevEmpT > 0 && empT <= 0) empFlash = 1;              // release pop on detonation
    prevEmpT = empT;
    empFlash = damp(empFlash, 0, 8, dt);

    // ── Hit reaction: underdamped flinch spring driven by enemyRef.hitFlash ──
    const hitFlash = enemyRef?.hitFlash || 0;
    if (hitFlash > prevHitFlash + 0.04) {
      flinchVel += 5 + hitFlash * 7;   // impulse; spring below snaps then settles
      flinchSide = -flinchSide;        // alternate jerk direction per hit
      crownWobbleVel += flinchSide * 2.2; // halo kicked by the impact too
    }
    prevHitFlash = hitFlash;
    flinchVel += (-flinch * 110 - flinchVel * 12) * dt;
    flinch += flinchVel * dt;

    // ── Halo wobble on hard direction changes (spring on turn-rate delta) ────
    crownWobbleVel += (visualTurn - prevTurn) * 2.4;
    prevTurn = visualTurn;
    crownWobbleVel += (-crownWobble * 90 - crownWobbleVel * 7) * dt;
    crownWobble += crownWobbleVel * dt;

    // ── Charge / fire ───────────────────────────────────────────────────────
    attackWindUp = damp(attackWindUp, Math.max(atkPulse, windUpProgress), isAttacking ? 10 : 4.5, dt);
    if (isAttacking && !prevIsAttacking) { attackFireFlash = 1; fireHoldTimer = 0.08; ringPulseScale = 0.08; ringPulseOpacity = 1; }
    prevIsAttacking = isAttacking;
    if (fireHoldTimer > 0) fireHoldTimer -= dt; else attackFireFlash = damp(attackFireFlash, 0, 14, dt);
    const charge = smoothstep(attackWindUp);

    // ── Separation: rush fast → parts shift apart slightly, slow/charging → snap ─────
    // Kept SUBTLE (×0.32) with a slower tumble — the old full scatter read as a janky
    // "fly-apart". Now it's a cohesive body that only loosens a little at speed.
    // EXCEPT during a Blink phase-out (enemyRef.phaseOut 0..1): the Seraph's body
    // FULLY scatters for the teleport hold, then snaps back together on arrival —
    // "reassembles out of the lightning".
    const speedNorm = clamp01(visualSpeed / 6.0);
    const phaseOut = clamp01(enemyRef?.phaseOut || 0);
    const sepTarget = Math.max(phaseOut, clamp01(smoothstep(speedNorm) * (1 - charge) - charge * 0.5) * 0.32);
    // assemble FAST (snap to attack), scatter a touch slower; phase-out scatters fast too
    separation = damp(separation, sepTarget, sepTarget > separation ? (phaseOut > 0 ? 14 : 5) : 9, dt);
    applySeparation(separation, elapsed * 2.4);

    // Seraph Blink Strike: coil/compress into the phase-out, whip on arrival.
    blinkCrouch = damp(blinkCrouch, phaseOut, 16, dt);
    if (prevPhaseOut > 0.5 && phaseOut <= 0.01) arrivalWhip = 1; // reassembled — snap
    prevPhaseOut = phaseOut;
    arrivalWhip = damp(arrivalWhip, 0, 6, dt);

    // ── Post-separation part offsets (applySeparation just reset every part to
    //    its base pose, so these are pure per-frame offsets — never accumulate) ─
    // Cherub: parts contract inward while channeling Sanctuary Collapse or
    // charging the EMP, then pop outward on the EMP release.
    const contract = Math.max(channelBlend * 0.45, empCharge * 0.75);
    if (contract > 0.01 || empFlash > 0.01) {
      const k = -contract * 0.3 + empFlash * 0.5;
      for (const p of sepParts) {
        p.obj.position.x += p.dx * p.amp * k;
        p.obj.position.y += p.dy * p.amp * k;
        p.obj.position.z += p.dz * p.amp * k;
      }
    }
    // Warden: crown shards flare outward on aggro, charge INWARD during the
    // Judgment Lance wind-up, then blast out with the shot (anticipation-snap).
    shardFlare = damp(shardFlare, enemyRef?.aggroed ? 1 : 0, 3, dt);
    const shardK = shardFlare * 0.10 - smootherStep(attackWindUp) * 0.16 + attackFireFlash * 0.22;
    if (Math.abs(shardK) > 0.005) {
      for (const p of sepParts) {
        if (!p.isShard) continue;
        p.obj.position.x += p.dx * shardK;
        p.obj.position.y += p.dy * shardK;
        p.obj.position.z += p.dz * shardK;
      }
    }

    // ── Hover float — per-variant personality + per-instance desync ──────────
    hoverPhase += dt * (isSeraph ? 1.7 : 1.2) * seed.f1;
    let bob;
    if (isCherub) {
      // Erratic: multiple detuned sines, gated by the freeze-then-tilt beat.
      freezeTimer -= dt;
      if (freezeHold > 0) {
        freezeHold -= dt;
        bobGate = damp(bobGate, 0, 18, dt);            // sudden freeze
        if (freezeHold <= 0) { freezeTimer = seed.fr + Math.random() * 2.5; freezeTilt = 0; }
      } else {
        bobGate = damp(bobGate, 1, 3, dt);             // slow resume
        if (freezeTimer <= 0) {
          freezeHold = 0.30 + Math.random() * 0.35;
          freezeTilt = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.25);
        }
      }
      bob = (Math.sin(hoverPhase * 0.9 + seed.p1) * 0.07
           + Math.sin(hoverPhase * 1.63 * seed.f2 + seed.p2) * 0.05
           + Math.sin(hoverPhase * 2.71 + seed.p3) * 0.03) * bobGate;
    } else {
      bobGate = 1;
      bob = Math.sin(hoverPhase + seed.p1) * 0.10 + Math.cos(hoverPhase * 1.9 + 0.7 + seed.p2) * 0.04;
    }
    warden.position.y = baseY + HOVER_BASE + bob + charge * 0.35 + separation * 0.18
      + barrageBlend * 0.22           // Warden rises calling the barrage line
      - blinkCrouch * 0.26            // Seraph compresses into the blink
      + channelBlend * 0.10           // Cherub lifts slightly while channeling
      - empCharge * 0.14;             // ...but hunkers as the EMP compresses

    // ── AI-phase pose weights ───────────────────────────────────────────────
    // The game's warden brain publishes enemyRef.aiPhase (hunt/advance/anchor/
    // recover). Blend smoothed weights so posture shifts read as deliberate.
    const aiPhase = enemyRef?.aiPhase || null;
    poseRush    = damp(poseRush,    aiPhase === "hunt" ? 1 : smoothstep(speedNorm) * 0.55, 4.5, dt);
    poseAnchor  = damp(poseAnchor,  aiPhase === "anchor" ? 1 : 0, 5.5, dt);
    poseRecover = damp(poseRecover, aiPhase === "recover" ? 1 : 0, 4, dt);

    // Lateral (strafe) velocity in the body frame → banking into the slide.
    let latNorm = 0;
    if (enemyRef?.mesh) {
      const yawv = enemyRef.mesh.rotation.y;
      const vX = enemyRef.smoothVelX || 0, vZ = enemyRef.smoothVelZ || 0;
      latNorm = clamp((vX * Math.cos(yawv) - vZ * Math.sin(yawv)) / 8.0, -1, 1);
    }
    latBank = damp(latBank, latNorm * 0.34, 5, dt);

    // ── Seraph: overshoot when it stops hard (afterimage-y follow-through) ───
    const decel = prevSpeedNorm - speedNorm;
    prevSpeedNorm = speedNorm;
    if (isSeraph && decel > 0.045) overshootVel += decel * 14;
    overshootVel += (-overshoot * 130 - overshootVel * 9) * dt;
    overshoot += overshootVel * dt;

    // ── Dive tilt + bank + idle sway ────────────────────────────────────────
    // Anticipation: Warden rears back through the lance wind-up (charge term),
    // Cherub bows forward into its channel.
    bodyPitch = damp(bodyPitch, -separation * 0.5 - speedNorm * 0.12 - poseRush * 0.16 + poseAnchor * 0.06
      + charge * 0.20 - channelBlend * 0.12, 4, dt);
    bodyBank  = damp(bodyBank, clamp(visualTurn * -0.22, -0.5, 0.5), 6, dt);
    // Release + follow-through: forward snap on fire, whip on blink arrival,
    // overshoot spring on hard stops. All decay back through their own damps.
    rig.spine.rotation.x = bodyPitch - attackFireFlash * 0.45 - arrivalWhip * 0.3 - overshoot * 0.5;
    // Seraph cants harder into its strafes (extra bank from lateral velocity).
    rig.chest.rotation.z = bodyBank + latBank * (isSeraph ? 2.0 : 1.0) + flinch * 0.05 * flinchSide;
    rig.chest.rotation.x = flinch * 0.09 - channelBlend * 0.15 + empCharge * 0.12;
    // Seraph: constant fast micro-adjustments; others hold steady.
    rig.chest.rotation.y = isSeraph
      ? (Math.sin(elapsed * 9.3 * seed.f1) + Math.sin(elapsed * 13.7 + seed.p1)) * 0.012
      : 0;
    // Warden idle sway is slower + weightier; per-instance detuned everywhere.
    const swayAmp = isSeraph ? 0.03 : isCherub ? 0.04 : 0.06;
    const swaySpd = isSeraph ? 0.55 : isCherub ? 0.24 : 0.3;
    rig.spine.rotation.y = Math.sin(elapsed * swaySpd * seed.f2 + seed.p2) * swayAmp * (1 - separation)
      + poseRecover * Math.sin(elapsed * 1.7 * seed.f3 + seed.p3) * 0.12; // recover: loose scanning sway

    // ── Arm aim + locomotion arm posture ────────────────────────────────────
    // (Shoulders/head/rods are reset by applySeparation each frame, so these
    // additive offsets never accumulate.)
    const aim = smootherStep(attackWindUp) * (1 - separation);
    if (rig.shoulderR) rig.shoulderR.rotation.x -= aim * 1.0 + attackFireFlash * 0.4;
    if (rig.shoulderL) rig.shoulderL.rotation.x -= aim * 0.7;
    // Rush: arms trail behind like swept wings; anchor: squared-up stance.
    if (rig.shoulderL) { rig.shoulderL.rotation.x += poseRush * 0.55 - poseAnchor * 0.12; rig.shoulderL.rotation.z += poseRush * 0.34; }
    if (rig.shoulderR) { rig.shoulderR.rotation.x += poseRush * 0.5  - poseAnchor * 0.08; rig.shoulderR.rotation.z -= poseRush * 0.34; }
    // ── Per-variant head + shoulder personality (additive after the
    //    applySeparation reset, so nothing accumulates) ───────────────────────
    if (isSeraph) {
      // Quick, twitchy, alert: sudden head snaps toward new bearings.
      twitchTimer -= dt;
      if (twitchTimer <= 0) {
        twitchTimer = seed.tw * (0.5 + Math.random());
        twitchYaw = (Math.random() - 0.5) * 0.9;
      }
      headYaw = damp(headYaw, twitchYaw + clamp(visualTurn * 0.6, -0.4, 0.4), 16, dt); // snap-fast
    } else if (isCherub) {
      // Slow creepy observation drift + the freeze-tilt.
      headYaw = damp(headYaw, Math.sin(elapsed * 0.31 * seed.f3 + seed.p3) * 0.3, 2.2, dt);
    } else {
      // Warden: head/visor leads its turns (deliberate hunter tracking).
      headYaw = damp(headYaw, clamp(visualTurn * 0.9, -0.55, 0.55), 6, dt);
    }
    if (rig.head) {
      rig.head.rotation.y += headYaw;
      rig.head.rotation.z += flinch * 0.06 * flinchSide
        + (isCherub ? Math.sin(elapsed * 0.23 * seed.f2 + seed.p2) * 0.16 + freezeTilt * (1 - bobGate) : 0);
      rig.head.rotation.x += flinch * -0.08 - channelBlend * 0.25;
    }
    // Warden: shoulders counter-rotate against the sway as it moves (weighty gait).
    if (!isSeraph && !isCherub) {
      const cnt = Math.sin(elapsed * 0.9 * seed.f2 + seed.p2) * 0.05 * (0.4 + speedNorm * 0.6);
      if (rig.shoulderL) rig.shoulderL.rotation.y += cnt;
      if (rig.shoulderR) rig.shoulderR.rotation.y -= cnt;
    }
    // Cherub: arms rise into the channel/EMP charge, thrown wide on EMP release.
    if (channelBlend > 0.01 || empCharge > 0.01 || empFlash > 0.01) {
      if (rig.shoulderL) { rig.shoulderL.rotation.x -= channelBlend * 1.15 + empCharge * 0.5; rig.shoulderL.rotation.z += empFlash * 0.5; }
      if (rig.shoulderR) { rig.shoulderR.rotation.x -= channelBlend * 1.05 + empCharge * 0.5; rig.shoulderR.rotation.z -= empFlash * 0.5; }
    }
    // Head: tucks into the dive at rush speed, lifts to sight the target on anchor.
    if (rig.head) rig.head.rotation.x += poseRush * 0.26 - poseAnchor * 0.12;
    // Rod fan: folds flat backwards in the rush, flares wide open while charging;
    // Rolling Barrage flares it even wider and lifts it (calling down the line).
    // The whole fan also LAGS the body pitch (delayed-follow secondary motion).
    rodLagPitch = damp(rodLagPitch, bodyPitch, 7, dt);
    const rodLag = (rodLagPitch - bodyPitch) * 1.6;
    const fanOpen = poseAnchor * (0.45 + charge * 0.8) - poseRush * 0.5 + barrageBlend * 0.55 + channelBlend * 0.4;
    for (let ri = 0; ri < rig.rods.length; ri++) {
      const rod = rig.rods[ri];
      rod.group.rotation.z += ((ri - 2) / 2) * fanOpen * 0.5; // spread outward from the centre rod
      rod.group.rotation.x += -poseRush * 0.65 + poseAnchor * 0.1 - barrageBlend * 0.35 + rodLag; // sweep back / present / lift
    }

    // ── Reactor / face core / crown spin ────────────────────────────────────
    reactorPulsePhase += (1.2 + atkPulse * 2.8) * Math.PI * 2 * dt;
    if (rig.reactorCore) rig.reactorCore.scale.setScalar(Math.max(0.1, 1 + Math.sin(reactorPulsePhase) * 0.13 + charge * 0.7 + attackFireFlash * 1.6));
    if (rig.faceCore)    rig.faceCore.scale.setScalar(1 + charge * 0.7 + attackFireFlash * 2.2);
    crownSpin += (0.6 + charge * charge * 7 + separation * 5 + attackFireFlash * 14 + rageBlend * 6) * dt;
    if (rig.crown) {
      rig.crown.rotation.y = crownSpin; // override the separation Y term
      rig.crown.rotation.z += crownWobble; // halo wobble on hard turns / hits
    }

    // ── Energy glow ─────────────────────────────────────────────────────────
    const glow = clamp01(0.5 + 0.4 * Math.sin(reactorPulsePhase) + charge * 0.6 + attackFireFlash * 0.5);
    energyMats.forEach((m) => { if (!m.userData.isRodTip && !m.userData.isVisor) m.opacity = damp(m.opacity, glow, 10, dt); });
    rig.rods.forEach((r) => { if (r.tipMat) r.tipMat.opacity = damp(r.tipMat.opacity, glow, 10, dt); });
    // Visor slit: quick-pulses on attacks/EMP (fast attack, slower settle).
    const visorTarget = clamp01(0.55 + charge * 0.5 + attackFireFlash * 1.4 + empFlash * 1.2 + Math.abs(flinch) * 0.3);
    matVisor.opacity = damp(matVisor.opacity, visorTarget, (attackFireFlash > 0.3 || empFlash > 0.3) ? 30 : 8, dt);

    // ── Arc electricity between rod tips (matches the lightning aesthetic) ───
    const arcIntensity = clamp01(smoothstep(clamp01((attackWindUp - 0.25) / 0.75)) * 0.85 + rageBlend * 0.5 + attackFireFlash * 0.6);
    if (arcIntensity > 0.01) {
      rig.rods.forEach((r) => { if (!r._wt) r._wt = new THREE.Vector3(); r.tipMesh.getWorldPosition(r._wt); });
      rig.arcLines.forEach(({ arcLine, posArr, nPts, mat }, ai) => {
        const rA = rig.rods[ai], rB = rig.rods[ai + 1];
        backRig.worldToLocal(_arcV.copy(rA._wt)); const ax = _arcV.x, ay = _arcV.y, az = _arcV.z;
        backRig.worldToLocal(_arcV.copy(rB._wt)); const bx = _arcV.x, by = _arcV.y, bz = _arcV.z;
        const jag = 0.14 * arcIntensity;
        for (let p = 0; p < nPts; p++) {
          const tt = p / (nPts - 1), env = Math.sin(tt * Math.PI);
          posArr[p * 3]     = ax + (bx - ax) * tt + (Math.random() - 0.5) * 2 * jag * env;
          posArr[p * 3 + 1] = ay + (by - ay) * tt + (Math.random() - 0.5) * 2 * jag * env;
          posArr[p * 3 + 2] = az + (bz - az) * tt + (Math.random() - 0.5) * jag * env;
        }
        arcLine.geometry.attributes.position.needsUpdate = true;
        mat.opacity = arcIntensity * clamp01(0.45 + Math.sin(elapsed * 19.3 + ai * 2.1) * 0.55);
      });
    } else {
      rig.arcLines.forEach(({ mat }) => { mat.opacity = 0; });
    }

    // ── Discharge ring on fire ──────────────────────────────────────────────
    if (ringPulseOpacity > 0.01) {
      ringPulseScale += (2.5 + ringPulseScale * 2.8) * dt;
      ringPulseOpacity = damp(ringPulseOpacity, 0, 2.6, dt);
      dischargeRing.scale.setScalar(ringPulseScale);
      dischargeRingMat.opacity = ringPulseOpacity * 0.8;
    } else {
      dischargeRingMat.opacity = 0; ringPulseScale = 0.08;
    }

    // ── Rage (< 40% HP): tremor + overload colour ───────────────────────────
    rageBlend = damp(rageBlend, smoothstep(clamp01(1 - hpRatio / 0.40)), 1.2, dt);
    if (rageBlend > 0.01) {
      const rt = rageBlend;
      rig.spine.rotation.x += Math.sin(elapsed * 57) * 0.05 * rt;
      rig.chest.rotation.z += Math.cos(elapsed * 44) * 0.04 * rt;
      energyMats.forEach((m) => { if (m.userData.baseColor) m.color.lerpColors(m.userData.baseColor, rageColor, rt * 0.7); });
    }
  }

  function _updateDead(dt) {
    deadTime += dt;
    if (!_captured) captureParts();
    const t = clamp01(deadTime / 1.4);
    const blast = smootherStep(t);
    // reactor swells then implodes
    if (rig.reactorCore) {
      const rs = deadTime < 0.4 ? 1 + (deadTime / 0.4) * 3.5 : Math.max(0, 1 - (deadTime - 0.4) * 5);
      rig.reactorCore.scale.setScalar(Math.max(0, rs));
    }
    if (rig.faceCore) rig.faceCore.scale.setScalar(Math.max(0, 1 - t * 1.5));
    // all parts blast outward and tumble — each part on a slightly staggered,
    // eased timeline (reads as a collapse rippling through the body, not one
    // uniform pop). Stagger is derived from the part's base position (stable,
    // no per-frame allocation or randomness).
    for (let pi = 0; pi < sepParts.length; pi++) {
      const p = sepParts[pi];
      const stag = (pi % 5) * 0.05;
      const pb = smootherStep(clamp01((deadTime - stag) / 1.4));
      const o = (0.4 + pb * 1.8) * p.amp;
      const sag = pb * pb * 0.55; // parts sink as they die (gravity read)
      p.obj.position.set(p.bx + p.dx * o, p.by + p.dy * o - sag, p.bz + p.dz * o);
      p.obj.rotation.set(p.rx + p.sx * pb * 5, p.ry + p.sy * pb * 5, p.rz + p.sz * pb * 5);
    }
    if (baseY !== null) warden.position.y = damp(warden.position.y, baseY + HOVER_BASE - blast * 0.7, 3, dt);
    energyMats.forEach((m) => { m.opacity = damp(m.opacity, Math.max(0, 1 - t * 1.3), 8, dt); });
    if (dischargeRingMat) dischargeRingMat.opacity = 0;
    rig.arcLines?.forEach(({ mat }) => { mat.opacity = 0; });
  }

  function setDead(v = true) {
    dead = v;
    if (!v) {
      deadTime = 0; separation = 0; attackWindUp = 0; attackFireFlash = 0;
      bodyPitch = 0; bodyBank = 0; ringPulseOpacity = 0; rageBlend = 0; crownSpin = 0;
      poseRush = 0; poseAnchor = 0; poseRecover = 0; latBank = 0;
      // Expressive-motion state + fresh per-instance desync seeds (pool recycle).
      headYaw = 0; twitchTimer = 0.8; twitchYaw = 0;
      freezeTimer = 3; freezeHold = 0; freezeTilt = 0; bobGate = 1;
      prevSpeedNorm = 0; overshoot = 0; overshootVel = 0;
      flinch = 0; flinchVel = 0; prevHitFlash = 0; flinchSide = 1;
      crownWobble = 0; crownWobbleVel = 0; prevTurn = 0;
      rodLagPitch = 0; shardFlare = 0;
      barrageBlend = 0; channelBlend = 0; empFlash = 0; prevEmpT = 0;
      blinkCrouch = 0; arrivalWhip = 0; prevPhaseOut = 0;
      reseed();
      if (baseY !== null) warden.position.y = baseY + HOVER_BASE;
      for (const p of sepParts) { p.obj.position.set(p.bx, p.by, p.bz); p.obj.rotation.set(p.rx, p.ry, p.rz); }
      energyMats.forEach((m) => { if (m.userData.baseColor) m.color.copy(m.userData.baseColor); });
      warden.rotation.set(0, 0, 0);
      if (rig.spine) rig.spine.rotation.set(0, 0, 0);
      if (rig.chest) rig.chest.rotation.set(0, 0, 0);
    }
  }
  function dispose() {
    warden.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.geometry?.dispose?.(); });
    allMaterials.forEach((m) => m.dispose?.());
    rig.rods.forEach((r) => r.tipMat?.dispose?.());
    rig.arcLines?.forEach(({ arcLine }) => arcLine.geometry?.dispose?.());
  }

  return { root: warden, rig, skeleton, body, update, setDead, dispose };
}
