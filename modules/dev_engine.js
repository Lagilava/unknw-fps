// modules/dev_engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Room Breach / UNKNW — Developer Engine & Preset Framework
//
// A single, centralized, versioned developer-configuration layer for the whole
// game. It owns:
//   • The canonical DEFAULTS schema (mirrors the game's built-in constants).
//   • A persistent preset STORE (localStorage) with per-category + master presets.
//   • load / save / validate / merge / apply / reset / export / import helpers.
//   • Preset CRUD: create, rename, duplicate, delete, activate.
//   • resolveActive(): produces the flat "active overrides" snapshot that the
//     game (three_fps_game.js) and world (environment.js) read at runtime.
//
// DESIGN CONTRACT — "default behavior is unchanged unless a preset is applied":
//   The game only ever applies a category if that category has a *non-null*
//   active preset. A resolved snapshot contains ONLY the categories a developer
//   has explicitly activated. Everything else falls through to the game's own
//   built-in constants, byte-for-byte unchanged.
//
// This file is an ES module (imported by three_fps_game.js and dev.html) that
// ALSO publishes a classic-script bridge on `window.RB_DEV_ENGINE` so the
// defer-loaded classic scripts (environment.js) can read the resolved snapshot
// without an import.
// ─────────────────────────────────────────────────────────────────────────────

export const DEV_ENGINE_VERSION = 5;

export const STORE_KEY = "rb-dev-store-v1";
export const ACTIVE_KEY = "rb-dev-active-v1"; // resolved snapshot the game reads
export const CHANGE_EVENT = "rb-dev-change";

export const CATEGORIES = [
  "player",
  "camera",
  "weapons",
  "enemies",
  "gameplay",
  "spawn",
  "lighting",
  "map",
  "quality",
  "debug",
];

export const CATEGORY_LABELS = {
  player: "Player",
  camera: "Camera",
  weapons: "Weapons",
  enemies: "Enemies",
  gameplay: "Gameplay",
  spawn: "Spawn Rules",
  lighting: "Lighting",
  map: "Map",
  quality: "Performance",
  debug: "Debug / Preview",
};

// Categories that require a full geometry/lighting/collision rebuild to take
// effect. When one of these changes, the game reloads its tab rather than
// hot-patching, guaranteeing "changes reflect after saved" without corrupting
// scene state.
export const STRUCTURAL_CATEGORIES = ["map", "lighting"];

