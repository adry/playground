// THE LEVEL AUDIT. Every placement rule in src/game/DESIGN.md, plus the rules a
// walled arena adds, asserted against a level.
//
// ============================================================================
// WHAT THIS TAKES, AND WHY IT IS NOT A DOCUMENT
// ============================================================================
//
// It takes a WORLD: anything that answers `bounds`, `spawn`, `wall`, `runs`,
// `PATH_HALF`, and `barriers()`, `gates()`, `props()`, `spawns()`,
// `fireflies()` and `paths()`. Both things that make levels
// already produce exactly that, so a generated level is
//
//     auditLevel(createWorld({ seed }), fail)
//
// and a level somebody drew by hand in the editor is
//
//     auditLevel(createLevelWorld(doc), fail)
//
// with no adapter in between and no second copy of any rule. Taking the world
// interface rather than the file format is deliberate: the file format belongs
// to the editor and will change as the editor grows, and these rules are about
// GEOMETRY, which will not.
//
// `fail(rule, message)` is called once per violation. RULES lists every rule
// name it can pass. auditFindings(world) is the same audit collected into an
// array, for a caller that would rather have one.
//
// THE GEOMETRY IS A SECOND IMPLEMENTATION and that is the point. It is corner
// based where the generator is axis based, polygon against polygon where the
// generator uses a separating axis on half extents, and sampled polylines where
// the generator solves a curve. It runs on PUBLISHED coordinates rather than on
// anybody else's internals, so a bug in a frame, a footprint or a path field
// shows up here instead of hiding behind itself. Keep it that way: if a rule
// here ever starts importing the thing it is checking, it stops being a check.
//
// WHAT IS NOT HERE. The eight fairness properties are transcribed in
// src/game/level/fairness.js against nav.js's own raster and the editor runs
// those. The one thing neither those nor any flood fill can see is a WEDGE, a
// place a body fits that nothing can walk to, because a raster at a single cell
// size aliases it in both directions; that lives in repair.js as findWedges,
// and is rule 11 here.

import { LEVEL_SIZE, PATH_HALF, GRAVES, WALL_HEIGHT } from './field.js';
import { BODY } from './level.js';
import { findWedges } from './repair.js';
import { spawnZones, spawnFault, SPAWN_FLOOR } from './spawn.js';
import { MAX_GROUND_HOLES } from '../../ghost/ground.js';

export { LEVEL_SIZE, WALL_HEIGHT, BODY, GRAVES, PATH_HALF, MAX_GROUND_HOLES, SPAWN_FLOOR };

// --- the rules, and their numbers -------------------------------------------
export const MARGIN = 0.15;          // rule 1, nothing overlaps
export const PATH_MARGIN = 0.05;     // rule 2, nothing stands in a path
export const OCCLUSION = 0.39;       // rule 5, off main.js's CAM_DIR
export const FENCE_MARGIN = 0.15;    // nothing leans on a fence
export const GATE_BODY = 0.95;       // nothing solid this close to the middle of a gate
export const CELL = 0.2;             // the raster everything walkable is judged on

export const RULES = ['overlap', 'path', 'fence', 'gate', 'grave', 'occlusion', 'bounds',
  'wall', 'gateless', 'sealed', 'wedge', 'holes', 'floor', 'spawn'];

// --- geometry, written out rather than imported ------------------------------

