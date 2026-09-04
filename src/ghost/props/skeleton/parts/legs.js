import * as THREE from 'three';
import M from '../metrics.js';
import { shaft, straightShaft, jointBall, plate } from './bone.js';

// The pelvis and both legs.
//
// The inventory, per PARTS.md: two hip bones as plates with a real see-through
// obturator foramen and a real gap at the pubic symphysis, femur with head,
// neck and greater trochanter, patella, tibia AND fibula as two separate
// bones, calcaneus and talus, five metatarsals, and toes with their full
// count of phalanges (two on the hallux, three on the rest). The sacrum is the
// axial agent's; the space between the two plates is left empty for it.
//
// Two things this half of the figure is solely responsible for, and both are
// checked numerically at the bottom of this comment rather than by eye:
//
//   1. The soles land on y = 0 when the group sits at M.y.hip. The assembler
//      does not correct for it, so a leg that comes out long buries the whole
//      character. Every part of the foot that touches the ground is placed by
//      its own contact height, not by its centre, for exactly this reason.
//   2. The pelvis fits M.pelvis EXACTLY. The rejected build had one 25% too
//      tall and too wide, so the outline below takes its extremes from
//      M.pelvis.width / M.pelvis.height rather than from hand-typed numbers.
//
// Two shapes here needed something the vocabulary does not have a word for,
// and both are a displacement applied to a vocabulary primitive rather than a
// new primitive:
//
//   - `sweep()` bends the extruded hip plate out of its plane, because a hip
//     bone is a bowl and ExtrudeGeometry only makes slabs. Rotating the slab
//     would have done some of it, but rotation foreshortens x, and x is where
//     M.pelvis.width lives.
//   - `ringCurve()` is just a circular arc handed to `shaft()`, used for the
//     rim of the acetabulum. It is a swept tube like every other bone here.

// --- local constants ---------------------------------------------------------
//
// metrics.js carries every LENGTH this part needs but no bone RADII, for legs
// or for anything else. The ones below are measured off .ref/ref-skeleton.jpg
// the same way M was, as a fraction of standing height, so they survive a
// change of scale. Reported back as a gap in metrics.js.
const frac = (v) => v * M.height;

const R = {
  // These are END radii, the convention bone.js uses: the visible middle of a
  // shaft is M.shaftWaist of them. The photo's bones are less waisted than
  // 0.62, so the ends here are sized to land the WAIST on the measurement and
  // the bulbs are then checked against the photo the other way round: a femur
  // picked to match at the middle gives a 0.13 knee where the photo has 0.114,
  // and 0.048 is where both ends of that argument meet.
  femur: frac(0.0192),          // 0.048 at the KNEE; taper takes it to 0.035 at the hip
  femurTaper: 0.74,
  // The head has to be wider than the plate is thick or it vanishes into the
  // socket and the hip stops reading as a joint at all, which is what happened
  // at 0.038 against a 0.070 plate.
  femurHead: frac(0.0176),      // 0.044
  femurNeck: frac(0.0092),      // 0.023. Thin enough that the angle shows.
  trochanter: frac(0.0160),     // 0.040. Also the cap over the shaft's top ring.
                                // Only a little wider than the tapered shaft it
                                // caps: in the photo it is a swelling on the
                                // femur, not a ball stuck on the end of one.
  patella: frac(0.0168),        // 0.042. Nearly as big as the condyle in the photo.
  tibia: frac(0.0180),          // 0.045 at the knee
  tibiaTaper: 0.72,             // 0.032 at the ankle
  fibula: frac(0.0084),         // 0.021. About 45% of the tibia, as in the photo.
  fibulaHead: frac(0.0112),     // 0.028
  malleolus: frac(0.0104),      // 0.026, the lateral one, on the fibula
  ankle: frac(0.0184),          // 0.046, the talus bulb
};

