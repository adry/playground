// The arrangements. This is the file that decides whether the graveyard looks
// designed or shaken out of a bag.
//
// DESIGN.md's last section is the brief and it is worth restating: a graveyard
// reads as cute when it is TIDY. Stones in rows facing the same way, paths that
// go somewhere, a bench looking at something, lanterns spaced evenly enough to
// look placed rather than dropped. So the randomness in here only ever chooses
//
//   which motif a bay gets,
//   which variants appear in it,
//   and a few centimetres of jitter on each piece,
//
// and never whether the arrangement makes sense. Every motif lays its props out
// on a rule: a row is evenly spaced about the bay's centre line, every stone in
// a level faces the same way (PI/4 in world, straight at the camera, which is
// what src/ghost/main.js authors by hand), a bench faces the thing it is
// looking at, and anything tall goes at the back where it cannot stand in front
// of anything short.
//
// The placer can refuse any single piece. Motifs are written so that a refusal
// leaves a smaller version of the same arrangement rather than a broken one:
// a row of five that becomes a row of four is still a row.

import { footprintOf, STONES, UPRIGHT, LOW, PUMPKINS, LANTERNS, PATH_LANTERNS } from './footprints.js';

// Grid yaw PI faces -v: down the screen, toward the camera, and toward the path
// in front of the plot. It is the yaw of nearly everything with a face.
export const FACE = Math.PI;

// Evenly spaced offsets about zero. This, and only this, is how a row is built.
export function spread(n, span) {
  if (n <= 1) return [0];
  const step = span / (n - 1);
  return Array.from({ length: n }, (_, k) => -span / 2 + k * step);
}

// How many pieces of this width fit along a bay, and over what span. `gapMin`
// is the air between neighbours, and it is a look-and-feel number: at 0.2 a row
// of stones is a wall, at 1.2 it stops reading as a row at all.
export function rowFit(width, halfU, { gapMin = 0.8, edge = 0.35, max = 6 } = {}) {
  const span = width - 2 * (halfU + edge);
  if (span < 0) return { n: 1, span: 0 };
  const pitch = 2 * halfU + gapMin;
  const n = Math.max(1, Math.min(max, Math.floor(span / pitch) + 1));
  return { n, span };
}

const jitterPos = (rng, amount = 0.06) => rng.jitter(amount);
const jitterYaw = (rng, amount = 0.05) => rng.jitter(amount);

// --- rows of headstones ----------------------------------------------------
//
// The staple, and about half of every level. One or two rows, all of them
// facing the camera, the taller row behind: which is both what a real cemetery
// looks like from a low camera and what placement rule 5 asks for.
function graveRows({ bay, rng, placer }) {
  const tallPool = UPRIGHT.slice(2);           // drop the two smallest
  const backVariants = rng.sample(tallPool, rng.chance(0.45) ? 2 : 1);
  const frontPool = [...LOW, 'heart', 'fred'];
  const frontVariants = rng.sample(frontPool, rng.chance(0.4) ? 2 : 1);

  const twoRows = bay.width >= 8 || rng.chance(0.55);
  const rows = twoRows
    ? [{ v: bay.cv + 1.0, variants: backVariants }, { v: bay.cv - 1.05, variants: frontVariants }]
    : [{ v: bay.cv + rng.jitter(0.2), variants: backVariants }];

  let placed = 0;
  for (const row of rows) {
    const halfU = Math.max(...row.variants.map((v) => STONES[v].halfU));
    const { n, span } = rowFit(bay.width, halfU, { gapMin: rng.float(0.7, 1.1) });
    const offsets = spread(n, span);
    for (let k = 0; k < offsets.length; k++) {
      const variant = row.variants[k % row.variants.length];
      const ok = placer.try({
        kind: 'stone', variant,
        u: bay.cu + offsets[k] + jitterPos(rng),
        v: row.v + jitterPos(rng, 0.05),
        gridYaw: FACE + jitterYaw(rng),
        foot: footprintOf('stone', variant),
      });
      if (ok) placed++;
    }
  }
  return placed;
}

// --- a grave that is still open --------------------------------------------
//
// Placement rule 4: a hole needs its spoil heap on the long side away from the
// nearest corridor, and a headstone at its head. All three go down together or
// none of them do, which is what tryGroup is for: a pit with no heap beside it
// reads as a mistake rather than as a grave.
// How far a grave reaches either side of the mouth of its hole. It is not
// symmetric: the headstone stands off one end and the spoil heap is pushed
// toward the other, so a grave centred on a cell puts its headstone through the
// fence. Every caller lays units out on `half` and shifts them by `shift`,
// which is the difference the two ends make.
export const HEAP_SHIFT = 0.45;
export function graveExtents(stoneVariant) {
  const hole = footprintOf('hole');
  const dirt = footprintOf('dirt');
  const stone = footprintOf('stone', stoneVariant);
  const head = hole.halfU + 2 * stone.halfU + 0.25;
  const tail = HEAP_SHIFT + dirt.halfU;
  return { head, tail, half: (head + tail) / 2, shift: (head - tail) / 2 };
}