export function shapeOf(p) {
  if (p.foot.shape === 'disc') return { circle: true, x: p.x, z: p.z, r: p.foot.r };
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const ax = { x: c, z: -s };
  const az = { x: s, z: c };
  return {
    circle: false,
    pts: [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([su, sv]) => ({
      x: p.x + su * p.foot.halfU * ax.x + sv * p.foot.halfV * az.x,
      z: p.z + su * p.foot.halfU * ax.z + sv * p.foot.halfV * az.z,
    })),
  };
}
export function axesOf(poly) {
  const out = [];
  for (let i = 0; i < poly.pts.length; i++) {
    const a = poly.pts[i];
    const b = poly.pts[(i + 1) % poly.pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out.push({ x: -(b.z - a.z) / len, z: (b.x - a.x) / len });
  }
  return out;
}
export function project(poly, axis) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly.pts) {
    const t = p.x * axis.x + p.z * axis.z;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [lo, hi];
}
export function pointPoly(px, pz, poly) {
  let inside = true;
  let best = Infinity;
  let sign = 0;
  for (let i = 0; i < poly.pts.length; i++) {
    const a = poly.pts[i];
    const b = poly.pts[(i + 1) % poly.pts.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (pz - a.z) * ez) / l2));
    best = Math.min(best, Math.hypot(px - (a.x + ex * t), pz - (a.z + ez * t)));
    const side = Math.sign((px - a.x) * ez - (pz - a.z) * ex);
    if (side !== 0) { if (sign === 0) sign = side; else if (side !== sign) inside = false; }
  }
  return inside ? -best : best;
}
export function gapBetween(A, B) {
  if (A.circle && B.circle) return Math.hypot(A.x - B.x, A.z - B.z) - A.r - B.r;
  if (A.circle) return pointPoly(A.x, A.z, B) - A.r;
  if (B.circle) return pointPoly(B.x, B.z, A) - B.r;
  let best = -Infinity;
  for (const axis of [...axesOf(A), ...axesOf(B)]) {
    const [a0, a1] = project(A, axis);
    const [b0, b1] = project(B, axis);
    best = Math.max(best, Math.max(b0 - a1, a0 - b1));
  }
  return best;
}
export function pointSeg(px, pz, x0, z0, x1, z1) {
  const ex = x1 - x0;
  const ez = z1 - z0;
  const l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * ex + (pz - z0) * ez) / l2));
  return Math.hypot(px - (x0 + ex * t), pz - (z0 + ez * t));
}
// A barrier as the RECTANGLE it is rather than as its centreline. Taking the
// distance to the centreline and subtracting the half thickness is a capsule,
// which is fatter than the barrier at its ends, and that difference alone is
// enough to report a perfectly legal prop as leaning on a fence.
export function barrierPoly(b) {
  const dx = b.x1 - b.x0;
  const dz = b.z1 - b.z0;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * b.half;
  const nz = (dx / len) * b.half;
  return {
    circle: false,
    pts: [
      { x: b.x0 + nx, z: b.z0 + nz }, { x: b.x1 + nx, z: b.z1 + nz },
      { x: b.x1 - nx, z: b.z1 - nz }, { x: b.x0 - nx, z: b.z0 - nz },
    ],
  };
}
export function halfAcross(p) {
  if (p.foot.shape === 'disc') return p.foot.r;
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return Math.abs(p.foot.halfU * ((c + s) * Math.SQRT1_2)) + Math.abs(p.foot.halfV * ((s - c) * Math.SQRT1_2));
}
// The paths, resampled here rather than asked for as curves, so the world's own
// curve solver is not the thing checking the world's own curve solver.
export function pathPoints(world, step = 0.2) {
  const out = [];
  for (const p of world.paths()) {
    for (let i = 1; i < p.points.length; i++) {
      const [ax, az] = p.points[i - 1];
      const [bx, bz] = p.points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
  }
  return out;
}

// --- where a body can walk, and how far -----------------------------------------
//
// One raster per level, used by the fairness rule AND by the measurement. A
// cell is open when a disc of the rules half's own radius fits in it clear of
// every barrier, the wall included. Rasterised at a fifth of a unit, which is
// fine enough that the narrowest legal passage survives it: a 2.0 gate opening
// leaves the centre of a body 0.32 either side of the centreline, and a half
// unit grid can miss that entirely and call a good gate sealed.
export function walkGrid(world) {
  const box = world.bounds;
  const n = Math.round((box.maxX - box.minX) / CELL);
  const open = new Uint8Array(n * n).fill(1);
  for (const s of world.barriers()) {
    const reach = BODY + s.half;
    const a0 = Math.max(0, Math.floor((Math.min(s.x0, s.x1) - reach - box.minX) / CELL));
    const a1 = Math.min(n - 1, Math.ceil((Math.max(s.x0, s.x1) + reach - box.minX) / CELL));
    const b0 = Math.max(0, Math.floor((Math.min(s.z0, s.z1) - reach - box.minZ) / CELL));
    const b1 = Math.min(n - 1, Math.ceil((Math.max(s.z0, s.z1) + reach - box.minZ) / CELL));
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        if (!open[b * n + a]) continue;
        if (pointSeg(box.minX + (a + 0.5) * CELL, box.minZ + (b + 0.5) * CELL, s.x0, s.z0, s.x1, s.z1) < reach) open[b * n + a] = 0;
      }
    }
  }
  // The nearest open cell, because a firefly may legitimately sit closer to a
  // fence than a body's radius and still be somewhere the ghost can collect it.
  const nearestOpen = (x, z, within = 1.2) => {
    const ca = Math.round((x - box.minX) / CELL - 0.5);
    const cb = Math.round((z - box.minZ) / CELL - 0.5);
    const span = Math.round(within / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let db = -span; db <= span; db++) {
      for (let da = -span; da <= span; da++) {
        const a = ca + da;
        const b = cb + db;
        if (a < 0 || b < 0 || a >= n || b >= n || !open[b * n + a]) continue;
        const d = da * da + db * db;
        if (d < bestD) { bestD = d; best = b * n + a; }
      }
    }
    return best;
  };
  return { n, open, box, nearestOpen };
}

