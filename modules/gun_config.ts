// ── Types (Phase 1 TS migration) ──────────────────────────────────────────────
// GunType is DERIVED from GUNS (via `as const`), so adding a weapon to the GUNS
// map automatically extends the union — GUN_SPECS then requires an entry for it.
export const GUNS = {
  RIFLE: "rifle",
  SHOTGUN: "shotgun",
  SNIPER: "sniper",
  PISTOL: "pistol",
  SMG: "smg",
  LMG: "lmg",
  DMR: "dmr",
  AKIMBO: "akimbo",
  FLAK: "flak",
} as const;

export type GunType = (typeof GUNS)[keyof typeof GUNS];

/** Mechanical fire-animation style consumed by the parts-driven weapon pipeline. */
export type FireCycle = "rifle" | "pump" | "bolt" | "slide" | "rattle" | "drum" | "coil";
/** Third-person reload staging path (see RELOAD_CLIP_STYLES in three_fps_game). */
export type ReloadStyle = "mag" | "shells" | "topLoad" | "drum";
/** Third-person arm pose. "oneHand" = handgun stance (support hand doesn't mirror). */
export type GripStyle = "oneHand";

export interface RecoilSpec {
  kick: number; kickDamping: number;
  yaw: number; yawDamping: number;
  roll: number; rollDamping: number;
}

export interface GunSpec {
  name: string;
  magazine: number;
  ammo: number;
  fireRate: number;
  reloadTime: number;
  adsFov: number;
  adsInSpeed: number;
  adsOutSpeed: number;
  adsMovePenalty: number;
  damage: number;
  pellets: number;
  spread: number;
  tracerLen: number;
  tracerLife: number;
  // Per-gun physics
  moveSpeedMul: number; swayMul: number; shakeMul: number; driftMul: number;
  bloomGrow: number; bloomMax: number; bloomDecay: number;
  // Per-gun animation
  fireCycle: FireCycle;
  reloadStyle: ReloadStyle;
  equipTime: number;
  inspectTime: number;
  // Visual-only third-person viewmodel scale multiplier (on top of the shared
  // 0.6 base). Guns are procedurally built at different real proportions (the
  // SMG's stubby body is much shorter than the rifle's), and every weapon is
  // calibrated into the same hand-grip anchor — a small gun ends up looking
  // undersized/lost in the hand even though the grip itself lines up fine.
  // Defaults to 1 (no change) for every gun that already reads correctly.
  handScale: number;
  muzzleFlashScale: number;
  muzzleFlashTime: number;
  fireSound: string;
  reloadSound: string;
  equipSound: string;
  recoil: RecoilSpec;
  // Optional / per-weapon behaviours
  gripStyle?: GripStyle;   // pistol only
  pierce?: boolean;        // railgun only
  // Third-person clone-pose trim for LONG guns: pushes the gun forward along its
  // barrel (and slightly down) at the hand-centre so the receiver/stock clears the
  // operator's torso/head instead of clipping through it. Units are world-ish metres.
  // Defaults to 0 (compact guns sit fine at the hand-centre). See the clone-faithful
  // two-handed pose in updateThirdPersonWeaponPose.
  tpBarrelPush?: number;   // long guns only (sniper/dmr/lmg)
  tpBarrelDrop?: number;
}

/** Live per-instance gun state, seeded from a GunSpec by createGunState(). */
export interface GunState {
  type: GunType;
  mag: number;
  ammo: number;
  magSize: number;
  fireRate: number;
  fireCooldown: number;
  reloadTime: number;
  reloadTimer: number;
  muzzleTimer: number;
  damage: number;
  pellets: number;
  spread: number;
  isAutoReloading: boolean;
  bloom: number;
  displayName: string;
}

