// UNKNW — Howler-backed sample audio engine.
//
// A thin, resilient layer over Howler.js that plays the real recorded SFX (gun
// fire, reload, elemental spells) with pooled voices, per-voice pitch/pan, a
// sustained fire-loop for automatic weapons, and time-fitted reload playback.
//
// Design contract with three_fps_game.ts:
//   • Everything degrades to the hand-tuned Web Audio SYNTH voices if Howler
//     fails to load (flaky CDN on the legacy importmap entry) or a sample is
//     missing — every public method returns false in that case so the caller
//     falls through to its synth path. The game is never audio-broken by this.
//   • Howler runs in its OWN AudioContext (separate from the game's synth bus).
//     We insert one mastering compressor on Howler's graph so the loud sample
//     layer (gunfire) glues instead of clipping.
//
// Howler ships UMD only (no ESM build), so we obtain it via a guarded dynamic
// import — resolved by Vite in index.html and by the importmap in the legacy
// entry. A failed import just leaves the engine disabled.

type HowlAny = any;

interface SoundDef {
  src: string;
  loop?: boolean;
  volume?: number;   // baseline gain baked into the Howl
  pool?: number;     // simultaneous voices (Howler html5:false pool size)
}

// Which gun uses which real sample, and how. Automatic weapons drive a single
// sustained loop (the seamless SMG-loop sample, re-pitched per weapon for a
// distinct body); semi-auto weapons fire pooled one-shots with micro pitch
// variation so sustained trigger-pulls never sound machine-stamped. Guns absent
// here (e.g. railgun) intentionally keep their bespoke synth voice.
const FIRE_MAP: Record<string, { loop?: string; shot?: string; rate?: number; volume?: number }> = {
  rifle:   { loop: "fire_loop", rate: 0.86, volume: 0.85 },
  smg:     { loop: "fire_loop", rate: 1.0,  volume: 0.8 },
  lmg:     { loop: "fire_loop", rate: 0.72, volume: 0.95 },
  akimbo:  { loop: "fire_loop", rate: 1.16, volume: 0.72 },
  pistol:  { shot: "fire_pistol",  rate: 1.0,  volume: 0.85 },
  shotgun: { shot: "fire_shotgun", rate: 1.0,  volume: 0.95 },
  sniper:  { shot: "fire_sniper",  rate: 1.0,  volume: 1.0 },
  dmr:     { shot: "fire_dmr",     rate: 0.9,  volume: 0.92 },
  flak:    { shot: "fire_shotgun", rate: 0.88, volume: 0.95 },
};

// How long after the last shot an automatic fire-loop keeps running before it
// fades out. Must exceed the slowest automatic weapon's fireRate (LMG 0.092s)
// with margin so the loop is continuous between shots but stops promptly on
// trigger release / empty mag.
const FIRE_LOOP_HOLD = 0.19;

class AudioEngine {
  private ready = false;
  private Howl: HowlAny = null;
  private Howler: HowlAny = null;
  private howls = new Map<string, HowlAny>();
  private defs = new Map<string, SoundDef>();
  private initStarted = false;

  // Active automatic fire-loop bookkeeping.
  private loopHowl: HowlAny = null;
  private loopId: number | null = null;
  private loopName: string | null = null;
  private loopRate = 1;
  private loopVolume = 1;
  private loopExpiry = 0;
  private loopTimer: any = null;

  register(name: string, def: SoundDef) { this.defs.set(name, def); }

  registerAll(map: Record<string, SoundDef>) {
    for (const [name, def] of Object.entries(map)) this.register(name, def);
  }

  /** Load Howler (guarded) and instantiate every registered Howl. Idempotent. */
  async init(): Promise<boolean> {
    if (this.initStarted) return this.ready;
    this.initStarted = true;
    try {
      const mod: any = await import("howler");
      this.Howl = mod.Howl || mod.default?.Howl;
      this.Howler = mod.Howler || mod.default?.Howler;
      if (!this.Howl) return false;
      for (const [name, def] of this.defs) {
        this.howls.set(name, new this.Howl({
          src: [def.src],
          loop: !!def.loop,
          volume: def.volume ?? 1,
          preload: true,
          pool: def.pool ?? (def.loop ? 2 : 8),
          html5: false,
        }));
      }
      this.installMasterCompressor();
      // Match the synth bus master (0.78) so the sample layer sits level with the
      // procedural SFX rather than a touch hotter (Howler defaults to 1.0).
      try { this.Howler.volume(0.82); } catch (_e) {}
      this.ready = true;
      return true;
    } catch (_e) {
      // Howler unavailable → engine stays disabled, synth fallback covers all.
      return false;
    }
  }

  private installMasterCompressor() {
    try {
      const ctx = this.Howler?.ctx;
      const masterGain = this.Howler?.masterGain;
      if (!ctx || !masterGain || !ctx.createDynamicsCompressor) return;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 16;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      masterGain.disconnect();
      masterGain.connect(comp);
      comp.connect(ctx.destination);
    } catch (_e) { /* leave default routing */ }
  }

  has(name: string): boolean { return this.ready && this.howls.has(name); }

  /** Scale the Howler master output. `mul` is 0..1 (the user's volume setting);
   *  0.82 is the sample layer's calibrated baseline (matched to the synth bus). */
  setMasterVolume(mul: number): void {
    const m = Math.max(0, Math.min(1, mul));
    try { this.Howler?.volume?.(0.82 * m); } catch (_e) {}
  }

  // Per-name single-voice bookkeeping for playSingle (long ambient one-shots
  // like zombie vocals that must never stack on themselves).
  private singleIds = new Map<string, number>();

