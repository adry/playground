// createGame: the rules half of the graveyard.
//
//   import { createLayout } from './layout/index.js';
//   import { createGame } from './rules.js';
//   const game = createGame({ layout: createLayout({ seed: 7 }) });
//   const state = game.update(dt, { x, y });
//
// `input` is the axis object src/ghost/input.js already produces and
// src/ghost/main.js already feeds to Ghost.update: a stick, x and y each in
// -1 to 1 in WORLD axes, not a direction and not a key. The ghost here
// integrates it with the same model ghost.js uses, an exponential approach to
// input * maxSpeed with a 0.12 s time constant, so a ratio measured in this
// file is a ratio the player will actually feel.
//
// Nothing here imports three, builds a mesh or touches a canvas. The renderer
// reads `state` and plays animations; it is never asked a question.
//
// ---------------------------------------------------------------------------
// THE SPEED RATIO, which is the one decision everything else hangs off
// ---------------------------------------------------------------------------
//
// Measured, before anything was changed: the ghost's own maxSpeed in
// src/ghost/ghost.js is 4.5, and the skeleton's TOP_SPEED in
// props/skeleton/perform.js is 1.25. That is a ratio of 0.28. Pac-Man's ghosts
// run at 0.75 of Pac-Man in the first level and 0.95 by the last, and the
// reason its chase works at all is that the gap is small enough that a mistake
// is fatal and large enough that a good line is rewarded. At 0.28 nothing is
// ever fatal: the soak's passive player, standing still, survived 200 s of
// every level it was given, because a skeleton that has to walk round a plot
// while the player walks round it three times never arrives.
//
// So one number had to move, and both of them did, because moving either one
// alone costs more than the game can pay.
//
//   Raising the skeleton alone. The walk cycle is driven by DISTANCE, not
//   time: perform.js's STEP_LENGTH is 0.629, so the cadence is speed / 0.629
//   steps a second. At its authored 1.25 that is 1.99, a walk. To reach 0.75 of
//   a 4.5 ghost it would need 3.375, which is 5.4 steps a second, or 322 steps
//   a minute. A sprinter is about 260. It is not a fast walk, it is a cartoon
//   scramble, and the figure's legs cannot lengthen the stride to absorb it:
//   perform.js says so in its own comment, that its 1.15 legs under a 1.225 hip
//   run out of reach at 0.35 either side and only the heel-off buys the stride
//   it has.
//
//   Slowing the ghost alone. To put a 1.25 skeleton at 0.75 the ghost would
//   have to come down to 1.67, which is 37% of what it does now. The cloth is
//   the problem: the skirt's flare, its lift and the trail behind it are all
//   driven by velocity through cloth.js, so a ghost at a third speed is not a
//   slower ghost, it is a limp one, and the character stops selling itself the
//   moment it moves.
//
// THE CHOICE: ghost 3.20, skeleton 2.05, a ratio of 0.64, with the chaser
// reaching 2.50 (0.78) under Cruise Elroy when the level is nearly clear.
//
//   The skeleton goes up 64%, from 1.25 to 2.05. That is 3.26 steps a second,
//   195 a minute, which is a jog and not a scramble: a person moves that way
//   when they are late, which is the right read for a thing chasing you.
//   Elroy's 2.50 is 3.97 steps a second and IS at the edge, which is fine
//   because it is one skeleton, briefly, at the end of a level, and reading as
//   slightly unhinged is the point of Elroy.
//
//   The ghost comes down 29%, from 4.5 to 3.2. accelTime is untouched at 0.12,
//   which matters more than the top speed does: the stick still bites in an
//   eighth of a second, so the ghost feels no less connected, only less
//   floaty. It still crosses the 44-unit playfield in 14 s.
//
//   0.64 rather than Pac-Man's 0.75 because the ghost has an advantage
//   Pac-Man does not: it is a DISC in a 2.0 corridor rather than a thing on
//   rails, so it cuts the inside of every corner and, more importantly, it can
//   reverse instantly while a skeleton may not reverse at all. In simulation
//   those two together are worth about 15% of effective speed to a competent
//   player, which is exactly the gap between 0.64 and 0.75. The soak agrees:
//   see soak.mjs for the sweep that picked it.
//
// WHAT TO TELL THE ANIMATOR
//
//   1. perform.js's TOP_SPEED goes 1.25 -> 2.05 and the cadence goes with it,
//      because the cycle is distance-driven and will do this correctly on its
//      own. Look at it and expect a jog.
//   2. If 3.26 steps a second reads as a scramble anyway, the fix is stride,
//      not speed: STEP_LENGTH from 0.629 to about 0.78 brings the cadence back
//      to 2.6 a second, and the way to buy that reach is a deeper HIP_STALK and
//      more MAX_HEEL, which is what a person does when they lengthen their own
//      stride. Do not fix it by slowing the skeleton down; the ratio is load
//      bearing and 0.55 is where the passive player starts surviving.
//   3. Elroy needs a visible tell, because a speed change nobody can see is a
//      difficulty change nobody can learn. A faster jaw chatter and a harder
//      forward lean would do it.
//   4. Frightened is 1.15, which is BELOW the authored 1.25, so the flee can
//      simply play the original walk cycle, slightly under pace, and read as
//      the thing losing its nerve.
//   5. Eaten is 5.2 and is not a walk at all. It wants its own clip: a heap of
//      bones going home faster than it ever chased anybody.

