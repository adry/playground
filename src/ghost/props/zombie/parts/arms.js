import * as THREE from 'three';
import M from '../metrics.js';
import { limb, ovoid, roundBox, arcTube, put, v3, mix, assertOutward } from './forms.js';

// The arms, and they are the reason the last figure read as a bollard.
//
// POSTMORTEM 2.5, fault two: "the arms disappear into the body. Shoulder to
// hip is one continuous mass with only fingers emerging near the hem, so the
// distinctive stripped forearm cannot be seen at all." At game scale that
// matters more than the face does, because an arm is a silhouette and a face
// is 34 px of shading.
//
// The fix is mostly in `M.torso`, which moved the trunk in. What this file
// contributes is the other half:
//
//  * A BOW. `REST` fixes the shoulder, the elbow and the wrist and the
//    animation half is built against those three points, so they do not move.
//    The shaft BETWEEN them is free, and it bows outward at mid-length. That
//    is the contract's "rest-pose flare is baked into geometry" taken
//    literally: no tilt node, no change to any joint, and about 9 mm more
//    daylight exactly where the upper arm passes the ribs.
//
//  * A DELTOID that is a separate bulb at the top. The arm has to be ATTACHED
//    at the shoulder even though it is clear below, and a limb that simply
//    starts at full radius reads as a peg pushed into a hole. The bulb does
//    the attaching, and it is the ONLY part of the arm that overlaps the
//    trunk.
//
//  * A WAISTED shaft. `M.limbWaist` is 0.86 -- soft flesh, barely pinched,
//    against the skeleton's bony 0.62 -- so the mid-shaft is slightly thinner
//    than the joints, which is what puts a visible line of background between
//    the arm and the body instead of a tangent.
//
// The right forearm is stripped to muscle and bone. It is on the right so it
// does not fight the exposed ribcage, which sits slightly to the figure's left
// of centre in the reference.

const A = M.arm;
const HAND = M.hand;

