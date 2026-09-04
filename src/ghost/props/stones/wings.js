import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText } from '../tombstones.js';

// The winged stone: the death's-head-and-wings motif with the skull left out.
//
// A central boss at the top of the stone with a pair of wings sweeping out and
// up from it, so the top of the piece breaks OUT SIDEWAYS past the shaft.
// Nothing else in the set does that: every other silhouette here, including the
// twin arch and the heart, stays inside its own straight sides, and the two
// stones that swell at all swell by a hair. This one is a shaft 0.60 across
// wearing a top 1.24 across, and that overhang is the whole identity. It has to
// read from the front and from three quarters, so it is geometry, and the face
// carries two small words and nothing more.
//
// WHY THE WINGS ARE THE OUTLINE AND NOT A PIECE BOLTED ON
//
// The cheap version is a squared slab with a pair of wing solids added in
// extras. It loses the same way the heart's lobes and the twin's caps lost. A
// separate solid meeting the slab's flat face is either coplanar with it, which
// is a fight, or it leaves a crease along the joint; and the crease would run
// right across the two most visible edges on the piece, the ones the eye is
// reading the wings by. So the wings are part of ONE swept outline, authored
// here and handed to buildArcSweepGeometry, which is the house's own sweep
// generalised to arcs that may turn either way. The wings are then made of the
// same continuous quarter-round surface as the rest of the set, corner for
// corner, and there is no joint anywhere on the piece to hide.
//
// Following twin.js and heart.js, the piece above the slab is a CROWN rather
// than a top: it sinks CROWN_SINK into a squared-off slab, its straight sides
// sit on the slab's own half width, and its front face is coplanar with the
// slab's carrying the same UVs, so the two coincident surfaces shade
// identically and there is nothing to z-fight about.
//
// THE FEATHERS
//
// A real wing is a hundred thin overlapping blades. Carved, at the size a stone
// takes on screen, that is a grey smudge: it is the same failure the bat mark
// had, where what survives is a small number of large features. So each wing
// here is THREE fat lobes, and the whole of the feathering is the scalloped
// underside they make. Every one of them is a roll of stone about a finger
// thick, the outermost being the wingtip, and the cleft between two of them is
// a small concave fillet, which the sweep widens by the rim radius on the flat
// face, so a 0.014 notch on the silhouette arrives as a 0.076 cove on the front:
// soft on the face, crisp against the sky, which is the right way round.
//
// The lobe centres climb at RAKE degrees going out, so the underside rises as
// it goes and the wing is a diagonal, not a shelf. The top edge is a single
// concave fillet running from the tip lobe all the way in to the boss, which is
// what makes one sweep out of three lobes: it dips into a valley beside the boss
// and lifts to the wingtip, and it is the only long line on the piece.
//
// WHAT SETS THE NUMBERS
//
// The lobes fatten and thin with one ratio: two circles of radius R whose
// centres are STEP apart leave a cleft R - sqrt(R^2 - STEP^2/4) deep. At the
// numbers below that is about 0.045 before the fillet takes a third of it back,
// so the scallops are ~0.15 wide and ~0.03 deep, which is a scallop and not a
// ripple at the ~230 px per unit a stone gets in the scene. Push STEP toward 2R
// and the lobes separate into fingers; pull it in and the underside goes flat.
//
// The other coupling worth naming: the top fillet has to REACH, which needs
// (BOSS.r + top) + (tip r + top) >= the distance from the tip lobe to the boss
// centre, and it has to pass clear ABOVE the arcs of the two inner lobes or the
// outline crosses itself. Both hold here with room to spare, because only the
// LOWER part of each lobe is on the boundary: a lobe is entered and left at its
// cleft fillets, both of which sit under it, so no lobe arc ever reaches its own
// centre height while the top fillet is 0.09 above the highest of them.

// 0.60 across and 1.53 tall including the plinth, against cross's 1.00 by 1.56
// and twin's 1.32 by 1.48. The tall narrow one, deliberately: the wings need a
// shaft to be wider than, and the postmortem's first rule is that a grave
// marker reads by its vertical. The face works out 627 by 1024 texels, which is
// dead centre of the 528 to 638 the engraving treatment was calibrated on.
const SHAPE = { halfWidth: 0.30, height: 0.92, depth: 0.28, plinth: 0.18 };

// How far the crown sinks into the slab. Only has to bury the slab's top edge
// rounding and the joint; the rest is margin.
const CROWN_SINK = 0.26;

