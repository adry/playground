import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText } from '../tombstones.js';

// The Greek stele: the tall thin one with a palmette on its head.
//
// A narrow upright slab, a moulded cornice capping it, and above that an
// anthemion -- a fan of five fat leaves springing out of a pinched little base.
// The obelisk is the other tall stone in the set and the two must never be
// confused, so everything that separates them lives in the top third: the
// obelisk closes with a small pyramid and nothing else, this one flares twice,
// once into a cornice that overhangs the shaft by a quarter of its half width
// and once into a fan wider than the shaft is.
//
// WHY IT IS BUILT THIS WAY
//
// The whole crown -- cornice and palmette together -- is ONE outline swept
// through the house's quarter-round profile by buildArcSweepGeometry, sunk into
// a squared-off slab exactly as heart.js sinks its lobes. It is not a stack of
// parts. A cornice modelled as a separate block sitting on a shaft gives you two
// solids meeting in a crease, and a palmette modelled as leaves bolted onto a
// cornice gives you five more; that is six creases on the one part of the stone
// the eye actually goes to, in a set whose whole premise is that nothing is
// faceted or chipped. Authored as an arc chain instead, the silhouette runs from
// the foot of the shaft to the tip of the middle leaf without a single corner in
// it, and every ring of the sweep is the same chain with the same tangency
// angles, so the normals stay analytic.
//
// THE ONE THING THAT DECIDES THE SHAPE: A LOBE CANNOT REACH BACKWARDS
//
// heart.js records the shoulder-cove trick -- a lobe tangent to a straight side
// from the inside buries its own top by one rim radius, and a concave cove is
// what lets it flare out clear of the stone instead. A palmette is a row of
// lobes doing exactly that, so the same cove appears here under the outermost
// leaf. What is new is the DIRECTION it has to be built in, and it cost a whole
// pass to find.
//
// Walk the outline counter-clockwise. Up the right side, out over the cornice,
// and once you are past the cornice's widest point every remaining step along
// the top runs inward, in -x. A leaf standing outboard of that point can only be
// reached by turning round, and the only curve that turns round is a cove swept
// through more than half a turn: a hook, with the cornice's top ledge caught in
// its mouth. It is not a fillet, it is a cave, and it reads as a chip out of the
// stone. So the rule the crown is drawn to is that the palmette must live INSIDE
// the cornice's overhang, and the base cove hangs off the cornice's own top roll
// rather than off a ledge stuck out past it. What you get for obeying it is the
// silhouette this stone wanted anyway: the cornice is the widest thing on the
// piece, the fan sits just inside it, and the shaft is narrower than both.
//
// WHY FIVE LEAVES
//
// Because the rim radius is a fixed 0.062 and the stone is small. A leaf is a
// convex arc, so the flat front face keeps its radius MINUS the rim; under the
// rim it inverts and the sweep folds. That puts a hard floor of about 0.08 under
// a leaf's silhouette radius, i.e. a leaf is at least 0.16 thick, and five of
// them plus four gaps of 0.04 is 1.0 of arc to lay out. Laid on a fan of radius
// 0.29 that comes to a crown 0.73 across on a 0.61 shaft, which is already as
// wide as this stone can be and stay the narrow one. Seven leaves at the same
// thickness would need a fan half again as big; seven THIN leaves is the version
// the house style forbids, because at scene scale a 0.03 leaf is a scratch and
// the fan collapses into a single bobble. Three read as a trefoil, not a
// palmette. Five is what the rim radius and the width budget leave, and it is
// also what an Attic anthemion of this size actually carries.

