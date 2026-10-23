# Animation lab

Open **https://lagilava.github.io/unknw-fps/play/?animationLab=1**.

Locally, start `npm run dev` and open **http://localhost:3000/?animationLab=1**.

This is a separate boot path inside the game. It loads Pete, the weapon models and player clips, then runs the production character-update and weapon-fit functions on a neutral, one-metre grid. It does not build the city, load enemy models, start waves or run combat AI. There is one WebGL renderer.

## Controls

- Select any of the nine weapons.
- Choose idle, armed jog, sprint, left/right strafe, backpedal or diagonal movement.
- Set elevation from -7° to +7° and heading through a full turn.
- Enable the automatic aim sweep to watch the arms through a continuous arc.
- Pause, advance exactly 1/60 second, or change playback speed.
- Use Front, Side and Rear views; drag to orbit and use the wheel to zoom.
- Enable bone chains to inspect elbows and wrists.
- Reload while standing or moving.
- Use Clip comparison to audition a loaded source/composite clip. Automatic weapon profile returns to the game's normal choice.
- Read live grip errors in centimetres, current action/phase and weapon length.

The camera follows the operator during movement. The grid repeats beneath it; character movement and foot placement still update in world space.

## Aim correction

The arm fitter preserves each sampled clip's elbow plane and bone roll. It adds small, bounded swing corrections after the mixer; it does not reconstruct the arm's orientation from generic axes or force a neutral wrist rotation onto a different animated carry pose.
Aim lean is applied to the upper spine after animation playback. The entire model, hips and legs no longer tilt with camera pitch. Arm targets stay within reach; a long-gun support hand can slide along its handguard. Corrections are bounded so contact fitting cannot take priority over the character's anatomy. No bones are scaled or stretched.

The solver's offsets are removed before the next mixer sample. Reload and melee keep their authored/free-hand behavior.

## Locomotion choices

| Weapons | Forward | Left/right | Backward |
|---|---|---|---|
| Service Pistol, Gemini Machine Pistol | Pistol Run jog / sprint legs + pistol carry | Directional strafe legs + pistol carry | Actual backward legs + pistol carry |
| Rifle, shotgun, precision rifle, SMG, LMG, DMR, auto-shotgun | Rifle Run jog / sprint legs + armed carry | Directional strafe legs + rifle carry | Actual backward legs + rifle carry |

The SMG uses a supported rifle-style carry rather than the one-handed pistol movement family. Left/right strafes are distinct clips. Backpedalling does not reverse the entire pistol-run animation. Clip cadence responds to ground speed and directional changes retain the stride phase. Sprint uses the existing sprint-leg clips with an armed upper body.

Existing licensed assets are reused; no external motion pack is required. Clip comparison exposes the alternatives for review rather than assuming an animation filename proves that it looks good.

## Repeatable checks

```sh
npx playwright test --config .github/weapon-handling.config.cjs
```

The lab test checks:

- All nine weapons across idle, jog, sprint, both strafes and backpedal.
- Four body headings and a continuous low-to-high aim sweep.
- Finite transforms, palm/grip distance and frame-to-frame joint continuity.
- Idle feet staying still when only aim elevation changes.
- No enemy/HDR asset downloads and no active enemies in the lab.
- Side-view captures at low, level and high aim for pistol, rifle and precision rifle.

The existing reload/ADS browser test and 21 weapon-handling logic tests run alongside these checks. Screenshots are evidence for visual review; numeric tolerances alone do not establish that an animation looks natural.

The lab also exposes `window.__animationLab` for browser tests:
`set`, `step`, `setPlaying`, `view`, `reload`, `getState`, `getClips` and `getDiagnostics`.
`step(n)` advances exactly n production pose updates at 1/60 second.

## Anatomical corrections

Weapon aim elevation is clamped to ±7° for every weapon, including the lab sweep and API. Camera look and shot direction keep their normal range.

Armed movement uses the authored leg animation without world-space foot locks. The previous stance detector repeatedly replanted moving feet and fought the knee animation. This override is disabled even when an older saved foot-IK preference enables it.

Arm IK preserves the authored elbow plane and axial bone rotation. It applies bounded swing corrections rather than reconstructing skinned-bone axes from a generic frame. Wrist local rotations remain exactly as authored. Shoulder swing corrections are limited to 55° and elbow corrections to 77°; the visible palm is the endpoint, and bone positions and scales are not changed. These are correction limits relative to the sampled clip, not absolute anatomical joint angles.

The lab's skin-stretch measurement compares sampled arm-mesh triangle edges before and after IK at the same mixer time. Tests also cover forward + right, repeat movement for several loops, and verify that leg transforms exactly match the mixer pose. These measurements supplement visual review, not replace it.

Animation review guidance: [CloudAI-X Three.js Animation skill](https://github.com/CloudAI-X/threejs-skills/blob/main/skills/threejs-animation/SKILL.md). API details are checked against this game's Three.js r166.

Locomotion quaternion tracks close their end-to-start rotational seam over the last fifth of each loop. This avoids a repeat-boundary snap while retaining the first 80% of the source motion. The repeated-gait test includes the boundary and limits single-frame knee/ankle rotation changes.

Armed jog now uses rifle-run hips/legs under the same aiming torso/arms as strafing. This avoids asking IK to convert the full run clip's different carry pose into a forward aiming grip. Composite carry layers include spine, chest, neck and head, with hips/legs owned only by the directional clip.

Skin measurements exclude rest-pose edges shorter than 4 mm in world space so nearly degenerate seams do not dominate ratios. The source model itself has an approximately 5.3 mm edge that reaches 13.8 mm in its authored animation. Bind-shape stretch is therefore reported separately; regressions check the extra extension added by IK at the same mixer frame (under 10 mm), plus the 95th-percentile relative stretch (under 25%). This does not certify the original asset's weights or replace a rendered visual review.
