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

  // The lowest the top of the wall ever gets ANYWHERE. Measured, not
  // estimated: the minimum over all four variants, three joint kinds and
  // sixteen seeds of the highest point above every square decimetre of the
  // footprint. It is the body's flat top showing through a gap where a coping
  // stone has gone, in a bay that has also settled.
  //
  // `height` is the nominal crown and is the number to DESIGN against; this is
  // the number to ASSERT against. The margin it leaves over the ghost's
  // measured crown of 1.761 is 34 millimetres, which is thin and is stated
  // rather than rounded away: the ghost is hidden everywhere on every variant,
  // but only just, at the one worst square decimetre of a level. If the ghost
  // ever grows, the thing to shrink is the variants' copeH -- the body's flat
  // top is what a missing coping stone exposes and it sits copeH below the
  // crown -- and not this constant.
  minCrown: 1.79,

  // Stated rather than implied. The ghost hops the 0.86 fence; it does not get
  // over this, in any variant, at any height, at any joint, ever. A rule that
  // lets it is a bug in the rule.
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
    stone: '#8c5b45',
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
    stone: '#9b9284',
    mortar: '#75705f',
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
    sag: 0.062,
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
    plinthH: 0.20,
    plinthOut: 0.055,
    chamfer: 0.045,
    batter: 0.02,
    // The plinth's own cope, which the railings stand on.
    copeH: 0.15,
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
    railThick: 0.095,
  },
};

// How many styles one wall may carry. The named set is four, the shader loops
// over them per fragment, and an editor that needs five on one enclosure wants
// two enclosures.
export const MAX_STYLES = 4;

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
//
// For the ironwork the whole of this is the PLINTH: the section tops out at
// v.plinthTop rather than at the wall's crown, and the railings stand on it.
// That one substitution is the entire difference in the build, which is the
// point of having it -- an iron boundary is a low wall with bars on, so it is
// the low wall this already makes plus the bars.
function sections(H, v) {
  const bed = 0.02;
  const hb = v.thickness / 2;
  const top = v.kind === 'railing' ? v.plinthTop : H;
  const cb = top - v.copeH;        // where the coping sits on the body

  const bodyRight = [
    [hb + v.plinthOut, -bed],
    [hb + v.plinthOut, v.plinthH],
    [hb, v.plinthH + v.chamfer],
    [hb - v.batter, cb],
  ];
  // The coping's drip is a proportion of its own depth rather than a fixed
  // 45mm, and its face is held at least 12mm tall. Fixed numbers were fine
  // while there was one section; on the railing's shallow plinth cope they made
  // the drip and the top of the face land on exactly the same y, which is a
  // zero-length edge, which is a zero NORMAL -- a black band all the way round
  // the plinth. A section built from a table of variants has to survive the
  // whole table.
  const lip = Math.min(0.045, v.copeH * 0.28);
  const faceTop = Math.max(cb + lip + 0.012, top - v.crown - lip);
  const copeRight = [
    [hb - v.batter, cb],
    [hb + v.copeOut, cb + lip],
    [hb + v.copeOut, faceTop],
    [(hb + v.copeOut) * 0.80, top - v.crown],
    [0, top],
  ];

  // Close each into a loop. The body's is flat on top and open-ended at the
  // bottom edge (buried, and no camera at 29 degrees of elevation can see it);
  // the coping's is flat underneath.
  // Close a half section into a loop, dropping any point that lands on top of
  // its neighbour. A coincident pair is a zero-length edge and edgeNormal has
  // nothing to divide by, so the face built off it comes back unlit; belt and
  // braces against the same failure the lip clamp above prevents at source.
  const close = (right, apex) => {
    const loop = [];
    const add = (u, y) => {
      const last = loop[loop.length - 1];
      if (last && Math.hypot(last[0] - u, last[1] - y) < 1e-5) return;
      loop.push([u, y]);
    };
    for (const [u, y] of right) add(u, y);
    for (let i = right.length - (apex ? 2 : 1); i >= 0; i--) add(-right[i][0], right[i][1]);
    if (loop.length > 2) {
      const f = loop[0];
      const l = loop[loop.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-5) loop.pop();
    }
    return loop;
  };

  return { body: close(bodyRight, false), cope: close(copeRight, true), copeBottom: cb, top };
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

// Where the piers stand, worked out from the raw corner polyline before
// anything is sampled or swept.
//
// It has to come first because the piers define the BAYS, and the bays are what
// every other kind of variation on this wall is keyed to: the coursing, the
// settle, the lean and the tone all change from one bay to the next and are
// constant within one. That ordering is the whole shape of the build.
//
// One pier at every original corner, one at each gate jamb, and the rest spread
// evenly along each corner-to-corner span so no bay is a different length from
// its neighbours. `spacing` is a target, not a law.
function pierPlan(points, closed, spacing, openings, forced = []) {
  const src = points.map((p) => ({ x: p.x, z: p.z }));
  if (closed && src.length > 1) {
    const a = src[0];
    const b = src[src.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-6) src.pop();
  }
  const n = src.length;
  const corners = [0];
  let s = 0;
  const legs = closed ? n : n - 1;
  for (let i = 0; i < legs; i++) {
    const a = src[i];
    const b = src[(i + 1) % n];
    s += Math.hypot(b.x - a.x, b.z - a.z);
    corners.push(s);
  }
  const total = s;

  const inGap = (d) => openings.some((o) => d > o.a + 1e-6 && d < o.b - 1e-6);
  const want = new Set();
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    const k = Math.max(1, Math.round((b - a) / spacing));
    for (let j = 0; j <= k; j++) want.add(+(a + ((b - a) * j) / k).toFixed(4));
  }
  for (const o of openings) { want.add(+o.a.toFixed(4)); want.add(+o.b.toFixed(4)); }
  // A 'pier' joint asks for a pier exactly where two builds meet, wherever that
  // falls. It is added rather than snapped to the lattice: the whole point of
  // the joint is that the pier stands ON it, and a pier half a metre away from
  // the change is a pier with a seam beside it.
  for (const d of forced) want.add(+Math.max(0, Math.min(total, d)).toFixed(4));

  const out = [];
  const seen = new Set();
  for (const d of [...want].sort((p, q) => p - q)) {
    if (inGap(d)) continue;
    const key = closed && Math.abs(d - total) < 1e-6 ? 0 : d;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Math.min(d, total));
  }
  return { at: out, corners, total };
}

