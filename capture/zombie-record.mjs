#!/usr/bin/env node
// Records the chibi zombie's performance and MEASURES it.
//
//   node capture/zombie-record.mjs                      the clip, rise + walk
//   node capture/zombie-record.mjs --strip 1            the walk cycle as poses
//   node capture/zombie-record.mjs --numbers 1          no draw, just the maths
//   node capture/zombie-record.mjs --rig skeleton --numbers 1
//
// Frame-stepped at a fixed dt, like every other recorder here, so the software
// rasteriser cannot affect the timing: the clip is smooth even when a frame
// takes most of a second to draw.
//
// Three outputs, and the last two are the ones that settle arguments:
//
//   the clip      out/zombie-<w>x<h>.mp4
//   the strip     out/zombie-walk-strip.png, consecutive frames side by side,
//                 so the gait can be judged as POSES rather than as motion
//   the numbers   foot slip, the derived constant table, and the per-frame cost
//                 of update(), printed to stdout
//
// `--rig skeleton` runs the same performance on the skeleton rig, which is the
// check that the derived constants are proportional relationships rather than
// chibi numbers with a scale factor bolted on: every one of them should come
// back at perform.js's own hand-tuned value.

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 900);
const height = Number(args.h || 900);
const fps = Number(args.fps || 60);
const seconds = Number(args.seconds || 20);
const rig = args.rig === 'skeleton' ? 'skeleton' : 'zombie';
const route = args.route || 'rise';
const view = Number(args.view || (rig === 'skeleton' ? 2.9 : 1.75));
const numbersOnly = !!args.numbers;
const doStrip = !!args.strip;
const outFile = args.out || `out/zombie-${width}x${height}.mp4`;
const stripFile = args.stripOut || 'out/zombie-walk-strip.png';

// The walk strip. Consecutive frames, one apart at the recording's own dt,
// starting once the figure is well into its shamble. Twelve of them at 60fps is
// a fifth of a second, which is under half a step and shows nothing; the strip
// therefore samples every `stripEvery` frames so the twelve tiles span a whole
// gait cycle, and the tiles are STILL one simulation frame apart in the sense
// that matters, which is that nothing between them is interpolated.
const stripFrom = Number(args.stripFrom || 13.0);
const stripTiles = Number(args.stripTiles || 12);
const stripEvery = Number(args.stripEvery || 4);
const stripW = Number(args.stripW || 300);
const stripH = Number(args.stripH || 420);

const lab = await openLab({
  width: doStrip ? stripW : width,
  height: doStrip ? stripH : height,
  entry: '/zombie-perform-lab.html',
  query: `route=${route}&view=${view}&rig=${rig}&seed=${args.seed || 3}`,
  readyFlag: '__labReady',
  verbose: !!args.verbose,
});
console.log(`renderer  ${lab.renderer}`);
console.log(`model     ${await lab.page.evaluate(() => window.__zlab.model())}`);

const derived = await lab.page.evaluate(() => window.__zlab.derived());
console.log('\n--- derived constants ------------------------------------------');
const show = [
  ['totalHeight', 3], ['headFrac', 3], ['chibi', 3], ['wide', 3], ['waddle', 3],
  ['headInertia', 2], ['span', 4], ['ankleY', 4], ['hipSep', 4], ['armSpan', 4],
  ['toeAhead', 4], ['heelBack', 4], ['handY', 4],
  ['hipTall', 4], ['hipStalk', 4], ['hipCrouch', 4], ['buriedY', 4],
  ['halfStep', 4], ['liftBehind', 4], ['stepLength', 4], ['duty', 3],
  ['cadence', 3], ['topSpeed', 4], ['bob', 4], ['sway', 4], ['list', 4],
  ['footLift', 4], ['maxHeel', 3], ['stopRange', 3], ['stiffSide', 0],
  ['strideVsMetrics', 3],
  ['reachMargin', 4], ['headRelMax', 3], ['headPitchCap', 3], ['headGain', 4],
];
for (const [k, d] of show) {
  const v = derived[k];
  console.log(`  ${k.padEnd(14)} ${typeof v === 'number' ? v.toFixed(d) : v}`);
}
console.log(`  headSpring     k=${derived.headSpring.stiffness.toFixed(1)} c=${derived.headSpring.damping.toFixed(2)}`
  + `  f=${(Math.sqrt(derived.headSpring.stiffness) / (2 * Math.PI)).toFixed(2)}Hz`
  + `  zeta=${(derived.headSpring.damping / (2 * Math.sqrt(derived.headSpring.stiffness))).toFixed(2)}`);

