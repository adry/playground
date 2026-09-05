import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, toyMaterial } from '../style.js';
import { registerStone, inkText } from '../tombstones.js';

// The cairn: a pile of rough field stones heaped into a marker, with a small
// dressed slate leaned against the front of it carrying the inscription.
//
// THE ONLY QUESTION THIS PIECE HAS TO ANSWER
//
// Does it read as separate stones resting on each other, or as one lumpy mass?
// Nothing else about a stack matters, because at eighty pixels a mass of grey
// lumps is a potato and a stack of stones is a cairn, and the two are the same
// silhouette. Colour cannot tell them apart: every stone here is the set's one
// grey. Three things do, and each of them is measured rather than hoped for.
//
//   1. REAL CONTACT AND REAL OVERHANG. Every stone above the ground is dropped
//      onto the ones already placed and stopped at the first touch, by a height
//      field rasterised off their actual triangles. Nothing interpenetrates,
//      because two rocks pushed into each other weld into one shape, and
//      nothing floats, because a gap under a stone at this scale is a shadow
//      bug. The tiers are laid out so each one's outer edge lands just inside
//      the edge below it: an upper stone therefore overhangs the gap between
//      the two under it, and that overhang is what casts the dark line the eye
//      reads as a joint.
//   2. BAKED OCCLUSION. dirtpile.js already proved this on a heap of a hundred
//      and ten clods and its numbers are the ones worth repeating: the scene
//      has one shadow-casting key at 54 degrees and it cannot put a shadow in a
//      two centimetre crevice, so without a baked term a pile comes out as a
//      tray of pale pebbles. Every vertex here is tested against every other
//      stone's ellipsoid and darkened by what sits in front of it. That is
//      about sixty thousand distance tests at build time and nothing at all per
//      frame.
//   3. FACETS, NOT NOISE. A rock reads as a rock through a few large planes
//      meeting at soft edges. So a stone here is the intersection of eight to
//      eleven half spaces, blended rather than cut so every edge is a bead: see
//      fieldStone. The first pass used a sphere pushed onto an axis aligned
//      superellipsoid and rendered as a heap of pillows, because three planes
//      at right angles is not a rock, it is a bar of soap. There is no high
//      frequency displacement anywhere on any of them: at this camera distance
//      that is the film grain the house style bans, and it aliases.
//
// STABILITY. A pile whose centre of mass wanders off its base reads as about to
// fall, which is a different and worse feeling than old. Every tier is a ring
// about the axis with a bounded jitter, so the mass cannot walk off the base,
// and it is checked rather than asserted: the build measures its own centre of
// mass, weighted by each stone's volume, and leaves the offset in userData. It
// comes out under a tenth of the base radius on every seed tried, against a
// base radius the piece could in principle lean out to.
//
// THE LEAN. The registry offers every stone a small random lean and this one
// declines it, which is the first time in the set. A pile of loose stones
// cannot tilt as a rigid body: tip the whole cairn two degrees and the base
// stones tip with it, which no heap does, and on a base half a metre wide the
// far side lifts further than the registry's sink can bury. All the randomness
// this piece needs is already inside it, in a dozen separately seated stones.
// The one thing that does lean is the slate, which is a single dressed slab and
// is the only member of the piece a lean is true of.

const TAU = Math.PI * 2;

// --- the slate -------------------------------------------------------------
//
// shape.halfWidth and shape.height are NOT the cairn: they are the tablet, and
// they set the face texture's aspect and the slabUV mapping the inscription is
// carved through. The registry's own slab IS the tablet, moved and tipped in
// extras rather than thrown away, so the piece keeps the whole treatment: the
// two-map groove, the grime band, the mottle, for nothing.
//
// 0.62 by 0.52, and the two numbers were forced rather than chosen.
//
// The letter has to be the set's letter. Measured off the ink rather than off
// the font metrics, fred's capitals stand 0.093 world units and cross's 0.122,
// and a mark under that does not read as the same chisel however good the
// coverage number looks. Four capitals at that size need 0.43 of clear face. The catch is that a slab's front face is NOT as
// wide as the slab: the sweep insets it by the 0.062 rim radius all the way
// round, so a 0.50 wide slate has 0.376 of flat face and a word sized for the
// set wraps round the bead and up the side. Hence 0.62, which leaves 0.496 of
// flat, and hence the tablet being WIDER than it is tall, which is a plaque
// rather than a little headstone and is the better thing for it to be: a small
// upright slab in front of a cairn reads as a second grave marker.
//
// Depth is 0.15 because the rim radius is 0.062 and a slab thinner than twice
// that loses its front face and the sweep crosses itself.
const SLATE = { halfWidth: 0.31, height: 0.52, depth: 0.15 };
// How far back it leans, and the second job the lean does. The camera sits 29
// degrees up, so an upright face gives up most of itself: tipped back into this
// range the plaque turns toward the eye and reads about a fifth taller than it
// is. Which angle inside the range is solved for in extras, per seed, by asking
// which one actually lands the plaque's top edge on the pile.
const TIP = { lo: 0.20, hi: 0.46 };
// How far the slate presses into the stone it leans on, and how far its foot is
// buried. Both are well over the light's 0.006 normal bias, which is the floor
// under which a contact starts to shadow itself in a dotted band.
const SLATE_BITE = 0.012;
const SLATE_SINK = 0.006;

