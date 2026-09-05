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
  // THE PLANNING WINDOW, and the derivation matters because getting it wrong
  // was worth four fifths of the bot's score.
  //
  // The raster is centred where it was last BUILT, not where the ghost is, so
  // the horizon the bot can actually see forward is `half - regrid`. That has
  // to comfortably exceed the firefly spacing of 18 or the bot spends its life
  // with no candidate in front of it, dithering between things behind it. At
  // half 26 and regrid 10 the horizon is 16, just under the spacing, and the
  // bot collected 14 fireflies in five minutes. At half 34 and regrid 8 the
  // horizon is 26 and it collects 60. One number, four times the score, and it
  // is exactly the failure mode the header warns about: the bot looked like a
  // bad player and the game looked like a hard game.
  think: 0.10,
  half: 34,
  cell: 1.5,
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

// A binary heap on typed arrays. It GROWS, and it has to: an out of bounds
// write to a typed array is a silent no-op, so a heap that overflows does not
// throw, it quietly drops the entry and returns a worse route. The first
// version of this was sized at four entries a cell, a Dijkstra with eight
// neighbours and four jump edges can push twelve, and the result was a bot
// whose score fell by four fifths when the planning window got BIGGER. Nothing
// in the output said anything was wrong.
function makeHeap(n) {
  let cap = n + 1;
  let node = new Int32Array(cap);
  let cost = new Float64Array(cap);
  let size = 0;
  function grow() {
    cap *= 2;
    const nn = new Int32Array(cap);
    nn.set(node);
    node = nn;
    const nc = new Float64Array(cap);
    nc.set(cost);
    cost = nc;
  }
  return {
    clear() { size = 0; },
    get size() { return size; },
    push(v, c) {
      let i = ++size;
      if (size >= cap) grow();
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
  let want = null;
  let skelD = null;
  let heap = null;

  let cool = 0;
  // Jam detection. A planner over a raster is always coarser than the geometry
  // it plans on, so sooner or later it aims the ghost at a gap the ghost does
  // not fit through, and a ghost held against a headstone at full stick looks
  // exactly like a ghost travelling at full speed to anything reading its
  // velocity. This is the bot's own way out, and soak.mjs asserts separately
  // that it never has to be used for long.
  let jamTime = 0;
  let jamX = 0;
  let jamZ = 0;
  let shove = 0;
  let shoveX = 0;
  let shoveZ = 0;
  let route = [];          // cell indices, ghost first
  let routeJump = [];      // routeJump[k] is true if the step INTO route[k] is a vault
  let goalKey = null;
  let goalCost = Infinity;
  let goalPt = null;
  const stats = {
    threatTime: 0, panicTime: 0, plans: 0, stuck: 0,
    jumps: 0, vaults: 0, refused: 0, wouldVault: 0, plannedVaults: 0, fenceRoutes: 0,
  };

  function ensureGrid(x, z) {
    // In a BOUNDED arena the raster is the whole level, built once and never
    // moved. That is both faster and better play: the horizon derivation below
    // exists only because a moving window has a horizon, and a window covering
    // everything has none. It also stops the planner spending half its
    // Dijkstra on the ground outside the wall, which it can never reach.
    const bb = nav.bounds;
    if (bb) {
      if (grid) return;
      const cx = (bb.minX + bb.maxX) / 2;
      const cz = (bb.minZ + bb.maxZ) / 2;
      // A FINER CELL in an arena. 1.5 is right for a 68 unit planning window
      // on an open plane, where it buys speed and costs nothing that matters.
      // In a 30 unit arena it is a quarter of the board's width per cell, a
      // gate is barely more than one cell across, and the planner routes the
      // ghost into gaps it does not fit through: the recovery shove fired 180
      // times in a five minute run and the bot collected four of nine
      // fireflies. The arena is small enough to afford 0.75.
      grid = nav.makeGrid({
        x: cx, z: cz, cell: Math.min(S.cell, 0.75), radius: game.tuning.ghostRadius,
        half: Math.max(bb.maxX - cx, bb.maxZ - cz) + 1,
      });
      gridX = cx;
      gridZ = cz;
    } else {
      if (grid && Math.hypot(x - gridX, z - gridZ) < S.regrid) return;
      grid = nav.makeGrid({ x, z, half: S.half, cell: S.cell, radius: game.tuning.ghostRadius });
      gridX = x;
      gridZ = z;
    }
    if (N !== grid.n * grid.n) {
      N = grid.n * grid.n;
      dist = new Float64Array(N);
      prev = new Int32Array(N);
      prevJump = new Uint8Array(N);
      want = new Uint8Array(N);
      skelD = new Float64Array(N);
      heap = makeHeap(N * 12);
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
  // Everything worth going to, as cells, so the Dijkstra can stop once it has
  // settled all of them rather than filling the whole window. In open ground
  // that is most of the saving there is, and the soak runs tens of millions of
  // frames.
  function wantedCells(state) {
    const out = [];
    const push = (x, z) => {
      const c = grid.index(x, z);
      if (c < 0) return;
      const cell = grid.blocked[c] ? grid.nearestOpen(x, z) : c;
      if (cell >= 0) out.push(cell);
    };
    if (state.power) for (const s of game.herd.list) if (s.state === 'frightened') push(s.x, s.z);
    for (const p of state.powerups) push(p.x, p.z);
    for (const f of state.fireflies) push(f.x, f.z);
    return out;
  }

  function plan(from, wanted) {
    dist.fill(Infinity);
    prev.fill(-1);
    prevJump.fill(0);
    dist[from] = 0;
    heap.clear();
    heap.push(from, 0);
    let left = 0;
    if (wanted && wanted.length) { want.fill(0); for (const c of wanted) if (!want[c]) { want[c] = 1; left++; } }
    while (heap.size) {
      const n = heap.pop();
      const dn = dist[n];
      if (left && want[n]) { want[n] = 0; if (--left === 0) break; }
      for (let d = 0; d < 8; d++) {
        const [dx, dz] = grid.DIR8[d];
        const m = n + dz * grid.n + dx;
        const a = n % grid.n;
        if (a + dx < 0 || a + dx >= grid.n || m < 0 || m >= N) continue;
        if (grid.wall[n * 8 + d]) continue;
        const step = (dx && dz ? Math.SQRT2 : 1) * grid.cell;
        const c = dn + step * riskMul(m);
        if (c >= dist[m]) continue;
        dist[m] = c;
        prev[m] = n;
        prevJump[m] = 0;
        heap.push(m, c);
      }
      // THE VAULT EDGES, and they come from nav's jump table rather than from
      // the wall mask. A vault is never a step to the ADJACENT cell: a fence
      // keeps a 0.55 disc 0.65 away on each side, so the cell across a fence
      // from you is always blocked and the one you land in is two or three
      // further on. An earlier version of this looked for an adjacent cell
      // across a fence bit, found one exactly never, and gave the bot no vault
      // edges at all. It was invisible in the output because a bot that cannot
      // vault and a bot that has decided not to vault look identical: the
      // jumpCost sweep printed the same row seven times, at every price from
      // free to never, and that is what gave it away.
      const links = grid.jump.get(n);
      if (links) {
        for (const m of links) {
          const span = Math.hypot(grid.wx(m) - grid.wx(n), grid.wz(m) - grid.wz(n));
          const c = dn + span * S.jumpCost * riskMul(m);
          if (c >= dist[m]) continue;
          dist[m] = c;
          prev[m] = n;
          prevJump[m] = 1;
          heap.push(m, c);
        }
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
      // A goal is only still there if the THING is still there. `s` goals are
      // frightened skeletons, and the unconditional `|| goalKey[0] === 's'`
      // that used to be here meant that when the lantern burned out the bot
      // kept chasing the memory of one: it walked to the spot where the
      // skeleton had been, arrived, found nothing, and stood on it for the rest
      // of the run because the hysteresis would not let it change its mind.
      // That was two thirds of the arena's fireflies left uncollected.
      const stillThere = (goalKey[0] === 'f' && state.fireflies.some((f) => `f${f.id}` === goalKey))
        || (goalKey[0] === 'p' && state.powerups.some((p) => `p${p.id}` === goalKey))
        || (goalKey[0] === 's' && state.power
          && game.herd.list.some((k) => `s${k.id}` === goalKey && k.state === 'frightened'));
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
    if (g.airborne) { jamTime = 0; return { x: 0, y: 0, jump: false }; }

    // Only while actually playing. The ready beat and the death pause are
    // 1.8 and 1.6 seconds of the ghost legitimately not moving, and counting
    // them made every single life start with a spurious recovery shove.
    if (state.phase !== 'play' || Math.hypot(g.x - jamX, g.z - jamZ) > 0.4) { jamTime = 0; jamX = g.x; jamZ = g.z; }
    else jamTime += dt;
    if (shove > 0) {
      shove -= dt;
      return { x: shoveX, y: shoveZ, jump: false };
    }
    if (jamTime > 0.5) {
      // Slide along whatever is in the way for a third of a second, rebuild
      // the raster where we now are, and think again.
      stats.stuck++;
      jamTime = 0;
      const a = (stats.stuck * 2.399) % (Math.PI * 2);
      shoveX = Math.cos(a);
      shoveZ = Math.sin(a);
      shove = 0.33;
      if (!nav.bounds) grid = null;
      route.length = 0;
      cool = 0;
      return { x: shoveX, y: shoveZ, jump: false };
    }

    cool -= dt;
    if (cool <= 0 || !route.length) {
      cool = S.think;
      ensureGrid(g.x, g.z);
      const here = grid.nearestOpen(g.x, g.z);
      if (here < 0) { stats.stuck++; return { x: 0, y: 0, jump: false }; }
      dangerField(solid);
      plan(here, wantedCells(state));
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
      // Was a fence between the ghost and its goal at all? That is the
      // denominator the vault rate has to be read against: a bot that never
      // jumps in a world with no fences on its routes has learned nothing.
      if (nav.crossesBarrier(g.x, g.z, goal.x, goal.z, 0)) stats.fenceRoutes++;
    }

    if (route.length < 2) {
      // Standing on the goal cell. Steer at the exact point, which is what
      // actually gets picked up: a cell is 1.25 across and a pick radius is
      // 1.0, so arriving at the cell is not arriving at the firefly.
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
    if (k >= route.length - 1) {
      // The end of the plan. Head for the goal point itself and re-plan on the
      // next tick. Emptying the route here and carrying on was a bug worth
      // naming: it left the follower indexing an empty array, which steered at
      // NaN for a frame and re-planned on every single frame after, at six
      // times the intended rate and a third of the score.
      route.length = 0;
      cool = 0;
      const p = goalPt || { x: g.x, z: g.z };
      const dx = p.x - g.x;
      const dz = p.z - g.z;
      const l = Math.hypot(dx, dz);
      return l < 1e-6 ? { x: 0, y: 0, jump: false } : { x: dx / l, y: dz / l, jump: false };
    }

    let rem = S.cut;
    let aimI = k + 1;
    let px = g.x;
    let pz = g.z;
    let wantJump = false;
    let toFence = Infinity;
    let travelled = 0;
    let aimDone = false;
    // Two things are being looked for and they have different horizons: the aim
    // point is S.cut along the route, and the next VAULT may be further, so the
    // scan runs to whichever is longer. Cutting it at S.cut was why the first
    // version of this never pressed jump at all.
    for (let i = k + 1; i < route.length; i++) {
      const qx = grid.wx(route[i]);
      const qz = grid.wz(route[i]);
      const seg = Math.hypot(qx - px, qz - pz);
      if (routeJump[i] && travelled < toFence) toFence = travelled;
      travelled += seg;
      px = qx; pz = qz;
      if (!aimDone) { aimI = i; rem -= seg; if (rem <= 0) aimDone = true; }
      if (aimDone && (travelled > S.jumpTrigger + 1.5 || toFence < Infinity)) break;
    }

    // The vault. The plan asked for one, the fence is close, and the ghost is
    // allowed to make it. Everything that decides WHETHER it is legal lives in
    // rules.js; all the bot does is press the button at the right moment, the
    // same as a player.
    if (toFence < S.jumpTrigger && g.canJump) {
      const lx = g.x + g.vx * game.airTime;
      const lz = g.z + g.vz * game.airTime;
      if (nav.crossesBarrier(g.x, g.z, lx, lz, 0) && nav.discClear(lx, lz, game.tuning.ghostRadius)) wantJump = true;
      else stats.wouldVault++;
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
  const stats = { threatTime: 0, panicTime: 0, plans: 0, stuck: 0, jumps: 0, vaults: 0, refused: 0, wouldVault: 0, plannedVaults: 0, fenceRoutes: 0 };
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
