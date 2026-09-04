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
//      stone's ellipsoid and darkened by what sits in front of it. It costs
//      about twelve thousand distance tests at build time and nothing per
//      frame.
//   3. FACETS, NOT NOISE. A rock reads as a rock through a few large planes
//      meeting at soft edges. So a stone here is a SUPERELLIPSOID, a sphere
//      pushed out toward a rounded block, bent by three waves that are each
//      less than one cycle wide. There is no high frequency displacement
//      anywhere on it: at this camera distance that is film grain, it aliases,
//      and the house style bans it. The block's own axes are turned at random
//      per stone, so the flats face different ways and no two stones catch the
//      key identically.
//
// STABILITY. A pile whose centre of mass wanders off its base reads as about to
// fall, which is a different and worse feeling than old. Every tier is a ring
// about the axis with a bounded jitter, so the mass stays over the footprint;
// the built pile reports its own centre of mass offset and it measures under a
// tenth of the base radius on every seed.
//
// THE LEAN. The registry offers every stone a small random lean and this one
// declines it, which is the first time in the set. A pile of loose stones
// cannot tilt as a rigid body: tip the whole cairn two degrees and the base
// stones tip with it, which no heap does, and on a base half a metre wide the
// far side lifts further than the registry's sink can bury. All the randomness
// this piece needs is already inside it, in twelve separately seated stones.
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
// 0.50 by 0.56 is the smallest face two lines of the set's own letter size fit
// on. Depth is 0.15 because the sweep's rim radius is 0.062 and a slab thinner
// than twice that loses its front face.
const SLATE = { halfWidth: 0.25, height: 0.56, depth: 0.15 };
// Tipped back, which is the second job the slate does. The camera sits 29
// degrees up, so an upright face gives up most of itself; leaning the slate
// back turns it toward the eye and buys back about a fifth of its height. The
// solver below picks the exact angle out of this range, per seed, by asking
// which one actually lands the slate's top edge on the pile.
const TIP = { lo: 0.20, hi: 0.46 };
// How far the slate presses into the stone it leans on, and how far its foot is
// buried. Both are well over the light's 0.006 normal bias, which is the floor
// under which a contact starts to shadow itself in a dotted band.
const SLATE_BITE = 0.012;
const SLATE_SINK = 0.006;

// --- the pile --------------------------------------------------------------
//
// Four tiers and a cap, biggest at the bottom. Counts are 4 or 3 at the base,
// so a cairn is nine or ten stones plus one or two that have rolled off the
// foot of it: few enough that the eye can count them, which is what stops it
// reading as gravel.
//
// `outer` is the tier's outer reach as a fraction of the base tier's, and it is
// the number that carries the taper. Working in outer reach rather than in ring
// radius is what guarantees the overhangs: each tier's edge lands a few
// centimetres inside the edge below it, near enough that an irregular stone
// often stands proud of its neighbour and always shades it.
//
// `phase` turns the ring, in whole steps of its own spacing. Half a step per
// tier is what puts a stone over the gap below it rather than on the crown of
// the stone below it, which is both how a cairn is actually built and where the
// overhangs come from. The base ring is turned so its gap faces local +Z, the
// direction the layout points at the camera, and the tier above it puts a stone
// straight over that gap: that stone is what the slate leans on.
const TIERS = [
  { n: 4, hw: 0.190, outer: 1.000, phase: 0.5 },
  { n: 3, hw: 0.166, outer: 0.855, phase: 0.0 },
  { n: 2, hw: 0.146, outer: 0.700, phase: 0.5 },
  { n: 1, hw: 0.130, outer: 0.330, phase: 0.0 },
];
// Half height over half width. A field stone is wider than it is tall, but a
// pile of flat ones is a stack of pancakes, so the spread is wide and drawn per
// stone: some are slabs and some are boulders, which is what a heap of stones
// picked off a hillside is.
const FLAT = { lo: 0.62, hi: 0.86 };
// The superellipsoid exponent. 2 is a sphere, 4 is nearly a rounded cube. This
// range gives a few broad planes with soft edges between them, which is the
// whole of point 3 above.
const BLOCK = { lo: 2.6, hi: 4.0 };
// Total height, before the slate. The piece is one of the low ones by brief,
// under fred's 1.10 and over the book's 0.81, and the pile is scaled to land
// here after it is built so the seeded stone sizes cannot drift the silhouette.
const HEIGHT = { lo: 0.86, hi: 1.02 };
// How far a stone is pushed past first touch. Enough that the joint is a real
// intersection rather than a mathematical tangent, which under a 0.006 normal
// bias reads as a floating stone.
const BITE = 0.010;

