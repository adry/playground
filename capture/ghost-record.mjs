#!/usr/bin/env node
// Records the ghost running a scripted route, so the cloth can be judged in
// motion rather than from stills. Same frame-stepped approach as the component
// recorder: the sim advances by a fixed dt regardless of how slow rendering is.
//
//   node capture/ghost-record.mjs --seconds 9 --w 900 --h 900

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 900);
const height = Number(args.h || 900);
const fps = Number(args.fps || 60);
const seconds = Number(args.seconds || 10);
const outFile = args.out || `out/ghost-${width}x${height}.mp4`;

// A route that exercises the cloth and the face: long enough idles for a blink
// and the occasional happy squint, a hard start, a hop, and a pass over the
// rubble cluster north of the spawn so the skirt has something to drape on.
function scriptedInput(t) {
  if (t < 2.2) return { x: 0, y: 0 };
  if (t < 4.9) return { x: -0.16, y: 0.99 };
  if (t < 5.6) return { x: 0, y: 0 };
  if (t < 5.65) return { x: 0, y: 0, jump: true };
  if (t < 6.9) return { x: 0, y: 0 };
  if (t < 9.3) return { x: 0.16, y: -0.99 };
  if (t < 11.0) return { x: 0.86, y: 0.5 };
  return { x: 0, y: 0 };
}

const lab = await openLab({
  width,
  height,
  entry: '/',
  query: 'test=1',
  readyFlag: '__ghostReady',
  verbose: !!args.verbose,
});
console.log(`renderer  ${lab.renderer}`);
await lab.page.evaluate((o) => window.__ghost.setSize(o.w, o.h), { w: width, h: height });
await mkdir(path.dirname(outFile), { recursive: true });

const frames = Math.round(seconds * fps);
console.log(`${width}x${height} · ${fps}fps · ${seconds}s · ${frames} frames`);

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
