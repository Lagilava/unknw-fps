# UNKNW / Room Breach — Developer Console & Engine Manual

A complete guide to the developer customization system: a preset-driven
configuration engine that lets you tune, save, load, export, import, and reset
almost every aspect of the game **from a dedicated UI, without editing source
code**.

---

## 1. What this is

The developer system has three parts:

| Part | File | Role |
|------|------|------|
| **Dev Engine** | `modules/dev_engine.js` | The centralized, versioned config core. Owns the schema, defaults, validation, presets, layering, and the resolved snapshot. |
| **Dev Console** | `dev.html` | A standalone developer-only UI (not in the game menu). Full CRUD over presets with sliders, inputs, toggles, array editors, JSON import/export. |
| **Game hooks** | `three_fps_game.js`, `environment.js` | Read the resolved snapshot at load and apply overrides at the game's real control points. |

**Design contract:** _the game behaves exactly as before unless you activate a
preset._ Only categories you explicitly turn on are applied; everything else
falls through to the game's built-in constants, byte-for-byte.

---

## 2. Opening the console

1. Serve the project (`npm run dev`, `node server.js`, or any static server).
2. Open **`/dev.html`** in a browser tab.
3. Open the **game** (`/index.html`) in a *second tab* of the same origin.

The console and the game share the browser's `localStorage`. When you save in
the console, the game tab is notified through a `storage` event and updates
(hot-apply for cheap toggles; a quick auto-reload for structural changes). Keep
both tabs open side-by-side for a live-editing workflow. The **▶ Open game tab**
button in the console footer opens the game for you.

> The console is intentionally **not** reachable from the in-game main menu — it
> is a developer tool that lives on its own page.

### 2.1 The Starter pack
The build ships a **Starter** preset pack (`modules/dev_presets.js`) covering
Lighting, Camera, Weapons and Player. The **first time** you open `dev.html` it
seeds those four presets and activates them once, so the supplied tuning is live
immediately (an open game tab hot-applies it; otherwise it applies on the game's
next load). It seeds only once — later edits/deactivations are never clobbered.
Re-apply any time with the footer **★ Apply Starter pack** button. To force a
re-seed, clear `localStorage.rb-dev-starter-installed`.

---

## 3. Core concepts

### 3.1 Categories
Configuration is split into ten categories:

`player` · `camera` · `weapons` · `enemies` · `gameplay` · `spawn` ·
`lighting` · `map` · `quality` (Performance) · `debug`

### 3.2 Presets
A **preset** is a named, full set of values for one category. Every category
ships with a protected **`Default`** preset that mirrors the game's built-in
values. You can create as many additional named presets per category as you
like.

- **Active** — each category can have one active preset, or none. **None = the
  game's built-in behavior.** Activating a preset applies it.
- Presets are stored persistently in `localStorage` under `rb-dev-store-v1`.

### 3.3 Master presets (layering)
A **master preset** captures one preset name per category and applies them as a
single layer. When a master is active, for every category it names it overrides
that category's own active selection; categories it leaves blank fall back to
the per-category active preset (or built-in default). This gives you
_layered presets_: e.g. a "Playtest" master that pins `player → Fast`,
`enemies → Tanky`, and leaves everything else alone.

### 3.4 The resolved snapshot
Whenever you save, the engine computes a **resolved snapshot** — the flat set of
overrides the game actually reads — and writes it to `localStorage` under
`rb-dev-active-v1`. It contains **only** the categories that are currently
active. The game and `environment.js` both read this one key.

---

## 4. The console UI

The left sidebar lists all sections. A green dot marks a category that is
currently active. The footer has global actions:

- **▶ Open game tab** — opens `/index.html`.
- **⭳ Export all** — the entire developer store as JSON (copy/paste to share).
- **⭱ Import all** — paste a previously exported store.
- **⟲ Reset everything** — wipe all presets back to defaults.

### 4.1 The preset toolbar (every category page)
- **PRESET dropdown** — pick which preset you are editing.
- **Active** toggle — apply this preset to the game (or turn the category off).
- **＋ New** — create a new preset from the current values.
- **⎘ Duplicate** — copy the current preset under a new name.
- **✎ Rename** / **⌫ Delete** — (Default cannot be deleted).
- **⭳ Copy JSON** — copy this single preset to the clipboard.
- **⭱ Import** — paste a single-category preset JSON.
- **⟲ Reset section** — restore this category's Default and deactivate it.

