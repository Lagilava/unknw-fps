import * as THREE from 'three';

// Authored armed clips stay on the upper body; real directional clips own feet.
export function composeArmedLocomotion(lower: THREE.AnimationClip, upper: THREE.AnimationClip,
  upperBody: (track: THREE.KeyframeTrack) => boolean, name: string) {
  const tracks = lower.tracks.filter(t=>!upperBody(t)).map(t=>t.clone());
  for(const track of upper.tracks.filter(upperBody)) {
    const copy=track.clone();
    copy.times=Float32Array.from(copy.times,t=>t*lower.duration/Math.max(.001,upper.duration));
    tracks.push(copy);
  }
  return new THREE.AnimationClip(name,lower.duration,tracks);
}

export function chooseArmedLocomotion(actions: Record<string,any>, oneHand: boolean,
  f: number,s: number,sprint=false) {
  const lateral=Math.abs(s)>Math.abs(f)*1.2;
  if(lateral) {
    const preferred=oneHand ? (s<0?'pistolStrafeLeft':'pistolStrafeRight')
      : (s<0?'armedStrafeLeft':'armedStrafeRight');
    if(actions[preferred]) return preferred;
    return s<0 && actions.strafeAlt ? 'strafeAlt' : 'strafe';
  }
  if(f<-.1) return oneHand && actions.pistolBack ? 'pistolBack'
    : actions.armedBack ? 'armedBack' : actions.runBack ? 'runBack' : 'walkBack';
  return oneHand && actions.pistolRun ? 'pistolRun'
    : actions.rifleRun ? 'rifleRun' : sprint ? 'sprint' : 'walk';
}

export function locomotionRate(action: string,speed: number,sprintSpeed=9.2) {
  const reference=/Strafe|strafe/.test(action) ? 5.8 : /Back|back/.test(action) ? 5.2 : sprintSpeed;
  return THREE.MathUtils.clamp(speed/Math.max(.1,reference),.25,1.65);
}
