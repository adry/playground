// Lay out a demo level and write it to public/levels/demo.json.
//
//   node scripts/make-demo-level.mjs
//
// This is not the editor and it is not a second generator: it exists so there
// is one hand-shaped level in the repository to open with
// /lab/?world=1&level=/levels/demo.json, and so that the level FORMAT has a
// test that is not the editor's own UI. It places candidates against the same
// validator the editor runs and drops anything that does not fit, so the file
// it writes is a level the tool would call clean.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  emptyLevel, normalizeLevel, serializeLevel, createLevelWorld, renumberGraves, packPaint,
} from '../src/game/level/format.js';
import { validateLevel, reviewLevel } from '../src/game/level/validate.js';
import { checkFairness, FAIR_MESSAGES } from '../src/game/level/fairness.js';

const doc = emptyLevel({ size: 30, seed: 7, name: 'demo' });

// The wall changes hands twice on its way round. `at` is a distance along the
// centreline from the first corner, the same coordinate a gate uses, and the
// perimeter of a 30 by 30 arena is 120.
doc.wall.variant = 'ashlar';
doc.wall.styles = [
  { at: 34, variant: 'brick', joint: 'tooth' },
  { at: 76, variant: 'rubble', joint: 'pier' },
];

// --- the fences: one pen and one divider, each with its gate ------------------
doc.fences.push({
  id: 'pen', closed: true, gates: [{ edge: 0, t: 0.5 }],
  points: [[3.0, -10.0], [10.0, -10.0], [10.0, -3.5], [3.0, -3.5]],
});
doc.fences.push({
  id: 'divider', closed: false, gates: [{ edge: 0, t: 0.42 }],
  points: [[-14.6, 4.0], [3.0, 4.0]],
});

// --- the paths ----------------------------------------------------------------
doc.paths.push({
  id: 'path-main', material: 'sand', width: 1.4,
  points: [[-13.5, -13.0], [-6.0, -7.5], [-1.5, -1.0], [1.0, 6.5], [4.5, 13.5]],
});
doc.paths.push({
  id: 'path-cross', material: 'gravel', width: 1.1,
  points: [[-13.0, 8.0], [-5.0, 6.0], [1.2, 6.7], [9.0, 9.5]],
});
doc.paths.push({
  id: 'kerb-plot', material: 'kerb', width: 1.0,
  points: [[-10.5, -2.2], [-6.0, -2.2]],
});

// --- the graves, and the order the skeletons come out in ----------------------
//
// Each is a POSE and the file stores nothing else: the mouth, the spoil heap
// and the headstone are synthesised from it. `pile` is chosen here rather than
// guessed, by audit.js's own rule -- the heap goes on the long side AWAY from
// the nearest path -- because getting it wrong is a finding the author would
// have to be told about rather than one the tool can avoid.
const spawns = [
  { x: -8.6, z: -10.2, yaw: Math.PI / 4, personality: 'chaser', headstone: 'fred' },
  { x: 7.0, z: -6.4, yaw: Math.PI / 4, personality: 'ambusher', headstone: 'heart' },
  { x: -10.0, z: 10.4, yaw: Math.PI / 4 + 0.35, personality: 'flanker', headstone: 'gothic' },
  { x: 10.0, z: 3.4, yaw: Math.PI / 4 - 0.3, personality: 'loner', headstone: 'celtic' },
];

function pileSideFor(g) {
  const c = Math.cos(g.yaw);
  const s2 = Math.sin(g.yaw);
  const local = (x, z) => {
    const dx = x - g.x;
    const dz = z - g.z;
    return { x: dx * c - dz * s2, z: dx * s2 + dz * c };
  };
  let near = null;
  for (const p of doc.paths) {
    for (let i = 0; i + 1 < p.points.length; i++) {
      const [ax, az] = p.points[i];
      const [bx, bz] = p.points[i + 1];
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const d = Math.hypot(x - g.x, z - g.z);
        if (!near || d < near.d) near = { x, z, d };
      }
    }
  }
  if (!near) return 1;
  const lc = local(near.x, near.z);
  // Only when the path is genuinely to one SIDE does the side matter; a path
  // off the end of the grave leaves the heap free to go either way.
  if (Math.abs(lc.z) < 0.35 * near.d) return 1;
  return lc.z >= 0 ? -1 : 1;
}