**Edits auto-save.** Moving a slider or typing a value writes to the preset and
immediately republishes the resolved snapshot, so the game reacts right away.

### 4.2 Controls
Number values show a **slider + number box** (synced). Booleans are toggles,
enumerations are dropdowns, colors use a color picker + hex field. The map and
spawn sections use purpose-built editors (grid textarea; spawn-point table).

---

## 5. Category reference

### 5.1 Player
`hp`, `maxHp`, `radius`, `speed`, `sprintSpeed`, `maxStamina`, `staminaDrain`,
`staminaRegen`, `jumpVelocity`, `jumpGravity`, `maxJumpOffset`,
`unlimitedHealth`, `unlimitedSprint`, `unlimitedAmmo`, `startingWeapon`.

### 5.2 Camera (FP + TP)
`fpWalkFov` (90), `fpSprintFov` (100), `tpWalkFov` (63), `tpSprintFov` (70),
`near` (0.05), `far` (480), `cinematicFovOffset` (-4). **First-person camera
position**: `fpOffsetX` / `fpOffsetY` (up) / `fpOffsetZ` (fwd/back) — additive
metres on top of the default eye position (0,0,0 = unchanged). Third-person rig:
`tpDistance`, `tpShoulderX`, `tpShoulderY`, `tpCameraHeight`, `tpCameraClearance`.
Per-weapon ADS FOV lives under **Weapons**. All camera values apply live.

### 5.3 Weapons
Per-gun (`rifle`, `shotgun`, `sniper`): `magazine`, `ammo`, `fireRate`,
`reloadTime`, `adsFov`, `adsInSpeed`, `adsOutSpeed`, `adsMovePenalty`, `damage`,
`pellets`, `spread`, `recoilKick`, `recoilYaw`, `recoilRoll`. One preset holds
all three guns (the "master weapons preset").

### 5.4 Enemies
Per-type (Siege Drone, Cloned Ghost, Blink Seraph, Null Cherub, Zombie): `hp`,
`speed`, `damageMin`, `damageMax`, `attackRate`, `scale` (size), `xp`, `glow`,
and the **palette**: `color` (body) + `emissive` (glow). One preset holds every
type. Stat/visual edits apply to the **next spawn/wave** (already-spawned enemies
keep what they spawned with, so wave scaling never drifts).

### 5.5 Gameplay
Wave pacing and scaling: `waveCountBase`, `waveCountPerWave`, `waveCountMax`,
`hpScalePerWave` (+cap), `speedScalePerWave` (+cap), `damageScalePerWave`
(+cap), and global `playerDamageMult` / `enemyDamageMult`.

### 5.6 Spawn rules
- `minDistance`, `preferVisible`, `useProceduralFallback`.
- **Manual spawn points** table: world `X`/`Z`, `facing` (radians),
  `radius`, `wave` (0 = all waves), `priority` (higher spawns first), `type`.
- Points that resolve **inside a wall are skipped at runtime**. With no points,
  the built-in procedural spawner is used. With fewer points than the wave
  needs, extra enemies come from the procedural spawner (if fallback is on) or
  cycle through your points.

### 5.7 Lighting (indoor/outdoor)
Multipliers layered on top of the auto-selected device profile:
`ambientMul`, `hemiMul`, `dirMul`, `pointIntensityMul`, `pointCountAdd`,
`pointDecay`, `bounceIntensityMul`, plus `ambientColor`, `hemiSkyColor`,
`hemiGroundColor`. All-1.0 / built-in colors = unchanged. **Structural:** the
game reloads to rebuild lighting on save.

### 5.8 Map
Edit the grid directly. Legend: `#` wall, `.` open floor, `+` doorway. Every
row must be the same width (min 3×3). `cell` sets world units per cell (default
4). Saving rebuilds **collision, geometry, lighting placement and the minimap**.
The built-in 34×41 map is always the fallback (**Load built-in map** button).
**Structural:** the game reloads to rebuild on save.

