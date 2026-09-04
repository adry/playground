// The placer: the one thing in the package allowed to add a prop, and the only
// thing that knows the placement rules.
//
// A motif asks "can this stone go here", the placer says yes and keeps it or
// says no and the motif carries on without it. That is the whole protocol, and
// it is what keeps the rules in one file instead of six. Every rule in
// DESIGN.md's placement section is tested here, on the prop's real footprint:
// the ground rules in grid coordinates, where the corridors are axis aligned,
// and rule 5 in the camera's, because that is where "in front of" means
// anything:
//
//   1  nothing overlaps            gap to every other prop >= 0.15
//   2  nothing enters a corridor   gap to every path tile >= 0.05
//   3  nothing enters the gate     gap to the gate's keep-out disc >= 0
//   5  no tall thing in front of a short one, by the camera's own arithmetic
//   6  is the motif's business, not the placer's: a cell holds one big thing or
//      three small ones because the motifs only ever ask for that.
//
// Rule 4, the hole and its spoil heap and its headstone, is also a motif's
// business, since it is about what to place rather than where it may go.
//
// The placer refuses rather than adjusts. A prop pushed clear of an obstacle is
// a prop that has left the row it was in, and a row with one stone shoved out
// of line looks worse than a row with one stone missing.

import { gap, gapToSquare } from './geom.js';
import { boundingRadius } from './footprints.js';
import { OCCLUSION, K } from './frame.js';

// How much clear ground a prop wants on each side. The 0.15 is rule 1's own
// number; the corridor margin is smaller because a corridor edge is a fence
// line rather than another object, and the shed at 1.93 in a 4.0 cell only has
// 0.07 to give.
export const PROP_MARGIN = 0.15;
export const CORRIDOR_MARGIN = 0.05;
// Slack over rule 5, so a level that passes here passes the checker too.
export const OCCLUSION_MARGIN = 0.12;

// The footprint's extent along the screen's horizontal, which is
// (x - z) / sqrt(2) in world whatever frame the level was laid out in. Two
// props can only hide each other if these overlap.
//
// This used to be computed in grid coordinates, where the screen's horizontal
// is u and the sum is a line of trigonometry shorter. That is true of the
// screen frame and false of the axis one, and the axis frame duly came out with
// rule 5 broken in 83% of levels while the generator believed it was enforcing
// it: rows laid along world x run diagonally across the screen there, so the
// stone beside you is also the stone in front of you. Occlusion is a fact about
// the camera, so it is measured in the camera's own axes and nowhere else.
export function halfAcross(foot, yaw) {
  if (foot.shape === 'disc') return foot.r;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return Math.abs(foot.halfU * (c + s) * K) + Math.abs(foot.halfV * (s - c) * K);
}

// How far apart in screen depth two props can be and still hide each other: the
// tallest prop in the set is 3.3 and loses 0.39 of apparent height per unit of
// x + z, so nothing reaches past this.
const OCCLUSION_REACH = 3.4 / OCCLUSION;

