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
// stop-to-stop, 0.63  0.57  0.50  0.41  0.31 seconds. That accelerating patter
// is the sound of a dropped ball settling and it turns out to be the single
// most convincing thing the gate does. It falls out of the geometry; nothing
// here asks for it.

// --- which way does it swing --------------------------------------------------
//
// A LEAF HUNG IN A FRAME OPENS ONE WAY. That is the decision, and it is worth
// stating because the alternative is a real thing that some gates do.
//
// A double-acting gate (a saloon door, a spring-hinged kennel gate) swings
// through the closed position and out the other side, and its rest position is
// the middle of a symmetric swing. A gate in a frame cannot do that: the frame
// is behind it. It stops dead on the closing side and is free only on the
// opening side. Shove one the wrong way and it does not move, it just knocks.
// That is the gate modelled here, because it is the gate in a graveyard wall,
// and because "bounces back and forth" is much more interesting when one of
// the two ends of the travel is a hard stop rather than open air.
//
// So the leaf lives on ONE side of the frame, given by `direction`. Reversing
// `direction` mirrors the whole thing for a gate hung on the other hand or
// swinging toward the other side of the path.
//
// `latchAngle` is where the frame is. The leaf is a hair narrower than the
// opening, so the closing edge meets the stop just before the leaf is plumb:
// below `latchAngle` the leaf would be inside the frame, which is solid, so
// that is where the collision happens and that is where it comes to rest.
// The gap it rests at is the leaf's own clearance in its frame, and gravity
// still has a little sin(latchAngle) of torque left at that angle, which is
// what holds it shut instead of letting it drift open again.
//
// If the gate's geometry wants closed to mean flush at `restAngle`, pass
// latchAngle: 0. It degenerates cleanly: the stop lands exactly on the plumb
// position, the residual holding torque goes to zero, and the hinge friction
// below is what stops it there instead. Nothing else changes.

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
//             swing gives up 26% of its amplitude and the sixth gives up 13%
//             (0.736  0.785  0.816  0.838  0.853  0.865, climbing toward the
//             viscous asymptote as the leaf slows down). A big shove therefore
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
//             actually reach zero rather than 1e-9. REST_GAP below is sized to
//             swallow the whole band, so a leaf that stalls inside it still
//             counts as shut and still retires.
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
// Wide enough to contain the stiction band above, so a leaf that dry-friction
// stalls a hair short of the stop is still judged shut and still retires. On a
// metre-wide leaf this is 2mm at the far edge.
const REST_GAP = 2e-3;     // rad off the stop that still counts as shut
const SLEEP_TIME = 0.1;    // seconds of that before the gate retires

// --- stepping -------------------------------------------------------------------
// The main loop clamps dt to 1/20, so one call can be 50ms, and a 50ms step is
// where a naive pendulum dies. Explicit Euler on this system gains energy every
// step regardless of how small the step is (the position update uses the OLD
// velocity, which is systematically wrong in the direction that adds energy),
// and a gate given a firm push at 1/20 climbs over the top and starts spinning
// inside about eight seconds. Semi-implicit Euler does not: the position uses
// the NEW velocity, the scheme is symplectic, and the energy error is bounded
// and oscillatory rather than growing.
//
// Symplectic alone would still be enough to pass a stability test and still be
// wrong to ship at one step per frame, for the reason the Spring's comment
// gives: the same gate would read as a slightly different gate on a slow
// machine, because the phase error per step goes as (w*dt)^2 and at 50ms that
// is a 4% error on the period. So the inner step is fixed at 1/240 and the
// frame is chopped into as many of those as it takes. At 1/20 that is twelve
// substeps of arithmetic on two floats, which is nothing, and it means the
// capture harness and the browser produce the same swing to four decimals.
const MAX_STEP = 1 / 240;
const MAX_SUBSTEPS = 32;   // a 133ms frame; beyond that the scene has bigger problems

