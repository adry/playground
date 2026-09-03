#!/usr/bin/env node
// Drives the cloth ghost with a scripted input timeline and saves stills.
//
// The simulation is stepped by hand rather than by rAF, so a run is repeatable
// and the cloth can be inspected at exact moments — the frame where the skirt
// is trailing hardest, the frame just after landing — without a human trying
// to hit a key at the right time.
//
//   node capture/ghost-shot.mjs --at 1.0,2.4,3.2

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openLab, grabPNG, parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));
const width = Number(args.w || 800);
const height = Number(args.h || 800);
const fps = Number(args.fps || 60);
const outDir = args.out || 'out/ghost';
const shots = String(args.at || '0.6,1.8,2.6,3.4').split(',').map(Number);

// t (seconds) -> input. Walk east, stop hard, hop, then walk back.
function scriptedInput(t) {
  if (t < 0.8) return { x: 0, y: 0 };
  if (t < 2.2) return { x: 1, y: 0 };
  if (t < 2.9) return { x: 0, y: 0 };
  if (t < 2.95) return { x: 0, y: 0, jump: true };
  if (t < 4.2) return { x: 0, y: 0 };
  if (t < 5.6) return { x: -0.7, y: -0.7 };
  return { x: 0, y: 0 };
}

const lab = await openLab({
  width,
  height,
  entry: '/',
  query: 'test=1',
  readyFlag: '__ghostReady',
  verbose: !!args.verbose,
});
console.log(`renderer: ${lab.renderer}`);

await lab.page.evaluate((o) => window.__ghost.setSize(o.w, o.h), { w: width, h: height });
await mkdir(outDir, { recursive: true });

const last = Math.max(...shots);
const total = Math.ceil((last + 0.05) * fps);
const pending = [...shots].sort((a, b) => a - b);

for (let f = 0; f < total; f++) {
  const t = f / fps;
  await lab.page.evaluate(
    (o) => window.__ghost.step(o.dt, o.axis),
    { dt: 1 / fps, axis: scriptedInput(t) },
  );

  if (pending.length && t >= pending[0]) {
    const at = pending.shift();
    const png = await grabPNG(lab.page);
    const file = path.join(outDir, `t${String(at).replace('.', 'p')}.png`);
    await writeFile(file, png);
    const state = await lab.page.evaluate(() => window.__ghost.state());
    console.log(
      `  ${file}  pos=[${state.pos.map((v) => v.toFixed(2)).join(', ')}]`
      + ` hemLag=${state.hemLag.toFixed(3)} hemSpread=${state.hemSpread.toFixed(3)}`
      + ` grounded=${state.grounded}`,
    );
  }
}

await lab.close();
