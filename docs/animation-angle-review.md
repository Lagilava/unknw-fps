# Animation angle review register

Each row links to ten views at three phases: front, left, right, front-left, front-right, back-left, back-right, elevated, close and far. This is sampled review of the live controller output. Finite-transform assertions are automated; no claim is made that this proves continuous collision clearance or foot planting.

[Filterable local gallery](../test-artifacts/animation-review/index.html). Regenerate with the animation Playwright specs, then `node src/tests/build-animation-gallery.cjs`. Screenshot artifacts are local and ignored by Git.

| Rig | Animation | Angle evidence | Issues / limits |
|---|---|---|---|
| pistol | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/pistol-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| pistol | turn | [10 views × 3 phases](../test-artifacts/animation-review/pistol-turn.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| pistol | walk | [10 views × 3 phases](../test-artifacts/animation-review/pistol-walk.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| pistol | strafe | [10 views × 3 phases](../test-artifacts/animation-review/pistol-strafe.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| pistol | sprint | [10 views × 3 phases](../test-artifacts/animation-review/pistol-sprint.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| pistol | jump | [10 views × 3 phases](../test-artifacts/animation-review/pistol-jump.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| pistol | land | [10 views × 3 phases](../test-artifacts/animation-review/pistol-land.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| pistol | hit | [10 views × 3 phases](../test-artifacts/animation-review/pistol-hit.png) | Reaction is small at far distance; existing flash/audio supplement it. |
| pistol | aim | [10 views × 3 phases](../test-artifacts/animation-review/pistol-aim.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| pistol | aim-turn | [10 views × 3 phases](../test-artifacts/animation-review/pistol-aim-turn.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| pistol | aim-strafe | [10 views × 3 phases](../test-artifacts/animation-review/pistol-aim-strafe.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| pistol | reload | [10 views × 3 phases](../test-artifacts/animation-review/pistol-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| pistol | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/pistol-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| pistol | melee | [10 views × 3 phases](../test-artifacts/animation-review/pistol-melee.png) | Gun/knife overlap removed and knife rescaled; blade can be occluded by arm/body in close profiles. |
| pistol | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/pistol-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| pistol | death | [10 views × 3 phases](../test-artifacts/animation-review/pistol-death.png) | Grounding and silhouette; nearby wall/prop penetration remains possible. |
| rifle | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/rifle-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| rifle | turn | [10 views × 3 phases](../test-artifacts/animation-review/rifle-turn.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| rifle | walk | [10 views × 3 phases](../test-artifacts/animation-review/rifle-walk.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| rifle | strafe | [10 views × 3 phases](../test-artifacts/animation-review/rifle-strafe.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| rifle | sprint | [10 views × 3 phases](../test-artifacts/animation-review/rifle-sprint.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| rifle | jump | [10 views × 3 phases](../test-artifacts/animation-review/rifle-jump.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| rifle | land | [10 views × 3 phases](../test-artifacts/animation-review/rifle-land.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| rifle | hit | [10 views × 3 phases](../test-artifacts/animation-review/rifle-hit.png) | Reaction is small at far distance; existing flash/audio supplement it. |
| rifle | aim | [10 views × 3 phases](../test-artifacts/animation-review/rifle-aim.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| rifle | aim-turn | [10 views × 3 phases](../test-artifacts/animation-review/rifle-aim-turn.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| rifle | aim-strafe | [10 views × 3 phases](../test-artifacts/animation-review/rifle-aim-strafe.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| rifle | reload | [10 views × 3 phases](../test-artifacts/animation-review/rifle-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| rifle | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/rifle-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| rifle | melee | [10 views × 3 phases](../test-artifacts/animation-review/rifle-melee.png) | Gun/knife overlap removed and knife rescaled; blade can be occluded by arm/body in close profiles. |
| rifle | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/rifle-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| rifle | death | [10 views × 3 phases](../test-artifacts/animation-review/rifle-death.png) | Grounding and silhouette; nearby wall/prop penetration remains possible. |
| Zombie | idle | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-idle.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Zombie | walk | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-walk.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| Zombie | run | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-run.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| Zombie | turn | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-turn.png) | Existing idle/body turn; no authored planted pivot. |
| Zombie | alert | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-alert.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Zombie | attack | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-attack.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Zombie | attackBite | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-attackBite.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Zombie | attackLunge | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-attackLunge.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Zombie | attackNeck | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-attackNeck.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Zombie | crawl | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-crawl.png) | Vertical retargeting corrected; terrain hand/foot contact is approximate. |
| Zombie | runCrawl | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-runCrawl.png) | Vertical retargeting corrected; terrain hand/foot contact is approximate. |
| Zombie | hit | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-hit.png) | Reaction is small at far distance; existing flash/audio supplement it. |
| Zombie | death | [10 views × 3 phases](../test-artifacts/animation-review/Zombie-death.png) | Grounding and silhouette; nearby wall/prop penetration remains possible. |
| Siege Drone | idle | [10 views × 3 phases](../test-artifacts/animation-review/Siege_Drone-idle.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Siege Drone | walk | [10 views × 3 phases](../test-artifacts/animation-review/Siege_Drone-walk.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| Siege Drone | turn | [10 views × 3 phases](../test-artifacts/animation-review/Siege_Drone-turn.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| Siege Drone | attack | [10 views × 3 phases](../test-artifacts/animation-review/Siege_Drone-attack.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Siege Drone | hit | [10 views × 3 phases](../test-artifacts/animation-review/Siege_Drone-hit.png) | Reaction is small at far distance; existing flash/audio supplement it. |
| Siege Drone | barrage | [10 views × 3 phases](../test-artifacts/animation-review/Siege_Drone-barrage.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Siege Drone | death | [10 views × 3 phases](../test-artifacts/animation-review/Siege_Drone-death.png) | Grounding and silhouette; nearby wall/prop penetration remains possible. |
| Blink Seraph | idle | [10 views × 3 phases](../test-artifacts/animation-review/Blink_Seraph-idle.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Blink Seraph | walk | [10 views × 3 phases](../test-artifacts/animation-review/Blink_Seraph-walk.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| Blink Seraph | turn | [10 views × 3 phases](../test-artifacts/animation-review/Blink_Seraph-turn.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| Blink Seraph | attack | [10 views × 3 phases](../test-artifacts/animation-review/Blink_Seraph-attack.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Blink Seraph | hit | [10 views × 3 phases](../test-artifacts/animation-review/Blink_Seraph-hit.png) | Reaction is small at far distance; existing flash/audio supplement it. |
| Blink Seraph | blink | [10 views × 3 phases](../test-artifacts/animation-review/Blink_Seraph-blink.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Blink Seraph | death | [10 views × 3 phases](../test-artifacts/animation-review/Blink_Seraph-death.png) | Grounding and silhouette; nearby wall/prop penetration remains possible. |
| Null Cherub | idle | [10 views × 3 phases](../test-artifacts/animation-review/Null_Cherub-idle.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Null Cherub | walk | [10 views × 3 phases](../test-artifacts/animation-review/Null_Cherub-walk.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| Null Cherub | turn | [10 views × 3 phases](../test-artifacts/animation-review/Null_Cherub-turn.png) | Movement silhouette and blends; continuous planting on slopes/reversals is not certified. |
| Null Cherub | attack | [10 views × 3 phases](../test-artifacts/animation-review/Null_Cherub-attack.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Null Cherub | hit | [10 views × 3 phases](../test-artifacts/animation-review/Null_Cherub-hit.png) | Reaction is small at far distance; existing flash/audio supplement it. |
| Null Cherub | emp | [10 views × 3 phases](../test-artifacts/animation-review/Null_Cherub-emp.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Null Cherub | channel | [10 views × 3 phases](../test-artifacts/animation-review/Null_Cherub-channel.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| Null Cherub | death | [10 views × 3 phases](../test-artifacts/animation-review/Null_Cherub-death.png) | Grounding and silhouette; nearby wall/prop penetration remains possible. |
| Cloned Ghost | idle | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-idle.png) | Existing carry grip remains approximate in close profiles; action silhouette reviewed. |
| Cloned Ghost | walk | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-walk.png) | Existing carry grip remains approximate in close profiles; action silhouette reviewed. |
| Cloned Ghost | run | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-run.png) | Existing carry grip remains approximate in close profiles; action silhouette reviewed. |
| Cloned Ghost | strafe | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-strafe.png) | Existing carry grip remains approximate in close profiles; action silhouette reviewed. |
| Cloned Ghost | retreat | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-retreat.png) | Existing carry grip remains approximate in close profiles; action silhouette reviewed. |
| Cloned Ghost | turn | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-turn.png) | Existing idle/body turn; no authored planted pivot. |
| Cloned Ghost | attack | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-attack.png) | Existing carry grip remains approximate in close profiles; action silhouette reviewed. |
| Cloned Ghost | hit | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-hit.png) | Existing carry grip remains approximate in close profiles; action silhouette reviewed. |
| Cloned Ghost | death | [10 views × 3 phases](../test-artifacts/animation-review/Cloned_Ghost-death.png) | Grounding and silhouette; nearby wall/prop penetration remains possible. |
| shotgun | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/shotgun-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| shotgun | reload | [10 views × 3 phases](../test-artifacts/animation-review/shotgun-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| shotgun | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/shotgun-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| sniper | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/sniper-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| sniper | reload | [10 views × 3 phases](../test-artifacts/animation-review/sniper-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| sniper | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/sniper-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| lmg | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/lmg-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| lmg | reload | [10 views × 3 phases](../test-artifacts/animation-review/lmg-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| lmg | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/lmg-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| flak | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/flak-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| flak | reload | [10 views × 3 phases](../test-artifacts/animation-review/flak-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| flak | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/flak-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| smg | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/smg-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| smg | reload | [10 views × 3 phases](../test-artifacts/animation-review/smg-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| smg | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/smg-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| dmr | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/dmr-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| dmr | reload | [10 views × 3 phases](../test-artifacts/animation-review/dmr-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| dmr | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/dmr-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| akimbo | idle | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/akimbo-idle.png) | Restored animated aiming-idle pose; weapon size and palm contacts corrected. |
| akimbo | reload | [10 views × 3 phases](../test-artifacts/animation-review/akimbo-reload.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| akimbo | reload-strafe | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/akimbo-reload-strafe.png) | Movement blend and cradle reviewed; individual finger/magazine contact remains approximate in close profiles. |
| rifle | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/rifle-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| rifle | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/rifle-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| pistol | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/pistol-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| pistol | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/pistol-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| shotgun | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/shotgun-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| shotgun | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/shotgun-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| shotgun | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/shotgun-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| sniper | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/sniper-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| sniper | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/sniper-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| sniper | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/sniper-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| smg | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/smg-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| smg | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/smg-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| smg | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/smg-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| lmg | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/lmg-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| lmg | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/lmg-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| lmg | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/lmg-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| dmr | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/dmr-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| dmr | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/dmr-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| dmr | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/dmr-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| akimbo | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/akimbo-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| akimbo | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/akimbo-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| akimbo | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/akimbo-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| flak | fire | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/flak-fire.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| flak | aim-up | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/flak-aim-up.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |
| flak | aim-down | [10 views × 3 phases](../test-artifacts/animation-review/../weapon-fit/flak-aim-down.png) | Pose and joint orientation at the sampled phases; no continuous collision guarantee. |

See [the change report](gameplay-animation-overhaul.md) for fixes, balance follow-up and uncovered states.
