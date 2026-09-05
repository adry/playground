#!/usr/bin/env node
// A strip of stills at the four beats of the dirt, at two framings.
//
//   node capture/dirt-strip.mjs
//   node capture/dirt-strip.mjs --view 6.2 --out out/dirt-strip-game.png
//
// Why two framings. An effect that only works in a close-up is not finished:
// the shipped game is orthographic at view 6.2, where a 5 cm clod is about four
// pixels, and the question the wide strip answers is whether the beats still
// read as beats at that size. The tight one (2.6, the same framing
// chase-record.mjs --route rise uses) is where the clods are legible.
//
// Same frame-stepped approach as every other recorder here: the simulation
// advances by a fixed dt whatever the software rasteriser is doing, so the
// moment each still lands on is the moment the choreography puts it at and not
// wherever the machine happened to get to.

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 520);
const height = Number(args.h || 520);
const fps = Number(args.fps || 60);
const view = Number(args.view || 2.6);
const outFile = args.out || `out/dirt-strip-${view}.png`;

// The four beats, in seconds from the moment the ghost's first step wakes the
// skeleton. The climb is EMERGE_TIME = 3.4 s and 'rising' is 2.4 s after that,
// and these are the moments perform.js's DIRT_PLAN fires at, plus a beat of
// settle so what is caught is the spray and not the frame it left the hand.
//
// The skeleton wakes on frame one (the scene buries it two units from the
// ghost, already inside its seven unit wake range), so t here is time into the
// climb with about a frame of slop.
const BEATS = [
  ['1-heave', 0.10, 'the ground heaves, before anything has broken it'],
  ['2-fist', 0.28, 'the hand punches through'],
  ['3-shoulders', 1.45, 'the skull and shoulders push earth aside'],
  ['4-stands', 3.75, 'it stands, and shrugs the last of it off'],
  ['5-after', 8.00, 'the mess it left, eight seconds later'],
];

// riseInput from chase-record.mjs, verbatim in behaviour: the ghost closes half
// a metre so the camera (which tracks HIM) is pointed at the hole, then holds
// still and watches. Copied rather than imported because that file is a
// recorder and not a module.
const TO_SKULL = { x: 0.275, y: 0.961 };
const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
function riseInput(t) {
  if (t < 0.15) return { x: 0, y: 0 };
  if (t < 0.70) return scale(TO_SKULL, 0.45);
  if (t < 9.0) return { x: 0, y: 0 };
  return { x: 0.30, y: 0.06 };
}

const lab = await openLab({
  width,
  height,
  entry: '/ghostly/',
  query: `test=1&scene=chase&view=${view}`,
  readyFlag: '__ghostReady',
  verbose: !!args.verbose,
});
console.log(`renderer  ${lab.renderer}`);
await lab.page.evaluate((o) => window.__ghost.setSize(o.w, o.h), { w: width, h: height });

const tmp = path.join(path.dirname(outFile), `.strip-${view}`);
await mkdir(tmp, { recursive: true });

const last = BEATS[BEATS.length - 1][1];
const frames = Math.round(last * fps) + 1;
let next = 0;
const shots = [];

for (let f = 0; f < frames; f++) {
  const t = f / fps;
  await lab.page.evaluate(
    (o) => window.__ghost.step(o.dt, o.axis),
    { dt: 1 / fps, axis: riseInput(t) },
  );
  while (next < BEATS.length && t >= BEATS[next][1]) {
    const [name, at, note] = BEATS[next];
    const file = path.join(tmp, `${name}.png`);
    await writeFile(file, await grabPNG(lab.page));
    // What the dirt field actually holds at this moment, so the strip is not
    // the only evidence: a clod count nobody can see is still a number that can
    // be asserted.
    const stats = await lab.page.evaluate(() => {
      const perf = (window.__skeletons || [])[0];
      return perf ? perf.metrics().dirt : null;
    });
    shots.push({ file, name, at, note, stats });
    console.log(`  ${name.padEnd(12)} t=${at.toFixed(2)}  ${note}`);
    if (stats) console.log(`      site ${JSON.stringify(stats)}`);
    next += 1;
  }
}

await mkdir(path.dirname(outFile), { recursive: true });
await new Promise((res, rej) => {
  const ff = spawn(ffmpegPath, [
    '-y',
    ...shots.flatMap((s) => ['-i', s.file]),
    '-filter_complex', `hstack=inputs=${shots.length}`,
    outFile,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => { err += d.toString(); });
  ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}\n${err.slice(-1200)}`))));
});
await rm(tmp, { recursive: true, force: true });

console.log(`  -> ${outFile}`);
await lab.close();
