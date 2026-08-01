const MODEL_ASSET_ROOT = "./assets/models";
const PLAYER_MODEL_ASSET_ROOT = `${MODEL_ASSET_ROOT}/player`;
const ANGEL_DRONE_ASSET_ROOT = "./assets/drones/angel";

export const SIEGE_DRONE_MODEL_PATH = `${ANGEL_DRONE_ASSET_ROOT}/source/skeleton.fbx`;
// Optimized, decimated glb (produced by scripts/optimize-drone.mjs): ~53k tris vs
// the FBX's ~1M, with skin + animations preserved. Loaded in preference to the FBX.
export const SIEGE_DRONE_MODEL_GLB_PATH = `${ANGEL_DRONE_ASSET_ROOT}/source/skeleton.glb`;
export const SIEGE_DRONE_WALK_ANIMATION_PATH = `${ANGEL_DRONE_ASSET_ROOT}/source/skeleton.fbx`;
export const ANGEL_DRONE_TEXTURE_PATHS = {
  skeletonBaseColor: `${ANGEL_DRONE_ASSET_ROOT}/textures/skeleton_mat_Base_color_sRGB.png`,
  skeletonNormal: `${ANGEL_DRONE_ASSET_ROOT}/textures/skeleton_mat_Normal_DirectX_Raw.png`,
  skeletonRoughness: `${ANGEL_DRONE_ASSET_ROOT}/textures/skeleton_mat_Roughness_Raw.png`,
  skeletonMetallic: `${ANGEL_DRONE_ASSET_ROOT}/textures/skeleton_mat_Metallic_Raw.png`,
  skeletonAo: `${ANGEL_DRONE_ASSET_ROOT}/textures/low_s_skeleton_mat_Mixed_AO_Raw.png`,
  armBaseColor: `${ANGEL_DRONE_ASSET_ROOT}/textures/arm_mat_Base_color_sRGB_noGreen.png`,
  armNormal: `${ANGEL_DRONE_ASSET_ROOT}/textures/arm_mat_Normal.png`,
  armRoughness: `${ANGEL_DRONE_ASSET_ROOT}/textures/arm_mat_Roughness.png`,
  armMetallic: `${ANGEL_DRONE_ASSET_ROOT}/textures/arm_mat_Metallic.png`,
  armAo: `${ANGEL_DRONE_ASSET_ROOT}/textures/arm_mat_Ambient_occlusion_Raw.png`,
  glowAlpha: `${ANGEL_DRONE_ASSET_ROOT}/textures/glow_alpha.png`,
};
export const EXTERIOR_CITY_MODEL_PATH = `${MODEL_ASSET_ROOT}/petstock_and_radio_rentals_building_low_poly.glb`;

export const PLAYER_MODEL_PATH = `./assets/Pete.fbx`;
export const PLAYER_ANIMATION_PATHS = {
  idle:         `${PLAYER_MODEL_ASSET_ROOT}/Rifle Aiming Idle.fbx`,
  walk:         `${PLAYER_MODEL_ASSET_ROOT}/Walking.fbx`,
  walkBack:     `${PLAYER_MODEL_ASSET_ROOT}/walking backwards.fbx`,
  startWalk:    `${PLAYER_MODEL_ASSET_ROOT}/start walking.fbx`,
  stopWalk:     `${PLAYER_MODEL_ASSET_ROOT}/stop walking.fbx`,
  startWalkBack:`${PLAYER_MODEL_ASSET_ROOT}/start walking backwards.fbx`,
  stopWalkBack: `${PLAYER_MODEL_ASSET_ROOT}/walk backwards stop.fbx`,
  strafe:       `${PLAYER_MODEL_ASSET_ROOT}/Strafe.fbx`,
  strafeAlt:    `${PLAYER_MODEL_ASSET_ROOT}/strafe (2).fbx`,
  sprint:       `${PLAYER_MODEL_ASSET_ROOT}/Sprint Forward.fbx`,
  sprintLeft:   `${PLAYER_MODEL_ASSET_ROOT}/Sprint Left.fbx`,
  sprintRight:  `${PLAYER_MODEL_ASSET_ROOT}/Sprint Right.fbx`,
  rifleRun:     `${PLAYER_MODEL_ASSET_ROOT}/rifle run.fbx`,
  runBack:      `${PLAYER_MODEL_ASSET_ROOT}/run backwards.fbx`,
  jump:         `${PLAYER_MODEL_ASSET_ROOT}/Rifle Jump.fbx`,
  jumpForward:  `${PLAYER_MODEL_ASSET_ROOT}/jump forward.fbx`,
  jumpBack:     `${PLAYER_MODEL_ASSET_ROOT}/jump backward.fbx`,
  fallbackJump: `${PLAYER_MODEL_ASSET_ROOT}/Jump.fbx`,
  fire:         `${PLAYER_MODEL_ASSET_ROOT}/Firing Rifle.fbx`,
  reload:       `${PLAYER_MODEL_ASSET_ROOT}/Reloading.fbx`,
  death:        `${PLAYER_MODEL_ASSET_ROOT}/walking to dying.fbx`,
  // Pistol set (Mixamo, user-supplied): real one-handed locomotion so the body
  // actually HOLDS the sidearm, plus the floor-grab used by the intro cutscene.
  pistolRun:    `assets/Pistol Animations/Pistol Run.fbx`,
  pistolStrafe: `assets/Pistol Animations/Pistol Strafe.fbx`,
  pistolJump:   `assets/Pistol Animations/Pistol Jump.fbx`,
  grabPistol:   `assets/Pistol Animations/Grabbing Pistol.fbx`,
  fallenIdle:   `assets/Pistol Animations/Fallen Idle.fbx`,
};

export const PLAYER_MODEL_GLTF_PATH = PLAYER_MODEL_PATH.replace(/\.fbx$/i, ".glb");
const PLAYER_ANIMATION_GLB_KEYS = new Set([
  "idle",
  "walk",
  "strafe",
  "sprint",
  "sprintLeft",
  "sprintRight",
  "jump",
  "fallbackJump",
  "fire",
  "reload",
]);
export const PLAYER_ANIMATION_GLTF_PATHS = Object.fromEntries(
  Object.entries(PLAYER_ANIMATION_PATHS)
    .filter(([key]) => PLAYER_ANIMATION_GLB_KEYS.has(key))
    .map(([key, path]) => [key, path.replace(/\.fbx$/i, ".glb")])
);

export const STARTUP_TEXTURE_ASSETS = [
  "assets/textures/ceiling/OfficeCeiling001_1K-JPG_Color.jpg",
  "assets/textures/ceiling/OfficeCeiling001_1K-JPG_NormalGL.jpg",
  "assets/textures/ceiling/OfficeCeiling001_1K-JPG_Roughness.jpg",
  "assets/textures/floor/Concrete034_1K-JPG_Color.jpg",
  "assets/textures/floor/Concrete034_1K-JPG_NormalGL.jpg",
  "assets/textures/floor/Concrete034_1K-JPG_Roughness.jpg",
  "assets/textures/wall/Metal063_1K-JPG_Color.jpg",
  "assets/textures/wall/Metal063_1K-JPG_NormalGL.jpg",
  "assets/textures/wall/Metal063_1K-JPG_Roughness.jpg",
];
