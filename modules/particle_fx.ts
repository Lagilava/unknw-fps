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
//   • webgpu → PointsMaterial with vertexColors. The additive layer is visually
//              identical (fading toward black IS fading out under additive
//              blending); the alpha layer loses per-particle opacity and fades by
//              color instead. WebGPU is the mobile/low-tier path, which already
//              runs a reduced particle budget, so the degradation lands where the
//              headroom is thinnest anyway.
//
// THREE is passed in rather than imported so this module stays usable from both
// entry points (Vite bare import + the legacy importmap) with one THREE instance.

type Vec3Like = { x: number; y: number; z: number };

/** Layer a preset renders into. Determines blending, not behaviour. */
type LayerName = "add" | "alpha";

interface Preset {
  layer: LayerName;
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
}

const P = (o: Partial<Preset> & Pick<Preset, "layer">): Preset => ({
  count: 6, speed: [2, 5], spread: 0.6, life: [0.3, 0.6], size: [0.08, 0.02],
  color: [0xffffff, 0xffffff], alpha: 1, gravity: 9, drag: 1.5, hard: 3,
  bounce: 0, attack: 0, jitter: 0.02, rise: 0.2, ...o,
});

/**
 * Emitter archetypes. These are the vocabulary; `EFFECTS` below composes them
 * into the things the game actually fires.
 */
const PRESETS: Record<string, Preset> = {
  // Hot metal spall off a hard surface. Fast, gravity-heavy, skitters on landing.
  spark: P({
    layer: "add", count: 7, speed: [5, 11], spread: 0.75, life: [0.16, 0.42],
    size: [0.14, 0.022], color: [0xfff6cf, 0xff5a12], alpha: 1,
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
    layer: "alpha", count: 5, speed: [0.5, 1.8], spread: 1, life: [0.9, 1.8],
    size: [0.36, 1.5], color: [0x5b5651, 0x2a2724],
    alpha: 0.5, gravity: -0.55, drag: 2.4, hard: 0.8, attack: 0.2,
    jitter: 0.12, rise: 0.7,
  }),
  // Solid chunks. Barely expand, bounce, fall out of the air fast.
  debris: P({
    layer: "alpha", count: 3, speed: [2.5, 6], spread: 0.85, life: [0.5, 1.1],
    size: [0.08, 0.058], color: [0x8c8378, 0x554e46], alpha: 0.95,
    gravity: 20, drag: 0.8, hard: 3, bounce: 0.32, attack: 0, rise: 0.5,
  }),
  // Fine aerosol at the moment of penetration — the readable "you hit it" cue.
  bloodMist: P({
    layer: "alpha", count: 6, speed: [1.5, 4.5], spread: 0.9, life: [0.22, 0.5],
    size: [0.13, 0.46], color: [0xa8121a, 0x4a0a10], alpha: 0.7,
    gravity: 3.5, drag: 3.2, hard: 1.0, attack: 0.06, rise: 0.3,
  }),
  // Discrete droplets that arc and hit the ground.
  blood: P({
    layer: "alpha", count: 5, speed: [2.5, 6.5], spread: 0.8, life: [0.35, 0.8],
    size: [0.09, 0.05], color: [0x8e0f16, 0x3d060b], alpha: 0.9,
    gravity: 15, drag: 0.9, hard: 2.6, bounce: 0.1, attack: 0, rise: 0.45,
  }),
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
  bulletFlesh: [["bloodMist", 1], ["blood", 0.8]],
  bulletMetal: [["flash", 1], ["spark", 1.5], ["debris", 0.4]],
  headshot: [["bloodMist", 1.8], ["blood", 1.6]],
  enemyDeath: [["bloodMist", 1.6], ["blood", 1.2], ["smoke", 0.5], ["ember", 0.5]],
  // Metal enemy (angel) death: shower of sparks + shrapnel + a puff of smoke and
  // hot embers — the mechanical equivalent of enemyDeath, no gore.
  enemyDeathMetal: [["flash", 1], ["spark", 2.2], ["debris", 1.4], ["smoke", 0.6], ["ember", 0.9]],
  energyImpact: [["energyCore", 1], ["energy", 1], ["dust", 0.6]],
  explosion: [["flash", 2], ["spark", 2], ["smoke", 1.4], ["ember", 1.2], ["debris", 1.2]],
};

const VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aHard;
uniform float uViewportHeight;
varying vec3 vColor;
varying float vAlpha;
varying float vHard;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vHard = aHard;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Correct perspective sizing: NDC height of a world-space size s at depth z is
  // s * P[1][1] / -z; multiply by half the viewport to land in pixels. (three's
  // built-in points shader ignores the projection term and so ignores FOV.)
  float px = aSize * projectionMatrix[1][1] * 0.5 * uViewportHeight / max(0.0001, -mv.z);
  gl_PointSize = min(px, 190.0);
  // Dead slots are parked off-screen rather than removed, so the draw range —
  // and therefore the compiled program — never changes.
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
// NOTE: do NOT include <tonemapping_pars_fragment> / <colorspace_pars_fragment>
// here — three's WebGLProgram already prepends both to every ShaderMaterial's
// fragment prefix, and re-including them is a "function already has a body"
// compile error. Only the call-site chunks below belong in the body.
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d2 = dot(p, p) * 4.0;           // squared radius, no sqrt
  if (d2 > 1.0) discard;
  float a = pow(1.0 - d2, vHard);       // hard core for sparks, soft puff for smoke
  gl_FragColor = vec4(vColor, a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface LayerOpts {
  capacity: number;
  additive: boolean;
  backend: "webgl" | "webgpu";
  renderOrder: number;
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

  // CPU-only simulation state.
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array;
  size0: Float32Array; size1: Float32Array;
  c0: Float32Array; c1: Float32Array;   // 3 floats each
  alpha0: Float32Array;
  grav: Float32Array; drag: Float32Array; bounce: Float32Array; attack: Float32Array;

  constructor(THREE: any, opts: LayerOpts) {
    const n = opts.capacity;
    this.capacity = n;
    this.additive = opts.additive;
    this.shaded = opts.backend === "webgl";

    this.aPos = new Float32Array(n * 3);
    this.aCol = new Float32Array(n * 3);
    this.aSize = new Float32Array(n);
    this.aAlpha = new Float32Array(n);
    this.aHard = new Float32Array(n);

    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n); this.size1 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.alpha0 = new Float32Array(n);
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
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    if (this.shaded) {
      this.mat = new THREE.ShaderMaterial({
        uniforms: { uViewportHeight: { value: 1080 } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    } else {
      // WebGPU path: no custom shader. Size is per-material, so pick the preset
      // midpoint; alpha rides on the vertex colour (exact under additive).
      this.mat = new THREE.PointsMaterial({
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
    }
    this.aSize[to] = this.aSize[from];
    this.aAlpha[to] = this.aAlpha[from];
    this.aHard[to] = this.aHard[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from];
    this.alpha0[to] = this.alpha0[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
    this.bounce[to] = this.bounce[from]; this.attack[to] = this.attack[from];
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
    for (let i = this.count - 1; i >= 0; i--) {
      const life = this.life[i] - dt;
      if (life <= 0) { this.kill(i); continue; }
      this.life[i] = life;

      const t = 1 - life / this.maxLife[i];          // 0 at birth → 1 at death
      const d = Math.max(0, 1 - this.drag[i] * step);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * step;

      const i3 = i * 3;
      let x = this.aPos[i3] + this.vx[i] * step;
      let y = this.aPos[i3 + 1] + this.vy[i] * step;
      let z = this.aPos[i3 + 2] + this.vz[i] * step;

      if (this.bounce[i] > 0 && y < floorY) {
        y = floorY;
        this.vy[i] = -this.vy[i] * this.bounce[i];
        this.vx[i] *= 0.55;
        this.vz[i] *= 0.55;
        // Below a threshold it is skittering, not bouncing — let it settle.
        if (Math.abs(this.vy[i]) < 0.35) { this.vy[i] = 0; this.bounce[i] = 0; }
      }

      this.aPos[i3] = x; this.aPos[i3 + 1] = y; this.aPos[i3 + 2] = z;
      this.aSize[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      for (let k = 0; k < 3; k++) {
        this.aCol[i3 + k] = this.c0[i3 + k] + (this.c1[i3 + k] - this.c0[i3 + k]) * t;
      }

      // Fade: quick ramp in over `attack`, linear-ish decay out, squared so the
      // tail disappears rather than lingering at a flat grey.
      const atk = this.attack[i];
      const rampIn = atk > 0 ? Math.min(1, t / atk) : 1;
      const fade = (1 - t) * (1 - t);
      const a = this.alpha0[i] * rampIn * fade;
      this.aAlpha[i] = a;
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
  }

  /** Drop live particles beyond `target`, newest first. O(dropped), not O(n²). */
  truncate(target: number): void {
    if (target >= this.count) return;
    for (let i = Math.max(0, target); i < this.count; i++) {
      this.aSize[i] = 0;
      this.aAlpha[i] = 0;
    }
    this.count = Math.max(0, target);
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear(): void {
    this.aSize.fill(0);
    this.aAlpha.fill(0);
    this.count = 0;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
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
  update(dt: number): void;
  clear(): void;
  /** Live particle count across both layers (for the perf HUD / __rbTest). */
  count(): number;
  capacity(): number;
  /** Drop the oldest particles when over budget — the adaptive-quality hook. */
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
}

/**
 * Build the particle system and add its two Points objects to `scene`.
 * They stay in the scene permanently (never toggled visible) so their programs
 * compile once during the boot warm-up and never relink.
 */
export function createParticleFX(THREE: any, scene: any, opts: CreateOptions = {}): ParticleFX {
  const backend = opts.backend === "webgpu" ? "webgpu" : "webgl";
  const low = !!opts.lowEnd;
  const addLayer = new Layer(THREE, {
    capacity: low ? 520 : 1400, additive: true, backend, renderOrder: 34,
  });
  const alphaLayer = new Layer(THREE, {
    capacity: low ? 260 : 700, additive: false, backend, renderOrder: 33,
  });
  scene.add(addLayer.points);
  scene.add(alphaLayer.points);

  const defaultFloorY = opts.floorY ?? 0.02;
  const viewportHeight = opts.viewportHeight ?? (() => 1080);
  let budget = low ? 0.5 : 1;

  const tmpColor = new THREE.Color();
  const nx = { x: 0, y: 1, z: 0 };

  function emitPreset(preset: Preset, pos: Vec3Like, n: Vec3Like, mult: number, o: EmitOptions): void {
    const layer = preset.layer === "add" ? addLayer : alphaLayer;
    const scale = o.scale ?? 1;
    const want = preset.count * mult * (o.intensity ?? 1) * budget;
    // Fractional counts are resolved stochastically so a 0.4-particle request
    // still fires sometimes instead of always rounding to zero.
    let count = Math.floor(want);
    if (Math.random() < want - count) count++;
    if (count <= 0) return;

    tmpColor.setHex(preset.color[0]);
    let r0 = tmpColor.r, g0 = tmpColor.g, b0 = tmpColor.b;
    tmpColor.setHex(preset.color[1]);
    let r1 = tmpColor.r, g1 = tmpColor.g, b1 = tmpColor.b;
    if (o.color != null) {
      // Tint: take the override's hue at each stop's original brightness, so an
      // ability keeps the preset's hot-core → cool-tail shape in its own colour.
      tmpColor.setHex(o.color);
      const tr = tmpColor.r, tg = tmpColor.g, tb = tmpColor.b;
      r0 = (r0 + tr * 2) / 3; g0 = (g0 + tg * 2) / 3; b0 = (b0 + tb * 2) / 3;
      r1 = tr * 0.75; g1 = tg * 0.75; b1 = tb * 0.75;
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

      const life = preset.life[0] + Math.random() * (preset.life[1] - preset.life[0]);
      layer.life[idx] = life;
      layer.maxLife[idx] = life;

      const sv = (0.8 + Math.random() * 0.45) * scale;
      layer.size0[idx] = preset.size[0] * sv;
      layer.size1[idx] = preset.size[1] * sv;
      layer.aSize[idx] = layer.size0[idx];

      layer.c0[i3] = r0; layer.c0[i3 + 1] = g0; layer.c0[i3 + 2] = b0;
      layer.c1[i3] = r1; layer.c1[i3 + 1] = g1; layer.c1[i3 + 2] = b1;
      layer.aCol[i3] = r0; layer.aCol[i3 + 1] = g0; layer.aCol[i3 + 2] = b0;

      layer.alpha0[idx] = preset.alpha * (0.8 + Math.random() * 0.3);
      layer.aAlpha[idx] = preset.attack > 0 ? 0.001 : layer.alpha0[idx];
      layer.aHard[idx] = preset.hard;
      layer.grav[idx] = preset.gravity;
      layer.drag[idx] = preset.drag;
      layer.bounce[idx] = preset.bounce;
      layer.attack[idx] = preset.attack;
      // Stash the floor for this particle by clamping now — the sim uses one
      // shared floor per frame, which is right for a flat arena.
      if (preset.bounce > 0 && layer.aPos[i3 + 1] < floorY) layer.aPos[i3 + 1] = floorY;
    }
  }

  return {
    objects: [addLayer.points, alphaLayer.points],

    emit(name, pos, normal, o = {}) {
      const n = normal ?? nx;
      const composite = EFFECTS[name];
      if (composite) {
        for (const [presetName, mult] of composite) {
          const preset = PRESETS[presetName];
          if (preset) emitPreset(preset, pos, n, mult, o);
        }
        return;
      }
      const preset = PRESETS[name];
      if (preset) emitPreset(preset, pos, n, 1, o);
    },

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
    },
  };
}
