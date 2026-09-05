// What a fence is FOR, in an endless graveyard.
//
// The first build fenced every plot on a 6.0 lattice, which is a Pac-Man maze
// and reads as a grid of pens. The owner asked for far fewer, so the question
// is not "how many" but "what is a fence doing here", and this file is the
// answer. A fence does exactly two jobs, and anything that is not one of those
// jobs does not get a fence:
//
//   PLOT      it encloses a family plot. A rectangle of three to five 2.0
//             panels a side, one gate, a handful of stones inside. This is what
//             a fence is in a real graveyard: a claim on a piece of ground, not
//             a wall between two corridors.
//   BOUNDARY  it marks an old boundary line, and it always crosses a path at
//             right angles with its gate exactly on the crossing. This is the
//             tactical one and it is the reason the fence rules exist at all:
//             the ghost hops the line anywhere, the skeleton has to come to the
//             gate, so a player who knows where the line runs can spend it.
//
// The third thing a fence could do, edging a path along its whole length, is
// deliberately NOT done. A long run parallel to a path is a corridor wall, and
// corridor walls are precisely what the redirection threw out: two of them make
// the pen the owner is complaining about. A plot side that happens to sit near
// a path edges it for free, and that is enough of that idea.
//
// FOUR PROPERTIES, ALL BY CONSTRUCTION RATHER THAN BY INSPECTION.
//
//  1. EVERY RUN HAS A GATE. A run is built as a chain of whole panels with one
//     of them marked as the opening, and the opening is subtracted from the
//     published segments. Nothing can produce a run without one because there
//     is no code path that does.
//
//  2. NO GATELESS CLOSED LOOP, EVER, which is stronger than 1 and is the one
//     that would break the game: a sealed pen the ghost can vault into is a
//     place no skeleton can reach and the player is safe in it for ever. The
//     only cycle any run makes is a plot perimeter, and a plot perimeter always
//     spends exactly one panel on its gate. Two runs can never close a loop
//     between them because no two runs ever come within two units of each
//     other, which is property 3.
//
//  3. EVERY RUN FITS INSIDE ITS OWN CHUNK, INSET BY ONE UNIT. That is what
//     makes fences chunkable at all: two runs from two different chunks are at
//     least two units apart and can never touch, so a chunk builds its fences
//     knowing only itself, and the connectivity argument above is local.
//
//  4. A GATE IS A GAP AND NEVER AN END. The gate panel is never the first or
//     last panel of a run, so both flanks exist and the navigation half's
//     "an endpoint no other segment shares is the end of a fence you can walk
//     round" stays true and means what it says.
//
// HOW MUCH FENCE. A plot in about half of all chunks and a boundary run in
// about three in ten, which world-check.mjs measures over hundreds of chunks as
// 14.5 units of fence per chunk of 576 square units: ONE UNIT OF FENCE PER 40
// SQUARE UNITS OF GROUND. The old maze fenced every plot on a 6.0 lattice and
// came to one unit per 6.1, so this is SIX AND A HALF TIMES LESS FENCE, and the
// checker prints both figures side by side so the claim is measured rather than
// asserted. In what a player sees, a screen of ground holds about one enclosure
// and the walk from one firefly to the next crosses a fence just under half the
// time, which is the jump-or-walk-round decision posed on nearly every journey.

import { GATE } from '../layout/gate.js';
import { F } from '../../ghost/props/fence/metrics.js';
import { rngAt, chunkBox, CHUNK, START_CLEAR, PATH_HALF } from './field.js';

