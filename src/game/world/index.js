// THE WORLD. An endless graveyard, generated as it is reached.
//
// ============================================================================
// THE CONTRACT WITH THE NAVIGATION HALF
// ============================================================================
//
// Everything below is world space. There is no grid, no 2.0 lattice and no
// frame on the caller's side of this line: `x` and `z` are the same x and z the
// renderer and the rules use. A `box` is always { minX, minZ, maxX, maxZ } and
// every query is answered from the chunks that box touches and from nowhere
// else, so the cost of a query is the size of the box and not the size of the
// world.
//
//   createWorld({ seed }) -> world
//
//   world.CHUNK                 24. World units on a side of one chunk.
//   world.spawn                 { x, z }. Where the ghost starts. (0, 0).
//   world.bounds                null. There are none. That is the point.
//
//   world.chunkAt(cx, cz)       build or fetch one chunk. Deterministic in
//                               (seed, cx, cz) and in nothing else.
//   world.ensureAround(x, z, r) build every chunk within r of (x, z).
//   world.release(x, z, r)      forget the ones beyond it.
//
//   world.barriers(box) -> [{ id, x0, z0, x1, z1, half, height, run, yaw }]
//   world.gates(box)    -> [{ id, barrier, x, z, dx, dz, half, sweep, clear,
//                             hinge, prop }]
//   world.props(box)    -> [{ id, kind, x, z, yaw, radius, height, solid,
//                             variant, foot }]
//   world.fireflies(box)-> [{ id, x, z }]
//   world.powerups(box) -> [{ id, x, z }]
//   world.graves(box)   -> [{ id, x, z, yaw }]
//   world.paths(box)    -> [{ id, points: [[x, z], ...], width }]
//
// A BARRIER is a straight fence segment. It blocks a skeleton and it does not
// block the ghost, who hops it. `half` is half its thickness in plan, 0.0775,
// which is half of a 0.155 post: the rules half assumed 0.10, which is a safe
// over estimate and nothing breaks if they keep it. `height` is 0.86, the
// fence's own post height, which is what the ghost's hop has to clear.
//
// A GATE IS A HOLE IN THE BARRIER LIST, NOT AN EXCEPTION TO IT. The segments
// either side of an opening stop at the opening's edges, so "does this move
// cross a fence" is a plain segment against segment test with no gate case in
// it anywhere. The gate record exists so a path finder can AIM at an opening
// and a renderer can build the leaf, and it is not needed to get the blocking
// right. `x, z` is the middle of the opening; `dx, dz` is a unit vector along
// the fence; `half` is half the clear opening, 1.0, so a disc of radius 0.60
// passes with 0.4 either side. `sweep` is the leaf's own keep-out disc about
// `hinge`, and `prop` is where to build the mesh, which is not the same point.
//
// FOUR THINGS ARE TRUE OF EVERY BARRIER SET THIS WORLD PUBLISHES, EVERYWHERE,
// AND THEY ARE TRUE BY CONSTRUCTION RATHER THAN BY INSPECTION. fence.js is
// where they are argued; the short form is:
//
//   1. every run has a gate;
//   2. no closed loop of segments is gateless, so there is no sealed pen for a
//      ghost to stand in for ever;
//   3. no two runs come within two units of each other, so the free ground is
//      one connected piece and a skeleton can always reach the ghost;
//   4. a gate is a gap and never an end, so an endpoint that no other segment
//      shares really is the end of a fence you can walk round.
//
// DENSITY FLOORS, true of EVERY box anywhere and not merely on average:
//
//   one grave in every 32 by 32     one per chunk, within 3.5 of its centre
//   one pellet in every 64 by 64    a 52 lattice with 5 of jitter
//   one firefly per 20 by 20 cell   see below
//
// AND THE CEILING THAT COMES WITH THE GRAVES. src/ghost/ground.js can only cut
// the floor MAX_GROUND_HOLES = 4 times and THROWS at the fifth. The geometry
// above guarantees AT MOST FOUR GRAVES WITHIN world.HOLE_RADIUS = 20 OF
// ANYWHERE, which is exactly the budget, and world.nearestGraves(x, z) hands
// them back nearest first. Cut holes for those and for nothing else: an endless
// world has no level to count holes over, so the budget is managed by distance
// or it is not managed at all.
//
// ============================================================================
// FIREFLIES
// ============================================================================
//
// One per 20 by 20 cell, pulled up to 4 units off the cell centre toward
// something worth walking to. That is roughly one per screen at the camera's
// view of 9.0, and it is a deliberate hundredfold cut from the old maze's one
// per unit of corridor: at one a metre the player grazes, at one a screen they
// have to choose a direction and commit, so where the next one is IS the level
// design. The pull order is
//
//   1. inside a fenced family plot, so the player must gate it or hop it;
//   2. beside a gate, so the player and the skeleton meet at a choke point;
//   3. the far side of a fence line, so the player meets a hop on the way;
//   4. on a path, so the trail reads as somewhere to walk;
//   5. the cell centre, in the open.
//
// and then off any prop it would be standing in. world-check.mjs measures the
// spacing that comes out of it, and how often the next one is on screen.
//
// ============================================================================
//
// Nothing in this package imports three or touches a canvas, with the single
// exception every file in src/game already makes: two published constants come
// off the props themselves rather than being written down twice.