// --- the pile --------------------------------------------------------------
//
// Three rings and a capstone, biggest at the bottom. The base ring is four
// stones or three, so the stack is ten or nine, with one more hidden in the
// heart of it and one or two that have rolled off its foot. Few enough that the
// eye can count them, which is what stops a pile reading as gravel.
//
// A tier's ring radius is not a number anybody chose. It is the smallest radius
// at which n stones of that size do not overlap each other, hw / sin(pi / n),
// with a couple of per cent of daylight added. That single line is what makes
// the piece a cone: a ring of four cannot pull in without its stones welding
// into each other, a ring of three can pull in further, a ring of two further
// still, so the taper comes out of the COUNT rather than out of a profile curve
// somebody tuned. It is also how a cairn is really built, which is why it looks
// like one.
//
// `phase` turns the ring, in steps of its own spacing. Half a step per tier
// puts a stone over the gap below it rather than on the crown below it, which
// is where the overhangs come from. The base ring is turned so its GAP faces
// local +Z, the direction the layout points at the camera, and the tier above
// it puts a stone straight over that gap: that stone is what the slate leans
// against.
//
// The capstone is the exception to biggest at the bottom, and it is deliberate.
// A ring of two is still a ring: its stones touch at the middle and part above
// and below the touch, so the top of the pile is a V with the sky behind it,
// which is what the first build of this rendered. A capstone WIDER than the
// pair it sits on bridges that, overhangs it all the way round, and gives the
// pile the one broad horizontal plane the key light can land square on. Real
// cairns are finished this way for the same reason: it is what stops the top
// blowing apart.
//
// The pair below the capstone is turned to 45 degrees rather than to the half
// step the rest of the tiers use, and that is a sightline rather than a
// building decision. A ring of two parts along one line, and at a half step
// that line runs across the screen, so the notch between them is dead centre
// and the sky comes through it. Turned to 45 the pair sits along the camera's
// own axis, the near one covers the notch, and the pile is closed. The layout
// points every stone's +Z at the camera, so this holds where it matters.
const TIERS = [
  { n: 4, hw: 0.190, phase: 0.50 },
  { n: 3, hw: 0.175, phase: 0.00 },
  { n: 2, hw: 0.160, phase: 0.25 },
  { n: 1, hw: 0.185, phase: 0.00, flat: { lo: 0.38, hi: 0.50 }, tilt: 0.06, bite: 0.05, settle: 0.97, plateau: true },
];
const PACK = 1.02;
// Half height over half width, drawn per stone, and the height budget decides
// it rather than taste. Four courses have to make 0.9, so a course is 0.22 and
// a stone 0.38 across has to be about 0.3 thick. Tried at half of that, on the
// reasoning that a field stone is a slab, and the render was a stack of
// pancakes; tried the other way and it is a tower of dice. The spread is held
// narrow because four of these compound: at plus or minus a third one seed
// builds a pile a head taller than the next, and the scale that pulls it back
// takes the footprint with it.
const FLAT = { lo: 0.70, hi: 0.92 };
// The block. A stone is the intersection of this many half spaces, and `edge`
// is how sharply they meet: see fieldStone below. Eight to eleven faces on a
// stone this size puts them sixty or seventy degrees apart, which is a few
// large planes rather than a chipped surface. The first pass used an
// axis aligned superellipsoid instead and rendered as a heap of pillows: three
// planes at right angles is not a rock, it is a bar of soap.
const FACES = { lo: 8, hi: 11 };
const EDGE = { lo: 6.5, hi: 11.0 };
// Total height, before the slate. The piece is one of the low ones, under fred's
// 1.10 and over the book's 0.81. The built pile is nudged toward this, but only
// nudged: the scale is clamped hard, because a stack's height is the sum of a
// dozen seeded numbers and correcting all of that drift with a scale would move
// the FOOTPRINT by as much, and the layout generator has to be told one number
// for the footprint that holds on every seed.
const HEIGHT = { lo: 0.86, hi: 0.98 };
const SCALE_CLAMP = 0.10;
// How far a stone is pushed past first touch. Enough that the joint is a real
// intersection rather than a mathematical tangent, which under a 0.006 normal
// bias reads as a floating stone.
const BITE = 0.020;

