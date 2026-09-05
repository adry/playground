#!/usr/bin/env node
// Renders the zombie on the real scene's floor, lights and camera.
//
//   node src/ghost/props/zombie/shot.mjs --mode solo --spins 0,0.785,1.571,3.1416
//
// Kept inside the zombie's own folder so that building this character touches
// nothing outside it. It reuses capture/session.mjs, which boots vite and a
// real browser, so the page under test is the same module graph the game gets.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs } from '../../../../capture/session.mjs';

const args = parseArgs(process.argv.slice(2));
const mode = args.mode || 'solo';
const width = Number(args.w || 900);
const height = Number(args.h || 1100);
const outDir = args.out || 'out/zombie';
const spins = String(args.spins ?? '0').split(',').map(Number);
const settle = Number(args.settle || 4);
const tag = args.tag || mode;

const query = ['mode=' + mode];
if (args.pose) query.push('pose=' + args.pose);
if (args.view) query.push('view=' + args.view);
if (args.bare) query.push('bare=1');

const lab = await openLab({
  width, height,
  entry: '/src/ghost/props/zombie/lab.html',
  query: query.join('&'),
  readyFlag: '__previewReady',
  verbose: !!args.verbose,
});
await lab.page.evaluate((o) => window.__preview.setSize(o.w, o.h), { w: width, h: height });
await mkdir(outDir, { recursive: true });

const info = await lab.page.evaluate(() => window.__zombie);
console.log(`  triangles: ${info.triangles}`);
if (args.joints) console.log(JSON.stringify(info.joints, null, 2));

for (const spin of spins) {
  for (let f = 0; f < settle; f++) {
    await lab.page.evaluate((o) => window.__preview.step(1 / 60, o.spin), { spin });
  }
  const file = path.join(outDir, `${tag}-${String(spin).replace('.', 'p')}.png`);
  await writeFile(file, await grabPNG(lab.page));
  console.log(`  ${file}`);
}

await lab.close();
