// The overnight check for the RULES half, in an endless open world.
//
//   node src/game/soak.mjs                     everything, default sizes
//   node src/game/soak.mjs --fair 2000         fairness only, 2000 worlds
//   node src/game/soak.mjs --play 300          the careful bot on 300 runs
//   node src/game/soak.mjs --passive 300       the player who does not move
//   node src/game/soak.mjs --stability 40      NaN, fences, big dt
//   node src/game/soak.mjs --jump              the vault-versus-gate sweep
//   node src/game/soak.mjs --leg               the skeleton decision cadence
//   node src/game/soak.mjs --ghostsweep        the speed ratio
//   node src/game/soak.mjs --power             the lantern duration
//   node src/game/soak.mjs --schedule          the mode schedule controls
//   node src/game/soak.mjs --score             the leaderboard distribution
//
// ===========================================================================
// WHAT FAIRNESS MEANS NOW
// ===========================================================================
//
// The old soak asserted "one connected component over all corridor nodes",
// "no dead ends" and "2-edge-connectivity over the junction graph". All three
// were statements about a lattice and all three are meaningless in open ground,
// where the ground is one component almost by definition and a fence is a thing
// you walk round rather than a wall of a corridor. They are REPLACED, not
// deleted, by four properties that say the same kinds of thing about a world
// with barriers, gates and a ghost that can vault.
//
// Write G for the set of points the ghost can reach from its spawn USING
// JUMPS, and S for the set a skeleton can reach from a grave WITHOUT them.
// Both are computed by flood fill over the same occupancy raster the bot plans
// on, at 0.75 units, so a claim proved here is a claim about the geometry the
// characters actually move in, at that resolution and no finer.
//
//   F1  THE CHASE EXISTS. Every grave in the region lies in the same
//       jump-free component as the ghost's spawn. A skeleton that climbs out
//       inside a sealed pen can never reach the player and the game is not a
//       chase any more, it is a walk.
//
//   F2  THE GHOST IS NEVER SEALED IN. No bounded component that has no way out
//       at all, by gate or by vault, may contain the spawn, a firefly, a
//       lantern or a grave. Note the "at all": a region you can only leave by
//       jumping is FINE, because the ghost can jump; a region you can only
//       ENTER by jumping is what F3 is about; a region you can neither leave
//       nor enter is a hole in the world, and it fails here as soon as the game
//       asks anybody to go into it.
//
//   F3  NO PERMANENTLY SAFE SPOT, and this is the new one, the one that did not
//       exist when the maze constrained both sides equally, and the one most
//       likely to break the game. G must be a SUBSET of S. If the ghost can
//       reach a point no skeleton can, the player stands on it and wins for
//       ever, and they will find it long before we do. Concretely it is a pen
//       with fence all the way round and no gate: the ghost vaults in, and
//       nothing can ever follow.
//
//   F4  TWO WAYS OUT, which is what 2-edge-connectivity was for. Its old
//       justification was that a degree-2 corridor that is a bridge still
//       corners the player. Here the equivalent trap is a pen with one gate: a
//       skeleton stands in the gate and the player is finished. The reason that
//       is not a trap is THE JUMP, so the property is that every bounded
//       ghost-reachable region has at least two exits, counting each gate on
//       its boundary as one and any jumpable stretch of its fence as one. That
//       makes the jump load bearing for fairness rather than a bonus, and it
//       has teeth in exactly the case where a pen's fence cannot be vaulted
//       because the ground outside every wall of it is blocked.
//
// And four that carried over unchanged in spirit: the spawn admits the ghost's
// own disc, every firefly is within a pick radius of somewhere the ghost can
// stand, every grave admits the skeleton's disc, and every gate admits a disc
// of 0.60. The last of those is the world's own G5 guarantee, checked here on
// the thing that ships rather than trusted as a promise.
//
// Section 0 breaks the game once for each check and shows it firing, because a
// check that has never failed is a check nobody has a reason to believe. Three
// of those broken cases are not checks at all but RULES: that a jump does not
// confer invulnerability, that it needs a run-up, and that it is refused when
// the landing is blocked. Those are the three things holding the jump back from
// being a dodge, so they are proved rather than asserted in a comment.

import { createWorld, FLY_SPACING } from './refworld.mjs';
import { createGame, TUNING } from './rules.js';
import { createNav, WINDOW, SLACK } from './nav.js';
import { SKEL_RADIUS, DEFAULT_CHASE } from './chase.js';
import { createBot, passiveBot, recklessBot, vaultBot, groundBot } from './bot.js';

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const num = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 || !args[i + 1] || args[i + 1].startsWith('--') ? d : Number(args[i + 1]);
};
const SPACING = num('--spacing', FLY_SPACING);

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};
const quant = (a, q) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// A world over fixed arrays, for the self test. Same interface, no generator.
export function fixedWorld(w) {
  const all = (k) => () => w[k] || [];
  return {
    CHUNK: 24,
    spawn: w.spawn || { x: 0, z: 0 },
    barriers: all('barriers'),
    gates: all('gates'),
    props: all('props'),
    fireflies: all('fireflies'),
    powerups: all('powerups'),
    graves: all('graves'),
  };
}

// A rectangular pen of fence, `gates` many openings cut out of it. The self
// test's workhorse: a pen with no gate is F3's broken case and a pen with one
// gate and blocked ground outside is F4's.
export function pen(cx, cz, w, h, gates = 0) {
  const out = { barriers: [], gates: [] };
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - h / 2;
  const z1 = cz + h / 2;
  const sides = [
    [x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0],
  ];
  sides.forEach((s, i) => {
    if (i < gates) {
      // Cut a 2.0 opening out of the middle of this side.
      const mx = (s[0] + s[2]) / 2;
      const mz = (s[1] + s[3]) / 2;
      const dx = s[2] - s[0];
      const dz = s[3] - s[1];
      const il = 1 / Math.hypot(dx, dz);
      out.barriers.push({ id: `p${i}a`, x0: s[0], z0: s[1], x1: mx - dx * il, z1: mz - dz * il, half: 0.1, end0: 'joint', end1: 'gate' });
      out.barriers.push({ id: `p${i}b`, x0: mx + dx * il, z0: mz + dz * il, x1: s[2], z1: s[3], half: 0.1, end0: 'gate', end1: 'joint' });
      out.gates.push({ id: `g${i}`, barrier: `p${i}`, x: mx, z: mz, dx: dx * il, dz: dz * il, half: 1.0 });
    } else {
      out.barriers.push({ id: `p${i}`, x0: s[0], z0: s[1], x1: s[2], z1: s[3], half: 0.1, end0: 'joint', end1: 'joint' });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// 1. Fairness
// ---------------------------------------------------------------------------

// The raster is built over a region considerably LARGER than the one it
// judges, and the difference matters more than it looks. A fence run of up to
// 16 units near the edge of a judged region joins the rest of the world round
// its own end, and if that end falls outside the raster the flood cannot get
// there and the check reports the sampling window instead of the world. That
// was 2.7% of worlds failing F3 for no reason at all before the margin was
// widened. 44 minus 26 is 18 units of margin, longer than the longest fence.
const FAIR_HALF = 44;
const FAIR_JUDGE = 26;
const FAIR_CELL = 0.75;
// One radius for both floods. The skeleton needs 0.555 of clearance and the
// ghost 0.55, so the larger of the two is used for the raster and the ghost is
// treated as very slightly fatter than it is. That direction is the safe one:
// it can report a gap as impassable that is passable by four millimetres, and
// it can never report a wall as a gap.
const FAIR_RADIUS = Math.max(TUNING.ghostRadius, SKEL_RADIUS + 0.08);

// Flood over the raster. `jump` lets the fill cross fence edges, which is the
// only difference between the ghost's reachable set and a skeleton's. `plug`
// is a set of cells to treat as blocked, which is how F4 asks what a gate is
// holding together.
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
    // And the vaults, which are never a step to the adjacent cell: see the
    // jump table in nav.js for why.
    if (jump) {
      for (let a = 0; a < 4; a++) {
        const m = grid.jump[n * 4 + a];
        if (m >= 0 && !out[m] && !(plug && plug.has(m))) { out[m] = 1; q[tail++] = m; }
      }
    }
  }
  return out;
}

// Label the no-jump components, which is what "a region" means in F2 and F4.
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
        if (m < 0 || m >= N || grid.blocked[m] || label[m] !== -1) continue;
        if (grid.wall[n * 8 + d]) continue;
        label[m] = count;
        q[tail++] = m;
      }
    }
    count++;
  }
  return { label, count };
}