// The reference stands with its feet wider than its hips: the knees sit about
// 1.48x the hip half-separation out from the midline and the ankles 1.56x.
// Dropping the legs straight down from a 0.25 hip separation gives a wading
// bird, and it also puts the two contact patches so close together that the
// figure reads as unbalanced from the side.
const HIP_X = M.leg.hipSeparation / 2;   // 0.125, the acetabulum
const KNEE_X = HIP_X * 1.56;             // 0.195
const ANKLE_X = HIP_X * 1.64;            // 0.205

// Everything in this module is in the group's frame: origin at M.y.hip, so the
// femoral head is y = 0 and the floor is a long way down.
const KNEE_Y = M.y.knee - M.y.hip;       // -0.575
const ANKLE_Y = M.y.ankle - M.y.hip;     // -1.150
const SOLE_Y = M.y.sole - M.y.hip;       // -1.225

// A femur bows forward as well as out, which is what stops the side view being
// two parallel lines. The tibia gets less of it: in the photo the shin is very
// nearly straight and only the fibula bows away.
const KNEE_Z = frac(0.0040);             // 0.010, knee slightly ahead of the hip
const ANKLE_Z = -frac(0.0040);           // -0.010, and the ankle behind it again

// The foot has two budgets and they are different numbers, so quantities below
// are written as a fraction of whichever one governs them: horizontal extents
// and radii against FOOT, heights against RISE.
const FOOT = M.leg.foot;                 // 0.250, heel point to longest toe tip
const RISE = M.y.ankle;                  // 0.075, ankle pivot down to the sole

// Foot bulbs are flattened, and then placed by their FLATTENED half height.
// Placing them by their radius instead lifts the whole character 14% of a toe
// off the floor, which is small enough to survive a render and large enough to
// look like the figure is hovering.
const FOOT_SQUASH = 0.86;
const seat = (r, scaleY = 1) => -RISE + r * FOOT_SQUASH * scaleY;

// A shaft that is fatter at one end than the other.
//
// bone.js cannot do this. Its `endBias` reads as though it can -- the comment
// says "so a femur can be more swollen at the knee than at the hip the way a
// real one is" -- but the term it feeds is `Math.min(t, 1 - t)`, which is
// symmetric, so endBias moves both ends together and never one. Reported back
// as a bug in the vocabulary rather than worked around silently.
//
// It matters here more than anywhere else in the figure. A femur with the same
// radius at both ends has to choose between a knee the width of the photo's
// and a hip twice the width of the photo's, and picking either one wrong is
// visible from across the room. Same for the tibia into the ankle.
//
// This rescales the rings shaft() already built, about the same path points it
// built them around, so the waist and the sweep are untouched.
function taper(geo, path, segments, from, to) {
  const pos = geo.attributes.position;
  const perRing = pos.count / (segments + 1);
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const k = from + (to - from) * t;
    c.copy(path.getPointAt(t));
    for (let j = 0; j < perRing; j++) {
      const idx = i * perRing + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// straightShaft() builds its own curve and does not hand it back, so a tapered
// straight bone has to rebuild the same curve to taper against it. Same
// arithmetic as bone.js, kept in one place here so the two cannot drift.
function taperedBone(a, b, r, { bow = 0, bowAxis = null, from = 1, to = 1, segments = 28, ...rest }) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  if (bow !== 0) {
    const axis = bowAxis
      ? bowAxis.clone().normalize()
      : new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 0, 1)).normalize();
    mid.addScaledVector(axis, bow * a.distanceTo(b));
  }
  const path = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
  return taper(shaft(path, r, { segments, ...rest }), path, segments, from, to);
}

// --- the hip bone ------------------------------------------------------------

const PELVIS_TOP = M.y.pelvisTop - M.y.hip;              // +0.200
const PELVIS_BOTTOM = PELVIS_TOP - M.pelvis.height;      // -0.090
const PELVIS_HALF = M.pelvis.width / 2;                  // 0.210
// Half the gap at the pubic symphysis. In the photo the two pubic bones do not
// meet: there is a clear slot of daylight between them, and closing it is what
// turns a pelvis into a bucket.
const SYMPHYSIS_X = frac(0.0104);                        // 0.026

