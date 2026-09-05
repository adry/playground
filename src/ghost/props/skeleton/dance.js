import * as THREE from 'three';
import M from './metrics.js';
import { Spring, easeInOutCubic, easeOutBack } from './motion.js';

// THREE SKELETONS DANCING. The finale: the player finishes a game and the
// things that spent the run chasing him line up and dance.
//
// It is written to the same rule as perform.js, which is the reference for how
// this project animates, and it borrows that file's machinery on purpose:
//
//   * every joint angle is a SPRING TARGET, never a keyframe played back. The
//     forearm lags the upper arm, the skull lags the chest and the jaw lags
//     everything, and none of that is authored. It is why a snap on the beat
//     reads as a snap rather than as a cut.
//   * the legs are inverse kinematics onto FOOT PLANTS fixed in the troupe's
//     frame. A foot does not move until a step moves it, so the feet cannot
//     skate. The pelvis rides over the FEET rather than the feet chasing the
//     pelvis: it is placed at the weighted mean of the two plants, weighted by
//     how much of the body each foot is carrying, so a shuffle carries the hips
//     with it and a toe point shifts the weight onto the standing leg without
//     either being authored. See applyPose.
//   * the jaw is a pendulum hung off the skull's own measured acceleration, so
//     it clacks on every accent because the head stopped.
//
// The one thing that is NOT a consequence is the bounce on the beat, which is
// added after the springs for the same reason perform.js adds its tremor after
// them: a spring is a low pass filter and the beat is 2 Hz. Passing the bounce
// through the hip spring smears the accent and turns the dance into a wallow.
//
// ANGLES. Same convention as perform.js, and it is worth restating because
// everything below is authored in it. Every joint is identity at rest and
// rotations about X commute, so "world pitch" means the SUM of rotation.x down
// the chain: the angle a segment has swung from its rest direction. Zero is the
// rest pose. For the spine, positive leans the chest forward. For a limb
// hanging down, positive swings it backward and negative swings it forward, so
// an arm raised straight up is -180. Local rotations are recovered at the end
// by subtracting the parent's world pitch.
//
// SIDES. metrics.js LEFT_X: the figure faces +Z with +Y up, so its own LEFT is
// at POSITIVE x. Everything here that says L is at +x. Getting this backwards
// is what produced a cross-limbed walk in an earlier pass of perform.js, and a
// mirrored dance would be far harder to spot.

// --- the beat ----------------------------------------------------------------

// 118 BPM. It is the tempo the idiom is played at, and every single move below
// lands on a beat or a half beat of it. The grid is the content here: a move
// that arrives 80ms early reads as a different dancer, not as a slower one.
export const BPM = 118;
// One phrase, and the loop. Sixteen beats is 8.14 seconds, which is long enough
// to hold four distinct ideas and short enough that a fifteen second clip shows
// it happen twice, which is what makes it read as a routine rather than as a
// sequence of poses.
export const PHRASE_BEATS = 16;
// The wind-up, played once before the loop starts. It is where the figure gets
// from wherever the game left it into the routine: the feet come back under the
// hips, the head comes round to the front and the arms load.
const INTRO_BEATS = 4;

const D = Math.PI / 180;
const TAU = Math.PI * 2;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// --- the figure's own numbers ------------------------------------------------

// Hip pivot height. The leg is 1.150 from hip pivot to ankle pivot and M.y.hip
// is 1.225, so a figure standing at M.y.hip has its knees locked dead straight
// and cannot bend, bounce or step. 1.150 is about 24 degrees of knee, which is
// a dancer's stance: enough bend to drop into and enough leg left to push with.
//
// It was 1.105 and that was 45mm too low. The paragraph above is what the
// stance was meant to be and the constant had drifted below it, so the routine
// never straightened. Measured over a phrase on the planted leg, the knee ran
// 46 degrees at its shallowest, 62 median, 94 at its deepest: a figure that
// squats for sixteen beats rather than one that drops and pushes, and with no
// tall beat to set the low ones against. At 1.150 the lift track and the bounce
// are untouched, so the hips still travel the same 137mm over the phrase, but
// that travel now runs 21 / 45 / 87, which puts the accents at the 24 degrees
// this paragraph always claimed and leaves the drops as deep as they were.
const HIP_BASE = 1.150;
// How far the hips drop on each beat, at amplitude 1. Added after the springs.
const BOUNCE = 0.048;
// And the extra drop on the first beat of each bar, which is what stops four
// identical beats reading as a metronome.
const BAR_ACCENT = 0.022;

// The stance. Wider than the model's own, and turned out. The rig stands with
// its feet 0.41 apart and dead parallel, which is a figure standing to
// attention: at the clip's framing the first render of this routine read as
// three skeletons doing arm exercises, and the legs were most of why. Pushing
// each foot 70mm out and turning the toes out 11 degrees is a dancer's stance
// and it costs nothing, because the plants are authored and the IK follows.
const STANCE_OUT = 0.07;
const STANCE_TURN = 0.20;

// Where the toe tip sits relative to the ankle pivot, and the same two corners
// as polar coordinates about it. Lifted from perform.js, where the derivation
// is: legs.js puts the pivot a quarter of the way back along a foot M.leg.foot
// long, and measured off the built mesh the tip lands at 0.749 of that length.
// The polar form is what the floor-clearance clamp actually wants.
const TOE_AHEAD = M.leg.foot * 0.749;
const HEEL_BACK = M.leg.foot * 0.248;
const TOE_R = Math.hypot(M.y.ankle, TOE_AHEAD);
const TOE_PHI = Math.atan2(M.y.ankle, TOE_AHEAD);
const HEEL_R = Math.hypot(M.y.ankle, HEEL_BACK);
const HEEL_PHI = Math.atan2(HEEL_BACK, M.y.ankle);

// --- small helpers -----------------------------------------------------------
// clamp, mix, smoothstep, wrap, track and mulberry32 are copied from
// perform.js. They are private there and this file is forbidden from editing
// it, so they are duplicated rather than reached for. They are pure and they
// have no reason to drift.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// Frame-rate independent approach, for the handful of quantities that want a
// simple lag rather than a spring. From perform.js.
const approach = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);
const clamp01 = (v) => clamp(v, 0, 1);
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a || 1)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

function wrap(a) {
  a = (a + Math.PI) % TAU;
  return (a < 0 ? a + TAU : a) - Math.PI;
}

// Piecewise keyframe track: [[t, value], [t, value], ...], eased between keys.
// Copied from perform.js. Used only to author intent; what reaches the rig is
// always a spring's answer to these, never the numbers themselves.
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

// A snap rather than an ease, for the accents. Almost all of the move happens
// in the first fifth of the interval and the spring underneath does the rest.
const snapEase = (t) => 1 - (1 - t) ** 5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the routine -------------------------------------------------------------
//
// Sixteen beats, four bars, and every entry below is on a beat or a half beat.
// It is written IN THE IDIOM rather than copied from it: these are the moves
// the routine is famous for, rebuilt for a figure that is all silhouette and
// has no flesh to sell anything subtler.
//
//   bar 1, beats 0-3    THE CLAW. Arms snap up in front, elbows high, wrists
//                       broken forward. The head snaps to the camera on 0 and
//                       away on 2. The claw pulses on every beat and the hips
//                       push side to side underneath it.
//   bar 2, beats 4-7    THE SHUFFLE. Two steps to the figure's left on 4 and 5,
//                       two back to the right on 6 and 7, the trailing foot
//                       always half a beat behind the leading one. Arms drop
//                       and swing across the body against the travel.
//   bar 3, beats 8-11   THE TOE POINT. Right toe out on 8, planted on its point
//                       with the knee drawn in, left arm punched up, right arm
//                       across. Mirrored on 10. The weight visibly goes onto
//                       the standing leg, because the pelvis rides the feet.
//   bar 4, beats 11.5-16  THE WAVE AND THE TURN. A roll travels up the body
//                       from the hips to the fingers, and it is fired a beat
//                       apart along the line so it travels down the troupe.
//                       Then a turn away on 14 and back to front on 15, and
//                       everything snaps back to the claw on 16, which is 0.
//
// Angles are world pitch in DEGREES, distances in metres, and the beat axis
// wraps: the value at 16 is the value at 0 by construction, because 16 is 0.

