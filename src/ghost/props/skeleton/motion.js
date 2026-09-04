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
const SETTLE_K = 55;           // torque pulling a grounded bone onto its side
const SETTLE_REACH = 0.02;     // the torque still applies this far off the floor
const AXIS_HYSTERESIS = 0.15;  // margin before the settle switches which face is down
const SLEEP_V = 0.09;
const SLEEP_W = 0.5;
const SLEEP_TILT = 0.05;       // radians of remaining lean allowed at rest
const SLEEP_TIME = 0.18;       // seconds of stillness before a bone is retired
const FLAT_TOL = 1.25;         // extents within this ratio count as equally flat

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

// The bounding box of everything under `object`, expressed in the object's own
// local frame, before its own transform. Box3.setFromObject would give a world
// AABB, which is useless the moment the bone tumbles: what we need is a shape
// that can be re-oriented every frame.
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
  return { corners, size: _box.getSize(new THREE.Vector3()) };
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
  function lowestOffset(item) {
    const o = item.object;
    const c = item.corners;
    let min = Infinity;
    for (let i = 0; i < 8; i++) {
      _v.set(c[i * 3] * o.scale.x, c[i * 3 + 1] * o.scale.y, c[i * 3 + 2] * o.scale.z)
        .applyQuaternion(o.quaternion);
      if (_v.y < min) min = _v.y;
    }
    return min;
  }

  // Which way is "up" for this shape once it has settled. For a long bone that
  // is any axis across the shaft; for a slab it is the thin one; for a knucklish
  // lump every axis qualifies. Candidates are all the axes near the minimum
  // extent, and the one picked is whichever currently points most nearly up,
  // signs included. Choosing the nearest candidate is what stops a cube from
  // spinning three quarters of a turn to present one favoured face.
  function restAxis(item, out) {
    const o = item.object;
    let best = -Infinity;
    let bestAxis = item.downAxis;
    let bestSign = item.downSign;
    for (let a = 0; a < 3; a++) {
      if (item.extent[a] > item.minExtent * FLAT_TOL) continue;
      _v.copy(AXES[a]).applyQuaternion(o.quaternion);
      for (const sign of [1, -1]) {
        // Hysteresis, because a capsule standing on one end has four equally
        // good candidates and picking a fresh winner every substep makes the
        // torque change its mind faster than the bone can turn. It then rocks
        // about a saddle point and never lies down. Sticking with last frame's
        // choice unless another clearly beats it converges instead.
        const dot = _v.y * sign + (a === item.downAxis && sign === item.downSign ? AXIS_HYSTERESIS : 0);
        if (dot > best) {
          best = dot;
          bestAxis = a;
          bestSign = sign;
        }
      }
    }
    item.downAxis = bestAxis;
    item.downSign = bestSign;
    return out.copy(AXES[bestAxis]).multiplyScalar(bestSign);
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
      // Torque toward lying down. A real bone stops rotating because its
      // corners keep catching the ground, and integrating that properly needs
      // contact points and an inertia tensor. This is the cheap read of the
      // same thing: an angular pull toward the nearest flat orientation, with
      // enough angular drag that it never rings. Without it a capsule ends up
      // standing on one end and spinning like a top forever, which is the most
      // obvious tell that nothing is simulating contact.
      restAxis(item, _axis).applyQuaternion(o.quaternion);
      _v.crossVectors(_axis, UP);
      const s = _v.length();
      // atan2 rather than acos, because acos of a dot product loses all its
      // precision exactly where this matters most, near flat.
      item.tilt = Math.atan2(s, _axis.dot(UP));
      if (s > 1e-6) item.spin.addScaledVector(_v.divideScalar(s), item.tilt * SETTLE_K * h);

      const drag = Math.exp(-CONTACT_SPIN_DRAG * h);
      item.spin.multiplyScalar(drag);
      const slide = Math.exp(-GROUND_DRAG * h);
      item.vel.x *= slide;
      item.vel.z *= slide;
    } else {
      item.spin.multiplyScalar(Math.exp(-AIR_SPIN_DRAG * h));
      item.tilt = Infinity;
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
          const radius = Math.max(-lowestOffset(item), 1e-3);
          _v2.crossVectors(UP, _v).divideScalar(radius);
          item.spin.addScaledVector(_v2.sub(item.spin), ROLL_COUPLE * hit);
        }
      }
    }

    const resting =
      low <= floorY + CONTACT_EPS &&
      item.vel.lengthSq() < SLEEP_V * SLEEP_V &&
      item.spin.lengthSq() < SLEEP_W * SLEEP_W &&
      item.tilt < SLEEP_TILT;
    item.still = resting ? item.still + h : 0;
    return item.still < SLEEP_TIME;
  }

  // Retiring a bone is also the last chance to make it look right: snap the
  // remaining lean out of it and set it down so its lowest point is exactly on
  // the floor. Every "resting object slowly sinking" bug is a settle step that
  // left a fraction of a millimetre of penetration and never looked again.
  function retire(item) {
    const o = item.object;
    restAxis(item, _axis).applyQuaternion(o.quaternion);
    _q.setFromUnitVectors(_axis, UP);
    o.quaternion.premultiply(_q).normalize();
    o.position.y = floorY - lowestOffset(item);
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

      const { corners, size } = localBounds(object3D);
      const extent = [
        size.x * Math.abs(object3D.scale.x),
        size.y * Math.abs(object3D.scale.y),
        size.z * Math.abs(object3D.scale.z),
      ];

      const item = {
        object: object3D,
        corners,
        extent,
        minExtent: Math.min(extent[0], extent[1], extent[2]),
        vel: toVector(velocity, new THREE.Vector3()),
        spin: toVector(spin, new THREE.Vector3()),
        still: 0,
        tilt: Infinity,
        downAxis: 0,
        downSign: 1,
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
    stats() {
      return { live: live.length, asleep: asleep.length };
    },
  };
}
