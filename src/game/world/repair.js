// The repair pass, and the measurement that made it necessary.
//
// The rules half pointed its fairness soak at this generator and found F3, the
// safe spot, failing in ONE LEVEL IN FOUR. F3 says: everywhere the ghost can
// reach using its jump must be somewhere a skeleton can reach without one. When
// it fails there is a place the player can stand and be safe for ever, and the
// game stops being a game.
//
// The cause was not the fences. It was the HEADSTONES, and the reason is a
// number this package did not know it had to respect: navigation treats a solid
// prop as a CIRCLE of its bounding radius, and a body needs 0.555 of clearance.
// A headstone therefore blocks a disc of about 1.14, and two headstones placed
// the legal 0.15 apart block everything between them. A wandering row of five,
// which is the prettiest thing this generator makes, is a WALL as far as
// anything that walks is concerned. Lay one against the perimeter and the strip
// behind it is a place the ghost can hop into and no skeleton can follow.
//
// So placement rule 1 is about how a graveyard LOOKS and it is not sufficient.
// This file adds the rule about how it WORKS:
//
//   THE WALKABLE GROUND OF A LEVEL IS ONE PIECE. Every point a 0.60 body can
//   stand on is connected to every other by walking, with no jump anywhere.
//
// That is strictly stronger than F3 and it is much easier to enforce and to
// state. If the walkable set is connected then the skeletons' reachable set is
// all of it, the ghost's is a subset of it, and the difference F3 measures is
// empty by construction.
//
// It is enforced by TAKING PROPS BACK OUT. The alternative, refusing them at
// placement time, cannot work: whether a prop closes a passage depends on every
// other prop, so it is a property of the finished level and not of any single
// placement. A row of five that becomes a row of four is still a row, which is
// the same argument layout/motifs.js makes about refusals, applied at the end
// instead of at the beginning.
//
// The same pass fixes the three smaller failures the soak found, because they
// are all the same shape of problem, a prop somewhere a body has to be:
//
//   the ghost's own spawn has to admit a body
//   every grave has to admit a skeleton, or nothing can climb out of it
//   every gate's approach corridor has to admit a body, two units either side