// Shoulder world pitch. -180 is straight up, -90 is straight out in front, 0
// hangs down.
//
// THE CLAW, and the number is worth the working, because the obvious value is
// the wrong one. -126 was the first guess: it raises the upper arm 36 degrees
// above horizontal, and with a bent elbow on top of that the forearm ends up
// past vertical and the hand finishes above and BEHIND the shoulder. Solved
// out, that pose puts the hands at crown height and 140mm in front of the
// chest, which is not a claw, it is surrender.
//
// -98 leaves the upper arm just above horizontal, so the elbows sit forward at
// chest height and out at 34 degrees of spread, the forearms stand up, and the
// hands land at about mouth height and 370mm clear in front. Elbows low and
// out, hands up in front, wrists broken forward over them: that is the shape,
// and it is the one that survives being 40 pixels tall.
const CLAW = -98;
const ARM = {
  R: [
    [0, CLAW, snapEase], [0.5, CLAW - 5], [1, CLAW + 7], [1.5, CLAW - 5],
    [2, CLAW + 7], [2.5, CLAW - 5], [3, CLAW + 6], [3.5, CLAW - 4],
    // The shuffle. The arms fall out of the claw and swing across the body,
    // against the direction of travel, which is what keeps a side step from
    // reading as a stumble.
    [4, -54, snapEase], [4.5, -40], [5, -58], [5.5, -40],
    [6, -60], [6.5, -44], [7, -58], [7.5, -46],
    // The toe points. Right toe out on 8, so the RIGHT arm is the one that
    // drops across the body and the left punches up.
    [8, -24, snapEase], [9, -30], [9.5, -26],
    [10, -158, snapEase], [11, -150], [11.4, -156],
    // Into the wave, which takes the arms over from here.
    [12, -76], [13.5, -92],
    // The turn. Arms trail low and behind, which is what makes the turn read
    // as a turn rather than as a figure rotating on a plinth.
    [14, -30, snapEase], [14.6, -14], [15, -34], [15.6, -18],
    [16, CLAW, snapEase],
  ],
  L: [
    [0, CLAW, snapEase], [0.5, CLAW - 5], [1, CLAW + 7], [1.5, CLAW - 5],
    [2, CLAW + 7], [2.5, CLAW - 5], [3, CLAW + 6], [3.5, CLAW - 4],
    [4, -54, snapEase], [4.5, -58], [5, -40], [5.5, -58],
    [6, -42], [6.5, -58], [7, -44], [7.5, -56],
    [8, -158, snapEase], [9, -150], [9.5, -156],
    [10, -24, snapEase], [11, -30], [11.4, -26],
    [12, -76], [13.5, -92],
    [14, -30, snapEase], [14.6, -14], [15, -34], [15.6, -18],
    [16, CLAW, snapEase],
  ],
};

// Elbow flex, degrees, subtracted from the shoulder's world pitch. The claw's
// 78 is what gets the hands in front of the chest instead of over the head.
const ELBOW = {
  R: [
    [0, 78, snapEase], [1, 64], [1.5, 80], [2, 64], [2.5, 80], [3, 66], [3.5, 80],
    [4, 62, snapEase], [4.5, 48], [5, 66], [5.5, 48], [6, 68], [6.5, 50], [7, 66], [7.5, 52],
    [8, 74, snapEase], [9.5, 70],
    [10, 22, snapEase], [11.4, 18],
    [12, 46], [13.5, 40],
    [14, 40, snapEase], [15.6, 34],
    [16, 78, snapEase],
  ],
  L: [
    [0, 78, snapEase], [1, 64], [1.5, 80], [2, 64], [2.5, 80], [3, 66], [3.5, 80],
    [4, 62, snapEase], [4.5, 66], [5, 48], [5.5, 66], [6, 50], [6.5, 68], [7, 52], [7.5, 66],
    [8, 22, snapEase], [9.5, 18],
    [10, 74, snapEase], [11.4, 70],
    [12, 46], [13.5, 40],
    [14, 40, snapEase], [15.6, 34],
    [16, 78, snapEase],
  ],
};

// The wrist, in degrees the hand breaks FORWARD off the forearm. This is the
// bent-wrist claw and it is most of what the hands say at this size.
//
// It is ADDED to the forearm's world pitch where the elbow's flex is
// subtracted, and the two really do go opposite ways. Subtracting is what
// bends an elbow, because a forearm swings forward off a limb that hangs
// down; but the claw's forearm is standing up, and continuing to subtract from
// there folds the hand back over the top of the arm. The hand has to come the
// other way to hang forward over the knuckles.
const WRIST = {
  R: [
    [0, 52, snapEase], [1, 44], [2, 52], [3, 44], [3.5, 54],
    [4, 26, snapEase], [7.5, 22],
    [8, 40, snapEase], [9.5, 36],
    [10, 30, snapEase], [11.4, 34],
    [12, 30], [13.5, 46],
    [14, 20, snapEase], [15.6, 24],
    [16, 52, snapEase],
  ],
  L: [
    [0, 52, snapEase], [1, 44], [2, 52], [3, 44], [3.5, 54],
    [4, 26, snapEase], [7.5, 22],
    [8, 30, snapEase], [9.5, 34],
    [10, 40, snapEase], [11.4, 36],
    [12, 30], [13.5, 46],
    [14, 20, snapEase], [15.6, 24],
    [16, 52, snapEase],
  ],
};

// How far each arm is held out to the side, degrees. The claw is WIDE, because
// at the game's framing the only thing that survives is the silhouette and a
// claw held in front of the ribs disappears into them.
const SPREAD = {
  R: [
    [0, 34, snapEase], [1, 30], [2, 34], [3, 30], [3.5, 36],
    [4, 16, snapEase], [7.5, 14],
    [8, 10, snapEase], [9.5, 12],
    [10, 26, snapEase], [11.4, 24],
    [12, 30], [13.5, 44],
    [14, 20, snapEase], [15.6, 16],
    [16, 34, snapEase],
  ],
  L: [
    [0, 34, snapEase], [1, 30], [2, 34], [3, 30], [3.5, 36],
    [4, 16, snapEase], [7.5, 14],
    [8, 26, snapEase], [9.5, 24],
    [10, 10, snapEase], [11.4, 12],
    [12, 30], [13.5, 44],
    [14, 20, snapEase], [15.6, 16],
    [16, 34, snapEase],
  ],
};

// Torso pitch, degrees, positive leaning forward. A dancer is never quite
// upright; the lean changes on every accent and that is half of what makes a
// held pose look held rather than parked.
const TORSO = [
  [0, 12, snapEase], [1, 7], [2, 12], [3, 7], [3.5, 13],
  [4, 5, snapEase], [6, 7], [7.5, 5],
  [8, 10, snapEase], [10, 10], [11.4, 8],
  [12, 4], [13, 14], [13.5, 6],
  [14, 9, snapEase], [15, 9], [15.6, 5],
  [16, 12, snapEase],
];

// Skull world pitch. Negative looks up. The chin comes UP on the claw, which is
// the difference between a menacing pose and a sulking one.
const GAZE = [
  [0, -14, snapEase], [1, -8], [2, -14], [3, -8], [3.5, -15],
  [4, -2, snapEase], [7.5, -4],
  [8, -16, snapEase], [9.5, -12],
  [10, -16, snapEase], [11.4, -12],
  [12, 4], [12.8, -18], [13.5, -6],
  [14, 2, snapEase], [15.6, -4],
  [16, -14, snapEase],
];

// Head yaw, degrees. ZERO IS FACING THE CAMERA, because the troupe is turned so
// that each dancer's own +Z points at it. So this table is a list of the
// moments the head snaps to the front and the moments it looks away.
const HEAD_YAW = [
  [0, 0, snapEase], [1.5, 0], [2, -30, snapEase], [3, -30], [3.5, 0, snapEase],
  [4, 26, snapEase], [5.5, 26], [6, -26, snapEase], [7.5, -26],
  [8, 0, snapEase], [9.5, 0],
  [10, 0], [11.4, 0],
  [12, 18], [13, -18], [13.5, 0],
  // The head holds the front for half a beat after the body has started to
  // turn, and it is the last thing to come back. That lag is the move.
  [14.4, 0], [15, 34, snapEase], [15.5, 34],
  [16, 0, snapEase],
];

// Chest twist against the hips, degrees, about Y. Positive turns the chest
// toward the figure's left.
const TWIST = [
  [0, 0, snapEase], [1, 10], [2, -10], [3, 10], [3.5, 0],
  [4, 14, snapEase], [5.5, 14], [6, -14, snapEase], [7.5, -14],
  [8, -16, snapEase], [9.5, -14],
  [10, 16, snapEase], [11.4, 14],
  [12, 0], [13.5, 0],
  [14, 0], [15.6, 0],
  [16, 0, snapEase],
];

// Pelvis yaw against the chest, degrees. THE HIP PUSH. It is the biggest, most
// legible thing in the routine at the game's framing, so it is worked hard.
const PELVIS_YAW = [
  [0, 0, snapEase], [1, -14], [2, 14], [3, -14], [3.5, 0],
  [4, -10, snapEase], [5.5, -10], [6, 10, snapEase], [7.5, 10],
  [8, 18, snapEase], [9, 22], [9.5, 18],
  [10, -18, snapEase], [11, -22], [11.4, -18],
  [12, 0], [13.5, 0],
  [14, 0], [15.6, 0],
  [16, 0, snapEase],
];

