// createGame: the rules half of the graveyard.
//
//   import { createWorld } from './world/index.js';   // or ../refworld.mjs
//   import { createGame } from './rules.js';
//   const game = createGame({ world: createWorld({ seed: 7 }) });
//   const state = game.update(dt, { x, y, jump });
//
// `input` is the axis object src/ghost/input.js already produces: a stick, x
// and y each in -1 to 1 in WORLD axes, plus `jump`, a one-frame edge. The ghost
// here integrates the stick with the same model ghost.js uses, an exponential
// approach to input * maxSpeed with a 0.12 s time constant, so a ratio measured
// in this file is a ratio the player will actually feel.
//
// Nothing here imports three, builds a mesh or touches a canvas. The renderer
// reads `state` and plays animations; it is never asked a question.
//
// ===========================================================================
// THE JUMP, which is now the whole game
// ===========================================================================
//
// The old version of this file ignored `input.jump` and said so in a comment:
// the hop was vertical, it lifted the ghost over nothing, and to the rules it
// was character animation. That is what changed. A jump now carries the ghost
// over a fence, and a skeleton has to walk round to a gate, and that asymmetry
// replaces Pac-Man's cornering asymmetry as the thing the game is about.
//
// THE MODEL, stated in full, because a jump that is vague is a jump that is
// argued about later:
//
//   1. A jump is a BALLISTIC LEAP ALONG THE CURRENT VELOCITY. Horizontal
//      velocity is frozen at the instant of takeoff and the stick is ignored
//      until landing. There is no air control at all.
//
//   2. It lasts 0.50 s and carries the ghost `speed * 0.50` units, which at the
//      top speed of 3.05 is 1.53. That is enough to clear a fence and its posts
//      with room and not enough to clear anything else.
//
//   3. It NEEDS A RUN AT IT. Takeoff is refused below `jumpMinSpeed` 2.0 units
//      a second, measured along the direction of travel. From a standing start
//      the ghost reaches 2.0 in 0.13 s, so in open ground the requirement costs
//      nothing; where it bites is exactly where it should, a ghost pinned
//      against the fence it wants to cross with no room to build pace into it.
//
//   4. THE GHOST IS CATCHABLE IN THE AIR. No invulnerability, no i-frames, the
//      same catch radius on the same horizontal distance. This is the most
//      important rule in the model and it is what stops a jump being a dodge.
//      A jump that is also a dodge makes the fence irrelevant: you would jump
//      to escape rather than to cross, and the interesting play, leading a
//      skeleton to the wrong side of a fence, would never happen because
//      nobody would need it.
//
//      Rules 1, 3 and 4 are three independent reasons a jump is not an escape.
//      Jumping next to a skeleton is strictly worse than steering: you give up
//      the steering, you keep the hitbox, and you commit half a second.
//
//   5. IN THE AIR IT IGNORES BARRIERS AND NOTHING ELSE. A fence is 0.86 tall
//      and the ghost hops it. A vault, a boulder or a headstone is not, and the
//      ghost's disc still resolves against every solid prop while airborne.
//
//   6. THE LANDING IS CHECKED AT TAKEOFF, not on the way down. At the instant
//      the jump is requested the rules compute the landing point, which is a
//      pure function of position, frozen velocity and air time, and refuse the
//      whole jump if the ghost's disc will not fit there or if a prop stands in
//      the flight path. A landing rolled back in mid-air is a teleport, and the
//      ghost's cloth solves in world space, so it may never be teleported. A
//      refusal publishes `jumpRefused` so the renderer can play a stumble
//      rather than nothing.
//
//   7. There is a `jumpCooldown` of 0.35 s after landing, which stops a lattice
//      of fences being crossed as a chain of vaults with no ground contact.
//
//   8. A jump costs nothing in SPEED. `landDrag` is 1.0 and is here as a dial
//      rather than as a tax, because the cost of a jump ought to be situational
//      and not a toll: crossing a fence should be free when nothing is near you
//      and expensive when something is. soak.mjs measures whether that holds
//      and reports what happens when it does not.
//
// WHAT I CHANGED IN ghost.js'S OWN NUMBERS, AND WHY
//
// ghost.js hops with an initial 3.6 up against 9.0 down, which is an apex of
// 0.72 and an air time of 0.80 s. 0.80 s is the number that had to move. It is
// a HOVER, authored as character before it meant anything, and as a game action
// it is 2.4 units of committed travel at top speed, which overshoots any fence
// and lands the ghost somewhere it did not choose. It also makes a jump feel
// like a decision taken and then waited out.
//
//   up 3.6 -> 5.0, gravity 9.0 -> 20.0.
//   air time 0.80 -> 0.50 s. Apex 0.72 -> 0.625.
//
// The arc is almost the same height and happens in five eighths of the time: a
// vault rather than a float. That is deliberately the cheapest possible change
// to the shipped free-roam scene, because the apex is what you SEE and the air
// time is what you FEEL, and only the second one was wrong. It is still your
// decision whether to take it into the free-roam scene; if you do not, the
// rules and ghost.js will disagree about how long the ghost is off the ground
// and the renderer will pop.
//
// ===========================================================================
// SPEED, unchanged, and why the redirection did not invalidate it
// ===========================================================================
//
// ghost 3.05, skeleton 2.15, a nominal ratio of 0.705. That was measured, and
// the argument behind it is worth repeating in one paragraph because it is the
// thing most likely to be second-guessed now that the maze is gone.
//
// The skeleton's ceiling is CADENCE: perform.js drives the walk from distance
// travelled and STEP_LENGTH is 0.629, so 2.15 is 3.42 steps a second, a run.
// The ghost's ceiling is FEEL: everything the cloth does is driven by velocity,
// so a slow ghost is not a slower ghost, it is a limp one. The nominal 0.705
// was measured as an effective 0.75 against a player who drives well and 0.90
// against one who does not, and that band is Pac-Man's own.
//
// None of that measurement was about the maze. It was about cornering, and
// cornering still exists: a disc cutting the inside of a turn round a headstone
// is the same advantage it was round a corridor corner. What HAS changed is
// that the corner-cutting advantage is now smaller, because open ground has
// fewer corners, and the jump is the new advantage that replaces the part of it
// that went away. soak.mjs re-measures both.
//
// ===========================================================================
// SCORING, repriced for one firefly per screen
// ===========================================================================
//
// A firefly worth 10 points when there are 345 of them is not the same object
// as a firefly worth 10 points when there is one on screen. The old level paid
// about 3450 for a sweep that took 221 s, so good play was worth about 15.6
// points a second. At a spacing of 18 units a ghost travelling well reaches one
// about every 8 to 10 s including the detour, so a firefly has to pay about 130
// to hold that rate. It pays 100, and the rest comes from the STREAK.
//
// THE STREAK is the answer to "two runs of the same length should not score the
// same". Every firefly collected without dying adds one; the multiplier is
// 1 + floor(streak / 5), capped at 8; a death puts it back to zero. So the
// twenty-sixth firefly of a clean life is worth 600 and the first one after a
// death is worth 100, and a run's score is dominated by its longest clean
// stretch rather than by its duration. That is a leaderboard with something on
// it: length alone is a flat distribution, and length times cleanliness is not.
// soak.mjs prints the distribution rather than asserting it is good.
//
// A lantern pays 500 because it is now one of the few things worth deliberately
// travelling to, and eating a frightened skeleton keeps Pac-Man's doubling.

