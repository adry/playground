import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText } from '../tombstones.js';

// A pillow marker: the low wedge that lies at the head of a grave with its
// inscribed face tipped up toward whoever is standing over it. It is the
// quietest marker a cemetery has, and at 0.43 to 0.46 depending on the seed it
// is by a wide margin the shortest thing in this set. The floor before it was
// bench and book at 0.81, and the next thing up from those is FRED at 1.10.
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
// edge, and the back may not go over about 0.5 or the piece is a small stone
// standing up rather than a marker lying down. At the 0.60 depth below, alpha
// 22 lifts the back to 0.44 over a 0.19 front lip; alpha 30 on the same plan
// wants 0.35 of rise, which puts the back at 0.53 with the front lip already
// down to 0.18, and at that point the side profile is a ramp and the front lip
// is too thin to roll. Going the other way, alpha 15 gives back a lip of 0.23
// and a back of 0.40 and costs 12 per cent of the face.
//
// So 21.9 degrees, and the payoff is not only area. A letter on this face is
// unforeshortened across its width and squashed to sin(50.9) = 0.775 up the
// slope. The set's upright stones are seen at cos(29) = 0.875, so a letter here
// is squashed by 0.89 relative to one on FRED, which is close enough that the
// lettering needs no pre-stretch to look like the set's. Laid flat it would
// have been 0.55 of FRED and every glyph would have had to be drawn half again
// as tall, which is the trade ledger.js had to make on a face that had no
// choice about pointing at the sky.
//
// --- 2. the modelling ------------------------------------------------------
//
// A low object has almost no silhouette, so everything it has to say it says
// through shading and through the shadow it throws. A flat wedge says nothing
// and reads as a stain on the ground, which is the failure the ground props'
// README warns about and the one the set's rejected contact patches actually
// were. So the piece is built to carry four tonal steps rather than one:
//
//   the rolled front lip, 0.19 tall and almost all of it rim radius, so the
//   bottom of the silhouette is a bead turning through the light rather than a
//   cut-off, and the ground line under it is the darkest thing on the piece;
//   the sloped top of the pad, the brightest plane on it, and the 0.14 apron of
//   that plane left showing in front of and behind the tablet;
//   the tablet's own bead, standing 0.085 proud, which is a highlight all the
//   way round it and a cast shadow on the two sides away from the key;
//   the tablet's face, tipped a further 22 degrees into the light.
//
// Everything above is geometry. The lettering is the fifth step and the
// smallest, and at the shipped framing it is the first to go: this stone is
// about 30 by 20 pixels at view 6.2, so what a player reads there is a
// light-topped wedge with a dark line under its front lip and a shadow beside
// it. That is the whole test this piece had to pass, and out/pillow/yard62-0.png
// is where it was checked.
//
// The other route was built and rejected rather than argued away. A tasselled
// cushion, a plump lozenge with a fat bead, four corner knobs and buttoned
// dimples carved into the face, stood beside this one at 300x400 and read as a
// beanbag with feet: the knobs became castors, the dimples vanished, and the
// bead swallowed the step that tells the eye which way the face points. The
// bolster keeps the one thing the cushion loses, a hard horizontal at the
// bottom of the silhouette, and at 30 pixels that horizontal is the marker.

// --- proportions -----------------------------------------------------------
//
// Plan is 1.02 by 0.60 nominal, which makes the FOOTPRINT RADIUS 0.592: the
// widest horizontal half-extent, half the diagonal of the pad, and the number a
// layout generator wants off this piece. The per-seed jitter below moves it
// between 0.568 and 0.597, so 0.60 is the figure to reserve.
//
// Wide and low on purpose. The postmortem's rule that
// low-and-wide reads as debris is about markers competing with markers, and
// bench.js already argued the exception; this piece is not competing with the
// uprights, it is the thing they are read against, and a narrow pillow would
// read as a dropped brick.
const PAD_HALF_X = 0.51; // half the width, across the grave
const PAD_DEPTH = 0.60; // front to back on the ground
const PAD_TOP_Y = 0.315; // the sloped top plane, at the middle of the pad
const PAD_FLARE = 0.03; // bottom a little longer than the top, so it sits
const PAD_SINK = 0.03; // bottom edge carried under the floor
const MIN_SINK = 0.018; // ...and never less than this once it is measured
const PAD_E = 0.062; // the house rim radius, and a hard floor
// Corner radii of the side profile, counter-clockwise from the back foot. The
// front pair is the rolled edge, and it is the one number on the pad that was
// tuned rather than chosen: the front face is only 0.19 tall, so radii of 0.075
// and 0.09 leave about 25mm of flat between them and the whole lip comes out a
// roll rather than a bevelled kerb. At 0.09 all round, with the pad half again
// as deep, the first render came back a keycap.
const PAD_R = [0.075, 0.075, 0.090, 0.085];