// --- the numbers -----------------------------------------------------------
//
// 0.61 across the shaft by 0.90 tall, on a 0.13 plinth, topping out at 1.73 with
// the palmette. Against the set: the cross is 0.92 by 1.56 overall and the
// obelisk 0.60 by 1.85. So the face is the second narrowest in the set, a hair
// inside heart's 0.62 and just outside the obelisk's 0.60, and the height sits
// between the tallest slab and the obelisk rather than beside either.
//
// Face aspect is 0.678, so the inscription canvas comes out 694 texels wide
// against the cross's 688. That is the whole reason the shaft is not thinner:
// the engraving treatment has a measured working range and a face much under
// 600 texels leaves no room for a groove that is both fine and legible.
//
// Depth 0.23 on a 0.61 width. A stele is a plank, and the reference ones are
// thinner than this, but the crown has to be the same slab all the way through
// and a leaf 0.16 across on a plank 0.18 thick reads as a paper cut-out.
const W = 0.305;
const H = 0.90;
const SHAPE = { halfWidth: W, height: H, depth: 0.23, plinth: 0.13 };

// How far the crown reaches down inside the slab. Only has to swallow the
// slab's squared top and the joint; the rest is margin. Kept short so the
// inscription sits entirely below it and never lands on the two coincident
// front faces.
const SINK = 0.16;

// --- the cornice -----------------------------------------------------------
//
// Four moves, each tangent to the last, springing from the shaft's own side at
// exactly y = H so the crown's straight flanks are coincident with the slab's
// rather than a hair outside them:
//
//   coveR/coveSweep  the cove under the overhang. A cove, not a ledge: an
//                    overhang with a flat soffit is a shelf, and a shelf on a
//                    vinyl toy is the one edge the rim cannot round.
//   fascia           the straight outward-leaning band above it, the only flat
//                    on the whole crown and what makes the cornice read as
//                    MOULDED rather than as a bulge.
//   rollR            the fat roll over the top. Has to clear the 0.062 rim, so
//                    it is 0.075 and the cornice is 0.20 tall because of it.
//                    That is not waste: it is the second-biggest feature on the
//                    stone and it is what stops the palmette reading as a
//                    flower stuck on a post.
const CORNICE = { coveR: 0.06, coveSweep: (52 * Math.PI) / 180, fascia: 0.029, rollR: 0.075 };

// --- the palmette ----------------------------------------------------------
//
// `ledge` is the short flat run between the top of the cornice roll and the
// start of the base cove; both are horizontal there, so the straight between
// them is exactly tangent and costs nothing. It is small on purpose -- it is
// the only thing separating the cornice's top from the fan, and every unit of
// it has to come out of the fan's half width, because the base cove's centre
// sits at the end of it and the outermost leaf must stay inboard of that
// centre. See the note above.
//
// `coveR` is the pinch. It sets how far the neck necks in (the base is
// 2*(cove centre - coveR) across) and it also lifts the whole fan by about
// twice itself, since the outer leaf hangs off the far side of the cove
// circle. 0.05 buys a base 0.48 across under a fan 0.73 across, which is the
// "springing from a small base" read, for 0.10 of height.
//
// The leaves are given as (angle off vertical, length from the fan's origin,
// radius). Angles at 40 degrees apart put the outer pair nearly horizontal,
// which is where an anthemion's outer leaves go, and 40 is also the tightest
// spacing that leaves a real gap between two leaves this fat: the chord
// between neighbouring leaf centres is 2*len*sin(20 degrees), so at len 0.29
// they are 0.198 apart with 0.16 of leaf between them and 0.038 of air. The
// middle leaf is a shade longer and fatter than its neighbours, which is what
// keeps the fan from reading as a scallop shell.
const PALMETTE = {
  ledge: 0.015,
  coveR: 0.05,
  valleyR: 0.032,
  leaves: [
    { ang: 0, len: 0.300, rad: 0.084 },
    { ang: 40, len: 0.288, rad: 0.080 },
    { ang: 80, len: 0.290, rad: 0.080 },
  ],
};

// ---------------------------------------------------------------------------
// outline helpers

const TAU = Math.PI * 2;

