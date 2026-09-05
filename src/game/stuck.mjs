// THE STICKING PROBE. Where does the ghost stop and never start again?
//
//   node src/game/stuck.mjs                          public/levels/demo.json
//   node src/game/stuck.mjs --level public/levels/x.json
//   node src/game/stuck.mjs --seed 7                 a generated arena instead
//   node src/game/stuck.mjs --cell 0.2 --dirs 16     a finer net
//   node src/game/stuck.mjs --map out/stuck.txt      write the ascii map too
//   node src/game/stuck.mjs --seats                  the geometry-only sweep
//
// The report was "the ghost gets stuck in some places where nothing happens",
// which is a report about geometry rather than about a moment, so it is
// answered with a MAP and not with a repro of one incident. The rules run
// headless with no renderer, so the whole arena can be walked.
//
// TWO SWEEPS, AND ONLY THE FIRST ONE IS THE BUG.
//
//   THE WALK (default). Stand the ghost on every open quarter unit, hold the
//   stick in each of eight directions, and watch for it to STALL: a second and
//   a half of full stick that carries it less than a centimetre. A stall is not
//   yet a bug -- pressing into a fence stalls, and it should -- so every stall
//   is then asked the question that matters: is there ANY direction that gets
//   out of here? Where the answer is no, the ghost is TRAPPED, and because the
//   probe walked in from open ground the finding comes with the recipe that
//   produced it: stand here, hold this, and the run is over.
//
//   THE SEATS (--seats). Every cell in the arena, resolved the way the game
//   resolves a body that has ended up there, then the same escape test. This
//   finds sealed pockets whether or not anything can walk into one, which is a
//   different fault: a pocket nothing can reach is the AUTHOR's problem (see
//   world/repair.js findWedges, which is the tool for it) and not the
//   resolver's. Reported separately for exactly that reason.
//
// Each trap is reported with the colliders responsible, and responsibility is
// MEASURED rather than guessed: every collider near the trap is taken out of
// the world in turn and the escape test re-run, so what is named is the set
// whose removal actually frees the ghost. Standing next to something is not
// evidence, and in the first version of this file it produced a confident and
// entirely wrong answer -- a fence corner blamed for a wedge that a headstone
// a unit and a half away was making.
//
// The movement below mirrors rules.js moveGhost's ground branch: the same
// exponential approach to input * ghostSpeed, the same nav.resolveDisc after
// the step, the same TUNING numbers imported rather than copied. It is a mirror
// rather than a call because rules.js integrates ONE ghost from ONE spawn and
// this has to start a hundred thousand of them. --selftest is what notices if
// it drifts: it drives the real createGame down an open lane and checks this
// loop lands in the same place to a millimetre.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createNav } from './nav.js';
import { TUNING, createGame } from './rules.js';
import { createLevelWorld, normalizeLevel } from './level/format.js';

const T = TUNING;

// A second and a half of full stick, which at 3.66 units a second is 5.2 units
// of intent. Long enough that a ghost merely rounding a headstone is not
// mistaken for a stuck one.
const HOLD = 1.5;
// How far a stalled ghost is allowed to have crept over the last quarter
// second. A ghost sliding along a fence covers 0.9 in that time.
const STALL_WINDOW = 0.25;
const STALL_DIST = 0.01;
// What counts as having got somewhere, in the escape test. A tenth of the 3.22
// units a clear second carries.
const FREE = 0.30;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const dirsOf = (n) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

