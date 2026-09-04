// Navigation, for both halves of the chase.
//
// The layout hands out two different descriptions of the same corridor and the
// rules need both, because the two characters move in different ways:
//
//   layout.corridor   the union of 2.0 squares on the lattice. This is what the
//                     GHOST moves in. It moves freely in the plane and is
//                     blocked by whatever is not corridor, so its collision is
//                     a disc against a union of axis-aligned squares, which is
//                     exact, cheap and never needs a navmesh.
//   layout.graph      nodes at the tile centres, 2.0 edges between them. This
//                     is what the SKELETONS move on. They never leave it.
//
// That asymmetry is the game, and it lives here: the ghost can stand anywhere
// the disc fits, including the inside of a corner, and a skeleton can only ever
// be at a point on an edge.
//
// Everything in this file works in GRID coordinates (u across the screen, v up
// it) rather than world ones, because the corridor is axis aligned there and is
// a field of diamonds in world space. `toWorld` and `toGrid` are the layout's
// own frame, so the rules never invent a second isometry.

import { makeFrame } from './layout/frame.js';

export const TILE = 2.0;
export const HALF = 1.0;

// The four directions, in Pac-Man's own tie-break order: up, left, down, right.
// A ghost with two equally good ways out of a junction takes the first of these
// that is legal, and that single rule is why its ghosts trace repeatable paths
// rather than dithering. Up is +v because v runs up the screen.
export const DIRS = [
  { du: 0, dv: 1 }, { du: -1, dv: 0 }, { du: 0, dv: -1 }, { du: 1, dv: 0 },
];

