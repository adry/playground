import * as THREE from 'three';
import { toyMaterial } from '../style.js';

// DIRT: THE GROUND BREAKING, AS SOLID CLODS.
//
// What a performance needs when its figure digs out of the floor. It is a
// field, not a prop: ONE instanced mesh for the whole scene, and every hole in
// the level draws out of it. Five skeletons climbing out at once is still one
// draw call.
//
// ============================================================================
// THE RULES THIS IS BUILT TO
// ============================================================================
//
// NO CARDS. There is no environment map in this scene, the camera is fixed and
// orthographic at about 38 degrees, and every previous attempt at alpha cards
// or billboards was rejected. So a dirt particle here is a small SOLID clod: a
// displaced sphere, lit by the same key as everything else, with a real
// silhouette and a real shaded side. That is also how the gravel path, the bush
// leaves and the ground scatter do it, and it is why "dust" below is not a puff
// sprite but a handful of very small clods with a lot of air drag on them.
//
// THE FLOOR IS ONE OPAQUE PLANE AT y = 0 (see ghost/ground.js), so anything
// below it is invisible for free. This file exploits that everywhere and fights
// it nowhere. The mound is not faded in: it is BUILT under the floor, complete,
// and pushed up through it, so what the eye sees is ground splitting and rising
// rather than clods materialising. A clod that would be culled is parked with a
// zero scale, which costs a degenerate triangle and no fragments.
//
// ============================================================================
// FOUR BEATS, NOT ONE EFFECT REPEATED
// ============================================================================
//
// Digging out is a sequence of different events and each one has to look like
// itself. The API is four verbs, and a performance calls them off its own
// choreography rather than off a timer this file owns:
//
//   stir(u)      0..1, called every frame before the break. The mound rises
//                through the floor and clods tip off its rim as it goes. This
//                is the beat that makes it "digging up" instead of "appearing".
//   burst(...)   the hand punches through. A sharp outward spray, FAST and LOW:
//                the horizontal speed is two to three times the vertical, so it
//                skims rather than fountains.
//   push(...)    the skull and shoulders come up. Earth pushed ASIDE, not
//                thrown: slow, heavy, a lot of spin, so the clods tumble off
//                the shoulders and roll down the mound they land on.
//   shrug(...)   it stands. A last fall of grit off the body plus a low ring of
//                fines, and then nothing more is emitted.
//
// And then the point of the whole thing: THE MESS STAYS. A settled clod is
// never removed and never faded out. The mound and the ring of scatter around
// each hole are the evidence that something came out of the ground there, and
// they are what make it read as real once the figure has walked away. Slots are
// only reused when the field runs out of them, oldest mess first.
//
// ============================================================================
// THE SIMULATION, AND WHAT IT BORROWED
// ============================================================================
//
// skeleton/motion.js's createDebris is the reference and it is the right shape
// for this: two lists, so a settled thing costs nothing but a slot, and contact
// solved against the REAL LOWEST POINT of a tumbling hull rather than against
// the origin, which is the only reason a tumbling object does not end up half
// sunk in the floor.
//
// It is not reused, for one reason: it is a per-object rigid body solver with a
// four-tilt stability probe, and it drives an Object3D. Both are right for six
// bones an emergence and wrong for a hundred and twenty clods. So the same two
// ideas are re-implemented over flat typed arrays with the cost taken out of
// them:
//
//   * the hull is an ELLIPSOID, so the lowest point at orientation q is an
//     exact closed form -- length of the semi-axes scaled by the body-space up
//     vector -- instead of a loop over a support cloud. Three multiplies and a
//     quaternion rotate per clod per substep, and it still changes as the clod
//     rolls, which is the property that matters.
//   * there is no stability probe. A clod is a lump about as wide as it is
//     tall and every pose of it is a resting pose, so the question the probe
//     exists to answer ("is this a minimum or is it balanced on its end?")
//     has one answer here. What replaces it is rolling resistance and a
//     timeout: a clod that will not stop is set down after CLOD_LIFE seconds
//     rather than rolling out of the level.
//
// Everything else is kept: the fixed inner step so the capture harness and the
// browser produce identical arcs, the floor on the bounce speed so nothing
// jitters at rest, and the tangential coupling that turns a skid into a roll.
//
// ============================================================================
// COLOUR
// ============================================================================
//
// Dirt from under a gravel path should not be the colour of dirt from under a
// lawn, and the level already knows which it is: game/level/groundcover.js
// draws all four painted grounds as ONE vertex-coloured surface mesh, so the
// colour of the ground at a point is a vertex on a mesh that is already in the
// scene. soilAt() below finds it -- nearest vertex on the cover surface to the
// hole, in the mesh's own frame -- and mixes it toward a deep subsoil brown,
// because what comes out of a hole is what was UNDER the surface and not the
// surface itself. One lookup per emergence, cached on the site; a linear scan
// of a 26k vertex cover is about a fifth of a millisecond and it happens once.
//
// It also picks up the cover's HEIGHT at that point, which is what the clods
// rest on. Without it a hole in a lawn leaves its scatter 3 cm underground.
//
// No cover in the scene (the free-roam ghost page has none) means bare floor,
// and bare floor gets dirtpile.js's own earth.

