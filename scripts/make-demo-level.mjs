// Lay out a demo level and write it to public/levels/demo.json.
//
//   node scripts/make-demo-level.mjs
//
// This is not the editor and it is not a second generator. It exists so there
// is one hand-shaped level in the repository to open with
// /lab/?world=1&level=/levels/demo.json, and so that the level FORMAT has a
// test that is not the editor's own UI.
//
// EVERYTHING IN IT IS PLACED THE WAY THE EDITOR MAKES THE OWNER PLACE THINGS:
// a candidate goes in, the whole rule set runs over the whole level, and if the
// number of findings went up the candidate comes back out. The whole rule set
// means src/game/world/audit.js and repair.js's findWedges, not a subset. The
// first version of this script gated on a subset and wrote a file with forty
// findings in it, eleven of them wedges -- a wedge being a place the ghost can
// vault into that no skeleton can walk to, which is the failure that ends the
// game. That is exactly the mistake a person makes in an editor and cannot see,
// so it is the mistake this file must not be able to make either.

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
  points: [[3.0, -10.5], [10.5, -10.5], [10.5, -3.5], [3.0, -3.5]],
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
  points: [[-10.5, -2.4], [-6.2, -2.4]],
});

// --- the machinery: a candidate is kept only if it costs nothing ---------------

// The 'floor' rule counts CONTENT -- four graves, four pellets, at least so
// many headstones -- so it fires on an empty shell and clears as the level is
// filled. Counting it here would let the budget ratchet: a candidate that broke
// a real rule would be accepted while a content finding was still standing, and
// then stay in once that finding cleared. That is not hypothetical, it is how a
// headstone ended up half a metre into a path. So the gate counts GEOMETRY
// findings only, and the content rules are checked once at the end.
const findings = () => reviewLevel(createLevelWorld(doc)).errors
  .filter((e) => e.code !== 'floor').length;
let budget = findings();

// Try each of `options` in turn and keep the first that does not raise the
// count. `apply` pushes it, `undo` takes it back out.
function tryOne(options, apply, undo) {
  for (const o of options) {
    apply(o);
    const n = findings();
    if (n <= budget) { budget = n; return true; }
    undo();
  }
  return false;
}

