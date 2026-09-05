// A chunk, in the three layers that make an endless world reproducible.
//
// The problem this file exists to solve: a prop near a seam can argue with a
// prop in the chunk next door, and whichever chunk is built FIRST would
// otherwise win. That would make the world depend on which way the player
// walked into it, which is not a world, it is a rumour. So building a chunk is
// split into layers, and each layer is a pure function of strictly less than
// the one above it.
//
//   HARD   (this chunk alone)          the fences, their gates, and the grave.
//                                      These are guaranteed things. Nothing may
//                                      push them aside and nothing needs to:
//                                      every run is inset a unit inside its own
//                                      chunk so two runs are always two apart,
//                                      and a grave is within 3.5 of a chunk
//                                      centre so two graves are always
//                                      seventeen apart. Hard content from two
//                                      chunks can never argue.
//
//   RAW    (this chunk alone)          the soft props, resolved against this
//                                      chunk's own hard content and against
//                                      each other in generation order, which is
//                                      what keeps a row looking like a row.
//
//   BUILT  (this chunk and its eight)  raw, minus any soft prop that argues
//                                      with hard content next door, or with a
//                                      raw soft prop of a HIGHER PRIORITY
//                                      neighbour. Priority is a hash of the
//                                      chunk coordinate, so it is the same
//                                      total order from either side of a seam
//                                      and both chunks reach the same verdict
//                                      about the same pair.
//
// Nothing here ever looks further than one chunk away, and nothing here depends
// on what was built before it. chunkAt(cx, cz) is the same object on the ten
// thousandth visit as on the first, and the same object whether the player
// arrived from the north or from the south.

import { footprintOf } from '../layout/footprints.js';
import { gap } from '../layout/geom.js';
import { OCCLUSION, K } from '../layout/frame.js';
import { PROP_MARGIN, OCCLUSION_MARGIN, halfAcross } from '../layout/place.js';
import { hash32, chunkBox, CHUNK, rngAt } from './field.js';
import { chunkFences, FENCE_MARGIN } from './fence.js';
import { createPlacer, OCCLUSION_REACH, OVERLAP_REACH } from './placer.js';
import { placeGrave, furnishPlot, pathLanterns, openSites } from './sites.js';

// How far a prop's centre may sit outside the chunk that owns it. A grave's
// headstone reaches about 1.7 from the mouth of its hole and a row can lean a
// little over a seam, so every spatial query pads by this before it decides
// which chunks to look in.
export const PROP_OVERHANG = 3.0;

// The two tests that decide whether two props may both exist. Written once,
// here, and used by the raw pass and by the seam pass, because a seam that is
// judged by a different rule from the middle of a chunk is a seam you can see.
export function overlapping(a, b) {
  if (Math.hypot(a.u - b.u, a.v - b.v) > a.radius + b.radius + PROP_MARGIN) return false;
  return gap(a.shape, b.shape) < PROP_MARGIN;
}

export function hidesProp(front, back) {
  if (back.height <= 0.05) return false;
  if (front.depth <= back.depth) return false;
  if (Math.abs(front.across - back.across) >= front.halfAcross + back.halfAcross) return false;
  return front.height >= back.height + (front.depth - back.depth) * OCCLUSION - OCCLUSION_MARGIN;
}

export const argues = (a, b) => overlapping(a, b) || hidesProp(a, b) || hidesProp(b, a);

// Chunks in a strict total order that has nothing to do with build order.
export function chunkPriority(seed, cx, cz) {
  return hash32(seed, 0x9e37, cx, cz);
}
function outranks(seed, a, b) {
  const pa = chunkPriority(seed, a.cx, a.cz);
  const pb = chunkPriority(seed, b.cx, b.cz);
  if (pa !== pb) return pa > pb;
  if (a.cx !== b.cx) return a.cx > b.cx;
  return a.cz > b.cz;
}

