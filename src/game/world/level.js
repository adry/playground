// One level, built once, in the order a graveyard is built.
//
//   1. the wall        the perimeter, four segments, no gate, darkness beyond
//   2. the fences      pens and, more often than not, one divider
//   3. the graves      four, one per quadrant, which is the floor's whole limit
//   4. the pens        furnished, and then UNPARTITIONED
//   5. the lanterns    beside the paths
//   6. the open ground the sites, thinned by the density field
//
// Steps 1 to 3 decide whether the level is FAIR and nothing after them can
// break that, with one exception, and the exception is the reason step 4 has a
// second half. The rules half found that props inside a pen can cut its
// interior in two: the ghost vaults into the far pocket and no skeleton can
// ever reach it, which is a place the player is safe in for ever. It was 1.8%
// of their worlds and it was the last fairness failure they had. So the pens
// are checked after everything else is placed, with a flood fill from OUTSIDE
// the gate, and any prop that makes a pocket unreachable is taken back out.
//
// This file replaces chunk.js, which existed to build an infinite world a piece
// at a time and had three layers, a priority order over chunk coordinates and a
// seam resolution pass. A level 30 units across needs none of it: everything is
// placed in one pass, in one order, against everything already placed.

import { levelBox, createField, rngAt, SPAWN_CLEAR, WALL_HALF } from './field.js';
import { levelFences, makeWall, PANEL } from './fence.js';
import { createPlacer } from './placer.js';
import { placeGraves, furnishPen, pathLanterns, openSites } from './sites.js';

// The body the rules half moves, and what it needs to get past a barrier.
export const BODY = 0.60;

export function buildLevel({ seed = 1, size = 30 } = {}) {
  const field = createField(seed, { size });
  const box = levelBox(size);
  // The ghost starts in the middle of the arena. Everything else keeps
  // SPAWN_CLEAR off it, so the first thing the player sees is open ground.
  const spawn = { x: 0, z: 0 };

  const wall = makeWall(box);
  const runs = levelFences({ field, box, spawn });
  const barriers = [...wall.segments, ...runs.flatMap((r) => r.segments)];
  const gates = runs.flatMap((r) => r.gates);

  const placer = createPlacer({ field, box, barriers, gates });
  const rng = rngAt(seed, 'level');

  const graves = placeGraves({ field, placer, box, spawn, runs, rng: rng.fork('graves') });

  const penProps = new Map();
  for (const run of runs) {
    if (!run.interior) continue;
    penProps.set(run, furnishPen({ field, placer, run, rng: rng.fork('pen:' + run.id) }));
  }

  pathLanterns({ field, placer, box });
  openSites({ field, placer, box, spawn });

  const cut = unpartitionPens({ field, placer, runs, box });

  const props = placer.props.map((p, i) => ({
    id: `p${i}`,
    kind: p.kind, variant: p.variant,
    x: p.x, z: p.z, yaw: p.yaw,
    radius: p.radius, height: p.height, solid: p.solid,
    foot: p.foot, gridYaw: p.gridYaw, u: p.u, v: p.v,
    depth: p.depth, across: p.across, halfAcross: p.halfAcross, shape: p.shape,
  }));

  return {
    seed, size, box, spawn, field,
    wall, runs, gates,
    barriers,
    props,
    graves,
    stats: { ...placer.rejects, penPropsCut: cut, pens: runs.filter((r) => r.kind === 'pen').length, divider: runs.some((r) => r.kind === 'divider') },
  };
}

// --- keeping a pen in one piece ------------------------------------------------
//
// A pen is fair when a body of radius 0.60 that cannot jump can reach every
// part of the inside from outside the gate. Rasterised at a fifth of a unit,
// which is fine enough that the narrowest legal passage survives it: a 2.0
// opening leaves the centre of the body 0.32 either side of the centreline, and
// a half unit grid can miss that entirely while a fifth cannot.
function unpartitionPens({ field, placer, runs, box }) {
  let cut = 0;
  for (const run of runs) {
    if (!run.interior) continue;
    for (let attempt = 0; attempt < 12; attempt++) {
      const bad = penPockets({ field, props: placer.props, run, box });
      if (!bad) break;
      // The last prop placed inside this interior is the one to take out: it is
      // the one that closed the gap, and dropping the newest keeps the
      // arrangement the composition intended as far as it can.
      const inside = placer.props.filter((p) => insideInterior(run.interior, p));
      if (!inside.length) break;
      placer.drop([inside[inside.length - 1]]);
      cut++;
    }
  }
  return cut;
}

