import * as THREE from 'three';
import M, { LEFT_X } from './metrics.js';
import { boneMaterial } from './parts/bone.js';
import { buildSkull } from './parts/skull.js';
import { buildAxial } from './parts/axial.js';
import { buildArm } from './parts/arms.js';
import { buildLower } from './parts/legs.js';
import { mergeWithinNodes } from '../merge.js';

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

  // ONE DRAW CALL PER BONE, NOT PER PIECE.
  //
  // The figure is authored out of small primitives -- a rod, two condyles, a
  // tuberosity, a cap -- because that is the only sane way to shape a bone. It
  // is a terrible way to DRAW one: the rig arrived as 544 meshes across 72
  // nodes, and the game keeps five of them, which was 2,720 of the page's 2,774
  // draw calls and the same again in the shadow pass.
  //
  // Everything parented to one node moves with that node, so those pieces can
  // be merged with no change to how the figure animates and no change to a
  // pixel. mergeWithinNodes never merges across a node, so a joint still bends
  // and a shed rib or finger is still its own object to detach.
  //
  // Measured on this rig: 544 meshes to 75, triangles identical at 531,364,
  // and the five rigs in the game 2,720 draw calls to 375.
  //
  // It runs AFTER the shadow flags above and after the left-versus-right
  // assertion, so both still see the graph they were written against, and
  // before the scale, which is on the group and applies either way.
  const flattened = mergeWithinNodes(group);

  group.scale.setScalar(scale);

  return {
    group,
    joints,
    shed,
    // What the merge did, so a probe can assert the win rather than trust it.
    meshCount: flattened,
    update() {},
    dispose() {
      for (const p of parts) p.dispose?.();
      for (const c of contacts) c.userData.dispose?.();
      // The buffers the merge created. The originals belong to `parts` above
      // and are freed by them, which is why the merge does not free them: two
      // of this rig's geometries are shared between meshes.
      for (const g of flattened.geometries) g.dispose();
      material.dispose();
    },
  };
}