if (numbersOnly) {
  // No draw at all. Runs the whole performance plus twenty extra seconds of
  // walking, so the slip figure is over dozens of stances rather than a
  // handful, and reports the phase timeline as it goes.
  const total = Number(args.seconds || 45);
  const out = await lab.page.evaluate(async (o) => {
    const marks = window.__zlab.run(Math.round(o.total * 60));
    const m = window.__zlab.metrics();
    return {
      marks,
      slip: window.__zlab.slip(),
      cost: window.__zlab.cost(),
      bench: window.__zlab.bench(3000),
      drawMs: window.__zlab.time(2),
      travel: m.travel,
      speed: m.speed,
      short: m.short,
      overLimit: m.overLimit,
      head: m.head,
    };
  }, { total });
  console.log('\n--- phases -----------------------------------------------------');
  for (const [s, t] of out.marks) console.log(`  ${String(t).padStart(6)}s  ${s}`);
  console.log('\n--- foot slip --------------------------------------------------');
  console.log(`  worst within one stance   ${out.slip.worstStanceMm} mm`);
  console.log(`  worst in a single frame   ${out.slip.worstFrameMm} mm`);
  console.log(`  mean over ${String(out.slip.stances).padStart(3)} stances      ${out.slip.meanStanceMm} mm`);
  console.log(`  toe vs where it was put   ${out.slip.worstAbsMm} mm worst, ${out.slip.meanAbsMm} mm mean`);
  console.log('\n--- reach and limits -------------------------------------------');
  console.log(`  IK out of reach  L ${out.short.L.toFixed(5)}  R ${out.short.R.toFixed(5)} m`);
  console.log(`  past joint stop  ${out.overLimit.toFixed(5)} rad`);
  console.log('\n--- cost -------------------------------------------------------');
  console.log(`  update()  ${out.bench} us/frame (bench, 3000 frames, nothing else in the loop)`);
  console.log(`  update()  ${out.cost.updateUs} us/frame (in the harness loop, which also samples slip)`);
  console.log(`  five of them  ${(out.bench * 5 / 1000).toFixed(2)} ms/frame of a 16.7 ms budget`);
  console.log(`  draw      ${out.cost.triangles} triangles, ${out.cost.calls} calls, ${out.drawMs} ms on this rasteriser`);
  console.log(`  travelled ${out.travel.toFixed(2)} m at ${out.speed.toFixed(3)} m/s`);
  await lab.close();
  process.exit(0);
}

await mkdir('out', { recursive: true });

// A contact sheet of the climb. Seeks to a list of moments with no draw in
// between and tiles what it finds, which is how the emergence gets judged
// before anybody spends twenty minutes of software rasteriser on a video.
if (args.sheet) {
  const times = String(args.sheet === true ? '0.0,0.5,1.0,1.5,2.0,2.5,3.0,3.5,4.2,5.0,6.0,8.0' : args.sheet)
    .split(',').map(Number);
  const tmp = 'out/.zombie-sheet';
  await mkdir(tmp, { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  for (let i = 0; i < times.length; i++) {
    await lab.page.evaluate((o) => window.__zlab.seek(o.t), { t: times[i] });
    await writeFile(path.join(tmp, `s${String(i).padStart(2, '0')}.png`),
      await grabPNG(lab.page));
    process.stdout.write(`\r  frame ${i + 1}/${times.length} at t=${times[i]}s   `);
  }
  const cols = Math.ceil(times.length / 2);
  await new Promise((res, rej) => {
    const ff = spawn(ffmpegPath, [
      '-y', '-framerate', '1', '-i', path.join(tmp, 's%02d.png'),
      '-filter_complex', `tile=${cols}x2:padding=4:margin=4:color=0x3a3f47`,
      '-frames:v', '1', args.sheetOut || 'out/zombie-rise-sheet.png',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}\n${err.slice(-1200)}`))));
  });
  console.log(`\n  -> ${args.sheetOut || 'out/zombie-rise-sheet.png'}  at t = ${times.join(', ')}s`);
  await lab.close();
  process.exit(0);
}

if (doStrip) {
  // The gait as poses. Seeks to the walk with no draw, then grabs `stripTiles`
  // frames and lets ffmpeg tile them.
  await lab.page.evaluate((o) => window.__zlab.seek(o.t), { t: stripFrom });
  const tmp = 'out/.zombie-strip';
  await mkdir(tmp, { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  for (let i = 0; i < stripTiles; i++) {
    for (let k = 0; k < stripEvery; k++) {
      await lab.page.evaluate(() => window.__zlab.step(1 / 60));
    }
    const png = await grabPNG(lab.page);
    await writeFile(path.join(tmp, `t${String(i).padStart(2, '0')}.png`), png);
    process.stdout.write(`\r  tile ${i + 1}/${stripTiles}   `);
  }
  const rows = 2;
  const cols = Math.ceil(stripTiles / rows);
  await new Promise((res, rej) => {
    const ff = spawn(ffmpegPath, [
      '-y', '-framerate', '1', '-i', path.join(tmp, 't%02d.png'),
      '-filter_complex', `tile=${cols}x${rows}:padding=4:margin=4:color=0x3a3f47`,
      '-frames:v', '1', stripFile,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}\n${err.slice(-1200)}`))));
  });
  console.log(`\n  -> ${stripFile}  (${cols}x${rows}, every ${stripEvery} frames from t=${stripFrom}s)`);
  const slip = await lab.page.evaluate(() => window.__zlab.slip());
  console.log(`  foot slip so far: worst stance ${slip.worstStanceMm} mm over ${slip.stances} stances`);
  await lab.close();
  process.exit(0);
}

await lab.page.evaluate((o) => window.__zlab.setSize(o.w, o.h), { w: width, h: height });
const frames = Math.round(seconds * fps);
console.log(`\n${width}x${height} - ${fps}fps - ${seconds}s - ${frames} frames - rig=${rig} view=${view}`);

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
  await lab.page.evaluate((o) => window.__zlab.step(o.dt), { dt: 1 / fps });
  const png = await grabPNG(lab.page);
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 20 === 0 || f === frames - 1) {
    const per = (Date.now() - started) / 1000 / (f + 1);
    process.stdout.write(`\r  frame ${f + 1}/${frames}  ${per.toFixed(2)}s/frame  eta ${Math.round(per * (frames - f - 1))}s   `);
  }
}
ff.stdin.end();
await done;

const slip = await lab.page.evaluate(() => window.__zlab.slip());
const cost = await lab.page.evaluate(() => window.__zlab.cost());
console.log(`\n  -> ${outFile}`);
console.log(`  foot slip: worst stance ${slip.worstStanceMm} mm, worst frame ${slip.worstFrameMm} mm, ${slip.stances} stances`);
console.log(`  update(): ${cost.updateUs} us/frame`);
await lab.close();