export function graveGroup({ placer, rng, u, v, pileSide, headSide, stoneVariant }) {
  const hole = footprintOf('hole');
  const dirt = footprintOf('dirt');
  const stone = footprintOf('stone', stoneVariant);
  // The heap is pushed away from the head, so it is never behind the headstone
  // on the camera axis and the two never fight for the same ground.
  const heapU = u - headSide * HEAP_SHIFT;
  return placer.tryGroup([
    { kind: 'hole', variant: 'grave', u, v, gridYaw: FACE, foot: hole },
    {
      kind: 'dirt', variant: 'pile',
      u: heapU + jitterPos(rng, 0.05),
      v: v + pileSide * (hole.halfV + dirt.halfV + 0.22),
      gridYaw: FACE + jitterYaw(rng, 0.03),
      foot: dirt,
    },
    {
      kind: 'stone', variant: stoneVariant,
      u: u + headSide * (hole.halfU + stone.halfU + 0.25),
      v: v + jitterPos(rng, 0.04),
      gridYaw: FACE + jitterYaw(rng),
      foot: stone,
    },
  ]);
}

// Which way the nearest corridor lies, as a sign along v: the heap goes the
// other way. A hole in a plot that has been merged upward has its nearest path
// behind it rather than in front, and the arrangement flips to match.
function pileSideFor(tiles, u, v) {
  let best = Infinity;
  let side = 1;
  const a0 = tiles.A(u - 8); const a1 = tiles.A(u + 8);
  const b0 = tiles.B(v - 8); const b1 = tiles.B(v + 8);
  for (let b = b0; b <= b1; b++) {
    for (let a = a0; a <= a1; a++) {
      if (!tiles.isPath(a, b)) continue;
      const du = tiles.U(a) - u;
      const dv = tiles.V(b) - v;
      const d = Math.hypot(du, dv);
      if (d < best) { best = d; side = dv >= 0 ? -1 : 1; }
    }
  }
  return side;
}

function freshGraves(ctx) {
  const { bay, rng, placer, tiles, out } = ctx;
  // The floor only has so many cuts in it. A bay that asked for an open grave
  // and cannot have one gets stones instead, which is the same plot with the
  // digging finished.
  if (!out.budget.holes) return graveRows(ctx);
  // Narrow stones only: a grave is 3.5 wide before the stone is added and a
  // cell is 4.0, so the head is where the room runs out.
  const narrow = ['heart', 'fred', 'celtic', 'gothic', 'wheel', 'urn', 'column'];
  const variant = rng.pick(narrow);
  const headSide = rng.chance(0.5) ? 1 : -1;
  const ext = graveExtents(variant);
  const offsets = spread(bay.cells, (bay.cells - 1) * 6);
  let placed = 0;
  for (const off of offsets) {
    if (!out.budget.holes) break;
    const u = bay.cu + off - headSide * ext.shift;
    const v = bay.cv - 0.35;
    const side = pileSideFor(tiles, u, v);
    if (graveGroup({ placer, rng, u, v: v - side * 0.1, pileSide: side, headSide, stoneVariant: variant })) {
      placed++;
      out.budget.holes--;
    }
  }
  return placed;
}

// --- the pen ---------------------------------------------------------------
//
// Pac-Man's ghost house: the middle plot, a row of open graves, and a skeleton
// climbing out of each one. Every grave in it is identical, which is the point.
function pen({ bay, rng, placer, tiles, out, penBudget = 3 }) {
  const variant = rng.pick(['celtic', 'gothic', 'heart']);
  const headSide = -1;
  const ext = graveExtents(variant);
  // Spaced on the grave's own extents rather than on the hole's: a unit reaches
  // further at the head than at the foot, and pitching the row on the hole
  // alone is what used to push the end grave's headstone through the fence and
  // drop the pen from three graves to two.
  const PITCH = 2 * ext.half + 0.3;
  const span = Math.max(0, bay.width - 2 * (ext.half + 0.3));
  const n = Math.max(1, Math.min(penBudget, Math.floor(span / PITCH) + 1));
  const offsets = spread(n, span);
  const side = pileSideFor(tiles, bay.cu, bay.cv - 0.4);
  for (const off of offsets) {
    const u = bay.cu + off - headSide * ext.shift;
    const v = bay.cv - 0.35 - side * 0.1;
    if (!out.budget.holes) break;
    const group = graveGroup({ placer, rng, u, v, pileSide: side, headSide, stoneVariant: variant });
    if (group) {
      out.budget.holes--;
      out.graves.push({ u, v, yaw: group[0].yaw, x: group[0].x, z: group[0].z });
    }
  }
  return out.graves.length;
}

