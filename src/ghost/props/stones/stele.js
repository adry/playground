import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText } from '../tombstones.js';

// The Greek stele: the tall thin one, with a palmette on its head.
//
// A narrow upright slab, a moulded cornice overhanging it, and above that an
// anthemion -- a fan of five fat leaves springing out of a small base. The
// obelisk is the other tall stone in the set and the two must never be
// confused, so everything that separates them is in the top third. The obelisk
// closes with one small pyramid and nothing else; this one flares twice, first
// into a cornice a quarter wider than the shaft and then into a fan wider than
// both.
//
// WHY IT IS TWO PIECES AND NOT ONE
//
// heart.js records the shoulder-cove trick and this stone is built on it: a lobe
// tangent to a straight side from the inside buries its own top by one rim
// radius, and a concave cove is what lets it stand clear instead. A palmette is
// a row of lobes doing exactly that. What heart.js also records is the price,
// and on a fan of five that price is what decides the whole design.
//
// The rim is a fixed 0.062. A convex arc keeps its radius MINUS the rim on the
// flat front face, so no leaf may be thinner than about 0.17 across or the
// sweep folds. Five leaves that thick, plus four gaps wide enough to read as
// gaps, is a fan 0.78 across and 0.39 tall; hang it off a shoulder cove, which
// lifts it by another rim-and-a-half, and stand it on a cornice that needs a
// 0.09 roll for the same reason, and the crown alone comes to 0.88. Added to a
// shaft long enough to be worth carving, that is a stone taller than the
// obelisk, which is the one thing it may not be. Five leaves scaled down
// instead have no gaps at all: at the rim's floor the notches between them come
// out shallower than a leaf is thick and the fan reads as one bobble with
// scratches on it, which is the failure the brief names.
//
// So the palmette is swept separately with a rim of its own, 0.045, on a plate
// 0.16 deep against the shaft's 0.23. That buys leaves 0.13 across with notches
// a leaf and a half deep, and a crown that fits. It is also what an akroterion
// actually is: a thinner slab set on the cornice, not part of the shaft. The
// joint is buried -- the palmette's base runs down inside the cornice and comes
// up through its flat top -- so nothing creases, which is the rule the joint had
// to satisfy however it was made.
//
// WHY THE PALMETTE MUST STAY INSIDE THE CORNICE'S OVERHANG
//
// Walk the outline counter-clockwise. Once past the cornice's widest point every
// step along the top runs inward, so a leaf standing outboard of it can only be
// reached by turning round, and turning round costs a fillet of nearly half a
// turn: a hook with the cornice's ledge caught in its mouth, which reads as a
// chip. The pocket UNDER the outer leaves is fine and in fact wanted -- a
// palmette's outer leaves do stand clear with air beneath them -- but it has to
// be entered through the base's own vertical side, which is what the little
// pillar under the fan is for. Outboard of that, the cornice is the widest thing
// on the stone and the fan sits just inside it.

// --- the numbers -----------------------------------------------------------
//
// 0.61 across the shaft by 0.92 tall, on a 0.12 plinth, topping out near 1.73
// with the palmette. Against the set: the cross is 0.92 by 1.56 overall and the
// obelisk 0.60 by 1.85. The face is the second narrowest in the set, a hair
// inside heart's 0.62 and just outside the obelisk's 0.60, and the height falls
// between the tallest slab and the obelisk rather than beside either.
//
// Face aspect 0.663, so the inscription canvas comes out 679 texels wide against
// the cross's 688. That is why the shaft is not thinner still: the engraving
// treatment has a measured working range, and a face much under 600 texels
// leaves no room for a groove that is both fine and legible.
//
// Depth 0.23 on a 0.61 width, the same third the rest of the set runs at.
const W = 0.305;
const H = 0.92;
const SHAPE = { halfWidth: W, height: H, depth: 0.23, plinth: 0.12 };

// How far the cornice reaches down inside the slab. Only has to swallow the
// slab's squared top and the joint. Kept short so the inscription sits entirely
// below it and never lands where the two front faces are coincident.
const SINK = 0.16;

