import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText } from '../tombstones.js';

// A pillow marker: the low wedge that lies at the head of a grave with its
// inscribed face tipped up toward whoever is standing over it. It is the
// quietest marker a cemetery has, and at about 0.48 it is by a wide margin the
// shortest thing in this set. The floor before it was bench and book at 0.81.
//
// That is the reason it exists. Twenty-nine pieces of which most stand between
// 1.0 and 1.9 make a level that reads as a forest of uprights, and a layout
// generator has nothing it can put in the FRONT row without hiding something.
// This is that piece: low enough to stand in front of anything, wide enough to
// read as a marker rather than as a chip of debris, and quiet enough that a row
// of uprights behind it still carries the frame.
//
// Being low is also the whole difficulty, and it comes in exactly two parts.
//
// --- 1. the slope ----------------------------------------------------------
//
// The scene camera is orthographic at CAM_DIR (1, 0.78, 1), which is 45 degrees
// round in plan and 28.9 degrees up, and a prop is placed at yaw PI/4, so in
// this stone's own frame the camera sits along (0, sin 29, cos 29). A face
// whose normal is n presents n . that, so a horizontal face reads at 0.483 of
// its true size and a face tipped by alpha toward the viewer reads at
// sin(29 + alpha). Flat on the ground the inscription is halved; the question
// is what alpha buys back.
//
//   alpha    0     10     15     20     22     25     30     45     61
//   factor  0.483  0.628  0.695  0.755  0.777  0.809  0.857  0.961  1.000
//
// The factor is still climbing at 61 degrees, where the face is square on to
// the camera, so the maximum is not what picks the number: a face at 61 degrees
// is a leaning headstone and this piece stops being a pillow long before that.
// What picks it is the height budget. The rise across the marker is
// depth * tan(alpha), the front lip has to stay a real lip rather than a knife
// edge, and the back may not go over about 0.5 or the piece is just a small
// stone standing up. At the 0.66 depth below, alpha 22 lifts the back by 0.265
// over a 0.17 front lip and lands the top at 0.48; alpha 30 would want 0.38 of
// rise and a 0.55 back with the front already at its minimum, and at that point
// the side profile is a ramp.
//
// So 21.9 degrees, TILT below, and the payoff is not only area. A letter on
// this face is unforeshortened across its width and squashed to sin(50.9) =
// 0.777 up the slope. The set's upright stones are seen at cos(29) = 0.875, so
// a letter here is squashed by 0.89 relative to one on FRED, which is close
// enough that the lettering needs no pre-stretch to look like the set's. Laid
// flat it would have been 0.55 of FRED and every glyph would have had to be
// drawn a third taller than it wanted to be.
//
// --- 2. the modelling ------------------------------------------------------
//
// A low object has almost no silhouette, so everything it has to say it says
// through shading and through the shadow it throws. A flat wedge says nothing
// and reads as a stain on the ground, which is the failure the ground props'
// README warns about and the one the set's rejected contact patches actually
// were. So the piece is built to carry four tonal steps rather than one:
//
//   the rolled front lip, 0.17 tall and mostly rim radius, so the bottom of the
//   silhouette is a bead catching the key light rather than a cut-off;
//   the sloped top of the pad, the brightest plane on the piece;
//   a flat ledge of pad left showing around the tablet on all four sides;
//   the tablet itself, standing 0.105 proud with its own fat bead, which throws
//   a real shadow across that ledge on the two sides away from the key.
//
// Everything above is geometry. The lettering is the fifth step and the
// smallest, and at the shipped framing it is the first to go: this stone is
// about 30 by 25 pixels there, so what a player reads is a light-topped wedge
// with a dark line under its front lip and a shadow beside it.

