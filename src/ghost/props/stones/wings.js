import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText } from '../tombstones.js';

// The winged stone: the death's-head-and-wings motif with the skull left out.
//
// A round-topped stone with a pair of wings sweeping out and up from under its
// arch, so the top of the piece breaks OUT SIDEWAYS past its own shaft. Nothing
// else in the set does that. Every other silhouette here stays inside its
// straight sides: the twin arch is one wide slab with a notch in the top, the
// heart's lobes swell past the shaft by 0.009, and the celtic cross puts its
// width in a separate head on a separate shaft. This one is a shaft 0.60 across
// wearing a top 1.30 across, and that overhang is the whole identity, so it is
// geometry rather than a mark, and the face carries two short words and nothing
// else.
//
// WHY THE WINGS ARE THE OUTLINE AND NOT A PIECE BOLTED ON
//
// The cheap version is a squared slab with a pair of wing solids added in
// extras. It loses the way the heart's lobes and the twin's caps lost. A
// separate solid meeting the slab's flat face is either coplanar with it, which
// is a fight, or it leaves a crease along the joint, and that crease would run
// right along the two edges the eye is reading the wings by. So the wings are
// part of ONE outline, authored here and handed to buildArcSweepGeometry, the
// house sweep generalised to arcs that may turn either way. The wings are then
// the same continuous quarter-round surface as the rest of the set and there is
// no joint anywhere on the piece to hide.
//
// Following twin.js and heart.js, the piece above the slab is a CROWN rather
// than a top: it sinks CROWN_SINK into a squared-off slab, its straight sides
// sit on the slab's own half width, and its front face is coplanar with the
// slab's and carries the same UVs, so the coincident surfaces shade identically
// and there is nothing to z-fight about.
//
// WHY THE CENTRE IS THE STONE'S OWN ARCH AND NOT A SEPARATE BOSS
//
// Worth recording, because two versions were built and thrown away. The motif
// wants a boss at the centre for the wings to spring from, and the obvious way
// to give it one is a smaller dome standing above the shaft. Both attempts read
// as a HEAD ON SHOULDERS: a round knob over a wide body with two things sticking
// out sideways is a figure, and once the eye has seen a figure it cannot see a
// headstone. The fix is that the boss is the stone's own half-round arch, radius
// = halfWidth, tangent to the shaft exactly as the `cross` stone's top is. There
// is then no neck and no shoulder, the top reads as a headstone first, and the
// wings tuck UNDER the arch and out, which is where they sit on the real thing.
// The notch that separates the two is the valley cove below.
//
// THE FEATHERS
//
// A real wing is a hundred thin overlapping blades. At the size a stone takes
// on screen that is a grey smudge, the same failure the bat mark had, where
// what survived was a small number of large features. So each wing is THREE fat
// lobes and the whole of the feathering is the scalloped underside they make.
// Each is a roll of stone about a finger thick and the cleft between two of them
// is a small concave fillet, which the sweep WIDENS by the rim radius on the
// flat face: a 0.020 notch on the silhouette arrives as a 0.082 cove on the
// front. Soft on the face, crisp against the sky, which is the right way round.
//
// The lobes rake out and up and the top edge is one long concave sweep, so the
// wing is broad where it leaves the shaft and tapers to the tip: 0.34 deep at
// the root against a 0.17 roll at the tip. That taper is what stopped it reading
// as an arm. An early version had the lobes hanging under a level top edge, so
// each wing was a constant-width bar ending in a ball, and it read as a limb
// with a mitten on it from every angle.
//
// WHAT THE FIXED RIM RADIUS SETS
//
// The rim is a fixed 0.062, and on this piece it is the floor under every
// number. Two separate limits, and the first version broke on the second:
//
//   * a convex arc thinner than the rim INVERTS on the way in, so no lobe may be
//     under 0.062 in the radius. The tip lobe is 0.085, which leaves a 0.023
//     roll on the flat face: a finger end, which is what a wingtip should be
//     here;
//   * the wing must be at least twice the rim THICK or its front face pinches
//     shut and the two sides of it cross. The first wing was 0.14 deep against
//     the rim's 0.124 and the flat face vanished to a thread, which the sweep
//     turned into a self-crossing outline: the wings came out as detached blobs.
//     Nothing about that is visible in the numbers until it is rendered, so the
//     wing is now 0.34 deep at the root and 0.17 at the tip.
//
// The cleft depth has its own arithmetic: two lobes of radius R whose centres
// are STEP apart leave a cleft R - sqrt(R^2 - STEP^2/4) deep before the fillet
// rounds it, and the fillet gives about a third of that back. At the numbers
// below the scallops come out 0.19 wide and 0.05 deep, which survives at the
// ~230 px per unit a stone gets in the scene. Push STEP toward 2R and the lobes
// separate into fingers; pull it in and the underside goes flat.