// THE HIP PUSH, as a lateral shift of the pelvis in metres, positive toward the
// figure's left. It goes with PELVIS_YAW rather than instead of it: yaw alone
// turns the pelvis on the spot, which at the game's framing is about four
// pixels of change and invisible, while a shift moves the whole silhouette of
// the hips against a stationary ribcage and reads at any size. The two
// together are the move.
const HIP_PUSH = [
  [0, 0, snapEase], [1, -0.055], [2, 0.055], [3, -0.055], [3.5, 0],
  [4, 0, snapEase], [7.5, 0],
  [8, 0.05, snapEase], [9, 0.065], [9.5, 0.05],
  [10, -0.05, snapEase], [11, -0.065], [11.4, -0.05],
  [12, 0], [13.5, 0],
  [14, 0], [15.6, 0],
  [16, 0, snapEase],
];

// Torso roll, degrees, positive leans toward the figure's right.
const ROLL = [
  [0, 0, snapEase], [1, 8], [2, -8], [3, 8], [3.5, 0],
  [4, -6, snapEase], [5.5, -6], [6, 6, snapEase], [7.5, 6],
  [8, -9, snapEase], [9.5, -8],
  [10, 9, snapEase], [11.4, 8],
  [12, 0], [13.5, 0],
  [14, 0], [15.6, 0],
  [16, 0, snapEase],
];

// How much of the body's turn the head REFUSES to take, 0 to 1. This is the
// whole of why the turn reads: the body goes first and the skull stays looking
// at the viewer for half a beat, then gives up and whips round after it. A head
// that turns with the shoulders is a figure rotating on a plinth.
const HEAD_HOLD = [
  [0, 0], [13.9, 0], [14.0, 0.85, snapEase], [14.45, 0.85], [14.8, 0], [16, 0],
];

// The body's own yaw, degrees, relative to facing the camera. THE TURN. Out on
// 14 and back on 15, and the feet below take pivot steps to match, so the turn
// is something the figure does with its legs rather than something done to it.
const BODY_YAW = [
  [0, 0], [13.9, 0],
  [14.0, -62, easeOutBack], [14.9, -62],
  [15.0, 0, easeOutBack], [16, 0],
];

// The base hip height. The beat bounce is added on top of this, after the
// spring. The dips here are the slow ones: the load before the claw, the sink
// onto the standing leg during a toe point.
const HIP = [
  [0, HIP_BASE - 0.012], [1.5, HIP_BASE], [3.5, HIP_BASE - 0.02],
  [4, HIP_BASE - 0.045], [7.5, HIP_BASE - 0.040],
  [8, HIP_BASE - 0.034], [11.4, HIP_BASE - 0.03],
  [12, HIP_BASE - 0.01], [13.2, HIP_BASE + 0.012], [13.6, HIP_BASE - 0.03],
  [14, HIP_BASE - 0.018], [15.6, HIP_BASE - 0.024],
  [16, HIP_BASE - 0.012],
];

// The jaw, on top of whatever the skull's own acceleration is doing to it. It
// clacks on the beat because a hinged mandible on a body that just stopped
// hard has nowhere else to go.
const JAW = [
  [0, 0.34, snapEase], [0.4, 0.05], [1, 0.24, snapEase], [1.4, 0.05],
  [2, 0.30, snapEase], [2.4, 0.05], [3, 0.24, snapEase], [3.4, 0.05],
  [4, 0.26, snapEase], [4.4, 0.05], [5, 0.18, snapEase], [5.4, 0.05],
  [6, 0.26, snapEase], [6.4, 0.05], [7, 0.18, snapEase], [7.4, 0.05],
  [8, 0.36, snapEase], [8.5, 0.06], [9.5, 0.10],
  [10, 0.36, snapEase], [10.5, 0.06], [11.4, 0.10],
  [12, 0.14], [13.2, 0.30], [13.6, 0.08],
  [14, 0.20, snapEase], [14.5, 0.06], [15, 0.20, snapEase], [15.5, 0.06],
  [16, 0.34, snapEase],
];

// --- the wave ----------------------------------------------------------------
// A roll that travels up the body and out through the fingers. It is the move
// the troupe exists for: fired a beat apart along the line, it is the ONLY
// thing on screen that could not be one dancer rendered three times.
//
// Each segment is the one below it, delayed. The signs alternate, because a
// body wave is a sinuous flex and not a bow: the hips go forward, the chest
// goes back, the head goes forward again.
const WAVE_AT = 11.5;          // beats, before the per-dancer lag
const WAVE_LEN = 2.0;          // beats it takes to travel the whole body
const WAVE = [
  // key            delay (beats)  amplitude (degrees, or metres for hipY)
  { key: 'pelvis', delay: 0.00, amp: 16 },
  { key: 'lumbar', delay: 0.18, amp: -20 },
  { key: 'thorax', delay: 0.34, amp: 22 },
  { key: 'gaze', delay: 0.52, amp: -26 },
  { key: 'arm', delay: 0.44, amp: -58 },
  { key: 'elbow', delay: 0.60, amp: -34 },
  { key: 'wrist', delay: 0.76, amp: 46 },
  { key: 'spread', delay: 0.50, amp: 30 },
];
const WAVE_SEG = 0.62;         // how long one segment's own bump lasts, in beats

// --- the footwork ------------------------------------------------------------
// Every step in the phrase, in the dancer's own rest frame: +x is the figure's
// LEFT (see LEFT_X), +z is toward the camera, yaw is the heading the sole holds
// once it lands, pitch is how far the foot is up on its toe, and weight is how
// much of the body the foot is carrying once it is down.
//
// Nothing else moves a foot. Between these the plant is a fixed point and the
// IK is solved onto it, which is the whole of why the feet do not slide.
//
// The turn's four steps are the rest stance rotated about the body's centre, so
// the figure turns on its feet: `pivot` below builds them rather than having
// four rotated pairs of coordinates written out by hand and drifting.
// How far in FRONT of the hips the feet stand, and it is not a small number
// because it is not a stylistic choice: it is what stops the shins going dark.
//
// This routine is a squat, and a squat throws the knee forward of the ankle. At
// 0.02 the feet stood under the hips, the knee ended up 284mm ahead of the
// ankle, and the shin therefore raked 30 degrees backward -- which, under this
// project's fixed camera, points it almost exactly along the view axis. Two
// things go wrong at once. The shin foreshortens to half its length, so it
// reads as a stub; and the surface the camera can see is then the shin's
// UNDERSIDE, whose normal tilts away from a key light that sits 54 degrees up,
// so it renders at 0.15 of the key against the thigh's 0.87. The result is a
// dark grey segment with the white foot apparently detached below it, on every
// dancer, on every beat. It looks exactly like a model bug and it is not one:
// the same rig in its bind pose in the same frame has white shins.
//
// Standing the feet forward puts the ankle back under the knee. Measured over a
// phrase, 0.22 takes the shin from 30 degrees off vertical to 13, and the lit
// fraction of the visible surface from 0.15 to 0.43, with the frames rendering
// under 0.30 falling from 89% to 17%. It costs nothing: foot slip and IK
// shortfall both stay at exactly zero, because the plants are still fixed
// points and the legs still reach them, with the longest hip-to-ankle span over
// the phrase at 1.130 against a leg of 1.150. Past about 0.26, paired with the
// hip height above, the legs run out of reach and the feet start to skate.
//
// It is also the better stance. A figure squatting with its feet under its hips
// is sitting down; one with its feet under its knees is loaded to spring.
const STANCE_Z = 0.22;
// How far the bar 2 shuffle carries the troupe sideways, in metres. Published
// so a caller framing a shot knows how much room the line needs beside it.
export const SHUFFLE_SPAN = 0.54;
function pivot(x, z, deg) {
  const a = deg * D;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Rotating a point by the body's yaw. Yaw turns +Z toward +X, which is
  // three's Y rotation, so this is that rotation applied to (x, z).
  return { x: x * c + z * s, z: -x * s + z * c };
}

function buildSteps(stance) {
  const L0 = stance.L.x;
  const R0 = stance.R.x;
  const YL = stance.L.yaw;
  const YR = stance.R.yaw;
  const S = [];
  const add = (beat, side, x, z, yaw = 0, pitch = 0, weight = 1, dur = 0.34) =>
    S.push({ beat, side, x, z, yaw, pitch, weight, dur });

  // Bar 2: two shuffles to the figure's left, then two back. The trailing foot
  // is always half a beat behind the leading one, which is what makes it a
  // shuffle and not a jump.
  // 0.27 rather than 0.30. Two of these carry the body 0.54 across, which is a
  // tenth of the frame at the clip's framing and unmissable; at 0.30 the
  // trailing leg was 13mm out of reach at the far end of the second one, which
  // the guard below would have caught but which is better not to ask for.
  const STEP = 0.27;
  add(4.0, 'L', L0 + STEP, STANCE_Z, YL);
  add(4.5, 'R', R0 + STEP, STANCE_Z, YR);
  add(5.0, 'L', L0 + 2 * STEP, STANCE_Z, YL);
  add(5.5, 'R', R0 + 2 * STEP, STANCE_Z, YR);
  add(6.0, 'R', R0 + STEP, STANCE_Z, YR);
  add(6.5, 'L', L0 + STEP, STANCE_Z, YL);
  add(7.0, 'R', R0, STANCE_Z, YR);
  add(7.5, 'L', L0, STANCE_Z, YL);

  // Bar 3: the toe points. The foot lands INBOARD of the standing one and a
  // little behind it, up on its point at 43 degrees, with the sole turned in.
  // That inboard target is what draws the knee across the body: the IK has
  // nowhere else to put it, so the knee turns in as a consequence of where the
  // toe is rather than as a twist bolted onto the thigh.
  const POINT_PITCH = 0.75;
  add(8.0, 'R', R0 + 0.16, -0.16, 40 * D, POINT_PITCH, 0.14, 0.30);
  add(10.0, 'R', R0, STANCE_Z, YR, 0, 1, 0.28);
  add(10.0, 'L', L0 - 0.16, -0.16, -40 * D, POINT_PITCH, 0.14, 0.30);
  add(11.6, 'L', L0, STANCE_Z, YL, 0, 1, 0.28);

  // Bar 4: the turn, four pivot steps. Out on 14 with the right foot leading,
  // because the turn goes that way, and back on 15 with the left.
  const TURN = -62;
  const oL = pivot(L0, STANCE_Z, TURN);
  const oR = pivot(R0, STANCE_Z, TURN);
  add(14.0, 'R', oR.x, oR.z, TURN * D + YR, 0, 1, 0.30);
  add(14.3, 'L', oL.x, oL.z, TURN * D + YL, 0, 1, 0.30);
  add(15.0, 'L', L0, STANCE_Z, YL, 0, 1, 0.30);
  add(15.3, 'R', R0, STANCE_Z, YR, 0, 1, 0.30);

  S.sort((a, b) => a.beat - b.beat);
  return S;
}

