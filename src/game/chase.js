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
// Scatter, the mode schedule and the speeds are all unchanged. Two things had
// to be re-anchored for an endless world and the re-anchoring is described
// where it happens: SCATTER (there are no corners in an infinite plane) and
// THE SPAWN BAND (the marker a skeleton comes back out of has to follow the
// player or the chase runs off the end of the world).
//
// ---------------------------------------------------------------------------
// WHAT WENT WITH THE POWER PELLET
// ---------------------------------------------------------------------------
//
// The frightened flee, the eaten-and-return loop, `speeds.fright`,
// `speeds.eaten`, frighten(), unfrighten() and eat(). All four were reachable
// only from a lit jack-o'-lantern, and the owner has taken the pellet out of
// the game; see rules.js for what that costs. A skeleton now has four states --
// buried, emerging, hunting, sinking -- and the only way one leaves the board
// is the leash or the wedge escape, both of which read as giving up rather than
// as being caught. Nothing in here is dead: what is left is what runs.
//
// ---------------------------------------------------------------------------
// WHERE THEY COME OUT OF, AND WHO DECIDES
// ---------------------------------------------------------------------------
//
// The pen is gone. A skeleton used to come up out of one of four graves the
// level placed by hand; it now comes up in front of any HEADSTONE in the yard.
// See world/spawn.js for what makes a headstone usable.
//
// AND THE HERD NO LONGER DECIDES WHEN. The owner's rule is that a skeleton
// comes out because the PLAYER WALKED PAST A STONE, which is a fact about the
// player and not about the herd, so the decision belongs to rules.js and this
// file only carries it out. What is here is the mechanism:
//
//   dormant   off the board entirely. Not stepped, not drawn, not solid.
//   wake(s, home)   put it in front of that marker and start the climb
//   retire(s)       sink where it stands and go back to dormant
//
// A skeleton used to cycle buried -> emerging -> hunting -> sinking -> buried
// on its own timer, four of them for ever. There is no timer now and no
// automatic return: something above this file asks for each of those
// transitions. `pickSpawn` survives because the herd still has to choose a
// marker when the caller has not named one, which is the "at least one active
// at all times" floor and the leash.

export const EMERGE_TIME = 3.4;   // what perform.js's climb actually takes

export const PERSONALITIES = ['chaser', 'ambusher', 'flanker', 'loner'];

// The skeleton's body, for leg clearance. props/skeleton/metrics.js has it at
// 0.95 across the shoulders.
export const SKEL_RADIUS = 0.475;
// Two clearances, and the difference between them is not fussiness.
//
// PLAN_CLEAR is what a leg is CHOSEN against: a little more than the body, so a
// skeleton does not commit to a line that only just fits. MOVE_CLEAR is what a
// leg is WALKED against, and it is the body itself.
//
// They have to differ or a skeleton deadlocks in a gate. A gate is 2.0 wide, so
// a body standing anywhere but the exact middle of it is within 0.655 of a
// cheek; the planner then says every direction is blocked, the walker refuses
// to move, and the thing stands in the doorway for the rest of the run. That is
// what was happening: the passive player survived a quarter of arenas because
// two skeletons were parked in a gate two units from a fence they had chosen to
// walk through.
const PLAN_CLEAR = SKEL_RADIUS + 0.08;
const MOVE_CLEAR = SKEL_RADIUS;
// How much of a leg's start is forgiven when it is tested. It has to exceed the
// gap between the two clearances, or a skeleton resting exactly on MOVE_CLEAR
// against a wall reads as blocked in every direction. See nav.js's trimStart.
const PLAN_SKIP = 0.75;

// Pac-Man's own corner assignment, as compass directions rather than corners:
// Blinky top right, Pinky top left, Inky bottom right, Clyde bottom left.
const QUARTER = {
  chaser: [1, 1], ambusher: [-1, 1], flanker: [1, -1], loner: [-1, -1],
};

