import * as THREE from 'three';
import M, { LEFT_X } from '../metrics.js';
import { shaft, straightShaft, jointBall, plate } from './bone.js';

// One arm and its half of the shoulder girdle: clavicle, scapula, humerus,
// radius, ulna, carpal block, five metacarpals and fourteen phalanges.
//
// The frame. The group's origin is the GLENOID, which is where the axial part
// hands us an anchor: M.arm.shoulderSeparation apart at M.y.shoulder. Local
// axes are the world's, so +Y is up, +Z is the way the figure faces, and the
// arm hangs down -Y. Everything below is authored in that frame.
//
// Which way is out. LEFT IS +X: the figure faces +Z with +Y up, so its own left
// is up cross forward, and Y cross Z is X. metrics.js exports that as `LEFT_X`
// and model.js asserts it against every part's `group.userData.outwardX`, so
// this file takes the sign from the metric and never from a local guess. An
// earlier pass had axial on one convention and legs on the other, which put
// `shoulderL` and `hipL` on opposite sides of the same body: invisible at rest
// and cross-limbed the moment anything walks.
//
// `sx` is the outward direction for the side being built, and every left/right
// decision in this file goes through it, so the two arms are two separately
// authored meshes rather than one mesh with a negative scale. A mirrored scale
// inverts triangle winding, and the result is an arm that is lit inside out
// from behind, which is exactly the class of bug that only shows up in the back
// view nobody rendered.
//
// The A-pose flare is baked into the geometry here, not applied as a rotation
// on the shoulder node. `joints.shoulder`, `joints.elbow` and `joints.wrist`
// are all identity at rest with world-aligned axes, so the animator can write
// absolute Euler targets.

const f = (v) => v * M.height;        // fraction of standing height -> world units
const h = (v) => v * M.arm.hand;      // fraction of hand length, for the digits

// --- measurements this part needs that metrics.js does not carry ------------
// metrics.js has the four arm lengths and the flare and nothing else, so every
// radius below was measured off .ref/ref-skeleton.jpg the same way M's own
// numbers were: pixels divided by the figure's pinned standing height. They are
// written as fractions of height so they survive a change of scale, and they
// are collected here rather than sprinkled through the file so the coordinator
// can lift the block into metrics.js unchanged. See the report.
const A = {
  // End radii, in the sense shaft() means: the bone is this fat where it meets
  // its joint and M.shaftWaist of it in the middle.
  humerusR: f(0.0112),      // photo: 0.035 across the shaft at mid, so 0.0175 / 0.62
  forearmR: f(0.0072),      // each of the two bones; a forearm is not one tube
  clavicleR: f(0.0074),
  scapSpineR: f(0.0072),
  acromionR: f(0.0074),
  coracoidR: f(0.0052),

  // Arguments to jointBall(), so the bulb the eye sees is M.jointBallScale
  // times these. The shoulder is the biggest bulb on the figure after the
  // skull and the hip, and getting it small is the fastest way to lose the
  // vinyl-toy read.
  shoulderBulb: f(0.0163),  // photo: ball 0.098 across
  elbowBulb: f(0.0132),     // photo: 0.083 across
  glenoidBulb: f(0.0120),
  olecranonBulb: f(0.0072),
  radialHeadBulb: f(0.0066),
  styloidBulb: f(0.0062),

  // How far apart the radius and the ulna run at mid-shaft, centre to centre.
  // At f(0.0125) the two bones leave a gap of about a third of their own width,
  // which is enough that the pair reads as two bones at prop size. Tried
  // f(0.008) first and the forearm went back to looking like a single tube with
  // a scratch down it.
  foreSplit: f(0.0125),

  // Scapula. It is the biggest single piece of the girdle and the previous
  // build lost it entirely from behind, so it is sized off the ribcage rather
  // than off the arm: about half the cage's height and a third of its width,
  // which is where a real one lands, and it is a PLATE laid on the back of the
  // cage rather than a fin parked beside the shoulder.
  scapW: f(0.066),
  scapH: f(0.080),
  scapT: f(0.0105),
  // Radians the blade is turned about the vertical so it lies along the curve
  // of the ribs instead of facing straight back. With the cage 0.435 wide and
  // 0.2875 deep, 0.60 keeps the medial border within about 0.015 of the rib
  // surface all the way along. Tried 0.35 and the medial border lifted off far
  // enough to see daylight under it from three-quarter behind.
  scapWrap: 0.60,
  scapTilt: -0.12,          // in-plane, drops the inferior angle toward the spine
  scapLean: 0.14,           // top edge leans in toward the cage
};

