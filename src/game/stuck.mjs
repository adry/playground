// THE STICKING PROBE. Where does the ghost stop and never start again?
//
//   node src/game/stuck.mjs                          public/levels/demo.json
//   node src/game/stuck.mjs --level public/levels/x.json
//   node src/game/stuck.mjs --seed 7                 a generated arena instead
//   node src/game/stuck.mjs --cell 0.2 --dirs 16     a finer net
//   node src/game/stuck.mjs --map out/stuck.txt      write the ascii map too
//
// The report was "the ghost gets stuck in some places where nothing happens",
// which is a report about geometry and not about a moment, so it is answered
// with a MAP rather than with a repro. The rules run headless with no renderer,
// so the whole arena can be walked: stand the ghost on every quarter unit of
// open ground, hold the stick in each of eight directions for a second, and
// write down every place it did not get anywhere.
//
// WHAT COUNTS AS STUCK, and the distinction is the useful half of this file:
//
//   TRAPPED   no direction moved it more than `--free` units. There is nothing
//             the player can press. This is the bug being hunted and every one
//             of these is a lost run.
//   PINNED    some direction works and some direction that ought to slide does
//             not. A ghost pressed straight into a wall is not pinned -- it
//             slides -- so this catches the softer version of the same fault.
//
// A trapped cell is reported with its CAUSE, worked out from the geometry
// around where it came to rest rather than guessed: which pair of colliders
// has the ghost between them, and whether they are two props, a prop and a
// fence, two fence segments, or the perimeter wall. See classify().
//
// The movement below mirrors rules.js moveGhost's ground branch exactly -- the
// same exponential approach to input * ghostSpeed, the same
// nav.resolveDisc after the step, the same TUNING numbers imported rather than
// copied. It is a mirror rather than a call because rules.js integrates ONE
// ghost from ONE spawn and this has to start ten thousand of them. If moveGhost
// changes, this has to change with it, and --selftest is what notices: it drives
// the real createGame down an open lane and checks this loop lands in the same
// place to a millimetre.
import { readFile } from 'node:fs/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createNav } from './nav.js';
import { TUNING, createGame } from './rules.js';
import { createLevelWorld, normalizeLevel } from './level/format.js';

const T = TUNING;

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

// One second of holding the stick, from a standing start, integrated exactly
// as the rules integrate it.
export function walk(nav, x, z, dx, dz, { seconds = 1.0, h = 1 / 60 } = {}) {
  let vx = 0;
  let vz = 0;
  const steps = Math.round(seconds / h);
  const blend = 1 - Math.exp(-h / T.ghostAccel);
  for (let i = 0; i < steps; i++) {
    nav.focus(x, z);
    vx += (dx * T.ghostSpeed - vx) * blend;
    vz += (dz * T.ghostSpeed - vz) * blend;
    x += vx * h;
    z += vz * h;
    const fixed = nav.resolveDisc(x, z, T.ghostRadius);
    x = fixed.x;
    z = fixed.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { x, z, nan: true };
  }
  return { x, z, nan: false };
}

// How far a second of that carries on open ground: the closed form of the same
// integration, so the threshold is a fraction of what the player expects rather
// than a number somebody chose.
export function freeRun(seconds = 1.0) {
  return T.ghostSpeed * (seconds - T.ghostAccel * (1 - Math.exp(-seconds / T.ghostAccel)));
}

// What has the ghost between it and everywhere else.
//
// Two colliders WEDGE a body when the gap between them is narrower than the
// body: inflate each by the ghost's radius and ask whether the inflated shapes
// overlap. Where they do, the lens between them is a place the resolver can
// push into from either side and out of by neither, which is the whole of this
// bug. Reported as a pair, because one collider on its own can always be slid
// off.
function classify(nav, world, x, z) {
  const r = T.ghostRadius;
  const near = [];
  for (const p of world.props(null)) {
    if (p.solid === false) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < p.radius + r + 0.25) near.push({ kind: 'prop', id: p.id, tag: `${p.kind}/${p.variant || '-'}`, x: p.x, z: p.z, r: p.radius, d });
  }
  for (const b of world.barriers(null)) {
    const d = Math.sqrt(pointSegD2(x, z, b.x0, b.z0, b.x1, b.z1));
    if (d < b.half + r + 0.25) {
      near.push({
        kind: b.jumpable === false ? 'wall' : 'fence',
        id: b.id, tag: b.id, seg: b, r: b.half, d,
      });
    }
  }
  near.sort((a, b) => a.d - b.d);
  // The pair whose inflated shapes overlap: the wedge.
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      if (overlaps(near[i], near[j], r)) return { why: `${near[i].kind}+${near[j].kind}`, between: [near[i], near[j]] };
    }
  }
  if (near.length === 1) return { why: `${near[0].kind} alone`, between: [near[0]] };
  if (!near.length) return { why: 'nothing near', between: [] };
  return { why: `${near[0].kind}+${near[1].kind} (not overlapping)`, between: near.slice(0, 2) };
}

