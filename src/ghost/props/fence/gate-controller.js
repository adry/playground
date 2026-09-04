import { GATE_LAYOUT } from './gate.js';

// Everything the gate does ABOUT THE GHOST, in one place: when he shoves it,
// which way it goes, where the leaf stops because he is standing in it, and
// what ground a scene has to leave clear for the swing.
//
// It sits between two files that are each deliberately ignorant of the other.
// gate.js is a model and never writes hinge.rotation; swing.js is a pendulum
// and has never heard of a ghost, a metre or an X axis. Neither should learn.
// The join between an angle and a world is exactly this file's job, and it used
// to live inline in the scene, which is how it came to be wrong: a scene file
// is the last place anyone looks for a sign convention.
//
// ---------------------------------------------------------------------------
// WHICH WAY IS OPEN, and it is worth the twenty lines because getting it wrong
// makes the gate swing INTO whatever pushed it, which is what shipped.
//
// Three facts, each of them readable off a file rather than a matter of taste:
//
//   1. A yaw of `yaw` on the gate's group sends its local +X to the world
//      (cos yaw, 0, -sin yaw) and its local +Z to (sin yaw, 0, cos yaw). Those
//      two are `axisX` and `axisZ` below. The leaf's closed plane contains
//      axisX, so axisZ is the closed leaf's NORMAL, and the ghost's speed
//      through the gateway is his velocity dotted with it.
//
//   2. The leaf runs from the pivot along local X, in the direction gate.js
//      reports as `leafSign` (+1 for a gate hinged at its -X end, -1 mirrored).
//      So a point r along the leaf sits at r * leafSign * axisX when shut.
//
//   3. A three.js rotation.y of `a` is the standard right-handed turn about
//      +Y, which carries local +X toward local -Z: (r,0,0) becomes
//      (r cos a, 0, -r sin a).
//
// Put them together. The free edge of the leaf, at radius R from the pivot,
// sits at
//
//      P(a) = R * leafSign * (cos a * axisX  -  sin a * axisZ)
//
// so the part of it that lies along the gateway normal is
//
//      P(a) . axisZ = -R * leafSign * sin a       and       d/da at a=0
//                   = -R * leafSign
//
// The free edge therefore travels along -leafSign * axisZ for an INCREASING
// angle. To send it the same way the ghost is going, the impulse must be
//
//      push = -leafSign * (ghost.vel . axisZ) * gain
//
// and the minus sign is the whole bug. Measured on the shipped gate (leafSign
// +1, yaw PI/4, ghost walking at 2 m/s along the normal, i.e. `through` =
// +2.000): the old `push(+through)` moved the free edge -0.185 along the
// normal against the ghost's +1.000, a dot of -1.000, the leaf coming at him.
// With the sign above it moves +0.185, a dot of +1.000. Same numbers mirrored
// for a ghost arriving from the other side and for a right-hung gate, which is
// the point of carrying `leafSign` rather than a hardcoded direction: this gate
// is double-acting and must open whichever way it was pushed.
// ---------------------------------------------------------------------------

// Contact radius of the ghost's body at picket height. His dome is 0.42 and the
// skirt flares wider than that toward the hem, but the hem is loose cloth that
// trails and swirls; stopping a gate on the trailing edge of a skirt reads as
// the leaf hitting nothing. The dome is where the body reads solid, so the
// contact is sized off it, rounded up a little to cover the lean.
const GHOST_RADIUS = 0.45;

// Below this speed through the gateway a pass is a drift and does not shove.
const MIN_THROUGH = 0.25;   // m/s
// One shove per pass. Without it, one walk through hands the leaf an impulse
// every frame it is in range and the gate goes to its far stop every time.
const COOLDOWN = 0.5;       // seconds

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

