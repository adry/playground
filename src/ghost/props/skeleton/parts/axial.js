import * as THREE from 'three';
import M, { LEFT_X } from '../metrics.js';
import { shaft, straightShaft, jointBall, plate, drum } from './bone.js';

// The axial skeleton: sacrum and coccyx, the whole vertebral column, the
// ribcage and the sternum.
//
// This is the part of the previous build the user rejected, and it was rejected
// for two specific reasons that everything below is arranged around:
//
//   1. The backbone had gaps. A chain of vertebrae that merely TOUCHES opens a
//      visible crack the instant a joint bends, and this character's first
//      seconds are spent hauling itself out of the ground bent double.
//   2. It did not exist from behind. There were no spinous processes at all, so
//      the back read as an open hole into the ribcage, and the ribs began in
//      mid air instead of on a vertebra.
//
// The fixes, stated once here because they are the reason for most of the
// choices further down:
//
//   * Every consecutive pair of vertebral bodies OVERLAPS. The pitch of each
//     stack is well under the height of the drum, so neighbours interpenetrate
//     rather than abut. Nothing in the column is ever placed end to end.
//   * A true SPHERE sits at each of the three joint pivots. A sphere is the one
//     solid that is invariant under any rotation about its own centre, so the
//     bead cannot move relative to the parent bone no matter how the joint is
//     driven. It overlaps the vertebra below (which lives in the parent frame
//     and never moves) and the vertebra above (which is rigid with it), so the
//     union stays connected at literally any angle. That is a proof, not a
//     tuning: the crack cannot open, rather than being unlikely to.
//   * The spinous processes are a real chain of knuckles from the coccyx to the
//     skull. Each bulb is sized off the gap to the vertebra BELOW it, so that
//     projected from directly behind consecutive ones overlap whatever the
//     local spacing is, and the column reads as one continuous ridge.
//   * Every rib starts on its own vertebra's transverse process, sweeps BACK
//     behind the vertebral body first, and only then goes round to the front.
//   * Every open mouth in the mesh is closed. drum() is a lathe and shaft() is
//     a tube, and neither caps its ends, so a vertebral body and a process are
//     both open tubes until something is put over them. See endplate().
//
// Authored facing +Z, Y up. Every dimension below is a world height or a world
// depth; the frames built inside buildAxial convert them into the local space
// of whichever joint owns the bone, once, on the way in.

const H = M.height;
const f = (v) => v * H;                // fraction of standing height -> units

// --- The column's landmarks, in world Y ------------------------------------
//
// Pitches are what a real spine has, measured as a fraction of standing height:
// a lumbar body plus its disc is about 2.08% of the figure, a thoracic one
// 1.79%, a cervical one 0.85%. Using the real ratios rather than dividing each
// region evenly is what stops the neck looking like a stack of coins.
const LUMBAR_PITCH = f(0.0208);
const THORACIC_PITCH = f(0.0179);
const CERVICAL_PITCH = f(0.0085);

// L1 sits exactly at M.y.lumbarTop, which metrics.js defines as where the
// ribcage's bottom edge sits: the costal margin and the topmost lumbar
// vertebra are at the same height on the reference.
const Y_L1 = M.y.lumbarTop;
const Y_L5 = Y_L1 - 4 * LUMBAR_PITCH;             // the spineLower pivot
const Y_T_TOP = M.y.ribcageTop - f(0.0052);       // the top rib rides just under the cage's crown
const Y_T_BOT = Y_T_TOP - 7 * THORACIC_PITCH;     // the spineUpper pivot
const Y_ATLAS = M.y.ribcageTop + M.neck.length;   // M.neck.length is measured from the cage
const Y_C7 = Y_ATLAS - 6 * CERVICAL_PITCH;        // the neck pivot

// --- The profile of the column ---------------------------------------------
//
// One table for the whole S, sacrum to atlas, in world (y, z). The double bend
// -- lumbar hollow forward, thoracic rounded back, cervical forward again -- is
// most of what makes a figure read as a skeleton in profile, and the rejected
// build had a straight pipe here. Every station below reads its z off this
// curve, so the vertebrae, the rib attachments and the sacral crest are on the
// same line by construction and cannot drift apart.
const SPINE_PROFILE = [
  [f(0.4960), f(-0.0232)],    // the coccyx tip, curled forward again under the tail
  [f(0.5200), f(-0.0304)],    // the sacrum's hollow, its most rearward point
  [f(0.5520), f(-0.0264)],
  [Y_L5, f(-0.0192)],         // L5/S1, the sacral promontory
  [f(0.6184), f(-0.0080)],    // L3, the lumbar lordosis at its most forward
  [Y_L1, f(-0.0184)],
  [Y_T_BOT, f(-0.0232)],
  [f(0.7304), f(-0.0368)],    // the thoracic kyphosis at its most rearward
  [f(0.7840), f(-0.0320)],
  [Y_C7, f(-0.0248)],
  [f(0.8440), f(-0.0144)],    // the cervical lordosis at its most forward
  [Y_ATLAS, f(-0.0168)],
];