// Dijkstra over the open cells, eight connected with real diagonal costs, so
// what comes back is a walking DISTANCE and not a count of steps. A bucket
// queue at a quarter of a cell is exact enough for a ratio and much cheaper
// than a heap.
export function walkField(grid, fromIndex) {
  const { n, open } = grid;
  // FLOAT64, not 32. Storing d + w as a float32 can round it UP, so the guard
  // `dist[j] <= d + w` stays false for ever, the cell is relaxed on every visit
  // and the bucket queue grows without bound. That was a checker that ran for
  // one level and hung for twenty, and it took six gigabytes with it.
  const dist = new Float64Array(n * n).fill(Infinity);
  if (fromIndex < 0) return dist;
  dist[fromIndex] = 0;
  const step = CELL / 4;
  const buckets = [];
  const push = (i, d) => {
    const b = Math.floor(d / step);
    (buckets[b] || (buckets[b] = [])).push(i);
  };
  push(fromIndex, 0);
  const D = [[1, 0, CELL], [-1, 0, CELL], [0, 1, CELL], [0, -1, CELL],
    [1, 1, CELL * Math.SQRT2], [1, -1, CELL * Math.SQRT2], [-1, 1, CELL * Math.SQRT2], [-1, -1, CELL * Math.SQRT2]];
  for (let b = 0; b < buckets.length; b++) {
    const list = buckets[b];
    if (!list) continue;
    for (const i of list) {
      const d = dist[i];
      if (Math.floor(d / step) !== b) continue;
      const a = i % n;
      const q = (i - a) / n;
      for (const [da, db, w] of D) {
        const na = a + da;
        const nb = q + db;
        if (na < 0 || nb < 0 || na >= n || nb >= n) continue;
        const j = nb * n + na;
        if (!open[j] || dist[j] <= d + w) continue;
        dist[j] = d + w;
        push(j, d + w);
      }
    }
  }
  return dist;
}

