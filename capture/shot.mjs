#!/usr/bin/env node
// Render stills. The fastest way to art-direct a component: pull a contact
// sheet of phases, look, tweak, repeat.
//
//   node capture/shot.mjs --id curl-drift --phases 0,0.25,0.5,0.75 --quality draft

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs, PRESETS } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const preset = PRESETS[args.preset || 'square'];
const width = Number(args.w || preset.width);
const height = Number(args.h || preset.height);
const quality = args.quality || 'high';
const subframes = Number(args.subframes || 1);
const outDir = args.out || 'out/stills';
const phases = String(args.phases || '0,0.33,0.66').split(',').map(Number);

const lab = await openLab({ width, height, verbose: !!args.verbose });
console.log(`renderer: ${lab.renderer}`);

const ids = args.id
  ? String(args.id).split(',')
  : (await lab.page.evaluate(() => window.__lab.catalog.map((c) => c.id)));

await mkdir(outDir, { recursive: true });

for (const id of ids) {
  const info = await lab.page.evaluate(
    (o) => window.__lab.prepare(o),
    { id, width, height, quality },
  );
  for (const phase of phases) {
    const t0 = Date.now();
    const frameIndex = Math.round(phase * info.duration * 60);
    await lab.page.evaluate((o) => window.__lab.frame(o), { index: frameIndex, fps: 60, subframes });
    const png = await grabPNG(lab.page);
    const file = path.join(outDir, `${id}-${String(phase).replace('.', 'p')}.png`);
    await writeFile(file, png);
    console.log(`  ${file}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${(png.length / 1024).toFixed(0)} KB)`);
  }
}

await lab.close();