// --- the graves ----------------------------------------------------------------
//
// Each is a POSE and the file stores nothing else: the mouth, the spoil heap
// and the headstone are synthesised from it. `pile` is chosen by audit.js's own
// rule -- the heap goes on the long side AWAY from the nearest path -- and then
// the whole grave is offered at a few nearby spots, because a grave is three
// props and three and a half units long, and the first place you think of is
// often two centimetres into a path.
function pileSideFor(g) {
  const c = Math.cos(g.yaw);
  const s = Math.sin(g.yaw);
  const local = (x, z) => {
    const dx = x - g.x;
    const dz = z - g.z;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
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

const FACE = Math.PI / 4;
const spawnPlan = [
  { x: -10.6, z: -8.4, personality: 'chaser', headstone: 'fred' },
  { x: 6.8, z: -7.4, personality: 'ambusher', headstone: 'heart' },
  { x: -9.8, z: 10.6, personality: 'flanker', headstone: 'gothic' },
  { x: 10.4, z: 2.0, personality: 'loner', headstone: 'celtic' },
];
let placedSpawns = 0;
for (const [i, plan] of spawnPlan.entries()) {
  const spots = [];
  for (const dx of [0, 1.2, -1.2, 2.4, -2.4]) {
    for (const dz of [0, 1.2, -1.2, 2.4, -2.4]) {
      for (const head of [1, -1]) spots.push({ dx, dz, head });
    }
  }
  const ok = tryOne(spots, (o) => {
    const g = {
      id: `g${i}`, order: i, yaw: FACE, head: o.head,
      x: plan.x + o.dx, z: plan.z + o.dz,
      personality: plan.personality, headstone: plan.headstone,
    };
    g.pile = pileSideFor(g);
    doc.graves.push(g);
  }, () => doc.graves.pop());
  if (ok) placedSpawns += 1;
}
renumberGraves(doc);

// --- the pellets ---------------------------------------------------------------
for (const [i, [x, z]] of [[-12.0, -5.0], [11.0, -12.5], [-12.5, 12.5], [12.5, 11.0]].entries()) {
  tryOne([[0, 0], [1, 1], [-1, -1], [2, 0], [0, 2]], (o) => {
    doc.powerups.push({ id: `jack${i}`, x: x + o[0], z: z + o[1] });
  }, () => doc.powerups.pop());
}

// --- the props -----------------------------------------------------------------
//
// A row of headstones is authored as a row: same yaw, even spacing, short at
// the front and tall at the back, which is what the layout package's motifs do
// and what makes a plot read as laid out rather than as a scatter. Each one is
// still offered to the rule set and dropped if it costs anything.
const wanted = [];
const push = (kind, variant, x, z, yaw = FACE) => wanted.push({ kind, variant, x, z, yaw });

// Two rows down the west side, kept well off the wall: a row standing a metre
// from it leaves a strip behind that a body fits in and nothing can walk to,
// which is a wedge and is the whole reason this level is placed the hard way.
const westRow = ['heart', 'fred', 'cracked', 'twin', 'wings', 'celtic'];
westRow.forEach((v, i) => push('stone', v, -11.6, -6.0 + i * 2.2, FACE + (i % 2 ? 0.06 : -0.05)));
const westBack = ['stele', 'obelisk', 'calvary'];
westBack.forEach((v, i) => push('stone', v, -13.3, -5.4 + i * 2.6, FACE + 0.03));

// the pen's own occupants
push('stone', 'vault', 6.4, -8.8, FACE);
push('stone', 'ledger', 4.6, -5.2, FACE);
push('stone', 'chest', 8.8, -5.2, FACE);

// a family plot west of the pen
['urn', 'draped', 'column', 'scroll'].forEach((v, i) => push('stone', v, -3.6 + i * 1.9, -9.8, FACE - 0.04));
['book', 'lamb', 'cairn'].forEach((v, i) => push('stone', v, -3.0 + i * 1.9, -7.0, FACE + 0.05));

// the north quarter
['bat', 'cross', 'boulder', 'pyramid', 'sundial', 'wheel', 'stump'].forEach((v, i) => {
  push('stone', v, -6.6 + i * 2.2, 11.6, FACE + (i % 3) * 0.05);
});
push('stone', 'kerb', -11.4, 0.6, FACE);
push('stone', 'bench', 3.2, 9.2, FACE);

// the buildings
push('fountain', null, 4.6, 0.6);
push('shed', null, 12.2, -1.4, FACE - 0.5);

// lanterns beside the paths, off them
push('lantern', 'post', -5.2, -4.6);
push('lantern', 'crook', 2.4, 2.6);
push('lantern', 'street', -2.4, 8.6);
push('lantern', 'pillar', 6.6, 6.6);
push('lantern', 'brazier', -12.6, 5.8);

// planting and pumpkins
push('bush', null, -3.6, 12.8);
push('bush', null, 13.0, 6.2);
push('grass', 'patch', -8.2, 1.4);
push('grass', 'patch', 8.4, 12.4);
push('flowers', 'daisies', -13.0, -1.4);
push('flowers', 'posy', 0.4, -11.0);
push('flowers', 'spires', 2.6, -1.6);
push('pumpkin', 'classic', -6.8, -2.4);
push('pumpkin', 'squat', 6.2, 12.0);
push('pumpkin', 'tiny', -1.4, -4.6);

let dropped = 0;
for (const [i, c] of wanted.entries()) {
  const kept = tryOne([0], () => doc.props.push({ id: `p${i}`, ...c }), () => doc.props.pop());
  if (!kept) dropped += 1;
}

// --- the painted ground ---------------------------------------------------------
//
// Grass over the whole yard, sand widening around the main path, gravel inside
// the pen and round the fountain, bare earth at the graves. The borders are not
// drawn: groundcover.js blurs these cells into a weight field and the materials
// interleave across about a metre and a half wherever two of them meet. None of
// this is geometry, so none of it can fail a rule.

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
    if (x > 3.2 && x < 10.3 && z > -10.3 && z < -3.7) v = idx('gravel');
    if (Math.hypot(x - 4.6, z - 0.6) < 3.0) v = idx('gravel');
    for (const s of doc.graves) if (Math.hypot(x - s.x, z - s.z) < 2.6) v = idx('earth');
    cells[j * g.w + i] = v;
  }
}
g.paint = packPaint(cells);

// --- write it out ------------------------------------------------------------------
const out = normalizeLevel(doc);
const world = createLevelWorld(out);
const check = validateLevel(out, world);
const review = reviewLevel(world);
const fair = checkFairness(world);
const path = new URL('../public/levels/demo.json', import.meta.url).pathname;
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${serializeLevel(out)}\n`);

console.log(`wrote ${path}`);
console.log(`props ${out.props.length} (${dropped} candidates dropped for not fitting)`);
console.log(`spawns ${placedSpawns}/4  gates ${world._derived.gates.length}  pellets ${out.powerups.length}`);
console.log(`fireflies ${world.fireflies().length} at ${world._derived.flies.spacing.toFixed(1)} apart`);
console.log(`live checks: ${check.errors.length} errors, ${check.warnings.length} warnings`);
for (const i of check.issues) console.log(`  ${i.severity}: ${i.message}`);
console.log(`audit: ${review.errors.length} findings, ${review.wedges.length} wedges`);
for (const i of review.issues) console.log(`  ${i.severity} ${i.code}: ${i.message}`);
console.log(fair.fail.length ? `FAILS ${fair.fail.join(', ')}` : 'fairness: all eight pass');
for (const f of fair.fail) console.log(`  ${f}: ${FAIR_MESSAGES[f]}`);
