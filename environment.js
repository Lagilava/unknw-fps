// environment.js
// Full replacement: map data, helpers, procedural textures, level geometry, sky, and optimized room lighting.
(function () {
  "use strict";

  // ── Developer Engine hook ──────────────────────────────────────────────────
  // Read the resolved dev-config snapshot straight from localStorage (classic
  // script — no ES import). Only categories a developer explicitly activated are
  // present; absent categories fall through to the built-in constants below so
  // default behavior is byte-for-byte unchanged.
  let DEV_ACTIVE = (function readDevActive() {
    try {
      const raw = localStorage.getItem("rb-dev-active-v1");
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  })();

  // Live-update hook: the game calls this on a dev re-apply so a subsequent
  // setupEnvironmentLighting() picks up new lighting/quality overrides WITHOUT a
  // page reload. (MAP/CELL are structural and only read once at load, by design.)
  function applyDevOverrides(next) {
    DEV_ACTIVE = next && typeof next === "object" ? next : {};
  }

  function devMapRows() {
    const m = DEV_ACTIVE.map;
    if (m && Array.isArray(m.rows) && m.rows.length >= 3) {
      const w = m.rows[0].length;
      if (w >= 3 && m.rows.every((r) => typeof r === "string" && r.length === w)) return m.rows.slice();
    }
    return null;
  }

  // UNKNW outdoor arena — open urban plaza with freestanding tall cover "islands"
  // (each is '#', so enemy pathfinding routes around them). Boundary + north wall
  // (row 0) + the three south exit doors (row 39) preserved so the facade, exterior
  // seam, spawn (~mx16-17,my20) and pack-a-punch (~mx16-17,my15) stay aligned.
  // Generated + validated (see scratchpad/genmap.mjs): every row is exactly 34 wide,
  // spawn / pack / all three door approaches kept clear.
  const BUILTIN_MAP = [
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

  // A dev preset may replace the whole grid; otherwise the built-in map is used.
  const MAP = devMapRows() || BUILTIN_MAP;

  const MAP_W = MAP[0].length;
  const MAP_H = MAP.length;
  const CELL = (DEV_ACTIVE.map && Number.isFinite(DEV_ACTIVE.map.cell) && DEV_ACTIVE.map.cell > 0)
    ? DEV_ACTIVE.map.cell
    : 4;
  const MAP_WORLD_ANCHOR_H = 20;
  const MAP_WORLD_CENTER_Z = (MAP_H - MAP_WORLD_ANCHOR_H) * CELL * 0.5;
  const WALL_H = 5;
  const PLAYER_H = 1.65;
  // Open-air outdoor arena: skip the roof/ceiling and indoor light fixtures so the play
  // space is a walled outdoor plaza under the daytime sky (grid collision/nav unchanged).
  const OUTDOOR_MODE = true;

  for (let y = 0; y < MAP.length; y++) {
    if (MAP[y].length !== MAP_W) {
      throw new Error(`Invalid MAP row ${y}: expected ${MAP_W}, got ${MAP[y].length}`);
    }
  }

  const ROOM_LIGHTS = [
    // Primary overhead banks — bright cool-white office fluorescents
    { x: 0,   y: 4.88, z: 0,   color: 0xf4f8ff, i: 7.8,  d: 42, real: true },
    { x: -14, y: 4.84, z: 0,   color: 0xecf4ff, i: 5.2,  d: 36, real: true },
    { x: 14,  y: 4.84, z: 0,   color: 0xecf4ff, i: 5.2,  d: 36, real: true },
    { x: 0,   y: 4.84, z: -14, color: 0xeef5ff, i: 4.8,  d: 34, real: true },
    { x: 0,   y: 4.84, z: 14,  color: 0xeef5ff, i: 4.8,  d: 34, real: true },

    // Secondary mid-room fill lights
    { x: -8,  y: 4.72, z: -8,  color: 0xf0f6ff, i: 3.8,  d: 28, real: true },
    { x: 8,   y: 4.72, z: 8,   color: 0xf0f6ff, i: 3.8,  d: 28, real: true },
    { x: -8,  y: 4.72, z: 8,   color: 0xf0f6ff, i: 3.6,  d: 28, real: true },
    { x: 8,   y: 4.72, z: -8,  color: 0xf0f6ff, i: 3.6,  d: 28, real: true },

    // Corner fill — neutral cool-white, same family as the primary banks
    { x: -14, y: 4.60, z: -14, color: 0xf0f5ff, i: 2.4,  d: 22, real: true },
    { x: 14,  y: 4.60, z: 14,  color: 0xf0f5ff, i: 2.4,  d: 22, real: true },
    { x: -14, y: 4.60, z: 14,  color: 0xeef4ff, i: 2.2,  d: 22, real: true },
    { x: 14,  y: 4.60, z: -14, color: 0xeef4ff, i: 2.2,  d: 22, real: true },

    // Extended south zone coverage
    { x: -12, y: 4.68, z: 30,  color: 0xedf4ff, i: 3.8,  d: 30, real: true },
    { x: 12,  y: 4.68, z: 30,  color: 0xedf4ff, i: 3.8,  d: 30, real: true },
    { x: 0,   y: 4.70, z: 40,  color: 0xeef6ff, i: 4.2,  d: 32, real: true },
    { x: -12, y: 4.68, z: 54,  color: 0xedf4ff, i: 3.4,  d: 28, real: true },
    { x: 12,  y: 4.68, z: 54,  color: 0xedf4ff, i: 3.4,  d: 28, real: true },
    { x: -10, y: 4.66, z: 70,  color: 0xebf3ff, i: 3.0,  d: 26, real: true },
    { x: 10,  y: 4.66, z: 70,  color: 0xebf3ff, i: 3.0,  d: 26, real: true },

    // Low-hung ambient fill (wall-wash glow at mid-height)
    { x: -16, y: 2.60, z: 0,   color: 0xd8e8ff, i: 1.8,  d: 16, real: true },
    { x: 16,  y: 2.60, z: 0,   color: 0xd8e8ff, i: 1.8,  d: 16, real: true },
    { x: 0,   y: 2.60, z: -16, color: 0xd8e8ff, i: 1.6,  d: 14, real: true },
    { x: 0,   y: 2.60, z: 30,  color: 0xd8e8ff, i: 1.6,  d: 14, real: true },
  ];

  function mapToWorld(mx, my) {
    return {
      x: (mx - MAP_W * 0.5 + 0.5) * CELL,
      z: (my - MAP_WORLD_ANCHOR_H * 0.5 + 0.5) * CELL,
    };
  }

  function worldToMap(x, z) {
    return {
      mx: Math.floor(x / CELL + MAP_W * 0.5),
      my: Math.floor(z / CELL + MAP_WORLD_ANCHOR_H * 0.5),
    };
  }

  function wallAt(mx, my) {
    if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) return true;
    return MAP[my][mx] === "#";
  }

  function wallAtWorld(x, z) {
    const c = worldToMap(x, z);
    if (c.mx < 0 || c.my < 0 || c.mx >= MAP_W || c.my >= MAP_H) {
      return window.__extWallAt ? window.__extWallAt(x, z, 0) : true;
    }
    return wallAt(c.mx, c.my);
  }

  function wallAtWorldRadius(x, z, radius) {
    const d = radius * 0.7071;
    return (
      wallAtWorld(x, z) ||
      wallAtWorld(x + radius, z) ||
      wallAtWorld(x - radius, z) ||
      wallAtWorld(x, z + radius) ||
      wallAtWorld(x, z - radius) ||
      wallAtWorld(x + d, z + d) ||
      wallAtWorld(x + d, z - d) ||
      wallAtWorld(x - d, z + d) ||
      wallAtWorld(x - d, z - d)
    );
  }

  function isOpenCell(mx, my) {
    return mx >= 0 && my >= 0 && mx < MAP_W && my < MAP_H && MAP[my][mx] !== "#";
  }

  function cellCenter(mx, my) {
    return mapToWorld(mx, my);
  }

  function seededRandom(seedText) {
    let seed = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
      seed ^= seedText.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }

    return function () {
      seed += 0x6d2b79f5;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clearEnvironmentLighting(scene) {
    const toRemove = [];

    scene.traverse(obj => {
      if (obj && obj.userData && obj.userData.environmentLight === true) {
        toRemove.push(obj);
      }
    });

    for (const obj of toRemove) {
      if (obj.parent) obj.parent.remove(obj);
    }
  }

  // Apply dev lighting overrides (multipliers + additive point count) on top of
  // the auto-selected device profile. No dev preset → identity, profile unchanged.
  function applyDevLighting(profile) {
    const L = DEV_ACTIVE.lighting;
    if (L && typeof L === "object") {
      const mul = (v, m) => (Number.isFinite(v) && Number.isFinite(m) ? v * m : v);
      profile.ambient = mul(profile.ambient, L.ambientMul);
      profile.hemi = mul(profile.hemi, L.hemiMul);
      profile.dir = mul(profile.dir, L.dirMul);
      profile.pointIntensity = mul(profile.pointIntensity, L.pointIntensityMul);
      profile.bounceIntensity = mul(profile.bounceIntensity, L.bounceIntensityMul);
      if (Number.isFinite(L.pointDecay)) profile.pointDecay = Math.max(0.1, L.pointDecay);
      if (Number.isFinite(L.pointCountAdd)) profile.pointCount = Math.max(0, Math.round(profile.pointCount + L.pointCountAdd));
    }
    // Performance preset (independent of the lighting category): hard cap on
    // active interior point lights, for weaker GPUs on all devices.
    const cap = DEV_ACTIVE.quality && Number.isFinite(DEV_ACTIVE.quality.maxActiveLights)
      ? DEV_ACTIVE.quality.maxActiveLights : 0;
    if (cap > 0) profile.pointCount = Math.min(profile.pointCount, cap);
    return profile;
  }

  function getLightingProfile(renderer) {
    return applyDevLighting(getBaseLightingProfile(renderer));
  }

  function getBaseLightingProfile(renderer) {
    const caps = renderer?.capabilities || {};
    const rendererName = renderer?.constructor?.name || "";
    const isWebGPU = !!renderer?.isWebGPURenderer || /WebGPU/i.test(rendererName);
    const maxTextures = caps.maxTextures || (isWebGPU ? 32 : 8);
    const maxAnisotropy = caps.getMaxAnisotropy ? caps.getMaxAnisotropy() : (isWebGPU ? 8 : 1);
    const isWebGL2 = !!caps.isWebGL2;
    const modernRenderer = isWebGPU || isWebGL2;

    const cores = navigator.hardwareConcurrency || 4;
    // deviceMemory is only exposed on secure contexts (localhost / HTTPS).
    // Treat undefined (LAN http:// origins) as capable rather than downgrading.
    const memoryRaw = navigator.deviceMemory;
    const memoryKnown = typeof memoryRaw === "number";
    const memory = memoryKnown ? memoryRaw : 8;
    const ua = navigator.userAgent || "";
    const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

    const weakGpu = !modernRenderer || maxTextures < 8 || maxAnisotropy < 2;
    const low  = mobile || cores <= 2 || (memoryKnown && memory <= 2) || weakGpu;
    const high = !mobile && modernRenderer && cores >= 8 && memory >= 8 && maxTextures >= 16;

    if (low) {
      return {
        tier: "low",
        ambient: 0.26,
        hemi: 0.32,
        dir: 0.94,
        pointCount: 2,
        pointIntensity: 19.3,
        pointDistanceScale: 1.28,
        pointDecay: 2.0,
        bounceCount: 1,
        bounceIntensity: 0.48,
        areaCount: 0,
        lightMapSize: 384,
        lightMapIntensity: 0.58,
      };
    }

    if (high) {
      return {
        tier: "high",
        ambient: 0.22,
        hemi: 0.34,
        dir: 1.10,
        pointCount: 5,
        pointIntensity: 20.0,
        pointDistanceScale: 1.30,
        pointDecay: 2.0,
        bounceCount: 2,
        bounceIntensity: 0.54,
        areaCount: 0,         // area lights removed — too expensive
        lightMapSize: 768,
        lightMapIntensity: 0.70,
      };
    }

    return {
      tier: "medium",
      ambient: 0.24,
      hemi: 0.32,
      dir: 1.02,
      pointCount: 3,
      pointIntensity: 19.6,
      pointDistanceScale: 1.28,
      pointDecay: 2.0,
      bounceCount: 1,
      bounceIntensity: 0.52,
      areaCount: 0,           // area lights removed — too expensive
      lightMapSize: 512,
      lightMapIntensity: 0.64,
    };
  }

  function createSurfaceLightMapTexture(THREE, renderer, profile, surface) {
    const size = profile.lightMapSize || 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    const base = surface === "ceiling" ? 98 : 76;
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, size, size);

    const worldW = MAP_W * CELL;
    const worldH = MAP_H * CELL;
    const toCanvasX = x => (x / worldW + 0.5) * size;
    const toCanvasY = z => (1 - ((z - MAP_WORLD_CENTER_Z) / worldH + 0.5)) * size;
    const rng = seededRandom(`surface-lightmap-${surface}`);

    ctx.globalCompositeOperation = "screen";
    for (const light of ROOM_LIGHTS) {
      if (!light.real || light.y < 3) continue;
      const x = toCanvasX(light.x);
      const y = toCanvasY(light.z);
      const distToSurface = surface === "ceiling" ? Math.max(0.1, WALL_H - light.y) : Math.max(0.1, light.y);
      const projR = distToSurface < light.d ? Math.sqrt(light.d * light.d - distToSurface * distToSurface) : light.d * 0.1;
      const radius = Math.max(18, (projR / worldW) * size * (surface === "ceiling" ? 0.95 : 1.55));
      const strength = Math.min(0.52, 0.14 + light.i * (surface === "ceiling" ? 0.035 : 0.024));
      const grad = ctx.createRadialGradient(x, y, 1, x, y, radius);
      grad.addColorStop(0.00, `rgba(255,255,255,${strength.toFixed(3)})`);
      grad.addColorStop(0.28, `rgba(220,236,255,${(strength * 0.58).toFixed(3)})`);
      grad.addColorStop(0.72, `rgba(150,178,205,${(strength * 0.18).toFixed(3)})`);
      grad.addColorStop(1.00, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 30; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const rx = size * (0.08 + rng() * 0.18);
      const ry = size * (0.03 + rng() * 0.08);
      const grad = ctx.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry));
      grad.addColorStop(0, `rgba(185,195,205,${(0.025 + rng() * 0.035).toFixed(3)})`);
      grad.addColorStop(1, "rgba(255,255,255,1)");
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, ry / Math.max(1, rx));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(renderer?.capabilities?.getMaxAnisotropy?.() || 1, 4);
    tex.needsUpdate = true;
    return tex;
  }

  function scoreRoomLight(light, index) {
    const centerWeight = Math.max(0, 1 - Math.hypot(light.x, light.z) / 42);
    const southWeight = light.z > 24 ? 0.24 : 0;
    // Favour the most central light as hero rather than blindly picking index 0
    const centralBonus = centerWeight > 0.85 ? 2.5 : centerWeight > 0.55 ? 1.2 : 0;
    // Warm corner accents and cool fills both carry a small variety bonus
    const colorVarietyBonus =
      light.color === 0xffe8c8 ? 0.18 :  // warm south-east corner
      light.color === 0xffd8d8 ? 0.18 :  // warm north-east corner
      light.color === 0xdde4ff ? 0.10 :  // cool north-west corner
      light.color === 0xe0ffee ? 0.10 :  // cool south-west corner
      light.color === 0xd8e8ff ? 0.06 :  // low-hung wall-wash fills
      0.0;

    return light.i * 1.35 + centerWeight * 1.25 + southWeight + centralBonus + colorVarietyBonus;
  }

  function tagEnvironmentLight(light) {
    light.userData.environmentLight = true;
    return light;
  }

  function setupEnvironmentLighting(THREE, scene, renderer) {
    clearEnvironmentLighting(scene);

    const profile = getLightingProfile(renderer);
    scene.userData.environmentLightingProfile = profile;

    const devLight = DEV_ACTIVE.lighting || {};
    const hexOr = (v, fallback) => {
      if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v)) return fallback;
      return parseInt(v.slice(1), 16);
    };

    // Warm filament ambient — fills shadows so far walls don't go pitch black
    const ambient = tagEnvironmentLight(
      new THREE.AmbientLight(hexOr(devLight.ambientColor, 0xfff4e4), profile.ambient)
    );
    scene.add(ambient);

    // Daytime hemisphere — bright sky-blue overhead, warm ground bounce.
    const hemi = tagEnvironmentLight(
      new THREE.HemisphereLight(
        hexOr(devLight.hemiSkyColor, 0xcfe2ff),
        hexOr(devLight.hemiGroundColor, 0x6a5f50),
        profile.hemi
      )
    );
    hemi.position.set(0, WALL_H + 6, MAP_WORLD_CENTER_Z);
    scene.add(hemi);

    // Broad overhead fill. Outdoors this is kept LOW so the exterior sun's cast shadows
    // aren't washed flat by a second directional; indoors it carries the room.
    const ceilFill = tagEnvironmentLight(
      new THREE.DirectionalLight(0xfff3e0, profile.dir * (OUTDOOR_MODE ? 0.35 : 1.35))
    );
    ceilFill.position.set(2, WALL_H + 10, MAP_WORLD_CENTER_Z + 8);
    ceilFill.target.position.set(0, 0, MAP_WORLD_CENTER_Z);
    ceilFill.castShadow = false;
    scene.add(ceilFill);
    scene.add(ceilFill.target);
    tagEnvironmentLight(ceilFill.target);

    const activeLights = ROOM_LIGHTS.filter(light =>
      light &&
      light.real &&
      Number.isFinite(light.x) &&
      Number.isFinite(light.y) &&
      Number.isFinite(light.z) &&
      Number.isFinite(light.i) &&
      light.i > 0 &&
      Number.isFinite(light.d) &&
      light.d > 0
    );

    const selectedLights = activeLights
      .map((light, index) => ({ light, score: scoreRoomLight(light, index) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, profile.pointCount)
      .map(entry => entry.light);

    for (let i = 0; i < selectedLights.length; i++) {
      const light = selectedLights[i];
      const isHero = i === 0;

      const point = tagEnvironmentLight(
        new THREE.PointLight(
          light.color,
          light.i * profile.pointIntensity * (isHero ? 1.18 : 1.0),
          light.d * profile.pointDistanceScale * (isHero ? 1.08 : 1.0),
          profile.pointDecay
        )
      );

      point.position.set(light.x, light.y - 0.28, light.z);
      point.castShadow = false;
      point.name = isHero ? "HeroCeilingLight" : "CeilingLight";
      scene.add(point);
    }

    if (THREE.RectAreaLight && profile.areaCount > 0) {
      for (let i = 0; i < Math.min(profile.areaCount, selectedLights.length); i++) {
        const light = selectedLights[i];
        const area = tagEnvironmentLight(
          new THREE.RectAreaLight(light.color, 2.4 + light.i * 0.18, 3.1, 1.15)
        );
        area.position.set(light.x, WALL_H - 0.16, light.z);
        area.rotation.x = -Math.PI * 0.5;
        area.name = "CeilingPanelAreaLight";
        scene.add(area);
      }
    }

    // Low-hung bounce fills simulate indirect light bounced from floor/walls.
    const bounceSeeds = [
      { x:  0,  z:  0,  color: 0xa0b4c8, distance: 36 },   // central cool floor bounce
      { x: -14, z: -14, color: 0xc8b090, distance: 26 },   // warm NW corner bounce
      { x:  14, z:  14, color: 0xaabcda, distance: 26 },   // cool SE corner bounce
      { x:  0,  z:  30, color: 0x9ab0c0, distance: 32 },   // south zone fill
      { x: -12, z:  54, color: 0xb8c8d8, distance: 28 },   // far south NW
      { x:  12, z:  54, color: 0xc8b898, distance: 28 },   // far south NE — warm contrast
    ];

    for (let i = 0; i < Math.min(profile.bounceCount, bounceSeeds.length); i++) {
      const seed = bounceSeeds[i];

      const bounce = tagEnvironmentLight(
        new THREE.PointLight(
          seed.color,
          profile.bounceIntensity,
          seed.distance,
          2.0
        )
      );

      bounce.position.set(seed.x, 0.85, seed.z);
      bounce.castShadow = false;
      bounce.name = "SoftBounceLight";
      scene.add(bounce);
    }
  }

  function loadMaterialTexture(THREE, renderer, url, repeatX, repeatY, color = false) {
    const tex = new THREE.TextureLoader().load(url);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 2);
    if (color) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function copyUvToUv2(geometry) {
    const uv = geometry.attributes.uv;
    if (uv && !geometry.attributes.uv2) geometry.setAttribute("uv2", uv.clone());
  }

  function loadEnvironmentMaterialMaps(THREE, renderer, kind, repeatX, repeatY) {
    const sets = {
      floor: {
        base: "assets/textures/floor/Concrete034_1K-JPG",
        color: "Color",
        normal: "NormalGL",
        roughness: "Roughness",
      },
      wall: {
        base: "assets/textures/wall/Metal063_1K-JPG",
        color: "Color",
        normal: "NormalGL",
        roughness: "Roughness",
      },
      ceiling: {
        base: "assets/textures/ceiling/OfficeCeiling001_1K-JPG",
        color: "Color",
        normal: "NormalGL",
        roughness: "Roughness",
      },
    };

    const set = sets[kind];
    const maps = {
      map: loadMaterialTexture(THREE, renderer, `${set.base}_${set.color}.jpg`, repeatX, repeatY, true),
      normalMap: loadMaterialTexture(THREE, renderer, `${set.base}_${set.normal}.jpg`, repeatX, repeatY),
      roughnessMap: loadMaterialTexture(THREE, renderer, `${set.base}_${set.roughness}.jpg`, repeatX, repeatY),
    };

    if (set.metalness) {
      maps.metalnessMap = loadMaterialTexture(
        THREE,
        renderer,
        `${set.base}_${set.metalness}.jpg`,
        repeatX,
        repeatY
      );
    }

    return maps;
  }

  function makePatternTexture(THREE, renderer, kind) {
    const size = kind === "wall" ? 256 : 224;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    const rand = seededRandom(kind);

    if (kind === "floor") {
      ctx.fillStyle = "#2c353f";
      ctx.fillRect(0, 0, size, size);

      const cx = size * 0.5;
      const cy = size * 0.5;
      const tile = size / 8;

      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const px = x * tile;
          const py = y * tile;
          const dx = px + 8 - cx;
          const dy = py + 8 - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) / 90;
          const bounce = Math.max(0, 1 - dist) * 9;

          const base = 38 + ((x + y) % 2) * 6 + Math.floor(rand() * 4) + bounce;
          ctx.fillStyle = `rgb(${base + 2}, ${base + 5}, ${base + 8})`;
          ctx.fillRect(px, py, tile, tile);

          ctx.fillStyle = `rgba(255,255,255,${0.025 + rand() * 0.03})`;
          ctx.fillRect(px + 1, py + 1, tile - 2, 1 + rand() * 2);

          ctx.fillStyle = `rgba(0,0,0,${0.045 + rand() * 0.06})`;
          ctx.fillRect(px + rand() * 4, py + rand() * 4, tile * 0.22 + rand() * 3, 1 + rand() * 2);
        }
      }

      ctx.strokeStyle = "rgba(0,0,0,0.42)";
      ctx.lineWidth = 1.1;

      for (let i = 0; i <= 8; i++) {
        const p = i * tile + 0.5;

        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, size);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(size, p);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(210,230,245,0.045)";
      for (let i = 0; i < 30; i++) {
        ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 7, 1);
      }

      ctx.fillStyle = "rgba(0,0,0,0.12)";
      for (let i = 0; i < 52; i++) {
        ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 6, 1 + rand() * 4);
      }

      ctx.fillStyle = "rgba(16,22,30,0.08)";
      for (let i = 0; i < 18; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const w = 12 + rand() * 18;
        ctx.fillRect(x, y, w, 2 + rand() * 3);
      }

      ctx.fillStyle = "rgba(255,255,255,0.02)";
      for (let i = 0; i < 26; i++) {
        ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 10, 1 + rand() * 2);
      }

      for (let i = 0; i < 18; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const r = 8 + rand() * 22;
        const oil = ctx.createRadialGradient(x, y, 1, x, y, r);
        oil.addColorStop(0, `rgba(12,18,22,${0.10 + rand() * 0.06})`);
        oil.addColorStop(0.55, `rgba(58,70,76,${0.035 + rand() * 0.035})`);
        oil.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = oil;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      ctx.strokeStyle = "rgba(210,232,246,0.055)";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 42; i++) {
        const x = rand() * size;
        const y = rand() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 8 + rand() * 28, y + (rand() - 0.5) * 3);
        ctx.stroke();
      }
    } else if (kind === "wall") {
      ctx.fillStyle = "#8a97a4";
      ctx.fillRect(0, 0, size, size);

      const tile = size / 8;
      for (let y = 0; y < 8; y++) {
        const rowOffset = (y % 2) * (tile * 0.5);

        for (let x = -1; x < 8; x++) {
          const px = x * tile + rowOffset;
          const py = y * tile;

          const heightLight = Math.max(0, 1 - Math.abs(py - 34) / 90) * 8;
          const r = 116 + ((x + y) % 3) * 6 + Math.floor(rand() * 5) + heightLight;
          const g = 128 + (y % 2) * 5 + Math.floor(rand() * 5) + heightLight;
          const b = 140 + (x % 2) * 5 + Math.floor(rand() * 5) + heightLight;

          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(px, py, tile, tile);

          ctx.fillStyle = "rgba(255,255,255,0.035)";
          ctx.fillRect(px + 1, py + 1, tile * 0.28, 1.5 + rand() * 2);

          ctx.fillStyle = "rgba(0,0,0,0.08)";
          ctx.fillRect(px + tile * 0.15, py + tile * 0.72, tile * 0.72, 1 + rand() * 2);

          ctx.strokeStyle = "rgba(12,16,28,0.34)";
          ctx.strokeRect(px + 0.5, py + 0.5, tile - 1, tile - 1);
        }
      }

      ctx.fillStyle = "rgba(0,0,0,0.13)";
      for (let i = 0; i < 70; i++) {
        ctx.fillRect(rand() * size, rand() * size, 4 + rand() * 18, 1 + rand() * 5);
      }

      ctx.fillStyle = "rgba(255,255,255,0.06)";
      for (let i = 0; i < 36; i++) {
        ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 4, 2 + rand() * 10);
      }

      ctx.strokeStyle = "rgba(62,72,84,0.24)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const x = rand() * size;
        const y = rand() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 24, y + (rand() - 0.5) * 18);
        ctx.stroke();
      }

      for (let i = 0; i < 20; i++) {
        const x = rand() * size;
        const y = rand() * size * 0.35;
        const h = 18 + rand() * 74;
        const w = 2 + rand() * 7;
        const drip = ctx.createLinearGradient(x, y, x, y + h);
        drip.addColorStop(0, `rgba(12,18,24,${0.10 + rand() * 0.07})`);
        drip.addColorStop(1, "rgba(12,18,24,0)");
        ctx.fillStyle = drip;
        ctx.fillRect(x, y, w, h);
      }

      ctx.strokeStyle = "rgba(220,238,248,0.08)";
      ctx.lineWidth = 0.75;
      for (let i = 0; i < 30; i++) {
        const x = rand() * size;
        const y = rand() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 38, y + (rand() - 0.5) * 8);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = "#303943";
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = "rgba(178,202,224,0.12)";
      ctx.lineWidth = 2;

      for (let i = 0; i < 12; i++) {
        const x = (i * 13) % size;
        const y = (i * 19) % size;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }

      const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 80);
      gradient.addColorStop(0, "rgba(180,205,235,0.08)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      ctx.fillStyle = "rgba(0,0,0,0.18)";
      for (let i = 0; i < 38; i++) {
        ctx.fillRect(rand() * size, rand() * size, 4 + rand() * 14, 1);
      }

      ctx.strokeStyle = "rgba(220,240,255,0.08)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 20; i++) {
        const x = rand() * size;
        const y = rand() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 26, y + (rand() - 0.5) * 26);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(5,9,14,0.12)";
      for (let i = 0; i < 18; i++) {
        ctx.fillRect(rand() * size, rand() * size, 10 + rand() * 28, 2 + rand() * 4);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    tex.needsUpdate = true;

    return tex;
  }

  function makeBumpTexture(THREE, renderer, kind) {
    const size = kind === "wall" ? 256 : 224;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const rand = seededRandom(kind + "-bump");
    const base = kind === "floor" ? 118 : kind === "wall" ? 132 : 108;

    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, size, size);

    const grid = kind === "wall" ? 8 : 7;
    const tile = size / grid;
    ctx.strokeStyle = `rgb(${base - 42},${base - 42},${base - 42})`;
    ctx.lineWidth = kind === "ceiling" ? 1.2 : 1.5;

    for (let i = 0; i <= grid; i++) {
      const p = i * tile + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }

    for (let i = 0; i < (kind === "floor" ? 92 : 64); i++) {
      const tone = base + Math.floor((rand() - 0.5) * 70);
      ctx.fillStyle = `rgba(${tone},${tone},${tone},${0.18 + rand() * 0.22})`;
      ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 24, 1 + rand() * 5);
    }

    ctx.strokeStyle = `rgba(${base + 55},${base + 55},${base + 55},0.28)`;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 36; i++) {
      const x = rand() * size;
      const y = rand() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 32, y + (rand() - 0.5) * 20);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    tex.needsUpdate = true;
    return tex;
  }

  function makeInstancedBoxes(THREE, scene, geometry, material, items, castShadow, receiveShadow) {
    if (!items.length) return null;

    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      position.set(item.x, item.y, item.z);
      quaternion.setFromEuler(new THREE.Euler(item.rx || 0, item.ry || 0, item.rz || 0));
      scale.set(item.sx || 1, item.sy || 1, item.sz || 1);

      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = !!castShadow;
    mesh.receiveShadow = !!receiveShadow;
    scene.add(mesh);

    return mesh;
  }

  // Adds only the outdoor fill light. The night-sky dome/moon-halos/starfield this
  // function used to paint were built invisible every load (`visible = false` — the
  // real HDR skybox in three_fps_game.js:buildSkyEnvironment is the one visible sky)
  // and cost real canvas/geometry work for nothing, so that dead code was removed.
  function buildEveningSky(THREE, scene) {
    // ── Daytime sun directional — warm white wash on the exterior backdrop ──
    // Low fill only outdoors — the exterior sun is the real key/shadow light, so this
    // must not double it up and flatten the shadows.
    const moonlight = new THREE.DirectionalLight(0xffd9a6, OUTDOOR_MODE ? 0.2 : 1.4);
    moonlight.position.set(0.86, 0.30, 0.18).normalize();
    moonlight.castShadow = false;
    moonlight.userData.environmentLight = true;
    scene.add(moonlight);
  }
  // ---------------------------------------------------------------------------
  // North-wall glass — three room-width window bands looking out to the exterior
  // ---------------------------------------------------------------------------
  function buildNorthWindowGlass(THREE, scene, wallMeshes) {
    const northZ = mapToWorld(0, 0).z; // wall cell centres at z = -38

    // Materials
    const glassMat = new THREE.MeshStandardMaterial({
      color:       0x8ab8cc,
      transparent: true,
      opacity:     0.22,
      roughness:   0.04,
      metalness:   0.08,
      side:        THREE.DoubleSide,
      depthWrite:  false,
      envMapIntensity: 0.5,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color:    0x1c2530,
      roughness: 0.36,
      metalness: 0.80,
    });
    const sillMat = new THREE.MeshStandardMaterial({
      color:    0x222d3a,
      roughness: 0.44,
      metalness: 0.68,
    });

    // Three window groups, one per room
    const windowGroups = [
      { startCol: 1,  endCol: 10 },
      { startCol: 12, endCol: 21 },
      { startCol: 23, endCol: 32 },
    ];

    const paneH   = WALL_H - 0.52;
    const paneY   = paneH * 0.5 + 0.28;
    const glassZ  = northZ;          // same z-centre as the wall cells we removed
    const frameZ  = northZ - 0.01;  // frames sit just outside the glass

    for (const grp of windowGroups) {
      const xStart = mapToWorld(grp.startCol, 0).x - CELL * 0.5;
      const xEnd   = mapToWorld(grp.endCol,   0).x + CELL * 0.5;
      const width  = xEnd - xStart;
      const cx     = (xStart + xEnd) * 0.5;

      // --- Glass pane (full group width, thin)
      const glassGeo = new THREE.BoxGeometry(width - 0.22, paneH, 0.06);
      const glass    = new THREE.Mesh(glassGeo, glassMat);
      glass.position.set(cx, paneY, glassZ);
      glass.frustumCulled = false;
      scene.add(glass);
      wallMeshes.push(glass);   // bullets stop at glass

      // --- Bottom sill
      const sillGeo = new THREE.BoxGeometry(width + 0.12, 0.14, 0.28);
      const sill    = new THREE.Mesh(sillGeo, sillMat);
      sill.position.set(cx, 0.24, frameZ - 0.10);
      scene.add(sill);

      // --- Top header
      const header = new THREE.Mesh(sillGeo, sillMat);
      header.position.set(cx, WALL_H - 0.24, frameZ - 0.10);
      scene.add(header);

      // --- Side jambs
      const jambGeo = new THREE.BoxGeometry(0.12, WALL_H, 0.28);
      [-1, 1].forEach(side => {
        const jamb = new THREE.Mesh(jambGeo, frameMat);
        jamb.position.set(cx + side * (width * 0.5 - 0.04), WALL_H * 0.5, frameZ - 0.10);
        scene.add(jamb);
      });

      // --- Vertical mullions dividing each group into three equal panes
      const paneCount = 3;
      for (let i = 1; i < paneCount; i++) {
        const mx = xStart + (width / paneCount) * i;
        const mullionGeo = new THREE.BoxGeometry(0.09, WALL_H, 0.22);
        const mullion    = new THREE.Mesh(mullionGeo, frameMat);
        mullion.position.set(mx, WALL_H * 0.5, frameZ - 0.06);
        scene.add(mullion);
      }

      // --- Thin horizontal mid-rail at roughly chest height
      const railGeo = new THREE.BoxGeometry(width - 0.22, 0.07, 0.14);
      const rail    = new THREE.Mesh(railGeo, frameMat);
      rail.position.set(cx, WALL_H * 0.46, frameZ - 0.04);
      scene.add(rail);
    }
  }

  function buildLevel(THREE, scene, renderer, wallMeshes) {
    scene.fog = new THREE.FogExp2(0xd8c4a8, 0.0042); // golden-hour haze matched to the HDR horizon so the distant skyline fades into it (density also set by applyWaveLighting)
    const lightingProfile = scene.userData.environmentLightingProfile || getLightingProfile(renderer);

    const floorMaps = loadEnvironmentMaterialMaps(THREE, renderer, "ceiling", MAP_W * 0.95, MAP_H * 0.95);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xb4bec8,
      ...floorMaps,
      lightMap: createSurfaceLightMapTexture(THREE, renderer, lightingProfile, "floor"),
      lightMapIntensity: lightingProfile.lightMapIntensity,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.72,
      metalness: 0.035,
      envMapIntensity: 0.42,
    });

    const floorGeo = new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL, 1, 1);
    floorGeo.rotateX(-Math.PI * 0.5);
    copyUvToUv2(floorGeo);

    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.z = MAP_WORLD_CENTER_Z;
    floor.receiveShadow = true;
    scene.add(floor);

    // Outdoor mode: no ceiling (open to the sky). Indoor mode builds it as before.
    let ceiling = null, ceilMat = null;
    if (!OUTDOOR_MODE) {
      const ceilMaps = loadEnvironmentMaterialMaps(THREE, renderer, "floor", MAP_W * 1.2, MAP_H * 1.2);
      ceilMat = new THREE.MeshStandardMaterial({
        color: 0xb8c3cf,
        ...ceilMaps,
        lightMap: createSurfaceLightMapTexture(THREE, renderer, lightingProfile, "ceiling"),
        lightMapIntensity: lightingProfile.lightMapIntensity * 0.92,
        normalScale: new THREE.Vector2(0.22, 0.22),
        roughness: 0.82,
        metalness: 0.02,
        envMapIntensity: 0.28,
        side: THREE.DoubleSide,
      });
      const ceilGeo = new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL, 1, 1);
      ceilGeo.rotateX(Math.PI * 0.5);
      copyUvToUv2(ceilGeo);
      ceiling = new THREE.Mesh(ceilGeo, ceilMat);
      ceiling.position.y = WALL_H;
      ceiling.position.z = MAP_WORLD_CENTER_Z;
      ceiling.receiveShadow = true;
      scene.add(ceiling);
    }

    const wallMaps = loadEnvironmentMaterialMaps(THREE, renderer, "wall", 1.15, 1.35);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xc0ccd8,
      ...wallMaps,
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: 0.64,
      metalness: 0.18,
      envMapIntensity: 0.34,
    });

    const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    copyUvToUv2(wallGeo);

    // North wall cells replaced by glass — keep corners and the two room-divider
    // pillar columns solid so each room gets its own distinct window band.
    // x=11 and x=22 stay solid → three window groups: [1-10], [12-21], [23-32]
    function isNorthWindowCell(cx, cy) {
      if (cy !== 0) return false;
      if (cx === 0 || cx === MAP_W - 1) return false;
      if (cx === 11 || cx === 22) return false;
      return true;
    }

    const wallPositions = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (MAP[y][x] === "#" && !isNorthWindowCell(x, y)) {
          wallPositions.push(mapToWorld(x, y));
        }
      }
    }

    const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallPositions.length);
    const wallMatrix = new THREE.Matrix4();

    for (let i = 0; i < wallPositions.length; i++) {
      const p = wallPositions[i];
      wallMatrix.makeTranslation(p.x, WALL_H * 0.5, p.z);
      walls.setMatrixAt(i, wallMatrix);
    }

    walls.instanceMatrix.needsUpdate = true;
    walls.castShadow = true;
    walls.receiveShadow = true;
    wallMeshes.push(walls);
    scene.add(walls);

    scene.userData.environmentSurfaces = { floor, ceiling, walls, floorMat, ceilMat, wallMat };

    scene.userData.propColliders = [];

    buildNorthWindowGlass(THREE, scene, wallMeshes);
    if (!OUTDOOR_MODE) buildCheapLightFixtures(THREE, scene); // no floating indoor lamps outdoors
    buildInteriorExteriorFacade(THREE, scene);
    // Cover is now the MAP-grid islands (pathfinding routes around them) rather than
    // free-floating prop crates, so the old soft-cover pass is disabled.
    // buildInteriorProps(THREE, scene);
  }

  // Interior cover / set-dressing — turns the empty rooms into a real combat map:
  // crate clusters, waist-high barriers (shoot-over cover) and tall server racks
  // (hard cover / sightline breaks). One shared box geometry + 3 shared materials, so
  // collapseStaticDrawCalls instances the whole set into ~3 draw calls. Every prop
  // registers an AABB in scene.userData.propColliders (the same list the player, enemy
  // and bullet collision all read). The central spawn / pack-a-punch room is left clear.
  function buildInteriorProps(THREE, scene) {
    if (!scene.userData.propColliders) scene.userData.propColliders = [];
    const pc = scene.userData.propColliders;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5f38, roughness: 0.82, metalness: 0.06 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x39424c, roughness: 0.45, metalness: 0.72 });
    const rackMat  = new THREE.MeshStandardMaterial({ color: 0x1c222a, roughness: 0.55, metalness: 0.60, emissive: new THREE.Color(0x1f6f4a), emissiveIntensity: 0.55 });

    function addProp(cx, cz, w, h, d, mat) {
      const m = new THREE.Mesh(box, mat);
      m.scale.set(w, h, d);
      m.position.set(cx, h * 0.5, cz);
      m.castShadow = true;   // cover casts daytime shadows
      m.receiveShadow = true;
      scene.add(m);
      pc.push({ minX: cx - w * 0.5, maxX: cx + w * 0.5, minZ: cz - d * 0.5, maxZ: cz + d * 0.5, minY: 0, maxY: h });
      return m;
    }

    // 3×3 room grid (world centres). Skip the centre room (spawn + pack station).
    const roomsX = [-44, 0, 44];
    const roomsZ = [-14, 38, 90];
    let variant = 0;
    for (const rx of roomsX) {
      for (const rz of roomsZ) {
        if (rx === 0 && rz === 38) continue;
        const flip = (variant++ % 2) === 0 ? 1 : -1; // mirror per room for variety
        // Crate cluster in one corner
        addProp(rx - 7.0 * flip, rz - 6.0, 2.2, 1.5, 2.2, crateMat);
        addProp(rx - 8.4 * flip, rz - 6.0, 1.4, 1.0, 1.4, crateMat);
        addProp(rx - 6.6 * flip, rz - 7.6, 1.2, 2.1, 1.2, crateMat);
        // Long waist-high barrier to shoot over
        addProp(rx + 5.5 * flip, rz + 5.0, 6.4, 1.05, 1.0, metalMat);
        // Tall server rack — hard cover / sightline break
        addProp(rx + 7.5 * flip, rz - 7.0, 1.5, 2.5, 3.0, rackMat);
        // Long L-lane wall (runs along z) — creates a flanking lane / sightline break
        addProp(rx + 1.5 * flip, rz + 8.5, 1.0, 1.35, 7.5, metalMat);
        // Mid-room block for staggered cover
        addProp(rx - 2.5 * flip, rz + 1.5, 2.6, 1.25, 1.8, crateMat);
      }
    }
  }

  function buildInteriorExteriorFacade(THREE, scene) {
    // Geometry constants derived from the MAP grid
    const TOTAL_W  = MAP_W * CELL;                          // 136
    const SOUTH_Z  = (MAP_H - 1 - MAP_WORLD_ANCHOR_H * 0.5 + 0.5) * CELL + CELL * 0.5; // exterior face of south wall
    const NORTH_Z  = (0     - MAP_WORLD_ANCHOR_H * 0.5 + 0.5) * CELL - CELL * 0.5;     // exterior face of north wall
    const EAST_X   =  MAP_W * CELL * 0.5;                  // +68
    const WEST_X   = -MAP_W * CELL * 0.5;                  // -68
    const TOTAL_D  = MAP_H * CELL;                          // 160

    // ── Canvas textures ────────────────────────────────────────────────────
    function makeFacadeTex(w, h) {
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      // Base concrete
      ctx.fillStyle = "#6e7278"; ctx.fillRect(0, 0, w, h);
      // Subtle aggregate noise
      const rng = (() => { let s=9312; return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; })();
      for (let i = 0; i < 6000; i++) {
        const v = 85 + Math.floor(rng() * 40);
        ctx.fillStyle = `rgba(${v},${v+2},${v+4},0.22)`;
        ctx.fillRect(rng()*w, rng()*h, 1+rng()*2, 1);
      }
      // Horizontal form-tie lines every ~2.5 m (40 px at 16px/m)
      ctx.strokeStyle = "rgba(40,40,40,0.18)"; ctx.lineWidth = 1.5;
      for (let y = 32; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
      // Vertical panel joints every ~4 m
      ctx.strokeStyle = "rgba(30,30,30,0.14)"; ctx.lineWidth = 1;
      for (let x = 64; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    function makeRoofTex() {
      const cv = document.createElement("canvas"); cv.width = 256; cv.height = 256;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#3a3d41"; ctx.fillRect(0, 0, 256, 256);
      const rng = (() => { let s=7777; return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; })();
      for (let i = 0; i < 4000; i++) {
        const v = 45 + Math.floor(rng()*30);
        ctx.fillStyle = `rgba(${v},${v},${v},0.3)`;
        ctx.fillRect(rng()*256, rng()*256, 1+rng()*3, 1+rng()*2);
      }
      // Tar seams
      ctx.strokeStyle = "rgba(20,20,20,0.35)"; ctx.lineWidth = 2;
      for (let y = 40; y < 256; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(256,y); ctx.stroke(); }
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    function makeWindowTex() {
      const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
      const ctx = cv.getContext("2d");
      // Dark tinted glass base
      ctx.fillStyle = "#1a2430"; ctx.fillRect(0, 0, 128, 128);
      // Interior glow variation
      const rng = (() => { let s=5151; return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; })();
      const g = ctx.createRadialGradient(64,80,0,64,64,90);
      g.addColorStop(0,"rgba(200,220,255,0.12)"); g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0,0,128,128);
      // Frame lines
      ctx.strokeStyle = "rgba(180,190,210,0.55)"; ctx.lineWidth = 3;
      ctx.strokeRect(4,4,120,120);
      ctx.beginPath(); ctx.moveTo(64,4); ctx.lineTo(64,124); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4,72); ctx.lineTo(124,72); ctx.stroke();
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    const facadeTex = makeFacadeTex(512, 256);
    facadeTex.repeat.set(8, 2);
    const roofTex   = makeRoofTex();
    roofTex.repeat.set(14, 18);
    const winTex    = makeWindowTex();

    const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.88, metalness: 0.04, color: 0xd0d4d8 });
    const roofMat   = new THREE.MeshStandardMaterial({ map: roofTex,   roughness: 0.95, metalness: 0.02, color: 0xb0b2b4 });
    const parapetMat= new THREE.MeshStandardMaterial({ map: facadeTex, roughness: 0.90, metalness: 0.02, color: 0xc8ccd0 });
    const winMat    = new THREE.MeshStandardMaterial({ map: winTex,    roughness: 0.15, metalness: 0.4,  color: 0x8aaec8, emissive: 0x0a1520, emissiveIntensity: 0.6 });
    const darkMat   = new THREE.MeshStandardMaterial({ roughness: 0.60, metalness: 0.55, color: 0x303438 });

    function box(w, h, d, x, y, z, mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); scene.add(m); return m;
    }

    // ── ROOF ──────────────────────────────────────────────────────────────
    // Outdoor mode: no roof slab or parapets — the plaza is open to the sky.
    const ROOF_TOP = WALL_H + 0.7; // kept defined for scope (used by rooftop details below)
    if (!OUTDOOR_MODE) {
      // Main roof slab — bottom face at y=WALL_H+0.15 to avoid z-fighting with interior ceiling plane at y=WALL_H
      box(TOTAL_W + 1.6, 0.55, TOTAL_D + 1.6, 0, WALL_H + 0.425, MAP_WORLD_CENTER_Z, roofMat);
      // Parapet — roof top is at WALL_H + 0.425 + 0.275 = WALL_H + 0.7; parapets sit on top of that
      box(TOTAL_W + 1.6, 1.4, 0.55, 0, ROOF_TOP + 0.7, SOUTH_Z + 0.275, parapetMat);
      box(TOTAL_W + 1.6, 1.0, 0.45, 0, ROOF_TOP + 0.5, NORTH_Z - 0.225, parapetMat);
      box(0.45, 1.0, TOTAL_D + 1.6, EAST_X + 0.225, ROOF_TOP + 0.5, MAP_WORLD_CENTER_Z, parapetMat);
      box(0.45, 1.0, TOTAL_D + 1.6, WEST_X - 0.225, ROOF_TOP + 0.5, MAP_WORLD_CENTER_Z, parapetMat);
    }

    // ── SOUTH FACADE ──────────────────────────────────────────────────────
    // South wall exits (row 39): ++ at mx=5-6, 16-17, 27-28
    // Exit world-x spans (cell edge to cell edge):
    //   Exit 1: -48 to -40  (centre x=-44)
    //   Exit 2:  -4 to  +4  (centre x=  0)
    //   Exit 3:  40 to  48  (centre x= 44)
    const FACE_D = 0.35;  // facade slab depth
    const FACE_Z = SOUTH_Z + FACE_D * 0.5;

    // Solid facade panels between the three door openings
    const southSolid = [
      [-58, 20],   // x=-68 to -48
      [-22, 36],   // x=-40 to  -4
      [ 22, 36],   // x= +4 to +40
      [ 58, 20],   // x=+48 to +68
    ];
    for (const [cx, w] of southSolid) {
      const ft = facadeTex.clone(); ft.repeat.set(w / 8, WALL_H / 4); ft.needsUpdate = true;
      const fm = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.88, metalness: 0.04, color: 0xd0d4d8 });
      box(w, WALL_H, FACE_D, cx, WALL_H * 0.5, FACE_Z, fm);
    }

    // Continuous header strip above doors (full width, bottom 0.8 m of top)
    box(TOTAL_W, 0.8, FACE_D, 0, WALL_H - 0.4, FACE_Z, parapetMat);

    // Door surrounds — dark recessed frames at each exit
    const exits = [[-44, 8], [0, 8], [44, 8]];
    for (const [ex, ew] of exits) {
      // Lintel
      box(ew + 0.4, 0.3, FACE_D + 0.05, ex, WALL_H - 0.55, FACE_Z, darkMat);
      // Side jambs
      box(0.22, WALL_H, FACE_D + 0.05, ex - ew * 0.5 - 0.11, WALL_H * 0.5, FACE_Z, darkMat);
      box(0.22, WALL_H, FACE_D + 0.05, ex + ew * 0.5 + 0.11, WALL_H * 0.5, FACE_Z, darkMat);
    }

    // Window strips on upper 1.6 m of each solid panel
    const winH = 1.3, winY = WALL_H - 0.9;
    const winPanels = [
      { cx: -58, w: 20 }, { cx: -22, w: 36 }, { cx: 22, w: 36 }, { cx: 58, w: 20 },
    ];
    for (const { cx, w } of winPanels) {
      const count = Math.max(1, Math.floor(w / 5));
      const spacing = w / count;
      for (let i = 0; i < count; i++) {
        const wx = cx - w * 0.5 + spacing * (i + 0.5);
        box(spacing * 0.65, winH, FACE_D + 0.02, wx, winY, FACE_Z, winMat);
      }
    }

    // ── EAST FACADE (visible from inside exterior zone east side) ─────────
    const sideD_face = 0.35;
    box(sideD_face, WALL_H, TOTAL_D, EAST_X + sideD_face * 0.5, WALL_H * 0.5, MAP_WORLD_CENTER_Z, facadeMat);
    // East parapet cap handled above

    // ── WEST FACADE ───────────────────────────────────────────────────────
    box(sideD_face, WALL_H, TOTAL_D, WEST_X - sideD_face * 0.5, WALL_H * 0.5, MAP_WORLD_CENTER_Z, facadeMat);

    // ── ROOFTOP DETAILS ───────────────────────────────────────────────────
    // Outdoor mode: no roof, so no rooftop HVAC / penthouse / antennas.
    if (!OUTDOOR_MODE) {
      const rng = (() => { let s=4242; return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0xffffffff; }; })();
      const roofY = ROOF_TOP;

      // HVAC units along the south parapet (visible as silhouettes from exterior)
      const acPositions = [-52, -38, -10, 14, 36, 52];
      for (const ax of acPositions) {
        const aw = 1.4 + rng() * 0.6, ah = 0.9 + rng() * 0.5, ad = 1.0 + rng() * 0.4;
        box(aw, ah, ad, ax, roofY + ah * 0.5, SOUTH_Z - 3, darkMat);
        // Exhaust pipe
        box(0.14, 0.6 + rng() * 0.4, 0.14, ax + aw * 0.3, roofY + ah + 0.3, SOUTH_Z - 3 + ad * 0.3, darkMat);
      }

      // Rooftop stairwell / elevator penthouse (centre)
      box(6, 2.8, 5, 0, roofY + 1.4, MAP_WORLD_CENTER_Z - 4, parapetMat);
      box(6.2, 0.2, 5.2, 0, roofY + 2.8 + 0.1, MAP_WORLD_CENTER_Z - 4, roofMat);

      // Antenna masts near corners
      for (const [ax, az] of [[-60, -36], [60, -36], [-60, 110], [60, 110]]) {
        box(0.08, 4.5, 0.08, ax, roofY + 2.25, az, darkMat);
      }
    }

    // ── BASE TRIM ─────────────────────────────────────────────────────────
    // Dark plinth at ground level along south and side faces
    box(TOTAL_W + 0.7, 0.55, FACE_D + 0.1, 0, 0.275, SOUTH_Z + 0.05, darkMat);
    box(sideD_face + 0.1, 0.55, TOTAL_D, EAST_X + 0.05, 0.275, MAP_WORLD_CENTER_Z, darkMat);
    box(sideD_face + 0.1, 0.55, TOTAL_D, WEST_X - 0.05, 0.275, MAP_WORLD_CENTER_Z, darkMat);
  }

  function buildCheapLightFixtures(THREE, scene) {
    // Rectangular LED panel housing flush-mounted to ceiling
    const panelGeo    = new THREE.BoxGeometry(0.72, 0.06, 0.38);
    const diffuserGeo = new THREE.BoxGeometry(0.68, 0.052, 0.34);
    const trimGeo     = new THREE.BoxGeometry(0.76, 0.04, 0.42);

    const housingMat = new THREE.MeshStandardMaterial({
      color: 0x28303e,
      roughness: 0.42,
      metalness: 0.62,
    });

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x404858,
      roughness: 0.36,
      metalness: 0.68,
    });

    // Bright warm-white emissive panel face
    const diffuserMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe8f4ff,
      emissiveIntensity: 6.2,
      roughness: 0.18,
      metalness: 0.0,
      transparent: true,
      opacity: 0.98,
    });

    const panelItems   = [];
    const diffItems    = [];
    const trimItems    = [];

    const ceilY = WALL_H;
    for (const l of ROOM_LIGHTS) {
      if (l.y < 3) continue; // skip low-hung fill lights — no fixture needed
      const fy = ceilY - 0.03;
      panelItems.push({ x: l.x, y: fy,        z: l.z });
      diffItems.push({  x: l.x, y: fy - 0.056, z: l.z });
      trimItems.push({  x: l.x, y: fy + 0.01,  z: l.z });
    }

    makeInstancedBoxesLikeMesh(THREE, scene, trimGeo,     trimMat,    trimItems);
    makeInstancedBoxesLikeMesh(THREE, scene, panelGeo,    housingMat, panelItems);
    makeInstancedBoxesLikeMesh(THREE, scene, diffuserGeo, diffuserMat, diffItems);
  }

  function makeInstancedBoxesLikeMesh(THREE, scene, geometry, material, items) {
    if (!items.length) return null;

    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      position.set(item.x, item.y, item.z);
      quaternion.identity();
      scale.set(item.sx || 1, item.sy || 1, item.sz || 1);

      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);

    return mesh;
  }

  window.RoomBreachEnvironment = {
    MAP,
    MAP_W,
    MAP_H,
    CELL,
    WALL_H,
    PLAYER_H,
    ROOM_LIGHTS,
    mapToWorld,
    worldToMap,
    wallAt,
    wallAtWorld,
    wallAtWorldRadius,
    isOpenCell,
    cellCenter,
    setupEnvironmentLighting,
    buildLevel,
    buildEveningSky,
    applyDevOverrides,
  };
})();
