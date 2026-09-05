// A player, so the world can be played a thousand times without anybody
// playing it.
//
// ---------------------------------------------------------------------------
// WHY IT HAD TO BE REWRITTEN, AND IT IS THE SAME LESSON TWICE
// ---------------------------------------------------------------------------
//
// The first bot in this project steered from graph node to graph node, which is
// exactly what a skeleton does, so it threw away the ghost's cornering
// advantage and then reported the game as too hard. It put the difficulty cliff
// a ratio and a half below where it really is and nearly cost the ghost another
// 0.18 of top speed for nothing. The fix was a pure-pursuit follower that cuts
// the inside of a turn.
//
// The same mistake is available twice over in the new design, and both versions
// of it would misreport the game rather than make the bot look bad:
//
//   1. A bot that always walks to the NEAREST firefly. That was a reasonable
//      player when there were 345 of them a unit apart and the choice did not
//      exist. At one per screen the choice is the game: one is close and on the
//      chaser's side of the map, one is forty units away with nothing near it,
//      and a bot that takes the near one every time makes the world look far
//      more lethal than it is.
//
//   2. A bot that never jumps, or one that always jumps. On every journey there
//      is now a question, take the direct line over the fence or the safe line
//      round to the gate, and a bot with a habit rather than a reason answers it
//      the same way every time and measures nothing.
//
// Both are solved by the same move: the bot plans over a GRID with cost, risk
// is paid ALONG the route rather than checked at the destination, and a fence
// crossing is an EDGE WITH A PRICE rather than a wall or a freeway. Then
// "nearest" already means "cheapest including how dangerous the journey is",
// the near-and-dangerous firefly loses to the far-and-safe one on its own, and
// the vault-or-gate question is answered per journey by the same arithmetic
// that answers everything else. `jumpCost` is the one dial, and sweeping it is
// how soak.mjs answers whether the asymmetry produces play or a habit.
//
// It steers with the same stick a human has, plus the same one-frame jump edge,
// so it is subject to the same acceleration, the same sliding, the same
// cornering and the same refusal to jump without a run-up. It never teleports.

const SKILLS = {
  // --- risk ------------------------------------------------------------------
  // A cell this near a hunting skeleton, in WORLD UNITS, costs extra to cross,
  // and the surcharge grows as the square of how close it is. 14 units is about
  // six and a half seconds of skeleton, which was 7 hops on the old lattice.
  scare: 14,
  // Multiplier on the surcharge at point blank. The square law spends almost
  // all of it inside 5 units and almost none at 12.
  caution: 6.0,
  // Inside this, never, at any price.
  wallAt: 1.8,
  wall: 400,

  // --- the jump ---------------------------------------------------------------
  // What crossing a fence costs, as a multiple of the cell it saves. 1.0 would
  // make a vault exactly as cheap as walking the same distance on open ground,
  // which is what it physically is; anything above 1.0 prices the commitment.
  // See the sweep in soak.mjs: this is the number the whole asymmetry turns on.
  jumpCost: 3.0,
  // How close the fence has to be before the stick presses jump.
  jumpTrigger: 2.2,

  // --- planning ---------------------------------------------------------------
  think: 0.10,
  half: 30,            // planning window half width, world units
  cell: 1.25,
  // Rebuild the occupancy raster only after the ghost has moved this far. The
  // raster is the expensive part; the Dijkstra over it is not.
  regrid: 8,
  // Pure-pursuit lookahead, the corner cut, unchanged in value and in reason.
  cut: 1.8,
  // Do not abandon the firefly you are already going to unless the new one is
  // this much better. With one pickup per screen, dithering between two of them
  // is the single most expensive thing a player can do.
  switchMargin: 0.75,
  huntRange: 30,
  panicPower: 26,
};

function makeHeap(n) {
  const node = new Int32Array(n + 1);
  const cost = new Float64Array(n + 1);
  let size = 0;
  return {
    clear() { size = 0; },
    get size() { return size; },
    push(v, c) {
      let i = ++size;
      node[i] = v; cost[i] = c;
      while (i > 1 && cost[i >> 1] > cost[i]) {
        const tn = node[i >> 1]; const tc = cost[i >> 1];
        node[i >> 1] = node[i]; cost[i >> 1] = cost[i];
        node[i] = tn; cost[i] = tc;
        i >>= 1;
      }
    },
    pop() {
      const top = node[1];
      node[1] = node[size]; cost[1] = cost[size]; size--;
      let i = 1;
      for (;;) {
        const l = i << 1;
        const r = l + 1;
        let m = i;
        if (l <= size && cost[l] < cost[m]) m = l;
        if (r <= size && cost[r] < cost[m]) m = r;
        if (m === i) break;
        const tn = node[m]; const tc = cost[m];
        node[m] = node[i]; cost[m] = cost[i];
        node[i] = tn; cost[i] = tc;
        i = m;
      }
      return top;
    },
  };
}

