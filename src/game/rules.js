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
// Measured, before anything was changed: src/ghost/ghost.js has maxSpeed 4.5
// (the brief said 4.0, and 4.5 is what the file says, which is a discrepancy
// worth someone's attention), and props/skeleton/perform.js has TOP_SPEED 1.25.
// That is a ratio of 0.28. Pac-Man's ghosts run at 0.75 of Pac-Man in the first
// level and 0.95 by the last.
//
// So one number had to move. Both did, and the split between them is the whole
// argument, because the two directions cost completely different things.
//
//   The skeleton's ceiling is CADENCE. perform.js drives the walk from distance
//   travelled, not from time, so the step rate is speed / STEP_LENGTH and
//   STEP_LENGTH is 0.629. Its authored 1.25 is 1.99 steps a second, a walk. To
//   put a 4.5 ghost at 0.75 the skeleton would need 3.375, which is 5.37 steps
//   a second, 322 a minute, faster than a sprinter, and the figure cannot
//   absorb it by lengthening its stride: perform.js says in its own comment
//   that 1.15 legs under a 1.225 hip run out of reach at 0.35 either side and
//   only the heel-off buys the stride it has.
//
//   The ghost's ceiling is FEEL. Everything the cloth does that sells the
//   character, the flare, the lift along the normal, the trail, is driven by
//   velocity through cloth.js, so a ghost at a third speed is not a slower
//   ghost, it is a limp one.
//
// THE MEASUREMENT. soak.mjs has two sweeps and it needs both, because varying
// the ratio by moving the skeleton also moves its cadence and the two cannot
// then be told apart. `--sweep` moves the skeleton at a fixed ghost;
// `--ghostsweep` holds the skeleton at one animatable pace and buys the ratio
// by slowing the ghost down. The second is the one that decided it. Holding the
// skeleton at 2.05 (cadence 3.26/s) and walking the ghost down, 40 levels each,
// three players: the careful bot, the reckless bot, which is the same greedy
// walk with the danger term switched off, and a passive one that never moves.
//
//     ghost  ratio  careful%  deaths  reckless%   threat%
//      4.50   0.46    100.0%    0.17      55.0%     14.8%
//      4.00   0.51     97.5%    0.38      47.5%     16.1%
//      3.60   0.57    100.0%    0.50      25.0%     20.2%
//      3.20   0.64     97.5%    0.57       7.5%     23.4%
//      2.90   0.71     95.0%    0.95       2.5%     24.7%
//      2.70   0.76     92.5%    1.00      12.5%     29.1%
//      2.50   0.82     77.5%    1.23       5.0%     33.0%
//      2.20   0.93     42.5%    2.20       0.0%     37.9%
//
// There is a cliff, and where it sits is the most interesting thing the soak
// found. THIS TABLE IS THE SECOND ONE. The first was measured with a bot that
// steered from graph node to graph node, and it put the cliff between 0.71 and
// 0.76: at 0.76 the careful bot cleared 66.7% of levels rather than 92.5%. The
// bot was the problem, not the ratio. A ghost that aims at the next node takes
// every corner on the corridor's centreline, which is exactly what a skeleton
// does, so a bot built that way silently throws away the one advantage the
// design gives the player and then reports the game as too hard.
//
// Replacing it with a pure-pursuit follower that aims at a point along the
// path, so the disc cuts the inside of a turn, moved the cliff by one and a
// half rows, to somewhere between 0.76 and 0.82. That shift is the cornering
// advantage, measured twice by two completely different methods and agreeing:
// see the table in bot.js, where a ghost on rails runs at 78% of its top speed
// over a random route and a ghost cutting corners at 93 to 97%.
//
// So the design's asymmetry is worth about a fifth of the player's speed, it is
// entirely a matter of how well they drive, and it is what lets this maze carry
// a ratio at all. The maze needs it: 170 nodes and 24 junctions means about
// seven nodes, fourteen units, between one decision and the next, where
// Pac-Man's board offers a junction every two or three tiles. In a long
// corridor there is no juke available. You either outrun the thing behind you
// to the next junction or you do not, and cutting the corner when you get there
// is the whole margin.
//
// THE CHOICE: ghost 3.05, skeleton 2.15, a NOMINAL ratio of 0.705.
//
//   The nominal ratio is not the one the player feels. Measured in play over a
//   full level, the ghost averages 2.86 units a second of its 3.05, because it
//   corners well and almost never has to stop; the skeletons average their full
//   2.15, because a point on an edge always travels at exactly its own speed.
//   So the EFFECTIVE ratio is 2.15 / 2.86 = 0.75 against a player who drives
//   well, and 2.15 / 2.39 = 0.90 against one who takes every corner square.
//   That band, 0.75 to 0.90, is Pac-Man's own 0.75 to 0.95, arrived at from a
//   nominal number that looks nothing like it.
//
//   0.705 rather than 0.76, which the table also allows, because 0.76 costs
//   another 0.18 off the ghost for a difference of two and a half points of
//   clear rate and five of threat, and the ghost's speed is not free.
//
//   Measured at the shipped pair over 500 levels: the careful bot clears 94.0%
//   and loses 0.81 lives a level; a level runs 221 s; the player spends 25.9%
//   of it within 8.0 units of a skeleton and 3.5% within 4.0. The reckless bot,
//   at the same speeds, clears 7.5%. A game where driving well is worth twelve
//   times the clear rate of not bothering is a game with something in it.
//
//   The skeleton goes up 72%, from 1.25 to 2.15, which is 3.42 steps a second,
//   205 a minute. That is a run, not a scramble.
//   The ghost comes down 32%, from 4.5 to 3.05, and accelTime is untouched at
//   0.12, which matters more than the top speed does: the stick still bites in
//   an eighth of a second, so the ghost feels no less connected, only less
//   floaty. It still crosses the 44-unit playfield in 14 s.
//
//   Neither number alone would have done it. Skeleton-only would have needed
//   5.4 steps a second; ghost-only would have needed 1.67 and killed the cloth.
//
// WHAT TO TELL THE ANIMATOR
//
//   1. TOP_SPEED goes 1.25 -> 2.15. The cycle is distance-driven so the cadence
//      follows on its own; expect a run. If it reads as a scramble anyway the
//      fix is STRIDE, not speed: STEP_LENGTH from 0.629 to about 0.78 brings it
//      back to 2.76 steps a second, and the reach comes from a deeper HIP_STALK
//      and more MAX_HEEL, which is what a person does to lengthen their own
//      stride. Do not fix it by slowing the skeleton down. The ratio is load
//      bearing: at 0.57 a player who ignores the skeletons entirely still
//      clears a quarter of levels, and at 0.46 more than half of them.
//   2. The figure is 2.5 units tall and strides 0.629. A person of that height
//      strides about 1.5. It was already mincing at 1.25 and the new speed only
//      makes that visible, so the stride work is worth doing on its own merits.
//   3. Cruise Elroy tops out at 2.49, which is 3.96 steps a second, and that IS
//      the edge. It is one skeleton, at the end of a level, and reading as
//      slightly unhinged is the point of it, but it needs a tell the player can
//      see: a faster jaw chatter and a harder forward lean would do it, because
//      a difficulty change nobody can see is a difficulty change nobody learns.
//   4. Frightened is 1.20, BELOW the authored 1.25, so the flee can play the
//      original walk cycle a touch under pace. Nothing new to animate.
//   5. Eaten is 5.20 and is not a walk at all. It wants its own clip: a heap of
//      bones going home faster than it ever chased anybody.