// The tablet, which is also the registry's own slab and the only surface that
// carries the inscription. 0.88 by 0.38 gives a 2371 x 1024 face: a wide
// letterbox, wider than bench.js's 2253 and the widest in the set, which is
// what a marker read across its width rather than up its height wants.
//
// Across the pad it is nearly flush. The pad's flat top ends 0.062 inside its
// silhouette, at 0.448, and the tablet's silhouette is at 0.44, so what shows
// at the sides is the pad's rolled shoulder and not a ledge. Up and down the
// slope it leaves 0.136 of apron at each end, and that number was raised twice:
// the first pass left 0.105 and the step read as a moulded seam rather than as
// a step, which is a tonal break lost on a piece that only has four.
const PW = 0.44; // half the tablet's width
const PH = 0.38; // its run up the slope, foot to head
const PT = 0.15; // its thickness. Under 2 * PAD_E the sweep folds, so this is
// near the floor already. The corner radius is deliberately TIGHT, and it is
// the second thing the render sent back: a softly rounded tablet on a softly
// rounded pad is two nested lozenges and reads as a keycap. Crisp corners on
// the tablet against the pad's rolled lip is the contrast the piece needs, and
// it is also the honest one, since the tablet is the dressed face and the pad
// is the bolster.
const PR = 0.075;
// How far the tablet's underside sits inside the pad. It buys two things: no
// crack can open along the joint on any seed, and the bead on the tablet's
// underside is mostly hidden, so the step reads as a tablet standing on a bed
// rather than as a biscuit resting on one. What is left proud is 0.085, which
// is the full top bead plus a sliver of side wall.
const BURY = 0.065;
// Where the tablet's centre sits in the pad's top plane, measured up the slope
// from the middle of the pad. Zero, i.e. centred, and it was tried both ways:
// pushed up the slope the apron in front grows into an empty plate and the
// piece goes back to reading as a button on a lid, and pushed down it leaves a
// shelf behind the head of the inscription that nothing stands on.
const TAB_SHIFT = 0.0;

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
function padOutline(topY, depth) {
  const halfZ = depth / 2;
  const rise = halfZ * Math.tan(TILT); // half the rise across the pad
  return roundedOutline(
    [
      [-halfZ - PAD_FLARE, -PAD_SINK], // back foot
      [halfZ + PAD_FLARE, -PAD_SINK], // front foot
      [halfZ, topY - rise], // front lip, about 0.19 up
      [-halfZ, topY + rise], // back edge, about 0.44 up
    ],
    PAD_R,
  );
}

// --- the inscription -------------------------------------------------------
//
// One word, and the argument for one word is arithmetic rather than taste. The
// face is 2371 by 1024, which is 0.88 by 0.38 in world units, and 0.334 square
// units against FRED's 0.703: less than half the area. Two lines of the set's
// own lettering on it measured 10.5 per cent of the canvas, which is the same
// absolute area of ink FRED carries, 0.044 square units, on a face half the
// size. The render showed exactly what that arithmetic predicts: a keycap with
// a label on it. One line at 6.2 per cent is 0.021 square units, half of FRED's
// ink on half of FRED's face, and it reads as a carving again.
//
// So: ASLEEP, caps measured off the artwork at 0.096 in world units, against
// FRED's 0.094 and the approved cross's R.I.P. at 0.120. The middle of the
// set's own band, and the slope is what makes it affordable. On screen these
// caps read 0.096 * sin(50.9) = 0.075 tall, and FRED's, on a vertical face seen
// at 29 degrees, read 0.094 * cos(29) = 0.082, so this is nine per cent under
// the set's smallest lettering rather than the forty-five per cent under it
// would have been lying flat.
//
// Two coverage numbers are reported rather than one, because the 3 to 5 per
// cent band is calibrated on roughly square faces and this one is a 2.31:1
// letterbox where the same cluster of letters covers proportionally more.
// 6.2 per cent of the canvas, box 66 per cent of the face wide by 25 per cent
// tall. The wide half of that box is the letterbox, not the lettering: in world
// units the cluster is 0.58 by 0.096, which is smaller than FRED's 0.36 by 0.42
// block in every way that costs.
//
// ASLEEP rather than anything else the set might say. bench.js has REST AWHILE
// and book.js has SLEEP WELL, so the two obvious ones are gone, and a pillow is
// the one marker in a graveyard whose shape is already the word.
function drawPillowInscription(ctx, w, h) {
  const size = h * 0.375; // 0.096 in world, measured off the artwork not the em
  inkText(ctx, 'ASLEEP', w / 2, h * 0.50, size, size * 0.05);
}