// --- the paint -------------------------------------------------------------
//
// Multipliers on the set's grey, not colours of their own: the hue stays
// PALETTE.stone and the map keeps carrying the mottle and the grime, so a cairn
// cannot drift away from the stone standing next to it. What these do is the
// modelling the one key light cannot: an up-facing crown a shade brighter than
// the base grey, a flank below it, and a crevice well under both.
const FACE_UP = 1.02;
const FACE_SIDE = 0.80;
const FACE_UNDER = 0.42;
// Per stone. Half a stop between neighbours is another thing that says two
// stones rather than one mass, and it is the same trick dirtpile uses on clods.
// Narrower here than there, because these are all the same grey stone rather
// than wet earth and dry earth.
const TONE = { lo: 0.87, hi: 1.06 };
// Occlusion. REACH is in occluder radii; DEPTH is how black a full crevice
// goes. Both are dirtpile's numbers, which were tuned against this same floor
// and this same key.
const OCC_REACH = 2.1;
const OCC_DEPTH = 0.70;
// The floor occludes too, and it is the one occluder that is not a stone: the
// underside of a base stone within this of the ground loses light no directional
// key can put back.
const GROUND_REACH = 0.11;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// One field stone: a broken block with a handful of broad faces and soft edges
// between them.
//
// The shape is the intersection of eight to eleven half spaces, softened. It is
// written as a p-norm rather than as a minimum, because a minimum gives a knife
// edge where two faces meet and this house has none: the radius along a
// direction is
//
//   r = (sum over faces of (dir . n / d) ^ q) ^ (-1/q)
//
// which is flat where one term dominates, a rounded blend where two or three
// do, and exactly a superellipsoid if the faces happen to be the six axis ones.
// q is the edge, and it is the one knob that decides whether this is a river
// cobble or a quarry block: at 4 the edges round off to about a fifth of the
// stone's width and it renders as a pebble, at 11 to a fortieth, which is a
// bead of about a centimetre and is where this sits. Much sharper than that
// starts to alias, because the sphere it is sampled on has no vertices lined up
// with an edge that arrived after it.
//
// Face normals come off a Fibonacci sphere rather than out of a random number
// generator, jittered afterwards. Drawn at random, eight directions clump: two
// land a few degrees apart and merge into one face, and the stone comes out
// with a bald side.
//
// The sphere is welded shut before any of this. SphereGeometry carries a seam
// of duplicated vertices where its uv wraps and a fan of them at each pole, and
// computeVertexNormals gives each copy a normal of its own: a visible crease
// straight down the side of every rock. uv is deleted before the weld for the
// same reason, since two vertices at one position with different uv will not
// merge, and this piece writes its own uv later anyway.
function fieldStone(rng, seg, faces, q) {
  let geo = new THREE.SphereGeometry(0.5, seg[0], seg[1]);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);

  const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * TAU, rng() * TAU, rng() * TAU));
  const plane = [];
  for (let i = 0; i < faces; i++) {
    const y = 1 - (2 * i + 1) / faces;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    const n = new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad).applyQuaternion(spin);
    n.x += (rng() - 0.5) * 0.30;
    n.y += (rng() - 0.5) * 0.30;
    n.z += (rng() - 0.5) * 0.30;
    n.normalize();
    // How far out each face sits. This spread is most of what makes one stone
    // a different stone from the next: a near face and a far face on opposite
    // sides is a wedge, two near ones is a slab.
    plane.push({ n, d: 0.5 * (0.78 + rng() * 0.40) });
  }

  const p = geo.attributes.position;
  const ph = [rng() * TAU, rng() * TAU];
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    d.copy(v).multiplyScalar(2); // the unit direction this vertex sits on
    let acc = 0;
    for (const f of plane) {
      const t = (d.x * f.n.x + d.y * f.n.y + d.z * f.n.z) / f.d;
      if (t > 0) acc += Math.pow(t, q);
    }
    let k = acc > 1e-6 ? Math.pow(acc, -1 / q) : 1;
    // Two slow bends, so a face is never dead flat. Less than one cycle across
    // the whole stone: anything faster than this is the film grain the set
    // bans, and on a facet it would come back through the normals as hammered
    // metal.
    k *= 1 + 0.035 * Math.sin(2.1 * d.x + ph[0]) + 0.030 * Math.sin(1.9 * d.z + ph[1]);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }

  // Normalised back onto a unit block, so the scale applied outside means
  // exactly what it says and the stack's height is predictable. A faceted
  // stone's own extents depend on where its corners happened to land, and
  // without this a seed that drew all its faces close in builds a pile a head
  // shorter than the next.
  let mx = 0;
  let my = 0;
  let mz = 0;
  const q3 = p.array;
  for (let i = 0; i < q3.length; i += 3) {
    mx = Math.max(mx, Math.abs(q3[i]));
    my = Math.max(my, Math.abs(q3[i + 1]));
    mz = Math.max(mz, Math.abs(q3[i + 2]));
  }
  geo.scale(0.5 / mx, 0.5 / my, 0.5 / mz);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Height fields, and they are the whole contact story.
//
// A field is one number per cell of a plane through the pile: `iu` and `iv` say
// which two position components index it and `iw` which one it stores. Rasterised
// off the real triangles rather than off vertices, because a vertex cloud leaves
// holes between its samples and a hole in a contact test is a stone that sinks
// through the pile.
//
// Two of them are used. Seen from above (u=x, v=z, w=y) it answers "how high is
// the pile at this column", which is what a dropped stone lands on. Seen from
// the front (u=x, v=y, w=z) it answers "how far forward does the pile reach at
// this point of the face", which is what the slate leans against.
// `unset` is what a cell that no triangle touched reads as, and it is not
// always `init`: the top field starts at the FLOOR, zero, which is a real
// surface a stone may land on, so it has no unset value at all.
function makeField({ u0, v0, cell, nu, nv, init, unset = init }) {
  return { u0, v0, cell, nu, nv, unset, data: new Float32Array(nu * nv).fill(init) };
}

