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
// placed in cells, and how many survive depends on a smooth density field, so
// the arena has a crowded old corner and an empty one instead of one even crop.
//
// What does NOT change is rule 5. The reason the old layout could be organic
// only in its jitter is that position and height were chosen together: a taller
// stone one unit nearer the camera swallows the one behind it, so if you
// scatter positions freely you must not also scatter heights freely. The answer
// here is that positions are free and HEIGHT IS DERIVED: placer.heightWindow()
// reports what the neighbourhood will tolerate at a point and the composition
// picks a variant inside it. Short at the front, tall behind, no row required.

import { footprintOf, STONES, UPRIGHT, LOW, PATH_LANTERNS } from '../layout/footprints.js';
import { graveGroup, FACE } from '../layout/motifs.js';
import { rngAt, PATH_HALF, GRAVES, SPAWN_CLEAR, gridBoxOf } from './field.js';
import { segGap } from './fence.js';

const TALL = UPRIGHT.filter((n) => STONES[n]);
const SHORT = LOW.filter((n) => STONES[n]);

// The widest half extent across the screen any stone has, used as the
// conservative width when asking for a height window before the variant is
// known. The two tallest lanterns are never placed: the street lamp is 3.3 and
// reaches nine units of screen depth, so one of them in open ground sterilises
// a strip of arena behind it that rule 5 will not let anything stand in.
const WIDEST_ACROSS = 0.95;

function pickStone(rng, placer, u, v, pool) {
  const win = placer.heightWindow(u, v, WIDEST_ACROSS);
  const ok = pool.filter((n) => STONES[n].height >= win.lo && STONES[n].height <= win.hi);
  return ok.length ? rng.pick(ok) : null;
}

const fits = (placer, u, v, height, halfA = 0.6) => {
  const win = placer.heightWindow(u, v, halfA);
  return height >= win.lo && height <= win.hi;
};

// --- open ground compositions ---------------------------------------------------

// A row that wanders. Pitch varies per gap, the baseline drifts, the whole row
// leans a little, and every stone is turned a few degrees off the camera.
function wanderRow({ rng, placer, u, v }) {
  const n = rng.int(2, 6);
  const lean = rng.float(-0.32, 0.32);
  const turn = rng.float(-0.22, 0.22);
  const pool = rng.chance(0.22) ? SHORT : TALL;
  let placed = 0;
  let du = -((n - 1) * rng.float(1.5, 2.3)) / 2;
  for (let i = 0; i < n; i++) {
    const su = u + du;
    const sv = v + du * lean + rng.jitter(0.28);
    const variant = pickStone(rng, placer, su, sv, pool);
    if (variant && placer.try({
      kind: 'stone', variant, u: su, v: sv,
      gridYaw: FACE + turn + rng.jitter(0.09),
      foot: footprintOf('stone', variant),
    })) placed++;
    du += rng.float(1.4, 2.6);
  }
  return placed;
}

// A knot of stones with no row in it: a family that ran out of room and buried
// inward. Heights come out of the window, so the knot sorts itself short at the
// front without being told to.
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
    if (variant && placer.try({
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
      kind: 'stone', variant, u: u + s * half, v: v + rng.jitter(0.12),
      gridYaw: FACE + turn + rng.jitter(0.05), foot,
    })) placed++;
  }
  return placed;
}

