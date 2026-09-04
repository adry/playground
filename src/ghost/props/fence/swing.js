// Swing physics for the garden gate. An angle in, an angle out.
//
// This file knows nothing about what a gate looks like, the same split that
// motion.js uses for the skeleton: the model file owns geometry and reads
// `swing.angle` every frame, this file owns the motion. Nothing here imports
// gate.js and nothing here should ever need to.
//
// The rule from the ghost holds. Secondary motion is SIMULATED and follows
// from primary motion. The ghost shoves the gate, the gate does what a gate
// does; nobody keyframes it open and nobody eases it shut.
//
// A GATE IS A PENDULUM, and that is the whole design. The restoring torque is
// gravity acting on the leaf's own weight about a hinge that is not quite
// plumb, so it goes as sin(angle), not as the angle. Everything a viewer reads
// as "real" follows from that one term: a wide swing takes measurably longer
// than a narrow one, so the gate CHANGES ITS RHYTHM as it gives up amplitude.
// A linear spring holds its period no matter how hard it was hit, which is
// exactly the tell that makes a spring-driven door read as an animation.
//
// Measured against the exact pendulum, undamped, at the defaults (T0 = 1.4192s
// for g/L = 9.8/0.5):
//
//     amplitude   this file    exact       T/T0
//     0.20 rad    1.4210s      1.4228s     1.0012
//     0.40 rad    1.4325s      1.4336s     1.0094
//     0.70 rad    1.4635s      1.4640s     1.0312
//     1.00 rad    1.5130s      1.5133s     1.0661
//     1.40 rad    1.6155s      1.6151s     1.1383
//
// The gate in its frame changes rhythm harder than that, and in the other
// direction, which surprised me and is worth writing down. Its stop is not at
// the bottom of the arc, it is `latchAngle` up the side of it, so a leaf that
// is barely opening is not swinging about its equilibrium at all -- it is
// being thrown up a slope of nearly constant gravity and coming back, and that
// is ballistic, not harmonic. Ballistic flight time goes as the launch speed,
// so as the bounces die the gaps between the bangs get SHORTER fast: measured
// stop-to-stop, 0.63  0.58  0.50  0.41  0.32  0.23 seconds. That accelerating
// patter is the sound of a dropped ball settling, and it is the single
// most convincing thing the gate does. It falls out of the geometry; nothing
// here asks for it.

// --- which way does it swing --------------------------------------------------
//
// Two real gates, and this file does both, because the fence's gate and the
// contract's gate turned out to be different gates and each was right about
// itself. The mode is a property of how the leaf is HUNG, not a preference.
//
//   stop: 'frame'  (default)  A LEAF HUNG IN A FRAME OPENS ONE WAY. The frame
//     is behind it: it stops dead on the closing side and is free only on the
//     opening side, so the whole travel is on one hand of plumb, given by
//     `direction`. `latchAngle` is where the frame is. The leaf is a hair
//     narrower than the opening, so its closing edge meets the stop just before
//     it is plumb; below `latchAngle` the leaf would be inside the frame, which
//     is solid. That is where the collision happens and where it comes to rest,
//     held shut by the sin(latchAngle) of gravity torque still left at that
//     angle. Pass latchAngle: 0 and it degenerates cleanly to a stop exactly on
//     plumb, with the hinge friction below doing the holding instead.
//
//   stop: 'none'              A DOUBLE-ACTING GATE, hung so the leaf clears
//     both posts through its whole arc and swings a quarter turn either way.
//     There is no stop at plumb because there is nothing there to hit, so the
//     leaf swings straight through and out the other side, and damping alone is
//     what brings it down. This is the gate in gate.js, which pays 82mm of gap
//     between post and leaf precisely to buy the symmetry, and it is why this
//     mode exists rather than being an argument about which gate is realer.
//     `latchAngle` still means what it says -- inside it the leaf is in the
//     posts' shadow -- but it is a fact to READ (see `latched`) rather than a
//     surface to hit, so the model can drop the latch bar when it is home.
//
//     THIS MODE WANTS MORE `damping` THAN THE DEFAULT, and it is worth saying
//     loudly because the default is silently wrong for it. A framed gate loses
//     most of its energy to the stop: it gives up 55% of what it has left at
//     each of seven strikes. Take the stop away and damping is the only loss
//     there is at all, so the same 0.6 leaves a
//     free pendulum ringing at more than two degrees for fifteen seconds and
//     not retiring for twenty-three. It is not unstable and it is not wrong,
//     it just reads as a metronome rather than as a gate. Watched side by side,
//     2.0 is the number: it opens to 26 degrees, is under two degrees by 4.7s
//     and retires at 7.3s. 1.5 gives 9.4s if the gate should feel lighter.
//
// The choice changes only where the surfaces are. The integrator, the damping,
// the settle and the far stops are the same code either way.
//
// Everything is expressed as two hard limits, `lo` and `hi`, and one settle
// point between or on them. That is what the first version got wrong: it
// carried a signed "openness" and a `dir` through every test, which read fine
// for the one-way gate and could not express a two-way one at all without a
// second copy of the collision code.