export function createNav(layout) {
  const frame = makeFrame(layout.grid.frame);
  const b = layout.grid.bounds;
  // grid.js puts tile (a, b) at U(a) = 2a - originU with bounds.minU one half
  // tile below the first centre, so the origin comes straight back out of the
  // published bounds and the rules never have to import the tile map.
  const originU = -b.minU - HALF;
  const originV = -b.minV - HALF;
  const tw = Math.round((b.maxU - b.minU) / TILE);
  const th = Math.round((b.maxV - b.minV) / TILE);

  const U = (a) => TILE * a - originU;
  const V = (bb) => TILE * bb - originV;
  const A = (u) => Math.round((u + originU) / TILE);
  const B = (v) => Math.round((v + originV) / TILE);

  const open = new Uint8Array(tw * th);
  for (const t of layout.corridor.tiles) {
    const a = A(t.u);
    const bb = B(t.v);
    if (a >= 0 && bb >= 0 && a < tw && bb < th) open[bb * tw + a] = 1;
  }
  // Outside the map is closed, which is exactly the level bounds: the tile
  // squares tile the bounds with nothing left over, so one test does both.
  const isOpen = (a, bb) => (a < 0 || bb < 0 || a >= tw || bb >= th ? 0 : open[bb * tw + a]);

  // --- the graph, in grid coordinates ---------------------------------------
  const nodes = layout.graph.nodes.map((n) => ({
    id: n.id,
    u: n.u, v: n.v,
    a: A(n.u), b: B(n.v),
    edges: n.edges.slice(),
  }));
  const nodeAt = new Int32Array(tw * th).fill(-1);
  for (const n of nodes) nodeAt[n.b * tw + n.a] = n.id;
  const junctions = nodes.filter((n) => n.edges.length >= 3).map((n) => n.id);

  // Which of DIRS each edge of each node leaves by, precomputed, so a junction
  // decision is four comparisons and no trigonometry.
  for (const n of nodes) {
    n.dirOf = n.edges.map((id) => {
      const m = nodes[id];
      return DIRS.findIndex((d) => d.du === Math.sign(m.a - n.a) && d.dv === Math.sign(m.b - n.b));
    });
  }

  // --- the ghost's collision -----------------------------------------------
  //
  // A disc against the union of closed squares. Push the disc out of every
  // square it overlaps, twice, which is enough because the squares are on a
  // lattice and a disc smaller than a tile can touch at most four of them.
  // Sliding falls out of it: the component of the move along a wall survives
  // the push and only the component into it is cancelled.
  function resolveDisc(u, v, r) {
    for (let iter = 0; iter < 3; iter++) {
      const a0 = A(u);
      const b0 = B(v);
      let moved = false;
      for (let bb = b0 - 1; bb <= b0 + 1; bb++) {
        for (let aa = a0 - 1; aa <= a0 + 1; aa++) {
          if (isOpen(aa, bb)) continue;
          const du = u - U(aa);
          const dv = v - V(bb);
          const qu = du < -HALF ? -HALF : du > HALF ? HALF : du;
          const qv = dv < -HALF ? -HALF : dv > HALF ? HALF : dv;
          const nu = du - qu;
          const nv = dv - qv;
          const d = Math.hypot(nu, nv);
          if (d > 1e-9) {
            if (d >= r) continue;
            const k = (r - d) / d;
            u += nu * k;
            v += nv * k;
          } else {
            // The centre is inside the square, which only happens after a
            // pathological dt. Leave by the nearest face.
            const pu = HALF - Math.abs(du);
            const pv = HALF - Math.abs(dv);
            if (pu <= pv) u = U(aa) + (du >= 0 ? 1 : -1) * (HALF + r);
            else v = V(bb) + (dv >= 0 ? 1 : -1) * (HALF + r);
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { u, v };
  }

  // Is a disc of radius r at (u, v) entirely inside the corridor? The soak's
  // "no ghost through a wall" assertion, and the same test the resolver drives.
  function discClear(u, v, r) {
    const a0 = A(u);
    const b0 = B(v);
    for (let bb = b0 - 1; bb <= b0 + 1; bb++) {
      for (let aa = a0 - 1; aa <= a0 + 1; aa++) {
        if (isOpen(aa, bb)) continue;
        const du = Math.max(Math.abs(u - U(aa)) - HALF, 0);
        const dv = Math.max(Math.abs(v - V(bb)) - HALF, 0);
        if (Math.hypot(du, dv) < r - 1e-6) return false;
      }
    }
    return true;
  }

  // A point on a corridor centreline at all? Used to assert that a skeleton
  // never leaves the graph.
  const onCorridor = (u, v, slack = 1e-6) => {
    const a = A(u);
    const bb = B(v);
    if (!isOpen(a, bb)) return false;
    return Math.abs(u - U(a)) <= HALF + slack && Math.abs(v - V(bb)) <= HALF + slack;
  };

  // --- distances ------------------------------------------------------------
  //
  // Hop counts over the graph, one breadth-first sweep per source, cached. 170
  // nodes means a sweep is a few microseconds and the whole table is 29k
  // entries, so the bot can ask for the true corridor distance to every firefly
  // on every decision rather than settling for the straight line.
  const bfsCache = new Map();
  const queue = new Int32Array(nodes.length);
  function distFrom(src) {
    let d = bfsCache.get(src);
    if (d) return d;
    d = new Int32Array(nodes.length).fill(-1);
    d[src] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = src;
    while (head < tail) {
      const n = queue[head++];
      for (const m of nodes[n].edges) {
        if (d[m] !== -1) continue;
        d[m] = d[n] + 1;
        queue[tail++] = m;
      }
    }
    bfsCache.set(src, d);
    return d;
  }

  // The node a free-moving point is standing on. The ghost is always inside a
  // corridor tile and every corridor tile is a node, so this is a lookup and
  // not a search; the scan is only a fallback for a point pushed a hair out by
  // floating point.
  function nodeNear(u, v) {
    const id = nodeAt[Math.min(th - 1, Math.max(0, B(v))) * tw + Math.min(tw - 1, Math.max(0, A(u)))];
    if (id !== -1) return id;
    let best = -1;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = (n.u - u) ** 2 + (n.v - v) ** 2;
      if (d < bestD) { bestD = d; best = n.id; }
    }
    return best;
  }

  return {
    frame, tw, th, U, V, A, B, isOpen,
    nodes, nodeAt, junctions,
    resolveDisc, discClear, onCorridor, distFrom, nodeNear,
    toGrid: (x, z) => frame.toGrid(x, z),
    toWorld: (u, v) => frame.toWorld(u, v),
    // Grid positions of everything the rules need to hit, converted once.
    fireflies: layout.fireflies.map((f) => frame.toGrid(f.x, f.z)),
    powerups: layout.powerups.map((p) => frame.toGrid(p.x, p.z)),
    graves: layout.spawns.graves.map((g) => frame.toGrid(g.x, g.z)),
    ghostSpawn: frame.toGrid(layout.spawns.ghost.x, layout.spawns.ghost.z),
    bounds: b,
  };
}

export default createNav;
