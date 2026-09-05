import * as THREE from 'three';
import { mergeGeometries } from '../merge.js';
import { rng } from './wood.js';

// The high wall that encloses a level, in four kinds, and the darkness outside
// it.
//
// This is the edge of the world, not another prop. panel.js is the fence: 0.86
// tall, wood, low enough to see over and to hop, and it stands INSIDE a level
// as furniture. This stands AROUND one and its whole job is to say "there is no
// more graveyard past here". Everything below follows from that one difference:
//
//   * It is built as ONE merged geometry per call. A 30 unit run made of
//     fifteen 2.0 panels would be fifteen draw calls, times four sides; a whole
//     enclosure here is one, variant and breakage and ironwork included.
//   * It publishes its dimensions. Navigation needs a width to collide against
//     and needs to be told the ghost cannot get over it; the darkness outside
//     needs the height. Those numbers are WALL below and they are the only
//     copy. NO VARIANT MAY CHANGE THEM -- see the note on WALL.height.
//   * It comes in four kinds, because a player should be able to tell one
//     arena from another at a glance. See VARIANTS.
//
// THE CALLER HANDS ONE CLOSED LOOP, NOT FOUR RUNS.
//
// That is the decision this file is built around and it is worth stating first,
// because it is the one thing a caller has to get right:
//
//     createWall({ points: [{x:-15,z:-15},{x:15,z:-15},{x:15,z:15},{x:-15,z:15}],
//                  closed: true, variant: 'brick' })
//
// Four separate runs cannot make a corner. Each run would have to stop somewhere
// near the corner and hope, and the two ways of doing that are both wrong: stop
// at the centreline and the outer faces leave a square notch missing; run to the
// outer face and the two runs interpenetrate, so the inner faces cross and every
// fragment where they overlap z-fights. Handing the whole perimeter to one call
// means the corner is MITRED -- the outer faces are extended to where they
// actually meet and the inner faces are cut back to where they actually meet --
// which is the only construction that is right from both sides at once. See
// miter() below; it is four lines and it is the reason the corners work, in
// every variant, because every variant is the same sweep of a different
// section.
//
// An open polyline is allowed too (closed: false) and gets an end cap at each
// end, which is what a gate jamb needs.
//
// What panel.js contributes, and it contributes a lot: the per-seed determinism
// (its rng, so a wall is the same wall every reload), the discipline of putting
// the surface detail in a fragment patch on a standard material rather than in
// vertices or a texture, and above all the post rhythm. A fence hides its panel
// joints inside a shared post; this wall hides its corners, its coursing and
// its bay-to-bay changes of mind inside a PIER, on the same 5.0 lattice the
// floor's major grid already draws.

// ---------------------------------------------------------------------------
// the published numbers
//
// Two other agents import this. Nothing here is a magic number repeated
// somewhere else; if a piece needs a measurement that is not here it gets added
// here first, the same rule metrics.js states for the fence.

export const WALL = {
  // Crown of the coping, above the floor. THE SAME IN EVERY VARIANT, and the
  // variant table has no height field so it cannot become otherwise: a wall
  // that was secretly a different height in one arena would change what the
  // ghost can get over, and the rules read this number rather than looking.
  //
  // Chosen by measurement, not by taste, and the measurement is in two halves
  // because the decision fights itself: tall enough to read as impassable,
  // short enough that it does not eat the frame.
  //
  // WHAT IT COSTS. The camera is orthographic looking down (1, 0.78, 1), so a
  // point at height h projects onto the floor h / 0.78 further from the camera
  // in BOTH x and z. A wall of height h therefore hides a band of ground behind
  // it, and how deep that band is depends on which way the wall runs:
  //
  //     wall on a world axis     band = h / 0.78         = 1.28 h
  //     wall across the screen   band = sqrt(2) h / 0.78 = 1.81 h
  //
  // and how much of a 30 by 30 level that adds up to depends on the same thing,
  // because a wall running along the screen diagonal throws its band ALONG
  // itself and hides none of the interior at all:
  //
  //     h      axis band   screen band   hidden, level on   hidden, level on
  //                                      the world axes     the screen axes
  //     1.6    2.05        2.90          13.2%              9.7%
  //     2.0    2.56        3.63          16.4%              12.1%
  //     2.4    3.08        4.35          19.5%              14.5%
  //
  // Worth knowing before anyone rotates a level: on the world axes TWO walls
  // face the camera and each hides a shallower band; on the screen axes ONE
  // does and hides a deeper one, and the total is a quarter less. Neither is
  // free and the difference between the two framings is bigger than the
  // difference between 1.6 and 2.4.
  //
  // WHAT IT BUYS, and this is the half that decides it. Measured off the
  // settled cloth in the lab, not quoted from a comment: the ghost's crown
  // sits at y = 1.761 (out/wall/scale.png, three walls, one ghost against
  // each).
  //
  //     1.6    the coping is 0.16 BELOW the ghost's head. The ghost looks over
  //            the top of it. It is a garden wall and it reads as hoppable,
  //            which is the one thing this must never read as.
  //     2.0    the coping clears the ghost by 0.24, and the pier caps by 0.58.
  //            Nothing in the level breaks the line.
  //     2.4    clears by 0.64, and buys nothing for it: it is already taller
  //            than the only thing that has to be stopped, and the near wall
  //            has started to sit across the ghost's shoulders when it walks
  //            the near edge.
  //
  // So: 2.0. It is the shortest height that clears the ghost, and the step from
  // 1.6 to 2.0 costs half a unit of hidden ground per near wall while the step
  // from 2.0 to 2.4 costs the same again for nothing. If the ghost ever grows,
  // this number is 1.761 + 0.24 and should be recomputed rather than nudged.
  height: 2.0,

  // Across the run at the body, for the default variant. Variants differ --
  // brick is thinner, rubble is fatter, the railing is a narrow plinth -- so
  // this is a nominal, NOT the number to collide against. That is `collide`,
  // and it is variant-independent by construction; see below.
  thickness: 0.44,

  // Widest the default run gets at ground level, at the plinth. A prop laid
  // against the wall wants this, not `thickness`.
  base: 0.55,

  // The piers. Spacing is the floor's own major grid, so a pier lands on a
  // major line and the wall's rhythm and the ground's agree. `cornerScale` is
  // not decoration: see the note where it is used, the mitre makes a corner
  // reach further than a straight and a same-size pier there has the coping's
  // point sticking out through its face.
  pier: { width: 0.86, spacing: 5.0, rise: 0.34, cornerScale: 1.30 },

  // What navigation should inflate the wall's centreline polyline by, in world
  // units, to get the solid the ghost must not enter. These are the pier's half
  // diagonals: the first on a straight run, the second at a mitred right-angle
  // corner, where the pier is bigger.
  //
  // THESE HOLD FOR EVERY VARIANT, and that is on purpose rather than a
  // coincidence: every variant, ironwork included, uses the same stone pier,
  // and the pier is the widest thing on the prop in all of them. The widest
  // body is rubble's plinth at 0.325 from the centreline, still well inside
  // 0.53. So navigation never has to know which wall it is looking at.
  collide: 0.53,
  cornerCollide: 0.69,

  // Stated rather than implied. The ghost hops the 0.86 fence; it does not get
  // over this, in any variant, at any height, ever. A rule that lets it is a
  // bug in the rule.
  vaultable: false,

  // The named set, in the order an editor should list them.
  variants: ['ashlar', 'brick', 'rubble', 'iron'],
};

