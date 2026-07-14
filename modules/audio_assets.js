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
  reload:       "./assets/audio/sfx/reload.ogg",
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
