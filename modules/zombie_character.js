// Zombie enemy character — a skinned Mixamo model driven by an AnimationMixer with
// smooth cross-faded state transitions and a layer of procedural, non-robotic turning.
//
// Mirrors the storm_warden.js contract: createZombieCharacter(...) returns
// { root, update(dt, enemyRef), playOnce, setDead, dispose }. The game wires the
// returned root like any character enemy and drives it through update(dt, enemyRef),
// so it slots into the existing `userData.mixer.update(dt)` call sites unchanged.
//
// Animation states (bites excluded by the asset list): idle, walk, run, attack,
// scream, crawl, runCrawl, dying, death. Transitions cross-fade (fadeIn/fadeOut) so
// the mixer interpolates between clips instead of snapping — the requested "lerp".
//
// Procedural turning: the spine/chest/neck/head bank and lead INTO the turn (driven
// by enemyRef.visualTurn) on top of whatever the clip plays, plus a speed-based hunch
// and an idle weight-shift. Because every Mixamo clip animates these bones every
// frame, the mixer rewrites them first and we compose a small offset after — no
// accumulation. This makes turns feel weighty and organic rather than a rigid pivot.

export function createZombieCharacter(THREE, sourceScene, clips, skeletonClone, options = {}) {
  const targetHeight = options.targetHeight || 1.8;
  const onceStates = options.onceStates || new Set(["attack", "scream", "dying", "death"]);

  const root = new THREE.Group();
  root.name = "Zombie";

  // ── Clone the shared source into an independent skinned instance ─────────────
  const model = skeletonClone(sourceScene);
  model.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; }
  });
  root.add(model);

  // Scale to target height, then ground the feet at y≈0 and centre on XZ.
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  let size = box.getSize(new THREE.Vector3());
  const scale = targetHeight / Math.max(0.001, size.y || targetHeight);
  model.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;
  model.rotation.y = options.modelYaw ?? Math.PI; // Mixamo faces -Z; turn to +Z forward
  root.updateMatrixWorld(true);

  const visualBox = new THREE.Box3().setFromObject(model);
  const visualSize = visualBox.getSize(new THREE.Vector3());

  // ── Animation mixer + actions ───────────────────────────────────────────────
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};

  // Upper-body-only variant of a clip: strips hips/leg rotation tracks AND all
  // position tracks, so it can play LAYERED on top of walk/run — the locomotion
  // clip keeps full ownership of the legs + hips while this drives spine/arms/head.
  // (three.js has no skeleton mask; disjoint track sets is the standard approach.
  // Additive blending is deliberately avoided: Mixamo clips share no rest pose and
  // additive-ing a full attack onto a run is what deforms the mesh.)
  const LOWER_BODY_RE = /^(mixamorigHips|mixamorigLeftUpLeg|mixamorigLeftLeg|mixamorigLeftFoot|mixamorigLeftToe|mixamorigRightUpLeg|mixamorigRightLeg|mixamorigRightFoot|mixamorigRightToe)\./;
  function makeUpperBodyClip(clip) {
    const tracks = clip.tracks.filter(t => !LOWER_BODY_RE.test(t.name) && !t.name.endsWith(".position"));
    if (!tracks.length) return null;
    return new THREE.AnimationClip(clip.name + "_upper", clip.duration, tracks);
  }

  for (const [name, clip] of Object.entries(clips)) {
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    const once = onceStates.has(name);
    action.loop = once ? THREE.LoopOnce : THREE.LoopRepeat;
    action.clampWhenFinished = once;
    action.enabled = true;
    actions[name] = action;
  }
  // The attack swings as an upper-body layer over the running legs (see playUpper).
  if (clips.attack) {
    const upperClip = makeUpperBodyClip(clips.attack);
    if (upperClip) {
      const a = mixer.clipAction(upperClip);
      a.loop = THREE.LoopOnce;
      a.clampWhenFinished = false; // must release, or the last frame holds the arms
      actions.attackUpper = a;
    }
  }

  // ── Procedural turn/lean bones ──────────────────────────────────────────────
  const bone = (n) => model.getObjectByName(n) || null;
  const spine  = bone("mixamorigSpine") || bone("mixamorigSpine1");
  const spine2 = bone("mixamorigSpine2") || bone("mixamorigSpine1");
  const neck   = bone("mixamorigNeck");
  const head   = bone("mixamorigHead");

  // ── State ───────────────────────────────────────────────────────────────────
  let activeName = null;
  let activeAction = null;
  let onceLockUntil = 0;   // while a once-state plays, don't override it
  let elapsed = 0;
  let dead = false;
  let prevAggroed = false;
  let prevAttacking = false;
  // smoothed procedural drivers
  let leanTurn = 0;        // bank into the turn
  let leadTurn = 0;        // head leads the turn
  let hunch = 0;           // forward lean with speed
  let swayPhase = Math.random() * Math.PI * 2;

  const damp = THREE.MathUtils.damp;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();

  function fadeTo(name, fade = 0.22) {
    const action = actions[name] || actions.idle;
    if (!action || name === activeName) return;
    action.enabled = true;
    action.reset();
    action.fadeIn(fade);
    action.play();
    if (activeAction) activeAction.fadeOut(fade);
    activeAction = action;
    activeName = name;
  }

  // Play a one-shot state (scream/death) and lock state selection until it ends.
  // Alive one-shots cap the lock at 1.6s: the intimidation scream must be a snappy
  // beat, and a long/misauthored clip must never leave the zombie planted forever
  // (the AI brain holds the mover while this lock is up).
  function playOnce(name, fade = 0.16) {
    if (!actions[name]) return;
    fadeTo(name, fade);
    const dur = actions[name].getClip().duration;
    const lock = (name === "death" || name === "dying") ? dur - fade : Math.min(dur - fade, 1.6);
    onceLockUntil = elapsed + lock;
  }

  // Upper-body one-shot layered OVER the current locomotion action (attack swings).
  // Does NOT touch activeAction/onceLockUntil, so the legs keep running the walk/run
  // cycle at full weight — no more frozen-legs glide when attacking mid-chase.
  let upperAction = null;
  let upperUntil = 0;
  const UPPER_SWING_DUR = 0.5; // compress the (long, slow-windup) Mixamo attack clip
                               // into a snappy swing matching the 0.55s melee cadence
  function playUpper(name, fade = 0.08) {
    const a = actions[name];
    if (!a) return false;
    const dur = a.getClip().duration;
    a.reset();
    a.timeScale = Math.max(1, dur / UPPER_SWING_DUR);
    a.setEffectiveWeight(1);
    a.fadeIn(fade);
    a.play();
    upperAction = a;
    upperUntil = elapsed + Math.min(dur, UPPER_SWING_DUR);
    return true;
  }

  function setDead(v = true) {
    if (!v) {
      dead = false;
      onceLockUntil = 0;
      elapsed = 0;
      prevAggroed = false;
      leanTurn = 0;
      leadTurn = 0;
      hunch = 0;
      upperAction = null;
      upperUntil = 0;
      prevAttacking = false;
      mixer.stopAllAction();
      activeName = null;
      activeAction = null;
      if (actions.idle) fadeTo("idle", 0);
      return;
    }
    if (dead) return;
    dead = true;
    const d = actions.death ? "death" : (actions.dying ? "dying" : null);
    if (d) { fadeTo(d, 0.12); onceLockUntil = Infinity; }
  }

  // Compose a small additive offset onto a bone the mixer just wrote (no accumulation
  // because the clip rewrites the bone every frame).
  function addBoneOffset(b, rx, ry, rz) {
    if (!b) return;
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    b.quaternion.multiply(_q);
  }

  function update(dt, enemyRef) {
    if (dt > 0.1) dt = 0.1;
    elapsed += dt;

    const alive       = enemyRef ? enemyRef.alive !== false : true;
    const visualSpeed = enemyRef?.visualSpeed || 0;
    const visualTurn  = enemyRef?.visualTurn  || 0;
    const isAttacking = !!enemyRef?.isAttacking;
    const aggroed     = !!enemyRef?.aggroed;
    const crawling    = !!enemyRef?.crawling;

    // ── Death ──────────────────────────────────────────────────────────────
    if (!alive && !dead) setDead();
    if (dead) { mixer.update(dt); return; }

    // ── Scream on first aggro (full-body one-shot; the AI brain reads the
    // exposed lock below and holds position, so the plant reads as intended) ──
    if (aggroed && !prevAggroed && actions.scream) playOnce("scream", 0.18);
    prevAggroed = aggroed;
    // Expose the full-body lock so updateZombieCombatState can stop the mover
    // while the scream (or any full-body one-shot) plays — no more scream-slide.
    if (enemyRef) enemyRef.zombieAnimLocked = elapsed < onceLockUntil;

    // ── Attack: upper-body swing layered over the running legs ──────────────
    // Edge-triggered on each melee wind-up so EVERY hit gets a visible swing —
    // this doubles as the "running melee": the legs keep the run cycle while the
    // arms lash out. (isAttacking pulses per wind-up; see the zref adapter.)
    if (isAttacking && !prevAttacking) {
      if (!playUpper("attackUpper", 0.08) && actions.attack && elapsed >= onceLockUntil) {
        playOnce("attack", 0.14); // fallback if the upper clip failed to build
      }
    }
    prevAttacking = isAttacking;
    // Release the layer once the swing ends (fade the arms back to locomotion).
    if (upperAction && elapsed >= upperUntil) {
      upperAction.fadeOut(0.14);
      upperAction = null;
    }

    // ── Locomotion state (only when not locked in a one-shot) ───────────────
    if (elapsed >= onceLockUntil) {
      let want;
      // The AI brain drives an explicit walk/run/idle state so the creature can commit
      // to a sprint-charge or a heavy shamble regardless of the instantaneous speed
      // sample. Fall back to speed thresholds if no state is supplied.
      const loco = enemyRef?.locoState;
      if (crawling) want = visualSpeed > 1.0 && actions.runCrawl ? "runCrawl" : "crawl";
      else if (loco === "run" && actions.run) want = "run";
      else if (loco === "walk" && actions.walk) want = "walk";
      else if (loco === "idle") want = "idle";
      else if (visualSpeed > 1.2 && actions.run) want = "run";
      else if (visualSpeed > 0.25 && actions.walk) want = "walk";
      else want = "idle";
      if (!actions[want]) want = "idle";
      fadeTo(want, 0.18);
    }

    // Scale animation playback speed to match actual movement speed.
    if (activeAction) {
      const baseSpeed = activeName === "run" ? 3.5 : activeName === "walk" ? 1.2 : 1.0;
      activeAction.timeScale = activeName === "idle" ? 1.0
        : clamp(visualSpeed / Math.max(0.001, baseSpeed), 0.6, 2.4);
    }

    mixer.update(dt);

    // ── Procedural, non-robotic turning (applied AFTER the mixer) ────────────
    // Bank + lead into the turn, hunch forward with speed, idle weight-shift.
    const speedN = clamp(visualSpeed / 6.5, 0, 1);
    leanTurn = damp(leanTurn, clamp(visualTurn * 0.12, -0.45, 0.45), 5, dt);
    leadTurn = damp(leadTurn, clamp(visualTurn * 0.16, -0.55, 0.55), 7, dt);
    hunch    = damp(hunch, speedN * 0.18, 3, dt);
    swayPhase += dt * (0.8 + speedN * 1.6);
    const sway = Math.sin(swayPhase) * (0.03 + speedN * 0.025);

    // spine: bank into turn (roll) + hunch forward (pitch) + lazy sway (yaw)
    addBoneOffset(spine,  hunch * 0.5, sway * 0.5, leanTurn * 0.5);
    addBoneOffset(spine2, hunch * 0.5, sway,       leanTurn * 0.6);
    // neck + head: lead the turn (head commits before the body) and counter the hunch
    addBoneOffset(neck, -hunch * 0.3, leadTurn * 0.5, leanTurn * 0.25);
    addBoneOffset(head, -hunch * 0.4, leadTurn * 0.6, -leanTurn * 0.2);
  }

  function dispose() {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
        else m?.dispose?.();
      }
    });
  }

  // initial pose
  if (actions.idle) { actions.idle.play(); activeAction = actions.idle; activeName = "idle"; }

  return {
    root, model, mixer, actions, update, playOnce, setDead, dispose,
    visualSize, scale,
    // diagnostics hook
    _diag: () => ({ activeName, leanTurn, leadTurn, hunch, dead, elapsed, onceLockUntil }),
  };
}