// Sampled once and looked up by height. A curve object would let us ask for a
// point by arc length, but every consumer here knows the HEIGHT it wants, so a
// y -> z table is the shape that actually gets used.
const PROFILE = new THREE.CatmullRomCurve3(
  SPINE_PROFILE.map(([y, z]) => new THREE.Vector3(0, y, z)),
  false,
  'catmullrom',
  0.5,
).getSpacedPoints(400);

function zAt(y) {
  if (y <= PROFILE[0].y) return PROFILE[0].z;
  const last = PROFILE[PROFILE.length - 1];
  if (y >= last.y) return last.z;
  let lo = 0;
  let hi = PROFILE.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PROFILE[mid].y <= y) lo = mid; else hi = mid;
  }
  const span = PROFILE[hi].y - PROFILE[lo].y;
  const t = span > 1e-9 ? (y - PROFILE[lo].y) / span : 0;
  return PROFILE[lo].z + t * (PROFILE[hi].z - PROFILE[lo].z);
}

// How far the column leans at this height. Each vertebra is tilted onto the
// local tangent so the stack follows the S instead of stair-stepping across it;
// without this the overlap between neighbours is eaten by the offset and the
// silhouette gets a saw edge down the back.
function tiltAt(y) {
  const e = 0.004;
  return Math.atan2(zAt(y + e) - zAt(y - e), 2 * e);
}

// --- Ribcage ----------------------------------------------------------------
// M.ribcage.pairs pairs, indexed 0 at the top. The widths are the classic
// barrel: narrow at the throat, widest about two thirds down, tucking back in
// at the free ribs. `depth` is why the front reach and the rearward sweep are
// both real numbers rather than a token offset -- the rejected build was paper
// thin in profile and the ribs read as unconnected hoops.
const RIB_HALF_W = M.ribcage.width / 2 - f(0.0056);   // centreline; the tube adds the rest
const STERNUM_Z = f(0.0512);                          // front of the cage, on the midline
const RIB_BACK = f(0.0120);                           // how far behind its vertebra a rib sweeps

const RIB_W = [0.52, 0.72, 0.86, 0.95, 1.00, 0.99, 0.93, 0.82];
const RIB_FRONT = [0.70, 0.86, 0.96, 1.02, 1.03, 1.00, 0.92, 0.78];
const RIB_ARC = [0.92, 0.92, 0.92, 0.92, 0.92, 0.86, 0.78, 0.68];   // half turns swept
// How much lower a rib's front end is than its back. The first pass at these
// was half as much and the cage read from the side as a stack of flat hoops:
// the downward rake of the ribs is most of what gives a chest its shape.
const RIB_DROP = [0.0110, 0.0180, 0.0260, 0.0340, 0.0420, 0.0470, 0.0440, 0.0390].map(f);

// Where each true rib's cartilage lands on the sternum, as a drop from the
// jugular notch. Read off the reference: the gaps close up going down, because
// the manubrium takes two of them and the body takes three.
const STERN_TOP = M.y.ribcageTop - f(0.0110);
const STERN_BOT = STERN_TOP - f(0.0830);              // the xiphoid's point
const STERN_JOINT = STERN_TOP - f(0.0360);            // manubrium meets body
const STERN_XIPHOID = STERN_TOP - f(0.0700);          // body meets xiphoid
const CARTILAGE_DROP = [0.0060, 0.0240, 0.0400, 0.0530, 0.0620].map(f);

// The sternum's half width at a given height, so the cartilage lands buried in
// the plate rather than kissing its edge.
function sternHalf(y) {
  if (y >= STERN_JOINT) {
    const t = (STERN_TOP - y) / (STERN_TOP - STERN_JOINT);
    return f(0.0108) + (f(0.0076) - f(0.0108)) * Math.min(1, Math.max(0, t));
  }
  const t = (STERN_JOINT - y) / (STERN_JOINT - STERN_XIPHOID);
  return f(0.0076) + (f(0.0058) - f(0.0076)) * Math.min(1, Math.max(0, t));
}

