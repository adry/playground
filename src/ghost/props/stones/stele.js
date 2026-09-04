import * as THREE from 'three';
import { registerStone, buildArcSweepGeometry, inkText } from '../tombstones.js';

// The Greek stele: the tall thin one, with a palmette on its head.
//
// A narrow upright slab, a moulded cornice overhanging it on all four sides, and
// standing on that an anthemion: a fan of five fat rounded leaves springing out
// of a small base. The obelisk is the other tall stone in the set and the two
// must never be confused, so everything that separates them lives in the top
// third. The obelisk closes with one small pyramid and nothing else; this one
// flares twice, first into a cornice a quarter wider than the shaft and then
// into a fan nearly as wide again, and the shaft under them is longer and
// blanker than anything else in the set.
//
// THREE THINGS FAILED BEFORE THIS ONE WORKED, AND EACH IS A RULE
//
// 1. A CORNICE EXTRUDED FROM A 2D OUTLINE IS NOT A CORNICE. The registry's
// sweep, buildArcSweepGeometry, pushes an outline through a constant section, so
// a cornice drawn that way overhangs at the two ENDS of the stone and nowhere
// else. Seen from the front, which is how a headstone is seen, it has no
// projection, no soffit and no shadow line, and it reads as a pillow on top of
// the shaft. The cornice here is swept the other way instead -- the obelisk's
// way, a fixed plan carried up a stack of rings -- so the moulding is the same
// on all four sides. See corniceProfile below.
//
// 2. LEAVES MADE OF CIRCLES CANNOT GET OUT OF THEIR OWN BODY. The obvious
// palmette is heart.js's construction repeated: a row of circular lobes with a
// fillet in each notch. It does not work at five. The notch between two circles
// can only reach down to where their own rims come closest, so however the
// numbers are set, 60% of the fan's radius stays unbroken stone and what stands
// above it is five shallow scallops on a disc -- the bobble the brief warns
// about. Each leaf here is a TAPER instead: a fat round tip carried on two
// straight flanks that converge on the fan's own origin. A flank costs nothing
// in an arc chain (two arcs that end with the same normal are joined by a
// straight run, and a straight run between two tangent arcs offsets exactly),
// the notch fillet then sits at rv/sin(half the wedge of air) from the origin,
// and the leaves stand clear for half their length instead of a third.
//
// 3. THE SHAFT'S RIM RADIUS IS TOO BIG FOR FIVE LEAVES. The slab's rim is a
// fixed 0.062 and a convex arc keeps its radius MINUS the rim on the flat front
// face, so nothing swept with it may be thinner than about 0.13 across. Five
// leaves that thick, with gaps wide enough to read as gaps, is a fan 0.78 across
// and 0.40 tall; hang it off a shoulder cove and stand it on a cornice that
// needs a 0.09 roll for the same reason, and the crown alone comes to 0.88,
// which on any shaft worth carving is a stone taller than the obelisk. That is
// the one thing it may not be.
//
// So the palmette is swept separately, with a rim of its own at 0.036 on a plate
// 0.19 deep against the shaft's 0.23. That is not a dodge, it is what an
// akroterion is: a thinner slab set on the cornice rather than part of the
// shaft, and the set already does the same thing with the obelisk's pyramidion
// and the celtic wheel. Its base runs down INSIDE the cornice and comes up
// through the cornice's flat top, so the two solids never meet in a crease.
//
// THE SHOULDER COVE, AND THE POCKET UNDER THE OUTER LEAVES
//
// heart.js records the trick this stone leans on: a lobe tangent to a straight
// side from the inside buries its own top by one rim radius, and a concave cove
// is what lets it stand clear instead. The palmette's outermost leaf hangs off
// exactly such a cove, scooped out of the side of the little pillar the fan
// stands on, and the air it opens under that leaf is wanted -- a palmette's
// outer leaves do stand clear of the cornice.
//
// It has to be entered through the pillar's own vertical side, though, and that
// is worth knowing before anyone tries to widen the fan past the cornice. Walk
// an outline counter-clockwise: once past the widest point of the piece, every
// step along the top runs inward, so anything standing outboard of it can only
// be reached by turning round, and turning round costs a fillet of nearly half a
// turn -- a hook with a ledge caught in its mouth, which reads as a chip out of
// the stone. Here the two pieces are separate solids so the rule only binds
// within each, but the composition keeps it anyway: shaft 0.61, fan 0.68,
// cornice 0.78, each flare just inside the one above it.

