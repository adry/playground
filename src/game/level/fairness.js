// THE SOAK'S EIGHT FAIRNESS PROPERTIES, RUN INSIDE THE EDITOR.
//
// Now that a level only ever comes from the editor, nothing stands between a
// hand-made arena and the player. The generator used to guarantee these by
// construction and soak.mjs proved it over three thousand seeds; an author can
// break any of them with one click, and the worst of them, F3, is invisible on
// screen: a corner fenced off with no gate looks like a pen and plays like a
// place the player can stand and never be caught.
//
// So the checks are run here, on the level being edited, and they are the SAME
// checks rather than an approximation of them. soak.mjs's `fairOne` is not
// exported and the file runs a suite on import, so it cannot be called; what
// this is instead is a transcription of it against the same primitives it
// uses, imported from the same files:
//
//   createNav      src/game/nav.js, the occupancy raster the bot plans on and
//                  the soak rasters fairness on. `makeGrid` lives there rather
//                  than in bot.js for exactly this reason.
//   TUNING         src/game/rules.js, for the ghost's radius and pick radius
//   SKEL_RADIUS    src/game/chase.js
//
// Nothing here is a second opinion about what is fair. If soak.mjs's rules
// change, this is stale and should be re-transcribed; the shape of the code is
// kept deliberately close to the original so that a diff between them is
// readable.
//
// THE EIGHT, in the soak's own words and its own order:
//
//   spawn        the ghost's own disc fits where it starts
//   F1graveCut   every grave is in the ghost's jump-free component, so a
//                skeleton that climbs out of it can reach the player
//   F2sealed     no pocket with no way out at all holds the spawn, a firefly,
//                a pellet or a grave
//   F3safeSpot   G is a subset of S: everywhere the ghost can reach WITH a
//                jump, a skeleton can reach WITHOUT one. THE ONE THAT MATTERS
//   F4pin        no single gate is the only way out of a region: plug each
//                gate in turn and the ghost's reachable set must not split
//   flyReach     every firefly is within a pick radius of ground the ghost can
//                stand on
//   graveClear   every grave admits the skeleton's disc
//   gateWide     every gate's approach corridor admits a 0.60 body, two units
//                either side of the opening
//
// COST. A 30 by 30 arena at the soak's own 0.5 raster is 78 by 78 cells, and
// F4 walks that once per gate. It is tens of milliseconds, which is far too
// slow for a pointer move and nothing at all once a gesture ends, so the
// editor runs it on the deep pass and not on the live one.

import { createNav } from '../nav.js';
import { TUNING } from '../rules.js';
import { SKEL_RADIUS } from '../chase.js';

// The soak's arena settings. 0.5 rather than 0.75 because at 0.75 there are
// worlds where no cell centre lands in the passable part of a gate and a
// perfectly good opening is invisible to the check.
export const FAIR_CELL = 0.5;
// One radius for both floods, the larger of the two bodies, so the check can
// call a four-millimetre gap impassable but can never call a wall a gap.
export const FAIR_RADIUS = Math.max(TUNING.ghostRadius, SKEL_RADIUS + 0.08);

// What each failure means, in one line an author can act on.
export const FAIR_MESSAGES = {
  spawn: 'the ghost does not fit where it starts',
  F1graveCut: 'a grave is cut off from the ghost: a skeleton climbing out of it can never reach the player',
  F2sealed: 'something the game asks a player to go to is in a pocket with no way out at all',
  F3safeSpot: 'THE SAFE SPOT: the ghost can vault somewhere no skeleton can follow, and the player will stand there for ever',
  F4pin: 'one gate is the only way out of a region, so a skeleton standing in it pins the player',
  flyReach: 'a firefly is not within reach of ground the ghost can stand on',
  graveClear: 'a grave has no room for a skeleton to climb out of it',
  gateWide: 'a gate cannot be approached: something is blocking the corridor through it',
};

function flood(grid, seeds, jump, out, plug) {
  const N = grid.n * grid.n;
  out.fill(0);
  const q = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (const s of seeds) if (s >= 0 && !out[s] && !(plug && plug.has(s))) { out[s] = 1; q[tail++] = s; }
  while (head < tail) {
    const n = q[head++];
    const a = n % grid.n;
    for (let d = 0; d < 8; d++) {
      const [dx, dz] = grid.DIR8[d];
      if (a + dx < 0 || a + dx >= grid.n) continue;
      const m = n + dz * grid.n + dx;
      if (m < 0 || m >= N || out[m] || grid.blocked[m] || grid.wall[n * 8 + d]) continue;
      if (plug && plug.has(m)) continue;
      out[m] = 1;
      q[tail++] = m;
    }
    if (jump) {
      const links = grid.jump.get(n);
      if (links) for (const m of links) if (!out[m] && !(plug && plug.has(m))) { out[m] = 1; q[tail++] = m; }
    }
  }
  return out;
}

