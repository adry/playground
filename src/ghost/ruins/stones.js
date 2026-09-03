import { block, drum, voussoir } from './kit.js';

// Loose fallen masonry -- the small scattered stuff between the big ruins.
//
// Each call produces exactly one of a handful of sub-variants (a settled
// ashlar, a stack of flagstones, a rubble heap, a fallen column, a couple of
// arch stones, a scatter of thin spalls). Variety comes from mixing which
// *kind* of stone shows up, not from randomising one generic shape -- a pile
// of boxes with random sizes still reads as a pile of boxes.
//
// The one problem every variant shares is resting convincingly: a rotated
// block or drum must still touch the ground at exactly the right point, or
// it floats or buries itself. Rather than eyeballing an offset per variant,
// `settledBlock`/`settledDrum` below compute the true lowest point of the
// rotated shape and place it so that point lands on the target height. That
// makes "nothing below y=-0.05" true by construction instead of by tuning.

// --- small math helpers -------------------------------------------------
// No three.js import is allowed here, so rotation is done by hand. The
// order below -- rotate about X, then Y, then Z -- mirrors kit.js applying
// geo.rotateX/Y/Z in that sequence to the whole shape, so a corner computed
// here ends up exactly where kit.js would put it.

function rotate([x, y, z], [rx, ry, rz]) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x2 = x * cy + z1 * sy;
  const z2 = -x * sy + z1 * cy;
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const x3 = x2 * cz - y1 * sz;
  const y3 = x2 * sz + y1 * cz;
  return [x3, y3, z2];
}

function boxCorners([w, h, d]) {
  const pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push([(sx * w) / 2, (sy * h) / 2, (sz * d) / 2]);
  }
  return pts;
}

// Sampled ring points at both caps. 16 samples regardless of the drum's own
// render segment count is deliberately generous: oversampling here can only
// find a lower true minimum than the coarser rendered mesh actually has, so
// resting against this estimate never leaves the real geometry floating,
// and at worst sits it a hair higher than strictly necessary.
function drumPoints(radius, radiusTop, height) {
  const pts = [];
  const seg = 16;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    pts.push([c * radius, -height / 2, s * radius]);
    pts.push([c * radiusTop, height / 2, s * radiusTop]);
  }
  return pts;
}

function extentY(points, rot) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const y = rotate(p, rot)[1];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min, max };
}

// Places a block so its lowest rotated corner lands exactly on `restY`
// (ground, or the top of whatever it's stacked on), and returns the height
// of its own top so the next piece can rest on it in turn.
function settledBlock(x, z, size, rot, restY, chip = 0.016) {
  const { min, max } = extentY(boxCorners(size), rot);
  const y = restY - min;
  return { prim: block({ pos: [x, y, z], size, rot, chip }), top: y + max };
}

function settledDrum(x, z, radius, radiusTop, height, rot, restY, seg = 12, chip = 0.012) {
  const { min, max } = extentY(drumPoints(radius, radiusTop, height), rot);
  const y = restY - min;
  return { prim: drum({ pos: [x, y, z], radius, radiusTop, height, seg, rot, chip }), top: y + max };
}

// A coarse footprint half-extent for a block that may carry an arbitrary
// yaw: the hypotenuse/2 bounds the rotated rectangle at any angle, where
// max(w,d)/2 would not. Colliders only need to be coarse, not tight, but
// they must not be *wrong* about which way the piece is facing.
function yawSafeHalf(w, d) {
  return Math.hypot(w, d) / 2;
}

// --- sub-variants ---------------------------------------------------------

