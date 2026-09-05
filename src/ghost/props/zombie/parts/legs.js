import * as THREE from 'three';
import M, { LEFT_X } from '../metrics.js';
import { limb, bulb, softBox, ball, put, v } from './skin.js';
import { tatteredCuff } from './clothes.js';

// Both legs and both boots. Origin at M.y.hip, parents to `root`.
//
// LEFT IS +X. Every 'L' node here is at positive x and model.js asserts it.
//
// The shorts CUFFS are built here rather than in clothes.js, and hang off the
// hip joints, because a cuff parented to the hips stays put while the thigh
// swings through it, which is the most obvious rigging failure a walk cycle
// can have. The waistband part of the shorts does belong to the hips and is in
// clothes.js.
//
// The boots are big on purpose: M.boot.length is 0.150 of standing height,
// which is a realistic foot proportion and therefore looks oversized on a
// three-head figure. That is what lets a short-legged character stand without
// looking like it is about to fall over, and it is the same trick the reference
// toy uses.

function buildBoot({ materials, sign }) {
  const g = new THREE.Group();
  const G = -M.y.ankle;                 // the ground, in ankle-local space
  const bw = M.boot.width, bl = M.boot.length, bh = M.boot.height;

  // sole, a dark slab a little wider than the boot
  put(g, softBox(bw * 1.06, M.boot.heel * 1.9, bl * 0.99, { round: 0.32, uSteps: 16, vSteps: 10 }),
    materials.nail, { pos: v(0, G + M.boot.heel * 0.55, bl * 0.10) });

  // the boot itself. Scuffed reads as SHAPE here, not as texture: the toe is
  // a separate swollen lump rather than a smooth continuation, so the profile
  // has a break in it where a worn boot creases.
  put(g, softBox(bw, bh * 0.92, bl * 0.80, { round: 0.46, uSteps: 18, vSteps: 12 }),
    materials.boot, { pos: v(0, G + bh * 0.46, bl * 0.02) });
  put(g, softBox(bw * 0.90, bh * 0.60, bl * 0.42, { round: 0.52, uSteps: 14, vSteps: 10 }),
    materials.boot, { pos: v(0, G + bh * 0.30, bl * 0.30) });

  // the ankle shaft
  put(g, limb(v(0, G + bh * 0.55, -bl * 0.04), v(0, G + bh * 1.12, -bl * 0.02),
    M.leg.ankleRadius * 1.34, M.leg.ankleRadius * 1.10, { radial: 12, segments: 4, waist: 0.94 }),
    materials.boot);

  // The left boot has toes coming through the front. Three bulbs rather than
  // a hole cut in the toe cap: at eight pixels of boot, three green dots at
  // the end of a dark shape read as toes, and a real hole reads as a chip out
  // of the mesh.
  if (M.boot.toesOutSide === (sign > 0 ? 'L' : 'R')) {
    for (let i = 0; i < 3; i++) {
      const t = (i - 1) / 2;
      put(g, ball(bw * 0.15, bh * 0.15, bh * 0.16, 10), materials.skin, {
        pos: v(t * bw * 0.42, G + bh * 0.19 + (1 - Math.abs(t)) * bh * 0.03, bl * 0.46 - Math.abs(t) * bl * 0.05),
      });
    }
    // the torn lip of the boot behind them
    put(g, softBox(bw * 0.74, bh * 0.12, bl * 0.10, { round: 0.4, uSteps: 12, vSteps: 8 }),
      materials.nail, { pos: v(0, G + bh * 0.30, bl * 0.40) });
  }

  // Toes splay outward from the walking line. This is most of what stops a
  // pair of feet reading as two bricks on the ends of two pipes.
  g.rotation.y = sign * M.boot.toeOut;
  return g;
}

export function buildLower({ materials }) {
  const group = new THREE.Group();          // origin at M.y.hip
  group.userData.outwardX = LEFT_X;
  const joints = {};

  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? LEFT_X : -LEFT_X;

    const hip = new THREE.Object3D();
    hip.position.set(sign * M.leg.hipSeparation / 2, 0, 0);
    group.add(hip);
    joints[`hip${side}`] = hip;

    // where the buttock meets the thigh
    put(hip, ball(M.leg.thighRadius * 1.12, M.leg.thighRadius * 1.05, M.leg.thighRadius * 1.10, 14),
      materials.skin, { pos: v(0, M.leg.thighRadius * 0.15, 0) });

    const kneeAt = v(0, M.y.knee - M.y.hip, 0);
    put(hip, limb(v(0, 0, 0), kneeAt, M.leg.thighRadius, M.leg.kneeRadius, {
      radial: 14, segments: 8, bow: M.leg.bow, bowAxis: v(sign, 0, 0),
    }), materials.skin);

    // --- the shorts cuff, on the hip so it swings with the thigh
    {
      const holes = side === 'L' ? [[0.25, 0.42, 0.075, 0.20]] : [];
      const cuff = tatteredCuff({
        material: materials.shorts,
        top: -0.026 * M.height,
        bottom: M.shorts.hem - M.y.hip,
        rTop: M.leg.thighRadius * 1.62,
        rBottom: M.leg.thighRadius * 1.46,
        tatter: M.shorts.tatter,
        teeth: 6,
        seed: side === 'L' ? 61 : 83,
        thickness: M.shorts.thickness,
        holes,
        uSteps: 22, vSteps: 6,
      });
      put(hip, cuff.geometry, cuff.material);
      // Behind the left hole, bone. It is the whole reason that hole is where
      // it is: a hole in a rag with more rag behind it is not a wound.
      if (side === 'L') {
        const y = M.shorts.hem - M.y.hip + (M.shorts.top - M.shorts.hem) * 0.42;
        put(hip, softBox(M.leg.thighRadius * 0.62, M.leg.thighRadius * 0.52, M.leg.thighRadius * 0.30,
          { round: 0.5, uSteps: 10, vSteps: 8 }), materials.bone,
        { pos: v(0, y, M.leg.thighRadius * 0.86) });
      }
    }

    const knee = new THREE.Object3D();
    knee.position.copy(kneeAt);
    hip.add(knee);
    joints[`knee${side}`] = knee;
    put(knee, bulb(M.leg.kneeRadius, { squash: 0.94 }), materials.skin);

    const ankleAt = v(0, M.y.ankle - M.y.knee, 0);
    put(knee, limb(v(0, 0, 0), ankleAt, M.leg.shinRadius, M.leg.ankleRadius, {
      radial: 12, segments: 7, bow: M.leg.bow * 0.5, bowAxis: v(sign, 0, 0),
    }), materials.skin);

    const ankle = new THREE.Object3D();
    ankle.position.copy(ankleAt);
    knee.add(ankle);
    joints[`ankle${side}`] = ankle;
    ankle.add(buildBoot({ materials, sign }));
  }

  const geometries = [];
  group.traverse((o) => { if (o.isMesh) geometries.push(o.geometry); });

  return {
    group,
    joints,
    dispose() { for (const g of geometries) g.dispose(); },
  };
}
