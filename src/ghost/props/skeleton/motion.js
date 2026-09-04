import * as THREE from 'three';

// Model-independent motion utilities for the skeleton: a spring that behaves
// the same at 20fps as at 144fps, three easings, and a small rigid body system
// for bones that shake loose and drop.
//
// Nothing here knows what a skeleton looks like. The rule from the ghost holds:
// secondary motion is SIMULATED and follows from primary motion. A jaw hung off
// a Spring clacks because the skull stopped; a jaw on a sine wave is a flipbook.

// --- Spring ------------------------------------------------------------------

// A damped harmonic oscillator, solved analytically rather than integrated.
//
// The main loop clamps dt to 1/20, so one step can be 50ms, and that is what
// kills the usual implementations. Explicit Euler on a stiff spring (k = 300,
// which is a perfectly ordinary "snappy jaw") gains energy every step at 50ms
// and leaves the screen in about a dozen frames. Semi-implicit Euler survives
// but is not free either: at 50ms it lands somewhere between badly overdamped
// and ringing, so the same spring reads as a different character depending on
// the machine it runs on, which is the whole thing we are trying to avoid.
//
// Substepping fixes both and costs an unbounded number of steps at the exact
// moment the frame is already late. The closed form costs two exponentials, is
// exact for a target that is constant across the step, and cannot go unstable
// at any dt because it is not an integration at all. The state transition is
// linear in (offset, velocity), so the four coefficients are cached and reused
// while dt, stiffness and damping hold still, which they usually do.
export class Spring {
  #target;
  #k;
  #c;
  #dt = -1;
  #m = [1, 0, 0, 1];

  constructor({ stiffness = 120, damping = 14, value = 0, target = value } = {}) {
    this.#k = stiffness;
    this.#c = damping;
    this.value = value;
    this.velocity = 0;
    this.#target = target;
  }