// --- damping ------------------------------------------------------------------
//
// One dial, three mechanisms, because a gate does not decay exponentially and
// a single viscous term is what makes physics read as syrup. Each is a
// fraction of `damping`, so one number still tunes the character.
//
//   VISCOUS   linear in speed. Hinge grease and the general loss.
//   AIR       quadratic in speed. A gate leaf is a flat plate broadside to its
//             own travel, and a plate's drag goes as v^2. This is the term
//             that makes the decay stop being an exponential. A purely viscous
//             gate loses the same FRACTION of its amplitude every swing, at any
//             amplitude, forever -- an exponential envelope drawn over the
//             motion. Measured on the shipped numbers with the stop made
//             lossless, so the ratios below are damping alone: the first, big
//             swing gives up 26% of its amplitude and the seventh gives up 12%
//             (0.737  0.786  0.817  0.839  0.855  0.867  0.877, climbing toward
//             the viscous asymptote as the leaf slows). The same file with AIR
//             and HINGE zeroed prints 0.960 0.960 0.961 0.961 0.961 0.961 0.961
//             instead, which is what an exponential envelope IS. A big shove
//             dies back fast and then the gate rings on quietly, which is what
//             air actually does and what an envelope cannot fake.
//             AIR was 0.25 against VISCOUS 0.45 in the first tuning, which had
//             the right settle time and a ratio spread of four points across
//             the whole run. Correct physics, invisible. The split was moved
//             most of the way onto the quadratic term to get a spread worth
//             looking at, and the settle time was kept by taking it out of the
//             linear term rather than by changing `damping`.
//   HINGE     constant torque opposing motion, whichever way it is going, i.e.
//             dry friction in a rusty pin. This is the one that makes the gate
//             actually STOP. Viscous and quadratic damping are both
//             proportional to speed, so they only ever approach zero
//             asymptotically and the leaf trembles forever at the millidegree
//             level. Coulomb friction removes a fixed amount of speed per
//             second, reaches zero in finite time, and then holds: below
//             asin(mu * L / g) of plumb the friction beats gravity outright
//             and the leaf sticks. At the default that stiction band is 0.05
//             degrees wide, well under the clearance the leaf rests in anyway,
//             so it is never visible -- but it is what guarantees the numbers
//             actually reach zero rather than 1e-9. The settle tolerance below
//             is sized off this band, so a leaf that stalls anywhere inside it
//             still counts as home and still retires.
const VISCOUS = 0.18;  // per second
const AIR = 0.60;      // per radian
const HINGE = 0.03;    // rad/s^2

// --- the stop ------------------------------------------------------------------
// Below this closing speed the bounce is dropped and the leaf is simply shut.
// A rebound from 0.22 rad/s reaches half a degree, which nobody can see, and
// reflecting a rebound smaller than that forever is exactly the jitter that
// makes a collision look cheap. No value of restitution avoids it; the fix is
// a floor on the speed. Same argument as MIN_BOUNCE in the skeleton's debris.
const MIN_BOUNCE = 0.22;   // rad/s

