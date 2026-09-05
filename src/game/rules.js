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
// ===========================================================================
// THE POWER PELLET IS GONE, AND WHAT THAT COSTS
// ===========================================================================
//
// The lit jack-o'-lantern was Pac-Man's power pellet: four to an arena, ten
// seconds of frightened skeletons, 200/400/800/1600 for eating them, and the
// mode schedule paused while it burned. The owner has taken it out. What went
// with it, in this file, is `powerTime`, `powerScore`, `powerRadius`,
// `eatScore`, `state.power`, `state.powerUntil`, `state.eatenChain`, the
// `powerups` pickup list and the two events 'power' and 'powerEnd'; in
// chase.js, the frightened flee, the eaten-and-return loop and two speeds.
//
// WHAT THE GAME LOSES, stated plainly rather than left to be discovered.
//
// The pellet was the only move in the game that let a cornered player turn on
// the chasers. Without it every single encounter is avoidance: there is no
// state in which walking towards a skeleton is correct, no reason to save
// anything for later, and nothing the player can do about being cornered except
// not be cornered. Three specific things follow.
//
//   1. THE CORNER IS NOW TERMINAL. A player pinned between a fence and two
//      skeletons had one out, which was to have left a lantern within reach.
//      They now have the jump, which rule 4 above deliberately makes useless as
//      an escape. The design's answer to "what do I do when it goes wrong" is
//      currently "you die", and that is a real answer, it is just a harsher
//      game than the one that was measured.
//   2. THE SCORE LOSES ITS TOP END. Eating four skeletons on one lantern paid
//      3000 plus the lantern's 500, which is thirty fireflies, so a run's
//      ceiling was set by how well the player used them. The ceiling is now the
//      streak alone, and a leaderboard on a single mechanic is a flatter one.
//   3. THERE IS NO PAUSE. The pellet stopped the mode schedule while it burned,
//      so a run had a rhythm: chase, ten seconds of the board belonging to the
//      player, chase. The schedule now runs unbroken from ready to death, and
//      past 208 s it is permanent chase with Cruise Elroy wound up on top.
//
// Every one of those may be what the owner wants -- a pure evasion game is a
// coherent thing to build, and it is the game the jump was designed for. It
// should be a decision and not a side effect, which is why it is written here.
//
// BRINGING IT BACK is four constants, one pickup loop, one contact branch and
// two functions on the herd, and every one of them is named in the paragraph
// above. Nothing was renamed or restructured to make room, so the diff that
// removed it reverses cleanly.

import { createNav } from './nav.js';
import { createHerd, DEFAULT_SPEEDS, DEFAULT_CHASE, EMERGE_TIME, PERSONALITIES, SKEL_RADIUS } from './chase.js';

