// modules/particle_fx.ts — pooled GPU particle system (replaces the 36-mesh impact pool).
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
// The old impact FX allocated one THREE.Mesh per particle, so the effect budget
// was capped at 36 *draw calls* on a frame already issuing ~760 and CPU-bound on
// draw issue. Everything — wall hits, flesh hits, headshots, Judgment Lance,
// Sanctuary Collapse — shared a single 0.02 sphere with a linear opacity fade.
//
// Here the entire budget is TWO draw calls: one additive layer (sparks, embers,
// energy, fire) and one alpha layer (smoke, dust, blood). Particles live in flat
// SoA typed arrays that double as the GPU attribute buffers, so a frame update is
// a straight numeric loop with no per-particle object churn and no allocation.
//
// LIGHT-COUNT INVARIANT: this system adds NO lights, ever. Bursts fake their
// flash with a bright additive core (see `flash` presets). See CLAUDE.md — a
// changing visible-light count relinks every shader in the scene (~400 ms each).
//
// BACKEND SPLIT: three r166's WebGPU backend cannot compile a ShaderMaterial
// (three_fps_game.ts sanitizes them to fallback materials). So:
//   • webgl  → ShaderMaterial point sprites: per-particle size, alpha and
//              falloff hardness, all animated over the particle's life.
//   • webgpu → PointsMaterial with vertexColors and a textured fallback. Shapes
//              and sizes are shared per layer; the alpha layer loses per-particle
//              opacity and fades by color instead. WebGPU is the mobile/low-tier path, which already
//              runs a reduced particle budget, so the degradation lands where the
//              headroom is thinnest anyway.
//
// THREE is passed in rather than imported so this module stays usable from both
// entry points (Vite bare import + the legacy importmap) with one THREE instance.

type Vec3Like = { x: number; y: number; z: number };

/** Layer a preset renders into. Determines blending, not behaviour. */
type LayerName = "add" | "alpha";

export interface Preset {
  layer: LayerName;
  /** Atlas tile: puff, streak, ring, arc, smoke, spray, flare, shard, then the
   *  fire masks — tongue, ragged blob, soft smoke puff, ragged blob variant. */
  shape: number;
  /** Optional second mask; each particle picks between the two at birth. One
   *  silhouette repeated hundreds of times is legible as a repeat however it is
   *  rotated, which is what makes a big additive effect look stamped. */
  shapeAlt: number;
  delay: number;
  /** Single signature sprites survive density scaling; budget zero still disables them. */
  signature: boolean;
  /** Particles per unit intensity. Scaled by the emit() intensity argument. */
  count: number;
  /** [min,max] initial speed along the emission cone, world units/sec. */
  speed: [number, number];
  /** 0 = perfectly along the normal, 1 = full hemisphere scatter. */
  spread: number;
  /** [min,max] lifetime in seconds. */
  life: [number, number];
  /** World-unit diameter at birth → at death. */
  size: [number, number];
  /** Size growth curve: size = birth + (death − birth) × t^sizePow. 1 =
   *  linear. Below 1 grows early and settles (a jet that opens up soon after
   *  the nozzle, then stops growing instead of ballooning at the tip). */
  sizePow: number;
  /** Colour at birth → at death (hex). */
  color: [number, number];
  /** Peak opacity. */
  alpha: number;
  /** Downward accel (units/s²). Negative = buoyant, for smoke and embers. */
  gravity: number;
  /** Velocity damping per second. Higher = stops faster (air resistance). */
  drag: number;
  /** Radial falloff exponent. 1 = soft puff, 8 = tight bright core. */
  hard: number;
  /** Restitution when the particle hits the floor plane. 0 = pass through. */
  bounce: number;
  /** Fraction of life spent fading IN. 0 = pops on instantly (sparks). */
  attack: number;
  /** Random offset from the emission point, world units. */
  jitter: number;
  /** Extra upward bias added to the emission direction. */
  rise: number;
  /** Optional middle colour stop at half-life (hex); -1 = straight birth→death
   *  lerp. Fire needs three stops (hot → orange → dark red): a two-stop lerp
   *  from yellow to red spends its whole life a muddy salmon. */
  colorMid: number;
  /** Life fraction before which the particle is fully invisible; `attack`
   *  ramps it in from there. This is how one emitter at the nozzle puts smoke
   *  and embers only DOWNSTREAM: they fly with the stream, unseen, and appear
   *  where the flame is already cooling. Invisible particles are parked by the
   *  vertex shader, so they cost no fill. */
  fadeInAt: number;
  /** Turbulence acceleration (units/s²), scaled by life fraction so a particle
   *  leaves smooth and churns more the further it has travelled. It is a
   *  zero-mean spatial field, so neighbours move together (coherent tongues)
   *  and the stream keeps its overall heading. 0 = none, costs nothing. */
  turb: number;
  /** When a spawn() cutoff age is reached (the particle got to the surface the
   *  jet was aimed at): velocity is multiplied by `cutKeep` and the REMAINING
   *  life by `cutLife`. 0/0.35 = stall and gutter out against the wall. */
  cutKeep: number;
  cutLife: number;
  /** Small integer for live-count diagnostics (see ParticleFX.tagCount). */
  tag: number;
  /** Additive layer only: how much the particle also DARKENS what is behind
   *  it, 0..1. 0 is pure additive (sparks, energy — unchanged). Fire needs
   *  some: pure additive over a lit scene sums toward white and washes out,
   *  and seen down its own axis a stream stacks into one bright blob. With
   *  occlusion, near flame covers far flame and the colour stays saturated.
   *  Same draw call: the layer blends premultiplied (One, OneMinusSrcAlpha),
   *  which at occlusion 0 is exactly the old additive result. */
  occlusion: number;
}

const P = (o: Partial<Preset> & Pick<Preset, "layer">): Preset => ({
  shape: 0, shapeAlt: -1, delay: 0, signature: false, count: 6, speed: [2, 5], spread: 0.6, life: [0.3, 0.6], size: [0.08, 0.02],
  color: [0xffffff, 0xffffff], alpha: 1, gravity: 9, drag: 1.5, hard: 3,
  bounce: 0, attack: 0, jitter: 0.02, rise: 0.2,
  sizePow: 1, colorMid: -1, fadeInAt: 0, turb: 0, cutKeep: 1, cutLife: 1, tag: 0, occlusion: 0, ...o,
});

/** Tags are indices into a small shared counter array. */
const MAX_TAGS = 16;

/**
 * Emitter archetypes. These are the vocabulary; `EFFECTS` below composes them
 * into the things the game actually fires.
 */
