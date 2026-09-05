// WHERE THE FIREFLIES GO, IN A HAND-MADE LEVEL. Nobody places these.
//
// The owner was explicit: "firefly placement will have to be automated as this
// depends how far the user goes". So a level file carries the RULE and never a
// position, and this is the rule. It runs at load, over the level as authored,
// and it is a pure function of the level and its seed: open the same file twice
// and the fireflies are in the same five places.
//
// ============================================================================
// FIVE, AT ABOUT TWENTY UNITS APART, AND WHY THOSE ARE THE SAME DECISION
// ============================================================================
//
// The owner asked to have to cross the screen for the next one. At the game
// camera the frame shows about 22 units across by 37 deep, so that means a
// nearest-neighbour distance somewhere between 15 and 25, and in a 30 by 30
// arena that is not a preference, it is a budget. Measured over 40 arenas with
// points placed for distance alone, which is the CEILING rather than a result:
//
//     3 to 5 fireflies   19.8 mean, 19.7 min
//     6                  15.9 / 14.0
//     7                  14.8 / 14.0
//     8                  13.9 / 13.6
//     9                  13.8 / 13.6
//
// Nine cannot be more than 14 apart on a perfect lattice and come out near 11
// once they also avoid props and fences, so the ask is only reachable at five.
// The owner took five deliberately, knowing each one becomes a real journey.
//
// TWO THINGS THAT FOLLOW, and they are consequences to build for rather than
// bugs to fix. At 20 units the next firefly is off screen most of the time;
// that is the renderer's problem to solve with an indicator and NOT a reason to
// tighten the spacing, because the spacing is the point. And a level pays out
// less and ends sooner, which is the rules half's numbers to reprice.
//
// ============================================================================
// HOW THEY ARE PLACED
// ============================================================================
//
// Five points at 20 units apart in a 30 by 30 arena is a packing problem and
// not a lattice: a 3 by 3 grid gives nine, a 2 by 2 gives four in the corners,
// and neither is five. So the placement is FARTHEST POINT SAMPLING, which is
// what "placed for distance alone" means and is what produced the table above.
// Candidates are a one unit lattice over the arena, plus the places the
// generator's own ranking liked -- beside a gate, on a path -- and each round
// takes the candidate whose nearest already-placed firefly is furthest away.
//
// Every candidate has first to survive the same hard tests the generator
// applies, because these are what make a firefly collectable rather than
// decorative: clear of every solid prop and every barrier at a BODY's radius,
// inside the arena with a margin, and off the ghost's own starting patch.
//
// A level too full to hold five yields fewer rather than putting one in a wall.
// The editor reports the shortfall, which is the honest thing to do: five asked
// for and four placed means the arena has no fifth place to stand.

export const DEFAULT_FLY_RULE = {
  count: 5,        // the owner's number
  // A FLOOR, NOT A TARGET. The sampler maximises the spacing on its own; this
  // only stops it putting a fifth firefly on top of a fourth in an arena with
  // nowhere left to stand. Set it at the target of 20 and the fifth is vetoed
  // in almost every level, because the ghost's own clearing sits in the middle
  // of the square and the middle is exactly where the fifth point wants to be.
  gap: 12,
  // 1.5, not 4. The measured 19.8 mean came from points placed across
  // essentially the whole arena: 0.7071 is the optimal five-point spacing in a
  // unit square, so 28 units of usable width is 19.8 and 22 is 15.6. The hard
  // tests below already keep a firefly a body's width off the wall, so the
  // inset is only there to stop one hugging the coping.
  edge: 1.5,
  clear: 0.45,     // a firefly's own radius, for the keep-out tests
  body: 0.62,      // and the radius a player needs to stand next to one
  reach: 3.2,      // how far a candidate may be pulled toward a gate or a path
  spawnClear: 3.2, // the ghost's own patch of ground, kept empty
  seed: 1,
};

function hash(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return (h >>> 0) / 4294967296;
}

function pointSegD(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const ll = dx * dx + dz * dz;
  let t = ll > 1e-12 ? ((px - x0) * dx + (pz - z0) * dz) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}