// The no-jump components, which is what "a region" means in F2 and F4.
function components(grid) {
  const N = grid.n * grid.n;
  const label = new Int32Array(N).fill(-1);
  const q = new Int32Array(N);
  let count = 0;
  for (let s = 0; s < N; s++) {
    if (grid.blocked[s] || label[s] !== -1) continue;
    let head = 0;
    let tail = 0;
    label[s] = count;
    q[tail++] = s;
    while (head < tail) {
      const n = q[head++];
      const a = n % grid.n;
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = grid.DIR8[d];
        if (a + dx < 0 || a + dx >= grid.n) continue;
        const m = n + dz * grid.n + dx;
        if (m < 0 || m >= N || grid.blocked[m] || label[m] !== -1 || grid.wall[n * 8 + d]) continue;
        label[m] = count;
        q[tail++] = m;
      }
    }
    count += 1;
  }
  return { label, count };
}

// Run the eight against a world. Returns { fail: [codes], where: {code: {x,z}} }
// so the editor can both name the failure and fly the camera to it.
export function checkFairness(world) {
  const b = world.bounds;
  const at = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const judge = Math.max(b.maxX - at.x, b.maxZ - at.z) - 0.5;
  const half = judge + 5;

  const nav = createNav(world);
  nav.focus(at.x, at.z);
  const grid = nav.makeGrid({ x: at.x, z: at.z, half, cell: FAIR_CELL, radius: FAIR_RADIUS });
  const N = grid.n * grid.n;
  const { label, count } = components(grid);
  const box = { minX: at.x - judge, minZ: at.z - judge, maxX: at.x + judge, maxZ: at.z + judge };
  const inBox = (p) => p.x > box.minX && p.x < box.maxX && p.z > box.minZ && p.z < box.maxZ;
  const fireflies = world.fireflies(box).filter(inBox);
  const powerups = world.powerups(box).filter(inBox);
  const graves = world.graves(box).filter(inBox);
  const gates = world.gates(box).filter(inBox);

  const fail = [];
  const where = {};
  const note = (code, at2) => { if (!fail.includes(code)) { fail.push(code); if (at2) where[code] = { x: at2.x, z: at2.z }; } };

  const spawnCell = grid.nearestOpen(at.x, at.z);
  if (spawnCell < 0) { note('spawn', world.spawn); return { fail, where }; }

  const open = new Uint8Array(count);
  for (let i = 0; i < N; i++) {
    const a = i % grid.n;
    const c = (i / grid.n) | 0;
    if (a === 0 || c === 0 || a === grid.n - 1 || c === grid.n - 1) if (label[i] >= 0) open[label[i]] = 1;
  }

  const gateOut = new Array(count).fill(0).map(() => new Set());
  const vaultOut = new Array(count).fill(0).map(() => new Set());
  for (let i = 0; i < N; i++) {
    const li = label[i];
    if (li < 0) continue;
    const a = i % grid.n;
    for (let d = 0; d < 8; d++) {
      const [dx, dz] = grid.DIR8[d];
      if (a + dx < 0 || a + dx >= grid.n) continue;
      const m = i + dz * grid.n + dx;
      if (m < 0 || m >= N || grid.blocked[m]) continue;
      const lm = label[m];
      if (lm < 0 || lm === li) continue;
      if (!grid.wall[i * 8 + d]) gateOut[li].add(lm);
    }
    const links = grid.jump.get(i);
    if (links) for (const m of links) if (label[m] >= 0 && label[m] !== li) vaultOut[li].add(label[m]);
  }
  // In a bounded world the region the ghost starts in IS the level, not a
  // pocket, and its only boundary is a perimeter nothing can vault. Counting it
  // as sealed fails 89.5% of arenas for no reason; the soak makes the same
  // exception and for the same reason.
  if (label[spawnCell] >= 0) open[label[spawnCell]] = 1;
  const exits = (c) => (open[c] ? 9 : gateOut[c].size + vaultOut[c].size);

  const ghostSet = new Uint8Array(N);
  flood(grid, [spawnCell], true, ghostSet);
  const graveCells = graves.map((g) => grid.nearestOpen(g.x, g.z)).filter((c) => c >= 0);
  const skelSet = new Uint8Array(N);
  flood(grid, graveCells, false, skelSet);

  // F1.
  const spawnComp = label[spawnCell];
  for (let i = 0; i < graveCells.length; i++) {
    const c = graveCells[i];
    if (label[c] !== spawnComp && !(open[label[c]] && open[spawnComp])) { note('F1graveCut', graves[i]); break; }
  }

  // F2.
  const wanted = new Map();
  for (const p of [...fireflies, ...powerups, ...graves]) {
    const c = grid.nearestOpen(p.x, p.z);
    if (c >= 0 && !wanted.has(label[c])) wanted.set(label[c], p);
  }
  if (!wanted.has(spawnComp)) wanted.set(spawnComp, world.spawn);
  for (const [c, p] of wanted) if (c >= 0 && exits(c) === 0) { note('F2sealed', p); break; }

  // F3. THE SAFE SPOT.
  let leak = 0;
  let leakAt = null;
  for (let i = 0; i < N; i++) {
    if (!ghostSet[i] || skelSet[i]) continue;
    if (Math.abs(grid.wx(i) - at.x) > judge || Math.abs(grid.wz(i) - at.z) > judge) continue;
    leak++;
    if (!leakAt) leakAt = { x: grid.wx(i), z: grid.wz(i) };
  }
  // A few cells is rasterisation at a gate's lip; a pocket is tens of them.
  if (leak > 6) note('F3safeSpot', leakAt);

  // F4.
  const seen = new Int32Array(N).fill(-1);
  const bfs = new Int32Array(N);
  for (const g of gates) {
    const plug = new Set();
    const rr = g.half + FAIR_RADIUS;
    const c0 = grid.index(g.x, g.z);
    if (c0 < 0) continue;
    const span = Math.ceil(rr / FAIR_CELL);
    const a0 = c0 % grid.n;
    const b0 = (c0 / grid.n) | 0;
    for (let bb = b0 - span; bb <= b0 + span; bb++) {
      for (let aa = a0 - span; aa <= a0 + span; aa++) {
        if (aa < 0 || bb < 0 || aa >= grid.n || bb >= grid.n) continue;
        const i = bb * grid.n + aa;
        if (Math.hypot(grid.wx(i) - g.x, grid.wz(i) - g.z) <= rr) plug.add(i);
      }
    }
    seen.fill(-1);
    const sizes = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (!ghostSet[s0] || plug.has(s0) || seen[s0] !== -1) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      let size = 0;
      seen[s0] = id;
      bfs[tail++] = s0;
      while (head < tail) {
        const n = bfs[head++];
        if (Math.abs(grid.wx(n) - at.x) <= judge && Math.abs(grid.wz(n) - at.z) <= judge) size++;
        const a = n % grid.n;
        for (let d = 0; d < 8; d++) {
          const [dx, dz] = grid.DIR8[d];
          if (a + dx < 0 || a + dx >= grid.n) continue;
          const m = n + dz * grid.n + dx;
          if (m < 0 || m >= N || !ghostSet[m] || plug.has(m) || seen[m] !== -1 || grid.wall[n * 8 + d]) continue;
          seen[m] = id;
          bfs[tail++] = m;
        }
        const links = grid.jump.get(n);
        if (links) for (const m of links) if (ghostSet[m] && !plug.has(m) && seen[m] === -1) { seen[m] = id; bfs[tail++] = m; }
      }
      sizes.push(size);
    }
    if (sizes.filter((z) => z > 4).length > 1) { note('F4pin', g); break; }
  }

  // Carried over.
  for (const f of fireflies) {
    const c = grid.nearestOpen(f.x, f.z);
    if (c < 0 || !ghostSet[c] || Math.hypot(grid.wx(c) - f.x, grid.wz(c) - f.z) > TUNING.pickRadius) {
      note('flyReach', f);
      break;
    }
  }
  for (const g of graves) if (!nav.discClear(g.x, g.z, SKEL_RADIUS)) { note('graveClear', g); break; }
  for (const g of gates) {
    let plugged = false;
    for (let t = -2.0; t <= 2.0 + 1e-9; t += 0.5) {
      if (!nav.discClear(g.x - g.dz * t, g.z + g.dx * t, 0.60)) { plugged = true; break; }
    }
    if (plugged) { note('gateWide', g); break; }
  }

  return { fail, where };
}

export default checkFairness;
