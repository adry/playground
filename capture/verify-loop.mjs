#!/usr/bin/env node
// Proves the loop claim instead of asserting it.
//
// Frame 0 and frame (duration * fps) are the same instant in the cycle. If the
// piece really is periodic, they are the same image. Grain and dither are
// deliberately per-frame, so the seed is pinned for the comparison.
//
//   node capture/verify-loop.mjs
//   node capture/verify-loop.mjs --id contour-flow --w 512 --h 512

import { createHash } from 'node:crypto';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 480);
const height = Number(args.h || 480);
const fps = Number(args.fps || 30);
const quality = args.quality || 'draft';

const lab = await openLab({ width, height, verbose: !!args.verbose });
const catalog = await lab.page.evaluate(() => window.__lab.catalog);
const ids = args.id ? String(args.id).split(',') : catalog.map((c) => c.id);

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
let failed = 0;

for (const id of ids) {
  const info = await lab.page.evaluate((o) => window.__lab.prepare(o), { id, width, height, quality });
  const wrap = Math.round(info.duration * fps);

  const shots = [];
  for (const index of [0, wrap]) {
    // Sub-frames off: the shutter deliberately straddles the loop point, so a
    // blurred frame 0 and a blurred frame N differ for a legitimate reason.
    await lab.page.evaluate((o) => window.__lab.frame(o), { index, fps, subframes: 1, seed: 0 });
    shots.push(await grabPNG(lab.page));
  }

  const ok = shots[0].equals(shots[1]);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(14)} frame 0 ${hash(shots[0])}  frame ${wrap} ${hash(shots[1])}`);
}

await lab.close();

if (failed) {
  console.error(`\n${failed} component(s) do not loop cleanly.`);
  process.exit(1);
}
console.log('\nAll components loop seamlessly.');