function overlaps(a, b, r) {
  const inflate = (o) => o.r + r;
  if (a.seg && b.seg) return Math.sqrt(segSegD2(a.seg, b.seg)) < inflate(a) + inflate(b);
  if (a.seg) return Math.sqrt(pointSegD2(b.x, b.z, a.seg.x0, a.seg.z0, a.seg.x1, a.seg.z1)) < inflate(a) + inflate(b);
  if (b.seg) return Math.sqrt(pointSegD2(a.x, a.z, b.seg.x0, b.seg.z0, b.seg.x1, b.seg.z1)) < inflate(a) + inflate(b);
  return Math.hypot(a.x - b.x, a.z - b.z) < inflate(a) + inflate(b);
}

function pointSegD2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const ll = dx * dx + dz * dz;
  let t = ll > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t;
  const qz = az + dz * t;
  return (px - qx) ** 2 + (pz - qz) ** 2;
}

function segSegD2(a, b) {
  return Math.min(
    pointSegD2(a.x0, a.z0, b.x0, b.z0, b.x1, b.z1),
    pointSegD2(a.x1, a.z1, b.x0, b.z0, b.x1, b.z1),
    pointSegD2(b.x0, b.z0, a.x0, a.z0, a.x1, a.z1),
    pointSegD2(b.x1, b.z1, a.x0, a.z0, a.x1, a.z1),
  );
}

// --- the sweep ---------------------------------------------------------------

export function sweep(world, {
  cell = 0.25, dirs = 8, seconds = 1.0, free = 0.30, pinned = 0.55,
} = {}) {
  const nav = createNav(world);
  const box = world.bounds;
  const expect = freeRun(seconds);
  const dir = [];
  for (let i = 0; i < dirs; i++) {
    const a = (i / dirs) * Math.PI * 2;
    dir.push([Math.cos(a), Math.sin(a)]);
  }
  const nx = Math.floor((box.maxX - box.minX) / cell) + 1;
  const nz = Math.floor((box.maxZ - box.minZ) / cell) + 1;
  const grid = new Int8Array(nx * nz).fill(-1);   // -1 not open, 0 fine, 1 pinned, 2 trapped
  const spots = [];
  let probed = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const cx = box.minX + ix * cell;
      const cz = box.minZ + iz * cell;
      nav.focus(cx, cz);
      // EVERY CELL, NOT ONLY THE OPEN ONES, and this is the correction that
      // made the probe find anything at all. A trap is by definition a place
      // where the disc is overlapping something -- a cell that is already clear
      // is a cell resolveDisc never touches -- so filtering on discClear first
      // throws away exactly the cells being hunted. Each cell is instead
      // RESOLVED the way the game resolves a ghost that has ended up there, and
      // it is the resting point that gets walked away from.
      const seat = nav.resolveDisc(cx, cz, T.ghostRadius);
      if (!Number.isFinite(seat.x) || !Number.isFinite(seat.z)) {
        grid[iz * nx + ix] = 2;
        spots.push({ x: cx, z: cz, best: 0, nan: true, why: 'resolve returned NaN', between: [] });
        continue;
      }
      // Deep inside something solid: the resolver moved it further than a body.
      // Not a place a player can be, and not this probe's business.
      if (Math.hypot(seat.x - cx, seat.z - cz) > T.ghostRadius * 2) continue;
      const x = seat.x;
      const z = seat.z;
      probed++;
      let best = 0;
      let worst = Infinity;
      let nan = false;
      for (const [dx, dz] of dir) {
        const end = walk(nav, x, z, dx, dz, { seconds });
        if (end.nan) { nan = true; break; }
        const moved = Math.hypot(end.x - x, end.z - z);
        if (moved > best) best = moved;
        if (moved < worst) worst = moved;
      }
      const flag = nan || best < free ? 2 : (worst < 1e-4 && best < pinned * expect ? 1 : 0);
      grid[iz * nx + ix] = flag;
      if (flag === 2) spots.push({ x, z, best: +best.toFixed(3), nan, ...classify(nav, world, x, z) });
    }
  }
  return {
    nx, nz, cell, box, grid, spots, probed, expect,
    trapped: spots.length,
    pinnedCount: grid.reduce((n, v) => n + (v === 1 ? 1 : 0), 0),
  };
}