// The plainest and most common piece: one dressed block that toppled and
// settled a little into the turf. A single strong tilt reads as "thrown";
// two moderate ones plus a free yaw read as "fell over".
function ashlarBlock(rand) {
  const w = 0.32 + rand() * 0.28;
  const h = 0.22 + rand() * 0.18;
  const d = 0.28 + rand() * 0.26;
  const rot = [(rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.9];
  // A shallow, bounded sink -- deep enough to read as settled, shallow
  // enough that even the worst-case chip jitter stays well clear of -0.05.
  const restY = -(0.006 + rand() * 0.014);
  const { prim, top } = settledBlock(0, 0, [w, h, d], rot, restY, 0.02);
  const half = yawSafeHalf(w, d);
  return {
    primitives: [prim],
    colliders: [{ x: 0, z: 0, hx: half, hz: half, top }],
    radius: half + 0.08,
  };
}

// Thin paving stones. Three flavours: one flat, a stack slid apart, or a
// pair leaning against each other -- the thinness (0.07-0.14) is the point,
// since a crude version of this piece would just be a slightly flat box.
function fallenSlabs(rand) {
  const prims = [];
  const mode = rand();
  const baseW = 0.35 + rand() * 0.25;
  const baseD = 0.28 + rand() * 0.22;
  const thick = () => 0.07 + rand() * 0.07;

  let maxTop = 0;
  let footprint = yawSafeHalf(baseW, baseD);

  if (mode < 0.35) {
    // Resting almost flat -- a small tilt is what keeps a thin slab from
    // reading as a decal glued to the ground.
    const rot = [(rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12];
    const s = settledBlock(0, 0, [baseW, thick(), baseD], rot, 0, 0.012);
    prims.push(s.prim);
    maxTop = s.top;
  } else if (mode < 0.72) {
    // Stacked and slid apart: each slab rests on the one below it but is
    // nudged sideways, the way a dropped stack of pavers fans out rather
    // than staying in a neat column.
    const count = rand() < 0.5 ? 2 : 3;
    let restY = 0;
    let x = 0;
    let z = 0;
    for (let i = 0; i < count; i++) {
      const w = baseW * (0.8 + rand() * 0.25);
      const d = baseD * (0.8 + rand() * 0.25);
      const rot = [(rand() - 0.5) * 0.1, rand() * Math.PI * 2, (rand() - 0.5) * 0.1];
      const s = settledBlock(x, z, [w, thick(), d], rot, restY, 0.012);
      prims.push(s.prim);
      restY = s.top;
      maxTop = s.top;
      footprint = Math.max(footprint, Math.hypot(x, z) + yawSafeHalf(w, d));
      const a = rand() * Math.PI * 2;
      x += Math.cos(a) * (0.03 + rand() * 0.05);
      z += Math.sin(a) * (0.03 + rand() * 0.05);
    }
  } else {
    // One slab flat, a second propped against its raised edge -- reads as
    // "toppled together", not two identical stones placed twice.
    const rot1 = [(rand() - 0.5) * 0.1, rand() * Math.PI * 2, (rand() - 0.5) * 0.1];
    const s1 = settledBlock(0, 0, [baseW, thick(), baseD], rot1, 0, 0.012);
    prims.push(s1.prim);
    maxTop = s1.top;
    footprint = yawSafeHalf(baseW, baseD);

    const lean = 0.5 + rand() * 0.5;
    const yaw2 = rand() * Math.PI * 2;
    const rot2 = [lean, yaw2, 0];
    const w2 = baseW * (0.55 + rand() * 0.25);
    const d2 = baseD * (0.55 + rand() * 0.25);
    // Push the foot close to the first slab's edge so it braces against it
    // instead of standing in the middle of it.
    const offset = yawSafeHalf(baseW, baseD) * (0.75 + rand() * 0.2);
    const x2 = Math.cos(yaw2) * offset;
    const z2 = Math.sin(yaw2) * offset;
    const s2 = settledBlock(x2, z2, [w2, thick(), d2], rot2, 0, 0.012);
    prims.push(s2.prim);
    if (s2.top > maxTop) maxTop = s2.top;
    footprint = Math.max(footprint, offset + yawSafeHalf(w2, d2));
  }

  return {
    primitives: prims,
    colliders: [{ x: 0, z: 0, hx: footprint, hz: footprint, top: maxTop }],
    radius: footprint + 0.08,
  };
}

// A heap of 6-12 small stones. Distance from the heap's centre biases both
// how high a stone is allowed to sit and how hard it's tilted, which is what
// turns a scatter of boxes into a mound instead of a flat scree.
function rubblePile(rand) {
  const count = 6 + Math.floor(rand() * 7);
  const pileR = 0.22 + rand() * 0.16;
  const prims = [];
  let maxTop = 0;

  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * pileR;
    const centerBias = 1 - dist / pileR;
    const x = Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    const s = 0.12 + rand() * 0.18;
    const size = [s * (0.8 + rand() * 0.4), s * (0.7 + rand() * 0.5), s * (0.8 + rand() * 0.4)];
    const tilt = 0.15 + centerBias * (0.5 + rand() * 0.5);
    const rot = [(rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt];
    // Only stones biased toward the centre are allowed to climb -- most of
    // the heap stays low, a few cap it, matching how rubble actually mounds.
    const restY = centerBias * (0.12 + rand() * 0.14) * (rand() < 0.4 + centerBias * 0.4 ? 1 : 0.2);
    const { prim, top } = settledBlock(x, z, size, rot, restY, 0.015);
    prims.push(prim);
    if (top > maxTop) maxTop = top;
  }

  return {
    primitives: prims,
    colliders: [{ x: 0, z: 0, hx: pileR + 0.2, hz: pileR + 0.2, top: maxTop }],
    radius: pileR + 0.2,
  };
}

// One or two drum segments lying on their side, or a single drum with a
// broken capital and abacus tumbled off its end. Tipping a drum is just
// rotating its normally-vertical axis ~90 degrees about Z; the jitter keeps
// it from looking like a deliberate CAD rotation. The two extra elements
// (a second drum, or a capital+abacus) are kept mutually exclusive -- piling
// all of them into one piece is how a "small filler stone" quietly grows
// past the scale this kit is meant to stay inside.
function fallenColumn(rand) {
  const prims = [];
  const radius = 0.09 + rand() * 0.06;
  const radiusTop = radius * (0.85 + rand() * 0.15);
  const baseRot = Math.PI / 2 + (rand() - 0.5) * 0.25;
  const twoPieces = rand() < 0.4;

  const len1 = twoPieces ? 0.24 + rand() * 0.18 : 0.3 + rand() * 0.22;
  const rot1 = [(rand() - 0.5) * 0.12, 0, baseRot];
  const d1 = settledDrum(0, 0, radius, radiusTop, len1, rot1, 0);
  prims.push(d1.prim);
  let maxTop = d1.top;
  let footprint = len1 / 2 + radius;

  const colliders = [{ x: 0, z: 0, hx: len1 / 2 + radius, hz: radius + 0.08, top: d1.top }];

  if (twoPieces) {
    // The second drum lands a short way further along and slightly
    // off-axis, close enough to still read as one broken shaft -- a column
    // that snapped doesn't scatter its pieces far apart.
    const len2 = 0.2 + rand() * 0.18;
    const gap = (len1 + len2) * 0.5 * (0.55 + rand() * 0.3);
    const yaw = (rand() - 0.5) * 0.5;
    const x2 = gap * Math.cos(yaw);
    const z2 = gap * Math.sin(yaw);
    const rot2 = [(rand() - 0.5) * 0.15, 0, Math.PI / 2 + (rand() - 0.5) * 0.3];
    const d2 = settledDrum(x2, z2, radius, radiusTop, len2, rot2, 0);
    prims.push(d2.prim);
    if (d2.top > maxTop) maxTop = d2.top;
    footprint = Math.max(footprint, Math.hypot(x2, z2) + len2 / 2 + radius);
    colliders.push({ x: x2, z: z2, hx: len2 / 2 + radius, hz: radius + 0.08, top: d2.top });
  } else if (rand() < 0.55) {
    // A broken capital: a block wider than the shaft, plus a thin abacus
    // plate that landed slightly askew of it -- capitals and abaci are
    // separate stones and rarely fall square with each other.
    const capSize = radius * (1.8 + rand() * 0.3);
    const capH = 0.13 + rand() * 0.07;
    const cx = -(len1 / 2 + capSize * 0.28);
    const cz = (rand() - 0.5) * 0.16;
    const rotCap = [(rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3];
    const cap = settledBlock(cx, cz, [capSize, capH, capSize], rotCap, 0, 0.014);
    prims.push(cap.prim);
    if (cap.top > maxTop) maxTop = cap.top;
    footprint = Math.max(footprint, Math.hypot(cx, cz) + yawSafeHalf(capSize, capSize));

    const abW = capSize * (1.0 + rand() * 0.08);
    const abH = 0.08 + rand() * 0.04;
    const ax = cx + (rand() - 0.5) * 0.1;
    const az = cz + (rand() - 0.5) * 0.1;
    const rotAb = [(rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35];
    const ab = settledBlock(ax, az, [abW, abH, abW], rotAb, 0, 0.01);
    prims.push(ab.prim);
    if (ab.top > maxTop) maxTop = ab.top;
    footprint = Math.max(footprint, Math.hypot(ax, az) + yawSafeHalf(abW, abW));
  }

  return { primitives: prims, colliders, radius: footprint + 0.1 };
}

// One or two voussoirs (arch-ring wedges) fallen flat. The voussoir
// primitive has no rot parameter of its own -- its wedge always sweeps in
// the local x-y plane -- so instead of fighting that, this leans on it: the
// face at angle 0 (or PI) has sin(angle) = 0 for every radius, so resting
// `from` (or `to`) exactly on 0 or PI puts that whole flat face flush with
// y=0 for free. The wedge then tips up off the ground by sin(span)*outerR,
// which is exactly what a fallen arch stone propped on one flat side looks
// like -- no rotation math needed at all.
function fallenVoussoir(rand) {
  const prims = [];

  const innerR = 0.12 + rand() * 0.1;
  const outerR = innerR + 0.08 + rand() * 0.08;
  const thickness = 0.14 + rand() * 0.1;
  const span = 0.3 + rand() * 0.35;
  const flip = rand() < 0.5;
  const from = flip ? Math.PI - span : 0;
  const to = flip ? Math.PI : span;

  prims.push(voussoir({ centre: [0, 0, 0], innerR, outerR, from, to, thickness, chip: 0.01 }));
  let maxTop = Math.sin(span) * outerR;
  let footprint = outerR;

  if (rand() < 0.55) {
    // A second stone from the same ring, fallen a short way off and turned
    // to face the other way -- arch stones scatter, they don't stack.
    const innerR2 = 0.1 + rand() * 0.08;
    const outerR2 = innerR2 + 0.07 + rand() * 0.07;
    const span2 = 0.3 + rand() * 0.4;
    const flip2 = !flip;
    const from2 = flip2 ? Math.PI - span2 : 0;
    const to2 = flip2 ? Math.PI : span2;
    const a = rand() * Math.PI * 2;
    const gap = 0.08 + rand() * 0.1;
    const x2 = Math.cos(a) * gap;
    const z2 = Math.sin(a) * gap;
    prims.push(voussoir({
      centre: [x2, 0, z2],
      innerR: innerR2,
      outerR: outerR2,
      from: from2,
      to: to2,
      thickness: thickness * (0.8 + rand() * 0.3),
      chip: 0.01,
    }));
    const top2 = Math.sin(span2) * outerR2;
    if (top2 > maxTop) maxTop = top2;
    footprint = Math.max(footprint, gap + outerR2);
  }

  return {
    primitives: prims,
    colliders: [{ x: 0, z: 0, hx: footprint, hz: footprint, top: maxTop }],
    radius: footprint + 0.1,
  };
}

// A few thin, irregularly-shaped shards, as if sheared off a bigger block.
// Independent width/depth (rather than a square footprint) is what keeps
// these from reading as tiny paving tiles.
function spalledFragments(rand) {
  const count = 3 + Math.floor(rand() * 4);
  const prims = [];
  let maxTop = 0;
  let footprint = 0;

  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const dist = rand() * 0.22;
    const x = Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    const w = 0.09 + rand() * 0.16;
    const d = 0.08 + rand() * 0.14;
    const size = [w, 0.05 + rand() * 0.04, d];
    const rot = [(rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3];
    const { prim, top } = settledBlock(x, z, size, rot, 0, 0.01);
    prims.push(prim);
    if (top > maxTop) maxTop = top;
    footprint = Math.max(footprint, dist + yawSafeHalf(w, d));
  }

  return {
    primitives: prims,
    colliders: [{ x: 0, z: 0, hx: footprint, hz: footprint, top: maxTop }],
    radius: footprint + 0.06,
  };
}

// --- dispatch ---------------------------------------------------------------

// Weighted rather than uniform: the plain ashlar is meant to be the most
// common piece underfoot, the rarer set-pieces (columns, arch stones) the
// occasional landmark among the filler.
export default function buildStones(rand) {
  const roll = rand();
  if (roll < 0.24) return ashlarBlock(rand);
  if (roll < 0.42) return fallenSlabs(rand);
  if (roll < 0.6) return rubblePile(rand);
  if (roll < 0.74) return fallenColumn(rand);
  if (roll < 0.87) return fallenVoussoir(rand);
  return spalledFragments(rand);
}
