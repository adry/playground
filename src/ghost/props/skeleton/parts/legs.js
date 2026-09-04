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
// Two things this half of the figure is solely responsible for, and neither is
// left to the eye:
//
//   1. The soles land on y = 0 when the group sits at M.y.hip. The assembler
//      does not correct for it, so a leg that comes out long buries the whole
//      character. Every part of the foot that touches the ground is placed by
//      its own contact height, not by its centre, for exactly this reason.
//   2. The pelvis fits M.pelvis EXACTLY. The rejected build had one 25% too
//      tall and too wide, so poseAndFit() measures the finished slab and maps
//      it onto the box instead of trusting arithmetic done in a comment.
//
// Three helpers here are local rather than from bone.js, and none of them is a
// new primitive: smoothOutline() conditions the outline before the extruder,
// poseAndFit() moves and measures the slab after it, and onPlate() sends a
// single point on the same journey so the crest rim and the sacroiliac pad land
// on the bone the outline became. Each says at its own definition what went
// wrong without it. A taper used to live here too and is gone: bone.js's
// shaft() takes endRadius now and does it properly.

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
  // Sized against the socket, not against the shaft. What makes the hip read as
  // a joint is the crease where the ball enters the cup, so the head has to be
  // big enough to stand a couple of centimetres proud of the acetabular block
  // and leave a crease circle worth seeing.
  femurHead: frac(0.0192),      // 0.048
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
// The one number this part is judged on. Nothing below reads it -- the foot
// works from RISE, which is the same distance measured the other way -- but it
// is written down here because it is what the whole module has to hit, and a
// value with no name is a value nobody checks.
const SOLE_Y = M.y.sole - M.y.hip;       // -1.225
void SOLE_Y;

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

// --- the hip bone ------------------------------------------------------------
//
// Three parts, not one, and the reason is that a hip bone is three things:
// a thin flaring blade, a thick socket, and a thick ring round a hole. Built as
// one plate it can only be one of them, and the first version was: two tall
// narrow paddles hanging down with a coat hanger dangling off each. Held next
// to the photo they were not the same object.
//
//   BLADE     an extruded plate. Broad at the crest and tapering hard down to
//             the socket, so it reads as a wing flaring up and out rather than
//             as a slab bolted on.
//   SOCKET    a rounded block at the blade's lower outer corner with the
//             femoral head half sunk into it. This is the single strongest read
//             in the pelvis and the first version had none of it at all.
//   RING      the ischiopubic mass. Still rods, because the extruder pinches
//             the struts out of a pierced plate, but three times thicker than
//             the first attempt, rooted INSIDE the socket rather than hung off
//             the plate, and sweeping forward to meet its mirror image at the
//             symphysis. That forward sweep is the bowl: without it you look
//             straight through the front of the pelvis.

const PELVIS_TOP = M.y.pelvisTop - M.y.hip;              // +0.200
const PELVIS_BOTTOM = PELVIS_TOP - M.pelvis.height;      // -0.090
const PELVIS_HALF = M.pelvis.width / 2;                  // 0.210
// How far each pubic body reaches ACROSS the midline. Not a gap: in the photo
// the two of them make one continuous bar along the bottom of the pelvis with
// nothing but a narrowing where they meet, and the first version's finger-wide
// slot left each side dangling on its own. Two rounded blocks set exactly
// touching still show daylight above and below the one height where they are
// widest, so they are given a little overlap and the crease does the joint.
const SYMPHYSIS_OVERLAP = frac(0.0016);                  // 0.004 each side