import { createNav } from './nav.js';
import { createHerd, DEFAULT_SPEEDS, EMERGE_TIME, PERSONALITIES } from './chase.js';

export const TUNING = {
  // --- the two speeds, and see the essay above ------------------------------
  ghostSpeed: 3.05,
  ghostAccel: 0.12,          // ghost.js's own accelTime, untouched
  speeds: DEFAULT_SPEEDS,    // walk 2.15, fright 1.20, eaten 5.20, plus Elroy

  // --- collision ------------------------------------------------------------
  // The ghost is 1.31 across its skirt but the skirt is cloth. 0.55 lets it
  // pass a skeleton in a 2.0 corridor with 0.45 of play either side of the
  // centreline, which is what makes cutting a corner possible at all.
  ghostRadius: 0.55,
  // Bones touching cloth. Ghost 0.55 plus skeleton 0.475 is 1.02 at true
  // contact; 0.85 lets the two overlap slightly before it counts, which is
  // what every arcade game does and what stops a near miss reading as a cheat.
  catchRadius: 0.85,
  // Fireflies sit at 1.0 spacing on the centreline and the ghost is allowed to
  // cut corners, so this has to be wider than the body: hugging the inside of a
  // 90 degree turn puts the ghost 0.86 from the junction firefly, and at 0.80
  // the reward for taking the fast line was silently losing a pellet. 1.0 also
  // means the ghost cannot skip one by moving fast, since the worst lateral
  // offset in a 2.0 corridor is 0.45.
  pickRadius: 1.00,
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
  //   scatter 9, chase 24, scatter 9, chase 28, scatter 7, chase 34,
  //   scatter 5, chase 40, scatter 3, chase 46, scatter 3, then chase for ever.
  //
  // The scatter SHRINKS, 9 to 3, and the chase GROWS, 24 to 46. Pac-Man only
  // does the first of those, because its board is over in a minute; a level
  // here runs 221 s and needs the second as well or the back half has no shape.
  // The last scatter ends at 208 s, so a typical level lives entirely inside
  // the schedule and the permanent chase is what a slow player falls into.
  //
  // 9 s of scatter is 19 units of travel, a plot and a half: enough for a
  // skeleton to visibly leave and for the player to take the corridor it just
  // vacated. 3 s is 6 units, which is a glance away rather than a reprieve, and
  // that is the point of the shrink.
  //
  // Measured against two controls, 40 levels each. Chase for ever: 85.0% clear,
  // 1.20 deaths, 30.9% of the run under threat. Scatter for ever: 97.5% clear,
  // 0.10 deaths, 17.8% threat, and it is not the walkover it sounds, because a
  // patrolling skeleton in a corridor is still a skeleton in a corridor. The
  // shipped schedule sits at 92.5%, 0.85 deaths and 27.3% threat, nearer the
  // relentless end than the restful one, which is where a Pac-Man wants to be.
  waves: [
    { mode: 'scatter', t: 9 }, { mode: 'chase', t: 24 },
    { mode: 'scatter', t: 9 }, { mode: 'chase', t: 28 },
    { mode: 'scatter', t: 7 }, { mode: 'chase', t: 34 },
    { mode: 'scatter', t: 5 }, { mode: 'chase', t: 40 },
    { mode: 'scatter', t: 3 }, { mode: 'chase', t: 46 },
    { mode: 'scatter', t: 3 }, { mode: 'chase', t: Infinity },
  ],

  // --- the power pellet -----------------------------------------------------
  //
  // 10.0 s, and the measurement that picked it is SKELETONS EATEN PER LANTERN,
  // because that is what a power pellet is for. Under one and it is not a
  // reward, over about two and the chase stops rather than reverses. 40 levels
  // at each duration, careful bot:
  //
  //     seconds   per lantern
  //         4        0.21
  //         6        0.58
  //         8        1.04
  //        10        1.39
  //        12        1.76
  //        16        2.25
  //
  // Pac-Man's first level gives 6 s, but its ghosts flee at half speed on a
  // board a third of the width; 6 s here buys 0.53, which is a pellet that
  // mostly does nothing. 10 s is 30.5 units of ghost travel and, against a
  // skeleton fleeing at 1.20, a closing speed of 1.85, so anything within about
  // 18 units is catchable and one and a bit actually gets caught. The bot is
  // not even trying hard: it only diverts to hunt inside a fixed range, so 1.39
  // is a floor on what a player who commits will get.
  //
  // Note what a caught skeleton costs beyond the window: it runs home at 5.20
  // and then climbs out over 3.4 s, so eating one removes it for eight to ten
  // seconds AFTER the lantern goes out. That is the real reward and it is why
  // the window does not need to be longer.
  //
  // The mode schedule is PAUSED while a lantern burns, which is Pac-Man's own
  // behaviour and matters here: a 10 s window that ate into a 3 s late scatter
  // would delete the reprieve rather than add to it.
  powerTime: 10.0,
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

  const graveWorld = herd.list.map((s) => {
    const g = layout.spawns.graves[s.id % layout.spawns.graves.length];
    return { x: g.x, z: g.z };
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
    // One object per skeleton, filled in place every frame rather than rebuilt:
    // the soak runs tens of millions of frames and a fresh array of objects
    // each one is most of its garbage.
    skeletons: [],
    events: [],
    // Declared here so the shape of `state` never changes, which matters to
    // anything reading it in a hot loop.
    readyLeft: 0,
    dyingLeft: 0,
  };
  // `input.jump` is deliberately ignored. ghost.js's hop is vertical only: it
  // does not move the ghost in x or z and it does not lift it over anything, so
  // to the rules it is a piece of character animation and nothing else. If a
  // hop is ever meant to dodge a skeleton, that is a rule and it belongs here.
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
    for (let i = 0; i < herd.list.length; i++) {
      const s = herd.list[i];
      const p = nav.toWorld(s.u, s.v);
      const out = state.skeletons[i] || (state.skeletons[i] = {
        id: s.id, name: s.name, grave: graveWorld[i],
      });
      out.state = s.state;
      out.x = p.x;
      out.z = p.z;
      out.u = s.u;
      out.v = s.v;
      out.speed = s.speed;
      out.frightened = s.state === 'frightened';
      // Enough for the scene to point the rig without recomputing anything.
      out.yaw = headingYaw(s);
      // 0 to 1 through the 3.4 s climb, so the scene can scrub perform.js's
      // emerge rather than run its own timer and drift out of step with this.
      out.emergeProgress = s.state === 'emerging' ? 1 - s.timer / EMERGE_TIME
        : s.state === 'buried' ? 0 : 1;
    }
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