// Holding the stick, integrated exactly as the rules integrate it. Returns
// where it ended and whether it stalled on the way.
export function walk(nav, x, z, dx, dz, { seconds = HOLD, h = 1 / 60, stall = true } = {}) {
  let vx = 0;
  let vz = 0;
  const steps = Math.round(seconds / h);
  const back = Math.round(STALL_WINDOW / h);
  const trailX = new Float64Array(back);
  const trailZ = new Float64Array(back);
  const blend = 1 - Math.exp(-h / T.ghostAccel);
  for (let i = 0; i < steps; i++) {
    trailX[i % back] = x;
    trailZ[i % back] = z;
    nav.focus(x, z);
    vx += (dx * T.ghostSpeed - vx) * blend;
    vz += (dz * T.ghostSpeed - vz) * blend;
    x += vx * h;
    z += vz * h;
    const fixed = nav.resolveDisc(x, z, T.ghostRadius);
    x = fixed.x;
    z = fixed.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { x, z, nan: true, stalled: true, at: i * h };
    if (stall && i >= back) {
      const j = (i + 1) % back;
      if (Math.hypot(x - trailX[j], z - trailZ[j]) < STALL_DIST) {
        return { x, z, nan: false, stalled: true, at: i * h };
      }
    }
  }
  return { x, z, nan: false, stalled: false, at: seconds };
}

// How far a second of that carries on open ground: the closed form of the same
// integration, so a threshold is a fraction of what the player expects rather
// than a number somebody chose.
export function freeRun(seconds = 1.0) {
  return T.ghostSpeed * (seconds - T.ghostAccel * (1 - Math.exp(-seconds / T.ghostAccel)));
}

// The question a stalled ghost asks: is there anything I can press? Returns the
// best distance any direction achieves in one second.
export function escape(nav, x, z, dirs) {
  let best = 0;
  for (const [dx, dz] of dirs) {
    const end = walk(nav, x, z, dx, dz, { seconds: 1.0, stall: false });
    if (end.nan) return { best: 0, nan: true };
    const moved = Math.hypot(end.x - x, end.z - z);
    if (moved > best) best = moved;
  }
  return { best, nan: false };
}

// --- who is to blame ---------------------------------------------------------

// The same world with one collider taken out of it, so the escape test can be
// asked what that collider was doing. Only the three queries createNav makes
// have to be honest.
function without(world, victim) {
  const keep = (list) => list.filter((e) => e !== victim);
  return {
    get bounds() { return world.bounds; },
    barriers: (box) => keep(world.barriers(box)),
    props: (box) => keep(world.props(box)),
    gates: (box) => world.gates(box),
  };
}

const tagOf = (c) => (c.kind === 'barrier'
  ? `${c.it.jumpable === false ? 'wall' : 'fence'} ${c.it.id}`
  : `${c.it.kind}/${c.it.variant || '-'} ${c.it.id}`);

function nearby(world, x, z, reach = 0.35) {
  const r = T.ghostRadius;
  const out = [];
  for (const p of world.props(null)) {
    if (p.solid === false) continue;
    if (Math.hypot(p.x - x, p.z - z) < p.radius + r + reach) out.push({ kind: 'prop', it: p });
  }
  for (const b of world.barriers(null)) {
    if (pointSegD2(x, z, b.x0, b.z0, b.x1, b.z1) < (b.half + r + reach) ** 2) out.push({ kind: 'barrier', it: b });
  }
  return out;
}

// Which colliders are actually making this trap. One at a time first, because
// the answer is usually a pair and taking either one of a pair away opens it;
// if no single removal frees the ghost, pairs.
export function blame(world, x, z, dirs) {
  const near = nearby(world, x, z);
  const singles = [];
  for (const c of near) {
    const nav = createNav(without(world, c.it));
    nav.focus(x, z);
    if (escape(nav, x, z, dirs).best >= FREE) singles.push(c);
  }
  if (singles.length) return { culprits: singles.map(tagOf), near: near.map(tagOf) };
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const nav = createNav(without(without(world, near[i].it), near[j].it));
      nav.focus(x, z);
      if (escape(nav, x, z, dirs).best >= FREE) {
        return { culprits: [tagOf(near[i]), tagOf(near[j])], near: near.map(tagOf) };
      }
    }
  }
  return { culprits: [], near: near.map(tagOf) };
}

function pointSegD2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const ll = dx * dx + dz * dz;
  let t = ll > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return (px - (ax + dx * t)) ** 2 + (pz - (az + dz * t)) ** 2;
}

// --- the sweeps --------------------------------------------------------------

