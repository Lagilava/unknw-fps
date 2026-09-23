# Gameplay and animation pass

The active project is UNKNW, using Three.js and a third-person player rig. Existing local mission, map, HUD and wave-rule edits were preserved. The reported player idle regression was corrected by restoring the supplied animated aiming-idle pose and fitting each gun to explicit palm contacts. Idle and firing share this fitting path.

## Pacing changes

| Setting | Before → after | Reason |
|---|---|---|
| Relay upload | 11s → 7s | Removes four seconds of holding; presence and enemy contest rules still apply. Simulation and HUD share one constant. |
| LMG drum reload | 2.6s → 2.3s | Shorter interruption while retaining the longest reload in the roster. |
| Mystery-box rise | 3.0s → 2.2s | Speeds the reveal; the 0.7s result hold remains. Total 3.7s → 2.9s. |
| PvP respawn | 5s → 4s | Less time out of the fight. |
| Co-op respawn | 10s → 8s | Shorter downtime; the downed message uses the same constant. |
| Zombie alert lock | Up to 1.6s → up to 1.1s | Compresses the actual scream clip to the lock, instead of interrupting a slow clip partway through. |
| Simulation per rendered frame | At most 25ms → at most four steps totaling 100ms | The old cap made gameplay run at half speed at 20 FPS. Steps remain ≤25ms; normal elapsed time is preserved from 10 FPS upward. Excess time after long stalls is discarded. |
| Enemy death presentation | Immediate disappearance → 1.2s visual phase | Existing death clips now render. Scoring, rewards and removal from live combat remain immediate. At most 12 active death visuals. |
| Relay text refresh | Every frame → 10Hz, plus contest changes | Avoids redundant DOM work; simulation/contest detection remain full rate. |

Other reviewed values were retained deliberately:

- Rifle/pistol/SMG/shotgun/sniper/DMR/akimbo/flak reloads: 1.05 / 0.85 / 0.95 / 1.45 / 1.55 / 1.3 / 1.15 / 1.7 seconds. Already short; reducing these further would alter sustained weapon damage appreciably.
- Weapon switches: 0.18–0.5s; inspections: 1.1–1.9s and interruptible. Melee: 0.34s swing / 0.5s cooldown. Retained for readable weight and cadence.
- Wave-clear callback 520ms, transition preparation 220ms, loading-screen dismissal 180ms. Short presentation/preparation intervals, not long objective holds.
- Menu transitions roughly 150–350ms; intel entry 220ms. Nonblocking and already responsive. Death fade 2.5s is behind immediately available end-game statistics, and lets the death pose play.
- Wave protection 5s; relay aggro memory/rush 8s; hostile contest radius 5m, upload radius 3.5m. Retained for safety and encounter pressure.
- Enemy attack intervals, ability windups/cooldowns, damage ticks, navigation intervals, multikill/streak windows, grenade/hazard timing and audio voice limits were retained. They express combat rules or technical scheduling rather than idle waits.
- No generic hold-to-open door or hold-to-buy timer exists in the active loop. Purchases/interactions are immediate or use the mystery-box reveal above.
- Intro/blackout cutscenes and restart terminal remain authored sequences. Making these skippable is a separate design choice; existing comments explicitly describe the intended unskippable presentation.

The encounter-director module is currently disconnected from the active always-aggro loop; retuning its values would not improve live gameplay, so it was left unchanged.

## Feedback and animation findings

The game already had hit markers, damage numbers, directional damage feedback, recoil, sound, combo scoring, ability telegraphs, and substantial locomotion coverage. These were retained rather than duplicated. Global hit-stop was not added: freezing a networked FPS would also delay movement and incoming attack feedback.