// The hip bone is built in two pieces, and the reason is the obturator foramen.
//
// It began as one plate with the foramen cut as a hole in the shape. That is
// the obvious way to do it and it does not work: the extruder's bevel grows the
// outer contour outward AND the hole's contour inward by bevelSize at each
// face, so a hole big enough to see through leaves struts that are 4mm wide in
// the middle and gone entirely at the surface. Shrinking the bevel to save the
// struts costs the rounded rim that makes the thing look like a toy.
//
// So the plate is the ILIUM plus the body around the acetabulum, with no holes
// in it at all and as generous a bevel as it likes, and the ischiopubic ring
// below it is four rods and two bulbs. That is also closer to the photo, where
// the bone round the foramen plainly reads as a loop of rounded rod rather than
// as a pierced sheet.
//
// The left plate's outline, walked once from the back of the iliac crest. x is
// lateral, y is up from the femoral head. Its extremes are the exact box
// fitPlate maps it onto, so they are named rather than typed twice.
const PLATE_MEDIAL = 0.056;
const PLATE_BOTTOM = -0.056;
const HIP_OUTLINE = [
  [PLATE_MEDIAL, 0.166],              // posterior end of the iliac crest
  [0.090, 0.196],
  [0.132, PELVIS_TOP],                // crest apex, out over the middle of the wing
  [0.176, 0.190],
  [0.202, 0.158],
  [PELVIS_HALF, 0.108],               // iliac tubercle: the widest point of the figure
  [0.206, 0.056],
  [0.192, 0.006],                     // lateral rim of the acetabulum
  [0.178, -0.036],
  [0.150, PLATE_BOTTOM],              // body of the ischium
  [0.120, -0.036],
  [0.104, -0.014],                    // the upper-lateral edge of the foramen
  [0.078, -0.006],                    // where the superior pubic ramus leaves
  [0.086, 0.048],                     // The medial border runs back up in one gentle S.
  [0.096, 0.092],                     // Traced faithfully it goes in, out and in again,
  [0.082, 0.130],                     // and once splined that hooks over the hip joint
  [0.062, 0.152],                     // like the brim of a hat.
];

// The ischiopubic ring, as centreline points. Rods run D -> A -> B -> C, with
// bulbs at the pubic body (A) and the ischial tuberosity (B); D and C are both
// buried inside the plate, so the loop has no open ends anywhere. The rods are
// thin on purpose: measured off the photo the bone under the foramen is only
// 21mm through, and anything fatter closes the hole, which is the whole point
// of building it this way.
//
// FORAMEN is not drawn. It is the empty middle of that loop, and it is written
// down so the clearances can be reasoned about rather than discovered.
const FORAMEN = { x: 0.082, y: -0.050, r: 0.024 };
const RING = {
  A: [0.042, -0.044],                 // pubic body, at the symphysis
  B: [0.092, -0.078],                 // ischial tuberosity, the lowest bone in the pelvis
  C: [0.132, -0.024],                 // rooted in the plate under the acetabulum
  D: [0.106, 0.014],                  // rooted in the plate at the arcuate line
  rod: 0.011,
  pubis: 0.016,                       // bulb at A. Its medial face is SYMPHYSIS_X.
  ischium: 0.013,                     // bulb at B. Its underside is PELVIS_BOTTOM.
  squash: 0.92,
};

const HIP_THICKNESS = frac(0.0280);   // 0.070. A 0.058 plate over this much area
                                      // reads as sheet metal rather than bone.
const HIP_BEVEL = 0.34;               // no holes to protect, so round it properly
// bone.js defaults to 4 bevel segments, which on a plate this thick with a
// bevel this generous puts four flat bands round the rim. The hip bone is seen
// edge-on from the side and from behind in every pose, so it pays for more.
const HIP_BEVEL_SEGMENTS = 12;