// One arc, with its sweep normalised. Every convex arc in this chain is walked
// counter-clockwise and every concave one clockwise -- that is what "sign" means
// once the outline itself is counter-clockwise -- and no arc here turns through
// a full circle, so folding the difference into (0, 2pi) with the sign picks the
// right branch without any of the callers having to think about it. The base
// cove turns through 174 degrees and the outermost leaf through 250; getting
// either of those branches backwards is a stone with its top inside out.
function arc(cx, cy, r, a0, a1, sign) {
  let d = (a1 - a0) % TAU;
  if (sign > 0 && d <= 0) d += TAU;
  if (sign < 0 && d >= 0) d -= TAU;
  return { cx, cy, r, a0, a1: a0 + d, sign };
}

// Centre of the fillet of radius rv that is externally tangent to both lobes,
// on the far side from `away`. Two circles of radius R+rv about the two lobe
// centres cross twice; one crossing is the notch between the lobes and the other
// is buried inside the fan.
function filletCentre(c1, R1, c2, R2, rv, away) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const r1 = R1 + rv;
  const r2 = R2 + rv;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  const p = [
    { x: mx - (h * dy) / d, y: my + (h * dx) / d },
    { x: mx + (h * dy) / d, y: my - (h * dx) / d },
  ];
  return Math.hypot(p[0].x - away.x, p[0].y - away.y) > Math.hypot(p[1].x - away.x, p[1].y - away.y) ? p[0] : p[1];
}

const angleTo = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

// The whole silhouette, counter-clockwise from the buried bottom-right corner.
// Only the right half is authored; the left is the same chain walked backwards
// with x negated, which is the only way five leaves are guaranteed to match.
function steleOutline() {
  const right = [];
  const y0 = H - SINK;
  const rb = 0.09; // buried, so any value that fits inside the slab will do
  right.push(arc(W - rb, y0 + rb, rb, -Math.PI / 2, 0, 1));

  // cornice: cove, fascia, roll
  const { coveR: rc, coveSweep: phi, fascia: Lf, rollR: rq } = CORNICE;
  right.push(arc(W + rc, H, rc, Math.PI, Math.PI - phi, -1));
  const coveEnd = { x: W + rc * (1 - Math.cos(phi)), y: H + rc * Math.sin(phi) };
  // Outward normal where the cove stops, and the direction the outline travels
  // there, which is that normal turned a quarter turn counter-clockwise.
  const n = { x: Math.cos(phi), y: -Math.sin(phi) };
  const t = { x: Math.sin(phi), y: Math.cos(phi) };
  const fascEnd = { x: coveEnd.x + Lf * t.x, y: coveEnd.y + Lf * t.y };
  const Cq = { x: fascEnd.x - rq * n.x, y: fascEnd.y - rq * n.y };
  right.push(arc(Cq.x, Cq.y, rq, -phi, Math.PI / 2, 1));
  const ledgeY = Cq.y + rq;

  // palmette: the base cove hangs off the end of the short ledge, tangent to it
  // from above, and the outermost leaf hangs off the far side of the cove.
  const rs = PALMETTE.coveR;
  const Cs = { x: Cq.x - PALMETTE.ledge, y: ledgeY + rs };
  const leaves = PALMETTE.leaves.map((L) => ({ ...L, a: (L.ang * Math.PI) / 180 }));
  const outer = leaves[leaves.length - 1];
  const lx = outer.len * Math.sin(outer.a);
  const dx = lx - Cs.x; // negative: the leaf stands inboard of the cove's centre
  const reach = outer.rad + rs;
  const dy = Math.sqrt(Math.max(1e-6, reach * reach - dx * dx));
  // Everything hangs off this: the fan's origin is wherever it has to be for the
  // outer leaf to land on the cove.
  const O = { x: 0, y: Cs.y + dy - outer.len * Math.cos(outer.a) };
  const centres = leaves.map((L) => ({ x: L.len * Math.sin(L.a), y: O.y + L.len * Math.cos(L.a) }));

  const baseA = Math.atan2(dy, dx);
  right.push(arc(Cs.x, Cs.y, rs, -Math.PI / 2, baseA, -1));

  // Outermost leaf inward: each leaf runs from where it met the last thing to
  // where it meets the notch above it, and each notch is walked the other way.
  let entry = baseA + Math.PI;
  for (let i = leaves.length - 1; i > 0; i--) {
    const c1 = centres[i];
    const c2 = centres[i - 1];
    const f = filletCentre(c1, leaves[i].rad, c2, leaves[i - 1].rad, PALMETTE.valleyR, O);
    const a1 = angleTo(c1, f);
    const a2 = angleTo(c2, f);
    right.push(arc(c1.x, c1.y, leaves[i].rad, entry, a1, 1));
    right.push(arc(f.x, f.y, PALMETTE.valleyR, a1 + Math.PI, a2 + Math.PI, -1));
    entry = a2;
  }

  // The middle leaf straddles the axis, so it is one arc from its right notch
  // round to the mirror of it.
  const mid = centres[0];
  const crown = arc(mid.x, mid.y, leaves[0].rad, entry, Math.PI - entry, 1);

  const left = right
    .map((c) => arc(-c.cx, c.cy, c.r, Math.PI - c.a1, Math.PI - c.a0, c.sign))
    .reverse();
  return [...right, crown, ...left];
}

