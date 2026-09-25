// modules/flame_jet.ts — the blackout incinerator's fire: stream, impact,
// residue, burning enemies, pilot light, and the one shared fire light.
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A MODULE
// The jet is the one effect in the game that cannot be judged from a still: it
// only reads as a stream because many frames of particles coexist, and the game
// takes ~40 s to boot to a blackout wave. So the fire lives here, and
// `src/fx_lab.html` drives the exact same code against the exact same particle
// system. Tune in the lab, in seconds, from any angle; the game gets the result
// for free because there is only one copy. EVERY fire number is in
// FLAMETHROWER_CONFIG below — particle_fx.ts holds no flame presets.
//
// HOW THE STREAM IS BUILT
// Particles are real projectiles: born AT the muzzle, thrown along the aim at
// ~25 m/s, slowed by drag. Everything that makes it read as a flamethrower
// falls out of that one decision:
//   • young particles are near the nozzle, small, fast and hot → a narrow core;
//   • old particles are far out, slow, big, cooler and churned by turbulence
//     that grows with age → the stream widens and breaks up downstream;
//   • drag bunches the slow tail up → billowing at the end, not at the gun;
//   • swinging the gun bends the stream like a hose, because fuel already in
//     the air keeps its heading. The nozzle stays attached because every frame
//     spawns at the CURRENT muzzle, spread across the frame (see `emit`).
// The previous version SEEDED particles at their final positions along the ray,
// barely moving. Nothing travelled, so it read as a cloud boiling in place, and
// from a camera 2 m behind the nozzle the whole depth stacked into a white ball.
//
// One emitter, several visibility windows. Smoke and embers are launched from
// the nozzle WITH the flame but stay invisible (`fadeInAt`) until they are
// downstream. So smoke only ever appears where the flame is cooling, and it
// stays consistent however the gun moves — no second emitter guessing where
// "downstream" currently is.
//
// Surfaces cost nothing per particle: at spawn, each particle gets the age at
// which it will have covered the distance to the surface the jet is aimed at
// (closed-form under linear drag). At that age it stalls and gutters out
// against the surface, and the separate impact emitter supplies the splash.
//
// Draw calls: 0 of its own. Everything renders in particle_fx's two layers.
// Lights: 0 of its own. The game re-purposes its permanent gunFlash light with
// `lightSample()` (see the light-count invariant in CLAUDE.md).

export interface Vec3 { x: number; y: number; z: number; }

export interface FlameJetFrame {
  /** Muzzle position in world space (read from the weapon's world transform). */
  origin: Vec3;
  /** Unit vector from the muzzle toward the aim point. */
  dir: Vec3;
  /** Metres from the muzzle to the aim point / first surface. */
  reach: number;
  /** True when `reach` ends on a surface (the stream stalls there); false when
   *  the throw ends in open air. */
  surface?: boolean;
  /** Trigger output, 0..1. Drives rate, throw pressure and light. */
  throttle: number;
  /** Real seconds since the last emit. */
  dt: number;
  /** Monotonic seconds — drives the pressure throb and light flicker. */
  time: number;
}

/** Where to put the single shared fire light this frame, and how bright. */
export interface FlameLightSample {
  x: number; y: number; z: number;
  intensity: number;
  /** 0..1 flicker value, for anything that wants to follow the same pulse. */
  flicker: number;
}

export type FireQuality = "low" | "medium" | "high";

/** Particle tags, for live-count diagnostics (particleFX.tagCount). */
export const FLAME_TAG = { core: 1, flame: 2, smoke: 3, ember: 4, impact: 5, residue: 6, burn: 7 } as const;