// THREE.Shape draws straight lines between the points it is handed, so the
// outline above extrudes as a faceted crystal: the first render of this part
// looked like a shard of flint rather than a hip bone. Resampling the traced
// points through a closed centripetal spline first is what buys the vinyl
// silhouette back, and it costs nothing anyone will ever notice.
function smoothOutline(points, samples = 132) {
  const spline = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, p.y, 0)),
    true,
    'centripetal',
  );
  const out = [];
  for (let i = 0; i < samples; i++) {
    const p = spline.getPoint(i / samples);
    out.push(new THREE.Vector2(p.x, p.y));
  }
  return out;
}

// Turning the flat slab into a hip bone, in two steps that are both AFFINE.
//
// This started life as a per-vertex displacement field: push the pubis forward,
// drag the blade back, and the bowl appears. It does, and it also ruins the
// shading. ExtrudeGeometry caps the slab with one flat polygon triangulated
// into long thin slivers, which is invisible while the cap is planar and very
// visible the moment it is bent, so the iliac blade came out crossed with hard
// diagonal creases. A rotation and a linear fit both keep the cap planar, so
// the same bowl costs nothing in shading.
//
// PLATE_PITCH leans the crest back over the socket, PLATE_YAW swings the blade
// back and the pubis forward. Held down to where the wing still faces mostly
// forward: at half again these angles the plate is so nearly edge-on that the
// front view loses the blade altogether and the pelvis reads as a curled leaf.
const PLATE_PITCH = -0.34;
const PLATE_YAW = 0.40;

// The second step. ExtrudeGeometry's bevel grows the outline OUTWARD by
// bevelSize, and a little further at a sharp corner, so the slab is measured
// and mapped back onto exactly the box its outline was authored in. An untrue
// pelvis is what got the previous build rejected, and 0.070 * 0.34 of bevel is
// 15% of the plate's width all by itself.
//
// The map is returned as well as applied, because the ischiopubic ring is
// authored in the same flat coordinates and has to land on the same bone.
function poseAndFit(geo, s) {
  const euler = new THREE.Euler(PLATE_PITCH, s * PLATE_YAW, 0, 'YXZ');
  geo.applyQuaternion(new THREE.Quaternion().setFromEuler(euler));
  const acetabulum = new THREE.Vector3(s * HIP_X, 0, 0).applyEuler(euler);
  geo.translate(0, 0, -acetabulum.z);

  const pos = geo.attributes.position;
  let lo = Infinity;
  let hi = -Infinity;
  let ylo = Infinity;
  let yhi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = s * pos.getX(i);
    const y = pos.getY(i);
    if (x < lo) lo = x;
    if (x > hi) hi = x;
    if (y < ylo) ylo = y;
    if (y > yhi) yhi = y;
  }
  const map = {
    euler,
    dz: -acetabulum.z,
    ax: (PELVIS_HALF - PLATE_MEDIAL) / (hi - lo),
    bx: PLATE_MEDIAL - ((PELVIS_HALF - PLATE_MEDIAL) / (hi - lo)) * lo,
    ay: (PELVIS_TOP - PLATE_BOTTOM) / (yhi - ylo),
    by: PLATE_BOTTOM - ((PELVIS_TOP - PLATE_BOTTOM) / (yhi - ylo)) * ylo,
  };
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, s * (map.ax * s * pos.getX(i) + map.bx));
    pos.setY(i, map.ay * pos.getY(i) + map.by);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return map;
}

// The same journey for a single point, so the ring meets the plate it is
// authored against instead of hanging off it like a keyring.
function onPlate(map, s, x, y) {
  const p = new THREE.Vector3(s * x, y, 0).applyEuler(map.euler);
  return new THREE.Vector3(
    s * (map.ax * s * p.x + map.bx),
    map.ay * p.y + map.by,
    p.z + map.dz,
  );
}