// The central boss: the roundel where the skull would be. Its circle reaches
// well below the top of the slab, so it is a dome standing out of the stone
// rather than a ball balanced on it.
const BOSS = { r: 0.18, y: 1.18 };

const WING = {
  cove: 0.09, // the shoulder cove the wing flares out of
  // Where on the shaft the wings spring from. Below the slab's own shoulder, so
  // the crown swallows the slab's top corners and the shaft runs up into the
  // wings rather than stopping under them.
  spring: 0.78,
  // How far round the cove the wing is carried, in degrees. It is also the
  // angle the underside leaves the shaft at, measured off vertical, so a small
  // value grows the wing straight up the side and 90 sends it out flat.
  flare: 62,
  // The lobes of the underside, inner to outer, the last of them the wingtip.
  // The first is placed by its tangency with the cove; each of the others sits
  // `step` from the one before, `rake` degrees above horizontal. The rake
  // steepens down the wing, so the wing goes OUT first and UP after, which is
  // what puts the lift at the tip where the eye reads it.
  lobes: [
    { r: 0.110 },
    { r: 0.100, step: 0.175, rake: 20 },
    { r: 0.085, step: 0.165, rake: 34 },
  ],
  notch: 0.022, // the cleft fillet between two lobes
  // The top edge: one long shallow convex arc, tangent to the wingtip lobe from
  // the INSIDE, so the tip's tight roll runs into it without a join. `touch` is
  // where on the tip lobe it starts, in degrees, and the radius is what makes
  // the edge a long sweep rather than a dome.
  sweep: { r: 0.62, touch: 105 },
  valley: 0.10, // the cove between that sweep and the boss
};

// ---------------------------------------------------------------------------
// the outline
//
// Every arc in the chain is a circle, every join is a tangency between two
// circles, and the tangency point always lies on the line between their
// centres. So an arc's endpoint angle is simply the direction from its own
// centre to the centre of the circle it meets, which is what makes this chain
// short: the only thing that ever has to be solved for is where a fillet's
// centre goes.

const D = Math.PI / 180;
const ang = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

// The centre of a circle of radius rf tangent to both of two circles from the
// OUTSIDE, i.e. resting in the crease between them. `side` picks which of the
// two solutions: +1 is to the left of c1 -> c2, -1 to the right. Every fillet
// on this stone sits on the air side of the crease, which is the right hand one
// walking the outline counter-clockwise.
//
// If the two circles are further apart than the fillet can bridge there is no
// solution and, as in heart.js, the crease quietly collapses to a cusp rather
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

// A convex arc is walked counter-clockwise and a concave one clockwise, so both
// only need their two endpoint angles unwrapped the right way round.
const TAU = Math.PI * 2;
const bulge = (c, r, a0, a1) => ({ cx: c.x, cy: c.y, r, a0, a1: a0 + ((a1 - a0) % TAU + TAU) % TAU, sign: 1 });
const scoop = (c, r, a0, a1) => ({ cx: c.x, cy: c.y, r, a0, a1: a0 - ((a0 - a1) % TAU + TAU) % TAU, sign: -1 });

// Reflect a chain in x = 0. Reflection reverses orientation, so the list is
// walked backwards and each arc's endpoints swap, which is what keeps the whole
// outline counter-clockwise. Doing it this way rather than authoring both sides
// is the only way the two wingtips are guaranteed to match.
const mirror = (arcs) =>
  arcs
    .slice()
    .reverse()
    .map((c) => ({ cx: -c.cx, cy: c.cy, r: c.r, a0: Math.PI - c.a1, a1: Math.PI - c.a0, sign: c.sign }));