// The angular half width of the shadow a circle of radius `r`, whose centre is
// `d` from the pivot, casts over a leaf of length `len` hinged there. That is:
// the leaf is in contact with the circle for exactly those angles within this
// much of pointing straight at it. Returns 0 for no contact possible.
//
// The leaf is a BAR, so this is a segment against a circle and not an endpoint
// against a circle: the ghost can be touched by the middle of the leaf while
// both of its ends are metres away from him, which is most of the cases that
// matter, since the gateway is narrower than the leaf is long.
//
// The distance from the circle's centre to the segment rises monotonically as
// the leaf turns away from it -- as the tip's distance while the foot of the
// perpendicular is off the end of the bar, then as `d * sin` once the foot is
// on the bar -- so there is one crossing and it is whichever of those two
// branches the crossing falls in. The test between them is whether the circle
// reaches past the tip's own circle, i.e. r^2 vs d^2 - len^2.
function shadowHalfAngle(d, len, r) {
  if (!(d > 0) || d >= len + r) return 0;
  if (r * r >= d * d - len * len) {
    // Crossing is on the side of the bar. Needs d > r, which is the degenerate
    // case handled by the caller.
    return d > r ? Math.asin(clamp(r / d, -1, 1)) : Math.PI;
  }
  // Crossing is round the tip: law of cosines on (pivot, tip, centre).
  return Math.acos(clamp((d * d + len * len - r * r) / (2 * d * len), -1, 1));
}

// The ground a gate needs to itself. Centre and radius in WORLD units, plus a
// predicate, so a scene can ask rather than each caller rebuilding the geometry
// out of the gate's internals.
//
// It is the FULL DISC of the leaf's reach about the hinge, not a half of one.
// The leaf sweeps a half disc on each side of the fence line and this gate is
// double-acting, so it uses both halves; and props go on both sides of a fence
// anyway. The radius is gate.js's own REACH, which is the number LEAF_LEN was
// solved out of: every point of the leaf is within it of the pivot at every
// angle, by construction, corner of the latch bar included.
//
// Nothing else about the gate is in here. The posts and their footings are
// static geometry and a prop that fouls one is a prop that is visibly inside a
// post, which is a placement problem and not this predicate's business.
export function gateKeepOut(gate, { margin = 0 } = {}) {
  const node = gate.hinge ?? gate.group;
  // updateWorldMatrix rather than updateMatrixWorld: it walks the ancestors and
  // this one node, not the forty meshes hanging off the leaf. The gate has
  // usually not been rendered yet the first time anyone asks.
  node.updateWorldMatrix(true, false);
  const m = node.matrixWorld.elements;
  const x = m[12];
  const z = m[14];
  // Whatever the group was scaled by, off the matrix, so a half-size gate keeps
  // half-size ground.
  const scale = Math.hypot(m[0], m[1], m[2]) || 1;
  const radius = (gate.sweepRadius ?? GATE_LAYOUT.sweepRadius) * scale + margin;
  return {
    x,
    z,
    radius,
    // `r` is the prop's own radius, so a caller can keep a wide thing further
    // out than a narrow one without doing the arithmetic itself.
    blocks(px, pz, r = 0) {
      return Math.hypot(px - x, pz - z) < radius + r;
    },
  };
}

