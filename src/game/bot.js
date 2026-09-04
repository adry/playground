// A player, so the level can be played a thousand times without anybody
// playing it.
//
// It is deliberately GREEDY and deliberately not clever: it walks the corridor
// graph toward the nearest uncollected firefly, refuses to step toward a
// skeleton, and goes hunting when a lantern is lit. If a level cannot be
// cleared by that it cannot be cleared, and if that clears every level without
// ever being cornered the level has no chase in it. Those two failures look
// completely different in the numbers, which is the point of having a bot at
// all: `clearRate` near 0 is a broken level and `threatSeconds` near 0 is a
// boring one.
//
// It steers with the same stick a human has, a world-axis vector in -1 to 1,
// so it is subject to the same acceleration, the same wall sliding and the same
// corner cutting the player is. It is not allowed to teleport along the graph.

const SKILLS = {
  // How far ahead on the graph a skeleton has to be before the bot will walk
  // that way. 3 nodes is 6.0 units, about two seconds of closing.
  fear: 3,
  // How hard danger is weighed against progress, in nodes of detour the bot
  // will accept to add one node of clearance.
  caution: 2.6,
  cautionCap: 7,
  // Repick this often. A human does not re-plan at 60 Hz.
  think: 0.10,
  // Go for a frightened skeleton if it is no further than this many nodes.
  huntRange: 9,
};

export function createBot(game, opts = {}) {
  const S = { ...SKILLS, ...opts };
  const nav = game.nav;
  const N = nav.nodes.length;
  const danger = new Int32Array(N);
  const queue = new Int32Array(N);
  // Which node each firefly belongs to, worked out once.
  const flyNode = nav.fireflies.map((f) => nav.nodeNear(f.u, f.v));
  const powerNode = nav.powerups.map((p) => nav.nodeNear(p.u, p.v));

  let target = null;        // the node we are walking at
  let next = -1;            // the neighbour we are walking to right now
  let cool = 0;
  const stats = { threatTime: 0, panicTime: 0, decisions: 0 };

  function dangerField(solid) {
    danger.fill(99);
    let tail = 0;
    for (const s of solid) {
      const n = nav.nodeNear(s.u, s.v);
      if (danger[n] > 0) { danger[n] = 0; queue[tail++] = n; }
    }
    let head = 0;
    while (head < tail) {
      const n = queue[head++];
      if (danger[n] >= S.cautionCap) continue;
      for (const m of nav.nodes[n].edges) {
        if (danger[m] <= danger[n] + 1) continue;
        danger[m] = danger[n] + 1;
        queue[tail++] = m;
      }
    }
  }

  function pickTarget(here, state) {
    // A lit lantern is worth more than a firefly whenever the chase is on: it
    // is the only thing in the level that reverses the chase.
    const d = nav.distFrom(here);
    let best = -1;
    let bestD = Infinity;

    if (state.power) {
      for (const s of game.herd.list) {
        if (s.state !== 'frightened') continue;
        const n = nav.nodeNear(s.u, s.v);
        if (d[n] < 0 || d[n] > S.huntRange || d[n] >= bestD) continue;
        bestD = d[n];
        best = n;
      }
      if (best !== -1) return best;
    }

    // A power pellet that is on the way, or close, when something is near.
    const threat = Math.min(...game.herd.list.filter((s) => game.herd.isSolid(s) && s.state !== 'frightened')
      .map((s) => danger[nav.nodeNear(s.u, s.v)] === 0 ? nav.distFrom(here)[nav.nodeNear(s.u, s.v)] : 99), 99);
    for (let i = 0; i < powerNode.length; i++) {
      if (state.powerups[i].taken) continue;
      const n = powerNode[i];
      if (d[n] < 0) continue;
      const worth = threat < 8 ? d[n] - 6 : d[n];
      if (worth < bestD) { bestD = worth; best = n; }
    }

    for (let i = 0; i < flyNode.length; i++) {
      if (state.fireflies.collected[i]) continue;
      const n = flyNode[i];
      if (d[n] < 0 || d[n] >= bestD) continue;
      bestD = d[n];
      best = n;
    }
    return best;
  }

  function step(state, dt) {
    cool -= dt;
    const g = game.debug.ghost;
    const here = nav.nodeNear(g.u, g.v);
    const solid = game.herd.list.filter((s) => game.herd.isSolid(s) && s.state !== 'frightened');
    dangerField(solid);
    const nearest = Math.min(...solid.map((s) => Math.hypot(s.u - g.u, s.v - g.v)), 999);
    if (nearest < 8) stats.threatTime += dt;
    if (nearest < 4) stats.panicTime += dt;

    if (cool <= 0 || next === -1 || target === null || target === -1) {
      cool = S.think;
      target = pickTarget(here, state);
      next = -1;
    }
    if (target === -1) return { x: 0, y: 0 };

    // Re-pick the immediate neighbour every frame: the danger field moves, and
    // a bot committed to a corridor for a tenth of a second walks into things.
    const dT = nav.distFrom(target);
    const node = nav.nodes[here];
    let best = -1;
    let bestScore = Infinity;
    for (const m of node.edges) {
      if (dT[m] < 0) continue;
      const safe = Math.min(danger[m], S.cautionCap);
      // Refuse outright to walk into something's face unless there is no other
      // way, which is what the second pass below is for.
      if (safe < S.fear) continue;
      const score = dT[m] - S.caution * safe;
      if (score < bestScore) { bestScore = score; best = m; }
    }
    if (best === -1) {
      // Cornered. Take the least bad way out, progress be damned.
      for (const m of node.edges) {
        const score = -Math.min(danger[m], S.cautionCap) * 10 + (dT[m] < 0 ? 50 : dT[m] * 0.05);
        if (score < bestScore) { bestScore = score; best = m; }
      }
    }
    if (best === -1) return { x: 0, y: 0 };
    next = best;
    stats.decisions++;

    // Steer at the next node's centre, in world axes, which is what the stick
    // speaks. Full deflection: a bot that eases off is a bot that dies.
    const m = nav.nodes[next];
    const w = nav.toWorld(m.u, m.v);
    const p = nav.toWorld(g.u, g.v);
    const dx = w.x - p.x;
    const dz = w.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, y: dz / len };
  }

  return { step, stats, S };
}

// The other player: does nothing at all, and should be dead in under a minute.
export function passiveBot() {
  return { step: () => ({ x: 0, y: 0 }), stats: { threatTime: 0, panicTime: 0, decisions: 0 } };
}

export default createBot;