function fairOne(world, at) {
  const nav = createNav(world);
  nav.focus(at.x, at.z);
  const grid = nav.makeGrid({ x: at.x, z: at.z, half: FAIR_HALF, cell: FAIR_CELL, radius: FAIR_RADIUS });
  const N = grid.n * grid.n;
  const { label, count } = components(grid);
  const box = { minX: at.x - FAIR_JUDGE, minZ: at.z - FAIR_JUDGE, maxX: at.x + FAIR_JUDGE, maxZ: at.z + FAIR_JUDGE };
  const inBox = (p) => p.x > box.minX && p.x < box.maxX && p.z > box.minZ && p.z < box.maxZ;
  const fireflies = world.fireflies(box).filter(inBox);
  const powerups = world.powerups(box).filter(inBox);
  const graves = world.graves(box).filter(inBox);
  const gates = world.gates(box).filter(inBox);

  const fail = [];
  // The point the flood starts from stands in for the ghost. It is snapped to
  // the nearest cell the ghost fits in, because a SAMPLE point landing inside a
  // headstone says nothing about the world; whether the world's own spawn is
  // clear is a separate question and fairness() asks it separately.
  const spawnCell = grid.nearestOpen(at.x, at.z);
  if (spawnCell < 0) return ['spawn'];

  // Which components touch the box edge, and so continue into the world.
  const open = new Uint8Array(count);
  for (let i = 0; i < N; i++) {
    const a = i % grid.n;
    const b = (i / grid.n) | 0;
    if (a === 0 || b === 0 || a === grid.n - 1 || b === grid.n - 1) if (label[i] >= 0) open[label[i]] = 1;
  }

  // Exits per component: gates on its boundary, and jumpable stretches of fence.
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
    for (let a = 0; a < 4; a++) {
      const m = grid.jump[i * 4 + a];
      if (m >= 0 && label[m] >= 0 && label[m] !== li) vaultOut[li].add(label[m]);
    }
  }
  // Used by F2: a region with no exit of any kind. A region that touches the
  // edge of the sampled box continues into the endless world and counts as
  // open by construction.
  const exits = (c) => (open[c] ? 9 : gateOut[c].size + vaultOut[c].size);

  const ghostSet = new Uint8Array(N);
  flood(grid, [spawnCell], true, ghostSet);
  const graveCells = graves.map((g) => grid.nearestOpen(g.x, g.z)).filter((c) => c >= 0);
  const skelSet = new Uint8Array(N);
  flood(grid, graveCells, false, skelSet);

  // F1. Every grave is in the ghost's own walk component, so a skeleton that
  // climbs out of it can reach the player without a jump it cannot make.
  const spawnComp = label[spawnCell];
  for (const c of graveCells) if (label[c] !== spawnComp && !(open[label[c]] && open[spawnComp])) { fail.push('F1graveCut'); break; }

  // F2. No sealed pocket holds anything the game asks anybody to go to.
  const wanted = new Set();
  for (const p of [...fireflies, ...powerups, ...graves]) {
    const c = grid.nearestOpen(p.x, p.z);
    if (c >= 0) wanted.add(label[c]);
  }
  wanted.add(spawnComp);
  for (const c of wanted) if (c >= 0 && exits(c) === 0) { fail.push('F2sealed'); break; }

  // F3. THE SAFE SPOT. Everything the ghost can reach, a skeleton can reach.
  //
  // Judged on the JUDGED region, which is the raster's middle. See FAIR_HALF.
  let leak = 0;
  for (let i = 0; i < N; i++) {
    if (!ghostSet[i] || skelSet[i]) continue;
    if (Math.abs(grid.wx(i) - at.x) > FAIR_JUDGE || Math.abs(grid.wz(i) - at.z) > FAIR_JUDGE) continue;
    leak++;
  }
  // A few cells is rasterisation at a gate's lip; a pocket is tens of them.
  if (leak > 6) fail.push('F3safeSpot');

  // F4. NO GATE IS THE ONLY WAY OUT. Stated as the question a skeleton standing
  // in a gate asks: plug it, and does anywhere the ghost could reach become
  // unreachable? A pen with one gate passes only because the ghost can vault
  // the fence, which is what makes the jump load bearing for FAIRNESS rather
  // than only for play. It fails exactly when the pen's fence cannot be
  // vaulted, which is what the self test builds.
  const plugged = new Uint8Array(N);
  for (const g of gates) {
    // Only gates in the judged middle; a gate at the raster's edge has half its
    // neighbourhood missing.
    const plug = new Set();
    const rr = g.half + FAIR_RADIUS;
    const c0 = grid.index(g.x, g.z);
    if (c0 < 0) continue;
    const span = Math.ceil(rr / FAIR_CELL);
    const a0 = c0 % grid.n;
    const b0 = (c0 / grid.n) | 0;
    for (let b = b0 - span; b <= b0 + span; b++) {
      for (let a = a0 - span; a <= a0 + span; a++) {
        if (a < 0 || b < 0 || a >= grid.n || b >= grid.n) continue;
        const i = b * grid.n + a;
        if (Math.hypot(grid.wx(i) - g.x, grid.wz(i) - g.z) <= rr) plug.add(i);
      }
    }
    flood(grid, [spawnCell], true, plugged, plug);
    let lost = 0;
    for (let i = 0; i < N; i++) {
      if (!ghostSet[i] || plugged[i] || plug.has(i)) continue;
      if (Math.abs(grid.wx(i) - at.x) > FAIR_JUDGE || Math.abs(grid.wz(i) - at.z) > FAIR_JUDGE) continue;
      lost++;
    }
    // A handful of cells at the plug's own lip is rasterisation, not a trap.
    if (lost > 4) { fail.push('F4pin'); break; }
  }

  // Carried over.
  for (const f of fireflies) {
    const c = grid.nearestOpen(f.x, f.z);
    if (c < 0 || !ghostSet[c] || Math.hypot(grid.wx(c) - f.x, grid.wz(c) - f.z) > TUNING.pickRadius) { fail.push('flyReach'); break; }
  }
  for (const g of graves) if (!nav.discClear(g.x, g.z, SKEL_RADIUS)) { fail.push('graveClear'); break; }
  // Not only the opening: the CORRIDOR through it, two units either side. A
  // gate a body cannot approach is not a gate, and a prop just outside the
  // mouth is exactly how that happens.
  for (const g of gates) {
    let plugged = false;
    for (let t = -2.0; t <= 2.0 + 1e-9; t += 0.5) {
      if (!nav.discClear(g.x - g.dz * t, g.z + g.dx * t, 0.60)) { plugged = true; break; }
    }
    if (plugged) { fail.push('gateWide'); break; }
  }

  return fail;
}

