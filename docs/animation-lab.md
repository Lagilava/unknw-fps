# Animation lab

Open **https://lagilava.github.io/unknw-fps/play/?animationLab=1**.

Locally, start `npm run dev` and open **http://localhost:3000/?animationLab=1**.

This is a separate boot path inside the game. It loads Pete, the weapon models and player clips, then runs the production character-update and weapon-fit functions on a neutral, one-metre grid. It does not build the city, load enemy models, start waves or run combat AI. There is one WebGL renderer.

## Controls

- Select any of the nine weapons.
- Choose idle, armed jog, sprint, left/right strafe, backpedal or diagonal movement.
- Set elevation from -68° to +68° and heading through a full turn.
- Enable the automatic aim sweep to watch the arms through a continuous arc.
- Pause, advance exactly 1/60 second, or change playback speed.
- Use Front, Side and Rear views; drag to orbit and use the wheel to zoom.
- Enable bone chains to inspect elbows and wrists.
- Reload while standing or moving.
- Use Clip comparison to audition a loaded source/composite clip. Automatic weapon profile returns to the game's normal choice.
- Read live grip errors in centimetres, current action/phase and weapon length.

The camera follows the operator during movement. The grid repeats beneath it; character movement and foot placement still update in world space.

## Aim correction

The arm fitter now supplies one target orientation and one two-bone solve per gripping arm. Elbow poles point down and outward relative to the body instead of being inferred from an already modified elbow. The wrists follow their authored neutral grip orientation, calibrated once from the source clips. They do not receive a second layer of camera pitch.

Aim lean is applied to the upper spine after animation playback. The entire model, hips and legs no longer tilt with camera pitch. Arm targets stay within reach; a long-gun support hand can slide along its handguard. No bones are scaled or stretched.

The solver's offsets are removed before the next mixer sample. Reload and melee keep their authored/free-hand behavior.

## Locomotion choices

| Weapons | Forward | Left/right | Backward |
|---|---|---|---|
| Service Pistol, Gemini Machine Pistol | Authored Pistol Run | Directional strafe legs + pistol carry | Actual backward legs + pistol carry |
| Rifle, shotgun, precision rifle, SMG, LMG, DMR, auto-shotgun | Authored Rifle Run | Directional strafe legs + rifle carry | Actual backward legs + rifle carry |

The SMG uses a supported rifle-style carry rather than the one-handed pistol movement family. Left/right strafes are distinct clips. Backpedalling does not reverse the entire pistol-run animation. Clip cadence responds to ground speed.

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