registerStone('pillow', {
  // halfWidth, height and depth are the TABLET, which is the registry's slab
  // and the piece this stone actually keeps. The plinth is thrown away in
  // extras and only has to be a real height while it exists, or its own corner
  // circles overlap and the sweep folds through itself.
  shape: { halfWidth: PW, height: PH, depth: PT, plinth: 0.12 },
  // A tablet, not an arch: both radii set and set the same, and set tight. See
  // PR above for why they are tight rather than generous.
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
    //
    // Jittered per seed, and jittered in the geometry rather than in a scale:
    // padOutline is called here, not at module load, so a casting is a slightly
    // different wedge and not the same wedge stretched. The three knobs are the
    // ones a mason would miss by, a centimetre or two on the height of the top,
    // the width and the run, and between them they move the front lip between
    // 0.163 and 0.196, the top between 0.44 and 0.48, and the footprint radius
    // by about 20mm.
    const topY = PAD_TOP_Y + (rng() - 0.5) * 0.030;
    const halfX = PAD_HALF_X + (rng() - 0.5) * 0.044;
    const depth = PAD_DEPTH + (rng() - 0.5) * 0.030;
    const padGeo = buildArcSweepGeometry({
      outline: padOutline(topY, depth),
      depth: halfX * 2,
      edge: PAD_E,
      // Plain stone, parked in the texture's clean strip. v runs from the foot
      // of the profile to its top through the grime band the registry's own
      // plinth uses, so the pad's ground line is dirty and its sloped top is
      // not, and it cannot read as a whiter material than the tablet on it.
      uv: (x, y) => stripUV(x, y + PAD_SINK, depth / 2 + PAD_FLARE, (topY + PAD_SINK) * 1.6, 0.34),
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
    // Three per-seed knobs again, and all three are small on purpose, because
    // this joint is the one place a low piece can go wrong: a tablet visibly
    // off its bed reads as a lid that has slipped.
    //
    //   tilt, never less than nominal, so a casting can only be more legible
    //   than the one the slope was measured on. The pad's top is built at the
    //   nominal angle, so anything the tablet takes on top of it opens a wedge
    //   of daylight under the head, and past about a degree that shows.
    //   spin about the tablet's own face normal, a degree and a half either
    //   way. This is the one that does the most for a graveyard with two of
    //   them in it: a tablet a degree out of square with its bed is a stone
    //   somebody set, and it is applied before the lay-down so it turns the
    //   tablet in its own plane and never tips the face off the camera.
    //   slide along the slope and across it, a centimetre either way.
    const tilt = TILT + rng() * 0.018;
    const spin = (rng() - 0.5) * 0.052;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + tilt, 0, spin));
    slab.quaternion.copy(q);
    // Centre of the tablet: a point on the pad's top plane, pushed out along
    // that plane's normal by what is left of the tablet's half thickness once
    // it is buried. Its own tilt, not the nominal one, or the jitter walks the
    // tablet a few millimetres off the middle of the ledge.
    const out = PT / 2 - BURY;
    const up = TAB_SHIFT + (rng() - 0.5) * 0.02; // along the slope, from the middle
    const centre = new THREE.Vector3(
      (rng() - 0.5) * 0.02,
      topY + up * Math.sin(tilt) + out * Math.cos(tilt),
      -up * Math.cos(tilt) + out * Math.sin(tilt),
    );
    // The slab's own origin is at the foot of its face, so the offset from
    // there to its centre goes out through the same rotation.
    slab.position.copy(centre).sub(new THREE.Vector3(0, PH / 2, 0).applyQuaternion(q));

    // --- seating -------------------------------------------------------------
    //
    // Checked rather than assumed, and checked on the pad's own vertices under
    // its own matrix: the pad is a sweep turned a quarter turn, so
    // Box3.setFromObject would grow its local box by the rotation and report a
    // depth that is really its width. The bottom bead is meant to run under the
    // floor, so no seed can leave a corner of a piece this low hovering, which
    // on something 0.44 tall would be the whole read. The registry's lean is
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