// The flare, split across the two segments. M.arm.flare is what the arm holds
// out from vertical overall, but the photo does not spend it evenly: the
// humerus leaves the glenoid at about one and a half times the flare and the
// forearm drops back to about half of it, and that difference is the whole
// reason the A-pose has a soft break at the elbow instead of reading as one
// straight splayed stick. Weighted by the two bone lengths these average back
// to M.arm.flare within a percent, so the metric still governs.
//
// Re-checked against the photo after M.arm.flare was corrected from 0.14 to
// 0.22: the humerus now lands at 0.33 rad against a measured 0.34 and the
// forearm at 0.11 against a measured 0.126, which puts the wrist 0.418 out from
// the centreline against a measured 0.414. The 1.5 / 0.5 split is carrying real
// shape rather than papering over a wrong metric, so it stays as it is.
const HUMERUS_FLARE = M.arm.flare * 1.5;
const FOREARM_FLARE = M.arm.flare * 0.5;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A closed outline through control points, resampled smooth. plate() takes a
// polygon, so a hand-authored bone outline has to be smoothed before it goes in
// or the blade comes out faceted.
function smoothLoop(pts, samples = 72) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map(([x, y]) => V(x, y, 0)), true, 'catmullrom', 0.5,
  );
  const out = [];
  for (let i = 0; i < samples; i++) {
    const p = curve.getPoint(i / samples);
    out.push(new THREE.Vector2(p.x, p.y));
  }
  return out;
}

// The scapula outline, in a frame where +X runs medially along the blade and
// +Y is up, with the lateral angle (the glenoid corner) at the origin.
// Counter-clockwise, because ExtrudeGeometry turns a clockwise outline's side
// walls inside out and they then vanish under a FrontSide material.
const SCAPULA = [
  [0.00, 0.00],   // lateral angle, the thick strut that carries the socket
  [0.12, -0.18],  // lateral (axillary) border
  [0.34, -0.44],
  [0.58, -0.63],
  [0.78, -0.72],  // inferior angle, tucked in near the vertebral border
  [0.95, -0.58],
  [1.02, -0.22],  // medial (vertebral) border, near vertical
  [1.02, 0.16],
  [0.94, 0.36],   // superior angle
  [0.56, 0.38],   // superior border
  [0.22, 0.27],
];