// 0.60 across the shaft, 1.30 across the wings and 1.54 tall including the
// plinth, against cross's 1.00 by 1.56 and twin's 1.32 by 1.48. Narrow and tall
// on purpose: the wings need a shaft to be wider than, and the postmortem's
// first rule is that a grave marker reads by its vertical. The face works out
// 698 by 1024 texels, a little wider than the 528 to 638 the engraving treatment
// was calibrated on, which is the safe direction to be out: it fails on faces
// too NARROW to hold an 11 px groove wall.
const SHAPE = { halfWidth: 0.30, height: 0.88, depth: 0.28, plinth: 0.18 };

// How far the crown sinks into the slab. It has to bury the slab's top edge
// rounding and the joint, and it also sets where the crown's own buried corner
// ends: WING.spring must clear height - CROWN_SINK + that corner radius, or the
// straight run up the side of the crown goes backwards.
const CROWN_SINK = 0.30;

// The arch, which is the boss of the motif. Radius = halfWidth and centred on
// the axis, so it is tangent to the shaft's sides and springs from them, and
// `seat` is how far round it the wings are seated: the angle where the valley
// cove touches, measured from the springing line.
const BOSS = { r: 0.30, y: 1.06, seat: 22 };

const WING = {
  // The shoulder cove, and where on the shaft it sits. The wing GROWS out of
  // the side rather than being notched into it, so this is a cove and not a
  // cleft, and it springs low: the lower it starts the deeper the wing's root
  // and the more the wing can rise before it runs out of height budget.
  cove: 0.115,
  spring: 0.70,
  // How far round the cove the wing is carried, in degrees off vertical. It is
  // the angle the underside leaves the shaft at, so a small value grows the wing
  // straight up the side and 90 sends it out flat.
  flare: 55,
  // The lobes of the underside, inner to outer, the last of them the wingtip.
  // The first is placed by its tangency with the cove; each of the others sits
  // `step` from the one before, `rake` degrees above horizontal. The rake
  // steepens down the wing, so the wing goes OUT first and UP after, which puts
  // the lift at the tip where the eye reads it and keeps the span inside 1.30.
  lobes: [
    { r: 0.115 },
    { r: 0.100, step: 0.190, rake: 34 },
    { r: 0.085, step: 0.180, rake: 46 },
  ],
  notch: 0.020, // the cleft fillet between two lobes
  valley: 0.06, // the cove that separates the wing from the arch
  sweep: 0.90, // the long concave top edge, valley to wingtip
};

// ---------------------------------------------------------------------------
// the outline
//
// Every arc in the chain is a circle and every join is a tangency between two
// circles, which always lies on the line between their centres. So an arc's
// endpoint angle is just the direction from its own centre to the centre of the
// circle it meets, and the only thing ever solved for is where a circle goes.

const D = Math.PI / 180;
const ang = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

// The centre of a circle of radius rf tangent to both of two circles from the
// OUTSIDE, i.e. resting in the crease between them. `side` picks which of the
// two solutions: +1 is to the left of c1 -> c2, -1 to the right. Every fillet
// here sits on the air side of its crease, which walking counter-clockwise is
// the right hand one.
//
// If the two circles are too far apart for the fillet to bridge there is no
// solution, and as in heart.js the crease quietly collapses to a cusp rather
// than throwing in the middle of a scene build. The numbers above keep it well
// clear of that.
function fillet(c1, r1, c2, r2, rf, side) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const R1 = r1 + rf;
  const R2 = r2 + rf;
  const a = (R1 * R1 - R2 * R2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, R1 * R1 - a * a));
  return { x: c1.x + (a * dx - side * h * dy) / d, y: c1.y + (a * dy + side * h * dx) / d };
}

