#!/usr/bin/env node
// The emergence with the dirt in it, recorded.
//
//   node capture/dirt-record.mjs --route rise --seconds 12
//   node capture/dirt-record.mjs --route rise --view 6.2 --out out/dirt-game.mp4
//
// This is chase-record.mjs's pattern and its two routes, frame-stepped at a
// fixed dt so the software rasteriser cannot affect the timing of anything it
// is recording.
//
// It is a separate file for one reason, and it is a bug and not a preference:
// chase-record.mjs opens `/lab/?play=1`, and ?play= was removed from the lab
// page when the asset lineup took it over. src/lab/main.js says so in its own
// header -- "?play=1 used to be here and is gone" -- and an unrecognised flag
// there falls through to the lineup, which sets __previewReady and never
// __ghostReady, so the recorder waits out its four minute timeout on a page
// that is working perfectly. The graveyard scene it wants is /ghostly/, which
// takes the same scene= and view= flags. That file is not mine to change; the
// entry below is the whole difference.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 900);
const height = Number(args.h || 900);
const fps = Number(args.fps || 60);
const seconds = Number(args.seconds || 12);
const route = args.route === 'chase' ? 'chase' : 'rise';
// Half-height of the orthographic box, so smaller is tighter. 2.6 is
// chase-record.mjs's rise framing; 6.2 is what the shipped pages use, and the
// point of shooting both is that an effect which only works in a close-up is
// not finished.
const view = Number(args.view || (route === 'rise' ? 2.6 : 3.2));
const outFile = args.out || `out/dirt-${route}-${view}.mp4`;

const TO_SKULL = { x: 0.275, y: 0.961 };
const AWAY = { x: -TO_SKULL.x, y: -TO_SKULL.y };
const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
const FLEE = 0.30;

function chaseInput(t) {
  if (t < 0.4) return { x: 0, y: 0 };
  if (t < 1.1) return scale(TO_SKULL, 0.26);
  if (t < 1.5) return { x: 0, y: 0 };
  if (t < 2.4) return scale(AWAY, 0.5);
  if (t < 5.9) return { x: 0, y: 0 };
  if (t < 8.5) return { x: 0.26, y: 0 };
  if (t < 13.0) return { x: FLEE, y: 0.08 };
  if (t < 17.5) return { x: FLEE, y: -0.07 };
  return { x: FLEE, y: 0.05 };
}

function riseInput(t) {
  if (t < 0.15) return { x: 0, y: 0 };
  if (t < 0.70) return scale(TO_SKULL, 0.45);
  if (t < 9.0) return { x: 0, y: 0 };
  return { x: 0.30, y: 0.06 };
}

const scriptedInput = route === 'rise' ? riseInput : chaseInput;

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
await mkdir(path.dirname(outFile), { recursive: true });

const frames = Math.round(seconds * fps);
console.log(`${width}x${height} - ${fps}fps - ${seconds}s - ${frames} frames - view=${view} route=${route}`);

const ff = spawn(ffmpegPath, [
  '-y',
  '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', 'pipe:0',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
  '-maxrate', '14M', '-bufsize', '28M',
  '-g', String(fps * 2),
  '-c:a', 'aac', '-b:a', '128k',
  '-movflags', '+faststart', '-shortest',
  outFile,
], { stdio: ['pipe', 'ignore', 'pipe'] });

let ffErr = '';
ff.stderr.on('data', (d) => { ffErr += d.toString(); });
const done = new Promise((res, rej) => {
  ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}\n${ffErr.slice(-1500)}`))));
});

const started = Date.now();
for (let f = 0; f < frames; f++) {
  const t = f / fps;
  await lab.page.evaluate(
    (o) => window.__ghost.step(o.dt, o.axis),
    { dt: 1 / fps, axis: scriptedInput(t) },
  );
  const png = await grabPNG(lab.page);
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 20 === 0 || f === frames - 1) {
    const per = (Date.now() - started) / 1000 / (f + 1);
    process.stdout.write(`\r  frame ${f + 1}/${frames}  ${per.toFixed(2)}s/frame  eta ${Math.round(per * (frames - f - 1))}s   `);
  }
}
ff.stdin.end();
await done;

// What the dirt actually did, so the clip is not the only evidence.
const dirt = await lab.page.evaluate(() => {
  const perf = (window.__skeletons || [])[0];
  return perf ? { phase: perf.metrics().phase, fired: perf.metrics().dirtFired, site: perf.metrics().dirt } : null;
});
console.log(`\n  dirt ${JSON.stringify(dirt)}`);
console.log(`  -> ${outFile}`);
await lab.close();