// Thoracic transverse processes carry the rib tubercle, so their length is tied
// to the rib that sits on them: a fixed length leaves the top ribs starting
// outboard of a cage that is only half as wide up there.
function transverseReach(i) {
  return Math.min(f(0.0200), 0.26 * RIB_HALF_W * RIB_W[i] + f(0.0064));
}

// --- Small shared helpers ---------------------------------------------------

// A bulb of a stated FINISHED radius. jointBall multiplies by
// M.jointBallScale, which is the right behaviour when you are capping a shaft
// of known radius and the wrong one when you know the bulb you want.
function bulb(radius, squash = 0.94) {
  return jointBall(radius / M.jointBallScale, { squash });
}

// A vertebral endplate: a flat lens that seals the open mouth of a drum.
//
// drum() is a LatheGeometry, and a lathe has no caps, so a vertebral body is
// really an open tube whose mouths are its two widest rings. Stacking cannot
// hide them: the drum is fattest exactly at its rims and thinnest in the
// middle, so a rim always projects past the waist of whatever it overlaps and
// the annulus between them is a hole you can see through. Sitting a squat lens
// of 1.05 times the drum's radius on each rim plane closes it, and since a real
// vertebral body has a raised rim and a disc between it and the next one, the
// fix reads as anatomy rather than as a patch. Both ends of every drum, so no
// bend or twist can ever swing a mouth out into the open.
function endplate(r) {
  return bulb(r * 1.05, 0.34);
}

// A closed outline through control points, resampled smooth. plate() takes a
// polygon, and a fourteen-point polygon reads as a fourteen-sided nut however
// generous the bevel is.
function smoothOutline(controls, samples = 72) {
  const curve = new THREE.CatmullRomCurve3(
    controls.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    true,
    'catmullrom',
    0.5,
  );
  // getSpacedPoints on a closed curve repeats the first point at the end, and a
  // zero-length segment is a triangulation hazard in the extruder.
  return curve.getSpacedPoints(samples).slice(0, -1).map((p) => new THREE.Vector2(p.x, p.y));
}

