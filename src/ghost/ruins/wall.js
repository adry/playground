import { block } from './kit.js';

// Ruined curtain-wall segments.
//
// The thing that sells "real masonry" over "stack of boxes" is the coursing
// logic, not any single stone: rows of individual blocks with mortar gaps,
// laid in a running bond (each row starts half a block short of the last so
// vertical joints never line up two rows running), broken down along their
// length by a wandering height limit instead of a flat cut, with stones
// missing here and there and a bit of debris at the foot. Everything below
// is in service of that, applied along one or two straight runs per piece.

const MAX_PRIMS = 70;
const MAX_COLLIDERS = 5;

// A run's silhouette: how many courses survive at a given distance along it.
// Built from a handful of control points instead of a straight ramp, so the
// top edge wanders -- drops, occasionally recovers a course, drops again --
// which is what an actually-collapsed wall looks like as opposed to a wall
// that was designed to slope.
function makeFalloff(rand, length, coursesMax, coursesMin) {
  const N = 5;
  const xs = [];
  const vs = [];
  let v = coursesMax;
  for (let k = 0; k < N; k++) {
    xs.push((k / (N - 1)) * length);
    vs.push(v);
    const drop = rand() * 1.6 + (k === 0 ? 0.15 : 0.25);
    const recover = rand() < 0.25 ? rand() * 0.9 : 0; // an occasional taller stub mid-run
    v = Math.max(coursesMin, Math.min(coursesMax, v - drop + recover));
  }
  return (x) => {
    const cx = Math.max(0, Math.min(length, x));
    for (let k = 0; k < N - 1; k++) {
      if (cx <= xs[k + 1] || k === N - 2) {
        const span = xs[k + 1] - xs[k] || 1;
        const t = (cx - xs[k]) / span;
        return Math.round(vs[k] + (vs[k + 1] - vs[k]) * t);
      }
    }
    return Math.round(vs[N - 1]);
  };
}

// Lays one straight coursed run of length `length`, thickness `thickness`,
// starting at local origin and extending along +x (axis 'x') or +z ('z').
// `falloff(dist)` caps how many courses stand at a point along the run, and
// `opening` (optional) carves a rectangular hole out of the coursing so a
// lintel can bridge it afterward.
function buildRun(prims, rand, { axis, length, thickness, courseH, coursesMax, falloff, missingBase = 0.05, opening = null }) {
  for (let row = 0; row < coursesMax; row++) {
    if (prims.length >= MAX_PRIMS) return;
    const y = row * courseH + courseH / 2;
    // Running bond: odd rows start a half-block short, so no seam runs
    // straight up through two consecutive courses.
    let cursor = row % 2 === 1 ? -0.28 : 0;
    while (cursor < length) {
      const w = 0.46 + rand() * 0.3;
      const xa = Math.max(0, cursor);
      const xb = Math.min(length, cursor + w);
      cursor += w + 0.03 + rand() * 0.02; // mortar-joint gap
      if (xb - xa < 0.1) continue;

      const mid = (xa + xb) / 2;
      if (row >= Math.round(falloff(mid))) continue; // above the standing height here
      if (opening && mid > opening.x0 && mid < opening.x1 && row >= opening.row0 && row < opening.row1) continue;
      if (rand() < missingBase + row * 0.018) continue; // a stone lost to time

      const bw = Math.max(0.14, xb - xa - 0.03);
      const bd = thickness * (0.92 + rand() * 0.14);
      const bh = courseH * (0.88 + rand() * 0.16);
      // A hair of face jitter keeps hand-laid stone from reading as an
      // extruded slab -- the coursing stays crisp, the face doesn't.
      const jitter = (rand() - 0.5) * 0.02;
      const yaw = (rand() - 0.5) * 0.035;

      const pos = axis === 'x' ? [mid, y, jitter] : [jitter, y, mid];
      const size = axis === 'x' ? [bw, bh, bd] : [bd, bh, bw];
      prims.push(block({ pos, size, rot: [0, yaw, 0], chip: 0.018 }));
      if (prims.length >= MAX_PRIMS) return;
    }
  }
}

// Highest surviving course near a stretch of the run, sampled rather than
// tracked live, so a collider box can be sized after the fact without
// threading state back out of buildRun.
function runTop(falloff, x0, x1, courseH) {
  let m = 0;
  for (let s = 0; s <= 6; s++) {
    m = Math.max(m, falloff(x0 + (x1 - x0) * (s / 6)));
  }
  return m * courseH;
}