// --- proportions -----------------------------------------------------------
//
// Plan is 0.98 by 0.66, which makes the footprint radius 0.591: the widest
// horizontal half-extent, half the diagonal of the pad, and the number a layout
// generator wants. Wide and low on purpose. The postmortem's rule that
// low-and-wide reads as debris is about markers competing with markers, and
// bench.js already argued the exception; this piece is not competing with the
// uprights, it is the thing they are read against, and a narrow pillow would
// read as a dropped brick.
const PAD_HALF_X = 0.51; // half the width, across the grave
const PAD_DEPTH = 0.66; // front to back on the ground
const PAD_TOP_Y = 0.30; // the sloped top plane, at the middle of the pad
const PAD_FLARE = 0.03; // bottom a little longer than the top, so it sits
const PAD_SINK = 0.03; // bottom edge carried under the floor
const MIN_SINK = 0.018; // ...and never less than this once it is measured
const PAD_E = 0.062; // the house rim radius, and a hard floor
// Corner radii of the side profile, counter-clockwise from the back foot. The
// front pair is the rolled edge, and it is the one number on the pad that was
// tuned rather than chosen: the front face is only 0.16 tall, so radii of 0.075
// and 0.09 leave about 25mm of flat between them and the whole lip comes out a
// roll rather than a bevelled kerb. Squared off at 0.09 all round the piece
// read as a keycap, which is the first thing the render showed.
const PAD_R = [0.075, 0.075, 0.090, 0.085];

// The tablet, which is also the registry's own slab and the only surface that
// carries the inscription. 0.84 by 0.36 gives a 2389 x 1024 face: a wide
// letterbox, wider than bench.js's 2253 and the widest in the set, which is
// what a marker read across its width rather than up its height wants.
//
// It sits well inside the pad on every side: 0.09 of ledge across, and about
// 0.18 of sloped apron up and down the slope. The first pass had it 0.105 in
// and nearly as wide as the pad, and the ledge came out as a moulded seam
// rather than as a step. A step is one of the four tonal breaks this piece has,
// so it has to be wide enough to hold a shadow.
const PW = 0.42; // half the tablet's width
const PH = 0.36; // its run up the slope, foot to head
const PT = 0.15; // its thickness. Under 2 * PAD_E the sweep folds, so this is
const PR = 0.13; // near the floor already; the corner radius is generous.
// How far the tablet's underside sits inside the pad. It buys two things: no
// crack can open along the joint on any seed, and the bead on the tablet's
// underside is mostly hidden, so the step reads as a tablet standing on a ledge
// rather than as a biscuit resting on one. What is left proud is 0.105, which
// is the full top bead plus a sliver of undercut.
const BURY = 0.045;
// The tablet set a little up the slope, so the apron below it is wider than the
// one above. That is where the margin goes on a real slant marker, and here it
// also keeps the lettering off the part of the face nearest the ground.
const TAB_SHIFT = 0.025;

// The slope. TILT is what the pad and the tablet are both built at; the
// registry's own per-seed lean then adds rotation.x of -0.012 to -0.032 to the
// whole body, which tips this piece AWAY from the camera and takes that much
// straight off the slope. So TILT carries the mean of it, 0.022, and the
// effective slope comes out 21.3 to 22.5 degrees across seeds. Pad and tablet
// lean together, so the joint between them cannot open however the lean falls.
const TILT = 0.404;

// Lowest point of a geometry once its matrix is applied, walked vertex by
// vertex. Box3.setFromObject would grow the local box by the rotation and hand
// back a tumbling cube's corner, which on a pad that is a sweep turned a
// quarter turn about y is wrong by most of its own width.
function lowestVertex(geometry, matrix) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    if (v.y < min) min = v.y;
  }
  return min;
}

// A convex polygon rounded to radius r, as the arc chain buildArcSweepGeometry
// wants. Points counter-clockwise. Each corner becomes one circle inscribed in
// the angle and the straight runs between them fall out of the sweep for free.
// Lifted from book.js, which is the third stone to need it; see the note at the
// bottom of this file.
function roundedOutline(points, radii) {
  const n = points.length;
  return points.map((P, i) => {
    const r = Array.isArray(radii) ? radii[i] : radii;
    const A = points[(i - 1 + n) % n];
    const B = points[(i + 1) % n];
    const la = Math.hypot(A[0] - P[0], A[1] - P[1]);
    const lb = Math.hypot(B[0] - P[0], B[1] - P[1]);
    const ux = (A[0] - P[0]) / la;
    const uy = (A[1] - P[1]) / la;
    const vx = (B[0] - P[0]) / lb;
    const vy = (B[1] - P[1]) / lb;
    const wx = ux + vx;
    const wy = uy + vy;
    const lw = Math.hypot(wx, wy);
    const cosHalf = lw / 2;
    const sinHalf = Math.sqrt(Math.max(1e-6, 1 - cosHalf * cosHalf));
    const d = r / sinHalf;
    let a0 = Math.atan2(ux, -uy);
    let a1 = Math.atan2(-vx, vy);
    while (a1 < a0) a1 += Math.PI * 2;
    return { cx: P[0] + (wx / lw) * d, cy: P[1] + (wy / lw) * d, r, a0, a1, sign: 1 };
  });
}

