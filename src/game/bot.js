// A player, so the level can be played a thousand times without anybody
// playing it.
//
// It is deliberately GREEDY: it goes to the nearest uncollected firefly, and
// the only cleverness is that "nearest" is measured with skeletons making the
// ground expensive rather than impassable. If a level cannot be cleared by that
// it cannot be cleared, and if that clears every level without ever being
// cornered the level has no chase in it. Those two failures look completely
// different in the numbers, which is the point of having a bot at all:
// clearRate near 0 is a broken level and threatTime near 0 is a boring one.
//
// The first version refused any node with a skeleton within three hops and
// picked the nearest firefly by plain hop count. It cleared nothing: it walked
// happily toward a firefly on the far side of the chaser, hit the refusal at
// the last moment and dithered on the spot until something ate it. Risk has to
// be in the DISTANCE, not in a veto, or a greedy bot cannot route around
// anything. That is the change, and it took the clear rate from 0 to what the
// soak reports.
//
// It steers with the same stick a human has, a world-axis vector in -1 to 1,
// so it is subject to the same acceleration, the same wall sliding and the same
// corner cutting the player is. It never teleports along the graph.

const SKILLS = {
  // A node this many hops from a skeleton or closer costs extra to enter, and
  // the surcharge grows as the square of how close it is. 7 hops is 14 units,
  // about seven seconds of skeleton.
  scare: 7,
  // Detour, in nodes, the bot will pay to move one hop further from a skeleton
  // at the closest range. The square law spends almost all of this at 1 and 2
  // hops and almost none at 6.
  caution: 0.75,
  // Standing next to something is never worth any firefly.
  wall: 400,
  think: 0.10,
  huntRange: 22,        // cost units, so about eleven nodes of clear corridor
  panicPower: 14,       // how much a lantern is discounted when something is close
};