export function buildArm({ material, side }) {
  const sx = side === 'L' ? LEFT_X : -LEFT_X;

  const geos = [];
  const add = (geo, parent, name) => {
    geos.push(geo);
    const m = new THREE.Mesh(geo, material);
    if (name) m.name = `${name}${side}`;
    parent.add(m);
    return m;
  };

  const group = new THREE.Group();
  group.name = `arm${side}`;
  // Published for model.js to assert against the anchor it parents us onto:
  // sign(anchor.position.x) must equal this. When it did not, the arm flared
  // into the ribs and the clavicle ran away from the sternum, which is what the
  // first full assembly did before LEFT_X existed.
  group.userData.outwardX = sx;

  const HUM = M.arm.humerus;
  const FORE = M.arm.forearm;

  // Where the two hinges land. Both offsets are the flare, baked in.
  const elbowP = V(
    sx * Math.sin(HUMERUS_FLARE) * HUM,
    -Math.cos(HUMERUS_FLARE) * HUM,
    -f(0.005),                        // elbows sit a little behind the glenoid
  );
  const wristP = V(
    sx * Math.sin(FOREARM_FLARE) * FORE,
    -Math.cos(FOREARM_FLARE) * FORE,
    f(0.004),
  );

  // ------------------------------------------------------------------ girdle
  // The clavicle and the scapula belong to the torso, not to the swinging arm,
  // so they hang off `group` and not off the shoulder joint. Rotate the
  // shoulder and they stay put, which is what a shoulder girdle does.

  // Clavicle. An S, and it has to be an S: a straight rod from the sternum to
  // the shoulder reads as a coat hanger the moment you see the figure from
  // above or from three-quarter front. The medial two thirds bow forward, the
  // lateral third bows back, and the whole bone rises very slightly toward the
  // midline. The medial end is authored to reach the body's centre plane,
  // which from this frame is at -sx * half the shoulder separation.
  const midX = -sx * M.arm.shoulderSeparation / 2;
  const clavicle = [
    V(sx * f(0.015), f(0.021), -f(0.003)),                 // acromial end: exactly the acromion tip
    V(midX * 0.19, f(0.026), -f(0.001)),                   // bowing back
    V(midX * 0.54, f(0.025), f(0.024)),
    V(midX * 0.82, f(0.025), f(0.035)),                    // bowing forward
    V(midX + sx * f(0.007), f(0.026), f(0.037)),           // sternal end
  ];
  add(shaft(new THREE.CatmullRomCurve3(clavicle, false, 'catmullrom', 0.5), A.clavicleR, {
    endBias: 0.45,
  }), group, 'clavicle');
  add(jointBall(A.clavicleR * 1.15, { squash: 1 }), group, 'sternoclavicular')
    .position.copy(clavicle[4]);
  // The clavicle ends exactly on the tip of the acromion and one bulb caps
  // both. Two balls a few thousandths apart read as a bunch of grapes on the
  // top of the shoulder, which the photo very much does not have.
  add(jointBall(A.acromionR * 1.15, { squash: 1 }), group, 'acromioclavicular')
    .position.copy(clavicle[0]);

  // Scapula. Two nested holders rather than one Euler triple, because the wrap
  // and the in-plane tilt are two different ideas and combining them by hand in
  // one rotation is how the blade ends up floating off the ribs.
  //
  // `wrap` turns the blade about the vertical so its medial edge runs backward
  // toward the spine and its face lies along the ribs. The outline is authored
  // once with medial = +X and up = +Y and the two sides differ only by this
  // angle, so there is no mirroring anywhere and no reversed winding.
  //
  // One consequence to keep straight: because medial flips between the sides
  // and up does not, the plate's own +Z ends up posterior on the left and
  // anterior on the right. `post` is which way is out of the back for this
  // side, and anything that has to sit on the outer face goes through it.
  const post = sx;
  const scapWrap = new THREE.Object3D();
  scapWrap.position.set(-sx * f(0.009), -f(0.008), -f(0.016));
  scapWrap.rotation.y = sx > 0 ? Math.PI - A.scapWrap : A.scapWrap;
  group.add(scapWrap);

  const blade = new THREE.Object3D();
  blade.rotation.z = A.scapTilt;
  blade.rotation.x = -post * A.scapLean;
  scapWrap.add(blade);

  add(plate(
    smoothLoop(SCAPULA.map(([x, y]) => [x * A.scapW, y * A.scapH])),
    A.scapT,
    // A hard rim is the one thing that breaks the vinyl look fastest, and on a
    // bone this wide the rim is most of what you see from behind, so the bevel
    // is pushed almost to half the thickness and the blade becomes a lens.
    { bevel: 0.47 },
  ), blade, 'scapula');

  // Spine of the scapula: the ridge across the back of the blade that ends in
  // the acromion. It has to stay inside the outline, or its far end reads as a
  // spike sticking out of the shoulder from three-quarter behind, which is what
  // the first pass did.
  const spineA = V(A.scapW * 0.90, A.scapH * 0.02, post * A.scapT * 0.42);
  const spineB = V(A.scapW * 0.20, A.scapH * 0.19, post * A.scapT * 0.52);
  add(straightShaft(spineA, spineB, A.scapSpineR, { bowAxis: V(0, 0, post), bow: 0.05 }),
    blade, 'scapularSpine');
  // Both ends get a bulb. shaft() is a TubeGeometry and TubeGeometry has no end
  // caps, so a free shaft end is an open pipe you can see straight through, and
  // at three-quarter behind that reads as a chip out of the bone. Every free end
  // in this file is closed: these two, the two ends of the clavicle, and the tip
  // of the coracoid. Everything else terminates inside a joint bulb already.
  //
  // Two things decide whether a cap really covers the ring it is over, and both
  // bit this file once. First, the ball has to be BIGGER than the tube: the
  // argument to jointBall() is multiplied by M.jointBallScale, so a cap at
  // 0.72x the shaft radius is a ball smaller than the pipe it is meant to plug.
  // Second, jointBall squashes along Y by default, and a horizontal bone's end
  // ring stands up vertically, straight through the flattened axis. So every
  // cap on a bone that does not hang downward is unsquashed and at least
  // 1.05x its shaft. The near-vertical bones are safe either way: their rings
  // lie flat, where the ball is at its widest.
  add(jointBall(A.scapSpineR * 1.05, { squash: 1 }), blade, 'scapularSpineEnd')
    .position.copy(spineA);
  add(jointBall(A.acromionR * 1.15, { squash: 1 }), blade, 'acromialAngle')
    .position.copy(spineB);

  // The acromion carries on from the ridge and roofs the humeral head, and the
  // clavicle then lands on top of the acromion the way it really does. Authored
  // in group space because that is where the head is; its start is the ridge's
  // lateral end pushed out through the two holders.
  group.updateMatrixWorld(true);
  const acroStart = blade.localToWorld(spineB.clone());
  const acroEnd = V(sx * f(0.015), f(0.021), -f(0.003));
  add(shaft(new THREE.QuadraticBezierCurve3(
    acroStart,
    V((acroStart.x + acroEnd.x) / 2, f(0.028), (acroStart.z + acroEnd.z) / 2),
    acroEnd,
  ), A.acromionR, { endBias: 0.55 }), group, 'acromion');

  // Coracoid: the little forward hook in front of the joint. Small, but its
  // absence is felt from three-quarter front, where the space between the
  // clavicle and the humeral head otherwise reads as a hole.
  add(shaft(new THREE.QuadraticBezierCurve3(
    V(-sx * f(0.014), -f(0.002), f(0.002)),   // buried inside the glenoid bulb
    V(-sx * f(0.014), f(0.006), f(0.016)),
    V(-sx * f(0.005), f(0.005), f(0.030)),
  ), A.coracoidR, { endBias: 0.6 }), group, 'coracoid');
  add(jointBall(A.coracoidR * 1.15, { squash: 1 }), group, 'coracoidTip')
    .position.set(-sx * f(0.005), f(0.005), f(0.030));

  // The socket itself, a static bulb just medial to the head. It exists so the
  // joint cannot open: whatever the shoulder does, there is bone filling the
  // space the humeral head rotates in.
  add(jointBall(A.glenoidBulb), group, 'glenoid')
    .position.set(-sx * f(0.013), -f(0.001), -f(0.003));

  // ----------------------------------------------------------------- humerus
  const shoulder = new THREE.Object3D();
  shoulder.name = `shoulder${side}`;
  group.add(shoulder);              // at the glenoid, identity, pivot in the bulb

  const humerusDir = elbowP.clone().normalize();

  // The head. Its centre is the pivot, so no rotation of the shoulder can slide
  // it off the socket.
  add(jointBall(A.shoulderBulb, { squash: 0.9, axis: humerusDir }), shoulder, 'humeralHead');
  // Greater tubercle, the small lump lateral to the head that stops the
  // shoulder reading as a bearing ball on a stick.
  add(jointBall(A.shoulderBulb * 0.30), shoulder, 'greaterTubercle')
    .position.set(sx * f(0.012), f(0.010), -f(0.007));

  // The shaft bows laterally by about 3% of its length at mid, measured off the
  // photo: the bone leaves the head steeply and straightens as it drops, and
  // that slight outward belly is most of what makes an upper arm look drawn
  // rather than extruded.
  add(straightShaft(V(0, 0, 0), elbowP, A.humerusR, {
    bow: 0.030,
    bowAxis: V(sx, 0, 0),
    endBias: 0.42,
  }), shoulder, 'humerus');

  // Distal condyle. It belongs to the humerus, so it lives on the shoulder side
  // of the elbow hinge and the forearm rotates inside it.
  add(jointBall(A.elbowBulb, { squash: 0.86 }), shoulder, 'humeralCondyle')
    .position.copy(elbowP);
  // The epicondyles only widen the condyle, they are not lumps of their own.
  // At 0.62 and f(0.011) out they read as a bunch of grapes hanging off the
  // elbow; the photo has one wide bulb with a slight waist across it.
  add(jointBall(A.elbowBulb * 0.52), shoulder, 'lateralEpicondyle')
    .position.copy(elbowP).add(V(sx * f(0.0085), f(0.003), 0));
  add(jointBall(A.elbowBulb * 0.45), shoulder, 'medialEpicondyle')
    .position.copy(elbowP).add(V(-sx * f(0.0085), f(0.002), 0));

  // -------------------------------------------------------- radius and ulna
  const elbow = new THREE.Object3D();
  elbow.name = `elbow${side}`;
  elbow.position.copy(elbowP);
  shoulder.add(elbow);

  const split = A.foreSplit;

  // The two bones separate mostly sideways rather than front-to-back. Strictly
  // a hand hanging pronated puts the radius in front of the ulna, but the photo
  // shows the split as a groove straight down the front of the forearm, and a
  // pair that separates in Z is a pair you cannot see in the view the figure is
  // usually shot from. They get a little Z as well so the gap survives the side
  // view too.
  //
  // The ulna owns the elbow and the radius owns the wrist, which is both true
  // and useful: each bone converges to the joint it forms, so the pair crosses
  // through a lens-shaped gap in the middle and neither one leaves a stub
  // poking out of a bulb.
  const ulna = [
    V(0, 0, -f(0.0015)),
    V(-sx * split * 0.52, -FORE * 0.34, -f(0.0045)),
    V(-sx * split * 0.44, -FORE * 0.72, -f(0.0040)),
    wristP.clone().add(V(-sx * f(0.0055), f(0.004), -f(0.0030))),
  ];
  add(shaft(new THREE.CatmullRomCurve3(ulna, false, 'catmullrom', 0.5), A.forearmR, {
    endBias: 0.45,
  }), elbow, 'ulna');

  const radius = [
    V(sx * f(0.013), -FORE * 0.05, f(0.0055)),
    V(sx * split * 0.54, -FORE * 0.38, f(0.0050)),
    V(sx * split * 0.34, -FORE * 0.74, f(0.0040)),
    wristP.clone(),
  ];
  add(shaft(new THREE.CatmullRomCurve3(radius, false, 'catmullrom', 0.5), A.forearmR, {
    endBias: 0.45,
  }), elbow, 'radius');

  // Olecranon and radial head, the two lumps that make the elbow read as a
  // hinge from behind rather than as a bead.
  add(jointBall(A.olecranonBulb * 0.82), elbow, 'olecranon')
    .position.set(-sx * f(0.002), f(0.009), -f(0.013));
  add(jointBall(A.radialHeadBulb), elbow, 'radialHead')
    .position.copy(radius[0]);
  // Ulnar styloid: the ulna does not reach the carpals, it stops just short and
  // beside them, and this bulb is what closes that end so nothing frays.
  add(jointBall(A.styloidBulb * 1.15), elbow, 'ulnarStyloid')
    .position.copy(ulna[3]);
  // The distal radius is the wrist's other half: it is the bulb the carpal
  // block turns inside, and it stays on the forearm side of the hinge so that
  // no rotation of the wrist can open a seam there.
  add(jointBall(A.styloidBulb * 1.55), elbow, 'distalRadius')
    .position.copy(wristP);

  // -------------------------------------------------------------------- hand
  const wrist = new THREE.Object3D();
  wrist.name = `wrist${side}`;
  wrist.position.copy(wristP);
  elbow.add(wrist);

  // Hand frame, inside the wrist node: -Y down the fingers, X across the
  // knuckles, Z the palm's normal. The arm hangs pronated, so the palm faces
  // back (-Z) and the thumb points medially (-sx), which is what the photo
  // shows: four digits spread across the frame and the thumb tucked toward the
  // thigh.
  const shed = new Map();

  // Carpal block. The eight carpals are allowed to be one rounded block, and
  // this is a squashed jointBall rather than a plate. plate() was the obvious
  // pick and it looked right from the front, but a bone this small needs a
  // bevel almost as deep as its own half-height, and at that point the extruder
  // collapses the flat face to a sliver: edge on, the wrist came out as a
  // faceted box with a hard cliff along the top. A scaled ball is smooth from
  // every angle, which is the whole point of the house look, and a rounded
  // block is what a squashed ball is.
  const carpals = jointBall(h(0.105), { squash: 1 });
  carpals.scale(1.0, 0.83, 0.76);       // wide across the hand, shallow front to back
  add(carpals, wrist, 'carpals').position.set(0, -h(0.045), 0);

  // The digits are stubby on purpose. The photo's hands are small blunt mitts:
  // the longest finger is under half the hand and every segment is barely twice
  // its own width. The first pass used the vocabulary's default waist and full
  // size joint bulbs and got a chain of beads on a thread, so the phalanges
  // carry a much shallower waist than the long bones do and their knuckles are
  // deliberately undersized.
  const FINGER_R = h(0.052);
  const META_R = h(0.058);
  const PHALANX_WAIST = 0.85;       // vs M.shaftWaist 0.62 on the long bones
  const KNUCKLE = 0.86;             // jointBall argument, as a fraction of the shaft

  // Builds one digit as a self-contained group whose origin is the knuckle, so
  // it can be reparented straight to the scene and still be where it looked
  // like it was. Segments curl a little further toward the palm as they go,
  // which is what stops a finger reading as a radio aerial.
  function digit(lengths, radius, curls) {
    const g = new THREE.Group();
    let p = V(0, 0, 0);
    let ang = 0;
    // A ball at the origin, hidden inside the knuckle it hangs off. It is what
    // caps the digit when the digit is dropped on the floor by itself.
    add(jointBall(radius * KNUCKLE), g, 'phalanxBase');
    for (let i = 0; i < lengths.length; i++) {
      ang += curls[i];
      const r = radius * (1 - 0.10 * i);
      const q = p.clone().add(V(0, -Math.cos(ang), -Math.sin(ang)).multiplyScalar(lengths[i]));
      add(straightShaft(p, q, r, { waist: PHALANX_WAIST }), g, 'phalanx');
      // Interphalangeal bulb, or the rounded tip on the last one. The tip
      // takes no squash: jointBall's default flattens along Y, which on a
      // fingertip pointing down is a bone with the end sawn off.
      const last = i === lengths.length - 1;
      add(jointBall(r * (last ? KNUCKLE * 0.96 : KNUCKLE), last ? { squash: 1 } : {}), g, 'knuckle')
        .position.copy(q);
      p = q;
    }
    return g;
  }

  // Index, middle, ring, little, ordered outward from the thumb side.
  const FINGERS = [
    { name: 1, total: h(0.425), x: -3, y: h(0.450), splay: -0.09 },
    { name: 2, total: h(0.455), x: -1, y: h(0.462), splay: -0.03 },
    { name: 3, total: h(0.415), x: 1, y: h(0.456), splay: 0.03 },
    { name: 4, total: h(0.345), x: 3, y: h(0.424), splay: 0.09 },
  ];
  const SPLIT = [0.42, 0.33, 0.25];
  const STEP = h(0.060);            // half the gap between neighbouring knuckles

  for (const fg of FINGERS) {
    const kx = sx * fg.x * STEP;
    const knuckle = V(kx, -fg.y, h(0.018));
    const base = V(kx * 0.30, -h(0.090), 0);   // well inside the carpal block

    // Metacarpal, bowing toward the back of the hand so the palm is hollow.
    add(straightShaft(base, knuckle, META_R, {
      bow: 0.06, bowAxis: V(0, 0, 1), waist: 0.80,
    }), wrist, `metacarpal${fg.name}`);
    // The knuckle bulb stays with the metacarpal. Shed the finger and this is
    // the rounded stub that is left, rather than an open pipe.
    add(jointBall(META_R * 0.92), wrist, `metacarpalHead${fg.name}`).position.copy(knuckle);

    const g = digit(SPLIT.map((t) => fg.total * t), FINGER_R, [0.12, 0.20, 0.18]);
    g.name = `finger${side}${fg.name}`;
    g.position.copy(knuckle);
    g.rotation.z = sx * fg.splay;
    wrist.add(g);
    shed.set(`finger${side}${fg.name}`, g);
  }

  // Thumb. Two phalanges, on a metacarpal that swings medially and toward the
  // palm rather than lying in the row with the others.
  const thumbBase = V(-sx * h(0.055), -h(0.050), -h(0.020));
  const thumbKnuckle = V(-sx * h(0.235), -h(0.265), -h(0.085));
  add(straightShaft(thumbBase, thumbKnuckle, META_R * 1.06, { waist: 0.80 }), wrist, 'metacarpal0');
  add(jointBall(META_R * 0.98), wrist, 'metacarpalHead0').position.copy(thumbKnuckle);

  const thumb = digit([h(0.155), h(0.125)], FINGER_R * 1.08, [0.16, 0.20]);
  thumb.name = `thumb${side}`;
  thumb.position.copy(thumbKnuckle);
  thumb.quaternion.setFromUnitVectors(
    V(0, -1, 0),
    thumbKnuckle.clone().sub(thumbBase).normalize(),
  );
  wrist.add(thumb);

  return {
    group,
    joints: { shoulder, elbow, wrist },
    shed,
    dispose() {
      for (const g of geos) g.dispose();
      geos.length = 0;
    },
  };
}

export default buildArm;
