// The overnight check for the RULES half.
//
//   node src/game/soak.mjs                      everything, default sizes
//   node src/game/soak.mjs --fair 2000          fairness only, 2000 seeds
//   node src/game/soak.mjs --play 300           the greedy bot on 300 levels
//   node src/game/soak.mjs --passive 300        the player who does not move
//   node src/game/soak.mjs --stability 40       NaN, walls, corridors, big dt
//   node src/game/soak.mjs --sweep              the speed ratio sweep
//
// It is written from the RULES' side on purpose. layout-check.mjs already
// asserts the navigation properties against the generator's own geometry; this
// one asserts them against the thing that actually has to be survivable, using
// the rules' own nav, the rules' own collision radius and the rules' own idea
// of what a firefly the ghost can reach means. A level that is connected on
// paper and has a firefly the ghost's disc cannot get within a pick radius of
// is a level nobody can clear, and only this side can see that.
//
// Every section prints what failed, not only what passed, and section 0 breaks
// the game nine ways to show each check catching the thing it exists to catch,
// because a check that has never failed is a check nobody has a reason to
// believe.
//
// WHAT IT SAID LAST TIME IT WAS RUN IN FULL
// `node src/game/soak.mjs --selftest --fair 3000 --play 500 --passive 500
//  --stability 30`, about two minutes, 7 by 5 cells:
//
//   self test    all nine checks fired on their own broken case
//   fairness     3000 levels, 170.3 nodes and 23.9 junctions each, 0 failures
//                on any of connected, reach, bridge, deadend, spawn, grave or
//                a firefly off the corridor
//   greedy bot   500 levels, 94.0% cleared, 6.0% lost all three lives, none
//                timed out. Mean clear 221 s (median 218, min 166, max 329),
//                2.33 lives left of 3, 0.81 deaths a level, first death at a
//                median of 110 s, 5.76 skeletons eaten. 25.9% of the run within
//                8.0 units of a skeleton and 3.5% within 4.0.
//   passive      500 levels, 100% lost all three lives, first at a median of
//                18 s, all three inside 200 s in every single level
//   stability    3.18 million frames across ten timesteps from 1/240 to 3.0 s,
//                no NaN, nothing through a wall, nothing off the corridor, and
//                2720 one-frame slams at full stick into walls, none escaping

import fs from 'node:fs';
import { createLayout } from './layout/layout.js';
import { createGame, TUNING } from './rules.js';
import { createNav } from './nav.js';
import { createBot, passiveBot, recklessBot } from './bot.js';

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const num = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 || !args[i + 1] || args[i + 1].startsWith('--') ? d : Number(args[i + 1]);
};
const CELLS = (() => {
  const i = args.indexOf('--cells');
  return i === -1 ? [7, 5] : args[i + 1].split(',').map(Number);
})();

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

// ---------------------------------------------------------------------------
// 1. Fairness
// ---------------------------------------------------------------------------
//
// Three properties, all of them from DESIGN.md's Navigation section, all of
// them re-derived here rather than read off the generator.

function bridges(nodes) {
  // Tarjan, iterative, because a 5000 node graph on a deep maze will blow the
  // stack and this has to run on the biggest level anybody asks for.
  const n = nodes.length;
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const parentEdge = new Int32Array(n).fill(-1);
  const found = [];
  let timer = 0;
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (disc[s] !== -1) continue;
    stack.push([s, 0]);
    disc[s] = low[s] = timer++;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [u, i] = top;
      if (i < nodes[u].edges.length) {
        top[1]++;
        const v = nodes[u].edges[i];
        // Skip exactly one copy of the edge we came in by, so a genuine
        // multi-edge would still count as two ways out.
        if (parentEdge[u] === v && !top[2]) { top[2] = 1; continue; }
        if (disc[v] === -1) {
          disc[v] = low[v] = timer++;
          parentEdge[v] = u;
          stack.push([v, 0]);
        } else if (disc[v] < low[u]) low[u] = disc[v];
      } else {
        stack.pop();
        const p = parentEdge[u];
        if (p !== -1) {
          if (low[u] < low[p]) low[p] = low[u];
          if (low[u] > disc[p]) found.push([p, u]);
        }
      }
    }
  }
  return found;
}