| State | Previous behavior | Change |
|---|---|---|
| Player idle, pistol/rifle families | Frozen running pose, including a raised foot | Original animated aiming-idle clip with grounded legs and a smooth breathing layer; removes the rejected frozen-run upper-body blend. |
| Player weapon grip and proportions | Arbitrary carry offsets/scales; idle and firing did not agree | Explicit length and palm contacts for all nine guns, right-hand anchoring and support-arm IK, smoothly blended reload cradle. |
| Player turning in place / turning while aiming | Root pivot with frozen legs | Blended stepping legs under the carry pose; cadence follows turn rate. |
| Player knife presentation | Gun and oversized knife occupied the same hand | Gun is hidden for the melee action; support-arm fitting is suspended; knife length reduced from about 62cm to 37cm. |
| Player moving reload | Full-body reload replaced locomotion | Separate lower-body locomotion layer; torso/arms retain reload control. |
| Player reload timing | Raw clip and some presentation used base weapon time | Clip phase and magazine staging use the actual reload duration, including upgrades. |
| Player landing | Camera/weapon feedback, no dedicated torso absorption | Short, damped torso absorption from the airborne-to-grounded transition. |
| Player damage reaction | Primarily camera/HUD feedback | Reversible, damped torso flinch from health loss. |
| Player solo death | Death action selection required the network-dead flag | Zero health also selects death and suppresses aiming. |
| Player/ghost/zombie death grounding | In-place conversion removed vertical hip motion | Retargeted vertical hip translation retained for death, without world X/Z root motion. |
| Zombie idle | Synchronized initial phase; stationary AI run state could freeze locomotion | Random initial idle phase and true idle when actual movement stops. |
| Zombie alert | Playback rate incorrectly followed movement speed | One-shot playback is independent of locomotion; scream fits its lock. |
| Zombie hit reaction | Feedback without a skeletal flinch | Bounded torso flinch layered over the current animation. |
| Zombie walk/run | Cadence jitter could disagree with travel speed | Travel-matched cadence; idle still varies between instances. |
| Zombie sparse-clip blending | Procedural rotations relied on every bone being keyed | Restore saved mixer poses before composing offsets, avoiding accumulated joint rotation. |
| Zombie crawl/run-crawl | Horizontal crawl skeleton at standing hip height | Retarget vertical position using the source idle-height reference. |
| Enemy deaths, all five types | Mesh hidden before clips could be seen | Existing skeletal/procedural death action runs during bounded visual removal phase. |
| Cloned Ghost death weapon | Gun remained suspended at its last firing position | Weapon follows the animated hand during death; normal parenting restores on live actions. |
| Cloned Ghost hit | Mostly material/scale feedback | Small, decaying body recoil driven by hit feedback. |
| Relay contested/resumed | Primarily marker/HUD indication | Explicit transition messages reinforce the existing cyan/amber visuals. |

Existing player walk, strafe, sprint, jump, aim, firing, melee and weapon mechanisms were reviewed, not claimed as new. Weapon lengths are explicit: pistol 25cm, akimbo model 32cm, SMG 56cm, flak 72cm, rifle 86cm, DMR 94cm, shotgun 98cm, LMG 102cm and sniper 110cm. These replace arbitrary carry-scale multipliers; steep-angle support-hand placement can slide along the handguard within a bounded range. Siege Drone, Blink Seraph and Null Cherub already had procedural idle/hover, turn, hit, attack and special-ability poses. Cloned Ghost already had idle, locomotion, firing and retreat animations. These controllers remain in use.

Crouch is not an implemented player control/state. There is no distinct enemy flee state; the ghost's retreat uses backpedal locomotion. Alert/search behavior in the active always-aggro game does not imply an unused animation should be presented as a new AI feature. Fallback unskinned rigs and disabled first-person presentation are not covered by the visual sign-off.

## Angle review and limitations

See [the per-state review register](animation-angle-review.md) and [the local screenshot gallery](../test-artifacts/animation-review/index.html). Every listed capture contains front, left, right, front-left, front-right, back-left, back-right, elevated, close and distant views at three sampled phases. The harness calls the real rig/controller updates and includes world-parented reload guns and magazines. It checks finite transforms; images provide the visual evidence.

This is a sampled visual review, not a guarantee that every frame, weapon/aim extreme, network transition or environment contact is collision-free. Known limits:

- Weapon palm contacts are explicitly fitted; the support arm uses a separate solver that preserves the authored elbow bend side and wrist orientation. Fingers retain the supplied clips, so exact trigger-finger curls and individual magazine handling remain approximate in close views. The legacy torso-anchored two-arm solver stays disabled; it is separate from the new support-arm solver.
- Ghost live carry still uses its existing approximate two-hand placement; its death grip is anchored explicitly. Ghost and zombie stationary turns retain idle/body-turn motion without an authored planted pivot.
- The knife can be partly occluded by the arm/body in close profiles during the short melee swing. Its visibility and proportion were corrected; a dedicated authored knife-hand clip would improve the action read.
- Turning uses a blended stepping approximation, not a dedicated authored pivot with guaranteed planted feet. Cadence matching improves motion but does not prove zero foot sliding on slopes, obstacles or all direction reversals.
- Death/crawl vertical retargeting improves ground alignment on the review plane. Corpse limbs can still intersect nearby walls/props; there is no ragdoll/contact solver for them. Short death visuals may end on a wave transition or during a large multikill.
- Close-up framing intentionally crops some full-body extremities; the other nine views retain silhouette context. Small hit reactions are harder to distinguish at long range, where existing flashes/audio carry the feedback.
- Co-op guest proxy disappearance still follows the existing snapshot-removal path. The new bounded death presentation is verified for locally simulated enemies; network proxy death presentation needs a separate lifecycle pass.
- Three phase samples cannot verify continuous foot planting or every blend. Reload-while-strafing and turn-while-aiming are included; jump/reload/weapon-switch interruptions and arbitrary aim extremes require further playtesting. Weapon fit captures additionally exercise plus/minus 1.1 radians of camera pitch.

## Intel and performance

All eight intel records now include a captioned, accessible image. Hostile records use direct captures of the game's actual models; site/blackout/signal records use existing game captures, with the invisible Echo explicitly labeled as contextual imagery. The original lore, selection controls and keyboard navigation remain. Images are compact WebP assets, loaded on selection, with fixed aspect ratios.

Animation offset records/quaternions are reused instead of allocated every frame. Zombie disposal releases instance skeleton buffers without disposing geometry/materials shared by the asset cache. Death skeleton work is bounded; live enemies, combat rules, graphics settings and spawn counts are not reduced. Bounded simulation substeps correct time dilation, but are not a claimed FPS increase and can require extra CPU work on slow frames.

## Balance follow-up

Relay contest/aggro pressure and enemy statistics remain intact. Measure contested time and completion/survival rates across waves after reducing the upload by 36%. If encounters become too easy, adjust approach/spawn placement using those results rather than automatically increasing every enemy count. Faster LMG reload increases sustained damage slightly; shortened co-op/PvP respawns increase team uptime. The corrected low-FPS simulation also restores enemy attack timing, making formerly slow-motion encounters feel more urgent.

## Validation

- TypeScript typecheck and Vite production build.
- Unit checks for simulation timing at 10–144 FPS, stall bounds, zombie idle/one-shot behavior, sparse-clip stability, shared-asset disposal, and existing performance-governor behavior.
- Browser review captures: 122 unique state/weapon cases in the combined register, ten views and three phases per case. This includes 45 passing weapon-fit cases across all nine guns: idle, fire, aim-up, aim-down and reload-while-strafing. Targeted correction captures replace affected earlier images. Palm-anchor assertions verify placement, not finger-mesh collision clearance.
- Browser regressions: relay presence/contest/progression; player wall collision/movement; wave protection, blackout rules and restart continuity; reload magazine/hand staging; enemy ability recovery/pooling; immediate death scoring and delayed visual removal.

The reload regression exposed a sampling issue after the timing fix: 250ms browser polling could miss the early part of an 850ms reload. It now advances the actual animation and reload controllers at 120Hz under the test-only pause, retaining the magazine visibility and hand staging assertions. Cold-load timeout is five minutes. Neither change alters gameplay.
