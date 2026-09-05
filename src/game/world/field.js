// The fields the world is made of: everything here is a PURE FUNCTION of the
// seed and a position, with no state, no chunk and no build order.
//
// This is the layer that makes an endless world possible at all. A chunk can
// only be built without reference to its non-neighbours if the things that
// span chunks are not built at all but EVALUATED: the paths are curves you can
// sample at any point, the ground density is a scalar you can read at any
// point, and the lattice that decides where an open grave or a firefly may
// exist is arithmetic on the coordinate rather than a list somebody has to
// keep. Only the things that are LOCAL (a fenced plot, a row of stones) are
// generated per chunk, and those are the only things a neighbour has to be
// consulted about.
//
// Coordinates. The world works in the same two frames the layout package does.
// GRID (u, v) is the camera's own plane: u runs across the screen, v runs up
// it, and screen depth is x + z = -sqrt(2) v. WORLD (x, z) is that plane turned
// 45 degrees, and frame.js owns the isometry. Every field below is defined in
// GRID, because rule 5 is a fact about the camera and a path that wanders in v
// is a path that wanders up the screen rather than diagonally across it.
// Chunks, by contrast, are squares on the WORLD axes, because a chunk is a
// streaming unit that the renderer and the navigation half both address in
// world coordinates. The two are one isometry apart and gridBoxOf() below is
// that conversion.

import { createRng } from '../layout/rng.js';
import { makeFrame } from '../layout/frame.js';

export const TAU = Math.PI * 2;

// --- the numbers ------------------------------------------------------------

// One chunk, in world units. Chosen from the interaction radius: the tallest
// prop the world places is the obelisk at 1.85, which loses 0.39 of apparent
// height per unit of screen depth, so it can reach 1.85 / 0.39 = 4.7 units of
// depth, which is 3.4 units of v. Add the widest footprint and rule 1's own
// margin and nothing a prop does reaches more than about 5 units. A chunk
// larger than that reach means the 3 by 3 neighbourhood of a chunk always
// contains everything that could argue with it, which is what makes a chunk
// buildable from its neighbours alone. 24 is that with a factor of four to
// spare, it is twelve whole 2.0 fence panels, and it holds one family plot and
// a dozen sites of open ground without being so big that streaming it in is a
// visible event.
export const CHUNK = 24;

// The paths. Two families of wandering curves, one running up the screen and
// one across it. 18 apart is three times the old maze's 6.0 corridor pitch and
// it is the number that stops the ground reading as corridors: at 18 the player
// is in open ground and a path is somewhere to walk rather than the only place
// they can be.
export const PATH_SPACING = 18;
// Half the clear width. DESIGN.md's corridor is 2.0 because the skeleton is
// 0.95 across and the ghost 1.31, so two of them pass with 0.3 either side.
// Nothing about that changed, so the path is not narrower than the corridor
// was: 2.3 wide, with the extra 0.3 spent on the one place in the world where
// clear ground is scarce, which is the seven unit window a chunk's grave has to
// find room in when a crossroads lands in the middle of it.
export const PATH_HALF = 1.15;

// The firefly lattice. One firefly per cell, and the cell is the whole of the
// pacing: at view 9.0 the camera shows 18 world units of screen height, so a
// cell of 20 is one firefly per screen and the player has to choose a direction
// and commit rather than graze. See index.js for the measured spacing this
// actually produces, and world-check.mjs for the number it was tuned against:
// a cell is not the spacing, because a firefly is pulled off its cell centre,
// so the cell was walked and adjusted until the mean nearest neighbour landed
// on the eighteen units the rules half is pricing a firefly at.
export const FLY_CELL = 20;
// How far a firefly may be pulled off its cell centre to reach something worth
// walking to. Bounds the spacing: two neighbours can be as close as
// FLY_CELL - 2 * FLY_REACH and as far as FLY_CELL + 2 * FLY_REACH.
export const FLY_REACH = 4.0;

