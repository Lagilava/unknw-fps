# Asset diet + runtime audit

Branch `perf/asset-diet` (6 commits, not pushed). Goal: stop deploying ~440 MB of assets to GitHub Pages and
trim what players download at boot, without touching gameplay.

## Before / after

All numbers measured on the **built output** (`npm run build`, served by `vite preview`, no compression),
by `src/tests/perf/network-audit.spec.cjs`: boot to `body[data-rb-ready]`, press Start, ~20 s of play incl. a
forced wave completion. MB = MiB.

| | Baseline | After | Change |
|---|---|---|---|
| `dist/` total (= Pages deploy) | 480 MB | **63 MB** | -87% |
| `.fbx` shipped in `dist/` | 48 files, 367 MB | 6 files, 17.6 MB (16.5 of it `Parasite L Starkie.fbx`) | -95% |
| `.glb` shipped in `dist/` | 87 MB | 19 MB | includes 23 new ~1.6 MB-total animation GLBs |
| Boot download (until menu ready) | 41.4 MB, 148 requests | **17.2 MB**, 159 requests (*) | -58% |
| Requests after boot (Start + 20 s play) | 0 | 0 | everything is preloaded during boot |
| `.fbx` requests at boot | 23 (2.4 MB) | **0** | |
| Lazy loads > 2 MB | 0 | 0 | |
| 4xx / failed requests | 0 | 0 | |
| Loader fallback warnings in console | n/a | 0 | |
| `tsc --noEmit` | clean | clean at every commit | |
| Boot-ready time in my sandbox | 77.8 s | 76.9 s | unchanged: localhost, bound by software-GL shader linking, not by network |

(*) +11 requests are tiny (~0.1 KB) revalidations of `Pete.glb` and the animation GLBs. In the baseline `Pete.glb`
(8.25 MB) was actually transferred **twice** at boot (startup prefetch + GLTFLoader), 16.5 MB of the 41.4 MB; at
3.2 MB it now caches and the second hit is a revalidation. Real-world savings on a CDN with compression and
cache headers will be smaller in absolute terms than these uncompressed localhost numbers, but proportionally
similar (textures were the bulk, and PNG compresses poorly).

### Smoke tests

`src/tests/core/gameplay-smoke.spec.cjs` **cannot pass in my cloud sandbox even on untouched `main`**: it
runs on software GL (~2 fps), so game time barely advances and Test 3 (WASD movement) fails before any change of
mine. To still get a regression signal I ran a scratch copy (not committed) that records each step instead of
aborting at the first failure, with the 3-minute soak cut to 8 s. Result, identical at baseline, after step 1, 2, 3
and at the end:

- PASS: Test 1 boots with no console errors, Test 2 start, pause/menu/settings, Tests 4, 5, 7, 8, 9, 11 (all required
  assets load, no bad responses), mobile boot.
- FAIL (same at baseline, sandbox frame-rate / sim-time dependent): Tests 3, 6, 10, 12.

**Please run the real smoke spec on your Windows box with a GPU**; I can't claim Tests 3/6/10/12 for either side.

## What changed (one commit per step)

1. **Baseline network audit** — new `src/tests/perf/network-audit.spec.cjs` (`AUDIT_URL` points it at the built
   output; writes `network-audit.json`; flags `.fbx` and lazy loads > 2 MB; also logs loader-fallback warnings).
2. **Don't ship shadowed FBX** — `copySiblingAssetsOnBuild` in `vite.config.ts` skips any `.fbx` that has a
   same-named sibling `.glb` (`KEEP_FBX=1` disables the filter, dev server untouched, source files untouched).
   Before enabling it I grepped every runtime FBX path: all loaders try the GLB first (`PLAYER_MODEL_GLTF_PATH`,
   `PLAYER_ANIMATION_GLTF_PATHS`). The only FBX with a GLB that code references are fallbacks, so nothing had to be
   kept. `black mask.fbx`, `character.fbx`, `Floating.fbx` are referenced by nothing. `dist` 480 -> 141 MB.
