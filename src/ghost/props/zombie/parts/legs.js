import * as THREE from 'three';
import M from '../metrics.js';
import { limb, ovoid, roundBox, closedRadial, roundBoxR, put, v3, smoothstep } from './forms.js';

// The legs and the boots.
//
// The landmark drops are the constraint and the bones follow from them: hip to
// knee is a pure 0.297 of vertical drop, knee to ankle 0.230, and each shaft
// is a little longer than its drop because it also bows outward. `REST` puts
// the hip, the knee and the ankle on ONE vertical line at x = +/-0.099, so the
// bow lives entirely in the geometry between them -- the same rule the arms
// follow, and for the same reason: a tilt node above a joint would make every
// absolute Euler target in the animation half wrong.
//
// The boots are big on purpose. 0.150 of standing height is a realistic foot
// proportion, which on a three-head figure reads as oversized, and that is
// exactly right for a toy: big feet are what let a short-legged character
// stand without looking like it is about to topple.

const L = M.leg;
const BOOT = M.boot;

export function buildLower({ materials }) {
  const group = new THREE.Group();          // at `root`, y = M.y.hip
  const geos = [];
  const track = (g) => { geos.push(g); return g; };
  const joints = {};

  for (const side of ['L', 'R']) {
    const s = side === 'L' ? +1 : -1;
    const hip = new THREE.Object3D();
    hip.position.set(s * L.hipSeparation / 2, 0, 0);
    group.add(hip);
    const knee = new THREE.Object3D();
    knee.position.y = M.y.knee - M.y.hip;
    hip.add(knee);
    const ankle = new THREE.Object3D();
    ankle.position.y = M.y.ankle - M.y.knee;
    knee.add(ankle);
    joints[`hip${side}`] = hip;
    joints[`knee${side}`] = knee;
    joints[`ankle${side}`] = ankle;

    // The hip ball, which is what joins the thigh to the pelvis mass.
    const hipBall = track(ovoid(L.thighRadius * 0.98, L.thighRadius * 1.02, L.thighRadius * 1.04, { uSteps: 10, vSteps: 7 }));
    put(hip, hipBall, materials.skin, { name: 'hip' });

    const thigh = track(limb(
      v3(0, 0, 0), v3(0, knee.position.y, 0),
      L.thighRadius, L.kneeRadius,
      { radial: 10, segments: 5, waist: M.limbWaist,
        bow: v3(s * L.thighRadius * L.bow * 3.2, 0, 0), capA: false }));
    put(hip, thigh, materials.skin, { name: 'thigh' });

    const kneeBall = track(ovoid(L.kneeRadius * M.jointBallScale, L.kneeRadius * M.jointBallScale * 0.92, L.kneeRadius * M.jointBallScale * 1.04, { uSteps: 10, vSteps: 7 }));
    put(knee, kneeBall, materials.skin, { name: 'knee' });

    const shin = track(limb(
      v3(0, 0, 0), v3(0, ankle.position.y, 0),
      L.shinRadius, L.ankleRadius,
      { radial: 10, segments: 5, waist: 0.94,
        bow: v3(-s * L.shinRadius * L.bow * 1.4, 0, L.shinRadius * 0.18), capA: false }));
    put(knee, shin, materials.skin, { name: 'shin' });

    // --- the boot ---------------------------------------------------------------
    //
    // One closed volume with a heel and a toe, plus a separate sole slab. It
    // splays off the walking line by `toeOut`, which is what stops the two
    // feet reading as one block from the front.
    const boot = new THREE.Object3D();
    boot.rotation.y = s * BOOT.toeOut;
    ankle.add(boot);

    const bh = BOOT.height / 2;
    const bootR = (d) => roundBoxR(BOOT.width / 2, bh, BOOT.length / 2, 3.4)(d)
      // the toe box swells and the heel tucks in
      * (1 + 0.16 * smoothstep(0.30, 0.95, d.z) * smoothstep(0.35, -0.55, d.y))
      * (1 - 0.20 * smoothstep(0.20, 0.90, -d.z) * smoothstep(-0.10, 0.85, d.y));
    const shell = track(closedRadial({ uSteps: 18, vSteps: 12, R: bootR }));
    // The ankle sits above the middle of the boot and behind its centre.
    //
    // SOLES AT y = 0 IS A CONTRACT TERM, not a nicety, so the boot is seated
    // by MEASURING it rather than by arithmetic on its half-height. `bootR`
    // carries a toe swell and a heel tuck on top of the superellipsoid, so its
    // true lowest point is not `-bh` and the boot sank 15.6 mm into the floor
    // when it was placed as though it were. The bounding box is the honest
    // answer and it costs one pass over the vertices.
    shell.computeBoundingBox();
    const low = shell.boundingBox.min.y;
    const bootCentre = v3(0, -M.y.ankle + BOOT.heel * 0.62 - low, BOOT.length * 0.16);
    shell.translate(bootCentre.x, bootCentre.y, bootCentre.z);
    put(boot, shell, materials.boot, { name: 'boot' });

    // The sole: a flatter slab under it, so there is a line where the boot
    // meets the ground rather than a smooth curve fading into the floor. This
    // is the piece that actually touches y = 0.
    const soleH = BOOT.heel / 2;
    const sole = track(roundBox(BOOT.width / 2 * 1.04, soleH, BOOT.length / 2 * 1.02, { n: 4.2, uSteps: 14, vSteps: 8 }));
    put(boot, sole, materials.bootSole, {
      pos: v3(bootCentre.x, -M.y.ankle + soleH, bootCentre.z), name: 'sole',
    });

    // No cuff roll and no toes poking through. Both were three-pixel details
    // on a boot that is read as a dark block, and a dark block is what a boot
    // should be at this size: it is the figure's contact with the ground and
    // its heaviest mass.
  }


  return { group, joints, dispose() { for (const g of geos) g.dispose(); } };
}
