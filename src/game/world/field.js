// The fields a level is made of: everything here is a PURE FUNCTION of the seed
// and a position, with no state and no build order.
//
// This file survived the world going from endless to bounded almost unchanged,
// which is the argument for having written it this way. The paths are curves
// you can evaluate anywhere rather than a list somebody builds; the ground
// density is a scalar you can read anywhere; the randomness is drawn from
// streams named by what they decide. None of that cared whether the ground went
// on for ever, and none of it had to be rewritten when it stopped.
//
// What DID go was the chunking: the chunk lattice, the grave region lattice and
// the streaming caches, all of which existed only to make an infinite world
// buildable a piece at a time. A level is 30 by 30 and is built once.
//
// Coordinates. Two frames, one isometry apart, exactly as the layout package
// has them. GRID (u, v) is the camera's own plane: u runs across the screen, v
// runs up it, and screen depth is x + z. WORLD (x, z) is that plane turned 45
// degrees. The ARENA is a square on the WORLD axes, because the owner sized it
// off src/ghost/ground.js's floor grid, which is drawn from world position: a
// major line every 5.0, six of those a side, so 30 by 30. On screen that square
// is a diamond and the floor grid runs diagonally, which is what the scene
// already looks like. The PATHS and every placement rule stay in GRID, because
// rule 5 is a fact about the camera and a path that wanders in v wanders up the
// screen rather than diagonally across it.

import { createRng } from '../layout/rng.js';
import { makeFrame } from '../layout/frame.js';

export const TAU = Math.PI * 2;

// --- the arena ----------------------------------------------------------------

// The owner's size, read off the floor. ground.js draws a minor grid line every
// 1.0 and a major one every 5.0, so a "large square" is 5 by 5 with 5 by 5
// minor squares in it, and six of those a side is 30 world units. This is the
// MAXIMUM; createWorld takes a smaller one and everything below scales with it.
export const LEVEL_SIZE = 30;

// The perimeter. It is not the 0.86 fence: it is a wall you cannot see over and
// cannot hop, with darkness beyond it, and it is the only closed loop of
// barrier in the level. The height is what the wall asset will publish; until
// it does this is the number the rest of the world assumes.
export const WALL_HEIGHT = 3.2;
export const WALL_HALF = 0.25;

// --- the paths ------------------------------------------------------------------
//
// Two families of wandering curves, one running up the screen and one across
// it, and where they meet there is a crossroads.
//
// An endless graveyard drew them off a lattice of one every 18, which is the
// right way to do it when the ground goes on for ever and the wrong way in a
// box: a path is 2.3 wide, an arena is 30 across, and a lattice that happens to
// drop four curves into it turns forty per cent of the level into road. So a
// LEVEL CHOOSES ITS OWN AVENUES: one or two each way, placed across the middle
// of the arena, which is one or two crossroads and about a fifth of the ground.
// PATH_COUNT is the weighting, and everything else about a path is unchanged.
export const PATH_COUNT = [[1, 3], [2, 2]];
// How far out from the middle of the arena an avenue may be laid, as a fraction
// of the arena's own half width in grid. Beyond about half of it a path spends
// most of its length outside the wall.
export const PATH_SPREAD = 0.5;
// Half the clear width. DESIGN.md's corridor was 2.0 because the skeleton is
// 0.95 across and the ghost 1.31, so two of them pass with 0.3 either side.
// 2.3 keeps that and spends the extra 0.3 where clear ground is scarce.
export const PATH_HALF = 1.15;

// --- what the arena holds --------------------------------------------------------
//
// Counts for a 30 by 30 level. index.js turns them into positions and says why
// each number is what it is.
// FIVE fireflies in a quincunx, which is the owner's decision and is a
// statement about spacing rather than about count. Measured over 40 arenas with
// points placed for distance alone: nine of them in a 30 by 30 arena cannot be
// further apart than 13.8 and come out at about 11 once they also dodge props
// and fences, where five reach 19.8. The owner asked to have to cross the
// screen for the next one, and the camera shows about 22 across, so nine is
// asking for a step and five is asking for a walk.
// SIX, on the owner's rule: six on the map, and when one is left five more
// appear. The quincunx of five below is what this used to be and the shape
// survives it -- five at the corners and the middle, plus one -- but the count
// is now the size of a BOARD that refills for ever rather than the whole of
// what a level holds.
export const FLIES = 6;
export const FLY_REACH = 2.2;       // how far one may be pulled toward a gate or a pen
// The least ground between two of them. Raised with the count: at nine this
// was the binding constraint and at five it is slack, since the quincunx puts
// them 19.1 apart before anything moves. It is now a floor that catches a pair
// shoved together by two nudges, not the thing setting the spacing.
export const FLY_GAP = 12.0;
// NO POWERUPS. There were four, one per quadrant, and they were Pac-Man's
// power pellet as a lit jack-o'-lantern. The owner has taken the pellet out of
// the game; see rules.js for what the game loses with it and for the four
// constants that would come back if it returned.
export const GRAVES = 4;            // exactly MAX_GROUND_HOLES, so there is no budget to keep
export const SPAWN_CLEAR = 3.2;     // the ghost's own patch of ground