// --- sleep ---------------------------------------------------------------------
const REST_SPEED = 0.05;   // rad/s, slow enough to be resting rather than moving
// How far off the settle point still counts as home. This is a FLOOR, not the
// value: the real tolerance is computed per gate, because it has to contain the
// stiction band, and the band is asin(mu / w0^2) which grows with `damping` and
// shrinks with gravity over length. A fixed 2e-3 was right for the default gate
// and quietly wrong for a stiffer one: at damping 3 in the double-acting mode
// the band is 4.6e-3, dry friction parks the leaf a quarter of a degree off
// plumb, the leaf is genuinely at rest and atRest stayed false forever. A gate
// that never retires is the one failure this file is not allowed to have, so
// the tolerance follows the friction. On a metre-wide leaf the floor is 2mm at
// the far edge and the default gate uses exactly that.
const REST_GAP = 2e-3;     // rad, floor on the settle tolerance
const STICTION_MARGIN = 1.5;   // how much of the band to clear, comfortably
const SLEEP_TIME = 0.1;    // seconds of that before the gate retires

// --- stepping -------------------------------------------------------------------
// The main loop clamps dt to 1/20, so one call can be 50ms, and a 50ms step is
// where a naive pendulum dies. Explicit Euler on this system gains energy at
// EVERY step size, because the position update uses the OLD velocity and that
// error is systematically in the direction that adds energy. The same undamped
// pendulum, pushed to 0.74 rad, integrated for 400 seconds:
//
//     explicit Euler   dt 1/20   over the top at 4.1s    |angle| ends at 68000
//     explicit Euler   dt 1/60   over the top at 10.2s   |angle| ends at 13000
//     explicit Euler   dt 1/240  over the top at 40.6s   |angle| ends at 509
//     semi-implicit    dt 1/20   never                   |angle| ends at 0.744
//     semi-implicit    dt 1/60   never                   |angle| ends at 0.740
//     semi-implicit    dt 1/240  never                   |angle| ends at 0.740
//
// Worth reading the explicit rows twice: substepping does not rescue it, it
// only postpones it. The scheme is wrong, not the step size. Semi-implicit
// puts the position update after the velocity update, which makes it
// symplectic, and its energy error is then bounded and oscillatory rather than
// growing -- that is the 0.744 sitting still for four hundred seconds.
//
// Symplectic alone would be enough to pass a stability test and still be wrong
// to ship at one step per frame, for the reason the Spring's comment gives:
// the same gate would read as a slightly different gate on a slow machine,
// because the phase error per step goes as (w*dt)^2 and at 50ms that is a 4%
// error on the period. So the inner step is fixed at 1/240 and the frame is
// chopped into as many of those as it takes. At 1/20 that is twelve substeps
// of arithmetic on two floats, which is nothing, and it buys agreement across
// frame rates: 1/144, 1/60 and 1/20 put the peak of every one of the seven
// arcs within 0.0036 rad (0.2 degrees) of each other and come to rest within
// 0.042s of each other.
const MAX_STEP = 1 / 240;
// 32 substeps is a 133ms frame. Past that the substep is NOT stretched to cover
// the rest of the frame, it stays at MAX_STEP and the gate simply advances less
// than real time. Stretching it is what the skeleton's debris does and it is
// right there, where a huge dt only costs some accuracy; here it is not, because
// this is an oscillator and semi-implicit Euler has a hard stability limit at
// w0*h = 2. Dividing a 60 second frame (a laptop lid, a debugger breakpoint)
// into 32 steps puts w0*h at 8 and the gate goes chaotic before the far stop
// catches it. Dropping the surplus time instead means the worst a monstrous
// frame can do is make the gate look like it swung in slow motion for one
// frame, which nobody will ever see because the main loop clamps dt to 1/20
// long before this matters.
const MAX_SUBSTEPS = 32;