spawns.forEach((s, i) => {
  const g = { id: `g${i}`, order: i, head: 1, ...s };
  g.pile = pileSideFor(g);
  doc.graves.push(g);
});
renumberGraves(doc);

// --- the pellets ---------------------------------------------------------------
for (const [i, [x, z]] of [[-11.5, -5.5], [11.0, -12.0], [-12.5, 12.0], [12.0, 11.0]].entries()) {
  doc.powerups.push({ id: `jack${i}`, x, z });
}

// --- the props -----------------------------------------------------------------
//
// Candidates in the order they matter, each dropped if the validator says it
// does not fit. A row of headstones is authored as a row: same yaw, even
// spacing, short at the front and tall at the back, which is what the layout
// package's motifs do and what makes a plot read as laid out.

const FACE = Math.PI / 4;
const wanted = [];
const push = (kind, variant, x, z, yaw = FACE) => wanted.push({ kind, variant, x, z, yaw });

// two rows against the west wall
const westRow = ['heart', 'fred', 'cracked', 'twin', 'wings', 'celtic'];
westRow.forEach((v, i) => push('stone', v, -12.6, -8.0 + i * 2.0, FACE + (i % 2 ? 0.06 : -0.05)));
const westBack = ['gothic', 'stele', 'obelisk', 'calvary'];
westBack.forEach((v, i) => push('stone', v, -14.0, -7.0 + i * 2.4, FACE + 0.03));

// the pen's own occupants
push('stone', 'vault', 6.6, -8.6, FACE);
push('stone', 'ledger', 4.6, -5.4, FACE);
push('stone', 'chest', 8.4, -5.2, FACE);

// a family plot east of the main path
['urn', 'draped', 'column', 'scroll'].forEach((v, i) => push('stone', v, -3.4 + i * 1.7, -8.6, FACE - 0.04));
['book', 'lamb', 'cairn', 'pillow'].forEach((v, i) => push('stone', v, -3.0 + i * 1.6, -6.4, FACE + 0.05));

// the north quarter
['bat', 'cross', 'boulder', 'pyramid', 'sundial', 'wheel', 'stump'].forEach((v, i) => {
  push('stone', v, -6.5 + i * 2.1, 10.5, FACE + (i % 3) * 0.05);
});
push('stone', 'kerb', -11.0, 1.2, FACE);
push('stone', 'bench', 2.6, 8.6, FACE);

// the buildings
push('fountain', null, 4.4, 1.0);
push('shed', null, 12.0, -0.6, FACE - 0.5);

// lanterns beside the paths
push('lantern', 'post', -5.0, -6.0);
push('lantern', 'crook', 0.2, 3.0);
push('lantern', 'street', -1.0, 8.2);
push('lantern', 'pillar', 6.4, 8.0);
push('lantern', 'brazier', -12.0, 5.6);

// planting and pumpkins
push('bush', null, -2.4, 12.2);
push('bush', null, 13.0, 6.6);
push('grass', 'patch', -7.6, 2.0);
push('grass', 'patch', 8.0, 12.0);
push('flowers', 'daisies', -12.0, -1.0);
push('flowers', 'posy', -3.9, -9.9);
push('flowers', 'spires', 2.2, -2.4);
push('pumpkin', 'classic', -6.2, -3.2);
push('pumpkin', 'squat', 5.4, 11.4);
push('pumpkin', 'tiny', -0.6, -3.6);