import { createNav } from './nav.js';
import { createHerd, DEFAULT_SPEEDS, DEFAULT_CHASE, EMERGE_TIME, PERSONALITIES, SKEL_RADIUS } from './chase.js';

export const TUNING = {
  // --- the two speeds, and see the essay above ------------------------------
  ghostSpeed: 3.05,
  ghostAccel: 0.12,
  speeds: DEFAULT_SPEEDS,
  chase: DEFAULT_CHASE,

  // --- the jump -------------------------------------------------------------
  jumpUp: 5.0,             // ghost.js's airV, was 3.6
  jumpGravity: 20.0,       // ghost.js's gravity, was 9.0
  jumpMinSpeed: 2.0,       // the run-up. See rule 3.
  jumpCooldown: 0.35,
  landDrag: 1.0,           // see rule 8. A dial, not a tax, until measured.

  // --- collision ------------------------------------------------------------
  ghostRadius: 0.55,
  catchRadius: 0.85,
  // A firefly is a destination now rather than something you sweep up in
  // passing, so the pick radius no longer has to forgive a corner cut. It is
  // still generous because arriving at a thing and not taking it is the worst
  // feeling a pickup can produce.
  pickRadius: 1.00,
  powerRadius: 1.10,

  // --- the mode schedule, unchanged -----------------------------------------
  //
  // scatter 9, chase 24, scatter 9, chase 28, scatter 7, chase 34, scatter 5,
  // chase 40, scatter 3, chase 46, scatter 3, then chase for ever. The scatter
  // SHRINKS and the chase GROWS, and in an endless run the tail of it is the
  // difficulty curve: past 208 s a life is permanent chase, and Cruise Elroy
  // has wound the chaser up by then as well. The schedule restarts on a death,
  // which is Pac-Man's own behaviour and is the only mercy in the design.
  waves: [
    { mode: 'scatter', t: 9 }, { mode: 'chase', t: 24 },
    { mode: 'scatter', t: 9 }, { mode: 'chase', t: 28 },
    { mode: 'scatter', t: 7 }, { mode: 'chase', t: 34 },
    { mode: 'scatter', t: 5 }, { mode: 'chase', t: 40 },
    { mode: 'scatter', t: 3 }, { mode: 'chase', t: 46 },
    { mode: 'scatter', t: 3 }, { mode: 'chase', t: Infinity },
  ],

  // --- the power pellet -----------------------------------------------------
  // 10.0 s, picked on skeletons eaten per lantern. Re-measured against the new
  // spacing in soak.mjs, because a lantern forty units away is a different
  // object from one four units away.
  powerTime: 10.0,
  eatScore: [200, 400, 800, 1600],
  fireflyScore: 100,
  streakStep: 5,
  streakCap: 8,
  powerScore: 500,

  lives: 3,
  deathPause: 1.6,
  readyPause: 1.8,

  // How far around the ghost the rules publish pickups for the renderer and
  // the bot. Independent of nav's own window and of whatever the renderer
  // chooses to instantiate.
  publishRange: 44,

  maxStep: 0.20,
};