export function buildArm({ materials, side = 'L' }) {
  const s = side === 'L' ? +1 : -1;         // LEFT IS +X
  const group = new THREE.Group();
  const geos = [];
  const track = (g) => { geos.push(g); return g; };
  const shed = new Map();

  const shoulder = new THREE.Object3D();
  group.add(shoulder);
  const elbow = new THREE.Object3D();
  elbow.position.set(s * A.upper * Math.sin(A.flare), -A.upper * Math.cos(A.flare), 0);
  shoulder.add(elbow);
  const wrist = new THREE.Object3D();
  wrist.position.set(s * A.fore * Math.sin(A.flare), -A.fore * Math.cos(A.flare), 0);
  elbow.add(wrist);

  // The outboard offsets. These move the DRAWN arm, never the joints: every
  // node above is already parked at its REST position and `model.js` checks
  // all three against metrics.js to 1 mm.
  // Each is the lateral offset of the DRAWN centre line from its own joint,
  // expressed in that joint's own frame. Every piece below is built in the
  // frame of the joint it hangs from, so the three read directly and the
  // pieces meet: the upper arm ends at `elbow.position + outE` in the
  // shoulder's frame, and the forearm starts at `outE` in the elbow's, which
  // is the same point.
  const OB = A.outboard;
  const outS = v3(s * OB[0], 0, 0);
  const outE = v3(s * OB[1], 0, 0);
  const outW = v3(s * OB[2], 0, 0);
  const foreA = outE.clone();                          // in the elbow's frame
  const foreB = wrist.position.clone().add(outW);      // in the elbow's frame

  // --- deltoid ---------------------------------------------------------------
  const delt = track(ovoid(A.upperRadius * 1.02, A.upperRadius * 1.12, A.upperRadius * 0.98, { uSteps: 14, vSteps: 10 }));
  assertOutward(delt, v3(0, 0, 0), 'deltoid');
  put(shoulder, delt, materials.skin, { pos: v3(s * A.upperRadius * 0.18, -A.upperRadius * 0.22, 0).add(outS), name: 'deltoid' });

  // --- upper arm --------------------------------------------------------------
  // The bow is outward and slightly forward: outward for daylight, forward
  // because a shambler's arms hang a little ahead of the body and it stops the
  // arm being a flat plane against the torso from the side.
  const upperBow = v3(s * A.upperRadius * 0.80, 0, A.upperRadius * 0.14);
  const upper = track(limb(
    outS.clone(), elbow.position.clone().add(outE),
    A.upperRadius, A.elbowRadius,
    { radial: 12, segments: 8, waist: M.limbWaist, bow: upperBow, capA: false }));
  put(shoulder, upper, materials.skin, { name: 'upper-arm' });

  const elbowBall = track(ovoid(A.elbowRadius * M.jointBallScale, A.elbowRadius * M.jointBallScale * 0.94, A.elbowRadius * M.jointBallScale, { uSteps: 12, vSteps: 9 }));

  const stripped = side === A.strippedSide;
  if (!stripped) {
    put(elbow, elbowBall, materials.skin, { pos: outE.clone(), name: 'elbow' });
    const foreBow = v3(s * A.elbowRadius * 0.50, 0, A.elbowRadius * 0.16);
    const fore = track(limb(
      foreA.clone(), foreB.clone(),
      A.elbowRadius * 0.94, A.wristRadius,
      { radial: 12, segments: 8, waist: M.limbWaist, bow: foreBow, capA: false }));
    put(elbow, fore, materials.skin, { name: 'forearm' });
  } else {
    // --- the stripped forearm -------------------------------------------------
    //
    // Flesh gone: one bone shaft, a strap of dark red muscle beside it, and
    // the skin ending in a torn cuff just below the elbow. Three separate
    // volumes rather than one shell with a section removed, for the same
    // reason as everything else here -- a cuff cut out of a tube's own
    // parameterisation staircases, and a cuff built as its own short ring
    // does not.
    put(elbow, elbowBall, materials.skin, { pos: outE.clone(), name: 'elbow' });
    const foreEnd = foreB.clone();
    const cuffTo = foreA.clone().lerp(foreEnd, 0.22);
    const cuff = track(limb(
      foreA.clone(), cuffTo,
      A.elbowRadius * 0.98, A.elbowRadius * 0.80,
      { radial: 12, segments: 4, waist: 1.0, capA: false, capB: false }));
    put(elbow, cuff, materials.skin, { name: 'fore-cuff' });
    // A torn ring at the end of the skin, so the cut edge has thickness.
    const ring = track(ovoid(A.elbowRadius * 0.86, A.elbowRadius * 0.20, A.elbowRadius * 0.86, { uSteps: 14, vSteps: 6 }));
    const rm = put(elbow, ring, materials.muscle, { pos: cuffTo, name: 'fore-tear' });
    rm.lookAt(foreEnd);
    rm.rotateX(Math.PI / 2);
    // The bone: a straight pale shaft running the length of the forearm.
    const bone = track(limb(
      foreA.clone().lerp(foreEnd, 0.10), foreEnd.clone(),
      A.boneRadius, A.boneRadius * 0.86,
      { radial: 9, segments: 6, waist: 0.90 }));
    put(elbow, bone, materials.bone, { name: 'ulna' });
    // The muscle strap, beside it and a little forward.
    const off = v3(-s * A.boneRadius * 1.25, 0, A.boneRadius * 0.55);
    const musc = track(limb(
      foreA.clone().lerp(foreEnd, 0.08).add(off), foreA.clone().lerp(foreEnd, 0.94).add(off),
      A.boneRadius * 1.05, A.boneRadius * 0.72,
      { radial: 9, segments: 6, waist: 0.78 }));
    put(elbow, musc, materials.muscle, { name: 'flexor' });
  }

  // --- the hand ---------------------------------------------------------------
  //
  // Short, and clawed. A nail is read by the SILHOUETTE it puts on the end of
  // a finger, not by its own shading, so it survives at game scale where a
  // stitch would not.
  const hand = new THREE.Object3D();
  wrist.add(hand);
  // The hand hangs at a WIDER angle than the arm, and that is a silhouette
  // decision as much as a character one. Splaying it from the wrist moves the
  // fingertips 13 mm further outboard without translating anything, so unlike
  // an offset it introduces no kink at the wrist and no error in the wrist's
  // centre of rotation. It also happens to be how a zombie's hand hangs.
  const down = v3(s * Math.sin(A.handSplay), -Math.cos(A.handSplay), 0);
  // The hand continues the outboard line. There is no joint below the wrist,
  // so this one costs nothing at all in pivot accuracy.
  const handOut = v3(s * A.outboard[2], 0, 0);   // exactly where the forearm ends
  hand.position.copy(handOut);

  const palm = track(roundBox(HAND.palmWidth / 2, HAND.palmLength / 2, HAND.palmDepth / 2, { n: 3.0, uSteps: 14, vSteps: 10 }));
  const pm = put(hand, palm, materials.skin, { pos: down.clone().multiplyScalar(HAND.palmLength * 0.52), name: 'palm' });
  pm.lookAt(pm.position.clone().add(down));
  pm.rotateX(Math.PI / 2);

  const fingerRoot = down.clone().multiplyScalar(HAND.palmLength * 1.02);
  for (let k = 0; k < HAND.fingers; k++) {
    const node = new THREE.Object3D();
    hand.add(node);
    const across = (k - (HAND.fingers - 1) / 2) / Math.max(1, HAND.fingers - 1);
    const lat = v3(s * Math.cos(A.flare), Math.sin(A.flare), 0).multiplyScalar(across * HAND.palmWidth * 0.78);
    const curl = v3(0, 0, 1).multiplyScalar(HAND.fingerLength * 0.30);
    const a = fingerRoot.clone().add(lat);
    const len = HAND.fingerLength * mix(0.82, 1.0, 1 - Math.abs(across) * 1.2);
    const b = a.clone().addScaledVector(down, len).add(curl);
    const f = track(limb(a, b, HAND.fingerRadius, HAND.fingerRadius * 0.82, { radial: 7, segments: 4, waist: 0.94 }));
    put(node, f, materials.skin, { name: 'finger' });
    const tip = b.clone();
    const nailDir = b.clone().sub(a).normalize();
    const nail = track(limb(tip, tip.clone().addScaledVector(nailDir, HAND.nailLength).add(v3(0, 0, HAND.nailLength * 0.5)),
      HAND.nailRadius, HAND.nailRadius * 0.18, { radial: 6, segments: 3 }));
    put(node, nail, materials.nail, { name: 'claw' });
    // Shed by the skeleton's names, so one shed plan drives either figure.
    if (side === 'L' && k === 3) shed.set('fingerL4', node);
    if (side === 'R' && k === 2) shed.set('fingerR3', node);
  }
  // The thumb, out to the side and a little forward.
  {
    const a = down.clone().multiplyScalar(HAND.palmLength * 0.42)
      .addScaledVector(v3(s * Math.cos(A.flare), Math.sin(A.flare), 0), HAND.palmWidth * 0.44);
    const b = a.clone().addScaledVector(down, HAND.thumbLength * 0.75).add(v3(0, 0, HAND.thumbLength * 0.62));
    const th = track(limb(a, b, HAND.fingerRadius * 1.08, HAND.fingerRadius * 0.86, { radial: 7, segments: 4 }));
    put(hand, th, materials.skin, { name: 'thumb' });
    const nd = b.clone().sub(a).normalize();
    const nail = track(limb(b, b.clone().addScaledVector(nd, HAND.nailLength * 0.9), HAND.nailRadius, HAND.nailRadius * 0.2, { radial: 6, segments: 3 }));
    put(hand, nail, materials.nail, { name: 'claw' });
  }

  return {
    group,
    joints: { shoulder, elbow, wrist },
    shed,
    dispose() { for (const g of geos) g.dispose(); },
  };
}