// The panel is 2.0 and the fence is 0.86 tall, both taken off the fence itself
// rather than written down again here.
export const PANEL = F.panel.length;
export const BARRIER_HEIGHT = F.post.height;
// Half the thickness of a barrier in plan. The post is the widest part of a
// fence at 0.155 across, so this is 0.0775 and not the 0.10 the rules half
// assumed. 0.10 is a safe over estimate and nothing breaks if they keep it.
export const FENCE_HALF = F.post.width / 2;
// How much daylight a prop wants between itself and a fence line.
export const FENCE_MARGIN = 0.15;
// How far a plot side keeps off a path, so an enclosure never sits on one. A
// fence AT this distance is right against the edge of the walking surface,
// which is a plot edging a path and is a good thing; what is forbidden is a
// fence standing IN one.
export const PATH_KEEP = PATH_HALF + 0.45;
// The clear opening of a gate, as a half width. A disc of radius 0.60 has to
// get through and the skeleton is 0.95 across the shoulders, so a whole 2.0
// panel is the opening and this is half of it.
export const GATE_HALF = PANEL / 2;
// Nothing solid may stand within this of the middle of an opening.
export const GATE_CLEAR = 1.15;

const INSET = 1.0;

// The grid yaw of a box whose own long axis runs along the grid direction
// (du, dv). geom.js reads a yaw as "local X is (cos, -sin)", so this is the
// angle that puts local X along the run and halfU along its length.
export const gridYawAlong = (du, dv) => Math.atan2(-dv, du);

// The world yaw of the same thing. The two frames are a REFLECTION apart, not a
// rotation, so this cannot be derived from the grid yaw by adding a constant
// and is computed from the direction itself.
export function worldYawAlong(frame, du, dv) {
  const w = frame.toWorld(du, dv);
  return Math.atan2(-w.z, w.x);
}

// --- building a run ---------------------------------------------------------

function panelChain(u0, v0, du, dv, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      au: u0 + du * PANEL * i, av: v0 + dv * PANEL * i,
      bu: u0 + du * PANEL * (i + 1), bv: v0 + dv * PANEL * (i + 1),
      du, dv,
    });
  }
  return out;
}