function splat(field, geo, iu, iv, iw, keepBigger) {
  const p = geo.attributes.position.array;
  const idx = geo.index.array;
  const { u0, v0, cell, nu, nv, data } = field;
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t] * 3;
    const ib = idx[t + 1] * 3;
    const ic = idx[t + 2] * 3;
    const au = p[ia + iu], av = p[ia + iv], aw = p[ia + iw];
    const bu = p[ib + iu], bv = p[ib + iv], bw = p[ib + iw];
    const cu = p[ic + iu], cv = p[ic + iv], cw = p[ic + iw];
    const den = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
    if (Math.abs(den) < 1e-12) continue; // edge on to this plane, its neighbours cover it
    const lo0 = Math.max(0, Math.floor((Math.min(au, bu, cu) - u0) / cell));
    const hi0 = Math.min(nu - 1, Math.ceil((Math.max(au, bu, cu) - u0) / cell));
    const lo1 = Math.max(0, Math.floor((Math.min(av, bv, cv) - v0) / cell));
    const hi1 = Math.min(nv - 1, Math.ceil((Math.max(av, bv, cv) - v0) / cell));
    for (let j = lo1; j <= hi1; j++) {
      const vv = v0 + (j + 0.5) * cell;
      for (let i = lo0; i <= hi0; i++) {
        const uu = u0 + (i + 0.5) * cell;
        const l1 = ((bv - cv) * (uu - cu) + (cu - bu) * (vv - cv)) / den;
        if (l1 < -1e-4) continue;
        const l2 = ((cv - av) * (uu - cu) + (au - cu) * (vv - cv)) / den;
        if (l2 < -1e-4) continue;
        const l3 = 1 - l1 - l2;
        if (l3 < -1e-4) continue;
        const w = l1 * aw + l2 * bw + l3 * cw;
        const at = j * nu + i;
        const cur = data[at];
        if (keepBigger ? w > cur : w < cur) data[at] = w;
      }
    }
  }
}

// How far `moving` has to travel along the field's own axis before it stops
// overlapping `fixed`. Positive means it is currently through the pile and has
// to back off; negative means it is clear by that much.
function clearance(fixed, moving, quantile = 1) {
  if (quantile >= 1) {
    let worst = -Infinity;
    for (let i = 0; i < fixed.data.length; i++) {
      const m = moving.data[i];
      if (m === moving.unset) continue;
      const f = fixed.data[i];
      if (f === fixed.unset) continue;
      const d = f - m;
      if (d > worst) worst = d;
    }
    return worst;
  }
  // Under one, the stone is allowed to bury the sharpest few per cent of what
  // it lands on. That is the capstone's setting and it exists because of one
  // seed: the cap came down on a single knuckle of the stone below, stopped
  // dead on it, and left daylight under the rest of itself, which reads as a
  // rock hovering however true the contact is. Letting the knuckle through by
  // a centimetre sets the cap down on the broad support underneath instead.
  const all = [];
  for (let i = 0; i < fixed.data.length; i++) {
    const m = moving.data[i];
    if (m === moving.unset) continue;
    const f = fixed.data[i];
    if (f === fixed.unset) continue;
    all.push(f - m);
  }
  if (!all.length) return -Infinity;
  all.sort((a, b) => a - b);
  return all[Math.floor(quantile * (all.length - 1))];
}

// Where the top of the pile is FLAT, as a weighted centre of every column
// within `band` of the highest one inside `radius`.
//
// This is where the capstone goes, and it is not the axis. Dropped on the axis
// it lands on whatever knuckle happens to be highest there and hangs over the
// void beside it, which on one seed in four read as a rock balanced on a point:
// the wrong kind of old. Put on the plateau instead, it lands on the broadest
// support the pile actually offers and its overhang is even all the way round,
// which is the difference between precarious and settled.
function plateauCentre(field, radius, band) {
  const { u0, v0, cell, nu, nv, data } = field;
  let peak = -Infinity;
  for (let j = 0; j < nv; j++) {
    const v = v0 + (j + 0.5) * cell;
    for (let i = 0; i < nu; i++) {
      const u = u0 + (i + 0.5) * cell;
      if (u * u + v * v > radius * radius) continue;
      const h = data[j * nu + i];
      if (h > peak) peak = h;
    }
  }
  let w = 0;
  let su = 0;
  let sv = 0;
  for (let j = 0; j < nv; j++) {
    const v = v0 + (j + 0.5) * cell;
    for (let i = 0; i < nu; i++) {
      const u = u0 + (i + 0.5) * cell;
      if (u * u + v * v > radius * radius) continue;
      const h = data[j * nu + i];
      if (h < peak - band) continue;
      const k = h - (peak - band);
      w += k;
      su += k * u;
      sv += k * v;
    }
  }
  return w > 0 ? { x: su / w, z: sv / w } : { x: 0, z: 0 };
}