// A NOTE FOR WHOEVER PROFILES THIS NEXT, because it has caught three people.
//
// Timed once, cold, this pass costs several times what it costs warm: measured
// in the editor at 434 to 583 ms for the first deep review after a page load
// and 35 to 88 ms once V8 has settled. A first pass over prop counts even
// showed it getting cheaper as a level filled up, which is false -- warmed and
// run out of order it scales the way you would expect, 49 ms on an empty arena,
// 76 at forty props, 135 at a hundred. Warm it and shuffle the order before you
// believe any number that comes out of here.
export function auditLevel(world, fail) {
  const props = world.props();
  const barriers = world.barriers();
  const gates = world.gates();
  const shapes = props.map(shapeOf);
  const pts = pathPoints(world);
  const box = world.bounds;

  // 1: nothing overlaps.
  for (let i = 0; i < props.length; i++) {
    for (let k = i + 1; k < props.length; k++) {
      if (Math.hypot(props[i].x - props[k].x, props[i].z - props[k].z) > props[i].radius + props[k].radius + MARGIN) continue;
      const g = gapBetween(shapes[i], shapes[k]);
      if (g < MARGIN - 1e-6) fail('overlap', `${props[i].kind}/${props[i].variant} and ${props[k].kind}/${props[k].variant} gap ${g.toFixed(3)}`);
    }
  }

  // 2: nothing stands in a path.
  const half = world.PATH_HALF ?? PATH_HALF;
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    for (const [x, z] of pts) {
      if (Math.abs(x - p.x) > p.radius + half + 0.4 || Math.abs(z - p.z) > p.radius + half + 0.4) continue;
      const g = shapes[i].circle ? Math.hypot(x - shapes[i].x, z - shapes[i].z) - shapes[i].r : pointPoly(x, z, shapes[i]);
      if (g < half + PATH_MARGIN - 1e-6) {
        fail('path', `${p.kind}/${p.variant} into a path by ${(half + PATH_MARGIN - g).toFixed(3)}`);
        break;
      }
    }
  }

  // 3: nothing leans on a fence or on the wall.
  for (let i = 0; i < props.length; i++) {
    for (const b of barriers) {
      if (Math.hypot(props[i].x - (b.x0 + b.x1) / 2, props[i].z - (b.z0 + b.z1) / 2) > props[i].radius + b.length / 2 + FENCE_MARGIN + 0.3) continue;
      const g = gapBetween(shapes[i], barrierPoly(b));
      if (g < FENCE_MARGIN - 1e-6) fail('fence', `${props[i].kind}/${props[i].variant} on a ${b.kind}, gap ${g.toFixed(3)}`);
    }
  }

  // 4: nothing in a gate's sweep, and nothing solid in its APPROACH. The
  // approach is a capsule, which is the shape the rules half's failure asked
  // for: a body has to reach an opening and not merely fit through it.
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    const S = shapes[i];
    const distTo = (x, z) => (S.circle ? Math.hypot(x - S.x, z - S.z) - S.r : pointPoly(x, z, S));
    for (const g of gates) {
      if (distTo(g.sweep.x, g.sweep.z) < g.sweep.r - 1e-6) fail('gate', `${p.kind}/${p.variant} in a gate sweep`);
      if (!p.solid) continue;
      const dc = distTo(g.x, g.z);
      if (dc < GATE_BODY - 1e-6) fail('gate', `solid ${p.kind} ${dc.toFixed(2)} from the middle of a gate`);
      let near = Infinity;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        near = Math.min(near, distTo(g.clear.x0 + (g.clear.x1 - g.clear.x0) * t, g.clear.z0 + (g.clear.z1 - g.clear.z0) * t));
      }
      if (near < g.clear.r - 0.06) fail('gate', `solid ${p.kind} ${near.toFixed(2)} into a gate's approach`);
    }
  }

  // 5: a grave hole has its spoil heap on the long side away from the nearest
  // path, and a headstone at its head.
  for (const hole of props.filter((p) => p.kind === 'hole')) {
    const local = (q) => {
      const c = Math.cos(hole.yaw);
      const s = Math.sin(hole.yaw);
      const dx = q.x - hole.x;
      const dz = q.z - hole.z;
      return { x: dx * c - dz * s, z: dx * s + dz * c };
    };
    // The NEAREST spoil heap, not the first one that fits the description. Two
    // graves five units apart each have a heap inside the other's search
    // radius, and picking the first found the neighbour's heap and reported a
    // perfectly good grave as having its heap on the wrong side.
    const pile = props
      .filter((q) => q.kind === 'dirt' && Math.hypot(q.x - hole.x, q.z - hole.z) < 3.2
        && Math.abs(local(q).z) > Math.abs(local(q).x))
      .sort((a, b) => Math.hypot(a.x - hole.x, a.z - hole.z) - Math.hypot(b.x - hole.x, b.z - hole.z))[0];
    if (!pile) { fail('grave', 'a hole has no spoil heap on a long side'); continue; }
    const head = props
      .filter((q) => q.kind === 'stone' && Math.hypot(q.x - hole.x, q.z - hole.z) < 2.8
        && Math.abs(local(q).x) > Math.abs(local(q).z))
      .sort((a, b) => Math.hypot(a.x - hole.x, a.z - hole.z) - Math.hypot(b.x - hole.x, b.z - hole.z))[0];
    if (!head) fail('grave', 'a hole has no headstone at its head');
    let nearest = null;
    for (const [x, z] of pts) {
      const d = Math.hypot(x - hole.x, z - hole.z);
      if (!nearest || d < nearest.d) nearest = { x, z, d };
    }
    if (nearest) {
      const lc = local({ x: nearest.x, z: nearest.z });
      const lp = local(pile);
      if (Math.abs(lc.z) >= 0.35 * nearest.d && Math.sign(lp.z) === Math.sign(lc.z)) {
        fail('grave', 'the spoil heap is on the path side of the hole');
      }
    }
  }

  // 6: nothing tall stands in front of anything short, in the camera's axes.
  const scr = props.map((p) => ({ p, d: p.x + p.z, a: (p.x - p.z) * Math.SQRT1_2, half: halfAcross(p) }));
  scr.sort((m, o) => m.a - o.a);
  for (let i = 0; i < scr.length; i++) {
    for (let k = i + 1; k < scr.length; k++) {
      if (scr[k].a - scr[i].a >= scr[i].half + scr[k].half) break;
      const front = scr[i].d > scr[k].d ? scr[i] : scr[k];
      const back = front === scr[i] ? scr[k] : scr[i];
      if (front.d === back.d || back.p.height <= 0.05) continue;
      if (front.p.height >= back.p.height + (front.d - back.d) * OCCLUSION) {
        fail('occlusion', `${front.p.kind}/${front.p.variant} hides ${back.p.kind}/${back.p.variant}`);
      }
    }
  }

  // 7: everything is inside the wall.
  for (const p of props) {
    if (p.x - p.radius < box.minX || p.x + p.radius > box.maxX
      || p.z - p.radius < box.minZ || p.z + p.radius > box.maxZ) fail('bounds', `${p.kind} outside the arena`);
  }
  for (const c of [...world.fireflies(), ...world.spawns()]) {
    if (c.x < box.minX + 0.5 || c.x > box.maxX - 0.5 || c.z < box.minZ + 0.5 || c.z > box.maxZ - 0.5) {
      fail('bounds', `${c.id} outside the arena`);
    }
  }

  // 8: the wall is a wall, and every fence run has a gate a body fits through.
  const wall = world.wall;
  if (wall.length !== 4) fail('wall', `the perimeter has ${wall.length} segments`);
  for (const w of wall) {
    if (w.jumpable) fail('wall', 'the perimeter is jumpable');
    if (w.height <= 1.5) fail('wall', `the perimeter is only ${w.height} tall`);
  }
  if (WALL_HEIGHT <= 1.5) fail('wall', 'WALL_HEIGHT is not a wall');
  for (const run of world.runs) {
    // A corner stub is the one run without a gate, and it does not need one:
    // its opening is its open end, and fence.js keeps that wider than a body.
    // Everything else that encloses anything has to have a way in.
    if (!run.gates.length && run.kind !== 'stub') fail('gateless', `run ${run.id} has no gate`);
    for (const g of run.gates) if (g.half < BODY + 0.10) fail('gateless', `gate ${g.id} is only ${(g.half * 2).toFixed(2)} wide`);
    // A gate is a gap and never an end, so a pen has exactly the two free ends
    // its opening makes and no others.
    const ends = new Map();
    for (const s of run.segments) {
      for (const k of [`${s.x0.toFixed(3)},${s.z0.toFixed(3)}`, `${s.x1.toFixed(3)},${s.z1.toFixed(3)}`]) {
        ends.set(k, (ends.get(k) || 0) + 1);
      }
    }
    const free = [...ends.values()].filter((c) => c === 1).length;
    if (run.kind === 'pen' && free !== 2) fail('gateless', `a pen has ${free} free ends rather than the two either side of its gate`);
    if (run.kind === 'stub' && free !== 2) fail('gateless', `a stub has ${free} ends rather than two`);
  }

  // 9: FAIRNESS. Everything in the arena can be walked to by a 0.60 body that
  // cannot jump, from where the ghost starts. This is the replacement for "one
  // connected component over all corridor nodes" and it is the property the
  // redirection actually needs: the skeletons can always reach the player, and
  // the player can never be sealed anywhere they cannot leave.
  const grid = walkGrid(world);
  const start = grid.nearestOpen(world.spawn.x, world.spawn.z, 2.0);
  if (start < 0) { fail('sealed', 'the ghost starts where a body cannot stand'); return grid; }
  const dist = walkField(grid, start);
  for (const c of [...world.fireflies(), ...world.spawns()]) {
    const i = grid.nearestOpen(c.x, c.z, 1.4);
    if (i < 0 || !Number.isFinite(dist[i])) fail('sealed', `${c.id} cannot be walked to`);
  }
  // And no pocket of open ground anywhere, whether or not anything is in it: a
  // ghost that vaults into one is safe in it for ever. A pocket worth hiding in
  // is bigger than the ghost, which is 1.31 across, so more than forty cells.
  let pocket = 0;
  for (let i = 0; i < grid.open.length; i++) if (grid.open[i] && !Number.isFinite(dist[i])) pocket++;
  if (pocket > 40) fail('sealed', `${pocket} cells of open ground are sealed off`);

  // 10: the floor can only be cut so many times, and the rules half needs the
  // counts it was promised.
  const holes = props.filter((p) => p.kind === 'hole').length;
  if (holes > MAX_GROUND_HOLES) fail('holes', `${holes} open graves, the floor allows ${MAX_GROUND_HOLES}`);
  // Five, on the owner's decision, and the number is a floor rather than a
  // target. Measured over 40 arenas with points placed for distance alone,
  // nine fireflies in a 30 by 30 arena cannot be more than 13.8 apart and come
  // out at about 11 once they also dodge props and fences, where five reach
  // 19.8. The owner asked to have to cross the screen for the next one, so
  // they took five and the spacing rather than nine and the density. Anything
  // below five is not that decision, it is a level with nothing to collect.
  if (world.fireflies().length < 5) fail('floor', `only ${world.fireflies().length} fireflies`);
  // Four of these are the graves' own headstones, so six is two free standing
  // stones and is the point below which the arena stops reading as a graveyard
  // at all rather than merely reading as a thin one.
  if (props.filter((p) => p.kind === 'stone').length < 6) fail('floor', 'a graveyard with almost no headstones in it');

  // 12: THE SKELETONS HAVE SOMEWHERE TO COME FROM.
  //
  // This is the rule the pen used to make unnecessary. A level carried four
  // hand-placed graves, the generator guaranteed them and the audit only had to
  // count them; a skeleton now climbs out in front of a HEADSTONE picked at
  // random, so the question is about every headstone in the yard and it is
  // geometric. spawn.js owns the zone, its measurement and the four reasons a
  // stone is not a spawn point, and both this and world/index.js's own list
  // call spawnFault, so a stone cannot be usable to the game and unusable to
  // the audit or the other way round.
  //
  // TWO CLAUSES, and they are deliberately not the same severity.
  //
  // A SOLID PROP in the zone FAILS, one finding per stone. It is the mistake an
  // author makes without noticing -- a bench, a fountain, the next headstone
  // along -- and it is fixable by moving one thing a hand's width.
  //
  // A FENCE across the zone, a gate sweeping through it or an edge hanging over
  // the wall DEMOTES the stone instead. A headstone standing with its face half
  // a metre from a pen rail is a good thing to place and no rule should forbid
  // it; what it is not is a place a skeleton can come out. Failing those would
  // fail a level for being a graveyard.
  //
  // What catches a yard that has quietly run out of markers is the COUNT, and
  // the message names what was demoted so the author can see where the ones
  // they thought they had went.
  const zones = spawnZones(props);
  const faults = { prop: 0, fence: 0, gate: 0, bounds: 0 };
  let usable = 0;
  for (const z of zones) {
    const why = spawnFault(z, { props, barriers, gates, box });
    if (!why) { usable++; continue; }
    faults[why]++;
    if (why === 'prop') {
      fail('spawn', `nothing can climb out in front of the ${z.variant} at ${z.prop.x.toFixed(1)}, ${z.prop.z.toFixed(1)}: something solid is standing in its plot`);
    }
  }
  if (usable < SPAWN_FLOOR) {
    const lost = [];
    if (faults.fence) lost.push(`${faults.fence} fenced in`);
    if (faults.gate) lost.push(`${faults.gate} in a gate's sweep`);
    if (faults.bounds) lost.push(`${faults.bounds} over the wall`);
    if (faults.prop) lost.push(`${faults.prop} blocked by a prop`);
    const of = zones.length ? `${zones.length} headstones with a face` : 'no headstone with a face';
    fail('spawn', `${usable} places a skeleton can climb out of, the game needs ${SPAWN_FLOOR} (${of}${lost.length ? ', ' + lost.join(', ') : ''})`);
  }

  // 11: NO WEDGES. A place a body fits that nothing can walk to. Rule 9 above
  // floods at one cell size and so cannot see one; this asks the question in
  // continuous geometry. It is the rule that took generated arenas from
  // eighteen per cent unfair to none, and it is the one a hand-made level most
  // needs, because fencing a corner takes an author about four seconds.
  const wedges = wedgeRule(world, fail);

  // `grid` is what world-check.mjs wants; `wedges` is what the editor wants.
  grid.wedges = wedges;
  return grid;
}