// ─────────────────────────────────────────────────────────────────────────────
// FLAMETHROWER_CONFIG — the only place fire is tuned. World units are metres.
// Live-tune in the lab with __fxLab.set({ flame: { speed: [20, 26] } }).
//
// Stream geometry is DERIVED, not set:
//   length ≈ speed / drag × (1 − e^(−drag × life))       (linear drag)
//   width  ≈ spread × length + particle size at death + turbulence
// So: longer throw → raise `speed` or lower `drag`; wider → `spread` or
// `size[1]`; more ragged downstream → `turbulence`.
// ─────────────────────────────────────────────────────────────────────────────
export const FLAMETHROWER_CONFIG = {
  /** Metres of usable throw: the aim ray-cast and damage cone reach this far. */
  range: 15,

  /** Live-particle budgets per quality tier. Spawn rates are derived as
   *  budget / mean life, so these ARE the steady-state counts in open air
   *  (fewer when the stream is cut short by a wall). */
  quality: {
    low:    { flames: 60,  core: 10, smoke: 8,  embers: 10, residuePatches: 3, impactRate: 7 },
    medium: { flames: 110, core: 18, smoke: 16, embers: 25, residuePatches: 5, impactRate: 10 },
    high:   { flames: 180, core: 25, smoke: 25, embers: 40, residuePatches: 8, impactRate: 14 },
  } as Record<FireQuality, { flames: number; core: number; smoke: number; embers: number; residuePatches: number; impactRate: number }>,

  /** Shared stream behaviour. */
  stream: {
    /** Share of the flame budget spent on billows (the rest is tongues). */
    billowShare: 0.3,
    /** Fraction of the muzzle's own velocity the fuel inherits, and its cap
     *  (m/s). Walking forward then does not outrun your own fire. */
    inherit: 0.6,
    inheritMax: 8,
    /** A muzzle jump larger than this (m) between frames is a teleport/respawn,
     *  not motion: no interpolation and no inherited velocity. */
    teleport: 1.5,
    /** Fuel-pressure throb on throw speed, ± fraction. */
    pressure: 0.05,
    /** Throw speed at zero throttle, as a fraction (the stream shortens as the
     *  trigger is released instead of cutting off at full length). */
    minPressure: 0.55,
    /** Stall this far short of a surface, so sprites are not half inside it. */
    wallGap: 0.35,
    /** Per-frame cap per component, so one long frame cannot dump a burst. */
    maxPerFrame: 24,
  },

  /** A. Hot core: short, narrow, white-yellow, fastest. Ends ~15–20% out. */
  core: {
    speed: [27, 31] as [number, number],
    /** Direction jitter, radians (≈ gaussian, so this is a soft half-angle). */
    spread: 0.012,
    rise: 0,
    /** Nozzle radius, metres. */
    radius: 0.02,
    particle: {
      layer: "add" as const, shape: 8, life: [0.07, 0.12] as [number, number],
      size: [0.16, 0.55] as [number, number],
      // Saturated gold, not white: pale yellow over black tone-maps to a
      // greenish cream. The white comes from the sprite shader's heat
      // gradient, in each sprite's centre only.
      color: [0xffd878, 0xff7a18] as [number, number], colorMid: 0xffb030,
      alpha: 0.8, gravity: 0, drag: 1.0, hard: 2.8, attack: 0,
      // Low occlusion: the core is the one part meant to sum hot and bloom.
      occlusion: 0.35, cutKeep: 0, cutLife: 0.3, tag: FLAME_TAG.core,
    },
  },

  /** B. Main stream: velocity-aligned flame tongues, the dominant layer. */
  flame: {
    speed: [24, 29] as [number, number],
    spread: 0.06,
    /** Upward bias on the throw direction. 0: pressurised fuel flies flat;
     *  any lift reads as a campfire column from the over-shoulder camera. */
    rise: 0,
    radius: 0.035,
    particle: {
      layer: "add" as const, shape: 8, life: [0.55, 0.85] as [number, number],
      /** Capped growth: the tongue mask fills ~40% of its sprite's width, so
       *  a 1.6 m sprite is a ~0.65 m wide tongue; the tail cannot balloon. */
      size: [0.3, 1.6] as [number, number],
      /** Ease-out growth: the stream opens up within a few metres of the
       *  nozzle (linear growth left the first 4 m a thin fuse), then settles. */
      sizePow: 0.55,
      color: [0xffb445, 0x6e1403] as [number, number], colorMid: 0xff7a14,
      // Barely buoyant: the jet stays on its line and only the dying tail
      // (billows, smoke) rises.
      alpha: 0.45, gravity: -0.3, drag: 1.35, hard: 2.3, attack: 0.03,
      // Full occlusion is what keeps the colour in the GAME: it renders through
      // an HDR composer, where overlapping additive flames sum past 1 and the
      // cinematic grade's clamp + bleach-bypass + halation wash them to
      // peach-white. Premultiplied "over" converges to colour/occlusion, so at
      // 1 a dense stack never exceeds the flame's own colour. See
      // Preset.occlusion in particle_fx.ts.
      occlusion: 1, cutKeep: 0.12, cutLife: 0.45, tag: FLAME_TAG.flame,
    },
  },

  /** B'. Billows: slower, larger ragged blobs that appear once the stream has
   *  opened up (invisible for the first ~2 m). They fill the turbulent body. */
  billow: {
    speed: [19, 25] as [number, number],
    spread: 0.08,
    rise: 0,
    radius: 0.05,
    particle: {
      layer: "add" as const, shape: 9, shapeAlt: 11, life: [0.6, 0.9] as [number, number],
      size: [0.3, 1.9] as [number, number], sizePow: 0.7,
      color: [0xffb04c, 0x4a0e03] as [number, number], colorMid: 0xf05a0c,
      alpha: 0.22, gravity: -0.9, drag: 1.5, hard: 2.1, attack: 0.12, fadeInAt: 0.12,
      occlusion: 1, cutKeep: 0.12, cutLife: 0.5, tag: FLAME_TAG.flame,
    },
  },

  /** Turbulence acceleration (m/s²) per component, scaled by each particle's
   *  life fraction — smooth at the nozzle, churning downstream. */
  turbulence: { core: 0, flame: 34, billow: 44, smoke: 10, embers: 9 },

  /** C. Smoke: slower than flame, so it lags; invisible until ~6 m out; rises. */
  smoke: {
    speed: [15, 21] as [number, number],
    spread: 0.1,
    rise: 0.04,
    radius: 0.05,
    particle: {
      layer: "alpha" as const, shape: 10, life: [1.3, 1.9] as [number, number],
      size: [0.5, 2.8] as [number, number],
      // Warm grey, as if lit by the fire under it: true soot black is
      // invisible against a blackout sky.
      color: [0x5c4c42, 0x1c1816] as [number, number], colorMid: 0x3a302a,
      alpha: 0.34, gravity: -1.8, drag: 1.9, hard: 1.8, attack: 0.18, fadeInAt: 0.36,
      cutKeep: 0.1, cutLife: 1, tag: FLAME_TAG.smoke,
    },
  },

  /** D. Embers: cheap bright points that break away, drift up and linger. */
  embers: {
    speed: [17, 25] as [number, number],
    spread: 0.11,
    rise: 0.05,
    radius: 0.05,
    particle: {
      layer: "add" as const, shape: 0, life: [0.8, 1.4] as [number, number],
      size: [0.075, 0.03] as [number, number],
      color: [0xffe2a6, 0xb82a06] as [number, number], colorMid: 0xffa040,
      alpha: 0.9, gravity: -1.6, drag: 1.6, hard: 3.2, attack: 0.05, fadeInAt: 0.1,
      cutKeep: -0.25, cutLife: 0.7, tag: FLAME_TAG.ember,
    },
  },

  /** The one fire light (the game's permanent gunFlash, re-purposed). */
  lighting: {
    color: 0xff7a26,
    distance: 22,
    /** Peak intensity at full throttle. Never casts shadows. */
    intensity: 32,
    /** Metres down the stream the light sits (clamped to 45% of reach). */
    along: 3.0,
    lift: 0.2,
    /** ± flicker fraction. Small on purpose: big swings read as strobing. */
    flicker: 0.07,
    /** Tone-mapping exposure lift at full throttle (game only). Keep small:
     *  exposure lifts the fire itself too, and that is what whites it out. */
    exposureBump: 0.07,
  },

  /** Where the stream hits a surface: a splash thrown along the reflected jet,
   *  distinct from the stream itself. Bursts/second come from `quality`. */
  impact: {
    /** Fade the splash in over this many metres so point-blank fire is not
     *  a screen-filling flash. */
    nearFade: 4,
    effect: [["flameSplash", 1], ["flameCrawl", 0.8], ["flameImpactEmber", 0.5], ["flameImpactSmoke", 0.3]] as Array<[string, number]>,
    presets: {
      flameSplash: {
        layer: "add" as const, shape: 9, shapeAlt: 11, signature: true, count: 1,
        speed: [0.4, 1.0] as [number, number], life: [0.16, 0.28] as [number, number],
        size: [0.8, 1.9] as [number, number], color: [0xffbe44, 0xc93407] as [number, number],
        alpha: 0.4, gravity: -1, drag: 3, hard: 2.0, jitter: 0, rise: 0, occlusion: 0.7, tag: FLAME_TAG.impact,
      },
      flameCrawl: {
        layer: "add" as const, shape: 9, shapeAlt: 11, count: 3,
        speed: [2.5, 6] as [number, number], spread: 1, life: [0.25, 0.5] as [number, number],
        size: [0.3, 0.95] as [number, number], color: [0xffae32, 0xba2b08] as [number, number],
        alpha: 0.45, gravity: -2.2, drag: 3.2, hard: 2.0, attack: 0.08, jitter: 0.06, rise: 0.2,
        occlusion: 0.7, tag: FLAME_TAG.impact,
      },
      flameImpactEmber: {
        layer: "add" as const, shape: 1, count: 1, speed: [1.8, 4.2] as [number, number],
        spread: 0.6, life: [0.5, 1.1] as [number, number], size: [0.2, 0.05] as [number, number],
        color: [0xffd28a, 0xc72a05] as [number, number], alpha: 0.8,
        gravity: -1.1, drag: 1.4, hard: 2.4, attack: 0.06, jitter: 0.06, rise: 0.4, tag: FLAME_TAG.impact,
      },
      flameImpactSmoke: {
        layer: "alpha" as const, shape: 10, count: 1, speed: [0.5, 1.4] as [number, number],
        spread: 0.9, life: [1.0, 1.9] as [number, number], size: [0.9, 3.0] as [number, number],
        color: [0x3d3330, 0x14100f] as [number, number], alpha: 0.3,
        gravity: -2.1, drag: 2.8, hard: 1.8, attack: 0.3, jitter: 0.26, rise: 1.15, tag: FLAME_TAG.impact,
      },
    },
  },

  /** Burning fuel left where the jet lands. Pooled patches, no lights; the
   *  live cap per tier is quality.residuePatches. Never on ceilings. */
  residue: {
    /** [min,max] seconds a patch keeps burning after the jet last touched it. */
    life: [1.2, 2.0] as [number, number],
    /** Hits closer than this (m) feed an existing patch instead of starting one. */
    merge: 0.9,
    /** Emissions per second per patch at full strength. */
    rate: 12,
    /** Metres of surface each patch spreads its flames across. */
    spread: 1.0,
    effect: [["flameLick", 1], ["flamePool", 0.5], ["flameResidueEmber", 0.25], ["flameResidueSmoke", 0.15]] as Array<[string, number]>,
    presets: {
      // Shape 8 is velocity-aligned and these leave with a slow upward
      // velocity, so they stand as tongues licking up off the surface.
      flameLick: {
        layer: "add" as const, shape: 8, count: 1.4, speed: [0.7, 1.6] as [number, number], spread: 0.22,
        life: [0.28, 0.55] as [number, number], size: [0.42, 1.1] as [number, number],
        color: [0xffb44a, 0xb82606] as [number, number], alpha: 0.4,
        gravity: -2.6, drag: 2.4, hard: 2.2, attack: 0.1, jitter: 0.16, rise: 0.5, occlusion: 0.7, tag: FLAME_TAG.residue,
      },
      flamePool: {
        layer: "add" as const, shape: 9, shapeAlt: 11, count: 1, speed: [0.1, 0.4] as [number, number],
        spread: 0.6, life: [0.25, 0.45] as [number, number], size: [0.7, 1.35] as [number, number],
        color: [0xff8a22, 0x6e1403] as [number, number], alpha: 0.28,
        gravity: -0.6, drag: 4, hard: 2.1, attack: 0.15, jitter: 0.2, rise: 0.1, occlusion: 0.7, tag: FLAME_TAG.residue,
      },
      flameResidueEmber: {
        layer: "add" as const, shape: 1, count: 1, speed: [1.2, 3] as [number, number], spread: 0.4,
        life: [0.5, 1.0] as [number, number], size: [0.18, 0.05] as [number, number],
        color: [0xffd28a, 0xc72a05] as [number, number], alpha: 0.8,
        gravity: -1.1, drag: 1.4, hard: 2.4, attack: 0.06, jitter: 0.06, rise: 0.4, tag: FLAME_TAG.residue,
      },
      flameResidueSmoke: {
        layer: "alpha" as const, shape: 10, count: 1, speed: [0.5, 1.2] as [number, number], spread: 0.8,
        life: [1.0, 1.7] as [number, number], size: [0.8, 2.6] as [number, number],
        color: [0x3d3330, 0x14100f] as [number, number], alpha: 0.28,
        gravity: -2.1, drag: 2.8, hard: 1.8, attack: 0.3, jitter: 0.26, rise: 1.15, tag: FLAME_TAG.residue,
      },
    },
  },

  /** An enemy on fire (emitted by the game's burn DoT). */
  burn: {
    effect: [["flameBurnBody", 0.7], ["flameBurnTip", 0.45], ["flameBurnEmber", 0.5], ["flameBurnSmoke", 0.3]] as Array<[string, number]>,
    presets: {
      flameBurnBody: {
        layer: "add" as const, shape: 9, shapeAlt: 11, count: 2, speed: [2.4, 4.4] as [number, number],
        spread: 0.3, life: [0.24, 0.5] as [number, number], size: [0.42, 1.65] as [number, number],
        color: [0xff9a24, 0xa81603] as [number, number], alpha: 0.28,
        gravity: -2.4, drag: 3.6, hard: 2.0, attack: 0.12, jitter: 0.18, rise: 0.18, occlusion: 0.7, tag: FLAME_TAG.burn,
      },
      flameBurnTip: {
        layer: "add" as const, shape: 9, shapeAlt: 11, count: 1, speed: [0.8, 2.2] as [number, number],
        spread: 0.5, life: [0.34, 0.66] as [number, number], size: [0.9, 2.4] as [number, number],
        color: [0xc0380a, 0x1a0803] as [number, number], alpha: 0.18,
        gravity: -3.0, drag: 3.8, hard: 1.9, attack: 0.22, jitter: 0.3, rise: 0.3, occlusion: 0.7, tag: FLAME_TAG.burn,
      },
      flameBurnEmber: {
        layer: "add" as const, shape: 1, count: 1, speed: [1.8, 4.2] as [number, number], spread: 0.28,
        life: [0.5, 1.1] as [number, number], size: [0.2, 0.05] as [number, number],
        color: [0xffd28a, 0xc72a05] as [number, number], alpha: 0.8,
        gravity: -1.1, drag: 1.4, hard: 2.4, attack: 0.06, jitter: 0.06, rise: 0.4, tag: FLAME_TAG.burn,
      },
      flameBurnSmoke: {
        layer: "alpha" as const, shape: 10, count: 1, speed: [0.5, 1.4] as [number, number], spread: 0.9,
        life: [1.0, 1.9] as [number, number], size: [0.9, 3.0] as [number, number],
        color: [0x3d3330, 0x14100f] as [number, number], alpha: 0.34,
        gravity: -2.1, drag: 2.8, hard: 1.8, attack: 0.3, jitter: 0.26, rise: 1.15, tag: FLAME_TAG.burn,
      },
    },
  },

  /** The idle pilot light at the nozzle while the incinerator is out. */
  pilot: {
    effect: [["flamePilot", 1]] as Array<[string, number]>,
    presets: {
      flamePilot: {
        layer: "add" as const, shape: 6, count: 1, speed: [1.2, 2.6] as [number, number], spread: 0.3,
        life: [0.05, 0.1] as [number, number], size: [0.09, 0.02] as [number, number],
        color: [0xdff2ff, 0x59a8ff] as [number, number], alpha: 0.85,
        gravity: -0.4, drag: 5, hard: 2.2, attack: 0, jitter: 0.012, rise: 0,
      },
    },
  },
};

