#!/usr/bin/env node
// One rig on an empty floor, at three framings.
//
//   node src/ghost/props/skeleton/shot.mjs --tag before
//   node src/ghost/props/skeleton/shot.mjs --tag after --only game,close
//
// Seconds, not never. The play page and the dance stage both build a whole
// level before they will show you a skeleton, and on the capture container
// neither produced a single frame in twenty minutes, so "does the figure still
// look right" could not be answered at all. This page builds a skeleton and a
// ground plane, and comes back in about ninety seconds for all three views.
//
// --out picks where the PNGs go; the default is out/skeleton.
import { openLab, grabPNG, parseArgs } from '../../../../capture/session.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const tag = args.tag || 'after';
const out = args.out || 'out/skeleton';
mkdirSync(out, { recursive: true });

// game: the shipped orthographic half height, at the shipped canvas size, so
// the figure is exactly the pixels a player gets.
// close: the rise clip's framing.
const only = args.only ? String(args.only).split(',') : null;
const shots = [
  // The shipped game framing at the shipped canvas size: the figure is exactly
  // the pixels a player gets.
  { name: 'game', view: 9.0, w: 900, h: 700, ty: 0.75, spins: [0] },
  // The rise clip's framing, which is the close-up the figure has to hold.
  { name: 'close', view: 2.6, w: 560, h: 700, ty: 0.95, spins: [0, 2.2] },
  // The skull alone, far tighter than anything that ships, because it is 19.6%
  // of the figure and it is the part that went round the design loop three
  // times. If a dial is going to show anywhere it shows here.
  { name: 'skull', view: 0.34, w: 620, h: 620, ty: 2.20, spins: [0, 2.2] },
].filter((s) => !only || only.includes(s.name));

for (const s of shots) {
  const lab = await openLab({
    width: s.w, height: s.h, entry: '/src/ghost/props/skeleton/lab.html',
    query: `view=${s.view}&ty=${s.ty}&tris=1`,
    readyFlag: '__previewReady', verbose: false,
  });
  await lab.page.evaluate((o) => window.__preview.setSize(o.w, o.h), { w: s.w, h: s.h });
  const stats = await lab.page.evaluate(() => window.__preview.stats());
  for (const spin of s.spins) {
    await lab.page.evaluate((o) => window.__preview.step(1 / 60, o.spin), { spin });
    const f = `${out}/${tag}-${s.name}${spin ? '-turned' : ''}.png`;
    writeFileSync(f, await grabPNG(lab.page));
    console.log(`  ${f}`);
  }
  console.log(`  ${s.name}: ${JSON.stringify(stats)}`);
  await lab.close();
}
