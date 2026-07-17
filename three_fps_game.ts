﻿﻿import {
  ANGEL_DRONE_TEXTURE_PATHS,
  EXTERIOR_CITY_MODEL_PATH,
  PLAYER_ANIMATION_GLTF_PATHS,
  PLAYER_ANIMATION_PATHS,
  PLAYER_MODEL_GLTF_PATH,
  PLAYER_MODEL_PATH,
  SIEGE_DRONE_MODEL_PATH,
  SIEGE_DRONE_MODEL_GLB_PATH,
  SIEGE_DRONE_WALK_ANIMATION_PATH,
  STARTUP_TEXTURE_ASSETS,
} from "./modules/asset_paths.js";
import {
  createLoadingController,
  getHudElements,
  getMenuElements,
  setClassIfChanged,
  setStyleIfChanged,
  setTextIfChanged,
} from "./modules/dom_ui.js";
import { createGunState, GUNS, GUN_SPECS, type GunType } from "./modules/gun_config";
import { registerEnemy, unregisterEnemy, setEnemyAlive, enemies as ecsEnemies, liveEnemies } from "./modules/ecs";
import { createStormWarden } from "./modules/storm_warden.js";
import { createZombieCharacter } from "./modules/zombie_character.js";
import { ZOMBIE_MODEL_GLB_PATH, ZOMBIE_ANIMATION_PATHS, ZOMBIE_ONCE_ANIMATIONS } from "./modules/zombie_assets.js";
import { LANDMARKS } from "./modules/landmarks.js";
import { SFX_MANIFEST, VO_MANIFEST } from "./modules/audio_assets.js";
import { loadSettings, saveSettings } from "./modules/settings.js";
import { createGLTFLoader as createConfiguredGLTFLoader } from "./modules/three_loaders.js";
import {
  applyModelEditorTransform,
  captureModelEditorBase,
  loadModelEditorState,
  MODEL_EDITOR_STORAGE_KEY,
} from "./modules/model_editor_state.js";
import {
  loadActive as loadDevActive,
  ACTIVE_KEY as DEV_ACTIVE_KEY,
  CHANGE_EVENT as DEV_CHANGE_EVENT,
  STRUCTURAL_CATEGORIES as DEV_STRUCTURAL,
} from "./modules/dev_engine.js";

declare global {
  interface Window { [key: string]: any; }
  // The game reads DOM elements fetched by id/query as inputs/canvases and stashes
  // ad-hoc fields (e.g. `_timer`) on them. Declaring these optional on the base DOM
  // interfaces models that usage without casting each getElementById result.
  interface HTMLElement { value?: any; disabled?: any; width?: any; height?: any; _timer?: any; getContext?: any; }
  interface Element { disabled?: any; dataset?: any; value?: any; checked?: any; title?: any; style?: any; click?: any; }
  interface Event { code?: any; }
  interface Navigator { deviceMemory?: any; }
}
// Augment THREE's base Object3D with the discriminant flags + members that live on
// its subclasses (Mesh/SkinnedMesh/InstancedMesh/Light). The code inspects these via
// `obj.isMesh` / `obj.material` in traverse() callbacks where the static type is only
// Object3D. Declaring them optional models reality and clears those accesses without
// per-site casts.
declare module "three" {
  interface Object3D {
    isMesh?: boolean;
    isInstancedMesh?: boolean;
    isSkinnedMesh?: boolean;
    isLight?: boolean;
    isPoints?: boolean;
    isLine?: boolean;
    isSprite?: boolean;
    isLineSegments?: boolean;
    material?: any;
    geometry?: any;
    intensity?: number;
    count?: number;
    morphTargetInfluences?: number[];
  }
  interface Sprite {
    updateEnergySprite?: any;
    resetEnergySprite?: any;
    disposeEnergySprite?: any;
  }
}

(async () => {
  "use strict";

  // Bare specifiers: bundled + tree-shaken by Vite for production, and resolved
  // by the importmap (three + "three/" prefix) when the standalone HTML is opened
  // without a build step. Both entry points share this one file.
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { RGBELoader } = await import("three/examples/jsm/loaders/RGBELoader.js");
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  const { clone: skeletonClone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
  const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
  const { RectAreaLightUniformsLib } = await import("three/examples/jsm/lights/RectAreaLightUniformsLib.js");
  const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
  const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
  const { ShaderPass } = await import("three/examples/jsm/postprocessing/ShaderPass.js");
  const { OutputPass } = await import("three/examples/jsm/postprocessing/OutputPass.js");
  THREE.Cache.enabled = true;
  RectAreaLightUniformsLib.init();

  const createGLTFLoader = () => createConfiguredGLTFLoader(THREE, GLTFLoader);

  function withStartupTimeout(promise, ms, label) {
    let timeoutId: any = 0;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(label)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  function getDevicePerformanceProfile() {
    const cores = navigator.hardwareConcurrency || 4;
    // deviceMemory is only exposed on secure contexts (localhost / HTTPS).
    // When undefined (LAN http:// origin) treat it as "not a constraint" rather
    // than defaulting to 4 GB which would silently downgrade LAN players to medium.
    const memoryRaw = navigator.deviceMemory;
    const memoryKnown = typeof memoryRaw === "number";
    const memory = memoryKnown ? memoryRaw : 8; // assume capable when API unavailable
    const mobile = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);

    if (mobile) {
      // Phones (incl. 4 GB RAM): the most aggressive profile. No post-FX, no
      // shadows, low DPR + render scale. Gameplay is identical to desktop; only
      // the rendering budget is trimmed so it holds a smooth frame rate.
      return { tier: "low", mobile: true, antialias: false, maxDpr: 0.92, startScale: 0.82, minScale: 0.6, maxScale: 1.0, cinematic: false };
    }
    if (cores <= 2 || (memoryKnown && memory <= 2)) {
      return { tier: "low", mobile: false, antialias: false, maxDpr: 0.95, startScale: 0.66, minScale: 0.36, maxScale: 0.82, cinematic: true };
    }
    if (cores >= 8 && memory >= 8) {
      return { tier: "high", mobile: false, antialias: true, maxDpr: 1.55, startScale: 1, minScale: 0.62, maxScale: 1.1, cinematic: true };
    }
    return { tier: "medium", mobile: false, antialias: true, maxDpr: 1.25, startScale: 0.92, minScale: 0.54, maxScale: 1, cinematic: true };
  }

  const deviceProfile = getDevicePerformanceProfile();
  const lowEndMode = deviceProfile.tier === "low";
  const mobileMode = !!deviceProfile.mobile;
  // Diagnostic/perf override: force the cheap procedural enemy instead of the
  // ~580k-tri angel FBX. Set localStorage.rb_force_lowpoly_enemies = 1.
  const forceLowPolyEnemies = (() => { try { return !!localStorage.getItem("rb_force_lowpoly_enemies"); } catch { return false; } })();
  // Published so classic-script modules (exterior_map.js) can pick lightweight
  // procedural props instead of heavy GLB downloads on phones.
  window.__mobileMode = mobileMode;

  const environment = window.RoomBreachEnvironment;
  if (!environment) throw new Error("RoomBreachEnvironment did not load before three_fps_game.js");

  const {
    MAP,
    MAP_W,
    MAP_H,
    CELL,
    PLAYER_H,
    mapToWorld,
    worldToMap,
    wallAt,
    wallAtWorldRadius,
    isOpenCell,
    cellCenter,
    buildLevel,
    setupEnvironmentLighting,
    buildEveningSky,
  } = environment;

  // ── Developer Engine: resolved active config ───────────────────────────────
  // Only categories a developer explicitly activated are present. Absent
  // categories fall through to the game's own constants, so default behavior is
  // unchanged unless a preset is applied. See modules/dev_engine.js + dev.html.
  const DEV: any = loadDevActive();
  const devHas = (cat) => !!(DEV && DEV[cat]);
  const devVal = (cat, key, fallback) =>
    (devHas(cat) && DEV[cat][key] != null && DEV[cat][key] !== "" ? DEV[cat][key] : fallback);
  window.__RB_DEV_ACTIVE = DEV;
  // Live-mutable debug toggles (updated by the storage listener without reload).
  let devFreezeEnemies = !!(DEV.debug && DEV.debug.freezeEnemies);

  // The persistent on-HUD "DEV PRESET" banner is intentionally NOT shown — it
  // clutters gameplay. Preset state is visible in the dev console instead; live
  // edits still flash the transient "● LIVE-APPLIED" toast. This function just
  // ensures no stale banner remains (e.g. from an older build/session).
  function updateDevBanner() {
    document.getElementById("dev-preset-banner")?.remove();
  }
  updateDevBanner();

  // Pristine copy of the built-in weapon specs, captured BEFORE any dev mutation.
  // Every re-apply resets from this base first, so live edits never compound.
  const GUN_SPECS_BASE = JSON.parse(JSON.stringify(GUN_SPECS));

  // Weapons + player-damage scaling mutate the shared GUN_SPECS in place. Idempotent:
  // resets from GUN_SPECS_BASE, then layers the active override on top.
  // Includes the per-gun physics fields (moveSpeedMul/swayMul/shakeMul/driftMul/bloom*).
  const DEV_WEAPON_NUM_FIELDS = ["magazine", "ammo", "fireRate", "reloadTime", "adsFov",
    "adsInSpeed", "adsOutSpeed", "adsMovePenalty", "damage", "pellets", "spread",
    "moveSpeedMul", "swayMul", "shakeMul", "driftMul", "bloomGrow", "bloomMax", "bloomDecay",
    "equipTime", "muzzleFlashScale", "muzzleFlashTime"];
  function applyDevWeapons() {
    for (const gun of Object.keys(GUN_SPECS)) {
      const base = GUN_SPECS_BASE[gun];
      if (base) {
        const spec = GUN_SPECS[gun];
        for (const k of DEV_WEAPON_NUM_FIELDS) {
          if (Number.isFinite(base[k])) spec[k] = base[k];
        }
        if (spec.recoil && base.recoil) {
          spec.recoil.kick = base.recoil.kick;
          spec.recoil.yaw = base.recoil.yaw;
          spec.recoil.roll = base.recoil.roll;
        }
      }
    }
    if (devHas("weapons")) {
      for (const gun of Object.keys(GUN_SPECS)) {
        const o = DEV.weapons[gun];
        const spec = GUN_SPECS[gun];
        if (!o || !spec) continue;
        for (const k of DEV_WEAPON_NUM_FIELDS) {
          if (Number.isFinite(o[k])) spec[k] = o[k];
        }
        if (spec.recoil) {
          if (Number.isFinite(o.recoilKick)) spec.recoil.kick = o.recoilKick;
          if (Number.isFinite(o.recoilYaw)) spec.recoil.yaw = o.recoilYaw;
          if (Number.isFinite(o.recoilRoll)) spec.recoil.roll = o.recoilRoll;
        }
      }
    }
    if (devHas("gameplay") && Number.isFinite(DEV.gameplay.playerDamageMult) && DEV.gameplay.playerDamageMult !== 1) {
      const m = DEV.gameplay.playerDamageMult;
      for (const gun of Object.keys(GUN_SPECS)) GUN_SPECS[gun].damage *= m;
    }
  }
  applyDevWeapons();

  // Live re-apply: the dev panel (dev.html) writes the resolved snapshot to
  // localStorage in another tab, which fires a `storage` event here. We hot-apply
  // EVERY category by mutating live game state — no reload — for a seamless edit
  // loop. Only two things genuinely can't hot-swap and still reload: the map
  // geometry (full collision/geometry rebuild) and the renderer backend.
  function devReapply(next) {
    // 1) Reload-only cases: map layout or renderer backend changed.
    const mapChanged = JSON.stringify(DEV.map || null) !== JSON.stringify(next.map || null);
    const prevRenderer = (DEV.quality && DEV.quality.renderer) || "auto";
    const nextRenderer = (next.quality && next.quality.renderer) || "auto";
    const rendererChanged = prevRenderer !== nextRenderer;
    if (mapChanged || rendererChanged) {
      const toast = document.createElement("div");
      toast.textContent = mapChanged ? "Rebuilding map — reloading…" : "Switching renderer — reloading…";
      toast.style.cssText =
        "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
        "z-index:100000;font:600 15px ui-monospace,monospace;color:#7cf3ff;background:rgba(2,6,10,.86);";
      document.body?.appendChild(toast);
      setTimeout(() => location.reload(), 300);
      return;
    }

    // 2) Swap the live DEV snapshot in place so every `devVal()` reader updates.
    for (const k of Object.keys(DEV)) delete DEV[k];
    Object.assign(DEV, next);
    window.__RB_DEV_ACTIVE = DEV;

    // 3) Re-run the idempotent appliers against the new snapshot.
    devFreezeEnemies = !!(DEV.debug && DEV.debug.freezeEnemies);
    applyDevWeapons();
    refreshGunStatesFromSpecs();
    applyDevEnemies();
    applyDevPlayer();
    refreshDevCameraConsts();
    applyDevLightingLive();
    applyDevQualityLive();
    updateDevBanner();
    flashDevApplied();
  }
  window.addEventListener("storage", (e) => {
    if (e.key === DEV_ACTIVE_KEY) { try { devReapply(loadDevActive()); } catch (err) { console.warn("[dev] live re-apply failed:", err); } }
  });

  // Tiny non-blocking confirmation that a live edit landed (no reload).
  function flashDevApplied() {
    let t = document.getElementById("dev-applied-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "dev-applied-toast";
      t.style.cssText =
        "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;" +
        "font:600 11px ui-monospace,monospace;letter-spacing:.1em;color:#6effb0;" +
        "background:rgba(6,20,14,.9);border:1px solid rgba(110,255,176,.4);padding:6px 14px;" +
        "border-radius:999px;pointer-events:none;transition:opacity .25s;";
      document.body?.appendChild(t);
    }
    t.textContent = "● LIVE-APPLIED";
    t.style.opacity = "1";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { if (t) t.style.opacity = "0"; }, 900);
  }

  // Push new GUN_SPECS values into the live gun states (preserving pack level +
  // current mag/ammo). applyGunUpgradeStats re-derives damage/magSize/fireRate/
  // reloadTime/spread from the spec; we also carry over pellets + ADS values.
  function refreshGunStatesFromSpecs() {
    if (typeof allGuns === "undefined") return;
    for (const gunType of Object.keys(allGuns)) {
      const state = allGuns[gunType];
      const spec = GUN_SPECS[gunType];
      if (!state || !spec) continue;
      applyGunUpgradeStats(gunType, false);
      state.pellets = spec.pellets;
      // keep reserve/mag within the (possibly new) capacity
      if (Number.isFinite(spec.ammo)) state.ammo = Math.min(state.ammo, spec.ammo);
    }
  }

  // Re-run interior environment lighting against the updated snapshot (colors,
  // intensity multipliers, light-count cap). environment.js re-reads the override
  // via applyDevOverrides, then we rebuild its tagged lights in place.
  function applyDevLightingLive() {
    try {
      environment.applyDevOverrides?.(DEV);
      if (typeof setupEnvironmentLighting === "function") setupEnvironmentLighting(THREE, scene, renderer);
    } catch (err) { console.warn("[dev] live lighting re-apply failed:", err); }
  }

  // Apply the non-structural Performance caps live (render scale / pixel ratio).
  // Renderer backend + interior light count are handled elsewhere (reload / lighting).
  function applyDevQualityLive() {
    const cap = devVal("quality", "renderScaleCap", 0);
    const prCap = devVal("quality", "pixelRatioCap", 0);
    if (prCap > 0) basePixelRatio = Math.min(window.devicePixelRatio || 1, prCap);
    else basePixelRatio = Math.min(window.devicePixelRatio || 1, deviceProfile.maxDpr);
    if (cap > 0) {
      quality.maxScale = Math.min(deviceProfile.maxScale, cap);
      quality.scale = Math.min(quality.scale, quality.maxScale);
    } else {
      quality.maxScale = deviceProfile.maxScale;
    }
    if (typeof applyRenderScale === "function") applyRenderScale();
    // Shadows: "on"/"off" pin live; "auto" hands control back to the governor.
    const sh = devVal("quality", "shadows", "auto");
    if (!mobileMode) {
      if (sh === "on") setShadowsEnabled(true);
      else if (sh === "off") setShadowsEnabled(false);
    }
  }

  // World-boundary failsafe box = interior MAP extent ∪ exterior play area, plus a
  // small margin. Used as a hard clamp so the player can never leave the playable
  // world even if collision is momentarily bypassed (clipping, teleport, knockback).
  const _interiorXMax = (MAP_W * 0.5) * CELL;
  const _interiorZMin = mapToWorld(0, 0).z;
  const _extB = window.__extBounds || { xMin: -72, xMax: 72, zNear: 122, zFar: 230 };
  const WORLD_BOUND_X_MIN = Math.min(-_interiorXMax, _extB.xMin) - 1.5;
  const WORLD_BOUND_X_MAX = Math.max(_interiorXMax, _extB.xMax) + 1.5;
  const WORLD_BOUND_Z_MIN = _interiorZMin - 1.5;
  const WORLD_BOUND_Z_MAX = _extB.zFar + 1.5;

  const canvas = document.getElementById("gameCanvas");
  const mmCanvas = document.getElementById("minimap-canvas");
  const mmCtx = mmCanvas?.getContext("2d") ?? null;
  const ovScanCanvas = document.getElementById("ov-scan-canvas");
  const ovScanCtx = ovScanCanvas?.getContext("2d") ?? null;

  const hud = getHudElements(document);
  const {
    overlay,
    stateOverlay,
    stateTitle,
    stateSub,
    statsPanel,
    stateActions,
    stateRestartBtn,
    stateQuitBtn,
    startBtn,
    resumeBtn,
    restartBtn,
    loadoutBtn,
    loadoutPanel,
    intelBtn,
    multiplayerBtn,
    modelEditorBtn,
    quitBtn,
    menuPanels,
    loadoutCards,
    selectedLoadoutVal,
    launchLoadoutBtn,
    quitConfirmBtn,
    quitCancelBtn,
    quitStatus,
    menuTitle,
    menuTagline,
    menuCopy,
  } = getMenuElements(document);
  const {
    status: loadingStatus,
    setProgress: setLoadingProgress,
    hide: hideLoadingScreen,
  } = createLoadingController(document);

  let renderer;
  const baseToneMappingExposure = 1.16;

  // ── Renderer backend selection ─────────────────────────────────────────────
  // Measured reality: three r166's experimental WebGPU path issues ~100× the
  // draw calls of WebGL for this exact scene on many desktop GPUs (43k vs ~424),
  // dragging desktops to ~16 fps. WebGL is the mature/fast path there. BUT mobile
  // GPUs can exceed WebGL shader limits on this multi-map/multi-light scene and
  // render black, where WebGPU compiles reliably. So the choice is device-aware:
  //   • "auto" (default): desktop → WebGL, mobile → WebGPU-first (WebGL fallback).
  //   • "webgl" / "webgpu": force a backend.
  // Precedence: explicit localStorage `rb_renderer` > legacy `rb_force_webgl`
  // > dev-console Performance preset (quality.renderer) > "auto".
  const rendererPref = (() => {
    try {
      const explicit = localStorage.getItem("rb_renderer");
      if (explicit === "webgl" || explicit === "webgpu" || explicit === "auto") return explicit;
      if (localStorage.getItem("rb_force_webgl")) return "webgl";
    } catch (_) {}
    const q = devVal("quality", "renderer", "auto");
    return ["auto", "webgl", "webgpu"].includes(q) ? q : "auto";
  })();
  // auto → only mobile prefers WebGPU; desktop takes the fast WebGL path.
  const wantWebGPU = rendererPref === "webgpu" ? true
    : rendererPref === "webgl" ? false
    : mobileMode;
  if (wantWebGPU && typeof navigator !== "undefined" && 'gpu' in navigator) {
    try {
      const adapter = await withStartupTimeout(
        (navigator as any).gpu.requestAdapter?.({ powerPreference: deviceProfile.tier === "low" ? "low-power" : "high-performance" }),
        3000,
        "WebGPU adapter request timed out"
      );
      if (!adapter) throw new Error("WebGPU adapter unavailable");
      const webgpuMod = await withStartupTimeout(
        import("three/examples/jsm/renderers/webgpu/WebGPURenderer.js"),
        8000,
        "WebGPU renderer import timed out"
      );
      const WebGPURenderer = webgpuMod.WebGPURenderer || webgpuMod.default;
      if (WebGPURenderer) {
        renderer = new WebGPURenderer({ canvas, antialias: deviceProfile.antialias, powerPreference: deviceProfile.tier === "low" ? "low-power" : "high-performance" });
        if (typeof renderer.init === 'function') {
          // Some WebGPU renderers expose an async init step.
          await withStartupTimeout(renderer.init(), 8000, "WebGPU renderer init timed out");
        }
        console.info('Using WebGPU renderer');
      }
    } catch (e) {
      console.warn('WebGPU renderer failed to load or initialize, falling back to WebGL:', e);
      renderer = null;
    }
  }

  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: deviceProfile.antialias, powerPreference: deviceProfile.tier === "low" ? "low-power" : "high-performance" });
    console.info('Using WebGL renderer');
  }
  const rendererBackend = renderer.isWebGPURenderer || /WebGPU/i.test(renderer.constructor?.name || "") ? "webgpu" : "webgl";
  canvas.dataset.rendererBackend = rendererBackend;

  // Reflect the real backend on the loading screen (was hard-coded "WebGL 2.0").
  {
    const platformEl = document.querySelector(".ls-bottom .ls-sys");
    if (platformEl) platformEl.textContent = `Platform: ${rendererBackend === "webgpu" ? "WebGPU" : "WebGL 2.0"} · Three.js r166`;
  }

  // Ensure a minimal capabilities shim so other modules can query anisotropy.
  if (!renderer.capabilities) {
    renderer.capabilities = { getMaxAnisotropy: () => 1 };
  }

  // Apply common renderer settings where supported. Fail gracefully for WebGPU differences.
  try {
    if (typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, deviceProfile.maxDpr));
    if (typeof renderer.setSize === 'function') renderer.setSize(window.innerWidth, window.innerHeight, false);
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if ('toneMapping' in renderer) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if ('toneMappingExposure' in renderer) renderer.toneMappingExposure = baseToneMappingExposure;
    if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;
    if (renderer.shadowMap) {
      // Shadows are a significant per-fragment GPU cost (every lit surface samples
      // the shadow map each frame). Disabled on mobile; on desktop the dev
      // Performance setting ("off" forces off, "on" forces on) and the adaptive
      // perf governor (below) can drop them when the frame rate stays low.
      const devShadows = devVal("quality", "shadows", "auto");
      renderer.shadowMap.enabled = !mobileMode && devShadows !== "off";
      if ('type' in renderer.shadowMap) renderer.shadowMap.type = lowEndMode ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
      // Shadow update policy: low-end keeps the static one-shot bake (no per-frame
      // shadow draws; characters simply don't cast there). Everything else updates
      // per-frame so the player/enemies/cars cast MOVING shadows — the depth-only
      // caster pass is cheap now that the static world is merged/instanced, and the
      // perf governor below can still drop shadows entirely if the frame rate tanks.
      renderer.shadowMap.autoUpdate = !lowEndMode;
    }
  } catch (e) {
    console.warn('Failed to apply some renderer settings (non-fatal):', e);
  }

  // WebGL context loss: pause rendering and warn the player. On restore, the
  // THREE.js renderer automatically rebuilds GPU resources — we just resume.
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault(); // required to allow context restoration
    console.warn("[renderer] WebGL context lost — pausing render loop.");
    const lostOverlay = document.getElementById("state-overlay") || document.body;
    if (lostOverlay) {
      lostOverlay.dataset.contextLost = "1";
      const msg = document.createElement("div");
      msg.id = "rb-context-lost-msg";
      msg.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.85);color:#e8920a;font:bold 1.2rem 'Share Tech Mono',monospace;z-index:9999;text-align:center;padding:2rem;";
      msg.textContent = "GPU context lost — waiting for browser to restore it…";
      document.body.appendChild(msg);
    }
  }, false);

  canvas.addEventListener("webglcontextrestored", () => {
    console.info("[renderer] WebGL context restored — resuming.");
    document.getElementById("rb-context-lost-msg")?.remove();
    const lostOverlay = document.getElementById("state-overlay") || document.body;
    if (lostOverlay) delete lostOverlay.dataset.contextLost;
    requestAnimationFrame(animate);
  }, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd8c2a4); // golden-hour horizon (see applyWaveLighting)
  scene.fog = null; // new THREE.FogExp2(0x080b14, 0.03);
  let exteriorCityRoot = null;

  // ── Sky + Image-Based Lighting (IBL) ────────────────────────────────────────
  // Asset-pipeline foundation. A procedurally generated equirectangular daytime sky
  // is used BOTH as the scene background (visible skybox) AND — via PMREM — as an
  // environment map, so every PBR material gets cohesive ambient + real reflections.
  // Built once (near-zero per-frame cost). The canvas can later be swapped for an
  // RGBELoader-loaded .hdr without touching any call site: just replace makeEquirectSky
  // with a loader that returns an EquirectangularReflectionMapping texture.
  let skyEnvActive = false;
  function makeEquirectSky() {
    const w = 2048, h = 1024;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    // Vertical band gradient: deep zenith → pale horizon → muted ground (bottom half
    // matters: it becomes the IBL ground-bounce tone, so it must not be pure blue).
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.00, "#2f6bd8");
    grad.addColorStop(0.34, "#6fa8ef");
    grad.addColorStop(0.49, "#cfe2f5");
    grad.addColorStop(0.51, "#b9c4cc");
    grad.addColorStop(1.00, "#5b5347");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    // Soft cloud puffs in the upper sky (screen-blended).
    ctx.globalCompositeOperation = "screen";
    let s = 20250703 >>> 0;
    const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 0xffffffff); };
    for (let i = 0; i < 46; i++) {
      const cx = rng() * w, cy = h * (0.05 + rng() * 0.34);
      const cw = 130 + rng() * 360, ch = 22 + rng() * 46;
      const a = 0.05 + rng() * 0.13;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw * 0.5);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ch / (cw * 0.5));
      ctx.beginPath(); ctx.arc(0, 0, cw * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    // Sun: warm core + wide halo, high in the sky.
    const sunX = w * 0.30, sunY = h * 0.15, sunR = 230;
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sg.addColorStop(0.00, "rgba(255,253,244,1)");
    sg.addColorStop(0.05, "rgba(255,249,228,1)");
    sg.addColorStop(0.16, "rgba(255,241,204,0.55)");
    sg.addColorStop(0.50, "rgba(255,238,198,0.12)");
    sg.addColorStop(1.00, "rgba(255,238,198,0)");
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
  // Golden-hour sky with full cloud coverage in every direction (Poly Haven CC0).
  // ?sky=<basename> URL param previews any .hdr in assets/hdri (dev only).
  const SKY_HDR_PATH = new URLSearchParams(window.location.search).get("sky")
    ? `./assets/hdri/${new URLSearchParams(window.location.search).get("sky")}.hdr`
    : "./assets/hdri/kloppenheim_06_puresky_2k.hdr";
  // The HDR's sky values are hot; this damps the visible dome so ACES doesn't bleach
  // the clouds to white. IBL (scene.environment) uses the undamped texture.
  const SKY_DOME_DAMP = 0.35;

  // The one visible skybox: a camera-locked sphere textured with the real HDR equirect
  // (same image driving the IBL below), so what you see matches what lights the scene —
  // no separate procedural gradient/sun-sprite layer on top of it. Works identically on
  // WebGL and WebGPU (a textured mesh, unlike scene.background, renders on both).
  function buildSkyDome(equirect) {
    let dome = scene.getObjectByName("DaySkyDome");
    const map = equirect.clone();
    map.mapping = THREE.UVMapping; // SphereGeometry UVs already match equirect layout
    // RGBELoader DataTextures have flipY=false (row 0 = zenith), which renders the sky
    // upside-down on the sphere: blue zenith at eye level, bright sunset horizon overhead
    // (looked like a wrong "high noon" HDR while reflections showed the real sunset —
    // the equirect IBL path flips internally, the raw UV-mapped dome does not).
    // The procedural canvas fallback is flipY=true and already correct, hence the guard.
    if (!map.flipY) { map.wrapT = THREE.ClampToEdgeWrapping; map.repeat.y = -1; map.offset.y = 1; }
    map.needsUpdate = true;
    if (dome) {
      dome.material.map?.dispose();
      dome.material.map = map;
      dome.material.needsUpdate = true;
      return;
    }
    const geo = new THREE.SphereGeometry(460, 48, 24);
    // toneMapped:true — the HDR has real >1 highlight values (sun, lit clouds); ACES
    // rolls them off. With tone mapping off they hard-clip to white and the sky burns out.
    dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, color: new THREE.Color().setScalar(SKY_DOME_DAMP), side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true }));
    dome.name = "DaySkyDome"; dome.renderOrder = -10; dome.frustumCulled = false;
    dome.onBeforeRender = (_r, _s, cam) => dome.position.setFromMatrixPosition(cam.matrixWorld); // world pos — cam.position is local
    scene.add(dome);
    window.__rbSkyDome = dome; // dev diagnostic
  }

  // Blackout-wave fire sky (WebGL path): a proper animated GLSL ShaderMaterial —
  // procedural FBM noise fire rolling along the horizon band, drifting ember sparks
  // and curling smoke, all driven by a time uniform advanced in onBeforeRender (so
  // it costs exactly nothing while the dome is hidden). Horizon-banded: overhead
  // stays near-black. Camera-locked, renderOrder -9, BackSide, additive, with the
  // same opacity flicker the canvas dome had.
  // ── Blackout fiery sun: ONE canonical direction shared by the fire-dome shader
  // (sun disc uniform) and applyWaveLighting (directional-light placement), so the
  // light in the world comes exactly FROM the burning sun you see in the sky.
  // Low elevation (16° — low enough for long fire-lit shadows, high enough to clear
  // the DistantSkyline silhouette ring, whose rooftops subtend ~13° at the horizon),
  // azimuth ~12° — roughly where the golden-hour sun sits (+X), so the blackout reads
  // as "the sun turned molten", not "a second sun appeared elsewhere".
  const BLACKOUT_SUN_DIR = new THREE.Vector3(
    Math.cos(THREE.MathUtils.degToRad(16)) * Math.cos(THREE.MathUtils.degToRad(12)),
    Math.sin(THREE.MathUtils.degToRad(16)),
    Math.cos(THREE.MathUtils.degToRad(16)) * Math.sin(THREE.MathUtils.degToRad(12))
  ).normalize();

  function buildFireSkyDomeShader() {
    if (scene.getObjectByName("FireSkyDome")) return;
    const uniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uSunDir: { value: BLACKOUT_SUN_DIR.clone() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vDir;
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uSunDir;

        // ── hash / value noise / FBM ──
        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < 5; i++) {
            v += a * vnoise(p);
            p = rot * p * 2.03 + vec2(11.7, 7.3);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          // Azimuth wraps seamlessly; elevation 0 = horizon, 1 = zenith.
          float az = atan(vDir.z, vDir.x); // -PI..PI
          float el = clamp(vDir.y, -0.2, 1.0);
          // Wrap-safe horizontal coordinate for the noise field.
          vec2 cyl = vec2(cos(az), sin(az)) * 3.0;

          // Horizon band: fire lives ON the horizon — fades going up AND going
          // down. (exp(-el*5.2) alone explodes to ~2.8× at the el=-0.2 clamp,
          // blowing the whole below-horizon half of the dome out to white
          // whenever the camera is above rooftop height.)
          float band = exp(-max(el, 0.0) * 5.2) * exp(min(el, 0.0) * 7.0);
          float overhead = smoothstep(0.55, 0.15, el); // extra kill above ~33 deg

          // ── Rolling flame licks: FBM advected upward + sideways drift, domain-warped ──
          vec2 fp = vec2(cyl.x + cyl.y * 0.7, el * 6.0);
          vec2 warp = vec2(
            fbm(fp * 1.6 + vec2(uTime * 0.11, -uTime * 0.34)),
            fbm(fp * 1.6 + vec2(-uTime * 0.07, -uTime * 0.41) + 19.1)
          );
          float flame = fbm(fp * 2.2 + warp * 1.7 + vec2(uTime * 0.16, -uTime * 0.85));
          // Sharpen into licking tongues that decay with elevation.
          float lick = pow(clamp(flame * 1.35 - el * 1.9 + 0.28, 0.0, 1.0), 2.1);

          // ── Curling smoke: slower, darker FBM layer occluding the glow ──
          float smoke = fbm(fp * 1.1 + vec2(uTime * 0.05, -uTime * 0.16) + 47.0);
          float smokeMask = smoothstep(0.35, 0.85, smoke) * smoothstep(0.75, 0.2, el) * 0.65;

          // ── Fire colour ramp (ember red -> orange -> hot yellow core) ──
          float heat = lick * band;
          vec3 col = vec3(0.55, 0.05, 0.0) * heat;
          col += vec3(1.0, 0.35, 0.05) * pow(heat, 1.8) * 1.4;
          col += vec3(1.0, 0.83, 0.42) * pow(heat, 3.6) * 1.6;
          // Base distant glow so the horizon reads even between licks.
          col += vec3(0.5, 0.10, 0.02) * band * (0.35 + 0.25 * fbm(fp + uTime * 0.03));
          // Smoke eats light.
          col *= (1.0 - smokeMask);

          // ── Drifting ember sparks: gridded point sparkle rising off the fire ──
          vec2 ep = vec2(az * 14.0, el * 26.0 + uTime * 0.9); // rise over time
          vec2 cell = floor(ep);
          vec2 fpart = fract(ep) - 0.5;
          float h = hash21(cell);
          vec2 off = vec2(h - 0.5, fract(h * 57.3) - 0.5) * 0.7;
          off.x += sin(uTime * (0.5 + h) + h * 6.28) * 0.18; // lateral drift
          float d = length(fpart - off);
          float twinkle = 0.55 + 0.45 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
          float ember = smoothstep(0.10 + h * 0.06, 0.0, d) * step(0.72, h) * twinkle;
          ember *= exp(-el * 3.4) * smoothstep(-0.05, 0.06, el);
          col += vec3(1.0, 0.55 + fract(h * 91.7) * 0.3, 0.15) * ember * 1.3;

          // ── Molten blackout SUN: hot core + FBM-licked corona + wide ember halo,
          // at uSunDir — the SAME direction the exterior DirectionalLight shines from
          // during a blackout (see applyWaveLighting), so world lighting matches it.
          vec3 dir = normalize(vDir);
          float ang = acos(clamp(dot(dir, uSunDir), -1.0, 1.0)); // radians off sun centre
          float pulse = 1.0 + 0.10 * sin(uTime * 1.7) + 0.05 * sin(uTime * 4.3 + 1.0);
          float discR = 0.055 * pulse; // ~3 deg molten core, breathing
          // Flame tongues licking around the rim: FBM over angle-around-sun + time.
          float around = atan(dir.y - uSunDir.y, az - atan(uSunDir.z, uSunDir.x));
          float rimN = fbm(vec2(around * 2.4, uTime * 0.45)) - 0.5;
          // NOTE: smoothstep edges must be ascending (edge0<edge1 or UB on some GL
          // drivers) — use 1-smoothstep for "inside disc" masks.
          float core = 1.0 - smoothstep(discR * 0.55, discR, ang);
          float corona = 1.0 - smoothstep(discR * 0.85, discR * 3.4 + rimN * 0.09, ang);
          float flick = 0.85 + 0.15 * fbm(vec2(uTime * 0.9, ang * 8.0));
          float halo = exp(-ang * 5.5);
          col += vec3(1.0, 0.93, 0.66) * core * 3.4;                 // white-hot core (only thing that clips to white)
          col += vec3(1.0, 0.40, 0.07) * corona * corona * 1.2 * flick; // fire corona
          col += vec3(0.85, 0.20, 0.04) * halo * 0.9;                // ember glow halo

          col *= (1.0 - overhead * 0.0); // band already handles falloff; keep zenith black
          col *= uOpacity;
          gl_FragColor = vec4(col, clamp(max(max(col.r, col.g), col.b) * 1.5, 0.0, 1.0) * uOpacity);
        }
      `,
    });
    mat.toneMapped = false;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(455, 40, 20), mat);
    dome.name = "FireSkyDome"; dome.renderOrder = -9; dome.frustumCulled = false;
    dome.visible = false;
    let t = 0;
    dome.onBeforeRender = (_r, _s, cam) => {
      // cam.position is LOCAL (the camera is a child of pitch/yaw) — use the world
      // matrix, or the dome sits at the origin and every sky direction (incl. the
      // blackout sun disc) skews as the player walks away from world centre.
      dome.position.setFromMatrixPosition(cam.matrixWorld);
      t += 0.01667; // fixed per-render-tick advance — visual, not physics
      uniforms.uTime.value = t;
      const flicker = 0.72 + Math.sin(t * 2.3) * 0.10 + Math.sin(t * 5.1 + 1.4) * 0.06;
      uniforms.uOpacity.value = Math.max(0, flicker);
    };
    scene.add(dome);
    window.__rbFireSkyDome = dome; // dev diagnostic
  }

  // Blackout-wave fire sky: a second camera-locked dome, hidden except during the
  // wave%10 blackout, painted with embers/smoke and animated for free via a UV
  // scroll + flicker done INSIDE onBeforeRender (three.js only calls that on a
  // visible, in-frustum object — so this costs exactly nothing while hidden, same
  // trick as the DaySkyDome's camera-follow). One extra draw call while visible.
  function buildFireSkyDome() {
    if (scene.getObjectByName("FireSkyDome")) return;
    // WebGL: proper animated GLSL fire sky (FBM flame licks + embers + smoke).
    // WebGPU r166 cannot compile ShaderMaterial (see sanitizeWebGPUMaterials), so it
    // keeps the original canvas-texture dome below as its fallback path.
    if (rendererBackend !== "webgpu") { buildFireSkyDomeShader(); return; }
    const w = 1024, h = 512;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#0a0402"; ctx.fillRect(0, 0, w, h);
    let s = 0xf12e >>> 0;
    const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; };
    // Distant fire glow blooms along the horizon band (repeats seamlessly in x).
    for (let pass = 0; pass < 2; pass++) {
      const band = pass === 0 ? [0.42, 0.62] : [0.5, 0.7];
      for (let i = 0; i < 26; i++) {
        const cx = rng() * w, cy = h * (band[0] + rng() * (band[1] - band[0]));
        const r = 40 + rng() * 130;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const hot = rng() < 0.3;
        g.addColorStop(0, hot ? "rgba(255,214,120,0.85)" : "rgba(255,120,30,0.7)");
        g.addColorStop(0.35, hot ? "rgba(255,140,40,0.5)" : "rgba(210,50,10,0.42)");
        g.addColorStop(1, "rgba(80,10,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        // wrap-around copies so the horizontal scroll tiles seamlessly
        if (cx < r) { ctx.beginPath(); ctx.arc(cx + w, cy, r, 0, Math.PI * 2); ctx.fill(); }
        if (cx > w - r) { ctx.beginPath(); ctx.arc(cx - w, cy, r, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // Rolling smoke silhouettes rising off the glow (dark blotches).
    for (let i = 0; i < 34; i++) {
      const cx = rng() * w, cy = h * (0.2 + rng() * 0.4);
      const rw = 60 + rng() * 140, rh = 30 + rng() * 60;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rw);
      g.addColorStop(0, "rgba(20,10,8,0.55)");
      g.addColorStop(1, "rgba(20,10,8,0)");
      ctx.fillStyle = g;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, rh / rw);
      ctx.beginPath(); ctx.arc(0, 0, rw, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    // Ember sparks
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 140; i++) {
      const cx = rng() * w, cy = h * (0.38 + rng() * 0.35);
      const r = 0.6 + rng() * 1.8;
      ctx.fillStyle = `rgba(255,${160 + Math.floor(rng() * 90)},${40 + Math.floor(rng() * 60)},${0.5 + rng() * 0.4})`;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    // Molten sun blob at the SAME direction as BLACKOUT_SUN_DIR (equirect mapping of
    // three's SphereGeometry: u = (PI - atan2(z, x)) / 2PI, v = 1 - theta/PI), so the
    // WebGPU fallback matches the GLSL dome and the blackout DirectionalLight angle.
    {
      const sunAz = Math.atan2(BLACKOUT_SUN_DIR.z, BLACKOUT_SUN_DIR.x);
      const sunEl = Math.asin(BLACKOUT_SUN_DIR.y);
      const su = ((Math.PI - sunAz) / (Math.PI * 2)) % 1;
      const sv = 1 - (Math.PI / 2 - sunEl) / Math.PI; // v: 0 bottom .. 1 top
      const px = su * w, py = (1 - sv) * h; // canvas row 0 = v 1 (flipY texture)
      const degPx = w / 360; // equirect: same px/deg both axes
      ctx.globalCompositeOperation = "screen";
      let g = ctx.createRadialGradient(px, py, 0, px, py, 26 * degPx);
      g.addColorStop(0, "rgba(200,50,12,0.85)");
      g.addColorStop(1, "rgba(120,20,4,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 26 * degPx, 0, Math.PI * 2); ctx.fill();
      g = ctx.createRadialGradient(px, py, 0, px, py, 10 * degPx);
      g.addColorStop(0, "rgba(255,150,40,0.95)");
      g.addColorStop(0.5, "rgba(255,90,15,0.6)");
      g.addColorStop(1, "rgba(255,70,10,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 10 * degPx, 0, Math.PI * 2); ctx.fill();
      g = ctx.createRadialGradient(px, py, 0, px, py, 3.4 * degPx);
      g.addColorStop(0, "rgba(255,240,190,1)");
      g.addColorStop(0.6, "rgba(255,220,130,0.9)");
      g.addColorStop(1, "rgba(255,170,60,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 3.4 * degPx, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const geo = new THREE.SphereGeometry(455, 40, 20);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
      transparent: true, blending: THREE.AdditiveBlending, opacity: 0,
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.name = "FireSkyDome"; dome.renderOrder = -9; dome.frustumCulled = false;
    dome.visible = false;
    let t = 0;
    dome.onBeforeRender = (_r, _s, cam) => {
      dome.position.setFromMatrixPosition(cam.matrixWorld); // world pos — cam.position is local
      t += 0.01667; // fixed per-render-tick advance — flicker/scroll are visual, not physics
      // No UV scroll any more: the painted sun must stay put at BLACKOUT_SUN_DIR so
      // the directional light keeps pointing at it (flicker below still animates).
      const flicker = 0.72 + Math.sin(t * 2.3) * 0.10 + Math.sin(t * 5.1 + 1.4) * 0.06;
      mat.opacity = Math.max(0, flicker);
    };
    scene.add(dome);
    window.__rbFireSkyDome = dome; // dev diagnostic
  }

  // Cheap distant skyline: one InstancedMesh (1 draw) of simple boxes in a wide ring so
  // the city recedes toward the horizon and fades into fog — infinite-feeling, ~0 cost.
  function buildDistantSkyline() {
    if (scene.getObjectByName("DistantSkyline")) return;
    const count = 60;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xa89a88, roughness: 0.95, metalness: 0.0 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.name = "DistantSkyline"; inst.frustumCulled = false; inst.castShadow = false; inst.receiveShadow = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let seed = 1337; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 0xffffffff); };
    const cx = 0, cz = 40; // world centre
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rnd() * 0.08;
      const rad = 150 + rnd() * 190;
      const w = 12 + rnd() * 26, h = 24 + rnd() * 90, d = 12 + rnd() * 26;
      p.set(cx + Math.cos(ang) * rad, h * 0.5 - 1, cz + Math.sin(ang) * rad);
      s.set(w, h, d);
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  async function buildSkyEnvironment() {
    buildDistantSkyline();
    try {
      // The single source of truth for the sky: a real CC0 equirectangular HDR, falling
      // back to the procedural canvas sky only if the file is missing or the loader fails.
      let equirect = null;
      try {
        equirect = await new RGBELoader().loadAsync(SKY_HDR_PATH);
        equirect.mapping = THREE.EquirectangularReflectionMapping;
      } catch (e) {
        console.warn("[sky] HDR load failed — using procedural sky", e);
      }
      if (!equirect) equirect = makeEquirectSky();

      // Visible skybox: the HDR-textured dome mesh. A mesh renders identically on WebGL
      // and WebGPU, unlike scene.background (an equirect there renders black on WebGPU r166),
      // so this is the one code path for the visible sky on both backends.
      buildSkyDome(equirect);
      scene.background = new THREE.Color(0xd8c2a4); // clear colour behind the dome (matches the HDR horizon)

      if (rendererBackend === "webgpu") {
        // three.js r166 WebGPU (node renderer): do NOT run PMREMGenerator — it relies on a
        // ShaderMaterial the node backend can't compile ("NodeMaterial: ShaderMaterial not
        // compatible"). The node pipeline prefilters the environment internally, so a raw
        // equirect assigned directly to scene.environment IS the supported IBL path (see
        // three r166 examples/webgpu_loader_gltf.html, which sets scene.environment = texture).
        scene.environment = equirect;   // node renderer builds the prefiltered IBL internally
        scene.environmentIntensity = 0.58; // golden-hour IBL — strong enough that materials visibly pick up the sky's warmth
        // Convert any incompatible ShaderMaterials now so compileAsync doesn't trip on them
        // (the normal one-time sanitize otherwise happens later, at the first renderScene).
        sanitizeWebGPUMaterials(scene);
        webgpuMaterialSanitizeNextRender = false;
        if (typeof renderer.compileAsync === "function") {
          await renderer.compileAsync(scene, camera);
        }
        skyEnvActive = true;
        return;
      }

      let env = equirect;
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader?.();
        env = pmrem.fromEquirectangular(equirect).texture;
        pmrem.dispose();
      } catch (e) {
        console.warn("[sky] PMREM prefilter unavailable — using raw equirect for IBL", e);
      }
      scene.environment = env;      // image-based lighting for all PBR materials
      scene.environmentIntensity = 0.58; // golden-hour IBL — strong enough that materials visibly pick up the sky's warmth
      skyEnvActive = true;
    } catch (e) {
      console.warn("[sky] buildSkyEnvironment failed — keeping solid daytime background", e);
      scene.background = new THREE.Color(0xd8c2a4);
      scene.environment = null; // never leave a half-applied env map that would crash render
      skyEnvActive = false;
    }
  }

  const MAX_SHOT_RANGE = Math.hypot(MAP_W * CELL, MAP_H * CELL) + CELL;
  const DRONE_LOD_NEAR = lowEndMode ? 10 : 14;
  const DRONE_LOD_FAR = lowEndMode ? 20 : 28;
  // `let` (not const) so a live dev re-apply can retune them without a reload.
  let THIRD_PERSON_DISTANCE = devVal("camera", "tpDistance", 1.34);
  let THIRD_PERSON_SHOULDER_X = devVal("camera", "tpShoulderX", 0.36);
  let THIRD_PERSON_SHOULDER_Y = devVal("camera", "tpShoulderY", -0.52);
  let THIRD_PERSON_CAMERA_HEIGHT = devVal("camera", "tpCameraHeight", -0.86);
  let THIRD_PERSON_CAMERA_CLEARANCE = devVal("camera", "tpCameraClearance", 0.34);
  const THIRD_PERSON_MODEL_HIDE_RADIUS = 0.72;

  // ── Unified first-person body ─────────────────────────────────────────────
  // When true, first person renders the SAME third-person character model from an
  // eye camera (you see the real body's arms + the in-hand weapon), instead of the
  // floating first-person viewmodel. Set to false to fully restore the legacy
  // floating-viewmodel behavior (the fallback path is bit-identical to before).
  const UNIFIED_FIRST_PERSON = true;
  // First-person view is removed: the game is third-person only. This forces the
  // TP camera always on, disables the FP/TP toggle, keeps ADS in the over-shoulder
  // view, and suppresses the first-person viewmodel/body (also saves the per-frame
  // FP viewmodel work). Set false to restore the switchable FP/TP behavior.
  const THIRD_PERSON_ONLY = true;
  // Scale applied to the head bone to hide it in unified FP (the eye camera sits
  // inside the head). Skinned meshes ignore bone .visible, so we collapse the head
  // bone to a near-zero point instead. Re-applied every frame in applyViewModeVisibility.
  const UNIFIED_FP_HEAD_HIDE_SCALE = 0.0001;
  // Unified-FP arm/weapon aim tuning — how strongly the body's arms track camera
  // pitch so the held gun stays centered when looking up/down. These override the
  // gentler third-person values inside applyThirdPersonArmPose. Tune in playtest.
  // NOTE: these are deliberately CONSERVATIVE. Large world-space arm rotations shred the
  // skinned mesh (the arms exploded into spikes at 0.95/±1.15rad). Keep the arms near
  // their gripping animation pose with only a mild pitch follow.
  // NOTE: these are `let` (not `const`) so the in-game tuning hook (__rbTest.setFpTune)
  // can adjust them live while iterating. Prod behaviour is unchanged — nothing writes
  // them unless the debug hook is called. The baked-in numbers below are the shipped
  // values.
  // Arm-pose follow factors. With the viewmodel gun + collapsed arm bones (the shipped
  // config), the body's arms are hidden, so these are 0. They still apply if you re-enable
  // the in-hand weapon path (UNIFIED_FP_USE_VIEWMODEL=false, UNIFIED_FP_HIDE_ARMS=false);
  // keep them SMALL if so — large world-space arm rotation shreds the skinned mesh.
  let UNIFIED_FP_ARM_RAISE_BIAS   = 0.0; // static lift of arms toward eye-line (blend=1, pitch=0)
  let UNIFIED_FP_UPPER_ARM_PITCH  = 0.0; // upper-arm follow of camera pitch
  let UNIFIED_FP_FOREARM_PITCH    = 0.0; // forearm follow of camera pitch
  let UNIFIED_FP_SPINE_PITCH      = 0.0; // torso lean into aim
  // Eye offset: the FP camera pivot sits on the body's centre-line. Push it FORWARD past
  // the (hidden) head to the eyes and slightly DOWN from the scalp to real eye height, so
  // you look out from the eyes. 0.34 matches the original so the shot origin / wall
  // proximity is unchanged from before this feature.
  let UNIFIED_FP_EYE_FORWARD = 0.34; // metres forward toward the eyes (local -Z)
  let UNIFIED_FP_EYE_UP      = -0.05; // drop from scalp to eye line
  // Dev-tunable additive first-person camera position offset (metres). 0 = default.
  let FP_CAM_OFF_X = devVal("camera", "fpOffsetX", 0);
  let FP_CAM_OFF_Y = devVal("camera", "fpOffsetY", 0);
  let FP_CAM_OFF_Z = devVal("camera", "fpOffsetZ", 0);
  // Unified-FP in-hand weapon fit. The third-person weapon is sized/placed for an
  // over-shoulder cam; from an eye cam it reads huge and too close. These scale it
  // down and nudge it (camera-relative: forward=-Z, up=+Y, right=+X) so it sits low in
  // frame. Only applied while the unified body is the active view (TP untouched).
  // In-hand weapon fit (default path): gun stays in the body's animated grip; these
  // scale it for the eye cam and nudge it (world basis: forward=aim dir, right, up).
  let UNIFIED_FP_GUN_SCALE   = 1.0;   // multiplier on the 0.6 third-person base scale
  let UNIFIED_FP_GUN_FORWARD = 0.0;   // extra push along aim (+) / back (−)
  let UNIFIED_FP_GUN_UP      = 0.0;   // raise (+) / lower (−)
  let UNIFIED_FP_GUN_RIGHT   = 0.0;   // shift right (+) / left (−)
  // Camera-relative viewmodel path (only when UNIFIED_FP_GUN_CAMERA_RELATIVE): offsets
  // are metres from the eye along camera axes; rotation is a camera-relative euler.
  let UNIFIED_FP_GUN_CAMERA_RELATIVE = false;
  let UNIFIED_FP_GUN_ROT_X   = 0.0;
  let UNIFIED_FP_GUN_ROT_Y   = Math.PI * 0.5;
  let UNIFIED_FP_GUN_ROT_Z   = -0.1;
  // When true (shipped), the gun in unified FP is the real floating first-person viewmodel
  // (child of the camera) — the known-good, correctly-posed FP gun — and the in-hand
  // third-person weapon is hidden. The body still renders (torso/legs visible when you
  // look down; shadows; coop). False switches to the in-hand weapon held in the body's
  // animated grip — authentic, but this chunky single-mesh character reads worse up close.
  let UNIFIED_FP_USE_VIEWMODEL = true;
  // Debug-only: force-hide the unified body (for isolating the gun during tuning).
  let UNIFIED_FP_DEBUG_HIDE_BODY = false;
  // Collapse the body's upper-arm bones in unified FP (shipped ON with the viewmodel gun:
  // the body's raised gun-holding arms are redundant and poke into the eye view / shred
  // when viewed from inside). Torso/legs remain, so you still see your body when looking
  // down. Uses the same near-zero bone-scale trick as the head hide.
  let UNIFIED_FP_HIDE_ARMS = true;
  const SIEGE_SMART_THINK_MIN = 0.18;
  const SIEGE_SMART_THINK_MAX = 0.34;
  const SIEGE_SMART_UNSTUCK_SCAN_INTERVAL = 0.24;
  const SIEGE_DRONE_MODEL_YAW = 0;
  // Tuned to match the faster Siege Drone pace while keeping the humanoid gait readable
  const SIEGE_DRONE_WALK_TIME_SCALE = 1.7;
  const SIEGE_DRONE_TARGET_HEIGHT = PLAYER_H * 2.95; // taller, looming — more intimidating

  let modelEditorState = loadModelEditorState();
  const modelEditorRoots = new Set();

  function registerModelEditorRoot(root, modelKey) {
    if (!root || !modelKey) return root;
    root.userData.modelEditorKey = modelKey;
    captureModelEditorBase(root);
    applyModelEditorTransform(root, modelKey, modelEditorState);
    modelEditorRoots.add(root);
    return root;
  }

  function refreshModelEditorRoots(nextState = modelEditorState) {
    modelEditorState = nextState || loadModelEditorState();
    for (const root of modelEditorRoots) {
      applyModelEditorTransform(root, (root as any).userData.modelEditorKey, modelEditorState);
    }
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== MODEL_EDITOR_STORAGE_KEY) return;
    refreshModelEditorRoots(loadModelEditorState());
  });

  // far=480 covers the full interior+exterior AND keeps the 9500-radius sky dome
  // visible (a shorter far plane would clip the dome and blacken the sky).
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, devVal("camera", "near", 0.05), devVal("camera", "far", 480));
  camera.layers.enable(1);
  const yaw = new THREE.Object3D();
  const pitch = new THREE.Object3D();
  yaw.position.set(0, PLAYER_H, 0);
  pitch.add(camera);
  yaw.add(pitch);
  scene.add(yaw);

  const keys = new Set();
  const mouse: any = { locked: false, down: false, aiming: false };
  // Touch input state (mobile). move = analog joystick vector; look is applied
  // directly to yaw/pitch by the touch handlers. sprint is a latch toggle.
  const isTouchDevice = (("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0)
    && /Mobi|Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent);
  const touchInput = { move: { x: 0, y: 0, active: false }, sprint: false, active: isTouchDevice };
  const raycaster = new THREE.Raycaster();
  raycaster.far = MAX_SHOT_RANGE;
  const muzzleWorldTmp = new THREE.Vector3();
  const shotMuzzleRightTmp = new THREE.Vector3();
  const shotMuzzleUpTmp = new THREE.Vector3();
  const cameraLocalTmp = new THREE.Vector3();
  const cameraWorldTmp = new THREE.Vector3();
  const tracerDirTmp = new THREE.Vector3();
  const tracerStartTmp = new THREE.Vector3();
  const tracerEndTmp = new THREE.Vector3();
  const tracerMidTmp = new THREE.Vector3();
  const tracerUp = new THREE.Vector3(0, 1, 0);
  const beamForward = new THREE.Vector3(0, 0, 1);
  const fireAnglesTmp = new THREE.Vector2();
  const pelletSpreadTmp = new THREE.Vector2();
  const shotHitInfoTmp = { part: null };
  const raycastHitsTmp = [];
  const raycastFloorHitsTmp = [];
  const impactNormalTmp = new THREE.Vector3();
  const enemyHitPointTmp = new THREE.Vector3();
  const tracerFallbackEndTmp = new THREE.Vector3();
  const shotEnemyImpactTmp = new THREE.Vector3();
  const shotWallImpactTmp = new THREE.Vector3();
  const shotWallNormalTmp = new THREE.Vector3();
  const bulletHoleNormalTmp = new THREE.Vector3();
  const bulletHoleUp = new THREE.Vector3(0, 0, 1);
  const enemyShotOriginTmp = new THREE.Vector3();
  const enemyShotTargetTmp = new THREE.Vector3();
  const enemyShotDirTmp = new THREE.Vector3();
  const enemyShotEndTmp = new THREE.Vector3();
  const megaBlastOriginTmp = new THREE.Vector3();
  const megaBlastCasterTmp = new THREE.Vector3();
  const megaBlastTargetTmp = new THREE.Vector3();
  const megaBlastEndTmp = new THREE.Vector3();
  const megaBlastMidTmp = new THREE.Vector3();
  const playerHitCenterTmp = new THREE.Vector3();
  const weaponClipDirTmp = new THREE.Vector3();
  const shotEnemyOffsetTmp = new THREE.Vector3();
  const thirdPersonForwardTmp = new THREE.Vector3();
  const thirdPersonRightTmp = new THREE.Vector3();
  const thirdPersonHandTmp = new THREE.Vector3();
  // Unified-FP camera-relative weapon placement temps.
  const fpGunCamPos = new THREE.Vector3();
  const fpGunRight  = new THREE.Vector3();
  const fpGunUp     = new THREE.Vector3();
  const fpGunFwd    = new THREE.Vector3();
  const fpGunCamQuat = new THREE.Quaternion();
  const fpGunLocalQuat = new THREE.Quaternion();
  const fpGunLocalEuler = new THREE.Euler();
  const _aimParentQuat  = new THREE.Quaternion();
  const _aimWorldRight  = new THREE.Vector3();
  const _aimLocalAxis   = new THREE.Vector3();
  const _aimOffsetQuat  = new THREE.Quaternion();
  const _aimOffsetInvQuat = new THREE.Quaternion();
  const thirdPersonCameraSolvedTmp = new THREE.Vector3();
  const thirdPersonCameraWorldTmp = new THREE.Vector3();
  const thirdPersonCameraLocalTmp = new THREE.Vector3();
  // Reload staging: gun-in-left-hand grip anchor + right-hand fresh-clip transit.
  const reloadGripTmp = new THREE.Vector3();
  const reloadWellTmp = new THREE.Vector3();
  const reloadClipStartTmp = new THREE.Vector3();
  const reloadClipScaleTmp = new THREE.Vector3();
  const reloadClipQuatTmp = new THREE.Quaternion();
  const enemyHitCenterTmp = new THREE.Vector3();
  const enemyHealthAnchorTmp = new THREE.Vector3();
  const hitVolumeATmp = new THREE.Vector3();
  const hitVolumeBTmp = new THREE.Vector3();
  const hitVolumeDiffTmp = new THREE.Vector3();
  const hitVolumeRayPointTmp = new THREE.Vector3();
  const hitVolumeSegPointTmp = new THREE.Vector3();
  const teslaNodeWorldTmp = new THREE.Vector3();
  const teslaBranchTmp = new THREE.Vector3();
  const lanceAimTmp = new THREE.Vector3();
  const lanceUpTmp = new THREE.Vector3(0, 1, 0);
  const flashlightMuzzleTmp = new THREE.Vector3();
  const gunFlashMuzzleTmp = new THREE.Vector3();
  const movementForwardTmp = new THREE.Vector3();
  const movementRightTmp = new THREE.Vector3();
  const movementDeltaTmp = new THREE.Vector3();
  const ghostHandRightTmp = new THREE.Vector3();
  const ghostHandLeftTmp = new THREE.Vector3();
  const ghostHandCenterTmp = new THREE.Vector3();
  const ghostLocalTmp = new THREE.Vector3();
  const ghostForwardTmp = new THREE.Vector3();
  const ghostRightTmp = new THREE.Vector3();
  const PLAYER_FOOT_CLEARANCE = 0.08;
  const PROP_WEAPON_CLIP_MIN_Y = 0.42;
  // `let` so live dev re-apply can retune jump feel without a reload.
  let JUMP_VELOCITY = devVal("player", "jumpVelocity", 5.85);
  let JUMP_GRAVITY = devVal("player", "jumpGravity", 13.6);
  let MAX_JUMP_OFFSET = devVal("player", "maxJumpOffset", 1.12);

  // Reassign the jump + third-person camera `let`s from the (live) snapshot.
  function refreshDevCameraConsts() {
    JUMP_VELOCITY = devVal("player", "jumpVelocity", 5.85);
    JUMP_GRAVITY = devVal("player", "jumpGravity", 13.6);
    MAX_JUMP_OFFSET = devVal("player", "maxJumpOffset", 1.12);
    THIRD_PERSON_DISTANCE = devVal("camera", "tpDistance", 1.34);
    THIRD_PERSON_SHOULDER_X = devVal("camera", "tpShoulderX", 0.36);
    THIRD_PERSON_SHOULDER_Y = devVal("camera", "tpShoulderY", -0.52);
    THIRD_PERSON_CAMERA_HEIGHT = devVal("camera", "tpCameraHeight", -0.86);
    THIRD_PERSON_CAMERA_CLEARANCE = devVal("camera", "tpCameraClearance", 0.34);
    FP_CAM_OFF_X = devVal("camera", "fpOffsetX", 0);
    FP_CAM_OFF_Y = devVal("camera", "fpOffsetY", 0);
    FP_CAM_OFF_Z = devVal("camera", "fpOffsetZ", 0);
    // Far plane is set once at camera creation; update it live too. (FOV + near
    // are recomputed every frame from devVal, so they're already live.)
    const far = devVal("camera", "far", 480);
    if (camera && Math.abs(camera.far - far) > 0.001) { camera.far = far; camera.updateProjectionMatrix(); }
  }
  const CLONED_GHOST_TYPE_NAME = "Cloned Ghost";
  const ai = {
    playerPrevX: 0,
    playerPrevZ: 0,
    playerVelX: 0,
    playerVelZ: 0,
    initialized: false,
  };

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pickSprintLocomotionAction(actions, f = 0, s = 0) {
    if (f < -0.1 && actions.runBack) return "runBack";
    if (s < -0.15 && actions.sprintLeft) return "sprintLeft";
    if (s > 0.15 && actions.sprintRight) return "sprintRight";
    return actions.rifleRun ? "rifleRun" : "sprint";
  }

  function dampValue(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-lambda * dt));
  }

  function angleDelta(current, target) {
    let delta = (target - current + Math.PI) % (Math.PI * 2);
    if (delta < 0) delta += Math.PI * 2;
    return delta - Math.PI;
  }

  function yawFromDirection(dx, dz) {
    return Math.atan2(-dx, -dz);
  }

  const wallMeshes = [];
  const enemies = [];
  const pendingEnemyDeaths = [];
  const enemyRemovalQueue = [];
  const particles = [];
  const tracers = [];
  const damageNumbers = [];
  const lightningEffects = [];
  const lightningPool = [];
  let SIEGE_DRONE_MODEL_GLTF = null;
  let SIEGE_DRONE_WALK_FBX = null;
  let ANGEL_DRONE_MATERIALS = null;
  let PLAYER_CHARACTER_FBX = null;
  const PLAYER_CHARACTER_ANIMS: Record<string, any> = {};
  let ZOMBIE_CHARACTER_GLB = null;       // shared base scene; per-enemy clones via SkeletonUtils
  const ZOMBIE_CHARACTER_ANIMS: Record<string, any> = {};     // { idle, walk, run, attack, scream, crawl, runCrawl, dying, death }
  const SHOTGUN_PELLET_PATTERN = [
    [0.0,   0.0  ],
    [0.0,  -0.62 ],
    [0.54, -0.31 ],
    [0.54,  0.31 ],
    [0.0,   0.62 ],
    [-0.54,  0.31 ],
    [-0.54, -0.31 ],
    [1.05,  0.0  ],
    [0.74,  0.74 ],
    [0.0,   1.05 ],
    [-0.74,  0.74 ],
    [-1.05,  0.0  ],
  ];

  const player: any = {
    radius: 0.32,
    hp: 100,
    maxHp: 100,
    unlimitedHealth: false,
    unlimitedSprint: true,
    unlimitedAmmo: false,
    speed: 5.8,
    sprintSpeed: 9.2,
    stamina: 100,
    maxStamina: 100,
    staminaDrain: 36,
    staminaRegen: 22,
    sprintExhausted: false,
    auraTimer: 0,
    auraDamageTick: 0,
    effectSpeedMul: 1,
    jumpOffset: 0,
    jumpVel: 0,
    grounded: true,
    jumpCooldown: 0,
    hurtTimer: 0,
    preDeathThirdPerson: null,
    killStreak: 0,
    streakTimer: 0,
    meleeCooldown: 0,
    meleeTimer: 0,
    pvpDead: false,
    respawnTimer: 0,
    totalKills: 0,
    shotsFired: 0,
    shotsHit: 0,
    xp: 0,
    // Statue perk-machine buffs (see loadWorldLandmarks/tryBuyPerk) — permanent for the run,
    // reset in resetPlayer.
    perkDamageMul: 1,
    perkDamageResist: 0,
    perkTier: 0,
    // Weapon progression: the run starts with ONLY the pistol; every other gun is
    // acquired from the exterior mystery box (see finishMysteryBoxRoll). Weapon
    // switching (digit keys / touch) is gated on this set. Per-player-local in coop.
    // Populated right after `currentGun` is chosen (default pistol).
    ownedWeapons: new Set(),
  };
  // ── Developer Engine: player overrides (idempotent, resets from base) ───────
  const PLAYER_TUNABLES = ["radius", "hp", "maxHp", "speed", "sprintSpeed",
    "maxStamina", "staminaDrain", "staminaRegen"];
  const PLAYER_BASE: Record<string, any> = {}; for (const k of PLAYER_TUNABLES) PLAYER_BASE[k] = player[k];
  const PLAYER_FLAG_BASE = {
    unlimitedHealth: player.unlimitedHealth,
    unlimitedSprint: player.unlimitedSprint,
    unlimitedAmmo: player.unlimitedAmmo,
  };
  function applyDevPlayer() {
    // Reset numeric tunables + flags from the built-in base, then layer overrides.
    for (const k of PLAYER_TUNABLES) player[k] = PLAYER_BASE[k];
    player.unlimitedHealth = PLAYER_FLAG_BASE.unlimitedHealth;
    player.unlimitedSprint = PLAYER_FLAG_BASE.unlimitedSprint;
    player.unlimitedAmmo = PLAYER_FLAG_BASE.unlimitedAmmo;
    if (devHas("player")) {
      const p = DEV.player;
      for (const k of PLAYER_TUNABLES) if (Number.isFinite(p[k])) player[k] = p[k];
      if (typeof p.unlimitedHealth === "boolean") player.unlimitedHealth = p.unlimitedHealth;
      if (typeof p.unlimitedSprint === "boolean") player.unlimitedSprint = p.unlimitedSprint;
      if (typeof p.unlimitedAmmo === "boolean") player.unlimitedAmmo = p.unlimitedAmmo;
    }
    // Debug god-mode forces invulnerability + infinite ammo regardless of preset.
    if (devHas("debug") && DEV.debug.godMode) { player.unlimitedHealth = true; player.unlimitedAmmo = true; }
    // Keep hp within the (possibly new) max; top stamina up to the new max.
    player.hp = Math.min(player.hp, player.maxHp);
    player.stamina = player.maxStamina;
  }
  applyDevPlayer();
  const PVP_RESPAWN_SECONDS = 5;
  const COOP_RESPAWN_SECONDS = 10;

  const thirdPerson: any = {
    enabled: true, // FP removed — third-person only from the first frame
    ready: false,
    root: null,
    model: null,
    mixer: null,
    actions: {},
    activeAction: null,
    activeActionName: "",
    rightHand: null,
    leftHand: null,
    headBone: null,        // head bone, hidden in unified first-person
    headBaseScale: null,   // original head scale, restored when head shown
    weapon: null,
    fireTimer: 0,
    reloadTimer: 0,
    recoilBack: 0,
    recoilBackVel: 0,
    recoilPitch: 0,
    recoilPitchVel: 0,
    recoilYaw: 0,
    recoilYawVel: 0,
    recoilRoll: 0,
    recoilRollVel: 0,
    adsSwapProgress: 0,
    viewBlend: 0,
    switchPulse: 0,
    lastMove: { f: 0, s: 0, sprinting: false, jumping: false },
    aimBones: null,       // { rightUpperArm, leftUpperArm, rightForeArm, leftForeArm, spine }
    aimBlend: 0,          // 0 = animation-controlled carry, 1 = camera-tracked raised pose
    aimOffsets: [],       // procedural quaternions applied last frame, removed before mixer writes
    firePunch: 0,         // spring displacement for upward arm kick on fire
    firePunchVel: 0,
    equip: 0,             // 1 → 0 across the equip lower/raise on weapon switch
    equipTime: 0.3,       // duration of the current equip (per-gun spec.equipTime)
    gunLag: 0,            // rotational muzzle-lag spring (heavy guns trail turns)
    gunLagVel: 0,
    prevYawAngle: null,   // last-frame yaw, for the muzzle-lag spring input
  };

  // Starting loadout is the PISTOL — better guns come from the exterior mystery box.
  let currentGun: GunType = (devHas("player") && Object.values(GUNS).includes(DEV.player.startingWeapon))
    ? DEV.player.startingWeapon
    : GUNS.PISTOL;
  let gunState = createGunState(currentGun);
  const allGuns: Record<string, any> = {};
  const MAX_PACK_LEVEL = 7;
  const gunUpgradeLevels: Record<string, any> = {};
  for (const gunType of Object.values(GUNS)) {
    allGuns[gunType] = gunType === currentGun ? gunState : createGunState(gunType);
    gunUpgradeLevels[gunType] = 0;
  }
  // Weapon progression helpers. The owned set starts as the starter gun only;
  // the mystery box adds more over the run. resetPlayer() re-seeds it to the
  // starter so each run is a fresh progression.
  const STARTER_GUN = GUNS.PISTOL;
  function ownsWeapon(gunType) { return player.ownedWeapons.has(gunType); }
  function grantWeapon(gunType) { if (GUN_SPECS[gunType]) player.ownedWeapons.add(gunType); }
  function resetOwnedWeapons() {
    player.ownedWeapons.clear();
    grantWeapon(STARTER_GUN);
    // If a dev override forces a different starting weapon, keep it playable.
    if (currentGun && currentGun !== STARTER_GUN) grantWeapon(currentGun);
  }
  resetOwnedWeapons();
  const packState: any = {
    station: null,
    prompt: "",
    active: false,
  };
  // ── Exterior interactables (statue perk machine, car alarms) ────────────────
  // Both follow the Pack-a-Punch pattern: a state object, an updateX(dt) each
  // frame that computes range + prompt text, and tryX() gated on state.active.
  // The perk machine IS the plaza's landmark statue (modules/landmarks.js,
  // 0,175) — loadWorldLandmarks anchors perkMachineState.station to it.
  const PERK_DEFS = [
    { id: "overcharge", name: "OVERCHARGE",  cost: 350, desc: "+30% WEAPON DAMAGE", initial: "O", color: "#ffb020" },
    { id: "vitality",   name: "VITALITY",    cost: 550, desc: "+50 MAX HEALTH",     initial: "V", color: "#5eff8a" },
    { id: "aegis",      name: "AEGIS",       cost: 850, desc: "-25% DAMAGE TAKEN",  initial: "A", color: "#22d3ee" },
  ];
  const perkMachineState: any = { station: null, active: false, prompt: "", pulseMats: null };
  // Mystery box (CoD-zombies style): glowing chest in the exterior at (10, 140) —
  // where the old wall-buy crates were. KeyE via tryInteract, costs XP; a random
  // weapon rises from the box over ~3 s (emissive/additive shimmer only — NO real
  // lights), then the player receives it. ~10% teddy-bear dud refunds half.
  const MYSTERY_BOX_COST = 475;
  const MYSTERY_BOX_TEDDY_CHANCE = 0.10;
  const MYSTERY_BOX_RISE_SECONDS = 3.0;
  const MYSTERY_BOX_HOLD_SECONDS = 0.7;
  const mysteryBoxState: any = {
    station: null, lid: null, active: false, prompt: "",
    rolling: false, rollT: 0, resultGun: null, teddy: false, visualOnly: false,
    displayRig: null, displayCache: new Map(), teddyMesh: null,
    shimmer: null, glowMats: [], lidAngle: 0, lidVel: 0,
    beam: null, motes: [], qMark: null, flashPulse: 0,
  };
  // Car alarms: KeyE near a parked car sets it screaming for CAR_ALARM_DURATION s.
  // While it screams every enemy brain steers toward the global soundLure instead
  // of the player. Cars register themselves via window.__extCarAlarms (exterior_map.js).
  const CAR_ALARM_DURATION = 10;
  const CAR_ALARM_COOLDOWN = 30;
  const carAlarmState = { nearCar: null, active: false, prompt: "", ringing: null, ringUntil: 0 };
  const soundLure = { x: 0, z: 0, until: 0 }; // performance.now()/1000 timestamp
  const firstPersonWeaponCache = new Map();
  const thirdPersonWeaponCache = new Map();
  const loadoutPreviews = [];

  // True once bootGame has finished building the world, priming the enemy pools and
  // warming the shaders. The menu can appear before this (its reveal has a watchdog
  // timer), and starting a mission early runs the first wave while the world is still
  // being constructed and every shader is still linking — which reads as a freeze.
  let bootComplete = false;

  const game: any = {
    state: "menu",
    wave: 1,
    killed: 0,
    totalEnemies: 0,
    hitMarkerTimer: 0,
    lastTime: performance.now(),
    frame: 0,
    startTime: 0,
    elapsedTime: 0,
    waveSpawning: false,
    transitioning: false,
    score: 0,
    bestScore: Number(loadSettings()?.bestScore) || 0,
    multiKillCount: 0,
    multiKillTimer: 0,
    waveStartTime: 0,
  };

  const savedSettings = loadSettings();
  const validLoadouts = new Set(Object.values(GUNS));
  // Progression: the loadout is always the starter pistol — every other gun is
  // acquired in-run from the mystery box, so it can no longer be picked here.
  let selectedLoadout = STARTER_GUN;
  // 80s retro dream camera aesthetic:
  // - Lifted blacks (faded, washed-out like old VHS tape)
  // - Warm peach/magenta colour cast
  // - Extreme halation/bloom bleeding from bright sources (soft focus halo)
  // - VHS scanlines (alternating dim rows)
  // - Heavy analogue noise (coarser, chunkier than film grain)
  // - Oval vignette with warm brown edges (lens curvature effect)
  // - Slight horizontal wobble (tape wow/flutter)
  const CinematicGradeShader = {
    uniforms: {
      tDiffuse: { value: null },
      time: { value: 0 },
      resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      intensity: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float time;
      uniform vec2 resolution;
      uniform float intensity;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      // Horizontal halation bloom — a single wide 5-tap box blur. The unequal tap
      // spacing (1×, 2.5×) covers both a tight core glow and a wide soft spread in
      // one pass, so we get the same dreamy anamorphic halo for half the texture
      // fetches the old two-pass version used.
      vec3 bloomX(sampler2D tex, vec2 uv, float radius) {
        vec2 px = vec2(radius / resolution.x, 0.0);
        vec3 s = texture2D(tex, uv - px * 2.5).rgb * 0.12
               + texture2D(tex, uv - px       ).rgb * 0.24
               + texture2D(tex, uv             ).rgb * 0.28
               + texture2D(tex, uv + px        ).rgb * 0.24
               + texture2D(tex, uv + px * 2.5  ).rgb * 0.12;
        return s;
      }

      void main() {
        // VHS tape wow/flutter: slight per-scanline horizontal jitter
        float scanRow = floor(vUv.y * resolution.y);
        float tapeWobble = (hash(vec2(scanRow, floor(time * 8.0))) - 0.5) * 0.0012
                         + (hash(vec2(scanRow * 0.3, floor(time * 2.0))) - 0.5) * 0.0006;
        vec2 uv = vec2(vUv.x + tapeWobble, vUv.y);
        uv = clamp(uv, 0.001, 0.999);

        vec3 color = texture2D(tDiffuse, uv).rgb;
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));

        // --- Large-radius halation bloom (80s camera soft focus) ---
        // Single wide blur; only bright pixels feed the halo.
        vec3 bloom = bloomX(tDiffuse, uv, 9.0);
        float bloomMask = smoothstep(0.30, 0.90, luma);
        // Warm the bloom: push reds and strip blues (vintage tube camera look)
        vec3 warmBloom = bloom * bloomMask;
        warmBloom = vec3(warmBloom.r * 1.4, warmBloom.g * 0.95, warmBloom.b * 0.55);
        color += warmBloom * 0.80 * intensity;

        // --- Lift blacks: faded tape with milky shadow floor ---
        // Adds a +0.08 floor so blacks never crush to pure zero (VHS head-clog look)
        color = color * 0.88 + 0.07;

        // --- Colour grade: warm peachy-magenta cast of 80s consumer cameras ---
        float luma2 = dot(color, vec3(0.2126, 0.7152, 0.0722));
        // Partial desaturation — VHS chroma bandwidth was limited
        color = mix(vec3(luma2), color, 0.72);
        // Shadow: warm amber, not teal
        float shadow    = 1.0 - smoothstep(0.07, 0.50, luma2);
        float highlight = smoothstep(0.50, 1.00, luma2);
        float midtone   = max(0.0, 1.0 - shadow - highlight);
        color += shadow    * vec3(0.032, 0.014, -0.008);  // amber-brown shadows
        color += highlight * vec3(0.055, 0.022, -0.038);  // warm peachy highlights
        color += midtone   * vec3(0.024, 0.008, -0.014);  // peachy mids

        // --- Scanlines: alternating rows dim by ~12% ---
        float scanline = mod(scanRow, 2.0) < 1.0 ? 0.89 : 1.0;
        color *= mix(1.0, scanline, 0.55 * intensity);

        // --- Analogue noise: chunky VHS noise, coarser than film grain ---
        float noiseT = floor(time * 18.0); // quantise time → chunky noise blocks
        float noise1 = hash(vec2(floor(uv.x * resolution.x / 2.0), floor(uv.y * resolution.y / 2.0)) + noiseT) - 0.5;
        float noise2 = hash(vec2(floor(uv.x * resolution.x / 4.0), floor(uv.y * resolution.y / 4.0)) + noiseT * 0.3) - 0.5;
        color += (noise1 * 0.65 + noise2 * 0.35) * 0.085 * intensity;

        // --- Oval vignette with warm brown tint at edges ---
        vec2 cUv = vUv - 0.5;
        cUv.x *= resolution.x / max(1.0, resolution.y);
        float vigDist = dot(cUv * vec2(1.0, 0.78), cUv * vec2(1.0, 0.78)); // oval
        float vignette = 1.0 - smoothstep(0.10, 0.82, vigDist);
        // At edge, tint brown (VHS lens curvature absorbs blues)
        float edgeTint = 1.0 - vignette;
        color = mix(color * vignette, color * vec3(0.82, 0.72, 0.55) * vignette, edgeTint * 0.55 * intensity);

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `,
  };
  const ChromaticAberrationShader = {
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      offset: { value: 0.0025 },
      intensity: { value: 0.72 },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float offset;
      uniform float intensity;
      varying vec2 vUv;

      void main() {
        vec2 uv = vUv;
        vec2 center = vec2(0.5, 0.5);
        vec2 dir = uv - center;
        dir.x *= resolution.x / max(1.0, resolution.y);
        float dist = length(dir);
        vec2 n = dist > 0.0 ? dir / dist : vec2(0.0);
        float o = offset * (0.5 + dist) * intensity;
        vec2 offR = n * o;
        vec2 offB = -n * o * 0.6;

        vec4 colR = texture2D(tDiffuse, uv + offR);
        vec4 colG = texture2D(tDiffuse, uv);
        vec4 colB = texture2D(tDiffuse, uv + offB);

        vec3 aberr = vec3(colR.r, colG.g, colB.b);
        vec3 orig = texture2D(tDiffuse, uv).rgb;
        vec3 outCol = mix(orig, aberr, intensity);

        gl_FragColor = vec4(outCol, 1.0);
      }
    `,
  };
  const cinematicState: any = {
    // Default OFF for performance: the cinematic grade runs 3–4 full-screen shader
    // passes (RenderPass + grade + chroma + output) every frame — a big fill cost
    // on weaker GPUs. Now opt-in: only on if the player explicitly enabled it
    // (the pause-menu toggle persists savedSettings.cinematic = true).
    enabled: savedSettings?.cinematic === true,
  };
  const cinematicControls = {
    toggles: Array.from(document.querySelectorAll("#cinematic-toggle")),
    values: Array.from(document.querySelectorAll("#cinematic-val")),
  };
  const cinematicOverlay = document.createElement("div");
  cinematicOverlay.id = "cinematic-overlay";
  cinematicOverlay.setAttribute("aria-hidden", "true");
  Object.assign(cinematicOverlay.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "1",
    opacity: "0",
    transition: "opacity 520ms ease",
    background: [
      // Dreamy bloom wash — warm cream glow blooming from the centre (fake soft-focus halation)
      "radial-gradient(ellipse 75% 65% at 50% 42%, rgba(255,238,205,0.12), rgba(255,224,188,0.045) 38%, rgba(255,224,188,0) 66%)",
      // Warm amber vignette — 80s tube-camera lens falloff (brown edges, not black)
      "radial-gradient(ellipse 116% 96% at 50% 50%, rgba(0,0,0,0) 30%, rgba(44,22,10,0.34) 66%, rgba(18,8,3,0.78) 100%)",
      // Pastel dream cast — peach top fading to a faint magenta/violet base
      "linear-gradient(176deg, rgba(255,176,138,0.07), rgba(0,0,0,0) 45%, rgba(150,110,180,0.06))",
      // VHS scan-lines — a touch heavier than before for analogue texture
      "repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0 1px, rgba(255,255,255,0.012) 1px 3px)",
    ].join(", "),
    mixBlendMode: "normal",
  });
  canvas.insertAdjacentElement("afterend", cinematicOverlay);

  // ── Signature colour grade (always on, NOT player-adjustable) ───────────────
  // The game's default look: a permanent subtle vignette + a faint cool-top /
  // warm-bottom cast layered over the canvas. Deliberately NOT tied to the
  // cinematic toggle or any setting — this is the game's fixed visual identity.
  // The matching canvas filter half of the grade lives in applyCinematicSettings.
  const gradeOverlay = document.createElement("div");
  gradeOverlay.id = "grade-overlay";
  gradeOverlay.setAttribute("aria-hidden", "true");
  Object.assign(gradeOverlay.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "1",
    background: [
      // Soft neutral vignette — focuses the eye, kills the washed-out edges
      "radial-gradient(ellipse 120% 100% at 50% 46%, rgba(0,0,0,0) 50%, rgba(6,10,16,0.14) 76%, rgba(3,6,10,0.30) 100%)",
      // Cool steel cast from the sky, faint warm lift near the ground line
      "linear-gradient(178deg, rgba(120,170,215,0.055), rgba(0,0,0,0) 42% 62%, rgba(224,176,120,0.045))",
    ].join(", "),
    mixBlendMode: "normal",
  });
  canvas.insertAdjacentElement("afterend", gradeOverlay);
  if (rendererBackend === "webgpu") console.info("Gameplay renderer: WebGPU active; cinematic toggle uses WebGPU-safe canvas grading and overlay effects.");

  const commandPrompt = {
    open: false,
    previousState: "playing",
    root: null,
    history: null,
    input: null,
  };

  const commandPromptRoot = document.createElement("div");
  commandPromptRoot.id = "command-prompt";
  commandPromptRoot.setAttribute("aria-hidden", "true");
  Object.assign(commandPromptRoot.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: "24px",
    zIndex: "65",
    pointerEvents: "none",
    background: "linear-gradient(to top, rgba(0,0,0,0.52), rgba(0,0,0,0))",
  });

  const commandPromptPanel = document.createElement("div");
  Object.assign(commandPromptPanel.style, {
    width: "min(860px, 100%)",
    border: "1px solid rgba(124, 220, 255, 0.28)",
    borderRadius: "14px",
    background: "rgba(5, 9, 16, 0.92)",
    boxShadow: "0 22px 60px rgba(0, 0, 0, 0.42)",
    backdropFilter: "blur(14px)",
    pointerEvents: "auto",
    overflow: "hidden",
  });

  const commandPromptHistory = document.createElement("div");
  Object.assign(commandPromptHistory.style, {
    maxHeight: "170px",
    overflowY: "auto",
    padding: "14px 16px 8px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "12px",
    lineHeight: "1.45",
    color: "rgba(227, 248, 255, 0.86)",
    letterSpacing: "0.02em",
    whiteSpace: "pre-wrap",
  });

  const commandPromptRow = document.createElement("div");
  Object.assign(commandPromptRow.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "0 16px 16px",
    borderTop: "1px solid rgba(124, 220, 255, 0.14)",
  });

  const commandPromptLabel = document.createElement("span");
  commandPromptLabel.textContent = ">";
  Object.assign(commandPromptLabel.style, {
    color: "#7df6ff",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "13px",
    opacity: "0.95",
    flex: "0 0 auto",
  });

  const commandPromptInput = document.createElement("input");
  commandPromptInput.type = "text";
  commandPromptInput.autocomplete = "off";
  commandPromptInput.spellcheck = false;
  commandPromptInput.setAttribute("aria-label", "In-game command prompt");
  Object.assign(commandPromptInput.style, {
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#f4ffff",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "14px",
    letterSpacing: "0.02em",
  });

  commandPromptRow.append(commandPromptLabel, commandPromptInput);
  commandPromptPanel.append(commandPromptHistory, commandPromptRow);
  commandPromptRoot.appendChild(commandPromptPanel);
  document.body.appendChild(commandPromptRoot);
  commandPrompt.root = commandPromptRoot;
  commandPrompt.history = commandPromptHistory;
  commandPrompt.input = commandPromptInput;

  function writeCommandPromptLine(text, kind = "system") {
    if (!commandPrompt.history) return;
    const line = document.createElement("div");
    line.textContent = text;
    line.style.color = kind === "error" ? "#ff9da3" : kind === "success" ? "#9ef5c2" : "rgba(227, 248, 255, 0.86)";
    commandPrompt.history.appendChild(line);
    while (commandPrompt.history.children.length > 10) {
      commandPrompt.history.removeChild(commandPrompt.history.firstChild);
    }
    commandPrompt.history.scrollTop = commandPrompt.history.scrollHeight;
  }

  function setCommandPromptVisible(visible) {
    if (!commandPrompt.root) return;
    commandPrompt.open = visible;
    commandPrompt.root.style.display = visible ? "flex" : "none";
    commandPrompt.root.setAttribute("aria-hidden", visible ? "false" : "true");
    if (visible) {
      commandPrompt.input?.focus();
      commandPrompt.input?.select();
    } else {
      commandPrompt.input?.blur();
    }
  }

  function closeCommandPrompt(restoreGame = true) {
    if (!commandPrompt.open) return;
    setCommandPromptVisible(false);
    if (restoreGame && commandPrompt.previousState === "playing") {
      game.state = "playing";
      syncGameplayBodyClass();
      requestCanvasPointerLock();
    }
  }

  function openCommandPrompt() {
    if (commandPrompt.open || game.state !== "playing") return;
    commandPrompt.previousState = game.state;
    mouse.down = false;
    mouse.aiming = false;
    game.state = "paused";
    syncGameplayBodyClass();
    document.exitPointerLock?.();
    overlay?.classList.add("hidden");
    setOverlayMode("pause");
    setCommandPromptVisible(true);
    if (!commandPrompt.history?.childElementCount) {
      writeCommandPromptLine("COMMAND PROMPT READY");
      writeCommandPromptLine("wave 10  — jump to a wave (also: wave:10, wave:[10])");
    }
  }

  function parseWaveCommand(rawValue) {
    // Forgiving syntax: "wave 10", "wave10", "wave:10", "wave:[10]" all work.
    const match = rawValue.trim().match(/^wave\s*:?\s*\[?\s*(\d+)\s*\]?$/i);
    if (!match) return null;
    const waveNumber = Number.parseInt(match[1], 10);
    return Number.isFinite(waveNumber) && waveNumber >= 1 ? waveNumber : null;
  }

  async function jumpToWave(waveNumber) {
    const targetWave = Math.max(1, Math.floor(waveNumber));
    closeCommandPrompt(false);
    game.state = "playing";
    game.wave = Math.max(0, targetWave - 1);
    game.waveSpawning = false;
    game.transitioning = false;
    requestCanvasPointerLock();
    await nextWave();
  }

  async function submitCommandPrompt() {
    const raw = commandPrompt.input?.value || "";
    const trimmed = raw.trim();
    if (!trimmed) {
      writeCommandPromptLine("Enter a command like: wave 10", "error");
      return;
    }

    writeCommandPromptLine(`> ${trimmed}`, "system");
    const waveNumber = parseWaveCommand(trimmed);
    if (waveNumber !== null) {
      writeCommandPromptLine(`Jumping to wave ${waveNumber}...`, "success");
      commandPrompt.input.value = "";
      await jumpToWave(waveNumber);
      return;
    }

    writeCommandPromptLine(`Unknown command: ${trimmed}`, "error");
    commandPrompt.input.select();
  }

  commandPromptInput.addEventListener("keydown", async e => {
    if (e.code === "Enter") {
      e.preventDefault();
      if (commandPromptInput.dataset.busy === "1") return;
      commandPromptInput.dataset.busy = "1";
      try {
        await submitCommandPrompt();
      } finally {
        commandPromptInput.dataset.busy = "0";
      }
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      closeCommandPrompt(true);
    }
  });

  let lookSens = { x: 0.0022, y: 0.0020 };
  let lookSensMul = 1.0;
  if (typeof savedSettings?.sensitivity === "number") {
    lookSensMul = Math.max(0.3, Math.min(3.0, savedSettings.sensitivity));
  }

  lookSens.x = lookSensMul * 0.0022;
  lookSens.y = lookSensMul * 0.0020;

  if (hud.sensSlider) hud.sensSlider.value = lookSensMul.toFixed(1);
  if (hud.sensVal) hud.sensVal.textContent = lookSensMul.toFixed(1) + "x";

  if (hud.sensSlider) {
    hud.sensSlider.addEventListener("input", () => {
      const v = parseFloat(hud.sensSlider.value);
      lookSensMul = v;
      lookSens.x = v * 0.0022;
      lookSens.y = v * 0.0020;
      if (hud.sensVal) hud.sensVal.textContent = v.toFixed(1) + "x";
      saveSettings({ sensitivity: v });
    });
  }

  // Optional dev-console Performance caps (0 = use the device default).
  const devPixelRatioCap = devVal("quality", "pixelRatioCap", 0);
  const devRenderScaleCap = devVal("quality", "renderScaleCap", 0);
  let basePixelRatio = Math.min(
    window.devicePixelRatio || 1,
    devPixelRatioCap > 0 ? devPixelRatioCap : deviceProfile.maxDpr
  );
  const quality = {
    scale: devRenderScaleCap > 0 ? Math.min(deviceProfile.startScale, devRenderScaleCap) : deviceProfile.startScale,
    minScale: deviceProfile.minScale,
    maxScale: devRenderScaleCap > 0 ? Math.min(deviceProfile.maxScale, devRenderScaleCap) : deviceProfile.maxScale,
    sampleTimer: 0,
    smoothDt: 1 / 60,
    lastFps: 60,
    hitchCooldown: 0,
    hitchCount: 0,
    jsUpdateMs: 0,  // EMA of CPU update time/frame
    jsFrameMs: 0,   // EMA of CPU update + render-issue time/frame (excludes GPU)
  };

  // EffectComposer is WebGL-only in this renderer stack; WebGPU runs the main scene directly.
  let composer = null;
  let cinematicPass = null;
  let chromaPass = null;
  let darkWaveActive = false;
  function ensureCinematicComposer() {
    if (rendererBackend !== "webgl" || composer || !cinematicState.enabled) return;
    try {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      cinematicPass = new ShaderPass(CinematicGradeShader);
      chromaPass = new ShaderPass(ChromaticAberrationShader);
      const outputPass = new OutputPass();
      composer.addPass(renderPass);
      composer.addPass(cinematicPass);
      composer.addPass(chromaPass);
      composer.addPass(outputPass);
      composer.setPixelRatio(basePixelRatio * quality.scale);
      composer.setSize(window.innerWidth, window.innerHeight);
      cinematicPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
      if (chromaPass && chromaPass.uniforms && chromaPass.uniforms.resolution) chromaPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    } catch (e) {
      console.warn('Failed to initialize cinematic postprocessing composer:', e);
      composer = null;
      cinematicPass = null;
      chromaPass = null;
      cinematicState.enabled = false;
    }
  }
  ensureCinematicComposer();

  function applyCinematicSettings() {
    if (cinematicState.enabled) ensureCinematicComposer();
    if (cinematicPass) {
      cinematicPass.enabled = cinematicState.enabled;
      cinematicPass.uniforms.intensity.value = cinematicState.enabled ? 1 : 0;
      cinematicPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    }
    if (chromaPass) {
      chromaPass.enabled = cinematicState.enabled;
      chromaPass.uniforms.intensity.value = cinematicState.enabled ? 0.95 : 0.0;
      if (chromaPass.uniforms.offset) chromaPass.uniforms.offset.value = cinematicState.enabled ? 0.0078 : 0.0025;
      chromaPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    }
    renderer.toneMappingExposure = getBaseExposure();
    // WebGPU path (no cinematicPass): faded, warm, dreamy 80s-VHS grade via cheap
    // GPU-composited CSS filter — lifted blacks (low contrast), reduced chroma,
    // warm sepia cast and a gentle brightness lift for the soft-focus dream feel.
    canvas.style.filter = cinematicState.enabled
      // Cinematic = dark, moody, desaturated with a cool cast (much darker than default).
      ? (cinematicPass ? "contrast(1.3) saturate(0.66) brightness(0.66)" : "contrast(1.34) saturate(0.58) brightness(0.58) hue-rotate(6deg)")
      // Signature default grade (always on, not player-adjustable): deepened blacks,
      // tamed highlights, restrained saturation with a teal-orange lean — replaces the
      // old washed-out bright look. Pairs with the #grade-overlay vignette above.
      : "contrast(1.35) saturate(1.35) brightness(0.85) sepia(0.19) hue-rotate(-19deg)";
    cinematicOverlay.style.opacity = cinematicState.enabled ? "1" : "0";
    for (const toggle of cinematicControls.toggles) toggle.checked = cinematicState.enabled;
    for (const value of cinematicControls.values) value.textContent = cinematicState.enabled ? "ON" : "OFF";
  }

  function getBaseExposure() {
    if (darkWaveActive) return baseToneMappingExposure * 1.48;
    return cinematicState.enabled ? baseToneMappingExposure * 1.55 : baseToneMappingExposure;
  }

  function renderScene() {
    if (rendererBackend === "webgpu" && webgpuMaterialSanitizeNextRender) {
      sanitizeWebGPUMaterials(scene);
      webgpuMaterialSanitizeNextRender = false;
    }
    if (cinematicState.enabled) ensureCinematicComposer();
    if (cinematicPass) {
      cinematicPass.enabled = cinematicState.enabled;
      cinematicPass.uniforms.time.value = performance.now() * 0.001;
    }
    if (chromaPass) {
      chromaPass.enabled = cinematicState.enabled;
    }
    if (cinematicState.enabled && composer && rendererBackend !== "webgpu") composer.render();
    else renderer.render(scene, camera);
  }

  function applyRenderScale() {
    const renderPixelRatio = basePixelRatio * quality.scale;
    renderer.setPixelRatio(renderPixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (composer) {
      const composerPixelRatio = lowEndMode && cinematicState.enabled ? Math.max(0.5, renderPixelRatio * 0.88) : renderPixelRatio;
      composer.setPixelRatio(composerPixelRatio);
      composer.setSize(window.innerWidth, window.innerHeight);
    }
    if (cinematicPass) cinematicPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    if (chromaPass && chromaPass.uniforms && chromaPass.uniforms.resolution) chromaPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
  }

  applyCinematicSettings();
  applyRenderScale();

  function setCinematicEnabled(enabled, options: any = {}) {
    cinematicState.enabled = !!enabled;
    applyCinematicSettings();
    if (options.persist) saveSettings({ cinematic: cinematicState.enabled });
  }

  function forceCinematicOffForPvp() {
    setCinematicEnabled(false, { persist: false });
    for (const toggle of cinematicControls.toggles) {
      toggle.disabled = true;
      toggle.title = "Cinematic mode is forced off during PvP FFA";
    }
  }

  function syncCinematicControlLock() {
    const locked = !!(net?.active && gameMode === "pvp" && game.state !== "menu");
    if (locked) {
      forceCinematicOffForPvp();
      return;
    }
    for (const toggle of cinematicControls.toggles) {
      toggle.disabled = false;
      toggle.title = "Cinematic";
    }
    applyCinematicSettings();
  }

  for (const toggle of cinematicControls.toggles) {
    toggle.addEventListener("change", () => {
      if (net?.active && gameMode === "pvp" && game.state !== "menu") {
        forceCinematicOffForPvp();
        return;
      }
      setCinematicEnabled(toggle.checked, { persist: true });
    });
  }

  function updateAdaptiveQuality(dt) {
    quality.smoothDt += (dt - quality.smoothDt) * 0.08;
    quality.sampleTimer += dt;
    quality.hitchCooldown = Math.max(0, quality.hitchCooldown - dt);
    // On mobile every scale change triggers a renderer.setSize → framebuffer
    // realloc, which itself causes a visible hitch. Sample far less often there
    // so we don't "fix" stutter by stuttering, and only react to sustained drops.
    const sampleWindow = mobileMode ? 2.4 : lowEndMode ? 0.65 : 1.0;
    if (quality.sampleTimer < sampleWindow) return;

    quality.lastFps = 1 / Math.max(0.001, quality.smoothDt);
    quality.sampleTimer = 0;
    maybeAutoFallbackRenderer();
    maybePerfGovernor();

    let nextScale = quality.scale;
    if (mobileMode) {
      // Wide dead-band + gentle, infrequent steps → at most one realloc every
      // few seconds, and none at all while FPS sits in a comfortable band.
      if (quality.lastFps < 30) nextScale -= 0.12;
      else if (quality.lastFps < 45) nextScale -= 0.06;
      else if (quality.lastFps > 58) nextScale += 0.05;
    } else {
      const heavyFramePenalty = rendererBackend === "webgpu" ? 0.12 : 0.14;
      if (quality.lastFps < 42) nextScale -= lowEndMode ? heavyFramePenalty * 1.15 : heavyFramePenalty;
      else if (quality.lastFps < 48) nextScale -= lowEndMode ? 0.1 : 0.08;
      else if (quality.lastFps < 55) nextScale -= lowEndMode ? 0.05 : 0.035;
      // Recover below the 60Hz vsync cap. requestAnimationFrame cannot report more than
      // ~60fps, so the old `> 61` test never fired: render scale only ever ratcheted
      // down, and one transient hitch left the game permanently blurry. The 55..57 gap
      // is the dead band that keeps this from oscillating.
      else if (quality.lastFps > 57 && !lowEndMode) nextScale += 0.03;
      else if (quality.lastFps > 57 && lowEndMode) nextScale += 0.012;
    }

    nextScale = Math.max(quality.minScale, Math.min(quality.maxScale, nextScale));
    // Larger commit threshold on mobile avoids tiny back-and-forth reallocs.
    const commitThreshold = mobileMode ? 0.04 : 0.01;
    if (Math.abs(nextScale - quality.scale) > commitThreshold) {
      quality.scale = nextScale;
      applyRenderScale();
    }
  }

  // Self-healing renderer fallback: if we ended up on WebGPU and the frame rate
  // stays low even after render-scale has bottomed out, WebGPU is the bottleneck
  // on this GPU (its draw-submission cost dwarfs WebGL here). Persist a WebGL
  // preference and reload once so the session recovers automatically. Guarded by
  // sessionStorage so it can never loop, and only while actively playing.
  let _autoFallbackStrikes = 0;
  function maybeAutoFallbackRenderer() {
    if (rendererBackend !== "webgpu") return;
    if (game.state !== "playing") { _autoFallbackStrikes = 0; return; }
    const enabled = devVal("quality", "autoFallback", true) && rendererPref !== "webgpu";
    if (!enabled) return;
    try { if (sessionStorage.getItem("rb_autofb_done")) return; } catch (_) {}
    // Only once render scale is already near its floor (so we know it's not fixable
    // by resolution) and FPS is still poor.
    const scaleFloored = quality.scale <= quality.minScale + 0.06;
    if (quality.lastFps < 30 && scaleFloored) _autoFallbackStrikes++;
    else _autoFallbackStrikes = Math.max(0, _autoFallbackStrikes - 1);
    if (_autoFallbackStrikes >= 4) { // ~4 sustained samples of <30fps at min scale
      try {
        sessionStorage.setItem("rb_autofb_done", "1");
        localStorage.setItem("rb_renderer", "webgl");
      } catch (_) {}
      console.warn("[perf] WebGPU sustained <30fps at min render scale — switching to WebGL and reloading.");
      location.reload();
    }
  }

  // Runtime shadow toggle. Flipping shadowMap.enabled forces the affected material
  // shaders to recompile (one brief hitch), after which shadow sampling is removed
  // from every fragment — a solid GPU win on shadow-heavy weak GPUs.
  function setShadowsEnabled(enabled) {
    if (!renderer.shadowMap || renderer.shadowMap.enabled === enabled) return;
    renderer.shadowMap.enabled = enabled;
    renderer.shadowMap.needsUpdate = true;
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) m.needsUpdate = true;
    });
  }

  // Adaptive performance governor: when the frame rate stays low even after the
  // render scale has bottomed out (so resolution isn't the lever — the common
  // GPU-bound case), cut the next most expensive feature: shadows. One-way per
  // session (avoids oscillation); a reload restores. Respects the dev override:
  // quality.shadows "on"/"off" pins shadows and disables the governor for them.
  let _governorStrikes = 0;
  let _shadowsDroppedByGovernor = false;
  function maybePerfGovernor() {
    if (!devVal("quality", "autoPerfGovernor", true)) return;
    if (devVal("quality", "shadows", "auto") !== "auto") return; // explicit on/off wins
    if (game.state !== "playing") { _governorStrikes = 0; return; }
    if (_shadowsDroppedByGovernor || !renderer.shadowMap?.enabled) return;
    const scaleFloored = quality.scale <= quality.minScale + 0.08;
    if (quality.lastFps < 48 && scaleFloored) _governorStrikes++;
    else _governorStrikes = Math.max(0, _governorStrikes - 1);
    if (_governorStrikes >= 4) {
      setShadowsEnabled(false);
      _shadowsDroppedByGovernor = true;
      console.warn("[perf] governor: sustained <48fps at min render scale — shadows disabled for a smoother frame rate.");
      flashPerfNotice("Performance: shadows disabled for a smoother frame rate");
    }
  }

  // Brief, non-blocking on-screen perf notice.
  function flashPerfNotice(text) {
    let t = document.getElementById("perf-notice-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "perf-notice-toast";
      t.style.cssText =
        "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;" +
        "font:600 11px ui-monospace,monospace;letter-spacing:.06em;color:#ffd45a;" +
        "background:rgba(20,14,4,.9);border:1px solid rgba(255,212,90,.4);padding:6px 14px;" +
        "border-radius:999px;pointer-events:none;transition:opacity .3s;";
      document.body?.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = "1";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { if (t) t.style.opacity = "0"; }, 3500);
  }

  function recoverFromFrameHitch(rawDt) {
    if (rawDt < 0.075 || quality.hitchCooldown > 0) return;
    quality.hitchCooldown = 0.45;
    quality.hitchCount++;

    const pressure = rawDt > 0.18 ? 0.18 : rawDt > 0.12 ? 0.13 : 0.08;
    const nextScale = Math.max(quality.minScale, quality.scale - pressure);
    if (nextScale < quality.scale - 0.005) {
      quality.scale = nextScale;
      applyRenderScale();
    }

    const maxEffects = lowEndMode ? 4 : 6;
    while (lightningEffects.length > maxEffects) recycleLightningEffect(lightningEffects.shift());
    while (particles.length > MAX_ACTIVE_IMPACT_PARTICLES * 0.7) recycleImpactParticle(particles.shift());
  }

  // ── Frame-time / performance overlay (toggle with F3 or backtick) ───────────
  // Lightweight dev HUD: a tiny rolling frame-time graph plus live counters so
  // performance spikes can be pinpointed to a subsystem instead of guessed at.
  const perfOverlay = (() => {
    const el = document.createElement("div");
    el.id = "perf-overlay";
    Object.assign(el.style, {
      position: "fixed", top: "8px", left: "8px", zIndex: "9999",
      font: "11px/1.35 ui-monospace,Menlo,Consolas,monospace",
      color: "#9effc8", background: "rgba(6,10,16,0.82)",
      border: "1px solid rgba(90,160,140,0.4)", borderRadius: "6px",
      padding: "7px 9px", pointerEvents: "none", whiteSpace: "pre",
      textShadow: "0 1px 2px #000", display: "none",
      backdropFilter: "blur(2px)", minWidth: "188px",
    });
    const graph = document.createElement("canvas");
    graph.width = 180; graph.height = 34;
    Object.assign(graph.style, { display: "block", marginTop: "5px", width: "180px", height: "34px", imageRendering: "pixelated" });
    const text = document.createElement("div");
    el.appendChild(text);
    el.appendChild(graph);
    document.body.appendChild(el);
    const gctx = graph.getContext("2d");
    const samples = new Float32Array(90);
    let head = 0, visible = false, acc = 0, accFrames = 0, lastRefresh = 0;

    function record(frameMs) {
      samples[head] = frameMs;
      head = (head + 1) % samples.length;
    }
    function drawGraph() {
      gctx.clearRect(0, 0, graph.width, graph.height);
      // 60fps (16.7ms) and 30fps (33.3ms) reference lines
      const msToY = ms => graph.height - Math.min(graph.height, (ms / 50) * graph.height);
      gctx.strokeStyle = "rgba(120,200,160,0.25)"; gctx.beginPath();
      gctx.moveTo(0, msToY(16.7)); gctx.lineTo(graph.width, msToY(16.7)); gctx.stroke();
      gctx.strokeStyle = "rgba(220,150,90,0.25)"; gctx.beginPath();
      gctx.moveTo(0, msToY(33.3)); gctx.lineTo(graph.width, msToY(33.3)); gctx.stroke();
      gctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const idx = (head + i) % samples.length;
        const x = (i / (samples.length - 1)) * graph.width;
        const y = msToY(samples[idx]);
        if (i === 0) gctx.moveTo(x, y); else gctx.lineTo(x, y);
      }
      const worst = Math.max(...samples);
      gctx.strokeStyle = worst > 33 ? "#ff8a5a" : worst > 20 ? "#ffd45a" : "#6effb0";
      gctx.lineWidth = 1; gctx.stroke();
    }
    function update(now, frameMs) {
      if (!visible) return;
      record(frameMs);
      acc += frameMs; accFrames++;
      if (now - lastRefresh < 250) return; // refresh text 4×/sec
      lastRefresh = now;
      const avgMs = acc / Math.max(1, accFrames); acc = 0; accFrames = 0;
      const fps = 1000 / Math.max(0.01, avgMs);
      const info = renderer.info?.render || {};
      const mem = renderer.info?.memory || {};
      text.textContent =
        `${fps.toFixed(0)} fps   ${avgMs.toFixed(1)} ms\n` +
        `backend  ${rendererBackend}\n` +
        `scale    ${(quality.scale * 100).toFixed(0)}%   hitch ${quality.hitchCount}\n` +
        `draws    ${info.calls ?? "?"}   tris ${info.triangles ? (info.triangles / 1000).toFixed(0) + "k" : "?"}\n` +
        `geo ${mem.geometries ?? "?"}  tex ${mem.textures ?? "?"}\n` +
        `enemies ${enemies.length}  ptcl ${particles.length}  lit ${lightningEffects.length}` +
        (net?.active ? `\nnet  ${gameMode} ${net.isHost ? "host" : "guest"}  peers ${net.peerCount}` : "");
      drawGraph();
    }
    function toggle() {
      visible = !visible;
      el.style.display = visible ? "block" : "none";
    }
    return { update, toggle, get visible() { return visible; } };
  })();

  const crosshair = {
    root: document.getElementById("xhair"),
    kick: 0,
    spread: 0,
    recoilX: 0,
    recoilY: 0,
  };

  function pushCrosshairKick(amount) {
    crosshair.kick = Math.min(1, crosshair.kick + amount);
  }

  function pushCrosshairRecoil(dx, dy) {
    crosshair.recoilX += dx;
    crosshair.recoilY += dy;
  }

  function updateCrosshair(dt) {
    if (!crosshair.root) return;
    const moving = game.state === "playing" && (keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD"));
    const sprinting = moving && (keys.has("ShiftLeft") || keys.has("ShiftRight")) && player.stamina > 0;

    crosshair.kick = Math.max(0, crosshair.kick - dt * 3.8);
    crosshair.recoilX += (0 - crosshair.recoilX) * Math.min(1, dt * 16);
    crosshair.recoilY += (0 - crosshair.recoilY) * Math.min(1, dt * 18);
    const targetSpread =
      0.85 +
      (moving ? 0.22 : 0) +
      (sprinting ? 0.22 : 0) +
      (1 - viewState.ads) * 0.08 +
      crosshair.kick * 0.36;

    crosshair.spread += (targetSpread - crosshair.spread) * Math.min(1, dt * 14);
    const reticleX = crosshair.recoilX.toFixed(2);
    const reticleY = crosshair.recoilY.toFixed(2);
    crosshair.root.style.transform = `translate(calc(-50% + ${reticleX}px), calc(-50% + ${reticleY}px)) scale(${crosshair.spread.toFixed(3)})`;
    const hidden = game.state !== "playing" || viewState.lookBack > 0.08;
    crosshair.root.style.opacity = hidden ? "0" : viewState.ads > 0.9 ? "0.3" : "1";
  }

  const impactParticlePool = [];
  const MAX_ACTIVE_IMPACT_PARTICLES = 36;
  const tracerPool: Record<string, any> = {};
  for (const gt of Object.values(GUNS)) tracerPool[gt] = []; // one pool per roster gun
  const bulletHolePool = [];
  const activeBulletHoles = [];
  const MAX_ACTIVE_BULLET_HOLES = 48;

  const impactGeometry = new THREE.SphereGeometry(0.02, 3, 3);
  const impactMaterials = [
    new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true }),
    new THREE.MeshBasicMaterial({ color: 0xff8822, transparent: true }),
  ];

  function createTracerAlphaMap() {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.2, "rgba(255,255,255,0.2)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.85)");
    gradient.addColorStop(0.8, "rgba(255,255,255,0.2)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  const tracerAlphaMap = createTracerAlphaMap();
  const tracerMaterials = {
    [GUNS.RIFLE]:  new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0.10, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.SHOTGUN]:new THREE.MeshBasicMaterial({ color: 0xffb870, transparent: true, opacity: 0.08, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.SNIPER]: new THREE.MeshBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.13, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.PISTOL]: new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true, opacity: 0.09, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.SMG]:    new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0.09, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.LMG]:    new THREE.MeshBasicMaterial({ color: 0xffdca0, transparent: true, opacity: 0.11, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.DMR]:    new THREE.MeshBasicMaterial({ color: 0xf2f8ff, transparent: true, opacity: 0.12, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.AKIMBO]: new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true, opacity: 0.09, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.RAILGUN]:new THREE.MeshBasicMaterial({ color: 0xa8f0ff, transparent: true, opacity: 0.16, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    [GUNS.FLAK]:   new THREE.MeshBasicMaterial({ color: 0xffb870, transparent: true, opacity: 0.08, alphaMap: tracerAlphaMap, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
  };
  const tracerGeometry = new THREE.CylinderGeometry(1, 0.08, 1, 12, 8, true);
  const LIGHTNING_POOL_SIZE = 12;
  const LIGHTNING_MAX_SEGMENTS = 54;
  const LIGHTNING_FULL_QUALITY_DRONES = 2;
  const LIGHTNING_MAX_VISIBLE_EFFECTS = 9;
  const lightningPathScratch = Array.from({ length: LIGHTNING_MAX_SEGMENTS + 1 }, () => new THREE.Vector3());
  const lightningMainPathScratch = Array.from({ length: LIGHTNING_MAX_SEGMENTS + 1 }, () => new THREE.Vector3());
  const lightningCoreMaterial = new THREE.LineBasicMaterial({ color: 0xeeddff,  transparent: true, opacity: 1,    blending: THREE.AdditiveBlending, depthWrite: false });
  const lightningGlowMaterial = new THREE.LineBasicMaterial({ color: 0xbb44ff,  transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
  const lightningOuterMaterial = new THREE.LineBasicMaterial({ color: 0x7711cc, transparent: true, opacity: 0.50, blending: THREE.AdditiveBlending, depthWrite: false });
  const lightningRingGeometry = new THREE.RingGeometry(0.04, 0.55, 24);
  const lightningRingMaterial = new THREE.MeshBasicMaterial({ color: 0xcc55ff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  // Glow-dot sprite: soft radial halo rendered at every segment vertex via THREE.Points
  // Overlapping halos merge into a thick glowing bolt body — no shader, WebGPU-safe.
  const _lgdCanvas = document.createElement('canvas');
  _lgdCanvas.width = _lgdCanvas.height = 32;
  (() => {
    const c = _lgdCanvas.getContext('2d');
    const g = c.createRadialGradient(16,16,0,16,16,16);
    g.addColorStop(0,    'rgba(210,252,255,1)');
    g.addColorStop(0.25, 'rgba(100,228,255,0.75)');
    g.addColorStop(0.6,  'rgba(20,140,255,0.28)');
    g.addColorStop(1,    'rgba(0,60,200,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  })();
  const lightningGlowDotMaterial = new THREE.PointsMaterial({
    size: 0.62,
    map: new THREE.CanvasTexture(_lgdCanvas),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    sizeAttenuation: true,
    opacity: 0,
  });
  const packUpgradeEffects = [];
  const packBeamGeometry = new THREE.CylinderGeometry(0.09, 0.16, 1, 18, 1, true);
  const packRingGeometry = new THREE.TorusGeometry(1, 0.018, 8, 56);
  const packSparkGeometry = new THREE.SphereGeometry(0.035, 6, 4);
  const packBeamMaterial = new THREE.MeshBasicMaterial({ color: 0x5ffcff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const packGoldMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false });
  const packSparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const megaBlastCoreGeometry = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
  const megaBlastShellGeometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  const megaBlastSphereGeometry = new THREE.SphereGeometry(1, 22, 14);
  const megaBlastRingGeometry = new THREE.TorusGeometry(1, 0.045, 8, 40);
  const bulletHoleTexture = (() => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cx = size * 0.5;
    const cy = size * 0.5;
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, size * 0.46);
    grad.addColorStop(0, "rgba(8,6,6,0.96)");
    grad.addColorStop(0.22, "rgba(18,12,12,0.92)");
    grad.addColorStop(0.55, "rgba(44,30,26,0.72)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(116,76,60,0.35)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
      const r1 = 7 + Math.random() * 2;
      const r2 = 15 + Math.random() * 5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,230,200,0.18)";
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    tex.anisotropy = 1;
    return tex;
  })();
  const bulletHoleGeometry = new THREE.PlaneGeometry(0.42, 0.42);
  const bulletHoleMaterial = new THREE.MeshBasicMaterial({
    map: bulletHoleTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  
  function createEnergySpriteSheet(drawFrame, columns = 4, rows = 4, size = 256) {
    const canvas = document.createElement("canvas");
    canvas.width = columns * size;
    canvas.height = rows * size;
    const ctx = canvas.getContext("2d");
    for (let index = 0; index < columns * rows; index++) {
      const col = index % columns;
      const row = Math.floor(index / columns);
      ctx.save();
      ctx.translate(col * size, row * size);
      drawFrame(ctx, size, index / Math.max(1, columns * rows - 1), index);
      ctx.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1 / columns, 1 / rows);
    texture.needsUpdate = true;
    return { texture, columns, rows, frames: columns * rows };
  }

  function drawSoftStar(ctx, size, spikes, innerRadius, outerRadius, rotation, colorA, colorB, alpha = 1) {
    const center = size * 0.5;
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(rotation);
    ctx.globalAlpha = alpha;
    const gradient = ctx.createRadialGradient(0, 0, innerRadius * 0.16, 0, 0, outerRadius);
    gradient.addColorStop(0, colorA);
    gradient.addColorStop(0.45, colorB);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (Math.PI * i) / spikes;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

const kamehamehaSpriteSheets = (() => {
  const TAU = Math.PI * 2;

  function rand01(n) {
    return (Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
  }

function drawLightningArc(ctx, cx, cy, innerR, outerR, angle, seed, color, width, points = 7, glowBlur = 10) {
  // Set line styles
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Apply Glow Effect
  if (glowBlur > 0) {
    ctx.shadowBlur = glowBlur;
    ctx.shadowColor = color;
  } else {
    ctx.shadowBlur = 0; // Ensure glow is off if set to 0
  }

  ctx.beginPath();

  for (let i = 0; i < points; i++) {
    // Calculate progress along the line (0 to 1)
    // Using a ternary operator to prevent division by zero just in case 'points' is set to 1
    const k = points > 1 ? i / (points - 1) : 1; 
    
    const jitter = (rand01(seed + i * 9.17) - 0.5) * 0.34;
    const a = angle + jitter;
    const r = innerR + (outerR - innerR) * k;
    
    // Convert polar coordinates to Cartesian (x, y)
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();

  // Reset the shadow blur so it doesn't accidentally apply to other things drawn on the canvas later
  ctx.shadowBlur = 0; 
}

  function drawEnergyWisps(ctx, size, frame, count, alpha = 1) {
    const c = size * 0.5;

    for (let i = 0; i < count; i++) {
      const seed = i * 13.37 + frame * 0.91;
      const a = (TAU * i) / count + frame * 0.08 + Math.sin(frame * 0.1 + i) * 0.25;
      const r0 = size * (0.12 + 0.04 * Math.abs(Math.sin(seed)));
      const r1 = size * (0.34 + 0.12 * Math.abs(Math.cos(seed * 0.7)));
      const cp = size * (0.12 + 0.05 * Math.sin(seed * 1.3));

      ctx.strokeStyle = `rgba(105,235,255,${0.18 * alpha})`;
      ctx.lineWidth = size * (0.008 + 0.006 * Math.abs(Math.sin(seed)));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.quadraticCurveTo(
        c + Math.cos(a + 0.55) * cp,
        c + Math.sin(a + 0.55) * cp,
        c + Math.cos(a + 0.18) * r1,
        c + Math.sin(a + 0.18) * r1
      );
      ctx.stroke();
    }
  }

  function drawHotCore(ctx, size, radiusMul, frame, pulse = 1) {
    const c = size * 0.5;

    const outer = ctx.createRadialGradient(c, c, 0, c, c, size * 0.5);
    outer.addColorStop(0, "rgba(255,255,255,1)");
    outer.addColorStop(0.1, "rgba(244,253,255,0.98)");
    outer.addColorStop(0.25, "rgba(148,242,255,0.88)");
    outer.addColorStop(0.5, "rgba(31,169,255,0.42)");
    outer.addColorStop(0.78, "rgba(14,63,255,0.12)");
    outer.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(c, c, size * radiusMul * pulse, 0, TAU);
    ctx.fill();

    const inner = ctx.createRadialGradient(c, c, 0, c, c, size * 0.2);
    inner.addColorStop(0, "rgba(255,255,255,1)");
    inner.addColorStop(0.45, "rgba(242,254,255,0.96)");
    inner.addColorStop(1, "rgba(93,230,255,0)");
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(c, c, size * (0.17 + Math.sin(frame * 0.45) * 0.015), 0, TAU);
    ctx.fill();
  }

  const charge = createEnergySpriteSheet((ctx, size, t, frame) => {
    const c = size * 0.5;
    const pulse = 1 + Math.sin(frame * 0.42) * 0.07;
    const baseRadius = size * (0.18 + t * 0.26) * pulse;
    const ringRadius = size * (0.26 + t * 0.20);

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    drawHotCore(ctx, size, 0.50, frame, pulse);

    // Outer bloom halo
    const halo = ctx.createRadialGradient(c, c, 0, c, c, size * 0.5);
    halo.addColorStop(0, "rgba(160,240,255,0.22)");
    halo.addColorStop(0.5, "rgba(60,160,255,0.08)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.5, 0, TAU);
    ctx.fill();

    drawSoftStar(ctx, size, 10, baseRadius * 0.40, baseRadius * 2.20,
      t * Math.PI * 1.7 + frame * 0.2, "rgba(255,255,255,1.0)", "rgba(72,224,255,0.62)", 0.95);

    drawSoftStar(ctx, size, 7, baseRadius * 0.22, baseRadius * 1.65,
      -t * Math.PI * 2.1 - frame * 0.16, "rgba(226,252,255,0.85)", "rgba(35,146,255,0.38)", 0.60);

    drawSoftStar(ctx, size, 5, baseRadius * 0.15, baseRadius * 1.0,
      t * Math.PI * 3.5 + frame * 0.28, "rgba(255,255,255,0.70)", "rgba(100,200,255,0.20)", 0.40);

    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(153,246,255,${0.88 - i * 0.14})`;
      ctx.lineWidth = size * (0.020 + i * 0.007);
      ctx.beginPath();
      ctx.arc(c, c, ringRadius * (1 + i * 0.18),
        frame * (0.18 + i * 0.04) + i,
        frame * (0.18 + i * 0.04) + i + Math.PI * (1.15 + t * 0.65));
      ctx.stroke();
    }

    drawEnergyWisps(ctx, size, frame, 22, 1.3);

    for (let i = 0; i < 14; i++) {
      drawLightningArc(ctx, c, c, size * 0.06,
        size * (0.42 + 0.10 * Math.sin(frame * 0.17 + i)),
        (TAU * i) / 14 + frame * 0.13, frame * 3.1 + i * 19,
        i % 3 === 0 ? "rgba(255,255,255,0.85)" : "rgba(140,240,255,0.72)",
        size * (0.010 + (i % 4 === 0 ? 0.006 : 0)));
    }

    ctx.restore();
  });

  const beam = createEnergySpriteSheet((ctx, size, t, frame) => {
    const c = size * 0.5;
    const pulse = 1 + Math.sin(frame * 0.55) * 0.06;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    drawHotCore(ctx, size, 0.52, frame, pulse);

    for (let i = 0; i < 5; i++) {
      const radius = size * (0.10 + i * 0.082 + Math.sin(frame * 0.32 + i * 1.7) * 0.015);
      ctx.strokeStyle = i === 0 ? "rgba(255,255,255,1.0)" : i === 1 ? "rgba(200,248,255,0.85)" : "rgba(121,238,255,0.70)";
      ctx.lineWidth = size * (0.034 - i * 0.004);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(c, c, radius,
        frame * (0.23 + i * 0.025) + i * 0.8,
        frame * (0.23 + i * 0.025) + i * 0.8 + Math.PI * (1.3 + t * 0.7));
      ctx.stroke();
    }

    for (let i = 0; i < 22; i++) {
      const angle = (TAU * i) / 22 + frame * 0.16;
      const len = size * (0.18 + Math.abs(Math.sin(frame * 0.3 + i)) * 0.18);
      const start = size * (0.05 + Math.abs(Math.cos(frame * 0.2 + i)) * 0.04);
      ctx.strokeStyle = i % 4 === 0 ? "rgba(255,255,255,0.90)" : i % 2 === 0 ? "rgba(180,245,255,0.70)" : "rgba(83,221,255,0.55)";
      ctx.lineWidth = size * (0.012 + (i % 4 === 0 ? 0.008 : (i % 2) * 0.003));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * start, c + Math.sin(angle) * start);
      ctx.lineTo(c + Math.cos(angle) * (start + len), c + Math.sin(angle) * (start + len));
      ctx.stroke();
    }

    drawEnergyWisps(ctx, size, frame, 24, 1.1);

    for (let i = 0; i < 10; i++) {
      drawLightningArc(ctx, c, c, size * 0.10, size * (0.48 + 0.06 * Math.sin(frame * 0.2 + i)),
        (TAU * i) / 10 - frame * 0.18, frame * 4.2 + i * 11,
        i % 3 === 0 ? "rgba(255,255,255,0.75)" : "rgba(160,248,255,0.60)",
        size * (0.009 + (i % 3 === 0 ? 0.005 : 0)));
    }

    ctx.restore();
  });

  const impact = createEnergySpriteSheet((ctx, size, t, frame) => {
    const c = size * 0.5;
    const bloom = size * (0.22 + t * 0.32);
    const blast = Math.min(1, t * 1.25);

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Outer shockwave halo
    const shockwave = ctx.createRadialGradient(c, c, bloom * 0.6, c, c, size * 0.5);
    shockwave.addColorStop(0, `rgba(120,220,255,${0.20 * blast})`);
    shockwave.addColorStop(0.5, `rgba(40,120,255,${0.08 * blast})`);
    shockwave.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shockwave;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.5, 0, TAU);
    ctx.fill();

    drawHotCore(ctx, size, 0.52, frame, 1 + blast * 0.12);

    drawSoftStar(ctx, size, 16, bloom * 0.30, bloom * 2.4,
      -t * Math.PI * 2.4 + frame * 0.07, "rgba(255,255,255,1.0)", "rgba(99,230,255,0.65)", 1);

    drawSoftStar(ctx, size, 10, bloom * 0.20, bloom * 1.8,
      t * Math.PI * 3.1, "rgba(230,252,255,0.90)", "rgba(25,122,255,0.36)", 0.70);

    drawSoftStar(ctx, size, 6, bloom * 0.12, bloom * 1.1,
      -t * Math.PI * 4.2 + frame * 0.18, "rgba(255,255,255,0.60)", "rgba(80,180,255,0.18)", 0.40);

    for (let i = 0; i < 5; i++) {
      const r = bloom * (0.88 + i * 0.28 + blast * 0.60);
      ctx.strokeStyle = `rgba(152,244,255,${0.80 - i * 0.12})`;
      ctx.lineWidth = size * (0.028 - i * 0.003);
      ctx.beginPath();
      ctx.arc(c, c, r, frame * 0.2 + i * 0.8, frame * 0.2 + i * 0.8 + Math.PI * 1.7);
      ctx.stroke();
    }

    for (let i = 0; i < 24; i++) {
      const angle = (TAU * i) / 24 + Math.sin(frame * 0.13 + i) * 0.14;
      const len = size * (0.24 + blast * 0.26 + Math.abs(Math.sin(frame * 0.25 + i)) * 0.10);
      ctx.strokeStyle = i % 4 === 0 ? "rgba(255,255,255,0.95)" : i % 2 === 0 ? "rgba(180,248,255,0.72)" : "rgba(92,224,255,0.58)";
      ctx.lineWidth = size * (0.013 + (i % 4 === 0 ? 0.010 : (i % 2) * 0.005));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * bloom * 0.38, c + Math.sin(angle) * bloom * 0.38);
      ctx.lineTo(c + Math.cos(angle) * (bloom * 0.38 + len), c + Math.sin(angle) * (bloom * 0.38 + len));
      ctx.stroke();
    }

    for (let i = 0; i < 16; i++) {
      drawLightningArc(ctx, c, c, size * 0.08, size * (0.44 + blast * 0.18),
        (TAU * i) / 16 + frame * 0.09, frame * 5.5 + i * 23,
        i % 4 === 0 ? "rgba(255,255,255,0.85)" : "rgba(200,252,255,0.65)",
        size * (0.011 + (i % 4 === 0 ? 0.007 : 0)));
    }

    ctx.restore();
  });

  return { charge, beam, impact };
})();

function createAnimatedEnergySprite(sheet, color = 0xffffff, scale = 1, opacity = 1, options: any = {}) {
  const texture = sheet.texture.clone();

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / sheet.columns, 1 / sheet.rows);
  texture.offset.set(0, 1 - 1 / sheet.rows);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    blending: options.blending ?? THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: options.depthTest ?? false,
    toneMapped: false,
    rotation: options.rotation ?? 0,
  });

  material.needsUpdate = true;

  const sprite = new THREE.Sprite(material);

  sprite.scale.setScalar(scale);
  sprite.frustumCulled = false;
  sprite.renderOrder = options.renderOrder ?? 37;

  sprite.userData.sheet = {
    columns: sheet.columns,
    rows: sheet.rows,
    frames: sheet.frames,
    fps: options.fps ?? 30,
    loop: options.loop ?? true,
  };

  sprite.userData.frame = -1;
  sprite.userData.age = 0;
  sprite.userData.life = options.life ?? Infinity;
  sprite.userData.baseScale = scale;
  sprite.userData.baseOpacity = opacity;
  sprite.userData.fadeIn = options.fadeIn ?? 0;
  sprite.userData.fadeOut = options.fadeOut ?? 0;
  sprite.userData.spin = options.spin ?? 0;
  sprite.userData.pulse = options.pulse ?? 0;
  sprite.userData.dead = false;

  sprite.updateEnergySprite = function updateEnergySprite(dt) {
    const data = this.userData;
    const sheetData = data.sheet;

    data.age += dt;

    if (data.age >= data.life) {
      data.dead = true;
      this.visible = false;
      return;
    }

    const totalFrames = Math.max(1, sheetData.frames);
    let frame = Math.floor(data.age * sheetData.fps);

    if (sheetData.loop) {
      frame %= totalFrames;
    } else {
      frame = Math.min(frame, totalFrames - 1);
    }

    if (frame !== data.frame) {
      data.frame = frame;

      const col = frame % sheetData.columns;
      const row = Math.floor(frame / sheetData.columns);

      texture.offset.x = col / sheetData.columns;
      texture.offset.y = 1 - (row + 1) / sheetData.rows;
    }

    if (data.spin) {
      this.material.rotation += data.spin * dt;
    }

    if (data.pulse) {
      const pulseScale = 1 + Math.sin(data.age * 18) * data.pulse;
      this.scale.setScalar(data.baseScale * pulseScale);
    }

    let alpha = data.baseOpacity;

    if (data.fadeIn > 0) {
      alpha *= Math.min(1, data.age / data.fadeIn);
    }

    if (data.fadeOut > 0 && Number.isFinite(data.life)) {
      const remaining = data.life - data.age;
      alpha *= Math.min(1, remaining / data.fadeOut);
    }

    this.material.opacity = Math.max(0, alpha);
  };

  sprite.resetEnergySprite = function resetEnergySprite() {
    this.visible = true;
    this.userData.frame = -1;
    this.userData.age = 0;
    this.userData.dead = false;
    this.material.opacity = this.userData.baseOpacity;
    this.scale.setScalar(this.userData.baseScale);

    texture.offset.set(0, 1 - 1 / sheet.rows);
  };

  sprite.disposeEnergySprite = function disposeEnergySprite() {
    this.material.map?.dispose();
    this.material.dispose();
  };

  return sprite;
}

  function setAnimatedSpriteFrame(sprite, frame) {
    if (!sprite?.material?.map || !sprite.userData?.sheet) return;
    const sheet = sprite.userData.sheet;
    const clampedFrame = ((frame % sheet.frames) + sheet.frames) % sheet.frames;
    if (sprite.userData.frame === clampedFrame) return;
    sprite.userData.frame = clampedFrame;
    const col = clampedFrame % sheet.columns;
    const row = Math.floor(clampedFrame / sheet.columns);
    sprite.material.map.offset.set(col / sheet.columns, 1 - (row + 1) / sheet.rows);
  }

  function advanceAnimatedSprite(sprite, time, fps = 24, phase = 0) {
    if (!sprite?.userData?.sheet) return;
    setAnimatedSpriteFrame(sprite, Math.floor((time * fps + phase) % sprite.userData.sheet.frames));
  }

  function makePlasmaBeamMaterial(hexColor, scrollSpeed) {
    // Canvas-drawn beam texture — WebGPU-safe (no custom GLSL needed)
    const W = 64, H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx2d = canvas.getContext('2d');
    const r = (hexColor >> 16) & 0xff;
    const g = (hexColor >> 8)  & 0xff;
    const b =  hexColor        & 0xff;

    // Lateral glow: bright center, dark edges — repeated vertically in strips
    const STRIPS = 16;
    const stripH = H / STRIPS;
    for (let i = 0; i < STRIPS; i++) {
      const bright = 0.35 + 0.65 * (Math.sin(i * 1.91 + 0.7) * 0.5 + 0.5);
      const grd = ctx2d.createLinearGradient(0, 0, W, 0);
      grd.addColorStop(0,   `rgba(${r},${g},${b},0)`);
      grd.addColorStop(0.15,`rgba(${r},${g},${b},${(bright * 0.35).toFixed(3)})`);
      grd.addColorStop(0.5, `rgba(${r},${g},${b},${bright.toFixed(3)})`);
      grd.addColorStop(0.85,`rgba(${r},${g},${b},${(bright * 0.35).toFixed(3)})`);
      grd.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx2d.fillStyle = grd;
      ctx2d.fillRect(0, i * stripH, W, stripH + 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    mat.userData.scrollSpeed = scrollSpeed;
    return mat;
  }

  function createMegaBlastVisual() {
    const group = new THREE.Group();
    group.visible = false;
    group.frustumCulled = false;
    group.renderOrder = 36;

    // Simple additive mat for aura spheres, rings
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    const originAura = new THREE.Mesh(megaBlastSphereGeometry, auraMat);
    const impactAura = new THREE.Mesh(megaBlastSphereGeometry, auraMat.clone());
    const ringA = new THREE.Mesh(megaBlastRingGeometry, auraMat.clone());
    const ringB = new THREE.Mesh(megaBlastRingGeometry, auraMat.clone());
    // No real-time PointLights on the beam. They lived under `group`, whose visibility
    // toggles with the blast, so every blast changed the scene's visible light count —
    // and three bakes that count into every shader, relinking every material mid-fight
    // (~400ms per program). The beam reads from its emissive sprites + aura instead.
    // The same call was already made for the angel/Warden/car lights.
    const light = null;
    const impactLight = null;

    const chargeCore = createAnimatedEnergySprite(kamehamehaSpriteSheets.charge, 0xffffff, 1.5, 0);
    const chargeAura = createAnimatedEnergySprite(kamehamehaSpriteSheets.charge, 0x6ce8ff, 2.2, 0);
    const beamSpriteA = createAnimatedEnergySprite(kamehamehaSpriteSheets.beam, 0xbaf7ff, 1.2, 0);
    const beamSpriteB = createAnimatedEnergySprite(kamehamehaSpriteSheets.beam, 0x57dfff, 1.55, 0);
    const beamSpriteC = createAnimatedEnergySprite(kamehamehaSpriteSheets.beam, 0x2ab8ff, 1.85, 0);
    const beamSpriteD = createAnimatedEnergySprite(kamehamehaSpriteSheets.beam, 0xf7ffff, 2.05, 0);
    const impactCore = createAnimatedEnergySprite(kamehamehaSpriteSheets.impact, 0xffffff, 1.8, 0);
    const impactAuraSprite = createAnimatedEnergySprite(kamehamehaSpriteSheets.impact, 0x78f0ff, 2.6, 0);
    const impactFlare = createAnimatedEnergySprite(kamehamehaSpriteSheets.impact, 0xd6fbff, 3.1, 0);

    // 10 wide billboard sprites = continuous glow column, no ShaderMaterial needed
    const BODY_COUNT = 10;
    const bodyColors = [0xffffff,0xffe8cc,0xffffff,0xffddaa,0xffffff,0xffe0bb,0xffffff,0xffddaa,0xffffff,0xffe8cc];
    const beamBodySprites = [];
    for (let i = 0; i < BODY_COUNT; i++) {
      const sp = createAnimatedEnergySprite(kamehamehaSpriteSheets.beam, bodyColors[i], 1.0, 0);
      sp.frustumCulled = false;
      sp.renderOrder = 35;
      group.add(sp);
      beamBodySprites.push(sp);
    }

    // Flowing particle stream along beam axis for inner sparkle
    const BEAM_PTC = 70;
    const beamPtcPos = new Float32Array(BEAM_PTC * 3);
    const beamPtcGeo = new THREE.BufferGeometry();
    beamPtcGeo.setAttribute('position', new THREE.BufferAttribute(beamPtcPos, 3));
    beamPtcGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(BEAM_PTC * 2), 2));
    const ptCanvas = document.createElement('canvas');
    ptCanvas.width = ptCanvas.height = 32;
    const ptCtx = ptCanvas.getContext('2d');
    const ptGrd = ptCtx.createRadialGradient(16,16,0,16,16,16);
    ptGrd.addColorStop(0,    'rgba(255,255,255,1)');
    ptGrd.addColorStop(0.35, 'rgba(220,240,255,0.7)');
    ptGrd.addColorStop(1,    'rgba(100,180,255,0)');
    ptCtx.fillStyle = ptGrd;
    ptCtx.fillRect(0, 0, 32, 32);
    const beamPtcMat = new THREE.PointsMaterial({
      size: 0.3,
      map: new THREE.CanvasTexture(ptCanvas),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      sizeAttenuation: true,
      opacity: 0,
    });
    const beamParticles = new THREE.Points(beamPtcGeo, beamPtcMat);
    beamParticles.frustumCulled = false;
    beamParticles.renderOrder = 36;
    group.add(beamParticles);

    for (const obj of [
      originAura,
      impactAura,
      ringA,
      ringB,
      chargeAura,
      chargeCore,
      beamSpriteC,
      beamSpriteB,
      beamSpriteA,
      beamSpriteD,
      impactAuraSprite,
      impactCore,
      impactFlare,
    ]) {
      obj.frustumCulled = false;
      obj.renderOrder = 36;
      group.add(obj);
    }
    group.userData.parts = {
      originAura,
      impactAura,
      ringA,
      ringB,
      light,
      impactLight,
      chargeCore,
      chargeAura,
      beamSpriteA,
      beamSpriteB,
      beamSpriteC,
      beamSpriteD,
      impactCore,
      impactAuraSprite,
      impactFlare,
      beamBodySprites,
      beamParticles,
    };
    scene.add(group);
    return group;
  }

  function setMegaBlastVisual(enemy, origin, end, power, time) {
    const visual = enemy.megaBlastVisual;
    if (!visual) return;

    const parts = visual.userData.parts || {};
    enemyShotDirTmp.subVectors(end, origin);
    const len = enemyShotDirTmp.length();
    if (len < 0.1 || power <= 0.001) {
      visual.visible = false;
      return;
    }

    enemyShotDirTmp.multiplyScalar(1 / len);
    megaBlastMidTmp.copy(origin).addScaledVector(enemyShotDirTmp, len * 0.5);
    // Plasma lance — tight, hot, threatening
    const flicker     = 0.88 + Math.random() * 0.24;
    const pulse       = 0.92 + Math.sin(time * 28 + enemy.animSeed) * 0.08;
    const spritePhase = enemy.animSeed * 9.7;
    // Beam is narrow — no cartoon charge orb, just a hot narrow lance
    const outerRadius = (0.18 + power * 0.22) * pulse;
    const midRadius   = outerRadius * 0.52;
    const coreRadius  = outerRadius * 0.22;

    visual.visible = true;

    // --- Tri-layer beam body (narrow, intense)
    for (const beam of [parts.outer, parts.mid, parts.core]) {
      if (!beam) continue;
      beam.position.copy(megaBlastMidTmp);
      beam.quaternion.setFromUnitVectors(tracerUp, enemyShotDirTmp);
    }
    parts.outer?.scale.set(outerRadius, len, outerRadius);
    parts.mid?.scale.set(midRadius,   len, midRadius);
    parts.core?.scale.set(coreRadius, len, coreRadius);
    // --- Beam body: wide overlapping billboard sprites forming a continuous glow column
    const bodySprites = parts.beamBodySprites;
    if (bodySprites) {
      const perpX = -enemyShotDirTmp.z;
      const perpZ =  enemyShotDirTmp.x;
      for (let i = 0; i < bodySprites.length; i++) {
        const sp = bodySprites[i];
        if (!sp?.material) continue;
        const frac = (i + 0.5) / bodySprites.length;
        // Slight lateral weave so sprites don't all stack on the same axis
        const weave = Math.sin(time * 2.1 + i * 1.2) * outerRadius * 0.25;
        sp.position.set(
          origin.x + enemyShotDirTmp.x * len * frac + perpX * weave,
          origin.y + enemyShotDirTmp.y * len * frac,
          origin.z + enemyShotDirTmp.z * len * frac + perpZ * weave
        );
        // Wider at the beam's heart, taper toward origin/end
        const centerBulge = 0.55 + Math.sin(frac * Math.PI) * 0.45;
        sp.scale.setScalar(outerRadius * (5.5 + centerBulge * 3.5) * pulse);
        sp.material.opacity = 0.13 * power * (0.6 + centerBulge * 0.7) * flicker;
        sp.material.rotation = time * (i % 2 === 0 ? 1.8 : -2.3) + i * 0.628;
        advanceAnimatedSprite(sp, time, 22, spritePhase + i * 3.9);
      }
    }

    // --- Inner particle stream: glowing sparkles flowing from origin to end
    const ptc = parts.beamParticles;
    if (ptc) {
      const pos = ptc.geometry.attributes.position.array;
      const N = pos.length / 3;
      const perpX = -enemyShotDirTmp.z;
      const perpZ =  enemyShotDirTmp.x;
      for (let i = 0; i < N; i++) {
        // Each particle flows at a different speed, looping from 0→1
        const t = ((i / N) + time * (0.55 + (i % 7) * 0.06)) % 1.0;
        const jitterA = Math.sin(i * 7.31 + time * 3.1) * outerRadius * 0.55;
        const jitterB = Math.cos(i * 5.13 + time * 2.9) * outerRadius * 0.4;
        pos[i*3]   = origin.x + enemyShotDirTmp.x * len * t + perpX * jitterA;
        pos[i*3+1] = origin.y + enemyShotDirTmp.y * len * t + jitterB * 0.3;
        pos[i*3+2] = origin.z + enemyShotDirTmp.z * len * t + perpZ * jitterA;
      }
      ptc.geometry.attributes.position.needsUpdate = true;
      ptc.material.opacity = 0.8 * power;
      ptc.material.size = outerRadius * 0.6;
    }

    // --- Muzzle discharge: tight glow at barrel — NOT a charge orb
    if (parts.originAura) {
      parts.originAura.position.copy(origin).addScaledVector(enemyShotDirTmp, 0.06);
      parts.originAura.scale.setScalar((0.28 + power * 0.22) * pulse);
      parts.originAura.material.opacity = 0.70 * power * flicker;
      parts.originAura.material.color.setHex(0xff5500);
    }
    // Hide the animated charge sprites — they look cartoony
    if (parts.chargeAura?.material)  parts.chargeAura.material.opacity  = 0;
    if (parts.chargeCore?.material)  parts.chargeCore.material.opacity  = 0;

    // --- Plasma pulses traveling along beam (replace anime energy sprites)
    const beamArr = [parts.beamSpriteA, parts.beamSpriteB, parts.beamSpriteC, parts.beamSpriteD];
    for (let i = 0; i < beamArr.length; i++) {
      const sp = beamArr[i];
      if (!sp?.material) continue;
      // Travel pulse: each ring moves from origin to end at different speeds
      const tFrac = ((time * (3.5 + i * 0.8) + i * 0.25 + enemy.animSeed) % 1.0);
      sp.position.copy(origin).addScaledVector(enemyShotDirTmp, len * tFrac);
      sp.scale.setScalar(outerRadius * (1.8 + i * 0.3) * (1 - tFrac * 0.5));
      sp.material.opacity = (1 - tFrac) * 0.65 * power;
      sp.material.color.setHex(i < 2 ? 0xff6600 : 0xffaa00);
      sp.material.rotation = time * (i % 2 === 0 ? 4.0 : -3.5) + i;
      advanceAnimatedSprite(sp, time, 28, spritePhase + i * 7);
    }

    // --- Sharp energy rings tracking along beam (plasma shockwave rings)
    const rings = [parts.ringA, parts.ringB];
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      if (!ring) continue;
      const ringT = ((time * 4.5 + i * 0.5 + enemy.animSeed) % 1.0);
      ring.position.copy(origin).addScaledVector(enemyShotDirTmp, len * ringT);
      ring.quaternion.setFromUnitVectors(tracerUp, enemyShotDirTmp);
      ring.scale.setScalar(outerRadius * 4.5 * (0.4 + ringT * 0.6));
      ring.material.opacity = (1.0 - ringT) * 1.0 * power;
      ring.material.color.setHex(0xff4400);
    }

    // --- Impact: bright white explosion + tight shockwave
    const impFlicker = 0.80 + Math.random() * 0.40;
    if (parts.impactAura) {
      parts.impactAura.position.copy(end);
      parts.impactAura.scale.setScalar((0.55 + power * 0.75) * impFlicker);
      parts.impactAura.material.opacity = 0.90 * power;
      parts.impactAura.material.color.setHex(0xff4400);
    }
    if (parts.impactCore?.material) {
      parts.impactCore.position.copy(end);
      parts.impactCore.scale.setScalar((0.70 + power * 0.65) * impFlicker);
      parts.impactCore.material.opacity = 1.0 * power;
      parts.impactCore.material.color.setHex(0xffffff);
      parts.impactCore.material.rotation = time * 5.0;
      advanceAnimatedSprite(parts.impactCore, time, 32, spritePhase + 9);
    }
    if (parts.impactAuraSprite?.material) {
      parts.impactAuraSprite.position.copy(end);
      parts.impactAuraSprite.scale.setScalar((1.0 + power * 0.9) * impFlicker);
      parts.impactAuraSprite.material.opacity = 0.80 * power;
      parts.impactAuraSprite.material.color.setHex(0xff8800);
      parts.impactAuraSprite.material.rotation = -time * 4.5;
      advanceAnimatedSprite(parts.impactAuraSprite, time, 28, spritePhase + 5);
    }
    if (parts.impactFlare?.material) {
      parts.impactFlare.position.copy(end);
      parts.impactFlare.scale.setScalar((1.8 + power * 1.4) * impFlicker);
      parts.impactFlare.material.opacity = 0.65 * power;
      parts.impactFlare.material.color.setHex(0xff3300);
      parts.impactFlare.material.rotation = time * 2.2;
      advanceAnimatedSprite(parts.impactFlare, time, 24, spritePhase + 14);
    }

    // --- Lights: orange beam body + blinding white impact flash
    if (parts.light) {
      parts.light.position.copy(origin).lerp(end, 0.45);
      parts.light.intensity = 6 * power * flicker;
      parts.light.distance  = Math.min(60, Math.max(18, len * 1.1));
      parts.light.color.setHex(0xff6600);
    }
    if (parts.impactLight) {
      parts.impactLight.position.copy(end);
      parts.impactLight.intensity = 9 * power * impFlicker;
      parts.impactLight.distance  = 38;
      parts.impactLight.color.setHex(0xffffff);
    }
  }

  function hideMegaBlast(enemy) {
    if (!enemy) return;
    enemy.megaBlastTimer = 0;
    enemy.megaBlastDamageTimer = 0;
    enemy.megaBlastSfxTimer = 0;
    enemy.megaBlastSpinAngle = null;
    enemy.netMegaBlast = null;
    const visual = enemy.megaBlastVisual;
    if (!visual) return;
    visual.visible = false;
    const parts = visual.userData.parts || {};
    if (parts.beamBodySprites) {
      for (const sp of parts.beamBodySprites) { if (sp?.material) sp.material.opacity = 0; }
    }
    if (parts.beamParticles?.material) parts.beamParticles.material.opacity = 0;
    for (const part of [
      parts.originAura,
      parts.impactAura,
      parts.ringA,
      parts.ringB,
      parts.chargeCore,
      parts.chargeAura,
      parts.beamSpriteA,
      parts.beamSpriteB,
      parts.beamSpriteC,
      parts.beamSpriteD,
      parts.impactCore,
      parts.impactAuraSprite,
      parts.impactFlare,
    ]) {
      if (part?.material) part.material.opacity = 0;
    }
    if (parts.light) parts.light.intensity = 0;
    if (parts.impactLight) parts.impactLight.intensity = 0;
  }
function checkoutImpactParticle() {
    if (impactParticlePool.length) {
      const p = impactParticlePool.pop();
      p.mesh.visible = true;
      return p;
    }
    const mesh = new THREE.Mesh(impactGeometry, impactMaterials[0]);
    mesh.visible = true;
    scene.add(mesh);
    return { mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0 } as any;
  }

  function recycleImpactParticle(particle) {
    particle.mesh.visible = false;
    impactParticlePool.push(particle);
  }

  function checkoutTracer(gunType) {
    const pool = tracerPool[gunType];
    if (pool.length) {
      const t = pool.pop();
      t.line.visible = true;
      return t;
    }
    const line = new THREE.Mesh(tracerGeometry, tracerMaterials[gunType]);
    line.visible = true;
    line.renderOrder = 8;
    scene.add(line);
    return { line, life: 0, maxLife: 0, baseOpacity: gunType === GUNS.SNIPER ? 0.13 : gunType === GUNS.SHOTGUN ? 0.08 : 0.10, gunType };
  }

  function recycleTracer(tracer) {
    tracer.line.visible = false;
    tracerPool[tracer.gunType].push(tracer);
  }

// One flash light for the whole bolt pool. It lives at the scene root and stays
// visible for the life of the session so the scene's visible-light count — which
// three bakes into every shader — never changes. Off is intensity 0, never .visible.
let sharedLightningLight = null;
let lightningLightPeak = 0;
const lightningLightPos = new THREE.Vector3();
function getSharedLightningLight() {
  if (!sharedLightningLight) {
    sharedLightningLight = new THREE.PointLight(0x88ddff, 0, 28, 1.5);
    sharedLightningLight.name = "LightningFlashLight";
    sharedLightningLight.castShadow = false;
    scene.add(sharedLightningLight);
  }
  return sharedLightningLight;
}

function createLightningEffect() {
  const group = new THREE.Group();
  group.visible = false;
  group.frustumCulled = false;

  const positions = new Float32Array(LIGHTNING_MAX_SEGMENTS * 2 * 3);

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(LIGHTNING_MAX_SEGMENTS * 2 * 2), 2));
  geometry.setDrawRange(0, 0);

  // Important: prevents lightning from randomly disappearing when endpoints move fast
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 9999);

  const outerMaterial = lightningOuterMaterial.clone();
  const glowMaterial = lightningGlowMaterial.clone();
  const coreMaterial = lightningCoreMaterial.clone();

  outerMaterial.transparent = true;
  glowMaterial.transparent = true;
  coreMaterial.transparent = true;

  outerMaterial.depthWrite = false;
  glowMaterial.depthWrite = false;
  coreMaterial.depthWrite = false;

  const outer = new THREE.LineSegments(geometry, outerMaterial);
  const glow  = new THREE.LineSegments(geometry, glowMaterial);
  const core  = new THREE.LineSegments(geometry, coreMaterial);

  // Glow dots share the same geometry — soft halos at every vertex thicken the bolt visually
  const glowDotMaterial = lightningGlowDotMaterial.clone();
  const glowDots = new THREE.Points(geometry, glowDotMaterial);

  outer.frustumCulled    = false;
  glow.frustumCulled     = false;
  core.frustumCulled     = false;
  glowDots.frustumCulled = false;

  outer.renderOrder    = 28;
  glow.renderOrder     = 30;
  glowDots.renderOrder = 30;
  core.renderOrder     = 31;

  group.add(outer, glow, glowDots, core);

  const ringMaterial = lightningRingMaterial.clone();
  const sourceRingMaterial = lightningRingMaterial.clone();

  ringMaterial.transparent = true;
  sourceRingMaterial.transparent = true;
  ringMaterial.depthWrite = false;
  sourceRingMaterial.depthWrite = false;

  const ring = new THREE.Mesh(lightningRingGeometry, ringMaterial);
  ring.rotation.x = -Math.PI * 0.5;
  ring.frustumCulled = false;
  ring.renderOrder = 29;

  const sourceRing = new THREE.Mesh(lightningRingGeometry, sourceRingMaterial);
  sourceRing.rotation.x = -Math.PI * 0.5;
  sourceRing.frustumCulled = false;
  sourceRing.renderOrder = 29;

  group.add(ring, sourceRing);

  // Impact flash light: a single light shared by the whole bolt pool, parented to the
  // scene and never hidden. Each bolt used to own one, parented under `group` — whose
  // visibility toggles per bolt. three bakes the count of VISIBLE lights into every
  // shader, so bolts firing made the count swing 8↔17 and relinked every material in
  // the scene, repeatedly, mid-fight. One always-present light keeps the count fixed.
  // Bolts do not own it: updateLightningEffects drives it from the brightest live bolt.
  // Touched here (not lazily) so it exists in the scene for the startup shader warm.
  getSharedLightningLight();

  scene.add(group);

  return {
    group,
    geometry,
    positionAttr,
    positions,

    outer,
    glow,
    glowDots,
    core,
    ring,
    sourceRing,

    segmentCount: 0,
    life: 0,
    maxLife: 0,

    baseScale: 1,
    sourceScale: 1,

    lightPower: 0,
    flickerSeed: Math.random() * 1000,

    impactPoint: new THREE.Vector3(),
    sourcePoint: new THREE.Vector3(),
    direction: new THREE.Vector3(),

    active: false,

    reset() {
      this.segmentCount = 0;
      this.life = 0;
      this.maxLife = 0;
      this.lightPower = 0;
      this.baseScale = 1;
      this.sourceScale = 1;
      this.active = false;

      this.group.visible = false;
      // The flash light is shared across the pool — updateLightningEffects recomputes
      // its intensity from the live bolts each frame, so a recycled bolt must not zero it.
      this.geometry.setDrawRange(0, 0);

      this.outer.material.opacity    = 0;
      this.glow.material.opacity     = 0;
      this.glowDots.material.opacity = 0;
      this.core.material.opacity     = 0;
      this.ring.material.opacity     = 0;
      this.sourceRing.material.opacity = 0;
    },

    dispose() {
      this.geometry.dispose();

      this.outer.material.dispose();
      this.glow.material.dispose();
      this.glowDots.material.dispose();
      this.core.material.dispose();
      this.ring.material.dispose();
      this.sourceRing.material.dispose();

      scene.remove(this.group);
    },
  };
}

  function checkoutLightningEffect() {
    const effect = lightningPool.length ? lightningPool.pop() : createLightningEffect();
    effect.group.visible = true;
    effect.ring.visible = true;
    effect.sourceRing.visible = true;
    effect.segmentCount = 0;
    effect.geometry.setDrawRange(0, 0);
    effect.outer.material.opacity    = 0.45;
    effect.glow.material.opacity     = 0.88;
    effect.glowDots.material.opacity = 0.70;
    effect.core.material.opacity     = 1;
    effect.ring.material.opacity  = 0.52;
    effect.sourceRing.material.opacity = 0.42;
    effect.ring.scale.setScalar(1);
    effect.sourceRing.scale.setScalar(1);
    effect.ringsVisible = true;
    effect.reshuffleTimer = undefined;
    effect.startPos = undefined;
    effect.endPos   = undefined;
    return effect;
  }

  function recycleLightningEffect(effect) {
    effect.group.visible = false;
    effect.geometry.setDrawRange(0, 0);
    lightningPool.push(effect);
  }

  // ── Telegraph ring pool ──────────────────────────────────────────────────────
  // Pooled additive ground decals used by enemy abilities to mark strike zones /
  // safe zones BEFORE damage lands — the readability layer of the ability revamp.
  // Meshes only (no lights — see the light-count invariant), created lazily, hidden
  // when idle, auto-released after TELEGRAPH_MAX_LIFE as a leak guard.
  const telegraphRingPool = [];
  const activeTelegraphRings = [];
  const TELEGRAPH_MAX_LIFE = 15;
  function createTelegraphRing() {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, mode: "idle", t: 0, life: 0, dur: 0, radius: 1, peak: 0.5, pulse: true };
  }
  // Modes: "charge" (opacity ramps up over dur, then holds) → "detonate" (bright
  // expand-and-vanish flash) or "fade" (gentle fade-out). Callers may mutate
  // ring.radius / ring.mesh.position each frame (e.g. the Cherub's shrinking
  // sanctuary) — the update loop re-applies them.
  function spawnTelegraphRing(x, z, radius, color, chargeDur, opts: any = {}) {
    const ring = telegraphRingPool.length ? telegraphRingPool.pop() : createTelegraphRing();
    ring.mesh.visible = true;
    ring.mesh.position.set(x, opts.y ?? 0.06, z);
    ring.mesh.material.color.setHex(color);
    ring.mesh.material.opacity = 0;
    ring.radius = Math.max(0.05, radius);
    ring.mesh.scale.setScalar(ring.radius);
    ring.mode = "charge";
    ring.t = 0;
    ring.life = 0;
    ring.dur = Math.max(0.05, chargeDur);
    ring.peak = opts.peak ?? 0.5;
    ring.pulse = opts.pulse !== false;
    activeTelegraphRings.push(ring);
    return ring;
  }
  function detonateTelegraphRing(ring) {
    if (!ring || ring.mode === "idle") return;
    ring.mode = "detonate";
    ring.t = 0;
    ring.dur = 0.16;
  }
  function fadeTelegraphRing(ring) {
    if (!ring || ring.mode === "idle") return;
    ring.mode = "fade";
  }
  function releaseTelegraphRing(ring) {
    if (!ring || ring.mode === "idle") return;
    ring.mode = "idle";
    ring.mesh.visible = false;
    ring.mesh.material.opacity = 0;
    const i = activeTelegraphRings.indexOf(ring);
    if (i >= 0) activeTelegraphRings.splice(i, 1);
    telegraphRingPool.push(ring);
  }
  function updateTelegraphRings(dt) {
    for (let i = activeTelegraphRings.length - 1; i >= 0; i--) {
      const r = activeTelegraphRings[i];
      r.t += dt;
      r.life += dt;
      const wobble = r.pulse ? (0.78 + 0.22 * Math.sin(r.life * 13)) : 1;
      if (r.mode === "charge") {
        const k = Math.min(1, r.t / r.dur);
        r.mesh.material.opacity = r.peak * k * wobble;
        r.mesh.scale.setScalar(r.radius * (1 + (1 - k) * 0.14));
        if (k >= 1) { r.mode = "hold"; }
      } else if (r.mode === "hold") {
        r.mesh.material.opacity = r.peak * wobble;
        r.mesh.scale.setScalar(r.radius);
      } else if (r.mode === "detonate") {
        const k = Math.min(1, r.t / r.dur);
        r.mesh.material.opacity = r.peak * (1 - k) * 1.5;
        r.mesh.scale.setScalar(r.radius * (1 + k * 0.6));
        if (k >= 1) { releaseTelegraphRing(r); continue; }
      } else if (r.mode === "fade") {
        r.mesh.material.opacity = Math.max(0, r.mesh.material.opacity - dt * 2.4);
        if (r.mesh.material.opacity <= 0.005) { releaseTelegraphRing(r); continue; }
      }
      if (r.life > TELEGRAPH_MAX_LIFE) releaseTelegraphRing(r); // leak guard
    }
  }

  function warmLightningShaders() {
    const effects = [];
    for (let i = 0; i < LIGHTNING_POOL_SIZE; i++) {
      const effect = checkoutLightningEffect();
      effect.positions[0] = 900;
      effect.positions[1] = -900;
      effect.positions[2] = 900;
      effect.positions[3] = 901;
      effect.positions[4] = -900;
      effect.positions[5] = 900;
      effect.segmentCount = 1;
      effect.geometry.setDrawRange(0, 2);
      effect.geometry.attributes.position.needsUpdate = true;
      effect.core.material.opacity     = 1;
      effect.glow.material.opacity     = 0.58;
      effect.glowDots.material.opacity = 0.5;
      effect.ring.material.opacity     = 0.34;
      effect.ring.position.set(900, -900, 900);
      effect.sourceRing.material.opacity = 0.24;
      effect.sourceRing.position.set(900, -900, 900);
      effects.push(effect);
    }
    compileSceneForCurrentRenderer();
    for (const effect of effects) {
      effect.core.material.opacity     = 0;
      effect.glow.material.opacity     = 0;
      effect.glowDots.material.opacity = 0;
      effect.ring.material.opacity     = 0;
      recycleLightningEffect(effect);
    }
  }

  function checkoutBulletHole() {
    if (bulletHolePool.length) {
      const hole = bulletHolePool.pop();
      hole.mesh.visible = true;
      return hole;
    }
    const mesh = new THREE.Mesh(bulletHoleGeometry, bulletHoleMaterial.clone());
    mesh.visible = true;
    scene.add(mesh);
    return { mesh, life: 0, maxLife: 0, surface: "wall", baseScale: 0.27 };
  }

  function recycleBulletHole(hole) {
    hole.mesh.visible = false;
    bulletHolePool.push(hole);
  }

  function getHitWorldNormal(hit, target = new THREE.Vector3()) {
    if (!hit) return target.set(0, 1, 0);
    if (hit.object?.isMesh || hit.object?.isInstancedMesh) {
      if (hit.face?.normal) {
        target.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
        return target;
      }
    }
    return target.set(0, 1, 0);
  }

  function getShotSurfaceHit(floorMesh) {
    raycastHitsTmp.length = 0;
    raycastFloorHitsTmp.length = 0;
    raycaster.intersectObjects(wallMeshes, false, raycastHitsTmp);
    if (floorMesh) raycaster.intersectObject(floorMesh, false, raycastFloorHitsTmp);
    const wallHit = raycastHitsTmp[0] || null;
    const floorHit = raycastFloorHitsTmp[0] || null;
    if (wallHit && floorHit) return wallHit.distance <= floorHit.distance ? wallHit : floorHit;
    return wallHit || floorHit;
  }

  function getActiveWeaponForShot() {
    return shouldUseThirdPersonWeapon() ? thirdPerson.weapon : weapon;
  }

  function shouldUseThirdPersonWeapon() {
    return Boolean(thirdPerson.enabled && thirdPerson.ready && thirdPerson.weapon?.muzzle && !shouldUseFirstPersonAdsView());
  }

  function shouldUseFirstPersonAdsView() {
    // First-person is removed: aiming stays in the third-person over-shoulder view.
    if (THIRD_PERSON_ONLY) return false;
    return Boolean(thirdPerson.enabled && (mouse.aiming || viewState.ads > 0.02));
  }

  // True when the unified body should render as the first-person view: flag on,
  // model ready, third-person camera NOT engaged (we're in FP), and not in the
  // legacy TP-ADS floating-viewmodel swap. In this state the eye camera sits at the
  // body's head, so the head bone is hidden and the floating viewmodel is suppressed.
  function unifiedFirstPersonBodyActive() {
    return Boolean(UNIFIED_FIRST_PERSON && thirdPerson.ready && !thirdPerson.enabled && !shouldUseFirstPersonAdsView());
  }

  function getMuzzleFlashLocalX() {
    return currentGun === GUNS.SHOTGUN ? 0.15 : currentGun === GUNS.SNIPER ? 0.16 : 0.14;
  }

  function alignWeaponMuzzleFlash(rig) {
    if (!rig?.flash) return;
    rig.flash.position.set(getMuzzleFlashLocalX(), 0, 0);
    const muzzle = rig.muzzle;
    if (!muzzle?.userData) return;
    if (muzzle.userData.flashCone) muzzle.userData.flashCone.position.copy(rig.flash.position);
    if (muzzle.userData.flashGlow) muzzle.userData.flashGlow.position.copy(rig.flash.position);
    if (muzzle.userData.flash3d) muzzle.userData.flash3d.position.copy(rig.flash.position);
  }

  function getActiveMuzzleWorld(target, pelletIndex = 0) {
    const activeWeapon = getActiveWeaponForShot();
    alignWeaponMuzzleFlash(activeWeapon);
    const muzzle = activeWeapon?.muzzle || weapon?.muzzle || null;
    const flash = activeWeapon?.flash || weapon?.flash || null;
    if (flash) {
      flash.getWorldPosition(target);
      return target;
    }
    const barrelTips = muzzle?.userData?.barrelTips;
    if (muzzle && barrelTips?.length) {
      target.copy(barrelTips[pelletIndex % barrelTips.length]);
      muzzle.localToWorld(target);
    } else {
      const source = muzzle || weapon?.muzzle;
      if (source) source.getWorldPosition(target);
      else camera.getWorldPosition(target);
    }
    return target;
  }

  function getActiveMuzzleDirectionWorld(target) {
    const activeWeapon = getActiveWeaponForShot();
    alignWeaponMuzzleFlash(activeWeapon);
    const source = activeWeapon?.muzzle || activeWeapon?.flash || weapon?.muzzle || weapon?.flash || camera;
    source.updateWorldMatrix?.(true, false);
    return target.set(1, 0, 0).transformDirection(source.matrixWorld).normalize();
  }

  function getAimCursorDirectionWorld(target, offsetX = 0, offsetY = 0) {
    camera.getWorldDirection(target);
    shotMuzzleRightTmp.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    shotMuzzleUpTmp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    return target
      .addScaledVector(shotMuzzleRightTmp, offsetX)
      .addScaledVector(shotMuzzleUpTmp, offsetY)
      .normalize();
  }

  function applyMuzzleSpread(direction, offsetX, offsetY) {
    shotMuzzleRightTmp.crossVectors(direction, tracerUp);
    if (shotMuzzleRightTmp.lengthSq() < 0.0001) shotMuzzleRightTmp.set(1, 0, 0);
    else shotMuzzleRightTmp.normalize();
    shotMuzzleUpTmp.crossVectors(shotMuzzleRightTmp, direction).normalize();
    direction
      .addScaledVector(shotMuzzleRightTmp, offsetX)
      .addScaledVector(shotMuzzleUpTmp, offsetY)
      .normalize();
    return direction;
  }

  function getAimCursorOffset(target = fireAnglesTmp) {
    return target.set(
      crosshair.recoilX / Math.max(1, window.innerWidth * 0.5),
      -crosshair.recoilY / Math.max(1, window.innerHeight * 0.5)
    );
  }

  function getPelletSpreadOffset(gunType, pelletIndex, pelletCount, spread, target) {
    if (spread <= 0) return target.set(0, 0);

    if (gunType === GUNS.SHOTGUN) {
      const p = SHOTGUN_PELLET_PATTERN[pelletIndex % SHOTGUN_PELLET_PATTERN.length];
      const jitter = pelletIndex === 0 ? 0.08 : 0.26;
      return target.set(
        (p[0] + (Math.random() - 0.5) * jitter) * spread,
        (p[1] + (Math.random() - 0.5) * jitter) * spread
      );
    }

    const radius = Math.sqrt(Math.random()) * spread;
    const theta = Math.random() * Math.PI * 2;
    return target.set(Math.cos(theta) * radius, Math.sin(theta) * radius);
  }

  function spawnBulletHole(pos, normal, gunType: GunType = GUNS.RIFLE) {
    if (activeBulletHoles.length >= MAX_ACTIVE_BULLET_HOLES) {
      recycleBulletHole(activeBulletHoles.shift());
    }

    const hole = checkoutBulletHole();
    const size = gunType === GUNS.SHOTGUN ? 0.34 : gunType === GUNS.SNIPER ? 0.3 : 0.27;
    const normalDir = bulletHoleNormalTmp.copy(normal).normalize();
    hole.mesh.position.copy(pos).addScaledVector(normalDir, 0.016);
    hole.mesh.quaternion.setFromUnitVectors(bulletHoleUp, normalDir);
    hole.mesh.rotateZ(Math.random() * Math.PI * 2);
    hole.baseScale = size * (0.9 + Math.random() * 0.22);
    hole.mesh.scale.setScalar(hole.baseScale);
    hole.mesh.material.opacity = 0.95;
    hole.life = 18;
    hole.maxLife = 18;
    hole.surface = Math.abs(normalDir.y) > 0.7 ? "floor" : "wall";
    activeBulletHoles.push(hole);
  }

  function updateBulletHoles(dt) {
    for (let i = activeBulletHoles.length - 1; i >= 0; i--) {
      const hole = activeBulletHoles[i];
      hole.life -= dt;
      if (hole.life <= 0) {
        activeBulletHoles.splice(i, 1);
        recycleBulletHole(hole);
        continue;
      }
      const fade = Math.max(0, hole.life / hole.maxLife);
      hole.mesh.material.opacity = fade * 0.92;
      const pulse = 1 - (1 - fade) * 0.06;
      hole.mesh.scale.setScalar(hole.baseScale * pulse);
    }
  }

  const webgpuMaterialFallbackCache = new WeakMap();
  let webgpuMaterialSanitizeNextRender = rendererBackend === "webgpu";
  let webgpuMaterialSanitizeWarnings = 0;

  function isWebGPUUnsafeShaderMaterial(material) {
    return !!material && (material.isShaderMaterial || material.isRawShaderMaterial || material.type === "ShaderMaterial" || material.type === "RawShaderMaterial");
  }

  function makeWebGPUSafeFallbackMaterial(material, owner) {
    if (webgpuMaterialFallbackCache.has(material)) return webgpuMaterialFallbackCache.get(material);

    const baseOptions = {
      name: `${material.name || material.type || "shader"}_webgpu_fallback`,
      color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
      map: material.map || null,
      alphaMap: material.alphaMap || null,
      transparent: material.transparent === true || (material.opacity ?? 1) < 1 || !!material.alphaMap,
      opacity: material.opacity ?? 1,
      side: material.side ?? THREE.FrontSide,
      blending: material.blending ?? THREE.NormalBlending,
      depthWrite: material.depthWrite ?? true,
      depthTest: material.depthTest ?? true,
      fog: material.fog ?? false,
      vertexColors: material.vertexColors === true,
    };

    let fallback;
    if (owner?.isLine || owner?.isLineSegments || owner?.isLineLoop) {
      fallback = new THREE.LineBasicMaterial(baseOptions);
    } else if (owner?.isPoints) {
      fallback = new THREE.PointsMaterial({
        ...baseOptions,
        size: material.size ?? 0.08,
        sizeAttenuation: material.sizeAttenuation ?? true,
      });
    } else if (owner?.isSprite) {
      fallback = new THREE.SpriteMaterial(baseOptions);
    } else {
      fallback = new THREE.MeshBasicMaterial(baseOptions);
    }

    fallback.toneMapped = material.toneMapped ?? false;
    fallback.needsUpdate = true;
    webgpuMaterialFallbackCache.set(material, fallback);
    return fallback;
  }

  function sanitizeWebGPUMaterials(root: any = scene) {
    if (rendererBackend !== "webgpu" || !root?.traverse) return 0;
    let replaced = 0;
    root.traverse(obj => {
      const material = obj.material;
      if (!material) return;
      if (Array.isArray(material)) {
        let changed = false;
        const safeMaterials = material.map(mat => {
          if (!isWebGPUUnsafeShaderMaterial(mat)) return mat;
          changed = true;
          replaced++;
          return makeWebGPUSafeFallbackMaterial(mat, obj);
        });
        if (changed) obj.material = safeMaterials;
      } else if (isWebGPUUnsafeShaderMaterial(material)) {
        obj.material = makeWebGPUSafeFallbackMaterial(material, obj);
        replaced++;
      }
    });

    if (replaced && webgpuMaterialSanitizeWarnings < 4) {
      webgpuMaterialSanitizeWarnings++;
      console.warn(`Converted ${replaced} ShaderMaterial instance(s) to WebGPU-safe fallback materials.`);
    }
    return replaced;
  }

  function compileSceneForCurrentRenderer() {
    sanitizeWebGPUMaterials(scene);
    webgpuMaterialSanitizeNextRender = false;
    renderer.compile?.(scene, camera);
  }

  // Full-coverage shader warm. Programs must be linked before we are drawing frames:
  // a link that starts at draw time blocks the main thread while the driver finishes it,
  // and starting a mission used to trigger dozens of those back to back.
  //
  // renderer.compile() walks the whole scene graph (not just visible objects), so it
  // covers almost everything — except objects that are not IN the graph at all. The
  // pooled enemies sit detached in their pools, so splice them in for the compile.
  //
  // Anything else that changes the program cache key later (most importantly the count
  // of visible lights, which three bakes into every shader) will invalidate all of this,
  // so keep that count fixed — see getSharedLightningLight and __rbCountLights.
  function compileAllWarmables() {
    const attached = [];
    for (const pool of Object.values(enemyPools)) {
      for (const enemy of pool) {
        const mesh = enemy?.mesh;
        if (!mesh || mesh.parent) continue;
        scene.add(mesh);
        attached.push(mesh);
      }
    }

    sanitizeWebGPUMaterials(scene);
    webgpuMaterialSanitizeNextRender = false;
    try {
      renderer.compile?.(scene, camera);
    } finally {
      for (const mesh of attached) scene.remove(mesh);
    }
  }

  function prewarmEffectPools() {
    for (let i = 0; i < MAX_ACTIVE_IMPACT_PARTICLES; i++) {
      const mesh = new THREE.Mesh(impactGeometry, impactMaterials[0]);
      mesh.visible = false;
      scene.add(mesh);
      impactParticlePool.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 0 });
    }

    for (const gunType of Object.values(GUNS)) {
      const count = gunType === GUNS.SHOTGUN ? 10 : 5;
      for (let i = 0; i < count; i++) {
        const line = new THREE.Mesh(tracerGeometry, tracerMaterials[gunType]);
        line.visible = false;
        line.renderOrder = 8;
        scene.add(line);
        tracerPool[gunType].push({ line, life: 0, maxLife: 0, baseOpacity: gunType === GUNS.SNIPER ? 0.13 : gunType === GUNS.SHOTGUN ? 0.08 : 0.10, gunType });
      }
    }

    for (let i = 0; i < MAX_ACTIVE_BULLET_HOLES; i++) {
      const mesh = new THREE.Mesh(bulletHoleGeometry, bulletHoleMaterial.clone());
      mesh.visible = false;
      scene.add(mesh);
      bulletHolePool.push({ mesh, life: 0, maxLife: 0, surface: "wall", baseScale: 0.27 });
    }

    for (let i = 0; i < LIGHTNING_POOL_SIZE; i++) {
      lightningPool.push(createLightningEffect());
    }
  }

  prewarmEffectPools();

  applyRenderScale();

  setupEnvironmentLighting(THREE, scene, renderer);
  const environmentLights = [];
  const environmentLightSet = new Set();
  const environmentSurfaceLightMaps = [];

  function refreshEnvironmentLightRegistry() {
    let added = 0;
    for (const obj of scene.children) {
      if (!obj.isLight || !obj.userData?.environmentLight || environmentLightSet.has(obj)) continue;
      environmentLightSet.add(obj);
      environmentLights.push({ light: obj, intensity: obj.intensity });
      added++;
    }
    const surfaces = scene.userData.environmentSurfaces;
    for (const material of [surfaces?.floorMat, surfaces?.ceilMat]) {
      if (!material?.lightMap || material.userData.environmentLightMapRegistered) continue;
      material.userData.environmentLightMapRegistered = true;
      environmentSurfaceLightMaps.push({ material, intensity: material.lightMapIntensity ?? 1 });
      added++;
    }
    return added;
  }

  function applyWaveLighting(wave, announce = false) {
    const addedLights = refreshEnvironmentLightRegistry();
    const shouldDarken = wave > 0 && wave % 10 === 0;
    if (darkWaveActive === shouldDarken && addedLights === 0) return;
    darkWaveActive = shouldDarken;

    for (const entry of environmentLights) {
      entry.light.intensity = shouldDarken ? 0 : entry.intensity;
    }
    for (const entry of environmentSurfaceLightMaps) {
      entry.material.lightMapIntensity = shouldDarken ? 0 : entry.intensity;
      entry.material.needsUpdate = true;
    }
    // Golden hour: thin haze + HDR sky. BLACKOUT waves kill the sky entirely —
    // the dome mesh is hidden (pure visibility toggle on a mesh, so no shader
    // relink — see the light-count invariant) and the clear colour + fog go black.
    if (scene.fog) {
      (scene.fog as any).density = shouldDarken ? 0.011 : 0.0042;
      scene.fog.color.setHex(shouldDarken ? 0x05060a : 0xd8c4a8);
    }
    const skyDome = scene.getObjectByName("DaySkyDome");
    if (skyDome) skyDome.visible = !shouldDarken;
    // Blackout wave: the sky isn't just dark, it's ON FIRE — a distant burning
    // horizon (built lazily on first blackout, animated for free while visible —
    // see buildFireSkyDome's onBeforeRender).
    if (shouldDarken) buildFireSkyDome();
    const fireDome = scene.getObjectByName("FireSkyDome");
    if (fireDome) fireDome.visible = shouldDarken;
    // The distant-skyline silhouette ring is unlit — during a blackout it is a solid
    // black wall that buries the burning horizon AND the fiery sun disc (its rooftops
    // subtend up to ~25° of elevation). Hide it while the world burns; the fire dome
    // reads as the city skyline instead. (Mesh visibility toggle — fine; only LIGHT
    // visibility is locked by the shader-cache invariant.)
    const skyline = scene.getObjectByName("DistantSkyline");
    if (skyline) skyline.visible = !shouldDarken;
    if (scene.background && (scene.background as any).isColor) (scene.background as any).setHex(shouldDarken ? 0x000000 : 0xd8c2a4);
    scene.environmentIntensity = shouldDarken ? 0.10 : 0.58; // starve the IBL so the dark reads
    // No sky = no sun. Drop the exterior key/fill so the world goes truly dark
    // instead of "daylight under a black ceiling" (intensity change only — never
    // visibility, per the light-count shader-cache invariant).
    const extSun = window.__extSun;
    if (extSun) {
      // Blackout: the ONLY sky light is the burning horizon, so the key light must
      // come exactly FROM the fiery sun rendered by the fire dome. Same canonical
      // direction (BLACKOUT_SUN_DIR) feeds the dome's uSunDir uniform and this
      // placement, measured from the light's target. Intensity 0.32 (was 0.10) so
      // the fire-sun direction visibly reads as rim light + shadows in the world.
      // Color + position + intensity changes only (never visibility, per the
      // light-count shader-cache invariant).
      extSun.intensity = (extSun.userData.baseIntensity ?? extSun.intensity) * (shouldDarken ? 0.32 : 1);
      if (!extSun.userData.baseColorHex) extSun.userData.baseColorHex = extSun.color.getHex();
      if (!extSun.userData.basePosition) extSun.userData.basePosition = extSun.position.clone();
      if (shouldDarken) {
        extSun.color.setHex(0xff4a1e);
        const t = extSun.target.position;
        extSun.position.set(
          t.x + BLACKOUT_SUN_DIR.x * 260,
          t.y + BLACKOUT_SUN_DIR.y * 260,
          t.z + BLACKOUT_SUN_DIR.z * 260
        );
      } else {
        extSun.color.setHex(extSun.userData.baseColorHex);
        extSun.position.copy(extSun.userData.basePosition);
      }
      // Sun moved → refit the shadow frustum to the world from the new angle and
      // re-render the shadow map (needed on the low-end static-bake path; harmless
      // when shadowMap.autoUpdate is on).
      window.__extFitSunShadow?.();
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
    }
    const extHemi = window.__extHemi;
    if (extHemi) {
      extHemi.intensity = (extHemi.userData.baseIntensity ?? extHemi.intensity) * (shouldDarken ? 0.18 : 1);
      if (!extHemi.userData.baseSkyHex) {
        extHemi.userData.baseSkyHex = extHemi.color.getHex();
        extHemi.userData.baseGroundHex = extHemi.groundColor.getHex();
      }
      if (shouldDarken) {
        extHemi.color.setHex(0x7a2410);      // smoke-red sky bounce
        extHemi.groundColor.setHex(0x140806); // scorched ground
      } else {
        extHemi.color.setHex(extHemi.userData.baseSkyHex);
        extHemi.groundColor.setHex(extHemi.userData.baseGroundHex);
      }
    }
    if (announce) addKillFeed(shouldDarken ? "BLACKOUT WAVE - CEILING LIGHTS OFF" : "ENVIRONMENT LIGHTS RESTORED");
  }
  refreshEnvironmentLightRegistry();
  // (Removed: a stray `dirLight.shadow.mapSize.set(512,512)` on the first
  // DirectionalLight found. It hit the interior ceiling-fill light — which doesn't
  // cast — so it did nothing useful, and it was a trap waiting to clobber a real
  // shadow caster's resolution if scene-children order ever changed.)
  if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;

  // Flashlight: exact copy of gunFlash — same PointLight type, same camera-child parent,
  // same position, distance, decay. Only difference: white color + higher intensity.
  // Critically: do NOT toggle .visible (gunFlash never does — intensity=0 is how it turns off).
  // Long throw: distance 90 with gentle decay so the beam actually reaches across
  // rooms / down the street instead of pooling around the player (was 28 / 1.5).
  const flashlight = new THREE.PointLight(0xe8f4ff, 0, 90, 1.1);
  flashlight.position.set(0.12, -0.05, -0.45);
  flashlight.castShadow = false;
  flashlight.name = "PlayerFlashlightBeam";
  camera.add(flashlight);

  // Kept so existing references elsewhere compile — always off
  const flashlightFill = { intensity: 0, visible: false, distance: 0, decay: 0 };

  const lensGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  lensGlow.position.set(0, -0.03, 0.13);
  camera.add(lensGlow);

  // Slightly larger range and gentler decay so reflections light nearby surfaces better
  const gunFlash = new THREE.PointLight(0xffcc88, 0, 28, 1.5);
  gunFlash.position.set(0.12, -0.05, -0.45);
  camera.add(gunFlash);

  const lightingState: any = {
    flashlightOn: false,
    shootFlash: 0,
    lightningFlash: 0,
    droneGlow: 0,
  };


  function disablePlayerFlashlightRig() {
    // Never touch flashlight.visible. three keys its shader program cache on the
    // number of VISIBLE lights, so hiding this one light invalidates and relinks
    // every material in the scene. intensity=0 is the off switch — the same rule
    // gunFlash already follows.
    flashlight.intensity = 0;
    flashlightFill.visible = false;
    flashlightFill.intensity = 0;
    lensGlow.visible = false;
  }

  function addBox(parent, size, pos, mat, rot: any = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
    parent.add(mesh);
    return mesh;
  }

  function addCyl(parent, radiusTop, radiusBottom, height, segments, pos, rot, mat) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
    parent.add(mesh);
    return mesh;
  }

  function addRailTeeth(parent, count, startX, stepX, y, z, mat, size = { x: 0.028, y: 0.018, z: 0.072 }) {
    for (let i = 0; i < count; i++) {
      addBox(parent, size, { x: startX + i * stepX, y, z }, mat);
    }
  }

  function addAccentGlow(parent, length, pos, mat, side = 1) {
    const strip = addBox(parent, { x: length, y: 0.014, z: 0.012 }, pos, mat);
    strip.renderOrder = 3;
    const cap = addBox(parent, { x: 0.018, y: 0.018, z: 0.018 }, { x: pos.x + length * 0.5 * side, y: pos.y, z: pos.z }, mat);
    cap.renderOrder = 3;
    return strip;
  }

  // First-person gripping hands. Built as CHILDREN of the weapon `gun` group so they
  // are rigidly bolted to the gun: they inherit its pitch/yaw/bob/recoil/ADS transform
  // and its visibility, and can never float relative to it or detach on look up/down.
  // Only attached to the first-person viewmodel (parent === camera) — never third-person
  // or enemy/ghost weapons.
  function attachFirstPersonHands(gun, gunType) {
    // Black glossy tactical sleeves + dark gloves (WebGPU-safe MeshStandardMaterial only).
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0f, emissive: 0x040406, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.15 });
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x0d0e13, emissive: 0x050608, emissiveIntensity: 0.1, roughness: 0.62, metalness: 0.1 });
    const cuffMat = new THREE.MeshStandardMaterial({ color: 0x16171d, emissive: 0x070810, emissiveIntensity: 0.14, roughness: 0.44, metalness: 0.22 });

    // Canonical arm: grip contact at origin, fingertips toward +X, forearm/elbow toward -X.
    // Placement rotations then aim the forearm back-and-down toward the (single, centered) camera.
    function buildArm(side) {
      const arm = new THREE.Group();
      // Forearm sleeve (elbow -> wrist, laid along X)
      addCyl(arm, 0.05, 0.066, 0.3, 12, { x: -0.18, y: 0, z: 0 }, { z: Math.PI * 0.5 }, sleeveMat);
      // Glove cuff ring
      addCyl(arm, 0.07, 0.062, 0.05, 12, { x: -0.03, y: 0, z: 0 }, { z: Math.PI * 0.5 }, cuffMat);
      // Back of hand / palm block
      addBox(arm, { x: 0.12, y: 0.07, z: 0.115 }, { x: 0.045, y: 0, z: 0 }, gloveMat);
      // Knuckles + curled fingers wrapping down over the grip
      addBox(arm, { x: 0.115, y: 0.1, z: 0.06 }, { x: 0.07, y: -0.045, z: 0.045 }, gloveMat);
      // Fingertips returning underneath
      addBox(arm, { x: 0.1, y: 0.055, z: 0.05 }, { x: 0.06, y: -0.085, z: 0.005 }, gloveMat);
      // Thumb (wraps the opposite side; mirrored per hand)
      addBox(arm, { x: 0.05, y: 0.085, z: 0.045 }, { x: 0.055, y: -0.02, z: -0.06 * side }, gloveMat, { z: 0.3 });
      return arm;
    }

    // Per-gun grip offsets in gun-local space (+X = muzzle, +Y = up). Tune in playtest.
    const layout = {
      [GUNS.RIFLE]: {
        right: { pos: { x: -0.1, y: -0.25, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.55 } },
        left: { pos: { x: 0.36, y: -0.1, z: 0.0 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.SHOTGUN]: {
        right: { pos: { x: -0.06, y: -0.24, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.55 } },
        left: { pos: { x: 0.36, y: -0.13, z: 0.0 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.SNIPER]: {
        right: { pos: { x: -0.1, y: -0.2, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.5 } },
        left: { pos: { x: 0.12, y: -0.12, z: 0.0 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.PISTOL]: {
        right: { pos: { x: -0.08, y: -0.22, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.55 } },
        left: { pos: { x: 0.0, y: -0.26, z: 0.04 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.SMG]: {
        right: { pos: { x: -0.08, y: -0.24, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.55 } },
        left: { pos: { x: 0.22, y: -0.12, z: 0.0 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.LMG]: {
        right: { pos: { x: -0.12, y: -0.26, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.55 } },
        left: { pos: { x: 0.4, y: -0.14, z: 0.0 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.DMR]: {
        right: { pos: { x: -0.1, y: -0.22, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.5 } },
        left: { pos: { x: 0.3, y: -0.12, z: 0.0 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.AKIMBO]: {
        right: { pos: { x: -0.08, y: -0.22, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.55 } },
        left: { pos: { x: 0.02, y: -0.24, z: 0.04 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.RAILGUN]: {
        right: { pos: { x: -0.1, y: -0.24, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.5 } },
        left: { pos: { x: 0.34, y: -0.14, z: 0.0 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
      [GUNS.FLAK]: {
        right: { pos: { x: -0.08, y: -0.24, z: 0.02 }, rot: { x: 0.15, y: -0.25, z: 0.55 } },
        left: { pos: { x: 0.34, y: -0.12, z: 0.0 }, rot: { x: -0.15, y: 0.25, z: 0.5 } },
      },
    };
    const cfg = layout[gunType] || layout[GUNS.RIFLE];

    const right = buildArm(1);
    right.position.set(cfg.right.pos.x, cfg.right.pos.y, cfg.right.pos.z);
    right.rotation.set(cfg.right.rot.x, cfg.right.rot.y, cfg.right.rot.z);
    gun.add(right);

    const left = buildArm(-1);
    left.position.set(cfg.left.pos.x, cfg.left.pos.y, cfg.left.pos.z);
    left.rotation.set(cfg.left.rot.x, cfg.left.rot.y, cfg.left.rot.z);
    gun.add(left);

    gun.userData.fpHands = { left, right };
  }

  function createWeaponViewModel(gunType: GunType = GUNS.RIFLE, parent: any = camera) {
    const gun = new THREE.Group();
    parent.add(gun);
    const firstPersonModel = parent === camera;
    gun.position.set(firstPersonModel ? 0.08 : 0.0, firstPersonModel ? -0.32 : -0.28, firstPersonModel ? -0.76 : -0.62);
    gun.rotation.y = Math.PI * 0.5;
    if (firstPersonModel) gun.scale.setScalar(0.76);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x29374a, emissive: 0x0d1726, emissiveIntensity: 0.36, roughness: 0.35, metalness: 0.72 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x121822, emissive: 0x05080f, emissiveIntensity: 0.2, roughness: 0.62, metalness: 0.34 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x62d8ff, emissive: 0x236d92, emissiveIntensity: 0.46, roughness: 0.22, metalness: 0.78 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, emissive: 0x26160c, emissiveIntensity: 0.16, roughness: 0.7, metalness: 0.1 });
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x070a0f, emissive: 0x010205, emissiveIntensity: 0.12, roughness: 0.82, metalness: 0.08 });
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x183246, emissive: 0x2ca8d8, emissiveIntensity: 0.26, roughness: 0.18, metalness: 0.04 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc58f42, emissive: 0x1c1000, emissiveIntensity: 0.16, roughness: 0.34, metalness: 0.72 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8fa8bf, emissive: 0x122435, emissiveIntensity: 0.2, roughness: 0.24, metalness: 0.86 });
    const warningMat = new THREE.MeshStandardMaterial({ color: 0xff8a36, emissive: 0xa43e12, emissiveIntensity: 0.62, roughness: 0.28, metalness: 0.42 });

    // Pack-a-Punch: tag the metal materials so they can take on the upgrade glow.
    // Each viewmodel owns its own material instances, so tinting is per-gun.
    gun.userData.packMats = [bodyMat, accentMat, edgeMat, brassMat];
    for (const m of gun.userData.packMats) {
      m.userData.baseEmissive = m.emissive.getHex();
      m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      m.userData.baseMetalness = m.metalness;
      m.userData.baseRoughness = m.roughness;
    }

    // Shared muzzle rig builder for the mystery-box roster (same sprite/cone/glow
    // pattern as the three original guns — no lights, additive sprites only).
    function buildMuzzleRig(mx, my, color, flashScale, coneR, coneLen, glowR, tips?) {
      const muzzle = new THREE.Object3D();
      muzzle.intensity = 0;
      muzzle.position.set(mx, my, 0);
      gun.add(muzzle);
      const flash = createMuzzleFlash(color, flashScale);
      flash.position.set(0.12, 0.0, 0.0);
      muzzle.add(flash);
      const coneMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 0, roughness: 0.12, metalness: 0, transparent: true, toneMapped: false });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneLen, 10), coneMat);
      cone.rotation.z = -Math.PI * 0.5;
      cone.position.copy(flash.position);
      cone.visible = false;
      muzzle.add(cone);
      const glowMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.08, metalness: 0.0, transparent: true });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(glowR, 8, 6), glowMat);
      glow.position.copy(flash.position);
      glow.visible = false;
      muzzle.add(glow);
      const flash3d = createPhysicalMuzzleFlash(color, 0.26, coneR * 1.05, glowR * 1.05);
      flash3d.position.copy(flash.position);
      muzzle.add(flash3d);
      muzzle.userData.flashCone = cone;
      muzzle.userData.flashGlow = glow;
      muzzle.userData.flash3d = flash3d;
      muzzle.userData.barrelTips = tips || [new THREE.Vector3(0.14, 0.0, 0.0)];
      return { muzzle, flash };
    }

    if (gunType === GUNS.PISTOL) {
      // ── Service Pistol — compact slide-over-frame silhouette ─────────────────
      const receiver = addBox(gun, { x: 0.34, y: 0.11, z: 0.1 }, { x: 0.05, y: 0.03, z: 0 }, bodyMat); // slide
      const slide = addBox(gun, { x: 0.3, y: 0.035, z: 0.104 }, { x: 0.05, y: 0.095, z: 0 }, darkMat); // slide top serrations
      for (let i = 0; i < 4; i++) addBox(gun, { x: 0.01, y: 0.05, z: 0.106 }, { x: -0.06 + i * 0.03, y: 0.05, z: 0 }, edgeMat);
      addBox(gun, { x: 0.3, y: 0.06, z: 0.09 }, { x: 0.04, y: -0.04, z: 0 }, darkMat); // frame
      addCyl(gun, 0.02, 0.02, 0.12, 8, { x: 0.26, y: 0.03, z: 0 }, { z: Math.PI * 0.5 }, darkMat); // barrel stub
      addBox(gun, { x: 0.09, y: 0.02, z: 0.05 }, { x: 0.14, y: -0.085, z: 0 }, accentMat); // rail
      const mag = addBox(gun, { x: 0.07, y: 0.2, z: 0.075 }, { x: -0.07, y: -0.17, z: 0 }, darkMat, { z: -0.16 }); // grip/mag
      addBox(gun, { x: 0.075, y: 0.03, z: 0.082 }, { x: -0.095, y: -0.27, z: 0 }, brassMat, { z: -0.16 }); // baseplate
      const trigger = addBox(gun, { x: 0.012, y: 0.045, z: 0.012 }, { x: 0.045, y: -0.085, z: 0 }, accentMat);
      addBox(gun, { x: 0.1, y: 0.04, z: 0.012 }, { x: 0.05, y: -0.075, z: 0.045 }, darkMat, { z: 0.12 }); // trigger guard
      addBox(gun, { x: 0.02, y: 0.03, z: 0.012 }, { x: 0.19, y: 0.11, z: 0 }, accentMat); // front sight
      addBox(gun, { x: 0.02, y: 0.028, z: 0.05 }, { x: -0.1, y: 0.11, z: 0 }, darkMat); // rear sight
      const chamberGlow = addBox(gun, { x: 0.06, y: 0.012, z: 0.012 }, { x: 0.1, y: 0.075, z: -0.054 }, warningMat);
      chamberGlow.visible = false;
      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.PISTOL);
      const { muzzle, flash } = buildMuzzleRig(0.36, 0.045, 0xffcf7a, 0.3, 0.05, 0.16, 0.034);
      return { gun, muzzle, flash, slide, mag, receiver, animParts: { trigger, chamberGlow } };
    }

    if (gunType === GUNS.SMG) {
      // ── Hornet SMG — stubby body, side-folded stock, long straight mag ──────
      const receiver = addBox(gun, { x: 0.42, y: 0.15, z: 0.13 }, { x: 0.04, y: 0.0, z: 0 }, bodyMat);
      addBox(gun, { x: 0.38, y: 0.024, z: 0.06 }, { x: 0.04, y: 0.085, z: 0 }, darkMat); // top rail
      addRailTeeth(gun, 8, -0.12, 0.05, 0.098, 0, edgeMat, { x: 0.024, y: 0.02, z: 0.07 });
      addBox(gun, { x: 0.2, y: 0.1, z: 0.13 }, { x: 0.32, y: -0.005, z: 0 }, rubberMat); // stub handguard
      addAccentGlow(gun, 0.18, { x: 0.32, y: 0.04, z: 0.078 }, accentMat);
      addAccentGlow(gun, 0.18, { x: 0.32, y: 0.04, z: -0.078 }, accentMat);
      addCyl(gun, 0.024, 0.024, 0.26, 10, { x: 0.5, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, darkMat); // short barrel
      addCyl(gun, 0.036, 0.036, 0.14, 10, { x: 0.56, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, accentMat); // suppressor can
      addBox(gun, { x: 0.085, y: 0.24, z: 0.12 }, { x: -0.1, y: -0.2, z: 0 }, rubberMat, { z: -0.18 }); // grip
      const mag = addBox(gun, { x: 0.075, y: 0.32, z: 0.06 }, { x: 0.1, y: -0.24, z: 0 }, darkMat, { z: -0.04 }); // long stick mag
      addBox(gun, { x: 0.08, y: 0.026, z: 0.068 }, { x: 0.1, y: -0.4, z: 0 }, accentMat, { z: -0.04 });
      const trigger = addBox(gun, { x: 0.012, y: 0.05, z: 0.012 }, { x: 0.02, y: -0.11, z: 0 }, accentMat);
      addBox(gun, { x: 0.11, y: 0.045, z: 0.012 }, { x: 0.03, y: -0.09, z: 0.045 }, darkMat, { z: 0.12 });
      // Folded wire stock along the left side
      addBox(gun, { x: 0.34, y: 0.02, z: 0.02 }, { x: -0.22, y: 0.03, z: 0.08 }, edgeMat);
      addBox(gun, { x: 0.02, y: 0.1, z: 0.02 }, { x: -0.38, y: -0.02, z: 0.08 }, edgeMat);
      const slide = addBox(gun, { x: 0.05, y: 0.024, z: 0.05 }, { x: -0.05, y: 0.055, z: -0.08 }, darkMat); // charging handle
      const chamberGlow = addBox(gun, { x: 0.07, y: 0.012, z: 0.012 }, { x: 0.12, y: 0.07, z: -0.068 }, warningMat);
      chamberGlow.visible = false;
      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.SMG);
      const { muzzle, flash } = buildMuzzleRig(0.66, 0.02, 0xffc86a, 0.3, 0.05, 0.18, 0.036);
      return { gun, muzzle, flash, slide, mag, receiver, animParts: { trigger, chamberGlow } };
    }

    if (gunType === GUNS.LMG) {
      // ── Bastion LMG — heavy receiver, drum, thick barrel + carry handle ─────
      const receiver = addBox(gun, { x: 0.62, y: 0.2, z: 0.18 }, { x: 0.0, y: 0.0, z: 0 }, bodyMat);
      addBox(gun, { x: 0.5, y: 0.026, z: 0.07 }, { x: 0.0, y: 0.115, z: 0 }, darkMat); // top rail
      addRailTeeth(gun, 10, -0.2, 0.06, 0.128, 0, edgeMat, { x: 0.028, y: 0.022, z: 0.08 });
      addBox(gun, { x: 0.2, y: 0.05, z: 0.03 }, { x: -0.05, y: 0.18, z: 0 }, darkMat); // carry handle
      addBox(gun, { x: 0.02, y: 0.05, z: 0.03 }, { x: -0.15, y: 0.15, z: 0 }, darkMat);
      addBox(gun, { x: 0.02, y: 0.05, z: 0.03 }, { x: 0.05, y: 0.15, z: 0 }, darkMat);
      addBox(gun, { x: 0.34, y: 0.12, z: 0.16 }, { x: 0.42, y: 0.0, z: 0 }, darkMat); // handguard
      for (let i = 0; i < 4; i++) addBox(gun, { x: 0.03, y: 0.13, z: 0.014 }, { x: 0.32 + i * 0.08, y: 0.0, z: 0.086 }, edgeMat);
      addCyl(gun, 0.036, 0.036, 0.6, 10, { x: 0.78, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, darkMat); // thick barrel
      addCyl(gun, 0.052, 0.046, 0.1, 10, { x: 1.06, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, accentMat); // brake
      const mag = addCyl(gun, 0.13, 0.13, 0.09, 14, { x: 0.05, y: -0.19, z: 0 }, { x: Math.PI * 0.5 }, darkMat); // drum
      addCyl(gun, 0.09, 0.09, 0.096, 14, { x: 0.05, y: -0.19, z: 0 }, { x: Math.PI * 0.5 }, brassMat);
      addBox(gun, { x: 0.09, y: 0.26, z: 0.13 }, { x: -0.24, y: -0.2, z: 0 }, rubberMat, { z: -0.2 }); // grip
      const trigger = addBox(gun, { x: 0.013, y: 0.055, z: 0.013 }, { x: -0.13, y: -0.12, z: 0 }, accentMat);
      addBox(gun, { x: 0.26, y: 0.09, z: 0.14 }, { x: -0.48, y: 0.0, z: 0 }, bodyMat); // stock
      addBox(gun, { x: 0.07, y: 0.17, z: 0.13 }, { x: -0.62, y: -0.02, z: 0 }, rubberMat); // pad
      // Folded bipod
      addBox(gun, { x: 0.01, y: 0.2, z: 0.01 }, { x: 0.72, y: -0.1, z: 0.05 }, darkMat, { z: 0.28 });
      addBox(gun, { x: 0.01, y: 0.2, z: 0.01 }, { x: 0.72, y: -0.1, z: -0.05 }, darkMat, { z: -0.28 });
      const slide = addBox(gun, { x: 0.06, y: 0.026, z: 0.08 }, { x: -0.1, y: 0.06, z: -0.11 }, darkMat);
      const chamberGlow = addBox(gun, { x: 0.09, y: 0.012, z: 0.014 }, { x: 0.14, y: 0.09, z: -0.094 }, warningMat);
      chamberGlow.visible = false;
      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.LMG);
      const { muzzle, flash } = buildMuzzleRig(1.13, 0.02, 0xffc06a, 0.4, 0.07, 0.22, 0.05);
      return { gun, muzzle, flash, slide, mag, receiver, animParts: { trigger, chamberGlow } };
    }

    if (gunType === GUNS.DMR) {
      // ── Verdict DMR — long slab receiver, mid scope, skeleton stock ─────────
      const receiver = addBox(gun, { x: 0.6, y: 0.15, z: 0.14 }, { x: 0.05, y: 0.0, z: 0 }, bodyMat);
      addRailTeeth(gun, 11, -0.16, 0.05, 0.088, 0, edgeMat, { x: 0.026, y: 0.018, z: 0.07 });
      addBox(gun, { x: 0.34, y: 0.1, z: 0.13 }, { x: 0.45, y: -0.005, z: 0 }, darkMat); // handguard
      addAccentGlow(gun, 0.3, { x: 0.45, y: 0.045, z: 0.078 }, accentMat);
      addAccentGlow(gun, 0.3, { x: 0.45, y: 0.045, z: -0.078 }, accentMat);
      addCyl(gun, 0.024, 0.024, 0.6, 10, { x: 0.83, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, darkMat); // barrel
      addCyl(gun, 0.036, 0.032, 0.09, 10, { x: 1.11, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, accentMat); // brake
      const mag = addBox(gun, { x: 0.085, y: 0.2, z: 0.065 }, { x: 0.1, y: -0.17, z: 0 }, darkMat, { z: -0.08 });
      addBox(gun, { x: 0.09, y: 0.025, z: 0.072 }, { x: 0.1, y: -0.275, z: 0 }, brassMat, { z: -0.08 });
      addBox(gun, { x: 0.085, y: 0.24, z: 0.12 }, { x: -0.12, y: -0.18, z: 0 }, rubberMat, { z: -0.2 }); // grip
      const trigger = addBox(gun, { x: 0.012, y: 0.055, z: 0.012 }, { x: -0.01, y: -0.11, z: 0 }, accentMat);
      // Skeleton stock
      addBox(gun, { x: 0.3, y: 0.03, z: 0.1 }, { x: -0.42, y: 0.05, z: 0 }, bodyMat);
      addBox(gun, { x: 0.3, y: 0.03, z: 0.1 }, { x: -0.42, y: -0.08, z: 0 }, bodyMat);
      addBox(gun, { x: 0.05, y: 0.18, z: 0.11 }, { x: -0.58, y: -0.02, z: 0 }, rubberMat);
      // Mid-power scope
      addCyl(gun, 0.042, 0.042, 0.34, 12, { x: 0.1, y: 0.15, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
      addCyl(gun, 0.05, 0.046, 0.05, 12, { x: 0.27, y: 0.15, z: 0 }, { z: Math.PI * 0.5 }, lensMat);
      addCyl(gun, 0.038, 0.035, 0.045, 12, { x: -0.07, y: 0.15, z: 0 }, { z: Math.PI * 0.5 }, lensMat);
      addCyl(gun, 0.05, 0.05, 0.022, 10, { x: 0.02, y: 0.15, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
      addCyl(gun, 0.05, 0.05, 0.022, 10, { x: 0.18, y: 0.15, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
      const slide = addBox(gun, { x: 0.05, y: 0.022, z: 0.09 }, { x: -0.04, y: 0.06, z: -0.1 }, darkMat);
      const chamberGlow = addBox(gun, { x: 0.08, y: 0.012, z: 0.014 }, { x: 0.16, y: 0.075, z: -0.074 }, warningMat);
      chamberGlow.visible = false;
      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.DMR);
      const { muzzle, flash } = buildMuzzleRig(1.17, 0.03, 0xffd97a, 0.3, 0.05, 0.22, 0.038);
      return { gun, muzzle, flash, slide, mag, receiver, animParts: { trigger, chamberGlow } };
    }

    if (gunType === GUNS.AKIMBO) {
      // ── Gemini Machine Pistol — oversized pistol w/ compensator + brace ─────
      const receiver = addBox(gun, { x: 0.38, y: 0.12, z: 0.11 }, { x: 0.05, y: 0.03, z: 0 }, bodyMat);
      const slide = addBox(gun, { x: 0.34, y: 0.04, z: 0.114 }, { x: 0.05, y: 0.1, z: 0 }, darkMat);
      for (let i = 0; i < 5; i++) addBox(gun, { x: 0.01, y: 0.055, z: 0.116 }, { x: -0.08 + i * 0.028, y: 0.055, z: 0 }, edgeMat);
      addCyl(gun, 0.022, 0.022, 0.16, 8, { x: 0.28, y: 0.04, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
      // Vented compensator
      addBox(gun, { x: 0.1, y: 0.09, z: 0.1 }, { x: 0.32, y: 0.045, z: 0 }, accentMat);
      addBox(gun, { x: 0.012, y: 0.1, z: 0.06 }, { x: 0.35, y: 0.05, z: 0 }, edgeMat);
      const mag = addBox(gun, { x: 0.075, y: 0.28, z: 0.08 }, { x: -0.08, y: -0.2, z: 0 }, darkMat, { z: -0.14 }); // extended mag
      addBox(gun, { x: 0.08, y: 0.03, z: 0.088 }, { x: -0.12, y: -0.34, z: 0 }, warningMat, { z: -0.14 });
      const trigger = addBox(gun, { x: 0.012, y: 0.05, z: 0.012 }, { x: 0.05, y: -0.09, z: 0 }, accentMat);
      addBox(gun, { x: 0.11, y: 0.045, z: 0.012 }, { x: 0.06, y: -0.08, z: 0.048 }, darkMat, { z: 0.12 });
      // Folded brace at rear
      addBox(gun, { x: 0.2, y: 0.026, z: 0.026 }, { x: -0.24, y: 0.05, z: 0.07 }, edgeMat);
      addBox(gun, { x: 0.05, y: 0.09, z: 0.026 }, { x: -0.33, y: 0.0, z: 0.07 }, darkMat);
      addBox(gun, { x: 0.022, y: 0.032, z: 0.012 }, { x: 0.2, y: 0.13, z: 0 }, warningMat); // hi-vis front sight
      addBox(gun, { x: 0.022, y: 0.03, z: 0.05 }, { x: -0.12, y: 0.125, z: 0 }, darkMat);
      const chamberGlow = addBox(gun, { x: 0.06, y: 0.012, z: 0.012 }, { x: 0.1, y: 0.08, z: -0.06 }, warningMat);
      chamberGlow.visible = false;
      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.AKIMBO);
      const { muzzle, flash } = buildMuzzleRig(0.4, 0.05, 0xffc86a, 0.32, 0.052, 0.16, 0.036);
      return { gun, muzzle, flash, slide, mag, receiver, animParts: { trigger, chamberGlow } };
    }

    if (gunType === GUNS.RAILGUN) {
      // ── Lancer Railgun — twin rails, coil rings, glowing core ───────────────
      const receiver = addBox(gun, { x: 0.6, y: 0.18, z: 0.16 }, { x: -0.02, y: 0.0, z: 0 }, bodyMat);
      // Twin accelerator rails
      addBox(gun, { x: 0.9, y: 0.035, z: 0.035 }, { x: 0.62, y: 0.055, z: 0.045 }, edgeMat);
      addBox(gun, { x: 0.9, y: 0.035, z: 0.035 }, { x: 0.62, y: 0.055, z: -0.045 }, edgeMat);
      addBox(gun, { x: 0.9, y: 0.02, z: 0.02 }, { x: 0.62, y: -0.01, z: 0 }, darkMat); // lower spine
      // Energy core between the rails (uses lens material — emissive cyan)
      addBox(gun, { x: 0.78, y: 0.028, z: 0.05 }, { x: 0.58, y: 0.055, z: 0 }, lensMat);
      // Coil rings along the rails
      for (let i = 0; i < 5; i++) addCyl(gun, 0.075, 0.075, 0.028, 12, { x: 0.3 + i * 0.18, y: 0.045, z: 0 }, { z: Math.PI * 0.5 }, i % 2 ? accentMat : darkMat);
      addCyl(gun, 0.05, 0.09, 0.08, 12, { x: 1.1, y: 0.05, z: 0 }, { z: Math.PI * 0.5 }, accentMat); // flared emitter
      // Capacitor bank underside
      addBox(gun, { x: 0.3, y: 0.1, z: 0.14 }, { x: 0.24, y: -0.1, z: 0 }, darkMat);
      addAccentGlow(gun, 0.26, { x: 0.24, y: -0.155, z: 0.06 }, lensMat);
      const mag = addBox(gun, { x: 0.12, y: 0.14, z: 0.09 }, { x: -0.06, y: -0.15, z: 0 }, brassMat); // fuel cell
      addBox(gun, { x: 0.085, y: 0.24, z: 0.12 }, { x: -0.24, y: -0.18, z: 0 }, rubberMat, { z: -0.2 }); // grip
      const trigger = addBox(gun, { x: 0.012, y: 0.055, z: 0.012 }, { x: -0.13, y: -0.11, z: 0 }, accentMat);
      addBox(gun, { x: 0.24, y: 0.1, z: 0.13 }, { x: -0.44, y: 0.0, z: 0 }, bodyMat); // stock
      addBox(gun, { x: 0.06, y: 0.16, z: 0.12 }, { x: -0.58, y: -0.02, z: 0 }, rubberMat);
      // Holo sight block
      addBox(gun, { x: 0.14, y: 0.06, z: 0.07 }, { x: -0.1, y: 0.14, z: 0 }, darkMat);
      addBox(gun, { x: 0.02, y: 0.05, z: 0.05 }, { x: -0.04, y: 0.17, z: 0 }, lensMat);
      const slide = addBox(gun, { x: 0.05, y: 0.024, z: 0.07 }, { x: -0.16, y: 0.07, z: -0.1 }, darkMat);
      const chamberGlow = addBox(gun, { x: 0.1, y: 0.014, z: 0.016 }, { x: 0.05, y: 0.095, z: -0.084 }, warningMat);
      chamberGlow.visible = false;
      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.RAILGUN);
      const { muzzle, flash } = buildMuzzleRig(1.16, 0.05, 0x7ae8ff, 0.34, 0.05, 0.3, 0.042);
      return { gun, muzzle, flash, slide, mag, receiver, animParts: { trigger, chamberGlow } };
    }

    if (gunType === GUNS.FLAK) {
      // ── Mauler Auto-Shotgun — drum-fed bullpup scattergun ───────────────────
      const receiver = addBox(gun, { x: 0.66, y: 0.19, z: 0.17 }, { x: -0.06, y: 0.0, z: 0 }, bodyMat);
      addBox(gun, { x: 0.5, y: 0.024, z: 0.06 }, { x: -0.02, y: 0.107, z: 0 }, darkMat); // rail
      addRailTeeth(gun, 8, -0.22, 0.055, 0.12, 0, edgeMat, { x: 0.028, y: 0.02, z: 0.072 });
      addCyl(gun, 0.045, 0.045, 0.42, 10, { x: 0.44, y: 0.03, z: 0 }, { z: Math.PI * 0.5 }, darkMat); // fat barrel
      // Perforated heat shroud
      addCyl(gun, 0.06, 0.06, 0.3, 10, { x: 0.4, y: 0.03, z: 0 }, { z: Math.PI * 0.5 }, edgeMat);
      for (let i = 0; i < 4; i++) addBox(gun, { x: 0.05, y: 0.016, z: 0.13 }, { x: 0.3 + i * 0.07, y: 0.095, z: 0 }, darkMat);
      addCyl(gun, 0.075, 0.06, 0.07, 10, { x: 0.66, y: 0.03, z: 0 }, { z: Math.PI * 0.5 }, warningMat); // muzzle bell
      const mag = addCyl(gun, 0.115, 0.115, 0.085, 14, { x: -0.02, y: -0.17, z: 0 }, { x: Math.PI * 0.5 }, darkMat); // shell drum
      addCyl(gun, 0.08, 0.08, 0.09, 14, { x: -0.02, y: -0.17, z: 0 }, { x: Math.PI * 0.5 }, warningMat);
      addBox(gun, { x: 0.085, y: 0.24, z: 0.13 }, { x: 0.16, y: -0.19, z: 0 }, rubberMat, { z: -0.22 }); // forward grip (bullpup)
      const trigger = addBox(gun, { x: 0.013, y: 0.055, z: 0.013 }, { x: 0.26, y: -0.1, z: 0 }, warningMat);
      addBox(gun, { x: 0.13, y: 0.05, z: 0.012 }, { x: 0.25, y: -0.09, z: 0.05 }, darkMat, { z: 0.12 });
      addBox(gun, { x: 0.16, y: 0.17, z: 0.15 }, { x: -0.44, y: -0.01, z: 0 }, rubberMat); // butt pad (bullpup rear)
      // Shell carrier on top rear
      for (let i = 0; i < 3; i++) addCyl(gun, 0.02, 0.02, 0.1, 6, { x: -0.28 + i * 0.06, y: 0.13, z: 0 }, { x: Math.PI * 0.5 }, brassMat);
      addBox(gun, { x: 0.02, y: 0.03, z: 0.012 }, { x: 0.5, y: 0.12, z: 0 }, accentMat); // bead
      const slide = addBox(gun, { x: 0.06, y: 0.026, z: 0.07 }, { x: -0.12, y: 0.06, z: -0.11 }, darkMat);
      const chamberGlow = addBox(gun, { x: 0.09, y: 0.014, z: 0.014 }, { x: -0.02, y: 0.085, z: -0.09 }, warningMat);
      chamberGlow.visible = false;
      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.FLAK);
      const { muzzle, flash } = buildMuzzleRig(0.72, 0.03, 0xffbf5a, 0.46, 0.08, 0.24, 0.055);
      return { gun, muzzle, flash, slide, mag, receiver, animParts: { trigger, chamberGlow } };
    }

    if (gunType === GUNS.RIFLE) {
      // â"€â"€ Assault Rifle — improved geometry â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      // Upper receiver / bolt carrier
      const receiver = addBox(gun, { x: 0.52, y: 0.16, z: 0.155 }, { x: 0.03, y: 0.0, z: 0 }, bodyMat);
      // Ejection port cover / charging handle cutout
      addBox(gun, { x: 0.18, y: 0.025, z: 0.13 }, { x: 0.18, y: 0.082, z: 0 }, darkMat);
      // Dustcover rail (top picatinny)
      addBox(gun, { x: 0.48, y: 0.025, z: 0.072 }, { x: 0.03, y: 0.09, z: 0 }, darkMat);
      addRailTeeth(gun, 10, -0.18, 0.052, 0.118, 0, edgeMat, { x: 0.026, y: 0.022, z: 0.086 });
      // Foregrip / handguard (long)
      addBox(gun, { x: 0.38, y: 0.115, z: 0.155 }, { x: 0.37, y: -0.005, z: 0 }, darkMat);
      // Handguard rails (side)
      addBox(gun, { x: 0.38, y: 0.022, z: 0.032 }, { x: 0.37, y: 0.005, z: 0.088 }, accentMat);
      addBox(gun, { x: 0.38, y: 0.022, z: 0.032 }, { x: 0.37, y: 0.005, z: -0.088 }, accentMat);
      addAccentGlow(gun, 0.31, { x: 0.39, y: 0.048, z: 0.107 }, accentMat);
      addAccentGlow(gun, 0.31, { x: 0.39, y: 0.048, z: -0.107 }, accentMat);
      for (let i = 0; i < 5; i++) {
        addBox(gun, { x: 0.026, y: 0.062, z: 0.012 }, { x: 0.24 + i * 0.07, y: 0.03, z: 0.112 }, edgeMat, { x: 0.32 });
        addBox(gun, { x: 0.026, y: 0.062, z: 0.012 }, { x: 0.24 + i * 0.07, y: 0.03, z: -0.112 }, edgeMat, { x: -0.32 });
      }
      // Barrel (round, extends forward)
      addCyl(gun, 0.028, 0.028, 0.56, 10, { x: 0.64, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
      // Compensator / muzzle device
      addCyl(gun, 0.04, 0.038, 0.08, 10, { x: 0.90, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
      addCyl(gun, 0.047, 0.035, 0.035, 10, { x: 0.94, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, edgeMat);
      addBox(gun, { x: 0.008, y: 0.06, z: 0.065 }, { x: 0.88, y: 0.055, z: 0 }, accentMat);  // vents
      addBox(gun, { x: 0.008, y: 0.065, z: 0.055 }, { x: 0.895, y: 0.055, z: 0 }, accentMat);
      // Lower receiver / grip area
      addBox(gun, { x: 0.22, y: 0.1, z: 0.14 }, { x: -0.26, y: -0.01, z: 0 }, darkMat);
      // Pistol grip (ergonomic shape)
      addBox(gun, { x: 0.085, y: 0.28, z: 0.14 }, { x: -0.1, y: -0.22, z: 0 }, rubberMat, { z: -0.2 });
      addBox(gun, { x: 0.055, y: 0.1, z: 0.12 }, { x: -0.18, y: -0.36, z: 0 }, rubberMat);
      // Magazine (slightly curved)
      const mag = addBox(gun, { x: 0.095, y: 0.26, z: 0.072 }, { x: 0.09, y: -0.21, z: 0 }, darkMat, { z: -0.11 });
      addBox(gun, { x: 0.095, y: 0.028, z: 0.08 }, { x: 0.09, y: -0.345, z: 0 }, rubberMat, { z: -0.11 });
      for (let i = 0; i < 3; i++) addBox(gun, { x: 0.008, y: 0.19, z: 0.08 }, { x: 0.062 + i * 0.028, y: -0.215, z: 0 }, edgeMat, { z: -0.11 });
      // Magwell
      addBox(gun, { x: 0.11, y: 0.06, z: 0.092 }, { x: 0.09, y: -0.06, z: 0 }, bodyMat);
      // Trigger guard + trigger
      addBox(gun, { x: 0.12, y: 0.055, z: 0.012 }, { x: 0.04, y: -0.1, z: 0.052 }, darkMat, { z: 0.14 });
      const trigger = addBox(gun, { x: 0.012, y: 0.06, z: 0.012 }, { x: 0.04, y: -0.132, z: 0.035 }, accentMat);
      // Buttstock (folding style — 3 parts)
      addBox(gun, { x: 0.22, y: 0.065, z: 0.13 }, { x: -0.42, y: 0.01, z: 0 }, bodyMat);
      addBox(gun, { x: 0.025, y: 0.15, z: 0.105 }, { x: -0.54, y: -0.04, z: 0 }, bodyMat);
      addBox(gun, { x: 0.18, y: 0.025, z: 0.13 }, { x: -0.58, y: -0.14, z: 0 }, bodyMat);
      addBox(gun, { x: 0.055, y: 0.14, z: 0.12 }, { x: -0.66, y: -0.04, z: 0 }, rubberMat);
      // Scope / red-dot sight
      addBox(gun, { x: 0.2, y: 0.065, z: 0.075 }, { x: 0.1, y: 0.155, z: 0 }, darkMat);
      addCyl(gun, 0.03, 0.03, 0.19, 12, { x: 0.1, y: 0.185, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
      addCyl(gun, 0.034, 0.034, 0.024, 12, { x: 0.18, y: 0.185, z: 0 }, { z: Math.PI * 0.5 }, lensMat);
      addCyl(gun, 0.034, 0.034, 0.024, 12, { x: 0.015, y: 0.185, z: 0 }, { z: Math.PI * 0.5 }, lensMat);
      addBox(gun, { x: 0.06, y: 0.018, z: 0.018 }, { x: 0.10, y: 0.143, z: 0 }, edgeMat);
      // Charging handle
      addBox(gun, { x: 0.055, y: 0.025, z: 0.055 }, { x: -0.05, y: 0.065, z: -0.088 }, darkMat);
      const slide = addBox(gun, { x: 0.025, y: 0.022, z: 0.12 }, { x: -0.06, y: 0.075, z: -0.12 }, bodyMat);
      const chamberGlow = addBox(gun, { x: 0.085, y: 0.012, z: 0.014 }, { x: 0.19, y: 0.098, z: -0.082 }, warningMat);
      chamberGlow.visible = false;
      // Sling mount
      addCyl(gun, 0.018, 0.018, 0.035, 8, { x: -0.36, y: 0.0, z: -0.084 }, { z: Math.PI * 0.5 }, darkMat);

      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.RIFLE);

      const muzzle = new THREE.Object3D();
      muzzle.intensity = 0;
      muzzle.position.set(1.01, 0.03, 0);
      gun.add(muzzle);
      const flash = createMuzzleFlash(0xffc86a, 0.36);
      flash.position.set(0.12, 0.0, 0.0);
      muzzle.add(flash);
      // Add a small 3D cone and glow sphere for a physical muzzle flash
      const coneMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc86a, emissiveIntensity: 0, roughness: 0.12, metalness: 0, transparent: true, toneMapped: false });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 10), coneMat);
      cone.rotation.z = -Math.PI * 0.5;
      cone.position.copy(flash.position);
      cone.visible = false;
      muzzle.add(cone);
      const glowMat = new THREE.MeshStandardMaterial({ color: 0xffc86a, emissive: 0xffc86a, emissiveIntensity: 0, roughness: 0.08, metalness: 0.0, transparent: true });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glowMat);
      glow.position.copy(flash.position);
      glow.visible = false;
      muzzle.add(glow);
      const flash3d = createPhysicalMuzzleFlash(0xffc86a, 0.24, 0.068, 0.046);
      flash3d.position.copy(flash.position);
      muzzle.add(flash3d);
      muzzle.userData.flashCone = cone;
      muzzle.userData.flashGlow = glow;
      muzzle.userData.flash3d = flash3d;
      muzzle.userData.barrelTips = [new THREE.Vector3(0.14, 0.0, 0.0)];
      return { gun, muzzle, flash, slide, mag, receiver, animParts: { trigger, chamberGlow } };
    }

    if (gunType === GUNS.SHOTGUN) {
      // â"€â"€ Combat Shotgun — improved geometry â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      // Receiver body (wider, more box-like)
      addBox(gun, { x: 0.6, y: 0.2, z: 0.2 }, { x: -0.02, y: 0.0, z: 0 }, bodyMat);
      // Ejection port
      addBox(gun, { x: 0.15, y: 0.025, z: 0.18 }, { x: 0.12, y: 0.1, z: 0 }, darkMat);
      // Top picatinny rail
      addBox(gun, { x: 0.55, y: 0.02, z: 0.06 }, { x: -0.02, y: 0.105, z: 0 }, darkMat);
      addRailTeeth(gun, 9, -0.25, 0.058, 0.132, 0, edgeMat, { x: 0.03, y: 0.02, z: 0.074 });
      // Dual barrels (side by side)
      addCyl(gun, 0.042, 0.042, 0.56, 10, { x: 0.56, y: 0.04, z: 0.054 }, { z: Math.PI * 0.5 }, darkMat);
      addCyl(gun, 0.042, 0.042, 0.56, 10, { x: 0.56, y: 0.04, z: -0.054 }, { z: Math.PI * 0.5 }, darkMat);
      // Barrel band connector
      addCyl(gun, 0.058, 0.058, 0.025, 10, { x: 0.45, y: 0.04, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
      addCyl(gun, 0.058, 0.058, 0.025, 10, { x: 0.72, y: 0.04, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
      // Muzzle device (flared)
      addCyl(gun, 0.06, 0.055, 0.085, 10, { x: 0.88, y: 0.04, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
      addCyl(gun, 0.072, 0.052, 0.045, 10, { x: 0.93, y: 0.04, z: 0 }, { z: Math.PI * 0.5 }, edgeMat);
      addBox(gun, { x: 0.01, y: 0.075, z: 0.15 }, { x: 0.925, y: 0.085, z: 0 }, warningMat);
      // Pump foregrip (textured)
      const pump = addBox(gun, { x: 0.28, y: 0.1, z: 0.18 }, { x: 0.36, y: -0.01, z: 0 }, rubberMat);
      addBox(gun, { x: 0.28, y: 0.022, z: 0.022 }, { x: 0.36, y: 0.06, z: 0.098 }, darkMat);
      addBox(gun, { x: 0.28, y: 0.022, z: 0.022 }, { x: 0.36, y: 0.06, z: -0.098 }, darkMat);
      for (let i = 0; i < 6; i++) addBox(gun, { x: 0.022, y: 0.014, z: 0.19 }, { x: 0.20 + i * 0.058, y: -0.062, z: 0 }, edgeMat);
      addAccentGlow(gun, 0.24, { x: 0.36, y: 0.005, z: 0.116 }, warningMat);
      addAccentGlow(gun, 0.24, { x: 0.36, y: 0.005, z: -0.116 }, warningMat);
      // Wood stock (warm grain texture via woodMat)
      addBox(gun, { x: 0.3, y: 0.14, z: 0.16 }, { x: -0.32, y: -0.01, z: 0 }, woodMat);
      addBox(gun, { x: 0.12, y: 0.16, z: 0.14 }, { x: -0.55, y: 0.005, z: 0 }, woodMat);
      addBox(gun, { x: 0.085, y: 0.19, z: 0.14 }, { x: -0.66, y: -0.01, z: 0 }, rubberMat);  // recoil pad
      // Pistol grip
      addBox(gun, { x: 0.085, y: 0.26, z: 0.14 }, { x: -0.08, y: -0.22, z: 0 }, bodyMat, { z: -0.24 });
      addBox(gun, { x: 0.072, y: 0.09, z: 0.12 }, { x: -0.15, y: -0.36, z: 0 }, rubberMat);
      const trigger = addBox(gun, { x: 0.014, y: 0.062, z: 0.014 }, { x: 0.02, y: -0.14, z: 0.052 }, warningMat, { z: -0.12 });
      // Magazine tube (below barrels)
      addCyl(gun, 0.028, 0.028, 0.55, 10, { x: 0.52, y: -0.06, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
      // Shell carrier on side (decorative)
      for (let i = 0; i < 5; i++) addCyl(gun, 0.018, 0.018, 0.115, 6, { x: -0.04 + i * 0.058, y: -0.06, z: 0.13 }, { x: Math.PI * 0.5 }, brassMat);
      addBox(gun, { x: 0.34, y: 0.025, z: 0.018 }, { x: 0.075, y: -0.06, z: 0.13 }, edgeMat);
      // Ghost ring sight (rear aperture)
      addCyl(gun, 0.025, 0.025, 0.016, 12, { x: -0.18, y: 0.122, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
      addCyl(gun, 0.022, 0, 0.016, 12, { x: -0.18, y: 0.122, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
      // Front bead
      addCyl(gun, 0.008, 0.008, 0.012, 8, { x: 0.75, y: 0.112, z: 0 }, {}, accentMat);
      // Side ejection port detail
      addBox(gun, { x: 0.12, y: 0.05, z: 0.018 }, { x: 0.1, y: 0.08, z: 0.102 }, darkMat);
      const chamberGlow = addBox(gun, { x: 0.105, y: 0.014, z: 0.014 }, { x: 0.1, y: 0.09, z: 0.124 }, warningMat);
      chamberGlow.visible = false;
      const mag = addBox(gun, { x: 0.14, y: 0.015, z: 0.09 }, { x: 0.1, y: 0.21, z: 0 }, darkMat);

      if (firstPersonModel) attachFirstPersonHands(gun, GUNS.SHOTGUN);

      const muzzle = new THREE.Object3D();
      muzzle.intensity = 0;
      muzzle.position.set(1.0, 0.05, 0);
      gun.add(muzzle);
      const flash = createMuzzleFlash(0xffbf5a, 0.5);
      flash.position.set(0.13, 0.0, 0.0);
      muzzle.add(flash);
      // Add 3D cone + glow for shotgun muzzle flash
      const coneMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffbf5a, emissiveIntensity: 0, roughness: 0.12, metalness: 0, transparent: true, toneMapped: false });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.26, 10), coneMat);
      cone.rotation.z = -Math.PI * 0.5;
      cone.position.copy(flash.position);
      cone.visible = false;
      muzzle.add(cone);
      const glowMat = new THREE.MeshStandardMaterial({ color: 0xffbf5a, emissive: 0xffbf5a, emissiveIntensity: 0, roughness: 0.08, metalness: 0.0, transparent: true });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glowMat);
      glow.position.copy(flash.position);
      glow.visible = false;
      muzzle.add(glow);
      const flash3d = createPhysicalMuzzleFlash(0xffbf5a, 0.32, 0.102, 0.07);
      flash3d.position.copy(flash.position);
      muzzle.add(flash3d);
      muzzle.userData.flashCone = cone;
      muzzle.userData.flashGlow = glow;
      muzzle.userData.flash3d = flash3d;
      muzzle.userData.barrelTips = [
        new THREE.Vector3(0.15, 0.0, 0.06),
        new THREE.Vector3(0.15, 0.0, -0.06),
      ];
      return { gun, muzzle, flash, slide: pump, mag, animParts: { trigger, chamberGlow } };
    }

    // â"€â"€ Precision Rifle (Sniper) — improved geometry â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    // Receiver body (slender, precise)
    addBox(gun, { x: 0.54, y: 0.145, z: 0.14 }, { x: 0.06, y: 0.0, z: 0 }, bodyMat);
    addRailTeeth(gun, 12, -0.15, 0.055, 0.092, 0, edgeMat, { x: 0.026, y: 0.018, z: 0.072 });
    // Fluted barrel (long, thin)
    const barrel = addCyl(gun, 0.022, 0.022, 0.82, 10, { x: 0.77, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
    // Barrel flutes (decorative ribs)
    for (let i = 0; i < 4; i++) addBox(gun, { x: 0.55, y: 0.008, z: 0.008 }, { x: 0.72, y: 0.02 + (i < 2 ? 0.025 : -0.025), z: i % 2 === 0 ? 0.025 : -0.025 }, bodyMat);
    // Muzzle brake (slots visible)
    addCyl(gun, 0.034, 0.032, 0.1, 10, { x: 1.17, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
    addBox(gun, { x: 0.008, y: 0.07, z: 0.072 }, { x: 1.155, y: 0.02, z: 0 }, accentMat);
    addBox(gun, { x: 0.008, y: 0.072, z: 0.06 }, { x: 1.175, y: 0.02, z: 0 }, accentMat);
    addBox(gun, { x: 0.008, y: 0.052, z: 0.082 }, { x: 1.195, y: 0.02, z: 0 }, edgeMat);
    // Long suppressor alternative detail
    addCyl(gun, 0.03, 0.03, 0.22, 10, { x: 1.13, y: 0.02, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
    // Chassis / bedding stock (angular)
    addBox(gun, { x: 0.42, y: 0.095, z: 0.115 }, { x: -0.38, y: -0.01, z: 0 }, bodyMat);
    addAccentGlow(gun, 0.34, { x: -0.38, y: 0.046, z: 0.072 }, accentMat);
    addAccentGlow(gun, 0.34, { x: -0.38, y: 0.046, z: -0.072 }, accentMat);
    addBox(gun, { x: 0.18, y: 0.095, z: 0.1 }, { x: -0.62, y: -0.005, z: 0 }, darkMat);
    // Adjustable buttstock sections
    addBox(gun, { x: 0.06, y: 0.095, z: 0.1 }, { x: -0.74, y: -0.01, z: 0 }, bodyMat);
    addBox(gun, { x: 0.18, y: 0.095, z: 0.1 }, { x: -0.82, y: -0.01, z: 0 }, darkMat);
    addBox(gun, { x: 0.08, y: 0.16, z: 0.1 }, { x: -0.9, y: -0.01, z: 0 }, rubberMat);  // recoil pad
    // Cheek piece
    addBox(gun, { x: 0.28, y: 0.055, z: 0.075 }, { x: -0.48, y: 0.085, z: 0 }, bodyMat);
    // Thumb hole grip
    addBox(gun, { x: 0.085, y: 0.25, z: 0.115 }, { x: -0.12, y: -0.17, z: 0 }, bodyMat, { z: -0.18 });
    addBox(gun, { x: 0.075, y: 0.08, z: 0.1 }, { x: -0.18, y: -0.31, z: 0 }, rubberMat);
    const trigger = addBox(gun, { x: 0.012, y: 0.058, z: 0.012 }, { x: 0.02, y: -0.112, z: 0.045 }, accentMat, { z: -0.12 });
    // Detachable box magazine (wider, taller)
    const mag = addBox(gun, { x: 0.088, y: 0.22, z: 0.068 }, { x: 0.08, y: -0.18, z: 0 }, darkMat, { z: -0.05 });
    addBox(gun, { x: 0.088, y: 0.025, z: 0.075 }, { x: 0.08, y: -0.295, z: 0 }, rubberMat, { z: -0.05 });
    // Bipod legs (folded)
    addBox(gun, { x: 0.008, y: 0.18, z: 0.008 }, { x: 0.58, y: -0.1, z: 0.072 }, darkMat, { z: 0.3 });
    addBox(gun, { x: 0.008, y: 0.18, z: 0.008 }, { x: 0.58, y: -0.1, z: -0.072 }, darkMat, { z: -0.3 });
    // Bipod mount rail
    addBox(gun, { x: 0.08, y: 0.02, z: 0.035 }, { x: 0.58, y: -0.025, z: 0 }, darkMat);
    // High-power scope (long tube)
    addCyl(gun, 0.052, 0.052, 0.58, 12, { x: 0.31, y: 0.155, z: 0 }, { z: Math.PI * 0.5 }, darkMat);
    // Objective lens (large)
    addCyl(gun, 0.065, 0.06, 0.075, 12, { x: 0.6, y: 0.155, z: 0 }, { z: Math.PI * 0.5 }, lensMat);
    // Eyepiece (smaller)
    addCyl(gun, 0.046, 0.042, 0.065, 12, { x: 0.01, y: 0.155, z: 0 }, { z: Math.PI * 0.5 }, lensMat);
    // Turret knobs (windage / elevation)
    addCyl(gun, 0.014, 0.014, 0.04, 8, { x: 0.31, y: 0.225, z: 0 }, {}, darkMat);
    addCyl(gun, 0.014, 0.014, 0.04, 8, { x: 0.31, y: 0.155, z: 0.072 }, { x: Math.PI * 0.5 }, darkMat);
    // Scope rings
    addCyl(gun, 0.058, 0.058, 0.025, 10, { x: 0.18, y: 0.155, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
    addCyl(gun, 0.058, 0.058, 0.025, 10, { x: 0.46, y: 0.155, z: 0 }, { z: Math.PI * 0.5 }, accentMat);
    addBox(gun, { x: 0.34, y: 0.012, z: 0.014 }, { x: 0.31, y: 0.214, z: 0 }, edgeMat);
    // Bolt handle (on right side)
    const boltHandle = addBox(gun, { x: 0.055, y: 0.008, z: 0.068 }, { x: 0.04, y: 0.04, z: -0.076 }, darkMat);
    const boltKnob = addCyl(gun, 0.016, 0.016, 0.18, 8, { x: -0.04, y: 0.02, z: -0.168 }, { x: Math.PI * 0.5 }, accentMat);
    const chamberGlow = addBox(gun, { x: 0.09, y: 0.012, z: 0.014 }, { x: 0.16, y: 0.074, z: -0.078 }, warningMat);
    chamberGlow.visible = false;

    if (firstPersonModel) attachFirstPersonHands(gun, GUNS.SNIPER);

    const muzzle = new THREE.Object3D();
    muzzle.intensity = 0;
    muzzle.position.set(1.31, 0.03, 0);
    gun.add(muzzle);
    const flash = createMuzzleFlash(0xffd97a, 0.28);
    flash.position.set(0.14, 0.0, 0.0);
    muzzle.add(flash);
    // Add 3D cone + glow for sniper muzzle flash
    const coneMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd97a, emissiveIntensity: 0, roughness: 0.12, metalness: 0, transparent: true, toneMapped: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 10), coneMat);
    cone.rotation.z = -Math.PI * 0.5;
    cone.position.copy(flash.position);
    cone.visible = false;
    muzzle.add(cone);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xffd97a, emissive: 0xffd97a, emissiveIntensity: 0, roughness: 0.06, metalness: 0.0, transparent: true });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), glowMat);
    glow.position.copy(flash.position);
    glow.visible = false;
    muzzle.add(glow);
    const flash3d = createPhysicalMuzzleFlash(0xffd97a, 0.3, 0.056, 0.044);
    flash3d.position.copy(flash.position);
    muzzle.add(flash3d);
    muzzle.userData.flashCone = cone;
    muzzle.userData.flashGlow = glow;
    muzzle.userData.flash3d = flash3d;
    muzzle.userData.barrelTips = [new THREE.Vector3(0.16, 0.0, 0.0)];
    return { gun, muzzle, flash, slide: boltHandle, mag, barrel, animParts: { trigger, boltKnob, chamberGlow } };
  }

  function setupLoadoutPreviews() {
    const previewConfigs = [
      { gunType: GUNS.RIFLE, canvas: document.getElementById("loadout-preview-rifle"), yaw: -0.35 },
      { gunType: GUNS.SHOTGUN, canvas: document.getElementById("loadout-preview-shotgun"), yaw: -0.18 },
      { gunType: GUNS.SNIPER, canvas: document.getElementById("loadout-preview-sniper"), yaw: -0.48 },
      // Only the starter pistol gets a live 3D preview; the other mystery-box guns
      // use static emblems (each preview costs a WebGL context — browsers cap ~16).
      { gunType: GUNS.PISTOL, canvas: document.getElementById("loadout-preview-pistol"), yaw: -0.3 },
    ];

    for (const config of previewConfigs) {
      if (!config.canvas) continue;

      const previewRenderer = new THREE.WebGLRenderer({
        canvas: config.canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
      });
      previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
      previewRenderer.setClearColor(0x000000, 0);
      // Three.js sets style.display='block' in its constructor — remove it so CSS controls visibility
      config.canvas.style.display = '';
      previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

      const previewScene = new THREE.Scene();
      const previewCamera = new THREE.PerspectiveCamera(33, 16 / 9, 0.1, 20);
      previewCamera.position.set(0, 0.08, 2.45);
      previewCamera.lookAt(0, 0, 0);

      const keyLight = new THREE.DirectionalLight(0x9ae8ff, 2.6);
      keyLight.position.set(2.6, 2.1, 3.2);
      previewScene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xff5c72, 1.35);
      rimLight.position.set(-2.2, 0.8, -2.4);
      previewScene.add(rimLight);
      previewScene.add(new THREE.AmbientLight(0x6baed6, 0.95));

      const pivot = new THREE.Group();
      previewScene.add(pivot);
      const previewWeapon = createWeaponViewModel(config.gunType, pivot);
      previewWeapon.gun.position.set(0, 0, 0);
      previewWeapon.gun.rotation.set(-0.08, config.yaw, 0.05);
      previewWeapon.flash.visible = false;
      previewWeapon.muzzle.intensity = 0;

      const box = new THREE.Box3().setFromObject(previewWeapon.gun);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      previewWeapon.gun.position.sub(center);
      const scale = 2.35 / Math.max(size.x, size.y, size.z, 0.001);
      pivot.scale.setScalar(scale);

      loadoutPreviews.push({
        canvas: config.canvas,
        renderer: previewRenderer,
        scene: previewScene,
        camera: previewCamera,
        pivot,
        offset: loadoutPreviews.length * Math.PI * 0.42,
      });
    }
  }

  function resizeLoadoutPreview(preview) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(preview.canvas.clientWidth || preview.canvas.width || 320));
    const height = Math.max(1, Math.floor(preview.canvas.clientHeight || preview.canvas.height || 180));
    const targetWidth = Math.floor(width * dpr);
    const targetHeight = Math.floor(height * dpr);

    if (preview.canvas.width !== targetWidth || preview.canvas.height !== targetHeight) {
      preview.renderer.setPixelRatio(dpr);
      preview.renderer.setSize(width, height, false);
      preview.camera.aspect = width / height;
      preview.camera.updateProjectionMatrix();
    }
  }

  let lastLoadoutPreviewRender = 0;
  const LOADOUT_PREVIEW_FRAME_MS = lowEndMode ? 120 : 50;
  function updateLoadoutPreviews(now, force = false) {
    if (!loadoutPreviews.length) return;
    if (!force && overlay?.classList.contains("hidden")) return;
    const loadoutPanelActive = loadoutPanel?.classList.contains("active");
    if (!force && !loadoutPanelActive) {
      // Clear stale WebGL frames so preserveDrawingBuffer doesn't bleed through if CSS fails
      for (const preview of loadoutPreviews) preview.renderer.clear();
      return;
    }
    if (!force && now - lastLoadoutPreviewRender < LOADOUT_PREVIEW_FRAME_MS) return;
    lastLoadoutPreviewRender = now;

    for (const preview of loadoutPreviews) {
      resizeLoadoutPreview(preview);
      preview.pivot.rotation.y = preview.offset + now * 0.00038;
      preview.pivot.rotation.x = Math.sin(now * 0.0005 + preview.offset) * 0.055;
      preview.renderer.render(preview.scene, preview.camera);
    }
  }

  function getWeaponAnimSpec(gunType) {
    const spec = GUN_SPECS[gunType];
    const state = allGuns?.[gunType] || null;
    const reloadDuration = state?.reloadTime || spec.reloadTime;
    return {
      recoil: spec.recoil,
      muzzleFlashDuration: Number.isFinite(spec.muzzleFlashTime)
        ? spec.muzzleFlashTime
        : (gunType === GUNS.SNIPER ? 0.075 : gunType === GUNS.SHOTGUN ? 0.105 : 0.08),
      equipTime: Number.isFinite(spec.equipTime) ? spec.equipTime : 0.3,
      reloadDuration,
      dropPhase: reloadDuration * 0.25,
      swapPhase: reloadDuration * 0.55,
    };
  }

  function initializeWeaponAnimation(gunType: GunType = GUNS.RIFLE) {
    return {
      basePos: null,
      baseRot: null,
      baseMagPos: null,
      baseMagRot: null,
      baseSlidePos: null,
      kick: 0,
      kickVel: 0,
      recoilYaw: 0,
      recoilYawVel: 0,
      recoilRoll: 0,
      recoilRollVel: 0,
      reloadEase: 0,
      reloadPhase: 0,
      slideKick: 0,
      slideKickVel: 0,
      meleeSwing: 0,
      reloadJolt: 0,
      switchBlend: 0,
      recoilBurst: 0,
      recoilBurstTimer: 0,
      strafeTilt: 0,
      strafeTiltVel: 0,
      landJolt: 0,
      landJoltVel: 0,
      wasGrounded: true,
      animSpec: getWeaponAnimSpec(gunType),
    };
  }

  function captureWeaponAnimationBases(anim, weaponRig) {
    // Always reset to the canonical first-person orientation before capturing,
    // so accumulated recoil/sway/pack-a-punch rotation never gets baked in as the new base.
    weaponRig.gun.rotation.set(0, Math.PI * 0.5, 0);
    anim.basePos = weaponRig.gun.position.clone();
    anim.baseRot = weaponRig.gun.rotation.clone();
    anim.baseMagPos = weaponRig.mag.position.clone();
    anim.baseMagRot = weaponRig.mag.rotation.clone();
    anim.baseSlidePos = weaponRig.slide.position.clone();
    anim.baseSlideRot = weaponRig.slide.rotation.clone();
    captureWeaponRigPartBases(weaponRig, "animBase");
  }

  function captureWeaponRigPartBases(weaponRig, key = "animBase") {
    if (!weaponRig?.animParts) return;
    for (const part of Object.values(weaponRig.animParts) as any[]) {
      if (!part || part.userData[key]) continue;
      part.userData[key] = {
        position: part.position.clone(),
        rotation: part.rotation.clone(),
        scale: part.scale.clone(),
        visible: part.visible,
      };
    }
  }

  function restoreWeaponRigAnimParts(weaponRig, key = "animBase") {
    if (!weaponRig?.animParts) return;
    for (const part of Object.values(weaponRig.animParts) as any[]) {
      const base = part?.userData?.[key];
      if (!base) continue;
      part.position.copy(base.position);
      part.rotation.copy(base.rotation);
      part.scale.copy(base.scale);
      part.visible = base.visible;
    }
  }

  function applyWeaponDesignAnimation(weaponRig, gunType, opts: any = {}) {
    const parts = weaponRig?.animParts;
    if (!parts) return;
    const spec = GUN_SPECS[gunType] || ({} as any);
    const clamp01 = v => Math.max(0, Math.min(1, v || 0));
    const firePull = clamp01(Math.max(opts.shotT || 0, (opts.slideKick || 0) * 3.2, (opts.kick || 0) * 0.22));
    const reloadT = clamp01(opts.reloadT || 0);
    const reloadActive = Boolean(opts.reloadActive);
    const reloadPulse = reloadActive ? Math.sin(reloadT * Math.PI) : 0;
    const actionRack = clamp01(opts.actionRack || 0);
    // Fire-cycle progress: 0 right at the shot → 1 when the gun is ready again.
    // Keyed off fireCooldown/fireRate, so slow guns get long mechanical cycles
    // (railgun re-arms over 1.45s) and fast guns a quick flutter — for free.
    const firing = Boolean(opts.firing) && !reloadActive;
    const cycle = firing ? clamp01(opts.cycleT == null ? 1 : opts.cycleT) : 1;
    const cyclePulse = firing ? Math.sin(Math.min(1, cycle / 0.85) * Math.PI) : 0;
    const fireStyle = spec.fireCycle || "rifle";

    if (parts.trigger) {
      parts.trigger.position.x -= firePull * 0.014;
      parts.trigger.rotation.z -= firePull * (gunType === GUNS.SHOTGUN ? 0.44 : 0.34);
    }

    if (parts.chamberGlow) {
      const reloadWindow = reloadActive && (
        (gunType === GUNS.RIFLE && reloadT > 0.62 && reloadT < 0.9) ||
        (gunType === GUNS.SHOTGUN && reloadT > 0.18 && reloadT < 0.82) ||
        (gunType === GUNS.SNIPER && reloadT > 0.12 && reloadT < 0.34)
      );
      const glowT = Math.max(opts.shotT || 0, reloadWindow ? 0.65 : 0);
      parts.chamberGlow.visible = glowT > 0.03;
      parts.chamberGlow.scale.set(1 + glowT * 0.45, 1 + glowT * 1.2, 1 + glowT * 1.2);
      if (parts.chamberGlow.material?.emissive) parts.chamberGlow.material.emissiveIntensity = 0.45 + glowT * 1.5;
    }

    if (gunType === GUNS.SNIPER && parts.boltKnob) {
      const boltTravel = actionRack * 0.22 + firePull * 0.018;
      parts.boltKnob.position.x -= boltTravel;
      parts.boltKnob.position.y += actionRack * 0.035;
      parts.boltKnob.rotation.z -= actionRack * 0.65;
    }

    // ── Per-gun mechanical fire cycles (shared FP+TP: both callers restore the
    // slide/mag/animParts to their captured bases each frame, so everything
    // here is additive and never accumulates) ────────────────────────────────
    const slide = weaponRig.slide;
    if (slide) {
      if (fireStyle === "slide" || fireStyle === "rattle") {
        // Sharp blowback: full rearward travel in the first quarter of the
        // cycle, returned to battery by ~70% (SMG-class = smaller, faster).
        const blow = firing ? (cycle < 0.25 ? cycle / 0.25 : Math.max(0, 1 - (cycle - 0.25) / 0.45)) : 0;
        slide.position.x -= blow * (fireStyle === "rattle" ? 0.045 : 0.095);
        // High-rate bolt flutter while the trigger is held.
        if (fireStyle === "rattle" && firing) slide.position.x -= Math.abs(Math.sin(performance.now() * 0.09)) * 0.018;
        // Pistol slide locks back on an empty magazine.
        if (fireStyle === "slide" && opts.magEmpty && !reloadActive) slide.position.x -= 0.07;
      } else if (fireStyle === "pump") {
        // Pump/cycling shroud: back then forward across the shot interval
        // (FLAK auto-cycles a shorter throw, faster-feeling stroke).
        slide.position.x -= cyclePulse * (gunType === GUNS.SHOTGUN ? 0.2 : 0.12);
      } else if (fireStyle === "bolt") {
        // Crisp bolt kick: fast rearward snap, slower controlled return.
        const boltT = firing ? (cycle < 0.18 ? cycle / 0.18 : Math.max(0, 1 - (cycle - 0.18) / 0.55)) : 0;
        slide.position.x -= boltT * 0.16;
        slide.position.y += boltT * 0.02;
      } else if (fireStyle === "drum") {
        // Heavy bolt shudder while the belt/drum feeds.
        if (firing) slide.position.x -= Math.abs(Math.sin(performance.now() * 0.055)) * 0.02;
        slide.position.x -= firePull * 0.03;
      }
    }

    // Drum-fed guns: the drum advances one eased notch per round fired
    // (rotation about the drum's own axis; base restored each frame upstream).
    if (spec.reloadStyle === "drum" && weaponRig.mag && Number.isFinite(opts.magCount)) {
      const notchTarget = reloadActive ? 0 : ((opts.magSize || 0) - opts.magCount) * 0.22;
      const ud = weaponRig.mag.userData;
      ud.drumSpin = (ud.drumSpin || 0) + (notchTarget - (ud.drumSpin || 0)) * 0.22;
      weaponRig.mag.rotation.y += ud.drumSpin;
    }

    // DMR-class brass ejection puff: the ejection-port glow flashes and kicks
    // up/back right as the bolt opens. Uniform + transform changes only — no
    // new materials, no lights (there is no pooled brass system to reuse).
    if (fireStyle === "bolt" && parts.chamberGlow && firing && cycle < 0.4) {
      const puff = Math.sin(clamp01(cycle / 0.4) * Math.PI);
      parts.chamberGlow.visible = true;
      parts.chamberGlow.position.y += puff * 0.03;
      parts.chamberGlow.position.z -= puff * 0.025;
      parts.chamberGlow.scale.set(1 + puff * 0.6, 1 + puff * 1.6, 1 + puff * 1.6);
      if (parts.chamberGlow.material?.emissive) parts.chamberGlow.material.emissiveIntensity = 0.45 + puff * 1.8;
    }

    // Railgun coil: charge-up wind — the chamber glow ramps back to full as the
    // coils re-arm across the long fire delay, then flares on the shot itself.
    // emissiveIntensity/scale only (uniform changes — shader-cache safe).
    if (fireStyle === "coil" && parts.chamberGlow) {
      const charge = reloadActive ? reloadPulse * 0.4 : firing ? cycle : (opts.magEmpty ? 0.1 : 1);
      parts.chamberGlow.visible = charge > 0.03;
      parts.chamberGlow.scale.set(1 + charge * 0.35, 1 + charge * 1.1, 1 + charge * 1.1);
      if (parts.chamberGlow.material?.emissive) parts.chamberGlow.material.emissiveIntensity = 0.2 + charge * 1.7 + (opts.shotT || 0) * 2.4;
    }

    if (reloadActive && parts.trigger) {
      parts.trigger.position.y += reloadPulse * (gunType === GUNS.SHOTGUN ? 0.006 : 0.004);
    }
  }

  function cacheFirstPersonWeapon(gunType, weaponRig) {
    firstPersonWeaponCache.set(gunType, weaponRig);
    return weaponRig;
  }

  function selectFirstPersonWeapon(gunType) {
    let nextWeapon = firstPersonWeaponCache.get(gunType);
    if (!nextWeapon) {
      nextWeapon = cacheFirstPersonWeapon(gunType, createWeaponViewModel(gunType, camera));
    } else if (nextWeapon.gun.parent !== camera) {
      camera.add(nextWeapon.gun);
    }

    for (const [type, cachedWeapon] of firstPersonWeaponCache) {
      if (cachedWeapon?.gun) cachedWeapon.gun.visible = type === gunType && !thirdPerson.enabled;
      if (cachedWeapon?.flash) {
        cachedWeapon.flash.visible = false;
        cachedWeapon.flash.material.opacity = 0;
      }
      setPhysicalMuzzleFlash(cachedWeapon?.muzzle, false, 0, 1);
    }

    weapon = nextWeapon;
    weaponAnim = initializeWeaponAnimation(gunType);
    captureWeaponAnimationBases(weaponAnim, weapon);
    return nextWeapon;
  }

  function createFallbackThirdPersonModel() {
    const root = new THREE.Group();
    const suitMat = new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.72, metalness: 0.16 });
    const vestMat = new THREE.MeshStandardMaterial({ color: 0x1c2836, roughness: 0.62, metalness: 0.28 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.78, metalness: 0.08 });
    addBox(root, { x: 0.52, y: 0.78, z: 0.28 }, { x: 0, y: 1.03, z: 0 }, vestMat);
    addBox(root, { x: 0.34, y: 0.34, z: 0.28 }, { x: 0, y: 1.6, z: -0.02 }, headMat);
    addBox(root, { x: 0.16, y: 0.68, z: 0.16 }, { x: -0.34, y: 1.03, z: 0 }, suitMat, { z: 0.14 });
    addBox(root, { x: 0.16, y: 0.68, z: 0.16 }, { x: 0.34, y: 1.03, z: 0 }, suitMat, { z: -0.14 });
    addBox(root, { x: 0.18, y: 0.78, z: 0.18 }, { x: -0.15, y: 0.39, z: 0 }, suitMat);
    addBox(root, { x: 0.18, y: 0.78, z: 0.18 }, { x: 0.15, y: 0.39, z: 0 }, suitMat);
    const rightHand = new THREE.Object3D();
    rightHand.name = "FallbackRightHand";
    rightHand.position.set(0.42, 1.12, -0.26);
    root.add(rightHand);
    root.userData.fallbackRightHand = rightHand;

    const leftHand = new THREE.Object3D();
    leftHand.name = "FallbackLeftHand";
    leftHand.position.set(-0.34, 1.08, -0.05);
    root.add(leftHand);
    root.userData.fallbackLeftHand = leftHand;
    return root;
  }

  function findArmBones(root) {
    const b = { rightUpperArm: null, leftUpperArm: null, rightForeArm: null, leftForeArm: null, spine: null };

    // Compact name: strip all non-alphanumeric chars and lowercase — handles "mixamorig:RightArm" → "mixamorigrightarm"
    const compact = name => (name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

    // Pattern sets: each entry is [key, exactMatch[], substringFallback]
    // exactMatch checked first (higher priority), substringFallback catches unusual naming
    const rules = [
      { key: 'rightUpperArm', exact: /^(rightarm|upperarm_r|arm_r|r_arm|mixamorigrightarm|mixamorigupperarm_r)$/ },
      { key: 'leftUpperArm',  exact: /^(leftarm|upperarm_l|arm_l|l_arm|mixamorigleftarm|mixamorigupperarm_l)$/  },
      { key: 'rightForeArm',  exact: /^(rightforearm|forearm_r|lowerarm_r|r_forearm|mixamorigrightforearm|mixamoriglowerarm_r)$/ },
      { key: 'leftForeArm',   exact: /^(leftforearm|forearm_l|lowerarm_l|l_forearm|mixamorigleftforearm|mixamoriglowerarm_l)$/  },
      { key: 'spine',         exact: /^(spine2|spine_2|upperchest|chest_upper|mixamorigspine2|mixamorigupperchest)$/ },
    ];

    // Fallback: broader substring patterns — only used if exact match didn't fire
    const broad = [
      { key: 'rightUpperArm', re: /right.*arm|upperarm.*r/  },
      { key: 'leftUpperArm',  re: /left.*arm|upperarm.*l/   },
      { key: 'rightForeArm',  re: /right.*fore|forearm.*r/  },
      { key: 'leftForeArm',   re: /left.*fore|forearm.*l/   },
      { key: 'spine',         re: /spine2|spine_2|upperchest/ },
    ];

    // First pass: exact
    root.traverse(obj => {
      if (!obj.isBone) return;
      const n = compact(obj.name);
      for (const { key, exact } of rules) {
        if (exact.test(n)) b[key] = obj;
      }
    });

    // Second pass: broad substring for any still-missing entries
    root.traverse(obj => {
      if (!obj.isBone) return;
      const n = compact(obj.name);
      for (const { key, re } of broad) {
        if (!b[key] && re.test(n)) b[key] = obj;
      }
    });

    // Last resort for spine: accept Spine1 if Spine2 not found
    if (!b.spine) {
      root.traverse(obj => {
        if (!obj.isBone) return;
        const n = compact(obj.name);
        if (/^(spine1|spine_1|mixamorigspine1)$/.test(n)) b.spine = obj;
      });
    }

    return b;
  }

  function findRightHandBone(root) {
    let fallback = null;
    const preferred = /(righthand|right_hand|hand_r|r_hand|mixamorightrand|mixamorightrhand|rightwrist|wrist_r)$/i;
    const broad = /(right.*hand|hand.*right|r.*hand|wrist.*r|r.*wrist)/i;
    root.traverse(obj => {
      const compact = (obj.name || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (!fallback && obj.isBone && broad.test(obj.name || compact)) fallback = obj;
      if (obj.isBone && preferred.test(compact)) fallback = obj;
    });
    return fallback || root.userData.fallbackRightHand || null;
  }

  function findLeftHandBone(root) {
    let fallback = null;
    const preferred = /(lefthand|left_hand|hand_l|l_hand|mixamolefthand|mixamolefthand1|leftwrist|wrist_l)$/i;
    const broad = /(left.*hand|hand.*left|l.*hand|wrist.*l|l.*wrist)/i;
    root.traverse(obj => {
      const compact = (obj.name || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (!fallback && obj.isBone && broad.test(obj.name || compact)) fallback = obj;
      if (obj.isBone && preferred.test(compact)) fallback = obj;
    });
    return fallback || root.userData.fallbackLeftHand || null;
  }

  // Locate the head bone so unified FP can hide it (eye camera sits inside the head).
  // Prefer an exact "head" match; avoid HeadTop_End / head-end tip bones.
  function findHeadBone(root) {
    let head = null;
    const compact = name => (name || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    root.traverse(obj => {
      if (!obj.isBone) return;
      const n = compact(obj.name);
      if (/^(head|mixamorighead|bip.*head)$/.test(n)) head = obj;
    });
    if (!head) {
      root.traverse(obj => {
        if (head || !obj.isBone) return;
        const n = compact(obj.name);
        if (/head/.test(n) && !/top|end|tip/.test(n)) head = obj;
      });
    }
    return head;
  }

  // Collapse / restore the head bone. Called every frame from applyViewModeVisibility
  // so the near-zero scale is re-applied after the mixer writes bone transforms (the
  // mixer rarely animates scale, but re-applying keeps it robust). No-op unless the
  // unified-FP flag is on and a head bone was found.
  function setHeadBoneHidden(hidden) {
    if (!UNIFIED_FIRST_PERSON) return;
    const head = thirdPerson.headBone;
    if (head) {
      const base = thirdPerson.headBaseScale;
      if (hidden) head.scale.setScalar(UNIFIED_FP_HEAD_HIDE_SCALE);
      else if (base) head.scale.copy(base);
    }
    // Optionally collapse the arm bones too (when the gun is the floating viewmodel the
    // body's raised arms are redundant and intrude into the eye view). Same technique as
    // the head: scale the upper-arm bones to a near-zero point so their skinned verts
    // collapse out of sight. Base scales captured lazily on first hide.
    const arms = thirdPerson.aimBones;
    if (arms && (arms.rightUpperArm || arms.leftUpperArm)) {
      const hideArms = hidden && UNIFIED_FP_HIDE_ARMS;
      for (const key of ["rightUpperArm", "leftUpperArm"]) {
        const bone = arms[key];
        if (!bone) continue;
        if (!bone.userData.unifiedFpBaseScale) bone.userData.unifiedFpBaseScale = bone.scale.clone();
        if (hideArms) bone.scale.setScalar(UNIFIED_FP_HEAD_HIDE_SCALE);
        else bone.scale.copy(bone.userData.unifiedFpBaseScale);
      }
    }
  }

  function configureThirdPersonWeaponTransform(gun) {
    gun.scale.setScalar(0.6);
    gun.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
    });
  }

  function captureThirdPersonPartBase(part) {
    if (!part || part.userData.thirdPersonBase) return;
    part.userData.thirdPersonBase = {
      position: part.position.clone(),
      rotation: part.rotation.clone(),
      scale: part.scale.clone(),
      visible: part.visible,
    };
  }

  function disposeThirdPersonWeapon() {
    if (!thirdPerson.weapon?.gun) return;
    scene.remove(thirdPerson.weapon.gun);
    disposeObject3D(thirdPerson.weapon.gun);
    thirdPerson.weapon = null;
  }

  function createThirdPersonWeapon(gunType = currentGun) {
    if (thirdPerson.weapon?.gun) thirdPerson.weapon.gun.visible = false;

    let nextWeapon = thirdPersonWeaponCache.get(gunType);
    if (!nextWeapon) {
      nextWeapon = createWeaponViewModel(gunType, scene);
      configureThirdPersonWeaponTransform(nextWeapon.gun);
      captureThirdPersonPartBase(nextWeapon.mag);
      captureThirdPersonPartBase(nextWeapon.slide);
      captureWeaponRigPartBases(nextWeapon, "thirdPersonBase");
      thirdPersonWeaponCache.set(gunType, nextWeapon);
    } else if (nextWeapon.gun.parent !== scene) {
      scene.add(nextWeapon.gun);
    }

    thirdPerson.weapon = nextWeapon;
    thirdPerson.weapon.gun.visible = thirdPerson.enabled;
    // Show this weapon's pack-a-punch tier on the third-person model too.
    applyGunPackVisual(thirdPerson.weapon, gunUpgradeLevels[gunType] || 0);
  }

  function applyViewModeVisibility() {
    const thirdPersonVisible = thirdPerson.ready && thirdPerson.enabled && !shouldUseFirstPersonAdsView();
    const cameraLocalRadius = Math.hypot(camera.position.x, camera.position.z);
    const cameraInsidePlayer = thirdPersonVisible && cameraLocalRadius < THIRD_PERSON_MODEL_HIDE_RADIUS;
    // Unified FP: the same body renders from the eye camera. Show the body + in-hand
    // weapon, hide the head bone (camera is inside it), and suppress the floating
    // viewmodel. When the flag is off this is always false → legacy behavior below.
    const unifiedFp = unifiedFirstPersonBodyActive();
    // In unified FP we can either show the real floating viewmodel (reliable, perfectly
    // posed) or the in-hand third-person weapon. The viewmodel path shows weapon.gun and
    // hides the TP weapon; the in-hand path does the reverse.
    const unifiedFpViewmodel = unifiedFp && UNIFIED_FP_USE_VIEWMODEL;
    // Floating viewmodel: legacy FP (or TP-ADS swap), or the unified-FP viewmodel path.
    const firstPersonVisible = ((!thirdPerson.enabled || shouldUseFirstPersonAdsView()) && !unifiedFp) || unifiedFpViewmodel;
    // Body renders in TP, or in unified FP.
    const bodyVisible = (thirdPersonVisible && !cameraInsidePlayer) || unifiedFp;
    // TP in-hand weapon renders in TP, or in unified FP only when NOT using the viewmodel.
    const tpWeaponVisible = (thirdPersonVisible && !cameraInsidePlayer) || (unifiedFp && !UNIFIED_FP_USE_VIEWMODEL);
    if (weapon?.gun) weapon.gun.visible = firstPersonVisible;
    if (thirdPerson.root) thirdPerson.root.visible = bodyVisible && !(unifiedFp && UNIFIED_FP_DEBUG_HIDE_BODY);
    if (thirdPerson.weapon?.gun) thirdPerson.weapon.gun.visible = tpWeaponVisible;
    // Hide the head only in unified FP; restore it in TP / legacy FP.
    setHeadBoneHidden(unifiedFp);
  }

  // Locomotion clips that are UNARMED Mixamo animations (arms swing at the sides).
  // Their arm/hand/shoulder tracks are stripped at action-build time and replaced by
  // the looping upper-body rifle-carry layer (thirdPerson.carryAction) so the gun —
  // which is anchored to the hand midpoint in updateThirdPersonWeaponPose — stays
  // held instead of collapsing to the body's midline while walking.
  const TP_UNARMED_ACTIONS = new Set([
    "walk", "walkBack", "startWalk", "stopWalk", "startWalkBack", "stopWalkBack",
    "strafe", "strafeAlt", "sprint", "sprintLeft", "sprintRight", "runBack",
    "jumpForward", "jumpBack", "jumpNeutral",
  ]);
  const TP_UPPER_BODY_TRACK_RE = /arm|hand|shoulder|clavicle/i;
  function isUpperBodyTrack(track) {
    return TP_UPPER_BODY_TRACK_RE.test(getAnimationTrackNodeName(track.name) || "");
  }
  // Fraction of the original unarmed arm-swing blended back UNDER the rifle-carry
  // layer while moving (0 = frozen carry pose, 1 = full unarmed swing). Kept low so
  // hands stay on the gun (walk-gun-pose spec: span > 0.2) but arms look alive.
  const TP_ARM_SWING_BLEND = 0.18;

  function setThirdPersonAction(name, fade = 0.14) {
    const action = thirdPerson.actions[name] || thirdPerson.actions.idle;
    // Rifle-carry upper-body layer engages only while an arm-stripped clip drives
    // the body (weight is smoothed per-frame in updateThirdPersonAnimation).
    thirdPerson.carryTarget = (TP_UNARMED_ACTIONS.has(name) && thirdPerson.actions[name]) ? 1 : 0;
    // Matching arms-only swing layer for the active locomotion clip (blended under
    // the carry layer at TP_ARM_SWING_BLEND so the arms keep organic motion).
    const nextSwing = (thirdPerson.carryTarget && thirdPerson.armSwingActions?.[name]) || null;
    if (nextSwing !== thirdPerson.armSwingActive) {
      if (thirdPerson.armSwingActive) thirdPerson.armSwingActive.setEffectiveWeight(0);
      if (nextSwing) { nextSwing.reset(); nextSwing.play(); nextSwing.setEffectiveWeight(0); }
      thirdPerson.armSwingActive = nextSwing;
    }
    if (!action || action === thirdPerson.activeAction) return;
    action.enabled = true;
    action.reset();
    action.fadeIn(fade);
    action.play();
    if (thirdPerson.activeAction) thirdPerson.activeAction.fadeOut(fade);
    thirdPerson.activeAction = action;
    thirdPerson.activeActionName = name;
  }

  function prepareThirdPersonActions(model) {
    thirdPerson.actions = {};
    thirdPerson.armSwingActions = {};
    thirdPerson.armSwingActive = null;
    thirdPerson.mixer = new THREE.AnimationMixer(model);

    const ONCE = new Set(["fire", "reload", "jump", "jumpRifle", "jumpNeutral", "jumpForward", "jumpBack", "startWalk", "stopWalk", "startWalkBack", "stopWalkBack", "death"]);
    const source = {
      idle:         PLAYER_CHARACTER_ANIMS.idle,
      walk:         PLAYER_CHARACTER_ANIMS.walk,
      walkBack:     PLAYER_CHARACTER_ANIMS.walkBack,
      startWalk:    PLAYER_CHARACTER_ANIMS.startWalk,
      stopWalk:     PLAYER_CHARACTER_ANIMS.stopWalk,
      startWalkBack:PLAYER_CHARACTER_ANIMS.startWalkBack,
      stopWalkBack: PLAYER_CHARACTER_ANIMS.stopWalkBack,
      strafe:       PLAYER_CHARACTER_ANIMS.strafe || PLAYER_CHARACTER_ANIMS.strafeAlt,
      strafeAlt:    PLAYER_CHARACTER_ANIMS.strafeAlt,
      sprint:       PLAYER_CHARACTER_ANIMS.sprint,
      rifleRun:     PLAYER_CHARACTER_ANIMS.rifleRun,
      sprintLeft:   PLAYER_CHARACTER_ANIMS.sprintLeft,
      sprintRight:  PLAYER_CHARACTER_ANIMS.sprintRight,
      runBack:      PLAYER_CHARACTER_ANIMS.runBack,
      jump:         PLAYER_CHARACTER_ANIMS.jump || PLAYER_CHARACTER_ANIMS.fallbackJump,
      jumpRifle:    PLAYER_CHARACTER_ANIMS.jump,
      jumpNeutral:  PLAYER_CHARACTER_ANIMS.fallbackJump,
      jumpForward:  PLAYER_CHARACTER_ANIMS.jumpForward || PLAYER_CHARACTER_ANIMS.jump,
      jumpBack:     PLAYER_CHARACTER_ANIMS.jumpBack || PLAYER_CHARACTER_ANIMS.jump,
      fire:         PLAYER_CHARACTER_ANIMS.fire,
      reload:       PLAYER_CHARACTER_ANIMS.reload,
      death:        PLAYER_CHARACTER_ANIMS.death,
    };

    for (const [name, rawClip] of Object.entries(source)) {
      if (!rawClip) continue;
      let clip = makeInPlaceClipForModel(rawClip, model);
      if (!clip.tracks.length) continue;
      // Unarmed locomotion: drop the swinging arm/hand/shoulder tracks — the
      // upper-body rifle-carry layer below poses the arms instead, so the gun
      // (anchored to the hand midpoint) stays held while walking/sprinting.
      if (TP_UNARMED_ACTIONS.has(name)) {
        const legTracks = clip.tracks.filter(t => !isUpperBodyTrack(t));
        const armTracks = clip.tracks.filter(isUpperBodyTrack);
        if (legTracks.length && legTracks.length !== clip.tracks.length) {
          // Keep the ORIGINAL arm swing as its own arms-only action so a fraction
          // of it can be blended back under the carry layer (organic motion).
          if (armTracks.length) {
            const swingClip = new THREE.AnimationClip(`${clip.name}_armswing`, clip.duration, armTracks);
            const swing = thirdPerson.mixer.clipAction(swingClip);
            swing.loop = ONCE.has(name) ? THREE.LoopOnce : THREE.LoopRepeat;
            swing.clampWhenFinished = ONCE.has(name);
            swing.enabled = true;
            swing.setEffectiveWeight(0);
            thirdPerson.armSwingActions[name] = swing;
          }
          clip = new THREE.AnimationClip(`${clip.name}_legs`, clip.duration, legTracks);
        }
      }
      const action = thirdPerson.mixer.clipAction(clip);
      action.loop = ONCE.has(name) ? THREE.LoopOnce : THREE.LoopRepeat;
      action.clampWhenFinished = ONCE.has(name);
      action.enabled = true;
      thirdPerson.actions[name] = action;
    }

    // Upper-body rifle-carry layer: the idle clip ("Rifle Aiming Idle") filtered to
    // arm/hand/shoulder tracks only, always playing; its weight fades in only while
    // an arm-stripped locomotion action is active (see setThirdPersonAction +
    // updateThirdPersonAnimation). Full-body clips (fire/reload/rifle jump/idle)
    // keep exclusive arm control because the layer's weight is 0 then.
    thirdPerson.carryAction = null;
    thirdPerson.carryWeight = 0;
    thirdPerson.carryTarget = 0;
    if (PLAYER_CHARACTER_ANIMS.idle) {
      const idleClip = makeInPlaceClipForModel(PLAYER_CHARACTER_ANIMS.idle, model);
      const upperTracks = idleClip.tracks.filter(isUpperBodyTrack);
      if (upperTracks.length) {
        const carryClip = new THREE.AnimationClip("rifleCarryUpper", idleClip.duration, upperTracks);
        const carry = thirdPerson.mixer.clipAction(carryClip);
        carry.loop = THREE.LoopRepeat;
        carry.enabled = true;
        carry.setEffectiveWeight(0);
        carry.play();
        thirdPerson.carryAction = carry;
      }
    }
  }

  function createThirdPersonCharacter() {
    if (thirdPerson.root) {
      clearThirdPersonAimOffsets();
      scene.remove(thirdPerson.root);
      disposeObject3D(thirdPerson.root);
    }
    thirdPerson.ready = false;
    thirdPerson.leftHand = null;
    const root = new THREE.Group();
    root.name = "Third person player";

    let model = PLAYER_CHARACTER_FBX && skeletonClone ? skeletonClone(PLAYER_CHARACTER_FBX) : createFallbackThirdPersonModel();
    model.name = "Player black mask model";
    root.add(model);
    scene.add(root);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = PLAYER_H / Math.max(0.001, size.y || PLAYER_H);
    model.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    const aligned = new THREE.Box3().setFromObject(model);
    const center = aligned.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= aligned.min.y;
    model.position.z -= center.z;
    model.rotation.y = Math.PI;

    model.traverse(obj => {
      if (!obj.isMesh) return;
      // Player casts a real sun shadow (shadowMap.autoUpdate is on outside low-end
      // mode). receiveShadow stays off: self-shadowing a skinned rig invites acne.
      obj.castShadow = !lowEndMode;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
    });

    prepareThirdPersonActions(model);
    thirdPerson.root = root;
    thirdPerson.model = model;
    thirdPerson.rightHand = findRightHandBone(model);
    thirdPerson.leftHand  = findLeftHandBone(model);
    thirdPerson.aimBones  = findArmBones(model);
    thirdPerson.headBone  = findHeadBone(model);
    thirdPerson.headBaseScale = thirdPerson.headBone ? thirdPerson.headBone.scale.clone() : null;
    thirdPerson.aimBlend  = 0;
    thirdPerson.aimOffsets = [];
    thirdPerson.firePunch = 0;
    thirdPerson.firePunchVel = 0;
    thirdPerson.ready = true;
    createThirdPersonWeapon(currentGun);
    setThirdPersonAction("idle", 0);
    applyViewModeVisibility();
  }

  function createHumanoidEnemyActions(model) {
    const mixer = new THREE.AnimationMixer(model);
    const ONCE = new Set(["fire", "reload", "jump", "jumpRifle", "jumpNeutral", "jumpForward", "jumpBack", "startWalk", "stopWalk", "startWalkBack", "stopWalkBack", "death"]);
    const source = {
      idle:         PLAYER_CHARACTER_ANIMS.idle,
      walk:         PLAYER_CHARACTER_ANIMS.walk,
      walkBack:     PLAYER_CHARACTER_ANIMS.walkBack,
      startWalk:    PLAYER_CHARACTER_ANIMS.startWalk,
      stopWalk:     PLAYER_CHARACTER_ANIMS.stopWalk,
      startWalkBack:PLAYER_CHARACTER_ANIMS.startWalkBack,
      stopWalkBack: PLAYER_CHARACTER_ANIMS.stopWalkBack,
      strafe:       PLAYER_CHARACTER_ANIMS.strafe || PLAYER_CHARACTER_ANIMS.strafeAlt,
      strafeAlt:    PLAYER_CHARACTER_ANIMS.strafeAlt,
      sprint:       PLAYER_CHARACTER_ANIMS.sprint,
      rifleRun:     PLAYER_CHARACTER_ANIMS.rifleRun,
      sprintLeft:   PLAYER_CHARACTER_ANIMS.sprintLeft,
      sprintRight:  PLAYER_CHARACTER_ANIMS.sprintRight,
      runBack:      PLAYER_CHARACTER_ANIMS.runBack,
      jump:         PLAYER_CHARACTER_ANIMS.jump || PLAYER_CHARACTER_ANIMS.fallbackJump,
      jumpRifle:    PLAYER_CHARACTER_ANIMS.jump,
      jumpNeutral:  PLAYER_CHARACTER_ANIMS.fallbackJump,
      jumpForward:  PLAYER_CHARACTER_ANIMS.jumpForward || PLAYER_CHARACTER_ANIMS.jump,
      jumpBack:     PLAYER_CHARACTER_ANIMS.jumpBack || PLAYER_CHARACTER_ANIMS.jump,
      fire:         PLAYER_CHARACTER_ANIMS.fire,
      reload:       PLAYER_CHARACTER_ANIMS.reload,
      death:        PLAYER_CHARACTER_ANIMS.death,
    };
    const actions = {};
    for (const [name, rawClip] of Object.entries(source)) {
      if (!rawClip) continue;
      const clip = makeInPlaceClipForModel(rawClip, model);
      if (!clip.tracks.length) continue;
      const action = mixer.clipAction(clip);
      action.loop = ONCE.has(name) ? THREE.LoopOnce : THREE.LoopRepeat;
      action.clampWhenFinished = ONCE.has(name);
      action.enabled = true;
      actions[name] = action;
    }
    return { mixer, actions, activeAction: null, activeActionName: "" };
  }

  function setHumanoidEnemyAction(enemy, name, fade = 0.14) {
    const ghost = enemy.mesh.userData.clonedGhost;
    if (!ghost?.actions) return;
    const action = ghost.actions[name] || ghost.actions.idle;
    if (!action || action === ghost.activeAction) return;
    action.enabled = true;
    action.reset();
    action.fadeIn(fade);
    action.play();
    if (ghost.activeAction) ghost.activeAction.fadeOut(fade);
    ghost.activeAction = action;
    ghost.activeActionName = name;
  }

  function setThirdPersonEnabled(nextEnabled, announce = true) {
    if (THIRD_PERSON_ONLY) nextEnabled = true; // FP removed — always third-person
    if (thirdPerson.enabled === nextEnabled) return;
    if (!nextEnabled) clearThirdPersonAimOffsets();
    thirdPerson.enabled = nextEnabled;
    if (thirdPerson.enabled && !thirdPerson.ready) createThirdPersonCharacter();
    if (!thirdPerson.enabled) viewState.ads = 0;
    thirdPerson.switchPulse = 1;
    applyViewModeVisibility();
    if (announce) addKillFeed(thirdPerson.enabled ? "THIRD PERSON VIEW" : "FIRST PERSON VIEW");
  }

  function toggleThirdPersonView() {
    if (THIRD_PERSON_ONLY) return; // FP removed — toggle disabled
    thirdPerson.adsSwapProgress = Math.max(thirdPerson.adsSwapProgress || 0, 0.15);
    setThirdPersonEnabled(!thirdPerson.enabled, true);
  }

  function clearThirdPersonAimOffsets() {
    if (!thirdPerson.aimOffsets?.length) return;
    for (const applied of thirdPerson.aimOffsets) {
      if (!applied?.bone) continue;
      applied.bone.quaternion.premultiply(_aimOffsetInvQuat.copy(applied.quat).invert());
    }
    thirdPerson.aimOffsets.length = 0;
  }

  // Apply a world-space pitch rotation to a single bone additively on top of whatever the
  // AnimationMixer already wrote this frame. The offset is recorded so the next frame can
  // remove it before mixer.update(), preventing unkeyed bones from accumulating rotations.
  function applyWorldPitchToBone(bone, angle) {
    if (!bone || !bone.parent || Math.abs(angle) < 0.0001) return;
    angle = clamp(angle, -1.05, 1.05);
    _aimWorldRight.set(Math.cos(yaw.rotation.y), 0, -Math.sin(yaw.rotation.y));
    bone.parent.getWorldQuaternion(_aimParentQuat);
    _aimLocalAxis.copy(_aimWorldRight).applyQuaternion(_aimParentQuat.invert()).normalize();
    _aimOffsetQuat.setFromAxisAngle(_aimLocalAxis, angle);
    bone.quaternion.premultiply(_aimOffsetQuat);
    thirdPerson.aimOffsets.push({ bone, quat: _aimOffsetQuat.clone() });
  }

  // Called every frame after mixer.update() and before updateThirdPersonWeaponPose().
  // Smoothly blends arm bones from the animation's native carry pose toward a camera-pitched
  // aim pose, and applies a spring-backed punch impulse on fire.
  function applyThirdPersonArmPose(dt) {
    const b = thirdPerson.aimBones;
    if (!b) return;

    // â"€â"€ Aim blend â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    // Full raise when aiming or in the brief window after firing; otherwise 0 so
    // the idle/walk clip fully controls the arms (gun lowered / hip-carry pose).
    // In unified FP the arms must ALWAYS be up (we view the gun from the eye), so
    // force the blend to 1 whenever the unified body is the active view.
    const unifiedFp = unifiedFirstPersonBodyActive();
    const aimTarget = (unifiedFp || mouse.aiming || thirdPerson.fireTimer > 0) ? 1.0 : 0.0;
    thirdPerson.aimBlend += (aimTarget - thirdPerson.aimBlend) * Math.min(1, dt * 9);

    // â"€â"€ Fire punch spring â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    thirdPerson.firePunchVel += (-thirdPerson.firePunch * 55 - thirdPerson.firePunchVel * 13) * dt;
    thirdPerson.firePunchVel = clamp(thirdPerson.firePunchVel, -7.5, 5.5);
    thirdPerson.firePunch    += thirdPerson.firePunchVel * dt;
    thirdPerson.firePunch = clamp(thirdPerson.firePunch, -0.36, 0.24);

    const blend = thirdPerson.aimBlend;
    const punch = clamp(thirdPerson.firePunch, -0.34, 0.22);

    // Knife melee: procedural right-arm swing over the 0.34 s melee window
    // (same upper-body override technique as the carry/aim layers — code-driven
    // bone rotation on top of the mixer, removed next frame via aimOffsets).
    const meleeT = player.meleeTimer > 0 ? 1 - player.meleeTimer / 0.34 : 0;
    const meleeSwing = meleeT > 0 ? Math.sin(meleeT * Math.PI) : 0;

    // Gait-synced carry sway: while the rifle-carry layer holds the arms during
    // locomotion, pump the gun gently with each step (phase from the active
    // locomotion action's normalized time, 2 steps per loop). Gain follows
    // carryWeight so it fades with the layer, and drops while aiming/firing so
    // it never fights ADS or recoil. Purely additive via applyWorldPitchToBone,
    // so it is removed next frame like every other aim offset.
    let swayUpper = 0, swayFore = 0, swaySpine = 0;
    const carryW = thirdPerson.carryWeight || 0;
    const act = thirdPerson.activeAction;
    if (!unifiedFp && carryW > 0.02 && act) {
      const clip = act.getClip?.();
      const dur = clip?.duration || 1;
      const phase = (act.time / dur) * Math.PI * 2 * 2; // 2 steps per locomotion loop
      const amp = thirdPerson.lastMove?.sprinting ? 0.085 : 0.05;
      const gain = carryW * (1 - blend * 0.75);
      swayUpper = Math.sin(phase) * amp * gain;
      swayFore  = Math.sin(phase - 0.6) * amp * 0.55 * gain;   // forearm lags slightly
      swaySpine = Math.sin(phase + 0.5) * amp * 0.35 * gain;   // torso slightly leads
    }

    // Nothing to do if fully lowered and no punch residue or sway
    if (blend < 0.005 && Math.abs(punch) < 0.001 && meleeSwing < 0.001 && Math.abs(swayUpper) < 0.0005 && Math.abs(swaySpine) < 0.0005) return;

    const camPitch = clamp(pitch.rotation.x, -0.92, 0.92); // negative = looking up, positive = looking down

    // ARM_RAISE_BIAS: static offset that lifts arms from the animation's hip-carry position
    // to a gun-ready shoulder height when blend = 1 and camPitch = 0 (looking straight ahead).
    // Tune this value if the rig's idle pose already has the arms high (reduce toward 0)
    // or very low (increase magnitude).
    // Unified FP tracks camera pitch far more strongly than the TP over-shoulder
    // pose so the held gun stays centered in view when looking up/down.
    const ARM_RAISE_BIAS         = unifiedFp ? UNIFIED_FP_ARM_RAISE_BIAS  : -0.42;
    const UPPER_ARM_PITCH_FACTOR = unifiedFp ? UNIFIED_FP_UPPER_ARM_PITCH :  0.42; // how much camera pitch drives the upper arm
    const FOREARM_PITCH_FACTOR   = unifiedFp ? UNIFIED_FP_FOREARM_PITCH   :  0.16; // additional forearm follow-through
    const SPINE_PITCH_FACTOR     = unifiedFp ? UNIFIED_FP_SPINE_PITCH     :  0.12; // torso lean into aim direction
    const PUNCH_ARM_FACTOR       =  0.24; // fire punch magnitude on upper arms
    const PUNCH_FOREARM_FACTOR   =  0.12;
    const PUNCH_SPINE_FACTOR     =  0.06;

    // Unified FP: keep clamps TIGHT — large world-space arm rotation tears the skinned
    // mesh apart, so the arms may only pitch a little around their gripping pose.
    const upperLo = unifiedFp ? -0.35 : -0.82;
    const upperHi = unifiedFp ?  0.30 :  0.38;
    const foreLim = unifiedFp ?  0.20 :  0.28;
    const upperArmAngle = clamp((ARM_RAISE_BIAS + camPitch * UPPER_ARM_PITCH_FACTOR) * blend
                          + punch * PUNCH_ARM_FACTOR + swayUpper, upperLo, upperHi);
    const foreArmAngle  = clamp(camPitch * FOREARM_PITCH_FACTOR * blend
                          + punch * PUNCH_FOREARM_FACTOR + swayFore, -foreLim, foreLim);
    const spineAngle    = clamp(camPitch * SPINE_PITCH_FACTOR * blend
                          + punch * PUNCH_SPINE_FACTOR + swaySpine, -0.16, 0.16);

    // Spine leans into the aim direction
    applyWorldPitchToBone(b.spine,         spineAngle);

    // Per-gun grip style. A two-handed weapon raises/punches BOTH arms together
    // (rifle grip). A one-handed weapon (pistol) drives the RIGHT arm normally but
    // the LEFT (support) hand stays lower/tucked and takes only a fraction of the
    // fire punch — otherwise the symmetric punch jerks both arms up on every shot,
    // which reads as a flail on a handgun. See GUN_SPECS[...].gripStyle.
    const oneHand = GUN_SPECS[currentGun]?.gripStyle === "oneHand";
    if (oneHand) {
      // Right arm: full raise, but a slightly softer punch than a rifle.
      const rightUpper = clamp((ARM_RAISE_BIAS + camPitch * UPPER_ARM_PITCH_FACTOR) * blend
                          + punch * PUNCH_ARM_FACTOR * 0.7 + swayUpper, upperLo, upperHi);
      const rightFore  = clamp(camPitch * FOREARM_PITCH_FACTOR * blend
                          + punch * PUNCH_FOREARM_FACTOR * 0.7 + swayFore, -foreLim, foreLim);
      // Left (support) arm: tucked clearly LOWER than the firing arm. Note the
      // sign convention (measured, not assumed): ARM_RAISE_BIAS pulls the arms
      // DOWN from the clip's raised aiming pose, so the support arm needs MORE
      // bias (1.6×), not less — scaling it down leaves the hand floating at
      // rifle-foregrip height with nothing to hold. Takes only a sliver of the
      // punch → no outward splay on fire.
      const leftUpper = clamp((ARM_RAISE_BIAS * 1.6 + camPitch * UPPER_ARM_PITCH_FACTOR * 0.5) * blend
                          + punch * PUNCH_ARM_FACTOR * 0.15 + swayUpper * 0.5, upperLo, upperHi);
      const leftFore  = clamp(camPitch * FOREARM_PITCH_FACTOR * 0.5 * blend
                          + punch * PUNCH_FOREARM_FACTOR * 0.25 + swayFore * 0.5, -foreLim, foreLim);
      applyWorldPitchToBone(b.rightUpperArm, rightUpper);
      applyWorldPitchToBone(b.leftUpperArm,  leftUpper);
      applyWorldPitchToBone(b.rightForeArm,  rightFore);
      applyWorldPitchToBone(b.leftForeArm,   leftFore);
    } else {
      // Both upper arms raise/lower together (two-handed rifle grip)
      applyWorldPitchToBone(b.rightUpperArm, upperArmAngle);
      applyWorldPitchToBone(b.leftUpperArm,  upperArmAngle);
      // Forearms add a smaller follow-through so the elbow doesn't look locked
      applyWorldPitchToBone(b.rightForeArm,  foreArmAngle);
      applyWorldPitchToBone(b.leftForeArm,   foreArmAngle);
    }

    // Knife swing layered on the RIGHT arm only: wind-up raises the arm, then the
    // chop drives it down and across. Skipped in unified FP (tight clamps there).
    if (meleeSwing > 0.001 && !unifiedFp) {
      const windup = Math.sin(Math.min(1, meleeT / 0.45) * Math.PI * 0.5);
      const chop = meleeT > 0.45 ? Math.sin(((meleeT - 0.45) / 0.55) * Math.PI) : 0;
      applyWorldPitchToBone(b.rightUpperArm, -0.85 * windup + 1.15 * chop);
      applyWorldPitchToBone(b.rightForeArm,  -0.42 * windup + 0.55 * chop);
    }
  }

  // A detached "fresh clip" the right hand carries into the mag well during reload.
  // Cloned from the current gun's own magazine so it matches visually. Rebuilt when
  // the weapon changes; hidden whenever a reload isn't staging it.
  function ensureReloadClip() {
    const magSrc = thirdPerson.weapon?.mag;
    if (!magSrc) return null;
    if (thirdPerson.reloadClip && thirdPerson.reloadClipGun === currentGun) return thirdPerson.reloadClip;
    if (thirdPerson.reloadClip) {
      thirdPerson.reloadClip.parent?.remove(thirdPerson.reloadClip);
      thirdPerson.reloadClip = null;
    }
    const clip = magSrc.clone(true);
    clip.name = "ReloadClip";
    clip.visible = false;
    clip.traverse(o => { o.frustumCulled = false; if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(clip);
    thirdPerson.reloadClip = clip;
    thirdPerson.reloadClipGun = currentGun;
    return clip;
  }

  // Stage the reload: the OLD mag drops out of the gun (existing magDrop), then it's
  // hidden while the RIGHT hand brings a fresh clip up to the well; on seat the clip
  // hides and the gun's mag reappears seated (existing magSeat pulse). Timing is keyed
  // off reloadT so it stays in lock-step with the character's reload animation clip.
  // Per-reloadStyle staging for the fresh-clip transit. All keys are fractions
  // of reloadT, so every gun's staging auto-scales to its own reloadTime.
  //  show0/1 = clip visible window, hide0/1 = gun's own mag hidden window
  //  (null = mag never hidden, e.g. shell loaders), t0/span = travel timing,
  //  arc = lift height, reps = repeated hand→receiver inserts, from = start
  //  point ("hand" = right hand, "low" = heaved from the hip, "top" = above/behind).
  const RELOAD_CLIP_STYLES = {
    mag:     { show0: 0.16, show1: 0.58, hide0: 0.30, hide1: 0.56, t0: 0.20, span: 0.34, arc: 0.05, reps: 1, from: "hand" },
    drum:    { show0: 0.14, show1: 0.62, hide0: 0.26, hide1: 0.60, t0: 0.18, span: 0.40, arc: 0.16, reps: 1, from: "low" },
    shells:  { show0: 0.15, show1: 0.78, hide0: null, hide1: null, t0: 0.15, span: 0.63, arc: 0.06, reps: 3, from: "hand" },
    topLoad: { show0: 0.16, show1: 0.60, hide0: 0.30, hide1: 0.58, t0: 0.20, span: 0.36, arc: 0.12, reps: 1, from: "top" },
  };

  function updateThirdPersonReloadClip(reloadActive, reloadT, rightHandTmp, easeReload) {
    const clip = ensureReloadClip();
    const mag = thirdPerson.weapon?.mag;
    if (!clip || !mag) return;
    const st = RELOAD_CLIP_STYLES[GUN_SPECS[currentGun]?.reloadStyle] || RELOAD_CLIP_STYLES.mag;

    // Gun's own mag/drum: visible while ejecting (dropping out), hidden mid-transit,
    // then visible again once the fresh clip/drum has seated. Shell-by-shell guns
    // keep their (tube) mag seated the whole time.
    mag.visible = !(reloadActive && st.hide0 !== null && reloadT > st.hide0 && reloadT < st.hide1);

    const show = reloadActive && reloadT > st.show0 && reloadT < st.show1;
    clip.visible = show;
    if (!show) return;

    // Seated mag-well world transform = the mag's base local pose put through the gun's
    // (now-posed) world matrix, so the target is the true seated spot, not the dropped one.
    thirdPerson.weapon.gun.updateMatrixWorld(true);
    const magBase = mag.userData?.thirdPersonBase;
    if (magBase) reloadWellTmp.copy(magBase.position).applyMatrix4(thirdPerson.weapon.gun.matrixWorld);
    else mag.getWorldPosition(reloadWellTmp);
    mag.getWorldQuaternion(reloadClipQuatTmp);
    mag.getWorldScale(reloadClipScaleTmp);

    // Travel from the style's start point into the well across the insert window.
    // Shell-by-shell styles repeat the hand→receiver motion (reps > 1).
    let tRaw = (reloadT - st.t0) / st.span;
    if (st.reps > 1) tRaw = (Math.max(0, Math.min(0.999, tRaw)) * st.reps) % 1;
    const travel = easeReload(tRaw);
    reloadClipStartTmp.copy(rightHandTmp);
    if (st.from === "low") {
      reloadClipStartTmp.y -= 0.22; // drum heaved up from hip height
    } else if (st.from === "top") {
      // Top/rear insert: the round starts above and behind the receiver.
      reloadClipStartTmp.y += 0.34;
      reloadClipStartTmp.x -= (reloadWellTmp.x - rightHandTmp.x) * 0.4;
      reloadClipStartTmp.z -= (reloadWellTmp.z - rightHandTmp.z) * 0.4;
    }
    clip.position.copy(reloadClipStartTmp).lerp(reloadWellTmp, travel);
    // An arc so the clip rises into the well rather than sliding flat
    // (per-style height: drums swing wide, mags barely lift).
    clip.position.y += Math.sin(Math.min(1, Math.max(0, travel)) * Math.PI) * st.arc * (1 - travel);
    clip.quaternion.copy(reloadClipQuatTmp);
    clip.scale.copy(reloadClipScaleTmp);
  }

  function updateThirdPersonWeaponPose() {
    if (!thirdPerson.weapon?.gun || !thirdPerson.root) return;

    const forward = thirdPersonForwardTmp.set(-Math.sin(yaw.rotation.y), 0, -Math.cos(yaw.rotation.y));
    const right = thirdPersonRightTmp.set(Math.cos(yaw.rotation.y), 0, -Math.sin(yaw.rotation.y));
    const rightHandTmp = thirdPersonHandTmp;
    const leftHandTmp = new THREE.Vector3();
    let rightReady = false;
    let leftReady = false;

    if (thirdPerson.rightHand) {
      thirdPerson.rightHand.getWorldPosition(rightHandTmp);
      rightReady = Number.isFinite(rightHandTmp.x);
    }
    if (thirdPerson.leftHand) {
      thirdPerson.leftHand.getWorldPosition(leftHandTmp);
      leftReady = Number.isFinite(leftHandTmp.x);
    }

    if (!rightReady) {
      rightHandTmp
        .copy(thirdPerson.root.position)
        .addScaledVector(right, 0.28)
        .addScaledVector(forward, 0.18);
      rightHandTmp.y += 1.02;
    }

    if (!leftReady) {
      leftHandTmp
        .copy(thirdPerson.root.position)
        .addScaledVector(right, -0.34)
        .addScaledVector(forward, 0.08);
      leftHandTmp.y += 1.0;
    }

    const handCenter = leftHandTmp.clone().add(rightHandTmp).multiplyScalar(0.5);
    const handSpan = rightHandTmp.clone().sub(leftHandTmp);
    const spanLen = handSpan.length();
    const spanDir = spanLen > 0.001 ? handSpan.multiplyScalar(1 / spanLen) : right.clone();
    const reloadActive = thirdPerson.reloadTimer > 0;
    const reloadDuration = GUN_SPECS[currentGun]?.reloadTime || 1;
    const reloadT = reloadActive ? 1 - thirdPerson.reloadTimer / reloadDuration : 0;
    const easeReload = v => {
      const t = Math.max(0, Math.min(1, v));
      return t * t * (3 - 2 * t);
    };
    const reloadPresent = reloadActive ? Math.sin(Math.min(1, reloadT / 0.34) * Math.PI * 0.5) * (1 - easeReload((reloadT - 0.82) / 0.18)) : 0;
    const magDrop = reloadActive ? easeReload((reloadT - 0.16) / 0.16) * (1 - easeReload((reloadT - 0.5) / 0.14)) : 0;
    const magSeat = reloadActive ? Math.sin(Math.max(0, Math.min(1, (reloadT - 0.48) / 0.2)) * Math.PI) : 0;
    const actionRack = reloadActive ? Math.sin(Math.max(0, Math.min(1, (reloadT - 0.68) / 0.2)) * Math.PI) : 0;
    const shotT = gunState.muzzleTimer > 0 ? Math.min(1, gunState.muzzleTimer / weaponAnim.animSpec.muzzleFlashDuration) : 0;
    restoreWeaponRigAnimParts(thirdPerson.weapon, "thirdPersonBase");

    if (thirdPerson.weapon.mag?.userData.thirdPersonBase) {
      const base = thirdPerson.weapon.mag.userData.thirdPersonBase;
      thirdPerson.weapon.mag.position.copy(base.position);
      thirdPerson.weapon.mag.rotation.copy(base.rotation);
      if (base.scale) thirdPerson.weapon.mag.scale.copy(base.scale);
      if (reloadActive) {
        thirdPerson.weapon.mag.position.y -= magDrop * 0.26 + magSeat * 0.035;
        thirdPerson.weapon.mag.position.x -= magDrop * 0.045;
        thirdPerson.weapon.mag.rotation.z -= magDrop * 0.42;
        thirdPerson.weapon.mag.rotation.x += magDrop * 0.18;
      }
    }

    if (thirdPerson.weapon.slide?.userData.thirdPersonBase) {
      const base = thirdPerson.weapon.slide.userData.thirdPersonBase;
      thirdPerson.weapon.slide.position.copy(base.position);
      thirdPerson.weapon.slide.rotation.copy(base.rotation);
      if (base.scale) thirdPerson.weapon.slide.scale.copy(base.scale);
      if (reloadActive) {
        // Post-reload action rack: throw scaled by the gun's reload mechanism.
        const rs = GUN_SPECS[currentGun]?.reloadStyle;
        const rackTravel = rs === "shells" ? 0.24 : rs === "topLoad" ? 0.16 : rs === "drum" ? 0.12 : 0.08;
        thirdPerson.weapon.slide.position.x -= actionRack * rackTravel;
      }
    }
    applyWeaponDesignAnimation(thirdPerson.weapon, currentGun, {
      shotT,
      reloadActive,
      reloadT,
      actionRack,
      kick: thirdPerson.recoilBack,
      slideKick: shotT,
      // Fire-cycle drive (per-gun mechanical animation in applyWeaponDesignAnimation).
      firing: gunState.fireCooldown > 0,
      cycleT: 1 - gunState.fireCooldown / Math.max(gunState.fireRate || 0.01, 0.01),
      magEmpty: gunState.mag <= 0,
      magCount: gunState.mag,
      magSize: gunState.magSize,
    });

    // Grip anchor. Normally the two-handed centre; during reload the LEFT (support)
    // hand cradles the gun so the RIGHT hand is free to fetch/insert the fresh clip.
    // Without this the gun stays pinned to the hand-centre and drags toward the right
    // hand as it pulls away — which is what read as "off".
    const gripAnchor = reloadGripTmp.copy(handCenter);
    // One-handed (pistol) grip: the gun lives in the RIGHT (firing) hand, not the
    // two-hand centre — with the support hand tucked lower (see the oneHand branch
    // in applyThirdPersonArmPose), the centre sags and the pistol would float
    // between the hands instead of sitting in the grip.
    if (GUN_SPECS[currentGun]?.gripStyle === "oneHand" && !reloadActive) {
      gripAnchor.lerp(rightHandTmp, 0.85);
    }
    if (reloadActive) {
      // Left-hand cradle point: at the support hand, nudged slightly forward/up so the
      // receiver sits in the palm rather than clipping through it.
      const leftCradleX = leftHandTmp.x + forward.x * 0.12 + right.x * 0.05;
      const leftCradleY = leftHandTmp.y + 0.05;
      const leftCradleZ = leftHandTmp.z + forward.z * 0.12 + right.z * 0.05;
      const bias = reloadPresent * 0.9;
      gripAnchor.x += (leftCradleX - gripAnchor.x) * bias;
      gripAnchor.y += (leftCradleY - gripAnchor.y) * bias;
      gripAnchor.z += (leftCradleZ - gripAnchor.z) * bias;
    }
    thirdPerson.weapon.gun.position
      .copy(gripAnchor)
      .addScaledVector(forward, 0.18)
      .addScaledVector(right, 0.01);
    thirdPerson.weapon.gun.position.y += 0.06;
    thirdPerson.weapon.gun.position.addScaledVector(forward, 0.03);

    // Unified-FP weapon fit. Two paths:
    //  • camera-relative (UNIFIED_FP_GUN_CAMERA_RELATIVE): place the gun as a floating
    //    viewmodel using the TP mesh (front/lower/right of the eye, fixed orientation).
    //  • in-hand (default): keep the natural hand-grip placement set above (the body's
    //    hands are already animated to hold a rifle), only scaling the gun for the eye
    //    cam and nudging it slightly. This reads as the operator actually holding the gun.
    // Both are gated on the unified body being active — third person is untouched.
    if (unifiedFirstPersonBodyActive()) {
      thirdPerson.weapon.gun.scale.setScalar(0.6 * UNIFIED_FP_GUN_SCALE);
      if (UNIFIED_FP_GUN_CAMERA_RELATIVE) {
        const cam = camera;
        cam.getWorldPosition(fpGunCamPos);
        const m = cam.matrixWorld.elements;
        fpGunRight.set(m[0], m[1], m[2]).normalize();
        fpGunUp.set(m[4], m[5], m[6]).normalize();
        fpGunFwd.set(-m[8], -m[9], -m[10]).normalize();
        thirdPerson.weapon.gun.position.copy(fpGunCamPos)
          .addScaledVector(fpGunFwd,   UNIFIED_FP_GUN_FORWARD)
          .addScaledVector(fpGunRight, UNIFIED_FP_GUN_RIGHT)
          .addScaledVector(fpGunUp,    UNIFIED_FP_GUN_UP);
        cam.getWorldQuaternion(fpGunCamQuat);
        fpGunLocalEuler.set(UNIFIED_FP_GUN_ROT_X, UNIFIED_FP_GUN_ROT_Y, UNIFIED_FP_GUN_ROT_Z);
        fpGunLocalQuat.setFromEuler(fpGunLocalEuler);
        thirdPerson.weapon.gun.quaternion.copy(fpGunCamQuat).multiply(fpGunLocalQuat);
      } else {
        // In-hand: nudge the natural grip placement (world basis) for framing.
        thirdPerson.weapon.gun.position
          .addScaledVector(forward, UNIFIED_FP_GUN_FORWARD)
          .addScaledVector(right,   UNIFIED_FP_GUN_RIGHT);
        thirdPerson.weapon.gun.position.y += UNIFIED_FP_GUN_UP;
      }
    } else if (thirdPerson.weapon.gun.scale.x !== 0.6) {
      thirdPerson.weapon.gun.scale.setScalar(0.6);
    }
    if (reloadActive) {
      thirdPerson.weapon.gun.position
        .addScaledVector(right, -0.08 * reloadPresent + 0.035 * magSeat)
        .addScaledVector(forward, -0.08 * reloadPresent + 0.025 * actionRack);
      thirdPerson.weapon.gun.position.y -= 0.1 * reloadPresent - 0.03 * magSeat;
    }
    thirdPerson.weapon.gun.rotation.set(
      -pitch.rotation.x * 0.96 - reloadPresent * 0.22 + actionRack * 0.08,
      yaw.rotation.y + Math.PI * 0.5 - reloadPresent * 0.18 + magSeat * 0.08,
      spanDir.z * 0.08 - 0.1 + reloadPresent * 0.42 - magSeat * 0.18
    );

    // Per-gun feel layered on top of the absolute pose set above (all additive,
    // recomputed every frame — never accumulates):
    //  • muzzle lag: heavy guns' muzzle trails quick turns (spring in
    //    updateThirdPersonCharacter, weight from spec.swayMul)
    //  • rattle: SMG-class high-frequency jitter while firing (spec.driftMul)
    //  • equip: lower/raise dip on weapon switch (spec.equipTime)
    thirdPerson.weapon.gun.rotation.y += thirdPerson.gunLag;
    thirdPerson.weapon.gun.rotation.z += thirdPerson.gunLag * 0.35;
    const tpSpec = GUN_SPECS[currentGun] || ({} as any);
    if (tpSpec.fireCycle === "rattle" && gunState.fireCooldown > 0 && !reloadActive) {
      const tj = performance.now();
      const jAmp = 0.006 * (Number.isFinite(tpSpec.driftMul) ? tpSpec.driftMul : 1);
      thirdPerson.weapon.gun.position.x += Math.sin(tj * 0.121) * jAmp;
      thirdPerson.weapon.gun.position.y += Math.sin(tj * 0.163) * jAmp * 0.8;
      thirdPerson.weapon.gun.rotation.z += Math.sin(tj * 0.147) * jAmp * 1.6;
    }
    if (thirdPerson.equip > 0) {
      const e = thirdPerson.equip * thirdPerson.equip; // ease-out raise
      thirdPerson.weapon.gun.position.y -= e * 0.34;
      thirdPerson.weapon.gun.position.addScaledVector(forward, -e * 0.08);
      thirdPerson.weapon.gun.rotation.x -= e * 0.55;
      thirdPerson.weapon.gun.rotation.z += e * 0.3;
    }

    // Pack-a-Punch on the third-person weapon: a quick bank during the upgrade
    // plus the energy glow (slow shimmer + a bright flare through the upgrade).
    // rotation is set absolutely above, so this addition never accumulates.
    const tpPackBump = weaponAnim.packAnim > 0 ? Math.sin((1 - weaponAnim.packAnim) * Math.PI) : 0;
    if (tpPackBump > 0) {
      thirdPerson.weapon.gun.rotation.z += tpPackBump * 0.55;
      thirdPerson.weapon.gun.rotation.x -= tpPackBump * 0.22;
    }
    const tpMats = thirdPerson.weapon.gun.userData.packMats;
    const tpGlowBase = thirdPerson.weapon.gun.userData.packGlowBase || 0;
    if (tpMats && (tpGlowBase > 0 || tpPackBump > 0)) {
      const tnow = performance.now();
      const shimmer = tpGlowBase > 0 ? 1 + Math.sin(tnow * 0.006) * 0.16 : 1;
      const intensity = tpGlowBase * shimmer + tpPackBump * 3.4;
      for (const m of tpMats) m.emissiveIntensity = intensity;
    }

    const flashT = shotT;
    if (thirdPerson.weapon.flash) {
      const showFlashMesh = shouldUseThirdPersonWeapon() && flashT > 0;
      alignWeaponMuzzleFlash(thirdPerson.weapon);
      applyMuzzleFlashSprite(thirdPerson.weapon.flash, showFlashMesh, flashT, currentGun, 0.74);
      setPhysicalMuzzleFlash(thirdPerson.weapon.muzzle, showFlashMesh, flashT, 0.7);
      try {
        const tpBase = thirdPerson.weapon.flash.userData?.baseColor ?? null;
        if (tpBase) thirdPerson.weapon.flash.material.color.setHex(tpBase);
      } catch (e) {}
    }

    // Right-hand fresh-clip transit + old-mag hide (runs after the gun is fully posed).
    updateThirdPersonReloadClip(reloadActive, reloadT, rightHandTmp, easeReload);
  }

  function updateThirdPersonCharacter(dt, moveState) {
    if (!thirdPerson.ready || !thirdPerson.root) return;

    thirdPerson.recoilBackVel += (-thirdPerson.recoilBack * 92 - thirdPerson.recoilBackVel * 18) * dt;
    thirdPerson.recoilBack += thirdPerson.recoilBackVel * dt;
    thirdPerson.recoilPitchVel += (-thirdPerson.recoilPitch * 96 - thirdPerson.recoilPitchVel * 20) * dt;
    thirdPerson.recoilPitch += thirdPerson.recoilPitchVel * dt;
    thirdPerson.recoilYawVel += (-thirdPerson.recoilYaw * 84 - thirdPerson.recoilYawVel * 18) * dt;
    thirdPerson.recoilYaw += thirdPerson.recoilYawVel * dt;
    thirdPerson.recoilRollVel += (-thirdPerson.recoilRoll * 88 - thirdPerson.recoilRollVel * 19) * dt;
    thirdPerson.recoilRoll += thirdPerson.recoilRollVel * dt;

    // Equip lower/raise timer (duration = the incoming gun's equipTime).
    thirdPerson.equip = Math.max(0, thirdPerson.equip - dt / Math.max(0.08, thirdPerson.equipTime || 0.3));

    // Heavy-gun muzzle lag: the gun's yaw trails quick turns via a small
    // rotational spring, weighted by spec.swayMul (pistol snappy, LMG floaty).
    const yawNow = yaw.rotation.y;
    if (thirdPerson.prevYawAngle === null) thirdPerson.prevYawAngle = yawNow;
    const yawTurnVel = (yawNow - thirdPerson.prevYawAngle) / Math.max(dt, 1e-4);
    thirdPerson.prevYawAngle = yawNow;
    const lagWeight = Math.max(0, (Number.isFinite(GUN_SPECS[currentGun]?.swayMul) ? GUN_SPECS[currentGun].swayMul : 1) - 0.55) * 0.055;
    const lagTarget = clamp(-yawTurnVel * lagWeight, -0.28, 0.28);
    thirdPerson.gunLagVel += ((lagTarget - thirdPerson.gunLag) * 30 - thirdPerson.gunLagVel * 10) * dt;
    thirdPerson.gunLag += thirdPerson.gunLagVel * dt;

    const bodyRecoilBack = clamp(thirdPerson.recoilBack, 0, 0.18);
    const bodyRecoilPitch = clamp(thirdPerson.recoilPitch, -0.18, 0.28);
    const bodyRecoilYaw = clamp(thirdPerson.recoilYaw, -0.1, 0.1);
    const bodyRecoilRoll = clamp(thirdPerson.recoilRoll, -0.14, 0.14);
    const recoilForward = thirdPersonForwardTmp.set(-Math.sin(yaw.rotation.y), 0, -Math.cos(yaw.rotation.y));

    thirdPerson.root.position.set(yaw.position.x, player.jumpOffset, yaw.position.z);
    thirdPerson.root.position.addScaledVector(recoilForward, -bodyRecoilBack);
    thirdPerson.root.position.y += Math.min(0.055, bodyRecoilBack * 0.35);
    thirdPerson.root.rotation.y = yaw.rotation.y + bodyRecoilYaw;
    if (thirdPerson.model) {
      thirdPerson.model.rotation.x = -pitch.rotation.x * 0.14 - bodyRecoilPitch;
      thirdPerson.model.rotation.z = bodyRecoilRoll;
    }
    thirdPerson.lastMove = moveState || thirdPerson.lastMove;
    thirdPerson.fireTimer = Math.max(0, thirdPerson.fireTimer - dt);
    thirdPerson.reloadTimer = Math.max(0, thirdPerson.reloadTimer - dt);

    const f = thirdPerson.lastMove.f || 0;
    const s = thirdPerson.lastMove.s || 0;
    const movingNow = Math.abs(f) > 0.05 || Math.abs(s) > 0.05;
    const wasMoving = thirdPerson._wasMoving || false;
    thirdPerson._wasMoving = movingNow;

    let targetAction = "idle";
    if (player.pvpDead && thirdPerson.actions.death) {
      targetAction = "death";
    } else if (thirdPerson.reloadTimer > 0) {
      targetAction = "reload";
    } else if (thirdPerson.lastMove.jumping) {
      if (f > 0.1 && thirdPerson.actions.jumpForward) targetAction = "jumpForward";
      else if (f < -0.1 && thirdPerson.actions.jumpBack) targetAction = "jumpBack";
      else if (mouse.aiming && thirdPerson.actions.jumpRifle) targetAction = "jumpRifle";
      else if (thirdPerson.actions.jumpForward) targetAction = "jumpForward";
      else targetAction = "jump";
    } else if (movingNow && thirdPerson.lastMove.sprinting) {
      targetAction = pickSprintLocomotionAction(thirdPerson.actions, f, s);
    } else if (movingNow) {
      // While moving, KEEP the locomotion clip even when firing — the arms are
      // raised/punched procedurally by applyThirdPersonArmPose (which is grip-style
      // aware, so the pistol stays one-handed). Switching to the full-body two-handed
      // `fire` clip mid-stride is what made both arms flail on the one-handed pistol.
      // (This mirrors the sprint branch above, which already reads correctly.)
      if (Math.abs(s) > Math.abs(f) * 1.2) {
        targetAction = s < -0.1 && thirdPerson.actions.strafeAlt ? "strafeAlt" : "strafe";
      } else if (f < -0.1) {
        if (!wasMoving && thirdPerson.actions.startWalkBack) targetAction = "startWalkBack";
        else targetAction = thirdPerson.actions.walkBack ? "walkBack" : "walk";
      } else if (!wasMoving && thirdPerson.actions.startWalk) {
        targetAction = "startWalk";
      } else {
        targetAction = "walk";
      }
    } else if (thirdPerson.fireTimer > 0) {
      targetAction = "fire";
    } else if (wasMoving && !movingNow) {
      if (thirdPerson._lastWalkAction === "walkBack" && thirdPerson.actions.stopWalkBack) {
        targetAction = "stopWalkBack";
      } else if (thirdPerson.actions.stopWalk) {
        targetAction = "stopWalk";
      }
    }
    thirdPerson._lastWalkAction = targetAction;

    clearThirdPersonAimOffsets();
    setThirdPersonAction(targetAction);
    // Smooth the rifle-carry upper-body layer in/out (matches the 0.14s action fades).
    if (thirdPerson.carryAction) {
      const cw = thirdPerson.carryWeight ?? 0;
      thirdPerson.carryWeight = cw + ((thirdPerson.carryTarget || 0) - cw) * Math.min(1, dt * 7);
      // Blend a fraction of the original unarmed arm-swing back UNDER the carry
      // layer while moving; fade it out while aiming so ADS keeps a steady grip.
      const swing = thirdPerson.armSwingActive;
      const swingMix = swing ? TP_ARM_SWING_BLEND * (1 - (thirdPerson.aimBlend || 0)) : 0;
      thirdPerson.carryAction.setEffectiveWeight(thirdPerson.carryWeight * (1 - swingMix));
      if (swing) {
        swing.setEffectiveWeight(thirdPerson.carryWeight * swingMix);
        // Keep the arms in phase with the legs (same source clip, same duration).
        if (thirdPerson.activeAction) swing.time = thirdPerson.activeAction.time;
      }
    }
    if (thirdPerson.mixer) thirdPerson.mixer.update(dt);

    // Apply procedural arm raise/lower on top of whatever the clip set.
    // Must run after mixer.update so we layer on top of the animation frame,
    // and before updateThirdPersonWeaponPose so hand bone world-positions are correct.
    applyThirdPersonArmPose(dt);

    // Force skeleton matrices to propagate our bone changes before weapon pose
    // reads hand bone world-positions via getWorldPosition().
    if (thirdPerson.model) thirdPerson.model.updateMatrixWorld(true);

    updateThirdPersonWeaponPose();
  }

  // Pathfinding scratch buffers — pre-allocated, reused each call, no GC.
  // Grid fits in 64×64 (actual map is 34×41), so pack cell as mx*64+my (12-bit int).
  const _pfGrid = 64; // stride
  const _pfBuf = new Int16Array(64 * 64 * 2); // [parent_mx, parent_my] interleaved; -128 = unvisited
  const _pfQueue = new Int16Array(64 * 64 * 2); // [mx, my] pairs

  function findPath(startCell, goalCell, enemy = null) {
    if (startCell.mx === goalCell.mx && startCell.my === goalCell.my) return [];
    if (!isOpenCell(goalCell.mx, goalCell.my)) return [];

    // Mark all cells unvisited (sentinel = -128)
    _pfBuf.fill(-128);

    const smx = startCell.mx, smy = startCell.my;
    const gmx = goalCell.mx,  gmy = goalCell.my;

    const startKey = smx * _pfGrid + smy;
    _pfBuf[startKey * 2]     = -1; // parent_mx sentinel for "no parent"
    _pfBuf[startKey * 2 + 1] = -1;

    let head = 0, tail = 0;
    _pfQueue[tail++] = smx;
    _pfQueue[tail++] = smy;

    const MAX_PATH_NODES = 380;
    let found = false;

    outer: while (head < tail) {
      const cmx = _pfQueue[head++];
      const cmy = _pfQueue[head++];
      if (head > MAX_PATH_NODES * 2) break;

      // 4-directional expansion
      for (let d = 0; d < 4; d++) {
        const nx = cmx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cmy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        const nkey = nx * _pfGrid + ny;
        if (_pfBuf[nkey * 2] !== -128) continue; // already visited
        if (!isOpenCell(nx, ny)) { _pfBuf[nkey * 2] = -127; continue; } // wall sentinel
        if (enemy) {
          const center = cellCenter(nx, ny);
          if (enemyBlockedAt(enemy, center.x, center.z)) { _pfBuf[nkey * 2] = -127; continue; }
        }
        _pfBuf[nkey * 2]     = cmx;
        _pfBuf[nkey * 2 + 1] = cmy;
        if (nx === gmx && ny === gmy) { found = true; break outer; }
        _pfQueue[tail++] = nx;
        _pfQueue[tail++] = ny;
      }
    }

    if (!found) return [];

    // Reconstruct path (walk parents back from goal)
    const path = [];
    let cx = gmx, cy = gmy;
    while (!(cx === smx && cy === smy)) {
      path.push({ mx: cx, my: cy });
      const k = cx * _pfGrid + cy;
      const px = _pfBuf[k * 2];
      const py = _pfBuf[k * 2 + 1];
      if (px < 0) break; // safety
      cx = px; cy = py;
    }
    path.reverse();
    return path;
  }

  function hasLineOfSightWorld(ax, az, bx, bz, radius = 0.2) {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return true;

    const steps = Math.max(2, Math.ceil(dist / 1.15));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (wallAtWorldRadius(ax + dx * t, az + dz * t, radius)) return false;
    }
    return true;
  }

  function findNearestOpenCell(mx, my, maxRadius = 3) {
    if (isOpenCell(mx, my)) return { mx, my };
    for (let r = 1; r <= maxRadius; r++) {
      for (let y = my - r; y <= my + r; y++) {
        for (let x = mx - r; x <= mx + r; x++) {
          if (Math.abs(x - mx) !== r && Math.abs(y - my) !== r) continue;
          if (isOpenCell(x, y)) return { mx: x, my: y };
        }
      }
    }
    return null;
  }

  function getDroneTactics(typeName) {
    if (typeName === "Siege Drone") return { preferRange: 11.1, directRange: 22, flankCells: 2, predict: 0.8, repath: 0.5, aggression: 1.0 };
    if (typeName === CLONED_GHOST_TYPE_NAME) return { preferRange: 9.5, directRange: 30, flankCells: 1, predict: 0.45, repath: 0.4, aggression: 1.0 };
    if (typeName === "Blink Seraph") return { preferRange: 8.2, directRange: 23, flankCells: 2, predict: 0.8, repath: 0.3, aggression: 1.0 };
    if (typeName === "Null Cherub") return { preferRange: 10.5, directRange: 20, flankCells: 1, predict: 0.7, repath: 0.5, aggression: 1.0 };
    if (typeName === "Zombie") return { preferRange: 1.4, directRange: 28, flankCells: 1, predict: 0.45, repath: 0.5, aggression: 1.0 };
    return { preferRange: 11.5, directRange: 22, flankCells: 2, predict: 0.8, repath: 0.5, aggression: 1.0 };
  }

  function getTacticalGoalCell(enemy, playerCell, dirX, dirZ, dist) {
    const tactics = enemy.tactics;
    let offX = 0;
    let offY = 0;

    if (enemy.typeName === "Siege Drone" && dist > 5) {
      offX = Math.round(dirX * tactics.flankCells);
      offY = Math.round(dirZ * tactics.flankCells);
    } else if (enemy.typeName === CLONED_GHOST_TYPE_NAME) {
      const side = enemy.orbitDir || enemy.strafeDir || 1;
      const flank = tactics.flankCells || 2;
      const rangeBias = dist < tactics.preferRange - 2 ? -2 : dist > tactics.preferRange + 5 ? 1 : 0;
      offX = Math.round(-dirZ * flank * side + dirX * rangeBias);
      offY = Math.round(dirX * flank * side + dirZ * rangeBias);
    }

    const goal = findNearestOpenCell(playerCell.mx + offX, playerCell.my + offY, 2);
    return goal || playerCell;
  }

  function disposeObject3D(root) {
    if (!root) return;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
      else obj.material?.dispose?.();
    });
  }

  function deactivateEnemyRuntimeLights(enemy) {
    hideMegaBlast(enemy);
    enemy?.mesh?.traverse(obj => {
      if (!obj.isLight) return;
      obj.intensity = 0;
      obj.visible = false;
    });
  }

  function withFilteredFbxWarnings<T>(task: () => T | Promise<T>): Promise<T> {
    const originalWarn = console.warn;
    const ignored = [
      "Maya|base",
      "unknown material type",
      "Vertex has more than 4 skinning weights",
    ];
    console.warn = (...args) => {
      const text = args.map(arg => String(arg)).join(" ");
      if (ignored.some(pattern => text.includes(pattern))) return;
      originalWarn(...args);
    };
    return Promise.resolve()
      .then(task)
      .finally(() => {
        console.warn = originalWarn;
      });
  }

  const startupAssetCache = new Map();

  function getStartupAssetPaths() {
    // On mobile, never prefetch the angel skeleton FBX (~60 MB) or its textures
    // (~30 MB): low-end devices render the procedural drone, so these would be a
    // pure download/parse/VRAM cost with zero visual benefit.
    if (mobileMode) {
      return Array.from(new Set([
        ...STARTUP_TEXTURE_ASSETS,
        EXTERIOR_CITY_MODEL_PATH,
        PLAYER_MODEL_GLTF_PATH,
        ...Object.values(PLAYER_ANIMATION_GLTF_PATHS),
      ]));
    }
    return Array.from(new Set([
      ...STARTUP_TEXTURE_ASSETS,
      // Angel drone assets removed — drones are the procedural Storm Warden now.
      EXTERIOR_CITY_MODEL_PATH,
      PLAYER_MODEL_GLTF_PATH,
      ...Object.values(PLAYER_ANIMATION_GLTF_PATHS),
    ]));
  }

  async function preloadFileAsset(path) {
    if (!path || window.location.protocol === "file:") return null;
    const url = new URL(path, window.location.href).href;
    if (startupAssetCache.has(url)) return startupAssetCache.get(url);

    const promise = fetch(url, { cache: "force-cache" })
      .then(response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.arrayBuffer();
      })
      .catch(err => {
        console.warn(`Asset could not be cached: ${path}`, err);
        return null;
      });

    startupAssetCache.set(url, promise);
    return promise;
  }

  async function preloadStartupFileCache() {
    const paths = getStartupAssetPaths();
    let completed = 0;
    setLoadingProgress("Caching mission assets", 0.06);

    const concurrency = deviceProfile.tier === "low" ? 3 : 5;
    let cursor = 0;
    async function worker() {
      while (cursor < paths.length) {
        const path = paths[cursor++];
        await preloadFileAsset(path);
        completed++;
        setLoadingProgress("Caching mission assets", 0.06 + completed / paths.length * 0.12);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  }

  function loadTexture(path, options: any = {}) {
    const texture = new THREE.TextureLoader().load(new URL(path, window.location.href).href);
    texture.colorSpace = options.color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  function createAngelDroneMaterials() {
    const skeletonBaseColor = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.skeletonBaseColor, { color: true });
    const skeletonNormal = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.skeletonNormal);
    const skeletonRoughness = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.skeletonRoughness);
    const skeletonMetallic = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.skeletonMetallic);
    const skeletonAo = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.skeletonAo);

    const armBaseColor = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.armBaseColor, { color: true });
    const armNormal = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.armNormal);
    const armRoughness = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.armRoughness);
    const armMetallic = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.armMetallic);
    const armAo = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.armAo);

    const glowAlpha = loadTexture(ANGEL_DRONE_TEXTURE_PATHS.glowAlpha);

    return {
      skeleton: new THREE.MeshStandardMaterial({
        name: "angel_skeleton_pbr",
        map: skeletonBaseColor,
        normalMap: skeletonNormal,
        normalScale: new THREE.Vector2(1.12, -1.12),
        roughnessMap: skeletonRoughness,
        metalnessMap: skeletonMetallic,
        aoMap: skeletonAo,
        color: 0xf1f7ff,
        emissive: 0x07101a,
        emissiveIntensity: 0.12,
        roughness: 0.54,
        metalness: 0.62,
        envMapIntensity: 0.95,
      }),
      arm: new THREE.MeshStandardMaterial({
        name: "angel_arm_pbr",
        map: armBaseColor,
        normalMap: armNormal,
        roughnessMap: armRoughness,
        metalnessMap: armMetallic,
        aoMap: armAo,
        color: 0xdbe9f5,
        emissive: 0x08111a,
        emissiveIntensity: 0.1,
        roughness: 0.48,
        metalness: 0.5,
        envMapIntensity: 0.82,
      }),
      glow: new THREE.MeshBasicMaterial({
        name: "angel_glow",
        color: 0x9eeaff,
        alphaMap: glowAlpha,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    };
  }

  function prepareAngelDroneModel(model) {
    const materials = ANGEL_DRONE_MATERIALS || (ANGEL_DRONE_MATERIALS = createAngelDroneMaterials());
    const removableNames = /^(bg_plane|halo_outer_ring|blood_drops_|inner_torus|outter_torus|glow|halo|aura)/i;
    // The source FBX ships its animation rig's control gizmos as renderable meshes
    // (per-finger "*_control" shapes, joint controls, etc.) — ~150 invisible-intent
    // meshes per drone, each a draw call that scales with enemy count. The body is
    // skinned to bones, not these controls, so stripping them is purely a render
    // win. This was the dominant draw-call cost at higher waves.
    const rigControlNames = /(control|_ctrl)\b|_control_|_control$/i;
    const removals = [];
    let keptHandMesh = false;

    model.traverse(obj => {
      // Rig-control gizmos render as Line/LineSegments/Points (NURBS control
      // curves), not just Mesh — so we must catch all renderable types here.
      // Bones are isBone (non-renderable) and are left intact, so skinning works.
      const renderable = obj.isMesh || obj.isLine || obj.isLineSegments || obj.isPoints;
      if (!renderable) return;
      if (removableNames.test(obj.name || "") || rigControlNames.test(obj.name || "")) {
        removals.push(obj);
        return;
      }
      if (!obj.isMesh) return; // only true meshes get the material/uv treatment below

      if (/^hand\d*arm_mesh$/i.test(obj.name || "")) {
        if (keptHandMesh) {
          removals.push(obj);
          return;
        }
        keptHandMesh = true;
      }

      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;

      if (!obj.geometry.attributes.uv2 && obj.geometry.attributes.uv) {
        obj.geometry.setAttribute("uv2", obj.geometry.attributes.uv);
      }

      const name = `${obj.name || ""} ${Array.isArray(obj.material) ? obj.material.map(mat => mat?.name || "").join(" ") : obj.material?.name || ""}`.toLowerCase();
      if (name.includes("arm_mat") || name.includes("arm_mesh")) {
        obj.material = materials.arm;
      } else if (name.includes("glow")) {
        obj.material = materials.glow;
      } else {
        obj.material = materials.skeleton;
      }

      const materialList = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materialList) {
        if (!material) continue;
        material.flatShading = false;
        material.morphNormals = true;
        material.roughness = Math.min(0.88, (material.roughness ?? 0.6) + 0.015);
        material.metalness = Math.min(0.78, (material.metalness ?? 0.35) + 0.06);
        if (typeof material.emissiveIntensity === "number") material.emissiveIntensity *= 0.88;
        if (typeof material.envMapIntensity === "number") material.envMapIntensity *= 1.14;
        material.needsUpdate = true;
      }
    });

    let removed = 0;
    for (const obj of removals) {
      // Safety: never strip something that contains the skinned body (guards
      // against a rig where a control is an ancestor of the deforming mesh).
      let holdsSkin = false;
      obj.traverse(c => { if (c.isSkinnedMesh) holdsSkin = true; });
      if (holdsSkin) continue;
      obj.parent?.remove(obj);
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(mat => mat?.dispose?.());
      else obj.material?.dispose?.();
      removed++;
    }
    console.log(`[drone] prepareAngelDroneModel: removed ${removed} rig/junk objects from source model`);
  }

  async function loadSiegeDroneModel() {
    if (window.location.protocol === "file:") {
      console.warn("angel drone model is not loaded from file:// pages");
      return null;
    }
    // Prefer the decimated glb (~53k tris) — vastly cheaper than the ~1M-tri FBX.
    // Falls back to the original FBX if the glb is missing.
    try {
      const gltfLoader = createGLTFLoader();
      const glbUrl = new URL(SIEGE_DRONE_MODEL_GLB_PATH, window.location.href);
      const gltf = await gltfLoader.loadAsync(glbUrl.href);
      const model = gltf.scene;
      prepareAngelDroneModel(model);
      model.userData.modelEditorHeight = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
      registerModelEditorRoot(model, "angel");
      console.log(`[drone] loaded optimized glb (${(gltf.animations || []).length} clips)`);
      return { scene: model, animations: gltf.animations || [] };
    } catch (glbErr) {
      console.warn("angel skeleton.glb unavailable; falling back to the FBX.", glbErr);
    }
    try {
      const loader = new FBXLoader();
      const modelUrl = new URL(SIEGE_DRONE_MODEL_PATH, window.location.href);
      loader.setResourcePath(new URL("../textures/", modelUrl).href);
      const model = await withFilteredFbxWarnings(() => loader.loadAsync(modelUrl.href));
      prepareAngelDroneModel(model);
      model.userData.modelEditorHeight = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
      registerModelEditorRoot(model, "angel");
      return { scene: model, animations: model.animations || [] };
    } catch (err) {
      console.warn("angel skeleton.fbx could not be loaded; Siege Drone character rig unavailable.", err);
      return null;
    }
  }

  async function loadSiegeDroneWalkAnimation() {
    try {
      if (window.location.protocol === "file:") {
        console.warn("angel skeleton.fbx animation is not loaded from file:// pages");
        return null;
      }
      const loader = new FBXLoader();
      const animationUrl = new URL(SIEGE_DRONE_WALK_ANIMATION_PATH, window.location.href);
      loader.setResourcePath(new URL("../textures/", animationUrl).href);
      const fbx = await withFilteredFbxWarnings(() => loader.loadAsync(animationUrl.href));
      if (!fbx.animations || fbx.animations.length === 0) {
        console.warn("angel skeleton.fbx loaded but contains no animation clips.");
        return null;
      }
      return fbx;
    } catch (err) {
      console.warn("angel skeleton.fbx animation could not be loaded; Siege Drone will walk without the FBX animation.", err);
      return null;
    }
  }

  async function loadPlayerCharacterAssets() {
    PLAYER_CHARACTER_FBX = null;
    for (const key of Object.keys(PLAYER_CHARACTER_ANIMS)) delete PLAYER_CHARACTER_ANIMS[key];

    if (window.location.protocol === "file:") {
      console.warn("Player FBX assets are not loaded from file:// pages; third person will use the fallback body.");
      return;
    }

    const gltfLoader = createGLTFLoader();
    const fbxLoader = new FBXLoader();
    try {
      try {
        const gltf = await gltfLoader.loadAsync(new URL(PLAYER_MODEL_GLTF_PATH, window.location.href).href);
        PLAYER_CHARACTER_FBX = gltf.scene;
      } catch (glbErr) {
        console.warn("black mask.glb could not be loaded; trying the original FBX.", glbErr);
        PLAYER_CHARACTER_FBX = await fbxLoader.loadAsync(new URL(PLAYER_MODEL_PATH, window.location.href).href);
      }
      const playerRigRemovals = [];
      PLAYER_CHARACTER_FBX.traverse(obj => {
        const renderable = obj.isMesh || obj.isLine || obj.isLineSegments || obj.isPoints;
        if (!renderable) return;
        // Strip any animation rig-control gizmos that shipped in the model (same
        // issue as the drone — they're Line/Points, not just Mesh). Bones drive
        // the skin, so this is render-only.
        if (/(control|_ctrl)\b|_control_|_control$/i.test(obj.name || "")) {
          playerRigRemovals.push(obj);
          return;
        }
        if (!obj.isMesh) return;
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
      });
      for (const obj of playerRigRemovals) {
        let holdsSkin = false;
        obj.traverse(c => { if (c.isSkinnedMesh) holdsSkin = true; });
        if (holdsSkin) continue;
        obj.parent?.remove(obj);
        obj.geometry?.dispose?.();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m?.dispose?.());
        else obj.material?.dispose?.();
      }
      PLAYER_CHARACTER_FBX.userData.modelEditorHeight = new THREE.Box3().setFromObject(PLAYER_CHARACTER_FBX).getSize(new THREE.Vector3()).y;
      registerModelEditorRoot(PLAYER_CHARACTER_FBX, "player");
    } catch (err) {
      console.warn("black mask.fbx could not be loaded; using fallback third-person body.", err);
      PLAYER_CHARACTER_FBX = null;
      return;
    }

    const entries = Object.entries(PLAYER_ANIMATION_PATHS);
    let loaded = 0;
    await Promise.all(entries.map(async ([key, path]) => {
      try {
        let clip = null;
        if (PLAYER_ANIMATION_GLTF_PATHS[key]) try {
          const animGltf = await gltfLoader.loadAsync(new URL(PLAYER_ANIMATION_GLTF_PATHS[key], window.location.href).href);
          clip = animGltf.animations?.[0] ?? null;
        } catch (glbErr) {
          console.warn(`${PLAYER_ANIMATION_GLTF_PATHS[key]} could not be loaded; trying FBX animation.`, glbErr);
        }
        if (!clip) {
          const animFbx = await fbxLoader.loadAsync(new URL(path, window.location.href).href);
          clip = animFbx.animations?.[0] ?? null;
        }
        if (clip) PLAYER_CHARACTER_ANIMS[key] = clip;
      } catch (err) {
        console.warn(`${path} could not be loaded; skipping player animation.`, err);
      } finally {
        loaded++;
        setLoadingProgress("Loading player animations", 0.26 + loaded / Math.max(1, entries.length) * 0.12);
      }
    }));
  }

  async function loadZombieCharacterAssets() {
    if (window.location.protocol === "file:") {
      console.warn("Zombie assets are not loaded from file:// pages; zombies disabled.");
      return;
    }
    const gltfLoader = createGLTFLoader();
    const fbxLoader = new FBXLoader();
    try {
      const gltf = await gltfLoader.loadAsync(new URL(ZOMBIE_MODEL_GLB_PATH, window.location.href).href);
      ZOMBIE_CHARACTER_GLB = gltf.scene;
      ZOMBIE_CHARACTER_GLB.traverse(obj => {
        if (!obj.isMesh && !obj.isSkinnedMesh) return;
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
        // fbx2gltf exported the body material as alphaMode=BLEND; its diffuse texture's
        // alpha channel then acts as opacity and renders the mesh INVISIBLE. A zombie
        // body should be solid — force every material opaque so it actually shows.
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          m.transparent = false;
          m.opacity = 1;
          m.alphaTest = 0;
          m.depthWrite = true;
          m.side = THREE.FrontSide;
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.needsUpdate = true;
        }
      });
    } catch (err) {
      console.warn("parasite_zombie.glb could not be loaded; zombies disabled.", err);
      ZOMBIE_CHARACTER_GLB = null;
      return;
    }
    // Skeleton-only Mixamo clips (bind 1:1 to the GLB skeleton — verified by
    // modules/zombie_diagnostics.mjs). Bites are excluded by the asset list.
    const entries = Object.entries(ZOMBIE_ANIMATION_PATHS);
    await Promise.all(entries.map(async ([key, path]) => {
      try {
        const fbx = await fbxLoader.loadAsync(new URL(path, window.location.href).href);
        const rawClip = fbx.animations?.[0] ?? null;
        if (!rawClip) return;
        // CRITICAL: Mixamo clips carry a Hips.position track in CENTIMETRES (~100),
        // but the GLB skeleton is in metres (~1). Played as-is, the mixer teleports the
        // skinned mesh ~100 units into the air (invisible) while collision stays at the
        // bind-pose box. Stripping the .position tracks (in-place clip) keeps it grounded
        // and visible — exactly what the player/ghost rigs already do.
        ZOMBIE_CHARACTER_ANIMS[key] = ZOMBIE_CHARACTER_GLB
          ? makeInPlaceClipForModel(rawClip, ZOMBIE_CHARACTER_GLB)
          : rawClip;
      } catch (err) {
        console.warn(`${path} could not be loaded; skipping zombie animation.`, err);
      }
    }));
  }

  async function loadCoreModelAssets() {
    // Drones are now the procedural Storm Warden (modules/storm_warden.js), built
    // in code with no external assets — so the old ~60MB angel FBX + textures are
    // no longer loaded at all. Only the player rig needs downloading here.
    SIEGE_DRONE_MODEL_GLTF = null;
    SIEGE_DRONE_WALK_FBX = null;
    setLoadingProgress("Loading player rig", 0.2);
    await loadPlayerCharacterAssets();
    setLoadingProgress("Loading zombie rig", 0.34);
    await loadZombieCharacterAssets();
    setLoadingProgress("Player rig loaded", 0.38);
  }

  function preloadImageAsset(path) {
    return new Promise<void>(resolve => {
      const img = new Image();
      img.onload = () => {
        if (img.decode) img.decode().catch(() => {}).finally(resolve);
        else resolve();
      };
      img.onerror = () => {
        console.warn(`Texture could not be preloaded: ${path}`);
        resolve();
      };
      img.src = new URL(path, window.location.href).href;
    });
  }

  function initTextureForRenderer(texture) {
    if (!texture || !renderer.initTexture) return;
    try {
      renderer.initTexture(texture);
    } catch (err) {
      console.warn("Texture warmup skipped:", err);
    }
  }

  function warmObjectTextures(root) {
    const warmed = new Set();
    root.traverse?.(obj => {
      if (!obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (!(value as any)?.isTexture || warmed.has(value)) continue;
          warmed.add(value);
          initTextureForRenderer(value);
        }
      }
    });
    return warmed.size;
  }

  async function preloadStartupTextureAssets() {
    const texturePaths = Array.from(new Set([
      ...STARTUP_TEXTURE_ASSETS,
    ]));
    let completed = 0;
    setLoadingProgress("Decoding texture assets", 0.38);
    await Promise.all(texturePaths.map(path => preloadImageAsset(path).finally(() => {
      completed++;
      setLoadingProgress("Decoding texture assets", 0.38 + completed / texturePaths.length * 0.18);
    })));
  }

  async function loadExteriorCityScene() {
    if (window.location.protocol === "file:") return;

    // Build the evening sky (gradient dome, sun, stars, plaza ground)
    buildEveningSky(THREE, scene);

    // Mobile: stop here. The decorative city (procedural storefronts, signs,
    // glows + the building GLB) is hundreds of extra draw calls with no gameplay
    // role — the playable exterior (ground/walls/collision) comes from
    // buildExteriorPlayArea. Keeping just the sky is a large per-frame win.
    if (mobileMode) return;

    const loader = createGLTFLoader();
    const root = new THREE.Group();
    root.name = "Pet store exterior";
    root.layers.set(1);
    root.visible = true;
    root.frustumCulled = false;
    scene.add(root);
    exteriorCityRoot = root;

    function makeExteriorGroundTexture() {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");

      const asphalt = ctx.createLinearGradient(0, 0, 0, canvas.height);
      asphalt.addColorStop(0, "#29323a");
      asphalt.addColorStop(0.5, "#1f272f");
      asphalt.addColorStop(1, "#171d24");
      ctx.fillStyle = asphalt;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const rng = (() => {
        let seed = 88723;
        return () => {
          seed = Math.imul(seed ^ (seed >>> 15), 2246822519) + 3266489917;
          return ((seed ^ (seed >>> 13)) >>> 0) / 4294967296;
        };
      })();

      for (let i = 0; i < 2400; i++) {
        const x = rng() * canvas.width;
        const y = rng() * canvas.height;
        const l = 18 + rng() * 32;
        ctx.fillStyle = `rgba(${l},${l + 3},${l + 7},${0.025 + rng() * 0.045})`;
        ctx.fillRect(x, y, 1 + rng() * 2.2, 1);
      }

      ctx.fillStyle = "rgba(255,216,145,0.16)";
      for (let x = 60; x < canvas.width; x += 150) {
        ctx.fillRect(x, 248, 78, 4);
      }
      ctx.fillStyle = "rgba(156,93,74,0.24)";
      ctx.fillRect(0, 92, canvas.width, 8);
      ctx.fillRect(0, 410, canvas.width, 8);

      const vignette = ctx.createRadialGradient(
        canvas.width * 0.5,
        canvas.height * 0.42,
        canvas.width * 0.18,
        canvas.width * 0.5,
        canvas.height * 0.48,
        canvas.width * 0.72
      );
      vignette.addColorStop(0, "rgba(255,184,120,0.08)");
      vignette.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return texture;
    }

    const exteriorGround = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 112, 1, 1),
      new THREE.MeshStandardMaterial({
        map: makeExteriorGroundTexture(),
        color: 0xffffff,
        roughness: 0.88,
        metalness: 0.0,
        fog: false,
      })
    );
    exteriorGround.name = "single-piece exterior road";
    exteriorGround.rotation.x = -Math.PI * 0.5;
    exteriorGround.position.set(0, -0.055, -82);
    exteriorGround.layers.set(1);
    root.add(exteriorGround);

    function makeHazeAlphaMap() {
      const canvas = document.createElement("canvas");
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, "rgb(255,255,255)");
      grad.addColorStop(0.58, "rgb(185,185,185)");
      grad.addColorStop(0.82, "rgb(58,58,58)");
      grad.addColorStop(1, "rgb(0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    }
    const hazeAlpha = makeHazeAlphaMap();

    const hazeMat = new THREE.MeshBasicMaterial({ color: 0x7e9bb8, transparent: true, opacity: 0.12, depthWrite: false, fog: false, side: THREE.DoubleSide, alphaMap: hazeAlpha });
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(176, 38), hazeMat);
    haze.position.set(0, 18, -74);
    haze.layers.set(1);
    // root.add(haze);

    const exteriorGradeMat = new THREE.MeshBasicMaterial({
      color: 0xff9f6c,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      alphaMap: hazeAlpha
    });
    const exteriorGrade = new THREE.Mesh(new THREE.PlaneGeometry(178, 46), exteriorGradeMat);
    exteriorGrade.name = "exterior warm grade";
    exteriorGrade.position.set(0, 12, -56);
    exteriorGrade.layers.set(1);
    root.add(exteriorGrade);

    function makeLinearHazeAlphaMap() {
      const canvas = document.createElement("canvas");
      canvas.width = 1; canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createLinearGradient(0, 128, 0, 0);
      grad.addColorStop(0, "rgb(255,255,255)");
      grad.addColorStop(0.34, "rgb(172,172,172)");
      grad.addColorStop(0.74, "rgb(42,42,42)");
      grad.addColorStop(1, "rgb(0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1, 128);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return texture;
    }

    const distanceFogMat = new THREE.MeshBasicMaterial({
      color: 0x293846,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      alphaMap: makeLinearHazeAlphaMap()
    });
    const distanceFog = new THREE.Mesh(new THREE.PlaneGeometry(178, 12), distanceFogMat);
    distanceFog.name = "exterior road distance haze";
    distanceFog.position.set(0, 1.8, -70);
    distanceFog.layers.set(1);
    // root.add(distanceFog);

    const exteriorTint = new THREE.Color(0x4f6072);
    const skyFill = new THREE.HemisphereLight(0x8ca9c6, 0x121922, 0.055);
    skyFill.layers.set(1);
    scene.add(skyFill);

    const storefrontFill = new THREE.PointLight(0xffbf82, 1.8, 48, 2.0);
    storefrontFill.position.set(-8, 4.2, -62);
    storefrontFill.castShadow = false;
    storefrontFill.layers.set(1);
    scene.add(storefrontFill);

    const signGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffb66d,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      alphaMap: hazeAlpha
    });

    function makeStoreSignTexture(label, backgroundColor, foregroundColor) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
      ctx.fillStyle = foregroundColor;
      ctx.font = "700 58px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, canvas.width * 0.5, canvas.height * 0.52);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return texture;
    }

    function addStorefrontSign(label, x, y, z, width, height, backgroundColor, foregroundColor) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
          map: makeStoreSignTexture(label, backgroundColor, foregroundColor),
          transparent: true,
          opacity: 0.86,
          depthWrite: false,
          fog: false,
          side: THREE.DoubleSide,
        })
      );
      sign.position.set(x, y, z);
      sign.layers.set(1);
      root.add(sign);
    }

    function addStorefrontGlow(x, y, z, width, height, opacity = 0.16) {
      const mat = signGlowMat.clone();
      mat.opacity = opacity;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
      glow.position.set(x, y, z);
      glow.layers.set(1);
      root.add(glow);
    };

    try {
      const gltf = await loader.loadAsync(new URL(EXTERIOR_CITY_MODEL_PATH, window.location.href).href);
      const model = gltf.scene;
      model.name = "Petstock and Radio Rentals exterior model";
      model.traverse(obj => {
        if (!obj.isMesh) return;
        // Keep frustum culling ON (default). This model has thousands of sub-meshes;
        // disabling culling forced every one to draw every frame (~11k draw calls
        // even when standing inside the interior facing away). Culling lets the GPU
        // skip everything outside the view, which is the single biggest perf win.
        obj.frustumCulled = true;
        obj.castShadow = false;
        obj.receiveShadow = false;
        obj.layers.set(1);
        if (!obj.material) return;

        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          mat.fog = false;
          if ("side" in mat) mat.side = THREE.DoubleSide;
          mat.roughness = Math.max(mat.roughness ?? 0.58, 0.72);
          mat.metalness = Math.min(mat.metalness ?? 0.08, 0.08);
          if (mat.color) {
            mat.color.multiplyScalar(0.9);
            mat.color.lerp(exteriorTint, 0.14);
          }
          if ("emissive" in mat) {
            mat.emissive.set(0x070a0f);
            mat.emissiveIntensity = Math.max(mat.emissiveIntensity || 0, 0.035);
          }
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const targetHeight = 12.2;
      const scale = targetHeight / Math.max(0.001, size.y);
      const holder = new THREE.Group();
      model.position.set(-center.x, -box.min.y, -center.z);
      holder.scale.setScalar(scale);
      holder.rotation.y = Math.PI;
      holder.position.set(0, 0, -88);
      holder.layers.set(1);
      holder.frustumCulled = false;
      holder.add(model);
      root.add(holder);

      const frontZ = holder.position.z + size.z * scale * 0.5 + 0.08;
      addStorefrontGlow(-15, 4.25, frontZ, 24, 1.05, 0.08);
      addStorefrontGlow(16, 3.45, frontZ + 0.02, 18, 1.65, 0.06);
      addStorefrontSign("PETSTOCK", -15, 4.22, frontZ + 0.09, 22, 1.05, "#772414", "#ffd68a");
      addStorefrontSign("RADIO", 15.5, 4.04, frontZ + 0.1, 18, 0.82, "#243849", "#bde7ff");

      // Register the pet store footprint as a prop collider so the player
      // cannot walk through the building even if they somehow reach this zone.
      const halfW = (size.x * scale * 0.5) + 0.5;
      const halfD = (size.z * scale * 0.5) + 0.5;
      const hx = holder.position.x;
      const hz = holder.position.z;
      if (!scene.userData.propColliders) scene.userData.propColliders = [];
      scene.userData.propColliders.push({ minX: hx - halfW, maxX: hx + halfW, minY: 0, maxY: 14, minZ: hz - halfD, maxZ: hz + halfD });

      // Visible barrier walls enclosing the pet store perimeter
      const barrierMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9, metalness: 0.1 });
      const barrierH = 2.2;
      const wallDefs = [
        [hx,          hz - halfD - 0.15, halfW * 2, 0.3,  barrierH],
        [hx,          hz + halfD + 0.15, halfW * 2, 0.3,  barrierH],
        [hx - halfW - 0.15, hz,          0.3, halfD * 2 + 0.6, barrierH],
        [hx + halfW + 0.15, hz,          0.3, halfD * 2 + 0.6, barrierH],
      ];
      for (const [bx, bz, bw, bd, bh] of wallDefs) {
        const wm = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), barrierMat);
        wm.position.set(bx, bh * 0.5, bz);
        scene.add(wm);
      }
    } catch (err) {
      console.warn("Pet store exterior model could not be loaded:", err);
    }
  }

  function raySphereDistance(origin, dir, center, radius) {
    const ocx = origin.x - center.x;
    const ocy = origin.y - center.y;
    const ocz = origin.z - center.z;
    const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
    const h = b * b - c;
    if (h < 0) return Infinity;
    const s = Math.sqrt(h);
    const tNear = -b - s;
    const tFar = -b + s;
    if (tNear > 0.001) return tNear;
    if (tFar > 0.001) return tFar;
    return Infinity;
  }

  function rayCapsuleDistance(origin, dir, a, b, radius) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    const segLenSq = ex * ex + ey * ey + ez * ez;
    if (segLenSq < 0.000001) return raySphereDistance(origin, dir, a, radius);

    const wx = origin.x - a.x;
    const wy = origin.y - a.y;
    const wz = origin.z - a.z;
    const bDot = dir.x * ex + dir.y * ey + dir.z * ez;
    const dDot = dir.x * wx + dir.y * wy + dir.z * wz;
    const eDot = ex * wx + ey * wy + ez * wz;
    const denom = segLenSq - bDot * bDot;

    const candidates = [0, 1];
    if (denom > 0.000001) candidates.push(Math.max(0, Math.min(1, (eDot - bDot * dDot) / denom)));
    else candidates.push(Math.max(0, Math.min(1, eDot / segLenSq)));

    let bestRayT = Infinity;
    let bestDistSq = Infinity;
    for (const segT of candidates) {
      hitVolumeSegPointTmp.set(a.x + ex * segT, a.y + ey * segT, a.z + ez * segT);
      const rayT = Math.max(0, hitVolumeDiffTmp.copy(hitVolumeSegPointTmp).sub(origin).dot(dir));
      hitVolumeRayPointTmp.copy(origin).addScaledVector(dir, rayT);
      const distSq = hitVolumeRayPointTmp.distanceToSquared(hitVolumeSegPointTmp);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestRayT = rayT;
      }
    }

    const distSq = bestDistSq;
    if (distSq > radius * radius) return Infinity;

    return Math.max(0.001, bestRayT - Math.sqrt(Math.max(0, radius * radius - distSq)));
  }

  function getEnemyShotDistance(enemy, origin, dir, shotRange, gunType, outInfo = null) {
    if (outInfo) outInfo.part = null;
    const hitVolumes = enemy.mesh.userData.hitVolumes;
    if (hitVolumes?.length) {
      const volumePad = gunType === GUNS.SNIPER ? 0.035 : gunType === GUNS.SHOTGUN ? 0.075 : 0.055;
      let best = Infinity;
      for (const volume of hitVolumes) {
        enemy.mesh.localToWorld(hitVolumeATmp.copy(volume.a));
        enemy.mesh.localToWorld(hitVolumeBTmp.copy(volume.b));
        const d = rayCapsuleDistance(origin, dir, hitVolumeATmp, hitVolumeBTmp, volume.radius + volumePad);
        if (d < best && d <= shotRange) {
          best = d;
          if (outInfo) outInfo.part = volume.name || null;
        }
      }
      return best;
    }

    const hitCenter = getEnemyHitCenter(enemy, enemyHitCenterTmp);
    const enemyRadius = enemy.mesh.userData.hitRadius ?? (0.32 + (enemy.mesh.userData.baseScale || 0.45) * 0.95);
    return raySphereDistance(origin, dir, hitCenter, enemyRadius);
  }

  function getEnemyHitCenter(enemy, target) {
    const offset = enemy.mesh.userData.hitOffset;
    if (offset) return enemy.mesh.localToWorld(target.copy(offset));
    return target.set(enemy.mesh.position.x, enemy.mesh.position.y, enemy.mesh.position.z);
  }

  function getEnemyHealthAnchor(enemy, target) {
    const offset = enemy.mesh.userData.healthOffset;
    if (offset) return enemy.mesh.localToWorld(target.copy(offset));
    return target.set(enemy.mesh.position.x, enemy.mesh.position.y + 0.85, enemy.mesh.position.z);
  }

  function getEnemyCollisionRadius(enemy) {
    return enemy.mesh.userData.collisionRadius ?? 0.5;
  }

  function enemyBlockedAt(enemy, x, z) {
    const radius = getEnemyCollisionRadius(enemy);
    const minY = enemy.mesh.userData.collisionMinY ?? PLAYER_FOOT_CLEARANCE;
    const maxY = enemy.mesh.userData.collisionMaxY ?? PLAYER_H;
    return wallAtWorldRadius(x, z, radius) || propBlocksAt(x, z, radius, minY, maxY);
  }

  function enemyPathBlocked(enemy, ax, az, bx, bz, spacing = 0.62) {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return false;

    const steps = Math.max(2, Math.ceil(dist / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (enemyBlockedAt(enemy, ax + dx * t, az + dz * t)) return true;
    }
    return false;
  }

  function tryMoveEnemyWithDetour(enemy, dx, dz, options: any = {}) {
    const len = Math.hypot(dx, dz);
    if (len < 0.0001) return false;

    const startX = enemy.mesh.position.x;
    const startZ = enemy.mesh.position.z;
    const startY = enemy.mesh.position.y;
    let bestX = startX;
    let bestZ = startZ;
    let bestScore = -Infinity;

    function testMove(mx, mz) {
      enemy.mesh.position.set(startX, startY, startZ);
      if (!enemyBlockedAt(enemy, startX + mx, startZ)) enemy.mesh.position.x = startX + mx;
      if (!enemyBlockedAt(enemy, enemy.mesh.position.x, startZ + mz)) enemy.mesh.position.z = startZ + mz;

      const movedX = enemy.mesh.position.x - startX;
      const movedZ = enemy.mesh.position.z - startZ;
      const moved = Math.hypot(movedX, movedZ);
      if (moved <= 0.002) return moved;

      let score = moved;
      if (Number.isFinite(options.targetX) && Number.isFinite(options.targetZ)) {
        const before = Math.hypot(options.targetX - startX, options.targetZ - startZ);
        const after = Math.hypot(options.targetX - enemy.mesh.position.x, options.targetZ - enemy.mesh.position.z);
        score += (before - after) * 0.55;
      }
      if (score > bestScore) {
        bestScore = score;
        bestX = enemy.mesh.position.x;
        bestZ = enemy.mesh.position.z;
      }
      return moved;
    }

    const primaryMoved = testMove(dx, dz);
    if (primaryMoved > 0.006 || !options.detour) {
      enemy.mesh.position.set(bestX, startY, bestZ);
      return primaryMoved > 0.006;
    }

    const baseAngle = Math.atan2(dz, dx);
    const side = enemy.unstuckTurnDir || enemy.strafeDir || 1;
    const detourAngles = [side * Math.PI / 3, -side * Math.PI / 3, side * Math.PI / 2, -side * Math.PI / 2, side * Math.PI * 0.78, -side * Math.PI * 0.78, Math.PI];
    for (const offset of detourAngles) {
      const a = baseAngle + offset;
      testMove(Math.cos(a) * len, Math.sin(a) * len);
      if (bestScore > len * 0.55) break;
    }

    enemy.mesh.position.set(bestX, startY, bestZ);
    const moved = Math.hypot(bestX - startX, bestZ - startZ);
    if (moved <= 0.006) {
      enemy.unstuckTurnDir = -side;
      return false;
    }
    enemy.unstuckTurnDir = bestScore >= 0 ? side : -side;
    return true;
  }

  // Clone movement is resolved EXACTLY like the player's: the AI's desired velocity
  // is quantized into virtual WASD keys (a player can only press whole keys), the
  // "keys" are latched for a human-length beat (nobody flickers WASD at 60 Hz), and
  // the final velocity accelerates toward the key-defined target with the player's
  // own momentum lambdas. The animation driver then sees the same clean, discrete
  // movement states a real player produces — that's what keeps its clips solid.
  function resolveClonedGhostPlayerControls(enemy, desiredVelX, desiredVelZ, aimYaw, dist, los, dt) {
    const desiredSpeed = Math.hypot(desiredVelX, desiredVelZ);
    const ghost = enemy.mesh.userData.clonedGhost;
    const controls = ghost?.moveState || { f: 0, s: 0, sprinting: false, jumping: false };

    const forwardX = -Math.sin(aimYaw);
    const forwardZ = -Math.cos(aimYaw);
    const rightX = Math.cos(aimYaw);
    const rightZ = -Math.sin(aimYaw);
    const baseSpeed = Math.max(0.001, enemy.speed);
    const nf = clamp((desiredVelX * forwardX + desiredVelZ * forwardZ) / baseSpeed, -1, 1);
    const ns = clamp((desiredVelX * rightX + desiredVelZ * rightZ) / baseSpeed, -1, 1);

    // Virtual keyboard: press/release with hysteresis, held for a human beat.
    enemy.cloneKeyTimer = Math.max(0, (enemy.cloneKeyTimer || 0) - dt);
    if (desiredSpeed < 0.015) {
      enemy.cloneKeyF = 0;
      enemy.cloneKeyS = 0;
      enemy.cloneKeyTimer = 0;
    } else if (enemy.cloneKeyTimer <= 0) {
      const prevF = enemy.cloneKeyF || 0;
      const prevS = enemy.cloneKeyS || 0;
      const pressF = prevF !== 0 ? 0.22 : 0.38;  // easier to keep holding than to press
      const pressS = prevS !== 0 ? 0.22 : 0.38;
      enemy.cloneKeyF = nf > pressF ? 1 : nf < -pressF ? -1 : 0;
      enemy.cloneKeyS = ns > pressS ? 1 : ns < -pressS ? -1 : 0;
      enemy.cloneKeyTimer = 0.16 + Math.random() * 0.14; // min key-hold duration
    }
    const keyF = enemy.cloneKeyF || 0;
    const keyS = enemy.cloneKeyS || 0;

    const preferRange = enemy.tactics?.preferRange || 12;
    const sprinting = los && keyF !== 0 && (
      (keyF > 0 && keyS === 0 && dist > preferRange + 2.5) ||
      (keyF < 0 && dist < preferRange - 1.4)
    );
    const playerSpeedRatio = player.sprintSpeed / Math.max(0.001, player.speed);
    const speed = sprinting ? enemy.speed * playerSpeedRatio : enemy.speed;

    // Target velocity from the held keys (diagonals normalized, like the player).
    const len = Math.max(1, Math.hypot(keyF, keyS));
    const targetVx = (forwardX * (keyF / len) + rightX * (keyS / len)) * speed;
    const targetVz = (forwardZ * (keyF / len) + rightZ * (keyS / len)) * speed;

    // Player-identical momentum: accelerate at λ15 while a key is held, coast to a
    // stop at λ13 on release (matches the player's grounded moveLambda values).
    const moving = keyF !== 0 || keyS !== 0;
    const lambda = moving ? 15 : 13;
    enemy.cloneVelX = dampValue(enemy.cloneVelX || 0, targetVx, lambda, dt);
    enemy.cloneVelZ = dampValue(enemy.cloneVelZ || 0, targetVz, lambda, dt);

    controls.f = keyF;
    controls.s = keyS;
    controls.sprinting = sprinting;
    controls.jumping = false;
    controls.vx = enemy.cloneVelX;
    controls.vz = enemy.cloneVelZ;
    controls.aimYaw = aimYaw;
    return controls;
  }

  // ── Per-enemy AI brains ──────────────────────────────────────────────────────
  // Each enemy type has a specialised brain, dispatched once per frame from
  // updateEnemies (see updateEnemyBrain). Every brain writes the same standard
  // outputs the mover consumes, so decision-making and locomotion stay in lock-step
  // with the type's animation driver (zombie locoState clips, ghost strafe/backpedal
  // clips, warden aiPhase part-poses in storm_warden.js):
  //   enemy.aiAdvanceMul — forward speed multiplier toward the nav target
  //   enemy.aiLateralMul — strafe/zigzag/orbit gain (0 = beeline, >1 = hard juke)
  //   enemy.aiRetreat    — back away from the player instead of advancing
  //   enemy.aiPhase      — named behaviour phase (drives model part animation)

  // Zombie: relentless hunter with pressure-weaving. Sprints straight on sight, but
  // when it takes fire mid-charge it commits to a short sidestep weave so it doesn't
  // feed the player a straight line. Heavy hits drop it to a staggered walk. The
  // explicit locoState is honoured by the skinned rig (walk/run clip selection).
  function updateZombieCombatState(enemy, dist, los, dt) {
    enemy.zombieWeaveTimer = Math.max(0, (enemy.zombieWeaveTimer || 0) - dt);
    enemy.zombieWeaveCooldown = Math.max(0, (enemy.zombieWeaveCooldown || 0) - dt);
    if (!enemy.aggroed) {
      enemy.locoState = "idle"; enemy.zombieLocoMul = 0;
      enemy.aiLateralMul = 0; enemy.aiRetreat = false; enemy.aiPhase = "idle";
      return;
    }
    // Full-body one-shot in flight (the first-aggro intimidation scream): PLANT.
    // The clip's legs are stationary, so the mover must be too — otherwise the
    // zombie slides across the floor in the scream pose.
    if (enemy.zombieAnimLocked) {
      enemy.locoState = "idle"; enemy.zombieLocoMul = 0;
      enemy.aiLateralMul = 0; enemy.aiRetreat = false; enemy.aiPhase = "scream";
      return;
    }
    const hunting = los || (enemy.lastSeenTimer || 0) > 0;
    const staggered = (enemy.hitStagger || 0) > 0.4;
    // Just got shot while closing in the mid band → juke sideways for a beat.
    if (hunting && !staggered && dist < 13 && dist > 3.2 && enemy.zombieWeaveCooldown <= 0 && (enemy.hitFlash || 0) > 0.05) {
      enemy.zombieWeaveTimer = 0.30 + Math.random() * 0.32;
      enemy.zombieWeaveCooldown = 1.5 + Math.random() * 1.7;
      enemy.orbitDir = Math.random() > 0.5 ? 1 : -1;
      enemy.strafeDir = enemy.orbitDir;
    }
    const weaving = enemy.zombieWeaveTimer > 0;
    const atMelee = dist <= 1.45; // mover halts at 1.28 — idle the legs so they don't treadmill under the attack swing
    enemy.aiLateralMul = weaving ? 4.2 : 0;
    enemy.aiRetreat = false;
    enemy.zombieLocoMul = staggered ? 0.5 : hunting ? 1.28 : 0.55;
    enemy.locoState = atMelee ? "idle" : staggered ? "walk" : hunting ? "run" : "walk";
    enemy.aiPhase = staggered ? "stagger" : atMelee ? "melee" : hunting ? "charge" : "prowl";
    if (hunting && !staggered) enemy.lungeBoost = Math.max(enemy.lungeBoost, 0.3);
  }

  // Cloned Ghost: disciplined rifleman. Fights inside an engagement band (~7–15 m):
  // sprints to close when outside it, holds and strafe-fights inside it, anchors
  // briefly to land accurate bursts, and backpedals (walkBack/strafe clips) when the
  // player pushes inside ~6 m. Getting hit triggers an evasive juke. All of these
  // map 1:1 onto the humanoid clip set in updateClonedGhostVisual (sprint / strafe /
  // walkBack / fire), so what it decides is exactly what it animates.
  function updateClonedGhostCombatState(enemy, dist, los, dt) {
    enemy.jukeTimer = Math.max(0, (enemy.jukeTimer || 0) - dt);
    enemy.jukeCooldown = Math.max(0, (enemy.jukeCooldown || 0) - dt);
    enemy.fireAnchor = Math.max(0, (enemy.fireAnchor || 0) - dt);
    if (!enemy.aggroed) {
      enemy.cloneAdvanceMul = 0.9;
      enemy.cloneLateralMul = 0.08;
      enemy.cloneWantDirect = true;
      enemy.aiRetreat = false;
      enemy.aiPhase = "patrol";
      return;
    }
    const range = enemy.ranged?.range || 26;
    const canShoot = los && dist <= range;
    const inBand = canShoot && dist >= 6 && dist <= 15;
    // React to taking fire: break the current pattern with a hard strafe juke.
    if ((enemy.hitFlash || 0) > 0.08 && enemy.jukeTimer <= 0 && enemy.jukeCooldown <= 0) {
      enemy.jukeTimer = 0.38 + Math.random() * 0.4;
      enemy.jukeCooldown = 1.2 + Math.random() * 1.4;
      enemy.orbitDir = Math.random() > 0.5 ? 1 : -1;
      enemy.fireAnchor = 0;
    }
    if (canShoot && enemy.jukeTimer <= 0 && enemy.fireAnchor <= 0 && enemy.jukeCooldown <= 0) {
      const r = Math.random();
      if (inBand && r < 0.45) {                       // in the band: plant and shoot
        enemy.fireAnchor = 0.5 + Math.random() * 0.55;
        enemy.jukeCooldown = 1.1 + Math.random() * 1.3;
      } else if (r < 0.28) {                          // reposition strafe
        enemy.jukeTimer = 0.4 + Math.random() * 0.45;
        enemy.jukeCooldown = 1.6 + Math.random() * 1.8;
        enemy.orbitDir = Math.random() > 0.5 ? 1 : -1;
      } else {
        enemy.jukeCooldown = 0.4 + Math.random() * 0.7;
      }
    }
    const juking = enemy.jukeTimer > 0;
    const crowded = dist < 6 && los;
    const anchored = enemy.fireAnchor > 0 && dist > 3.0 && !crowded; // never freeze point-blank
    // Inside the band prefer the flank-scored plan (spacing/LOS) over a straight chase.
    enemy.cloneWantDirect = !juking && !inBand && !crowded;
    enemy.cloneLateralMul = juking ? 0.9 : crowded ? 0.7 : inBand ? 0.35 : 0.08;
    enemy.cloneAdvanceMul = anchored ? 0.0 : crowded ? 0.6 : inBand ? 0.4 : dist < 3.5 ? 0.5 : 0.95;
    enemy.aiRetreat = crowded && !juking;
    enemy.aiPhase = anchored ? "anchor" : crowded ? "fallback" : juking ? "juke" : inBand ? "skirmish" : "close";
  }

  // Warden (Siege Drone): siege phase machine. HUNT rushes hard from long range (the
  // model's parts loosen into the dive), ADVANCE closes at cruise, ANCHOR plants to
  // telegraph + fire (parts snap together, rods flare), RECOVER circles sideways on
  // the post-fire cooldown so it doesn't hover inert in the open. The aiPhase feeds
  // storm_warden.js, which poses arms/head/rod-fan per phase.
  function updateWardenCombatState(enemy, dist, los, dt) {
    if (!enemy.aggroed) {
      enemy.aiPhase = "hunt"; enemy.aiAdvanceMul = 1.0; enemy.aiLateralMul = 0;
      enemy.aiRetreat = false;
      return;
    }
    const winding = (enemy.lightningWindUp || 0) > 0 || enemy.barrageActive === true;
    const cooling = (enemy.lightningStreamTimer || 0) > 1.1;
    let phase;
    if (winding) phase = "anchor";
    else if (dist > 13) phase = "hunt";
    else if (dist > 8.5) phase = "advance";
    else if (cooling) phase = "recover";
    else phase = "anchor";
    enemy.aiPhase = phase;
    switch (phase) {
      case "hunt":    enemy.aiAdvanceMul = 1.85; enemy.aiLateralMul = 0;    break;
      case "advance": enemy.aiAdvanceMul = 1.0;  enemy.aiLateralMul = 0;    break;
      case "anchor":  enemy.aiAdvanceMul = winding ? 0.0 : 0.42; enemy.aiLateralMul = winding ? 0 : 0.6; break;
      case "recover": enemy.aiAdvanceMul = 0.3;  enemy.aiLateralMul = 6.0;  break; // hard sideways drift
    }
    enemy.aiRetreat = false; // too-close retreat handled by the siege smart plan
  }

  // Blink Seraph: teleporting skirmisher. Orbits an attack band (~5–11 m) with heavy
  // lateral motion, plants only for the cast telegraph, and slides back out when the
  // player pushes in. Its teleport is triggered tactically (see tryEnemyTeleport):
  // when it's taking hits or the player breaks the band — not on a blind timer.
  function updateSeraphCombatState(enemy, dist, los, dt) {
    if (!enemy.aggroed) {
      enemy.aiPhase = "drift"; enemy.aiAdvanceMul = 0.6; enemy.aiLateralMul = 0.3;
      enemy.aiRetreat = false;
      return;
    }
    const winding = (enemy.lightningWindUp || 0) > 0;
    if (winding)          { enemy.aiPhase = "anchor"; enemy.aiAdvanceMul = 0.0;  enemy.aiLateralMul = 0.25; enemy.aiRetreat = false; }
    else if (dist > 11)   { enemy.aiPhase = "close";  enemy.aiAdvanceMul = 1.35; enemy.aiLateralMul = 0.35; enemy.aiRetreat = false; }
    else if (dist < 5.2)  { enemy.aiPhase = "slip";   enemy.aiAdvanceMul = 0.45; enemy.aiLateralMul = 1.3;  enemy.aiRetreat = los; }
    else                  { enemy.aiPhase = "orbit";  enemy.aiAdvanceMul = 0.5;  enemy.aiLateralMul = 1.0;  enemy.aiRetreat = false; }
  }

  // Null Cherub: void artillery. Holds a bombardment band (~8–15 m) and drifts
  // laterally while its strikes rain, gives ground when the player closes — UNLESS
  // its EMP is charged, in which case it deliberately holds/advances into point-blank
  // range to bait the player into the blast. Channeling itself halts movement (the
  // mover is skipped while megaBlasting), which reads as a committed casting stance.
  function updateCherubCombatState(enemy, dist, los, dt) {
    if (!enemy.aggroed) {
      enemy.aiPhase = "drift"; enemy.aiAdvanceMul = 0.5; enemy.aiLateralMul = 0.3;
      enemy.aiRetreat = false;
      return;
    }
    const empReady = !!enemy.emp && (enemy.empCooldown || 0) <= 0;
    if (empReady && dist < 7)  { enemy.aiPhase = "bait";     enemy.aiAdvanceMul = 1.15; enemy.aiLateralMul = 0.25; enemy.aiRetreat = false; }
    else if (dist < 7.5)       { enemy.aiPhase = "fallback"; enemy.aiAdvanceMul = 0.9;  enemy.aiLateralMul = 0.6;  enemy.aiRetreat = los; }
    else if (dist > 15)        { enemy.aiPhase = "close";    enemy.aiAdvanceMul = 0.95; enemy.aiLateralMul = 0.25; enemy.aiRetreat = false; }
    else                       { enemy.aiPhase = "hold";     enemy.aiAdvanceMul = 0.4;  enemy.aiLateralMul = 0.85; enemy.aiRetreat = false; }
  }

  // Brain dispatcher — one specialised brain per enemy type.
  function updateEnemyBrain(enemy, dist, los, dt, isZombie, isClonedGhost) {
    if (isZombie) updateZombieCombatState(enemy, dist, los, dt);
    else if (isClonedGhost) updateClonedGhostCombatState(enemy, dist, los, dt);
    else if (enemy.typeName === "Siege Drone") updateWardenCombatState(enemy, dist, los, dt);
    else if (enemy.typeName === "Blink Seraph") updateSeraphCombatState(enemy, dist, los, dt);
    else if (enemy.typeName === "Null Cherub") updateCherubCombatState(enemy, dist, los, dt);
  }

  function getSiegeSmartThinkDelay(enemy, dist) {
    const pressureMul = dist < 6.5 || enemy.attackPulse > 0.2 ? 0.72 : 1;
    return (SIEGE_SMART_THINK_MIN + Math.random() * (SIEGE_SMART_THINK_MAX - SIEGE_SMART_THINK_MIN)) * pressureMul;
  }

  function setSiegeSmartTarget(enemy, target) {
    enemy.smartPlanValid = !!target;
    enemy.smartTargetX = target ? target.x : 0;
    enemy.smartTargetZ = target ? target.z : 0;
  }

  function runSiegeSmartUnstuckScan(enemy, targetX, targetZ, dirNormX, dirNormZ) {
    const startX = enemy.mesh.position.x;
    const startZ = enemy.mesh.position.z;
    const side = enemy.unstuckTurnDir || enemy.strafeDir || 1;
    const toTargetX = targetX - startX;
    const toTargetZ = targetZ - startZ;
    const targetDist = Math.hypot(toTargetX, toTargetZ) || 1;
    const baseAngle = Math.atan2(toTargetZ / targetDist, toTargetX / targetDist);
    const awayAngle = Math.atan2(-dirNormZ || -toTargetZ / targetDist, -dirNormX || -toTargetX / targetDist);
    const candidates = [
      { angle: baseAngle, len: 0.92, weight: 1.0 },
      { angle: baseAngle + side * 0.72, len: 0.98, weight: 0.94 },
      { angle: baseAngle - side * 0.72, len: 0.98, weight: 0.86 },
      { angle: baseAngle + side * 1.35, len: 1.06, weight: 0.84 },
      { angle: baseAngle - side * 1.35, len: 1.06, weight: 0.78 },
      { angle: awayAngle + side * 0.78, len: 1.12, weight: 0.82 },
      { angle: awayAngle - side * 0.78, len: 1.12, weight: 0.74 },
    ];

    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const x = startX + Math.cos(candidate.angle) * candidate.len;
      const z = startZ + Math.sin(candidate.angle) * candidate.len;
      if (enemyBlockedAt(enemy, x, z)) continue;
      const targetGain = targetDist - Math.hypot(targetX - x, targetZ - z);
      const playerClearance = Math.hypot((enemy.lastSeenX ?? targetX) - x, (enemy.lastSeenZ ?? targetZ) - z);
      const score = targetGain * 1.6 + playerClearance * 0.025 + candidate.weight;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    enemy.smartUnstuckTimer = SIEGE_SMART_UNSTUCK_SCAN_INTERVAL;
    if (!best) {
      enemy.unstuckTurnDir = -side;
      return false;
    }

    enemy.unstuckTurnDir = best.angle > baseAngle ? side : -side;
    enemy.avoidX = Math.cos(best.angle);
    enemy.avoidZ = Math.sin(best.angle);
    enemy.avoidTimer = 0.72;
    enemy.navPath = [];
    enemy.navTimer = 0;
    enemy.smartThinkTimer = 0;
    return true;
  }

  function refreshSiegeSmartPlan(enemy, playerCell, dirNormX, dirNormZ, dist, los, tactics) {
    const enemyCell = worldToMap(enemy.mesh.position.x, enemy.mesh.position.z);
    const movedDist = Math.hypot(enemy.mesh.position.x - enemy.lastRepathX, enemy.mesh.position.z - enemy.lastRepathZ);
    const siegeTooClose = enemy.lightning && los && dist < 5.2;
    const tacticalGoal = getTacticalGoalCell(enemy, playerCell, dirNormX, dirNormZ, dist);
    const directPathClear = !enemyPathBlocked(enemy, enemy.mesh.position.x, enemy.mesh.position.z, enemy.lastSeenX, enemy.lastSeenZ);
    const canDirectChase = los && dist < tactics.directRange && !wallAtWorldRadius(enemy.lastSeenX, enemy.lastSeenZ, 0.34) && directPathClear;
    const needRepath = !canDirectChase && (!enemy.navPath || enemy.navPath.length === 0 || !enemy.navGoal || enemy.navGoal.mx !== tacticalGoal.mx || enemy.navGoal.my !== tacticalGoal.my || enemy.navTimer <= 0 || movedDist > 2.1);

    if (needRepath) {
      enemy.navGoal = { mx: tacticalGoal.mx, my: tacticalGoal.my };
      enemy.navPath = findPath(enemyCell, tacticalGoal, enemy);
      enemy.navTimer = tactics.repath + Math.random() * 0.18;
      enemy.lastRepathX = enemy.mesh.position.x;
      enemy.lastRepathZ = enemy.mesh.position.z;
    }

    let target = null;
    if (siegeTooClose) {
      target = {
        x: enemy.mesh.position.x - dirNormX * 4.5 + -dirNormZ * enemy.unstuckTurnDir * 2.1,
        z: enemy.mesh.position.z - dirNormZ * 4.5 + dirNormX * enemy.unstuckTurnDir * 2.1,
      };
      enemy.directChaseTimer = 0;
    } else if (canDirectChase) {
      target = { x: enemy.lastSeenX, z: enemy.lastSeenZ };
      enemy.directChaseTimer = 0.35;
    } else {
      while (enemy.navPath && enemy.navPath.length) {
        const nextCell = enemy.navPath[0];
        const nextCenter = cellCenter(nextCell.mx, nextCell.my);
        if (Math.hypot(nextCenter.x - enemy.mesh.position.x, nextCenter.z - enemy.mesh.position.z) < 0.45) enemy.navPath.shift();
        else {
          target = nextCenter;
          break;
        }
      }
      if (!target) {
        target = {
          x: enemy.lastSeenX + -dirNormZ * enemy.unstuckTurnDir * 1.6,
          z: enemy.lastSeenZ + dirNormX * enemy.unstuckTurnDir * 1.6,
        };
      }
    }

    enemy.smartSiegeTooClose = siegeTooClose;
    enemy.smartCanDirectChase = canDirectChase;
    enemy.smartThinkTimer = getSiegeSmartThinkDelay(enemy, dist);
    setSiegeSmartTarget(enemy, target);
  }

  function refreshClonedGhostSmartPlan(enemy, playerCell, dirNormX, dirNormZ, dist, los, tactics) {
    const enemyCell = worldToMap(enemy.mesh.position.x, enemy.mesh.position.z);
    const preferred = tactics.preferRange || 13.2;
    const side = enemy.orbitDir || enemy.strafeDir || 1;
    const tooClose = dist < preferred - 2.2;
    const tooFar = dist > preferred + 6.5;
    const lastX = enemy.lastSeenX;
    const lastZ = enemy.lastSeenZ;
    const directPathClear = !enemyPathBlocked(enemy, enemy.mesh.position.x, enemy.mesh.position.z, lastX, lastZ, 0.82);
    const canShoot = los && dist <= (enemy.ranged?.range || tactics.directRange || 26);

    // Default aggressive behaviour: drive straight at the player. Only fall through to
    // the flank/orbit scoring below while a juke window is active (cloneWantDirect false).
    if (enemy.cloneWantDirect !== false && los && directPathClear) {
      enemy.smartSiegeTooClose = false;
      enemy.smartCanDirectChase = true;
      enemy.smartThinkTimer = 0.14 + Math.random() * 0.12;
      enemy.directChaseTimer = 0.3;
      setSiegeSmartTarget(enemy, { x: lastX, z: lastZ });
      return;
    }

    let best = null;
    let bestScore = -Infinity;
    const baseAngle = Math.atan2(enemy.mesh.position.z - lastZ, enemy.mesh.position.x - lastX);
    const flankAngles = [
      baseAngle + side * 0.95,
      baseAngle - side * 0.95,
      baseAngle + side * 1.55,
      baseAngle - side * 1.55,
      baseAngle,
      baseAngle + Math.PI,
    ];

    for (let i = 0; i < flankAngles.length; i++) {
      const angle = flankAngles[i];
      const radius = preferred + (i < 2 ? 0 : i < 4 ? 1.4 : tooClose ? 2.2 : -1.2);
      const x = lastX + Math.cos(angle) * radius;
      const z = lastZ + Math.sin(angle) * radius;
      if (enemyBlockedAt(enemy, x, z)) continue;
      const candidateDist = Math.hypot(lastX - x, lastZ - z);
      const rangeScore = 1 - Math.min(1, Math.abs(candidateDist - preferred) / Math.max(1, preferred));
      const losScore = hasLineOfSightWorld(x, z, lastX, lastZ, 0.2) ? 1 : 0;
      const moveCost = Math.hypot(x - enemy.mesh.position.x, z - enemy.mesh.position.z);
      const sideScore = i < 2 ? 0.4 : i < 4 ? 0.25 : 0;
      const retreatScore = tooClose ? Math.max(0, candidateDist - dist) * 0.1 : 0;
      const closeScore = tooFar ? Math.max(0, dist - moveCost) * 0.035 : 0;
      const score = losScore * 2.4 + rangeScore * 1.5 + sideScore + retreatScore + closeScore - moveCost * 0.025;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }

    let target = null;
    if (tooClose && best) {
      target = best;
      enemy.directChaseTimer = 0;
    } else if (canShoot && best && !tooFar) {
      target = best;
      enemy.directChaseTimer = 0.18;
    } else if (los && directPathClear && tooFar) {
      target = { x: lastX, z: lastZ };
      enemy.directChaseTimer = 0.3;
    } else {
      const tacticalGoal = best ? worldToMap(best.x, best.z) : getTacticalGoalCell(enemy, playerCell, dirNormX, dirNormZ, dist);
      const movedDist = Math.hypot(enemy.mesh.position.x - enemy.lastRepathX, enemy.mesh.position.z - enemy.lastRepathZ);
      const needRepath = !enemy.navPath || enemy.navPath.length === 0 || !enemy.navGoal || enemy.navGoal.mx !== tacticalGoal.mx || enemy.navGoal.my !== tacticalGoal.my || enemy.navTimer <= 0 || movedDist > 2.1;
      if (needRepath) {
        enemy.navGoal = { mx: tacticalGoal.mx, my: tacticalGoal.my };
        enemy.navPath = findPath(enemyCell, tacticalGoal, enemy);
        enemy.navTimer = (tactics.repath || 0.7) + Math.random() * 0.16;
        enemy.lastRepathX = enemy.mesh.position.x;
        enemy.lastRepathZ = enemy.mesh.position.z;
      }
      while (enemy.navPath && enemy.navPath.length) {
        const nextCell = enemy.navPath[0];
        const nextCenter = cellCenter(nextCell.mx, nextCell.my);
        if (Math.hypot(nextCenter.x - enemy.mesh.position.x, nextCenter.z - enemy.mesh.position.z) < 0.45) enemy.navPath.shift();
        else {
          target = nextCenter;
          break;
        }
      }
      if (!target) target = best || { x: lastX + -dirNormZ * side * 2.2, z: lastZ + dirNormX * side * 2.2 };
    }

    enemy.smartSiegeTooClose = tooClose;
    enemy.smartCanDirectChase = canShoot && directPathClear;
    enemy.smartThinkTimer = (dist < 8 ? 0.16 : 0.24) + Math.random() * 0.18;
    setSiegeSmartTarget(enemy, target);
  }

  function getAnimationTrackNodeName(trackName) {
    try {
      return THREE.PropertyBinding.parseTrackName(trackName).nodeName;
    } catch (err) {
      const dot = trackName.lastIndexOf(".");
      return dot > 0 ? trackName.slice(0, dot) : "";
    }
  }

  function makeInPlaceClipForModel(clip, model, options: any = {}) {
    const nodeNames = new Set();
    model.traverse(obj => {
      if (obj.name) nodeNames.add(obj.name);
    });
    const preserveBonePositions = options.preserveBonePositions === true;

    const tracks = clip.tracks.filter(track => {
      const nodeName = getAnimationTrackNodeName(track.name);
      if (nodeName && !nodeNames.has(nodeName)) return false;
      // Drop bone SCALE tracks. Mixamo animation FBXs bound onto the converted GLB
      // skeleton can carry stray/near-zero scale keys; when a clip that has them plays
      // (e.g. run/walk) it scales bones to garbage and the skinned mesh visibly
      // deforms/explodes. Humanoid locomotion never legitimately scales bones, so this
      // is always safe and fixes the zombie deformation.
      if (track.name.endsWith(".scale")) return false;
      if (!track.name.endsWith(".position")) return true;
      return preserveBonePositions && nodeName && nodeName !== model.name;
    });

    const inPlaceClip = new THREE.AnimationClip(`${clip.name || "walk"}_in_place`, clip.duration, tracks);
    inPlaceClip.optimize();
    return inPlaceClip;
  }

  const ENEMY_TYPES = [
    { name: "Siege Drone", hp: 820, speed: 8.2, damage: [8, 12], attackRate: 1.2, color: 0x77cfff, emissive: 0x0a5cff, scale: 1.12, xp: 4, aura: null, angelModel: true, lightning: { range: 18.0, radius: 1.35, damage: [16, 24], strikes: [1, 1], streamInterval: [0.09, 0.15], damageInterval: 0.24, playerBias: 0.95, cooldown: 2.9 }, glow: 1.9 },
    { name: CLONED_GHOST_TYPE_NAME, hp: 270, speed: window.SJM?.config?.ghostSpeed ?? 7.5, damage: [5, 8], attackRate: 1.25, color: 0xff9b47, emissive: 0x7a3010, scale: 1, xp: 9, clonedGhost: true, ranged: { range: 29, cooldown: 0.9, pellets: 1, spread: 0.018, damage: [5, 8], gunType: GUNS.RIFLE, burst: [1, 2], burstGap: 0.12, aimJitter: 0.3, lead: 0.09 }, glow: 1.05 },
    { name: "Blink Seraph", hp: 560, speed: 4.8, damage: [7, 11], attackRate: 1.35, color: 0xb28cff, emissive: 0x6e31ff, scale: 0.96, xp: 6, angelModel: true, variant: "blink", lightning: { range: 10.8, radius: 0.95, damage: [10, 14], strikes: [1, 1], streamInterval: [0.1, 0.17], damageInterval: 0.28, playerBias: 0.60 }, teleport: { cooldown: 6, minRange: 4.8, maxRange: 8.2 }, glow: 1.6 },
    { name: "Null Cherub", hp: 700, speed: 3.5, damage: [5, 8], attackRate: 1.8, color: 0x62ffd6, emissive: 0x00aa88, scale: 1.04, xp: 7, angelModel: true, variant: "null", emp: { cooldown: 7, radius: 4.4, damage: [13, 18], staminaDamage: 34 }, megaBlast: { range: 24, duration: 3.2, cooldown: 6, damagePerSecond: [13, 18], staminaDamagePerSecond: 18, damageInterval: 0.18 }, glow: 1.45 },
    // Melee zombie — no lightning/ranged/emp, so the generic melee system (dist ≤ 1.28,
    // 0.28s wind-up) drives its attack. Skinned Mixamo rig via modules/zombie_character.js.
    { name: "Zombie", hp: 240, speed: 6.5, damage: [11, 17], attackRate: 0.55, color: 0x7a8a55, emissive: 0x1d2a10, scale: 1.0, xp: 5, zombieModel: true, glow: 0.6 },
  ];

  // ── Developer Engine: enemy overrides (idempotent, resets from base) ────────
  // Snapshot the built-in per-type tunables so re-apply never compounds.
  const ENEMY_TYPE_BASE = new Map(ENEMY_TYPES.map((t) => [t.name, {
    hp: t.hp, speed: t.speed, attackRate: t.attackRate, scale: t.scale, xp: t.xp, glow: t.glow,
    color: t.color, emissive: t.emissive,
    damage: Array.isArray(t.damage) ? t.damage.slice() : t.damage,
  }]));
  const hexToInt = (v, fallback) => {
    if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) return parseInt(v.slice(1), 16);
    return fallback;
  };
  function applyDevEnemies() {
    const dmgMul = (devHas("gameplay") && Number.isFinite(DEV.gameplay.enemyDamageMult))
      ? DEV.gameplay.enemyDamageMult : 1;
    for (const type of ENEMY_TYPES) {
      const base = ENEMY_TYPE_BASE.get(type.name);
      if (base) {
        type.hp = base.hp; type.speed = base.speed; type.attackRate = base.attackRate;
        type.scale = base.scale; type.xp = base.xp; type.glow = base.glow;
        type.color = base.color; type.emissive = base.emissive;
        type.damage = Array.isArray(base.damage) ? base.damage.slice() : base.damage;
      }
      const o = devHas("enemies") ? DEV.enemies[type.name] : null;
      if (o) {
        if (Number.isFinite(o.hp)) type.hp = o.hp;
        if (Number.isFinite(o.speed)) type.speed = o.speed;
        if (Number.isFinite(o.attackRate)) type.attackRate = o.attackRate;
        if (Number.isFinite(o.scale)) type.scale = o.scale;
        if (Number.isFinite(o.xp)) type.xp = o.xp;
        if (Number.isFinite(o.glow)) type.glow = o.glow;
        type.color = hexToInt(o.color, type.color);
        type.emissive = hexToInt(o.emissive, type.emissive);
        if (Number.isFinite(o.damageMin) && Number.isFinite(o.damageMax)) {
          type.damage = [o.damageMin, o.damageMax];
        }
      }
      if (dmgMul !== 1 && Array.isArray(type.damage)) {
        type.damage = type.damage.map((v) => Math.max(1, Math.round(v * dmgMul)));
      }
    }
    // Live enemies keep the stats they spawned with; enemy edits take effect on
    // the next spawn/wave (predictable, and avoids retroactive wave-scale drift).
  }
  applyDevEnemies();

  // Precomputed typeName → array index. Used by the 50 Hz co-op enemy broadcast
  // to avoid an O(types) findIndex per enemy per network tick.
  const ENEMY_TYPE_INDEX = new Map(ENEMY_TYPES.map((type, i) => [type.name, i]));

  const enemyPools = Object.fromEntries(ENEMY_TYPES.map(type => [type.name, []]));

  function getDroneAnimProfile(typeName) {
    // Warden: smooth direct swoop (reduced strafe/zigzag/orbit) so the smart-bot
    // pathing doesn't fight the flying-separation visual and read janky.
    if (typeName === "Siege Drone") return { spinMul: 0.34, wobbleAmp: 0.01, strafe: 0.05, zigzagAmp: 0.018, zigzagSpeed: 1.0, orbit: 0.07, orbitRange: 7.0, lungeBoost: 0.5, speedWaveAmp: 0.02, hoverBase: 1.02 };
    if (typeName === CLONED_GHOST_TYPE_NAME) return { spinMul: 0.1, wobbleAmp: 0.0, strafe: 0.06, zigzagAmp: 0.022, zigzagSpeed: 0.6, orbit: 0.04, orbitRange: 3.5, lungeBoost: 0.8, speedWaveAmp: 0.03, hoverBase: 0 };
    if (typeName === "Blink Seraph") return { spinMul: 0.92, wobbleAmp: 0.04, strafe: 0.5, zigzagAmp: 0.034, zigzagSpeed: 1.72, orbit: 0.58, orbitRange: 10.4, lungeBoost: 0.2, speedWaveAmp: 0.06, hoverBase: 1.08 };
    if (typeName === "Null Cherub") return { spinMul: 0.34, wobbleAmp: 0.015, strafe: 0.16, zigzagAmp: 0.01, zigzagSpeed: 0.78, orbit: 0.14, orbitRange: 6.1, lungeBoost: 0.045, speedWaveAmp: 0.012, hoverBase: 0.98 };
    // Zombie: relentless straight-ahead shamble — minimal strafe/orbit, no hover.
    if (typeName === "Zombie") return { spinMul: 0.1, wobbleAmp: 0.0, strafe: 0.05, zigzagAmp: 0.022, zigzagSpeed: 0.55, orbit: 0.04, orbitRange: 4.5, lungeBoost: 0.12, speedWaveAmp: 0.03, hoverBase: 0 };
    return { spinMul: 0.34, wobbleAmp: 0.024, strafe: 0.035, zigzagAmp: 0.008, zigzagSpeed: 0.72, orbit: 0.055, orbitRange: 11.2, lungeBoost: 0.055, speedWaveAmp: 0.014, hoverBase: 1.02 };
  }

  function makeHealthBar() {
    return null;
  }

  let muzzleFlashTexture = null;
  function getMuzzleFlashTexture() {
    if (muzzleFlashTexture) return muzzleFlashTexture;
    const sz = 256;
    const cx = sz / 2, cy = sz / 2;
    const canvas = document.createElement("canvas");
    canvas.width = sz;
    canvas.height = sz;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, sz, sz);
    ctx.globalCompositeOperation = "lighter";

    // Outer heat corona — rounder than before
    const corona = ctx.createRadialGradient(cx, cy, 0, cx, cy, 108);
    corona.addColorStop(0,    "rgba(255,255,255,1.0)");
    corona.addColorStop(0.10, "rgba(255,248,195,0.90)");
    corona.addColorStop(0.25, "rgba(255,195,72,0.55)");
    corona.addColorStop(0.50, "rgba(255,110,22,0.26)");
    corona.addColorStop(1,    "rgba(255,55,8,0)");
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 102, 88, 0, 0, Math.PI * 2);
    ctx.fill();

    function drawFlame(angle, length, width, alpha) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      const grad = ctx.createLinearGradient(0, 0, length, 0);
      grad.addColorStop(0,    `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.10, `rgba(255,245,165,${alpha * 0.94})`);
      grad.addColorStop(0.42, `rgba(255,130,30,${alpha * 0.60})`);
      grad.addColorStop(1,    "rgba(255,55,8,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.quadraticCurveTo(length * 0.20, -width, length, 0);
      ctx.quadraticCurveTo(length * 0.30, width * 0.80, -10, 0);
      ctx.fill();
      ctx.restore();
    }

    // Main forward blast
    drawFlame(0,           112, 28, 0.96);
    // Secondary asymmetric petals
    drawFlame( 0.20,        88, 20, 0.76);
    drawFlame(-0.24,        84, 18, 0.72);
    drawFlame( 0.50,        62, 15, 0.48);
    drawFlame(-0.54,        58, 14, 0.44);
    drawFlame( 0.88,        42, 10, 0.28);
    drawFlame(-0.92,        38,  9, 0.24);
    // Back-blast (gas ejection)
    drawFlame(Math.PI,      38, 13, 0.34);
    drawFlame(Math.PI+0.26, 24,  8, 0.16);

    // Hot white core
    const core = ctx.createRadialGradient(cx - 8, cy, 0, cx, cy, 38);
    core.addColorStop(0,    "rgba(255,255,255,1)");
    core.addColorStop(0.18, "rgba(255,254,225,0.98)");
    core.addColorStop(0.48, "rgba(255,215,95,0.62)");
    core.addColorStop(1,    "rgba(255,130,28,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.ellipse(cx - 4, cy, 38, 28, 0, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    muzzleFlashTexture = texture;
    return texture;
  }

  function createMuzzleFlash(baseColorHex, baseScale = 1) {
    const material = new THREE.SpriteMaterial({
      map: getMuzzleFlashTexture(),
      color: baseColorHex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const flash = new THREE.Sprite(material);
    flash.userData = { baseColor: baseColorHex };
    flash.visible = false;
    flash.renderOrder = 30;
    flash.frustumCulled = false;
    flash.scale.set(baseScale * 1.65, baseScale * 0.82, baseScale);
    flash.userData.baseScale = baseScale;
    return flash;
  }

  function createPhysicalMuzzleFlash(baseColorHex, length = 0.28, radius = 0.07, glowRadius = 0.05) {
    const group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 32;
    group.frustumCulled = false;

    const flameMat = new THREE.MeshBasicMaterial({
      color: baseColorHex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const hotMat = new THREE.MeshBasicMaterial({
      color: 0xfff3c7,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 10, 1, true), flameMat);
    cone.rotation.z = -Math.PI * 0.5;
    cone.position.x = length * 0.42;
    cone.frustumCulled = false;
    group.add(cone);

    const core = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.42, length * 0.68, 8, 1, true), hotMat);
    core.rotation.z = -Math.PI * 0.5;
    core.position.x = length * 0.34;
    core.frustumCulled = false;
    group.add(core);

    const glow = new THREE.Mesh(new THREE.SphereGeometry(glowRadius, 10, 8), flameMat.clone());
    glow.position.x = length * 0.08;
    glow.frustumCulled = false;
    group.add(glow);

    const planeGeometry = new THREE.PlaneGeometry(length * 1.45, radius * 3.1);
    const plumeA = new THREE.Mesh(planeGeometry, flameMat.clone());
    plumeA.position.x = length * 0.45;
    plumeA.frustumCulled = false;
    group.add(plumeA);

    const plumeB = new THREE.Mesh(planeGeometry, flameMat.clone());
    plumeB.position.x = length * 0.43;
    plumeB.rotation.x = Math.PI * 0.5;
    plumeB.frustumCulled = false;
    group.add(plumeB);

    const shockMat = new THREE.MeshBasicMaterial({
      color: 0xfff1c6,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const shock = new THREE.Mesh(new THREE.RingGeometry(radius * 0.35, radius * 1.55, 18), shockMat);
    shock.position.x = length * 0.08;
    shock.rotation.y = Math.PI * 0.5;
    shock.frustumCulled = false;
    group.add(shock);

    group.userData.parts = { cone, core, glow, plumeA, plumeB, shock };
    return group;
  }

  function setPhysicalMuzzleFlash(muzzle, visible, t, scale = 1) {
    if (!muzzle) return;
    const flash3d = muzzle.userData?.flash3d;
    if (flash3d) {
      const parts = flash3d.userData.parts || {};
      flash3d.visible = visible;
      flash3d.rotation.x = visible ? (Math.random() - 0.5) * 1.6 : 0;
      flash3d.rotation.z = visible ? (Math.random() - 0.5) * 0.5 : 0;
      flash3d.scale.setScalar(scale * (0.72 + (1 - t) * 0.32));
      if (parts.cone?.material)  parts.cone.material.opacity  = visible ? Math.min(0.88, 0.78 * t + 0.10) : 0;
      if (parts.core?.material)  parts.core.material.opacity  = visible ? Math.min(0.98, 0.92 * t + 0.06) : 0;
      if (parts.glow?.material)  parts.glow.material.opacity  = visible ? Math.min(0.72, 0.62 * t + 0.08) : 0;
      if (parts.plumeA?.material) parts.plumeA.material.opacity = visible ? Math.min(0.62, 0.52 * t + 0.06) : 0;
      if (parts.plumeB?.material) parts.plumeB.material.opacity = visible ? Math.min(0.50, 0.42 * t + 0.05) : 0;
      if (parts.shock?.material) {
        parts.shock.material.opacity = visible ? Math.min(0.55, 0.46 * t + 0.06) : 0;
        parts.shock.scale.setScalar(0.32 + (1 - t) * 1.35);
      }
    }

    const cone = muzzle.userData?.flashCone;
    const glow = muzzle.userData?.flashGlow;
    const useLegacyFlash = !flash3d;
    if (cone) {
      cone.visible = visible && useLegacyFlash;
      cone.scale.setScalar(scale * (0.48 + (1 - t) * 0.42));
      if (cone.material) cone.material.emissiveIntensity = visible && useLegacyFlash ? Math.max(0.001, 3.2 * t) : 0;
    }
    if (glow) {
      glow.visible = visible && useLegacyFlash;
      glow.scale.setScalar(scale * (0.58 + (1 - t) * 0.28));
      if (glow.material) {
        glow.material.emissiveIntensity = visible && useLegacyFlash ? Math.max(0.001, 2.4 * t) : 0;
        glow.material.opacity = visible && useLegacyFlash ? Math.min(0.42, 0.42 * t) : 0;
      }
    }
  }

  function applyMuzzleFlashSprite(flash, visible, t, gunType, thirdPersonScale = 1) {
    if (!flash?.material) return;
    const base = flash.userData?.baseScale || 1;
    const style = gunType === GUNS.SHOTGUN
      ? { x: 1.30, y: 0.78, opacity: 0.82, jitter: 0.55 }
      : gunType === GUNS.SNIPER
        ? { x: 1.10, y: 0.52, opacity: 0.68, jitter: 0.38 }
        : { x: 1.05, y: 0.60, opacity: 0.76, jitter: 0.48 };
    const bloom = 1.02 + (1 - t) * (gunType === GUNS.SHOTGUN ? 0.22 : 0.16);
    // Per-gun sprite size from spec.muzzleFlashScale. The legacy trio's style
    // table above already encodes its sizes, so only the roster scales here.
    const legacyStyled = gunType === GUNS.SHOTGUN || gunType === GUNS.SNIPER || gunType === GUNS.RIFLE;
    const fs = legacyStyled ? 1 : (Number.isFinite(GUN_SPECS[gunType]?.muzzleFlashScale) ? GUN_SPECS[gunType].muzzleFlashScale : 1);
    flash.visible = visible;
    flash.material.opacity = visible ? Math.min(1, style.opacity * (0.32 + t * 0.92)) : 0;
    flash.material.rotation = visible ? (Math.random() * Math.PI * 2) : 0;
    flash.scale.set(base * style.x * bloom * thirdPersonScale * fs, base * style.y * bloom * thirdPersonScale * fs, base * thirdPersonScale * fs);
  }

  function addTankShotgunMount(parent, type, s) {
    const mount = new THREE.Group();
    mount.position.set(0, s * 0.1, -s * 0.78);
    parent.add(mount);

    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x11161e, emissive: 0x120400, emissiveIntensity: 0.4, roughness: 0.32, metalness: 0.9 });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x3f4f5e, emissive: type.color, emissiveIntensity: 0.55, roughness: 0.24, metalness: 0.82 });
    const glowMat = new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false });

    addCyl(mount, s * 0.07, s * 0.07, s * 0.86, 12, { x: 0, y: 0, z: -s * 0.36 }, { x: Math.PI * 0.5 }, barrelMat);
    addCyl(mount, s * 0.105, s * 0.09, s * 0.16, 12, { x: 0, y: 0, z: -s * 0.84 }, { x: Math.PI * 0.5 }, ringMat);
    addBox(mount, { x: s * 0.3, y: s * 0.12, z: s * 0.18 }, { x: 0, y: -s * 0.08, z: -s * 0.2 }, barrelMat);

    const muzzle = new THREE.Object3D();
    muzzle.intensity = 0;
    muzzle.position.set(0, 0, -s * 0.95);
    mount.add(muzzle);

    const flash = createMuzzleFlash(0xffc86a, s * 1.02);
    flash.position.set(0, 0, -s * 1.3);
    mount.add(flash);

    const glow = new THREE.Mesh(new THREE.SphereGeometry(s * 0.18, 8, 6), glowMat);
    glow.position.copy(muzzle.position);
    mount.add(glow);

    return { mount, muzzle, flash, glow };
  }

  function applyAngelDroneVariant(root, type, rig, visualBox, visualSize, visualCenter, bodyRadius) {
    if (!type.variant) return;

    const tint = new THREE.Color(type.color);
    const variant = type.variant;
    // The Warden rig's materials are per-instance and are ANIMATED in place by
    // storm_warden.js (energyMats/allMaterials pulse opacity + rage color). So we
    // must NOT clone-and-replace them (that detaches the visible material from the
    // animation refs and freezes the glow). Instead mutate each UNIQUE material
    // once (guarded by `seen`, since a material is shared across many plates) —
    // only scalar/colour props change, so no new shader program is compiled.
    //
    // Blink Seraph: sleek/ethereal glass — low metalness/roughness + very strong
    // sky-reflection (envMapIntensity) reads as smooth iridescent panels rather
    // than battle-worn plate; only a faint edge emissive. Null Cherub: matte,
    // near-void body pushed toward black with high roughness so the glowing
    // energy veins/core read as corrupted cracks against a dead-flat surface.
    const voidColor = new THREE.Color(0x060f0c);
    const seen = new Set();
    root.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(next => {
        if (!next || seen.has(next)) return;
        seen.add(next);
        const isArmor = typeof next.roughness === "number"; // MeshStandard plating
        if (isArmor) {
          if (next.color) {
            if (variant === "blink") next.color.lerp(tint, 0.5);
            else if (variant === "null") next.color.lerp(voidColor, 0.62).lerp(tint, 0.12);
            else next.color.lerp(tint, 0.14);
          }
          // Armor emissive kept SUBTLE so plates read as lit metal, not neon.
          if (next.emissive) next.emissive.setHex(type.emissive);
          next.emissiveIntensity = variant === "null" ? 0.14 : variant === "blink" ? 0.18 : 0.06;
          if (variant === "blink") {
            next.roughness = Math.max(0.05, next.roughness - 0.34);
            next.metalness = Math.max(0.0, next.metalness - 0.5);
            next.envMapIntensity = 2.1;
          } else if (variant === "null") {
            next.roughness = Math.min(0.98, next.roughness + 0.3);
            next.metalness = Math.max(0.05, next.metalness - 0.35);
            next.envMapIntensity = 0.45;
          }
        } else {
          // Energy / VFX glow parts (MeshBasicMaterial) — shift the glow hue to the
          // variant identity and re-base the rage-lerp origin so it stays coherent.
          if (next.color) next.color.lerp(tint, variant === "null" ? 0.82 : 0.68);
          if (next.userData && next.userData.baseColor) next.userData.baseColor = next.color.clone();
        }
        next.needsUpdate = true;
      });
    });

    // Silhouette divergence: slim/tall Seraph, compact/squat Cherub.
    if (variant === "blink") rig.scale.set(0.9, 1.12, 0.88);
    else if (variant === "null") rig.scale.set(1.08, 0.9, 1.04);
    else rig.scale.set(1.02, 1.0, 1.01);
    root.userData.variantHalo = null;
    root.userData.variantCore = null;
  }

  function createClonedGhostMesh(type) {
    const root = new THREE.Group();
    root.name = "Cloned Ghost";
    root.userData.baseScale = type.scale || 1;
    root.userData.clonedGhostModel = true;

    const model = PLAYER_CHARACTER_FBX && skeletonClone ? skeletonClone(PLAYER_CHARACTER_FBX) : createFallbackThirdPersonModel();
    model.name = "Cloned ghost operator";
    root.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = PLAYER_H / Math.max(0.001, size.y || PLAYER_H);
    model.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    const aligned = new THREE.Box3().setFromObject(model);
    const center = aligned.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= aligned.min.y;
    model.position.z -= center.z;
    model.rotation.y = Math.PI;

    model.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
      const source = Array.isArray(obj.material) ? obj.material : [obj.material];
      const tinted = source.map(mat => {
        const next = mat?.clone ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0x111722 });
        if (next.color) next.color.lerp(new THREE.Color(0x8adfff), 0.28);
        if (next.emissive) next.emissive.setHex(0x0b2632);
        if (typeof next.emissiveIntensity === "number") next.emissiveIntensity = Math.max(next.emissiveIntensity, 0.18);
        if (typeof next.roughness === "number") next.roughness = Math.min(0.92, next.roughness + 0.08);
        next.transparent = false;
        next.opacity = 1;
        next.needsUpdate = true;
        return next;
      });
      obj.material = Array.isArray(obj.material) ? tinted : tinted[0];
    });

    const ghostRuntime: any = createHumanoidEnemyActions(model);
    ghostRuntime.model = model;
    ghostRuntime.rightHand = findRightHandBone(model);
    ghostRuntime.leftHand = findLeftHandBone(model);
    ghostRuntime.muzzleTimer = 0;
    ghostRuntime.aimPitch = 0;
    ghostRuntime.jumpTimer = 0;
    ghostRuntime.jumpCooldown = 0.4 + Math.random() * 0.8;
    ghostRuntime.moveState = { f: 0, s: 0, sprinting: false, jumping: false };

    // Collect emissive materials from the model itself — glow that literally IS the model
    const glowMaterials = [];
    model.traverse(obj => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (mat && typeof mat.emissiveIntensity !== "undefined") glowMaterials.push(mat);
      }
    });

    // Animated scan rings — thin horizontal planes cycling up the body
    const scanRingGeo = new THREE.PlaneGeometry(0.68, 0.022);
    const scanRings = [];
    for (let i = 0; i < 3; i++) {
      const matA = new THREE.MeshBasicMaterial({
        color: 0x88f8ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const matB = matA.clone();
      const planeA = new THREE.Mesh(scanRingGeo, matA);
      const planeB = new THREE.Mesh(scanRingGeo, matB);
      planeB.rotation.y = Math.PI * 0.5;
      const ringGroup = new THREE.Group();
      ringGroup.add(planeA, planeB);
      ringGroup.position.y = 0.2;
      ringGroup.frustumCulled = false;
      ringGroup.renderOrder = 93;
      scanRings.push({ group: ringGroup, matA, matB, phase: i / 3 });
    }

    const auraRingMat = new THREE.MeshBasicMaterial({
      color: 0x9eeaff,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const auraRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.016, 6, 40), auraRingMat);
    auraRing.name = "Cloned ghost aura ring";
    auraRing.rotation.x = Math.PI * 0.5;
    auraRing.position.y = 0.09;
    auraRing.frustumCulled = false;
    auraRing.material.depthTest = false;
    auraRing.renderOrder = 92;

    // No real-time PointLight here — same call as the angel/Warden types above. An
    // enemy-owned light enters and leaves the scene with the enemy, and three bakes
    // the VISIBLE light count into every shader (unrolled, one loop iteration per
    // light). So each spawn/despawn silently relinked every material in the scene —
    // ~400ms per program. The aura reads from the ring + emissive glow instead.
    const auraAnchor = new THREE.Object3D();
    auraAnchor.name = "Cloned ghost aura anchor";
    for (const ring of scanRings) auraAnchor.add(ring.group);
    auraAnchor.add(auraRing);
    model.add(auraAnchor);
    root.userData.clonedGhostAura = { glowMaterials, scanRings, auraRing, auraLight: null };

    const weaponRig = createWeaponViewModel(type.ranged?.gunType || GUNS.RIFLE, root);
    configureThirdPersonWeaponTransform(weaponRig.gun);
    weaponRig.gun.visible = true;
    weaponRig.gun.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const nextMats = mats.map(mat => {
        const next = mat.clone();
        if (next.color) next.color.lerp(new THREE.Color(0x9eeaff), 0.18);
        if (next.emissive) next.emissive.setHex(0x092433);
        if (typeof next.emissiveIntensity === "number") next.emissiveIntensity = Math.max(next.emissiveIntensity, 0.22);
        next.needsUpdate = true;
        return next;
      });
      obj.material = Array.isArray(obj.material) ? nextMats : nextMats[0];
    });
    ghostRuntime.weapon = weaponRig;
    root.userData.clonedGhost = ghostRuntime;

    const h = PLAYER_H * 0.98;
    root.userData.modelEditorHeight = h;
    root.userData.hitOffset = new THREE.Vector3(0, h * 0.54, 0);
    root.userData.hitRadius = 0.42;
    root.userData.hitVolumes = [
      { name: "head", a: new THREE.Vector3(0, h * 0.79, 0), b: new THREE.Vector3(0, h * 0.95, 0), radius: 0.16 },
      { name: "torso", a: new THREE.Vector3(0, h * 0.42, 0), b: new THREE.Vector3(0, h * 0.76, 0), radius: 0.26 },
      { name: "pelvis", a: new THREE.Vector3(0, h * 0.3, 0), b: new THREE.Vector3(0, h * 0.44, 0), radius: 0.21 },
      { name: "leftArm", a: new THREE.Vector3(-0.28, h * 0.68, 0), b: new THREE.Vector3(-0.42, h * 0.42, 0), radius: 0.075 },
      { name: "rightArm", a: new THREE.Vector3(0.28, h * 0.68, 0), b: new THREE.Vector3(0.42, h * 0.42, 0), radius: 0.075 },
      { name: "leftLeg", a: new THREE.Vector3(-0.14, h * 0.31, 0), b: new THREE.Vector3(-0.15, h * 0.06, 0), radius: 0.09 },
      { name: "rightLeg", a: new THREE.Vector3(0.14, h * 0.31, 0), b: new THREE.Vector3(0.15, h * 0.06, 0), radius: 0.09 },
    ];
    root.userData.healthOffset = new THREE.Vector3(0, h + 0.3, 0);
    root.userData.collisionRadius = 0.36;
    root.userData.collisionMinY = PLAYER_FOOT_CLEARANCE;
    root.userData.collisionMaxY = h;
    root.userData.lightningNode = weaponRig.muzzle || root;
    registerModelEditorRoot(root, "clone");
    setHumanoidEnemyAction({ mesh: root }, "idle", 0);
    return root;
  }

  function createDroneMesh(type) {
    const root = new THREE.Group();
    const rig = new THREE.Group();
    root.add(rig);

    const s = type.scale;
    const auraRadius = type.aura?.radius ?? 5;

    if (type.clonedGhost) return createClonedGhostMesh(type);

    if (type.zombieModel && ZOMBIE_CHARACTER_GLB && skeletonClone) {
      // Skinned Mixamo zombie. The factory clones/scales/grounds the model, owns an
      // AnimationMixer with cross-faded states, and applies procedural turning. It is
      // driven through the standard `userData.mixer.update(dt)` contract.
      const zombie = createZombieCharacter(THREE, ZOMBIE_CHARACTER_GLB, ZOMBIE_CHARACTER_ANIMS, skeletonClone, {
        targetHeight: PLAYER_H * 1.18,
        onceStates: ZOMBIE_ONCE_ANIMATIONS,
      });
      const zmodel = zombie.root;
      rig.add(zmodel);
      rig.updateMatrixWorld(true);

      const visualBox = new THREE.Box3().setFromObject(zmodel);
      const visualSize = visualBox.getSize(new THREE.Vector3());
      const visualCenter = visualBox.getCenter(new THREE.Vector3());
      const bodyRadius = Math.max(visualSize.x, visualSize.z);
      root.userData.modelEditorHeight = visualSize.y;

      const hitVolumes = [
        { name: "head",     a: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.86, visualCenter.z), b: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.96, visualCenter.z), radius: Math.max(0.12, bodyRadius * 0.20) },
        { name: "torso",    a: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.45, visualCenter.z), b: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.78, visualCenter.z), radius: Math.max(0.20, bodyRadius * 0.30) },
        { name: "pelvis",   a: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.32, visualCenter.z), b: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.46, visualCenter.z), radius: Math.max(0.17, bodyRadius * 0.24) },
        { name: "leftLeg",  a: new THREE.Vector3(visualCenter.x - bodyRadius * 0.14, visualBox.min.y + visualSize.y * 0.32, visualCenter.z), b: new THREE.Vector3(visualCenter.x - bodyRadius * 0.15, visualBox.min.y + visualSize.y * 0.04, visualCenter.z), radius: Math.max(0.08, bodyRadius * 0.10) },
        { name: "rightLeg", a: new THREE.Vector3(visualCenter.x + bodyRadius * 0.14, visualBox.min.y + visualSize.y * 0.32, visualCenter.z), b: new THREE.Vector3(visualCenter.x + bodyRadius * 0.15, visualBox.min.y + visualSize.y * 0.04, visualCenter.z), radius: Math.max(0.08, bodyRadius * 0.10) },
      ];

      // Adapter: feed the game-agnostic factory clean signals each frame. Melee wind-up
      // maps to isAttacking so the attack clip plays during the telegraph.
      const zref = { alive: true, aggroed: false, visualSpeed: 0, visualTurn: 0, isAttacking: false, crawling: false, locoState: null };
      root.userData.zombieAnim = zombie;
      root.userData.mixer = { update: (dt) => {
        const e = root.userData.enemyRef;
        if (e) {
          zref.alive = e.alive !== false;
          zref.aggroed = !!e.aggroed;
          zref.visualSpeed = e.visualSpeed || 0;
          zref.visualTurn = e.visualTurn || 0;
          zref.isAttacking = (e.meleeWindUp >= 0) || !!e.isAttacking;
          zref.crawling = !!e.crawling;
          zref.locoState = e.locoState || null; // walk/run/idle chosen by the AI brain
        }
        zombie.update(dt, zref);
        // Write-back: the character controller flags full-body one-shot locks (scream)
        // on zref; mirror it onto the real enemy so the AI brain can hold the mover.
        if (e) (e as any).zombieAnimLocked = !!(zref as any).zombieAnimLocked;
      } };
      root.userData.walkAction = null;
      root.userData.walkClipDuration = 0;
      root.userData.rig = null; // factory owns the bones; no warden-style procedural rig
      root.userData.model = zmodel;
      root.userData.baseScale = s;
      root.userData.zombieCharacterModel = true;
      root.userData.hitOffset = new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.52, visualCenter.z);
      root.userData.hitRadius = Math.max(0.42, Math.max(visualSize.x, visualSize.y, visualSize.z) * 0.28);
      root.userData.hitVolumes = hitVolumes;
      root.userData.healthOffset = new THREE.Vector3(visualCenter.x, visualBox.max.y + 0.34, visualCenter.z);
      root.userData.collisionRadius = Math.min(0.92, Math.max(0.5, Math.max(visualSize.x, visualSize.z) * 0.42));
      root.userData.collisionMinY = 0.04;
      root.userData.collisionMaxY = Math.max(PLAYER_H, visualBox.max.y + 0.1);
      return root;
    }

    if (!lowEndMode && !forceLowPolyEnemies && type.angelModel) {
      // Procedural Storm Warden character (replaces the old angel FBX). Built in
      // code: WebGPU-safe, low-poly, self-animating — no external assets.
      const warden = createStormWarden(THREE, mergeGeometries, {
        palette: { accent: type.color || 0x4fc3ff, accent2: type.emissive || 0x66d4ff, accent3: 0xb266ff },
      });
      const siegeModel = warden.root;
      siegeModel.traverse(obj => { if (obj.isMesh || obj.isSkinnedMesh) obj.frustumCulled = false; });

      const fitBox = new THREE.Box3().setFromObject(siegeModel);
      const fitSize = fitBox.getSize(new THREE.Vector3());
      const modelScale = SIEGE_DRONE_TARGET_HEIGHT / Math.max(0.001, fitSize.y || SIEGE_DRONE_TARGET_HEIGHT);
      siegeModel.scale.setScalar(modelScale);
      siegeModel.rotation.y = SIEGE_DRONE_MODEL_YAW;
      rig.add(siegeModel);

      rig.updateMatrixWorld(true);
      const alignedBox = new THREE.Box3().setFromObject(siegeModel);
      const alignedCenter = alignedBox.getCenter(new THREE.Vector3());
      siegeModel.position.x -= alignedCenter.x;
      siegeModel.position.y -= alignedBox.min.y;
      siegeModel.position.z -= alignedCenter.z;
      rig.updateMatrixWorld(true);

      const visualBox = new THREE.Box3().setFromObject(siegeModel);
      const visualSize = visualBox.getSize(new THREE.Vector3());
      const visualCenter = visualBox.getCenter(new THREE.Vector3());
      const bodyRadius = Math.max(visualSize.x, visualSize.z);
      root.userData.modelEditorHeight = visualSize.y;
      applyAngelDroneVariant(root, type, rig, visualBox, visualSize, visualCenter, bodyRadius);
      registerModelEditorRoot(root, "angel");

      // Real-time PointLight removed for perf — angel/Warden types rely on their
      // emissive materials only now (see enemy light-budget removal).
      const hitVolumes = [
        { name: "head", a: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.84, visualCenter.z), b: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.94, visualCenter.z), radius: Math.max(0.11, bodyRadius * 0.18) },
        { name: "torso", a: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.43, visualCenter.z), b: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.76, visualCenter.z), radius: Math.max(0.18, bodyRadius * 0.26) },
        { name: "pelvis", a: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.31, visualCenter.z), b: new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.45, visualCenter.z), radius: Math.max(0.16, bodyRadius * 0.22) },
        { name: "leftArm", a: new THREE.Vector3(visualCenter.x - bodyRadius * 0.26, visualBox.min.y + visualSize.y * 0.70, visualCenter.z), b: new THREE.Vector3(visualCenter.x - bodyRadius * 0.38, visualBox.min.y + visualSize.y * 0.42, visualCenter.z), radius: Math.max(0.065, bodyRadius * 0.075) },
        { name: "rightArm", a: new THREE.Vector3(visualCenter.x + bodyRadius * 0.26, visualBox.min.y + visualSize.y * 0.70, visualCenter.z), b: new THREE.Vector3(visualCenter.x + bodyRadius * 0.38, visualBox.min.y + visualSize.y * 0.42, visualCenter.z), radius: Math.max(0.065, bodyRadius * 0.075) },
        { name: "leftLeg", a: new THREE.Vector3(visualCenter.x - bodyRadius * 0.12, visualBox.min.y + visualSize.y * 0.33, visualCenter.z), b: new THREE.Vector3(visualCenter.x - bodyRadius * 0.13, visualBox.min.y + visualSize.y * 0.06, visualCenter.z), radius: Math.max(0.075, bodyRadius * 0.09) },
        { name: "rightLeg", a: new THREE.Vector3(visualCenter.x + bodyRadius * 0.12, visualBox.min.y + visualSize.y * 0.33, visualCenter.z), b: new THREE.Vector3(visualCenter.x + bodyRadius * 0.13, visualBox.min.y + visualSize.y * 0.06, visualCenter.z), radius: Math.max(0.075, bodyRadius * 0.09) },
      ];

      const lightningNode = new THREE.Object3D();
      lightningNode.position.set(visualCenter.x, visualBox.min.y + visualSize.y * 0.82, visualCenter.z);
      rig.add(lightningNode);
      const teslaNodes = [
        lightningNode,
        new THREE.Object3D(),
        new THREE.Object3D(),
        new THREE.Object3D(),
        new THREE.Object3D(),
      ];
      teslaNodes[1].position.set(visualCenter.x, visualBox.min.y + visualSize.y * 0.67, visualCenter.z + visualSize.z * 0.08);
      teslaNodes[2].position.set(visualCenter.x - bodyRadius * 0.34, visualBox.min.y + visualSize.y * 0.58, visualCenter.z);
      teslaNodes[3].position.set(visualCenter.x + bodyRadius * 0.34, visualBox.min.y + visualSize.y * 0.58, visualCenter.z);
      teslaNodes[4].position.set(visualCenter.x, visualBox.min.y + visualSize.y * 0.42, visualCenter.z - visualSize.z * 0.08);
      for (let i = 1; i < teslaNodes.length; i++) rig.add(teslaNodes[i]);

      // The Warden self-animates via its own update(dt). Expose it through the
      // existing `mixer` contract so all the per-frame `userData.mixer.update(dt)`
      // call sites (gameplay + warmup) drive it with zero further changes.
      root.userData.wardenAnim = warden;
      root.userData.mixer = { update: (dt) => warden.update(dt, root.userData.enemyRef) };
      root.userData.walkAction = null;
      root.userData.walkClipDuration = 0;
      root.userData.rig = rig;
      root.userData.model = siegeModel;
      root.userData.lightningNode = lightningNode;
      root.userData.teslaNodes = teslaNodes;
      root.userData.spinSpeed = 0.22 + Math.random() * 0.18;
      root.userData.hoverPhase = Math.random() * Math.PI * 2;
      root.userData.baseScale = s;
      root.userData.siegeCharacterModel = true;
      root.userData.hitOffset = new THREE.Vector3(visualCenter.x, visualBox.min.y + visualSize.y * 0.52, visualCenter.z);
      root.userData.hitRadius = Math.max(0.42, Math.max(visualSize.x, visualSize.y, visualSize.z) * 0.28);
      root.userData.hitVolumes = hitVolumes;
      root.userData.healthOffset = new THREE.Vector3(visualCenter.x, visualBox.max.y + 0.38, visualCenter.z);
      root.userData.collisionRadius = Math.min(0.92, Math.max(0.58, Math.max(visualSize.x, visualSize.z) * 0.38));
      root.userData.collisionMinY = 0.04;
      root.userData.collisionMaxY = Math.max(PLAYER_H, visualBox.max.y + 0.1);
      return root;
    }

    const glowMul = type.glow ?? 1;
    const fallbackEnemyBoost = type.angelModel ? 1.85 : 1;
    const shellMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(type.color).multiplyScalar(type.angelModel ? 0.72 : 0.32), emissive: type.emissive, emissiveIntensity: 1.1 * glowMul * fallbackEnemyBoost, roughness: 0.2, metalness: 0.92, flatShading: true });
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x1a2532, emissive: 0x04080e, emissiveIntensity: 0.24, roughness: 0.48, metalness: 0.86, flatShading: true });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x080b11, emissive: 0x040000, emissiveIntensity: 0.2, roughness: 0.4, metalness: 0.92, flatShading: true });
    const eyeMat = new THREE.MeshStandardMaterial({ color: type.angelModel ? 0xf6fdff : 0xffb9c6, emissive: type.color, emissiveIntensity: 3.8 * glowMul * fallbackEnemyBoost, roughness: 0.06, metalness: 0.16 });
    const petalMat = new THREE.MeshStandardMaterial({ color: 0x111a26, emissive: type.emissive, emissiveIntensity: 0.18, roughness: 0.33, metalness: 0.9, flatShading: true });
    const emitterMat = new THREE.MeshStandardMaterial({ color: 0xcff3ff, emissive: type.color, emissiveIntensity: 3.6 * glowMul * fallbackEnemyBoost, roughness: 0.08, metalness: 0.14 });
    const emitterGlowMat = new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: (0.18 + glowMul * 0.08) * fallbackEnemyBoost, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.8, 0), shellMat);
    core.scale.set(1.26, 0.5, 1.55);
    rig.add(core);

    const crown = addBox(rig, { x: s * 0.2, y: s * 0.5, z: s * 0.14 }, { x: 0, y: s * 0.44, z: -s * 0.12 }, armorMat, { x: 0.1 });
    const keel = addBox(rig, { x: s * 0.14, y: s * 0.45, z: s * 0.11 }, { x: 0, y: -s * 0.56, z: -s * 0.18 }, armorMat, { x: -0.14 });

    const facePlate = addBox(rig, { x: s * 0.82, y: s * 0.14, z: s * 0.24 }, { x: 0, y: -s * 0.02, z: s * 0.98 }, darkMat, { x: -0.15 });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(s * 0.17, 12, 10), eyeMat);
    eye.scale.set(1.75, 0.42, 0.36);
    eye.position.set(0, -s * 0.03, s * 1.15);
    rig.add(eye);

    const emitterCore = new THREE.Mesh(new THREE.SphereGeometry(s * 0.16, 12, 10), emitterMat);
    emitterCore.position.set(0, -s * 0.02, s * 0.74);
    rig.add(emitterCore);

    const emitterGlow = new THREE.Mesh(new THREE.SphereGeometry(s * 0.28, 8, 8), emitterGlowMat);
    emitterGlow.position.copy(emitterCore.position);
    emitterGlow.scale.setScalar(type.angelModel ? 1.55 : 1);
    rig.add(emitterGlow);

    // Real-time PointLight removed for perf — angel types rely on their emissive
    // materials only now (see enemy light-budget removal).

    const petals = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const pivot = new THREE.Object3D();
      pivot.position.set(Math.cos(a) * s * 0.22, -s * 0.03, Math.sin(a) * s * 0.22);
      pivot.rotation.y = a;
      const petalBase = new THREE.Mesh(new THREE.ConeGeometry(s * 0.11, s * 0.32, 4), petalMat);
      petalBase.rotation.x = Math.PI * 0.5;
      petalBase.position.z = s * 0.25;
      pivot.add(petalBase);

      const petalTip = new THREE.Mesh(new THREE.ConeGeometry(s * 0.07, s * 0.42, 4), armorMat);
      petalTip.rotation.x = Math.PI * 0.5;
      petalTip.position.z = s * 0.56;
      pivot.add(petalTip);

      const petalSpine = addBox(pivot, { x: s * 0.045, y: s * 0.05, z: s * 0.62 }, { x: 0, y: 0, z: s * 0.37 }, darkMat);
      rig.add(pivot);
      petals.push(pivot);
    }

    const rotorLA = addBox(rig, { x: s * 0.035, y: s * 0.02, z: s * 0.54 }, { x: -s * 0.86, y: s * 0.03, z: -s * 0.16 }, darkMat, { y: Math.PI * 0.5 });
    const rotorLB = addBox(rig, { x: s * 0.035, y: s * 0.02, z: s * 0.54 }, { x: -s * 0.86, y: s * 0.03, z: -s * 0.16 }, darkMat, { x: Math.PI * 0.5, y: Math.PI * 0.5 });
    const rotorRA = addBox(rig, { x: s * 0.035, y: s * 0.02, z: s * 0.54 }, { x: s * 0.86, y: s * 0.03, z: -s * 0.16 }, darkMat, { y: Math.PI * 0.5 });
    const rotorRB = addBox(rig, { x: s * 0.035, y: s * 0.02, z: s * 0.54 }, { x: s * 0.86, y: s * 0.03, z: -s * 0.16 }, darkMat, { x: Math.PI * 0.5, y: Math.PI * 0.5 });

    const topFin = addBox(rig, { x: s * 0.12, y: s * 0.58, z: s * 0.08 }, { x: 0, y: s * 0.56, z: -s * 0.16 }, armorMat, { x: 0.08 });
    const bellyFin = addBox(rig, { x: s * 0.1, y: s * 0.38, z: s * 0.07 }, { x: 0, y: -s * 0.63, z: -s * 0.1 }, armorMat, { x: -0.1 });

    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.12, s * 0.08, s * 0.3, 8), darkMat);
    thruster.position.set(0, -s * 0.58, -s * 0.4);
    thruster.rotation.x = Math.PI * 0.5;
    rig.add(thruster);

    let aura = null;
    let auraRing = null;
    let auraArcA = null;
    let auraArcB = null;
    if (type.aura) {
      const auraColor = type.aura.color ?? type.color;
      const auraMat = new THREE.MeshBasicMaterial({ color: auraColor, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true });
      aura = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), auraMat);
      aura.scale.setScalar(auraRadius * 0.62);
      rig.add(aura);

      const auraRingMat = new THREE.MeshBasicMaterial({ color: auraColor, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
      auraRing = new THREE.Mesh(new THREE.TorusGeometry(auraRadius * 0.98, 0.05 + s * 0.02, 8, 36), auraRingMat);
      auraRing.rotation.x = Math.PI * 0.5;
      auraRing.position.y = -s * 0.56;
      rig.add(auraRing);

      const auraArcMat = new THREE.MeshBasicMaterial({ color: auraColor, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
      auraArcA = new THREE.Mesh(new THREE.TorusGeometry(auraRadius * 0.72, 0.032 + s * 0.01, 6, 28), auraArcMat);
      auraArcA.rotation.set(Math.PI * 0.24, 0, Math.PI * 0.08);
      rig.add(auraArcA);
      auraArcB = new THREE.Mesh(new THREE.TorusGeometry(auraRadius * 0.78, 0.032 + s * 0.01, 6, 28), auraArcMat.clone());
      auraArcB.rotation.set(Math.PI * 0.74, Math.PI * 0.2, Math.PI * 0.32);
      rig.add(auraArcB);
    }

    const halo = null;
    if (!type.angelModel) {
      const haloMat = new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: type.glow ? 0.2 : 0.11, blending: THREE.AdditiveBlending, depthWrite: false });
      const haloMesh = new THREE.Mesh(new THREE.OctahedronGeometry(s * (type.glow ? 1.25 : 1.06), 0), haloMat);
      rig.add(haloMesh);
      root.userData.halo = haloMesh;
    }
    const tankGun = type.ranged ? addTankShotgunMount(root, type, s) : null;
    const lightningNode = type.lightning ? new THREE.Object3D() : null;
    if (lightningNode) {
      lightningNode.position.set(0, s * 0.32, s * 0.1);
      rig.add(lightningNode);
    }

    root.userData.rig = rig;
    root.userData.spinSpeed = 0.9 + Math.random() * 1.4;
    root.userData.hoverPhase = Math.random() * Math.PI * 2;
    root.userData.core = core;
    root.userData.eye = eye;
    root.userData.emitterCore = emitterCore;
    root.userData.emitterGlow = emitterGlow;
    root.userData.emitterLight = null;
    root.userData.petals = petals;
    root.userData.rotorLA = rotorLA;
    root.userData.rotorLB = rotorLB;
    root.userData.rotorRA = rotorRA;
    root.userData.rotorRB = rotorRB;
    root.userData.thruster = thruster;
    root.userData.aura = aura;
    root.userData.auraRing = auraRing;
    root.userData.auraArcA = auraArcA;
    root.userData.auraArcB = auraArcB;
    root.userData.auraBaseScale = auraRadius * 0.62;
    root.userData.halo = halo;
    root.userData.tankBarrel = tankGun?.mount ?? null;
    root.userData.tankMuzzle = tankGun?.muzzle ?? null;
    root.userData.tankFlash = tankGun?.flash ?? null;
    root.userData.tankMuzzleGlow = tankGun?.glow ?? null;
    root.userData.lightningNode = lightningNode;
    root.userData.topFin = topFin;
    root.userData.bellyFin = bellyFin;
    root.userData.baseScale = s;

    return root;
  }

  // ── Developer Engine: custom spawn points ──────────────────────────────────
  // When a spawn preset defines manual points, use them (validated so nothing
  // spawns inside a wall). Falls back to the procedural spawner for any extra
  // enemies when useProceduralFallback is on — otherwise custom points cycle.
  function getDevSpawnPositions(wave, count, minDistance, preferVisible) {
    const s = devHas("spawn") ? DEV.spawn : null;
    const pts = s && Array.isArray(s.points) ? s.points : [];
    const md = s && Number.isFinite(s.minDistance) ? s.minDistance : minDistance;
    const pv = s ? !!s.preferVisible : preferVisible;
    if (!pts.length) return getSpawnPositions(count, md, { preferVisible: pv });

    const usable = pts
      .filter((p) => p && (p.wave === 0 || p.wave === wave))
      .filter((p) => !wallAtWorldRadius(p.x, p.z, Math.max(0.4, player.radius)))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .map((p) => ({ x: p.x, z: p.z, facing: p.facing || 0 }));

    if (!usable.length) return getSpawnPositions(count, md, { preferVisible: pv });

    const out = [];
    for (let i = 0; i < count; i++) out.push(usable[i % usable.length]);

    // Top up with procedural positions if allowed and we have too few unique points.
    if ((!s || s.useProceduralFallback) && usable.length < count) {
      const extra = getSpawnPositions(count - usable.length, md, { preferVisible: pv });
      for (let i = usable.length; i < count; i++) out[i] = extra[i - usable.length] || out[i];
    }
    return out;
  }

  function getSpawnPositions(count, minDistance = 18, options: any = {}) {
    const preferVisible = options.preferVisible === true;
    const maxVisibleDistance = options.maxVisibleDistance ?? 34;
    const allOpen = [];
    const allCandidates = [];
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        if (MAP[y][x] === "#") continue;
        const p = mapToWorld(x, y);
        const dist = Math.hypot(p.x - yaw.position.x, p.z - yaw.position.z);
        allCandidates.push({ x: p.x, z: p.z, dist });
        const neighbors = [wallAt(x - 1, y), wallAt(x + 1, y), wallAt(x, y - 1), wallAt(x, y + 1), wallAt(x - 1, y - 1), wallAt(x + 1, y - 1), wallAt(x - 1, y + 1), wallAt(x + 1, y + 1)];
        if (!neighbors.some(Boolean)) allOpen.push({ x: p.x, z: p.z, dist });
      }
    }

    if (preferVisible) {
      let visibleOpen = allCandidates.filter(p =>
        p.dist >= minDistance &&
        p.dist <= maxVisibleDistance &&
        hasLineOfSightWorld(p.x, p.z, yaw.position.x, yaw.position.z, 0.22)
      );
      for (const fallback of [
        { min: Math.max(6, minDistance - 4), max: maxVisibleDistance + 6 },
        { min: 6, max: maxVisibleDistance + 10 },
      ]) {
        if (visibleOpen.length >= count) break;
        visibleOpen = allCandidates.filter(p =>
          p.dist >= fallback.min &&
          p.dist <= fallback.max &&
          hasLineOfSightWorld(p.x, p.z, yaw.position.x, yaw.position.z, 0.22)
        );
      }
      if (visibleOpen.length > 0) {
        visibleOpen.sort((a, b) => a.dist - b.dist);
        const fill = allCandidates
          .filter(p => p.dist >= minDistance && !visibleOpen.some(v => v.x === p.x && v.z === p.z))
          .sort((a, b) => a.dist - b.dist);
        const closeBand = [...visibleOpen, ...fill].slice(0, Math.max(count * 2, count));
        for (let i = closeBand.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [closeBand[i], closeBand[j]] = [closeBand[j], closeBand[i]];
        }
        return closeBand.slice(0, count);
      }

      // Spread fallback: sort by distance descending so enemies are pushed away
      // from the player rather than clustering at the minimum threshold.
      const nearby = allCandidates
        .filter(p => p.dist >= Math.max(6, minDistance - 2))
        .sort((a, b) => b.dist - a.dist)
        .slice(0, Math.max(count * 4, 20));
      for (let i = nearby.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nearby[i], nearby[j]] = [nearby[j], nearby[i]];
      }
      if (nearby.length > 0) return nearby.slice(0, count);
    }

    let open = allOpen.filter(p => p.dist >= minDistance);
    for (const fallbackDist of [16, 13, 10, 8]) {
      if (open.length >= count) break;
      open = allOpen.filter(p => p.dist >= fallbackDist);
    }

    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [open[i], open[j]] = [open[j], open[i]];
    }
    return open.slice(0, count);
  }

  function chooseWavePlayerSpot(wave) {
    const candidates = [
      { mx: 1, my: 1, yaw: Math.PI * 0.35 },
      { mx: MAP_W - 2, my: MAP_H - 2, yaw: -Math.PI * 0.65 },
      { mx: 1, my: MAP_H - 2, yaw: Math.PI * 0.72 },
      { mx: MAP_W - 2, my: 1, yaw: -Math.PI * 0.28 },
      { mx: Math.floor(MAP_W * 0.5), my: 1, yaw: 0 },
    ];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[(wave + i) % candidates.length];
      if (isOpenCell(c.mx, c.my)) {
        const p = mapToWorld(c.mx, c.my);
        return { x: p.x, z: p.z, yaw: c.yaw };
      }
    }

    const fallback = mapToWorld(1, 1);
    return { x: fallback.x, z: fallback.z, yaw: Math.PI * 0.35 };
  }

  function placePlayerForWave(wave) {
    const spot = chooseWavePlayerSpot(wave);
    yaw.position.set(spot.x, PLAYER_H, spot.z);
    yaw.rotation.y = spot.yaw;
    pitch.rotation.x = 0;
    camera.rotation.set(0, 0, 0);
    player.auraTimer = 0;
    player.auraDamageTick = 0;
    player.effectSpeedMul = 1;
    player.jumpOffset = 0;
    player.jumpVel = 0;
    player.grounded = true;
    player.jumpCooldown = 0;
    ai.playerPrevX = spot.x;
    ai.playerPrevZ = spot.z;
    ai.playerVelX = 0;
    ai.playerVelZ = 0;
    ai.initialized = true;
  }

  // Dev gameplay tuning — read live from DEV each call so a re-apply takes effect
  // on the next wave with no reload (falls back to built-in constants otherwise).
  const gp = (k, fallback) => {
    const G = devHas("gameplay") ? DEV.gameplay : null;
    return G && Number.isFinite(G[k]) ? G[k] : fallback;
  };

  function getWaveEnemyCount(wave) {
    // Smooth, balanced ramp from wave 1 (no more 1→5 spike). w1=3 w2=4 w3=6
    // w5=9 w8=13 w12=18, capped. Low-end gets a gentler curve.
    const baseCount = Math.round(gp("waveCountBase", 1.6) + wave * gp("waveCountPerWave", 1.35));
    const cap = gp("waveCountMax", 20);
    if (lowEndMode) {
      return Math.min(Math.min(12, cap), Math.max(3, Math.round(baseCount * 0.78)));
    }
    return Math.min(cap, baseCount);
  }

  function getWaveHpScale(wave) {
    // Gentle early game, steady mid-game; cap a touch higher for late waves.
    return Math.min(gp("hpScaleMax", 1.85), 1 + Math.max(0, wave - 1) * gp("hpScalePerWave", 0.05));
  }

  function getWaveSpeedScale(wave) {
    return 1 + Math.min(gp("speedScaleMax", 0.45), Math.max(0, wave - 1) * gp("speedScalePerWave", 0.022));
  }

  function getWaveDamageScale(wave) {
    return 1 + Math.min(gp("damageScaleMax", 0.7), Math.max(0, wave - 1) * gp("damageScalePerWave", 0.032));
  }

  function scaleDamageRange(range, scale) {
    if (!Array.isArray(range)) return range;
    return range.map(value => Math.max(1, Math.round(value * scale)));
  }

  function makeWaveLightningSpec(spec, damageScale) {
    if (!spec) return null;
    return {
      ...spec,
      damage: scaleDamageRange(spec.damage, damageScale),
    };
  }

  function makeWaveEmpSpec(spec, damageScale) {
    if (!spec) return null;
    return {
      ...spec,
      damage: scaleDamageRange(spec.damage, damageScale),
      cooldown: spec.cooldown ?? 7,
    };
  }

  function makeWaveMegaBlastSpec(spec, damageScale) {
    if (!spec) return null;
    return {
      ...spec,
      damagePerSecond: scaleDamageRange(spec.damagePerSecond, damageScale),
      duration: spec.duration ?? 5,
      cooldown: spec.cooldown ?? 5,
      damageInterval: spec.damageInterval ?? 0.18,
    };
  }

  function getEnemyAggroRange(type) {
    if (type.lightning) return 25;
    if (type.megaBlast) return Math.max(26, type.megaBlast.range + 4);
    if (type.emp) return Math.max(18, type.emp.radius + 12);
    if (type.ranged) return Math.max(24, (type.ranged.range || 20) + 3);
    return 19;
  }

  function pickEnemyTypeForWave(wave) {
    const siege = ENEMY_TYPES.find(type => type.name === "Siege Drone");
    const ghost = ENEMY_TYPES.find(type => type.name === CLONED_GHOST_TYPE_NAME);
    const blink = ENEMY_TYPES.find(type => type.name === "Blink Seraph");
    const nullCherub = ENEMY_TYPES.find(type => type.name === "Null Cherub");
    const zombie = ENEMY_TYPES.find(type => type.name === "Zombie");
    const choices = [{ type: siege, weight: 1 }];
    if (wave >= 2) choices.push({ type: ghost, weight: Math.min(0.42, 0.13 + (wave - 2) * 0.035) });
    if (wave >= 4) choices.push({ type: blink, weight: Math.min(0.2, 0.04 + (wave - 4) * 0.013) });
    // Zombies trickle in from wave 5, ramping slowly (cap ~½ of spawns).
    if (wave >= 5 && zombie && ZOMBIE_CHARACTER_GLB) choices.push({ type: zombie, weight: Math.min(0.55, 0.22 + (wave - 5) * 0.05) });
    if (wave >= 6) choices.push({ type: nullCherub, weight: Math.min(0.17, 0.035 + (wave - 6) * 0.011) });

    const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
    let roll = Math.random() * total;
    for (const choice of choices) {
      roll -= choice.weight;
      if (roll <= 0) return choice.type;
    }
    return ENEMY_TYPES[0];
  }

  function disposeEnemy(enemy) {
    scene.remove(enemy.mesh);
    disposeObject3D(enemy.mesh);
  }

  function waitFrame() {
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 50);
    });
  }

  async function disposeEnemiesChunked(oldEnemies) {
    for (let i = 0; i < oldEnemies.length; i++) {
      disposeEnemy(oldEnemies[i]);
      await waitFrame();
    }
  }

  function captureEnemySpawnState(root) {
    root.traverse(obj => {
      if (!obj.userData.spawnBase) {
        obj.userData.spawnBase = {
          position: obj.position.clone(),
          rotation: obj.rotation.clone(),
          scale: obj.scale.clone(),
          visible: obj.visible,
        };
      }
      if (obj.isLight && obj.userData.spawnBaseIntensity === undefined) {
        obj.userData.spawnBaseIntensity = obj.intensity;
      }
      if (obj.material && !obj.userData.spawnBaseMaterials) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        obj.userData.spawnBaseMaterials = materials.map(mat => mat ? {
          color: mat.color ? mat.color.getHex() : null,
          opacity: mat.opacity,
          transparent: mat.transparent,
          emissiveIntensity: mat.emissiveIntensity,
        } : null);
      }
    });
  }

  function restoreEnemySpawnState(root) {
    root.traverse(obj => {
      const base = obj.userData.spawnBase;
      if (base) {
        obj.position.copy(base.position);
        obj.rotation.copy(base.rotation);
        obj.scale.copy(base.scale);
        // Restoring a light's visibility would change the scene's visible light
        // count and relink every shader. Lights are driven by intensity only.
        if (!obj.isLight) obj.visible = base.visible;
      }
      if (obj.isLight && obj.userData.spawnBaseIntensity !== undefined) {
        obj.intensity = obj.userData.spawnBaseIntensity;
      }
      if (obj.material && obj.userData.spawnBaseMaterials) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const bases = obj.userData.spawnBaseMaterials;
        for (let i = 0; i < materials.length; i++) {
          const mat = materials[i];
          const baseMat = bases[i];
          if (!mat || !baseMat) continue;
          if (baseMat.color !== null && mat.color) mat.color.setHex(baseMat.color);
          if (typeof baseMat.opacity === "number") mat.opacity = baseMat.opacity;
          if (typeof baseMat.transparent === "boolean") mat.transparent = baseMat.transparent;
          if (typeof baseMat.emissiveIntensity === "number") mat.emissiveIntensity = baseMat.emissiveIntensity;
          mat.needsUpdate = true;
        }
      }
    });
  }

  function ensureLiveEnemyVisible(enemy) {
    if (!enemy?.alive || !enemy.mesh) return;
    enemy.mesh.visible = true;
    const tankFlash = enemy.mesh.userData?.tankFlash;
    enemy.mesh.traverse(obj => {
      if (obj === tankFlash) return;
      // Lights are driven by intensity, never visibility — see setEnemyLightEnabled.
      if (obj.isLight) return;
      obj.visible = true;
    });
    if (enemy.hpBar?.mesh) enemy.hpBar.mesh.visible = true;
  }

  function ensureAllLiveEnemiesVisible() {
    for (const enemy of ecsEnemies) ensureLiveEnemyVisible(enemy);
  }

  function createEnemy(type, pos, wave, hpScale) {
    const body = createDroneMesh(type);
    captureEnemySpawnState(body);
    body.position.set(pos.x, body.userData.siegeCharacterModel || body.userData.clonedGhostModel || body.userData.zombieCharacterModel ? 0 : 1.18, pos.z);
    body.visible = true;
    body.traverse(obj => {
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });
    scene.add(body);
    if (rendererBackend === "webgpu") {
      sanitizeWebGPUMaterials(body);
      webgpuMaterialSanitizeNextRender = true;
    }

    const hpBar = makeHealthBar();
    const speedScale = getWaveSpeedScale(wave);
    const damageScale = getWaveDamageScale(wave);
    const enemy = {
      mesh: body,
      hpBar,
      hp: Math.round(type.hp * hpScale),
      maxHp: Math.round(type.hp * hpScale),
      speed: type.speed * speedScale,
      damage: scaleDamageRange(type.damage, damageScale),
      attackRate: type.attackRate,
      attackCooldown: Math.random() * type.attackRate,
      ranged: type.ranged,
      rangedCooldown: type.ranged ? 1.6 + Math.random() * 2.2 : 0,
      lightning: makeWaveLightningSpec(type.lightning, damageScale),
      teleport: type.teleport ? { ...type.teleport } : null,
      teleportCooldown: type.teleport ? type.teleport.cooldown * (0.65 + Math.random() * 0.45) : 0,
      emp: makeWaveEmpSpec(type.emp, damageScale),
      empCooldown: type.emp ? type.emp.cooldown * (0.65 + Math.random() * 0.5) : 0,
      megaBlast: makeWaveMegaBlastSpec(type.megaBlast, damageScale),
      megaBlastCooldown: type.megaBlast ? 0.9 + Math.random() * 1.9 : 0,
      megaBlastTimer: 0,
      megaBlastDamageTimer: 0,
      megaBlastSfxTimer: 0,
      megaBlastImpactTimer: 0,
      megaBlastVisual: null,
      isAttacking: false,
      lightningStreamTimer: type.lightning ? Math.random() * 0.12 : 0,
      lightningDamageTimer: 0,
      lightningSfxTimer: 0,
      alive: true,
      bobSeed: Math.random() * Math.PI * 2,
      aggroRange: getEnemyAggroRange(type),
      aggroed: false,
      typeName: type.name,
      xp: type.xp,
      aura: type.aura,
      navPath: [],
      navGoal: null,
      navTimer: 0,
      strafeDir: Math.random() > 0.5 ? 1 : -1,
      strafeTimer: 0.4 + Math.random() * 0.8,
      attackPulse: 0,
      hitStagger: 0,
      hitKnockX: 0,
      hitKnockZ: 0,
      hitFlash: 0,
      meleeWindUp: -1,
      lightningWindUp: 0,
      verticalLift: 0,
      liftTimer: 0.65 + Math.random() * 1.6,
      liftPhase: 0,
      liftDuration: 0,
      orbitDir: Math.random() > 0.5 ? 1 : -1,
      lungeBoost: 0,
      lungeTimer: 0.6 + Math.random() * 0.8,
      animSeed: Math.random() * Math.PI * 2,
      animProfile: getDroneAnimProfile(type.name),
      smoothVelX: 0,
      smoothVelZ: 0,
      visualYaw: 0,
      visualTurn: 0,
      visualLean: 0,
      visualSpeed: 0,
      tactics: getDroneTactics(type.name),
      lastSeenX: pos.x,
      lastSeenZ: pos.z,
      lastSeenTimer: 0,
      lastMoveX: pos.x,
      lastMoveZ: pos.z,
      stuckTimer: 0,
      unstuckTurnDir: Math.random() > 0.5 ? 1 : -1,
      avoidTimer: 0,
      avoidX: 0,
      avoidZ: 0,
      smartThinkTimer: Math.random() * SIEGE_SMART_THINK_MAX,
      smartUnstuckTimer: 0,
      smartPlanValid: false,
      smartTargetX: 0,
      smartTargetZ: 0,
      smartSiegeTooClose: false,
      smartCanDirectChase: false,
      directChaseTimer: 0,
      lastRepathX: pos.x,
      lastRepathZ: pos.z,
      lodPhase: Math.floor(Math.random() * 4),
      botBurstShots: 0,
      // Per-type brain outputs (see updateEnemyBrain)
      aiPhase: null,
      aiAdvanceMul: NaN,
      aiLateralMul: NaN,
      aiRetreat: false,
      zombieWeaveTimer: 0,
      zombieWeaveCooldown: 0.8 + Math.random() * 1.2,
      cloneKeyF: 0,
      cloneKeyS: 0,
      cloneKeyTimer: 0,
      cloneVelX: 0,
      cloneVelZ: 0,
    };
    if (enemy.megaBlast) enemy.megaBlastVisual = createMegaBlastVisual();

    body.userData.enemyRef = enemy;
    body.traverse(obj => {
      if (obj.isMesh) obj.userData.enemyRef = enemy;
    });
    ensureLiveEnemyVisible(enemy);
    return enemy;
  }

  function prepareEnemyForSpawn(enemy, type, pos, wave, hpScale) {
    restoreEnemySpawnState(enemy.mesh);
    enemy.mesh.position.set(pos.x, enemy.mesh.userData.siegeCharacterModel || enemy.mesh.userData.clonedGhostModel || enemy.mesh.userData.zombieCharacterModel ? 0 : 1.18, pos.z);
    enemy.mesh.visible = true;
    enemy.mesh.scale.setScalar(1);
    enemy.mesh.rotation.set(0, 0, 0);
    enemy.mesh.traverse(obj => {
      if (obj !== enemy.mesh.userData?.tankFlash) obj.visible = true;
    });
    if (enemy.mesh.userData.walkAction) {
      enemy.mesh.userData.walkAction.reset();
      enemy.mesh.userData.walkAction.play();
    }
    const speedScale = getWaveSpeedScale(wave);
    const damageScale = getWaveDamageScale(wave);
    enemy.hp = Math.round(type.hp * hpScale);
    enemy.maxHp = Math.round(type.hp * hpScale);
    enemy.speed = type.speed * speedScale;
    enemy.damage = scaleDamageRange(type.damage, damageScale);
    enemy.attackRate = type.attackRate;
    enemy.attackCooldown = Math.random() * type.attackRate;
    enemy.ranged = type.ranged;
    enemy.rangedCooldown = type.ranged ? 1.6 + Math.random() * 2.2 : 0;
    enemy.lightning = makeWaveLightningSpec(type.lightning, damageScale);
    enemy.teleport = type.teleport ? { ...type.teleport } : null;
    enemy.teleportCooldown = type.teleport ? type.teleport.cooldown * (0.65 + Math.random() * 0.45) : 0;
    enemy.emp = makeWaveEmpSpec(type.emp, damageScale);
    enemy.empCooldown = type.emp ? type.emp.cooldown * (0.65 + Math.random() * 0.5) : 0;
    enemy.megaBlast = makeWaveMegaBlastSpec(type.megaBlast, damageScale);
    enemy.megaBlastCooldown = type.megaBlast ? 0.9 + Math.random() * 1.9 : 0;
    enemy.megaBlastTimer = 0;
    enemy.megaBlastDamageTimer = 0;
    enemy.megaBlastSfxTimer = 0;
    enemy.megaBlastImpactTimer = 0;
    if (enemy.megaBlast && !enemy.megaBlastVisual) enemy.megaBlastVisual = createMegaBlastVisual();
    if (!enemy.megaBlast) hideMegaBlast(enemy);
    enemy.lightningStreamTimer = type.lightning ? Math.random() * 0.12 : 0;
    enemy.lightningDamageTimer = 0;
    enemy.lightningSfxTimer = 0;
    setEnemyAlive(enemy, true);
    enemy.bobSeed = Math.random() * Math.PI * 2;
    enemy.aggroRange = getEnemyAggroRange(type);
    enemy.aggroed = false;
    enemy.typeName = type.name;
    enemy.xp = type.xp;
    enemy.aura = type.aura;
    enemy.navPath = [];
    enemy.navGoal = null;
    enemy.navTimer = 0;
    enemy.strafeDir = Math.random() > 0.5 ? 1 : -1;
    enemy.strafeTimer = 0.4 + Math.random() * 0.8;
    enemy.attackPulse = 0;
    enemy.hitStagger = 0;
    enemy.hitKnockX = 0;
    enemy.hitKnockZ = 0;
    enemy.meleeWindUp = -1;
    enemy.lightningWindUp = 0;
    enemy.hitFlash = 0;
    enemy.verticalLift = 0;
    enemy.liftTimer = 0.65 + Math.random() * 1.6;
    enemy.liftPhase = 0;
    enemy.liftDuration = 0;
    enemy.orbitDir = Math.random() > 0.5 ? 1 : -1;
    enemy.lungeBoost = 0;
    enemy.lungeTimer = 0.6 + Math.random() * 0.8;
    enemy.animSeed = Math.random() * Math.PI * 2;
    enemy.animProfile = getDroneAnimProfile(type.name);
    enemy.smoothVelX = 0;
    enemy.smoothVelZ = 0;
    enemy.visualYaw = enemy.mesh.rotation.y;
    enemy.visualTurn = 0;
    enemy.visualLean = 0;
    enemy.visualSpeed = 0;
    // Locomotion / combat-brain state (avoids a stale 1-frame speed spike on recycle).
    enemy.locoPrevX = pos.x;
    enemy.locoPrevZ = pos.z;
    enemy.locoState = "idle";
    enemy.zombieChargeTimer = 0;
    enemy.zombieChargeCooldown = 0.4 + Math.random() * 0.8;
    enemy.zombieLocoMul = 0.46;
    enemy.jukeTimer = 0;
    enemy.jukeCooldown = 0.6 + Math.random() * 1.0;
    enemy.fireAnchor = 0;
    enemy.cloneAdvanceMul = 0.9;
    enemy.cloneLateralMul = 0.08;
    enemy.cloneWantDirect = true;
    enemy.lightningAimX = null;
    enemy.lightningAimZ = null;
    enemy.tactics = getDroneTactics(type.name);
    enemy.lastSeenX = pos.x;
    enemy.lastSeenZ = pos.z;
    enemy.lastSeenTimer = 0;
    enemy.lastMoveX = pos.x;
    enemy.lastMoveZ = pos.z;
    enemy.stuckTimer = 0;
    enemy.unstuckTurnDir = Math.random() > 0.5 ? 1 : -1;
    enemy.avoidTimer = 0;
    enemy.avoidX = 0;
    enemy.avoidZ = 0;
    enemy.smartThinkTimer = Math.random() * SIEGE_SMART_THINK_MAX;
    enemy.smartUnstuckTimer = 0;
    enemy.smartPlanValid = false;
    enemy.smartTargetX = 0;
    enemy.smartTargetZ = 0;
    enemy.smartSiegeTooClose = false;
    enemy.smartCanDirectChase = false;
    enemy.directChaseTimer = 0;
    enemy.lastRepathX = pos.x;
    enemy.lastRepathZ = pos.z;
    enemy.lodPhase = Math.floor(Math.random() * 4);
    enemy.botBurstShots = 0;
    enemy.aiPhase = null;
    enemy.aiAdvanceMul = NaN;
    enemy.aiLateralMul = NaN;
    enemy.aiRetreat = false;
    enemy.zombieWeaveTimer = 0;
    enemy.zombieWeaveCooldown = 0.8 + Math.random() * 1.2;
    enemy.zombieAnimLocked = false;
    enemy.cloneKeyF = 0;
    enemy.cloneKeyS = 0;
    enemy.cloneKeyTimer = 0;
    enemy.cloneVelX = 0;
    enemy.cloneVelZ = 0;
    // Ability revamp state: release any telegraph rings this body still holds
    // (pooled enemies recycle mid-ability) and zero all ability timers.
    if (enemy.telegraphRing) releaseTelegraphRing(enemy.telegraphRing);
    if (enemy.sanctuaryRing) releaseTelegraphRing(enemy.sanctuaryRing);
    if (enemy.empRing) releaseTelegraphRing(enemy.empRing);
    if (enemy.blinkRing) releaseTelegraphRing(enemy.blinkRing);
    if (enemy.barrageQueue) for (const s of enemy.barrageQueue) releaseTelegraphRing(s.ring);
    enemy.telegraphRing = null;
    enemy.sanctuaryRing = null;
    enemy.empRing = null;
    enemy.blinkRing = null;
    enemy.barrageQueue = [];
    enemy.barrageActive = false;
    enemy.barrageSpawned = 0;
    enemy.barrageSpawnTimer = 0;
    enemy.barrageCooldown = 4 + Math.random() * 5; // grace before the first barrage
    enemy.sanctR = 0;
    enemy.empWindUp = 0;
    enemy.blinkHold = 0;
    enemy.phaseOut = 0;
    enemy.feintCooldown = 1 + Math.random();
    if (enemy.mesh.userData.clonedGhost) {
      enemy.mesh.userData.clonedGhost.muzzleTimer = 0;
      enemy.mesh.userData.clonedGhost.aimPitch = 0;
      setHumanoidEnemyAction(enemy, "idle", 0);
    }
    if (enemy.mesh.userData.zombieAnim) {
      enemy.mesh.userData.zombieAnim.setDead(false);
    }
    if (enemy.mesh.userData.wardenAnim) {
      enemy.mesh.userData.wardenAnim.setDead(false); // clear death state on recycle
    }

    enemy.mesh.traverse(obj => {
      if (obj.isMesh) obj.userData.enemyRef = enemy;
    });
    ensureLiveEnemyVisible(enemy);

    return enemy;
  }

  function resetEnemyAura(enemy) {
    const aura = enemy.mesh?.userData?.clonedGhostAura;
    if (!aura) return;
    for (const mat of aura.glowMaterials ?? []) mat.emissiveIntensity = 0.05;
    for (const ring of aura.scanRings ?? []) ring.matA.opacity = ring.matB.opacity = 0;
    if (aura.auraRing) aura.auraRing.material.opacity = 0;
    if (aura.auraLight) aura.auraLight.intensity = 0;
  }

  function recycleEnemiesToPool(oldEnemies) {
    for (const enemy of oldEnemies) {
      setEnemyAlive(enemy, false);
      hideMegaBlast(enemy);
      resetEnemyAura(enemy);
      deactivateEnemyRuntimeLights(enemy);
      scene.remove(enemy.mesh);
      if (enemy.hpBar?.mesh) scene.remove(enemy.hpBar.mesh);
      enemyPools[enemy.typeName]?.push(enemy);
    }
  }

async function spawnEnemies(wave, options: any = {}) {
  const { smooth = false, minDistance = 18, relocatePlayer = false, preferVisible = false } = options;
  if (relocatePlayer) placePlayerForWave(wave);

  const oldEnemies = enemies.splice(0, enemies.length); oldEnemies.forEach(unregisterEnemy);

  const count = getWaveEnemyCount(wave);
  let positions = getDevSpawnPositions(wave, count, minDistance, preferVisible);
  const hpScale = getWaveHpScale(wave);
  game.totalEnemies = count;
  game.killed = 0;
  updateObjective();


  if (smooth) await waitFrame();

  if (smooth && oldEnemies.length) {
    for (let i = 0; i < oldEnemies.length; i++) {
      const enemy = oldEnemies[i];
      setEnemyAlive(enemy, false);
      hideMegaBlast(enemy);
      resetEnemyAura(enemy);
      deactivateEnemyRuntimeLights(enemy);
      scene.remove(enemy.mesh);
      enemyPools[enemy.typeName]?.push(enemy);
      if ((i + 1) % 3 === 0) await waitFrame();
    }
  } else {
    recycleEnemiesToPool(oldEnemies);
  }

  for (let i = 0; i < count; i++) {
    // Never reuse a position — offset wrapped extras so enemies don't stack.
    let pos = positions[i];
    if (!pos && positions.length > 0) {
      const base = positions[i % positions.length];
      const angle = (i / count) * Math.PI * 2;
      pos = { x: base.x + Math.cos(angle) * CELL * 1.5, z: base.z + Math.sin(angle) * CELL * 1.5 };
    }
    pos = pos || mapToWorld(MAP_W - 2, MAP_H - 2);
    const type = pickEnemyTypeForWave(wave);
    const pool = enemyPools[type.name];
    const enemy = pool && pool.length ? prepareEnemyForSpawn(pool.pop(), type, pos, wave, hpScale) : createEnemy(type, pos, wave, hpScale);
    scene.add(enemy.mesh);
    if (enemy.hpBar) scene.add(enemy.hpBar.mesh);
    ensureLiveEnemyVisible(enemy);
    enemies.push(enemy); registerEnemy(enemy);
    if (smooth && ((i + 1) % 2 === 0 || i === count - 1)) await waitFrame();
  }
  game.totalEnemies = enemies.length;
  updateObjective();
}

  async function warmFirstWaveEnemyInstances() {
    const previousEnemies = enemies.splice(0, enemies.length); previousEnemies.forEach(unregisterEnemy);
    for (const enemy of previousEnemies) {
      scene.remove(enemy.mesh);
      if (enemy.hpBar) scene.remove(enemy.hpBar.mesh);
    }

    await spawnEnemies(1, { smooth: false, minDistance: 8, preferVisible: true });
    for (const enemy of ecsEnemies) {
      enemy.mesh.visible = true;
      enemy.mesh.userData.mixer?.update?.(0.016);
      const ghost = enemy.mesh.userData.clonedGhost;
      if (ghost?.mixer) ghost.mixer.update(0.016);
      updateClonedGhostWeaponPose(enemy, 0.016, 18, false);
    }
    warmObjectTextures(scene);
    compileSceneForCurrentRenderer();
    for (const enemy of ecsEnemies) {
      enemy.mesh.visible = false;
      if (enemy.hpBar?.mesh) enemy.hpBar.mesh.visible = false;
    }
    renderScene();

    game.totalEnemies = enemies.length;
    game.killed = 0;
    updateObjective();
  }

  function activatePrimedFirstWave() {
    if (game.wave !== 1 || enemies.length === 0) return false;
    for (const enemy of liveEnemies) {
      ensureLiveEnemyVisible(enemy);
      if (enemy.mesh.userData.clonedGhost) setHumanoidEnemyAction(enemy, "idle", 0);
    }
    game.totalEnemies = enemies.length;
    game.killed = 0;
    updateObjective();
    return true;
  }

  function prewarmSiegeDronePool(options: any = {}) {
    const type = ENEMY_TYPES.find(t => t.name === "Siege Drone");
    if (!type) return;

    const pool = enemyPools[type.name];
    const targetCount = Math.max(1, options.count ?? 3);
    if (pool.length >= targetCount) return;

    const warmed = [];
    while (pool.length + warmed.length < targetCount) {
      const pos = mapToWorld(MAP_W - 2, MAP_H - 2);
      const enemy = createEnemy(type, pos, 5, 1);
      enemy.mesh.userData.mixer?.update?.(0.016);
      warmed.push(enemy);
    }

    if (options.compile) compileSceneForCurrentRenderer();

    for (const enemy of warmed) {
      setEnemyAlive(enemy, false);
      enemy.mesh.visible = false;
      scene.remove(enemy.mesh);
      pool.push(enemy);
    }
  }

  // Aggressive but spread-out prewarm: instantiate a small number of each enemy type
  // and create shared materials so shader compilation / texture uploads happen during loading.
  async function prewarmAllEnemyPools(options: any = {}) {
    const perType = Math.max(1, options.count ?? 2);
    // Drones are the procedural Storm Warden now — no shared angel textures to
    // prewarm. The per-instance build below compiles its materials on creation.

    for (const type of ENEMY_TYPES) {
      if (type.clonedGhost) continue;
      const pool = enemyPools[type.name] || [];
      const needed = Math.max(0, perType - pool.length);
      const warmed = [];
      for (let i = 0; i < needed; i++) {
        // create enemy out of view and perform minimal updates to allocate GPU resources
        const pos = mapToWorld(MAP_W - 2, MAP_H - 2);
        try {
          const enemy = createEnemy(type, pos, 1, 1);
          enemy.mesh.userData.mixer?.update?.(0.016);
          warmed.push(enemy);
          // spread work across frames to avoid a single long freeze
          if ((i & 1) === 0) await waitFrame();
        } catch (err) {
          console.warn('Failed to create prewarm enemy', type.name, err);
        }
      }

      if (warmed.length) {
        warmObjectTextures(scene);
        compileSceneForCurrentRenderer();
      }

      // move warmed enemies into pool (keep them hidden)
      for (const e of warmed) {
        setEnemyAlive(e, false);
        e.mesh.visible = false;
        scene.remove(e.mesh);
        (enemyPools[type.name] = enemyPools[type.name] || []).push(e);
      }

      // yield between types
      await waitFrame();
    }
  }

  async function prewarmClonedGhostPool(options: any = {}) {
    const type = ENEMY_TYPES.find(t => t.name === CLONED_GHOST_TYPE_NAME);
    if (!type) return;
    const pool = enemyPools[type.name] || [];
    const targetCount = Math.max(1, options.count ?? 2);
    const warmed = [];
    while (pool.length + warmed.length < targetCount) {
      await waitFrame();
      const pos = mapToWorld(MAP_W - 2, MAP_H - 2);
      const enemy = createEnemy(type, pos, Math.max(2, game.wave || 2), 1);
      enemy.mesh.visible = false;
      enemy.mesh.userData.clonedGhost?.mixer?.update?.(0.016);
      warmed.push(enemy);
    }
    if (warmed.length) {
      for (const enemy of warmed) enemy.mesh.visible = true;
      warmObjectTextures(scene);
      compileSceneForCurrentRenderer();
    }
    for (const enemy of warmed) {
      setEnemyAlive(enemy, false);
      enemy.mesh.visible = false;
      scene.remove(enemy.mesh);
      pool.push(enemy);
    }
    enemyPools[type.name] = pool;
  }

  const warmedWeaponViewModels = [];
  function prewarmWeaponViewModels() {
    if (warmedWeaponViewModels.length) return;

    for (const gunType of Object.values(GUNS)) {
      let warmedWeapon = firstPersonWeaponCache.get(gunType);
      if (!warmedWeapon) warmedWeapon = cacheFirstPersonWeapon(gunType, createWeaponViewModel(gunType, camera));
      warmedWeapon.gun.visible = true;
      warmedWeapon.flash.visible = true;
      warmedWeapon.flash.material.opacity = 0.65;
      setPhysicalMuzzleFlash(warmedWeapon.muzzle, true, 1, 1);
      warmedWeaponViewModels.push(warmedWeapon);

      let warmedThirdPersonWeapon = thirdPersonWeaponCache.get(gunType);
      if (!warmedThirdPersonWeapon) {
        warmedThirdPersonWeapon = createWeaponViewModel(gunType, scene);
        configureThirdPersonWeaponTransform(warmedThirdPersonWeapon.gun);
        captureThirdPersonPartBase(warmedThirdPersonWeapon.mag);
        captureThirdPersonPartBase(warmedThirdPersonWeapon.slide);
        captureWeaponRigPartBases(warmedThirdPersonWeapon, "thirdPersonBase");
        thirdPersonWeaponCache.set(gunType, warmedThirdPersonWeapon);
      }
      warmedThirdPersonWeapon.gun.visible = true;
      warmedThirdPersonWeapon.flash.visible = true;
      warmedThirdPersonWeapon.flash.material.opacity = 0.65;
      setPhysicalMuzzleFlash(warmedThirdPersonWeapon.muzzle, true, 1, 1);
      warmedWeaponViewModels.push(warmedThirdPersonWeapon);
      warmWeaponShootAudio(gunType);
    }

    compileSceneForCurrentRenderer();

    for (const warmedWeapon of warmedWeaponViewModels) {
      warmedWeapon.flash.visible = false;
      warmedWeapon.flash.material.opacity = 0;
      setPhysicalMuzzleFlash(warmedWeapon.muzzle, false, 0, 1);
      warmedWeapon.gun.visible = false;
    }
    if (weapon?.gun) weapon.gun.visible = !thirdPerson.enabled;
  }

  let weapon = cacheFirstPersonWeapon(currentGun, createWeaponViewModel(currentGun));
  let weaponAnim: any = initializeWeaponAnimation(currentGun);
  captureWeaponAnimationBases(weaponAnim, weapon);

  const cameraFX: any = { shake: 0, damageShake: 0, recoil: 0, recoilVel: 0, roll: 0, rollVel: 0, targetFov: 74 };
  const viewState: any = { ads: 0, lookBack: 0 };

  function applyEnemyHitFeedback(enemy, damage, headshot, dirX = 0, dirZ = 0, options: any = {}) {
    if (!enemy || !enemy.alive) return;
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / len;
    const nz = dirZ / len;
    const weaponHit = currentGun === GUNS.SHOTGUN
      ? { stagger: 0.24, knock: 4.8, shake: 0.09 }
      : currentGun === GUNS.SNIPER
        ? { stagger: 0.34, knock: 6.2, shake: 0.07 }
        : { stagger: 0.115, knock: 2.1, shake: 0.035 };
    const damageT = clamp01(damage / Math.max(1, enemy.maxHp * 0.42));
    const headshotBonus = headshot ? 1.35 : 1;

    enemy.hitStagger = Math.max(enemy.hitStagger || 0, weaponHit.stagger * (0.65 + damageT) * headshotBonus);
    enemy.hitKnockX = (enemy.hitKnockX || 0) + nx * weaponHit.knock * (0.35 + damageT) * headshotBonus;
    enemy.hitKnockZ = (enemy.hitKnockZ || 0) + nz * weaponHit.knock * (0.35 + damageT) * headshotBonus;
    enemy.hitFlash = Math.max(enemy.hitFlash || 0, headshot ? 1 : 0.62);
    enemy.attackPulse = Math.max(enemy.attackPulse, headshot ? 0.72 : 0.48);

    cameraFX.shake = Math.min(1, cameraFX.shake + weaponHit.shake * (headshot ? 1.2 : 1));
    spawnDamageNumber(enemy, damage, { headshot, melee: !!options.melee });
  }

  let audioCtx = null;
  let audioBus = null;
  let droneSfxTimer = 0;
  const noiseBufferCache = new Map();
  const warmedWeaponAudioTypes = new Set();
  const warmedLiveWeaponAudioTypes = new Set();
  let warmedEnemyLiveAudio = false;
  let warmedCommonLiveAudio = false;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function getAudioBus() {
    const ctx = getAudioCtx();
    if (!audioBus) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.16;

      const master = ctx.createGain();
      master.gain.value = 0.78;
      compressor.connect(master);
      master.connect(ctx.destination);
      audioBus = { input: compressor, master };
    }
    return audioBus.input;
  }

  // ── Voice limiter ────────────────────────────────────────────────────────
  // Procedural SFX create oscillator/noise nodes per sound. During heavy moments
  // (rapid fire + many enemies firing + hits) the Web Audio thread gets flooded
  // and the whole bus glitches/cuts out. Capping concurrent voices drops the
  // least-important new sounds instead, keeping the mix clean and continuous.
  let activeVoiceCount = 0;
  const MAX_CONCURRENT_VOICES = 24;
  function acquireVoice(holdSec) {
    if (activeVoiceCount >= MAX_CONCURRENT_VOICES) return false;
    activeVoiceCount++;
    const ms = Math.max(40, ((holdSec || 0) + 0.12) * 1000);
    setTimeout(() => { activeVoiceCount = Math.max(0, activeVoiceCount - 1); }, ms);
    return true;
  }

  function connectWithPan(ctx, node, pan = 0) {
    const output = getAudioBus();
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner);
      panner.connect(output);
      return;
    }
    node.connect(output);
  }

  // ── File-based audio layer (real SFX + announcer VO) ───────────────────────
  // Decodes the manifest files into AudioBuffers and plays them through the same bus
  // as the synth SFX. Any missing/failed file just isn't registered, so callers fall
  // back to the built-in synthesized sound. Zero cost until files exist.
  const loadedAudioBuffers = new Map();
  let audioAssetsLoaded = false;
  async function loadAudioAssets() {
    if (audioAssetsLoaded) return;
    audioAssetsLoaded = true;
    const ctx = getAudioCtx();
    const entries = [...Object.entries(SFX_MANIFEST || {}), ...Object.entries(VO_MANIFEST || {})];
    await Promise.all(entries.map(async ([name, url]) => {
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const arr = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr);
        loadedAudioBuffers.set(name, buf);
      } catch (e) { /* missing/undecodable → synth fallback */ }
    }));
  }
  function hasEventSound(name) { return loadedAudioBuffers.has(name); }
  function playEventSound(name, { volume = 1, pan = 0, rate = 1 } = {}) {
    const buf = loadedAudioBuffers.get(name);
    if (!buf) return false;
    if (!acquireVoice(buf.duration / Math.max(0.1, rate))) return false;
    try {
      const ctx = getAudioCtx();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g);
      connectWithPan(ctx, g, pan);
      src.start();
      return true;
    } catch (e) { return false; }
  }
  // Announcer: single-channel VO with a minimum gap so lines don't pile up.
  let lastAnnounceAt = -999;
  function announce(name, { minGap = 0.7, volume = 1 } = {}) {
    const now = performance.now() / 1000;
    if (now - lastAnnounceAt < minGap) return false;
    if (playEventSound(name, { volume })) { lastAnnounceAt = now; return true; }
    return false;
  }

  function playTone(freq, type, duration, gain, detune = 0, delay = 0, pan = 0, sweepTo = null) {
    if (!acquireVoice(delay + duration)) return;
    try {
      const ctx = getAudioCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t0 = ctx.currentTime + delay;
      o.connect(g);
      connectWithPan(ctx, g, pan);
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + duration);
      o.detune.setValueAtTime(detune, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      o.start(t0);
      o.stop(t0 + duration + 0.02);
    } catch (_) {}
  }

  function playModulatedTone(freq, duration, gain, modFreq = 18, modDepth = 70, delay = 0, pan = 0, sweepTo = null) {
    if (!acquireVoice(delay + duration)) return;
    try {
      const ctx = getAudioCtx();
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const out = ctx.createGain();
      const t0 = ctx.currentTime + delay;

      carrier.type = "sawtooth";
      mod.type = "triangle";
      carrier.frequency.setValueAtTime(freq, t0);
      if (sweepTo) carrier.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + duration);
      mod.frequency.setValueAtTime(modFreq, t0);
      mod.frequency.exponentialRampToValueAtTime(Math.max(1, modFreq * 0.35), t0 + duration);
      modGain.gain.setValueAtTime(modDepth, t0);
      modGain.gain.exponentialRampToValueAtTime(Math.max(1, modDepth * 0.18), t0 + duration);
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      out.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(out);
      connectWithPan(ctx, out, pan);
      carrier.start(t0);
      mod.start(t0);
      carrier.stop(t0 + duration + 0.03);
      mod.stop(t0 + duration + 0.03);
    } catch (_) {}
  }

  function getNoiseBuffer(ctx, duration) {
    const key = `${ctx.sampleRate}:${duration}`;
    if (noiseBufferCache.has(key)) return noiseBufferCache.get(key);

    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBufferCache.set(key, buf);
    return buf;
  }

  // Pre-baked soft-clipping curves — inject into WaveShaper for crunch/saturation
  const _distHard = (() => { const n=256,a=420,c=new Float32Array(n); for(let i=0;i<n;i++){const x=(i*2/n)-1;c[i]=(Math.PI+a)*x/(Math.PI+a*Math.abs(x));} return c; })();
  const _distMed  = (() => { const n=256,a=160,c=new Float32Array(n); for(let i=0;i<n;i++){const x=(i*2/n)-1;c[i]=(Math.PI+a)*x/(Math.PI+a*Math.abs(x));} return c; })();
  const _distSoft = (() => { const n=256,a= 55,c=new Float32Array(n); for(let i=0;i<n;i++){const x=(i*2/n)-1;c[i]=(Math.PI+a)*x/(Math.PI+a*Math.abs(x));} return c; })();

  // Filtered noise driven through a WaveShaper for real gun crunch texture
  function playDistorted(duration, gain, freq, filterType = "bandpass", delay = 0, pan = 0, q = 0.9, amount = 'med') {
    if (!acquireVoice(delay + duration)) return;
    try {
      const ctx = getAudioCtx();
      const t0  = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = getNoiseBuffer(ctx, duration);
      const filt = ctx.createBiquadFilter();
      filt.type = filterType;
      filt.frequency.setValueAtTime(freq, t0);
      filt.Q.value = q;
      const drive = ctx.createGain();
      drive.gain.value = amount === 'hard' ? 5.0 : amount === 'soft' ? 1.8 : 3.2;
      const ws = ctx.createWaveShaper();
      ws.curve = amount === 'hard' ? _distHard : amount === 'soft' ? _distSoft : _distMed;
      ws.oversample = '2x';
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filt); filt.connect(drive); drive.connect(ws); ws.connect(g);
      connectWithPan(ctx, g, pan);
      src.start(t0); src.stop(t0 + duration + 0.02);
    } catch (_) {}
  }

  // Sweeping tone — oscillator that ramps freq over time
  function playSweep(freqStart, freqEnd, duration, gain, type = "sine", delay = 0, pan = 0) {
    if (!acquireVoice(delay + duration)) return;
    try {
      const ctx = getAudioCtx();
      const t0  = ctx.currentTime + delay;
      const o   = ctx.createOscillator();
      const g   = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freqStart, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      o.connect(g); connectWithPan(ctx, g, pan);
      o.start(t0); o.stop(t0 + duration + 0.02);
    } catch (_) {}
  }

  function warmWeaponShootAudio(gunType) {
    if (warmedWeaponAudioTypes.has(gunType)) return;
    const ctx = getAudioCtx();
    getAudioBus();

    const durations = gunType === GUNS.SHOTGUN
      ? [0.012, 0.022, 0.42, 0.16, 0.065, 0.65]
      : gunType === GUNS.SNIPER
        ? [0.010, 0.030, 0.70, 0.26, 1.10, 0.32]
        : [0.010, 0.018, 0.25, 0.070, 0.46];

    for (const duration of durations) getNoiseBuffer(ctx, duration);
    warmedWeaponAudioTypes.add(gunType);
  }

  function warmLiveWeaponShootAudio(gunType) {
    if (warmedLiveWeaponAudioTypes.has(gunType)) return;
    warmWeaponShootAudio(gunType);
    const whisper = 0.00001;
    if (gunType === GUNS.SHOTGUN) {
      playNoise(0.028, whisper, 5200, "highpass");
      playNoise(0.24, whisper, 430, "lowpass", 0.002);
      playTone(62, "square", 0.04, whisper, -80);
    } else if (gunType === GUNS.SNIPER) {
      playNoise(0.04, whisper, 5200, "highpass");
      playNoise(0.38, whisper, 280, "lowpass", 0.002);
      playTone(38, "square", 0.05, whisper, -80);
    } else {
      playNoise(0.024, whisper, 6500, "highpass");
      playNoise(0.13, whisper, 650, "lowpass", 0.002);
      playTone(88, "square", 0.045, whisper, -80);
    }
    warmedLiveWeaponAudioTypes.add(gunType);
  }

  function warmEnemyLiveAudio() {
    if (warmedEnemyLiveAudio) return;
    getAudioBus();
    const whisper = 0.00001;
    playNoise(0.045, whisper, 7200, "highpass");
    playNoise(0.18, whisper, 4300, "bandpass", 0.006, 0, 2.6);
    playModulatedTone(42, 0.08, whisper, 11, 35);
    playTone(980, "triangle", 0.035, whisper, -120);
    warmedEnemyLiveAudio = true;
  }

  function warmCommonLiveAudio() {
    if (warmedCommonLiveAudio) return;
    const ctx = getAudioCtx();
    getAudioBus();
    for (const duration of [0.010, 0.012, 0.014, 0.018, 0.020, 0.022, 0.025, 0.028, 0.030, 0.032, 0.035, 0.040, 0.042, 0.045, 0.050, 0.055, 0.060, 0.065, 0.070, 0.085, 0.090, 0.095, 0.10, 0.12, 0.14, 0.18, 0.20, 0.22, 0.24]) {
      getNoiseBuffer(ctx, duration);
    }
    const whisper = 0.00001;
    playNoise(0.04, whisper, 4500, "highpass");
    playNoise(0.06, whisper, 400, "lowpass", 0.004);
    playNoise(0.15, whisper, 2000, "bandpass", 0.008);
    playNoise(0.035, whisper, 1400, "bandpass", 0.014);
    playNoise(0.022, whisper, 1800, "bandpass", 0.02);
    playTone(110, "square", 0.04, whisper, -220);
    playTone(76, "triangle", 0.035, whisper, -40);
    warmedCommonLiveAudio = true;
  }

  function primeFirstUseAudio() {
    for (const gunType of Object.values(GUNS)) warmLiveWeaponShootAudio(gunType);
    warmEnemyLiveAudio();
    warmCommonLiveAudio();
  }

  function playNoise(duration, gain, filter = 800, type = "bandpass", delay = 0, pan = 0, q = 0.9) {
    if (!acquireVoice(delay + duration)) return;
    try {
      const ctx = getAudioCtx();
      const src = ctx.createBufferSource();
      const filt = ctx.createBiquadFilter();
      const g = ctx.createGain();
      const t0 = ctx.currentTime + delay;
      src.buffer = getNoiseBuffer(ctx, duration);
      filt.type = type;
      filt.frequency.setValueAtTime(filter, t0);
      filt.Q.value = q;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filt);
      filt.connect(g);
      connectWithPan(ctx, g, pan);
      src.start(t0);
      src.stop(t0 + duration + 0.02);
    } catch (_) {}
  }

  function sfxShoot() {
    // Data-driven fire SFX: each gun's fireCycle (mechanism) picks a distinct synth
    // voice tuned per-gun (freq/gain/decay), and GUN_SPECS[gun].fireSound is tried
    // first against the manifest so dropping real files in assets/audio/sfx/ overrides
    // the synth with zero code changes.
    const spec = GUN_SPECS[currentGun] || ({} as any);
    const cycle = spec.fireCycle || "rifle";
    const scatterGun = cycle === "pump";
    const precisionGun = cycle === "bolt" || cycle === "coil";
    const lightGun = cycle === "slide" || cycle === "rattle";
    const _rate = (lightGun ? 1.12 : currentGun === GUNS.DMR ? 0.88 : 0.94) + Math.random() * 0.12;
    if (spec.fireSound && playEventSound(spec.fireSound, { volume: lightGun ? 0.7 : 0.85, rate: _rate })) return;

    // ── PISTOL — "slide": sharp crack + snappy slide clack ──────────────────
    if (cycle === "slide") {
      playNoise(0.010, 1.2, 44, "lowpass", 0, 0, 0.3);
      playTone(52, "sine", 0.06, 0.30, -340, 0, 0, 18);
      playDistorted(0.014, 1.15, 8600, "highpass", 0, 0, 2.4, 'hard');
      playDistorted(0.030, 0.85, 2600, "bandpass", 0.001, 0, 2.6, 'med');
      // Slide clack transient — bright metal snap right after the crack
      playNoise(0.012, 0.55, 5200, "bandpass", 0.028, 0, 6.0);
      playTone(1450, "triangle", 0.018, 0.10, -180, 0.030, 0, 700);
      playNoise(0.18, 0.30, 500, "lowpass", 0.004, 0, 0.7);
      return;
    }
    // ── SMG / AKIMBO — "rattle": buzzy, light, rapid-fire body ──────────────
    if (cycle === "rattle") {
      const akimbo = currentGun === GUNS.AKIMBO;
      playNoise(0.009, 1.0, 46, "lowpass", 0, 0, 0.28);
      playTone(60, "square", 0.05, 0.22, -300, 0, 0, 16);
      playDistorted(0.013, 1.0, 7200, "highpass", 0, 0, 2.0, 'med');
      playDistorted(0.026, 0.72, 2400, "bandpass", 0.001, 0, 2.4, akimbo ? 'soft' : 'med');
      playNoise(0.16, 0.34, 620, "lowpass", 0.003, 0, 0.6);
      playNoise(0.030, 0.18, 3400, "bandpass", 0.012, 0, 3.2);
      return;
    }
    // ── LMG — "drum": deep heavy thump + mechanical belt clack ──────────────
    if (cycle === "drum") {
      playNoise(0.016, 1.7, 34, "lowpass", 0, 0, 0.22);
      playTone(40, "sine", 0.11, 0.55, -260, 0, 0, 11);
      playDistorted(0.020, 1.2, 6800, "highpass", 0, 0, 2.0, 'hard');
      playDistorted(0.048, 1.15, 700, "lowpass", 0, 0, 0.62, 'hard');
      // Belt/receiver mechanical clack
      playNoise(0.020, 0.5, 2200, "bandpass", 0.018, 0, 3.4);
      playTone(240, "triangle", 0.03, 0.14, -120, 0.02, 0, 140);
      playNoise(0.34, 0.55, 260, "lowpass", 0.004, 0, 0.55);
      playNoise(0.60, 0.20, 480, "bandpass", 0.03, 0, 1.2);
      return;
    }
    // ── RAILGUN — "coil": sci-fi charge + zap, not a ballistic crack ────────
    if (cycle === "coil") {
      playSweep(180, 1400, 0.05, 0.55, "sawtooth", 0, 0);
      playNoise(0.03, 0.9, 9000, "highpass", 0.045, 0, 2.6);
      playTone(2200, "sine", 0.14, 0.5, 0, 0.048, 0, 5200);
      playModulatedTone(140, 0.16, 0.35, 30, 260, 0.05, 0, 40);
      playNoise(0.5, 0.4, 200, "lowpass", 0.06, 0, 0.6);
      playTone(60, "sine", 0.3, 0.3, -200, 0.06, 0, 20);
      return;
    }
    if (scatterGun) {
      const flak = currentGun === GUNS.FLAK; // harsher, faster decay than the pump shotgun
      // Sub-bass pressure dome
      playNoise(0.014, 1.8,  38,   "lowpass",  0,     0, 0.22);
      playTone(flak ? 34 : 28, "sine", flak ? 0.07 : 0.10, 0.72, -300, 0, 0, 9);
      // Distorted muzzle blast — core crunch
      playDistorted(flak ? 0.040 : 0.055, 1.35, flak ? 520 : 420, "lowpass",  0,     0, 0.55, 'hard');
      playDistorted(0.032, 1.10, 280, "lowpass",  0.002, 0, 0.42, 'hard');
      // High crack transient — flak is more ragged/harsh
      playNoise(0.016, 1.4, flak ? 10200 : 9200, "highpass", 0,     0, 1.8);
      playDistorted(0.024, 0.85, 5800, "highpass", 0.002, 0, flak ? 3.6 : 2.8, 'med');
      // Mid-body boom tail — shorter on flak (faster cyclic rate)
      playNoise(flak ? 0.30 : 0.50, 0.90, 310,  "lowpass",  0.004, 0, 0.60);
      playDistorted(0.18, 0.70, 1800, "bandpass", 0.010, 0, 1.8, 'soft');
      // Pellet scatter burst
      playNoise(0.045, 0.55, 4800, "bandpass", 0.022, 0, 3.5);
      // Room bloom
      playNoise(flak ? 0.55 : 0.90, 0.22, 480,  "lowpass",  0.065, 0, 0.90);
      return;
    }
    if (precisionGun) {
      const dmr = currentGun === GUNS.DMR; // crisp mid-power crack, shorter tail than the sniper
      // Sub-bass muzzle dome
      playNoise(0.012, 1.9,  32,   "lowpass",  0,     0, 0.20);
      playTone(dmr ? 26 : 22, "sine", dmr ? 0.09 : 0.12, 0.68, -350, 0, 0, 7);
      // Supersonic crack — ultra-brief spike
      playNoise(0.008, 1.6, 12000, "highpass", 0,     0, 1.5);
      playDistorted(0.020, 1.3,  8500, "highpass", 0.001, 0, dmr ? 2.6 : 2.0, 'hard');
      // Combustion body — heavy bloom
      playDistorted(0.065, 1.2,  190, "lowpass",  0,     0, 0.45, 'hard');
      playNoise(dmr ? 0.55 : 0.80,  1.15, 145,  "lowpass",  0.006, 0, 0.55);
      // Muzzle ring overtone
      playTone(680, "sine", 0.18, 0.07, -90, 0.010, 0, 310);
      // Mid-distance atmosphere
      playNoise(0.30, 0.28, 1600, "bandpass", 0.055, 0, 1.8);
      // Long room decay
      playNoise(dmr ? 0.90 : 1.40, 0.18, 290,  "lowpass",  0.160, 0, 0.62);
      // Delayed reflection echo
      playDistorted(0.15, 0.10, 380, "bandpass", 0.42, 0, 1.2, 'soft');
      playNoise(0.25, 0.06, 480,  "lowpass",  0.44,  0, 0.50);
      return;
    }
    // RIFLE — punchy distorted crack
    playNoise(0.012, 1.5,  38,  "lowpass",  0,     0, 0.24);
    playTone(48, "sine", 0.08, 0.35, -380, 0, 0, 15);
    playDistorted(0.018, 1.25, 9500, "highpass", 0,     0, 2.2, 'hard');
    playDistorted(0.042, 1.10, 3800, "bandpass", 0.002, 0, 2.8, 'med');
    playDistorted(0.038, 0.95, 580,  "lowpass",  0,     0, 0.70, 'hard');
    playNoise(0.28,  0.82, 420,  "lowpass",  0.003, 0, 0.72);
    playNoise(0.060, 0.40, 2900, "bandpass", 0.014, 0, 3.0);
    playNoise(0.55,  0.16, 680,  "bandpass", 0.028, 0, 1.4);
  }

  function sfxEnemyShotgun(enemy) {
    const dx = enemy.mesh.position.x - yaw.position.x;
    const dz = enemy.mesh.position.z - yaw.position.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const pan = Math.max(-0.85, Math.min(0.85, dx / Math.max(5, dist)));
    const atten = Math.max(0.15, Math.min(0.95, 1 - dist / 34));
    // High transient crack
    playNoise(0.020, 0.46 * atten, 7800, "highpass", 0,     pan, 2.2);
    // Low boom body
    playNoise(0.28,  0.72 * atten, 360,  "lowpass",  0.002, pan, 0.60);
    // Mid punch
    playNoise(0.09,  0.58 * atten, 2600, "bandpass", 0.004, pan, 1.8);
    // Sub bass tone
    playTone(46, "square", 0.18, 0.32 * atten, -190, 0, pan, 18);
    // Room tail
    playNoise(0.42, 0.12 * atten, 520, "bandpass", 0.055, pan, 0.8);
  }

  function sfxClonedGhostShot(enemy) {
    const dx = enemy.mesh.position.x - yaw.position.x;
    const dz = enemy.mesh.position.z - yaw.position.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const pan = Math.max(-0.85, Math.min(0.85, dx / Math.max(5, dist)));
    const atten = Math.max(0.16, Math.min(0.8, 1 - dist / 36));
    // Eerie spectral high transient
    playNoise(0.030, 0.50 * atten, 6200, "highpass", 0,     pan, 2.6);
    // Ghostly low resonance
    playNoise(0.20,  0.32 * atten, 740,  "lowpass",  0.003, pan, 0.75);
    // Supernatural wobble carrier
    playModulatedTone(115, 0.14, 0.18 * atten, 7, 32, 0, pan, 56);
    // Thin spectral crack
    playTone(640, "triangle", 0.065, 0.07 * atten, -220, 0.002, pan, 260);
    // Hollow mid tail
    playNoise(0.24, 0.14 * atten, 1200, "bandpass", 0.04, pan, 2.8);
  }

  function sfxLightning(enemy, intensity = 1) {
    if (playEventSound('lightning', { volume: Math.min(0.85, 0.45 * (intensity || 1)) })) return;
    const dx = enemy.mesh.position.x - yaw.position.x;
    const dz = enemy.mesh.position.z - yaw.position.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const pan   = Math.max(-0.9, Math.min(0.9, dx / Math.max(5, dist)));
    const atten = Math.max(0.22, Math.min(1, 1 - dist / 38)) * intensity;
    // Ionised-air ultra-high sizzle
    playNoise(0.014, 1.25 * atten, 10500, "highpass", 0,     pan, 1.8);
    // High-freq crack
    playNoise(0.10,  0.92 * atten,  6200, "highpass", 0,     pan, 2.2);
    // Mid snap
    playNoise(0.40,  0.78 * atten,  3400, "bandpass", 0.008, pan, 2.4);
    // Low rumble body
    playNoise(0.62,  0.58 * atten,  420,  "bandpass", 0.022, pan, 1.8);
    // Sub thunder roll
    playNoise(0.88,  0.42 * atten,  55,   "lowpass",  0.040, pan, 0.60);
    // Tesla modulated carrier
    playModulatedTone(78, 0.44, 0.20 * atten, 36, 160, 0, pan, 38);
    // Upper harmonic zap
    playTone(1650, "sawtooth", 0.068, 0.068 * atten, -260, 0.010, pan, 560);
    // Top shimmer
    playTone(3200, "triangle", 0.044, 0.040 * atten,  110, 0.050, pan, 1050);
  }

  function sfxHit() {
    if (playEventSound('enemy_hit', { volume: 0.6 })) return;
    // Cinematic sub-bass concussion
    playNoise(0.022, 1.1,  55,   "lowpass",  0,     0, 0.30);
    playTone(38, "sine", 0.10, 0.45, -280, 0, 0, 12);
    // Distorted smack — crunch of impact
    playDistorted(0.028, 1.0, 2400, "bandpass", 0,     0, 2.5, 'hard');
    playDistorted(0.018, 0.8, 8200, "highpass", 0.002, 0, 2.0, 'med');
    // Body thud
    playNoise(0.10, 0.72, 240,  "lowpass",  0.003, 0, 0.70);
  }

  function sfxKill() {
    if (playEventSound('enemy_death', { volume: 0.8 })) return;
    // Heavy sub-bass body thump
    playNoise(0.14,  0.62, 52,   "lowpass",  0,     0, 0.32);
    playDistorted(0.032, 1.0, 5200, "highpass", 0,     0, 2.2, 'med');
    playNoise(0.20,  0.60, 160,  "lowpass",  0.004, 0, 0.50);
    // Clean bell ping — satisfying confirm
    playTone(1320, "sine", 0.18, 0.14,   0, 0.008, 0, 600);
    playTone(1980, "sine", 0.14, 0.08,   0, 0.014, 0, 820);
    // Rising tail
    playSweep(90, 380, 0.28, 0.16, "sine", 0, 0);
    playNoise(0.055, 0.35, 8800, "highpass", 0.010, 0, 1.6);
  }

  function sfxMelee(hit) {
    // Aggressive blade whoosh with air displacement
    playNoise(0.20, 0.52, 2200, "bandpass", 0,     0, 2.2);
    playNoise(0.12, 0.28, 5500, "highpass", 0.015, 0, 2.6);
    playSweep(280, 680, 0.18, 0.07, "sine", 0, 0);
    if (hit) {
      // Meaty distorted crunch on impact
      playDistorted(0.045, 1.2,  180,  "lowpass",  0.040, 0, 0.50, 'hard');
      playDistorted(0.022, 0.90, 5800, "highpass", 0.040, 0, 2.8, 'med');
      playTone(62, "sine", 0.12, 0.20, -80, 0.040, 0, 22);
    }
  }

  // Reload SFX, dispatched by the equipped gun's reloadStyle so the mag/drum/
  // shells/topLoad TP staging (see CLAUDE.md "Reload staging") is matched by sound.
  function sfxReload() {
    const spec = GUN_SPECS[currentGun] || ({} as any);
    const style = spec.reloadStyle || "mag";
    if (spec.reloadSound && playEventSound(spec.reloadSound, { volume: 0.8 })) return;
    if (playEventSound('reload', { volume: 0.8 })) return;
    if (style === "shells") { sfxReloadShells(); return; }
    if (style === "drum") { sfxReloadDrum(); return; }
    if (style === "topLoad") { sfxReloadTopLoad(); return; }
    sfxReloadMag();
  }

  // Quick shell-by-shell chunks (shotgun/flak "shells" reloadStyle) — 3 individual
  // shell insertions, each a push-thunk + brass rattle, then a pump-forward.
  function sfxReloadShells(count = 3) {
    for (let i = 0; i < count; i++) {
      const t = i * 0.30;
      playNoise(0.030, 0.30, 2600, "bandpass", t, 0, 4.0);
      playTone(210, "triangle", 0.03, 0.10, -120, t + 0.004, 0, 130);
      playNoise(0.045, 0.34, 320, "lowpass", t + 0.03, 0, 0.7);
      playNoise(0.018, 0.16, 5200, "bandpass", t + 0.05, 0, 5.5);
    }
    const tEnd = count * 0.30;
    // Pump-forward chamber slam
    playNoise(0.05, 0.42, 1800, "bandpass", tEnd, 0, 3.0);
    playNoise(0.035, 0.30, 260, "lowpass", tEnd + 0.03, 0, 0.65);
  }

  // Heavy drum swap (LMG/flak "drum" reloadStyle) — big detach clunk, wide arc
  // carry, heavier drop-in seat than a mag.
  function sfxReloadDrum() {
    playNoise(0.05, 0.5, 220, "lowpass", 0, 0, 0.4);
    playDistorted(0.04, 0.9, 500, "lowpass", 0.01, 0, 0.5, 'hard');
    playNoise(0.09, 0.30, 3000, "bandpass", 0.05, 0, 3.0); // carry scrape
    playNoise(0.10, 0.55, 260, "lowpass", 0.62, 0, 0.6);   // heavy drum seat
    playDistorted(0.06, 0.85, 700, "lowpass", 0.62, 0, 0.55, 'hard');
    playTone(150, "triangle", 0.05, 0.14, -90, 0.66, 0, 100);
    playNoise(0.06, 0.35, 5800, "bandpass", 0.78, 0, 6.0);  // charging handle
    playNoise(0.05, 0.28, 2200, "bandpass", 0.86, 0, 4.5);
  }

  // Top-load from above/behind (sniper/railgun "topLoad" reloadStyle) — bolt/hatch
  // lift, single round or cell drop, seat click.
  function sfxReloadTopLoad() {
    playNoise(0.05, 0.30, 4200, "bandpass", 0, 0, 5.0);     // bolt/hatch lift
    playTone(360, "triangle", 0.03, 0.09, -100, 0.01, 0, 180);
    playNoise(0.03, 0.20, 1600, "bandpass", 0.35, 0, 3.5);  // round/cell drop
    playNoise(0.05, 0.34, 300, "lowpass", 0.55, 0, 0.6);    // seat thunk
    playTone(230, "triangle", 0.04, 0.10, -100, 0.58, 0, 130);
    playNoise(0.05, 0.32, 4800, "bandpass", 0.70, 0, 5.5);  // hatch/bolt close
  }

  function sfxReloadMag() {
    // Magazine eject — sharp metallic click
    playNoise(0.018, 0.22, 3400, "bandpass", 0,     0, 6.0);
    playTone(310, "triangle", 0.022, 0.07, -150, 0.002, 0, 190);
    // Mag sliding out scrape
    playNoise(0.050, 0.14, 3000, "bandpass", 0.026, 0, 5.0);
    // New mag insertion thud — low and solid
    playNoise(0.070, 0.36, 320,  "lowpass",  0.19,  0, 0.85);
    playNoise(0.032, 0.26, 4600, "bandpass", 0.20,  0, 7.0);
    // Mag seat click
    playTone(195, "triangle", 0.042, 0.065, -100, 0.245, 0, 120);
    // Charging handle pull back
    playNoise(0.060, 0.38, 6200, "bandpass", 0.31,  0, 7.5);
    // Charging handle slam forward
    playNoise(0.045, 0.30, 2400, "bandpass", 0.38,  0, 5.5);
    playNoise(0.030, 0.22, 180,  "lowpass",  0.385, 0, 0.7);
    // Final chamber round click
    playNoise(0.022, 0.20, 1600, "bandpass", 0.42,  0, 4.2);
    playTone(340, "triangle", 0.034, 0.055, -85, 0.435, 0, 210);
  }

  function sfxDamage() {
    if (playEventSound('player_hurt', { volume: 0.8 })) return;
    // Heavy sub-bass body impact — felt in the chest
    playNoise(0.025, 1.4,  42,  "lowpass",  0,     0, 0.28);
    playTone(30, "sine", 0.10, 0.55, -320, 0, 0, 9);
    playDistorted(0.038, 1.1, 320,  "lowpass",  0,     0, 0.55, 'hard');
    playNoise(0.22, 0.52, 180,  "lowpass",  0.003, 0, 0.52);
    // Sharp pain crack
    playDistorted(0.020, 0.85, 7500, "highpass", 0, 0, 1.8, 'med');
    // Cinematic tinnitus ring — fades slow
    playTone(3400, "sine", 0.85, 0.040, 0, 0.042, 0, 1800);
    playTone(2100, "sine", 0.55, 0.018, 0, 0.055, 0, 1100);
  }

  function sfxEmpty() {
    // Dry metallic firing-pin click
    playNoise(0.014, 0.082, 3800, "bandpass", 0,     0, 7.0);
    // Firing pin resonance ring
    playTone(720, "triangle", 0.020, 0.042, -210, 0.004, 0, 360);
    // Short metallic decay
    playNoise(0.020, 0.048, 2200, "bandpass", 0.014, 0, 5.0);
  }

  // Weapon-switch handling sound — quick clothing/strap rustle + a metal clack,
  // scaled by the incoming gun's equipTime (pistol snappiest, LMG/railgun slowest).
  function sfxEquip(gunType) {
    const spec = GUN_SPECS[gunType] || ({} as any);
    const heavy = spec.equipTime >= 0.4;
    if (spec.equipSound && playEventSound(spec.equipSound, { volume: 0.5 })) return;
    playNoise(heavy ? 0.09 : 0.05, 0.20, heavy ? 900 : 1800, "bandpass", 0, 0, 1.4);
    playNoise(0.03, 0.16, heavy ? 4200 : 5200, "bandpass", heavy ? 0.07 : 0.04, 0, 4.0);
    playTone(heavy ? 180 : 320, "triangle", 0.03, 0.08, -100, heavy ? 0.08 : 0.05, 0, 140);
  }

  // ── Interactable feedback SFX (perk statue / mystery box) ───────────────────
  // Ascending crystalline power-up chime, tier-scaled so each perk tier reads
  // slightly bigger/brighter than the last.
  function sfxPerkPurchase(tier = 0) {
    if (playEventSound('perk_purchase', { volume: 0.85 })) return;
    const base = 380 + tier * 90;
    playNoise(0.03, 0.4, 3000, "bandpass", 0, 0, 3.0);
    playTone(base,        "sine", 0.30, 0.22, 0, 0.00, 0, base * 1.3);
    playTone(base * 1.5,  "sine", 0.28, 0.18, 0, 0.06, 0, base * 1.9);
    playTone(base * 2.0,  "sine", 0.26, 0.14, 0, 0.12, 0, base * 2.6);
    playNoise(0.5, 0.20, 1400, "bandpass", 0.02, 0, 1.4);
  }

  // Low denied buzz — press E without enough XP at a statue/box.
  function sfxDenied() {
    if (playEventSound('perk_deny', { volume: 0.6 })) return;
    playTone(150, "square", 0.09, 0.16, -40, 0, 0, 90);
    playTone(110, "square", 0.10, 0.14, -40, 0.08, 0, 65);
    playNoise(0.05, 0.10, 500, "lowpass", 0.02, 0, 0.6);
  }

  // Mystery-box open — mechanical latch/creak on the lid swinging up.
  function sfxBoxOpen() {
    if (playEventSound('box_open', { volume: 0.8 })) return;
    playNoise(0.06, 0.30, 1400, "bandpass", 0, 0, 2.0);
    playDistorted(0.10, 0.35, 380, "lowpass", 0.02, 0, 0.5, 'soft');
    playTone(220, "triangle", 0.14, 0.10, -80, 0.03, 0, 140); // hinge creak
    playNoise(0.04, 0.18, 2600, "bandpass", 0.14, 0, 3.0);    // latch clack
  }

  // Rising reveal whoosh while the weapon lifts out of the box.
  function sfxBoxReveal() {
    if (playEventSound('box_reveal', { volume: 0.7 })) return;
    playSweep(220, 900, 0.5, 0.22, "sine", 0, 0);
    playNoise(0.5, 0.16, 2200, "bandpass", 0.02, 0, 1.4);
  }

  // Comedic descending-pitch dud sting for the teddy-bear pull.
  function sfxBoxDud() {
    if (playEventSound('box_dud', { volume: 0.7 })) return;
    playSweep(520, 90, 0.32, 0.22, "sawtooth", 0.00, 0);
    playSweep(360, 70, 0.34, 0.16, "square",   0.10, 0);
    playSweep(260, 55, 0.36, 0.12, "sawtooth", 0.22, 0);
  }

  function sfxPackUpgrade(level = 1) {
    if (playEventSound('pack_ready', { volume: 1.0 })) { announce('vo_pack_ready', { minGap: 0 }); return; }
    const lift = Math.max(0, level - 1);

    // === PHASE 1 (0s): Weapon locks in — heavy mechanical THUNK ===
    playDistorted(0.040, 1.6, 95,   "lowpass",  0,     0, 0.32, 'hard'); // sub-bass clunk
    playDistorted(0.022, 1.3, 3800, "highpass", 0,     0, 3.5, 'hard'); // metallic crack
    playNoise(0.10, 0.90, 180, "lowpass",  0.004, 0, 0.48); // heavy body
    playTone(38, "sine", 0.08, 0.55, -320, 0, 0, 10);        // sub-bass thud tone

    // === PHASE 2 (0.05–0.55s): Machine charging — energy build ===
    // Rising machine whine — sweeps upward
    playSweep(55, 280 + lift * 65, 0.50, 0.22, "sawtooth", 0.05, 0);
    playSweep(110, 560 + lift * 120, 0.46, 0.12, "triangle", 0.08, 0);
    // Electric crackling sizzle — intensifies
    playNoise(0.18, 0.38, 6500, "bandpass", 0.06, 0, 5.0);
    playDistorted(0.22, 0.32, 4200, "highpass", 0.10, 0, 2.2, 'med');
    // Low power hum building
    playNoise(0.45, 0.55, 380,  "bandpass", 0.05, 0, 3.5);
    playModulatedTone(68 + lift * 18, 0.50, 0.28, 8, 55, 0.08, 0, 42);

    // === PHASE 3 (0.6s): Discharge + Power-up confirmation ===
    // Explosive detonation
    playDistorted(0.020, 2.0, 32,   "lowpass",  0.62, 0, 0.20, 'hard');
    playDistorted(0.016, 1.8, 14000,"highpass", 0.62, 0, 1.5, 'hard');
    playNoise(0.30, 1.2, 140,  "lowpass",  0.62, 0, 0.50);
    // Crystalline bell sequence — ascending power-up chime
    const base = 550 + lift * 110;
    playTone(base,        "sine", 0.55, 0.22, 0, 0.64, 0, base * 1.1);
    playTone(base * 1.26, "sine", 0.48, 0.18, 0, 0.72, 0, base * 1.4);
    playTone(base * 1.58, "sine", 0.42, 0.14, 0, 0.80, 0, base * 1.7);
    playTone(base * 2.00, "sine", 0.36, 0.10, 0, 0.88, 0, base * 2.2);
    playTone(base * 2.52, "sine", 0.30, 0.07, 0, 0.96, 0, base * 2.8);
    // Energy shimmer tail
    playNoise(0.60, 0.30, 5500, "bandpass", 0.65, 0, 4.5);
    playNoise(0.90, 0.18, 820,  "bandpass", 0.66, 0, 1.8);
    // Long resonant glow
    playSweep(280 + lift * 55, 80, 1.20, 0.12, "sine", 0.68, 0);
  }

  function sfxJump(landed = false) {
    if (playEventSound(landed ? 'land' : 'jump', { volume: 0.55 })) return;
    if (landed) {
      // Heavy landing thud
      playNoise(0.090, 0.28, 105, "lowpass",  0,     0, 0.50);
      // Floor resonance
      playTone(50, "triangle", 0.072, 0.08, -65, 0, 0, 36);
      // Gear and equipment rattle
      playNoise(0.040, 0.12, 1300, "bandpass", 0.008, 0, 2.2);
      // Boot impact crunch
      playNoise(0.025, 0.18, 3200, "bandpass", 0.002, 0, 3.5);
      return;
    }
    // Takeoff effort — low exertion burst
    playNoise(0.060, 0.16, 190, "lowpass",  0, 0, 0.72);
    playTone(82, "triangle", 0.072, 0.06, -55, 0, 0, 60);
    // Clothing/gear rustle
    playNoise(0.095, 0.08, 900, "bandpass", 0.010, 0, 1.6);
  }

  function sfxDroneAlien(enemy, intensity = 1) {
    const dx = enemy.mesh.position.x - yaw.position.x;
    const dz = enemy.mesh.position.z - yaw.position.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const pan = Math.max(-0.9, Math.min(0.9, dx / Math.max(5, dist)));
    const aura = enemy.aura?.type;
    const base = enemy.typeName === "Siege Drone" ? 34 : aura === "shock" ? 74 : aura === "burn" ? 52 : aura === "drain" ? 44 : aura === "slow" ? 58 : enemy.ranged ? 38 : 64;
    const gain = Math.max(0.035, Math.min(0.2, intensity * (1 - Math.min(dist, 28) / 36)));
    playModulatedTone(base, 0.46, gain * 0.78, enemy.typeName === "Siege Drone" ? 11 : 18, enemy.typeName === "Siege Drone" ? 95 : 62, 0, pan, base * (0.42 + Math.random() * 0.18));
    playTone(base * 1.47, "triangle", 0.32, gain * 0.22, -180 + Math.random() * 90, 0.015, pan, base * 0.72);
    playNoise(0.34, gain * 0.86, aura === "shock" ? 1900 : enemy.typeName === "Siege Drone" ? 520 : 720, "bandpass", 0.02, pan, aura === "drain" ? 6 : 3.4);
    playNoise(0.22, gain * 0.46, 105, "lowpass", 0.04, pan, 0.7);
    if (enemy.typeName === "Siege Drone") playNoise(0.09, gain * 0.22, 2600, "bandpass", 0.18, pan, 5.5);
  }

  function sfxMegaBlastFire(enemy) {
    const dx = enemy.mesh.position.x - yaw.position.x;
    const dz = enemy.mesh.position.z - yaw.position.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const pan   = Math.max(-0.9, Math.min(0.9, dx / Math.max(5, dist)));
    const atten = Math.max(0.30, Math.min(1.0, 1 - dist / 38));
    // Sub-bass detonation shockwave
    playNoise(0.014, 1.8 * atten, 40,   "lowpass",  0,     pan, 0.20);
    // Ultra-high crack / discharge
    playNoise(0.025, 1.5 * atten, 9200, "highpass", 0,     pan, 2.2);
    // Long deep beam body
    playNoise(0.80,  1.2 * atten, 280,  "lowpass",  0.006, pan, 0.48);
    // Bass tone foundation
    playTone(44, "sawtooth", 0.85, 0.62 * atten, -260, 0,     pan, 14);
    // Resonant beam carrier
    playTone(360, "triangle", 0.85, 0.30 * atten, -90, 0.012, pan, 190);
    // High energy sizzle
    playNoise(0.55, 0.78 * atten, 2600, "bandpass", 0.015, pan, 5.5);
    // Mid crackle layer
    playNoise(0.35, 0.55 * atten, 820,  "bandpass", 0.008, pan, 3.0);
  }

  function sfxMegaBlastBeam(enemy, power = 1) {
    const dx = enemy.mesh.position.x - yaw.position.x;
    const dz = enemy.mesh.position.z - yaw.position.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const pan   = Math.max(-0.9, Math.min(0.9, dx / Math.max(5, dist)));
    const atten = Math.max(0.18, Math.min(0.88, 1 - dist / 36)) * power;
    // Sustained low beam roar
    playNoise(0.40, 0.75 * atten, 240,  "lowpass",  0, pan, 0.55);
    // Modulated energy hum (beam drone)
    playModulatedTone(130, 0.40, 0.35 * atten, 6, 42, 0, pan, 68);
    // High static sizzle
    playNoise(0.40, 0.52 * atten, 1800, "bandpass", 0, pan, 5.2);
    // Sub bass throb
    playTone(38, "sawtooth", 0.40, 0.28 * atten, -180, 0, pan, 12);
  }

  function updateDroneAudio(dt) {
    if (!audioCtx || game.state !== "playing") return;
    droneSfxTimer = Math.max(0, droneSfxTimer - dt);
    if (droneSfxTimer > 0) return;

    let bestEnemy = null;
    let bestScore = 0;
    for (const enemy of liveEnemies) {
      if (!enemy.aggroed) continue;
      const dist = Math.hypot(enemy.mesh.position.x - yaw.position.x, enemy.mesh.position.z - yaw.position.z);
      const auraBonus = enemy.aura ? 0.35 : 0;
      const score = Math.max(0, 1 - dist / 26) + auraBonus + enemy.attackPulse * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestEnemy = enemy;
      }
    }

    if (bestEnemy && bestScore > 0.08) {
      sfxDroneAlien(bestEnemy, bestScore);
      droneSfxTimer = 0.42 + Math.random() * 0.62 - Math.min(0.22, bestScore * 0.12);
    }
  }

  function spawnImpactParticles(pos, normal, countOverride = null) {
    const available = Math.max(0, MAX_ACTIVE_IMPACT_PARTICLES - particles.length);
    const count = Math.min(available, countOverride ?? (3 + Math.floor(Math.random() * 4)));
    for (let i = 0; i < count; i++) {
      const p = checkoutImpactParticle();
      p.mesh.material = impactMaterials[Math.random() > 0.5 ? 0 : 1];
      p.mesh.position.copy(pos);
      p.mesh.scale.setScalar(0.9 + Math.random() * 1.35);
      const speed = 1.5 + Math.random() * 3;
      p.vel.set(
        normal.x + (Math.random() - 0.5) * 2,
        normal.y + (Math.random() - 0.5) * 2 + 0.5,
        normal.z + (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(speed);
      p.life = 0.22 + Math.random() * 0.22;
      p.maxLife = 0.45;
      particles.push(p);
    }
  }

  function createDamageNumberTexture(text, color, strokeColor) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "900 62px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(0,0,0,0.88)";
    ctx.shadowBlur = 10;
    ctx.lineWidth = 14;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(text, 128, 66);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.strokeText(text, 128, 66);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function recycleDamageNumber(dn) {
    if (!dn) return;
    scene.remove(dn.sprite);
    dn.sprite.material.map?.dispose?.();
    dn.sprite.material.dispose?.();
  }

  function spawnDamageNumber(enemy, damage, options: any = {}) {
    if (!enemy?.mesh || !Number.isFinite(damage) || damage <= 0) return;
    if (damageNumbers.length >= 34) recycleDamageNumber(damageNumbers.shift());

    const headshot = !!options.headshot;
    const melee = !!options.melee;
    const rounded = Math.max(1, Math.round(damage));
    const texture = createDamageNumberTexture(
      String(rounded),
      headshot ? "#ffe96a" : melee ? "#ff9b45" : "#f7fbff",
      headshot ? "rgba(78,38,0,0.98)" : melee ? "rgba(82,24,0,0.96)" : "rgba(10,22,32,0.96)"
    );
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(material);
    getEnemyHitCenter(enemy, enemyHitCenterTmp);
    const height = enemy.mesh.userData?.healthOffset?.y || 2.2;
    const side = (Math.random() - 0.5) * 0.55;
    sprite.position.set(
      enemyHitCenterTmp.x + side,
      enemy.mesh.position.y + height * (headshot ? 0.92 : 0.72),
      enemyHitCenterTmp.z
    );
    const size = (headshot ? 0.78 : 0.62) + Math.min(0.36, rounded / 620);
    sprite.scale.set(size * 1.7, size * 0.85, 1);
    sprite.renderOrder = 900;
    scene.add(sprite);

    damageNumbers.push({
      sprite,
      life: headshot ? 0.72 : 0.62,
      maxLife: headshot ? 0.72 : 0.62,
      vel: new THREE.Vector3(side * 0.85, 1.65 + Math.random() * 0.45, (Math.random() - 0.5) * 0.28),
      baseScaleX: sprite.scale.x,
      baseScaleY: sprite.scale.y,
    });
  }

  function spawnBulletTracer(start, end, gunType) {
    const spec = GUN_SPECS[gunType];
    tracerDirTmp.copy(end).sub(start);
    const fullLen = tracerDirTmp.length();
    if (fullLen < 0.1) return;

    tracerDirTmp.normalize();
    const jitter = 0.018 + Math.random() * 0.045;
    const visibleLen = Math.min(spec.tracerLen * (0.28 + Math.random() * 0.2), fullLen);
    const startOffset = Math.min(Math.max(0.035, fullLen - visibleLen), 0.24 + Math.random() * 0.18);
    tracerStartTmp.copy(start).addScaledVector(tracerDirTmp, startOffset);
    shotMuzzleRightTmp.crossVectors(tracerDirTmp, tracerUp);
    if (shotMuzzleRightTmp.lengthSq() < 0.0001) shotMuzzleRightTmp.set(1, 0, 0);
    else shotMuzzleRightTmp.normalize();
    shotMuzzleUpTmp.crossVectors(shotMuzzleRightTmp, tracerDirTmp).normalize();
    tracerStartTmp
      .addScaledVector(shotMuzzleRightTmp, (Math.random() - 0.5) * jitter)
      .addScaledVector(shotMuzzleUpTmp, (Math.random() - 0.5) * jitter);
    tracerEndTmp.copy(tracerStartTmp).addScaledVector(tracerDirTmp, visibleLen);
    tracerMidTmp.copy(tracerStartTmp).lerp(tracerEndTmp, 0.5);
    const radius = gunType === GUNS.SNIPER ? 0.022 : gunType === GUNS.SHOTGUN ? 0.016 : 0.018;

    const tracer = checkoutTracer(gunType);
    tracer.line.position.copy(tracerMidTmp);
    tracer.line.quaternion.setFromUnitVectors(tracerUp, tracerDirTmp);
    tracer.line.scale.set(radius * (0.8 + Math.random() * 0.3), visibleLen, radius * (1.1 + Math.random() * 0.35));
    tracer.life = Math.min(spec.tracerLife, 0.02 + Math.random() * 0.012);
    tracer.maxLife = tracer.life;
    tracer.baseOpacity = gunType === GUNS.SNIPER ? 0.13 : gunType === GUNS.SHOTGUN ? 0.08 : 0.10;
    tracers.push(tracer);
  }

  function buildLightningPathScratch(start, end, segments = 12, jitter = 0.38, lift = 0) {
    const pointCount = Math.min(segments + 1, lightningPathScratch.length);
    const clampedSeg = Math.max(1, pointCount - 1);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const totalLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const horizLen  = Math.hypot(dx, dz) || 1;

    // First perpendicular axis (horizontal, 90Â° to bolt in XZ plane)
    const sideX = -dz / horizLen;
    const sideZ =  dx / horizLen;

    // Second perpendicular axis (vertical component orthogonal to bolt AND side)
    // Derived via cross product: bolt × side, then normalised
    const upX = -(dy * sideZ) / totalLen;
    const upY =  (dx * sideZ + dz * sideX) / totalLen;
    const upZ =  (dy * sideX) / totalLen;

    lightningPathScratch[0].copy(start);
    lightningPathScratch[pointCount - 1].copy(end);

    // Independent random displacement per point — no correlated walk.
    // Each point kicks independently in BOTH perpendicular axes, producing
    // the sharp angular bends real lightning makes rather than a smooth arc.
    const scale = jitter * totalLen;

    for (let i = 1; i < pointCount - 1; i++) {
      const t = i / clampedSeg;

      // Base position along bolt + optional arc
      const bx = start.x + dx * t;
      const by = start.y + dy * t + Math.sin(t * Math.PI) * lift;
      const bz = start.z + dz * t;

      // Soft pinch so bolt still arrives at its target (pow < 1 = stays jagged near endpoints)
      const pinch = Math.pow(Math.min(t, 1 - t) * 2, 0.55);

      // Independent displacement along both perpendicular axes
      const perpA = (Math.random() - 0.5) * 2 * scale * pinch;
      const perpB = (Math.random() - 0.5) * 2 * scale * 0.45 * pinch;

      lightningPathScratch[i].set(
        bx + sideX * perpA + upX * perpB,
        by + upY * perpB,
        bz + sideZ * perpA + upZ * perpB
      );
    }

    return pointCount;
  }

  function writeLightningSegment(effect, a, b) {
    if (effect.segmentCount >= LIGHTNING_MAX_SEGMENTS) return;
    const i = effect.segmentCount * 6;
    const p = effect.positions;
    p[i] = a.x; p[i + 1] = a.y; p[i + 2] = a.z;
    p[i + 3] = b.x; p[i + 4] = b.y; p[i + 5] = b.z;
    effect.segmentCount++;
  }

  function writeLightningPathFromScratch(effect, count) {
    for (let i = 1; i < count; i++) writeLightningSegment(effect, lightningPathScratch[i - 1], lightningPathScratch[i]);
  }

  function writeGeneratedLightningPath(effect, start, end, segments = 7, jitter = 0.38, lift = 0) {
    writeLightningPathFromScratch(effect, buildLightningPathScratch(start, end, segments, jitter, lift));
  }

  function spawnLightningEffect(start, end, power = 1, options: any = {}) {
    const lowEndLateWave = lowEndMode && game.wave >= 6;
    const maxActive = options.maxActive ?? (lowEndLateWave ? 7 : lowEndMode ? 9 : LIGHTNING_POOL_SIZE);
    if (lightningEffects.length >= maxActive) recycleLightningEffect(lightningEffects.shift());
    const electric = options.electric === true;

    const effect = checkoutLightningEffect();
    const mainPathCount = buildLightningPathScratch(
      start,
      end,
      options.segments ?? (electric ? (lowEndLateWave ? 6 : 10) : (lowEndLateWave ? 8 : 14)),
      options.jitter ?? (electric ? (0.18 + power * 0.09) : ((0.62 + power * 0.34) * (lowEndLateWave ? 0.82 : 1))),
      options.lift ?? (electric ? 0.04 : (lowEndLateWave ? 0.14 : 0.20))
    );
    writeLightningPathFromScratch(effect, mainPathCount);
    for (let i = 0; i < mainPathCount; i++) lightningMainPathScratch[i].copy(lightningPathScratch[i]);

    const sourceBranches = options.sourceBranches ?? 0;
    for (let i = 0; i < sourceBranches; i++) {
      const angle = Math.random() * Math.PI * 2;
      const len = electric ? 0.22 + Math.random() * (0.42 + power * 0.16) : 0.45 + Math.random() * (0.95 + power * 0.34);
      teslaBranchTmp.set(
        start.x + Math.cos(angle) * len,
        start.y + (Math.random() - 0.35) * (electric ? 0.28 + power * 0.08 : 0.55 + power * 0.2),
        start.z + Math.sin(angle) * len
      );
      writeGeneratedLightningPath(effect, start, teslaBranchTmp, electric ? 2 : 3, electric ? 0.06 + Math.random() * 0.05 : 0.18 + Math.random() * 0.14, electric ? 0.02 : 0.12);
    }

    const branchCount = options.branches ?? (lowEndLateWave ? 1 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 3));
    for (let i = 0; i < branchCount; i++) {
      const anchor = lightningMainPathScratch[Math.min(mainPathCount - 1, 2 + Math.floor(Math.random() * Math.max(2, mainPathCount - 4)))];
      const angle = Math.random() * Math.PI * 2;
      const len = electric ? 0.18 + Math.random() * (0.38 + power * 0.12) : 0.45 + Math.random() * (1.05 + power * 0.25);
      teslaBranchTmp.set(
        anchor.x + Math.cos(angle) * len,
        Math.max(0.08, anchor.y + (electric ? (Math.random() - 0.52) * 0.22 : -0.25 - Math.random() * 0.85)),
        anchor.z + Math.sin(angle) * len
      );
      writeGeneratedLightningPath(effect, anchor, teslaBranchTmp, 2, electric ? 0.045 + Math.random() * 0.035 : 0.1 + Math.random() * 0.12, electric ? 0.01 : 0.04);
    }

    effect.geometry.setDrawRange(0, effect.segmentCount * 2);
    effect.geometry.attributes.position.needsUpdate = true;

    effect.ring.position.set(end.x, 0.035, end.z);
    effect.ring.scale.setScalar(electric ? 0.12 + power * 0.035 : 0.24 + power * 0.08);
    effect.baseScale = electric ? 0.12 + power * 0.035 : 0.24 + power * 0.08;
    effect.sourceRing.position.copy(start);
    effect.sourceRing.scale.setScalar(electric ? 0.08 + power * 0.03 : 0.12 + power * 0.055);
    effect.sourceScale = electric ? 0.08 + power * 0.03 : 0.12 + power * 0.055;
    effect.ringsVisible = options.rings !== false;
    effect.ring.visible = effect.ringsVisible;
    effect.sourceRing.visible = effect.ringsVisible;
    effect.lightPower = electric ? 0.5 + power * 0.9 : 1.35 + power * 2.8;
    effect.flickerSeed = Math.random() * 1000;

    effect.life = (options.life ?? (electric ? 0.075 : (lowEndLateWave ? 0.12 : 0.18))) + power * (electric ? 0.022 : (lowEndLateWave ? 0.028 : 0.048));
    effect.maxLife = effect.life;

    // Store for animated path reshuffling on electric bolts
    if (electric) {
      effect.startPos = start.clone();
      effect.endPos   = end.clone();
      effect.electricSegments = options.segments ?? (lowEndLateWave ? 5 : 8);
      effect.electricJitter   = options.jitter   ?? (0.14 + power * 0.07);
      effect.electricLift     = options.lift     ?? 0.035;
      effect.reshuffleTimer   = 0.013 + Math.random() * 0.010;
    }

    lightningEffects.push(effect);
  }

  function getRandomOpenStrikePoint(enemy, maxRange) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.4 + Math.random() * Math.max(3.5, maxRange - 2.4);
      const x = enemy.mesh.position.x + Math.cos(angle) * radius;
      const z = enemy.mesh.position.z + Math.sin(angle) * radius;
      const c = worldToMap(x, z);
      if (isOpenCell(c.mx, c.my) && !wallAtWorldRadius(x, z, 0.55) && !propBlocksAt(x, z, 0.25)) {
        return new THREE.Vector3(x, 0.05, z);
      }
    }

    const angle = Math.random() * Math.PI * 2;
    return new THREE.Vector3(
      enemy.mesh.position.x + Math.cos(angle) * 4.5,
      0.05,
      enemy.mesh.position.z + Math.sin(angle) * 4.5
    );
  }

  function getChaoticSiegeStrikePoint(enemy, px, pz, spec) {
    const playerBias = spec.playerBias ?? 0.25;
    const range = spec.range;

    for (let i = 0; i < 10; i++) {
      const nearPlayer = Math.random() < playerBias;
      const angle = Math.random() * Math.PI * 2;
      const radius = nearPlayer
        ? 0.1 + Math.pow(Math.random(), 0.38) * 1.2
        : 1.8 + Math.pow(Math.random(), 0.72) * Math.max(2.6, range - 1.8);
      const centerX = nearPlayer ? px : enemy.mesh.position.x;
      const centerZ = nearPlayer ? pz : enemy.mesh.position.z;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      if (Math.hypot(x - enemy.mesh.position.x, z - enemy.mesh.position.z) > range) continue;

      const c = worldToMap(x, z);
      if (isOpenCell(c.mx, c.my) && !wallAtWorldRadius(x, z, 0.5) && !propBlocksAt(x, z, 0.22)) {
        const y = nearPlayer && Math.random() < 0.24
          ? PLAYER_H * (0.26 + Math.random() * 0.58)
          : 0.05 + Math.random() * 0.22;
        return new THREE.Vector3(x, y, z);
      }
    }

    return getRandomOpenStrikePoint(enemy, range);
  }

  function getTeslaStrikeOrigin(enemy, index, target) {
    const nodes = enemy.mesh.userData.teslaNodes;
    const node = nodes?.length ? nodes[index % nodes.length] : enemy.mesh.userData.lightningNode;
    if (node) node.getWorldPosition(target);
    else target.set(enemy.mesh.position.x, enemy.mesh.position.y + 1.35, enemy.mesh.position.z);
    return target;
  }

  function getActiveLightningDroneCount() {
    // Phase 2 ECS: first system migrated off the raw `enemies[]` array onto the
    // Miniplex archetype query. The query holds the SAME enemy objects (the
    // register/unregister seam keeps it in lock-step), so this is behaviourally
    // identical — it's the proof-of-pattern for iterating `world.with(...)`.
    let count = 0;
    for (const enemy of liveEnemies) {
      if (enemy.lightning && enemy.aggroed) count++; // `live` archetype = alive already
    }
    return count;
  }

  function getLightningVisualProfile(enemy, dist) {
    const activeCount = getActiveLightningDroneCount();
    const crowdT = clamp01((activeCount - LIGHTNING_FULL_QUALITY_DRONES) / 7);
    const nearT = clamp01((18 - dist) / 18);
    const quality = clamp(1 - crowdT * 0.52 + nearT * 0.16, 0.34, 1);
    const effectPressure = clamp01(lightningEffects.length / LIGHTNING_MAX_VISIBLE_EFFECTS);
    const full = lightningEffects.length < LIGHTNING_MAX_VISIBLE_EFFECTS && (quality > 0.82 || Math.random() < quality * (0.62 - effectPressure * 0.28));

    return {
      activeCount,
      crowdT,
      quality,
      full,
      intervalMul: 0.82 + crowdT * 1.25 + effectPressure * 0.75 + (dist > 18 ? 0.28 : 0),
      coronaChance: (0.72 - crowdT * 0.20) * (1 - effectPressure * 0.35),
      mainSegments: full ? 16 : 8,
      mainBranches: full ? 2 : 1,
      sourceBranches: full ? 3 : 1,
      rings: false,
    };
  }

  function getCoopEnemyTarget(enemy, localPx = yaw.position.x, localPz = yaw.position.z) {
    const localTarget = {
      id: myNetId || "local",
      local: true,
      x: localPx,
      y: yaw.position.y,
      z: localPz,
      vx: ai.playerVelX || 0,
      vz: ai.playerVelZ || 0,
      hp: player.hp,
    };
    if (!isCoopHost() || remotePlayers.size === 0) return localTarget;

    let best = localTarget;
    let bestDist = Math.hypot(localPx - enemy.mesh.position.x, localPz - enemy.mesh.position.z);
    for (const avatar of remotePlayers.values()) {
      if (!avatar || avatar.hp <= 0) continue;
      const x = avatar.root?.position?.x ?? avatar.target?.x;
      const z = avatar.root?.position?.z ?? avatar.target?.z;
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const dist = Math.hypot(x - enemy.mesh.position.x, z - enemy.mesh.position.z);
      if (dist >= bestDist) continue;
      bestDist = dist;
      best = {
        id: avatar.id,
        local: false,
        x,
        y: (avatar.root?.position?.y || 0) + PLAYER_H,
        z,
        vx: avatar.runtime?.vx || 0,
        vz: avatar.runtime?.vz || 0,
        hp: avatar.hp,
      };
    }
    return best;
  }

  function applyCoopTargetDamage(targetInfo, amount, options: any = {}) {
    if (targetInfo && targetInfo.local === false && isCoopHost() && targetInfo.id) {
      net.send({
        t: "edamage",
        id: myNetId,
        seq: nextNetSeq(),
        sentAt: Math.round(performance.now()),
        target: targetInfo.id,
        dmg: +Math.max(0, amount || 0).toFixed(2),
        stamina: +Math.max(0, options.staminaDamage || 0).toFixed(2),
      });
      return false;
    }
    damagePlayer(amount, options);
    return true;
  }

  function broadcastCoopFx(fx, payload: any = {}) {
    if (!isCoopHost()) return;
    net.send({ t: "fx", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), fx, ...payload });
  }

  function ensureCoopEnemyNetId(enemy) {
    if (!enemy) return null;
    if (enemy.netId == null) enemy.netId = nextEnemyNetId++;
    return enemy.netId;
  }

  function broadcastCoopLightningFx(start, end, power, options: any = {}) {
    if (!isCoopHost()) return;
    net.send({
      t: "fx",
      id: myNetId,
      seq: nextNetSeq(),
      sentAt: Math.round(performance.now()),
      fx: "lightning",
      enemy: options.enemy ?? null,
      sx: +start.x.toFixed(2), sy: +start.y.toFixed(2), sz: +start.z.toFixed(2),
      ex: +end.x.toFixed(2), ey: +end.y.toFixed(2), ez: +end.z.toFixed(2),
      power: +power.toFixed(2),
      segments: options.segments || 8,
      branches: options.branches || 1,
      sourceBranches: options.sourceBranches || 1,
      jitter: +(options.jitter || 0.14).toFixed(3),
      lift: +(options.lift || 0.04).toFixed(3),
      life: +(options.life || 0.05).toFixed(3),
      electric: options.electric !== false,
      rings: !!options.rings,
    });
  }

  function broadcastCoopTracerFx(start, end, gunType, options: any = {}) {
    broadcastCoopFx("tracer", {
      enemy: options.enemy ?? null,
      gun: gunType,
      ox: +start.x.toFixed(2), oy: +start.y.toFixed(2), oz: +start.z.toFixed(2),
      ex: +end.x.toFixed(2), ey: +end.y.toFixed(2), ez: +end.z.toFixed(2),
      life: options.life ? +options.life.toFixed(3) : undefined,
      thick: options.thick ? +options.thick.toFixed(2) : undefined,
    });
  }

  // Shared "the player just got zapped" feedback.
  function wardenAttackHitFeedback(targetInfo, shake) {
    if (targetInfo && targetInfo.local === false) return;
    cameraFX.damageShake = Math.min(1, cameraFX.damageShake + shake);
    player.killStreak = 0;
    updateStreak();
    showDamageFlash();
    sfxDamage();
    if (player.hp <= 0 && !player.unlimitedHealth) endGame("dead");
  }

  // Corona flair — a couple of short arcs crackling around the Warden's tesla nodes.
  function spawnWardenCorona(enemy, nodes, count = 2) {
    const coronaCount = Math.min(count, nodes.length || 1);
    for (let i = 0; i < coronaCount; i++) {
      getTeslaStrikeOrigin(enemy, i, enemyShotOriginTmp);
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.6 + Math.random() * 0.9;
      teslaBranchTmp.set(
        enemyShotOriginTmp.x + Math.cos(angle) * radius,
        Math.max(0.2, enemyShotOriginTmp.y + (Math.random() - 0.5) * 0.6),
        enemyShotOriginTmp.z + Math.sin(angle) * radius
      );
      const opts = { segments: 6, branches: 2, sourceBranches: 1, jitter: 0.25, lift: 0.03, life: 0.06, rings: false, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS };
      spawnLightningEffect(enemyShotOriginTmp, teslaBranchTmp, 0.6 + Math.random() * 0.3, opts);
      broadcastCoopLightningFx(enemyShotOriginTmp, teslaBranchTmp, 0.6, { enemy: ensureCoopEnemyNetId(enemy), ...opts });
    }
  }

  // ── ARC LANCE ─────────────────────────────────────────────────────────────
  // Ranged signature attack: a single decisive bolt fired straight down the
  // Warden's sightline at the aim point it locked when the telegraph began. Forks
  // rake the ground around the impact. Dodgeable — the aim is committed up front.
  function fireWardenArcLance(enemy, px, pz, spec, targetInfo, canDamagePlayer, nodes) {
    const aimX = Number.isFinite(enemy.lightningAimX) ? enemy.lightningAimX : px;
    const aimZ = Number.isFinite(enemy.lightningAimZ) ? enemy.lightningAimZ : pz;
    enemy.lightningAimX = null;
    enemy.lightningAimZ = null;
    lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.34);

    getTeslaStrikeOrigin(enemy, 0, enemyShotOriginTmp);       // crown node
    lanceAimTmp.set(aimX, 0.06, aimZ);                        // ground impact under aim
    const mainOpts = { segments: 16, branches: 6, sourceBranches: 3, jitter: 0.22, lift: 0.05, life: 0.12, rings: true, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS };
    spawnLightningEffect(enemyShotOriginTmp, lanceAimTmp, 1.8, mainOpts);
    broadcastCoopLightningFx(enemyShotOriginTmp, lanceAimTmp, 1.8, { enemy: ensureCoopEnemyNetId(enemy), ...mainOpts });
    spawnImpactParticles(new THREE.Vector3(aimX, 0.05, aimZ), lanceUpTmp, 1.8);

    // Secondary forks from the arm/keel nodes rake outward from the impact.
    for (let i = 1; i < Math.min(3, nodes.length); i++) {
      getTeslaStrikeOrigin(enemy, i, enemyShotOriginTmp);
      teslaBranchTmp.set(aimX + (Math.random() - 0.5) * 2.6, 0.06, aimZ + (Math.random() - 0.5) * 2.6);
      const forkOpts = { segments: 10, branches: 3, sourceBranches: 1, jitter: 0.3, lift: 0.05, life: 0.08, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS };
      spawnLightningEffect(enemyShotOriginTmp, teslaBranchTmp, 1.1, forkOpts);
      broadcastCoopLightningFx(enemyShotOriginTmp, teslaBranchTmp, 1.1, { enemy: ensureCoopEnemyNetId(enemy), ...forkOpts });
    }

    // Damage: player must be within the impact radius of the locked aim point.
    // Judgment Lance: the long 0.85s telegraph buys a harder, HONEST hit — tight
    // radius (what the ring showed is what strikes), higher base damage.
    if (canDamagePlayer) {
      const hitDist = Math.hypot(px - aimX, pz - aimZ);
      const radius = spec.radius + 0.2;
      if (hitDist < radius) {
        const damageT = 1 - hitDist / radius;
        const dmg = (spec.damage[0] + Math.floor(Math.random() * (spec.damage[1] - spec.damage[0] + 1))) * (0.9 + damageT * 0.7);
        const localHit = applyCoopTargetDamage(targetInfo, dmg, { staminaDamage: 16 * damageT });
        if (localHit) wardenAttackHitFeedback(targetInfo, 0.7 + damageT * 0.5);
        enemy.lightningDamageTimer = spec.damageInterval ?? 0.4;
      }
    }
  }

  // ── STORM NOVA ────────────────────────────────────────────────────────────
  // Close-range signature attack: the Warden overloads its reactor and discharges
  // a radial burst of lightning in every direction, punishing the player for
  // crowding it. Radius damage with distance falloff.
  function fireWardenStormNova(enemy, px, pz, spec, targetInfo, canDamagePlayer, nodes) {
    lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.6);
    enemy.attackPulse = Math.max(enemy.attackPulse, 1.3);
    const cx = enemy.mesh.position.x;
    const cz = enemy.mesh.position.z;
    const novaRadius = Math.max(5.0, spec.radius * 4.0);
    getTeslaStrikeOrigin(enemy, 0, enemyShotOriginTmp);       // core discharge point

    // BULWARK DISCHARGE: 5 spokes (bolt-budget friendly) + a physical shove — the
    // Warden violently reclaims its personal space instead of just ticking damage.
    const spokes = 5;
    for (let i = 0; i < spokes; i++) {
      const angle = (i / spokes) * Math.PI * 2 + Math.random() * 0.25;
      const reach = novaRadius * (0.7 + Math.random() * 0.3);
      teslaBranchTmp.set(cx + Math.cos(angle) * reach, 0.06, cz + Math.sin(angle) * reach);
      const opts = { segments: 9, branches: 2, sourceBranches: 1, jitter: 0.34, lift: 0.04, life: 0.09, rings: i === 0, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS };
      spawnLightningEffect(enemyShotOriginTmp, teslaBranchTmp, 1.2, opts);
      if (i % 2 === 0) broadcastCoopLightningFx(enemyShotOriginTmp, teslaBranchTmp, 1.2, { enemy: ensureCoopEnemyNetId(enemy), ...opts });
    }
    spawnImpactParticles(new THREE.Vector3(cx, 0.05, cz), lanceUpTmp, 2.6);

    if (canDamagePlayer) {
      const hitDist = Math.hypot(px - cx, pz - cz);
      if (hitDist < novaRadius) {
        const damageT = 1 - hitDist / novaRadius;
        const dmg = (spec.damage[0] + Math.floor(Math.random() * (spec.damage[1] - spec.damage[0] + 1))) * (0.5 + damageT * 0.9);
        const localHit = applyCoopTargetDamage(targetInfo, dmg, { staminaDamage: 30 * damageT });
        if (localHit) {
          wardenAttackHitFeedback(targetInfo, 0.85 + damageT * 0.55);
          // Knockback: shove the player straight away from the Warden. The smoothed
          // player velocity integrates the impulse, so it reads as a real blast.
          const push = 6 + damageT * 4;
          const invD = hitDist > 0.05 ? 1 / hitDist : 0;
          player.velX = (player.velX || 0) + (px - cx) * invD * push;
          player.velZ = (player.velZ || 0) + (pz - cz) * invD * push;
        }
        enemy.lightningDamageTimer = spec.damageInterval ?? 0.4;
      }
    }
  }

  function fireSiegeLightning(enemy, px, pz, targetInfo = null) {
    if (!enemy.lightning) return;
    const spec = enemy.lightning;

    // Attack-wide state: single decisive discharge on the cooldown, no stream spam.
    enemy.lightningStreamTimer = spec.cooldown || 4.0;
    enemy.attackPulse = Math.max(enemy.attackPulse, 1.0);
    enemy.lungeBoost = Math.max(enemy.lungeBoost, 0.45);
    enemy.liftPhase = Math.max(enemy.liftPhase || 0, 0.5);
    enemy.liftDuration = Math.max(enemy.liftDuration || 0, 0.8);
    enemy.isAttacking = true;

    const canDamagePlayer = (enemy.lightningDamageTimer || 0) <= 0;
    const nodes = enemy.mesh.userData.teslaNodes || [enemy.mesh.userData.lightningNode].filter(Boolean);
    const dist = Math.hypot(px - enemy.mesh.position.x, pz - enemy.mesh.position.z);

    spawnWardenCorona(enemy, nodes, 2);

    // Close → radial nova (punish crowding); otherwise → aimed arc lance.
    if (dist < 6.2) fireWardenStormNova(enemy, px, pz, spec, targetInfo, canDamagePlayer, nodes);
    else fireWardenArcLance(enemy, px, pz, spec, targetInfo, canDamagePlayer, nodes);

    if ((enemy.lightningSfxTimer || 0) <= 0) {
      sfxLightning(enemy, 1.0);
      enemy.lightningSfxTimer = 0.32 + Math.random() * 0.15;
    }
  }

  // ── ROLLING BARRAGE (Warden signature) ──────────────────────────────────────
  // The Warden rises, flares its rod fan, and calls a line of 4 telegraphed sky
  // strikes that WALKS toward the player — classic creeping artillery. Each ring
  // charges 0.7s before its strike detonates; outrun the line perpendicular.
  function updateWardenBarrage(enemy, dt, px, pz, targetInfo) {
    enemy.barrageCooldown = Math.max(0, (enemy.barrageCooldown || 0) - dt);
    if (!enemy.barrageQueue) enemy.barrageQueue = [];
    const dist = Math.hypot(px - enemy.mesh.position.x, pz - enemy.mesh.position.z);

    if (!enemy.barrageActive && enemy.aggroed && enemy.barrageCooldown <= 0 && dist > 7 && dist < 26) {
      enemy.barrageActive = true;
      enemy.barrageSpawned = 0;
      enemy.barrageSpawnTimer = 0.35; // beat between the rise and the first ring
      enemy.barrageOriginX = enemy.mesh.position.x;
      enemy.barrageOriginZ = enemy.mesh.position.z;
      enemy.barrageTargetX = px;
      enemy.barrageTargetZ = pz;
      enemy.barrageCooldown = 11 + Math.random() * 3;
      enemy.liftPhase = Math.max(enemy.liftPhase || 0, 1.0);
      enemy.liftDuration = Math.max(enemy.liftDuration || 0, 2.4);
      enemy.attackPulse = Math.max(enemy.attackPulse, 1.2);
      lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.15);
    }
    if (!enemy.barrageActive) return;

    // Queue the 4 rings sequentially, walking from mid-line toward the player.
    enemy.barrageSpawnTimer -= dt;
    if (enemy.barrageSpawned < 4 && enemy.barrageSpawnTimer <= 0) {
      const i = enemy.barrageSpawned++;
      enemy.barrageSpawnTimer = 0.25;
      const t = 0.35 + (i / 3) * 0.65;
      const sx = enemy.barrageOriginX + (enemy.barrageTargetX - enemy.barrageOriginX) * t + (Math.random() - 0.5) * 2.4;
      const sz = enemy.barrageOriginZ + (enemy.barrageTargetZ - enemy.barrageOriginZ) * t + (Math.random() - 0.5) * 2.4;
      const ring = spawnTelegraphRing(sx, sz, 2.2, 0x77cfff, 0.7, { peak: 0.6 });
      enemy.barrageQueue.push({ x: sx, z: sz, t: 0.7, ring });
    }

    // Detonate strikes whose telegraph has elapsed.
    for (let i = enemy.barrageQueue.length - 1; i >= 0; i--) {
      const s = enemy.barrageQueue[i];
      s.t -= dt;
      if (s.t > 0) continue;
      enemy.barrageQueue.splice(i, 1);
      detonateTelegraphRing(s.ring);
      megaBlastOriginTmp.set(s.x, 34, s.z);
      megaBlastEndTmp.set(s.x, 0.06, s.z);
      const opts = { segments: 14, branches: 3, sourceBranches: 1, jitter: 0.18, lift: 0.05, life: 0.14, rings: true, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS };
      spawnLightningEffect(megaBlastOriginTmp, megaBlastEndTmp, 2.0, opts);
      broadcastCoopLightningFx(megaBlastOriginTmp, megaBlastEndTmp, 2.0, { enemy: ensureCoopEnemyNetId(enemy), ...opts });
      spawnImpactParticles(new THREE.Vector3(s.x, 0.05, s.z), lanceUpTmp, 3);
      lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.35);
      const hd = Math.hypot(px - s.x, pz - s.z);
      if (hd < 2.2) {
        const dmg = (24 + Math.random() * 10) * (0.6 + (1 - hd / 2.2) * 0.5);
        const localHit = applyCoopTargetDamage(targetInfo, dmg, { staminaDamage: 14 });
        if (localHit) {
          wardenAttackHitFeedback(targetInfo, 0.8);
          if (player.hp <= 0 && !player.unlimitedHealth) { endGame("dead"); return; }
        }
      } else if (hd < 8) {
        cameraFX.damageShake = Math.min(1, cameraFX.damageShake + 0.12); // near-miss concussion
      }
    }
    if (enemy.barrageSpawned >= 4 && enemy.barrageQueue.length === 0) enemy.barrageActive = false;
  }

  function findTeleportStrikeSpot(enemy, px, pz) {
    const spec = enemy.teleport;
    if (!spec) return null;
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = spec.minRange + Math.random() * Math.max(0.1, spec.maxRange - spec.minRange);
      const x = px + Math.cos(angle) * radius;
      const z = pz + Math.sin(angle) * radius;
      const cell = worldToMap(x, z);
      if (!isOpenCell(cell.mx, cell.my)) continue;
      if (wallAtWorldRadius(x, z, getEnemyCollisionRadius(enemy)) || propBlocksAt(x, z, getEnemyCollisionRadius(enemy), 0.1, PLAYER_H + 1)) continue;
      if (!hasLineOfSightWorld(x, z, px, pz, 0.16)) continue;
      return { x, z };
    }
    return null;
  }

  // Find a Blink Strike arrival point: 2.6–3.4m from the player, in their rear
  // flank (60–110° off their facing) — the Seraph reassembles where you AREN'T looking.
  function findBlinkFlankSpot(enemy, px, pz) {
    const facing = Math.atan2(-Math.cos(yaw.rotation.y), -Math.sin(yaw.rotation.y)); // player forward bearing
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const off = Math.PI - side * ((60 + Math.random() * 50) * Math.PI / 180); // rear hemisphere flank
      const ang = facing + off;
      const r = 2.6 + Math.random() * 0.8;
      const x = px + Math.cos(ang) * r;
      const z = pz + Math.sin(ang) * r;
      const cell = worldToMap(x, z);
      if (!isOpenCell(cell.mx, cell.my)) continue;
      if (wallAtWorldRadius(x, z, getEnemyCollisionRadius(enemy)) || propBlocksAt(x, z, getEnemyCollisionRadius(enemy), 0.1, PLAYER_H + 1)) continue;
      if (!hasLineOfSightWorld(x, z, px, pz, 0.16)) continue;
      return { x, z };
    }
    return findTeleportStrikeSpot(enemy, px, pz); // fallback: the old mid-range spot
  }

  // ── BLINK STRIKE (Seraph signature) ─────────────────────────────────────────
  // The teleport IS the attack: a 0.35s phase-out where the body visibly scatters
  // apart (storm_warden separation via enemy.phaseOut) while a small ring marks the
  // arrival point — pre-aim it! — then it reassembles out of the lightning at the
  // player's flank with a point-blank discharge, and immediately winds up a cast.
  function tryEnemyTeleport(enemy, px, pz, targetInfo = null, dt = 0.016) {
    if (!enemy.teleport) return false;

    // Phase-out in progress: count down, then execute the strike.
    if ((enemy.blinkHold || 0) > 0) {
      enemy.blinkHold = Math.max(0, enemy.blinkHold - dt);
      enemy.phaseOut = 1;
      if (enemy.blinkHold > 0) return true; // holds the rest of the attack pipeline this frame
      enemy.phaseOut = 0;

      const from = enemy.mesh.position.clone();
      const to = new THREE.Vector3(enemy.blinkDestX, enemy.mesh.position.y, enemy.blinkDestZ);
      enemy.mesh.position.x = enemy.blinkDestX;
      enemy.mesh.position.z = enemy.blinkDestZ;
      enemy.navPath = [];
      enemy.navTimer = 0;
      enemy.lastSeenX = px;
      enemy.lastSeenZ = pz;
      enemy.attackPulse = 1.2;
      enemy.lungeBoost = Math.max(enemy.lungeBoost, 0.55);
      lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.3);
      if (enemy.blinkRing) { detonateTelegraphRing(enemy.blinkRing); enemy.blinkRing = null; }

      // Travel arc + arrival burst: three short crackling bolts fan out from the
      // arrival point — the Seraph reassembles OUT of the lightning.
      spawnLightningEffect(from, to, 0.7, { segments: 5, branches: 1, sourceBranches: 1, jitter: 0.26, lift: 0.55, life: 0.08, rings: true });
      broadcastCoopLightningFx(from, to, 0.7, { enemy: ensureCoopEnemyNetId(enemy), segments: 5, branches: 1, sourceBranches: 1, jitter: 0.26, lift: 0.55, life: 0.08, rings: true });
      getTeslaStrikeOrigin(enemy, 0, enemyShotOriginTmp);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.random() * 0.4;
        teslaBranchTmp.set(enemy.mesh.position.x + Math.cos(a) * 1.6, 0.08, enemy.mesh.position.z + Math.sin(a) * 1.6);
        spawnLightningEffect(enemyShotOriginTmp, teslaBranchTmp, 0.7, { segments: 4, branches: 1, sourceBranches: 0, jitter: 0.2, lift: 0.04, life: 0.06, rings: false, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS });
      }
      spawnImpactParticles(new THREE.Vector3(enemy.mesh.position.x, 0.05, enemy.mesh.position.z), lanceUpTmp, 3);

      // Point-blank arrival discharge — punishes standing on the marked ring.
      const hd = Math.hypot(px - enemy.mesh.position.x, pz - enemy.mesh.position.z);
      if (hd < 2.0) {
        const dmg = 14 + Math.random() * 6;
        const localHit = applyCoopTargetDamage(targetInfo, dmg, { staminaDamage: 18 });
        if (localHit) {
          cameraFX.damageShake = Math.min(1, cameraFX.damageShake + 0.5);
          showDamageFlash({ opacity: 0.6, duration: 0.3, danger: true });
          if (player.hp <= 0 && !player.unlimitedHealth) { endGame("dead"); return true; }
        }
      }
      // Immediately wind up a cast from the new angle (goes through the standard
      // 0.45s telegraphed wind-up — dodgeable, unlike the old instant snipe).
      if (enemy.lightning) enemy.lightningStreamTimer = 0;
      return true;
    }

    if (enemy.teleportCooldown > 0 || !enemy.aggroed) return false;
    // Tactical trigger, not a blind timer: blink only when there's a REASON —
    // it's taking fire (escape), the player broke its attack band (reposition to
    // strike range), or its lightning is ready and it wants an angle to cast from.
    const dist = Math.hypot(px - enemy.mesh.position.x, pz - enemy.mesh.position.z);
    const underFire = (enemy.hitFlash || 0) > 0.1 || (enemy.hitStagger || 0) > 0.25;
    const bandBroken = dist > (enemy.teleport.maxRange + 3.5) || dist < (enemy.teleport.minRange - 1.6);
    const wantsCastAngle = !!enemy.lightning && (enemy.lightningStreamTimer || 0) <= 0.2 &&
      !hasLineOfSightWorld(enemy.mesh.position.x, enemy.mesh.position.z, px, pz, 0.22);
    if (!underFire && !bandBroken && !wantsCastAngle) return false;
    const spot = findBlinkFlankSpot(enemy, px, pz);
    if (!spot) {
      enemy.teleportCooldown = 1.2;
      return false;
    }
    // Begin the phase-out hold: body scatters, destination ring appears.
    enemy.blinkHold = 0.35;
    enemy.phaseOut = 1;
    enemy.blinkDestX = spot.x;
    enemy.blinkDestZ = spot.z;
    enemy.teleportCooldown = enemy.teleport.cooldown;
    enemy.attackPulse = Math.max(enemy.attackPulse, 1.2);
    if (enemy.blinkRing) releaseTelegraphRing(enemy.blinkRing);
    enemy.blinkRing = spawnTelegraphRing(spot.x, spot.z, 0.9, 0xb28cff, 0.35, { peak: 0.6 });
    return true;
  }

  function getMegaBlastOrigin(enemy, target) {
    const node = enemy.mesh.userData.lightningNode || enemy.mesh.userData.emitterCore || enemy.mesh;
    if (node?.getWorldPosition) node.getWorldPosition(target);
    else target.set(enemy.mesh.position.x, enemy.mesh.position.y + 1.2, enemy.mesh.position.z);
    return target;
  }

  function startMegaBlast(enemy, px = 0, pz = 0) {
    const spec = enemy.megaBlast;
    if (!spec) return;
    // SANCTUARY COLLAPSE: a safe circle appears on the player and SHRINKS over the
    // channel while drifting toward the Cherub — the strikes land everywhere BUT
    // inside it. Stay in the disc (and get dragged toward the caster) or take hits.
    if (enemy.sanctuaryRing) releaseTelegraphRing(enemy.sanctuaryRing);
    enemy.sanctX = px;
    enemy.sanctZ = pz;
    enemy.sanctR = 7.0;
    enemy.sanctuaryRing = spawnTelegraphRing(px, pz, 7.0, 0x62ffd6, 0.3, { peak: 0.42 });
    enemy.megaBlastTimer = spec.duration;
    enemy.megaBlastCooldown = 0;
    enemy.megaBlastDamageTimer = 0;
    enemy.megaBlastSfxTimer = 0;
    enemy.megaBlastImpactTimer = 0;
    // Record the horizontal angle toward the player so the spin starts facing them
    enemy.megaBlastSpinAngle = Math.atan2(pz - enemy.mesh.position.z, px - enemy.mesh.position.x);
    enemy.attackPulse = 1;
    enemy.isAttacking = true;
    enemy.lungeBoost = Math.max(enemy.lungeBoost, 0.38);
    enemy.liftPhase = Math.max(enemy.liftPhase || 0, 0.78);
    enemy.liftDuration = Math.max(enemy.liftDuration || 0, 0.95);
    lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 1.0);
    // Announce the channel: a big bolt from the Cherub straight up into the sky, so
    // the player immediately reads WHO is calling down the bombardment.
    getMegaBlastOrigin(enemy, megaBlastCasterTmp);
    megaBlastOriginTmp.set(enemy.mesh.position.x, 34, enemy.mesh.position.z);
    spawnLightningEffect(megaBlastCasterTmp, megaBlastOriginTmp, 2.2, { segments: 12, branches: 4, sourceBranches: 3, jitter: 0.24, lift: 0.1, life: 0.22, rings: false, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS });
    broadcastCoopLightningFx(megaBlastCasterTmp, megaBlastOriginTmp, 2.2, { enemy: ensureCoopEnemyNetId(enemy), segments: 12, branches: 4, sourceBranches: 3, jitter: 0.24, lift: 0.1, life: 0.22, rings: false, electric: true });
    sfxMegaBlastFire(enemy);
  }

  function updateNullCherubMegaBlast(enemy, dt, px, pz, dist, los, targetInfo = null) {
    const spec = enemy.megaBlast;
    if (!spec) return false;

    if (enemy.megaBlastTimer <= 0) {
      hideMegaBlast(enemy);
      enemy.megaBlastCooldown = Math.max(0, (enemy.megaBlastCooldown || 0) - dt);
      if (enemy.aggroed && los && dist <= spec.range && enemy.megaBlastCooldown <= 0) startMegaBlast(enemy, px, pz);
      else return false;
    }

    // ── SANCTUARY COLLAPSE ──
    // The Cherub bombards everything OUTSIDE a shrinking safe circle that drifts
    // toward it — the player must commit to standing in a closing disc that drags
    // them toward the caster. Leave the disc and the strikes bias directly onto you.
    const age = spec.duration - enemy.megaBlastTimer;
    const power = Math.min(clamp01(age / 0.3), clamp01(enemy.megaBlastTimer / 0.4));
    enemy.megaBlastTimer = Math.max(0, enemy.megaBlastTimer - dt);

    // Shrink + drift the sanctuary (rage tier collapses it further — "Tithe").
    if (enemy.sanctuaryRing) {
      const rage = enemy.maxHp > 0 && enemy.hp / enemy.maxHp < 0.4;
      const minR = rage ? 1.4 : 2.0;
      const shrinkT = clamp01(age / Math.max(0.001, spec.duration));
      enemy.sanctR = 7.0 + (minR - 7.0) * shrinkT;
      // Drift the safe zone toward the Cherub at ~1.2 m/s.
      const toCx = enemy.mesh.position.x - enemy.sanctX;
      const toCz = enemy.mesh.position.z - enemy.sanctZ;
      const toC = Math.hypot(toCx, toCz);
      if (toC > 0.05) {
        const step = Math.min(toC, 1.2 * dt);
        enemy.sanctX += (toCx / toC) * step;
        enemy.sanctZ += (toCz / toC) * step;
      }
      enemy.sanctuaryRing.radius = enemy.sanctR;
      enemy.sanctuaryRing.mesh.position.set(enemy.sanctX, 0.06, enemy.sanctZ);
    }
    enemy.attackPulse = Math.max(enemy.attackPulse, 0.9 * power);
    enemy.isAttacking = true;
    enemy.lungeBoost = Math.max(enemy.lungeBoost, 0.18 * power);
    lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.12 * power);
    hideMegaBlast(enemy);      // ensure the legacy beam mesh stays hidden
    enemy.netMegaBlast = null; // no beam to sync in co-op (strikes sync via lightning fx)

    enemy.megaBlastImpactTimer = Math.max(0, (enemy.megaBlastImpactTimer || 0) - dt);
    if (power > 0.12 && enemy.megaBlastImpactTimer <= 0) {
      enemy.megaBlastImpactTimer = 0.34; // strike cadence over the bombardment window
      // Sanctuary rule: player OUTSIDE the safe circle → strike right on them.
      // Player inside → strikes hammer the ring's edge and beyond, never within.
      let sxp, szp;
      const sr = enemy.sanctR || 0;
      const playerInside = sr > 0 && Math.hypot(px - enemy.sanctX, pz - enemy.sanctZ) <= sr;
      if (!playerInside) {
        sxp = px + (Math.random() - 0.5) * 1.6;
        szp = pz + (Math.random() - 0.5) * 1.6;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const rad = sr + 1.0 + Math.random() * 3.2;
        sxp = enemy.sanctX + Math.cos(ang) * rad;
        szp = enemy.sanctZ + Math.sin(ang) * rad;
      }
      megaBlastOriginTmp.set(sxp, 34, szp);   // bolt from high above
      megaBlastEndTmp.set(sxp, 0.06, szp);    // down to the ground
      const opts = { segments: 14, branches: 4, sourceBranches: 2, jitter: 0.18, lift: 0.05, life: 0.16, rings: true, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS };
      spawnLightningEffect(megaBlastOriginTmp, megaBlastEndTmp, 2.1, opts);
      broadcastCoopLightningFx(megaBlastOriginTmp, megaBlastEndTmp, 2.1, { enemy: ensureCoopEnemyNetId(enemy), ...opts });
      // Casting arc: cherub → the strike's sky origin, so every bolt visibly comes FROM it.
      getMegaBlastOrigin(enemy, megaBlastCasterTmp);
      spawnLightningEffect(megaBlastCasterTmp, megaBlastOriginTmp, 1.1, { segments: 8, branches: 2, sourceBranches: 2, jitter: 0.3, lift: 0.25, life: 0.13, rings: false, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS });
      spawnImpactParticles(new THREE.Vector3(sxp, 0.05, szp), impactNormalTmp.set(0, 1, 0), 2.4);
      lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.5);
      if (enemy.megaBlastSfxTimer <= 0) { sfxMegaBlastBeam(enemy, 0.9); enemy.megaBlastSfxTimer = 0.28; }

      // AOE damage if the player is within the strike radius at impact.
      const strikeRadius = 2.6;
      const hitDist = Math.hypot(px - sxp, pz - szp);
      if (hitDist < strikeRadius) {
        const dr = spec.damagePerSecond || [12, 16];
        const dmg = (dr[0] + Math.random() * Math.max(0, dr[1] - dr[0])) * (0.55 + (1 - hitDist / strikeRadius) * 0.5);
        const localHit = applyCoopTargetDamage(targetInfo, dmg, { staminaDamage: (spec.staminaDamagePerSecond || 0) * 0.22 });
        if (localHit) {
          cameraFX.damageShake = Math.min(1, cameraFX.damageShake + 0.42);
          player.killStreak = 0;
          updateStreak();
          showDamageFlash({ opacity: 0.82, duration: 0.36, danger: true });
          if (player.hp <= 0 && !player.unlimitedHealth) { endGame("dead"); return true; }
        }
      }
    }
    enemy.megaBlastSfxTimer = Math.max(0, (enemy.megaBlastSfxTimer || 0) - dt);

    if (enemy.megaBlastTimer <= 0) {
      hideMegaBlast(enemy);
      enemy.megaBlastCooldown = spec.cooldown;
      enemy.isAttacking = false;
      if (enemy.sanctuaryRing) { fadeTelegraphRing(enemy.sanctuaryRing); enemy.sanctuaryRing = null; }
      enemy.sanctR = 0;
    }
    return true;
  }

  function fireEmpBlast(enemy, px, pz, targetInfo = null, force = false) {
    if (!enemy.emp || enemy.empCooldown > 0 || !enemy.aggroed) return false;
    const spec = enemy.emp;
    const dist = Math.hypot(px - enemy.mesh.position.x, pz - enemy.mesh.position.z);
    if (!force && dist > spec.radius + 0.4) return false;

    // Tithe (rage tier <40% HP): the Null Field recharges much faster.
    const rageTier = enemy.maxHp > 0 && enemy.hp / enemy.maxHp < 0.4;
    enemy.empCooldown = spec.cooldown * (rageTier ? 0.64 : 1);
    enemy.attackPulse = 1;
    enemy.liftPhase = Math.max(enemy.liftPhase || 0, 0.58);
    enemy.liftDuration = Math.max(enemy.liftDuration || 0, 0.7);
    lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.28);

    const origin = enemyShotOriginTmp.set(enemy.mesh.position.x, enemy.mesh.position.y + 0.45, enemy.mesh.position.z);
    const arcCount = deviceProfile.tier === "low" ? 3 : 4;
    for (let i = 0; i < arcCount; i++) {
      const a = (i / arcCount) * Math.PI * 2 + Math.random() * 0.2;
      const end = new THREE.Vector3(
        enemy.mesh.position.x + Math.cos(a) * spec.radius,
        0.08 + Math.random() * 0.2,
        enemy.mesh.position.z + Math.sin(a) * spec.radius
      );
      spawnLightningEffect(origin, end, 0.38, { segments: 3, branches: 0, sourceBranches: 0, jitter: 0.12, lift: 0.08, life: 0.05, rings: false, maxActive: Math.min(5, LIGHTNING_MAX_VISIBLE_EFFECTS) });
      broadcastCoopLightningFx(origin, end, 0.38, { enemy: ensureCoopEnemyNetId(enemy), segments: 3, branches: 0, sourceBranches: 0, jitter: 0.12, lift: 0.08, life: 0.05 });
    }
    const variantCore = enemy.mesh.userData.variantCore;
    if (variantCore) variantCore.scale.setScalar(1.35);

    const clearBlastPath = hasLineOfSightWorld(enemy.mesh.position.x, enemy.mesh.position.z, px, pz, 0.18);
    if (dist <= spec.radius && clearBlastPath) {
      const damageT = 1 - dist / spec.radius;
      const dmg = (spec.damage[0] + Math.floor(Math.random() * (spec.damage[1] - spec.damage[0] + 1))) * (0.55 + damageT * 0.65);
      const localHit = applyCoopTargetDamage(targetInfo, dmg, { staminaDamage: spec.staminaDamage * (0.45 + damageT * 0.75) });
      if (localHit) {
        // NULL debuff: sprint and reload are disabled for 2.5s (checked in the
        // movement + reload code) — the Cherub un-equips you, it doesn't out-DPS you.
        player.nullLockTimer = 2.5;
        cameraFX.damageShake = Math.min(1, cameraFX.damageShake + 0.46 + damageT * 0.34);
        player.killStreak = 0;
        updateStreak();
        showDamageFlash({ opacity: 0.5, duration: 0.4, danger: true });
        sfxDamage();
        addKillFeed("NULL FIELD — SYSTEMS SUPPRESSED");
        if (player.hp <= 0 && !player.unlimitedHealth) endGame("dead");
      }
    }
    sfxLightning(enemy, 0.46);
    return true;
  }

  function updateLightningEffects(dt) {
    for (let i = lightningEffects.length - 1; i >= 0; i--) {
      const effect = lightningEffects[i];
      effect.life -= dt;

      // Re-randomize path geometry for animated crackling bolt appearance
      if (effect.reshuffleTimer !== undefined) {
        effect.reshuffleTimer -= dt;
        if (effect.reshuffleTimer <= 0 && effect.startPos && effect.endPos) {
          effect.reshuffleTimer = 0.012 + Math.random() * 0.010;
          effect.segmentCount = 0;
          const cnt = buildLightningPathScratch(
            effect.startPos, effect.endPos,
            effect.electricSegments,
            effect.electricJitter * (0.65 + Math.random() * 0.7),
            effect.electricLift
          );
          writeLightningPathFromScratch(effect, cnt);
          effect.geometry.setDrawRange(0, effect.segmentCount * 2);
          effect.geometry.attributes.position.needsUpdate = true;
        }
      }

      const t = Math.max(0, effect.life / effect.maxLife);
      const age = 1 - t;
      // Stronger, faster flicker — randomized each frame for a true crackle feel
      const rawFlicker = 0.62 + Math.random() * 0.38 + Math.sin((performance.now() * 0.055 + effect.flickerSeed) * 14) * 0.18;
      const pulse = Math.max(0, Math.min(1.25, rawFlicker));
      effect.core.material.opacity     = Math.min(1.0,  t * pulse * 1.15);
      effect.glow.material.opacity     = Math.min(0.92, t * pulse * 0.96);
      effect.glowDots.material.opacity = Math.min(0.78, t * pulse * 0.85);
      effect.outer.material.opacity    = Math.min(0.55, t * pulse * 0.58);
      effect.ring.material.opacity        = effect.ringsVisible ? 0.52 * t * pulse : 0;
      effect.sourceRing.material.opacity  = effect.ringsVisible ? 0.42 * t * pulse : 0;
      effect.ring.scale.setScalar(effect.baseScale * (1 + age * (1.05 + pulse * 0.35)));
      effect.sourceRing.scale.setScalar(effect.sourceScale * (1 + age * (1.65 + pulse * 0.42)));

      // Drive the shared impact PointLight — same technique as gunFlash. All live bolts
      // share one light, so the brightest wins rather than the last one iterated.
      const want = t * effect.lightPower * pulse * 55;
      if (want > lightningLightPeak) {
        lightningLightPeak = want;
        lightningLightPos.copy(effect.impactPoint);
      }

      if (effect.life <= 0) {
        lightningEffects.splice(i, 1);
        recycleLightningEffect(effect);
      }
    }

    const boltLight = getSharedLightningLight();
    boltLight.intensity = lightningLightPeak;
    if (lightningLightPeak > 0) boltLight.position.copy(lightningLightPos);
    lightningLightPeak = 0;
  }

  function getClonedGhostMuzzleWorld(enemy, target) {
    const weaponRig = enemy.mesh.userData.clonedGhost?.weapon;
    if (weaponRig?.muzzle) return weaponRig.muzzle.getWorldPosition(target);
    return target.set(enemy.mesh.position.x, PLAYER_H * 0.72, enemy.mesh.position.z);
  }

  function updateClonedGhostWeaponPose(enemy, dt, dist, los) {
    const ghost = enemy.mesh.userData.clonedGhost;
    if (!ghost?.weapon?.gun) return;

    const root = enemy.mesh;
    const weaponRig = ghost.weapon;
    root.updateMatrixWorld(true);

    let rightReady = false;
    let leftReady = false;
    if (ghost.rightHand) {
      ghost.rightHand.getWorldPosition(ghostHandRightTmp);
      rightReady = Number.isFinite(ghostHandRightTmp.x);
    }
    if (ghost.leftHand) {
      ghost.leftHand.getWorldPosition(ghostHandLeftTmp);
      leftReady = Number.isFinite(ghostHandLeftTmp.x);
    }
    if (!rightReady || !leftReady) {
      ghostHandRightTmp.set(0.36, 1.1, -0.32);
      ghostHandLeftTmp.set(-0.28, 1.06, -0.22);
      root.localToWorld(ghostHandRightTmp);
      root.localToWorld(ghostHandLeftTmp);
    }

    ghostHandCenterTmp.copy(ghostHandLeftTmp).add(ghostHandRightTmp).multiplyScalar(0.5);
    root.worldToLocal(ghostLocalTmp.copy(ghostHandCenterTmp));
    ghostLocalTmp.z -= 0.2;
    ghostLocalTmp.y += 0.05;
    ghostLocalTmp.x += 0.02;

    const aimT = los ? clamp01((enemy.ranged?.range || 20) / Math.max(1, dist)) : 0;
    const targetPitch = Number.isFinite(ghost.netAimPitch)
      ? clamp(ghost.netAimPitch, -0.42, 0.42)
      : los
        ? clamp((yaw.position.y - (enemy.mesh.position.y + PLAYER_H * 0.72)) / Math.max(2, dist), -0.28, 0.22)
        : 0;
    ghost.aimPitch = dampValue(ghost.aimPitch || 0, targetPitch, 6.5, dt);
    weaponRig.gun.position.copy(ghostLocalTmp);
    weaponRig.gun.rotation.set(-ghost.aimPitch * 0.62, Math.PI * 0.5, -0.08 + (enemy.visualLean || 0) * 0.35);
    weaponRig.gun.scale.setScalar(0.55 + aimT * 0.06);

    ghost.muzzleTimer = Math.max(0, (ghost.muzzleTimer || 0) - dt);
    const flashT = clamp01(ghost.muzzleTimer / 0.08);
    const showFlash = flashT > 0;
    if (weaponRig.flash) {
      applyMuzzleFlashSprite(weaponRig.flash, showFlash, flashT, enemy.ranged?.gunType || GUNS.RIFLE, 0.9);
    }
    setPhysicalMuzzleFlash(weaponRig.muzzle, showFlash, flashT, 0.9);
  }

  function updateClonedGhostVisual(enemy, dt, movedX, movedZ, dist, los) {
    const ghost = enemy.mesh.userData.clonedGhost;
    if (!ghost) return;

    const moveSpeed = Math.hypot(movedX, movedZ) / Math.max(0.001, dt);
    enemy.visualSpeed = dampValue(enemy.visualSpeed || 0, moveSpeed, 8, dt);
    const speedT = clamp01(enemy.visualSpeed / Math.max(0.001, enemy.speed));
    // Derive locomotion state from actual world-space displacement (ghost.moveState is
    // never updated by the AI, so we project velocity into the enemy's local frame instead).
    const cosY = Math.cos(enemy.mesh.rotation.y);
    const sinY = Math.sin(enemy.mesh.rotation.y);
    const forwardSpeed = (movedX * sinY + movedZ * cosY) / Math.max(0.001, dt);
    const lateralSpeed = (movedX * cosY - movedZ * sinY) / Math.max(0.001, dt);
    const forwardNorm  = forwardSpeed  / Math.max(0.001, enemy.speed);
    const lateralNorm  = lateralSpeed  / Math.max(0.001, enemy.speed);
    enemy.visualLean = dampValue(enemy.visualLean || 0, clamp(-enemy.visualTurn * 0.014 - lateralNorm * 0.07, -0.15, 0.15), 5.5, dt);

    const sjmCfg = window.SJM?.config || {};
    const sprintThresh = sjmCfg.sprintThreshold || 0.42;
    const moving    = speedT > 0.08;
    const sprinting = speedT > sprintThresh;
    const strafing  = moving && !sprinting && Math.abs(lateralNorm) > Math.abs(forwardNorm) * 1.2;

    ghost.jumpCooldown = Math.max(0, (ghost.jumpCooldown || 0) - dt);
    ghost.jumpTimer    = Math.max(0, (ghost.jumpTimer    || 0) - dt);
    if (sprinting && ghost.jumpTimer <= 0 && ghost.jumpCooldown <= 0 && (enemy.avoidTimer > 0 || enemy.lungeBoost > 0.05)) {
      ghost.jumpTimer    = 0.54;
      ghost.jumpCooldown = 1.2 + Math.random() * 1.65;
    }
    const jumping = ghost.jumpTimer > 0;

    let targetAction = "idle";
    if (jumping) {
      targetAction = forwardNorm > 0.1 && ghost.actions.jumpForward ? "jumpForward" : "jump";
    } else if (sprinting) {
      targetAction = lateralNorm < -0.18 && ghost.actions.sprintLeft  ? "sprintLeft"
                   : lateralNorm >  0.18 && ghost.actions.sprintRight ? "sprintRight"
                   : ghost.actions.rifleRun ? "rifleRun" : "sprint";
    } else if ((ghost.muzzleTimer || 0) > 0.02) {
      targetAction = "fire";
    } else if (strafing) {
      targetAction = lateralNorm < -0.1 && ghost.actions.strafeAlt ? "strafeAlt" : "strafe";
    } else if (moving) {
      targetAction = forwardNorm < -0.1 ? (ghost.actions.walkBack ? "walkBack" : "walk") : "walk";
    }

    // Feed SJM diagnostic state (read by the F8 overlay in modules/sjm.js)
    ghost._diagState = { speed: enemy.visualSpeed, speedT, sprinting, strafing, jumping, moving, action: targetAction, dist };
    if (window.__sjmState) window.__sjmState.nearest = { diagState: ghost._diagState, actionsAvail: Object.keys(ghost.actions || {}) };
    setHumanoidEnemyAction(enemy, targetAction, targetAction === "fire" ? 0.04 : 0.14);
    if (ghost.activeAction) {
      const aFloor = sjmCfg.animScaleFloor  || 0.85;
      const aTop   = sjmCfg.animScaleSprint || 2.20;
      const actionSpeed = targetAction === "fire"
        ? 1.35
        : sprinting
          ? clamp(aFloor + speedT * (aTop - aFloor), aFloor, aTop)
          : targetAction === "strafe" || targetAction === "strafeAlt" || targetAction === "walkBack"
            ? clamp(0.9 + speedT * 0.65, aFloor, 1.8)
            : clamp(0.82 + speedT * 0.7, aFloor, 1.5);
      ghost.activeAction.timeScale = actionSpeed;
      ghost._diagState.timeScale = actionSpeed;
    }
    if (ghost.mixer) ghost.mixer.update(dt);

    if (ghost.model) {
      ghost.model.rotation.x = -ghost.aimPitch * 0.18 + enemy.attackPulse * 0.025;
      ghost.model.rotation.z = enemy.visualLean;
    }
    const jumpT = jumping ? 1 - ghost.jumpTimer / 0.54 : 0;
    const jumpArc = jumping ? Math.sin(clamp01(jumpT) * Math.PI) * 0.46 : 0;
    enemy.mesh.position.y = jumpArc;
    enemy.mesh.scale.setScalar(1 + enemy.attackPulse * 0.012);
    const aura = enemy.mesh.userData.clonedGhostAura;
    if (aura) {
      if (!enemy.alive) {
        for (const mat of aura.glowMaterials ?? []) mat.emissiveIntensity = Math.max(0.04, mat.emissiveIntensity - dt * 3.5);
        for (const ring of aura.scanRings ?? []) ring.matA.opacity = ring.matB.opacity = Math.max(0, ring.matA.opacity - dt * 2.5);
        if (aura.auraRing)  aura.auraRing.material.opacity = Math.max(0, aura.auraRing.material.opacity - dt * 3.0);
        if (aura.auraLight) aura.auraLight.intensity = Math.max(0, aura.auraLight.intensity - dt * 5.0);
      } else {
        const t = performance.now() * 0.001;
        const pulse = 0.65 + Math.sin(t * 1.7 + enemy.animSeed) * 0.28 + enemy.attackPulse * 0.35;

        // Emissive on model's own materials — glow follows model shape exactly
        const emissiveTarget = 0.30 + pulse * 0.55 + enemy.attackPulse * 0.65;
        for (const mat of aura.glowMaterials ?? []) mat.emissiveIntensity = emissiveTarget;

        // Scan rings cycling continuously up the body — energy flow animated effect
        for (const ring of aura.scanRings ?? []) {
          const cycleT = ((t * 0.55 + ring.phase) % 1.0);
          ring.group.position.y = cycleT * PLAYER_H;
          const brightness = Math.sin(cycleT * Math.PI) * (0.28 + enemy.attackPulse * 0.22);
          ring.matA.opacity = ring.matB.opacity = Math.max(0, brightness);
        }

        // Foot ring
        if (aura.auraRing) {
          aura.auraRing.rotation.z += dt * (2.2 + enemy.attackPulse * 3.5);
          aura.auraRing.scale.setScalar(0.9 + pulse * 0.12 + jumpArc * 0.16);
          aura.auraRing.material.opacity = 0.14 + pulse * 0.08;
        }

        // Point light
        if (aura.auraLight) aura.auraLight.intensity = 0.35 + pulse * 0.75 + enemy.attackPulse * 1.4;
      }
    }
    updateClonedGhostWeaponPose(enemy, dt, dist, los);
  }

  function fireClonedGhostShot(enemy, px, pz, targetInfo = null) {
    const spec = enemy.ranged;
    if (!spec) return;

    const burstLeft = enemy.botBurstShots || 0;
    if (burstLeft > 0) {
      enemy.botBurstShots = burstLeft - 1;
      enemy.rangedCooldown = spec.burstGap || 0.11;
    } else {
      const burstMin = spec.burst?.[0] ?? 1;
      const burstMax = spec.burst?.[1] ?? burstMin;
      enemy.botBurstShots = Math.max(0, burstMin + Math.floor(Math.random() * (burstMax - burstMin + 1)) - 1);
      enemy.rangedCooldown = spec.cooldown * (0.82 + Math.random() * 0.45);
    }

    enemy.attackPulse = Math.max(enemy.attackPulse, 0.76);
    enemy.lungeBoost = Math.max(enemy.lungeBoost, 0.16);
    enemy.mesh.userData.clonedGhost.muzzleTimer = 0.08;
    sfxClonedGhostShot(enemy);

    getClonedGhostMuzzleWorld(enemy, enemyShotOriginTmp);
    const dist = Math.hypot(px - enemy.mesh.position.x, pz - enemy.mesh.position.z);
    const accuracyDrift = (spec.aimJitter ?? 0.5) * (0.8 + clamp01(dist / Math.max(1, spec.range)) * 0.95);
    playerHitCenterTmp.set(
      px + (targetInfo?.vx ?? ai.playerVelX) * (spec.lead ?? 0.1),
      (targetInfo?.y ?? PLAYER_H) * (0.7 + Math.random() * 0.14),
      pz + (targetInfo?.vz ?? ai.playerVelZ) * (spec.lead ?? 0.1)
    );
    enemyShotTargetTmp.copy(playerHitCenterTmp);
    enemyShotTargetTmp.x += (Math.random() - 0.5) * accuracyDrift * 2.2;
    enemyShotTargetTmp.y += (Math.random() - 0.5) * accuracyDrift * 0.85;
    enemyShotTargetTmp.z += (Math.random() - 0.5) * accuracyDrift * 2.2;
    enemyShotDirTmp.copy(enemyShotTargetTmp).sub(enemyShotOriginTmp).normalize();

    const hitDist = raySphereDistance(enemyShotOriginTmp, enemyShotDirTmp, playerHitCenterTmp, player.radius * 1.18);
    const maxDist = spec.range;
    raycaster.set(enemyShotOriginTmp, enemyShotDirTmp);
    raycaster.far = maxDist;
    raycastHitsTmp.length = 0;
    raycaster.intersectObjects(wallMeshes, false, raycastHitsTmp);
    const wallDist = raycastHitsTmp.length ? raycastHitsTmp[0].distance : Infinity;
    raycaster.far = 42;
    const hitPlayer = hitDist <= maxDist && hitDist < wallDist;
    enemyShotEndTmp.copy(enemyShotOriginTmp).addScaledVector(enemyShotDirTmp, Math.min(hitPlayer ? hitDist : maxDist, wallDist));
    spawnBulletTracer(enemyShotOriginTmp, enemyShotEndTmp, spec.gunType || GUNS.RIFLE);
    broadcastCoopTracerFx(enemyShotOriginTmp, enemyShotEndTmp, spec.gunType || GUNS.RIFLE, { enemy: ensureCoopEnemyNetId(enemy) });

    if (hitPlayer) {
      const playerGunType = spec.gunType || GUNS.RIFLE;
      const playerBulletDamage = allGuns[playerGunType]?.damage ?? GUN_SPECS[playerGunType]?.damage ?? GUN_SPECS[GUNS.RIFLE].damage;
      const damage = playerBulletDamage / 10;
      const localHit = applyCoopTargetDamage(targetInfo, damage);
      if (localHit) {
        cameraFX.damageShake = Math.min(1, cameraFX.damageShake + 0.14);
        player.killStreak = 0;
        updateStreak();
        showDamageFlash({ opacity: 0.58, duration: 0.18, danger: true });
        sfxDamage();
        if (player.hp <= 0 && !player.unlimitedHealth) endGame("dead");
      }
    }
  }

  function fireEnemyShotgunBurst(enemy, px, pz, targetInfo = null) {
    if (!enemy.ranged) return;

    enemy.rangedCooldown = enemy.ranged.cooldown;
    enemy.attackPulse = Math.max(enemy.attackPulse, 0.85);
    enemy.lungeBoost = Math.max(enemy.lungeBoost, 0.25);
    sfxEnemyShotgun(enemy);

    const tankMuzzle = enemy.mesh.userData.tankMuzzle;
    const tankFlash = enemy.mesh.userData.tankFlash;
    if (tankMuzzle) {
      tankMuzzle.getWorldPosition(enemyShotOriginTmp);
      tankMuzzle.intensity = 22;
    } else {
      enemyShotOriginTmp.set(enemy.mesh.position.x, enemy.mesh.position.y + 0.08, enemy.mesh.position.z);
    }
    if (tankFlash) {
      tankFlash.visible = true;
      tankFlash.material.opacity = 1.0;
      tankFlash.scale.setScalar(1.35);
    }
    playerHitCenterTmp.set(px, (targetInfo?.y ?? PLAYER_H) * 0.86, pz);
    let totalDamage = 0;

    for (let i = 0; i < enemy.ranged.pellets; i++) {
      enemyShotTargetTmp.copy(playerHitCenterTmp);
      const spread = enemy.ranged.spread;
      enemyShotTargetTmp.x += (Math.random() - 0.5) * spread * 8;
      enemyShotTargetTmp.y += (Math.random() - 0.5) * spread * 4;
      enemyShotTargetTmp.z += (Math.random() - 0.5) * spread * 8;
      enemyShotDirTmp.copy(enemyShotTargetTmp).sub(enemyShotOriginTmp).normalize();

      const hitDist = raySphereDistance(enemyShotOriginTmp, enemyShotDirTmp, playerHitCenterTmp, player.radius * 1.35);
      const maxDist = enemy.ranged.range;
      raycaster.set(enemyShotOriginTmp, enemyShotDirTmp);
      raycaster.far = maxDist;
      raycastHitsTmp.length = 0;
      raycaster.intersectObjects(wallMeshes, false, raycastHitsTmp);
      const wallDist = raycastHitsTmp.length ? raycastHitsTmp[0].distance : Infinity;
      raycaster.far = 42;
      const hitPlayer = hitDist <= maxDist && hitDist < wallDist;
      enemyShotEndTmp.copy(enemyShotOriginTmp).addScaledVector(enemyShotDirTmp, Math.min(hitPlayer ? hitDist : maxDist, wallDist));
      spawnBulletTracer(enemyShotOriginTmp, enemyShotEndTmp, GUNS.SHOTGUN);
      broadcastCoopTracerFx(enemyShotOriginTmp, enemyShotEndTmp, GUNS.SHOTGUN, { enemy: ensureCoopEnemyNetId(enemy), life: 0.075, thick: 1.45 });
      const tracer = tracers[tracers.length - 1];
      if (tracer) {
        tracer.life = 0.075;
        tracer.maxLife = 0.075;
        tracer.baseOpacity = 0.88;
        tracer.line.scale.x *= 1.45;
        tracer.line.scale.z *= 1.45;
      }

      if (hitPlayer) {
        totalDamage += enemy.ranged.damage[0] + Math.floor(Math.random() * (enemy.ranged.damage[1] - enemy.ranged.damage[0] + 1));
      }
    }

    if (totalDamage > 0) {
      const localHit = applyCoopTargetDamage(targetInfo, totalDamage);
      if (localHit) {
        cameraFX.damageShake = Math.min(1, cameraFX.damageShake + 0.38);
        player.killStreak = 0;
        updateStreak();
        showDamageFlash({ opacity: 0.72, duration: 0.24, danger: true });
        sfxDamage();
        if (player.hp <= 0 && !player.unlimitedHealth) endGame("dead");
      }
    }
  }

  function updateParticles(dt) {
    const lowEndLateWave = lowEndMode && game.wave >= 6;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (lowEndLateWave && (i % 2) === 1) {
        p.life -= dt * 0.6;
        if (p.life <= 0) {
          recycleImpactParticle(p);
          particles.splice(i, 1);
        }
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        recycleImpactParticle(p);
        particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 8 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
    }
  }

  function updateDamageNumbers(dt) {
    for (let i = damageNumbers.length - 1; i >= 0; i--) {
      const dn = damageNumbers[i];
      dn.life -= dt;
      if (dn.life <= 0) {
        recycleDamageNumber(dn);
        damageNumbers.splice(i, 1);
        continue;
      }
      const age = 1 - dn.life / dn.maxLife;
      dn.vel.y -= 1.15 * dt;
      dn.sprite.position.addScaledVector(dn.vel, dt);
      const pop = 1 + Math.sin(Math.min(1, age * 4.2) * Math.PI) * 0.22;
      const fade = clamp01(dn.life / 0.22);
      dn.sprite.scale.set(dn.baseScaleX * pop, dn.baseScaleY * pop, 1);
      dn.sprite.material.opacity = fade;
    }
  }

  function updateTracers(dt) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        recycleTracer(t);
        tracers.splice(i, 1);
        continue;
      }
      t.line.material.opacity = Math.max(0, t.life / t.maxLife) * t.baseOpacity;
    }
  }

  function clearTransientScreenEffects() {
    player.hurtTimer = 0;
    game.hitMarkerTimer = 0;
    cameraFX.shake = 0;
    cameraFX.damageShake = 0;
    cameraFX.recoil = 0;
    cameraFX.recoilVel = 0;
    cameraFX.roll = 0;
    cameraFX.rollVel = 0;
    if (hud.damageVig) hud.damageVig.style.setProperty("opacity", "0", "important");
    if (hud.damageVig) hud.damageVig.style.setProperty("visibility", "hidden", "important");
    hud.hitMarker?.classList.remove("active");
  }

  function setUnlimitedHealth(enabled) {
    player.unlimitedHealth = enabled;
    if (enabled) {
      player.hp = player.maxHp;
      clearTransientScreenEffects();
    }
    addKillFeed(enabled ? "UNLIMITED HEALTH ON" : "UNLIMITED HEALTH OFF");
    updateHUD(0);
  }

  function setUnlimitedSprint(enabled) {
    player.unlimitedSprint = true;
    player.stamina = player.maxStamina;
    player.sprintExhausted = false;
    addKillFeed(enabled === false ? "UNLIMITED SPRINT LOCKED ON" : "UNLIMITED SPRINT ON");
    updateHUD(0);
  }

  function setUnlimitedAmmo(enabled) {
    player.unlimitedAmmo = enabled;
    if (enabled) {
      for (const gun of Object.values(allGuns)) {
        gun.mag = gun.magSize;
        gun.ammo = 240;
      }
    }
    addKillFeed(enabled ? "UNLIMITED AMMO ON" : "UNLIMITED AMMO OFF");
    updateHUD(0);
  }

  function getPackCost(gunType = currentGun) {
    const level = gunUpgradeLevels[gunType] || 0;
    return level >= MAX_PACK_LEVEL ? Infinity : 18 + level * 16;
  }

  function applyGunUpgradeStats(gunType, refill = false) {
    const state = allGuns[gunType];
    const spec = GUN_SPECS[gunType];
    if (!state || !spec) return;
    const level = gunUpgradeLevels[gunType] || 0;
    const oldMagSize = state.magSize || spec.magazine;
    state.damage = spec.damage * (1 + level * 0.32);
    state.magSize = spec.magazine + Math.floor(spec.magazine * level * 0.18);
    state.fireRate = spec.fireRate * Math.max(0.68, 1 - level * 0.055);
    state.reloadTime = spec.reloadTime * Math.max(0.72, 1 - level * 0.045);
    state.spread = spec.spread * Math.max(0.62, 1 - level * 0.065);
    state.displayName = level > 0 ? `${spec.name} MK${level + 1}` : spec.name;
    if (refill) {
      state.mag = state.magSize;
      state.ammo = Math.min(260, state.ammo + state.magSize * 2);
    } else if (state.mag > oldMagSize || state.mag > state.magSize) {
      state.mag = Math.min(state.mag, state.magSize);
    }
  }

  // Pack-a-Punch upgrade glow — level-based colour progression inspired by
  // CoD Zombies (gold → green → purple → galaxy blue → hot magenta). The metal
  // turns iridescent and emissive, intensifying with each tier.
  const PACK_GLOW_COLORS = [0x000000, 0xffcc33, 0x44ff77, 0xb84dff, 0x37e0ff, 0xff3fa6, 0xff6622, 0xffffff];
  function getPackGlowColor(level) {
    return PACK_GLOW_COLORS[Math.max(0, Math.min(level, PACK_GLOW_COLORS.length - 1))];
  }

  // Apply the persistent upgrade look to a first-person weapon viewmodel.
  function applyGunPackVisual(weaponObj, level) {
    const gun = weaponObj?.gun;
    const mats = gun?.userData?.packMats;
    if (!mats) return;
    const col = getPackGlowColor(level);
    for (const m of mats) {
      if (level <= 0) {
        m.emissive.setHex(m.userData.baseEmissive ?? 0x000000);
        m.emissiveIntensity = m.userData.baseEmissiveIntensity ?? 0.3;
        m.metalness = m.userData.baseMetalness ?? 0.7;
        m.roughness = m.userData.baseRoughness ?? 0.35;
      } else {
        m.emissive.setHex(col);
        m.emissiveIntensity = 0.5 + level * 0.34;
        m.metalness = Math.min(1, (m.userData.baseMetalness ?? 0.7) + 0.14);
        m.roughness = Math.max(0.08, (m.userData.baseRoughness ?? 0.35) - level * 0.04);
      }
      m.needsUpdate = true;
    }
    gun.userData.packLevel = level;
    gun.userData.packGlowBase = level > 0 ? 0.5 + level * 0.34 : 0;
  }

  // Refresh the glow on whichever viewmodel is currently equipped (e.g. after a
  // gun switch, so each weapon shows the level it was packed to).
  function refreshEquippedGunPackVisual() {
    applyGunPackVisual(weapon, gunUpgradeLevels[currentGun] || 0);
  }

  function resetPackProgress() {
    player.xp = 0;
    for (const gunType of Object.keys(gunUpgradeLevels)) {
      gunUpgradeLevels[gunType] = 0;
      applyGunUpgradeStats(gunType, false);
      // Strip the pack-a-punch glow from every cached viewmodel (FP and TP).
      const cached = firstPersonWeaponCache.get(gunType);
      if (cached) applyGunPackVisual(cached, 0);
      const cachedTp = thirdPersonWeaponCache.get(gunType);
      if (cachedTp) applyGunPackVisual(cachedTp, 0);
    }
    for (const effect of packUpgradeEffects) {
      scene.remove(effect.root);
      if (effect.linkBeam) scene.remove(effect.linkBeam);
    }
    packUpgradeEffects.length = 0;
  }

  function addPlayerXp(amount) {
    player.xp += Math.max(0, amount | 0);
  }

  function createPackStation() {
    if (packState.station) return;
    const center = mapToWorld(Math.floor(MAP_W * 0.5), Math.floor(MAP_H * 0.5));
    const root = new THREE.Group();
    root.name = "Pack-a-Punch Upgrade Station";
    // Open, visible spot in the central plaza (was at map centre / spawn where it read as
    // hidden). North of the spawn so it's in view; open cell, glows as a beacon.
    root.position.set(0, 0, 22);
    // Animated/interactive — keep out of the static instancing pass.
    root.userData.noInstancing = true;

    const baseMat  = new THREE.MeshStandardMaterial({ color: 0x0d1220, roughness: 0.36, metalness: 0.78, emissive: 0x040810, emissiveIntensity: 0.55 });
    const glowMat  = new THREE.MeshStandardMaterial({ color: 0x88ffff, emissive: 0x00ccff, emissiveIntensity: 3.2, roughness: 0.16, metalness: 0.08 });
    const trimMat  = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xcc7700, emissiveIntensity: 1.2, roughness: 0.26, metalness: 0.52 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xff88ff, emissive: 0xbb00dd, emissiveIntensity: 2.0, roughness: 0.20, metalness: 0.10 });

    // Stepped base platform
    const baseLow  = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.18, 1.55), baseMat);
    baseLow.position.y = 0.09;
    const baseMid  = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.15, 1.32), baseMat);
    baseMid.position.y = 0.255;
    const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.055, 1.38), trimMat);
    baseTrim.position.y = 0.34;

    // Main column body
    const column = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.42, 0.72), baseMat);
    column.position.y = 1.04;

    // Large holographic display screen
    const screen      = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.58, 0.038), glowMat);
    screen.position.set(0, 1.28, -0.38);
    const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.66, 0.022), trimMat);
    screenFrame.position.set(0, 1.28, -0.395);

    // Gold weapon slot with glow strip
    const slot     = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.10, 0.08), trimMat);
    slot.position.set(0, 0.74, -0.42);
    const slotGlow = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.035, 0.055), glowMat);
    slotGlow.position.set(0, 0.695, -0.43);

    // Side accent panels
    const sideAccL = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.72, 0.60), accentMat);
    sideAccL.position.set(-0.60, 1.02, 0);
    const sideAccR = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.72, 0.60), accentMat);
    sideAccR.position.set(0.60, 1.02, 0);

    // Three rotating rings — different speeds and axes
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.024, 10, 52), glowMat);
    ring1.rotation.x = Math.PI * 0.5;
    ring1.position.y = 1.95;

    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.018, 8, 44), trimMat);
    ring2.rotation.set(Math.PI * 0.5, 0, Math.PI * 0.22);
    ring2.position.y = 1.72;

    const ring3 = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.015, 8, 36), accentMat);
    ring3.rotation.set(Math.PI * 0.32, 0, 0);
    ring3.position.y = 1.50;

    // Corner energy pylons
    const pylonGeo  = new THREE.CylinderGeometry(0.040, 0.048, 1.62, 8);
    const pylonCapG = new THREE.SphereGeometry(0.058, 8, 6);
    for (const [cx, cz] of [[-0.76, -0.50], [0.76, -0.50], [-0.76, 0.30], [0.76, 0.30]]) {
      const pylon = new THREE.Mesh(pylonGeo, baseMat);
      pylon.position.set(cx, 1.01, cz);
      const cap = new THREE.Mesh(pylonCapG, glowMat);
      cap.position.set(cx, 1.85, cz);
      root.add(pylon, cap);
    }

    // Holographic energy cylinder around the top assembly
    const holoCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.84, 0.84, 0.95, 36, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x22ddff, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    holoCyl.position.y = 1.65;
    holoCyl.userData.isDecor = true;

    // Outer ambient aura sphere
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    aura.position.y = 1.2;
    aura.userData.isDecor = true;

    // ── Iconic Pack-a-Punch energy elements ─────────────────────────────────
    // Central energy core — a bright pulsing column rising through the machine.
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xb84dff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const energyCore = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.16, 1.55, 16, 1, true), coreMat);
    energyCore.position.y = 1.45;
    energyCore.userData.isDecor = true;
    // Hot inner filament
    const coreInnerMat = new THREE.MeshBasicMaterial({ color: 0xffe6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreInner = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.62, 10, 1, true), coreInnerMat);
    coreInner.position.y = 1.45;
    coreInner.userData.isDecor = true;

    // Floating gold rune-halo that bobs and counter-spins above the column.
    const haloMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 2.6, roughness: 0.22, metalness: 0.85 });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.032, 10, 48), haloMat);
    halo.rotation.x = Math.PI * 0.5;
    halo.position.y = 2.18;
    halo.userData.isDecor = true;
    // Gold rune teeth around the halo for that arcane-machine read.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.05), haloMat);
      tooth.position.set(Math.cos(a) * 0.64, 2.18, Math.sin(a) * 0.64);
      tooth.userData.isDecor = true;
      root.add(tooth);
    }

    // Rising energy motes — soft sprites streaming up out of the core.
    const moteCanvas = document.createElement("canvas");
    moteCanvas.width = moteCanvas.height = 32;
    const moteCtx = moteCanvas.getContext("2d");
    const moteGrad = moteCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
    moteGrad.addColorStop(0, "rgba(255,235,255,1)");
    moteGrad.addColorStop(0.4, "rgba(190,90,255,0.6)");
    moteGrad.addColorStop(1, "rgba(120,40,255,0)");
    moteCtx.fillStyle = moteGrad;
    moteCtx.fillRect(0, 0, 32, 32);
    const moteTex = new THREE.CanvasTexture(moteCanvas);
    const motes = [];
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: moteTex, color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ang = Math.random() * Math.PI * 2;
      const rad = 0.12 + Math.random() * 0.22;
      sp.userData.ang = ang;
      sp.userData.rad = rad;
      sp.userData.phase = Math.random();       // 0..1 vertical progress
      sp.userData.speed = 0.18 + Math.random() * 0.22;
      sp.scale.setScalar(0.10 + Math.random() * 0.08);
      sp.userData.isDecor = true;
      root.add(sp);
      motes.push(sp);
    }

    // Point light for ambient illumination — purple energy glow.
    const stationLight = new THREE.PointLight(0xb84dff, 2.4, 6.5, 1.8);
    stationLight.position.y = 1.65;

    root.add(baseLow, baseMid, baseTrim, column, screen, screenFrame,
             slot, slotGlow, sideAccL, sideAccR,
             ring1, ring2, ring3, holoCyl, aura,
             energyCore, coreInner, halo, stationLight);

    root.userData.ring  = ring1;
    root.userData.ring2 = ring2;
    root.userData.ring3 = ring3;
    root.userData.holoCyl      = holoCyl;
    root.userData.stationLight = stationLight;
    root.userData.energyCore   = energyCore;
    root.userData.coreInner    = coreInner;
    root.userData.halo         = halo;
    root.userData.motes        = motes;

    root.traverse(obj => {
      if (obj.isMesh && !obj.userData.isDecor) {
        obj.castShadow    = false;
        obj.receiveShadow = true;
        wallMeshes.push(obj);
      }
    });
    scene.add(root);
    scene.userData.propColliders?.push({
      minX: root.position.x - 1.06,
      maxX: root.position.x + 1.06,
      minY: 0,
      maxY: 1.80,
      minZ: root.position.z - 0.66,
      maxZ: root.position.z + 0.66,
    });
    packState.station = root;
  }

  // Wall-buy crates and the horde beacon were removed. The perk machine is now
  // the plaza landmark statue itself — see loadWorldLandmarks, which anchors
  // perkMachineState.station to the loaded statue and collects its materials
  // for the purchasable emissive pulse (no prop geometry, no extra lights).

  function getPackBeamEndpoint(sourceId, target) {
    if (sourceId && sourceId !== myNetId) {
      const avatar = remotePlayers.get(sourceId);
      const ghost = avatar?.root?.userData?.clonedGhost;
      if (ghost?.weapon?.muzzle) return ghost.weapon.muzzle.getWorldPosition(target);
      if (avatar?.root) return target.set(avatar.root.position.x, avatar.root.position.y + PLAYER_H * 0.82, avatar.root.position.z);
    }
    const activeWeapon = getActiveWeaponForShot();
    if (activeWeapon?.muzzle) return activeWeapon.muzzle.getWorldPosition(target);
    camera.getWorldPosition(target);
    return target;
  }

  function spawnPackUpgradeEffect(gunType, nextLevel, options: any = {}) {
    // Station ring/shockwave burst removed by request — the upgrade now reads through
    // the gun's own pack animation (weaponAnim.packAnim spin + flash) and the
    // persistent colour glow (applyGunPackVisual). No world VFX is spawned.
    return;

    /* eslint-disable no-unreachable */
    if (!packState.station) return;

    const root = new THREE.Group();
    root.name = "Pack-a-Punch upgrade burst";
    root.position.copy(packState.station.position);
    root.position.y += 0.72;

    const beamMat = packBeamMaterial.clone();
    const beam = new THREE.Mesh(packBeamGeometry, beamMat);
    beam.position.y = 0.92;
    beam.scale.set(1.8, 2.4, 1.8);
    root.add(beam);

    // Second thicker beam for layered look
    const beam2Mat = packBeamMaterial.clone();
    beam2Mat.color = new THREE.Color(0xffcc44);
    const beam2 = new THREE.Mesh(packBeamGeometry, beam2Mat);
    beam2.position.y = 0.6;
    beam2.scale.set(0.9, 3.2, 0.9);
    root.add(beam2);

    // 10 expanding rings — more variety, bigger, spaced further
    const rings = [];
    const ringSpecs = [
      { mat: packBeamMaterial, op: 0.72, yOff: 0.05, scl: 0.42, tilt: Math.PI * 0.5 },
      { mat: packGoldMaterial, op: 0.85, yOff: 0.28, scl: 0.60, tilt: Math.PI * 0.5 },
      { mat: packBeamMaterial, op: 0.60, yOff: 0.55, scl: 0.74, tilt: Math.PI * 0.48 },
      { mat: null,             op: 0.78, yOff: 0.82, scl: 0.55, tilt: Math.PI * 0.38 }, // purple
      { mat: packGoldMaterial, op: 0.68, yOff: 1.10, scl: 0.46, tilt: Math.PI * 0.5  },
      { mat: packBeamMaterial, op: 0.55, yOff: 1.38, scl: 0.38, tilt: Math.PI * 0.44 },
      { mat: null,             op: 0.50, yOff: 1.62, scl: 0.30, tilt: Math.PI * 0.62 },
      { mat: packGoldMaterial, op: 0.44, yOff: 1.86, scl: 0.24, tilt: Math.PI * 0.5  },
      { mat: packBeamMaterial, op: 0.38, yOff: 2.10, scl: 0.18, tilt: Math.PI * 0.52 },
      { mat: null,             op: 0.32, yOff: 2.30, scl: 0.14, tilt: Math.PI * 0.46 },
    ];
    for (const spec of ringSpecs) {
      let mat;
      if (!spec.mat) {
        mat = new THREE.MeshBasicMaterial({ color: 0xff88ff, transparent: true, opacity: spec.op, blending: THREE.AdditiveBlending, depthWrite: false });
      } else {
        mat = spec.mat.clone();
        mat.opacity = spec.op;
      }
      const ring = new THREE.Mesh(packRingGeometry, mat);
      ring.rotation.x = spec.tilt;
      ring.rotation.z = Math.random() * Math.PI;
      ring.position.y = spec.yOff;
      ring.scale.setScalar(spec.scl);
      ring.userData.spin = (spec as any).spin || (3.4 + rings.length * 1.35) * (rings.length % 2 ? -1 : 1);
      root.add(ring);
      rings.push(ring);
    }

    // Primary shockwave ring — thin, fast-expanding
    const shockDisc = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1.0, 72),
      new THREE.MeshBasicMaterial({ color: 0x88ffff, transparent: true, opacity: 0.70, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    shockDisc.rotation.x = -Math.PI * 0.5;
    shockDisc.position.y = 0.04;
    root.add(shockDisc);

    // Secondary shockwave — slightly slower, gold tint
    const shockDisc2 = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.50, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    shockDisc2.rotation.x = -Math.PI * 0.5;
    shockDisc2.position.y = 0.06;
    root.add(shockDisc2);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    core.position.y = 1.02;
    root.add(core);

    // Inner hot core glow
    const innerCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0xffeeaa, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    innerCore.position.y = 1.02;
    root.add(innerCore);

    // Large spark burst — cyan, gold, white, purple
    const sparks = [];
    const sparkCount = lowEndMode ? 40 : 88;
    for (let i = 0; i < sparkCount; i++) {
      const rng = Math.random();
      const mat = rng < 0.35 ? packSparkMaterial.clone()
                : rng < 0.65 ? packGoldMaterial.clone()
                : (() => { const m = packSparkMaterial.clone(); m.color.setHex(0xff99ff); return m; })();
      const spark = new THREE.Mesh(packSparkGeometry, mat);
      const angle  = Math.random() * Math.PI * 2;
      const radius = 0.10 + Math.random() * 0.65;
      spark.position.set(Math.cos(angle) * radius, 0.10 + Math.random() * 2.2, Math.sin(angle) * radius);
      spark.userData.vel = new THREE.Vector3(
        Math.cos(angle) * (4.0 + Math.random() * 8.0),
        5.5 + Math.random() * 8.0,
        Math.sin(angle) * (4.0 + Math.random() * 8.0)
      );
      spark.userData.spin = (Math.random() - 0.5) * 22;
      root.add(spark);
      sparks.push(spark);
    }

    // Bright cyan flash light + warm secondary fill
    const light  = new THREE.PointLight(0x44ffff, 0, 32, 1.3);
    light.position.y = 1.35;
    const light2 = new THREE.PointLight(0xffcc44, 0, 20, 1.6);
    light2.position.set(0.4, 0.9, 0);
    root.add(light, light2);

    // Beam from station screen to player weapon
    const beamStart = new THREE.Vector3().copy(root.position).add(new THREE.Vector3(0, 0.88, -0.42));
    const beamEnd   = new THREE.Vector3();
    getPackBeamEndpoint(options.sourceId, beamEnd);
    const linkDir = beamEnd.clone().sub(beamStart);
    const linkLen = Math.max(0.001, linkDir.length());
    linkDir.multiplyScalar(1 / linkLen);
    const linkMat = packBeamMaterial.clone();
    linkMat.opacity = 0.88;
    const linkBeam = new THREE.Mesh(packBeamGeometry, linkMat);
    linkBeam.position.copy(beamStart).lerp(beamEnd, 0.5);
    linkBeam.quaternion.setFromUnitVectors(tracerUp, linkDir);
    linkBeam.scale.set(0.55, linkLen, 0.55);
    linkBeam.renderOrder = 9;
    scene.add(linkBeam);

    scene.add(root);
    packUpgradeEffects.push({
      root,
      beam,
      linkBeam,
      rings,
      shockDisc,
      shockDisc2,
      core,
      sparks,
      light,
      light2,
      life: 3.5,
      maxLife: 3.5,
      gunType,
      nextLevel,
      remote: !!options.remote,
    });

    lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 1.0);
    if (!options.remote) cameraFX.shake = Math.min(1, cameraFX.shake + 0.55);
    sfxPackUpgrade(nextLevel);
  }

  function updatePackUpgradeEffects(dt) {
    for (let i = packUpgradeEffects.length - 1; i >= 0; i--) {
      const effect = packUpgradeEffects[i];
      effect.life -= dt;
      const age  = effect.maxLife - effect.life;
      const t    = clamp01(age / effect.maxLife);
      const fade = clamp01(effect.life / Math.max(0.001, effect.maxLife));
      const pop  = Math.sin(Math.min(1, t * 1.55) * Math.PI);
      const pulseFast = 0.88 + Math.sin(performance.now() * 0.022) * 0.12;

      effect.root.rotation.y += dt * (3.2 + effect.nextLevel * 0.42);
      effect.beam.scale.x = 1.0 + pop * 2.2;
      effect.beam.scale.z = 1.0 + pop * 2.2;
      effect.beam.scale.y = 1.6 + pop * 1.8;
      effect.beam.material.opacity = fade * 0.68;

      if (effect.beam.material.color) effect.beam.material.color.setHSL(0.52 + Math.sin(age * 3.2) * 0.06, 1.0, 0.7);

      const beam2 = effect.root.children.find(c => c !== effect.beam && c.isMesh && c.geometry === packBeamGeometry);
      if (beam2) {
        beam2.scale.x = 0.5 + pop * 0.9;
        beam2.scale.z = 0.5 + pop * 0.9;
        beam2.scale.y = 2.0 + pop * 2.4;
        beam2.rotation.y += dt * 5.5;
        beam2.material.opacity = fade * 0.45;
      }

      if (effect.core) {
        effect.core.scale.setScalar(0.9 + pop * 2.8 + Math.sin(performance.now() * 0.034) * 0.14);
        effect.core.material.opacity = fade * (0.45 + pop * 0.75);
      }
      const innerCore = effect.root.children.find(c => c !== effect.core && c.isMesh && c.geometry?.type === "SphereGeometry" && c.material?.color?.getHex() === 0xffeeaa);
      if (innerCore) {
        innerCore.scale.setScalar(1.2 + pop * 3.5 + Math.sin(performance.now() * 0.052) * 0.2);
        innerCore.material.opacity = fade * (0.6 + pop * 0.5) * pulseFast;
      }
      if (effect.shockDisc) {
        const shockT = clamp01(t / 0.55);
        effect.shockDisc.scale.setScalar(0.30 + shockT * 9.5);
        effect.shockDisc.rotation.z -= dt * 2.2;
        effect.shockDisc.material.opacity = fade * Math.max(0, 0.70 - shockT * 0.68);
      }
      if (effect.shockDisc2) {
        const shockT2 = clamp01(t / 0.80);
        effect.shockDisc2.scale.setScalar(0.20 + shockT2 * 6.8);
        effect.shockDisc2.rotation.z += dt * 1.4;
        effect.shockDisc2.material.opacity = fade * Math.max(0, 0.50 - shockT2 * 0.46);
      }

      if (effect.linkBeam) {
        effect.linkBeam.scale.x = 0.30 + pop * 0.55;
        effect.linkBeam.scale.z = 0.30 + pop * 0.55;
        effect.linkBeam.material.opacity = fade * 0.68;
      }

      const lightPeak = 42 + effect.nextLevel * 8.0;
      effect.light.intensity  = fade * lightPeak * pulseFast;
      if (effect.light2) effect.light2.intensity = fade * 22 * pop;

      for (let r = 0; r < effect.rings.length; r++) {
        const ring  = effect.rings[r];
        const ringT = clamp01((t - r * 0.042) / 0.68);
        const scl   = 0.28 + ringT * (5.5 + r * 1.1);
        ring.scale.setScalar(scl);
        ring.rotation.z += dt * (ring.userData.spin || (4.8 + r * 1.8));
        ring.rotation.y += dt * (0.28 + r * 0.055);
        ring.rotation.x += dt * (0.12 + r * 0.022) * (r % 2 ? 1 : -1);
        ring.material.opacity = fade * (1 - ringT * 0.80) * (r === 1 || r === 4 ? 0.92 : 0.70);
      }

      for (const spark of effect.sparks) {
        spark.userData.vel.y -= 8.5 * dt;
        spark.position.addScaledVector(spark.userData.vel, dt);
        spark.rotation.y += spark.userData.spin * dt;
        spark.rotation.z -= spark.userData.spin * 0.65 * dt;
        spark.scale.setScalar(0.65 + pop * 2.4);
        spark.material.opacity = fade * 0.95;
      }

      if (effect.life <= 0) {
        scene.remove(effect.root);
        if (effect.linkBeam) {
          scene.remove(effect.linkBeam);
          effect.linkBeam.material?.dispose?.();
        }
        effect.root.traverse(obj => {
          if (!obj.isMesh) return;
          if (obj.material && obj.material !== packBeamMaterial && obj.material !== packGoldMaterial && obj.material !== packSparkMaterial) {
            obj.material.dispose?.();
          }
        });
        packUpgradeEffects.splice(i, 1);
      }
    }
  }

  function updatePackStation(dt) {
    if (!packState.station) return;
    const level = gunUpgradeLevels[currentGun] || 0;
    const cost = getPackCost(currentGun);
    const dist = Math.hypot(yaw.position.x - packState.station.position.x, yaw.position.z - packState.station.position.z);
    packState.active = dist < 2.75 && game.state === "playing";
    packState.prompt = packState.active
      ? level >= MAX_PACK_LEVEL
        ? "PACK-A-PUNCH MAXED"
        : player.xp >= cost
          ? `PRESS E: PACK-A-PUNCH ${GUN_SPECS[currentGun].name.toUpperCase()} (${cost} XP)`
          : `PACK-A-PUNCH NEEDS ${cost - player.xp} XP`
      : "";
    const remotePackActive = net?.active && gameMode === "coop" && [...remotePlayers.values()].some(a => a.runtime?.packActive);
    const visualActive = packState.active || remotePackActive;
    const now = performance.now();
    const ringPulse = 0.5 + Math.sin(now * 0.0048) * 0.5;
    if (packState.station.userData.ring) {
      packState.station.userData.ring.rotation.z += dt * (visualActive ? 2.35 : 1.35);
      packState.station.userData.ring.scale.setScalar(1 + ringPulse * (visualActive ? 0.06 : 0.025));
      if (packState.station.userData.ring.material) packState.station.userData.ring.material.emissiveIntensity = visualActive ? 3.8 + ringPulse * 1.2 : 2.4 + ringPulse * 0.45;
    }
    if (packState.station.userData.ring2) {
      packState.station.userData.ring2.rotation.z -= dt * (visualActive ? 1.65 : 0.9);
      packState.station.userData.ring2.scale.setScalar(1 + (1 - ringPulse) * (visualActive ? 0.05 : 0.018));
      if (packState.station.userData.ring2.material) packState.station.userData.ring2.material.emissiveIntensity = visualActive ? 1.8 + ringPulse * 0.8 : 1.05 + ringPulse * 0.3;
    }
    if (packState.station.userData.ring3) {
      packState.station.userData.ring3.rotation.x += dt * (visualActive ? 1.05 : 0.62);
      packState.station.userData.ring3.rotation.y += dt * (visualActive ? 0.82 : 0.42);
      packState.station.userData.ring3.scale.setScalar(1 + Math.sin(now * 0.0062) * (visualActive ? 0.045 : 0.015));
      if (packState.station.userData.ring3.material) packState.station.userData.ring3.material.emissiveIntensity = visualActive ? 2.8 + ringPulse * 1.0 : 1.7 + ringPulse * 0.35;
    }
    if (packState.station.userData.holoCyl) {
      packState.station.userData.holoCyl.material.opacity = visualActive
        ? 0.10 + Math.sin(now * 0.003) * 0.04
        : 0.030 + Math.sin(now * 0.0018) * 0.012;
    }
    if (packState.station.userData.stationLight) {
      packState.station.userData.stationLight.intensity = (visualActive ? 3.6 : 1.9) + Math.sin(now * 0.0042) * 0.6;
    }
    // Pulsing energy core
    const core = packState.station.userData.energyCore;
    if (core) {
      const corePulse = 0.7 + Math.sin(now * 0.009) * 0.3;
      core.material.opacity = (visualActive ? 0.85 : 0.55) * corePulse;
      core.scale.set(1 + corePulse * 0.12, 1, 1 + corePulse * 0.12);
      core.rotation.y += dt * 1.6;
    }
    const coreInner = packState.station.userData.coreInner;
    if (coreInner) {
      coreInner.material.opacity = (visualActive ? 0.95 : 0.7) * (0.6 + Math.sin(now * 0.014) * 0.4);
      coreInner.rotation.y -= dt * 2.4;
    }
    // Floating gold rune-halo — bob + counter-spin
    const halo = packState.station.userData.halo;
    if (halo) {
      halo.position.y = 2.18 + Math.sin(now * 0.0021) * 0.06;
      halo.rotation.z += dt * (visualActive ? 0.9 : 0.45);
      if (halo.material) halo.material.emissiveIntensity = visualActive ? 3.4 + ringPulse * 1.0 : 2.4 + ringPulse * 0.4;
    }
    // Rising energy motes — stream upward through the core and loop
    const motes = packState.station.userData.motes;
    if (motes) {
      const speedMul = visualActive ? 1.5 : 1.0;
      for (const sp of motes) {
        sp.userData.phase += dt * sp.userData.speed * speedMul;
        if (sp.userData.phase > 1) sp.userData.phase -= 1;
        const ph = sp.userData.phase;
        sp.userData.ang += dt * 0.6;
        sp.position.set(
          Math.cos(sp.userData.ang) * sp.userData.rad,
          0.7 + ph * 1.7,
          Math.sin(sp.userData.ang) * sp.userData.rad
        );
        // fade in at the bottom, out at the top
        sp.material.opacity = Math.sin(ph * Math.PI) * (visualActive ? 0.9 : 0.55);
      }
    }
    const pulse = 0.82 + Math.sin(now * 0.006) * 0.18;
    packState.station.scale.setScalar(visualActive ? 1.03 + pulse * 0.025 : 1);
  }

  // ── Mystery box (exterior weapon source) ────────────────────────────────────
  function createMysteryBox() {
    if (mysteryBoxState.station) return;
    const root = new THREE.Group();
    root.name = "Mystery Box";
    root.position.set(10, 0, 140); // old wall-buy crate spot
    root.rotation.y = -Math.PI * 0.15;
    root.userData.noInstancing = true; // animated/interactive — keep out of static merge

    // ── Materials (all created here so the boot compile pass links them; no lights) ──
    const woodMat  = new THREE.MeshStandardMaterial({ color: 0x2a1c0f, roughness: 0.82, metalness: 0.06, emissive: 0x0e0602, emissiveIntensity: 0.3 });
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x22160b, roughness: 0.88, metalness: 0.04 });
    const trimMat  = new THREE.MeshStandardMaterial({ color: 0xd8b256, roughness: 0.26, metalness: 0.82, emissive: 0x5a3c0a, emissiveIntensity: 0.5 });
    const glowMat  = new THREE.MeshStandardMaterial({ color: 0x8af0ff, emissive: 0x2ad0f4, emissiveIntensity: 2.2, roughness: 0.12, metalness: 0.05 });
    mysteryBoxState.glowMats = [glowMat, trimMat];

    const mesh = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

    // ── Chest body: a slightly tapered plank crate (narrower at the base reads more
    // "treasure chest" than a plain cube) with recessed plank grooves. ──
    const base = mesh(1.78, 0.78, 1.02, woodMat);
    base.position.y = 0.4;
    root.add(base);
    // Vertical plank grooves on the long faces (thin dark insets — cheap detail).
    for (const gx of [-0.58, -0.19, 0.19, 0.58]) {
      for (const gz of [0.515, -0.515]) {
        const groove = mesh(0.05, 0.66, 0.03, plankMat);
        groove.position.set(gx, 0.4, gz);
        root.add(groove);
      }
    }
    // Ornate gold CORNER BRACKETS (L-shaped) at all four vertical edges — the framed,
    // banded look of a real mystery chest instead of three flat bands.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = sx * 0.86, cz = sz * 0.48;
      for (const cy of [0.09, 0.71]) { // bottom + top corner caps
        const capA = mesh(0.12, 0.1, 0.2, trimMat); capA.position.set(cx, cy, cz - sz * 0.06); root.add(capA);
        const capB = mesh(0.2, 0.1, 0.12, trimMat); capB.position.set(cx - sx * 0.06, cy, cz); root.add(capB);
      }
      const post = mesh(0.08, 0.66, 0.08, trimMat); post.position.set(cx - sx * 0.02, 0.4, cz - sz * 0.02); root.add(post);
    }
    // Glowing arcane seam around the lid line.
    const seam = mesh(1.8, 0.05, 1.04, glowMat);
    seam.position.y = 0.79;
    root.add(seam);
    // Rivet studs along the top band (small gold dots).
    for (const rx of [-0.62, -0.21, 0.21, 0.62]) {
      const rivet = mesh(0.07, 0.07, 0.07, trimMat);
      rivet.position.set(rx, 0.72, 0.5);
      root.add(rivet);
    }

    // ── Iconic glowing "?" on the front face (built from boxes). ──
    const qMark = new THREE.Group();
    qMark.position.set(0, 0.42, 0.52);
    const qseg = (x, y, w, h) => { const m = mesh(w, h, 0.05, glowMat); m.position.set(x, y, 0); qMark.add(m); };
    qseg(-0.02, 0.20, 0.24, 0.055);  // top curve bar
    qseg(0.11, 0.12, 0.055, 0.14);   // upper-right down-stroke
    qseg(0.03, 0.03, 0.12, 0.055);   // inward hook
    qseg(0.0, -0.08, 0.055, 0.16);   // stem
    qseg(0.0, -0.21, 0.075, 0.075);  // dot
    root.add(qMark);
    mysteryBoxState.qMark = qMark;

    // Lid — hinged along the back edge (rotates about X), with a domed gold ridge.
    const lid = new THREE.Group();
    lid.position.set(0, 0.79, -0.51);
    const lidMesh = mesh(1.78, 0.16, 1.02, woodMat); lidMesh.position.set(0, 0.08, 0.51); lid.add(lidMesh);
    const lidRidge = mesh(0.34, 0.12, 1.04, woodMat); lidRidge.position.set(0, 0.18, 0.51); lid.add(lidRidge);
    const lidTrim = mesh(1.8, 0.05, 1.06, trimMat); lidTrim.position.set(0, 0.17, 0.51); lid.add(lidTrim);
    const lidGlow = mesh(0.34, 0.04, 1.06, glowMat); lidGlow.position.set(0, 0.25, 0.51); lid.add(lidGlow);
    root.add(lid);
    mysteryBoxState.lid = lid;

    // ── Light beam: a wide additive cone that erupts from the open chest during a
    // roll (MeshBasicMaterial additive — a glowing mesh, NOT a real light). ──
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x8cecff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.62, 2.6, 20, 1, true), beamMat);
    beam.position.set(0, 2.0, 0); // wide end up
    beam.renderOrder = 3;
    beam.frustumCulled = false;
    root.add(beam);
    mysteryBoxState.beam = beam;

    // Shimmer: single additive sprite above the box (reuses the muzzle-flash sprite
    // pipeline — additive, depthWrite off, definitely not a light).
    const shimmer = createMuzzleFlash(0xaef2ff, 2.4);
    shimmer.position.set(0, 1.5, 0);
    shimmer.material.opacity = 0;
    shimmer.visible = true;
    root.add(shimmer);
    mysteryBoxState.shimmer = shimmer;

    // Floating glow motes: a few small additive sprites that idle-orbit the chest and
    // stream upward along the beam while rolling. Same sprite pipeline as the shimmer.
    mysteryBoxState.motes = [];
    for (let i = 0; i < 7; i++) {
      const mote = createMuzzleFlash(0xbdf3ff, 0.5);
      mote.material.opacity = 0;
      mote.visible = true;
      mote.userData = {
        phase: Math.random() * Math.PI * 2,
        radius: 0.55 + Math.random() * 0.5,
        speed: 0.5 + Math.random() * 0.7,
        yBase: 0.5 + Math.random() * 0.6,
        rise: Math.random(),
      };
      root.add(mote);
      mysteryBoxState.motes.push(mote);
    }

    // Teddy-bear dud: simple brown box-bear, hidden until rolled.
    const bear = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: 0x7a4f2a, roughness: 0.9, metalness: 0.02 });
    const bodyB = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.2), furMat); bodyB.position.y = 0.17; bear.add(bodyB);
    const headB = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.18), furMat); headB.position.y = 0.44; bear.add(headB);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.06), furMat); ear.position.set(0.09 * s, 0.57, 0); bear.add(ear);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), furMat); arm.position.set(0.19 * s, 0.2, 0); bear.add(arm);
    }
    bear.visible = false;
    root.add(bear);
    mysteryBoxState.teddyMesh = bear;

    scene.add(root);
    mysteryBoxState.station = root;
    if (typeof window.__extAddCollider === "function") window.__extAddCollider(10, 140, 2.0, 1.3);
    // Pre-create one display rig now so its materials are linked in the boot
    // compile pass (compileAllWarmables walks the whole graph, visible or not).
    getMysteryBoxDisplayRig(GUNS.PISTOL);
  }

  function getMysteryBoxDisplayRig(gunType) {
    let rig = mysteryBoxState.displayCache.get(gunType);
    if (!rig) {
      rig = createWeaponViewModel(gunType, mysteryBoxState.station);
      rig.gun.scale.setScalar(0.55);
      rig.gun.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
      rig.flash.visible = false;
      rig.gun.visible = false;
      mysteryBoxState.displayCache.set(gunType, rig);
    }
    return rig;
  }

  function hideMysteryBoxDisplays() {
    for (const rig of mysteryBoxState.displayCache.values()) { rig.gun.visible = false; rig.gun.rotation.z = 0; }
    if (mysteryBoxState.teddyMesh) mysteryBoxState.teddyMesh.visible = false;
    if (mysteryBoxState.shimmer) mysteryBoxState.shimmer.material.opacity = 0;
    if (mysteryBoxState.beam) mysteryBoxState.beam.material.opacity = 0;
  }

  function resetMysteryBox() {
    mysteryBoxState.rolling = false;
    mysteryBoxState.rollT = 0;
    mysteryBoxState.resultGun = null;
    mysteryBoxState.teddy = false;
    mysteryBoxState.visualOnly = false;
    mysteryBoxState.prompt = "";
    hideMysteryBoxDisplays();
  }

  function startMysteryBoxRoll(resultGun, teddy, visualOnly) {
    mysteryBoxState.rolling = true;
    mysteryBoxState.rollT = 0;
    mysteryBoxState._seated = false;
    mysteryBoxState.flashPulse = 0;
    mysteryBoxState.resultGun = resultGun;
    mysteryBoxState.teddy = teddy;
    mysteryBoxState.visualOnly = !!visualOnly;
    hideMysteryBoxDisplays();
    if (teddy) {
      if (mysteryBoxState.teddyMesh) mysteryBoxState.teddyMesh.visible = true;
    } else {
      const rig = getMysteryBoxDisplayRig(resultGun);
      rig.gun.visible = true;
    }
  }

  function tryMysteryBox() {
    if (!mysteryBoxState.active || mysteryBoxState.rolling) return;
    if (player.xp < MYSTERY_BOX_COST) {
      addKillFeed(`MYSTERY BOX NEEDS ${MYSTERY_BOX_COST - player.xp} XP`);
      sfxDenied();
      return;
    }
    player.xp -= MYSTERY_BOX_COST;
    const teddy = Math.random() < MYSTERY_BOX_TEDDY_CHANCE;
    // Prefer weapons the player does NOT own yet, so the box drives real
    // progression instead of endlessly re-rolling duplicates. Once everything is
    // owned it may roll anything (a dupe just refills that gun's ammo on finish).
    const unowned = Object.values(GUNS).filter(g => !ownsWeapon(g));
    const pool = unowned.length ? unowned : Object.values(GUNS).filter(g => g !== currentGun);
    const resultGun = pool[Math.floor(Math.random() * pool.length)];
    startMysteryBoxRoll(resultGun, teddy, false);
    sfxBoxOpen();
    sfxBoxReveal();
    cameraFX.shake = Math.min(1, cameraFX.shake + 0.25);
    if (net?.active) broadcastVisualFx("mysteryBox", { gun: teddy ? "teddy" : resultGun });
    updateHUD(0);
  }

  function finishMysteryBoxRoll() {
    const { teddy, resultGun, visualOnly } = mysteryBoxState;
    mysteryBoxState.rolling = false;
    mysteryBoxState.rollT = 0;
    hideMysteryBoxDisplays();
    if (visualOnly) return; // remote player's roll — FX only
    if (teddy) {
      const refund = Math.floor(MYSTERY_BOX_COST / 2);
      player.xp += refund;
      addKillFeed(`TEDDY BEAR! REFUNDED ${refund} XP`);
      sfxBoxDud();
    } else if (resultGun && GUN_SPECS[resultGun]) {
      const st = allGuns[resultGun];
      if (st) {
        st.mag = st.magSize;
        st.ammo = GUN_SPECS[resultGun].ammo;
      }
      const wasNew = !ownsWeapon(resultGun);
      grantWeapon(resultGun); // acquire it for the rest of the run
      updateWeaponSlots();
      if (resultGun !== currentGun) switchGun(resultGun, { fromBox: true });
      addKillFeed(`MYSTERY BOX: ${GUN_SPECS[resultGun].name.toUpperCase()}${wasNew ? " — NEW" : " — AMMO REFILL"}`);
      playEventSound('pack_ready', { volume: 0.6 });
    }
    updateHUD(0);
  }

  const MYSTERY_BOX_TOTAL = MYSTERY_BOX_RISE_SECONDS + MYSTERY_BOX_HOLD_SECONDS;
  function updateMysteryBox(dt) {
    const s = mysteryBoxState;
    if (!s.station) return;
    const dist = Math.hypot(yaw.position.x - s.station.position.x, yaw.position.z - s.station.position.z);
    s.active = dist < 4.5 && game.state === "playing" && !s.rolling;
    s.prompt = s.rolling && !s.visualOnly
      ? "MYSTERY BOX ROLLING…"
      : s.active
        ? player.xp >= MYSTERY_BOX_COST
          ? `PRESS E: MYSTERY BOX — RANDOM WEAPON (${MYSTERY_BOX_COST} XP)`
          : `MYSTERY BOX NEEDS ${MYSTERY_BOX_COST - player.xp} XP`
        : "";

    const now = performance.now();
    const riseT = s.rolling ? clamp01(s.rollT / MYSTERY_BOX_RISE_SECONDS) : 0;

    // Lid swing — a spring (not a lerp) so it flings open with a little overshoot
    // bounce and clacks shut, reading as a real hinged mechanism.
    const lidTarget = s.rolling ? -2.0 : 0;
    s.lidVel += ((lidTarget - s.lidAngle) * 95 - s.lidVel * 14) * dt;
    s.lidAngle += s.lidVel * dt;
    if (s.lid) s.lid.rotation.x = s.lidAngle;

    // Seat-flash: a bright pop when the prize finishes rising (decays over ~0.5s).
    s.flashPulse = Math.max(0, s.flashPulse - dt * 2.2);

    // Glow pulse on trim + "?" (emissiveIntensity only — uniform update, no relink).
    const nearPulse = dist < 16 ? 0.55 + Math.sin(now * 0.004) * 0.45 : 0.22;
    const glowBase = (s.rolling ? 3.0 : 1.4) * nearPulse + 0.6 + s.flashPulse * 3.0;
    for (const m of s.glowMats) m.emissiveIntensity = glowBase;
    if (s.qMark) {
      // The "?" breathes on its own faster rhythm and spins-glows during a roll.
      s.qMark.rotation.z = s.rolling ? Math.sin(now * 0.006) * 0.12 : 0;
    }

    // Beam of light: dark idle, erupts and pulses while rolling, flares on seat.
    if (s.beam) {
      const beamTarget = s.rolling ? (0.28 + Math.sin(now * 0.012) * 0.12 + Math.sin(riseT * Math.PI) * 0.35) : 0;
      const bo = beamTarget + s.flashPulse * 0.6;
      s.beam.material.opacity += (bo - s.beam.material.opacity) * Math.min(1, dt * 6);
      s.beam.rotation.y = now * 0.0009;
      const bs = 0.85 + Math.sin(now * 0.01) * 0.12 + s.flashPulse * 0.5;
      s.beam.scale.set(bs, 1, bs);
    }

    // Floating motes: idle-orbit by proximity; stream upward along the beam while rolling.
    if (s.motes) {
      for (const mote of s.motes) {
        const u = mote.userData;
        u.phase += dt * u.speed * (s.rolling ? 2.4 : 1);
        const orbit = u.radius * (s.rolling ? 0.5 : 1);
        mote.position.x = Math.cos(u.phase) * orbit;
        mote.position.z = Math.sin(u.phase) * orbit;
        if (s.rolling) {
          // Rise and recycle: a continuous fountain up the beam.
          u.rise = (u.rise + dt * (0.5 + u.speed * 0.3)) % 1;
          mote.position.y = 0.7 + u.rise * 2.4;
          mote.material.opacity = Math.sin(u.rise * Math.PI) * 0.8;
        } else {
          const near = clamp01(1 - dist / 18);
          mote.position.y = u.yBase + Math.sin(now * 0.001 + u.phase) * 0.18;
          const target = (s.active ? 0.3 : 0.12) * near;
          mote.material.opacity += (target - mote.material.opacity) * Math.min(1, dt * 3);
        }
      }
    }

    if (!s.rolling) {
      // Idle beacon: fade the existing shimmer sprite in by proximity so the box
      // reads as interactive from range, not just mid-roll.
      if (s.shimmer) {
        const near = clamp01(1 - dist / 20);
        const target = s.active ? near * (0.35 + Math.sin(now * 0.005) * 0.12) : near * 0.16;
        s.shimmer.position.y = 1.2 + Math.sin(now * 0.0012) * 0.08;
        s.shimmer.material.opacity += (target - s.shimmer.material.opacity) * Math.min(1, dt * 4);
      }
      return;
    }
    s.rollT += dt;
    const eased = 1 - Math.pow(1 - riseT, 3);
    const display = s.teddy ? s.teddyMesh : s.displayCache.get(s.resultGun)?.gun;
    if (display) {
      // Rise out of the chest with a slowing spin, then a gentle settle bob at the top.
      const settle = riseT >= 1 ? Math.sin((s.rollT - MYSTERY_BOX_RISE_SECONDS) * 6) * 0.03 : 0;
      display.position.set(0, 0.55 + eased * 1.15 + settle, 0);
      display.rotation.y = now * 0.002 * (2.0 - riseT * 1.4);
      display.rotation.z = (1 - eased) * 0.5; // straightens as it rises
    }
    if (s.shimmer) {
      s.shimmer.position.y = 0.9 + eased * 1.05;
      s.shimmer.material.opacity = Math.sin(riseT * Math.PI) * 0.9 + s.flashPulse * 0.8;
    }
    // Fire the seat-flash once, as the rise completes.
    if (riseT >= 1 && !s._seated) { s._seated = true; s.flashPulse = 1; }
    if (s.rollT >= MYSTERY_BOX_TOTAL) finishMysteryBoxRoll();
  }

  function updatePerkMachine(dt) {
    if (!perkMachineState.station) return;
    const dist = Math.hypot(yaw.position.x - perkMachineState.station.position.x, yaw.position.z - perkMachineState.station.position.z);
    // The statue is a big landmark (scale 6, ~4-unit collider) — interact range
    // reaches just past its plinth.
    perkMachineState.active = dist < 5.2 && game.state === "playing";
    const tier = player.perkTier || 0;
    const def = PERK_DEFS[tier];
    perkMachineState.prompt = perkMachineState.active
      ? !def
        ? "ALL PERKS ACQUIRED"
        : player.xp >= def.cost
          ? `PRESS E: ${def.name} — ${def.desc} (${def.cost} XP)`
          : `${def.name} NEEDS ${def.cost - player.xp} XP`
      : "";
    // Statue pulse: a dim always-on idle glow (so it reads as "interactive" from
    // across the plaza, not just in interact range) that ramps to a much
    // stronger pulse once a perk is actually purchasable. emissiveIntensity only
    // (emissive is a standard uniform — no new lights, no shader relink).
    const mats = perkMachineState.pulseMats;
    if (mats && mats.length) {
      const purchasable = perkMachineState.active && def && player.xp >= def.cost;
      const now = performance.now();
      const pulse = purchasable
        ? 0.85 + Math.sin(now * 0.004) * 0.35
        : 0.12 + Math.sin(now * 0.0016) * 0.06;
      for (const m of mats) {
        if (Math.abs((m.emissiveIntensity || 0) - pulse) > 0.01) m.emissiveIntensity = pulse;
      }
      // Ground-level glow sprite: fades in with proximity (visible well before
      // interact range) and brightens further when purchasable.
      const sprite = perkMachineState.glowSprite;
      if (sprite) {
        const near = clamp01(1 - dist / 24);
        const target = near * (purchasable ? 0.55 + Math.sin(now * 0.004) * 0.12 : 0.22);
        sprite.material.opacity += (target - sprite.material.opacity) * Math.min(1, dt * 4);
      }
    }
  }

  // ── Car alarms (exterior street) ─────────────────────────────────────────────
  // Press E near a parked car → 10 s two-tone alarm + emissive light-housing flash;
  // every enemy steers toward the noise (soundLure) instead of the player. Per-car
  // 30 s cooldown. Coop: host-authoritative (enemies are host-simulated) — the host
  // broadcasts a "carAlarm" vfx so guests hear/see it.
  function getExtCars() { return Array.isArray(window.__extCarAlarms) ? window.__extCarAlarms : null; }

  function updateCarAlarms(dt) {
    const cars = getExtCars();
    if (!cars) return;
    const nowSec = performance.now() / 1000;
    // Nearest car in interact range.
    let near = null, nearDist = 3.4;
    for (const car of cars) {
      car.cooldownUntil = car.cooldownUntil || 0;
      const d = Math.hypot(yaw.position.x - car.x, yaw.position.z - car.z);
      if (d < nearDist) { near = car; nearDist = d; }
    }
    carAlarmState.nearCar = near;
    const inRange = !!near && game.state === "playing";
    const guestBlocked = !!(net?.active && gameMode === "coop" && !net.isHost);
    const cooling = inRange && near.cooldownUntil > nowSec;
    carAlarmState.active = inRange && !guestBlocked && !cooling;
    carAlarmState.prompt = carAlarmState.active
      ? "PRESS E: TRIGGER CAR ALARM (LURE ENEMIES)"
      : inRange && guestBlocked
        ? "CAR ALARM: HOST ONLY"
        : cooling
          ? `CAR ALARM RESETTING (${Math.ceil(near.cooldownUntil - nowSec)}s)`
          : "";
    // Flash the ringing car's emissive window/light-housing materials in sync with
    // the two-tone (0.4 s per tone). Emissive-only — NO real lights.
    const ringing = carAlarmState.ringing;
    if (ringing) {
      if (nowSec >= carAlarmState.ringUntil) {
        for (const rec of ringing.mats) rec.mat.emissiveIntensity = rec.base;
        carAlarmState.ringing = null;
      } else {
        const phase = Math.floor((carAlarmState.ringUntil - nowSec) / 0.4) % 2;
        const hot = phase === 0 ? 2.6 : 0.15;
        for (const rec of ringing.mats) rec.mat.emissiveIntensity = hot * (rec.scale || 1);
      }
    }
    if (soundLure.until > 0 && nowSec >= soundLure.until) soundLure.until = 0;
  }

  // Two-tone synthesized car alarm (no siren asset in assets/audio — verified),
  // riding the shared WebAudio bus + voice limiter like every other synth SFX.
  function playCarAlarmSound(durationSec, pan = 0) {
    if (!acquireVoice(durationSec)) return;
    try {
      const ctx = getAudioCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      const t0 = ctx.currentTime;
      // Alternate 700/950 Hz every 0.4 s for the whole duration.
      for (let t = 0; t < durationSec; t += 0.4) {
        o.frequency.setValueAtTime(Math.floor(t / 0.4) % 2 === 0 ? 950 : 700, t0 + t);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.055, t0 + 0.03);
      g.gain.setValueAtTime(0.055, t0 + durationSec - 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
      o.connect(g);
      connectWithPan(ctx, g, pan);
      o.start(t0);
      o.stop(t0 + durationSec + 0.05);
    } catch (_) {}
  }

  // Shared local FX (sound + emissive flash + lure) — used by the local trigger
  // and by the network "carAlarm" vfx handler.
  function startCarAlarmFx(car, { lure = true } = {}) {
    const nowSec = performance.now() / 1000;
    // Restore the previous car's emissives if a second alarm starts mid-ring.
    if (carAlarmState.ringing && carAlarmState.ringing !== car) {
      for (const rec of carAlarmState.ringing.mats) rec.mat.emissiveIntensity = rec.base;
    }
    carAlarmState.ringing = car;
    carAlarmState.ringUntil = nowSec + CAR_ALARM_DURATION;
    car.cooldownUntil = nowSec + CAR_ALARM_COOLDOWN;
    if (lure) {
      soundLure.x = car.x;
      soundLure.z = car.z;
      soundLure.until = nowSec + CAR_ALARM_DURATION;
    }
    playCarAlarmSound(CAR_ALARM_DURATION);
  }

  function tryTriggerCarAlarm() {
    if (!carAlarmState.active || !carAlarmState.nearCar) return;
    const car = carAlarmState.nearCar;
    // Lure only matters where enemies are simulated: solo, or coop host (guests
    // are blocked in updateCarAlarms). Broadcast so everyone hears/sees it.
    startCarAlarmFx(car, { lure: true });
    addKillFeed("CAR ALARM TRIGGERED — ENEMIES INBOUND");
    cameraFX.shake = Math.min(1, cameraFX.shake + 0.2);
    if (net?.active) {
      broadcastVisualFx("carAlarm", { x: +car.x.toFixed(2), z: +car.z.toFixed(2) });
    }
  }

  function tryPackUpgrade() {
    if (!packState.active) return;
    const level = gunUpgradeLevels[currentGun] || 0;
    if (level >= MAX_PACK_LEVEL) {
      addKillFeed("PACK-A-PUNCH MAXED");
      sfxDenied();
      return;
    }
    const cost = getPackCost(currentGun);
    if (player.xp < cost) {
      addKillFeed(`NEED ${cost - player.xp} XP`);
      sfxDenied();
      return;
    }
    player.xp -= cost;
    gunUpgradeLevels[currentGun] = level + 1;
    applyGunUpgradeStats(currentGun, true);
    gunState = allGuns[currentGun];
    weaponAnim.animSpec = getWeaponAnimSpec(currentGun);
    const nextLevel = gunUpgradeLevels[currentGun] + 1;
    // spawnPackUpgradeEffect early-returns (world VFX removed by request) so the
    // charge-up/discharge SFX must be triggered directly from the interaction.
    sfxPackUpgrade(nextLevel);
    spawnPackUpgradeEffect(currentGun, nextLevel, { sourceId: myNetId });
    // Persistent pack-a-punch glow on the equipped weapon + the upgrade animation.
    applyGunPackVisual(weapon, gunUpgradeLevels[currentGun]);
    applyGunPackVisual(thirdPerson.weapon, gunUpgradeLevels[currentGun]); // mirror onto the TP gun
    weaponAnim.packAnim = 1.0;        // drives the spin + energy flash this frame onward
    weaponAnim.packAnimTotal = 0.85;  // seconds
    weaponAnim.switchBlend = 1.0;
    weaponAnim.kick = Math.max(weaponAnim.kick, 3.5);
    weaponAnim.recoilRoll = Math.max(weaponAnim.recoilRoll || 0, 2.2);
    cameraFX.shake = Math.min(1, cameraFX.shake + 0.72);
    if (net?.active) {
      broadcastVisualFx("pack", { gun: currentGun, level: nextLevel });
    }
    addKillFeed(`${GUN_SPECS[currentGun].name.toUpperCase()} PACKED MK${nextLevel}`);
    updateHUD(0);
  }

  function tryBuyPerk() {
    if (!perkMachineState.active) return;
    const tier = player.perkTier || 0;
    const def = PERK_DEFS[tier];
    if (!def) { addKillFeed("ALL PERKS ACQUIRED"); return; }
    if (player.xp < def.cost) {
      addKillFeed(`NEED ${def.cost - player.xp} XP`);
      sfxDenied();
      return;
    }
    player.xp -= def.cost;
    player.perkTier = tier + 1;
    if (def.id === "overcharge") player.perkDamageMul = 1.3;
    else if (def.id === "vitality") { player.maxHp += 50; player.hp = player.maxHp; }
    else if (def.id === "aegis") player.perkDamageResist = 0.25;
    cameraFX.shake = Math.min(1, cameraFX.shake + 0.4);
    sfxPerkPurchase(tier);
    addKillFeed(`PERK ACQUIRED: ${def.name}`);
    updatePerkHud();
    updateHUD(0);
  }

  function tryInteract() {
    if (packState.active) { tryPackUpgrade(); return; }
    if (perkMachineState.active) { tryBuyPerk(); return; }
    if (mysteryBoxState.active) { tryMysteryBox(); return; }
    if (carAlarmState.active) { tryTriggerCarAlarm(); return; }
  }

  function damagePlayer(amount, options: any = {}) {
    if (amount <= 0) return false;
    if (player.pvpDead) return false;
    if (cutscene.active) return false; // invulnerable during blackout cutscene
    player.unlimitedSprint = true;
    player.stamina = player.maxStamina;
    player.sprintExhausted = false;
    if (player.unlimitedHealth) {
      player.hp = player.maxHp;
      return false;
    }
    // Aegis perk: flat damage reduction on all incoming damage.
    if (player.perkDamageResist > 0) amount *= (1 - player.perkDamageResist);

    player.hp = Math.max(0, player.hp - amount);
    return player.hp <= 0;
  }

  function healPlayer(amount) {
    player.hp = Math.min(player.maxHp, player.hp + amount);
  }

  function resetPlayer(options: any = {}) {
    const { setStartTime = true } = options;
    cancelCutscene();
    const start = mapToWorld(1, 1);
    keys.clear();
    yaw.position.set(start.x, PLAYER_H, start.z);
    ai.playerPrevX = start.x;
    ai.playerPrevZ = start.z;
    ai.playerVelX = 0;
    ai.playerVelZ = 0;
    ai.initialized = true;
    yaw.rotation.y = Math.PI * 0.35;
    pitch.rotation.x = 0;
    camera.rotation.set(0, 0, 0);
    player.hp = player.maxHp;
    player.stamina = player.maxStamina;
    player.sprintExhausted = false;
    player.auraTimer = 0;
    player.auraDamageTick = 0.18;
    player.effectSpeedMul = 1;
    player.jumpOffset = 0;
    player.jumpVel = 0;
    player.grounded = true;
    player.jumpCooldown = 0;
    clearTransientScreenEffects();
    const restoreThirdPerson = player.preDeathThirdPerson;
    player.preDeathThirdPerson = null;
    player.pvpDead = false;
    player.respawnTimer = 0;
    player.killStreak = 0;
    player.streakTimer = 0;
    player.meleeCooldown = 0;
    player.meleeTimer = 0; // knife hides next updateKnifeVisual tick
    player.totalKills = 0;
    player.shotsFired = 0;
    player.shotsHit = 0;
    player.unlimitedHealth = false;
    player.unlimitedSprint = true;
    player.unlimitedAmmo = false;
    // Perk-machine buffs are permanent-for-the-run, not permanent-forever — reset
    // on a fresh game/run same as pack-a-punch levels. (maxHp must be reset
    // BEFORE re-clamping hp, or a Vitality-boosted hp would stick above the
    // reset max.)
    player.maxHp = PLAYER_BASE.maxHp;
    player.hp = player.maxHp;
    player.perkDamageMul = 1;
    player.perkDamageResist = 0;
    player.perkTier = 0;
    updatePerkHud();
    // Kill any live car alarm/lure + restore flashed emissives, and clear the
    // death fade so a restart never starts black.
    if (carAlarmState.ringing) {
      for (const rec of carAlarmState.ringing.mats) rec.mat.emissiveIntensity = rec.base;
      carAlarmState.ringing = null;
    }
    soundLure.until = 0;
    resetMysteryBox(); // idempotent with restart — cancel any in-flight roll
    resetDeathFade();
    mouse.down = false;
    mouse.aiming = false;
    viewState.ads = 0;
    viewState.lookBack = 0;

    for (const g of Object.values(allGuns)) {
      const spec = GUN_SPECS[g.type];
      g.mag = spec.magazine;
      g.ammo = spec.ammo;
      g.fireCooldown = 0;
      g.reloadTimer = 0;
      g.muzzleTimer = 0;
      g.bloom = 0;
      g.isAutoReloading = false;
    }
    resetPackProgress();
    // Fresh progression each run: back to the starter weapon, box guns re-locked.
    if (currentGun !== STARTER_GUN) switchGun(STARTER_GUN, { fromBox: true });
    resetOwnedWeapons();
    updateWeaponSlots();
    gunState = allGuns[currentGun];
    weaponAnim.animSpec = getWeaponAnimSpec(currentGun);

    game.killed = 0;
    // Dev preview: jump straight to a chosen wave (0 = disabled → normal start).
    game.wave = (devHas("debug") && DEV.debug.spawnWaveOverride > 0) ? DEV.debug.spawnWaveOverride : 1;
    game.score = 0;
    game.multiKillCount = 0;
    game.multiKillTimer = 0;
    game.waveStartTime = performance.now();
    updateScoreHud();
    applyWaveLighting(game.wave);
    if (setStartTime) game.startTime = performance.now();
    game.elapsedTime = 0;
    camera.fov = 68;
    camera.updateProjectionMatrix();
    if (restoreThirdPerson != null) setThirdPersonEnabled(!!restoreThirdPerson, false);
    if (thirdPerson.root) {
      thirdPerson.fireTimer = 0;
      thirdPerson.reloadTimer = 0;
      thirdPerson.recoilBack = 0;
      thirdPerson.recoilBackVel = 0;
      thirdPerson.recoilPitch = 0;
      thirdPerson.recoilPitchVel = 0;
      thirdPerson.recoilYaw = 0;
      thirdPerson.recoilYawVel = 0;
      thirdPerson.recoilRoll = 0;
      thirdPerson.recoilRollVel = 0;
      thirdPerson.viewBlend = thirdPerson.enabled ? 1 : 0;
      thirdPerson.switchPulse = 0;
      updateThirdPersonCharacter(0, { f: 0, s: 0, sprinting: false, jumping: false });
      applyViewModeVisibility();
    }
    stateOverlay?.classList.remove("active");
    updateObjective();
  }

  function updateObjective() {
    if (net?.active && gameMode === "pvp") {
      pvpHudEl?.classList.add("active");
      updatePvpScoreboard();
      return;
    }
    pvpHudEl?.classList.remove("active");
    if (hud.objective) hud.objective.textContent = `WAVE ${game.wave} — ELIMINATE ${Math.max(0, game.totalEnemies - game.killed)} DRONES`;
    if (hud.waveVal) hud.waveVal.textContent = game.wave;
    if (hud.killsVal) hud.killsVal.textContent = `${game.killed} / ${game.totalEnemies}`;
  }

  function setMenuPanel(panelName = "briefing") {
    const nextPanel = ["briefing", "loadout", "intel", "quit"].includes(panelName) ? panelName : "briefing";
    const navItems = [startBtn, resumeBtn, restartBtn, loadoutBtn, intelBtn, multiplayerBtn, quitBtn].filter(Boolean);

    if (panelName === "multiplayer") {
      for (const item of navItems) item.classList.remove("active-nav");
      multiplayerBtn?.classList.add("active-nav");
      return;
    }

    for (const panel of menuPanels || []) {
      panel.classList.toggle("active", panel.dataset.menuPanel === nextPanel);
    }
    if (nextPanel === "loadout") {
      requestAnimationFrame(() => updateLoadoutPreviews(performance.now(), true));
    }

    for (const item of navItems) item.classList.remove("active-nav");

    if (nextPanel === "loadout") loadoutBtn?.classList.add("active-nav");
    else if (nextPanel === "intel") intelBtn?.classList.add("active-nav");
    else if (nextPanel === "multiplayer") multiplayerBtn?.classList.add("active-nav");
    else if (nextPanel === "quit") quitBtn?.classList.add("active-nav");
    else if (game.state === "paused") resumeBtn?.classList.add("active-nav");
    else startBtn?.classList.add("active-nav");

    if (quitStatus && nextPanel === "quit") quitStatus.textContent = "Awaiting confirmation";
  }

  // Inject the "locked" loadout-card styling once (so BOTH html entry points get
  // it without editing markup). Non-starter cards read as locked/unpickable.
  let loadoutLockStyleInjected = false;
  function ensureLoadoutLockStyle() {
    if (loadoutLockStyleInjected) return;
    loadoutLockStyleInjected = true;
    const style = document.createElement("style");
    style.id = "loadout-lock-style";
    style.textContent =
      ".loadout-card.locked{cursor:not-allowed;opacity:0.62;filter:grayscale(0.35);}" +
      ".loadout-card.locked:hover{border-color:var(--line);}" +
      ".loadout-card.locked .loadout-name{color:#8fa6b4;}" +
      ".loadout-card.locked::after{content:'\\1F512 FIND IN MYSTERY BOX';position:absolute;" +
      "left:0;right:0;bottom:0;z-index:3;text-align:center;padding:5px 4px;font-size:9px;" +
      "font-weight:700;letter-spacing:0.12em;color:#ffd166;background:rgba(8,10,16,0.86);" +
      "border-top:1px solid rgba(255,209,102,0.35);pointer-events:none;}";
    document.head.appendChild(style);
  }

  function applySelectedLoadoutUI() {
    ensureLoadoutLockStyle();
    for (const card of loadoutCards || []) {
      const gun = card.dataset.loadout;
      card.classList.toggle("selected", gun === selectedLoadout);
      card.classList.toggle("locked", gun !== STARTER_GUN);
    }
    if (selectedLoadoutVal) {
      selectedLoadoutVal.textContent = GUN_SPECS[selectedLoadout]?.name || "Service Pistol";
    }
  }

  function chooseLoadout(gunType) {
    // Only the starter is selectable now; other cards are locked (mystery-box only).
    if (gunType !== STARTER_GUN) {
      sfxDenied();
      return;
    }
    selectedLoadout = gunType;
    applySelectedLoadoutUI();
    saveSettings({ loadout: selectedLoadout });
  }

  function syncGameplayBodyClass() {
    document.body?.classList.toggle("gameplay-view", game.state === "playing" || game.state === "transition");
  }

  function setOverlayMode(mode) {
    if (overlay) overlay.dataset.mode = mode;

    if (mode === "main") {
      if (startBtn) startBtn.classList.remove("hidden-menu");
      if (resumeBtn) resumeBtn.classList.add("hidden-menu");
      if (restartBtn) restartBtn.classList.add("hidden-menu");
      if (quitBtn) quitBtn.classList.remove("hidden-menu");
      if (quitConfirmBtn) quitConfirmBtn.textContent = "Close Window";
      setMenuPanel("briefing");
      return;
    }

    if (mode === "pause") {
      if (startBtn) startBtn.classList.add("hidden-menu");
      if (resumeBtn) resumeBtn.classList.remove("hidden-menu");
      if (restartBtn) restartBtn.classList.remove("hidden-menu");
      if (quitBtn) quitBtn.classList.remove("hidden-menu");
      if (quitConfirmBtn) quitConfirmBtn.textContent = "Return To Menu";
      setMenuPanel("briefing");
    }
  }

  function pauseGame() {
    if (game.state !== "playing") return;
    game.state = "paused";
    syncGameplayBodyClass();
    disablePlayerFlashlightRig();
    mouse.down = false;
    mouse.aiming = false;
    setOverlayMode("pause");
    overlay?.classList.remove("hidden");
    document.exitPointerLock?.();
    renderOverlayScan();
  }

  function requestCanvasPointerLock() {
    const lockResult = canvas.requestPointerLock?.();
    if (lockResult?.catch) lockResult.catch(() => {});
  }

  function resumeGame() {
    if (game.state !== "paused") return;
    game.state = "playing";
    syncGameplayBodyClass();
    overlay?.classList.add("hidden");
    requestCanvasPointerLock();
  }

  function missionHasRunState() {
    return game.startTime > 0
      || game.wave !== 1
      || game.score > 0
      || game.killed > 0
      || player.totalKills > 0
      || player.shotsFired > 0
      || enemies.some(enemy => enemy.alive && enemy.mesh?.visible);
  }

  async function beginMission() {
    if (!bootComplete) return; // world/shaders still warming — see bootComplete
    if (game.state !== "menu" || game.transitioning) return;
    game.transitioning = true;
    game.state = "transition";
    syncGameplayBodyClass();
    overlay?.classList.add("hidden");
    requestCanvasPointerLock();
    primeFirstUseAudio();

    try {
      await waitFrame();
      const needsFreshMission = missionHasRunState();
      const needsFreshSinglePlayerStart = !needsFreshMission && !net?.active && game.wave === 1 && enemies.length === 0;
      if (needsFreshMission || needsFreshSinglePlayerStart) {
        resetPlayer({ setStartTime: false });
      }
      if (selectedLoadout !== currentGun) switchGun(selectedLoadout);
      if (net?.active && gameMode === "pvp") {
        forceCinematicOffForPvp();
        // PvP: no AI enemies — players fight each other.
        clearAllEnemiesForCoop();
        player.pvpDead = false;
        player.respawnTimer = 0;
        pvpScores.clear();
        if (hud.objective) hud.objective.textContent = "PVP FFA - FREE FOR ALL";
      } else if (isCoopGuest()) {
        // Guests receive enemies from the host; clear any locally-primed wave.
        clearAllEnemiesForCoop();
      } else if (game.wave === 1 && enemies.length > 0) {
        resetPlayer({ setStartTime: false });
        activatePrimedFirstWave();
      } else if (needsFreshMission || game.wave === 1) {
        pendingEnemyDeaths.length = 0;
        enemyRemovalQueue.length = 0;
        await spawnEnemies(1, { smooth: true, minDistance: 18, preferVisible: true });
      }
      ensureAllLiveEnemiesVisible();
      game.startTime = performance.now();
      game.state = "playing";
      if (game.wave === 1 && !isCoopGuest()) {
        announce('vo_game_start', { minGap: 0 });
        playEventSound('wave_start', { volume: 0.55 });
      }
      syncGameplayBodyClass();
      syncClickToPlay?.();
      updateHUD(0);
      updateObjective();
      renderMinimap(performance.now());
    } catch (err) {
      console.error("Mission start failed:", err);
      game.state = "menu";
      syncGameplayBodyClass();
      overlay?.classList.remove("hidden");
    } finally {
      game.transitioning = false;
    }
  }

  function quitToMenu() {
    game.state = "menu";
    syncGameplayBodyClass();
    disablePlayerFlashlightRig();
    player.pvpDead = false;
    player.respawnTimer = 0;
    if (player.preDeathThirdPerson != null) {
      setThirdPersonEnabled(!!player.preDeathThirdPerson, false);
      player.preDeathThirdPerson = null;
    }
    mouse.down = false;
    mouse.aiming = false;
    syncCinematicControlLock();
    stateOverlay?.classList.remove("active");
    setOverlayMode("main");
    overlay?.classList.remove("hidden");
    document.exitPointerLock?.();
    renderOverlayScan();
  }

  function openModelEditor() {
    const editorUrl = new URL("./model_preview.html", window.location.href).href;
    const editorWindow = window.open(editorUrl, "_blank", "noopener,noreferrer");
    if (!editorWindow) window.location.href = editorUrl;
  }

  function switchGun(gunType, options: any = {}) {
    if (gunType === currentGun) return;
    // Progression gate: only OWNED weapons can be selected. The mystery box passes
    // { fromBox:true } after granting, so its result always goes through.
    if (!options.fromBox && !ownsWeapon(gunType)) {
      addKillFeed(`${GUN_SPECS[gunType]?.name?.toUpperCase() || "WEAPON"} LOCKED — FIND IN MYSTERY BOX`);
      sfxDenied();
      return;
    }
    allGuns[currentGun] = gunState;
    if (weapon?.gun) weapon.gun.visible = false;
    currentGun = gunType;
    gunState = allGuns[gunType];
    selectFirstPersonWeapon(gunType);
    refreshEquippedGunPackVisual(); // show this weapon's own pack-a-punch tier
    weaponAnim.switchBlend = 1;
    warmWeaponShootAudio(gunType);
    if (game.state === "playing" || game.state === "transition") warmLiveWeaponShootAudio(gunType);
    if (thirdPerson.ready) createThirdPersonWeapon(gunType);
    // Equip lower/raise on the TP gun, weight-scaled by the incoming gun's
    // equipTime (pistol snappiest, LMG/railgun slowest). weaponAnim was just
    // rebuilt by selectFirstPersonWeapon, so animSpec is the new gun's.
    thirdPerson.equip = 1;
    thirdPerson.equipTime = weaponAnim.animSpec.equipTime || 0.3;
    applyViewModeVisibility();
    gunState.fireCooldown = Math.max(gunState.fireCooldown, 0.14);
    sfxEquip(gunType);
    addKillFeed(`SWITCHED TO ${GUN_SPECS[gunType].name.toUpperCase()}`);
  }

  function fireGun() {
    if (game.state !== "playing") return;
    if (player.pvpDead) return;
    if (weaponAnim.switchBlend > 0.12) return;
    if (gunState.fireCooldown > 0 || gunState.reloadTimer > 0) return;
    if (!player.unlimitedAmmo && gunState.mag <= 0) {
      if (!gunState.isAutoReloading) {
        sfxEmpty();
        tryReload();
        gunState.isAutoReloading = true;
      }
      return;
    }

    gunState.isAutoReloading = false;
    if (!player.unlimitedAmmo) gunState.mag--;
    gunState.fireCooldown = gunState.fireRate;
    gunState.muzzleTimer = weaponAnim.animSpec.muzzleFlashDuration;
    thirdPerson.fireTimer = Math.max(thirdPerson.fireTimer, 0.18);
    player.shotsFired++;
    lightingState.shootFlash = 1;

    const burstActive = weaponAnim.recoilBurstTimer > 0;
    const burstIndex = burstActive ? weaponAnim.recoilBurst : 0;
    const firstShotMul = currentGun === GUNS.RIFLE
      ? (burstIndex === 0 ? 0.52 : burstIndex === 1 ? 0.72 : burstIndex === 2 ? 0.92 : 1)
      : burstIndex === 0 ? 1.18 : burstIndex === 1 ? 1.08 : 1;
    weaponAnim.recoilBurst = burstActive ? burstIndex + 1 : 1;
    weaponAnim.recoilBurstTimer = currentGun === GUNS.SNIPER ? 0.28 : currentGun === GUNS.SHOTGUN ? 0.2 : 0.16;

    const recoilSpec = weaponAnim.animSpec.recoil;
    const scoped = viewState.ads > 0.55;
    const recoilMul = scoped
      ? (currentGun === GUNS.SNIPER ? 0.2 : currentGun === GUNS.SHOTGUN ? 0.48 : 0.54)
      : (currentGun === GUNS.SNIPER ? 1.1 : currentGun === GUNS.SHOTGUN ? 1.42 : 0.88);
    const recoilProfile = currentGun === GUNS.SHOTGUN
      ? { camKick: 0.13, camShake: 0.11, camRoll: 0.0035, weaponKick: 3.9, weaponYaw: 0.028, weaponRoll: 0.05, slideKick: 0.28, crosshair: 0.36 }
      : currentGun === GUNS.SNIPER
        ? { camKick: 0.082, camShake: 0.016, camRoll: 0.0018, weaponKick: 2.75, weaponYaw: 0.18, weaponRoll: 0.1, slideKick: 0.18, crosshair: 0.1 }
        : { camKick: 0.075, camShake: 0.035, camRoll: 0.0038, weaponKick: 2.2, weaponYaw: 0.18, weaponRoll: 0.055, slideKick: 0.16, crosshair: 0.24 };
    const kickMul = recoilMul * firstShotMul;
    // Per-gun physics multipliers (spec-driven; default 1/0 keeps legacy feel).
    const specPhys = GUN_SPECS[currentGun] || ({} as any);
    const shakeMul = Number.isFinite(specPhys.shakeMul) ? specPhys.shakeMul : 1;
    const driftMul = Number.isFinite(specPhys.driftMul) ? specPhys.driftMul : 1;

    cameraFX.recoilVel += recoilSpec.kick * recoilProfile.camKick * kickMul;
    cameraFX.rollVel += (Math.random() - 0.5) * (recoilSpec.roll * recoilProfile.camRoll * kickMul) * shakeMul;
    cameraFX.shake = Math.min(1, cameraFX.shake + recoilProfile.camShake * kickMul * shakeMul);
    weaponAnim.kickVel += recoilProfile.weaponKick * kickMul;
    weaponAnim.recoilYawVel += recoilSpec.yaw * recoilProfile.weaponYaw * kickMul * (Math.random() > 0.5 ? 1 : -1);
    weaponAnim.recoilRollVel += recoilSpec.roll * recoilProfile.weaponRoll * kickMul;
    weaponAnim.slideKick = Math.max(weaponAnim.slideKick, recoilProfile.slideKick * kickMul);
    weaponAnim.slideKickVel += recoilProfile.slideKick * kickMul;
    pushCrosshairKick(recoilProfile.crosshair);
    const bodyKick = currentGun === GUNS.SHOTGUN ? 1.3 : currentGun === GUNS.SNIPER ? 1.05 : 0.72;
    thirdPerson.recoilBackVel  += 2.6  * bodyKick * kickMul;
    thirdPerson.recoilPitchVel += 1.55 * bodyKick * kickMul;
    thirdPerson.recoilYawVel   += (Math.random() - 0.5) * 0.72 * bodyKick * kickMul;
    thirdPerson.recoilRollVel  += (Math.random() > 0.5 ? 1 : -1) * 0.58 * bodyKick * kickMul;
    // Upward arm-punch impulse — springs back via applyThirdPersonArmPose's damper each frame
    thirdPerson.firePunchVel   -= 1.35 * bodyKick * kickMul;

    const hipFire = !scoped;
    const riflePattern = currentGun === GUNS.RIFLE ? (hipFire ? 0.38 : 0.14) : currentGun === GUNS.SHOTGUN ? (hipFire ? 0.62 : 0.24) : (hipFire ? 0.72 : 0.12);
    const kickY = -(currentGun === GUNS.RIFLE ? (hipFire ? 3.2 : 1.7) : currentGun === GUNS.SHOTGUN ? (hipFire ? 8.2 : 3.6) : (hipFire ? 5.2 : 0.8)) * firstShotMul;
    const kickX = (((weaponAnim.recoilBurst % 2 === 0 ? -1 : 1) * (currentGun === GUNS.RIFLE ? (hipFire ? 0.85 : 0.32) : currentGun === GUNS.SHOTGUN ? (hipFire ? 2.4 : 0.95) : (hipFire ? 1.0 : 0.22))) + (Math.random() - 0.5) * riflePattern) * driftMul;
    const crosshairRecoilScale = currentGun === GUNS.SNIPER ? (scoped ? 0.12 : 0.3) : currentGun === GUNS.RIFLE ? (hipFire ? 0.55 : 0.3) : (hipFire ? 0.92 : 0.5);
    pushCrosshairRecoil(kickX * kickMul * crosshairRecoilScale, kickY * kickMul * crosshairRecoilScale);
    const aimCursorOffset = getAimCursorOffset(fireAnglesTmp);
    const aimOffsetX = aimCursorOffset.x;
    const aimOffsetY = aimCursorOffset.y;

    const shotIndex = weaponAnim.recoilBurst;
    const sustainedShots = Math.max(0, shotIndex - 1);
    const rifleSprayX = 0;
    const rifleSprayY = 0;
    const moving = keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD");
    // Spec-driven spread (works for the whole roster): ADS tightens it, and the
    // original behavior is preserved (rifle spread 0, sniper spread handled by aim).
    // Bloom: sustained fire grows the hip cone per-gun (bloomGrow → bloomMax), and
    // it recovers at bloomDecay rad/s in updateWeapon.
    gunState.bloom = Math.min(specPhys.bloomMax || 0, (gunState.bloom || 0) + (specPhys.bloomGrow || 0));
    const shotSpread = currentGun === GUNS.SNIPER
      ? 0
      : (gunState.spread + (gunState.bloom || 0) * (hipFire ? 1 : 0.4)) * (hipFire ? 1 : 0.62);

    sfxShoot();
    if (net?.active) { broadcastShot(); tryPvpHit(); }
    if (thirdPerson.enabled) updateThirdPersonWeaponPose();
    const activeWeapon = getActiveWeaponForShot();
    alignWeaponMuzzleFlash(activeWeapon);
    if (activeWeapon?.flash) {
      applyMuzzleFlashSprite(activeWeapon.flash, true, 1, currentGun, activeWeapon === thirdPerson.weapon ? 0.74 : 1);
    }
    const shotRange = (currentGun === GUNS.SNIPER || currentGun === GUNS.RAILGUN || currentGun === GUNS.DMR) ? MAX_SHOT_RANGE : 42;
    const floorMesh = scene.userData.environmentSurfaces?.floor || null;
    const pendingDamage = new Map();
    const pendingHeadshot = new Set();
    const pendingHitDir = new Map();
    let shotHitEnemy = false;
    let shotHitSurface = false;

    for (let i = 0; i < gunState.pellets; i++) {
      getActiveMuzzleWorld(muzzleWorldTmp, i);
      getPelletSpreadOffset(currentGun, i, gunState.pellets, shotSpread, pelletSpreadTmp);
      camera.getWorldPosition(cameraWorldTmp);
      getAimCursorDirectionWorld(
        enemyShotDirTmp,
        aimOffsetX + pelletSpreadTmp.x + rifleSprayX,
        aimOffsetY + pelletSpreadTmp.y - rifleSprayY
      );
      raycaster.set(cameraWorldTmp, enemyShotDirTmp);
      raycaster.far = shotRange;

      const surfaceHit = getShotSurfaceHit(floorMesh);
      const wallDist = surfaceHit ? surfaceHit.distance : Infinity;
      const wallPoint = surfaceHit ? surfaceHit.point : null;

      let bestEnemy = null;
      let bestEnemyDist = Infinity;
      let bestEnemyPart = null;
      const pierceHits = specPhys.pierce ? [] : null; // railgun: every enemy on the line
      for (const enemy of liveEnemies) {
        const d = getEnemyShotDistance(enemy, raycaster.ray.origin, raycaster.ray.direction, shotRange, currentGun, shotHitInfoTmp);
        if (pierceHits && d < wallDist && d <= shotRange) {
          pierceHits.push({ enemy, part: shotHitInfoTmp.part });
        }
        if (d < bestEnemyDist) {
          bestEnemyDist = d;
          bestEnemy = enemy;
          bestEnemyPart = shotHitInfoTmp.part;
        }
      }

      // Piercing slug: damage every enemy along the ray (beyond the first, which the
      // normal path below handles), and let the tracer continue to the wall.
      if (pierceHits && pierceHits.length > 1) {
        for (const hit of pierceHits) {
          if (hit.enemy === bestEnemy) continue;
          let pd = (gunState.damage / gunState.pellets) * (player.perkDamageMul || 1);
          if (hit.part === "head") { pd *= 2; pendingHeadshot.add(hit.enemy); }
          pendingDamage.set(hit.enemy, (pendingDamage.get(hit.enemy) || 0) + pd);
          const hd = pendingHitDir.get(hit.enemy) || { x: 0, z: 0 };
          hd.x += raycaster.ray.direction.x;
          hd.z += raycaster.ray.direction.z;
          pendingHitDir.set(hit.enemy, hd);
        }
      }

      const hitEnemyFirst = bestEnemy && bestEnemyDist < wallDist && bestEnemyDist <= shotRange;
      const tracerEnd = hitEnemyFirst && !specPhys.pierce
        ? enemyHitPointTmp.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, bestEnemyDist)
        : wallPoint || tracerFallbackEndTmp.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, shotRange);

      spawnBulletTracer(muzzleWorldTmp, tracerEnd, currentGun);

      if (!hitEnemyFirst) {
        if (surfaceHit) {
          getHitWorldNormal(surfaceHit, impactNormalTmp);
          if (!shotHitSurface) {
            shotWallImpactTmp.copy(wallPoint);
            shotWallNormalTmp.copy(impactNormalTmp);
          }
          shotHitSurface = true;
          spawnBulletHole(wallPoint, impactNormalTmp, currentGun);
          broadcastBulletHoleFx(wallPoint, impactNormalTmp, currentGun);
        }
        continue;
      }

      const enemy = bestEnemy;

      let pelletDamage = (gunState.damage / gunState.pellets) * (player.perkDamageMul || 1);

      const isHeadshot = bestEnemyPart === "head";
      if (isHeadshot) {
        pelletDamage *= 2;
        pendingHeadshot.add(enemy);
      }

      pendingDamage.set(enemy, (pendingDamage.get(enemy) || 0) + pelletDamage);
      const hitDir = pendingHitDir.get(enemy) || { x: 0, z: 0 };
      hitDir.x += raycaster.ray.direction.x;
      hitDir.z += raycaster.ray.direction.z;
      pendingHitDir.set(enemy, hitDir);
      player.shotsHit++;
      if (!shotHitEnemy) shotEnemyImpactTmp.copy(tracerEnd);
      shotHitEnemy = true;
    }

    if (shotHitEnemy) {
      sfxHit();
      showHitMarker();
      impactNormalTmp.copy(raycaster.ray.direction).multiplyScalar(-1);
      spawnImpactParticles(shotEnemyImpactTmp, impactNormalTmp, currentGun === GUNS.SHOTGUN ? 2 : 3);
    } else if (shotHitSurface) {
      spawnImpactParticles(shotWallImpactTmp, shotWallNormalTmp, currentGun === GUNS.SHOTGUN ? 2 : null);
    }

    for (const [enemy, damage] of pendingDamage) {
      if (!enemy.alive) continue;
      // Co-op guest: forward hit to authoritative host AND apply optimistic local feedback
      // so the enemy visually reacts immediately rather than waiting 83ms for the next snapshot.
      if (isCoopGuest() && enemy.isProxy) {
        net.send({ t: "hit", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), i: enemy.netId, dmg: damage, hs: pendingHeadshot.has(enemy) });
        spawnDamageNumber(enemy, damage, { headshot: pendingHeadshot.has(enemy) });
        enemy.hp = Math.max(0, enemy.hp - damage);
        enemy.aggroed = true;
        enemy.attackPulse = Math.max(enemy.attackPulse, 0.35);
        const hitDir = pendingHitDir.get(enemy);
        applyEnemyHitFeedback(enemy, damage, pendingHeadshot.has(enemy), hitDir?.x || 0, hitDir?.z || 0);
        if (enemy.hp <= 0 && !enemy._optimisticDead) {
          enemy._optimisticDead = true;
          setEnemyAlive(enemy, false);
          if (enemy.mesh.userData.clonedGhost) setHumanoidEnemyAction(enemy, "death", 0.05);
        }
        continue;
      }
      enemy.hp -= damage;
      enemy.aggroed = true;
      enemy.attackPulse = Math.max(enemy.attackPulse, 0.35);
      const hitDir = pendingHitDir.get(enemy);
      applyEnemyHitFeedback(enemy, damage, pendingHeadshot.has(enemy), hitDir?.x || 0, hitDir?.z || 0);
      if (enemy.hp <= 0) {
        enemy.killHeadshot = pendingHeadshot.has(enemy);
        if (currentGun === GUNS.SNIPER) {
          if (!enemy.deathQueued) pendingEnemyDeaths.push(enemy);
          enemy.deathQueued = true;
          setEnemyAlive(enemy, false);
          deactivateEnemyRuntimeLights(enemy);
          enemy.mesh.visible = false;
        } else {
          killEnemy(enemy);
        }
      }
    }

    if (gunState.mag <= 0 && gunState.ammo > 0) tryReload();
  }

  // ── Knife melee ──────────────────────────────────────────────────────────────
  // Procedural blade+handle mesh shown in the right hand only during the melee
  // swing (mesh visibility — not a light, no shader impact). Built once at boot so
  // its materials are linked by the startup compile pass.
  const knifeMesh = (() => {
    const g = new THREE.Group();
    g.name = "MeleeKnife";
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xbfd4e2, roughness: 0.18, metalness: 0.92, emissive: 0x1a2a36, emissiveIntensity: 0.25 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.8, metalness: 0.1 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.012), steelMat);
    blade.position.y = 0.27; g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.09, 4), steelMat);
    tip.position.y = 0.485; tip.rotation.y = Math.PI / 4; g.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.022, 0.032), gripMat);
    guard.position.y = 0.09; g.add(guard);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.17, 0.036), gripMat);
    g.add(handle);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    g.visible = false;
    scene.add(g);
    return g;
  })();
  const knifePosTmp = new THREE.Vector3();
  const knifeQuatTmp = new THREE.Quaternion();
  function updateKnifeVisual() {
    const show = player.meleeTimer > 0 && thirdPerson.ready && thirdPerson.rightHand && game.state === "playing";
    knifeMesh.visible = !!show;
    if (!show) return;
    thirdPerson.rightHand.getWorldPosition(knifePosTmp);
    thirdPerson.rightHand.getWorldQuaternion(knifeQuatTmp);
    knifeMesh.position.copy(knifePosTmp);
    knifeMesh.quaternion.copy(knifeQuatTmp);
    knifeMesh.rotateX(Math.PI * 0.5); // blade points out of the fist
    knifeMesh.translateY(0.05);
  }

  const meleeToEnemyTmp = new THREE.Vector3();
  function meleeAttack() {
    if (game.state !== "playing") return;
    if (player.pvpDead) return;
    if (player.meleeCooldown > 0) return;
    if (gunState.reloadTimer > 0) return;
    player.meleeCooldown = 0.5;
    player.meleeTimer = 0.34;
    weaponAnim.meleeSwing = 1;
    weaponAnim.kickVel += 8.6;
    weaponAnim.recoilYawVel += 2.4;
    weaponAnim.recoilRollVel -= 1.8;
    weaponAnim.slideKickVel += 0.7;
    cameraFX.shake = Math.min(1, cameraFX.shake + 0.075);
    thirdPerson.fireTimer = Math.max(thirdPerson.fireTimer, 0.2);

    const MELEE_RANGE = 2.7;
    const MELEE_DAMAGE = 260; // knife — one-shots early zombies (240 hp)
    camera.getWorldPosition(cameraWorldTmp);
    getAimCursorDirectionWorld(enemyShotDirTmp, 0, 0);

    let hitAny = false;
    let best = null;
    let bestDist = Infinity;
    // Stays on enemies[] (not the liveEnemies archetype): this loop kills enemies
    // (setEnemyAlive false) mid-iteration, which removes them from the live
    // archetype and would corrupt archetype iteration. The array isn't spliced on
    // death, so iterating it with the .alive guard is safe.
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      getEnemyHitCenter(enemy, enemyHitCenterTmp);
      meleeToEnemyTmp.copy(enemyHitCenterTmp).sub(cameraWorldTmp);
      const dist = meleeToEnemyTmp.length();
      if (dist > MELEE_RANGE || dist < 0.0001) continue;
      meleeToEnemyTmp.multiplyScalar(1 / dist);
      // Only enemies inside a ~70-degree frontal cone are struck.
      if (meleeToEnemyTmp.dot(enemyShotDirTmp) < 0.55) continue;
      hitAny = true;
      // Co-op guest: forward to host AND apply optimistic local feedback.
      if (isCoopGuest() && enemy.isProxy) {
        net.send({ t: "hit", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), i: enemy.netId, dmg: MELEE_DAMAGE, hs: false });
        spawnDamageNumber(enemy, MELEE_DAMAGE, { melee: true });
        enemy.hp = Math.max(0, enemy.hp - MELEE_DAMAGE);
        enemy.aggroed = true;
        enemy.attackPulse = Math.max(enemy.attackPulse, 0.5);
        applyEnemyHitFeedback(enemy, MELEE_DAMAGE, false, enemyShotDirTmp.x, enemyShotDirTmp.z, { melee: true });
        if (enemy.hp <= 0 && !enemy._optimisticDead) {
          enemy._optimisticDead = true;
          setEnemyAlive(enemy, false);
          if (enemy.mesh.userData.clonedGhost) setHumanoidEnemyAction(enemy, "death", 0.05);
        }
        continue;
      }
      enemy.hp -= MELEE_DAMAGE;
      enemy.aggroed = true;
      enemy.attackPulse = Math.max(enemy.attackPulse, 0.5);
      applyEnemyHitFeedback(enemy, MELEE_DAMAGE, false, enemyShotDirTmp.x, enemyShotDirTmp.z, { melee: true });
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }

    sfxMelee(hitAny);
    if (hitAny) {
      showHitMarker();
      if (best) {
        getEnemyHitCenter(best, enemyHitCenterTmp);
        impactNormalTmp.copy(enemyShotDirTmp).multiplyScalar(-1);
        spawnImpactParticles(enemyHitCenterTmp, impactNormalTmp, 3);
      }
      // Resolve deaths after applying all damage so multi-kills register.
      // Stays on enemies[] (not the live archetype): killEnemy() below removes the
      // entity from the live archetype mid-iteration — iterate the array instead.
      for (const enemy of enemies) {
        if (enemy.alive && enemy.hp <= 0) {
          enemy.killHeadshot = false;
          killEnemy(enemy);
        }
      }
    }
  }

  function killEnemy(enemy, killerId = myNetId) {
    if (!enemy.alive) return;
    setEnemyAlive(enemy, false);
    deactivateEnemyRuntimeLights(enemy);
    // Died mid-ability: drop any telegraph rings it was holding.
    if (enemy.telegraphRing) { fadeTelegraphRing(enemy.telegraphRing); enemy.telegraphRing = null; }
    if (enemy.sanctuaryRing) { fadeTelegraphRing(enemy.sanctuaryRing); enemy.sanctuaryRing = null; }
    if (enemy.empRing) { fadeTelegraphRing(enemy.empRing); enemy.empRing = null; }
    if (enemy.blinkRing) { fadeTelegraphRing(enemy.blinkRing); enemy.blinkRing = null; }
    if (enemy.barrageQueue) { for (const s of enemy.barrageQueue) fadeTelegraphRing(s.ring); enemy.barrageQueue.length = 0; }
    enemy.barrageActive = false;
    enemy.mesh.visible = false;
    enemyRemovalQueue.push(enemy);
    game.killed++;
    updateObjective();
    const xpReward = enemy.xp * 3 + 4;
    const ammoGain = 3 + enemy.xp * 2 + Math.floor(game.wave * 0.3);
    const localKiller = !net?.active || !killerId || killerId === myNetId;
    if (localKiller) {
      player.totalKills++;
      player.killStreak++;
      player.streakTimer = 4;
      addPlayerXp(xpReward);
      for (const gun of Object.values(allGuns)) gun.ammo = Math.min(gun.ammo + ammoGain, 240);
    } else if (isCoopHost()) {
      net.send({
        t: "reward",
        id: myNetId,
        seq: nextNetSeq(),
        sentAt: Math.round(performance.now()),
        target: killerId,
        xp: xpReward,
        ammo: ammoGain,
        enemy: enemy.typeName,
      });
    }
    playKillConfirmation(enemy, enemy.killHeadshot, localKiller);
    sfxKill();
    addKillFeed(enemy.typeName.toUpperCase());
    const killScore = registerKillScore(enemy, enemy.killHeadshot);
    if (isCoopHost()) {
      // Broadcast kill to all guests so they see the kill feed, score breakdown, and sfx.
      // Guests who are the killer skip it (they already received their own via `reward`).
      net.send({ t: "kill", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()),
        typeName: enemy.typeName, killer: killerId, hs: !!enemy.killHeadshot,
        pts: killScore.points, tags: killScore.tags });
    }
    enemy.killHeadshot = false;
    if (localKiller) updateStreak();
    updateObjective();
    if (game.totalEnemies > 0 && game.killed >= game.totalEnemies) setTimeout(() => nextWave(), 520);
  }

  function flushPendingEnemyDeaths(limit = 1) {
    // Perform lightweight bookkeeping (scores/sfx/UI) immediately but
    // defer scene removals to `processEnemyRemovals` to avoid frame hitches.
    for (let i = 0; i < limit && pendingEnemyDeaths.length; i++) {
      const enemy = pendingEnemyDeaths.shift();
      enemy.deathQueued = false;
      // mark invisible now; actual scene removal will happen later
      deactivateEnemyRuntimeLights(enemy);
      if (enemy.mesh) enemy.mesh.visible = false;
      enemyRemovalQueue.push(enemy);
      game.killed++;
      updateObjective();
      player.totalKills++;
      player.killStreak++;
      player.streakTimer = 4;
      addPlayerXp(enemy.xp * 3 + 4);
      playKillConfirmation(enemy, enemy.killHeadshot, true);
      sfxKill();
      addKillFeed(enemy.typeName.toUpperCase());
      const killScore = registerKillScore(enemy, enemy.killHeadshot);
      if (isCoopHost()) {
        net.send({ t: "kill", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()),
          typeName: enemy.typeName, killer: myNetId, hs: !!enemy.killHeadshot,
          pts: killScore.points, tags: killScore.tags });
      }
      enemy.killHeadshot = false;
      const ammoGain = 3 + enemy.xp * 2 + Math.floor(game.wave * 0.3);
      for (const gun of Object.values(allGuns)) gun.ammo = Math.min(gun.ammo + ammoGain, 240);
      updateStreak();
      updateObjective();
      if (game.totalEnemies > 0 && game.killed >= game.totalEnemies) setTimeout(() => nextWave(), 520);
    }
  }

  function processEnemyRemovals(limit = 3) {
    // Process removals up to a small budget (count-based + time-based) to avoid long frame hitches
    const timeBudgetMs = 2; // cap extra work to ~2ms
    const start = performance.now();
    let processed = 0;
    while (enemyRemovalQueue.length && processed < limit) {
      const enemy = enemyRemovalQueue.shift();
      if (enemy.mesh) scene.remove(enemy.mesh);
      enemy.removed = true;
      processed++;
      if (performance.now() - start > timeBudgetMs) break;
    }
  }

  async function nextWave() {
    if (isCoopGuest()) return; // host drives wave progression in co-op
    if (game.state !== "playing" || game.waveSpawning || game.transitioning) return;
    // Stale setTimeout from a previous wave: totalEnemies is 0 (not yet set) or not all
    // enemies have been accounted for yet — bail out to avoid wiping a freshly spawned wave.
    if (game.totalEnemies <= 0 || game.killed < game.totalEnemies) return;
    if (enemies.some(e => e.alive)) return;
    game.waveSpawning = true;
    game.transitioning = true;
    game.state = "transition";
    syncGameplayBodyClass();
    try {
      // Speed bonus for clearing the wave quickly (decays from 500 over ~50s).
      const clearTime = (performance.now() - game.waveStartTime) / 1000;
      const speedBonus = Math.max(0, Math.round((500 - clearTime * 10) / 10) * 10);
      if (speedBonus > 0) {
        game.score += speedBonus;
        if (game.score > game.bestScore) {
          game.bestScore = game.score;
          saveSettings({ bestScore: game.bestScore });
        }
        addKillFeed(`+${speedBonus} FAST CLEAR`);
        updateScoreHud();
      }
      if (isCoopHost() && speedBonus > 0) pendingSpeedBonus = speedBonus;
      announce('vo_wave_clear');
      playEventSound('wave_clear', { volume: 0.6 });
      game.wave++;
      addKillFeed(`WAVE ${game.wave} INCOMING`);
      applyWaveLighting(game.wave, true);
      const waveAmmoBonus = 24 + Math.min(26, game.wave * 2);
      for (const gun of Object.values(allGuns)) gun.ammo = Math.min(gun.ammo + waveAmmoBonus, 240);
      player.hp = Math.min(100, player.maxHp);
      placePlayerForWave(game.wave);
      updateHUD(0);
      await new Promise(resolve => setTimeout(resolve, 220));
      await waitFrame();
      await spawnEnemies(game.wave, { smooth: true, minDistance: 20 });
      ensureAllLiveEnemiesVisible();
      // Blackout wave: the fire sky (applyWaveLighting above) + enemies now
      // exist — run the local-only intro cutscene. Non-blocking: gameplay state
      // flips to "playing" below; the cutscene freezes input/AI via its flag.
      if (game.wave % 10 === 0) startBlackoutCutscene();
      announce('vo_wave_start');
      playEventSound('wave_start', { volume: 0.6 });
      game.waveStartTime = performance.now();
      game.state = "playing";
      syncGameplayBodyClass();
      updateHUD(0);
    } catch (err) {
      console.error("Wave transition failed:", err);
      game.state = "playing";
      syncGameplayBodyClass();
    } finally {
      game.waveSpawning = false;
      game.transitioning = false;
    }
  }

  function updateStreak() {
    if (!hud.streakBlock || !hud.streakVal) return;
    if (player.killStreak >= 2) {
      hud.streakBlock.classList.add("active");
      const labels = ["", "", "DOUBLE KILL", "TRIPLE KILL", "QUAD KILL", "RAMPAGE", "UNSTOPPABLE", "GODLIKE"];
      hud.streakVal.textContent = labels[Math.min(player.killStreak, labels.length - 1)] || `${player.killStreak}x KILLSTREAK`;
    } else {
      hud.streakBlock.classList.remove("active");
    }
  }

  function updateScoreHud() {
    setTextIfChanged(hud.scoreVal, game.score.toLocaleString());
    setTextIfChanged(hud.bestScoreVal, Math.max(game.bestScore, game.score).toLocaleString());
  }

  function playKillConfirmation(enemy, headshot = false, localKiller = true) {
    if (!localKiller) return;
    cameraFX.shake = Math.min(1, cameraFX.shake + (headshot ? 0.2 : 0.12));
    cameraFX.rollVel += (Math.random() > 0.5 ? 1 : -1) * (headshot ? 0.7 : 0.42);
    pushCrosshairKick(headshot ? 0.18 : 0.12);
    if (enemy?.mesh?.position) {
      impactNormalTmp.set(
        enemy.mesh.position.x - yaw.position.x,
        0,
        enemy.mesh.position.z - yaw.position.z
      ).normalize();
      spawnImpactParticles(enemy.mesh.position, impactNormalTmp, headshot ? 7 : 5);
    }
  }

  // Awards score for a kill, applying headshot and multi-kill bonuses, and
  // surfaces the breakdown in the kill feed. Shared by every kill path.
  function registerKillScore(enemy, headshot) {
    if (game.multiKillTimer > 0) game.multiKillCount++;
    else game.multiKillCount = 1;
    game.multiKillTimer = 1.6;

    let points = 100 + (enemy.xp || 0) * 25;
    const tags = [];
    if (headshot) {
      points += 75;
    }
    const mk = game.multiKillCount;
    if (mk >= 2) {
      points = Math.round(points * (1 + (mk - 1) * 0.5));
      const mkLabels = { 2: "DOUBLE", 3: "TRIPLE", 4: "QUAD" };
      tags.push(`${mkLabels[mk] || mk + "x"} KILL`);
    }

    game.score += points;
    if (game.score > game.bestScore) {
      game.bestScore = game.score;
      saveSettings({ bestScore: game.bestScore });
    }
    addKillFeed(tags.length ? `+${points} ${tags.join(" ")}` : `+${points}`);
    updateScoreHud();
    return { points, tags };
  }

  function tryReload() {
    if ((player.nullLockTimer || 0) > 0) return; // Null Field: reload suppressed
    if (gunState.reloadTimer > 0) return;
    if (gunState.mag >= gunState.magSize) return;
    if (gunState.ammo <= 0) return;
    gunState.reloadTimer = weaponAnim.animSpec.reloadDuration;
    weaponAnim.reloadJolt = 1;
    thirdPerson.reloadTimer = Math.max(thirdPerson.reloadTimer, gunState.reloadTimer);
    sfxReload();
  }

  function finishReload() {
    const need = gunState.magSize - gunState.mag;
    const take = Math.min(need, gunState.ammo);
    gunState.mag += take;
    gunState.ammo -= take;
    gunState.isAutoReloading = false;
    weaponAnim.slideKick = Math.max(weaponAnim.slideKick, 0.8);
    weaponAnim.reloadJolt = 1;
  }

  function playLocalDeathAnimation() {
    if (!thirdPerson.ready) createThirdPersonCharacter();
    if (thirdPerson.ready && thirdPerson.actions.death) {
      setThirdPersonAction("death", 0.05);
      thirdPerson.mixer?.update?.(0.016);
    }
  }

  function enterLocalDeathView() {
    if (player.unlimitedHealth) return;
    player.hp = 0;
    player.pvpDead = true;
    player.respawnTimer = 0;
    player.preDeathThirdPerson = thirdPerson.enabled;
    player.jumpVel = 0;
    player.jumpOffset = 0;
    player.grounded = true;
    player.killStreak = 0;
    player.streakTimer = 0;
    mouse.down = false;
    mouse.aiming = false;
    viewState.ads = 0;
    for (const g of Object.values(allGuns)) {
      g.fireCooldown = Math.max(g.fireCooldown, 0.18);
      g.reloadTimer = 0;
      g.muzzleTimer = 0;
      g.isAutoReloading = false;
    }
    setThirdPersonEnabled(true, false);
    playLocalDeathAnimation();
    updateStreak();
    updateHUD(0);
    lastStateSend = 0;
  }

  function beginNetworkedPlayerDeath(respawnSeconds, feedText = "OPERATOR DOWN") {
    if (player.pvpDead || player.unlimitedHealth) return;
    enterLocalDeathView();
    player.respawnTimer = Math.max(0.1, respawnSeconds || PVP_RESPAWN_SECONDS);
    if (feedText) addKillFeed(feedText);
  }

  function endGame(kind) {
    if (game.state === "dead" || game.state === "won") return;
    cancelCutscene(); // restore camera/HUD/letterbox if a cutscene was running
    if (kind === "dead" && net?.active && gameMode === "coop") {
      beginNetworkedPlayerDeath(COOP_RESPAWN_SECONDS, "DOWNED - RESPAWN IN 10");
      return;
    }
    if (kind === "dead") {
      enterLocalDeathView();
      // Fade the 3D view to black (~2.5 s) under the HUD/stats overlay while the
      // death animation plays. Cleared by resetPlayer on restart/new mission.
      startDeathFade();
      announce('vo_mission_fail', { minGap: 0 });
      playEventSound('mission_fail', { volume: 0.8 });
    }
    game.state = kind;
    syncGameplayBodyClass();
    disablePlayerFlashlightRig();
    game.elapsedTime = (performance.now() - game.startTime) / 1000;
    stateOverlay?.classList.add("active");
    document.exitPointerLock?.();

    const accuracy = player.shotsFired > 0 ? Math.round((player.shotsHit / player.shotsFired) * 100) : 0;
    const minutes = Math.floor(game.elapsedTime / 60);
    const seconds = Math.round(game.elapsedTime % 60);
    const timeStr = `${minutes}:${String(seconds).padStart(2, "0")}`;

    if (stateTitle) {
      stateTitle.textContent = kind === "won" || kind === "waveclear" ? "ROOM CLEARED" : "MISSION FAILED";
      stateTitle.className = kind === "won" || kind === "waveclear" ? "won" : "dead";
    }
    if (hud.objective) hud.objective.textContent = kind === "won" || kind === "waveclear" ? "OBJECTIVE COMPLETE" : "OPERATOR DOWN";
    if (stateSub) stateSub.textContent = kind === "dead" ? "OPERATOR DOWN - REVIEW STATS" : "PRESS SPACE TO PLAY AGAIN";
    if (stateActions) stateActions.classList.toggle("hidden", false);
    if (statsPanel) {
      statsPanel.innerHTML = `
        <div class="stat-row"><span>Score</span><span>${game.score.toLocaleString()}</span></div>
        <div class="stat-row"><span>Best Score</span><span>${Math.max(game.bestScore, game.score).toLocaleString()}</span></div>
        <div class="stat-row"><span>Wave Reached</span><span>${game.wave}</span></div>
        <div class="stat-row"><span>Drones Eliminated</span><span>${player.totalKills}</span></div>
        <div class="stat-row"><span>Accuracy</span><span>${accuracy}%</span></div>
        <div class="stat-row"><span>Shots Fired</span><span>${player.shotsFired}</span></div>
        <div class="stat-row"><span>Time Survived</span><span>${timeStr}</span></div>
      `;
    }
  }

  // Returns true if the player's upright body intersects any prop AABB.
  // Dim the (global, non-occluding) exterior sun + sky by the player's zone so the
  // roofed interior reads darker than the sunny outside — this is what fixes "player lit
  // the same inside and out". Runs every player-update frame.
  function updateZoneLighting() {
    const sun = window.__extSun;
    if (!sun) return;
    // OUTDOOR_MODE: the arena is now an open-air plaza (no roof), so the whole map is
    // daylit — no interior dimming. (Kept for the old indoor build / future covered areas.)
    return;
    // eslint-disable-next-line no-unreachable
    // 1 = fully inside the interior, 0 = out in the exterior; transition at the south exits.
    const inside = clamp01((124 - yaw.position.z) / 12);
    const t = inside * inside * (3 - 2 * inside); // smoothstep
    sun.intensity = (sun.userData.baseIntensity ?? 2.1) * (1 - 0.85 * t);
    const hemi = window.__extHemi;
    if (hemi) hemi.intensity = (hemi.userData.baseIntensity ?? 0.45) * (1 - 0.55 * t);
    if (scene.environment) scene.environmentIntensity = 0.45 * (1 - 0.68 * t);
  }

  // Highest prop top the player is standing over and can rest on (within a small
  // step-up reach of their current feet), else 0 (ground). This makes props act as
  // FLOORS you land on top of instead of falling into and getting boxed-in.
  function propTopAt(x, z, radius) {
    const colliders = scene.userData.propColliders;
    if (!colliders) return 0;
    const reach = (player.jumpOffset || 0) + 0.35; // don't snap up onto things above the feet
    let top = 0;
    for (const c of colliders) {
      const cmax = c.maxY ?? 0;
      if (cmax <= top || cmax > reach) continue;
      if (x + radius > c.minX && x - radius < c.maxX && z + radius > c.minZ && z - radius < c.maxZ) top = cmax;
    }
    return top;
  }

  function propBlocksAt(x, z, radius, minY = PLAYER_FOOT_CLEARANCE, maxY = PLAYER_H) {
    const colliders = scene.userData.propColliders;
    if (!colliders) return false;
    for (const c of colliders) {
      if (x + radius > c.minX && x - radius < c.maxX &&
          z + radius > c.minZ && z - radius < c.maxZ &&
          minY < c.maxY && maxY > (c.minY ?? 0)) {
        return true;
      }
    }
    return false;
  }

  function rayAabb2DDistance(origin, dir, box, maxDist, expand = 0) {
    if ((box.maxY ?? 0) < PROP_WEAPON_CLIP_MIN_Y) return Infinity;

    const minX = box.minX - expand;
    const maxX = box.maxX + expand;
    const minZ = box.minZ - expand;
    const maxZ = box.maxZ + expand;
    const dx = dir.x;
    const dz = dir.z;
    let tMin = 0;
    let tMax = maxDist;

    if (Math.abs(dx) < 0.00001) {
      if (origin.x < minX || origin.x > maxX) return Infinity;
    } else {
      const inv = 1 / dx;
      let t1 = (minX - origin.x) * inv;
      let t2 = (maxX - origin.x) * inv;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return Infinity;
    }

    if (Math.abs(dz) < 0.00001) {
      if (origin.z < minZ || origin.z > maxZ) return Infinity;
    } else {
      const inv = 1 / dz;
      let t1 = (minZ - origin.z) * inv;
      let t2 = (maxZ - origin.z) * inv;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return Infinity;
    }

    return tMin >= 0 && tMin <= maxDist ? tMin : Infinity;
  }

  function nearestPropDistanceAhead(origin, dir, maxDist, expand = 0.1) {
    const colliders = scene.userData.propColliders;
    if (!colliders || !colliders.length) return Infinity;

    let best = Infinity;
    for (const c of colliders) {
      const d = rayAabb2DDistance(origin, dir, c, maxDist, expand);
      if (d < best) best = d;
    }
    return best;
  }

  // Distance along `dir` to the first wall, using the same grid the player collides
  // against. This replaced raycaster.intersectObjects(wallMeshes): the walls are merged
  // into a few large meshes, so each ray tested thousands of triangles, and the four
  // camera probes cost ~9ms/frame — over 40% of the frame budget. Walls are full-height,
  // so a 2D march along XZ is equivalent here (props are handled separately).
  const THIRD_PERSON_WALL_STEP = 0.18;
  function firstWallHitDistance(origin, dir, maxDist) {
    const horizLen = Math.hypot(dir.x, dir.z);
    if (horizLen < 1e-4) return Infinity; // straight up/down: no wall can block
    const ux = dir.x / horizLen;
    const uz = dir.z / horizLen;
    const maxHoriz = maxDist * horizLen; // dir is unit, so t along the ray covers t*horizLen in XZ
    for (let d = THIRD_PERSON_WALL_STEP; d <= maxHoriz; d += THIRD_PERSON_WALL_STEP) {
      if (wallAtWorldRadius(origin.x + ux * d, origin.z + uz * d, 0.05)) return d / horizLen;
    }
    return Infinity;
  }

  function resolveThirdPersonCameraPosition(shakeX, shakeY, shakeZ) {
    const origin = yaw.position;
    const forward = thirdPersonForwardTmp.set(-Math.sin(yaw.rotation.y), 0, -Math.cos(yaw.rotation.y));
    const right = thirdPersonRightTmp.set(Math.cos(yaw.rotation.y), 0, -Math.sin(yaw.rotation.y));
    const eyeHeight = PLAYER_H + THIRD_PERSON_CAMERA_HEIGHT;
    const aimT = viewState.ads || 0;
    const shoulderX = THIRD_PERSON_SHOULDER_X * (1 - aimT * 0.28);
    const distance = THIRD_PERSON_DISTANCE - aimT * 0.42;
    const candidates = [
      { x: shoulderX, y: THIRD_PERSON_SHOULDER_Y, z: distance, weight: 1.0 },
      { x: -shoulderX * 0.58, y: THIRD_PERSON_SHOULDER_Y + 0.06, z: distance * 0.9, weight: 0.82 },
      { x: shoulderX * 0.38, y: THIRD_PERSON_SHOULDER_Y + 0.12, z: distance + 0.18, weight: 0.7 },
      { x: shoulderX * 1.02, y: THIRD_PERSON_SHOULDER_Y - 0.04, z: Math.max(0.82, distance - 0.34), weight: 0.56 },
    ];

    let bestScore = -Infinity;
    for (const candidate of candidates) {
      thirdPersonCameraLocalTmp.set(
        candidate.x + shakeX * 0.45,
        candidate.y + shakeY * 0.45 + eyeHeight,
        candidate.z + shakeZ * 0.7
      );

      thirdPersonCameraWorldTmp
        .copy(origin)
        .addScaledVector(right, thirdPersonCameraLocalTmp.x)
        .addScaledVector(forward, -thirdPersonCameraLocalTmp.z);
      // Add the local Y (height) offset. NOTE: this was previously `.add(0, y, 0)`,
      // but THREE's Vector3.add() takes a SINGLE vector — passing three numbers set
      // the whole vector to NaN, which made every candidate score NaN and forced the
      // fallback branch below every frame (the wall-collision candidate scoring was
      // dead). Adding the component directly restores that system.
      thirdPersonCameraWorldTmp.y += thirdPersonCameraLocalTmp.y;

      const dir = thirdPersonCameraWorldTmp.sub(origin);
      const worldDist = dir.length();
      if (worldDist < 0.001) continue;

      dir.multiplyScalar(1 / worldDist);

      const wallDist = firstWallHitDistance(origin, dir, worldDist);
      const propHit = nearestPropDistanceAhead(origin, dir, worldDist, 0.16);
      const blockDist = Math.min(wallDist, propHit);
      const availableDist = Number.isFinite(blockDist)
        ? Math.max(0.42, blockDist - THIRD_PERSON_CAMERA_CLEARANCE)
        : worldDist;
      const ratio = Math.max(0.2, Math.min(1, availableDist / worldDist));
      const score = ratio * 12 + candidate.weight - Math.abs(candidate.x) * 0.1 + candidate.y * 0.08;

      if (score > bestScore) {
        bestScore = score;
        thirdPersonCameraSolvedTmp.copy(thirdPersonCameraLocalTmp).multiplyScalar(ratio);
      }
    }

    if (!Number.isFinite(bestScore)) {
      thirdPersonCameraSolvedTmp.set(
        THIRD_PERSON_SHOULDER_X,
        eyeHeight + THIRD_PERSON_SHOULDER_Y,
        THIRD_PERSON_DISTANCE
      );
    }

    return thirdPersonCameraSolvedTmp;
  }

  // ── Blackout-wave cutscene ─────────────────────────────────────────────────
  // Local-visual-only scripted camera when a blackout wave (wave % 10 === 0)
  // begins: (A) frame the molten sun on the fire dome, (B) crane-pan across the
  // spawned enemies, (C) blend to the LIVE third-person camera pose so gameplay
  // resumes with zero pop. No lights are touched, no reparenting: each frame we
  // compute a world-space pose and write it into camera's pitch-local transform
  // AFTER updateCameraFX has written the normal gameplay pose (which phase C
  // samples as its landing target). Runs independently on every client; never
  // blocks netcode (host keeps broadcasting frozen enemy snapshots).
  const cutscene: any = {
    active: false,
    phase: 0,           // 0 = sun, 1 = enemy pan, 2 = return-to-player
    t: 0,
    phaseT: 0,
    durA: 2.8,
    durB: 3.3,
    durC: 1.8,
    // Pose captured at each phase boundary — the "from" of the current blend.
    blendPos: new THREE.Vector3(),
    blendQuat: new THREE.Quaternion(),
    blendFov: 55,
    // Enemy-pan orbit parameters (computed at phase B entry). The pan is a LOW,
    // CLOSE hero shot: a blackout world viewed from the air is pitch black, so
    // aerials show nothing — the readable shot is a near-ground arc around the
    // enemy nearest the pack's centre, silhouetted against the fire sky.
    focus: new THREE.Vector3(),
    focusY: 0,
    orbitR: 5.5,
    orbitH: 2.2,
    orbitA0: 0,
    orbitSweep: 2.4,
    // Last pose the cutscene wrote (used to capture blends at boundaries).
    lastPos: new THREE.Vector3(),
    lastQuat: new THREE.Quaternion(),
    lastFov: 55,
    domReady: false,
    // Phase-B cinematic key-light boost (existing sun/hemi, intensity-only).
    lightBoosted: false,
    sunPrev: null,
    hemiPrev: null,
  };
  const cutsceneSunDirTmp = new THREE.Vector3();
  const cutsceneEyeTmp = new THREE.Vector3();
  const cutsceneTargetTmp = new THREE.Vector3();
  const cutsceneUpTmp = new THREE.Vector3(0, 1, 0);
  const cutsceneLookMatTmp = new THREE.Matrix4();
  const cutsceneQuatTmp = new THREE.Quaternion();
  const cutscenePitchQuatTmp = new THREE.Quaternion();
  const cutsceneLivePosTmp = new THREE.Vector3();
  const cutsceneLiveQuatTmp = new THREE.Quaternion();

  function cutsceneEase(x) { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); }
  // Softer, slower cinematic curve for the big camera moves (ease-in-out cubic).
  function cutsceneEaseCine(x) { const c = Math.max(0, Math.min(1, x)); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; }

  // Cinematic audio: a deep sub "boom" + descending drone when the cutscene
  // engages, and a short riser as it hands back to gameplay. Uses the shared
  // WebAudio synth (same bus/limiter as every other SFX).
  function sfxCutsceneHit() {
    playTone(46, "sine", 1.5, 0.5, 0, 0, 0, 30);        // deep sub boom, slides 46→30 Hz
    playSweep(150, 40, 1.7, 0.26, "sawtooth", 0.02, 0);  // ominous descending drone
    playNoise(1.3, 0.14, 220, "lowpass", 0, 0, 0.7);     // low rumble bed
  }
  function sfxCutsceneRiser() {
    playSweep(70, 320, 0.85, 0.20, "sine", 0, 0);        // rising whoosh into the action
    playTone(120, "triangle", 0.5, 0.16, 0, 0.4, 0, 320);
  }

  // Cinematic key light for the enemy pan: a blackout interior/exterior is near
  // pitch black, so the hero shot needs light to read. Boost the EXISTING ember
  // sun + hemi (intensity-only — never visibility, per the light-count shader-
  // cache invariant) for the duration of phase B, restore exactly after.
  function boostCutsceneKeyLight(on) {
    if (on === cutscene.lightBoosted) return;
    const extSun = window.__extSun, extHemi = window.__extHemi;
    if (on) {
      cutscene.lightBoosted = true;
      cutscene.sunPrev = extSun ? extSun.intensity : null;
      cutscene.hemiPrev = extHemi ? extHemi.intensity : null;
      if (extSun) extSun.intensity = Math.max(extSun.intensity, 2.6);
      if (extHemi) extHemi.intensity = Math.max(extHemi.intensity, 0.42);
    } else {
      cutscene.lightBoosted = false;
      if (extSun && cutscene.sunPrev !== null) extSun.intensity = cutscene.sunPrev;
      if (extHemi && cutscene.hemiPrev !== null) extHemi.intensity = cutscene.hemiPrev;
    }
  }

  // Letterbox bars + skip hint + HUD fade — all JS-created DOM/CSS so both HTML
  // entry points share it without markup edits (zero shader/light cost).
  function ensureCutsceneDom() {
    if (cutscene.domReady) return;
    cutscene.domReady = true;
    const style = document.createElement("style");
    style.textContent = `
      #rb-cut-top, #rb-cut-bottom { position: fixed; left: 0; right: 0; height: 12vh; background: #000; z-index: 60; transform: scaleY(0); transition: transform .9s cubic-bezier(.16,1,.3,1); pointer-events: none; }
      #rb-cut-top { top: 0; transform-origin: top; }
      #rb-cut-bottom { bottom: 0; transform-origin: bottom; }
      body.rb-cutscene #rb-cut-top, body.rb-cutscene #rb-cut-bottom { transform: scaleY(1); }
      /* Filmic vignette that fades in with the bars — pushes focus to centre. */
      #rb-cut-vig { position: fixed; inset: 0; z-index: 59; pointer-events: none; opacity: 0; transition: opacity .7s ease; background: radial-gradient(ellipse 128% 92% at 50% 48%, transparent 40%, rgba(0,0,0,.34) 74%, rgba(0,0,0,.76) 100%); }
      body.rb-cutscene #rb-cut-vig { opacity: 1; }
      /* Title card — driven by JS opacity so its fade is keyed to phase A. */
      #rb-cut-title { position: fixed; left: 0; right: 0; top: 34%; text-align: center; z-index: 62; pointer-events: none; opacity: 0;
        font: 800 clamp(40px, 7.4vw, 96px)/1 "Segoe UI", system-ui, sans-serif; letter-spacing: .17em; text-transform: uppercase; color: #ffe6c6;
        text-shadow: 0 0 26px rgba(255,96,24,.72), 0 0 70px rgba(255,42,0,.5), 0 3px 10px rgba(0,0,0,.92); }
      #rb-cut-sub { position: fixed; left: 0; right: 0; top: calc(34% + clamp(50px, 8.6vw, 118px)); text-align: center; z-index: 62; pointer-events: none; opacity: 0;
        font: 600 clamp(13px, 1.7vw, 21px)/1 "Segoe UI", system-ui, sans-serif; letter-spacing: .46em; text-transform: uppercase; color: rgba(255,176,128,.92); text-shadow: 0 2px 8px rgba(0,0,0,.92); }
      #hud { transition: opacity .4s; }
      body.rb-cutscene #hud { opacity: 0 !important; }
    `;
    document.head.appendChild(style);
    const top = document.createElement("div"); top.id = "rb-cut-top";
    const bottom = document.createElement("div"); bottom.id = "rb-cut-bottom";
    const vig = document.createElement("div"); vig.id = "rb-cut-vig";
    const title = document.createElement("div"); title.id = "rb-cut-title"; title.textContent = "";
    const sub = document.createElement("div"); sub.id = "rb-cut-sub";
    document.body.append(top, bottom, vig, title, sub);
    cutscene.titleEl = title;
    cutscene.subEl = sub;
  }

  function setCutsceneDomActive(on) {
    ensureCutsceneDom();
    document.body.classList.toggle("rb-cutscene", on);
  }

  function captureCutsceneBlendFrom(pos, quat, fov) {
    cutscene.blendPos.copy(pos);
    cutscene.blendQuat.copy(quat);
    cutscene.blendFov = fov;
  }

  function startBlackoutCutscene(force = false) {
    if (cutscene.active) return false;
    if (!force && (game.wave % 10 !== 0 || game.wave < 10)) return false;
    cutscene.active = true;
    cutscene.phase = 0;
    cutscene.t = 0;
    cutscene.phaseT = 0;
    cutscene.durC = 1.8;
    // Blend in from wherever the gameplay camera is right now.
    camera.getWorldPosition(cutscene.lastPos);
    camera.getWorldQuaternion(cutscene.lastQuat);
    cutscene.lastFov = camera.fov;
    captureCutsceneBlendFrom(cutscene.lastPos, cutscene.lastQuat, cutscene.lastFov);
    setCutsceneDomActive(true);
    ensureCutsceneDom();
    sfxCutsceneHit();
    return true;
  }

  function cancelCutscene() {
    if (!cutscene.active && !document.body.classList.contains("rb-cutscene")) return;
    cutscene.active = false;
    boostCutsceneKeyLight(false);
    if (cutscene.titleEl) cutscene.titleEl.style.opacity = "0";
    if (cutscene.subEl) cutscene.subEl.style.opacity = "0";
    setCutsceneDomActive(false);
  }

  // Blackout cutscenes are unskippable — this is a no-op left in place for the
  // test hook (window.__rbCutscene.skipCutscene) and any lingering callers.
  function requestCutsceneSkip() {
    return;
  }
  // Swallow key/click input during the cutscene so it never leaks into gameplay,
  // but do NOT skip — the cutscene must play out in full.
  window.addEventListener("keydown", (e) => {
    if (cutscene.active && cutscene.phase < 2) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener("mousedown", (e) => {
    if (cutscene.active && cutscene.phase < 2) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Centroid + spread of live enemies (host: enemies[]; coop guest: proxies).
  function computeCutsceneEnemyFocus() {
    // Centroid of everything alive, then pick the HERO: the enemy nearest that
    // centroid. The pan frames the hero up close (silhouette against the fire
    // sky / glowing emissives in the dark) — spawn scatter makes a wide "show
    // them all" shot read as empty blackness, so we show one, dramatically,
    // with whatever packmates fall into frame behind it.
    let n = 0;
    let cx = 0, cz = 0;
    const collect = [];
    for (const enemy of liveEnemies) {
      if (!enemy.mesh) continue;
      collect.push(enemy.mesh.position);
      cx += enemy.mesh.position.x; cz += enemy.mesh.position.z; n++;
    }
    if (typeof coopProxies !== "undefined") {
      for (const proxy of coopProxies.values()) {
        if (!proxy?.mesh) continue;
        collect.push(proxy.mesh.position);
        cx += proxy.mesh.position.x; cz += proxy.mesh.position.z; n++;
      }
    }
    if (n === 0) {
      cutscene.focus.set(yaw.position.x, 0, yaw.position.z);
      cutscene.focusY = 0;
      cutscene.orbitR = 7;
      return;
    }
    cx /= n; cz /= n;
    let hero = collect[0];
    let bestD = Infinity;
    for (const p of collect) {
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d < bestD) { bestD = d; hero = p; }
    }
    cutscene.focus.set(hero.x, 0, hero.z);
    cutscene.focusY = hero.y;
    // Slightly wider when more enemies are up, so packmates catch the frame edge.
    cutscene.orbitR = Math.min(8.5, 5 + n * 0.35);
  }

  function cutsceneLookQuat(eye, target, outQuat) {
    cutsceneLookMatTmp.lookAt(eye, target, cutsceneUpTmp);
    return outQuat.setFromRotationMatrix(cutsceneLookMatTmp);
  }

  // Writes a WORLD pose into the camera's pitch-local transform (no reparenting).
  function applyCutsceneWorldPose(pos, quat, fov) {
    pitch.updateWorldMatrix(true, false);
    camera.position.copy(pos);
    pitch.worldToLocal(camera.position);
    pitch.getWorldQuaternion(cutscenePitchQuatTmp);
    camera.quaternion.copy(cutscenePitchQuatTmp.invert().multiply(quat));
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    cutscene.lastPos.copy(pos);
    cutscene.lastQuat.copy(quat);
    cutscene.lastFov = fov;
  }

  // Runs AFTER updateCameraFX each frame: the camera currently holds the exact
  // gameplay pose for this frame, which phase C samples live as its landing
  // target — guaranteeing a seamless handoff even if the player is mid-motion.
  function updateCutsceneCamera(dt) {
    if (!cutscene.active) return;
    if (game.state !== "playing" && game.state !== "transition") { cancelCutscene(); return; }
    // Live gameplay pose (what the normal TP camera wrote this frame).
    camera.getWorldPosition(cutsceneLivePosTmp);
    camera.getWorldQuaternion(cutsceneLiveQuatTmp);
    const liveFov = camera.fov;

    cutscene.t += dt;
    cutscene.phaseT += dt;

    // Title card: fades in ~0.4s into phase A, holds, fades out before phase B.
    if (cutscene.titleEl) {
      let o = 0;
      if (cutscene.phase === 0) {
        const fin = cutsceneEase((cutscene.phaseT - 0.4) / 0.8);
        const fout = 1 - cutsceneEase((cutscene.phaseT - (cutscene.durA - 0.6)) / 0.55);
        o = Math.max(0, Math.min(fin, fout));
      }
      cutscene.titleEl.style.opacity = o.toFixed(3);
      if (cutscene.subEl) cutscene.subEl.style.opacity = (o * 0.95).toFixed(3);
    }
    // Handheld "breathing": a tiny, slow, irregular positional drift so the
    // locked-off camera feels alive rather than sterile (applied to A/B eyes).
    const breatheX = Math.sin(cutscene.t * 0.8) * 0.10 + Math.sin(cutscene.t * 1.7 + 1.1) * 0.035;
    const breatheY = Math.sin(cutscene.t * 0.7 + 2.0) * 0.07 + Math.sin(cutscene.t * 2.3) * 0.02;

    if (cutscene.phase === 0 && cutscene.phaseT >= cutscene.durA) {
      cutscene.phase = 1;
      cutscene.phaseT = 0;
      captureCutsceneBlendFrom(cutscene.lastPos, cutscene.lastQuat, cutscene.lastFov);
      computeCutsceneEnemyFocus();
      boostCutsceneKeyLight(true);
      // Pick an arc with breathing room. Interior rooms are only 4-8 units wide,
      // so a blind 130° orbit at r≥5.5 spends most of its sweep clamped against
      // walls (point-blank framing). Scan azimuths around the hero and centre a
      // shorter ~80° sweep on the clearest direction instead.
      cutsceneTargetTmp.set(cutscene.focus.x, cutscene.focusY + 1.35, cutscene.focus.z);
      let bestAz = 0, bestClear = -1;
      for (let i = 0; i < 16; i++) {
        const scanAz = (i / 16) * Math.PI * 2;
        cutsceneSunDirTmp.set(Math.cos(scanAz), 0, Math.sin(scanAz));
        const d = firstWallHitDistance(cutsceneTargetTmp, cutsceneSunDirTmp, cutscene.orbitR + 1.5);
        const clear = Number.isFinite(d) ? d : cutscene.orbitR + 1.5;
        if (clear > bestClear) { bestClear = clear; bestAz = scanAz; }
      }
      cutscene.orbitR = Math.max(3.0, Math.min(cutscene.orbitR, bestClear - 1.0));
      cutscene.orbitSweep = 1.4;
      cutscene.orbitA0 = bestAz - cutscene.orbitSweep / 2;
    } else if (cutscene.phase === 1 && cutscene.phaseT >= cutscene.durB) {
      cutscene.phase = 2;
      cutscene.phaseT = 0;
      captureCutsceneBlendFrom(cutscene.lastPos, cutscene.lastQuat, cutscene.lastFov);
      boostCutsceneKeyLight(false);
      sfxCutsceneRiser();
    }

    if (cutscene.phase === 0) {
      // PHASE A — the molten sun reveal. KEY: the fire dome is CAMERA-LOCKED
      // (its horizon band always sits at the camera's own eye level), so a HIGH
      // camera gets a clean composition — burning sky filling the frame, the
      // city reduced to a dark silhouette in the bottom third, no rooftop
      // clutter. Classic reveal move: start tilted down at the dark city, tilt
      // up to the sun disc while drifting slowly toward it. Tight FOV (44) so
      // the disc reads as a DISC, not a smear inside the bright band.
      const k = cutsceneEaseCine(cutscene.phaseT / cutscene.durA);
      cutsceneSunDirTmp.copy(BLACKOUT_SUN_DIR).normalize();
      // Fixed high vantage over the arena (independent of where the player is —
      // they may be deep inside the roofed interior with no sky sightline).
      const ax = Math.max(-30, Math.min(30, yaw.position.x));
      const az = Math.max(20, Math.min(160, yaw.position.z));
      cutsceneEyeTmp.set(
        ax + cutsceneSunDirTmp.x * 11 * k + breatheX,
        44 + 3.5 * k + breatheY,
        az + cutsceneSunDirTmp.z * 11 * k
      );
      // Tilt-up: target slides from well below the horizon (dark city) up to the
      // sun disc's true elevation (BLACKOUT_SUN_DIR already encodes it).
      const tiltUp = cutsceneEaseCine(Math.min(1, cutscene.phaseT / (cutscene.durA * 0.7)));
      cutsceneTargetTmp.copy(cutsceneEyeTmp)
        .addScaledVector(cutsceneSunDirTmp, 300);
      cutsceneTargetTmp.y = cutsceneEyeTmp.y + (-95 + (cutsceneSunDirTmp.y * 300 + 95) * tiltUp);
      cutsceneLookQuat(cutsceneEyeTmp, cutsceneTargetTmp, cutsceneQuatTmp);
      // Ease in from the gameplay pose over the first ~0.7s (no engage jerk).
      const w = cutsceneEase(Math.min(1, cutscene.phaseT / 0.7));
      cutsceneEyeTmp.lerpVectors(cutscene.blendPos, cutsceneEyeTmp, w);
      cutsceneQuatTmp.slerpQuaternions(cutscene.blendQuat, cutsceneQuatTmp, w);
      applyCutsceneWorldPose(cutsceneEyeTmp, cutsceneQuatTmp, cutscene.blendFov + (44 - cutscene.blendFov) * w);
    } else if (cutscene.phase === 1) {
      // PHASE B — LOW hero-enemy arc. Aerials show nothing in a blacked-out
      // world; the readable shot is near-ground, close, arcing around the enemy
      // nearest the pack's centre so it silhouettes against the fire horizon /
      // shows its glowing emissives, with packmates catching the frame edges.
      const u = cutsceneEaseCine(cutscene.phaseT / cutscene.durB);
      const ang = cutscene.orbitA0 + cutscene.orbitSweep * u;
      // Crane down through the arc: 2.8 → 1.5 (drops to eye level as it circles).
      const h = 2.8 - 1.3 * u;
      // Slow dolly-in: radius eases from 1.12× to 0.9× across the sweep so the
      // shot gains momentum, pressing toward the hero as it settles.
      const dollyR = cutscene.orbitR * (1.12 - 0.22 * u);
      cutsceneEyeTmp.set(
        cutscene.focus.x + Math.cos(ang) * dollyR + breatheX,
        Math.max(1.1, cutscene.focusY + h - 1.6 + breatheY),
        cutscene.focus.z + Math.sin(ang) * dollyR
      );
      // Look slightly UP at the hero (chest/head height) — low angle against the
      // sky reads menacing and puts the fire horizon behind it when outdoors.
      cutsceneTargetTmp.set(cutscene.focus.x, cutscene.focusY + 1.35, cutscene.focus.z);
      // Rule-of-thirds: nudge the aim point sideways so the hero sits off-centre
      // (aim along the view's right axis → subject shifts to the left third).
      cutsceneUpTmp.set(0, 1, 0);
      cutsceneSunDirTmp.copy(cutsceneTargetTmp).sub(cutsceneEyeTmp).normalize();
      cutsceneSunDirTmp.cross(cutsceneUpTmp).normalize(); // camera-right
      cutsceneTargetTmp.addScaledVector(cutsceneSunDirTmp, 0.7);
      // Keep the arc out of walls: grid-march from the hero toward the desired
      // eye (cheap MAP walk, same as the TP camera — no raycasts) and pull the
      // eye in front of the first wall. Outdoors this is a no-op.
      {
        cutsceneSunDirTmp.copy(cutsceneEyeTmp).sub(cutsceneTargetTmp);
        const reach = cutsceneSunDirTmp.length();
        if (reach > 0.001) {
          cutsceneSunDirTmp.multiplyScalar(1 / reach);
          const wallDist = firstWallHitDistance(cutsceneTargetTmp, cutsceneSunDirTmp, reach);
          if (Number.isFinite(wallDist)) {
            const clamped = Math.max(2.6, wallDist - 0.9);
            cutsceneEyeTmp.copy(cutsceneTargetTmp).addScaledVector(cutsceneSunDirTmp, Math.min(reach, clamped));
          }
        }
      }
      cutsceneLookQuat(cutsceneEyeTmp, cutsceneTargetTmp, cutsceneQuatTmp);
      // Cross-blend from phase A's final pose over the first ~0.9s of the pan.
      const w = cutsceneEase(Math.min(1, cutscene.phaseT / 0.9));
      cutsceneEyeTmp.lerpVectors(cutscene.blendPos, cutsceneEyeTmp, w);
      cutsceneQuatTmp.slerpQuaternions(cutscene.blendQuat, cutsceneQuatTmp, w);
      applyCutsceneWorldPose(cutsceneEyeTmp, cutsceneQuatTmp, 50);
    } else {
      // PHASE C — blend from the pan's final pose to the LIVE third-person pose
      // (recomputed every frame above, so it lands perfectly mid-motion).
      const w = cutsceneEase(cutscene.phaseT / cutscene.durC);
      cutsceneEyeTmp.lerpVectors(cutscene.blendPos, cutsceneLivePosTmp, w);
      cutsceneQuatTmp.slerpQuaternions(cutscene.blendQuat, cutsceneLiveQuatTmp, w);
      applyCutsceneWorldPose(cutsceneEyeTmp, cutsceneQuatTmp, cutscene.blendFov + (liveFov - cutscene.blendFov) * w);
      if (cutscene.phaseT >= cutscene.durC) {
        // Land exactly on the gameplay pose, then hand control back.
        applyCutsceneWorldPose(cutsceneLivePosTmp, cutsceneLiveQuatTmp, liveFov);
        cancelCutscene();
      }
    }
  }

  function updateMovement(dt) {
    if (player.pvpDead) {
      hud.sprintInd?.classList.remove("active");
      return { f: 0, s: 0, sprinting: false, jumping: false };
    }
    if (cutscene.active) {
      hud.sprintInd?.classList.remove("active");
      return { f: 0, s: 0, sprinting: false, jumping: false };
    }
    let f = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    let s = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    let analogDrive = false;
    if (touchInput.move.active) {
      // Joystick: up (negative screen-y) = forward; right = strafe right.
      f = -touchInput.move.y;
      s = touchInput.move.x;
      analogDrive = true;
    }
    // Null Field debuff: sprint (and reload, see startReload) suppressed while locked.
    player.nullLockTimer = Math.max(0, (player.nullLockTimer || 0) - dt);
    const wantsSprintInput =
      ((keys.has("ShiftLeft") || keys.has("ShiftRight")) || touchInput.sprint) && (f || s) &&
      player.nullLockTimer <= 0;

    if (player.unlimitedSprint) {
      player.stamina = player.maxStamina;
      player.sprintExhausted = false;
    } else {
      if (player.stamina <= 0.5) player.sprintExhausted = true;
      if (!wantsSprintInput || player.stamina > 26) player.sprintExhausted = false;
      if (player.stamina <= 0.5) player.sprintExhausted = true;
    }

    const sprinting = wantsSprintInput && !player.sprintExhausted && (player.unlimitedSprint || player.stamina > 0);
    if (!player.unlimitedSprint) {
      if (sprinting) player.stamina = Math.max(0, player.stamina - player.staminaDrain * dt);
      else player.stamina = Math.min(player.maxStamina, player.stamina + player.staminaRegen * dt);
      if (player.stamina <= 0.5) player.sprintExhausted = true;
    }

    hud.sprintInd?.classList.toggle("active", sprinting);

    const adsPenalty = GUN_SPECS[currentGun]?.adsMovePenalty ?? 0.14;
    const aimSpeedMul = 1 - adsPenalty * viewState.ads;
    // Per-gun weight: heavy weapons (LMG/railgun) slow the carrier, sidearms speed up.
    const heldWeightMul = Number.isFinite(GUN_SPECS[currentGun]?.moveSpeedMul) ? GUN_SPECS[currentGun].moveSpeedMul : 1;
    const speed = (sprinting ? player.sprintSpeed : player.speed) * aimSpeedMul * player.effectSpeedMul * heldWeightMul;
    const len = Math.hypot(f, s) || 1;
    // Keyboard is always full-speed in its direction; analog joystick scales speed
    // by how far the stick is pushed (clamped to 1).
    const moveScale = analogDrive ? Math.min(1, Math.hypot(f, s)) : 1;

    const forward = movementForwardTmp.set(-Math.sin(yaw.rotation.y), 0, -Math.cos(yaw.rotation.y));
    const right = movementRightTmp.set(Math.cos(yaw.rotation.y), 0, -Math.sin(yaw.rotation.y));
    // Momentum: smooth the horizontal velocity toward the desired input velocity instead
    // of snapping. Weighty-but-responsive on the ground; floatier control in the air.
    const fn = (f / len) * moveScale, sn = (s / len) * moveScale;
    const desiredVX = (forward.x * fn + right.x * sn) * speed;
    const desiredVZ = (forward.z * fn + right.z * sn) * speed;
    const moving = !!(f || s);
    const airborne = !player.grounded || player.jumpOffset > 0.02;
    const moveLambda = airborne ? (moving ? 3.2 : 1.6) : (moving ? 15 : 13);
    player.velX = dampValue(player.velX || 0, desiredVX, moveLambda, dt);
    player.velZ = dampValue(player.velZ || 0, desiredVZ, moveLambda, dt);
    const delta = movementDeltaTmp.set(player.velX * dt, 0, player.velZ * dt);

    const r = player.radius;
    const steps = Math.max(1, Math.ceil(delta.length() / 0.16));
    const stepX = delta.x / steps;
    const stepZ = delta.z / steps;
    const bodyMinY = player.jumpOffset + PLAYER_FOOT_CLEARANCE;
    const bodyMaxY = player.jumpOffset + PLAYER_H;
    for (let i = 0; i < steps; i++) {
      const nx = yaw.position.x + stepX;
      const nz = yaw.position.z + stepZ;
      if (!wallAtWorldRadius(nx, yaw.position.z, r) && !propBlocksAt(nx, yaw.position.z, r, bodyMinY, bodyMaxY)) yaw.position.x = nx;
      if (!wallAtWorldRadius(yaw.position.x, nz, r) && !propBlocksAt(yaw.position.x, nz, r, bodyMinY, bodyMaxY)) yaw.position.z = nz;
    }

    // Hard world-boundary failsafe: even if the player clips through a wall, they
    // can never leave the playable box (interior ∪ exterior). Generous margins so
    // this only catches gross escapes — normal collision resolves well inside it.
    yaw.position.x = Math.max(WORLD_BOUND_X_MIN, Math.min(WORLD_BOUND_X_MAX, yaw.position.x));
    yaw.position.z = Math.max(WORLD_BOUND_Z_MIN, Math.min(WORLD_BOUND_Z_MAX, yaw.position.z));

    player.jumpCooldown = Math.max(0, player.jumpCooldown - dt);
    // Surface the player rests on: top of a prop they're above (crate/barrier), else ground.
    const groundOffset = propTopAt(yaw.position.x, yaw.position.z, r);
    if (keys.has("Space") && player.grounded && player.jumpCooldown <= 0) {
      player.grounded = false;
      player.jumpVel = JUMP_VELOCITY;
      player.jumpCooldown = 0.16;
      sfxJump(false);
    }

    if (!player.grounded || player.jumpOffset > groundOffset + 0.001) {
      player.jumpVel -= JUMP_GRAVITY * dt;
      player.jumpOffset = Math.min(MAX_JUMP_OFFSET + groundOffset, player.jumpOffset + player.jumpVel * dt);
      if (player.jumpOffset <= groundOffset) {
        if (!player.grounded && player.jumpVel < -2.2) sfxJump(true);
        player.jumpOffset = groundOffset;   // land on the prop top (or ground)
        player.jumpVel = 0;
        player.grounded = true;
      }
    } else if (player.grounded) {
      if (groundOffset > player.jumpOffset + 0.001) player.jumpOffset = groundOffset;  // low step-up
      else if (groundOffset < player.jumpOffset - 0.001) player.grounded = false;      // walked off an edge → fall
    }

    updateZoneLighting();
    if (game.state === "playing" && player.hp > 0 && player.hp < 25) {
      const _now = performance.now() / 1000;
      if (_now - (player.lowHpVoAt || -999) > 12) { player.lowHpVoAt = _now; announce('vo_low_health'); }
    }

    let bobOffset = 0;
    let bobLateral = 0;
    if (f || s) {
      const bobT = performance.now() * (sprinting ? 0.0115 : 0.0056);
      const bobAmp = (sprinting ? 0.048 : 0.026) * (player.grounded ? 1 : 0.35);
      bobOffset = Math.sin(bobT * 2) * bobAmp;
      bobLateral = Math.cos(bobT) * bobAmp * 0.55;
      yaw.position.y = PLAYER_H + player.jumpOffset + bobOffset;
    } else {
      if (!player.grounded || player.jumpOffset > 0) yaw.position.y = PLAYER_H + player.jumpOffset;
      else yaw.position.y += (PLAYER_H - yaw.position.y) * 0.15;
    }
    player.bobLateral = bobLateral;

    return { f, s, sprinting, jumping: !player.grounded || player.jumpOffset > 0.02 };
  }

  function updateEnemies(dt) {
    // Blackout cutscene: freeze enemy AI/attacks in place (still rendered). The
    // co-op host keeps broadcasting these frozen positions, so guests stay in sync.
    if (cutscene.active) {
      for (const enemy of liveEnemies) ensureLiveEnemyVisible(enemy);
      return;
    }
    // Dev preview: freeze all enemy AI/movement in place (still rendered).
    if (devFreezeEnemies) {
      for (const enemy of liveEnemies) ensureLiveEnemyVisible(enemy);
      return;
    }
    const localPx = yaw.position.x;
    const localPz = yaw.position.z;
    if (!ai.initialized) {
      ai.playerPrevX = localPx;
      ai.playerPrevZ = localPz;
      ai.initialized = true;
    }
    const invDt = dt > 0 ? 1 / dt : 0;
    ai.playerVelX = (localPx - ai.playerPrevX) * invDt;
    ai.playerVelZ = (localPz - ai.playerPrevZ) * invDt;
    ai.playerPrevX = localPx;
    ai.playerPrevZ = localPz;
    const t = performance.now() * 0.003;
    let droneGlowAccum = 0;
    let auraSpeedMul = 1;
    let auraShake = 0;
    const lowEndWaveBudget = lowEndMode && game.wave >= 6 ? 3 : lowEndMode ? 2 : 1;
    let enemyIndex = 0;

    for (const enemy of liveEnemies) {
      ensureLiveEnemyVisible(enemy);
      const farEnemy = lowEndMode && game.wave >= 6 && enemyIndex > 2;
      enemyIndex++;

      enemy.hitStagger = Math.max(0, (enemy.hitStagger || 0) - dt);
      enemy.hitFlash = Math.max(0, (enemy.hitFlash || 0) - dt * 5.2);
      const knockSpeed = Math.hypot(enemy.hitKnockX || 0, enemy.hitKnockZ || 0);
      if (knockSpeed > 0.02) {
        tryMoveEnemyWithDetour(enemy, (enemy.hitKnockX || 0) * dt, (enemy.hitKnockZ || 0) * dt, {
          detour: false,
          targetX: enemy.mesh.position.x + (enemy.hitKnockX || 0),
          targetZ: enemy.mesh.position.z + (enemy.hitKnockZ || 0),
        });
        const decay = Math.max(0, 1 - dt * 8.4);
        enemy.hitKnockX *= decay;
        enemy.hitKnockZ *= decay;
      } else {
        enemy.hitKnockX = 0;
        enemy.hitKnockZ = 0;
      }

      if (farEnemy && ((game.frame + enemyIndex) % lowEndWaveBudget !== 0)) {
        enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt * 0.5);
        enemy.navTimer = Math.max(0, enemy.navTimer - dt * 0.5);
        enemy.strafeTimer = Math.max(0, enemy.strafeTimer - dt * 0.5);
        enemy.rangedCooldown = Math.max(0, (enemy.rangedCooldown || 0) - dt * 0.5);
        enemy.teleportCooldown = Math.max(0, (enemy.teleportCooldown || 0) - dt * 0.5);
        enemy.empCooldown = Math.max(0, (enemy.empCooldown || 0) - dt * 0.5);
        enemy.lightningStreamTimer = Math.max(0, (enemy.lightningStreamTimer || 0) - dt * 0.5);
        enemy.lightningDamageTimer = Math.max(0, (enemy.lightningDamageTimer || 0) - dt * 0.5);
        enemy.lightningSfxTimer = Math.max(0, (enemy.lightningSfxTimer || 0) - dt * 0.5);
        continue;
      }
      
      // NOTE: the character AnimationMixer is advanced exactly once per frame at the
      // LOD-aware call site further below. A second unconditional update here was
      // double-driving the skinned rigs (2× animation speed + walk/run cross-fade
      // thrash), which is what deformed/froze the zombies and dropped them back to
      // sliding. Do not re-add an update here.
      let enemyTarget = getCoopEnemyTarget(enemy, localPx, localPz);
      // Car-alarm sound lure: while a triggered alarm rings, every brain steers
      // toward the noise instead of the player (the lure replaces the perceived
      // target, so nav/brains/aim all follow it without per-brain special cases).
      if (soundLure.until > 0 && performance.now() / 1000 < soundLure.until) {
        enemyTarget = { x: soundLure.x, z: soundLure.z, vx: 0, vz: 0 } as any;
        enemy.aggroed = true;
        enemy.lastSeenX = soundLure.x;
        enemy.lastSeenZ = soundLure.z;
        enemy.lastSeenTimer = Math.max(enemy.lastSeenTimer || 0, 0.5);
      }
      const px = enemyTarget.x;
      const pz = enemyTarget.z;
      const playerCell = worldToMap(px, pz);

      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
      enemy.navTimer = Math.max(0, enemy.navTimer - dt);
      enemy.strafeTimer = Math.max(0, enemy.strafeTimer - dt);
      enemy.attackPulse = Math.max(0, enemy.attackPulse - dt * 2.35);
      if (enemy.isAttacking && enemy.attackPulse <= 0) enemy.isAttacking = false;
      enemy.lungeTimer = Math.max(0, enemy.lungeTimer - dt);
      enemy.lungeBoost = Math.max(0, enemy.lungeBoost - dt * 2.7);
      enemy.rangedCooldown = Math.max(0, (enemy.rangedCooldown || 0) - dt);
      enemy.teleportCooldown = Math.max(0, (enemy.teleportCooldown || 0) - dt);
      enemy.empCooldown = Math.max(0, (enemy.empCooldown || 0) - dt);
      enemy.lightningStreamTimer = Math.max(0, (enemy.lightningStreamTimer || 0) - dt);
      enemy.lightningDamageTimer = Math.max(0, (enemy.lightningDamageTimer || 0) - dt);
      enemy.lightningSfxTimer = Math.max(0, (enemy.lightningSfxTimer || 0) - dt);
      enemy.directChaseTimer = Math.max(0, enemy.directChaseTimer - dt);
      enemy.lastSeenTimer = Math.max(0, enemy.lastSeenTimer - dt);
      enemy.avoidTimer = Math.max(0, (enemy.avoidTimer || 0) - dt);
      enemy.smartThinkTimer = Math.max(0, (enemy.smartThinkTimer || 0) - dt);
      enemy.smartUnstuckTimer = Math.max(0, (enemy.smartUnstuckTimer || 0) - dt);
      enemy.liftTimer = Math.max(0, (enemy.liftTimer || 0) - dt);
      if (enemy.aggroed && !enemy.mesh.userData.clonedGhostModel && enemy.liftTimer <= 0 && enemy.liftPhase <= 0) {
        enemy.liftDuration = enemy.typeName === "Siege Drone" ? 0.85 + Math.random() * 0.40 : 0.62 + Math.random() * 0.28;
        enemy.liftPhase = enemy.liftDuration;
        // Warden lifts more frequently at low HP — survival aggression
        const hpFrac = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
        const liftCooldown = enemy.typeName === "Siege Drone"
          ? (hpFrac < 0.4 ? 0.8 + Math.random() * 0.9 : 1.4 + Math.random() * 1.6)
          : 0.9 + Math.random() * 1.8;
        enemy.liftTimer = liftCooldown;
      }
      if (enemy.liftPhase > 0) {
        enemy.liftPhase = Math.max(0, enemy.liftPhase - dt);
        const liftT = 1 - enemy.liftPhase / Math.max(0.001, enemy.liftDuration || 1);
        // Character model lift is purely visual — driven by animation, so use a large
        // amplitude that the storm_warden.js liftPh input can act on
        const liftAmp = enemy.mesh.userData.siegeCharacterModel ? 1.10 : enemy.typeName === "Siege Drone" ? 0.58 : 0.38;
        enemy.verticalLift = Math.sin(liftT * Math.PI) * liftAmp;
      } else {
        enemy.verticalLift = 0;
      }

      const dirX = px - enemy.mesh.position.x;
      const dirZ = pz - enemy.mesh.position.z;
      const dist = Math.hypot(dirX, dirZ);
      const lod = dist > DRONE_LOD_FAR ? 2 : dist > DRONE_LOD_NEAR ? 1 : 0;
      const lodStep = lod === 0 ? 1 : lod === 1 ? (lowEndMode ? 3 : 2) : (lowEndMode ? 5 : 4);
      const lodUpdate = ((game.frame + enemy.lodPhase) % lodStep) === 0;
      const profile = enemy.animProfile;
      const tactics = enemy.tactics;
      const isCharacterSiege = enemy.mesh.userData.siegeCharacterModel === true;
      const isClonedGhost = enemy.mesh.userData.clonedGhostModel === true;
      const isZombie = enemy.mesh.userData.zombieCharacterModel === true;
      const isCharacterEnemy = isCharacterSiege || isClonedGhost || isZombie;
      const isSmartSiege = enemy.typeName === "Siege Drone";
      const isSmartBot = true; // isSmartSiege || isClonedGhost;
      const frameStartX = enemy.mesh.position.x;
      const frameStartZ = enemy.mesh.position.z;
      // Cross-frame displacement. The movement step for this enemy runs LATER in the
      // frame, so (position - frameStart) is 0 at the point where the skinned walk/run
      // animation state is chosen. Diff against the position we recorded last frame to
      // get the enemy's real locomotion speed (1-frame latency, imperceptible). This is
      // what makes zombies actually walk/run instead of sliding in an idle pose.
      const locoMovedX = enemy.mesh.position.x - (enemy.locoPrevX ?? enemy.mesh.position.x);
      const locoMovedZ = enemy.mesh.position.z - (enemy.locoPrevZ ?? enemy.mesh.position.z);
      enemy.locoPrevX = enemy.mesh.position.x;
      enemy.locoPrevZ = enemy.mesh.position.z;
      const invDist = dist > 0.001 ? 1 / dist : 1;
      const dirNormX = dirX * invDist;
      const dirNormZ = dirZ * invDist;

      if (!Number.isFinite(enemy.visualYaw)) enemy.visualYaw = enemy.mesh.rotation.y;

      if (enemy.mesh && enemy.mesh.userData.mixer && (lod === 0 || !lowEndMode || lodUpdate)) {
        enemy.mesh.userData.mixer.update(lowEndMode && lod > 0 ? dt * lodStep : dt);
      }

      if (lod === 2) {
        if (enemy.aggroed && lodUpdate) {
          const targetX = enemy.lastSeenTimer > 0 ? enemy.lastSeenX : px;
          const targetZ = enemy.lastSeenTimer > 0 ? enemy.lastSeenZ : pz;
          const moveX = targetX - enemy.mesh.position.x;
          const moveZ = targetZ - enemy.mesh.position.z;
          const moveDist = Math.hypot(moveX, moveZ) || 1;
          const step = Math.min(enemy.speed * 0.22 * (0.5 + enemy.attackPulse * 0.1), moveDist);
          const tx = enemy.mesh.position.x + (moveX / moveDist) * step * dt * 60;
          const tz = enemy.mesh.position.z + (moveZ / moveDist) * step * dt * 60;
          tryMoveEnemyWithDetour(enemy, tx - enemy.mesh.position.x, tz - enemy.mesh.position.z, {
            detour: !isSmartBot,
            targetX,
            targetZ,
          });
        }

        if (isCharacterEnemy) {
          enemy.mesh.position.y = 0;
          enemy.mesh.scale.setScalar(1 + enemy.attackPulse * 0.015 + (enemy.hitFlash || 0) * 0.012);
        } else {
          enemy.mesh.position.y = profile.hoverBase + enemy.verticalLift + Math.sin(t * 0.72 + enemy.animSeed) * 0.028 + enemy.attackPulse * 0.02;
          enemy.mesh.scale.setScalar(1 + enemy.attackPulse * 0.03 + (enemy.hitFlash || 0) * 0.026);
        }
        if (lodUpdate) {
          const movedX = enemy.mesh.position.x - frameStartX;
          const movedZ = enemy.mesh.position.z - frameStartZ;
          const faceMove = isCharacterEnemy && !isSmartSiege && Math.hypot(movedX, movedZ) > 0.004;
          const targetYaw = faceMove
            ? yawFromDirection(movedX, movedZ)
            : yawFromDirection(px - enemy.mesh.position.x, pz - enemy.mesh.position.z) + (isSmartSiege ? Math.PI : 0);
          const prevYaw = enemy.visualYaw;
          enemy.visualYaw = dampValue(enemy.visualYaw, enemy.visualYaw + angleDelta(enemy.visualYaw, targetYaw), isCharacterEnemy ? 4.5 : 8, dt * lodStep);
          enemy.visualTurn = angleDelta(prevYaw, enemy.visualYaw) / Math.max(0.001, dt * lodStep);
          enemy.mesh.rotation.y = enemy.visualYaw;
        }
        continue;
      }

      let los = false;
      if (dist < enemy.aggroRange + 4) {
        if (lodUpdate) {
          los = hasLineOfSightWorld(enemy.mesh.position.x, enemy.mesh.position.z, px, pz, 0.22);
          enemy._lastLosResult = los;
          enemy._lastLosFrame = game.frame;
        } else {
          los = !!enemy._lastLosResult;
        }
      }
      if (los) {
        enemy.lastSeenX = px + (enemyTarget.vx || 0) * tactics.predict;
        enemy.lastSeenZ = pz + (enemyTarget.vz || 0) * tactics.predict;
        enemy.lastSeenTimer = 3.2;
        if (dist < enemy.aggroRange) enemy.aggroed = true;
      } else if (!enemy.aggroed) {
        for (const ally of liveEnemies) {
          if (ally === enemy || !ally.aggroed) continue;
          if (Math.hypot(ally.mesh.position.x - enemy.mesh.position.x, ally.mesh.position.z - enemy.mesh.position.z) > 13) continue;
          enemy.aggroed = true;
          enemy.lastSeenX = ally.lastSeenX ?? px;
          enemy.lastSeenZ = ally.lastSeenZ ?? pz;
          enemy.lastSeenTimer = 1.8;
          break;
        }
      }
      const megaBlasting = updateNullCherubMegaBlast(enemy, dt, px, pz, dist, los, enemyTarget);
      if (game.state !== "playing") return;
      if (!megaBlasting && enemy.ranged && enemy.aggroed && los && dist <= enemy.ranged.range && enemy.rangedCooldown <= 0) {
        if (isClonedGhost) fireClonedGhostShot(enemy, px, pz, enemyTarget);
        else fireEnemyShotgunBurst(enemy, px, pz, enemyTarget);
        if (game.state !== "playing") return;
      }
      if (!megaBlasting && tryEnemyTeleport(enemy, px, pz, enemyTarget, dt)) {
        if (game.state !== "playing") return;
      }
      // AFTERIMAGE FEINT (Seraph): taking fire while the blink is down triggers a
      // short untelegraphed lateral hop, leaving a fizzing afterimage where it stood.
      if (enemy.typeName === "Blink Seraph" && !megaBlasting && (enemy.blinkHold || 0) <= 0 && enemy.teleportCooldown > 0.5) {
        enemy.feintCooldown = Math.max(0, (enemy.feintCooldown || 0) - dt);
        if ((enemy.hitFlash || 0) > 0.1 && enemy.feintCooldown <= 0) {
          const baseAng = Math.atan2(enemy.mesh.position.z - pz, enemy.mesh.position.x - px);
          for (let i = 0; i < 6; i++) {
            const side = i % 2 === 0 ? 1 : -1;
            const ang = baseAng + side * (Math.PI / 2) * (0.7 + Math.random() * 0.5);
            const hop = 3.0 + Math.random() * 1.5;
            const hx = enemy.mesh.position.x + Math.cos(ang) * hop;
            const hz = enemy.mesh.position.z + Math.sin(ang) * hop;
            const hc = worldToMap(hx, hz);
            if (!isOpenCell(hc.mx, hc.my) || enemyBlockedAt(enemy, hx, hz)) continue;
            const fromX = enemy.mesh.position.x, fromZ = enemy.mesh.position.z;
            // Afterimage: a fading ring + a brief fizzing pillar where it WAS.
            const ghost = spawnTelegraphRing(fromX, fromZ, 0.7, 0xb28cff, 0.05, { peak: 0.4, pulse: false });
            fadeTelegraphRing(ghost);
            enemyShotOriginTmp.set(fromX, 0.06, fromZ);
            teslaBranchTmp.set(fromX, 2.2, fromZ);
            spawnLightningEffect(enemyShotOriginTmp, teslaBranchTmp, 0.5, { segments: 4, branches: 1, sourceBranches: 0, jitter: 0.24, lift: 0, life: 0.12, rings: false, electric: true, maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS });
            enemy.mesh.position.x = hx;
            enemy.mesh.position.z = hz;
            enemy.navPath = [];
            enemy.navTimer = 0;
            enemy.feintCooldown = 2.5 + Math.random() * 1.2;
            break;
          }
        }
      }
      // NULL FIELD: 0.6s wind-up — an expanding teal ring at the Cherub's feet is
      // the countdown; escape its radius before it fills to dodge the blast+debuff.
      if (!megaBlasting && enemy.emp && enemy.aggroed && enemy.empCooldown <= 0) {
        if ((enemy.empWindUp || 0) > 0) {
          enemy.empWindUp = Math.max(0, enemy.empWindUp - dt);
          if (enemy.empRing) {
            enemy.empRing.radius = Math.max(0.3, enemy.emp.radius * (1 - enemy.empWindUp / 0.6));
            enemy.empRing.mesh.position.set(enemy.mesh.position.x, 0.06, enemy.mesh.position.z);
          }
          if (enemy.empWindUp <= 0) {
            if (enemy.empRing) { detonateTelegraphRing(enemy.empRing); enemy.empRing = null; }
            fireEmpBlast(enemy, px, pz, enemyTarget, true); // fires even if dodged — the dodge is the win
            if (game.state !== "playing") return;
          }
        } else if (dist <= enemy.emp.radius + 0.4) {
          enemy.empWindUp = 0.6;
          enemy.attackPulse = Math.max(enemy.attackPulse, 1.1);
          enemy.liftPhase = Math.max(enemy.liftPhase || 0, 0.5);
          enemy.liftDuration = Math.max(enemy.liftDuration || 0, 0.65);
          if (enemy.empRing) releaseTelegraphRing(enemy.empRing);
          enemy.empRing = spawnTelegraphRing(enemy.mesh.position.x, enemy.mesh.position.z, 0.3, 0x62ffd6, 0.6, { peak: 0.5 });
        }
      }
      // Warden signature: creeping artillery line (independent of the lance cooldown).
      if (isSmartSiege && !megaBlasting) {
        updateWardenBarrage(enemy, dt, px, pz, enemyTarget);
        if (game.state !== "playing") return;
      }
      // Heavy hit stagger cancels the lightning wind-up
      if ((enemy.hitStagger || 0) > 0.55 && enemy.lightningWindUp > 0) {
        enemy.lightningWindUp = 0;
        enemy.lightningStreamTimer = Math.max(enemy.lightningStreamTimer || 0, 0.45);
        if (enemy.telegraphRing) { fadeTelegraphRing(enemy.telegraphRing); enemy.telegraphRing = null; } // stagger interrupts the cast
      }

      // Simple lightning strike on a fixed cooldown (no rage stream spam).
      // Guard the deref: melee enemies (e.g. Zombie) have no `lightning` object.
      const _lightningRange  = enemy.lightning ? enemy.lightning.range : 0;
      // JUDGMENT LANCE: the Warden's ranged strike gets a long, gorgeous 0.85s
      // telegraph (rod fan flares + ground ring) and hits harder+honest for it.
      // Close-range nova keeps a short fuse; the Seraph casts at 0.45s.
      const _windUpDuration  = isSmartSiege ? (dist < 6.2 ? 0.5 : 0.85)
        : enemy.typeName === "Blink Seraph" ? 0.45 : 0.34;
      const _maxCooldown     = enemy.lightning?.cooldown || 4.0;       // out-of-range clamp = full cooldown

      if (!megaBlasting && enemy.lightning && enemy.aggroed && los && dist <= _lightningRange) {
        if (enemy.lightningStreamTimer <= 0 && (enemy.hitStagger || 0) < 0.35) {
          if (!enemy.lightningWindUp) {
            enemy.lightningWindUp = _windUpDuration;
            enemy.attackPulse = Math.max(enemy.attackPulse, 1.2);
            lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.18);
            // Lock the aim point at the start of the telegraph so the player has
            // the full wind-up to strafe out of the impact radius.
            enemy.lightningAimX = px;
            enemy.lightningAimZ = pz;
            // Ground telegraph ring at the locked strike zone (self-centred for the
            // close-range nova) — the readability layer for every lightning cast.
            if (enemy.telegraphRing) releaseTelegraphRing(enemy.telegraphRing);
            const selfCentred = isSmartSiege && dist < 6.2;
            const ringColor = isSmartSiege ? 0x77cfff : enemy.typeName === "Blink Seraph" ? 0xb28cff : 0x62ffd6;
            const ringRadius = selfCentred ? Math.max(5.0, (enemy.lightning.radius || 1.2) * 4.0) : (enemy.lightning.radius || 1.2) + 0.7;
            enemy.telegraphRing = spawnTelegraphRing(
              selfCentred ? enemy.mesh.position.x : px,
              selfCentred ? enemy.mesh.position.z : pz,
              ringRadius, ringColor, _windUpDuration, { peak: 0.55 });
          }
          enemy.lightningWindUp = Math.max(0, (enemy.lightningWindUp || 0) - dt);
          if (enemy.lightningWindUp <= 0) {
            if (enemy.telegraphRing) { detonateTelegraphRing(enemy.telegraphRing); enemy.telegraphRing = null; }
            fireSiegeLightning(enemy, px, pz, enemyTarget);
            if (game.state !== "playing") return;
          }
        }
      } else if (enemy.lightning) {
        enemy.lightningStreamTimer = Math.min(enemy.lightningStreamTimer || _maxCooldown, _maxCooldown);
        enemy.lightningWindUp = 0;
        if (enemy.telegraphRing) { fadeTelegraphRing(enemy.telegraphRing); enemy.telegraphRing = null; }
      }
      const nearFactor = lod === 0 ? Math.max(0, 1 - dist / 14) : 0;
      if (lod < 2) droneGlowAccum += nearFactor * (0.45 + enemy.attackPulse * 0.9);

      const auraDef = enemy.aura;
      if (auraDef && lod === 0) {
        const auraT = Math.max(0, 1 - dist / auraDef.radius);
        const auraObj = enemy.mesh.userData.aura;
        const auraRing = enemy.mesh.userData.auraRing;
        const auraArcA = enemy.mesh.userData.auraArcA;
        const auraArcB = enemy.mesh.userData.auraArcB;
        const auraBaseScale = enemy.mesh.userData.auraBaseScale || 1;
        const auraPulse = 0.5 + Math.sin(t * 4.2 + enemy.animSeed) * 0.5;

        if (!enemy.mesh.userData.auraPhysicsBound) {
          if (auraObj) {
            auraObj.rotation.y += dt * (0.45 + auraT * 1.8);
            auraObj.rotation.z += dt * 0.3;
            auraObj.material.opacity = 0.03 + auraT * 0.18 + enemy.attackPulse * 0.06;
            auraObj.scale.setScalar(auraBaseScale * (0.96 + auraT * 0.1 + auraPulse * 0.03));
          }
          if (auraRing) {
            auraRing.rotation.z += dt * (0.65 + auraT * 1.9);
            auraRing.material.opacity = 0.06 + auraT * 0.26 + enemy.attackPulse * 0.09;
            auraRing.scale.setScalar(0.98 + auraT * 0.09 + auraPulse * 0.02);
          }
          if (auraArcA) {
            auraArcA.rotation.x += dt * (0.7 + auraT * 2.2);
            auraArcA.rotation.y += dt * (0.32 + auraT * 0.9);
            auraArcA.material.opacity = 0.05 + auraT * 0.15 + enemy.attackPulse * 0.06;
            auraArcA.scale.setScalar(0.95 + auraPulse * 0.06 + auraT * 0.08);
          }
          if (auraArcB) {
            auraArcB.rotation.z -= dt * (0.8 + auraT * 2.0);
            auraArcB.rotation.y += dt * (0.26 + auraT * 0.75);
            auraArcB.material.opacity = 0.04 + auraT * 0.13 + enemy.attackPulse * 0.05;
            auraArcB.scale.setScalar(0.94 + (1 - auraPulse) * 0.06 + auraT * 0.08);
          }
        }

        if (auraT > 0) {
          player.auraTimer = 0.22;
          if (auraDef.type === "slow") auraSpeedMul = Math.min(auraSpeedMul, 1 - auraT * 0.35);
          if (auraDef.type === "drain") {
            player.unlimitedSprint = true;
            player.stamina = player.maxStamina;
            player.sprintExhausted = false;
          }
          if (auraDef.type === "shock") auraShake = Math.max(auraShake, auraT * 0.45);
          if (auraDef.type === "suppress") {
            auraSpeedMul = Math.min(auraSpeedMul, 1 - auraT * 0.22);
            viewState.ads = Math.max(0, viewState.ads - dt * auraT * 1.6);
          }
          const auraTypeMul = auraDef.type === "burn" ? 2.1 : auraDef.type === "shock" ? 1.75 : auraDef.type === "suppress" ? 1.45 : auraDef.type === "drain" ? 1.2 : 1.05;
          player.auraDamageTick -= dt * (1 + auraT * 1.4);
          if (player.auraDamageTick <= 0) {
            player.auraDamageTick = 0.34;
            const auraDamage = auraTypeMul * (0.55 + auraT * 0.95);
          const localHit = applyCoopTargetDamage(enemyTarget, auraDamage);
          if (localHit) {
            showDamageFlash();
            if (player.hp <= 0 && !player.unlimitedHealth) {
              endGame("dead");
              return;
            }
          }
        }
      }
      }

      if (dist < enemy.aggroRange || enemy.lastSeenTimer > 0) enemy.aggroed = true;
      updateEnemyBrain(enemy, dist, los, dt, isZombie, isClonedGhost);
      const hoverPhase = enemy.mesh.userData.hoverPhase ?? 0;
      const hover = Math.sin(t + hoverPhase);
      const wingBeat = Math.sin(t * (2.2 + profile.spinMul * 0.7) + enemy.animSeed);
      const rig = enemy.mesh.userData.rig;
      if (isCharacterEnemy) {
        // Use the real cross-frame displacement (see locoMovedX above) — the pre-move
        // delta against frameStart is always 0 here and would leave the rig in idle.
        const movedX = locoMovedX;
        const movedZ = locoMovedZ;
        if (isClonedGhost) {
          updateClonedGhostVisual(enemy, dt, movedX, movedZ, dist, los);
        } else {
          const moveSpeed = Math.hypot(movedX, movedZ) / Math.max(0.001, dt);
          enemy.visualSpeed = dampValue(enemy.visualSpeed || 0, moveSpeed, 7.5, dt);
          const speedT = clamp01(enemy.visualSpeed / Math.max(0.001, enemy.speed));
          const walkAction = enemy.mesh.userData.walkAction;
          if (walkAction) walkAction.timeScale = SIEGE_DRONE_WALK_TIME_SCALE * (0.62 + speedT * 0.58 + enemy.attackPulse * 0.08);

          enemy.mesh.scale.setScalar(1 + enemy.attackPulse * 0.014 + (enemy.hitFlash || 0) * 0.012);
          enemy.mesh.position.y = 0;
          if (rig) {
            const rightX = Math.cos(enemy.mesh.rotation.y);
            const rightZ = -Math.sin(enemy.mesh.rotation.y);
            const lateralSpeed = (movedX * rightX + movedZ * rightZ) / Math.max(0.001, dt);
            const leanTarget = clamp(-enemy.visualTurn * 0.012 - lateralSpeed / Math.max(0.001, enemy.speed) * 0.055, -0.12, 0.12);
            enemy.visualLean = dampValue(enemy.visualLean || 0, leanTarget, 4.8, dt);
            rig.position.y = Math.sin(t * 1.18 + enemy.animSeed) * 0.018 + enemy.attackPulse * 0.035 + enemy.verticalLift * 0.22;
            rig.rotation.x = -speedT * 0.045 + Math.sin(t * 1.05 + enemy.bobSeed) * 0.014 + enemy.attackPulse * 0.028;
            rig.rotation.z = enemy.visualLean + Math.sin(t * 0.82 + enemy.animSeed) * 0.01;
            const variantHalo = enemy.mesh.userData.variantHalo;
            if (variantHalo) {
              variantHalo.rotation.z += dt * (1.8 + enemy.attackPulse * 2.6);
              variantHalo.material.opacity = 0.1 + enemy.attackPulse * 0.16 + Math.max(0, Math.sin(t * 3.1 + enemy.animSeed)) * 0.08;
            }
            const variantCore = enemy.mesh.userData.variantCore;
            if (variantCore) {
              variantCore.rotation.y -= dt * (1.2 + enemy.attackPulse * 1.8);
              variantCore.rotation.x += dt * 0.55;
              variantCore.scale.setScalar(dampValue(variantCore.scale.x, 1, 5.5, dt));
              variantCore.material.opacity = 0.08 + enemy.attackPulse * 0.12 + Math.max(0, Math.sin(t * 2.4 + enemy.animSeed)) * 0.06;
            }
          }
        }
      } else {
        enemy.mesh.scale.setScalar(1 + hover * 0.026 + enemy.attackPulse * 0.065 + (enemy.hitFlash || 0) * 0.03 + wingBeat * 0.012);
        enemy.mesh.position.y = profile.hoverBase + enemy.verticalLift + hover * 0.085 + enemy.attackPulse * 0.055 + (enemy.hitFlash || 0) * 0.04 + wingBeat * 0.025;
      }

      if (rig && !isCharacterSiege) {
        if (lod === 1 && !lodUpdate) {
          rig.rotation.y += enemy.mesh.userData.spinSpeed * profile.spinMul * dt * 0.25;
          const core = enemy.mesh.userData.core;
          if (core) core.rotation.y += (0.7 + profile.spinMul * 0.2) * dt * 0.25;
          const halo = enemy.mesh.userData.halo;
          if (halo) {
            halo.material.opacity = 0.07 + Math.max(0, hover) * 0.04 + enemy.attackPulse * 0.08;
            halo.scale.setScalar(1 + enemy.attackPulse * 0.14);
          }
        } else {
          rig.rotation.y += enemy.mesh.userData.spinSpeed * profile.spinMul * dt;
          rig.rotation.x = Math.sin(t * 1.3 + enemy.bobSeed * 0.7) * profile.wobbleAmp;
          rig.rotation.z = Math.sin(t * 1.7 + enemy.bobSeed) * (profile.wobbleAmp * 0.72);

          const core = enemy.mesh.userData.core;
          if (core) core.rotation.y += (0.7 + profile.spinMul * 0.2) * dt;

          const eye = enemy.mesh.userData.eye;
          if (eye) eye.scale.set(1.35 + enemy.attackPulse * 0.32, 0.55 + enemy.attackPulse * 0.12, 0.48);

          const thruster = enemy.mesh.userData.thruster;
          if (thruster) thruster.scale.set(1, 0.75 + Math.max(0, wingBeat) * 0.65 + enemy.lungeBoost * 0.35, 1);

          const halo = enemy.mesh.userData.halo;
          if (halo) {
            halo.material.opacity = 0.07 + Math.max(0, hover) * 0.05 + enemy.attackPulse * 0.16;
            halo.scale.setScalar(1 + enemy.attackPulse * 0.22 + Math.max(0, wingBeat) * 0.08);
          }

          const emitterCore = enemy.mesh.userData.emitterCore;
          const emitterGlow = enemy.mesh.userData.emitterGlow;
          const emitterLight = enemy.mesh.userData.emitterLight;
          const petals = enemy.mesh.userData.petals;
          if (emitterCore) {
            emitterCore.scale.setScalar(1 + enemy.attackPulse * 0.18 + Math.max(0, wingBeat) * 0.08);
            const nextEmissive = 2.3 + enemy.attackPulse * 1.6 + nearFactor * 0.75;
            if (Math.abs(nextEmissive - emitterCore.material.emissiveIntensity) > 0.02)
              emitterCore.material.emissiveIntensity = nextEmissive;
          }
          if (emitterGlow) {
            emitterGlow.scale.setScalar(1 + enemy.attackPulse * 0.32 + Math.max(0, wingBeat) * 0.2);
            const nextGlowOp = Math.min(0.42, 0.16 + enemy.attackPulse * 0.16 + nearFactor * 0.08);
            if (Math.abs(nextGlowOp - emitterGlow.material.opacity) > 0.01)
              emitterGlow.material.opacity = nextGlowOp;
          }
          if (emitterLight) emitterLight.intensity = 0.35 + enemy.attackPulse * 1.1 + nearFactor * 0.45;
          const tankMuzzle = enemy.mesh.userData.tankMuzzle;
          const tankFlash = enemy.mesh.userData.tankFlash;
          const tankGlow = enemy.mesh.userData.tankMuzzleGlow;
          if (tankMuzzle) tankMuzzle.intensity = Math.max(0, tankMuzzle.intensity - dt * 42);
          if (tankFlash) {
            tankFlash.material.opacity = Math.max(0, tankFlash.material.opacity - dt * 9.5);
            tankFlash.scale.setScalar(1 + tankFlash.material.opacity * 0.75);
            tankFlash.rotation.z += dt * 7;
            tankFlash.visible = tankFlash.material.opacity > 0.02;
          }
          if (tankGlow) tankGlow.material.opacity = 0.18 + enemy.attackPulse * 0.22 + nearFactor * 0.05;
          if (petals) {
            const petalOpen = 0.16 + enemy.attackPulse * 0.36 + Math.max(0, wingBeat) * 0.1;
            for (let i = 0; i < petals.length; i++) {
              petals[i].rotation.z = Math.sin(t * 2.3 + i * 1.2 + enemy.animSeed) * 0.06;
              petals[i].rotation.x = -petalOpen;
            }
          }

          const rotorLA = enemy.mesh.userData.rotorLA;
          const rotorLB = enemy.mesh.userData.rotorLB;
          const rotorRA = enemy.mesh.userData.rotorRA;
          const rotorRB = enemy.mesh.userData.rotorRB;
          const spin = dt * (22 + profile.spinMul * 18 + enemy.lungeBoost * 12);
          if (rotorLA) rotorLA.rotation.x += spin;
          if (rotorLB) rotorLB.rotation.x += spin;
          if (rotorRA) rotorRA.rotation.x -= spin;
          if (rotorRB) rotorRB.rotation.x -= spin;
        }
      }

      if (!megaBlasting && enemy.aggroed && dist > 1.28) {
        const movedDist = Math.hypot(enemy.mesh.position.x - enemy.lastRepathX, enemy.mesh.position.z - enemy.lastRepathZ);
        let siegeTooClose = false;
        let canDirectChase = false;
        let target = null;

        if (isSmartBot) {
          if (enemy.smartThinkTimer <= 0 || !enemy.smartPlanValid) {
            if (isClonedGhost) refreshClonedGhostSmartPlan(enemy, playerCell, dirNormX, dirNormZ, dist, los, tactics);
            else refreshSiegeSmartPlan(enemy, playerCell, dirNormX, dirNormZ, dist, los, tactics);
          }

          siegeTooClose = enemy.smartSiegeTooClose === true;
          canDirectChase = enemy.smartCanDirectChase === true;
          if (enemy.smartPlanValid) {
            target = { x: enemy.smartTargetX, z: enemy.smartTargetZ };
            if (Math.hypot(target.x - enemy.mesh.position.x, target.z - enemy.mesh.position.z) < 0.45) {
              enemy.smartThinkTimer = 0;
            }
          }
        } else {
          const enemyCell = worldToMap(enemy.mesh.position.x, enemy.mesh.position.z);
          const tacticalGoal = getTacticalGoalCell(enemy, playerCell, dirNormX, dirNormZ, dist);
          const directPathClear = !enemyPathBlocked(enemy, enemy.mesh.position.x, enemy.mesh.position.z, enemy.lastSeenX, enemy.lastSeenZ);
          canDirectChase = los && dist < tactics.directRange && !wallAtWorldRadius(enemy.lastSeenX, enemy.lastSeenZ, 0.34) && directPathClear;
          const needRepath = !canDirectChase && (!enemy.navPath || enemy.navPath.length === 0 || !enemy.navGoal || enemy.navGoal.mx !== tacticalGoal.mx || enemy.navGoal.my !== tacticalGoal.my || (enemy.navTimer <= 0 && (dist > 5 || movedDist > 2.1)));

          if (needRepath) {
            enemy.navGoal = { mx: tacticalGoal.mx, my: tacticalGoal.my };
            enemy.navPath = findPath(enemyCell, tacticalGoal, enemy);
            enemy.navTimer = tactics.repath + Math.random() * 0.18;
            enemy.lastRepathX = enemy.mesh.position.x;
            enemy.lastRepathZ = enemy.mesh.position.z;
          }

          if (canDirectChase) {
            target = { x: enemy.lastSeenX, z: enemy.lastSeenZ };
            enemy.directChaseTimer = 0.35;
          } else {
            while (enemy.navPath && enemy.navPath.length) {
              const nextCell = enemy.navPath[0];
              const nextCenter = cellCenter(nextCell.mx, nextCell.my);
              if (Math.hypot(nextCenter.x - enemy.mesh.position.x, nextCenter.z - enemy.mesh.position.z) < 0.45) enemy.navPath.shift();
              else {
                target = nextCenter;
                break;
              }
            }
          }
        }

        if (target) {
          let moveDirX = target.x - enemy.mesh.position.x;
          let moveDirZ = target.z - enemy.mesh.position.z;
          const moveDist = Math.hypot(moveDirX, moveDirZ) || 1;
          const nearPlayer = dist < 6.2;
          const tooClose = dist < tactics.preferRange && ((enemy.rangedCooldown || 0) > 0.12 || enemy.attackCooldown > 0.15);
          if ((tooClose && los) || enemy.aiRetreat === true) {
            moveDirX = -dirNormX;
            moveDirZ = -dirNormZ;
          }
          if (enemy.avoidTimer > 0 && Math.hypot(enemy.avoidX || 0, enemy.avoidZ || 0) > 0.01) {
            moveDirX = enemy.avoidX;
            moveDirZ = enemy.avoidZ;
          }

          if ((nearPlayer || los) && enemy.strafeTimer <= 0) {
            enemy.strafeDir *= -1;
            enemy.orbitDir = enemy.strafeDir;
            enemy.strafeTimer = isSmartBot ? 1.0 + Math.random() * 1.25 : 0.28 + Math.random() * 0.45;
          }

          const adjustedMoveDist = Math.hypot(moveDirX, moveDirZ) || 1;
          const fx = moveDirX / adjustedMoveDist;
          const fz = moveDirZ / adjustedMoveDist;
          const sx = -dirNormZ || -fz;
          const sz = dirNormX || fx;
          // Lateral gain: brains publish aiLateralMul; obstacle-avoidance windows force a
          // minimum so an avoiding enemy can always slide sideways past the blockage.
          const brainLateral = isClonedGhost ? (enemy.cloneLateralMul ?? 0.08)
            : Number.isFinite(enemy.aiLateralMul) ? enemy.aiLateralMul : 1;
          const lateralMul = enemy.avoidTimer > 0 ? Math.max(0.9, brainLateral) : brainLateral;
          const strafeAmount = lateralMul * ((nearPlayer || los) ? enemy.speed * profile.strafe * (los ? 1.25 : 1) : 0);
          const zigzag = lateralMul * Math.sin(t * profile.zigzagSpeed + enemy.animSeed) * (enemy.speed * profile.zigzagAmp);
          const orbitActive = lateralMul > 0 && dist < Math.max(profile.orbitRange, tactics.preferRange + 4.5) && los;
          const orbitAmount = orbitActive ? enemy.speed * (isSmartBot ? profile.orbit : Math.max(profile.orbit, 0.38)) * enemy.orbitDir : 0;
          const speedWave = 1 + Math.sin(t * (3 + profile.spinMul) + enemy.animSeed) * profile.speedWaveAmp;
          const rushBoost = 1 + enemy.lungeBoost * profile.lungeBoost;
          let advanceMul = tooClose ? 0.8 : dist > tactics.preferRange ? tactics.aggression : 0.35;
          if (isSmartSiege) {
            // Phase machine output (hunt/advance/anchor/recover) — the smart plan's
            // too-close retreat still overrides so it always backs out of point-blank.
            advanceMul = siegeTooClose ? 0.35 : Number.isFinite(enemy.aiAdvanceMul) ? enemy.aiAdvanceMul : 1.0;
          } else if (isClonedGhost) {
            // Rifleman brain: close / band-hold / anchor-to-fire / fallback speeds.
            advanceMul = enemy.cloneAdvanceMul ?? 0.9;
          } else if (isZombie) {
            // Walk vs sprint-charge speed spread (drives the skinned walk/run clips).
            advanceMul = enemy.zombieLocoMul ?? 0.46;
          } else if (Number.isFinite(enemy.aiAdvanceMul)) {
            // Seraph / Cherub (and any future brained type).
            advanceMul = enemy.aiAdvanceMul;
          }
          const staggerMul = 1 - Math.min(0.74, enemy.hitStagger || 0);
          const lateral = strafeAmount * enemy.strafeDir + zigzag + orbitAmount;
          let rawVelX = (fx * enemy.speed * speedWave * rushBoost * advanceMul + sx * lateral) * staggerMul;
          let rawVelZ = (fz * enemy.speed * speedWave * rushBoost * advanceMul + sz * lateral) * staggerMul;

          // Enemy separation: push apart enemies that are too close to each other.
          // Runs every 4 frames per enemy (staggered by index) to stay O(n) per frame.
          if ((game.frame + enemyIndex) % 4 === 0 && enemies.length > 1) {
            const SEP_RADIUS = 2.2;
            const SEP_RADIUS2 = SEP_RADIUS * SEP_RADIUS;
            const SEP_STRENGTH = 0.7 * 4; // ×4 because applied once per 4 frames
            for (let j = 0; j < enemies.length; j++) {
              const other = enemies[j];
              if (other === enemy || !other.alive) continue;
              const dx = enemy.mesh.position.x - other.mesh.position.x;
              const dz = enemy.mesh.position.z - other.mesh.position.z;
              const d2 = dx * dx + dz * dz;
              if (d2 < SEP_RADIUS2 && d2 > 0.0001) {
                const d = Math.sqrt(d2);
                const push = (SEP_RADIUS - d) / SEP_RADIUS * SEP_STRENGTH;
                rawVelX += (dx / d) * push;
                rawVelZ += (dz / d) * push;
              }
            }
          }
          if (isClonedGhost) {
            const aimYaw = yawFromDirection(px - enemy.mesh.position.x, pz - enemy.mesh.position.z);
            const controls = resolveClonedGhostPlayerControls(enemy, rawVelX, rawVelZ, aimYaw, dist, los, dt);
            rawVelX = controls.vx;
            rawVelZ = controls.vz;
            enemy.smoothVelX = rawVelX;
            enemy.smoothVelZ = rawVelZ;
          } else if (isSmartBot) {
            const smoothLambda = enemy.avoidTimer > 0 ? 8.5 : 4.2;
            enemy.smoothVelX = dampValue(enemy.smoothVelX || 0, rawVelX, smoothLambda, dt);
            enemy.smoothVelZ = dampValue(enemy.smoothVelZ || 0, rawVelZ, smoothLambda, dt);
          }
          const vx = (isSmartBot ? enemy.smoothVelX : rawVelX) * dt;
          const vz = (isSmartBot ? enemy.smoothVelZ : rawVelZ) * dt;
          const tx = enemy.mesh.position.x + vx;
          const tz = enemy.mesh.position.z + vz;
          const beforeX = enemy.mesh.position.x;
          const beforeZ = enemy.mesh.position.z;
          const movedAxis = tryMoveEnemyWithDetour(enemy, vx, vz, {
            detour: !isSmartBot,
            targetX: target.x,
            targetZ: target.z,
          });

          const frameMove = Math.hypot(enemy.mesh.position.x - enemy.lastMoveX, enemy.mesh.position.z - enemy.lastMoveZ);
          enemy.stuckTimer = frameMove < 0.025 && !movedAxis ? enemy.stuckTimer + dt : Math.max(0, enemy.stuckTimer - dt * 2);
          enemy.lastMoveX = enemy.mesh.position.x;
          enemy.lastMoveZ = enemy.mesh.position.z;
          if (enemy.stuckTimer > 0.35 || (Math.hypot(enemy.mesh.position.x - beforeX, enemy.mesh.position.z - beforeZ) < 0.01 && movedDist < 0.15 && enemy.navTimer <= 0.05)) {
            if (isSmartBot && enemy.smartUnstuckTimer <= 0) {
              runSiegeSmartUnstuckScan(enemy, target.x, target.z, dirNormX, dirNormZ);
            } else if (!isSmartBot) {
              enemy.strafeDir *= -1;
              enemy.orbitDir *= -1;
              enemy.unstuckTurnDir *= -1;
              enemy.avoidTimer = 0.35;
              enemy.avoidX = -dirNormX * 0.35 + -dirNormZ * enemy.unstuckTurnDir;
              enemy.avoidZ = -dirNormZ * 0.35 + dirNormX * enemy.unstuckTurnDir;
              enemy.navPath = [];
              enemy.navTimer = 0;
            }
            enemy.lungeBoost = Math.max(enemy.lungeBoost, 0.25);
            enemy.stuckTimer = 0;
          }
        }
      } else if (!megaBlasting && enemy.aggroed && dist <= 1.28) {
        if (!enemy.ranged && !enemy.lightning && enemy.attackCooldown <= 0) {
          // Melee wind-up telegraph: 0.28s warning before damage lands.
          // meleeWindUp counts DOWN; when it first hits zero, damage fires.
          if (enemy.meleeWindUp === undefined) enemy.meleeWindUp = -1;
          if (enemy.meleeWindUp < 0) {
            // Begin wind-up — flash body, play alert tone. Zombies swing 2× faster.
            enemy.meleeWindUp = enemy.typeName === "Zombie" ? 0.14 : 0.28;
            enemy.attackPulse = Math.max(enemy.attackPulse, 0.85);
            if (audioCtx) {
              const busInput = getAudioBus(); // actual AudioNode (audioBus is a wrapper object)
              const o = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              o.type = 'square'; o.frequency.setValueAtTime(220, audioCtx.currentTime);
              g.gain.setValueAtTime(0.07, audioCtx.currentTime);
              g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.22);
              o.connect(g); g.connect(busInput);
              o.start(); o.stop(audioCtx.currentTime + 0.22);
            }
          }
          enemy.meleeWindUp -= dt;
          if (enemy.meleeWindUp <= 0) {
            enemy.meleeWindUp = -1;
            enemy.attackCooldown = enemy.attackRate;
            enemy.attackPulse = 1;
            const dmg = enemy.damage[0] + Math.floor(Math.random() * (enemy.damage[1] - enemy.damage[0] + 1));
            const localHit = applyCoopTargetDamage(enemyTarget, dmg);
            if (localHit) {
              cameraFX.damageShake = Math.min(1, cameraFX.damageShake + 0.55);
              player.killStreak = 0;
              updateStreak();
              showDamageFlash();
              sfxDamage();
              if (player.hp <= 0 && !player.unlimitedHealth) {
                endGame("dead");
                return;
              }
            }
          }
        } else if (enemy.ranged || enemy.lightning) {
          const sx = isCharacterSiege ? 0 : -dirNormZ * enemy.strafeDir;
          const sz = isCharacterSiege ? 0 : dirNormX * enemy.strafeDir;
          const back = enemy.ranged || enemy.lightning ? 1.2 : enemy.attackCooldown > enemy.attackRate * 0.45 ? 0.85 : 0.15;
          const tx = enemy.mesh.position.x + (sx * enemy.speed - dirNormX * enemy.speed * back) * dt;
          const tz = enemy.mesh.position.z + (sz * enemy.speed - dirNormZ * enemy.speed * back) * dt;
          tryMoveEnemyWithDetour(enemy, tx - enemy.mesh.position.x, tz - enemy.mesh.position.z, {
            detour: !isSmartBot,
            targetX: enemy.mesh.position.x - dirNormX,
            targetZ: enemy.mesh.position.z - dirNormZ,
          });
        }
      }

      if (lod === 0 || lodUpdate) {
        const movedX = enemy.mesh.position.x - frameStartX;
        const movedZ = enemy.mesh.position.z - frameStartZ;
        // The Warden is a hunter — it always faces the player, so it never wobbles to
        // chase its own drift. Grounded character enemies still face their movement.
        // The Warden model's built front points -Z, so add π when we aim it at the player.
        const faceMove = isCharacterEnemy && !isSmartSiege && Math.hypot(movedX, movedZ) > 0.004;
        const targetYaw = faceMove
          ? yawFromDirection(movedX, movedZ)
          : yawFromDirection(px - enemy.mesh.position.x, pz - enemy.mesh.position.z) + (isSmartSiege ? Math.PI : 0);
        const prevYaw = enemy.visualYaw;
        enemy.visualYaw = dampValue(enemy.visualYaw, enemy.visualYaw + angleDelta(enemy.visualYaw, targetYaw), isCharacterEnemy ? 5.2 : 12, dt);
        enemy.visualTurn = angleDelta(prevYaw, enemy.visualYaw) / Math.max(0.001, dt);
        enemy.mesh.rotation.y = enemy.visualYaw;
      }

    }

    for (let i = 0; i < enemies.length; i++) {
      if (!enemies[i].alive) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        if (!enemies[j].alive) continue;
        const dx = enemies[j].mesh.position.x - enemies[i].mesh.position.x;
        const dz = enemies[j].mesh.position.z - enemies[i].mesh.position.z;
        // Early distance-square cutoff to avoid expensive sqrt for distant pairs
        const distSq = dx * dx + dz * dz;
        const minDist = Math.max(0.82, (getEnemyCollisionRadius(enemies[i]) + getEnemyCollisionRadius(enemies[j])) * 0.82);
        const earlyCut = (minDist * 2) * (minDist * 2);
        if (distSq > earlyCut) continue;
        const d = Math.sqrt(distSq);
        if (d < minDist && d > 0.01) {
          const overlap = (minDist - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          const ix = enemies[i].mesh.position.x - nx * overlap;
          const iz = enemies[i].mesh.position.z - nz * overlap;
          const jx = enemies[j].mesh.position.x + nx * overlap;
          const jz = enemies[j].mesh.position.z + nz * overlap;
          if (!enemyBlockedAt(enemies[i], ix, enemies[i].mesh.position.z)) enemies[i].mesh.position.x = ix;
          if (!enemyBlockedAt(enemies[i], enemies[i].mesh.position.x, iz)) enemies[i].mesh.position.z = iz;
          if (!enemyBlockedAt(enemies[j], jx, enemies[j].mesh.position.z)) enemies[j].mesh.position.x = jx;
          if (!enemyBlockedAt(enemies[j], enemies[j].mesh.position.x, jz)) enemies[j].mesh.position.z = jz;
        }
      }
    }

    player.effectSpeedMul = auraSpeedMul;
    player.auraTimer = Math.max(0, player.auraTimer - dt);
    cameraFX.damageShake = Math.min(1, cameraFX.damageShake + auraShake * dt * 0.7);
    lightingState.droneGlow = Math.min(1, droneGlowAccum * 0.12);
  }

  function updateWeapon(dt) {
    lightingState.shootFlash = Math.max(0, lightingState.shootFlash - dt * 10.5);
    lightingState.lightningFlash = Math.max(0, lightingState.lightningFlash - dt * 7.5);

    // Flashlight — mirrors gunFlash exactly. Never toggle .visible; use intensity=0 to turn off.
    // In TP mode reposition to weapon muzzle (same logic as gunFlash) so the player body doesn't block it.
    const _inExtZone = yaw.position.z > 122;
    const flashlightEnabled = lightingState.flashlightOn && (game.state === "playing" || _inExtZone);
    const flashlightFlicker = Math.sin(performance.now() * 0.018) * 0.45 + Math.sin(performance.now() * 0.0047) * 0.3;
    flashlight.intensity = flashlightEnabled ? 120 + flashlightFlicker * 2 : 0;
    if (thirdPerson.enabled && thirdPerson.weapon?.muzzle) {
      thirdPerson.weapon.muzzle.getWorldPosition(flashlightMuzzleTmp);
      flashlightMuzzleTmp.applyMatrix4(camera.matrixWorldInverse);
      flashlight.position.copy(flashlightMuzzleTmp);
    } else {
      flashlight.position.set(0.12, -0.05, -0.45);
    }
    lensGlow.visible = lightingState.flashlightOn;

    const flashT = gunState.muzzleTimer > 0 ? Math.min(1, gunState.muzzleTimer / weaponAnim.animSpec.muzzleFlashDuration) : 0;
    const baseGunColorHex = currentGun === GUNS.SHOTGUN ? 0xffb14d : currentGun === GUNS.SNIPER ? 0xffd37a : 0xffc24f;
    // Per-gun flash-light intensity pattern — the LIGHT itself is the shared
    // gunFlash PointLight, intensity-only (never visibility). Legacy trio keeps
    // its exact values; the roster scales off spec.muzzleFlashScale.
    const flashLightMul = Number.isFinite(GUN_SPECS[currentGun]?.muzzleFlashScale) ? GUN_SPECS[currentGun].muzzleFlashScale : 1;
    const rawGunFlashIntensity = Math.max(lightingState.shootFlash * 48, flashT * (currentGun === GUNS.SHOTGUN ? 160 : currentGun === GUNS.SNIPER ? 110 : currentGun === GUNS.RIFLE ? 95 : 95 * flashLightMul));
    const MAX_GUN_FLASH_INTENSITY = 85;
    gunFlash.intensity = Math.min(rawGunFlashIntensity, MAX_GUN_FLASH_INTENSITY);
    gunFlash.color.setHex(baseGunColorHex);
    // In TP mode, reposition the flash light to the muzzle world position so it
    // illuminates from in front of the player, not from inside the camera/model.
    if (thirdPerson.enabled && thirdPerson.weapon?.muzzle && gunFlash.intensity > 0) {
      thirdPerson.weapon.muzzle.getWorldPosition(gunFlashMuzzleTmp);
      gunFlashMuzzleTmp.applyMatrix4(camera.matrixWorldInverse);
      gunFlash.position.copy(gunFlashMuzzleTmp);
    } else {
      gunFlash.position.set(0.12, -0.05, -0.45);
    }
    const _flashlightExposureBump = flashlightEnabled ? 0.22 : 0;   // matches shootFlash*0.2 peak, slightly brighter
    const nextExposure = getBaseExposure() + Math.max(lightingState.shootFlash * 0.2, flashT * 0.12, lightingState.lightningFlash * 0.22, _flashlightExposureBump);
    if (Math.abs(nextExposure - renderer.toneMappingExposure) > 0.005) renderer.toneMappingExposure = nextExposure;

    if (gunState.muzzleTimer > 0) {
      gunState.muzzleTimer = Math.max(0, gunState.muzzleTimer - dt);
      const weaponFlashT = Math.min(1, gunState.muzzleTimer / weaponAnim.animSpec.muzzleFlashDuration);
      weapon.muzzle.intensity = gunState.muzzleTimer > 0 ? (currentGun === GUNS.SHOTGUN ? 19.5 : currentGun === GUNS.SNIPER ? 15.0 : currentGun === GUNS.RIFLE ? 13.0 : 13.0 * flashLightMul) * weaponFlashT : 0;
      const showWeaponFlashMesh = getActiveWeaponForShot() === weapon && gunState.muzzleTimer > 0;
      alignWeaponMuzzleFlash(weapon);
      applyMuzzleFlashSprite(weapon.flash, showWeaponFlashMesh, weaponFlashT, currentGun, 1);
      setPhysicalMuzzleFlash(weapon.muzzle, showWeaponFlashMesh, weaponFlashT, 1);
      try {
        const flashBase = weapon.flash.userData?.baseColor ?? null;
        if (weapon.flash && weapon.flash.material) {
          if (flashBase) weapon.flash.material.color.setHex(flashBase);
        }
        // Also ensure third-person flash uses the same logic when visible
        if (thirdPerson.weapon?.flash && thirdPerson.weapon.flash.material) {
          const tpBase = thirdPerson.weapon.flash.userData?.baseColor ?? flashBase;
          if (tpBase) thirdPerson.weapon.flash.material.color.setHex(tpBase);
        }
      } catch (e) {}
    } else {
      weapon.flash.visible = false;
      if (weapon.flash?.material) weapon.flash.material.opacity = 0;
      setPhysicalMuzzleFlash(weapon.muzzle, false, 0, 1);
      setPhysicalMuzzleFlash(thirdPerson.weapon?.muzzle, false, 0, 1);
    }

    weaponAnim.kickVel += (-weaponAnim.kick * weaponAnim.animSpec.recoil.kick - weaponAnim.kickVel * weaponAnim.animSpec.recoil.kickDamping) * dt;
    weaponAnim.kick += weaponAnim.kickVel * dt;
    weaponAnim.recoilYawVel += (-weaponAnim.recoilYaw * weaponAnim.animSpec.recoil.yaw - weaponAnim.recoilYawVel * weaponAnim.animSpec.recoil.yawDamping) * dt;
    weaponAnim.recoilYaw += weaponAnim.recoilYawVel * dt;
    weaponAnim.recoilRollVel += (-weaponAnim.recoilRoll * weaponAnim.animSpec.recoil.roll - weaponAnim.recoilRollVel * weaponAnim.animSpec.recoil.rollDamping) * dt;
    weaponAnim.recoilRoll += weaponAnim.recoilRollVel * dt;
    weaponAnim.slideKickVel += (-weaponAnim.slideKick * 70 - weaponAnim.slideKickVel * 15) * dt;
    weaponAnim.slideKick += weaponAnim.slideKickVel * dt;
    weaponAnim.slideKick = Math.max(0, weaponAnim.slideKick);
    weaponAnim.recoilBurstTimer = Math.max(0, weaponAnim.recoilBurstTimer - dt);
    if (weaponAnim.recoilBurstTimer <= 0) weaponAnim.recoilBurst = 0;
    weaponAnim.slideKick = Math.max(0, weaponAnim.slideKick - dt * 1.8);
    weaponAnim.meleeSwing = Math.max(0, weaponAnim.meleeSwing - dt * 3.4);
    weaponAnim.reloadJolt = Math.max(0, weaponAnim.reloadJolt - dt * 4.2);
    // Weapon-switch lower/raise paced by the gun's equipTime (was fixed 7.8/s).
    weaponAnim.switchBlend = Math.max(0, weaponAnim.switchBlend - dt / Math.max(0.08, weaponAnim.animSpec.equipTime || 0.3));
    if (weaponAnim.packAnim > 0) {
      weaponAnim.packAnim = Math.max(0, weaponAnim.packAnim - dt / (weaponAnim.packAnimTotal || 0.85));
    }

    // Strafe tilt — spring toward target roll based on lateral input
    const strafeInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const strafeTiltTarget = strafeInput * -0.08;
    weaponAnim.strafeTiltVel += (strafeTiltTarget - weaponAnim.strafeTilt) * 18 * dt - weaponAnim.strafeTiltVel * 9 * dt;
    weaponAnim.strafeTilt += weaponAnim.strafeTiltVel * dt;

    // Landing jolt — trigger when touching down after airborne
    const justLanded = player.grounded && !weaponAnim.wasGrounded;
    weaponAnim.wasGrounded = player.grounded;
    if (justLanded) weaponAnim.landJoltVel = -0.055;
    weaponAnim.landJoltVel += (-weaponAnim.landJolt * 38 - weaponAnim.landJoltVel * 11) * dt;
    weaponAnim.landJolt += weaponAnim.landJoltVel * dt;

    const bobT = performance.now() * 0.006;
    const aimBlend = viewState.ads;
    const bobScale = 1 - aimBlend * 0.75;
    const moving = keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD");
    const moveScale = moving ? 1 : 0;
    // Per-gun sway weight: heavy guns wander more, light sidearms stay snappy.
    const specSwayMul = Number.isFinite(GUN_SPECS[currentGun]?.swayMul) ? GUN_SPECS[currentGun].swayMul : 1;
    const bobX = Math.cos(bobT) * 0.016 * bobScale * moveScale * specSwayMul;
    const bobY = Math.sin(bobT * 2) * 0.013 * bobScale * moveScale * specSwayMul;
    const sway = Math.sin(bobT * 1.3) * 0.055 * bobScale * moveScale * specSwayMul;

    // Idle breathing — slow deep float when standing still, suppressed when moving or aiming
    const breathT = performance.now() * 0.00145;
    const breathScale = (moving ? 0 : 1) * (1 - aimBlend);
    const breathY = Math.sin(breathT) * 0.0055 * breathScale;
    const breathRoll = Math.sin(breathT * 0.62) * 0.009 * breathScale;

    const reloadActive = gunState.reloadTimer > 0;
    const reloadT = reloadActive ? 1 - gunState.reloadTimer / weaponAnim.animSpec.reloadDuration : 0;
    const clamp01 = v => Math.max(0, Math.min(1, v));
    const ease01 = v => {
      const t = clamp01(v);
      return t * t * (3 - 2 * t);
    };
    const meleeT = player.meleeTimer > 0 ? clamp01(1 - player.meleeTimer / 0.34) : 1;
    const meleeArc = player.meleeTimer > 0 ? Math.sin(meleeT * Math.PI) : 0;
    const meleeFollowThrough = player.meleeTimer > 0 ? ease01(meleeT) : 0;
    const rEnter = clamp01(reloadT / (weaponAnim.animSpec.dropPhase / weaponAnim.animSpec.reloadDuration));
    const rSwap = clamp01((reloadT - weaponAnim.animSpec.dropPhase / weaponAnim.animSpec.reloadDuration) / ((weaponAnim.animSpec.swapPhase - weaponAnim.animSpec.dropPhase) / weaponAnim.animSpec.reloadDuration));
    const rExit = clamp01((reloadT - weaponAnim.animSpec.swapPhase / weaponAnim.animSpec.reloadDuration) / ((weaponAnim.animSpec.reloadDuration - weaponAnim.animSpec.swapPhase) / weaponAnim.animSpec.reloadDuration));
    const reloadDrop = Math.sin(rEnter * Math.PI * 0.5) * (1 - rExit);
    const magSwap = Math.sin(rSwap * Math.PI);
    const rifleMagOut = reloadActive && currentGun === GUNS.RIFLE ? ease01((reloadT - 0.12) / 0.18) * (1 - ease01((reloadT - 0.42) / 0.12)) : 0;
    const rifleMagIn = reloadActive && currentGun === GUNS.RIFLE ? ease01((reloadT - 0.52) / 0.18) * (1 - ease01((reloadT - 0.78) / 0.12)) : 0;
    const reloadRack = reloadActive ? Math.sin(clamp01((reloadT - 0.68) / 0.22) * Math.PI) : 0;
    const shellLoad = currentGun === GUNS.SHOTGUN && reloadActive ? Math.max(0, Math.sin(clamp01((reloadT - 0.18) / 0.54) * Math.PI * 4)) : 0;
    const shotgunPump = currentGun === GUNS.SHOTGUN && reloadActive ? Math.sin(clamp01((reloadT - 0.72) / 0.2) * Math.PI) : 0;
    const sniperBoltBack = currentGun === GUNS.SNIPER && reloadActive ? ease01((reloadT - 0.12) / 0.16) * (1 - ease01((reloadT - 0.34) / 0.1)) : 0;
    const sniperMagSwap = currentGun === GUNS.SNIPER && reloadActive ? Math.sin(clamp01((reloadT - 0.38) / 0.32) * Math.PI) : 0;
    const sniperBoltForward = currentGun === GUNS.SNIPER && reloadActive ? Math.sin(clamp01((reloadT - 0.74) / 0.18) * Math.PI) : 0;

    weapon.gun.position.copy(weaponAnim.basePos);
    weapon.gun.rotation.copy(weaponAnim.baseRot);
    weapon.mag.position.copy(weaponAnim.baseMagPos);
    weapon.mag.rotation.copy(weaponAnim.baseMagRot);
    weapon.slide.position.copy(weaponAnim.baseSlidePos);
    if (weaponAnim.baseSlideRot) weapon.slide.rotation.copy(weaponAnim.baseSlideRot);
    restoreWeaponRigAnimParts(weapon, "animBase");

    const aimPose = currentGun === GUNS.SNIPER
      ? { x: 0, y: 0, z: 0, ry: 0, rz: 0 }
      : currentGun === GUNS.SHOTGUN
        ? { x: -0.045, y: 0.04, z: 0.12, ry: -0.045, rz: -0.015 }
        : { x: -0.055, y: 0.045, z: 0.14, ry: -0.055, rz: -0.015 };
    weapon.gun.position.x += aimBlend * aimPose.x;
    weapon.gun.position.y += aimBlend * aimPose.y;
    weapon.gun.position.z += aimBlend * aimPose.z;
    weapon.gun.rotation.x -= pitch.rotation.x * (currentGun === GUNS.SNIPER ? 0.92 : currentGun === GUNS.SHOTGUN ? 0.78 : 0.88) * (0.45 + aimBlend * 0.55);
    weapon.gun.position.y += pitch.rotation.x * 0.06;
    weapon.gun.position.z -= Math.abs(pitch.rotation.x) * 0.04;
    weapon.gun.rotation.y += aimBlend * aimPose.ry;
    weapon.gun.rotation.z += aimBlend * aimPose.rz;

    const aimCursorOffset = getAimCursorOffset(fireAnglesTmp);
    const cursorAimStrength = 0.72 + aimBlend * 0.42;
    weapon.gun.rotation.y -= aimCursorOffset.x * cursorAimStrength;
    weapon.gun.rotation.x += aimCursorOffset.y * cursorAimStrength;
    weapon.gun.position.x += aimCursorOffset.x * (0.045 + aimBlend * 0.025);
    weapon.gun.position.y -= aimCursorOffset.y * (0.04 + aimBlend * 0.02);

    const switchEase = weaponAnim.switchBlend * weaponAnim.switchBlend;
    weapon.gun.position.y -= switchEase * 0.22;
    weapon.gun.position.z -= switchEase * 0.12;
    weapon.gun.rotation.x -= switchEase * 0.16;
    weapon.gun.rotation.z += switchEase * 0.28;

    weapon.gun.position.x += bobX + reloadDrop * 0.12 + weaponAnim.reloadJolt * 0.02;
    weapon.gun.position.y += bobY + breathY + weaponAnim.landJolt - Math.max(0, weaponAnim.kick) * 0.03 - reloadDrop * 0.14;
    weapon.gun.position.z += -Math.max(0, weaponAnim.kick) * 0.05 + reloadDrop * 0.14;
    weapon.gun.rotation.z += sway + breathRoll + weaponAnim.strafeTilt + reloadDrop * 0.58 + weaponAnim.recoilRoll * 0.07;
    weapon.gun.rotation.x += Math.max(0, weaponAnim.kick) * 0.09 - reloadDrop * 0.22;
    weapon.gun.rotation.y += -reloadDrop * 1.2 + weaponAnim.recoilYaw * 0.06;

    // Pack-a-Punch upgrade flourish: the weapon lifts toward the player and does
    // a full barrel-roll spin while the energy glow surges, then settles.
    if (weaponAnim.packAnim > 0) {
      const p = 1 - weaponAnim.packAnim;          // 0 → 1 across the animation
      const bump = Math.sin(p * Math.PI);         // rise then return
      weapon.gun.position.y += bump * 0.17;
      weapon.gun.position.z += bump * 0.20;       // pulled in toward the camera
      weapon.gun.position.x -= bump * 0.04;
      weapon.gun.rotation.x += p * Math.PI * 2;   // 360° barrel roll about the bore
      weapon.gun.rotation.z += bump * 0.26;
    }

    if (player.meleeTimer > 0 || weaponAnim.meleeSwing > 0) {
      const meleePower = Math.max(meleeArc, weaponAnim.meleeSwing * 0.34);
      weapon.gun.position.x += meleePower * 0.2 - meleeFollowThrough * 0.08;
      weapon.gun.position.y -= meleePower * 0.15;
      weapon.gun.position.z -= meleePower * 0.34;
      weapon.gun.rotation.x += meleePower * 0.42 - meleeFollowThrough * 0.22;
      weapon.gun.rotation.y -= meleePower * 0.72;
      weapon.gun.rotation.z -= meleePower * 0.62 + meleeFollowThrough * 0.18;
      weapon.slide.position.x -= meleePower * 0.08;
    }

    if (currentGun === GUNS.RIFLE && reloadActive) {
      weapon.gun.rotation.z += magSwap * 0.2;
      weapon.gun.rotation.x += rifleMagIn * 0.07;
      weapon.gun.position.y -= magSwap * 0.04;
      weapon.gun.position.z += rifleMagIn * 0.035;
    } else if (currentGun === GUNS.SHOTGUN && reloadActive) {
      weapon.gun.rotation.x += shellLoad * 0.065 - shotgunPump * 0.12;
      weapon.gun.rotation.z -= shotgunPump * 0.08;
      weapon.gun.position.z += shellLoad * 0.035 + shotgunPump * 0.04;
      weapon.gun.position.y -= shotgunPump * 0.035;
    } else if (currentGun === GUNS.SNIPER && reloadActive) {
      weapon.gun.rotation.z -= (sniperBoltBack + sniperBoltForward) * 0.18 + sniperMagSwap * 0.08;
      weapon.gun.rotation.x += sniperMagSwap * 0.05;
      weapon.gun.position.z += (sniperBoltBack + sniperBoltForward) * 0.05;
      weapon.gun.position.y -= sniperMagSwap * 0.025;
    }

    weapon.slide.position.x -= weaponAnim.slideKick * 0.085;
    weapon.slide.position.y += Math.max(0, weaponAnim.kick) * 0.008;
    if (currentGun === GUNS.SHOTGUN && reloadActive) weapon.slide.position.x -= shellLoad * 0.08 + shotgunPump * 0.28;
    if (currentGun === GUNS.SNIPER && reloadActive) {
      weapon.slide.position.x -= sniperBoltBack * 0.3 - sniperBoltForward * 0.04;
      weapon.slide.position.y += (sniperBoltBack + sniperBoltForward) * 0.035;
    }

    const activeMagSwap = currentGun === GUNS.SNIPER ? sniperMagSwap : magSwap;
    weapon.mag.position.x -= activeMagSwap * (currentGun === GUNS.RIFLE ? 0.1 : 0.08);
    weapon.mag.position.y -= activeMagSwap * (currentGun === GUNS.SHOTGUN ? 0.08 : 0.31);
    weapon.mag.position.z += activeMagSwap * (currentGun === GUNS.SNIPER ? 0.12 : 0.06);
    weapon.mag.rotation.z -= activeMagSwap * (currentGun === GUNS.SNIPER ? 0.7 : 1.35);
    weapon.mag.rotation.x += activeMagSwap * 0.35;
    if (currentGun === GUNS.RIFLE) {
      weapon.mag.position.y -= rifleMagOut * 0.18;
      weapon.mag.position.z += rifleMagIn * 0.08;
      weapon.mag.rotation.x += rifleMagOut * 0.28 - rifleMagIn * 0.18;
    }
    if (reloadActive && reloadT > 0.9) weapon.slide.position.x -= 0.05;
    // SMG-class rattle: high-frequency jitter of the whole FP gun while firing
    // (mirrors the TP layer so both pipelines stay consistent).
    const fpAnimSpec = GUN_SPECS[currentGun] || ({} as any);
    if (fpAnimSpec.fireCycle === "rattle" && gunState.fireCooldown > 0 && !reloadActive) {
      const tj = performance.now();
      const jAmp = 0.004 * (Number.isFinite(fpAnimSpec.driftMul) ? fpAnimSpec.driftMul : 1);
      weapon.gun.position.x += Math.sin(tj * 0.121) * jAmp;
      weapon.gun.position.y += Math.sin(tj * 0.163) * jAmp * 0.8;
      weapon.gun.rotation.z += Math.sin(tj * 0.147) * jAmp * 1.4;
    }
    applyWeaponDesignAnimation(weapon, currentGun, {
      shotT: flashT,
      reloadActive,
      reloadT,
      actionRack: currentGun === GUNS.SNIPER ? Math.max(sniperBoltBack, sniperBoltForward) : currentGun === GUNS.SHOTGUN ? shotgunPump : reloadRack,
      kick: weaponAnim.kick,
      slideKick: weaponAnim.slideKick,
      firing: gunState.fireCooldown > 0,
      cycleT: 1 - gunState.fireCooldown / Math.max(gunState.fireRate || 0.01, 0.01),
      magEmpty: gunState.mag <= 0,
      magCount: gunState.mag,
      magSize: gunState.magSize,
    });

    // Pack-a-Punch energy: a slow shimmer on the upgraded metal, plus a bright
    // flare that surges through the barrel-roll when an upgrade is applied.
    const packMats = weapon.gun.userData.packMats;
    const packBase = weapon.gun.userData.packGlowBase || 0;
    if (packMats && (packBase > 0 || weaponAnim.packAnim > 0)) {
      const tnow = performance.now();
      const shimmer = packBase > 0 ? 1 + Math.sin(tnow * 0.006) * 0.16 : 1;
      const flare = weaponAnim.packAnim > 0 ? Math.sin((1 - weaponAnim.packAnim) * Math.PI) * 3.4 : 0;
      const intensity = packBase * shimmer + flare;
      for (const m of packMats) m.emissiveIntensity = intensity;
    }

    if (game.state === "playing") {
      camera.getWorldPosition(cameraWorldTmp);
      camera.getWorldDirection(weaponClipDirTmp);
      raycaster.set(cameraWorldTmp, weaponClipDirTmp);
      raycaster.far = 1.25;
      raycastHitsTmp.length = 0;
      raycaster.intersectObjects(wallMeshes, false, raycastHitsTmp);
      const wallDist = raycastHitsTmp.length ? raycastHitsTmp[0].distance : Infinity;
      const propDist = nearestPropDistanceAhead(cameraWorldTmp, weaponClipDirTmp, 1.25, 0.12);
      const clipDist = Math.min(wallDist, propDist);
      raycaster.far = 42;
      if (clipDist < 1.05) {
        const clipT = clamp01((1.05 - clipDist) / 0.78);
        weapon.gun.position.z += clipT * 0.42;
        weapon.gun.position.y -= clipT * 0.2;
        weapon.gun.position.x -= clipT * 0.12;
        weapon.gun.rotation.x -= clipT * 0.55;
        weapon.gun.rotation.y += clipT * 0.32;
        weapon.gun.rotation.z += clipT * 0.2;
      }
    }

    const lightWeapon = getActiveWeaponForShot();
    if (lightWeapon?.muzzle) {
      getActiveMuzzleWorld(muzzleWorldTmp);
      camera.worldToLocal(cameraLocalTmp.copy(muzzleWorldTmp));
      gunFlash.position.copy(cameraLocalTmp);
    }
  }

  function updateCameraFX(dt) {
    const sprinting = game.state === "playing" && (keys.has("ShiftLeft") || keys.has("ShiftRight")) && player.stamina > 0;
    const gunSpec = GUN_SPECS[currentGun] || GUN_SPECS[GUNS.RIFLE];
    const lookBackTarget = keys.has("KeyC") && game.state === "playing" && !mouse.aiming ? 1 : 0;
    viewState.lookBack += (lookBackTarget - viewState.lookBack) * Math.min(1, dt * 12);

    const allowAds = !thirdPerson.enabled || mouse.aiming || currentGun === GUNS.SNIPER;
    const adsTarget = mouse.aiming && !sprinting && game.state === "playing" && viewState.lookBack < 0.1 && allowAds ? 1 : 0;
    const adsSpeed = adsTarget > viewState.ads ? gunSpec.adsInSpeed : gunSpec.adsOutSpeed;
    viewState.ads += (adsTarget - viewState.ads) * Math.min(1, dt * adsSpeed);

    const inTP = thirdPerson.enabled && thirdPerson.ready;
    // TP uses cinematic over-shoulder FOV (unchanged); FP uses wide immersive FPS FOV
    const baseFov = inTP
      ? (sprinting ? devVal("camera", "tpSprintFov", 70) : devVal("camera", "tpWalkFov", 63))
      : (sprinting ? devVal("camera", "fpSprintFov", 100) : devVal("camera", "fpWalkFov", 90));
    const cinFovOffset = cinematicState.enabled ? devVal("camera", "cinematicFovOffset", -4) : 0;
    cameraFX.targetFov = (baseFov + cinFovOffset) + (gunSpec.adsFov - baseFov + cinFovOffset) * viewState.ads;
    const prevFov = camera.fov;
    camera.fov += (cameraFX.targetFov - camera.fov) * Math.min(1, dt * 6);
    if (Math.abs(camera.fov - prevFov) > 0.01) camera.updateProjectionMatrix();

    // Near clip: FP needs small near for weapon; TP needs larger to avoid wall clipping.
    // For sniper ADS, blend the near plane forward past the gun so it gets cleanly clipped.
    const sniperNearPush = currentGun === GUNS.SNIPER ? viewState.ads * 0.88 : 0;
    const targetNear = inTP ? 0.10 : (0.05 + sniperNearPush);
    if (Math.abs(camera.near - targetNear) > 0.002) {
      camera.near = targetNear;
      camera.updateProjectionMatrix();
    }

    const recoilSettle = viewState.ads
      ? (currentGun === GUNS.SNIPER ? 1.32 : currentGun === GUNS.SHOTGUN ? 1.22 : 1.08)
      : (currentGun === GUNS.SNIPER ? 0.9 : currentGun === GUNS.SHOTGUN ? 1.48 : 1.38);
    cameraFX.recoilVel += (-cameraFX.recoil * (115 * recoilSettle) - cameraFX.recoilVel * (24 * recoilSettle)) * dt;
    cameraFX.recoil += cameraFX.recoilVel * dt;
    cameraFX.rollVel += (-cameraFX.roll * (105 * recoilSettle) - cameraFX.rollVel * (22 * recoilSettle)) * dt;
    cameraFX.roll += cameraFX.rollVel * dt;
    cameraFX.shake = Math.max(0, cameraFX.shake - dt * 2.6);
    cameraFX.damageShake = Math.max(0, cameraFX.damageShake - dt * 1.65);

    const noiseT = performance.now() * 0.03;
    const shakeAmp = cameraFX.shake * 0.02 + cameraFX.damageShake * 0.035;
    const shakeX = Math.sin(noiseT * 1.2) * shakeAmp;
    const shakeY = Math.cos(noiseT * 0.9) * shakeAmp * 0.8;
    const shakeZ = -Math.max(0, cameraFX.recoil) * 0.008 + Math.sin(noiseT * 1.8) * shakeAmp * 0.35;
    const useThirdPersonCamera = thirdPerson.enabled && thirdPerson.ready && !shouldUseFirstPersonAdsView();
    thirdPerson.viewBlend = useThirdPersonCamera ? 1 : 0;
    thirdPerson.switchPulse = Math.max(0, thirdPerson.switchPulse - dt * 5.2);
    thirdPerson.adsSwapProgress = thirdPerson.switchPulse * 0.32;

    if (useThirdPersonCamera) {
      camera.position.copy(resolveThirdPersonCameraPosition(shakeX, shakeY, shakeZ));
    } else if (unifiedFirstPersonBodyActive()) {
      // Sit at the EYES: forward of the body centre-line (past the shoulders) so the
      // view looks out from the face and the arms read from below, not from behind.
      camera.position.set(shakeX + FP_CAM_OFF_X, shakeY + UNIFIED_FP_EYE_UP + FP_CAM_OFF_Y, shakeZ - UNIFIED_FP_EYE_FORWARD + FP_CAM_OFF_Z);
    } else {
      camera.position.set(shakeX + FP_CAM_OFF_X, shakeY + FP_CAM_OFF_Y, shakeZ + FP_CAM_OFF_Z);
    }
    applyViewModeVisibility();

    const sniperAds = currentGun === GUNS.SNIPER ? viewState.ads : 0;
    const scopeSwayX = currentGun === GUNS.SNIPER ? Math.sin(noiseT * 0.34) * sniperAds * 0.00045 : 0;
    const scopeSwayY = currentGun === GUNS.SNIPER ? Math.cos(noiseT * 0.28) * sniperAds * 0.00038 : 0;

    const bobLat = (player.bobLateral || 0) * (1 - viewState.ads * 0.7);
    const strafeLean = (weaponAnim?.strafeTilt || 0) * 0.32 * (1 - viewState.ads * 0.6);
    const landJoltPitch = (weaponAnim?.landJolt || 0) * 0.018 * (1 - viewState.ads * 0.5);

    camera.rotation.x = scopeSwayX - Math.max(0, cameraFX.recoil) * 0.012 - landJoltPitch;
    camera.rotation.y = Math.PI * viewState.lookBack + scopeSwayY + bobLat * 0.012;
    camera.rotation.z = cameraFX.roll * 0.035 + Math.sin(noiseT * 0.7) * cameraFX.shake * 0.015 + viewState.lookBack * 0.045 + strafeLean;
  }

  // ── Interact prompt pill ─────────────────────────────────────────────────────
  // "PRESS E: ..." prompts (pack-a-punch, perk statue, mystery box, car alarm)
  // used to render as plain text in #pack-prompt (easy to miss). This upgrades
  // it into a pill: an animated key badge + bold action text + an XP-cost badge
  // when present, built once from JS (so both HTML entry points share it
  // without markup edits — CSS for the pill/badge/animations lives in the
  // <style> of both HTML files). Only touches the DOM when the prompt string
  // actually changes, so it's a no-op most frames (no per-frame layout thrash).
  let lastInteractPrompt = null;
  function ensureInteractPromptParts(el) {
    if (el.dataset.built) return;
    el.dataset.built = "1";
    el.innerHTML = "";
    const key = document.createElement("span");
    key.id = "pack-prompt-key";
    key.textContent = "E";
    const textWrap = document.createElement("span");
    textWrap.id = "pack-prompt-text";
    const action = document.createElement("span");
    action.id = "pack-prompt-action";
    const cost = document.createElement("span");
    cost.id = "pack-prompt-cost";
    textWrap.append(action, cost);
    el.append(key, textWrap);
  }
  function updateInteractPrompt(raw) {
    const el = hud.packPrompt;
    if (!el || raw === lastInteractPrompt) return;
    const wasActive = !!lastInteractPrompt;
    lastInteractPrompt = raw;
    ensureInteractPromptParts(el);
    if (!raw) {
      el.classList.remove("active", "has-key");
      return;
    }
    const action = el.querySelector("#pack-prompt-action");
    const cost = el.querySelector("#pack-prompt-cost");
    // "PRESS E: <action> (<N> XP)" → key badge + bold action + cost badge.
    // Anything else (info-only messages like "NEEDS 40 XP" / "MAXED") shows as
    // plain pill text with no key badge.
    const m = /^PRESS E:\s*(.+?)(?:\s*\((\d+)\s*XP\)\s*)?$/.exec(raw);
    if (m) {
      action.textContent = m[1];
      cost.textContent = m[2] ? `${m[2]} XP` : "";
      cost.style.display = m[2] ? "" : "none";
      el.classList.add("has-key");
    } else {
      action.textContent = raw;
      cost.textContent = "";
      cost.style.display = "none";
      el.classList.remove("has-key");
    }
    el.classList.add("active");
    if (!wasActive) {
      // Retrigger the scale-in "pop" animation on fresh appearance only.
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
    }
  }

  // ── Weapon-slot indicator ────────────────────────────────────────────────────
  // Compact row in the weapon (end) hud-block showing every gun in the roster; the
  // slots you OWN light up (current = accent-filled), un-owned read as dim/locked.
  // Ties directly into the mystery-box progression. JS-created so both html entry
  // points get it without markup edits. Rebuilt only on ownership/switch change.
  const WEAPON_SLOT_CODES = {
    pistol: "P", rifle: "AR", shotgun: "SG", sniper: "SR", smg: "SMG",
    lmg: "LMG", dmr: "DMR", akimbo: "MP", railgun: "RL", flak: "FK",
  };
  let weaponSlotsRow = null;
  let weaponSlotsSig = "";
  function ensureWeaponSlots() {
    if (weaponSlotsRow) return weaponSlotsRow;
    const endBlock = document.querySelector("#bottom-hud .hud-block.end");
    if (!endBlock) return null;
    weaponSlotsRow = document.createElement("div");
    weaponSlotsRow.id = "weapon-slots";
    weaponSlotsRow.style.cssText =
      "display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;margin-top:7px;" +
      "pointer-events:none;font:800 9px/1 'Rajdhani','Segoe UI',sans-serif;letter-spacing:0.08em;";
    for (const gunType of Object.values(GUNS)) {
      const chip = document.createElement("span");
      chip.dataset.slot = gunType;
      chip.textContent = WEAPON_SLOT_CODES[gunType] || gunType.slice(0, 2).toUpperCase();
      chip.title = GUN_SPECS[gunType]?.name || gunType;
      chip.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:16px;" +
        "padding:0 5px;border-radius:2px;border:1px solid rgba(120,150,170,0.28);" +
        "background:rgba(10,18,26,0.6);color:#5c7480;transition:color .15s,background .15s,border-color .15s;";
      weaponSlotsRow.appendChild(chip);
    }
    endBlock.appendChild(weaponSlotsRow);
    return weaponSlotsRow;
  }
  function updateWeaponSlots() {
    const row = ensureWeaponSlots();
    if (!row) return;
    // Cheap dirty-check so we only touch the DOM when ownership/equip changes.
    const sig = currentGun + "|" + [...player.ownedWeapons].sort().join(",");
    if (sig === weaponSlotsSig) return;
    weaponSlotsSig = sig;
    for (const chip of row.children) {
      const g = chip.dataset.slot;
      const owned = ownsWeapon(g);
      const equipped = g === currentGun;
      if (equipped) {
        chip.style.color = "#06121a";
        chip.style.background = "linear-gradient(180deg,#67e8f9,#22d3ee)";
        chip.style.borderColor = "#22d3ee";
        chip.style.boxShadow = "0 0 9px rgba(34,211,238,0.55)";
      } else if (owned) {
        chip.style.color = "#c8dbe6";
        chip.style.background = "rgba(14,30,40,0.78)";
        chip.style.borderColor = "rgba(103,232,249,0.4)";
        chip.style.boxShadow = "none";
      } else {
        chip.style.color = "#4a5c66";
        chip.style.background = "rgba(10,16,22,0.5)";
        chip.style.borderColor = "rgba(90,110,124,0.22)";
        chip.style.boxShadow = "none";
      }
    }
  }

  // ── Perk HUD row ─────────────────────────────────────────────────────────────
  // Small icon row showing owned perks (Overcharge/Vitality/Aegis). Created from JS
  // and appended to #hud so it works in BOTH html entry points without markup edits.
  // Styled to match the HUD's cyan/steel aesthetic; each perk keeps its accent color.
  let perkHudRow = null;
  function ensurePerkHudRow() {
    if (perkHudRow) return perkHudRow;
    // Anchored INSIDE the health hud-block (as an extra in-flow row under the
    // sprint-status line) instead of absolute-positioned over the HUD, so it can
    // never overlap the HP bar/label at any viewport size — it just pushes the
    // block a little taller. `#bottom-hud .hud-block` (first child) is the
    // health block in both HTML entry points (see index.html / legacy html
    // #bottom-hud markup — health block is always listed first).
    const healthBlock = document.querySelector("#bottom-hud .hud-block");
    if (!healthBlock) return null;
    perkHudRow = document.createElement("div");
    perkHudRow.id = "perk-row";
    perkHudRow.style.cssText =
      "display:flex;flex-wrap:wrap;gap:6px;pointer-events:none;margin-top:6px;" +
      "padding-top:6px;border-top:1px solid rgba(120,150,170,0.22);" +
      "font:600 10px/1 'Rajdhani','Segoe UI',sans-serif;letter-spacing:0.08em;";
    for (const def of PERK_DEFS) {
      const chip = document.createElement("div");
      chip.dataset.perk = def.id;
      chip.title = `${def.name} — ${def.desc}`;
      chip.style.cssText =
        "display:none;align-items:center;gap:5px;padding:4px 8px 4px 5px;" +
        "background:rgba(10,18,26,0.72);border:1px solid rgba(120,150,170,0.35);" +
        "border-left:3px solid " + def.color + ";color:#c8dbe6;text-transform:uppercase;";
      const badge = document.createElement("span");
      badge.textContent = def.initial;
      badge.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;" +
        "border-radius:50%;font-weight:800;color:#06121a;background:" + def.color + ";" +
        "box-shadow:0 0 8px " + def.color + "66;";
      const label = document.createElement("span");
      label.textContent = def.name;
      chip.append(badge, label);
      perkHudRow.appendChild(chip);
    }
    healthBlock.appendChild(perkHudRow);
    return perkHudRow;
  }
  function updatePerkHud() {
    const row = ensurePerkHudRow();
    if (!row) return;
    const owned = player.perkTier || 0;
    // Collapse the divider row entirely while no perks are owned so the health
    // block doesn't grow/show a stray hairline before the first perk purchase.
    row.style.display = owned > 0 ? "flex" : "none";
    let i = 0;
    for (const chip of row.children) {
      chip.style.display = i < owned ? "inline-flex" : "none";
      i++;
    }
  }

  // ── Death fade-to-black ──────────────────────────────────────────────────────
  // Full-screen DOM fade below the HUD/#state-overlay (z-index 4 < hud's 5) and
  // above the canvas, created from JS so both html entry points get it. endGame
  // starts a ~2.5 s CSS opacity transition while the death animation plays; the
  // stats overlay and HUD stay fully visible above it. Reset on restart/new mission.
  let deathFadeEl = null;
  function ensureDeathFade() {
    if (deathFadeEl) return deathFadeEl;
    deathFadeEl = document.createElement("div");
    deathFadeEl.id = "death-fade";
    deathFadeEl.style.cssText =
      "position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;" +
      "z-index:4;transition:opacity 2.5s ease-in;";
    document.body.appendChild(deathFadeEl);
    return deathFadeEl;
  }
  function startDeathFade() {
    const el = ensureDeathFade();
    // Force a style flush so the transition runs even if the div was just created.
    void el.offsetWidth;
    el.style.opacity = "1";
  }
  function resetDeathFade() {
    if (!deathFadeEl) return;
    deathFadeEl.style.transition = "none";
    deathFadeEl.style.opacity = "0";
    void deathFadeEl.offsetWidth;
    deathFadeEl.style.transition = "opacity 2.5s ease-in";
  }

  function updateHUD(dt) {
    if (hud.hpVal) {
      const hp = Math.ceil(player.hp);
      setTextIfChanged(hud.hpVal, player.unlimitedHealth ? "INF" : hp);
      setClassIfChanged(hud.hpVal, "hud-value" + (!player.unlimitedHealth && hp < 30 ? " danger" : ""));
    }
    if (hud.hpBar) setStyleIfChanged(hud.hpBar.style, "width", (player.hp / player.maxHp) * 100 + "%");
    setTextIfChanged(hud.weaponVal, gunState.displayName);
    updateWeaponSlots();
    if (hud.xpVal) setTextIfChanged(hud.xpVal, player.xp);
    if (hud.packVal) {
      const level = gunUpgradeLevels[currentGun] || 0;
      setTextIfChanged(hud.packVal, level >= MAX_PACK_LEVEL ? "MAX" : `MK${level + 1}`);
    }
    if (hud.packPrompt) {
      // Combined interaction prompt: pack station + the exterior stations all
      // share this one HUD line (they're spaced apart, so at most one is ever
      // active at a time). Priority order matches tryInteract().
      const combinedPrompt = packState.prompt || perkMachineState.prompt || mysteryBoxState.prompt || carAlarmState.prompt || "";
      updateInteractPrompt(combinedPrompt);
    }
    if (hud.ammoVal) {
      setTextIfChanged(hud.ammoMag, player.unlimitedAmmo ? "INF" : gunState.mag);
      setTextIfChanged(hud.ammoReserve, player.unlimitedAmmo ? "INF" : gunState.ammo);
      setClassIfChanged(hud.ammoVal, "hud-value" + (player.unlimitedAmmo ? "" : gunState.mag <= 0 ? " danger" : gunState.mag < 4 ? " low-ammo" : ""));
    }
    setTextIfChanged(hud.killsVal, `${game.killed} / ${game.totalEnemies}`);
    if (hud.staminaBar) {
      const sp = player.stamina / player.maxStamina;
      setStyleIfChanged(hud.staminaBar.style, "width", (player.unlimitedSprint ? 1 : sp) * 100 + "%");
      if (hud.staminaWrap) setStyleIfChanged(hud.staminaWrap.style, "opacity", player.unlimitedSprint || player.stamina < player.maxStamina ? "1" : "0.3");
    }

    const reloading = gunState.reloadTimer > 0;
    hud.reloadWrap?.classList.toggle("active", reloading);
    if (reloading) {
      if (hud.reloadBar) setStyleIfChanged(hud.reloadBar.style, "width", (1 - gunState.reloadTimer / gunState.reloadTime) * 100 + "%");
      gunState.reloadTimer = Math.max(0, gunState.reloadTimer - dt);
      if (gunState.reloadTimer <= 0) finishReload();
    }

    if (game.hitMarkerTimer > 0) {
      game.hitMarkerTimer = Math.max(0, game.hitMarkerTimer - dt);
      if (game.hitMarkerTimer <= 0) hud.hitMarker?.classList.remove("active");
    }
    if (player.hurtTimer > 0) {
      player.hurtTimer = Math.max(0, player.hurtTimer - dt);
      if (player.hurtTimer <= 0 && hud.damageVig) {
        hud.damageVig.style.setProperty("opacity", "0", "important");
        hud.damageVig.style.setProperty("visibility", "hidden", "important");
        // restore default background so subsequent flashes use center origin
        hud.damageVig.style.removeProperty("background");
      }
    }
    if (player.streakTimer > 0) {
      player.streakTimer -= dt;
      if (player.streakTimer <= 0) {
        player.killStreak = 0;
        updateStreak();
      }
    }
    if (game.multiKillTimer > 0) {
      game.multiKillTimer -= dt;
      if (game.multiKillTimer <= 0) game.multiKillCount = 0;
    }
    if (player.meleeCooldown > 0) player.meleeCooldown = Math.max(0, player.meleeCooldown - dt);
    // Per-gun spread-bloom recovery (rad/s from the spec).
    if (gunState.bloom > 0) {
      gunState.bloom = Math.max(0, gunState.bloom - dt * (GUN_SPECS[currentGun]?.bloomDecay ?? 0.15));
    }
    if (player.meleeTimer > 0) player.meleeTimer = Math.max(0, player.meleeTimer - dt);
    if (player.pvpDead && player.respawnTimer > 0) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0) respawnLocalPlayer();
      else if (hud.objective && net?.active && gameMode === "coop") {
        hud.objective.textContent = `DOWNED - RESPAWN IN ${Math.ceil(player.respawnTimer)}s`;
      }
    }
  }

  // ── GTA-style minimap ────────────────────────────────────────────────────
  // Full-world layout (interior MAP grid + exterior street from exterior_map.js
  // via window.__extMapFootprints / __extMapLayout) is rasterized ONCE into an
  // offscreen "world texture" at MM_S px per world unit. Per frame we blit the
  // relevant rotated/zoomed window of it inside a circular clip — the player
  // arrow stays fixed (slightly below centre) pointing up and the WORLD rotates
  // around it, GTA style. Blips are projected manually so off-map ones can be
  // clamped to the rim.
  let lastMinimapUpdate = 0;
  const MINIMAP_UPDATE_MS = lowEndMode ? 66 : 33; // ~15 / ~30 Hz
  const MM_S = 4;                                  // world-texture px per world unit
  const MM_WX0 = -75, MM_WZ0 = -41, MM_WX1 = 75, MM_WZ1 = 233; // world coverage
  const minimapBaseCanvas = mmCanvas ? document.createElement("canvas") : null;
  const minimapBaseCtx = minimapBaseCanvas?.getContext("2d") ?? null;
  let mmBaseBuilt = false;
  let mmBaseFootprintCount = -1;
  let mmZoom = 0.85;         // px-on-screen per world-texture px (smoothed)
  const MM_ZOOM_WALK = 0.85; // ≈ 28 u visible radius
  const MM_ZOOM_SPRINT = 0.64;

  function mmWorldToBase(x, z) {
    return { bx: (x - MM_WX0) * MM_S, by: (z - MM_WZ0) * MM_S };
  }

  // Rasterize the full world layout once (interior grid + exterior street).
  // Rebuilds only when the exterior footprint count changes (e.g. the landmark
  // statue registers its collider a few seconds into boot) — never per frame.
  function buildMinimapWorldTexture() {
    if (!minimapBaseCanvas || !minimapBaseCtx) return;
    const fp = Array.isArray(window.__extMapFootprints) ? window.__extMapFootprints : [];
    if (mmBaseBuilt && fp.length === mmBaseFootprintCount) return;
    mmBaseBuilt = true;
    mmBaseFootprintCount = fp.length;

    const W = (MM_WX1 - MM_WX0) * MM_S;
    const H = (MM_WZ1 - MM_WZ0) * MM_S;
    minimapBaseCanvas.width  = W;
    minimapBaseCanvas.height = H;
    const ctx = minimapBaseCtx;

    // Dark steel base everywhere (out-of-bounds reads as void)
    ctx.fillStyle = "#04080c";
    ctx.fillRect(0, 0, W, H);

    const rect = (x0, z0, x1, z1, fill) => {
      ctx.fillStyle = fill;
      ctx.fillRect((x0 - MM_WX0) * MM_S, (z0 - MM_WZ0) * MM_S, (x1 - x0) * MM_S, (z1 - z0) * MM_S);
    };

    // ── Exterior street (exterior_map.js layout export) ──
    const lay = window.__extMapLayout;
    const eb  = lay?.bounds || window.__extBounds;
    if (eb) {
      // Play-area ground
      rect(eb.xMin, eb.zNear, eb.xMax, eb.zFar, "rgba(120,150,170,0.10)");
      // Sidewalks
      for (const sw of (lay?.sidewalks || [])) {
        rect(sw.x - sw.w / 2, eb.zNear, sw.x + sw.w / 2, eb.zFar, "rgba(140,170,190,0.16)");
      }
      // Road asphalt
      const rh = lay?.roadHalfW ?? 19;
      rect(-rh, eb.zNear, rh, eb.zFar, "rgba(70,95,115,0.30)");
      // Lane markings — centre dashed line + edge lines
      ctx.fillStyle = "rgba(190,225,240,0.30)";
      for (let z = eb.zNear + 5; z < eb.zFar; z += 10) {
        ctx.fillRect((0 - MM_WX0) * MM_S - 1, (z - MM_WZ0) * MM_S, 2, 4.2 * MM_S);
      }
      ctx.fillStyle = "rgba(190,225,240,0.18)";
      ctx.fillRect((-rh + 0.1 - MM_WX0) * MM_S, (eb.zNear - MM_WZ0) * MM_S, 1.5, (eb.zFar - eb.zNear) * MM_S);
      ctx.fillRect(( rh - 0.1 - MM_WX0) * MM_S - 1.5, (eb.zNear - MM_WZ0) * MM_S, 1.5, (eb.zFar - eb.zNear) * MM_S);
      // Crosswalk band
      if (lay?.crosswalkZ) rect(-16, lay.crosswalkZ - 6, 16, lay.crosswalkZ + 6, "rgba(190,225,240,0.10)");

      // Building / prop footprints (AABB colliders). Skip the thin boundary
      // walls (half-extent > 25 u) and dust off tiny prop colliders.
      for (const c of fp) {
        if (c.hw > 25 || c.hd > 25) continue;
        const big = c.hw >= 1.0 && c.hd >= 1.0;
        const px = (c.x - c.hw - MM_WX0) * MM_S, py = (c.z - c.hd - MM_WZ0) * MM_S;
        const pw = c.hw * 2 * MM_S, ph = c.hd * 2 * MM_S;
        ctx.fillStyle = big ? "rgba(116,146,168,0.62)" : "rgba(116,146,168,0.34)";
        ctx.fillRect(px, py, pw, ph);
        if (big) { // top-left highlight for depth (matches interior walls)
          ctx.fillStyle = "rgba(160,220,240,0.16)";
          ctx.fillRect(px, py, pw, 1.5);
          ctx.fillRect(px, py, 1.5, ph);
        }
      }
    }

    // ── Interior MAP grid ──
    for (let my = 0; my < MAP_H; my++) {
      for (let mx = 0; mx < MAP_W; mx++) {
        const ch = MAP[my][mx];
        const wc = mapToWorld(mx, my); // cell centre
        const px = (wc.x - CELL * 0.5 - MM_WX0) * MM_S;
        const py = (wc.z - CELL * 0.5 - MM_WZ0) * MM_S;
        const sz = CELL * MM_S;
        if (ch === "#") {
          ctx.fillStyle = "rgba(116,146,168,0.62)";
          ctx.fillRect(px, py, sz - 1, sz - 1);
          ctx.fillStyle = "rgba(160,220,240,0.16)";
          ctx.fillRect(px, py, sz - 1, 1.5);
          ctx.fillRect(px, py, 1.5, sz - 1);
        } else if (ch === "+") {
          ctx.fillStyle = "rgba(90,220,150,0.24)";
          ctx.fillRect(px, py, sz - 1, sz - 1);
        } else {
          ctx.fillStyle = "rgba(190,230,245,0.055)";
          ctx.fillRect(px, py, sz - 1, sz - 1);
        }
      }
    }
    // Subtle grid over the interior block
    const gx0 = (mapToWorld(0, 0).x - CELL * 0.5 - MM_WX0) * MM_S;
    const gy0 = (mapToWorld(0, 0).z - CELL * 0.5 - MM_WZ0) * MM_S;
    ctx.strokeStyle = "rgba(80,180,210,0.10)";
    ctx.lineWidth = 0.6;
    for (let mx = 0; mx <= MAP_W; mx++) {
      ctx.beginPath(); ctx.moveTo(gx0 + mx * CELL * MM_S, gy0); ctx.lineTo(gx0 + mx * CELL * MM_S, gy0 + MAP_H * CELL * MM_S); ctx.stroke();
    }
    for (let my = 0; my <= MAP_H; my++) {
      ctx.beginPath(); ctx.moveTo(gx0, gy0 + my * CELL * MM_S); ctx.lineTo(gx0 + MAP_W * CELL * MM_S, gy0 + my * CELL * MM_S); ctx.stroke();
    }
  }
  // Dev-preset map reload → force a texture rebuild next frame.
  window.__rbMinimapRebuild = () => { mmBaseBuilt = false; };

  function renderMinimap(now) {
    if (!mmCanvas || !mmCtx) return;
    if (now - lastMinimapUpdate < MINIMAP_UPDATE_MS) return;
    const dtMs = Math.min(200, now - lastMinimapUpdate);
    lastMinimapUpdate = now;
    buildMinimapWorldTexture();

    const w = mmCanvas.width, h = mmCanvas.height;
    const cx = w * 0.5, cy = h * 0.5;
    const R  = Math.min(w, h) * 0.5 - 3;   // circle radius
    const pcx = cx, pcy = cy + R * 0.20;   // player anchor, GTA-style below centre
    const ctx = mmCtx;
    const nowSec = now / 1000;

    // Zoom eases out a touch while sprinting
    const zoomTarget = thirdPerson?.lastMove?.sprinting ? MM_ZOOM_SPRINT : MM_ZOOM_WALK;
    mmZoom += (zoomTarget - mmZoom) * Math.min(1, dtMs * 0.004);

    const ang = yaw.rotation.y;            // map rotates by +ang → forward is up
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const pb = mmWorldToBase(yaw.position.x, yaw.position.z);

    // Project a world position into minimap screen space (player-relative,
    // rotated, zoomed). Clamps to the rim like GTA when out of range.
    const projectBlip = (wx, wz) => {
      const b = mmWorldToBase(wx, wz);
      const dx = (b.bx - pb.bx) * mmZoom, dy = (b.by - pb.by) * mmZoom;
      let sx = pcx + dx * cosA - dy * sinA;
      let sy = pcy + dx * sinA + dy * cosA;
      const ox = sx - cx, oy = sy - cy;
      const dist = Math.hypot(ox, oy);
      const lim = R - 9;
      if (dist > lim) {
        const k = lim / dist;
        return { sx: cx + ox * k, sy: cy + oy * k, clamped: true };
      }
      return { sx, sy, clamped: false };
    };

    ctx.clearRect(0, 0, w, h);

    // ── Rotated world inside circular clip ──
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(3,7,10,0.94)";
    ctx.fillRect(0, 0, w, h);
    if (minimapBaseCanvas && mmBaseBuilt) {
      ctx.save();
      ctx.translate(pcx, pcy);
      ctx.rotate(ang);
      ctx.scale(mmZoom, mmZoom);
      ctx.translate(-pb.bx, -pb.by);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(minimapBaseCanvas, 0, 0);
      ctx.restore();
    }

    const pvpLayoutOnly = !!(net?.active && gameMode === "pvp");

    // ── Interactable blips ──
    // Pack-a-Punch — yellow diamond
    if (!pvpLayoutOnly && packState.station) {
      const p = projectBlip(packState.station.position.x, packState.station.position.z);
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.rotate(Math.PI * 0.25);
      const sz = p.clamped ? 2.6 : 3.6;
      if (packState.active && !p.clamped) { ctx.shadowColor = "#ffe26a"; ctx.shadowBlur = 7; }
      ctx.fillStyle = packState.active ? "#ffe26a" : "rgba(255,210,85,0.65)";
      ctx.fillRect(-sz, -sz, sz * 2, sz * 2);
      ctx.restore();
    }
    // Perk statue — amber ringed dot
    if (!pvpLayoutOnly && perkMachineState.station) {
      const p = projectBlip(perkMachineState.station.position.x, perkMachineState.station.position.z);
      ctx.fillStyle = perkMachineState.active ? "#ffb020" : "rgba(255,176,32,0.60)";
      ctx.beginPath(); ctx.arc(p.sx, p.sy, p.clamped ? 2.2 : 3.0, 0, Math.PI * 2); ctx.fill();
      if (!p.clamped) {
        ctx.strokeStyle = "rgba(255,205,110,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Mystery box — violet square
    if (!pvpLayoutOnly && mysteryBoxState.station) {
      const p = projectBlip(mysteryBoxState.station.position.x, mysteryBoxState.station.position.z);
      const sz = p.clamped ? 2.2 : 3.2;
      ctx.fillStyle = mysteryBoxState.rolling ? "#c9a0ff" : "rgba(178,140,255,0.8)";
      ctx.fillRect(p.sx - sz, p.sy - sz, sz * 2, sz * 2);
    }
    // Ringing car alarm — pulsing yellow
    if (!pvpLayoutOnly && carAlarmState.ringing && nowSec < carAlarmState.ringUntil) {
      const car = carAlarmState.ringing;
      const p = projectBlip(car.x, car.z);
      const pulse = 0.6 + 0.4 * Math.sin(now * 0.02);
      ctx.fillStyle = `rgba(255,224,80,${(0.55 + pulse * 0.45).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 3 + pulse * 1.6, 0, Math.PI * 2); ctx.fill();
      if (!p.clamped) {
        ctx.strokeStyle = `rgba(255,224,80,${(0.5 * pulse).toFixed(2)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 6 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Active sound lure — expanding ring ping
    if (!pvpLayoutOnly && soundLure.until > nowSec) {
      const p = projectBlip(soundLure.x, soundLure.z);
      const t = (now * 0.0012) % 1;
      ctx.strokeStyle = `rgba(255,240,140,${(0.65 * (1 - t)).toFixed(2)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 3 + t * 13, 0, Math.PI * 2); ctx.stroke();
    }

    // ── Enemy blips — red; angels are triangles, ground units dots ──
    const minimapEnemies = pvpLayoutOnly ? [] : isCoopGuest() && coopMinimapEnemies.length ? coopMinimapEnemies : enemies;
    const tPulse = (now * 0.003) % (Math.PI * 2);
    for (const enemy of minimapEnemies) {
      if (!enemy.alive) continue;
      const exW = enemy.mesh?.position?.x ?? enemy.x;
      const ezW = enemy.mesh?.position?.z ?? enemy.z;
      const p = projectBlip(exW, ezW);
      const dim = p.clamped ? 0.55 : 1;
      if (enemy.aggroed && !p.clamped) {
        const pulse = 3.5 + Math.sin(tPulse + (enemy.animSeed || 0)) * 1.0;
        ctx.strokeStyle = "rgba(255,40,60,0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, pulse, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = enemy.aggroed ? `rgba(255,34,68,${dim})` : `rgba(255,136,34,${dim})`;
      if (enemy.type?.angelModel) {
        const sz = p.clamped ? 2.6 : 3.4;
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy - sz);
        ctx.lineTo(p.sx + sz * 0.9, p.sy + sz * 0.8);
        ctx.lineTo(p.sx - sz * 0.9, p.sy + sz * 0.8);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(p.sx, p.sy, p.clamped ? 2.0 : 2.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ── Remote players — green arrows (coop) / reveal-only amber (pvp) ──
    if (net?.active && remotePlayers?.size) {
      const pvpRevealOnly = gameMode === "pvp";
      for (const avatar of remotePlayers.values()) {
        if (!avatar?.root || avatar.id === myNetId) continue;
        if (pvpRevealOnly && now > (avatar.minimapRevealUntil || 0)) continue;
        const p = projectBlip(avatar.root.position.x, avatar.root.position.z);
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(ang - avatar.root.rotation.y); // world-rotated frame
        ctx.fillStyle = avatar.dead || avatar.hp <= 0 ? "rgba(140,140,140,0.72)" : pvpRevealOnly ? "#ffb35f" : "#5eff8a";
        ctx.strokeStyle = pvpRevealOnly ? "rgba(255,225,180,0.88)" : "rgba(220,255,230,0.8)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(0, -5.2);
        ctx.lineTo(4.0, 3.8);
        ctx.lineTo(-4.0, 3.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── Player arrow — fixed, pointing up ──
    ctx.save();
    ctx.translate(pcx, pcy);
    const cone = ctx.createRadialGradient(0, 0, 0, 0, -21, 32);
    cone.addColorStop(0, "rgba(140,225,245,0.18)");
    cone.addColorStop(1, "rgba(140,225,245,0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-9.5, -31);
    ctx.lineTo(9.5, -31);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = "#67e8f9";
    ctx.shadowBlur = 6;
    ctx.strokeStyle = "rgba(220,245,252,0.96)";
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-Math.sin(2.4) * 4.2, 7.5 - Math.cos(2.4) * 4.2);
    ctx.lineTo(0, -7.5);
    ctx.lineTo(Math.sin(2.4) * 4.2, 7.5 - Math.cos(2.4) * 4.2);
    ctx.stroke();
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#eafcff";
    ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Soft vignette toward the circle edge (still clipped)
    const vig = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.52)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    // Wave/hostiles readout inside lower rim
    ctx.font = "9px 'Share Tech Mono', monospace";
    ctx.fillStyle = "rgba(150,215,235,0.78)";
    ctx.textAlign = "center";
    ctx.fillText(`W${game.wave} · ${Math.max(0, game.totalEnemies - game.killed)} HOSTILES`, cx, h - 9);
    ctx.restore(); // end circular clip

    // ── Rim ring + north indicator (unclipped) ──
    ctx.strokeStyle = "rgba(60,200,230,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(34,211,238,0.14)";
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(cx, cy, R - 2.5, 0, Math.PI * 2); ctx.stroke();

    // North marker rides the rim (world −z direction, rotated with the map)
    const nx = cx + sinA * (R - 8);
    const ny = cy - cosA * (R - 8);
    ctx.font = "bold 10px 'Share Tech Mono', monospace";
    ctx.fillStyle = "rgba(230,250,255,0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", nx, ny);
    ctx.textBaseline = "alphabetic";
  }

  function renderOverlayScan() {
    if (!ovScanCanvas || !ovScanCtx) return;

    // Match canvas resolution to its CSS display size
    const rect = ovScanCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width  || ovScanCanvas.offsetWidth  || 320));
    const h = Math.max(1, Math.round(rect.height || ovScanCanvas.offsetHeight || 160));
    if (ovScanCanvas.width !== w)  ovScanCanvas.width  = w;
    if (ovScanCanvas.height !== h) ovScanCanvas.height = h;

    const pad = 6;
    const s = Math.min((w - pad * 2) / MAP_W, (h - pad * 2) / MAP_H);

    // Background
    ovScanCtx.clearRect(0, 0, w, h);
    ovScanCtx.fillStyle = "rgba(0,0,0,0.72)";
    ovScanCtx.fillRect(0, 0, w, h);

    // Map grid — walls and open cells
    for (let my = 0; my < MAP_H; my++) {
      for (let mx = 0; mx < MAP_W; mx++) {
        const ch = MAP[my][mx];
        ovScanCtx.fillStyle =
          ch === "#" ? "rgba(80,140,200,0.50)" :
          ch === "+" ? "rgba(60,210,140,0.22)" :
                       "rgba(255,255,255,0.038)";
        ovScanCtx.fillRect(pad + mx * s, pad + my * s, Math.max(1, s - 0.8), Math.max(1, s - 0.8));
      }
    }

    // Subtle crosshair at map centre
    const cx = pad + MAP_W * s * 0.5, cy = pad + MAP_H * s * 0.5;
    ovScanCtx.strokeStyle = "rgba(0,200,255,0.10)";
    ovScanCtx.lineWidth = 0.8;
    ovScanCtx.beginPath(); ovScanCtx.moveTo(cx, pad); ovScanCtx.lineTo(cx, h - pad); ovScanCtx.stroke();
    ovScanCtx.beginPath(); ovScanCtx.moveTo(pad, cy); ovScanCtx.lineTo(w - pad, cy); ovScanCtx.stroke();

    // Pack station
    if (packState.station) {
      const pc = worldToMap(packState.station.position.x, packState.station.position.z);
      const sx = pad + (pc.mx + 0.5) * s;
      const sy = pad + (pc.my + 0.5) * s;
      ovScanCtx.save();
      ovScanCtx.translate(sx, sy);
      ovScanCtx.rotate(Math.PI * 0.25);
      ovScanCtx.fillStyle = "rgba(255,210,85,0.85)";
      const hs = Math.max(2, s * 0.55);
      ovScanCtx.fillRect(-hs * 0.5, -hs * 0.5, hs, hs);
      ovScanCtx.restore();
    }

    // Live enemies
    const scanEnemies = isCoopGuest() && coopMinimapEnemies.length ? coopMinimapEnemies : enemies;
    for (const enemy of scanEnemies) {
      if (!enemy.alive) continue;
      const ex = enemy.mesh?.position?.x ?? enemy.x;
      const ez = enemy.mesh?.position?.z ?? enemy.z;
      const ec = worldToMap(ex, ez);
      const epx = pad + (ec.mx + 0.5) * s;
      const epy = pad + (ec.my + 0.5) * s;
      const r = Math.max(1.8, s * 0.42);
      if (enemy.aggroed) {
        ovScanCtx.strokeStyle = "rgba(255,60,60,0.50)";
        ovScanCtx.lineWidth = 0.9;
        ovScanCtx.beginPath();
        ovScanCtx.arc(epx, epy, r + 2.2, 0, Math.PI * 2);
        ovScanCtx.stroke();
      }
      ovScanCtx.fillStyle = enemy.aggroed ? "#ff2444" : "#ff8833";
      ovScanCtx.beginPath();
      ovScanCtx.arc(epx, epy, r, 0, Math.PI * 2);
      ovScanCtx.fill();
    }

    // Player — dot + forward direction tick
    const pc = worldToMap(yaw.position.x, yaw.position.z);
    const ppx = pad + (pc.mx + 0.5) * s;
    const ppy = pad + (pc.my + 0.5) * s;
    const tickLen = Math.max(5, s * 1.8);
    ovScanCtx.strokeStyle = "rgba(200,240,255,0.92)";
    ovScanCtx.lineWidth = 1.2;
    ovScanCtx.beginPath();
    ovScanCtx.moveTo(ppx, ppy);
    ovScanCtx.lineTo(ppx - Math.sin(yaw.rotation.y) * tickLen, ppy - Math.cos(yaw.rotation.y) * tickLen);
    ovScanCtx.stroke();
    ovScanCtx.fillStyle = "#d9f3ff";
    ovScanCtx.beginPath();
    ovScanCtx.arc(ppx, ppy, Math.max(2, s * 0.55), 0, Math.PI * 2);
    ovScanCtx.fill();
  }

  function showHitMarker() {
    game.hitMarkerTimer = 0.09;
    hud.hitMarker?.classList.add("active");
  }

  function showDamageFlash(options: any = {}) {
    const duration = options.duration ?? 0.22;
    const opacity = options.opacity ?? 1;
    const danger = options.danger === true;
    const inner = danger ? "rgba(255,25,25,0.16)" : "transparent";
    const outer = danger ? "255,0,0" : "255,60,60";
    const mid = danger ? `rgba(255,0,0,${Math.min(0.42, opacity * 0.48)}) 72%, ` : "";
    player.hurtTimer = duration;
    if (hud.damageVig) {
      // If a directional offset was provided, nudge the radial center
      if (options.dir && Array.isArray(options.dir) && options.dir.length >= 2) {
        const dx = Math.max(-1, Math.min(1, options.dir[0]));
        const dy = Math.max(-1, Math.min(1, options.dir[1]));
        // Convert normalized [-1,1] -> percentage offset (clamp to subtle range)
        const cx = 50 + dx * 30; // percent
        const cy = 50 - dy * 30; // invert Y for CSS coordinates
        hud.damageVig.style.setProperty("background", `radial-gradient(ellipse at ${cx}% ${cy}%, ${inner} 28%, transparent 38%, ${mid}rgba(${outer},${Math.min(0.92, opacity)}) 100%)`, "important");
      } else {
        // reset to default gradient but respect requested opacity via color alpha
        hud.damageVig.style.setProperty("background", `radial-gradient(ellipse at center, ${inner} 28%, transparent 38%, ${mid}rgba(${outer},${Math.min(0.92, opacity)}) 100%)`, "important");
      }
      hud.damageVig.style.setProperty("visibility", "visible", "important");
      hud.damageVig.style.setProperty("opacity", String(opacity), "important");
    }
  }

  function addKillFeed(text) {
    if (!hud.killFeed) return;
    const el = document.createElement("div");
    el.className = "kill-entry";
    el.textContent = "âœ• " + text;
    hud.killFeed.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applyRenderScale();
  }

  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Multiplayer — Phase 1: peer presence (synced remote avatars).
  // All netcode is opt-in; single-player never touches this path.
  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  let net = null;          // active network instance (lazy-loaded)
  let netLib = null;       // cached netcode module
  let myNetId = null;
  let gameMode = "coop";   // "coop" | "pvp" (only meaningful while net.active)
  const pvpScores = new Map(); // peerId -> frags
  const pvpNames = new Map();   // peerId -> display name
  const NET_NAME_MAX = 5;
  const NET_NAME_FALLBACKS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function makeDefaultNetName() {
    let suffix = "";
    for (let i = 0; i < 3; i++) suffix += NET_NAME_FALLBACKS[Math.floor(Math.random() * NET_NAME_FALLBACKS.length)];
    return `P${suffix}`;
  }
  let myName = makeDefaultNetName();
  const remotePlayers = new Map(); // peerId -> avatar
  let lastStateSend = 0;
  // 30 Hz, not 50. Remote avatars interpolate at lerpSpeed 26 (~38ms to target),
  // so 33ms updates are visually identical to 20ms ones but cost 40% less CPU
  // (object alloc + JSON serialize/parse + GC) — the work that competes with
  // rendering on modest laptops. Discrete events (shot/hit) are still instant.
  const STATE_SEND_INTERVAL = 1000 / 30;
  let stateSendCount = 0; // used to throttle rarely-changing fields (name)
  const PVP_MINIMAP_REVEAL_MS = 1250;
  const HOST_SESSION_BROADCAST_INTERVAL = 300;
  let netSequence = 1;
  let enemySnapshotSequence = 1;
  let lastHostSessionBroadcast = 0;
  const peerMessageSeq = new Map();
  const netTmpA = new THREE.Vector3();
  const netTmpB = new THREE.Vector3();

  function nextNetSeq() {
    return netSequence++;
  }

  function acceptPeerSequence(id, msg, channel) {
    if (!Number.isFinite(msg?.seq)) return true;
    const key = `${id}:${channel}`;
    const last = peerMessageSeq.get(key) || 0;
    if (msg.seq <= last) return false;
    peerMessageSeq.set(key, msg.seq);
    return true;
  }

  // Stricter variant: seq is REQUIRED. Used for security-sensitive messages
  // (pdamage, hit) where a missing seq would allow replay attacks.
  function requirePeerSequence(id, msg, channel) {
    if (!Number.isFinite(msg?.seq)) return false;
    return acceptPeerSequence(id, msg, channel);
  }

  function isHostAuthorityMessage(id) {
    return !!(net?.active && id && net.hostId && id === net.hostId);
  }

  function finiteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clampNetPosition(value, fallback = 0) {
    const limit = Math.max(MAP_W, MAP_H) * CELL;
    return clamp(finiteNumber(value, fallback), -limit, limit);
  }

  function clampNetDamage(value, max = 500) {
    return clamp(finiteNumber(value, 0), 0, max);
  }

  // Strip control chars and HTML-like content; enforce short display names for multiplayer.
  function sanitizeName(raw) {
    if (typeof raw !== "string") return "OP";
    return raw.replace(/[^\x20-\x7E]/g, "").replace(/[<>&"'`]/g, "").trim().slice(0, NET_NAME_MAX) || "OP";
  }

  function normalizeNameKey(raw) {
    return sanitizeName(raw).toUpperCase();
  }

  function escapeHtml(raw) {
    return String(raw ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function setMultiplayerStatus(text) {
    const statusEl = document.getElementById("mp-status");
    if (statusEl) statusEl.textContent = text;
  }

  function isNetNameInUse(name, exceptId = null) {
    const key = normalizeNameKey(name);
    if (!key) return false;
    if (myNetId && myNetId !== exceptId && normalizeNameKey(myName) === key) return true;
    for (const [id, existing] of pvpNames) {
      if (id !== exceptId && normalizeNameKey(existing) === key) return true;
    }
    return false;
  }

  function rejectPeerName(id, name) {
    if (!net?.isHost || !id) return;
    try {
      net.sendTo?.(id, {
        t: "nameReject",
        id: myNetId,
        seq: nextNetSeq(),
        sentAt: Math.round(performance.now()),
        name: myName,
        reason: `${sanitizeName(name)} is already taken`,
      });
    } catch (_) { /* ignore */ }
    window.setTimeout(() => net?.kick?.(id), 80);
  }

  // Max peer net IDs we track (host + 7 guests = 8 total).
  const MAX_REMOTE_PLAYERS = 7;

  // Max legitimate position delta per state update accounting for sprint + network jitter.
  // sprint 8.6 u/s * 0.5 s of buffered lag tolerance = 4.3; we use 15 to be conservative.
  const NET_MAX_POSITION_DELTA = 15;

  async function ensureNetLib() {
    if (!netLib) netLib = await import("./modules/netcode.js");
    return netLib;
  }

  function makeNamePlate(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = "bold 32px 'Share Tech Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.strokeText(text, 128, 34);
    ctx.fillStyle = "#7fe0ff";
    ctx.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sprite.scale.set(1.1, 0.28, 1);
    sprite.renderOrder = 95;
    return sprite;
  }

  function createRemoteFlashlightRig(root) {
    // Beam pushed 9 units forward (neg-Z) in root space so it lights what the remote player faces
    const light = new THREE.PointLight(0xe8f4ff, 0, 32, 1.5);
    light.position.set(0.18, PLAYER_H * 0.78, -9);
    light.castShadow = false;
    root.add(light);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.copy(light.position);
    glow.visible = false;
    root.add(glow);

    return { light, glow };
  }

  function updateRemoteFlashlight(avatar) {
    const rig = avatar?.runtime?.flashlightRig;
    if (!rig) return;
    const enabled = !!avatar.runtime.flashlightOn && !avatar.dead;
    rig.light.visible = enabled;
    rig.light.intensity = enabled ? 85 : 0;
    rig.light.distance = 90;
    rig.light.decay = 1.1;
    rig.glow.visible = enabled;
  }

  function createRemotePlayer(id, name) {
    name = sanitizeName(name);
    const root = new THREE.Group();
    root.name = "RemotePlayer:" + id;
    const model = PLAYER_CHARACTER_FBX && skeletonClone ? skeletonClone(PLAYER_CHARACTER_FBX) : createFallbackThirdPersonModel();
    root.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = PLAYER_H / Math.max(0.001, size.y || PLAYER_H);
    model.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const aligned = new THREE.Box3().setFromObject(model);
    const center = aligned.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= aligned.min.y;
    model.position.z -= center.z;
    model.rotation.y = Math.PI;
    model.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = true;
    });

    const runtime: any = createHumanoidEnemyActions(model);
    runtime.model = model;
    runtime.rightHand = findRightHandBone(model);
    runtime.leftHand = findLeftHandBone(model);
    runtime.aimPitch = 0;
    runtime.muzzleTimer = 0;
    runtime.moveState = { f: 0, s: 0, sprinting: false, jumping: false, aiming: false, firing: false, reloading: false, melee: false };
    runtime.netPitch = 0;
    runtime.netCamY = PLAYER_H;
    runtime.netAds = 0;
    runtime.netThirdPerson = false;
    runtime.flashlightOn = false;
    runtime.flashlightRig = createRemoteFlashlightRig(root);
    root.userData.clonedGhost = runtime;

    const weaponRig = createWeaponViewModel(GUNS.RIFLE, root);
    configureThirdPersonWeaponTransform(weaponRig.gun);
    weaponRig.gun.visible = true;
    runtime.weapon = weaponRig;

    const tag = makeNamePlate(name || "PLAYER");
    tag.position.y = PLAYER_H + 0.4;
    root.add(tag);

    // Hit volumes so remote players are shootable in PvP.
    const h = PLAYER_H * 0.98;
    root.userData.hitOffset = new THREE.Vector3(0, h * 0.54, 0);
    root.userData.hitRadius = 0.42;
    root.userData.hitVolumes = [
      { name: "head", a: new THREE.Vector3(0, h * 0.79, 0), b: new THREE.Vector3(0, h * 0.95, 0), radius: 0.16 },
      { name: "torso", a: new THREE.Vector3(0, h * 0.42, 0), b: new THREE.Vector3(0, h * 0.76, 0), radius: 0.26 },
      { name: "pelvis", a: new THREE.Vector3(0, h * 0.3, 0), b: new THREE.Vector3(0, h * 0.44, 0), radius: 0.21 },
      { name: "leftLeg", a: new THREE.Vector3(-0.14, h * 0.31, 0), b: new THREE.Vector3(-0.15, h * 0.06, 0), radius: 0.09 },
      { name: "rightLeg", a: new THREE.Vector3(0.14, h * 0.31, 0), b: new THREE.Vector3(0.15, h * 0.06, 0), radius: 0.09 },
    ];

    scene.add(root);
    setHumanoidEnemyAction({ mesh: root }, "idle", 0);

    const avatar = {
      id,
      name: name || "PLAYER",
      root,
      model,
      runtime,
      weapon: weaponRig,
      tag,
      cur: new THREE.Vector3(yaw.position.x, 0, yaw.position.z),
      target: new THREE.Vector3(yaw.position.x, 0, yaw.position.z),
      curYaw: 0,
      targetYaw: 0,
      gun: GUNS.RIFLE,
      hp: 100,
      dead: false,
      anim: "idle",
      lastStateSeq: 0,
      lastShotSeq: 0,
      minimapRevealUntil: 0,
    };
    remotePlayers.set(id, avatar);
    return avatar;
  }

  function getRemotePlayer(id, name) {
    if (!id || id === myNetId) return null;
    return remotePlayers.get(id) || createRemotePlayer(id, name);
  }

  function removeRemotePlayer(id) {
    const avatar = remotePlayers.get(id);
    if (!avatar) return;
    scene.remove(avatar.root);
    disposeObject3D(avatar.root);
    remotePlayers.delete(id);
    pvpNames.delete(id);
    for (const key of [...peerMessageSeq.keys()]) {
      if (key.startsWith(`${id}:`)) peerMessageSeq.delete(key);
    }
  }

  function clearRemotePlayers() {
    for (const id of [...remotePlayers.keys()]) removeRemotePlayer(id);
    pvpDamageBudgets.clear();
    fxRateWindows.clear();
  }

  function sendLocalState(now, moveState) {
    if (!net?.active || !myNetId) return;
    if (now - lastStateSend < STATE_SEND_INTERVAL) return;
    lastStateSend = now;
    const move = moveState || { f: 0, s: 0, sprinting: false, jumping: false };
    // Name never changes mid-frame — send it only ~once per second instead of
    // in all 30 packets/s. Receivers already treat a missing name as "unchanged".
    const includeName = (stateSendCount++ % 30) === 0;
    net.send({
      t: "state",
      id: myNetId,
      seq: nextNetSeq(),
      sentAt: Math.round(now),
      name: includeName ? myName : undefined,
      x: +yaw.position.x.toFixed(3),
      y: +(player.jumpOffset || 0).toFixed(3),
      camY: +yaw.position.y.toFixed(3),
      z: +yaw.position.z.toFixed(3),
      yaw: +yaw.rotation.y.toFixed(3),
      pitch: +pitch.rotation.x.toFixed(3),
      f: Math.sign(move.f || 0),
      s: Math.sign(move.s || 0),
      sprinting: !!move.sprinting,
      jumping: !!move.jumping,
      aiming: !!mouse.aiming,
      firing: !!(gunState.muzzleTimer > 0 || thirdPerson.fireTimer > 0 || mouse.down),
      reloading: !!(gunState.reloadTimer > 0 || thirdPerson.reloadTimer > 0),
      melee: !!(player.meleeTimer > 0),
      thirdPerson: !!thirdPerson.enabled,
      ads: +viewState.ads.toFixed(3),
      flashlight: !!lightingState.flashlightOn,
      packActive: !!packState.active,
      gun: currentGun,
      hp: Math.round(player.hp),
      dead: !!player.pvpDead,
    });
  }

  function broadcastShot() {
    if (!net?.active || !myNetId) return;
    camera.getWorldPosition(netTmpA);
    getAimCursorDirectionWorld(netTmpB, 0, 0);
    const range = currentGun === GUNS.SNIPER ? 60 : 40;
    net.send({
      t: "shot",
      id: myNetId,
      seq: nextNetSeq(),
      sentAt: Math.round(performance.now()),
      gun: currentGun,
      ox: +netTmpA.x.toFixed(2), oy: +netTmpA.y.toFixed(2), oz: +netTmpA.z.toFixed(2),
      ex: +(netTmpA.x + netTmpB.x * range).toFixed(2),
      ey: +(netTmpA.y + netTmpB.y * range).toFixed(2),
      ez: +(netTmpA.z + netTmpB.z * range).toFixed(2),
    });
  }

  function broadcastVisualFx(fx, payload: any = {}) {
    if (!net?.active || !myNetId) return;
    net.send({
      t: "vfx",
      id: myNetId,
      seq: nextNetSeq(),
      sentAt: Math.round(performance.now()),
      name: myName,
      fx,
      ...payload,
    });
  }

  function broadcastFlashlightFx() {
    broadcastVisualFx("flashlight", { on: !!lightingState.flashlightOn });
  }

  function broadcastBulletHoleFx(pos, normal, gunType = currentGun) {
    if (!pos || !normal) return;
    broadcastVisualFx("bulletHole", {
      gun: gunType,
      x: +pos.x.toFixed(3),
      y: +pos.y.toFixed(3),
      z: +pos.z.toFixed(3),
      nx: +normal.x.toFixed(3),
      ny: +normal.y.toFixed(3),
      nz: +normal.z.toFixed(3),
    });
  }

  function applyVisualFx(msg, sourceId) {
    if (msg.fx === "flashlight") {
      const avatar = getRemotePlayer(sourceId, msg.name);
      if (!avatar) return;
      avatar.runtime.flashlightOn = !!msg.on;
      updateRemoteFlashlight(avatar);
    } else if (msg.fx === "bulletHole") {
      netTmpA.set(clampNetPosition(msg.x), clamp(finiteNumber(msg.y, 0), -1, PLAYER_H + 8), clampNetPosition(msg.z));
      netTmpB.set(clamp(finiteNumber(msg.nx, 0), -1, 1), clamp(finiteNumber(msg.ny, 1), -1, 1), clamp(finiteNumber(msg.nz, 0), -1, 1)).normalize();
      spawnBulletHole(netTmpA, netTmpB, msg.gun || GUNS.RIFLE);
    } else if (msg.fx === "pack") {
      applyCoopPackFx(msg, sourceId);
    } else if (msg.fx === "carAlarm") {
      // Host-triggered car alarm: play the sound + emissive flash locally. The
      // lure only drives locally-simulated enemies, so on guests (host-simulated
      // enemies) it is inert; on the host it is set by the local trigger path.
      const cars = getExtCars();
      if (!cars) return;
      const ax = clampNetPosition(msg.x), az = clampNetPosition(msg.z);
      let best = null, bd = 6;
      for (const car of cars) {
        const d = Math.hypot(car.x - ax, car.z - az);
        if (d < bd) { best = car; bd = d; }
      }
      if (best) startCarAlarmFx(best, { lure: false });
    } else if (msg.fx === "mysteryBox") {
      // Another player bought from the box — play the lid/rise shimmer locally
      // (visual-only: no XP change, no weapon grant on this client).
      const g = msg.gun === "teddy" ? null : (VALID_GUN_NAMES.has(msg.gun) ? msg.gun : GUNS.PISTOL);
      if (!mysteryBoxState.rolling) startMysteryBoxRoll(g || GUNS.PISTOL, msg.gun === "teddy", true);
    }
  }

  function spawnRemoteShotImpact(origin, end, gunType: GunType = GUNS.RIFLE) {
    enemyShotDirTmp.copy(end).sub(origin);
    const dist = enemyShotDirTmp.length();
    if (dist < 0.05) return;
    enemyShotDirTmp.multiplyScalar(1 / dist);
    raycaster.set(origin, enemyShotDirTmp);
    raycaster.far = dist;
    raycastHitsTmp.length = 0;
    raycaster.intersectObjects(wallMeshes, false, raycastHitsTmp);
    raycaster.far = 42;
    const hit = raycastHitsTmp[0] || null;
    if (!hit) return;
    getHitWorldNormal(hit, impactNormalTmp);
    spawnBulletHole(hit.point, impactNormalTmp, gunType);
  }

  function syncMultiplayerModeLabels() {
    const modeBtn = document.getElementById("mp-mode-btn");
    const startBtnMp = document.getElementById("mp-start-btn");
    if (modeBtn) modeBtn.textContent = "Mode: " + (gameMode === "pvp" ? "PvP FFA" : "Co-op");
    if (startBtnMp) startBtnMp.textContent = gameMode === "pvp" ? "Launch PvP FFA" : "Launch Co-op";
  }

  function enterHostLaunchedGame(msg: any = {}) {
    gameMode = msg.mode || gameMode || "coop";
    syncMultiplayerModeLabels();
    if (gameMode === "pvp") forceCinematicOffForPvp();
    const panel = document.getElementById("mp-panel");
    if (panel) panel.classList.remove("active");
    setOverlayMode("main");
    overlay?.classList.add("hidden");
    stateOverlay?.classList.remove("active");
    // Sync wave/score immediately so the HUD shows correct values before the first snapshot arrives.
    if (Number.isFinite(msg.wave) && msg.wave >= 1) game.wave = clamp(Math.round(msg.wave), 1, 999);
    if (Number.isFinite(msg.score) && msg.score >= 0) game.score = clamp(Math.round(msg.score), 0, 9_999_999);

    if (game.state === "transition") return; // already mid-start, let it finish

    if (game.state === "playing") {
      // Guest was already playing (solo session or previous co-op). Clear local enemies and
      // switch to co-op guest mode so the host's snapshots take over immediately.
      player.pvpDead = false;
      player.respawnTimer = 0;
      if (isCoopGuest()) {
        clearAllEnemiesForCoop();
        // Ensure the click-to-play prompt appears if pointer lock was lost.
        syncClickToPlay?.();
      }
      return;
    }

    game.state = "menu";
    beginMission();
  }

  function sendHostSessionState(targetId = null) {
    if (!net?.active || !net.isHost || !myNetId) return;
    const payload = {
      t: "session",
      id: myNetId,
      seq: nextNetSeq(),
      sentAt: Math.round(performance.now()),
      name: myName,
      mode: gameMode,
      active: game.state === "playing" || game.state === "transition",
      wave: game.wave,
      score: game.score,
    };
    if (targetId) net.sendTo?.(targetId, payload);
    else net.send(payload);
  }

  function applyCoopEnemyDamage(msg) {
    if (gameMode !== "coop" || msg.target !== myNetId) return;
    const dmg = Math.max(0, msg.dmg || 0);
    if (dmg <= 0) return;
    damagePlayer(dmg, { staminaDamage: Math.max(0, msg.stamina || 0) });
    cameraFX.damageShake = Math.min(1, cameraFX.damageShake + 0.42);
    player.killStreak = 0;
    updateStreak();
    showDamageFlash({ opacity: 0.72, duration: 0.24, danger: true });
    sfxDamage();
    updateHUD(0);
    if (player.hp <= 0 && !player.unlimitedHealth) endGame("dead");
  }

  function applyCoopReward(msg) {
    if (gameMode !== "coop" || msg.target !== myNetId) return;
    // Cap reward values to prevent a compromised host from granting unlimited resources.
    const xp = clamp(Math.round(finiteNumber(msg.xp, 0)), 0, 500);
    const ammoGain = clamp(Math.round(finiteNumber(msg.ammo, 0)), 0, 60);
    if (xp > 0) addPlayerXp(xp);
    if (ammoGain > 0) {
      for (const gun of Object.values(allGuns)) gun.ammo = Math.min(gun.ammo + ammoGain, 240);
    }
    player.totalKills++;
    player.killStreak++;
    player.streakTimer = 4;
    addKillFeed((msg.enemy || "ENEMY").toUpperCase());
    updateStreak();
    updateHUD(0);
  }

  function applyCoopFx(msg) {
    const fxProxy = msg.enemy != null ? coopProxies.get(msg.enemy) : null;
    if (fxProxy) {
      fxProxy.attackPulse = Math.max(fxProxy.attackPulse || 0, 0.82);
      fxProxy.isAttacking = true;
      fxProxy.lungeBoost = Math.max(fxProxy.lungeBoost || 0, 0.22);
      const ghost = fxProxy.mesh?.userData?.clonedGhost;
      if (ghost && msg.fx === "tracer") ghost.muzzleTimer = Math.max(ghost.muzzleTimer || 0, 0.08);
      const tankMuzzle = fxProxy.mesh?.userData?.tankMuzzle;
      const tankFlash = fxProxy.mesh?.userData?.tankFlash;
      if (msg.fx === "tracer" && tankMuzzle) tankMuzzle.intensity = 22;
      if (msg.fx === "tracer" && tankFlash) {
        tankFlash.visible = true;
        tankFlash.material.opacity = 1;
        tankFlash.scale.setScalar(1.35);
      }
    }
    if (msg.fx === "lightning") {
      netTmpA.set(msg.sx || 0, msg.sy || 0, msg.sz || 0);
      netTmpB.set(msg.ex || 0, msg.ey || 0, msg.ez || 0);
      spawnLightningEffect(netTmpA, netTmpB, msg.power || 0.8, {
        segments: msg.segments || 8,
        branches: msg.branches || 1,
        sourceBranches: msg.sourceBranches || 1,
        jitter: msg.jitter || 0.14,
        lift: msg.lift || 0.04,
        life: msg.life || 0.05,
        rings: !!msg.rings,
        electric: msg.electric !== false,
        maxActive: LIGHTNING_MAX_VISIBLE_EFFECTS,
      });
      lightingState.lightningFlash = Math.max(lightingState.lightningFlash, 0.08);
    } else if (msg.fx === "tracer") {
      netTmpA.set(msg.ox || 0, msg.oy || 0, msg.oz || 0);
      netTmpB.set(msg.ex || 0, msg.ey || 0, msg.ez || 0);
      spawnBulletTracer(netTmpA, netTmpB, msg.gun || GUNS.RIFLE);
      spawnRemoteShotImpact(netTmpA, netTmpB, msg.gun || GUNS.RIFLE);
      const tracer = tracers[tracers.length - 1];
      if (tracer && msg.life) {
        tracer.life = msg.life;
        tracer.maxLife = msg.life;
      }
      if (tracer && msg.thick) {
        tracer.line.scale.x *= msg.thick;
        tracer.line.scale.z *= msg.thick;
      }
    }
  }

  function applyCoopPackFx(msg, sourceId) {
    const gun = msg.gun || GUNS.RIFLE;
    const level = Math.max(1, Math.round(msg.level || 1));
    spawnPackUpgradeEffect(gun, level, { sourceId, remote: true });
    const name = GUN_SPECS[gun]?.name || "WEAPON";
    addKillFeed(`${name.toUpperCase()} PACKED MK${level}`);
  }

  // Allowlist of valid message types keeps unknown payloads from being processed.
  const VALID_MSG_TYPES = new Set([
    "state", "shot", "hello", "bye", "nameReject", "session", "vfx",
    "enemies", "hit", "edamage", "reward", "fx", "packfx",
    "pdamage", "frag", "config", "start", "hazard", "kill",
  ]);

  // Build a whitelist of valid gun identifiers from the GUNS enum so that
  // network messages cannot inject arbitrary strings into avatar.gun.
  const VALID_GUN_NAMES = new Set(Object.values(GUNS));
  // Module-scope handle to setupMultiplayerUI's internal refreshMultiplayerUi —
  // handleNetData needs to call it but lives outside that closure.
  let refreshMultiplayerUiRef = () => {};
  // PvP anti-cheat: rolling per-attacker damage budget (see the pdamage handler).
  const PVP_DAMAGE_BUDGET_PER_SEC = 420;
  const pvpDamageBudgets = new Map();
  // Per-peer cosmetic-FX rate limit: vfx/packfx are visual-only, so a flooding peer
  // just gets its extra effects dropped — nothing gameplay-relevant is lost.
  const fxRateWindows = new Map();
  function acceptFxRate(id, kind, maxPerSec) {
    const key = `${id}:${kind}`;
    const now = performance.now();
    let win = fxRateWindows.get(key);
    if (!win || now - win.t > 1000) { win = { t: now, n: 0 }; fxRateWindows.set(key, win); }
    if (win.n >= maxPerSec) return false;
    win.n++;
    return true;
  }

  // Message types that carry a player display-name for registration purposes.
  // Only these types participate in name-conflict checking; authority messages
  // (start, session, config, enemies, kill, etc.) must never be silently dropped
  // just because they include a name field.
  const NAME_CHECK_TYPES = new Set(["hello", "state"]);

  function handleNetData(msg, fromId) {
    if (!msg || typeof msg !== "object") return;
    if (typeof msg.t !== "string" || !VALID_MSG_TYPES.has(msg.t)) return;
    // The sender id comes from the network layer (fromId) — never trust msg.id alone.
    const id = fromId;
    if (!id || id === myNetId) return;
    const safeName = sanitizeName(msg.name);
    // Only check name conflicts for peer-registration messages, never for host
    // authority messages like "start", "session", "enemies", etc.
    if (NAME_CHECK_TYPES.has(msg.t) && msg.name && isNetNameInUse(safeName, id)) {
      if (net?.isHost) rejectPeerName(id, safeName);
      return;
    }
    if (msg.name) pvpNames.set(id, safeName);
    if (msg.t === "state") {
      const avatar = getRemotePlayer(id, safeName);
      if (!avatar) return;
      if (Number.isFinite(msg.seq) && msg.seq <= (avatar.lastStateSeq || 0)) return;
      if (Number.isFinite(msg.seq)) avatar.lastStateSeq = msg.seq;
      if (msg.name) avatar.name = safeName;

      // Anti-teleport: reject position jumps that exceed the physical max.
      const nx = clampNetPosition(msg.x, avatar.target.x);
      const nz = clampNetPosition(msg.z, avatar.target.z);
      const dx = nx - avatar.target.x, dz = nz - avatar.target.z;
      if (Math.sqrt(dx * dx + dz * dz) > NET_MAX_POSITION_DELTA) return;

      // y is the jump offset — never below ground, capped at a real jump apex.
      avatar.target.set(nx, clamp(finiteNumber(msg.y, 0), 0, 3), nz);
      avatar.targetYaw = clamp(finiteNumber(msg.yaw, avatar.targetYaw), -Math.PI * 2, Math.PI * 2);
      avatar.runtime.moveState.f = clamp(finiteNumber(msg.f, 0), -1, 1);
      avatar.runtime.moveState.s = clamp(finiteNumber(msg.s, 0), -1, 1);
      avatar.runtime.moveState.sprinting = !!msg.sprinting;
      avatar.runtime.moveState.jumping = !!msg.jumping;
      avatar.runtime.moveState.aiming = !!msg.aiming;
      avatar.runtime.moveState.firing = !!msg.firing;
      avatar.runtime.moveState.reloading = !!msg.reloading;
      avatar.runtime.moveState.melee = !!msg.melee;
      avatar.runtime.netPitch = clamp(finiteNumber(msg.pitch, 0), -Math.PI * 0.5, Math.PI * 0.5);
      avatar.runtime.netCamY = clamp(finiteNumber(msg.camY, PLAYER_H + finiteNumber(msg.y, 0)), 0.2, PLAYER_H + 3);
      avatar.runtime.netAds = clamp01(finiteNumber(msg.ads, 0));
      avatar.runtime.netThirdPerson = !!msg.thirdPerson;
      avatar.runtime.flashlightOn = !!msg.flashlight;
      avatar.runtime.packActive = !!msg.packActive;
      avatar.gun = VALID_GUN_NAMES.has(msg.gun) ? msg.gun : GUNS.RIFLE;
      // HP is display-only on remote avatars; cap at true player max.
      avatar.hp = clamp(finiteNumber(msg.hp, avatar.hp), 0, 100);
      avatar.dead = !!msg.dead;
      if (gameMode === "pvp" && (msg.firing || msg.melee)) {
        avatar.minimapRevealUntil = performance.now() + PVP_MINIMAP_REVEAL_MS;
      }
    } else if (msg.t === "shot") {
      const avatar = getRemotePlayer(id, safeName);
      if (!avatar) return;
      if (Number.isFinite(msg.seq) && msg.seq <= (avatar.lastShotSeq || 0)) return;
      if (Number.isFinite(msg.seq)) avatar.lastShotSeq = msg.seq;
      avatar.minimapRevealUntil = performance.now() + PVP_MINIMAP_REVEAL_MS;
      avatar.runtime.muzzleTimer = 0.08;
      netTmpA.set(clampNetPosition(msg.ox), clamp(finiteNumber(msg.oy, PLAYER_H), -2, PLAYER_H + 6), clampNetPosition(msg.oz));
      netTmpB.set(clampNetPosition(msg.ex), clamp(finiteNumber(msg.ey, PLAYER_H), -2, PLAYER_H + 6), clampNetPosition(msg.ez));
      spawnBulletTracer(netTmpA, netTmpB, msg.gun || GUNS.RIFLE);
      spawnRemoteShotImpact(netTmpA, netTmpB, msg.gun || GUNS.RIFLE);
    } else if (msg.t === "hello") {
      // Refuse to register more remote players than the enforced cap.
      if (remotePlayers.size < MAX_REMOTE_PLAYERS) getRemotePlayer(id, safeName);
      // Immediately unblock the LAUNCH button — don't wait for the 1s interval.
      // NOTE: refreshMultiplayerUi is scoped inside setupMultiplayerUI, so this
      // must go through the module-level handle (a bare identifier here threw a
      // ReferenceError on the FIRST hello message and killed the handshake).
      refreshMultiplayerUiRef();
      if (net?.isHost) {
        const sentAt = Math.round(performance.now());
        net.sendTo?.(id, { t: "config", id: myNetId, seq: nextNetSeq(), sentAt, mode: gameMode, name: myName });
        if (game.state !== "menu") {
          net.sendTo?.(id, { t: "start", id: myNetId, seq: nextNetSeq(), sentAt, mode: gameMode, wave: game.wave, score: game.score, name: myName });
          sendHostSessionState(id);
          // Force the next enemy broadcast to fire immediately so the new guest
          // sees all enemies within one frame instead of waiting up to 50ms.
          lastEnemyBroadcast = 0;
        }
      }
    } else if (msg.t === "bye") {
      removeRemotePlayer(id);
    } else if (msg.t === "nameReject") {
      if (!isHostAuthorityMessage(id)) return;
      setMultiplayerStatus(`Name rejected: ${String(msg.reason || "already taken").slice(0, 80)}`);
      try { net?.close(); } catch (_) { /* ignore */ }
      net = null;
      myNetId = null;
      clearRemotePlayers();
      clearAllEnemiesForCoop();
      peerMessageSeq.clear();
      lastEnemySnapshotSeq = 0; lastEnemySnapshotTime = 0;
      pvpNames.clear();
      syncCinematicControlLock();
      document.getElementById("mp-name-input")?.removeAttribute("disabled");
      document.getElementById("mp-room-badge")?.classList.add("hidden");
      const codeWrap = document.getElementById("mp-code-wrap");
      const codeDisplay = document.getElementById("mp-code-display");
      if (codeWrap) codeWrap.style.display = "none";
      if (codeDisplay) codeDisplay.textContent = "";
      document.getElementById("mp-panel")?.classList.add("active");
    } else if (msg.t === "enemies") {
      if (!isHostAuthorityMessage(id)) return;
      applyEnemySnapshot(msg);
    } else if (msg.t === "hit") {
      // Host authority: apply a guest's damage to the real enemy.
      if (!isCoopHost()) return;
      // seq is REQUIRED for hit — missing seq is a replay attempt, reject it.
      if (!requirePeerSequence(id, msg, "hit")) return;
      if (!Number.isFinite(msg.i)) return;
      const hitDamage = clampNetDamage(msg.dmg, 400);
      if (hitDamage <= 0) return;
      const target = enemies.find(en => en.alive && en.netId === msg.i);
      if (!target) return;
      target.hp -= hitDamage;
      target.aggroed = true;
      target.attackPulse = Math.max(target.attackPulse || 0, 0.35);
      applyEnemyHitFeedback(target, hitDamage, !!msg.hs, 0, 0);
      if (target.hp <= 0) {
        target.killHeadshot = !!msg.hs;
        killEnemy(target, id);
      }
      // Force an immediate enemy broadcast so guests see HP/death within <1 frame
      // instead of waiting up to 50ms for the next scheduled broadcast tick.
      lastEnemyBroadcast = 0;
    } else if (msg.t === "edamage") {
      if (!isHostAuthorityMessage(id)) return;
      applyCoopEnemyDamage(msg);
    } else if (msg.t === "reward") {
      if (!isHostAuthorityMessage(id)) return;
      applyCoopReward(msg);
    } else if (msg.t === "fx") {
      if (!isHostAuthorityMessage(id)) return;
      applyCoopFx(msg);
    } else if (msg.t === "vfx") {
      if (!acceptPeerSequence(id, msg, "vfx")) return;
      if (!acceptFxRate(id, "vfx", 30)) return; // cosmetic-only: drop floods silently
      applyVisualFx(msg, id);
    } else if (msg.t === "packfx") {
      // Sequence check to prevent flooding pack-upgrade effects.
      if (!acceptPeerSequence(id, msg, "packfx")) return;
      if (!acceptFxRate(id, "packfx", 4)) return;
      applyCoopPackFx(msg, id);
    } else if (msg.t === "pdamage") {
      // seq is REQUIRED for pdamage — missing seq is a replay attempt, reject it.
      if (!requirePeerSequence(id, msg, "pdamage")) return;
      // Anti-cheat budget: cap how much damage any single attacker can land on us
      // per rolling second. Legit fire rates sit well under this; a client spamming
      // forged max-damage packets gets throttled to survivable numbers instead of
      // instant-killing. (P2P has no referee — the victim is the authority on its
      // own HP, so the victim enforces the budget.)
      if (msg.target === myNetId) {
        const now = performance.now();
        let budget = pvpDamageBudgets.get(id);
        if (!budget || now - budget.t > 1000) { budget = { t: now, sum: 0 }; pvpDamageBudgets.set(id, budget); }
        const dmg = Math.min(clampNetDamage(msg.dmg, 250), Math.max(0, PVP_DAMAGE_BUDGET_PER_SEC - budget.sum));
        budget.sum += dmg;
        if (dmg > 0) applyPvpDamage(dmg, id, msg.hs);
      }
    } else if (msg.t === "frag") {
      if (!acceptPeerSequence(id, msg, "frag")) return;
      // Killer must be the sender; victim must be a known participant.
      const validKiller = msg.killer === id;
      const validVictim = msg.victim === myNetId || remotePlayers.has(msg.victim);
      if (!validKiller || !validVictim) return;
      registerFrag(msg.killer, msg.victim);
    } else if (msg.t === "config") {
      if (!isHostAuthorityMessage(id)) return;
      if (!acceptPeerSequence(id, msg, "control")) return;
      gameMode = msg.mode || "coop";
      syncMultiplayerModeLabels();
      syncCinematicControlLock();
    } else if (msg.t === "start") {
      if (!isHostAuthorityMessage(id)) return;
      if (!acceptPeerSequence(id, msg, "start")) return;
      enterHostLaunchedGame(msg);
      return;
      // Host launched — close lobby and start the game on the guest's side too.
    } else if (msg.t === "session") {
      if (!isHostAuthorityMessage(id)) return;
      if (!acceptPeerSequence(id, msg, "session")) return;
      gameMode = msg.mode || gameMode || "coop";
      syncMultiplayerModeLabels();
      syncCinematicControlLock();
      if (msg.active) enterHostLaunchedGame(msg);
    } else if (msg.t === "hazard") {
      if (!isHostAuthorityMessage(id)) return;
      if (!acceptPeerSequence(id, msg, "hazard")) return;
      hazardActiveIndex = msg.i;
      hazardState = msg.state || "idle";
    } else if (msg.t === "kill") {
      if (!isHostAuthorityMessage(id)) return;
      if (!acceptPeerSequence(id, msg, "kill")) return;
      // The killing peer already got their own kill entry via `reward`; skip the duplicate.
      if (msg.killer === myNetId) return;
      const typeName = (typeof msg.typeName === "string" ? msg.typeName : "ENEMY").slice(0, 32);
      addKillFeed(typeName.toUpperCase());
      const tags = Array.isArray(msg.tags)
        ? msg.tags.filter(t => typeof t === "string" && t.length <= 20).slice(0, 4)
        : [];
      const pts = clamp(Math.round(finiteNumber(msg.pts, 0)), 0, 5000);
      addKillFeed(tags.length ? `+${pts} ${tags.join(" ")}` : `+${pts}`);
      sfxKill();
      // Mirror the kill count so the objective counter stays in sync without waiting for snapshot.
      game.killed = Math.min(game.totalEnemies || game.killed + 1, game.killed + 1);
      updateObjective();
    }
  }

  function updateRemotePlayers(dt) {
    if (!net?.active || remotePlayers.size === 0) return;
    const lerpSpeed = 26;
    const lerp = Math.min(1, dt * lerpSpeed);
    for (const avatar of remotePlayers.values()) {
      const prevX = avatar.cur.x;
      const prevZ = avatar.cur.z;
      avatar.cur.lerp(avatar.target, lerp);
      avatar.runtime.vx = dt > 0 ? (avatar.cur.x - prevX) / dt : 0;
      avatar.runtime.vz = dt > 0 ? (avatar.cur.z - prevZ) / dt : 0;
      let dy = avatar.targetYaw - avatar.curYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      avatar.curYaw += dy * lerp;
      avatar.root.position.set(avatar.cur.x, avatar.cur.y, avatar.cur.z);
      avatar.root.rotation.y = avatar.curYaw;

      const move = avatar.runtime.moveState;
      if (move.firing || move.melee) avatar.runtime.muzzleTimer = Math.max(avatar.runtime.muzzleTimer || 0, 0.05);
      const moving = Math.abs(move.f) > 0.05 || Math.abs(move.s) > 0.05;
      const actions = avatar.runtime.actions || {};
      let desired = "idle";
      if (avatar.dead && actions.death) desired = "death";
      else if (move.reloading && actions.reload) desired = "reload";
      else if (move.jumping) {
        if (move.f > 0.1 && actions.jumpForward) desired = "jumpForward";
        else if (move.f < -0.1 && actions.jumpBack) desired = "jumpBack";
        else if (actions.jumpRifle && move.aiming) desired = "jumpRifle";
        else desired = actions.jumpNeutral ? "jumpNeutral" : "jump";
      } else if (move.sprinting && moving) {
        desired = pickSprintLocomotionAction(actions, move.f, move.s);
      } else if ((move.firing || move.melee || (avatar.runtime.muzzleTimer || 0) > 0.02) && actions.fire) {
        desired = "fire";
      } else if (moving) {
        if (Math.abs(move.s) > Math.abs(move.f) * 1.2) desired = move.s < -0.1 && actions.strafeAlt ? "strafeAlt" : "strafe";
        else desired = move.f < -0.1 ? (actions.walkBack ? "walkBack" : "walk") : "walk";
      }
      if (avatar.anim !== desired) {
        setHumanoidEnemyAction({ mesh: avatar.root }, desired, desired === "fire" ? 0.05 : 0.14);
        avatar.anim = desired;
      }
      if (avatar.runtime.activeAction) {
        avatar.runtime.activeAction.timeScale = desired === "death"
          ? 1.0
          : desired === "fire"
          ? 1.35
          : desired === "reload"
            ? 1.0
            : moving
              ? 1.05
              : 1.0;
      }
      avatar.runtime.mixer?.update(dt);
      avatar.runtime.netAimPitch = avatar.runtime.netPitch;
      const remotePoseDist = Math.max(1, Math.abs(avatar.runtime.netCamY - avatar.root.position.y) + 8);
      updateClonedGhostWeaponPose({ mesh: avatar.root, ranged: { range: 24 }, visualLean: 0 }, dt, remotePoseDist, true);
      updateRemoteFlashlight(avatar);
    }
  }

  function setupMultiplayerUI() {
    const panel = document.getElementById("mp-panel");
    if (!panel) return;
    const hostBtn = document.getElementById("mp-host-btn");
    const joinToggle = document.getElementById("mp-join-toggle");
    const joinRow = document.getElementById("mp-join-row");
    const nameInput = document.getElementById("mp-name-input");
    const codeInput = document.getElementById("mp-code-input");
    const joinBtn = document.getElementById("mp-join-btn");
    const codeWrap = document.getElementById("mp-code-wrap");
    const codeDisplay = document.getElementById("mp-code-display");
    const roomBadge = document.getElementById("mp-room-badge");
    const roomBadgeCode = document.getElementById("mp-room-code");
    const statusEl = document.getElementById("mp-status");
    const rosterEl = document.getElementById("mp-roster");
    const startBtnMp = document.getElementById("mp-start-btn");
    const leaveBtn = document.getElementById("mp-leave-btn");
    const closeBtn = document.getElementById("mp-close-btn");
    const mpBtn = document.getElementById("multiplayerBtn");
    const modeBtn = document.getElementById("mp-mode-btn");

    if (nameInput) nameInput.value = myName;
    const setStatus = text => { if (statusEl) statusEl.textContent = text; };
    const applyNameInput = () => {
      const nextName = sanitizeName(nameInput?.value || myName);
      if (!nextName) {
        setStatus("Enter a display name first.");
        return false;
      }
      myName = nextName;
      if (nameInput) nameInput.value = myName;
      return true;
    };
    if (nameInput) {
      nameInput.addEventListener("input", () => {
        const clean = sanitizeName(nameInput.value);
        if (nameInput.value !== clean) nameInput.value = clean;
        if (clean) myName = clean;
      });
    }
    if (codeWrap) codeWrap.onclick = () => {
      const code = codeDisplay?.textContent.trim();
      if (code) navigator.clipboard?.writeText(code).then(() => setStatus("Code " + code + " copied to clipboard!")).catch(() => {});
    };
    function refreshModeLabels() {
      syncMultiplayerModeLabels();
    }
    function refreshRoomBadge() {
      const showCode = !!(net?.active && net.isHost && net.roomCode);
      roomBadge?.classList.toggle("hidden", !showCode);
      if (roomBadgeCode) roomBadgeCode.textContent = showCode ? net.roomCode : "";
    }
    function refreshRoster() {
      if (rosterEl) rosterEl.innerHTML = net?.active
        ? `<span class="mp-dot">●</span> ${1 + (net.peerCount || 0)} operator(s) connected`
        : "";
      if (startBtnMp) startBtnMp.classList.toggle("hidden", !net?.isHost);
      if (leaveBtn) leaveBtn.classList.toggle("hidden", !net?.active);
    }

    function refreshMultiplayerUi() {
      if (rosterEl) {
        if (net?.active) {
          const rows = [
            `<div class="mp-roster-row"><span><span class="mp-dot">â—</span> ${escapeHtml(myName)}</span><span class="mp-roster-role">${net.isHost ? "HOST" : "YOU"}</span></div>`,
          ];
          for (const [id, name] of pvpNames) {
            if (id === myNetId) continue;
            rows.push(`<div class="mp-roster-row"><span>${escapeHtml(name)}</span><span class="mp-roster-role">${id === net.hostId ? "HOST" : "PEER"}</span></div>`);
          }
          rosterEl.innerHTML = rows.join("");
        } else {
          rosterEl.innerHTML = "";
        }
      }
      if (nameInput) nameInput.disabled = !!net?.active;
      if (startBtnMp) {
        const canShow = !!net?.isHost;
        const hasPeer = remotePlayers.size > 0;
        startBtnMp.classList.toggle("hidden", !canShow);
        startBtnMp.disabled = canShow && !hasPeer;
        startBtnMp.title = !canShow ? "" : hasPeer ? "Launch game" : "At least one peer must connect first";
      }
      if (leaveBtn) leaveBtn.classList.toggle("hidden", !net?.active);
      refreshRoomBadge();
    }
    refreshMultiplayerUiRef = refreshMultiplayerUi; // expose to handleNetData (module scope)

    if (mpBtn) mpBtn.onclick = () => {
      refreshModeLabels();
      refreshMultiplayerUi();
      setMenuPanel("multiplayer");
      panel.classList.add("active");
    };
    if (closeBtn) closeBtn.onclick = () => {
      panel.classList.remove("active");
      const activePanel = document.querySelector("[data-menu-panel].active")?.dataset.menuPanel || "briefing";
      setMenuPanel(activePanel);
    };
    if (modeBtn) modeBtn.onclick = () => {
      gameMode = gameMode === "pvp" ? "coop" : "pvp";
      refreshModeLabels();
      syncCinematicControlLock();
      if (net?.active && net.isHost) net.send({ t: "config", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), mode: gameMode });
    };

    async function wireNet() {
      const lib = await ensureNetLib();
      // Tear down any leftover network that failed without triggering fatal.
      if (net) { try { net.close(); } catch (_) { /* ignore */ } net = null; myNetId = null; }
      net = lib.createNetwork();
      myNetId = null;
      net.on("ready", (code, isHost) => {
        myNetId = net.selfId;
        pvpNames.set(myNetId, myName);
        if (isHost) {
          if (codeWrap) codeWrap.style.display = "flex";
          if (codeDisplay) codeDisplay.textContent = code;
          setStatus("Share the code above — friends click Join and enter it.");
        } else {
          setStatus("Connecting to " + code + "…");
        }
        refreshMultiplayerUi();
      });
      net.on("peerjoin", () => {
        const sentAt = Math.round(performance.now());
        net.send({ t: "hello", id: myNetId, seq: nextNetSeq(), sentAt, name: myName, gun: currentGun });
        setStatus("Operator connected.");
        refreshMultiplayerUi();
      });
      net.on("peerleave", id => { removeRemotePlayer(id); setStatus("An operator disconnected."); refreshMultiplayerUi(); });
      net.on("data", (msg, fromId) => handleNetData(msg, fromId));
      net.on("error", err => setStatus("Network: " + (err?.message || err?.type || err)));
      net.on("reconnecting", ({ attempt, delayMs }) => {
        setStatus(`Signal server disconnected — reconnecting (attempt ${attempt}, ${Math.round(delayMs / 1000)}s)…`);
      });
      net.on("reconnected", () => {
        setStatus("Reconnected to signal server.");
      });
      // ── Host migration (fully P2P) ──────────────────────────────────────────
      net.on("migrating", () => {
        setStatus("Host left — migrating session to a new host…");
        // Freeze the host-down watchdog while migration is in progress.
        lastEnemySnapshotTime = 0;
        addKillFeed?.("HOST LOST — MIGRATING…");
      });
      net.on("becamehost", () => {
        // This peer is now the authoritative host. Take over enemy simulation.
        myNetId = net.selfId;
        if (gameMode === "coop" && game.state === "playing") {
          promoteCoopProxiesToAuthoritative();
        }
        lastEnemySnapshotTime = 0; // we are the source now; no inbound snapshots expected
        refreshRoomBadge?.();
        refreshMultiplayerUi();
        setStatus("You are now the host. Session continues.");
        addKillFeed?.("YOU ARE NOW THE HOST");
      });
      net.on("hostmigrated", () => {
        // A follower successfully reconnected to the new host.
        myNetId = net.selfId;
        lastEnemySnapshotTime = performance.now(); // restart watchdog fresh
        lastEnemySnapshotSeq = 0; // accept the new host's snapshot stream from scratch
        setStatus("Reconnected — new host active.");
        refreshMultiplayerUi();
      });
      net.on("icefailed", info => {
        // P2P (ICE) could not form even though signalling worked. Surface the
        // real cause (NAT/TURN) so it isn't mistaken for a dead server.
        setStatus("Network: " + (info?.message || "Direct connection blocked by NAT — a TURN relay is needed."));
      });
      net.on("fatal", err => {
        // The peer is already destroyed inside netcode — reset local state so
        // the host/join buttons become usable again without a page reload.
        net = null;
        myNetId = null;
        clearRemotePlayers();
        clearAllEnemiesForCoop();
        peerMessageSeq.clear();
        lastEnemySnapshotSeq = 0; lastEnemySnapshotTime = 0;
        pvpNames.clear();
        syncCinematicControlLock?.();
        if (nameInput) nameInput.disabled = false;
        if (codeWrap) codeWrap.style.display = "none";
        if (codeDisplay) codeDisplay.textContent = "";
        refreshRoomBadge?.();
        setStatus("Connection lost: " + (err?.message || err?.type || "unknown error"));
        refreshMultiplayerUi();
      });
      return lib;
    }

    if (hostBtn) hostBtn.onclick = async () => {
      if (net?.active) return;
      if (!applyNameInput()) return;
      pvpNames.clear();
      clearRemotePlayers();
      clearAllEnemiesForCoop();
      peerMessageSeq.clear();
      lastEnemySnapshotSeq = 0; lastEnemySnapshotTime = 0;
      setStatus("Starting host…");
      try {
        const lib = await wireNet();
        net.host(lib.makeRoomCode());
      } catch (err) {
        setStatus("Failed to load networking: " + err.message);
      }
    };
    if (joinToggle) joinToggle.onclick = () => {
      if (joinRow) joinRow.classList.toggle("hidden");
      codeInput?.focus();
    };
    if (joinBtn) joinBtn.onclick = async () => {
      if (!applyNameInput()) return;
      const code = (codeInput?.value || "").trim().toUpperCase();
      if (code.length < 4) { setStatus("Enter the 6-character code."); return; }
      pvpNames.clear();
      clearRemotePlayers();
      clearAllEnemiesForCoop();
      peerMessageSeq.clear();
      lastEnemySnapshotSeq = 0; lastEnemySnapshotTime = 0;
      setStatus("Joining " + code + "…");
      try {
        await wireNet();
        net.join(code);
      } catch (err) {
        setStatus("Failed to load networking: " + err.message);
      }
    };
    if (leaveBtn) leaveBtn.onclick = () => {
      try { net?.send({ t: "bye", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()) }); } catch (_) { /* ignore */ }
      net?.close();
      net = null;
      myNetId = null;
      clearRemotePlayers();
      clearAllEnemiesForCoop();
      peerMessageSeq.clear();
      lastEnemySnapshotSeq = 0; lastEnemySnapshotTime = 0;
      pvpNames.clear();
      syncCinematicControlLock();
      if (nameInput) nameInput.disabled = false;
      if (codeWrap) codeWrap.style.display = "none";
      if (codeDisplay) codeDisplay.textContent = "";
      refreshRoomBadge();
      setStatus("Disconnected.");
      refreshMultiplayerUi();
    };
    if (startBtnMp) startBtnMp.onclick = () => {
      if (!net?.active || !net.isHost) return;
      if (remotePlayers.size < 1) {
        setStatus("At least one peer must connect before launch.");
        refreshMultiplayerUi();
        return;
      }
      if (gameMode === "pvp") forceCinematicOffForPvp();
      net.send({ t: "start", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), mode: gameMode, wave: game.wave, score: game.score, name: myName });
      panel.classList.remove("active");
      setOverlayMode("main");
      beginMission();
      window.setTimeout(() => sendHostSessionState(), 250);
      window.setTimeout(() => sendHostSessionState(), 900);
    };

    setInterval(refreshMultiplayerUi, 1000);
  }
  setupMultiplayerUI();

  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Multiplayer — Phase 2: co-op (host-authoritative shared enemies).
  // The host runs the real enemy simulation and broadcasts snapshots;
  // guests render lightweight proxies and route their damage to the host.
  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  let nextEnemyNetId = 1;
  const coopProxies = new Map(); // netId -> proxy enemy
  const coopMinimapEnemies = [];
  let lastEnemyBroadcast = 0;
  let lastEnemySnapshotSeq = 0;
  let lastEnemySnapshotTime = 0; // wall-clock ms; used for host-down detection
  // If no enemy snapshot arrives for this long while co-op guest is playing,
  // assume the host crashed and surface a clear error instead of hanging silently.
  const HOST_DOWN_TIMEOUT_MS = 8000;
  // 30 Hz. Proxies interpolate at lerpSpeed 26, so this looks identical to 50 Hz
  // but the host serializes the full enemy list 40% less often — a big win since
  // this is the heaviest recurring message. Hits/deaths still force an immediate
  // broadcast (lastEnemyBroadcast = 0), so combat feedback stays instant.
  const ENEMY_BROADCAST_INTERVAL = 1000 / 30;
  let pendingSpeedBonus = 0; // set by nextWave, included once in the next enemies broadcast

  const isCoopGuest = () => !!(net?.active && gameMode === "coop" && !net.isHost);
  const isCoopHost = () => !!(net?.active && gameMode === "coop" && net.isHost);

  function clearAllEnemiesForCoop() {
    // Remove proxies first via removeCoopProxy which handles scene.remove + disposeObject3D + map cleanup.
    for (const id of [...coopProxies.keys()]) removeCoopProxy(id);
    // Dispose any remaining non-proxy enemies (solo enemies on the host side).
    for (const enemy of enemies.splice(0, enemies.length)) {
      unregisterEnemy(enemy);
      disposeEnemy(enemy);
    }
    coopMinimapEnemies.length = 0;
  }

  function broadcastEnemies(now) {
    if (!isCoopHost() || !myNetId) return;
    if (now - lastEnemyBroadcast < ENEMY_BROADCAST_INTERVAL) return;
    lastEnemyBroadcast = now;
    const list = [];
    for (const e of liveEnemies) {
      ensureCoopEnemyNetId(e);
      const ty = ENEMY_TYPE_INDEX.get(e.typeName) ?? 0;
      list.push({
        i: e.netId, ty,
        x: +e.mesh.position.x.toFixed(2), y: +e.mesh.position.y.toFixed(2), z: +e.mesh.position.z.toFixed(2),
        r: +(e.mesh.rotation.y).toFixed(2),
        hp: Math.max(0, Math.round(e.hp)), mhp: e.maxHp,
        ag: !!e.aggroed,
        ap: +(e.attackPulse || 0).toFixed(2),
        ia: !!e.isAttacking,
        lb: +(e.lungeBoost || 0).toFixed(2),
        vl: +(e.verticalLift || 0).toFixed(2),
        mb: e.netMegaBlast || null,
      });
    }
    const sb = pendingSpeedBonus;
    pendingSpeedBonus = 0;
    net.send({ t: "enemies", id: myNetId, seq: enemySnapshotSequence++, sentAt: Math.round(now), wave: game.wave, killed: game.killed, total: game.totalEnemies, score: game.score, speedBonus: sb || undefined, list });
  }

  function removeCoopProxy(id) {
    const proxy = coopProxies.get(id);
    if (!proxy) return;
    setEnemyAlive(proxy, false);
    const idx = enemies.indexOf(proxy);
    if (idx >= 0) { enemies.splice(idx, 1); unregisterEnemy(proxy); }
    scene.remove(proxy.mesh);
    if (proxy.hpBar) scene.remove(proxy.hpBar.mesh);
    disposeEnemy(proxy);
    coopProxies.delete(id);
  }

  function applyEnemySnapshot(msg) {
    if (!isCoopGuest() || game.state !== "playing") return;
    if (!Array.isArray(msg.list)) return;
    // DoS guard: a legitimate host never has anywhere near this many live enemies;
    // reject oversized snapshots outright rather than allocating proxies for them.
    if (msg.list.length > 64) return;
    if (!Number.isFinite(msg.seq) || msg.seq <= lastEnemySnapshotSeq) return;
    lastEnemySnapshotSeq = msg.seq;
    lastEnemySnapshotTime = performance.now();
    const prevWave = game.wave;
    game.wave = Math.max(1, Math.round(finiteNumber(msg.wave, game.wave)));
    game.killed = Math.max(0, Math.round(finiteNumber(msg.killed, game.killed)));
    game.totalEnemies = Math.max(game.killed, Math.round(finiteNumber(msg.total, game.totalEnemies)));
    if (typeof msg.score === "number") game.score = clamp(Math.round(msg.score), 0, 9_999_999);
    // Show wave transition feedback when the host advances to a new wave.
    if (game.wave > prevWave) {
      const sb = clamp(Math.round(finiteNumber(msg.speedBonus, 0)), 0, 2000);
      if (sb > 0) addKillFeed(`+${sb} FAST CLEAR`);
      addKillFeed(`WAVE ${game.wave} INCOMING`);
      applyWaveLighting(game.wave, true);
      const waveAmmoBonus = 24 + Math.min(26, game.wave * 2);
      for (const gun of Object.values(allGuns)) gun.ammo = Math.min(gun.ammo + waveAmmoBonus, 240);
      player.hp = Math.min(100, player.maxHp);
      placePlayerForWave(game.wave);
      updateHUD(0);
      // Guest-side blackout cutscene: fires locally when the host's snapshot
      // advances us onto a blackout wave (proxies land this same snapshot, so
      // the enemy pan — which samples positions at phase B entry — sees them).
      if (game.wave % 10 === 0) startBlackoutCutscene();
    }
    updateScoreHud();
    updateObjective();

    const seen = new Set();
    coopMinimapEnemies.length = 0;
    for (const s of msg.list) {
      const enemyId = Math.round(finiteNumber(s.i, -1));
      if (enemyId < 0) continue;
      const sx = clampNetPosition(s.x);
      const sy = clamp(finiteNumber(s.y, 0), -2, 6);
      const sz = clampNetPosition(s.z);
      seen.add(enemyId);
      coopMinimapEnemies.push({ x: sx, z: sz, aggroed: !!s.ag, alive: true });
      let proxy = coopProxies.get(enemyId);
      if (!proxy) {
        const type = ENEMY_TYPES[s.ty] || ENEMY_TYPES[0];
        proxy = createEnemy(type, { x: sx, z: sz }, msg.wave || 1, 1);
        proxy.netId = enemyId;
        proxy.isProxy = true;
        proxy.targetPos = new THREE.Vector3(sx, sy, sz);
        proxy.targetYaw = clamp(finiteNumber(s.r, 0), -Math.PI * 2, Math.PI * 2);
        coopProxies.set(enemyId, proxy);
        enemies.push(proxy); registerEnemy(proxy);
        scene.add(proxy.mesh);
        if (proxy.hpBar) scene.add(proxy.hpBar.mesh);
      }
      proxy.targetPos.set(sx, sy, sz);
      proxy.targetYaw = clamp(finiteNumber(s.r, proxy.targetYaw || 0), -Math.PI * 2, Math.PI * 2);
      // If we killed this proxy optimistically but the host snapshot says it's still alive,
      // restore it — the host hasn't confirmed the kill yet.
      if (proxy._optimisticDead) {
        proxy._optimisticDead = false;
        setEnemyAlive(proxy, true);
        proxy.mesh.visible = true;
        if (proxy.hpBar?.mesh) proxy.hpBar.mesh.visible = true;
      }
      proxy.hp = clampNetDamage(s.hp, 5000);
      proxy.maxHp = clampNetDamage(s.mhp || proxy.maxHp, 5000) || proxy.maxHp;
      proxy.aggroed = !!s.ag;
      proxy.attackPulse = Math.max(proxy.attackPulse || 0, s.ap || 0);
      proxy.isAttacking = !!s.ia;
      proxy.lungeBoost = Math.max(proxy.lungeBoost || 0, s.lb || 0);
      proxy.verticalLift = s.vl || 0;
      proxy.netMegaBlast = s.mb || null;
      setEnemyAlive(proxy, true);
      proxy.removed = false;
      proxy.deathQueued = false;
      proxy.mesh.visible = true;
      if (proxy.hpBar?.mesh) proxy.hpBar.mesh.visible = true;
    }
    for (const id of [...coopProxies.keys()]) {
      if (!seen.has(id)) removeCoopProxy(id);
    }
  }

  // Host migration: this peer was a guest and just became the authoritative host.
  // Promote the interpolated snapshot proxies into fully AI-driven enemies so the
  // simulation continues seamlessly — HP, position, type and aggro all carry over.
  function promoteCoopProxiesToAuthoritative() {
    let maxNetId = 0;
    for (const proxy of coopProxies.values()) {
      proxy.isProxy = false;
      proxy.targetPos = null;          // stop snapshot interpolation; AI owns position now
      proxy.netMegaBlast = null;
      proxy._netMegaVisible = false;
      // Re-seed AI timers so updateEnemies takes over cleanly without a burst of attacks.
      proxy.attackCooldown      = Math.random() * (proxy.attackRate || 1.5);
      proxy.navPath             = [];
      proxy.navTimer            = 0;
      proxy.navGoal             = null;
      proxy.strafeTimer         = 0.4 + Math.random() * 0.8;
      proxy.lightningStreamTimer = proxy.lightning ? 0.4 + Math.random() * 0.3 : 0;
      proxy.lightningWindUp     = 0;
      proxy.meleeWindUp         = -1;
      proxy.rangedCooldown      = proxy.ranged ? 1.0 + Math.random() * 1.5 : 0;
      proxy.lastRepathX         = proxy.mesh.position.x;
      proxy.lastRepathZ         = proxy.mesh.position.z;
      proxy.lastMoveX           = proxy.mesh.position.x;
      proxy.lastMoveZ           = proxy.mesh.position.z;
      proxy.stuckTimer          = 0;
      if (Number.isFinite(proxy.netId)) maxNetId = Math.max(maxNetId, proxy.netId);
    }
    // Enemies array already holds the proxies; just clear the proxy registry.
    coopProxies.clear();
    coopMinimapEnemies.length = 0;
    // Future spawns must use ids above everything inherited from the old host.
    nextEnemyNetId = Math.max(nextEnemyNetId, maxNetId + 1);
    // Reset broadcast timing so the new host pushes a snapshot immediately.
    lastEnemyBroadcast = 0;
    enemySnapshotSequence = Math.max(enemySnapshotSequence, lastEnemySnapshotSeq + 1);
  }

  function updateCoopProxies(dt) {
    const lerpSpeed = 26;
    const lerp = Math.min(1, dt * lerpSpeed);
    for (const proxy of coopProxies.values()) {
      if (!proxy.targetPos) continue;
      const prevX = proxy.mesh.position.x;
      const prevZ = proxy.mesh.position.z;
      proxy.mesh.position.lerp(proxy.targetPos, lerp);
      proxy.mesh.rotation.y = proxy.targetYaw || 0;
      proxy.attackPulse = Math.max(0, (proxy.attackPulse || 0) - dt * 2.35);
      proxy.lungeBoost = Math.max(0, (proxy.lungeBoost || 0) - dt * 2.7);
      if (proxy.isAttacking && proxy.attackPulse <= 0) proxy.isAttacking = false;

      if (proxy.netMegaBlast) {
        netTmpA.set(proxy.netMegaBlast.ox, proxy.netMegaBlast.oy, proxy.netMegaBlast.oz);
        netTmpB.set(proxy.netMegaBlast.ex, proxy.netMegaBlast.ey, proxy.netMegaBlast.ez);
        setMegaBlastVisual(proxy, netTmpA, netTmpB, proxy.netMegaBlast.p || 0.7, performance.now() * 0.001);
        proxy._netMegaVisible = true;
      } else if (proxy._netMegaVisible) {
        hideMegaBlast(proxy);
        proxy._netMegaVisible = false;
      }

      const tankMuzzle = proxy.mesh.userData.tankMuzzle;
      const tankFlash = proxy.mesh.userData.tankFlash;
      if (tankMuzzle) tankMuzzle.intensity = Math.max(0, tankMuzzle.intensity - dt * 42);
      if (tankFlash) {
        tankFlash.material.opacity = Math.max(0, tankFlash.material.opacity - dt * 9.5);
        tankFlash.scale.setScalar(1 + tankFlash.material.opacity * 0.75);
        tankFlash.rotation.z += dt * 7;
        tankFlash.visible = tankFlash.material.opacity > 0.02;
      }

      proxy.mesh.userData.mixer?.update?.(dt);
      const ghost = proxy.mesh.userData.clonedGhost;
      if (ghost?.mixer) {
        const movedX = proxy.mesh.position.x - prevX;
        const movedZ = proxy.mesh.position.z - prevZ;
        const moving = Math.hypot(movedX, movedZ) > 0.003;
        const desired = (ghost.muzzleTimer || 0) > 0.02 ? "fire" : moving ? "walk" : "idle";
        if (ghost.activeActionName !== desired) setHumanoidEnemyAction(proxy, desired, desired === "fire" ? 0.05 : 0.14);
        ghost.mixer.update(dt);
        updateClonedGhostWeaponPose(proxy, dt, 24, false);
      }
    }
  }

  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Multiplayer — Phase 3: PvP combat.
  // Each client detects its own hits on remote avatars and sends authoritative
  // damage to the victim, who owns its own health/death/respawn.
  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  function pvpSpawnPoint() {
    const spots = getSpawnPositions(1, 10);
    return spots[0] || { x: 0, z: 0 };
  }

  function respawnLocalPlayer() {
    const spot = pvpSpawnPoint();
    yaw.position.set(spot.x, PLAYER_H, spot.z);
    player.hp = player.maxHp;
    player.pvpDead = false;
    player.respawnTimer = 0;
    player.jumpOffset = 0;
    player.jumpVel = 0;
    player.grounded = true;
    mouse.down = false;
    mouse.aiming = false;
    viewState.ads = 0;
    if (player.preDeathThirdPerson != null) {
      setThirdPersonEnabled(!!player.preDeathThirdPerson, false);
      player.preDeathThirdPerson = null;
    }
    if (thirdPerson.ready) {
      thirdPerson.fireTimer = 0;
      thirdPerson.reloadTimer = 0;
      setThirdPersonAction("idle", 0.08);
    }
    lastStateSend = 0;
    updateObjective();
    updateHUD(0);
    addKillFeed("RESPAWNED");
  }

  function tryPvpHit() {
    if (gameMode !== "pvp" || !net?.active || remotePlayers.size === 0) return;
    camera.getWorldPosition(cameraWorldTmp);
    getAimCursorDirectionWorld(enemyShotDirTmp, 0, 0);
    raycaster.set(cameraWorldTmp, enemyShotDirTmp);
    raycaster.far = 70;
    const floorMesh = scene.userData.environmentSurfaces?.floor || null;
    const surfaceHit = getShotSurfaceHit(floorMesh);
    const wallDist = surfaceHit ? surfaceHit.distance : Infinity;
    let best = null;
    let bestDist = Infinity;
    let bestPart = null;
    for (const a of remotePlayers.values()) {
      if (a.dead || a.hp <= 0) continue;
      const d = getEnemyShotDistance({ mesh: a.root }, raycaster.ray.origin, raycaster.ray.direction, 70, currentGun, shotHitInfoTmp);
      if (d < bestDist) { bestDist = d; best = a; bestPart = shotHitInfoTmp.part; }
    }
    if (best && bestDist <= 70 && bestDist < wallDist) {
      const hs = bestPart === "head";
      let dmg = gunState.damage;
      if (currentGun === GUNS.SHOTGUN) dmg *= 0.68; // approximate pellet connect at range (tighter spread, more pellets land)
      if (hs) dmg *= 2;
      net.send({ t: "pdamage", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), target: best.id, dmg: Math.round(dmg), hs });
      showHitMarker();
      sfxHit();
    }
  }

  function applyPvpDamage(dmg, fromId, hs) {
    if (gameMode !== "pvp" || player.pvpDead || player.unlimitedHealth) return;
    player.hp -= dmg;
    player.hurtTimer = Math.max(player.hurtTimer, 0.5);
    sfxDamage();
    if (player.hp <= 0) {
      beginNetworkedPlayerDeath(PVP_RESPAWN_SECONDS, "YOU WERE FRAGGED");
      net.send({ t: "frag", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), killer: fromId, victim: myNetId });
      registerFrag(fromId, myNetId);
    }
  }

  function registerFrag(killerId, victimId) {
    if (killerId && killerId !== victimId) {
      pvpScores.set(killerId, (pvpScores.get(killerId) || 0) + 1);
    }
    updatePvpScoreboard();
  }

  const pvpHudEl = document.getElementById("pvp-hud");
  const pvpRowsEl = document.getElementById("pvp-rows");
  const pvpRespawnEl = document.getElementById("pvp-respawn");

  function updatePvpScoreboard() {
    if (gameMode !== "pvp" || !net?.active) return;

    // Collect all participants: self + remote players
    const entries = [];
    const myFrags = pvpScores.get(myNetId) || 0;
    entries.push({ id: myNetId, name: myName, frags: myFrags, me: true, dead: player.pvpDead });
    for (const [pid, a] of remotePlayers) {
      entries.push({ id: pid, name: a.name || "OP", frags: pvpScores.get(pid) || 0, me: false, dead: !!a.dead || a.hp <= 0 });
    }
    entries.sort((a, b) => b.frags - a.frags);
    const leaderFrags = entries[0]?.frags ?? 0;

    if (pvpRowsEl) {
      pvpRowsEl.innerHTML = entries.map(e => {
        const isLeader = e.frags === leaderFrags && leaderFrags > 0;
        const cls = ["pvp-row", e.me ? "me" : "", isLeader ? "leader" : "", e.dead ? "dead" : ""].filter(Boolean).join(" ");
        const badge = e.me ? (e.dead ? "âœ—" : "â–º") : "Â·";
        const safeName = sanitizeName(e.name).slice(0, 10);
        return `<div class="${cls}"><span>${badge} ${safeName}</span><span class="pvp-frag-count">${e.frags}</span></div>`;
      }).join("");
    }

    if (pvpRespawnEl) {
      if (player.pvpDead && player.respawnTimer > 0) {
        pvpRespawnEl.textContent = `RESPAWN IN ${Math.ceil(player.respawnTimer)}s`;
        pvpRespawnEl.classList.add("active");
      } else {
        pvpRespawnEl.classList.remove("active");
      }
    }

    if (hud.objective) hud.objective.textContent = `PVP FFA - ${myFrags} frag${myFrags !== 1 ? "s" : ""}`;
  }

  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  // Multiplayer — Phase 4: dynamic PvP map hazards.
  // Telegraphed "ion surge" zones light up the map; standing in a live zone
  // burns health. The host drives the cycle and broadcasts state to all peers.
  // â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  let hazardZones = null;
  let hazardActiveIndex = -1;
  let hazardState = "idle"; // "idle" | "warn" | "active"
  let hazardTimer = 0;

  function ensureHazardZones() {
    if (hazardZones) return hazardZones;
    hazardZones = [];
    const spots = getSpawnPositions(4, 14);
    for (const spot of spots) {
      const radius = 3.2;
      const group = new THREE.Group();
      group.position.set(spot.x, 0, spot.z);
      group.visible = false;
      const discMat = new THREE.MeshBasicMaterial({ color: 0x2266aa, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.06;
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x2266aa, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.12, 8, 48), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.1;
      const light = new THREE.PointLight(0x3388ff, 0, 14, 2);
      light.position.y = 2.4;
      group.add(disc, ring, light);
      scene.add(group);
      hazardZones.push({ pos: { x: spot.x, z: spot.z }, radius, group, disc, ring, light, intensity: 0 });
    }
    return hazardZones;
  }

  function resetHazards() {
    hazardActiveIndex = -1;
    hazardState = "idle";
    hazardTimer = 3;
    if (hazardZones) for (const z of hazardZones) z.intensity = 0;
  }

  function updateHazardsHost(dt) {
    if (!hazardZones || hazardZones.length === 0) return;
    hazardTimer -= dt;
    if (hazardTimer > 0) return;
    if (hazardState === "warn") {
      hazardState = "active";
      hazardTimer = 3.5;
    } else {
      // idle or active -> telegraph a fresh zone
      hazardActiveIndex = Math.floor(Math.random() * hazardZones.length);
      hazardState = "warn";
      hazardTimer = 2.2;
    }
    net.send({ t: "hazard", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), i: hazardActiveIndex, state: hazardState });
  }

  function applyHazardDamage(dt) {
    if (gameMode !== "pvp" || hazardState !== "active" || hazardActiveIndex < 0 || !hazardZones) return;
    const z = hazardZones[hazardActiveIndex];
    if (!z) return;
    const dx = yaw.position.x - z.pos.x;
    const dz = yaw.position.z - z.pos.z;
    if (dx * dx + dz * dz <= z.radius * z.radius) {
      applyPvpDamage(30 * dt, null, false); // ~30 dps inside a live surge
    }
  }

  function updateHazardVisuals(dt, now) {
    if (!hazardZones) return;
    const pvp = gameMode === "pvp" && game.state === "playing";
    const pulse = 0.7 + Math.sin(now * 0.012) * 0.3;
    for (let i = 0; i < hazardZones.length; i++) {
      const z = hazardZones[i];
      z.group.visible = pvp;
      if (!pvp) { z.light.intensity = 0; continue; }
      const isActive = i === hazardActiveIndex && hazardState === "active";
      const isWarn = i === hazardActiveIndex && hazardState === "warn";
      const target = isActive ? 1 : isWarn ? 0.5 : 0.12;
      z.intensity += (target - z.intensity) * Math.min(1, dt * 6);
      const col = isActive ? 0xff3322 : isWarn ? 0xffbb33 : 0x2266aa;
      z.disc.material.color.setHex(col);
      z.disc.material.opacity = 0.06 + z.intensity * 0.5 * pulse;
      z.ring.material.color.setHex(col);
      z.ring.material.opacity = 0.18 + z.intensity * 0.6 * pulse;
      z.light.color.setHex(col);
      z.light.intensity = z.intensity * 3.2 * pulse;
    }
  }

  // Debug: break down where draw calls come from. Run __rbDraws() in the console
  // at a laggy moment. Lists the object-name groups responsible for the most draws.
  window.__droneInspect = function () {
    const e = enemies.find(en => en?.mesh);
    if (!e) { console.log("no enemy with mesh"); return; }
    const wp = new THREE.Vector3();
    e.mesh.getWorldPosition(wp);
    console.log(`enemy root world: (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)})  mesh.visible=${e.mesh.visible}`);
    let skinned = 0;
    e.mesh.traverse(o => {
      if (o.isSkinnedMesh) {
        skinned++;
        const mp = new THREE.Vector3(); o.getWorldPosition(mp);
        const b0 = o.skeleton?.bones?.[0];
        const bp = new THREE.Vector3(); if (b0) b0.getWorldPosition(bp);
        console.log(`  skinned "${o.name}" visible=${o.visible} matVisible=${o.material?.visible} bones=${o.skeleton?.bones?.length} meshWorld=(${mp.x.toFixed(1)},${mp.y.toFixed(1)},${mp.z.toFixed(1)}) bone0World=(${bp.x.toFixed(1)},${bp.y.toFixed(1)},${bp.z.toFixed(1)}) skeletonRootUnderMesh=${b0 ? isAncestor(e.mesh, b0) : "?"}`);
      }
    });
    if (!skinned) console.log("  (no SkinnedMesh found under enemy)");
    function isAncestor(root, node) { for (let p = node; p; p = p.parent) if (p === root) return true; return false; }
  };

  window.__rbDraws = function () {
    const groups = new Map();
    let total = 0;
    scene.traverse(o => {
      if (!o.visible) return;
      let draws = 0;
      if (o.isInstancedMesh) draws = 1;
      else if (o.isMesh) draws = Array.isArray(o.material) ? o.material.length : 1;
      else if (o.isSprite || o.isPoints || o.isLine || o.isLineSegments) draws = 1;
      if (!draws) return;
      total += draws;
      const key = (o.name || o.type).replace(/[0-9]+/g, "#").slice(0, 32) +
        (o.isInstancedMesh ? ` [inst×${o.count}]` : "");
      groups.set(key, (groups.get(key) || 0) + draws);
    });
    const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    console.log(`~${total} draws (renderer reports ${renderer.info?.render?.calls}). Top groups:`);
    for (const [k, v] of rows) console.log(String(v).padStart(6), k);
    return total;
  };

  // Reload-staging diagnostic — verify the gun-in-left-hand + clip-in-right-hand
  // reload reads cleanly (timing + world positions of hands/gun/clip).
  window.__rbReload = function () {
    const w = thirdPerson.weapon;
    const clip = thirdPerson.reloadClip;
    const dur = GUN_SPECS[currentGun]?.reloadTime || 1;
    const reloadT = thirdPerson.reloadTimer > 0 ? +(1 - thirdPerson.reloadTimer / dur).toFixed(2) : 0;
    const wp = new THREE.Vector3();
    const at = (o) => { if (!o) return null; o.getWorldPosition(wp); return { x: +wp.x.toFixed(2), y: +wp.y.toFixed(2), z: +wp.z.toFixed(2) }; };
    return {
      reloading: thirdPerson.reloadTimer > 0,
      reloadT,
      clipExists: !!clip,
      clipVisible: !!(clip && clip.visible),
      magVisible: !!(w && w.mag && w.mag.visible),
      clipPos: clip && clip.visible ? at(clip) : null,
      rightHand: at(thirdPerson.rightHand),
      leftHand: at(thirdPerson.leftHand),
      rightUpperArm: at(thirdPerson.aimBones?.rightUpperArm),
      leftUpperArm: at(thirdPerson.aimBones?.leftUpperArm),
      gunPos: at(w && w.gun),
      gun: currentGun,
    };
  };

  // View-mode diagnostic — confirms the game is third-person only (FP removed).
  window.__rbView = function () {
    return {
      thirdPersonOnly: THIRD_PERSON_ONLY,
      thirdPersonEnabled: thirdPerson.enabled,
      fpAdsView: shouldUseFirstPersonAdsView(),
      unifiedFpBody: unifiedFirstPersonBodyActive(),
      aiming: !!mouse.aiming,
    };
  };

  // Per-fragment lighting cost diagnostic. In WebGL forward rendering every real
  // light is evaluated for every lit fragment, so light COUNT is a top FPS factor.
  //
  // This mirrors three's own projectObject walk: a light is skipped if IT or ANY
  // ANCESTOR is invisible. That distinction matters — three bakes this count into
  // every shader, so if it changes at runtime the whole scene relinks (~400ms per
  // program). A plain scene.traverse() over-reports and hides exactly that bug.
  // If this number is not constant while playing, you have a stall.
  window.__rbCountLights = function (detail) {
    const counts: any = { PointLight: 0, SpotLight: 0, DirectionalLight: 0, HemisphereLight: 0, AmbientLight: 0, RectAreaLight: 0, other: 0, total: 0 };
    const owners = new Map();
    const walk = (o) => {
      if (o.visible === false) return; // an invisible parent hides its lights from three
      if (o.isLight) {
        counts.total++;
        const t = o.type in counts ? o.type : "other";
        counts[t]++;
        if (o.isPointLight) {
          let owner = o.name || "";
          for (let p = o.parent; p && !owner; p = p.parent) owner = p.name;
          owner = (owner || "unnamed").replace(/[0-9]+/g, "#");
          owners.set(owner, (owners.get(owner) || 0) + 1);
        }
      }
      for (const child of o.children) walk(child);
    };
    walk(scene);
    counts.pointOwners = Object.fromEntries([...owners.entries()].sort((a, b) => b[1] - a[1]));
    console.log("[perf] scene lights (as three counts them):", JSON.stringify(counts));
    return counts;
  };

  function animate(now) {
    // Skip rendering while the WebGL context is lost (handler will resume us).
    if (canvas.parentElement && document.getElementById("rb-context-lost-msg")) {
      requestAnimationFrame(animate);
      return;
    }

    const _jsStart = performance.now();
    try {
      game.frame++;
      const rawDt = (now - game.lastTime) / 1000;
      const dt = Math.min(rawDt, 0.025); // cap at 40fps equivalent — prevents catch-up spikes after GC/tab-switch
      game.lastTime = now;
      recoverFromFrameHitch(rawDt);
      // Process slightly more pending deaths during wave-clear frames to avoid long tail cleanup
      flushPendingEnemyDeaths(game.killed >= game.totalEnemies ? 4 : 1);
      gunState.fireCooldown = Math.max(0, gunState.fireCooldown - dt);
      updateAdaptiveQuality(dt);
      updateCrosshair(dt);
      updateBulletHoles(dt);
      updateLightningEffects(dt);
      updateTelegraphRings(dt);
      updatePackUpgradeEffects(dt);

      if (game.state === "playing") {
        if (mouse.down && gunState.fireCooldown <= 0 && !cutscene.active) fireGun();
        const moveState = updateMovement(dt);
        updateThirdPersonCharacter(dt, moveState);
        if (net?.active) sendLocalState(now, moveState);
        if (net?.active && gameMode === "pvp") {
          updatePvpScoreboard();
        } else if (isCoopGuest()) {
          updateCoopProxies(dt);
          // Host-down detection: if co-op snapshots stop arriving, surface an error.
          // Suppressed while a P2P host migration is in flight — the netcode layer
          // is electing a successor and will emit "fatal" only if that fails.
          if (!net.isMigrating && lastEnemySnapshotTime > 0 && now - lastEnemySnapshotTime > HOST_DOWN_TIMEOUT_MS) {
            lastEnemySnapshotTime = 0; // prevent repeated triggers
            try { net?.close(); } catch (_) { /* ignore */ }
            net = null;
            myNetId = null;
            clearRemotePlayers();
            clearAllEnemiesForCoop();
            peerMessageSeq.clear();
            lastEnemySnapshotSeq = 0; lastEnemySnapshotTime = 0;
            pvpNames.clear();
            syncCinematicControlLock?.();
            // quitToMenu sets game.state = "menu" so the animate loop doesn't
            // keep running game-playing logic with an empty world.
            quitToMenu();
            // Re-show the overlay and MP panel so the player knows what happened.
            overlay?.classList.remove("hidden");
            document.getElementById("mp-panel")?.classList.add("active");
            document.getElementById("mp-name-input")?.removeAttribute("disabled");
            document.getElementById("mp-code-wrap")?.style.setProperty("display", "none");
            const _lcd = document.getElementById("mp-code-display");
            if (_lcd) _lcd.textContent = "";
            document.getElementById("mp-room-badge")?.classList.add("hidden");
            setMultiplayerStatus("Host stopped responding — session ended. You can host or join a new game.");
          }
        } else {
          updateEnemies(dt);
          if (isCoopHost()) {
            broadcastEnemies(now);
            if (now - lastHostSessionBroadcast > HOST_SESSION_BROADCAST_INTERVAL) {
              lastHostSessionBroadcast = now;
              sendHostSessionState();
            }
          }
        }
        updateHazardVisuals(dt, now);
        updateDroneAudio(dt);
        updateParticles(dt);
        updateDamageNumbers(dt);
        updatePackStation(dt);
        updatePerkMachine(dt);
        updateMysteryBox(dt);
        updateKnifeVisual();
        updateCarAlarms(dt);
        // Allow larger removal budgets when wave is clearing; internal function also respects a small time budget
        processEnemyRemovals(game.killed >= game.totalEnemies ? 4 : 1);
        updateTracers(dt);
        updateWeapon(dt);
        updateCameraFX(dt);
        updateHUD(dt);
        if (game.frame % 3 === 0) renderMinimap(now);
      } else {
        updateTracers(dt);
        updateDamageNumbers(dt);
        updateThirdPersonCharacter(dt, thirdPerson.lastMove);
        updateCameraFX(dt);
        renderer.toneMappingExposure += (getBaseExposure() - renderer.toneMappingExposure) * Math.min(1, dt * 8);
        if (ovScanCanvas && !overlay?.classList.contains("hidden") && game.frame % 4 === 0) {
          renderOverlayScan();
        }
      }

      // Blackout cutscene camera: runs AFTER updateCameraFX so it can sample the
      // live gameplay pose (its phase-C landing target) before overwriting it.
      updateCutsceneCamera(dt);

      if (exteriorCityRoot) exteriorCityRoot.visible = true;

      if (net?.active) updateRemotePlayers(dt);

      // WebGPU's renderer.info does not reliably auto-reset per frame in r166, so
      // calls/triangles accumulate and read as wildly inflated. Reset right before
      // the frame's render so the perf overlay shows true single-frame counts.
      if (rendererBackend === "webgpu" && renderer.info && typeof renderer.info.reset === "function") {
        renderer.info.reset();
      }
      const _preRender = performance.now();
      renderScene();
      // CPU-side timing: total JS work (update + render-command issue) this frame.
      // If jsMs is small but the frame is long, the frame is GPU-bound; if jsMs is
      // large, it's CPU/draw-issue bound. Read via __rbTest.getFrameStats().
      const _end = performance.now();
      quality.jsUpdateMs += ((_preRender - _jsStart) - quality.jsUpdateMs) * 0.1;
      quality.jsFrameMs += ((_end - _jsStart) - quality.jsFrameMs) * 0.1;
      updateLoadoutPreviews(now);
      if (perfOverlay.visible) perfOverlay.update(now, rawDt * 1000);
      if (mobileDiag && (game.frame % 30 === 0)) {
        const ri = renderer.info?.render;
        mobileDiag.textContent =
          `gfx:${rendererBackend} scale:${quality.scale.toFixed(2)} fps:${Math.round(1 / Math.max(0.001, rawDt))}\n` +
          `draws:${ri?.calls ?? "?"} tris:${ri?.triangles ?? "?"} enemies:${enemies.length}` +
          (mobileDiagErr ? `\nERR: ${mobileDiagErr}` : "");
      }
    } catch (err) {
      // A frame exception must not silently kill the loop. Log it and keep going.
      console.error("[animate] Frame exception (frame " + game.frame + "):", err);
      mobileDiagErr = (err && (err.message || err.toString())) || "unknown";
      if (mobileDiag) mobileDiag.textContent = `gfx:${rendererBackend} state:${game.state}\nERR: ${mobileDiagErr}`;
    }

    requestAnimationFrame(animate);
  }
  // Mobile-only render diagnostic (surfaces backend + any frame error on screen).
  const mobileDiag = isTouchDevice ? document.getElementById("mobile-diag") : null;
  let mobileDiagErr = "";
  if (mobileDiag) mobileDiag.style.display = "block";

  async function restartGame() {
    if (game.transitioning) return;
    game.transitioning = true;
    game.state = "transition";
    syncGameplayBodyClass();
    game.waveSpawning = false;
    try {
      for (const p of particles) {
        recycleImpactParticle(p);
      }
      particles.length = 0;

      for (const t of tracers) {
        recycleTracer(t);
      }
      tracers.length = 0;
      for (const dn of damageNumbers) recycleDamageNumber(dn);
      damageNumbers.length = 0;
      for (const effect of lightningEffects) recycleLightningEffect(effect);
      lightningEffects.length = 0;
      pendingEnemyDeaths.length = 0;
      enemyRemovalQueue.length = 0;

      resetPlayer();
      await spawnEnemies(1, { smooth: true, minDistance: 8, preferVisible: true });
      ensureAllLiveEnemiesVisible();
      game.state = "playing";
      syncGameplayBodyClass();
      updateHUD(0);
      renderMinimap(performance.now());
    } catch (err) {
      console.error("Restart transition failed:", err);
      game.state = "playing";
      syncGameplayBodyClass();
    } finally {
      game.transitioning = false;
    }
  }

  // Read-only test harness hook. Inert unless the page is loaded with ?test=1,
  // so it can never affect normal gameplay.
  if (typeof window !== "undefined" && window.location?.search?.includes("test=1")) {
    window.__rbTest = {
      // Debug: live-tune the unified first-person rig (camera eye + arm pose + gun fit).
      // Pass any subset of keys; returns the resulting values. Prod never calls this.
      setFpTune: (t: any = {}) => {
        if (t.eyeForward   !== undefined) UNIFIED_FP_EYE_FORWARD   = t.eyeForward;
        if (t.eyeUp        !== undefined) UNIFIED_FP_EYE_UP        = t.eyeUp;
        if (t.armRaiseBias !== undefined) UNIFIED_FP_ARM_RAISE_BIAS= t.armRaiseBias;
        if (t.upperArmPitch!== undefined) UNIFIED_FP_UPPER_ARM_PITCH= t.upperArmPitch;
        if (t.forearmPitch !== undefined) UNIFIED_FP_FOREARM_PITCH = t.forearmPitch;
        if (t.spinePitch   !== undefined) UNIFIED_FP_SPINE_PITCH   = t.spinePitch;
        if (t.gunScale     !== undefined) UNIFIED_FP_GUN_SCALE     = t.gunScale;
        if (t.gunForward   !== undefined) UNIFIED_FP_GUN_FORWARD   = t.gunForward;
        if (t.gunUp        !== undefined) UNIFIED_FP_GUN_UP        = t.gunUp;
        if (t.gunRight     !== undefined) UNIFIED_FP_GUN_RIGHT     = t.gunRight;
        if (t.gunRotX      !== undefined) UNIFIED_FP_GUN_ROT_X     = t.gunRotX;
        if (t.gunRotY      !== undefined) UNIFIED_FP_GUN_ROT_Y     = t.gunRotY;
        if (t.gunRotZ      !== undefined) UNIFIED_FP_GUN_ROT_Z     = t.gunRotZ;
        if (t.useViewmodel !== undefined) UNIFIED_FP_USE_VIEWMODEL = !!t.useViewmodel;
        if (t.gunCamRel    !== undefined) UNIFIED_FP_GUN_CAMERA_RELATIVE = !!t.gunCamRel;
        if (t.hideBody     !== undefined) UNIFIED_FP_DEBUG_HIDE_BODY = !!t.hideBody;
        if (t.hideArms     !== undefined) UNIFIED_FP_HIDE_ARMS = !!t.hideArms;
        return {
          eyeForward: UNIFIED_FP_EYE_FORWARD, eyeUp: UNIFIED_FP_EYE_UP,
          armRaiseBias: UNIFIED_FP_ARM_RAISE_BIAS, upperArmPitch: UNIFIED_FP_UPPER_ARM_PITCH,
          forearmPitch: UNIFIED_FP_FOREARM_PITCH, spinePitch: UNIFIED_FP_SPINE_PITCH,
          gunScale: UNIFIED_FP_GUN_SCALE, gunForward: UNIFIED_FP_GUN_FORWARD,
          gunUp: UNIFIED_FP_GUN_UP, gunRight: UNIFIED_FP_GUN_RIGHT,
        };
      },
      tpTo: (x = 0, z = 40, yawRad = 0, pitchRad = 0) => {
        yaw.position.x = x;
        yaw.position.z = z;
        yaw.rotation.y = yawRad;
        pitch.rotation.x = pitchRad;
        return { x: yaw.position.x, z: yaw.position.z, yaw: yaw.rotation.y };
      },
      // Test/diagnostic: force the lighting state of a given wave (10 → blackout
      // fire sky + repositioned ember sun, anything else → golden hour).
      setWaveLighting: (w) => { applyWaveLighting(w); return { darkWaveActive, sun: window.__extSun?.position.toArray() }; },
      // Blackout cutscene test hooks: force-start (applies blackout lighting
      // first so phase A frames the fire dome), and inspect live state.
      startBlackoutCutscene: () => {
        applyWaveLighting(10, false);
        return startBlackoutCutscene(true);
      },
      skipCutscene: () => { requestCutsceneSkip(); return cutscene.phase; },
      // Distance between the camera's world position and the expected TP camera
      // world position (resolver local → world via pitch). ~0 after a clean landing.
      getCutsceneLandingDelta: () => {
        const local = resolveThirdPersonCameraPosition(0, 0, 0).clone();
        pitch.updateWorldMatrix(true, false);
        const expected = pitch.localToWorld(local);
        return camera.getWorldPosition(new THREE.Vector3()).distanceTo(expected);
      },
      getCutsceneState: () => ({
        active: cutscene.active,
        phase: cutscene.phase,
        t: cutscene.t,
        letterbox: document.body.classList.contains("rb-cutscene"),
        camPos: camera.getWorldPosition(new THREE.Vector3()).toArray(),
        camFov: camera.fov,
        tpLocalPos: resolveThirdPersonCameraPosition(0, 0, 0).toArray(),
      }),
      getFpState: () => {
        const cw = new THREE.Vector3();
        camera.getWorldPosition(cw);
        return {
          unifiedActive: unifiedFirstPersonBodyActive(),
          tpReady: thirdPerson.ready,
          tpEnabled: thirdPerson.enabled,
          bodyVisible: !!thirdPerson.root?.visible,
          tpGunVisible: !!thirdPerson.weapon?.gun?.visible,
          viewmodelVisible: !!weapon?.gun?.visible,
          camWorld: { x: +cw.x.toFixed(2), y: +cw.y.toFixed(2), z: +cw.z.toFixed(2) },
          camLocal: { x: +camera.position.x.toFixed(3), y: +camera.position.y.toFixed(3), z: +camera.position.z.toFixed(3) },
          flashlightOn: lightingState.flashlightOn,
          state: game.state,
          gun: (() => {
            const g = weapon?.gun;
            if (!g) return null;
            const wp = new THREE.Vector3(); g.getWorldPosition(wp);
            const proj = wp.clone().project(camera);
            let meshes = 0, vis = 0;
            g.traverse(o => { if (o.isMesh) { meshes++; if (o.visible) vis++; } });
            return {
              visible: g.visible,
              scale: +g.scale.x.toFixed(3),
              localPos: { x: +g.position.x.toFixed(2), y: +g.position.y.toFixed(2), z: +g.position.z.toFixed(2) },
              parentIsCamera: g.parent === camera,
              ndc: { x: +proj.x.toFixed(2), y: +proj.y.toFixed(2), z: +proj.z.toFixed(2) },
              meshes, vis,
            };
          })(),
        };
      },
      dumpModel: () => {
        const root = thirdPerson.root;
        if (!root) return null;
        const meshes = [];
        root.updateWorldMatrix(true, true);
        root.traverse(o => {
          if (!o.isMesh) return;
          o.geometry.computeBoundingBox?.();
          const bb = o.geometry.boundingBox;
          meshes.push({
            name: o.name || o.type,
            skinned: !!o.isSkinnedMesh,
            visible: o.visible,
            size: bb ? { x: +(bb.max.x - bb.min.x).toFixed(2), y: +(bb.max.y - bb.min.y).toFixed(2), z: +(bb.max.z - bb.min.z).toFixed(2) } : null,
          });
        });
        return { meshes };
      },
      getScore: () => game.score,
      getBestScore: () => game.bestScore,
      getKills: () => game.killed,
      // Test/diagnostic: grant XP so specs can reach perk/pack purchases without
      // grinding kills. Prod never calls this.
      giveXp: (amount = 1000) => { player.xp += amount; updateHUD(0); return player.xp; },
      getXp: () => player.xp,
      getDebugState: () => ({ xp: player.xp, hp: player.hp, state: game.state, y: yaw.position.y }),
      getEnemyCount: () => enemies.filter(e => e.alive).length,
      getState: () => game.state,
      getFrameStats: () => ({
        frame: game.frame,
        fps: quality.lastFps,
        hitchCount: quality.hitchCount,
        renderScale: quality.scale,
        jsUpdateMs: +quality.jsUpdateMs.toFixed(2),
        jsFrameMs: +quality.jsFrameMs.toFixed(2),
        shadows: !!renderer.shadowMap?.enabled,
      }),
      getPlayerPosition: () => ({
        x: yaw.position.x,
        y: yaw.position.y,
        z: yaw.position.z,
        yaw: yaw.rotation.y,
        pitch: pitch.rotation.x,
      }),
      getAmmo: () => ({
        gun: currentGun,
        mag: gunState.mag,
        reserve: gunState.ammo,
        magSize: gunState.magSize,
        reloadTimer: gunState.reloadTimer,
      }),
      getRuntimeCounts: () => ({
        enemies: enemies.filter(e => e.alive).length,
        totalEnemyArray: enemies.length,
        particles: particles.length,
        tracers: tracers.length,
        damageNumbers: damageNumbers.length,
        lightningEffects: lightningEffects.length,
        pendingEnemyDeaths: pendingEnemyDeaths.length,
        enemyRemovalQueue: enemyRemovalQueue.length,
      }),
      getNearestEnemy: () => {
        let best = null;
        let bestDist = Infinity;
        for (const enemy of liveEnemies) {
          const d = Math.hypot(enemy.mesh.position.x - yaw.position.x, enemy.mesh.position.z - yaw.position.z);
          if (d < bestDist) {
            bestDist = d;
            best = {
              type: enemy.typeName,
              hp: enemy.hp,
              maxHp: enemy.maxHp,
              x: enemy.mesh.position.x,
              y: enemy.mesh.position.y,
              z: enemy.mesh.position.z,
              dist: d,
              visible: !!enemy.mesh.visible,
              hpBarVisible: !!enemy.hpBar?.mesh?.visible,
            };
          }
        }
        return best;
      },
      getEnemyDebug: () => enemies.filter(enemy => enemy.alive).map(enemy => ({
        type: enemy.typeName,
        hp: enemy.hp,
        x: enemy.mesh.position.x,
        y: enemy.mesh.position.y,
        z: enemy.mesh.position.z,
        dist: Math.hypot(enemy.mesh.position.x - yaw.position.x, enemy.mesh.position.z - yaw.position.z),
        visible: !!enemy.mesh.visible,
        childMeshes: (() => {
          let total = 0;
          let visible = 0;
          const samples = [];
          enemy.mesh.traverse(obj => {
            if (!obj.isMesh) return;
            total++;
            if (obj.visible) visible++;
            if (samples.length < 3) {
              const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
              samples.push({
                name: obj.name || obj.type,
                frustumCulled: obj.frustumCulled,
                opacity: mat?.opacity,
                transparent: mat?.transparent,
                color: mat?.color?.getHexString?.(),
                emissive: mat?.emissive?.getHexString?.(),
                emissiveIntensity: mat?.emissiveIntensity,
              });
            }
          });
          return { total, visible, samples };
        })(),
      })),
      aimAtNearest: () => {
        let best = null;
        let bestDist = Infinity;
        for (const enemy of liveEnemies) {
          const d = Math.hypot(enemy.mesh.position.x - yaw.position.x, enemy.mesh.position.z - yaw.position.z);
          if (d < bestDist) { bestDist = d; best = enemy; }
        }
        if (!best) return false;
        const center = getEnemyHitCenter(best, enemyHitCenterTmp);
        const dx = center.x - yaw.position.x;
        const dz = center.z - yaw.position.z;
        const dy = center.y - (yaw.position.y + camera.position.y);
        const flat = Math.max(0.0001, Math.hypot(dx, dz));
        yaw.rotation.y = Math.atan2(-dx, -dz);
        pitch.rotation.x = -Math.atan2(dy, flat);
        return true;
      },
      fireAtNearest: () => {
        const target = window.__rbTest.aimAtNearest();
        if (!target) return false;
        fireGun();
        return true;
      },
      forceDamage: (amount = 9999) => {
        if (damagePlayer(amount)) endGame("dead");
        updateHUD(0);
        return { hp: player.hp, state: game.state };
      },
      setUnlimitedHealth: (enabled = true) => {
        setUnlimitedHealth(!!enabled);
        return player.unlimitedHealth;
      },
      restart: async () => {
        await restartGame();
        return { state: game.state, wave: game.wave, enemies: enemies.filter(e => e.alive).length };
      },
      completeWave: () => {
        const live = enemies.filter(e => e.alive);
        for (const enemy of live) killEnemy(enemy);
        return { killed: game.killed, total: game.totalEnemies, remaining: enemies.filter(e => e.alive).length };
      },
      // Jumps the wave counter and re-applies wave lighting (blackout waves etc.).
      setWave: (n) => {
        game.wave = Math.max(1, Math.floor(n));
        applyWaveLighting(game.wave, false);
        return game.wave;
      },
      // Forces a scored kill on the nearest live enemy (optionally as a headshot).
      killNearest: (headshot = false) => {
        let best = null;
        let bestDist = Infinity;
        camera.getWorldPosition(cameraWorldTmp);
        for (const enemy of liveEnemies) {
          const d = getEnemyHitCenter(enemy, enemyHitCenterTmp).distanceTo(cameraWorldTmp);
          if (d < bestDist) { bestDist = d; best = enemy; }
        }
        if (!best) return false;
        best.killHeadshot = !!headshot;
        killEnemy(best);
        return true;
      },
      triggerMelee: () => meleeAttack(),
      // Multiplayer introspection (Phase 1).
      getNetActive: () => !!(net && net.active),
      getRemoteCount: () => remotePlayers.size,
      getFirstRemoteTarget: () => {
        const a = remotePlayers.values().next().value;
        return a ? { x: a.target.x, z: a.target.z, name: a.name } : null;
      },
      // Co-op introspection (Phase 2).
      getCoopProxyCount: () => coopProxies.size,
      applyCoopSnapshotForTest: () => {
        gameMode = "coop";
        net = {
          active: true,
          isHost: false,
          peerCount: 1,
          send: () => {},
          close: () => {},
        };
        myNetId = "test-guest";
        game.state = "playing";
        applyEnemySnapshot({
          wave: 1,
          killed: 0,
          total: 1,
          score: 0,
          list: [{ i: 101, ty: 0, x: 0, y: 1.18, z: -4, r: 0, hp: 100, mhp: 100 }],
        });
        const proxy = coopProxies.get(101);
        return {
          count: coopProxies.size,
          visible: !!proxy?.mesh?.visible,
          inScene: !!(proxy?.mesh?.parent),
          hpVisible: !!proxy?.hpBar?.mesh?.visible,
        };
      },
      getWave: () => game.wave,
      getKilled: () => game.killed,
      getTotal: () => game.totalEnemies,
      // Guest helper: send a lethal hit for the nearest enemy proxy to the host.
      guestDamageNearest: (dmg = 100000) => {
        let best = null;
        let bestDist = Infinity;
        camera.getWorldPosition(cameraWorldTmp);
        for (const proxy of coopProxies.values()) {
          if (!proxy.alive) continue;
          const d = getEnemyHitCenter(proxy, enemyHitCenterTmp).distanceTo(cameraWorldTmp);
          if (d < bestDist) { bestDist = d; best = proxy; }
        }
        if (!best || !net?.active) return false;
        net.send({ t: "hit", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), i: best.netId, dmg, hs: false });
        return true;
      },
      // PvP introspection / helpers (Phase 3).
      getMode: () => gameMode,
      setNetworkModeForTest: (mode = "coop", isHost = true) => {
        gameMode = mode === "pvp" ? "pvp" : "coop";
        net = {
          active: true,
          isHost: !!isHost,
          peerCount: 0,
          send: () => {},
          close: () => {},
        };
        myNetId = "test-local";
        syncMultiplayerModeLabels();
        syncCinematicControlLock();
        return gameMode;
      },
      getCinematicEnabled: () => cinematicState.enabled,
      getCinematicLocked: () => cinematicControls.toggles.some(toggle => toggle.disabled),
      getHp: () => player.hp,
      getPvpDead: () => !!player.pvpDead,
      getMyFrags: () => pvpScores.get(myNetId) || 0,
      // Hazard introspection / helpers (Phase 4).
      getHazardState: () => hazardState,
      getActiveHazardPos: () => {
        if (hazardActiveIndex < 0 || !hazardZones) return null;
        const z = hazardZones[hazardActiveIndex];
        return z ? { x: z.pos.x, z: z.pos.z } : null;
      },
      teleportTo: (x, z) => { yaw.position.set(x, PLAYER_H, z); return true; },
      // Send authoritative PvP damage to the first remote player (bypasses aim).
      pvpHitFirstRemote: (dmg = 40, hs = false) => {
        const a = [...remotePlayers.values()].find(remote => remote && !remote.dead && remote.hp > 0);
        if (!a || !net?.active) return false;
        net.send({ t: "pdamage", id: myNetId, seq: nextNetSeq(), sentAt: Math.round(performance.now()), target: a.id, dmg, hs });
        return true;
      },
      // Spawns one enemy of a named type at an offset from the player (for visual tests).
      spawnAt: (typeName, dx = 0, dz = -4.5) => {
        const type = ENEMY_TYPES.find(t => t.name === typeName);
        if (!type) return false;
        const openForEnemy = (x, z) => {
          const cell = worldToMap(x, z);
          return isOpenCell(cell.mx, cell.my)
            && !wallAtWorldRadius(x, z, 0.58)
            && !propBlocksAt(x, z, 0.58, 0.1, PLAYER_H + 1.1);
        };
        let pos = { x: yaw.position.x + dx, z: yaw.position.z + dz };
        if (!openForEnemy(pos.x, pos.z)) {
          const baseAngle = Math.atan2(dz, dx || 0.0001);
          const angles = [0, 0.55, -0.55, 1.1, -1.1, Math.PI, Math.PI * 0.5, -Math.PI * 0.5];
          const distances = [4.5, 6, 8, 10, 12, 14];
          let found = null;
          for (const dist of distances) {
            for (const offset of angles) {
              const angle = baseAngle + offset;
              const x = yaw.position.x + Math.cos(angle) * dist;
              const z = yaw.position.z + Math.sin(angle) * dist;
              if (openForEnemy(x, z)) {
                found = { x, z };
                break;
              }
            }
            if (found) break;
          }
          if (!found) {
            const fallback = [];
            for (let my = 1; my < MAP_H - 1; my++) {
              for (let mx = 1; mx < MAP_W - 1; mx++) {
                if (!isOpenCell(mx, my)) continue;
                const p = mapToWorld(mx, my);
                if (!openForEnemy(p.x, p.z)) continue;
                fallback.push({ x: p.x, z: p.z, dist: Math.hypot(p.x - yaw.position.x, p.z - yaw.position.z) });
              }
            }
            fallback.sort((a, b) => a.dist - b.dist);
            found = fallback[0] || null;
          }
          if (!found) return false;
          pos = found;
        }
        const enemy = createEnemy(type, pos, Math.max(2, game.wave), getWaveHpScale(game.wave));
        setEnemyAlive(enemy, true);
        enemy.aggroed = true;
        if (enemy.hpBar?.mesh) scene.add(enemy.hpBar.mesh);
        enemies.push(enemy); registerEnemy(enemy);
        game.totalEnemies = game.killed + enemies.filter(e => e.alive).length;
        updateObjective();
        return true;
      },
      forceMegaBlast: () => {
        let cherub = enemies.find(e => e.alive && e.typeName === "Null Cherub");
        if (!cherub) {
          window.__rbTest.spawnAt("Null Cherub", 0, -16);
          cherub = enemies.find(e => e.alive && e.typeName === "Null Cherub");
        }
        if (!cherub) return false;
        cherub.aggroed = true;
        cherub.megaBlastCooldown = 0;
        startMegaBlast(cherub);
        return true;
      },
    };
  }

  window.addEventListener("keydown", e => {
    if (commandPrompt.open) {
      if (e.code === "Backquote") {
        e.preventDefault();
        closeCommandPrompt(true);
      } else if (e.code === "Escape") {
        e.preventDefault();
        closeCommandPrompt(true);
      }
      return;
    }

    if (e.code === "Backquote") {
      e.preventDefault();
      if (game.state === "playing") openCommandPrompt();
      return;
    }

    if (e.code === "Escape") {
      e.preventDefault();
      if (game.state === "playing") pauseGame();
      else if (game.state === "paused") resumeGame();
      return;
    }

    if (e.code === "F3") {
      e.preventDefault();
      perfOverlay.toggle();
      return;
    }

    keys.add(e.code);

    if (e.ctrlKey && e.code === "KeyH") {
      e.preventDefault();
      if (e.repeat) return;
      setUnlimitedHealth(!player.unlimitedHealth);
      return;
    }

    if (e.ctrlKey && e.code === "KeyJ") {
      e.preventDefault();
      if (e.repeat) return;
      const BASE_SPRINT = 9.2;
      const boosted = Math.abs(player.sprintSpeed - BASE_SPRINT * 2) < 0.1;
      player.sprintSpeed = boosted ? BASE_SPRINT : BASE_SPRINT * 2;
      player.speed = boosted ? 5.8 : 5.8 * 1.5;
      setUnlimitedSprint(true);
      addKillFeed(boosted ? "SPEED: NORMAL" : "SPEED: 2× BOOST");
      return;
    }

    if (e.ctrlKey && e.code === "KeyK") {
      e.preventDefault();
      if (e.repeat) return;
      setUnlimitedAmmo(!player.unlimitedAmmo);
      return;
    }

    if (e.code === "KeyM") {
      if (e.repeat) return;
      toggleThirdPersonView();
      return;
    }

    if ((game.state === "dead" || game.state === "won" || game.state === "waveclear") && e.code === "Space") {
      restartGame();
      requestCanvasPointerLock();
      return;
    }

    if (game.state !== "playing") return;
    if (e.code === "KeyE") {
      if (e.repeat) return;
      tryInteract();
    }
    if (e.code === "KeyR") tryReload();
    if (e.code === "KeyV") {
      if (e.repeat) return;
      meleeAttack();
    }
    if (e.code === "KeyF") {
      lightingState.flashlightOn = !lightingState.flashlightOn;
      broadcastFlashlightFx();
      addKillFeed(lightingState.flashlightOn ? "FLASHLIGHT ON" : "FLASHLIGHT OFF");
    }
    if (e.code === "Digit1") switchGun(GUNS.RIFLE);
    if (e.code === "Digit2") switchGun(GUNS.SHOTGUN);
    if (e.code === "Digit3") switchGun(GUNS.SNIPER);
    if (e.code === "Digit4") switchGun(GUNS.PISTOL);
    if (e.code === "Digit5") switchGun(GUNS.SMG);
    if (e.code === "Digit6") switchGun(GUNS.LMG);
    if (e.code === "Digit7") switchGun(GUNS.DMR);
    if (e.code === "Digit8") switchGun(GUNS.AKIMBO);
    if (e.code === "Digit9") switchGun(GUNS.RAILGUN);
    if (e.code === "Digit0") switchGun(GUNS.FLAK);
  });

  window.addEventListener("keyup", e => keys.delete(e.code));

  const clickToPlayEl = document.getElementById("click-to-play");

  function syncClickToPlay() {
    if (!clickToPlayEl) return;
    const needsLock = game.state === "playing" && !mouse.locked && !player.pvpDead;
    clickToPlayEl.classList.toggle("active", needsLock);
  }

  document.addEventListener("pointerlockchange", () => {
    mouse.locked = document.pointerLockElement === canvas;
    if (!mouse.locked) {
      mouse.down = false;
      mouse.aiming = false;
    }
    syncClickToPlay();
  });

  window.addEventListener("mousemove", e => {
    if (!mouse.locked || game.state !== "playing") return;
    yaw.rotation.y -= e.movementX * lookSens.x;
    pitch.rotation.x -= e.movementY * lookSens.y;
    pitch.rotation.x = Math.max(-1.2, Math.min(1.2, pitch.rotation.x));
  });

  // Clicking either the canvas OR the click-to-play prompt acquires pointer lock.
  if (clickToPlayEl) {
    clickToPlayEl.addEventListener("click", () => {
      requestCanvasPointerLock();
      syncClickToPlay();
    });
  }

  canvas.addEventListener("mousedown", e => {
    if (!document.pointerLockElement) requestCanvasPointerLock();
    if (e.button === 2) {
      mouse.aiming = game.state === "playing";
      return;
    }
    if (e.button !== 0) return;
    mouse.down = true;
    if (game.state === "playing") fireGun();
  });

  window.addEventListener("mouseup", e => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.aiming = false;
  });

  canvas.addEventListener("contextmenu", e => e.preventDefault());

  // ── Touch controls (mobile) ────────────────────────────────────────────────
  // Left half = movement (dynamic joystick), right side = look-drag, with action
  // buttons overlaid. Drives the same input state as keyboard/mouse so all game
  // systems (movement, bob, networking, ADS, fire) work identically.
  function setupTouchControls() {
    if (!isTouchDevice) return;
    document.body.classList.add("touch-device");

    const moveZone = document.getElementById("tc-move");
    const lookZone = document.getElementById("tc-look");
    const moveBase = document.getElementById("tc-move-base");
    const moveKnob = document.getElementById("tc-move-knob");
    if (!moveZone || !lookZone) return;

    const LOOK_SENS  = 0.0040;  // radians per px of drag
    const JOY_RADIUS = 56;      // px max stick travel

    let moveId = null, moveOX = 0, moveOY = 0;
    let lookId = null, lookLX = 0, lookLY = 0;

    const setKey = (code, on) => { if (on) keys.add(code); else keys.delete(code); };

    function updateJoystick(cx, cy) {
      let dx = cx - moveOX, dy = cy - moveOY;
      const dist = Math.hypot(dx, dy);
      if (dist > JOY_RADIUS) { dx = dx / dist * JOY_RADIUS; dy = dy / dist * JOY_RADIUS; }
      const nx = dx / JOY_RADIUS, ny = dy / JOY_RADIUS;
      touchInput.move.x = nx;
      touchInput.move.y = ny;
      touchInput.move.active = true;
      if (moveKnob) moveKnob.style.transform = `translate(${moveOX + dx}px, ${moveOY + dy}px)`;
      // Mirror to WASD so cosmetic checks (bob, sprint indicator, anim) react too.
      setKey("KeyW", -ny > 0.3); setKey("KeyS", -ny < -0.3);
      setKey("KeyD",  nx > 0.3); setKey("KeyA",  nx < -0.3);
    }

    function resetMove() {
      touchInput.move.x = 0; touchInput.move.y = 0; touchInput.move.active = false;
      setKey("KeyW", false); setKey("KeyS", false); setKey("KeyA", false); setKey("KeyD", false);
      document.body.classList.remove("tc-move-active");
    }

    function applyLook(dx, dy) {
      if (game.state !== "playing") return;
      yaw.rotation.y   -= dx * LOOK_SENS * lookSensMul;
      pitch.rotation.x -= dy * LOOK_SENS * lookSensMul;
      pitch.rotation.x = Math.max(-1.2, Math.min(1.2, pitch.rotation.x));
    }

    moveZone.addEventListener("touchstart", e => {
      e.preventDefault();
      if (moveId !== null) return;
      const t = e.changedTouches[0];
      moveId = t.identifier; moveOX = t.clientX; moveOY = t.clientY;
      if (moveBase) moveBase.style.transform = `translate(${moveOX}px, ${moveOY}px)`;
      document.body.classList.add("tc-move-active");
      updateJoystick(t.clientX, t.clientY);
    }, { passive: false });

    lookZone.addEventListener("touchstart", e => {
      e.preventDefault();
      if (lookId !== null) return;
      const t = e.changedTouches[0];
      lookId = t.identifier; lookLX = t.clientX; lookLY = t.clientY;
    }, { passive: false });

    window.addEventListener("touchmove", e => {
      let handled = false;
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) { updateJoystick(t.clientX, t.clientY); handled = true; }
        else if (t.identifier === lookId) {
          applyLook(t.clientX - lookLX, t.clientY - lookLY);
          lookLX = t.clientX; lookLY = t.clientY; handled = true;
        }
      }
      if (handled) e.preventDefault();
    }, { passive: false });

    function endTouch(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) { moveId = null; resetMove(); }
        if (t.identifier === lookId) { lookId = null; }
      }
    }
    window.addEventListener("touchend", endTouch, { passive: false });
    window.addEventListener("touchcancel", endTouch, { passive: false });

    // Button helpers ----------------------------------------------------------
    function holdBtn(id, onDown, onUp) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("touchstart", e => { e.preventDefault(); el.classList.add("tc-held"); onDown && onDown(); }, { passive: false });
      const up = e => { e.preventDefault(); el.classList.remove("tc-held"); onUp && onUp(); };
      el.addEventListener("touchend", up, { passive: false });
      el.addEventListener("touchcancel", up, { passive: false });
    }
    function tapBtn(id, fn) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("touchstart", e => { e.preventDefault(); el.classList.add("tc-held"); }, { passive: false });
      const up = e => { e.preventDefault(); el.classList.remove("tc-held"); fn && fn(); };
      el.addEventListener("touchend", up, { passive: false });
      el.addEventListener("touchcancel", () => el.classList.remove("tc-held"), { passive: false });
    }

    // Fire (hold for auto-fire) ----------------------------------------------
    holdBtn("tc-fire",
      () => { if (game.state === "playing") { mouse.down = true; fireGun(); } },
      () => { mouse.down = false; });
    // ADS (hold) --------------------------------------------------------------
    holdBtn("tc-ads",
      () => { mouse.aiming = game.state === "playing"; },
      () => { mouse.aiming = false; });
    // Jump (hold = keeps hopping while held) -----------------------------------
    holdBtn("tc-jump", () => setKey("Space", true), () => setKey("Space", false));
    // Tap actions -------------------------------------------------------------
    tapBtn("tc-reload", () => { if (game.state === "playing") tryReload(); });
    tapBtn("tc-melee",  () => { if (game.state === "playing") meleeAttack(); });
    tapBtn("tc-w1",     () => switchGun(GUNS.RIFLE));
    tapBtn("tc-w2",     () => switchGun(GUNS.SHOTGUN));
    tapBtn("tc-w3",     () => switchGun(GUNS.SNIPER));
    tapBtn("tc-pack",   () => { if (game.state === "playing") tryInteract(); });
    tapBtn("tc-view",   () => toggleThirdPersonView());
    tapBtn("tc-pause",  () => {
      if (game.state === "playing") pauseGame();
      else if (game.state === "paused") resumeGame();
    });
    // Sprint (latch toggle) ---------------------------------------------------
    const sprintEl = document.getElementById("tc-sprint");
    if (sprintEl) {
      sprintEl.addEventListener("touchstart", e => {
        e.preventDefault();
        touchInput.sprint = !touchInput.sprint;
        setKey("ShiftLeft", touchInput.sprint);
        sprintEl.classList.toggle("tc-held", touchInput.sprint);
      }, { passive: false });
    }
  }
  setupTouchControls();

  if (startBtn) startBtn.onclick = () => {
    setOverlayMode("main");
    beginMission();
  };

  for (const card of loadoutCards || []) {
    card.addEventListener("click", () => chooseLoadout(card.dataset.loadout));
  }

  if (loadoutBtn) loadoutBtn.onclick = () => setMenuPanel("loadout");
  if (intelBtn) intelBtn.onclick = () => setMenuPanel("intel");
  if (modelEditorBtn) modelEditorBtn.onclick = () => openModelEditor();
  if (launchLoadoutBtn) launchLoadoutBtn.onclick = () => {
    if (game.state === "paused") {
      setMenuPanel("briefing");
      return;
    }
    beginMission();
  };

  if (resumeBtn) resumeBtn.onclick = () => resumeGame();
  if (restartBtn) restartBtn.onclick = () => {
    overlay?.classList.add("hidden");
    restartGame();
    requestCanvasPointerLock();
  };
  if (stateRestartBtn) stateRestartBtn.onclick = () => {
    stateOverlay?.classList.remove("active");
    restartGame();
    requestCanvasPointerLock();
  };
  if (stateQuitBtn) stateQuitBtn.onclick = () => {
    stateOverlay?.classList.remove("active");
    quitToMenu();
  };
  if (quitBtn) quitBtn.onclick = () => setMenuPanel("quit");
  if (quitCancelBtn) quitCancelBtn.onclick = () => setMenuPanel("briefing");
  if (quitConfirmBtn) quitConfirmBtn.onclick = () => {
    if (game.state === "paused") {
      quitToMenu();
      return;
    }

    window.close();
    if (quitStatus) quitStatus.textContent = "Browser blocked close - use the tab controls";
  };

  for (const item of document.querySelectorAll(".ov-nav-item[role='button']")) {
    item.addEventListener("keydown", event => {
      if (event.defaultPrevented) return;
      if (event.code !== "Enter" && event.code !== "Space") return;
      event.preventDefault();
      item.click();
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "F8") {
      event.preventDefault();
      openModelEditor();
    }
  });

  applySelectedLoadoutUI();
  setupLoadoutPreviews();
  updateLoadoutPreviews(performance.now(), true);

  window.addEventListener("resize", onResize);

  function setWeaponWarmupVisibility(visible) {
    const rigs = [
      ...firstPersonWeaponCache.values(),
      ...thirdPersonWeaponCache.values(),
    ];
    for (const rig of rigs) {
      if (!rig?.gun) continue;
      rig.gun.visible = visible;
      if (rig.flash) {
        rig.flash.visible = visible;
        rig.flash.material.opacity = visible ? 0.65 : 0;
      }
      setPhysicalMuzzleFlash(rig.muzzle, visible, visible ? 1 : 0, 1);
    }
    if (!visible) applyViewModeVisibility();
  }

  async function warmFirstUseCameraViews() {
    const savedYaw = yaw.rotation.y;
    const savedPitch = pitch.rotation.x;
    const savedCameraPos = camera.position.clone();
    const savedCameraRot = camera.rotation.clone();
    const savedThirdPersonEnabled = thirdPerson.enabled;
    const savedAdsSwapProgress = thirdPerson.adsSwapProgress;
    const headings = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    const pitchAngles = [0, -0.34, 0.24, 0.12];

    setWeaponWarmupVisibility(true);
    for (let i = 0; i < headings.length; i++) {
      yaw.rotation.y = savedYaw + headings[i];
      pitch.rotation.x = pitchAngles[i % pitchAngles.length];
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
      renderScene();
      await waitFrame();
    }

    if (thirdPerson.ready) {
      thirdPerson.enabled = true;
      thirdPerson.adsSwapProgress = 0;
      applyViewModeVisibility();
      for (let i = 0; i < headings.length; i++) {
        yaw.rotation.y = savedYaw + headings[i];
        pitch.rotation.x = pitchAngles[(i + 1) % pitchAngles.length];
        updateThirdPersonCharacter(0.016, { f: 0, s: 0, sprinting: false, jumping: false });
        camera.position.copy(resolveThirdPersonCameraPosition(0, 0, 0));
        renderScene();
        await waitFrame();
      }
    }

    thirdPerson.enabled = savedThirdPersonEnabled;
    thirdPerson.adsSwapProgress = savedAdsSwapProgress;
    yaw.rotation.y = savedYaw;
    pitch.rotation.x = savedPitch;
    camera.position.copy(savedCameraPos);
    camera.rotation.copy(savedCameraRot);
    setWeaponWarmupVisibility(false);
    applyViewModeVisibility();
  }

  // Pre-build one of every character enemy type (warden, zombie, cloned ghost) during
  // loading and compile/upload their skinned-mesh shaders + textures, so the FIRST
  // time each kind appears mid-mission there is no shader-compile/texture-upload hitch.
  // Wave-1 priming only covers the types that spawn on wave 1, so zombies (wave 5+) and
  // other variants would otherwise stutter on first sight.
  function warmEnemyShaders() {
    const seen = new Set();
    const temps = [];
    for (const type of ENEMY_TYPES) {
      const kind = type.angelModel ? "angel" : type.zombieModel ? "zombie" : type.clonedGhost ? "ghost" : "drone";
      if (seen.has(kind)) continue;
      seen.add(kind);
      // Only the skinned/character kinds risk a compile hitch; warm those.
      if (kind !== "angel" && kind !== "zombie" && kind !== "ghost") continue;
      try {
        const mesh = createDroneMesh(type);
        mesh.position.set(0, -50, 0); // out of the player's view but inside the scene
        mesh.userData.enemyRef = { alive: true, visualSpeed: 1.2, visualTurn: 0.2, hp: 100, maxHp: 100, attackPulse: 0, isAttacking: false, aggroed: true, meleeWindUp: -1 };
        mesh.userData.mixer?.update?.(0.016);
        const ghost = mesh.userData.clonedGhost;
        if (ghost?.mixer) ghost.mixer.update(0.016);
        scene.add(mesh);
        temps.push({ mesh, kind });
      } catch (e) {
        console.warn("warmEnemyShaders: failed to warm", type.name, e);
      }
    }
    if (temps.length) {
      scene.updateMatrixWorld(true);
      warmObjectTextures(scene);
      compileSceneForCurrentRenderer();
      renderScene();
      for (const { mesh, kind } of temps) {
        scene.remove(mesh);
        deactivateEnemyRuntimeLights?.({ mesh });
        // CRITICAL: zombie/ghost are SkeletonUtils.clone()s that SHARE geometry +
        // materials with their source GLB. Disposing them would free the shared GPU
        // buffers and make every real spawn invisible. Only the warden ("angel") is
        // procedural (owns its geometry), so only it is safe to dispose.
        if (kind === "angel") disposeObject3D?.(mesh);
      }
    }
  }

  async function compileStartupScene() {
    setLoadingProgress("Uploading textures to GPU", 0.86);
    warmObjectTextures(scene);
    initTextureForRenderer(getMuzzleFlashTexture());
    if (muzzleFlashTexture) initTextureForRenderer(muzzleFlashTexture);
    await waitFrame();

    setLoadingProgress("Warming enemy shaders", 0.88);
    await waitFrame();
    warmEnemyShaders();
    await waitFrame();

    setLoadingProgress("Compiling scene materials", 0.9);
    await waitFrame();
    compileAllWarmables();

    setLoadingProgress("Warming render frames", 0.94);
    setWeaponWarmupVisibility(false);
    setLoadingProgress("Finalizing mission systems", 0.98);
  }

  // ── Static draw-call collapse ──────────────────────────────────────────────
  // The world is built from many cloned meshes that share geometry + material
  // (windows, trims, props, building details). Each is its own draw call, and at
  // ~5k draws the WebGPU/WebGL command-submission cost dominates the frame (the
  // bottleneck is CPU draw submission, not fill-rate — which is why resolution
  // scaling can't help). We group meshes by (geometry, material, shadow flags)
  // and replace each group of 4+ with a single InstancedMesh: identical pixels,
  // one draw call instead of N. Excludes skinned meshes and the wallMeshes
  // raycast set (bullet decals / line-of-sight) so gameplay is untouched.
  // Disable at runtime for debugging via: localStorage.rb_disable_instancing = 1
  function collapseStaticDrawCalls() {
    if (localStorage.getItem("rb_disable_instancing")) return null;
    try {
      scene.updateMatrixWorld(true);
      const exclude = new Set(wallMeshes);
      const groups = new Map();
      scene.traverse(obj => {
        if (!obj.isMesh || obj.isInstancedMesh || obj.isSkinnedMesh) return;
        if (obj.morphTargetInfluences) return;
        if (exclude.has(obj) || obj.userData?.noInstancing) return;
        if (Array.isArray(obj.material) || !obj.material || !obj.geometry) return;
        // Skip anything under an interactive/animated root (pack station, doors).
        for (let p = obj.parent; p; p = p.parent) {
          if (p.userData?.noInstancing) return;
        }
        const key = `${obj.geometry.uuid}|${obj.material.uuid}|${obj.castShadow ? 1 : 0}${obj.receiveShadow ? 1 : 0}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = []));
        g.push(obj);
      });

      let collapsedDraws = 0, instancedMeshes = 0;
      for (const meshes of groups.values()) {
        if (meshes.length < 4) continue;
        const first = meshes[0];
        const inst = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
        inst.castShadow = first.castShadow;
        inst.receiveShadow = first.receiveShadow;
        inst.layers.mask = first.layers.mask;
        // The instances are spread across the map, so the geometry-derived
        // bounding sphere would frustum-cull the whole batch incorrectly. Keep it
        // always-submitted: it is one cheap draw call regardless.
        inst.frustumCulled = false;
        inst.name = `${first.name || "static"}_x${meshes.length}`;
        for (let i = 0; i < meshes.length; i++) inst.setMatrixAt(i, meshes[i].matrixWorld);
        inst.instanceMatrix.needsUpdate = true;
        scene.add(inst);
        for (const m of meshes) m.parent?.remove(m);
        collapsedDraws += meshes.length;
        instancedMeshes++;
      }
      const result = { collapsedDraws, instancedMeshes, netSaved: collapsedDraws - instancedMeshes };
      console.log(`[perf] Static draw-call collapse: ${collapsedDraws} meshes -> ${instancedMeshes} instanced draws (saved ~${result.netSaved} draws)`);
      return result;
    } catch (err) {
      console.warn("[perf] collapseStaticDrawCalls failed; scene left unmerged:", err);
      return null;
    }
  }

  // Load GLTF landmark models listed in modules/landmarks.js and place them in the
  // world. Imported PBR materials pick up scene.environment (IBL) automatically. Each
  // item is guarded so one bad/missing model can't break boot. No-op if the manifest
  // is empty (default), so this costs nothing until you add assets.
  // Kenney GLB buildings arrive as many separate sub-meshes that all share one
  // colormap material — a big chunk of the draw calls. Merge each model's sub-meshes
  // (grouped by material) into a single geometry in the model's local space. Visually
  // identical; cuts per-building draws from N to ~1. Robust: leaves any group it can't
  // merge (mismatched attributes) untouched.
  function mergeLoadedModel(obj) {
    if (typeof mergeGeometries !== "function") return;
    obj.updateMatrixWorld(true);
    const objInv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    const byMat = new Map(); // material -> { geos:[], meshes:[] }
    obj.traverse(o => {
      if (!o.isMesh || o.isSkinnedMesh || !o.geometry || Array.isArray(o.material)) return;
      const rel = new THREE.Matrix4().multiplyMatrices(objInv, o.matrixWorld);
      const g = o.geometry.clone();
      g.applyMatrix4(rel);
      const rec = byMat.get(o.material) || { geos: [], meshes: [] };
      rec.geos.push(g); rec.meshes.push(o);
      byMat.set(o.material, rec);
    });
    for (const [mat, rec] of byMat) {
      if (rec.meshes.length < 2) { rec.geos.forEach(g => g.dispose()); continue; }
      let merged = null;
      try { merged = mergeGeometries(rec.geos, false); } catch (e) { merged = null; }
      rec.geos.forEach(g => g.dispose());
      if (!merged) continue; // couldn't merge this group — leave its originals in place
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = true;
      obj.add(mesh);
      for (const o of rec.meshes) { if (o.parent) o.parent.remove(o); o.geometry?.dispose?.(); }
    }
  }

  async function loadWorldLandmarks() {
    if (!Array.isArray(LANDMARKS) || LANDMARKS.length === 0) return;
    const loader = new GLTFLoader();
    const group = new THREE.Group();
    group.name = "WorldLandmarks";
    scene.add(group);
    for (const def of LANDMARKS) {
      if (!def || !def.url) continue;
      try {
        const gltf = await loader.loadAsync(def.url);
        const obj = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!obj) continue;
        if (Array.isArray(def.scale)) obj.scale.set(def.scale[0], def.scale[1], def.scale[2]);
        else if (typeof def.scale === "number") obj.scale.setScalar(def.scale);
        obj.position.set(def.x || 0, (def as any).y || 0, def.z || 0);
        obj.rotation.y = def.rotationY || 0;
        obj.traverse(o => {
          if (o.isMesh) {
            o.castShadow = (def as any).castShadow !== false; // buildings/landmarks cast daytime shadows
            o.receiveShadow = true;
            o.frustumCulled = true;
          }
        });
        mergeLoadedModel(obj); // collapse the model's shared-material sub-meshes → fewer draws
        group.add(obj);
        if (def.collider && typeof window.__extAddCollider === "function") {
          window.__extAddCollider(def.x || 0, def.z || 0, def.collider.w, def.collider.d);
        }
        // The plaza statue IS the perk machine: anchor the interaction to it and
        // collect its materials for the purchasable emissive pulse (uniform-only —
        // no new lights, no shader relink; see updatePerkMachine).
        if (def.url.includes("landmark-statue")) {
          const mats = [];
          obj.traverse(o => {
            if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.emissive) {
              if (!mats.includes(o.material)) {
                o.material.emissive.setHex(0x22d3ee); // signature cyan
                o.material.emissiveIntensity = 0;
                mats.push(o.material);
              }
            }
          });
          perkMachineState.station = obj;
          perkMachineState.pulseMats = mats;
          // Soft additive "this is interactive" beacon: reuses the muzzle-flash
          // sprite pipeline (same material/texture already linked elsewhere —
          // no new GL program). Opacity is distance-faded in updatePerkMachine
          // so it reads from range without a real-time light.
          const glowSprite = createMuzzleFlash(0x22d3ee, 3.2);
          glowSprite.position.set(0, 2.4, 0);
          glowSprite.visible = true;
          glowSprite.material.opacity = 0;
          obj.add(glowSprite);
          perkMachineState.glowSprite = glowSprite;
        }
      } catch (e) {
        console.warn(`[landmarks] failed to load ${def.url}`, e);
      }
    }
    // Fallback: if the statue GLB failed to load, perks must stay buyable — anchor
    // the machine to an invisible point at the statue's manifest position.
    if (!perkMachineState.station) {
      const anchor = new THREE.Object3D();
      anchor.name = "Perk Machine Anchor (statue missing)";
      anchor.position.set(0, 0, 175);
      scene.add(anchor);
      perkMachineState.station = anchor;
      perkMachineState.pulseMats = null;
    }
    warmObjectTextures(scene);
  }

  async function bootGame() {
    try {
      setLoadingProgress("Initializing renderer", 0.04);
      await preloadStartupFileCache();
      await loadCoreModelAssets();
      await preloadStartupTextureAssets();

      setLoadingProgress("Building breach room", 0.58);
      buildLevel(THREE, scene, renderer, wallMeshes);
      if (window.buildExteriorPlayArea) {
        setLoadingProgress("Building exterior zone", 0.62);
        // Share wallMeshes so exterior surfaces receive bullet decals + enemy LOS
        window.__wallMeshes = wallMeshes;
        await window.buildExteriorPlayArea(THREE, scene, renderer);
        window.__playerYaw = yaw;
      }
      // Build the sky + IBL environment AFTER the world so it is the final authority
      // on scene.background / scene.environment (buildLevel and the exterior both set
      // their own backgrounds during construction).
      await buildSkyEnvironment();
      // Pre-build the blackout fire-sky dome now (hidden) so compileStartupScene /
      // compileAllWarmables links its shader during boot — the first blackout wave
      // must not pay a link hitch. renderer.compile walks the whole graph, visible
      // or not, so the dome only needs to exist in the scene.
      buildFireSkyDome();
      loadAudioAssets(); // async, non-blocking; SFX/VO fall back to synth until buffers load
      createPackStation();
      createMysteryBox();
      warmObjectTextures(scene);
      await waitFrame();

      setLoadingProgress("Loading exterior scene", 0.68);
      await loadExteriorCityScene();
      await loadWorldLandmarks();
      warmObjectTextures(scene);
      // Bake the static sun shadow map now that the level, buildings and cover all exist.
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      await waitFrame();

      // Collapse the now-fully-built static world into instanced draw calls
      // before warming combat effects (enemies/weapons are added after this).
      collapseStaticDrawCalls();

      setLoadingProgress("Warming combat effects", 0.78);
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      setLoadingProgress("Warming weapon effects", 0.785);
      prewarmWeaponViewModels();
      await waitFrame();
      setLoadingProgress("Warming lightning effects", 0.795);
      warmLightningShaders();
      await waitFrame();
      setLoadingProgress("Preparing drone pools", 0.805);
      prewarmSiegeDronePool({ compile: true });
      await waitFrame();
      setLoadingProgress("Scheduling enemy pools", 0.815);
      createThirdPersonCharacter();
      resetPlayer({ setStartTime: false });
      // Prewarm 1 instance per type on low/medium tiers (was 2). Wave 1 spawns a
      // single enemy, so 1 fully covers the first wave with no spawn hitch; the
      // pool grows lazily afterwards. Halves enemy compile cost at load → faster start.
      const prewarmCount = deviceProfile.tier === "high" ? 2 : 1;
      setLoadingProgress("Priming enemy waves", 0.82);
      await prewarmAllEnemyPools({ count: prewarmCount });
      setLoadingProgress("Priming advanced enemy pools", 0.835);
      await prewarmClonedGhostPool({ count: prewarmCount });
      setLoadingProgress("Priming first wave", 0.85);
      await warmFirstWaveEnemyInstances();
      await compileStartupScene();

      setOverlayMode("main");
      updateHUD(0);
      renderMinimap(performance.now());
      renderScene();
      // Front-load procedural-audio warmup (node graph + buffers) here during the
      // loading screen instead of at mission start, where it caused a hitch on
      // wave 1. The AudioContext starts suspended (no gesture yet) and resumes on
      // the first click; only the one-time node-creation cost is paid here.
      setLoadingProgress("Warming audio", 0.99);
      try { primeFirstUseAudio(); } catch (_) { /* resumes on first user gesture */ }
      setLoadingProgress("Ready", 1);
      // The menu's reveal animation has its own watchdog timer and can put the Start
      // button on screen before we get here. Publish readiness so it — and beginMission
      // — can tell a finished boot from a still-building world.
      bootComplete = true;
      document.body.dataset.rbReady = "1";
      setTimeout(hideLoadingScreen, 180);
      requestAnimationFrame(animate);
    } catch (err) {
      console.error("UNKNW startup failed:", err);
      if (loadingStatus) loadingStatus.textContent = "Startup failed - check console";
    }
  }

  bootGame();
})();