// --- the numbers -----------------------------------------------------------
//
// A shaft 0.61 across by 1.00 tall on a 0.12 plinth, cornice 0.78 by 0.40,
// palmette 0.68 across, topping out at 1.73. Against the set: the cross is 0.92
// by 1.56 overall and the obelisk 0.60 by 1.85. So the face is the second
// narrowest in the set, a hair inside heart's 0.62 and just outside the
// obelisk's 0.60, and the height falls between the tallest slab and the obelisk
// rather than beside either.
//
// The shaft's own slenderness is 1:1.64 where the cross's is 1:1.49, and the
// whole stone's is 1:2.8. That is what the shaft is for: two short lines high
// up and half a metre of bare stone under them, and the drop is what sells the
// height.
//
// Face aspect 0.61, so the inscription canvas comes out 625 texels wide against
// the cross's 688. That is why the shaft is not thinner still -- the engraving
// treatment has a measured working range and a face much under 600 texels leaves
// no room for a groove that is both fine and legible -- and it is also why the
// shaft is not taller, because height is what makes the face narrow.
//
// Depth 0.23 on a 0.61 width, the same third the rest of the set runs at.
const W = 0.305;
const H = 1.00;
const SHAPE = { halfWidth: W, height: H, depth: 0.23, plinth: 0.12 };

// How far the cornice's tenon reaches down inside the slab. It only has to hold
// the cap on; nothing about it shows. Kept short so the inscription sits well
// clear of it.
const SINK = 0.16;

// --- the cornice -----------------------------------------------------------
//
// Three moves, each tangent to the last, and then a flat top for the palmette to
// stand on. It comes to 0.142 above the shaft and 0.085 out from it on every
// side, which makes it the widest and second-largest thing on the stone. That is
// deliberate: it is half of what separates this from the obelisk, and a palmette
// standing on nothing reads as a flower stuck on a post.
//
//   coveR/coveSweep  the cove under the overhang. A cove, not a soffit: a flat
//                    underside is a shelf, and a shelf is the one edge the rim
//                    cannot round. It is also what throws the shadow line across
//                    the top of the face that says "cornice" at scene scale.
//   fascia           NOT a parameter: the straight outward-leaning band is
//                    whatever run is left between the cove and the roll once the
//                    overhang is set, which is what makes `overhang` the one
//                    number that drives the whole cap. It is the only flat on
//                    the piece and it is what makes the cornice read as MOULDED
//                    rather than as a bulge.
//   rollR            the roll over the top, and the flat it leaves is where the
//                    palmette stands.
//   overhang         0.085 a side, 28% of the shaft's half width. Worth knowing
//                    before anyone grows it: this is the only overhang in the
//                    set, so it is the only piece that casts a shadow down a
//                    vertical face lit at 19 degrees of grazing, and the scene's
//                    shadow map quantises that shadow's lower edge into a fine
//                    scallop. It is well under a pixel at scene scale and it is
//                    a shadow-map limit, not the geometry: a deeper overhang
//                    makes it longer, not softer.
const CORNICE = {
  coveR: 0.05,
  coveSweep: (42 * Math.PI) / 180,
  rollR: 0.07,
  overhang: 0.085,
};