function fairness(seeds) {
  const keys = ['spawn', 'F1graveCut', 'F2sealed', 'F3safeSpot', 'F4pin', 'flyReach', 'graveClear', 'gateWide'];
  const fail = Object.fromEntries(keys.map((k) => [k, []]));
  let barriers = 0;
  let gates = 0;
  let flies = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const world = createWorld({ seed, spacing: SPACING });
    // Look somewhere different in each world rather than always at the spawn,
    // so a thousand seeds is a thousand different neighbourhoods and not a
    // thousand looks at the same one.
    const at = { x: ((seed * 37) % 400) - 200, z: ((seed * 91) % 400) - 200 };
    const box = { minX: at.x - FAIR_JUDGE, minZ: at.z - FAIR_JUDGE, maxX: at.x + FAIR_JUDGE, maxZ: at.z + FAIR_JUDGE };
    barriers += world.barriers(box).length;
    gates += world.gates(box).length;
    flies += world.fireflies(box).length;
    // The world's own spawn, checked where it actually is.
    const spawnNav = createNav(world);
    spawnNav.focus(world.spawn.x, world.spawn.z);
    if (!spawnNav.discClear(world.spawn.x, world.spawn.z, TUNING.ghostRadius)) fail.spawn.push(seed);
    for (const f of fairOne(world, at)) if (f !== 'spawn') fail[f].push(seed);
  }
  const area = ((FAIR_JUDGE * 2) ** 2) / 1e4;
  console.log(`\n--- 1. FAIRNESS, ${seeds} worlds, ${FAIR_JUDGE * 2} by ${FAIR_JUDGE * 2} judged inside a ${FAIR_HALF * 2} raster at ${FAIR_CELL}, ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
  console.log(`  per ${FAIR_JUDGE * 2} by ${FAIR_JUDGE * 2} region: ${(barriers / seeds).toFixed(1)} fence segments, ${(gates / seeds).toFixed(1)} gates, ${(flies / seeds).toFixed(1)} fireflies`
    + `  (${(flies / seeds / area / 100).toFixed(2)} fireflies per 100 sq units)`);
  for (const k of keys) {
    console.log(`  ${k.padEnd(12)} ${String(fail[k].length).padStart(5)} failed  ${pct(fail[k].length, seeds).padStart(7)}   ${fail[k].slice(0, 6).join(' ')}`);
  }
  return fail;
}

// ---------------------------------------------------------------------------
// 2 and 3. Survival and lethality
// ---------------------------------------------------------------------------
//
// Nothing clears any more, so "clear rate" is gone and the headline is HOW LONG
// A RUN LASTS and what it scores while it lasts. A run ends when the third life
// goes, or when the limit is hit, and a run that hits the limit is reported
// separately rather than folded in, because "survived 300 seconds" and "was
// still alive at 300 seconds" are different claims.

function playOne(seed, { botFactory, dt = 1 / 60, limit = 300, tuning, skeletons = 4 }) {
  const world = createWorld({ seed, spacing: SPACING });
  const game = createGame({ world, seed, tuning, skeletons });
  const bot = botFactory(game);
  let s = game.state;
  let steps = 0;
  let firstDeath = -1;
  let deaths = 0;
  let eats = 0;
  let powers = 0;
  let jumps = 0;
  let vaults = 0;
  let refused = 0;
  const maxSteps = Math.ceil(limit / dt);
  let bad = null;
  while (steps < maxSteps && s.phase !== 'over') {
    const input = bot.step(s, dt);
    s = game.update(dt, input);
    for (const e of s.events) {
      if (e.type === 'death') { deaths++; if (firstDeath < 0) firstDeath = s.time; }
      if (e.type === 'eat') eats++;
      if (e.type === 'power') powers++;
      if (e.type === 'jump') { jumps++; if (e.overFence) vaults++; }
      if (e.type === 'jumpRefused') refused++;
    }
    if (!bad) bad = check(game, s);
    steps++;
  }
  return {
    seed, phase: s.phase, time: s.time, score: s.score, lives: s.lives,
    collected: s.collected, bestStreak: s.bestStreak, distance: s.distance,
    deaths, eats, powers, jumps, vaults, refused, firstDeath, bad,
    threat: bot.stats.threatTime, panic: bot.stats.panicTime,
    plannedVaults: bot.stats.plannedVaults || 0,
    survived: steps >= maxSteps,
  };
}

// Run on every frame of every run the soak plays, not only in the stability
// section: a NaN that only appears once in a thousand runs is exactly the one
// that will appear in the demo.
function check(game, s) {
  const nav = game.nav;
  const g = game.debug.ghost;
  if (!Number.isFinite(g.x) || !Number.isFinite(g.z) || !Number.isFinite(s.score)) return 'nan-ghost';
  // Grounded, the ghost is clear of everything. Airborne, it is allowed inside
  // a fence and nothing else, which is the whole rule and is worth asserting in
  // exactly that shape.
  if (!nav.discClear(g.x, g.z, game.tuning.ghostRadius, g.air)) return g.air ? 'ghost-in-prop-airborne' : 'ghost-in-fence';
  for (const k of s.skeletons) {
    if (!Number.isFinite(k.x) || !Number.isFinite(k.z)) return 'nan-skeleton';
    // A skeleton is allowed to be somewhere a walker could not be for exactly
    // two reasons: it is in its grave and part way out of it, or it has been
    // eaten and is a heap of bones going home over the fences by design.
    if (k.state === 'buried' || k.state === 'emerging' || k.state === 'sinking' || k.state === 'eaten') continue;
    if (!nav.discClear(k.x, k.z, SKEL_RADIUS * 0.9)) return 'skeleton-in-fence';
    // The window relation nav.js's comment promises: nothing the rules steer
    // may be further from the ghost than the window minus its slack, or it is
    // navigating against geometry that was never loaded.
    if (Math.hypot(k.x - g.x, k.z - g.z) > WINDOW - SLACK) return 'actor-outside-window';
  }
  return null;
}

function playMany(seeds, opts, title) {
  const t0 = Date.now();
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, opts));
  const over = rows.filter((r) => r.phase === 'over');
  const alive = rows.filter((r) => r.survived);
  const bad = rows.filter((r) => r.bad);
  const times = rows.map((r) => r.time);
  console.log(`\n--- ${title}, ${seeds} runs, limit ${opts.limit}s, ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
  console.log(`  lost all lives ${String(over.length).padStart(4)}  ${pct(over.length, seeds)}     still alive at the limit ${alive.length}  ${pct(alive.length, seeds)}`);
  console.log(`  run length     mean ${mean(times).toFixed(0)}s  median ${median(times).toFixed(0)}s  p10 ${quant(times, 0.1).toFixed(0)}s  p90 ${quant(times, 0.9).toFixed(0)}s`);
  console.log(`  score          mean ${mean(rows.map((r) => r.score)).toFixed(0)}  median ${median(rows.map((r) => r.score)).toFixed(0)}  best ${Math.max(...rows.map((r) => r.score))}`);
  console.log(`  fireflies      mean ${mean(rows.map((r) => r.collected)).toFixed(1)} a run, ${(mean(rows.map((r) => r.collected)) / (mean(times) / 60)).toFixed(1)} a minute, best streak ${mean(rows.map((r) => r.bestStreak)).toFixed(1)}`);
  console.log(`  deaths         mean ${mean(rows.map((r) => r.deaths)).toFixed(2)}   first death median ${median(rows.filter((r) => r.firstDeath > 0).map((r) => r.firstDeath)).toFixed(0)}s`);
  console.log(`  lanterns       ${mean(rows.map((r) => r.powers)).toFixed(2)} lit, ${mean(rows.map((r) => r.eats)).toFixed(2)} skeletons eaten, ${(mean(rows.map((r) => r.eats)) / Math.max(0.01, mean(rows.map((r) => r.powers)))).toFixed(2)} a lantern`);
  console.log(`  jumps          ${mean(rows.map((r) => r.jumps)).toFixed(1)} a run, ${mean(rows.map((r) => r.vaults)).toFixed(1)} of them over a fence, ${mean(rows.map((r) => r.refused)).toFixed(2)} refused`);
  console.log(`  travel         ${mean(rows.map((r) => r.distance)).toFixed(0)} units a run, ${(mean(rows.map((r) => r.distance)) / Math.max(0.01, mean(times))).toFixed(2)} units a second`);
  console.log(`  under threat   ${pct(mean(rows.map((r) => r.threat)), mean(times))} of the run within 8.0 units of a skeleton`);
  console.log(`  in real danger ${pct(mean(rows.map((r) => r.panic)), mean(times))} of the run within 4.0 units`);
  if (bad.length) console.log(`  STABILITY FAILURES ${bad.length}: ${[...new Set(bad.map((r) => r.bad))].join(', ')} first seeds ${bad.slice(0, 6).map((r) => r.seed).join(' ')}`);
  else console.log('  stability      clean, no NaN, nothing through a fence, nothing outside the window');
  return rows;
}