export function buildAxial({ material }) {
  const geometries = [];
  const group = new THREE.Group();
  group.name = 'axial';
  // The axial skeleton is the midline, not a sided subtree, so it has no
  // outward direction of its own. The sign lives on the shoulder anchors, which
  // are the only sided things this part hands out.
  group.userData.outwardX = 0;

  const mesh = (geo, parent, name) => {
    geometries.push(geo);
    const m = new THREE.Mesh(geo, material);
    if (name) m.name = name;
    parent.add(m);
    return m;
  };

  // --- Frames --------------------------------------------------------------
  // Everything below is authored in world heights and converted here, once.
  // Four nested frames, one per joint, each remembering the world point it sits
  // on so a world coordinate can be dropped into any of them.
  const frame = (y, z) => ({ y, z, at: (x, wy, wz) => new THREE.Vector3(x, wy - y, wz - z) });
  const F_ROOT = frame(M.y.hip, 0);
  const F_LOWER = frame(Y_L5, zAt(Y_L5));
  const F_UPPER = frame(Y_T_BOT, zAt(Y_T_BOT));
  const F_NECK = frame(Y_C7, zAt(Y_C7));

  // --- The three joints ----------------------------------------------------
  // Identity rotation at rest, world-aligned axes, pivots on the column's own
  // curve. Chained lower -> upper -> neck so a bend at the waist carries the
  // chest, the arms and the head with it.
  const spineLower = new THREE.Object3D();
  spineLower.name = 'spineLower';
  spineLower.position.copy(F_ROOT.at(0, Y_L5, zAt(Y_L5)));
  group.add(spineLower);

  const spineUpper = new THREE.Object3D();
  spineUpper.name = 'spineUpper';
  spineUpper.position.copy(F_LOWER.at(0, Y_T_BOT, zAt(Y_T_BOT)));
  spineLower.add(spineUpper);

  const neck = new THREE.Object3D();
  neck.name = 'neck';
  neck.position.copy(F_UPPER.at(0, Y_C7, zAt(Y_C7)));
  spineUpper.add(neck);

  // --- The vertebra ---------------------------------------------------------
  // Body drum, one spinous process pointing back and down, two transverse
  // processes pointing back and out. Returned with a way to ask where a
  // transverse tip ended up in the frame it was placed in, because that is
  // where a rib starts and nothing else may decide it.
  //
  // The process shafts all START INSIDE the drum. shaft() builds a TubeGeometry
  // and TubeGeometry does not cap its ends, so an open mouth left outside the
  // body would be a visible hole; burying it costs nothing and removes the
  // whole class of bug.
  function vertebra({ parent, host, y, r, h, gap, spinReach, txReach, txDrop, txBulb, tag }) {
    const g = new THREE.Group();
    g.name = tag;
    g.position.copy(host.at(0, y, zAt(y)));
    g.rotation.x = tiltAt(y);
    parent.add(g);

    mesh(drum(r, h), g, `${tag}-body`);
    mesh(endplate(r), g).position.y = h / 2;
    mesh(endplate(r), g).position.y = -h / 2;

    // The knuckle. Sized off the gap to the vertebra BELOW, not off the stack's
    // nominal pitch, so that the two places where one region hands over to the
    // next -- L1 to the bottom thoracic, and the top thoracic to C7, where the
    // step is neither region's pitch -- close up like everywhere else. Rendered
    // from directly behind (the view the rejected build failed) the bottom of
    // one knuckle then sits 0.15 of a gap below the top of the shaft beneath
    // it, and the back reads as one continuous ridge of bumps.
    const knuckle = 0.48 * gap;
    const spineR = 0.27 * gap;
    const tip = new THREE.Vector3(0, -0.42 * gap, -(r + spinReach));
    mesh(
      straightShaft(new THREE.Vector3(0, 0.002, -r * 0.28), tip, spineR, {
        bow: 0.06,
        bowAxis: new THREE.Vector3(0, -1, 0),
        waist: 0.86,
        endBias: 0.34,
        segments: 12,
      }),
      g,
      `${tag}-spinous`,
    );
    mesh(bulb(knuckle, 0.92), g, `${tag}-knuckle`).position.copy(tip);

    for (const side of [-1, 1]) {
      const end = new THREE.Vector3(side * txReach, -txDrop, -(r * 0.42 + f(0.0044)));
      mesh(
        straightShaft(new THREE.Vector3(side * r * 0.30, 0.003, -r * 0.16), end, txBulb * 0.78, {
          waist: 0.88,
          endBias: 0.36,
          segments: 10,
        }),
        g,
        `${tag}-tp`,
      );
      mesh(bulb(txBulb), g).position.copy(end);
    }

    return {
      group: g,
      // A transverse tip, back in the frame the vertebra was placed in.
      tip(side) {
        return new THREE.Vector3(side * txReach, -txDrop, -(r * 0.42 + f(0.0044)))
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), g.rotation.x)
          .add(g.position);
      },
    };
  }

  // A pivot bead. THIS IS THE SEAM GUARANTEE, so it is worth being explicit:
  // squash is forced to 1 so the bead is a true sphere. A sphere centred on the
  // pivot is identical to itself under every rotation of that pivot, so its
  // overlap with the bone below (which lives in the parent frame and never
  // moves) is fixed forever, and its overlap with everything above (rigid with
  // it) likewise. The column therefore cannot come apart at a joint at any
  // angle at all. Squashing it, even by the vocabulary's usual 0.88, would
  // break exactly that property.
  function pivotBead(joint, radius, tag) {
    mesh(bulb(radius, 1), joint, tag);
  }

  // --- Sacrum, sacral crest and coccyx ---------------------------------------
  //
  // Rebuilt after the first pass came out as a big smooth heart-shaped shield
  // that filled the whole gap between the iliac blades and was the first thing
  // the eye landed on down there. Against the reference it was wrong in four
  // separate ways at once, and all four are fixed here: it is narrower and
  // shorter so the blades frame it, it is set back so its face sits behind the
  // pelvic brim, it is a flat triangle with a straight top edge rather than a
  // domed heart, and it carries the two converging rows of sacral foramina.
  //
  // The foramina are the point. They are tiny -- f(0.0030) across the opening,
  // about four pixels in a full-figure render -- and they are still most of
  // what says "sacrum" rather than "plate", in exactly the way the spinous
  // processes turned out to be most of what draws the backbone.
  //
  // Built as a thin plate inside a rim rod rather than as one thick bevelled
  // plate, because plate()'s bevel shrinks a hole's contour by bevelSize at
  // each face: at the bevel this bone wants for its rim, every foramen would be
  // sealed shut. A near-flat plate keeps the holes honest and a tube run round
  // its edge gives the rounded margin back. bone.js says as much, and the
  // pelvis went the same way.
  const SAC_TOP = f(0.5792);            // just above the spineLower pivot, so L5 buries into it
  const SAC_BOT = f(0.5288);
  const SAC_LEAN = f(0.0048);           // extra rearward drop of the apex, on top of the spine curve
  const SAC_THICK = f(0.0104);
  // The rim rod is exactly half the blade's thickness, so the margin is flush
  // with the faces. Fatter than that and the flat face reads as the inside of a
  // bowl, which was the first attempt at this.
  const SAC_RIM = SAC_THICK / 2;

  const sacTopZ = zAt(SAC_TOP);
  const sacBotZ = zAt(SAC_BOT) - SAC_LEAN;
  const sacTilt = Math.atan2(sacTopZ - sacBotZ, SAC_TOP - SAC_BOT);

  const sacrum = new THREE.Group();
  sacrum.name = 'sacrum';
  sacrum.position.copy(F_ROOT.at(0, (SAC_TOP + SAC_BOT) / 2, (sacTopZ + sacBotZ) / 2));
  sacrum.rotation.x = sacTilt;
  group.add(sacrum);

  // The rim rod's CENTRELINE, clockwise from the middle of the top edge, in the
  // sacrum's own plane. The finished silhouette is this grown by SAC_RIM all
  // round, which puts the top edge at f(0.0376) wide and brings the sides down
  // to a rounded apex. The outline tables in this file (this one and the
  // sternum's) are the only numbers here in world units rather than fractions
  // of HEIGHT: an outline is a drawing, and rewriting every vertex as f(...)
  // makes it unreadable for a robustness nobody is going to exercise.
  // Everything that decides where a bone SITS is a fraction.
  const SACRUM_RIM = [
    [0, 0.054], [0.039, 0.054], [0.036, 0.029], [0.030, 0.004],
    [0.024, -0.021], [0.015, -0.042], [0.007, -0.054], [0, -0.056],
    [-0.007, -0.054], [-0.015, -0.042], [-0.024, -0.021],
    [-0.030, 0.004], [-0.036, 0.029], [-0.039, 0.054],
  ];

  // Four pairs, converging downward the way a real sacrum's do: x, height, and
  // the radius of the opening. Set low on the blade rather than centred on it,
  // because L5's body overhangs the promontory and anything in the top f(0.010)
  // is simply not visible from the front.
  const FORAMINA = [
    [0.019, 0.024, f(0.0034)],
    [0.016, 0.004, f(0.0032)],
    [0.013, -0.016, f(0.0028)],
    [0.010, -0.034, f(0.0025)],
  ];
  const ring = (cx, cy, r) => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    return pts;
  };
  const holes = [];
  for (const [x, y, r] of FORAMINA) {
    holes.push(ring(x, y, r));
    holes.push(ring(-x, y, r));
  }

  // bevel 0.06 rather than the vocabulary's 0.4: it is only there to take the
  // wire edge off the holes, and every bit of it comes straight off their
  // radius at the face. The blade's own edge is the rim rod's job.
  mesh(
    plate(smoothOutline(SACRUM_RIM, 72), SAC_THICK, { bevel: 0.06, holes, bevelSegments: 3 }),
    sacrum,
    'sacrum-blade',
  );

  // The rim rod. Sampled off a CLOSED spline and then swept as an open tube
  // that ends where it started, because bone.js's shaft() builds an uncapped
  // TubeGeometry: the two mouths land on the same circle and seal each other,
  // and a bulb sits on the join in case the frames arrive out of phase.
  const rimLoop = new THREE.CatmullRomCurve3(
    SACRUM_RIM.map(([x, u]) => new THREE.Vector3(x, u, 0)),
    true,
    'catmullrom',
    0.5,
  ).getSpacedPoints(96);
  mesh(
    shaft(new THREE.CatmullRomCurve3(rimLoop, false, 'centripetal', 0.5), SAC_RIM, {
      waist: 1,          // a margin, not a shaft: no waisting
      segments: 96,
    }),
    sacrum,
    'sacrum-rim',
  );
  mesh(bulb(SAC_RIM * 1.05), sacrum).position.copy(rimLoop[0]);

  // The median sacral crest and the coccyx, carrying the ridge of knuckles down
  // past the tail. Children of the sacrum now rather than points on the spine
  // curve: the blade moved back and got thin in this rework, and a crest placed
  // off the curve would have been left standing behind it. Anchored to the
  // blade, it cannot come off whatever the blade does next.
  //
  // Height along the blade, how far the bulb stands off its back face, radius.
  // The top one is the S1 tubercle and it is the biggest, because it is the one
  // that has to reach back far enough to meet L5's spinous knuckle. Below the
  // apex the chain becomes the coccyx and curls forward again.
  const CREST = [
    [0.048, f(0.0080), f(0.0092)],
    [0.016, f(0.0056), f(0.0080)],
    [-0.014, f(0.0036), f(0.0068)],
    [-0.042, f(0.0020), f(0.0060)],
    [-0.076, f(-0.0012), f(0.0056)],   // coccyx, first segment
    [-0.098, f(-0.0044), f(0.0048)],
    [-0.117, f(-0.0076), f(0.0040)],
  ];
  const crestPts = CREST.map(([u, stand, r]) => ({
    p: new THREE.Vector3(0, u, -(SAC_THICK / 2 + stand)),
    r,
  }));
  mesh(
    shaft(
      new THREE.CatmullRomCurve3(crestPts.map((c) => c.p), false, 'centripetal', 0.5),
      f(0.0028),
      { waist: 0.9, segments: 24 },
    ),
    sacrum,
    'sacral-crest',
  );
  for (const c of crestPts) mesh(bulb(c.r, 0.9), sacrum).position.copy(c.p);

  // --- Lumbar ---------------------------------------------------------------
  // Five, L5 up to L1. L5 sits ON the spineLower pivot, so the bone that
  // straddles the joint boundary turns about its own centre.
  for (let k = 0; k < 5; k++) {
    const y = Y_L5 + k * LUMBAR_PITCH;
    vertebra({
      parent: spineLower,
      host: F_LOWER,
      y,
      r: f(0.0144),
      h: LUMBAR_PITCH * 1.38,          // 38% taller than the pitch: neighbours interpenetrate
      gap: LUMBAR_PITCH,
      spinReach: f(0.0120),
      txReach: f(0.0248),
      txDrop: f(0.0016),
      txBulb: f(0.0044),
      tag: `L${5 - k}`,
    });
  }
  pivotBead(spineLower, f(0.0148), 'bead-spineLower');

  // --- Thoracic -------------------------------------------------------------
  // M.ribcage.pairs of them, bottom-up, the bottom one on the spineUpper pivot.
  // The bodies shrink going up the way a real thorax does; a constant radius
  // here makes the top of the cage look swollen.
  const thoracic = [];
  const pairs = M.ribcage.pairs;
  for (let k = 0; k < pairs; k++) {
    const y = Y_T_BOT + k * THORACIC_PITCH;
    const i = pairs - 1 - k;                        // rib index, 0 at the top
    const t = k / (pairs - 1);
    thoracic.push(vertebra({
      parent: spineUpper,
      host: F_UPPER,
      y,
      r: f(0.0104) + (f(0.0126) - f(0.0104)) * t,
      h: THORACIC_PITCH * 1.38,
      gap: k === 0 ? Y_T_BOT - Y_L1 : THORACIC_PITCH,
      spinReach: f(0.0104),
      txReach: transverseReach(i),
      txDrop: f(0.0012),
      txBulb: f(0.0048),
      tag: `T${i + 1}`,
    }));
  }
  pivotBead(spineUpper, f(0.0124), 'bead-spineUpper');

  // --- Cervical -------------------------------------------------------------
  // Seven, C7 on the neck pivot up to the atlas. The atlas gets a stub for a
  // spinous process because a real one has only a posterior tubercle, and the
  // transverse processes carry the column out to M.neck.radius.
  for (let k = 0; k < 7; k++) {
    const y = Y_C7 + k * CERVICAL_PITCH;
    const t = k / 6;
    const atlas = k === 6;
    vertebra({
      parent: neck,
      host: F_NECK,
      y,
      r: f(0.0092) - f(0.0010) * t,
      h: CERVICAL_PITCH * 1.50,
      // C7 is the vertebra prominens and here it has a job: it is the only
      // knuckle that can bridge the step up from the top of the thorax.
      gap: k === 0 ? Y_C7 - Y_T_TOP : CERVICAL_PITCH,
      spinReach: atlas ? f(0.0028) : f(0.0060),
      txReach: M.neck.radius * 0.62,
      txDrop: 0,
      txBulb: f(0.0030),
      tag: `C${7 - k}`,
    });
  }
  pivotBead(neck, f(0.0096), 'bead-neck');

  // --- Sternum --------------------------------------------------------------
  // Three bones: manubrium, body, xiphoid. They overlap in height rather than
  // meeting, for the same reason the vertebrae do -- and although nothing here
  // articulates, a hairline between two plates lit from one side reads as a
  // crack in the model rather than as a suture.
  const sternum = new THREE.Group();
  sternum.name = 'sternum';
  // The outlines below are authored in world heights, so the group carries the
  // frame's y offset and the plates sit at zero inside it.
  sternum.position.set(0, -F_UPPER.y, STERNUM_Z - F_UPPER.z);
  spineUpper.add(sternum);

  const sternPlate = (outline, tag) =>
    mesh(plate(smoothOutline(outline, 56), f(0.0104), { bevel: 0.36 }), sternum, tag);

  const jn = STERN_TOP;                        // the jugular notch
  sternPlate([
    [-0.027, jn - 0.020], [-0.024, jn - 0.005], [-0.015, jn], [-0.006, jn - 0.002],
    [0, jn - 0.011], [0.006, jn - 0.002], [0.015, jn], [0.024, jn - 0.005],
    [0.027, jn - 0.020], [0.022, STERN_JOINT + 0.010], [0.019, STERN_JOINT - 0.006],
    [0, STERN_JOINT - 0.009], [-0.019, STERN_JOINT - 0.006], [-0.022, STERN_JOINT + 0.010],
  ], 'manubrium');

  sternPlate([
    [-0.019, STERN_JOINT + 0.007], [-0.018, STERN_JOINT - 0.026],
    [-0.016, STERN_XIPHOID + 0.016], [-0.014, STERN_XIPHOID - 0.005],
    [0, STERN_XIPHOID - 0.009], [0.014, STERN_XIPHOID - 0.005],
    [0.016, STERN_XIPHOID + 0.016], [0.018, STERN_JOINT - 0.026],
    [0.019, STERN_JOINT + 0.007], [0, STERN_JOINT + 0.010],
  ], 'sternum-body');

  sternPlate([
    [-0.013, STERN_XIPHOID + 0.006], [-0.011, STERN_XIPHOID - 0.012],
    [-0.006, STERN_BOT + 0.007], [0, STERN_BOT],
    [0.006, STERN_BOT + 0.007], [0.011, STERN_XIPHOID - 0.012],
    [0.013, STERN_XIPHOID + 0.006], [0, STERN_XIPHOID + 0.010],
  ], 'xiphoid');

  // --- Ribs and costal cartilage --------------------------------------------
  // Each rib is its own Group so it can be shed whole, cartilage included.
  //
  // The path is: head on the side of the vertebral body, tubercle out on the
  // transverse process and BEHIND the body, then an ellipse round to the front.
  // Starting the ellipse at the angle whose x already equals the transverse
  // reach is what keeps that first stretch from doubling back on itself.
  const shed = new Map();

  for (let i = 0; i < pairs; i++) {
    const k = pairs - 1 - i;
    const v = thoracic[k];
    const y = Y_T_BOT + k * THORACIC_PITCH;
    const zS = zAt(y);
    const halfW = RIB_HALF_W * RIB_W[i];
    const zBack = zS - RIB_BACK;
    const halfD = (STERNUM_Z * RIB_FRONT[i] - zBack) / 2;
    const zc = zBack + halfD;
    const reach = transverseReach(i);
    const a0 = Math.asin(Math.min(0.92, reach / halfW));
    const attached = i < M.ribcage.trueRibs;

    for (const side of [-LEFT_X, LEFT_X]) {
      const S = side === LEFT_X ? 'L' : 'R';
      const rib = new THREE.Group();
      rib.name = `rib${S}${i + 1}`;
      spineUpper.add(rib);

      // Point 1 is the vertebra's own transverse tip, asked of the vertebra
      // rather than recomputed here. That is the whole answer to "the ribs
      // began in mid air": the rib cannot start anywhere else, because the only
      // place it can read its start from is the bone it hangs on.
      const pts = [
        F_UPPER.at(side * f(0.0048), y + f(0.0020), zS + f(0.0016)),
        v.tip(side),
      ];
      const N = 18;
      for (let s = 0; s <= N; s++) {
        const a = a0 + (RIB_ARC[i] * Math.PI - a0) * (s / N);
        pts.push(F_UPPER.at(
          side * halfW * Math.sin(a),
          y - RIB_DROP[i] * (1 - Math.cos(a)) / 2,
          zc - halfD * Math.cos(a),
        ));
      }

      const rRib = f(0.0064) - f(0.0007) * (i / (pairs - 1));
      mesh(
        shaft(new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5), rRib, {
          waist: 0.88,
          endBias: 0.30,
          segments: 44,
        }),
        rib,
        `rib${S}${i + 1}-shaft`,
      );
      // Caps. TubeGeometry has no end caps, so a bare shaft end is a chip out
      // of the bone. The head is buried in the vertebra as well, but the tip is
      // out in the open and gets a near-round bulb: the default 0.94 squash is
      // measured on Y and a rib's tip mouth is mostly a Y-facing disc, so a
      // squashed cap can leave a crescent of it showing.
      mesh(bulb(rRib * 1.26, 0.98), rib).position.copy(pts[0]);
      mesh(bulb(rRib * (attached ? 1.12 : 1.24), 0.98), rib).position.copy(pts[pts.length - 1]);

      let land = null;
      if (attached) {
        const tip = pts[pts.length - 1];
        const yS = STERN_TOP - CARTILAGE_DROP[i];
        // Land on the sternum's mid-plane and well inboard of its edge. A cap
        // bulb here was the first attempt and it was wrong: the plate is only
        // f(0.0104) thick, so any bulb big enough to close the tube stands
        // proud of the plate's face and reads as a rivet. Buried in the plate,
        // the tube's open mouth needs no cap at all.
        land = F_UPPER.at(side * (sternHalf(yS) - f(0.0040)), yS, STERNUM_Z);
        // Thinner than the rib it continues, both because cartilage is and
        // because its open mouth has to fit inside the plate's thickness.
        mesh(
          straightShaft(tip, land, rRib * 0.70, {
            bow: 0.10,
            bowAxis: new THREE.Vector3(0, 0, 1),   // cartilage bulges forward of the chord
            waist: 0.9,
            endBias: 0.4,
            segments: 14,
          }),
          rib,
          `cartilage${S}${i + 1}`,
        );
      }

      // Move the group's origin onto the bone. Everything above is authored in
      // the chest's coordinates, which leaves the rib's own origin sitting on
      // the spine, a long way from the bone itself. A shed rib is handed to
      // createDebris, which spins it about its own origin: off-centre, the bone
      // orbits a point in mid air instead of tumbling. Sliding the children
      // back by the same amount leaves the rest pose pixel-identical.
      const centre = new THREE.Box3()
        .setFromPoints(land ? [...pts, land] : pts)
        .getCenter(new THREE.Vector3());
      for (const child of rib.children) child.position.sub(centre);
      rib.position.copy(centre);
    }
  }

  // Bones safe to shake loose. A rib taken out of the middle of the cage leaves
  // a gap that reads as a skeleton losing a rib, which is the effect wanted;
  // taking the cartilage with it is what stops it reading as a bug.
  for (const name of ['ribL3', 'ribR4', 'ribL6', 'ribR7']) {
    const o = spineUpper.getObjectByName(name);
    if (o) shed.set(name, o);
  }

  // --- Anchors --------------------------------------------------------------
  // The atlas anchor sits at the centre of C1's bead, so the skull turns about
  // the same point the top vertebra does. The bead itself is a true sphere for
  // the reason spelled out at pivotBead: the head joint rotates the skull about
  // this point, and a sphere here cannot be pulled off the neck by that.
  const atlas = new THREE.Object3D();
  atlas.name = 'atlas';
  atlas.position.copy(F_NECK.at(0, Y_ATLAS, zAt(Y_ATLAS)));
  neck.add(atlas);
  mesh(bulb(f(0.0098), 1), neck, 'bead-atlas').position.copy(atlas.position);

  // Glenoids. M.arm.shoulderSeparation apart at M.y.shoulder, parked just
  // behind the coronal midline of the cage where a real socket faces out and
  // slightly forward. Hung off spineUpper so the arms follow the chest.
  //
  // Side comes from LEFT_X, never from a local guess. This file originally had
  // 'L' at negative x, which is viewer-left in the front view and the wrong
  // answer: the figure faces +Z with +Y up, so its own left is up cross forward
  // and that is +X. It disagreed with the hips, which is invisible standing
  // still and cross-limbed the moment anything walks. Each anchor publishes the
  // sign it was built on so the arm parented to it can read it rather than
  // assume it.
  const anchors = { atlas };
  for (const side of [-LEFT_X, LEFT_X]) {
    const S = side === LEFT_X ? 'L' : 'R';
    const a = new THREE.Object3D();
    a.name = `shoulder${S}`;
    a.position.copy(F_UPPER.at(side * M.arm.shoulderSeparation / 2, M.y.shoulder, f(0.0016)));
    a.userData.side = S;
    a.userData.outwardX = side;
    spineUpper.add(a);
    anchors[`shoulder${S}`] = a;
  }

  return {
    group,
    joints: { spineLower, spineUpper, neck },
    anchors,
    shed,
    dispose() {
      for (const g of geometries) g.dispose();
      geometries.length = 0;
    },
  };
}

export default buildAxial;
