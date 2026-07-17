# UNKNW (Room Breach FPS) — Claude Code Helper

## Project at a Glance

Browser third-person wave shooter built on **Three.js r166**, branded **UNKNW** (internal APIs still say RoomBreach — deliberate, see Rebrand note). Core game logic lives in one large async IIFE in `three_fps_game.js`. Environment geometry and collision live in `environment.js`.

**Two entry points, both live:**
- `index.html` — the real entry. Vite resolves the bare `three` / `peerjs` imports, so it
  needs a dev server: `npm run dev` (then `/index.html`). There is no importmap.
- `first_person_shooter_room_game (1).html` — legacy standalone copy with an importmap,
  served by `.tools/static-server.cjs` on :8000. **The Playwright specs use this one.**

Both load the same `three_fps_game.js`, so a game fix applies to both — but HTML/CSS
changes (e.g. the menu-reveal watchdog) must be made in **both** files.

```
Room breach fps11/
├── index.html                                 ← Entry point (Vite)
├── first_person_shooter_room_game (1).html   ← Legacy entry (importmap); used by tests
├── three_fps_game.js                          ← Main game loop, weapons, AI, networking (~17 000 lines)
├── environment.js                             ← MAP grid, arena geometry, lighting, collision math
├── exterior_map.js                            ← Outdoor street/plaza zone (procedural)
├── vite.config.ts                             ← Build (copies environment/exterior/assets into dist)
├── server.js / Start Multiplayer.bat          ← LAN/internet multiplayer launcher
├── modules/
│   ├── gun_config.js                          ← GUN_SPECS (damage, ammo, spread, recoil, ADS FOV)
│   ├── dom_ui.js                              ← getHudElements(), getMenuElements(), loading controller
│   ├── netcode.js                             ← WebRTC peer-to-peer via PeerJS (+ optional TURN)
│   ├── asset_paths.js                         ← Texture/model URL constants
│   ├── audio_assets.js                        ← SFX/VO manifest (Kenney packs + TTS announcer)
│   ├── settings.js                            ← Persistent localStorage settings
│   ├── dev_engine.js                          ← Developer preset engine (schema, presets, resolve/apply)
│   ├── dev_presets.js                         ← Built-in preset library for the dev console
│   ├── landmarks.js                           ← GLB landmark manifest (city skyline, statue)
│   ├── storm_warden.js                        ← Procedural skinned Warden/Seraph/Cherub character rig
│   ├── zombie_character.js                    ← Skinned Mixamo zombie controller (clip layering)
│   ├── zombie_assets.js                       ← Zombie model/animation asset list
│   ├── model_editor_state.js                  ← Model-editor persistence
│   ├── sjm.js                                 ← F8 diagnostics overlay (clone movement)
│   └── three_loaders.js                       ← GLTFLoader / FBXLoader helpers
├── dev.html                                   ← Standalone Developer Console (preset UI, dev-only)
├── model_preview.html                         ← Standalone character/animation inspector
├── scripts/                                   ← optimize-textures.mjs, convert-zombie.mjs
├── .tools/                                    ← Playwright specs + static test server
├── DEV_MANUAL.md                              ← Developer customization manual
└── assets/                                    ← textures/, hdri/, audio/, world/, zombies/, landmarks/, models/
```

## Architecture

```
HTML loads:
  environment.js   → window.RoomBreachEnvironment  (MAP, collision, buildLevel)
  exterior_map.js  → window.buildExteriorPlayArea  (outdoor zone)
  three_fps_game.js (async IIFE, imports Three.js via CDN importmap)
```

Three.js is imported as an ES module inside `three_fps_game.js` (Vite bare import in `index.html`; importmap in the legacy HTML). All other files are classic scripts that receive THREE as a function parameter.

## Systems added after this doc's original sections (quick map)

- **Sky**: ONE HDR skybox (`assets/hdri/kloppenheim_06_puresky_2k.hdr`, golden hour) on a
  camera-locked dome (`buildSkyDome`, works on WebGL+WebGPU). `SKY_DOME_DAMP = 0.35`
  prevents ACES bleaching the clouds; sun/fog/horizon colours are matched to the HDR.
  `?sky=<basename>` URL param previews any hdr in assets/hdri.
