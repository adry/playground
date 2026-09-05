// Look at the chase.
//
//   node src/game/plot-chase.mjs                 out/game/*.png
//   node src/game/plot-chase.mjs --seconds 90
//
// A table can tell you the bot cleared 93% of levels. It cannot tell you
// whether the chase is any GOOD, and the difference between four skeletons
// converging on the player from four directions and four skeletons following
// each other round the same loop does not show up in any number I could think
// of. It shows up instantly in a picture.
//
// Two pictures come out of here. `levels.png` is ten seeds side by side, which
// is layout/plot.js's own sheet and is the level generator's view. `chase-N.png`
// is one level with a minute of play drawn on top of it: the ghost's track in
// pale blue and each skeleton's in its Pac-Man colour, plus a ring where the
// player died. There used to be a cross where a skeleton was EATEN too; that
// went with the power pellet, and so did the faint stroke a frightened leg was
// drawn in.
//
// No canvas, no renderer, no three. It is the same pixel buffer and the same
// deflate the layout package already uses.

import fs from 'node:fs';
import { createLayout } from './layout/layout.js';
import { createSurface, toPNG, drawLayout, sheet, text } from './layout/plot.js';
import { makeFrame } from './layout/frame.js';
import { createGame } from './rules.js';
import { createBot, passiveBot } from './bot.js';

const args = process.argv.slice(2);
const num = (n, d) => {
  const i = args.indexOf(n);
  return i === -1 || !args[i + 1] ? d : Number(args[i + 1]);
};
const SECONDS = num('--seconds', 60);
const SCALE = num('--scale', 14);
const OUT = 'out/game';
fs.mkdirSync(OUT, { recursive: true });

// Pac-Man's own four, so anyone who has played it can read the picture without
// a legend: Blinky red, Pinky pink, Inky cyan, Clyde orange.
const TRACK = {
  chaser: [236, 84, 74, 255],
  ambusher: [246, 154, 200, 255],
  flanker: [100, 214, 226, 255],
  loner: [246, 176, 82, 255],
};
const GHOST_TRACK = [255, 255, 255, 255];

function record(seed, { seconds = SECONDS, passive = false } = {}) {
  // NOTE: this hands createGame a LAYOUT where it wants a WORLD, and has done
  // since world/ replaced layout/. It throws on the first call. Left as it is
  // rather than fixed in passing, because pointing it at world/index.js is a
  // change to what the picture is OF and not a typo.
  const layout = createLayout({ seed });
  const game = createGame({ layout, seed });
  const bot = passive ? passiveBot(game) : createBot(game);
  const dt = 1 / 60;
  const ghost = [];
  const skels = [];
  const deaths = [];
  let s = game.state;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    s = game.update(dt, bot.step(s, dt));
    // Every fourth frame is fifteen samples a second, which is dense enough
    // that a 3.05 ghost draws a continuous line at this scale.
    if (i % 4 === 0) {
      ghost.push([s.ghost.u, s.ghost.v, s.phase]);
      s.skeletons.forEach((k, j) => {
        (skels[j] ||= { name: k.name, pts: [] });
        skels[j].pts.push([k.u, k.v, k.state]);
      });
    }
    for (const e of s.events) {
      if (e.type === 'death') deaths.push([s.ghost.u, s.ghost.v]);
    }
    if (s.phase === 'cleared' || s.phase === 'over') break;
  }
  return { layout, game, state: s, ghost, skels, deaths };
}

function drawChase(seed, opts = {}) {
  const r = record(seed, opts);
  const layout = r.layout;
  const g = layout.grid.bounds;
  const w = Math.ceil((g.maxU - g.minU) * SCALE);
  const h = Math.ceil((g.maxV - g.minV) * SCALE);
  const pad = 10;
  const legend = 22;
  const surface = createSurface(w + pad * 2, h + pad * 2 + legend, [10, 11, 14, 255]);
  drawLayout(surface, layout, { ox: pad, oy: pad, scale: SCALE });

  const X = (u) => pad + (u - g.minU) * SCALE;
  const Y = (v) => pad + (g.maxV - v) * SCALE;

  // Skeletons first, so the player's line sits on top of them.
  for (const k of r.skels) {
    const c = TRACK[k.name] || [200, 200, 200, 255];
    for (let i = 1; i < k.pts.length; i++) {
      const [u0, v0, st0] = k.pts[i - 1];
      const [u1, v1, st1] = k.pts[i];
      if (st0 === 'buried' || st1 === 'buried') continue;
      surface.line(X(u0), Y(v0), X(u1), Y(v1), c, 0.72);
    }
    const last = k.pts[k.pts.length - 1];
    if (last) surface.disc(X(last[0]), Y(last[1]), SCALE * 0.34, c, 1);
  }
  for (let i = 1; i < r.ghost.length; i++) {
    const [u0, v0] = r.ghost[i - 1];
    const [u1, v1] = r.ghost[i];
    if (Math.hypot(u1 - u0, v1 - v0) > 6) continue;   // the jump back to spawn after a death
    surface.line(X(u0), Y(v0), X(u1), Y(v1), GHOST_TRACK, 0.85);
  }
  for (const [u, v] of r.deaths) {
    surface.ring(X(u), Y(v), SCALE * 0.9, [255, 90, 90, 255]);
    surface.ring(X(u), Y(v), SCALE * 1.25, [255, 90, 90, 255]);
  }
  const last = r.ghost[r.ghost.length - 1];
  if (last) surface.disc(X(last[0]), Y(last[1]), SCALE * 0.42, GHOST_TRACK, 1);

  // The legend is four coloured bars and the seed, because the tiny font in
  // plot.js only has digits.
  let lx = pad;
  const ly = pad * 2 + h;
  text(surface, 'seed ' + seed, lx, ly + 4, [220, 220, 220, 255], 2);
  lx += 70;
  for (const name of ['chaser', 'ambusher', 'flanker', 'loner']) {
    surface.rect(lx, ly + 4, lx + 26, ly + 12, TRACK[name]);
    lx += 34;
  }
  surface.rect(lx, ly + 4, lx + 26, ly + 12, GHOST_TRACK);

  const file = `${OUT}/chase-${opts.passive ? 'passive-' : ''}${seed}.png`;
  fs.writeFileSync(file, toPNG(surface));
  const s = r.state;
  console.log(`${file}  ${s.phase} at ${s.time.toFixed(0)}s, ${s.fireflies.total - s.fireflies.remaining}/${s.fireflies.total} fireflies, ${r.deaths.length} deaths, score ${s.score}`);
}

// Positional numbers are seeds, but the value of a --flag is not one.
const flagValues = new Set();
args.forEach((a, i) => { if (a.startsWith('--')) flagValues.add(i + 1); });
const seeds = args.filter((a, i) => /^\d+$/.test(a) && !flagValues.has(i)).map(Number);
const list = seeds.length ? seeds : [1, 7, 23, 42];

fs.writeFileSync(`${OUT}/levels.png`, sheet(Array.from({ length: 10 }, (_, i) => createLayout({ seed: i + 1 })), { scale: 5, cols: 5 }));
console.log(`${OUT}/levels.png  ten seeds side by side`);
for (const seed of list) drawChase(seed);
drawChase(list[0], { passive: true, seconds: 60 });