// The blade's outline, walked once from the back of the iliac crest, in a flat
// authoring frame that poseAndFit maps onto its own box. x is lateral, y is up
// from the femoral head.
//
// Traced off the photo at the scale that reproduces M.pelvis.width, and the two
// things that matter about it are the TAPER and where it STOPS.
//
// The taper: 0.154 across at the crest, 0.028 across where it reaches the
// socket. Getting that wrong is most of what made the first version read as a
// paddle bolted on -- it was near enough the same width all the way down, so
// nothing flared and nothing pointed at the hip joint.
//
// Where it stops: at y = 0, level with the femoral head. In the photo the blade
// ends there and everything below is socket and ischiopubic mass. Running it
// lower, as the first version did, puts bone directly behind the obturator
// foramen and there is no daylight through the hole any more.
const PLATE_MEDIAL = 0.056;
const PLATE_BOTTOM = 0.000;
// Points are dense along the crest and sparse elsewhere on purpose. A
// centripetal spline through evenly spaced points rounds every corner equally,
// and the first pass came out as a smooth egg with no crest on it at all; the
// crest is the line the eye follows across the top of the pelvis and it has to
// stay a long shallow arc with a corner at each end.
// The medial border runs almost straight up from y = 0.096 to 0.170 at
// x = 0.056, and that is not a stylistic choice: it is the sacroiliac face and
// it has to present a flat edge to M.sacrum's 0.1052 of width over the span
// from M.sacrum.bottom to M.sacrum.top. An earlier version curved away from the
// midline just above the hip and the joint could not close at all.
const HIP_OUTLINE = [
  [PLATE_MEDIAL, 0.170],              // posterior superior iliac spine, on the sacrum
  [0.078, 0.192],
  [0.112, PELVIS_TOP],                // crest apex
  [0.148, 0.198],
  [0.180, 0.184],
  [0.202, 0.164],
  [PELVIS_HALF, 0.134],               // anterior superior iliac spine: the widest
  [0.204, 0.094],                     // point in the lower body, and high up
  [0.190, 0.058],                     // the outer border diving in towards the socket
  [0.172, 0.024],
  [0.150, PLATE_BOTTOM],              // lower tip, just lateral of the acetabulum
  [0.120, 0.026],
  [0.098, 0.048],                     // arcuate line
  [0.076, 0.070],
  [0.060, 0.096],
  [PLATE_MEDIAL, 0.132],              // up the sacroiliac face
];

// The blade is THIN and its rim is THICK, which is the actual anatomy: the
// iliac crest is a thickened lip on a sheet of bone, and in the photo it is the
// line your eye follows across the top of the pelvis. Three rounds were spent
// trying to get both out of one extruded plate and it cannot be done -- thick
// enough for the crest is a fat lozenge, thin enough for the blade is a pillow
// of pure bevel with no crest on it at all. So the plate is 0.028 and RIM below
// is a tube swept round its whole edge.
const HIP_THICKNESS = frac(0.0112);
// Zero, and all the rounding comes from RIM instead. Three's extruder shrinks a
// hole's contour by bevelSize at each face, so any bevel a bone wants for its
// rim seals a small foramen shut; and on a plate this thin the bevel eats the
// entire thickness and leaves a pillow with no face on it. The axial build
// reached the same conclusion independently on the sacrum, so it is confirmed
// twice: on a thin toy bone, bevel 0 and a rim rod.
const HIP_BEVEL = 0;

// The acetabular mass. A rounded block at the blade's lower outer corner with
// the femoral head half sunk in it, set medial of the pivot so the head still
// clears it sideways and reads as a ball in a cup.
//
// A swept rim ring round the pivot was tried twice and thrown away twice. The
// socket faces sideways, so a ring in its plane is edge-on from the front and
// from behind and reads as a handle glued on; and in a region this crowded --
// blade, block, ring, ramus loop, head, neck and trochanter all inside 0.15 --
// one more rounded thing is what tips it from anatomy into tangle. The block
// alone gives the cup, because the crease where the head enters it IS the rim.
const ACET = {
  x: 0.112, y: -0.006, z: 0.000,
  bossR: frac(0.0224),                // 0.056 before scaling
  scale: [0.62, 0.92, 1.10],          // thin sideways, tall and deep: a cup, not a ball
};