### 5.9 Performance (all devices)
Renderer backend and per-device performance caps. **This is where the biggest
frame-rate wins live.**

- `renderer` — `auto` (default) / `webgl` / `webgpu`.
  - **`auto`**: desktop uses **WebGL** (the mature, fast path); mobile prefers
    **WebGPU-first** (WebGL can exceed mobile shader limits and render black).
  - Why: three r166's experimental WebGPU path issues **~100× the draw calls**
    of WebGL for this scene on many desktop GPUs (measured: 43,800 vs ~424),
    dragging desktops to ~16 fps. `auto` sidesteps that; force a backend only for
    A/B testing.
- `autoFallback` — if a session ends up on WebGPU and stays **< 30 fps at the
  minimum render scale**, the game persists a WebGL preference and reloads once
  (guarded against loops) so it self-heals on slow GPUs.
- `shadows` — `auto` / `on` / `off`. Shadows are a per-fragment GPU cost (every
  lit surface samples the shadow map each frame). `off` pins them off (a solid
  win on weak GPUs); `on` pins them on; `auto` lets the governor decide. Applies
  live (brief shader recompile). Mobile is always shadow-free.
- `autoPerfGovernor` — when the frame rate stays **< 48 fps even at the minimum
  render scale** (i.e. resolution isn't the lever — the GPU-bound case), the game
  automatically disables shadows for a smoother frame. One-way per session; a
  reload restores. `quality.shadows: "on"/"off"` overrides and disables the
  governor for shadows.
- `renderScaleCap` — clamp the maximum internal render scale (0 = device default).
- `pixelRatioCap` — cap `devicePixelRatio` (0 = device default). Great for 4K/
  Retina where native resolution is the real cost.
- `maxActiveLights` — hard cap on active interior point lights (0 = engine
  default). Applies even without a lighting preset, for weak GPUs.

Renderer/pixel-ratio/light changes take effect on the game's next load (the
console triggers a reload on save). **Escape hatches** (no console needed):
`localStorage.rb_renderer = "webgl" | "webgpu" | "auto"` (legacy
`rb_force_webgl = 1` still honored).

### 5.10 Debug / Preview
- `godMode` — invulnerable + infinite ammo.
- `freezeEnemies` — halts all enemy AI/movement (hot-applies, no reload).
- `spawnWaveOverride` — start a fresh mission at this wave (0 = normal).
- `showConfigBanner` — the in-game "DEV PRESET" badge.
- `autoReloadOnStructural` — auto-reload the game tab on map/lighting changes.

---

## 6. How changes reach the game — **live, no reload**

Editing a preset republishes the resolved snapshot; the game tab receives a
`storage` event and **hot-applies it in place**. You keep playing — no reload,
no lost session. A brief **"● LIVE-APPLIED"** pill confirms each edit landed.

