import * as THREE from 'three';
import { mergeGeometries } from '../merge.js';
import { rng } from './wood.js';

// The high wall that encloses a level, and the darkness outside it.
//
// This is the edge of the world, not another prop. panel.js is the fence: 0.86
// tall, wood, low enough to see over and to hop, and it stands INSIDE a level
// as furniture. This stands AROUND one and its whole job is to say "there is no
// more graveyard past here". Everything below follows from that one difference:
//
//   * It is stone, not timber. The graveyard's own stone, PALETTE.stone, the
//     same grey the headstones are cut from, so it reads as the boundary of the
//     same yard rather than as a set piece imported from elsewhere.
//   * It is built as ONE merged geometry per call. A 30 unit run made of
//     fifteen 2.0 panels would be fifteen draw calls, times four sides; the
//     whole enclosure here is one.
//   * It publishes its dimensions. Navigation needs the thickness to collide
//     against and needs to be told the ghost cannot get over it; the darkness
//     outside needs the height. Those numbers are WALL below and they are the
//     only copy.
//
// THE CALLER HANDS ONE CLOSED LOOP, NOT FOUR RUNS.
//
// That is the decision this file is built around and it is worth stating first,
// because it is the one thing a caller has to get right:
//
//     createWall({ points: [{x:-15,z:-15},{x:15,z:-15},{x:15,z:15},{x:-15,z:15}],
//                  closed: true })
//
// Four separate runs cannot make a corner. Each run would have to stop somewhere
// near the corner and hope, and the two ways of doing that are both wrong: stop
// at the centreline and the outer faces leave a square notch missing; run to the
// outer face and the two runs interpenetrate, so the inner faces cross and every
// fragment where they overlap z-fights. Handing the whole perimeter to one call
// means the corner is MITRED -- the outer faces are extended to where they
// actually meet and the inner faces are cut back to where they actually meet --
// which is the only construction that is right from both sides at once. See
// miter() below; it is four lines and it is the reason the corners work.
//
// An open polyline is allowed too (closed: false) and gets an end cap at each
// end, which is what a gate jamb needs.
//
// What panel.js contributes, and it contributes a lot: the per-seed determinism
// (its rng, so a wall is the same wall every reload), the discipline of putting
// the surface detail in a fragment patch on a standard material rather than in
// vertices or a texture, and above all the post rhythm. A fence hides its panel
// joints inside a shared post; this wall hides its corners and its coursing
// inside a PIER, on the same 5.0 lattice the floor's major grid already draws.
// A blank 30 unit stone run is a wall in a flight simulator. A 30 unit run
// broken into six bays by piers is a churchyard.

// ---------------------------------------------------------------------------
// the published numbers
//
// Two other agents import this. Nothing here is a magic number repeated
// somewhere else; if a piece needs a measurement that is not here it gets added
// here first, the same rule metrics.js states for the fence.

export const WALL = {
  // Crown of the coping, above the floor.
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

  // Across the run, at the body. The plinth and the coping stand proud of this
  // and the piers stand proud of both; see `collide` for the number navigation
  // actually wants.
  thickness: 0.44,

  // Widest the run gets at ground level, at the plinth. A prop laid against the
  // wall wants this, not `thickness`.
  base: 0.55,

  // The piers. Spacing is the floor's own major grid, so a pier lands on a
  // major line and the wall's rhythm and the ground's agree. `cornerScale` is
  // not decoration: see the note where it is used, the mitre makes a corner
  // reach further than a straight and a same-size pier there has the coping's
  // point sticking out through its face.
  pier: { width: 0.86, spacing: 5.0, rise: 0.34, cornerScale: 1.30 },

  // What navigation should inflate the wall's centreline polyline by, in world
  // units, to get the solid the ghost must not enter. The pier is the widest
  // thing on the prop, so these are its half diagonals: the first on a straight
  // run, the second at a mitred right-angle corner, where the pier is bigger.
  // Nothing else on the wall -- plinth at 0.275, coping at 0.295 -- comes near
  // either number.
  collide: 0.53,
  cornerCollide: 0.69,

  // Stated rather than implied. The ghost hops the 0.86 fence; it does not get
  // over this, at any height, ever. A rule that lets it is a bug in the rule.
  vaultable: false,
};