// A thin capping course, laid loose on top of what's left standing. It
// oversails the wall face a little -- that projection, plus being a fraction
// of a course tall, is what reads as "coping" instead of "one more block".
function addCoping(prims, rand, { axis, x0, x1, z, y, thickness }) {
  const copingH = 0.1 + rand() * 0.04;
  const overhang = 0.04 + rand() * 0.02;
  let cursor = x0;
  while (cursor < x1 && prims.length < MAX_PRIMS) {
    const w = 0.5 + rand() * 0.35;
    const xa = cursor;
    const xb = Math.min(x1, cursor + w);
    cursor = xb + 0.02 + rand() * 0.02;
    if (xb - xa < 0.16) continue;
    const mid = (xa + xb) / 2;
    const span = xb - xa - 0.02;
    const size = axis === 'x' ? [span, copingH, thickness + overhang * 2] : [thickness + overhang * 2, copingH, span];
    const pos = axis === 'x' ? [mid, y + copingH / 2, z] : [z, y + copingH / 2, mid];
    prims.push(block({ pos, size, rot: [0, (rand() - 0.5) * 0.05, 0], chip: 0.014 }));
  }
}

// A block that came off the wall and is now lying at an angle at its foot.
// The rest height is solved for directly (half-extents projected through the
// tilt) so the tilted box always sits flush on y = 0 instead of floating or
// clipping into the ground.
function addFallen(prims, rand, x, z) {
  if (prims.length >= MAX_PRIMS) return;
  const w = 0.42 + rand() * 0.34;
  const h = 0.24 + rand() * 0.18;
  const d = 0.3 + rand() * 0.22;
  const angle = 0.45 + rand() * 1.0;
  const yaw = rand() * Math.PI * 2;
  // Rotation is about local x only (rot = [angle, yaw, 0]); the yaw term is
  // a pure y-axis spin applied after, so it never moves the resting height.
  const restY = (d / 2) * Math.abs(Math.sin(angle)) + (h / 2) * Math.abs(Math.cos(angle));
  prims.push(block({ pos: [x, restY + 0.02, z], size: [w, h, d], rot: [angle, yaw, 0], chip: 0.02 }));
}

// A thin spalled flake, flat on the ground -- the small debris that sells
// scale next to the fallen full blocks.
function addSpall(prims, rand, x, z) {
  if (prims.length >= MAX_PRIMS) return;
  const w = 0.22 + rand() * 0.26;
  const d = 0.18 + rand() * 0.2;
  const h = 0.035 + rand() * 0.03;
  prims.push(block({ pos: [x, h / 2 + 0.005, z], size: [w, h, d], rot: [0, rand() * Math.PI * 2, 0], chip: 0.01 }));
}

// Picks a course height in the 0.22-0.32 band that divides `height` into a
// whole number of courses, so "how tall" and "how many rows" agree exactly.
function courseCountFor(rand, height) {
  const target = 0.24 + rand() * 0.06;
  const n = Math.max(2, Math.round(height / target));
  return n;
}