- **Blackout waves (wave%10)**: sky dome hidden, background/fog black, sun/hemi starved,
  and an animated **fire sky dome** (`buildFireSkyDome`) shows a burning horizon.
- **Per-enemy AI brains** (`updateEnemyBrain` dispatcher): each type has a specialised
  brain writing `aiAdvanceMul/aiLateralMul/aiRetreat/aiPhase`; the Warden rig poses per
  aiPhase in `storm_warden.js`. Clones move via a virtual-WASD resolver mirroring the
  player's key mechanics; zombies layer an upper-body attack clip over running legs.
- **Angel ability kits** (telegraph-ring pool + pooled lightning only — no new lights):
  Warden = Judgment Lance / Rolling Barrage / knockback Bulwark; Seraph = Blink Strike
  (phase-out → flank arrival) / Afterimage Feint; Cherub = Sanctuary Collapse (shrinking
  safe ring) / Null Field EMP (disables sprint+reload via `player.nullLockTimer`).
- **Exterior interactables** (Pack-a-Punch prompt pattern; unified through
  `tryInteract()` on KeyE): the landmark STATUE (0,175) is the 3-tier perk machine
  (Overcharge/Vitality/Aegis via `player.perkDamageMul/maxHp/perkDamageResist`;
  anchored in `loadWorldLandmarks`, emissive-only pulse when purchasable), and
  parked-car ALARMS (`window.__extCarAlarms`, 10 s two-tone WebAudio alarm +
  emissive flash, 30 s per-car cooldown, host-only in coop; enemies steer to the
  global `soundLure` while ringing). Wall-buy crates + horde beacon were removed.
  Currency = `player.xp`. Owned perks show on a JS-created `#perk-row` HUD strip.
- **Signature colour grade**: fixed, non-player-adjustable canvas filter + `#grade-overlay`
  vignette (`applyCinematicSettings` non-cinematic branch). Minimap is cyan/steel.
- **Rebrand**: user-facing name is UNKNW; `window.RoomBreachEnvironment` and internal
  names deliberately unchanged (API contract across classic scripts).

## Developer Engine & Preset System

A centralized, versioned config layer lets developers tune the game from a
**standalone UI** (`dev.html`, not the in-game menu) with named presets per
category + layered master presets. See **`DEV_MANUAL.md`** for the full guide.

- **`modules/dev_engine.js`** — schema (`DEFAULTS`), validation (`sanitizeCategory`),
  preset CRUD, master layering, `resolveActive()`, export/import, migration.
  Categories: `player camera weapons enemies gameplay spawn lighting map quality debug`.
  **`quality`** = renderer backend + perf caps (see Renderer note below).
- **Two localStorage keys:** `rb-dev-store-v1` (full preset library) and
  `rb-dev-active-v1` (the resolved snapshot the game reads). Only *activated*
  categories appear in the snapshot → **default behavior is unchanged unless a
  preset is applied.**
- **Game hooks** (`three_fps_game.js`): the `DEV`/`devVal()` bootstrap right
  after the environment destructure applies overrides at real control points —
  `applyDevWeapons()` (mutates `GUN_SPECS`), `applyDevEnemies()` (mutates
  `ENEMY_TYPES`), player init, `JUMP_*`/`THIRD_PERSON_*` consts, camera
  near/far + the FOV block, `getWave*Scale`, and `getDevSpawnPositions()`.
- **World hooks** (`environment.js`): reads `rb-dev-active-v1` directly (classic
  script) to override `MAP`/`CELL` and lighting profile/colors.
- **Live apply (no reload):** `dev.html` writes the snapshot → the game tab's
  `storage` listener (`devReapply`) hot-applies **every** category in place via
  idempotent appliers that reset from captured bases (`GUN_SPECS_BASE`,
  `ENEMY_TYPE_BASE`, `PLAYER_BASE`) — player/camera/weapons/enemies/gameplay/
  spawn/lighting/debug/quality-caps all update live. Only **map** (geometry
  rebuild) and **quality.renderer** (GPU backend swap) reload the tab.
- Tests: `.tools/dev-console.spec.cjs`, `.tools/dev-game-boot.spec.cjs`;
  engine unit harness runs headless with mocked `localStorage`.

## Collision System