// Where the top sweep's centre goes. It has to be (sweep - valley) from the
// valley centre, which puts the valley INSIDE it and tangent, and (sweep + tip)
// from the wingtip, which puts the tip outside it and tangent. Two circles, two
// answers; this returns the one to the LEFT of valley -> tip, which is the one
// above the wing, because a centre above a boundary is what makes it concave.
function meet(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  return { x: c1.x + (a * dx - h * dy) / d, y: c1.y + (a * dy + h * dx) / d };
}

// A convex arc is walked counter-clockwise and a concave one clockwise, so each
// only needs its two endpoint angles unwrapped the right way round.
const TAU = Math.PI * 2;
const bulge = (c, r, a0, a1) => ({ cx: c.x, cy: c.y, r, a0, a1: a0 + (((a1 - a0) % TAU) + TAU) % TAU, sign: 1 });
const scoop = (c, r, a0, a1) => ({ cx: c.x, cy: c.y, r, a0, a1: a0 - (((a0 - a1) % TAU) + TAU) % TAU, sign: -1 });

// Reflect a chain in x = 0. Reflection reverses orientation, so the list is
// walked backwards and each arc's endpoints swap, which keeps the whole outline
// counter-clockwise. Doing it this way rather than authoring both sides is the
// only way the two wingtips are guaranteed to match.
const mirror = (arcs) =>
  arcs
    .slice()
    .reverse()
    .map((c) => ({ cx: -c.cx, cy: c.cy, r: c.r, a0: Math.PI - c.a1, a1: Math.PI - c.a0, sign: c.sign }));

// The right half, counter-clockwise from the buried bottom-right corner up to
// the arch's own tangency. crownOutline adds the arch and the mirrored half.
function halfOutline(W, H, edge) {
  const rb = Math.max(edge, 0.09); // buried corners, never tighter than the rim
  const yb = H - CROWN_SINK;
  const ys = Math.min(WING.spring, H - edge); // never above where the slab's own corner starts

  // The shoulder cove, tangent to the straight side, so the crown's silhouette
  // leaves the slab's already parallel to it and the wing appears to grow out of
  // the shaft. Every other concave arc on the piece is a cleft; this one is not.
  const cove = { x: W + WING.cove, y: ys };
  const b = WING.flare * D;

  // Lobe one hangs off the cove; the rest march out along their own rakes.
  const dir = { x: Math.cos(Math.PI - b), y: Math.sin(Math.PI - b) };
  const lobes = [];
  for (const [i, l] of WING.lobes.entries()) {
    const prev = lobes[i - 1];
    const c = prev
      ? { x: prev.c.x + l.step * Math.cos(l.rake * D), y: prev.c.y + l.step * Math.sin(l.rake * D) }
      : { x: cove.x + (WING.cove + l.r) * dir.x, y: cove.y + (WING.cove + l.r) * dir.y };
    lobes.push({ c, r: l.r });
  }

  // The clefts under the wing, then the two arcs over it. The valley is seated
  // on the arch by angle, which fixes it; the sweep then has to reach from the
  // valley to the wingtip, and it is tangent to the valley from OUTSIDE and to
  // the tip lobe from outside, so the top edge is one unbroken concave line from
  // the arch to the tip with no join in it anywhere.
  const clefts = lobes.slice(1).map((l, i) => fillet(lobes[i].c, lobes[i].r, l.c, l.r, WING.notch, -1));
  const tip = lobes[lobes.length - 1];
  const boss = { x: 0, y: BOSS.y };
  const seat = BOSS.seat * D;
  const valley = { x: (BOSS.r + WING.valley) * Math.cos(seat), y: BOSS.y + (BOSS.r + WING.valley) * Math.sin(seat) };
  const sweep = meet(valley, WING.sweep - WING.valley, tip.c, WING.sweep + tip.r);

  const out = [
    // The buried corner, and the straight side that falls out for free between
    // it and the cove: both end tangent to x = W, so the run between them is
    // vertical and its normals already agree.
    bulge({ x: W - rb, y: yb + rb }, rb, -Math.PI / 2, 0),
    scoop(cove, WING.cove, Math.PI, ang(cove, lobes[0].c)),
  ];
  lobes.forEach((l, i) => {
    const before = i === 0 ? cove : clefts[i - 1];
    const last = i === lobes.length - 1;
    // Each lobe is entered and left at a circle that sits UNDER it, so the arc
    // on the boundary is the lobe's lower flank and never reaches its own centre
    // height. That is what lets the top sweep pass over all three of them.
    out.push(bulge(l.c, l.r, ang(l.c, before), last ? ang(l.c, sweep) : ang(l.c, clefts[i])));
    if (!last) out.push(scoop(clefts[i], WING.notch, ang(clefts[i], l.c), ang(clefts[i], lobes[i + 1].c)));
  });
  // The sweep and the valley touch each other from the inside, so they share a
  // tangent direction and the angle is the same seen from either centre.
  out.push(scoop(sweep, WING.sweep, ang(sweep, tip.c), ang(sweep, valley)));
  out.push(scoop(valley, WING.valley, ang(sweep, valley), ang(valley, boss)));
  return { arcs: out, bossA: ang(boss, valley) };
}

