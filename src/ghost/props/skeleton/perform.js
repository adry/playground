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

// --- the figure's own numbers ------------------------------------------------

// Hip pivot height when standing at ease, and when stalking. The leg is 1.150
// from hip pivot to ankle pivot and the two bones sum to 1.1504, so a figure
// standing at M.y.hip has its knees locked dead straight and cannot take a step
// at all. Everything about the walk falls out of that: the hips have to come
// down before there is any stride to have.
const HIP_TALL = M.y.hip - 0.02;      // 1.205, at ease, knees bent about 22 deg
const HIP_STALK = 1.195;              // walking. The bob takes it down from here
const HIP_CROUCH = 0.20;              // the pose it climbs out of the hole in

// Walk. HALF_STEP is how far in front of its own hip a foot plants, so a foot
// travels 2 * HALF_STEP backward through its stance. How far the BODY moves in
// that time is a different number, and confusing the two is the classic way to
// build a walk that skates: with a duty factor of 0.62 each foot is down for
// 1.24 step periods, so the body advances only HALF_STEP / DUTY per step. Get
// this wrong and the feet slide even though the phase is distance driven.
const HALF_STEP = 0.34;
const DUTY = 0.62;                    // fraction of its cycle a foot is planted
const STEP_LENGTH = HALF_STEP / DUTY; // body travel per step, 0.548
const TOP_SPEED = 1.25;               // the ghost does 4.5. Being chased is a mood.
const STOP_RANGE = 1.25;              // stops an arm's length short
const WAKE_RANGE = 7.0;               // the ghost comes this close and it wakes
const GIVE_UP_RANGE = 13.0;           // and this far away before it gives up

const FOOT_LIFT = 0.13;               // peak of the swing arc
// How far the toe reaches in front of the ankle pivot. legs.js sets the pivot a
// quarter of the way back along a foot M.leg.foot long, so this is the rest of
// it, and it is what decides how far the foot can toe off before the toe is
// through the floor.
const TOE_AHEAD = M.leg.foot * 0.72;
const BOB = 0.045;                    // pelvis rise and fall, twice a cycle
const SWAY = 0.035;                   // pelvis shift toward the stance foot

const MAX_YAW_RATE = 1.9;             // rad/s. Rate limited so it leans into a turn.

// Jaw. The mandible is a light bone on a loose hinge, so its spring is well
// under critical and it rings. The stops are hard, with a little restitution,
// which is where the clack comes from.
const JAW_OPEN_MAX = 0.52;
const JAW_BOUNCE = 0.28;

