// The skeletons.
//
// Pac-Man's ghosts are four state machines that all run the same three lines of
// code and differ only in the point on the board they are steering at. That is
// the whole trick, and copying the trick rather than the behaviour is what
// makes a chase read as intelligent instead of as four things doing pathfinding
// at you.
//
// ---------------------------------------------------------------------------
// WHAT THE JUNCTION BECAME
// ---------------------------------------------------------------------------
//
// The old version of this file could copy the trick literally: the skeletons
// ran on a graph of corridor centrelines and decided at nodes. In open ground
// there are no nodes, and the thing that has to be recovered is not the graph,
// it is the PROPERTY the graph gave: a skeleton's course is fixed between
// decisions, decisions are rare, and they happen at places the player can see
// and predict. Take that away and you get a homing missile, which is both less
// interesting and less fair, because a course that is recomputed every frame
// can never be juked.
//
// Two mechanisms recover it, and it takes both.
//
//   1. THE PASSAGE IS THE JUNCTION. A passage is a gate, or the free end of a
//      fence run. When a fence stands between a skeleton and its target the
//      skeleton must choose which way past, and that choice is Pac-Man's
//      junction exactly: of the ways available, take the one whose far side is
//      nearest my target, straight line, ignoring everything else. It is a
//      GREEDY LOCAL choice and not a path search, on purpose. A* would route
//      better and read worse: its mistakes would be invisible and its successes
//      would look like omniscience, where a greedy choice at a gate makes the
//      readable mistake of committing to the near gate when the far one was
//      better, which is exactly the mistake the player learns to bait.
//
//   2. THE LEG IS THE TILE. Between passages a skeleton walks a straight LEG
//      and does not re-steer at all. A leg ends when it is walked out, when its
//      aim point is reached, or when a fence turns up across it. LEG_MAX 4.0
//      units is 1.86 s at the walk of 2.15, so a skeleton's course in open
//      ground is fixed for almost two seconds at a time and there is a juke in
//      it. This is the number that replaces "a junction every two or three
//      tiles", it is the one most likely to want moving, and soak.mjs sweeps
//      it. At 0 it is a homing missile; the sweep shows what that costs.
//
// The no-reversal rule survives intact and is doing the same job: a new leg may
// not turn more than MAX_TURN off the current heading, except on a mode flip,
// when every skeleton turns round at once. That single exception is still most
// of what makes a mode change legible without a HUD.
//
// ---------------------------------------------------------------------------
// WHAT IS UNCHANGED
// ---------------------------------------------------------------------------
//
// All four personalities and their target functions, in world units now rather
// than grid ones, with the same distances:
//
//   chaser    the ghost's own position. Pac-Man's Blinky, including the Cruise
//             Elroy speed-up, which is retriggered below because "the level is
//             nearly clear" is not a thing that happens any more.
//   ambusher  8.0 units ahead of the ghost along the way it is travelling.
//   flanker   the point 4.0 ahead of the ghost, doubled out from the CHASER.
//   loner     the ghost while further away than 16.0, its own quarter once
//             closer.
//
// Scatter, the mode schedule, the frightened flee, the eaten-and-return loop
// and the speeds are all unchanged. Two of them had to be re-anchored for an
// endless world and the re-anchoring is described where it happens: SCATTER
// (there are no corners in an infinite plane) and THE PEN (the graves have to
// follow the player or the chase runs off the end of the world).

export const EMERGE_TIME = 3.4;   // what perform.js's climb actually takes

export const PERSONALITIES = ['chaser', 'ambusher', 'flanker', 'loner'];

// The skeleton's body, for leg clearance. props/skeleton/metrics.js has it at
// 0.95 across the shoulders.
export const SKEL_RADIUS = 0.475;
const LEG_CLEAR = SKEL_RADIUS + 0.08;

// Pac-Man's own corner assignment, as compass directions rather than corners:
// Blinky top right, Pinky top left, Inky bottom right, Clyde bottom left.
const QUARTER = {
  chaser: [1, 1], ambusher: [-1, 1], flanker: [1, -1], loner: [-1, -1],
};