// EVERY CANDIDATE IS TESTED AGAINST THE WHOLE RULE SET, not against a subset.
//
// The first version of this script used only the editor's fast checks, and the
// level it wrote had forty audit findings in it, eleven of them wedges. That is
// exactly the mistake the editor exists to stop a person making, so the script
// makes it impossible here too: a candidate goes in, audit.js and findWedges
// are run over the whole level, and if the count of errors went up the
// candidate comes back out. It is a couple of hundred milliseconds per
// candidate and it takes about fifteen seconds, which is the right trade for a
// file that ships as the example.
const baseline = reviewLevel(createLevelWorld(doc)).errors.length;
if (baseline) {
  console.log(`the empty shell already has ${baseline} findings:`);
  for (const e of reviewLevel(createLevelWorld(doc)).errors) console.log(`  ${e.code}: ${e.message}`);
}
let worst = baseline;
let dropped = 0;
for (const [i, c] of wanted.entries()) {
  doc.props.push({ id: `p${i}`, ...c });
  const n = reviewLevel(createLevelWorld(doc)).errors.length;
  if (n > worst) {
    doc.props.pop();
    dropped += 1;
  } else {
    worst = n;
  }
}

// --- the painted ground ---------------------------------------------------------
//
// Grass over the whole yard, sand widening around the main path, gravel inside
// the pen and round the fountain, bare earth at the graves. The borders are not
// drawn: groundcover.js blurs these cells into a weight field and the materials
// interleave across about a metre and a half wherever two of them meet.

const g = doc.ground;
const cells = new Uint8Array(g.w * g.h);
const idx = (name) => g.materials.indexOf(name) + 1;
const nearPoly = (x, z, pts, r) => pts.some(([px, pz], i) => {
  if (i === 0) return false;
  const [ax, az] = pts[i - 1];
  const dx = px - ax;
  const dz = pz - az;
  const ll = dx * dx + dz * dz || 1;
  let t = ((x - ax) * dx + (z - az) * dz) / ll;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < r;
});

for (let j = 0; j < g.h; j++) {
  for (let i = 0; i < g.w; i++) {
    const x = g.minX + (i + 0.5) * g.cell;
    const z = g.minZ + (j + 0.5) * g.cell;
    let v = idx('grass');
    if (nearPoly(x, z, doc.paths[0].points, 2.2)) v = idx('sand');
    if (nearPoly(x, z, doc.paths[1].points, 1.9)) v = idx('gravel');
    if (x > 3.2 && x < 9.8 && z > -9.8 && z < -3.7) v = idx('gravel');
    if (Math.hypot(x - 4.4, z - 1.0) < 3.0) v = idx('gravel');
    for (const s of spawns) if (Math.hypot(x - s.x, z - s.z) < 2.6) v = idx('earth');
    cells[j * g.w + i] = v;
  }
}
g.paint = packPaint(cells);

// --- write it out ------------------------------------------------------------------
const out = normalizeLevel(doc);
const world = createLevelWorld(out);
const check = validateLevel(out, world);
const review = reviewLevel(world);
const path = new URL('../public/levels/demo.json', import.meta.url).pathname;
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${serializeLevel(out)}\n`);

console.log(`wrote ${path}`);
console.log(`props ${out.props.length} (${dropped} candidates dropped for not fitting)`);
console.log(`gates ${world._derived.gates.length}  graves ${out.graves.length}  fireflies ${world.fireflies().length}`);
console.log(`live checks: errors ${check.errors.length}  warnings ${check.warnings.length}`);
for (const i of check.issues) console.log(`  ${i.severity}: ${i.message}`);
console.log(`audit: ${review.errors.length} findings, ${review.wedges.length} wedges, ${review.notes.length} notes`);
for (const i of review.issues) console.log(`  ${i.severity} ${i.code}: ${i.message}`);

// And the eight the soak checks, which is what actually decides whether this
// is playable now that nothing procedural stands between it and a player.
const fair = checkFairness(world);
console.log(fair.fail.length ? `FAILS ${fair.fail.join(', ')}` : 'fairness: all eight pass');
for (const f of fair.fail) console.log(`  ${f}: ${FAIR_MESSAGES[f]}`);
