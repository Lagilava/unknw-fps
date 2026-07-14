// UNKNW — world landmark manifest (asset-pipeline drop-in point).
//
// HOW TO ADD A LANDMARK:
//   1. Put a CC0/licensed .glb (or .gltf) into  assets/landmarks/
//   2. Add an entry to the LANDMARKS array below.
//   3. Reload — it loads at boot, is placed in the world, picks up the scene's
//      image-based lighting (scene.environment) automatically, and can register a
//      collider so it blocks the player + enemies.
//
// COORDINATE REFERENCE (world units, y=0 is ground):
//   Interior building : x -68..68,  z -40..120  (collision is the MAP grid)
//   Exterior day zone : x -72..72,  z 120..230  (player exits south through 3 doors)
//   Colliders registered here apply to the EXTERIOR zone only.
//
// ENTRY FIELDS:
//   url        (required) e.g. "./assets/landmarks/statue.glb"
//   x, z       (required) world position (z into the exterior zone for big props)
//   y          (optional) vertical offset; default 0
//   scale      (optional) number for uniform, or [sx,sy,sz]; default 1
//   rotationY  (optional) yaw in radians; default 0
//   collider   (optional) { w, d } full-size AABB footprint (exterior) that blocks movement
//   castShadow (optional) default false (this build runs shadows off for performance)
//
// Keep model poly/texture budgets modest — the renderer is draw-call bound, so a few
// well-made hero landmarks beat many small props.

// Kenney flat-shaded City Kit (CC0) — a cohesive skyline ringing the open-air arena.
// Buildings sit OUTSIDE the walled play area (x beyond ±68 / north of z-38), unreachable,
// so they need no collider — they're the backdrop that makes the plaza feel like a city.
// Facades face +Z by default; rotate to face inward. Scale ~7 (Kenney native ≈1–4.5 tall).
// Tune scale/position after seeing it in-engine.
const B = "./assets/world/";
// A dense, height-varied skyline pulled RIGHT UP behind the arena walls (walls at
// x±68 / north z-38) so the boundary reads as a wall of city buildings, not a bare
// rectangle. Varied scale = uneven rooftops. Backdrop (unreachable) → no colliders.
export const LANDMARKS = [
  // ── North skyline (behind north wall), facing +Z toward the player ──
  { url: B + "building-e.glb",      x: -58, z: -50, scale: 8,  rotationY: 0 },
  { url: B + "building-c.glb",      x: -34, z: -48, scale: 7,  rotationY: 0 },
  { url: B + "building-d.glb",      x:  -8, z: -50, scale: 9,  rotationY: 0 },
  { url: B + "building-tower.glb",  x:  18, z: -52, scale: 8,  rotationY: 0 },
  { url: B + "building-b.glb",      x:  40, z: -48, scale: 7,  rotationY: 0 },
  { url: B + "building-shop-a.glb", x:  60, z: -50, scale: 8,  rotationY: 0 },

  // ── East side (behind east wall), facing -X inward ──
  { url: B + "building-b.glb",      x: 76, z: -22, scale: 8,  rotationY: -Math.PI / 2 },
  { url: B + "building-tower.glb",  x: 78, z:  16, scale: 9,  rotationY: -Math.PI / 2 },
  { url: B + "building-e.glb",      x: 76, z:  54, scale: 7,  rotationY: -Math.PI / 2 },
  { url: B + "building-c.glb",      x: 76, z:  92, scale: 8,  rotationY: -Math.PI / 2 },

  // ── West side (behind west wall), facing +X inward ──
  { url: B + "building-c.glb",      x: -76, z: -22, scale: 8,  rotationY: Math.PI / 2 },
  { url: B + "building-e.glb",      x: -76, z:  16, scale: 7,  rotationY: Math.PI / 2 },
  { url: B + "building-tower.glb",  x: -78, z:  54, scale: 9,  rotationY: Math.PI / 2 },
  { url: B + "building-b.glb",      x: -76, z:  92, scale: 8,  rotationY: Math.PI / 2 },

  // ── Hero landmark: statue centrepiece in the reachable exterior plaza ──
  { url: B + "landmark-statue.glb", x: 0, z: 175, scale: 6, rotationY: 0, collider: { w: 4, d: 4 } },
];
