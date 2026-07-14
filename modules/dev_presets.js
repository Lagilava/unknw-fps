// modules/dev_presets.js
// ─────────────────────────────────────────────────────────────────────────────
// Bundled "Starter" preset pack — the developer-supplied tuning shipped with the
// build. The dev console (dev.html) seeds these into the preset store under the
// name "Starter" and activates them once (guarded by a localStorage flag), so the
// values are live in the game without any manual import. Deactivate or reset any
// section to return to the built-in defaults; the pack is never re-seeded after
// the first install.
// ─────────────────────────────────────────────────────────────────────────────

export const STARTER_PACK_NAME = "Starter";
export const STARTER_INSTALLED_KEY = "rb-dev-starter-installed";
export const STARTER_PACK_VERSION = 1;

export const STARTER_PRESETS = {
  lighting: {
    ambientMul: 2.75,
    hemiMul: 3.9,
    dirMul: 2.2,
    pointIntensityMul: 1,
    pointCountAdd: -8,
    pointDecay: 4,
    bounceIntensityMul: 3,
    ambientColor: "#ffbb00",
    hemiSkyColor: "#ff8585",
    hemiGroundColor: "#6a5f50",
  },
  camera: {
    fpWalkFov: 80.5,
    fpSprintFov: 91.5,
    tpWalkFov: 63,
    tpSprintFov: 70,
    near: 0.109,
    far: 590,
    cinematicFovOffset: -10,
    tpDistance: 1.1,
    tpShoulderX: 0.3,
    tpShoulderY: -0.52,
    tpCameraHeight: -0.8,
    tpCameraClearance: 0.34,
  },
  weapons: {
    rifle: {
      magazine: 24, ammo: 120, fireRate: 0.074, reloadTime: 1.05,
      adsFov: 68, adsInSpeed: 11.5, adsOutSpeed: 8.5, adsMovePenalty: 0.14,
      damage: 37.1, pellets: 1, spread: 0, recoilKick: 42, recoilYaw: 76, recoilRoll: 64,
    },
    shotgun: {
      magazine: 10, ammo: 80, fireRate: 0.34, reloadTime: 1.45,
      adsFov: 72, adsInSpeed: 10.5, adsOutSpeed: 7.5, adsMovePenalty: 0.12,
      damage: 203.5, pellets: 14, spread: 0.083, recoilKick: 102, recoilYaw: 112, recoilRoll: 98,
    },
    sniper: {
      magazine: 6, ammo: 30, fireRate: 1.369, reloadTime: 1.55,
      adsFov: 18, adsInSpeed: 8.4, adsOutSpeed: 7, adsMovePenalty: 0.2,
      damage: 290.5, pellets: 1, spread: 0.004, recoilKick: 64, recoilYaw: 145, recoilRoll: 88,
    },
  },
  player: {
    hp: 100, maxHp: 100, radius: 0.32, speed: 5.8, sprintSpeed: 9.2,
    maxStamina: 100, staminaDrain: 36, staminaRegen: 22,
    jumpVelocity: 9.35, jumpGravity: 15.3, maxJumpOffset: 1.51,
    unlimitedHealth: false, unlimitedSprint: true, unlimitedAmmo: false, startingWeapon: "rifle",
  },
};