export function createBot(game, opts = {}) {
  const S = { ...SKILLS, ...opts };
  const nav = game.nav;

  let grid = null;
  let gridX = NaN;
  let gridZ = NaN;
  let N = 0;
  let dist = null;
  let prev = null;
  let prevJump = null;
  let skelD = null;
  let heap = null;
  let queue = null;

  let cool = 0;
  let route = [];          // cell indices, ghost first
  let routeJump = [];      // routeJump[k] is true if the step INTO route[k] is a vault
  let goalKey = null;
  let goalCost = Infinity;
  let goalPt = null;
  const stats = {
    threatTime: 0, panicTime: 0, plans: 0, stuck: 0,
    jumps: 0, vaults: 0, refused: 0, gatePasses: 0, plannedVaults: 0,
  };

  function ensureGrid(x, z) {
    if (grid && Math.hypot(x - gridX, z - gridZ) < S.regrid) return;
    grid = nav.makeGrid({ x, z, half: S.half, cell: S.cell, radius: game.tuning.ghostRadius });
    gridX = x;
    gridZ = z;
    if (N !== grid.n * grid.n) {
      N = grid.n * grid.n;
      dist = new Float64Array(N);
      prev = new Int32Array(N);
      prevJump = new Uint8Array(N);
      skelD = new Float64Array(N);
      heap = makeHeap(N * 4);
      queue = new Int32Array(N * 8);
    }
  }

  // How far, over the ground, each cell is from the nearest hunting skeleton.
  // Over the GROUND and not in a straight line, which is the whole point: a
  // firefly six units away with a fence between it and the chaser is safe, and
  // a bot measuring straight lines cannot see that. This field is the bot's
  // half of the asymmetry and it uses no jump edges, because skeletons cannot.
  function dangerField(solid) {
    skelD.fill(Infinity);
    heap.clear();
    for (const s of solid) {
      const c = grid.nearestOpen(s.x, s.z);
      if (c < 0) continue;
      const d0 = Math.hypot(grid.wx(c) - s.x, grid.wz(c) - s.z);
      if (d0 < skelD[c]) { skelD[c] = d0; heap.push(c, d0); }
    }
    while (heap.size) {
      const n = heap.pop();
      const dn = skelD[n];
      if (dn > S.scare) continue;
      for (let d = 0; d < 8; d++) {
        if (grid.wall[n * 8 + d]) continue;
        const [dx, dz] = grid.DIR8[d];
        const m = n + dz * grid.n + dx;
        const step = (dx && dz ? Math.SQRT2 : 1) * grid.cell;
        if (dn + step >= skelD[m]) continue;
        skelD[m] = dn + step;
        heap.push(m, dn + step);
      }
    }
  }

  function riskMul(c) {
    const d = skelD[c];
    if (!(d < S.scare)) return 1;
    if (d < S.wallAt) return S.wall;
    const close = (S.scare - d) / S.scare;
    return 1 + S.caution * close * close;
  }

  // Dijkstra from the ghost. Cost of a step is its LENGTH times the risk of the
  // cell it enters, so risk is integrated along the whole journey rather than
  // sampled at the end of it. A fence crossing is an extra edge at jumpCost
  // times the same length.
  function plan(from) {
    dist.fill(Infinity);
    prev.fill(-1);
    prevJump.fill(0);
    dist[from] = 0;
    heap.clear();
    heap.push(from, 0);
    while (heap.size) {
      const n = heap.pop();
      const dn = dist[n];
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = grid.DIR8[d];
        const m = n + dz * grid.n + dx;
        const a = n % grid.n;
        if (a + dx < 0 || a + dx >= grid.n || m < 0 || m >= N) continue;
        const step = (dx && dz ? Math.SQRT2 : 1) * grid.cell;
        let c = Infinity;
        let jumped = 0;
        if (!grid.wall[n * 8 + d]) {
          c = dn + step * riskMul(m);
        } else if (grid.fence[n * 8 + d] && !grid.blocked[m] && !dx !== !dz) {
          // A vault. Only on the four axis steps, because the real jump carries
          // 1.53 units at top speed and a diagonal cell step is 1.77.
          c = dn + step * S.jumpCost * riskMul(m);
          jumped = 1;
        } else continue;
        if (c >= dist[m]) continue;
        dist[m] = c;
        prev[m] = n;
        prevJump[m] = jumped;
        heap.push(m, c);
      }
    }
    stats.plans++;
  }

  function buildRoute(goal) {
    route.length = 0;
    routeJump.length = 0;
    let n = goal;
    let guard = 0;
    while (n !== -1 && guard++ < N) {
      route.push(n);
      routeJump.push(prevJump[n]);
      n = prev[n];
    }
    route.reverse();
    routeJump.reverse();
  }

  // The goal. `dist` already contains the risk of getting there, so this is a
  // plain minimum and the near-and-dangerous versus far-and-safe question is
  // already answered inside it. The only judgement left is what a thing is
  // WORTH, which is where the lantern's discount and the hysteresis live.
  function chooseGoal(state, threat) {
    let best = null;
    let bestC = Infinity;

    const consider = (key, x, z, bonus) => {
      const c = grid.index(x, z);
      if (c < 0) return;
      const cell = grid.blocked[c] ? grid.nearestOpen(x, z) : c;
      if (cell < 0 || !(dist[cell] < Infinity)) return;
      const cost = dist[cell] - bonus;
      if (cost < bestC) { bestC = cost; best = { key, cell, x, z }; }
    };

    if (state.power) {
      for (const s of game.herd.list) {
        if (s.state !== 'frightened') continue;
        consider(`s${s.id}`, s.x, s.z, S.huntRange);
      }
      if (best) { goalKey = best.key; goalCost = bestC; goalPt = best; return best; }
    }
    for (const p of state.powerups) consider(`p${p.id}`, p.x, p.z, threat < 12 ? S.panicPower : 6);
    for (const f of state.fireflies) consider(`f${f.id}`, f.x, f.z, 0);
    if (!best) { goalKey = null; goalPt = null; return null; }

    // Hysteresis. Keep the goal we already committed to unless the new one is
    // better by a real margin: with one pickup per screen, changing your mind
    // halfway costs the whole journey twice.
    if (goalKey && goalKey !== best.key && goalPt) {
      const c = grid.index(goalPt.x, goalPt.z);
      const cell = c >= 0 && grid.blocked[c] ? grid.nearestOpen(goalPt.x, goalPt.z) : c;
      const stillThere = (goalKey[0] === 'f' && state.fireflies.some((f) => `f${f.id}` === goalKey))
        || (goalKey[0] === 'p' && state.powerups.some((p) => `p${p.id}` === goalKey))
        || goalKey[0] === 's';
      if (stillThere && cell >= 0 && dist[cell] < Infinity && dist[cell] < bestC + S.switchMargin * Math.abs(bestC)) {
        goalCost = dist[cell];
        return { key: goalKey, cell, x: goalPt.x, z: goalPt.z };
      }
    }
    goalKey = best.key;
    goalCost = bestC;
    goalPt = best;
    return best;
  }

  function step(state, dt) {
    const g = state.ghost;
    const solid = game.herd.list.filter((s) => game.herd.isSolid(s) && s.state !== 'frightened');
    const nearest = solid.length ? Math.min(...solid.map((s) => Math.hypot(s.x - g.x, s.z - g.z))) : 999;
    if (nearest < 8) stats.threatTime += dt;
    if (nearest < 4) stats.panicTime += dt;
    for (const e of state.events) {
      if (e.type === 'jump') { stats.jumps++; if (e.overFence) stats.vaults++; }
      if (e.type === 'jumpRefused') stats.refused++;
    }
    // Nothing to steer with while in the air, and the stick is ignored anyway.
    if (g.airborne) return { x: 0, y: 0, jump: false };

    cool -= dt;
    if (cool <= 0 || !route.length) {
      cool = S.think;
      ensureGrid(g.x, g.z);
      const here = grid.nearestOpen(g.x, g.z);
      if (here < 0) { stats.stuck++; return { x: 0, y: 0, jump: false }; }
      dangerField(solid);
      plan(here);
      const goal = chooseGoal(state, nearest);
      if (!goal) {
        // Nothing worth going to inside the window. Walk away from the nearest
        // skeleton rather than stop, which is the one thing always wrong.
        stats.stuck++;
        if (!solid.length) return { x: 0, y: 0, jump: false };
        const s = solid[0];
        const dx = g.x - s.x;
        const dz = g.z - s.z;
        const l = Math.hypot(dx, dz) || 1;
        return { x: dx / l, y: dz / l, jump: false };
      }
      buildRoute(goal.cell);
      for (const j of routeJump) if (j) { stats.plannedVaults++; break; }
    }

    if (route.length < 2) {
      // Standing on the goal cell. Steer at the exact point.
      const p = goalPt || { x: g.x, z: g.z };
      const dx = p.x - g.x;
      const dz = p.z - g.z;
      const l = Math.hypot(dx, dz);
      if (l < 0.15) { route.length = 0; cool = 0; return { x: 0, y: 0, jump: false }; }
      return { x: dx / l, y: dz / l, jump: false };
    }

    // Walk the route forward to the nearest point on it, so a route is followed
    // rather than restarted, then aim S.cut further along. Arc length has no
    // state and cannot deadlock the way "switch when within d of the next node"
    // could: that version waited for ever for a node the wall stopped it short
    // of, and it is the reason this is written as a length and not a test.
    let k = 0;
    let bestD = Infinity;
    for (let i = 0; i < route.length; i++) {
      const d = (grid.wx(route[i]) - g.x) ** 2 + (grid.wz(route[i]) - g.z) ** 2;
      if (d < bestD) { bestD = d; k = i; }
    }
    if (k >= route.length - 1) { route.length = 0; cool = 0; }
    let rem = S.cut;
    let aimI = Math.min(k + 1, route.length - 1);
    let px = g.x;
    let pz = g.z;
    let wantJump = false;
    let toFence = Infinity;
    let travelled = 0;
    for (let i = k + 1; i < route.length; i++) {
      const qx = grid.wx(route[i]);
      const qz = grid.wz(route[i]);
      const seg = Math.hypot(qx - px, qz - pz);
      if (routeJump[i] && travelled < toFence) toFence = travelled;
      travelled += seg;
      px = qx; pz = qz;
      aimI = i;
      rem -= seg;
      if (rem <= 0) break;
    }
    // The vault. The plan asked for one, the fence is close, and the ghost is
    // allowed to make it. Everything that decides WHETHER it is legal lives in
    // rules.js; all the bot does is press the button at the right moment, the
    // same as a player.
    if (toFence < S.jumpTrigger && g.canJump) {
      const lx = g.x + g.vx * game.airTime;
      const lz = g.z + g.vz * game.airTime;
      if (nav.crossesBarrier(g.x, g.z, lx, lz, 0) && nav.discClear(lx, lz, game.tuning.ghostRadius)) wantJump = true;
    }
    const ax = grid.wx(route[aimI]);
    const az = grid.wz(route[aimI]);
    const dx = ax - g.x;
    const dz = az - g.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return { x: 0, y: 0, jump: wantJump };
    return { x: dx / l, y: dz / l, jump: wantJump };
  }

  return { step, stats, S };
}