// --- the paint -------------------------------------------------------------
//
// Multipliers on the set's grey, not colours of their own: the hue stays
// PALETTE.stone and the map keeps carrying the mottle and the grime, so a cairn
// cannot drift away from the stone standing next to it. What these do is the
// modelling the one key light cannot: an up-facing crown a shade brighter than
// the base grey, a flank below it, and a crevice well under both.
const FACE_UP = 1.02;
const FACE_SIDE = 0.86;
const FACE_UNDER = 0.50;
// Per stone. Half a stop between neighbours is another thing that says two
// stones rather than one mass, and it is the same trick dirtpile uses on clods.
// Narrower here than there, because these are all the same grey stone rather
// than wet earth and dry earth.
const TONE = { lo: 0.92, hi: 1.06 };
// Occlusion. REACH is in occluder radii; DEPTH is how black a full crevice
// goes. Both are dirtpile's numbers, which were tuned against this same floor
// and this same key.
const OCC_REACH = 2.1;
const OCC_DEPTH = 0.55;
// The floor occludes too, and it is the one occluder that is not a stone: the
// underside of a base stone within this of the ground loses light no directional
// key can put back.
const GROUND_REACH = 0.11;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// One field stone.
//
// A sphere welded shut, pushed out onto a superellipsoid whose axes are turned
// at random, then bent by three waves of less than a cycle each. Welded first
// because SphereGeometry carries a seam of duplicated vertices where its uv
// wraps and a fan of them at each pole, and computeVertexNormals on those gives
// each copy its own normal: a visible crease straight down the side of every
// rock. The uv is deleted before the weld for the same reason, since two
// vertices at one position with different uv do not merge. This piece writes
// its own uv afterwards anyway.
function fieldStone(rng, seg, block) {
  let geo = new THREE.SphereGeometry(0.5, seg[0], seg[1]);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);

  const p = geo.attributes.position;
  const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * TAU, rng() * TAU, rng() * TAU));
  const back = spin.clone().invert();
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU];
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  const a = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    d.copy(v).multiplyScalar(2); // the unit direction this vertex sits on
    a.copy(d).applyQuaternion(back); // and the same direction in the block's frame
    const s = Math.pow(Math.abs(a.x), block) + Math.pow(Math.abs(a.y), block) + Math.pow(Math.abs(a.z), block);
    // The superellipsoid's radius along d. It is 1 on the block's own axes and
    // grows toward its corners, so the axis half extents are still 0.5 and the
    // scale applied later means exactly what it says.
    let k = Math.pow(s, -1 / block);
    // Three slow bends. The arguments run over plus or minus two radians across
    // the whole stone, so this is one lopsided lump and not a raspberry.
    k *= 1
      + 0.085 * Math.sin(2.1 * d.x + ph[0])
      + 0.075 * Math.sin(1.9 * d.y + ph[1])
      + 0.065 * Math.sin(2.3 * d.z + ph[2]);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
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
function clearance(fixed, moving) {
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
    // The floor is the twelfth occluder. An underside close to it is in a
    // crevice like any other, and this is what draws the dark line where a base
    // stone meets the ground on the side the key light does reach.
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

  // Two words, on the one flat surface the piece has. The face is 0.50 by 0.56,
  // which is the narrowest in the set, and a narrow face makes the same chisel
  // cover more of itself, so the letter SIZE is what is held rather than a
  // coverage number: 0.17 of the height is 0.095 world units, inside the set's
  // own 0.09 to 0.12 band and within a hair of fred's 0.14.
  //
  // Measured on the 914 by 1024 face: 4.4% ink, against cross 3.8, fred 6.8 and
  // bat 9.2, and against the 12 to 19 that got the last set rejected. A piece
  // whose identity is its silhouette belongs at the light end and this one's
  // identity is a heap of rocks.
  draw(ctx, w, h) {
    const size = h * 0.17;
    inkText(ctx, 'SAFE', w / 2, h * 0.395, size, size * 0.05);
    inkText(ctx, 'HOME', w / 2, h * 0.605, size, size * 0.05);
  },

  extras({ body, slab, material, rng, disposables, stripUV, lean }) {
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
    for (let t = 0; t < TIERS.length; t++) {
      const tier = TIERS[t];
      const n = t === 0 ? baseN : tier.n;
      // Base tier: stones just clear of each other round the ring, with the
      // gap between two of them dead ahead.
      const hw = tier.hw * (0.94 + rng() * 0.12);
      if (t === 0) outer0 = (hw / Math.sin(Math.PI / n)) * 1.03 + hw;
      const outer = outer0 * tier.outer;
      const ring = Math.max(0, outer - hw);
      const a0 = (tier.phase * TAU) / n + (rng() - 0.5) * 0.18;
      for (let i = 0; i < n; i++) {
        const th = a0 + (i * TAU) / n + (rng() - 0.5) * 0.30;
        const r = ring * (0.90 + rng() * 0.20);
        const w = hw * (0.88 + rng() * 0.26);
        const flat = lerp(FLAT.lo, FLAT.hi, rng());
        stones.push({
          x: Math.sin(th) * r,
          z: Math.cos(th) * r,
          // Half extents. The long axis of a field stone is rarely the one you
          // set it down on, hence the second, independent width.
          hx: w,
          hy: w * flat,
          hz: w * (0.80 + rng() * 0.34),
          block: lerp(BLOCK.lo, BLOCK.hi, rng()),
          euler: new THREE.Euler((rng() - 0.5) * 0.34, rng() * TAU, (rng() - 0.5) * 0.34),
          seg: t === 0 ? [24, 16] : [20, 13],
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
        x: Math.sin(th) * outer0 * (0.92 + rng() * 0.30),
        z: Math.cos(th) * outer0 * (0.92 + rng() * 0.30),
        hx: w,
        hy: w * (0.52 + rng() * 0.18),
        hz: w * (0.80 + rng() * 0.30),
        block: lerp(BLOCK.lo, BLOCK.hi, rng()),
        euler: new THREE.Euler((rng() - 0.5) * 0.5, rng() * TAU, (rng() - 0.5) * 0.5),
        seg: [16, 11],
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
      const geo = fieldStone(rng, s.seg, s.block);
      geo.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(s.x, 0, s.z),
        new THREE.Quaternion().setFromEuler(s.euler),
        new THREE.Vector3(s.hx * 2, s.hy * 2, s.hz * 2),
      ));
      const under = makeField({ ...dims, init: Infinity });
      splat(under, geo, 0, 2, 1, false);
      const lift = clearance(top, under) - BITE;
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
    const S = wanted / crest;
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
    // uv is planar across the pile and up it, which is exactly how the plinth
    // samples the plain strip: neighbouring stones then share one continuous
    // grain, like rock off one hillside, and every stone picks up the grime
    // band at the bottom of the texture in proportion to how low it sits.
    const reach = outer0 * S + 0.1;
    for (let i = 0; i < stones.length; i++) {
      const geo = stones[i].geo;
      paintStone(geo, stones[i], stones, i);
      const p = geo.attributes.position;
      const uv = new Float32Array(p.count * 2);
      for (let k = 0; k < p.count; k++) {
        const [u, vv] = stripUV(p.getX(k), p.getY(k), reach, wanted);
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
    const CLOSE = 0.015;
    let best = null;
    for (let k = 0; k <= 8; k++) {
      const tip = lerp(TIP.lo, TIP.hi, k / 8);
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
    const tip = best ? best.tip : TIP.lo;
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

    // What the layout generator needs, measured rather than guessed, and left
    // on the group so footprints-probe.mjs and a lab can both read it.
    body.userData.cairn = { tip, push, height: wanted, stones: stones.length, crest, S, gap: best ? best.gap : null, outer: outer0 * S };
  },
});
