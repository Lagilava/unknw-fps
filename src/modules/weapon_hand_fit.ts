import * as THREE from 'three';

// Metres and model-local contact points (+X is the barrel). Geometry and hand
// contacts are separate: scaling a long gun never changes the operator's size.
export const WEAPON_HAND_FITS = {
  rifle:  { length: .86, right: [-.12,-.20,.02], left: [.37,-.03,0] },
  shotgun:{ length: .98, right: [-.08,-.22,.02], left: [.36,-.01,0] },
  sniper: { length: .96,right: [-.12,-.17,.02], left: [.45,-.01,0] },
  pistol: { length: .25, right: [-.07,-.17,.02], left: [-.02,-.14,-.02] },
  smg:    { length: .56, right: [-.10,-.20,.02], left: [.32,-.01,0] },
  lmg:    { length: .90,right: [-.24,-.20,.02], left: [.36,-.03,0] },
  dmr:    { length: .86, right: [-.12,-.18,.02], left: [.45,-.01,0] },
  akimbo: { length: .32, right: [-.08,-.20,.02], left: [-.02,-.16,-.02] },
  flak:   { length: .72, right: [.16,-.19,.02], left: [.48,-.08,0] },
};

export function createWeaponHandFitter() {
  const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), pitchQ = new THREE.Quaternion();
  const deltaQ = new THREE.Quaternion(), desiredQ = new THREE.Quaternion(), currentQ = new THREE.Quaternion();
  const twistQ = new THREE.Quaternion(), identityQ = new THREE.Quaternion();
  const axis = new THREE.Vector3(), palm = new THREE.Vector3(), offset = new THREE.Vector3();
  const rightGrip = new THREE.Vector3(), leftGrip = new THREE.Vector3(), shoulder = new THREE.Vector3();
  const target = new THREE.Vector3(), wristTarget = new THREE.Vector3(), actual = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const direction = new THREE.Vector3(), pole = new THREE.Vector3(), elbow = new THREE.Vector3();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), anchor = new THREE.Vector3();
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), torso = new THREE.Vector3(), stock = new THREE.Vector3();
  const bounds = new THREE.Box3(), localBox = new THREE.Box3(), inverse = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  const worldScale = new THREE.Vector3();
  const diag = { rightError:0,leftError:0,length:0,scale:0,torsoPush:0,valid:false,
    rightBend:0,leftBend:0,rightClamped:false,leftClamped:false };
  const palmLocals = new WeakMap<any, THREE.Vector3>();
  function palmLocal(hand) {
    let p = palmLocals.get(hand);
    if (!p) {
      const middle = hand.children.find(b => /Middle1$/.test(b.name));
      p = middle ? middle.position.clone().multiplyScalar(.45) : new THREE.Vector3();
      palmLocals.set(hand,p);
    }
    return p;
  }
  function palmPoint(hand,out) { return out.copy(palmLocal(hand)).applyMatrix4(hand.matrixWorld); }
  function measure(gun) {
    if (gun.userData.handFitLength) return gun.userData.handFitLength;
    gun.updateMatrixWorld(true); inverse.copy(gun.matrixWorld).invert(); bounds.makeEmpty();
    gun.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      for(let p=o;p && p!==gun;p=p.parent)
        if(!p.visible || p===gun.userData.fpHands?.left || p===gun.userData.fpHands?.right) return;
      o.geometry.computeBoundingBox(); matrix.multiplyMatrices(inverse,o.matrixWorld);
      localBox.copy(o.geometry.boundingBox).applyMatrix4(matrix); bounds.union(localBox);
    });
    gun.userData.handFitRear = bounds.min.x;
    return gun.userData.handFitLength = Math.max(.1,bounds.max.x-bounds.min.x);
  }
  // Solve in world space with a BODY-relative elbow pole. It never reads the
  // previously solved elbow to choose the bend side, so steep aim cannot flip it.
  function solve(side, bones, hand, gripWorld, wristQ, applyRotation, rig) {
    const upper = side==='right' ? bones?.rightUpperArm : bones?.leftUpperArm;
    const fore = side==='right' ? bones?.rightForeArm : bones?.leftForeArm;
    if(!upper || !fore || !hand) return;
    hand.getWorldScale(worldScale);
    offset.copy(palmLocal(hand)).multiply(worldScale).applyQuaternion(wristQ);
    wristTarget.copy(gripWorld).sub(offset);
    upper.getWorldPosition(a); fore.getWorldPosition(b); hand.getWorldPosition(c);
    const l1=a.distanceTo(b), l2=b.distanceTo(c);
    if(l1<1e-5 || l2<1e-5) return;
    direction.subVectors(wristTarget,a);
    const rawDistance=direction.length();
    if(rawDistance<1e-6) return;
    const distance=THREE.MathUtils.clamp(rawDistance,Math.abs(l1-l2)+.015,(l1+l2)*.985);
    diag[side+'Clamped']=Math.abs(rawDistance-distance)>.002;
    direction.multiplyScalar(1/rawDistance);
    pole.copy(right).multiplyScalar(side==='right'?.65:-.65).addScaledVector(forward,-.12);
    pole.y-=.9;
    pole.addScaledVector(direction,-pole.dot(direction));
    if(pole.lengthSq()<1e-5) pole.copy(forward).addScaledVector(direction,-forward.dot(direction));
    pole.normalize();
    const along=(l1*l1+distance*distance-l2*l2)/(2*distance);
    const height=Math.sqrt(Math.max(0,l1*l1-along*along));
    elbow.copy(a).addScaledVector(direction,along).addScaledVector(pole,height);
    from.subVectors(b,a).normalize(); to.subVectors(elbow,a).normalize();
    deltaQ.setFromUnitVectors(from,to); applyRotation(upper,deltaQ); upper.updateMatrixWorld(true);
    fore.getWorldPosition(b); hand.getWorldPosition(c);
    to.copy(a).addScaledVector(direction,distance).sub(b).normalize(); from.subVectors(c,b).normalize();
    deltaQ.setFromUnitVectors(from,to); applyRotation(fore,deltaQ); fore.updateMatrixWorld(true);
    hand.getWorldQuaternion(currentQ);deltaQ.copy(wristQ).multiply(currentQ.invert());
    applyRotation(hand,deltaQ); hand.updateMatrixWorld(true);
    diag[side+'Bend']=Math.acos(THREE.MathUtils.clamp((l1*l1+l2*l2-distance*distance)/(2*l1*l2),-1,1));
  }
  return {
    diag,
    update({rig,root,bones,rightHand,leftHand,gunType,yaw,pitch,reload,dead,applyRotation,
      bank=0,yawOffset=0,pitchOffset=0,support=true}) {
      diag.valid=false;
      const gun=rig?.gun,fit=WEAPON_HAND_FITS[gunType];
      if(!gun || !fit || !rightHand || !leftHand) return;
      if(dead) {
        if(!rig.deathHandFit) {
          root.updateMatrixWorld(true); rightHand.attach(gun);
          rig.deathHandFit={p:gun.position.clone(),q:gun.quaternion.clone(),s:gun.scale.clone()};
        }
        if(gun.parent!==rightHand) rightHand.add(gun);
        gun.position.copy(rig.deathHandFit.p); gun.quaternion.copy(rig.deathHandFit.q); gun.scale.copy(rig.deathHandFit.s);
        return;
      }
      rig.deathHandFit=null;
      const scale=fit.length/measure(gun);
      if(gun.parent!==root) root.add(gun);
      root.updateMatrixWorld(true);
      forward.set(-Math.sin(yaw),0,-Math.cos(yaw)); right.set(Math.cos(yaw),0,-Math.sin(yaw));
      const elevation=THREE.MathUtils.clamp(pitch,-1.2,1.2);
      // One target orientation; no additional hand/forearm pitch is layered on it.
      worldQ.setFromAxisAngle(axis.set(0,1,0),yaw+yawOffset+Math.PI/2);
      pitchQ.setFromAxisAngle(right,elevation+pitchOffset); worldQ.premultiply(pitchQ);
      worldQ.multiply(pitchQ.setFromAxisAngle(axis.set(1,0,0),reload*.3+bank));
      root.getWorldQuaternion(parentQ);
      gun.quaternion.copy(parentQ.invert()).multiply(worldQ); gun.scale.setScalar(scale);
      rightGrip.fromArray(fit.right); leftGrip.fromArray(fit.left);
      // Calibrate each wrist against its authored neutral hold, never against a
      // previously solved high/low pose. A shoulder-centred swing supplies pitch.
      if(!rig.gripWristOffsets) {
        const neutral=new THREE.Quaternion().setFromAxisAngle(axis.set(0,1,0),yaw+Math.PI/2);
        neutral.premultiply(new THREE.Quaternion().setFromAxisAngle(right,elevation*.18));
        rig.gripWristOffsets={
          right:rightHand.getWorldQuaternion(new THREE.Quaternion()).premultiply(neutral.clone().invert()),
          left:leftHand.getWorldQuaternion(new THREE.Quaternion()).premultiply(neutral.clone().invert())
        };
      }
      palmPoint(rightHand,anchor);
      if(bones?.rightUpperArm && reload<.001) {
        bones.rightUpperArm.getWorldPosition(shoulder);
        anchor.sub(shoulder);
        // Model lean already contributes .18; rotate the reach, not the wrist.
        pitchQ.setFromAxisAngle(right,elevation*.82);
        anchor.applyQuaternion(pitchQ).add(shoulder);
      }
      if(reload>0) { palmPoint(leftHand,palm); anchor.lerp(palm,reload); }
      root.worldToLocal(anchor);
      offset.copy(reload>.5?leftGrip:rightGrip).multiplyScalar(scale).applyQuaternion(gun.quaternion);
      // Blend the attachment itself as well as the anchor during reload.
      offset.copy(rightGrip).lerp(leftGrip,reload).multiplyScalar(scale).applyQuaternion(gun.quaternion);
      gun.position.copy(anchor).sub(offset); gun.updateMatrixWorld(true);
      let push=0;
      if(fit.length>.6 && bones?.spine) {
        bones.spine.getWorldPosition(torso);
        stock.set(gun.userData.handFitRear ?? fit.right[0],fit.right[1],0).applyMatrix4(gun.matrixWorld);
        offset.subVectors(stock,torso);
        // Smooth vertical weighting avoids a .22 m jump at the chest boundary.
        const vertical=1-THREE.MathUtils.smoothstep(Math.abs(offset.y),.25,.65);
        const lateral=1-THREE.MathUtils.smoothstep(Math.abs(offset.dot(right)),.18,.32);
        push=Math.min(.18,Math.max(0,.12-offset.dot(forward)))*vertical*lateral;
        root.getWorldQuaternion(parentQ);
        offset.copy(forward).multiplyScalar(push).applyQuaternion(parentQ.invert());
        gun.position.add(offset); gun.updateMatrixWorld(true);
      }
      diag.torsoPush=push;
      // Let the support grip slide along a long handguard before fitting both
      // arms. Compact sidearms instead keep their authored grip spacing.
      if(support && bones?.leftUpperArm && bones?.leftForeArm && fit.left[0]-fit.right[0]>.15) {
        bones.leftUpperArm.getWorldPosition(a);bones.leftForeArm.getWorldPosition(b);leftHand.getWorldPosition(c);
        target.copy(leftGrip).applyMatrix4(gun.matrixWorld);
        const reach=(a.distanceTo(b)+b.distanceTo(c))*.94;
        direction.subVectors(target,a);axis.set(1,0,0).applyQuaternion(worldQ);
        const distance=direction.length(),alignment=direction.dot(axis)/Math.max(.001,distance);
        // A regularized slide starts at zero continuously. A quadratic
        // intersection used to jump when its discriminant crossed zero.
        const slide=Math.min((fit.left[0]-fit.right[0])*scale*.65,
          Math.max(0,(distance-reach)*alignment/(alignment*alignment+.05)));
        leftGrip.x-=slide/scale;
      }
      // Project the WHOLE weapon into the intersection of both reachable wrist
      // volumes before changing any bone. This prevents a compact pistol/SMG
      // being perfectly attached to the right hand but unreachable by the left.
      if(support) for(let iteration=0;iteration<5;iteration++) {
        let changed=false;
        for(const side of ['right','left']) {
          if(side==='right' && reload>=.02) continue;
          const hand=side==='right'?rightHand:leftHand;
          const upper=side==='right'?bones?.rightUpperArm:bones?.leftUpperArm;
          const fore=side==='right'?bones?.rightForeArm:bones?.leftForeArm;
          if(!upper || !fore) continue;
          upper.getWorldPosition(a);fore.getWorldPosition(b);hand.getWorldPosition(c);
          const l1=a.distanceTo(b),l2=b.distanceTo(c),sum=l1+l2;
          target.copy(side==='right'?rightGrip:leftGrip).applyMatrix4(gun.matrixWorld);
          desiredQ.copy(worldQ).multiply(rig.gripWristOffsets[side]);
          hand.getWorldScale(worldScale);
          offset.copy(palmLocal(hand)).multiply(worldScale).applyQuaternion(desiredQ);
          wristTarget.copy(target).sub(offset);direction.subVectors(wristTarget,a);
          const distance=direction.length();
          const desiredDistance=THREE.MathUtils.clamp(distance,Math.max(Math.abs(l1-l2)+.015,sum*.30),sum*.96);
          if(Math.abs(distance-desiredDistance)<.0001) continue;
          if(distance<1e-6) direction.copy(forward);
          offset.copy(direction).setLength(desiredDistance).sub(direction);
          root.getWorldQuaternion(parentQ);offset.applyQuaternion(parentQ.invert());
          gun.position.add(offset);gun.updateMatrixWorld(true);changed=true;
        }
        if(!changed) break;
      }
      if(reload<.02 && support) {
        target.copy(rightGrip).applyMatrix4(gun.matrixWorld);
        desiredQ.copy(worldQ).multiply(rig.gripWristOffsets.right);
        solve('right',bones,rightHand,target,desiredQ,applyRotation,rig);
      }
      if(support) {
        target.copy(leftGrip).applyMatrix4(gun.matrixWorld);
        desiredQ.copy(worldQ).multiply(rig.gripWristOffsets.left);
        solve('left',bones,leftHand,target,desiredQ,applyRotation,rig);
      }
      palmPoint(rightHand,actual); rightGrip.applyMatrix4(gun.matrixWorld); diag.rightError=actual.distanceTo(rightGrip);
      palmPoint(leftHand,actual); leftGrip.applyMatrix4(gun.matrixWorld); diag.leftError=actual.distanceTo(leftGrip);
      diag.length=fit.length;diag.scale=scale;diag.valid=true;
    }
  };
}
