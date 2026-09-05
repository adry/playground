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
import { repairLevel, discClear, NAV_R } from './repair.js';

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

  // EVERYTHING placed, and now the pass that decides whether the level can be
  // played rather than whether it looks right. See repair.js: a row of
  // headstones is a wall as far as anything that walks is concerned, and the
  // only way to know whether one has closed a passage is to look at the
  // finished level.
  const fix = repairLevel({ box, barriers, gates, graves, spawn, placer });

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
    walk: fix,
    stats: {
      ...placer.rejects,
      repaired: fix.report.removed, repairRounds: fix.report.rounds,
      pockets: fix.report.pockets, stuck: fix.report.stuck,
      pens: runs.filter((r) => r.kind === 'pen').length,
      divider: runs.some((r) => r.kind === 'divider'),
    },
  };
}

// A prop that is not solid does not stop a body: a hole is a hole and a spoil
// heap is a mound you walk over. Everything else in the arena is something a
// skeleton goes round, which is why repair.js exists.
export { discClear, NAV_R };

export { PANEL, SPAWN_CLEAR, WALL_HALF };
export default buildLevel;