// --- one dancer --------------------------------------------------------------

export function createDance({
  rig,
  seed = 1,
  // Beats this dancer is behind the troupe. A FRACTION of a beat: three figures
  // doing the same thing at the same instant read as one figure drawn three
  // times, and a whole beat apart reads as three people who cannot count.
  offset = 0,
  // How big this one goes. 1.0 is the authored routine.
  amp = 1,
  // Extra beats of delay on the WAVE only. This is the deliberate one: the roll
  // travels down the line because each dancer starts it later.
  waveLag = 0,
  tempo = BPM,
  // Where the dancer stands, in its parent's frame, and which way it starts.
  slot = { x: 0, z: 0 },
  // Called once, at construction, to decide whether the entry blends from the
  // rig's current pose or snaps to the routine. Blending is the default and is
  // what the game wants: the figure was walking a second ago.
  blend = true,
  // The pose the figure arrives in: its hip height and its heading relative to
  // the troupe. The troupe measures both off the rig before it borrows it.
  entry = { hip: HIP_BASE, yaw: 0 },
} = {}) {
  const J = rig.joints;
  const group = rig.group;
  const scale = group.scale.x || 1;
  const rand = mulberry32(seed);
  const beatLen = 60 / tempo;

  // The rig has to sit under the troupe's frame for the foot plants to be
  // meaningful, and the caller does that. Everything below works in the parent
  // group's coordinates, which are the troupe's: the troupe never moves during
  // a dance, so they are as good as world and cost no matrix round trips.
  //
  // WHERE the figure stands is a cut: it is put in its slot on the frame the
  // dance starts, because a troupe that walked into formation would be twenty
  // seconds of skeletons filing into line before anything happened. HOW it
  // stands is not a cut. The height and the heading it arrived with are kept
  // and then danced out of, so the first thing on screen is the figure the
  // player was just being chased by, standing where it was left, and the
  // second thing is that figure turning to the front and loading the claw.
  group.position.set(slot.x, entry.hip - M.y.hip * scale, slot.z);
  group.rotation.set(0, entry.yaw, 0);

  // --- springs ---------------------------------------------------------------
  // Same idea as perform.js and tuned the same way: by what the joint has to
  // carry. They are stiffer here across the board, because this routine asks
  // for accents on a 2 Hz grid and perform.js's springs are tuned for a walk.
  // Damping is quoted against critical (2*sqrt(k)).
  const S = {
    root: new Spring({ stiffness: 95, damping: 17.0 }),        // 0.87
    lumbar: new Spring({ stiffness: 140, damping: 19.5 }),     // 0.82
    thorax: new Spring({ stiffness: 175, damping: 21.0 }),     // 0.79
    neck: new Spring({ stiffness: 250, damping: 25.0 }),       // 0.79
    head: new Spring({ stiffness: 320, damping: 24.0 }),       // 0.67, the whip
    headYaw: new Spring({ stiffness: 230, damping: 20.0 }),    // 0.66, snaps and rings
    twist: new Spring({ stiffness: 165, damping: 20.0 }),
    pelvisYaw: new Spring({ stiffness: 140, damping: 18.5 }),
    shoulderL: new Spring({ stiffness: 200, damping: 22.0 }),  // 0.78
    shoulderR: new Spring({ stiffness: 200, damping: 22.0 }),
    elbowL: new Spring({ stiffness: 265, damping: 24.0 }),     // 0.74
    elbowR: new Spring({ stiffness: 265, damping: 24.0 }),
    wristL: new Spring({ stiffness: 350, damping: 24.0 }),     // 0.64, floppy claw
    wristR: new Spring({ stiffness: 350, damping: 24.0 }),
    spreadL: new Spring({ stiffness: 175, damping: 20.0 }),
    spreadR: new Spring({ stiffness: 175, damping: 20.0 }),
    roll: new Spring({ stiffness: 115, damping: 16.5 }),
    // The pelvis riding over the feet. Under critical on purpose: the hips
    // arrive after the foot does and keep going a little, which is the weight.
    swayX: new Spring({ stiffness: 130, damping: 12.5 }),      // 0.55
    swayZ: new Spring({ stiffness: 130, damping: 12.5 }),
    bodyYaw: new Spring({ stiffness: 150, damping: 19.0 }),
    // Hip height, slow. The beat bounce does NOT go through here.
    lift: new Spring({ stiffness: 150, damping: 20.0 }),       // 0.82
    jaw: new Spring({ stiffness: 190, damping: 12.0 }),        // 0.44, rattles
    weightL: new Spring({ stiffness: 120, damping: 20.0 }),
    weightR: new Spring({ stiffness: 120, damping: 20.0 }),
  };

  const T = {
    root: 0, lumbar: 0, thorax: 0, neck: 0, head: 0, headYaw: 0,
    twist: 0, pelvisYaw: 0, roll: 0, bodyYaw: 0,
    shoulderL: 0, shoulderR: 0, elbowL: 0, elbowR: 0, wristL: 0, wristR: 0,
    spreadL: 0, spreadR: 0,
    lift: HIP_BASE,
  };
  // Every spring T has a target for, stepped once a frame in applyPose.
  //
  // The four springs that are NOT here are deliberate and the omission is load
  // bearing. `lift` is stepped separately because the bounce is added to its
  // answer rather than to its target. `swayX`, `swayZ`, `weightL` and
  // `weightR` are driven by where the FEET are, not by the phrase, and their
  // targets are written by stepFeet and by applyPose's own weighted mean. They
  // were in T once: the loop then overwrote both weight targets with a
  // constant 1 on the same frame stepFeet had set them, which silently deleted
  // the entire weight shift, and it stepped the sway springs twice a frame,
  // which quietly doubled their stiffness.
  const POSE_KEYS = Object.keys(T).filter((k) => k !== 'lift');

  // --- leg geometry ----------------------------------------------------------
  // chainSpec and solveChain are copied verbatim from perform.js, where they
  // are private. The derivation lives there and is not repeated: the short
  // version is that rotation.x preserves local x, so each leg is a two link
  // chain in its own YZ plane with a fixed lateral offset cx that rotation.z
  // spends, and reading the link lengths off the rig rather than off metrics.js
  // means a change to the model cannot silently put the feet through the floor.
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
      bend: Math.abs(rest) > 0.01 ? Math.sign(rest) : fallbackBend,
      span: Math.hypot(kp.y, kp.z) + Math.hypot(ap.y, ap.z),
    };
  }

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
    const amp2 = Math.hypot(L.cx, rc);
    if (amp2 > Math.abs(dx)) {
      const psi = Math.atan2(-rc, L.cx);
      const off = Math.acos(clamp(dx / amp2, -1, 1));
      const a = wrap(psi + off);
      const b = wrap(psi - off);
      phi = Math.abs(a) < Math.abs(b) ? a : b;
    }
    const qy = L.cx * Math.sin(phi) + rc * Math.cos(phi);
    ikOut.hipZ = phi;
    ikOut.hipX = wrap(Math.atan2(dz, dy) - Math.atan2(rs, qy));
    return ikOut;
  }

  const LEG = {
    L: chainSpec(J.hipL, J.kneeL, J.ankleL, 1),
    R: chainSpec(J.hipR, J.kneeR, J.ankleR, 1),
  };
  // The x a foot sits at when the leg hangs straight down, taken off the rig,
  // so the rest stance is exactly as wide as the model was built.
  const FOOT_X = { L: LEG.L.root.x + LEG.L.cx, R: LEG.R.root.x + LEG.R.cx };
  const STANCE = {
    L: { x: FOOT_X.L + STANCE_OUT, z: STANCE_Z, yaw: STANCE_TURN },
    R: { x: FOOT_X.R - STANCE_OUT, z: STANCE_Z, yaw: -STANCE_TURN },
  };
  const STEPS = buildSteps(STANCE);

  // --- feet ------------------------------------------------------------------
  // A foot is planted at a point in the PARENT's frame or swinging to the next
  // one. `plant` is the floor point under the ankle when the foot is flat, and
  // pitching the foot rotates about the toe tip: see ankleOnPlant, which is the
  // same construction perform.js uses for its heel-off, so the contact does not
  // move when the heel comes up.
  const foot = (side) => ({
    plant: new THREE.Vector3(slot.x + STANCE[side].x * scale, 0, slot.z + STANCE_Z * scale),
    yaw: STANCE[side].yaw,
    pitch: 0,
    weight: 1,
    from: new THREE.Vector3(),
    fromYaw: 0,
    fromPitch: 0,
    to: new THREE.Vector3(),
    toYaw: 0,
    toPitch: 0,
    swing: 1,
    dur: 0.3,
    // Where the toe was when this plant was taken, so slip is measured against
    // the plant it was promised rather than against the previous frame.
    toe0: new THREE.Vector3(),
    slip: 0,
  });
  const feet = { L: foot('L'), R: foot('R') };
  // Where the pelvis sits when the weight is even, in the troupe's frame.
  const restMid = {
    x: slot.x + (STANCE.L.x + STANCE.R.x) * 0.5 * scale,
    z: slot.z + STANCE_Z * scale,
  };

  // --- state -----------------------------------------------------------------
  let clock = 0;          // seconds since the dance began
  let beat = 0;           // this dancer's own beat, including its offset
  let jawBeat = 0;
  let push = 0;          // the authored lateral hip shift, metres
  let wobble = 0;
  const wobblePhase = rand() * TAU;
  let maxShort = 0;
  const ikShort = { L: 0, R: 0 };
  let maxSlip = 0;
  let maxSlipLoop = 0;
  let duck = 0;

  // Jaw drive, lifted from perform.js: the mandible is a pendulum on a hinge at
  // the back of the skull and the chin hangs below and in front of it, so an
  // upward acceleration of the skull leaves the chin behind and opens the jaw.
  // The lever arms are measured off the rig rather than written down, because
  // they are the whole of the sensitivity.
  const headPos = new THREE.Vector3();
  const headPrev = new THREE.Vector3();
  const headVel = new THREE.Vector3();
  const headAcc = new THREE.Vector3();
  const localAcc = new THREE.Vector3();
  const headQuat = new THREE.Quaternion();
  let headPrimed = false;
  let chatterTimer = 0;

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
  const JAW_OPEN_MAX = 0.52;
  const JAW_BOUNCE = 0.28;

  // Scratch.
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const qWant = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const qParent = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const _av = new THREE.Vector3();
  function approachVec(from, to, rate, dt) {
    const k = Math.exp(-rate * dt);
    return _av.set(
      to.x + (from.x - to.x) * k,
      to.y + (from.y - to.y) * k,
      to.z + (from.z - to.z) * k,
    );
  }

  // Where the ankle pivot sits for a foot planted at `f` and rolled up onto its
  // toe by `pitch`. The CONTACT does not move: the ankle swings up and forward
  // about the toe tip. Copied from perform.js's ankleOnPlant, which is the one
  // function its stance and its lift-off share so the two cannot disagree.
  function ankleOnPlant(plant, yaw, pitch, out) {
    const ch = Math.cos(pitch);
    const sh = Math.sin(pitch);
    const ahead = (TOE_AHEAD * (1 - ch) + M.y.ankle * sh) * scale;
    out.copy(plant);
    out.x += Math.sin(yaw) * ahead;
    out.z += Math.cos(yaw) * ahead;
    out.y += (M.y.ankle * ch + TOE_AHEAD * sh) * scale;
    return out;
  }

  // The toe tip for a plant, which is the point that must not move.
  function toeOnPlant(plant, yaw, out) {
    out.copy(plant);
    out.x += Math.sin(yaw) * TOE_AHEAD * scale;
    out.z += Math.cos(yaw) * TOE_AHEAD * scale;
    return out;
  }

  // --- the pose --------------------------------------------------------------

  // The bounce, added AFTER the springs. Lowest exactly on the beat, highest
  // between: the drop is the accent and the rise is the recovery. The bar
  // accent is a second, slower cosine at a quarter the rate, in phase with it,
  // so beat 0 of a bar is the deepest of the four.
  function bounce(b) {
    const onBeat = 0.5 + 0.5 * Math.cos(TAU * b);
    const onBar = 0.5 + 0.5 * Math.cos(TAU * b * 0.25);
    return -(BOUNCE * onBeat + BAR_ACCENT * onBar) * amp;
  }

  // The wave's contribution for one segment, in whatever units that segment is
  // authored in. A single half-sine bump travelling up the body: each segment
  // is the one below it, delayed.
  function waveAt(b, seg) {
    const start = WAVE_AT + waveLag + seg.delay * WAVE_LEN;
    // The phrase wraps, so a wave that a lag has pushed past 16 has to be
    // looked for at the bottom of the loop as well.
    for (const s of [start, start - PHRASE_BEATS]) {
      const u = (b - s) / WAVE_SEG;
      if (u > 0 && u < 1) return seg.amp * Math.sin(Math.PI * u) * amp;
    }
    return 0;
  }

  function wave(b, key) {
    for (const seg of WAVE) if (seg.key === key) return waveAt(b, seg);
    return 0;
  }

  // Everything the phrase says, at beat b. Degrees in, radians out.
  function posePhrase(b, dt) {
    const wPelvis = wave(b, 'pelvis');
    const wLumbar = wave(b, 'lumbar');
    const wThorax = wave(b, 'thorax');
    const wGaze = wave(b, 'gaze');
    const wArm = wave(b, 'arm');
    const wElbow = wave(b, 'elbow');
    const wWrist = wave(b, 'wrist');
    const wSpread = wave(b, 'spread');

    // The trunk. Every angle is scaled by this dancer's amplitude about its own
    // resting value, so a timid dancer is smaller everywhere rather than
    // leaning permanently backwards.
    const pitch = (track(TORSO, b) * amp + wPelvis) * D;
    T.root = pitch;
    T.lumbar = pitch + (wLumbar) * D;
    T.thorax = T.lumbar + (wThorax) * D;
    const gaze = (track(GAZE, b) * amp + wGaze) * D;
    T.neck = mix(T.thorax, gaze, 0.45);
    T.head = gaze;
    T.headYaw = track(HEAD_YAW, b) * amp * D;
    T.twist = track(TWIST, b) * amp * D;
    T.pelvisYaw = track(PELVIS_YAW, b) * amp * D;
    T.roll = track(ROLL, b) * amp * D;
    push = track(HIP_PUSH, b) * amp;
    T.bodyYaw = track(BODY_YAW, b) * D;
    // The skull holds the front while the shoulders go. Subtracting the body's
    // own yaw is exactly a head that has not moved in world terms, and the
    // hold track then lets it go.
    T.headYaw -= T.bodyYaw * track(HEAD_HOLD, b);

    for (const side of ['L', 'R']) {
      const sh = (track(ARM[side], b) * amp + wArm) * D;
      const el = track(ELBOW[side], b) * amp + wElbow;
      const wr = track(WRIST[side], b) * amp + wWrist;
      T[`shoulder${side}`] = sh;
      T[`elbow${side}`] = sh - el * D;
      T[`wrist${side}`] = sh - el * D + wr * D;
      T[`spread${side}`] = (track(SPREAD[side], b) * amp + wSpread) * D;
    }

    T.lift = track(HIP, b) + (wPelvis * 0.0006);
    jawBeat = track(JAW, b) * amp;

    // Dancing badly and in earnest, which is the joke: a perfect performance
    // is not funny. A slow wander in the trunk at two frequencies that share no
    // factor with the beat, so it never lines up with anything and never reads
    // as part of the routine. What it reads as is a figure catching its own
    // balance, and it is strongest just after a beat, which is when a dancer
    // that stopped hard is most likely to need to.
    wobble = Math.sin(clock * 1.37 + wobblePhase) * 0.62
      + Math.sin(clock * 0.83 + wobblePhase * 2.1) * 0.38;
    const off = Math.abs(((b % 1) + 1.5) % 1 - 0.5) * 2;
    T.roll += wobble * 0.042 * (1 - 0.45 * off) * amp;
    T.root += wobble * 0.026 * amp;
  }

  // --- footwork --------------------------------------------------------------

  // A step is triggered when the dancer's beat crosses the step's beat. The
  // crossing test has to survive the phrase wrapping from 16 back to 0, so it
  // works on the fractional beat and the number of whole phrases elapsed.
  let lastBeat = -1;
  function fireSteps(b) {
    if (lastBeat < 0) { lastBeat = b; return; }
    const wrapped = b < lastBeat;
    for (const s of STEPS) {
      const crossed = wrapped
        ? (s.beat > lastBeat || s.beat <= b)
        : (s.beat > lastBeat && s.beat <= b);
      if (crossed) queueStep(s);
    }
    lastBeat = b;
  }

  function queueStep(s) {
    const f = feet[s.side];
    // THE SWING STARTS WHERE THE STANCE ENDED, in the pose the foot was
    // actually in. perform.js learned this the hard way: starting a swing from
    // the flat plant instead makes the ankle jump the height the toe-off had
    // carried it to, every step, which is what reads as jumpy legs.
    f.from.copy(f.plant);
    f.fromYaw = f.yaw;
    f.fromPitch = f.pitch;
    // Steps are authored in the dancer's OWN rest frame and the plants live in
    // the troupe's, so the slot has to go on here. Leaving it off put every
    // dancer's feet under the middle of the line while its body stood in its
    // own slot, which the IK reported as a metre and a half out of reach and
    // which no amount of staring at a still frame would have found.
    f.to.set(slot.x + s.x * scale, 0, slot.z + s.z * scale);
    f.toYaw = s.yaw;
    f.toPitch = s.pitch;
    f.swing = 0;
    f.dur = s.dur * beatLen;
    f.weight = s.weight;
  }

  function stepFeet(dt) {
    for (const side of ['L', 'R']) {
      const f = feet[side];
      if (f.swing >= 1) continue;
      f.swing = Math.min(1, f.swing + dt / f.dur);
      if (f.swing >= 1) {
        f.plant.copy(f.to);
        f.yaw = f.toYaw;
        f.pitch = f.toPitch;
        toeOnPlant(f.plant, f.yaw, f.toe0);
      }
    }
    // Weight follows the feet: a foot in the air carries almost nothing, and
    // that alone is what shifts the pelvis onto the standing leg.
    for (const side of ['L', 'R']) {
      const f = feet[side];
      S[`weight${side}`].target = f.swing < 1 ? 0.10 : f.weight;
    }
  }

  // Where the ankle should be, for a foot that is planted or in the air.
  const FOOT_LIFT = 0.11;
  function ankleTarget(f, out) {
    if (f.swing >= 1) {
      ankleOnPlant(f.plant, f.yaw, f.pitch, out);
      return f.pitch;
    }
    const u = f.swing;
    // Both ends exact: the arc starts at the pose the stance ended in and lands
    // exactly on the new plant's pose, so neither handover has a step in it.
    ankleOnPlant(f.from, f.fromYaw, f.fromPitch, v2);
    ankleOnPlant(f.to, f.toYaw, f.toPitch, v3);
    out.lerpVectors(v2, v3, easeInOutCubic(u));
    const carried = Math.max(0, v2.y - v3.y);
    const arc = Math.max(0, FOOT_LIFT * scale - 0.5 * carried);
    out.y += Math.sin(u * Math.PI) * arc;
    const raw = mix(f.fromPitch, f.toPitch, easeInOutCubic(u)) + 0.55 * Math.sin(u * Math.PI);
    // Clearance clamp, exact rather than approximate: setting each corner's
    // height equal to the pivot's and solving gives the pitch that puts it on
    // the floor. perform.js found the asin approximation was three degrees out
    // at the pose a stance actually ends in, which is enough for the clamp to
    // bind on the swing's first frame and put back the snap it prevents.
    const h = out.y / scale;
    return clamp(
      raw,
      Math.acos(clamp(h / HEEL_R, -1, 1)) - HEEL_PHI,
      Math.asin(clamp(h / TOE_R, -1, 1)) - TOE_PHI,
    );
  }

  // --- applying --------------------------------------------------------------

  const footPitch = { L: 0, R: 0 };

  function applyPose(dt) {
    for (const key of POSE_KEYS) {
      S[key].target = T[key];
      S[key].step(dt);
    }
    S.lift.target = T.lift;
    S.lift.step(dt);

    // The pelvis rides over the feet. A weighted mean of the two plants rather
    // than their midpoint, so a foot with no weight on it does not drag the
    // hips out over nothing: the toe point shifts the body onto the standing
    // leg because the pointing foot is carrying 0.14 of the figure.
    const wl = Math.max(0.02, S.weightL.value);
    const wr = Math.max(0.02, S.weightR.value);
    const px = (feet.L.plant.x * wl + feet.R.plant.x * wr) / (wl + wr);
    const pz = (feet.L.plant.z * wl + feet.R.plant.z * wr) / (wl + wr);
    // Measured against the REST stance in this dancer's own slot, not against
    // the troupe's origin. The factor is 1.0 and it was 0.8 for a while: a
    // pelvis that only follows four fifths of a shuffle is 120mm short of its
    // own feet at the far end of one, and the trailing leg then runs out of
    // reach, which is 30mm of measured foot slip and a visible skate. The lean
    // a dancer really does have belongs to the roll, which is a separate
    // authored channel, not to the hips refusing to arrive.
    S.swayX.target = px - restMid.x + push;
    S.swayZ.target = pz - restMid.z;
    S.swayX.step(dt);
    S.swayZ.step(dt);

    const b = beat;
    // A LEG CANNOT GET LONGER THAN A LEG. The routine is authored to stay
    // inside the figure's reach and measures at under a millimetre of miss, but
    // a routine is edited and a guard is not. `duck` is however far the IK
    // reported it could not reach on the previous frame, taken straight back
    // out of the hip height: the hips drop until the planted feet can be
    // reached, which is what a body actually does, and it releases slowly so a
    // single hard frame does not show as a twitch.
    //
    // perform.js solves the same problem analytically, ahead of the solve. This
    // is one frame late by construction, and one frame of a millimetre is worth
    // far less than a second copy of that derivation drifting out of step.
    const need = Math.max(ikShort.L, ikShort.R) * 1.02;
    duck = need > duck ? need : approach(duck, need, 7, dt);
    const hipY = S.lift.value + bounce(b) - duck;

    group.position.set(
      slot.x + S.swayX.value,
      hipY - M.y.hip * scale,
      slot.z + S.swayZ.value,
    );
    group.rotation.y = S.bodyYaw.value;

    const root = S.root.value;
    const lumbar = S.lumbar.value;
    const thorax = S.thorax.value;
    const neck = S.neck.value;
    const head = S.head.value;

    J.root.rotation.set(root, S.pelvisYaw.value, S.roll.value);
    // The chest twist is split across the two spine joints, most of it high up,
    // because a lumbar spine barely rotates and a thoracic one does.
    J.spineLower.rotation.set(lumbar - root, S.twist.value * 0.3, 0);
    J.spineUpper.rotation.set(thorax - lumbar, S.twist.value * 0.7, 0);
    J.neck.rotation.set(neck - thorax, S.headYaw.value * 0.35, 0);
    J.head.rotation.set(head - neck, S.headYaw.value * 0.65, 0);

    for (const side of ['L', 'R']) {
      const sgn = side === 'L' ? 1 : -1;
      const sh = S[`shoulder${side}`].value;
      const el = S[`elbow${side}`].value;
      const wr2 = S[`wrist${side}`].value;
      J[`shoulder${side}`].rotation.set(sh - thorax, 0, sgn * S[`spread${side}`].value);
      J[`elbow${side}`].rotation.x = el - sh;
      J[`wrist${side}`].rotation.x = wr2 - el;
    }
    return hipY;
  }

  // The legs, after the root is posed, because the IK is solved in the root's
  // frame and the root has just moved.
  //
  // There is no authored-angle path here and no blend between one and the
  // other, which is the one place this file is simpler than perform.js. That
  // file needs both because its figure spends half its performance with its
  // legs hanging down a hole; this one never takes a foot off a plant, and
  // adopt() starts every plant exactly under the foot that is already there,
  // so the solve is right from the first frame and there is nothing to ease.
  function applyLegs() {
    group.updateWorldMatrix(true, false);
    J.root.updateWorldMatrix(false, false);

    for (const side of ['L', 'R']) {
      const f = feet[side];
      const pitchNow = ankleTarget(f, v1);
      footPitch[side] = pitchNow;
      // The plants live in the TROUPE's frame, which is the rig group's
      // parent, and the solve wants the target in the root's. Going out
      // through the rig group instead of through its parent is a whole
      // dancer's worth of error and it puts the feet where the troupe's
      // centre is.
      if (group.parent) group.parent.localToWorld(v1);
      J.root.worldToLocal(v1);
      const ik = solveChain(LEG[side], v1);
      ikShort[side] = ik.short;
      if (ik.short > maxShort) maxShort = ik.short;
      const kneeWorld = S.root.value + ik.hipX + ik.knee;
      const hipX = ik.hipX;
      const hipZ = ik.hipZ;
      const knee = ik.knee;

      J[`hip${side}`].rotation.set(hipX, 0, hipZ);
      J[`knee${side}`].rotation.x = knee;
      J[`ankle${side}`].rotation.x = pitchNow - kneeWorld;

      // The foot's orientation is set in the PARENT's terms and pulled back
      // into the ankle's own frame, rather than written as three local Euler
      // angles. Same reasoning as perform.js, and both halves of it bite here:
      // everything below the hip inherits the body's yaw, so a planted foot
      // would spin on the spot through the turn in bar 4, and the pelvis roll
      // plus the hip's sideways swing would tip the sole onto its outside edge
      // through the whole of bar 3 and put the far edge through the floor.
      const footYaw = f.swing >= 1
        ? f.yaw
        : f.fromYaw + wrap(f.toYaw - f.fromYaw) * easeInOutCubic(f.swing);
      qWant.setFromAxisAngle(X_AXIS, pitchNow);
      qTmp.setFromAxisAngle(Y_AXIS, footYaw);
      qWant.premultiply(qTmp);

      qParent.setFromAxisAngle(Y_AXIS, S.bodyYaw.value);
      qParent.multiply(qTmp.setFromEuler(
        eul.set(S.root.value, S.pelvisYaw.value, S.roll.value, 'XYZ'),
      ));
      qParent.multiply(qTmp.setFromEuler(eul.set(hipX, 0, hipZ, 'XYZ')));
      qParent.multiply(qTmp.setFromAxisAngle(X_AXIS, knee));

      J[`ankle${side}`].quaternion.copy(qWant.premultiply(qParent.invert()));
    }
  }

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

    chatterTimer -= dt;
    if (chatterTimer <= 0) {
      chatterTimer = 0.05 + rand() * 0.06;
      S.jaw.velocity += (rand() - 0.5) * 2 * (0.5 + rand() * 0.6) * 1.6;
    }

    S.jaw.target = clamp(jawBeat + clamp(torque, -0.18, 0.45), -0.02, JAW_OPEN_MAX);
    S.jaw.step(dt);
    if (S.jaw.value < 0) {
      S.jaw.value = 0;
      if (S.jaw.velocity < 0) S.jaw.velocity *= -JAW_BOUNCE;
    } else if (S.jaw.value > JAW_OPEN_MAX) {
      S.jaw.value = JAW_OPEN_MAX;
      if (S.jaw.velocity > 0) S.jaw.velocity *= -JAW_BOUNCE * 0.5;
    }
    J.jaw.rotation.x = S.jaw.value * (J.jaw.userData.openSign || 1);
  }

  // --- slip ------------------------------------------------------------------
  // The honest measure. A planted foot's TOE is supposed to be exactly where
  // the plant put it, and this reads the toe off the rig's own matrices rather
  // than off the intent, so an IK that could not reach shows up here.
  function measureSlip() {
    for (const side of ['L', 'R']) {
      const f = feet[side];
      if (f.swing < 1) continue;
      v1.set(0, -M.y.ankle, TOE_AHEAD);
      J[`ankle${side}`].localToWorld(v1);
      if (group.parent) group.parent.worldToLocal(v1);
      const d = Math.hypot(v1.x - f.toe0.x, v1.z - f.toe0.z, v1.y - f.toe0.y);
      f.slip = d;
      if (d > maxSlip) maxSlip = d;
      // The entry blend is not a promise: over those four beats the feet are
      // being deliberately walked back under the hips and the legs are handing
      // over from authored angles to IK. The routine's own slip is the number
      // that says whether the dance skates, so it is kept apart.
      if (introDone && d > maxSlipLoop) maxSlipLoop = d;
    }
  }

  // --- the intro -------------------------------------------------------------
  // Beats -INTRO_BEATS..0, played once. The figure arrives from wherever the
  // game left it: the feet come back under the hips, the head comes round to
  // the front, and the arms load for the claw that lands on beat 0.
  //
  // Nothing here is a separate pose system. It writes the same T as the phrase
  // does, and the springs are already sitting at whatever the rig was doing, so
  // the blend IS the springs catching up. There is no cross-fade.
  let introDone = false;
  function poseIntro(u, dt) {
    const g = easeOutBack(clamp01(u * 1.25));
    T.root = mix(4, 12, g) * D;
    T.lumbar = T.root;
    T.thorax = T.lumbar + 2 * D;
    const gaze = mix(6, -14, g) * D;
    T.neck = mix(T.thorax, gaze, 0.45);
    T.head = gaze;
    T.headYaw = mix(T.headYaw, 0, 1 - Math.exp(-6 * dt));
    push = 0;
    T.twist = 0;
    T.pelvisYaw = 0;
    T.roll = 0;
    // Facing the front is where the routine starts, and the figure gets there
    // by turning over the intro rather than by being spun on frame one. The
    // two shuffle steps below re-plant the feet square while it turns, so the
    // soles are not dragged round with the hips.
    T.bodyYaw = 0;
    // The arms come up the last half of the intro, so the claw is loaded rather
    // than assembled.
    const load = smoothstep(0.45, 1, u);
    const arm = mix(-16, CLAW, load) * D;
    const flex = mix(20, 78, load);
    for (const side of ['L', 'R']) {
      T[`shoulder${side}`] = arm;
      T[`elbow${side}`] = arm - flex * D;
      T[`wrist${side}`] = arm - flex * D + mix(8, 52, load) * D;
      T[`spread${side}`] = mix(10, 34, load) * D;
    }
    T.lift = mix(HIP_BASE + 0.03, HIP_BASE - 0.012, g);
    jawBeat = mix(0.04, 0.30, smoothstep(0.8, 1, u));
  }

  // Both feet come back under the hips over the first two beats of the intro,
  // one at a time, so the figure is not caught mid-stride when the routine
  // starts. Fired from the intro's own clock rather than from STEPS.
  let introSteps = 0;

  function update(dt) {
    dt = clamp(dt || 0, 0, 1 / 20);
    if (!(dt > 0)) return;
    clock += dt;

    driveJaw(dt);

    const beats = clock / beatLen;
    if (beats < INTRO_BEATS) {
      const u = beats / INTRO_BEATS;
      poseIntro(u, dt);
      // Feet under the hips, on beats 0.6 and 1.3 of the intro.
      if (introSteps === 0 && beats > 0.6) {
        introSteps = 1;
        queueStep({ side: 'R', ...STANCE.R, pitch: 0, weight: 1, dur: 0.5 });
      }
      if (introSteps === 1 && beats > 1.3) {
        introSteps = 2;
        queueStep({ side: 'L', ...STANCE.L, pitch: 0, weight: 1, dur: 0.5 });
      }
      beat = 0;
    } else {
      if (!introDone) { introDone = true; lastBeat = -1; }
      // The dancer's own beat: the troupe's clock plus this dancer's offset,
      // folded into the phrase.
      beat = (((beats - INTRO_BEATS + offset) % PHRASE_BEATS) + PHRASE_BEATS) % PHRASE_BEATS;
      fireSteps(beat);
      posePhrase(beat, dt);
    }

    stepFeet(dt);
    applyPose(dt);
    applyLegs();
    measureSlip();
  }

  // --- entry -----------------------------------------------------------------
  // The springs start at the pose the rig is ALREADY in, so the dance blends in
  // from wherever the figure was rather than snapping to a bind pose. The rig's
  // local rotations are summed down each chain to recover the world pitch this
  // file authors in, which is exactly the inverse of what applyPose writes.
  function adopt() {
    const root = J.root.rotation.x;
    const lumbar = root + J.spineLower.rotation.x;
    const thorax = lumbar + J.spineUpper.rotation.x;
    const neck = thorax + J.neck.rotation.x;
    const head = neck + J.head.rotation.x;
    S.root.snap(root); S.lumbar.snap(lumbar); S.thorax.snap(thorax);
    S.neck.snap(neck); S.head.snap(head);
    S.roll.snap(J.root.rotation.z);
    S.pelvisYaw.snap(J.root.rotation.y);
    S.twist.snap(J.spineLower.rotation.y + J.spineUpper.rotation.y);
    S.headYaw.snap(J.neck.rotation.y + J.head.rotation.y);
    S.bodyYaw.snap(entry.yaw);
    for (const side of ['L', 'R']) {
      const sgn = side === 'L' ? 1 : -1;
      const sh = thorax + J[`shoulder${side}`].rotation.x;
      const el = sh + J[`elbow${side}`].rotation.x;
      const wr2 = el + J[`wrist${side}`].rotation.x;
      S[`shoulder${side}`].snap(sh);
      S[`elbow${side}`].snap(el);
      S[`wrist${side}`].snap(wr2);
      S[`spread${side}`].snap(sgn * J[`shoulder${side}`].rotation.z);
      S[`weight${side}`].snap(1);
    }
    S.lift.snap(entry.hip);
    S.swayX.snap(0);
    S.swayZ.snap(0);
    S.jaw.snap(J.jaw.rotation.x * (J.jaw.userData.openSign || 1));

    // The feet start where they ARE. Read off the rig rather than assumed, so
    // a figure handed over mid-stride does not jerk its feet into a stance on
    // frame one: the intro's two shuffle steps do that, on the beat.
    group.updateWorldMatrix(true, true);
    for (const side of ['L', 'R']) {
      const f = feet[side];
      J[`ankle${side}`].getWorldPosition(v1);
      group.parent?.worldToLocal(v1);
      f.plant.set(v1.x, 0, v1.z);
      f.yaw = entry.yaw;
      f.pitch = 0;
      f.swing = 1;
      f.weight = 1;
      toeOnPlant(f.plant, f.yaw, f.toe0);
    }
  }

  // A figure that arrives buried is still carrying perform.js's floor clipping
  // plane, and half a dancer is worse than no dancer. The plane is taken off
  // here rather than asking the caller to remember: this file cannot edit
  // perform.js, but it can undo the one thing perform.js leaves on the rig's
  // own material.
  //
  // PUT BACK on dispose, and that is not tidiness. perform.js only touches
  // those planes when its own idea of whether clipping is on CHANGES, so a
  // performance that was buried when the dance took its rig still believes the
  // plane is fitted: leaving it off would make its next reset() a no-op and the
  // skeleton would rise out of the next grave as a solid figure sliding up
  // through the floor.
  const clipped = [];
  group.traverse((o) => {
    const m = o.material;
    if (m?.clippingPlanes?.length && !clipped.some((c) => c.material === m)) {
      clipped.push({ material: m, planes: m.clippingPlanes, clipShadows: m.clipShadows });
      m.clippingPlanes = null;
      m.clipShadows = false;
      m.needsUpdate = true;
    }
  });
  function unclip() {
    for (const c of clipped) {
      c.material.clippingPlanes = c.planes;
      c.material.clipShadows = c.clipShadows;
      c.material.needsUpdate = true;
    }
    clipped.length = 0;
  }

  if (blend) adopt();
  else {
    for (const key of POSE_KEYS) S[key].snap(T[key]);
    S.lift.snap(HIP_BASE);
  }
  update(1 / 60);

  return {
    update,
    get beat() { return beat; },
    get clock() { return clock; },
    get progress() { return Math.max(0, (clock / beatLen - INTRO_BEATS) / PHRASE_BEATS); },
    metrics() {
      const out = {
        beat: +beat.toFixed(3),
        hipY: +(S.lift.value + bounce(beat)).toFixed(4),
        bodyYaw: +S.bodyYaw.value.toFixed(4),
        maxSlip: +maxSlip.toFixed(5),
        maxSlipLoop: +maxSlipLoop.toFixed(5),
        maxShort: +maxShort.toFixed(5),
        duck: +duck.toFixed(5),
        short: { L: +ikShort.L.toFixed(5), R: +ikShort.R.toFixed(5) },
        feet: {},
      };
      for (const side of ['L', 'R']) {
        const f = feet[side];
        v1.set(0, -M.y.ankle, TOE_AHEAD);
        J[`ankle${side}`].localToWorld(v1);
        group.parent?.worldToLocal(v1);
        out.feet[side] = {
          toe: [+v1.x.toFixed(5), +v1.y.toFixed(5), +v1.z.toFixed(5)],
          plant: [+f.plant.x.toFixed(5), +f.plant.z.toFixed(5)],
          swinging: f.swing < 1,
          slip: +f.slip.toFixed(5),
        };
      }
      return out;
    },
    dispose() { unclip(); },
  };
}