// --- the fountain ----------------------------------------------------------
//
// One per level, in the widest plot that will take it, with lanterns on its
// corners and benches looking at it. The benches are the reason this motif
// exists: a bench facing nothing is furniture, a bench facing a fountain is a
// place.
function fountainCourt({ bay, rng, placer }) {
  const foot = footprintOf('fountain');
  if (!placer.try({ kind: 'fountain', variant: 'basin', u: bay.cu, v: bay.cv, gridYaw: FACE, foot })) return 0;
  let placed = 1;

  const lantern = rng.pick(['pillar', 'post', 'ground', 'hurricane']);
  const lFoot = footprintOf('lantern', lantern);
  const du = Math.min(bay.width / 2 - lFoot.r - 0.5, 3.4);
  const dv = 1.3;
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      if (placer.try({
        kind: 'lantern', variant: lantern,
        u: bay.cu + su * du, v: bay.cv + sv * dv,
        gridYaw: FACE, foot: lFoot,
      })) placed++;
    }
  }

  // Behind the basin, facing it, which is also facing the camera.
  const bFoot = footprintOf('bench', 'bench');
  for (const su of [-1, 1]) {
    if (bay.width < 8) break;
    if (placer.try({
      kind: 'bench', variant: 'bench',
      u: bay.cu + su * 2.0, v: bay.cv + 1.45,
      gridYaw: FACE + jitterYaw(rng, 0.03), foot: bFoot,
    })) placed++;
  }
  return placed;
}

// --- the shed --------------------------------------------------------------
//
// One per level, dead centre of a cell, because at 1.93 it has 0.07 of the cell
// to spare and rule 6 gives it a cell to itself. The rest of the bay is its
// yard: a couple of pumpkins and a bush, in a row, in front of it.
function shedYard({ bay, rng, placer }) {
  const foot = footprintOf('shed');
  const end = rng.chance(0.5) ? 0 : bay.cells - 1;
  const cu = bay.u0 + 2 + end * 6;
  if (!placer.try({ kind: 'shed', variant: 'shed', u: cu, v: bay.cv, gridYaw: FACE, foot })) return 0;
  let placed = 1;

  for (let k = 0; k < bay.cells; k++) {
    if (k === end) continue;
    const yardU = bay.u0 + 2 + k * 6;
    const variant = rng.pick(['classic', 'squat', 'tiny', 'tall']);
    const pFoot = footprintOf('pumpkin', variant);
    const { n, span } = rowFit(4, pFoot.r, { gapMin: 0.5, max: 3 });
    for (const off of spread(n, span)) {
      if (placer.try({
        kind: 'pumpkin', variant,
        u: yardU + off + jitterPos(rng), v: bay.cv - 1.0 + jitterPos(rng),
        gridYaw: FACE + rng.jitter(0.5), foot: pFoot,
      })) placed++;
    }
    const bush = footprintOf('bush', 'ball');
    if (placer.try({ kind: 'bush', variant: 'ball', u: yardU, v: bay.cv + 1.2, gridYaw: rng.float(0, 6.28), foot: bush })) placed++;
  }
  return placed;
}

// --- a patch of pumpkins ---------------------------------------------------
function pumpkinPatch({ bay, rng, placer }) {
  const back = rng.pick(['tall', 'gourd', 'pear']);
  const front = rng.pick(['tiny', 'classic', 'squat']);
  let placed = 0;
  for (const row of [{ variant: back, v: bay.cv + 0.9 }, { variant: front, v: bay.cv - 0.9 }]) {
    const foot = footprintOf('pumpkin', row.variant);
    const { n, span } = rowFit(bay.width, foot.r, { gapMin: 0.55, max: 6 });
    for (const off of spread(n, span)) {
      if (placer.try({
        kind: 'pumpkin', variant: row.variant,
        u: bay.cu + off + jitterPos(rng, 0.08),
        v: row.v + jitterPos(rng, 0.08),
        // A pumpkin is round and its face is carved on one side, so its yaw is
        // the one place a wide random turn is right.
        gridYaw: rng.float(0, Math.PI * 2), foot,
      })) placed++;
    }
  }
  return placed;
}