  /**
   * Play a sound only if its previous voice has finished — prevents long/reverbed
   * samples (zombie groans, ambience) from piling up on themselves. Returns true
   * if it started a new voice, false if one was still playing or unavailable.
   */
  playSingle(name: string, opts: { volume?: number; pan?: number; rate?: number } = {}): boolean {
    const h = this.ready ? this.howls.get(name) : null;
    if (!h) return false;
    const prev = this.singleIds.get(name);
    try { if (prev != null && h.playing(prev)) return false; } catch (_e) {}
    const id = this.play(name, opts);
    if (id >= 0) { this.singleIds.set(name, id); return true; }
    return false;
  }

  /** Cuts the currently-playing voice of a playSingle() sound early (e.g. its
   *  source died mid-groan) instead of letting it play out to its natural end. */
  stopSingle(name: string): void {
    const h = this.ready ? this.howls.get(name) : null;
    const id = this.singleIds.get(name);
    if (!h || id == null) return;
    try { h.stop(id); } catch (_e) {}
    this.singleIds.delete(name);
  }

  /** One-shot (or manual) play. Returns the Howler voice id, or -1 if unhandled. */
  play(name: string, opts: { volume?: number; pan?: number; rate?: number } = {}): number {
    const h = this.ready ? this.howls.get(name) : null;
    if (!h) return -1;
    try {
      const id = h.play();
      if (opts.volume != null) h.volume(clamp(opts.volume, 0, 1), id);
      if (opts.rate != null) h.rate(clamp(opts.rate, 0.5, 4), id);
      if (opts.pan != null && h.stereo) h.stereo(clamp(opts.pan, -1, 1), id);
      return id;
    } catch (_e) { return -1; }
  }

  /**
   * Play a sample stretched/compressed to finish in ~targetSec (used for reload:
   * the one recorded reload is time-fit to each weapon's reloadTime so the sound
   * lands exactly as the mechanical reload completes). Returns true if handled.
   */
  fitPlay(name: string, targetSec: number, opts: { volume?: number; pan?: number } = {}): boolean {
    const h = this.ready ? this.howls.get(name) : null;
    if (!h || !(targetSec > 0)) return false;
    try {
      const dur = h.duration();
      if (!(dur > 0)) { return this.play(name, opts) >= 0; }
      const rate = clamp(dur / targetSec, 0.5, 4);
      const id = h.play();
      h.rate(rate, id);
      if (opts.volume != null) h.volume(clamp(opts.volume, 0, 1), id);
      if (opts.pan != null && h.stereo) h.stereo(clamp(opts.pan, -1, 1), id);
      return true;
    } catch (_e) { return false; }
  }

  /**
   * Weapon fire. Automatic guns drive a sustained loop (started once, refreshed
   * per shot, auto-faded on trigger release); semi-auto guns fire a pooled
   * one-shot. Returns true if a real sample handled it (caller skips synth).
   */
  /** `mul` is the player's gunfire-category volume (0..1); it scales the sample
   *  gain so the Audio settings move recorded fire as well as the synth bus. */
  fire(gunType: string, mul = 1): boolean {
    if (!this.ready) return false;
    const f = FIRE_MAP[gunType];
    if (!f) return false;
    const m = clamp(mul, 0, 1);
    if (f.shot) {
      if (!this.howls.has(f.shot)) return false;
      const jitter = 0.96 + Math.random() * 0.08;
      return this.play(f.shot, { rate: (f.rate ?? 1) * jitter, volume: (f.volume ?? 1) * m }) >= 0;
    }
    if (f.loop) {
      if (!this.howls.has(f.loop)) return false;
      this.ensureFireLoop(f.loop, f.rate ?? 1, (f.volume ?? 0.85) * m);
      this.loopExpiry = now() + FIRE_LOOP_HOLD;
      return true;
    }
    return false;
  }

  private ensureFireLoop(name: string, rate: number, volume: number) {
    if (this.loopId != null && this.loopName === name && this.loopRate === rate) {
      // Same loop still running — retune its gain in place so a mid-burst
      // volume change takes effect without restarting the sample.
      if (Math.abs(volume - this.loopVolume) > 0.001) {
        this.loopVolume = volume;
        try { this.loopHowl?.volume(clamp(volume, 0, 1), this.loopId); } catch (_e) {}
      }
      return;
    }
    this.stopFireLoop(true);
    const h = this.howls.get(name);
    if (!h) return;
    try {
      const id = h.play();
      h.rate(clamp(rate, 0.5, 4), id);
      h.volume(clamp(volume, 0, 1), id);
      this.loopHowl = h;
      this.loopId = id;
      this.loopName = name;
      this.loopRate = rate;
      this.loopVolume = volume;
      if (!this.loopTimer) {
        this.loopTimer = setInterval(() => {
          if (this.loopId != null && now() >= this.loopExpiry) this.stopFireLoop(false);
        }, 40);
      }
    } catch (_e) { this.loopId = null; }
  }

  /** Stop the automatic fire-loop. immediate=true cuts hard (weapon swap). */
  stopFireLoop(immediate = false) {
    const h = this.loopHowl, id = this.loopId;
    this.loopHowl = null; this.loopId = null; this.loopName = null;
    if (this.loopTimer) { clearInterval(this.loopTimer); this.loopTimer = null; }
    if (!h || id == null) return;
    try {
      if (immediate) { h.stop(id); }
      else { h.fade(h.volume(id) || 0.6, 0, 70, id); setTimeout(() => { try { h.stop(id); } catch (_e) {} }, 90); }
    } catch (_e) {}
  }
}

function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }
function now() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000; }

export const audioEngine = new AudioEngine();
