// The placer, again, for an arena with no lattice in it.
//
// layout/place.js already solved the placement rules properly and this file
// keeps its answers: the same margins, the same footprints, the same
// separating-axis test, the same arithmetic for rule 5, and the same protocol
// where a composition asks "can this go here" and gets a yes or a no rather
// than a nudge. What it cannot keep is the lattice: there are no corridor
// tiles to test against and no cells to put props in, so three things differ.
//
// 1. THE PATH TEST REPLACES THE CORRIDOR TEST. A path is a wandering curve
//    rather than a union of squares, so a corridor tile against a footprint
//    becomes a curve against a footprint: the bounding circle for a fast
//    accept, and the curve sampled finely against the oriented box when the
//    circle is not decisive. A sampled minimum always OVERSTATES the distance,
//    which is the unsafe direction, so a step of it is given back and the
//    generator ends up strictly harder to satisfy than the checker.
//
// 2. THE KEEP-OUT AT A GATE IS A CAPSULE. The rules half found a prop a
//    thousandth outside a disc keep-out that still plugged the mouth of a gate
//    and cost three percent of their worlds their fairness, because the
//    question is not whether a body FITS through an opening but whether it can
//    REACH it. So the shape that has to stay clear is the approach corridor
//    through the gate, and it is tested here as a long thin box.
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
import { PATH_HALF, WALL_HALF } from './field.js';
import { FENCE_MARGIN, GATE_CLEAR_R, WALL_GAP, gridYawAlong } from './fence.js';

// The tallest thing the arena places is the obelisk at 1.85, so nothing can
// argue with anything more than this far away in screen depth.
export const OCCLUSION_REACH = 1.9 / OCCLUSION;
export const OVERLAP_REACH = 4.2;
// Nothing stands in the perimeter lane. See fence.js: three units of clear
// ground all the way round the arena, so the corner the rules half measured a
// sevenfold risk in always has a way out of it.
export const WALL_MARGIN = WALL_GAP - WALL_HALF;

// Kinds that stop a body. A hole is a hole and a spoil heap is a mound you walk
// over; everything else in the arena is something you go round.
const SOFT_KINDS = new Set(['hole', 'dirt']);

// THE FORBIDDEN BAND, and this is a navigation number rather than a
// look-and-feel one.
//
// Rule 1's 0.15 is about whether two things touch, and it says nothing about
// the CHANNEL they leave between them. Navigation treats a solid prop as a
// circle of its bounding radius and needs 0.555 of clearance, and a flood fill
// only sees a channel once it is about a cell wider than that. So a channel
// between 1.11 and 1.61 wide is one a body can squeeze into and that half the
// rasters measuring the level cannot see it get out of: a headstone standing
// two units off a pen's rail makes exactly one, the ghost vaults in, and
// whether a skeleton can follow becomes a question about the measuring
// instrument. That was the last of the fairness failures.
//
// The fix is not to push props AWAY from fences, which was tried and cost a
// third of the graveyard. It is to forbid the BAND: a prop may stand right
// against a fence, where the channel is too narrow for anything to get into and
// no wedge exists, or well clear of it, where the channel is a corridor. It may
// not stand at the one distance that makes a trap. The same band applies
// between two solid props for the same reason.
export const BAND_LO = 1.11;
export const BAND_HI = 1.66;

const BUCKET = 4;