// The ischiopubic mass, as centreline points in the group frame. Authored with
// an explicit z rather than inherited from the blade's pose, because the whole
// point of it is to leave the blade's plane and sweep forward: Pu and Pd are
// 0.09 in front of the socket and that distance IS the bowl.
//
// S and Q are both buried inside the acetabular lens, so the mass grows out of
// the socket instead of hanging under the blade on two visible stalks.
//
// The rods are 0.021 to 0.027 in radius against the first attempt's 0.011. What
// that costs is the size of the foramen: with the acetabulum at M's 0.125 there
// is only 0.115 of width and 0.090 of height between it, the midline and the
// floor, and thick bone all round a 0.055 hole does not fit in that. The photo
// gets away with a bigger hole because its hip joints are 0.31 apart rather
// than M.leg.hipSeparation's 0.25. Thick bone won the trade.
// Two swept tubes rather than four straight rods, and two rather than one.
//
// Four rods meeting at four corners is four crossings, and at the size this
// region actually renders -- about 38 pixels across in a full-figure shot --
// four crossings is a tangle with no hole in it. Sweeping the lot as one tube
// fixes that but then the whole loop has to be one thickness, and the photo is
// emphatically not one thickness: the superior ramus and the ischium are stout
// bars and the inferior ramus between the symphysis and the tuberosity is half
// their width. So: one sweep down the front, one round the bottom, meeting
// inside the pubic body where the join cannot be seen.
//
// Both sweeps run low. Measured off the photo the symphysis and the foramen
// both sit in the bottom third, between y = -0.03 and the floor, with the
// superior ramus descending to them from the socket. An earlier pass had them
// 0.03 too high, which put the pubic bodies out in front of the hip joints
// like a pair of handles.
const RING = {
  A:  [0.104, 0.016, 0.004],          // superior ramus, rooted in the socket
  Bu: [0.034, -0.026, 0.072],         // top of the pubic body
  Bd: [0.038, -0.066, 0.068],         // bottom of the pubic body
  T:  [0.084, -0.0644, 0.030],        // ischial tuberosity: the lowest bone here
  Q:  [0.110, -0.022, -0.002],        // ischium, rooted back in the socket
  // Measured off the photo, and the first pass had these the wrong way round.
  // The superior ramus is the SLENDER one: it arches over the foramen and every
  // millimetre of it comes straight off the hole. The mass below and behind --
  // pubic body, inferior ramus, ischium -- is the thick part.
  superior: [frac(0.0068), frac(0.0080)],   // 0.017 at the socket, 0.020 at the pubis
  // Every millimetre the superior ramus is raised or bowed is a millimetre of
  // foramen. Run flat and thick it closes the hole entirely, which is where
  // this started; at 0.14 of bow off a root 0.016 above the socket's middle the
  // opening is 0.032 by 0.035, near enough round.
  superiorBow: 0.14,
  lower: [frac(0.0072), frac(0.0096)],      // 0.018 at the pubis, 0.024 at the ischium
  lowerWaistAt: 0.30,
  // Narrow enough that it does not eat the foramen next to it, and reaching
  // just across the midline so the two of them are one bar.
  body: frac(0.0116),                 // 0.029 before scaling
  bodyScale: [0.90, 1.30, 1.00],
  tuber: frac(0.0104),                // 0.026, the ischial tuberosity
  tuberScale: [1.0, 1.12, 1.0],
  // jointBall squashes by this before tuberScale gets a look in, and the
  // tuberosity is placed by its finished half height, not its radius. Leaving
  // it out puts the pelvis 1.2% short of M.pelvis.height, which is exactly the
  // kind of quiet drift the fitting is here to stop.
  tuberSquash: 0.88,
};

// The sacroiliac joint. A rounded articular pad standing proud of the blade's
// medial border, placed in group coordinates rather than on the flat outline
// because what it has to meet is not on the blade: it is M.sacrum, and the
// numbers below are read straight off it.
//
//   M.sacrum is 0.1052 wide, so its side faces are at x = +/-0.0526.
//   It runs from M.sacrum.bottom to M.sacrum.top, y = 0.094 to 0.226 here.
//   The axial part's group sits at z = -0.139 to -0.035.
//
// The pad reaches x = 0.048, which is 0.005 past the sacrum's face, so the two
// overlap rather than almost touching. The blade's own medial border stops at
// 0.056 and cannot close that on its own.
const SI = { x: 0.060, y: 0.135, z: -0.072, r: frac(0.0124), scale: [0.52, 1.55, 1.05] };