function insideInterior(inner, p) {
  return Math.abs(p.u - inner.u) <= inner.halfU + 0.6 && Math.abs(p.v - inner.v) <= inner.halfV + 0.6;
}

// True when some part of the inside admits the body but cannot be walked to.
function penPockets({ field, props, run, box }) {
  const cell = 0.2;
  const pad = 4;
  const x0 = run.box.minX - pad;
  const z0 = run.box.minZ - pad;
  const nx = Math.ceil((run.box.maxX - run.box.minX + 2 * pad) / cell);
  const nz = Math.ceil((run.box.maxZ - run.box.minZ + 2 * pad) / cell);
  const open = new Uint8Array(nx * nz).fill(1);

  const blockSeg = (s, reach) => {
    const a0 = Math.max(0, Math.floor((Math.min(s.x0, s.x1) - reach - x0) / cell));
    const a1 = Math.min(nx - 1, Math.ceil((Math.max(s.x0, s.x1) + reach - x0) / cell));
    const b0 = Math.max(0, Math.floor((Math.min(s.z0, s.z1) - reach - z0) / cell));
    const b1 = Math.min(nz - 1, Math.ceil((Math.max(s.z0, s.z1) + reach - z0) / cell));
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        if (!open[b * nx + a]) continue;
        if (pointSeg(x0 + (a + 0.5) * cell, z0 + (b + 0.5) * cell, s) < reach) open[b * nx + a] = 0;
      }
    }
  };
  for (const s of run.segments) blockSeg(s, BODY + s.half);
  for (const p of props) {
    if (!p.solid) continue;
    if (p.x < x0 - 2 || p.x > x0 + nx * cell + 2 || p.z < z0 - 2 || p.z > z0 + nz * cell + 2) continue;
    const r = BODY + p.radius;
    const a0 = Math.max(0, Math.floor((p.x - r - x0) / cell));
    const a1 = Math.min(nx - 1, Math.ceil((p.x + r - x0) / cell));
    const b0 = Math.max(0, Math.floor((p.z - r - z0) / cell));
    const b1 = Math.min(nz - 1, Math.ceil((p.z + r - z0) / cell));
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        if (!open[b * nx + a]) continue;
        if (Math.hypot(x0 + (a + 0.5) * cell - p.x, z0 + (b + 0.5) * cell - p.z) < r) open[b * nx + a] = 0;
      }
    }
  }

  // Flood from OUTSIDE the pen, so the only way in is through the gate. That
  // makes the test say what it is meant to say: can something that walks get
  // from the rest of the level to every part of the inside.
  let start = -1;
  for (let a = 0; a < nx && start < 0; a++) if (open[a]) start = a;
  if (start < 0) return false;
  const seen = new Uint8Array(nx * nz);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop();
    const a = i % nx;
    const b = (i - a) / nx;
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const na = a + da;
      const nb = b + db;
      if (na < 0 || nb < 0 || na >= nx || nb >= nz) continue;
      const j = nb * nx + na;
      if (seen[j] || !open[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }

  const inner = run.interior;
  for (let b = 0; b < nz; b++) {
    for (let a = 0; a < nx; a++) {
      const i = b * nx + a;
      if (!open[i] || seen[i]) continue;
      const x = x0 + (a + 0.5) * cell;
      const z = z0 + (b + 0.5) * cell;
      if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
      const g = field.frame.toGrid(x, z);
      if (Math.abs(g.u - inner.u) <= inner.halfU && Math.abs(g.v - inner.v) <= inner.halfV) return true;
    }
  }
  return false;
}

function pointSeg(px, pz, s) {
  const ex = s.x1 - s.x0;
  const ez = s.z1 - s.z0;
  const l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((px - s.x0) * ex + (pz - s.z0) * ez) / l2));
  return Math.hypot(px - (s.x0 + ex * t), pz - (s.z0 + ez * t));
}

export { PANEL, SPAWN_CLEAR, WALL_HALF };
export default buildLevel;