**Interior** (environment.js):
- `wallAt(mx, my)` — checks MAP grid character (`#` = wall, `.`/`+` = open)
- `wallAtWorld(x, z)` — converts world coords → map cell → `wallAt`
- `wallAtWorldRadius(x, z, radius)` — samples 9 points around a circle, returns true if any hits a wall
- `window.__extWallAt` — optional hook; if set, `wallAtWorld` delegates to it when coords are outside MAP bounds (exterior zone)

**Exterior** (exterior_map.js):
- Sets `window.__extWallAt(x, z)` with AABB checks against registered building footprints + boundary walls

**Player collision** (three_fps_game.js ~line 9826):
```js
if (!wallAtWorldRadius(nx, yaw.position.z, r) && !propBlocksAt(...)) yaw.position.x = nx;
if (!wallAtWorldRadius(yaw.position.x, nz, r) && !propBlocksAt(...)) yaw.position.z = nz;
```

## MAP Grid

`environment.js` defines a 34×41 character grid. Cell size = 4 world units.
- `#` = solid wall
- `.` = open floor
- `+` = doorway (open, but narrower than a full cell visually)

South wall (row 40) has three `++` exits into the exterior zone, matching the three interior room columns.

World origin: MAP center is approximately x=0, z=42. Player spawns near the center.

**World-to-map conversion:**
```js
mx = floor(x / CELL + MAP_W/2)   // x: -66 → 66 maps to mx: 0 → 33
my = floor(z / CELL + MAP_ANCHOR_H/2)  // z: -38 → 122 maps to my: 0 → 40
```

## Key Objects / Globals

| Name | Where | What |
|------|--------|------|
| `yaw` | game.js ~277 | Player root (rotates with mouse X, holds camera) |
| `pitch` | game.js | Child of yaw, rotates with mouse Y |
| `camera` | game.js ~270 | THREE.PerspectiveCamera, child of pitch |
| `weapon` | game.js | Current FP weapon viewmodel (child of camera) |
| `weaponAnim` | game.js | Spring-physics animation state for FP gun |
| `thirdPerson` | game.js | TP character rig, `.enabled` flag |
| `viewState.ads` | game.js | 0→1 ADS blend (used for FOV + gun pose) |
| `game.state` | game.js | `"idle"` / `"playing"` / `"transition"` / `"gameover"` |
| `game.wave` | game.js | Current wave number |
| `enemies[]` | game.js | Active enemy array |
| `currentGun` | game.js | `GUNS.RIFLE` / `GUNS.SHOTGUN` / `GUNS.SNIPER` |
| `gunState` | game.js | Live gun state (mag, ammo, cooldown, reloadTimer) |
| `cameraFX` | game.js | `{ shake, recoil, roll, targetFov }` spring values |
| `allGuns` | game.js | `{ rifle, shotgun, sniper }` gun states keyed by type |
| `player` | game.js | `{ hp, xp, speed, sprintSpeed, stamina, jumpVel, ... }` |

## Enemy System

`enemies[]` holds all live enemy objects. Drone enemies have:
- `mesh` — THREE.Group in scene
- `hp`, `maxHp` — health
- `hpBar` — overhead HP bar mesh
- `type` — enemy type definition from `ENEMY_TYPES`

**Enemy lifecycle:**
1. `getWaveEnemyCount(wave)` → how many this wave
2. `spawnEnemies(wave, options)` → async, places enemies from pool or creates new
3. `prepareEnemyForSpawn(enemy, x, z, wave)` → resets stats, positions enemy
4. `recycleEnemyToPool(enemy)` → removes from `enemies[]`, returns to pool
5. `pendingEnemyDeaths[]` → deferred kill processing queue (flush before wave transitions)

**Important:** Clear `pendingEnemyDeaths.length = 0` before `spawnEnemies()` on wave 1 restart, or stale death records corrupt kill counts.

## Weapon System

**Adding a new gun:**
1. Add to `GUNS` enum in `modules/gun_config.js`
2. Add spec to `GUN_SPECS` in `modules/gun_config.js`
3. Add geometry in `createWeaponViewModel(gunType)` (three_fps_game.js ~2587)
4. Add to `allGuns`, `gunUpgradeLevels`, `firstPersonWeaponCache` initialization

**FP gun animation pipeline (runs every frame ~line 10570):**
1. Reset: `weapon.gun.rotation.copy(weaponAnim.baseRot)` (always canonical `{0, π/2, 0}`)
2. Apply ADS pose blend (`aimPose` × `viewState.ads`)
3. Add bob/sway (only when moving)
4. Add recoil spring values
5. Add reload animation
6. Add melee arc