export function createPlacer({ field, box, barriers = [], gates = [] }) {
  const frame = field.frame;
  const props = [];
  const rejects = { bounds: 0, path: 0, fence: 0, gate: 0, overlap: 0, band: 0, occlusion: 0, placed: 0 };

  const buckets = new Map();
  const key = (a, b) => a + ':' + b;
  const put = (item) => {
    const k = key(Math.floor(item.u / BUCKET), Math.floor(item.v / BUCKET));
    const list = buckets.get(k);
    if (list) list.push(item); else buckets.set(k, [item]);
  };
  const take = (item) => {
    const list = buckets.get(key(Math.floor(item.u / BUCKET), Math.floor(item.v / BUCKET)));
    if (!list) return;
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  };
  const near = (u, v, reach) => {
    const out = [];
    for (let b = Math.floor((v - reach) / BUCKET); b <= Math.floor((v + reach) / BUCKET); b++) {
      for (let a = Math.floor((u - reach) / BUCKET); a <= Math.floor((u + reach) / BUCKET); a++) {
        const list = buckets.get(key(a, b));
        if (list) for (const item of list) out.push(item);
      }
    }
    return out;
  };

  // Barriers and gate keep-outs are not props and never occlude anything: a
  // fence is 0.86 of open pickets and layout.js never judged a wall against a
  // stone either. They are pure keep-outs, each with the margin it wants.
  const keepOuts = [];
  for (const s of barriers) {
    if (s.grid) keepOuts.push({ shape: s.grid.shape, margin: FENCE_MARGIN, why: 'fence', standoff: true });
  }
  for (const g of gates) {
    keepOuts.push({ shape: g.grid.sweep, margin: 0, why: 'gate' });
    const c = g.grid.clear;
    const du = c.bu - c.au;
    const dv = c.bv - c.av;
    const len = Math.hypot(du, dv);
    keepOuts.push({
      // The approach capsule, as a long thin box. The separating axis test
      // understates the gap for a corner meeting, which is the direction that
      // keeps things out rather than the one that lets them in.
      shape: {
        shape: 'box', x: (c.au + c.bu) / 2, z: (c.av + c.bv) / 2,
        yaw: gridYawAlong(du / len, dv / len), halfU: len / 2, halfV: 0.001,
      },
      margin: GATE_CLEAR_R, why: 'gate',
    });
  }

  // Inside the wall. The wall itself is a barrier the props keep off, but the
  // cheap test is the arena box, done in world because that is where the arena
  // is square.
  const wallBox = {
    minX: box.minX + WALL_HALF + WALL_MARGIN, maxX: box.maxX - WALL_HALF - WALL_MARGIN,
    minZ: box.minZ + WALL_HALF + WALL_MARGIN, maxZ: box.maxZ - WALL_HALF - WALL_MARGIN,
  };

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

  const PATH_NEED = PATH_HALF + CORRIDOR_MARGIN;
  const PATH_STEP = 0.12;
  const PATH_SLACK = PATH_STEP;
  const NEAR_SLACK = 0.05;
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
    const d = field.nearestPath(prop.u, prop.v, PATH_NEED + prop.radius + 1).dist - NEAR_SLACK;
    if (d >= PATH_NEED + prop.radius) return true;
    if (d < PATH_NEED) return false;
    if (prop.foot.shape === 'disc') return false;
    return pathGap(prop.shape, prop.u, prop.v, prop.radius) >= PATH_NEED;
  }

  // The channel between a prop's own circle and a barrier's, which is what
  // navigation sees, measured centre to centreline.
  function barrierChannel(prop, seg) {
    const ex = seg.x1 - seg.x0;
    const ez = seg.z1 - seg.z0;
    const l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((prop.x - seg.x0) * ex + (prop.z - seg.z0) * ez) / l2));
    return Math.hypot(prop.x - (seg.x0 + ex * t), prop.z - (seg.z0 + ez * t)) - prop.radius - seg.half;
  }

  function reject(prop) {
    if (prop.x - prop.radius < wallBox.minX || prop.x + prop.radius > wallBox.maxX
      || prop.z - prop.radius < wallBox.minZ || prop.z + prop.radius > wallBox.maxZ) return 'bounds';
    if (!pathClear(prop)) return 'path';
    for (const k of keepOuts) {
      const s = k.shape;
      const reach = prop.radius + (s.shape === 'disc' ? s.r : s.halfU + s.halfV) + k.margin;
      if (Math.hypot(prop.u - s.x, prop.v - s.z) > reach) continue;
      if (gap(prop.shape, s) < k.margin) return k.why;
    }
    // The forbidden band, against every fence and every solid neighbour.
    if (prop.solid) {
      for (const seg of barriers) {
        const c = barrierChannel(prop, seg);
        if (c > BAND_LO && c < BAND_HI) return 'band';
      }
    }
    const reach = Math.max(OVERLAP_REACH, OCCLUSION_REACH);
    for (const other of near(prop.u, prop.v, reach + prop.radius)) {
      if (Math.hypot(prop.u - other.u, prop.v - other.v) <= prop.radius + other.radius + PROP_MARGIN
        && gap(prop.shape, other.shape) < PROP_MARGIN) return 'overlap';
      if (prop.solid && other.solid) {
        const c = Math.hypot(prop.x - other.x, prop.z - other.z) - prop.radius - other.radius;
        if (c > BAND_LO && c < BAND_HI) return 'band';
      }
      if (hides(prop, other) || hides(other, prop)) return 'occlusion';
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
        if (other.height > 0.05) hi = Math.min(hi, other.height + dd * OCCLUSION - OCCLUSION_MARGIN - 0.02);
      } else if (dd < 0) {
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

    try(spec) {
      const prop = makeProp(spec);
      const why = reject(prop);
      if (why) { rejects[why]++; return null; }
      rejects.placed++;
      props.push(prop);
      put(prop);
      return prop;
    },

    // All or nothing, for a grave: a pit with no heap beside it reads as a
    // mistake rather than as a grave.
    tryGroup(specs) {
      const made = [];
      for (const spec of specs) {
        const prop = makeProp(spec);
        const why = reject(prop);
        if (why) {
          rejects[why]++;
          api.drop(made);
          return null;
        }
        rejects.placed++;
        props.push(prop);
        put(prop);
        made.push(prop);
      }
      return made;
    },

    // Would this fit, without keeping it? The grave search asks this of the
    // mouth of a hole before it asks for the whole grave.
    wouldFit(spec) {
      return reject(makeProp(spec)) === null;
    },

    // Take props back out. The grave uses it when a group placed legally still
    // turns out to be somewhere a body could not stand, and the pen uses it
    // when its furniture has cut the interior in two.
    drop(list) {
      for (const p of list) {
        const i = props.indexOf(p);
        if (i >= 0) props.splice(i, 1);
        take(p);
      }
    },
  };

  return api;
}

export default createPlacer;
