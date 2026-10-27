import * as THREE from 'three';

// Authored armed clips stay on the upper body; real directional clips own feet.
export function composeArmedLocomotion(lower: THREE.AnimationClip, upper: THREE.AnimationClip,
  upperBody: (track: THREE.KeyframeTrack) => boolean, name: string, steadySidearm=false) {
  const carryTrack=(t:THREE.KeyframeTrack)=>upperBody(t)||/spine|chest|neck|head/i.test(t.name);
  const tracks = lower.tracks.filter(t=>!carryTrack(t)).map(t=>t.clone());
  for(const track of upper.tracks.filter(carryTrack)) {
    const copy=track.clone();
    copy.times=Float32Array.from(copy.times,t=>t*lower.duration/Math.max(.001,upper.duration));
    tracks.push(copy);
  }
  const clip=closeLocomotionLoop(new THREE.AnimationClip(name,lower.duration,tracks));
  if(steadySidearm) {
    // Directional sprint hips turn toward travel. Copying forward-run spine keys
    // onto them also turns the chest/arms sideways and pumps the gun vertically.
    // Keep the authored legs and the pelvis' weight transfer. Remove the large
    // directional yaw at the spine, while letting a fraction of its tilt/roll
    // reach the shoulders; fully cancelling it makes the body look rigid in POV.
    const hips=clip.tracks.find(t=>/Hips\.quaternion$/i.test(t.name));
    const reference=upper.tracks.find(t=>/Hips\.quaternion$/i.test(t.name));
    const hipSample=hips?.createInterpolant();
    const neutralHip=reference ? new THREE.Quaternion().fromArray(reference.values) : null;
    const q=new THREE.Quaternion(),base=new THREE.Quaternion(),hip=new THREE.Quaternion();
    const transfer=new THREE.Quaternion(),tilt=new THREE.Euler(0,0,0,'YXZ');
    for(const track of clip.tracks) {
      if(!(track instanceof THREE.QuaternionKeyframeTrack) || !carryTrack(track))continue;
      base.fromArray(track.values).normalize();
      const sample=track.createInterpolant();
      const count=Math.max(2,Math.ceil(clip.duration*60)+1);
      const times=new Float32Array(count),values=new Float32Array(count*4);
      for(let i=0;i<count;i++) {
        const time=clip.duration*i/(count-1);times[i]=time;
        // Retain a little authored motion instead of freezing the upper body.
        q.fromArray(sample.evaluate(time)).normalize();q.slerpQuaternions(base,q,.65);
        if(/Spine\.quaternion$/i.test(track.name) && hipSample && neutralHip) {
          hip.fromArray(hipSample.evaluate(time)).normalize();
          transfer.copy(neutralHip).invert().multiply(hip);tilt.setFromQuaternion(transfer,'YXZ');
          transfer.setFromEuler(tilt.set(tilt.x*.35,0,tilt.z*.35,'YXZ'));
          q.premultiply(transfer).premultiply(neutralHip).premultiply(hip.invert());
        }
        q.normalize().toArray(values,i*4);
      }
      track.times=times;track.values=values;
    }
  }
  return clip;
}

// Ground speed (m/s) each loop's stance foot travels at timeScale 1, measured in the
// animation lab with the character standing still (src/tests/animation-skate.spec.cjs
// keeps the table honest). The jog clips are slow walk-like cycles (2-3 m/s) and the
// strafe / backpedal loops are slower still; the game moves at 5.8 m/s, so playing
// them at speed/9.2 left the planted foot sliding at roughly 4 m/s. Fast movement
// therefore borrows the sprint-leg loops, whose stride really covers that ground.
export const LOCOMOTION_NATIVE_SPEED: Record<string,number> = {
  armedJog: 1.9, rifleRun: 1.9, pistolRun: 3.3,
  armedSprint: 6.0, pistolSprint: 6.3,
  armedStrafeLeft: 1.9, armedStrafeRight: 1.1, pistolStrafeLeft: 1.9, pistolStrafeRight: 1.1,
  armedSprintLeft: 6.6, pistolSprintLeft: 6.6, armedSprintRight: 5.6, pistolSprintRight: 5.6,
  armedBack: 2.0, pistolBack: 2.0, runBack: 2.0, walkBack: 0.9, walk: 1.1,
  strafe: 1.1, strafeAlt: 1.9, sprint: 6.0, sprintLeft: 6.6, sprintRight: 5.6,
  pistolStrafe: 2.4,
};
// Above this ground speed the sprint-leg loops stay in sync with the ground better
// than a jog loop ever could; hysteresis stops a boundary speed flip-flopping clips.
const FAST_ENTER = 3.6, FAST_EXIT = 3.0;
const FAST_FAMILY = /Sprint/;

