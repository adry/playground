// Drives /lab/?game=1 headless until the run is genuinely over, then writes the
// picture the share button would post.
//
//   node capture/share-shot.mjs --seed 3
//   node capture/share-shot.mjs --seed 3 --card 1     also writes the static
//                                                     unfurl card
//
// Nothing here fakes a game over: the ghost wanders badly, the skeletons catch
// it three times, and the image comes out of the ring buffer that was filling
// the whole time. The only thing the script does that a player does not is read
// window.__share instead of clicking a link.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const a = parseArgs(process.argv.slice(2));
// Bigger than the game's own window on purpose. The crop keeps just over half
// the frame height, so the source needs about twice the output's pixels for the
// picture to be a downsample rather than an upscale. A real browser gets this
// free from a device pixel ratio of 2.
const width = Number(a.w || 1920);
const height = Number(a.h || 1440);
const outDir = a.out || 'out/share';
const maxSeconds = Number(a.max || 240);

const lab = await openLab({
  width, height, entry: '/lab/',
  query: `game=1&test=1&seed=${a.seed || 3}&view=${a.view || 9}`,
  readyFlag: '__gameReady', verbose: !!a.verbose,
});
await lab.page.evaluate((o) => window.__game.setSize(o.w, o.h), { w: width, h: height });
await mkdir(outDir, { recursive: true });

// A bad player. The stick swings on a slow irrational period so the ghost keeps
// moving and keeps turning, which is what makes the frames worth keeping, and
// it never runs away, which is what makes the run end.
const DT = 1 / 60;
let t = 0;
let over = false;
while (t < maxSeconds && !over) {
  over = await lab.page.evaluate((o) => {
    for (let i = 0; i < 30; i++) {
      const s = o.t + i * o.dt;
      window.__game.step(o.dt, { x: Math.cos(s * 0.9), y: Math.sin(s * 0.61) });
    }
    return window.__game.run().over;
  }, { t, dt: DT });
  t += 30 * DT;
  if (Math.round(t) % 20 === 0) {
    const r = await lab.page.evaluate(() => window.__game.run());
    console.log(`  t=${t.toFixed(0)}s score=${r.score} fireflies=${r.fireflies} lives=${r.lives}`);
  }
}
if (!over) { console.log('run did not end inside --max seconds'); await lab.close(); process.exit(1); }

const run = await lab.page.evaluate(() => window.__game.run());
console.log('over:', JSON.stringify(run));

// The card builds its image asynchronously, because canvas.toBlob is async and
// the whole point is that the blob is ready before anybody clicks.
await lab.page.waitForFunction(() => window.__share && window.__share.dataUrl, null, { timeout: 60000 });
const shot = await lab.page.evaluate(() => window.__share.dataUrl);
const png = Buffer.from(shot.slice(shot.indexOf(',') + 1), 'base64');
const file = path.join(outDir, `graveyard-${run.score}.png`);
await writeFile(file, png);
console.log(file, png.length, 'bytes');

// What the end card itself looks like with the picture in it, so the card and
// the picture can be judged together.
await writeFile(path.join(outDir, 'card.png'), await lab.page.screenshot({ fullPage: false }));
console.log(path.join(outDir, 'card.png'));

// The still the raw canvas would have given instead, for comparison. This is
// the thing the feature exists not to post.
await writeFile(path.join(outDir, 'raw-canvas.png'), await grabPNG(lab.page));

// The static unfurl card: the same composition with the run's own facts taken
// out, cropped to the 1.91:1 that X gives a link preview. One picture for the
// whole site, which is all route 2 can ever be without a server generating one
// per run.
if (a.card) {
  const dataUrl = await lab.page.evaluate(() => {
    const frame = window.__share.pick();
    const big = window.__share.compose({
      frame: frame && frame.canvas,
      caption: {
        badge: 'GRAVEYARD',
        headline: 'Sweep the graveyard before the dead find you.',
        subline: 'One skeleton at first. Five once you are any good at it.',
        stats: null,
      },
    });
    // 1200x628 is X's link card. Taken out of the middle of the 16:9 so the
    // caption panel survives the crop.
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 628;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const sh = Math.round(1600 * 628 / 1200);
    g.drawImage(big, 0, Math.round((900 - sh) / 2), 1600, sh, 0, 0, 1200, 628);
    return c.toDataURL('image/png');
  });
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  await writeFile('public/share-card.png', buf);
  console.log('public/share-card.png', buf.length, 'bytes');
}

await lab.close();