function runBoxWorld(frame, panels) {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of panels) {
    for (const [u, v] of [[p.au, p.av], [p.bu, p.bv]]) {
      const w = frame.toWorld(u, v);
      minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x);
      minZ = Math.min(minZ, w.z); maxZ = Math.max(maxZ, w.z);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

// Consecutive panels become ONE segment, and a segment breaks only where the
// fence really breaks: at a gate, or at a corner. The navigation half reads an
// unshared endpoint as the end of a fence it can walk round, so chopping a
// straight side into four two unit pieces would invent three fence ends that do
// not exist.
function segmentsOf(frame, panels, runId) {
  const out = [];
  let start = null;
  let prev = null;
  const flush = () => {
    if (!start) return;
    const a = frame.toWorld(start.au, start.av);
    const b = frame.toWorld(prev.bu, prev.bv);
    const midU = (start.au + prev.bu) / 2;
    const midV = (start.av + prev.bv) / 2;
    const len = Math.hypot(prev.bu - start.au, prev.bv - start.av);
    const du = (prev.bu - start.au) / len;
    const dv = (prev.bv - start.av) / len;
    out.push({
      id: `${runId}/s${out.length}`, run: runId,
      x0: a.x, z0: a.z, x1: b.x, z1: b.z,
      half: FENCE_HALF,
      length: len, panels: Math.round(len / PANEL),
      height: BARRIER_HEIGHT,
      yaw: worldYawAlong(frame, du, dv),
      box: {
        minX: Math.min(a.x, b.x) - FENCE_HALF, maxX: Math.max(a.x, b.x) + FENCE_HALF,
        minZ: Math.min(a.z, b.z) - FENCE_HALF, maxZ: Math.max(a.z, b.z) + FENCE_HALF,
      },
      // The same segment in grid coordinates, for the placement tests inside
      // this package. Never part of the published contract.
      grid: {
        au: start.au, av: start.av, bu: prev.bu, bv: prev.bv,
        shape: {
          shape: 'box', x: midU, z: midV,
          yaw: gridYawAlong(du, dv), halfU: len / 2, halfV: FENCE_HALF,
        },
      },
    });
    start = null;
  };
  for (const p of panels) {
    if (p.gate) { flush(); continue; }
    if (start && (Math.abs(p.du - prev.du) > 1e-9 || Math.abs(p.dv - prev.dv) > 1e-9)) flush();
    if (!start) start = p;
    prev = p;
  }
  flush();
  return out;
}

function gateOf(frame, panel, runId, index) {
  const { au, av, bu, bv, du, dv } = panel;
  const a = frame.toWorld(au, av);
  const b = frame.toWorld(bu, bv);
  const mid = frame.toWorld((au + bu) / 2, (av + bv) / 2);
  const along = frame.toWorld(du, dv);
  // The hinge sits at one end of the opening and the leaf sweeps the FULL disc
  // about it, because the gate is double acting. Both numbers come off
  // fence/gate.js, and the prop origin sits hingeX back along the fence line
  // from the pivot, which is how layout.js placed its one gate.
  const propU = au - GATE.hingeX * du;
  const propV = av - GATE.hingeX * dv;
  const prop = frame.toWorld(propU, propV);
  const hinge = a;
  return {
    id: `${runId}/g${index}`, run: runId, barrier: runId,
    // The middle of the OPENING, which is what a path finder aims at.
    x: mid.x, z: mid.z,
    dx: along.x, dz: along.z,
    half: GATE_HALF,
    x0: a.x, z0: a.z, x1: b.x, z1: b.z,
    hinge: { x: hinge.x, z: hinge.z },
    // Placement rule 3: the leaf's reach, a full disc about the pivot.
    sweep: { x: hinge.x, z: hinge.z, r: GATE.sweepRadius },
    // And the rules half's own keep-out, so a skeleton is never wedged in the
    // opening by a headstone somebody put in the doorway.
    clear: { x: mid.x, z: mid.z, r: GATE_CLEAR },
    // Where to build the gate mesh, which is not where the opening is.
    prop: { x: prop.x, z: prop.z, yaw: frame.yawFor(-dv, du) + Math.PI },
    box: {
      minX: hinge.x - GATE.sweepRadius, maxX: hinge.x + GATE.sweepRadius,
      minZ: hinge.z - GATE.sweepRadius, maxZ: hinge.z + GATE.sweepRadius,
    },
    grid: {
      u: (au + bu) / 2, v: (av + bv) / 2,
      sweep: { shape: 'disc', x: au, z: av, r: GATE.sweepRadius },
      clear: { shape: 'disc', x: (au + bu) / 2, z: (av + bv) / 2, r: GATE_CLEAR },
    },
  };
}

function finishRun({ frame, id, kind, panels, interior = null }) {
  const gates = [];
  for (const p of panels) if (p.gate) gates.push(gateOf(frame, p, id, gates.length));
  const segments = segmentsOf(frame, panels, id);
  return {
    id, kind, segments, gates, interior,
    box: runBoxWorld(frame, panels),
    length: segments.reduce((s, x) => s + x.length, 0),
    panels: panels.length,
  };
}

// --- where a run may stand ---------------------------------------------------

// The centre window inside which a grid aligned run of these half extents still
// fits wholly inside its own chunk, inset. Null when it cannot fit at all.
function centreWindow(cx, cz, halfU, halfV) {
  // A grid aligned box of half extents (halfU, halfV) has world half extents of
  // (halfU + halfV) / sqrt(2) on both axes, because the two frames are 45
  // degrees apart. One line, and it is why a plot bigger than five panels a
  // side does not fit in a chunk.
  const half = (halfU + halfV) * Math.SQRT1_2;
  const box = chunkBox(cx, cz);
  const lo = { x: box.minX + INSET + half, z: box.minZ + INSET + half };
  const hi = { x: box.maxX - INSET - half, z: box.maxZ - INSET - half };
  if (lo.x > hi.x || lo.z > hi.z) return null;
  return { lo, hi };
}

const clamp = (t, lo, hi) => (t < lo ? lo : t > hi ? hi : t);

// The gap two runs in the same chunk must leave between them. Anything above
// 1.2 is passable by the 0.60 disc the rules half moves, and 2.4 leaves the
// ground between two fences walkable rather than merely legal.
export const RUN_GAP = 2.4;

function segGap(ax, az, bx, bz, cx2, cz2, dx2, dz2) {
  const pointSeg = (px, pz, x0, z0, x1, z1) => {
    const ex = x1 - x0;
    const ez = z1 - z0;
    const l2 = ex * ex + ez * ez;
    const t = l2 ? Math.max(0, Math.min(1, ((px - x0) * ex + (pz - z0) * ez) / l2)) : 0;
    return Math.hypot(px - (x0 + ex * t), pz - (z0 + ez * t));
  };
  return Math.min(
    pointSeg(ax, az, cx2, cz2, dx2, dz2), pointSeg(bx, bz, cx2, cz2, dx2, dz2),
    pointSeg(cx2, cz2, ax, az, bx, bz), pointSeg(dx2, dz2, ax, az, bx, bz),
  );
}

// Are any of these panels within `minGap` of any segment of an existing run?
function tooClose(frame, panels, run, minGap) {
  for (const p of panels) {
    const a = frame.toWorld(p.au, p.av);
    const b = frame.toWorld(p.bu, p.bv);
    for (const s of run.segments) {
      if (segGap(a.x, a.z, b.x, b.z, s.x0, s.z0, s.x1, s.z1) < minGap) return true;
    }
    for (const g of run.gates) {
      if (segGap(a.x, a.z, b.x, b.z, g.x0, g.z0, g.x1, g.z1) < minGap) return true;
    }
  }
  return false;
}

// --- the family plot ---------------------------------------------------------

// The sides of a plot centred here, counterclockwise in grid.
function plotSides(c, nu, nv) {
  const halfU = (nu * PANEL) / 2;
  const halfV = (nv * PANEL) / 2;
  const u0 = c.u - halfU;
  const v0 = c.v - halfV;
  return [
    { name: 'south', panels: panelChain(u0, v0, 1, 0, nu), out: { du: 0, dv: -1 } },
    { name: 'east', panels: panelChain(u0 + nu * PANEL, v0, 0, 1, nv), out: { du: 1, dv: 0 } },
    { name: 'north', panels: panelChain(u0 + nu * PANEL, v0 + nv * PANEL, -1, 0, nu), out: { du: 0, dv: 1 } },
    { name: 'west', panels: panelChain(u0, v0 + nv * PANEL, 0, -1, nv), out: { du: -1, dv: 0 } },
  ];
}

// No enclosure ever sits on a path. Sampling the perimeter is enough: a curve
// that reaches the inside has to cross a side to get there.
function clearOfPaths(field, sides) {
  for (const side of sides) {
    for (const p of side.panels) {
      for (const t of [0, 0.5, 1]) {
        const u = p.au + (p.bu - p.au) * t;
        const v = p.av + (p.bv - p.av) * t;
        if (field.nearestPath(u, v, PATH_KEEP + 1).dist < PATH_KEEP) return false;
      }
    }
  }
  return true;
}

// A family plot has to find its gap.
//
// The first version of this drew a centre uniformly out of the chunk and gave
// up if a path went through it, and it produced a plot in three chunks in a
// hundred rather than one in two, because an eight unit square has very little
// room between paths eighteen apart that wander five either way. The gaps are
// there; you have to look for them. So the plot LOOKS: it samples the centres
// that would fit inside the chunk, sorts them by how far they are from the
// nearest path, and tries the roomiest first, shrinking a panel at a time until
// something fits. A plot is therefore always in the middle of whatever open
// ground its chunk has, which is also where a family would have bought it.
function familyPlot({ field, cx, cz, rng }) {
  const frame = field.frame;
  const wantU = rng.int(3, 6);
  const wantV = rng.int(3, Math.min(6, wantU + 2));

  const sizes = [];
  for (let shrink = 0; shrink < 3; shrink++) {
    const nu = wantU - shrink;
    const nv = wantV - shrink;
    if (nu >= 2 && nv >= 2) sizes.push([nu, nv]);
  }

  for (const [nu, nv] of sizes) {
    const halfU = (nu * PANEL) / 2;
    const halfV = (nv * PANEL) / 2;
    const win = centreWindow(cx, cz, halfU, halfV);
    if (!win) continue;
    const half = (halfU + halfV) * Math.SQRT1_2;
    const corner = Math.hypot(halfU, halfV);

    const spots = [];
    const step = 2.0;
    for (let z = win.lo.z; z <= win.hi.z + 1e-9; z += step) {
      for (let x = win.lo.x; x <= win.hi.x + 1e-9; x += step) {
        if (Math.hypot(x, z) < START_CLEAR + half + 1) continue;
        const g = frame.toGrid(x, z);
        const d = field.nearestPath(g.u, g.v, corner + PATH_KEEP + 2).dist;
        spots.push({ x, z, g, d });
      }
    }
    if (!spots.length) continue;
    spots.sort((a, b) => b.d - a.d);
    // Among the roomiest handful, one at random, so plots are not all pinned to
    // the exact furthest point from a path.
    const roomy = spots.filter((s) => s.d >= corner + PATH_KEEP);
    const tries = roomy.length ? rng.shuffle(roomy).slice(0, 6) : spots.slice(0, 8);
    for (const spot of tries) {
      const jx = clamp(spot.x + rng.jitter(0.8), win.lo.x, win.hi.x);
      const jz = clamp(spot.z + rng.jitter(0.8), win.lo.z, win.hi.z);
      if (Math.hypot(jx, jz) < START_CLEAR + half + 1) continue;
      const c = frame.toGrid(jx, jz);
      const sides = plotSides(c, nu, nv);
      if (!clearOfPaths(field, sides)) continue;
      return finishPlot({ field, cx, cz, c, cxw: jx, czw: jz, nu, nv, halfU, halfV, sides });
    }
  }
  return null;
}

function finishPlot({ field, cx, cz, c, cxw, czw, nu, nv, halfU, halfV, sides }) {
  const frame = field.frame;
  // The gate goes on the side facing the nearest path, because that is the way
  // a mourner would have walked in. Middle panel of that side, so it is never
  // the first or last panel of the run once the sides are flattened.
  const near = field.nearestPath(c.u, c.v, 16);
  let best = sides[0];
  let bestDot = -Infinity;
  const toPath = { du: near.u - c.u, dv: near.v - c.v };
  const len = Math.hypot(toPath.du, toPath.dv) || 1;
  for (const side of sides) {
    const dot = (side.out.du * toPath.du + side.out.dv * toPath.dv) / len;
    if (dot > bestDot) { bestDot = dot; best = side; }
  }
  best.panels[Math.floor(best.panels.length / 2)].gate = true;

  const panels = sides.flatMap((s) => s.panels);
  return finishRun({
    frame, id: `c${cx},${cz}/plot`, kind: 'plot', panels,
    interior: {
      u: c.u, v: c.v, x: cxw, z: czw,
      halfU: halfU - 0.45, halfV: halfV - 0.45,
      gateSide: best.name,
    },
  });
}

// --- the boundary run --------------------------------------------------------
//
// A straight line of panels standing square across a path, gate on the
// crossing. It is the only fence in the world a player meets head on, and it is
// there to be jumped.

function boundaryRun({ field, cx, cz, rng, avoid }) {
  const frame = field.frame;
  const box = chunkBox(cx, cz);
  const c = frame.toGrid(box.minX + CHUNK / 2, box.minZ + CHUNK / 2);
  const near = field.nearestPath(c.u, c.v, 12);
  if (!Number.isFinite(near.dist) || near.dist > 12) return null;

  // Square to the path: the run's direction is the path's normal at the anchor.
  let du;
  let dv;
  if (near.family === 'u') {
    const s = field.pathSlope('u', near.k, near.v);   // du per dv along the curve
    const n = Math.hypot(1, s);
    du = 1 / n; dv = -s / n;
  } else {
    const s = field.pathSlope('v', near.k, near.u);   // dv per du along the curve
    const n = Math.hypot(s, 1);
    du = -s / n; dv = 1 / n;
  }

  const want = rng.int(3, 7);          // panels, gate included
  let gi = Math.floor(want / 2);
  const startU = near.u - du * PANEL * (gi + 0.5);
  const startV = near.v - dv * PANEL * (gi + 0.5);
  let panels = panelChain(startU, startV, du, dv, want);

  // Trim whichever end sticks furthest out of the chunk until the run fits,
  // never trimming the gate panel and never letting it become an end.
  const inside = (list) => {
    const w = runBoxWorld(frame, list);
    return w.minX >= box.minX + INSET && w.maxX <= box.maxX - INSET
      && w.minZ >= box.minZ + INSET && w.maxZ <= box.maxZ - INSET;
  };
  const outBy = (p) => {
    const w = frame.toWorld(p.u, p.v);
    return Math.max(box.minX + INSET - w.x, w.x - (box.maxX - INSET),
      box.minZ + INSET - w.z, w.z - (box.maxZ - INSET), 0);
  };
  while (panels.length > 3 && !inside(panels)) {
    const head = outBy({ u: panels[0].au, v: panels[0].av });
    const tail = outBy({ u: panels[panels.length - 1].bu, v: panels[panels.length - 1].bv });
    if (head >= tail && gi > 1) { panels = panels.slice(1); gi--; }
    else if (gi < panels.length - 2) panels = panels.slice(0, -1);
    else break;
  }
  // Property 4: the gate is a gap, never an end.
  if (panels.length < 3 || gi <= 0 || gi >= panels.length - 1) return null;
  if (!inside(panels)) return null;

  const worldBox = runBoxWorld(frame, panels);
  const cwx = (worldBox.minX + worldBox.maxX) / 2;
  const cwz = (worldBox.minZ + worldBox.maxZ) / 2;
  if (Math.hypot(cwx, cwz) < START_CLEAR + 8) return null;
  // Never near the plot in the same chunk. Measured segment to segment rather
  // than box to box: a plot's world bounding box is its diamond's, which is
  // half as big again as the plot, and testing against that threw away most of
  // the boundary runs for touching a plot they were nowhere near. Different
  // chunks cannot clash at all, because both runs are inset a unit from their
  // own chunk and are therefore two apart.
  if (avoid && tooClose(frame, panels, avoid, RUN_GAP)) return null;
  // It may only cross the path it was built for. Two crossings would need two
  // gates and the thing would read as a wall rather than as a boundary.
  let onPath = 0;
  for (const p of panels) {
    for (const t of [0.25, 0.75]) {
      const u = p.au + (p.bu - p.au) * t;
      const v = p.av + (p.bv - p.av) * t;
      if (field.nearestPath(u, v, PATH_HALF + 1).dist < PATH_HALF) onPath++;
    }
  }
  if (onPath > 3) return null;

  panels[gi].gate = true;
  return finishRun({ frame, id: `c${cx},${cz}/line`, kind: 'boundary', panels });
}

// --- the chunk's fences ------------------------------------------------------

export const PLOT_CHANCE = 0.5;
export const BOUNDARY_CHANCE = 0.55;

export function chunkFences({ field, cx, cz }) {
  const runs = [];
  const rng = rngAt(field.seed, 'fence', cx, cz);
  const wantPlot = rng.chance(PLOT_CHANCE);
  const wantLine = rng.chance(BOUNDARY_CHANCE);
  const plot = wantPlot ? familyPlot({ field, cx, cz, rng: rng.fork('plot') }) : null;
  if (plot) runs.push(plot);
  const line = wantLine ? boundaryRun({ field, cx, cz, rng: rng.fork('line'), avoid: plot }) : null;
  if (line) runs.push(line);
  return runs;
}

export default chunkFences;