export function createSwing({
  restAngle = 0,          // plumb. Where gravity is pulling the leaf.
  latchAngle = 0.06,      // below this the leaf is inside the frame
  gravity = 9.8,
  length = 0.5,           // effective pendulum length, metres
  damping = 0.6,          // air and hinge friction, one dial for all three terms
  bounce = 0.45,          // ENERGY kept when it strikes a stop
  stop = 'frame',         // 'frame' = one-way, stops shut. 'none' = double-acting.
  direction = 1,          // 'frame' only. +1: the leaf opens toward increasing angle
  // How far it can open before the leaf is up against the fence or the post.
  // A real stop on a real gate, and also the hard guarantee that nothing can
  // ever go over the top of its own arc, whatever impulse arrives.
  maxAngle = Math.PI / 2,
} = {}) {
  const dir = direction < 0 ? -1 : 1;
  const framed = stop !== 'none';
  const latch = Math.max(latchAngle, 0);
  const far = Math.max(Math.abs(maxAngle), latch);

  // `bounce` is the fraction of ENERGY kept, so the speed coming out of a
  // strike is sqrt(bounce) of the speed going in. Reading it as a coefficient
  // of restitution instead (multiplying the velocity by 0.45) is the same
  // number meaning something roughly four times as lossy, and it is the single
  // tuning mistake that cost this file the most. Same push, same damping, the
  // only difference being how the 0.45 is read:
  //
  //     velocity  4 arcs, shut at 2.11s, peaks 0.574 0.176 0.052 0.012
  //     energy    7 arcs, shut at 3.46s, peaks 0.574 0.278 0.144 0.075 0.038
  //                                            0.018 0.009
  //
  // The first is three thuds and a gate that has stopped. The second is a gate
  // swinging. Watching the two side by side is what settled it; the numbers
  // alone would have let either one through.
  const restitution = Math.sqrt(Math.max(0, bounce));

  // Angular frequency squared of the small-angle swing. w0 = sqrt(g/L), so the
  // default gate has a 1.42s natural period, which is about right for a light
  // leaf on a short effective radius. Longer `length` is a heavier, lazier gate.
  const w2 = gravity / Math.max(length, 1e-4);

  // The two surfaces, and the angle it ends up at. A framed gate is bounded by
  // its own stop on one side and the fence on the other; a double-acting one
  // has only the fence, on both sides, and settles on plumb.
  const lo = framed && dir > 0 ? restAngle + latch : restAngle - far;
  const hi = framed && dir < 0 ? restAngle - latch : restAngle + far;
  const settle = framed ? (dir > 0 ? lo : hi) : restAngle;

  const cLin = Math.max(damping, 0) * VISCOUS;
  const cQuad = Math.max(damping, 0) * AIR;
  const cDry = Math.max(damping, 0) * HINGE;
  // See REST_GAP. sin(band) = cDry / w2 is where dry friction beats gravity, so
  // anything inside it is a place the leaf can legitimately stop.
  const restGap = Math.max(REST_GAP, (STICTION_MARGIN * cDry) / w2);

  let angle = settle;
  let velocity = 0;
  let asleep = true;
  let still = 0;

  // exp() is the expensive part of a substep and h almost never changes, so the
  // linear drag factor is cached the same way the Spring caches its transition.
  let lastH = -1;
  let linDecay = 1;

  // Reflect off whichever limit was crossed. The distance travelled past the
  // surface inside this substep is the distance the leaf would have travelled
  // coming back out, scaled by the restitution; clamping to the surface instead
  // throws that away and makes every bounce read a substep late.
  //
  // Below MIN_BOUNCE the rebound is dropped and the leaf is simply put on the
  // surface, velocity zero. Reflecting a rebound smaller than half a degree
  // forever is exactly the jitter that makes a collision look cheap, and no
  // value of restitution avoids it: the fix is a floor on the speed.
  function resolveStops() {
    if (angle < lo || (angle <= lo && velocity < 0)) {
      if (-velocity > MIN_BOUNCE) {
        angle = lo + (lo - angle) * restitution;
        velocity = -velocity * restitution;
      } else {
        angle = lo;
        velocity = 0;
      }
    } else if (angle > hi || (angle >= hi && velocity > 0)) {
      if (velocity > MIN_BOUNCE) {
        angle = hi - (angle - hi) * restitution;
        velocity = -velocity * restitution;
      } else {
        angle = hi;
        velocity = 0;
      }
    }
  }

  function substep(h) {
    if (h !== lastH) {
      lastH = h;
      linDecay = Math.exp(-cLin * h);
    }

    // 1. Gravity, kicked first. sin(), not the angle: this is the term that
    //    makes a wide swing slower than a narrow one, and it is most of what
    //    "realistic" means for a swinging gate.
    velocity -= w2 * Math.sin(angle - restAngle) * h;

    // 2. Linear drag, in closed form. dv/dt = -c*v integrates exactly to a
    //    decaying exponential, so this is unconditionally stable at any h and
    //    costs one cached multiply.
    velocity *= linDecay;

    // 3. Quadratic drag, also in closed form. dv/dt = -k*v*|v| integrates to
    //    v / (1 + k*|v|*h) exactly, which is worth doing rather than stepping:
    //    explicit v^2 drag at a large step can overshoot through zero and hand
    //    the leaf back a push in the direction it was already travelling, which
    //    is a drag term that ACCELERATES. This form cannot, because the divisor
    //    is always at least 1.
    velocity /= 1 + cQuad * Math.abs(velocity) * h;

    // 4. Dry hinge friction. Take a fixed bite out of the speed and stop at
    //    zero rather than pushing through it, which is what makes it stiction
    //    rather than a negative-resistance oscillator.
    const bite = cDry * h;
    velocity = velocity > bite ? velocity - bite : velocity < -bite ? velocity + bite : 0;

    // 5. Position last, using the velocity we just computed. This is the whole
    //    of what makes it semi-implicit, and the whole of why it does not gain
    //    energy. Every one of steps 2 to 4 is a contraction of |v|, so the only
    //    thing that can ever ADD energy is the symplectic gravity kick, and a
    //    symplectic kick cannot add it secularly.
    angle += velocity * h;

    resolveStops();
  }

  return {
    get angle() { return angle; },
    get velocity() { return velocity; },
    get atRest() { return asleep; },

    // Where the leaf sits when it is shut, and the two surfaces it can hit.
    // The model needs `closedAngle` to align its closed pose with the physics,
    // and it is NOT always `restAngle`: a framed gate rests against its stop,
    // `latchAngle` off plumb.
    get closedAngle() { return settle; },
    get limits() { return { min: lo, max: hi }; },

    // Is the leaf inside the posts' shadow? For a double-acting gate this is
    // the only thing latchAngle means, and it is what tells the model whether
    // the latch bar is home. Cheap enough to poll every frame.
    get latched() { return Math.abs(angle - restAngle) <= latch; },

    // An angular impulse: something shoved the gate. Units are rad/s, because
    // everything in here is per unit moment of inertia -- there is no mass in
    // this file, only an angle and its acceleration. A ghost drifting through
    // at walking pace is worth something like 2 to 3, which opens the default
    // gate to between 25 and 30 degrees.
    //
    // Signed in world terms, not in gate terms, so a caller that knows which
    // side the ghost came from can just pass the sign through. On a
    // double-acting gate that is all it takes to open it either way. On a
    // framed one a wrong-way push is not refused and not silently flipped
    // either: it goes straight into the stop and what comes back is the
    // rebound, so a hard shove (-5) opens the gate to about 34 degrees. Whack a
    // real gate against its own frame and it does swing open again. That is the
    // restitution being consistent, not a sign bug.
    push(impulse) {
      if (!Number.isFinite(impulse) || impulse === 0) return;
      velocity += impulse;
      asleep = false;
      still = 0;
      resolveStops();
    },

    update(dt) {
      // A retired gate costs one comparison per frame and nothing else, the way
      // the skeleton's debris retires a settled bone. Fifty shut gates should
      // be exactly as cheap as none.
      //
      // Number.isFinite, not just dt > 0. An Infinity gets past a `> 0` test,
      // divides into a finite number of substeps of infinite length, and turns
      // the angle into a NaN that then propagates into the gate's transform and
      // out through the whole scene graph. Cheap to refuse here.
      if (asleep || !Number.isFinite(dt) || dt <= 0) return angle;

      const steps = Math.min(Math.ceil(dt / MAX_STEP), MAX_SUBSTEPS);
      const h = Math.min(dt / steps, MAX_STEP);

      for (let i = 0; i < steps; i++) {
        substep(h);

        // Home, slow, and staying that way. All three are needed: a leaf
        // passing through the settle point at speed is momentarily home, and a
        // leaf hanging at the far end of its swing is momentarily slow. Only
        // both together, for a tenth of a second, is a gate that has finished.
        const resting = Math.abs(angle - settle) <= restGap && Math.abs(velocity) < REST_SPEED;
        still = resting ? still + h : 0;

        if (still >= SLEEP_TIME) {
          // Last chance to put it down exactly. Every "settled thing that
          // slowly creeps" bug is a settle that left a fraction of a unit of
          // error behind and then never looked again.
          angle = settle;
          velocity = 0;
          asleep = true;
          break;
        }
      }

      return angle;
    },

    reset() {
      angle = settle;
      velocity = 0;
      still = 0;
      asleep = true;
    },
  };
}