// The other player: does nothing at all, and should be dead in under a minute.
// It still measures how close things got, because "the passive player dies" is
// a much weaker statement than "the passive player dies in 17 seconds", and the
// first one is true at any speed ratio at all.
export function passiveBot(game) {
  const stats = { threatTime: 0, panicTime: 0, plans: 0, stuck: 0, jumps: 0, vaults: 0, refused: 0, plannedVaults: 0 };
  return {
    stats,
    step: (state, dt) => {
      const g = state.ghost;
      const solid = game.herd.list.filter((s) => game.herd.isSolid(s) && s.state !== 'frightened');
      const near = solid.length ? Math.min(...solid.map((s) => Math.hypot(s.x - g.x, s.z - g.z))) : 999;
      if (near < 8) stats.threatTime += dt;
      if (near < 4) stats.panicTime += dt;
      return { x: 0, y: 0, jump: false };
    },
  };
}

// The careless player: the same planner with the danger term switched off, so
// it only ever avoids a skeleton by walking into one and dying. This is the
// LOWER bound the sweeps need. The careful bot has perfect information and
// re-plans ten times a second, so it flatters any setting; the gap between the
// two is how much the game rewards playing well, and a setting where that gap
// is zero is a setting with no game in it.
export function recklessBot(game) {
  return createBot(game, { caution: 0, wall: 1, wallAt: 0, scare: 1, panicPower: 4, think: 0.16, switchMargin: 0 });
}

// The third player, and the one that answers the owner's question directly: the
// careful bot with the vault priced at nothing, so it crosses every fence it
// meets and never walks to a gate. If this one plays as well as the careful bot
// then the jump has no cost and the asymmetry is decoration.
export function vaultBot(game) {
  return createBot(game, { jumpCost: 1.0 });
}

// And its opposite, which never jumps at all: the player who has not learned
// the mechanic. The gap between this and the careful bot is what the jump is
// WORTH, and it is the number that says whether the feature earns its place.
export function groundBot(game) {
  return createBot(game, { jumpCost: 1e6 });
}

export default createBot;