function crownOutline(W, H, edge) {
  const { arcs, bossA } = halfOutline(W, H, edge);
  // The arch is one arc straddling the centre line, from its tangency with the
  // right wing's valley to the mirror of it, so the dome is symmetric by
  // construction and carries no join on the axis.
  return [...arcs, bulge({ x: 0, y: BOSS.y }, BOSS.r, bossA, Math.PI - bossA), ...mirror(arcs)];
}

registerStone('wings', {
  shape: SHAPE,
  // Squared off: the crown supplies the whole top and the slab's own corners are
  // buried inside it. Zero clamps up to the sweep's own rim radius, which is what
  // the shoulder coves are placed against.
  topRadius: 0,

  // Two short words and nothing else. The silhouette is already carrying the
  // identity and the postmortem's rule is that a complex outline gets a token
  // mark rather than a second thing competing with it, so there is no carved
  // wing, no border and no rule under the text.
  //
  // Measured off the colour map the stone actually builds, counting texels the
  // mark darkened, ink covers 4.1% of the face in a box 64% by 31% of it. The
  // same count gives cross 3.8% and fred 6.7%, so this sits between the two
  // approved stones and nearer the light end, which is where the busiest outline
  // in the set belongs.
  //
  // The letters come out 0.094 world tall against fred's 0.095 and cross's
  // 0.122. Matching the set's letter SIZE is what has to hold rather than a
  // coverage figure: this face is 698 texels wide, so the same chisel covers
  // less of it. An earlier pass had them at 0.070, which measured a comfortable
  // 2.2% and looked like a different, smaller yard had cut them.
  //
  // The block sits low. The crown carries the same texture a third of the
  // stone's height above the face, so words centred on the FACE read as centred
  // high on the PIECE, and they crowd the wings.
  draw(ctx, w, h) {
    const size = h * 0.160;
    inkText(ctx, 'AT', w / 2, h * 0.40, size, size * 0.05);
    inkText(ctx, 'REST', w / 2, h * 0.60, size, size * 0.05);
  },

  extras({ body, material, shape, plinthH, halfWidth: W, height: H, edge, slabUV, disposables }) {
    const geo = buildArcSweepGeometry({
      outline: crownOutline(W, H, edge),
      depth: shape.depth,
      edge, // the slab's rim radius: the two have to agree or the joint shows
      // The slab's own mapping, so the crown's front face carries the same
      // texture in the same place and the coincident faces shade identically.
      // It clamps v, which is what everything standing above the face needs.
      // Between the two of them the wings cannot pick up a letter however the
      // inscription moves: every part of the crown that reaches BELOW the top of
      // the face is outboard of the shaft, where u has already run off the face
      // into the plain strip, and everything above it samples the face's top
      // row, which is plain mottled stone.
      uv: slabUV,
    });
    const crown = new THREE.Mesh(geo, material);
    crown.position.y = plinthH;
    crown.castShadow = true;
    crown.receiveShadow = true;
    body.add(crown);
    disposables.push(geo);
  },
});