// The right half, counter-clockwise from the buried bottom-right corner up to
// the boss's own tangency; the boss arc and the mirrored half are added by
// crownOutline below.
function halfOutline(W, H, edge) {
  const rb = Math.max(edge, 0.09); // buried corners, never tighter than the rim
  const yb = H - CROWN_SINK;
  const ys = Math.min(WING.spring, H - edge); // never above where the slab's own corner starts

  // The shoulder cove, tangent to the straight side, so the crown's silhouette
  // leaves the slab's already parallel to it. This is the one place the wing
  // meets the shaft, and it is a cove rather than a notch: the wing GROWS from
  // the shoulder. The clefts are all further out, between the lobes.
  const cove = { x: W + WING.cove, y: ys };
  const b = WING.flare * D;

  // Lobe one hangs off the cove, tangent to it; the rest march out along their
  // own rakes. Tangency between two circles is on the line between their
  // centres, so lobe one's centre is simply (cove r + lobe r) away in the
  // direction the flare picked.
  const dir = { x: Math.cos(Math.PI - b), y: Math.sin(Math.PI - b) };
  const lobes = [];
  for (const [i, l] of WING.lobes.entries()) {
    const prev = lobes[i - 1];
    const c = prev
      ? { x: prev.c.x + l.step * Math.cos(l.rake * D), y: prev.c.y + l.step * Math.sin(l.rake * D) }
      : { x: cove.x + (WING.cove + l.r) * dir.x, y: cove.y + (WING.cove + l.r) * dir.y };
    lobes.push({ c, r: l.r });
  }

  // The clefts, the top sweep and the valley. Every fillet rests on the AIR
  // side of the crease it fills, which is the right hand side walking the
  // outline counter-clockwise.
  const clefts = lobes.slice(1).map((l, i) => fillet(lobes[i].c, lobes[i].r, l.c, l.r, WING.notch, -1));
  const tip = lobes[lobes.length - 1];
  const boss = { x: 0, y: BOSS.y };
  // The sweep contains the tip lobe rather than meeting it: two circles tangent
  // from the inside share their tangent direction at the touch point, so the
  // wingtip's roll flows into the long top edge with nothing but a change of
  // curvature. A fillet there instead would put a notch in the one line on the
  // piece that has to stay unbroken.
  const t = WING.sweep.touch * D;
  const sweep = {
    x: tip.c.x - (WING.sweep.r - tip.r) * Math.cos(t),
    y: tip.c.y - (WING.sweep.r - tip.r) * Math.sin(t),
  };
  const valley = fillet(sweep, WING.sweep.r, boss, BOSS.r, WING.valley, -1);

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
    out.push(bulge(l.c, l.r, ang(l.c, before), last ? t : ang(l.c, clefts[i])));
    if (!last) out.push(scoop(clefts[i], WING.notch, ang(clefts[i], l.c), ang(clefts[i], lobes[i + 1].c)));
  });
  out.push(bulge(sweep, WING.sweep.r, t, ang(sweep, valley)));
  out.push(scoop(valley, WING.valley, ang(valley, sweep), ang(valley, boss)));
  return { arcs: out, bossA: ang(boss, valley) };
}

function crownOutline(W, H, edge) {
  const { arcs, bossA } = halfOutline(W, H, edge);
  // The boss is one arc straddling the centre line, from its tangency with the
  // right wing's top edge to the mirror of it, so the dome is symmetric by
  // construction and carries no join on the axis.
  return [...arcs, bulge({ x: 0, y: BOSS.y }, BOSS.r, bossA, Math.PI - bossA), ...mirror(arcs)];
}

registerStone('wings', {
  shape: SHAPE,
  // Squared off: the crown supplies the whole top and the slab's own corners
  // are buried inside it. Zero clamps up to the sweep's own rim radius, which
  // is what the shoulder coves are placed against.
  topRadius: 0,

  // Two short words, low on the face, and nothing else. The silhouette is
  // already carrying the identity, and the postmortem's rule is that a complex
  // outline gets a token mark rather than a second thing competing with it, so
  // there is no carved wing, no border and no rule under the text.
  //
  // Measured: ink covers 4.6% of the face inside a box 45% by 26% of it,
  // against the approved band of 5 to 10% and the cross's 8.6%. The low end is
  // where this stone belongs, because it has the busiest outline in the set.
  // The letters come out 0.113 world tall, between fred's 0.096 and cross's
  // 0.122, which is the number that actually has to match: same yard, same
  // chisel, smaller stone.
  //
  // They sit below the middle of the face on purpose. The crown adds a third of
  // the stone's height above the face and carries the same texture up into it,
  // so an inscription centred on the FACE reads as centred high on the piece,
  // and worse, it crowds the wings.
  draw(ctx, w, h) {
    const size = h * 0.115;
    inkText(ctx, 'AT', w / 2, h * 0.50, size, size * 0.05);
    inkText(ctx, 'REST', w / 2, h * 0.68, size, size * 0.05);
  },

  extras({ body, material, shape, plinthH, halfWidth: W, height: H, edge, slabUV, disposables }) {
    const geo = buildArcSweepGeometry({
      outline: crownOutline(W, H, edge),
      depth: shape.depth,
      edge, // the slab's rim radius: the two have to agree or the joint shows
      // The slab's own mapping, so the crown's front face carries the same
      // texture in the same place and the coincident faces shade identically.
      // It clamps v, which is what everything standing above the face needs.
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