// ---------------------------------------------------------------------------

registerStone('stele', {
  shape: SHAPE,
  // Both ends squared. The crown supplies the top and swallows the slab's own,
  // and a stele's foot is cut square to drop into a socket -- the registry's
  // default 0.09 would have rounded the shaft away just where it comes out of
  // the plinth, on a shaft this narrow.
  topRadius: 0,
  bottomRadius: 0,

  // A name and a farewell, which is the entire text on most Attic grave stelai.
  // XAIPE is the Greek word as it is actually cut -- chi alpha iota rho epsilon
  // are the same five shapes in this alphabet -- so it needs no font this
  // canvas does not have.
  //
  // Measured off the artwork: ink covers 4.6% of the face, in a box 74% of the
  // face wide by 25% of it tall. The approved stones run 5 to 10% and the
  // rejected set 12 to 19%, so this sits a shade under the quiet end, which is
  // where a stone whose silhouette is doing this much talking belongs. It is
  // also why there is no motif: the postmortem's rule is that a complex
  // silhouette gets no marking and a simple one gets exactly one, never both,
  // and the palmette is about as complex as this set gets.
  //
  // Letters come out 0.108 world tall against the cross's 0.122 and heart's
  // 0.088. Matching the set's letter SIZE is what has to hold rather than a
  // coverage figure -- a narrow face given proportionally narrow writing stops
  // looking like it came from the same yard -- and at this size the six letters
  // of the longer line fill 74% of the face, which is as wide as they go before
  // the outer ones start rolling round the rim.
  //
  // Both lines sit in the upper half, under the cornice, where a stele's
  // inscription is cut. The long blank run below them is the same trick the
  // obelisk uses: the eye finds the words, falls down the empty shaft, and the
  // drop is what sells the height.
  draw(ctx, w, h) {
    const size = h * 0.12;
    inkText(ctx, 'HEGESO', w / 2, h * 0.3, size, size * 0.04);
    inkText(ctx, 'XAIPE', w / 2, h * 0.46, size, size * 0.10);
  },

  extras({ body, material, shape, plinthH, edge, slabUV, disposables }) {
    const geo = buildArcSweepGeometry({
      outline: steleOutline(),
      depth: shape.depth,
      edge, // the slab's rim radius: the two have to agree or the joint shows
      // The slab's own mapping, so the crown's front face carries the same
      // texture in the same place and the coincident faces shade identically.
      // It clamps v, which is what the crown standing above the face needs.
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
