import * as THREE from 'three';
import M from './metrics.js';
import { Spring, easeOutBack, easeInOutCubic, easeOutElastic } from './motion.js';

// The skeleton's performance: buried, crawls out of the ground, stands up, and
// then walks the ghost down.
//
// The rule this file is written to is the one the ghost is built on. Secondary
// motion is a CONSEQUENCE, never a decoration. So almost nothing here is a
// keyframe played back directly:
//
//   * every joint angle is a spring target, and the springs are tuned by the
//     mass of what they carry. The skull lags the chest, the forearm lags the
//     upper arm, the jaw lags everything, and none of that is authored.
//   * the legs are inverse kinematics onto FOOT PLANTS that are fixed in world
//     space. The walk cycle is driven by distance travelled, so the feet cannot
//     skate, and the rise out of the crouch is one number (hip height) with the
//     feet pinned, so the knees straighten because the hips went up rather than
//     because a curve said so.
//   * the jaw is a pendulum hung off the skull's own measured acceleration. It
//     clacks when the head stops because a real one would.
//
// Angles. Every joint in the rig is identity at rest, and rotations about X
// commute, so "world pitch" here means the SUM of rotation.x down the chain to
// that joint: the angle the segment has swung from its rest direction. It is
// far easier to author than a local angle, because it does not change meaning
// when a parent moves. Zero is the rest pose; for the spine, positive leans the
// chest forward; for a limb hanging down, positive swings it backward and
// negative swings it forward. Local rotations are recovered at the end by
// subtracting the parent's world pitch.

const D = Math.PI / 180;
const TAU = Math.PI * 2;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// --- the figure's own numbers ------------------------------------------------

// Hip pivot height when standing at ease, and when stalking. The leg is 1.150
// from hip pivot to ankle pivot and the two bones sum to 1.1504, so a figure
// standing at M.y.hip has its knees locked dead straight and cannot take a step
// at all. Everything about the walk falls out of that: the hips have to come
// down before there is any stride to have.
const HIP_TALL = M.y.hip - 0.02;      // 1.205, at ease, knees bent about 22 deg
const HIP_STALK = 1.195;              // walking. The bob takes it down from here
const HIP_CROUCH = 0.45;              // the pose it climbs out of the hole in

// Walk. A planted foot travels HALF_STEP + LIFT_BEHIND backward relative to its
// own hip before it lifts, and since the foot is nailed to the world that is
// exactly how far the BODY moves during one stance. How far it moves per STEP
// is a different number and confusing the two is the classic way to build a
// walk that skates: at this duty factor a foot is down for 1.24 step periods,
// so the step is the excursion over 1.24 rather than the excursion itself.
const HALF_STEP = 0.36;               // how far in front of its hip a foot lands
// And how far behind before it lifts again. It is further than it lands ahead,
// because the heel comes off at the end of a stance and that hands the leg back
// about 12cm of reach. Without the heel-off this figure cannot stride at all:
// its legs are 1.15 long under a hip that stands at 1.225, so a flat foot runs
// out of leg at 0.35 either side and the walk comes out as a scurry.
const LIFT_BEHIND = 0.42;
const MAX_HEEL = 0.55;                // radians of heel-off at the end of stance
const DUTY = 0.62;                    // fraction of its cycle a foot is planted
const STEP_LENGTH = (HALF_STEP + LIFT_BEHIND) / (2 * DUTY);   // 0.629
const TOP_SPEED = 1.25;               // the ghost does 4.5. Being chased is a mood.
const STOP_RANGE = 1.25;              // stops an arm's length short
const WAKE_RANGE = 7.0;               // the ghost comes this close and it wakes
const GIVE_UP_RANGE = 13.0;           // and this far away before it gives up

// The ankle's height above standing at the middle of the swing. Not the whole
// of the lift: a stance that ends up on the toe hands the swing most of this
// for free, and only the remainder is added as an arc. See applyLegs.
const FOOT_LIFT = 0.13;
// How far the toe tip reaches in front of the ankle pivot. legs.js sets the
// pivot a quarter of the way back along a foot M.leg.foot long; measured off
// the built mesh the tip lands at 0.749 of that length, and the exact figure
// matters because this is both the point the foot pivots on at the end of a
// stance and the arm that decides how far it can toe off before the tip is
// through the floor.
const TOE_AHEAD = M.leg.foot * 0.749;
// And how far the heel reaches behind it, which limits the other direction: at
// touchdown the ankle is at standing height and any toes-up at all would put
// the heel through the floor.
const HEEL_BACK = M.leg.foot * 0.248;
// The same two corners again, as polar coordinates about the ankle pivot,
// because that is the form the clearance question actually wants. Tip the foot
// by p and the toe sits TOE_R * sin(p + TOE_PHI) below the pivot and the heel
// HEEL_R * cos(p + HEEL_PHI); setting either equal to the pivot's height and
// solving gives the exact pitch that puts that corner on the floor. The
// approximate version, asin(height / arm), was 3 degrees out at the pose a
// stance actually ends in, which is enough for the clamp to bind on the swing's
// first frame and put back the very snap it is there to prevent.
const TOE_R = Math.hypot(M.y.ankle, TOE_AHEAD);
const TOE_PHI = Math.atan2(M.y.ankle, TOE_AHEAD);
const HEEL_R = Math.hypot(M.y.ankle, HEEL_BACK);
const HEEL_PHI = Math.atan2(HEEL_BACK, M.y.ankle);
// Radians of toes-up at the top of the swing's second half, before the foot
// comes back to flat for the landing. It is a coefficient rather than an angle:
// the shape is u^2 * (1-u)^1.5, which peaks at 0.092, so this is about 8
// degrees of heel leading.
const TOE_UP = 1.5;
const BOB = 0.045;                    // pelvis rise and fall, twice a cycle
const SWAY = 0.035;                   // pelvis shift toward the stance foot

const MAX_YAW_RATE = 1.9;             // rad/s. Rate limited so it leans into a turn.
// How fast the gait phase is pulled back onto the footfalls, per second. Low
// enough that the correction is never more than about half the phase's own
// rate, high enough that a step's worth of error is gone before the next one.
const CURSOR_LOCK_RATE = 5.0;

// Jaw. The mandible is a light bone on a loose hinge, so its spring is well
// under critical and it rings. The stops are hard, with a little restitution,
// which is where the clack comes from.
const JAW_OPEN_MAX = 0.52;
const JAW_BOUNCE = 0.28;

// Bones shaken loose by the climb, in TABLE time (see emergeTime: the warp
// makes these land at real 0.45s, 0.95, 1.77, 2.23, 2.66 and 3.09 into a 3.4
// second climb). Six beats rather than two, spread so they read as six separate
// events caused by six separate efforts and not as a shower.
//
// The budget is a HARD CAP and stays one: a figure that emerges and settles
// repeatedly must not disassemble itself over a few minutes of play, and
// nothing is shed once SHED_BUDGET pieces have gone. Raising the number is a
// deliberate act; removing the cap is not available.
//
// Every bone here is in rig.shed, the model's own list of what is safe to
// detach, and each is chosen so its absence does not open a hole in the
// silhouette. The four ribs in that map are middle ribs, spread over both
// sides and up and down the cage (L3, R4, L6, R7), so each gap has whole ribs
// above and below it closing it: what reads is a cage that has lost ribs, not
// a cage with a window in it. The fingers go from the hands that are clawing,
// which is where the viewer is already looking, and a claw missing a finger
// still reads as a claw.
//
// Timed against the choreography rather than spaced evenly:
//   1.20  the right hand takes hold of the lip and drags        (strain 0.70)
//   2.05  the left hand slams down and takes its share          (strain 0.74)
//   3.10  the heave that carries the ribcage clear of the lip   (strain 0.97)
//   3.70  the second heave, the other side of the cage          (strain 0.88)
//   4.25  the arms straighten and take the whole weight         (strain 0.46)
//   4.80  the last fold, as the legs come under the body        (strain 0.38)
// Two light beats and then four heavier ones, which is also the shape of the
// effort: the hands go first because the hands are what is on screen and
// clawing, and the ribs follow as it starts hauling.
//
// The ribs are timed AFTER the ribcage is above the surface. At table 2.8 the
// cage is still 50mm under it, and a rib that spawns underground arrives by
// being pushed up out of the floor, which reads as a bug rather than a break;
// by 3.10 the cage centre is 200mm clear.
//
// FOUR of the six are ribs because of what the shot can resolve. In the rise
// framing the figure is about 400px tall, which puts a shed rib at 45px of
// legible curve and a shed finger at about 10px. Two fingers is what this
// clip can carry, and they are the two earliest beats, where the hand they
// leave is the biggest thing in frame. Everything else the model marks as safe
// to shed is a finger, so four ribs is the whole of what is available at a
// size that reads: see the report for the bones worth adding to rig.shed.
const SHED_BUDGET = 6;
const SHED_PLAN = [
  { at: 1.20, bone: 'fingerR3', velocity: [0.55, 1.35, 0.45], spin: [5, 2, 7] },
  { at: 2.05, bone: 'fingerL4', velocity: [0.85, 1.20, 0.40], spin: [4, 3, 6] },
  // The four ribs are thrown into four different quadrants of the body's own
  // frame, right-back, left-forward, right-forward, left-back. Sending them
  // out by side alone put two on each side and they landed in a pair of
  // tangles, which reads as two piles rather than four bones.
  { at: 3.10, bone: 'ribR7', velocity: [-1.05, 1.15, -0.20], spin: [3.5, 1.5, 5.5] },
  { at: 3.70, bone: 'ribL6', velocity: [0.80, 1.05, 0.80], spin: [4.5, 2, 4] },
  { at: 4.25, bone: 'ribR4', velocity: [-0.70, 1.30, 0.75], spin: [3, 2.5, 6] },
  { at: 4.80, bone: 'ribL3', velocity: [1.00, 1.25, -0.25], spin: [5, 1.5, 3] },
];

// --- small helpers -----------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a || 1)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

function wrap(a) {
  a = (a + Math.PI) % TAU;
  return (a < 0 ? a + TAU : a) - Math.PI;
}

// Frame-rate independent approach, for the handful of quantities that want a
// simple lag rather than a spring.
const approach = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);

// Piecewise keyframe track: [[t, value], [t, value], ...], eased between keys.
// Used only to author intent. What reaches the rig is always a spring's answer
// to these, never the numbers themselves.
function track(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const t0 = keys[i - 1][0];
    const t1 = keys[i][0];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0 || 1);
      return mix(keys[i - 1][1], keys[i][1], (keys[i][2] || easeInOutCubic)(u));
    }
  }
  return last[1];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the climb out -----------------------------------------------------------