// The power pellet lattice, in world units, with the jitter it is allowed. The
// rules half asked for a FLOOR of one per 64 by 64 box anywhere, and a lattice
// of pitch p with jitter j meets it when p + 2j <= 64 (no gap wider than a box)
// and p <= 64 - 2j (every box holds one whole jitter window, so the guarantee
// does not care how the jitters happen to correlate). 52 and 5 satisfy both
// with two units of slack, and 5 is enough freedom to put the pellet on a path
// rather than in the middle of nowhere.
export const POWER_CELL = 52;
export const POWER_REACH = 5;

// Graves. Two constraints pull in opposite directions and this is where they
// meet.
//
//   The FLOOR: the rules half re-homes a dead skeleton to a grave 10 to 20
//   units from the ghost, so there has to be one in every 32 by 32 box. One
//   grave per chunk, anywhere within GRAVE_REACH of the chunk centre, gives
//   that when 24 + 2 * GRAVE_REACH <= 32, so that no gap between consecutive
//   graves on an axis exceeds a box, AND 24 <= 32 - 2 * GRAVE_REACH, so that
//   every box holds one whole window and the guarantee does not depend on how
//   the two axes happen to correlate. Both are GRAVE_REACH <= 4.
//
//   The CEILING: src/ghost/ground.js can only cut the floor MAX_GROUND_HOLES
//   times and THROWS at the next one. A grave's x is 24 * cx + 12 + something
//   in [-R, R], so a 40 wide window can only hold graves from chunks whose cx
//   spans an interval of 40 + 2R; that is under two lattice steps exactly when
//   R < 4. At most two columns and two rows, so AT MOST FOUR GRAVES WITHIN A
//   DISC OF RADIUS 20 of anywhere in the world, which is exactly the budget.
//
// Both want R < 4 and the placement wants R as large as it can get, because the
// window is the only room a grave has when a crossroads lands on a chunk
// centre. 3.8 leaves 0.4 of slack on the floor and 0.4 on the ceiling. The
// consumer's side of the bargain is in index.js: cut holes for the nearest
// MAX_NEAR_HOLES graves inside HOLE_RADIUS and no others.
export const GRAVE_REACH = 3.8;
export const HOLE_RADIUS = 20;
export const MAX_NEAR_HOLES = 4;
export const GRAVE_BOX = 32;

// The entrance. The player starts at the origin and the owner asked for the
// start to be spacious, so nothing is built inside this radius and the site
// density is faded back in over the next eight units.
export const START_CLEAR = 11;
export const START_FADE = 8;

// --- hashing ----------------------------------------------------------------
//
// Every random decision in the world is drawn from a stream named by the thing
// it decides, exactly as rng.js argues: a generator that pulls everything off
// one sequence is one where changing the fences changes every stone. Here the
// name is a coordinate, so the stream for chunk (3, -2) is the same stream
// whatever order the world was walked in.

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
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

// A named stream at a coordinate. rngAt(seed, 'chunk', 3, -2) is stable forever.
export function rngAt(seed, tag, ...vals) {
  return createRng(hash32(seed, hashText(tag), ...vals));
}

// A single number in [0, 1) at a coordinate, for the yes-or-no decisions that
// do not deserve a whole stream.
export function chanceAt(seed, tag, ...vals) {
  return rngAt(seed, tag, ...vals).next();
}

// --- the field --------------------------------------------------------------

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