// ---------------------------------------------------------------------------
// the four walls
//
// An editor is being built so the owner picks one of these per level by hand,
// which is why this is a named set of four rather than a random roll or a hue
// slider. The test each one has to pass is the only one that matters here: at
// the game's framing, roughly a hundred pixels of wall, can you tell which
// arena you are in without being told? So they are chosen to differ in VALUE
// and SILHOUETTE first and in colour second, because colour is the thing that
// survives worst at that size.
//
//   ashlar   Pale dressed limestone, deep courses, saddleback coping. The
//            graveyard's own stone -- the same grey the headstones are cut
//            from, PALETTE.stone -- so this is the one that reads as the
//            churchyard the props were made for. The default.
//   brick    Warm brown brick, courses less than half as deep, a thin wall
//            with a brick-on-edge cope. Chosen because it is the one that
//            differs most from ashlar at a hundred pixels: it is darker, it is
//            the only warm thing in a grey scene, and its coursing is fine
//            enough to read as texture rather than as blocks. The Victorian
//            municipal cemetery to ashlar's parish churchyard.
//   rubble   Uncoursed field stone. Fatter, rougher, greyer-browner, big
//            unequal lumps that do not line up into courses at all, a heavy
//            plinth and a lumpy cope. Chosen for SILHOUETTE: it is the only
//            variant whose top line is visibly uneven, so it reads as a
//            different wall even in a black-and-white thumbnail. The old
//            boundary that was there before the cemetery was.
//   iron     Spiked iron railings between stone piers on a low plinth. The
//            "grid" reading, and the only variant you can see THROUGH -- which
//            at this camera means you see the darkness through it, which is
//            the best thing any of them does. Chosen because a set of three
//            masonry walls is three shades of the same idea, and this one is a
//            different idea.
//
// A variant may change the section, the coursing and the colours. It may NOT
// change WALL.height, and there is no field here that would let it.

const VARIANTS = {
  ashlar: {
    label: 'Dressed limestone',
    kind: 'masonry',
    mode: 0,
    stone: '#b9b6b1',
    mortar: '#8e8b85',
    moss: '#7f8f63',
    thickness: 0.44,
    plinthH: 0.16,
    plinthOut: 0.055,
    chamfer: 0.055,
    batter: 0.035,
    copeH: 0.20,
    copeOut: 0.075,
    crown: 0.055,
    course: 0.235,
    length: 0.62,
    joint: 0.030,
    jointDepth: 0.85,
    tone: 0.13,
    rowJitter: 0.0,
    grime: 0.30,
    mossAmount: 0.55,
    // How far the coping settles over a bay, and how far the top of the wall
    // leans off plumb. Both are per bay; see bayShape().
    sag: 0.045,
    lean: 0.030,
    copeBreaks: 20,      // roughly one broken cope per this many units of run
  },

  brick: {
    label: 'Brown brick',
    kind: 'masonry',
    mode: 1,
    stone: '#9a5c40',
    mortar: '#c8bfae',
    moss: '#6f8352',
    thickness: 0.36,
    plinthH: 0.11,
    plinthOut: 0.038,
    chamfer: 0.030,
    batter: 0.014,
    copeH: 0.13,
    copeOut: 0.055,
    crown: 0.018,        // brick on edge is nearly flat
    course: 0.098,       // a brick and its bed; nineteen courses to the crown
    length: 0.31,
    joint: 0.016,
    jointDepth: 1.0,     // lime mortar against dark brick is the loudest joint
    tone: 0.17,
    rowJitter: 0.0,
    grime: 0.34,
    mossAmount: 0.42,
    sag: 0.035,
    lean: 0.026,
    copeBreaks: 26,
  },

  rubble: {
    label: 'Field rubble',
    kind: 'masonry',
    mode: 2,
    stone: '#a7a094',
    mortar: '#7c766c',
    moss: '#78894f',
    thickness: 0.52,
    plinthH: 0.20,
    plinthOut: 0.065,
    chamfer: 0.075,
    batter: 0.055,
    copeH: 0.17,
    copeOut: 0.055,
    crown: 0.075,
    course: 0.30,
    length: 0.44,
    joint: 0.042,
    jointDepth: 0.78,
    tone: 0.22,
    // The number that makes it uncoursed: every column of stone is shoved up or
    // down by up to this much before the course lines are worked out, so the
    // beds wander instead of running through.
    rowJitter: 0.16,
    grime: 0.38,
    mossAmount: 0.85,
    sag: 0.085,
    lean: 0.055,
    copeBreaks: 11,      // the derelict one, so it loses the most cope
  },

  iron: {
    label: 'Iron railings',
    kind: 'railing',
    mode: 3,
    stone: '#b2aea7',    // the plinth and the piers, a shade greyer than ashlar
    mortar: '#8b8880',
    moss: '#7f8f63',
    iron: '#33363c',
    thickness: 0.40,
    plinthH: 0.30,
    plinthOut: 0.055,
    chamfer: 0.055,
    batter: 0.02,
    // The plinth's own cope, which the railings stand on.
    copeH: 0.11,
    copeOut: 0.070,
    crown: 0.020,
    course: 0.215,
    length: 0.58,
    joint: 0.028,
    jointDepth: 0.85,
    tone: 0.11,
    rowJitter: 0.0,
    grime: 0.30,
    mossAmount: 0.60,
    sag: 0.020,          // an iron railing does not sag, its plinth barely does
    lean: 0.014,
    copeBreaks: 0,       // and nothing falls off the top of it
    // The railings.
    plinthTop: 0.41,     // where the bars start, the top of the plinth's cope
    barPitch: 0.40,      // centres. See the triangle note in createWall.
    barSize: 0.036,
    railAt: 0.22,        // top rail's centre, below the crown; the bars poke up
    railDepth: 0.055,
    railThick: 0.075,
  },
};

export function wallVariant(name) {
  return VARIANTS[name] || VARIANTS.ashlar;
}

// ---------------------------------------------------------------------------
// the section
//
// Read bottom to top: a plinth bedded 20mm into the dirt and standing proud of
// the body, a chamfer off it, the body with a slight batter so the wall leans
// into its own weight, then a coping that oversails on both sides and is
// crowned rather than flat. The oversail is the important one: a wall whose top
// is the same width as its body has no cap, and without a cap it reads as a
// slab standing on edge.
//
// It comes back as TWO closed loops rather than one, and that split is the
// whole reason a coping stone can go missing. Swept as one tube the coping is
// welded to the body for the length of the run and the only way to lose a stone
// off it is to model the coping as a hundred and thirty separate stones, which
// at forty triangles apiece costs more than the rest of the wall put together.
// Swept as two, the coping is its own run along the same path, and a missing
// stone is a GAP IN THAT RUN -- the same machinery a gate already uses, at two
// end caps a break. The body's flat top, which is normally hidden, is what you
// see through the gap, which is exactly right.
function sections(H, v) {
  const bed = 0.02;
  const hb = v.thickness / 2;
  const cb = H - v.copeH;          // where the coping sits on the body

  const bodyRight = [
    [hb + v.plinthOut, -bed],
    [hb + v.plinthOut, v.plinthH],
    [hb, v.plinthH + v.chamfer],
    [hb - v.batter, cb],
  ];
  const copeRight = [
    [hb - v.batter, cb],
    [hb + v.copeOut, cb + 0.045],
    [hb + v.copeOut, H - v.crown - 0.045],
    [(hb + v.copeOut) * 0.80, H - v.crown],
    [0, H],
  ];

  // Close each into a loop. The body's is flat on top and open-ended at the
  // bottom edge (buried, and no camera at 29 degrees of elevation can see it);
  // the coping's is flat underneath.
  const close = (right, apex) => {
    const loop = right.map(([u, y]) => [u, y]);
    for (let i = right.length - (apex ? 2 : 1); i >= 0; i--) loop.push([-right[i][0], right[i][1]]);
    return loop;
  };

  return { body: close(bodyRight, false), cope: close(copeRight, true), copeBottom: cb };
}

// The section of the iron variant's top rail: a flat bar laid on edge.
function railSection(v, H) {
  const y = H - v.railAt;
  const hw = v.railDepth / 2;
  const ht = v.railThick / 2;
  return [
    [hw, y - ht], [hw, y + ht], [-hw, y + ht], [-hw, y - ht],
  ];
}

// ---------------------------------------------------------------------------
// the path

// Unit vector across a run, in the floor plane. Right-handed about +Y, so with
// the run going +X this points at -Z; which side is which does not matter to a
// symmetric section, but it has to be the SAME side at every vertex or the
// mitre below folds the wall inside out.
function across(dx, dz) {
  const len = Math.hypot(dx, dz) || 1;
  return { x: -dz / len, z: dx / len };
}

