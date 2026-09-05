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
//   node src/game/soak.mjs --schedule          the mode schedule controls
//   node src/game/soak.mjs --score             the leaderboard distribution
//   node src/game/soak.mjs --arena ...         any of the above, in the arena
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
// JUMPS, and S for the set a skeleton can reach from a SPAWN MARKER WITHOUT
// them.
// Both are computed by flood fill over the same occupancy raster the bot plans
// on, at 0.75 units, so a claim proved here is a claim about the geometry the
// characters actually move in, at that resolution and no finer.
//
//   F1  THE CHASE EXISTS. Every spawn marker in the region lies in the same
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
// stand, every spawn marker admits the skeleton's disc, and every gate admits a disc
// of 0.60. The last of those is the world's own G5 guarantee, checked here on
// the thing that ships rather than trusted as a promise.
//
// Section 0 breaks the game once for each check and shows it firing, because a
// check that has never failed is a check nobody has a reason to believe. Six of
// those nineteen broken cases are not checks at all but RULES, and they are
// there because the jump is the whole game and a rule stated only in a comment
// is a rule nobody has to keep: that a jump does not confer invulnerability,
// that it needs a run-up, that it is refused when the landing is blocked, that
// it does carry the ghost over a fence, that a walk does not, and that a
// skeleton cannot do it at all. The first three are what stop the jump being a
// dodge; the last three are what stop the whole feature quietly doing nothing.
//
// THE FLAGS
//   --arena [N]      run everything against the bounded N by N walled level
//                    (default 30) instead of the endless plane
//   --standin        with --arena, use refworld.mjs's arena rather than the
//                    real src/game/world/ generator
//   --faironly       play only seeds that pass every fairness property, and
//                    say how many were skipped
//   --limit N        how long one run may last, simulated seconds (300)
//   --faircell N     fairness raster step (0.5 in an arena, 0.75 on the plane)
//   --spacing N      mean firefly spacing in the stand-in world (18)
//   --fencescale N   how much fence the stand-in puts down, 1 is its default

// ===========================================================================
// WHAT IT SAID LAST TIME IT WAS RUN IN FULL
// ===========================================================================
//
// AGAINST THE REAL GENERATOR, src/game/world/, 30 by 30 arena.
// `--arena --fair 150`, and the resolution study underneath it, which is the
// part worth reading:
//
//   spawn         8.0%    the ghost's own disc does not fit at (0, 0)
//   F1spawnCut    0 to 2%
//   F2sealed      0.3%
//   F3safeSpot    18 to 20%   THE ONE THAT MATTERS
//   F4pin         0%
//   flyReach      1 to 5%
//   spawnClear    0 to 1.3%
//   gateWide      1.3%
//
//   careful bot   95% cleared, median 54 s, 0.35 deaths, 23.9% of the run
//                 within 8.0 units of a skeleton and 5.9% within 4.0, which is
//                 the closest anything here has come to the old maze's 25.9%
//                 and 3.5%
//   passive       70% lost all three lives, median 69 s
//
//   THE VAULT, on levels that pass every fairness property (--faironly):
//
//     careful, a vault priced at 3x walking   54 s to clear, 9.76 fireflies/min
//     the same bot, never jumping             64 s to clear, 8.74 fireflies/min
//
//   So the jump is worth 16% of the clear time and 12% of the collection rate,
//   and 0.9% of the SCORE, because an arena pays for nine fireflies and a clear
//   bonus however long you take. Score is the weakest of the three measures
//   here and quoting it alone would have said the mechanic does not exist.
//
// AGAINST THE STAND-IN, refworld.mjs's arena, `--arena --standin --fair 120`
// at 0.6, 0.4 and 0.25: 0 failures on all eight properties at every step. Two
// independent generators against one set of checks, one clean and one not, is
// what makes the failures above a statement about the generator rather than
// about the checks.
//
// THE RESOLUTION STUDY, and it is the reason those F3 figures are quoted as a
// range. The checks flood a raster, and a raster is an approximation. The
// first version of them answered 24.0%, 23.3%, 21.3%, 12.0% and 3.3% at cell
// steps of 0.6 down to 0.25: falling the whole way and still falling, which
// means it was measuring the raster. Two things were wrong and both are fixed
// in nav.js with the reasoning at the code: the vault reach scaled with the
// cell size, and a cell was called blocked when its CENTRE was blocked rather
// than when all of it was. With both fixed the same study gives 19.0%, 20.0%
// and 18.0%, which is convergence, and 18 to 20% is the honest answer.
// Individual seeds still flip between resolutions, because the property is
// marginal on some levels; the rate does not.
//
// THE ENDLESS PLANE, kept because the rules work in either and the comparison
// is informative. `--play 16 --passive 16`:
//
//   careful bot  100% survived 300 s, 0.50 deaths, 39.9 fireflies at 8.0 a
//                minute, 2.93 units a second, 15.4% threat and 2.1% danger
//   passive      100% lost all three lives, median 56 s
//
// SELF TEST, all 20 checks and load-bearing rules fired on their own case.
//
// THE DEFECT THAT WAS KNOWN HERE IS FIXED, and what it turned out to be is
// worth more than the fix. `skeleton-stalled` fired in about one arena in
// twenty, was written down as "the steering has a wedge case left in it", and
// later read 38 in 60, which looked like the wedge case getting worse.
//
// It was two separate things wearing one number.
//
//   THE MEASUREMENT. The check was a stopwatch: did any skeleton ever go
//   nowhere for twelve seconds. An endless run is six times longer than the
//   forty-second run this was calibrated on, and a "did it ever" flag scales
//   with exposure, so six times the run is six times the rate. The same build
//   measured at forty-five seconds still read 2 in 20. It is a SHARE now and
//   the run length cannot move it.
//
//   THE DEFECT. A real one, and not the wedge case: a skeleton SLIDING along a
//   wall. chase.js's give-up watched whether the resolver was fighting the
//   mover, and a slide keeps almost all of its step, so a skeleton could pace a
//   wall at full speed for as long as you left it. It cost 4.6% of all time
//   above ground. chase.js now watches net displacement instead and retires one
//   that has not moved two units in nine seconds.
//
// Measured after both: 1.7% of time above ground, and the check fires in one
// arena in sixty at the two extreme frame times and none at all at 1.0 s.

