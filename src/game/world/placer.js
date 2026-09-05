// The placer, again, for a world with no lattice in it.
//
// layout/place.js already solved the placement rules properly and this file
// keeps its answers: the same margins, the same footprints, the same
// separating-axis test, the same arithmetic for rule 5, and the same protocol
// where a composition asks "can this go here" and gets a yes or a no rather
// than a nudge. What it cannot keep is the lattice: there are no corridor
// tiles to test against, no level bounds to be inside, and no single pass over
// a finite level, so three things are new.
//
// 1. THE PATH TEST REPLACES THE CORRIDOR TEST. A path is a wandering curve
//    rather than a union of squares, so a corridor tile against a footprint
//    becomes a curve against a footprint: the bounding circle for a fast
//    accept, and the curve sampled at 0.12 against the oriented box when the
//    circle is not decisive. The sampled minimum always OVERSTATES the
//    distance, so a step of it is given back, which leaves the generator
//    strictly harder to satisfy than the checker.
//
// 2. A CHUNK RESOLVES AGAINST ITS NEIGHBOURS, NOT AGAINST THE WORLD. Building a
//    chunk is allowed to look at the eight around it and nothing else. Within
//    the chunk, candidates are accepted in generation order, which is what
//    keeps a row looking like a row. Across a seam the order would depend on
//    which chunk the player walked into first, so it is replaced by a fixed
//    total order on chunks: a candidate yields to any RAW candidate of a
//    higher priority neighbour, whether or not that neighbour ends up keeping
//    it. Both sides of a seam compute the same answer from the same two raw
//    lists, so the world is the same however it is walked. The cost is a few
//    props lost to neighbours that then dropped them, which world-check.mjs
//    counts as `seam`.
//
// 3. HEIGHT IS CHOSEN, NOT ROLLED. This is the interesting one, and it is the
//    answer to the tension in the brief: organic placement that hides half the
//    props behind the other half is worse than a grid. Rule 5 says a prop may
//    only stand in front of a shorter one by the allowance the camera gives,
//    0.39 of a unit of screen depth. Rather than roll a variant and throw it
//    away when it breaks the rule, heightWindow() asks the neighbourhood what
//    heights are LEGAL at this point and the composition picks a variant inside
//    that window. The result is short stones at the front and tall ones behind
//    with no row, no lattice and no shared facing, which is exactly the
//    composition the camera wants out of positions the camera had no say in.

import { gap } from '../layout/geom.js';
import { boundingRadius } from '../layout/footprints.js';
import { OCCLUSION, K } from '../layout/frame.js';
import { PROP_MARGIN, CORRIDOR_MARGIN, OCCLUSION_MARGIN, halfAcross } from '../layout/place.js';
import { PATH_HALF } from './field.js';
import { FENCE_MARGIN } from './fence.js';

// The tallest thing the world places is the obelisk at 1.85, so nothing can
// argue with anything more than this far away in screen depth.
export const OCCLUSION_REACH = 1.9 / OCCLUSION;
// And nothing can overlap anything more than this far away in the plane.
export const OVERLAP_REACH = 4.2;

// Kinds that stop a body. A hole is a hole and a spoil heap is a mound you walk
// over; everything else in the world is something you go round.
const SOFT_KINDS = new Set(['hole', 'dirt']);

const BUCKET = 4;