// ---------------------------------------------------------------------------
// 4. Stability, including the dt a backgrounded tab hands you
// ---------------------------------------------------------------------------

function stability(seeds) {
  const DTS = [1 / 240, 1 / 120, 1 / 60, 1 / 30, 1 / 20, 0.1, 0.25, 0.5, 1.0, 3.0];
  console.log(`\n--- 4. STABILITY, ${seeds} runs at each of ${DTS.length} timesteps ---`);
  console.log('  dt        frames   fails  what');
  for (const dt of DTS) {
    let frames = 0;
    const fails = new Map();
    for (let seed = 1; seed <= seeds; seed++) {
      const r = playOne(seed, { botFactory: createBot, dt, limit: 120 });
      frames += Math.round(r.time / dt);
      if (r.bad) fails.set(r.bad, (fails.get(r.bad) || 0) + 1);
    }
    const what = [...fails.entries()].map(([k, v]) => `${k} x${v}`).join(', ') || 'clean';
    const total = [...fails.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${dt.toFixed(4).padStart(7)}  ${String(frames).padStart(7)}  ${String(total).padStart(5)}  ${what}`);
  }
  // The pathological frame: one update carrying a whole second of full stick
  // into a fence, from a grid of starts across a real world, with and without
  // the jump held down.
  const world = createWorld({ seed: 3, spacing: SPACING });
  let escapes = 0;
  let tested = 0;
  for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    for (const big of [1.0, 4.0]) {
      for (const jump of [false, true]) {
        const game = createGame({ world, seed: 1 });
        for (let gz = -30; gz <= 30; gz += 5) {
          for (let gx = -30; gx <= 30; gx += 5) {
            game.nav.focus(gx, gz);
            if (!game.nav.discClear(gx, gz, game.tuning.ghostRadius)) continue;
            game.debug.ghost.x = gx;
            game.debug.ghost.z = gz;
            game.debug.ghost.vx = 0;
            game.debug.ghost.vz = 0;
            game.debug.ghost.air = false;
            game.debug.ghost.cool = 0;
            game.update(big, { x: dir[0], y: dir[1], jump });
            tested++;
            const g = game.debug.ghost;
            if (!game.nav.discClear(g.x, g.z, game.tuning.ghostRadius, g.air)) escapes++;
          }
        }
      }
    }
  }
  console.log(`  one-frame slam: ${tested} starts, ${escapes} ended inside something they should not be`);
}

// ---------------------------------------------------------------------------
// 5. THE QUESTION: does the vault-versus-gate asymmetry produce play?
// ---------------------------------------------------------------------------
//
// Four players over the same worlds. `ground` never jumps at all, `vault` jumps
// whenever a fence is closer than walking round it, and `careful` prices a
// vault at jumpCost and decides per journey. If ground and careful score the
// same the jump is worth nothing; if vault and careful score the same the price
// is doing nothing and the bot is just crossing every fence it meets.

function jumpSweep(seeds) {
  console.log(`\n--- 5. THE VAULT, ${seeds} runs each, limit 300s ---`);
  console.log('  jumpCost is what crossing a fence costs as a multiple of walking the same distance.');
  console.log('  1.0 means a vault is exactly as cheap as open ground; 1e6 means the player never learned it.');
  console.log('');
  console.log('  jumpCost  runs to 300s  median life  score       fireflies  vaults/min  detours  threat%');
  for (const jc of [1.0, 1.5, 2.0, 3.0, 5.0, 9.0, 1e6]) {
    const rows = [];
    for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, { botFactory: (g) => createBot(g, { jumpCost: jc }), limit: 300 }));
    const times = rows.map((r) => r.time);
    const alive = rows.filter((r) => r.survived).length;
    const vpm = mean(rows.map((r) => r.vaults)) / (mean(times) / 60);
    // A detour is a journey the planner priced and decided to walk: it is the
    // count of times a fence was between the ghost and its goal and the route
    // went round. Measured as planned routes that contained no vault while a
    // fence lay on the straight line.
    const det = mean(rows.map((r) => r.plannedVaults));
    console.log(`  ${String(jc === 1e6 ? 'never' : jc.toFixed(1)).padStart(8)}  ${pct(alive, seeds).padStart(12)}  ${median(times).toFixed(0).padStart(11)}s  ${mean(rows.map((r) => r.score)).toFixed(0).padStart(9)}  ${mean(rows.map((r) => r.collected)).toFixed(1).padStart(9)}  ${vpm.toFixed(2).padStart(10)}  ${det.toFixed(1).padStart(7)}  ${pct(mean(rows.map((r) => r.threat)), mean(times)).padStart(7)}`);
  }
}

// The other half of the same question: what the jump is WORTH to a player, and
// whether pricing it changes anything, measured as four named players rather
// than as a dial.
function players(seeds) {
  const V = {
    'careful (jumpCost 3)': createBot,
    'vault (jumpCost 1)': vaultBot,
    'ground (never jumps)': groundBot,
    reckless: recklessBot,
    passive: passiveBot,
  };
  console.log(`\n--- 5b. THE FOUR PLAYERS, ${seeds} runs each ---`);
  console.log('  player                 median life  reached 300s  score    fireflies/min  vaults/min  deaths  threat%');
  for (const [name, f] of Object.entries(V)) {
    const limit = f === passiveBot ? 200 : 300;
    const rows = [];
    for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, { botFactory: f, limit }));
    const times = rows.map((r) => r.time);
    console.log(`  ${name.padEnd(21)}  ${median(times).toFixed(0).padStart(10)}s  ${pct(rows.filter((r) => r.survived).length, seeds).padStart(12)}  ${mean(rows.map((r) => r.score)).toFixed(0).padStart(7)}  ${(mean(rows.map((r) => r.collected)) / (mean(times) / 60)).toFixed(2).padStart(13)}  ${(mean(rows.map((r) => r.vaults)) / (mean(times) / 60)).toFixed(2).padStart(10)}  ${mean(rows.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${pct(mean(rows.map((r) => r.threat)), mean(times)).padStart(7)}`);
  }
}

// ---------------------------------------------------------------------------
// 6. The skeletons' decision cadence
// ---------------------------------------------------------------------------
//
// legMax is the number that replaces "a junction every two or three tiles". At
// 0 a skeleton re-steers every frame and is a homing missile; at 8 its course
// is fixed for nearly four seconds and it can be walked round. The sweep is
// what says where between those the chase is a chase.

function legSweep(seeds) {
  console.log(`\n--- 6. THE DECISION CADENCE, ${seeds} runs each ---`);
  console.log('  legMax is how far a skeleton walks in a straight line before it looks at its target again.');
  console.log('  seconds is that at the walk of 2.15, which is how long the player has to juke it.');
  console.log('');
  console.log('  legMax  seconds  median life  reached 300s  careful score  reckless life  threat%  danger%');
  for (const leg of [0.01, 1.0, 2.0, 3.0, 4.0, 6.0, 9.0]) {
    const tuning = { chase: { ...DEFAULT_CHASE, legMax: leg } };
    const play = [];
    const wild = [];
    for (let seed = 1; seed <= seeds; seed++) {
      play.push(playOne(seed, { botFactory: createBot, tuning, limit: 300 }));
      wild.push(playOne(seed, { botFactory: recklessBot, tuning, limit: 300 }));
    }
    const times = play.map((r) => r.time);
    console.log(`  ${leg.toFixed(2).padStart(6)}  ${(leg / 2.15).toFixed(2).padStart(7)}  ${median(times).toFixed(0).padStart(10)}s  ${pct(play.filter((r) => r.survived).length, seeds).padStart(12)}  ${mean(play.map((r) => r.score)).toFixed(0).padStart(13)}  ${median(wild.map((r) => r.time)).toFixed(0).padStart(12)}s  ${pct(mean(play.map((r) => r.threat)), mean(times)).padStart(7)}  ${pct(mean(play.map((r) => r.panic)), mean(times)).padStart(7)}`);
  }
}

// ---------------------------------------------------------------------------
// 7. The speed ratio, re-measured because the maze it was measured in is gone
// ---------------------------------------------------------------------------

function ghostSweep(seeds) {
  const walk = Number(num('--skel', 2.15));
  console.log(`\n--- 7. GHOST SPEED, skeleton held at ${walk} (cadence ${(walk / 0.629).toFixed(2)}/s), ${seeds} runs each ---`);
  console.log('  ghost  ratio  median life  reached 300s  score   reckless life  passive 1st  threat%');
  for (const g of [4.5, 4.0, 3.6, 3.2, 3.05, 2.9, 2.7, 2.5]) {
    const tuning = { ghostSpeed: g, speeds: { ...TUNING.speeds, walk } };
    const play = [];
    const wild = [];
    const pass = [];
    for (let seed = 1; seed <= seeds; seed++) {
      play.push(playOne(seed, { botFactory: createBot, tuning, limit: 300 }));
      wild.push(playOne(seed, { botFactory: recklessBot, tuning, limit: 300 }));
      pass.push(playOne(seed, { botFactory: passiveBot, tuning, limit: 200 }));
    }
    const times = play.map((r) => r.time);
    const firsts = pass.filter((r) => r.firstDeath > 0).map((r) => r.firstDeath);
    console.log(`  ${g.toFixed(2)}   ${(walk / g).toFixed(2)}  ${median(times).toFixed(0).padStart(10)}s  ${pct(play.filter((r) => r.survived).length, seeds).padStart(12)}  ${mean(play.map((r) => r.score)).toFixed(0).padStart(6)}  ${median(wild.map((r) => r.time)).toFixed(0).padStart(12)}s  ${(firsts.length ? median(firsts).toFixed(0) + 's' : 'NEVER').padStart(11)}  ${pct(mean(play.map((r) => r.threat)), mean(times)).padStart(7)}`);
  }
}

function schedules(seeds) {
  const V = {
    'chase for ever': [{ mode: 'chase', t: Infinity }],
    'scatter for ever': [{ mode: 'scatter', t: Infinity }],
    shipped: TUNING.waves,
  };
  console.log(`\n--- 8. THE MODE SCHEDULE, ${seeds} runs each ---`);
  console.log('  schedule           median life  reached 300s  score   deaths  threat%  danger%');
  for (const [name, waves] of Object.entries(V)) {
    const play = [];
    for (let seed = 1; seed <= seeds; seed++) play.push(playOne(seed, { botFactory: createBot, tuning: { waves }, limit: 300 }));
    const times = play.map((r) => r.time);
    console.log(`  ${name.padEnd(17)}  ${median(times).toFixed(0).padStart(10)}s  ${pct(play.filter((r) => r.survived).length, seeds).padStart(12)}  ${mean(play.map((r) => r.score)).toFixed(0).padStart(6)}  ${mean(play.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${pct(mean(play.map((r) => r.threat)), mean(times)).padStart(7)}  ${pct(mean(play.map((r) => r.panic)), mean(times)).padStart(7)}`);
  }
}

// The lantern, re-measured. A lantern forty units away is a different object
// from one four units away, so both its duration and whether the bot bothers to
// go and get it have to be looked at again.
function power(seeds) {
  console.log(`\n--- 9. THE LANTERN, ${seeds} runs each ---`);
  console.log('  seconds  lit a run  eaten  per lantern  median life  score');
  for (const t of [6, 8, 10, 12, 16, 20]) {
    const rows = [];
    for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, { botFactory: createBot, tuning: { powerTime: t }, limit: 300 }));
    const lit = mean(rows.map((r) => r.powers));
    console.log(`  ${String(t).padStart(7)}  ${lit.toFixed(2).padStart(9)}  ${mean(rows.map((r) => r.eats)).toFixed(2).padStart(5)}  ${(mean(rows.map((r) => r.eats)) / Math.max(0.01, lit)).toFixed(2).padStart(11)}  ${median(rows.map((r) => r.time)).toFixed(0).padStart(10)}s  ${mean(rows.map((r) => r.score)).toFixed(0).padStart(5)}`);
  }
}

// Is the score a leaderboard? A flat distribution is not one. What is wanted is
// a long right tail that a better player can climb, and a score that separates
// two runs of the same LENGTH, which is what the streak is for.
function scoreShape(seeds) {
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, { botFactory: createBot, limit: 300 }));
  const sc = rows.map((r) => r.score);
  console.log(`\n--- 10. THE SCORE DISTRIBUTION, ${seeds} runs ---`);
  console.log(`  score      p10 ${quant(sc, 0.1)}  median ${median(sc)}  p90 ${quant(sc, 0.9)}  max ${Math.max(...sc)}   spread p90/p10 ${(quant(sc, 0.9) / Math.max(1, quant(sc, 0.1))).toFixed(1)}x`);
  console.log(`  best streak  mean ${mean(rows.map((r) => r.bestStreak)).toFixed(1)}  max ${Math.max(...rows.map((r) => r.bestStreak))}`);
  // The point of the streak: two runs of the same length must score
  // differently. Bucket by length and show the spread inside a bucket.
  const buckets = [[0, 90], [90, 150], [150, 240], [240, 301]];
  console.log('  runs of similar length, and how much their scores differ:');
  for (const [lo, hi] of buckets) {
    const b = rows.filter((r) => r.time >= lo && r.time < hi);
    if (b.length < 3) continue;
    const s = b.map((r) => r.score);
    console.log(`    ${String(lo).padStart(3)} to ${String(hi).padStart(3)}s  n=${String(b.length).padStart(3)}  p10 ${String(quant(s, 0.1)).padStart(6)}  median ${String(median(s)).padStart(6)}  p90 ${String(quant(s, 0.9)).padStart(6)}   within-bucket spread ${(quant(s, 0.9) / Math.max(1, quant(s, 0.1))).toFixed(1)}x`);
  }
}

// ---------------------------------------------------------------------------
// 0. The self test: break the game once per check and confirm each one fires.
// ---------------------------------------------------------------------------

function selftest() {
  console.log('\n--- 0. SELF TEST, each check and each load-bearing rule shown failing on purpose ---');
  const rows = [];
  const add = (what, fired, detail = '') => rows.push([what, fired, detail]);
  const at = { x: 0, z: 0 };

  // --- the four fairness properties ----------------------------------------
  {
    // F3, the safe spot: a gateless pen with a firefly in it. The ghost vaults
    // in and no skeleton can ever follow. This is the failure that would end
    // the game, so it is the first one shown.
    const p = pen(0, 0, 8, 8, 0);
    const w = fixedWorld({
      spawn: { x: -14, z: 0 }, ...p,
      fireflies: [{ id: 'f', x: 0, z: 0 }],
      graves: [{ id: 'v', x: -14, z: 6 }],
    });
    const f = fairOne(w, { x: -14, z: 0 });
    add('F3safeSpot   (gateless pen)', f.includes('F3safeSpot'), f.join(' ') || 'nothing fired');
  }
  {
    // F1, the chase: put the GRAVE inside the gateless pen instead. A skeleton
    // climbing out of it can never reach anybody.
    const p = pen(0, 0, 8, 8, 0);
    const w = fixedWorld({ spawn: { x: -14, z: 0 }, ...p, graves: [{ id: 'v', x: 0, z: 0 }] });
    const f = fairOne(w, { x: -14, z: 0 });
    add('F1graveCut   (grave in a gateless pen)', f.includes('F1graveCut'), f.join(' ') || 'nothing fired');
  }
  {
    // F2, sealed: the same pen with the SPAWN inside it, and no way out at all,
    // which needs the ground outside every wall blocked so it cannot be vaulted
    // either.
    const p = pen(0, 0, 6, 6, 0);
    const props = [];
    for (let a = -6; a <= 6; a += 0.7) {
      props.push({ id: `n${a}`, x: a, z: -4.2, radius: 0.6, solid: true });
      props.push({ id: `s${a}`, x: a, z: 4.2, radius: 0.6, solid: true });
      props.push({ id: `e${a}`, x: 4.2, z: a, radius: 0.6, solid: true });
      props.push({ id: `w${a}`, x: -4.2, z: a, radius: 0.6, solid: true });
    }
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, ...p, props, graves: [{ id: 'v', x: 12, z: 12 }] });
    const f = fairOne(w, { x: 0, z: 0 });
    add('F2sealed     (pen with no gate and no landing)', f.includes('F2sealed'), f.join(' ') || 'nothing fired');
  }
  {
    // F4, the pin: ONE gate, and the ground outside every wall blocked so the
    // fence cannot be vaulted. One way out, which is exactly the trap
    // 2-edge-connectivity used to forbid.
    const p = pen(0, 0, 6, 6, 1);
    const props = [];
    for (let a = -6; a <= 6; a += 0.7) {
      if (Math.abs(a) > 1.6) props.push({ id: `n${a}`, x: a, z: -4.2, radius: 0.6, solid: true });
      props.push({ id: `s${a}`, x: a, z: 4.2, radius: 0.6, solid: true });
      props.push({ id: `e${a}`, x: 4.2, z: a, radius: 0.6, solid: true });
      props.push({ id: `w${a}`, x: -4.2, z: a, radius: 0.6, solid: true });
    }
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, ...p, props, graves: [{ id: 'v', x: 0, z: -8 }] });
    const f = fairOne(w, { x: 0, z: 0 });
    add('F4pin        (one gate, fence not vaultable)', f.includes('F4pin'), f.join(' ') || 'nothing fired');
  }
  {
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, props: [{ id: 'p', x: 0, z: 0, radius: 1.2, solid: true }], graves: [{ id: 'v', x: 8, z: 0 }] });
    const f = fairOne(w, { x: 0, z: 0 });
    add('spawn        (spawn inside a prop)', f.includes('spawn'), f.join(' ') || 'nothing fired');
  }
  {
    const props = [];
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2;
      props.push({ id: `r${a}`, x: 8 + Math.cos(th) * 1.7, z: Math.sin(th) * 1.7, radius: 0.62, solid: true });
    }
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, props, fireflies: [{ id: 'f', x: 8, z: 0 }], graves: [{ id: 'v', x: -8, z: 0 }] });
    const f = fairOne(w, { x: 0, z: 0 });
    add('flyReach     (firefly walled in by props)', f.includes('flyReach') || f.includes('F2sealed'), f.join(' ') || 'nothing fired');
  }
  {
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, props: [{ id: 'p', x: 6, z: 0, radius: 0.9, solid: true }], graves: [{ id: 'v', x: 6, z: 0 }] });
    const f = fairOne(w, { x: 0, z: 0 });
    add('graveClear   (grave under a prop)', f.includes('graveClear'), f.join(' ') || 'nothing fired');
  }
  {
    const p = pen(0, 0, 8, 8, 1);
    p.props = [{ id: 'plug', x: p.gates[0].x, z: p.gates[0].z, radius: 0.8, solid: true }];
    const w = fixedWorld({ spawn: { x: -14, z: 0 }, ...p, graves: [{ id: 'v', x: -14, z: 4 }] });
    const f = fairOne(w, { x: -14, z: 0 });
    add('gateWide     (prop standing in the gate)', f.includes('gateWide'), f.join(' ') || 'nothing fired');
  }

  // --- the runtime checks ---------------------------------------------------
  const liveWorld = () => createWorld({ seed: 11, spacing: SPACING });
  {
    // Substepping off, one enormous frame. The thing that stops the ghost going
    // through a fence is maxStep, so turning maxStep off must break it.
    const world = liveWorld();
    let escaped = 0;
    let tested = 0;
    const game = createGame({ world, seed: 1, tuning: { maxStep: 1e9 } });
    for (let gz = -24; gz <= 24; gz += 3) {
      for (let gx = -24; gx <= 24; gx += 3) {
        game.nav.focus(gx, gz);
        if (!game.nav.discClear(gx, gz, game.tuning.ghostRadius)) continue;
        for (const dir of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          game.debug.ghost.x = gx; game.debug.ghost.z = gz;
          game.debug.ghost.vx = 0; game.debug.ghost.vz = 0;
          game.debug.ghost.air = false;
          game.update(2.0, { x: dir[0], y: dir[1] });
          tested++;
          const g = game.debug.ghost;
          if (!game.nav.discClear(g.x, g.z, game.tuning.ghostRadius, g.air)) escaped++;
        }
      }
    }
    add('ghost-in-fence (maxStep disabled, dt 2.0)', escaped > 0, `${escaped} of ${tested} starts ended inside something`);
  }
  {
    const game = createGame({ world: liveWorld(), seed: 1 });
    game.debug.ghost.x = NaN;
    const st = game.update(1 / 60, { x: 0, y: 0 });
    add('nan-ghost', check(game, st) === 'nan-ghost', check(game, st) || 'not caught');
  }
  {
    // A skeleton picked up and dropped inside a fence.
    const game = createGame({ world: liveWorld(), seed: 1 });
    let st = game.state;
    for (let i = 0; i < 60 * 10; i++) st = game.update(1 / 60, { x: 0, y: 0 });
    const s0 = game.herd.list.find((k) => k.state === 'hunting');
    if (!s0) add('skeleton-in-fence', false, 'no skeleton was hunting yet');
    else {
      const b = game.nav.barriers[0];
      s0.x = (b.x0 + b.x1) / 2;
      s0.z = (b.z0 + b.z1) / 2;
      st = game.update(0, { x: 0, y: 0 });
      add('skeleton-in-fence', check(game, st) === 'skeleton-in-fence', check(game, st) || 'not caught');
    }
  }
  {
    // The window relation. Move a skeleton beyond WINDOW - SLACK and the check
    // that nav.js's comment promises has to fire.
    const game = createGame({ world: liveWorld(), seed: 1 });
    let st = game.state;
    for (let i = 0; i < 60 * 10; i++) st = game.update(1 / 60, { x: 0, y: 0 });
    const s0 = game.herd.list.find((k) => k.state === 'hunting');
    if (!s0) add('actor-outside-window', false, 'no skeleton was hunting yet');
    else {
      s0.x = game.debug.ghost.x + WINDOW;
      s0.z = game.debug.ghost.z;
      st = game.update(0, { x: 0, y: 0 });
      add('actor-outside-window', check(game, st) === 'actor-outside-window', check(game, st) || 'not caught');
    }
  }

  // --- the three rules that stop the jump being a dodge ---------------------
  {
    // 1. NO INVULNERABILITY. Launch the ghost, put a hunting skeleton on top of
    //    it in mid-air, and a death must fire. If it does not, the jump is a
    //    dodge and the fence is decoration.
    // Graves in a ring 13 out, so the pen band always has one and the ghost is
    // never standing on the hole a skeleton is climbing out of.
    const graves = [];
    for (let a = 0; a < 8; a++) graves.push({ id: `v${a}`, x: Math.cos(a) * 13, z: Math.sin(a) * 13 });
    const game = createGame({ world: fixedWorld({ spawn: { x: 0, z: 0 }, graves }), seed: 1 });
    let st = game.state;
    let s0 = null;
    for (let i = 0; i < 60 * 25 && !s0; i++) {
      st = game.update(1 / 60, { x: 0, y: 0 });
      s0 = game.herd.list.find((k) => k.state === 'hunting' && Math.hypot(k.x - game.debug.ghost.x, k.z - game.debug.ghost.z) > 7);
    }
    let died = false;
    let airborne = false;
    if (s0) {
      // Run away from it to build the run-up, then take off, then put the
      // skeleton on top of the ghost in mid-air.
      const ax = Math.sign(game.debug.ghost.x - s0.x) || 1;
      for (let i = 0; i < 60 && !game.debug.ghost.air && st.phase === 'play'; i++) {
        st = game.update(1 / 60, { x: ax, y: 0, jump: i > 10 });
      }
      airborne = game.debug.ghost.air;
      for (let i = 0; i < 20 && game.debug.ghost.air && !died; i++) {
        s0.x = game.debug.ghost.x;
        s0.z = game.debug.ghost.z;
        st = game.update(1 / 120, { x: ax, y: 0 });
        died = st.events.some((e) => e.type === 'death');
      }
    }
    add('RULE jump is not a dodge', airborne && died,
      !s0 ? 'no skeleton ever hunted' : airborne ? (died ? 'caught in mid-air, as it must be' : 'NOT CAUGHT: the jump grants invulnerability') : 'never left the ground');
  }
  {
    // 2. THE RUN-UP. A jump from a standing start is refused.
    const game = createGame({ world: fixedWorld({ spawn: { x: 0, z: 0 }, graves: [{ id: 'v', x: 30, z: 30 }] }), seed: 1 });
    let st = game.state;
    for (let i = 0; i < 60 * 3; i++) st = game.update(1 / 60, { x: 0, y: 0 });
    st = game.update(1 / 60, { x: 0, y: 0, jump: true });
    const refused = st.events.some((e) => e.type === 'jumpRefused' && e.why === 'noRunUp');
    add('RULE jump needs a run-up', refused && !game.debug.ghost.air, refused ? 'refused from a standing start' : 'JUMPED FROM REST');
  }
  {
    // 3. THE LANDING. A jump whose landing point is inside a prop is refused at
    //    takeoff rather than rolled back in mid-air.
    const props = [];
    for (let a = -3; a <= 3; a += 0.5) props.push({ id: `w${a}`, x: 2.0, z: a, radius: 0.5, solid: true });
    const game = createGame({ world: fixedWorld({ spawn: { x: 0, z: 0 }, props, graves: [{ id: 'v', x: 30, z: 30 }] }), seed: 1 });
    let st = game.state;
    for (let i = 0; i < 60 * 3; i++) st = game.update(1 / 60, { x: 0, y: 0 });
    let refused = false;
    for (let i = 0; i < 40 && !refused; i++) {
      st = game.update(1 / 60, { x: 1, y: 0, jump: true });
      refused = st.events.some((e) => e.type === 'jumpRefused' && e.why === 'noLanding');
    }
    add('RULE jump refuses a blocked landing', refused && !game.debug.ghost.air, refused ? 'refused before takeoff' : 'JUMPED INTO A WALL');
  }
  {
    // 4. AND IT DOES CROSS A FENCE, which is the whole point and the one thing
    //    a suite of refusals could pass while the feature did nothing.
    const world = fixedWorld({
      spawn: { x: -4, z: 0 },
      barriers: [{ id: 'b', x0: 0, z0: -6, x1: 0, z1: 6, half: 0.1, end0: 'free', end1: 'free' }],
      graves: [{ id: 'v', x: -30, z: 30 }],
    });
    const game = createGame({ world, seed: 1 });
    let st = game.state;
    for (let i = 0; i < 60 * 3; i++) st = game.update(1 / 60, { x: 0, y: 0 });
    let crossed = false;
    let vaulted = false;
    for (let i = 0; i < 200 && !crossed; i++) {
      const jump = game.debug.ghost.x > -1.6 && !game.debug.ghost.air;
      st = game.update(1 / 60, { x: 1, y: 0, jump });
      if (st.events.some((e) => e.type === 'jump' && e.overFence)) vaulted = true;
      if (game.debug.ghost.x > 0.4) crossed = true;
    }
    add('RULE a vault crosses a fence', vaulted && crossed, vaulted ? (crossed ? `landed at x ${game.debug.ghost.x.toFixed(2)}, the far side` : 'jumped but did not get across') : 'never vaulted');
  }
  {
    // 5. And the same fence, walked at rather than jumped: it must NOT be
    //    crossed. A rule that only ever passes is a rule that is not doing
    //    anything, so its opposite is shown too.
    const world = fixedWorld({
      spawn: { x: -4, z: 0 },
      barriers: [{ id: 'b', x0: 0, z0: -6, x1: 0, z1: 6, half: 0.1, end0: 'free', end1: 'free' }],
      graves: [{ id: 'v', x: -30, z: 30 }],
    });
    const game = createGame({ world, seed: 1 });
    for (let i = 0; i < 60 * 8; i++) game.update(1 / 60, { x: 1, y: 0 });
    add('RULE a walk does not', game.debug.ghost.x < 0, `stopped at x ${game.debug.ghost.x.toFixed(2)}, fence at 0`);
  }
  {
    // 6. And a skeleton cannot cross it either, which is the other half of the
    //    asymmetry and the half that is easy to get wrong silently.
    // The fence runs from -80 to 80 so its free ends are well outside the 30 s
    // of walking the skeleton gets. If it ends up on the ghost's side it did
    // not walk round, it went through.
    const world = fixedWorld({
      spawn: { x: 4, z: 0 },
      barriers: [{ id: 'b', x0: 0, z0: -80, x1: 0, z1: 80, half: 0.1, end0: 'free', end1: 'free' }],
      graves: [{ id: 'v', x: -6, z: 0 }],
    });
    const game = createGame({ world, seed: 1, skeletons: 1 });
    let worst = -99;
    let sawHunt = false;
    for (let i = 0; i < 60 * 30; i++) {
      game.update(1 / 60, { x: 0, y: 0 });
      const s = game.herd.list[0];
      if (s.state === 'hunting') { sawHunt = true; worst = Math.max(worst, s.x); }
    }
    add('RULE a skeleton cannot vault', sawHunt && worst < 0.2,
      sawHunt ? `the skeleton got to x ${worst.toFixed(2)} against a fence at 0 and never crossed it` : 'no skeleton ever hunted');
  }

  let missed = 0;
  for (const [what, fired, detail] of rows) {
    if (!fired) missed++;
    console.log(`  ${(fired ? 'FIRED ' : 'MISSED')}  ${what.padEnd(46)}  ${detail}`);
  }
  console.log(missed ? `  ${missed} CHECKS DID NOT FIRE, so their all-clears above mean nothing` : `  all ${rows.length} fired on their own broken case`);
  return missed;
}

// ---------------------------------------------------------------------------

const FLAGS = ['--selftest', '--fair', '--play', '--passive', '--stability', '--jump', '--players', '--leg', '--ghostsweep', '--schedule', '--power', '--score'];
const only = args.some((a) => FLAGS.includes(a));
if (!only || has('--selftest')) selftest();
if (!only || has('--fair')) fairness(num('--fair', 300));
if (!only || has('--play')) playMany(num('--play', 120), { botFactory: createBot, limit: 300 }, '2. SURVIVAL, the careful bot');
if (!only || has('--passive')) playMany(num('--passive', 120), { botFactory: passiveBot, limit: 200 }, '3. LETHALITY, the player who never moves');
if (!only || has('--stability')) stability(num('--stability', 12));
if (has('--jump')) jumpSweep(num('--jump', 40));
if (has('--players')) players(num('--players', 40));
if (has('--leg')) legSweep(num('--leg', 40));
if (has('--ghostsweep')) ghostSweep(num('--ghostsweep', 40));
if (has('--schedule')) schedules(num('--schedule', 40));
if (has('--power')) power(num('--power', 40));
if (has('--score')) scoreShape(num('--score', 200));
