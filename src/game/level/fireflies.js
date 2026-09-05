// WHERE THE FIREFLIES GO, IN A HAND-MADE LEVEL. Nobody places these.
//
// The owner was explicit: "firefly placement will have to be automated as this
// depends how far the user goes". So a level file carries the RULE and never a
// position, and this is the rule. It runs at load, over the level as authored,
// and it is a pure function of the level and its seed: open the same file twice
// and the fireflies are in the same nine places.
//
// It is the generator's rule (src/game/world/index.js, `collectible`) reduced
// to what a hand-made level can answer. The generator ranks a cell's candidate
// by whether it lands inside a pen, beside a gate, past a fence or on a path,
// using the grid field the procedural level is built on. A hand-made level has
// no such field, so the ranking here is the part that survives without one:
//
//   1. beside a gate, where the player and a skeleton meet at a choke;
//   2. on a path, so the trail reads as somewhere worth walking;
//   3. the middle of the cell.
//
// and then the same three hard tests the generator applies, in the same order,
// because these are what make a firefly collectable rather than decorative:
// clear of every solid prop and every barrier, inside the arena with a margin,
// and no closer than `gap` to another one.
//
// A lattice cell that cannot be satisfied at all yields nothing rather than a
// firefly in a wall. The editor reports the shortfall, which is the honest
// thing to do: nine cells and eight fireflies means one corner of the level is
// too full to walk in, and that is a level note rather than a loader bug.

// The rule, with the generator's own numbers as the defaults. FLY_CELL 8 over a
// 30 unit arena inset 4 a side gives the 3 by 3 lattice and the nine fireflies
// the design settled on.
export const DEFAULT_FLY_RULE = {
  cell: 8,        // one firefly per cell of about this size
  edge: 4.0,      // how far the lattice keeps off the wall
  gap: 5.5,       // the least ground between two of them
  clear: 0.45,    // a firefly's own radius, for the keep-out tests
  reach: 3.2,     // how far one may be pulled toward a gate or a path
  spawnClear: 3.2, // the ghost's own patch of ground, kept empty
  seed: 1,
};

// A small deterministic stream, the same shape rng.js gives, kept local so this
// file is a pure function of its arguments and nothing else.
function hash(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return h >>> 0;
}
function stream(seedValue) {
  let a = seedValue >>> 0 || 1;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointSegD(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const ll = dx * dx + dz * dz;
  let t = ll > 1e-12 ? ((px - x0) * dx + (pz - z0) * dz) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}

// Everything a candidate has to survive. Order is cheapest first.
function makeTest({ box, barriers, gates, props, spawn, rule }) {
  const margin = 1.2;
  return (x, z, taken) => {
    if (x < box.minX + margin || x > box.maxX - margin) return false;
    if (z < box.minZ + margin || z > box.maxZ - margin) return false;
    if (Math.hypot(x - spawn.x, z - spawn.z) < rule.spawnClear) return false;
    for (const o of taken) if (Math.hypot(x - o.x, z - o.z) < rule.gap) return false;
    for (const p of props) {
      if (!p.solid) continue;
      // A BODY's clearance, not the firefly's own. The generator asks the same
      // question a different way (`walk.walkable(x, z, 1.0)`): a firefly the
      // player cannot stand next to is a firefly nobody collects.
      if (Math.hypot(x - p.x, z - p.z) < Math.max(rule.clear, 0.62) + p.radius) return false;
    }
    for (const g of gates) {
      if (Math.hypot(x - g.sweep.x, z - g.sweep.z) < g.sweep.r + 0.15) return false;
    }
    for (const b of barriers) {
      // A body has to be able to STAND on it, not merely a firefly to fit, or
      // the player watches one glow on the far side of a rail for ever.
      if (pointSegD(x, z, b.x0, b.z0, b.x1, b.z1) < 0.6 + b.half) return false;
    }
    return true;
  };
}

// The candidates for one lattice cell, best first.
function candidates(cx, cz, { gates, paths, rule, rand }) {
  const out = [];
  for (const g of gates) {
    for (const side of [1, -1]) {
      const x = g.x + g.nx * 3.0 * side;
      const z = g.z + g.nz * 3.0 * side;
      if (Math.hypot(x - cx, z - cz) <= rule.reach + 3.0) out.push({ x, z, why: 'gate' });
    }
  }
  for (const p of paths) {
    let best = null;
    for (let i = 0; i + 1 < p.points.length; i++) {
      const [x0, z0] = p.points[i];
      const [x1, z1] = p.points[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const ll = dx * dx + dz * dz;
      let t = ll > 1e-12 ? ((cx - x0) * dx + (cz - z0) * dz) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      const d = Math.hypot(x - cx, z - cz);
      if (!best || d < best.d) best = { x, z, d };
    }
    if (best && best.d <= rule.reach + 2.0) out.push({ x: best.x, z: best.z, why: 'path' });
  }
  out.push({ x: cx, z: cz, why: 'open' });
  // And then the ring search the generator calls `nudge`: the same point pushed
  // off whatever it is standing in, at eight compass points and four radii.
  const rings = [];
  for (const seed of out.slice()) {
    for (const r of [0.6, 1.2, 1.8, 2.4, 3.2]) {
      for (let a = 0; a < 8; a++) {
        const th = (a * Math.PI) / 4 + rand() * 0.3;
        rings.push({ x: seed.x + Math.cos(th) * r, z: seed.z + Math.sin(th) * r, why: seed.why });
      }
    }
  }
  return out.concat(rings);
}

// The whole rule. `level` is anything with the world's own shapes on it.
export function placeFireflies({
  box, barriers = [], gates = [], props = [], paths = [], spawn = { x: 0, z: 0 }, rule = {},
}) {
  const r = { ...DEFAULT_FLY_RULE, ...rule };
  const spanX = (box.maxX - box.minX) - 2 * r.edge;
  const spanZ = (box.maxZ - box.minZ) - 2 * r.edge;
  const nx = Math.max(1, Math.round(spanX / r.cell));
  const nz = Math.max(1, Math.round(spanZ / r.cell));
  const ok = makeTest({ box, barriers, gates, props, spawn, rule: r });
  const out = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = box.minX + r.edge + ((i + 0.5) * spanX) / nx;
      const cz = box.minZ + r.edge + ((j + 0.5) * spanZ) / nz;
      const rand = stream(hash(r.seed, 'fly', i, j));
      let placed = null;
      for (const c of candidates(cx, cz, { gates, paths, rule: r, rand })) {
        if (ok(c.x, c.z, out)) { placed = c; break; }
      }
      if (placed) out.push({ id: `fly/${i},${j}`, x: placed.x, z: placed.z, why: placed.why });
    }
  }
  return { points: out, cells: nx * nz, missed: nx * nz - out.length };
}

export default placeFireflies;