const PRESETS: Record<string, Preset> = {
  // Hot metal spall off a hard surface. Fast, gravity-heavy, skitters on landing.
  spark: P({
    layer: "add", shape: 1, count: 7, speed: [5, 11], spread: 0.75, life: [0.16, 0.42],
    size: [0.65, 0.12], color: [0xfff6cf, 0xff5a12], alpha: 1,
    gravity: 16, drag: 1.9, hard: 2.5, bounce: 0.35, attack: 0, rise: 0.35,
  }),
  // The bright instant core of an impact — this is what replaces a flash light.
  flash: P({
    layer: "add", count: 1, speed: [0, 0.4], spread: 1, life: [0.07, 0.1],
    size: [0.9, 0.08], color: [0xfff3d0, 0xff9030], alpha: 0.95,
    gravity: 0, drag: 6, hard: 1.1, attack: 0, jitter: 0,
  }),
  // Slow buoyant motes that linger after the sparks are gone.
  ember: P({
    layer: "add", count: 3, speed: [0.6, 2.2], spread: 1, life: [0.7, 1.5],
    size: [0.065, 0.014], color: [0xffb257, 0xd8330a], alpha: 0.85,
    gravity: -1.1, drag: 1.1, hard: 2.2, attack: 0.08, rise: 0.5,
  }),
  // Pulverised surface kicked out of the hole. Expands and stalls.
  dust: P({
    layer: "alpha", count: 4, speed: [0.8, 2.6], spread: 0.95, life: [0.4, 0.9],
    size: [0.16, 0.62], color: [0xb9ae9c, 0x6e675d], alpha: 0.5,
    gravity: 0.9, drag: 3.6, hard: 0.85, attack: 0.14, jitter: 0.05, rise: 0.45,
  }),
  // Heavier, darker, slower than dust — for explosions and deaths.
  smoke: P({
    layer: "alpha", shape: 4, count: 5, speed: [0.5, 1.8], spread: 1, life: [0.9, 1.8],
    size: [0.36, 1.5], color: [0x5b5651, 0x2a2724],
    alpha: 0.5, gravity: -0.55, drag: 2.4, hard: 0.8, attack: 0.2,
    jitter: 0.12, rise: 0.7,
  }),
  // Solid chunks. Barely expand, bounce, fall out of the air fast.
  debris: P({
    layer: "alpha", shape: 7, count: 3, speed: [2.5, 6], spread: 0.85, life: [0.5, 1.1],
    size: [0.08, 0.058], color: [0x8c8378, 0x554e46], alpha: 0.95,
    gravity: 20, drag: 0.8, hard: 3, bounce: 0.32, attack: 0, rise: 0.5,
  }),
  // Fine aerosol at the moment of penetration — the readable "you hit it" cue.
  bloodMist: P({
    layer: "alpha", shape: 4, count: 3, speed: [1.5, 3.5], spread: 0.9, life: [0.28, 0.55],
    size: [0.38, 0.95], color: [0xb52330, 0x500b19], alpha: 0.65,
    gravity: 3.5, drag: 3.2, hard: 1.0, attack: 0.06, rise: 0.3,
  }),
  // Discrete droplets that arc and hit the ground.
  blood: P({
    layer: "alpha", shape: 1, count: 5, speed: [2.5, 6.5], spread: 0.8, life: [0.35, 0.8],
    size: [0.19, 0.07], color: [0x8e0f16, 0x3d060b], alpha: 0.9,
    gravity: 15, drag: 0.9, hard: 2.6, bounce: 0.1, attack: 0, rise: 0.45,
  }),
  bloodSpray: P({
    layer: "alpha", shape: 5, signature: true, count: 1, speed: [0.5, 1.2],
    life: [0.22, 0.32], size: [0.65, 1.4], color: [0xca2739, 0x690c20],
    alpha: 0.95, gravity: 1, drag: 4, jitter: 0, rise: 0,
  }),
  deathSpray: P({
    layer: "alpha", shape: 5, signature: true, count: 1, speed: [0.5, 1.2],
    life: [0.32, 0.42], size: [1.1, 2.1], color: [0xd33148, 0x610b20],
    alpha: 1, gravity: 2, drag: 3, jitter: 0, rise: 0,
  }),
  // CE-inspired short, saturated armor discharge, without dynamic lights.
  shieldCore: P({
    layer: "add", shape: 6, signature: true, count: 1, speed: [0, 0.1], life: [0.12, 0.16],
    size: [1.3, 0.4], color: [0xd9faff, 0x278bff], gravity: 0,
    hard: 1.5, jitter: 0, rise: 0,
  }),
  shieldSpark: P({
    layer: "add", shape: 1, count: 7, speed: [3, 7], spread: 1,
    life: [0.25, 0.5], size: [0.8, 0.16], color: [0xbcefff, 0x315cff],
    gravity: 2, drag: 3, hard: 1.8,
  }),
  shieldRing: P({
    layer: "add", shape: 2, signature: true, delay: 0.035, count: 1, speed: [0, 0], life: [0.3, 0.35],
    size: [0.5, 2.8], color: [0xadefff, 0x316dff], alpha: 0.75,
    gravity: 0, jitter: 0, rise: 0,
  }),
  shieldArc: P({
    layer: "add", shape: 3, signature: true, count: 1, speed: [0, 0.1],
    life: [0.24, 0.3], size: [1.15, 1.65], color: [0x9feaff, 0x4267ff],
    alpha: 1, gravity: 0, jitter: 0, rise: 0,
  }),
  deathArc: P({
    layer: "add", shape: 3, signature: true, delay: 0.065, count: 1, speed: [0, 0.2],
    life: [0.32, 0.4], size: [1.8, 2.6], color: [0xc9f6ff, 0x7654ff],
    alpha: 1, gravity: 0, jitter: 0, rise: 0,
  }),
  plasmaVapor: P({
    layer: "add", shape: 4, delay: 0.09, count: 2, speed: [0.4, 1.1],
    life: [0.4, 0.65], size: [0.6, 1.6], color: [0x327cc9, 0x25255d],
    alpha: 0.32, gravity: -0.6, drag: 3, attack: 0.12, jitter: 0.2,
  }),
  // Flamethrower vocabulary (the jet, its impact, residue, burning enemies,
  // pilot light) is NOT defined here: modules/flame_jet.ts owns it in
  // FLAMETHROWER_CONFIG and registers it through definePreset/defineEffect,
  // so every fire number lives in one place. Tune it in src/fx_lab.html.
  // Ability/energy hits. Tinted at the call site via opts.color.
  energy: P({
    layer: "add", count: 8, speed: [3, 8], spread: 1, life: [0.25, 0.6],
    size: [0.16, 0.028], color: [0xcfe6ff, 0x2b6cff], alpha: 1,
    gravity: 3.5, drag: 2.1, hard: 2.4, attack: 0, rise: 0.4,
  }),
  energyCore: P({
    layer: "add", count: 1, speed: [0, 0.3], spread: 1, life: [0.12, 0.18],
    size: [1.3, 0.12], color: [0xe8f2ff, 0x3a7bff], alpha: 0.9,
    gravity: 0, drag: 5, hard: 1.1, attack: 0, jitter: 0,
  }),
};

/**
 * Composite effects — what gameplay code names. Each entry is a list of
 * [presetName, countMultiplier] layered into one burst.
 */
