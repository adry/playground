// The compositions, for ground with no cells in it.
//
// layout/motifs.js laid a bay out on a rule: a row evenly spaced about the
// bay's centre line, every stone facing the same way, tall at the back. That
// produced the thing the owner called squarish, and it produced it honestly,
// because the bay was a 4.0 cell on a 2.0 lattice and there was nothing else
// for a row to be spaced against.
//
// Take the lattice away and the same instinct produces something else. A row is
// still a row, but its pitch varies from stone to stone, its baseline wanders,
// it leans a degree or two off the camera and it is three or five long rather
// than always four. Sites are scattered on a jittered lattice rather than
// placed in cells, and how many of them survive depends on a smooth density
// field, so the graveyard has crowded old quarters and empty meadows instead of
// one uniform crop.
//
// What does NOT change is rule 5. The reason the old layout could be organic
// only in its jitter is that position and height were chosen together: a taller
// stone one unit nearer the camera swallows the one behind it, so if you scatter
// positions freely you must not also scatter heights freely. The answer here is
// that positions are free and HEIGHT IS DERIVED: placer.heightWindow() reports
// what the neighbourhood will tolerate at a point and the composition picks a
// variant inside it. Short at the front, tall behind, no row required.

import { footprintOf, STONES, UPRIGHT, LOW, PATH_LANTERNS } from '../layout/footprints.js';
import { graveGroup, graveExtents, FACE } from '../layout/motifs.js';
import { rngAt, PATH_HALF, GRAVE_REACH, CHUNK, chunkBox } from './field.js';

// Every stone the world may place, with its height, sorted. The two tallest
// lanterns are left out on purpose: the street lamp is 3.3 and reaches nine
// units of screen depth, so one of them in open ground sterilises a strip of
// graveyard behind it that rule 5 will not let anything stand in.
const STONE_HEIGHTS = Object.entries(STONES).map(([name, s]) => ({ name, height: s.height }));
const TALL = UPRIGHT.filter((n) => STONES[n]);
const SHORT = LOW.filter((n) => STONES[n]);

// The widest half extent across the screen any stone has, used as the
// conservative width when asking for a height window before the variant is
// known.
const WIDEST_ACROSS = 0.95;

// A variant whose height is legal at this point, or null when nothing is.
function pickStone(rng, placer, u, v, pool) {
  const win = placer.heightWindow(u, v, WIDEST_ACROSS);
  const ok = pool.filter((n) => STONES[n].height >= win.lo && STONES[n].height <= win.hi);
  if (!ok.length) return null;
  return rng.pick(ok);
}

// The same question for anything with a fixed height.
const fits = (placer, u, v, height, halfA = 0.6) => {
  const win = placer.heightWindow(u, v, halfA);
  return height >= win.lo && height <= win.hi;
};

// --- the open ground compositions -------------------------------------------

// A row that wanders. Pitch varies per gap, the baseline drifts, the whole row
// leans a little, and every stone is turned a few degrees off the camera. It is
// the same idea as the old graveRows and it does not read as a lattice.
function wanderRow({ rng, placer, u, v }) {
  const n = rng.int(2, 6);
  const lean = rng.float(-0.32, 0.32);          // v gained per unit of u
  const turn = rng.float(-0.22, 0.22);          // the whole row off the camera
  const pool = rng.chance(0.22) ? SHORT : TALL;
  let placed = 0;
  let du = -((n - 1) * rng.float(1.5, 2.3)) / 2;
  for (let i = 0; i < n; i++) {
    const su = u + du;
    const sv = v + du * lean + rng.jitter(0.28);
    const variant = pickStone(rng, placer, su, sv, pool);
    if (variant) {
      if (placer.try({
        kind: 'stone', variant, u: su, v: sv,
        gridYaw: FACE + turn + rng.jitter(0.09),
        foot: footprintOf('stone', variant),
      })) placed++;
    }
    du += rng.float(1.4, 2.6);
  }
  return placed;
}

// A knot of stones with no row in it at all: a family that ran out of room and
// buried inward. Positions are drawn inside a small disc and heights come out
// of the window, so the knot sorts itself short at the front without being told
// to.
function cluster({ rng, placer, u, v }) {
  const n = rng.int(2, 5);
  const r = rng.float(1.3, 2.4);
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const a = rng.float(0, Math.PI * 2);
    const d = r * Math.sqrt(rng.next());
    const su = u + Math.cos(a) * d;
    const sv = v + Math.sin(a) * d;
    const variant = pickStone(rng, placer, su, sv, rng.chance(0.35) ? SHORT : TALL);
    if (!variant) continue;
    if (placer.try({
      kind: 'stone', variant, u: su, v: sv,
      gridYaw: FACE + rng.jitter(0.35),
      foot: footprintOf('stone', variant),
    })) placed++;
  }
  return placed;
}