// THE RULES HALF'S OWN RASTERISER, IMPORTED RATHER THAN REPRODUCED.
//
// The first version of this file reproduced nav.js's occupancy model here, and
// it cut F3 from 24% to 16% and no further, because a reproduction is not the
// thing: their raster blocks EDGES as well as cells, uses half a unit rather
// than a quarter, and takes its radius from the two bodies rather than from a
// number written down twice. Every one of those differences is a level this
// generator believes is connected and their check does not. So the repair pass
// asks nav.js the same question the soak asks it, on the same grid, and cannot
// drift from it.
// A QUARTER OF A UNIT, not a half.
//
// The repair ran at 0.5 first, matching the soak's own default, and the soak
// then read 0.0% at 0.5, 0.7% at 0.4 and 2.0% at 0.25: climbing rather than
// converging, which is a coarse raster failing to SEE the failures a fine one
// finds. A half unit grid steps over a gap between two headstones that a body
// can walk through and steps over a pocket a body can stand in, and it does the
// second more often than the first. So the repair is done at the finest raster
// anybody measures at, and it costs about forty milliseconds a level.
export const NAV_CELL = 0.25;
// THE BODY, PLUS A MARGIN, AND THE MARGIN IS THE POINT.
//
// soak.mjs judges with FAIR_RADIUS = max(TUNING.ghostRadius 0.55, SKEL_RADIUS
// 0.475 + 0.08) = 0.555. Repairing at exactly that left a residue of about one
// arena in a hundred that MOVED between raster steps: seed 139 failed at 0.5
// and 0.4 and passed at 0.3, seed 115 the other way round. A failure that moves
// with the measuring instrument is not a hole in the world, it is a passage
// sitting exactly on the limit, and whether a raster sees it depends on where
// its cell centres happen to land rather than on anything about the level.
//
// So the repair works to a body slightly wider than the one that has to fit.
// The margin cannot be large: a gate's opening is 2.0 between two posts of
// 0.0775, which leaves a body of radius r just 2.0 - 2 * (0.0775 + r) of room
// to steer in, and at r = 0.705 that is 0.435, narrower than the coarse raster
// the first round uses. The repair then reads a perfectly good gate as sealed,
// decides the pen behind it is a pocket, finds no prop to blame and gives up on
// the whole level. That regression cost more than the margin bought. 0.08 keeps
// 0.575 of steering room, wider than any raster in use, and still leaves every
// passage 0.16 wider than the body that has to fit.
// ONE CLEARANCE FOR EVERYTHING, AND THE GATES RE-OPENED BY HAND.
//
// This is the number that took three tries to get right, so the reasoning is
// worth writing down.
//
// A flood fill only SEES a passage when a line of cell centres runs through the
// free part of it, so a channel of physical width W is seen at cell size c only
// once W - 2 * 0.555 is about c. Rasters in use run from 0.5 down to 0.2, so
// any channel between 1.11 and 1.61 wide is one that some rasters find and
// others do not, and a region behind such a channel is a pocket that appears
// and disappears with the measuring instrument. Every residual F3 failure was
// one of those: a five cell wedge between a pen's fence and a headstone a
// metre off it, which the ghost vaults into and a skeleton reaches through a
// gap that half the rasters cannot see.
//
// Widening the body does not fix it on its own, because the gap between two
// fence posts at a GATE is only 1.845 and a body wide enough to force every
// other channel above 1.61 cannot get through one. So the repair does both
// halves of the obvious thing: it blocks everything at a radius that puts every
// channel it keeps above the band, and then RE-OPENS the gates, which are known
// passable by construction and are checked separately anyway.
export const UNIFORM_R = 0.805;
// What makeGrid is asked for, which only has to be right for the edge mask it
// builds; the rings below do the rest.
export const NAV_R = 0.635;
// The body the gates are re-opened for, which is the one that has to fit.
export const GATE_BODY_R = 0.58;
export const SKEL_R = 0.475;
export const GATE_R = 0.60;
export const GATE_REACH = 2.0;
// In CELLS of NAV_CELL, so at a quarter of a unit this is a pocket of an eighth
// of a square unit and a total leak of a fifth of one. The ghost is 1.31 across
// and needs 1.35 square units to stand in, so nothing this small is a place
// anybody can hide; the tolerance exists only for the one or two cells that
// rasterisation leaves at the lip of a gate.
const MIN_POCKET = 2;
const MAX_LEAK = 3;

import { createNav } from '../nav.js';

const pointSegD2 = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax;
  const dz = bz - az;
  const ll = dx * dx + dz * dz;
  let t = ll > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return (px - (ax + dx * t)) ** 2 + (pz - (az + dz * t)) ** 2;
};

export function discClear(barriers, props, x, z, r) {
  for (const b of barriers) {
    const lim = b.half + r;
    if (pointSegD2(x, z, b.x0, b.z0, b.x1, b.z1) < lim * lim - 1e-6) return false;
  }
  for (const p of props) {
    if (!p.solid) continue;
    const lim = p.radius + r;
    if ((x - p.x) ** 2 + (z - p.z) ** 2 < lim * lim - 1e-6) return false;
  }
  return true;
}

// Which solid props are the reason a point is blocked.
function blockers(props, x, z, r) {
  const out = [];
  for (const p of props) {
    if (!p.solid || p.keep) continue;
    const lim = p.radius + r;
    if ((x - p.x) ** 2 + (z - p.z) ** 2 < lim * lim) out.push(p);
  }
  return out;
}