// One entry per cluster of trapped cells, so a report names places and not
// quarter unit squares.
export function clusters(res) {
  const out = [];
  const left = res.spots.slice();
  while (left.length) {
    const seed = left.shift();
    const group = [seed];
    for (let i = left.length - 1; i >= 0; i--) {
      if (group.some((g) => Math.hypot(g.x - left[i].x, g.z - left[i].z) <= res.cell * 1.5)) {
        group.push(left.splice(i, 1)[0]);
        i = left.length;   // a cell may join through one just added
      }
    }
    const cx = group.reduce((s, g) => s + g.x, 0) / group.length;
    const cz = group.reduce((s, g) => s + g.z, 0) / group.length;
    out.push({
      x: +cx.toFixed(2), z: +cz.toFixed(2), cells: group.length,
      why: group[0].why,
      between: group[0].between.map((b) => `${b.tag}@${b.x !== undefined ? `${b.x.toFixed(1)},${b.z.toFixed(1)}` : 'seg'}`),
      nan: group.some((g) => g.nan),
    });
  }
  return out.sort((a, b) => b.cells - a.cells);
}

export function asciiMap(res) {
  const rows = [];
  for (let iz = 0; iz < res.nz; iz++) {
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
// place. They integrate the same numbers through the same resolver, so the
// answer is the same to floating point.
export function selftest(world) {
  const game = createGame({ world, skeletons: 0 });
  const spawn = { ...world.spawn };
  // Past the ready pause, standing still, so the comparison starts from rest.
  for (let i = 0; i < 240; i++) game.update(1 / 60, { x: 0, y: 0 });
  const from = { x: game.state.ghost.x, z: game.state.ghost.z };
  for (let i = 0; i < 60; i++) game.update(1 / 60, { x: 1, y: 0 });
  const real = { x: game.state.ghost.x, z: game.state.ghost.z };
  const nav = createNav(world);
  nav.focus(from.x, from.z);
  const mine = walk(nav, from.x, from.z, 1, 0);
  const err = Math.hypot(real.x - mine.x, real.z - mine.z);
  return { spawn, from, real, mine, err, ok: err < 1e-6 };
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
  const st = selftest(world);
  console.log(`mirror against rules.js: err ${st.err.toExponential(2)} ${st.ok ? 'ok' : 'DRIFTED'}`);
  const res = sweep(world, {
    cell: Number(args.cell) || 0.25,
    dirs: Number(args.dirs) || 8,
    seconds: Number(args.seconds) || 1.0,
  });
  console.log(`${args.seed ? `seed ${args.seed}` : (args.level || 'public/levels/demo.json')}`);
  console.log(`probed ${res.probed} open cells at ${res.cell}, ${args.dirs || 8} directions, `
    + `${res.expect.toFixed(2)} units is a clear second`);
  console.log(`TRAPPED ${res.trapped} cells   PINNED ${res.pinnedCount} cells`);
  const cl = clusters(res);
  for (const c of cl) {
    console.log(`  (${c.x}, ${c.z})  ${String(c.cells).padStart(3)} cells  ${c.why}`
      + `${c.between.length ? `  between ${c.between.join(' and ')}` : ''}${c.nan ? '  NaN' : ''}`);
  }
  if (!cl.length) console.log('  none');
  if (args.map) {
    const file = typeof args.map === 'string' ? args.map : 'out/stuck.txt';
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${asciiMap(res)}\n`);
    console.log(`map ${file}  (# solid, . free, : pinned, X trapped)`);
  }
}