// --- the troupe --------------------------------------------------------------

// THE OFFSETS, which are the whole effect and are therefore chosen rather than
// randomised. Three dancers doing exactly the same thing at exactly the same
// instant read as one dancer rendered three times; a whole beat apart they read
// as three people who have not rehearsed. What reads as a troupe is a FRACTION
// of a beat of disagreement on everything, plus ONE move where they are
// deliberately a beat apart.
//
//   centre    dead on the beat, full size. The one the eye locks onto.
//   left      a third of a beat late and 10% smaller. The timid one.
//   right     a sixth of a beat EARLY and 12% bigger. The one that overcommits.
//
// The spread was 14% and 16% for a round and it was too much: amplitude scales
// every authored angle about zero, so at 0.86 the arm that is supposed to punch
// straight up only reaches 44 degrees off vertical, and a smaller dancer stops
// reading as a smaller dancer and starts reading as one doing a different move.
// Ten percent is as far as this goes before the unison breaks.
//
// Early matters as much as late: two dancers behind a leader reads as a leader
// and two followers, and one in front of the beat reads as somebody who cannot
// wait, which is funnier and is the note the whole piece is pitched at.
//
// waveLag is the deliberate one. Half a beat per dancer along the line, so the
// roll takes a whole beat to travel from one end of the troupe to the other and
// is unmistakably a wave rather than three people rolling their shoulders.
const CAST = [
  { offset: 0.30, amp: 0.90, seed: 11 },
  { offset: 0.00, amp: 1.00, seed: 23 },
  { offset: -0.16, amp: 1.12, seed: 37 },
];

