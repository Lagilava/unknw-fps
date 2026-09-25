# UNKNW (Room Breach FPS) — Claude Code Helper

## Project at a Glance

Browser third-person wave shooter built on **Three.js r166**, branded **UNKNW** (internal APIs still say RoomBreach — deliberate, see Rebrand note). Core game logic lives in one large async IIFE in `three_fps_game.ts`. Environment geometry and collision live in `environment.js`. All game code lives under **`src/`**; `assets/` (textures/, hdri/, audio/, world/, zombies/, landmarks/, models/ — ~440MB of FBX/GLB/audio) is kept as a **sibling of `src/`**, not inside it, and `docs/` holds the written documentation. The repo root otherwise holds only config files (`package.json`, `vite.config.ts`, `tsconfig.json`, `playwright.config.cjs`, `.gitignore`) and the double-click launcher scripts (`Start Internet Multiplayer.bat`, `run_http.bat`, `run_internet.bat`, `start-multiplayer.ps1`, etc.) — those stay at root on purpose so testers can launch the game without opening the repo.

**Two entry points, both live:**
- `src/index.html` — the real entry. Vite (`root: 'src'` in `vite.config.ts`) resolves the
  bare `three` / `peerjs` imports, so it needs a dev server: `npm run dev` (then `/` — Vite's
  root already points at `src/`). There is no importmap.
- `src/first_person_shooter_room_game (1).html` — legacy standalone copy with an importmap,
  served by `src/tests/static-server.cjs` on :8000 (root = repo root, so it can also reach
  `assets/`; browse it at `/src/first_person_shooter_room_game (1).html`, **not** `/`).
  **The Playwright specs use this one.**

Both load the same `three_fps_game.ts`, so a game fix applies to both — but HTML/CSS
changes (e.g. the menu-reveal watchdog) must be made in **both** files.

Every runtime string path to `assets/` (in `src/modules/asset_paths.ts`, `audio_assets.ts`,
`landmarks.ts`, `zombie_assets.ts`, `intel_gallery.ts`, and a few call sites in
`three_fps_game.ts`/`environment.js`/`exterior_map.js`) is written `../assets/...` — one level
up from wherever the HTML entry point sits, since assets/ is a sibling of `src/`. These are
plain runtime strings passed to loaders (not ES import specifiers), so they resolve against
the **page's URL**, not the file that contains the string — the same `../assets/` prefix is
correct everywhere in `src/`, regardless of how deeply the containing file is nested under it.