// --- the cornice -----------------------------------------------------------
//
// Four moves, each tangent to the last, springing from the shaft's own side at
// exactly y = H so the crown's flanks are coincident with the slab's rather than
// a hair outside them, which is the difference between two surfaces that shade
// identically and a band of stipple across the stone.
//
//   coveR/coveSweep  the cove under the overhang. A cove, not a soffit: a flat
//                    underside is a shelf, and a shelf is the one edge the rim
//                    cannot round.
//   fascia           the straight outward-leaning band above it. The only flat
//                    on the crown, and what makes the cornice read as MOULDED
//                    rather than as a bulge.
//   rollR            the roll over the top. It has to clear the 0.062 rim with
//                    something left over, so it is 0.088 and the cornice is 0.22
//                    tall because of it. That is not waste: it is the
//                    second-biggest feature on the stone, and it is what stops
//                    the palmette reading as a flower stuck on a post.
//   halfWidth        where the roll's crown lands. The overhang is 0.09 a side,
//                    30% of the shaft's half width.
const CORNICE = {
  coveR: 0.055,
  coveSweep: (46 * Math.PI) / 180,
  rollR: 0.088,
  halfWidth: 0.395,
};

// --- the palmette ----------------------------------------------------------
//
// `depth`/`edge` are the plate's own, and the reason for them is above.
//
// THE LEAVES ARE TAPERED, AND THAT IS THE WHOLE READ.
//
// The first version made each leaf a circle, the way heart.js makes its lobes,
// and it failed for a reason worth writing down. A row of equal circles filleted
// together has a solid core: the notch between two of them can only reach down
// to where their own rims come closest, so with five leaves 48 degrees apart the
// deepest possible notch still left 60% of the fan's radius as unbroken stone.
// What stood above it was five shallow scallops on a disc -- the bobble.
//
// So each leaf here is a TAPER: a fat round tip carried on two straight flanks
// that converge on the fan's own origin, with a small fillet dropped into the
// V between neighbours. A flank is free in an arc chain (two arcs that end with
// the same normal are joined by a straight run that offsets exactly), the fillet
// sits at rv/sin(half the free wedge) from the origin, and the notch therefore
// reaches almost all the way down to the base: 42% of the fan's radius instead
// of 60%, so each leaf stands clear for nearly two thirds of its length. That is
// also what a palmette leaf actually is -- wide at the tip, nothing at the root
// -- and the taper is what makes five of them read as five.
//
// `baseHalf` is the little pillar the fan springs from and `pillar` how far it
// stands proud of the cornice before the shoulder cove flares. `coveR` is that
// cove: it lifts the whole fan by about its own radius again, so it is the most
// expensive number here and stays small.
//
// The leaves are (angle off vertical, length from the origin, tip radius). 48
// degrees apart puts the outer pair a few degrees past horizontal, where an
// anthemion's outer leaves go; each leaf eats 2*asin(rad/len) = 28 degrees of
// that at the root, leaving a 20-degree wedge of air between neighbours. The
// middle leaf is longer and fatter than the others so the fan does not read as a
// scallop shell.
const PALMETTE = {
  depth: 0.16,
  edge: 0.045,
  baseHalf: 0.13,
  pillar: 0.035,
  coveR: 0.05,
  valleyR: 0.03,
  leaves: [
    { ang: 0, len: 0.285, rad: 0.068 },
    { ang: 48, len: 0.270, rad: 0.065 },
    { ang: 96, len: 0.270, rad: 0.065 },
  ],
};

// ---------------------------------------------------------------------------
// outline helpers

const TAU = Math.PI * 2;

// One arc, with its sweep normalised. Once the outline itself runs
// counter-clockwise every convex arc on it is walked counter-clockwise and every
// concave one clockwise, and nothing here turns through a full circle, so
// folding the difference into (0, 2pi) with the sign picks the right branch
// without any caller having to think about it. The shoulder cove turns through
// 100 degrees and the outermost leaf through 250; getting either branch
// backwards is a stone with its top inside out.
function arc(cx, cy, r, a0, a1, sign) {
  let d = (a1 - a0) % TAU;
  if (sign > 0 && d <= 0) d += TAU;
  if (sign < 0 && d >= 0) d -= TAU;
  return { cx, cy, r, a0, a1: a0 + d, sign };
}

