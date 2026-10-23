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
  return closeLocomotionLoop(new THREE.AnimationClip(name,lower.duration,tracks));
}

export function chooseArmedLocomotion(actions: Record<string,any>, oneHand: boolean,
  f: number,s: number,sprint=false) {
  const lateral=Math.abs(s)>Math.abs(f)*1.2;
  if(lateral) {
    const prefix=oneHand?'pistol':'armed';
    const preferred=prefix+(sprint?'Sprint':'Strafe')+(s<0?'Left':'Right');
    if(actions[preferred]) return preferred;
    return s<0 && actions.strafeAlt ? 'strafeAlt' : 'strafe';
  }
  if(f<-.1) return oneHand && actions.pistolBack ? 'pistolBack'
    : actions.armedBack ? 'armedBack' : actions.runBack ? 'runBack' : 'walkBack';
  if(sprint) {
    const preferred=oneHand?'pistolSprint':'armedSprint';
    if(actions[preferred]) return preferred;
  }
  return oneHand && actions.pistolRun ? 'pistolRun'
    : actions.rifleRun ? 'rifleRun' : sprint ? 'sprint' : 'walk';
}

export function locomotionRate(action: string,speed: number,sprintSpeed=9.2) {
  const reference=/Strafe|strafe/.test(action) ? 5.8 : /Back|back/.test(action) ? 5.2 : sprintSpeed;
  return THREE.MathUtils.clamp(speed/Math.max(.1,reference),.25,1.65);
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