**Sniper ADS:** Near clip plane blends from 0.05 → 0.93 as `viewState.ads` rises, which clips the gun geometry out of view (clean scope zoom, no moving the gun).

## Reload staging (third-person)

The reload reads as a real mag change: the **left (support) hand cradles the gun**
while the **right hand carries a fresh clip into the mag well**. In
`updateThirdPersonWeaponPose` the grip anchor biases from the two-hand centre to
the left hand during reload (so the gun no longer drags toward the right hand as
it pulls away), and `updateThirdPersonReloadClip` shows a detached clip (cloned
from the gun's own `mag`) travelling from the right-hand bone into the seated
mag-well world position, hiding the gun's own mag mid-transit and restoring it on
seat. Timing is keyed off `reloadT` so it stays in lock-step with the character's
reload animation clip. Diagnose with `window.__rbReload()` (hand/gun/clip world
positions + visibility). Note: the TP rig/weapon only exists once the character
model finishes loading (~3 s) — it's absent very early in a session.

## View Mode (third-person only)

First-person is **removed**: `const THIRD_PERSON_ONLY = true` (~line 675) forces
the over-shoulder camera always on. It makes `setThirdPersonEnabled` ignore
`false`, `toggleThirdPersonView` a no-op, `shouldUseFirstPersonAdsView()` return
`false` (ADS stays in TP), and `thirdPerson.enabled` default `true`. The FP
viewmodel/body is never shown (also saves its per-frame work). Set the flag
`false` to restore switchable FP/TP. Diagnose with `window.__rbView()`.

## Performance notes (perf-critical)

- **Cinematic post-processing is OFF by default** (`cinematicState.enabled =
  savedSettings?.cinematic === true`, ~line 1259). It runs 3–4 full-screen shader
  passes/frame (RenderPass + grade + chroma + output) — a big fill cost on weak
  GPUs. Opt in via the pause-menu toggle (persists `savedSettings.cinematic`).
- The frame is bound by **both** CPU draw-issue (~760 draws) **and** GPU fill;
  lowering render scale alone doesn't help (that's the tell). Levers: fewer
  real-time lights (`window.__rbCountLights()`), fewer draws, post-FX off.
- Diagnostics: `__rbTest.getFrameStats()` now returns `jsUpdateMs` (game logic)
  and `jsFrameMs` (logic + render-issue, excludes GPU). Small jsFrameMs + long
  frame ⇒ GPU-bound; large jsFrameMs ⇒ CPU/draw-issue bound.
- **Never raycast against `wallMeshes` every frame.** The walls are merged into a
  few large meshes, so `raycaster.intersectObjects` tests thousands of triangles.
  The third-person camera's four collision probes cost ~9 ms/frame this way.
  `resolveThirdPersonCameraPosition` now marches the MAP grid instead
  (`firstWallHitDistance` → `wallAtWorldRadius`). Per-shot raycasts are fine.
- Adaptive render scale recovers above **57** fps, not 61: `requestAnimationFrame`
  is vsync-capped at ~60, so the old `> 61` test never fired and the scale only
  ever ratcheted **down** — one hitch left the game permanently at min resolution.

## The visible-light count is a shader-cache invariant (read before touching lights)

three bakes the number of **visible** lights into every shader (the light loops are
unrolled, one iteration per light — `NUM_POINT_LIGHTS` is text-substituted, not a
uniform). **If that count changes at runtime, every material in the scene misses the
program cache and relinks**, and these shaders take ~400 ms each to link. That is
what made "New Mission" freeze for ~10 s: the count swung 6→8→13→17 as things spawned.

Rules:
- **Turn a light off with `intensity = 0`, never `visible = false`.** `gunFlash` and
  the player flashlight already follow this.
- A light is counted only if **it and every ancestor** is visible. So a light parented
  to a group whose visibility toggles (an effect, an enemy) changes the count too.
- **Do not give pooled/spawned objects their own real-time lights.** Enemies, beams and
  bolts enter and leave the scene constantly. The lightning pool shares one permanent
  scene-level light (`getSharedLightningLight`, driven by the brightest live bolt);
  enemy aura / megaBlast / angel / Warden / car lights were all removed for this reason.