// ---------------------------------------------------------------------------
// The paint.
//
// Occlusion is the half that matters. Each stone stands in for itself as an
// ellipsoid: a vertex is mapped into the occluder's own frame, the nearest
// point on its surface is taken, and what is left is a world distance. Only an
// occluder IN FRONT of the surface counts, which dirtpile learned the hard way:
// without that test every clod is shaded by the one it is sitting on, including
// on its top, and the whole heap goes muddy.
function paintStone(geo, stone, all, index) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const local = new THREE.Vector3();
  const near = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    nv.fromBufferAttribute(n, i);

    let occ = 0;
    for (let j = 0; j < all.length; j++) {
      if (j === index) continue;
      const o = all[j];
      local.copy(v).applyMatrix4(o.inverse);
      const len = local.length();
      if (len < 1e-6) continue;
      near.copy(local).multiplyScalar(0.5 / len).applyMatrix4(o.matrix);
      const dx = near.x - v.x;
      const dy = near.y - v.y;
      const dz = near.z - v.z;
      const reach = o.radius * OCC_REACH;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reach * reach) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const facing = (dx * nv.x + dy * nv.y + dz * nv.z) / d;
      if (facing <= 0) continue;
      occ += facing * (1 - d / reach);
    }
    // The floor is the one occluder that is not a stone. An underside close to
    // it is in a crevice like any other, and this is what draws the dark line
    // where a base stone meets the ground on the side the key light does reach.
    if (nv.y < 0 && v.y < GROUND_REACH) occ += -nv.y * (1 - v.y / GROUND_REACH) * 0.8;
    occ = clamp01(occ * 0.85);

    const ny = nv.y;
    const facing = ny >= 0
      ? lerp(FACE_SIDE, FACE_UP, smoothstep(0.05, 0.85, ny))
      : lerp(FACE_SIDE, FACE_UNDER, smoothstep(0, -0.6, ny));
    const k = facing * (1 - OCC_DEPTH * occ) * stone.tone;
    col[i * 3] = k;
    col[i * 3 + 1] = k;
    col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