// THE ONE LINE. `createArena` is the stand-in this half wrote to unblock
// itself; `createLevel` is the real generator. Both satisfy the same contract
// and --standin picks the stand-in, which is worth keeping for a while: two
// generators that pass the same eight fairness properties is a much stronger
// statement about the properties than one is.
import { createWorld as createLevel } from './world/index.js';
import { createWorld, createArena, FLY_SPACING } from './refworld.mjs';
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
// How much fence the stand-in world puts down, as a multiple of its default.
const FENCE = num('--fencescale', 1);
// How long a single run is allowed to last, in simulated seconds. The sweeps
// trade resolution for wall clock with it; the headline sections do not.
const LIMIT = num('--limit', 300);
// --arena runs everything against the bounded 30 by 30 walled level instead of
// the endless plane. Both stay available because the rules work in either, and
// the soak is the only place that says which one is being measured.
const ARENA = has('--arena');
const ARENA_SIZE = num('--arena', 30);
const STANDIN = has('--standin');
const makeWorld = (seed, fence = FENCE) => {
  if (!ARENA) return createWorld({ seed, spacing: SPACING, fence });
  return STANDIN ? createArena({ seed, size: ARENA_SIZE }) : createLevel({ seed, size: ARENA_SIZE });
};

// --faironly plays only the seeds that PASS every fairness property, and it
// exists for one question: whether the jump-versus-gate asymmetry pays, which
// cannot be answered on levels that are broken in ways that have nothing to do
// with it. A level with a safe spot in it is a level where the bot may be
// standing somewhere no skeleton can reach, and its clear time means nothing.
// The count of seeds skipped is printed, because a comparison run on a third
// of the seeds is a different claim from one run on all of them.
const FAIRONLY = has('--faironly');
const fairCache = new Map();
function isFair(seed) {
  if (fairCache.has(seed)) return fairCache.get(seed);
  const w = makeWorld(seed);
  const ok = fairOne(w, w.bounds
    ? { x: (w.bounds.minX + w.bounds.maxX) / 2, z: (w.bounds.minZ + w.bounds.maxZ) / 2 }
    : { x: ((seed * 37) % 400) - 200, z: ((seed * 91) % 400) - 200 }).length === 0;
  fairCache.set(seed, ok);
  return ok;
}
// The seeds to play: `count` fair ones if --faironly, else 1..count.
function seedsFor(count) {
  if (!FAIRONLY) return { list: Array.from({ length: count }, (_, i) => i + 1), skipped: 0 };
  const list = [];
  let seed = 0;
  let skipped = 0;
  while (list.length < count && seed < count * 30) {
    seed++;
    if (isFair(seed)) list.push(seed);
    else skipped++;
  }
  return { list, skipped };
}

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
    spawns: all('spawns'),
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
// The raster step. A bounded arena is small enough to afford a finer one, and
// it needs one: a gate mouth is 2.0 wide and a body needs 1.31 of it, so at
// 0.75 there are worlds where no cell centre lands in the passable part and a
// perfectly good gate is invisible to the check. That reported 3% of arenas as
// having a safe spot they did not have.
const FAIR_CELL = num('--faircell', ARENA ? 0.5 : 0.75);
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
      const links = grid.jump.get(n);
      if (links) for (const m of links) if (!out[m] && !(plug && plug.has(m))) { out[m] = 1; q[tail++] = m; }
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
  // A bounded world judges its whole interior and rasters a little beyond the
  // wall, so the wall is represented rather than falling off the raster's edge.
  let judge = FAIR_JUDGE;
  let half = FAIR_HALF;
  if (world.bounds) {
    const b = world.bounds;
    at = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    judge = Math.max(b.maxX - at.x, b.maxZ - at.z) - 0.5;
    half = judge + 5;
  }
  const nav = createNav(world);
  nav.focus(at.x, at.z);
  const grid = nav.makeGrid({ x: at.x, z: at.z, half, cell: FAIR_CELL, radius: FAIR_RADIUS });
  const N = grid.n * grid.n;
  const { label, count } = components(grid);
  const box = { minX: at.x - judge, minZ: at.z - judge, maxX: at.x + judge, maxZ: at.z + judge };
  const inBox = (p) => p.x > box.minX && p.x < box.maxX && p.z > box.minZ && p.z < box.maxZ;
  const fireflies = world.fireflies(box).filter(inBox);
  const spawns = world.spawns(box).filter(inBox);
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
    const links = grid.jump.get(i);
    if (links) for (const m of links) if (label[m] >= 0 && label[m] !== li) vaultOut[li].add(label[m]);
  }
  // In a BOUNDED world the region the ghost starts in is the level, not a
  // pocket. Its only boundary is the perimeter wall, which is unvaultable by
  // design, so by the unbounded reading it has no exits and is "sealed" and
  // 89.5% of arenas fail. That reading is wrong: F2 asks whether the ghost can
  // be shut into somewhere SMALLER than the game, and the game is exactly this
  // region. So it counts as open, and every other bounded component still has
  // to prove a way out.
  if (world.bounds && label[spawnCell] >= 0) open[label[spawnCell]] = 1;
  // Used by F2: a region with no exit of any kind. A region touching the edge
  // of the sampled raster continues into the world and counts as open too.
  const exits = (c) => (open[c] ? 9 : gateOut[c].size + vaultOut[c].size);

  const ghostSet = new Uint8Array(N);
  flood(grid, [spawnCell], true, ghostSet);
  const graveCells = spawns.map((g) => grid.nearestOpen(g.x, g.z)).filter((c) => c >= 0);
  const skelSet = new Uint8Array(N);
  flood(grid, graveCells, false, skelSet);

  // F1. Every marker is in the ghost's own walk component, so a skeleton that
  // climbs out of it can reach the player without a jump it cannot make.
  const spawnComp = label[spawnCell];
  for (const c of graveCells) if (label[c] !== spawnComp && !(open[label[c]] && open[spawnComp])) { fail.push('F1spawnCut'); break; }

  // F2. No sealed pocket holds anything the game asks anybody to go to.
  const wanted = new Set();
  for (const p of [...fireflies, ...spawns]) {
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
    if (Math.abs(grid.wx(i) - at.x) > judge || Math.abs(grid.wz(i) - at.z) > judge) continue;
    leak++;
  }
  // A few cells is rasterisation at a gate's lip; a pocket is tens of them.
  if (leak > 6) fail.push('F3safeSpot');

  // F4. NO GATE IS THE ONLY WAY OUT. Stated as the question a skeleton standing
  // in a gate asks: plug it, and does the set of places the ghost can reach
  // fall into more than one piece? A pen with one gate passes only because the
  // ghost can vault the fence, which is what makes the jump load bearing for
  // FAIRNESS rather than only for play. It fails exactly when the pen's fence
  // cannot be vaulted, which is what the self test builds.
  //
  // It is phrased as "does the set SPLIT" rather than "can the ghost still
  // reach everything from where it starts", and the difference is not
  // cosmetic: the ghost's start can itself be inside the plug, and the
  // reachability phrasing then reported the entire arena as lost in every
  // world where the spawn happened to be standing in a gateway.
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
    for (let b = b0 - span; b <= b0 + span; b++) {
      for (let a = a0 - span; a <= a0 + span; a++) {
        if (a < 0 || b < 0 || a >= grid.n || b >= grid.n) continue;
        const i = b * grid.n + a;
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
    // A handful of cells at the plug's own lip is rasterisation, not a trap.
    if (sizes.filter((z) => z > 4).length > 1) { fail.push('F4pin'); break; }
  }

  // Carried over.
  for (const f of fireflies) {
    const c = grid.nearestOpen(f.x, f.z);
    if (c < 0 || !ghostSet[c] || Math.hypot(grid.wx(c) - f.x, grid.wz(c) - f.z) > TUNING.pickRadius) { fail.push('flyReach'); break; }
  }
  for (const g of spawns) if (!nav.discClear(g.x, g.z, SKEL_RADIUS)) { fail.push('spawnClear'); break; }
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
  const keys = ['spawn', 'F1spawnCut', 'F2sealed', 'F3safeSpot', 'F4pin', 'flyReach', 'spawnClear', 'gateWide'];
  const fail = Object.fromEntries(keys.map((k) => [k, []]));
  let barriers = 0;
  let gates = 0;
  let flies = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const world = makeWorld(seed);
    // Look somewhere different in each world rather than always at the spawn,
    // so a thousand seeds is a thousand different neighbourhoods and not a
    // thousand looks at the same one.
    const at = ARENA ? { x: 0, z: 0 } : { x: ((seed * 37) % 400) - 200, z: ((seed * 91) % 400) - 200 };
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

// A ghost that has not moved in ten seconds of play is a ghost jammed against
// something, and it is invisible from the outside: its velocity reads full
// speed the whole time because the collision resolver puts it back every frame.
// One of these ran for a hundred and ten seconds inside a passing run and cost
// that run four fifths of its score without failing anything. Now it fails.
function jamCheck(track, s) {
  // A ghost that is not being pushed is not jammed, it is parked, and the
  // passive player parks for two hundred seconds on purpose. The signature of a
  // jam is full velocity and no displacement, so the velocity is part of it.
  if (s.phase !== 'play' || s.ghost.speed < 1.0) { track.t = 0; track.x = s.ghost.x; track.z = s.ghost.z; return null; }
  if (Math.hypot(s.ghost.x - track.x, s.ghost.z - track.z) > 0.5) {
    track.t = 0; track.x = s.ghost.x; track.z = s.ghost.z; return null;
  }
  track.t += track.dt;
  return track.t > 10 ? 'ghost-jammed' : null;
}

// A hunting skeleton that is not going anywhere is broken, and it is invisible
// from every other angle: the run still ends, the numbers still print, and the
// only symptom is a player who is harder to catch than they should be. Three
// separate deadlocks in the steering produced exactly this and none of the
// other checks saw any of them, so it gets its own.
//
// IT IS A RATE NOW AND IT USED TO BE A STOPWATCH, and the reason is worth
// keeping because the same mistake is available to any check written like this.
//
// The old version fired the moment any skeleton spent twelve seconds inside a
// one unit circle, and its own header recorded the result as "about one arena
// in twenty". It later read 38 in 60 and looked like a regression in the
// steering. It was not. A run used to END after about forty seconds, because an
// arena could be cleared; a run is now endless and the soak plays it for three
// hundred. A "did it ever happen" flag is a function of exposure, so six times
// the run length is six times the rate, and measured at the old forty-five
// seconds the same build still reads 2 in 20. The check had not rotted and the
// herd had not got worse: the thing being measured had changed shape.
//
// So what is asserted is the SHARE of time above ground that is spent going
// nowhere, which does not care how long the run is. chase.js retires a skeleton
// that has not moved two units in nine seconds, which is what puts a ceiling on
// it, and the two numbers are a contract: if that nine moves, this moves.
//
// MEASURED, thirty arenas at 300 s: mean 1.7% of time above ground, median
// 1.4%, p90 3.4%, worst 6.3%. The self test's own broken case, a herd whose
// walk is set to zero, reads 54%. So the threshold goes at TEN per cent, which
// is half again clear of the worst healthy run and five times clear of a broken
// one. A tighter threshold is tempting and wrong: three per cent would have
// flagged one healthy arena in ten, and a check that cries wolf is a check
// people learn to read past, which is how the last one drifted for so long.
export const STALL_GRACE = 4.0;    // seconds inside a 1.0 circle before it counts
export const STALL_SHARE = 0.10;   // of all time above ground
export const STALL_FLOOR = 15;     // seconds of it before the share means anything

function stallCheck(track, s, dt) {
  if (s.phase !== 'play') return null;
  const sum = track.total || (track.total = { hunt: 0, nowhere: 0 });
  for (const k of s.skeletons) {
    const t = track[k.id] || (track[k.id] = { t: 0, x: k.x, z: k.z });
    if (k.state !== 'hunting') { t.t = 0; t.x = k.x; t.z = k.z; continue; }
    sum.hunt += dt;
    if (Math.hypot(k.x - t.x, k.z - t.z) > 1.0) { t.t = 0; t.x = k.x; t.z = k.z; continue; }
    t.t += dt;
    if (t.t > STALL_GRACE) sum.nowhere += dt;
  }
  return null;
}

// The verdict, taken once at the end of a run rather than on a frame, because a
// rate is not a thing a single frame can be wrong about.
function stallVerdict(track) {
  const sum = track.total;
  if (!sum || sum.hunt < STALL_FLOOR) return null;
  return sum.nowhere / sum.hunt > STALL_SHARE ? 'skeleton-stalled' : null;
}

function playOne(seed, { botFactory, dt = 1 / 60, limit = 300, tuning, skeletons = 4, fence = FENCE }) {
  const world = makeWorld(seed, fence);
  const game = createGame({ world, seed, tuning, skeletons });
  const bot = botFactory(game);
  let s = game.state;
  let steps = 0;
  let firstDeath = -1;
  let deaths = 0;
  let jumps = 0;
  let vaults = 0;
  let refused = 0;
  // The herd's population over the run: how many came out of a stone, how many
  // the floor had to force, the time-weighted mean of how many were up and
  // whether the run ever reached the cap of five.
  let spawns = 0;
  let forced = 0;
  let upIntegral = 0;
  let hitCap = false;
  const maxSteps = Math.ceil(limit / dt);
  let bad = null;
  const jam = { t: 0, x: 0, z: 0, dt };
  const stall = {};
  const cross = {};
  // How much of the run is spent near the wall, and how many deaths happen
  // there. The question a hard boundary raises is whether it is a TRAP, and the
  // honest form of that question is a ratio: if the share of deaths near the
  // wall is much higher than the share of time spent near it, it is. `corner`
  // is the tighter case, within the same distance of two walls at once, which
  // is the only place on the board where every door can be shut at once.
  const b = world.bounds;
  const NEAR = 4.0;
  let nearWallTime = 0;
  let cornerTime = 0;
  let nearWallDeaths = 0;
  let cornerDeaths = 0;
  const wallness = () => {
    if (!b) return 0;
    const dx = Math.min(s.ghost.x - b.minX, b.maxX - s.ghost.x);
    const dz = Math.min(s.ghost.z - b.minZ, b.maxZ - s.ghost.z);
    return (dx < NEAR ? 1 : 0) + (dz < NEAR ? 1 : 0);
  };
  while (steps < maxSteps && s.phase !== 'over') {
    const input = bot.step(s, dt);
    s = game.update(dt, input);
    if (b && s.phase === 'play') {
      const w = wallness();
      if (w >= 1) nearWallTime += dt;
      if (w >= 2) cornerTime += dt;
    }
    for (const e of s.events) {
      if (e.type === 'death') {
        deaths++;
        if (firstDeath < 0) firstDeath = s.time;
        const w = wallness();
        if (w >= 1) nearWallDeaths++;
        if (w >= 2) cornerDeaths++;
      }
      if (e.type === 'jump') { jumps++; if (e.overFence) vaults++; }
      if (e.type === 'jumpRefused') refused++;
      if (e.type === 'spawn') { spawns++; if (e.forced) forced++; }
    }
    upIntegral += s.skeletonsUp * dt;
    if (s.skeletonsUp >= 5) hitCap = true;
    if (!bad) bad = check(game, s) || crossCheck(cross, game, s, dt) || jamCheck(jam, s) || stallCheck(stall, s, dt);
    steps++;
  }
  if (!bad) bad = stallVerdict(stall);
  return {
    seed, phase: s.phase, time: s.time, score: s.score, lives: s.lives,
    collected: s.collected, bestStreak: s.bestStreak, distance: s.distance,
    deaths, jumps, vaults, refused, firstDeath, bad,
    spawns, forced, hitCap, meanUp: s.time > 0 ? upIntegral / s.time : 0,
    threat: bot.stats.threatTime, panic: bot.stats.panicTime,
    plannedVaults: bot.stats.plannedVaults || 0,
    bot: bot.stats,
    nearWallTime, cornerTime, nearWallDeaths, cornerDeaths,
    survived: steps >= maxSteps,
  };
}

// Run on every frame of every run the soak plays, not only in the stability
// section: a NaN that only appears once in a thousand runs is exactly the one
// that will appear in the demo.
// The tunnelling guard, and the real form of the assertion maxStep exists to
// support. Checking that the ghost is not INSIDE a fence is not enough: a big
// enough step carries it clean through, the resolver finds it already on the
// far side and leaves it there, and every other check reports a clean frame.
// What has to be asserted is that a GROUNDED ghost never crossed a fence
// between one frame and the next.
function crossCheck(track, game, s, dt) {
  // Only at a sane timestep. The check compares one frame's start to its end,
  // and over three seconds the ghost travels nine units, so the straight line
  // between those two points is not the path it took: it will have gone round
  // the end of a fence and the check would call that a crossing. The substep
  // cap is what actually prevents tunnelling and it is asserted by the self
  // test; this is the in-play guard and it needs frames small enough for a
  // straight line between them to mean something.
  if (dt > 1 / 20) return null;
  const g = game.debug.ghost;
  const px = track.x;
  const pz = track.z;
  const wasAir = track.air;
  track.x = s.ghost.x;
  track.z = s.ghost.z;
  track.air = g.air;
  if (px === undefined) return null;
  if (wasAir || g.air) return null;
  if (s.events.some((e) => e.type === 'jump' || e.type === 'land')) return null;
  return game.nav.crossesBarrier(px, pz, s.ghost.x, s.ghost.z, 0) ? 'ghost-through-fence' : null;
}

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
    // one reason: it is underground, or part way out of the ground.
    if (k.state === 'dormant' || k.state === 'emerging' || k.state === 'sinking') continue;
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
  const pick = seedsFor(seeds);
  for (const seed of pick.list) rows.push(playOne(seed, opts));
  if (pick.skipped) console.log(`\n  (--faironly: ${pick.skipped} seeds skipped for failing a fairness property, ${pick.list.length} played)`);
  const over = rows.filter((r) => r.phase === 'over');
  const cleared = [];      // nothing clears any more; see rules.js
  const alive = rows.filter((r) => r.survived);
  const bad = rows.filter((r) => r.bad);
  const times = rows.map((r) => r.time);
  console.log(`\n--- ${title}, ${seeds} runs, limit ${opts.limit}s, ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
  console.log(`  lost all lives ${String(over.length).padStart(4)}  ${pct(over.length, seeds)}     still alive at the limit ${alive.length}  ${pct(alive.length, seeds)}`);
  console.log(`  run length     mean ${mean(times).toFixed(0)}s  median ${median(times).toFixed(0)}s  p10 ${quant(times, 0.1).toFixed(0)}s  p90 ${quant(times, 0.9).toFixed(0)}s`);
  console.log(`  score          mean ${mean(rows.map((r) => r.score)).toFixed(0)}  median ${median(rows.map((r) => r.score)).toFixed(0)}  best ${Math.max(...rows.map((r) => r.score))}`);
  console.log(`  fireflies      mean ${mean(rows.map((r) => r.collected)).toFixed(1)} a run, ${(mean(rows.map((r) => r.collected)) / (mean(times) / 60)).toFixed(1)} a minute, best streak ${mean(rows.map((r) => r.bestStreak)).toFixed(1)}`);
  console.log(`  the herd       ${mean(rows.map((r) => r.spawns)).toFixed(1)} came out of a stone a run (${mean(rows.map((r) => r.forced)).toFixed(2)} forced), mean ${mean(rows.map((r) => r.meanUp)).toFixed(2)} up, ${pct(rows.filter((r) => r.hitCap).length, rows.length)} reached five`);
  console.log(`  deaths         mean ${mean(rows.map((r) => r.deaths)).toFixed(2)}   first death median ${median(rows.filter((r) => r.firstDeath > 0).map((r) => r.firstDeath)).toFixed(0)}s`);
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
  const world = makeWorld(3);
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
  console.log(`\n--- 5. THE VAULT, ${seeds} runs each, limit ${LIMIT}s ---`);
  console.log('  jumpCost is what crossing a fence costs as a multiple of walking the same distance.');
  console.log('  1.0 means a vault is exactly as cheap as open ground; 1e6 means the player never learned it.');
  console.log('');
  console.log('  jumpCost  to the limit  median life  score       fireflies  vaults/min  walked round  threat%');
  for (const jc of [1.0, 1.5, 2.0, 3.0, 5.0, 9.0, 1e6]) {
    const rows = [];
    for (const seed of seedsFor(seeds).list) rows.push(playOne(seed, { botFactory: (g) => createBot(g, { jumpCost: jc }), limit: LIMIT }));
    const times = rows.map((r) => r.time);
    const alive = rows.filter((r) => r.survived).length;
    const vpm = mean(rows.map((r) => r.vaults)) / (mean(times) / 60);
    // A detour is a journey the planner priced and decided to walk: it is the
    // count of times a fence was between the ghost and its goal and the route
    // went round. Measured as planned routes that contained no vault while a
    // fence lay on the straight line.
    const det = mean(rows.map((r) => r.bot.fenceRoutes - r.bot.plannedVaults));
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
  console.log('  player                 median life  reached limit  score    fireflies/min  vaults/min  deaths  threat%');
  const keep = {};
  const pick = seedsFor(seeds);
  if (pick.skipped) console.log(`  (--faironly: ${pick.skipped} seeds skipped for failing a fairness property, ${pick.list.length} played)`);
  for (const [name, f] of Object.entries(V)) {
    const limit = f === passiveBot ? Math.min(200, LIMIT) : LIMIT;
    const rows = [];
    for (const seed of pick.list) rows.push(playOne(seed, { botFactory: f, limit }));
    keep[name] = rows;
    const times = rows.map((r) => r.time);
    console.log(`  ${name.padEnd(21)}  ${median(times).toFixed(0).padStart(10)}s  ${pct(rows.filter((r) => r.survived).length, seeds).padStart(12)}  ${mean(rows.map((r) => r.score)).toFixed(0).padStart(7)}  ${(mean(rows.map((r) => r.collected)) / (mean(times) / 60)).toFixed(2).padStart(13)}  ${(mean(rows.map((r) => r.vaults)) / (mean(times) / 60)).toFixed(2).padStart(10)}  ${mean(rows.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${pct(mean(rows.map((r) => r.threat)), mean(times)).padStart(7)}`);
  }
  // THE ONE NUMBER, reported three ways, because in a bounded arena SCORE is
  // the wrong one and quoting it alone would answer the question wrongly.
  //
  // An arena holds a fixed nine fireflies and pays a fixed clear bonus, so a
  // player who takes twice as long scores almost the same: the score measures
  // whether you finished, not how well. What moves is TIME and RATE. On clean
  // levels the careful bot and the bot that never jumps are within 1% of each
  // other on score and 16% apart on clear time, and reporting only the first
  // would have said the mechanic does not exist when it does.
  const ca = keep['careful (jumpCost 3)'];
  const gr = keep['ground (never jumps)'];
  const sA = mean(ca.map((r) => r.score));
  const sG = mean(gr.map((r) => r.score));
  const tA = median(ca.map((r) => r.time));
  const tG = median(gr.map((r) => r.time));
  const rA = mean(ca.map((r) => r.collected)) / (mean(ca.map((r) => r.time)) / 60);
  const rG = mean(gr.map((r) => r.collected)) / (mean(gr.map((r) => r.time)) / 60);
  console.log(`\n  THE JUMP IS WORTH, careful against a player who never learned it:`);
  console.log(`    score        ${sA.toFixed(0)} against ${sG.toFixed(0)}   ${(((sA - sG) / Math.max(1, sG)) * 100).toFixed(1)}%`);
  console.log(`    time         ${tA.toFixed(0)}s against ${tG.toFixed(0)}s   ${(((tG - tA) / Math.max(1, tG)) * 100).toFixed(1)}% faster`);
  console.log(`    collection   ${rA.toFixed(2)} against ${rG.toFixed(2)} a minute   ${(((rA - rG) / Math.max(0.01, rG)) * 100).toFixed(1)}%`);
  console.log('    In a level with a fixed number of fireflies and a fixed clear bonus, score is');
  console.log('    the weakest of the three: it says whether you finished, not how well.');

  // And the arena's own question: is a hard wall a trap? The share of DEATHS
  // near it, against the share of TIME spent near it. A ratio near 1 means the
  // wall is just more ground; well above 1 means it is a place you get killed.
  const rows = keep['careful (jumpCost 3)'];
  const tT = mean(rows.map((r) => r.time));
  const dT = rows.reduce((x, r) => x + r.deaths, 0);
  if (rows[0].nearWallTime > 0 && dT > 0) {
    const tW = mean(rows.map((r) => r.nearWallTime));
    const tC = mean(rows.map((r) => r.cornerTime));
    const dW = rows.reduce((x, r) => x + r.nearWallDeaths, 0);
    const dC = rows.reduce((x, r) => x + r.cornerDeaths, 0);
    console.log(`  THE WALL: ${pct(tW, tT)} of the run within 4.0 of a wall, ${pct(dW, dT)} of deaths there, risk ratio ${(dW / dT / Math.max(1e-6, tW / tT)).toFixed(2)}x`);
    console.log(`  A CORNER: ${pct(tC, tT)} of the run within 4.0 of TWO walls, ${pct(dC, dT)} of deaths there, risk ratio ${(dC / dT / Math.max(1e-6, tC / tT)).toFixed(2)}x`);
  }
}

// How much fence does the mechanic need? This turned out to matter more than
// anything in the rules. A world of sparse SHORT fence runs is one the ghost
// walks round exactly as the skeleton does, because the end of a run is a
// passage for BOTH of them and going round costs the ghost almost nothing. The
// asymmetry only pays when a fence is long enough or closed enough that going
// round is expensive, and this sweep is what says how much of that a world
// needs before the feature exists at all.

function fenceSweep(seeds) {
  console.log(`\n--- 5c. HOW MUCH FENCE, ${seeds} runs each, careful bot, limit ${LIMIT}s ---`);
  console.log('  scale is a multiple of the stand-in world\'s own fence density. fence/1000 is metres of');
  console.log('  fence per thousand square units. blocked routes is the share of plans with a fence');
  console.log('  between the ghost and where it was going, which is the denominator the vault rate needs.');
  console.log('');
  console.log('  scale  fence/1000  gates/1000  blocked routes  vaults/min  median life  score   fireflies');
  for (const fs of [0, 0.5, 1, 2, 3, 5]) {
    const rows = [];
    let botStats = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const r = playOne(seed, { botFactory: createBot, limit: LIMIT, fence: fs });
      rows.push(r);
      botStats.push(r.bot);
    }
    // Measure the world itself over the same seeds.
    let len = 0;
    let gates = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const w = makeWorld(seed, fs);
      const b = { minX: -60, minZ: -60, maxX: 60, maxZ: 60 };
      for (const bar of w.barriers(b)) len += Math.hypot(bar.x1 - bar.x0, bar.z1 - bar.z0);
      gates += w.gates(b).length;
    }
    const area = (120 * 120) / 1000;
    const times = rows.map((r) => r.time);
    const plans = mean(botStats.map((b) => b.plans));
    const blocked = mean(botStats.map((b) => b.fenceRoutes));
    console.log(`  ${String(fs).padStart(5)}  ${(len / seeds / area).toFixed(1).padStart(10)}  ${(gates / seeds / area).toFixed(2).padStart(10)}  ${pct(blocked, plans).padStart(14)}  ${(mean(rows.map((r) => r.vaults)) / (mean(times) / 60)).toFixed(2).padStart(10)}  ${median(times).toFixed(0).padStart(10)}s  ${mean(rows.map((r) => r.score)).toFixed(0).padStart(6)}  ${mean(rows.map((r) => r.collected)).toFixed(1).padStart(9)}`);
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
  console.log('  legMax  seconds  median life  reached limit  careful score  reckless life  threat%  danger%');
  for (const leg of [0.01, 1.0, 2.0, 3.0, 4.0, 6.0, 9.0]) {
    const tuning = { chase: { ...DEFAULT_CHASE, legMax: leg } };
    const play = [];
    const wild = [];
    for (let seed = 1; seed <= seeds; seed++) {
      play.push(playOne(seed, { botFactory: createBot, tuning, limit: LIMIT }));
      wild.push(playOne(seed, { botFactory: recklessBot, tuning, limit: LIMIT }));
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
  console.log('  ghost  ratio  median life  reached limit  score   reckless life  passive 1st  threat%');
  for (const g of [4.5, 4.0, 3.6, 3.2, 3.05, 2.9, 2.7, 2.5]) {
    const tuning = { ghostSpeed: g, speeds: { ...TUNING.speeds, walk } };
    const play = [];
    const wild = [];
    const pass = [];
    for (let seed = 1; seed <= seeds; seed++) {
      play.push(playOne(seed, { botFactory: createBot, tuning, limit: LIMIT }));
      wild.push(playOne(seed, { botFactory: recklessBot, tuning, limit: LIMIT }));
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
  console.log('  schedule           median life  reached limit  score   deaths  threat%  danger%');
  for (const [name, waves] of Object.entries(V)) {
    const play = [];
    for (let seed = 1; seed <= seeds; seed++) play.push(playOne(seed, { botFactory: createBot, tuning: { waves }, limit: LIMIT }));
    const times = play.map((r) => r.time);
    console.log(`  ${name.padEnd(17)}  ${median(times).toFixed(0).padStart(10)}s  ${pct(play.filter((r) => r.survived).length, seeds).padStart(12)}  ${mean(play.map((r) => r.score)).toFixed(0).padStart(6)}  ${mean(play.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${pct(mean(play.map((r) => r.threat)), mean(times)).padStart(7)}  ${pct(mean(play.map((r) => r.panic)), mean(times)).padStart(7)}`);
  }
}

// Is the score a leaderboard? A flat distribution is not one. What is wanted is
// a long right tail that a better player can climb, and a score that separates
// two runs of the same LENGTH, which is what the streak is for.
function scoreShape(seeds) {
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, { botFactory: createBot, limit: LIMIT }));
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
      spawns: [{ id: 'v', x: -14, z: 6 }],
    });
    const f = fairOne(w, { x: -14, z: 0 });
    add('F3safeSpot   (gateless pen)', f.includes('F3safeSpot'), f.join(' ') || 'nothing fired');
  }
  {
    // F1, the chase: put the GRAVE inside the gateless pen instead. A skeleton
    // climbing out of it can never reach anybody.
    const p = pen(0, 0, 8, 8, 0);
    const w = fixedWorld({ spawn: { x: -14, z: 0 }, ...p, spawns: [{ id: 'v', x: 0, z: 0 }] });
    const f = fairOne(w, { x: -14, z: 0 });
    add('F1spawnCut  (marker in a gateless pen)', f.includes('F1spawnCut'), f.join(' ') || 'nothing fired');
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
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, ...p, props, spawns: [{ id: 'v', x: 12, z: 12 }] });
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
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, ...p, props, spawns: [{ id: 'v', x: 0, z: -8 }] });
    const f = fairOne(w, { x: 0, z: 0 });
    add('F4pin        (one gate, fence not vaultable)', f.includes('F4pin'), f.join(' ') || 'nothing fired');
  }
  {
    // The spawn is checked where the WORLD puts it, by fairness() rather than
    // by fairOne, because fairOne's sample point is snapped to open ground on
    // purpose. So the self test has to exercise the same path fairness() uses.
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, props: [{ id: 'p', x: 0, z: 0, radius: 1.2, solid: true }], spawns: [{ id: 'v', x: 8, z: 0 }] });
    const nv = createNav(w);
    nv.focus(w.spawn.x, w.spawn.z);
    add('spawn        (spawn inside a prop)', !nv.discClear(w.spawn.x, w.spawn.z, TUNING.ghostRadius), 'the ghost does not fit where the world put it');
  }
  {
    const props = [];
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2;
      props.push({ id: `r${a}`, x: 8 + Math.cos(th) * 1.7, z: Math.sin(th) * 1.7, radius: 0.62, solid: true });
    }
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, props, fireflies: [{ id: 'f', x: 8, z: 0 }], spawns: [{ id: 'v', x: -8, z: 0 }] });
    const f = fairOne(w, { x: 0, z: 0 });
    add('flyReach     (firefly walled in by props)', f.includes('flyReach') || f.includes('F2sealed'), f.join(' ') || 'nothing fired');
  }
  {
    const w = fixedWorld({ spawn: { x: 0, z: 0 }, props: [{ id: 'p', x: 6, z: 0, radius: 0.9, solid: true }], spawns: [{ id: 'v', x: 6, z: 0 }] });
    const f = fairOne(w, { x: 0, z: 0 });
    add('spawnClear  (marker under a prop)', f.includes('spawnClear'), f.join(' ') || 'nothing fired');
  }
  {
    const p = pen(0, 0, 8, 8, 1);
    p.props = [{ id: 'plug', x: p.gates[0].x, z: p.gates[0].z, radius: 0.8, solid: true }];
    const w = fixedWorld({ spawn: { x: -14, z: 0 }, ...p, spawns: [{ id: 'v', x: -14, z: 4 }] });
    const f = fairOne(w, { x: -14, z: 0 });
    add('gateWide     (prop standing in the gate)', f.includes('gateWide'), f.join(' ') || 'nothing fired');
  }

  // --- the runtime checks ---------------------------------------------------
  const liveWorld = () => makeWorld(11);
  {
    // Substepping off, one enormous frame. What maxStep prevents is not the
    // ghost ENDING inside a fence, which the resolver would tidy up anyway by
    // putting it on whichever side is nearer; it is the ghost passing THROUGH
    // one. So the broken case is a straight run at a long fence with maxStep
    // disabled, and the assertion is which side it ends up on.
    const world = fixedWorld({
      spawn: { x: -4, z: 0 },
      barriers: [{ id: 'b', x0: 0, z0: -20, x1: 0, z1: 20, half: 0.1, end0: 'free', end1: 'free' }],
      spawns: [{ id: 'v', x: -40, z: 40 }],
    });
    const game = createGame({ world, seed: 1, tuning: { maxStep: 1e9 } });
    const track = {};
    let st = game.state;
    for (let i = 0; i < 60 * 3; i++) { st = game.update(1 / 60, { x: 0, y: 0 }); crossCheck(track, game, st, 1 / 60); }
    st = game.update(2.0, { x: 1, y: 0 });
    const fired = crossCheck(track, game, st, 1 / 60);
    add('ghost-through-fence (maxStep off, dt 2.0)', fired === 'ghost-through-fence' || game.debug.ghost.x > 0,
      `ended at x ${game.debug.ghost.x.toFixed(2)} with the fence at 0`);
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
    const spawns = [];
    for (let a = 0; a < 8; a++) spawns.push({ id: `v${a}`, x: Math.cos(a) * 13, z: Math.sin(a) * 13 });
    const game = createGame({ world: fixedWorld({ spawn: { x: 0, z: 0 }, spawns }), seed: 1 });
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
    const game = createGame({ world: fixedWorld({ spawn: { x: 0, z: 0 }, spawns: [{ id: 'v', x: 30, z: 30 }] }), seed: 1 });
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
    const game = createGame({ world: fixedWorld({ spawn: { x: 0, z: 0 }, props, spawns: [{ id: 'v', x: 30, z: 30 }] }), seed: 1 });
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
      spawns: [{ id: 'v', x: -30, z: 30 }],
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
      spawns: [{ id: 'v', x: -30, z: 30 }],
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
      spawns: [{ id: 'v', x: -6, z: 0 }],
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

  {
    // ghost-jammed: hold full stick into a fence for twelve seconds. The
    // velocity reads full speed the whole time, which is exactly why this
    // check exists and why nothing else catches it.
    const world = fixedWorld({
      spawn: { x: -2, z: 0 },
      barriers: [{ id: 'b', x0: 0, z0: -20, x1: 0, z1: 20, half: 0.1, end0: 'free', end1: 'free' }],
      spawns: [{ id: 'v', x: -40, z: 40 }],
    });
    const game = createGame({ world, seed: 1 });
    const jam = { t: 0, x: 0, z: 0, dt: 1 / 60 };
    let fired = null;
    let st = game.state;
    for (let i = 0; i < 60 * 20 && !fired; i++) {
      st = game.update(1 / 60, { x: 1, y: 0 });
      fired = jamCheck(jam, st);
    }
    add('ghost-jammed  (full stick into a fence)', fired === 'ghost-jammed',
      fired ? `caught, and the published speed was ${st.ghost.speed.toFixed(2)} throughout` : 'not caught');
  }

  {
    // skeleton-stalled: a herd that cannot move at all. Setting the walk to
    // zero is the cleanest way to produce the symptom the check exists for,
    // which is a hunting skeleton that goes nowhere.
    const game = createGame({
      world: fixedWorld({ spawn: { x: 0, z: 0 }, spawns: [{ id: 'v', x: 12, z: 0 }] }),
      seed: 1,
      tuning: { speeds: { walk: 0.0001 } },
    });
    const track = {};
    let st = game.state;
    for (let i = 0; i < 60 * 90; i++) {
      st = game.update(1 / 60, { x: 0, y: 0 });
      stallCheck(track, st, 1 / 60);
    }
    // The verdict is a rate and is taken at the end, so the case has to be
    // PLAYED OUT rather than stopped at the first frame that trips. chase.js
    // retires a skeleton that goes nowhere, so this herd cycles: climb out,
    // fail to move, give up, climb out again. Every one of those seconds above
    // ground is a second spent going nowhere, which is the shape a broken
    // steering makes and is what the share is for.
    const fired = stallVerdict(track);
    const sum = track.total || { hunt: 0, nowhere: 0 };
    add('skeleton-stalled (a herd that cannot walk)', fired === 'skeleton-stalled',
      fired ? `${(100 * sum.nowhere / Math.max(1e-9, sum.hunt)).toFixed(0)}% of ${sum.hunt.toFixed(0)}s above ground went nowhere` : 'not caught');
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

const FLAGS = ['--selftest', '--fair', '--play', '--passive', '--stability', '--jump', '--fence', '--players', '--leg', '--ghostsweep', '--schedule', '--score'];
const only = args.some((a) => FLAGS.includes(a));
if (!only || has('--selftest')) selftest();
if (!only || has('--fair')) fairness(num('--fair', 300));
if (!only || has('--play')) playMany(num('--play', 120), { botFactory: createBot, limit: LIMIT }, '2. SURVIVAL, the careful bot');
if (!only || has('--passive')) playMany(num('--passive', 120), { botFactory: passiveBot, limit: Math.min(200, LIMIT) }, '3. LETHALITY, the player who never moves');
if (!only || has('--stability')) stability(num('--stability', 12));
if (has('--jump')) jumpSweep(num('--jump', 40));
if (has('--fence')) fenceSweep(num('--fence', 20));
if (has('--players')) players(num('--players', 40));
if (has('--leg')) legSweep(num('--leg', 40));
if (has('--ghostsweep')) ghostSweep(num('--ghostsweep', 40));
if (has('--schedule')) schedules(num('--schedule', 40));
if (has('--score')) scoreShape(num('--score', 200));