- `window.__rbCountLights()` reports the count **as three sees it** (ancestor-aware).
  **It must not change while playing.** `.tools/shader-stability.spec.cjs` asserts that,
  plus that starting a mission compiles **zero** new GL programs.

`compileAllWarmables()` (called from `compileStartupScene`) links everything up front:
`renderer.compile()` walks the whole graph, but only for objects actually **in** it, so
the pooled enemies are spliced in for the compile. It only works while the light count
stays fixed afterwards.

## Boot readiness gate

`bootGame()` takes ~15–60 s (world, exterior, enemy pools, shader warm). The menu's
reveal animation in the HTML has its own **watchdog timer** that used to show the Start
button at 5.2 s — mid-boot. Clicking it ran wave 1 against a half-built scene while every
shader was still linking, which is what "it freezes the second we click new mission"
actually was.

- `bootGame()` sets `bootComplete` and `document.body.dataset.rbReady = "1"` when done.
- `beginMission()` returns early unless `bootComplete`.
- The HTML watchdog polls for `body[data-rb-ready]` before revealing the menu (with a
  120 s hard cap so a broken boot still surfaces the UI). Patched in **both**
  `index.html` and `first_person_shooter_room_game (1).html`.
- **Tests must wait on `document.body.dataset.rbReady === "1"`**, not on
  `#loading-screen.hidden` and not on a fixed delay.

## Camera & FOV

| State | FOV |
|-------|-----|
| FP walking | 90° |
| FP sprinting | 100° |
| TP walking | 63° |
| TP sprinting | 70° |
| Rifle ADS | 68° |
| Shotgun ADS | 74° |
| Sniper ADS | 18° |

`camera.far` = 480 (covers full interior + full exterior zone).

## Lighting Architecture

See **"The visible-light count is a shader-cache invariant"** above before adding,
removing, or toggling any light.

**Interior** (environment.js `setupEnvironmentLighting`):
- `AmbientLight(0xfff4e4, 0.55)` — warm floor for all tiers
- `HemisphereLight(sky, ground)` — gradient fill
- `DirectionalLight` — ceiling fill
- Up to 9 `PointLight`s selected from `ROOM_LIGHTS` array by score
- Bounce lights at floor level, decay=2.0 (inverse-square, soft)
- Point light decay = 2.0 (changed from 3.5 to prevent black far zones)

**Exterior** (exterior_map.js):
- Three.js `Sky` shader (physically-based Rayleigh/Mie scattering)
- `HemisphereLight` (sky/ground tones)
- `DirectionalLight` (sun)
- Emissive building windows + car light housings for ambient glow (no real lights)
- **Car head/tail lights are DISABLED** (`CAR_LIGHTS_ENABLED = false` in `buildCar`):
  7 cars × 2 `PointLight`s = 14 real-time lights added huge per-fragment forward-
  lighting cost across the daytime arena for ~zero visible gain. Flip to `true`
  for a night build. Diagnose light cost with `window.__rbCountLights()` (logs
  a per-owner PointLight breakdown — WebGL evaluates every light per lit fragment,
  so light COUNT is a primary FPS factor).

## Renderer Backend (perf-critical)

Backend is chosen in the renderer-selection block (~line 280) and is **device-aware**:
- `auto` (default): **desktop → WebGL**, **mobile → WebGPU-first** (WebGL can hit
  mobile shader limits and render black).
- **Why:** three r166's experimental WebGPU issues ~100× the draw calls of WebGL
  for this scene on many desktop GPUs (measured **43,800 vs ~424 draws**, ~16 fps
  vs smooth). The scene geometry is already well-optimized (InstancedMesh +
  per-material merge via `collapseStaticDrawCalls` / exterior `flushBuckets`); the
  bottleneck was the backend, not the geometry.
- Override precedence: `localStorage.rb_renderer` (`webgl|webgpu|auto`) >
  legacy `rb_force_webgl=1` > dev-console `quality.renderer` > `auto`.
- `maybeAutoFallbackRenderer()` (in `updateAdaptiveQuality`) self-heals a slow
  WebGPU session: <30 fps at min render scale for ~4 samples → persist WebGL +
  reload once (guarded by `sessionStorage.rb_autofb_done`).
