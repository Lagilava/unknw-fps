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

// Included animation states. The three bite clips are now used as melee VARIANTS
// (randomised per swing in zombie_character) so the attack reads dynamically instead
// of the same slap every time — see attackVariants there.
export const ZOMBIE_ANIMATION_PATHS = {
  idle:       `${ZOMBIE_ASSET_ROOT}/zombie idle.fbx`,
  walk:       `${ZOMBIE_ASSET_ROOT}/zombie walk.fbx`,
  run:        `${ZOMBIE_ASSET_ROOT}/zombie run.fbx`,
  attack:     `${ZOMBIE_ASSET_ROOT}/zombie attack.fbx`,
  attackBite: `${ZOMBIE_ASSET_ROOT}/zombie biting.fbx`,
  attackLunge:`${ZOMBIE_ASSET_ROOT}/zombie biting (2).fbx`,
  attackNeck: `${ZOMBIE_ASSET_ROOT}/zombie neck bite.fbx`,
  scream:     `${ZOMBIE_ASSET_ROOT}/zombie scream.fbx`,
  crawl:      `${ZOMBIE_ASSET_ROOT}/zombie crawl.fbx`,
  runCrawl:   `${ZOMBIE_ASSET_ROOT}/running crawl.fbx`,
  dying:      `${ZOMBIE_ASSET_ROOT}/zombie dying.fbx`,
  death:      `${ZOMBIE_ASSET_ROOT}/zombie death.fbx`,
};

// The melee-swing clips (all played as upper-body layers over the running legs).
// zombie_character builds an *_upper variant of each and picks one at random per hit.
export const ZOMBIE_ATTACK_VARIANTS = ["attack", "attackBite", "attackLunge", "attackNeck"];

// (Formerly excluded — the bites are now wired in as attack variants above.)
export const ZOMBIE_EXCLUDED_ANIMATIONS: string[] = [];

// Animation states that play once and clamp on the last frame (not looped).
export const ZOMBIE_ONCE_ANIMATIONS = new Set(["attack", "attackBite", "attackLunge", "attackNeck", "scream", "dying", "death"]);