// --- the foot ----------------------------------------------------------------
//
// One ray per metatarsal, hallux first. x is signed lateral in the foot's own
// frame (negative is medial, towards the other foot), z is forward, and all of
// them are fractions of FOOT. `dirX` is the direction the toe leaves its
// metatarsal head in, which is what fans the forefoot out; `phalanx` is the
// real bone count, two on the hallux and three everywhere else.
//
// The previous build's foot was a tube plus a sphere and it read as a blob from
// every angle but the front. The fix is that the forefoot is five separate
// bones with daylight between them, and that the heel, the arch and the ball
// are one continuous sweep behind them rather than a ball stuck on a stick.
const RAYS = [
  { headX: -0.128, headZ: 0.360, shaftR: 0.056, headR: 0.078, toeR: 0.066, dirX: -0.30, phalanx: [0.096, 0.076] },
  { headX: -0.056, headZ: 0.410, shaftR: 0.043, headR: 0.061, toeR: 0.052, dirX: -0.12, phalanx: [0.070, 0.046, 0.040] },
  { headX: 0.016, headZ: 0.402, shaftR: 0.041, headR: 0.059, toeR: 0.050, dirX: 0.04, phalanx: [0.064, 0.044, 0.038] },
  { headX: 0.084, headZ: 0.368, shaftR: 0.039, headR: 0.056, toeR: 0.048, dirX: 0.18, phalanx: [0.054, 0.038, 0.034] },
  { headX: 0.152, headZ: 0.306, shaftR: 0.039, headR: 0.058, toeR: 0.046, dirX: 0.32, phalanx: [0.044, 0.030, 0.030] },
];

// The heel, the sweep and the tarsal block, all as fractions of FOOT.
//
// The sole is close to flat rather than deeply arched, and that is deliberate:
// the arch here is the line of the INSTEP, which is the curve you actually see,
// and it comes from the talus and the tarsal block sitting on top of the sweep.
// Modelling a lifted sole instead puts the whole midfoot in the air, and then
// the only thing touching the ground at the back is a ball, which is exactly
// what made the rejected build's feet read as blobs from behind.
// Stretched front to back rather than made bigger. A round heel the size the
// silhouette wants is a beach ball from directly behind, which is the one view
// the rejected build was never checked from.
const HEEL = { z: -0.176, r: 0.150, scale: [1.0, 1.0, 1.30] };
// Squashed hard in z rather than made small. A round tarsal block the width of
// the forefoot swallows every metatarsal whole, and then the foot is a dome
// with toes stuck on it, which is the blob the rejected build was rejected for.
// Flattened front to back it is an instep instead, and the five rays get 40% of
// their length back out in the open where they can be seen.
const TARSAL = { z: 0.084, r: 0.168, scale: [1.05, 1.0, 0.72] };
// As fat as the tarsal block's underside allows. The waist is nearly off for
// this one bone: bone.js's 0.62 pinches the midfoot into an hourglass from the
// side, and a foot is not two lumps with a stick between them.
const SWEEP_R = 0.124;

// A standing foot toes out a little. It is a rotation on a node BELOW the ankle
// joint, not on the joint itself, so `ankleL.rotation` is still identity in the
// rest pose and still world-aligned the way PARTS.md requires.
const TOE_OUT = 0.11;