// --- palette ------------------------------------------------------------------
// dirtpile.js's flank tone is the reference for fresh spoil in this project and
// this is that colour. Handed to THREE.Color as an ordinary sRGB string and NOT
// converted again: with colour management on, Color already holds linear, and
// converting twice is what turned dirtpile's first clod pass into chocolate.
const EARTH = new THREE.Color('#917c60');
// Where a sampled surface colour is dragged toward. Subsoil is darker, browner
// and less varied than whatever is growing on top of it, so a gravel hole comes
// out grey-brown and a lawn hole comes out brown, but neither comes out green.
const SUBSOIL = new THREE.Color('#6f5c44');
const SUBSOIL_MIX = 0.55;
// Per-clod tone, dirtpile.js's TONE. Some clods came off the wet bottom of the
// hole and some off the dry top, and half a stop between them is what makes a
// scatter read as separate objects rather than one moulded one.
const TONE = { lo: 0.78, hi: 1.12 };

// --- sizes ---------------------------------------------------------------------
// In metres, against a figure 1.75 tall. A clod at the low end is 3 cm, which
// is about four pixels at true game framing -- small, but it is a lit solid with
// a shaded side, and forty of them is a shape. The mound is what carries the
// beat at that distance; the spray carries it in close-up.
const CLOD = { min: 0.030, max: 0.075 };
const GRIT = { min: 0.016, max: 0.034 };   // shrug fines, "dust"
const MOUND_CLOD = { min: 0.055, max: 0.105 };

// --- the mound -----------------------------------------------------------------
// A ring, not a dome: the middle of it is the hole the figure comes out of, so
// the profile peaks a third of the way out and dies at the rim. RISE is how far
// the whole thing travels as stir() goes 0 to 1, and it is more than the tallest
// clod so every one of them starts completely under the floor.
const MOUND = {
  count: 22,
  inner: 0.26,
  outer: 0.68,
  peak: 0.40,        // radius the crest sits at
  height: 0.085,     // crest height above the local ground
  // How far below the floor a mound clod starts, over and above its own
  // half-height. Each clod is buried by exactly enough to hide it and no more,
  // rather than by one shared depth: a shared depth is set by the tallest clod
  // in the ring, and then the whole mound spends the first two thirds of the
  // beat travelling through solid ground where nobody can see it.
  hide: 0.015,
  tilt: 0.55,        // radians a clod tips over as it comes up
  // How fast the mound is allowed to come up, in units of stir per second.
  //
  // This is the number that makes a cold start work. The skeleton's climb gives
  // the ground 0.12 s between the wake and the fist coming through it, which is
  // seven frames and not a beat anybody can see; but a performance is allowed
  // to ask for a mound that is already most of the way up, and this rate is
  // what turns that request into a SHOVE -- the ground domes over about a third
  // of a second and the fist bursts through it while it is still rising, which
  // is what breaking ground actually looks like. Where the performance does
  // have warning (the skeleton's buried phase watches the ghost approach) the
  // same call produces the slow version, because the rate is a ceiling and not
  // a speed.
  rate: 3.2,
};

// --- physics -------------------------------------------------------------------
const GRAVITY = -9.8;
const MAX_STEP = 1 / 120;     // fixed inner step: capture and browser agree
const BOUNCE = 0.24;          // clods are not stones; they mostly stop dead
const MIN_BOUNCE = 0.45;      // below this a landing is a landing, not a hop
const TANGENT_KEEP = 0.55;    // sideways speed kept through a hard landing
const SPIN_KEEP = 0.65;
const ROLL_COUPLE = 0.55;     // how much of the skid is handed to the tumble
const GROUND_DRAG = 5.2;      // per second, horizontal, in contact
const CONTACT_SPIN_DRAG = 4.0;
const AIR_SPIN_DRAG = 0.35;
const SLEEP_V = 0.10;
const SLEEP_W = 1.2;
const SLEEP_TIME = 0.12;
const CLOD_LIFE = 6.0;        // a clod still moving after this is set down anyway