// nav.js's grid over the whole arena and a little beyond it, so the wall is
// represented rather than falling off the edge of the raster.
function navGrid(box, barriers, gates, props, spawn, cell = NAV_CELL) {
  const at = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  // Only far enough past the wall for the wall itself to be in the raster. It
  // blocks 0.555 + 0.25 of ground, so 1.5 is all of it, and the raster is
  // quadratic in this number.
  const half = Math.max(box.maxX - at.x, box.maxZ - at.z) + 1.5;
  const nav = createNav({
    spawn,
    barriers: () => barriers,
    gates: () => gates,
    props: () => props,
    fireflies: () => [],
    powerups: () => [],
    graves: () => [],
  });
  nav.focus(at.x, at.z);
  const grid = nav.makeGrid({ x: at.x, z: at.z, half, cell, radius: NAV_R });
  const x0 = at.x - half;
  const z0 = at.z - half;
  const box2 = (cx, cz, r) => ({
    a0: Math.max(0, Math.floor((cx - r - x0) / cell)),
    a1: Math.min(grid.n - 1, Math.ceil((cx + r - x0) / cell)),
    b0: Math.max(0, Math.floor((cz - r - z0) / cell)),
    b1: Math.min(grid.n - 1, Math.ceil((cz + r - z0) / cell)),
  });
  // Everything up to the uniform clearance, props and barriers alike.
  for (const p of props) {
    if (!p.solid) continue;
    const r = p.radius + UNIFORM_R;
    const w = box2(p.x, p.z, r);
    for (let b = w.b0; b <= w.b1; b++) {
      for (let a = w.a0; a <= w.a1; a++) {
        const i = b * grid.n + a;
        if (!grid.blocked[i] && Math.hypot(grid.wx(i) - p.x, grid.wz(i) - p.z) < r) grid.blocked[i] = 1;
      }
    }
  }
  for (const s of barriers) {
    const r = s.half + UNIFORM_R;
    const w = box2((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, Math.hypot(s.x1 - s.x0, s.z1 - s.z0) / 2 + r);
    for (let b = w.b0; b <= w.b1; b++) {
      for (let a = w.a0; a <= w.a1; a++) {
        const i = b * grid.n + a;
        if (!grid.blocked[i] && Math.sqrt(pointSegD2(grid.wx(i), grid.wz(i), s.x0, s.z0, s.x1, s.z1)) < r) grid.blocked[i] = 1;
      }
    }
  }
  // And the gates back open. A gate is 1.845 between the posts, which is above
  // the band and passable at every raster, but it is below the uniform
  // clearance, so blocking it and then re-opening it is the only way to have
  // both. Nothing else in the level gets this treatment.
  for (const g of gates) {
    const w = box2(g.x, g.z, 3.0);
    for (let b = w.b0; b <= w.b1; b++) {
      for (let a = w.a0; a <= w.a1; a++) {
        const i = b * grid.n + a;
        if (!grid.blocked[i]) continue;
        const cx = grid.wx(i);
        const cz = grid.wz(i);
        if (Math.hypot(cx - g.x, cz - g.z) > 3.0) continue;
        if (discClear(barriers, props, cx, cz, GATE_BODY_R)) grid.blocked[i] = 0;
      }
    }
  }
  grid.nav = nav;
  return grid;
}

// The no-jump pieces of the walkable ground, over nav's own edge mask: a step
// between two open cells is not a step if the edge between them crosses a
// barrier, which is a distinction a cell-only raster cannot make.
// Only what is INSIDE the wall counts. The raster reaches a few units past the
// perimeter so the wall itself is represented rather than falling off the edge,
// and the ground out there in the darkness is a component like any other: the
// first version of this pass spent every round trying to remove a headstone
// that would connect the arena to the outside of it.
// A component's identity across rounds, since the labels are renumbered every
// time: the world position of its lowest cell, rounded to the nearest unit.
function signature(grid, label, id) {
  for (let i = 0; i < grid.n * grid.n; i++) {
    if (label[i] === id) return `${Math.round(grid.wx(i))},${Math.round(grid.wz(i))}`;
  }
  return 'none';
}

function insideCount(grid, label, id, box) {
  let n = 0;
  for (let i = 0; i < grid.n * grid.n; i++) {
    if (label[i] !== id) continue;
    const x = grid.wx(i);
    const z = grid.wz(i);
    if (x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) n++;
  }
  return n;
}

function components(grid) {
  const N = grid.n * grid.n;
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < N; s++) {
    if (grid.blocked[s] || label[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      size++;
      const a = i % grid.n;
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = grid.DIR8[d];
        if (a + dx < 0 || a + dx >= grid.n) continue;
        const j = i + dz * grid.n + dx;
        if (j < 0 || j >= N || grid.blocked[j] || label[j] !== -1 || grid.wall[i * 8 + d]) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// --- the pass ---------------------------------------------------------------
//
// Returns what it had to take out, and the walkable grid the collectibles are
// then placed against, so a firefly is never put somewhere nothing can walk.
export function repairLevel({ box, barriers, gates, graves, spawn, placer, rounds = 40 }) {
  const report = { removed: 0, rounds: 0, pockets: 0, spawn: 0, grave: 0, gate: 0, stuck: null };
  // Pockets nothing can be removed to open. They are bounded by fence and wall
  // rather than by props, so no prop is to blame and there is nothing this pass
  // can do about them. They are SKIPPED rather than fatal: giving up on the
  // level the moment one appears leaves every other problem in it unfixed,
  // which is how a widened margin made the failure rate go UP.
  const unfixable = new Set();

  for (let round = 0; round < rounds; round++) {
    report.rounds = round + 1;
    const props = placer.props;
    // The gross partitions first, on a raster four times cheaper, and then the
    // fine one that decides. A half unit grid finds a row of headstones across
    // the arena in forty milliseconds; it cannot find the last two per cent,
    // which is what the quarter unit rounds are for.
    const cell = round === 0 ? NAV_CELL * 2 : NAV_CELL;
    const grid = navGrid(box, barriers, gates, props, spawn, cell);
    const { label, sizes } = components(grid);

    // The main piece is the one the ghost starts in. If the ghost cannot stand
    // where it starts, that is the first thing to fix.
    const spawnCell = grid.nearestOpen(spawn.x, spawn.z);
    if (spawnCell < 0 || Math.hypot(grid.wx(spawnCell) - spawn.x, grid.wz(spawnCell) - spawn.z) > 0.8) {
      const bad = blockers(props, spawn.x, spawn.z, NAV_R + 0.4);
      if (!bad.length) { report.stuck = 'spawn'; break; }
      placer.drop(bad);
      report.removed += bad.length;
      report.spawn++;
      continue;
    }
    const main = label[spawnCell];

    // 1. Every point a body can stand on is in the main piece.
    let worst = -1;
    let worstSize = 0;
    let leak = 0;
    for (let id = 0; id < sizes.length; id++) {
      if (id === main) continue;
      const inside = insideCount(grid, label, id, box);
      const scale = (NAV_CELL / cell) ** 2;
      if (inside * scale <= MIN_POCKET) { leak += inside * scale; continue; }
      leak += inside * scale;
      if (unfixable.has(signature(grid, label, id))) continue;
      if (inside * scale > worstSize) { worst = id; worstSize = inside * scale; }
    }
    // A clean coarse round proves nothing: the fine raster has the last word,
    // always, because the failures that are left are the ones a half unit grid
    // steps over.
    if (worst < 0 && cell > NAV_CELL) continue;
    if (worst < 0 && leak > MAX_LEAK) {
      // Several pockets, none of them big on its own, but enough of them
      // together to fail. Take the largest whatever its size.
      for (let id = 0; id < sizes.length; id++) {
        if (id === main || unfixable.has(signature(grid, label, id))) continue;
        const inside = insideCount(grid, label, id, box);
        if (inside > worstSize) { worst = id; worstSize = inside; }
      }
    }
    if (worst >= 0) {
      // Whatever is walling the pocket in, counted over its whole boundary, so
      // the prop that is most of the wall goes rather than an arbitrary one.
      const votes = new Map();
      for (let i = 0; i < grid.n * grid.n; i++) {
        if (label[i] !== worst) continue;
        // Everything within a body's reach of the pocket that is solid and not
        // a grave. Voting over the pocket's whole boundary means the prop that
        // is most of the wall goes rather than an arbitrary one.
        for (const p of blockers(props, grid.wx(i), grid.wz(i), UNIFORM_R + NAV_CELL * 3)) {
          votes.set(p, (votes.get(p) || 0) + 1);
        }
      }
      if (!votes.size) {
        unfixable.add(signature(grid, label, worst));
        report.stuck = 'pocket';
        continue;
      }
      let pick = null;
      let best = -1;
      for (const [p, v] of votes) if (v > best) { best = v; pick = p; }
      placer.drop([pick]);
      report.removed++;
      report.pockets++;
      continue;
    }

    // 2. Every grave admits a skeleton, and is in the main piece.
    let fixed = false;
    for (const g of graves) {
      if (discClear(barriers, props, g.x, g.z, SKEL_R)) {
        const c = grid.nearestOpen(g.x, g.z);
        if (c >= 0 && label[c] === main && Math.hypot(grid.wx(c) - g.x, grid.wz(c) - g.z) < 1.2) continue;
      }
      const bad = blockers(props, g.x, g.z, SKEL_R + 0.5);
      if (!bad.length) continue;
      placer.drop(bad);
      report.removed += bad.length;
      report.grave++;
      fixed = true;
      break;
    }
    if (fixed) continue;

    // 3. Every gate's approach corridor admits a body, two units either side.
    for (const gate of gates) {
      const bad = [];
      for (let t = -GATE_REACH; t <= GATE_REACH + 1e-9; t += 0.25) {
        const x = gate.x + gate.nx * t;
        const z = gate.z + gate.nz * t;
        if (discClear(barriers, props, x, z, GATE_R)) continue;
        for (const p of blockers(props, x, z, GATE_R)) if (!bad.includes(p)) bad.push(p);
      }
      if (!bad.length) continue;
      placer.drop(bad);
      report.removed += bad.length;
      report.gate++;
      fixed = true;
      break;
    }
    if (fixed) continue;

    // Nothing left to fix. Hand back the grid the collectibles will be placed
    // against, with the walkable set already worked out.
    const reach = new Uint8Array(grid.n * grid.n);
    for (let i = 0; i < reach.length; i++) reach[i] = label[i] === main ? 1 : 0;
    return { report, grid, reach, ...walkApi(grid, reach) };
  }

  // Ran out of rounds. Hand back what there is; world-check.mjs will say so.
  const grid = navGrid(box, barriers, gates, placer.props, spawn, NAV_CELL);
  const { label } = components(grid);
  const spawnCell = grid.nearestOpen(spawn.x, spawn.z, 1.5);
  const main = spawnCell >= 0 ? label[spawnCell] : -1;
  const reach = new Uint8Array(grid.n * grid.n);
  for (let i = 0; i < reach.length; i++) reach[i] = label[i] === main ? 1 : 0;
  return { report, grid, reach, ...walkApi(grid, reach) };
}

// What the collectibles are placed against: is this somewhere a body can walk
// to, and if not, where is the nearest place that is.
function walkApi(grid, reach) {
  const walkable = (x, z, within = 1.0) => {
    const c = grid.nearestOpen(x, z);
    return c >= 0 && reach[c] === 1 && Math.hypot(grid.wx(c) - x, grid.wz(c) - z) <= within;
  };
  const nearestReachable = (x, z, radius = 6, apart = [], gap = 0) => {
    let best = null;
    let bestD = radius * radius;
    for (let i = 0; i < reach.length; i++) {
      if (!reach[i]) continue;
      const cx = grid.wx(i);
      const cz = grid.wz(i);
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d >= bestD) continue;
      if (gap && apart.some((o) => Math.hypot(cx - o.x, cz - o.z) < gap)) continue;
      bestD = d;
      best = { x: cx, z: cz };
    }
    return best;
  };
  return { walkable, nearestReachable };
}

export default repairLevel;