// The masonry. Course height and stone length are the two numbers that decide
// whether the surface reads as a wall or as a grey extrusion, and they are here
// because the shader and the lab both want them.
const STONE = {
  colour: '#b9b6b1',       // PALETTE.stone, the graveyard's own grey
  mortar: '#8e8b85',
  course: 0.235,           // one course of stone, floor to floor
  length: 0.62,            // nominal stone along the run, varied per course
  joint: 0.030,            // mortar width
  jointDepth: 0.85,        // how far the joint darkens towards the mortar tone
  tone: 0.13,              // per-stone lightness spread
  grime: 0.30,             // how much the first third of a metre darkens
};

// Section of the run, one half, in (across, up). Mirrored to make the loop.
//
// Read bottom to top: a plinth that is bedded 20mm into the dirt and stands
// proud of the body, a chamfer off it, the body itself with a slight batter so
// the wall leans into its own weight, then a coping that oversails on both
// sides and is crowned rather than flat. The oversail is the important one: a
// wall whose top is the same width as its body has no cap, and without a cap it
// reads as a slab standing on edge.
function halfSection(H, T) {
  const bed = 0.02;
  const plinthH = 0.16;
  const plinthOut = 0.055;
  const chamfer = 0.055;
  const batter = 0.035;
  const copeH = 0.20;
  const copeOut = 0.075;
  const hb = T / 2;
  return [
    [hb + plinthOut, -bed],
    [hb + plinthOut, plinthH],
    [hb, plinthH + chamfer],
    [hb - batter, H - copeH],
    [hb + copeOut, H - copeH + 0.045],
    [hb + copeOut, H - 0.10],
    [(hb + copeOut) * 0.78, H - 0.055],
    [0, H],
  ];
}