//
// Authored in world pitch (degrees) and in metres above the floor, so every
// number below can be read straight off the drawing rather than unwound from a
// parent's rotation. Times are seconds into the emerge.
//
// The shape of it: a hand breaks the surface, claws, the second hand follows,
// the skull comes up under a torso that is still face down, then the arms
// straighten and lever the ribcage over the lip, and the last beat folds the
// legs under so the feet are on the floor and the rise has something to push
// against.
const EMERGE_END = 5.2;
// Hip height while it is waiting underground. Taken off the climb's own first
// key, so waking up is a continuation rather than a cut.
const BURIED_Y = -0.30;

const CRAWL = {
  // Hip pivot height. How deep it starts is not a free choice: the shoulder
  // sits 0.449 up the torso from the hip and the arm is 0.94 from the shoulder
  // to the fingertips, so a hand can only break the surface from 0.78 down.
  // Buried deeper than that and the shot opens with a second and a half of
  // empty floor while the figure climbs to where the performance starts.
  hipY: [[0, BURIED_Y], [0.55, -0.28], [1.9, -0.28], [2.7, -0.22],
    [3.5, -0.05], [4.3, 0.20], [5.2, HIP_CROUCH]],
  // Torso pitch. 100 is face down and a little past horizontal, 40 is the
  // crouch it stands up out of. The crown is 1.275 up the torso from the hip,
  // so the skull breaks the surface as this passes 68 degrees, which is what
  // the gaze track below is timed against.
  pitch: [[0, 100], [0.9, 100], [1.6, 88], [2.4, 68], [3.4, 52], [4.3, 44], [5.2, 40]],
  // Extra bend at the two spine joints, on top of the torso pitch. Negative
  // arches the chest up and away from the floor, which is what the shoulders
  // have to do for the arms to reach out in front at all.
  lumbar: [[0, 14], [1.6, 6], [2.4, -6], [3.4, -12], [5.2, -6]],
  thorax: [[0, 10], [1.6, 2], [2.4, -10], [3.4, -16], [4.3, -10], [5.2, -4]],
  // Absolute world pitch of the skull. 90 is face down, 0 is level, negative
  // looks up. The head is thrown back as it clears the surface.
  gaze: [[0, 110], [1.4, 95], [2.1, 30], [2.6, -18], [3.1, -4], [3.8, 12], [5.2, 6]],

  // Right arm, the one that breaks the surface. World pitch: 0 hangs down,
  // -90 reaches straight forward, -180 straight up.
  // These follow the SHOULDER, which is under the floor until about t = 3.2. A
  // hand resting on the ground in front of a buried shoulder is an arm pointing
  // up and forward, not down and forward, and every one of these angles is the
  // elevation that puts the hand on the surface at that moment.
  armR: [[0, 20], [0.32, -152, easeOutBack], [0.62, -168], [1.0, -148],
    [1.5, -112], [2.2, -96], [3.0, -80], [3.6, -59], [4.3, -42], [5.2, -36]],
  elbowR: [[0, 84], [0.32, 22], [0.62, 10], [1.2, 44], [2.0, 52], [3.0, 40], [4.0, 22], [5.2, 34]],
  wristR: [[0, 12], [0.5, -4], [0.85, 46], [1.4, 34], [2.5, 14], [5.2, 8]],
  // Left arm, the same beats about two thirds of a second behind and shallower.
  armL: [[0, 24], [0.9, 24], [1.15, -146, easeOutBack], [1.5, -158], [2.0, -128],
    [2.6, -104], [3.2, -82], [3.8, -62], [4.4, -44], [5.2, -38]],
  elbowL: [[0, 88], [1.15, 26], [1.5, 12], [2.0, 46], [2.8, 50], [3.6, 34], [4.2, 22], [5.2, 36]],
  wristL: [[0, 14], [1.3, -2], [1.7, 42], [2.3, 30], [3.2, 12], [5.2, 8]],
  // Arm flare, so the hands plant wide of the shoulders rather than under them.
  spread: [[0, 6], [1.0, 16], [2.4, 22], [3.6, 16], [5.2, 10]],

  // How hard it is working, 0 to 1. Drives the tremor, the jaw's gape and the
  // amount of ring in every spring.
  strain: [[0, 0.2], [0.35, 1.0], [0.9, 0.55], [1.5, 0.85], [2.4, 0.7],
    [2.8, 1.0], [3.5, 0.9], [4.4, 0.45], [5.2, 0.3]],
  // Jaw, on top of whatever the skull's own motion is doing to it.
  jaw: [[0, 0.06], [0.8, 0.10], [1.5, 0.30], [2.3, 0.44], [2.8, 0.16],
    [3.0, 0.42], [3.6, 0.26], [4.4, 0.10], [5.2, 0.14]],
};

// How far in front of the body each foot lands as the climb ends, staggered,
// because a figure hauling itself out of a hole does not first tidy its feet
// into a neat parallel stance. It stands up off the front one.
const CROUCH_Z = { L: 0.28, R: 0.50 };

