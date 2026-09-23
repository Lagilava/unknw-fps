import * as THREE from 'three';

// Metres and model-local contact points (+X is the barrel). Geometry and hand
// contacts are separate: scaling a long gun never changes the operator's size.
export const WEAPON_HAND_FITS = {
  rifle:  { length: .86, right: [-.12,-.20,.02], left: [.37,-.03,0] },
  shotgun:{ length: .98, right: [-.08,-.22,.02], left: [.36,-.01,0] },
  sniper: { length: 1.10,right: [-.12,-.17,.02], left: [.45,-.01,0] },
  pistol: { length: .25, right: [-.07,-.17,.02], left: [-.02,-.14,-.02] },
  smg:    { length: .56, right: [-.10,-.20,.02], left: [.32,-.01,0] },
  lmg:    { length: 1.02,right: [-.24,-.20,.02], left: [.36,-.03,0] },
  dmr:    { length: .94, right: [-.12,-.18,.02], left: [.45,-.01,0] },
  akimbo: { length: .32, right: [-.08,-.20,.02], left: [-.02,-.16,-.02] },
  flak:   { length: .72, right: [.16,-.19,.02], left: [.48,-.08,0] },
};

export function createWeaponHandFitter() {
  const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), pitchQ = new THREE.Quaternion();
  const axis = new THREE.Vector3(), palm = new THREE.Vector3(), offset = new THREE.Vector3();
  const rightGrip = new THREE.Vector3(), leftGrip = new THREE.Vector3(), wrist = new THREE.Vector3();
  const target = new THREE.Vector3(), palmOffset = new THREE.Vector3(), actual = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const direction = new THREE.Vector3(), pole = new THREE.Vector3(), elbow = new THREE.Vector3();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), leftPosition = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), handQ = new THREE.Quaternion(), currentQ = new THREE.Quaternion();
  const bounds = new THREE.Box3(), localBox = new THREE.Box3(), inverse = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  const diag = { rightError: 0, leftError: 0, length: 0, scale: 0, valid: false };
  const middleBones = new WeakMap<any, any>();
  function palmPoint(hand, out) {
    hand.getWorldPosition(out);
    if (!middleBones.has(hand)) middleBones.set(hand,
      hand.children.find(b => /Middle1$/.test(b.name)) || null);
    const middle = middleBones.get(hand);
    if (middle) { middle.getWorldPosition(offset); out.lerp(offset, .45); }
    return out;
  }
  function modelLength(gun) {
    if (gun.userData.handFitLength) return gun.userData.handFitLength;
    gun.updateMatrixWorld(true); inverse.copy(gun.matrixWorld).invert(); bounds.makeEmpty();
    gun.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      for (let parent = o; parent && parent !== gun; parent = parent.parent) {
        if (!parent.visible || parent === gun.userData.fpHands?.left || parent === gun.userData.fpHands?.right) return;
      }
      o.geometry.computeBoundingBox();
      matrix.multiplyMatrices(inverse, o.matrixWorld);
      localBox.copy(o.geometry.boundingBox).applyMatrix4(matrix); bounds.union(localBox);
    });
    return gun.userData.handFitLength = Math.max(.1, bounds.max.x - bounds.min.x);
  }
  return {
    diag,
    update({rig, root, bones, rightHand, leftHand, gunType, yaw, pitch, reload, dead, applyRotation,
      bank = 0, yawOffset = 0, pitchOffset = 0, support = true}) {
      diag.valid = false;
      const gun = rig?.gun, fit = WEAPON_HAND_FITS[gunType];
      if (!gun || !fit || !rightHand || !leftHand) return;
      if (dead) {
        if (!rig.deathHandFit) {
          root.updateMatrixWorld(true); rightHand.attach(gun);
          rig.deathHandFit = { p: gun.position.clone(), q: gun.quaternion.clone(), s: gun.scale.clone() };
        }
        if (gun.parent !== rightHand) rightHand.add(gun);
        gun.position.copy(rig.deathHandFit.p); gun.quaternion.copy(rig.deathHandFit.q); gun.scale.copy(rig.deathHandFit.s);
        return;
      }
      rig.deathHandFit = null;
      const scale = fit.length / modelLength(gun);
      if (gun.parent !== root) root.add(gun);
      root.updateMatrixWorld(true);
      // The torso already supplies 18% of aim pitch. Share the remaining
      // elevation across the shoulder and elbow instead of bending the wrist.
      if (bones?.rightUpperArm && bones?.rightForeArm && Math.abs(pitch) > .0001) {
        axis.set(Math.cos(yaw),0,-Math.sin(yaw));
        rotation.setFromAxisAngle(axis,pitch * .25 * (1-reload));
        applyRotation(bones.rightUpperArm,rotation); bones.rightUpperArm.updateMatrixWorld(true);
        rotation.setFromAxisAngle(axis,pitch * .15 * (1-reload));
        applyRotation(bones.rightForeArm,rotation); bones.rightForeArm.updateMatrixWorld(true);
        rotation.setFromAxisAngle(axis,pitch * .42 * (1-reload));
        applyRotation(rightHand,rotation); rightHand.updateMatrixWorld(true);
        rotation.setFromAxisAngle(axis,pitch * .82 * (1-reload));
        applyRotation(leftHand,rotation); leftHand.updateMatrixWorld(true);
      }
      worldQ.setFromAxisAngle(axis.set(0,1,0), yaw + yawOffset + Math.PI / 2);
      pitchQ.setFromAxisAngle(axis.set(Math.cos(yaw),0,-Math.sin(yaw)), pitch + pitchOffset);
      worldQ.premultiply(pitchQ);
      worldQ.multiply(pitchQ.setFromAxisAngle(axis.set(1,0,0), reload * .3 + bank));
      root.getWorldQuaternion(parentQ); gun.quaternion.copy(parentQ.invert()).multiply(worldQ);
      gun.scale.setScalar(scale);
      rightGrip.fromArray(fit.right); leftGrip.fromArray(fit.left);
      // The authored right hand owns the normal hold; the left cradles a reload.
      palmPoint(rightHand, palm); root.worldToLocal(palm);
      offset.copy(rightGrip).multiplyScalar(scale).applyQuaternion(gun.quaternion);
      gun.position.copy(palm).sub(offset);
      palmPoint(leftHand, palm); root.worldToLocal(palm);
      offset.copy(leftGrip).multiplyScalar(scale).applyQuaternion(gun.quaternion);
      leftPosition.copy(palm).sub(offset);
      gun.position.lerp(leftPosition, reload); gun.updateMatrixWorld(true);
      if (support && reload < 1 && bones?.leftUpperArm && bones?.leftForeArm) {
        target.copy(leftGrip).applyMatrix4(gun.matrixWorld);
        // Solve to the palm rather than confusing the wrist joint with the grip.
        palmPoint(leftHand,palm); leftHand.getWorldPosition(wrist); palmOffset.subVectors(palm,wrist);
        target.sub(palmOffset);
        // Preserve the authored wrist orientation and elbow's bend side. Solving
        // the shoulder and elbow in their updated world planes avoids twisted
        // joints when a compact pistol brings the hands close together.
        const upper = bones.leftUpperArm, fore = bones.leftForeArm;
        upper.getWorldPosition(a); fore.getWorldPosition(b); leftHand.getWorldPosition(c);
        leftHand.getWorldQuaternion(handQ);
        const upperLength = a.distanceTo(b), foreLength = b.distanceTo(c);
        direction.subVectors(target,a);
        // A support grip can slide along a long gun's handguard as the muzzle
        // elevates. Keep the palm on the mesh instead of stretching the arm or
        // leaving a gap when the nominal foregrip exceeds the rig's reach.
        const reach = upperLength + foreLength - .006;
        if (direction.lengthSq() > reach * reach && fit.left[0] - fit.right[0] > .15) {
          axis.set(1,0,0).applyQuaternion(worldQ);
          const alongBarrel = direction.dot(axis);
          const discriminant = alongBarrel * alongBarrel - (direction.lengthSq() - reach * reach);
          if (alongBarrel > 0 && discriminant >= 0) {
            const slide = Math.min((fit.left[0]-fit.right[0]) * scale * .45,
              Math.max(0,alongBarrel-Math.sqrt(discriminant)));
            leftGrip.x -= slide / scale;
            target.addScaledVector(axis,-slide);
            direction.subVectors(target,a);
          }
        }
        const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(upperLength-foreLength)+.001, upperLength+foreLength-.001);
        direction.normalize();
        const along = (upperLength*upperLength + distance*distance - foreLength*foreLength)/(2*distance);
        pole.subVectors(b,a).addScaledVector(direction,-pole.dot(direction));
        if (pole.lengthSq() < 1e-8) pole.set(0,-1,0).addScaledVector(direction,direction.y);
        pole.normalize();
        elbow.copy(a).addScaledVector(direction,along).addScaledVector(pole,Math.sqrt(Math.max(0,upperLength*upperLength-along*along)));
        from.subVectors(b,a).normalize(); to.subVectors(elbow,a).normalize();
        rotation.setFromUnitVectors(from,to); applyRotation(upper,rotation); upper.updateMatrixWorld(true);
        fore.getWorldPosition(b); leftHand.getWorldPosition(c);
        from.subVectors(c,b).normalize(); to.copy(a).addScaledVector(direction,distance).sub(b).normalize();
        rotation.setFromUnitVectors(from,to); applyRotation(fore,rotation); fore.updateMatrixWorld(true);
        leftHand.getWorldQuaternion(currentQ);
        rotation.copy(handQ).multiply(currentQ.invert()); applyRotation(leftHand,rotation); leftHand.updateMatrixWorld(true);
      }
      palmPoint(rightHand,actual); rightGrip.applyMatrix4(gun.matrixWorld);
      diag.rightError = actual.distanceTo(rightGrip);
      palmPoint(leftHand,actual); leftGrip.applyMatrix4(gun.matrixWorld);
      diag.leftError = actual.distanceTo(leftGrip);
      diag.length = fit.length; diag.scale = scale; diag.valid = true;
    },
  };
}