// Two of the same stone, side by side. A couple.
function pairStones({ rng, placer, u, v }) {
  const win = placer.heightWindow(u, v, WIDEST_ACROSS);
  const ok = TALL.filter((n) => STONES[n].height >= win.lo && STONES[n].height <= win.hi);
  if (!ok.length) return 0;
  const variant = rng.pick(ok);
  const foot = footprintOf('stone', variant);
  const half = foot.halfU + rng.float(0.22, 0.45);
  const turn = rng.jitter(0.14);
  let placed = 0;
  for (const s of [-1, 1]) {
    if (placer.try({
      kind: 'stone', variant,
      u: u + s * half, v: v + rng.jitter(0.12),
      gridYaw: FACE + turn + rng.jitter(0.05),
      foot,
    })) placed++;
  }
  return placed;
}

function loneStone({ rng, placer, u, v }) {
  const variant = pickStone(rng, placer, u, v, rng.chance(0.4) ? SHORT : TALL);
  if (!variant) return 0;
  let placed = placer.try({
    kind: 'stone', variant, u, v,
    gridYaw: FACE + rng.jitter(0.4),
    foot: footprintOf('stone', variant),
  }) ? 1 : 0;
  if (placed && rng.chance(0.35)) {
    const bush = footprintOf('bush');
    const a = rng.float(0, Math.PI * 2);
    if (fits(placer, u + Math.cos(a) * 1.4, v + Math.sin(a) * 1.4, bush.height, bush.r)
      && placer.try({
        kind: 'bush', variant: 'bush',
        u: u + Math.cos(a) * 1.4, v: v + Math.sin(a) * 1.4,
        gridYaw: rng.float(0, Math.PI * 2), foot: bush,
      })) placed++;
  }
  return placed;
}

function scrub({ rng, placer, u, v }) {
  const n = rng.int(1, 4);
  const foot = footprintOf('bush');
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const a = rng.float(0, Math.PI * 2);
    const d = rng.float(0, 2.2);
    const su = u + Math.cos(a) * d;
    const sv = v + Math.sin(a) * d;
    if (!fits(placer, su, sv, foot.height, foot.r)) continue;
    if (placer.try({ kind: 'bush', variant: 'bush', u: su, v: sv, gridYaw: rng.float(0, Math.PI * 2), foot })) placed++;
  }
  return placed;
}

function pumpkins({ rng, placer, u, v }) {
  const n = rng.int(2, 6);
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const variant = rng.pick(['tiny', 'classic', 'squat', 'gourd', 'pear', 'tall']);
    const foot = footprintOf('pumpkin', variant);
    const a = rng.float(0, Math.PI * 2);
    const d = rng.float(0, 1.9);
    const su = u + Math.cos(a) * d;
    const sv = v + Math.sin(a) * d;
    if (!fits(placer, su, sv, foot.height, foot.r)) continue;
    if (placer.try({
      kind: 'pumpkin', variant, u: su, v: sv,
      gridYaw: rng.float(0, Math.PI * 2), foot,
    })) placed++;
  }
  return placed;
}

// A bench looking at the nearest path, which is the old rule and still the
// right one: a bench facing nothing is furniture, a bench facing somewhere is a
// place.
function restStop({ rng, placer, field, u, v }) {
  const near = field.nearestPath(u, v, 9);
  if (!Number.isFinite(near.dist) || near.dist > 9) return 0;
  const toward = Math.atan2(near.u - u, near.v - v);
  const foot = footprintOf('bench', 'bench');
  if (!fits(placer, u, v, foot.height, 0.75)) return 0;
  let placed = placer.try({ kind: 'bench', variant: 'bench', u, v, gridYaw: toward, foot }) ? 1 : 0;
  if (!placed) return 0;
  const variant = rng.pick(['post', 'crook', 'pillar', 'brazier']);
  const lFoot = footprintOf('lantern', variant);
  const su = u + Math.cos(toward + Math.PI / 2) * 1.5;
  const sv = v + Math.sin(toward + Math.PI / 2) * 1.5;
  if (fits(placer, su, sv, lFoot.height, lFoot.r)
    && placer.try({ kind: 'lantern', variant, u: su, v: sv, gridYaw: FACE, foot: lFoot })) placed++;
  return placed;
}

const SITE_KINDS = [
  [wanderRow, 5], [cluster, 3.5], [pairStones, 2], [loneStone, 3],
  [scrub, 2.5], [pumpkins, 1.2], [restStop, 1.0],
];