// The pad's side profile, in (z, y) of the body frame, counter-clockwise from
// the back foot. The sweep then lies along x, which is the axis this shape is
// constant on: a bolster is the same wedge everywhere across its width.
//
// Built as a sweep rather than as a rotated slab for the reason book.js gives.
// A slab tilted 22 degrees and set on the floor touches it along one edge and
// leaves the other end of its underside 0.25 in the air, so it has to be buried
// at one end to hide its own footprint. This piece is SET, not sunk: the ground
// line runs level all the way round it.
function padOutline() {
  const halfZ = PAD_DEPTH / 2;
  const rise = halfZ * Math.tan(TILT); // half the rise across the pad
  return roundedOutline(
    [
      [-halfZ - PAD_FLARE, -PAD_SINK], // back foot
      [halfZ + PAD_FLARE, -PAD_SINK], // front foot
      [halfZ, PAD_TOP_Y - rise], // front lip, 0.16 up
      [-halfZ, PAD_TOP_Y + rise], // back edge, 0.44 up
    ],
    PAD_R,
  );
}

// --- the inscription -------------------------------------------------------
//
// One word, and the argument for one word is arithmetic rather than taste. The
// face is 2389 by 1024, which is 0.84 by 0.36 in world units and a third of the
// area of FRED's. Two lines of the set's own lettering on it measured 10.5 per
// cent of the canvas: the same absolute area of ink as FRED carries, 0.044
// square units, on a face that is a third the size, and the render showed
// exactly what that arithmetic predicts, a keycap with a label on it. One line
// halves it.
//
// So: ASLEEP, caps at 0.100 in world units against FRED's 0.094 and the
// approved cross's 0.120, which is the middle of the set's band. The slope is
// what makes that affordable. On screen these caps read 0.100 * sin(50.9) =
// 0.078 tall, and FRED's, on a vertical face seen at 29 degrees, read
// 0.094 * cos(29) = 0.082. Same letters, same apparent size, no pre-stretch.
// Laid flat the same cap would have read 0.048 and had to be drawn half again
// as tall to survive, which is the trade ledger.js had to make.
//
// Measured coverage is reported two ways on purpose, because the brief's 3 to 5
// per cent band is calibrated on roughly square faces and this one is a 2.33:1
// letterbox. Canvas fraction and letter height are both in the report; the
// letter height is the number this was designed to.
//
// ASLEEP rather than anything else the set might say. bench.js has REST AWHILE
// and book.js has SLEEP WELL, so the two obvious ones are gone, and a pillow is
// the one marker in a graveyard whose shape is already the word.
function drawPillowInscription(ctx, w, h) {
  const size = h * 0.421; // 0.100 in world, measured off the artwork not the em
  inkText(ctx, 'ASLEEP', w / 2, h * 0.50, size, size * 0.06);
}