export function buildLower({ material }) {
  const geometries = [];
  const group = new THREE.Group();

  const put = (parent, geo, x = 0, y = 0, z = 0) => {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // jointBall takes the radius of the shaft it caps and grows it by
  // M.jointBallScale. Most bulbs down here were measured off the photo as
  // finished radii instead, so this asks for the finished size and lets the
  // vocabulary do the growing.
  const bulb = (radius, opts = {}) => jointBall(radius / M.jointBallScale, opts);

  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  const joints = {};

  for (const [tag, s] of [['L', 1], ['R', -1]]) {
    // --- hip bone -----------------------------------------------------------
    const outline = smoothOutline(HIP_OUTLINE.map(([x, y]) => new THREE.Vector2(s * x, y)));
    const slab = plate(outline, HIP_THICKNESS, { bevel: HIP_BEVEL, bevelSegments: HIP_BEVEL_SEGMENTS });
    const map = poseAndFit(slab, s);
    put(group, slab);

    // The ischiopubic ring. Each rod is bowed AWAY from the middle of the
    // foramen so the loop stays a loop: run them straight and the pubic ramus
    // cuts a chord across the hole and there is nothing left to see through.
    const ring = (name) => onPlate(map, s, RING[name][0], RING[name][1]);
    const centre = onPlate(map, s, FORAMEN.x, FORAMEN.y);
    const outward = (a, b) => new THREE.Vector3()
      .addVectors(a, b).multiplyScalar(0.5).sub(centre).setZ(0).normalize();
    const rA = ring('A');
    const rB = ring('B');
    const rC = ring('C');
    const rD = ring('D');

    // Two of the ring's four corners carry a number that has to be exact, and
    // they are pinned here rather than trusted to survive the pose and the fit.
    // The pubic body sets the width of the gap at the symphysis, and the
    // ischial tuberosity is the lowest bone in the pelvis, so it alone decides
    // whether the pelvis is M.pelvis.height tall. Everything else about both
    // points -- their depth, their lean -- still comes from the plate.
    rA.x = s * (SYMPHYSIS_X + RING.pubis);
    rB.y = PELVIS_BOTTOM + RING.ischium * RING.squash;
    for (const [a, b, bow] of [[rD, rA, 0.08], [rA, rB, 0.26], [rB, rC, 0.20]]) {
      put(group, straightShaft(a, b, RING.rod, {
        bow, bowAxis: outward(a, b), waist: 0.88, segments: 14,
      }));
    }
    put(group, bulb(RING.pubis, { squash: RING.squash }), rA.x, rA.y, rA.z);
    put(group, bulb(RING.ischium, { squash: RING.squash }), rB.x, rB.y, rB.z);


    // --- hip joint ----------------------------------------------------------
    const hip = new THREE.Object3D();
    hip.position.set(s * HIP_X, 0, 0);
    group.add(hip);
    joints[`hip${tag}`] = hip;

    // Femoral head, dead on the pivot. It cannot leave its socket no matter
    // what the animator does to hip.rotation, which is the whole reason the
    // pivot is here and not at the top of the shaft.
    put(hip, bulb(R.femurHead, { squash: 0.94 }));

    // Neck and greater trochanter. The neck leaving the head at 45 degrees and
    // the shaft starting out at the trochanter, not under the head, is what
    // stops the hip reading as a stick pushed into a hole.
    // Far enough out that the head and the trochanter read as two lumps with a
    // neck between them. At the distance they were first placed they merged
    // into one peanut and the joint lost its hinge. The acetabulum is at 0.125
    // and the trochanter reaches 0.235, so it stands proud of the 0.210 edge of
    // the pelvis, which is what the photo shows and what makes the hip read as
    // a socket seen from outside rather than a ball on a spike.
    // Level with the head, not below it, which is where a real greater
    // trochanter sits and where the photo puts it. Hung lower it drags the top
    // of the femur down and the hip stops looking like a hinge.
    const trochanter = V(s * frac(0.0320), -frac(0.0112), 0);
    put(hip, straightShaft(V(0, 0, 0), V(s * frac(0.0296), -frac(0.0104), 0), R.femurNeck, { segments: 12, waist: 0.86 }));
    const troch = put(hip, bulb(R.trochanter, { squash: 0.92 }), trochanter.x, trochanter.y, trochanter.z);
    troch.scale.set(1.14, 1.10, 0.94);

    // --- femur --------------------------------------------------------------
    const kneeLocal = V(s * (KNEE_X - HIP_X), KNEE_Y, KNEE_Z);
    put(hip, taperedBone(
      trochanter.clone().setZ(frac(0.0008)),
      kneeLocal,
      R.femur,
      {
        bow: M.leg.bow, bowAxis: V(s * 0.86, 0, 0.51), endBias: 0.62, segments: 30,
        from: R.femurTaper, to: 1,
      },
    ));

    // Patella. Its own bone, its own ball, riding on the FEMUR rather than on
    // the knee joint: hang it off the joint instead and a hard knee bend swings
    // it round to the back of the shin. On the femur it stays in the crease.
    put(hip, bulb(R.patella, { squash: 0.88 }),
      kneeLocal.x, kneeLocal.y + frac(0.0032), kneeLocal.z + frac(0.0192));

    // --- knee joint ---------------------------------------------------------
    const knee = new THREE.Object3D();
    knee.position.copy(kneeLocal);
    hip.add(knee);
    joints[`knee${tag}`] = knee;

    // The condyles. Centred exactly on the pivot, so bending the knee spins the
    // bulb about its own middle and the femur's open end stays capped.
    const condyle = put(knee, jointBall(R.femur, { squash: 0.90 }));
    condyle.scale.set(1.10, 1.0, 0.94);

    // --- tibia and fibula ---------------------------------------------------
    const ankleLocal = V(s * (ANKLE_X - KNEE_X), ANKLE_Y - KNEE_Y, ANKLE_Z - KNEE_Z);
    put(knee, taperedBone(
      V(-s * frac(0.0016), -frac(0.0008), frac(0.0004)),
      ankleLocal,
      R.tibia,
      {
        bow: M.leg.bow * 0.5, bowAxis: V(s, 0, 0), endBias: 0.58, segments: 26,
        from: 1, to: R.tibiaTaper,
      },
    ));
    // Tibial tuberosity: the bump the kneecap's tendon pulls on. Small, but it
    // is the only thing that tells the front of the shin from the back at a
    // glance from three-quarters.
    put(knee, bulb(frac(0.0092), { squash: 0.78 }), -s * frac(0.0012), -frac(0.0260), frac(0.0148));

    // The fibula runs outside the tibia with daylight between them for most of
    // its length, which is the detail that makes the shin read as two bones.
    // It touches at the top (a real joint) and swells into the lateral
    // malleolus at the bottom, so the gap opens in the middle and nowhere else.
    const fibTop = V(s * frac(0.0200), -frac(0.0312), -frac(0.0048));
    const fibBottom = V(s * frac(0.0160), ankleLocal.y + frac(0.0100), ankleLocal.z + frac(0.0024));
    put(knee, straightShaft(fibTop, fibBottom, R.fibula, {
      bow: M.leg.bow, bowAxis: V(s, 0, 0), endBias: 0.55, segments: 24,
    }));
    put(knee, bulb(R.fibulaHead, { squash: 0.90 }), fibTop.x, fibTop.y, fibTop.z);
    put(knee, bulb(R.malleolus, { squash: 0.92 }), fibBottom.x, fibBottom.y, fibBottom.z);

    // --- ankle joint --------------------------------------------------------
    const ankle = new THREE.Object3D();
    ankle.position.copy(ankleLocal);
    knee.add(ankle);
    joints[`ankle${tag}`] = ankle;

    // Talus: the ankle's own bulb, on the pivot.
    put(ankle, bulb(R.ankle, { squash: 0.88 }));

    const foot = new THREE.Object3D();
    foot.rotation.y = s * TOE_OUT;
    ankle.add(foot);

    // Calcaneus, the midfoot sweep and the tarsal block. One line of bone from
    // the back of the heel to the ball of the foot, at a constant height so the
    // sole is flat, with the shaft's own waist lifting the middle of it just
    // enough to be an arch. Everything is placed by its squashed half height,
    // so the heel bulb touches y = 0 exactly and the tube clears it by a
    // millimetre.
    const heelR = HEEL.r * FOOT;
    const heelZ = HEEL.z * FOOT;
    const heelY = seat(heelR);
    const heel = put(foot, bulb(heelR, { squash: FOOT_SQUASH }), 0, heelY, heelZ);
    heel.scale.set(...HEEL.scale);

    const tarsalZ = TARSAL.z * FOOT;
    const tarsalR = TARSAL.r * FOOT;
    const soleY = seat(tarsalR);
    // Widened in x only. The tube's radius is capped by how deep the tarsal
    // block can be without its underside going through the floor, and at that
    // radius the midfoot is narrower than the heel, so from behind the heel
    // reads as a ball on a stick. Stretching sideways costs nothing: it is the
    // one direction with no constraint on it.
    const midfoot = put(foot, shaft(
      new THREE.CatmullRomCurve3([
        V(0, heelY, heelZ),
        V(0, (heelY + soleY) * 0.5, (heelZ + tarsalZ) * 0.5),
        V(0, soleY, tarsalZ),
      ]),
      SWEEP_R * FOOT,
      { waist: 0.94, segments: 16 },
    ));
        // Just under the heel's width. Wider than the heel and the tube's rim
    // stands proud of it as a hard fin, which is the one thing bone.js warns
    // about; narrower and the heel is a ball on a stick from directly behind.
    midfoot.scale.set(1.15, 1.0, 1.0);

    // The remaining tarsals (navicular, cuboid, three cuneiforms) are one
    // rounded block. PARTS.md names the calcaneus and the talus for this part
    // and stops there, the same allowance the hand gets for its carpals, and at
    // this size five separate pebbles would be five specks.
    const tarsal = put(foot, bulb(tarsalR, { squash: FOOT_SQUASH }), 0, soleY, tarsalZ);
    tarsal.scale.set(...TARSAL.scale);

    // --- metatarsals and toes ----------------------------------------------
    // Every ray leaves the tarsal block, so their open ends are all capped by
    // it and the forefoot fans from one point the way a real one does.
    for (const ray of RAYS) {
      // The bases converge on the tarsal block at 30% of the head's spread, so
      // the rays radiate rather than run parallel, and every base ring is
      // buried inside the block that caps it.
      const base = V(s * ray.headX * 0.30 * FOOT, soleY, tarsalZ);
      const headR = ray.headR * FOOT;
      const head = V(s * ray.headX * FOOT, seat(headR), ray.headZ * FOOT);
      put(foot, straightShaft(base, head, ray.shaftR * FOOT, { segments: 8, waist: 0.80 }));
      put(foot, bulb(headR, { squash: FOOT_SQUASH }), head.x, head.y, head.z);

      const toeR = ray.toeR * FOOT;
      const toeY = seat(toeR);
      const dir = V(s * ray.dirX, 0, 1).normalize();
      let p = V(head.x, toeY, head.z);
      for (let k = 0; k < ray.phalanx.length; k++) {
        const q = p.clone().addScaledVector(dir, ray.phalanx[k] * FOOT);
        put(foot, straightShaft(p, q, toeR * 0.78, { segments: 5, waist: 0.84 }));
        const last = k === ray.phalanx.length - 1;
        put(foot, bulb(toeR * (last ? 0.92 : 1.0), { squash: FOOT_SQUASH }), q.x, q.y, q.z);
        p = q;
      }
    }
  }

  return {
    group,
    joints,
    dispose() {
      for (const geo of geometries) geo.dispose();
      geometries.length = 0;
    },
  };
}

// Landmarks the other three parts and the coordinator may need, published
// rather than described, so nobody has to re-derive them from the outline:
//
//   SACRUM_SLOT  the empty box between the two hip plates. The axial agent's
//                sacrum has to fill it: anything narrower leaves two daylight
//                slots at the sacroiliac joints.
export const SACRUM_SLOT = {
  halfWidth: 0.064,                      // the plates' medial border, either side
  bottom: -0.010,                        // relative to M.y.hip
  top: PELVIS_TOP,
  z: -0.029,                             // centre of the sacroiliac contact
  depth: 0.070,
};

export const SOLE_LOCAL_Y = SOLE_Y;      // -1.225: where y = 0 is, in group space