// The left half of a symmetric outline: the same arcs with x negated, walked
// backwards, which is the only way five leaves are guaranteed to match.
const mirrored = (arcs) => arcs.map((c) => arc(-c.cx, c.cy, c.r, Math.PI - c.a1, Math.PI - c.a0, c.sign)).reverse();

// One leaf, resolved. `mu` is its axis as a bearing off the +x axis rather than
// off vertical, because every angle downstream is; `alpha` is the half angle the
// leaf subtends at the origin, which is what the flanks are tangent to; `lo` and
// `hi` are those two flanks as bearings. `tip` is the centre of the round end.
//
// The two arc angles fall out of one fact: the flank touches the tip circle a
// quarter turn round from the flank's own bearing, on whichever side the leaf
// is. So the tip cap runs from lo - 90 degrees to hi + 90 degrees, which is
// 180 + 2*alpha of arc, and both ends carry the flank's normal, which is what
// lets the straight run between two arcs offset exactly.
function leafAt(O, L) {
  const mu = Math.PI / 2 - (L.ang * Math.PI) / 180;
  const alpha = Math.asin(Math.min(0.999, L.rad / L.len));
  return {
    ...L,
    mu,
    alpha,
    lo: mu - alpha,
    hi: mu + alpha,
    tip: { x: O.x + L.len * Math.cos(mu), y: O.y + L.len * Math.sin(mu) },
  };
}

// Where the cornice's flat top sits, and how wide it is. Both pieces need it:
// the cornice ends there and the palmette stands on it.
function corniceTop() {
  const { coveR: rc, coveSweep: phi, rollR: rq, halfWidth } = CORNICE;
  const cx = halfWidth - rq;
  // The cove leaves the shaft at y = H and the fascia is whatever straight run
  // is left between the top of the cove and the start of the roll. Its length
  // falls out of the two x positions, and its rise out of its own slope.
  const coveEnd = { x: W + rc * (1 - Math.cos(phi)), y: H + rc * Math.sin(phi) };
  const n = { x: Math.cos(phi), y: -Math.sin(phi) }; // outward normal where the cove stops
  const fascia = (cx + rq * n.x - coveEnd.x) / Math.sin(phi);
  const cy = coveEnd.y + fascia * Math.cos(phi) - rq * n.y;
  return { cx, cy, coveEnd, n, fascia, y: cy + rq };
}

// The cornice, counter-clockwise from its buried bottom-right corner, closing
// across a flat top that the palmette stands on.
function corniceOutline() {
  const t = corniceTop();
  const rb = 0.09; // buried inside the slab, so any radius that fits will do
  const right = [
    arc(W - rb, H - SINK + rb, rb, -Math.PI / 2, 0, 1),
    arc(W + CORNICE.coveR, H, CORNICE.coveR, Math.PI, Math.PI - CORNICE.coveSweep, -1),
    arc(t.cx, t.cy, CORNICE.rollR, -CORNICE.coveSweep, Math.PI / 2, 1),
  ];
  return [...right, ...mirrored(right)];
}