function fairness(seeds) {
  const fail = { connected: [], reach: [], bridge: [], deadend: [], spawn: [], grave: [], flyOff: [] };
  let junctions = 0;
  let nodesTotal = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const layout = createLayout({ seed, cells: CELLS });
    const nav = createNav(layout);
    const R = TUNING.ghostRadius;
    nodesTotal += nav.nodes.length;
    junctions += nav.junctions.length;

    // One connected component, from the ghost's own spawn.
    const start = nav.nodeNear(nav.ghostSpawn.u, nav.ghostSpawn.v);
    const d = nav.distFrom(start);
    let seen = 0;
    for (let i = 0; i < nav.nodes.length; i++) if (d[i] >= 0) seen++;
    if (seen !== nav.nodes.length) fail.connected.push(seed);

    // The ghost's spawn is somewhere its own disc actually fits.
    if (!nav.discClear(nav.ghostSpawn.u, nav.ghostSpawn.v, R)) fail.spawn.push(seed);

    // Every firefly is on a corridor and reachable, and reachable means the
    // ghost's DISC can get within the pick radius, not that a point can.
    for (let i = 0; i < nav.fireflies.length; i++) {
      const f = nav.fireflies[i];
      if (!nav.onCorridor(f.u, f.v)) { fail.flyOff.push(seed); break; }
      const n = nav.nodeNear(f.u, f.v);
      const reach = d[n] >= 0 && nav.discClear(nav.nodes[n].u, nav.nodes[n].v, R)
        && Math.hypot(f.u - nav.nodes[n].u, f.v - nav.nodes[n].v) <= TUNING.pickRadius + 1e-6;
      if (!reach) { fail.reach.push(seed); break; }
    }

    // Every grave has a node the skeleton can walk out onto, and it is in the
    // same component as the player.
    for (const g of nav.graves) {
      const n = nav.nodeNear(g.u, g.v);
      if (d[n] < 0) { fail.grave.push(seed); break; }
    }

    // No dead ends, and no bridges: 2-edge-connectivity, which is the property
    // that stops a skeleton pinning the player in a corridor with one way out.
    if (nav.nodes.some((n) => n.edges.length < 2)) fail.deadend.push(seed);
    const b = bridges(nav.nodes);
    if (b.length) fail.bridge.push(seed);
  }
  console.log(`\n--- 1. FAIRNESS, ${seeds} levels, ${CELLS.join(' by ')} cells, ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
  console.log(`  ${(nodesTotal / seeds).toFixed(1)} nodes a level, ${(junctions / seeds).toFixed(1)} of them junctions`);
  for (const [k, v] of Object.entries(fail)) {
    console.log(`  ${k.padEnd(10)} ${String(v.length).padStart(5)} failed  ${pct(v.length, seeds).padStart(7)}   ${v.slice(0, 6).join(' ')}`);
  }
  return fail;
}

// ---------------------------------------------------------------------------
// 2 and 3. Completability and lethality
// ---------------------------------------------------------------------------

function playOne(seed, { botFactory, dt = 1 / 60, limit = 900, tuning, skeletons = 4, track = null }) {
  const layout = createLayout({ seed, cells: CELLS });
  const game = createGame({ layout, seed, tuning, skeletons });
  const bot = botFactory(game);
  let s = game.state;
  let steps = 0;
  let firstDeath = -1;
  let deaths = 0;
  let eats = 0;
  let powers = 0;
  const maxSteps = Math.ceil(limit / dt);
  let bad = null;
  while (steps < maxSteps && s.phase !== 'cleared' && s.phase !== 'over') {
    const input = bot.step(s, dt);
    s = game.update(dt, input);
    for (const e of s.events) {
      if (e.type === 'death') { deaths++; if (firstDeath < 0) firstDeath = s.time; }
      if (e.type === 'eat') eats++;
      if (e.type === 'power') powers++;
    }
    if (track && steps % track.every === 0) {
      track.ghost.push([s.ghost.u, s.ghost.v]);
      s.skeletons.forEach((k, i) => { (track.skels[i] ||= []).push([k.u, k.v, k.state]); });
    }
    if (!bad) bad = check(game, s);
    steps++;
  }
  return {
    seed, phase: s.phase, time: s.time, score: s.score, lives: s.lives,
    left: s.fireflies.remaining, total: s.fireflies.total,
    deaths, eats, powers, firstDeath, bad,
    threat: bot.stats.threatTime, panic: bot.stats.panicTime,
    timedOut: steps >= maxSteps,
  };
}

// The stability assertions, run on every frame of every game the soak plays,
// not only in the stability section: a NaN that only appears once in a
// thousand levels is exactly the one that will appear in the demo.
function check(game, s) {
  const nav = game.nav;
  const g = game.debug.ghost;
  if (!Number.isFinite(g.u) || !Number.isFinite(g.v) || !Number.isFinite(s.score)) return 'nan-ghost';
  if (!nav.discClear(g.u, g.v, game.tuning.ghostRadius)) return 'ghost-in-wall';
  for (const k of s.skeletons) {
    if (!Number.isFinite(k.u) || !Number.isFinite(k.v)) return 'nan-skeleton';
    // A skeleton is allowed off the corridor for exactly two reasons: it is in
    // its grave, or it is walking the straight line between the grave and the
    // nearest node. Anything else means it has left the graph.
    if (k.state === 'buried' || k.state === 'emerging' || k.state === 'leaving' || k.state === 'sinking') continue;
    if (!nav.onCorridor(k.u, k.v, 1e-6)) return 'skeleton-off-corridor';
  }
  return null;
}

function playMany(seeds, opts, title) {
  const t0 = Date.now();
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, opts));
  const cleared = rows.filter((r) => r.phase === 'cleared');
  const over = rows.filter((r) => r.phase === 'over');
  const out = rows.filter((r) => r.timedOut);
  const bad = rows.filter((r) => r.bad);
  console.log(`\n--- ${title}, ${seeds} levels, ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
  console.log(`  cleared        ${String(cleared.length).padStart(4)}  ${pct(cleared.length, seeds)}`);
  console.log(`  all lives lost ${String(over.length).padStart(4)}  ${pct(over.length, seeds)}`);
  console.log(`  ran out of time${String(out.length).padStart(4)}  ${pct(out.length, seeds)}`);
  if (cleared.length) {
    const ts = cleared.map((r) => r.time);
    console.log(`  clear time     mean ${mean(ts).toFixed(0)}s  median ${median(ts).toFixed(0)}s  min ${Math.min(...ts).toFixed(0)}s  max ${Math.max(...ts).toFixed(0)}s`);
    console.log(`  lives left     mean ${mean(cleared.map((r) => r.lives)).toFixed(2)} of ${TUNING.lives}`);
  }
  console.log(`  deaths a level mean ${mean(rows.map((r) => r.deaths)).toFixed(2)}   first death median ${median(rows.filter((r) => r.firstDeath > 0).map((r) => r.firstDeath)).toFixed(0)}s`);
  console.log(`  skeletons eaten mean ${mean(rows.map((r) => r.eats)).toFixed(2)} a level`);
  console.log(`  pellets left when it died, mean ${mean(over.map((r) => r.left)).toFixed(0)} of ${rows[0].total}`);
  console.log(`  under threat   ${pct(mean(rows.map((r) => r.threat)), mean(rows.map((r) => r.time)))} of the run within 8.0 units of a skeleton`);
  console.log(`  in real danger ${pct(mean(rows.map((r) => r.panic)), mean(rows.map((r) => r.time)))} of the run within 4.0 units`);
  if (bad.length) console.log(`  STABILITY FAILURES ${bad.length}: ${[...new Set(bad.map((r) => r.bad))].join(', ')} first seeds ${bad.slice(0, 6).map((r) => r.seed).join(' ')}`);
  else console.log('  stability      clean, no NaN, nothing through a wall, nothing off the corridor');
  return rows;
}