// --- hashing ------------------------------------------------------------------
//
// Every random decision is drawn from a stream named by the thing it decides,
// exactly as rng.js argues: a generator that pulls everything off one sequence
// is one where changing the fences changes every stone, and then a fix cannot
// be reviewed because you cannot tell what you changed from what merely
// resequenced.

export function hash32(seed, ...vals) {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (const v of vals) {
    h = Math.imul(h ^ ((v | 0) + 0x7ed55d16), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function rngAt(seed, tag, ...vals) {
  return createRng(hash32(seed, hashText(tag), ...vals));
}

// --- the field ------------------------------------------------------------------

function makeWaves(rng, count, minLen, maxLen) {
  return Array.from({ length: count }, () => {
    const angle = rng.float(0, TAU);
    const len = rng.float(minLen, maxLen);
    return { ku: Math.cos(angle) / len, kv: Math.sin(angle) / len, phase: rng.float(0, TAU) };
  });
}

function sampleWaves(waves, u, v) {
  let sum = 0;
  for (const w of waves) sum += Math.sin(TAU * (w.ku * u + w.kv * v) + w.phase);
  return sum / waves.length;
}

export function createField(seed, { size = LEVEL_SIZE } = {}) {
  const frame = makeFrame('screen');

  // The wander, as two sines with hashed phases. Sines rather than a noise
  // table because a sine can be evaluated anywhere with no lattice and no
  // interpolation, which is what let this file survive the world going from
  // endless to bounded. The amplitudes are capped so a path stays well inside
  // the arena it was laid across.
  const AMP1 = [1.8, 2.8];
  const AMP2 = [0.7, 1.3];
  const PATH_SWING = AMP1[1] + AMP2[1];

  // The avenues this level has. Grid half width of a world square of side
  // `size` is size / sqrt(2), and the bases are spread over half of that.
  const half = (size * Math.SQRT1_2) / 2;
  const pickBases = (family) => {
    const rng = rngAt(seed, 'avenues/' + family);
    const n = rng.weighted(PATH_COUNT);
    const span = 2 * half * PATH_SPREAD;
    return Array.from({ length: n }, (_, i) => (
      n === 1 ? rng.float(-span * 0.18, span * 0.18)
        : -span / 2 + (i * span) / (n - 1) + rng.float(-1.6, 1.6)
    ));
  };
  const bases = { u: pickBases('u'), v: pickBases('v') };

  const waveCache = new Map();
  function pathWaves(family, k) {
    const key = family + ':' + k;
    let w = waveCache.get(key);
    if (!w) {
      const rng = rngAt(seed, 'path/' + family, k);
      w = [
        { amp: rng.float(AMP1[0], AMP1[1]), len: rng.float(11, 17), phase: rng.float(0, TAU) },
        { amp: rng.float(AMP2[0], AMP2[1]), len: rng.float(5.5, 8.5), phase: rng.float(0, TAU) },
      ];
      waveCache.set(key, w);
    }
    return w;
  }

  function pathOffset(family, k, t) {
    const w = pathWaves(family, k);
    return w[0].amp * Math.sin(t / w[0].len + w[0].phase) + w[1].amp * Math.sin(t / w[1].len + w[1].phase);
  }
  function pathSlope(family, k, t) {
    const w = pathWaves(family, k);
    return (w[0].amp / w[0].len) * Math.cos(t / w[0].len + w[0].phase)
      + (w[1].amp / w[1].len) * Math.cos(t / w[1].len + w[1].phase);
  }

  const uPathAt = (k, v) => bases.u[k] + pathOffset('u', k, v);
  const vPathAt = (m, u) => bases.v[m] + pathOffset('v', m, u);

  const nearIn = (list, at, reach) => {
    const out = [];
    for (let i = 0; i < list.length; i++) if (Math.abs(list[i] - at) <= reach + PATH_SWING) out.push(i);
    return out;
  };
  const uPathsNear = (u, reach) => nearIn(bases.u, u, reach);
  const vPathsNear = (v, reach) => nearIn(bases.v, v, reach);

  // The largest slope any curve can have. It lets one evaluation bound a
  // curve's distance from below and prune the search to the curve that matters,
  // which is worth doing because this is the hottest function in the package.
  const MAX_SLOPE = AMP1[1] / 11 + AMP2[1] / 5.5;
  const SLANT = Math.hypot(1, MAX_SLOPE);

  function refine(at, other, axis, k) {
    let bt = at;
    let bd = Infinity;
    for (let step = 1.0; step >= 0.05; step /= 5) {
      for (let t = bt - step * 4; t <= bt + step * 4 + 1e-9; t += step) {
        const c = axis === 'u' ? uPathAt(k, t) : vPathAt(k, t);
        const d = axis === 'u' ? Math.hypot(c - other, t - at) : Math.hypot(t - at, c - other);
        if (d < bd) { bd = d; bt = t; }
      }
    }
    return { d: bd, t: bt };
  }

  function nearestPath(u, v, reach = 6) {
    const cand = [];
    let cap = Infinity;
    for (const k of uPathsNear(u, reach)) {
      const side = Math.abs(uPathAt(k, v) - u);
      cap = Math.min(cap, side);
      cand.push({ family: 'u', k, lo: side / SLANT });
    }
    for (const m of vPathsNear(v, reach)) {
      const side = Math.abs(vPathAt(m, u) - v);
      cap = Math.min(cap, side);
      cand.push({ family: 'v', k: m, lo: side / SLANT });
    }
    let best = { dist: Infinity, family: null, k: 0, u: 0, v: 0 };
    cand.sort((a, b) => a.lo - b.lo);
    for (const c of cand) {
      if (c.lo > cap && c.lo > best.dist) continue;
      if (c.family === 'u') {
        const r = refine(v, u, 'u', c.k);
        if (r.d < best.dist) best = { dist: r.d, family: 'u', k: c.k, u: uPathAt(c.k, r.t), v: r.t };
      } else {
        const r = refine(u, v, 'v', c.k);
        if (r.d < best.dist) best = { dist: r.d, family: 'v', k: c.k, u: r.t, v: vPathAt(c.k, r.t) };
      }
    }
    return best;
  }

  function crossing(k, m) {
    let v = bases.v[m];
    let u = uPathAt(k, v);
    for (let i = 0; i < 8; i++) {
      v = vPathAt(m, u);
      u = uPathAt(k, v);
    }
    return { u, v };
  }

  // How full the ground is. A graveyard that is evenly full everywhere is a
  // lawn with stones on it; this is what gives one corner of the arena a
  // crowded old quarter and another an empty meadow.
  const densityWaves = makeWaves(rngAt(seed, 'density'), 4, 14, 34);
  const density = (u, v) => 0.5 + 0.5 * sampleWaves(densityWaves, u, v);

  return {
    seed, frame, bases, PATH_SWING,
    uPathAt, vPathAt, uPathsNear, vPathsNear, pathSlope, nearestPath, crossing, density,
  };
}

// --- boxes ------------------------------------------------------------------

export const levelBox = (size) => ({ minX: -size / 2, maxX: size / 2, minZ: -size / 2, maxZ: size / 2 });

export function gridBoxOf(frame, box) {
  const c = [
    frame.toGrid(box.minX, box.minZ), frame.toGrid(box.maxX, box.minZ),
    frame.toGrid(box.minX, box.maxZ), frame.toGrid(box.maxX, box.maxZ),
  ];
  return {
    minU: Math.min(...c.map((p) => p.u)), maxU: Math.max(...c.map((p) => p.u)),
    minV: Math.min(...c.map((p) => p.v)), maxV: Math.max(...c.map((p) => p.v)),
  };
}

export function worldBoxOf(frame, gbox) {
  const c = [
    frame.toWorld(gbox.minU, gbox.minV), frame.toWorld(gbox.maxU, gbox.minV),
    frame.toWorld(gbox.minU, gbox.maxV), frame.toWorld(gbox.maxU, gbox.maxV),
  ];
  return {
    minX: Math.min(...c.map((p) => p.x)), maxX: Math.max(...c.map((p) => p.x)),
    minZ: Math.min(...c.map((p) => p.z)), maxZ: Math.max(...c.map((p) => p.z)),
  };
}

export const boxesOverlap = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
export const padBox = (box, pad) => ({
  minX: box.minX - pad, maxX: box.maxX + pad, minZ: box.minZ - pad, maxZ: box.maxZ + pad,
});
export const inBox = (box, x, z) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;

export default createField;