export const TUNING = {
  // --- the two speeds, and see the essay above ------------------------------
  //
  // 3.66, which is 3.05 plus the owner's twenty per cent. The nominal ratio
  // against the skeleton's 2.15 goes from 0.705 to 0.587, and that is a big
  // move: soak.mjs measures what it does to the chase and the report says so.
  // The skeleton's speed is NOT compensated, because the owner asked for a
  // faster ghost and not for a faster game.
  ghostSpeed: 3.66,
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

  // --- THE FIREFLIES, SIX AT A TIME AND FOR EVER ----------------------------
  //
  // The owner's rule: six on the map, and when one is left five more appear.
  // So the board cycles 6, 5, 4, 3, 2, 1, 6, and the run has no end in it.
  // That replaces "an arena holds five and can be CLEARED", which is where the
  // 'cleared' phase and the clear bonus went.
  //
  // WHERE THE FIVE COME FROM. The level's own firefly spots first: an author
  // placed them, or fireflies.js placed them by rule, and either way they are
  // spread for the measured spacing DESIGN.md argues for and are known to be
  // reachable. A spot within `flyNear` of the player at the moment of the
  // refill is SKIPPED and comes back on the next cycle, so the refill cannot
  // drop one in the player's lap. Only when that leaves too few does the
  // sampler below invent a position.
  flyOnBoard: 6,
  flyRefillAt: 1,
  flyNear: 10.0,
  flyApart: 9.0,

  // --- THE HERD, AND HOW IT GROWS -------------------------------------------
  //
  // A skeleton comes out because the PLAYER WALKED PAST A TOMBSTONE. That is
  // the owner's rule and it is the whole spawn mechanic; there is no schedule
  // and no pen. What is here is the shape of it.
  //
  //   spawnRange   how near counts as passing by. 5.0 is about a second and a
  //                half of running at the new speed, and it is wide enough
  //                that the stone that produced the skeleton is unmistakably
  //                the one you just walked past, which is the whole point:
  //                the player has to learn to fear the stones.
  //   spawnMin     and how near is too near. A skeleton must never break the
  //                surface inside the player. The figure is 0.95 across and
  //                the ghost 1.10, so anything past about 1.1 is not a
  //                collision; 2.0 is that with room, and it is also the
  //                distance at which the climb is legibly a separate object.
  //   spawnChance  at full readiness, per stone passed. Not every stone, which
  //                is the owner's "but not all the time".
  //   spawnPeriod  and readiness is time since the last one came up, over
  //                this. So the chance is ZERO immediately after a spawn and
  //                climbs back to spawnChance over nine seconds. That is the
  //                answer to "the probability should not be flat": a flat
  //                chance lets an unlucky player walk past three stones in two
  //                seconds and meet three skeletons, which is a death nobody
  //                could have played around.
  //   spawnQuiet   and a stone that has just produced one is quiet for this
  //                long, so pacing back and forth past one stone does not
  //                farm it.
  //
  // THE POPULATION. One at all times, five at the most, and the clock is
  // FIREFLIES COLLECTED because it is the only progress an endless run has.
  // One more allowed every `skelPerFly` collected, so the fifth arrives at 24,
  // which at the measured collection rate is a few minutes in.
  //
  // AND THEY LEAVE. A skeleton that has been up for `retireAfter` seconds
  // burrows back, unless it is the last one. This is a design decision and it
  // is the one worth arguing with: if they never left, the population would
  // climb to five and stay, "gradually more" would be a one-way ramp, and the
  // proximity mechanic would stop mattering the moment the cap was reached.
  // With them leaving, the count breathes, walking past a stone is a live
  // decision for the whole run, and the cap is a ceiling on how bad it can get
  // rather than a description of the late game.
  skelMax: 5,
  skelPerFly: 6,
  spawnRange: 5.0,
  spawnMin: 2.0,
  spawnChance: 0.55,
  spawnPeriod: 9.0,
  spawnQuiet: 12.0,
  retireAfter: 34.0,

  // --- scoring --------------------------------------------------------------
  fireflyScore: 100,
  streakStep: 5,
  streakCap: 8,
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
  // FIVE SLOTS, always, however many are up. `skeletons` used to be how many
  // were in the game; it is now the ceiling on how many may be, and the
  // director below decides how many of the slots are filled at any moment.
  const herd = createHerd({
    nav, count: Math.max(1, Math.min(skeletons, T.skelMax)), seed, speeds: T.speeds, chase: T.chase,
  });

  // A local stream, for the spawn rolls. Named rather than shared so that
  // changing how often a skeleton comes out does not resequence the herd's own
  // decisions, which is the same argument rng.js makes about the generator.
  const rng = (() => {
    let a = ((seed * 2654435761) ^ 0x5f356495) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  // THE RUN IS ENDLESS AND THE ARENA CANNOT BE CLEARED. There was a 'cleared'
  // phase here, and a clear bonus, and above this a wave machine that started
  // the next arena when the last firefly went. The owner has replaced all of it
  // with one rule: six fireflies, five more when one is left, until something
  // catches you. So the only ways a run ends are the last life and the player
  // stopping.
  const bounds = world.bounds || null;

  const ghost = {
    x: world.spawn.x, z: world.spawn.z,
    vx: 0, vz: 0,
    air: false, airT: 0, airY: 0, airVX: 0, airVZ: 0,
    cool: 0,
  };
  const heading = { x: 0, z: -1 };

  const state = {
    time: 0,
    phase: 'ready',          // ready | play | dying | over. Nothing clears.
    score: 0,
    lives: T.lives,
    mode: 'scatter',
    modeIndex: 0,
    modeLeft: 0,
    // How many are on the board and how many the board holds when it is full.
    // `flyRemaining` counts down 6, 5, 4, 3, 2, 1 and then goes back to 6; it
    // is not a countdown to anything, because there is nothing to count down
    // to any more.
    flyTotal: 0,
    flyRemaining: 0,
    // How many skeletons are up, and how many are allowed to be. The cap
    // climbs with `collected`; see TUNING.
    skeletons: [],
    skeletonsUp: 0,
    skeletonCap: 1,
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
    events: [],
    readyLeft: 0,
    dyingLeft: 0,
  };

  // --- THE FIREFLIES, and the cycle that never ends -------------------------
  //
  // The board holds `flyOnBoard` and refills to it the moment `flyRefillAt` are
  // left. The list is the RULES' now rather than the world's: the world's
  // fireflies used to be the level's own fixed five and the rules only
  // remembered which had been taken, which is a fine model for a board that can
  // be cleared and no model at all for one that refills for ever.
  //
  // THE SPOTS ARE STILL THE LEVEL'S. `world.fireflies()` is a pool of authored
  // or rule-placed positions, spread for the spacing DESIGN.md measured and
  // known to be reachable, and the refill draws from it. Only when the pool
  // cannot supply enough does `inventSpot` make one up.
  const pool = (bounds ? world.fireflies(bounds) : world.fireflies()).map((f) => ({ x: f.x, z: f.z }));
  let flySeq = 0;
  let flyPool = [];

  // The director's own memory, declared up here because resetRound clears it
  // and resetRound runs before anything else does.
  const quiet = new Map();     // marker id -> the clock it may next produce one
  const inRing = new Set();    // markers the ghost is inside the ring of, now
  let lastSpawn = -1e9;

  // Somewhere a firefly can be picked up from: the ghost's own disc has to fit,
  // because a firefly the player can see and cannot reach is worse than no
  // firefly. Reachability needs no flood: audit.js's wedge rule is the standing
  // proof that every place a body fits in a passing level is a place a body
  // could have walked to, which is exactly the question and is why that rule
  // exists.
  const canStand = (x, z) => nav.discClear(x, z, T.ghostRadius + 0.05);

  function inventSpot(avoid) {
    const b = bounds || {
      minX: ghost.x - 20, maxX: ghost.x + 20, minZ: ghost.z - 20, maxZ: ghost.z + 20,
    };
    const m = 2.5;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 400; i++) {
      const x = b.minX + m + rng() * Math.max(0.1, b.maxX - b.minX - 2 * m);
      const z = b.minZ + m + rng() * Math.max(0.1, b.maxZ - b.minZ - 2 * m);
      if (!canStand(x, z)) continue;
      let score = Math.hypot(x - ghost.x, z - ghost.z);
      for (const o of avoid) score = Math.min(score, Math.hypot(x - o.x, z - o.z));
      if (score > bestScore) { bestScore = score; best = { x, z }; }
      if (bestScore >= T.flyApart) break;
    }
    return best;
  }

  // Top the board back up. A pool spot within `flyNear` of the player is
  // skipped rather than used, so a refill never drops one at the player's feet;
  // it comes back on the next cycle, when they are somewhere else.
  function refillFlies() {
    const avoid = () => [{ x: ghost.x, z: ghost.z }, ...flyPool];
    const lit = new Set(flyPool.map((f) => `${f.sx},${f.sz}`));
    const spots = pool
      .filter((p) => !lit.has(`${p.x},${p.z}`))
      .filter((p) => Math.hypot(p.x - ghost.x, p.z - ghost.z) >= T.flyNear && canStand(p.x, p.z))
      // Furthest from the player first, so a partial refill is the good half.
      .sort((a, c) => Math.hypot(c.x - ghost.x, c.z - ghost.z) - Math.hypot(a.x - ghost.x, a.z - ghost.z));
    let guard = 0;
    while (flyPool.length < T.flyOnBoard && guard++ < 64) {
      const p = spots.shift() || inventSpot(avoid());
      if (!p) break;
      flyPool.push({ id: `fly/${flySeq++}`, x: p.x, z: p.z, sx: p.x, sz: p.z });
    }
    state.fireflies = flyPool;
    state.flyRemaining = flyPool.length;
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
  // comes back up in front of headstones in the spawn band around wherever the
  // ghost now is.
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
    // THE BOARD SURVIVES A DEATH and the herd does not. Losing a life costs
    // the streak, which is most of the score, and it should not also cost the
    // five fireflies you were halfway through: an endless run has no other
    // progress in it. The herd goes back to one, which is the mercy the mode
    // schedule's restart used to be.
    herd.reset();
    startWaves();
    state.lifeTime = 0;
    state.streak = 0;
    state.multiplier = 1;
    state.phase = 'ready';
    state.readyLeft = T.readyPause;
    state.flyTotal = T.flyOnBoard;
    quiet.clear();
    inRing.clear();
    lastSpawn = -1e9;
    refillFlies();
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
    state.skeletonsUp = herd.liveCount();
    for (let i = 0; i < herd.list.length; i++) {
      const s = herd.list[i];
      const out = state.skeletons[i]
        || (state.skeletons[i] = { id: s.id, name: s.name, home: { x: 0, z: 0, yaw: 0, id: null } });
      out.state = s.state;
      out.x = s.x;
      out.z = s.z;
      // The marker it is coming out of, and the way that marker faces. The
      // renderer puts the figure there and turns it, so a skeleton climbs out
      // with its back to the stone: see world/spawn.js.
      out.home.x = s.home.x;
      out.home.z = s.home.z;
      out.home.yaw = s.home.yaw;
      out.home.id = s.home.id;
      out.speed = s.speed;
      out.yaw = Math.atan2(s.hx, s.hz);
      out.emergeProgress = s.state === 'emerging' ? 1 - s.timer / EMERGE_TIME
        : s.state === 'dormant' ? 0 : 1;
      // Nothing is drawn for a dormant one and nothing collides with it.
      out.live = s.state !== 'dormant';
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
    // The arena's perimeter wall. Tall on purpose, and the one barrier in the
    // game the jump does not answer.
    if (nav.crossesWall(ghost.x, ghost.z, lx, lz, 0)) {
      state.events.push({ type: 'jumpRefused', why: 'wall' });
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
      flyPool.splice(i, 1);
      state.collected++;
      state.flyRemaining = flyPool.length;
      state.streak++;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      state.multiplier = Math.min(T.streakCap, 1 + Math.floor(state.streak / T.streakStep));
      const paid = T.fireflyScore * state.multiplier;
      state.score += paid;
      state.events.push({ type: 'firefly', id: f.id, x: f.x, z: f.z, score: paid, multiplier: state.multiplier });
    }
    if (flyPool.length <= T.flyRefillAt) {
      const before = flyPool.length;
      refillFlies();
      if (flyPool.length > before) {
        state.events.push({ type: 'fireflies', added: flyPool.length - before, onBoard: flyPool.length });
      }
    }
    state.fireflies = flyPool;
    state.flyRemaining = flyPool.length;
  }

  // --- THE SPAWN DIRECTOR ----------------------------------------------------
  //
  // Everything about WHEN a skeleton comes out. chase.js owns what one does
  // once it is up and world/spawn.js owns which headstones can produce one;
  // this is the third piece and it is the owner's rule, which is that the
  // player walking past a tombstone is what causes a spawn.
  //
  // Read the TUNING block above for the numbers and the reasoning. What is
  // worth saying beside the code is the ORDER, because it is load bearing:
  // retire first, then roll, then force. Rolling before retiring would let the
  // cap be full of skeletons that are about to leave; forcing before rolling
  // would put one up at a stone the player is nowhere near while they are
  // standing next to one.
  function wakeAt(mark) {
    const slot = herd.list.find((k) => k.state === 'dormant');
    if (!slot) return false;
    herd.wake(slot, mark, ghost);
    if (mark && mark.id != null) quiet.set(mark.id, state.time + T.spawnQuiet);
    lastSpawn = state.time;
    state.events.push({
      type: 'spawn',
      skeleton: slot.id,
      name: slot.name,
      // The stone it came out of, so the renderer can make the cause visible.
      // A spawn the player cannot attribute to the stone they just passed is
      // the mechanic failing to teach itself.
      stone: mark ? mark.stone ?? mark.id : null,
      forced: !mark,
      x: slot.x,
      z: slot.z,
    });
    return true;
  }

  function direct() {
    state.skeletonCap = Math.min(T.skelMax, 1 + Math.floor(state.collected / T.skelPerFly));

    // 1. The long-serving go back down, but never the last one.
    if (herd.liveCount() > 1) {
      for (const s of herd.list) {
        if (s.state === 'hunting' && s.upFor > T.retireAfter) { herd.retire(s); break; }
      }
    }

    // 2. Passing a stone. One roll per stone per pass, on the frame the ghost
    //    crosses into its ring, so walking a circle round one stone is one
    //    roll and not sixty a second.
    const near = nav.near(ghost.x, ghost.z, T.spawnRange + 2, 'spawns');
    const now = new Set();
    for (const m of near) {
      const d = Math.hypot(m.x - ghost.x, m.z - ghost.z);
      if (d > T.spawnRange) continue;
      now.add(m.id);
      if (inRing.has(m.id)) continue;
      if (d < T.spawnMin) continue;
      if (herd.liveCount() >= state.skeletonCap) continue;
      if ((quiet.get(m.id) ?? -1e9) > state.time) continue;
      const readiness = Math.min(1, Math.max(0, (state.time - lastSpawn) / T.spawnPeriod));
      if (rng() < T.spawnChance * readiness) wakeAt(m);
    }
    inRing.clear();
    for (const id of now) inRing.add(id);

    // 3. The floor. Nothing is up, so something has to be, and it comes up
    //    where chase.js's own band puts it: ten to twenty units away, weighted
    //    to the middle. Not the nearest stone, which would be a spawn on top of
    //    a player who has just been caught, and not the furthest, which is a
    //    skeleton that takes twenty seconds to become a threat.
    if (herd.liveCount() === 0) wakeAt(null);
    state.skeletonsUp = herd.liveCount();
  }

  function contacts() {
    // Rule 4: no airborne exemption. The test is horizontal and the ghost's
    // height above the ground is not in it.
    const r2 = T.catchRadius ** 2;
    for (const s of herd.list) {
      if (!herd.isSolid(s)) continue;
      if ((s.x - ghost.x) ** 2 + (s.z - ghost.z) ** 2 > r2) continue;
      state.lives--;
      state.events.push({ type: 'death', skeleton: s.id, by: s.name, streak: state.streak });
      state.phase = state.lives > 0 ? 'dying' : 'over';
      state.dyingLeft = T.deathPause;
      return true;
    }
    return false;
  }

  function advanceModes(h) {
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
      mode: state.mode,
      lifeTime: state.lifeTime,
      time: state.time,
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
    advanceModes(h);
    if (input.jump) tryJump();
    moveGhost(h, input);
    direct();
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
      const fastest = Math.max(T.ghostSpeed, T.speeds.walk * 1.3);
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
    debug: { ghost, heading, T, PERSONALITIES, SKEL_RADIUS },
  };
}

export default createGame;