3. **Compressed the big GLBs** — `src/scripts/optimize-glbs.mjs`: dedup, prune, WebP textures (max 1024 px props,
   2048 px heroes: Pete, zombie, character, black mask, statue), plus weld + quantize + meshopt for static meshes.
   **Skinned rigs (Pete, zombie, character, black mask) get textures only** (no quantize/meshopt), so bind pose and
   the animation retargeting are untouched; `prune` keeps leaf nodes so name lookups still work. Tiny textures
   (< 128x128, e.g. `tree.glb`'s 256x1 palette) are left alone — my first pass lossy-compressed that palette
   and the tree visibly lightened; the visual-diff test caught it.
   - **Originals: I picked "overwrite in place, original copied to `assets-src/`"** (git-ignored, never copied
     into `dist` because the build only copies `assets/`). Originals also stay in git history (`d4015f8`).
     Every run re-optimises from `assets-src/`, so it's idempotent. On a fresh clone (no `assets-src/`) the script
     detects already-optimised files and skips them rather than recompressing WebP.
   - **MeshoptDecoder**: `createGLTFLoader` in `modules/three_loaders.ts` now sets it. I audited every
     `GLTFLoader`: the landmark loader in `three_fps_game.ts` was a raw `new GLTFLoader()` (now the configured one);
     `exterior_map.js` (ferrari/tree) and `model_preview.html` now set the decoder themselves;
     `zombie_diagnostics.mjs` (node-only harness) still uses a bare loader and its WebP textures won't decode in
     node (it was already DOM-dependent).
   - Per file: see table below. Visual check: `src/tests/perf/glb-visual-diff.spec.cjs` renders original vs
     optimised in the same studio setup (two angles, IBL) and writes side-by-side sheets to
     `test-artifacts/glb-diff/`. PSNR 40–58 dB on everything (lowest: tv 39.8 dB, camera 41.8 dB). I looked at the
     zombie, Pete and tv sheets: no visible difference at 640 px. Not checked in-game on a GPU, see decisions.
4. **Converted the remaining animation FBX to GLB** — `src/scripts/convert-fbx-anims.mjs` (same recipe as
   `convert-pistol-anims.mjs`) made animation-only GLBs for 11 player and 12 zombie clips (~11 MB FBX -> ~1.6 MB).
   `asset_paths.ts` now derives a GLB path for every player clip (existing GLB-then-FBX fallback per clip).
   The zombie loader reads the GLB set first and falls back to the **whole** FBX set if any clip fails — glTF is
   metres, FBX centimetres, and the crawl clips are scaled against the idle clip's hips height, so mixing would
   break them. `src/tests/animation-glb-equivalence.test.mjs` compares all 34 FBX/GLB pairs through three.js:
   same tracks, mean rotation error < 0.02 rad (typically 0.001–0.008), cm->m positions match; the GLBs end one
   30 fps frame earlier than the FBX clip (same as the already-shipped GLBs). `Parasite L Starkie.fbx` was **not
   re-converted**: it is already `parasite_zombie.glb` and nothing requests the FBX (legacy FBX 6100, three can't parse it).
5. **Dead code** — removed from `three_fps_game.ts` (~200 lines): `loadSiegeDroneModel`,
   `loadSiegeDroneWalkAnimation`, `prepareAngelDroneModel`, `createAngelDroneMaterials`, `loadTexture`, the three
   `SIEGE_DRONE_*`/`ANGEL_DRONE_*` state variables and their imports. None had a caller (drones are the procedural
   Storm Warden), and they referenced `assets/drones/angel/`, which isn't in the repo. **Not reachable, so no 404 risk.**
   The path constants stay in `asset_paths.ts` (marked dead) only because `model_preview.html` imports them.

### Per-file GLB sizes (original -> optimised, MiB)

| File | Before | After |
|---|---|---|
| landmarks/AntiqueCamera.glb | 16.73 | 1.11 |
| zombies/parasite_zombie.glb | 12.52 | 1.82 |
| landmarks/Lantern.glb | 9.12 | 0.45 |
| landmarks/ScatteringSkull.glb | 8.54 | 1.38 |
| Pete.glb | 7.87 | 3.17 |
| models/tree.glb | 5.55 | 0.23 |
| landmarks/ToyCar.glb | 5.17 | 1.37 |
| models/character.glb | 5.17 | 0.97 |
| models/player/black mask.glb | 5.13 | 0.91 |
| world/Desert_Outpost.glb | 3.98 | 0.86 |
| tv_old_1960s.glb | 2.51 | 0.58 |
| **Total** | **82.3** | **12.9** |

## Top 10 largest files left in `dist/`

| MB | File | Requested at runtime? |
|---|---|---|
| 16.47 | assets/zombies/Parasite L Starkie.fbx | no |
| 4.52 | assets/models/character.fbm/MocapSuit02_diffuse.png | no |
| 4.43 | assets/hdri/kloppenheim_06_puresky_2k.hdr | **yes** (the sky) |
| 3.72 | bundle/index-*.js (game + three, 1.28 MB gzipped) | yes |
| 3.33 | assets/Pete.glb | yes |
| 2.70 | assets/models/player/editor-generated_79c6….png | no |
| 2.26 | assets/models/player/editor-generated_e94a….png | no |
| 1.90 | assets/zombies/parasite_zombie.glb | yes |
| 1.82 | assets/landmarks/GlassVaseFlowers.glb | no |
| 1.68 | assets/models/ferrari.glb | no (see below) |

## Not changed, and why

- **Never-requested assets still in `dist/`: 49 files, 41.8 MB** (of 63 MB). Biggest: `Parasite L Starkie.fbx`
  16.5 MB, `character.fbm/*.png` 4.5 MB, two `editor-generated_*.png` 5 MB, unreferenced landmark GLBs. The task
  only asked to drop shadowed FBX, and some of these are tool inputs (model editor, `?sky=` previews), so I left them.
- **Kept the FBX fallback code and `FBXLoader` import.** The 47 KB FBXLoader chunk is still fetched at boot though
  it's now only a fallback; lazy-importing it is an easy follow-up.
- **Boot-time sky HDR (4.4 MB)** and exterior building GLB (1 MB): untouched (not in scope, no quality loss budget).
- **Pete.glb stays at 3.2 MB**: it's skinned (textures only) and 33k verts of float skinning data; quantizing a
  skinned mesh changes the bind pose.
- No gameplay, balance, UI or networking code touched; **no file was renamed** (only new `.glb` files added), so
  nothing multiplayer clients reference changed name.

## Needs your decision / attention

1. **Trim never-requested assets from the deploy?** e.g. extend the build filter to skip `Parasite L Starkie.fbx`
   (16.5 MB), `*.fbm/`, `editor-generated_*.png`, unreferenced landmarks. Would take `dist` to roughly 20 MB.
   Say which of them you want available on Pages (e.g. if the model editor is meant to work on the live site).
2. **Possible pre-existing prod bug (not fixed):** in the Vite build, `ferrari.glb` and `tree.glb` are never requested.
   `exterior_map.js` is copied as a *classic script* and `import("three/examples/...")` of a bare specifier has no
   importmap in `index.html`, so I believe those loads throw and the code silently falls back to procedural trees/cars.
   The legacy page (importmap) does load them. I didn't confirm visually or change it, since fixing it changes what
   players see on Pages.
3. **Re-run the smoke spec on a real GPU** (see above) and eyeball the statue/zombie/Pete in-game once. My visual
   check was isolated renders, not in-game.
4. **Repo size:** the optimised GLBs replace the originals in git, so history grows by ~15 MB (new blobs) while the
   working tree shrinks. `assets-src/` is local-only; if you want a durable backup of the originals outside git
   history, copy it somewhere before cleaning.
5. `src/tests/perf/network-audit.spec.cjs` needs `npx vite preview` running to audit the built output (command in
   its header). Also note Playwright 1.61 in my sandbox didn't match the installed browsers, so I ran with a scratch
   config pointing at `/opt/pw-browsers/chromium`; the repo's `playwright.config.cjs` is unchanged.

## Follow-up (same branch)

1. **Deploy trim** — `vite.config.ts` also skips `Parasite L Starkie.fbx` and `*.fbm/` (only `models/character.fbm`,
   4.4 MB). `KEEP_ALL_ASSETS=1` disables just these two filters (`KEEP_FBX=1` still covers the shadowed FBX).
   Nothing at runtime references them: the only source mentions are the unused `ZOMBIE_MODEL_FBX_PATH` constant and
   the converter scripts. `dist` 63 MB -> **43 MB**.
   Left in the deploy for your decision, none referenced by any runtime code (`grep` over `src/` finds no
   references to any of them): `models/player/editor-generated_79c6….png` 2.57 MiB and `…e94a….png` 2.15 MiB
   (no reference anywhere in the repo; added with the pistol-animation commit `e5f943a`), and the landmark GLBs
   `GlassVaseFlowers` 1.8 MB, `ScatteringSkull` 1.4, `ToyCar` 1.4, `AntiqueCamera` 1.2, `Lantern` 0.5 (not in
   `landmarks.ts`'s manifest).
2. **Lazy FBXLoader** — now `import()`ed on first fallback use (`getFbxLoader` in `three_fps_game.ts`). Built-site
   audit: the `FBXLoader-*.js` chunk (47 KB, 15.9 KB over the wire) is no longer requested at boot. Fallback test:
   a `KEEP_FBX=1` build with `zombies/zombie walk.glb` deleted from `dist` logged "zombie walk.glb could not be loaded;
   will fall back to the FBX set", fetched the FBXLoader chunk on demand, loaded all 12 zombie FBX clips, 0 failed requests.
3. **ferrari.glb / tree.glb on the built site** — confirmed never loaded. Evidence: zero requests for either in the
   built-site audit; the legacy importmap page requests both; and `import("three/examples/jsm/loaders/GLTFLoader.js")`
   from a classic-script context fails on the built page with "Failed to resolve module specifier" but works on the
   legacy page. `exterior_map.js` swallows the error (`catch (_) { placeParkedCars(); }` / `buildTrees(...)`), so players on
   Pages see the procedural boxy cars and procedural trees. No console warning is printed.

## Follow-up 2 (same branch)

- **Orphans trimmed from the deploy** (`38d0083`): `models/player/editor-generated_*.png` and
  `landmarks/{GlassVaseFlowers,ScatteringSkull,ToyCar,AntiqueCamera,Lantern}.glb`. A grep of every
  html/js/mjs/cjs/ts/json file outside `node_modules`/`dist`/`assets-src` found no reference to any of them.
  `KEEP_ALL_ASSETS=1` keeps them. `dist` 43 MB -> **32 MB**.
- **tree.glb on the built site** (own commit): `exterior_map.js` now gets its GLTFLoader (MeshoptDecoder set)
  from `window.__rbCreateGLTFLoader`, published by `three_fps_game.ts`; its own import stays as the path for pages without it.
  Catch blocks now `console.warn`. Built site: `tree.glb` 200, real voxel trees render
  (`built-before/after-tree-fix.png`). Boot download 17.2 -> 19.1 MiB.
- **ferrari.glb still does not render, on either page.** It is Draco-compressed (`KHR_draco_mesh_compression`
  required) and no `DRACOLoader` exists anywhere in the codebase, so GLTFLoader throws "No DRACOLoader instance
  provided" and the procedural cars are used. The legacy page has always behaved this way (silently). The built site
  now downloads the 1.6 MB file and discards it. Options: wire a DRACOLoader with a locally hosted decoder (~250 KB,
  copy `three/examples/jsm/libs/draco/gltf/` into the build), re-encode ferrari.glb to meshopt, or stop requesting it.

## Follow-up 3: ferrari.glb re-encode, car check, tree report

- `models/ferrari.glb` was Draco-compressed and the game has no DRACOLoader, so it never rendered. `optimize-glbs.mjs` now decodes Draco (three's own decoder, run in Node) and writes weld + quantize + meshopt. Original in `assets-src/models/ferrari.glb`. 1.60 MB (Draco) -> 2.23 MB (meshopt). No `KHR_draco_mesh_compression`; requires `EXT_meshopt_compression` + `KHR_mesh_quantization`; loads through the shared `createGLTFLoader`. Visual diff (`glb-visual-diff.spec.cjs`): PSNR 47.2 dB.
- Built site: `ferrari.glb` and `tree.glb` both 200, no loader warnings. The model's nose points -Z (the procedural car's is +X), so `exterior_map.js` now sets `clone.rotation.y = ry - Math.PI / 2`, clones lamp materials per car and registers each car in `window.__extCarAlarms` so alarms flash it. Scale (3.8 m long) and ground contact (min y = 0) were already right.
- Cost (not fixed, report only): each Ferrari is ~358,788 tris / 51 meshes / 17 materials, 7 cars ~ 2.5M tris, ~357 draws. tree.glb is 37,248 tris, 1 mesh; 15 separate clones (shared geometry, not InstancedMesh) ~ 559k tris, 15 draws. Trees do not cast shadows (`receiveShadow` only); the Ferraris are in `extWallMeshes` and their shadow behaviour was not measured. Procedural trees were ~164 tris each (~2.5k total).
- Cheapest fixes: simplify both GLBs with meshopt `simplify` in `optimize-glbs.mjs` (tree to ~3k tris -> ~45k total, -92%; Ferrari to ~20-30k each -> ~170k total, -93%). Instancing the trees saves draw calls only, not triangles.
- Frame time is unmeasurable in the software-GL sandbox.

## Follow-up 4: decimate ferrari.glb and tree.glb

`optimize-glbs.mjs` has a `DECIMATE` table (originals still in `assets-src/`, re-running is byte-identical).

- **ferrari.glb**: 358,788 -> 41,673 tris, 51 -> 16 meshes (one per material; lamp materials stay separate), ~16 draws per car (was 51+), file 2.23 MB -> 0.35 MB. The source is *double-shelled*: every surface exists twice with an inverted twin, so meshopt could not simplify it at all. The script removes the back-face-culled twin (a voxel ray test picks the one facing open air, voted per component), which alone halves it (179k tris, visually identical), then simplifies per material (interiors hardest). The 25k target was not met: at ~25k the wheel spokes and rear haunches visibly smear, so the plans were kept at 41.7k.
- **tree.glb**: 37,248 -> 2,982 tris (-92%), 0.24 MB -> 0.03 MB. The 256x1 palette texture is byte-identical. The source is a voxel tree, so the decimated one reads as an organic low-poly tree (slightly greener, less blocky) and loses the red/purple/dark-hole accent voxels; 3k and 6k looked the same at play distance, so 3k stays.
- **Shadows**: `sun.castShadow` is always on and `renderer.shadowMap.enabled` is true by default, but the GLB cars and trees only set `receiveShadow`, so neither casts (the procedural cars did). Shadow-pass cost from them is 0 triangles before and after; the shadow pass is a constant 62 draws / 154k tris.
- **Measured per frame (exact GL draw/tri counters, `probe`-style; same three viewpoints)**: main-pass triangles 2.61M -> 0.56M (avenue), 2.60M -> 0.55M (plaza), 2.57M -> 0.52M (interior); main-pass draw calls 489 -> 456, 472 -> 439, 509 -> 481. The cars/trees are in every view because they are never culled. Counts are from 1-2 frames per view (software GL).
- **dist** 32 MB -> 30 MB, boot download 19.68 MiB -> 17.58 MiB.

## Follow-up 5: why cars/trees are never culled, car shadow options, draw-call breakdown (report only, no code changes)

**Culling.** Not a decimation/join artefact and not a bad bounding volume: it is `collapseStaticDrawCalls()` (`three_fps_game.ts` ~25386). It groups meshes by `(geometry, material, shadow flags)` and replaces every group of 4+ with one `InstancedMesh` whose `frustumCulled = false` (set on purpose, comment at ~25415: the instances are spread across the map and the geometry-derived sphere would be one instance at the origin, so culling would wrongly drop the batch). The 7 cars and 15 trees are clones sharing geometry+material, so every shared-material part becomes `*_x7` / one `tree_x15`-style instanced mesh that is always submitted (confirmed in the live scene: `metal_x7` `inst:true count:7 frustumCulled:false`, bounding sphere r=1.2 at the origin). Only the parts whose materials are cloned per car (body colour, lamps) stay individual meshes, and those are culled correctly. Left unchanged. What enabling it would risk: `frustumCulled=true` alone would cull all instances once the origin leaves the view (cars vanish); it needs `computeBoundingSphere()` per group (r166 `Frustum.intersectsObject` uses it), and the scene has 22 such groups that hold moving/other things, so it is a global behaviour change to re-test. Measured in a scratch (not committed) experiment: with a correct sphere the cars+trees are skipped in the Interior view (-13 draws, -248k tris: cars 203k + trees 45k), no change at Avenue/Plaza, since the group sphere spans the whole avenue.

**Car shadows (GLB cars, current 41.7k model), Avenue viewpoint, GL counters:** baseline shadow pass 62 draws / 154k tris. (c) `castShadow=true` on the 40 car meshes: +40 draws, +292k tris (shadow pass 102 / 446k, about 2.9x), main pass unchanged. (a) one instanced 12-tri hull proxy casting only (colour/depth writes off): shadow +1 draw / +84 tris, plus +1 main-pass draw (no pixels). (b) one instanced soft blob decal: +1 main-pass draw, +14 tris, shadow pass unchanged. Not implemented.

**Draw calls by source (wave 2, 3 Cloned Ghost + 1 Warden alive; same on every viewpoint within ~20):** coop-style ghost enemy rigs 231 (3 rigs x ~77 box meshes, each with its own geometry and material), angel/warden rig 83 (one skinned mesh has 50 material groups), buildings/terrain/roads 17-23, interior instanced structures 13-21, cars 12, player+skinned 23, other meshes 10-37, sprites 9, particles 3, sky 1-2, trees 1. The HUD is DOM, not WebGL.

## Follow-up 6: shadow proxy, narrow exterior culling, enemy rig report

- **Shadow proxy** (`exterior_map.js`): one `InstancedMesh` of a 24-triangle hull (two boxes), 7 instances, `colorWrite/depthWrite` off, `castShadow` on; the GLB cars still do not cast. Shadow pass 62 draws / 153,890 tris -> 63 / 154,058; main pass +1 draw, +168 tris. At the shipped golden-hour sun (elevation ~14 deg, from +x/-z) the avenue is mostly in building shade, so the car shadow is nearly invisible there; with the sun raised in a scratch test (proxy on/off in one session) a clear shadow appears under the car.
- **Culling**: `collapseStaticDrawCalls` untouched. `exterior_map.js` records the car/tree template geometry uuids in `window.__extCullGeometries`; right after the collapse `cullExteriorInstancedGroups()` (`three_fps_game.ts`) gives only the InstancedMeshes built from those geometries a bounding sphere over all instances and re-enables frustum culling. Chosen over hiding-while-inside because the game has no single interior-state signal to hook (it would be a new gameplay-coupled flag), whereas a correct sphere is stateless and also handles looking away outdoors. Measured (GL counters): Interior main-pass tris 520,655 -> 272,598; Avenue 557,442 and Plaza 547,288 unchanged; all 13 car/tree groups drawn when walking back outside, and from both ends of the avenue (screenshots checked).
- **Enemy rigs** (wave 2 / 10; the wave-5 sample did not catch the enemies as visible rigs, so no number): Cloned Ghost = 74-82 draws each (8 skinned parts + 66-74 box/plane/cylinder meshes, 68-76 unique geometries, 74-82 unique materials, 14 distinct material parameter sets). Nothing is shared between ghosts. The meshes are static relative to their parent groups (0 of 74 moved in 2.5 s), so they are attached props, not individually animated. Angel-type rigs: 79 draws each (30 meshes, 14 materials; one skinned mesh has ~50 material groups). Wave 10 (3 ghosts + 8 angel groups visible) = ~878 enemy draws on top of the world. Scaling is linear in live enemies of those types.