export function createChunkStore(field) {
  const seed = field.seed;
  const hardCache = new Map();
  const rawCache = new Map();
  const builtCache = new Map();
  const key = (cx, cz) => cx + ',' + cz;

  // --- layer one -------------------------------------------------------------
  function hardOf(cx, cz) {
    const k = key(cx, cz);
    let got = hardCache.get(k);
    if (got) return got;
    const runs = chunkFences({ field, cx, cz });
    const barriers = runs.flatMap((r) => r.segments);
    const gates = runs.flatMap((r) => r.gates);
    // The grave is placed by a placer that can see the fences of this chunk and
    // nothing else, which is all it can possibly need: a grave sits within 3.5
    // of the chunk centre and a neighbour's fence is at least 7.5 away.
    const placer = createPlacer({ field, chunk: { cx, cz }, barriers, gates });
    const grave = placeGrave({ field, placer, cx, cz, rng: rngAt(seed, 'grave', cx, cz) });
    got = {
      cx, cz, runs, barriers, gates, grave,
      props: placer.props.slice(),
      box: chunkBox(cx, cz),
    };
    hardCache.set(k, got);
    return got;
  }

  // --- layer two -------------------------------------------------------------
  function rawOf(cx, cz) {
    const k = key(cx, cz);
    let got = rawCache.get(k);
    if (got) return got;
    const hard = hardOf(cx, cz);
    const placer = createPlacer({
      field, chunk: { cx, cz },
      hard: hard.props,
      barriers: hard.barriers,
      gates: hard.gates,
    });
    // Order matters and this is the order: what is guaranteed, then what is
    // enclosed, then what lines a path, then whatever the open ground will take.
    for (const run of hard.runs) {
      if (run.interior) furnishPlot({ field, placer, run, rng: rngAt(seed, 'plotfill', cx, cz) });
    }
    pathLanterns({ field, placer, cx, cz });
    openSites({ field, placer, cx, cz });
    got = {
      cx, cz, hard,
      soft: placer.props.filter((p) => !p.hard),
      rejects: placer.rejects,
    };
    rawCache.set(k, got);
    return got;
  }

  // --- layer three -----------------------------------------------------------
  function buildAt(cx, cz) {
    const k = key(cx, cz);
    let got = builtCache.get(k);
    if (got) return got;
    const raw = rawOf(cx, cz);
    const hard = raw.hard;

    // Everything from next door that this chunk has to give way to.
    const foreignHard = [];
    const foreignSoft = [];
    const foreignBarriers = [];
    const foreignGates = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = { cx: cx + dx, cz: cz + dz };
        const nh = hardOf(n.cx, n.cz);
        for (const p of nh.props) foreignHard.push(p);
        for (const s of nh.barriers) foreignBarriers.push(s);
        for (const g of nh.gates) foreignGates.push(g);
        if (outranks(seed, n, { cx, cz })) {
          for (const p of rawOf(n.cx, n.cz).soft) foreignSoft.push(p);
        }
      }
    }

    const seamLost = { hard: 0, soft: 0, fence: 0, gate: 0 };
    const keep = [];
    for (const p of raw.soft) {
      let dropped = null;
      for (const s of foreignBarriers) {
        const b = s.grid.shape;
        if (Math.hypot(p.u - b.x, p.v - b.z) > p.radius + b.halfU + b.halfV + FENCE_MARGIN) continue;
        if (gap(p.shape, b) < FENCE_MARGIN) { dropped = 'fence'; break; }
      }
      if (!dropped) {
        for (const g of foreignGates) {
          for (const disc of [g.grid.sweep, g.grid.clear]) {
            if (Math.hypot(p.u - disc.x, p.v - disc.z) > p.radius + disc.r) continue;
            if (gap(p.shape, disc) < 0) { dropped = 'gate'; break; }
          }
          if (dropped) break;
        }
      }
      if (!dropped) {
        for (const q of foreignHard) {
          if (far(p, q)) continue;
          if (argues(p, q)) { dropped = 'hard'; break; }
        }
      }
      if (!dropped) {
        for (const q of foreignSoft) {
          if (far(p, q)) continue;
          if (argues(p, q)) { dropped = 'soft'; break; }
        }
      }
      if (dropped) seamLost[dropped]++;
      else keep.push(p);
    }

    const props = [...hard.props, ...keep].map((p, i) => ({
      id: `c${cx},${cz}#${i}`,
      kind: p.kind, variant: p.variant,
      x: p.x, z: p.z, yaw: p.yaw,
      radius: p.radius, height: p.height, solid: p.solid,
      // The renderer and the checker want the real footprint, not its circle.
      foot: p.foot, gridYaw: p.gridYaw, u: p.u, v: p.v,
      depth: p.depth, across: p.across, halfAcross: p.halfAcross,
      shape: p.shape,
    }));

    got = {
      cx, cz,
      box: hard.box,
      props,
      runs: hard.runs,
      barriers: hard.barriers,
      gates: hard.gates,
      graves: hard.grave
        ? [{ id: `c${cx},${cz}/grave`, x: hard.grave.x, z: hard.grave.z, yaw: hard.grave.yaw, u: hard.grave.u, v: hard.grave.v }]
        : [],
      stats: { ...raw.rejects, seam: seamLost },
    };
    builtCache.set(k, got);
    return got;
  }

  const REACH = Math.max(OVERLAP_REACH, OCCLUSION_REACH) + 2.5;
  function far(a, b) {
    return Math.abs(a.u - b.u) > REACH + a.radius + b.radius
      || Math.abs(a.v - b.v) > REACH + a.radius + b.radius;
  }

  return {
    hardOf,
    rawOf,
    chunkAt: buildAt,
    has: (cx, cz) => builtCache.has(key(cx, cz)),
    forget(cx, cz) {
      const k = key(cx, cz);
      builtCache.delete(k);
      rawCache.delete(k);
      hardCache.delete(k);
    },
    keys: () => [...builtCache.keys()],
    built: () => [...builtCache.values()],
    counts: () => ({ hard: hardCache.size, raw: rawCache.size, built: builtCache.size }),
  };
}

// Small helpers the firefly and pellet layers want, kept here because they need
// the same footprint arithmetic the props do.
export function discClearOfProps(props, x, z, r, field) {
  const g = field.frame.toGrid(x, z);
  const disc = { shape: 'disc', x: g.u, z: g.v, r };
  for (const p of props) {
    if (!p.solid) continue;
    if (Math.hypot(g.u - p.u, g.v - p.v) > r + p.radius) continue;
    if (gap(disc, p.shape) < 0) return false;
  }
  return true;
}

export { footprintOf, halfAcross, K, CHUNK, PROP_MARGIN };