export const DEFAULT_SPEEDS = {
  // See rules.js for how these were chosen. Unchanged by the redirection: the
  // ratio was measured against cornering and the jump does not touch it.
  walk: 2.15,
  fright: 1.20,
  eaten: 5.20,
  // Cruise Elroy, RETRIGGERED. It used to key off the fireflies remaining,
  // which in an endless world is a number that never falls. The mechanism it
  // exists for is "stop a stale chase dragging", and the endless equivalent of
  // a nearly-swept level is a long life: the chaser winds up the longer you
  // have gone without dying. Same multipliers, and it now also gives a long
  // run a shape, which an endless game needs more than a level did.
  elroy: [{ after: 60, mul: 1.08 }, { after: 120, mul: 1.16 }],
};

export const DEFAULT_CHASE = {
  // The two numbers that make the skeletons read as deciding rather than
  // homing. See the essay above; soak.mjs sweeps both.
  legMax: 4.0,
  maxTurn: 100 * Math.PI / 180,
  arrive: 0.30,
  // How far out a skeleton looks for a way past a fence. Far enough to see the
  // gate at the other end of a pen wall, near enough that it does not consider
  // a gate it will never reach, and small enough that scatterOut + this stays
  // inside nav's window. nav.js's WINDOW is derived from these two.
  passageRange: 24,
  // Scatter, re-anchored. There is no corner in an infinite plane, so a
  // skeleton scatters to a point this far from where the ghost was AT THE
  // MOMENT THE MODE FLIPPED, in its own fixed quarter. The point does not
  // follow the ghost, so scatter is a genuine departure; it is 12 s of walking
  // away, longer than any scatter phase, so no skeleton ever arrives and
  // scatter still reads as a patrol rather than as a queue.
  scatterOut: 26,
  // The pen follows the player. A skeleton going back underground re-homes to
  // a grave in this band around the ghost, which is the endless-world version
  // of Pac-Man's pen being in the middle of a small board. 10 is far enough
  // that nothing climbs out on top of the player; 20 is near enough that being
  // eaten costs the skeleton a return trip and not the rest of the run.
  penMin: 10,
  penMax: 20,
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

// Pac-Man breaks a tie between equally good exits in a fixed order, up then
// left then down then right, and that one rule is why its ghosts trace
// repeatable routes rather than dithering. The open-world version is the same
// order applied to the QUADRANT the option lies in, so two skeletons in the
// same place with the same target still pick the same way past a fence.
function dirRank(dx, dz) {
  const a = Math.atan2(dx, dz);           // 0 is +z, which is up the screen
  const q = Math.round((a * 2) / Math.PI) & 3;
  return [0, 3, 2, 1][q];                 // up, right, down, left -> 0, 3, 2, 1
}

export function createHerd({ nav, count, seed = 1, speeds = DEFAULT_SPEEDS, chase = {} } = {}) {
  const C = { ...DEFAULT_CHASE, ...chase };
  const rng = mulberry32(seed * 2654435761);
  const passBuf = [];

  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      id: i,
      name: PERSONALITIES[i % PERSONALITIES.length],
      state: 'buried',
      timer: 0,
      x: 0, z: 0,
      // The grave this one is currently attached to, re-chosen every time it
      // goes underground.
      grave: { x: 0, z: 0 },
      hx: 0, hz: -1,             // heading, unit
      aimX: 0, aimZ: 0,          // the end of the current leg
      legLeft: 0,                // units of leg not yet walked
      committed: null,           // the passage id it is aiming at, or null
      speed: 0,
      wantReverse: false,
      scatterX: 0, scatterZ: 0,
    });
  }

  // --- graves ---------------------------------------------------------------
  //
  // The pen, and the only thing in here that TELEPORTS. A skeleton is moved
  // between graves only while it is buried, which is under the ground and
  // behind a closed hole: nothing is on screen to teleport. Pac-Man does the
  // same thing and calls it reappearing in the pen.
  function pickGrave(ghost, avoid) {
    const graves = nav.near(ghost.x, ghost.z, C.penMax + 8, 'graves');
    let best = null;
    let bestScore = Infinity;
    for (const g of graves) {
      const d = Math.hypot(g.x - ghost.x, g.z - ghost.z);
      // In the band is best; outside it, prefer the nearest that is far enough.
      let score;
      if (d >= C.penMin && d <= C.penMax) score = Math.abs(d - (C.penMin + C.penMax) / 2);
      else if (d > C.penMax) score = 100 + (d - C.penMax);
      else score = 200 + (C.penMin - d);
      // Two skeletons should not surface in the same hole at the same moment.
      if (avoid && avoid.some((a) => Math.hypot(a.x - g.x, a.z - g.z) < 1.5)) score += 400;
      if (score < bestScore) { bestScore = score; best = g; }
    }
    // The world guarantees a grave per 32x32 box, so `best` is only ever null
    // in a test harness. Fall back to a point in the band rather than throwing.
    if (!best) {
      const a = rng() * Math.PI * 2;
      const d = (C.penMin + C.penMax) / 2;
      return { x: ghost.x + Math.cos(a) * d, z: ghost.z + Math.sin(a) * d };
    }
    return { x: best.x, z: best.z };
  }

  function nearestGrave(x, z) {
    const graves = nav.near(x, z, 40, 'graves');
    let best = null;
    let bd = Infinity;
    for (const g of graves) {
      const d = (g.x - x) ** 2 + (g.z - z) ** 2;
      if (d < bd) { bd = d; best = g; }
    }
    return best ? { x: best.x, z: best.z } : { x, z };
  }

  function reset(ghost) {
    const taken = [];
    for (const s of list) {
      s.state = 'buried';
      s.timer = s.id * EXIT_STAGGER;
      s.grave = pickGrave(ghost, taken);
      taken.push(s.grave);
      s.x = s.grave.x;
      s.z = s.grave.z;
      s.hx = 0; s.hz = -1;
      s.legLeft = 0;
      s.committed = null;
      s.speed = 0;
      s.wantReverse = false;
    }
  }

  // How long after a reset each one starts its climb. The climb takes 3.4 s, so
  // a 1.2 s stagger means the player gets them one at a time rather than as a
  // wall, which is the same reason it existed before.
  const EXIT_STAGGER = 1.2;

  // --- the target functions, unchanged ---------------------------------------
  function targetOf(s, ctx) {
    if (ctx.mode === 'scatter' && s.state !== 'frightened') return { x: s.scatterX, z: s.scatterZ };
    const g = ctx.ghost;
    switch (s.name) {
      case 'chaser':
        return g;
      case 'ambusher':
        return { x: g.x + ctx.heading.x * 8.0, z: g.z + ctx.heading.z * 8.0 };
      case 'flanker': {
        const px = g.x + ctx.heading.x * 4.0;
        const pz = g.z + ctx.heading.z * 4.0;
        const c = ctx.chaser || g;
        return { x: 2 * px - c.x, z: 2 * pz - c.z };
      }
      case 'loner':
      default:
        return Math.hypot(s.x - g.x, s.z - g.z) > 16.0
          ? g : { x: s.scatterX, z: s.scatterZ };
    }
  }

  function setScatter(s, ghost) {
    const [qx, qz] = QUARTER[s.name];
    const il = 1 / Math.SQRT2;
    s.scatterX = ghost.x + qx * il * C.scatterOut;
    s.scatterZ = ghost.z + qz * il * C.scatterOut;
  }

  // --- THE ONE DECISION ------------------------------------------------------
  //
  // Called only at the end of a leg. Everything else in this file is
  // bookkeeping around this function.
  function decide(s, ctx) {
    const t = targetOf(s, ctx);
    const flee = s.state === 'frightened';
    // A reversal is granted once, by the mode flip, and it is the only time a
    // skeleton may turn further than MAX_TURN.
    let free = false;
    if (s.wantReverse) {
      s.wantReverse = false;
      s.hx = -s.hx; s.hz = -s.hz;
      free = true;
    }
    s.committed = null;

    // 1. Can I see the target? Then there is nothing to decide and I walk at it.
    //    This is the open-ground case and it is most frames.
    if (nav.visible(s.x, s.z, t.x, t.z, LEG_CLEAR)) {
      const dx = t.x - s.x;
      const dz = t.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6 && (free || turnOk(s, dx / d, dz / d))) {
        return setLeg(s, dx / d, dz / d, Math.min(C.legMax, d));
      }
    }

    // 2. A fence is in the way, or the target is behind me. Choose a passage:
    //    of the ways past that I can actually see and can turn towards, the one
    //    whose far side is nearest the target. Greedy, local, and Pac-Man's own
    //    rule with "edge out of this node" replaced by "way past this fence".
    nav.passagesNear(s.x, s.z, C.passageRange, passBuf);
    let best = null;
    let bestScore = Infinity;
    let bestRank = 9;
    for (const p of passBuf) {
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) continue;
      const ux = dx / d;
      const uz = dz / d;
      if (!free && !turnOk(s, ux, uz)) continue;
      if (!nav.visible(s.x, s.z, p.x, p.z, LEG_CLEAR)) continue;
      const rest = Math.hypot(t.x - p.x, t.z - p.z);
      // Fleeing is the same decision with the sign flipped, which keeps one
      // code path and makes the flight read as a deliberate retreat rather than
      // a random walk. The 0.25 dither is Pac-Man's own frightened wobble.
      let score = flee ? -(d + rest) : d + rest;
      if (flee && rng() < 0.25) score += (rng() - 0.5) * 40;
      const rank = dirRank(ux, uz);
      if (score < bestScore - 1e-9 || (score < bestScore + 1e-9 && rank < bestRank)) {
        bestScore = score;
        bestRank = rank;
        best = p;
      }
    }
    if (best) {
      const dx = best.x - s.x;
      const dz = best.z - s.z;
      const d = Math.hypot(dx, dz) || 1;
      s.committed = best.id;
      // COMMITMENT. The leg runs all the way to the passage rather than
      // stopping at LEG_MAX, so a skeleton that has decided to go round a fence
      // goes round it instead of changing its mind halfway and pacing. This is
      // where most of the "purposeful" reading comes from.
      return setLeg(s, dx / d, dz / d, d);
    }

    // 3. Nothing visible to aim at: I am up against a fence with no way past in
    //    sight. Follow it. Projecting the target direction onto the fence's own
    //    tangent is a wall-follow that costs no state and reads exactly right,
    //    a skeleton walking the length of a fence looking for the gate.
    const slide = slideDir(s, t);
    if (slide) return setLeg(s, slide.x, slide.z, C.legMax);
    // 4. Truly nothing. Keep going the way I was, and try again next leg.
    return setLeg(s, s.hx, s.hz, C.legMax);
  }

  function turnOk(s, ux, uz) {
    return ux * s.hx + uz * s.hz >= Math.cos(C.maxTurn);
  }

  function setLeg(s, ux, uz, len) {
    s.hx = ux;
    s.hz = uz;
    s.aimX = s.x + ux * len;
    s.aimZ = s.z + uz * len;
    s.legLeft = len;
    return s;
  }

  function slideDir(s, t) {
    let bestB = null;
    let bd = Infinity;
    for (const b of nav.barriers) {
      const d = nav.pointSegD2(s.x, s.z, b.x0, b.z0, b.x1, b.z1);
      if (d < bd) { bd = d; bestB = b; }
    }
    if (!bestB || bd > 64) return null;
    let tx = bestB.x1 - bestB.x0;
    let tz = bestB.z1 - bestB.z0;
    const il = 1 / Math.max(1e-9, Math.hypot(tx, tz));
    tx *= il; tz *= il;
    const wantX = t.x - s.x;
    const wantZ = t.z - s.z;
    if (tx * wantX + tz * wantZ < 0) { tx = -tx; tz = -tz; }
    if (!nav.visible(s.x, s.z, s.x + tx * 2, s.z + tz * 2, LEG_CLEAR)) { tx = -tx; tz = -tz; }
    return { x: tx, z: tz };
  }

  function speedOf(s, ctx) {
    if (s.state === 'eaten') return speeds.eaten;
    if (s.state === 'frightened') return speeds.fright;
    let v = speeds.walk;
    if (s.name === 'chaser') {
      for (const step of speeds.elroy) if (ctx.lifeTime >= step.after) v = speeds.walk * step.mul;
    }
    return v;
  }

  function stepOne(s, dt, ctx) {
    s.speed = speedOf(s, ctx);
    switch (s.state) {
      case 'buried':
        s.timer -= dt;
        if (s.timer <= 0) {
          // Re-home NOW, at the last possible moment, so the hole opens where
          // the player is rather than where they were when it closed.
          s.grave = pickGrave(ctx.ghost, list.filter((o) => o !== s && o.state === 'emerging').map((o) => o.grave));
          s.x = s.grave.x;
          s.z = s.grave.z;
          s.state = 'emerging';
          s.timer = EMERGE_TIME;
        }
        return;
      case 'emerging':
        s.timer -= dt;
        if (s.timer <= 0) {
          s.state = ctx.power ? 'frightened' : 'hunting';
          // Out of the ground facing the player, which is the shot the scene
          // wants and also stops the turn limit from trapping a fresh skeleton
          // facing a fence.
          const dx = ctx.ghost.x - s.x;
          const dz = ctx.ghost.z - s.z;
          const d = Math.hypot(dx, dz) || 1;
          s.hx = dx / d; s.hz = dz / d;
          s.legLeft = 0;
          decide(s, ctx);
        }
        return;
      case 'sinking':
        // The straight drop back into the hole, the only time a skeleton is
        // somewhere the chase rules do not apply.
        s.timer -= dt;
        if (s.timer <= 0) { s.state = 'buried'; s.timer = 0.25; }
        return;
      default:
        break;
    }

    // On the ground and moving.
    let travel = s.speed * dt;
    let guard = 0;
    while (travel > 1e-9 && guard++ < 64) {
      if (s.state === 'eaten') {
        // Home is the nearest grave to where it died: a short trip back under,
        // and the re-home to a grave near the player happens while buried.
        const g = s.homeGrave || (s.homeGrave = nearestGrave(s.x, s.z));
        const dx = g.x - s.x;
        const dz = g.z - s.z;
        const d = Math.hypot(dx, dz);
        if (d <= travel || d < 1e-6) {
          s.x = g.x; s.z = g.z;
          s.homeGrave = null;
          s.state = 'sinking';
          s.timer = 0.45;
          return;
        }
        // Bones go home over the fences, because a heap of bones is not walking
        // and because a return trip that has to find gates takes long enough to
        // remove the skeleton for the rest of the run.
        s.x += (dx / d) * travel;
        s.z += (dz / d) * travel;
        s.hx = dx / d; s.hz = dz / d;
        return;
      }
      if (s.legLeft <= 1e-9) { decide(s, ctx); if (s.legLeft <= 1e-9) return; }
      const stepLen = Math.min(travel, s.legLeft);
      const nx = s.x + s.hx * stepLen;
      const nz = s.z + s.hz * stepLen;
      // The leg was chosen clear, but the window can be rebuilt underneath it
      // and a grave can sit close to a fence. Re-decide rather than walk into
      // anything.
      if (nav.crossesBarrier(s.x, s.z, nx, nz, LEG_CLEAR) || nav.crossesProp(s.x, s.z, nx, nz, LEG_CLEAR)) {
        s.legLeft = 0;
        decide(s, ctx);
        if (s.legLeft <= 1e-9) return;
        continue;
      }
      s.x = nx;
      s.z = nz;
      s.legLeft -= stepLen;
      travel -= stepLen;
      if (s.legLeft <= C.arrive * 0.1) s.legLeft = 0;
    }
  }

  return {
    list,
    reset,
    setScatter,
    step(dt, ctx) { for (const s of list) stepOne(s, dt, ctx); },
    // Every skeleton above ground turns round. Called on a mode flip and on the
    // moment a lantern is lit. The reversal is spent at the next decision, and
    // the leg is cut short so that is immediately.
    reverseAll() {
      for (const s of list) {
        if (s.state !== 'hunting' && s.state !== 'frightened') continue;
        s.wantReverse = true;
        s.legLeft = 0;
      }
    },
    // A skeleton still climbing out is not made vulnerable by a lantern lit
    // while it is underground, which is Pac-Man's rule for a ghost in the pen
    // and is the only thing stopping a player from camping the graves.
    frighten() {
      for (const s of list) if (s.state === 'hunting') { s.state = 'frightened'; s.wantReverse = true; s.legLeft = 0; }
    },
    unfrighten() {
      for (const s of list) if (s.state === 'frightened') { s.state = 'hunting'; s.legLeft = 0; }
    },
    eat(s) { s.state = 'eaten'; s.homeGrave = null; },
    isSolid: (s) => s.state === 'hunting' || s.state === 'frightened',
    C,
  };
}

export default createHerd;
