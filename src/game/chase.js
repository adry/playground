// The skeletons.
//
// Pac-Man's ghosts are four state machines that all run the same three lines of
// code and differ only in the point on the board they are steering at. That is
// the whole trick, and copying the trick rather than the behaviour is what
// makes a chase read as intelligent instead of as four things doing pathfinding
// at you. So:
//
//   1. A skeleton is always on an EDGE of the corridor graph, never off it.
//   2. It only ever decides at a NODE, and the decision is: of the edges that
//      are not the one I came in by, take the one whose far end is nearest my
//      target, straight line, ignoring walls.
//   3. Ties break in a fixed order, up then left then down then right, so two
//      skeletons in the same place with the same target trace the same route
//      and the player can learn them.
//   4. It may not reverse, except when the mode changes, when every skeleton
//      reverses at once. That single exception is most of what makes a mode
//      change legible without a HUD.
//
// Everything else is the target function, and the target function is the
// personality. All four of Pac-Man's are here, in grid units, with the tile
// counts converted at 2.0 units to the tile:
//
//   chaser    the ghost's own position. Relentless, readable, and the one that
//             punishes standing still. Pac-Man's Blinky, including his Cruise
//             Elroy speed-up as the fireflies run out, which is the mechanism
//             that stops a nearly-cleared level dragging.
//   ambusher  8.0 units ahead of the ghost along the way it is actually
//             travelling. Cuts you off rather than following you, so the two of
//             them together pincer, which neither does alone. Pac-Man's Pinky.
//   flanker   take the point 4.0 ahead of the ghost, then double the vector
//             from the CHASER to that point. Its target depends on another
//             skeleton, so its route swings wildly for reasons that are on
//             screen but not obvious, and it is the one nobody can read.
//             Pac-Man's Inky, and the erratic one of the set.
//   loner     the ghost while further away than 16.0, its own corner once
//             closer. It breaks off exactly when it becomes dangerous, so it
//             spends the level loitering in a quarter of the map and then
//             ruins one escape route. Pac-Man's Clyde.
//
// Scatter sends each of them at a corner OUTSIDE the level, which is why
// scatter looks like a patrol: no node is ever reached, so each one circles its
// own corner block until the mode flips.

import { DIRS, TILE } from './nav.js';

export const EMERGE_TIME = 3.4;   // what perform.js's climb actually takes

export const PERSONALITIES = ['chaser', 'ambusher', 'flanker', 'loner'];

// Pac-Man's own corner assignment: Blinky top right, Pinky top left, Inky
// bottom right, Clyde bottom left.
const CORNER = {
  chaser: [1, 1], ambusher: [-1, 1], flanker: [1, -1], loner: [-1, -1],
};

