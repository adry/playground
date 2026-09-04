import * as THREE from 'three';
import { registerStone, buildSlabGeometry, inkText } from '../tombstones.js';

// A memorial bench: a thick stone seat on two solid end slabs, with a low back.
//
// It is the one piece in the set that is furniture rather than a marker, and
// that is the whole reason it is here. A graveyard of uprights is a field of
// things to look at; one bench turns it into a place somebody visits and sits
// down in. The seat is 0.45 off the ground and 1.44 long, so the ghost, which
// stands 1.6 with its hem near 0.2, can plausibly perch on it.
//
// Three decisions, in the order they matter:
//
//   1. It is LOW and it is WIDE, and for once that is right. The postmortem's
//      rule is that low-and-wide reads as a slab of debris, but that rule is
//      about markers competing with markers: this piece is not competing, it is
//      the horizontal the vertical stones are read against. It tops out at 0.81,
//      just under the fence post's 0.86 and well under little Fred at 1.10, so
//      it never reads as a stone that failed to stand up.
//
//   2. The registry's slab is the BACKREST, not the seat and not an end. The
//      slab is the one part that gets the carved face, and the carving treatment
//      wants a flat frontal panel of a certain size: the backrest is 1.10 by
//      0.50 and gives a 2253 px face, while the seat's front edge -- the other
//      honest place for a bench inscription -- is 1.44 by 0.19, which maps a
//      1024-tall canvas onto a fifth of a unit and shrinks the groove wall from
//      the 0.015 of world it was calibrated at to 0.006. A cut that fine is gone
//      by the second mip, and no amount of drawing fixes it, because it is the
//      face's own scale that is wrong. So the inscription goes where a real
//      memorial bench's plaque goes anyway: on the back rail, facing whoever is
//      about to sit down.
//
//   3. Everything else is three more fat rounded slabs off the same sweep: seat,
//      left end, right end. No joinery, no tenons, no rails. A stone bench in
//      this world is four blocks resting on each other, and every joint is
//      hidden inside another block rather than detailed.
//
// The bench has a front, which no other stone in the set really does, so it is
// built facing +Z exactly like a headstone's carved face. Give it the yaw a
// tombstone gets and it is looking the right way; give it the opposite and the
// piece still reads as a bench, but a blank one.

// --- dimensions ------------------------------------------------------------
//
// Seat 1.44 by 0.42, 0.19 thick, top face at 0.45. It overhangs the end slabs
// by 0.06 a side and leaves a hole under it 0.86 wide by 0.26 tall, which is the
// number that matters: a bench is read by the daylight under the seat, and
// without it the piece is a wall with a lid.
const SEAT = { half: 0.72, depth: 0.42, thick: 0.19, top: 0.45 };
// End slabs stand on edge, 0.23 across the bench by 0.40 through it, running
// 0.02 up into the seat so no seam opens along the joint. Deep and square on
// purpose: at 0.36 deep with generous corners they read from three quarters as
// two turned feet under a cushion, and what a stone bench stands on is two more
// slabs.
const END = { half: 0.115, height: 0.29, depth: 0.40, at: 0.545, z: -0.005, sink: 0.012 };
// The backrest: 1.10 wide, 0.50 tall, 0.15 thick, its foot buried 0.12 inside
// the seat slab so the joint is never seen. Its back face is flush with the
// seat's rear edge. Reclined 7 degrees, which is both what a back is for and,
// with the camera 23 degrees above the horizon, what turns the carved face a
// little further toward it.
const BACK = { half: 0.55, height: 0.50, thick: 0.15, base: 0.33, z: -0.135, recline: 0.12 };
// Fraction of the backrest the seat hides, measured from its foot. The
// inscription is laid out against the band that is left rather than against the
// whole face, which is the only reason it comes out centred in what you see.
const BURIED = (SEAT.top - BACK.base) / BACK.height; // 0.24
// A shade tighter than the registry's 0.062, because the pieces here are
// thinner than a headstone and the rim has to stay inside them: the seat is
// 0.19 through, so anything above 0.095 folds the sweep. It is also what the
// seat needs to read as cut stone rather than as upholstery -- the headstone's
// rim is a fifth of its thickness, and at 0.058 on a thinner slab this one was a
// third of it and came out a cushion.
const EDGE = 0.052;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// --- the inscription -------------------------------------------------------
//
// Two words, centred in the band of backrest the seat leaves visible: canvas y
// 0 to 0.76, since the buried quarter is at the bottom of the face. It is what a
// memorial bench actually says, and here it earns its place twice, as an
// invitation to sit and as the same thing every stone around it is saying.
//
// Measured: 4.5% ink over the whole face, 5.9% over the visible band, against
// 3.6, 6.3 and 9.1 for the approved cross, FRED and bat. The bounding box is
// 46% of face width by 60% of the visible height, which is well past the
// postmortem's 29-by-22, and that is a deliberate trade rather than a slip. This
// face is a third the height of a headstone's, so letters at the approved
// FRACTION of it are a third the size in WORLD units, and a groove is legible at
// a world width or it is not legible at all. Sized for the world instead, the
// caps come out 0.078 against R.I.P.'s 0.12: still the smaller lettering in the
// graveyard, and still inside the coverage band that is the number the last set
// was actually rejected on.
function drawBenchInscription(ctx, w, h) {
  const size = h * 0.235;
  // Placed in the visible band, not on the face: two thirds of the way is the
  // gap between the lines, and the block sits a hair high in it so the words
  // clear the seat rather than resting on it.
  const band = h * (1 - BURIED);
  inkText(ctx, 'REST', w / 2, band * 0.315, size, size * 0.06);
  inkText(ctx, 'AWHILE', w / 2, band * 0.710, size, size * 0.06);
}

