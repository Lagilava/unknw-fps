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
