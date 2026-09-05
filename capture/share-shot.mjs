// Drives /lab/?game=1 headless until the run is genuinely over, then writes the
// picture the share button would post.
//
//   node capture/share-shot.mjs --seed 3
//   node capture/share-shot.mjs --seed 3 --card 1     also writes the static
//                                                     unfurl card
//
// Nothing here fakes a game over: a driver plays badly, the skeletons catch the
// ghost three times, and the image comes out of the ring buffer that was
// filling the whole time. The only thing the script does that a player does not
// is read window.__share instead of clicking a link.
//
// TWO GEARS, and the reason is the software rasteriser. Every frame here is
// drawn on the CPU, and the dominant cost is the 2048 square shadow map, which
// does not care how big the canvas is: shrinking the canvas buys almost
// nothing, and a run played out frame by frame at 60 Hz costs HOURS.
//
// So the run is played in a coarse gear, one step every 0.2 s, which is the
// largest step the game is built to survive -- scene.js's own loop clamps a
// stalled frame to 1/20 -- and rules.js substeps internally, so the simulation
// is the same simulation, just sampled less often. On the last life it drops
// into a fine gear and the canvas grows, because that is the stretch the ring
// buffer keeps and the only stretch whose pixels are ever seen. The recorder
// measures the canvas on every sample and resizes its slots to suit, so the
// change of size costs nothing and is the same path a player resizing their
// window takes.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const a = parseArgs(process.argv.slice(2));
// The picture keeps just over half the frame height, so the source wants about
// twice the output's pixels for the crop to be a downsample rather than a
// stretch. A real browser gets that free from a device pixel ratio of 2.
const width = Number(a.w || 1400);
const height = Number(a.h || 1050);
const small = Number(a.small || 640);
const outDir = a.out || 'out/share';
const maxSeconds = Number(a.max || 300);

const lab = await openLab({
  width, height, entry: '/lab/',
  query: `game=1&test=1&seed=${a.seed || 3}&view=${a.view || 9}`,
  readyFlag: '__gameReady', verbose: !!a.verbose,
});
await mkdir(outDir, { recursive: true });
const setSize = (w, h) => lab.page.evaluate((o) => window.__game.setSize(o.w, o.h), { w, h });
await setSize(small, Math.round(small * height / width));