// The blade's margin, as a CLOSED tube swept all the way round its edge. The
// centreline is the outline inset by one rod radius so the finished rim lands
// on M.pelvis.width rather than past it, and the rod is fatter than the plate
// is thick, so it stands proud of both faces and turns a flat card into a
// dished blade with a lip. Closed, so there is no open tube end anywhere.
const RIM = [
  [0.0684, 0.1599],                   // posterior superior iliac spine
  [0.0867, 0.1785],
  [0.1154, 0.1844],                   // over the crest apex
  [0.1452, 0.1822],
  [0.1715, 0.1705],
  [0.1895, 0.1540],
  [0.1948, 0.1289],                   // anterior superior iliac spine
  [0.1883, 0.0971],
  [0.1779, 0.0684],                   // down the anterior border
  [0.1651, 0.0384],
  [0.1474, 0.0158],                   // round the lower tip, into the socket
  [0.1223, 0.0418],
  [0.1059, 0.0619],                   // back up the arcuate line
  [0.0892, 0.0790],
  [0.0758, 0.0986],
  [0.0713, 0.1272],                   // and up the sacroiliac face
];
const RIM_R = frac(0.0072);           // 0.018, against a 0.028 plate

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

// Turning the flat slab into a blade, in two steps that are both AFFINE.
//
// This started life as a per-vertex displacement field: push the pubis forward,
// drag the blade back, and the bowl appears. It does, and it also ruins the
// shading. ExtrudeGeometry caps the slab with one flat polygon triangulated
// into long thin slivers, which is invisible while the cap is planar and very
// visible the moment it is bent, so the iliac blade came out crossed with hard
// diagonal creases. A rotation and a linear fit both keep the cap planar, so
// the same flare costs nothing in shading. The bowl is not the blade's job any
// more in any case: the ischiopubic mass does that, out in front.
//
// PLATE_PITCH leans the crest back over the socket. PLATE_YAW swings the
// blade's LATERAL edge forward and its medial edge back, which is the sign that
// matches the anatomy: the anterior superior iliac spine is at the front of the
// figure and the sacroiliac joint is at the back of it. The first version had
// this the other way round, which put the whole medial border 0.07 in front of
// where M.sacrum sits and left that joint with no way to close.
//
// Both are held down to where the wing still faces mostly forward: at half
// again these angles the blade is so nearly edge-on that the front view loses
// it altogether.
const PLATE_PITCH = -0.34;
const PLATE_YAW = -0.44;

// ExtrudeGeometry's bevel grows the outline outward by bevelSize, and further
// at a sharp corner, so the slab is measured and mapped back onto exactly the
// box its outline was authored in. An untrue pelvis is what got the previous
// build rejected, and 0.070 * 0.34 of bevel is 15% of the blade's width all by
// itself. The map is returned as well as applied, so the sacroiliac pad can be
// authored in the same flat coordinates and still land on the bone.
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
  const ax = (PELVIS_HALF - PLATE_MEDIAL) / (hi - lo);
  const ay = (PELVIS_TOP - PLATE_BOTTOM) / (yhi - ylo);
  const map = {
    euler,
    dz: -acetabulum.z,
    ax,
    bx: PLATE_MEDIAL - ax * lo,
    ay,
    by: PLATE_BOTTOM - ay * ylo,
  };
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, s * (map.ax * s * pos.getX(i) + map.bx));
    pos.setY(i, map.ay * pos.getY(i) + map.by);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return map;
}