// --- the grave ---------------------------------------------------------------
//
// One per chunk, because the rules half re-homes a dead skeleton to a grave 10
// to 20 units away and there has to be one wherever the ghost is standing. It
// is placed FIRST and it is HARD: nothing in this chunk or any neighbouring one
// may push it aside, which is what turns "usually a grave" into a floor.
//
// Rule 4 itself is not re-solved here. layout/motifs.js worked out where the
// spoil heap and the headstone go relative to the mouth of the hole and that
// answer is imported, not copied.

export function placeGrave({ field, placer, cx, cz, rng }) {
  const box = chunkBox(cx, cz);
  const centre = { x: box.minX + CHUNK / 2, z: box.minZ + CHUNK / 2 };
  const anchor = {
    x: centre.x + rng.float(-2.2, 2.2),
    z: centre.z + rng.float(-2.2, 2.2),
  };
  // Candidate spots on a one unit lattice inside the guaranteed window, nearest
  // to the anchor first. The window is what the density floor is proved on, so
  // the search may wander inside it and nowhere else.
  const spots = [];
  for (let dz = -GRAVE_REACH; dz <= GRAVE_REACH + 1e-9; dz += 1) {
    for (let dx = -GRAVE_REACH; dx <= GRAVE_REACH + 1e-9; dx += 1) {
      const x = centre.x + dx;
      const z = centre.z + dz;
      spots.push({ x, z, d: Math.hypot(x - anchor.x, z - anchor.z) });
    }
  }
  spots.sort((a, b) => a.d - b.d);

  const variant = rng.pick(['heart', 'fred', 'celtic', 'gothic', 'wheel', 'urn', 'column']);
  const ext = graveExtents(variant);
  const headSide = rng.chance(0.5) ? 1 : -1;
  // The placer's tryGroup, told that this group outranks everything soft.
  const hardPlacer = { ...placer, tryGroup: (specs) => placer.tryGroup(specs, { asHard: true }) };

  for (const spot of spots) {
    const g = field.frame.toGrid(spot.x, spot.z);
    const u = g.u - headSide * ext.shift;
    const v = g.v;
    // The heap goes on the long side AWAY from the nearest path, which is the
    // same rule the maze had with the corridor in the path's place.
    const near = field.nearestPath(u, v, 10);
    const side = Number.isFinite(near.dist) && near.v >= v ? -1 : 1;
    const group = graveGroup({ placer: hardPlacer, rng, u, v, pileSide: side, headSide, stoneVariant: variant });
    if (group) {
      return {
        hole: group[0],
        x: group[0].x, z: group[0].z, yaw: group[0].yaw,
        u: group[0].u, v: group[0].v,
      };
    }
  }
  return null;
}

// --- inside a family plot ----------------------------------------------------

export function furnishPlot({ field, placer, run, rng }) {
  const inner = run.interior;
  if (!inner) return 0;
  let placed = 0;
  // One to three wandering rows across the plot, back to front, which is what a
  // family plot is: the same few names in the same few feet of ground.
  const rows = Math.max(1, Math.min(3, Math.floor((inner.halfV * 2) / 2.2)));
  const pool = rng.chance(0.3) ? SHORT : TALL;
  for (let r = 0; r < rows; r++) {
    const v = inner.v + inner.halfV - 0.9 - r * ((inner.halfV * 2 - 1.8) / Math.max(1, rows - 1 || 1));
    const lean = rng.float(-0.12, 0.12);
    let u = inner.u - inner.halfU + rng.float(0.5, 1.1);
    while (u < inner.u + inner.halfU - 0.4) {
      const sv = v + (u - inner.u) * lean + rng.jitter(0.14);
      const variant = pickStone(rng, placer, u, sv, pool);
      if (variant) {
        const foot = footprintOf('stone', variant);
        if (Math.abs(u - inner.u) + foot.halfU <= inner.halfU
          && placer.try({
            kind: 'stone', variant, u, v: sv,
            gridYaw: FACE + rng.jitter(0.08), foot,
          })) placed++;
      }
      u += rng.float(1.5, 2.4);
    }
  }
  // A lantern just inside the gate, which is what makes an entrance read as an
  // entrance. The old layout did the same thing with lanternCorners.
  const gate = run.gates[0];
  if (gate) {
    const g = field.frame.toGrid(gate.x, gate.z);
    const toward = Math.atan2(inner.u - g.u, inner.v - g.v);
    const variant = rng.pick(PATH_LANTERNS);
    const foot = footprintOf('lantern', variant);
    const su = g.u + Math.sin(toward) * 2.3;
    const sv = g.v + Math.cos(toward) * 2.3;
    if (fits(placer, su, sv, foot.height, foot.r)
      && placer.try({ kind: 'lantern', variant, u: su, v: sv, gridYaw: FACE, foot })) placed++;
  }
  return placed;
}

