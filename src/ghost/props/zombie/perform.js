import * as THREE from 'three';
import M, { LIMITS, GAIT } from './metrics.js';
import { Spring, easeOutBack, easeInOutCubic, easeOutElastic } from '../skeleton/motion.js';

// The chibi zombie's performance: buried, claws its way out of the ground,
// hauls itself upright, and then shambles after the ghost.
//
// It is a SIBLING of ../skeleton/perform.js, not a reuse of it, and the reasons
// are written out at the bottom of this comment because the decision is the
// most consequential thing in the file. What it does reuse is the METHOD, and
// the method is the same one the ghost's cloth is built on:
//
//   * every joint angle is a spring target, never a keyframe played back. The
//     forearm lags the upper arm, the head lags the body, the jaw lags
//     everything, and none of that is authored.
//   * the legs are inverse kinematics onto FOOT PLANTS fixed in world space.
//     The walk is driven by distance travelled rather than by elapsed time, so
//     the feet cannot skate at any speed.
//   * the head and the jaw are hung off the body's own MEASURED acceleration.
//     They move because the body moved, one frame late, which is the whole of
//     what makes a heavy head read as heavy.
//
// ANGLES. Same convention as the skeleton's two performances, and it is worth
// restating because everything below is authored in it. Every joint in the rig
// is identity at rest and rotations about X commute, so "world pitch" here
// means the SUM of rotation.x down the chain to that joint: the angle the
// segment has swung from its rest direction. Zero is the rest pose. For the
// spine, positive leans the chest forward. For a limb hanging down, positive
// swings it backward and negative swings it forward. Local rotations are
// recovered at the end by subtracting the parent's world pitch.
//
// SIDES. metrics.js LEFT_X: the figure faces +Z with +Y up, so its own LEFT is
// at POSITIVE x. Everything here that says L is at +x. Getting this backwards
// produced a cross-limbed walk in an earlier pass of the skeleton and nobody
// saw it until it ran.
//
// --- WHY A SIBLING AND NOT A REUSE ------------------------------------------
//
// Reuse was the preferred answer going in and it does not survive contact with
// this figure. Four things break, in increasing order of how hard they are to
// paper over.
//
// 1. perform.js reads its metrics at MODULE scope. `import M from './metrics.js'`
//    plus twenty derived constants (HIP_TALL, HIP_STALK, HIP_CROUCH, HALF_STEP,
//    LIFT_BEHIND, FOOT_LIFT, TOE_AHEAD, HEEL_BACK, TOE_R, TOE_PHI, ...) that are
//    evaluated once when the module loads. There is no seam to pass a different
//    figure through. This one is only a refactor, and the report says exactly
//    what that refactor would be.
//
// 2. The zombie's ARMS CANNOT REACH THE SKELETON'S POSES. metrics.js publishes
//    LIMITS.shoulder.x as [-2.60, 1.10]. The skeleton's climb drives the right
//    shoulder to -168 degrees, which is -2.93 rad, 19 degrees past the stop,
//    and the left to -158, 9.6 degrees past. Those are the two beats where a
//    hand punches up through the surface, so it is not a pose that can be
//    trimmed: the whole opening of the emergence is authored outside this
//    figure's range. The chase is the same story from the other end: it holds
//    both arms at -74 degrees of world pitch, out in front, and the body agent's
//    own note is that "the arms are short enough that a full forward reach
//    brings the hands to the chin". Reused verbatim, the zombie walks with its
//    claws in its mouth.
//
// 3. The GAIT is tuned in absolute metres to a 1.15 leg. HALF_STEP 0.36 and
//    LIFT_BEHIND 0.42 on a leg that measures 0.527 from hip pivot to ankle
//    pivot is a stride 68% of the whole leg reached forward, which the two-link
//    solver cannot answer: it sits on its full-extension clamp for the entire
//    stance. Scaling them by leg length fixes the geometry and produces a
//    skeleton's walk at chibi scale, which is a mannequin. The two numbers that
//    actually carry a chibi are the ones the skeleton has almost none of: the
//    lateral weight shift, which has to be a large fraction of a hip separation
//    that is 0.375 of the leg's length here against 0.217 on the skeleton, and
//    the head lag, below.
//
// 4. The HEAD is a third of the height and there is no neck under it. On the
//    skeleton the skull is 16.7% of the height on a 0.145 neck and its spring
//    is stiff enough to be effectively rigid; the head is a small weight the
//    chest carries. Here the head is 33.0% of the height, its inertia about the
//    atlas is roughly (0.330/0.167)^3 = 7.7 times the skeleton's for the same
//    density, and metrics.js caps the neck at 0.30 rad in every axis because
//    past that the skull ball drives through the deltoid. A head that big on a
//    joint that short cannot be posed; it has to be SIMULATED, or the figure
//    reads as a puppet on rails. That is the single biggest block of new code
//    here and there is nothing in perform.js it could have been grafted onto.
//
// What that leaves is a file that shares perform.js's shape and almost none of
// its numbers, which is what a sibling is. Where a helper is genuinely
// figure-independent it is IMPORTED rather than copied: Spring and the three
// easings come from ../skeleton/motion.js, whose own contract says it is model
// independent. dance.js copied its helpers instead, and this file does not,
// because a second copy of a critically damped spring solver is a second thing
// that can drift.

const D = Math.PI / 180;
const TAU = Math.PI * 2;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const G = 9.81;

// --- small helpers -----------------------------------------------------------
// clamp, clamp01, smoothstep, mix, wrap, approach, track and mulberry32 have
// the same definitions as in perform.js and dance.js. They are private in both
// and this file may not edit either, so they are restated. They are pure and
// they have no reason to drift; the things that DO drift, the spring and the
// easings, are imported instead.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a || 1)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const approach = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);

function wrap(a) {
  a = (a + Math.PI) % TAU;
  return (a < 0 ? a + TAU : a) - Math.PI;
}

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

// --- ranges the whole scene shares -------------------------------------------
// These are about the GHOST and the size of the graveyard rather than about the
// figure, so they are the skeleton's numbers unchanged. STOP_RANGE is not: it
// is an arm's length, and this figure's arms are half the length.
const WAKE_RANGE = 7.0;
const GIVE_UP_RANGE = 13.0;
const MAX_YAW_RATE = 1.6;             // rad/s. Slower than the skeleton's 1.9.
const CURSOR_LOCK_RATE = 5.0;

// --- the climb out -----------------------------------------------------------
//
// Authored in world pitch (degrees) and in NORMALISED hip height, where 0 is
// buried and 1 is the crouch it stands up out of, so the tables survive a
// change of figure size. Times are seconds into the emerge, in table time; see
// emergeTime for the warp that maps real seconds onto them.
//
// The shape of it, and it is deliberately the skeleton's shape because the
// skeleton's is good: one clawed hand breaks the surface and gropes, the second
// follows, then THE HEAD comes up, and then it levers itself over the lip and
// folds its legs under.
//
// What is re-authored for a chibi:
//
//   THE HEAD IS THE BEAT. On the skeleton the skull breaking the surface is one
//   key in a fifteen-key gaze track. Here the head is a third of the figure and
//   it is the largest single object in the shot, so it gets a held beat of its
//   own: the surface breaks at table 2.1, the head is fully clear and thrown
//   back at 2.6, and nothing else changes between 2.6 and 3.0 except a shake.
//   The dirt shake is an IMPULSE into the head springs rather than a curve, so
//   what is on screen is a heavy head ringing on a short neck.
//
//   THE TORSO BARELY PITCHES. The skeleton opens at 100 degrees, face down and
//   past horizontal, because it has a long spine and the pose reads along it.
//   This figure's whole torso is 0.28 units from hip pivot to shoulder and its
//   head is 0.594, so at 100 degrees the head is buried in the floor and the
//   body is a detail behind it. It opens at 78 and the difference is made up by
//   the head and by digging the hips deeper.
//
//   THE ARMS STAY INSIDE LIMITS.shoulder. Nothing here passes -145 degrees of
//   world pitch, against the -2.60 rad (-149) stop, and the reach that the
//   skeleton got from a 0.74 upper arm this figure gets from starting shallower
//   and from the hands planting closer in.
const EMERGE_END = 5.2;

const CRAWL = {
  // Normalised hip height, 0 buried and 1 at the crouch.
  hipU: [[0, 0], [0.55, 0.02], [1.9, 0.04], [2.4, 0.16], [3.0, 0.20],
    [3.6, 0.44], [4.4, 0.74], [5.2, 1]],
  // Torso world pitch. 78 is face down, 34 is the crouch it stands out of.
  pitch: [[0, 78], [0.9, 78], [1.6, 72], [2.4, 58], [3.4, 46], [4.3, 38], [5.2, 34]],
  // Extra bend at the two spine joints, on top of the torso pitch. Negative
  // arches the chest up and away from the floor, which is what the shoulders
  // have to do for the arms to reach out in front at all. Half the skeleton's
  // amplitude, because LIMITS.spineLower and LIMITS.spineUpper are half as
  // generous and because there is a third as much spine to bend.
  lumbar: [[0, 8], [1.6, 4], [2.4, -4], [3.4, -8], [5.2, -4]],
  thorax: [[0, 6], [1.6, 1], [2.4, -6], [3.4, -9], [4.3, -6], [5.2, -2]],
  // Head angle RELATIVE TO THE CHEST, in degrees, positive nodding forward.
  //
  // Relative and not absolute, which is a change of authoring convention from
  // the skeleton's and is forced by LIMITS. The head joint's whole range is
  // [-0.55, 0.50] rad and the neck's is [-0.30, 0.30], so the head can turn no
  // more than about 40 degrees against the chest before the skull ball is
  // through the deltoid. An absolute gaze track, which is what the skeleton
  // writes, silently spends all of that on whatever the torso happens to be
  // doing and then clamps: the skeleton's own climb asks for 110 degrees of
  // absolute head pitch against a chest at 124, which is 67 degrees of head on
  // this figure, and it would arrive as a head frozen on its stop for two
  // seconds. Authored relative, every one of these is inside the budget by
  // construction and the TORSO carries the rest of the swing.
  //
  // THE HELD BEAT IS 2.1 TO 3.0: the surface breaks, the head comes right back
  // to its stop, and it stays there while it shakes the dirt off.
  gazeRel: [[0, 34], [1.4, 30], [2.1, 2], [2.6, -36], [3.0, -32], [3.4, -18],
    [3.9, -5], [5.2, -2]],

  // Right arm, the one that breaks the surface. World pitch: 0 hangs down,
  // -90 reaches straight forward, -145 is as high as LIMITS.shoulder allows.
  // These follow the SHOULDER, which is under the floor until about t = 3.2.
  armR: [[0, 18], [0.32, -138, easeOutBack], [0.62, -144], [1.0, -132],
    [1.5, -108], [2.2, -94], [3.0, -78], [3.6, -58], [4.3, -40], [5.2, -30]],
  elbowR: [[0, 74], [0.32, 26], [0.62, 14], [1.2, 48], [2.0, 56], [3.0, 44], [4.0, 26], [5.2, 30]],
  wristR: [[0, 10], [0.5, -6], [0.85, 40], [1.4, 30], [2.5, 12], [5.2, 6]],
  // Left arm, the same beats about two thirds of a second behind and shallower.
  armL: [[0, 22], [0.9, 22], [1.15, -134, easeOutBack], [1.5, -142], [2.0, -120],
    [2.6, -100], [3.2, -80], [3.8, -60], [4.4, -42], [5.2, -32]],
  elbowL: [[0, 78], [1.15, 28], [1.5, 16], [2.0, 50], [2.8, 54], [3.6, 36], [4.2, 26], [5.2, 32]],
  wristL: [[0, 12], [1.3, -4], [1.7, 38], [2.3, 26], [3.2, 10], [5.2, 6]],
  // Arm flare, so the hands plant wide of the shoulders rather than under them.
  // Capped at LIMITS.shoulder.z, which is 1.45 rad, nowhere near binding.
  spread: [[0, 6], [1.0, 18], [2.4, 26], [3.6, 18], [5.2, 12]],

  // How hard it is working, 0 to 1. Drives the tremor, the jaw's gape and how
  // much the head is thrown about.
  strain: [[0, 0.2], [0.35, 1.0], [0.9, 0.55], [1.5, 0.85], [2.1, 0.75],
    [2.6, 1.0], [3.2, 0.8], [3.9, 0.9], [4.6, 0.45], [5.2, 0.3]],
  // Jaw, on top of whatever the head's own motion is doing to it. A zombie's
  // jaw hangs; the resting value here is well above the skeleton's.
  jaw: [[0, 0.14], [0.8, 0.20], [1.5, 0.38], [2.1, 0.50], [2.6, 0.30],
    [3.0, 0.52], [3.6, 0.34], [4.4, 0.22], [5.2, 0.26]],
};