export function createSwing({
  restAngle = 0,          // plumb. Where gravity is pulling the leaf.
  latchAngle = 0.06,      // below this the leaf is inside the frame, so: the stop
  gravity = 9.8,
  length = 0.5,           // effective pendulum length, metres
  damping = 0.6,          // air and hinge friction, one dial for all three terms
  bounce = 0.45,          // ENERGY kept when it strikes the closed stop
  direction = 1,          // +1: the leaf opens toward increasing angle
  // How far it can open before the leaf is up against the fence or the post.
  // This is a real stop on a real gate and it is also the hard guarantee that
  // nothing can ever go over the top of its own arc, whatever impulse arrives.
  maxAngle = Math.PI / 2,
} = {}) {
  const dir = direction < 0 ? -1 : 1;
  // `bounce` is the fraction of ENERGY kept, so the speed coming out of a
  // strike is sqrt(bounce) of the speed going in. Reading it as a coefficient
  // of restitution instead (multiplying the velocity by 0.45) is the same
  // number meaning something four times as lossy, and it is the single tuning
  // mistake that cost this file the most: the gate banged shut in four arcs
  // and 2.1s, which reads as three thuds rather than as a gate swinging. On
  // the energy reading the same 0.45 gives six arcs over 3.2s.
  const restitution = Math.sqrt(Math.max(0, bounce));
  // Angular frequency squared of the small-angle swing. w0 = sqrt(g/L), so the
  // default gate has a 1.42s natural period, which is about right for a light
  // leaf on a short effective radius. Longer `length` is a heavier, lazier gate.
  const w2 = gravity / Math.max(length, 1e-4);

  const shut = restAngle + dir * Math.max(latchAngle, 0);
  const open = restAngle + dir * Math.max(Math.abs(maxAngle), Math.abs(latchAngle));
  const travel = (open - shut) * dir;   // total openness available, always >= 0

  const cLin = Math.max(damping, 0) * VISCOUS;
  const cQuad = Math.max(damping, 0) * AIR;
  const cDry = Math.max(damping, 0) * HINGE;

  let angle = shut;
  let velocity = 0;
  let asleep = true;
  let still = 0;

  // exp() is the expensive part of a substep and h almost never changes, so the
  // linear drag factor is cached the same way the Spring caches its transition.
  let lastH = -1;
  let linDecay = 1;

  // Signed distance out from the stop. Positive is open, and the invariant this
  // whole file maintains is that it is never negative.
  const openness = () => (angle - shut) * dir;

  function resolveStops() {
    const x = openness();
    const closing = -velocity * dir;

    if (x < 0 || (x <= 0 && closing > 0)) {
      // The leaf has arrived at the frame. Reflect rather than clamp: the
      // distance it went past the stop inside this substep is the distance it
      // would have travelled coming back out, scaled by the restitution, and
      // throwing that away instead loses up to a substep of the rebound and
      // makes the first bounce read late.
      if (closing > MIN_BOUNCE) {
        velocity = -velocity * restitution;
        angle = shut + dir * (-x * restitution);
      } else {
        // Shut. Not "nearly shut".
        velocity = 0;
        angle = shut;
      }
      return;
    }

    const over = x - travel;
    if (over > 0) {
      // Slammed into the fence at full opening. Same collision, and the reason
      // the pendulum can never reach the top of its arc no matter how hard the
      // ghost hits it.
      const opening = velocity * dir;
      if (opening > MIN_BOUNCE) {
        velocity = -velocity * restitution;
        angle = open - dir * over * restitution;
      } else {
        velocity = 0;
        angle = open;
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
    //    the leaf back a push in the direction it was travelling, which is a
    //    drag term that ACCELERATES. This form cannot, because the divisor is
    //    always at least 1.
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

    // Where the leaf sits when it is shut, and how far it can open. The gate's
    // model needs the first to align its closed pose with the physics, and it
    // is not always `restAngle`: see the latchAngle note at the top.
    get closedAngle() { return shut; },
    get openLimit() { return open; },

    // An angular impulse: something shoved the gate. Units are rad/s, because
    // everything in here is per unit moment of inertia -- there is no mass in
    // this file, only an angle and its acceleration. A ghost drifting through
    // at walking pace is worth something like 2 to 3.
    //
    // Signed in world terms, not in gate terms, so a caller that knows which
    // side the ghost came from can just pass the sign through. A push into the
    // frame is not refused and it is not silently flipped either: it goes
    // straight into the stop, and what comes back out is the rebound. Whack a
    // real gate against its own frame and it does swing open again, so a hard
    // wrong-way shove (-5) opens this one to about 34 degrees. That is the
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
      if (asleep || !(dt > 0)) return angle;

      const steps = Math.min(Math.ceil(dt / MAX_STEP), MAX_SUBSTEPS);
      const h = dt / steps;

      for (let i = 0; i < steps; i++) {
        substep(h);

        // Shut, slow, and staying that way. Both halves are needed: a leaf
        // passing through the stop at speed is momentarily "at" it, and a leaf
        // hanging almost stationary at the far end of its swing is momentarily
        // slow. Only the two together for a tenth of a second is a gate that
        // has finished.
        const resting = openness() <= REST_GAP && Math.abs(velocity) < REST_SPEED;
        still = resting ? still + h : 0;

        if (still >= SLEEP_TIME) {
          // Last chance to put it down exactly. Every "settled thing that
          // slowly creeps" bug is a settle that left a fraction of a unit of
          // error behind and then never looked again.
          angle = shut;
          velocity = 0;
          asleep = true;
          break;
        }
      }

      return angle;
    },

    reset() {
      angle = shut;
      velocity = 0;
      still = 0;
      asleep = true;
    },
  };
}