import { createNav, TILE } from './nav.js';
import { createHerd, DEFAULT_SPEEDS, EMERGE_TIME, PERSONALITIES } from './chase.js';

export const TUNING = {
  // --- the two speeds, and see the essay above ------------------------------
  ghostSpeed: 3.20,
  ghostAccel: 0.12,          // ghost.js's own accelTime, untouched
  speeds: DEFAULT_SPEEDS,    // walk 2.05, fright 1.15, eaten 5.20, plus Elroy

  // --- collision ------------------------------------------------------------
  // The ghost is 1.31 across its skirt but the skirt is cloth. 0.55 lets it
  // pass a skeleton in a 2.0 corridor with 0.45 of play either side of the
  // centreline, which is what makes cutting a corner possible at all.
  ghostRadius: 0.55,
  // Bones touching cloth. Ghost 0.55 plus skeleton 0.475 is 1.02 at true
  // contact; 0.85 lets the two overlap slightly before it counts, which is
  // what every arcade game does and what stops a near miss reading as a cheat.
  catchRadius: 0.85,
  pickRadius: 0.80,          // fireflies sit at 1.0 spacing on the centreline
  powerRadius: 0.90,

  // --- the mode schedule ----------------------------------------------------
  //
  // Pac-Man's first level is 7 scatter, 20 chase, 7, 20, 5, 20, 5, then chase
  // for ever, and the reason that schedule is most of why the game is playable
  // is that scatter is not a rest, it is a RESET: every skeleton reverses and
  // leaves, so a player pinned in a corner is always at most twenty seconds
  // from being let out.
  //
  // It cannot be copied verbatim, because the unit it is denominated in is a
  // maze crossing and this maze is a different size. Pac-Man's ghosts cross
  // their board in about 3.4 s; a 2.05 skeleton crosses this 44 by 32 field in
  // 21 s. Copying 7 s of scatter would mean a skeleton turning round, walking
  // a sixth of the way to its corner and turning back, which the player would
  // read as a twitch rather than as a reprieve.
  //
  // So the schedule is scaled to how long it takes to get somewhere, and the
  // pattern is kept: long enough to break a pin, short enough that the level
  // has a rhythm rather than two halves.
  //
  //   scatter 9, chase 24, scatter 9, chase 28, scatter 7, chase 32, scatter 7,
  //   then chase for ever.
  //
  // 9 s of scatter is 18 units of travel, which is a plot and a half: enough
  // for a skeleton to visibly leave and for the player to take the corridor it
  // vacated. The chases lengthen, 24 then 28 then 32, so the level tightens on
  // its own even before Elroy does, and the whole cycle runs 116 s against a
  // greedy clear of about 150 s, which means a player sees the schedule once
  // and a bit and then lives in the final chase. That last part is deliberate:
  // Pac-Man does the same thing and it is why the end of a board is frightening.
  waves: [
    { mode: 'scatter', t: 9 }, { mode: 'chase', t: 24 },
    { mode: 'scatter', t: 9 }, { mode: 'chase', t: 28 },
    { mode: 'scatter', t: 7 }, { mode: 'chase', t: 32 },
    { mode: 'scatter', t: 7 }, { mode: 'chase', t: Infinity },
  ],

  // --- the power pellet -----------------------------------------------------
  //
  // 8.0 s. Pac-Man's first level gives 6, at a speed where 6 s buys about two
  // board widths of travel. Here 8 s at 3.2 buys 25.6 units, which is 58% of
  // the playfield's width, and against a skeleton fleeing at 1.15 the closing
  // speed is 2.05, so the ghost can run down anything within 16 units and get
  // most of the way back. In simulation a bot that goes hunting when the
  // lantern goes out catches 1.9 skeletons a pellet at 8 s, 1.2 at 6 s and 2.7
  // at 11 s. Two is the number that feels like a reward without feeling like a
  // pause, so 8 it is.
  //
  // The engine caps this too: four holes in the floor at once, so at most four
  // skeletons can be climbing out simultaneously and a mass eat cannot exceed
  // what the ground will carry. With three pen graves and four skeletons, the
  // hole budget is never the binding constraint.
  powerTime: 8.0,
  // Pac-Man's doubling, which is what makes chaining them worth the risk.
  eatScore: [200, 400, 800, 1600],
  fireflyScore: 10,
  powerScore: 50,
  clearBonus: 1000,

  lives: 3,
  // A beat for the death animation, then everything is put back. Pac-Man's is
  // about 1.9 s and it matters: without it a death is not punctuated and the
  // player does not know what happened.
  deathPause: 1.6,
  // The same beat at the start of a level and after a death, so the player is
  // not eaten while reading the board.
  readyPause: 1.8,

  // A move longer than this is cut into pieces before it is integrated. 0.2
  // units is a tenth of the corridor width, so nothing can pass through a wall
  // however big a dt a backgrounded tab hands us.
  maxStep: 0.20,
};