// The two beats where the head is thrown hard enough to shake dirt off it, in
// table time, and how hard. Impulses into the head's springs rather than keys
// in the gaze track, because a spring that is kicked rings and a curve does
// not, and the ring is the whole point.
const HEAD_SHAKE = [
  { at: 2.60, pitch: -7.5, yaw: 5.0, roll: -3.0 },
  { at: 2.92, pitch: 4.5, yaw: -6.5, roll: 3.5 },
];

export function createZombiePerformance({
  rig,
  scene = null,
  debris = null,
  renderer = null,
  seed = 3,
  wakeRange = WAKE_RANGE,
  // Which leg is the stiff one. 'auto' picks off the seed, which is what five
  // of these on screen at once wants: five identical limps read as five copies
  // of one asset, and the limp is the loudest thing about the walk.
  stiffSide = 'auto',
  // EXTERNAL DRIVE, for the game. Identical contract to the skeleton's, because
  // swapping a zombie in for a skeleton has to be a change of one factory
  // function and nothing else.
  //
  // Left null, this performance is autonomous: it wakes when the ghost comes
  // within wakeRange, climbs out, and then shambles at its own TOP_SPEED.
  //
  // Given a driver, the STEERING and only the steering is handed over: called
  // once a frame, it returns `{ x, z, yaw, dist }` and the chase adopts them.
  // Everything downstream still works because the gait was never driven by the
  // steering: it is driven by `speed` and `cursor`, and both are MEASURED from
  // the displacement the driver asked for rather than integrated from a want.
  // The driver is consulted only while chasing; buried, emerging and rising are
  // the spawn animation and the rules read `state` to know where it has got to.
  driver = null,
} = {}) {
  const J = rig.joints;
  const group = rig.group;
  const scale = group.scale.x || 1;
  const rand = mulberry32(seed);

  // Where it is buried. Everything comes home to here.
  const home = group.position.clone();
  let homeYaw = group.rotation.y;
  const rootRest = J.root.position.clone();

  // ===========================================================================
  // MEASURING THE FIGURE
  // ===========================================================================
  //
  // Everything below is taken off the RIG rather than off metrics.js wherever
  // the rig can answer, and off metrics.js only where it cannot. That is
  // perform.js's own rule for its leg chain, applied to the whole figure, and
  // it buys three things:
  //
  //   * the performance ran against a stub rig before model.js existed, and it
  //     will run against the real one with no edit, which is what let this half
  //     be built in parallel with the body;
  //   * a model that drifts from its own metrics cannot silently put the feet
  //     through the floor, because the numbers that place the feet come from
  //     the thing that has the feet on it;
  //   * the derived constants below reproduce the SKELETON's hand-tuned values
  //     to within a few percent when this file is pointed at a skeleton rig.
  //     That is the check that the formulas are proportional relationships and
  //     not chibi numbers with a scale factor bolted on. See derived() and the
  //     harness, which prints both columns side by side.

  group.updateMatrixWorld(true);
  const _inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const _p = new THREE.Vector3();
  // A joint's rest position in the GROUP's own space, unscaled.
  function atGroup(joint, out = new THREE.Vector3()) {
    joint.getWorldPosition(out);
    return out.applyMatrix4(_inv);
  }

  // The bounding box of everything hanging off a node, in that node's own
  // frame. Same sampling trick perform.js uses to find the jaw's lever arms:
  // strided, because a full vertex walk of a boot is thousands of points and
  // the answer is a box.
  function subtreeBox(node) {
    const box = new THREE.Box3();
    if (!node) return box;
    node.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    node.traverse((o) => {
      const attr = o.geometry?.attributes?.position;
      if (!attr) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      const stride = Math.max(1, Math.ceil(attr.count / 400));
      for (let i = 0; i < attr.count; i += stride) {
        box.expandByPoint(p.fromBufferAttribute(attr, i).applyMatrix4(m));
      }
    });
    return box;
  }

  // Two link chain in its own YZ plane. Lifted from perform.js, where the
  // derivation is: only rotation.x moves a limb in the sagittal plane and
  // rotation.x preserves the local X coordinate, so the link lengths are the
  // projections and the rest angles are where those projections point.
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
      cx: kp.x + ap.x,
      // Which way the middle joint already bends in the rest pose. This rig is
      // authored DEAD STRAIGHT in both limbs (metrics.js REST puts the knee and
      // the ankle at the same x and z as the hip), so `rest` is zero on every
      // chain and the fallback is what actually decides. A knee folds backward
      // and an elbow folds forward.
      //
      // The fallback is used rather than LIMITS.elbow on purpose: LIMITS.elbow
      // is published as x [0.00, 2.30], and a positive rotation.x on a limb
      // hanging down swings its lower segment BACKWARD, which is a knee and not
      // an elbow. Either that entry is a sign slip or it means flexion
      // magnitude; see the report. Taking the direction off the rest pose and
      // the anatomy cannot be wrong either way.
      bend: Math.abs(rest) > 0.01 ? Math.sign(rest) : fallbackBend,
      span: Math.hypot(kp.y, kp.z) + Math.hypot(ap.y, ap.z),
    };
  }

  const LEG = {};
  const ARM = {};
  for (const side of ['L', 'R']) {
    LEG[side] = chainSpec(J[`hip${side}`], J[`knee${side}`], J[`ankle${side}`], 1);
    ARM[side] = chainSpec(J[`shoulder${side}`], J[`elbow${side}`], J[`wrist${side}`], -1);
  }

  // --- the figure's own dimensions, measured ---------------------------------
  const _v = new THREE.Vector3();
  const ANKLE_Y = atGroup(J.ankleL, _v).y;             // sole clearance
  const SPAN = LEG.L.span;                             // hip pivot to ankle pivot
  const HIP_SEP = Math.abs(LEG.L.root.x - LEG.R.root.x);
  const ARM_SPAN = ARM.L.span;                         // shoulder to wrist
  const SHOULDER_Y = atGroup(J.shoulderL, _v).y;
  const HEAD_Y = atGroup(J.head, _v).y;

  // The whole figure, so headFrac below is measured and not asserted.
  const bodyBox = new THREE.Box3().setFromObject(group);
  const TOTAL_H = Math.max(1e-3, (bodyBox.max.y - bodyBox.min.y) / scale);

  // The head, in the head joint's own frame. Everything about the head lag
  // comes out of these three numbers: how tall it is, and where its centre of
  // mass sits relative to the pivot it hangs on.
  const headBox = subtreeBox(J.head);
  const HEAD_H = headBox.isEmpty() ? M.head.height : (headBox.max.y - headBox.min.y);
  // Centre of the box, which for a head that is very nearly an ellipsoid is the
  // centre of mass to well inside the accuracy this needs.
  const HEAD_COM_Y = headBox.isEmpty() ? M.head.height * 0.5 : Math.max(1e-3, (headBox.max.y + headBox.min.y) * 0.5);
  const HEAD_COM_Z = headBox.isEmpty() ? 0 : (headBox.max.z + headBox.min.z) * 0.5;

  // The foot. TOE_AHEAD is how far the toe tip reaches in front of the ankle
  // pivot and HEEL_BACK how far the heel reaches behind it, and they are what
  // decide how far the figure can roll onto its toe before the tip is through
  // the floor. Measured off the built boot; the metrics fallback is only for a
  // rig whose feet carry no geometry, which is a stub.
  const footBox = subtreeBox(J.ankleL);
  const TOE_AHEAD = footBox.isEmpty() ? M.boot.length * 0.70 : Math.max(1e-3, footBox.max.z);
  const HEEL_BACK = footBox.isEmpty() ? M.boot.length * 0.30 : Math.max(1e-3, -footBox.min.z);
  // The same two corners as polar coordinates about the ankle pivot, because
  // that is the form the floor-clearance question actually wants: tip the foot
  // by p and the toe sits TOE_R * sin(p + TOE_PHI) below the pivot and the heel
  // HEEL_R * cos(p + HEEL_PHI). The approximate asin(height / arm) form is
  // three degrees out at the pose a stance actually ends in, which is enough
  // for the clamp to bind on the swing's first frame.
  const TOE_R = Math.hypot(ANKLE_Y, TOE_AHEAD);
  const TOE_PHI = Math.atan2(ANKLE_Y, TOE_AHEAD);
  const HEEL_R = Math.hypot(ANKLE_Y, HEEL_BACK);
  const HEEL_PHI = Math.atan2(HEEL_BACK, ANKLE_Y);

  // The wrist, so a hand planted on the floor has its palm on the floor rather
  // than its pivot.
  const wristBox = subtreeBox(J.wristL);
  const HAND_Y = wristBox.isEmpty() ? M.hand.palmDepth * 0.5 : Math.max(1e-3, -wristBox.min.y);

  // ===========================================================================
  // HOW CHIBI IS IT
  // ===========================================================================
  //
  // Two dimensionless shape numbers, and every gait constant below is a
  // proportional formula interpolated between "skeleton" and "chibi" by them.
  // Both are ZERO at the skeleton's own proportions, which is what makes the
  // formulas checkable: point this file at a skeleton rig and it reproduces
  // perform.js's hand-tuned constants.
  //
  //   chibi   how much of the figure is head. The skeleton is 0.167, this is
  //           0.330. It scales the head's inertia, its spring, the depth of the
  //           crouch and how much of the emergence the head carries.
  //   waddle  hip separation over leg length. The skeleton is 0.217, this is
  //           0.375. A figure whose feet are that far apart relative to its leg
  //           cannot walk by reaching forward; it has to move its weight
  //           sideways over each foot in turn, and that is a waddle.
  const headFrac = HEAD_H / TOTAL_H;
  const chibi = smoothstep(0.20, 0.30, headFrac);
  const wide = HIP_SEP / SPAN;
  const waddle = smoothstep(0.24, 0.42, wide);

  // Head inertia about the atlas, relative to a skeleton-proportioned skull on
  // the same figure. Mass goes as the cube of a linear dimension and the moment
  // of inertia of a ball about a point below it goes as m * r^2, but the
  // radius of gyration also scales with the head, so the whole thing is very
  // nearly the fifth power. The fifth power of 1.98 is 30, which is not a head,
  // it is a wrecking ball, so it is capped: past about 5 the neck stops reading
  // as a neck and the figure reads as a bobblehead toy on a spring.
  const HEAD_I = clamp((headFrac / 0.167) ** 3, 1, 5);

  // ===========================================================================
  // THE GAIT, DERIVED
  // ===========================================================================

  // Hip pivot height standing. The rest pose has the legs DEAD STRAIGHT (hip
  // minus ankle is exactly SPAN, on this rig and on the skeleton both), so a
  // figure standing at its rest hip height has locked knees and cannot take a
  // step at all. Everything about the walk falls out of that: the hips have to
  // come down before there is any stride to have.
  //
  // 0.982 of the span is 22 degrees of knee on the skeleton's near-equal links,
  // which is what HIP_TALL is there. A chibi's legs are short and thick and its
  // mass is high, so it stands deeper: 0.955 is 35 degrees of knee here.
  const TALL_K = mix(0.982, 0.955, chibi);
  const HIP_TALL = ANKLE_Y + SPAN * TALL_K;
  const HIP_STALK = HIP_TALL - SPAN * 0.0087;
  const HIP_CROUCH = ANKLE_Y + SPAN * 0.33;

  // Stride. The body agent publishes GAIT.stride and GAIT.shamble as the
  // figure's own intent, and it is taken rather than re-derived, because the
  // seam between the two halves is worth more than a second opinion.
  //
  // It is CROSS-CHECKED against an independent derivation, which is the only
  // reason to trust it: the skeleton's HALF_STEP is 0.313 of its leg span and
  // its LIFT_BEHIND is 0.365, and shrinking both by the waddle factor below
  // gives a step of 0.214 here against the published 0.246. Fifteen percent
  // apart is agreement, and it also settles an ambiguity: GAIT.stride is
  // documented as "heel to heel", which is one STEP in some conventions and one
  // full CYCLE in others. Read as a cycle it would be 0.123, which is half the
  // independent answer, so it is a step.
  //
  // strideK is why the naive scaling is not enough. A figure whose stance is
  // this wide relative to its leg spends most of a step moving its weight
  // sideways, and a forward stride that would suit a narrow stance leaves it
  // straddled. It is 1.0 at the skeleton's proportions by construction, so the
  // skeleton's numbers come out of this untouched.
  const strideK = mix(1, 0.78, waddle);
  const STEP_TARGET = GAIT?.stride && GAIT?.shamble
    ? GAIT.stride * GAIT.shamble
    : SPAN * 0.678 * strideK / (2 * 0.62);
  const DUTY = mix(0.62, 0.68, chibi);      // fraction of its cycle a foot is planted
  // A planted foot travels HALF_STEP + LIFT_BEHIND backward relative to its own
  // hip before it lifts, and since the foot is nailed to the world that is
  // exactly how far the BODY moves during one stance. How far it moves per STEP
  // is a different number and confusing the two is the classic way to build a
  // walk that skates: at this duty factor a foot is down for 1.36 step periods,
  // so the step is the excursion over 1.36 rather than the excursion itself.
  const EXCURSION = 2 * DUTY * STEP_TARGET;
  // Split in the skeleton's own ratio: a foot lands less far ahead than it
  // lifts behind, because the heel comes off at the end of a stance and that
  // hands the leg back reach it did not have when it landed.
  let HALF_STEP = EXCURSION * 0.4615;
  const LIFT_BEHIND = EXCURSION * 0.5385;
  // And a hard geometric guard on the forward half, because that is the one
  // that can be out of reach. At the moment of touchdown the hips are at the
  // BOTTOM of the bob, which is exactly why the bob is phased where it is, and
  // 0.97 of the span leaves the solver off its clamp. This has never bound on
  // either figure; it exists so that a change to GAIT cannot quietly produce a
  // walk whose every touchdown sits on the full-extension clamp.
  const STEP_LENGTH = EXCURSION / (2 * DUTY);

  // Pelvis. BOB is the rise and fall, twice a cycle, lowest at each footfall.
  // SWAY is the lateral shift toward the stance foot, once a cycle. LIST is the
  // pelvis rolling over the stance leg, and the skeleton has none of it at all.
  //
  // SWAY is the number that carries a chibi. On the skeleton it is 0.14 of the
  // hip separation, a hint. Here it is 0.41 of it, which puts the pelvis centre
  // most of the way over the stance hip, which is what a body with its feet
  // this far apart actually has to do to stay up. Take it out and the figure
  // reads as a mannequin on rails no matter what the legs are doing.
  const BOB = SPAN * mix(0.039, 0.085, chibi);
  const SWAY = HIP_SEP * mix(0.14, 0.46, waddle);
  const LIST = mix(0.0, 0.115, waddle);
  const FOOT_LIFT = Math.max(SPAN * 0.113, (GAIT?.groundClear || 0) * 1.15);
  const TOE_UP = mix(1.5, 0.55, chibi);     // heel leading through the swing
  const MAX_HEEL = mix(0.55, 0.34, chibi);  // radians of heel-off at end of stance

  // Speed. The cadence of a walking figure follows the pendulum law: a leg is a
  // pendulum and its natural frequency goes as sqrt(g / L). The skeleton walks
  // at 1.99 steps a second on a 1.15 leg, which pins the constant at 0.685.
  //
  // LURCH_SLOW is the only place the character is allowed to override the
  // physics, and it is deliberately close to 1. The body agent's note on
  // GAIT.shamble is the brief: "a shambler is defined by taking short steps at
  // a normal cadence, not by taking normal steps slowly". A slow cadence reads
  // as a figure in treacle; short steps at very nearly a walking cadence read
  // as a shamble, and everything that says zombie is then in the asymmetry and
  // the head rather than in the clock.
  const LURCH_SLOW = 0.88;
  const CADENCE = 0.685 * Math.sqrt(G / SPAN) * LURCH_SLOW;
  const TOP_SPEED = STEP_LENGTH * CADENCE;
  const STOP_RANGE = TOTAL_H * 0.5;         // stops an arm's length short

  // ===========================================================================
  // THE LIMP
  // ===========================================================================
  //
  // One leg stiffer than the other is the cheapest thing in the file and it is
  // most of what says zombie. It is done by changing where the foot is PUT and
  // how it rolls, never by fighting the IK: the solver still lands the ankle
  // exactly where it is told, so the limp costs nothing in foot slip.
  //
  // The stiff leg:
  //   takes a shorter step, so the body arrives over it early and has to wait;
  //   holds its stance longer, so the body rides over it and lurches;
  //   barely lifts, so the toe scuffs;
  //   barely rolls onto its toe, so it slaps down flat in its boot;
  //   and CIRCUMDUCTS, swinging out to the side, because a knee that will not
  //     bend has to get the foot round somehow. That last one is the single
  //     most legible thing on screen and it costs one sine.
  const STIFF = stiffSide === 'auto' ? (rand() < 0.5 ? 'L' : 'R') : stiffSide;
  const SOUND = STIFF === 'L' ? 'R' : 'L';
  const SIDE = {
    [SOUND]: { step: 1.00, behind: 1.00, lift: 1.00, heel: 1.00, toeUp: 1.00, circum: 0.000, dur: 1.00 },
    [STIFF]: { step: 0.72, behind: 1.20, lift: 0.40, heel: 0.20, toeUp: 0.25, circum: 0.085, dur: 1.24 },
  };
  // The forward reach guard, applied to the longer of the two sides.
  {
    const hipAtLanding = HIP_STALK - BOB - ANKLE_Y;
    const reach = SPAN * 0.97;
    const maxAhead = Math.sqrt(Math.max(reach * reach - hipAtLanding * hipAtLanding, 1e-6));
    HALF_STEP = Math.min(HALF_STEP, maxAhead);
  }

  // Where the feet land at the end of the climb, staggered, because a figure
  // hauling itself out of a hole does not first tidy its feet into a neat
  // parallel stance. It stands up off the front one. As fractions of the leg
  // span, so the stagger survives a change of figure.
  const CROUCH_Z = { L: SPAN * 0.243, R: SPAN * 0.435 };

  // ===========================================================================
  // CLIPPING
  // ===========================================================================
  // One plane makes the figure genuinely emerge from the floor rather than rise
  // through it as a solid. It keeps y above a hair below zero rather than above
  // zero itself: a boot resting ON the floor has its lowest point at exactly
  // zero, and shed debris lying there would otherwise be sliced in half. The
  // slack is scaled to the figure, because four centimetres under a 2.5 unit
  // skeleton is a different thing from four centimetres under a 1.8 unit chibi.
  //
  // The planes are put ON and taken OFF only when this file's own idea of
  // whether clipping is on CHANGES, which is the contract dance.js relies on
  // when it borrows a rig: a performance that was buried when something else
  // took the rig still believes the plane is fitted, so the borrower must put
  // it back or the next reset() here is a no-op and the figure rises through
  // the floor as a solid.
  const CLIP_SLACK = Math.max(0.012, 0.04 * (TOTAL_H * scale) / 2.5);
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), CLIP_SLACK);
  const bodyMaterials = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      // Every material on the figure, not just the standard ones: this model is
      // skin, jacket, bone, flesh, boot and teeth, and a clipped body under an
      // unclipped jacket is worse than no clipping at all.
      if (m && !bodyMaterials.includes(m)) bodyMaterials.push(m);
    }
  });
  let clipping = false;
  function setClipping(on) {
    if (on === clipping) return;
    clipping = on;
    for (const m of bodyMaterials) {
      m.clippingPlanes = on ? [clipPlane] : null;
      // Without this the buried half still casts a full shadow, and a figure
      // with no body throws a whole body's shadow onto the floor.
      m.clipShadows = on;
      m.needsUpdate = true;
    }
    if (renderer && on) renderer.localClippingEnabled = true;
  }

  const contacts = group.userData.contactShadow || [];
  const contactOpacity = contacts.map((c) => c.material?.opacity ?? 0.32);

  // ===========================================================================
  // SPRINGS
  // ===========================================================================
  //
  // One per degree of freedom, tuned by what it has to move. Damping is quoted
  // against critical (2 * sqrt(k)) in the comments, because that ratio is the
  // whole character of a spring.
  //
  // THE HEAD IS THE INTERESTING ONE. A Spring here is unit mass, so a heavier
  // head is expressed by dividing both stiffness and damping by its inertia.
  // That is not a fudge, it is the equation: m*x'' + c*x' + k*x becomes
  // x'' + (c/m)*x' + (k/m)*x, and the damping RATIO then falls as 1/sqrt(m),
  // which is exactly what a heavier mass on the same neck does. At HEAD_I = 5
  // the head's natural frequency drops by a factor of 2.24 against the
  // skeleton's, from 2.57 Hz to 1.15 Hz, and its damping ratio from 0.78 to
  // 0.35. In plain terms: it takes about four times as long to catch up with
  // the body and it overshoots when it gets there. That lag is most of the
  // character, and none of it is authored.
  const S = {
    root: new Spring({ stiffness: 70, damping: 15.0 }),        // 0.90 of critical
    lumbar: new Spring({ stiffness: 110, damping: 18.5 }),     // 0.88
    thorax: new Spring({ stiffness: 140, damping: 20.0 }),     // 0.85
    // The neck carries the head too, so it takes the same inertia. It is stiff
    // to start with because there is barely any of it: metrics.js caps it at
    // 0.30 rad in every axis, and a floppy joint with 17 degrees of travel just
    // reads as broken.
    neck: new Spring({ stiffness: (210 * 1.7) / HEAD_I, damping: (24.0 * 1.7) / HEAD_I }),
    head: new Spring({ stiffness: 260 / HEAD_I, damping: 25.0 / HEAD_I }),
    headYaw: new Spring({ stiffness: 90 / HEAD_I, damping: 15.0 / HEAD_I }),
    headRoll: new Spring({ stiffness: 120 / HEAD_I, damping: 16.0 / HEAD_I }),
    shoulderL: new Spring({ stiffness: 150, damping: 20.0 }),
    shoulderR: new Spring({ stiffness: 150, damping: 20.0 }),
    // Softer than the skeleton's, so the forearms trail further behind the
    // upper arms. A zombie's arms are dead weight swinging off a shoulder, and
    // the lag between the two segments is what says dead weight.
    elbowL: new Spring({ stiffness: 160, damping: 17.0 }),     // 0.67
    elbowR: new Spring({ stiffness: 160, damping: 17.0 }),
    wristL: new Spring({ stiffness: 230, damping: 18.0 }),     // 0.59, floppy claw
    wristR: new Spring({ stiffness: 230, damping: 18.0 }),
    spreadL: new Spring({ stiffness: 130, damping: 19.0 }),
    spreadR: new Spring({ stiffness: 130, damping: 19.0 }),
    hipL: new Spring({ stiffness: 130, damping: 20.0 }),
    hipR: new Spring({ stiffness: 130, damping: 20.0 }),
    kneeL: new Spring({ stiffness: 175, damping: 22.0 }),
    kneeR: new Spring({ stiffness: 175, damping: 22.0 }),
    ankleL: new Spring({ stiffness: 240, damping: 25.0 }),
    ankleR: new Spring({ stiffness: 240, damping: 25.0 }),
    roll: new Spring({ stiffness: 95, damping: 15.5 }),        // the turn lean
    list: new Spring({ stiffness: 150, damping: 17.0 }),       // the waddle roll
    sway: new Spring({ stiffness: 120, damping: 12.0 }),       // 0.55, rings
    lift: new Spring({ stiffness: 62, damping: 12.6 }),        // 0.80, overshoots
    jaw: new Spring({ stiffness: 190, damping: 12.0 }),        // 0.44, rattles
  };

  // Targets, in radians and metres, rewritten every frame by whichever phase is
  // running. Nothing outside the phase code touches these.
  const T = {
    root: 0, lumbar: 0, thorax: 0, neck: 0, head: 0,
    headYaw: 0, headRoll: 0,
    shoulderL: 0, shoulderR: 0, elbowL: 0, elbowR: 0, wristL: 0, wristR: 0,
    spreadL: 0, spreadR: 0,
    hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, ankleL: 0, ankleR: 0,
    roll: 0, list: 0, sway: 0, lift: 0,
  };
  // The head's angle against the chest, which is what every phase authors. See
  // CRAWL.gazeRel for why this is relative rather than absolute.
  let headRel = 0;

  // HOW THE HEAD'S ANGLE IS SPENT. metrics.js caps the head joint at [-0.55,
  // 0.50] and the neck at [-0.30, 0.30], so the two together are 0.85 rad up
  // and 0.80 rad down and nothing this file writes may exceed that. The split
  // below hands 70% to the head and 30% to the neck, which saturates both at
  // very nearly the same angle and so wastes none of a budget there is very
  // little of. metrics.js says to use the head for the range and the neck for
  // the follow-through, and 70/30 is that, read as a number.
  const NECK_SHARE = 0.30;
  // What a phase may ask for, before the measured lag is added.
  const HEAD_REL_MAX = 0.63;

  // WHERE IT IS BURIED, worked out rather than chosen.
  //
  // Two constraints, and on this figure they nearly meet. The whole head has to
  // be under the floor, or the shot opens with a bald green dome sitting in the
  // grass; and a hand has to be able to break the surface from down there, or
  // the shot opens with a second of empty floor while the figure climbs to
  // where the performance starts. The skeleton chose -0.30 by hand and wrote
  // the arithmetic in a comment; here it is the arithmetic.
  //
  // The head is treated as a ball at its measured centre of mass, which for a
  // chibi is very nearly what it is.
  const OPEN_PITCH = CRAWL.pitch[0][1] * D;
  const headBall = Math.max(
    (headBox.max.y - headBox.min.y), (headBox.max.x - headBox.min.x),
  ) * 0.5;
  const headTopAboveHip = (HEAD_Y - rootRest.y + HEAD_COM_Y) * Math.cos(OPEN_PITCH) + headBall;
  const BURIED_Y = -(headTopAboveHip + SPAN * 0.05);
  // And the check, published rather than asserted, because a rig whose arms
  // cannot reach the surface is the body agent's news and not this file's to
  // throw on. Positive means a claw breaks the surface at the opening pose.
  const armReach = ARM_SPAN + (wristBox.isEmpty() ? M.arm.hand : -wristBox.min.y);
  const reachMargin = BURIED_Y
    + (SHOULDER_Y - rootRest.y) * Math.cos(OPEN_PITCH) + armReach * 0.94;
  T.lift = BURIED_Y;

  // Joint limits, applied where they can be applied. The pose joints are
  // clamped, because a spine driven past its stop is a shell interpenetrating
  // itself and nobody wants to find that at frame 300 of a recording. The IK
  // joints are NOT clamped, because clamping a solver's answer moves the foot
  // and moving the foot is foot slip; they are MEASURED instead and reported
  // out of metrics(), so an out-of-range hip is a number rather than a
  // silent limp. See out.overLimit.
  function lim(name, axis, v) {
    const range = LIMITS?.[name]?.[axis];
    return range ? clamp(v, range[0], range[1]) : v;
  }

  // ===========================================================================
  // IK
  // ===========================================================================
  //
  // Solve one chain so its tip lands on `t`, expressed in the chain parent's
  // frame. Returns local rotations for the root joint (x and z) and the middle.
  //
  // Lifted from perform.js unchanged, because it is figure-independent: it is
  // two links and a lateral offset, and the only things it reads are the
  // measurements chainSpec took off this rig. The derivation, kept because the
  // two-stage split is the non-obvious part: rotations compose as Rx * Ry * Rz,
  // so rotation.z happens FIRST and rotation.x second, and rotation.x preserves
  // x. So the middle joint's angle follows from the distance alone, phi is
  // whatever puts the chain's x on the target's x, and the root's x rotation
  // then swings the rest of the way round.
  //
  // The distance is the 3D one with the lateral offset taken out of it, not the
  // length of the target's projection into the sagittal plane. That distinction
  // is invisible while the body is upright and it is centimetres of foot slip
  // the moment the torso is pitched over during the climb.
  const ikOut = { hipX: 0, hipZ: 0, knee: 0, short: 0 };
  function solveChain(L, t) {
    const dx = t.x - L.root.x;
    const dy = t.y - L.root.y;
    const dz = t.z - L.root.z;

    const rho = Math.hypot(dx, dy, dz);
    ikOut.short = Math.max(0, rho - L.span);
    const r = Math.sqrt(Math.max(rho * rho - L.cx * L.cx, 1e-8));

    const cosG = (r * r - L.a1 * L.a1 - L.a2 * L.a2) / (2 * L.a1 * L.a2);
    const gamma = L.bend * Math.acos(clamp(cosG, -1, 1));
    ikOut.knee = wrap(gamma + L.alpha1 - L.alpha2);

    const beta = L.alpha1 + Math.atan2(L.a2 * Math.sin(gamma), L.a1 + L.a2 * Math.cos(gamma));
    const rc = r * Math.cos(beta);
    const rs = r * Math.sin(beta);

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

  // ===========================================================================
  // FEET
  // ===========================================================================
  // A foot is either planted at a world point or swinging to the next one. The
  // cursor that decides when to swing is DISTANCE walked, not time, which is
  // the whole reason the feet do not skate: at half speed the same stride takes
  // twice as long and covers the same ground.
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
  // Hands, during the climb. Same idea and for the same reason: a crawl reads
  // as a crawl because the hands stay where they were put and the body hauls
  // itself past them. Posed by angle instead, the arms swim.
  const hands = {
    L: { plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swing: 1, dur: 0.3 },
    R: { plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swing: 1, dur: 0.3 },
  };
  let armBlend = 0;
  let handsDown = false;

  let cursor = 0;
  let cursorFix = 0;
  let nextStep = SOUND;
  let riseSteps = 0;
  let legBlend = 0;
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
  let shedFired = [];
  let shedLeft = [];

  // ===========================================================================
  // THE HEAD, AND WHY IT IS MEASURED RATHER THAN POSED
  // ===========================================================================
  //
  // The head is 33% of this figure's height and it hangs on a joint with 17
  // degrees of travel. Posed, it is a lid: it goes where the chest goes and the
  // figure reads as a puppet on rails, which is the exact failure the brief
  // named. Simulated, it is the character.
  //
  // So it is a pendulum, driven by the ROOT's measured world acceleration. The
  // root and not the neck, deliberately: the pelvis's motion does not depend on
  // what the head is doing, so there is no feedback path and the loop cannot
  // ring itself up. Feeding the neck's own acceleration back into the neck's
  // own rotation is a closed loop with a one frame delay, and at these gains it
  // is a loop that howls.
  //
  // The torque about the atlas is r cross m*a, with r the vector from the pivot
  // to the head's centre of mass, both measured off the rig above:
  //
  //   pitch  tau_x = comY * a_z - comZ * a_y
  //   roll   tau_z = comY * a_x                  (comX is zero by symmetry)
  //
  // Signs, worked once so nobody has to work them again. Positive rotation.x on
  // the head nods it forward. Accelerate the body forward (+a_z in its own
  // frame) and the head is left behind, so it tips BACK, so the angle is
  // NEGATIVE: the drive is minus the torque. Positive rotation.z tips the top
  // of the head toward -x, and accelerating toward +x leaves the top behind at
  // -x, so that one is plus.
  //
  // What this buys, none of it authored: the head nods on every footfall
  // because the bob accelerates the pelvis vertically twice a cycle; it rolls
  // once a cycle against the waddle, which is the read that says chibi; it
  // whips back when the figure starts walking and catches up late; and it rings
  // for most of a second after the body stops, because its damping ratio is
  // 0.35. The jaw then hangs off the head's motion in turn, so the whole chain
  // is consequence all the way down.
  const rootPos = new THREE.Vector3();
  const rootPrev = new THREE.Vector3();
  const rootVel = new THREE.Vector3();
  const rootAcc = new THREE.Vector3();
  const bodyAcc = new THREE.Vector3();
  let accPrimed = false;
  // Gain, in radians per unit of torque per unit mass. Set so that the walk's
  // own vertical acceleration, about 0.9 g at this bob and cadence, produces
  // about 6 degrees of nod: any less and the head reads as bolted on, any more
  // and it detaches from the shoulders, which on a figure with no neck happens
  // at surprisingly small angles.
  const HEAD_GAIN = 0.085 * chibi + 0.012;
  const HEAD_PITCH_CAP = 0.34;
  const HEAD_ROLL_CAP = 0.26;

  // Jaw drive. Measured off the HEAD, because the mandible hangs off the head
  // and it is the head's acceleration it feels, and the head is now the thing
  // moving most.
  const headPos = new THREE.Vector3();
  const headPrev = new THREE.Vector3();
  const headVel = new THREE.Vector3();
  const headAcc = new THREE.Vector3();
  const localAcc = new THREE.Vector3();
  const headQuat = new THREE.Quaternion();
  let headPrimed = false;
  let chatter = 0;
  let chatterTimer = 0;
  let jawBeat = 0;

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
  const ikShort = { L: 0, R: 0 };
  let liftCap = Infinity;
  let overLimit = 0;

  group.updateMatrixWorld(true);
  J.head.getWorldPosition(headPrev);
  J.root.getWorldPosition(rootPrev);

  // ===========================================================================
  // PHASES
  // ===========================================================================

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
      shedLeft = rig.shed ? [...rig.shed.keys()].slice(0, 3) : [];
      shedFired = [];
    }
    if (next === 'rising') {
      riseSteps = 0;
      // The push off the floor. A rise that is only an ease has no moment where
      // the effort happens; this is that moment, and the overshoot at the top
      // is the same impulse still arriving.
      S.lift.velocity += 1.35 * Math.sqrt(SPAN / 1.15);
      S.sway.velocity += (rand() < 0.5 ? -1 : 1) * 1.5;
      S.roll.velocity += (rand() < 0.5 ? -1 : 1) * 1.2;
      // And the head gets the whole of it, because the head is what a heave
      // like that throws about.
      S.head.velocity -= 9.0;
      chatter = 1;
    }
    if (next === 'chasing') lostFor = 0;
  }

  // Buried. Not a switched-off object: it is listening, and what wakes it is
  // the ghost coming within range rather than a timer running out. The pose is
  // the climb's own first frame rather than a separate one written by hand,
  // because two hand-written versions of the same crouch is how the skeleton
  // ended up with a buried figure whose spine was bent backwards.
  function stepBuried(dt, ghost) {
    poseCrawl(0);
    strain = 0;
    chatter = 0;
    if (ghost && Math.hypot(ghost.x - pos.x, ghost.z - pos.z) < wakeRange) enter('emerging');
  }

  // Real seconds since the phase began, mapped onto the tables' own time. The
  // tables hold flat for their first 0.9 while a hand is out of the ground and
  // nothing is happening, so the whole climb is time-warped: the opening runs
  // fast and the rest at 1.2x, and the climb finishes in 3.5s rather than 5.2.
  // Every threshold in stepEmerge is quoted in TABLE time, which is why the
  // warp is applied once here rather than at each track() call: the shed beats,
  // the hand grabs and the leg blend all keep their places in the choreography.
  // The springs and the hand solver still run on real dt, so a faster target
  // just means they lag further behind it, which reads as more effort and not
  // as a fast-forward.
  const WARP = [[0, 0], [0.6, 1.6], [3.5, EMERGE_END]];
  function emergeTime(real) {
    for (let i = 1; i < WARP.length; i++) {
      const [r0, t0] = WARP[i - 1];
      const [r1, t1] = WARP[i];
      if (real <= r1) return t0 + (t1 - t0) * ((real - r0) / (r1 - r0));
    }
    return EMERGE_END + (real - WARP[WARP.length - 1][0]);
  }

  let shakeFired = 0;
  function stepEmerge(dt, ghost) {
    const prev = emergeTime(phaseTime - dt);
    const t = emergeTime(phaseTime);
    poseCrawl(t);
    strain = track(CRAWL.strain, t);
    chatter = 0.3 * strain;

    // The dirt shake. Impulses, fired once each as table time passes them.
    for (let i = 0; i < HEAD_SHAKE.length; i++) {
      const s = HEAD_SHAKE[i];
      if (shakeFired & (1 << i)) continue;
      if (t < s.at) continue;
      shakeFired |= 1 << i;
      S.head.velocity += s.pitch;
      S.headYaw.velocity += s.yaw;
      S.headRoll.velocity += s.roll;
    }

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

    // The hands take hold, the clawed one first. Before that the arm is angle
    // driven, because a hand punching up out of the ground is not holding
    // anything.
    if (t > 0.85 && !handsDown) {
      handsDown = true;
      reachHand('R', 0.22);
      reachHand('L', 0.34);
    }
    if (handsDown) {
      armBlend = t > 4.5
        ? clamp01((EMERGE_END - t) / 0.6)
        : clamp01((t - 0.85) / 0.45);
      if (armBlend > 0) stepHands(dt);
    }

    maybeShed(prev, t);
    if (t >= EMERGE_END) enter('rising');
  }

  function poseCrawl(t) {
    T.lift = mix(BURIED_Y, HIP_CROUCH, track(CRAWL.hipU, t));
    const pitch = track(CRAWL.pitch, t) * D;
    T.root = pitch;
    T.lumbar = pitch + track(CRAWL.lumbar, t) * D;
    T.thorax = T.lumbar + track(CRAWL.thorax, t) * D;
    headRel = clamp(track(CRAWL.gazeRel, t) * D, -HEAD_REL_MAX, HEAD_REL_MAX);
    T.headYaw = 0;
    T.headRoll = 0;

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
    T.kneeL = 20 * D; T.kneeR = 26 * D;
    T.ankleL = 26 * D; T.ankleR = 30 * D;
    T.roll = 0; T.list = 0; T.sway = 0;

    jawBeat = track(CRAWL.jaw, t);
  }

  // Up onto the feet. The feet are already planted, so the only thing being
  // animated is the hip height and the torso angle; the knees straighten
  // because the hips went up.
  function stepRise(dt) {
    const t = phaseTime;
    T.lift = mix(HIP_CROUCH, HIP_TALL, easeOutBack(clamp01(t / 0.85)));
    const pitch = track([[0, 34], [0.5, 16], [0.9, -7], [1.4, 4], [2.0, 6]], t) * D;
    T.root = pitch;
    T.lumbar = pitch + track([[0, -4], [0.9, -9], [1.6, -2]], t) * D;
    T.thorax = T.lumbar + track([[0, -3], [0.9, -8], [1.6, 0]], t) * D;
    // The head is NOT driven up here. It is left to arrive on its own: the body
    // stands up, the head lags most of a second behind it, and the shape of
    // that lag is the head spring's own. All this does is stop pointing it at
    // the floor.
    const gaze = track([[0, 3], [0.7, -14], [1.5, 4], [2.2, 6]], t) * D;
    T.neck = mix(T.thorax, gaze, 0.16);
    T.head = gaze;

    // The arms fling out for balance and then fold back in, and they stay well
    // inside LIMITS.shoulder. easeOutElastic rings this on the way back and the
    // shoulder spring softens the ring into something with weight.
    const fling = easeOutElastic(clamp01(t / 1.5));
    const armOut = mix(-34, -48, fling) * D;
    T.shoulderL = armOut; T.shoulderR = armOut + 4 * D;
    T.elbowL = T.shoulderL - mix(40, 30, fling) * D;
    T.elbowR = T.shoulderR - mix(38, 32, fling) * D;
    T.wristL = T.elbowL - 12 * D;
    T.wristR = T.elbowR - 12 * D;
    const spread = mix(12, 38, easeOutBack(clamp01(t / 0.6))) * D;
    T.spreadL = spread * (1 - 0.6 * clamp01((t - 0.7) / 0.9));
    T.spreadR = T.spreadL;

    strain = mix(0.9, 0.15, clamp01(t / 1.4));
    legBlend = 1;

    // Two shuffle steps once it is upright, bringing the feet back under the
    // hips from the staggered crouch it stood up out of. Until they land the
    // reach limit is holding the hips down, so the last few centimetres of
    // height arrive with the feet rather than on a curve of their own.
    advanceSwings(dt);
    if (t > 1.30 && riseSteps === 0) { riseSteps = 1; queueStep('R', SPAN * 0.04, 0.30); }
    if (t > 1.75 && riseSteps === 1) { riseSteps = 2; queueStep('L', -SPAN * 0.04, 0.30); }
    jawBeat = track([[0, 0.34], [0.45, 0.54], [0.8, 0.10], [1.4, 0.22], [2.2, 0.20]], t);
    chatter = track([[0, 0.4], [0.75, 1.0], [1.8, 0.35]], t);

    // Clipping is not free: it costs on every material that carries it, and by
    // here the lowest thing on the figure is the sole of a planted boot.
    if (clipping && T.lift > HIP_TALL * 0.72 && Math.abs(pitch) < 25 * D) setClipping(false);

    if (t > 2.4) enter('chasing');
  }

  // ===========================================================================
  // THE SHAMBLE
  // ===========================================================================
  //
  // Everything the walk needs, given a speed, a heading and how far it has
  // travelled. Both chase paths call it, so the autonomous version and the
  // driven one cannot drift apart the way the skeleton's two copies can.
  //
  // `err` is the heading error, zero under a driver because the driver has
  // already pointed the figure where it is going, and `dist` the range to the
  // ghost, Infinity when nothing is being chased.
  function shamble(dt, err, dist) {
    const bleed = cursorFix * (1 - Math.exp(-CURSOR_LOCK_RATE * dt));
    cursor += bleed;
    cursorFix -= bleed;

    // One cycle is two steps, so the pelvis rises and falls twice per cycle and
    // sways once. HIP_STALK is the TOP of the bob, not its middle: the leg is
    // nearly at full stretch at double support and there is no room above it.
    const cyc = (cursor * 0.5) % 1;
    const moving = smoothstep(0.05, 0.5 * (TOP_SPEED / 1.25 + 0.6), speed);

    // Lowest at the footfall, highest at mid stance, and the cursor is pinned
    // to the footfalls in advanceSwings, so the two cannot drift apart.
    const bob = -BOB * moving * (1 + Math.cos(cyc * 2 * TAU)) * 0.5;
    // And a limp on top of it. The stiff leg cannot absorb, so the body drops
    // further onto the sound one and is carried high over the stiff one. It is
    // once a cycle rather than twice, which is exactly what makes it a limp and
    // not a bounce.
    const limpPhase = SOUND === 'L' ? 0 : Math.PI;
    const limp = -BOB * 0.55 * moving * waddle * Math.sin(cyc * TAU + limpPhase);
    T.lift = mix(HIP_TALL, HIP_STALK, moving) + bob + limp;

    // The weight shift. This is the chibi's walk. `sway` moves the pelvis
    // laterally over the stance foot and `list` rolls it, and the two are a
    // quarter cycle apart because a body rolls onto a foot before its weight
    // has finished arriving over it.
    T.sway = SWAY * moving * Math.sin(cyc * TAU);
    T.list = -LIST * moving * Math.sin(cyc * TAU - 0.5);

    // Leans into the turn, and forward with speed. Both consequences of motion:
    // the roll spring is under critical, so a hard change of direction rolls
    // past and comes back.
    T.roll = clamp(-yawVel * 0.16, -0.22, 0.22);
    // The lurch. Twice a cycle on the skeleton, and here it is twice a cycle
    // plus a once-a-cycle term from the limp, which is what stops the walk
    // reading as a metronome.
    const lurch = 2.2 * moving * Math.sin(cyc * 2 * TAU + 0.6)
      + 3.2 * moving * waddle * Math.sin(cyc * TAU + limpPhase + 0.9);
    T.root = (9 + 6 * moving + lurch) * D;
    T.lumbar = T.root + (-3 + 4 * moving) * D;
    T.thorax = T.lumbar + (-2 + 5 * moving) * D;

    // THE HEAD IS NOT POSED HERE. Only its intent is: it wants to look at the
    // ghost, and that is one clamped number. Everything else it does arrives
    // through driveHead, out of the body's own acceleration.
    T.headYaw = clamp(err, -0.6, 0.6);
    T.head = (-3 + 8 * moving) * D + (dist < TOTAL_H * 1.6 ? -5 * D : 0);
    T.neck = mix(T.thorax, T.head, 0.16);
    T.headRoll = 0;

    // Arms LOW and heavy, not out in front. Two reasons, and the second is the
    // one that decided it. A chibi's arms are short: the body agent's note is
    // that "the arms are short enough that a full forward reach brings the
    // hands to the chin", and metrics.js puts the shoulders 0.185 apart against
    // a head 0.300 wide, so a raised arm is inside the skull's silhouette and
    // the pose disappears. And the reference's clawed hands read better hanging
    // than reaching: a claw at the end of a swinging dead arm is a silhouette
    // against the ground, and a claw held up in front is lost against the
    // ribcage.
    //
    // The swing is read off the LEGS rather than off a phase of its own: the
    // right arm goes forward because the left leg did, which is both what a
    // body does and the only way the two can never drift out of step. The
    // springs then do the lag, so the claws arrive well after the shoulders.
    const gait = clamp((S.hipR.value - S.hipL.value) * 0.55, -0.45, 0.45);
    const hang = (-14 - 6 * moving) * D;
    T.shoulderL = hang + gait;
    T.shoulderR = hang - gait;
    // The elbows keep a heavy dead bend and the claws hang forward off it.
    T.elbowL = T.shoulderL - (30 + 10 * moving) * D - gait * 0.5;
    T.elbowR = T.shoulderR - (30 + 10 * moving) * D + gait * 0.5;
    T.wristL = T.elbowL - 22 * D;
    T.wristR = T.elbowR - 22 * D;
    // Held out from the body, because the ribcage and the jacket are wider than
    // the skeleton's and an arm hanging at flare would swing through them.
    T.spreadL = (16 + 8 * moving) * D;
    T.spreadR = T.spreadL;

    strain = 0.12 + 0.1 * moving;
    legBlend = 1;
    stepFeet(dt);

    // Closer means hungrier. The gape and snap near the ghost is the only
    // scripted thing the jaw does; everything else comes out of the head's
    // motion. It rests further open than the skeleton's, because a slack jaw is
    // half of what this face is.
    chatter = 0.3 + 0.6 * smoothstep(TOTAL_H * 2.2, TOTAL_H * 0.8, dist);
    const near = dist < STOP_RANGE + TOTAL_H * 0.5;
    jawBeat = near
      ? 0.20 + 0.34 * Math.max(0, Math.sin(clock * 4.4)) ** 2
      : 0.16 + 0.05 * moving;
  }

  // The chase. Two things decide whether this reads: the turn is rate limited
  // so the body leans into a change of direction instead of snapping to face
  // the ghost, and the walk's phase is distance travelled rather than time.
  function stepChase(dt, ghost) {
    if (driver) return stepDriven(dt);

    let dist = Infinity;
    let err = 0;
    if (ghost) {
      v1.subVectors(ghost, pos).setY(0);
      dist = v1.length();
      if (dist > 1e-4) err = wrap(Math.atan2(v1.x, v1.z) - yaw);
    }

    const yawAcc = 6.0 * err - 4.0 * yawVel;
    yawVel = clamp(yawVel + yawAcc * dt, -MAX_YAW_RATE, MAX_YAW_RATE);
    yaw += yawVel * dt;

    // Walks only when it is roughly pointed the right way, so a big turn is a
    // turn on the spot rather than an arc across the graveyard.
    const facing = smoothstep(0.25, 0.75, Math.cos(err));
    const want = ghost
      ? TOP_SPEED * facing * smoothstep(STOP_RANGE, STOP_RANGE + TOTAL_H * 0.6, dist)
      : 0;
    speed = approach(speed, want, want > speed ? 2.2 : 4.5, dt);
    if (want === 0 && speed < 0.01) speed = 0;

    const fwd = v2.set(Math.sin(yaw), 0, Math.cos(yaw));
    pos.addScaledVector(fwd, speed * dt);
    travel += speed * dt;
    cursor += (speed * dt) / STEP_LENGTH;

    shamble(dt, err, dist);

    if (ghost && dist < GIVE_UP_RANGE) lostFor = 0;
    else lostFor += dt;
    if (lostFor > 3.0) enter('settling');
  }

  // The chase with the steering handed to the game. Unlike the skeleton's,
  // which duplicates its whole gait to avoid threading `if (driver)` through
  // it, this one shares `shamble` and differs only in how pos, yaw and speed
  // are arrived at. That is affordable here because the steering was factored
  // out from the start rather than retrofitted.
  function stepDriven(dt) {
    const want = driver(dt) || null;
    if (want) {
      const dx = want.x - pos.x;
      const dz = want.z - pos.z;
      const moved = Math.hypot(dx, dz);
      pos.x = want.x;
      pos.z = want.z;
      // Measured, not integrated. A driver that teleports (one of these eaten
      // and sent home) would otherwise report a speed of hundreds and blow the
      // gait up for a frame, so a jump beyond what a stride could cover is
      // treated as a cut rather than as motion.
      const raw = dt > 0 ? moved / dt : 0;
      const cut = raw > Math.max(6, TOP_SPEED * 12);
      const nextYaw = typeof want.yaw === 'number'
        ? want.yaw
        : (moved > 1e-4 ? Math.atan2(dx, dz) : yaw);
      const dyaw = wrap(nextYaw - yaw);
      yawVel = cut || dt <= 0 ? 0 : clamp(dyaw / dt, -MAX_YAW_RATE, MAX_YAW_RATE);
      yaw = nextYaw;
      speed = cut ? 0 : raw;
      if (!cut) {
        travel += moved;
        cursor += moved / STEP_LENGTH;
      }
    } else {
      speed = 0;
      yawVel = 0;
    }
    // The driver has already pointed the figure where it is going, so the
    // heading error is zero by construction.
    shamble(dt, 0, typeof want?.dist === 'number' ? want.dist : Infinity);
  }

  // Gives up and goes back down. The same machinery in reverse, so the sink is
  // as heavy as the climb was.
  function stepSettle(dt) {
    const t = phaseTime;
    T.lift = mix(HIP_TALL, BURIED_Y - SPAN * 0.05, easeInOutCubic(clamp01((t - 0.6) / 2.6)));
    const pitch = track([[0, 6], [0.6, 22], [1.6, 50], [3.2, 72]], t) * D;
    T.root = pitch;
    T.lumbar = pitch + 6 * D;
    T.thorax = T.lumbar + 8 * D;
    const gaze = track([[0, 6], [0.5, 34], [2.0, 82]], t) * D;
    T.neck = mix(T.thorax, gaze, 0.16);
    T.head = gaze;
    T.headYaw = 0;
    T.headRoll = 0;
    const arm = track([[0, -26], [0.8, -14], [2.4, 8]], t) * D;
    T.shoulderL = arm; T.shoulderR = arm;
    T.elbowL = arm - 52 * D; T.elbowR = arm - 52 * D;
    T.wristL = T.elbowL - 22 * D; T.wristR = T.elbowR - 22 * D;
    T.spreadL = 10 * D; T.spreadR = 10 * D;
    T.roll = 0;
    T.list = 0;
    T.sway = 0;
    strain = 0.25;
    jawBeat = track([[0, 0.18], [1.0, 0.36], [2.6, 0.16]], t);
    chatter = 0.2;
    speed = 0;
    advanceSwings(dt);

    T.hipL = 0; T.hipR = 0;
    T.kneeL = 20 * D; T.kneeR = 24 * D;
    T.ankleL = 26 * D; T.ankleR = 28 * D;
    if (t > 0.5 && legBlend > 0) legBlend = Math.max(0, legBlend - dt * 1.6);
    if (t > 0.4 && !clipping) setClipping(true);
    if (t > 3.6) enter('buried');
  }

  // ===========================================================================
  // FOOTSTEPS
  // ===========================================================================
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
          aimStep(side, HALF_STEP * SIDE[side].step, (1 - f.swing) * f.dur, v1);
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
        // is the only input to the bob, the sway, the list and the lurch, and
        // writing it in one frame steps every one of them. Bleeding it off
        // keeps the whole point of the lock, which is that the error cannot
        // ACCUMULATE, and costs a phase rate half again too fast for a few
        // frames rather than a visible jump.
        const err = Math.round(cursor) - cursor;
        if (Math.abs(err) < 0.3) cursorFix = err;
      }
    }
  }

  // Where a foot should land: `z` in front of its own hip, at the place the
  // body will HAVE REACHED by the time the foot gets there. Aiming at where the
  // body is now instead lands every step short, because the body walks out from
  // under the target during the swing, and the stride quietly collapses.
  function aimStep(side, z, lead, out) {
    out.set(FOOT_X[side], -group.position.y / scale, z);
    group.localToWorld(out);
    out.y = 0;
    out.x += Math.sin(yaw) * speed * lead;
    out.z += Math.cos(yaw) * speed * lead;
    return out;
  }

  // How far the heel has come off, for a planted foot. A pure function of how
  // far the body has walked past the plant, so it reads the group's matrix as
  // it stands: a caller running before applyLegs therefore gets exactly the
  // pitch applyLegs used on the previous frame, which is the pose a swing has
  // to leave from.
  function heelOff(f, side) {
    group.worldToLocal(v3.copy(f.plant));
    const s = SIDE[side];
    return smoothstep(0.03 * SPAN, LIFT_BEHIND * s.behind, -v3.z) * MAX_HEEL * s.heel;
  }

  // Where the ankle pivot sits, in world, for a foot planted at `f` and rolled
  // up onto its toe by `pitch`. The CONTACT does not move: the ankle swings up
  // and forward about the toe tip. One function, used by the stance and by the
  // lift-off, so the two cannot disagree about where the ankle was.
  function ankleOnPlant(f, pitch, out) {
    const ch = Math.cos(pitch);
    const sh = Math.sin(pitch);
    const ahead = (TOE_AHEAD * (1 - ch) + ANKLE_Y * sh) * scale;
    out.copy(f.plant);
    out.x += Math.sin(f.yaw) * ahead;
    out.z += Math.cos(f.yaw) * ahead;
    out.y += (ANKLE_Y * ch + TOE_AHEAD * sh) * scale;
    return out;
  }

  function queueStep(side, z, dur = 0.32, retarget = false) {
    const f = feet[side];
    if (f.swing < 1) return;
    // THE SWING STARTS WHERE THE STANCE ENDED, which is not the plant. By the
    // end of a stance the foot is up on its toe, so starting the swing at the
    // plant with the ankle at standing height drops the ankle and moves it
    // backward in a single frame, which is a large jump at the knee on every
    // step and pushes the target out of reach for the two frames after it.
    // Recording the pose here rather than reconstructing it in applyLegs is
    // deliberate: the stance's pitch depends on where the body was, and the
    // body has moved on by the time the swing is drawn.
    f.liftPitch = heelOff(f, side);
    ankleOnPlant(f, f.liftPitch, f.fromAnkle);
    // The heading the stance held, kept before f.yaw is overwritten below. A
    // planted foot does not turn with the body, on purpose, so through a hard
    // turn it can end a stance most of a radian off the body's heading, and
    // taking the live yaw on the first frame of the swing spins the sole
    // through all of it in one frame.
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
    // kept as a second trigger so a foot that is neither behind nor out to the
    // side still takes its turn, and urgency wins over turn order, which is
    // what unpicks the transient at the start of a walk or after a hard turn.
    let pick = null;
    let best = 0.98;
    for (const side of ['L', 'R']) {
      group.worldToLocal(v1.copy(feet[side].plant));
      const back = Math.max(0, -v1.z) / (LIFT_BEHIND * SIDE[side].behind);
      const wide2 = Math.abs(v1.x - FOOT_X[side]) / (SPAN * 0.30);
      // Combined rather than taken separately: taking the larger of the two let
      // one foot step twice running on a turning start and left the other most
      // of a leg behind, which pulled the hips into a squat.
      const urgency = Math.hypot(back, wide2) * (side === nextStep ? 1 : 0.8);
      if (urgency > best) { best = urgency; pick = side; }
    }
    if (!pick) return;

    // Swing time follows speed, so the duty factor holds at any pace and the
    // cadence stays the distance cursor's to decide. The stiff leg is slower
    // through the air, which is the other half of the limp.
    const s = SIDE[pick];
    const base = speed > 0.05 ? ((2 - 2 * DUTY) * STEP_LENGTH) / speed : 0.34;
    queueStep(pick, HALF_STEP * s.step, clamp(base * s.dur, 0.16, 0.55), true);
    nextStep = pick === 'L' ? 'R' : 'L';
  }

  // ===========================================================================
  // HANDS
  // ===========================================================================
  // Where a hand should reach to: out in front of its own shoulder, on the
  // floor. Worked from the shoulder's real position rather than from the body's
  // origin, because during the climb the shoulder swings through most of its
  // own arm length while the hips barely move. Both distances are fractions of
  // the arm, so they shrink with it: the skeleton's 0.42 forward is 0.57 of its
  // shoulder-to-wrist span and 0.57 is what is used here.
  const HAND_AHEAD = ARM_SPAN * 0.57;
  const HAND_OUT = ARM_SPAN * 0.135;

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

  // ===========================================================================
  // SHED
  // ===========================================================================
  // Whatever the model marks as safe to detach, up to a hard budget, on the
  // three biggest efforts of the climb.
  //
  // NO BONE NAMES. The skeleton's plan names six specific ribs and fingers,
  // which is right there because that file and that model were written against
  // each other. Here the body half is being built in parallel and this half has
  // no business knowing whether it publishes a jacket scrap, a finger or a rib,
  // so it takes what rig.shed offers in order and does nothing at all if it
  // offers nothing. The BUDGET is a hard cap and stays one: a figure that
  // emerges and settles repeatedly must not disassemble itself over a few
  // minutes of play.
  const SHED_AT = [3.10, 3.70, 4.35];
  const SHED_V = [
    { velocity: [-0.85, 1.05, -0.18], spin: [3.5, 1.5, 5.5] },
    { velocity: [0.70, 0.95, 0.65], spin: [4.5, 2, 4] },
    { velocity: [-0.60, 1.15, 0.62], spin: [3, 2.5, 6] },
  ];
  function maybeShed(prev, t) {
    if (!debris || !rig.shed) return;
    for (let i = 0; i < SHED_AT.length; i++) {
      if (t < SHED_AT[i] || prev >= SHED_AT[i]) continue;
      const name = shedLeft.shift();
      if (!name) return;
      const piece = rig.shed.get(name);
      if (!piece) continue;
      // World velocity, so the piece leaves going where the body was going
      // rather than where the model happens to face. Scaled to the figure, or a
      // chibi's rib leaves at a skeleton's speed and reads as a bullet.
      const k = Math.sqrt(TOTAL_H / 2.5);
      v1.set(SHED_V[i].velocity[0], SHED_V[i].velocity[1], SHED_V[i].velocity[2])
        .multiplyScalar(k)
        .applyAxisAngle(v2.set(0, 1, 0), yaw);
      debris.spawn(piece, { velocity: v1.toArray(), spin: SHED_V[i].spin });
      shedFired.push(name);
    }
  }

  // ===========================================================================
  // THE HEAD AND THE JAW, DRIVEN
  // ===========================================================================

  const _av = new THREE.Vector3();
  function approachVec(from, to, rate, dt) {
    const k = Math.exp(-rate * dt);
    return _av.set(
      to.x + (from.x - to.x) * k,
      to.y + (from.y - to.y) * k,
      to.z + (from.z - to.z) * k,
    );
  }

  // The pelvis's acceleration in the BODY's frame, measured one frame late.
  // Velocity is smoothed before it is differenced, because differencing twice
  // at a variable dt is otherwise mostly noise.
  let lagPitch = 0;
  let lagRoll = 0;
  function measureBody(dt) {
    J.root.getWorldPosition(rootPos);
    if (accPrimed) {
      v1.subVectors(rootPos, rootPrev).divideScalar(dt);
      v2.copy(v1).sub(rootVel).divideScalar(dt);
      rootVel.copy(approachVec(rootVel, v1, 26, dt));
      rootAcc.copy(approachVec(rootAcc, v2, 16, dt));
    } else {
      accPrimed = true;
    }
    rootPrev.copy(rootPos);

    // Into the body's own frame. Yaw only, because the pelvis's pitch and roll
    // are themselves part of what is being measured and rotating the
    // measurement by them would fold the answer back into the question.
    const cy = Math.cos(-yaw);
    const sy = Math.sin(-yaw);
    bodyAcc.set(
      rootAcc.x * cy + rootAcc.z * sy,
      rootAcc.y,
      -rootAcc.x * sy + rootAcc.z * cy,
    );

    // tau_x = comY * a_z - comZ * a_y, normalised by comY so the gain has
    // units of seconds squared per metre and does not change meaning when the
    // model's head grows. Negated: the head lags what the body did.
    const tauX = bodyAcc.z - (HEAD_COM_Z / Math.max(HEAD_COM_Y, 1e-3)) * bodyAcc.y;
    const tauZ = bodyAcc.x;
    lagPitch = clamp(-HEAD_GAIN * tauX, -HEAD_PITCH_CAP, HEAD_PITCH_CAP);
    lagRoll = clamp(HEAD_GAIN * tauZ, -HEAD_ROLL_CAP, HEAD_ROLL_CAP);
  }

  // The mandible is a pendulum on a hinge at the back of the skull and the chin
  // hangs below and in front of it, so an upward acceleration of the head
  // leaves the chin behind and opens the jaw, and a forward one swings it open
  // too. Nothing about the walk cycle is fed to the jaw: it bounces on every
  // footfall because the head does.
  const jawBox = subtreeBox(J.jaw);
  const JAW_R_Y = jawBox.isEmpty() ? M.grin.height : Math.max(0.01, -jawBox.min.y);
  const JAW_R_Z = jawBox.isEmpty() ? M.head.depth * 0.4 : Math.max(0.01, jawBox.max.z);
  const JAW_GAIN = 0.040;
  const JAW_OPEN_MAX = LIMITS?.jaw?.x?.[1] ?? 0.62;
  const JAW_SIGN = J.jaw.userData?.openSign || 1;
  // A zombie's jaw does not clack shut against its own teeth, it hangs. Half
  // the skeleton's restitution and it never closes all the way.
  const JAW_BOUNCE = 0.14;
  const JAW_MIN = 0.04;

  function driveJaw(dt) {
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

    // Chatter is a rattle rather than a wave: little signed impulses into the
    // spring, which is what teeth actually do. A sine here reads as a flipbook,
    // and an unsigned kick is not a rattle, it is a bias that leaves the jaw
    // hanging open the whole time.
    chatterTimer -= dt;
    if (chatter > 0.02 && chatterTimer <= 0) {
      chatterTimer = 0.045 + rand() * 0.05;
      S.jaw.velocity += (rand() - 0.5) * 2 * (0.6 + rand() * 0.6) * chatter * 3.4;
    }

    S.jaw.target = clamp(jawBeat + clamp(torque, -0.18, 0.45), JAW_MIN, JAW_OPEN_MAX);
    S.jaw.step(dt);
    if (S.jaw.value < 0) {
      S.jaw.value = 0;
      if (S.jaw.velocity < 0) S.jaw.velocity *= -JAW_BOUNCE;
    } else if (S.jaw.value > JAW_OPEN_MAX) {
      S.jaw.value = JAW_OPEN_MAX;
      if (S.jaw.velocity > 0) S.jaw.velocity *= -JAW_BOUNCE * 0.5;
    }
    J.jaw.rotation.x = S.jaw.value * JAW_SIGN;
  }

  // ===========================================================================
  // APPLYING
  // ===========================================================================

  const POSE_KEYS = Object.keys(T).filter((k) => k !== 'lift');

  function applyPose(dt) {
    // The head's three springs get the AUTHORED intent plus the MEASURED lag,
    // and the lag is added to the target rather than to the output: a spring
    // driven by a target it is chasing lags it, rings around it and overshoots
    // it, and all three of those are the point. Added after the spring it would
    // be a decoration drawn on top, which is the thing this project does not do.
    T.head += lagPitch;
    T.neck += lagPitch * 0.22;
    T.headRoll += lagRoll;

    for (const key of POSE_KEYS) {
      S[key].target = T[key];
      S[key].step(dt);
    }

    // Tremor. Added AFTER the springs, because a spring is a low pass filter
    // and would swallow it. Two rates, so it reads as effort rather than as a
    // vibration: a slow one in the trunk and a fast one out at the claws.
    const shake = strain * strain;
    const slow = Math.sin(clock * 17.0) * 0.010 * shake;
    const fast = Math.sin(clock * 31.0 + 1.2) * 0.022 * shake;

    const root = S.root.value + slow;
    const lumbar = S.lumbar.value + slow * 1.4;
    const thorax = S.thorax.value + slow * 1.7;
    const neck = S.neck.value + slow * 2.0;
    const head = S.head.value + slow * 2.4;

    J.root.position.set(rootRest.x + S.sway.value, rootRest.y, rootRest.z);
    J.root.rotation.set(root, 0, S.roll.value + S.list.value);
    J.spineLower.rotation.x = lim('spineLower', 'x', lumbar - root);
    J.spineUpper.rotation.x = lim('spineUpper', 'x', thorax - lumbar);
    // The neck takes only the follow-through, and it is clamped hard: past
    // about 0.30 rad the skull ball drives through the deltoid, and on a figure
    // with no neck that is a very small angle to have to respect.
    J.neck.rotation.set(
      lim('neck', 'x', neck - thorax),
      lim('neck', 'y', S.headYaw.value * 0.22),
      lim('neck', 'z', S.headRoll.value * 0.25),
    );
    J.head.rotation.set(
      lim('head', 'x', head - neck),
      lim('head', 'y', S.headYaw.value * 0.78),
      lim('head', 'z', S.headRoll.value * 0.75),
    );

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
          v1.y = Math.sin(h.swing * Math.PI) * ARM_SPAN * 0.36;
        } else {
          v1.copy(h.plant);
        }
        v1.y += HAND_Y * scale;
        arm.parent.worldToLocal(v1);
        const ik = solveChain(ARM[side], v1);
        shoulderX = mix(shoulderX, ik.hipX, armBlend);
        shoulderZ = mix(shoulderZ, ik.hipZ, armBlend);
        elbowX = mix(elbowX, ik.knee, armBlend);
        // The claw keeps its authored angle relative to the forearm, so it
        // survives whatever the solve does to the arm above it.
        wristX = mix(wristX, wr - el, armBlend);
        if (armBlend > 0.99) {
          S[`shoulder${side}`].snap(thorax + ik.hipX);
          S[`elbow${side}`].snap(thorax + ik.hipX + ik.knee);
          S[`wrist${side}`].snap(thorax + ik.hipX + ik.knee + wristX);
        }
      }

      J[`shoulder${side}`].rotation.set(
        lim('shoulder', 'x', shoulderX), 0, lim('shoulder', 'z', shoulderZ),
      );
      J[`elbow${side}`].rotation.x = elbowX;
      J[`wrist${side}`].rotation.x = lim('wrist', 'x', wristX);
    }
  }

  // The legs, after the root is posed, because the IK is solved in the root's
  // frame and the root has just moved.
  function applyLegs(dt) {
    group.updateWorldMatrix(true, false);
    J.root.updateWorldMatrix(false, false);
    overLimit = 0;

    for (const side of ['L', 'R']) {
      const s = SIDE[side];
      let hipX = S[`hip${side}`].value - S.root.value;
      let hipZ = 0;
      let knee = S[`knee${side}`].value - S[`hip${side}`].value;
      let ankle = S[`ankle${side}`].value - S[`knee${side}`].value;

      if (legBlend > 0) {
        const f = feet[side];
        let pitchNow = 0;
        if (f.swing < 1) {
          // In the air. The ankle DESCENDS from the toe-off pose to the landing
          // pose, eased along the ground, with a hump on top. It is a hump on a
          // descent rather than the whole of the lift because that is what a
          // real ankle does: it is at its highest as the toe leaves, not half
          // way through the swing.
          const u = f.swing;
          const standY = f.to.y + ANKLE_Y * scale;
          v2.copy(f.to).setY(standY);
          v1.lerpVectors(f.fromAnkle, v2, easeInOutCubic(u));
          // The hump is only what the toe-off did not already provide. At mid
          // swing the descent has handed back exactly half the height the
          // stance carried in, so half of it is what is left to make up.
          const carried = Math.max(0, f.fromAnkle.y - standY);
          const arc = Math.max(0, FOOT_LIFT * s.lift * scale - 0.5 * carried);
          v1.y += Math.sin(u * Math.PI) * arc;

          // CIRCUMDUCTION. The stiff leg swings out to the side, because a knee
          // that will not bend has to get the foot round the other one somehow.
          // Applied in world along the body's own +X, which is the direction a
          // yaw of `yaw` sends local +X: (cos yaw, 0, -sin yaw).
          if (s.circum > 0) {
            const out = Math.sin(u * Math.PI) * s.circum * SPAN * scale
              * (side === 'L' ? 1 : -1);
            v1.x += Math.cos(yaw) * out;
            v1.z -= Math.sin(yaw) * out;
          }

          // Rolls out of the pitch the stance ended on, leads with the heel
          // through the second half, and comes back to flat for the landing.
          // Both ends are EXACT rather than clamped into place: the curve starts
          // at the stance's own pitch and reaches zero with zero slope, and
          // zero is what the planted branch reads on the frame it takes over,
          // so neither handover has a step in it.
          const raw = f.liftPitch * (1 - u) ** 1.6
            - TOE_UP * s.toeUp * u * u * (1 - u) ** 1.5;
          // The clearance clamp is a guard that never fires rather than a
          // shaper. Exact, so that the pose the swing starts from is exactly
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
          // stride at all, and it is why the ankle is placed by rotating it
          // about the toe rather than by adding a fudge to its height.
          pitchNow = heelOff(f, side);
          ankleOnPlant(f, pitchNow, v1);
        }
        footPitch[side] = pitchNow;
        J.root.worldToLocal(v1);
        const ik = solveChain(LEG[side], v1);
        ikShort[side] = ik.short;
        const kneeWorld = S.root.value + ik.hipX + ik.knee;
        hipX = mix(hipX, ik.hipX, legBlend);
        hipZ = mix(hipZ, ik.hipZ, legBlend);
        knee = mix(knee, ik.knee, legBlend);
        ankle = mix(ankle, pitchNow - kneeWorld, legBlend);

        // Keep the free-pose springs alongside the IK answer, so dropping back
        // to authored angles later starts from where the leg actually is.
        if (legBlend > 0.99) {
          S[`hip${side}`].snap(S.root.value + ik.hipX);
          S[`knee${side}`].snap(S.root.value + ik.hipX + ik.knee);
          S[`ankle${side}`].snap(kneeWorld + pitchNow);
        }
      }

      // The solver's answer is written UNCLAMPED and the excess is reported
      // instead. Clamping here would move the foot, and a foot that has been
      // moved after it was placed is exactly the foot slip this whole file is
      // built to avoid. metrics().overLimit is how a change to the model or the
      // gait that pushes a hip past its stop becomes a number in the harness
      // rather than a limp nobody can name.
      overLimit = Math.max(
        overLimit,
        Math.abs(hipX - lim('hip', 'x', hipX)),
        Math.abs(hipZ - lim('hip', 'z', hipZ)),
        Math.abs(knee - lim('knee', 'x', knee)),
      );

      J[`hip${side}`].rotation.set(hipX, 0, hipZ);
      J[`knee${side}`].rotation.x = knee;
      J[`ankle${side}`].rotation.x = ankle;

      if (legBlend > 0) {
        // The foot's orientation is set in WORLD terms and then pulled back
        // into the ankle's parent, rather than written as three local Euler
        // angles. Two things go wrong with the Euler version and both are
        // visible. Everything below the hip inherits the body's yaw, so a
        // planted foot spins on the spot as the body turns; and the pelvis list
        // plus the hip's own sideways swing tip the sole onto its outside edge,
        // which puts the far edge of the boot through the floor. On this figure
        // the list is 0.115 rad every single step, so the second one is not an
        // edge case here the way it is on the skeleton: it happens twice a
        // cycle, for ever. Composing the parent's rotation from the values just
        // written and inverting it fixes both exactly, and costs six quaternion
        // multiplies.
        const f = feet[side];
        const footYaw = f.swing >= 1
          ? f.yaw
          : f.fromYaw + wrap(yaw - f.fromYaw) * easeInOutCubic(f.swing);
        qWant.setFromAxisAngle(X_AXIS, footPitch[side]);
        qTmp.setFromAxisAngle(Y_AXIS, footYaw);
        qWant.premultiply(qTmp);

        qParent.setFromAxisAngle(Y_AXIS, yaw);
        qParent.multiply(qTmp.setFromEuler(
          eul.set(S.root.value, 0, S.roll.value + S.list.value, 'XYZ'),
        ));
        qParent.multiply(qTmp.setFromEuler(eul.set(hipX, 0, hipZ, 'XYZ')));
        qParent.multiply(qTmp.setFromAxisAngle(X_AXIS, knee));

        qWant.premultiply(qParent.invert());
        J[`ankle${side}`].quaternion.slerp(qWant, legBlend);
      }
    }
  }

  // Some models put a contact patch under each foot. They are children of the
  // group, so they sink with it, and a patch under a buried figure is a stain
  // on the floor with nothing above it.
  function applyContacts() {
    if (!contacts.length) return;
    const show = phase === 'buried' ? 0 : clamp01((T.lift - BURIED_Y) / (HIP_TALL - BURIED_Y) * 2);
    for (let i = 0; i < contacts.length; i++) {
      const patch = contacts[i];
      patch.visible = show > 0.01;
      if (!patch.visible) continue;
      const joint = i === 0 ? J.ankleL : J.ankleR;
      joint.getWorldPosition(v1);
      const lift = clamp01(1 - Math.max(0, v1.y - ANKLE_Y * scale) / (FOOT_LIFT * 2 * scale));
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
    const rollNow = S.roll.value + S.list.value;
    const cr = Math.cos(rollNow);
    const sr = Math.sin(rollNow);
    const cp = Math.cos(S.root.value);
    const sp = Math.sin(S.root.value);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    let cap = Infinity;
    for (const side of ['L', 'R']) {
      const f = feet[side];
      if (f.swing < 1) continue;
      // The hip in the group's frame: the pelvis is swayed sideways and rolled,
      // and rolling swings one hip up and the other down. On this figure the
      // list is 0.115 rad on a 0.198 hip separation, which is 11mm of hip
      // height every step, and the margin at full stretch is smaller than that.
      const hx = LEG[side].root.x;
      const lx = rootRest.x + S.sway.value + hx * cr;
      const ly = hx * sr * cp;
      const lz = rootRest.z + hx * sr * sp;
      const wx = pos.x + (lx * cy + lz * sy) * scale;
      const wz = pos.z + (-lx * sy + lz * cy) * scale;
      const horiz = Math.hypot(wx - f.plant.x, wz - f.plant.z);
      const up = Math.sqrt(Math.max(reach * reach - horiz * horiz, 0));
      cap = Math.min(cap, f.plant.y + ANKLE_Y * scale + up - ly * scale);
    }
    // A floor under the ceiling. If something has gone wrong enough that a foot
    // is most of a leg out of position, a figure crouching to reach it looks
    // far worse than a foot a few millimetres off the ground for the two frames
    // it takes the gait to fix itself.
    return Math.max(cap, (HIP_TALL - SPAN * 0.22) * scale);
  }

  // ===========================================================================
  // THE LOOP
  // ===========================================================================

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

    // Both of these read the pose the LAST frame left behind. One frame of lag
    // is exactly what a mass on a hinge looks like anyway, and measuring before
    // the phases run is what keeps the head's drive out of its own feedback
    // path.
    measureBody(dt);
    driveJaw(dt);

    // Defaults every phase is free to override, so a value set in one phase
    // cannot leak into the next and quietly hold the head turned.
    T.headYaw = 0;
    T.headRoll = 0;
    T.roll = 0;
    T.list = 0;
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
    group.position.set(pos.x, S.lift.value - rootRest.y * scale, pos.z);
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
    cursorFix = 0;
    nextStep = SOUND;
    legBlend = 0;
    armBlend = 0;
    handsDown = false;
    shakeFired = 0;
    lagPitch = 0;
    lagRoll = 0;
    accPrimed = false;
    headPrimed = false;
    enter('buried');
    stepBuried(0, null);
    // Snapped rather than eased into: easing in from zero on frame one reads as
    // the rig assembling itself out of its bind pose.
    for (const key of POSE_KEYS) S[key].snap(T[key]);
    S.jaw.snap(jawBeat);
    S.lift.snap(T.lift);
    group.position.set(pos.x, S.lift.value - rootRest.y * scale, pos.z);
    group.rotation.y = yaw;
    group.updateMatrixWorld(true);
    J.root.getWorldPosition(rootPrev);
    J.head.getWorldPosition(headPrev);
    rootVel.set(0, 0, 0); rootAcc.set(0, 0, 0);
    headVel.set(0, 0, 0); headAcc.set(0, 0, 0);
    applyPose(1 / 60);
    applyLegs(1 / 60);
    applyContacts();
  }

  // Every number this file derived, so the harness can print it beside the
  // skeleton's hand-tuned equivalents rather than anybody taking the formulas
  // on trust. Frozen, because it is a report and not a control surface.
  const derived = Object.freeze({
    totalHeight: TOTAL_H,
    headFrac,
    chibi,
    wide,
    waddle,
    headInertia: HEAD_I,
    span: SPAN,
    ankleY: ANKLE_Y,
    hipSep: HIP_SEP,
    armSpan: ARM_SPAN,
    shoulderY: SHOULDER_Y,
    headY: HEAD_Y,
    toeAhead: TOE_AHEAD,
    heelBack: HEEL_BACK,
    handY: HAND_Y,
    hipTall: HIP_TALL,
    hipStalk: HIP_STALK,
    hipCrouch: HIP_CROUCH,
    buriedY: BURIED_Y,
    halfStep: HALF_STEP,
    liftBehind: LIFT_BEHIND,
    stepLength: STEP_LENGTH,
    duty: DUTY,
    cadence: CADENCE,
    topSpeed: TOP_SPEED,
    bob: BOB,
    sway: SWAY,
    list: LIST,
    footLift: FOOT_LIFT,
    maxHeel: MAX_HEEL,
    stopRange: STOP_RANGE,
    stiffSide: STIFF,
    headSpring: { stiffness: 260 / HEAD_I, damping: 25.0 / HEAD_I },
  });

  reset();

  const api = {
    update,
    reset,
    derived,
    get state() { return phase; },
    // For the game, which owns the state machine. The autonomous scene never
    // calls either of these: it decides its own phases from the ghost's
    // distance, which is what wakeRange is for.
    //
    // setPhase is a request rather than a command and it no-ops when the phase
    // already matches, because enter('buried') resets the gait cursor and
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
    // one that stays fixed: the harness reads foot slip, head lag and phase
    // dwell out of here rather than off a screenshot.
    metrics() {
      const out = {
        phase, phaseTime, clock, speed, yaw, yawVel, travel, cursor,
        hipY: S.lift.value, jaw: S.jaw.value, legBlend, strain, clipping,
        stiffSide: STIFF,
        shed: shedFired.slice(),
        debris: debris?.stats?.() || null,
        feet: {},
      };
      out.root = S.root.value;
      out.roll = S.roll.value;
      out.list = S.list.value;
      out.sway = S.sway.value;
      // The head, which is the thing this file is really about. `lag` is what
      // the body's acceleration asked for and `head` is where the spring
      // actually is, so the difference between them IS the lag, in radians.
      out.head = {
        pitch: J.head.rotation.x,
        yaw: J.head.rotation.y,
        roll: J.head.rotation.z,
        lagPitch,
        lagRoll,
        worldPitch: S.head.value,
      };
      out.knee = { L: J.kneeL.rotation.x, R: J.kneeR.rotation.x };
      out.hip = { L: J.hipL.rotation.x, R: J.hipR.rotation.x };
      out.swing = { L: feet.L.swing, R: feet.R.swing };
      // Metres the IK target was out of the leg's reach. Anything above zero
      // means the solver is sitting on its full-extension clamp.
      out.short = { L: ikShort.L, R: ikShort.R };
      // Radians any leg joint was driven past its published stop.
      out.overLimit = overLimit;
      out.liftCap = liftCap;
      for (const side of ['L', 'R']) {
        J[`ankle${side}`].getWorldPosition(v1);
        // The contact point, not the pivot. Once the heel is off, the ankle is
        // supposed to be moving and the toe is supposed not to be, so the toe
        // is the only honest place to measure foot slip.
        v2.set(0, -ANKLE_Y, TOE_AHEAD);
        J[`ankle${side}`].localToWorld(v2);
        out.feet[side] = {
          world: v1.toArray(),
          toe: v2.toArray(),
          swinging: feet[side].swing < 1,
          plant: feet[side].plant.toArray(),
          pitch: footPitch[side],
        };
      }
      return out;
    },
    dispose() {
      setClipping(false);
    },
  };

  // Harness hook. metrics() is only useful to something that can reach this
  // object, and a page's test hook has no handle on the scene graph, so every
  // performance built in a browser registers itself here. A list rather than a
  // single slot because a lab page can build more than one, and the game builds
  // up to five.
  if (typeof window !== 'undefined') (window.__zombies ||= []).push(api);

  return api;
}
