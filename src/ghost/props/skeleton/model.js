import * as THREE from 'three';
import M, { LEFT_X } from './metrics.js';
import { boneMaterial } from './parts/bone.js';
import { buildSkull } from './parts/skull.js';
import { buildAxial } from './parts/axial.js';
import { buildArm } from './parts/arms.js';
import { buildLower } from './parts/legs.js';

// The assembler. It owns no geometry of its own: the four part modules build
// the bones, and this file parents them together and publishes the flat joint
// map that CONTRACT.md promises the animator.
//
// Keeping it empty of modelling is the point. Four agents can work on four
// regions at once only while the seam between them stays this thin.

export function createSkeletonRig({ scale = 1 } = {}) {
  const material = boneMaterial();
  const parts = [];
  const track = (p) => { parts.push(p); return p; };

  const group = new THREE.Group();

  // root is the hips. Everything hangs off it, so lifting the character out of
  // the ground is one translation on one node.
  const root = new THREE.Object3D();
  root.position.y = M.y.hip;
  group.add(root);

  const lower = track(buildLower({ material }));
  root.add(lower.group);

  const axial = track(buildAxial({ material }));
  root.add(axial.group);

  // head is the animator's node above the skull, so a nod does not have to
  // fight whatever the skull agent chose as its own origin.
  const head = new THREE.Object3D();
  axial.anchors.atlas.add(head);

  const skull = track(buildSkull({ material }));
  head.add(skull.group);

  group.updateMatrixWorld(true);

  const armL = track(buildArm({ material, side: 'L' }));
  const armR = track(buildArm({ material, side: 'R' }));
  axial.anchors.shoulderL.add(armL.group);
  axial.anchors.shoulderR.add(armR.group);

  const joints = {
    root,
    spineLower: axial.joints.spineLower,
    spineUpper: axial.joints.spineUpper,
    neck: axial.joints.neck,
    head,
    jaw: skull.joints.jaw,
    shoulderL: armL.joints.shoulder,
    shoulderR: armR.joints.shoulder,
    elbowL: armL.joints.elbow,
    elbowR: armR.joints.elbow,
    wristL: armL.joints.wrist,
    wristR: armR.joints.wrist,
    hipL: lower.joints.hipL,
    hipR: lower.joints.hipR,
    kneeL: lower.joints.kneeL,
    kneeR: lower.joints.kneeR,
    ankleL: lower.joints.ankleL,
    ankleR: lower.joints.ankleR,
  };

  // The jaw's sign is published rather than documented, so an animator can
  // assert it instead of trusting a paragraph. See CONTRACT.md.
  joints.jaw.userData.openAxis = 'x';
  joints.jaw.userData.openSign = 1;

  // Left is +X, and the parts are checked rather than trusted. Two regions
  // disagreeing about which side is left is invisible in the rest pose and
  // comes out as a cross-limbed walk, so it is worth a hard failure here.
  for (const [name, node] of [
    ['shoulderL', axial.anchors.shoulderL], ['shoulderR', axial.anchors.shoulderR],
    ['hipL', lower.joints.hipL], ['hipR', lower.joints.hipR],
  ]) {
    const want = name.endsWith('L') ? LEFT_X : -LEFT_X;
    const got = Math.sign(node.getWorldPosition(new THREE.Vector3()).x);
    if (got !== 0 && got !== want) {
      throw new Error(`skeleton: ${name} is at x sign ${got}, expected ${want}. See LEFT_X in metrics.js.`);
    }
  }

  const shed = new Map([...axial.shed, ...armL.shed, ...armR.shed]);

  group.updateMatrixWorld(true);

  // NO fake contact patches under the feet. There used to be two, a soft dark
  // disc under each ankle, and the user's word for them was that they looked
  // unnatural, which they were: a flat decal is identical from every direction,
  // so it darkens the ground on the LIT side of the foot exactly as much as on
  // the shadowed side, and it slides out from under a foot that lifts. Every
  // mesh in this figure already casts a real shadow from the key light, and
  // that shadow knows which way the sun is. This is the third prop in the scene
  // to lose its contact decal for the same reason, after the tombstones and the
  // pumpkins.
  //
  // The empty array is left published because perform.js reads it and treats
  // "no patches" as nothing to do.
  const contacts = [];
  group.userData.contactShadow = contacts;

  group.traverse((o) => {
    if (o.isMesh && o.material === material) { o.castShadow = true; o.receiveShadow = true; }
  });

  group.scale.setScalar(scale);

  return {
    group,
    joints,
    shed,
    update() {},
    dispose() {
      for (const p of parts) p.dispose?.();
      for (const c of contacts) c.userData.dispose?.();
      material.dispose();
    },
  };
}