| Change | Behavior |
|--------|----------|
| Player, Camera, Weapons, Gameplay, Spawn, Lighting, Debug, Performance caps | **Hot-applied live**, no reload. |
| Enemies | **Live** — applies to the next spawn/wave (already-spawned enemies keep their stats, so wave scaling never drifts). |
| **Map** layout | Reloads once (full geometry + collision + minimap rebuild). |
| **Renderer backend** (`quality.renderer`) | Reloads once (a GPU backend can't be swapped mid-session). |

Mechanics of live re-apply (`devReapply` in `three_fps_game.js`): the live `DEV`
snapshot object is swapped in place (so every `devVal()` reader updates), then
idempotent appliers re-run from pristine bases — `applyDevWeapons` +
`refreshGunStatesFromSpecs` (preserves pack level & ammo), `applyDevEnemies`,
`applyDevPlayer`, `refreshDevCameraConsts`, `applyDevLightingLive` (rebuilds
interior lights), and `applyDevQualityLive` (render-scale / pixel-ratio). Because
every applier resets from its captured base first, edits never compound.

The game shows a small **"DEV PRESET · …"** badge at the top while any preset is
active — it updates instantly and disappears when you deactivate everything.

---

## 7. Import / export & sharing

- **Single preset:** the **⭳ Copy JSON** button on any category. Shape:
  `{ "kind": "rb-dev-preset", "category": "player", "config": { … } }`.
- **Whole store:** the footer **Export all** / **Presets → Copy full config
  JSON**. Shape: `{ "kind": "rb-dev-store", "version": 3, "store": { … } }`.
- Import is validated and sanitized — a malformed file can never crash the game;
  bad fields fall back to defaults.

---

## 8. Versioning & migration

The store carries a `version` (`DEV_ENGINE_VERSION`). On load, older or unknown
stores are migrated onto a fresh default store and re-sanitized field-by-field,
so schema changes never brick an existing configuration. To add a new field:

1. Add it to `DEFAULTS[category]` in `modules/dev_engine.js`.
2. Add a clamp/coerce line in `sanitizeCategory`.
3. Add UI metadata to `FIELDS`/`LABELS` in `dev.html`.
4. Apply it at the game control point (see below) with a `devVal(...)` fallback.
5. Bump `DEV_ENGINE_VERSION` if the shape changed materially.

---

## 9. Where the engine hooks the game

For maintainers extending coverage:

| Category | Hook site |
|----------|-----------|
| player | `player = { … }` init + `JUMP_*` consts + `currentGun` (three_fps_game.js) |
| camera | `PerspectiveCamera(...)`, `THIRD_PERSON_*` consts, the FOV block in the frame loop |
| weapons | `applyDevWeapons()` mutates imported `GUN_SPECS` before any `createGunState` |
| enemies | `applyDevEnemies()` mutates `ENEMY_TYPES` right after it's defined |
| gameplay | `getWaveEnemyCount/HpScale/SpeedScale/DamageScale` read `gp(...)` |
| spawn | `getDevSpawnPositions()` wraps `getSpawnPositions()` in `spawnEnemies` |
| lighting | `applyDevLighting()` + color overrides in `environment.js` |
| map | `MAP`/`CELL` selection in `environment.js` (reads `rb-dev-active-v1`) |
| quality | renderer-selection block, `basePixelRatio`/`quality.scale` caps, `maybeAutoFallbackRenderer()`, `applyDevLighting` light cap |
| debug | player init, `updateEnemies` freeze guard, wave-init override, storage listener |

The storage listener (`devReapply`) decides hot-apply vs. reload.

---

## 10. Quick recipes

**Sandbox / god run:** Debug → activate a preset with `godMode` + `freezeEnemies`.

**Balance a boss:** Enemies → duplicate Default → "Tanky" → raise Siege Drone
`hp`, activate. Watch the game tab reload and re-fight.

**Design a new arena:** Map → duplicate Default → edit the grid → **Apply map**.
Add manual spawn points under Spawn to control encounters.

**Ship a tuning pack:** set up per-category presets → **Presets → Capture
current as master** → **Export all** → hand the JSON to a teammate to **Import
all**.

**Get back to vanilla:** Presets → **Deactivate everything** (or per section,
the **Active** toggle off). No preset active ⇒ stock game.

---

## 11. Extending coverage & roadmap

The schema is intentionally easy to grow (see §8). Recently added: enemy
**size + palette** (`scale`/`color`/`emissive`) and **first-person camera
position** (`fpOffset*`). To expose a new tunable, add it to `DEFAULTS` +
`sanitizeCategory` (dev_engine), `FIELDS`/`LABELS` (dev.html), then read it at the
game control point via `devVal()` and re-apply it in `devReapply` — it then
live-applies with everything else.

Known deeper items still on the roadmap (larger lifts):
- **Enemy animations** (clip swaps / speed): the rigs are shared Mixamo/GLTF
  mixers; live clip retargeting needs a per-type animation registry. Colour/size
  are live today; animation is the next step.
- **Real-time map editing without reload**: interior grid edits currently reload
  to rebuild collision + geometry + minimap safely. A live rebuild path
  (tear-down + `buildLevel` re-run) is feasible but must re-warm instancing and
  lighting — planned.
- **Exterior/procedural map controls**: the outdoor arena is generated in
  `exterior_map.js` (buildings, props, lampposts). Exposing its seed + density +
  building list as a `map.exterior` sub-schema is the plan for full outdoor
  customization.