registerStone('bench', {
  shape: { halfWidth: BACK.half, height: BACK.height, depth: BACK.thick, plinth: 0.12 },
  // A back rail is a rounded rectangle, not an arch: a half-round top on
  // something this wide and this low is a headboard. The two radii differ, and
  // the bottom one is the load-bearing number: the foot of the backrest is
  // buried 0.12 inside the seat, so a corner radius above that starts its curve
  // in daylight and the rail comes out balanced on a little foot, which is
  // exactly how a cushion sits on a sofa. Kept under the burial depth, the
  // sides leave the seat dead straight and the joint disappears.
  // The plinth this asks for is thrown away below, but it has to be a real
  // height while it exists or its own corner circles overlap and the sweep folds
  // through itself.
  topRadius: 0.11,
  bottomRadius: 0.08,

  draw: drawBenchInscription,

  extras({ body, material, rng, plinthH, disposables, stripUV }) {
    // Every extra surface here is plain stone, so all of it is parked in the
    // texture's clean strip; nothing but the backrest's own front face may
    // sample the inscription. v is chosen per piece rather than handed straight
    // through: the strip carries the grime gradient in its bottom, which is
    // wanted at the foot of an end slab and very much not wanted along the nose
    // of a seat.
    const plainUV = (halfW, span, v0, v1) => (x, y) => [
      stripUV(x, 0, halfW, 1)[0],
      v0 + (v1 - v0) * clamp01(y / span),
    ];

    // The registry lifts its slab onto the plinth and leaves the plinth at the
    // origin, so the two are told apart by where they sit rather than by the
    // order they arrive in.
    const meshes = body.children.filter((o) => o.isMesh);
    const back = meshes.find((m) => Math.abs(m.position.y - plinthH) < 1e-6) || meshes[0];
    const plinth = meshes.find((m) => m !== back);
    // A bench stands on its own ends. The registry's plinth is a wide bar under
    // the whole piece, which under a seat with daylight beneath it is the one
    // thing that would kill the read outright, so it goes. dispose() still owns
    // its geometry, so nothing leaks.
    if (plinth) body.remove(plinth);

    // Backrest into place: at the rear of the seat, its foot inside the seat
    // slab, reclined about that foot so the joint cannot swing out of the seat.
    // Jittered per seed, and only in the direction that cannot hurt -- the lean
    // never comes back past vertical.
    back.position.set(0, BACK.base, BACK.z);
    back.rotation.x = -BACK.recline * (0.85 + rng() * 0.35);

    // --- the seat ------------------------------------------------------------
    //
    // Built standing up like any other slab and then laid flat, which is what
    // makes it the same rounded object as the rest of the set rather than a
    // rounded box that happens to look similar. Its "height" axis becomes the
    // seat's depth, front edge at the slab's foot.
    const seatGeo = buildSlabGeometry({
      halfWidth: SEAT.half,
      height: SEAT.depth,
      depth: SEAT.thick,
      edge: EDGE,
      bottomRadius: 0.10,
      topRadius: 0.10,
      // Well up in the clean half of the strip: a seat is the one surface here
      // that is sat on and swept, and the grime belongs at the feet.
      uv: plainUV(SEAT.half, SEAT.depth, 0.62, 0.88),
    });
    const seat = new THREE.Mesh(seatGeo, material);
    seat.rotation.x = -Math.PI / 2;
    seat.position.set(0, SEAT.top - SEAT.thick / 2, SEAT.depth / 2);
    disposables.push(seatGeo);

    // --- the ends ------------------------------------------------------------
    //
    // One geometry, two meshes, mirrored. They are slabs on edge: thin across
    // the bench and deep through it, so from the front they are two legs and
    // from the side they are a solid stone cheek, which is what a bench of this
    // kind actually has.
    const endGeo = buildSlabGeometry({
      halfWidth: END.half,
      height: END.height,
      depth: END.depth,
      edge: EDGE,
      bottomRadius: 0.07,
      topRadius: 0.07,
      // Foot in the grime, top of the leg out of it.
      uv: plainUV(END.half, END.height, 0.04, 0.38),
    });
    disposables.push(endGeo);
    const ends = [-1, 1].map((s) => {
      const m = new THREE.Mesh(endGeo, material);
      // Bedded a hair into the ground, and the pair is not a matched set: a
      // couple of millimetres of difference is enough that the eye reads two
      // stones rather than one mirrored one.
      m.position.set(s * (END.at + (rng() - 0.5) * 0.012), -END.sink * (0.7 + rng() * 0.7), END.z);
      return m;
    });

    for (const m of [seat, ...ends]) {
      m.castShadow = true;
      m.receiveShadow = true;
      body.add(m);
    }

    // No contact patch under the ends. tombstones.js records why at length: a
    // patch laid flat on the floor is the same on the lit side as on the shaded
    // one and reads as a stain rather than a shadow. The key light already
    // throws a real shadow, and under a seat with a gap beneath it that shadow
    // is the best thing on the piece.
  },
});

// The registry's per-seed lean is applied to the whole body after this runs,
// which for a bench is exactly right: furniture settles into a lawn as one
// object, and a couple of degrees of roll on something 1.44 long is the
// difference between a placed prop and a moulded one. Nothing here fights it.
