// Zombie enemy assets — base mesh + Mixamo animation clips.
//
// The base mesh (Parasite L Starkie.fbx) ships as legacy FBX 6100 which three's
// FBXLoader cannot read, so it is converted to GLB (scripts/convert-zombie.mjs /
// fbx2gltf). The animation FBX files are 7.x and load directly as skeleton-only clips
// (69 mixamorig bones) that bind to the GLB skeleton.
//
// Bite animations are intentionally EXCLUDED per design.

const ZOMBIE_ASSET_ROOT = "./assets/zombies";

export const ZOMBIE_MODEL_GLB_PATH = `${ZOMBIE_ASSET_ROOT}/parasite_zombie.glb`;
export const ZOMBIE_MODEL_FBX_PATH = `${ZOMBIE_ASSET_ROOT}/Parasite L Starkie.fbx`; // legacy 6100, not loadable directly

// Included animation states (bites excluded).
export const ZOMBIE_ANIMATION_PATHS = {
  idle:    `${ZOMBIE_ASSET_ROOT}/zombie idle.fbx`,
  walk:    `${ZOMBIE_ASSET_ROOT}/zombie walk.fbx`,
  run:     `${ZOMBIE_ASSET_ROOT}/zombie run.fbx`,
  attack:  `${ZOMBIE_ASSET_ROOT}/zombie attack.fbx`,
  scream:  `${ZOMBIE_ASSET_ROOT}/zombie scream.fbx`,
  crawl:   `${ZOMBIE_ASSET_ROOT}/zombie crawl.fbx`,
  runCrawl:`${ZOMBIE_ASSET_ROOT}/running crawl.fbx`,
  dying:   `${ZOMBIE_ASSET_ROOT}/zombie dying.fbx`,
  death:   `${ZOMBIE_ASSET_ROOT}/zombie death.fbx`,
};

// Explicitly excluded (kept here so the test harness can assert they never leak in).
export const ZOMBIE_EXCLUDED_ANIMATIONS = [
  "zombie biting.fbx",
  "zombie biting (2).fbx",
  "zombie neck bite.fbx",
];

// Animation states that play once and clamp on the last frame (not looped).
export const ZOMBIE_ONCE_ANIMATIONS = new Set(["attack", "scream", "dying", "death"]);