// The closed section loop: up the right side, over the crown, down the left,
// and back along the underside. The apex is shared and the bottom edge closes
// the loop, so a swept run is a sealed tube with no bottom face -- which is
// correct, because the bottom is buried and no camera at 29 degrees of
// elevation can ever see it.
function sectionLoop(H, T) {
  const half = halfSection(H, T);
  const loop = half.map(([u, v]) => [u, v]);
  for (let i = half.length - 2; i >= 0; i--) loop.push([-half[i][0], half[i][1]]);
  return loop;
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
// body and coping together, with no special case for any of them.
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
      // k === 0 is an original corner. It is placed exactly and marked, so the
      // wander below skips it and the pier pass can find it.
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        corner: k === 0,
      });
    }
  }
  if (!closed) out.push({ x: src[n - 1].x, z: src[n - 1].z, corner: true });

  // Distance along, then the per-vertex frame.
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
// `settle` is passed in rather than made here, because the end caps have to
// apply the identical drop: the cap is a flat lid over the last ring and if it
// is built off the unslumped section it stands up to a couple of centimetres
// proud of it, which at a gate jamb is a visible step right where the player
// is looking.
function sweep(path, loop, settle) {
  const rings = path.pts.length;
  const spans = path.closed ? rings : rings - 1;
  const edges = loop.length; // closed loop: as many edges as points
  const vertsPerRing = edges * 2;

  const position = new Float32Array(rings * vertsPerRing * 3);
  const normal = new Float32Array(rings * vertsPerRing * 3);
  const stone = new Float32Array(rings * vertsPerRing * 2);
  const index = [];

  for (let i = 0; i < rings; i++) {
    const p = path.pts[i];
    const base = i * vertsPerRing;
    for (let e = 0; e < edges; e++) {
      const a = loop[e];
      const b = loop[(e + 1) % edges];
      const nrm = edgeNormal(a, b);
      for (let k = 0; k < 2; k++) {
        const pt = k === 0 ? a : b;
        const vi = base + e * 2 + k;
        const u = pt[0] + p.wander;
        position[vi * 3] = p.x + p.m.x * u;
        position[vi * 3 + 1] = pt[1] + settle(p.s, pt[1]);
        position[vi * 3 + 2] = p.z + p.m.z * u;
        normal[vi * 3] = p.n.x * nrm[0];
        normal[vi * 3 + 1] = nrm[1];
        normal[vi * 3 + 2] = p.n.z * nrm[0];
        stone[vi * 2] = p.s;
      }
    }
  }

  for (let i = 0; i < spans; i++) {
    const a = i * vertsPerRing;
    const b = ((i + 1) % rings) * vertsPerRing;
    for (let e = 0; e < edges; e++) {
      const p0 = a + e * 2;
      const p1 = a + e * 2 + 1;
      const q0 = b + e * 2;
      const q1 = b + e * 2 + 1;
      index.push(p0, q0, q1, p0, q1, p1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('aStone', new THREE.BufferAttribute(stone, 2));
  geo.setIndex(index);
  return geo;
}

// Flat cap over the end of an open run, fanned from a point on the wall's own
// axis. The section is star shaped about that point -- every vertex of it is
// visible from the centre line, coping oversail included -- so a fan is a valid
// triangulation and no ear clipping is needed.
function endCap(path, loop, end, settle) {
  const p = path.pts[end === 0 ? 0 : path.pts.length - 1];
  const H = loop.reduce((m, q) => Math.max(m, q[1]), 0);
  const dir = end === 0
    ? { x: path.pts[0].x - path.pts[1].x, z: path.pts[0].z - path.pts[1].z }
    : { x: p.x - path.pts[path.pts.length - 2].x, z: p.z - path.pts[path.pts.length - 2].z };
  // `dir` is already built pointing OUT of the run at whichever end this is,
  // so it needs no sign of its own.
  const dl = Math.hypot(dir.x, dir.z) || 1;
  const nx = dir.x / dl;
  const nz = dir.z / dl;

  const position = [];
  const normal = [];
  const stone = [];
  const push = (u, v) => {
    position.push(p.x + p.m.x * u, v + settle(p.s, v), p.z + p.m.z * u);
    normal.push(nx, 0, nz);
    stone.push(p.s, 0);
  };
  push(0, H * 0.5);
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('aStone', new THREE.Float32BufferAttribute(stone, 2));
  geo.setIndex(index);
  return geo;
}

// A pier: a chamfered square shaft with a capstone, standing a little above the
// coping. This is the fence's post doing the fence's job -- it breaks the run
// into bays, it sits over every corner, and anything awkward about a joint
// happens inside it.
function pier(p, size, H, rise, rand) {
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
  const quad = (q0, q1, q2, q3, s0, s1, dressed = 0) => {
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
      stone.push(sv, dressed);
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
        // pile of gravel balanced on a post. Flagged rather than special-cased
        // in the shader, so the coping could be flagged too if it ever wants
        // to be.
        ri >= 1 ? 1 : 0,
      );
    }
  }

  // The capstone's top face, fanned from its centre.
  const [ty, ts] = rows[rows.length - 1];
  const capBase = position.length / 3;
  position.push(p.x, ty, p.z);
  normal.push(0, 1, 0);
  stone.push(p.s, 1);
  for (let e = 0; e < ring.length; e++) {
    const q = world(ring[e][0] * ts, ring[e][1] * ts, ty);
    position.push(q[0], q[1], q[2]);
    normal.push(0, 1, 0);
    stone.push(p.s + arc[e], 1);
  }
  for (let e = 0; e < ring.length; e++) {
    index.push(capBase, capBase + 1 + ((e + 1) % ring.length), capBase + 1 + e);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('aStone', new THREE.Float32BufferAttribute(stone, 2));
  geo.setIndex(index);
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

// ---------------------------------------------------------------------------
// the surface
//
// Coursed rubble, drawn per fragment from two numbers: distance along the run,
// which arrives in an attribute, and height, which is just the object-space Y.
// The same split panel.js uses for its grain, and for the same reason: a swept
// run has no UVs worth speaking of and a texture would need them, whereas a
// dozen lines of hashing need neither and stay sharp at any distance.
//
// The vertex colour carries only the slow half -- the per-seed tone and the
// grime picked up in the first third of a metre -- exactly as paintBoard does.

const STONE_COLOUR = new THREE.Color(STONE.colour);
const MORTAR_COLOUR = new THREE.Color(STONE.mortar);

export function wallMaterial(options = {}) {
  const uniforms = {
    uMortar: { value: MORTAR_COLOUR.clone() },
    uCourse: { value: STONE.course },
    uStone: { value: STONE.length },
    uJoint: { value: STONE.joint },
    uJointDepth: { value: STONE.jointDepth },
    uTone: { value: STONE.tone },
    uGrime: { value: STONE.grime },
  };
  const material = new THREE.MeshStandardMaterial({
    color: STONE_COLOUR.clone(),
    roughness: 0.94,
    metalness: 0.0,
    ...options,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = `
      attribute vec2 aStone;
      varying vec3 vStone;
      ${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // Object space, like the fence's grain: the wander and the settled coping
      // are in the mesh, and the coursing has to be read before them or the
      // joints shear off the wall wherever it goes out of true.
      vStone = vec3(aStone.x, transformed.y, aStone.y);`,
    );

    shader.fragmentShader = `
      varying vec3 vStone;
      uniform vec3 uMortar;
      uniform float uCourse;
      uniform float uStone;
      uniform float uJoint;
      uniform float uJointDepth;
      uniform float uTone;
      uniform float uGrime;

      float wallHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      ${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        // A course wobbles a little rather than running dead level. Old rubble
        // is laid to a line, not to a laser, and perfectly parallel courses are
        // the single thing that makes a procedural wall read as wallpaper.
        float y = vStone.y + 0.010 * sin(vStone.x * 1.9) + 0.005 * sin(vStone.x * 5.3 + 1.7);
        float rowF = y / uCourse;
        float row = floor(rowF);
        float rowT = fract(rowF);

        // Every course is offset by its own amount and its stones are its own
        // length, so no two courses break in the same place and nothing stacks
        // into a running joint.
        float rh = wallHash(vec2(row, 3.0));
        float len = uStone * (0.72 + 0.62 * wallHash(vec2(row, 11.0)));
        float colF = (vStone.x + 0.028 * sin(y * 21.0 + rh * 6.3)) / len + rh * 7.0;
        float col = floor(colF);
        float colT = fract(colF);

        // Distance to the nearest joint, in world units, so the mortar is the
        // same width on a course of long stones as on a course of short ones.
        float dv = min(rowT, 1.0 - rowT) * uCourse;
        float dh = min(colT, 1.0 - colT) * len;
        float d = min(dv, dh);
        // Antialiased against the fragment's own footprint: at grazing angles
        // and at level-wide framing this is the difference between mortar and
        // moire.
        float w = max(fwidth(d), 1e-5);
        // vStone.z marks a piece that is one dressed stone rather than a run
        // of rubble: the capstones. It keeps the tone and the grime and loses
        // the joints.
        float joint = (1.0 - vStone.z) * (1.0 - smoothstep(uJoint * 0.5 - w, uJoint * 0.5 + w, d));

        // Per stone tone. The whole reason the coursing reads from across a
        // level: the joints themselves are a pixel wide at that distance and
        // vanish, and what is left is a field of slightly different greys,
        // which is exactly what a rubble wall looks like from fifty metres.
        float tone = wallHash(vec2(col, row)) - 0.5;
        diffuseColor.rgb *= 1.0 + tone * uTone;
        // The stone just under a joint catches less light.
        diffuseColor.rgb *= 1.0 - (1.0 - vStone.z) * 0.10 * (1.0 - smoothstep(0.0, uCourse * 0.30, dv));
        diffuseColor.rgb = mix(diffuseColor.rgb, uMortar, joint * uJointDepth);

        // Ground grime, and moss in the wettest of it. Only the first third of
        // a metre, which is where a wall actually stains.
        float wet = 1.0 - smoothstep(0.0, 0.36, vStone.y);
        diffuseColor.rgb *= 1.0 - uGrime * wet * (0.55 + 0.45 * wallHash(vec2(col, row + 31.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 1.0, 0.80),
                               wet * 0.55 * smoothstep(0.45, 0.95, wallHash(vec2(col, row + 57.0))));
      }`,
    );
  };
  // Same trap as the fence: three keys its program cache on the stock shader,
  // so without this every wall on the page recompiles into its own program.
  material.customProgramCacheKey = () => 'graveyard-wall-stone';
  return material;
}

// ---------------------------------------------------------------------------
// the wall

// Build the enclosure.
//
//   points   the wall's CENTRELINE corners, [{x, z}, ...]
//   closed   true for an enclosure, false for a run with two open ends
//   height   crown of the coping; defaults to WALL.height
//   gate     { at, width } or an array of them: openings measured as a
//            distance along the centreline from points[0], with a pier standing
//            at each jamb. `gaps` is the same thing under a plural name.
//
// Returns { group, update, dispose, bounds, length, stats }.
export function createWall({
  seed = 1,
  points,
  closed = true,
  height = WALL.height,
  thickness = WALL.thickness,
  gate = null,
  gaps = null,
  pierSpacing = WALL.pier.spacing,
  piers = true,
  step = 1.9,
  wobble = 0.022,
  wander = 0.012,
} = {}) {
  if (!points || points.length < 2) throw new Error('createWall() wants at least two centreline points');

  const rand = rng(seed);
  const loop = sectionLoop(height, thickness);
  const path = samplePath(points, closed, step, rand, wander);

  // Openings. A gap makes the closed loop an open run, or an open run two runs;
  // either way the work is the same, so both go through one list of intervals.
  const openings = []
    .concat(gate ? (Array.isArray(gate) ? gate : [gate]) : [])
    .concat(gaps || [])
    .map((g) => ({ a: g.at - g.width / 2, b: g.at + g.width / 2 }))
    .sort((p, q) => p.a - q.a);

  const runs = [];
  if (!openings.length) {
    runs.push({ pts: path.pts, closed: path.closed, total: path.total });
  } else {
    // Cut the sampled path at every jamb. The jamb sample is inserted exactly
    // at the opening's edge so the wall stops where the caller said it does and
    // not at the nearest subdivision.
    const cuts = [];
    for (const o of openings) cuts.push(o.a, o.b);
    const inGap = (s) => openings.some((o) => s > o.a + 1e-6 && s < o.b - 1e-6);
    const at = (s) => pointAt(path, s);
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
      const sample = cuts.some((c) => Math.abs(c - s) < 1e-6)
        ? at(s)
        : path.pts.find((p) => Math.abs(p.s - s) < 1e-6) || at(s);
      current.push(sample);
    }
    flush();
    // A closed loop cut in one place is still one run; stitch the tail onto the
    // head so the piece that crosses s = 0 is not two runs meeting at a seam.
    if (path.closed && runs.length > 1 && !inGap(0)) {
      const head = runs.shift();
      const tail = runs.pop();
      runs.push({ pts: [...tail.pts, ...head.pts.map((p) => ({ ...p, s: p.s + path.total }))], closed: false });
    }
  }

  // How far the coping has settled at a given distance along, at a given
  // height up the section. Zero at the footing and quadratic in height, so all
  // of the slump is in the top third and the wall stays bedded in the dirt
  // everywhere. Drawn from the wall's seed once, here, so every piece of the
  // wall -- runs and end caps alike -- reads the same curve.
  const ph1 = rand() * Math.PI * 2;
  const ph2 = rand() * Math.PI * 2;
  const settle = (s, v) => {
    const h = Math.max(0, v) / height;
    return wobble * (Math.sin(s * 0.83 + ph1) * 0.6 + Math.sin(s * 2.17 + ph2) * 0.4) * h * h;
  };

  const parts = [];
  for (const run of runs) {
    parts.push(sweep(run, loop, settle));
    if (!run.closed) {
      parts.push(endCap(run, loop, 0, settle));
      parts.push(endCap(run, loop, 1, settle));
    }
  }

  // Piers: one at every original corner, one at every jamb, and the rest spread
  // evenly along each corner-to-corner span so no bay is a different length
  // from its neighbours. Spacing is a target, not a law.
  if (piers) {
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
    const inGap = (s) => openings.some((o) => s > o.a + 1e-6 && s < o.b - 1e-6);
    const seen = new Set();
    for (const s of [...want].sort((p, q) => p - q)) {
      if (inGap(s)) continue;
      const key = path.closed && Math.abs(s - path.total) < 1e-6 ? 0 : s;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = pointAt(path, Math.min(s, path.total));
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
      parts.push(pier(p, WALL.pier.width * (1 + (mlen - 1) * (WALL.pier.cornerScale - 1) / (Math.SQRT2 - 1)), height, WALL.pier.rise, rand));
    }
  }

  // The project's own merge, not three's: it is what the rendering pass uses
  // everywhere else, it carries aStone across verbatim, and it keeps
  // examples/jsm out of the bundle.
  const geometry = mergeGeometries(parts.map((g) => ({ geometry: g })));
  for (const g of parts) g.dispose();

  // The slow half of the weathering, in a vertex colour, so a wall carries its
  // own character before a single fragment is shaded.
  {
    const pos = geometry.getAttribute('position');
    const n = pos.count;
    const colours = new Float32Array(n * 3);
    const phase = rand() * Math.PI * 2;
    const tint = 0.94 + rand() * 0.10;
    const stone = geometry.getAttribute('aStone');
    for (let i = 0; i < n; i++) {
      const s = stone.getX(i);
      const k = tint
        * (1 + 0.045 * Math.sin(s * 0.31 + phase))
        * (1 + 0.030 * Math.sin(s * 1.13 + phase * 2.1));
      colours[i * 3] = k;
      colours[i * 3 + 1] = k;
      colours[i * 3 + 2] = k * 0.995;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  }

  const material = wallMaterial({ vertexColors: true });
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

  const tris = geometry.index.count / 3;

  return {
    group,
    mesh,
    bounds,
    length: path.total,
    height,
    stats: { triangles: tris, vertices: geometry.getAttribute('position').count, drawCalls: 1 },
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
// The skirt costs one draw call and eight triangles, and it does not write
// depth, so nothing standing outside the wall is clipped by it.
export function createVoid({
  bounds,
  // Where the falloff's zero point sits, measured OUT from the wall's
  // centreline: positive pushes it outward, negative pulls it in.
  //
  // The default puts it at -WALL.base / 2, which is exactly the wall's own
  // INNER face. That is the one value that gets both halves of the brief at
  // once and it is worth spelling out why, because it looks like the wrong
  // sign:
  //
  //   * Nothing inside is tinted, and provably so rather than nearly so. The
  //     ring's hole ends at the plinth's inner face, and the plinth is the
  //     narrowest part of the wall at ground level -- the piers are wider on
  //     both sides -- so every fragment the skirt draws anywhere on the
  //     perimeter is underneath solid wall or outside it. No floor a player
  //     can see inside the enclosure is covered by so much as a pixel.
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
//   const level = createWalledLevel({ size: 30 });
//   scene.add(level.group);
//
// 30 is the maximum: six of the floor's major squares, which is what the level
// generator is capped at.
export function createWalledLevel({ seed = 1, size = 30, sizeZ = null, centre = { x: 0, z: 0 }, rotation = 0, height = WALL.height, gate = null, dark = true } = {}) {
  const hx = size / 2;
  const hz = (sizeZ ?? size) / 2;
  const corners = [
    { x: -hx, z: -hz }, { x: hx, z: -hz }, { x: hx, z: hz }, { x: -hx, z: hz },
  ];
  const wall = createWall({ seed, points: corners, closed: true, height, gate });
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
    bounds: { minX: -hx, maxX: hx, minZ: -hz, maxZ: hz },
    stats: wall.stats,
    update() {},
    dispose() { wall.dispose(); dusk?.dispose(); },
  };
}

export default createWall;