// The same journey for a single point, so anything authored against the flat
// outline lands on the bone the outline became.
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
  { headX: -0.128, headZ: 0.352, shaftR: 0.062, headR: 0.086, toeR: 0.074, dirX: -0.30, phalanx: [0.096, 0.076] },
  { headX: -0.056, headZ: 0.402, shaftR: 0.048, headR: 0.068, toeR: 0.058, dirX: -0.12, phalanx: [0.070, 0.046, 0.040] },
  { headX: 0.016, headZ: 0.394, shaftR: 0.046, headR: 0.066, toeR: 0.056, dirX: 0.04, phalanx: [0.064, 0.044, 0.038] },
  { headX: 0.084, headZ: 0.360, shaftR: 0.044, headR: 0.062, toeR: 0.054, dirX: 0.18, phalanx: [0.054, 0.038, 0.034] },
  { headX: 0.152, headZ: 0.300, shaftR: 0.044, headR: 0.064, toeR: 0.052, dirX: 0.32, phalanx: [0.044, 0.030, 0.030] },
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
    // --- iliac blade --------------------------------------------------------
    const outline = smoothOutline(HIP_OUTLINE.map(([x, y]) => new THREE.Vector2(s * x, y)));
    const slab = plate(outline, HIP_THICKNESS, { bevel: HIP_BEVEL });
    const map = poseAndFit(slab, s);
    put(group, slab);

    put(group, shaft(
      new THREE.CatmullRomCurve3(RIM.map(([x, y]) => onPlate(map, s, x, y)), true, 'centripetal'),
      RIM_R,
      { waist: 0.99, segments: 64 },
    ));

    put(group, bulb(SI.r, { squash: 1 }), s * SI.x, SI.y, SI.z).scale.set(...SI.scale);

    // --- acetabulum ---------------------------------------------------------
    put(group, bulb(ACET.bossR, { squash: 1 }), s * ACET.x, ACET.y, ACET.z)
      .scale.set(...ACET.scale);

    // --- ischiopubic mass ---------------------------------------------------
    const at = (k) => V(s * RING[k][0], RING[k][1], RING[k][2]);
    const rA = at('A');
    const rBu = at('Bu');
    const rBd = at('Bd');
    const rT = at('T');
    const rQ = at('Q');

    // Two numbers here have to be exact and are pinned rather than trusted: the
    // pubic body sets the seam at the symphysis, and the ischial tuberosity is
    // the lowest bone in the pelvis, so it alone decides whether the pelvis
    // comes out M.pelvis.height tall.
    const shift = s * (RING.body * RING.bodyScale[0] - SYMPHYSIS_OVERLAP) - rBu.x;
    rBu.x += shift;
    rBd.x += shift;
    rT.y = PELVIS_BOTTOM + RING.tuber * RING.tuberSquash * RING.tuberScale[1];

    // Bowed up and away from the middle of the foramen. Run straight, the
    // superior ramus cuts a chord across the hole and there is nothing left to
    // see through.
    put(group, straightShaft(rA, rBu, RING.superior[0], {
      endRadius: RING.superior[1], bow: RING.superiorBow, bowAxis: V(0, 1, 0.30),
      waist: 0.94, segments: 20,
    }));
    put(group, shaft(
      new THREE.CatmullRomCurve3([rBd, rT, rQ], false, 'centripetal'),
      RING.lower[0],
      { endRadius: RING.lower[1], waistAt: RING.lowerWaistAt, waist: 0.94, segments: 26 },
    ));

    // One block for the pubic body rather than a bulb at each end of a bar.
    // Both sweeps die inside it, so the two sides meet at the symphysis as a
    // solid front with a seam down it, which is what the photo has, instead of
    // each side ending in a ball of its own with daylight between them.
    const body = rBu.clone().lerp(rBd, 0.5);
    put(group, bulb(RING.body, { squash: 1 }), body.x, body.y, body.z)
      .scale.set(...RING.bodyScale);
    put(group, bulb(RING.tuber), rT.x, rT.y, rT.z).scale.set(...RING.tuberScale);

    // --- hip joint ----------------------------------------------------------
    const hip = new THREE.Object3D();
    hip.position.set(s * HIP_X, 0, 0);
    group.add(hip);
    joints[`hip${tag}`] = hip;

    // Femoral head, dead on the pivot. It cannot leave its socket no matter
    // what the animator does to hip.rotation, which is the whole reason the
    // pivot is here and not at the top of the shaft.
    put(hip, bulb(R.femurHead, { squash: 0.94 }));

    // Neck and greater trochanter. The shaft starts at the TROCHANTER, not
    // under the head, so its axis misses the pivot by 0.080 and the neck has to
    // reach across at an angle to get there. That offset is the whole reason
    // the hip does not read as a stick pushed into a hole, and it is also why
    // the crouch looks like a hip rather than a swivel.
    //
    // The trochanter sits level with the head, which is where a real one is and
    // where the photo puts it. Hung below the head it drags the top of the
    // femur down and the joint stops looking like a hinge. It reaches x = 0.235
    // against the pelvis's 0.210, so it stands proud of the edge, as it does in
    // the photo.
    const trochanter = V(s * frac(0.0320), -frac(0.0112), 0);
    put(hip, straightShaft(V(0, 0, 0), V(s * frac(0.0296), -frac(0.0104), 0), R.femurNeck, { segments: 12, waist: 0.86 }));
    const troch = put(hip, bulb(R.trochanter, { squash: 0.92 }), trochanter.x, trochanter.y, trochanter.z);
    troch.scale.set(1.14, 1.10, 0.94);

    // --- femur --------------------------------------------------------------
    // Thin at the hip and swollen at the knee, which bone.js can now do itself:
    // `r` is the radius at the trochanter and `endRadius` the one at the
    // condyles. This part carried a local taper() until the vocabulary grew one.
    const kneeLocal = V(s * (KNEE_X - HIP_X), KNEE_Y, KNEE_Z);
    put(hip, straightShaft(
      trochanter.clone().setZ(frac(0.0008)),
      kneeLocal,
      R.femur * R.femurTaper,
      {
        bow: M.leg.bow, bowAxis: V(s * 0.86, 0, 0.51), endBias: 0.62, segments: 30,
        endRadius: R.femur, waistAt: 0.46,
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
    put(knee, straightShaft(
      V(-s * frac(0.0016), -frac(0.0008), frac(0.0004)),
      ankleLocal,
      R.tibia,
      {
        bow: M.leg.bow * 0.5, bowAxis: V(s, 0, 0), endBias: 0.58, segments: 26,
        endRadius: R.tibia * R.tibiaTaper, waistAt: 0.54,
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

// THE SACROILIAC JOINT, which this part and the axial part have to close
// between them.
//
// It is read off M.sacrum rather than measured off a build and written down
// here, because a number copied out of a render goes stale the moment either
// side is reworked, and this one already did that once: the blade was built to
// meet a sacrum that then moved 0.011 narrower, 0.019 higher and 0.021 further
// back, and the joint opened up. SI above is derived from M.sacrum and nothing
// else, so it follows the sacrum wherever it goes.
//
//   M.sacrum.width sets the faces the pad has to reach:  x = +/-0.0526
//   M.sacrum.bottom to M.sacrum.top set its span:        y = 0.094 to 0.226
//   The axial group's own depth puts it at:              z = -0.139 to -0.035
//
// The blade's own medial border stops at x = 0.056, so it cannot close a 0.0526
// joint on its own and is not meant to: the pad reaches 0.044, well across the
// sacrum's face, and the two interpenetrate. M.pelvis.width and
// M.leg.hipSeparation between them fix where the blades are, so if the sacrum
// ever moves again it is the pad that follows, not the blade.
//
// Depth: this part spans 0.204 of M.pelvis.depth's 0.220. The rest is at the
// BACK and it is the sacrum's, which reaches to z = -0.139 where this part
// stops at -0.106.
//
// Nothing is exported for any of this. PARTS.md says this module exports
// buildLower and nothing else, and a number in a comment cannot drift out of
// sync with a build the way a second export can.