// The driver. A player who walks INTO the thing chasing them, which is the
// fastest honest way to a third death and therefore to a picture.
//
// It needs two things beyond "walk at the skeleton", and both were learned by
// watching it fail to terminate:
//
//   THE FENCE. A ghost holding a constant stick into a fence with the skeleton
//   on the far side stands there for ever, and the skeleton walks the fence
//   looking for a gate. So the driver JUMPS, which is the game's own answer to
//   a fence and needs the run-up a charging ghost already has, and if it finds
//   itself not actually moving it wanders for a moment to break the hold.
//
//   THE CIRCLE. Anything off the straight line does not terminate either: a
//   ghost at 3.05 running tangentially outpaces a skeleton at 2.15 closing
//   radially. So the line is straight, and the picture is unharmed -- a second
//   before contact the two are about two units apart, which is exactly the gap
//   share.js is looking for.
const COARSE = 1 / 5;
const FINE = 1 / 12;
const CHUNK = 10;
// Frames drawn, which is what the wall clock is actually spent on and so what
// a progress line should be keyed to. Game seconds come off the run itself.
let frames = 0;
let t = 0;
let over = false;
let big = false;
while (t < maxSeconds && !over) {
  const res = await lab.page.evaluate((o) => {
    const D = (window.__drive = window.__drive || { lastX: 0, lastZ: 0, stuck: 0, wander: 0, n: 0 });
    const foeOf = (st) => {
      let best = null;
      let bd = Infinity;
      for (const s of st.skeletons) {
        if (s.state !== 'hunting' && s.state !== 'leaving') continue;
        const d = Math.hypot(s.x - st.ghost.x, s.z - st.ghost.z);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    };
    for (let i = 0; i < o.chunk; i++) {
      const st = window.__game.state();
      const dt = st.lives <= 1 ? o.fine : o.coarse;
      D.n++;
      // Not moving means held against something. Six samples of standing still
      // buys twenty of wandering, which is enough to come off a fence.
      const moved = Math.hypot(st.ghost.x - D.lastX, st.ghost.z - D.lastZ);
      D.lastX = st.ghost.x;
      D.lastZ = st.ghost.z;
      D.stuck = moved < 0.03 ? D.stuck + 1 : 0;
      if (D.stuck > 6) { D.wander = 20; D.stuck = 0; }

      const foe = foeOf(st);
      let axis = { x: Math.cos(D.n * 0.37), y: Math.sin(D.n * 0.23) };
      if (foe && D.wander <= 0) {
        const dx = foe.x - st.ghost.x;
        const dz = foe.z - st.ghost.z;
        const L = Math.hypot(dx, dz) || 1;
        // Close enough: STAND STILL and be walked into. Charging the last two
        // units is how a ghost at 3.05 skids past a catch radius of 0.85 and
        // ends up on the far side, over and over. Standing has one outcome.
        axis = L < 2.2 ? { x: 0, y: 0 } : { x: dx / L, y: dz / L };
      }
      if (D.wander > 0) D.wander--;
      // A hop every second or so. Refused when there is no run-up, which costs
      // nothing, and over a fence when there is, which is the point.
      axis.jump = D.n % Math.max(1, Math.round(1 / dt)) === 0;
      window.__game.step(dt, axis);
    }
    const r = window.__game.run();
    const st = window.__game.state();
    return {
      over: r.over, lives: st.lives, score: r.score, flies: r.fireflies, t: r.time,
      phase: st.phase,
      sk: st.skeletons.map((s) => `${s.name}:${s.state}:${Math.hypot(s.x - st.ghost.x, s.z - st.ghost.z).toFixed(1)}`).join(' '),
    };
  }, { coarse: COARSE, fine: FINE, chunk: CHUNK });
  frames += CHUNK;
  // The run's own clock rather than a count of steps, since the steps are two
  // different lengths.
  t = res.t;
  over = res.over;
  // The last life is the one that gets photographed, so that is where the
  // pixels go.
  if (!big && res.lives <= 1) {
    await setSize(width, height);
    big = true;
    console.log(`  t=${t.toFixed(0)}s last life, canvas up to ${width}x${height}`);
  }
  if (frames % 30 === 0) {
    console.log(`  ${frames} frames, t=${t.toFixed(0)}s lives=${res.lives} ${res.phase} score=${res.score} flies=${res.flies} | ${res.sk}`);
  }
}
if (!over) { console.log('run did not end inside --max seconds'); await lab.close(); process.exit(1); }

const run = await lab.page.evaluate(() => window.__game.run());
console.log('over:', JSON.stringify(run));

// The card builds its image asynchronously, because canvas.toBlob is async and
// the whole point is that the blob is ready before anybody clicks.
await lab.page.waitForFunction(() => window.__share && window.__share.dataUrl, null, { timeout: 120000 });
const shot = await lab.page.evaluate(() => window.__share.dataUrl);
const png = Buffer.from(shot.slice(shot.indexOf(',') + 1), 'base64');
const file = path.join(outDir, `graveyard-${run.score}.png`);
await writeFile(file, png);
const dims = await lab.page.evaluate(() => {
  const i = new Image();
  i.src = window.__share.dataUrl;
  return i.decode().then(() => [i.naturalWidth, i.naturalHeight]);
});
console.log(file, png.length, 'bytes', dims.join('x'), 'canShare(files):', await lab.page.evaluate(() => window.__share.files));

// The end card itself with the picture in it, so the card and the picture can
// be judged together.
await writeFile(path.join(outDir, 'card.png'), await lab.page.screenshot({ fullPage: false }));

// The still a raw canvas grab would have given instead. This is the thing the
// feature exists in order not to post.
await writeFile(path.join(outDir, 'raw-canvas.png'), await grabPNG(lab.page));
console.log(path.join(outDir, 'card.png'), path.join(outDir, 'raw-canvas.png'));

// The static unfurl card: the same composition with the run's own facts taken
// out, cropped to the 1.91:1 X gives a link preview. One picture for the whole
// site, which is all route 2 can ever be without a server rendering one per run.
if (a.card) {
  const dataUrl = await lab.page.evaluate(() => {
    const frame = window.__share.pick();
    const big2 = window.__share.compose({
      frame: frame && frame.canvas,
      caption: {
        badge: null,
        headline: 'Sweep the graveyard before the dead find you.',
        subline: 'One skeleton at first. Five once you are any good at it.',
        stats: null,
      },
    });
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 628;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    // Taken out of the middle of the 16:9, so the caption panel survives.
    const sh = Math.round(1600 * 628 / 1200);
    g.drawImage(big2, 0, Math.round((900 - sh) / 2), 1600, sh, 0, 0, 1200, 628);
    return c.toDataURL('image/png');
  });
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  await writeFile('public/share-card.png', buf);
  console.log('public/share-card.png', buf.length, 'bytes 1200x628');
}

await lab.close();
