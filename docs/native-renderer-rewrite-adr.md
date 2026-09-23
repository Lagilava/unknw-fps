# ADR-001: Native Renderer Rewrite for UNKNW (Room Breach FPS)

**Status:** Proposed
**Date:** 2026-09-22
**Deciders:** project owner

## Context

Live diagnostics on this repo (headless Playwright pass, wave-1 gameplay, `__rbCountLights()` / `__rbDraws()` / `__rbTest.getFrameStats()`) measured:

- **17 real-time lights** evaluated per fragment every frame (9 PointLight, 3 DirectionalLight, 3 HemisphereLight, 2 AmbientLight).
- **2,062 draw calls** per frame in steady-state play (documented WebGL baseline for the static scene alone is ~424; the gap is enemies/particles/props that can't be merged because they move independently).
- **`jsFrameMs` ≈ 15ms of a 16.6ms frame budget at 60fps** — this is JS logic + draw-call issuing *before* the GPU rasterizes anything, and it's hardware-independent: even a fast GPU laptop is capped near 60fps because the CPU side alone nearly fills the frame.
- WebGPU backend on this scene was previously measured at **43,800 draw calls vs ~424 on WebGL** (documented in `CLAUDE.md`) — three.js's WebGPU path is currently a regression for this geometry, which is why desktop defaults to WebGL.

Codebase scope (`wc -l`):

| File | LOC |
|---|---|
| `three_fps_game.ts` | 24,584 |
| `environment.js` | 1,547 |
| `exterior_map.js` | 1,522 |
| `modules/*.ts` / `modules/*.js` (32 files) | ~6,500 |
| **Total** | **34,157** |

Asset footprint: ~440MB (`assets/Pistol Animations` 258MB, `assets/models` 77MB, `assets/Pete.fbx` 62MB, `assets/landmarks` 42MB, `assets/zombies` 35MB), mostly FBX/GLB — portable formats, not three.js-specific.

The project owner wants to evaluate a **custom native renderer built from scratch (Vulkan/DirectX/Metal)** to remove the browser as the performance ceiling.

## Decision

Not yet made — this ADR lays out the real options and a recommended phased path, because "custom native renderer" spans a wide range of actual commitments (raw platform APIs vs. a cross-platform GPU abstraction), and the supporting systems (physics, audio, netcode, asset loading, UI) each need their own replacement, not just the renderer.

## Options Considered

### Option A: Raw platform APIs (Vulkan on Windows/Linux, DirectX 12 on Windows, Metal on macOS) — three hand-written backends

| Dimension | Assessment |
|---|---|
| Complexity | Very high — three full backend implementations, three sets of platform quirks, no abstraction to fall back on |
| Cost | Highest — multiplies the renderer work by the number of platforms targeted |
| Scalability | Full control, best possible ceiling |
| Team familiarity | Unknown; assume solo/small team based on current repo shape |

**Pros:** maximum control, no dependency risk, deepest possible optimization.
**Cons:** this is building three renderers, not one; realistically only justified if cross-platform reach is non-negotiable *and* the team already has low-level graphics experience.

### Option B: Cross-platform GPU abstraction library (bgfx, sokol_gfx, Diligent Engine, or SDL3's GPU API), one renderer targeting all backends through it

| Dimension | Assessment |
|---|---|
| Complexity | High, but singular — one renderer, the library handles Vulkan/D3D12/Metal dispatch |
| Cost | Roughly 1/3 of Option A for equivalent platform coverage |
| Scalability | Diligent Engine is explicitly designed around D3D12/Vulkan/Metal as first-class, with D3D11/GL as fallback — modern-API-native, not a legacy wrapper |
| Team familiarity | sokol_gfx is a ~25k-LOC single header, easiest to integrate; bgfx is C++ with generated bindings; Diligent is the most "framework-shaped" of the three |

**Pros:** one shader/resource model to learn, real cross-platform coverage without tripling the work, all three (bgfx, sokol, Diligent) are mature and actively maintained.
**Cons:** still a dependency to vendor and track; abstraction leaks are possible for advanced features (mesh shaders, ray tracing) if ever needed later.

### Option C: Rust + wgpu-native as the abstraction layer

| Dimension | Assessment |
|---|---|
| Complexity | High, similar to Option B |
| Cost | Comparable to Option B |
| Scalability | wgpu targets Vulkan/D3D12/Metal natively, same tier as Diligent |
| Team familiarity | Notable synergy: **Rapier's physics is already Rust** (this repo uses `@dimforge/rapier3d-compat`, the WASM build of the same engine) — going native Rust lets the physics port become a dependency swap (`rapier3d` instead of the WASM `-compat` package) rather than a rewrite |

**Pros:** physics migration is nearly free; Rust's safety model reduces a category of bugs that dominate C++ renderer work (use-after-free on GPU resources, data races).
**Cons:** smaller game-dev ecosystem than C++ for the remaining systems (audio, FBX loading, UI); steeper learning curve if the team isn't already Rust-fluent.

### Option D (baseline for comparison): Stay on three.js/WebGL, invest in draw-call/light-count reduction

| Dimension | Assessment |
|---|---|
| Complexity | Low — batching, worker offload, and light-count cuts are localized changes to existing code |
| Cost | Days, not months |
| Scalability | Bounded — will never remove the browser/JS ceiling entirely |
| Team familiarity | Full — this is the current codebase |

**Pros:** the `jsFrameMs` finding above says real headroom exists right now (2,062 draws, 1,864 of them unmerged "Mesh" entries — enemies/particles/props are the biggest single lever); cheap to attempt, doesn't block a later native effort.
**Cons:** does not remove the structural ceiling (JS GC, single-threaded draw submission, three.js's shader-cache relink behavior) — it raises the ceiling, doesn't change what kind of ceiling it is.

## Trade-off Analysis

Every native option (A, B, C) requires rebuilding, not porting, these systems — the current implementations are browser-specific and have no native equivalent to "translate":

| System | Current (browser) | Native replacement | Migration risk |
|---|---|---|---|
| Physics | `@dimforge/rapier3d-compat` (WASM) | `rapier3d` (native Rust crate, same author/engine) | **Low** — same engine, different build target |
| Model loading | three.js `GLTFLoader`/`FBXLoader` | `ufbx` (single-file FBX loader) + `fastgltf`/`cgltf`, or Assimp for both | **Low** — assets are already portable GLB/FBX |
| Networking | PeerJS (WebRTC signaling + data channels) | `libdatachannel` (native C++ WebRTC data channels, browser-interop compatible) | **Medium** — same protocol family, but `server.js`'s signaling logic and any browser-peer interop need re-verification |
| Audio | Howler.js (sample layer) + Web Audio API (synth buses/compressor) | A native audio library (e.g. miniaudio) rebuilding the bus/ducking graph from scratch | **Medium-high** — no direct port, the sub-bus routing in `audio_engine.ts` is custom logic that has to be redesigned, not translated |
| UI/HUD/Menu | DOM + CSS (`menu_halo.css`, `dom_ui.ts`, Intel Records terminal, dev console) | Immediate-mode UI (Dear ImGui) for tooling; fully custom draw-based UI for in-game HUD/menu | **High** — this is greenfield work; there is no library that ports HTML/CSS layout to a native renderer |
| Windowing/input | Browser (pointer lock, gamepad API, DOM events) | GLFW or SDL3 | **Low** — well-trodden ground |

Research on realistic solo/small-team timelines (industry sources, not specific to this project):

- Minimal proof-of-concept (textured model, camera, input): **2–6 weeks**.
- Basic engine using libraries for the heavy lifting (physics, GPU abstraction, asset loading): **3–6 months**.
- Robust hobby engine — clean API, editor/tooling, more features: **6–12+ months**.
- Production-quality engine (animation systems, resource management, advanced renderer, tooling, cross-platform polish): **multiple years, or a small team**.

This project is not "a basic engine" — it's a specific game with per-enemy AI brains, layered skinned animation, a dev-console live-tuning system, peer-to-peer coop, a custom particle system, and a from-scratch UI/menu shell. Even leaning hard on libraries for the generic 20% (GPU abstraction, physics, model loading, windowing), the game-specific 80% — the 24,584-line main loop plus 6,500 lines of supporting modules — still has to be redesigned around a completely different execution model (no DOM, no CSS, no browser event loop, manual GPU resource lifetime management). **A realistic estimate for feature parity with the current build is 12–24 months solo, full-time equivalent**, even choosing the leanest path (Option B or C, not Option A).

## Consequences

**What becomes easier:**
- True control over frame timing — no JS garbage collector pauses, no browser compositor overhead.
- Multithreaded draw-call submission — directly attacks the `jsFrameMs` bottleneck measured above in a way the browser never allows.
- No more shader-cache relink stalls — native pipeline state objects are compiled once, explicitly, not implicitly triggered by a light-count change.
- Full control over the asset pipeline — can pre-bake/optimize formats however's fastest, not however the browser's loaders expect.

**What becomes harder:**
- Iteration loop — no more "edit a `.js` file, refresh the tab." Native builds need a compile step; hot-reload tooling has to be built deliberately.
- Distribution — no more "share a URL." Installers, updates, and per-platform builds become the team's responsibility.
- Every non-renderer system (audio bus routing, UI/menu, netcode signaling-interop) becomes a redesign, not a port — this is the majority of the real cost, not the renderer itself.
- All the perf workarounds already tuned into this repo (light-count invariant, `collapseStaticDrawCalls`, adaptive render scale, WebGPU-avoidance) become moot — replaced by an entirely different set of native-specific tuning concerns.
- Losing the existing three.js ecosystem (`three-mesh-bvh`, GLTFLoader ecosystem, browser devtools profiling) in exchange for a native toolchain that has to be assembled from scratch.

**What we'll need to revisit:**
- Final abstraction/language choice (Option B in C++ vs. Option C in Rust) — the Rapier-reuse argument favors Rust, but audio/UI ecosystem maturity favors C++; this should be settled *after* the spike below, not before.
- Whether this is a full cutover or a permanent dual-build (keep the browser version shipping as the "wide reach" build, native as the "performance" build) — a real product decision, not just technical.
- Scope cut for v1 native parity — likely not everything (e.g., coop netcode) needs to ship in the first native milestone.

## Action Items

1. [ ] **Spike (2–3 weeks):** minimal native prototype — window + triangle via the chosen GPU abstraction (recommend starting with Diligent Engine or bgfx for Option B, since both are more turnkey than raw Vulkan), load one existing GLB from `assets/`, orbit camera. This validates the toolchain and gives real data to settle the Option B vs. C decision, before committing further.
2. [ ] Decide abstraction + language from spike experience. Recommend **against** Option A (raw triple-backend) given the current single-project, likely-solo scope.
3. [ ] Port physics: swap `@dimforge/rapier3d-compat` → native `rapier3d` crate (low risk, same engine).
4. [ ] Stand up native asset loading (`ufbx` + `fastgltf`/`cgltf`) against the existing `assets/` files as-is — no re-export needed.
5. [ ] Design the native UI/HUD/menu system from scratch (Dear ImGui for dev-console-equivalent tooling; a custom draw-based system for the in-game HUD and the Halo-CE-style menu shell) — treat this as new design work, not a port of `menu_halo.css`.
6. [ ] Networking: adopt `libdatachannel`; re-verify against `server.js`'s existing PeerJS signaling — decide whether browser/native cross-play is a requirement or gets dropped.
7. [ ] Port the gameplay loop incrementally (weapons → AI → wave director → menu flow), treating the current `three_fps_game.ts` as the **functional spec**, not code to transliterate line-by-line.
8. [ ] Keep the existing three.js build shipping throughout — strangler-fig migration, not a flag-day cutover.
9. [ ] Reuse the diagnostics already built into this repo (`__rbDraws()`, `__rbCountLights()`, `__rbTest.getFrameStats()`) as the benchmark target the native build has to beat, not just "feels faster."

## Cheaper alternative worth running first (not a replacement for the above — a parallel checkpoint)

The `jsFrameMs ≈ 15/16.6ms` finding means real gains are available in the *current* engine, cheaply: batching the 1,864 unmerged enemy/particle/prop draws, moving AI/physics work off the main thread via Web Workers, and cutting from 17 down to fewer real-time lights. That's a **1–2 week effort** with measurable, testable payoff (`__rbDraws()`/`__rbCountLights()` before/after), versus a 12–24 month rewrite. This doesn't argue against the native goal — it changes how urgent it is, and gives a concrete "how much is actually left on the table in-browser" number before committing a year to the alternative.