function loneStone({ rng, placer, u, v }) {
  const variant = pickStone(rng, placer, u, v, rng.chance(0.4) ? SHORT : TALL);
  if (!variant) return 0;
  let placed = placer.try({
    kind: 'stone', variant, u, v,
    gridYaw: FACE + rng.jitter(0.4), foot: footprintOf('stone', variant),
  }) ? 1 : 0;
  if (placed && rng.chance(0.35)) {
    const bush = footprintOf('bush');
    const a = rng.float(0, Math.PI * 2);
    const su = u + Math.cos(a) * 1.4;
    const sv = v + Math.sin(a) * 1.4;
    if (fits(placer, su, sv, bush.height, bush.r)
      && placer.try({ kind: 'bush', variant: 'bush', u: su, v: sv, gridYaw: rng.float(0, Math.PI * 2), foot: bush })) placed++;
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
    if (fits(placer, su, sv, foot.height, foot.r)
      && placer.try({ kind: 'bush', variant: 'bush', u: su, v: sv, gridYaw: rng.float(0, Math.PI * 2), foot })) placed++;
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
    if (fits(placer, su, sv, foot.height, foot.r)
      && placer.try({ kind: 'pumpkin', variant, u: su, v: sv, gridYaw: rng.float(0, Math.PI * 2), foot })) placed++;
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
  if (!placer.try({ kind: 'bench', variant: 'bench', u, v, gridYaw: toward, foot })) return 0;
  let placed = 1;
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

// --- the graves -------------------------------------------------------------------
//
// Four of them, which is exactly src/ghost/ground.js's MAX_GROUND_HOLES, so a
// bounded arena has no hole budget to keep at all: every grave in the level can
// be cut at once and the fifth that would throw does not exist. One per
// quadrant, so wherever the ghost is standing there is one within about twelve
// units, which is the range the rules half re-homes a dead skeleton over.
//
// Rule 4 itself is not re-solved here. layout/motifs.js worked out where the
// spoil heap and the headstone go relative to the mouth of the hole and that
// answer is imported, not copied.

const BODY_CLEAR = 0.95;
const segDist = (px, pz, b) => segGap(px, pz, px, pz, b.x0, b.z0, b.x1, b.z1);

export function placeGraves({ field, placer, box, spawn, runs, rng }) {
  const frame = field.frame;
  const barriers = runs.flatMap((r) => r.segments);
  const interiors = runs.filter((r) => r.interior).map((r) => r.interior);
  const out = [];
  const inset = 3.2;
  const mid = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  const quadrants = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  // A grave is three and a half units long and has to thread between a path, a
  // fence and whatever else the quadrant holds, so it is allowed to turn. Square
  // to the camera is tried everywhere before any angle is, and a headstone
  // twenty degrees off the camera still reads as a headstone.
  const TURNS = [0];
  for (let k = 1; k <= 6; k++) TURNS.push((k * Math.PI) / 12, -(k * Math.PI) / 12);

  const holeFoot = footprintOf('hole');
  const turnAbout = (cu, cv, theta, u, v) => ({
    u: cu + (u - cu) * Math.cos(theta) - (v - cv) * Math.sin(theta),
    v: cv + (u - cu) * Math.sin(theta) + (v - cv) * Math.cos(theta),
  });
  // Rotating the positions by theta turns a footprint's grid yaw by MINUS
  // theta, because grid and world are a reflection apart rather than a
  // rotation.
  const turnedPlacer = (cu, cv, theta) => ({
    ...placer,
    tryGroup: (specs) => placer.tryGroup(specs.map((s) => ({
      ...s,
      ...turnAbout(cu, cv, theta, s.u, s.v),
      gridYaw: s.gridYaw - theta,
    }))),
  });

  // A quadrant each, and then anywhere at all for whichever quadrants could
  // not take one. Four graves is a FLOOR the rules half re-homes dead skeletons
  // against, so a level with three is a level where a skeleton can be stranded,
  // and a grave in the wrong quarter is better than no grave.
  const regions = quadrants.map((q) => ({ q, wide: false }));
  for (let extra = 0; extra < 10; extra++) regions.push({ q: quadrants[extra % 4], wide: true, apart: extra < 4 ? 6 : 4.5 });
  for (const region of regions) {
    if (out.length >= GRAVES) break;
    const [sx, sz] = region.q;
    const qBox = region.wide ? {
      minX: box.minX + inset, maxX: box.maxX - inset,
      minZ: box.minZ + inset, maxZ: box.maxZ - inset,
    } : {
      minX: sx < 0 ? box.minX + inset : mid.x + 1, maxX: sx < 0 ? mid.x - 1 : box.maxX - inset,
      minZ: sz < 0 ? box.minZ + inset : mid.z + 1, maxZ: sz < 0 ? mid.z - 1 : box.maxZ - inset,
    };
    const anchor = {
      x: (qBox.minX + qBox.maxX) / 2 + rng.float(-1.5, 1.5),
      z: (qBox.minZ + qBox.maxZ) / 2 + rng.float(-1.5, 1.5),
    };
    const spots = [];
    for (let z = qBox.minZ; z <= qBox.maxZ + 1e-9; z += 0.6) {
      for (let x = qBox.minX; x <= qBox.maxX + 1e-9; x += 0.6) {
        // Never at the ghost's feet, and never inside a pen, where it would be
        // the thing that cuts the interior in two.
        if (Math.hypot(x - spawn.x, z - spawn.z) < SPAWN_CLEAR + 2.5) continue;
        const g = frame.toGrid(x, z);
        let inPen = false;
        for (const it of interiors) {
          if (Math.abs(g.u - it.u) < it.halfU + 2.2 && Math.abs(g.v - it.v) < it.halfV + 2.2) inPen = true;
        }
        if (inPen) continue;
        spots.push({ x, z, g, d: Math.hypot(x - anchor.x, z - anchor.z) });
      }
    }
    spots.sort((a, b) => a.d - b.d);

    const variant = rng.pick(['heart', 'fred', 'celtic', 'gothic', 'wheel', 'urn', 'column']);
    const first = rng.chance(0.5) ? 1 : -1;
    let made = null;
    for (const theta of TURNS) {
      for (const headSide of [first, -first]) {
        for (const spot of spots) {
          const u = spot.g.u;
          const v = spot.g.v;
          const t = turnAbout(u, v, theta, u, v);
          if (!placer.wouldFit({ kind: 'hole', variant: 'grave', u: t.u, v: t.v, gridYaw: FACE - theta, foot: holeFoot })) continue;
          // The heap goes on the long side AWAY from the nearest path, which
          // is the same rule the maze had with the corridor in the path's
          // place. TURNED, though: the grave may be at an angle, and the long
          // side turns with it, so the side is decided against the direction
          // the heap will actually end up in rather than against plain v. The
          // untorned version put the heap on the path side of one grave in two
          // hundred, which is exactly the levels where the grave had to turn.
          const near = field.nearestPath(u, v, 10);
          const heapDir = { u: -Math.sin(theta), v: Math.cos(theta) };
          const toPath = Number.isFinite(near.dist)
            ? { u: near.u - u, v: near.v - v } : { u: 0, v: 1 };
          const side = (heapDir.u * toPath.u + heapDir.v * toPath.v) >= 0 ? -1 : 1;
          const group = graveGroup({
            placer: turnedPlacer(u, v, theta), rng, u, v,
            pileSide: side, headSide, stoneVariant: variant,
          });
          if (!group) continue;
          // A grave a body cannot stand at is a grave no skeleton can be
          // re-homed to, so the mouth keeps a whole body's clearance from every
          // fence rather than the 0.15 a prop needs.
          if (barriers.some((b) => segDist(group[0].x, group[0].z, b) < BODY_CLEAR)) {
            placer.drop(group);
            continue;
          }
          // Never taken back out by the repair pass: a grave is guaranteed
          // content and rule 4 needs all three pieces of it.
          for (const q of group) q.keep = true;
          made = group;
          break;
        }
        if (made) break;
      }
      if (made) break;
    }
    if (made) {
      out.push({
        id: `grave${out.length}`,
        x: made[0].x, z: made[0].z, yaw: made[0].yaw, u: made[0].u, v: made[0].v,
      });
    }
  }
  return out;
}

// --- inside a pen -------------------------------------------------------------------

export function furnishPen({ field, placer, run, rng }) {
  const inner = run.interior;
  if (!inner) return [];
  const made = [];
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
        if (Math.abs(u - inner.u) + foot.halfU <= inner.halfU) {
          const p = placer.try({ kind: 'stone', variant, u, v: sv, gridYaw: FACE + rng.jitter(0.08), foot });
          if (p) made.push(p);
        }
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
    const su = g.u + Math.sin(toward) * 2.6;
    const sv = g.v + Math.cos(toward) * 2.6;
    if (fits(placer, su, sv, foot.height, foot.r)) {
      const p = placer.try({ kind: 'lantern', variant, u: su, v: sv, gridYaw: FACE, foot });
      if (p) made.push(p);
    }
  }
  return made;
}

// --- lanterns along a path -----------------------------------------------------------
//
// Not at every site and not evenly: one every nine units of curve, kept about
// half the time, on whichever side the hash says. A path lit all the way is a
// corridor again.

const LAMP_STEP = 9;

export function pathLanterns({ field, placer, box }) {
  const g = gridBoxOf(field.frame, box);
  let placed = 0;
  const emit = (family, k, t) => {
    const rng = rngAt(field.seed, 'lamp/' + family, k, Math.round(t));
    if (!rng.chance(0.45)) return;
    const on = family === 'u' ? { u: field.uPathAt(k, t), v: t } : { u: t, v: field.vPathAt(k, t) };
    const slope = field.pathSlope(family, k, t);
    const n = family === 'u'
      ? { du: 1 / Math.hypot(1, slope), dv: -slope / Math.hypot(1, slope) }
      : { du: -slope / Math.hypot(slope, 1), dv: 1 / Math.hypot(slope, 1) };
    const side = rng.chance(0.5) ? 1 : -1;
    const variant = rng.pick(PATH_LANTERNS);
    const foot = footprintOf('lantern', variant);
    const off = PATH_HALF + foot.r + rng.float(0.35, 0.9);
    const u = on.u + n.du * off * side;
    const v = on.v + n.dv * off * side;
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

// --- open ground ---------------------------------------------------------------------
//
// Sites on a 6.0 lattice with two units of jitter, thinned by the density field
// so the arena is uneven at the scale of a corner as well as at the scale of a
// stone, and thinned to nothing where the ghost stands.

export const SITE_PITCH = 4.0;

export function openSites({ field, placer, box, spawn }) {
  const size = box.maxX - box.minX;
  const per = Math.max(1, Math.round(size / SITE_PITCH));
  const pitch = size / per;
  let placed = 0;
  for (let j = 0; j < per; j++) {
    for (let i = 0; i < per; i++) {
      const rng = rngAt(field.seed, 'site', i, j);
      const x = box.minX + (i + 0.5) * pitch + rng.float(-2.0, 2.0);
      const z = box.minZ + (j + 0.5) * pitch + rng.float(-2.0, 2.0);
      if (Math.hypot(x - spawn.x, z - spawn.z) < SPAWN_CLEAR) continue;
      const g = field.frame.toGrid(x, z);
      if (!rng.chance(0.55 + 0.4 * field.density(g.u, g.v))) continue;
      const make = rng.weighted(SITE_KINDS);
      placed += make({ rng, placer, field, u: g.u, v: g.v }) || 0;
    }
  }
  return placed;
}
