#!/usr/bin/env node
// Bench for the skeleton's motion utilities. Two jobs, one file:
//
//   node capture/debris-test.mjs --spring          numeric Spring stability run
//   node capture/debris-test.mjs --cam side        contact strip of a debris drop
//
// The strip is one PNG with nine labelled frames in it, because judging an arc
// means seeing the frames next to each other, not flipping between files.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './session.mjs';

const args = parseArgs(process.argv.slice(2));

// --- Spring ------------------------------------------------------------------

async function springRun() {
  const mod = await import(pathToFileURL(path.resolve('src/ghost/props/skeleton/motion.js')).href);
  const { Spring, easeOutBack, easeInOutCubic, easeOutElastic } = mod;

  const RATES = [
    ['1/144', 1 / 144],
    ['1/60', 1 / 60],
    ['1/20', 1 / 20],
  ];

  // A spread of characters, including two nobody would call safe: a jaw stiff
  // enough that explicit Euler leaves the building at 50ms, and a torture case
  // whose period is shorter than a single 1/20 step.
  const CASES = [
    ['critical  k=120 c=21.9', 120, 2 * Math.sqrt(120)],
    ['snappy    k=300 c=18', 300, 18],
    ['jaw clack k=600 c=12', 600, 12],
    ['torture   k=2000 c=20', 2000, 20],
  ];

  const SAMPLES = [0.1, 0.25, 0.5, 1.0];
  const DURATION = 3;

  console.log('Spring: target 1 from rest, 3s, same spring at three frame rates.\n');
  for (const [name, k, c] of CASES) {
    console.log(name);
    const rows = [];
    for (const [label, dt] of RATES) {
      const s = new Spring({ stiffness: k, damping: c, value: 0 });
      s.target = 1;
      let t = 0;
      let peak = 0;
      let maxAbs = 0;
      let settle = Infinity;
      let err = 0;
      const at = new Array(SAMPLES.length).fill(null);
      const steps = Math.round(DURATION / dt);
      for (let i = 0; i < steps; i++) {
        const v = s.step(dt);
        t += dt;
        // The reference is the same spring taken from rest to this instant in
        // one single step. For a closed form that is the exact answer, so this
        // is the real test: a many-step run and a one-step run have to agree,
        // whatever the step size was.
        const ref = new Spring({ stiffness: k, damping: c, value: 0 });
        ref.target = 1;
        err = Math.max(err, Math.abs(v - ref.step(t)));
        peak = Math.max(peak, v);
        maxAbs = Math.max(maxAbs, Math.abs(v));
        // Settled means inside 1% and staying there, so any later excursion
        // pushes the answer back out.
        if (Math.abs(v - 1) > 0.01) settle = Infinity;
        else if (settle === Infinity) settle = t;
        for (let j = 0; j < SAMPLES.length; j++) if (at[j] === null && t >= SAMPLES[j]) at[j] = v;
      }
      rows.push({ label, peak, maxAbs, settle, at, err, end: s.value, vel: s.velocity });
      console.log(
        `  dt=${label.padEnd(6)}` +
        SAMPLES.map((tt, j) => `t${tt}=${at[j].toFixed(4)}`).join('  ') +
        `  peak=${peak.toFixed(4)}  max|x|=${maxAbs.toFixed(4)}` +
        `  settle=${settle === Infinity ? 'never' : settle.toFixed(2) + 's'}` +
        `  end=${s.value.toFixed(6)} v=${s.velocity.toFixed(6)}` +
        `  err vs analytic=${err.toExponential(1)}`,
      );
    }
    // The sampled columns above will not match each other exactly, because a
    // 1/20 run and a 1/144 run land on different instants of the same curve.
    // What has to match is each run against the closed form, which is the last
    // column, and no run may leave the building.
    const worst = Math.max(...rows.map((r) => r.err));
    const diverged = rows.some((r) => !Number.isFinite(r.end) || r.maxAbs > 4);
    console.log(`  worst deviation from the exact curve, any rate: ${worst.toExponential(2)}   diverged: ${diverged}\n`);
  }

  // A target that moves while the spring is still chasing the last one, which
  // is what actually happens in the choreography.
  console.log('Moving target, 0 -> 1 at t=0, -> 0 at t=0.4, -> 0.5 at t=0.9 (k=300 c=18)');
  for (const [label, dt] of RATES) {
    const s = new Spring({ stiffness: 300, damping: 18, value: 0 });
    let t = 0;
    let maxAbs = 0;
    const marks = [];
    for (let i = 0; i < Math.round(2 / dt); i++) {
      s.target = t < 0.4 ? 1 : t < 0.9 ? 0 : 0.5;
      const v = s.step(dt);
      t += dt;
      maxAbs = Math.max(maxAbs, Math.abs(v));
      if (marks.length < 4 && t >= [0.2, 0.5, 1.0, 1.9][marks.length]) marks.push(v);
    }
    console.log(`  dt=${label.padEnd(6)}${marks.map((v) => v.toFixed(4)).join('  ')}  max|x|=${maxAbs.toFixed(4)}`);
  }

  console.log('\nEasing endpoints (must be exactly 0 and 1):');
  for (const [n, f] of [['easeOutBack', easeOutBack], ['easeInOutCubic', easeInOutCubic], ['easeOutElastic', easeOutElastic]]) {
    let peak = 0;
    let trough = 1;
    for (let i = 0; i <= 1000; i++) {
      const v = f(i / 1000);
      peak = Math.max(peak, v);
      trough = Math.min(trough, v);
    }
    console.log(`  ${n.padEnd(15)}f(0)=${f(0)}  f(1)=${f(1)}  range=[${trough.toFixed(4)}, ${peak.toFixed(4)}]`);
  }
}