export default function buildWall(rand) {
  const prims = [];
  const colliders = [];
  const thickness = 0.34 + rand() * 0.16;
  const variant = Math.floor(rand() * 4);

  if (variant === 0) {
    // Long and low: most of a curtain wall's length survives, but only to
    // waist height, tailing off to a couple of courses at the far end.
    const length = 3.4 + rand() * 1.6;
    const height = 0.95 + rand() * 0.45;
    const coursesMax = courseCountFor(rand, height);
    const courseH = height / coursesMax;
    const falloff = makeFalloff(rand, length, coursesMax, 2);

    buildRun(prims, rand, { axis: 'x', length, thickness, courseH, coursesMax, falloff, missingBase: 0.05 });

    const copingSpan = length * (0.3 + rand() * 0.2);
    addCoping(prims, rand, { axis: 'x', x0: 0, x1: copingSpan, z: 0, y: runTop(falloff, 0, copingSpan, courseH), thickness });

    const fallenCount = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < fallenCount; i++) {
      addFallen(prims, rand, rand() * length, thickness * (0.6 + rand() * 0.7) * (rand() < 0.5 ? 1 : -1));
    }
    addSpall(prims, rand, rand() * length, thickness * 0.7 * (rand() < 0.5 ? 1 : -1));

    colliders.push({ x: length * 0.25, z: 0, hx: length * 0.25, hz: thickness / 2, top: runTop(falloff, 0, length * 0.5, courseH) });
    colliders.push({ x: length * 0.75, z: 0, hx: length * 0.25, hz: thickness / 2, top: runTop(falloff, length * 0.5, length, courseH) });

    return { primitives: prims.slice(0, MAX_PRIMS), colliders: colliders.slice(0, MAX_COLLIDERS), radius: length / 2 + 0.5 };
  }

  if (variant === 1) {
    // A taller standing fragment, pierced by an arrow slit near its intact
    // end and tapering down toward the other.
    const length = 2.0 + rand() * 1.0;
    const height = Math.min(2.6, 1.75 + rand() * 0.75);
    const coursesMax = courseCountFor(rand, height);
    const courseH = height / coursesMax;
    const falloff = makeFalloff(rand, length, coursesMax, 3);

    const slitX = length * (0.28 + rand() * 0.14);
    const slitHalfW = 0.06 + rand() * 0.03;
    const slitRow0 = 1;
    const slitRow1 = Math.min(coursesMax - 1, slitRow0 + 3 + Math.floor(rand() * 2));
    const opening = { x0: slitX - slitHalfW, x1: slitX + slitHalfW, row0: slitRow0, row1: slitRow1 };

    buildRun(prims, rand, { axis: 'x', length, thickness, courseH, coursesMax, falloff, missingBase: 0.045, opening });

    // Lintel: a single block bridging the slit, guaranteed present since an
    // opening with nothing spanning it would just read as a missing stone.
    if (prims.length < MAX_PRIMS) {
      const lintelY = slitRow1 * courseH + courseH / 2;
      prims.push(block({
        pos: [slitX, lintelY, 0],
        size: [opening.x1 - opening.x0 + 0.14, courseH * 0.92, thickness * 0.96],
        rot: [0, 0, 0],
        chip: 0.016,
      }));
    }

    const copingSpan = length * (0.35 + rand() * 0.2);
    addCoping(prims, rand, { axis: 'x', x0: 0, x1: copingSpan, z: 0, y: runTop(falloff, 0, copingSpan, courseH), thickness });

    addFallen(prims, rand, rand() * length, thickness * 0.75 * (rand() < 0.5 ? 1 : -1));
    addSpall(prims, rand, rand() * length, thickness * 0.6 * (rand() < 0.5 ? 1 : -1));

    colliders.push({ x: length * 0.3, z: 0, hx: length * 0.3, hz: thickness / 2, top: runTop(falloff, 0, length * 0.6, courseH) });
    colliders.push({ x: length * 0.75, z: 0, hx: length * 0.25, hz: thickness / 2, top: runTop(falloff, length * 0.6, length, courseH) });

    return { primitives: prims.slice(0, MAX_PRIMS), colliders: colliders.slice(0, MAX_COLLIDERS), radius: length / 2 + 0.5 };
  }

  if (variant === 2) {
    // A corner: two runs sharing an origin at right angles, each tallest at
    // the corner and falling off toward its own free end -- as if this were
    // the one bit of the enclosure sturdy enough to still stand two walls.
    const len1 = 1.6 + rand() * 0.8;
    const len2 = 1.6 + rand() * 0.8;
    const height = 1.1 + rand() * 0.7;
    const coursesMax = courseCountFor(rand, height);
    const courseH = height / coursesMax;
    const falloff1 = makeFalloff(rand, len1, coursesMax, 2);
    const falloff2 = makeFalloff(rand, len2, coursesMax, 2);

    buildRun(prims, rand, { axis: 'x', length: len1, thickness, courseH, coursesMax, falloff: falloff1, missingBase: 0.05 });
    buildRun(prims, rand, { axis: 'z', length: len2, thickness, courseH, coursesMax, falloff: falloff2, missingBase: 0.05 });

    const capSpan = Math.min(len1, len2) * 0.55;
    addCoping(prims, rand, { axis: 'x', x0: 0, x1: capSpan, z: 0, y: Math.min(runTop(falloff1, 0, capSpan, courseH), runTop(falloff2, 0, capSpan, courseH)), thickness });

    addFallen(prims, rand, len1 * (0.4 + rand() * 0.4), -thickness * (0.8 + rand() * 0.6));
    addSpall(prims, rand, -thickness * 0.6, len2 * (0.4 + rand() * 0.4));

    colliders.push({ x: len1 / 2, z: 0, hx: len1 / 2, hz: thickness / 2, top: runTop(falloff1, 0, len1, courseH) });
    colliders.push({ x: 0, z: len2 / 2, hx: thickness / 2, hz: len2 / 2, top: runTop(falloff2, 0, len2, courseH) });

    return { primitives: prims.slice(0, MAX_PRIMS), colliders: colliders.slice(0, MAX_COLLIDERS), radius: Math.hypot(len1, len2) / 2 + 0.5 };
  }

  // variant 3: a mostly-collapsed stub -- a couple of courses still upright,
  // most of the stone now rubble at the foot.
  const length = 2.0 + rand() * 1.0;
  const coursesMax = 2 + Math.floor(rand() * 2);
  const courseH = 0.24 + rand() * 0.06;
  const falloff = makeFalloff(rand, length, coursesMax, 1);

  buildRun(prims, rand, { axis: 'x', length, thickness, courseH, coursesMax, falloff, missingBase: 0.1 });

  const fallenCount = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < fallenCount; i++) {
    addFallen(prims, rand, rand() * length, (rand() - 0.5) * (thickness * 2.2 + 0.6));
  }
  const spallCount = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < spallCount; i++) {
    addSpall(prims, rand, rand() * length, (rand() - 0.5) * (thickness * 2 + 0.5));
  }

  colliders.push({ x: length / 2, z: 0, hx: length / 2, hz: thickness / 2, top: runTop(falloff, 0, length, courseH) });

  return { primitives: prims.slice(0, MAX_PRIMS), colliders: colliders.slice(0, MAX_COLLIDERS), radius: length / 2 + 0.6 };
}
