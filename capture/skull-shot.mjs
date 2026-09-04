#!/usr/bin/env node
// Skull-only turntable shots. Scratch tool for the skull pass: the full figure
// takes three minutes to render four views and the head is 5% of the frame.
//
//   node capture/skull-shot.mjs --spins 0,1.571,3.142,0.785 --jaw 0 --out out/skull2/x

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 760);
const height = Number(args.h || 760);
const outDir = args.out || 'out/skull2/shot';
const jaw = Number(args.jaw || 0);
const elev = args.elev || '0.78';
const spins = String(args.spins || '0,0.785,1.571,3.142').split(',').map(Number);

const lab = await openLab({
  width,
  height,
  entry: '/skulllab.html',
  query: `elev=${elev}`,
  readyFlag: '__previewReady',
  verbose: !!args.verbose,
});
await lab.page.evaluate((o) => window.__preview.setSize(o.w, o.h), { w: width, h: height });
await mkdir(outDir, { recursive: true });

for (const spin of spins) {
  await lab.page.evaluate((o) => window.__preview.step(1 / 60, o.spin, o.jaw), { spin, jaw });
  const file = path.join(outDir, `skull-${String(spin).replace('.', 'p')}${jaw ? '-open' : ''}.png`);
  await writeFile(file, await grabPNG(lab.page));
  console.log(`  ${file}`);
}

await lab.close();
