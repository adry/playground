#!/usr/bin/env node
// Records the skeleton's whole performance with the ghost actually in it: the
// ghost drifts over, a hand comes out of the ground, it recoils, the thing
// hauls itself out and stands, and then it follows him.
//
//   node capture/chase-record.mjs --seconds 22 --w 900 --h 900
//
// Same frame-stepped approach as the other recorders: the sim advances by a
// fixed dt regardless of how slow the software rasteriser is, so the clip is
// smooth even when a frame takes a second to draw.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 900);
const height = Number(args.h || 900);
const fps = Number(args.fps || 60);
const seconds = Number(args.seconds || 22);
const outFile = args.out || `out/chase-${width}x${height}.mp4`;

// The scene starts the ghost at the world origin and buries the skeleton at
// world (0.57, 1.98), about two units away, which is already inside its seven
// unit wake range. So it starts climbing on the first frame and the ghost's job
// in the opening is to be somewhere worth watching from, not to trigger it.
const TO_SKULL = { x: 0.275, y: 0.961 };     // unit vector, ghost to skeleton
const AWAY = { x: -TO_SKULL.x, y: -TO_SKULL.y };
const scale = (v, k) => ({ x: v.x * k, y: v.y * k });

// The chase only reads if the skeleton stays in frame, and the camera follows
// the GHOST. Full stick is about 4 units a second and the skeleton's top speed
// is 1.25, so a flat-out run leaves it behind in three seconds and the rest of
// the clip is an empty floor. At 0.33 the ghost makes about 1.4, which opens
// the gap slowly enough to stay a chase.
const FLEE = 0.33;

function scriptedInput(t) {
  if (t < 0.4) return { x: 0, y: 0 };                       // a hand breaks the surface
  if (t < 1.1) return scale(TO_SKULL, 0.26);                // curiosity, drifts closer
  if (t < 1.5) return { x: 0, y: 0 };                       // the skull comes up
  if (t < 2.4) return scale(AWAY, 0.5);                     // and he backs off fast
  if (t < 5.9) return { x: 0, y: 0 };                       // watches it climb out and stand
  if (t < 9.0) return scale(AWAY, 0.30);                    // gives ground
  if (t < 13.0) return scale(AWAY, FLEE);                   // and runs
  if (t < 17.0) return { x: 0.23, y: -0.23 };               // cuts right
  return { x: 0.31, y: 0.10 };                              // and across the front
}

const lab = await openLab({
  width,
  height,
  entry: '/lab/',
  query: 'test=1',
  readyFlag: '__ghostReady',
  verbose: !!args.verbose,
});
console.log(`renderer  ${lab.renderer}`);
await lab.page.evaluate((o) => window.__ghost.setSize(o.w, o.h), { w: width, h: height });
await mkdir(path.dirname(outFile), { recursive: true });

const frames = Math.round(seconds * fps);
console.log(`${width}x${height} - ${fps}fps - ${seconds}s - ${frames} frames`);

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
console.log(`\n  -> ${outFile}`);
await lab.close();