// Nothing is shed after these two. A figure that drops a bone every time it
// climbs out disassembles itself over a few minutes of play.
const SHED_PLAN = [
  { at: 1.15, bone: 'fingerR3', velocity: [0.55, 1.35, 0.45], spin: [5, 2, 7] },
  { at: 3.25, bone: 'ribR7', velocity: [-0.95, 1.15, 0.25], spin: [3.5, 1.5, 5.5] },
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

const CRAWL = {
  // Hip pivot height. Starts a whole body length under the floor.
  hipY: [[0, -1.05], [0.55, -1.00], [1.1, -0.88], [1.9, -0.58], [2.7, -0.34],
    [3.5, -0.12], [4.3, 0.05], [5.2, HIP_CROUCH]],
  // Torso pitch. 100 is face down and a little past horizontal, 40 is the
  // crouch it stands up out of.
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
  armR: [[0, 20], [0.32, -152, easeOutBack], [0.62, -168], [1.0, -150],
    [1.5, -112], [2.2, -74], [3.0, -48], [4.0, -42], [5.2, -52]],
  elbowR: [[0, 84], [0.32, 22], [0.62, 10], [1.2, 44], [2.0, 58], [3.0, 34], [4.0, 18], [5.2, 34]],
  wristR: [[0, 12], [0.5, -4], [0.85, 46], [1.4, 34], [2.5, 14], [5.2, 8]],
  // Left arm, the same beats about two thirds of a second behind and shallower.
  armL: [[0, 24], [0.9, 24], [1.15, -146, easeOutBack], [1.5, -160], [2.0, -140],
    [2.6, -96], [3.2, -58], [4.0, -44], [5.2, -54]],
  elbowL: [[0, 88], [1.15, 26], [1.5, 12], [2.0, 46], [2.8, 56], [3.6, 30], [4.2, 20], [5.2, 36]],
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
const CROUCH_Z = { L: 0.02, R: 0.30 };

export function createSkeletonPerformance({
  rig,
  scene,
  debris = null,
  renderer = null,
  seed = 7,
  wakeRange = WAKE_RANGE,
} = {}) {
  const J = rig.joints;
  const group = rig.group;
  const scale = group.scale.x || 1;
  const rand = mulberry32(seed);

  // Where it is buried. Everything comes home to here.
  const home = group.position.clone();
  const homeYaw = group.rotation.y;
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
    headYaw: 0, roll: 0, sway: 0, lift: -1.05,
  };

  // --- leg geometry -----------------------------------------------------------
  // Read off the rig rather than off metrics.js, so a change to the model
  // cannot silently put the feet through the floor. Only rotation.x moves a
  // limb in the sagittal plane and rotation.x preserves the local X coordinate,
  // so each leg is exactly a two link chain in its own YZ plane: link lengths
  // are the projections, and the rest angles are where those projections point.
  const LEG = {};
  for (const side of ['L', 'R']) {
    const kp = J[`knee${side}`].position;
    const ap = J[`ankle${side}`].position;
    LEG[side] = {
      hip: J[`hip${side}`].position.clone(),
      a1: Math.hypot(kp.y, kp.z),
      a2: Math.hypot(ap.y, ap.z),
      alpha1: Math.atan2(kp.z, kp.y),
      alpha2: Math.atan2(ap.z, ap.y),
      cx: kp.x + ap.x,          // lateral offset the sagittal solve cannot change
    };
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
  function solveLeg(side, t) {
    const L = LEG[side];
    const dx = t.x - L.hip.x;
    const dy = t.y - L.hip.y;
    const dz = t.z - L.hip.z;

    const rho = Math.hypot(dx, dy, dz);
    const span = L.a1 + L.a2;
    ikOut.short = Math.max(0, rho - span);
    // What is left for the two links to span once the lateral offset is spent.
    const r = Math.sqrt(Math.max(rho * rho - L.cx * L.cx, 1e-8));

    const cosG = (r * r - L.a1 * L.a1 - L.a2 * L.a2) / (2 * L.a1 * L.a2);
    const gamma = Math.acos(clamp(cosG, -1, 1));
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
  const feet = {
    L: { plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swing: 1, dur: 0.3, retarget: false },
    R: { plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swing: 1, dur: 0.3, retarget: false },
  };
  let cursor = 0;          // steps taken, fractional
  let nextStepAt = 1;      // cursor value the next step is due at
  let nextStep = 'R';
  let riseSteps = 0;       // shuffle steps taken at the top of the rise
  let legBlend = 0;        // 0 authored angles, 1 planted feet
  let travel = 0;

  // The x a foot sits at when the leg is straight down. Taken off the rig, so
  // walking straight needs no lateral correction at the hip at all and the
  // stance is exactly as wide as the model was built.
  const FOOT_X = { L: LEG.L.hip.x + LEG.L.cx, R: LEG.R.hip.x + LEG.R.cx };

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
  const target = new THREE.Vector3();

  group.updateMatrixWorld(true);
  J.head.getWorldPosition(headPrev);

  // --- phases -----------------------------------------------------------------

  function enter(next) {
    phase = next;
    phaseTime = 0;
    if (next === 'buried') {
      setClipping(true);
      speed = 0;
      yawVel = 0;
      T.lift = -1.05;
      S.lift.snap(-1.05);
      legBlend = 0;
      cursor = 0;
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
      // The feet come out of the rise standing square, which is half a cycle
      // away from where a walk wants them. Letting the first step come due
      // straight away is what stops the body walking out over its own planted
      // feet before the gait has found its phase.
      nextStepAt = cursor;
    }
  }

  // Buried. Not a switched-off object: it is listening, and what wakes it is
  // the ghost coming within range rather than a timer running out.
  function stepBuried(dt, ghost) {
    T.lift = -1.05;
    T.root = 100 * D;
    T.lumbar = 14 * D;
    T.thorax = 10 * D;
    T.neck = 60 * D;
    T.head = 110 * D;
    T.shoulderL = 24 * D; T.shoulderR = 20 * D;
    T.elbowL = -64 * D; T.elbowR = -64 * D;
    T.wristL = -76 * D; T.wristR = -76 * D;
    T.spreadL = 6 * D; T.spreadR = 6 * D;
    T.hipL = 0; T.hipR = 0;
    T.kneeL = 25 * D; T.kneeR = 25 * D;
    T.ankleL = 35 * D; T.ankleR = 35 * D;
    jawBeat = 0.04;
    chatter = 0;
    strain = 0;
    if (ghost && Math.hypot(ghost.x - pos.x, ghost.z - pos.z) < wakeRange) enter('emerging');
  }

  // The climb. Everything below reads the tracks above and hands them to the
  // springs; the tremor is added after the springs, because a spring would
  // swallow it.
  function stepEmerge(dt, ghost) {
    const t = phaseTime;
    strain = track(CRAWL.strain, t);

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
    chatter = 0.25 * strain;

    // Feet find the floor for the last stretch, so the rise has something to
    // push against. The blend is in angle space, so the legs swing up and
    // forward out of the hole rather than snapping there.
    if (t > 3.9) {
      if (legBlend === 0) {
        for (const side of ['L', 'R']) {
          feet[side].plant.copy(group.localToWorld(
            v1.set(FOOT_X[side], -group.position.y / scale, CROUCH_Z[side]),
          ));
          feet[side].plant.y = 0;
          feet[side].swing = 1;
        }
      }
      legBlend = clamp01((t - 3.9) / 0.7);
    }

    maybeShed(t);
    if (t >= EMERGE_END) enter('rising');
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

    // Gait. One cycle is two steps, so the pelvis rises and falls twice per
    // cycle and sways once. HIP_STALK is the TOP of the bob, not its middle:
    // the leg is nearly at full stretch at double support and there is no room
    // above it.
    const cyc = (cursor * 0.5) % 1;
    const moving = smoothstep(0.05, 0.5, speed);
    const bob = -BOB * moving * (1 - Math.cos(cyc * 2 * TAU)) * 0.5;
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

    // Arms out in front, swinging against the legs. The springs do the lag, so
    // the hands arrive after the shoulders and the whole arm reads as heavy.
    const swing = 14 * D * moving;
    T.shoulderL = (-74 - 6 * moving) * D + swing * Math.sin(cyc * TAU);
    T.shoulderR = (-74 - 6 * moving) * D - swing * Math.sin(cyc * TAU);
    T.elbowL = T.shoulderL - (34 + 8 * Math.sin(cyc * TAU)) * D;
    T.elbowR = T.shoulderR - (34 - 8 * Math.sin(cyc * TAU)) * D;
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
      : 0.05 + 0.04 * moving;

    if (ghost && dist < GIVE_UP_RANGE) lostFor = 0;
    else lostFor += dt;
    if (lostFor > 3.0) enter('settling');
  }

  // Gives up and goes back down. The same machinery in reverse, so the sink is
  // as heavy as the climb was.
  function stepSettle(dt) {
    const t = phaseTime;
    T.lift = mix(HIP_TALL, -1.05, easeInOutCubic(clamp01((t - 0.6) / 2.6)));
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
          v1.set(FOOT_X[side], -group.position.y / scale, HALF_STEP);
          group.localToWorld(v1);
          v1.y = 0;
          f.to.lerp(v1, (1 - hold) * (1 - Math.exp(-9 * dt)));
        }
      }
      if (f.swing >= 1) f.plant.copy(f.to);
    }
  }

  // Send one foot to a spot in the body's own frame. Used by the walk and by
  // the shuffle at the top of the rise, which is what brings the feet back
  // under the hips after standing up out of a staggered crouch.
  function queueStep(side, z, dur = 0.32, retarget = false) {
    const f = feet[side];
    if (f.swing < 1) return;
    f.from.copy(f.plant);
    f.to.copy(group.localToWorld(v1.set(FOOT_X[side], -group.position.y / scale, z)));
    f.to.y = 0;
    f.swing = 0;
    f.dur = dur;
    f.retarget = retarget;
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
    let best = 0;
    for (const side of ['L', 'R']) {
      group.worldToLocal(v1.copy(feet[side].plant));
      const back = -v1.z;
      const wide = Math.abs(v1.x - FOOT_X[side]);
      const urgency = Math.max(back / HALF_STEP, wide / 0.16);
      const due = urgency > 0.95 || (side === nextStep && cursor >= nextStepAt);
      if (due && urgency > best) { best = urgency; pick = side; }
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
    nextStepAt = Math.floor(cursor) + 1;
    nextStep = pick === 'L' ? 'R' : 'L';
  }

  // --- shed -------------------------------------------------------------------
  function maybeShed(t) {
    if (!debris) return;
    for (const plan of SHED_PLAN) {
      if (!shedLeft.includes(plan.bone) || t < plan.at) continue;
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
  const JAW_R_Y = 0.19;
  const JAW_R_Z = 0.248;
  const JAW_GAIN = 0.055;

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
      S.jaw.velocity += (0.5 + rand()) * chatter * 2.6;
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
      J[`shoulder${side}`].rotation.set(sh - thorax, 0, sgn * S[`spread${side}`].value);
      J[`elbow${side}`].rotation.x = el - sh;
      J[`wrist${side}`].rotation.x = wr - el;
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
        if (f.swing < 1) {
          // In the air. The arc is a half sine in height and an ease along the
          // ground, so the foot leaves and lands soft and travels fastest in
          // the middle, the way a real one does.
          const u = f.swing;
          const e = easeInOutCubic(u);
          v1.lerpVectors(f.from, f.to, e);
          v1.y = Math.sin(u * Math.PI) * FOOT_LIFT;
        } else {
          v1.copy(f.plant);
        }
        const above = v1.y;
        v1.y += M.y.ankle * scale;
        J.root.worldToLocal(v1);
        const ik = solveLeg(side, v1);
        // A foot flat on the floor is world pitch zero at the ankle, whatever
        // the rest of the leg is doing. In the air it toes down coming off and
        // lifts the toes coming in, and the toe-down is limited by how high the
        // ankle actually is: the toe is a quarter of a metre in front of the
        // pivot, so a full toe-off at ground level puts it through the floor.
        // Clamping it against the real clearance is also what makes the foot
        // roll off rather than flick.
        let swingPitch = 0;
        if (f.swing < 1) {
          const u = f.swing;
          const raw = 0.42 * (1 - u) ** 1.5 - 0.20 * u * u;
          const room = Math.asin(clamp(above / TOE_AHEAD, 0, 0.98));
          swingPitch = Math.min(raw, room);
        }
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
      if (patch.material) patch.material.opacity = contactOpacity[i] * show;
      const joint = i === 0 ? J.ankleL : J.ankleR;
      joint.getWorldPosition(v1);
      group.worldToLocal(v1);
      patch.position.set(v1.x, (0.004 - group.position.y) / scale, v1.z);
    }
  }

  // The highest the hip pivot can go with the feet where they are. Worked in
  // the group's own frame and then lifted into world, so it costs a couple of
  // trig calls rather than a matrix update.
  function liftLimit() {
    if (legBlend < 0.5) return Infinity;
    const reach = (LEG.L.a1 + LEG.L.a2) * scale * 0.995;
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
      const hx = LEG[side].hip.x;
      const lx = rootRest.x + S.sway.value + hx * cr;
      const ly = hx * sr * cp;
      const lz = rootRest.z + hx * sr * sp;
      const wx = pos.x + (lx * cy + lz * sy) * scale;
      const wz = pos.z + (-lx * sy + lz * cy) * scale;
      const horiz = Math.hypot(wx - f.plant.x, wz - f.plant.z);
      const up = Math.sqrt(Math.max(reach * reach - horiz * horiz, 0));
      cap = Math.min(cap, f.plant.y + M.y.ankle * scale + up - ly * scale);
    }
    return cap;
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
    nextStepAt = 1;
    nextStep = 'R';
    legBlend = 0;
    cursor = 0;
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

  return {
    update,
    reset,
    get state() { return phase; },
    // Not part of the contract. A performance that is asserted numerically is
    // one that stays fixed: the harness reads foot slip, turn rate and phase
    // dwell out of here rather than off a screenshot.
    metrics() {
      const out = {
        phase, phaseTime, clock, speed, yaw, yawVel, travel, cursor,
        hipY: S.lift.value, jaw: S.jaw.value, legBlend, strain, clipping,
        shed: shedFired.slice(),
        feet: {},
      };
      for (const side of ['L', 'R']) {
        J[`ankle${side}`].getWorldPosition(v1);
        out.feet[side] = {
          world: v1.toArray(),
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
}