// --- Debris ------------------------------------------------------------------

// Dense through the first bounce, because that is where the character is, and
// then a few late frames to see the settle. Nine evenly spaced frames spent
// most of their budget on bones lying still.
const DEFAULT_TIMES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.62, 0.75, 0.95, 1.2, 1.8, 3.0];
// --times late spends the whole strip on the part that decides whether the pile
// looks settled or merely stopped.
const LATE_TIMES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.45, 1.7, 2.0, 2.3, 2.6, 3.0];
const TIMES = args.times === 'late' ? LATE_TIMES : args.times ? String(args.times).split(',').map(Number) : DEFAULT_TIMES;

async function debrisRun() {
  const { openLab } = await import('./session.mjs');
  const tileW = Number(args.w || 480);
  const tileH = Number(args.h || 330);
  const cam = args.cam || 'side';
  const tag = args.tag || 'a';
  const outDir = args.out || 'out/debris';

  const lab = await openLab({
    width: tileW,
    height: tileH,
    entry: '/debris-test.html',
    query: `cam=${cam}&scene=${args.scene || 'drop'}`,
    readyFlag: '__debrisReady',
    verbose: !!args.verbose,
  });

  await lab.page.evaluate((o) => window.__debrisTest.setSize(o.w, o.h), { w: tileW, h: tileH });
  await lab.page.evaluate((o) => {
    window.__debrisTest.reset();
    window.__debrisTest.resetStrip(o.n, o.w, o.h, 4);
  }, { n: TIMES.length, w: tileW, h: tileH });

  const dt = 1 / 60;
  let t = 0;
  for (const mark of TIMES) {
    while (t < mark - 1e-9) {
      await lab.page.evaluate((d) => window.__debrisTest.step(d), dt);
      t += dt;
    }
    await lab.page.evaluate((label) => window.__debrisTest.snap(label), `t=${mark.toFixed(2)}s`);
  }

  const dataUrl = await lab.page.evaluate(() => window.__debrisTest.strip());
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `strip-${cam}-${tag}.png`);
  await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  console.log(`  ${file}`);

  const report = await lab.page.evaluate(() => window.__debrisTest.report());
  console.log('attachError:', report.attachError, ' live/asleep:', report.live, report.asleep);
  console.log('resting lowest point per object:', JSON.stringify(report.objects.map((o) => o.y)));
  console.log('resting height per object:', JSON.stringify(report.objects.map((o) => o.h)));
  console.log('longest axis, degrees from vertical (90 = lying flat, 0 = on end):',
    JSON.stringify(report.objects.map((o) => o.longAxisFromUp)));
  if (report.moved?.length) {
    console.log('moved from placed pose (metres or radians, whichever is larger):',
      JSON.stringify(report.moved));
  }

  const trace = await lab.page.evaluate(() => window.__debrisTest.trace(240, 1 / 60));
  console.log('hops after first contact (apex of the lowest point, metres):');
  trace.forEach((t, i) => console.log(
    `  obj${i} first touch frame ${t.touchAt}  still at frame ${t.stillAt} (${((t.stillAt - t.touchAt) / 60).toFixed(2)}s later)` +
    `  hops ${JSON.stringify(t.hops)}  rest ${t.rest}`,
  ));

  // Keep stepping well past the settle to prove nothing creeps: a resting bone
  // that is still being integrated will drift or sink, and 10 more seconds of
  // frames is enough to see it in the numbers.
  for (let i = 0; i < 600; i++) await lab.page.evaluate((d) => window.__debrisTest.step(d), dt);
  const late = await lab.page.evaluate(() => window.__debrisTest.report());
  console.log('after 10 more seconds:', JSON.stringify({ live: late.live, asleep: late.asleep, y: late.objects.map((o) => o.y) }));

  // Same scene at a 20fps frame time, which is what the main loop clamps to.
  await lab.page.evaluate(() => window.__debrisTest.reset());
  for (let i = 0; i < 60; i++) await lab.page.evaluate(() => window.__debrisTest.step(1 / 20));
  const slow = await lab.page.evaluate(() => window.__debrisTest.report());
  console.log('at dt=1/20 after 3s:', JSON.stringify({ live: slow.live, asleep: slow.asleep, y: slow.objects.map((o) => o.y) }));

  // Tear the geometry out from under objects that are still in the air.
  await lab.page.evaluate(() => window.__debrisTest.reset());
  for (let i = 0; i < 12; i++) await lab.page.evaluate(() => window.__debrisTest.step(1 / 60));
  const after = await lab.page.evaluate(() => {
    try {
      const stats = window.__debrisTest.disposeMidFlight();
      window.__debrisTest.step(1 / 60);
      window.__debrisTest.step(1 / 20);
      return { ok: true, stats };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  console.log('dispose mid-flight:', JSON.stringify(after));

  await lab.close();
}

if (args.spring) await springRun();
else await debrisRun();