export function createGateController({
  gate,
  swing,
  hinge = gate?.hinge,
  // Middle of the OPENING, in world. Proximity is measured from here and not
  // from the hinge post, which is at one end of the gateway: from the post,
  // half the gateway is out of range on one side and a stretch of fence is in
  // range on the other.
  openMid,
  // Must match the gate group's own rotation.y. Taken from the group when it
  // is not given, which is right for a prop placed with an ordinary yaw.
  yaw = gate?.group?.rotation.y ?? 0,
  leafSign = gate?.leafSign ?? 1,
  // Impulse per metre per second of speed through the gateway. Chosen against
  // the swing's own response rather than by feel: at 7.0 a full-speed pass
  // drove the leaf to 89.9 degrees, which is the hard stop, so every brisk
  // walk-through looked identical and ended in a clunk. At 3.5 a drift gives 37
  // degrees, a normal walk 56 and a sprint 70, so how hard he went through is
  // legible and the stop stays somewhere it can be earned.
  gain = 3.5,
  ghostRadius = GHOST_RADIUS,
  // How near the middle of the opening he has to be for a pass to count. The
  // leaf's own reach, because that is the distance at which he can be touched
  // by it at all, rather than a number picked to look about right.
  range = null,
} = {}) {
  const sign = leafSign < 0 ? -1 : 1;
  const axisX = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const axisZ = { x: Math.sin(yaw), z: Math.cos(yaw) };

  // World pivot and scale, read once off the object graph rather than rebuilt
  // out of the gate's internal offsets. Props do not move after they are
  // placed, and doing it lazily means the controller can be built before the
  // gate is added to the scene.
  let hx = 0;
  let hz = 0;
  let scale = 1;
  let placed = false;
  function place() {
    if (placed || !hinge) return;
    hinge.updateWorldMatrix(true, false);
    const m = hinge.matrixWorld.elements;
    hx = m[12];
    hz = m[14];
    scale = Math.hypot(m[0], m[1], m[2]) || 1;
    placed = true;
  }

  let cooldown = 0;

  return {
    update(dt, ghost) {
      place();
      if (!ghost) { swing.update(dt); if (hinge) hinge.rotation.y = swing.angle; return swing.angle; }

      // --- where he is, in the leaf's own terms ---------------------------
      const dx = ghost.pos.x - hx;
      const dz = ghost.pos.z - hz;
      // Components along the gate's own axes.
      const px = dx * axisX.x + dz * axisX.z;
      const pz = dx * axisZ.x + dz * axisZ.z;
      const dist = Math.hypot(px, pz);

      // The leaf angle at which the leaf points straight at him. Inverting
      // P(a) = R * sign * (cos a * axisX - sin a * axisZ) for the direction of
      // (px, pz): sign*cos a = px/dist and -sign*sin a = pz/dist.
      let at = Math.atan2(-sign * pz, sign * px);
      // Into the branch the leaf's own angle lives in. swing.js never wraps
      // anything, on purpose, so an interval handed to it has to be within PI
      // of where the leaf actually is. Matters for a ghost standing BEHIND the
      // hinge post, where the raw atan2 comes back near +/-PI.
      const a = swing.angle;
      while (at - a > Math.PI) at -= TAU;
      while (at - a < -Math.PI) at += TAU;

      const leaf = (gate?.sweepRadius ?? GATE_LAYOUT.sweepRadius) * scale;
      // The bar's own half thickness goes into the contact radius, because the
      // segment test treats the leaf as a line and the leaf is a board.
      const r = ghostRadius + GATE_LAYOUT.leaf.half * scale;

      // A ghost whose centre is inside the contact radius of the PIVOT is
      // standing in the hinge post, which is solid: he cannot get there
      // honestly, and there is no angle he does not block, so a shadow of PI
      // would freeze the leaf wherever it happened to be and never let it go.
      // The stop is dropped instead and the leaf swings freely. Chosen over
      // pushing him out (this file does not move the player) and over holding
      // the leaf (a gate frozen open by a body standing in a post is a bug that
      // looks like a hang).
      const half = dist > r ? shadowHalfAngle(dist, leaf, r) : 0;
      swing.block(half > 0 ? at : null, half);

      // --- the shove ------------------------------------------------------
      cooldown = Math.max(0, cooldown - dt);
      const mx = ghost.pos.x - openMid.x;
      const mz = ghost.pos.z - openMid.z;
      const near = range ?? leaf;
      if (Math.hypot(mx, mz) < near && cooldown === 0) {
        // His speed ACROSS the closed leaf, which is the leaf's own normal. An
        // earlier version used local +X, which runs ALONG the leaf, so the gate
        // answered to a ghost sliding past the fence and ignored one walking
        // straight through it.
        const through = ghost.vel.x * axisZ.x + ghost.vel.z * axisZ.z;
        if (Math.abs(through) > MIN_THROUGH) {
          // The sign. See the derivation at the top of the file: an increasing
          // angle carries the free edge along -leafSign * axisZ, so opening
          // AWAY from a ghost moving along +axisZ means a negative impulse.
          swing.push(-sign * through * gain);
          cooldown = COOLDOWN;
        }
      }

      swing.update(dt);
      if (hinge) hinge.rotation.y = swing.angle;
      return swing.angle;
    },

    // The ground the swing needs. A property rather than a call, since it is
    // fixed once the gate is placed, and the same object gateKeepOut returns.
    get keepOut() { place(); return gateKeepOut(gate); },

    // For tests and for anyone debugging the sign: the world direction the
    // leaf's free edge is travelling in right now, per unit of angular rate.
    edgeVelocityDir() {
      const a = swing.angle;
      const ex = -sign * (Math.sin(a) * axisX.x + Math.cos(a) * axisZ.x);
      const ez = -sign * (Math.sin(a) * axisX.z + Math.cos(a) * axisZ.z);
      return { x: ex, z: ez };
    },
  };
}

export default createGateController;
