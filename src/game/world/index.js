// THE WORLD. A walled graveyard, 30 by 30, built once.
//
// ============================================================================
// THE CONTRACT WITH THE NAVIGATION HALF
// ============================================================================
//
// WHAT CHANGED FROM THE ENDLESS VERSION, in one paragraph, because the rules
// half is building against the old shape. The world is BOUNDED. `CHUNK`,
// `chunkAt`, `ensureAround` and `release` are gone; `bounds` is no longer null
// but the arena rectangle; there is a new `wall`, which is a barrier like any
// other except that it is the perimeter and the ghost CANNOT HOP IT. Every
// query below has the same name, the same box argument and the same record
// shape it had before, so a caller that only ever asked `barriers(box)` and
// `props(box)` needs no change at all. Two fields are new on every barrier:
// `kind` ('wall' or 'fence') and `jumpable` (false for the wall, true for the
// fences), and one field changed shape: a gate's `clear` keep-out is now a
// CAPSULE rather than a disc, for the reason under GATES below.
//
// Everything is world space. There is no grid, no lattice and no frame on the
// caller's side of this line. A `box` is always { minX, minZ, maxX, maxZ }.
//
//   createWorld({ seed, size = 30 }) -> world
//
//   world.size                  30. The arena is size by size, centred on the
//                               origin, because the owner sized it off the
//                               floor grid in src/ghost/ground.js: a major line
//                               every 5.0, six of them a side.
//   world.bounds                { minX, minZ, maxX, maxZ }. The arena.
//   world.spawn                 { x, z }. Where the ghost starts. (0, 0).
//
//   world.barriers(box) -> [{ id, x0, z0, x1, z1, half, height, kind, jumpable,
//                             run, yaw }]
//   world.wall          -> the four perimeter barriers, also in barriers()
//   world.gates(box)    -> [{ id, barrier, x, z, dx, dz, nx, nz, half,
//                             sweep, clear, hinge, prop }]
//   world.props(box)    -> [{ id, kind, x, z, yaw, radius, height, solid,
//                             variant, foot }]
//   world.fireflies(box)-> [{ id, x, z }]
//   world.powerups(box) -> [{ id, x, z }]
//   world.graves(box)   -> [{ id, x, z, yaw }]
//   world.paths(box)    -> [{ id, points: [[x, z], ...], width }]
//   world.blocks(x0, z0, x1, z1) -> the first barrier a move crosses, or null
//
// BARRIERS. A barrier is a straight segment. `half` is half its thickness in
// plan: 0.0775 for a fence, which is half of a 0.155 post, and 0.25 for the
// wall. The rules half assumed 0.10, which is a safe over estimate for a fence
// and an under estimate for the wall, so read `half`. `height` is 0.86 for a
// fence, which is what a hop has to clear, and 3.2 for the wall, which is what
// a hop cannot. `jumpable` says which is which in one flag: THE GHOST MAY CROSS
// A FENCE AND MAY NOT CROSS THE WALL, and a skeleton may cross neither.
//
// A GATE IS A HOLE IN THE BARRIER LIST, NOT AN EXCEPTION TO IT. The segments
// either side of an opening stop at the opening's edges, so "does this move
// cross a fence" is a plain segment against segment test with no gate case in
// it anywhere. The gate record exists so a path finder can AIM at an opening
// and a renderer can build the leaf. `x, z` is the middle of the opening;
// `dx, dz` is a unit vector along the fence and `nx, nz` one through it; `half`
// is half the clear opening, 1.0, so a 0.60 body passes with 0.4 either side.
// `sweep` is the leaf's own keep-out disc about `hinge`. `clear` is the
// APPROACH CORRIDOR and it is a capsule, { x0, z0, x1, z1, r }, reaching 2.2
// either side of the opening: a disc keep-out let a prop sit a thousandth
// outside it and plug the mouth, because the question is not whether a body
// fits through an opening but whether it can reach it.
//
// WHAT IS TRUE OF EVERY LEVEL, BY CONSTRUCTION RATHER THAN BY INSPECTION.
// fence.js and level.js argue these; the short form is:
//
//   1. every fence run has exactly one gate;
//   2. no fenced region is sealed, so there is no pocket a ghost can vault into
//      and no skeleton can reach. The perimeter wall is the one closed loop
//      without a gate, on purpose: it is the edge of the level;
//   3. no two runs come within 2.4 of each other, so no pocket is closed
//      BETWEEN two runs either;
//   4. a gate is a gap and never an end, so an endpoint no other segment shares
//      really is the end of a fence you can walk round;
//   5. no prop partitions the inside of a pen. Every part of every interior
//      that admits a 0.60 body can be walked to from outside the gate, checked
//      with a flood fill after everything is placed and enforced by taking
//      props back out.
//
// FENCES ARE PENS AND DIVIDERS, NOT SHORT RUNS, and that is the whole of what
// the rules half's measurement bought. A short open run has two free ends and
// walking round an end costs a skeleton about what the vault costs the ghost,
// which is why a bot that never jumped scored within four percent of one that
// did. A PEN is a closed rectangle with one gate: the ghost is over the rail in
// half a second and the skeleton walks the perimeter. A DIVIDER runs wall to
// wall with one gate in it and has no free ends at all. Every level gets one to
// three pens, and a divider slightly more often than not.
//
// ============================================================================
// WHAT THE ARENA HOLDS, AND WHY THOSE NUMBERS
// ============================================================================
//
// 900 square units, which the camera shows most of at once: at view 9.0 the
// frame is 22 world units across the screen by 37 deep, so the arena is about
// one and a half screens.
//
//   props      one per about 25 square units, so 35 or so. The old level ran at
//              one per 26 and looked right, and this arena has to hold four
//              characters running, so it is not made denser.
//   fireflies  NINE, on a 3 by 3 lattice pulled toward whatever is worth
//              walking to, giving a mean nearest neighbour near 9. The owner
//              asked for one per screen and a level you can clear; in an arena
//              a screen and a half across you cannot have both, and 9 units is
//              the compromise: about half a screen between them, seventy units
//              of running to sweep a level, and nine times fewer than the first
//              build's one per unit of corridor.
//   pellets    four, one per quadrant, on a path crossing where there is one.
//              Pac-Man's number and Pac-Man's placement.
//   graves     four, one per quadrant. That is exactly MAX_GROUND_HOLES, so a
//              bounded arena has no hole budget to manage at all: every grave
//              can be cut at once and the fifth that would throw cannot exist.
//              One per quadrant puts one within about twelve units of anywhere,
//              which is the range a dead skeleton re-homes over.
//   fence      about one unit per 11 square units of ground. That is four times
//              the endless world's and half the old maze's, and the shape is
//              what matters rather than the total: it is two or three closed
//              pens and a divider rather than corridor walls.
//
// Nothing in this package imports three or touches a canvas, with the single
// exception every file in src/game already makes: two published constants come
// off the props themselves rather than being written down twice.