registerStone('pillow', {
  // halfWidth, height and depth are the TABLET, which is the registry's slab
  // and the piece this stone actually keeps. The plinth is thrown away in
  // extras and only has to be a real height while it exists, or its own corner
  // circles overlap and the sweep folds through itself.
  shape: { halfWidth: PW, height: PH, depth: PT, plinth: 0.12 },
  // A tablet, not an arch: both radii set and set the same. Generous, because
  // the tablet is the one part of this piece the eye can see the outline of,
  // and a hard-cornered rectangle lying on a wedge reads as a paving slab.
  topRadius: PR,
  bottomRadius: PR,

  draw: drawPillowInscription,

  extras({ body, slab, plinth, material, rng, disposables, stripUV }) {
    // The registry's plinth goes. A pillow is not set on a pad within a pad,
    // and a flat-topped bar under something this low would be most of the
    // piece. dispose() still owns its geometry, so nothing leaks.
    if (plinth) body.remove(plinth);

    // Everything this stone owns hangs off one group, so the seating measured
    // at the end moves the whole piece rather than each mesh in turn.
    const piece = new THREE.Group();
    body.add(piece);
    body.remove(slab);
    piece.add(slab);

    // --- the pad -------------------------------------------------------------
    const padGeo = buildArcSweepGeometry({
      outline: padOutline(),
      depth: PAD_HALF_X * 2,
      edge: PAD_E,
      // Plain stone, parked in the texture's clean strip. v runs from the foot
      // of the profile to its top through the grime band the registry's own
      // plinth uses, so the pad's ground line is dirty and its sloped top is
      // not, and it cannot read as a whiter material than the tablet on it.
      uv: (x, y) => stripUV(x, y + PAD_SINK, PAD_DEPTH / 2 + PAD_FLARE, (PAD_TOP_Y + PAD_SINK) * 1.6, 0.34),
    });
    const pad = new THREE.Mesh(padGeo, material);
    // Built in the (z, y) plane and swept along its own z; a quarter turn puts
    // the sweep across the width and the profile front to back.
    pad.rotation.y = -Math.PI / 2;
    pad.castShadow = true;
    pad.receiveShadow = true;
    disposables.push(padGeo);
    piece.add(pad);

    // --- the tablet ----------------------------------------------------------
    //
    // The registry built it standing up. Rotating -PI/2 about x lays it face up
    // and sends the top of the inscription away from the camera, which is how a
    // marker on the ground is read, from its foot; the tilt then brings the
    // face back toward the viewer by the angle the note at the top argues for.
    //
    // Per seed, a hair more tilt and never less, so a casting can only ever be
    // more legible than the one the slope was measured on. It is small: the
    // pad's top is built at the nominal TILT, so anything the tablet takes on
    // top of that opens a wedge of daylight under its head, and past about a
    // degree that is visible as a lifted corner rather than as a settled stone.
    const tilt = TILT + rng() * 0.018;
    slab.rotation.set(-Math.PI / 2 + tilt, 0, 0);
    // Centre of the tablet: the middle of the pad's top plane, pushed out along
    // that plane's normal by what is left of the tablet's half thickness once
    // it is buried. Its own tilt, not the nominal one, or the jitter walks the
    // tablet a few millimetres off the middle of the ledge.
    const out = PT / 2 - BURY;
    const tnY = Math.cos(tilt);
    const tnZ = Math.sin(tilt);
    const up = PH / 2 - TAB_SHIFT; // along the slope, from the pad's middle
    slab.position.set(
      0,
      PAD_TOP_Y + out * tnY - up * tnZ,
      out * tnZ + up * tnY,
    );

    // --- seating -------------------------------------------------------------
    //
    // Checked rather than assumed, and checked on the pad's own vertices under
    // its own matrix: the pad is a sweep turned a quarter turn, so
    // Box3.setFromObject would grow its local box by the rotation and report a
    // depth that is really its width. The bottom bead is meant to run under the
    // floor, so no seed can leave a corner of a piece this low hovering, which
    // on something 0.48 tall would be the whole read. The registry's lean is
    // applied after this and can lift a far corner by about 0.016 on the
    // extremes of its range; its own 0.012 sink covers most of that and
    // MIN_SINK covers the rest.
    pad.updateMatrix();
    const low = lowestVertex(padGeo, pad.matrix);
    if (low > -MIN_SINK) piece.position.y = -MIN_SINK - low;

    // No displaced earth and no contact patch. tombstones.js and ledger.js both
    // record why at length, and this piece is the one most tempted by it: a
    // patch laid flat on the floor is the same on the lit side as on the shaded
    // one, so it rings the prop with a halo no shadow has, and next to a marker
    // this low the halo would be bigger than the marker. The key light throws a
    // real shadow off the back lip and that is the only one this has.
  },
});

// Two things this stone had to copy rather than call. `roundedOutline` is now
// in book.js and here, and `lowestVertex` is in book.js, ledger.js and here;
// cairn.js, boulder.js and calvary.js all carry the same warning about
// Box3.setFromObject in comments and their own walk beside it. Both are
// generic, both are exactly the kind of thing the registry already exports
// buildArcSweepGeometry for, and neither is a stone's own business. They belong
// in tombstones.js beside it.
