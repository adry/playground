#!/usr/bin/env node
// Renders the eye expression presets side by side. The lid rig is driven by
// three numbers (open / tilt / curve) and it is much faster to check the shapes
// directly than to wait for the ghost to happen to feel determined.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 700);
const height = Number(args.h || 700);
const outDir = args.out || 'out/ghost/eyes';

const PRESETS = [
  { name: 'neutral', open: 1.0, tilt: 0, curve: 0, scale: [1, 1] },
  { name: 'blink-mid', open: 0.38, tilt: 0, curve: 0, scale: [1, 1] },
  { name: 'closed', open: 0.02, tilt: 0, curve: 0, scale: [1, 1] },
  { name: 'determined', open: 0.84, tilt: -0.32, curve: 0.08, scale: [1, 1] },
  { name: 'happy', open: 0.2, tilt: 0, curve: 0.85, scale: [1, 1] },
  { name: 'startled', open: 1.0, tilt: 0.06, curve: 0, scale: [1.05, 1.05] },
];

const lab = await openLab({
  width,
  height,
  // The demo moved off the site root when the studio index landed there.
  entry: '/ghostly/',
  query: 'test=1',
  readyFlag: '__ghostReady',
  verbose: !!args.verbose,
});
await lab.page.evaluate((o) => window.__ghost.setSize(o.w, o.h), { w: width, h: height });
await mkdir(outDir, { recursive: true });

// Let the cloth settle so the head is in its resting shape.
for (let f = 0; f < 90; f++) {
  await lab.page.evaluate(() => window.__ghost.step(1 / 60, { x: 0, y: 0 }));
}

for (const p of PRESETS) {
  await lab.page.evaluate((o) => window.__ghost.setEyes(o), p);
  const png = await grabPNG(lab.page);
  const file = path.join(outDir, `${p.name}.png`);
  await writeFile(file, png);
  console.log(`  ${file}`);
}

await lab.close();