const EFFECTS: Record<string, Array<[string, number]>> = {
  bulletWall: [["flash", 1], ["spark", 1], ["dust", 1], ["debris", 0.7]],
  bulletFlesh: [["bloodSpray", 1], ["bloodMist", 0.7], ["blood", 0.8]],
  bulletMetal: [["flash", 1], ["spark", 1.5], ["debris", 0.4]],
  headshot: [["deathSpray", 1], ["bloodMist", 1.5], ["blood", 1.6]],
  enemyDeath: [["deathSpray", 1], ["bloodMist", 1.2], ["blood", 1.6]],
  enemyArmorHit: [["shieldCore", 1], ["shieldArc", 1], ["shieldSpark", 0.7], ["spark", 0.3]],
  // Angel head hit: the body-hit discharge plus a ring and a heavier spark
  // shower, so a crit reads at a glance without a damage number.
  enemyArmorHeadshot: [["shieldCore", 1], ["shieldRing", 1], ["shieldArc", 1], ["shieldSpark", 1.3], ["spark", 0.7]],
  // Metal enemy (angel) death: shower of sparks + shrapnel + a puff of smoke and
  // hot embers — the mechanical equivalent of enemyDeath, no gore.
  enemyDeathMetal: [["shieldCore", 1], ["shieldRing", 1], ["deathArc", 1], ["shieldSpark", 1.4], ["spark", 0.7], ["debris", 0.7], ["plasmaVapor", 1]],
  energyImpact: [["energyCore", 1], ["energy", 1], ["dust", 0.6]],
  explosion: [["flash", 2], ["spark", 2], ["smoke", 1.4], ["ember", 1.2], ["debris", 1.2]],
};

/** Eight small authored masks, generated once. One texture lookup per fragment,
 * rather than procedural noise / branching lightning maths on every pixel. */
