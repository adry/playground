#!/usr/bin/env node
// Records a pumpkin turning on the spot, so the carving and the candle can be
// judged in motion rather than from stills. Same frame-stepped approach as the
// ghost recorder: the sim advances by a fixed dt regardless of how slow the
// software renderer is, so the clip is smooth however long it takes to make.
//
//   node capture/pumpkin-record.mjs --seconds 10 --variant classic --w 900 --h 900
//   node capture/pumpkin-record.mjs --row 1 --w 1600 --h 600
//
// The spin is exactly one revolution over the clip, so the geometry loops
// seamlessly. The flame does not, and deliberately: a candle that repeated on a
// ten second cycle would be the one thing in the shot that looked authored.

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
const variant = args.variant || 'classic';
const row = args.row ? 1 : 0;
const view = args.view || (row ? '' : '0.62');
const outFile = args.out || `out/pumpkin-${row ? 'row' : variant}-${width}x${height}.mp4`;

const query = [
  'prop=pumpkin',
  row ? 'row=1' : `variant=${variant}`,
  view ? `view=${view}` : '',
].filter(Boolean).join('&');

const lab = await openLab({
  width,
  height,
  entry: '/preview.html',
  query,
  readyFlag: '__previewReady',
  verbose: !!args.verbose,
});
console.log(`renderer  ${lab.renderer}`);
await lab.page.evaluate((o) => window.__preview.setSize(o.w, o.h), { w: width, h: height });
await mkdir(path.dirname(outFile), { recursive: true });

const frames = Math.round(seconds * fps);
console.log(`${width}x${height} - ${fps}fps - ${seconds}s - ${frames} frames - ${query}`);

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

// Start a little past dead-on, so the opening frame already shows a cut wall
// rather than the flattest possible view of the face.
const SPIN0 = 0.45;
const started = Date.now();
for (let f = 0; f < frames; f++) {
  const spin = SPIN0 + (f / frames) * Math.PI * 2;
  await lab.page.evaluate((o) => window.__preview.step(o.dt, o.spin), { dt: 1 / fps, spin });
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