function clampAxis(input) {
  let x = Number.isFinite(input?.x) ? input.x : 0;
  let y = Number.isFinite(input?.y) ? input.y : 0;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y, jump: !!input?.jump };
}

export function createGame({ world, seed = 1, tuning = {}, skeletons = 4 } = {}) {
  const T = {
    ...TUNING,
    ...tuning,
    speeds: { ...TUNING.speeds, ...(tuning.speeds || {}) },
    chase: { ...TUNING.chase, ...(tuning.chase || {}) },
  };
  // The air time is DERIVED from ghost.js's two numbers rather than stated
  // beside them, so the rules and the renderer can never disagree about it.
  const airTime = (2 * T.jumpUp) / T.jumpGravity;

  const nav = createNav(world);
  const herd = createHerd({ nav, count: Math.max(1, skeletons), seed, speeds: T.speeds, chase: T.chase });

  // Taken pickups, by the world's own stable id. A ten minute run collects
  // perhaps sixty fireflies, so this stays small; if a run ever gets long
  // enough for it to matter, it is prunable by distance from the ghost, since
  // the world outside the window is not published.
  const takenFly = new Set();
  const takenPower = new Set();

  const ghost = {
    x: world.spawn.x, z: world.spawn.z,
    vx: 0, vz: 0,
    air: false, airT: 0, airY: 0, airVX: 0, airVZ: 0,
    cool: 0,
  };
  const heading = { x: 0, z: -1 };

  const state = {
    time: 0,
    phase: 'ready',          // ready | play | dying | over. There is no
                             // 'cleared': nothing clears in an endless world.
    score: 0,
    lives: T.lives,
    mode: 'scatter',
    modeIndex: 0,
    modeLeft: 0,
    powerUntil: 0,
    power: false,
    eatenChain: 0,
    // The endless-run numbers. `lifeTime` drives Cruise Elroy; `streak` and
    // `multiplier` drive the score; `distance` is the other half of a
    // leaderboard row.
    lifeTime: 0,
    streak: 0,
    multiplier: 1,
    bestStreak: 0,
    distance: 0,
    collected: 0,
    ghost: {
      x: 0, z: 0, vx: 0, vz: 0, speed: 0,
      // The renderer drives the hop off these three rather than running its
      // own timer, so the arc on screen is the arc the rules used.
      airborne: false, airY: 0, airProgress: 0,
      canJump: true,
    },
    // Live pickups within publishRange, rebuilt as the ghost moves. The
    // renderer instantiates from these lists and the ids are the world's, so a
    // firefly that leaves the list and comes back is the same firefly.
    fireflies: [],
    powerups: [],
    skeletons: [],
    events: [],
    readyLeft: 0,
    dyingLeft: 0,
  };

  // --- the published pickup lists -------------------------------------------
  let pubX = NaN;
  let pubZ = NaN;
  let flyPool = [];
  let powerPool = [];
  function refreshPickups(force) {
    if (!force && Math.hypot(ghost.x - pubX, ghost.z - pubZ) < 8) return;
    pubX = ghost.x;
    pubZ = ghost.z;
    const r = T.publishRange;
    flyPool = nav.near(pubX, pubZ, r, 'fireflies').filter((f) => !takenFly.has(f.id));
    powerPool = nav.near(pubX, pubZ, r, 'powerups').filter((p) => !takenPower.has(p.id));
    state.fireflies = flyPool;
    state.powerups = powerPool;
  }

  function startWaves() {
    state.modeIndex = 0;
    state.mode = T.waves[0].mode;
    state.modeLeft = T.waves[0].t;
    for (const s of herd.list) herd.setScatter(s, ghost);
  }

  // A death does NOT move the ghost. In an endless world there is nowhere to
  // put it back to, and the cloth solves in world space so it may not be
  // teleported anyway. What resets is the herd, which goes underground and
  // re-homes to graves in the pen band around wherever the ghost now is.
  function resetRound() {
    ghost.vx = 0;
    ghost.vz = 0;
    ghost.air = false;
    ghost.airT = 0;
    ghost.airY = 0;
    ghost.cool = 0;
    nav.focus(ghost.x, ghost.z);
    const fixed = nav.resolveDisc(ghost.x, ghost.z, T.ghostRadius);
    ghost.x = fixed.x;
    ghost.z = fixed.z;
    herd.reset(ghost);
    startWaves();
    state.power = false;
    state.powerUntil = 0;
    state.eatenChain = 0;
    state.lifeTime = 0;
    state.streak = 0;
    state.multiplier = 1;
    state.phase = 'ready';
    state.readyLeft = T.readyPause;
    refreshPickups(true);
  }
  resetRound();

  function publish() {
    state.ghost.x = ghost.x;
    state.ghost.z = ghost.z;
    state.ghost.vx = ghost.air ? ghost.airVX : ghost.vx;
    state.ghost.vz = ghost.air ? ghost.airVZ : ghost.vz;
    state.ghost.speed = Math.hypot(state.ghost.vx, state.ghost.vz);
    state.ghost.airborne = ghost.air;
    state.ghost.airY = ghost.airY;
    state.ghost.airProgress = ghost.air ? 1 - ghost.airT / airTime : 0;
    state.ghost.canJump = !ghost.air && ghost.cool <= 0 && state.ghost.speed >= T.jumpMinSpeed;
    for (let i = 0; i < herd.list.length; i++) {
      const s = herd.list[i];
      const out = state.skeletons[i] || (state.skeletons[i] = { id: s.id, name: s.name, grave: { x: 0, z: 0 } });
      out.state = s.state;
      out.x = s.x;
      out.z = s.z;
      out.grave.x = s.grave.x;
      out.grave.z = s.grave.z;
      out.speed = s.speed;
      out.frightened = s.state === 'frightened';
      out.yaw = Math.atan2(s.hx, s.hz);
      out.emergeProgress = s.state === 'emerging' ? 1 - s.timer / EMERGE_TIME
        : s.state === 'buried' ? 0 : 1;
    }
    return state;
  }

  // --- the jump --------------------------------------------------------------

  function tryJump() {
    if (ghost.air || ghost.cool > 0) return false;
    const sp = Math.hypot(ghost.vx, ghost.vz);
    if (sp < T.jumpMinSpeed) {
      state.events.push({ type: 'jumpRefused', why: 'noRunUp' });
      return false;
    }
    const lx = ghost.x + ghost.vx * airTime;
    const lz = ghost.z + ghost.vz * airTime;
    // Rule 6: the landing is decided here and never revisited. The flight path
    // must be clear of props, since props are solid in the air, and the landing
    // point must hold the ghost's disc on the ground.
    if (nav.crossesProp(ghost.x, ghost.z, lx, lz, T.ghostRadius) || !nav.discClear(lx, lz, T.ghostRadius)) {
      state.events.push({ type: 'jumpRefused', why: 'noLanding' });
      return false;
    }
    ghost.air = true;
    ghost.airT = airTime;
    ghost.airY = 0;
    ghost.airVX = ghost.vx;
    ghost.airVZ = ghost.vz;
    // Did it actually clear a fence? Only the event cares, but the event is how
    // the soak counts vaults and how the renderer knows to play the good one.
    const over = nav.crossesBarrier(ghost.x, ghost.z, lx, lz, 0);
    state.events.push({ type: 'jump', overFence: over, x: ghost.x, z: ghost.z, toX: lx, toZ: lz });
    return true;
  }

  function moveGhost(h, input) {
    if (ghost.air) {
      // No air control at all. The velocity is the one it took off with.
      const t = airTime - ghost.airT;
      ghost.airY = T.jumpUp * t - 0.5 * T.jumpGravity * t * t;
      const bx = ghost.x;
      const bz = ghost.z;
      ghost.x += ghost.airVX * h;
      ghost.z += ghost.airVZ * h;
      // Props only: rule 5.
      const fixed = nav.resolveDisc(ghost.x, ghost.z, T.ghostRadius, true);
      ghost.x = fixed.x;
      ghost.z = fixed.z;
      state.distance += Math.hypot(ghost.x - bx, ghost.z - bz);
      ghost.airT -= h;
      if (ghost.airT <= 0) {
        ghost.air = false;
        ghost.airY = 0;
        ghost.airT = 0;
        ghost.cool = T.jumpCooldown;
        ghost.vx = ghost.airVX * T.landDrag;
        ghost.vz = ghost.airVZ * T.landDrag;
        // Belt and braces. The takeoff test said this point was clear; if the
        // window was rebuilt mid-flight and it is not, push out rather than
        // stand in a fence.
        const land = nav.resolveDisc(ghost.x, ghost.z, T.ghostRadius);
        ghost.x = land.x;
        ghost.z = land.z;
        state.events.push({ type: 'land', x: ghost.x, z: ghost.z });
      }
      return;
    }

    ghost.cool -= h;
    const desiredX = input.x * T.ghostSpeed;
    const desiredZ = input.y * T.ghostSpeed;
    const blend = 1 - Math.exp(-h / T.ghostAccel);
    ghost.vx += (desiredX - ghost.vx) * blend;
    ghost.vz += (desiredZ - ghost.vz) * blend;
    const beforeX = ghost.x;
    const beforeZ = ghost.z;
    ghost.x += ghost.vx * h;
    ghost.z += ghost.vz * h;
    const fixed = nav.resolveDisc(ghost.x, ghost.z, T.ghostRadius);
    ghost.x = fixed.x;
    ghost.z = fixed.z;
    const mx = ghost.x - beforeX;
    const mz = ghost.z - beforeZ;
    const m = Math.hypot(mx, mz);
    state.distance += m;
    // Heading is the direction it ACTUALLY went, not the direction it is being
    // pushed, which matters for the ambusher: a ghost held against a fence is
    // not going where the stick says.
    if (m > 1e-5) {
      const k = 1 - Math.exp(-h / 0.15);
      heading.x += (mx / m - heading.x) * k;
      heading.z += (mz / m - heading.z) * k;
      const hl = Math.hypot(heading.x, heading.z);
      if (hl > 1e-6) { heading.x /= hl; heading.z /= hl; }
    }
  }

  function pickups() {
    const r2 = T.pickRadius ** 2;
    for (let i = flyPool.length - 1; i >= 0; i--) {
      const f = flyPool[i];
      if ((f.x - ghost.x) ** 2 + (f.z - ghost.z) ** 2 > r2) continue;
      takenFly.add(f.id);
      flyPool.splice(i, 1);
      state.collected++;
      state.streak++;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      state.multiplier = Math.min(T.streakCap, 1 + Math.floor(state.streak / T.streakStep));
      const paid = T.fireflyScore * state.multiplier;
      state.score += paid;
      state.events.push({ type: 'firefly', id: f.id, x: f.x, z: f.z, score: paid, multiplier: state.multiplier });
    }
    const pr2 = T.powerRadius ** 2;
    for (let i = powerPool.length - 1; i >= 0; i--) {
      const p = powerPool[i];
      if ((p.x - ghost.x) ** 2 + (p.z - ghost.z) ** 2 > pr2) continue;
      takenPower.add(p.id);
      powerPool.splice(i, 1);
      state.score += T.powerScore;
      state.power = true;
      state.powerUntil = state.time + T.powerTime;
      state.eatenChain = 0;
      herd.frighten();
      state.events.push({ type: 'power', id: p.id, x: p.x, z: p.z });
    }
  }

  function contacts() {
    // Rule 4: no airborne exemption. The test is horizontal and the ghost's
    // height above the ground is not in it.
    const r2 = T.catchRadius ** 2;
    for (const s of herd.list) {
      if (!herd.isSolid(s)) continue;
      if ((s.x - ghost.x) ** 2 + (s.z - ghost.z) ** 2 > r2) continue;
      if (s.state === 'frightened') {
        herd.eat(s);
        const chain = Math.min(state.eatenChain, T.eatScore.length - 1);
        state.score += T.eatScore[chain];
        state.eatenChain++;
        state.events.push({ type: 'eat', skeleton: s.id, score: T.eatScore[chain] });
        continue;
      }
      state.lives--;
      state.events.push({ type: 'death', skeleton: s.id, by: s.name, streak: state.streak });
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
      // Scatter is re-anchored to where the ghost is NOW, so a skeleton leaves
      // from wherever the chase had got to rather than walking at a corner of a
      // board that does not exist.
      if (w.mode === 'scatter') for (const s of herd.list) herd.setScatter(s, ghost);
      herd.reverseAll();
      state.events.push({ type: 'mode', mode: state.mode });
    }
  }

  function ctx() {
    const chaser = herd.list.find((s) => s.name === 'chaser');
    return {
      ghost,
      heading,
      chaser: chaser && herd.isSolid(chaser) ? chaser : null,
      mode: state.power ? 'chase' : state.mode,
      power: state.power,
      lifeTime: state.lifeTime,
    };
  }

  function substep(h, input) {
    state.time += h;
    nav.focus(ghost.x, ghost.z);
    if (state.phase === 'ready') {
      state.readyLeft -= h;
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

    state.lifeTime += h;
    if (state.power && state.time >= state.powerUntil) {
      state.power = false;
      state.eatenChain = 0;
      herd.unfrighten();
      state.events.push({ type: 'powerEnd' });
    }
    advanceModes(h);
    if (input.jump) tryJump();
    moveGhost(h, input);
    refreshPickups(false);
    herd.step(h, ctx());
    pickups();
    contacts();
  }

  return {
    nav,
    herd,
    world,
    tuning: T,
    airTime,
    state,
    update(dt, input) {
      state.events.length = 0;
      let remain = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 5)) : 0;
      const axis = clampAxis(input);
      const fastest = Math.max(T.ghostSpeed, T.speeds.eaten, T.speeds.walk * 1.3);
      const cap = T.maxStep / fastest;
      let guard = 0;
      // The jump edge belongs to the first substep only, or one press across a
      // three second catch-up frame would be forty-eight jumps.
      let jumpEdge = axis.jump;
      while (remain > 1e-9 && guard++ < 4096) {
        const h = Math.min(remain, cap);
        substep(h, { x: axis.x, y: axis.y, jump: jumpEdge });
        jumpEdge = false;
        remain -= h;
        if (state.phase === 'over') break;
      }
      return publish();
    },
    debug: { ghost, heading, takenFly, takenPower, T, PERSONALITIES, SKEL_RADIUS },
  };
}

export default createGame;