// A binary heap keyed on cost. 170 nodes and 180 edges, so this is a few
// hundred operations per plan and the bot can afford to re-plan ten times a
// second for a few hundred simulated minutes.
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
  const N = nav.nodes.length;
  const danger = new Int32Array(N);
  const dist = new Float64Array(N);
  const prev = new Int32Array(N);
  const bfsQ = new Int32Array(N);
  const heap = makeHeap(N * 4);
  const flyNode = nav.fireflies.map((f) => nav.nodeNear(f.u, f.v));
  const powerNode = nav.powerups.map((p) => nav.nodeNear(p.u, p.v));

  let next = -1;
  let aimU = 0;
  let aimV = 0;
  let cool = 0;
  const stats = { threatTime: 0, panicTime: 0, plans: 0, stuck: 0 };

  // Hops from the nearest hunting skeleton, capped, by multi-source breadth
  // first. Cheap enough to redo on every plan, which it has to be: a stale
  // danger field is exactly the thing that gets a bot eaten.
  function dangerField(solid) {
    danger.fill(S.scare);
    let tail = 0;
    for (const s of solid) {
      const n = nav.nodeNear(s.u, s.v);
      if (danger[n] > 0) { danger[n] = 0; bfsQ[tail++] = n; }
    }
    let head = 0;
    while (head < tail) {
      const n = bfsQ[head++];
      if (danger[n] >= S.scare) continue;
      for (const m of nav.nodes[n].edges) {
        if (danger[m] <= danger[n] + 1) continue;
        danger[m] = danger[n] + 1;
        bfsQ[tail++] = m;
      }
    }
  }

  function enterCost(n) {
    const d = danger[n];
    if (d >= S.scare) return 1;
    if (d <= 1) return S.wall;
    const close = S.scare - d;
    return 1 + S.caution * close * close;
  }

  function plan(here) {
    dist.fill(Infinity);
    prev.fill(-1);
    dist[here] = 0;
    heap.clear();
    heap.push(here, 0);
    while (heap.size) {
      const n = heap.pop();
      const dn = dist[n];
      for (const m of nav.nodes[n].edges) {
        const c = dn + enterCost(m);
        if (c >= dist[m]) continue;
        dist[m] = c;
        prev[m] = n;
        heap.push(m, c);
      }
    }
    stats.plans++;
  }

  function firstStep(here, goal) {
    let n = goal;
    if (n === here) return -1;
    let guard = 0;
    while (prev[n] !== here && prev[n] !== -1 && guard++ < N * 2) n = prev[n];
    return prev[n] === here ? n : -1;
  }

  // The goal is a POINT, not a node. Half the fireflies sit at edge midpoints,
  // 1.0 from either end, so a bot that walks to the nearest node and stops has
  // not collected anything: the first version of this did exactly that, left
  // every midpoint firefly on the floor and could not clear a level however
  // long it was given. `stuck` in the stats is what it looks like when it
  // happens, so the counter stays.
  const goal = { node: -1, u: 0, v: 0 };
  function chooseGoal(here, state, threat) {
    let best = -1;
    let bestC = Infinity;
    let bu = 0;
    let bv = 0;

    if (state.power) {
      for (const s of game.herd.list) {
        if (s.state !== 'frightened') continue;
        const n = nav.nodeNear(s.u, s.v);
        if (dist[n] > S.huntRange || dist[n] >= bestC) continue;
        bestC = dist[n]; best = n; bu = s.u; bv = s.v;
      }
      if (best !== -1) { goal.node = best; goal.u = bu; goal.v = bv; return goal; }
    }

    for (let i = 0; i < powerNode.length; i++) {
      if (state.powerups[i].taken) continue;
      const n = powerNode[i];
      // A lantern is worth a detour, and a big one when something is close: it
      // is the only thing in the level that turns the chase round.
      const c = dist[n] - (threat < 9 ? S.panicPower : 2);
      if (c < bestC) { bestC = c; best = n; bu = nav.powerups[i].u; bv = nav.powerups[i].v; }
    }
    for (let i = 0; i < flyNode.length; i++) {
      if (state.fireflies.collected[i]) continue;
      const n = flyNode[i];
      const f = nav.fireflies[i];
      // Break the tie between the fireflies sharing a node by which is nearer
      // on the ground, so the bot sweeps a corridor rather than yo-yoing.
      const c = dist[n] + 0.4 * Math.hypot(f.u - nav.nodes[here].u, f.v - nav.nodes[here].v) / 20;
      if (c >= bestC) continue;
      bestC = c; best = n; bu = f.u; bv = f.v;
    }
    goal.node = best; goal.u = bu; goal.v = bv;
    return goal;
  }

  function step(state, dt) {
    const g = game.debug.ghost;
    const here = nav.nodeNear(g.u, g.v);
    const solid = game.herd.list.filter((s) => game.herd.isSolid(s) && s.state !== 'frightened');
    const nearest = solid.length ? Math.min(...solid.map((s) => Math.hypot(s.u - g.u, s.v - g.v))) : 999;
    if (nearest < 8) stats.threatTime += dt;
    if (nearest < 4) stats.panicTime += dt;

    cool -= dt;
    if (cool <= 0 || next === -1) {
      cool = S.think;
      dangerField(solid);
      plan(here);
      const gl = chooseGoal(here, state, nearest);
      if (gl.node === -1) { next = -1; aimU = g.u; aimV = g.v; }
      else if (gl.node === here) { next = here; aimU = gl.u; aimV = gl.v; }
      else {
        next = firstStep(here, gl.node);
        if (next === -1) {
          // Nowhere to go at all. Take the safest neighbour rather than stop,
          // which is the one thing that is always wrong.
          let bestD = -1;
          for (const m of nav.nodes[here].edges) if (danger[m] > bestD) { bestD = danger[m]; next = m; }
          stats.stuck++;
        }
        if (next !== -1) { aimU = nav.nodes[next].u; aimV = nav.nodes[next].v; }
      }
    }
    if (next === -1) return { x: 0, y: 0 };

    const w = nav.toWorld(aimU, aimV);
    const p = nav.toWorld(g.u, g.v);
    const dx = w.x - p.x;
    const dz = w.z - p.z;
    const len = Math.hypot(dx, dz);
    // Arrived: plan again next frame rather than orbiting the point.
    if (len < 0.30) { next = -1; cool = 0; }
    if (len < 1e-6) return { x: 0, y: 0 };
    return { x: dx / len, y: dz / len };
  }

  return { step, stats, S };
}

// The other player: does nothing at all, and should be dead in under a minute.
export function passiveBot() {
  return { step: () => ({ x: 0, y: 0 }), stats: { threatTime: 0, panicTime: 0, plans: 0, stuck: 0 } };
}

export default createBot;
