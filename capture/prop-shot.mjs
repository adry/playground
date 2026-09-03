#!/usr/bin/env node
// Renders a prop on the real scene's floor and lighting, from a few angles.
// Assets are judged by looking at them, not by counting their triangles.
//
//   node capture/prop-shot.mjs --prop pumpkin

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const prop = args.prop || 'pumpkin';
const width = Number(args.w || 760);
const height = Number(args.h || 620);
const outDir = args.out || `out/props`;
const view = args.view || '1.5';
const spins = String(args.spins || '0,0.9,2.4').split(',').map(Number);
const settle = Number(args.settle || 30);

const lab = await openLab({
  width,
  height,
  entry: '/preview.html',
  query: `prop=${prop}&view=${view}`,
  readyFlag: '__previewReady',
  verbose: !!args.verbose,
});
await lab.page.evaluate((o) => window.__preview.setSize(o.w, o.h), { w: width, h: height });
await mkdir(outDir, { recursive: true });

for (const spin of spins) {
  for (let f = 0; f < settle; f++) {
    await lab.page.evaluate((o) => window.__preview.step(1 / 60, o.spin), { spin });
  }
  const file = path.join(outDir, `${prop}-${String(spin).replace('.', 'p')}.png`);
  await writeFile(file, await grabPNG(lab.page));
  console.log(`  ${file}`);
}

await lab.close();