- Diagnostics: `window.__rbDraws()` logs per-group draw counts; `.tools/perf-probe.spec.cjs`
  dumps the steady-state breakdown.

## Post-Processing / Cinematic Mode

Custom `CinematicGradeShader` (GLSL in three_fps_game.js ~line 575):
- Vignette, film grain, halation, tone mapping, teal shadow push
- Toggled by `cinematicState.enabled`
- Cinematic FP FOV offset: `-4°` (slightly narrower feel)

## Common Gotchas

1. **`captureWeaponAnimationBases` must be called on clean rotation.** The function resets `weapon.gun.rotation` to `{0, π/2, 0}` before saving. Never call it while recoil/pack-a-punch animations are mid-flight or the gun permanently drifts.

2. **Fog vs darkness.** There is no Three.js fog (`scene.fog = null`). "Dark far zones" were caused by point light decay=3.5 and camera.far=200. Both fixed. If darkness returns, check `setupEnvironmentLighting` decay and `camera.far`.

3. **Enemy wave 1 spawn.** `warmFirstWaveEnemyInstances()` pre-warms GPU shaders with hidden enemies. `activatePrimedFirstWave()` makes them visible. Both must be called in sequence from `beginMission()`. Do not recycle pre-warmed enemies back to pool.

4. **Gun flash through player model.** `gunFlash` is a `PointLight` child of `camera`. In TP mode, it repositions to the TP weapon muzzle world position each frame. If you see glow bleeding, check the TP branch in `updateWeaponVisuals()`.

5. **Jump animations.** All jump types (spacebar-only, strafe, forward) use `jumpForward` animation clip. `jumpNeutral` fallback was replaced with `jumpForward`.

6. **Death screen.** The `#state-overlay` div needs `.active` class to become visible. CSS is now present in the HTML file. The JS correctly calls `stateOverlay?.classList.add("active")` in `endGame()`.

7. **`wallAtWorldRadius` is destructured in three_fps_game.js.** To extend collision (e.g., for the exterior), patch `wallAtWorld` in `environment.js` source — the destructured reference closes over it and will pick up the change automatically.

## Testing Checklist

Before a build:
- [ ] Wave 1 spawns 1 drone, stays visible
- [ ] Wave transitions work (kill counter matches spawn count)
- [ ] All 3 guns fire, ADS, reload correctly
- [ ] Sniper ADS: gun disappears, FOV zooms to 18°
- [ ] Death screen appears with stats + Restart/Quit buttons
- [ ] Sprint bob is faster than walk bob
- [ ] Jump always uses `jumpForward` animation
- [ ] TP mode: over-shoulder camera, no gun sway visible
- [ ] FP mode: gun sway only when moving (not idle)
- [ ] Cinematic mode: vignette, grain, no black bars
- [ ] Pack-a-punch: dramatic effect, gun doesn't permanently rotate
- [ ] Exterior zone: player can walk through south exits
- [ ] Exterior sky renders correctly (Three.js Sky shader)
- [ ] No muzzle flash bleeding through player model

## Adding New Features

**New enemy type:**
1. Add entry to `ENEMY_TYPES` array with mesh, HP, speed, AI profile
2. `getWaveEnemyCount` and `spawnEnemies` pick types by wave number

**New exterior prop:**
1. Add geometry in `exterior_map.js` inside the relevant zone builder
2. Call `addCollider(cx, cz, width, depth)` if it should block the player

**New gun upgrade level:**
1. `MAX_PACK_LEVEL` constant controls max level
2. `applyGunUpgradeStats(gunType, announce)` applies stat multipliers per level

**Networking (multiplayer):**
- PeerJS WebRTC in `modules/netcode.js`
- Lobby code: `net.host()` / `net.join(code)`
- State sync: `broadcastVisualFx()`, `broadcastPlayerState()` helpers in game.js
- Coop ghost players rendered via `thirdPersonGhosts` map

## Quick Fixes

```js
// Force a specific wave for testing:
game.wave = 3;
beginMission();

// Spawn enemy at position:
spawnEnemies(game.wave, { minDistance: 5, preferVisible: true });

// Give player infinite ammo:
player.unlimitedAmmo = true;

// Trigger pack-a-punch:
attemptPackUpgrade();

// Go to exterior:
yaw.position.set(0, PLAYER_H, 135);  // just south of interior exit
```