export function createSkeletonPerformance({
  rig,
  scene,
  debris = null,
  renderer = null,
  seed = 7,
  wakeRange = WAKE_RANGE,
  // EXTERNAL DRIVE, for the game.
  //
  // Left null, this performance is autonomous: it wakes when the ghost comes
  // within wakeRange, climbs out, and then chases at its own TOP_SPEED. That is
  // what the free-roam scene wants and it is unchanged.
  //
  // The game cannot have that, because the rules decide where every skeleton is
  // (they run a graph, they have modes, they get eaten) and two things
  // integrating a position is two positions. So a driver replaces the STEERING
  // and nothing else: called once a frame, it returns `{ x, z, yaw }` and the
  // chase phase adopts them instead of solving for them.
  //
  // Everything downstream still works because the gait was never driven by the
  // steering in the first place. It is driven by `speed` and `cursor`, and both
  // are now MEASURED from the displacement the driver asked for rather than
  // integrated from a want. So the feet still land where the body is going, the
  // pelvis still bobs twice a cycle against the footfalls, the roll still leans
  // into the turn, and the figure can be moved faster than TOP_SPEED without
  // the legs coming adrift: the cadence follows the distance, which is exactly
  // the property that made TOP_SPEED a cadence ceiling rather than a speed one.
  //
  // The driver is consulted only while chasing. Buried, emerging and rising are
  // the spawn animation and the rules read `state`/`emergeProgress` to know
  // where it has got to, rather than driving it.
  driver = null,
} = {}) {
  const J = rig.joints;
  const group = rig.group;
  const scale = group.scale.x || 1;
  const rand = mulberry32(seed);

  // Where it is buried. Everything comes home to here.
  const home = group.position.clone();
  // Not const: the game moves a skeleton's grave when it builds a level.
  let homeYaw = group.rotation.y;
  const rootRest = J.root.position.clone();

  // --- clipping ---------------------------------------------------------------
  // The whole figure shares one material, so one plane makes it genuinely
  // emerge from the floor rather than rise through it as a solid. The plane
  // keeps y > -0.04 rather than y > 0: a bone lying ON the floor has its lowest
  // point at exactly zero, and shed debris resting there would otherwise be
  // sliced in half. Four centimetres of slack is invisible, because the ground
  // is opaque and this camera never sees under it.
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.04);
  const boneMaterials = [];
  group.traverse((o) => {
    if (o.isMesh && o.material?.isMeshStandardMaterial && !boneMaterials.includes(o.material)) {
      boneMaterials.push(o.material);
    }
  });
  let clipping = false;
  function setClipping(on) {
    if (on === clipping) return;
    clipping = on;
    for (const m of boneMaterials) {
      m.clippingPlanes = on ? [clipPlane] : null;
      // Without this the buried half still casts a full shadow, and a skeleton
      // with no body throws a whole skeleton's shadow onto the floor.
      m.clipShadows = on;
      m.needsUpdate = true;
    }
    if (renderer && on) renderer.localClippingEnabled = true;
  }

  const contacts = group.userData.contactShadow || [];
  const contactOpacity = contacts.map((c) => c.material?.opacity ?? 0.32);

  // --- springs ----------------------------------------------------------------
  // One per degree of freedom, tuned by what it has to move. The root carries
  // the whole body and is the slowest thing here; the wrist carries a hand and
  // is the fastest. Damping is quoted against critical (2*sqrt(k)) in the
  // comments, because that ratio is the whole character of a spring.
  const S = {
    root: new Spring({ stiffness: 70, damping: 15.0 }),        // 0.90 of critical
    lumbar: new Spring({ stiffness: 110, damping: 18.5 }),     // 0.88
    thorax: new Spring({ stiffness: 140, damping: 20.0 }),     // 0.85
    neck: new Spring({ stiffness: 210, damping: 24.0 }),       // 0.83
    head: new Spring({ stiffness: 260, damping: 25.0 }),       // 0.78, the whip end
    shoulderL: new Spring({ stiffness: 150, damping: 20.0 }),
    shoulderR: new Spring({ stiffness: 150, damping: 20.0 }),
    elbowL: new Spring({ stiffness: 215, damping: 23.0 }),
    elbowR: new Spring({ stiffness: 215, damping: 23.0 }),
    wristL: new Spring({ stiffness: 300, damping: 24.0 }),     // 0.69, floppy hand
    wristR: new Spring({ stiffness: 300, damping: 24.0 }),
    spreadL: new Spring({ stiffness: 130, damping: 19.0 }),
    spreadR: new Spring({ stiffness: 130, damping: 19.0 }),
    hipL: new Spring({ stiffness: 130, damping: 20.0 }),
    hipR: new Spring({ stiffness: 130, damping: 20.0 }),
    kneeL: new Spring({ stiffness: 175, damping: 22.0 }),
    kneeR: new Spring({ stiffness: 175, damping: 22.0 }),
    ankleL: new Spring({ stiffness: 240, damping: 25.0 }),
    ankleR: new Spring({ stiffness: 240, damping: 25.0 }),
    headYaw: new Spring({ stiffness: 90, damping: 15.0 }),
    roll: new Spring({ stiffness: 95, damping: 15.5 }),
    sway: new Spring({ stiffness: 120, damping: 12.0 }),       // 0.55, rings a while
    // Hip height. Everything about the rise is this one spring plus the feet
    // being pinned to the floor.
    lift: new Spring({ stiffness: 62, damping: 12.6 }),        // 0.80, overshoots
    jaw: new Spring({ stiffness: 190, damping: 12.0 }),        // 0.44, rattles
  };

  // Targets, in radians and metres, rewritten every frame by whichever phase is
  // running. Nothing outside the phase code touches these.
  const T = {
    root: 0, lumbar: 0, thorax: 0, neck: 0, head: 0,
    shoulderL: 0, shoulderR: 0, elbowL: 0, elbowR: 0, wristL: 0, wristR: 0,
    spreadL: 0, spreadR: 0,
    hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, ankleL: 0, ankleR: 0,
    headYaw: 0, roll: 0, sway: 0, lift: BURIED_Y,
  };

  // --- leg geometry -----------------------------------------------------------
  // Read off the rig rather than off metrics.js, so a change to the model
  // cannot silently put the feet through the floor. Only rotation.x moves a
  // limb in the sagittal plane and rotation.x preserves the local X coordinate,
  // so each leg is exactly a two link chain in its own YZ plane: link lengths
  // are the projections, and the rest angles are where those projections point.
  function chainSpec(rootJoint, mid, tip, fallbackBend) {
    const kp = mid.position;
    const ap = tip.position;
    const alpha1 = Math.atan2(kp.z, kp.y);
    const alpha2 = Math.atan2(ap.z, ap.y);
    const rest = wrap(alpha2 - alpha1);
    return {
      root: rootJoint.position.clone(),
      a1: Math.hypot(kp.y, kp.z),
      a2: Math.hypot(ap.y, ap.z),
      alpha1,
      alpha2,
      cx: kp.x + ap.x,          // lateral offset the sagittal solve cannot change
      // Which way the middle joint already bends in the rest pose. A knee is a
      // few degrees flexed and an elbow a few degrees the other way, and that
      // is the whole of what tells the solver which is which. A limb built dead
      // straight would say nothing, so the caller's answer stands in.
      bend: Math.abs(rest) > 0.01 ? Math.sign(rest) : fallbackBend,
      span: Math.hypot(kp.y, kp.z) + Math.hypot(ap.y, ap.z),
    };
  }

  const LEG = {};
  const ARM = {};
  for (const side of ['L', 'R']) {
    // The knee folds backward and the elbow forward, which is the fallback if
    // the rest pose ever comes through with a dead straight limb.
    LEG[side] = chainSpec(J[`hip${side}`], J[`knee${side}`], J[`ankle${side}`], 1);
    // The arm's own root sits at the shoulder anchor's origin, so the offset
    // inside its parent is zero and the targets are solved in that parent.
    ARM[side] = chainSpec(J[`shoulder${side}`], J[`elbow${side}`], J[`wrist${side}`], -1);
  }

  // Solve one leg so its ankle pivot lands on `t`, expressed in the ROOT's
  // frame. Returns local rotations for the hip (x and z) and the knee.
  //
  // The chain from the hip to the ankle has a fixed lateral offset cx that no
  // amount of rotation.x can change, so the solve is done in two stages that do
  // not fight each other. Rotations compose as Rx * Ry * Rz in three's default
  // order, so rotation.z happens FIRST and rotation.x second, and rotation.x
  // preserves x. Which gives the whole method: the knee angle follows from the
  // distance alone, phi is whatever puts the chain's x on the target's x, and
  // the hip's x rotation then swings the rest of the way round.
  //
  // The distance is the 3D one with the lateral offset taken out of it, not the
  // length of the target's projection into the sagittal plane. That distinction
  // is invisible while the body is upright, because the offset is already
  // perpendicular to the plane, and it is 20cm of foot slip the moment the
  // torso is pitched over at 60 degrees during the climb.
  const ikOut = { hipX: 0, hipZ: 0, knee: 0, short: 0 };
  function solveChain(L, t) {
    const dx = t.x - L.root.x;
    const dy = t.y - L.root.y;
    const dz = t.z - L.root.z;

    const rho = Math.hypot(dx, dy, dz);
    ikOut.short = Math.max(0, rho - L.span);
    // What is left for the two links to span once the lateral offset is spent.
    const r = Math.sqrt(Math.max(rho * rho - L.cx * L.cx, 1e-8));

    const cosG = (r * r - L.a1 * L.a1 - L.a2 * L.a2) / (2 * L.a1 * L.a2);
    // The bend has a sign, and it is not the same one at both ends of the body.
    // A knee folds backward and an elbow folds forward, so the same solver
    // reaches the same point two different ways and only one of them is a
    // joint. The sign is taken off the rig's own rest pose rather than chosen.
    const gamma = L.bend * Math.acos(clamp(cosG, -1, 1));
    ikOut.knee = wrap(gamma + L.alpha1 - L.alpha2);

    // Where the chain points before either hip rotation: x is cx, and the rest
    // is r long at angle beta in the YZ plane.
    const beta = L.alpha1 + Math.atan2(L.a2 * Math.sin(gamma), L.a1 + L.a2 * Math.cos(gamma));
    const rc = r * Math.cos(beta);
    const rs = r * Math.sin(beta);

    // cx cos(phi) - rc sin(phi) = dx, branch nearest zero.
    let phi = 0;
    const amp = Math.hypot(L.cx, rc);
    if (amp > Math.abs(dx)) {
      const psi = Math.atan2(-rc, L.cx);
      const off = Math.acos(clamp(dx / amp, -1, 1));
      const a = wrap(psi + off);
      const b = wrap(psi - off);
      phi = Math.abs(a) < Math.abs(b) ? a : b;
    }
    const qy = L.cx * Math.sin(phi) + rc * Math.cos(phi);
    ikOut.hipZ = phi;
    ikOut.hipX = wrap(Math.atan2(dz, dy) - Math.atan2(rs, qy));
    return ikOut;
  }

  // --- feet -------------------------------------------------------------------
  // A foot is either planted at a world point or swinging to the next one. The
  // cursor that decides when to swing is DISTANCE walked, not time, which is
  // the whole reason the feet do not skate: at half speed the same stride takes
  // twice as long and covers the same ground.
  // `fromAnkle` and `liftPitch` are the pose the STANCE ENDED IN, in world, and
  // they are what a swing starts from. Starting from `plant` instead, which is
  // the contact point on the floor, was the walk's biggest discontinuity: see
  // queueStep.
  const foot = () => ({
    plant: new THREE.Vector3(),
    fromAnkle: new THREE.Vector3(),
    liftPitch: 0,
    fromYaw: 0,
    to: new THREE.Vector3(),
    swing: 1,
    dur: 0.3,
    retarget: false,
    yaw: 0,
  });
  const feet = { L: foot(), R: foot() };
  // Hands, during the climb. Same idea as the feet and for the same reason: a
  // crawl reads as a crawl because the hands stay where they were put and the
  // body hauls itself past them. Posed by angle instead, the arms swim.
  const hands = {
    L: { plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swing: 1, dur: 0.3 },
    R: { plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swing: 1, dur: 0.3 },
  };
  let armBlend = 0;        // 0 authored arm angles, 1 planted hands
  let handsDown = false;   // the hands have taken hold of the ground

  let cursor = 0;          // steps taken, fractional
  let cursorFix = 0;       // gait phase correction still to be bled off
  let nextStep = 'R';
  let riseSteps = 0;       // shuffle steps taken at the top of the rise
  let legBlend = 0;        // 0 authored angles, 1 planted feet
  let travel = 0;

  // The x a foot sits at when the leg is straight down. Taken off the rig, so
  // walking straight needs no lateral correction at the hip at all and the
  // stance is exactly as wide as the model was built.
  const FOOT_X = { L: LEG.L.root.x + LEG.L.cx, R: LEG.R.root.x + LEG.R.cx };

  // --- body state -------------------------------------------------------------
  let phase = 'buried';
  let phaseTime = 0;
  let clock = 0;
  let yaw = homeYaw;
  let yawVel = 0;
  let speed = 0;
  let strain = 0;
  let lostFor = 0;
  const pos = home.clone();
  const shedLeft = SHED_PLAN.map((s) => s.bone);
  const shedFired = [];

  // Jaw drive. The skull's own acceleration, measured rather than scripted.
  const headPos = new THREE.Vector3();
  const headPrev = new THREE.Vector3();
  const headVel = new THREE.Vector3();
  const headAcc = new THREE.Vector3();
  const localAcc = new THREE.Vector3();
  const headQuat = new THREE.Quaternion();
  let headPrimed = false;
  let chatter = 0;
  let chatterTimer = 0;
  let jawBeat = 0;         // scripted opening, on top of the physical one

  // Scratch.
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const target = new THREE.Vector3();
  const qWant = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const qParent = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const footPitch = { L: 0, R: 0 };
  // Diagnostics, read by the harness through metrics(): how far each leg's IK
  // target was out of reach, and the ceiling the planted feet put on the hips.
  const ikShort = { L: 0, R: 0 };
  let liftCap = Infinity;

  group.updateMatrixWorld(true);
  J.head.getWorldPosition(headPrev);

  // --- phases -----------------------------------------------------------------

  function enter(next) {
    phase = next;
    phaseTime = 0;
    if (next === 'buried') {
      setClipping(true);
      armBlend = 0;
      speed = 0;
      yawVel = 0;
      T.lift = BURIED_Y;
      S.lift.snap(BURIED_Y);
      legBlend = 0;
      cursor = 0;
      cursorFix = 0;
      handsDown = false;
    }
    if (next === 'rising') {
      riseSteps = 0;
      // The push off the floor. A rise that is only an ease has no moment where
      // the effort happens; this is that moment, and the overshoot at the top
      // is the same impulse still arriving.
      S.lift.velocity += 1.35;
      S.sway.velocity += (rand() < 0.5 ? -1 : 1) * 1.5;
      S.roll.velocity += (rand() < 0.5 ? -1 : 1) * 1.2;
      chatter = 1;
    }
    if (next === 'chasing') {
      lostFor = 0;
    }
  }

  // Buried. Not a switched-off object: it is listening, and what wakes it is
  // the ghost coming within range rather than a timer running out.
  //
  // The pose is the climb's own first frame rather than a separate one written
  // out by hand. Two hand-written versions of the same crouch is how the first
  // pass ended up with a buried figure whose spine was bent 86 degrees
  // backwards: the crawl's spine numbers are relative to the torso and the
  // buried one's were absolute, which reads identically and is not.
  function stepBuried(dt, ghost) {
    poseCrawl(0);
    strain = 0;
    chatter = 0;
    if (ghost && Math.hypot(ghost.x - pos.x, ghost.z - pos.z) < wakeRange) enter('emerging');
  }

  // The climb. Everything below reads the tracks above and hands them to the
  // springs; the tremor is added after the springs, because a spring would
  // swallow it.
  // Real seconds since the phase began, mapped onto the tables' own time.
  //
  // The tables were authored at a pace the user found too slow to start: the
  // pitch track holds flat for its first 0.9, so for nearly a second after the
  // wake there is a hand out of the ground and nothing happening. Rather than
  // re-time fifteen hand-tuned tracks and lose the relationships between them,
  // the whole climb is time-warped: the opening runs at 2.7x and the rest at
  // 1.2x, so the dead hold becomes about a third of a second and the climb
  // finishes in 3.4s instead of 5.2s.
  //
  // Every threshold in stepEmerge is quoted in TABLE time, which is why the
  // warp is applied once here rather than at each track() call: the shed beats,
  // the hand grabs and the leg blend all keep their places in the choreography.
  // The springs and the hand solver still run on real dt, so a faster target
  // just means they lag further behind it, which reads as more effort and not
  // as a fast-forward.
  const WARP = [[0, 0], [0.6, 1.6], [3.4, EMERGE_END]];
  function emergeTime(real) {
    for (let i = 1; i < WARP.length; i++) {
      const [r0, t0] = WARP[i - 1];
      const [r1, t1] = WARP[i];
      if (real <= r1) return t0 + (t1 - t0) * ((real - r0) / (r1 - r0));
    }
    return EMERGE_END + (real - WARP[WARP.length - 1][0]);
  }

  function stepEmerge(dt, ghost) {
    const t = emergeTime(phaseTime);
    poseCrawl(t);
    strain = track(CRAWL.strain, t);
    chatter = 0.25 * strain;

    // Feet find the floor for the last stretch, so the rise has something to
    // push against. The blend is in angle space, so the legs swing up and
    // forward out of the hole rather than snapping there.
    if (t > 4.05) {
      if (legBlend === 0) {
        for (const side of ['L', 'R']) {
          feet[side].plant.copy(group.localToWorld(
            v1.set(FOOT_X[side], -group.position.y / scale, CROUCH_Z[side]),
          ));
          feet[side].plant.y = 0;
          feet[side].yaw = yaw;
          feet[side].swing = 1;
        }
      }
      legBlend = clamp01((t - 4.05) / 0.6);
    }

    // The hands take hold, right first. Before that the arm is angle driven,
    // because a hand punching up out of the ground is not holding anything.
    if (t > 0.85 && !handsDown) {
      handsDown = true;
      reachHand('R', 0.22);
      reachHand('L', 0.34);
    }
    // And they let go for the rise, so the push off the floor is the last thing
    // the arms do before they come up in front.
    if (handsDown) {
      armBlend = t > 4.5
        ? clamp01((EMERGE_END - t) / 0.6)
        : clamp01((t - 0.85) / 0.45);
      if (armBlend > 0) stepHands(dt);
    }

    maybeShed(t);
    if (t >= EMERGE_END) enter('rising');
  }

  function poseCrawl(t) {
    T.lift = track(CRAWL.hipY, t);
    const pitch = track(CRAWL.pitch, t) * D;
    T.root = pitch;
    T.lumbar = pitch + track(CRAWL.lumbar, t) * D;
    T.thorax = T.lumbar + track(CRAWL.thorax, t) * D;
    const gaze = track(CRAWL.gaze, t) * D;
    T.neck = mix(T.thorax, gaze, 0.45);
    T.head = gaze;

    T.shoulderR = track(CRAWL.armR, t) * D;
    T.elbowR = T.shoulderR - track(CRAWL.elbowR, t) * D;
    T.wristR = T.elbowR - track(CRAWL.wristR, t) * D;
    T.shoulderL = track(CRAWL.armL, t) * D;
    T.elbowL = T.shoulderL - track(CRAWL.elbowL, t) * D;
    T.wristL = T.elbowL - track(CRAWL.wristL, t) * D;
    const spread = track(CRAWL.spread, t) * D;
    T.spreadL = spread; T.spreadR = spread;

    // The legs hang straight down the hole for most of the climb. World pitch
    // zero IS straight down whatever the torso is doing, which is the whole
    // reason these angles are authored in world space.
    T.hipL = 0; T.hipR = 0;
    T.kneeL = 22 * D; T.kneeR = 30 * D;
    T.ankleL = 32 * D; T.ankleR = 38 * D;

    jawBeat = track(CRAWL.jaw, t);
  }

  // Up onto the feet. The feet are already planted, so the only thing being
  // animated is the hip height and the torso angle; the knees straighten
  // because the hips went up.
  function stepRise(dt) {
    const t = phaseTime;
    // easeOutBack on the target, then a spring under 0.8 of critical on top of
    // it. The ease provides the big overshoot of something heaving itself up,
    // the spring the smaller wobble of something that has not stood in a while.
    T.lift = mix(HIP_CROUCH, HIP_TALL, easeOutBack(clamp01(t / 0.85)));
    const pitch = track([[0, 40], [0.5, 18], [0.9, -9], [1.4, 4], [2.0, 6]], t) * D;
    T.root = pitch;
    T.lumbar = pitch + track([[0, -6], [0.9, -14], [1.6, -2]], t) * D;
    T.thorax = T.lumbar + track([[0, -4], [0.9, -12], [1.6, 0]], t) * D;
    const gaze = track([[0, 6], [0.6, -22], [1.2, 2], [2.0, 8]], t) * D;
    T.neck = mix(T.thorax, gaze, 0.45);
    T.head = gaze;

    // The arms fling out for balance and then fold back in. easeOutElastic
    // rings this on the way back, and the shoulder spring softens the ring
    // into something with weight rather than a twang.
    const fling = easeOutElastic(clamp01(t / 1.5));
    const armOut = mix(-52, -70, fling) * D;
    T.shoulderL = armOut; T.shoulderR = armOut + 4 * D;
    T.elbowL = T.shoulderL - mix(36, 28, fling) * D;
    T.elbowR = T.shoulderR - mix(34, 30, fling) * D;
    T.wristL = T.elbowL - 10 * D;
    T.wristR = T.elbowR - 10 * D;
    const spread = mix(10, 34, easeOutBack(clamp01(t / 0.6))) * D;
    T.spreadL = spread * (1 - 0.6 * clamp01((t - 0.7) / 0.9));
    T.spreadR = T.spreadL;

    strain = mix(0.9, 0.15, clamp01(t / 1.4));
    legBlend = 1;

    // Two shuffle steps once it is upright, bringing the feet back under the
    // hips from the staggered crouch it stood up out of. Until they land the
    // reach limit is holding the hips down, so the last few centimetres of
    // height arrive with the feet rather than on a curve of their own.
    advanceSwings(dt);
    if (t > 1.30 && riseSteps === 0) { riseSteps = 1; queueStep('R', 0.05, 0.30); }
    if (t > 1.75 && riseSteps === 1) { riseSteps = 2; queueStep('L', -0.05, 0.30); }
    // Clacks shut at the top of the heave, then chatters as it settles.
    jawBeat = track([[0, 0.28], [0.45, 0.46], [0.7, 0.0], [1.1, 0.05], [2.0, 0.04]], t);
    chatter = track([[0, 0.4], [0.75, 1.0], [1.8, 0.35]], t);

    // Clipping is not free: it costs on every material that carries it, and by
    // here the lowest bone in the figure is the sole of a planted foot.
    if (clipping && T.lift > 0.75 && Math.abs(pitch) < 25 * D) setClipping(false);

    if (t > 2.4) enter('chasing');
  }

  // The chase. Two things decide whether this reads: the turn is rate limited
  // so the body leans into a change of direction instead of snapping to face
  // the ghost, and the walk's phase is distance travelled rather than elapsed
  // time.
  function stepChase(dt, ghost) {
    if (driver) return stepDriven(dt);

    let dist = Infinity;
    let err = 0;
    if (ghost) {
      v1.subVectors(ghost, pos).setY(0);
      dist = v1.length();
      if (dist > 1e-4) err = wrap(Math.atan2(v1.x, v1.z) - yaw);
    }

    // Turning. A second order response with a hard ceiling on the rate: the
    // ceiling is what makes it lean, because the body keeps arriving at a
    // heading the head asked for a moment ago.
    const yawAcc = 7.0 * err - 4.2 * yawVel;
    yawVel = clamp(yawVel + yawAcc * dt, -MAX_YAW_RATE, MAX_YAW_RATE);
    yaw += yawVel * dt;

    // Walks only when it is roughly pointed the right way, so a big turn is a
    // turn on the spot rather than an arc across the graveyard.
    const facing = smoothstep(0.25, 0.75, Math.cos(err));
    const want = ghost ? TOP_SPEED * facing * smoothstep(STOP_RANGE, STOP_RANGE + 1.1, dist) : 0;
    speed = approach(speed, want, want > speed ? 2.6 : 5.0, dt);
    if (want === 0 && speed < 0.01) speed = 0;

    const fwd = v2.set(Math.sin(yaw), 0, Math.cos(yaw));
    pos.addScaledVector(fwd, speed * dt);
    travel += speed * dt;
    cursor += (speed * dt) / STEP_LENGTH;
    // The footfall lock, paid off over about a fifth of a second rather than in
    // one frame. See advanceSwings.
    const bleed = cursorFix * (1 - Math.exp(-CURSOR_LOCK_RATE * dt));
    cursor += bleed;
    cursorFix -= bleed;

    // Gait. One cycle is two steps, so the pelvis rises and falls twice per
    // cycle and sways once. HIP_STALK is the TOP of the bob, not its middle:
    // the leg is nearly at full stretch at double support and there is no room
    // above it.
    const cyc = (cursor * 0.5) % 1;
    const moving = smoothstep(0.05, 0.5, speed);
    // Lowest at the footfall, highest at mid stance, and the cursor is pinned
    // to the footfalls above, so the two cannot drift apart.
    const bob = -BOB * moving * (1 + Math.cos(cyc * 2 * TAU)) * 0.5;
    T.lift = mix(HIP_TALL, HIP_STALK, moving) + bob;
    T.sway = SWAY * moving * Math.sin(cyc * TAU);

    // Leans into the turn, and forward with speed. Both are consequences of
    // motion rather than poses: the roll spring is under critical, so a hard
    // change of direction rolls past and comes back.
    T.roll = clamp(-yawVel * 0.16, -0.22, 0.22);
    const lurch = 2.5 * moving * Math.sin(cyc * 2 * TAU + 0.6);
    T.root = (7 + 5 * moving + lurch) * D;
    T.lumbar = T.root + (-3 + 4 * moving) * D;
    T.thorax = T.lumbar + (-2 + 6 * moving) * D;

    // The skull leads the turn. It looks where the body is going to be, which
    // is most of what makes the turn read as intent rather than as drift.
    T.headYaw = clamp(err, -0.75, 0.75);
    const gaze = (-4 + 10 * moving) * D + (dist < 3 ? -6 * D : 0);
    T.neck = mix(T.thorax, gaze, 0.45);
    T.head = gaze;

    // Arms out in front, swinging against the legs. The swing is read off the
    // legs themselves rather than off a phase of its own: the right arm goes
    // forward because the left leg did, which is both what a body does and the
    // only way the two can never drift out of step. The springs then do the
    // lag, so the hands arrive after the shoulders and the arm reads as heavy.
    const gait = clamp((S.hipR.value - S.hipL.value) * 0.38, -0.32, 0.32);
    T.shoulderL = (-74 - 6 * moving) * D + gait;
    T.shoulderR = (-74 - 6 * moving) * D - gait;
    T.elbowL = T.shoulderL - 34 * D - gait * 0.4;
    T.elbowR = T.shoulderR - 34 * D + gait * 0.4;
    T.wristL = T.elbowL - 16 * D;
    T.wristR = T.elbowR - 16 * D;
    T.spreadL = (14 + 6 * moving) * D;
    T.spreadR = T.spreadL;

    strain = 0.12 + 0.1 * moving;
    legBlend = 1;
    stepFeet(dt);

    // Closer means hungrier. The gape and snap near the ghost is the only
    // scripted thing the jaw does in this phase; everything else it does comes
    // out of the skull's own motion.
    chatter = 0.35 + 0.65 * smoothstep(4.0, 1.4, dist);
    const near = dist < STOP_RANGE + 0.9;
    jawBeat = near
      ? 0.34 * Math.max(0, Math.sin(clock * 5.2)) ** 2
      : 0.03 + 0.03 * moving;

    if (ghost && dist < GIVE_UP_RANGE) lostFor = 0;
    else lostFor += dt;
    if (lostFor > 3.0) enter('settling');
  }

  // The chase, with the steering taken out and handed to the game.
  //
  // This is stepChase with three lines changed and the rest lifted verbatim,
  // and the duplication is deliberate: the alternative is a dozen `if (driver)`
  // branches threaded through the busiest function in the file, where the two
  // behaviours would drift apart silently. Here they are side by side and any
  // change to the gait has to be made twice ON PURPOSE.
  //
  // What is different:
  //   pos and yaw come from the driver instead of being solved for;
  //   speed is MEASURED from the displacement rather than approached toward a
  //     want, so there is no TOP_SPEED ceiling and the cadence follows whatever
  //     the rules asked for;
  //   yawVel is likewise differenced, because the roll leans on it;
  //   it never gives up, since a skeleton leaving the chase is the rules' call
  //     and they express it by moving the thing rather than by stopping asking.
  function stepDriven(dt) {
    const want = driver(dt) || null;
    if (want) {
      const dx = want.x - pos.x;
      const dz = want.z - pos.z;
      const moved = Math.hypot(dx, dz);
      pos.x = want.x;
      pos.z = want.z;
      // Measured, not integrated. A driver that teleports (a skeleton eaten and
      // sent home) would otherwise report a speed of hundreds and blow the
      // gait up for a frame, so a jump beyond what a stride could cover is
      // treated as a cut rather than as motion.
      const raw = dt > 0 ? moved / dt : 0;
      const cut = raw > 12;
      const nextSpeed = cut ? 0 : raw;
      const nextYaw = typeof want.yaw === 'number'
        ? want.yaw
        : (moved > 1e-4 ? Math.atan2(dx, dz) : yaw);
      const dyaw = wrap(nextYaw - yaw);
      yawVel = cut || dt <= 0 ? 0 : clamp(dyaw / dt, -MAX_YAW_RATE, MAX_YAW_RATE);
      yaw = nextYaw;
      speed = nextSpeed;
      if (!cut) {
        travel += moved;
        cursor += moved / STEP_LENGTH;
      }
    } else {
      speed = 0;
      yawVel = 0;
    }

    const bleed = cursorFix * (1 - Math.exp(-CURSOR_LOCK_RATE * dt));
    cursor += bleed;
    cursorFix -= bleed;

    // From here down this is stepChase's gait, unchanged. `dist` and `err` are
    // the two things it used that only the steering knew, so they are stated
    // here: the driver has already pointed the figure where it is going, so the
    // heading error is zero by construction, and the head's gaze uses the
    // distance the driver reports if it offers one.
    const err = 0;
    const dist = typeof want?.dist === 'number' ? want.dist : Infinity;

    const cyc = (cursor * 0.5) % 1;
    const moving = smoothstep(0.05, 0.5, speed);
    const bob = -BOB * moving * (1 + Math.cos(cyc * 2 * TAU)) * 0.5;
    T.lift = mix(HIP_TALL, HIP_STALK, moving) + bob;
    T.sway = SWAY * moving * Math.sin(cyc * TAU);

    T.roll = clamp(-yawVel * 0.16, -0.22, 0.22);
    const lurch = 2.5 * moving * Math.sin(cyc * 2 * TAU + 0.6);
    T.root = (7 + 5 * moving + lurch) * D;
    T.lumbar = T.root + (-3 + 4 * moving) * D;
    T.thorax = T.lumbar + (-2 + 6 * moving) * D;

    T.headYaw = clamp(err, -0.75, 0.75);
    const gaze = (-4 + 10 * moving) * D + (dist < 3 ? -6 * D : 0);
    T.neck = mix(T.thorax, gaze, 0.45);
    T.head = gaze;

    const gait = clamp((S.hipR.value - S.hipL.value) * 0.38, -0.32, 0.32);
    T.shoulderL = (-74 - 6 * moving) * D + gait;
    T.shoulderR = (-74 - 6 * moving) * D - gait;
    T.elbowL = T.shoulderL - 34 * D - gait * 0.4;
    T.elbowR = T.shoulderR - 34 * D + gait * 0.4;
    T.wristL = T.elbowL - 16 * D;
    T.wristR = T.elbowR - 16 * D;
    T.spreadL = (14 + 6 * moving) * D;
    T.spreadR = T.spreadL;

    strain = 0.12 + 0.1 * moving;
    legBlend = 1;
    stepFeet(dt);

    chatter = 0.35 + 0.65 * smoothstep(4.0, 1.4, dist);
    const near = dist < STOP_RANGE + 0.9;
    jawBeat = near
      ? 0.34 * Math.max(0, Math.sin(clock * 5.2)) ** 2
      : 0.03 + 0.03 * moving;
  }

  // Gives up and goes back down. The same machinery in reverse, so the sink is
  // as heavy as the climb was.
  function stepSettle(dt) {
    const t = phaseTime;
    T.lift = mix(HIP_TALL, BURIED_Y - 0.05, easeInOutCubic(clamp01((t - 0.6) / 2.6)));
    const pitch = track([[0, 6], [0.6, 26], [1.6, 62], [3.2, 92]], t) * D;
    T.root = pitch;
    T.lumbar = pitch + 8 * D;
    T.thorax = T.lumbar + 12 * D;
    const gaze = track([[0, 8], [0.5, 40], [2.0, 96]], t) * D;
    T.neck = mix(T.thorax, gaze, 0.45);
    T.head = gaze;
    const arm = track([[0, -70], [0.8, -30], [2.4, 10]], t) * D;
    T.shoulderL = arm; T.shoulderR = arm;
    T.elbowL = arm - 50 * D; T.elbowR = arm - 50 * D;
    T.wristL = T.elbowL - 20 * D; T.wristR = T.elbowR - 20 * D;
    T.spreadL = 8 * D; T.spreadR = 8 * D;
    T.headYaw = 0;
    T.roll = 0;
    T.sway = 0;
    strain = 0.25;
    jawBeat = track([[0, 0.05], [1.0, 0.22], [2.6, 0.04]], t);
    chatter = 0.2;
    speed = 0;
    advanceSwings(dt);

    // The feet come off the floor and the legs go back to hanging. The IK
    // answer is copied into the free springs every frame it is in charge, so
    // this hands back from wherever the leg actually is.
    T.hipL = 0; T.hipR = 0;
    T.kneeL = 22 * D; T.kneeR = 26 * D;
    T.ankleL = 32 * D; T.ankleR = 34 * D;
    if (t > 0.5 && legBlend > 0) legBlend = Math.max(0, legBlend - dt * 1.6);
    if (t > 0.4 && !clipping) setClipping(true);
    if (t > 3.6) enter('buried');
  }

  // --- footsteps --------------------------------------------------------------
  // A foot swings when the distance cursor says its turn has come, or when the
  // body has turned far enough that leaving it planted would tie the legs in a
  // knot. Both triggers place the next plant a half step in front of that leg's
  // own hip, in the body's current frame, and from then on it is a world point
  // and the body walks past it.
  function advanceSwings(dt) {
    for (const side of ['L', 'R']) {
      const f = feet[side];
      if (f.swing >= 1) continue;
      f.swing = Math.min(1, f.swing + dt / f.dur);
      // The landing spot is re-aimed while the foot is in the air, because the
      // body turns during a swing and a target fixed at lift-off lands the foot
      // wherever the body used to be going. It freezes over the last third, so
      // the foot is not still chasing a moving mark as it touches down.
      if (f.retarget) {
        const hold = smoothstep(0.55, 0.92, f.swing);
        if (hold < 1) {
          aimStep(side, HALF_STEP, (1 - f.swing) * f.dur, v1);
          f.to.lerp(v1, (1 - hold) * (1 - Math.exp(-16 * dt)));
        }
      }
      if (f.swing >= 1) {
        f.plant.copy(f.to);
        f.yaw = yaw;
        // Lock the gait phase to the footfall. The step trigger is geometric,
        // so the cursor is only an estimate of where in the cycle the body is,
        // and a bob that drifts out of step with the feet is the thing that
        // makes a walk read as a puppet.
        //
        // The correction is HANDED TO A BLEED rather than applied here. cursor
        // is the only input to the bob, the sway and the lurch, and writing it
        // in one frame moved the gait phase by up to 0.22 of a step, which is
        // 40 degrees of the bob and a 21mm step in the hip's target: measured
        // over four strides it was the walk's second largest discontinuity,
        // after the toe-off. Bleeding it off keeps the whole point of the lock,
        // which is that the error cannot ACCUMULATE, and costs a phase rate
        // that is half again too fast for a few frames rather than a step.
        const err = Math.round(cursor) - cursor;
        if (Math.abs(err) < 0.3) cursorFix = err;
      }
    }
  }

  // Send one foot to a spot in the body's own frame. Used by the walk and by
  // the shuffle at the top of the rise, which is what brings the feet back
  // under the hips after standing up out of a staggered crouch.
  // Where a foot should land: a half step in front of its own hip, at the place
  // the body will HAVE REACHED by the time the foot gets there. Aiming at where
  // the body is now instead lands every step short, because the body walks out
  // from under the target during the swing, and the stride quietly collapses
  // into a shuffle.
  function aimStep(side, z, lead, out) {
    out.set(FOOT_X[side], -group.position.y / scale, z);
    group.localToWorld(out);
    out.y = 0;
    out.x += Math.sin(yaw) * speed * lead;
    out.z += Math.cos(yaw) * speed * lead;
    return out;
  }

  // How far the heel has come off, for a planted foot. It is a pure function of
  // how far the body has walked past the plant, so it reads the group's matrix
  // as it stands: a caller running before applyLegs therefore gets exactly the
  // pitch applyLegs used on the previous frame, which is the pose a swing has
  // to leave from.
  function heelOff(f) {
    group.worldToLocal(v3.copy(f.plant));
    return smoothstep(0.03, LIFT_BEHIND, -v3.z) * MAX_HEEL;
  }

  // Where the ankle pivot sits, in world, for a foot planted at `f` and rolled
  // up onto its toe by `pitch`. The CONTACT does not move: the ankle swings up
  // and forward about the toe tip. One function, used by the stance and by the
  // lift-off, so the two cannot disagree about where the ankle was.
  function ankleOnPlant(f, pitch, out) {
    const ch = Math.cos(pitch);
    const sh = Math.sin(pitch);
    const ahead = (TOE_AHEAD * (1 - ch) + M.y.ankle * sh) * scale;
    out.copy(f.plant);
    out.x += Math.sin(f.yaw) * ahead;
    out.z += Math.cos(f.yaw) * ahead;
    out.y += (M.y.ankle * ch + TOE_AHEAD * sh) * scale;
    return out;
  }

  function queueStep(side, z, dur = 0.32, retarget = false) {
    const f = feet[side];
    if (f.swing < 1) return;
    // THE SWING STARTS WHERE THE STANCE ENDED, which is not the plant.
    //
    // By the end of a stance the foot is up on its toe: at the full MAX_HEEL
    // the ankle pivot is 128mm above the floor and 78mm forward of the contact
    // point. The first version started the swing at the plant with the ankle
    // at standing height, so on the frame a foot lifted the ankle fell 115mm
    // and moved 72mm backwards in a single frame. Measured over four strides
    // that was a 60 degree jump at the knee, every step, on both legs, and it
    // pushed the target far enough out of reach that the two link solver sat on
    // its full-extension clamp for the two frames after it. That is the whole
    // of what read as jumpy legs.
    //
    // Recording the pose here rather than reconstructing it in applyLegs is
    // deliberate: the stance's pitch depends on where the body was, and the
    // body has moved on by the time the swing is drawn.
    f.liftPitch = heelOff(f);
    ankleOnPlant(f, f.liftPitch, f.fromAnkle);
    // The heading the stance held, kept before f.yaw is overwritten below. A
    // planted foot does not turn with the body, on purpose, so by the end of a
    // stance through a hard turn it can be most of a radian off the body's
    // current heading: at the top turn rate a 0.6s stance is 65 degrees. Taking
    // the live yaw on the first frame of the swing spun the foot through all of
    // that in one frame. Measured at the start of the chase, where the turn is
    // hardest, that was an 87 degree snap of the sole.
    f.fromYaw = f.yaw;
    aimStep(side, z, retarget ? dur : 0, f.to);
    f.swing = 0;
    f.dur = dur;
    f.retarget = retarget;
    f.yaw = yaw;
  }

  function stepFeet(dt) {
    advanceSwings(dt);
    // One foot at a time. Both in the air at once is a run, and this thing does
    // not run.
    if (feet.L.swing < 1 || feet.R.swing < 1) return;

    // Which foot most needs to move. The primary trigger is geometric: a foot
    // lifts when the body has walked far enough past it, which is the same
    // thing as saying the cadence is set by distance travelled. The cursor is
    // kept as a second trigger so a foot that is somehow neither behind nor out
    // to the side still takes its turn, and urgency wins over turn order, which
    // is what unpicks the transient at the start of a walk or after a hard turn.
    let pick = null;
    let best = 0.98;
    for (const side of ['L', 'R']) {
      group.worldToLocal(v1.copy(feet[side].plant));
      // Two ways to be overdue, combined rather than taken separately: a foot
      // the body has walked past, and a foot left out to the side by a turn.
      // Taking the larger of the two was wrong in a way that took a while to
      // see: on a turning start one foot would be 0.97 of the way to overdue on
      // width while the other was 0.90 of the way there on distance, so the
      // near foot stepped twice running and the far one was left more than a
      // leg's length behind, which pulled the hips down into a squat.
      const back = Math.max(0, -v1.z) / LIFT_BEHIND;
      const wide = Math.abs(v1.x - FOOT_X[side]) / 0.16;
      // Out of turn is allowed, but it has to be clearly more urgent.
      const urgency = Math.hypot(back, wide) * (side === nextStep ? 1 : 0.8);
      if (urgency > best) { best = urgency; pick = side; }
    }
    if (!pick) return;

    // Swing time follows speed, so the duty factor holds at any pace and the
    // cadence stays the distance cursor's to decide.
    queueStep(
      pick,
      HALF_STEP,
      clamp(speed > 0.05 ? ((2 - 2 * DUTY) * STEP_LENGTH) / speed : 0.34, 0.16, 0.45),
      true,
    );
    nextStep = pick === 'L' ? 'R' : 'L';
  }

  // --- hands ------------------------------------------------------------------
  // Where a hand should reach to: out in front of its own shoulder, on the
  // floor. Worked from the shoulder's real position rather than from the body's
  // origin, because during the climb the shoulder swings through most of a
  // metre while the hips barely move.
  const HAND_Y = 0.07;          // wrist height with the palm on the floor
  const HAND_AHEAD = 0.42;
  const HAND_OUT = 0.10;

  function aimHand(side, out) {
    J[`shoulder${side}`].getWorldPosition(out);
    group.worldToLocal(out);
    out.x += (side === 'L' ? 1 : -1) * HAND_OUT;
    out.z += HAND_AHEAD;
    out.y = -group.position.y / scale;
    group.localToWorld(out);
    out.y = 0;
    return out;
  }

  function reachHand(side, dur = 0.30) {
    const h = hands[side];
    h.from.copy(h.plant);
    aimHand(side, h.to);
    h.swing = 0;
    h.dur = dur;
  }

  // A hand lets go and reaches again once the shoulder has moved far enough
  // that hanging on would tear the arm off. Nothing about this is on a clock:
  // the body decides when the arms have to move by moving.
  function stepHands(dt) {
    for (const side of ['L', 'R']) {
      const h = hands[side];
      if (h.swing < 1) {
        h.swing = Math.min(1, h.swing + dt / h.dur);
        if (h.swing >= 1) h.plant.copy(h.to);
        continue;
      }
      J[`shoulder${side}`].getWorldPosition(v3);
      const reach = ARM[side].span * scale;
      if (v3.distanceTo(h.plant) > reach * 0.88) reachHand(side);
    }
  }

  // --- shed -------------------------------------------------------------------
  function maybeShed(t) {
    if (!debris) return;
    for (const plan of SHED_PLAN) {
      if (!shedLeft.includes(plan.bone) || t < plan.at) continue;
      // The cap, enforced here rather than by the length of the plan, so that
      // the plan can be re-timed or re-ordered without anyone having to
      // remember that the list is also the budget.
      if (shedFired.length >= SHED_BUDGET) return;
      const bone = rig.shed.get(plan.bone);
      shedLeft.splice(shedLeft.indexOf(plan.bone), 1);
      if (!bone) continue;
      // World velocity, so the bone leaves the hand going where the hand was
      // going rather than where the model happens to face.
      v1.set(plan.velocity[0], plan.velocity[1], plan.velocity[2]).applyAxisAngle(
        v2.set(0, 1, 0), yaw,
      );
      debris.spawn(bone, { velocity: v1.toArray(), spin: plan.spin });
      shedFired.push(plan.bone);
    }
  }

  // --- the jaw ----------------------------------------------------------------
  // The mandible is a pendulum on a hinge at the back of the skull, and the
  // chin hangs below and in front of it. So an upward acceleration of the skull
  // leaves the chin behind and opens the jaw, and a forward one swings it open
  // too. The torque about the hinge is r cross ma, and with the chin measured
  // at 0.19 below and 0.248 in front of the pivot those two components are all
  // this needs. Nothing about the walk cycle is fed to the jaw: it bounces on
  // every footfall because the skull does.
  // Measured off the rig rather than written down, because the lever arms are
  // the whole of the sensitivity and the skull has been resized twice already.
  const jawBox = new THREE.Box3();
  {
    J.jaw.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(J.jaw.matrixWorld).invert();
    const p = new THREE.Vector3();
    J.jaw.traverse((o) => {
      const attr = o.geometry?.attributes?.position;
      if (!attr) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const stride = Math.max(1, Math.ceil(attr.count / 400));
      for (let i = 0; i < attr.count; i += stride) {
        jawBox.expandByPoint(p.fromBufferAttribute(attr, i).applyMatrix4(m));
      }
    });
  }
  const JAW_R_Y = jawBox.isEmpty() ? 0.17 : Math.max(0.02, -jawBox.min.y);
  const JAW_R_Z = jawBox.isEmpty() ? 0.22 : Math.max(0.02, jawBox.max.z);
  const JAW_GAIN = 0.040;

  function driveJaw(dt) {
    // The skull's acceleration, measured off the rig one frame late. Velocity
    // is smoothed before it is differenced, because differencing twice at a
    // variable dt is otherwise mostly noise.
    J.head.getWorldPosition(headPos);
    J.head.getWorldQuaternion(headQuat);
    if (headPrimed) {
      v1.subVectors(headPos, headPrev).divideScalar(dt);
      v2.copy(v1).sub(headVel).divideScalar(dt);
      headVel.copy(approachVec(headVel, v1, 26, dt));
      headAcc.copy(approachVec(headAcc, v2, 18, dt));
    } else {
      headPrimed = true;
    }
    headPrev.copy(headPos);

    localAcc.copy(headAcc).applyQuaternion(headQuat.conjugate());
    const torque = JAW_GAIN * (JAW_R_Z * localAcc.y + JAW_R_Y * localAcc.z);

    // Chatter is a rattle rather than a wave: little impulses into the spring,
    // which is what teeth actually do. A sine here reads as a flipbook.
    chatterTimer -= dt;
    if (chatter > 0.02 && chatterTimer <= 0) {
      chatterTimer = 0.045 + rand() * 0.05;
      // Signed. An earlier version only ever kicked the jaw OPEN, which is not
      // a rattle: it is a bias, and it left the mandible hanging 14 degrees
      // open the whole time instead of clacking shut against its own teeth.
      S.jaw.velocity += (rand() - 0.5) * 2 * (0.6 + rand() * 0.6) * chatter * 3.4;
    }

    S.jaw.target = clamp(jawBeat + clamp(torque, -0.18, 0.45), -0.02, JAW_OPEN_MAX);
    S.jaw.step(dt);
    // Hard stops with a little restitution. The clack is here: a jaw closing
    // fast does not stop at zero, it bounces off its own teeth.
    if (S.jaw.value < 0) {
      S.jaw.value = 0;
      if (S.jaw.velocity < 0) S.jaw.velocity *= -JAW_BOUNCE;
    } else if (S.jaw.value > JAW_OPEN_MAX) {
      S.jaw.value = JAW_OPEN_MAX;
      if (S.jaw.velocity > 0) S.jaw.velocity *= -JAW_BOUNCE * 0.5;
    }
    J.jaw.rotation.x = S.jaw.value * (J.jaw.userData.openSign || 1);
  }

  const _av = new THREE.Vector3();
  function approachVec(from, to, rate, dt) {
    const k = Math.exp(-rate * dt);
    return _av.set(
      to.x + (from.x - to.x) * k,
      to.y + (from.y - to.y) * k,
      to.z + (from.z - to.z) * k,
    );
  }

  // --- applying ---------------------------------------------------------------

  // Everything except the jaw, which is physical, and the hip height, which is
  // stepped in the loop because the legs are solved against it.
  const POSE_KEYS = Object.keys(T).filter((k) => k !== 'jaw' && k !== 'lift');

  function applyPose(dt) {
    for (const key of POSE_KEYS) {
      S[key].target = T[key];
      S[key].step(dt);
    }

    // Tremor. Added AFTER the springs, because a spring is a low pass filter
    // and would swallow it. Two rates, so it reads as effort rather than as a
    // vibration: a slow one in the trunk and a fast one out at the hands.
    const shake = strain * strain;
    const slow = Math.sin(clock * 17.0) * 0.010 * shake;
    const fast = Math.sin(clock * 31.0 + 1.2) * 0.022 * shake;

    const root = S.root.value + slow;
    const lumbar = S.lumbar.value + slow * 1.4;
    const thorax = S.thorax.value + slow * 1.7;
    const neck = S.neck.value + slow * 2.0;
    const head = S.head.value + slow * 2.4;

    J.root.position.set(rootRest.x + S.sway.value, rootRest.y, rootRest.z);
    J.root.rotation.set(root, 0, S.roll.value);
    J.spineLower.rotation.x = lumbar - root;
    J.spineUpper.rotation.x = thorax - lumbar;
    J.neck.rotation.set(neck - thorax, S.headYaw.value * 0.4, 0);
    J.head.rotation.set(head - neck, S.headYaw.value * 0.6, 0);

    for (const side of ['L', 'R']) {
      const sgn = side === 'L' ? 1 : -1;
      const sh = S[`shoulder${side}`].value + fast * 0.5;
      const el = S[`elbow${side}`].value + fast;
      const wr = S[`wrist${side}`].value + fast * 1.6;
      let shoulderX = sh - thorax;
      let shoulderZ = sgn * S[`spread${side}`].value;
      let elbowX = el - sh;
      let wristX = wr - el;

      if (armBlend > 0) {
        // The chain hangs off the shoulder anchor, which is four joints down
        // from the group and has just been re-posed, so its matrix has to be
        // brought up to date before a world point can be pulled into it.
        const arm = J[`shoulder${side}`];
        arm.updateWorldMatrix(true, false);
        const h = hands[side];
        if (h.swing < 1) {
          v1.lerpVectors(h.from, h.to, easeInOutCubic(h.swing));
          v1.y = Math.sin(h.swing * Math.PI) * 0.16;
        } else {
          v1.copy(h.plant);
        }
        v1.y += HAND_Y * scale;
        arm.parent.worldToLocal(v1);
        const ik = solveChain(ARM[side], v1);
        shoulderX = mix(shoulderX, ik.hipX, armBlend);
        shoulderZ = mix(shoulderZ, ik.hipZ, armBlend);
        elbowX = mix(elbowX, ik.knee, armBlend);
        // The hand keeps its authored angle relative to the forearm, so the
        // claw survives whatever the solve does to the arm above it.
        wristX = mix(wristX, wr - el, armBlend);
        if (armBlend > 0.99) {
          S[`shoulder${side}`].snap(thorax + ik.hipX);
          S[`elbow${side}`].snap(thorax + ik.hipX + ik.knee);
          S[`wrist${side}`].snap(thorax + ik.hipX + ik.knee + wristX);
        }
      }

      J[`shoulder${side}`].rotation.set(shoulderX, 0, shoulderZ);
      J[`elbow${side}`].rotation.x = elbowX;
      J[`wrist${side}`].rotation.x = wristX;
    }
  }

  // The legs, after the root is posed, because the IK is solved in the root's
  // frame and the root has just moved.
  function applyLegs(dt) {
    // Only this node's matrix and the group's are needed, so the whole
    // hierarchy is not walked twice a frame for the sake of two hips.
    group.updateWorldMatrix(true, false);
    J.root.updateWorldMatrix(false, false);

    for (const side of ['L', 'R']) {
      const free = {
        hipX: S[`hip${side}`].value - S.root.value,
        hipZ: 0,
        knee: S[`knee${side}`].value - S[`hip${side}`].value,
        ankle: S[`ankle${side}`].value - S[`knee${side}`].value,
      };

      let hipX = free.hipX;
      let hipZ = free.hipZ;
      let knee = free.knee;
      let ankle = free.ankle;

      if (legBlend > 0) {
        const f = feet[side];
        // The ankle pivot's world target, and the pitch the foot holds to get
        // there. Both come out of the same question: where is this foot
        // touching the floor, and how is it standing on that.
        let pitchNow = 0;
        if (f.swing < 1) {
          // In the air. The ankle DESCENDS from the toe-off pose to the landing
          // pose, eased along the ground, with a hump on top. It is a hump on a
          // descent rather than the whole of the lift because that is what a
          // real ankle does: it is at its highest as the toe leaves, not half
          // way through the swing.
          const u = f.swing;
          const standY = f.to.y + M.y.ankle * scale;
          v2.copy(f.to).setY(standY);
          v1.lerpVectors(f.fromAnkle, v2, easeInOutCubic(u));
          // The hump is only what the toe-off did not already provide. At mid
          // swing the descent has handed back exactly half the height the
          // stance carried in, so half of it is what is left to make up, and
          // FOOT_LIFT keeps its old meaning: the ankle's height above standing
          // at the middle of the swing. A foot picked up flat instead, which is
          // the shuffle at the top of the rise or a step forced by a turn,
          // carries nothing in and gets the whole of it from here.
          const carried = Math.max(0, f.fromAnkle.y - standY);
          const arc = Math.max(0, FOOT_LIFT * scale - 0.5 * carried);
          v1.y += Math.sin(u * Math.PI) * arc;
          // Rolls out of the pitch the stance ended on, leads with the heel
          // through the second half, and comes back to flat for the landing.
          // Both ends are EXACT rather than clamped into place: the curve
          // starts at the stance's own pitch and reaches zero with zero slope,
          // and zero is what the planted branch reads on the frame it takes
          // over, so neither handover has a step in it.
          const raw = f.liftPitch * (1 - u) ** 1.6 - TOE_UP * u * u * (1 - u) ** 1.5;
          // And the clearance clamp is now a guard that never fires rather than
          // a shaper. Exact, so that the pose the swing starts from is exactly
          // representable: see TOE_R and HEEL_R.
          const h = v1.y / scale;
          pitchNow = clamp(
            raw,
            Math.acos(clamp(h / HEEL_R, -1, 1)) - HEEL_PHI,
            Math.asin(clamp(h / TOE_R, -1, 1)) - TOE_PHI,
          );
        } else {
          // Planted. The heel comes off as the body walks past, and from then
          // on the foot is pivoting on its toe: the ankle rises and moves
          // forward while the CONTACT stays exactly where it was put. That is
          // the whole trick that lets a figure with legs this short take a
          // stride, and it is also why the ankle is placed by rotating it about
          // the toe rather than by adding a fudge to its height.
          pitchNow = heelOff(f);
          ankleOnPlant(f, pitchNow, v1);
        }
        footPitch[side] = pitchNow;
        J.root.worldToLocal(v1);
        const ik = solveChain(LEG[side], v1);
        ikShort[side] = ik.short;
        const swingPitch = pitchNow;
        const kneeWorld = S.root.value + ik.hipX + ik.knee;
        hipX = mix(hipX, ik.hipX, legBlend);
        hipZ = mix(hipZ, ik.hipZ, legBlend);
        knee = mix(knee, ik.knee, legBlend);
        ankle = mix(ankle, swingPitch - kneeWorld, legBlend);

        // Keep the free-pose springs alongside the IK answer, so dropping back
        // to authored angles later starts from where the leg actually is.
        if (legBlend > 0.99) {
          S[`hip${side}`].snap(S.root.value + ik.hipX);
          S[`knee${side}`].snap(S.root.value + ik.hipX + ik.knee);
          S[`ankle${side}`].snap(kneeWorld + swingPitch);
        }
      }

      J[`hip${side}`].rotation.set(hipX, 0, hipZ);
      J[`knee${side}`].rotation.x = knee;
      J[`ankle${side}`].rotation.x = ankle;

      if (legBlend > 0) {
        // The foot's orientation is set in WORLD terms and then pulled back
        // into the ankle's parent, rather than being written as three local
        // Euler angles. Two things go wrong with the Euler version and both are
        // visible. Everything below the hip inherits the body's yaw, so a
        // planted foot spins on the spot as the body turns and at the top turn
        // rate that drags the toe a quarter of a metre sideways; and the pelvis
        // roll plus the hip's own sideways swing tip the sole onto its outside
        // edge, which puts the far edge through the floor. Composing the
        // parent's rotation from the values just written and inverting it fixes
        // both exactly, and costs six quaternion multiplies.
        const f = feet[side];
        // A planted foot holds the heading it was planted at; a swinging one
        // turns from that heading onto the body's current one over the swing,
        // rather than arriving at it on the first frame. Both ends are exact:
        // the swing starts at the stance's yaw and ends at the live yaw, which
        // is what advanceSwings writes into f.yaw as it lands.
        const footYaw = f.swing >= 1
          ? f.yaw
          : f.fromYaw + wrap(yaw - f.fromYaw) * easeInOutCubic(f.swing);
        qWant.setFromAxisAngle(X_AXIS, footPitch[side]);
        qTmp.setFromAxisAngle(Y_AXIS, footYaw);
        qWant.premultiply(qTmp);

        qParent.setFromAxisAngle(Y_AXIS, yaw);
        qParent.multiply(qTmp.setFromEuler(eul.set(S.root.value, 0, S.roll.value, 'XYZ')));
        qParent.multiply(qTmp.setFromEuler(eul.set(hipX, 0, hipZ, 'XYZ')));
        qParent.multiply(qTmp.setFromAxisAngle(X_AXIS, knee));

        qWant.premultiply(qParent.invert());
        J[`ankle${side}`].quaternion.slerp(qWant, legBlend);
      }
    }
  }

  // The model puts a contact patch under each ankle. They are children of the
  // group, so they sink with it, and a patch under a buried skeleton is a stain
  // on the floor with nothing above it.
  function applyContacts() {
    if (!contacts.length) return;
    const show = phase === 'buried' ? 0 : clamp01((T.lift + 0.2) / 0.6);
    for (let i = 0; i < contacts.length; i++) {
      const patch = contacts[i];
      patch.visible = show > 0.01;
      if (!patch.visible) continue;
      const joint = i === 0 ? J.ankleL : J.ankleR;
      joint.getWorldPosition(v1);
      // A foot in the air keeps its patch, but faintly. A contact stain at full
      // strength under a foot 15cm off the floor is the sort of thing nobody
      // can name and everybody can see.
      const lift = clamp01(1 - Math.max(0, v1.y - M.y.ankle * scale) / 0.22);
      if (patch.material) patch.material.opacity = contactOpacity[i] * show * (0.35 + 0.65 * lift);
      group.worldToLocal(v1);
      patch.position.set(v1.x, (0.004 - group.position.y) / scale, v1.z);
    }
  }

  // The highest the hip pivot can go with the feet where they are. Worked in
  // the group's own frame and then lifted into world, so it costs a couple of
  // trig calls rather than a matrix update.
  function liftLimit() {
    if (legBlend < 0.5) return Infinity;
    const reach = LEG.L.span * scale * 0.995;
    const cr = Math.cos(S.roll.value);
    const sr = Math.sin(S.roll.value);
    const cp = Math.cos(S.root.value);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const sp = Math.sin(S.root.value);
    let cap = Infinity;
    for (const side of ['L', 'R']) {
      const f = feet[side];
      if (f.swing < 1) continue;
      // The hip in the group's frame: the pelvis is swayed sideways and rolled,
      // and rolling swings one hip up and the other down by as much as 25mm,
      // which is worth having when the margin at full stretch is 20.
      const hx = LEG[side].root.x;
      const lx = rootRest.x + S.sway.value + hx * cr;
      const ly = hx * sr * cp;
      const lz = rootRest.z + hx * sr * sp;
      const wx = pos.x + (lx * cy + lz * sy) * scale;
      const wz = pos.z + (-lx * sy + lz * cy) * scale;
      const horiz = Math.hypot(wx - f.plant.x, wz - f.plant.z);
      const up = Math.sqrt(Math.max(reach * reach - horiz * horiz, 0));
      cap = Math.min(cap, f.plant.y + M.y.ankle * scale + up - ly * scale);
    }
    // A floor under the ceiling. If something has gone wrong enough that a foot
    // is most of a leg out of position, a figure crouching to reach it looks
    // far worse than a foot a centimetre off the ground for the two frames it
    // takes the gait to fix itself.
    return Math.max(cap, (HIP_TALL - 0.25) * scale);
  }

  // --- the loop ---------------------------------------------------------------

  function update(dt, ghost) {
    dt = clamp(dt || 0, 0, 1 / 20);
    if (!(dt > 0)) return;
    clock += dt;
    phaseTime += dt;

    // The ghost arrives as a Vector3, as the Ghost itself, or not at all.
    let ghostPos = null;
    if (ghost) {
      if (ghost.isVector3) ghostPos = target.copy(ghost);
      else if (ghost.pos?.isVector3) ghostPos = target.copy(ghost.pos);
      else if (typeof ghost.x === 'number') ghostPos = target.set(ghost.x, ghost.y || 0, ghost.z);
      if (ghostPos) ghostPos.y = 0;
    }

    // The jaw is driven from the pose the last frame left behind. One frame of
    // lag is exactly what a hinge with mass on it looks like anyway.
    driveJaw(dt);

    // Defaults every phase is free to override, so a value set in one phase
    // cannot leak into the next one and quietly hold the head turned.
    T.headYaw = 0;
    T.roll = 0;
    T.sway = 0;

    switch (phase) {
      case 'buried': stepBuried(dt, ghostPos); break;
      case 'emerging': stepEmerge(dt, ghostPos); break;
      case 'rising': stepRise(dt); break;
      case 'chasing': stepChase(dt, ghostPos); break;
      case 'settling': stepSettle(dt); break;
      default: break;
    }

    S.lift.target = T.lift;
    S.lift.step(dt);
    // A leg cannot get longer than a leg. The hips rise until the planted feet
    // run out of leg and then they stop, which is what actually happens when
    // somebody stands up too fast: the knees lock out, the momentum goes into
    // the torso, and the wobble that follows is the body catching itself. It is
    // also the only thing standing between the rise and a figure that lifts its
    // own feet off the floor at the top of the heave.
    const cap = liftLimit();
    liftCap = cap;
    if (S.lift.value > cap) {
      S.lift.value = cap;
      if (S.lift.velocity > 0) S.lift.velocity = 0;
    }
    group.position.set(pos.x, S.lift.value - M.y.hip * scale, pos.z);
    group.rotation.y = yaw;

    applyPose(dt);
    applyLegs(dt);
    applyContacts();

    if (debris) debris.update(dt);
  }

  function reset() {
    pos.copy(home);
    yaw = homeYaw;
    yawVel = 0;
    speed = 0;
    travel = 0;
    cursor = 0;
    nextStep = 'R';
    legBlend = 0;
    armBlend = 0;
    handsDown = false;
    cursor = 0;
    cursorFix = 0;
    enter('buried');
    stepBuried(0, null);
    // Snapped rather than eased into: easing in from zero on frame one reads as
    // the rig assembling itself out of its bind pose.
    for (const key of POSE_KEYS) S[key].snap(T[key]);
    S.jaw.snap(jawBeat);
    S.lift.snap(T.lift);
    group.position.set(pos.x, S.lift.value - M.y.hip * scale, pos.z);
    group.rotation.y = yaw;
    applyPose(1 / 60);
    applyLegs(1 / 60);
    applyContacts();
  }

  reset();

  const api = {
    update,
    reset,
    get state() { return phase; },
    // For the game, which owns the state machine. The autonomous scene never
    // calls either of these: it decides its own phases from the ghost's
    // distance, which is what wakeRange is for.
    //
    // setPhase is a request rather than a command, and it no-ops when the
    // phase already matches, because enter('buried') resets the gait cursor and
    // calling it every frame would freeze the figure mid-stride.
    setPhase(next) {
      if (next && next !== phase) enter(next);
    },
    // Where it climbs out of. The rules place the graves, so `home` cannot be
    // wherever the group happened to be constructed. Only meaningful while
    // buried: it moves the hole, not the figure.
    moveHome(x, z, y) {
      home.set(x, home.y, z);
      if (typeof y === 'number') homeYaw = y;
      if (phase === 'buried') {
        pos.copy(home);
        yaw = homeYaw;
      }
    },
    // Not part of the contract. A performance that is asserted numerically is
    // one that stays fixed: the harness reads foot slip, turn rate and phase
    // dwell out of here rather than off a screenshot.
    metrics() {
      const out = {
        phase, phaseTime, clock, speed, yaw, yawVel, travel, cursor,
        hipY: S.lift.value, jaw: S.jaw.value, legBlend, strain, clipping,
        shed: shedFired.slice(),
        // Whether the shed bones have actually come to rest. A bone that slides
        // for ever or vibrates never leaves `live`, so this is the assertion.
        debris: debris?.stats?.() || null,
        feet: {},
      };
      // The joints a pop shows up in, as LOCAL angles, plus the two numbers
      // that say whether the leg was asked for something it could not do.
      // Nothing here reports the ankle's own rotation.x: applyLegs writes the
      // foot as a quaternion, so the euler that comes back out of it is a
      // decomposition that jumps near its own singularity even when the foot is
      // turning smoothly. The honest measure of the foot's orientation is the
      // toe minus the ankle, and both are published below.
      out.root = S.root.value;
      out.roll = S.roll.value;
      out.knee = { L: J.kneeL.rotation.x, R: J.kneeR.rotation.x };
      out.hip = { L: J.hipL.rotation.x, R: J.hipR.rotation.x };
      out.swing = { L: feet.L.swing, R: feet.R.swing };
      // Metres the IK target was out of the leg's reach. Anything above zero
      // means the solver is sitting on its full-extension clamp.
      out.short = { L: ikShort.L, R: ikShort.R };
      // The ceiling the planted feet put on the hip height.
      out.liftCap = liftCap;
      for (const side of ['L', 'R']) {
        J[`ankle${side}`].getWorldPosition(v1);
        // The contact point, not the pivot. Once the heel is off, the ankle is
        // supposed to be moving and the toe is supposed not to be, so the toe
        // is the only honest place to measure foot slip.
        v2.set(0, -M.y.ankle, TOE_AHEAD);
        J[`ankle${side}`].localToWorld(v2);
        out.feet[side] = {
          world: v1.toArray(),
          toe: v2.toArray(),
          swinging: feet[side].swing < 1,
          plant: feet[side].plant.toArray(),
        };
      }
      return out;
    },
    dispose() {
      setClipping(false);
    },
  };

  // Harness hook. metrics() is only useful to something that can reach this
  // object, and the page's own test hook has no handle on the scene graph, so
  // every performance built in a browser registers itself here. It is a list
  // rather than a single slot because a lab page can build more than one.
  if (typeof window !== 'undefined') (window.__skeletons ||= []).push(api);

  return api;
}