export const DEFAULT_SPEEDS = {
  // See rules.js for how these three were chosen. They are here so the soak can
  // sweep them without touching the rules.
  walk: 2.05,
  fright: 1.15,
  eaten: 5.20,
  // Cruise Elroy: the chaser speeds up when the level is nearly clear.
  elroy: [{ left: 0.25, mul: 1.10 }, { left: 0.10, mul: 1.22 }],
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createHerd({ nav, graves, count, seed = 1, speeds = DEFAULT_SPEEDS }) {
  const rng = mulberry32(seed * 2654435761);
  const b = nav.bounds;
  const corners = {};
  for (const p of PERSONALITIES) {
    const [su, sv] = CORNER[p];
    corners[p] = { u: su > 0 ? b.maxU + 3 : b.minU - 3, v: sv > 0 ? b.maxV + 3 : b.minV - 3 };
  }

  const list = [];
  for (let i = 0; i < count; i++) {
    // With three graves and four personalities the fourth shares the first
    // one's hole. Nothing in the engine minds: MAX_GROUND_HOLES caps the number
    // of cuts in the floor at once, not the number of things that ever climb
    // out of one, and the exit stagger below keeps the two of them from doing
    // it at the same moment.
    const grave = graves[i % graves.length];
    list.push({
      id: i,
      name: PERSONALITIES[i % PERSONALITIES.length],
      grave,
      home: nav.nodeNear(grave.u, grave.v),
      state: 'buried',
      timer: 0,
      u: grave.u, v: grave.v,
      from: -1, to: -1, t: 0,
      speed: 0,
      dirIndex: 0,
      wantReverse: false,
      // Where a straight-line leg is heading, for 'leaving' and 'sinking'.
      legU: 0, legV: 0,
    });
  }

  // How long after a reset each one starts its climb. The climb itself takes
  // 3.4 s, so a 1.2 s stagger over four skeletons means the two sharing a grave
  // (0 and 3, at 0.0 s and 3.6 s) never occupy it together, and the player gets
  // them one at a time rather than as a wall.
  const EXIT_STAGGER = 1.2;

  function reset() {
    for (const s of list) {
      s.state = 'buried';
      s.timer = s.id * EXIT_STAGGER;
      s.u = s.grave.u;
      s.v = s.grave.v;
      s.from = -1;
      s.to = -1;
      s.t = 0;
      s.speed = 0;
      s.wantReverse = false;
    }
  }
  reset();

  function targetOf(s, ctx) {
    if (ctx.mode === 'scatter' && s.state !== 'frightened') return corners[s.name];
    const g = ctx.ghost;
    switch (s.name) {
      case 'chaser':
        return g;
      case 'ambusher':
        return { u: g.u + ctx.heading.du * 8.0, v: g.v + ctx.heading.dv * 8.0 };
      case 'flanker': {
        const pu = g.u + ctx.heading.du * 4.0;
        const pv = g.v + ctx.heading.dv * 4.0;
        const c = ctx.chaser || g;
        return { u: 2 * pu - c.u, v: 2 * pv - c.v };
      }
      case 'loner':
      default:
        return Math.hypot(s.u - g.u, s.v - g.v) > 16.0 ? g : corners.loner;
    }
  }

  // The one decision. `prev` is the node it came from, and excluding it is what
  // makes a skeleton commit to a corridor rather than jittering on the spot.
  function choose(nodeId, prev, target, flee) {
    const n = nav.nodes[nodeId];
    let opts = n.edges;
    let dirs = n.dirOf;
    if (n.edges.length > 1 && prev !== -1) {
      const keep = [];
      const keepDirs = [];
      for (let i = 0; i < n.edges.length; i++) {
        if (n.edges[i] === prev) continue;
        keep.push(n.edges[i]);
        keepDirs.push(n.dirOf[i]);
      }
      if (keep.length) { opts = keep; dirs = keepDirs; }
    }
    if (opts.length === 1) return opts[0];

    if (flee && rng() < 0.25) return opts[(rng() * opts.length) | 0];

    let best = opts[0];
    let bestScore = Infinity;
    let bestDir = 9;
    for (let i = 0; i < opts.length; i++) {
      const m = nav.nodes[opts[i]];
      const d = (m.u - target.u) ** 2 + (m.v - target.v) ** 2;
      // Fleeing is the same decision with the sign of the distance flipped,
      // which keeps one code path and makes the flight read as a deliberate
      // retreat rather than as a random walk.
      const score = flee ? -d : d;
      const dir = dirs[i];
      if (score < bestScore - 1e-9 || (score < bestScore + 1e-9 && dir < bestDir)) {
        bestScore = score;
        bestDir = dir;
        best = opts[i];
      }
    }
    return best;
  }

  function enterGraph(s, nodeId, target, flee) {
    s.from = nodeId;
    s.to = choose(nodeId, -1, target, flee);
    s.t = 0;
    const n = nav.nodes[nodeId];
    const m = nav.nodes[s.to];
    s.dirIndex = DIRS.findIndex((d) => d.du === Math.sign(m.a - n.a) && d.dv === Math.sign(m.b - n.b));
  }

  function speedOf(s, ctx) {
    if (s.state === 'eaten') return speeds.eaten;
    if (s.state === 'frightened') return speeds.fright;
    let v = speeds.walk;
    if (s.name === 'chaser') {
      for (const step of speeds.elroy) if (ctx.left <= step.left) v = speeds.walk * step.mul;
    }
    return v;
  }

  // A straight-line leg, used to walk out of a grave onto the nearest node and
  // back into it again after being eaten. Pac-Man's pen door is the same idea:
  // the pen is not on the graph, so getting in and out of it is not a graph
  // move. It is the only time a skeleton is off the corridor and the soak
  // knows it.
  function stepLeg(s, dist, done) {
    const du = s.legU - s.u;
    const dv = s.legV - s.v;
    const d = Math.hypot(du, dv);
    if (d <= dist || d < 1e-6) { s.u = s.legU; s.v = s.legV; done(); return; }
    s.u += (du / d) * dist;
    s.v += (dv / d) * dist;
  }

  function stepOne(s, dt, ctx) {
    s.speed = speedOf(s, ctx);
    switch (s.state) {
      case 'buried':
        s.timer -= dt;
        if (s.timer <= 0) { s.state = 'emerging'; s.timer = EMERGE_TIME; }
        return;
      case 'emerging':
        s.timer -= dt;
        if (s.timer <= 0) {
          s.state = 'leaving';
          const home = nav.nodes[s.home];
          s.legU = home.u;
          s.legV = home.v;
        }
        return;
      case 'leaving':
        stepLeg(s, s.speed * dt, () => {
          s.state = ctx.power ? 'frightened' : 'hunting';
          enterGraph(s, s.home, targetOf(s, ctx), s.state === 'frightened');
        });
        return;
      case 'sinking':
        stepLeg(s, speeds.eaten * dt, () => {
          s.state = 'buried';
          s.timer = 0.25;
        });
        return;
      default:
        break;
    }

    // On the graph. A mode flip turns every skeleton round where it stands,
    // mid-edge, which is Pac-Man's reversal and the loudest thing in the game
    // that is not a sound.
    if (s.wantReverse) {
      s.wantReverse = false;
      const a = s.from;
      s.from = s.to;
      s.to = a;
      s.t = 1 - s.t;
    }

    const flee = s.state === 'frightened';
    const target = s.state === 'eaten' ? nav.nodes[s.home] : targetOf(s, ctx);
    let travel = s.speed * dt;
    let guard = 0;
    while (travel > 0 && guard++ < 512) {
      const left = (1 - s.t) * TILE;
      if (travel < left) { s.t += travel / TILE; break; }
      travel -= left;
      s.t = 0;
      const arrived = s.to;
      if (s.state === 'eaten' && arrived === s.home) {
        s.state = 'sinking';
        s.u = nav.nodes[s.home].u;
        s.v = nav.nodes[s.home].v;
        s.legU = s.grave.u;
        s.legV = s.grave.v;
        return;
      }
      const next = choose(arrived, s.from, target, flee);
      s.from = arrived;
      s.to = next;
      const n = nav.nodes[arrived];
      const m = nav.nodes[next];
      s.dirIndex = DIRS.findIndex((d) => d.du === Math.sign(m.a - n.a) && d.dv === Math.sign(m.b - n.b));
    }
    const a = nav.nodes[s.from];
    const bb = nav.nodes[s.to];
    s.u = a.u + (bb.u - a.u) * s.t;
    s.v = a.v + (bb.v - a.v) * s.t;
  }

  return {
    list,
    reset,
    step(dt, ctx) { for (const s of list) stepOne(s, dt, ctx); },
    // Every skeleton that is out of the ground turns round. Called on a mode
    // flip and on the moment a power pellet is eaten.
    reverseAll() {
      for (const s of list) if (s.state === 'hunting' || s.state === 'frightened') s.wantReverse = true;
    },
    frighten() {
      for (const s of list) {
        if (s.state === 'hunting') { s.state = 'frightened'; s.wantReverse = true; }
        else if (s.state === 'leaving') s.state = 'leaving';
      }
    },
    unfrighten() {
      for (const s of list) if (s.state === 'frightened') s.state = 'hunting';
    },
    eat(s) {
      s.state = 'eaten';
    },
    // Alive above ground and able to touch the player.
    isSolid: (s) => s.state === 'hunting' || s.state === 'frightened' || s.state === 'leaving',
    corners,
  };
}

export default createHerd;