export function createField(seed) {
  const frame = makeFrame('screen');

  // --- the paths ------------------------------------------------------------
  //
  // A path is a curve, not a corridor. Family 'u' runs up the screen: curve k
  // is u = 18k + wander(v), so it is single valued in v and can be sampled at
  // any v without solving anything. Family 'v' runs across the screen the same
  // way. Where a u curve meets a v curve there is a crossroads, and that is the
  // only structure the world has that a player can navigate by, which is
  // exactly what a junction was for in the maze.
  //
  // The wander is two sines with hashed phases rather than a noise table,
  // because a sine can be evaluated at any coordinate at any time with no
  // lattice, no interpolation and no cache, which is what "infinite" means
  // here. The amplitudes are capped so a curve never wanders more than 5.2 off
  // its nominal line: half the spacing is 9, so two parallel paths can never
  // touch and the world can never accidentally close a route.
  const waveCache = new Map();
  function pathWaves(family, k) {
    const key = family + ':' + k;
    let w = waveCache.get(key);
    if (!w) {
      const rng = rngAt(seed, 'path/' + family, k);
      w = [
        { amp: rng.float(2.0, 3.2), len: rng.float(17, 26), phase: rng.float(0, TAU) },
        { amp: rng.float(0.8, 1.4), len: rng.float(7.5, 11.5), phase: rng.float(0, TAU) },
        // A fixed offset per curve, so the avenues are not eighteen apart
        // everywhere. Without it the network is a woven grid and the owner's
        // word for a woven grid is squarish. With it the spacing between two
        // neighbours runs from about nine to about twenty seven, and the
        // amplitudes above are capped so that even the closest pair keeps four
        // units of ground between them and can never merge.
        { amp: 0, len: 1, phase: 0, fixed: rng.float(-2.5, 2.5) },
      ];
      waveCache.set(key, w);
    }
    return w;
  }
  // The furthest a curve can be from its nominal line: both amplitudes plus
  // the fixed offset.
  const PATH_SWING = 3.2 + 1.4 + 2.5;

  function pathOffset(family, k, t) {
    const w = pathWaves(family, k);
    return w[0].amp * Math.sin(t / w[0].len + w[0].phase)
      + w[1].amp * Math.sin(t / w[1].len + w[1].phase) + w[2].fixed;
  }
  // The curve's slope, which the boundary fences use to stand square to a path.
  function pathSlope(family, k, t) {
    const w = pathWaves(family, k);
    return (w[0].amp / w[0].len) * Math.cos(t / w[0].len + w[0].phase)
      + (w[1].amp / w[1].len) * Math.cos(t / w[1].len + w[1].phase);
  }

  // Curve k of family 'u' at height v: the u it passes through.
  const uPathAt = (k, v) => PATH_SPACING * k + pathOffset('u', k, v);
  // Curve m of family 'v' at across u: the v it passes through.
  const vPathAt = (m, u) => PATH_SPACING * m + pathOffset('v', m, u);

  // Which curves could come within `reach` of a point.
  function uPathsNear(u, reach) {
    const lo = Math.ceil((u - reach - PATH_SWING) / PATH_SPACING);
    const hi = Math.floor((u + reach + PATH_SWING) / PATH_SPACING);
    const out = [];
    for (let k = lo; k <= hi; k++) out.push(k);
    return out;
  }
  function vPathsNear(v, reach) {
    const lo = Math.ceil((v - reach - PATH_SWING) / PATH_SPACING);
    const hi = Math.floor((v + reach + PATH_SWING) / PATH_SPACING);
    const out = [];
    for (let m = lo; m <= hi; m++) out.push(m);
    return out;
  }

  // The nearest point of any path, and how far it is. Sampled rather than
  // solved: the curves are gentle (slope under 0.45) so a coarse walk followed
  // by a refinement is exact to well under a centimetre, and it costs about a
  // hundred operations, which is nothing next to being able to ask the question
  // at any point in an infinite world.
  // The largest |du/dv| any curve can have, from the amplitudes above. It is
  // what lets a single evaluation bound a curve's distance from below: the
  // curve leaves the point at worst this steeply, so the perpendicular distance
  // is at least the sideways distance divided by sqrt(1 + slope squared).
  const MAX_SLOPE = 3.2 / 17 + 1.4 / 7.5;
  const SLANT = Math.hypot(1, MAX_SLOPE);

  function refine(at, other, axis, k) {
    // `at` is the curve's own parameter, `other` the coordinate to compare.
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
    // One evaluation per curve first. A curve's true distance lies between
    // sideways / SLANT and sideways, so the smallest upper bound over all the
    // curves rules out every curve whose lower bound is worse than it, which in
    // practice leaves one curve to refine instead of six. This is the single
    // hottest function in the package, called for every candidate prop, every
    // plot site and every step of the grave search.
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

  // Where curve k of one family meets curve m of the other. Both curves are
  // shallow, so substituting one into the other contracts by about 0.2 a step
  // and eight steps is machine precision.
  function crossing(k, m) {
    let v = PATH_SPACING * m;
    let u = uPathAt(k, v);
    for (let i = 0; i < 8; i++) {
      v = vPathAt(m, u);
      u = uPathAt(k, v);
    }
    return { u, v };
  }

  // --- how full the ground is ------------------------------------------------
  //
  // A graveyard that is evenly full everywhere is a lawn with stones on it. The
  // density field is what gives it old dense quarters and empty meadows, and it
  // is the large scale organic that the owner's "less squarish" asks for as
  // much as the small scale jitter is.
  const densityWaves = makeWaves(rngAt(seed, 'density'), 4, 26, 70);
  function density(u, v) {
    return 0.5 + 0.5 * sampleWaves(densityWaves, u, v);
  }

  // How much of the world exists at a point. Zero inside the entrance clearing,
  // one outside the fade, so the start reads as a space someone cleared.
  function openness(x, z) {
    const d = Math.hypot(x, z);
    if (d <= START_CLEAR) return 0;
    if (d >= START_CLEAR + START_FADE) return 1;
    const t = (d - START_CLEAR) / START_FADE;
    return t * t * (3 - 2 * t);
  }

  return {
    seed,
    frame,
    uPathAt,
    vPathAt,
    uPathsNear,
    vPathsNear,
    pathSlope,
    nearestPath,
    crossing,
    density,
    openness,
    PATH_SWING,
  };
}

// --- boxes ------------------------------------------------------------------

export const chunkBox = (cx, cz) => ({
  minX: cx * CHUNK, maxX: cx * CHUNK + CHUNK,
  minZ: cz * CHUNK, maxZ: cz * CHUNK + CHUNK,
});

export const chunkOf = (x, z) => ({ cx: Math.floor(x / CHUNK), cz: Math.floor(z / CHUNK) });

// The grid-space bounding box of a world-space box. The two frames are 45
// degrees apart, so a square in one is a diamond in the other and its bounding
// box is sqrt(2) larger. Four corners is exact and it is the only conversion
// anything in this package needs.
export function gridBoxOf(frame, box) {
  const corners = [
    frame.toGrid(box.minX, box.minZ), frame.toGrid(box.maxX, box.minZ),
    frame.toGrid(box.minX, box.maxZ), frame.toGrid(box.maxX, box.maxZ),
  ];
  return {
    minU: Math.min(...corners.map((c) => c.u)), maxU: Math.max(...corners.map((c) => c.u)),
    minV: Math.min(...corners.map((c) => c.v)), maxV: Math.max(...corners.map((c) => c.v)),
  };
}

export function worldBoxOf(frame, gbox) {
  const corners = [
    frame.toWorld(gbox.minU, gbox.minV), frame.toWorld(gbox.maxU, gbox.minV),
    frame.toWorld(gbox.minU, gbox.maxV), frame.toWorld(gbox.maxU, gbox.maxV),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)),
    minZ: Math.min(...corners.map((c) => c.z)), maxZ: Math.max(...corners.map((c) => c.z)),
  };
}

export const boxesOverlap = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;

export const padBox = (box, pad) => ({
  minX: box.minX - pad, maxX: box.maxX + pad, minZ: box.minZ - pad, maxZ: box.maxZ + pad,
});

export default createField;