import {
  levelBox, gridBoxOf, worldBoxOf, padBox, boxesOverlap, inBox, rngAt,
  LEVEL_SIZE, PATH_HALF, FLY_CELL, FLY_REACH, POWERUPS, SPAWN_CLEAR, WALL_HEIGHT, WALL_HALF,
} from './field.js';
import { buildLevel, BODY } from './level.js';
import { GATE_HALF, PANEL, FENCE_HALF, BARRIER_HEIGHT, segGap } from './fence.js';
import { footprintOf } from '../layout/footprints.js';

// How far a prop's centre may sit outside the box it is asked for and still
// have its footprint inside it.
const PROP_REACH = 2.2;
const FLY_CLEAR = 0.45;
const PELLET_CLEAR = footprintOf('pumpkin', 'classic').r + 0.25;
// The edge of the arena the collectible lattices keep off, so nothing is
// jammed against the wall where a body cannot get round it.
const EDGE = 4.0;

export function createWorld({ seed = 1, size = LEVEL_SIZE } = {}) {
  const level = buildLevel({ seed, size });
  const { field, box, props, barriers, gates, graves, wall, runs, spawn } = level;
  const frame = field.frame;

  // --- paths, which are a field and not a list --------------------------------
  const PATH_STEP = 0.6;
  function paths(query = box) {
    const g = gridBoxOf(frame, padBox(query, 2));
    const out = [];
    const clipped = (points) => points.filter(([x, z]) => inBox(padBox(box, 0.5), x, z));
    for (const k of field.uPathsNear((g.minU + g.maxU) / 2, (g.maxU - g.minU) / 2 + 3)) {
      const pts = [];
      for (let v = g.minV; v <= g.maxV + PATH_STEP; v += PATH_STEP) {
        const w = frame.toWorld(field.uPathAt(k, v), v);
        pts.push([w.x, w.z]);
      }
      const c = clipped(pts);
      if (c.length > 1) out.push({ id: `path/u/${k}`, family: 'u', k, points: c, width: PATH_HALF * 2 });
    }
    for (const m of field.vPathsNear((g.minV + g.maxV) / 2, (g.maxV - g.minV) / 2 + 3)) {
      const pts = [];
      for (let u = g.minU; u <= g.maxU + PATH_STEP; u += PATH_STEP) {
        const w = frame.toWorld(u, field.vPathAt(m, u));
        pts.push([w.x, w.z]);
      }
      const c = clipped(pts);
      if (c.length > 1) out.push({ id: `path/v/${m}`, family: 'v', k: m, points: c, width: PATH_HALF * 2 });
    }
    return out;
  }

  // --- the collectibles ---------------------------------------------------------
  //
  // Both lattices work the same way: a cell of the arena, a point in it chosen
  // by what is worth walking to, and then a nudge off anything it would be
  // standing in. Where the next one is IS the level design when there are only
  // nine of them, so the order below is the design: inside a pen, beside a
  // gate, past a fence, on a path, and only then in the open.

  // The least ground the player must cover between two of them. Nine fireflies
  // pulled toward the same pen or the same gate end up on top of each other,
  // and two fireflies two units apart are one firefly: the walk between them is
  // the whole point.
  const FLY_GAP = 4.5;

  function nudge(pick, centre, reach, clear, apart = []) {
    const tries = [{ du: 0, dv: 0 }];
    for (const r of [0.6, 1.2, 1.8, 2.4]) {
      for (let a = 0; a < 8; a++) tries.push({ du: Math.cos((a * Math.PI) / 4) * r, dv: Math.sin((a * Math.PI) / 4) * r });
    }
    for (const t of tries) {
      const u = pick.u + t.du;
      const v = pick.v + t.dv;
      if (Math.hypot(u - centre.u, v - centre.v) > reach) continue;
      const w = frame.toWorld(u, v);
      if (w.x < box.minX + 1.2 || w.x > box.maxX - 1.2 || w.z < box.minZ + 1.2 || w.z > box.maxZ - 1.2) continue;
      let bad = false;
      for (const p of props) {
        if (!p.solid) continue;
        if (Math.hypot(w.x - p.x, w.z - p.z) < clear + p.radius) { bad = true; break; }
      }
      if (!bad) {
        for (const g of gates) {
          if (Math.hypot(w.x - g.sweep.x, w.z - g.sweep.z) < g.sweep.r + 0.15) { bad = true; break; }
        }
      }
      if (!bad) {
        for (const s of barriers) {
          if (segGap(w.x, w.z, w.x, w.z, s.x0, s.z0, s.x1, s.z1) < BODY + s.half) { bad = true; break; }
        }
      }
      if (!bad) {
        for (const o of apart) {
          if (Math.hypot(w.x - o.x, w.z - o.z) < FLY_GAP) { bad = true; break; }
        }
      }
      if (!bad) return { u, v };
    }
    return pick;
  }

  function collectible(cx, cz, reach, clear, tag, apart = []) {
    const centre = frame.toGrid(cx, cz);
    const rng = rngAt(seed, tag, Math.round(cx * 8), Math.round(cz * 8));
    let pick = null;
    // 1: inside a pen, so the player must gate it or hop the rail.
    for (const run of runs) {
      if (!run.interior || pick) continue;
      const it = run.interior;
      const hu = Math.max(0, it.halfU - 0.9);
      const hv = Math.max(0, it.halfV - 0.9);
      const u = Math.max(it.u - hu, Math.min(it.u + hu, centre.u));
      const v = Math.max(it.v - hv, Math.min(it.v + hv, centre.v));
      if (Math.hypot(u - centre.u, v - centre.v) <= reach) pick = { u, v, why: 'pen' };
    }
    // 2: just past a gate, where the player and the skeleton meet at a choke.
    if (!pick) {
      for (const gate of gates) {
        if (pick) break;
        const g = frame.toGrid(gate.x, gate.z);
        const n = frame.toGrid(gate.nx, gate.nz);
        for (const side of [1, -1]) {
          const u = g.u + n.u * 3.0 * side;
          const v = g.v + n.v * 3.0 * side;
          if (!pick && Math.hypot(u - centre.u, v - centre.v) <= reach) pick = { u, v, why: 'gate' };
        }
      }
    }
    // 3: the far side of a fence line, so the player meets a hop on the way.
    if (!pick) {
      let best = null;
      for (const s of barriers) {
        if (!s.jumpable) continue;
        const t = closestOnSegment(cx, cz, s.x0, s.z0, s.x1, s.z1);
        if (t.d < 0.5 || t.d > reach) continue;
        if (!best || t.d < best.d) best = t;
      }
      if (best) {
        const nx = (best.x - cx) / best.d;
        const nz = (best.z - cz) / best.d;
        const g = frame.toGrid(best.x + nx * 2.4, best.z + nz * 2.4);
        pick = { u: g.u, v: g.v, why: 'fence' };
      }
    }
    // 4: on a path, so the trail reads as somewhere to walk.
    if (!pick) {
      const p = field.nearestPath(centre.u, centre.v, reach + 1);
      if (p.dist <= reach) pick = { u: p.u, v: p.v, why: 'path' };
    }
    // 5: the open ground of the cell itself.
    if (!pick) pick = { u: centre.u + rng.jitter(1.4), v: centre.v + rng.jitter(1.4), why: 'open' };

    const wide = pick.why === 'fence' ? reach + 2.4 : reach;
    // Separation first, and only then the cell centre as a last resort: a
    // firefly in the open at the middle of its cell is a worse firefly than one
    // beside a gate, but two on the same spot are worse than either.
    let spot = nudge(pick, centre, wide, clear, apart);
    if (apart.some((o) => Math.hypot(frame.toWorld(spot.u, spot.v).x - o.x, frame.toWorld(spot.u, spot.v).z - o.z) < FLY_GAP)) {
      spot = nudge({ u: centre.u, v: centre.v }, centre, wide, clear, apart);
    }
    const w = frame.toWorld(spot.u, spot.v);
    return { x: w.x, z: w.z, why: pick.why };
  }

  // Nine fireflies on a 3 by 3 lattice of the arena, inset from the wall.
  const flyList = (() => {
    const span = size - 2 * EDGE;
    const n = Math.max(2, Math.round(span / FLY_CELL));
    const out = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const cx = box.minX + EDGE + ((i + 0.5) * span) / n;
        const cz = box.minZ + EDGE + ((j + 0.5) * span) / n;
        // The middle cell of a 3 by 3 lattice lands exactly where the ghost
        // starts, so it is pushed out of the clearing rather than dropped: with
        // nine of them in the level, losing one to arithmetic is losing an
        // eighth of the level.
        let px = cx;
        let pz = cz;
        const d = Math.hypot(cx - spawn.x, cz - spawn.z);
        if (d < SPAWN_CLEAR + 1) {
          const a = rngAt(seed, 'flyshove', i, j).float(0, Math.PI * 2);
          px = spawn.x + Math.cos(a) * (SPAWN_CLEAR + 1.6);
          pz = spawn.z + Math.sin(a) * (SPAWN_CLEAR + 1.6);
        }
        const c = collectible(px, pz, FLY_REACH, FLY_CLEAR, 'fly', out);
        out.push({ id: `fly/${i},${j}`, ...c });
      }
    }
    return out;
  })();

  // Four pellets, one per quadrant, on a crossroads where the quadrant has one.
  const pelletList = (() => {
    const q = size / 4;
    const out = [];
    let i = 0;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (out.length >= POWERUPS) break;
      const cx = sx * q;
      const cz = sz * q;
      const centre = frame.toGrid(cx, cz);
      let pick = null;
      for (const k of field.uPathsNear(centre.u, 5)) {
        for (const m of field.vPathsNear(centre.v, 5)) {
          const c = field.crossing(k, m);
          if (Math.hypot(c.u - centre.u, c.v - centre.v) <= 5) pick = c;
        }
      }
      if (!pick) {
        const p = field.nearestPath(centre.u, centre.v, 6);
        pick = p.dist <= 6 ? { u: p.u, v: p.v } : centre;
      }
      const spot = nudge({ u: pick.u, v: pick.v }, centre, 6, PELLET_CLEAR);
      const w = frame.toWorld(spot.u, spot.v);
      out.push({
        id: `jack/${i++}`, kind: 'jack', x: w.x, z: w.z,
        yaw: frame.yawFor(0, -1), radius: footprintOf('pumpkin', 'classic').r,
      });
    }
    return out;
  })();

  // --- the queries -----------------------------------------------------------------
  const clip = (list, query) => (query ? list.filter((e) => inBox(padBox(query, PROP_REACH), e.x, e.z)) : list);

  return {
    seed,
    size,
    field,
    frame,
    bounds: box,
    spawn,
    // The numbers a caller might want to reason with rather than rediscover.
    BODY,
    WALL_HEIGHT,
    WALL_HALF,
    BARRIER_HEIGHT,
    BARRIER_HALF: FENCE_HALF,
    GATE_HALF,
    PANEL,
    PATH_HALF,

    wall: wall.segments,
    runs,

    props(query) {
      if (!query) return props;
      return props.filter((p) => p.x + p.radius >= query.minX && p.x - p.radius <= query.maxX
        && p.z + p.radius >= query.minZ && p.z - p.radius <= query.maxZ);
    },
    barriers(query) {
      if (!query) return barriers;
      return barriers.filter((s) => boxesOverlap(s.box, query));
    },
    gates(query) {
      if (!query) return gates;
      return gates.filter((g) => boxesOverlap(g.box, query));
    },
    graves: (query) => clip(graves, query),
    fireflies: (query) => clip(flyList, query),
    powerups: (query) => clip(pelletList, query),
    paths,

    blocks(x0, z0, x1, z1) {
      for (const s of barriers) {
        if (segmentsCross(x0, z0, x1, z1, s.x0, s.z0, s.x1, s.z1)) return s;
      }
      return null;
    },

    // The bounded world builds everything at once, so these are here only so
    // that a caller written against the endless one keeps working. They do
    // nothing, and they cost nothing.
    ensureAround: () => [],
    release: () => 0,

    stats: level.stats,
    _level: level,
  };
}

export function closestOnSegment(px, pz, x0, z0, x1, z1) {
  const ex = x1 - x0;
  const ez = z1 - z0;
  const l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * ex + (pz - z0) * ez) / l2));
  const x = x0 + ex * t;
  const z = z0 + ez * t;
  return { x, z, t, d: Math.hypot(px - x, pz - z) };
}

export function segmentsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const s = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = s(cx, cz, dx, dz, ax, az);
  const d2 = s(cx, cz, dx, dz, bx, bz);
  const d3 = s(ax, az, bx, bz, cx, cz);
  const d4 = s(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export { LEVEL_SIZE, levelBox, worldBoxOf };
export default createWorld;