export function createDanceTroupe({
  rigs,
  seed = 1,
  tempo = BPM,
  // Where the line stands and which way it faces. yaw = PI/4 turns each
  // dancer's own +Z toward this project's fixed isometric camera, so a head
  // yaw of zero is a head facing the viewer.
  at = { x: 0, z: 0 },
  yaw = Math.PI / 4,
  // Across the line, in world units, measured rather than guessed: at 1.15 the
  // troupe's true silhouette is 85% of a 900 by 900 frame at view 2.6, which
  // leaves a figure's shoulder of margin at each edge through the widest moment
  // of the shuffle. 1.45 was the first guess and it ran to 96%, which touches
  // both edges. Tighter is also better choreography: at 1.15 the claws of
  // neighbouring dancers nearly meet, which is what a line of dancers looks
  // like, and it buys the height back, since the frame can then be filled by
  // the figures rather than by the gaps between them.
  spacing = 1.15,
  // The outer two stand slightly back, which stops the line reading as a paper
  // cutout and gives the wave somewhere to travel.
  chevron = 0.18,
  scene = null,
  blend = true,
} = {}) {
  const list = Array.isArray(rigs) ? rigs.filter(Boolean) : [];
  const group = new THREE.Group();
  // `at` is the middle of the line, and no correction is applied for the bar 2
  // shuffle. One was, briefly, on the reasoning that a routine which spends a
  // bar half a metre to one side is not centred on its stance. Measured, that
  // is wrong: the widest pose in the phrase is the claw, which happens at the
  // stance, and the shuffle happens with the arms down and narrow, so the
  // union of the whole phrase is already centred on the stance to within half
  // a percent of the frame. The correction moved it five percent off.
  group.position.set(at.x, 0, at.z);
  group.rotation.y = yaw;

  // The rigs come from somewhere: the game builds them once for a whole run and
  // parents them to the scene. They are borrowed rather than taken, and
  // dispose() hands them back to the parent and the transform they had.
  const borrowed = list.map((rig) => ({
    rig,
    parent: rig.group.parent,
    position: rig.group.position.clone(),
    quaternion: rig.group.quaternion.clone(),
  }));

  const host = scene || borrowed[0]?.parent || null;
  if (host) host.add(group);

  const n = list.length;
  const dancers = list.map((rig, i) => {
    // Measured BEFORE the borrow, while the rig is still where its owner had
    // it: Object3D.add keeps the local transform and changes the world one, so
    // after this line rig.group.rotation.y means something different.
    const entry = {
      hip: rig.group.position.y + (rig.group.scale.x || 1) * M.y.hip,
      yaw: wrap(rig.group.rotation.y - yaw),
    };
    group.add(rig.group);
    // Slots run along the troupe's local X, which under this project's camera
    // is exactly screen-right: see the note on yaw above.
    const k = i - (n - 1) / 2;
    const cast = CAST[i % CAST.length];
    const edge = n > 1 ? Math.abs(k) / ((n - 1) / 2) : 0;
    return createDance({
      rig,
      seed: seed * 101 + cast.seed,
      offset: cast.offset,
      amp: cast.amp,
      // Along the line rather than by cast order, so the wave travels in space
      // and not in whatever order the caller handed the rigs over.
      waveLag: (k + (n - 1) / 2) * 0.5,
      tempo,
      slot: { x: k * spacing, z: -edge * chevron },
      blend,
      entry,
    });
  });

  let clock = 0;
  return {
    group,
    dancers,
    update(dt) {
      clock += dt;
      for (const d of dancers) d.update(dt);
    },
    get progress() { return dancers[0]?.progress ?? 0; },
    get clock() { return clock; },
    metrics() {
      return {
        clock: +clock.toFixed(3),
        progress: +(dancers[0]?.progress ?? 0).toFixed(3),
        maxSlip: Math.max(0, ...dancers.map((d) => d.metrics().maxSlip)),
        maxSlipLoop: Math.max(0, ...dancers.map((d) => d.metrics().maxSlipLoop)),
        maxShort: Math.max(0, ...dancers.map((d) => d.metrics().maxShort)),
        dancers: dancers.map((d) => d.metrics()),
      };
    },
    dispose() {
      for (const d of dancers) d.dispose();
      for (const b of borrowed) {
        if (b.parent) b.parent.add(b.rig.group);
        else group.remove(b.rig.group);
        b.rig.group.position.copy(b.position);
        b.rig.group.quaternion.copy(b.quaternion);
      }
      group.parent?.remove(group);
    },
  };
}

export default createDanceTroupe;