type StreamPart = "core" | "flame" | "billow" | "smoke" | "embers";
/** Preset names the stream spawns, one per component. */
const STREAM_PRESET: Record<StreamPart, string> = {
  core: "flameStreamCore", flame: "flameStream", billow: "flameStreamBillow",
  smoke: "flameStreamSmoke", embers: "flameStreamEmber",
};
const STREAM_PARTS: StreamPart[] = ["core", "flame", "billow", "smoke", "embers"];

/** Closed-form age at which a particle launched at `v` under linear drag `k`
 *  has covered `d` metres; 0 when it never gets that far. */
function ageAtDistance(v: number, k: number, d: number): number {
  if (d <= 0) return 1e-4;
  if (k <= 1e-4) return d / v;
  const x = (d * k) / v;
  return x >= 0.999 ? 0 : -Math.log(1 - x) / k;
}

/**
 * Build the fire bound to one particle system. `THREE` is passed in (this
 * module is loaded by both entry points and by the lab, which must all share
 * one THREE instance).
 */
export function createFlameJet(THREE: any, particleFX: any, opts: { quality?: FireQuality } = {}) {
  const C = FLAMETHROWER_CONFIG;
  let quality: FireQuality = opts.quality && C.quality[opts.quality] ? opts.quality : "high";

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const emitDir = new THREE.Vector3();

  // Emitter state. All scalars / preallocated: emit() allocates nothing.
  const last = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1, valid: false };
  const acc: Record<StreamPart, number> = { core: 0, flame: 0, billow: 0, smoke: 0, embers: 0 };
  const rate: Record<StreamPart, number> = { core: 0, flame: 0, billow: 0, smoke: 0, embers: 0 };
  let lastDt = 1 / 60;
  let impactAcc = 0;
  const lastFrame = { reach: 0, surface: false, speed: 0 };

  /** (Re-)register every fire preset and effect, and derive spawn rates. Call
   *  after editing FLAMETHROWER_CONFIG at runtime (the lab's set() does). */
  function applyConfig(): void {
    if (!particleFX?.definePreset) return;
    for (const part of STREAM_PARTS) {
      particleFX.definePreset(STREAM_PRESET[part], {
        ...C[part].particle,
        turb: C.turbulence[part] ?? 0,
        // spawn() supplies velocity and position; these only matter to emit().
        count: 1, spread: 0, jitter: 0, rise: 0,
      });
    }
    for (const group of [C.impact, C.residue, C.burn, C.pilot]) {
      for (const [name, preset] of Object.entries(group.presets)) particleFX.definePreset(name, preset);
    }
    particleFX.defineEffect("flameWall", C.impact.effect);
    particleFX.defineEffect("flameResidue", C.residue.effect);
    particleFX.defineEffect("flameBurn", C.burn.effect);
    particleFX.defineEffect("flamePilotLight", C.pilot.effect);
    deriveRates();
  }

  function deriveRates(): void {
    const q = C.quality[quality];
    const meanLife = (p: StreamPart) => (C[p].particle.life[0] + C[p].particle.life[1]) / 2;
    const share = C.stream.billowShare;
    rate.core = q.core / meanLife("core");
    rate.flame = (q.flames * (1 - share)) / meanLife("flame");
    rate.billow = (q.flames * share) / meanLife("billow");
    rate.smoke = q.smoke / meanLife("smoke");
    rate.embers = q.embers / meanLife("embers");
  }

  function setQuality(q: FireQuality): FireQuality {
    if (C.quality[q]) { quality = q; deriveRates(); }
    return quality;
  }

  // ── Residue patches: fuel that keeps burning where the jet landed ──────────
  // Flat pool of plain objects, allocated once at the largest tier's cap.
  interface Patch {
    x: number; y: number; z: number;
    nx: number; ny: number; nz: number;
    /** Two tangents spanning the surface, for spreading flames across it. */
    ax: number; ay: number; az: number;
    bx: number; by: number; bz: number;
    life: number; maxLife: number;
    strength: number; accum: number;
    alive: boolean;
  }
  const patchCap = Math.max(...Object.values(C.quality).map((q) => q.residuePatches));
  const patches: Patch[] = [];
  for (let i = 0; i < patchCap; i++) patches.push({
    x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, ax: 1, ay: 0, az: 0, bx: 0, by: 0, bz: 1,
    life: 0, maxLife: 1, strength: 0, accum: 0, alive: false,
  });
  const residuePos = { x: 0, y: 0, z: 0 };
  const residueDir = { x: 0, y: 1, z: 0 };

  function deposit(point: Vec3, normal: Vec3, strength: number): void {
    // Fuel does not stay on a ceiling.
    if (normal.y < -0.5) return;
    const cap = Math.min(patchCap, C.quality[quality].residuePatches);
    if (cap <= 0) return;
    const [lo, hi] = C.residue.life;
    const life = lo + Math.random() * (hi - lo);
    const merge2 = C.residue.merge * C.residue.merge;
    // Merge into a nearby patch, else take a free slot, else replace the patch
    // closest to burning out.
    let free: Patch | null = null;
    let oldest: Patch = patches[0];
    for (let i = 0; i < cap; i++) {
      const p = patches[i];
      if (!p.alive) { free ??= p; continue; }
      const dx = p.x - point.x, dy = p.y - point.y, dz = p.z - point.z;
      if (dx * dx + dy * dy + dz * dz < merge2) {
        // Still being hosed: keep it burning and let it build up.
        p.life = Math.max(p.life, life);
        p.maxLife = p.life;
        p.strength = Math.min(1, Math.max(p.strength, strength) + 0.04);
        return;
      }
      if (!oldest.alive || p.life < oldest.life) oldest = p;
    }
    const p = free ?? oldest;
    // Sit just off the surface so the pool is not half inside the wall.
    p.x = point.x + normal.x * 0.06; p.y = point.y + normal.y * 0.06; p.z = point.z + normal.z * 0.06;
    p.nx = normal.x; p.ny = normal.y; p.nz = normal.z;
    // Tangent basis: anything not parallel to the normal, crossed twice.
    const rx = Math.abs(normal.y) < 0.9 ? 0 : 1, ry = Math.abs(normal.y) < 0.9 ? 1 : 0;
    let ax = ry * normal.z, ay = -rx * normal.z, az = rx * normal.y - ry * normal.x;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    p.ax = ax; p.ay = ay; p.az = az;
    p.bx = normal.y * az - normal.z * ay;
    p.by = normal.z * ax - normal.x * az;
    p.bz = normal.x * ay - normal.y * ax;
    p.life = life; p.maxLife = life;
    p.strength = strength; p.accum = Math.random() / C.residue.rate;
    p.alive = true;
  }

  /**
   * Keep every residue patch burning, dying down over its remaining life. Call
   * every frame whether or not the trigger is held — that is the point of it.
   */
  function updateResidue(dt: number): void {
    if (!particleFX) return;
    const period = 1 / C.residue.rate;
    const spread = C.residue.spread;
    for (const p of patches) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      // Burns steadily, then gutters out over the last part of its life.
      const f = Math.min(1, p.life / p.maxLife / 0.6);
      const level = p.strength * f;
      // Seconds of burn owed; a weaker patch emits less often as well as less.
      p.accum += dt * (0.35 + 0.65 * level);
      while (p.accum >= period) {
        p.accum -= period;
        const u = (Math.random() - 0.5) * spread, v = (Math.random() - 0.5) * spread;
        residuePos.x = p.x + p.ax * u + p.bx * v;
        residuePos.y = p.y + p.ay * u + p.by * v;
        residuePos.z = p.z + p.az * u + p.bz * v;
        // Flames rise whatever they are stuck to; a wall adds a little lean out.
        residueDir.x = p.nx * 0.3; residueDir.y = 1; residueDir.z = p.nz * 0.3;
        particleFX.emit("flameResidue", residuePos, residueDir, {
          intensity: 0.35 + 0.65 * level,
          scale: 0.55 + 0.5 * f,
        });
      }
    }
  }

  function clearResidue(): void {
    for (const p of patches) p.alive = false;
  }

  /** Live patch count, for diagnostics. */
  function residueCount(): number {
    let n = 0;
    for (const p of patches) if (p.alive) n++;
    return n;
  }

  // ── The stream ─────────────────────────────────────────────────────────────

  /** Trigger released / weapon gone: the next emit starts a fresh stream
   *  instead of interpolating from wherever the muzzle was last time. */
  function stop(): void {
    last.valid = false;
    for (const p of STREAM_PARTS) acc[p] = 0;
  }

  function emit(f: FlameJetFrame): void {
    if (!particleFX || f.throttle <= 0.001) { stop(); return; }
    const { origin, dir, throttle, time } = f;
    const S = C.stream;
    const dtRaw = Math.max(0, f.dt);
    // Rate integration is clamped so a hitch cannot dump a second of fuel.
    const dt = Math.min(dtRaw, 0.05);
    lastDt = dt;
    lastFrame.reach = f.reach;
    lastFrame.surface = !!f.surface;

    // Continuity with last frame: interpolate the nozzle across the frame, and
    // inherit the muzzle's own motion — unless it jumped (teleport/respawn).
    let prev = last.valid;
    let mvx = 0, mvy = 0, mvz = 0;
    if (prev) {
      const jx = origin.x - last.x, jy = origin.y - last.y, jz = origin.z - last.z;
      const jump = Math.hypot(jx, jy, jz);
      if (jump > S.teleport) prev = false;
      else if (dtRaw > 1e-4) {
        const sp = jump / dtRaw;
        const k = sp > S.inheritMax ? S.inheritMax / sp : 1;
        mvx = (jx / dtRaw) * k * S.inherit;
        mvy = (jy / dtRaw) * k * S.inherit;
        mvz = (jz / dtRaw) * k * S.inherit;
      }
    }

    // Orthonormal basis around the jet axis for spread and nozzle offsets.
    right.set(dir.z, 0, -dir.x);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(right, dir as any).normalize();

    // Fuel pressure throbs rather than running flat, and drops with throttle
    // so a released trigger shortens the throw instead of just thinning it.
    const pressure = 1 + S.pressure * (Math.sin(time * 17) + 0.6 * Math.sin(time * 6.3));
    const speedMul = pressure * (S.minPressure + (1 - S.minPressure) * throttle);
    const wallDist = f.surface ? f.reach - S.wallGap : -1;
    let fastest = 0;

    for (const part of STREAM_PARTS) {
      acc[part] += rate[part] * throttle * dt;
      let n = Math.floor(acc[part]);
      acc[part] -= n;
      if (n > S.maxPerFrame) n = S.maxPerFrame;
      if (n <= 0) continue;
      const comp = C[part];
      const name = STREAM_PRESET[part];
      const drag = comp.particle.drag;
      const [s0, s1] = comp.speed;
      for (let k = 0; k < n; k++) {
        // Stratified birth time within the frame: u = how long ago, as a
        // fraction of the frame. Positions and aim are interpolated to that
        // moment, so the stream is a continuous ribbon at any frame rate and
        // a fast swing leaves a smooth arc instead of stepped clumps.
        const u = (k + Math.random()) / n;
        const age = u * dtRaw;
        const ox = prev ? origin.x + (last.x - origin.x) * u : origin.x;
        const oy = prev ? origin.y + (last.y - origin.y) * u : origin.y;
        const oz = prev ? origin.z + (last.z - origin.z) * u : origin.z;
        // Soft (≈ gaussian) cone: the sum of two uniforms concentrates the
        // fuel on the axis and leaves a ragged fringe, unlike a hard cone.
        const jr = (Math.random() + Math.random() - 1) * comp.spread;
        const ju = (Math.random() + Math.random() - 1) * comp.spread + comp.rise;
        emitDir.set(
          (prev ? dir.x + (last.dx - dir.x) * u : dir.x) + right.x * jr + up.x * ju,
          (prev ? dir.y + (last.dy - dir.y) * u : dir.y) + right.y * jr + up.y * ju,
          (prev ? dir.z + (last.dz - dir.z) * u : dir.z) + right.z * jr + up.z * ju,
        ).normalize();
        const speed = (s0 + Math.random() * (s1 - s0)) * speedMul;
        if (speed > fastest) fastest = speed;
        const a = Math.random() * 6.2832, r = comp.radius * Math.sqrt(Math.random());
        const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        const cut = wallDist > -1 ? ageAtDistance(speed, drag, wallDist) : 0;
        particleFX.spawn(name,
          ox + right.x * ca + up.x * sa,
          oy + right.y * ca + up.y * sa,
          oz + right.z * ca + up.z * sa,
          emitDir.x * speed + mvx, emitDir.y * speed + mvy, emitDir.z * speed + mvz,
          age, cut, 1);
      }
    }
    lastFrame.speed = fastest;

    last.x = origin.x; last.y = origin.y; last.z = origin.z;
    last.dx = dir.x; last.dy = dir.y; last.dz = dir.z;
    last.valid = true;
  }

  /**
   * Fire hitting a surface. Lives here rather than at the call site so the lab
   * shows exactly what the game shows. This is the IMPACT, separate from the
   * stream: the stream stalls against the surface on its own (spawn cutoff);
   * this adds a splash and leaves burning residue.
   *
   * The spray direction is the jet REFLECTED off the surface, not the surface
   * normal: burning fuel runs forward across the ground it lands on, and
   * emitting along the raw normal fountains it straight up, which turns the
   * whole weapon into a bonfire someone is standing behind.
   */
  function emitSurface(point: Vec3, normal: Vec3, dir: Vec3, throttle: number, distance = 99): void {
    if (!particleFX || throttle <= 0.001) return;
    // Aiming at your own feet puts the whole splash a metre from the camera,
    // where additively it whites out the screen. Fade it in over the first few
    // metres so point-blank fire is bright, not blinding.
    const near = Math.min(1, Math.max(0.15, distance / C.impact.nearFade));
    // Every contact leaves fuel burning there (see updateResidue) — before the
    // rate limit, so a sweep lays an unbroken trail instead of dotted patches.
    deposit(point, normal, throttle * near);
    impactAcc += C.quality[quality].impactRate * throttle * lastDt;
    if (impactAcc < 1) return;
    impactAcc -= Math.floor(impactAcc);
    const d = 2 * (dir.x * normal.x + dir.y * normal.y + dir.z * normal.z);
    emitDir.set(dir.x - normal.x * d, dir.y - normal.y * d, dir.z - normal.z * d)
      .normalize()
      .addScaledVector(normal as any, 0.35)
      .normalize();
    particleFX.emit("flameWall", point, emitDir, { intensity: throttle * 0.7 * near, scale: 0.8 + near * 0.35 });
  }

  /**
   * Where the shared fire light goes this frame. It sits a few metres down the
   * stream — lighting the ground and whatever stands in the fire — rather than
   * in the muzzle, where it would mostly light the player's own back.
   *
   * This returns a sample rather than owning a light, because the game must
   * REUSE an existing permanent light (see the light-count invariant in
   * CLAUDE.md — creating one at runtime relinks every shader in the scene).
   */
  function lightSample(f: FlameJetFrame, out: FlameLightSample): FlameLightSample {
    const L = C.lighting;
    const along = Math.min(f.reach * 0.45, L.along);
    out.x = f.origin.x + f.dir.x * along;
    out.y = f.origin.y + f.dir.y * along + L.lift;
    out.z = f.origin.z + f.dir.z * along;
    // Two incommensurate rates so it never reads as a loop; the amplitude is
    // small so it reads as flame, not as a strobe.
    out.flicker = 1 - L.flicker + L.flicker * 0.6 * Math.sin(f.time * 23.3) + L.flicker * 0.4 * Math.sin(f.time * 11.7 + 1.4);
    out.intensity = L.intensity * f.throttle * out.flicker;
    return out;
  }

  /** Live counts and the last frame's geometry, for __rbFlame / the lab HUD. */
  function stats() {
    const n = (tag: number) => particleFX?.tagCount?.(tag) ?? 0;
    return {
      quality,
      core: n(FLAME_TAG.core),
      flames: n(FLAME_TAG.flame),
      smoke: n(FLAME_TAG.smoke),
      embers: n(FLAME_TAG.ember),
      impact: n(FLAME_TAG.impact),
      residue: n(FLAME_TAG.residue),
      burn: n(FLAME_TAG.burn),
      residuePatches: residueCount(),
      reach: +lastFrame.reach.toFixed(2),
      surface: lastFrame.surface,
      /** Fastest throw speed last frame (m/s) — the stream's forward momentum. */
      throwSpeed: +lastFrame.speed.toFixed(1),
      /** Budgeted spawns per second at full throttle. */
      rates: Object.fromEntries(STREAM_PARTS.map((p) => [p, Math.round(rate[p])])),
    };
  }

  applyConfig();

  return {
    emit, stop, emitSurface, lightSample, updateResidue, clearResidue, residueCount,
    stats, setQuality, applyConfig, getQuality: () => quality,
  };
}