// Turn the caller's corners into a sampled path: every original corner kept
// exactly, straight spans subdivided so the coping has somewhere to undulate,
// and a DOUBLED sample at every pier.
//
// The doubling is not cosmetic and it is worth knowing why it is there, because
// it looks like a redundant vertex. The bay index rides in a vertex attribute,
// and a vertex attribute is INTERPOLATED: with one sample either side of a
// pier, the attribute ramps smoothly from bay 3 to bay 4 across the span
// between them, so every fragment in that span hashes to a different bay and
// the whole span comes back as a band of dense speckle. Which is exactly what
// the first render of this pass showed -- a vertical bar of noise at every
// pier, twenty-four of them. Two coincident samples make the span between the
// bays zero-length, so no triangle anywhere spans two bays and the attribute is
// constant across every one of them. The change of coursing then happens on a
// plane that stands inside a pier, which is the same trick the fence uses to
// hide a rail joint inside a post.
//
// Corners are never moved and never wander. A corner that has drifted off the
// lattice is a corner that no longer meets the level's own grid, and the whole
// point of a 6 by 6 of major squares is that the wall lands on the lines.
function samplePath(points, closed, step, rand, wander, splits) {
  const src = points.map((p) => ({ x: p.x, z: p.z }));
  if (closed && src.length > 1) {
    const a = src[0];
    const b = src[src.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-6) src.pop();
  }
  const n = src.length;
  const out = [];
  const legs = closed ? n : n - 1;

  let base = 0;
  for (let i = 0; i < legs; i++) {
    const a = src[i];
    const b = src[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const parts = Math.max(1, Math.round(len / step));
    // Every subdivision of this leg, plus every split that falls inside it.
    const ds = new Set();
    for (let k = 0; k < parts; k++) ds.add(+((len * k) / parts).toFixed(5));
    for (const sp of splits) {
      const d = sp - base;
      if (d > 1e-5 && d < len - 1e-5) ds.add(+d.toFixed(5));
    }
    const list = [...ds].sort((p, q) => p - q);
    for (const d of list) {
      const t = d / len;
      const onPier = d === 0 || splits.some((sp) => Math.abs(sp - (base + d)) < 1e-4);
      const pt = {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        corner: d === 0,
        // `pier` is on BOTH halves of a doubled pair and is what suppresses the
        // lateral wander, so the two really are coincident and the zero-length
        // span between them can be dropped. `split` is on the SECOND only and
        // is what opens the next bay. Marking both with one flag was the first
        // try and it cost eight hundred triangles of zero-area quads, because
        // the first half kept a random wander and the pair no longer coincided.
        pier: onPier,
        s: base + d,
      };
      out.push(pt);
      // The leg start is a corner and always carries a pier, so it doubles too.
      if (onPier) out.push({ ...pt, split: true });
    }
    base += len;
  }
  const total = base;
  if (!closed) out.push({ x: src[n - 1].x, z: src[n - 1].z, corner: true, s: total });

  // The run direction either side of a sample, as an across-vector.
  //
  // Both skip over coincident samples, because a doubled pier sample has no
  // direction of its own and asking it for one gives the zero vector. Both
  // also refuse to WRAP on an open path, and that second rule is the one worth
  // the comment: the sample after the doubled pair at the start of an open run
  // has nothing behind it but its own twin, so a wrapping search ran all the
  // way round to the far END of the wall and came back with the direction
  // reversed. The mitre of a direction against its own opposite is the zero
  // vector, so that one sample's whole ring collapsed onto the centreline with
  // no normals -- a black fin sticking out of the end of every open run, which
  // is what two renders of the toothed joint were showing.
  const dirAt = (i) => {
    const a = out[i];
    for (let k = 1; k <= out.length; k++) {
      const j = i + k;
      if (!closed && j >= out.length) return null;
      const b = out[j % out.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (Math.hypot(dx, dz) > 1e-7) return across(dx, dz);
    }
    return null;
  };
  const dirBefore = (i) => {
    const b = out[i];
    for (let k = 1; k <= out.length; k++) {
      const j = i - k;
      if (!closed && j < 0) return null;
      const a = out[(j + out.length * 2) % out.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (Math.hypot(dx, dz) > 1e-7) return across(dx, dz);
    }
    return null;
  };
  for (let i = 0; i < out.length; i++) {
    let prev = dirBefore(i);
    let next = dirAt(i);
    if (!prev) prev = next;
    if (!next) next = prev;
    if (!prev) { prev = across(1, 0); next = prev; }
    // Both halves of a doubled pair take the same mitre, which on a straight is
    // just the run's own across-vector and at a corner is the bisector. They
    // are coincident, so the span between them is zero-length whatever frame
    // they carry; what matters is only that they carry the SAME one, or the
    // zero-length span opens into a sliver.
    const m = miter(prev, next);
    out[i].m = m;
    const ml = Math.hypot(m.x, m.z) || 1;
    out[i].n = { x: m.x / ml, z: m.z / ml };
    // A wall that has stood a hundred years is not on a line. The wander is
    // lateral and tiny, and it is zero at every corner and every pier.
    out[i].wander = out[i].pier ? 0 : (rand() * 2 - 1) * wander;
  }

  // UNROLL a closed loop: the last sample is a copy of the first, so the sweep
  // never wraps. Without it the span from the last sample back to sample zero
  // would carry the last bay's index at one end and bay zero's at the other,
  // which is the speckle band again, once, at the seam.
  if (closed) {
    out.push({ ...out[0], s: total, seam: true });
    out[0].seam = true;
  }

  return { pts: out, total, loop: closed, closed: false };
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
        // frame from end to end: only an original corner turns. The bay is the
        // one the span belongs to, which is the one its first sample carries.
        m: a.m,
        n: a.n,
        bay: a.bay,
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
  // Walk the path's OWN samples and insert the cuts between them, rather than
  // sorting a list of distances and re-deriving a sample for each. Sorting
  // distances loses the doubled samples at every pier -- two of them share one
  // distance -- and with the doubles gone the bay and style attributes are
  // interpolated across the pier again, which is the speckle band this whole
  // arrangement exists to prevent. It only showed up on GATED walls, because a
  // wall with no gaps takes the early return above and never comes here.
  const marks = [];
  let ci = 0;
  const sorted = [...cuts].sort((p, q) => p - q);
  for (const pt of path.pts) {
    while (ci < sorted.length && sorted[ci] < pt.s - 1e-6) marks.push(pointAt(path, sorted[ci++]));
    if (ci < sorted.length && Math.abs(sorted[ci] - pt.s) < 1e-6) ci++;
    marks.push(pt);
  }
  while (ci < sorted.length) marks.push(pointAt(path, sorted[ci++]));
  for (const pt of marks) {
    if (inGap(pt.s)) { flush(); continue; }
    current.push(pt);
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
  const stone = new Float32Array(rings * vertsPerRing * 3);
  const style = new Float32Array(rings * vertsPerRing * 4);
  const index = [];

  for (let i = 0; i < rings; i++) {
    const p = path.pts[i];
    const bay = p.bay || 0;
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
        stone[vi * 3] = p.s;
        stone[vi * 3 + 1] = stamp.flags;
        stone[vi * 3 + 2] = bay;
        style[vi * 4] = stamp.style[0];
        style[vi * 4 + 1] = stamp.style[1];
        style[vi * 4 + 2] = stamp.style[2];
        style[vi * 4 + 3] = stamp.style[3];
      }
    }
  }

  for (let i = 0; i < spans; i++) {
    const a = i * vertsPerRing;
    const b = ((i + 1) % rings) * vertsPerRing;
    // The doubled samples at every pier leave a zero-length span between them.
    // Its quads are exactly zero-area, so the surface is continuous whether
    // they are there or not, and on a 30 by 30 they were sixteen hundred
    // triangles of nothing. Skipped.
    const dx = position[b * 3] - position[a * 3];
    const dy = position[b * 3 + 1] - position[a * 3 + 1];
    const dz = position[b * 3 + 2] - position[a * 3 + 2];
    if (dx * dx + dy * dy + dz * dz < 1e-12) continue;
    for (let e = 0; e < edges; e++) {
      index.push(a + e * 2, b + e * 2, b + e * 2 + 1, a + e * 2, b + e * 2 + 1, a + e * 2 + 1);
    }
  }

  return buildGeometry(position, normal, stone, style, index);
}

// Flat cap over the end of a run, fanned from a point on the wall's own axis.
// Every section here is star shaped about its own centre -- every vertex of it
// is visible from the axis, coping oversail included -- so a fan is a valid
// triangulation and no ear clipping is needed.
function endCap(path, loop, end, shape, stamp) {
  const p = path.pts[end === 0 ? 0 : path.pts.length - 1];
  const ys = loop.map((q) => q[1]);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  // Which way this end faces. Walk INWARDS past any coincident samples before
  // taking the difference: a run very often begins and ends on a pier, and a
  // pier's sample is doubled, so pts[0] and pts[1] are the same point and the
  // naive difference is the zero vector. A cap with a zero normal is not
  // subtly wrong, it is BLACK -- no diffuse, no ambient, a flat black quad
  // hanging off the end of the wall, which is what the first render of the
  // toothed joint showed at both ends of every run.
  const step2 = end === 0 ? 1 : -1;
  let dir = { x: 0, z: 0 };
  for (let i = (end === 0 ? 0 : path.pts.length - 1) + step2;
    i >= 0 && i < path.pts.length; i += step2) {
    const q = path.pts[i];
    const dx = p.x - q.x;
    const dz = p.z - q.z;
    if (Math.hypot(dx, dz) > 1e-7) { dir = { x: dx, z: dz }; break; }
  }
  // `dir` is built pointing OUT of the run at whichever end this is, so it
  // needs no sign of its own.
  const dl = Math.hypot(dir.x, dir.z) || 1;
  const nx = dir.x / dl;
  const nz = dir.z / dl;
  const bay = p.bay || 0;

  const position = [];
  const normal = [];
  const stone = [];
  const style = [];
  const push = (u, v) => {
    const uu = u + shape.lean(p.s, v);
    position.push(p.x + p.m.x * uu, v + shape.settle(p.s, v), p.z + p.m.z * uu);
    normal.push(nx, 0, nz);
    stone.push(p.s, stamp.flags, bay);
    style.push(...stamp.style);
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
  return buildGeometry(position, normal, stone, style, index);
}

function buildGeometry(position, normal, stone, style, index) {
  const geo = new THREE.BufferGeometry();
  const F = (a, n) => (a instanceof Float32Array
    ? new THREE.BufferAttribute(a, n)
    : new THREE.Float32BufferAttribute(a, n));
  geo.setAttribute('position', F(position, 3));
  geo.setAttribute('normal', F(normal, 3));
  // aStone: distance along the run, the dressed/iron flags packed as
  // dressed + 2 * iron, and the bay index.
  geo.setAttribute('aStone', F(stone, 3));
  // aStyle: the style either side of any joint in this piece, where the joint
  // is, and how far the new work bites into the old. On a plain piece the two
  // styles are the same and the joint is off at a million, so the toothing
  // arithmetic in the shader falls through to "always the first style".
  geo.setAttribute('aStyle', F(style, 4));
  geo.setIndex(index);
  return geo;
}

// A style stamp for a piece of plain wall in one style.
const plainStyle = (i) => [i, i, 1e6, 0];

// A pier: a chamfered square shaft with a capstone, standing a little above the
// coping. This is the fence's post doing the fence's job -- it breaks the run
// into bays, it sits over every corner, it stands at every gate jamb, and
// anything awkward about a joint happens inside it. Every variant uses it,
// including the ironwork, which is how a railed cemetery boundary is actually
// built: stone piers with iron panels hung between them.
function pier(p, size, H, rise, rand, bay, styleIdx) {
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
  const style = [];
  const index = [];
  const st = plainStyle(styleIdx);

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
      stone.push(sv, dressed, bay);
      style.push(st[0], st[1], st[2], st[3]);
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
  stone.push(p.s, 1, bay);
  style.push(st[0], st[1], st[2], st[3]);
  for (let e = 0; e < ring.length; e++) {
    const q = world(ring[e][0] * ts, ring[e][1] * ts, ty);
    position.push(q[0], q[1], q[2]);
    normal.push(0, 1, 0);
    stone.push(p.s + arc[e], 1, bay);
    style.push(st[0], st[1], st[2], st[3]);
  }
  for (let e = 0; e < ring.length; e++) {
    index.push(capBase, capBase + 1 + ((e + 1) % ring.length), capBase + 1 + e);
  }

  const geo = buildGeometry(position, normal, stone, style, index);
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
function railingBars(path, v, H, piers, rand, styleIdx, isOpen = () => true) {
  const r = v.barSize / 2;
  const ring = [[r, r], [-r, r], [-r, -r], [r, -r]];
  const y0 = v.plinthTop - 0.02;
  const y1 = H;

  const position = [];
  const normal = [];
  const stone = [];
  const style = [];
  const index = [];
  const st = plainStyle(styleIdx);

  const world = (p, u, w, y) => [p.x + u * p.n.x - w * p.n.z, y, p.z + u * p.n.z + w * p.n.x];

  // Bars are laid out bay by bay rather than along the whole perimeter, so a
  // bay's bars are evenly spaced within it and none of them lands inside a
  // pier. Corners therefore never carry a bar: a corner always has a pier.
  for (let i = 0; i < piers.length - 1; i++) {
    const a = piers[i].s + WALL.pier.width * 0.62;
    const b = piers[i + 1].s - WALL.pier.width * 0.62;
    const span = b - a;
    if (span <= v.barPitch) continue;
    // Two consecutive piers are not always a bay: the two jambs of a gate are
    // consecutive too, and the first render of a railed wall with a gate in it
    // had the gateway neatly filled in with bars.
    if (!isOpen((a + b) / 2)) continue;
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
          stone.push(s, 3, p.bay || 0);   // dressed + 2 * iron
          style.push(st[0], st[1], st[2], st[3]);
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

  const geo = buildGeometry(position, normal, stone, style, index);
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

export function wallMaterial(variants = ['ashlar'], options = {}) {
  const names = (Array.isArray(variants) ? variants : [variants]).slice(0, MAX_STYLES);
  const vs = names.map(wallVariant);
  const N = Math.max(1, vs.length);
  const topOf = (v) => (v.kind === 'railing' ? v.plinthTop : WALL.height);

  const uniforms = {
    uStoneA: { value: vs.map((v) => new THREE.Vector4(v.course, v.length, v.joint, v.jointDepth)) },
    uStoneB: { value: vs.map((v) => new THREE.Vector4(v.tone, v.rowJitter, v.grime, v.mossAmount)) },
    uStoneC: { value: vs.map((v) => new THREE.Color(v.stone)) },
    uMortarC: { value: vs.map((v) => new THREE.Color(v.mortar)) },
    uMossC: { value: vs.map((v) => new THREE.Color(v.moss)) },
    uCopeY: { value: vs.map((v) => topOf(v) - v.copeH) },
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
      attribute vec3 aStone;
      attribute vec4 aStyle;
      varying vec3 vStone;
      varying vec4 vStyle;
      ${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // Object space, like the fence's grain: the wander, the lean and the
      // settled coping are in the mesh, and the coursing has to be read before
      // them or the joints shear off the wall wherever it goes out of true.
      vStone = vec3(aStone.x, transformed.y, aStone.z);
      vFlags = aStone.y;
      vStyle = aStyle;`,
    ).replace('varying vec4 vStyle;', 'varying vec4 vStyle;\n      varying float vFlags;');

    shader.fragmentShader = `
      varying vec3 vStone;
      varying vec4 vStyle;
      varying float vFlags;
      uniform vec4 uStoneA[${N}];
      uniform vec4 uStoneB[${N}];
      uniform vec3 uStoneC[${N}];
      uniform vec3 uMortarC[${N}];
      uniform vec3 uMossC[${N}];
      uniform float uCopeY[${N}];

      float wallHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      // Everything about one style, fetched by index.
      //
      // Written as a loop with a MASK rather than as uStoneA[int(idx)], because
      // an index computed from a varying is a dynamic index and GLSL ES 1.00
      // will not have it. Four iterations of six multiply-adds is nothing, and
      // it compiles everywhere. It is also what lets the toothed joint below
      // fetch a SECOND style for the same fragment: a wall whose styles were
      // separate materials could not do that at all, which is the whole reason
      // they are uniforms.
      void wallStyle(float idx, out vec4 sa, out vec4 sb, out vec3 col,
                     out vec3 mort, out vec3 mossc, out float copeY) {
        sa = vec4(0.0); sb = vec4(0.0);
        col = vec3(0.0); mort = vec3(0.0); mossc = vec3(0.0); copeY = 0.0;
        for (int i = 0; i < ${N}; i++) {
          float w = 1.0 - min(1.0, abs(float(i) - idx));
          sa += uStoneA[i] * w;
          sb += uStoneB[i] * w;
          col += uStoneC[i] * w;
          mort += uMortarC[i] * w;
          mossc += uMossC[i] * w;
          copeY += uCopeY[i] * w;
        }
      }
      ${shader.fragmentShader}`
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Iron in the same draw call as stone. vFlags is the only thing that
        // separates them, and it moves the surface as well as the colour --
        // painted ironwork is smoother and darker and takes a specular the
        // masonry never does, and without that the railings read as grey sticks.
        float vIron = step(1.5, vFlags);
        roughnessFactor = mix(roughnessFactor, 0.44, vIron);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55, step(1.5, vFlags));`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      {
        float iron = step(1.5, vFlags);
        float dressed = vFlags - 2.0 * iron;
        float bay = vStone.z;
        float bh = wallHash(vec2(bay, 5.0));
        float bh2 = wallHash(vec2(bay, 19.0));
        float bh3 = wallHash(vec2(bay, 41.0));

        // The style in force where this run STARTED. On a plain run it is the
        // only style there is; at a toothed joint it is the older of the two.
        float idxA = floor(vStyle.x + 0.5);
        vec4 sa; vec4 sb; vec3 col; vec3 mort; vec3 mossc; float copeY;
        wallStyle(idxA, sa, sb, col, mort, mossc, copeY);

        // Per bay coursing. A bay is a length of wall between two piers, and a
        // real one was laid by one gang on one day: its beds are its own depth
        // and its stones are its own size, and neither lines up with its
        // neighbour's across the pier that divides them.
        float course = sa.x * (0.86 + 0.30 * bh);

        // A course wobbles a little rather than running dead level. Old masonry
        // is laid to a line, not to a laser, and perfectly parallel courses are
        // the single thing that makes a procedural wall read as wallpaper.
        float y = vStone.y + 0.010 * sin(vStone.x * 1.9 + bh3 * 6.3)
                           + 0.005 * sin(vStone.x * 5.3 + 1.7);
        float rowA = floor(y / course);

        // THE TOOTHED JOINT.
        //
        // vStyle.z is where the two builds meet and vStyle.w is how far the new
        // work bites into the old. The boundary is not a line: it steps in and
        // out by one bite from course to course, which is exactly what a mason
        // leaves when he racks back an existing wall to bond new work into it.
        // Alternating strictly would read as a zip, so the bite is scaled by a
        // per course hash as well -- some courses bite deep, some barely.
        //
        // The rule is evaluated in the OLD wall's coursing, which is not a
        // convenience: you tooth into the courses that are there. That is also
        // why a toothed joint does not change the section or the bay, and why
        // the geometry runs straight through it -- there is nothing to change,
        // it is one piece of wall with two materials in it.
        float bite = (mod(rowA, 2.0) < 1.0 ? 1.0 : -1.0)
                   * vStyle.w * (0.45 + 1.05 * wallHash(vec2(rowA, 23.0)));
        float idx = vStone.x < vStyle.z + bite ? idxA : floor(vStyle.y + 0.5);
        if (abs(idx - idxA) > 0.5) {
          wallStyle(idx, sa, sb, col, mort, mossc, copeY);
          course = sa.x * (0.86 + 0.30 * bh);
        }

        // The stone's own colour comes from the style rather than from the
        // vertex, because at a toothed joint two fragments of one triangle are
        // two different materials. The vertex colour is left carrying the slow
        // lengthwise mottle, and the iron.
        diffuseColor.rgb *= mix(col, vec3(1.0), iron);

        if (iron < 0.5) {
          float nominal = sa.y * (0.80 + 0.44 * bh2);

          // Uncoursed rubble. Work out a coarse column FIRST, from the distance
          // along alone, then shove that whole column of stone up or down
          // before the beds are worked out. The beds then wander by a stone at
          // a time instead of running through, which is the difference between
          // a rubble wall and a coursed one and it is the only difference that
          // reads at scene size.
          float coarse = floor(vStone.x / (nominal * 1.7) + bh3 * 3.0);
          float yy = y + sb.y * (wallHash(vec2(coarse, 71.0)) - 0.5);

          float rowF = yy / course;
          float row = floor(rowF);
          float rowT = fract(rowF);

          // Every course is offset by its own amount and its stones are its own
          // length, so no two courses break in the same place and nothing
          // stacks into a running joint.
          float rh = wallHash(vec2(row, 3.0 + bay * 0.37 + idx * 11.0));
          float len = nominal * (0.72 + 0.62 * wallHash(vec2(row, 11.0 + bay)));
          float colF = (vStone.x + 0.028 * sin(yy * 21.0 + rh * 6.3)) / len + rh * 7.0 + bay * 2.3;
          float cl = floor(colF);
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
          // The dressed flag marks a piece that is one stone rather than a
          // run of masonry: the capstones. It keeps the tone and the grime and loses
          // the joints.
          float jnt = (1.0 - dressed) * (1.0 - smoothstep(sa.z * 0.5 - w, sa.z * 0.5 + w, d));

          // Per stone tone. The whole reason the coursing reads from across a
          // level: the joints themselves are a pixel wide at that distance and
          // vanish, and what is left is a field of slightly different tones,
          // which is exactly what a masonry wall looks like from fifty metres.
          diffuseColor.rgb *= 1.0 + (wallHash(vec2(cl, row)) - 0.5) * sb.x;
          // And then, rarely, a block that is properly darker than its
          // neighbours -- a different stone out of a different quarry, a brick
          // that came out of the kiln too hot. Roughly one in eight. Evenly
          // spread tone is camouflage; the outliers are what the eye actually
          // catches, and they are what stops thirty units of wall averaging out
          // into one flat grey.
          diffuseColor.rgb *= 1.0 - 0.26 * smoothstep(0.87, 1.0, wallHash(vec2(cl, row + 13.0)));
          // The stone just under a joint catches less light.
          diffuseColor.rgb *= 1.0 - (1.0 - dressed) * 0.10 * (1.0 - smoothstep(0.0, course * 0.30, dv));
          diffuseColor.rgb = mix(diffuseColor.rgb, mort, jnt * sa.w);

          // WHERE TWO SURFACES MEET is where a wall stains, and there are two
          // such places on this section. The first is the ground, and the first
          // third of a metre out of it is grubby and then mossy.
          float wet = 1.0 - smoothstep(0.0, 0.36, vStone.y);
          // The second is under the coping's oversail, where the run-off comes
          // off the drip and streaks the face below it. Narrower and dirtier
          // than the ground stain, and it is the term that makes the coping
          // read as a separate thing laid on top rather than as the top of the
          // wall.
          float drip = (1.0 - smoothstep(0.0, 0.22, copeY - vStone.y)) * step(vStone.y, copeY);
          drip *= 0.35 + 0.65 * wallHash(vec2(cl, 97.0));

          diffuseColor.rgb *= 1.0 - sb.z * (wet * (0.55 + 0.45 * wallHash(vec2(cl, row + 31.0))) + drip * 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, mossc,
                                 sb.w * wet * 0.55 * smoothstep(0.45, 0.95, wallHash(vec2(cl, row + 57.0))));
        }
      }`,
      );
  };
  // Same trap as the fence: three keys its program cache on the stock shader,
  // so without this every wall on the page recompiles into its own program.
  // Keyed on the style COUNT only, because that is the only thing that changes
  // the source: which four styles they are is uniforms.
  material.customProgramCacheKey = () => `graveyard-wall:${N}`;
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
    const iron = stone.getY(i) > 1.5;
    // Masonry gets a near-white mottle and takes its hue from the style
    // uniform, because a toothed joint puts two materials inside one triangle
    // and a vertex cannot answer for both. Iron gets its colour outright,
    // which is what keeps the railings in the same draw call as the stone.
    if (iron) c.copy(ironColour);
    else c.setScalar((1 + 0.045 * Math.sin(s * 0.31)) * (1 + 0.030 * Math.sin(s * 1.13 + 2.1)));
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
//   variant   one of WALL.variants; the style the wall STARTS in
//   styles    style changes along the run, and how each change is made:
//
//               styles: [
//                 { at: 22, variant: 'brick',  joint: 'tooth' },
//                 { at: 58, variant: 'rubble', joint: 'pier'  },
//                 { at: 84, variant: 'iron',   joint: 'step'  },
//               ]
//
//             `at` is a distance along the centreline from points[0], the same
//             coordinate `gate` and `gaps` already use, so an editor that can
//             place a gate can place a style change with the code it has. Each
//             entry means "from here on, this style", so a wall is never left
//             with a length that has no style; the base `variant` covers from
//             zero to the first change. At most MAX_STYLES distinct styles on
//             one wall, the joint's own style included.
//
//             joint is how the two builds meet:
//               'pier'   a pier stands on the change. The workhorse: it reads
//                        at any size and it is the only one that can absorb an
//                        arbitrary difference of thickness. `jointVariant`
//                        makes the pier a style of its own; by default it is
//                        the OLDER of the two, because the new work was built
//                        up to a buttress that was already there.
//               'tooth'  the new material bites into the old, course by
//                        course. No pier, no vertical line, no change of
//                        section: the geometry runs straight through and the
//                        two materials interlock in the fragment shader. The
//                        section changes at the next pier along, which is
//                        where a real one changes too.
//               'step'   a straight vertical break with the new build standing
//                        slightly proud of the old. Both ends are capped, so
//                        the step is a real face and not a gap.
//
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
  styles = null,
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

  // --- the styles -----------------------------------------------------------
  // Normalised first, because the joints between them add pier positions and
  // section cuts, and the pier positions define the bays that everything else
  // is keyed to. The order is: styles, then piers, then the sampled path, then
  // the bays, then the geometry. Each one needs the one before it.
  const changes = (styles || [])
    .filter((c) => c && c.variant && c.at > 0)
    .map((c) => ({ at: c.at, variant: c.variant, joint: c.joint || 'pier', jointVariant: c.jointVariant || null }))
    .sort((p, q) => p.at - q.at);

  const used = [];
  const idxOf = (name) => {
    let i = used.indexOf(name);
    if (i < 0) { used.push(name); i = used.length - 1; }
    if (used.length > MAX_STYLES) throw new Error(`createWall() takes at most ${MAX_STYLES} styles`);
    return i;
  };
  idxOf(variant);
  for (const c of changes) idxOf(c.variant);
  for (const c of changes) if (c.jointVariant) idxOf(c.jointVariant);

  // The style whose SURFACE is in force at a distance.
  const surfaceAt = (d) => {
    let name = variant;
    for (const c of changes) if (c.at <= d + 1e-6) name = c.variant;
    return name;
  };

  const v = { ...wallVariant(variant) };
  if (thickness) v.thickness = thickness;
  const rand = rng(seed);

  // Openings.
  const openings = []
    .concat(gate ? (Array.isArray(gate) ? gate : [gate]) : [])
    .concat(gaps || [])
    .map((g) => ({ a: g.at - g.width / 2, b: g.at + g.width / 2 }))
    .sort((p, q) => p.a - q.a);
  const inOpening = (d) => openings.some((o) => d > o.a + 1e-6 && d < o.b - 1e-6);

  // Piers, from the raw polyline. A 'pier' joint forces one where it stands.
  const plan = pierPlan(points, closed, pierSpacing, openings,
    changes.filter((c) => c.joint === 'pier').map((c) => c.at));

  // WHERE THE SECTION CHANGES, which is not always where the STYLE changes.
  //
  //   pier and step   the section changes at the joint. Both are a real
  //                   vertical break in the masonry and both are capped.
  //   tooth           the section does NOT change at the joint. It cannot: a
  //                   toothed joint is one piece of wall with two materials
  //                   bonded into it, and two pieces of different thickness
  //                   cannot bond. So the new material starts at the joint and
  //                   is laid in the OLD wall's thickness and the OLD wall's
  //                   courses until the next pier, where the section changes
  //                   under it. Which is exactly what happens on the ground:
  //                   you tooth into what is there and you carry on in your own
  //                   work from the next buttress.
  for (const c of changes) {
    c.cut = c.joint === 'tooth'
      ? (plan.at.find((d) => d > c.at + 1e-6) ?? plan.total)
      : c.at;
  }
  const cutSet = new Set(changes.map((c) => +c.cut.toFixed(4)));

  // Samples are doubled at every pier AND at every section cut, so no triangle
  // anywhere straddles a change of bay, of style or of section.
  const splits = [...new Set([...(piers ? plan.at : []), ...cutSet])].sort((p, q) => p - q);
  const path = samplePath(points, closed, step, rand, wander, splits);
  const pierS = piers ? plan.at.map((d) => pointAt(path, d)) : [];

  // Number the bays, walking the samples in order. A bay opens at the SECOND of
  // each doubled pier sample, so no span ever straddles two of them.
  const bayStart = [0];
  {
    let bay = 0;
    for (const pt of path.pts) {
      if (pt.split) { bay += 1; bayStart[bay] = pt.s; }
      pt.bay = bay;
    }
  }
  const bayRange = (i) => [bayStart[i] ?? 0, bayStart[i + 1] ?? path.total];
  const bayAt = (s) => {
    let i = 0;
    while (i + 1 < bayStart.length && bayStart[i + 1] <= s + 1e-6) i++;
    return i;
  };

  // --- how each bay is out of true ------------------------------------------
  // The first pass had one sine of amplitude 0.022 running the whole perimeter,
  // which at 30 units a side is a ripple you cannot see. This is per bay and an
  // order of magnitude bigger: one bay has slumped in the middle, the next
  // leans out at the top, the one after is straight. Quadratic in height in
  // both cases, so the footing stays bedded in the dirt and all of the movement
  // is where the eye reads a wall's line, along its top. Zero at both ends of a
  // bay, so the wall is pinned wherever a pier holds it up -- which is what a
  // pier is for, and which is also why no bay's slump ever shows as a step
  // against its neighbour's.
  const bays = bayStart.map(() => ({
    sag: (rand() * 2 - 1) * v.sag,
    lean: (rand() * 2 - 1) * v.lean,
  }));
  const ph = rand() * Math.PI * 2;
  const shapeAt = (s) => {
    const i = bayAt(s);
    const [a0, b0] = bayRange(i);
    const t = b0 > a0 ? Math.min(1, Math.max(0, (s - a0) / (b0 - a0))) : 0;
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

  const parts = [];

  // --- the geometry spans ---------------------------------------------------
  // One span per stretch of wall that has one section. A span carries the style
  // stamp its fragments need: the style it starts in, the style it ends in, and
  // where between the two the toothing happens.
  const cutList = [0, ...[...cutSet].sort((p, q) => p - q), path.total];
  const spans = [];
  for (let i = 0; i < cutList.length - 1; i++) {
    const a0 = cutList[i];
    const b0 = cutList[i + 1];
    if (b0 - a0 < 1e-6) continue;
    // The section is whichever style's geometry cut most recently landed.
    let sectionName = variant;
    for (const c of changes) if (c.cut <= a0 + 1e-6) sectionName = c.variant;
    const startName = surfaceAt(a0 + 1e-6);
    const tooth = changes.find((c) => c.joint === 'tooth' && c.at > a0 + 1e-6 && c.at < b0 - 1e-6);
    spans.push({
      a: a0,
      b: b0,
      section: { ...wallVariant(sectionName), ...(thickness ? { thickness } : {}) },
      // At a toothed joint one triangle has to be able to answer for two
      // materials, which is why these ride together rather than one per piece.
      // How far the new work bites into the old, as a fraction of the OLD
      // wall's nominal stone. A bite has to be a stone, not a distance: half a
      // metre of tooth is two courses of brick and most of a block of ashlar,
      // and only one of those looks like masonry.
      style: tooth
        ? [idxOf(startName), idxOf(tooth.variant), tooth.at, 0.42 * wallVariant(startName).length]
        : plainStyle(idxOf(startName)),
      stepShift: changes.some((c) => c.joint === 'step' && Math.abs(c.cut - a0) < 1e-6) ? 0.075 : 0,
    });
  }
  // A step joint sets the new build off the line of the old, and it stays off
  // it: a wall rebuilt out of true does not come back into true at the next
  // corner. Accumulated, then held well inside WALL.collide so nothing the
  // ghost collides with has moved.
  {
    let shift = 0;
    for (const sp of spans) { shift = Math.max(-0.09, Math.min(0.09, shift + sp.stepShift)); sp.shift = shift; }
  }
  const spanAt = (d) => spans.find((sp) => d >= sp.a - 1e-6 && d < sp.b - 1e-6) || spans[spans.length - 1];

  // Slice a run wherever a section cut falls inside it. The samples are already
  // doubled there, so the cut costs nothing: the run simply ends on the first
  // of the pair and the next begins on the second.
  const slice = (run) => {
    const out = [];
    let cur = [run.pts[0]];
    for (let i = 1; i < run.pts.length; i++) {
      const q = run.pts[i];
      const prev = run.pts[i - 1];
      if (q.split && Math.abs(q.s - prev.s) < 1e-6 && cutSet.has(+q.s.toFixed(4))) {
        if (cur.length >= 2) out.push({ pts: cur, closed: false, total: run.total });
        cur = [q];
      } else cur.push(q);
    }
    if (cur.length >= 2) out.push({ pts: cur, closed: false, total: run.total });
    return out;
  };

  const shifted = (sp) => (sp.shift
    ? { settle: shape.settle, lean: (d, yy) => shape.lean(d, yy) + sp.shift }
    : shape);

  const capped = (run, loop, shp, stamp) => {
    // A run's ends want caps -- they are gate jambs, or the vertical face of a
    // step -- EXCEPT at the seam where an unrolled closed loop meets itself,
    // where the two ends are the same place and a cap there would be a wall
    // built across its own corner.
    if (!run.pts[0].seam) parts.push(endCap(run, loop, 0, shp, stamp));
    if (!run.pts[run.pts.length - 1].seam) parts.push(endCap(run, loop, 1, shp, stamp));
  };

  // Build one span's worth of a given loop, over the runs left after the gates
  // and any other gaps have been taken out.
  const build = (runs, loopOf, flags) => {
    for (const run of runs) {
      for (const piece of slice(run)) {
        const sp = spanAt(piece.pts[0].s);
        const loop = loopOf(sp);
        if (!loop) continue;
        const stamp = { flags, style: sp.style };
        const shp = shifted(sp);
        parts.push(sweep(piece, loop, shp, stamp));
        capped(piece, loop, shp, stamp);
      }
    }
  };

  const sectionOf = (sp) => sections(height, sp.section);

  // --- the body -------------------------------------------------------------
  build(cutRuns(path, openings), (sp) => sectionOf(sp).body, 0);

  // --- the coping, with stones missing out of it ----------------------------
  //
  // A wall that has stood long enough for its mortar to go is a wall that has
  // lost cope. This is the one piece of damage that reads at the game's
  // framing, because it breaks the SILHOUETTE: everything else on the wall is a
  // change of tone and the top line is the only line the eye is following.
  //
  // A break is a gap in the coping's own run, which is the gate machinery
  // pointed at a different loop, so it costs two end caps and nothing else.
  // Half of them get the stone put back, dropped and tilted, as though it had
  // shifted rather than gone; the other half are open and show the body's flat
  // top through them, which is why the body has one.
  const copeGaps = [];
  const displaced = [];
  {
    const rate = Math.max(...spans.map((sp) => sp.section.copeBreaks || 0), 0);
    const nBreaks = rate > 0 ? Math.round((path.total / rate) * breakage) : 0;
    for (let i = 0; i < nBreaks; i++) {
      // Spread rather than random, so two breaks never land on top of each
      // other and no bay collects all of them.
      const centre = ((i + 0.28 + rand() * 0.44) / nBreaks) * path.total;
      const width = 0.55 + rand() * 0.65;
      const sp = spanAt(centre);
      if (!(sp.section.copeBreaks > 0)) continue;   // a maintained boundary loses nothing
      const a0 = centre - width / 2;
      const b0 = centre + width / 2;
      // Never on a pier: the pier covers the coping there anyway, so a break
      // under one is a break nobody can see, and it would leave the cope
      // stopping short of the pier it should be running into. Never across a
      // section cut either, for the same reason the runs are sliced there.
      if (pierS.some((p) => Math.abs(p.s - centre) < WALL.pier.width * 0.9 + width / 2)) continue;
      if ([...cutSet].some((d) => d > a0 - 0.4 && d < b0 + 0.4)) continue;
      if (inOpening(a0) || inOpening(b0)) continue;
      // Not in a bay that has already sagged, and this one IS a gameplay rule
      // rather than an aesthetic one. A missing coping stone drops the top of
      // the wall to the body's flat top; a sagged bay drops it further; the two
      // together took the lowest point of a rubble enclosure to 1.764, which is
      // three millimetres over the ghost's crown. WALL.height is published and
      // the rules read it, so the wall is not allowed to have a place where it
      // is quietly no taller than the thing it exists to stop. Breaks are
      // therefore kept out of the bays that are already low, which costs one
      // break in five and buys back a hundred millimetres of clearance.
      if ((bays[bayAt(centre)] || bays[0]).sag < -0.35 * (sp.section.sag || 0)) continue;
      copeGaps.push({ a: a0, b: b0 });
      if (rand() < 0.45) displaced.push({ a: a0, b: b0, drop: 0.02 + rand() * 0.05, tilt: (rand() * 2 - 1) * 0.16 });
    }
    copeGaps.sort((p, q) => p.a - q.a);
  }

  build(cutRuns(path, [...openings, ...copeGaps].sort((p, q) => p.a - q.a)),
    (sp) => sectionOf(sp).cope, 0);

  // The stones that shifted rather than fell. Built as a one-span run over the
  // gap, then dropped and rolled about the run's own axis.
  for (const d of displaced) {
    const a0 = pointAt(path, d.a + 0.04);
    const b0 = pointAt(path, d.b - 0.04);
    if (b0.s <= a0.s) continue;
    const sp = spanAt(d.a);
    const { cope, copeBottom } = sectionOf(sp);
    const stamp = { flags: 0, style: sp.style };
    const shp = shifted(sp);
    const mini = { pts: [a0, b0], closed: false, total: path.total };
    const bits = [
      sweep(mini, cope, shp, stamp),
      endCap(mini, cope, 0, shp, stamp),
      endCap(mini, cope, 1, shp, stamp),
    ];
    const cx = (a0.x + b0.x) / 2;
    const cz = (a0.z + b0.z) / 2;
    const axis = new THREE.Vector3(b0.x - a0.x, 0, b0.z - a0.z).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, d.tilt);
    const mtx = new THREE.Matrix4()
      .makeTranslation(cx, copeBottom - d.drop, cz)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeTranslation(-cx, -copeBottom, -cz));
    for (const g of bits) { g.applyMatrix4(mtx); parts.push(g); }
  }

  // --- the railings ---------------------------------------------------------
  // Only over the spans whose style is a railing, which is what lets one
  // enclosure be stone down one side and iron down another.
  for (const sp of spans) {
    if (sp.section.kind !== 'railing') continue;
    const stamp = { flags: 3, style: sp.style };   // dressed + 2 * iron
    const shp = shifted(sp);
    const rail = railSection(sp.section, height);
    const within = (r) => r.pts[0].s >= sp.a - 1e-6 && r.pts[0].s < sp.b - 1e-6;
    for (const run of cutRuns(path, openings)) {
      for (const piece of slice(run)) {
        if (!within(piece)) continue;
        parts.push(sweep(piece, rail, shp, stamp));
        capped(piece, rail, shp, stamp);
      }
    }
    const inSpan = pierS.filter((p) => p.s >= sp.a - 1e-6 && p.s <= sp.b + 1e-6);
    parts.push(railingBars(path, sp.section, height, inSpan, rand, sp.style[0], (d) => !inOpening(d)));
  }

  // --- the piers ------------------------------------------------------------
  for (const p of pierS) {
    // A pier on a corner has to be bigger than one on a straight, and by how
    // much is not a taste call. On a straight the coping oversails to 0.295
    // and the pier's face stands at 0.43, so the pier is 0.135 proud. At a
    // mitred right angle the coping reaches |m| times that, 0.417, and a pier
    // left at 0.43 would be 0.013 proud -- which is not a pier, it is the
    // coping's point poking out through a block, and the first render of the
    // corner showed exactly that. cornerScale puts the pier's face at 0.559
    // and the proudness back to 0.142, so a corner pier stands off its wall by
    // the same amount a straight one does. Interpolated between |m| = 1 on a
    // straight and sqrt(2) at a square corner, so a level whose walls are not
    // at right angles gets the right answer too.
    const mlen = Math.hypot(p.m.x, p.m.z);
    const corner = 1 + (mlen - 1) * (WALL.pier.cornerScale - 1) / (Math.SQRT2 - 1);
    // And then no two piers are quite the same size or quite the same height.
    // Twenty-four identical blocks at 5.0 centres was the loudest repeat left
    // on the prop once the coursing varied, because a pier is a silhouette and
    // the eye counts silhouettes. Held inside 6% of width and 20% of the cap's
    // rise, so the rhythm still reads as a rhythm.
    const jitter = 0.94 + rand() * 0.12;
    const rise = WALL.pier.rise * (0.82 + rand() * 0.40);
    // A pier standing ON a style change is its own build. By default it is the
    // OLDER of the two, because the new work was laid up to a buttress that was
    // already standing; jointVariant overrides it, which is how the joint
    // becomes a feature in its own right rather than the end of one wall.
    const joint = changes.find((c) => c.joint === 'pier' && Math.abs(c.at - p.s) < 1e-4);
    const name = joint
      ? (joint.jointVariant || surfaceAt(Math.max(0, joint.at - 1e-3)))
      : surfaceAt(p.s + 1e-6);
    parts.push(pier(p, WALL.pier.width * corner * jitter, height, rise, rand, bayAt(p.s), idxOf(name)));
  }

  // The project's own merge, not three's: it is what the rendering pass uses
  // everywhere else, it carries aStone across verbatim, and it keeps
  // examples/jsm out of the bundle.
  const geometry = mergeGeometries(parts.map((g) => ({ geometry: g })));
  for (const g of parts) g.dispose();
  paint(geometry, null, new THREE.Color(v.iron || VARIANTS.iron.iron));

  const material = wallMaterial(used);
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
    styles: used.slice(),
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
  styles = null,
  height = WALL.height,
  gate = null,
  dark = true,
} = {}) {
  const hx = size / 2;
  const hz = (sizeZ ?? size) / 2;
  const corners = [
    { x: -hx, z: -hz }, { x: hx, z: -hz }, { x: hx, z: hz }, { x: -hx, z: hz },
  ];
  const wall = createWall({ seed, points: corners, closed: true, variant, styles, height, gate });
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