// Everything a candidate has to survive, cheapest test first.
function makeTest({ box, barriers, gates, props, spawn, rule }) {
  const margin = 1.2;
  const solid = props.filter((p) => p.solid);
  return (x, z) => {
    if (x < box.minX + margin || x > box.maxX - margin) return false;
    if (z < box.minZ + margin || z > box.maxZ - margin) return false;
    if (Math.hypot(x - spawn.x, z - spawn.z) < rule.spawnClear) return false;
    for (const p of solid) {
      // A BODY's clearance, not the firefly's own. A firefly the player cannot
      // stand next to is a firefly nobody collects.
      if (Math.hypot(x - p.x, z - p.z) < Math.max(rule.clear, rule.body) + p.radius) return false;
    }
    for (const g of gates) {
      if (Math.hypot(x - g.sweep.x, z - g.sweep.z) < g.sweep.r + 0.15) return false;
    }
    for (const b of barriers) {
      if (pointSegD(x, z, b.x0, b.z0, b.x1, b.z1) < rule.body + b.half) return false;
    }
    return true;
  };
}

// The places worth standing, before any of them are chosen. A one unit lattice
// covers the arena, and the two the generator's own ranking preferred are added
// on top so that a spot beside a gate wins a tie against open ground.
function candidates({ box, gates, paths, rule, ok }) {
  const out = [];
  const push = (x, z, bonus) => { if (ok(x, z)) out.push({ x, z, bonus }); };
  for (let z = box.minZ + rule.edge; z <= box.maxZ - rule.edge + 1e-9; z += 1.0) {
    for (let x = box.minX + rule.edge; x <= box.maxX - rule.edge + 1e-9; x += 1.0) push(x, z, 0);
  }
  for (const g of gates) {
    for (const side of [1, -1]) push(g.x + g.nx * 3.0 * side, g.z + g.nz * 3.0 * side, 1.5);
  }
  for (const p of paths) {
    for (let i = 0; i + 1 < p.points.length; i++) {
      const [x0, z0] = p.points[i];
      const [x1, z1] = p.points[i + 1];
      for (const t of [0.25, 0.5, 0.75]) push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.8);
    }
  }
  return out;
}

export function placeFireflies({
  box, barriers = [], gates = [], props = [], paths = [], spawn = { x: 0, z: 0 }, rule = {},
}) {
  const r = { ...DEFAULT_FLY_RULE, ...rule };
  const want = Math.max(1, Math.round(r.count));
  const ok = makeTest({ box, barriers, gates, props, spawn, rule: r });
  const pool = candidates({ box, gates, paths, rule: r, ok });
  const out = [];
  if (!pool.length) return { points: out, cells: want, missed: want, spacing: 0 };

  // The first one is the candidate furthest from where the ghost starts, so the
  // player's first firefly is a walk and not a step. Everything after it is
  // farthest point: the candidate whose nearest chosen neighbour is furthest.
  //
  // The spawn is the seed for the FIRST pick only. Leaving it in the minimum
  // afterwards makes it a permanent sixth point that nothing may approach, and
  // since it sits in the middle of the arena that is exactly where the fifth
  // firefly wants to go: it cost three units of spacing in every level before
  // it was taken out.
  const score = (c) => {
    let near = out.length ? Infinity : Math.hypot(c.x - spawn.x, c.z - spawn.z);
    for (const o of out) near = Math.min(near, Math.hypot(c.x - o.x, c.z - o.z));
    // The bonus breaks ties toward a gate or a path without ever overruling
    // distance: it is worth a unit and a half against a twenty unit spacing.
    return near + c.bonus + hash(r.seed, Math.round(c.x * 4), Math.round(c.z * 4)) * 0.2;
  };
  for (let i = 0; i < want; i++) {
    let best = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      const s = score(c);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (!best) break;
    // Below the floor there is nowhere left that is far enough from everything
    // already placed, and a sixth firefly on top of a fifth is worse than five.
    if (out.length && bestScore - best.bonus < r.gap) break;
    out.push({ id: `fly/${out.length}`, x: best.x, z: best.z, why: best.bonus > 1 ? 'gate' : best.bonus > 0 ? 'path' : 'open' });
  }

  let spacing = Infinity;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      spacing = Math.min(spacing, Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z));
    }
  }
  return {
    points: out,
    cells: want,
    missed: want - out.length,
    spacing: Number.isFinite(spacing) ? spacing : 0,
  };
}

export default placeFireflies;