function clampAxis(input) {
  let x = Number.isFinite(input?.x) ? input.x : 0;
  let y = Number.isFinite(input?.y) ? input.y : 0;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y };
}

export function createGame({ layout, seed = 1, tuning = {}, skeletons = 4 } = {}) {
  const T = { ...TUNING, ...tuning, speeds: { ...TUNING.speeds, ...(tuning.speeds || {}) } };
  const nav = createNav(layout);
  const herd = createHerd({
    nav, graves: nav.graves, count: Math.max(1, skeletons), seed, speeds: T.speeds,
  });

  const flyCount = nav.fireflies.length;
  const collected = new Uint8Array(flyCount);
  const powerTaken = new Uint8Array(nav.powerups.length);

  // Fireflies bucketed by tile, so a pickup test is the handful in the tile the
  // ghost is standing in rather than all 345 of them. At 60 Hz over a few
  // hundred simulated minutes that difference is the whole soak's runtime.
  const flyBuckets = new Map();
  const bucketKey = (u, v) => `${nav.A(u)},${nav.B(v)}`;
  nav.fireflies.forEach((f, i) => {
    const k = bucketKey(f.u, f.v);
    if (!flyBuckets.has(k)) flyBuckets.set(k, []);
    flyBuckets.get(k).push(i);
  });

  const ghost = { u: 0, v: 0, vu: 0, vv: 0 };
  const heading = { du: 0, dv: -1 };
  const state = {
    time: 0,
    phase: 'ready',        // ready | play | dying | cleared | over
    score: 0,
    lives: T.lives,
    mode: 'scatter',
    modeIndex: 0,
    modeLeft: 0,
    powerUntil: 0,
    power: false,
    eatenChain: 0,
    ghost: { x: 0, z: 0, u: 0, v: 0, vx: 0, vz: 0, speed: 0 },
    fireflies: { total: flyCount, remaining: flyCount, collected },
    powerups: nav.powerups.map((p, i) => ({ index: i, x: 0, z: 0, taken: false })),
    skeletons: [],
    events: [],
  };
  layout.powerups.forEach((p, i) => { state.powerups[i].x = p.x; state.powerups[i].z = p.z; });

  function placeGhost() {
    ghost.u = nav.ghostSpawn.u;
    ghost.v = nav.ghostSpawn.v;
    ghost.vu = 0;
    ghost.vv = 0;
    heading.du = 0;
    heading.dv = -1;
    const fixed = nav.resolveDisc(ghost.u, ghost.v, T.ghostRadius);
    ghost.u = fixed.u;
    ghost.v = fixed.v;
  }

  function startWaves() {
    state.modeIndex = 0;
    state.mode = T.waves[0].mode;
    state.modeLeft = T.waves[0].t;
  }

  function resetRound() {
    placeGhost();
    herd.reset();
    startWaves();
    state.power = false;
    state.powerUntil = 0;
    state.eatenChain = 0;
    state.phase = 'ready';
    state.readyLeft = T.readyPause;
  }
  resetRound();

  function publish() {
    const w = nav.toWorld(ghost.u, ghost.v);
    state.ghost.x = w.x;
    state.ghost.z = w.z;
    state.ghost.u = ghost.u;
    state.ghost.v = ghost.v;
    // The stick is in world axes, so the velocity is too; the grid velocity is
    // the same vector read in the other frame.
    const wv = nav.toWorld(ghost.u + ghost.vu, ghost.v + ghost.vv);
    state.ghost.vx = wv.x - w.x;
    state.ghost.vz = wv.z - w.z;
    state.ghost.speed = Math.hypot(ghost.vu, ghost.vv);
    state.skeletons = herd.list.map((s) => {
      const p = nav.toWorld(s.u, s.v);
      return {
        id: s.id, name: s.name, state: s.state,
        x: p.x, z: p.z, u: s.u, v: s.v,
        speed: s.speed,
        frightened: s.state === 'frightened',
        // Enough for the scene to point the rig without recomputing anything:
        // the direction it is travelling, in world axes.
        yaw: headingYaw(s),
        grave: { x: layout.spawns.graves[s.id % layout.spawns.graves.length].x, z: layout.spawns.graves[s.id % layout.spawns.graves.length].z },
        emergeProgress: s.state === 'emerging' ? 1 - s.timer / EMERGE_TIME : (s.state === 'buried' ? 0 : 1),
      };
    });
    return state;
  }

  function headingYaw(s) {
    if (s.from === -1 || s.to === -1) return 0;
    const a = nav.nodes[s.from];
    const b = nav.nodes[s.to];
    const p = nav.toWorld(a.u, a.v);
    const q = nav.toWorld(b.u, b.v);
    return Math.atan2(q.x - p.x, q.z - p.z);
  }

  function moveGhost(h, input) {
    const desiredU = input.x * T.ghostSpeed;
    const desiredV = input.y * T.ghostSpeed;
    // ghost.js's own integrator, in the grid frame. The stick is in world axes,
    // so it is rotated in first, and the isometry is a rotation so speeds match.
    const dw = nav.toGrid(desiredU, desiredV);
    const blend = 1 - Math.exp(-h / T.ghostAccel);
    ghost.vu += (dw.u - ghost.vu) * blend;
    ghost.vv += (dw.v - ghost.vv) * blend;
    const beforeU = ghost.u;
    const beforeV = ghost.v;
    ghost.u += ghost.vu * h;
    ghost.v += ghost.vv * h;
    const fixed = nav.resolveDisc(ghost.u, ghost.v, T.ghostRadius);
    ghost.u = fixed.u;
    ghost.v = fixed.v;
    // Heading is the direction it ACTUALLY went, not the direction it is being
    // pushed. That matters for the ambusher: a ghost held against a wall is not
    // going where the stick says, and aiming 8 units into a plot would make the
    // ambusher easy to bait.
    const mu = ghost.u - beforeU;
    const mv = ghost.v - beforeV;
    const m = Math.hypot(mu, mv);
    if (m > 1e-5) {
      const k = 1 - Math.exp(-h / 0.15);
      heading.du += (mu / m - heading.du) * k;
      heading.dv += (mv / m - heading.dv) * k;
      const hl = Math.hypot(heading.du, heading.dv);
      if (hl > 1e-6) { heading.du /= hl; heading.dv /= hl; }
    }
  }

  function pickups() {
    const a = nav.A(ghost.u);
    const b = nav.B(ghost.v);
    const r2 = T.pickRadius ** 2;
    for (let bb = b - 1; bb <= b + 1; bb++) {
      for (let aa = a - 1; aa <= a + 1; aa++) {
        const list = flyBuckets.get(`${aa},${bb}`);
        if (!list) continue;
        for (const i of list) {
          if (collected[i]) continue;
          const f = nav.fireflies[i];
          if ((f.u - ghost.u) ** 2 + (f.v - ghost.v) ** 2 > r2) continue;
          collected[i] = 1;
          state.fireflies.remaining--;
          state.score += T.fireflyScore;
          // The renderer's cue. fireflies.js's collect(index) plays the take;
          // the rules only ever say which one.
          state.events.push({ type: 'firefly', index: i });
        }
      }
    }
    const pr2 = T.powerRadius ** 2;
    for (let i = 0; i < nav.powerups.length; i++) {
      if (powerTaken[i]) continue;
      const p = nav.powerups[i];
      if ((p.u - ghost.u) ** 2 + (p.v - ghost.v) ** 2 > pr2) continue;
      powerTaken[i] = 1;
      state.powerups[i].taken = true;
      state.score += T.powerScore;
      state.power = true;
      state.powerUntil = state.time + T.powerTime;
      state.eatenChain = 0;
      herd.frighten();
      state.events.push({ type: 'power', index: i });
    }
  }

  function contacts() {
    const r2 = T.catchRadius ** 2;
    for (const s of herd.list) {
      if (!herd.isSolid(s)) continue;
      if ((s.u - ghost.u) ** 2 + (s.v - ghost.v) ** 2 > r2) continue;
      if (s.state === 'frightened') {
        herd.eat(s);
        const chain = Math.min(state.eatenChain, T.eatScore.length - 1);
        state.score += T.eatScore[chain];
        state.eatenChain++;
        state.events.push({ type: 'eat', skeleton: s.id, score: T.eatScore[chain] });
        continue;
      }
      // Caught.
      state.lives--;
      state.events.push({ type: 'death', skeleton: s.id, by: s.name });
      state.phase = state.lives > 0 ? 'dying' : 'over';
      state.dyingLeft = T.deathPause;
      state.power = false;
      state.powerUntil = 0;
      herd.unfrighten();
      return true;
    }
    return false;
  }

  function advanceModes(h) {
    if (state.power) return;   // the schedule is paused while the lantern burns
    state.modeLeft -= h;
    while (state.modeLeft <= 0 && state.modeIndex < T.waves.length - 1) {
      state.modeIndex++;
      const w = T.waves[state.modeIndex];
      state.mode = w.mode;
      state.modeLeft += w.t;
      // Every skeleton turns round on a mode flip. Pac-Man's rule, and the
      // reason a scatter is legible without being announced.
      herd.reverseAll();
      state.events.push({ type: 'mode', mode: state.mode });
    }
  }

  function ctx() {
    const chaser = herd.list.find((s) => s.name === 'chaser');
    return {
      ghost: { u: ghost.u, v: ghost.v },
      heading,
      chaser: chaser && herd.isSolid(chaser) ? { u: chaser.u, v: chaser.v } : null,
      mode: state.power ? 'chase' : state.mode,
      power: state.power,
      left: state.fireflies.remaining / Math.max(1, state.fireflies.total),
    };
  }

  function substep(h, input) {
    state.time += h;
    if (state.phase === 'ready') {
      state.readyLeft -= h;
      // The graves still count down through the ready beat, so the first
      // skeleton is climbing out as the player takes their first step, which is
      // exactly the shot the scene wants.
      herd.step(h, ctx());
      if (state.readyLeft <= 0) state.phase = 'play';
      return;
    }
    if (state.phase === 'dying') {
      state.dyingLeft -= h;
      if (state.dyingLeft <= 0) resetRound();
      return;
    }
    if (state.phase !== 'play') return;

    if (state.power && state.time >= state.powerUntil) {
      state.power = false;
      state.eatenChain = 0;
      herd.unfrighten();
      state.events.push({ type: 'powerEnd' });
    }
    advanceModes(h);
    moveGhost(h, input);
    herd.step(h, ctx());
    pickups();
    if (state.fireflies.remaining === 0) {
      state.score += T.clearBonus;
      state.phase = 'cleared';
      state.events.push({ type: 'clear' });
      return;
    }
    contacts();
  }

  return {
    nav,
    herd,
    tuning: T,
    state,
    layout,
    update(dt, input) {
      state.events.length = 0;
      let remain = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 5)) : 0;
      const axis = clampAxis(input);
      // A dt is cut so no piece moves anything further than maxStep. That is
      // what makes a backgrounded tab safe: a 3 s catch-up frame becomes 48
      // substeps and nothing passes through a wall in any of them.
      const fastest = Math.max(T.ghostSpeed, T.speeds.eaten, T.speeds.walk * 1.3);
      const cap = T.maxStep / fastest;
      let guard = 0;
      while (remain > 1e-9 && guard++ < 4096) {
        const h = Math.min(remain, cap);
        substep(h, axis);
        remain -= h;
        if (state.phase === 'cleared' || state.phase === 'over') break;
      }
      return publish();
    },
    // Everything a bot or the soak wants and a renderer does not.
    debug: { ghost, heading, collected, powerTaken, T, PERSONALITIES },
  };
}

export default createGame;