  get target() { return this.#target; }
  set target(v) { this.#target = v; }

  get stiffness() { return this.#k; }
  set stiffness(v) { if (v !== this.#k) { this.#k = v; this.#dt = -1; } }

  get damping() { return this.#c; }
  set damping(v) { if (v !== this.#c) { this.#c = v; this.#dt = -1; } }

  // Jump to a value with no motion. For teleports and for the first frame,
  // where easing in from zero would read as the rig assembling itself.
  snap(v = this.#target) {
    this.value = v;
    this.velocity = 0;
    return this.value;
  }

  #coefficients(dt) {
    if (dt === this.#dt) return this.#m;
    const k = this.#k;
    const c = this.#c;
    const disc = c * c - 4 * k;
    let m;

    // The real-root branch loses all its precision as the roots merge, because
    // it divides by (r1 - r2). Anything inside this band goes to the critically
    // damped form, which is the limit of both other branches anyway.
    if (Math.abs(disc) < 1e-6 * Math.max(1, k)) {
      const r = -c / 2;
      const e = Math.exp(r * dt);
      m = [(1 - r * dt) * e, dt * e, -r * r * dt * e, (1 + r * dt) * e];
    } else if (disc > 0) {
      const s = Math.sqrt(disc);
      const r1 = (-c + s) / 2;
      const r2 = (-c - s) / 2;
      const e1 = Math.exp(r1 * dt);
      const e2 = Math.exp(r2 * dt);
      const d = r1 - r2;
      m = [
        (r1 * e2 - r2 * e1) / d,
        (e1 - e2) / d,
        (r1 * r2 * (e2 - e1)) / d,
        (r1 * e1 - r2 * e2) / d,
      ];
    } else {
      const a = c / 2;
      const w = Math.sqrt(k - a * a);
      const e = Math.exp(-a * dt);
      const cs = Math.cos(w * dt);
      const sn = Math.sin(w * dt);
      m = [e * (cs + (a / w) * sn), (e * sn) / w, (-e * k * sn) / w, e * (cs - (a / w) * sn)];
    }

    this.#dt = dt;
    this.#m = m;
    return m;
  }

  step(dt) {
    if (!(dt > 0)) return this.value;
    const [a11, a12, a21, a22] = this.#coefficients(dt);
    const e = this.value - this.#target;
    const v = this.velocity;
    this.value = this.#target + a11 * e + a12 * v;
    this.velocity = a21 * e + a22 * v;
    return this.value;
  }
}

// --- Easings -----------------------------------------------------------------
// All three map 0..1 to 0..1. Back and Elastic overshoot in the middle, which
// is the point of them, but every one of these lands exactly on 1 at t = 1:
// an ease that ends at 0.9997 leaves a bone floating a millimetre off its
// socket, and that error is permanent because nothing runs after the ease.

const clamp01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

// Overshoots past the target and comes back. c1 is the classic Penner constant;
// it peaks about 10% past 1.
export function easeOutBack(t) {
  t = clamp01(t);
  // Both ends returned literally. The cubic evaluates to 2.2e-16 at t = 0
  // rather than to zero, and a joint that starts a hair off its bind pose is a
  // pop on frame one.
  if (t === 0 || t === 1) return t;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

export function easeInOutCubic(t) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// A decaying sine. The endpoints are returned literally rather than evaluated:
// the formula is only asymptotically 1, and 2^-10 * sin(...) at t = 1 is small
// but not zero.
export function easeOutElastic(t) {
  t = clamp01(t);
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

// --- Debris ------------------------------------------------------------------

// Tuning. These are bone on packed earth, not a bouncy ball, and most of the
// character is in how fast the energy leaves rather than in the restitution.
const MAX_STEP = 1 / 120;      // fixed inner step, so 20fps and 144fps agree
const CONTACT_EPS = 1e-3;      // slop for "is touching the floor"
const REST_SPEED = 0.35;       // slower than this into the floor is resting contact
const HARD_HIT = 2.0;          // impact speed at which the scuff is applied in full
const MIN_BOUNCE = 0.55;       // below this impact speed the bounce is dropped
const TANGENT_KEEP = 0.45;     // sideways speed surviving an impact
const SPIN_KEEP = 0.62;        // tumble surviving a full-speed impact
const ROLL_COUPLE = 0.3;       // how much sliding turns into rolling on impact
const GROUND_DRAG = 9.0;       // per second, sliding along the floor
const AIR_SPIN_DRAG = 0.25;    // per second, tumble bleeding off in flight
const CONTACT_SPIN_DRAG = 11.0; // per second, tumble against the floor
const SETTLE_REACH = 0.02;     // the torque still applies this far off the floor
// The angles the stability probe tips a pose by, coarse to fine. Four of them,
// because no single angle can answer the question.
//
// The wide ones step past the faceting of the mesh, so they measure the shape
// of the pose rather than the polygons of the model, and they are what catch a
// bone balanced on a rounded end. The widest, 31 degrees, is a judgement about
// debris rather than about physics: a plate standing on its 3cm edge is
// genuinely stable, in that it takes an 8 degree shove to push it over, and a
// solver that respects that leaves rib chips standing on end all over the
// graveyard. Anything a 31 degree nudge would topple is treated as precarious.
// A cube needs 45 degrees and stays. A bone on its side needs 90 and stays.
//
// The fine ones exist because a wide probe steps clean over a shallow slope: a
// bone resting with one end 26mm off the ground looked like a minimum to the
// 14 degree probe alone, since 14 degrees either way overshoots flat and comes
// back up the far side.
const PROBE_TILT = 0.24;       // the middle angle, and the torque's normaliser
const PROBE_ANGLES = [0.55, 0.24, 0.08, 0.025];
const PROBE_EVERY = 4;         // substeps between stability probes
const PROBE_SPIN = 3.0;        // above this tumble the probe is pointless, skip it
const MIN_DROP = 1e-4;         // metres of drop that count as a real downhill
const DROP_FRACTION = 0.002;   // or this fraction of the centre of mass height
const TOPPLE_CAP = 60;         // rad/s^2, ceiling on the toppling torque
const SLEEP_V = 0.09;
const SLEEP_W = 0.5;
// The second way to fall asleep, for an object whose pose is a hair off a
// facet of its own mesh. The probe correctly reports a downhill of a fifth of
// a millimetre and correctly keeps pushing, but at that size the push cannot
// beat the contact drag, and the bone sits there converging for three seconds
// after it stopped being worth watching. If it is this motionless for this
// long it is at rest, whatever the probe wants. A bone actually balanced on its
// end never reaches this: the probe torque spins it up past the threshold
// within a tenth of a second, which is the whole point of the torque.
const CREEP_V = 0.02;
const CREEP_W = 0.12;
const CREEP_TIME = 0.4;
// The third way out, and the one that catches a bone the other two cannot.
//
// The settle exists to lower a centre of mass. A bone whose centre of mass has
// stopped going down has finished settling, whatever the probe thinks of the
// pose it finished in, so after this long with no progress the topple torque is
// switched off and the bone is left to the contact drag, which stops it inside
// a fifth of a second and hands it to the creep test above.
//
// This is not a safety net for a rare case, it is a limit cycle the torque can
// genuinely fall into. A small knobbly bone has a huge inverse inertia: a shed
// finger is three beads on a short chain, and 12/(sum of its squared extents)
// comes out at 635 against a rib's 112. The torque therefore spins it up faster
// than one substep can carry it to the minimum, it rotates past, and the pose
// it lands in is unstable in a new direction. The probe is right about every
// one of those poses and the bone still never stops: measured on the shed
// finger it sat at 0.93 rad/s with v = 0 for the whole of a nine second clip.
// Weakening the torque only makes the cycle slower.
const STALL_TIME = 1.0;
// And what counts as having got somewhere in that time: metres the centre of
// mass has to come down, against the lowest it has already reached. A whole
// millimetre rather than the probe's own tenth of one, because a bone rolling
// from facet to facet shaves a tenth off its best every time it turns and a
// finer test therefore sees progress for ever. A millimetre a second is below
// anything a viewer can wait out, and a bone genuinely toppling clears it by
// two orders of magnitude on the way over.
const STALL_PROGRESS = 0.001;
const MAX_VERTS = 900;         // vertices kept per bone for the exact passes
const STABLE_STICK = 3;        // once judged settled, this much harder to unsettle again
const SLEEP_TIME = 0.18;       // seconds of stillness before a bone is retired

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _box = new THREE.Box3();
const UP = new THREE.Vector3(0, 1, 0);
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

// Directions used to decimate a mesh down to a support cloud. The six axes are
// in there explicitly because a bone at rest is aligned to one of them, so the
// contact under a settled bone is then exact rather than approximate.
function supportDirections(n) {
  const dirs = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    dirs.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
  }
  return dirs;
}
const SUPPORT_DIRS = supportDirections(58);

// Horizontal axes the stability probe tips the object about. Eight rather than
// four so the direction it decides to fall in is not always square to the world.
const TILT_AXES = [];
for (let i = 0; i < 8; i++) {
  TILT_AXES.push(new THREE.Vector3(Math.cos((i * Math.PI) / 4), 0, Math.sin((i * Math.PI) / 4)));
}

// The object's own vertices, in its local frame, decimated to the extreme point
// along each support direction. Every point kept is on the convex hull, so this
// is a cheap stand-in for the real silhouette in any orientation.
//
// This replaces the bounding box the first version used, and it has to. A box
// hull cannot tell a hemisphere from a flat end: it reports the same four
// bottom corners either way, which is what let a bone sleep balanced on its
// rounded tip. The box also lifted a tumbling capsule up to 2cm off the floor
// at 45 degrees, because the box corner sticks out well past the real surface.
function supportCloud(object) {
  object.updateWorldMatrix(true, true);
  _inv.copy(object.matrixWorld).invert();

  const verts = [];
  object.traverse((node) => {
    const attr = node.geometry?.attributes?.position;
    if (!attr) return;
    _m.multiplyMatrices(_inv, node.matrixWorld);
    // A skull is a few thousand vertices and none of this needs that many, so
    // anything huge is strided down first.
    const stride = Math.max(1, Math.ceil(attr.count / MAX_VERTS));
    for (let i = 0; i < attr.count; i += stride) {
      _v.fromBufferAttribute(attr, i).applyMatrix4(_m);
      verts.push(_v.x, _v.y, _v.z);
    }
  });

  const n = verts.length / 3;
  if (!n) return null;

  const keep = new Set();
  for (const d of SUPPORT_DIRS) {
    let best = -Infinity;
    let bestIndex = 0;
    for (let i = 0; i < n; i++) {
      const dot = d.x * verts[i * 3] + d.y * verts[i * 3 + 1] + d.z * verts[i * 3 + 2];
      if (dot > best) { best = dot; bestIndex = i; }
    }
    keep.add(bestIndex);
  }

  const hull = new Float32Array(keep.size * 3);
  let k = 0;
  for (const i of keep) {
    hull[k++] = verts[i * 3];
    hull[k++] = verts[i * 3 + 1];
    hull[k++] = verts[i * 3 + 2];
  }

  // Two sets, because they answer two different questions. The hull is walked
  // every substep for contact and is allowed to be a few millimetres out on a
  // curved surface mid-tumble, where nobody can see it. The full sample is
  // walked only when the object is nearly still, for the stability probe and
  // for the final placement, and it has to be exact: the probe is measuring
  // drops of a third of a millimetre, so a hull that wanders by three would be
  // measuring its own decimation rather than the shape of the pose.
  return { hull, verts: new Float32Array(verts) };
}

// The bounding box of everything under `object`, expressed in the object's own
// local frame, before its own transform. Used for the extents and the centre of
// mass, not for contact: Box3.setFromObject would give a world AABB, which is
// useless the moment the bone tumbles.
function localBounds(object) {
  object.updateWorldMatrix(true, true);
  _inv.copy(object.matrixWorld).invert();
  _box.makeEmpty();

  object.traverse((node) => {
    const g = node.geometry;
    if (!g) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) return;
    _m.multiplyMatrices(_inv, node.matrixWorld);
    for (let i = 0; i < 8; i++) {
      _v.set(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z,
      ).applyMatrix4(_m);
      _box.expandByPoint(_v);
    }
  });

  // A bone with no geometry of its own (an empty parent) still has to land on
  // something, so give it a pebble-sized hull rather than a point.
  if (_box.isEmpty()) _box.set(_v.set(-0.02, -0.02, -0.02), _v2.set(0.02, 0.02, 0.02));

  const corners = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    corners[i * 3] = i & 1 ? _box.max.x : _box.min.x;
    corners[i * 3 + 1] = i & 2 ? _box.max.y : _box.min.y;
    corners[i * 3 + 2] = i & 4 ? _box.max.z : _box.min.z;
  }
  return {
    corners,
    size: _box.getSize(new THREE.Vector3()),
    centre: _box.getCenter(new THREE.Vector3()),
  };
}

function toVector(v, out) {
  if (!v) return out.set(0, 0, 0);
  if (Array.isArray(v)) return out.set(v[0] || 0, v[1] || 0, v[2] || 0);
  return out.set(v.x || 0, v.y || 0, v.z || 0);
}

export function createDebris({ scene, gravity = -9.8, bounce = 0.35, floorY = 0 } = {}) {
  // Two lists on purpose. `live` is walked every frame; a bone that has come to
  // rest moves to `asleep` and from then on costs nothing but a slot in an
  // array. Fifty settled bones should be exactly as cheap as none.
  const live = [];
  const asleep = [];
  // Membership, so spawning the same bone twice cannot put two simulations on
  // one transform. The choreography retries things.
  const owned = new Set();

  // How far the lowest point of the hull sits below the object's origin, at the
  // object's current orientation. This is the whole reason a bone does not end
  // up half sunk: the contact test is the real lowest extent, not the origin,
  // and it is recomputed as the bone tumbles because it changes with every
  // degree of roll.
  function lowestOffset(item, q = item.object.quaternion, p = item.points) {
    const s = item.object.scale;
    let min = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      _v.set(p[i] * s.x, p[i + 1] * s.y, p[i + 2] * s.z).applyQuaternion(q);
      if (_v.y < min) min = _v.y;
    }
    return min;
  }

  // Height of the centre of mass above the floor if the object were set down at
  // orientation q. This is the potential energy of the pose, and everything the
  // settle needs to know is in its shape.
  function poseEnergy(item, q) {
    const s = item.object.scale;
    const low = lowestOffset(item, q, item.verts);
    _v2.copy(item.com).multiply(s).applyQuaternion(q);
    return _v2.y - low;
  }

  // Is this pose actually a resting pose, or merely a stationary one?
  //
  // The real question is whether the centre of mass sits inside the support
  // patch, and the honest way to ask it is to tip the object a little and see
  // whether the centre of mass goes DOWN. A box on a face, a plate on its face
  // and a bone on its side all lift their centre of mass when tipped, so they
  // are minima and may sleep. A bone balanced on its rounded end lowers it in
  // every direction, because the contact is a point and the hemisphere just
  // rolls, so it may never sleep no matter how still it is. A sphere is flat in
  // every direction and is neither, which is correct: it is free to rest.
  //
  // See PROBE_ANGLES for why this is asked at four different tilts.
  function probeStability(item) {
    const q0 = item.object.quaternion;
    const e0 = poseEnergy(item, q0);
    const base = Math.max(MIN_DROP, DROP_FRACTION * e0);

    let unstable = false;
    let bestDrop = 0;
    let bestAxis = -1;
    // Hysteresis on the verdict as well as on the axis. A pose sitting right at
    // the threshold would otherwise flip every probe, and the torque would
    // switch on and off at 30Hz, which reads as a buzz.
    const stick = item.unstable ? 1 : STABLE_STICK;

    for (const angle of PROBE_ANGLES) {
      // The tolerance is really a tolerance on slope, so it scales with the
      // angle the drop was measured over.
      const tolerance = base * (angle / PROBE_TILT) * stick;
      for (let i = 0; i < TILT_AXES.length; i++) {
        _q.setFromAxisAngle(TILT_AXES[i], angle).multiply(q0);
        const drop = e0 - poseEnergy(item, _q);
        if (drop > tolerance) unstable = true;
        if (drop > bestDrop) { bestDrop = drop; bestAxis = i; }
      }
    }

    item.unstable = unstable;
    // The pose's own energy, kept so the caller can tell whether the settle is
    // getting anywhere. See STALL_TIME.
    item.energy = e0;
    // The drop drives the torque, not the slope. The energy of a rocking body
    // has a corner at its resting pose, not a smooth basin: the contact jumps
    // from one end of the bone to the other, so the slope is as steep a hair
    // either side of flat as it is at 20 degrees. A slope-proportional torque
    // therefore never stops pushing and the bone rocks between 85 and 90
    // degrees forever. The drop goes to zero as the pose approaches the corner,
    // which is what actually lets it arrive.
    item.drop = bestDrop;
    if (bestAxis >= 0) item.toppleAxis.copy(TILT_AXES[bestAxis]);
  }

  function integrate(item, h) {
    const o = item.object;

    item.vel.y += gravity * h;
    o.position.addScaledVector(item.vel, h);

    // Reach, not contact. A bone tipping over its own end spends half the topple
    // a few millimetres in the air, and gating the settle on hard contact made
    // it inch over in a series of little hops instead of falling.
    const grounded = o.position.y + lowestOffset(item) <= floorY + SETTLE_REACH;

    if (grounded) {
      // Gravity, as a torque, and the only thing that lays a bone down.
      //
      // The first version of this settled with a heuristic instead: pick the
      // axis of the object's own bounding box with the smallest extent and
      // spring it toward vertical. It laid slender bones down convincingly and
      // was wrong in two ways that mattered. It thought a stubby bone standing
      // on its rounded end was already flat, because its shaft is no longer
      // than it is wide, and it fought this torque to a standstill at 25
      // degrees. And it insisted a capsule rest with its box axis exactly up,
      // which for a fourteen sided cross section is a facet EDGE, so the bone
      // rocked between the heuristic's answer and the real one forever. The probe already measured how steeply the
      // centre of mass falls away from this pose, and that slope times the
      // object's mass over its moment of inertia IS the angular acceleration
      // gravity applies. So an unstable pose topples on its own, and because
      // the slope grows as it goes over, the topple starts slow and builds,
      // which is what a bone falling off its end actually looks like. Nudging
      // it with a fixed impulse instead reads as a shove from off screen.
      item.probeAge += 1;
      if (item.spin.lengthSq() < PROBE_SPIN * PROBE_SPIN) {
        if (item.probeAge >= PROBE_EVERY) {
          item.probeAge = 0;
          probeStability(item);
        }
      } else {
        // Tumbling too fast for the probe to mean anything. Assume the worst,
        // so nothing can sleep on the strength of a stale answer.
        item.unstable = true;
        item.drop = 0;
        item.stall = 0;
      }
      if (item.unstable && item.drop > 0 && item.stall < STALL_TIME) {
        const alpha = Math.min(
          (Math.abs(gravity) * item.drop * item.invInertia) / PROBE_TILT,
          TOPPLE_CAP,
        );
        item.spin.addScaledVector(item.toppleAxis, alpha * h);
      }

      const drag = Math.exp(-CONTACT_SPIN_DRAG * h);
      item.spin.multiplyScalar(drag);
      const slide = Math.exp(-GROUND_DRAG * h);
      item.vel.x *= slide;
      item.vel.z *= slide;
    } else {
      item.spin.multiplyScalar(Math.exp(-AIR_SPIN_DRAG * h));
      // In the air, nothing known about the last contact is worth keeping.
      item.unstable = true;
      item.probeAge = PROBE_EVERY;
    }

    // Is the settle getting anywhere? Asked on the clock rather than on
    // contact, because a bone rocking under the topple torque hops a couple of
    // centimetres clear on every cycle and a contact-gated timer is reset by
    // that before it can ever accumulate. A bone in genuine flight has a
    // genuine velocity, and that is what resets this instead.
    //
    // `best` is the lowest centre of mass the bone has reached; the timer only
    // restarts when it is beaten by a margin worth watching, so a limit cycle
    // shaving a fraction of a millimetre off it every turn does not count as
    // progress.
    if (item.vel.lengthSq() >= SLEEP_V * SLEEP_V || !Number.isFinite(item.energy)) {
      item.stall = 0;
    } else {
      if (item.energy < item.best - STALL_PROGRESS) item.stall = 0;
      else item.stall += h;
      if (item.energy < item.best) item.best = item.energy;
    }

    const w = item.spin.length();
    if (w > 1e-7) {
      _q.setFromAxisAngle(_v.copy(item.spin).divideScalar(w), w * h);
      o.quaternion.premultiply(_q).normalize();
    }

    // Resolve the floor after rotating, because the rotation is what changes
    // the lowest extent. Doing it before lets a bone rotate its tip through the
    // ground and stay there until the next frame notices.
    const low = o.position.y + lowestOffset(item);
    if (low < floorY) {
      o.position.y += floorY - low;

      if (item.vel.y < 0) {
        const impact = -item.vel.y;
        if (impact <= REST_SPEED) {
          // Resting contact, not a hit. A bone lying on the ground still gains
          // gravity every substep and so still arrives at the floor going 8cm/s
          // downward; cancelling that is all this case needs. Running the scuff
          // here instead was the first version, and it multiplied the tumble by
          // SPIN_KEEP a hundred and twenty times a second, which froze every
          // bone at whatever angle it happened to land on. A femur standing on
          // one end, perfectly still, forever.
          item.vel.y = 0;
        } else {
          // A real hit. A bounce is only allowed if there is enough speed left
          // to make one worth watching: reflecting a 2cm/s approach forever is
          // exactly the jitter that makes physics look cheap, and no value of
          // restitution avoids it. The fix is a floor on the speed.
          item.vel.y = impact < MIN_BOUNCE ? 0 : impact * bounce;

          // Scuff. Sideways speed and tumble both take a hit, and part of the
          // slip is handed to the spin so a bone thrown forward tips over its
          // own end instead of skating on the spot.
          //
          // Scaled by how hard the hit was, rather than applied whole. A bone
          // toppling over its own end touches down at about 0.5m/s, and taking
          // half its tumble away at that speed stopped the topple dead: it fell
          // over in eight little nudges over a second and a half, when a real
          // one goes over in one movement. Only a genuine slam takes the lot.
          const hit = Math.min((impact - REST_SPEED) / (HARD_HIT - REST_SPEED), 1);
          _v.set(item.vel.x, 0, item.vel.z);
          const keep = 1 + (TANGENT_KEEP - 1) * hit;
          item.vel.x *= keep;
          item.vel.z *= keep;
          item.spin.multiplyScalar(1 + (SPIN_KEEP - 1) * hit);
          const radius = Math.max(-low, 1e-3);
          _v2.crossVectors(UP, _v).divideScalar(radius);
          item.spin.addScaledVector(_v2.sub(item.spin), ROLL_COUPLE * hit);
        }
      }
    }

    // Stationary is not the same as settled. Without the stability term a
    // stubby bone stood on its rounded end passes every one of these tests: it
    // is on the floor, it is not moving, and the axis heuristic is perfectly
    // happy because the shaft is short enough to pass for a flat side.
    const onFloor = low <= floorY + CONTACT_EPS;
    const resting =
      onFloor &&
      !item.unstable &&
      item.vel.lengthSq() < SLEEP_V * SLEEP_V &&
      item.spin.lengthSq() < SLEEP_W * SLEEP_W;
    item.still = resting ? item.still + h : 0;

    const creeping =
      onFloor &&
      item.vel.lengthSq() < CREEP_V * CREEP_V &&
      item.spin.lengthSq() < CREEP_W * CREEP_W;
    item.creep = creeping ? item.creep + h : 0;

    return item.still < SLEEP_TIME && item.creep < CREEP_TIME;
  }

  // Retiring a bone is the last chance to set it down exactly: its lowest point
  // goes precisely on the floor. Every "resting object slowly sinking" bug is a
  // settle step that left a fraction of a millimetre of penetration and never
  // looked again.
  //
  // The orientation is left exactly as the simulation found it. An earlier
  // version snapped the flat axis to vertical here, which is wrong twice over:
  // it is a visible pop on a long bone, and the pose it snapped to is not
  // necessarily the resting pose the object actually reached.
  function retire(item) {
    const o = item.object;
    // The exact sample, not the hull: this is the number a viewer can see.
    o.position.y = floorY - lowestOffset(item, o.quaternion, item.verts);
    item.vel.set(0, 0, 0);
    item.spin.set(0, 0, 0);
    o.updateMatrix();
    asleep.push(item);
  }

  return {
    spawn(object3D, { velocity, spin } = {}) {
      if (!object3D || !scene || owned.has(object3D)) return object3D;

      // attach, not add: it rewrites the local transform so the world one is
      // unchanged. A rib that detaches on the frame the ribcage is mid-twist
      // has to leave from exactly where it was drawn, or the detach reads as a
      // pop rather than as a bone coming loose.
      scene.attach(object3D);

      const { corners, size, centre } = localBounds(object3D);
      const cloud = supportCloud(object3D);
      const extent = [
        size.x * Math.abs(object3D.scale.x),
        size.y * Math.abs(object3D.scale.y),
        size.z * Math.abs(object3D.scale.z),
      ];

      const item = {
        object: object3D,
        // The support cloud, or the eight box corners for an object that has no
        // geometry of its own to sample.
        points: cloud ? cloud.hull : corners,
        verts: cloud ? cloud.verts : corners,
        com: centre,
        extent,
        minExtent: Math.min(extent[0], extent[1], extent[2]),
        // Moment of inertia of a box of these extents, over its mass. Turning
        // the energy slope into an angular acceleration needs it, and getting
        // it from the real shape rather than a constant is what keeps a finger
        // bone toppling faster than a femur.
        invInertia: 12 / Math.max(
          extent[0] * extent[0] + extent[1] * extent[1] + extent[2] * extent[2],
          1e-6,
        ),
        vel: toVector(velocity, new THREE.Vector3()),
        spin: toVector(spin, new THREE.Vector3()),
        still: 0,
        creep: 0,
        // Settle progress: the lowest centre of mass this bone has reached, the
        // pose energy the probe last measured, and how long it has been failing
        // to get any lower. See STALL_TIME.
        best: Infinity,
        energy: Infinity,
        stall: 0,
        unstable: true,
        drop: 0,
        probeAge: PROBE_EVERY,
        toppleAxis: new THREE.Vector3(1, 0, 0),
      };

      // Land the bone on the floor immediately if it spawned inside it, so a
      // bone shed from a crouching pose does not have to climb out.
      const low = object3D.position.y + lowestOffset(item);
      if (low < floorY) object3D.position.y += floorY - low;

      live.push(item);
      owned.add(object3D);
      return object3D;
    },

    update(dt) {
      if (!live.length || !(dt > 0)) return;

      // A 50ms frame integrated in one go puts a falling bone 4cm past the
      // floor before anything notices, and the bounce that comes out of that is
      // visibly wrong. The inner step is fixed instead, which also means the
      // capture harness and the browser produce the same arcs.
      const steps = Math.min(Math.ceil(dt / MAX_STEP), 32);
      const h = dt / steps;

      for (let s = 0; s < steps; s++) {
        for (let i = live.length - 1; i >= 0; i--) {
          const item = live[i];
          // Something else took the bone back, or the scene was torn down under
          // us. Either way it stops being ours without a fuss.
          if (item.object.parent !== scene) {
            live.splice(i, 1);
            continue;
          }
          if (!integrate(item, h)) {
            retire(item);
            live.splice(i, 1);
          }
        }
        if (!live.length) break;
      }
    },

    // Detaches everything and forgets it. Geometries and materials are NOT
    // disposed here: they belong to whoever built the bone, and this system was
    // only ever borrowing the transform. Safe to call twice, safe to call while
    // objects are mid-flight, and safe after the meshes have already been
    // disposed or pulled out of the scene by someone else.
    clear() {
      for (const list of [live, asleep]) {
        for (const item of list) item.object.parent?.remove(item.object);
        list.length = 0;
      }
      owned.clear();
    },

    // For tests and for the harness. Not part of the contract, but a settle
    // that is asserted numerically is a settle that stays fixed.
    //
    // `items` names what is still moving and how fast, because a count alone
    // cannot tell a bone that is taking a while to topple from one that is
    // creeping across the floor and will never stop.
    stats() {
      return {
        live: live.length,
        asleep: asleep.length,
        items: live.map((i) => ({
          name: i.object.name || '?',
          y: +i.object.position.y.toFixed(4),
          v: +i.vel.length().toFixed(4),
          w: +i.spin.length().toFixed(4),
          unstable: i.unstable,
          drop: +i.drop.toFixed(6),
          stall: +i.stall.toFixed(3),
          still: +i.still.toFixed(3),
          creep: +i.creep.toFixed(3),
        })),
      };
    },
  };
}