// The palmette. Its own sweep, its own rim, and its base runs down inside the
// cornice so the two never meet in a crease.
//
// Solved from the top down, because the fan's origin is not a free number: the
// outermost leaf's lower flank has to land on the shoulder cove, the cove has to
// sit on the little pillar, and the pillar has to stand on the cornice. So the
// origin is placed relative to the cove and everything else hangs off it.
function palmetteOutline() {
  const P = PALMETTE;
  const ledgeY = corniceTop().y;
  const rs = P.coveR;
  const O = { x: 0, y: 0 };
  const outer = leafAt(O, P.leaves[P.leaves.length - 1]);

  // The cove is tangent to the pillar's straight side from the outside, so its
  // centre is one radius clear of it, and tangent to the outer leaf's lower
  // flank on the far side of that line. Both conditions in the origin's own
  // frame give the drop from the origin to the pillar's top, which is the only
  // unknown left.
  // Written out: centre = O + along*(cos lo, sin lo) + rs*(sin lo, -cos lo), and
  // its x is baseHalf + rs. Solve that for `along`, read the y off it, then
  // slide the whole fan up until the cove's tangency lands on the pillar's top.
  const along = (P.baseHalf + rs * (1 - Math.sin(outer.lo))) / Math.cos(outer.lo);
  const cove = { x: P.baseHalf + rs, y: along * Math.sin(outer.lo) - rs * Math.cos(outer.lo) };
  O.y = ledgeY + P.pillar - cove.y;
  cove.y += O.y;

  const leaves = P.leaves.map((L) => leafAt(O, L));
  const rb = 0.06; // buried corner, and it has to clear this plate's own rim
  const yBot = ledgeY - 0.12;
  const right = [
    arc(P.baseHalf - rb, yBot + rb, rb, -Math.PI / 2, 0, 1),
    arc(cove.x, cove.y, rs, Math.PI, outer.lo + Math.PI / 2, -1),
  ];

  // Outermost leaf inward. Each leaf is a tip cap between two straight flanks,
  // and each notch is a fillet inscribed in the wedge of air between one leaf's
  // upper flank and the next one's lower flank: on the bisector, rv/sin(half the
  // wedge) out from the origin, which is what carries it down near the base.
  for (let i = leaves.length - 1; i > 0; i--) {
    const a = leaves[i];
    const b = leaves[i - 1];
    right.push(arc(a.tip.x, a.tip.y, a.rad, a.lo - Math.PI / 2, a.hi + Math.PI / 2, 1));
    const half = (b.lo - a.hi) / 2;
    const bis = (a.hi + b.lo) / 2;
    const d = P.valleyR / Math.sin(half);
    right.push(arc(O.x + d * Math.cos(bis), O.y + d * Math.sin(bis), P.valleyR, a.hi - Math.PI / 2, b.lo + Math.PI / 2, -1));
  }
  // The middle leaf straddles the axis, so it is one cap from its right notch
  // round to the mirror of it.
  const mid = leaves[0];
  const crown = arc(mid.tip.x, mid.tip.y, mid.rad, mid.lo - Math.PI / 2, mid.hi + Math.PI / 2, 1);
  return [...right, crown, ...mirrored(right)];
}

// ---------------------------------------------------------------------------

registerStone('stele', {
  shape: SHAPE,
  // Both ends squared. The cornice supplies the top and swallows the slab's own,
  // and a stele's foot is cut square to drop into a socket -- on a shaft this
  // narrow the registry's default 0.09 would round it away just where it comes
  // out of the plinth.
  topRadius: 0,
  bottomRadius: 0,

  // A name and a farewell, which is the whole text on most Attic grave stelai.
  // XAIPE is the Greek word as it is actually cut: chi alpha iota rho epsilon
  // are the same five shapes in this alphabet, so it needs no font this canvas
  // does not have.
  //
  // Both lines sit in the upper half, under the cornice, where a stele's
  // inscription goes. The long blank run below them is the obelisk's trick: the
  // eye finds the words, falls down the empty shaft, and the drop is what sells
  // the height.
  draw(ctx, w, h) {
    const size = h * 0.115;
    inkText(ctx, 'HEGESO', w / 2, h * 0.28, size, size * 0.04);
    inkText(ctx, 'XAIPE', w / 2, h * 0.44, size, size * 0.1);
  },

  extras({ body, material, shape, plinthH, edge, slabUV, disposables }) {
    const add = (geo, z = 0) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(0, plinthH, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
      disposables.push(geo);
    };

    // The cornice takes the slab's own rim radius -- the two have to agree or
    // the joint shows -- and the slab's own UV mapping, so the coincident front
    // faces carry the same texture in the same place and shade identically.
    // slabUV clamps v, which is what anything standing above the face needs.
    add(
      buildArcSweepGeometry({
        outline: corniceOutline(),
        depth: shape.depth,
        edge,
        uv: slabUV,
      }),
    );

    add(
      buildArcSweepGeometry({
        outline: palmetteOutline(),
        depth: PALMETTE.depth,
        edge: PALMETTE.edge,
        uv: slabUV,
      }),
    );
  },
});