// The built-in map (kept as the fallback — mirrors environment.js MAP).
export const DEFAULT_MAP_ROWS = [
  "##################################",
  "#................................#",
  "#................................#",
  "#................................#",
  "#................................#",
  "#.............######.............#",
  "#................................#",
  "#......###..............###......#",
  "#......###..............###......#",
  "#......###..............###......#",
  "#...............##...............#",
  "#................................#",
  "#................................#",
  "#................................#",
  "#................................#",
  "#................................#",
  "#..##........................##..#",
  "#..##........................##..#",
  "#..##........................##..#",
  "#..##........................##..#",
  "#..##.......#........#.......##..#",
  "#..##........................##..#",
  "#..##........................##..#",
  "#................................#",
  "#................................#",
  "#..........###......###..........#",
  "#..........###......###..........#",
  "#..........###......###..........#",
  "#................................#",
  "#................................#",
  "#................................#",
  "#.......###............###.......#",
  "#.......###............###.......#",
  "#.......###............###.......#",
  "#................................#",
  "#................................#",
  "#................................#",
  "#................................#",
  "#................................#",
  "#####++#########++#########++#####",
];

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS — mirror the game's built-in constants. New presets clone these so a
// developer always starts from the true current values.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULTS = {
  player: {
    hp: 100,
    maxHp: 100,
    radius: 0.32,
    speed: 5.8,
    sprintSpeed: 9.2,
    maxStamina: 100,
    staminaDrain: 36,
    staminaRegen: 22,
    jumpVelocity: 5.85,
    jumpGravity: 13.6,
    maxJumpOffset: 1.12,
    unlimitedHealth: false,
    unlimitedSprint: true,
    unlimitedAmmo: false,
    startingWeapon: "rifle", // rifle | shotgun | sniper
  },
  camera: {
    fpWalkFov: 90,
    fpSprintFov: 100,
    tpWalkFov: 63,
    tpSprintFov: 70,
    near: 0.05,
    far: 480,
    cinematicFovOffset: -4,
    // First-person camera position offset (metres, additive; 0 = default eye).
    fpOffsetX: 0,
    fpOffsetY: 0,
    fpOffsetZ: 0,
    tpDistance: 1.34,
    tpShoulderX: 0.36,
    tpShoulderY: -0.52,
    tpCameraHeight: -0.86,
    tpCameraClearance: 0.34,
  },
  weapons: {
    rifle: {
      magazine: 24, ammo: 120, fireRate: 0.074, reloadTime: 1.05,
      adsFov: 68, adsInSpeed: 11.5, adsOutSpeed: 8.5, adsMovePenalty: 0.14,
      damage: 34.5, pellets: 1, spread: 0,
      recoilKick: 42, recoilYaw: 76, recoilRoll: 64,
    },
    shotgun: {
      magazine: 10, ammo: 80, fireRate: 0.34, reloadTime: 1.45,
      adsFov: 72, adsInSpeed: 10.5, adsOutSpeed: 7.5, adsMovePenalty: 0.12,
      damage: 195, pellets: 14, spread: 0.068,
      recoilKick: 96, recoilYaw: 112, recoilRoll: 98,
    },
    sniper: {
      magazine: 6, ammo: 30, fireRate: 1.05, reloadTime: 1.55,
      adsFov: 18, adsInSpeed: 8.4, adsOutSpeed: 7.0, adsMovePenalty: 0.2,
      damage: 205.54, pellets: 1, spread: 0.004,
      recoilKick: 64, recoilYaw: 145, recoilRoll: 88,
    },
  },
  enemies: {
    "Siege Drone": { hp: 820, speed: 8.2, damageMin: 8, damageMax: 12, attackRate: 1.2, scale: 1.12, xp: 4, glow: 1.9, color: "#77cfff", emissive: "#0a5cff" },
    "Cloned Ghost": { hp: 270, speed: 7.5, damageMin: 5, damageMax: 8, attackRate: 1.25, scale: 1, xp: 9, glow: 1.05, color: "#ff9b47", emissive: "#7a3010" },
    "Blink Seraph": { hp: 560, speed: 4.8, damageMin: 7, damageMax: 11, attackRate: 1.35, scale: 0.96, xp: 6, glow: 1.6, color: "#b28cff", emissive: "#6e31ff" },
    "Null Cherub": { hp: 700, speed: 3.5, damageMin: 5, damageMax: 8, attackRate: 1.8, scale: 1.04, xp: 7, glow: 1.45, color: "#62ffd6", emissive: "#00aa88" },
    "Zombie": { hp: 240, speed: 6.5, damageMin: 11, damageMax: 17, attackRate: 0.55, scale: 1.0, xp: 5, glow: 0.6, color: "#7a8a55", emissive: "#1d2a10" },
  },
  gameplay: {
    waveCountBase: 1.6,       // getWaveEnemyCount: round(base + wave*perWave)
    waveCountPerWave: 1.35,
    waveCountMax: 20,
    hpScalePerWave: 0.05,     // getWaveHpScale
    hpScaleMax: 1.85,
    speedScalePerWave: 0.022,
    speedScaleMax: 0.45,
    damageScalePerWave: 0.032,
    damageScaleMax: 0.7,
    playerDamageMult: 1.0,    // multiplies all weapon damage
    enemyDamageMult: 1.0,     // multiplies all enemy damage
  },
  spawn: {
    minDistance: 18,
    preferVisible: false,
    useProceduralFallback: true,
    points: [
      // { x, z, facing (radians), radius, wave (0 = all waves), priority, type }
      // Empty by default → the game's built-in procedural spawner is used.
    ],
  },
  lighting: {
    // Multipliers applied on top of the auto-selected device lighting profile.
    // 1.0 everywhere = built-in behavior unchanged.
    ambientMul: 1.0,
    hemiMul: 1.0,
    dirMul: 1.0,
    pointIntensityMul: 1.0,
    pointCountAdd: 0,       // added to the profile's pointCount (clamped ≥0)
    pointDecay: 2.0,
    bounceIntensityMul: 1.0,
    ambientColor: "#fff4e4",
    hemiSkyColor: "#cfe2ff",
    hemiGroundColor: "#6a5f50",
  },
  map: {
    rows: DEFAULT_MAP_ROWS.slice(),
    cell: 4,
  },
  quality: {
    // Renderer backend. "auto" = desktop uses the mature/fast WebGL path, mobile
    // prefers WebGPU-first (WebGL can exceed mobile shader limits and render
    // black). "webgl"/"webgpu" force a specific backend. WebGPU in three r166 is
    // experimental and often much slower on desktop — auto avoids that trap.
    renderer: "auto",        // auto | webgl | webgpu
    autoFallback: true,      // auto-switch a slow WebGPU session to WebGL + reload
    renderScaleCap: 0,       // 0 = device default; else clamp max render scale (0.4–1.2)
    pixelRatioCap: 0,        // 0 = device default; else cap devicePixelRatio (0.5–2)
    maxActiveLights: 0,      // 0 = engine default; >0 caps interior point-light count
    shadows: "auto",         // auto | on | off — "auto" lets the fps governor drop them
    autoPerfGovernor: true,  // auto-cut features (shadows) when fps stays low
  },
  debug: {
    godMode: false,
    freezeEnemies: false,
    spawnWaveOverride: 0,   // 0 = disabled; >0 forces starting wave
    showConfigBanner: true, // show a banner in-game when a dev preset is active
    autoReloadOnStructural: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────────
export function deepClone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }

function num(v, fallback) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function bool(v, fallback) {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

// Merge `over` onto a clone of `base`, one level deep for nested plain objects.
export function mergeConfig(base, over) {
  const out = deepClone(base) || {};
  if (!isObj(over)) return out;
  for (const k of Object.keys(over)) {
    if (isObj(over[k]) && isObj(out[k])) out[k] = mergeConfig(out[k], over[k]);
    else out[k] = deepClone(over[k]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation / sanitization — a broken preset must never crash the game.
// Each sanitizer coerces types and clamps to sane bounds, filling from DEFAULTS.
// ─────────────────────────────────────────────────────────────────────────────
export function sanitizeCategory(category, raw) {
  const def = DEFAULTS[category];
  if (!def) return null;
  const src = isObj(raw) ? raw : {};
  switch (category) {
    case "player": {
      const w = String(src.startingWeapon || def.startingWeapon);
      return {
        hp: Math.max(1, num(src.hp, def.hp)),
        maxHp: Math.max(1, num(src.maxHp, def.maxHp)),
        radius: Math.max(0.05, Math.min(2, num(src.radius, def.radius))),
        speed: Math.max(0, num(src.speed, def.speed)),
        sprintSpeed: Math.max(0, num(src.sprintSpeed, def.sprintSpeed)),
        maxStamina: Math.max(1, num(src.maxStamina, def.maxStamina)),
        staminaDrain: Math.max(0, num(src.staminaDrain, def.staminaDrain)),
        staminaRegen: Math.max(0, num(src.staminaRegen, def.staminaRegen)),
        jumpVelocity: Math.max(0, num(src.jumpVelocity, def.jumpVelocity)),
        jumpGravity: Math.max(0.1, num(src.jumpGravity, def.jumpGravity)),
        maxJumpOffset: Math.max(0, num(src.maxJumpOffset, def.maxJumpOffset)),
        unlimitedHealth: bool(src.unlimitedHealth, def.unlimitedHealth),
        unlimitedSprint: bool(src.unlimitedSprint, def.unlimitedSprint),
        unlimitedAmmo: bool(src.unlimitedAmmo, def.unlimitedAmmo),
        startingWeapon: ["rifle", "shotgun", "sniper"].includes(w) ? w : def.startingWeapon,
      };
    }
    case "camera": {
      const out = {};
      for (const k of Object.keys(def)) out[k] = num(src[k], def[k]);
      out.fpWalkFov = Math.max(30, Math.min(140, out.fpWalkFov));
      out.fpSprintFov = Math.max(30, Math.min(160, out.fpSprintFov));
      out.tpWalkFov = Math.max(30, Math.min(140, out.tpWalkFov));
      out.tpSprintFov = Math.max(30, Math.min(160, out.tpSprintFov));
      out.near = Math.max(0.001, Math.min(1, out.near));
      out.far = Math.max(10, Math.min(5000, out.far));
      return out;
    }
    case "weapons": {
      const out = {};
      for (const gun of ["rifle", "shotgun", "sniper"]) {
        const gd = def[gun];
        const gs = isObj(src[gun]) ? src[gun] : {};
        const o = {};
        for (const k of Object.keys(gd)) o[k] = num(gs[k], gd[k]);
        o.magazine = Math.max(1, Math.round(o.magazine));
        o.ammo = Math.max(0, Math.round(o.ammo));
        o.pellets = Math.max(1, Math.round(o.pellets));
        o.fireRate = Math.max(0.01, o.fireRate);
        o.reloadTime = Math.max(0.05, o.reloadTime);
        o.damage = Math.max(0, o.damage);
        o.spread = Math.max(0, o.spread);
        out[gun] = o;
      }
      return out;
    }
    case "enemies": {
      const hex = (v, fb) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : fb);
      const out = {};
      for (const name of Object.keys(def)) {
        const ed = def[name];
        const es = isObj(src[name]) ? src[name] : {};
        out[name] = {
          hp: Math.max(1, num(es.hp, ed.hp)),
          speed: Math.max(0, num(es.speed, ed.speed)),
          damageMin: Math.max(0, num(es.damageMin, ed.damageMin)),
          damageMax: Math.max(0, num(es.damageMax, ed.damageMax)),
          attackRate: Math.max(0.05, num(es.attackRate, ed.attackRate)),
          scale: Math.max(0.1, num(es.scale, ed.scale)),
          xp: Math.max(0, Math.round(num(es.xp, ed.xp))),
          glow: Math.max(0, num(es.glow, ed.glow)),
          color: hex(es.color, ed.color),
          emissive: hex(es.emissive, ed.emissive),
        };
      }
      return out;
    }
    case "gameplay": {
      const out = {};
      for (const k of Object.keys(def)) out[k] = num(src[k], def[k]);
      out.waveCountMax = Math.max(1, Math.round(out.waveCountMax));
      out.playerDamageMult = Math.max(0, out.playerDamageMult);
      out.enemyDamageMult = Math.max(0, out.enemyDamageMult);
      return out;
    }
    case "spawn": {
      const pts = Array.isArray(src.points) ? src.points : [];
      return {
        minDistance: Math.max(0, num(src.minDistance, def.minDistance)),
        preferVisible: bool(src.preferVisible, def.preferVisible),
        useProceduralFallback: bool(src.useProceduralFallback, def.useProceduralFallback),
        points: pts.slice(0, 128).map((p) => ({
          x: num(p?.x, 0),
          z: num(p?.z, 0),
          facing: num(p?.facing, 0),
          radius: Math.max(0, num(p?.radius, 0)),
          wave: Math.max(0, Math.round(num(p?.wave, 0))),
          priority: Math.round(num(p?.priority, 0)),
          type: p?.type ? String(p.type) : "",
        })),
      };
    }
    case "lighting": {
      const out = {};
      for (const k of Object.keys(def)) {
        if (typeof def[k] === "string") out[k] = /^#/.test(String(src[k])) ? String(src[k]) : def[k];
        else out[k] = num(src[k], def[k]);
      }
      out.pointCountAdd = Math.round(out.pointCountAdd);
      out.pointDecay = Math.max(0.1, out.pointDecay);
      return out;
    }
    case "map": {
      let rows = Array.isArray(src.rows) ? src.rows.map((r) => String(r)) : DEFAULT_MAP_ROWS.slice();
      // Every row must be the same width, and there must be ≥ 3 rows/cols.
      const width = rows.length ? rows[0].length : 0;
      const valid =
        rows.length >= 3 &&
        width >= 3 &&
        rows.every((r) => r.length === width && /^[#.+A-Za-z]+$/.test(r));
      if (!valid) rows = DEFAULT_MAP_ROWS.slice();
      return { rows, cell: Math.max(1, num(src.cell, def.cell)) };
    }
    case "quality": {
      const r = String(src.renderer || def.renderer);
      const sh = String(src.shadows || def.shadows);
      return {
        renderer: ["auto", "webgl", "webgpu"].includes(r) ? r : def.renderer,
        autoFallback: bool(src.autoFallback, def.autoFallback),
        renderScaleCap: Math.max(0, Math.min(1.2, num(src.renderScaleCap, def.renderScaleCap))),
        pixelRatioCap: Math.max(0, Math.min(2, num(src.pixelRatioCap, def.pixelRatioCap))),
        maxActiveLights: Math.max(0, Math.round(num(src.maxActiveLights, def.maxActiveLights))),
        shadows: ["auto", "on", "off"].includes(sh) ? sh : def.shadows,
        autoPerfGovernor: bool(src.autoPerfGovernor, def.autoPerfGovernor),
      };
    }
    case "debug": {
      return {
        godMode: bool(src.godMode, def.godMode),
        freezeEnemies: bool(src.freezeEnemies, def.freezeEnemies),
        spawnWaveOverride: Math.max(0, Math.round(num(src.spawnWaveOverride, def.spawnWaveOverride))),
        showConfigBanner: bool(src.showConfigBanner, def.showConfigBanner),
        autoReloadOnStructural: bool(src.autoReloadOnStructural, def.autoReloadOnStructural),
      };
    }
    default:
      return deepClone(def);
  }
}

export function defaultCategory(category) {
  return sanitizeCategory(category, DEFAULTS[category]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Store — persistent preset library.
// ─────────────────────────────────────────────────────────────────────────────
export function createDefaultStore() {
  const presets = {};
  const active = {};
  for (const cat of CATEGORIES) {
    presets[cat] = { Default: defaultCategory(cat) };
    active[cat] = null; // null = use the game's own built-in constants
  }
  return {
    version: DEV_ENGINE_VERSION,
    presets,
    active,
    masters: {},
    activeMaster: null,
  };
}

function migrateStore(raw) {
  // Forward-compatible migration. Unknown/older versions are re-sanitized onto
  // a fresh default store so nothing ever crashes on schema drift.
  const store = createDefaultStore();
  if (!isObj(raw)) return store;
  if (isObj(raw.presets)) {
    for (const cat of CATEGORIES) {
      const bank = raw.presets[cat];
      if (!isObj(bank)) continue;
      for (const name of Object.keys(bank)) {
        store.presets[cat][name] = sanitizeCategory(cat, bank[name]);
      }
    }
  }
  if (isObj(raw.active)) {
    for (const cat of CATEGORIES) {
      const name = raw.active[cat];
      if (name && store.presets[cat] && store.presets[cat][name]) store.active[cat] = name;
    }
  }
  if (isObj(raw.masters)) {
    for (const mName of Object.keys(raw.masters)) {
      const m = raw.masters[mName];
      const cats = isObj(m?.categories) ? m.categories : {};
      const clean = {};
      for (const cat of CATEGORIES) {
        const ref = cats[cat];
        clean[cat] = ref && store.presets[cat] && store.presets[cat][ref] ? ref : null;
      }
      store.masters[mName] = { categories: clean };
    }
  }
  if (raw.activeMaster && store.masters[raw.activeMaster]) store.activeMaster = raw.activeMaster;
  store.version = DEV_ENGINE_VERSION;
  return store;
}

export function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return createDefaultStore();
    return migrateStore(JSON.parse(raw));
  } catch (_) {
    return createDefaultStore();
  }
}

export function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (_) {}
  // Recompute + publish the resolved snapshot and notify listeners (game tab).
  const active = resolveActive(store);
  writeActive(active);
  return store;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset CRUD
// ─────────────────────────────────────────────────────────────────────────────
export function createPreset(store, category, name, config) {
  if (!store.presets[category]) store.presets[category] = {};
  store.presets[category][name] = sanitizeCategory(category, config ?? DEFAULTS[category]);
  return store;
}

export function renamePreset(store, category, oldName, newName) {
  const bank = store.presets[category];
  if (!bank || !bank[oldName] || newName === oldName || bank[newName]) return store;
  bank[newName] = bank[oldName];
  delete bank[oldName];
  if (store.active[category] === oldName) store.active[category] = newName;
  for (const m of Object.values(store.masters)) {
    if (m.categories[category] === oldName) m.categories[category] = newName;
  }
  return store;
}

export function duplicatePreset(store, category, name, newName) {
  const bank = store.presets[category];
  if (!bank || !bank[name]) return store;
  const target = newName || `${name} copy`;
  bank[target] = deepClone(bank[name]);
  return store;
}

export function deletePreset(store, category, name) {
  const bank = store.presets[category];
  if (!bank || name === "Default") return store; // Default is the protected fallback
  delete bank[name];
  if (store.active[category] === name) store.active[category] = null;
  for (const m of Object.values(store.masters)) {
    if (m.categories[category] === name) m.categories[category] = null;
  }
  return store;
}

export function activatePreset(store, category, name) {
  // name === null → deactivate (fall back to built-in defaults).
  if (name !== null && !store.presets[category]?.[name]) return store;
  store.active[category] = name;
  return store;
}

export function resetCategory(store, category) {
  store.presets[category] = { Default: defaultCategory(category), ...store.presets[category] };
  store.presets[category].Default = defaultCategory(category);
  store.active[category] = null;
  return store;
}

// Master presets ─────────────────────────────────────────────────────────────
export function createMaster(store, name, categoriesRef) {
  const clean = {};
  for (const cat of CATEGORIES) {
    const ref = categoriesRef?.[cat] ?? store.active[cat];
    clean[cat] = ref && store.presets[cat]?.[ref] ? ref : null;
  }
  store.masters[name] = { categories: clean };
  return store;
}

export function deleteMaster(store, name) {
  delete store.masters[name];
  if (store.activeMaster === name) store.activeMaster = null;
  return store;
}

export function activateMaster(store, name) {
  if (name !== null && !store.masters[name]) return store;
  store.activeMaster = name;
  return store;
}

// Capture the *current* active per-category selection as a new master.
export function captureMaster(store, name) {
  return createMaster(store, name, store.active);
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveActive — the heart of the layering model.
// Master (when active) takes precedence per-category; otherwise per-category
// `active`. Only categories with a resolved preset appear in the snapshot.
// ─────────────────────────────────────────────────────────────────────────────
export function resolveActive(store) {
  const snapshot = { version: DEV_ENGINE_VERSION, _categories: [] };
  const master = store.activeMaster ? store.masters[store.activeMaster] : null;
  for (const cat of CATEGORIES) {
    const masterRef = master ? master.categories[cat] : null;
    const name = masterRef ?? store.active[cat];
    if (name && store.presets[cat]?.[name]) {
      snapshot[cat] = sanitizeCategory(cat, store.presets[cat][name]);
      snapshot._categories.push(cat);
    }
  }
  return snapshot;
}

export function writeActive(snapshot) {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(snapshot));
  } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: snapshot }));
  } catch (_) {}
}