// --- lanterns along a path ---------------------------------------------------
//
// Not at every site and not evenly: one every sixteen units of curve, kept
// about half the time, on whichever side the hash says. A path that is lit all
// the way is a corridor again.

const LAMP_STEP = 16;

export function pathLanterns({ field, placer, cx, cz }) {
  const box = chunkBox(cx, cz);
  const g = {
    minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity,
  };
  for (const [x, z] of [[box.minX, box.minZ], [box.maxX, box.minZ], [box.minX, box.maxZ], [box.maxX, box.maxZ]]) {
    const p = field.frame.toGrid(x, z);
    g.minU = Math.min(g.minU, p.u); g.maxU = Math.max(g.maxU, p.u);
    g.minV = Math.min(g.minV, p.v); g.maxV = Math.max(g.maxV, p.v);
  }
  let placed = 0;
  const emit = (family, k, t) => {
    const rng = rngAt(field.seed, 'lamp/' + family, k, Math.round(t));
    if (!rng.chance(0.5)) return;
    const on = family === 'u'
      ? { u: field.uPathAt(k, t), v: t }
      : { u: t, v: field.vPathAt(k, t) };
    const slope = field.pathSlope(family, k, t);
    // The outward normal of the curve, unit, in grid.
    const n = family === 'u'
      ? { du: 1 / Math.hypot(1, slope), dv: -slope / Math.hypot(1, slope) }
      : { du: -slope / Math.hypot(slope, 1), dv: 1 / Math.hypot(slope, 1) };
    const side = rng.chance(0.5) ? 1 : -1;
    const variant = rng.pick(PATH_LANTERNS);
    const foot = footprintOf('lantern', variant);
    const off = PATH_HALF + foot.r + rng.float(0.35, 0.9);
    const u = on.u + n.du * off * side;
    const v = on.v + n.dv * off * side;
    const w = field.frame.toWorld(u, v);
    if (w.x < box.minX || w.x >= box.maxX || w.z < box.minZ || w.z >= box.maxZ) return;
    if (!fits(placer, u, v, foot.height, foot.r)) return;
    if (placer.try({ kind: 'lantern', variant, u, v, gridYaw: FACE, foot })) placed++;
  };
  for (const k of field.uPathsNear((g.minU + g.maxU) / 2, (g.maxU - g.minU) / 2 + 3)) {
    for (let i = Math.floor(g.minV / LAMP_STEP) - 1; i <= Math.ceil(g.maxV / LAMP_STEP) + 1; i++) emit('u', k, i * LAMP_STEP);
  }
  for (const m of field.vPathsNear((g.minV + g.maxV) / 2, (g.maxV - g.minV) / 2 + 3)) {
    for (let i = Math.floor(g.minU / LAMP_STEP) - 1; i <= Math.ceil(g.maxU / LAMP_STEP) + 1; i++) emit('v', m, i * LAMP_STEP);
  }
  return placed;
}

// --- open ground -------------------------------------------------------------
//
// Sites on a 6.0 lattice with two units of jitter, thinned by the density field
// so the graveyard is uneven at the scale of a screen as well as at the scale
// of a stone, and thinned to nothing inside the entrance clearing.

export const SITE_PITCH = 6.0;

export function openSites({ field, placer, cx, cz }) {
  const box = chunkBox(cx, cz);
  const per = Math.round(CHUNK / SITE_PITCH);
  let placed = 0;
  for (let j = 0; j < per; j++) {
    for (let i = 0; i < per; i++) {
      const rng = rngAt(field.seed, 'site', cx * 977 + i, cz * 977 + j);
      const x = box.minX + (i + 0.5) * SITE_PITCH + rng.float(-2.0, 2.0);
      const z = box.minZ + (j + 0.5) * SITE_PITCH + rng.float(-2.0, 2.0);
      const open = field.openness(x, z);
      if (open <= 0) continue;
      const g = field.frame.toGrid(x, z);
      const keep = (0.34 + 0.52 * field.density(g.u, g.v)) * open;
      if (!rng.chance(keep)) continue;
      const make = rng.weighted(SITE_KINDS);
      placed += make({ rng, placer, field, u: g.u, v: g.v }) || 0;
    }
  }
  return placed;
}

export { STONE_HEIGHTS };
