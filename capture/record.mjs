#!/usr/bin/env node
// Record a component to an X-ready MP4.
//
// Frames are stepped, not timed: the page renders frame N, we pull the pixels,
// and only then does frame N+1 exist. A frame that takes four seconds to
// rasterise still lands as 1/60th of a second of video, so a software renderer
// produces exactly the same file a GPU would.
//
//   node capture/record.mjs --id curl-drift --preset square
//   node capture/record.mjs --all --fps 30 --subframes 3

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { openLab, grabPNG, parseArgs, PRESETS } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const preset = PRESETS[args.preset || 'square'];
const width = Number(args.w || preset.width);
const height = Number(args.h || preset.height);
const fps = Number(args.fps || 60);
const quality = args.quality || 'high';
const subframes = Number(args.subframes || 2);
const shutter = Number(args.shutter || 0.5);
const crf = Number(args.crf || 16);
const loops = Number(args.loops || 1);
const outDir = args.outdir || 'out';

if (width % 2 || height % 2) {
  console.error('width and height must be even for yuv420p');
  process.exit(1);
}

const lab = await openLab({ width, height, verbose: !!args.verbose });
console.log(`renderer  ${lab.renderer}`);

const catalog = await lab.page.evaluate(() => window.__lab.catalog);
const ids = args.all ? catalog.map((c) => c.id) : String(args.id || catalog[0].id).split(',');

await mkdir(outDir, { recursive: true });

for (const id of ids) {
  const info = await lab.page.evaluate((o) => window.__lab.prepare(o), { id, width, height, quality });
  const duration = Number(args.duration || info.duration);
  const frames = Math.round(duration * fps) * loops;
  const outFile = path.join(outDir, `${id}-${width}x${height}.mp4`);

  console.log(`\n${info.title}`);
  console.log(`  ${width}x${height} · ${fps}fps · ${duration}s · ${frames} frames · ${subframes}x shutter · ${quality}`);

  const ff = spawn(ffmpegPath, [
    '-y',
    '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', 'pipe:0',
    // A silent stereo track: some players (and some upload paths) still treat a
    // video-only MP4 as suspect.
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-level', '4.2',
    '-g', String(fps * 2),
    '-x264-params', 'ref=4:bframes=3',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-shortest',
    outFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d.toString(); });
  const done = new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${ffErr.slice(-2000)}`))));
  });

  const started = Date.now();
  for (let i = 0; i < frames; i++) {
    await lab.page.evaluate((o) => window.__lab.frame(o), { index: i, fps, subframes, shutter });
    const png = await grabPNG(lab.page);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));

    if (i % 10 === 0 || i === frames - 1) {
      const elapsed = (Date.now() - started) / 1000;
      const per = elapsed / (i + 1);
      const eta = Math.round(per * (frames - i - 1));
      process.stdout.write(`\r  frame ${i + 1}/${frames}  ${per.toFixed(2)}s/frame  eta ${eta}s   `);
    }
  }
  ff.stdin.end();
  await done;

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n  -> ${outFile}  (${secs}s)`);
}

await lab.close();