export function createPlacer({ tiles, gate = null, frame, margin = PROP_MARGIN }) {
  const props = [];
  // Why pieces were refused, which is the only way to tell a motif that is
  // laying out a row of five from one that is asking for a row of five and
  // getting three.
  const rejects = { bounds: 0, corridor: 0, gate: 0, overlap: 0, occlusion: 0, placed: 0 };
  // Props bucketed by tile, so a level with two hundred of them does not cost
  // twenty thousand shape tests to build.
  const buckets = new Map();
  const bucketKey = (a, b) => b * (tiles.tw + 4) + a;
  const nearby = (u, v, ru, rv) => {
    const out = [];
    const a0 = tiles.A(u - ru); const a1 = tiles.A(u + ru);
    const b0 = tiles.B(v - rv); const b1 = tiles.B(v + rv);
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        const list = buckets.get(bucketKey(a, b));
        if (list) out.push(...list);
      }
    }
    return out;
  };

  function corridorClear(shape, reach) {
    const a0 = tiles.A(shape.x - reach - 1);
    const a1 = tiles.A(shape.x + reach + 1);
    const b0 = tiles.B(shape.z - reach - 1);
    const b1 = tiles.B(shape.z + reach + 1);
    for (let b = b0; b <= b1; b++) {
      for (let a = a0; a <= a1; a++) {
        if (!tiles.isPath(a, b)) continue;
        if (gapToSquare(shape, tiles.U(a), tiles.V(b), 1.0) < CORRIDOR_MARGIN) return false;
      }
    }
    return true;
  }

  // Rule 5, both ways round: does either of these two swallow the other?
  // Screen depth is x + z, bigger is nearer the camera, and a prop loses 0.39
  // of apparent height per unit of it.
  function hides(front, back) {
    // A grave hole is a hole: it has no silhouette, so nothing can stand in
    // front of it in the sense rule 5 means. Without this the headstone at the
    // head of a grave counts as hiding the grave it belongs to, which cost the
    // pen its graves entirely in the axis frame.
    if (back.height <= 0.05) return false;
    if (front.depth <= back.depth) return false;
    if (Math.abs(front.across - back.across) >= front.halfAcross + back.halfAcross) return false;
    const allowance = (front.depth - back.depth) * OCCLUSION;
    return front.height >= back.height + allowance - OCCLUSION_MARGIN;
  }

  const api = {
    props,
    rejects,

    // A prop record, complete but not yet placed.
    make({ kind, variant = null, u, v, gridYaw = Math.PI, foot }) {
      const radius = boundingRadius(foot);
      const world = frame.toWorld(u, v);
      const yaw = frame.yawFor(Math.sin(gridYaw), Math.cos(gridYaw));
      return {
        kind, variant, u, v, gridYaw, foot,
        x: world.x, z: world.z,
        yaw,
        radius,
        height: foot.height,
        // Where it sits on the screen, which is what rule 5 is about.
        depth: world.x + world.z,
        across: (world.x - world.z) * K,
        halfAcross: halfAcross(foot, yaw),
        // The footprint in grid coordinates, which is what every test uses.
        shape: foot.shape === 'disc'
          ? { shape: 'disc', x: u, z: v, r: foot.r }
          : { shape: 'box', x: u, z: v, yaw: gridYaw, halfU: foot.halfU, halfV: foot.halfV },
      };
    },

    // Would this prop be legal? Returns the reason it is not, or null.
    reject(prop) {
      const b = tiles.bounds;
      if (prop.u - prop.radius < b.minU || prop.u + prop.radius > b.maxU) return 'bounds';
      if (prop.v - prop.radius < b.minV || prop.v + prop.radius > b.maxV) return 'bounds';
      if (!corridorClear(prop.shape, prop.radius)) return 'corridor';
      if (gate && gap(prop.shape, gate.keepOutShape) < 0) return 'gate';
      for (const other of nearby(prop.u, prop.v, prop.radius + 2.1, prop.radius + 2.1)) {
        if (gap(prop.shape, other.shape) < margin) return 'overlap';
      }
      // The neighbourhood is a square in grid units rather than a slab, because
      // the screen's axes need not line up with the grid's: in the axis frame
      // the prop hiding this one can be straight along u.
      for (const other of nearby(prop.u, prop.v, OCCLUSION_REACH, OCCLUSION_REACH)) {
        if (hides(prop, other) || hides(other, prop)) return 'occlusion';
      }
      return null;
    },

    add(prop) {
      props.push(prop);
      const k = bucketKey(tiles.A(prop.u), tiles.B(prop.v));
      const list = buckets.get(k);
      if (list) list.push(prop); else buckets.set(k, [prop]);
      return prop;
    },

    // The call every motif makes. Returns the prop, or null if it would break a
    // rule, and adds nothing in that case.
    try(spec) {
      const prop = api.make(spec);
      const why = api.reject(prop);
      if (why) { rejects[why]++; return null; }
      rejects.placed++;
      return api.add(prop);
    },

    // All or nothing: a grave with no room for its spoil heap is not a grave,
    // so the whole group goes back if any part of it is refused.
    tryGroup(specs) {
      const made = [];
      for (const spec of specs) {
        const prop = api.make(spec);
        const why = api.reject(prop);
        if (why) {
          rejects[why]++;
          for (const p of made) {
            props.splice(props.indexOf(p), 1);
            const list = buckets.get(bucketKey(tiles.A(p.u), tiles.B(p.v)));
            if (list) list.splice(list.indexOf(p), 1);
          }
          return null;
        }
        made.push(api.add(prop));
        rejects.placed++;
      }
      return made;
    },
  };

  return api;
}

export default createPlacer;