// ---------------------------------------------------------------------------
// 4. Stability, including the dt a backgrounded tab hands you
// ---------------------------------------------------------------------------

function stability(seeds) {
  const DTS = [1 / 240, 1 / 120, 1 / 60, 1 / 30, 1 / 20, 0.1, 0.25, 0.5, 1.0, 3.0];
  console.log(`\n--- 4. STABILITY, ${seeds} levels at each of ${DTS.length} timesteps ---`);
  console.log('  dt        frames   fails  what');
  for (const dt of DTS) {
    let frames = 0;
    const fails = new Map();
    for (let seed = 1; seed <= seeds; seed++) {
      const r = playOne(seed, { botFactory: createBot, dt, limit: 240 });
      frames += Math.round(r.time / dt);
      if (r.bad) fails.set(r.bad, (fails.get(r.bad) || 0) + 1);
    }
    const what = [...fails.entries()].map(([k, v]) => `${k} x${v}`).join(', ') || 'clean';
    const total = [...fails.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${dt.toFixed(4).padStart(7)}  ${String(frames).padStart(7)}  ${String(total).padStart(5)}  ${what}`);
  }
  // And the pathological single frame: one update carrying a whole second of
  // full-stick movement into a wall, from every node in a level.
  const layout = createLayout({ seed: 3, cells: CELLS });
  let escapes = 0;
  let tested = 0;
  for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    for (const big of [1.0, 4.0]) {
      const game = createGame({ layout, seed: 1 });
      const nav = game.nav;
      for (const n of nav.nodes) {
        game.debug.ghost.u = n.u;
        game.debug.ghost.v = n.v;
        game.debug.ghost.vu = 0;
        game.debug.ghost.vv = 0;
        game.update(big, { x: dir[0], y: dir[1] });
        tested++;
        if (!nav.discClear(game.debug.ghost.u, game.debug.ghost.v, game.tuning.ghostRadius)) escapes++;
      }
    }
  }
  console.log(`  one-frame slam: ${tested} starts, ${escapes} ended outside the corridor`);
}

// ---------------------------------------------------------------------------
// 5. The speed ratio sweep, which is what picked the numbers in rules.js
// ---------------------------------------------------------------------------

function sweep(seeds) {
  const RATIOS = [0.28, 0.40, 0.50, 0.55, 0.60, 0.64, 0.70, 0.75, 0.85, 0.95];
  const GHOST = Number(num('--ghost', 3.2));
  console.log(`\n--- 5. SPEED RATIO SWEEP, ghost ${GHOST}, ${seeds} levels each ---`);
  console.log('  careful = the risk-routing greedy bot. reckless = the same bot with the danger term off.');
  console.log('  passive = never moves; the number is seconds to its FIRST death, which is the honest');
  console.log('  lethality measure, because "it eventually dies" is true at every ratio in the table.');
  console.log('');
  console.log('  ratio  skel  cadence  careful%  deaths  reckless%  deaths  passive 1st  threat%');
  for (const ratio of RATIOS) {
    const walk = GHOST * ratio;
    const tuning = {
      ghostSpeed: GHOST,
      speeds: { ...TUNING.speeds, walk, fright: Math.min(1.25, walk * 0.58), eaten: Math.max(4.5, walk * 2.4) },
    };
    const play = [];
    const wild = [];
    const pass = [];
    for (let seed = 1; seed <= seeds; seed++) {
      play.push(playOne(seed, { botFactory: createBot, tuning, limit: 600 }));
      wild.push(playOne(seed, { botFactory: recklessBot, tuning, limit: 600 }));
      pass.push(playOne(seed, { botFactory: passiveBot, tuning, limit: 200 }));
    }
    const cl = play.filter((r) => r.phase === 'cleared').length;
    const wl = wild.filter((r) => r.phase === 'cleared').length;
    const firsts = pass.filter((r) => r.firstDeath > 0).map((r) => r.firstDeath);
    const cadence = (walk / 0.629).toFixed(2);
    console.log(`  ${ratio.toFixed(2)}   ${walk.toFixed(2)}  ${cadence.padStart(5)}/s  ${pct(cl, seeds).padStart(8)}  ${mean(play.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${pct(wl, seeds).padStart(9)}  ${mean(wild.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${(firsts.length ? median(firsts).toFixed(0) + 's' : 'NEVER').padStart(11)}  ${pct(mean(play.map((r) => r.threat)), mean(play.map((r) => r.time))).padStart(7)}`);
  }
}

// The other half of the same decision. The sweep above varies the ratio by
// moving the SKELETON, which moves its cadence with it, so it cannot separate
// "the ratio got better" from "the walk cycle got faster". This one holds the
// skeleton at a fixed, animatable pace and buys the ratio by slowing the GHOST
// down instead, which costs feel rather than animation. Reading the two tables
// together is what actually picks the numbers.
function ghostSweep(seeds) {
  const walk = Number(num('--skel', 2.05));
  const GHOSTS = [4.5, 4.0, 3.6, 3.2, 2.9, 2.7, 2.5, 2.2];
  console.log(`\n--- 5b. GHOST SPEED SWEEP, skeleton held at ${walk} (cadence ${(walk / 0.629).toFixed(2)}/s), ${seeds} levels each ---`);
  console.log('  ghost  ratio  careful%  deaths  reckless%  deaths  passive 1st  passive all 3  threat%');
  for (const g of GHOSTS) {
    const tuning = {
      ghostSpeed: g,
      speeds: { ...TUNING.speeds, walk, fright: Math.min(1.25, walk * 0.58), eaten: Math.max(4.5, walk * 2.4) },
    };
    const play = [];
    const wild = [];
    const pass = [];
    for (let seed = 1; seed <= seeds; seed++) {
      play.push(playOne(seed, { botFactory: createBot, tuning, limit: 600 }));
      wild.push(playOne(seed, { botFactory: recklessBot, tuning, limit: 600 }));
      pass.push(playOne(seed, { botFactory: passiveBot, tuning, limit: 300 }));
    }
    const cl = play.filter((r) => r.phase === 'cleared').length;
    const wl = wild.filter((r) => r.phase === 'cleared').length;
    const firsts = pass.filter((r) => r.firstDeath > 0).map((r) => r.firstDeath);
    const alls = pass.filter((r) => r.phase === 'over').map((r) => r.time);
    console.log(`  ${g.toFixed(2)}   ${(walk / g).toFixed(2)}  ${pct(cl, seeds).padStart(8)}  ${mean(play.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${pct(wl, seeds).padStart(9)}  ${mean(wild.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${(median(firsts).toFixed(0) + 's').padStart(11)}  ${(alls.length === seeds ? median(alls).toFixed(0) + 's' : `${seeds - alls.length} SURVIVED`).padStart(13)}  ${pct(mean(play.map((r) => r.threat)), mean(play.map((r) => r.time))).padStart(7)}`);
  }
}

// Is the mode schedule doing anything? Pac-Man's is most of why that game is
// playable, and a claim like that has to be measurable or it is decoration.
// Three controls: no schedule at all (chase for ever), no chase at all
// (scatter for ever, which should be trivial), and the shipped one.
function schedules(seeds) {
  const V = {
    'chase for ever':   [{ mode: 'chase', t: Infinity }],
    'scatter for ever': [{ mode: 'scatter', t: Infinity }],
    'flat 8 / 24':      Array.from({ length: 40 }, (_, i) => (i % 2 ? { mode: 'chase', t: 24 } : { mode: 'scatter', t: 8 })),
    'shipped':          TUNING.waves,
  };
  console.log(`\n--- 5c. THE MODE SCHEDULE, ${seeds} levels each ---`);
  console.log('  schedule            careful%  deaths  clear s  reckless%  threat%  danger%');
  for (const [name, waves] of Object.entries(V)) {
    const play = [];
    const wild = [];
    for (let seed = 1; seed <= seeds; seed++) {
      play.push(playOne(seed, { botFactory: createBot, tuning: { waves }, limit: 600 }));
      wild.push(playOne(seed, { botFactory: recklessBot, tuning: { waves }, limit: 600 }));
    }
    const cl = play.filter((r) => r.phase === 'cleared');
    const wl = wild.filter((r) => r.phase === 'cleared').length;
    console.log(`  ${name.padEnd(18)}  ${pct(cl.length, seeds).padStart(8)}  ${mean(play.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${mean(cl.map((r) => r.time)).toFixed(0).padStart(7)}  ${pct(wl, seeds).padStart(9)}  ${pct(mean(play.map((r) => r.threat)), mean(play.map((r) => r.time))).padStart(7)}  ${pct(mean(play.map((r) => r.panic)), mean(play.map((r) => r.time))).padStart(7)}`);
  }
}

// ---------------------------------------------------------------------------
// 6. The power pellet duration sweep
// ---------------------------------------------------------------------------

function power(seeds) {
  console.log(`\n--- 6. POWER PELLET DURATION, ${seeds} levels each ---`);
  console.log('  The per-pellet figure is the one that matters: how many skeletons the ghost runs down');
  console.log('  per lantern it lights. Under one and the pellet is not a reward, over three and the');
  console.log('  chase stops rather than reverses.');
  console.log('');
  console.log('  seconds  lanterns lit  skeletons eaten  per lantern  careful%  clear s  deaths');
  for (const t of [4, 6, 8, 10, 12, 16]) {
    const rows = [];
    for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, { botFactory: createBot, tuning: { powerTime: t }, limit: 600 }));
    const cleared = rows.filter((r) => r.phase === 'cleared');
    const lit = mean(rows.map((r) => r.powers));
    console.log(`  ${String(t).padStart(7)}  ${lit.toFixed(2).padStart(12)}  ${mean(rows.map((r) => r.eats)).toFixed(2).padStart(15)}  ${(mean(rows.map((r) => r.eats)) / Math.max(0.01, lit)).toFixed(2).padStart(11)}  ${pct(cleared.length, seeds).padStart(8)}  ${mean(cleared.map((r) => r.time)).toFixed(0).padStart(7)}  ${mean(rows.map((r) => r.deaths)).toFixed(2).padStart(6)}`);
  }
}

// ---------------------------------------------------------------------------
// 0. The self test: break the game eight ways and confirm each check fires.
// ---------------------------------------------------------------------------
//
// Everything above passed on its first full run, and a check that has never
// failed is a check nobody has any reason to believe. So each one is shown
// catching the thing it exists to catch. If a row below says MISSED, the
// corresponding all-clear in the sections above means nothing.

function selftest() {
  console.log('\n--- 0. SELF TEST, each check shown failing on purpose ---');
  const rows = [];
  const add = (what, fired, detail = '') => rows.push([what, fired, detail]);

  const layout = createLayout({ seed: 5, cells: CELLS });

  // 1. Substepping off, one enormous frame. This is the assertion that the
  //    ghost cannot pass through a wall, and the thing that makes it true is
  //    maxStep, so turning maxStep off must break it.
  {
    let escaped = 0;
    let tested = 0;
    const game = createGame({ layout, seed: 1, tuning: { maxStep: 1e9 } });
    for (const n of game.nav.nodes) {
      for (const dir of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        game.debug.ghost.u = n.u; game.debug.ghost.v = n.v;
        game.debug.ghost.vu = 0; game.debug.ghost.vv = 0;
        game.update(2.0, { x: dir[0], y: dir[1] });
        tested++;
        if (!game.nav.discClear(game.debug.ghost.u, game.debug.ghost.v, game.tuning.ghostRadius)) escaped++;
      }
    }
    add('ghost-in-wall  (maxStep disabled, dt 2.0)', escaped > 0, `${escaped} of ${tested} starts ended inside a wall`);
  }

  // 2. A NaN put straight into the ghost.
  {
    const game = createGame({ layout, seed: 1 });
    game.debug.ghost.u = NaN;
    const st = game.update(1 / 60, { x: 0, y: 0 });
    add('nan-ghost', check(game, st) === 'nan-ghost', check(game, st) || 'not caught');
  }

  // 3. A skeleton picked up and put on plot ground.
  {
    const game = createGame({ layout, seed: 1 });
    let st = game.state;
    for (let i = 0; i < 60 * 8; i++) st = game.update(1 / 60, { x: 0, y: 0 });
    const s0 = game.herd.list.find((k) => k.state === 'hunting');
    if (!s0) add('skeleton-off-corridor', false, 'no skeleton was hunting yet');
    else {
      s0.u += 3.0;
      s0.v += 3.0;
      st = game.update(0, { x: 0, y: 0 });
      // update(0) publishes without stepping, so the moved skeleton is what the
      // checker sees.
      st.skeletons.find((k) => k.id === s0.id).u = s0.u;
      st.skeletons.find((k) => k.id === s0.id).v = s0.v;
      add('skeleton-off-corridor', check(game, st) === 'skeleton-off-corridor', check(game, st) || 'not caught');
    }
  }

  // 4 to 8. The fairness checks, against a nav built on a broken graph. The
  //    fairness section reads nav.nodes, so surgery on that is surgery on
  //    exactly what it tests.
  const navOf = () => createNav(createLayout({ seed: 5, cells: CELLS }));

  {
    // A dead end: strip a node down to one edge.
    const nav = navOf();
    const victim = nav.nodes.find((n) => n.edges.length === 2);
    const gone = victim.edges.pop();
    nav.nodes[gone].edges = nav.nodes[gone].edges.filter((e) => e !== victim.id);
    add('deadend', nav.nodes.some((n) => n.edges.length < 2), `node ${victim.id} left with ${victim.edges.length} way out`);
  }
  {
    // A bridge: cut every edge out of a junction but two, on opposite sides of
    // a loop, so the graph stays connected and stops being 2-edge-connected.
    // Easiest reliable construction is to hang a two-node tail off the graph.
    const nav = navOf();
    const anchor = nav.nodes[0];
    const tail = { id: nav.nodes.length, u: 999, v: 999, a: 999, b: 999, edges: [anchor.id], dirOf: [0] };
    anchor.edges.push(tail.id);
    anchor.dirOf.push(0);
    nav.nodes.push(tail);
    const b = bridges(nav.nodes);
    add('bridge', b.length > 0, `${b.length} bridges found after hanging a tail off node 0`);
  }
  {
    // Disconnected: cut a node loose entirely.
    const nav = navOf();
    const victim = nav.nodes[Math.floor(nav.nodes.length / 2)];
    for (const e of victim.edges) nav.nodes[e].edges = nav.nodes[e].edges.filter((x) => x !== victim.id);
    victim.edges = [];
    const start = nav.nodeNear(nav.ghostSpawn.u, nav.ghostSpawn.v);
    const d = nav.distFrom(start);
    let seen = 0;
    for (let i = 0; i < nav.nodes.length; i++) if (d[i] >= 0) seen++;
    add('connected', seen !== nav.nodes.length, `${nav.nodes.length - seen} of ${nav.nodes.length} nodes unreachable`);
  }
  {
    // A firefly out on plot ground, which is the failure the layout package
    // cannot see and this side can: it is what an unclearable level looks like.
    // A first attempt just added 3.0 to both coordinates, which on a 2.0
    // lattice with a 6.0 corridor pitch lands back on a corridor about as often
    // as not, and the check did not fire. Find a genuinely closed tile.
    const nav = navOf();
    const f = nav.fireflies[10];
    let put = null;
    for (let b = 0; b < nav.th && !put; b++) {
      for (let a = 0; a < nav.tw && !put; a++) if (!nav.isOpen(a, b)) put = [nav.U(a), nav.V(b)];
    }
    f.u = put[0];
    f.v = put[1];
    add('flyOff', !nav.onCorridor(f.u, f.v), `firefly moved to plot tile at ${put[0]}, ${put[1]}`);
  }
  {
    // A firefly on the corridor but further from its node than the ghost's
    // pick radius, which is reachable on paper and not in the hand.
    // 1.4 along one axis was the first attempt and it rounds to the NEXT node,
    // 0.6 away, so the check saw a perfectly reachable firefly. The worst a
    // point on a 2.0 lattice can be from the nearest tile centre is a corner,
    // sqrt(2), so that is where it has to go.
    const nav = navOf();
    const f = nav.fireflies[10];
    const n = nav.nodes[nav.nodeNear(f.u, f.v)];
    f.u = n.u + 0.99;
    f.v = n.v + 0.99;
    const near = nav.nodeNear(f.u, f.v);
    const gap = Math.hypot(f.u - nav.nodes[near].u, f.v - nav.nodes[near].v);
    add('reach', gap > TUNING.pickRadius, `firefly ${gap.toFixed(2)} from its node, pick radius ${TUNING.pickRadius}`);
  }
  {
    // The ghost spawned somewhere its own disc does not fit.
    const nav = navOf();
    const bad = nav.discClear(nav.bounds.minU - 5, nav.bounds.minV - 5, TUNING.ghostRadius);
    add('spawn', !bad, 'a spawn outside the level is rejected');
  }

  let missed = 0;
  for (const [what, fired, detail] of rows) {
    if (!fired) missed++;
    console.log(`  ${(fired ? 'FIRED ' : 'MISSED')}  ${what.padEnd(42)}  ${detail}`);
  }
  console.log(missed ? `  ${missed} CHECKS DID NOT FIRE, so their all-clears above mean nothing` : '  every check fired on its own broken case');
}

// ---------------------------------------------------------------------------

const only = args.some((a) => ['--selftest', '--fair', '--play', '--passive', '--stability', '--sweep', '--ghostsweep', '--schedule', '--power'].includes(a));
if (!only || has('--selftest')) selftest();
if (!only || has('--fair')) fairness(num('--fair', 500));
if (!only || has('--play')) playMany(num('--play', 200), { botFactory: createBot, limit: 900 }, '2. COMPLETABILITY, the greedy bot');
if (!only || has('--passive')) playMany(num('--passive', 200), { botFactory: passiveBot, limit: 200 }, '3. LETHALITY, the player who never moves');
if (!only || has('--stability')) stability(num('--stability', 20));
if (has('--sweep')) sweep(num('--sweep', 40));
if (has('--ghostsweep')) ghostSweep(num('--ghostsweep', 40));
if (has('--schedule')) schedules(num('--schedule', 40));
if (has('--power')) power(num('--power', 40));