// --- lanterns along the front ----------------------------------------------
//
// Evenly spaced, all the same variant, all along the edge nearest the path.
// Mixed variants at uneven spacing is exactly the "dropped rather than placed"
// the design doc warns about.
function lanternWalk({ bay, rng, placer }) {
  const variant = rng.pick(PATH_LANTERNS);
  const foot = footprintOf('lantern', variant);
  const { n, span } = rowFit(bay.width, foot.r, { gapMin: rng.float(1.6, 2.4), max: 5 });
  let placed = 0;
  for (const off of spread(Math.max(2, n), span)) {
    if (placer.try({
      kind: 'lantern', variant,
      u: bay.cu + off, v: bay.cv - 1.45,
      gridYaw: FACE, foot,
    })) placed++;
  }
  // Something for them to light.
  const stone = rng.pick(UPRIGHT.slice(4));
  const sFoot = footprintOf('stone', stone);
  const fit = rowFit(bay.width, sFoot.halfU, { gapMin: 1.0, max: 4 });
  for (const off of spread(fit.n, fit.span)) {
    if (placer.try({
      kind: 'stone', variant: stone,
      u: bay.cu + off + jitterPos(rng), v: bay.cv + 1.05 + jitterPos(rng, 0.05),
      gridYaw: FACE + jitterYaw(rng), foot: sFoot,
    })) placed++;
  }
  return placed;
}

// --- a bench and a lamp ----------------------------------------------------
function restStop({ bay, rng, placer }) {
  let placed = 0;
  const bench = footprintOf('bench', 'bench');
  const su = rng.chance(0.5) ? 1 : -1;
  if (placer.try({
    kind: 'bench', variant: 'bench',
    u: bay.cu - su * 0.9, v: bay.cv - 1.0,
    gridYaw: FACE + jitterYaw(rng, 0.03), foot: bench,
  })) placed++;
  const variant = rng.pick(['post', 'crook', 'pillar', 'brazier']);
  const lFoot = footprintOf('lantern', variant);
  if (placer.try({
    kind: 'lantern', variant,
    u: bay.cu + su * (bay.width / 2 - lFoot.r - 0.55), v: bay.cv - 1.0,
    gridYaw: FACE, foot: lFoot,
  })) placed++;
  const stone = rng.pick(UPRIGHT.slice(3));
  const sFoot = footprintOf('stone', stone);
  const fit = rowFit(bay.width, sFoot.halfU, { gapMin: 1.0, max: 4 });
  for (const off of spread(fit.n, fit.span)) {
    if (placer.try({
      kind: 'stone', variant: stone,
      u: bay.cu + off + jitterPos(rng), v: bay.cv + 1.1 + jitterPos(rng, 0.05),
      gridYaw: FACE + jitterYaw(rng), foot: sFoot,
    })) placed++;
  }
  return placed;
}

// --- lighting the places that matter ---------------------------------------
//
// Not a bay motif: this one is handed a point and puts a matched pair or set of
// small lanterns on the plot corners around it, which is what makes an entrance
// read as an entrance. Used for the pen and for the way in through the gate,
// the two places a player needs to be able to find.
export function lanternCorners({ placer, rng, corners, variant = 'ground' }) {
  const foot = footprintOf('lantern', variant);
  let placed = 0;
  for (const [u, v] of corners) {
    if (placer.try({ kind: 'lantern', variant, u, v, gridYaw: FACE, foot })) placed++;
  }
  return placed;
}

// --- grass -----------------------------------------------------------------
//
// Deliberate emptiness. A level where every plot is full has nowhere for the
// eye to rest and nowhere for the ghost to be chased through.
function lawn({ bay, rng, placer }) {
  let placed = 0;
  const n = rng.int(0, 3);
  const foot = footprintOf('bush', 'ball');
  for (const off of spread(n, Math.min(bay.width - 2.4, 4.5))) {
    if (placer.try({
      kind: 'bush', variant: 'ball',
      u: bay.cu + off + jitterPos(rng, 0.12),
      v: bay.cv + rng.jitter(0.5),
      gridYaw: rng.float(0, Math.PI * 2), foot,
    })) placed++;
  }
  return placed;
}

export const MOTIFS = { graveRows, freshGraves, pumpkinPatch, lanternWalk, restStop, lawn, fountainCourt, shedYard, pen };

// What a bay of this size may be. The weights are the level's personality: a
// graveyard is mostly graves, so rows of stones outweigh everything else, and
// the two set pieces are handed out by the level rather than drawn here.
export function chooseMotif(bay, rng) {
  const pairs = bay.cells >= 2
    ? [['graveRows', 5], ['freshGraves', 2], ['lanternWalk', 2], ['pumpkinPatch', 1.5], ['restStop', 1.5], ['lawn', 1]]
    : [['graveRows', 5], ['freshGraves', 1.5], ['lanternWalk', 1.5], ['pumpkinPatch', 1.5], ['restStop', 1], ['lawn', 1.5]];
  return rng.weighted(pairs);
}

export default MOTIFS;