// The mitre.
//
// At a vertex where a run turns, the two segments want their faces offset along
// two different normals. Offsetting by either one leaves a notch on the outside
// and an overlap on the inside. The vector that offsets BOTH faces to their true
// intersection is
//
//     m = (a + b) / (1 + a.b)
//
// where a and b are the two unit across-vectors. Its length is 1/cos(half the
// turn), which is exactly the extra reach a mitred corner needs: at a square
// corner that is sqrt(2), so a 0.275 half-width plinth reaches 0.389 along the
// diagonal, which is where the two outer faces actually cross. Offset every
// section point by u * m and the whole cross section mitres at once -- plinth,
// body and coping together, with no special case for any of them, and none for
// which variant's section it happens to be.
//
// The denominator vanishes at a 180 degree reversal, where there is no
// intersection to find. Clamped rather than guarded with a branch, because a
// path that doubles back on itself is a caller bug and a wall three metres wide
// at one vertex is a much louder way to say so than a silent kink.
function miter(a, b) {
  const d = Math.max(0.25, 1 + a.x * b.x + a.z * b.z);
  return { x: (a.x + b.x) / d, z: (a.z + b.z) / d };
}

// Turn the caller's corners into a sampled path: every original corner kept
// exactly, straight spans subdivided so the coping has somewhere to undulate.
//
// Corners are never moved and never wander. A corner that has drifted off the
// lattice is a corner that no longer meets the level's own grid, and the whole
// point of a 6 by 6 of major squares is that the wall lands on the lines.
function samplePath(points, closed, step, rand, wander) {
  const src = points.map((p) => ({ x: p.x, z: p.z }));
  if (closed && src.length > 1) {
    const a = src[0];
    const b = src[src.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-6) src.pop();
  }
  const n = src.length;
  const out = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = src[i];
    const b = src[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const parts = Math.max(1, Math.round(len / step));
    for (let k = 0; k < parts; k++) {
      const t = k / parts;
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        corner: k === 0,
      });
    }
  }
  if (!closed) out.push({ x: src[n - 1].x, z: src[n - 1].z, corner: true });

  let s = 0;
  for (let i = 0; i < out.length; i++) {
    if (i > 0) s += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
    out[i].s = s;
  }
  const total = closed
    ? s + Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z)
    : s;

  const dirAt = (i) => {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    return across(b.x - a.x, b.z - a.z);
  };
  for (let i = 0; i < out.length; i++) {
    const prev = closed || i > 0 ? dirAt((i - 1 + out.length) % out.length) : dirAt(0);
    const next = closed || i < out.length - 1 ? dirAt(i) : dirAt(out.length - 2);
    const m = miter(prev, next);
    out[i].m = m;
    // Unit across, for the normals. normalize(m), not m: the mitre vector is
    // longer than one and a normal built from it comes out unnormalised at
    // every corner, which lights the corner brighter than the run it joins.
    const ml = Math.hypot(m.x, m.z) || 1;
    out[i].n = { x: m.x / ml, z: m.z / ml };
    // A wall that has stood a hundred years is not on a line. The wander is
    // lateral and tiny, and it is zero at every original corner.
    out[i].wander = out[i].corner ? 0 : (rand() * 2 - 1) * wander;
  }
  return { pts: out, total, closed };
}

// A fresh sample exactly `s` along a sampled path, interpolated between the two
// samples it falls between and carrying their frame.
//
// Piers need this and the first pass did not have it: it snapped a pier to the
// nearest existing sample, which with a 1.875 subdivision put the pier wanted
// at 5.0 down at 5.625. The whole claim that a pier lands on the floor's own
// major grid line was quietly false by up to half a subdivision, on every pier
// of every run.
function pointAt(path, s) {
  const pts = path.pts;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const bs = i === pts.length - 1 ? path.total : b.s;
    if (s >= a.s - 1e-9 && s <= bs + 1e-9) {
      if (Math.abs(s - a.s) < 1e-9) return a;
      if (Math.abs(s - bs) < 1e-9 && i < pts.length - 1) return b;
      const t = bs > a.s ? (s - a.s) / (bs - a.s) : 0;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        s,
        corner: false,
        // Between two samples the frame is the segment's, and a segment has one
        // frame from end to end: only an original corner turns.
        m: a.m,
        n: a.n,
        wander: 0,
      };
    }
  }
  return { ...pts[pts.length - 1], s };
}