registerStone('cairn', {
  // plinth 0: no plinth. A heap of stones is not set on a pad, and the registry
  // takes zero to mean none rather than folding the sweep on a thin one.
  shape: { halfWidth: SLATE.halfWidth, height: SLATE.height, depth: SLATE.depth, plinth: 0 },
  // A slate, so the top is barely eased rather than arched. The arch is the
  // registry's default and it would make this a small headstone, which is the
  // one thing the tablet must not read as: the cairn is the marker here.
  topRadius: 0.13,
  bottomRadius: 0.085,

  // One word, on the one flat surface the piece has, and one is all that fits.
  // The face is 0.496 of clear flat, the set's own letter is 0.09 to 0.13 of
  // cap height, and four capitals at that size fill 86% of it. A second line
  // would have to come down to 0.07, which is smaller than anything in the set
  // and is exactly the busy lettering the last round was rejected for: measured
  // two up, this face goes to 8.5% ink.
  //
  // Measured on its own 1221 by 1024 face: 4.9% ink at a cap height of 0.088
  // world units and a word 86% of the clear face wide, against cross 3.8% at
  // 0.122 and fred 6.8% at 0.093. A piece whose identity is its silhouette
  // belongs at the light end of the ink, and this one's identity is a heap of
  // rocks.
  draw(ctx, w, h) {
    const size = h * 0.254;
    inkText(ctx, 'HOME', w / 2, h * 0.505, size, size * 0.05);
  },

  extras({ body, slab, material, rng, disposables, stripUV, lean, frontFrac, stripFrac }) {
    // See the note at the top: this stone stands level on purpose. What the
    // registry would have tilted is a dozen loose rocks, which do not tilt
    // together.
    lean.enabled = false;
    lean.sink = -0.006;

    // --- lay the stack out ---------------------------------------------------
    //
    // Every stone is placed before any is built, and placed as a ring per tier
    // with the ring turned so the tier below shows a gap where this one shows a
    // stone. The base ring is turned so its OWN gap faces local +Z, which is
    // the face direction the layout points at the camera: that notch is what
    // the slate leans into, and it is why the slate reads as propped rather
    // than as a headstone standing in front of a heap.
    const baseN = rng() < 0.55 ? 4 : 3;
    const stones = [];
    let outer0 = 0;
    // The heart of the pile, and the only stone here not meant to be seen. A
    // ring of four leaves a hole 0.17 across in the middle of the base and the
    // camera looks down at 29 degrees: without this the eye goes through the
    // top of the cairn to the floor, and a marker you can see the ground
    // through is a circle of rocks, not a pile. It is low and it is seated
    // before anything else, so it fills the hole and nothing rests on it.
    const core = {};
    stones.push(core);
    for (let t = 0; t < TIERS.length; t++) {
      const tier = TIERS[t];
      const n = t === 0 ? baseN : tier.n;
      const hw = tier.hw * (0.94 + rng() * 0.12);
      // The smallest ring n of these fit round without touching each other.
      const ring = n === 1 ? 0.02 : (hw / Math.sin(Math.PI / n)) * PACK;
      if (t === 0) {
        outer0 = ring + hw;
        core.x = (rng() - 0.5) * 0.05;
        core.z = (rng() - 0.5) * 0.05;
        core.hx = hw * 0.78;
        core.hy = hw * 0.46;
        core.hz = hw * 0.78;
        core.faces = Math.round(lerp(FACES.lo, FACES.hi, rng()));
        core.edge = lerp(EDGE.lo, EDGE.hi, rng());
        core.euler = new THREE.Euler(0, rng() * TAU, 0);
        core.seg = [16, 11];
        core.tone = lerp(TONE.lo, TONE.hi, rng());
      }
      const a0 = (tier.phase * TAU) / n + (rng() - 0.5) * 0.18;
      for (let i = 0; i < n; i++) {
        const th = a0 + (i * TAU) / n + (rng() - 0.5) * 0.24;
        const r = ring * (0.97 + rng() * 0.10);
        const w = hw * (0.90 + rng() * 0.20);
        const spread = tier.flat || FLAT;
        const flat = lerp(spread.lo, spread.hi, rng());
        const tilt = tier.tilt ?? 0.17;
        stones.push({
          x: Math.sin(th) * r,
          z: Math.cos(th) * r,
          // Half extents. The long axis of a field stone is rarely the one you
          // set it down on, hence the second, independent width.
          hx: w,
          hy: w * flat,
          hz: w * (0.82 + rng() * 0.30),
          faces: Math.round(lerp(FACES.lo, FACES.hi, rng())),
          edge: lerp(EDGE.lo, EDGE.hi, rng()),
          euler: new THREE.Euler((rng() - 0.5) * tilt, rng() * TAU, (rng() - 0.5) * tilt),
          // The capstone settles into the notch between the two under it rather
          // than perching on whichever of them came out taller.
          bite: tier.bite ?? BITE,
          settle: tier.settle ?? 1,
          plateau: !!tier.plateau,
          seg: t === 0 ? [30, 20] : [26, 17],
          tone: lerp(TONE.lo, TONE.hi, rng()),
        });
      }
    }
    // One or two that have come off the pile and are lying at its foot. They
    // widen the footprint a little and they are most of what tells two cairns
    // apart at a glance, since they are the only stones not on the axis.
    const loose = rng() < 0.45 ? 1 : 2;
    for (let i = 0; i < loose; i++) {
      // Kept out of the front sixty degrees, which belongs to the slate.
      const th = 0.55 + rng() * (TAU - 1.1);
      const w = 0.070 + rng() * 0.048;
      stones.push({
        x: Math.sin(th) * outer0 * (0.76 + rng() * 0.18),
        z: Math.cos(th) * outer0 * (0.76 + rng() * 0.18),
        hx: w,
        hy: w * (0.52 + rng() * 0.18),
        hz: w * (0.80 + rng() * 0.30),
        faces: Math.round(lerp(FACES.lo, FACES.hi, rng())),
        edge: lerp(EDGE.lo, EDGE.hi, rng()),
        euler: new THREE.Euler((rng() - 0.5) * 0.5, rng() * TAU, (rng() - 0.5) * 0.5),
        seg: [20, 13],
        tone: lerp(TONE.lo, TONE.hi, rng()),
      });
    }

    // --- drop each one onto the pile ------------------------------------------
    //
    // The top field starts as the floor, so a stone with nothing under it lands
    // on the ground and a stone over the pile lands on the pile, by the same
    // line of code and with no case to get wrong.
    const CELL = 0.012;
    const SPAN = 1.8;
    const N = Math.ceil(SPAN / CELL);
    const dims = { u0: -SPAN / 2, v0: -SPAN / 2, cell: CELL, nu: N, nv: N };
    const top = makeField({ ...dims, init: 0, unset: -Infinity });

    for (const s of stones) {
      if (s.plateau) {
        const at = plateauCentre(top, outer0 * 0.52, 0.05);
        s.x = at.x + s.x * 0.3;
        s.z = at.z + s.z * 0.3;
      }
      const geo = fieldStone(rng, s.seg, s.faces, s.edge);
      geo.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(s.x, 0, s.z),
        new THREE.Quaternion().setFromEuler(s.euler),
        new THREE.Vector3(s.hx * 2, s.hy * 2, s.hz * 2),
      ));
      const under = makeField({ ...dims, init: Infinity });
      splat(under, geo, 0, 2, 1, false);
      const lift = clearance(top, under, s.settle ?? 1) - (s.bite ?? BITE);
      geo.translate(0, lift, 0);
      splat(top, geo, 0, 2, 1, true);
      s.geo = geo;
      s.y = lift;
    }

    // --- hold the height ------------------------------------------------------
    //
    // The stack's height is the sum of a dozen seeded numbers, so it wanders by
    // a good fifteen per cent between seeds. The silhouette is not allowed to:
    // this is a low piece and the layout places it as one. So the built pile is
    // measured and scaled to the target, which is the one operation that cannot
    // break a contact, since it moves every stone and every joint by the same
    // factor.
    let crest = 0;
    for (const s of stones) {
      const p = s.geo.attributes.position.array;
      for (let i = 1; i < p.length; i += 3) if (p[i] > crest) crest = p[i];
    }
    const wanted = lerp(HEIGHT.lo, HEIGHT.hi, rng());
    const S = Math.min(1 + SCALE_CLAMP, Math.max(1 - SCALE_CLAMP, wanted / crest));
    for (const s of stones) {
      s.geo.scale(S, S, S);
      s.x *= S; s.y *= S; s.z *= S;
      s.hx *= S; s.hy *= S; s.hz *= S;
    }

    // Each stone as an occluder: its own ellipsoid, and the matrix that carries
    // a point into and out of it.
    for (const s of stones) {
      s.matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(s.x, s.y, s.z),
        new THREE.Quaternion().setFromEuler(s.euler),
        new THREE.Vector3(s.hx * 2, s.hy * 2, s.hz * 2),
      );
      s.inverse = s.matrix.clone().invert();
      s.radius = (s.hx + s.hy + s.hz) / 3;
    }

    // --- paint, map and merge -------------------------------------------------
    //
    // uv is planar: up the pile for v, across it for u, which is how the
    // registry's own plinth samples the plain strip and gives neighbouring
    // stones one continuous grain, like rock off one hillside. Every stone also
    // picks up the grime band at the bottom of the texture in proportion to how
    // low it sits, for free.
    //
    // The catch is the strip's shape. It is 160 texture pixels wide against
    // 1024 tall, so mapping the pile's whole half metre across it stretches the
    // mottle by a factor of eleven and the stone comes out combed. So u is
    // ping-ponged instead: it runs across the strip, folds back, and runs
    // across again, once every GRAIN of world. Fold rather than repeat because
    // the texture is clamped at its edges and a repeat would show a hard seam
    // at every wrap, while a fold is continuous and, since the u derivative only
    // changes sign there, samples the same mip level either side of it.
    //
    // GRAIN is the width that makes the strip's own pixels square, derived from
    // the two fractions the registry hands over rather than from its texture
    // size, which is not in the contract.
    const reach = outer0 * S + 0.1;
    const GRAIN = wanted * 0.7 * (stripFrac / frontFrac) * ((2 * SLATE.halfWidth) / SLATE.height);
    const fold = (x) => {
      const t = (x / GRAIN) % 2;
      return (Math.abs((t < 0 ? t + 2 : t) - 1) - 0.5) * 2 * reach;
    };
    for (let i = 0; i < stones.length; i++) {
      const geo = stones[i].geo;
      paintStone(geo, stones[i], stones, i);
      const p = geo.attributes.position;
      const uv = new Float32Array(p.count * 2);
      for (let k = 0; k < p.count; k++) {
        const [u, vv] = stripUV(fold(p.getX(k)), p.getY(k), reach, wanted);
        uv[k * 2] = u;
        uv[k * 2 + 1] = vv;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }

    const merged = mergeGeometries(stones.map((s) => s.geo), false);
    for (const s of stones) s.geo.dispose();
    // One extra material, and it carries the same colour and the same two maps
    // as the rest of the piece: all it adds is vertexColors, which is where the
    // occlusion and the facing live. Without it the set's shared material would
    // have to grow a flag every stone pays for.
    const rock = toyMaterial(PALETTE.stone, {
      map: material.map,
      normalMap: material.normalMap,
      vertexColors: true,
      roughness: 0.88,
    });
    const pile = new THREE.Mesh(merged, rock);
    pile.castShadow = true;
    pile.receiveShadow = true;
    body.add(pile);
    disposables.push(merged, rock);

    // --- lean the slate -------------------------------------------------------
    //
    // The pile seen from the front, so the slate can be stood against it. Same
    // rasteriser, turned a quarter turn: u is x across the face, v is height, w
    // is how far forward the pile reaches.
    const fdims = { u0: -1.0, v0: -0.05, cell: CELL, nu: Math.ceil(2.0 / CELL), nv: Math.ceil(1.35 / CELL) };
    const front = makeField({ ...fdims, init: -Infinity, unset: -Infinity });
    splat(front, merged, 0, 1, 2, true);

    const roll = (rng() - 0.5) * 0.07;
    const yaw = (rng() - 0.5) * 0.09;
    // The slate is turned about its own bottom BACK edge, which is the edge it
    // actually pivots on when somebody leans it against a heap of stones, and
    // that edge starts at the origin. The solver only ever pushes it forward
    // from there, so a candidate that starts inside the pile is safe and one
    // that starts outside it could never find the pile at all.
    const poseAt = (tip, dz = 0, dy = 0) => new THREE.Matrix4()
      .makeTranslation(0, dy, dz)
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeRotationZ(roll))
      .multiply(new THREE.Matrix4().makeRotationX(-tip))
      .multiply(new THREE.Matrix4().makeTranslation(0, 0, SLATE.depth / 2));

    // The angle is solved rather than picked. For each candidate the slate is
    // pushed forward until no part of it is inside the pile, and then the gap
    // still left at its TOP edge is measured. What is wanted is the most
    // upright slate that still touches: tipping it further only walks its foot
    // out into the open, and a slate whose top does not touch is a slate
    // standing near a cairn rather than leaning on one. Nine candidates, each
    // one rasterise of a slab, is a couple of milliseconds at build time.
    // Where the search starts moves per seed, so two cairns standing together
    // do not lean their slates at the same angle. It only ever starts more
    // upright than it ends.
    const tip0 = TIP.lo + rng() * 0.10;
    const CLOSE = 0.015;
    let best = null;
    for (let k = 0; k <= 8; k++) {
      const tip = lerp(tip0, TIP.hi, k / 8);
      const probe = slab.geometry.clone();
      probe.applyMatrix4(poseAt(tip));
      const back = makeField({ ...fdims, init: Infinity });
      splat(back, probe, 0, 1, 2, false);
      const push = clearance(front, back);
      // The top band of the slate, once that push is applied.
      const p = probe.attributes.position.array;
      let head = -Infinity;
      for (let i = 1; i < p.length; i += 3) if (p[i] > head) head = p[i];
      let gap = Infinity;
      for (let j = 0; j < fdims.nv; j++) {
        if (fdims.v0 + (j + 0.5) * CELL < head - 0.16) continue;
        for (let i = 0; i < fdims.nu; i++) {
          const f = front.data[j * fdims.nu + i];
          const b = back.data[j * fdims.nu + i];
          if (f === -Infinity || b === Infinity) continue;
          const g = b + push - f;
          if (g < gap) gap = g;
        }
      }
      probe.dispose();
      if (!Number.isFinite(gap) || !Number.isFinite(push)) continue;
      if (!best || gap < best.gap) best = { tip, push, gap };
      if (gap <= CLOSE) break; // the first one that lands is the one to keep
    }
    // A pile is never so tidy that no candidate reaches it, but if one ever
    // were the slate still stands, upright and clear, rather than vanishing.
    const tip = best ? best.tip : tip0;
    const push = (best ? best.push : 0.42) - SLATE_BITE;

    // Seated on its own vertices under its own matrix. Box3.setFromObject is
    // the wrong tool here: it grows the local box by the rotation and hands
    // back a tumbling cube's corner, which on a slab tipped a quarter of a
    // radian is wrong by most of its depth.
    const seat = poseAt(tip, push);
    const p = slab.geometry.attributes.position;
    const v = new THREE.Vector3();
    let low = Infinity;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(seat);
      if (v.y < low) low = v.y;
    }
    // The pose is a rotation about a point that is not the origin, so it is a
    // translation as well as a turn and cannot be split into a position and a
    // quaternion by hand. Decompose does it exactly, and the result is a rigid
    // transform, so the scale that comes back is 1.
    poseAt(tip, push, -low - SLATE_SINK).decompose(slab.position, slab.quaternion, slab.scale);

    // --- centre the footprint -------------------------------------------------
    //
    // The pile is built about the origin and the slate stands well in front of
    // it, so the piece as a whole is a third of a metre longer forward than
    // back. The layout generator tests a box of HALF extents about the origin,
    // which for an off-centre prop has to be the larger side doubled, so it
    // would reserve a third of a metre of empty ground behind every cairn.
    // Slid back onto its own centre instead, and measured off the vertices
    // rather than off a bounding box, since the slate is rotated.
    const span = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    const at = new THREE.Vector3();
    for (const mesh of body.children) {
      if (!mesh.isMesh) continue;
      mesh.updateMatrix();
      const q = mesh.geometry.attributes.position;
      for (let i = 0; i < q.count; i++) {
        at.fromBufferAttribute(q, i).applyMatrix4(mesh.matrix);
        if (at.x < span.x0) span.x0 = at.x;
        if (at.x > span.x1) span.x1 = at.x;
        if (at.z < span.z0) span.z0 = at.z;
        if (at.z > span.z1) span.z1 = at.z;
      }
    }
    body.position.x = -(span.x0 + span.x1) / 2;
    body.position.z = -(span.z0 + span.z1) / 2;

    // Stability, measured. Volume weighted, ignoring the two loose stones on
    // the floor, which hold nothing up and would flatter the number.
    let mass = 0;
    let mx = 0;
    let mz = 0;
    for (const st of stones.slice(0, stones.length - loose)) {
      const m = st.hx * st.hy * st.hz;
      mass += m;
      mx += m * st.x;
      mz += m * st.z;
    }
    const drift = Math.hypot(mx / mass, mz / mass) / (outer0 * S);

    // Left where a lab and footprints-probe.mjs can both read it.
    body.userData.cairn = {
      tip, push, stones: stones.length, crest, S, drift,
      gap: best ? best.gap : null,
      halfU: (span.x1 - span.x0) / 2,
      halfV: (span.z1 - span.z0) / 2,
    };
  },
});
