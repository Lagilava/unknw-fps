// UNKNW — audio asset manifest.
//
// Maps logical event names → audio files under assets/audio/. Any event with no entry
// (or a file that fails to load) falls back to the game's built-in synthesized SFX.
// SFX are CC0 (Kenney.nl packs); VO is generated via Windows SAPI TTS. The event NAMES
// are the contract the game references at playEventSound()/announce() call sites.

// Short one-shot sound effects (CC0, Kenney.nl).
export const SFX_MANIFEST = {
  rifle_fire:   "./assets/audio/sfx/rifle_fire.ogg",
  shotgun_fire: "./assets/audio/sfx/shotgun_fire.ogg",
  sniper_fire:  "./assets/audio/sfx/sniper_fire.ogg",
  // Mystery-box roster fire SFX. Real CC0 Kenney sources were fetched and auditioned
  // (impactMetal/zap/laser/explosionCrunch clips — see assets/audio/sfx/ history), but
  // every one is a generic stock sample that doesn't match its gun's actual mechanism
  // (a "zap" for an SMG, a metal clank for a pistol crack) — using them would have
  // REPLACED the per-fireCycle synth voices in sfxShoot() (three_fps_game.js), which were
  // hand-tuned per mechanism (multi-layer noise/tone/distortion sequences per gun) and are
  // more accurate to each weapon than a mismatched one-shot recording. Left unmapped on
  // purpose so those synth voices keep firing (an unmapped event falls back to the synth
  // voice — see the header note). Drop a genuinely gun-matched file in assets/audio/sfx/
  // and add its mapping here to override any single one.
  //   pistol_fire, smg_fire, lmg_fire, dmr_fire, akimbo_fire, railgun_fire, flak_fire
  reload:       "./assets/audio/sfx/reload.ogg",
  // Per-reloadStyle SFX — real CC0 Kenney mechanical clacks (metalClick/metalLatch/
  // bookPlace/impactMetal), fetched and confirmed CC0 via each pack's bundled License.txt.
  // Unlike weapon fire, these are generic mechanical sounds by nature, so a real recorded
  // clack/latch genuinely fits better than a synth blip (falls back to the synth reload
  // voices in sfxReloadStyled() if a file ever goes missing).
  reload_mag:     "./assets/audio/sfx/reload_mag.ogg",
  reload_drum:    "./assets/audio/sfx/reload_drum.ogg",
  reload_shells:  "./assets/audio/sfx/reload_shells.ogg",
  reload_topload: "./assets/audio/sfx/reload_topload.ogg",
  equip_light:    "./assets/audio/sfx/equip_light.ogg",
  equip_heavy:    "./assets/audio/sfx/equip_heavy.ogg",
  // Interactable feedback (perk statue / mystery box / pack-a-punch already has pack_ready).
  perk_purchase:  "./assets/audio/sfx/perk_purchase.ogg",
  perk_deny:      "./assets/audio/sfx/perk_deny.ogg",
  box_open:       "./assets/audio/sfx/box_open.ogg",
  box_reveal:     "./assets/audio/sfx/box_reveal.ogg",
  box_dud:        "./assets/audio/sfx/box_dud.ogg",
  footstep1:    "./assets/audio/sfx/footstep1.ogg",
  footstep2:    "./assets/audio/sfx/footstep2.ogg",
  // jump intentionally left to the synth SFX — the Kenney "phaseJump" clip was goofy.
  land:         "./assets/audio/sfx/land.ogg",
  enemy_hit:    "./assets/audio/sfx/enemy_hit.ogg",
  player_hurt:  "./assets/audio/sfx/player_hurt.ogg",
  enemy_death:  "./assets/audio/sfx/enemy_death.ogg",
  wave_start:   "./assets/audio/sfx/wave_start.ogg",
  wave_clear:   "./assets/audio/sfx/wave_clear.ogg",
  mission_fail: "./assets/audio/sfx/mission_fail.ogg",
  pack_ready:   "./assets/audio/sfx/pack_ready.ogg",
  ui_click:     "./assets/audio/sfx/ui_click.ogg",
  ui_hover:     "./assets/audio/sfx/ui_hover.ogg",
  ammo_pickup:  "./assets/audio/sfx/ammo_pickup.ogg",
  explosion:    "./assets/audio/sfx/explosion.ogg",
  lightning:    "./assets/audio/sfx/lightning.ogg",
};

