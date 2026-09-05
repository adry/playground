import * as THREE from 'three';
import M, { LEFT_X } from '../metrics.js';
import { limb, bulb, softBox, ball, put, v } from './skin.js';
import { tatteredCuff } from './clothes.js';

// One arm. `side` is 'L' or 'R' and LEFT IS +X, always: see the note at the top
// of metrics.js and the assertion in model.js. This is the bug that does not
// show up until something walks.
//
// The rest-pose flare is BAKED INTO THE GEOMETRY, never into a tilt node above
// the joint, so `shoulder`, `elbow` and `wrist` are all identity at rest and an
// animator can write absolute Euler targets without first reading the bind
// pose. Same rule as the skeleton.
//
// The right forearm is the stripped one: skin torn away at the elbow, two bare
// bones and a strap of muscle, a ragged cuff of skin at each end. It is on the
// right so it does not compete with the exposed chest, which sits on the
// centre line: two open wounds side by side and neither one reads.

export function buildArm({ materials, side }) {
  const sign = side === 'L' ? LEFT_X : -LEFT_X;
  const stripped = side === M.arm.strippedSide;

  const shoulder = new THREE.Object3D();     // origin AT the glenoid
  shoulder.userData.outwardX = sign;
  const shed = new Map();

  const dir = v(sign * Math.sin(M.arm.flare), -Math.cos(M.arm.flare), 0);
  const elbowAt = dir.clone().multiplyScalar(M.arm.upper);
  const wristAt = dir.clone().multiplyScalar(M.arm.fore);

  // --- deltoid. It belongs to the arm rather than the chest so that a raised
  // arm carries its own shoulder mass with it; left on the torso, a big reach
  // tears a visible notch open at the armpit.
  put(shoulder, ball(M.arm.upperRadius * 1.30, M.arm.upperRadius * 1.34, M.arm.upperRadius * 1.24, 16),
    materials.skin, { pos: v(sign * M.arm.upperRadius * 0.16, -M.arm.upperRadius * 0.10, 0) });

  // --- upper arm
  put(shoulder, limb(v(0, 0, 0), elbowAt, M.arm.upperRadius, M.arm.elbowRadius, {
    radial: 14, segments: 8, bow: 0.03, bowAxis: v(-sign, 0, 0),
  }), materials.skin);

  // --- the jacket sleeve, in TWO pieces.
  //
  // One on the shoulder covering the whole upper arm, one on the elbow
  // covering the top of the forearm and ending in a torn edge. Two pieces
  // because a single sleeve long enough to reach the forearm has to hang off
  // the shoulder, and then it stays put while the elbow bends through it.
  //
  // The left sleeve keeps its forearm half. The RIGHT one does not: that is
  // the arm whose flesh has been stripped, and the sleeve going with it is
  // why. A torn sleeve that stops exactly where the skin stops reads as one
  // event; two unrelated tears read as wear.
  {
    const cuff = tatteredCuff({
      material: materials.jacket,
      top: 0.055 * M.height,
      bottom: 0.055 * M.height - M.arm.upper * (stripped ? 0.92 : 1.02),
      rTop: M.arm.upperRadius * 1.55,
      rBottom: M.arm.upperRadius * 1.30,
      tatter: M.jacket.tatter * (stripped ? 1.5 : 0.9),
      teeth: 6,
      seed: side === 'L' ? 11 : 29,
      thickness: M.jacket.thickness,
      uSteps: 20, vSteps: 5,
    });
    const g = new THREE.Group();
    put(g, cuff.geometry, cuff.material);
    // Stand it along the arm's own axis.
    g.quaternion.setFromUnitVectors(v(0, -1, 0), dir.clone().normalize());
    g.position.copy(dir.clone().multiplyScalar(0.055 * M.height));
    shoulder.add(g);
  }

  // --- elbow
  const elbow = new THREE.Object3D();
  elbow.position.copy(elbowAt);
  shoulder.add(elbow);
  put(elbow, bulb(M.arm.elbowRadius), materials.skin);

  // --- forearm
  if (!stripped) {
    put(elbow, limb(v(0, 0, 0), wristAt, M.arm.elbowRadius, M.arm.wristRadius, {
      radial: 14, segments: 8,
    }), materials.skin);
  } else {
    // THE STRIPPED FOREARM.
    //
    // Two bones and a muscle strap, with the skin ending in a torn cuff at
    // each end. What makes it read at eight pixels of forearm is not the
    // anatomy, it is that the middle of the limb is a DIFFERENT COLOUR from
    // the ends: pale bone and dark red between two green cuffs. The detail is
    // for the close renders; the colour banding is for the game.
    const across = v(sign * Math.cos(M.arm.flare), Math.sin(M.arm.flare), 0);   // in-plane, perpendicular
    const ulnaA = across.clone().multiplyScalar(-M.arm.boneRadius * 0.55);
    const ulnaB = wristAt.clone().addScaledVector(across, -M.arm.boneRadius * 0.30);
    const radA = across.clone().multiplyScalar(M.arm.boneRadius * 0.62).add(v(0, 0, M.arm.boneRadius * 0.25));
    const radB = wristAt.clone().addScaledVector(across, M.arm.boneRadius * 0.35);
    put(elbow, limb(ulnaA, ulnaB, M.arm.boneRadius, M.arm.boneRadius * 0.80, { radial: 10, segments: 6, waist: 0.80 }),
      materials.bone);
    put(elbow, limb(radA, radB, M.arm.boneRadius * 0.78, M.arm.boneRadius * 0.66, { radial: 10, segments: 6, waist: 0.80 }),
      materials.bone);
    // the muscle, laid behind the bones
    put(elbow, limb(
      across.clone().multiplyScalar(-M.arm.boneRadius * 0.2).add(v(0, 0, -M.arm.boneRadius * 0.9)),
      wristAt.clone().add(v(0, 0, -M.arm.boneRadius * 0.7)),
      M.arm.boneRadius * 1.05, M.arm.boneRadius * 0.55, { radial: 10, segments: 6, waist: 0.86 },
    ), materials.muscle);

    // the torn skin cuffs
    for (const [atT, len, rr, seed] of [[0.0, 0.34, M.arm.elbowRadius, 41], [0.72, 0.30, M.arm.wristRadius, 47]]) {
      const cuff = tatteredCuff({
        material: materials.skin,
        top: 0, bottom: -M.arm.fore * len,
        rTop: rr * 1.02, rBottom: rr * 0.92,
        tatter: M.arm.fore * 0.10, teeth: 6, seed,
        thickness: M.torso.shellThickness * 0.5,
        uSteps: 16, vSteps: 4,
      });
      const g = new THREE.Group();
      put(g, cuff.geometry, cuff.material);
      g.quaternion.setFromUnitVectors(v(0, -1, 0), dir.clone().normalize());
      g.position.copy(wristAt.clone().multiplyScalar(atT));
      if (atT > 0) g.rotateX(Math.PI);           // the wrist cuff opens upward
      elbow.add(g);
    }
  }

  // the forearm half of the sleeve, on the elbow so it bends with it
  if (!stripped) {
    const cuff = tatteredCuff({
      material: materials.jacket,
      top: M.arm.elbowRadius * 0.9,
      bottom: M.arm.elbowRadius * 0.9 - M.arm.fore * 0.52,
      rTop: M.arm.elbowRadius * 1.42,
      rBottom: M.arm.elbowRadius * 1.22,
      tatter: M.jacket.tatter * 1.4,
      teeth: 5,
      seed: 53,
      thickness: M.jacket.thickness,
      uSteps: 18, vSteps: 5,
    });
    const g = new THREE.Group();
    put(g, cuff.geometry, cuff.material);
    g.quaternion.setFromUnitVectors(v(0, -1, 0), dir.clone().normalize());
    g.position.copy(dir.clone().multiplyScalar(M.arm.elbowRadius * 0.9));
    elbow.add(g);
  }

  // --- wrist
  const wrist = new THREE.Object3D();
  wrist.position.copy(wristAt);
  elbow.add(wrist);
  put(wrist, bulb(M.arm.wristRadius), materials.skin);

  // --- hand. Long dark claw nails, and they earn their place: a nail is read
  // by the SILHOUETTE it puts on the end of a finger, not by its own shading,
  // so it survives at game scale where a stitch would not.
  {
    const along = dir.clone();
    const across = v(sign * Math.cos(M.arm.flare), Math.sin(M.arm.flare), 0);
    const palmC = along.clone().multiplyScalar(M.hand.palmLength * 0.55);
    const palm = softBox(M.hand.palmWidth, M.hand.palmLength * 1.25, M.hand.palmDepth,
      { round: 0.55, uSteps: 14, vSteps: 10 });
    const pm = put(wrist, palm, materials.skin, { pos: palmC });
    pm.quaternion.setFromUnitVectors(v(0, 1, 0), along.clone().negate());

    const base = along.clone().multiplyScalar(M.hand.palmLength * 1.05);
    for (let i = 0; i < M.hand.fingers; i++) {
      const t = (i / (M.hand.fingers - 1) - 0.5);
      const root = base.clone().addScaledVector(across, t * M.hand.palmWidth * 0.72)
        .add(v(0, 0, (0.5 - Math.abs(t)) * M.hand.palmDepth * 0.30));
      const len = M.hand.fingerLength * (i === 0 || i === M.hand.fingers - 1 ? 0.84 : 1.0);
      const tip = root.clone().addScaledVector(along, len).addScaledVector(v(0, 0, 1), len * 0.30);
      const fg = new THREE.Group();
      wrist.add(fg);
      put(fg, limb(root, tip, M.hand.fingerRadius, M.hand.fingerRadius * 0.78, {
        radial: 8, segments: 5, bow: 0.16, bowAxis: v(0, 0, 1), waist: 0.94,
      }), materials.skin);
      const nailTip = tip.clone().addScaledVector(along, M.hand.nailLength * 0.75)
        .addScaledVector(v(0, 0, 1), M.hand.nailLength * 0.55);
      put(fg, limb(tip, nailTip, M.hand.nailRadius, M.hand.nailRadius * 0.22, {
        radial: 7, segments: 4, waist: 1,
      }), materials.nail);
      fg.name = `finger${side}${i + 1}`;
      // The two the skeleton's shed plan asks for, by the same names, so one
      // performance can drive either figure.
      if ((side === 'L' && i + 1 === 4) || (side === 'R' && i + 1 === 3)) {
        shed.set(`finger${side}${i + 1}`, fg);
      }
    }

    // thumb, off the inner edge and lower down
    {
      const root = along.clone().multiplyScalar(M.hand.palmLength * 0.45)
        .addScaledVector(across, -M.hand.palmWidth * 0.46);
      const tip = root.clone().addScaledVector(along, M.hand.thumbLength * 0.7)
        .addScaledVector(across, -M.hand.thumbLength * 0.55)
        .add(v(0, 0, M.hand.thumbLength * 0.35));
      put(wrist, limb(root, tip, M.hand.fingerRadius * 1.05, M.hand.fingerRadius * 0.8, {
        radial: 8, segments: 4, waist: 0.94,
      }), materials.skin);
      const nailTip = tip.clone().addScaledVector(along, M.hand.nailLength * 0.55)
        .addScaledVector(across, -M.hand.nailLength * 0.4);
      put(wrist, limb(tip, nailTip, M.hand.nailRadius, M.hand.nailRadius * 0.22, {
        radial: 7, segments: 3, waist: 1,
      }), materials.nail);
    }
  }

  const geometries = [];
  shoulder.traverse((o) => { if (o.isMesh) geometries.push(o.geometry); });

  return {
    group: shoulder,
    joints: { shoulder, elbow, wrist },
    shed,
    dispose() { for (const g of geometries) g.dispose(); },
  };
}
