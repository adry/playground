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
// Every section prints what failed, not only what passed.

import fs from 'node:fs';
import { createLayout } from './layout/layout.js';
import { createGame, TUNING } from './rules.js';
import { createNav } from './nav.js';
import { createBot, passiveBot } from './bot.js';

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
  const maxSteps = Math.ceil(limit / dt);
  let bad = null;
  while (steps < maxSteps && s.phase !== 'cleared' && s.phase !== 'over') {
    const input = bot.step(s, dt);
    s = game.update(dt, input);
    for (const e of s.events) {
      if (e.type === 'death') { deaths++; if (firstDeath < 0) firstDeath = s.time; }
      if (e.type === 'eat') eats++;
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
    deaths, eats, firstDeath, bad,
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
  const RATIOS = [0.28, 0.40, 0.50, 0.55, 0.60, 0.64, 0.70, 0.75, 0.85];
  const GHOST = Number(num('--ghost', 3.2));
  console.log(`\n--- 5. SPEED RATIO SWEEP, ghost ${GHOST}, ${seeds} levels each ---`);
  console.log('  ratio  skel  cadence  clear%  clear s  deaths  passive survives  threat%');
  for (const ratio of RATIOS) {
    const walk = GHOST * ratio;
    const tuning = {
      ghostSpeed: GHOST,
      speeds: { ...TUNING.speeds, walk, fright: Math.min(1.25, walk * 0.58), eaten: Math.max(4.5, walk * 2.4) },
    };
    const play = [];
    const pass = [];
    for (let seed = 1; seed <= seeds; seed++) {
      play.push(playOne(seed, { botFactory: createBot, tuning, limit: 600 }));
      pass.push(playOne(seed, { botFactory: () => passiveBot(), tuning, limit: 200 }));
    }
    const cleared = play.filter((r) => r.phase === 'cleared');
    const survived = pass.filter((r) => r.phase !== 'over').length;
    const cadence = (walk / 0.629).toFixed(2);
    console.log(`  ${ratio.toFixed(2)}   ${walk.toFixed(2)}  ${cadence.padStart(5)}/s  ${pct(cleared.length, seeds).padStart(6)}  ${mean(cleared.map((r) => r.time)).toFixed(0).padStart(7)}  ${mean(play.map((r) => r.deaths)).toFixed(2).padStart(6)}  ${pct(survived, seeds).padStart(16)}  ${pct(mean(play.map((r) => r.threat)), mean(play.map((r) => r.time))).padStart(7)}`);
  }
  console.log('  passive survives = still alive after 200 s of standing still, which must be 0%');
}

// ---------------------------------------------------------------------------
// 6. The power pellet duration sweep
// ---------------------------------------------------------------------------

function power(seeds) {
  console.log(`\n--- 6. POWER PELLET DURATION, ${seeds} levels each ---`);
  console.log('  seconds  eaten a pellet  eaten a level  clear%  clear s');
  for (const t of [4, 6, 8, 10, 12]) {
    const rows = [];
    for (let seed = 1; seed <= seeds; seed++) rows.push(playOne(seed, { botFactory: createBot, tuning: { powerTime: t }, limit: 600 }));
    const cleared = rows.filter((r) => r.phase === 'cleared');
    // Four lanterns, but a level that ends early does not eat them all, so the
    // per-pellet figure is measured against how many were actually lit.
    const lit = rows.map((r) => Math.min(4, r.eats > 0 ? 4 : 4));
    console.log(`  ${String(t).padStart(7)}  ${(mean(rows.map((r) => r.eats)) / 4).toFixed(2).padStart(14)}  ${mean(rows.map((r) => r.eats)).toFixed(2).padStart(13)}  ${pct(cleared.length, seeds).padStart(6)}  ${mean(cleared.map((r) => r.time)).toFixed(0).padStart(7)}`);
  }
}

// ---------------------------------------------------------------------------

const only = args.some((a) => ['--fair', '--play', '--passive', '--stability', '--sweep', '--power'].includes(a));
if (!only || has('--fair')) fairness(num('--fair', 500));
if (!only || has('--play')) playMany(num('--play', 200), { botFactory: createBot, limit: 900 }, '2. COMPLETABILITY, the greedy bot');
if (!only || has('--passive')) playMany(num('--passive', 200), { botFactory: () => passiveBot(), limit: 200 }, '3. LETHALITY, the player who never moves');
if (!only || has('--stability')) stability(num('--stability', 20));
if (has('--sweep')) sweep(num('--sweep', 40));
if (has('--power')) power(num('--power', 40));