export const GUN_SPECS: Record<GunType, GunSpec> = {
  rifle: {
    name: "Assault Rifle",
    magazine: 24,
    ammo: 120,
    fireRate: 0.074,
    reloadTime: 1.05,
    adsFov: 68,
    adsInSpeed: 11.5,
    adsOutSpeed: 8.5,
    adsMovePenalty: 0.14,
    damage: 34.5,
    pellets: 1,
    spread: 0,
    tracerLen: 1.75,
    tracerLife: 0.032,
    // Per-gun physics (consumed generically — defaults keep legacy behavior):
    // moveSpeedMul = movement speed while held, swayMul = bob/sway weight,
    // shakeMul = camera shake, driftMul = horizontal recoil drift pattern,
    // bloomGrow/bloomMax/bloomDecay = hip-fire spread bloom (rad, rad, rad/s).
    moveSpeedMul: 1, swayMul: 1, shakeMul: 1, driftMul: 1,
    bloomGrow: 0, bloomMax: 0, bloomDecay: 0.15,
    // Per-gun animation spec (consumed by the shared parts-driven pipeline):
    // fireCycle    = mechanical fire animation style ("slide" blowback, "rattle"
    //                bolt flutter + gun jitter, "drum" belt/drum shudder, "bolt"
    //                crisp bolt kick, "pump" back-forward foregrip cycle, "coil"
    //                emissive charge ramp, "rifle" legacy behavior).
    // reloadStyle  = TP reload staging path ("mag" swap, "drum" swap w/ big arc,
    //                "shells" repeated inserts, "topLoad" from above/behind).
    // equipTime    = weapon switch lower/raise duration (s, weight-scaled).
    // muzzleFlashScale/Time = flash sprite size mul + flash duration (s).
    fireCycle: "rifle", reloadStyle: "mag", equipTime: 0.3, inspectTime: 1.4, handScale: 1,
    muzzleFlashScale: 1, muzzleFlashTime: 0.08,
    fireSound: "rifle_fire", reloadSound: "reload_mag", equipSound: "equip_light",
    recoil: { kick: 42, kickDamping: 21, yaw: 76, yawDamping: 24, roll: 64, rollDamping: 22 },
  },
  shotgun: {
    name: "Combat Shotgun",
    magazine: 10,
    ammo: 80,
    fireRate: 0.34,
    reloadTime: 1.45,
    adsFov: 72,
    adsInSpeed: 10.5,
    adsOutSpeed: 7.5,
    adsMovePenalty: 0.12,
    damage: 195,
    pellets: 14,
    spread: 0.068,
    tracerLen: 1.05,
    tracerLife: 0.028,
    moveSpeedMul: 1, swayMul: 1, shakeMul: 1, driftMul: 1,
    bloomGrow: 0, bloomMax: 0, bloomDecay: 0.15,
    fireCycle: "pump", reloadStyle: "shells", equipTime: 0.36, inspectTime: 1.6, handScale: 1,
    muzzleFlashScale: 1.35, muzzleFlashTime: 0.105,
    fireSound: "shotgun_fire", reloadSound: "reload_shells", equipSound: "equip_heavy",
    recoil: { kick: 96, kickDamping: 14, yaw: 112, yawDamping: 18, roll: 98, rollDamping: 16 },
  },
  sniper: {
    name: "Precision Rifle",
    magazine: 6,
    ammo: 30,
    fireRate: 1.05,
    reloadTime: 1.55,
    adsFov: 18,
    adsInSpeed: 8.4,
    adsOutSpeed: 7.0,
    adsMovePenalty: 0.2,
    damage: 205.54,
    pellets: 1,
    spread: 0.004,
    tracerLen: 2.85,
    tracerLife: 0.045,
    moveSpeedMul: 1, swayMul: 1, shakeMul: 1, driftMul: 1,
    bloomGrow: 0, bloomMax: 0, bloomDecay: 0.15,
    fireCycle: "bolt", reloadStyle: "topLoad", equipTime: 0.42, inspectTime: 1.7, handScale: 1,
    muzzleFlashScale: 0.95, muzzleFlashTime: 0.075,
    fireSound: "sniper_fire", reloadSound: "reload_topload", equipSound: "equip_heavy",
    recoil: { kick: 64, kickDamping: 18, yaw: 145, yawDamping: 20, roll: 88, rollDamping: 19 },
    tpBarrelPush: 0.16, tpBarrelDrop: 0.09,
  },
  // ── Mystery-box roster (starter pistol + box pulls) ─────────────────────────
  pistol: {
    name: "Service Pistol",
    magazine: 12,
    ammo: 96,
    fireRate: 0.19,
    reloadTime: 0.85,
    adsFov: 66,
    adsInSpeed: 13.5,
    adsOutSpeed: 10.5,
    adsMovePenalty: 0.06,
    damage: 52,
    pellets: 1,
    spread: 0.006,
    tracerLen: 1.4,
    tracerLife: 0.03,
    moveSpeedMul: 1.06, swayMul: 0.7, shakeMul: 0.7, driftMul: 0.8,
    bloomGrow: 0.004, bloomMax: 0.02, bloomDecay: 0.12,
    fireCycle: "slide", reloadStyle: "mag", equipTime: 0.18, inspectTime: 1.1, handScale: 1,
    // gripStyle drives the third-person arm pose. "oneHand" = compact handgun
    // stance: the left (support) hand does NOT mirror the right's rifle raise and
    // takes only a fraction of the fire punch, so the arms don't splay on every
    // shot. Any other value (or absent) = the default two-handed rifle grip.
    gripStyle: "oneHand",
    muzzleFlashScale: 0.8, muzzleFlashTime: 0.07,
    fireSound: "pistol_fire", reloadSound: "reload_mag", equipSound: "equip_light",
    recoil: { kick: 34, kickDamping: 24, yaw: 58, yawDamping: 26, roll: 46, rollDamping: 24 },
  },
  smg: {
    name: "Hornet SMG",
    magazine: 32,
    ammo: 192,
    fireRate: 0.055,
    reloadTime: 0.95,
    adsFov: 70,
    adsInSpeed: 12.5,
    adsOutSpeed: 9.5,
    adsMovePenalty: 0.08,
    damage: 21,
    pellets: 1,
    spread: 0.022,
    tracerLen: 1.5,
    tracerLife: 0.03,
    moveSpeedMul: 1.05, swayMul: 0.85, shakeMul: 0.8, driftMul: 1.3,
    bloomGrow: 0.006, bloomMax: 0.045, bloomDecay: 0.16,
    // One-handed grip: the SMG joins the pistol/akimbo group and is held/aimed
    // with the compact one-handed Pistol clip set (pistolRun/strafe/jump), NOT
    // the two-handed rifle-carry layer.
    gripStyle: "oneHand",
    fireCycle: "rattle", reloadStyle: "mag", equipTime: 0.24, inspectTime: 1.2,
    // The SMG's procedural model is genuinely stubbier than the rifle (short
    // receiver, short mag), so at the shared 0.6 base scale it reads as lost
    // in the two-handed grip. Bumped up ~22% for visual parity.
    handScale: 1.22,
    muzzleFlashScale: 0.85, muzzleFlashTime: 0.06,
    fireSound: "smg_fire", reloadSound: "reload_mag", equipSound: "equip_light",
    recoil: { kick: 30, kickDamping: 24, yaw: 62, yawDamping: 26, roll: 52, rollDamping: 24 },
  },
  lmg: {
    name: "Bastion LMG",
    magazine: 75,
    ammo: 225,
    fireRate: 0.092,
    reloadTime: 2.6,
    adsFov: 66,
    adsInSpeed: 7.8,
    adsOutSpeed: 6.5,
    adsMovePenalty: 0.24,
    damage: 31,
    pellets: 1,
    spread: 0.014,
    tracerLen: 1.85,
    tracerLife: 0.034,
    moveSpeedMul: 0.85, swayMul: 1.5, shakeMul: 1.25, driftMul: 1.4,
    bloomGrow: 0.005, bloomMax: 0.05, bloomDecay: 0.08,
    fireCycle: "drum", reloadStyle: "drum", equipTime: 0.5, inspectTime: 1.9, handScale: 1,
    muzzleFlashScale: 1.25, muzzleFlashTime: 0.09,
    fireSound: "lmg_fire", reloadSound: "reload_drum", equipSound: "equip_heavy",
    recoil: { kick: 52, kickDamping: 17, yaw: 92, yawDamping: 20, roll: 74, rollDamping: 19 },
    tpBarrelPush: 0.12, tpBarrelDrop: 0.06,
  },
  dmr: {
    name: "Verdict DMR",
    magazine: 10,
    ammo: 60,
    fireRate: 0.32,
    reloadTime: 1.3,
    adsFov: 42,
    adsInSpeed: 9.5,
    adsOutSpeed: 8.0,
    adsMovePenalty: 0.16,
    damage: 118,
    pellets: 1,
    spread: 0.002,
    tracerLen: 2.3,
    tracerLife: 0.04,
    moveSpeedMul: 0.97, swayMul: 1.1, shakeMul: 1.05, driftMul: 0.9,
    bloomGrow: 0.004, bloomMax: 0.02, bloomDecay: 0.2,
    fireCycle: "bolt", reloadStyle: "mag", equipTime: 0.34, inspectTime: 1.5, handScale: 1,
    muzzleFlashScale: 1, muzzleFlashTime: 0.085,
    fireSound: "dmr_fire", reloadSound: "reload_mag", equipSound: "equip_light",
    recoil: { kick: 55, kickDamping: 19, yaw: 108, yawDamping: 21, roll: 76, rollDamping: 20 },
    tpBarrelPush: 0.1, tpBarrelDrop: 0.05,
  },
  akimbo: {
    name: "Gemini Machine Pistol",
    magazine: 26,
    ammo: 156,
    fireRate: 0.08,
    reloadTime: 1.15,
    adsFov: 72,
    adsInSpeed: 12.0,
    adsOutSpeed: 9.0,
    adsMovePenalty: 0.07,
    damage: 26,
    pellets: 1,
    spread: 0.03,
    tracerLen: 1.35,
    tracerLife: 0.03,
    moveSpeedMul: 1.06, swayMul: 0.8, shakeMul: 0.85, driftMul: 1.6,
    bloomGrow: 0.007, bloomMax: 0.05, bloomDecay: 0.18,
    // Machine pistol is held one-handed like the Service Pistol (drives the TP
    // pistol locomotion clips + one-hand arm pose).
    gripStyle: "oneHand",
    fireCycle: "rattle", reloadStyle: "mag", equipTime: 0.24, inspectTime: 1.2, handScale: 1,
    muzzleFlashScale: 0.85, muzzleFlashTime: 0.06,
    fireSound: "akimbo_fire", reloadSound: "reload_mag", equipSound: "equip_light",
    recoil: { kick: 36, kickDamping: 22, yaw: 84, yawDamping: 24, roll: 66, rollDamping: 22 },
  },
  flak: {
    name: "Mauler Auto-Shotgun",
    magazine: 8,
    ammo: 64,
    fireRate: 0.52,
    reloadTime: 1.7,
    adsFov: 74,
    adsInSpeed: 9.8,
    adsOutSpeed: 7.4,
    adsMovePenalty: 0.14,
    damage: 150,
    pellets: 10,
    spread: 0.088,
    tracerLen: 1.0,
    tracerLife: 0.028,
    moveSpeedMul: 0.9, swayMul: 1.3, shakeMul: 1.3, driftMul: 1.2,
    bloomGrow: 0.01, bloomMax: 0.06, bloomDecay: 0.1,
    fireCycle: "pump", reloadStyle: "drum", equipTime: 0.4, inspectTime: 1.7, handScale: 1,
    muzzleFlashScale: 1.4, muzzleFlashTime: 0.11,
    fireSound: "flak_fire", reloadSound: "reload_drum", equipSound: "equip_heavy",
    recoil: { kick: 84, kickDamping: 15, yaw: 104, yawDamping: 18, roll: 90, rollDamping: 17 },
  },
};

export function createGunState(gunType: GunType = GUNS.RIFLE): GunState {
  const spec = GUN_SPECS[gunType];
  return {
    type: gunType,
    mag: spec.magazine,
    ammo: spec.ammo,
    magSize: spec.magazine,
    fireRate: spec.fireRate,
    fireCooldown: 0,
    reloadTime: spec.reloadTime,
    reloadTimer: 0,
    muzzleTimer: 0,
    damage: spec.damage,
    pellets: spec.pellets,
    spread: spec.spread,
    isAutoReloading: false,
    bloom: 0, // live hip-fire spread bloom (grows per shot, decays per spec.bloomDecay)
    displayName: spec.name,
  };
}