// Slot states.
const FREE = 0;
const LIVE = 1;
const RESTING = 2;
const HELD = 3;               // kinematic: a mound clod, driven by stir()

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One clod. dirtpile.js's lump, at a segment count that suits something three
// centimetres across: a sphere pushed about by four low-frequency waves, smooth
// normals, no facets. The house style has no shards in it and a clod made by
// noise at a higher frequency comes out a raspberry.
//
// Radius 0.5, so an instance scale of s is a clod s metres across.
function clodGeometry(seed) {
  const rng = mulberry32(seed);
  const geo = new THREE.SphereGeometry(0.5, 6, 4);
  const p = geo.attributes.position;
  const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283, rng() * 6.283];
  const v = new THREE.Vector3();
  let sum = 0;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().multiplyScalar(2);
    const k = 1
      + 0.185 * Math.sin(2.3 * n.x + ph[0])
      + 0.155 * Math.sin(2.7 * n.y + ph[1])
      + 0.140 * Math.sin(2.1 * n.z + ph[2])
      + 0.100 * Math.sin(3.7 * (n.x - n.z) + ph[3]);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    sum += 0.5 * k;
  }
  geo.computeVertexNormals();
  // The mean radius of the lump, which is the semi-axis the contact test uses.
  // Taking the maximum would leave every clod hovering on its longest spike and
  // taking the minimum would bury them all.
  geo.userData.meanRadius = sum / p.count;
  return geo;
}

// THE GROUND UNDER A POINT, off the level's own painted cover.
//
// Returns { color, height } in world terms, or null where there is no cover.
// The surface mesh is identified by its colour attribute having FOUR
// components: the rim fade is the only alpha in groundcover.js and nothing else
// in the scene carries a vertex alpha, so that is its signature.
export function soilAt(scene, x, z) {
  const cover = scene?.getObjectByName?.('groundcover');
  if (!cover) return null;

  let surface = null;
  cover.traverse((o) => {
    if (surface || !o.isMesh) return;
    const col = o.geometry?.getAttribute?.('color');
    if (col && col.itemSize === 4 && o.geometry.getAttribute('position')) surface = o;
  });
  if (!surface) return null;

  // Ask the question in the mesh's own frame rather than transforming 26,000
  // vertices into the world's.
  surface.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(surface.matrixWorld).invert();
  const q = new THREE.Vector3(x, 0, z).applyMatrix4(inv);

  const pos = surface.geometry.getAttribute('position');
  const col = surface.geometry.getAttribute('color');
  const pa = pos.array;
  const ca = col.array;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0, o = 0; i < pos.count; i++, o += 3) {
    const dx = pa[o] - q.x;
    const dz = pa[o + 2] - q.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return null;
  // Out at the rim the cover is fading into bare floor, and a fifth of a coat
  // of grass is not what the hole is dug in.
  if (ca[best * 4 + 3] < 0.35) return null;

  const local = new THREE.Vector3(pa[best * 3], pa[best * 3 + 1], pa[best * 3 + 2]);
  local.applyMatrix4(surface.matrixWorld);
  return {
    color: new THREE.Color(ca[best * 4], ca[best * 4 + 1], ca[best * 4 + 2]),
    height: local.y,
  };
}

// ================================================================================
// THE FIELD
// ================================================================================

