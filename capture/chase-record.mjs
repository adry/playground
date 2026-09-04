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
// 'chase' builds the ghost and the skeleton and nothing else: a clip about two
// characters does not want a graveyard competing behind them.
const sceneMode = args.scene || 'chase';

// Which performance to shoot.
//   chase  the whole thing, and then the ghost runs and it follows
//   rise   the ghost goes to look, and the camera stays for the climb
const route = args.route === 'rise' ? 'rise' : 'chase';

// Half-height of the orthographic box, so smaller is tighter.
//
// Measured against the ghost's own launch clip rather than guessed: there the
// ghost stands about 32% of the frame's height. The shipped pages use 6.2, and
// at 6.2 in this frame it is about 17%, so matching that shot means roughly
// halving this. 'rise' goes tighter still, because its subject is a skull
// coming out of the dirt and not a figure crossing a floor.
const view = Number(args.view || (route === 'rise' ? 2.6 : 3.2));

// The scene starts the ghost at the world origin and buries the skeleton at
// world (0.57, 1.98), about two units away, which is already inside its seven
// unit wake range. So it starts climbing on the first frame and the ghost's job
// in the opening is to be somewhere worth watching from, not to trigger it.
const TO_SKULL = { x: 0.275, y: 0.961 };     // unit vector, ghost to skeleton
const AWAY = { x: -TO_SKULL.x, y: -TO_SKULL.y };
const scale = (v, k) => ({ x: v.x * k, y: v.y * k });

// The flee runs along world +X, which is EXACTLY the screen's bottom right:
// screen-right is (x - z) / sqrt(2) and screen-up is -(x + z) / sqrt(2), so
// (1, 0) lands on (0.707, -0.707). That is the direction that matters here,
// because the ghost turns to face where it is going, and a ghost running down
// the screen is a ghost you can see the eyes of. Running up the screen shows
// you a bedsheet.
//
// The chase only reads if the skeleton stays in frame, and the camera follows
// the GHOST. Full stick is about 4 units a second against the skeleton's top
// speed of 1.25, so a flat-out run leaves it behind in three seconds and spends
// the rest of the clip on empty floor. 0.30 puts the ghost at about 1.27, a
// whisker over the skeleton, so the gap barely opens at all. That matters more
// at a tight framing than a loose one: at view 3.2 the frame is only 6.4 world
// units tall, and a gap that grows by two units eats a third of it.
const FLEE = 0.30;

function chaseInput(t) {
  if (t < 0.4) return { x: 0, y: 0 };            // a hand breaks the surface
  if (t < 1.1) return scale(TO_SKULL, 0.26);     // curiosity, drifts closer
  if (t < 1.5) return { x: 0, y: 0 };            // the skull comes up
  if (t < 2.4) return scale(AWAY, 0.5);          // and he backs off fast
  if (t < 5.9) return { x: 0, y: 0 };            // watches it climb out and stand
  if (t < 8.5) return { x: 0.26, y: 0 };         // gives ground, down and right
  // Then the run, weaving gently. The weave is small on purpose: it swings the
  // ghost's yaw enough to keep the face alive without ever turning it away.
  if (t < 13.0) return { x: FLEE, y: 0.08 };
  if (t < 17.5) return { x: FLEE, y: -0.07 };
  return { x: FLEE, y: 0.05 };
}

// The climb, close up. The camera tracks the ghost, so the only way to point it
// at the skeleton is to send the ghost to stand next to it: it closes most of
// the two unit gap in the first second and then holds still, which puts the
// hole between the two of them and leaves the ghost in shot watching.
function riseInput(t) {
  if (t < 0.15) return { x: 0, y: 0 };
  // Half a metre closer and no more. The first version pushed for a full
  // second at 0.6 and covered nearly the whole two unit gap, so the ghost
  // ended up standing ON the hole and its own body hid the climb.
  if (t < 0.70) return scale(TO_SKULL, 0.45);
  // Coasts to a stop rather than braking. Braking meant a burst of input in
  // the OPPOSITE direction, and the ghost turns to face where it is going, so
  // the brake spun it round to face away from the thing it had come to watch.
  if (t < 9.0) return { x: 0, y: 0 };
  return { x: 0.30, y: 0.06 };                   // then it stands and he leaves
}

const scriptedInput = route === 'rise' ? riseInput : chaseInput;

const lab = await openLab({
  width,
  height,
  entry: '/lab/',
  // play=1 because /lab/ is the asset lineup now; the graveyard lives behind
  // that flag. Without it this waits on __ghostReady on a page that never sets
  // it and times out.
  query: `play=1&test=1&scene=${sceneMode}&view=${view}`,
  readyFlag: '__ghostReady',
  verbose: !!args.verbose,
});
console.log(`renderer  ${lab.renderer}`);
await lab.page.evaluate((o) => window.__ghost.setSize(o.w, o.h), { w: width, h: height });
await mkdir(path.dirname(outFile), { recursive: true });

const frames = Math.round(seconds * fps);
console.log(`${width}x${height} - ${fps}fps - ${seconds}s - ${frames} frames - scene=${sceneMode} view=${view} route=${route}`);

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