// --- the palmette ----------------------------------------------------------
//
// `depth`/`edge` are the plate's own, and the reason for them is at the top.
//
// `baseHalf` is the little pillar the fan springs from and `pillar` how far it
// stands proud of the cornice before the shoulder cove flares. `coveR` is that
// cove: it lifts the whole fan by about its own radius plus a leaf's, so it is
// the most expensive number here in height and it stays small.
//
// The leaves are (angle off vertical, length from the fan's origin, tip radius),
// and only the right half plus the middle one is given -- the left is mirrored,
// which is the only way five leaves are guaranteed to match. 42 degrees apart
// puts the outer pair a few degrees short of horizontal, where an anthemion's
// outer leaves go. Each leaf eats 2*asin(rad/len), about 28 degrees, at the
// root, which leaves a wedge of air of 13 degrees between neighbours: leaves
// roughly two and a half times the width of the gaps, which is the ratio that
// reads as a fan rather than as a comb.
//
// `baseR` is a dial that is deliberately at zero: it is the radius of a base
// circle the flanks would also be tangent to, which fattens every leaf's root
// and, at anything above about 0.02, pushes the notch fillets so far out that
// the fan closes up into a solid disc again. It is left in because it is the
// first thing anyone will reach for on being told the leaves look thin at the
// bottom, and it is the wrong lever: the right one is `rad`.
//
// `valleyR` is the whole argument about how deep the notches go, and it was
// settled by looking rather than by arithmetic. The fillet sits at
// valleyR/sin(half the wedge) from the origin, so a smaller radius drops it
// nearer the base: at 0.020 the leaves stand clear for two thirds of their
// length and the fan reads as a hand, at 0.036 for a third and it reads as a
// jigsaw piece, and 0.026 is where five fat lobes read as five fat lobes. Note
// which way that runs -- the deeper cut is the WORSE one -- because it is the
// opposite of what the arithmetic suggests.
const PALMETTE = {
  depth: 0.19,
  edge: 0.036,
  baseHalf: 0.15,
  pillar: 0.015,
  coveR: 0.04,
  baseR: 0,
  valleyR: 0.026,
  leaves: [
    { ang: 0, len: 0.305, rad: 0.075 },
    { ang: 42, len: 0.290, rad: 0.071 },
    { ang: 84, len: 0.272, rad: 0.070 },
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
function leafAt(O, L, baseR) {
  const mu = Math.PI / 2 - (L.ang * Math.PI) / 180;
  const alpha = Math.asin(Math.min(0.999, (L.rad - baseR) / L.len));
  const tip = { x: O.x + L.len * Math.cos(mu), y: O.y + L.len * Math.sin(mu) };
  // Each flank as an outward unit normal and the line's offset along it. The
  // normal's bearing is also the angle at which the flank meets the tip circle,
  // which is what makes the arc angles fall out with no further trigonometry.
  const flank = (side) => {
    const nb = mu + side * (alpha + Math.PI / 2);
    const m = { x: Math.cos(nb), y: Math.sin(nb) };
    return { m, p: O.x * m.x + O.y * m.y + baseR, at: nb };
  };
  return { ...L, mu, tip, lo: flank(-1), hi: flank(1) };
}

// Centre of the fillet of radius rv tangent to two lines from the inside, i.e.
// one radius out along each line's own outward normal.
function cornerFillet(a, b, rv) {
  const det = a.m.x * b.m.y - a.m.y * b.m.x;
  const ca = a.p + rv;
  const cb = b.p + rv;
  return { x: (ca * b.m.y - cb * a.m.y) / det, y: (a.m.x * cb - b.m.x * ca) / det };
}

// --- the cornice's meridian ------------------------------------------------
//
// A fixed plan -- the cornice's own rounded rectangle, the shaft's section grown
// by the overhang on every side -- carried up a stack of rings, each ring that
// plan offset INWARD by some amount. A constant inset shrinks a rounded
// rectangle exactly: every side moves in by the offset and every corner radius
// loses it, so one meridian gives the same moulding on all four sides and the
// overhang comes out equal front, back and end. Reason 1 at the top of this file
// is why it is built this way and not with the registry's sweep.
//
// This is the obelisk's machinery and it is written out again here because
// obelisk.js keeps its own copy private. See the report: two stones now want it.
function planOutline(halfX, halfZ, corner, seg) {
  const c = Math.min(corner, Math.min(halfX, halfZ) * 0.999);
  const out = [];
  for (const [ax, az, a0] of [
    [halfX - c, halfZ - c, 0],
    [-(halfX - c), halfZ - c, Math.PI / 2],
    [-(halfX - c), -(halfZ - c), Math.PI],
    [halfX - c, -(halfZ - c), Math.PI * 1.5],
  ]) {
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (Math.PI / 2) * (j / seg);
      const hx = Math.cos(a);
      const hz = Math.sin(a);
      out.push({ px: ax + c * hx, pz: az + c * hz, hx, hz });
    }
  }
  return out;
}

// A ring is { y, inset, dy, dInset }: the plan pulled in by `inset` and sat at
// height y, plus the meridian's own tangent there. For a plan that never scales,
// the surface normal at a plan point with outward horizontal normal h is
// (h.x*dy, dInset, h.z*dy), which is the one line that makes a cove, a straight
// fascia and a roll all the same function and keeps every normal analytic.
function sweepRings(plan, rings, uv) {
  const N = plan.length;
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const push = (x, y, z, nx, ny, nz) => {
    pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
    const [u, v] = uv(x, y, z);
    uvs.push(u, v);
  };
  for (const r of rings) {
    for (const p of plan) push(p.px - r.inset * p.hx, r.y, p.pz - r.inset * p.hz, p.hx * r.dy, r.dInset, p.hz * r.dy);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      idx.push(i * N + j, (i + 1) * N + j2, i * N + j2, i * N + j, (i + 1) * N + j, (i + 1) * N + j2);
    }
  }
  for (const [r, end, up] of [[rings[0], 0, -1], [rings[rings.length - 1], (rings.length - 1) * N, 1]]) {
    const c = pos.length / 3;
    push(0, r.y, 0, 0, up, 0);
    for (let j = 0; j < N; j++) idx.push(c, end + (up > 0 ? (j + 1) % N : j), end + (up > 0 ? j : (j + 1) % N));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// The meridian, bottom to top, and the numbers everything above the shaft is
// measured from. `over` is the overhang: the plan is the shaft's section grown
// by it on every side, so the roll's widest ring is the plan itself, at inset 0.
function corniceProfile(edge) {
  const { coveR: rc, coveSweep: phi, overhang: over, rollR: rq } = CORNICE;
  const rings = [];
  // The buried tenon, and the joint, which took two goes to get right.
  //
  // The rule is that the tenon must be strictly INSIDE the slab everywhere it is
  // buried and the cornice strictly OUTSIDE it everywhere it shows, with one
  // short ramp between, crossing the slab's face at a real angle. Anything that
  // leaves the two surfaces running a few thousandths apart over a band draws a
  // dotted line straight across the stone under the cornice, and a few
  // thousandths on a depth buffer is not a hairline. Note that "outside" has to
  // hold in Z as well: the slab is D/2 deep at its silhouette all the way to its
  // top, so a cornice that only overhangs in X leaves the slab's own top rim
  // poking through the front of the cove. That was the first dotted line.
  //
  // So the tenon runs a full 0.03 inside, the cove springs 0.006 outside at
  // exactly the height where the slab's squared top starts rounding away, and
  // the ramp between them is 0.008 tall so the two surfaces are only within a
  // rounding error of each other for a thousandth of the stone's height.
  //
  // And the reason it has to be 0.03 rather than a comfortable-looking 0.006 is
  // not depth precision at all, it is the SHADOW map: the tenon casts, the slab
  // receives, and the scene's normalBias is 0.006, so a tenon closer than that
  // to the slab's own face makes the slab shadow itself in a dotted band under
  // the cornice. It reads exactly like z-fighting and it is not.
  const lip = 0.006;
  const spring = H - edge;
  const i0 = over - lip;
  rings.push({ y: H - SINK, inset: over + 0.03, dy: 1, dInset: 0 });
  rings.push({ y: spring - 0.008, inset: over + 0.03, dy: 1, dInset: 0 });
  rings.push({ y: spring, inset: i0, dy: 0.22, dInset: -0.97 });
  const seg = 7;
  for (let k = 0; k <= seg; k++) {
    const a = (phi * k) / seg; // the cove: from the shaft's face round to the soffit
    rings.push({ y: spring + rc * Math.sin(a), inset: i0 - rc * (1 - Math.cos(a)), dy: Math.cos(a), dInset: -Math.sin(a) });
  }
  const y1 = spring + rc * Math.sin(phi);
  const i1 = i0 - rc * (1 - Math.cos(phi));
  // The fascia is whatever straight run is left between the cove and the roll,
  // which is what makes `overhang` the number that drives the cornice.
  const fascia = (i1 - rq * (1 - Math.cos(phi))) / Math.sin(phi);
  const y2 = y1 + fascia * Math.cos(phi);
  rings.push({ y: y2, inset: rq * (1 - Math.cos(phi)), dy: Math.cos(phi), dInset: -Math.sin(phi) });
  for (let k = 0; k <= seg; k++) {
    const b = -phi + (phi + Math.PI / 2) * (k / seg); // the roll, over to the flat top
    rings.push({ y: y2 + rq * (Math.sin(b) + Math.sin(phi)), inset: rq * (1 - Math.cos(b)), dy: Math.cos(b), dInset: Math.sin(b) });
  }
  return { rings, over, top: y2 + rq * (1 + Math.sin(phi)) };
}

// The palmette needs the cornice's flat top and nothing else about it. The rim
// radius is the registry's own fixed 0.062; corniceProfile takes it as an
// argument because extras() is handed the real one, and the two must agree.
const corniceTop = (edge) => corniceProfile(edge).top;

// The palmette. Its own sweep, its own rim, and its base runs down inside the
// cornice so the two never meet in a crease.
//
// Solved from the top down, because the fan's origin is not a free number: the
// outermost leaf's lower flank has to land on the shoulder cove, the cove has to
// sit on the little pillar, and the pillar has to stand on the cornice. So the
// origin is placed relative to the cove and everything else hangs off it.
function palmetteOutline(edge) {
  const P = PALMETTE;
  const ledgeY = corniceTop(edge);
  const O = { x: 0, y: 0 };
  const build = () => P.leaves.map((L) => leafAt(O, L, P.baseR));
  const outermost = (ls) => ls[ls.length - 1];

  // The pillar's own side, as a line in the same form as a flank. The shoulder
  // cove is just the fillet between it and the outermost leaf's lower flank, and
  // it touches the pillar at its own centre height -- which is the number the
  // whole fan hangs from. So it is solved once with the origin at zero, and then
  // the origin slides up by whatever it takes to land the cove on the pillar's
  // top and everything is rebuilt around it.
  const side = { m: { x: 1, y: 0 }, p: P.baseHalf, at: 0 };
  O.y = ledgeY + P.pillar - cornerFillet(side, outermost(build()).lo, P.coveR).y;
  const leaves = build();
  const cove = cornerFillet(side, outermost(leaves).lo, P.coveR);

  const rb = 0.06; // buried corner, and it has to clear this plate's own rim
  const yBot = ledgeY - 0.12;
  const right = [
    arc(P.baseHalf - rb, yBot + rb, rb, -Math.PI / 2, 0, 1),
    arc(cove.x, cove.y, P.coveR, Math.PI, outermost(leaves).lo.at + Math.PI, -1),
  ];

  // Outermost leaf inward. Each leaf is a tip cap between two straight flanks,
  // and each notch is a fillet dropped into the wedge of air between one leaf's
  // upper flank and the next one's lower one.
  for (let i = leaves.length - 1; i > 0; i--) {
    const a = leaves[i];
    const b = leaves[i - 1];
    right.push(arc(a.tip.x, a.tip.y, a.rad, a.lo.at, a.hi.at, 1));
    const f = cornerFillet(a.hi, b.lo, P.valleyR);
    right.push(arc(f.x, f.y, P.valleyR, a.hi.at + Math.PI, b.lo.at + Math.PI, -1));
  }
  // The middle leaf straddles the axis, so it is one cap from its right notch
  // round to the mirror of it.
  const mid = leaves[0];
  const crown = arc(mid.tip.x, mid.tip.y, mid.rad, mid.lo.at, mid.hi.at, 1);
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
  // Measured off the artwork: ink covers 3.5% of the face in a box 75% of the
  // face wide by 23% of it tall, against the approved set's own 3.8% (cross),
  // 6.8% (fred) and 9.2% (bat). So it sits a shade under the quietest stone in
  // the set, which is where this one belongs: the postmortem's rule is that a
  // complex silhouette gets no marking and a simple one gets exactly one, never
  // both, and a cornice with a five-leaf palmette on it is about as complex as
  // this set gets. The face is 612 texels wide, so the letters are 64 texels
  // tall and every stroke clears the treatment's 17-texel floor several times
  // over.
  //
  // Letters come out 0.105 world tall against the cross's 0.144 and heart's
  // 0.088. Matching the set's letter SIZE is what has to hold rather than a
  // coverage figure, and the longer line fills 75% of the face, which is as wide
  // as six letters go here before the outer ones start rolling round the rim.
  //
  // Both lines sit in the upper half, under the cornice, where a stele's
  // inscription is cut. The long blank run below them is the obelisk's trick:
  // the eye finds the words, falls down the empty shaft, and the drop is what
  // sells the height.
  draw(ctx, w, h) {
    const size = h * 0.105;
    inkText(ctx, 'HEGESO', w / 2, h * 0.28, size, size * 0.04);
    inkText(ctx, 'XAIPE', w / 2, h * 0.44, size, size * 0.1);
  },

  extras({ body, material, shape, plinthH, edge, stripUV, disposables }) {
    const add = (geo) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.y = plinthH; // both extras live in the shaft's own frame
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
      disposables.push(geo);
    };

    // Everything above the shaft samples the plain strip on the right of the
    // face texture, at its true height on the stone, so a moulding picks up
    // clean stone and no piece ever drags a letter round a corner.
    const parkUV = (span) => (x, y) => stripUV(x, y, span, H);

    const c = corniceProfile(edge);
    add(
      sweepRings(
        planOutline(W + c.over, shape.depth / 2 + c.over, edge + c.over, 8),
        c.rings,
        parkUV(W + c.over),
      ),
    );

    add(
      buildArcSweepGeometry({
        outline: palmetteOutline(edge),
        depth: PALMETTE.depth,
        edge: PALMETTE.edge,
        uv: parkUV(W),
      }),
    );
  },
});