// Rule 11 lives in repair.js so that the generator, which uses it to REMOVE the
// prop making a wedge, and this, which only reports one, cannot disagree about
// what a wedge is. See findWedges for why single cells are not reported.
//
// The wedges are handed back as well as reported, because the editor wants the
// LIST -- it flies the camera to one when you click it -- and used to get it by
// calling findWedges a second time, immediately after the audit had just run
// it. Two floods of the whole arena where one would do.
function wedgeRule(world, fail) {
  const wedges = findWedges({
    box: world.bounds,
    barriers: world.barriers(),
    gates: world.gates(),
    props: world.props(),
    spawn: world.spawn,
    spawns: world.spawns(),
  });
  for (const w of wedges) {
    // `cells: 0` is not a pocket, it is a spawn point on the wrong side of the
    // flood: somewhere a skeleton APPEARS that the ghost can never reach. Same
    // list because it is the same failure of the same property, said from the
    // other end. See findWedges.
    if (w.spawn) {
      fail('wedge', `the ${w.spawn} marker at ${w.x.toFixed(1)}, ${w.z.toFixed(1)} spawns a skeleton somewhere nothing can walk to`);
      continue;
    }
    fail('wedge', `${w.cells} cells at ${w.x.toFixed(1)}, ${w.z.toFixed(1)}: a body fits there and nothing can walk to it`);
  }
  return wedges;
}

// The same audit, collected rather than called back, and carrying the wedge
// list so nobody has to flood the arena again to get it.
export function auditFindings(world) {
  const out = [];
  const wedges = auditLevel(world, (rule, message) => out.push({ rule, message }))?.wedges || [];
  out.wedges = wedges;
  return out;
}

export default auditLevel;