function createParticleAtlas(THREE: any): any {
  const tile = 96, width = tile * 4, height = tile * 3;
  const pixels = new Uint8Array(width * height * 4);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const segment = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const arcs = [
    [-.78, -.28, -.48, -.14], [-.48, -.14, -.57, .08], [-.57, .08, -.2, -.03],
    [-.2, -.03, -.06, .24], [-.06, .24, .17, .09], [.17, .09, .38, .4], [.38, .4, .74, .49],
    [-.2, -.03, -.12, -.34], [-.12, -.34, .16, -.46], [.16, -.46, .1, -.7],
    [.17, .09, .47, -.08], [.47, -.08, .56, -.36], [-.48, -.14, -.62, .44],
  ];
  const lobes = [[0, 0, .52], [-.3, .13, .37], [.22, .28, .38], [.32, -.19, .4], [-.18, -.33, .35]];
  for (let shape = 0; shape < 12; shape++) {
    for (let iy = 0; iy < tile; iy++) for (let ix = 0; ix < tile; ix++) {
      const x = (ix + .5) / tile * 2 - 1, y = (iy + .5) / tile * 2 - 1;
      const r = Math.hypot(x, y);
      let a = 0;
      if (shape === 0) a = Math.pow(clamp(1 - r * r), 2);
      if (shape === 1) a = Math.pow(clamp(1 - Math.abs(x) * 12), 1.3) * clamp((.92 - Math.abs(y)) * 1.6);
      if (shape === 2) {
        const angle = Math.atan2(y, x);
        const radius = .77 + .035 * Math.sin(angle * 9);
        a = Math.exp(-Math.pow((r - radius) * 26, 2)) * (.65 + .35 * Math.sin(angle * 5 + 1));
      }
      if (shape === 3) {
        let d = 2;
        for (const s of arcs) d = Math.min(d, segment(x, y, s[0], s[1], s[2], s[3]));
        a = Math.exp(-d * d * 4400) + .24 * Math.exp(-d * d * 220);
      }
      if (shape === 4) {
        for (const l of lobes) a = Math.max(a, clamp(1 - Math.hypot(x - l[0], y - l[1]) / l[2]));
        const grain = .72 + .13 * Math.sin(x * 31 + Math.sin(y * 17)) + .1 * Math.sin(y * 39 + x * 13);
        a = Math.pow(a, .75) * grain;
      }
      if (shape === 5) {
        // A ragged central splash and asymmetric satellite droplets, not a disc.
        const angle = Math.atan2(y, x);
        const edge = .24 + .05 * Math.sin(angle * 7) + .045 * Math.sin(angle * 11 + 2);
        const grain = .76 + .15 * Math.sin(x * 57 + Math.sin(y * 29)) + .08 * Math.sin(y * 63);
        a = clamp((edge - r) * 15) * grain;
        for (let k = 0; k < 11; k++) {
          const theta = k * 2.399, radius = .32 + (k % 4) * .14;
          const dx = Math.cos(theta), dy = Math.sin(theta);
          const along = x * dx + y * dy - radius, across = -x * dy + y * dx;
          a = Math.max(a, clamp(1 - (along * along / (.006 + (k % 3) * .006) + across * across / .0016)) * grain);
        }
      }
      if (shape === 6) {
        a = Math.exp(-r * r * 32) + .65 * Math.exp(-Math.abs(x) * 65 - Math.abs(y) * 3)
          + .65 * Math.exp(-Math.abs(y) * 65 - Math.abs(x) * 3);
      }
      if (shape === 7) a = clamp((.65 - Math.abs(x * 1.5 + y * .4) - Math.abs(y) * .7) * 30);
      // ── Fire masks (8-10) ────────────────────────────────────────────────
      // Round sprites cannot make fire. A flame's silhouette is the effect: a
      // tapering tongue with a notched edge, not a disc with soft edges. These
      // three carry that shape so the particles do not have to fake it with
      // sheer density. None of them use a periodic grain term — see shape 4,
      // whose sin() grain tiles into a visible honeycomb at large sizes.
      //
      // 8: flame tongue. Base at -y, tip at +y, so the vertex shader's
      // velocity alignment points the tip down-flow.
      if (shape === 8) {
        const ny = (y + 1) * .5;                         // 0 at base, 1 at tip
        // Profile: a rounded bulb in the lower third drawn out to a point. The
        // width must not go to zero at the base — a tongue that tapers at BOTH
        // ends is a blade, and that is exactly what the first version rendered.
        const w = .42 * Math.pow(1 - ny, .5) * clamp(ny * 6 + .25);
        if (w > .004) {
          const lean = .08 * Math.sin(ny * 4.2 + 1.1);   // slight S, so it licks
          const u = (x - lean) / w;
          // SQUARED falloff across the width. A linear cut (1 - |u|) gives a
          // dead-straight edge, which is what made this read as a machined
          // blade instead of something burning.
          let core = clamp(1 - u * u);
          // Erode the silhouette toward the tip so it frays rather than ending
          // in a clean spike.
          core *= clamp(1.02 - .55 * (.35 + .65 * ny) * (.5 + .5 * Math.sin(ny * 19 + x * 5 + .6)));
          a = Math.pow(core, 1.15) * (1 - Math.pow(ny, 2.4) * .7);
        }
      }
      // 9 and 11: ragged burning blobs — the body of the fire. Angular noise on
      // the radius gives a broken edge with no tiling artefact.
      //
      // Keep the amplitudes SMALL. At .15/.09 the 3θ term dominates and every
      // particle becomes a recognisable three-pointed star — which, scattered
      // and rotated at metre scale, reads as a flock of birds rather than fire.
      // The raggedness has to be a perturbation of a disc, not a shape of its own.
      //
      // 11 is the same blob with different phases: one silhouette repeated a few
      // hundred times is legible as a repeat no matter how it is rotated, so
      // presets alternate between the two (see `shapeAlt`).
      if (shape === 9 || shape === 11) {
        const ph = shape === 9 ? 0 : 2.6;
        const angle = Math.atan2(y, x);
        const edge = .72 + .07 * Math.sin(angle * 3 + 1.1 + ph) + .05 * Math.sin(angle * 5 - .6 - ph)
          + .035 * Math.sin(angle * 9 + 2.4 + ph * 2);
        a = Math.pow(clamp((edge - r) * (1.8 + 1.7 * clamp(1 - r))), .95);
      }
      // 10: rolling smoke puff. Lobed like shape 4 but with a noisy perimeter
      // instead of a grain, so it survives being metres across.
      if (shape === 10) {
        // Deliberately NOT lobed. The five discrete lobes of shape 4 turn into
        // recognisable bird/butterfly silhouettes once a particle is metres
        // across, and every instance repeats the same one. A soft disc with a
        // gently irregular perimeter stays amorphous at any size.
        // Keep the perimeter noise SMALL relative to the radius. At .1/.07/.05
        // on a base of .78 the three harmonics line up in a few directions and
        // push the edge out to the tile corners — the puff grows arms and reads
        // as a bird, which is the artefact this shape existed to avoid.
        const angle = Math.atan2(y, x);
        const edge = .66 + .05 * Math.sin(angle * 3 + .7) + .035 * Math.sin(angle * 5 - 1.3)
          + .025 * Math.sin(angle * 8 + 2.1);
        a = Math.pow(clamp((edge - r) / edge), 1.4);
      }
      const i = (((shape >> 2) * tile + iy) * width + (shape % 4) * tile + ix) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(clamp(a) * clamp((.98 - Math.max(Math.abs(x), Math.abs(y))) * 30) * 255);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aHard;
attribute vec3 aStyle;
attribute vec4 aMotion;
uniform float uViewportHeight;
varying vec3 vColor;
varying float vAlpha;
varying float vHard;
varying vec2 vStyle;
varying float vAge;
varying vec2 vRotation;
varying float vOcclusion;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vHard = aHard;
  vStyle = aStyle.xy;
  vOcclusion = aStyle.z;
  vAge = aMotion.w;
  // Shapes 1 (streak) and 8 (flame tongue) are directional: rotate them so
  // their long axis follows the particle's screen-space velocity. Everything
  // else keeps its random birth rotation.
  if ((aStyle.x > 0.5 && aStyle.x < 1.5) || (aStyle.x > 7.5 && aStyle.x < 8.5)) {
    vec3 velocity = mat3(modelViewMatrix) * aMotion.xyz;
    if (dot(velocity.xy, velocity.xy) > 0.001)
      vStyle.y = atan(-velocity.y, velocity.x) - 1.5707963;
  }
  vRotation = vec2(cos(vStyle.y), sin(vStyle.y));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Correct perspective sizing: NDC height of a world-space size s at depth z is
  // s * P[1][1] / -z; multiply by half the viewport to land in pixels. (three's
  // built-in points shader ignores the projection term and so ignores FOV.)
  float px = aSize * projectionMatrix[1][1] * 0.5 * uViewportHeight / max(0.0001, -mv.z);
  gl_PointSize = min(px, 190.0);
  // Near-camera fade. Close up a particle fills a huge patch of screen and the
  // viewer starts reading the SPRITE instead of the effect — every mask becomes
  // a legible silhouette (a wedge, a blob, a streak). Fading the nearest ones
  // out keeps the effect volumetric from inside it, which matters here because
  // the third-person camera sits only a few metres behind the muzzle.
  vAlpha *= smoothstep(0.30, 1.90, -mv.z);
  // Warm-up may draw unused slots; park those off-screen. Live draws use a
  // packed draw range, which does not change the compiled program.
  if (aSize <= 0.0 || aAlpha <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHard;
varying vec2 vStyle;
varying float vAge;
varying vec2 vRotation;
varying float vOcclusion;
uniform sampler2D uAtlas;
uniform float uPremultiplied;
// NOTE: do NOT include <tonemapping_pars_fragment> / <colorspace_pars_fragment>
// here — three's WebGLProgram already prepends both to every ShaderMaterial's
// fragment prefix, and re-including them is a "function already has a body"
// compile error. Only the call-site chunks below belong in the body.
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float cs = vRotation.x, sn = vRotation.y;
  p = mat2(cs, -sn, sn, cs) * p;
  if (max(abs(p.x), abs(p.y)) > 0.49) discard;
  vec2 tile = vec2(mod(vStyle.x, 4.0), floor(vStyle.x / 4.0));
  float a = texture2D(uAtlas, (tile + p + 0.5) / vec2(4.0, 3.0)).a;
  // The hard falloff exponent applies to the plain puff and to the fire masks;
  // the authored masks (ring, arc, spray...) own their own edge. NOTE: no
  // backticks in this shader source, it lives in a template literal.
  if (vStyle.x < 0.5 || vStyle.x > 7.5) a = pow(a, vHard * 0.5);
  // A short stutter reads as electricity without needing extra particles.
  if (vStyle.x > 2.5 && vStyle.x < 3.5) a *= 0.65 + 0.35 * step(0.4, fract(vAge * 6.0));
  // Fire masks (8 tongue, 9 and 11 blobs; NOT 10, the smoke puff) burn hotter
  // in their dense centre than at their frayed edge. The mask value is already
  // in hand, so this is one mix per fragment, no extra fetch. It is what gives
  // a stream internal detail: overlapping sprites show hot cores inside cooler
  // rims instead of summing to one flat colour, and dimming the rims keeps the
  // additive total (and so bloom) concentrated where the fire is hottest.
  vec3 col = vColor;
  if (vStyle.x > 7.5 && abs(vStyle.x - 10.0) > 0.5) {
    float core = smoothstep(0.3, 0.95, a);
    col *= mix(0.55, 1.25, core);
    col.g += core * core * 0.1 * vColor.r;
  }
  gl_FragColor = vec4(col, a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Additive layer: premultiplied output for (One, OneMinusSrcAlpha) blending.
  // rgb*a is exactly what additive (SrcAlpha, One) added; the alpha channel
  // now carries how much of the background this particle also covers.
  if (uPremultiplied > 0.5) gl_FragColor = vec4(gl_FragColor.rgb * gl_FragColor.a, gl_FragColor.a * vOcclusion);
}
`;

interface LayerOpts {
  capacity: number;
  additive: boolean;
  backend: "webgl" | "webgpu";
  renderOrder: number;
  atlas: any;
}

/** One Points object + its SoA particle store. Exactly one draw call. */
class Layer {
  capacity: number;
  count = 0;
  points: any;
  geo: any;
  mat: any;
  additive: boolean;
  shaded: boolean;

  // GPU-visible attributes (index-aligned with the sim arrays below).
  aPos: Float32Array;
  aCol: Float32Array;
  aSize: Float32Array;
  aAlpha: Float32Array;
  aHard: Float32Array;
  aStyle: Float32Array;
  aMotion: Float32Array;

  // CPU-only simulation state.
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array;
  delay: Float32Array;
  size0: Float32Array; size1: Float32Array; sizePow: Float32Array;
  c0: Float32Array; c1: Float32Array; cm: Float32Array;   // 3 floats each
  alpha0: Float32Array;
  grav: Float32Array; drag: Float32Array; bounce: Float32Array; attack: Float32Array;
  fadeIn: Float32Array; turb: Float32Array; seed: Float32Array;
  cut: Float32Array; cutKeep: Float32Array; cutLife: Float32Array;
  tag: Uint8Array;
  /** Set by spawn(): the particle is already where it belongs at render time,
   *  so its first update must not advance or age it. */
  fresh: Uint8Array;
  /** Shared across layers: live particles per preset tag. */
  tagCounts: Int32Array;
  /** Seconds of simulated time; drives the turbulence field. */
  clock = 0;

  constructor(THREE: any, opts: LayerOpts, tagCounts: Int32Array) {
    const n = opts.capacity;
    this.capacity = n;
    this.tagCounts = tagCounts;
    this.additive = opts.additive;
    this.shaded = opts.backend === "webgl";

    this.aPos = new Float32Array(n * 3);
    this.aCol = new Float32Array(n * 3);
    this.aSize = new Float32Array(n);
    this.aAlpha = new Float32Array(n);
    this.aHard = new Float32Array(n);
    this.aStyle = new Float32Array(n * 3);
    this.aMotion = new Float32Array(n * 4);
    this.delay = new Float32Array(n);

    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n); this.size1 = new Float32Array(n); this.sizePow = new Float32Array(n);
    this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3); this.cm = new Float32Array(n * 3);
    this.alpha0 = new Float32Array(n);
    this.fadeIn = new Float32Array(n); this.turb = new Float32Array(n); this.seed = new Float32Array(n);
    this.cut = new Float32Array(n); this.cutKeep = new Float32Array(n); this.cutLife = new Float32Array(n);
    this.tag = new Uint8Array(n);
    this.fresh = new Uint8Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.bounce = new Float32Array(n); this.attack = new Float32Array(n);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.aPos, 3));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.aCol, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.aSize, 1));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.aAlpha, 1));
    this.geo.setAttribute("aHard", new THREE.BufferAttribute(this.aHard, 1));
    // WebGPU fallback reads `color` for vertexColors; alias the same buffer so
    // there is no second copy to keep in sync.
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.aCol, 3));
    this.geo.setAttribute("aStyle", new THREE.BufferAttribute(this.aStyle, 3));
    this.geo.setAttribute("aMotion", new THREE.BufferAttribute(this.aMotion, 4));
    for (const attr of Object.values(this.geo.attributes) as any[]) attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    if (this.shaded) {
      this.mat = new THREE.ShaderMaterial({
        uniforms: {
          uViewportHeight: { value: 1080 }, uAtlas: { value: opts.atlas },
          uPremultiplied: { value: opts.additive ? 1 : 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        // The additive layer is really premultiplied: the fragment shader
        // writes (rgb*a, a*occlusion), so occlusion 0 is plain additive and
        // fire can also cover what is behind it — see Preset.occlusion.
        ...(opts.additive
          ? {
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
          }
          : { blending: THREE.NormalBlending }),
      });
    } else {
      // WebGPU path: no custom shader. Size is per-material, so pick the preset
      // midpoint; alpha rides on the vertex colour (exact under additive).
      const map = opts.atlas.clone();
      // One fixed tile out of the 4x3 atlas (additive -> flare, alpha -> smoke).
      map.repeat.set(0.25, 1 / 3);
      map.offset.set(opts.additive ? 0.5 : 0, 1 / 3);
      map.needsUpdate = true;
      this.mat = new THREE.PointsMaterial({
        map,
        size: opts.additive ? 0.16 : 0.4,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        opacity: opts.additive ? 1 : 0.55,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    }

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;   // bounds are stale by design
    this.points.renderOrder = opts.renderOrder;
    this.points.matrixAutoUpdate = false;
    this.points.name = opts.additive ? "particleFX:add" : "particleFX:alpha";
  }

  /** Free the slot at `i` by swapping the last live particle into it. */
  private kill(i: number): void {
    this.tagCounts[this.tag[i]]--;
    const last = --this.count;
    if (i !== last) this.copySlot(last, i);
    this.aSize[last] = 0;
    this.aAlpha[last] = 0;
  }

  private copySlot(from: number, to: number): void {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.aPos[t3 + k] = this.aPos[f3 + k];
      this.aCol[t3 + k] = this.aCol[f3 + k];
      this.c0[t3 + k] = this.c0[f3 + k];
      this.c1[t3 + k] = this.c1[f3 + k];
      this.cm[t3 + k] = this.cm[f3 + k];
    }
    this.aSize[to] = this.aSize[from];
    this.aAlpha[to] = this.aAlpha[from];
    this.aHard[to] = this.aHard[from];
    this.aStyle[to * 3] = this.aStyle[from * 3];
    this.aStyle[to * 3 + 1] = this.aStyle[from * 3 + 1];
    this.aStyle[to * 3 + 2] = this.aStyle[from * 3 + 2];
    for (let k = 0; k < 4; k++) this.aMotion[to * 4 + k] = this.aMotion[from * 4 + k];
    this.delay[to] = this.delay[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from]; this.sizePow[to] = this.sizePow[from];
    this.alpha0[to] = this.alpha0[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
    this.bounce[to] = this.bounce[from]; this.attack[to] = this.attack[from];
    this.fadeIn[to] = this.fadeIn[from]; this.turb[to] = this.turb[from]; this.seed[to] = this.seed[from];
    this.cut[to] = this.cut[from]; this.cutKeep[to] = this.cutKeep[from]; this.cutLife[to] = this.cutLife[from];
    this.tag[to] = this.tag[from];
    this.fresh[to] = this.fresh[from];
  }

  /** @returns the new particle's index, or -1 when the layer is saturated. */
  alloc(): number {
    if (this.count >= this.capacity) return -1;
    return this.count++;
  }

  /**
   * @param dt   real elapsed seconds — ages particles so they expire on wall
   *             clock even when the frame rate collapses.
   * @param step clamped seconds for the motion integration only, so a hitch
   *             cannot teleport a particle across the map.
   *
   * Keeping these separate matters: ageing on the clamped step made a slow frame
   * hold particles alive proportionally longer, so heavy overdraw sustained
   * itself into a death spiral instead of draining.
   */
  update(dt: number, step: number, floorY: number): void {
    this.clock += dt;
    if (this.count === 0) return;
    const clock = this.clock;
    for (let i = this.count - 1; i >= 0; i--) {
      let activeDt = dt;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        if (this.delay[i] > 0) continue;
        activeDt = -this.delay[i];
        this.delay[i] = 0;
      }
      // A spawn() particle was placed at its exact sub-frame position for THIS
      // frame's render. Advancing it now as well would open a speed×dt gap at
      // the emitter (0.5 m at 60 fps, 1 m at 30) — a stream detached from its
      // nozzle. So its first update only refreshes the visuals.
      if (this.fresh[i]) { this.fresh[i] = 0; activeDt = 0; }
      let life = this.life[i] - activeDt;
      if (life <= 0) { this.kill(i); continue; }
      // Cutoff: the particle has reached the surface its emitter was aimed at
      // (an age computed analytically at spawn — no per-particle collision).
      // Scaling life AND maxLife together shortens what is left without
      // jumping the colour/size ramps forward.
      if (this.cut[i] > 0 && this.maxLife[i] - life >= this.cut[i]) {
        this.cut[i] = 0;
        const keep = this.cutKeep[i];
        this.vx[i] *= keep; this.vy[i] *= keep; this.vz[i] *= keep;
        life *= this.cutLife[i];
        this.maxLife[i] *= this.cutLife[i];
      }
      this.life[i] = life;

      const t = 1 - life / this.maxLife[i];          // 0 at birth → 1 at death
      const motionStep = Math.min(step, activeDt);
      const tb = this.turb[i];
      if (tb > 0) {
        // Cheap coherent turbulence: a few sines of POSITION (so neighbours
        // share a gust and form tongues) and time, grown with age. Zero-mean,
        // so it bends and breaks the stream without steering it.
        const s = this.seed[i];
        const i3t = i * 3;
        const px = this.aPos[i3t], py = this.aPos[i3t + 1], pz = this.aPos[i3t + 2];
        const amp = tb * t * motionStep;
        this.vx[i] += amp * (Math.sin(py * 1.9 + clock * 6.1 + s) + 0.6 * Math.sin(pz * 1.3 - clock * 4.3));
        this.vy[i] += amp * (Math.sin(pz * 1.7 + clock * 5.3 + s * 1.7) + 0.6 * Math.sin(px * 1.1 + clock * 3.7));
        this.vz[i] += amp * (Math.sin(px * 1.5 - clock * 5.9 + s * 0.6) + 0.6 * Math.sin(py * 1.2 + clock * 4.9));
      }
      const d = Math.max(0, 1 - this.drag[i] * motionStep);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * motionStep;

      const i3 = i * 3;
      let x = this.aPos[i3] + this.vx[i] * motionStep;
      let y = this.aPos[i3 + 1] + this.vy[i] * motionStep;
      let z = this.aPos[i3 + 2] + this.vz[i] * motionStep;

      if (this.bounce[i] > 0 && y < floorY) {
        y = floorY;
        this.vy[i] = -this.vy[i] * this.bounce[i];
        this.vx[i] *= 0.55;
        this.vz[i] *= 0.55;
        // Below a threshold it is skittering, not bouncing — let it settle.
        if (Math.abs(this.vy[i]) < 0.35) { this.vy[i] = 0; this.bounce[i] = 0; }
      }

      this.aPos[i3] = x; this.aPos[i3 + 1] = y; this.aPos[i3 + 2] = z;
      const sp = this.sizePow[i];
      this.aSize[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * (sp === 1 ? t : Math.pow(t, sp));
      // Three-stop ramp: birth → mid at half-life → death. Presets without a
      // mid stop get the average, which is exactly the old two-stop lerp.
      if (t < 0.5) {
        const k2 = t * 2;
        for (let k = 0; k < 3; k++) this.aCol[i3 + k] = this.c0[i3 + k] + (this.cm[i3 + k] - this.c0[i3 + k]) * k2;
      } else {
        const k2 = (t - 0.5) * 2;
        for (let k = 0; k < 3; k++) this.aCol[i3 + k] = this.cm[i3 + k] + (this.c1[i3 + k] - this.cm[i3 + k]) * k2;
      }

      // Fade: invisible until `fadeIn`, quick ramp in over `attack`, linear-ish
      // decay out, squared so the tail disappears rather than lingering grey.
      const atk = this.attack[i];
      const fi = this.fadeIn[i];
      const rampIn = t < fi ? 0 : atk > 0 ? Math.min(1, (t - fi) / atk) : 1;
      const shape = this.aStyle[i * 3];
      const fade = shape >= 2 ? 1 - t * t : (1 - t) * (1 - t);
      const a = this.alpha0[i] * rampIn * fade;
      this.aAlpha[i] = a;
      this.aMotion[i * 4] = this.vx[i];
      this.aMotion[i * 4 + 1] = this.vy[i];
      this.aMotion[i * 4 + 2] = this.vz[i];
      this.aMotion[i * 4 + 3] = t;
      // Only the PointsMaterial fallback needs the fade baked into the colour —
      // it has no per-particle opacity, and under additive blending fading to
      // black IS fading out. The shaded path must NOT do this: the fragment
      // shader already multiplies by vAlpha, and doing both squares the fade,
      // which is what made every burst render essentially black.
      if (!this.shaded) {
        this.aCol[i3] *= a; this.aCol[i3 + 1] *= a; this.aCol[i3 + 2] *= a;
      }
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aHard.needsUpdate = true;
    this.geo.attributes.aStyle.needsUpdate = true;
    this.geo.attributes.aMotion.needsUpdate = true;
    this.geo.setDrawRange(0, this.count);
  }

  /** Drop live particles beyond `target`, newest first. O(dropped), not O(n²). */
  truncate(target: number): void {
    if (target >= this.count) return;
    for (let i = Math.max(0, target); i < this.count; i++) {
      this.tagCounts[this.tag[i]]--;
      this.aSize[i] = 0;
      this.aAlpha[i] = 0;
    }
    this.count = Math.max(0, target);
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) this.tagCounts[this.tag[i]]--;
    this.aSize.fill(0);
    this.aAlpha.fill(0);
    this.count = 0;
    this.geo.setDrawRange(0, 0);
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
  }
}

export interface EmitOptions {
  /** Multiplies particle counts. 1 = the preset's authored density. */
  intensity?: number;
  /** Multiplies sizes and speeds — makes a burst read as bigger, not denser. */
  scale?: number;
  /** Hex tint override. Applied to the birth colour; death colour follows. */
  color?: number;
  /** Y of the floor plane used for bounce. Defaults to the emission point. */
  floorY?: number;
}

export interface ParticleFX {
  emit(name: string, pos: Vec3Like, normal?: Vec3Like | null, opts?: EmitOptions): void;
  /**
   * Spawn ONE particle of preset `name` with an explicit world velocity — for
   * continuous emitters (the flamethrower) that own their own direction, rate
   * and placement. Scalars rather than objects so a hot loop allocates nothing.
   * @param age    seconds the particle has already lived (sub-frame spawn
   *               offset): it is advanced along its velocity by that much.
   * @param cut    age at which the preset's cutKeep/cutLife apply (it reached
   *               a surface); 0 = never.
   * @returns false when the layer is saturated or the budget skipped it.
   */
  spawn(name: string, px: number, py: number, pz: number, vx: number, vy: number, vz: number,
    age?: number, cut?: number, sizeMul?: number): boolean;
  /** Register or replace a preset (partial; unspecified fields take defaults). */
  definePreset(name: string, preset: Partial<Preset> & Pick<Preset, "layer">): void;
  /** Register or replace a composite effect: [presetName, countMultiplier][]. */
  defineEffect(name: string, parts: Array<[string, number]>): void;
  /** Live particles carrying preset tag `tag` (diagnostics). */
  tagCount(tag: number): number;
  update(dt: number): void;
  clear(): void;
  /** Live particle count across both layers (for the perf HUD / __rbTest). */
  count(): number;
  capacity(): number;
  /** Drop newest particles when over budget — the adaptive-quality hook. */
  trim(fraction: number): void;
  setBudget(scale: number): void;
  dispose(): void;
  objects: any[];
}

export interface CreateOptions {
  backend?: "webgl" | "webgpu";
  /** Low tier gets a smaller pool and emits fewer particles per burst. */
  lowEnd?: boolean;
  /** Returns the drawing-buffer height in px; re-read each frame because the
   *  adaptive render scale changes it. */
  viewportHeight?: () => number;
  floorY?: number;
  /** World-space viewer position for distance-based burst density. */
  viewerPosition?: () => Vec3Like;
}

/**
 * Build the particle system and add its two Points objects to `scene`.
 * They stay in the scene permanently (never toggled visible) so their programs
 * compile once during the boot warm-up and never relink.
 */
export function createParticleFX(THREE: any, scene: any, opts: CreateOptions = {}): ParticleFX {
  const backend = opts.backend === "webgpu" ? "webgpu" : "webgl";
  const low = !!opts.lowEnd;
  const atlas = createParticleAtlas(THREE);
  const tagCounts = new Int32Array(MAX_TAGS);
  const addLayer = new Layer(THREE, {
    capacity: low ? 520 : 1400, additive: true, backend, renderOrder: 34, atlas,
  }, tagCounts);
  const alphaLayer = new Layer(THREE, {
    capacity: low ? 260 : 700, additive: false, backend, renderOrder: 33, atlas,
  }, tagCounts);
  // Per-instance vocabulary, so definePreset/defineEffect never leak between
  // systems (the lab and a test can each build one).
  const presets: Record<string, Preset> = { ...PRESETS };
  const effects: Record<string, Array<[string, number]>> = { ...EFFECTS };
  scene.add(addLayer.points);
  scene.add(alphaLayer.points);

  const defaultFloorY = opts.floorY ?? 0.02;
  const viewportHeight = opts.viewportHeight ?? (() => 1080);
  let budget = low ? 0.5 : 1;

  const tmpColor = new THREE.Color();
  const nx = { x: 0, y: 1, z: 0 };
  // Linear RGB of each preset's birth/mid/death stops, resolved once.
  const rgbCache = new Map<Preset, Float32Array>();
  function presetRgb(preset: Preset): Float32Array {
    let c = rgbCache.get(preset);
    if (c) return c;
    c = new Float32Array(9);
    tmpColor.setHex(preset.color[0]); c[0] = tmpColor.r; c[1] = tmpColor.g; c[2] = tmpColor.b;
    tmpColor.setHex(preset.color[1]); c[6] = tmpColor.r; c[7] = tmpColor.g; c[8] = tmpColor.b;
    if (preset.colorMid >= 0) {
      tmpColor.setHex(preset.colorMid); c[3] = tmpColor.r; c[4] = tmpColor.g; c[5] = tmpColor.b;
    } else {
      c[3] = (c[0] + c[6]) / 2; c[4] = (c[1] + c[7]) / 2; c[5] = (c[2] + c[8]) / 2;
    }
    rgbCache.set(preset, c);
    return c;
  }
  const tintRgb = new Float32Array(9);

  /** Everything about a new slot except its position and velocity. */
  function initSlot(layer: Layer, idx: number, preset: Preset, sizeMul: number, rgb: Float32Array): void {
    const i3 = idx * 3;
    const life = preset.life[0] + Math.random() * (preset.life[1] - preset.life[0]);
    layer.life[idx] = life;
    layer.maxLife[idx] = life;
    layer.delay[idx] = preset.delay;

    const sv = (0.8 + Math.random() * 0.45) * sizeMul;
    layer.size0[idx] = preset.size[0] * sv;
    layer.size1[idx] = preset.size[1] * sv;
    layer.sizePow[idx] = preset.sizePow;
    layer.aSize[idx] = layer.size0[idx];

    for (let k = 0; k < 3; k++) {
      layer.c0[i3 + k] = rgb[k];
      layer.cm[i3 + k] = rgb[3 + k];
      layer.c1[i3 + k] = rgb[6 + k];
      layer.aCol[i3 + k] = rgb[k];
    }

    layer.alpha0[idx] = preset.alpha * (0.8 + Math.random() * 0.3);
    layer.aAlpha[idx] = preset.delay > 0 || preset.fadeInAt > 0 ? 0
      : preset.attack > 0 ? 0.001 : layer.alpha0[idx];
    layer.aHard[idx] = preset.hard;
    layer.aStyle[idx * 3] = preset.shapeAlt >= 0 && Math.random() < 0.5
      ? preset.shapeAlt : preset.shape;
    layer.aStyle[idx * 3 + 1] = Math.random() * Math.PI * 2;
    layer.aStyle[idx * 3 + 2] = preset.occlusion;
    layer.aMotion[idx * 4] = layer.vx[idx];
    layer.aMotion[idx * 4 + 1] = layer.vy[idx];
    layer.aMotion[idx * 4 + 2] = layer.vz[idx];
    layer.aMotion[idx * 4 + 3] = 0;
    if (!layer.shaded && (preset.delay > 0 || preset.fadeInAt > 0)) {
      layer.aCol[i3] = layer.aCol[i3 + 1] = layer.aCol[i3 + 2] = 0;
    }
    layer.grav[idx] = preset.gravity;
    layer.drag[idx] = preset.drag;
    layer.bounce[idx] = preset.bounce;
    layer.attack[idx] = preset.attack;
    layer.fadeIn[idx] = preset.fadeInAt;
    layer.turb[idx] = preset.turb;
    layer.seed[idx] = Math.random() * 6.283;
    layer.cut[idx] = 0;
    layer.cutKeep[idx] = preset.cutKeep;
    layer.cutLife[idx] = preset.cutLife;
    const tag = preset.tag | 0;
    layer.tag[idx] = tag;
    layer.fresh[idx] = 0;
    tagCounts[tag]++;
  }

  function emitPreset(preset: Preset, pos: Vec3Like, n: Vec3Like, mult: number, o: EmitOptions): void {
    const layer = preset.layer === "add" ? addLayer : alphaLayer;
    const scale = o.scale ?? 1;
    const viewer = opts.viewerPosition?.();
    const distance = viewer ? Math.hypot(pos.x - viewer.x, pos.y - viewer.y, pos.z - viewer.z) : 0;
    if (distance > 80) return;
    const lod = distance < 18 ? 1 : distance < 38 ? 0.6 : 0.3;
    const want = preset.count * mult * (o.intensity ?? 1) * budget * lod;
    // Fractional counts are resolved stochastically so a 0.4-particle request
    // still fires sometimes instead of always rounding to zero.
    let count = Math.floor(want);
    if (Math.random() < want - count) count++;
    if (preset.signature && want > 0) count = 1;
    if (count <= 0) return;

    let rgb = presetRgb(preset);
    if (o.color != null) {
      // Tint: take the override's hue at each stop's original brightness, so an
      // ability keeps the preset's hot-core → cool-tail shape in its own colour.
      tmpColor.setHex(o.color);
      const tr = tmpColor.r, tg = tmpColor.g, tb = tmpColor.b;
      const base = rgb;
      rgb = tintRgb;
      rgb[0] = (base[0] + tr * 2) / 3; rgb[1] = (base[1] + tg * 2) / 3; rgb[2] = (base[2] + tb * 2) / 3;
      rgb[6] = tr * 0.75; rgb[7] = tg * 0.75; rgb[8] = tb * 0.75;
      rgb[3] = (rgb[0] + rgb[6]) / 2; rgb[4] = (rgb[1] + rgb[7]) / 2; rgb[5] = (rgb[2] + rgb[8]) / 2;
    }

    const floorY = o.floorY ?? Math.min(pos.y, defaultFloorY);

    for (let i = 0; i < count; i++) {
      const idx = layer.alloc();
      if (idx < 0) return;                 // saturated — drop the rest silently
      const i3 = idx * 3;

      const j = preset.jitter * scale;
      layer.aPos[i3] = pos.x + (Math.random() - 0.5) * j;
      layer.aPos[i3 + 1] = pos.y + (Math.random() - 0.5) * j;
      layer.aPos[i3 + 2] = pos.z + (Math.random() - 0.5) * j;

      // Direction: the surface normal, scattered into a cone by `spread`, with a
      // constant upward bias so debris arcs instead of hugging the wall.
      const s = preset.spread;
      let dx = n.x + (Math.random() - 0.5) * 2 * s;
      let dy = n.y + (Math.random() - 0.5) * 2 * s + preset.rise;
      let dz = n.z + (Math.random() - 0.5) * 2 * s;
      const len = Math.hypot(dx, dy, dz) || 1;
      const speed = (preset.speed[0] + Math.random() * (preset.speed[1] - preset.speed[0])) * scale;
      layer.vx[idx] = (dx / len) * speed;
      layer.vy[idx] = (dy / len) * speed;
      layer.vz[idx] = (dz / len) * speed;

      initSlot(layer, idx, preset, scale, rgb);
      // Stash the floor for this particle by clamping now — the sim uses one
      // shared floor per frame, which is right for a flat arena.
      if (preset.bounce > 0 && layer.aPos[i3 + 1] < floorY) layer.aPos[i3 + 1] = floorY;
    }
  }

  return {
    objects: [addLayer.points, alphaLayer.points],

    emit(name, pos, normal, o = {}) {
      const n = normal ?? nx;
      const composite = effects[name];
      if (composite) {
        for (const [presetName, mult] of composite) {
          const preset = presets[presetName];
          if (preset) emitPreset(preset, pos, n, mult, o);
        }
        return;
      }
      const preset = presets[name];
      if (preset) emitPreset(preset, pos, n, 1, o);
    },

    spawn(name, px, py, pz, vx, vy, vz, age = 0, cut = 0, sizeMul = 1) {
      const preset = presets[name];
      if (!preset) return false;
      // Adaptive quality thins continuous emitters the same way it thins bursts.
      if (budget < 1 && Math.random() > budget) return false;
      if (age >= preset.life[1]) return false;
      const layer = preset.layer === "add" ? addLayer : alphaLayer;
      const idx = layer.alloc();
      if (idx < 0) return false;
      layer.vx[idx] = vx; layer.vy[idx] = vy; layer.vz[idx] = vz;
      initSlot(layer, idx, preset, sizeMul, presetRgb(preset));
      const i3 = idx * 3;
      // Sub-frame birth: it left the nozzle `age` seconds ago, so it is already
      // that far down its path. Without this a continuous stream renders as
      // frame-spaced clumps, and at 30 fps the clumps are half a metre apart.
      layer.aPos[i3] = px + vx * age;
      layer.aPos[i3 + 1] = py + vy * age;
      layer.aPos[i3 + 2] = pz + vz * age;
      if (age > 0) layer.life[idx] = Math.max(0.001, layer.life[idx] - age);
      layer.cut[idx] = cut;
      layer.fresh[idx] = 1;
      return true;
    },

    definePreset(name, preset) { presets[name] = P(preset); },

    defineEffect(name, parts) { effects[name] = parts; },

    tagCount(tag) { return tagCounts[tag] | 0; },

    update(dt) {
      const h = viewportHeight();
      if (addLayer.shaded) {
        addLayer.mat.uniforms.uViewportHeight.value = h;
        alphaLayer.mat.uniforms.uViewportHeight.value = h;
      }
      // Age on real dt, integrate motion on a clamped step — see Layer.update().
      const step = Math.min(dt, 0.05);
      addLayer.update(dt, step, defaultFloorY);
      alphaLayer.update(dt, step, defaultFloorY);
    },

    clear() { addLayer.clear(); alphaLayer.clear(); },
    count() { return addLayer.count + alphaLayer.count; },
    capacity() { return addLayer.capacity + alphaLayer.capacity; },

    trim(fraction) {
      addLayer.truncate(Math.floor(addLayer.capacity * fraction));
      alphaLayer.truncate(Math.floor(alphaLayer.capacity * fraction));
    },

    setBudget(scale) { budget = Math.max(0, Math.min(1, scale)); },

    dispose() {
      scene.remove(addLayer.points);
      scene.remove(alphaLayer.points);
      addLayer.dispose();
      alphaLayer.dispose();
      atlas.dispose();
    },
  };
}