export function loadActive() {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return { version: DEV_ENGINE_VERSION, _categories: [] };
    const parsed = JSON.parse(raw);
    // Re-sanitize every present category so a hand-edited/corrupt snapshot is safe.
    const clean = { version: DEV_ENGINE_VERSION, _categories: [] };
    for (const cat of CATEGORIES) {
      if (parsed && parsed[cat] != null) {
        clean[cat] = sanitizeCategory(cat, parsed[cat]);
        clean._categories.push(cat);
      }
    }
    return clean;
  } catch (_) {
    return { version: DEV_ENGINE_VERSION, _categories: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export / import — full store round-trip as JSON text.
// ─────────────────────────────────────────────────────────────────────────────
export function exportStore(store) {
  return JSON.stringify({ kind: "rb-dev-store", version: DEV_ENGINE_VERSION, store }, null, 2);
}

export function importStore(text) {
  const parsed = JSON.parse(text);
  const raw = parsed?.store ?? parsed; // accept either wrapped or bare store
  return migrateStore(raw);
}

export function exportCategoryPreset(category, config) {
  return JSON.stringify(
    { kind: "rb-dev-preset", category, version: DEV_ENGINE_VERSION, config: sanitizeCategory(category, config) },
    null,
    2
  );
}

export function importCategoryPreset(text) {
  const parsed = JSON.parse(text);
  const category = parsed?.category;
  if (!CATEGORIES.includes(category)) throw new Error("Unknown or missing preset category");
  return { category, config: sanitizeCategory(category, parsed.config ?? parsed) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Classic-script bridge — environment.js (a non-module script) reads this.
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== "undefined") {
  window.RB_DEV_ENGINE = {
    version: DEV_ENGINE_VERSION,
    STORE_KEY,
    ACTIVE_KEY,
    CHANGE_EVENT,
    CATEGORIES,
    STRUCTURAL_CATEGORIES,
    DEFAULTS,
    loadActive,
    loadStore,
    saveStore,
    resolveActive,
    sanitizeCategory,
  };
}