// Cut a sampled path into runs, dropping the intervals in `gaps` and inserting
// an exact sample at every cut so a run stops where it was told to and not at
// the nearest subdivision. Used twice: once for gates, which cut the whole
// wall, and once for missing coping stones, which cut only the coping.
function cutRuns(path, gaps) {
  if (!gaps.length) return [{ pts: path.pts, closed: path.closed, total: path.total }];
  const runs = [];
  const cuts = [];
  for (const g of gaps) cuts.push(g.a, g.b);
  const inGap = (s) => gaps.some((g) => s > g.a + 1e-6 && s < g.b - 1e-6);
  let current = [];
  const flush = () => {
    if (current.length >= 2) runs.push({ pts: current, closed: false, total: path.total });
    current = [];
  };
  const marks = [...path.pts.map((p) => p.s), ...cuts].sort((p, q) => p - q);
  let prev = -1;
  for (const s of marks) {
    if (Math.abs(s - prev) < 1e-6) continue;
    prev = s;
    if (inGap(s)) { flush(); continue; }
    current.push(pointAt(path, s));
  }
  flush();
  // A closed loop cut in one place is still one run; stitch the tail onto the
  // head so the piece that crosses s = 0 is not two runs meeting at a seam.
  if (path.closed && runs.length > 1 && !inGap(0)) {
    const head = runs.shift();
    const tail = runs.pop();
    runs.push({ pts: [...tail.pts, ...head.pts.map((p) => ({ ...p, s: p.s + path.total }))], closed: false });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// geometry

// Outward normal of a section edge, in the (across, up) frame.
function edgeNormal(p, q) {
  const du = q[0] - p[0];
  const dv = q[1] - p[1];
  const len = Math.hypot(du, dv) || 1;
  return [dv / len, -du / len];
}

// A run swept along a sampled path.
//
// Vertices are duplicated per section EDGE rather than shared per section
// point, so every arris of the masonry -- the plinth, the chamfer, the coping's
// oversail -- stays a crease instead of being averaged into a soft roll. It
// costs vertices, which are not the expensive thing here, and it buys the one
// quality that separates stone from vinyl. Along the run they ARE shared, so a
// straight bay is one smooth surface and the mitred corners bend rather than
// facet.
//
// `shape` is the per-bay deformation and it is passed in rather than made here,
// because the end caps and the coping have to apply the IDENTICAL settle and
// lean: a cap built off the unslumped section stands proud of the run it caps,
// and a coping built off an unleant body slides sideways off it.
function sweep(path, loop, shape, stamp) {
  const rings = path.pts.length;
  const spans = path.closed ? rings : rings - 1;
  const edges = loop.length;
  const vertsPerRing = edges * 2;

  const position = new Float32Array(rings * vertsPerRing * 3);
  const normal = new Float32Array(rings * vertsPerRing * 3);
  const stone = new Float32Array(rings * vertsPerRing * 4);
  const index = [];

  for (let i = 0; i < rings; i++) {
    const p = path.pts[i];
    const bay = stamp.bay(p.s);
    const base = i * vertsPerRing;
    for (let e = 0; e < edges; e++) {
      const a = loop[e];
      const b = loop[(e + 1) % edges];
      const nrm = edgeNormal(a, b);
      for (let k = 0; k < 2; k++) {
        const pt = k === 0 ? a : b;
        const vi = base + e * 2 + k;
        const u = pt[0] + p.wander + shape.lean(p.s, pt[1]);
        position[vi * 3] = p.x + p.m.x * u;
        position[vi * 3 + 1] = pt[1] + shape.settle(p.s, pt[1]);
        position[vi * 3 + 2] = p.z + p.m.z * u;
        normal[vi * 3] = p.n.x * nrm[0];
        normal[vi * 3 + 1] = nrm[1];
        normal[vi * 3 + 2] = p.n.z * nrm[0];
        stone[vi * 4] = p.s;
        stone[vi * 4 + 1] = stamp.dressed;
        stone[vi * 4 + 2] = bay;
        stone[vi * 4 + 3] = stamp.iron;
      }
    }
  }

  for (let i = 0; i < spans; i++) {
    const a = i * vertsPerRing;
    const b = ((i + 1) % rings) * vertsPerRing;
    for (let e = 0; e < edges; e++) {
      index.push(a + e * 2, b + e * 2, b + e * 2 + 1, a + e * 2, b + e * 2 + 1, a + e * 2 + 1);
    }
  }

  return buildGeometry(position, normal, stone, index);
}

// Flat cap over the end of a run, fanned from a point on the wall's own axis.
// Every section here is star shaped about its own centre -- every vertex of it
// is visible from the axis, coping oversail included -- so a fan is a valid
// triangulation and no ear clipping is needed.
function endCap(path, loop, end, shape, stamp) {
  const p = path.pts[end === 0 ? 0 : path.pts.length - 1];
  const ys = loop.map((q) => q[1]);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const dir = end === 0
    ? { x: path.pts[0].x - path.pts[1].x, z: path.pts[0].z - path.pts[1].z }
    : { x: p.x - path.pts[path.pts.length - 2].x, z: p.z - path.pts[path.pts.length - 2].z };
  // `dir` is already built pointing OUT of the run at whichever end this is,
  // so it needs no sign of its own.
  const dl = Math.hypot(dir.x, dir.z) || 1;
  const nx = dir.x / dl;
  const nz = dir.z / dl;
  const bay = stamp.bay(p.s);

  const position = [];
  const normal = [];
  const stone = [];
  const push = (u, v) => {
    const uu = u + shape.lean(p.s, v);
    position.push(p.x + p.m.x * uu, v + shape.settle(p.s, v), p.z + p.m.z * uu);
    normal.push(nx, 0, nz);
    stone.push(p.s, stamp.dressed, bay, stamp.iron);
  };
  push(0, mid);
  for (const q of loop) push(q[0], q[1]);
  const index = [];
  for (let i = 0; i < loop.length; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % loop.length);
    // The section loop runs counter-clockwise in its own (across, up) plane,
    // and across x up is the OUTWARD direction at the start of a run and the
    // inward one at the end, so the two ends wind opposite ways. Getting this
    // backwards does not merely hide the cap: with the cap backfacing you look
    // straight through the end of the wall and out of the inside of its far
    // face, which is what the first render of the height ruler showed and what
    // sent me back to this function.
    if (end === 0) index.push(0, a, b);
    else index.push(0, b, a);
  }
  return buildGeometry(position, normal, stone, index);
}

function buildGeometry(position, normal, stone, index) {
  const geo = new THREE.BufferGeometry();
  const F = (a, n) => (a instanceof Float32Array
    ? new THREE.BufferAttribute(a, n)
    : new THREE.Float32BufferAttribute(a, n));
  geo.setAttribute('position', F(position, 3));
  geo.setAttribute('normal', F(normal, 3));
  geo.setAttribute('aStone', F(stone, 4));
  geo.setIndex(index);
  return geo;
}

// A pier: a chamfered square shaft with a capstone, standing a little above the
// coping. This is the fence's post doing the fence's job -- it breaks the run
// into bays, it sits over every corner, it stands at every gate jamb, and
// anything awkward about a joint happens inside it. Every variant uses it,
// including the ironwork, which is how a railed cemetery boundary is actually
// built: stone piers with iron panels hung between them.
function pier(p, size, H, rise, rand, bay) {
  const r = size / 2;
  const c = r * 0.28;
  // A square with its corners taken off. Counter-clockwise in the pier's own
  // (across, along) plane, which is what makes the outward normals come out
  // outward below.
  const ring = [
    [r, r - c], [r - c, r], [-(r - c), r], [-r, r - c],
    [-r, -(r - c)], [-(r - c), -r], [r - c, -r], [r, -(r - c)],
  ];
  const top = H + rise;
  // (height, scale). The two rows at the SAME height are the capstone's
  // oversail: a vertical step, which is what makes the cap read as a separate
  // stone laid on top rather than as a bulge in the shaft.
  const rows = [
    [-0.02, 1.00],
    [top - 0.17, 0.945],
    [top - 0.17, 1.045],
    [top - 0.055, 1.045],
    [top, 0.88],
  ];

  // The pattern coordinate wraps AROUND the pier rather than running along the
  // path, so the coursing carries round the arris instead of stopping dead at
  // it. Perimeter arc length, offset by where the pier stands, so two piers on
  // one run are not the same stones.
  let perim = 0;
  const arc = ring.map((q, i) => {
    if (i > 0) perim += Math.hypot(q[0] - ring[i - 1][0], q[1] - ring[i - 1][1]);
    return perim;
  });

  const position = [];
  const normal = [];
  const stone = [];
  const index = [];

  // Every quad gets its own four vertices and one flat normal.
  //
  // This is the whole of what the first pass got wrong, and it was loud: rows
  // sharing their vertices meant the top of the shaft took its normal from the
  // capstone's underside, which faces straight DOWN, so the top two thirds of
  // every pier came out unlit and the enclosure looked like it was fenced with
  // charcoal. Vertices are cheap. Sharing one between two faces that point
  // different ways is not.
  const world = (u, w, y) => [p.x + u * p.n.x - w * p.n.z, y, p.z + u * p.n.z + w * p.n.x];
  const quad = (q0, q1, q2, q3, s0, s1, dressed) => {
    // The true face normal, from the quad itself. No inferred tilt, no special
    // case for the vertical step and none for the chamfer: whatever shape the
    // rows describe, this is the direction it faces.
    const ax = q3[0] - q0[0];
    const ay = q3[1] - q0[1];
    const az = q3[2] - q0[2];
    const bx = q1[0] - q0[0];
    const by = q1[1] - q0[1];
    const bz = q1[2] - q0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const base = position.length / 3;
    for (const [q, sv] of [[q0, s0], [q1, s1], [q2, s1], [q3, s0]]) {
      position.push(q[0], q[1], q[2]);
      normal.push(nx, ny, nz);
      stone.push(sv, dressed, bay, 0);
    }
    index.push(base, base + 3, base + 1, base + 3, base + 2, base + 1);
  };

  for (let ri = 0; ri < rows.length - 1; ri++) {
    const [y0, s0] = rows[ri];
    const [y1, s1] = rows[ri + 1];
    for (let e = 0; e < ring.length; e++) {
      const a = ring[e];
      const b = ring[(e + 1) % ring.length];
      const sa = p.s + arc[e];
      const sb = p.s + arc[e] + Math.hypot(b[0] - a[0], b[1] - a[1]);
      quad(
        world(a[0] * s0, a[1] * s0, y0),
        world(b[0] * s0, b[1] * s0, y0),
        world(b[0] * s1, b[1] * s1, y1),
        world(a[0] * s1, a[1] * s1, y1),
        sa, sb,
        // Everything from the oversail up is ONE stone. A capstone IS one
        // stone -- that is the whole point of a capstone, it is the piece that
        // sheds the water off the top of the pier in a single lump -- and
        // running the rubble coursing over it made the cap read as a little
        // pile of gravel balanced on a post.
        ri >= 1 ? 1 : 0,
      );
    }
  }

  // The capstone's top face, fanned from its centre.
  const [ty, ts] = rows[rows.length - 1];
  const capBase = position.length / 3;
  position.push(p.x, ty, p.z);
  normal.push(0, 1, 0);
  stone.push(p.s, 1, bay, 0);
  for (let e = 0; e < ring.length; e++) {
    const q = world(ring[e][0] * ts, ring[e][1] * ts, ty);
    position.push(q[0], q[1], q[2]);
    normal.push(0, 1, 0);
    stone.push(p.s + arc[e], 1, bay, 0);
  }
  for (let e = 0; e < ring.length; e++) {
    index.push(capBase, capBase + 1 + ((e + 1) % ring.length), capBase + 1 + e);
  }

  const geo = buildGeometry(position, normal, stone, index);
  // Knocked a little out of true, the same way a fence post is. Pivoted about
  // the pier's own foot, because that is where a leaning post pivots.
  const lean = (rand() * 2 - 1) * 0.011;
  const spin = (rand() * 2 - 1) * 0.028;
  geo.translate(-p.x, 0, -p.z);
  geo.rotateY(spin);
  geo.rotateX(lean);
  geo.translate(p.x, 0, p.z);
  return geo;
}

// Every railing bar on the whole perimeter, as ONE geometry.
//
// A square prism with a flat top, from the plinth to the crown. The top rail
// crosses below the crown, so the last 0.22 of every bar stands above it and
// the row of stubs is what reads as spikes at a hundred pixels -- cheaper than
// modelling a finial and, at this size, indistinguishable from one.
//
// The pitch is the one number in this file chosen against the triangle budget
// rather than against a reference. A bar is ten triangles: eight for the four
// sides between two rings and two for the top. A grid is made of bars and there
// is no way round that, so the pitch sets the cost of the whole variant --
// 0.40 gives three hundred bars and three thousand triangles on a 30 by 30,
// which lands the ironwork at roughly 1.7 times a masonry wall. Tighter looks
// better and costs linearly; this is where it was left.
function railingBars(path, v, H, piers, rand, stamp) {
  const r = v.barSize / 2;
  const ring = [[r, r], [-r, r], [-r, -r], [r, -r]];
  const y0 = v.plinthTop - 0.02;
  const y1 = H;

  const position = [];
  const normal = [];
  const stone = [];
  const index = [];

  const world = (p, u, w, y) => [p.x + u * p.n.x - w * p.n.z, y, p.z + u * p.n.z + w * p.n.x];

  // Bars are laid out bay by bay rather than along the whole perimeter, so a
  // bay's bars are evenly spaced within it and none of them lands inside a
  // pier. Corners therefore never carry a bar: a corner always has a pier.
  for (let i = 0; i < piers.length - 1; i++) {
    const a = piers[i].s + WALL.pier.width * 0.62;
    const b = piers[i + 1].s - WALL.pier.width * 0.62;
    const span = b - a;
    if (span <= v.barPitch) continue;
    const n = Math.max(1, Math.round(span / v.barPitch));
    for (let k = 1; k < n; k++) {
      const s = a + (span * k) / n;
      const p = pointAt(path, s);
      // A hand-forged bar is not perfectly plumb and not perfectly square on.
      const tilt = (rand() * 2 - 1) * 0.012;
      const spin = (rand() * 2 - 1) * 0.14;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      const base = position.length / 3;
      for (const [yy, lean] of [[y0, 0], [y1, tilt]]) {
        for (const [u0, w0] of ring) {
          const u = u0 * cs - w0 * sn + lean * (yy - y0);
          const w = u0 * sn + w0 * cs;
          const q = world(p, u, w, yy);
          position.push(q[0], q[1], q[2]);
          normal.push(0, 0, 0);       // filled in below
          stone.push(s, 1, stamp.bay(s), 1);
        }
      }
      for (let e = 0; e < 4; e++) {
        const e2 = (e + 1) % 4;
        index.push(base + e, base + 4 + e, base + 4 + e2, base + e, base + 4 + e2, base + e2);
      }
      // Flat top. Wound to face +Y.
      index.push(base + 4, base + 6, base + 5, base + 4, base + 7, base + 6);
    }
  }

  const geo = buildGeometry(position, normal, stone, index);
  // A bar is four flat faces and a lid and the faces do not share a plane, so
  // the normals are computed rather than written: computeVertexNormals averages
  // the four sides at each arris, which on something 36mm across is what you
  // want -- a square bar at this size should catch a soft roll of light, not
  // four hard facets.
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// the surface
//
// Coursed masonry, drawn per fragment from two numbers: distance along the run,
// which arrives in an attribute, and height, which is just the object-space Y.
// The same split panel.js uses for its grain, and for the same reason: a swept
// run has no UVs worth speaking of and a texture would need them, whereas a
// dozen lines of hashing need neither and stay sharp at any distance.
//
// WHAT MAKES A WALL STOP REPEATING, since that was the note on the first pass
// and it was right -- at the game's framing you could see the repeat.
//
// The thing that repeated was never the stones: `col` grows monotonically with
// distance so no two stones anywhere on a 120 unit perimeter share a tone. What
// repeated was the COURSING. One course height and one nominal stone length
// held for the whole wall, so thirty units of run was thirty units of dead
// parallel horizontal banding, and the eye reads regular banding as a repeat
// even when nothing in it is literally repeated.
//
// So the fix is bays. Every bay between two piers -- the same 5.0 bays the
// piers already divide the run into, arriving in aStone.z -- gets its own
// course height, its own stone length, its own bond offset and its own tone.
// Courses do not line up across a pier, which is what a real wall built or
// rebuilt in sections looks like, and the pier is exactly the thing that makes
// the discontinuity read as construction rather than as a seam. That is the
// same argument panel.js makes for hiding its rail joints inside a post.
//
// Nothing here is fine noise. The smallest feature is a stone, a stone is a
// third of a metre at its smallest, and every one of them is antialiased
// against its own fragment footprint.
//
// The vertex colour carries the slow half -- the piece's own colour and a slow
// lengthwise mottle -- exactly as paintBoard does. The material's base colour
// is WHITE so the vertex colour IS the colour, which is also what lets one
// material draw grey stone and black iron in the same draw call.

export function wallMaterial(variant = 'ashlar', options = {}) {
  const v = wallVariant(variant);
  const uniforms = {
    uMortar: { value: new THREE.Color(v.mortar) },
    uMoss: { value: new THREE.Color(v.moss) },
    uCourse: { value: v.course },
    uStone: { value: v.length },
    uJoint: { value: v.joint },
    uJointDepth: { value: v.jointDepth },
    uTone: { value: v.tone },
    uGrime: { value: v.grime },
    uMossAmount: { value: v.mossAmount },
    uRowJitter: { value: v.rowJitter },
    uCope: { value: WALL.height - v.copeH },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
    ...options,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = `
      attribute vec4 aStone;
      varying vec4 vStone;
      ${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // Object space, like the fence's grain: the wander, the lean and the
      // settled coping are in the mesh, and the coursing has to be read before
      // them or the joints shear off the wall wherever it goes out of true.
      vStone = vec4(aStone.x, transformed.y, aStone.z, aStone.w);
      vDressed = aStone.y;`,
    ).replace('varying vec4 vStone;', 'varying vec4 vStone;\n      varying float vDressed;');

    shader.fragmentShader = `
      varying vec4 vStone;
      varying float vDressed;
      uniform vec3 uMortar;
      uniform vec3 uMoss;
      uniform float uCourse;
      uniform float uStone;
      uniform float uJoint;
      uniform float uJointDepth;
      uniform float uTone;
      uniform float uGrime;
      uniform float uMossAmount;
      uniform float uRowJitter;
      uniform float uCope;

      float wallHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      ${shader.fragmentShader}`
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Iron in the same draw call as stone. aStone.w is the only thing that
        // separates them, and it moves the surface as well as the colour --
        // painted ironwork is smoother and darker and takes a specular the
        // masonry never does, and without that the railings read as grey sticks.
        roughnessFactor = mix(roughnessFactor, 0.44, vStone.w);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55, vStone.w);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      if (vStone.w < 0.5) {
        float bay = vStone.z;
        float bh = wallHash(vec2(bay, 5.0));
        float bh2 = wallHash(vec2(bay, 19.0));
        float bh3 = wallHash(vec2(bay, 41.0));

        // Per bay coursing. A bay is a length of wall between two piers, and a
        // real one was laid by one gang on one day: its beds are its own depth
        // and its stones are its own size, and neither lines up with its
        // neighbour's across the pier that divides them.
        float course = uCourse * (0.86 + 0.30 * bh);
        float nominal = uStone * (0.80 + 0.44 * bh2);

        // A course wobbles a little rather than running dead level. Old masonry
        // is laid to a line, not to a laser, and perfectly parallel courses are
        // the single thing that makes a procedural wall read as wallpaper.
        float y = vStone.y + 0.010 * sin(vStone.x * 1.9 + bh3 * 6.3)
                           + 0.005 * sin(vStone.x * 5.3 + 1.7);

        // Uncoursed rubble. Work out a coarse column FIRST, from the distance
        // along alone, then shove that whole column of stone up or down before
        // the beds are worked out. The beds then wander by a stone at a time
        // instead of running through, which is the difference between a rubble
        // wall and a coursed one and it is the only difference that reads at
        // scene size.
        float coarse = floor(vStone.x / (nominal * 1.7) + bh3 * 3.0);
        y += uRowJitter * (wallHash(vec2(coarse, 71.0)) - 0.5);

        float rowF = y / course;
        float row = floor(rowF);
        float rowT = fract(rowF);

        // Every course is offset by its own amount and its stones are its own
        // length, so no two courses break in the same place and nothing stacks
        // into a running joint.
        float rh = wallHash(vec2(row, 3.0 + bay * 0.37));
        float len = nominal * (0.72 + 0.62 * wallHash(vec2(row, 11.0 + bay)));
        float colF = (vStone.x + 0.028 * sin(y * 21.0 + rh * 6.3)) / len + rh * 7.0 + bay * 2.3;
        float col = floor(colF);
        float colT = fract(colF);

        // Distance to the nearest joint, in world units, so the mortar is the
        // same width on a course of long stones as on a course of short ones.
        float dv = min(rowT, 1.0 - rowT) * course;
        float dh = min(colT, 1.0 - colT) * len;
        float d = min(dv, dh);
        // Antialiased against the fragment's own footprint: at grazing angles
        // and at level-wide framing this is the difference between mortar and
        // moire.
        float w = max(fwidth(d), 1e-5);
        // vDressed marks a piece that is one dressed stone rather than a run of
        // masonry: the capstones. It keeps the tone and the grime and loses the
        // joints.
        float joint = (1.0 - vDressed) * (1.0 - smoothstep(uJoint * 0.5 - w, uJoint * 0.5 + w, d));

        // Per stone tone. The whole reason the coursing reads from across a
        // level: the joints themselves are a pixel wide at that distance and
        // vanish, and what is left is a field of slightly different tones,
        // which is exactly what a masonry wall looks like from fifty metres.
        float tone = wallHash(vec2(col, row)) - 0.5;
        diffuseColor.rgb *= 1.0 + tone * uTone;
        // And then, rarely, a block that is properly darker than its
        // neighbours -- a different stone out of a different quarry, a brick
        // that came out of the kiln too hot. Roughly one in eight. Evenly
        // spread tone is camouflage; the outliers are what the eye actually
        // catches, and they are what stops thirty units of wall averaging out
        // into one flat grey.
        diffuseColor.rgb *= 1.0 - 0.26 * smoothstep(0.87, 1.0, wallHash(vec2(col, row + 13.0)));
        // The stone just under a joint catches less light.
        diffuseColor.rgb *= 1.0 - (1.0 - vDressed) * 0.10 * (1.0 - smoothstep(0.0, course * 0.30, dv));
        diffuseColor.rgb = mix(diffuseColor.rgb, uMortar, joint * uJointDepth);

        // WHERE TWO SURFACES MEET is where a wall stains, and there are two
        // such places on this section. The first is the ground, and the first
        // third of a metre out of it is grubby and then mossy.
        float wet = 1.0 - smoothstep(0.0, 0.36, vStone.y);
        // The second is under the coping's oversail, where the run-off comes
        // off the drip and streaks the face below it. Narrower and dirtier
        // than the ground stain, and it is the term that makes the coping read
        // as a separate thing laid on top rather than as the top of the wall.
        float drip = (1.0 - smoothstep(0.0, 0.22, uCope - vStone.y)) * step(vStone.y, uCope);
        drip *= 0.35 + 0.65 * wallHash(vec2(col, 97.0));

        diffuseColor.rgb *= 1.0 - uGrime * (wet * (0.55 + 0.45 * wallHash(vec2(col, row + 31.0))) + drip * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, uMoss,
                               uMossAmount * wet * 0.55 * smoothstep(0.45, 0.95, wallHash(vec2(col, row + 57.0))));
      }`,
      );
  };
  // Same trap as the fence: three keys its program cache on the stock shader,
  // so without this every wall on the page recompiles into its own program.
  // One key for all four variants, because they are one program with different
  // uniforms -- which is the whole reason the variants are uniforms.
  material.customProgramCacheKey = () => 'graveyard-wall';
  return material;
}

// The slow half of the weathering, and the piece's own colour, in a vertex
// colour. Iron parts are painted their own colour by the same pass, which is
// what keeps stone and ironwork in one material.
function paint(geo, stoneColour, ironColour) {
  const pos = geo.getAttribute('position');
  const stone = geo.getAttribute('aStone');
  const n = pos.count;
  const colours = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const s = stone.getX(i);
    const iron = stone.getW(i) > 0.5;
    c.copy(iron ? ironColour : stoneColour);
    if (!iron) {
      const k = (1 + 0.045 * Math.sin(s * 0.31)) * (1 + 0.030 * Math.sin(s * 1.13 + 2.1));
      c.multiplyScalar(k);
    }
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geo;
}

// ---------------------------------------------------------------------------
// the wall

// Build the enclosure.
//
//   points    the wall's CENTRELINE corners, [{x, z}, ...]
//   closed    true for an enclosure, false for a run with two open ends
//   variant   one of WALL.variants; see the table at the top
//   height    crown of the coping; defaults to WALL.height and should stay there
//   gate      { at, width } or an array of them: openings measured as a
//             distance along the centreline from points[0], with a pier
//             standing at each jamb. `gaps` is the same under a plural name.
//
// Returns { group, mesh, bounds, length, height, variant, stats, update, dispose }.
export function createWall({
  seed = 1,
  points,
  closed = true,
  variant = 'ashlar',
  height = WALL.height,
  thickness = null,
  gate = null,
  gaps = null,
  pierSpacing = WALL.pier.spacing,
  piers = true,
  step = 1.9,
  wander = 0.012,
  breakage = 1,
} = {}) {
  if (!points || points.length < 2) throw new Error('createWall() wants at least two centreline points');

  const v = { ...wallVariant(variant) };
  if (thickness) v.thickness = thickness;
  const rand = rng(seed);
  const { body: bodyLoop, cope: copeLoop, copeBottom } = sections(height, v);
  const path = samplePath(points, closed, step, rand, wander);

  // Openings.
  const openings = []
    .concat(gate ? (Array.isArray(gate) ? gate : [gate]) : [])
    .concat(gaps || [])
    .map((g) => ({ a: g.at - g.width / 2, b: g.at + g.width / 2 }))
    .sort((p, q) => p.a - q.a);
  const inOpening = (s) => openings.some((o) => s > o.a + 1e-6 && s < o.b - 1e-6);

  // --- where the piers stand ------------------------------------------------
  // Worked out BEFORE anything is swept, because the piers are what define the
  // bays and the bays are what the coursing varies over.
  const pierS = [];
  {
    const cornerS = path.pts.filter((p) => p.corner).map((p) => p.s);
    if (path.closed) cornerS.push(path.total);
    const want = new Set();
    for (let i = 0; i < cornerS.length - 1; i++) {
      const a = cornerS[i];
      const b = cornerS[i + 1];
      const n = Math.max(1, Math.round((b - a) / pierSpacing));
      for (let k = 0; k <= n; k++) want.add(+(a + ((b - a) * k) / n).toFixed(4));
    }
    for (const o of openings) { want.add(+o.a.toFixed(4)); want.add(+o.b.toFixed(4)); }
    const seen = new Set();
    for (const s of [...want].sort((p, q) => p - q)) {
      if (inOpening(s)) continue;
      const key = path.closed && Math.abs(s - path.total) < 1e-6 ? 0 : s;
      if (seen.has(key)) continue;
      seen.add(key);
      pierS.push(pointAt(path, Math.min(s, path.total)));
    }
  }

  // A bay is the length of wall between two piers, and it is the unit
  // everything below varies over: the coursing, the settle, the lean and the
  // tone. Index rather than distance, so the shader can hash it.
  const bayOf = (s) => {
    let i = 0;
    while (i + 1 < pierS.length && pierS[i + 1].s <= s + 1e-6) i++;
    return i;
  };

  // --- how each bay is out of true ------------------------------------------
  // The first pass had one sine of amplitude 0.022 running the whole perimeter,
  // which at 30 units a side is a ripple you cannot see. This is per bay and an
  // order of magnitude bigger: one bay has slumped in the middle, the next
  // leans out at the top, the one after is straight. Quadratic in height in
  // both cases, so the footing stays bedded in the dirt and all of the movement
  // is where the eye reads a wall's line, along its top.
  const bays = pierS.map(() => ({
    sag: (rand() * 2 - 1) * v.sag,
    lean: (rand() * 2 - 1) * v.lean,
  }));
  const ph = rand() * Math.PI * 2;
  const shapeAt = (s) => {
    const i = bayOf(s);
    const a = pierS[i] ? pierS[i].s : 0;
    const b = pierS[i + 1] ? pierS[i + 1].s : path.total;
    // Zero at both piers and full in the middle, so a bay's slump is a bay's
    // slump and the wall is pinned wherever a pier holds it up. Which is what
    // a pier is for.
    const t = b > a ? Math.min(1, Math.max(0, (s - a) / (b - a))) : 0;
    return { arch: Math.sin(t * Math.PI), bay: bays[i] || bays[0] };
  };
  const shape = {
    settle(s, y) {
      const { arch, bay } = shapeAt(s);
      const h = Math.max(0, y) / height;
      // The slow perimeter-wide ripple is kept as well, at a tenth of the bay
      // term: without it every bay is a clean arc and the arcs themselves start
      // to look regular.
      return (bay.sag * arch + 0.004 * Math.sin(s * 0.83 + ph)) * h * h;
    },
    lean(s, y) {
      const { arch, bay } = shapeAt(s);
      const h = Math.max(0, y) / height;
      return bay.lean * arch * h * h;
    },
  };

  const stamp = { bay: bayOf, dressed: 0, iron: 0 };
  const parts = [];

  // --- the body -------------------------------------------------------------
  const bodyRuns = cutRuns(path, openings);
  for (const run of bodyRuns) {
    parts.push(sweep(run, bodyLoop, shape, stamp));
    if (!run.closed) {
      parts.push(endCap(run, bodyLoop, 0, shape, stamp));
      parts.push(endCap(run, bodyLoop, 1, shape, stamp));
    }
  }

  if (v.kind === 'masonry') {
    // --- the coping, with stones missing out of it --------------------------
    //
    // A wall that has stood long enough for its mortar to go is a wall that has
    // lost cope. This is the one piece of damage that reads at the game's
    // framing, because it breaks the SILHOUETTE: everything else on the wall is
    // a change of tone and the top line is the only line the eye is following.
    //
    // A break is a gap in the coping's own run, which is the gate machinery
    // pointed at a different loop, so it costs two end caps and nothing else.
    // Half of them get the stone put back, dropped and tilted, as though it had
    // shifted rather than gone; the other half are open and show the body's
    // flat top through them, which is why the body has one.
    const copeGaps = [];
    const displaced = [];
    const nBreaks = v.copeBreaks > 0 ? Math.round((path.total / v.copeBreaks) * breakage) : 0;
    for (let i = 0; i < nBreaks; i++) {
      // Spread rather than random, so two breaks never land on top of each
      // other and no bay collects all of them.
      const centre = ((i + 0.28 + rand() * 0.44) / nBreaks) * path.total;
      const width = 0.55 + rand() * 0.65;
      const a = centre - width / 2;
      const b = centre + width / 2;
      // Never on a pier: the pier covers the coping there anyway, so a break
      // under one is a break nobody can see, and it would leave the cope
      // stopping short of the pier it should be running into.
      if (pierS.some((p) => Math.abs(p.s - centre) < WALL.pier.width * 0.9 + width / 2)) continue;
      if (inOpening(a) || inOpening(b)) continue;
      copeGaps.push({ a, b });
      if (rand() < 0.45) displaced.push({ a, b, drop: 0.02 + rand() * 0.05, tilt: (rand() * 2 - 1) * 0.16 });
    }
    copeGaps.sort((p, q) => p.a - q.a);

    for (const run of cutRuns(path, [...openings, ...copeGaps].sort((p, q) => p.a - q.a))) {
      parts.push(sweep(run, copeLoop, shape, stamp));
      if (!run.closed) {
        parts.push(endCap(run, copeLoop, 0, shape, stamp));
        parts.push(endCap(run, copeLoop, 1, shape, stamp));
      }
    }

    // The stones that shifted rather than fell. Built as a one-span run over
    // the gap, then dropped and rolled about the run's own axis.
    for (const d of displaced) {
      const a = pointAt(path, d.a + 0.04);
      const b = pointAt(path, d.b - 0.04);
      if (b.s <= a.s) continue;
      const mini = { pts: [a, b], closed: false, total: path.total };
      const bits = [
        sweep(mini, copeLoop, shape, stamp),
        endCap(mini, copeLoop, 0, shape, stamp),
        endCap(mini, copeLoop, 1, shape, stamp),
      ];
      const cx = (a.x + b.x) / 2;
      const cz = (a.z + b.z) / 2;
      const axis = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, d.tilt);
      const mtx = new THREE.Matrix4()
        .makeTranslation(cx, copeBottom - d.drop, cz)
        .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
        .multiply(new THREE.Matrix4().makeTranslation(-cx, -(copeBottom), -cz));
      for (const g of bits) { g.applyMatrix4(mtx); parts.push(g); }
    }
  } else {
    // --- the railings -------------------------------------------------------
    // The plinth's own cope, unbroken: this one is a boundary that was
    // maintained, which is half of why it looks different from the others.
    const plinthCope = copeLoop.map(([u, y]) => [u, y - (height - v.plinthTop)]);
    for (const run of cutRuns(path, openings)) {
      parts.push(sweep(run, plinthCope, shape, stamp));
      if (!run.closed) {
        parts.push(endCap(run, plinthCope, 0, shape, stamp));
        parts.push(endCap(run, plinthCope, 1, shape, stamp));
      }
    }
    const ironStamp = { bay: bayOf, dressed: 1, iron: 1 };
    const rail = railSection(v, height);
    for (const run of cutRuns(path, openings)) {
      parts.push(sweep(run, rail, shape, ironStamp));
      if (!run.closed) {
        parts.push(endCap(run, rail, 0, shape, ironStamp));
        parts.push(endCap(run, rail, 1, shape, ironStamp));
      }
    }
    parts.push(railingBars(path, v, height, pierS, rand, ironStamp));
  }

  // --- the piers ------------------------------------------------------------
  if (piers) {
    for (const p of pierS) {
      // A pier on a corner has to be bigger than one on a straight, and by how
      // much is not a taste call. On a straight the coping oversails to 0.295
      // and the pier's face stands at 0.43, so the pier is 0.135 proud. At a
      // mitred right angle the coping reaches |m| times that, 0.417, and a
      // pier left at 0.43 would be 0.013 proud -- which is not a pier, it is
      // the coping's point poking out through a block, and the first render of
      // the corner showed exactly that. cornerScale puts the pier's face at
      // 0.559 and the proudness back to 0.142, so a corner pier stands off its
      // wall by the same amount a straight one does. Interpolated between
      // |m| = 1 on a straight and sqrt(2) at a square corner, so a level whose
      // walls are not at right angles gets the right answer too.
      const mlen = Math.hypot(p.m.x, p.m.z);
      const corner = 1 + (mlen - 1) * (WALL.pier.cornerScale - 1) / (Math.SQRT2 - 1);
      // And then no two piers are quite the same size or quite the same height.
      // Twenty-four identical blocks at 5.0 centres is the loudest repeat left
      // on the prop once the coursing varies, because a pier is a silhouette
      // and the eye counts silhouettes.
      const jitter = 0.94 + rand() * 0.12;
      const rise = WALL.pier.rise * (0.82 + rand() * 0.40);
      parts.push(pier(p, WALL.pier.width * corner * jitter, height, rise, rand, bayOf(p.s)));
    }
  }

  // The project's own merge, not three's: it is what the rendering pass uses
  // everywhere else, it carries aStone across verbatim, and it keeps
  // examples/jsm out of the bundle.
  const geometry = mergeGeometries(parts.map((g) => ({ geometry: g })));
  for (const g of parts) g.dispose();
  paint(geometry, new THREE.Color(v.stone), new THREE.Color(v.iron || v.stone));

  const material = wallMaterial(variant);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const bounds = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };

  return {
    group,
    mesh,
    bounds,
    variant,
    length: path.total,
    height,
    piers: pierS.length,
    stats: {
      triangles: geometry.index.count / 3,
      vertices: geometry.getAttribute('position').count,
      drawCalls: 1,
    },
    update() {},   // static, but every prop in the set has one and callers loop
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// the darkness beyond
//
// Outside the wall there is nothing, and nothing has to look like nothing
// rather than like a grey floor that stops.
//
// The constraint is the floor: ONE opaque plane, 400 units across, at y = 0,
// and at 29 degrees of elevation an orthographic camera sees a long way past
// the wall. So whatever does this must (a) leave no hard edge where the
// darkness begins, (b) leave no hard edge where it ends either, and (c) not
// touch the lit floor inside the wall at all.
//
// WHAT THIS IS: a skirt. A rectangular RING of eight quads, lying just above
// the floor outside the level, drawn in the transparent pass with a shader that
// takes its opacity from the signed distance to the level's own rectangle.
//
//   * No edge where it starts, because at the inner boundary the alpha is
//     exactly zero and the ring's inner edge is that boundary. There is nothing
//     to see, not a faint line, not a seam.
//   * Nothing inside, because there is no geometry inside. Not "alpha zero over
//     the whole floor" -- an actual hole. The lit floor inside the wall is
//     drawn by exactly the shader it was drawn by before, and the ghost, the
//     stones and the grid are untouched.
//   * No edge where it ends, because it reaches `reach` units out, which is
//     further than an orthographic camera framed on the level can see, and by
//     then it has been solid black for tens of units.
//
// WHAT WAS TRIED AND REJECTED:
//
//   1. Scene fog. Rendered, looked at, and it fails backwards, which is worth
//      a paragraph because it is the option that sounds most obvious.
//      THREE.Fog and FogExp2 key on distance FROM THE CAMERA. The camera looks
//      down at 29 degrees, so on the floor "far from the camera" and "outside
//      the level" are not the same direction -- they are very nearly opposite
//      ones on the near side. What the render shows (out/wall/dark-fog.png) is
//      the whole graveyard buried, the ghost and the headstones with it, while
//      the empty floor OUTSIDE the near wall, which is closer to the camera
//      than the level is, stays lit and keeps its grid. Every knob on it makes
//      the same trade: fog dense enough to bury the void has already buried the
//      far half of the level. It also fails the brief's "must not tint the lit
//      floor INSIDE the wall" outright, and an orthographic camera gives it no
//      perspective cue to sell it as depth, so even where it lands it reads as
//      a wash rather than as distance.
//   2. Shortening or darkening ground.js's floor. Rejected on the brief:
//      /ghostly/ and the asset lineup both use that floor and neither wants a
//      dark ring, and ground.js's uFade is a GRID fade, not a colour fade --
//      turning it down stops drawing the grid lines and leaves the same flat
//      grey behind.
//   3. A second opaque dark plane butted against the level. That is precisely
//      the hard edge the brief forbids, and no amount of tuning removes it: two
//      opaque planes of different colours meeting at a line IS a line.
//
// The skirt costs one draw call and sixteen triangles, and it does not write
// depth, so nothing standing outside the wall is clipped by it.
export function createVoid({
  bounds,
  // Where the falloff's zero point sits, measured OUT from the wall's
  // centreline: positive pushes it outward, negative pulls it in.
  //
  // The default puts it at -WALL.base / 2, which is inside the narrowest body
  // any variant has. That is the one value that gets both halves of the brief
  // at once and it is worth spelling out why, because it looks like the wrong
  // sign:
  //
  //   * Nothing inside is tinted, and provably so rather than nearly so. The
  //     ring's hole ends under the wall's own footprint, and the piers are
  //     wider still on both sides, so every fragment the skirt draws anywhere
  //     on the perimeter is underneath solid wall or outside it. No floor a
  //     player can see inside the enclosure is covered by so much as a pixel.
  //   * The floor is ALREADY 29% dark by the time it comes out from under the
  //     outer face. Put the zero point on the outer face instead and the first
  //     half metre of the void is fully lit, which at the game's framing is a
  //     bright rim tracing the whole enclosure and reads as light spilling out
  //     of the graveyard rather than as the graveyard ending.
  inset = -WALL.base / 2,
  // How far out until it is fully dark, and how hard the curve is biased
  // towards dark on the way. These two were rendered against each other at
  // three settings apiece and the pictures are unambiguous: at falloff 8 (see
  // out/wall/dark-c-80.png) there is a wide lit apron outside the wall with
  // the floor's own grid legible across it, and what it reads as is "the
  // graveyard continues and the lights are off", which is exactly the failure
  // mode. At 4.5 (dark-a-45.png) the apron is narrower but still a bright rim
  // hugging the whole enclosure. At 2.8 with the curve at 1.8 the darkness is
  // already 58% down one unit out and total by three, so the outside of the
  // wall is the last lit thing in the frame -- and 2.8 units is still eighty-
  // odd pixels of gradient at the game's framing, which is nowhere near an
  // edge. Shorter than this and it does start to read as a line.
  falloff = 2.8,
  curve = 1.8,
  // Further than an orthographic camera framed on a 30 by 30 level can see.
  reach = 90,
  colour = '#05070c',
  strength = 1.0,
  y = 0.006,
} = {}) {
  if (!bounds) throw new Error('createVoid() wants the level bounds');
  const cx = bounds.x !== undefined ? bounds.x : (bounds.minX + bounds.maxX) / 2;
  const cz = bounds.z !== undefined ? bounds.z : (bounds.minZ + bounds.maxZ) / 2;
  const hx = (bounds.halfX !== undefined ? bounds.halfX : (bounds.maxX - bounds.minX) / 2) + inset;
  const hz = (bounds.halfZ !== undefined ? bounds.halfZ : (bounds.maxZ - bounds.minZ) / 2) + inset;
  const yaw = bounds.rotation || 0;

  // The ring, in the level's own frame: eight quads between the inner rectangle
  // and the outer one, so nothing at all is drawn over the level.
  const ax = [-hx - reach, -hx, hx, hx + reach];
  const az = [-hz - reach, -hz, hz, hz + reach];
  const position = [];
  const index = [];
  let base = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === 1 && j === 1) continue;   // the hole
      const x0 = ax[i];
      const x1 = ax[i + 1];
      const z0 = az[j];
      const z1 = az[j + 1];
      position.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
      base += 4;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);

  const uniforms = {
    uHalf: { value: new THREE.Vector2(hx, hz) },
    uFall: { value: falloff },
    uCurve: { value: curve },
    uColour: { value: new THREE.Color(colour).convertSRGBToLinear() },
    uStrength: { value: strength },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    // Never occlude anything and never be occluded by the floor it lies on.
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    vertexShader: `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vLocal;
      uniform vec2 uHalf;
      uniform float uFall;
      uniform float uCurve;
      uniform vec3 uColour;
      uniform float uStrength;
      void main() {
        // Signed distance to the level's rectangle, positive outside. Exactly
        // the rounded-box distance ground.js already uses for its holes, minus
        // the corner radius, so the darkness turns the corner the way the wall
        // does instead of bulging round it.
        vec2 q = abs(vLocal) - uHalf;
        float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        float t = clamp(sd / uFall, 0.0, 1.0);
        // Smoothstep first so the start has no visible onset, then biased dark
        // so the middle of the falloff is already most of the way down.
        t = t * t * (3.0 - 2.0 * t);
        gl_FragColor = vec4(uColour, pow(t, 1.0 / uCurve) * uStrength);
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(cx, y, cz);
  mesh.rotation.y = yaw;
  // Drawn after the floor and after everything opaque; it is a wash, not a
  // surface, so it takes no shadow and casts none.
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.add(mesh);

  return {
    group,
    mesh,
    set({ falloff: f, curve: c, strength: s } = {}) {
      if (f !== undefined) uniforms.uFall.value = f;
      if (c !== undefined) uniforms.uCurve.value = c;
      if (s !== undefined) uniforms.uStrength.value = s;
    },
    update() {},
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// A convenience for the common case: a rectangle of `size` world units, walled
// all the way round with the darkness already on.
//
//   const level = createWalledLevel({ size: 30, variant: 'brick' });
//   scene.add(level.group);
//
// 30 is the maximum: six of the floor's major squares, which is what the level
// generator is capped at.
export function createWalledLevel({
  seed = 1,
  size = 30,
  sizeZ = null,
  centre = { x: 0, z: 0 },
  rotation = 0,
  variant = 'ashlar',
  height = WALL.height,
  gate = null,
  dark = true,
} = {}) {
  const hx = size / 2;
  const hz = (sizeZ ?? size) / 2;
  const corners = [
    { x: -hx, z: -hz }, { x: hx, z: -hz }, { x: hx, z: hz }, { x: -hx, z: hz },
  ];
  const wall = createWall({ seed, points: corners, closed: true, variant, height, gate });
  const group = new THREE.Group();
  group.add(wall.group);
  const dusk = dark
    ? createVoid({ bounds: { x: 0, z: 0, halfX: hx, halfZ: hz } })
    : null;
  if (dusk) group.add(dusk.group);
  group.position.set(centre.x, 0, centre.z);
  group.rotation.y = rotation;
  return {
    group,
    wall,
    dark: dusk,
    variant,
    bounds: { minX: -hx, maxX: hx, minZ: -hz, maxZ: hz },
    stats: wall.stats,
    update() {},
    dispose() { wall.dispose(); dusk?.dispose(); },
  };
}

export default createWall;