```
Room breach fps11/
├── src/
│   ├── index.html                             ← Entry point (Vite root)
│   ├── first_person_shooter_room_game (1).html ← Legacy entry (importmap); used by tests
│   ├── three_fps_game.ts                      ← Main game loop, weapons, AI, networking (~24 000 lines)
│   ├── environment.js                         ← MAP grid, arena geometry, lighting, collision math
│   ├── exterior_map.js                        ← Outdoor street/plaza zone (procedural)
│   ├── server.js                              ← LAN/internet multiplayer server (launched via the root .bat/.ps1 scripts)
│   ├── menu_halo.css                          ← Halo-CE-style menu shell stylesheet
│   ├── dev.html                                ← Standalone Developer Console (preset UI, dev-only)
│   ├── model_preview.html                     ← Standalone character/animation inspector
│   ├── modules/
│   │   ├── gun_config.ts                      ← GUN_SPECS (damage, ammo, spread, recoil, ADS FOV)
│   │   ├── dom_ui.ts                           ← getHudElements(), getMenuElements(), loading controller
│   │   ├── netcode.ts                          ← WebRTC peer-to-peer via PeerJS (+ optional TURN)
│   │   ├── asset_paths.ts                      ← Texture/model URL constants
│   │   ├── audio_assets.ts                     ← SFX/VO manifest (Kenney packs + TTS announcer)
│   │   ├── settings.ts                         ← Persistent localStorage settings
│   │   ├── dev_engine.ts                       ← Developer preset engine (schema, presets, resolve/apply)
│   │   ├── dev_presets.ts                      ← Built-in preset library for the dev console
│   │   ├── landmarks.ts                        ← GLB landmark manifest (city skyline, statue)
│   │   ├── storm_warden.ts                     ← Procedural skinned Warden/Seraph/Cherub character rig
│   │   ├── zombie_character.ts                 ← Skinned Mixamo zombie controller (clip layering)
│   │   ├── zombie_assets.ts                    ← Zombie model/animation asset list
│   │   ├── model_editor_state.ts               ← Model-editor persistence
│   │   ├── sjm.js                              ← F8 diagnostics overlay (clone movement)
│   │   └── three_loaders.ts                    ← GLTFLoader / FBXLoader helpers
│   ├── scripts/                                ← optimize-textures.mjs, convert-zombie.mjs
│   └── tests/                                  ← Playwright specs + static test server (was `.tools/`)
├── assets/                                     ← textures/, hdri/, audio/, world/, zombies/, landmarks/, models/ (sibling of src/, not inside it)
├── docs/                                       ← DEV_MANUAL.md, DESIGN.md, and other written docs
├── vite.config.ts                              ← Build (root='src'; copies environment/exterior/sjm.js/assets into dist)
├── package.json / tsconfig.json / playwright.config.cjs / .gitignore
└── Start Internet Multiplayer.bat / run_http.bat / run_internet.bat / start-multiplayer.ps1 / ...
    ← double-click launchers, kept at repo root on purpose (testers shouldn't need to open the repo)
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
  The equipped weapon becomes the **incinerator** (flamethrower) — see below.
  **The player is in god mode for the whole blackout wave** (`blackoutGodMode()`:
  `damagePlayer`, `applyCoopTargetDamage` — returns "no local hit", so no flash /
  debuff / streak reset — the co-op guest `edamage` handler, and auras). Test hook
  `__rbTest.isGodMode()`.
- **Blackout incinerator**: during a blackout the weapon is a continuous
  flamethrower, not an inventory item (no mag, no reload, locked weapon switch).
  `fireGun()` steps aside entirely; `updateFlamethrower(dt)` owns the trigger.
  The stream, its impact splash, residue, burn and pilot effects and its light
  all live in **`modules/flame_jet.ts`**, which **`src/fx_lab.html`** drives
  against the same particle system — tune the look in the lab, never in the
  game. **Every fire number is in `FLAMETHROWER_CONFIG`** (particle_fx.ts holds
  no flame presets; flame_jet registers them via `definePreset`/`defineEffect`).
  - The stream is **thrown from the muzzle**: real projectiles at ~25 m/s with
    drag, spawned with sub-frame interpolation of the muzzle's position/aim, so
    it starts narrow and hot and widens, cools and breaks up downstream, and a
    swing bends it like a hose. (It used to SEED particles at their final spots
    along the ray — nothing travelled, and from the camera 2 m behind the nozzle
    the whole depth stacked into a white fireball.) Smoke and embers fly with
    it invisibly (`fadeInAt`) and appear only downstream. Surfaces cost nothing
    per particle: each gets a closed-form cutoff age at which it stalls.
  - `updateFlamethrower` runs **after** `updateThirdPersonCharacter` (so it
    reads this frame's muzzle) and **right before** `updateParticles` — the
    order `spawn()`'s sub-frame placement assumes.
  - Quality tiers (`FLAMETHROWER_CONFIG.quality`, live-particle budgets):
    low/medium/high ≈ 90/165/270 live particles. Picked from the device tier;
    override with `?fireQuality=` or `__rbFlameQuality(q)`. Live-tune the
    running game with `__rbFlameTune({...})` (not persisted). Gameplay does not
    follow the particles: damage stays one cone test on a 15 Hz tick. Enemies get a
  `burnTimer` DoT that keeps resolving after the lights come back. Sound is a
  sustained synth voice (three LFO-modulated noise bands) whose gain and cutoffs
  track the same throttle the visuals do. Diagnose with `window.__rbFlame()`;
  `__rbFlame(frames)` steps emitter + particles together to build a real 60 fps
  steady state inside one frame, and a second `true` renders and returns a PNG
  data URL in the same task, recording whole-frame renderer stats in
  `.lastCapture`. The info also reports muzzle/dir/reach/camera, the fire light,
  the impact point, per-component live counts (`.jet`) and the render path
  (`.render`). Tests: `src/tests/weapons/blackout-flamethrower.spec.cjs`,
  `src/tests/weapons/fx-lab.spec.cjs` (asserts the stream travels, stays
  attached to the nozzle, keeps smoke downstream, and respects tier budgets).
- **Residue fire**: every surface contact deposits a burn patch (`flame_jet.ts`
  `deposit`/`updateResidue`, pooled, `FLAMETHROWER_CONFIG.residue`, live cap per
  quality tier) that keeps emitting
  `flameResidue` for ~1–2 s after the jet leaves; ceilings excluded, no lights.
  `updateResidue` runs at the top of `updateFlamethrower`, before any early-out.
- **Cinematic grade in a blackout**: `CINEMATIC_BLACKOUT_GRADE` neutralises the
  daytime curve (black crush, contrast, darken, CSS brightness 0.74, most of the
  shadow tint) — stacked on a ~0.15-luma frame it rendered pitch black / green.
  `applyWaveLighting` re-applies it on every blackout toggle (uniforms only).
- **The fire lights the world by REUSING `gunFlash`.** While the jet runs, that
  existing permanent PointLight (never a shadow caster) is recoloured, gently
  flickered and parked ~3 m down the stream instead of at the muzzle. This is not an optimisation — creating a
  light for the fire would relink every shader in the scene (see the light-count
  invariant below). The blackout exposure also lifts with the jet's flicker.

### `src/fx_lab.html` — the VFX lab (dev-only, like `dev.html`)

A continuous effect **cannot be judged from one still at one angle**, and the
game needs ~40 s of boot to reach a blackout wave. The lab loads the real
`particle_fx.ts` + `flame_jet.ts` into a small dark room with lit blocks and
steps everything by hand, so a headless browser at 2 fps produces the same image
as a desktop at 144. Iteration is ~3 s instead of ~90 s.
`http://127.0.0.1:8000/src/fx_lab.html` (via `src/tests/static-server.cjs`).
- **It renders through the game's pipeline by default** (`__fxLab.pipeline("game")`:
  HDR composer → bloom at the cinematic values → output tone map, at blackout
  exposure 1.3). The game sums additive fire in linear HDR and tone-maps once;
  the canvas path (`"direct"`) tone-maps each sprite and shows saturated colour
  the game washes to peach. The fire was once tuned on the wrong one.