// ── Howler sample layer (real recorded SFX) ────────────────────────────────
// High-quality recorded one-shots/loops played through modules/audio_engine.ts
// (Howler.js). These take priority over the synth voices; if Howler fails to
// load or a file is missing, the game silently falls back to its synth SFX.
//
//  • fire_loop  — a SEAMLESS full-auto loop, re-pitched per automatic weapon
//    (rifle/smg/lmg/akimbo) so sustained fire is continuous, not retriggered.
//  • fire_*     — semi-auto one-shots (pistol/shotgun/sniper/dmr).
//  • reload     — one recorded reload, TIME-FIT to each gun's reloadTime at play.
//  • spell_magic / spell_electric — elemental ability casts (Warden/Seraph/Cherub
//    magic + generic lightning), re-pitched per ability in playSpell().
export const HOWLER_MANIFEST: Record<string, { src: string; loop?: boolean; volume?: number }> = {
  fire_loop:     { src: "./assets/sfx/moniker_subriquet-gunshot_smg_loop-203469.mp3", loop: true, volume: 0.8 },
  fire_pistol:   { src: "./assets/sfx/mrfriends-pistol-shot-233473.mp3", volume: 0.9 },
  fire_shotgun:  { src: "./assets/sfx/freesound_community-080902_shotgun-39753.mp3", volume: 0.95 },
  fire_sniper:   { src: "./assets/sfx/freesound_community-sniper-rifle-5989.mp3", volume: 1.0 },
  fire_dmr:      { src: "./assets/sfx/sovetsky_rastov72-fn-p90-sound-effect-265718.mp3", volume: 0.9 },
  reload:        { src: "./assets/sfx/dragon-studio-gun-reload-2-511308.mp3", volume: 0.85 },
  // Spell samples are pre-reverbed and long-tailed → kept deliberately quiet so
  // repeated casts don't dominate the mix (playSpell attenuates further).
  spell_magic:   { src: "./assets/sfx/rescopicsound-elemental-magic-spell-impact-outgoing-228342.mp3", volume: 0.5 },
  spell_electric:{ src: "./assets/sfx/freesound_community-075681_electric-shock-33018.mp3", volume: 0.45 },
  // A crisp sci-fi whoosh for teleport-flavoured casts (Blink Strike / Afterimage)
  // — replaces the reverbed magic there so blinking reads sharp, not boomy.
  whoosh:        { src: "./assets/sfx/floraphonic-scifi-anime-whoosh-91-207103.mp3", volume: 0.6 },
  // Deep cyberpunk bass hit for grenade/heavy detonations.
  explosion:     { src: "./assets/sfx/black_kumizhi-cyberpunk-bass-impact-effect-479138.mp3", volume: 0.9 },
  // Zombie vocalisations (two variants, chosen at random), played non-overlapping
  // via audioEngine.playSingle so long groans never stack on themselves.
  zombie_voice_a:{ src: "./assets/sfx/dragon-studio-zombie-sound-357975.mp3", volume: 0.55 },
  zombie_voice_b:{ src: "./assets/sfx/dragon-studio-zombie-sound-2-357976.mp3", volume: 0.55 },
};

// Announcer voice-over (played via announce(), min-gap so lines don't stack). Prefixed
// "vo_" so VO names never collide with the SFX names above.
export const VO_MANIFEST = {
  vo_game_start:       "./assets/audio/vo/game_start.wav",
  vo_wave_start:       "./assets/audio/vo/wave_start.wav",
  vo_wave_start_final: "./assets/audio/vo/wave_start_final.wav",
  vo_wave_clear:       "./assets/audio/vo/wave_clear.wav",
  vo_mission_fail:     "./assets/audio/vo/mission_fail.wav",
  vo_pack_ready:       "./assets/audio/vo/pack_ready.wav",
  vo_headshot:         "./assets/audio/vo/headshot.wav",
  vo_killstreak:       "./assets/audio/vo/killstreak.wav",
  vo_low_health:       "./assets/audio/vo/low_health.wav",
  vo_reload:           "./assets/audio/vo/reload_vo.wav",
};