export function createPlacer({ field, chunk, hard = [], blockers = [], barriers = [], gates = [] }) {
  const frame = field.frame;
  const props = [];
  const rejects = { path: 0, fence: 0, gate: 0, overlap: 0, occlusion: 0, seam: 0, height: 0, placed: 0 };

  // Everything that can argue with a candidate, in one bucket grid over grid
  // coordinates. `weight` says which arguments it wins: hard content is fences,
  // gates and graves, which nothing may push aside.
  const buckets = new Map();
  const key = (a, b) => a + ':' + b;
  const put = (item) => {
    const a = Math.floor(item.u / BUCKET);
    const b = Math.floor(item.v / BUCKET);
    const k = key(a, b);
    const list = buckets.get(k);
    if (list) list.push(item); else buckets.set(k, [item]);
  };
  const near = (u, v, reach) => {
    const out = [];
    const a0 = Math.floor((u - reach) / BUCKET);
    const a1 = Math.floor((u + reach) / BUCKET);
    const b0 = Math.floor((v - reach) / BUCKET);
    const b1 = Math.floor((v + reach) / BUCKET);
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        const list = buckets.get(key(a, b));
        if (list) for (const item of list) out.push(item);
      }
    }
    return out;
  };

  for (const p of hard) put({ ...p, hard: true });
  for (const p of blockers) put({ ...p, hard: false, seam: true });

  // Barriers and gate discs are not props and never occlude anything: a fence
  // is 0.86 of open pickets and layout.js never judged a wall against a stone
  // either. They are pure keep-outs.
  const fenceShapes = barriers.map((s) => s.grid.shape);
  const gateShapes = [];
  for (const g of gates) { gateShapes.push(g.grid.sweep); gateShapes.push(g.grid.clear); }

  function makeProp({ kind, variant = null, u, v, gridYaw = Math.PI, foot }) {
    const radius = boundingRadius(foot);
    const world = frame.toWorld(u, v);
    const yaw = frame.yawFor(Math.sin(gridYaw), Math.cos(gridYaw));
    return {
      kind, variant, u, v, gridYaw, foot,
      x: world.x, z: world.z, yaw,
      radius, height: foot.height,
      solid: !SOFT_KINDS.has(kind),
      depth: world.x + world.z,
      across: (world.x - world.z) * K,
      halfAcross: halfAcross(foot, yaw),
      shape: foot.shape === 'disc'
        ? { shape: 'disc', x: u, z: v, r: foot.r }
        : { shape: 'box', x: u, z: v, yaw: gridYaw, halfU: foot.halfU, halfV: foot.halfV },
    };
  }

  // Rule 5, both ways round, exactly as place.js states it. Screen depth is
  // x + z and bigger is nearer the camera.
  function hides(front, back) {
    if (back.height <= 0.05) return false;
    if (front.depth <= back.depth) return false;
    if (Math.abs(front.across - back.across) >= front.halfAcross + back.halfAcross) return false;
    return front.height >= back.height + (front.depth - back.depth) * OCCLUSION - OCCLUSION_MARGIN;
  }

  // Rule 2, against the real footprint.
  //
  // The first version of this tested the prop's BOUNDING CIRCLE against the
  // curve, which is conservative and therefore safe, and it cost the world one
  // grave in a hundred chunks: a grave hole is 2.0 by 0.9, its circle is 1.10,
  // and at a crossroads the difference between needing 2.45 of clearance and
  // needing 1.80 is the difference between a grave fitting in the quadrant and
  // not fitting anywhere. Since the density floor is a promise to the rules
  // half, the test is now the same exact one the checker does: the curve,
  // sampled finely, against the oriented box. The circle survives as the fast
  // accept, which is what it is good for.
  const PATH_NEED = PATH_HALF + CORRIDOR_MARGIN;
  const PATH_STEP = 0.12;
  // A sampled minimum can only ever OVERSTATE the distance, and overstating it
  // is the unsafe direction, so half a step of the curve is given back.
  const PATH_SLACK = PATH_STEP;
  const probe = { shape: 'disc', x: 0, z: 0, r: 0 };

  function pathGap(shape, u, v, reach) {
    let best = Infinity;
    const span = reach + 1.5;
    for (const k of field.uPathsNear(u, span)) {
      for (let t = v - span; t <= v + span; t += PATH_STEP) {
        probe.x = field.uPathAt(k, t);
        probe.z = t;
        if (Math.abs(probe.x - u) > span) continue;
        const g = gap(probe, shape);
        if (g < best) best = g;
      }
    }
    for (const m of field.vPathsNear(v, span)) {
      for (let t = u - span; t <= u + span; t += PATH_STEP) {
        probe.x = t;
        probe.z = field.vPathAt(m, t);
        if (Math.abs(probe.z - v) > span) continue;
        const g = gap(probe, shape);
        if (g < best) best = g;
      }
    }
    return best - PATH_SLACK;
  }

  function pathClear(prop) {
    const near = field.nearestPath(prop.u, prop.v, PATH_NEED + prop.radius + 1).dist;
    if (near >= PATH_NEED + prop.radius) return true;
    if (near < PATH_NEED) return false;
    if (prop.foot.shape === 'disc') return false;
    return pathGap(prop.shape, prop.u, prop.v, prop.radius) >= PATH_NEED;
  }

  function reject(prop, { asHard = false } = {}) {
    if (!pathClear(prop)) return 'path';
    for (const s of fenceShapes) {
      if (Math.hypot(prop.u - s.x, prop.v - s.z) > prop.radius + s.halfU + s.halfV + FENCE_MARGIN) continue;
      if (gap(prop.shape, s) < FENCE_MARGIN) return 'fence';
    }
    for (const s of gateShapes) {
      if (Math.hypot(prop.u - s.x, prop.v - s.z) > prop.radius + s.r) continue;
      if (gap(prop.shape, s) < 0) return 'gate';
    }
    const reach = Math.max(OVERLAP_REACH, OCCLUSION_REACH);
    for (const other of near(prop.u, prop.v, reach + prop.radius)) {
      if (asHard && !other.hard) continue;
      if (Math.hypot(prop.u - other.u, prop.v - other.v) <= prop.radius + other.radius + PROP_MARGIN) {
        if (gap(prop.shape, other.shape) < PROP_MARGIN) return other.seam ? 'seam' : 'overlap';
      }
      if (hides(prop, other) || hides(other, prop)) return other.seam ? 'seam' : 'occlusion';
    }
    return null;
  }

  // What heights are legal here. `lo` comes from whatever already stands in
  // FRONT of this point and would swallow anything shorter; `hi` from whatever
  // stands behind it and must not be swallowed. A composition that picks a
  // variant inside the window never has to be told no.
  function heightWindow(u, v, halfA = 0.95) {
    const world = frame.toWorld(u, v);
    const depth = world.x + world.z;
    const across = (world.x - world.z) * K;
    let lo = 0;
    let hi = Infinity;
    for (const other of near(u, v, OCCLUSION_REACH + 1.2)) {
      if (Math.abs(across - other.across) >= halfA + other.halfAcross) continue;
      const dd = depth - other.depth;
      if (dd > 0) {
        // I would be in front of it, so I must stay under its allowance.
        if (other.height > 0.05) hi = Math.min(hi, other.height + dd * OCCLUSION - OCCLUSION_MARGIN - 0.02);
      } else if (dd < 0) {
        // It is in front of me, so I have to be tall enough not to vanish.
        lo = Math.max(lo, other.height + dd * OCCLUSION + OCCLUSION_MARGIN + 0.02);
      }
    }
    return { lo, hi };
  }

  const api = {
    props,
    rejects,
    heightWindow,
    make: makeProp,

    // Add a prop that nothing may push aside: a fence, a grave, the things the
    // world guarantees a floor of. Still tested against the other hard things.
    tryHard(spec) {
      const prop = makeProp(spec);
      const why = reject(prop, { asHard: true });
      if (why) { rejects[why]++; return null; }
      prop.hard = true;
      props.push(prop);
      put(prop);
      rejects.placed++;
      return prop;
    },

    try(spec) {
      const prop = makeProp(spec);
      const why = reject(prop);
      if (why) { rejects[why]++; return null; }
      props.push(prop);
      put(prop);
      rejects.placed++;
      return prop;
    },

    // All or nothing, for a grave: a pit with no heap beside it reads as a
    // mistake rather than as a grave.
    tryGroup(specs, { asHard = false } = {}) {
      const made = [];
      for (const spec of specs) {
        const prop = makeProp(spec);
        const why = reject(prop, { asHard });
        if (why) {
          rejects[why]++;
          for (const p of made) {
            props.splice(props.indexOf(p), 1);
            const a = Math.floor(p.u / BUCKET);
            const b = Math.floor(p.v / BUCKET);
            const list = buckets.get(key(a, b));
            if (list) list.splice(list.indexOf(p), 1);
          }
          return null;
        }
        if (asHard) prop.hard = true;
        props.push(prop);
        put(prop);
        rejects.placed++;
        made.push(prop);
      }
      return made;
    },

    // Would this fit, without keeping it? The grave search asks this.
    wouldFit(spec, opts) {
      return reject(makeProp(spec), opts) === null;
    },
  };

  void chunk;
  return api;
}

export default createPlacer;