// One entry per place, not per quarter unit square.
function cluster(list, cell) {
  const out = [];
  const left = list.slice();
  while (left.length) {
    const group = [left.shift()];
    for (let i = left.length - 1; i >= 0; i--) {
      if (group.some((g) => Math.hypot(g.x - left[i].x, g.z - left[i].z) <= Math.max(cell * 1.5, 0.6))) {
        group.push(left.splice(i, 1)[0]);
        i = left.length;   // a cell may join the group through one just added
      }
    }
    out.push(group);
  }
  return out;
}

export function sweepWalk(world, { cell = 0.25, dirs = 8, seconds = HOLD } = {}) {
  const nav = createNav(world);
  const box = world.bounds;
  const dir = dirsOf(dirs);
  const nx = Math.floor((box.maxX - box.minX) / cell) + 1;
  const nz = Math.floor((box.maxZ - box.minZ) / cell) + 1;
  const grid = new Int8Array(nx * nz).fill(-1);   // -1 solid, 0 fine, 1 stalls, 2 traps
  const hits = [];
  let probed = 0;
  let stalls = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = box.minX + ix * cell;
      const z = box.minZ + iz * cell;
      nav.focus(x, z);
      if (!nav.discClear(x, z, T.ghostRadius)) continue;
      probed++;
      grid[iz * nx + ix] = 0;
      for (const [dx, dz] of dir) {
        const end = walk(nav, x, z, dx, dz, { seconds });
        if (!end.stalled) continue;
        stalls++;
        if (grid[iz * nx + ix] === 0) grid[iz * nx + ix] = 1;
        nav.focus(end.x, end.z);
        const out = escape(nav, end.x, end.z, dir);
        if (out.best >= FREE && !out.nan) continue;
        grid[iz * nx + ix] = 2;
        hits.push({
          x: end.x, z: end.z, nan: out.nan, best: out.best,
          from: { x, z }, dir: [dx, dz], after: end.at,
        });
      }
    }
  }
  return { kind: 'walk', nx, nz, cell, box, grid, hits, probed, stalls };
}

export function sweepSeats(world, { cell = 0.25, dirs = 8 } = {}) {
  const nav = createNav(world);
  const box = world.bounds;
  const dir = dirsOf(dirs);
  const nx = Math.floor((box.maxX - box.minX) / cell) + 1;
  const nz = Math.floor((box.maxZ - box.minZ) / cell) + 1;
  const grid = new Int8Array(nx * nz).fill(-1);
  const hits = [];
  let probed = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const cx = box.minX + ix * cell;
      const cz = box.minZ + iz * cell;
      nav.focus(cx, cz);
      // EVERY CELL, NOT ONLY THE OPEN ONES. A trap is by definition a place
      // where the body is overlapping something, so filtering on discClear
      // first throws away exactly what is being hunted. Each cell is instead
      // seated the way the game seats a body that has ended up there.
      const seat = nav.resolveDisc(cx, cz, T.ghostRadius);
      if (!Number.isFinite(seat.x)) {
        grid[iz * nx + ix] = 2;
        hits.push({ x: cx, z: cz, nan: true, best: 0 });
        continue;
      }
      // Deep inside something solid: further than a body from where it started,
      // which is not a place a player can be.
      if (Math.hypot(seat.x - cx, seat.z - cz) > T.ghostRadius * 2) continue;
      probed++;
      const out = escape(nav, seat.x, seat.z, dir);
      grid[iz * nx + ix] = out.best >= FREE && !out.nan ? 0 : 2;
      if (grid[iz * nx + ix] === 2) hits.push({ x: seat.x, z: seat.z, nan: out.nan, best: out.best });
    }
  }
  return { kind: 'seats', nx, nz, cell, box, grid, hits, probed, stalls: 0 };
}