- The lab does NOT include the cinematic grade (bleach-bypass, halation); that
  global look desaturates bright fire further. Check in-game with the
  `#cinematic-toggle` on and off.
- `__fxLab.step(n)` / `settle(n)` — advance fixed 60 fps frames
- `__fxLab.shot(view, frames)` — render + read back a PNG **in the same task**
  (the next real frame would age the jet past most particles' lifetimes)
- `__fxLab.view(name)` — `gameplay`, `side`, `threeQuarter`, `top`, `headOn`,
  `closeLow`; a cone fired away from the viewer needs all of them. `gameplay`
  is the real third-person geometry measured in-game (lens 1.7 m behind, 0.8 m
  right of, 0.4 m above the muzzle).
- `__fxLab.set({...})` — live-tune `FLAMETHROWER_CONFIG` (deep merge + re-register)
- `__fxLab.quality(q)`, `setWall(d)` (0 = open air), `motion({vx, vz, yawRate})`
  (walk / strafe / whip-pan while firing), `stats()` (per-component counts)
- `__fxLab.atlasSheet()` — labelled 4×3 contact sheet of every particle mask.
  When a stray silhouette shows up, this identifies the tile in one shot instead
  of guessing which preset is responsible. It found two real bugs.

### particle_fx gotchas (read before authoring any effect)

Earned the hard way on the flamethrower:
1. `emit()`'s `scale` multiplies particle **speed** as well as size, so it cannot
   grow an effect along its length — it accelerates the far end into an
   exploding cloud.
2. `hard` is a falloff **exponent**, applied as `pow(a, hard*0.5)` and only to
   shape 0 and the fire masks (8–11). **Below ~2 it flattens a mask outward**
   toward its square sprite bounds: authored silhouettes dissolve and you see the
   rotated quad as a diamond edge. Above 2 it tightens into a bright core.
3. **Shapes 1 and 8 are the only masks the vertex shader rotates to the
   particle's screen-space velocity.** They are the only way to get marks that
   follow the flow — which is most of what separates fire from drifting blobs.
4. **Mask silhouettes must stay amorphous.** Perimeter noise that is large
   relative to the radius makes harmonics line up into arms/points, and since
   one mask is reused hundreds of times the viewer reads a flock of identical
   birds. Shape 4's periodic `sin()` grain likewise tiles into a honeycomb once a
   particle is metres across. Presets that use the ragged blob set `shapeAlt` so
   each particle picks between two variants.
5. There is a **near-camera alpha fade** (`smoothstep(0.30, 1.90, -mv.z)` in the
   vertex shader). Close up a sprite fills the screen and the viewer reads the
   mask instead of the effect; this matters here because the third-person camera
   sits only a few metres behind the muzzle.
6. The GLSL lives in template literals — **no backticks in shader comments.**
7. **The "additive" layer is premultiplied** (`One, OneMinusSrcAlpha`); a
   preset's `occlusion` (0..1) says how much it also covers what is behind it.
   0 is exactly the old additive result (sparks, energy). Fire needs ~1: pure
   additive flames stacked in the game's HDR composer sum past 1 and the grade
   washes them white; "over" blending converges to `colour / occlusion`.
8. Continuous emitters use `spawn()` (one particle, explicit velocity, sub-frame
   `age`, surface `cut` age, zero allocation). A spawned particle's FIRST
   `update()` does not move or age it — it is already where it belongs for this
   frame's render; advancing it would open a speed×dt gap at the emitter.
9. Other per-preset knobs: `colorMid` (3-stop colour ramp), `sizePow` (growth
   curve), `fadeInAt` (invisible until a life fraction), `turb` (coherent
   turbulence that grows with age), `cutKeep`/`cutLife`, `tag` (live counts).
- **Relay objective placement is randomised.** `beginRelay` floods the whole
  reachable region and weight-samples a cell from a depth band, penalising the
  last two relay sites, instead of taking whatever cell BFS visited last. A
  screen-space **waypoint** (`updateRelayWaypoint`, a JS-created `#relay-waypoint`
  so both HTML entry points get it) tracks the portal, pins to the screen edge
  with a bearing caret when off-screen, and shows distance / upload %.
  Diagnose with `window.__rbRelay()`.
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

## Menu shell (Halo CE style) — `menu_halo.css`

The main menu and loading screen are a **Halo: Combat Evolved** homage built on the
game's own assets. One shared stylesheet, `menu_halo.css`, is linked **last** in both
HTML entry points and overrides the older two-column menu; panel *internals*
(`.ov-panel-title`, `.flow-card`, `.loadout-card`, `#mp-panel`) are untouched.

- **Loading screen**: pure black, "UNKNW" glowing blue, status + percent + a hairline
  bar under it. All the legacy chrome (grid, rings, brackets, segment strip,
  platform/build footer, the card behind the wordmark) is hidden. The legacy sheet
  sets `.ls-title-breach` colour with `!important`, so the override needs it too.
- **Main menu**: `#overlay` is transparent and the **live game scene renders behind
  it** — `menuCam` (a second camera, so the player rig is never touched) slowly orbits
  the plaza statue, framed by measuring the real model (`frameMenuSubject()` off
  `perkMachineState.station`) and aimed off-centre so the list sits on open sky.
  Diagnose with `window.__rbMenuCam()`.
- `menuBackdropActive()` requires `bootComplete`, the overlay visible, and
  `overlay.dataset.mode !== "pause"` — **pausing keeps the frozen gameplay view.**
  It renders through the composer (camera swap only, never a pipeline swap) so post
  passes stay compiled; the first `MENU_WARM_FRAMES` frames render the player camera.
- **Panel state lives on `overlay.dataset.panel`.** `"root"` = the Halo landing state
  (list only, no sub-screen); CSS keys off `#overlay[data-panel="root"]`. Nav order:
  New Mission / Multiplayer / Loadout / Briefing / Settings / Intel Records /
  Model Editor / Quit. ↑/↓/Enter drive the list, Esc backs out of a sub-screen —
  that listener is **capture-phase and calls `stopPropagation()`**, or the same Esc
  press would also hit the game's pause/resume handler.
- The HUD is hidden whenever `<body>` lacks `gameplay-view` (it used to be covered by
  the opaque menu).

### Settings screen (`#settingsPanel`)

Video / Audio / Controls, all applied live and persisted via `saveSettings`:
- **Video** — renderer backend (`localStorage.rb_renderer`, reloads), resolution cap
  (`quality.maxScale`), brightness (`userBrightness` → `baseToneMappingExposure`),
  FOV offset (`userFovOffset`, cancelled out as ADS blends in), cinematic FX (drives
  the legacy hidden `#cinematic-toggle` so the PvP lock stays authoritative), perf overlay.
- **Audio** — master plus three **real Web Audio sub-buses** (`weapons` / `voices` /
  `world`) feeding the compressor. Synth voices pick a bus through `connectWithPan`,
  which reads an ambient `sfxCategory` set by `inSfxCategory(...)` at the few call
  sites that own a category; the Howler sample layer has no graph to splice, so the
  same numbers are folded into per-play volumes (`audioEngine.fire(gun, mul)`).
  Plus mute-when-unfocused.

### Intel Records (`#intelPanel`)

A recovered-document terminal: an index rail of file codes on the left, the selected
record on the right. Each of the eight records is a **different kind of document**
(incident log, works drawing, field survey, signal intercept, asset tag, observation
series, personnel roster, threat assessment) with its own metadata fields and voice —
that variety is the point, an earlier version read as eight identical prose boxes.
Selection is wired by `installIntelRecords()`.

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
- Tests: `src/tests/dev/dev-console.spec.cjs`, `src/tests/dev/dev-game-boot.spec.cjs`;
  engine unit harness runs headless with mocked `localStorage`.

## Collision System

**Interior** (environment.js):
- `wallAt(mx, my)` — checks MAP grid character (`#` = wall, `.`/`+` = open)
- `wallAtWorld(x, z)` — converts world coords → map cell → `wallAt`
- `wallAtWorldRadius(x, z, radius)` — samples 9 points around a circle, returns true if any hits a wall
- `window.__extWallAt` — optional hook; if set, `wallAtWorld` delegates to it when coords are outside MAP bounds (exterior zone)

**Exterior** (exterior_map.js):
- Sets `window.__extWallAt(x, z)` with AABB checks against registered building footprints + boundary walls

**Player collision** (three_fps_game.ts, in the movement resolver):
```js
if (!wallBlock(nx, yaw.position.z) && !propBlocksAt(...)) yaw.position.x = nx;
if (!wallBlock(yaw.position.x, nz) && !propBlocksAt(...)) yaw.position.z = nz;
```

**Physics-backed collision (Phase 3 — Rapier).** World-geometry collision now runs
through the Rapier physics world (`modules/physics.ts`), not the MAP-grid sampler:
- `buildStaticWallColliders` / `buildExteriorColliders` mirror the interior MAP walls
  and exterior AABB footprints into Rapier as fixed cuboids at boot.
- `physicsBlocksAt(x, z, r)` (a Rapier `intersectionWithShape` ball query) replaces
  `wallAtWorldRadius` inside the **player** movement resolver (`PLAYER_PHYSICS_COLLISION`)
  and **enemy** `enemyBlockedAt` (`ENEMY_PHYSICS_COLLISION`). Both flags default true;
  set false to revert to the pure grid path. Verified 100% identical to
  `wallAtWorldRadius` across thousands of samples, so the feel is unchanged.
- The movement *integrator* (momentum, jump, axis-sliding, sub-stepping) is NOT on
  Rapier — this is deliberate (query-based collision preserves the tuned FPS feel; a
  full KinematicCharacterController was rejected).
- **`propBlocksAt` stays on its own 3D-aware AABB check** (props have vertical extent —
  you can stand on / jump over them — which a 2D ball query can't model). Grid-native
  systems (pathfinding, LOS sampling) also stay on the MAP grid intentionally.
- Rapier is `@dimforge/rapier3d-compat` (inlined WASM), served locally from
  `node_modules` via the importmaps (CDN was flaky for the 2.2MB module).

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

**Angel hit volumes are bone-anchored** (Warden/Seraph/Cherub, `createDroneMesh`
angel branch). The rig is measured grounded at build time but hovers
`STORM_WARDEN_HOVER` rig units up in play, pitches, scatters its arms/head, and has
no legs — box-derived capsules sat under the body (phantom hits in the air below,
head shots sailing over). Each capsule is `{ bone, a, b, boneRadius, perpW }` in
bone space; `getEnemyShotDistance` resolves it through `bone.matrixWorld` and scales
the radius by the bone's LIVE smallest perpendicular stretch (`boneWorldScale`) —
never bake a scale at build time: the model editor rescales the root there and the
gameplay pulse overwrites `mesh.scale` later. `getEnemyHitCenter` uses the chest
bone (`hitCenterBone`). Verify with `__rbTest.probeAngelHitboxes()` /
`src/tests/ai/angel-hitboxes.spec.cjs` (body coverage, no hits under the body,
visible head → "head").

**Hit feedback:** armour (angel) impacts emit `enemyArmorHit` /
`enemyArmorHeadshot` per pellet (capped at 4/shot) at the real entry point, along
the capsule surface normal, tinted `enemy.hitTint` (= type colour). The rig flares
its plates additively from `enemyRef.hitFlash` (`storm_warden.ts`
`ARMOR_FLASH_PEAK` — keep it low, the whole shell blooms). Damage numbers pop from
the hit point (`spawnDamageNumber` `options.point`).

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

## Particle FX (`modules/particle_fx.ts`)

All particle effects run through **one pooled GPU system costing exactly two draw
calls**, replacing the old pool that allocated a `THREE.Mesh` per particle and so
capped the whole game at 36 particles (36 draws).

- **Two permanent `THREE.Points` layers** added to the scene at boot and never
  toggled: `particleFX:add` (additive — sparks, embers, energy, flash) and
  `particleFX:alpha` (smoke, dust, blood, debris). Particles live in flat SoA
  typed arrays that *are* the GPU attribute buffers; dead slots are parked
  off-screen so the draw range — and the compiled program — never changes.
- **Vocabulary:** `PRESETS` (spark, flash, ember, dust, smoke, debris, bloodMist,
  blood, energy, energyCore) compose into `EFFECTS` (`bulletWall`, `bulletFlesh`,
  `bulletMetal`, `headshot`, `enemyDeath`, `energyImpact`, `explosion`).
  Each preset animates size, colour, alpha and falloff hardness over life, with
  gravity, drag and floor bounce.
- **Call sites:** `spawnImpactParticles(pos, normal, strength, kind)` — the old
  signature still works; the third argument is now a *strength* multiplier (call
  sites always passed fractional values anyway) and the fourth picks the effect.
- **No lights, ever.** Bursts fake their flash with a bright additive `flash`
  particle. See the light-count invariant below — that is why enemy/impact
  lights do not exist.
- **Backend split:** WebGL gets the GLSL point-sprite `ShaderMaterial`; WebGPU
  (mobile default) gets a `PointsMaterial` fallback, because three r166's WebGPU
  backend cannot compile a ShaderMaterial (`sanitizeWebGPUMaterials` strips
  them). Do NOT add `<tonemapping_pars_fragment>` / `<colorspace_pars_fragment>`
  to the shader — three already injects both into every ShaderMaterial prefix and
  re-including them is a "function already has a body" link error.
- **Ageing uses real `dt`; only motion integration uses a clamped step.** Ageing
  on the clamped step made a slow frame hold particles alive proportionally
  longer, so heavy overdraw sustained itself instead of draining.
- **Diagnostics:** `window.__rbParticles()` (live/capacity + per-layer state) and
  `window.__rbFx(kind, distance)` to fire an effect in front of the camera for
  tuning. Test: `src/tests/audio/particles.spec.cjs`.
- **Testing note:** particles age in *game* time and headless Chrome runs this
  scene at ~2.5 fps, so never assert "drained" after a fixed `waitForTimeout` —
  poll with `waitForFunction`.

## Performance notes (perf-critical)

- **Cinematic post-processing is ON by default** (`cinematicState.enabled =
  savedSettings?.cinematic !== false`). It runs 3–4 full-screen shader
  passes/frame (RenderPass + grade + chroma + output) — a big fill cost on weak
  GPUs. Opt out via the pause-menu toggle (persists `savedSettings.cinematic`).
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
  **It must not change while playing.** `src/tests/core/shader-stability.spec.cjs` asserts that,
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
- Diagnostics: `window.__rbDraws()` logs per-group draw counts; `src/tests/perf/perf-probe.spec.cjs`
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


## Interior art direction ? construction in progress

The user wants the original interior map to resemble a building under active construction. Keep exposed cast concrete with formwork seams, unfinished blockwork, dusty dry slabs, plywood hoarding, timber shuttering, exposed reinforcement, and temporary site signs. Avoid finished office ceilings, polished floors, decorative metal wall trim, and glazed storefront styling in this area. The open top represents an unfinished roof, not a finished plaza. Materials live in `src/environment.js`; preserve the existing navigation/collision grid and three exits when doing surface passes.