export function createDirtField({
  scene,
  capacity = 768,
  seed = 11,
  gravity = GRAVITY,
} = {}) {
  const geo = clodGeometry(seed);
  const material = toyMaterial('#ffffff', { roughness: 0.96, flatShading: false });
  const mesh = new THREE.InstancedMesh(geo, material, capacity);
  mesh.name = 'dirt';
  mesh.frustumCulled = false;           // the instances move; there is no useful bound
  mesh.castShadow = false;              // ground scatter's precedent: too small to pay for
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = capacity;
  scene?.add(mesh);

  const RADIUS = geo.userData.meanRadius;

  const im = mesh.instanceMatrix.array;
  // Per instance tone, the same mechanism the ground scatter uses. Written as
  // plain numbers because they are multipliers in the renderer's working space,
  // not colours to be converted from sRGB. Filled with white rather than left
  // at zero so a slot is never black for the frame between taking it and
  // tinting it.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const ic = mesh.instanceColor.array;

  // Per slot. Flat arrays, because the whole reason this is not createDebris is
  // that a hundred and twenty of anything should not be a hundred and twenty
  // objects.
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const vx = new Float32Array(capacity);
  const vy = new Float32Array(capacity);
  const vz = new Float32Array(capacity);
  const qx = new Float32Array(capacity);
  const qy = new Float32Array(capacity);
  const qz = new Float32Array(capacity);
  const qw = new Float32Array(capacity);
  const wx = new Float32Array(capacity);
  const wy = new Float32Array(capacity);
  const wz = new Float32Array(capacity);
  const sx = new Float32Array(capacity);   // semi-axes of the contact ellipsoid
  const sy = new Float32Array(capacity);
  const sz = new Float32Array(capacity);
  const drag = new Float32Array(capacity); // air drag, per second
  const rest = new Float32Array(capacity); // the local ground this clod lands on
  const still = new Float32Array(capacity);
  const age = new Float32Array(capacity);
  const state = new Uint8Array(capacity);
  // Which site last claimed the slot. A mound clod is the one thing here that
  // is written after it is spawned, and the field is allowed to recycle it out
  // from under its site when every slot is in use, so the site checks the tag
  // before it moves anything. Without it a full field lets one hole's mound
  // drag another hole's clods up out of the ground.
  const owner = new Int32Array(capacity).fill(-1);
  let nextSite = 0;

  const live = [];
  // Retirement order, so the oldest mess is the first thing recycled when the
  // field is full. A mound clod is in here too: it is mess as much as a settled
  // one is, and a level that has been played for five minutes should lose its
  // oldest hole rather than refuse to give its newest one any dirt.
  const kept = [];
  const free = [];
  for (let i = capacity - 1; i >= 0; i--) free.push(i);

  const rand = mulberry32(seed * 7919 + 13);
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  let dirty = true;
  let colourDirty = true;

  // Nothing is drawn in a slot that holds nothing: a zero scale collapses the
  // clod's twenty triangles to zero area and the rasteriser drops them.
  function blank(i) {
    im.fill(0, i * 16, i * 16 + 16);
  }
  for (let i = 0; i < capacity; i++) blank(i);

  function writeMatrix(i) {
    _p.set(px[i], py[i], pz[i]);
    _q.set(qx[i], qy[i], qz[i], qw[i]);
    _s.set(sx[i], sy[i], sz[i]).divideScalar(RADIUS);
    _m.compose(_p, _q, _s);
    _m.toArray(im, i * 16);
  }

  function take() {
    if (free.length) return free.pop();
    // Full. Recycle the oldest thing that has stopped moving. Never a live one:
    // taking a clod out of the air is a pop, and taking one out of a mound that
    // is still coming up is worse.
    const i = kept.shift();
    if (i === undefined) return -1;
    state[i] = FREE;
    return i;
  }

  // The lowest point of the clod, as an offset below its origin, at its current
  // orientation. The closed form for an ellipsoid: rotate world up into the
  // body's frame and take the length of the semi-axes along it.
  function lowest(i) {
    // Conjugate rotation of (0, 1, 0): the second column of the rotation matrix
    // read backwards, which is three multiply-adds rather than a full rotate.
    const x = qx[i];
    const y = qy[i];
    const z = qz[i];
    const w = qw[i];
    const ux = 2 * (x * y + w * z);
    const uy = 1 - 2 * (x * x + z * z);
    const uz = 2 * (y * z - w * x);
    const a = sx[i] * ux;
    const b = sy[i] * uy;
    const c = sz[i] * uz;
    return Math.sqrt(a * a + b * b + c * c);
  }

  function spin(i, h) {
    const w = Math.sqrt(wx[i] * wx[i] + wy[i] * wy[i] + wz[i] * wz[i]);
    if (w < 1e-6) return;
    const a = w * h * 0.5;
    const s = Math.sin(a) / w;
    const dx = wx[i] * s;
    const dy = wy[i] * s;
    const dz = wz[i] * s;
    const dw = Math.cos(a);
    // q = dq * q
    const ax = qx[i];
    const ay = qy[i];
    const az = qz[i];
    const aw = qw[i];
    let nx = dw * ax + dx * aw + dy * az - dz * ay;
    let ny = dw * ay - dx * az + dy * aw + dz * ax;
    let nz = dw * az + dx * ay - dy * ax + dz * aw;
    let nw = dw * aw - dx * ax - dy * ay - dz * az;
    const len = Math.hypot(nx, ny, nz, nw) || 1;
    qx[i] = nx / len; qy[i] = ny / len; qz[i] = nz / len; qw[i] = nw / len;
  }

  function integrate(i, h) {
    const floor = rest[i];
    const d = Math.exp(-drag[i] * h);
    vy[i] = (vy[i] + gravity * h) * d;
    vx[i] *= d;
    vz[i] *= d;
    px[i] += vx[i] * h;
    py[i] += vy[i] * h;
    pz[i] += vz[i] * h;

    const grounded = py[i] - lowest(i) <= floor + 0.004;
    if (grounded) {
      const gd = Math.exp(-GROUND_DRAG * h);
      vx[i] *= gd;
      vz[i] *= gd;
      wx[i] *= Math.exp(-CONTACT_SPIN_DRAG * h);
      wy[i] *= Math.exp(-CONTACT_SPIN_DRAG * h);
      wz[i] *= Math.exp(-CONTACT_SPIN_DRAG * h);
    } else {
      const ad = Math.exp(-AIR_SPIN_DRAG * h);
      wx[i] *= ad; wy[i] *= ad; wz[i] *= ad;
    }

    spin(i, h);

    // Resolve the floor AFTER rotating, because the rotation is what changed
    // the lowest extent. The other order lets a clod turn its shoulder through
    // the ground and stay there until the next frame notices.
    const low = py[i] - lowest(i);
    if (low < floor) {
      py[i] += floor - low;
      if (vy[i] < 0) {
        const impact = -vy[i];
        vy[i] = impact < MIN_BOUNCE ? 0 : impact * BOUNCE;
        if (impact >= MIN_BOUNCE) {
          const hit = clamp01((impact - MIN_BOUNCE) / 1.6);
          const keep = 1 + (TANGENT_KEEP - 1) * hit;
          vx[i] *= keep;
          vz[i] *= keep;
          const sk = 1 + (SPIN_KEEP - 1) * hit;
          wx[i] *= sk; wy[i] *= sk; wz[i] *= sk;
        }
        // Hand part of the skid to the tumble, so a clod thrown along the
        // ground rolls out instead of sliding to a stop on the spot. The
        // angular velocity a rolling body of this radius would have is
        // (up x v) / r, and the contact drags the clod toward it.
        const r = Math.max(lowest(i), 1e-3);
        const rx = -vz[i] / r;
        const rz = vx[i] / r;
        wx[i] += (rx - wx[i]) * ROLL_COUPLE;
        wz[i] += (rz - wz[i]) * ROLL_COUPLE;
      }
    }

    age[i] += h;
    const slow = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i] < SLEEP_V * SLEEP_V
      && wx[i] * wx[i] + wy[i] * wy[i] + wz[i] * wz[i] < SLEEP_W * SLEEP_W
      && py[i] - lowest(i) <= floor + 0.002;
    still[i] = slow ? still[i] + h : 0;
    return still[i] < SLEEP_TIME && age[i] < CLOD_LIFE;
  }

  // Setting a clod down is the last chance to place it exactly: its lowest
  // point goes precisely on the ground it landed on. Every "settled thing
  // slowly sinking" bug is a step that left a fraction of a millimetre of
  // penetration and never looked again.
  function retire(i) {
    py[i] = rest[i] + lowest(i);
    vx[i] = 0; vy[i] = 0; vz[i] = 0;
    wx[i] = 0; wy[i] = 0; wz[i] = 0;
    state[i] = RESTING;
    kept.push(i);
    writeMatrix(i);
  }

  function randomQuat(i) {
    // Uniform on the sphere of orientations. A clod with a biased tumble reads
    // as a clod that was placed.
    const u1 = rand();
    const u2 = rand() * 6.283185;
    const u3 = rand() * 6.283185;
    const a = Math.sqrt(1 - u1);
    const b = Math.sqrt(u1);
    qx[i] = a * Math.sin(u2);
    qy[i] = a * Math.cos(u2);
    qz[i] = b * Math.sin(u3);
    qw[i] = b * Math.cos(u3);
  }

  function tint(i, colour) {
    const t = mix(TONE.lo, TONE.hi, rand());
    ic[i * 3] = colour.r * t;
    ic[i * 3 + 1] = colour.g * t * (0.98 + 0.04 * rand());
    ic[i * 3 + 2] = colour.b * t;
    colourDirty = true;
  }

  // Put one clod into the world. Everything the beats do comes through here.
  function emit({
    x, y, z, vel, spinRate = 8, size, colour, ground = 0, airDrag = 0.02,
  }) {
    const i = take();
    if (i < 0) return -1;
    px[i] = x; py[i] = y; pz[i] = z;
    vx[i] = vel[0]; vy[i] = vel[1]; vz[i] = vel[2];
    // Mildly anisotropic. Perfectly round clods read as peas; the instance
    // matrix carries the squash, and a 0.8 minimum keeps the normal error the
    // instanced shader's mat3 introduces below anything the eye can find.
    const a = size * (0.86 + 0.14 * rand());
    const b = size * (0.80 + 0.20 * rand());
    const c = size * (0.86 + 0.14 * rand());
    sx[i] = a * 0.5; sy[i] = b * 0.5; sz[i] = c * 0.5;
    randomQuat(i);
    wx[i] = (rand() * 2 - 1) * spinRate;
    wy[i] = (rand() * 2 - 1) * spinRate;
    wz[i] = (rand() * 2 - 1) * spinRate;
    drag[i] = airDrag;
    rest[i] = ground;
    still[i] = 0;
    age[i] = 0;
    state[i] = LIVE;
    owner[i] = -1;
    tint(i, colour);
    live.push(i);
    writeMatrix(i);
    dirty = true;
    return i;
  }

  // A kinematic slot: a mound clod, whose height is written by stir() and which
  // never runs the simulation until something tips it off.
  function hold({ x, z, size, colour, ground, site = -1 }) {
    const i = take();
    if (i < 0) return -1;
    owner[i] = site;
    px[i] = x; py[i] = ground; pz[i] = z;
    vx[i] = 0; vy[i] = 0; vz[i] = 0;
    wx[i] = 0; wy[i] = 0; wz[i] = 0;
    const a = size * (0.88 + 0.12 * rand());
    const b = size * (0.72 + 0.20 * rand());
    const c = size * (0.88 + 0.12 * rand());
    sx[i] = a * 0.5; sy[i] = b * 0.5; sz[i] = c * 0.5;
    randomQuat(i);
    rest[i] = ground;
    drag[i] = 0.02;
    still[i] = 0;
    age[i] = 0;
    state[i] = HELD;
    tint(i, colour);
    kept.push(i);
    blank(i);
    dirty = true;
    return i;
  }

  // Hand a held clod to the simulation. Used when the rising mound sheds one,
  // and when a shoulder shoves through the rim.
  function loosen(i, vel, spinRate) {
    if (state[i] !== HELD) return false;
    state[i] = LIVE;
    owner[i] = -1;
    vx[i] = vel[0]; vy[i] = vel[1]; vz[i] = vel[2];
    wx[i] = (rand() * 2 - 1) * spinRate;
    wy[i] = (rand() * 2 - 1) * spinRate;
    wz[i] = (rand() * 2 - 1) * spinRate;
    still[i] = 0;
    age[i] = 0;
    const k = kept.indexOf(i);
    if (k >= 0) kept.splice(k, 1);
    live.push(i);
    dirty = true;
    return true;
  }

  function step(dt) {
    if (!(dt > 0)) return;
    for (const site of sites) site.advance(dt);
    if (live.length) {
      const steps = Math.min(Math.ceil(dt / MAX_STEP), 32);
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        for (let n = live.length - 1; n >= 0; n--) {
          const i = live[n];
          if (!integrate(i, h)) {
            retire(i);
            live.splice(n, 1);
          }
        }
        if (!live.length) break;
      }
      for (const i of live) writeMatrix(i);
      dirty = true;
    }
    if (dirty) { mesh.instanceMatrix.needsUpdate = true; dirty = false; }
    if (colourDirty) { mesh.instanceColor.needsUpdate = true; colourDirty = false; }
  }

  // Exactly one site drives the shared field, or five skeletons would advance
  // it five times a frame and every clod would fall at 5g. This is the same
  // trap ghost/main.js names for the shed bones, and the field closes it itself
  // rather than trusting five callers to agree.
  let primary = null;
  const sites = [];

  const field = {
    mesh,
    group: mesh,
    // --- a site: one hole's worth of dirt --------------------------------------
    site({ x = 0, z = 0, yaw = 0 } = {}) {
      let cx = x;
      let cz = z;
      let cyaw = yaw;
      let soil = null;
      let ground = 0;
      let colour = EARTH.clone();
      const mound = [];        // slot indices, outermost last
      let stirred = 0;
      let want = 0;
      let tipped = 0;
      let armed = false;
      const id = nextSite++;
      const mine = (i) => state[i] === HELD && owner[i] === id;

      function look() {
        const found = soilAt(scene, cx, cz);
        soil = found;
        ground = found ? found.height : 0;
        colour = found
          ? found.color.clone().lerp(SUBSOIL, SUBSOIL_MIX)
          : EARTH.clone();
      }

      function buildMound() {
        for (let n = 0; n < MOUND.count; n++) {
          // Spiralled rather than random in angle, so a 22 clod ring has no
          // bald side. The radius is what is random.
          const a = (n / MOUND.count) * 6.283185 + rand() * 0.24 + cyaw;
          const u = rand();
          const r = mix(MOUND.inner, MOUND.outer, u * u * 0.6 + rand() * 0.4);
          const size = mix(MOUND_CLOD.min, MOUND_CLOD.max, rand());
          const i = hold({
            x: cx + Math.cos(a) * r,
            z: cz + Math.sin(a) * r,
            size,
            colour,
            ground,
            site: id,
          });
          if (i < 0) break;
          // The crest is a third of the way out and the rim dies to nothing, so
          // the mound is a ring around the hole rather than a dome over it.
          const t = clamp01(1 - Math.abs(r - MOUND.peak) / (MOUND.outer - MOUND.peak));
          mound.push({
            slot: i,
            top: ground + MOUND.height * t * (0.55 + 0.75 * rand()),
            sunk: ground - (sy[i] + MOUND.hide),
            tilt: (rand() * 2 - 1) * MOUND.tilt,
            axis: a,
            r,
            base: { x: qx[i], y: qy[i], z: qz[i], w: qw[i] },
          });
        }
        // Outermost last: the clods that tip off are the ones nearest the rim.
        mound.sort((a, b) => a.r - b.r);
      }

      const _qb = new THREE.Quaternion();
      function placeMound() {
        const e = stirred * stirred * (3 - 2 * stirred);
        for (const m of mound) {
          const i = m.slot;
          if (!mine(i)) continue;
          py[i] = mix(m.sunk, m.top, e);
          // It tips as it comes up, about the tangent of its own ring, which is
          // what a lump of turf levered from underneath does. The tip is
          // applied in WORLD terms on top of the clod's own random orientation,
          // so every clod on the ring leans outward and none of them leans the
          // same way as its neighbour.
          _q.setFromAxisAngle(
            _v.set(Math.sin(m.axis), 0, -Math.cos(m.axis)),
            m.tilt * e,
          );
          _q.multiply(_qb.set(m.base.x, m.base.y, m.base.z, m.base.w));
          qx[i] = _q.x; qy[i] = _q.y; qz[i] = _q.z; qw[i] = _q.w;
          writeMatrix(i);
        }
        dirty = true;
      }

      const api = {
        // Called by the field's own step, once a frame, for every site. This is
        // where the mound actually moves: stir() only says how far it is
        // allowed to get.
        advance(dt) {
          if (!armed || stirred >= want) return;
          stirred = Math.min(want, stirred + MOUND.rate * dt);
          placeMound();
          // Clods tip off the rim as it rises. Three of them, spaced through
          // the climb, taken from the outermost ring inward, each rolling away
          // down the slope it was sitting on. This is the half of beat one that
          // reads at game framing: a mound 15 cm across is a smudge, and a clod
          // coming off it and rolling is a thing that moved.
          // Nothing tips until the mound is proud enough to tip off: a clod
          // released while its slot is still under the floor arrives by being
          // shoved up through it, which reads as a bug and not as a break.
          const owed = Math.floor(clamp01((stirred - 0.40) / 0.60) * 3.4);
          while (tipped < owed && mound.length) {
            const m = mound[mound.length - 1 - tipped];
            tipped += 1;
            if (!m || !mine(m.slot)) continue;
            const a = Math.atan2(pz[m.slot] - cz, px[m.slot] - cx);
            loosen(m.slot, [
              Math.cos(a) * (0.35 + 0.45 * rand()),
              0.15 + 0.35 * rand(),
              Math.sin(a) * (0.35 + 0.45 * rand()),
            ], 9);
          }
        },

        // Where the hole is. The rules move a grave between waves, so this is
        // not fixed at construction.
        moveTo(nx, nz, nyaw) {
          if (nx === cx && nz === cz && (nyaw === undefined || nyaw === cyaw)) return;
          cx = nx; cz = nz;
          if (typeof nyaw === 'number') cyaw = nyaw;
          // The old mound belongs to the old hole and stays exactly where it
          // is: it is the evidence that something came out of the ground there.
          mound.length = 0;
          armed = false;
          soil = null;
        },

        // A new emergence at this site. Idempotent: calling it twice does not
        // build two mounds.
        arm() {
          if (armed) return;
          armed = true;
          stirred = 0;
          want = 0;
          tipped = 0;
          if (!soil) look();
          buildMound();
          placeMound();
        },

        // BEAT 1. Something is coming. 0 is flat ground, 1 is a mound fully up.
        //
        // A REQUEST, not a position. It is monotonic -- a mound does not go
        // back down -- and it is rate limited by MOUND.rate, so a performance
        // that has no warning can ask for most of a mound on the frame it wakes
        // and still get a shove rather than a pop. Call it every frame across
        // the beat; calling it once with 1 is a legitimate way to say "as fast
        // as you are allowed".
        stir(u) {
          if (!armed) api.arm();
          const v = clamp01(u);
          if (v > want) want = v;
        },

        // BEAT 2. The hand punches through. Fast and LOW: the horizontal speed
        // is two to three times the vertical, so the spray skims the ground and
        // travels, instead of going up and coming back down in the same place.
        burst({ x: hx = cx, z: hz = cz, dir = null, strength = 1, count = 14 } = {}) {
          if (!armed) api.arm();
          const ax = dir ? dir[0] : 0;
          const az = dir ? dir[1] : 0;
          const len = Math.hypot(ax, az) || 1;
          for (let n = 0; n < count; n++) {
            // A full ring, leaned hard toward the punch: a fist through the
            // surface throws earth every way, just not evenly.
            const a = rand() * 6.283185;
            let dx = Math.cos(a);
            let dz = Math.sin(a);
            if (dir) {
              dx = mix(dx, ax / len, 0.55);
              dz = mix(dz, az / len, 0.55);
            }
            const speed = (1.7 + 2.0 * rand()) * strength;
            const up = (0.7 + 0.9 * rand()) * strength;
            emit({
              x: hx + dx * 0.05,
              y: ground + 0.02 + 0.05 * rand(),
              z: hz + dz * 0.05,
              vel: [dx * speed, up, dz * speed],
              spinRate: 26,
              size: mix(CLOD.min, CLOD.max, rand() * rand()),
              colour,
              ground,
              airDrag: 0.10,
            });
          }
        },

        // BEAT 3. The skull and the shoulders. Earth pushed ASIDE: slow, heavy,
        // spinning hard, spawned on the rim of the hole rather than in the air,
        // so it tumbles off the shoulder and rolls down the mound.
        push({ x: hx = cx, z: hz = cz, dir = null, strength = 1, count = 7, height = 0.10 } = {}) {
          if (!armed) api.arm();
          const ax = dir ? dir[0] : 0;
          const az = dir ? dir[1] : 0;
          const len = Math.hypot(ax, az) || 1;
          for (let n = 0; n < count; n++) {
            const a = rand() * 6.283185;
            let dx = Math.cos(a);
            let dz = Math.sin(a);
            if (dir) {
              dx = mix(dx, ax / len, 0.4);
              dz = mix(dz, az / len, 0.4);
            }
            const speed = (0.35 + 0.55 * rand()) * strength;
            emit({
              x: hx + dx * (0.10 + 0.14 * rand()),
              y: ground + height * (0.4 + rand()),
              z: hz + dz * (0.10 + 0.14 * rand()),
              vel: [dx * speed, 0.10 + 0.30 * rand(), dz * speed],
              // The heavy ones. A big clod turning slowly is the whole read of
              // "shoved" rather than "thrown".
              spinRate: 7,
              size: mix(CLOD.max * 0.7, CLOD.max, rand()),
              colour,
              ground,
              airDrag: 0.02,
            });
          }
        },

        // BEAT 4. It stands. Grit falls off the body from wherever it was
        // clinging, and a low ring of fines goes out around the feet. No card
        // and no puff sprite: the "dust" is small clods with heavy air drag, so
        // they decelerate visibly and drift down instead of arcing.
        shrug({ x: hx = cx, z: hz = cz, strength = 1, count = 10, fines = 10, top = 1.2 } = {}) {
          if (!armed) api.arm();
          for (let n = 0; n < count; n++) {
            const a = rand() * 6.283185;
            const r = 0.06 + 0.20 * rand();
            emit({
              x: hx + Math.cos(a) * r,
              y: ground + top * (0.25 + 0.75 * rand()),
              z: hz + Math.sin(a) * r,
              vel: [Math.cos(a) * 0.25 * strength, -0.1 * rand(), Math.sin(a) * 0.25 * strength],
              spinRate: 10,
              size: mix(CLOD.min, CLOD.max * 0.8, rand()),
              colour,
              ground,
              airDrag: 0.05,
            });
          }
          for (let n = 0; n < fines; n++) {
            const a = rand() * 6.283185;
            const speed = (0.55 + 0.75 * rand()) * strength;
            emit({
              x: hx + Math.cos(a) * 0.10,
              y: ground + 0.03 + 0.12 * rand(),
              z: hz + Math.sin(a) * 0.10,
              vel: [Math.cos(a) * speed, 0.25 + 0.35 * rand(), Math.sin(a) * speed],
              spinRate: 18,
              size: mix(GRIT.min, GRIT.max, rand()),
              colour,
              ground,
              // The whole difference between grit and dust, at this scale: air
              // drag six times a clod's, so it stops in the air and falls.
              airDrag: 1.8,
            });
          }
        },

        // The emergence is over. The mound and the scatter stay; the site stops
        // being armed, so the next emergence here builds a fresh one.
        done() {
          armed = false;
          want = 0;
          stirred = 0;
          mound.length = 0;
        },

        // Steps the SHARED field, and only for whichever site got there first.
        update(dt) {
          if (!primary) primary = api;
          if (primary === api) step(dt);
        },

        dispose() {
          if (primary === api) primary = null;
          const k = sites.indexOf(api);
          if (k >= 0) sites.splice(k, 1);
          mound.length = 0;
          armed = false;
        },

        // For the harness. A performance asserted numerically is one that stays
        // fixed.
        stats() {
          return {
            armed,
            stirred: +stirred.toFixed(3),
            want: +want.toFixed(3),
            mound: mound.length,
            ground: +ground.toFixed(4),
            tint: colour.getHexString(),
            fromCover: !!soil,
          };
        },
      };
      sites.push(api);
      return api;
    },

    update: step,

    stats() {
      let held = 0;
      for (let i = 0; i < capacity; i++) if (state[i] === HELD) held += 1;
      return {
        capacity,
        live: live.length,
        kept: kept.length,
        held,
        free: free.length,
        draws: 1,
      };
    },

    clear() {
      live.length = 0;
      kept.length = 0;
      free.length = 0;
      for (let i = capacity - 1; i >= 0; i--) { state[i] = FREE; blank(i); free.push(i); }
      mesh.instanceMatrix.needsUpdate = true;
    },

    dispose() {
      mesh.parent?.remove(mesh);
      geo.dispose();
      material.dispose();
      if (scene?.userData?.dirtField === field) scene.userData.dirtField = null;
    },
  };

  return field;
}

// ONE FIELD PER SCENE, found rather than wired.
//
// The requirement is one draw call for all the dirt in the scene while up to
// five skeletons are climbing out at once, and the performances are built one
// at a time by code that has no idea how many there will be. So the field lives
// on the scene and the first performance to ask for it builds it. No caller has
// to own it, pass it down, or remember to dispose it, and the game's scene file
// needs no change at all.
//
// Pass an explicit field to a performance instead if you want two of them, or
// none: this is the default, not the only way.
export function sharedDirt(scene, options = {}) {
  if (!scene) return null;
  const found = scene.userData.dirtField;
  if (found) return found;
  const made = createDirtField({ scene, ...options });
  scene.userData.dirtField = made;
  return made;
}

export default { createDirtField, sharedDirt, soilAt };