export function report(world, res, { dirs = 8, verbose = true } = {}) {
  const dir = dirsOf(dirs);
  const groups = cluster(res.hits, res.cell);
  return groups.map((g) => {
    const x = g.reduce((s, e) => s + e.x, 0) / g.length;
    const z = g.reduce((s, e) => s + e.z, 0) / g.length;
    const who = verbose ? blame(world, g[0].x, g[0].z, dir) : { culprits: [], near: [] };
    return {
      x: +x.toFixed(2),
      z: +z.toFixed(2),
      hits: g.length,
      nan: g.some((e) => e.nan),
      culprits: who.culprits,
      near: who.near,
      repro: g[0].from
        ? `stand at (${g[0].from.x.toFixed(2)}, ${g[0].from.z.toFixed(2)}) and hold `
          + `(${g[0].dir[0].toFixed(2)}, ${g[0].dir[1].toFixed(2)}) for ${g[0].after.toFixed(2)}s`
        : 'seated by the resolver',
    };
  }).sort((a, b) => b.hits - a.hits);
}

export function asciiMap(res) {
  const rows = [];
  for (let iz = res.nz - 1; iz >= 0; iz--) {
    let line = '';
    for (let ix = 0; ix < res.nx; ix++) {
      const v = res.grid[iz * res.nx + ix];
      line += v < 0 ? '#' : v === 0 ? '.' : v === 1 ? ':' : 'X';
    }
    rows.push(line);
  }
  return rows.join('\n');
}

// --- the mirror's own check --------------------------------------------------
//
// walk() reproduces rules.js. This proves it still does: the real game, driven
// with the same stick from its own spawn, against this loop from the same
// place. Same numbers, same resolver, so the same answer to floating point.
export function selftest(world) {
  const game = createGame({ world, skeletons: 0 });
  for (let i = 0; i < 240; i++) game.update(1 / 60, { x: 0, y: 0 });
  const from = { x: game.state.ghost.x, z: game.state.ghost.z };
  for (let i = 0; i < 90; i++) game.update(1 / 60, { x: 1, y: 0 });
  const real = { x: game.state.ghost.x, z: game.state.ghost.z };
  const nav = createNav(world);
  nav.focus(from.x, from.z);
  const mine = walk(nav, from.x, from.z, 1, 0, { seconds: 1.5, stall: false });
  const err = Math.hypot(real.x - mine.x, real.z - mine.z);
  return { from, real, mine, err, ok: err < 1e-6 };
}

async function loadWorld(args) {
  if (args.seed) {
    const { createWorld } = await import('./world/index.js');
    return createWorld({ seed: Number(args.seed) });
  }
  const file = typeof args.level === 'string' ? args.level : 'public/levels/demo.json';
  return createLevelWorld(normalizeLevel(JSON.parse(await readFile(file, 'utf8'))));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const world = await loadWorld(args);
  const dirs = Number(args.dirs) || 8;
  const cell = Number(args.cell) || 0.25;
  const st = selftest(world);
  console.log(`mirror against rules.js: err ${st.err.toExponential(2)} ${st.ok ? 'ok' : 'DRIFTED'}`);
  console.log(`${args.seed ? `seed ${args.seed}` : (args.level || 'public/levels/demo.json')}`
    + `  cell ${cell}, ${dirs} directions, a clear second is ${freeRun().toFixed(2)} units`);
  const res = args.seats ? sweepSeats(world, { cell, dirs }) : sweepWalk(world, { cell, dirs });
  if (res.kind === 'walk') {
    console.log(`walked from ${res.probed} open cells x ${dirs}: ${res.stalls} stalls, `
      + `${res.hits.length} of them with no way out`);
  } else {
    console.log(`seated ${res.probed} cells: ${res.hits.length} with no way out`);
  }
  const found = report(world, res, { dirs });
  for (const f of found) {
    console.log(`  (${f.x}, ${f.z})  ${String(f.hits).padStart(4)} hits${f.nan ? '  NaN' : ''}`);
    console.log(`      blame: ${f.culprits.length ? f.culprits.join(' + ') : 'no single collider or pair frees it'}`);
    console.log(`      near:  ${f.near.join(', ')}`);
    console.log(`      repro: ${f.repro}`);
  }
  if (!found.length) console.log('  none');
  if (args.map) {
    const file = typeof args.map === 'string' ? args.map : 'out/stuck.txt';
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${asciiMap(res)}\n`);
    console.log(`map ${file}  (# no room for a body, . free, : stalls but escapes, X trapped)`);
  }
}