export const DEFAULT_SPEEDS = {
  // 2.49, AND IT IS THE CEILING, spent deliberately and all at once.
  //
  // It was 2.15 for as long as the ghost was 3.05, a nominal ratio of 0.705
  // that rules.js argues at length. The owner has taken the ghost to 3.66 and
  // wants the threat back, and the lever is the herd.
  //
  // WHY THIS IS THE MOST THAT CAN BE SPENT. The skeleton's speed is a CADENCE,
  // not a speed: perform.js drives the walk from distance travelled and
  // STEP_LENGTH is 0.629, so 2.49 is 3.96 steps a second, and about 4.0 is the
  // measured limit before the gait reads as a cartoon scramble rather than a
  // run. DESIGN.md has the measurement. So the whole of the 16% of headroom
  // this axis ever had is now in the base speed.
  //
  // WHY IT IS SPENT NOW rather than kept. It used to be the wave curve's, spent
  // gradually to 2.49 by wave 8. There are no waves; there is nothing left to
  // save it for.
  //
  // AND IT STILL DOES NOT RESTORE THE RATIO. 2.49 against 3.66 is 0.680 against
  // the old 0.705, so even at the ceiling the skeletons are relatively slower
  // than they were and the rest has to come from the steering below. If this
  // number ever has to go higher, the thing to change is STEP_LENGTH or the
  // gait, not this.
  walk: 2.49,
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
  // 3.33, down from 4.0, and it is the STEERING half of answering a faster
  // ghost. A leg is a period of not re-steering and what it is worth to the
  // player is how far they can move during one: at walk 2.15 a 4.0 leg was
  // 1.86 s and the ghost covered 5.67 of it. 3.33 at walk 2.49 is 1.34 s and
  // the ghost covers 4.90, so the juke is 14% tighter than it was rather than
  // merely restored, which is deliberate: the ghost's other advantages, cutting
  // a corner as a disc and the vault, did not shrink when it sped up.
  //
  // This is the number that decides whether the skeletons read as DECIDING or
  // as homing, so it is the first one to put back if they stop feeling like
  // characters. soak.mjs sweeps it.
  legMax: 3.33,
  maxTurn: 100 * Math.PI / 180,
  arrive: 0.30,
  // How far a leg carries PAST a passage. A gate is a thing you go through, not
  // a place you arrive at: a leg that ends exactly at the opening leaves the
  // skeleton standing in it with nowhere it can see to go next.
  through: 1.7,
  // How far a skeleton will walk toward a chosen passage before looking again.
  // A passage can be twenty units away in a thirty unit arena, and committing
  // to the whole trip is far more than Pac-Man commits to: it decides at every
  // junction, which is every two tiles. Capping the commitment means the
  // skeleton usually re-picks the same passage and keeps walking, so the route
  // still reads as purposeful, but it notices when the target comes into view
  // or a better way past opens up. Uncapped, skeletons walked to the far end of
  // a fence and back while the player stood in the middle of the board, and a
  // player who never moved survived a third of arenas.
  commitMax: 8.0,
  // Inside this, a skeleton that can SEE its target may turn as far as it likes
  // to get at it. The no-reversal rule is Pac-Man's and it is worth keeping,
  // but Pac-Man's version forbids turning round in the corridor you are in,
  // which in open ground becomes "may not turn more than a hundred degrees",
  // and that forbids the one turn a monster must always be allowed: the one
  // toward the thing it is chasing when the thing is right there. Without this
  // four skeletons circle a stationary player for ever, each of them with the
  // player just behind its shoulder, and the passive bot survives a quarter of
  // arenas untouched.
  // 8.4, up from 7.0, and the change is arithmetic rather than taste. The
  // number is a distance but what it MEANS is a time: how long the player has
  // between a skeleton being able to turn freely at them and being on them. The
  // ghost crossed 7.0 in 2.30 s at 3.05 and crosses it in 1.91 s at 3.66, so
  // 7.0 x 1.2 puts the same time back.
  pounce: 8.4,
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
  // Scatter is a PATROL and it has to look like one. Pac-Man sends each ghost
  // at a corner outside the board, which it never reaches, so it circles the
  // block of maze nearest that corner for ever. In an open arena there is no
  // block to circle: a skeleton sent at a corner arrives, presses into the
  // wall, and stops. So the scatter target ORBITS its quarter instead, on a
  // circle of this radius with this period, which never arrives for the same
  // reason and reads better, as a thing pacing its own patch of the yard.
  scatterOrbit: 3.2,
  scatterPeriod: 9.0,
  // THE SPAWN BAND. A skeleton going back underground comes up in front of a
  // headstone in this band around the ghost, which is what is left of Pac-Man's
  // pen being in the middle of a small board. 10 is far enough that nothing
  // climbs out on top of the player; 20 is near enough that going under costs
  // the skeleton a return trip and not the rest of the run.
  //
  // The band matters MORE than it did, not less. There were four graves in an
  // arena and the band usually admitted one or two of them, so the pick was
  // nearly forced; there are four to twenty markers now and the band is the
  // only thing standing between the player and a skeleton surfacing at their
  // shoulder. It is the floor of that 10 that is the fairness property, and
  // soak.mjs measures what the change did to the death rate.
  penMin: 10,
  penMax: 20,
  // How long a marker is left alone after something has come out of it. Long
  // enough that the same stone is not used twice running while there is any
  // choice, short enough that a yard with only three markers still works. It is
  // a PREFERENCE and not a rule: when nothing else is in the band the cooldown
  // is ignored, because a skeleton that cannot find a stone is worse than one
  // that reuses a stone.
  spawnCool: 12.0,
  // THE LEASH, which only exists because the world is endless.
  //
  // Pac-Man's board is 28 tiles wide and a ghost cannot get lost on it. Here
  // the ghost travels 850 units in a five minute run and a skeleton that
  // scattered in the wrong direction, or simply lost the race, falls behind for
  // ever: it is out of the game, it is drawn or streamed for nothing, and worse
  // than either, it is navigating against a window of geometry that is centred
  // on the player and no longer contains it, so it will happily walk through a
  // fence nobody loaded. The soak caught that in 24 runs out of 24.
  //
  // So a skeleton this far from the ghost gives up, sinks where it stands, and
  // comes back up in front of a headstone in the spawn band. It reads
  // correctly: a monster that has lost you goes back underground rather than
  // trudging after you for ever.
  //
  // 38 is comfortably inside nav's WINDOW minus its SLACK, which is 54, and
  // comfortably outside the 26 a scatter sends them, so scatter still works.
  leash: 38,
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
      state: 'dormant',
      timer: 0,
      // Seconds this one has been above ground on its current outing, which is
      // what rules.js retires it on.
      upFor: 0,
      x: 0, z: 0,
      // The headstone this one is currently coming out of, re-chosen every time
      // it goes underground. `yaw` is the way the marker faces, which is the
      // way the figure faces as it climbs: out of the plot, with its back to
      // the stone. The renderer reads it straight off this.
      home: { x: 0, z: 0, yaw: 0, id: null },
      hx: 0, hz: -1,             // heading, unit
      stallGuard: 0,
      wedged: 0,
      aimX: 0, aimZ: 0,          // the end of the current leg
      legLeft: 0,                // units of leg not yet walked
      committed: null,           // the passage id it is aiming at, or null
      speed: 0,
      wantReverse: false,
      scatterX: 0, scatterZ: 0,
    });
  }

  // --- where one comes out --------------------------------------------------
  //
  // The only thing in here that TELEPORTS. A skeleton is moved between markers
  // only while it is buried, which is under the ground: nothing is on screen to
  // teleport. Pac-Man does the same thing and calls it reappearing in the pen.
  //
  // WHY THE PICK IS RANDOM, which is the whole design change and not an
  // implementation detail.
  //
  // The old pick was DETERMINISTIC: score every grave by how near the middle of
  // the band it is, take the best. With four graves in an arena that was almost
  // forced -- the band usually held one or two -- so nothing was lost by it. It
  // is a different function with twenty markers in the band: a deterministic
  // best always chooses the same stone, so a player learns one stone and the
  // yard collapses back to a pen with extra steps. Random over the band is the
  // point of the change.
  //
  // WEIGHTED, not uniform. A marker at the far edge of the band is a skeleton
  // that arrives late and a marker at the near edge is one that arrives on top
  // of you, so the weight peaks in the middle of the band and falls to nothing
  // at its edges. Outside the band a marker is only considered when nothing
  // inside it is available at all.
  //
  // AND A COOLDOWN, which answers "can the same stone be used twice". It can,
  // but not while there is anywhere else: a marker something has just come out
  // of is skipped for spawnCool seconds. Without it the same stone comes up
  // twice in a row about as often as a fair die repeats, which reads as the
  // game having favourites rather than as chance.
  //
  // NEAR THE PLAYER OR FAR? Neither, deliberately. The band is the fairness
  // property and preferring the near edge of it or the far one is a difficulty
  // dial in disguise: near is cruel and far is a herd that never arrives. What
  // the band says is "never within ten units", and inside that the yard decides.
  const usedAt = new Map();        // marker id -> the clock it was last used at
  let clock = 0;

  // THREE BUCKETS, AND THE ORDER THEY ARE TRIED IN IS THE WHOLE FALLBACK.
  //
  //   band    in the band, off cooldown, not about to be used by somebody else
  //   spare   in the band but on cooldown, or out of the band
  //   taken   somebody else is coming out of it right now
  //
  // Every preference in here is a PREFERENCE. The cooldown, the band and the
  // "not two at once" rule are all things to have if the yard can afford them,
  // and a skeleton that cannot find a marker is worse than any of them being
  // broken. That has to be said in the structure rather than in a comment,
  // because the first version excluded the avoided markers outright and, in an
  // arena with three of them and four skeletons re-homing together, emptied
  // every bucket and fell through to the last resort. Which put a skeleton
  // inside the perimeter wall, twice in two hundred runs.
  function pickSpawn(ghost, avoid) {
    const marks = nav.near(ghost.x, ghost.z, C.penMax + 8, 'spawns');
    const band = [];
    const spare = [];
    const taken = [];
    const mid = (C.penMin + C.penMax) / 2;
    for (const g of marks) {
      const d = Math.hypot(g.x - ghost.x, g.z - ghost.z);
      const inBand = d >= C.penMin && d <= C.penMax;
      // Weight peaks in the middle of the band and falls to nothing at its
      // edges; outside the band, the nearer the band the better.
      const w = inBand
        ? Math.max(0.05, 1 - Math.abs(d - mid) / ((C.penMax - C.penMin) / 2))
        : 1 / (1 + Math.abs(d - mid));
      if (avoid && avoid.some((a) => Math.hypot(a.x - g.x, a.z - g.z) < 1.5)) taken.push({ g, w });
      else if (inBand && clock - (usedAt.get(g.id) ?? -1e9) >= C.spawnCool) band.push({ g, w });
      else spare.push({ g, w });
    }
    const from = band.length ? band : spare.length ? spare : taken;
    if (from.length) {
      let total = 0;
      for (const e of from) total += e.w;
      let r = rng() * total;
      let hit = from[from.length - 1].g;
      for (const e of from) { r -= e.w; if (r <= 0) { hit = e.g; break; } }
      usedAt.set(hit.id, clock);
      return { x: hit.x, z: hit.z, yaw: hit.yaw || 0, id: hit.id };
    }
    // No marker within reach at all. Only a test harness with an empty spawn
    // list gets here, since audit.js refuses a level with fewer than
    // SPAWN_FLOOR of them, but "only a harness" is what was said about the
    // branch that put a skeleton in the wall. So the point is CLAMPED well
    // inside the arena and then pushed off anything it landed in, and a
    // skeleton that comes out of the ground somewhere arbitrary is at least
    // somewhere it can walk out of.
    const a = rng() * Math.PI * 2;
    let x = ghost.x + Math.cos(a) * mid;
    let z = ghost.z + Math.sin(a) * mid;
    const bb = nav.bounds;
    if (bb) {
      const m = 2.0;
      x = Math.min(Math.max(x, bb.minX + m), bb.maxX - m);
      z = Math.min(Math.max(z, bb.minZ + m), bb.maxZ - m);
    }
    const fixed = nav.resolveWalker(x, z, SKEL_RADIUS);
    return { x: fixed.x, z: fixed.z, yaw: a + Math.PI, id: null };
  }

  // Everything goes away. There is no stagger any more and nothing starts a
  // climb here: an empty yard is the correct opening state, and rules.js's
  // "at least one active" floor puts the first skeleton up on the first frame.
  function reset() {
    usedAt.clear();
    for (const s of list) {
      s.state = 'dormant';
      s.timer = 0;
      s.upFor = 0;
      s.home = { x: 0, z: 0, yaw: 0, id: null };
      s.x = 0;
      s.z = 0;
      s.hx = 0; s.hz = -1;
      s.legLeft = 0;
      s.committed = null;
      s.speed = 0;
      s.wantReverse = false;
      s.gaveUp = false;
    }
  }

  // PUT ONE UP, in front of a named marker or, with none named, in front of
  // whatever pickSpawn likes. `home` is a spawn record from world.spawns().
  function wake(s, home, ghost) {
    const at = home || pickSpawn(ghost, list.filter((o) => o !== s && o.state !== 'dormant').map((o) => o.home));
    s.home = { x: at.x, z: at.z, yaw: at.yaw || 0, id: at.id ?? null };
    if (at.id != null) usedAt.set(at.id, clock);
    s.x = s.home.x;
    s.z = s.home.z;
    s.state = 'emerging';
    s.timer = EMERGE_TIME;
    s.upFor = 0;
    s.legLeft = 0;
    s.committed = null;
    s.speed = 0;
    s.wantReverse = false;
    s.gaveUp = false;
    return s;
  }

  // AND TAKE ONE AWAY. It sinks where it stands, which reads as giving up, and
  // then it is gone rather than waiting underground for its turn.
  function retire(s, gaveUp = false) {
    if (s.state === 'dormant' || s.state === 'sinking') return;
    s.state = 'sinking';
    s.timer = 0.45;
    s.gaveUp = gaveUp;
  }

  // --- the target functions, unchanged ---------------------------------------
  function targetOf(s, ctx) {
    if (ctx.mode === 'scatter') return scatterPoint(s, ctx.time);
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
          ? g : scatterPoint(s, ctx.time);
    }
  }

  function setScatter(s, ghost) {
    const [qx, qz] = QUARTER[s.name];
    const il = 1 / Math.SQRT2;
    let x = ghost.x + qx * il * C.scatterOut;
    let z = ghost.z + qz * il * C.scatterOut;
    const bb = nav.bounds;
    if (bb) {
      // Inside the wall by enough that a body fits, because a scatter anchor
      // outside the arena is an anchor pressed against the wall.
      const m = 3.0;
      x = Math.min(Math.max(x, bb.minX + m), bb.maxX - m);
      z = Math.min(Math.max(z, bb.minZ + m), bb.maxZ - m);
      s.scatterX = x;
      s.scatterZ = z;
      return;
    }
    s.scatterX = x;
    s.scatterZ = z;
  }

  // The orbiting patrol point. Same phase for all four so they stay a quarter
  // apart, which keeps the tie-break order meaningful.
  function scatterPoint(s, t) {
    const a = (t / C.scatterPeriod) * Math.PI * 2;
    return { x: s.scatterX + Math.cos(a) * C.scatterOrbit, z: s.scatterZ + Math.sin(a) * C.scatterOrbit };
  }

  // The leash never fires inside an arena small enough that nothing can get
  // lost in it: giving up when the far corner is 42 units away and the leash is
  // 38 would send a skeleton underground for crossing the board.
  function leashOf() {
    const b = nav.bounds;
    if (!b) return C.leash;
    const diag = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
    return Math.max(C.leash, diag + 2);
  }

  // --- THE ONE DECISION ------------------------------------------------------
  //
  // Called only at the end of a leg. Everything else in this file is
  // bookkeeping around this function.
  function decide(s, ctx) {
    const t = targetOf(s, ctx);
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
    if (nav.visible(s.x, s.z, t.x, t.z, PLAN_CLEAR, PLAN_SKIP)) {
      const dx = t.x - s.x;
      const dz = t.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6 && (free || d <= C.pounce || turnOk(s, dx / d, dz / d))) {
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
      if (!nav.visible(s.x, s.z, p.x, p.z, PLAN_CLEAR, PLAN_SKIP)) continue;
      const score = d + Math.hypot(t.x - p.x, t.z - p.z);
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
      // COMMITMENT. The leg runs all the way to the passage and `through` units
      // out the other side, rather than stopping at legMax, so a skeleton that
      // has decided to go round a fence goes round it instead of changing its
      // mind halfway and pacing. This is where most of the "purposeful" reading
      // comes from, and the overshoot is what carries it out of the doorway.
      return setLeg(s, dx / d, dz / d, Math.min(d + C.through, C.commitMax));
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
    if (!nav.visible(s.x, s.z, s.x + tx * 3, s.z + tz * 3, PLAN_CLEAR, PLAN_SKIP)) { tx = -tx; tz = -tz; }
    return { x: tx, z: tz };
  }

  function speedOf(s, ctx) {
    let v = speeds.walk;
    if (s.name === 'chaser') {
      for (const step of speeds.elroy) if (ctx.lifeTime >= step.after) v = speeds.walk * step.mul;
    }
    return v;
  }

  function stepOne(s, dt, ctx) {
    clock += dt / list.length;      // one shared clock, advanced once per frame
    s.speed = speedOf(s, ctx);
    switch (s.state) {
      case 'dormant':
        return;
      case 'emerging':
        s.timer -= dt;
        if (s.timer <= 0) {
          s.state = 'hunting';
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
        // The straight drop back into the ground, the only time a skeleton is
        // somewhere the chase rules do not apply. It ends DORMANT: nothing
        // brings it back but rules.js asking for it.
        s.timer -= dt;
        if (s.timer <= 0) { s.state = 'dormant'; s.timer = 0; s.gaveUp = false; }
        return;
      default:
        break;
    }

    s.upFor += dt;

    // The leash. Checked before anything moves, so a skeleton that has fallen
    // behind never takes a step against geometry that was not loaded.
    if (Math.hypot(s.x - ctx.ghost.x, s.z - ctx.ghost.z) > leashOf()) {
      retire(s, true);
      return;
    }

    // MOVEMENT IS MOVE THEN RESOLVE, the same model the ghost uses, and the
    // leg is only the STEERING decision. That is a deliberate separation and it
    // was arrived at the hard way.
    //
    // The first version refused to take a step whose swept capsule touched
    // anything, and re-decided instead. It deadlocks, in two ways that both
    // happened: a skeleton standing anywhere but the exact middle of a 2.0 gate
    // is inside the clearance of a cheek, and a skeleton that has walked into a
    // corner is inside the clearance of two walls, and in both cases EVERY
    // direction it considers is blocked and it stands there for the rest of the
    // run. Three of them doing that is why a player who never moved survived a
    // quarter of arenas.
    //
    // Move and resolve cannot deadlock: the resolver pushes out of whatever the
    // step ended inside, the component of the move along a surface survives, and
    // the skeleton slides. It still cannot cross a fence, because a step is 0.036
    // units at the walk and a fence keeps a body 0.825 away, and the substep cap
    // means no single step is ever longer than 0.2.
    let travel = s.speed * dt;
    let guard = 0;
    while (travel > 1e-9 && guard++ < 64) {
      if (s.legLeft <= 1e-9) { decide(s, ctx); if (s.legLeft <= 1e-9) break; }
      const stepLen = Math.min(travel, s.legLeft);
      const fromX = s.x;
      const fromZ = s.z;
      s.x += s.hx * stepLen;
      s.z += s.hz * stepLen;
      const fix = nav.resolveWalker(s.x, s.z, MOVE_CLEAR);
      s.x = fix.x;
      s.z = fix.z;
      const got = Math.hypot(s.x - fromX, s.z - fromZ);
      s.legLeft -= stepLen;
      travel -= stepLen;
      // Sliding along a surface is fine and expected. Getting NOWHERE for a
      // while is not, and the answer is a fresh decision that may turn as far
      // as it likes: the no-reversal rule is flavour and must never be the
      // reason a monster stops working.
      if (got < stepLen * 0.35) s.stallGuard += stepLen;
      else { s.stallGuard = 0; s.wedged = Math.max(0, s.wedged - stepLen); }
      if (s.stallGuard > 0.6) {
        s.stallGuard = 0;
        s.wedged += 0.6;
        s.legLeft = 0;
        s.wantReverse = true;
        decide(s, ctx);
      }
      // THE LAST RESORT. Steering is a heuristic and a heuristic can wedge, and
      // a monster wedged against a fence for the rest of the run is worse than
      // any amount of clumsiness. Past five seconds of getting nowhere it sinks
      // where it stands and climbs out again near the player, which reads in
      // fiction as giving up and puts a hard ceiling on how long a failure of
      // the steering can last. soak.mjs asserts separately that a skeleton never goes nowhere
      // for twelve seconds, so if this starts firing often the steering is
      // broken and this is hiding it.
      if (s.wedged > 5) {
        s.wedged = 0;
        retire(s, true);
        return;
      }
    }
  }

  return {
    list,
    reset,
    wake,
    retire,
    pickSpawn,
    active: (s) => s.state !== 'dormant',
    setScatter,
    step(dt, ctx) { for (const s of list) stepOne(s, dt, ctx); },
    // Every skeleton above ground turns round. Called on a mode flip and on the
    // moment a lantern is lit. The reversal is spent at the next decision, and
    // the leg is cut short so that is immediately.
    reverseAll() {
      for (const s of list) {
        if (s.state !== 'hunting') continue;
        s.wantReverse = true;
        s.legLeft = 0;
      }
    },
    isSolid: (s) => s.state === 'hunting',
    // Everything above ground or on its way there, which is the number
    // rules.js's population cap is about.
    liveCount: () => list.reduce((n, s) => n + (s.state === 'dormant' ? 0 : 1), 0),
    C,
  };
}

export default createHerd;