// Which authored direction family animates a travel direction, and how far (radians,
// clockwise / toward the player's right) the legs must be turned from that family's own
// direction to point down the real one. Forward, strafe and backward loops cover 120°,
// 60° and 120° sectors, so W+D plays the run turned 45° under a counter-twisted torso
// instead of a forward cycle skating sideways across the ground (orientation warping).
export type LocomotionSector = { family: 'forward'|'left'|'right'|'back'; offset: number };
export function locomotionSector(f: number,s: number): LocomotionSector {
  if(Math.hypot(f,s)<.05) return {family:'forward',offset:0};
  const phi=Math.atan2(s,f),deg=Math.PI/180,abs=Math.abs(phi);
  if(abs<=60*deg) return {family:'forward',offset:phi};
  if(abs>=120*deg) return {family:'back',offset:phi-Math.sign(phi)*Math.PI};
  return phi>0 ? {family:'right',offset:phi-90*deg} : {family:'left',offset:phi+90*deg};
}

export function chooseArmedLocomotion(actions: Record<string,any>, oneHand: boolean,
  f: number,s: number,sprint=false,speed=0,current='') {
  const fast=sprint || speed>(FAST_FAMILY.test(current)?FAST_EXIT:FAST_ENTER);
  const prefix=oneHand?'pistol':'armed';
  const {family}=locomotionSector(f,s);
  if(family==='left' || family==='right') {
    const preferred=prefix+(fast?'Sprint':'Strafe')+(family==='left'?'Left':'Right');
    if(actions[preferred]) return preferred;
    return family==='left' && actions.strafeAlt ? 'strafeAlt' : 'strafe';
  }
  if(family==='back') {
    // The only backward loop is a 2 m/s step-back. At run speed play the sprint
    // legs in reverse (see locomotionRate) rather than skate on a slow clip.
    if(fast && actions[prefix+'Sprint']) return prefix+'Sprint';
    return oneHand && actions.pistolBack ? 'pistolBack'
      : actions.armedBack ? 'armedBack' : actions.runBack ? 'runBack' : 'walkBack';
  }
  if(fast) {
    const preferred=prefix+'Sprint';
    if(actions[preferred]) return preferred;
  }
  return oneHand && actions.pistolRun ? 'pistolRun'
    : actions.armedJog ? 'armedJog' : actions.rifleRun ? 'rifleRun' : fast ? 'sprint' : 'walk';
}

// Playback rate that keeps the stance foot still on the ground. `reverse` plays the
// loop backwards (sprint legs standing in for a backpedal).
export function locomotionRate(action: string,speed: number,reverse=false) {
  const native=LOCOMOTION_NATIVE_SPEED[action]||9.2;
  const rate=THREE.MathUtils.clamp(speed/native,.3,1.45);
  return reverse?-rate:rate;
}


// FBX motion clips can finish a few degrees away from their first pose. Close
// that rotational seam over the last fifth of the cycle instead of snapping at
// LoopRepeat. The first 80% and the authored axial bone rotations are retained.
export function closeLocomotionLoop(source:THREE.AnimationClip) {
  const clip=source.clone(),duration=clip.duration;
  if(duration<=0)return clip;
  const identity=new THREE.Quaternion(),first=new THREE.Quaternion(),last=new THREE.Quaternion();
  const correction=new THREE.Quaternion(),blendQ=new THREE.Quaternion(),q=new THREE.Quaternion();
  clip.tracks=clip.tracks.map(track=>{
    if(!(track instanceof THREE.QuaternionKeyframeTrack))return track;
    const interpolant=track.createInterpolant();
    first.fromArray(interpolant.evaluate(0)).normalize();
    last.fromArray(interpolant.evaluate(duration)).normalize();
    if(first.angleTo(last)<.001)return track;
    correction.copy(first).multiply(last.invert()).normalize();
    const count=Math.max(2,Math.ceil(duration*60)+1);
    const times=new Float32Array(count),values=new Float32Array(count*4);
    for(let i=0;i<count;i++){
      const time=duration*i/(count-1),weight=THREE.MathUtils.smoothstep(time/duration,.8,1);
      times[i]=time;q.fromArray(interpolant.evaluate(time)).normalize();
      blendQ.copy(identity).slerp(correction,weight);q.premultiply(blendQ).normalize();
      q.toArray(values,i*4);
    }
    return new THREE.QuaternionKeyframeTrack(track.name,times,values);
  });
  return clip;
}