import { createField, CHUNK, chunkOf, chunkBox, gridBoxOf, padBox, boxesOverlap,
  FLY_CELL, FLY_REACH, POWER_CELL, POWER_REACH, HOLE_RADIUS, MAX_NEAR_HOLES,
  PATH_HALF, START_CLEAR, GRAVE_BOX, rngAt } from './field.js';
import { createChunkStore, PROP_OVERHANG, discClearOfProps } from './chunk.js';
import { BARRIER_HEIGHT, FENCE_HALF, GATE_HALF, PANEL } from './fence.js';
import { footprintOf } from '../layout/footprints.js';

const FLY_CLEAR = 0.45;
const PELLET_CLEAR = footprintOf('pumpkin', 'classic').r + 0.25;

export function createWorld({ seed = 1 } = {}) {
  const field = createField(seed);
  const store = createChunkStore(field);
  const frame = field.frame;

  // --- which chunks a box touches --------------------------------------------
  function chunksIn(box, pad = 0) {
    const b = padBox(box, pad);
    const a = chunkOf(b.minX, b.minZ);
    const c = chunkOf(b.maxX, b.maxZ);
    const out = [];
    for (let cz = a.cz; cz <= c.cz; cz++) {
      for (let cx = a.cx; cx <= c.cx; cx++) out.push(store.chunkAt(cx, cz));
    }
    return out;
  }

  // --- paths, which are a field and not chunk content -------------------------
  //
  // A path is a curve you can evaluate anywhere, so it is never built, stored
  // or streamed: ask for the piece that crosses a box and it is sampled on the
  // spot. That is also why there is never a seam in one.
  const PATH_STEP = 1.5;
  function paths(box) {
    const g = gridBoxOf(frame, padBox(box, 3));
    const out = [];
    for (const k of field.uPathsNear((g.minU + g.maxU) / 2, (g.maxU - g.minU) / 2 + 3)) {
      const points = [];
      for (let v = Math.floor(g.minV / PATH_STEP) * PATH_STEP; v <= g.maxV + PATH_STEP; v += PATH_STEP) {
        const w = frame.toWorld(field.uPathAt(k, v), v);
        points.push([w.x, w.z]);
      }
      if (points.length > 1) out.push({ id: `path/u/${k}`, family: 'u', k, points, width: PATH_HALF * 2 });
    }
    for (const m of field.vPathsNear((g.minV + g.maxV) / 2, (g.maxV - g.minV) / 2 + 3)) {
      const points = [];
      for (let u = Math.floor(g.minU / PATH_STEP) * PATH_STEP; u <= g.maxU + PATH_STEP; u += PATH_STEP) {
        const w = frame.toWorld(u, field.vPathAt(m, u));
        points.push([w.x, w.z]);
      }
      if (points.length > 1) out.push({ id: `path/v/${m}`, family: 'v', k: m, points, width: PATH_HALF * 2 });
    }
    return out;
  }

  // --- fireflies --------------------------------------------------------------
  const flyCache = new Map();
  function flyAt(fx, fz) {
    const k = fx + ',' + fz;
    let got = flyCache.get(k);
    if (got !== undefined) return got;
    const cxw = (fx + 0.5) * FLY_CELL;
    const czw = (fz + 0.5) * FLY_CELL;
    const centre = frame.toGrid(cxw, czw);
    const rng = rngAt(seed, 'fly', fx, fz);

    // Everything the cell could be pulled toward, gathered from the chunks the
    // cell overlaps. A cell is 18 and a chunk 24, so that is at most four.
    const near = chunksIn({ minX: cxw - FLY_REACH, maxX: cxw + FLY_REACH, minZ: czw - FLY_REACH, maxZ: czw + FLY_REACH });

    let pick = null;
    // 1: inside a family plot.
    for (const chunk of near) {
      for (const run of chunk.runs) {
        if (!run.interior || pick) continue;
        const inner = run.interior;
        const hu = Math.max(0, inner.halfU - 0.7);
        const hv = Math.max(0, inner.halfV - 0.7);
        const u = Math.max(inner.u - hu, Math.min(inner.u + hu, centre.u));
        const v = Math.max(inner.v - hv, Math.min(inner.v + hv, centre.v));
        if (Math.hypot(u - centre.u, v - centre.v) <= FLY_REACH) pick = { u, v, why: 'plot' };
      }
    }
    // 2: beside a boundary gate.
    if (!pick) {
      for (const chunk of near) {
        for (const gate of chunk.gates) {
          if (pick) break;
          const g = frame.toGrid(gate.x, gate.z);
          const along = frame.toGrid(gate.dx, gate.dz);
          const side = rng.chance(0.5) ? 1 : -1;
          // The opening's normal in grid, which is the along vector turned a
          // quarter turn.
          const u = g.u + -along.v * 3.2 * side;
          const v = g.v + along.u * 3.2 * side;
          if (Math.hypot(u - centre.u, v - centre.v) <= FLY_REACH) pick = { u, v, why: 'gate' };
        }
      }
    }
    // 3: the far side of a fence line, so the player meets it on the way.
    if (!pick) {
      let best = null;
      for (const chunk of near) {
        for (const s of chunk.barriers) {
          const c = closestOnSegment(cxw, czw, s.x0, s.z0, s.x1, s.z1);
          if (c.d < 0.5 || c.d > FLY_REACH) continue;
          if (!best || c.d < best.d) best = c;
        }
      }
      if (best) {
        // Away from the cell centre, so whoever comes for it has the fence in
        // the way from the side the cell drew them in on.
        const nx = (best.x - cxw) / best.d;
        const nz = (best.z - czw) / best.d;
        const x = best.x + nx * 2.6;
        const z = best.z + nz * 2.6;
        const g = frame.toGrid(x, z);
        if (Math.hypot(x - cxw, z - czw) <= FLY_REACH + 2.6) pick = { u: g.u, v: g.v, why: 'fence' };
      }
    }
    // 4: on a path.
    if (!pick) {
      const p = field.nearestPath(centre.u, centre.v, FLY_REACH + 1);
      if (p.dist <= FLY_REACH) pick = { u: p.u, v: p.v, why: 'path' };
    }
    // 5: the open ground of the cell itself.
    if (!pick) {
      pick = {
        u: centre.u + rng.float(-2.5, 2.5),
        v: centre.v + rng.float(-2.5, 2.5),
        why: 'open',
      };
    }

    // The fence rule is allowed to reach a little further than the others,
    // because 2.6 of it is spent stepping over the line rather than wandering.
    const reach = pick.why === 'fence' ? FLY_REACH + 2.6 : FLY_REACH;
    const spot = nudge(pick, centre, reach, FLY_CLEAR);
    const w = frame.toWorld(spot.u, spot.v);
    got = { id: `fly/${fx},${fz}`, x: w.x, z: w.z, why: pick.why };
    flyCache.set(k, got);
    return got;
  }

  // Off any prop it would be standing in, and out of any gate's sweep, without
  // leaving the cell it belongs to.
  function nudge(pick, centre, reach, clear) {
    const tries = [{ du: 0, dv: 0 }];
    for (const r of [0.7, 1.4, 2.1, 2.8]) {
      for (let a = 0; a < 8; a++) {
        tries.push({ du: Math.cos((a * Math.PI) / 4) * r, dv: Math.sin((a * Math.PI) / 4) * r });
      }
    }
    for (const t of tries) {
      const u = pick.u + t.du;
      const v = pick.v + t.dv;
      if (Math.hypot(u - centre.u, v - centre.v) > reach) continue;
      const w = frame.toWorld(u, v);
      const home = chunkOf(w.x, w.z);
      const chunk = store.chunkAt(home.cx, home.cz);
      if (!discClearOfProps(chunk.props, w.x, w.z, clear, field)) continue;
      let inSweep = false;
      for (const ch of chunksIn({ minX: w.x - 3, maxX: w.x + 3, minZ: w.z - 3, maxZ: w.z + 3 })) {
        for (const g of ch.gates) {
          if (Math.hypot(w.x - g.sweep.x, w.z - g.sweep.z) < g.sweep.r + 0.15) inSweep = true;
        }
      }
      if (inSweep) continue;
      return { u, v };
    }
    return pick;
  }

  function fireflies(box) {
    const out = [];
    const f0 = Math.floor(box.minX / FLY_CELL) - 1;
    const f1 = Math.floor(box.maxX / FLY_CELL) + 1;
    const g0 = Math.floor(box.minZ / FLY_CELL) - 1;
    const g1 = Math.floor(box.maxZ / FLY_CELL) + 1;
    for (let fz = g0; fz <= g1; fz++) {
      for (let fx = f0; fx <= f1; fx++) {
        const f = flyAt(fx, fz);
        if (f && f.x >= box.minX && f.x <= box.maxX && f.z >= box.minZ && f.z <= box.maxZ) out.push(f);
      }
    }
    return out;
  }

  // --- power pellets ----------------------------------------------------------
  const pelletCache = new Map();
  function pelletAt(px, pz) {
    const k = px + ',' + pz;
    let got = pelletCache.get(k);
    if (got !== undefined) return got;
    const cxw = (px + 0.5) * POWER_CELL;
    const czw = (pz + 0.5) * POWER_CELL;
    const centre = frame.toGrid(cxw, czw);
    // A pellet belongs at a crossroads if there is one within reach, because a
    // crossroads is the one landmark this world has, and on a path otherwise.
    let pick = null;
    for (const k2 of field.uPathsNear(centre.u, POWER_REACH + 2)) {
      for (const m of field.vPathsNear(centre.v, POWER_REACH + 2)) {
        const c = field.crossing(k2, m);
        if (Math.hypot(c.u - centre.u, c.v - centre.v) <= POWER_REACH) pick = { u: c.u, v: c.v, why: 'cross' };
      }
    }
    if (!pick) {
      const p = field.nearestPath(centre.u, centre.v, POWER_REACH + 1);
      pick = p.dist <= POWER_REACH ? { u: p.u, v: p.v, why: 'path' } : { u: centre.u, v: centre.v, why: 'open' };
    }
    const spot = nudge(pick, centre, POWER_REACH, PELLET_CLEAR);
    const w = frame.toWorld(spot.u, spot.v);
    got = {
      id: `jack/${px},${pz}`, kind: 'jack',
      x: w.x, z: w.z, yaw: frame.yawFor(0, -1),
      radius: footprintOf('pumpkin', 'classic').r, why: pick.why,
    };
    pelletCache.set(k, got);
    return got;
  }

  function powerups(box) {
    const out = [];
    const a0 = Math.floor(box.minX / POWER_CELL) - 1;
    const a1 = Math.floor(box.maxX / POWER_CELL) + 1;
    const b0 = Math.floor(box.minZ / POWER_CELL) - 1;
    const b1 = Math.floor(box.maxZ / POWER_CELL) + 1;
    for (let pz = b0; pz <= b1; pz++) {
      for (let px = a0; px <= a1; px++) {
        const p = pelletAt(px, pz);
        if (p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ) out.push(p);
      }
    }
    return out;
  }

  // --- the published queries ---------------------------------------------------
  const inBox = (box, x, z) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;

  function props(box) {
    const out = [];
    for (const chunk of chunksIn(box, PROP_OVERHANG)) {
      for (const p of chunk.props) {
        if (p.x + p.radius < box.minX || p.x - p.radius > box.maxX) continue;
        if (p.z + p.radius < box.minZ || p.z - p.radius > box.maxZ) continue;
        out.push(p);
      }
    }
    return out;
  }

  function barriers(box) {
    const out = [];
    for (const chunk of chunksIn(box, 1)) {
      for (const s of chunk.barriers) if (boxesOverlap(s.box, box)) out.push(s);
    }
    return out;
  }

  function gates(box) {
    const out = [];
    for (const chunk of chunksIn(box, 1)) {
      for (const g of chunk.gates) if (boxesOverlap(g.box, box)) out.push(g);
    }
    return out;
  }

  function graves(box) {
    const out = [];
    for (const chunk of chunksIn(box, PROP_OVERHANG)) {
      for (const g of chunk.graves) if (inBox(box, g.x, g.z)) out.push(g);
    }
    return out;
  }

  // The graves whose holes the floor may cut, nearest first and never more than
  // the floor allows. This is the whole of the hole budget in an endless world.
  function nearestGraves(x, z, n = MAX_NEAR_HOLES, radius = HOLE_RADIUS) {
    const found = graves({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius })
      .map((g) => ({ g, d: Math.hypot(g.x - x, g.z - z) }))
      .filter((e) => e.d <= radius)
      .sort((a, b) => a.d - b.d);
    return found.slice(0, n).map((e) => e.g);
  }

  // Does this move cross a fence? One segment test per barrier in the box the
  // move sweeps, and no gate case, because a gate is already a gap.
  function blocks(x0, z0, x1, z1) {
    const box = {
      minX: Math.min(x0, x1) - 0.2, maxX: Math.max(x0, x1) + 0.2,
      minZ: Math.min(z0, z1) - 0.2, maxZ: Math.max(z0, z1) + 0.2,
    };
    for (const s of barriers(box)) {
      if (segmentsCross(x0, z0, x1, z1, s.x0, s.z0, s.x1, s.z1)) return s;
    }
    return null;
  }

  // --- streaming ----------------------------------------------------------------
  function ensureAround(x, z, r) {
    const a = chunkOf(x - r, z - r);
    const b = chunkOf(x + r, z + r);
    const made = [];
    for (let cz = a.cz; cz <= b.cz; cz++) {
      for (let cx = a.cx; cx <= b.cx; cx++) {
        const box = chunkBox(cx, cz);
        const dx = Math.max(box.minX - x, 0, x - box.maxX);
        const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
        if (Math.hypot(dx, dz) > r) continue;
        if (!store.has(cx, cz)) made.push(store.chunkAt(cx, cz));
        else store.chunkAt(cx, cz);
      }
    }
    return made;
  }

  function release(x, z, r) {
    let dropped = 0;
    for (const key of store.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      const box = chunkBox(cx, cz);
      const dx = Math.max(box.minX - x, 0, x - box.maxX);
      const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
      if (Math.hypot(dx, dz) <= r) continue;
      store.forget(cx, cz);
      dropped++;
    }
    // The lattice layers are keyed by cell, not by chunk, and they hold nothing
    // but a point each, but an endless walk still has to be able to let them go.
    if (dropped) {
      for (const [key, f] of flyCache) {
        if (Math.hypot(f.x - x, f.z - z) > r + FLY_CELL) flyCache.delete(key);
      }
      for (const [key, p] of pelletCache) {
        if (Math.hypot(p.x - x, p.z - z) > r + POWER_CELL) pelletCache.delete(key);
      }
    }
    return dropped;
  }

  return {
    seed,
    field,
    frame,
    CHUNK,
    HOLE_RADIUS,
    MAX_NEAR_HOLES,
    GRAVE_BOX,
    BARRIER_HEIGHT,
    BARRIER_HALF: FENCE_HALF,
    GATE_HALF,
    PANEL,
    PATH_HALF,
    FLY_CELL,
    POWER_CELL,
    START_CLEAR,
    // There are none. That is the point.
    bounds: null,
    spawn: { x: 0, z: 0 },

    chunkAt: store.chunkAt,
    ensureAround,
    release,
    loaded: store.counts,

    barriers,
    gates,
    props,
    fireflies,
    powerups,
    graves,
    paths,
    nearestGraves,
    blocks,

    // For the checker and the plotter, which want the layers rather than the
    // published view.
    _store: store,
    _flyAt: flyAt,
    _pelletAt: pelletAt,
  };
}

export function closestOnSegment(px, pz, x0, z0, x1, z1) {
  const ex = x1 - x0;
  const ez = z1 - z0;
  const l2 = ex * ex + ez * ez;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x0) * ex + (pz - z0) * ez) / l2)) : 0;
  const x = x0 + ex * t;
  const z = z0 + ez * t;
  return { x, z, t, d: Math.hypot(px - x, pz - z) };
}

// Standard segment intersection, written out because this package imports
// nothing that has one.
export function segmentsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = cross(cx, cz, dx, dz, ax, az);
  const d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz);
  const d4 = cross(ax, az, bx, bz, dx, dz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}
function cross(ax, az, bx, bz, px, pz) {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}

export { CHUNK } from './field.js';
export default createWorld;
